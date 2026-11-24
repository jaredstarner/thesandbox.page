// What /obvious-exits/ asks OpenStreetMap for, and how the answer is cut down to what the story uses.
// Plain JavaScript so the page and the snapshot script (_snapshot.mjs, run with Node) share one copy.

/**
 * A town cut down to what the story reads. Coordinates are whole steps of 1e-5 degrees from the
 * centre, about a metre, which keeps the snapshots small.
 * @typedef {Record<string, string>} Tags
 * @typedef {{ v: 1, c: [number, number], r: number, n: number[], w: [number[], Tags][], p: [number, number, Tags][] }} Compact
 */

/** Keys the story reads; everything else in a tag list is dropped. */
const KEEP = new Set([
  'name',
  'name:en',
  'highway',
  'footway',
  'service',
  'access',
  'foot',
  'bridge',
  'bridge:name',
  'tunnel',
  'surface',
  'lit',
  'area',
  'indoor',
  'layer',
  'covered',
  'incline',
  'step_count',
  'amenity',
  'shop',
  'tourism',
  'historic',
  'leisure',
  'craft',
  'office',
  'healthcare',
  'cuisine',
  'religion',
  'denomination',
  'waterway',
  'natural',
  'landuse',
  'place',
  'building',
  'man_made',
  'memorial',
  'artwork_type',
  'railway',
  'station',
  'atm',
  'opening_hours',
  'tower:type',
  'height',
]);

/** Highway values that might carry someone on foot. */
const WALK =
  'primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|pedestrian|footway|path|steps|service|track|cycleway|bridleway|road';

const POI_KEYS = 'amenity|shop|tourism|historic|leisure|craft|office|healthcare|railway|man_made';

/**
 * The Overpass query for everything within `r` metres of a point.
 * @param {number} lat
 * @param {number} lon
 * @param {number} r
 */
export function overpassQuery(lat, lon, r) {
  const at = `(around:${r},${lat.toFixed(5)},${lon.toFixed(5)})`;
  return `[out:json][timeout:90];
(
  way${at}[highway~"^(${WALK})$"];
  way${at}[waterway~"^(river|canal|stream)$"];
  way${at}[leisure~"^(park|garden|playground|nature_reserve)$"];
  way${at}[landuse~"^(cemetery|grass|recreation_ground|allotments)$"];
  way${at}[amenity=grave_yard];
  way${at}[natural~"^(water|wood)$"];
  way${at}[place=square];
)->.g;
(
  node${at}[name][~"^(${POI_KEYS})$"~"."];
  node${at}[amenity~"^(post_box|atm|post_office|fountain|drinking_water|telephone|clock|bench)$"];
  node${at}[shop];
)->.pn;
way${at}[name][~"^(${POI_KEYS})$"~"."]->.pw;
.g out body geom qt;
.pn out body qt;
.pw out tags center qt;`;
}

/** @param {Record<string, string> | undefined} tags @returns {Tags} */
function trim(tags) {
  /** @type {Tags} */
  const out = {};
  if (!tags) return out;
  // Tabs and newlines separate tags in the packed form, so none may be left inside a value.
  for (const k in tags) if (KEEP.has(k)) out[k] = String(tags[k]).replace(/[\t\n\r]+/g, ' ');
  return out;
}

/**
 * The form written to disk and to storage: the same town as a few long strings, with coordinates
 * stored as steps from the node before and every distinct set of tags stored once. It is about
 * half the size, and a formatter leaves it on a handful of lines.
 * @typedef {{ v: 2, c: [number, number], r: number, t: string, n: string, w: string, p: string }} Packed
 */

