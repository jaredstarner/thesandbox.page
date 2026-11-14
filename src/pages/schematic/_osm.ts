// Turn an Overpass API answer (route relations, their member nodes, and their route masters)
// into a compact network: named stations, and lines as ordered lists of those stations.
// Used for the snapshots in _data/ and, in the browser, for any other city.

export interface Line {
  ref: string;
  name: string;
  colour: string;
  /** Each route is the list of station indexes a train calls at, in order. */
  routes: number[][];
}

export interface Network {
  /** Station name, latitude, longitude. */
  stations: [string, number, number][];
  lines: Line[];
}

interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}
interface OsmMember {
  type: string;
  ref: number;
  role: string;
}
interface OsmRelation {
  type: 'relation';
  id: number;
  tags?: Record<string, string>;
  members?: OsmMember[];
}
type OsmElement = OsmNode | OsmRelation | { type: 'way'; id: number };

/** Colours OSM mappers write as words. */
const NAMED: Record<string, string> = {
  red: '#e32017',
  blue: '#0a4fa3',
  green: '#00843d',
  yellow: '#f4c400',
  orange: '#f08a00',
  purple: '#7b3f98',
  brown: '#8b5a2b',
  pink: '#e88fb4',
  grey: '#8d9093',
  gray: '#8d9093',
  black: '#222222',
  white: '#bfbfbf',
  silver: '#a2a5a8',
  gold: '#c9a227',
  lime: '#8cc63f',
  navy: '#1c2f6b',
  teal: '#00837f',
  cyan: '#2bb5d8',
  magenta: '#c4007a',
  maroon: '#7a1f2b',
  olive: '#7d8b2e',
};

/** For lines OSM gives no colour. */
const SPARE = ['#3b6fb6', '#d1495b', '#2a9d8f', '#e9a03b', '#8d5fa8', '#5c946e', '#c2683a', '#4a5a7a'];

export function normaliseColour(raw: string | undefined, spareIndex: number): string {
  if (raw) {
    const c = raw.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(c)) return c;
    if (/^#[0-9a-f]{3}$/.test(c)) return '#' + [...c.slice(1)].map((h) => h + h).join('');
    if (/^[0-9a-f]{6}$/.test(c)) return '#' + c;
    if (NAMED[c]) return NAMED[c];
  }
  return SPARE[spareIndex % SPARE.length];
}

/** True when a name is written in Latin letters (with any accents), digits, and punctuation. */
function isLatin(s: string): boolean {
  return /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{M}\p{S}]+$/u.test(s);
}

function nodeName(tags: Record<string, string> | undefined): string | null {
  if (!tags) return null;
  const name = tags.name?.trim();
  if (name && isLatin(name)) return tidyName(name);
  const en = (tags['name:en'] || tags['name:latin'] || tags['name:ja-Latn'] || tags['name:ja_rm'])?.trim();
  if (en && isLatin(en)) return tidyName(en);
  return null;
}

/** Drop the decorations stop names often carry, such as "(U6)" or "Station". */
function tidyName(name: string): string {
  return name
    .replace(/\s*\((?:U\d+|S\d+|M\d+|Line \d+|metro|subway|underground)\)\s*$/i, '')
    .replace(/\s+(?:U-Bahn|Station|Subway Station|Metro Station|Underground Station|MRT Station)$/i, '')
    .replace(/\s+L\d{1,2}$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lower case, no accents or punctuation: two spellings of one station compare equal. */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\bst\b\.?/g, 'saint')
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function metres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const kx = 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dx = (lon2 - lon1) * kx;
  const dy = (lat2 - lat1) * 110574;
  return Math.hypot(dx, dy);
}

const STOP_ROLES = new Set(['stop', 'stop_entry_only', 'stop_exit_only', 'forward_stop', 'backward_stop']);

/**
 * Build a network from Overpass JSON. Stops that share a name within about a kilometre become one station;
 * routes that share a `ref` (or route master) become one line.
 */