/** @param {Compact} town @returns {Packed} */
export function pack(town) {
  /** @type {Map<string, number>} */
  const ids = new Map();
  /** @type {string[]} */
  const sets = [];
  const tagId = (/** @type {Tags} */ tags) => {
    const s = Object.keys(tags)
      .sort()
      .map((k) => `${k}=${tags[k]}`)
      .join('\t');
    let id = ids.get(s);
    if (id === undefined) {
      id = sets.length;
      ids.set(s, id);
      sets.push(s);
    }
    return id;
  };
  /** @type {string[]} */
  const n = [];
  let py = 0;
  let px = 0;
  for (let i = 0; i < town.n.length; i += 2) {
    n.push(`${town.n[i] - py},${town.n[i + 1] - px}`);
    py = town.n[i];
    px = town.n[i + 1];
  }
  const w = town.w.map(([nodes, tags]) => {
    let prev = 0;
    const steps = nodes.map((k) => {
      const d = k - prev;
      prev = k;
      return d;
    });
    return `${tagId(tags)}:${steps.join(' ')}`;
  });
  const p = town.p.map(([y, x, tags]) => `${tagId(tags)}:${y},${x}`);
  return { v: 2, c: town.c, r: town.r, t: sets.join('\n'), n: n.join(' '), w: w.join('|'), p: p.join('|') };
}

/** @param {Packed | Compact} packed @returns {Compact} */
export function unpack(packed) {
  if (packed.v === 1) return packed;
  const sets = packed.t.split('\n').map((s) => {
    /** @type {Tags} */
    const o = {};
    if (s)
      for (const kv of s.split('\t')) {
        const i = kv.indexOf('=');
        o[kv.slice(0, i)] = kv.slice(i + 1);
      }
    return o;
  });
  /** @type {number[]} */
  const n = [];
  let y = 0;
  let x = 0;
  if (packed.n)
    for (const pair of packed.n.split(' ')) {
      const [dy, dx] = pair.split(',');
      y += Number(dy);
      x += Number(dx);
      n.push(y, x);
    }
  /** @type {[number[], Tags][]} */
  const w = packed.w
    ? packed.w.split('|').map((s) => {
        const [t, list] = s.split(':');
        let prev = 0;
        return [list.split(' ').map((d) => (prev += Number(d))), sets[Number(t)]];
      })
    : [];
  /** @type {[number, number, Tags][]} */
  const p = packed.p
    ? packed.p.split('|').map((s) => {
        const [t, at] = s.split(':');
        const [py, px] = at.split(',');
        return [Number(py), Number(px), sets[Number(t)]];
      })
    : [];
  return { v: 1, c: packed.c, r: packed.r, n, w, p };
}

/**
 * Cut an Overpass answer down to a Compact town.
 * @param {{ elements: any[] }} raw
 * @param {number} lat
 * @param {number} lon
 * @param {number} r
 * @returns {Compact}
 */
export function compact(raw, lat, lon, r) {
  /** @type {Map<number, number>} */
  const index = new Map();
  /** @type {number[]} */
  const n = [];
  /** @type {[number[], Tags][]} */
  const w = [];
  /** @type {[number, number, Tags][]} */
  const p = [];
  const step = (/** @type {number} */ v, /** @type {number} */ o) => Math.round((v - o) * 1e5);
  for (const e of raw.elements) {
    if (e.type === 'way' && Array.isArray(e.geometry) && Array.isArray(e.nodes)) {
      /** @type {number[]} */
      const ids = [];
      for (let i = 0; i < e.nodes.length; i++) {
        const g = e.geometry[i];
        if (!g) continue;
        let k = index.get(e.nodes[i]);
        if (k === undefined) {
          k = n.length / 2;
          index.set(e.nodes[i], k);
          n.push(step(g.lat, lat), step(g.lon, lon));
        }
        ids.push(k);
      }
      if (ids.length > 1) w.push([ids, trim(e.tags)]);
    } else {
      const at = e.type === 'node' ? e : e.center;
      if (!at || typeof at.lat !== 'number') continue;
      const t = trim(e.tags);
      if (Object.keys(t).length) p.push([step(at.lat, lat), step(at.lon, lon), t]);
    }
  }
  return { v: 1, c: [lat, lon], r, n, w, p };
}