export function fromOverpass(json: { elements: OsmElement[] }): Network {
  const nodes = new Map<number, OsmNode>();
  const routes: OsmRelation[] = [];
  const masters: OsmRelation[] = [];
  for (const el of json.elements) {
    if (el.type === 'node') nodes.set(el.id, el);
    else if (el.type === 'relation') {
      if (el.tags?.type === 'route_master') masters.push(el);
      else if (el.tags?.type === 'route' && el.members) routes.push(el);
    }
  }

  // Stations: cluster named stops by name and distance.
  const stations: { name: string; key: string; lat: number; lon: number; n: number }[] = [];
  const byKey = new Map<string, number[]>();
  const stationOf = (node: OsmNode): number | null => {
    const name = nodeName(node.tags);
    if (!name) return null;
    const key = nameKey(name);
    const list = byKey.get(key) ?? [];
    for (const i of list) {
      const s = stations[i];
      if (metres(s.lat, s.lon, node.lat, node.lon) < 1100) {
        s.lat = (s.lat * s.n + node.lat) / (s.n + 1);
        s.lon = (s.lon * s.n + node.lon) / (s.n + 1);
        s.n++;
        return i;
      }
    }
    stations.push({ name, key, lat: node.lat, lon: node.lon, n: 1 });
    list.push(stations.length - 1);
    byKey.set(key, list);
    return stations.length - 1;
  };

  // Lines: group routes by ref (falling back to name), carrying the master's colour and name when there is one.
  const masterOf = new Map<string, Record<string, string>>();
  for (const m of masters) {
    const t = m.tags ?? {};
    const ref = (t.ref || t.name || '').trim();
    if (ref) masterOf.set(ref, t);
  }
  const lines = new Map<string, Line & { colourRaw?: string }>();
  for (const r of routes) {
    const t = r.tags ?? {};
    const ref = (t.ref || t.name || String(r.id)).trim();
    const members = r.members ?? [];
    let picks = members.filter((m) => m.type === 'node' && STOP_ROLES.has(m.role));
    if (picks.length < 2) picks = members.filter((m) => m.type === 'node' && m.role.startsWith('platform'));
    const seq: number[] = [];
    for (const m of picks) {
      const node = nodes.get(m.ref);
      if (!node) continue;
      const s = stationOf(node);
      if (s === null) continue;
      if (seq[seq.length - 1] !== s) seq.push(s);
    }
    if (seq.length < 2) continue;
    let line = lines.get(ref);
    if (!line) {
      const master = masterOf.get(ref);
      const shortName = (master?.ref || t.ref || '').trim();
      line = {
        ref: shortName || ref,
        name: (master?.name || t.name || ref).trim(),
        colour: '',
        colourRaw: master?.colour || t.colour,
        routes: [],
      };
      lines.set(ref, line);
    }
    if (!line.colourRaw && t.colour) line.colourRaw = t.colour;
    line.routes.push(seq);
  }

  // Drop routes that repeat another (same calls, either direction).
  const out: Line[] = [];
  let spare = 0;
  for (const line of lines.values()) {
    const seen = new Set<string>();
    const kept: number[][] = [];
    for (const r of line.routes.sort((a, b) => b.length - a.length)) {
      const f = r.join(',');
      const b = [...r].reverse().join(',');
      if (seen.has(f) || seen.has(b)) continue;
      seen.add(f);
      kept.push(r);
    }
    out.push({ ref: line.ref, name: line.name, colour: normaliseColour(line.colourRaw, spare++), routes: kept });
  }
  out.sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }));

  // Keep only stations some line uses, renumbered.
  const used = new Map<number, number>();
  const keep: Network['stations'] = [];
  for (const line of out) {
    line.routes = line.routes.map((r) =>
      r.map((s) => {
        let i = used.get(s);
        if (i === undefined) {
          i = keep.length;
          used.set(s, i);
          const st = stations[s];
          keep.push([st.name, Math.round(st.lat * 1e5) / 1e5, Math.round(st.lon * 1e5) / 1e5]);
        }
        return i;
      }),
    );
  }
  return { stations: keep, lines: out };
}
