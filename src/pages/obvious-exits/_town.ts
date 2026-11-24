// A town for the story: OpenStreetMap ways cut into a walking graph whose nodes are the places you
// can stand (junctions, squares, and stops along long streets) and whose edges are the walks
// between them, with every shop, church, and post box handed to the stop nearest it.

import { classify, nameOf, type Kind, type Tags } from './_words';

export interface Compact {
  v: 1;
  c: [number, number];
  r: number;
  n: number[];
  w: [number[], Tags][];
  p: [number, number, Tags][];
}

export interface Spot {
  id: number;
  name: string | null;
  kind: Kind;
  tags: Tags;
  x: number;
  y: number;
  /** The stop it is at, or -1 when it is only seen from a distance. */
  at: number;
}

export type AreaKind =
  'park' | 'garden' | 'cemetery' | 'water' | 'square' | 'wood' | 'grass' | 'playground' | 'allotments';

export interface Area {
  name: string | null;
  kind: AreaKind;
  ring: number[];
  size: number;
}

export interface Stop {
  id: number;
  x: number;
  y: number;
  edges: number[];
  spots: number[];
  /** The smallest area it stands in, or -1. */
  area: number;
  /** A river or canal within a few metres. */
  water: string | null;
  /** A stop part way along a long street rather than a junction. */
  mid: boolean;
  /** Past the edge of the surveyed town: you can look that way but not go. */
  out: boolean;
  /** A square: the hub of a pedestrian area. */
  square: string | null;
  title: string;
}

export interface Edge {
  id: number;
  a: number;
  b: number;
  len: number;
  /** Polyline from a to b, as x, y pairs. */
  pts: number[];
  name: string | null;
  hw: string;
  bridge: boolean;
  tunnel: boolean;
  surface: string | null;
  lit: boolean;
  /** The water a bridge crosses. */
  over: string | null;
  /** The name of the bridge itself, when it has one. */
  bridgeName: string | null;
}

export interface Water {
  name: string;
  kind: string;
  pts: number[];
}

export interface Town {
  lat: number;
  lon: number;
  r: number;
  stops: Stop[];
  edges: Edge[];
  spots: Spot[];
  areas: Area[];
  waters: Water[];
  start: number;
}

const SKIP_FOOTWAY = new Set(['sidewalk', 'crossing', 'traffic_island', 'access_aisle']);
const SKIP_SERVICE = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access']);
const CLOSED = new Set(['private', 'no']);
const OPEN_FOOT = new Set(['yes', 'designated', 'permissive']);

function walkable(t: Tags): boolean {
  const hw = t.highway;
  if (!hw) return false;
  if (t.area === 'yes' || t.indoor === 'yes') return false;
  if (hw === 'footway' && t.footway && SKIP_FOOTWAY.has(t.footway)) return false;
  if (hw === 'service') {
    if (t.service && SKIP_SERVICE.has(t.service)) return false;
    if (!t.name && t.service !== 'alley') return false;
  }
  if (t.foot === 'no') return false;
  if (t.access && CLOSED.has(t.access) && !(t.foot && OPEN_FOOT.has(t.foot))) return false;
  return true;
}

function areaKind(t: Tags): AreaKind | null {
  if (t.highway === 'pedestrian' || t.place === 'square') return 'square';
  if (t.leisure === 'park' || t.leisure === 'nature_reserve') return 'park';
  if (t.leisure === 'garden') return 'garden';
  if (t.leisure === 'playground') return 'playground';
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'cemetery';
  if (t.natural === 'water') return 'water';
  if (t.natural === 'wood') return 'wood';
  if (t.landuse === 'grass' || t.landuse === 'recreation_ground') return 'grass';
  if (t.landuse === 'allotments') return 'allotments';
  return null;
}

/** Rank of a highway for picking the main road at a junction. */
const RANK: Record<string, number> = {
  primary: 9,
  primary_link: 8,
  secondary: 8,
  secondary_link: 7,
  tertiary: 7,
  tertiary_link: 6,
  unclassified: 5,
  pedestrian: 6,
  residential: 5,
  living_street: 5,
  road: 4,
  service: 3,
  steps: 3,
  footway: 2,
  cycleway: 2,
  path: 1,
  bridleway: 1,
  track: 1,
};
export const rankOf = (hw: string): number => RANK[hw] ?? 0;

function ringArea(r: number[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) s += (r[j] + r[i]) * (r[j + 1] - r[i + 1]);
  return Math.abs(s / 2);
}

export function inside(ring: number[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i];
    const yi = ring[i + 1];
    const xj = ring[j];
    const yj = ring[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Nearest point on a polyline: [distance, arc length along it]. */
export function nearestOn(pts: number[], x: number, y: number): [number, number] {
  let best = Infinity;
  let at = 0;
  let run = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const dx = pts[i + 2] - ax;
    const dy = pts[i + 3] - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const px = ax + t * dx - x;
    const py = ay + t * dy - y;
    const d = Math.hypot(px, py);
    const l = Math.sqrt(l2);
    if (d < best) {
      best = d;
      at = run + t * l;
    }
    run += l;
  }
  return [best, at];
}

function polyLength(pts: number[]): number {
  let s = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) s += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return s;
}

/** Cut a polyline at an arc length: the part before and the part after. */
function cut(pts: number[], at: number): [number[], number[]] {
  let run = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const l = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
    if (run + l >= at) {
      const t = l ? (at - run) / l : 0;
      const x = pts[i] + t * (pts[i + 2] - pts[i]);
      const y = pts[i + 1] + t * (pts[i + 3] - pts[i + 1]);
      return [
        [...pts.slice(0, i + 2), x, y],
        [x, y, ...pts.slice(i + 2)],
      ];
    }
    run += l;
  }
  const n = pts.length;
  return [pts.slice(), [pts[n - 2], pts[n - 1]]];
}

interface Seg {
  to: number;
  way: number;
}

/** Build the town from a compact survey; `begin` names a place to start, when there is a favourite. */
export function buildTown(c: Compact, begin?: string): Town {
  const [lat, lon] = c.c;
  const kx = 1e-5 * Math.cos((lat * Math.PI) / 180) * 111320;
  const ky = 1e-5 * 110574;
  const nodeCount = c.n.length / 2;
  const X = new Float64Array(nodeCount + c.w.length);
  const Y = new Float64Array(nodeCount + c.w.length);
  for (let i = 0; i < nodeCount; i++) {
    X[i] = c.n[2 * i + 1] * kx;
    Y[i] = c.n[2 * i] * ky;
  }
  const ringOf = (ids: number[]) => {
    const r: number[] = [];
    for (const k of ids) r.push(X[k], Y[k]);
    return r;
  };

  // Ways the walker can use, areas for context, and water for bridges and banks.
  const ways = c.w;
  const adj: Seg[][] = Array.from({ length: X.length }, () => []);
  const link = (a: number, b: number, way: number) => {
    if (a === b || adj[a].some((s) => s.to === b)) return;
    adj[a].push({ to: b, way });
    adj[b].push({ to: a, way });
  };
  const areas: Area[] = [];
  const waters: Water[] = [];
  const squares: number[] = [];
  const squareWays = new Set<number>();
  ways.forEach(([ids, t], wi) => {
    if (walkable(t)) for (let i = 1; i < ids.length; i++) link(ids[i - 1], ids[i], wi);
    const closed = ids.length > 3 && ids[0] === ids[ids.length - 1];
    const ak = closed ? areaKind(t) : null;
    if (ak && (ak !== 'square' || t.area === 'yes' || t.place === 'square')) {
      const ring = ringOf(ids);
      areas.push({ name: nameOf(t), kind: ak, ring, size: ringArea(ring) });
      if (ak === 'square' && t.highway === 'pedestrian') {
        squares.push(wi);
        squareWays.add(wi);
      }
    }
    if (t.waterway && t.name) waters.push({ name: nameOf(t)!, kind: t.waterway, pts: ringOf(ids) });
  });

  // A pedestrian square becomes one place to stand: a hub at its middle, joined to every point on
  // its edge where a street or path comes in.
  const hubName = new Map<number, string | null>();
  squares.forEach((wi, h) => {
    const ids = ways[wi][0];
    const hub = nodeCount + h;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < ids.length - 1; i++) {
      sx += X[ids[i]];
      sy += Y[ids[i]];
    }
    X[hub] = sx / (ids.length - 1);
    Y[hub] = sy / (ids.length - 1);
    const entries = new Set(ids.filter((k) => adj[k].length > 0));
    for (const k of entries) link(hub, k, wi);
    hubName.set(hub, nameOf(ways[wi][1]));
  });

  // Find the separate networks. Where sidewalks are mapped as their own ways (and dropped here),
  // the paths in a park or square can be left as an island; join each island to the main network
  // where they come within a few metres, as stepping off the path onto the street.
  const label = new Int32Array(X.length).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < X.length; i++) {
    if (!adj[i].length || label[i] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    const queue = [i];
    label[i] = id;
    while (queue.length) {
      const v = queue.pop()!;
      n++;
      for (const sg of adj[v])
        if (label[sg.to] < 0) {
          label[sg.to] = id;
          queue.push(sg.to);
        }
    }
    sizes.push(n);
  }
  let mainId = -1;
  for (let i = 0; i < X.length; i++) {
    if (label[i] < 0 || Math.hypot(X[i], Y[i]) > 250) continue;
    if (mainId < 0 || sizes[label[i]] > sizes[mainId]) mainId = label[i];
  }
  if (mainId < 0) mainId = sizes.indexOf(Math.max(...sizes));
  const SNAP = 25;
  for (let pass = 0; pass < 3; pass++) {
    const grid = new Map<string, number[]>();
    const cell = (x: number, y: number) => `${Math.floor(x / SNAP)},${Math.floor(y / SNAP)}`;
    for (let i = 0; i < X.length; i++)
      if (label[i] === mainId) {
        const k = cell(X[i], Y[i]);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k)!.push(i);
      }
    const best = new Map<number, [number, number, number]>();
    for (let i = 0; i < X.length; i++) {
      const l = label[i];
      if (l < 0 || l === mainId) continue;
      const cx = Math.floor(X[i] / SNAP);
      const cy = Math.floor(Y[i] / SNAP);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            const d = Math.hypot(X[i] - X[j], Y[i] - Y[j]);
            if (d < SNAP && d < (best.get(l)?.[0] ?? Infinity)) best.set(l, [d, i, j]);
          }
    }
    if (!best.size) break;
    for (const [l, [, i, j]] of best) {
      link(i, j, adj[i][0].way);
      for (let k = 0; k < X.length; k++) if (label[k] === l) label[k] = mainId;
    }
  }
  const keep = new Uint8Array(X.length);
  for (let i = 0; i < X.length; i++) if (label[i] === mainId) keep[i] = 1;

  const wayName = (wi: number) => nameOf(ways[wi][1]);
  // Junctions: anywhere the graph branches or ends, a square's hub, or where a named street
  // turns into another named street.
  const key = new Uint8Array(X.length);
  for (let i = 0; i < X.length; i++) {
    if (!keep[i]) continue;
    const s = adj[i];
    if (s.length !== 2 || hubName.has(i)) key[i] = 1;
    else if (!squareWays.has(s[0].way) && !squareWays.has(s[1].way)) {
      const a = wayName(s[0].way);
      const b = wayName(s[1].way);
      if (a && b && a !== b) key[i] = 1;
    }
  }

  // Junctions a few metres apart (two sides of a dual road, a staggered crossing) are one place.
  const parent = new Int32Array(X.length).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  // Only road junctions merge (the two halves of a dual carriageway, a staggered crossroads); in a
  // dense web of alleys every junction stays its own place. A group never grows past a few metres.
  const MERGE = 14;
  const ROADS = /^(primary|secondary|tertiary|unclassified|residential|living_street|road|service)/;
  const groupSize = new Int32Array(X.length).fill(1);
  for (let i = 0; i < X.length; i++) {
    if (!key[i] || hubName.has(i)) continue;
    for (const sg of adj[i]) {
      // Any two junctions this close are one place; road junctions merge from further apart.
      const reach = ROADS.test(ways[sg.way][1].highway ?? '') ? MERGE : 8;
      let prev = i;
      let cur = sg.to;
      let run = Math.hypot(X[cur] - X[i], Y[cur] - Y[i]);
      while (!key[cur] && run < reach) {
        const next = adj[cur].find((t) => t.to !== prev);
        if (!next) break;
        run += Math.hypot(X[next.to] - X[cur], Y[next.to] - Y[cur]);
        prev = cur;
        cur = next.to;
      }
      if (!key[cur] || run >= reach || hubName.has(cur)) continue;
      const a = find(i);
      const b = find(cur);
      if (a === b || groupSize[a] + groupSize[b] > 4) continue;
      parent[b] = a;
      groupSize[a] += groupSize[b];
    }
  }

  // A square is one place: its hub and every point on its edge where a way comes in.
  for (let i = 0; i < X.length; i++) {
    if (!hubName.has(i) || !keep[i]) continue;
    for (const sg of adj[i]) {
      key[sg.to] = 1;
      const a = find(i);
      const b = find(sg.to);
      if (a !== b) parent[b] = a;
    }
  }

  // Trace the walks between junction groups.
  interface Raw {
    a: number;
    b: number;
    pts: number[];
    ways: Map<number, number>;
    bridge: boolean;
    tunnel: boolean;
  }
  const raws: Raw[] = [];
  const used = new Set<string>();
  const segKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (let i = 0; i < X.length; i++) {
    if (!key[i]) continue;
    for (const s of adj[i]) {
      if (used.has(segKey(i, s.to))) continue;
      const pts = [X[i], Y[i]];
      const wlen = new Map<number, number>();
      let bridge = false;
      let tunnel = false;
      let prev = i;
      let cur = s.to;
      let way = s.way;
      for (;;) {
        used.add(segKey(prev, cur));
        const l = Math.hypot(X[cur] - X[prev], Y[cur] - Y[prev]);
        wlen.set(way, (wlen.get(way) ?? 0) + l);
        const t = ways[way][1];
        if (t.bridge && t.bridge !== 'no') bridge = true;
        if (t.tunnel && t.tunnel !== 'no') tunnel = true;
        pts.push(X[cur], Y[cur]);
        if (key[cur]) break;
        const next = adj[cur].find((t2) => t2.to !== prev);
        if (!next) break;
        prev = cur;
        cur = next.to;
        way = next.way;
      }
      const a = find(i);
      const b = find(cur);
      if (a === b) continue;
      raws.push({ a, b, pts, ways: wlen, bridge, tunnel });
    }
  }

  // One stop per junction group, at the group's middle.
  const stopOf = new Map<number, number>();
  const stops: Stop[] = [];
  const members = new Map<number, number[]>();
  for (let i = 0; i < X.length; i++) {
    if (!key[i]) continue;
    const g = find(i);
    if (!members.has(g)) members.set(g, []);
    members.get(g)!.push(i);
  }
  const newStop = (x: number, y: number, mid: boolean, square: string | null): number => {
    const id = stops.length;
    stops.push({ id, x, y, edges: [], spots: [], area: -1, water: null, mid, out: false, square, title: '' });
    return id;
  };
  for (const [g, list] of members) {
    let sx = 0;
    let sy = 0;
    for (const k of list) {
      sx += X[k];
      sy += Y[k];
    }
    const hub = list.find((k) => hubName.has(k));
    const sq = hub !== undefined ? (hubName.get(hub) ?? 'Square') : null;
    stopOf.set(
      g,
      newStop(hub !== undefined ? X[hub] : sx / list.length, hub !== undefined ? Y[hub] : sy / list.length, false, sq),
    );
  }

  const edges: Edge[] = [];
  const seen = new Map<string, number>();
  const addEdge = (
    a: number,
    b: number,
    pts: number[],
    proto: Omit<Edge, 'id' | 'a' | 'b' | 'pts' | 'len'>,
  ): number => {
    const id = edges.length;
    edges.push({ ...proto, id, a, b, pts, len: polyLength(pts) });
    stops[a].edges.push(id);
    stops[b].edges.push(id);
    return id;
  };
  for (const r of raws) {
    const a = stopOf.get(r.a)!;
    const b = stopOf.get(r.b)!;
    // The way that carries most of the walk names it.
    // A square's own links only name a walk when there is nothing else to name it by.
    let main = -1;
    let most = -1;
    for (const [w, l] of r.ways) {
      if (squareWays.has(w)) continue;
      const named = wayName(w) ? 1000 : 0;
      if (l + named > most) {
        most = l + named;
        main = w;
      }
    }
    const acrossSquare = main < 0;
    if (acrossSquare) main = r.ways.keys().next().value!;
    const t = ways[main][1];
    const proto: Omit<Edge, 'id' | 'a' | 'b' | 'pts' | 'len'> = {
      name: acrossSquare ? null : wayName(main),
      hw: t.highway === 'pedestrian' && t.area === 'yes' ? 'pedestrian' : (t.highway ?? 'footway'),
      bridge: r.bridge,
      tunnel: r.tunnel,
      surface: t.surface ?? null,
      lit: t.lit === 'yes',
      over: null,
      bridgeName: null,
    };
    // The stops sit at group middles; start and end the line there.
    const pts = [stops[a].x, stops[a].y, ...r.pts.slice(2, -2), stops[b].x, stops[b].y];
    const k = segKey(a, b);
    const prior = seen.get(k);
    if (prior !== undefined) {
      // Two ways between the same pair of stops: keep the shorter unless they go by different names.
      const e = edges[prior];
      const len = polyLength(pts);
      if (e.name === proto.name || len > e.len * 0.6) {
        if (len < e.len && e.name === proto.name) Object.assign(e, { pts: a === e.a ? pts : reverse(pts), len });
        continue;
      }
    }
    for (const [w] of r.ways) {
      const bt = ways[w][1];
      if (
        bt.bridge &&
        bt.bridge !== 'no' &&
        (bt['bridge:name'] || (bt.name && /bridge|ponte|pont|puente|bro\b|brücke/i.test(bt.name)))
      )
        proto.bridgeName = bt['bridge:name'] ?? bt.name;
    }
    seen.set(k, addEdge(a, b, pts, proto));
  }

  // Past the survey's edge: those stops can be looked at but not reached.
  const limit = c.r + 30;
  for (const s of stops) if (Math.hypot(s.x, s.y) > limit) s.out = true;

  // Long walks get stops along the way, so a long street can be walked a stretch at a time.
  const SPLIT = 125;
  const STEP = 90;
  for (const e of [...edges]) {
    if (e.len <= SPLIT || stops[e.a].out || stops[e.b].out) continue;
    const pieces = Math.ceil(e.len / STEP);
    const each = e.len / pieces;
    let rest = e.pts;
    let from = e.a;
    const end = e.b;
    const proto = {
      name: e.name,
      hw: e.hw,
      bridge: e.bridge,
      tunnel: e.tunnel,
      surface: e.surface,
      lit: e.lit,
      over: null,
      bridgeName: e.bridgeName,
    };
    // Reuse the original edge for the first piece.
    stops[end].edges = stops[end].edges.filter((id) => id !== e.id);
    for (let p = 1; p < pieces; p++) {
      const [head, tail] = cut(rest, each);
      const m = newStop(head[head.length - 2], head[head.length - 1], true, null);
      if (p === 1) {
        e.b = m;
        e.pts = head;
        e.len = polyLength(head);
        stops[m].edges.push(e.id);
      } else addEdge(from, m, head, proto);
      from = m;
      rest = tail;
    }
    addEdge(from, end, rest, proto);
  }

  // Drop the network beyond the edge, except the first step out of town, and anything that can
  // no longer be reached from the middle.
  const other = (e: Edge, s: number) => (e.a === s ? e.b : e.a);
  let start = -1;
  let best = Infinity;
  for (const s of stops) {
    if (s.out || s.mid) continue;
    if (s.edges.length < 2) continue;
    const d =
      Math.hypot(s.x, s.y) -
      (s.square && s.edges.length > 2 ? 30 : 0) -
      Math.min(s.edges.length, 5) * 6 -
      Math.min(s.spots.length, 8) * 3;
    if (d < best) {
      best = d;
      start = s.id;
    }
  }
  const reach = new Uint8Array(stops.length);
  if (start >= 0) {
    const q = [start];
    reach[start] = 1;
    while (q.length) {
      const s = q.pop()!;
      if (stops[s].out) continue;
      for (const id of stops[s].edges) {
        const t = other(edges[id], s);
        if (!reach[t]) {
          reach[t] = 1;
          q.push(t);
        }
      }
    }
  }
  const alive = edges.map((e) => reach[e.a] && reach[e.b] && !(stops[e.a].out && stops[e.b].out));
  // Short unnamed dead ends (a few metres of path to a gate) are noise; trim them twice.
  for (let pass = 0; pass < 2; pass++) {
    for (const s of stops) {
      if (s.out || s.id === start) continue;
      const live = s.edges.filter((id) => alive[id]);
      if (live.length !== 1) continue;
      const e = edges[live[0]];
      if (!e.name && e.len < 30 && !s.square) alive[e.id] = false;
    }
  }

  // Renumber what survives.
  const keepStop = stops.map((s) => reach[s.id] === 1 && s.edges.some((id) => alive[id]));
  const newId = new Int32Array(stops.length).fill(-1);
  const outStops: Stop[] = [];
  stops.forEach((s, i) => {
    if (!keepStop[i]) return;
    newId[i] = outStops.length;
    outStops.push({ ...s, id: outStops.length, edges: [] });
  });
  const outEdges: Edge[] = [];
  edges.forEach((e) => {
    if (!alive[e.id] || newId[e.a] < 0 || newId[e.b] < 0) return;
    const id = outEdges.length;
    const ne = { ...e, id, a: newId[e.a], b: newId[e.b] };
    outEdges.push(ne);
    outStops[ne.a].edges.push(id);
    outStops[ne.b].edges.push(id);
  });
  start = start >= 0 ? newId[start] : 0;

  // Context: the area each stop stands in, and water beside it.
  for (const s of outStops) {
    let size = Infinity;
    areas.forEach((a, i) => {
      if (a.size < size && a.kind !== 'water' && inside(a.ring, s.x, s.y)) {
        size = a.size;
        s.area = i;
      }
    });
    let wd = 28;
    for (const w of waters) {
      const [d] = nearestOn(w.pts, s.x, s.y);
      if (d < wd) {
        wd = d;
        s.water = w.name;
      }
    }
  }
  for (const e of outEdges) {
    if (!e.bridge) continue;
    const n = e.pts.length / 2;
    const mx = e.pts[2 * Math.floor(n / 2)];
    const my = e.pts[2 * Math.floor(n / 2) + 1];
    let wd = 45;
    for (const w of waters) {
      const [d] = nearestOn(w.pts, mx, my);
      if (d < wd) {
        wd = d;
        e.over = w.name;
      }
    }
  }

  // Every named place, handed to the stop nearest it along the street.
  const spots: Spot[] = [];
  for (const [dy, dx, t] of c.p) {
    const kind = classify(t);
    if (!kind) continue;
    const x = dx * kx;
    const y = dy * ky;
    const name = nameOf(t);
    if (!name && kind.weight < 2 && kind.group !== 'thing') continue;
    if (kind.group === 'thing' && kind.weight === 0 && t.amenity !== 'bench') continue;
    let bd = 55;
    let be = -1;
    let ba = 0;
    for (const e of outEdges) {
      if (outStops[e.a].out && outStops[e.b].out) continue;
      const [d, at] = nearestOn(e.pts, x, y);
      if (d < bd) {
        bd = d;
        be = e.id;
        ba = at;
      }
    }
    let at = -1;
    if (be >= 0) {
      const e = outEdges[be];
      const near = ba < e.len / 2 ? e.a : e.b;
      at = outStops[near].out ? (near === e.a ? e.b : e.a) : near;
    }
    const id = spots.length;
    spots.push({ id, name, kind, tags: t, x, y, at });
    if (at >= 0) outStops[at].spots.push(id);
  }

  // Start somewhere central and busy: a junction or square near the middle with shops round it.
  let startScore = Infinity;
  for (const s of outStops) {
    if (s.out || s.mid || s.edges.length < 2) continue;
    const d =
      Math.hypot(s.x, s.y) -
      (s.square && s.edges.length > 2 ? 30 : 0) -
      Math.min(s.edges.length, 5) * 6 -
      Math.min(s.spots.length, 8) * 4;
    if (d < startScore) {
      startScore = d;
      start = s.id;
    }
  }

  const town: Town = { lat, lon, r: c.r, stops: outStops, edges: outEdges, spots, areas, waters, start };
  for (const s of outStops) s.title = baseTitle(town, s);
  dedupeTitles(town);
  if (begin) {
    const named = outStops
      .filter((s) => !s.out && s.title.startsWith(begin))
      .sort((p, q) => q.edges.length - p.edges.length);
    if (named.length) town.start = named[0].id;
  }
  return town;
}

function reverse(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}

/** Street names at a stop, main road first. */
export function streetsAt(town: Town, s: Stop): string[] {
  const named = s.edges
    .map((id) => town.edges[id])
    .filter((e) => e.name)
    .sort((p, q) => rankOf(q.hw) - rankOf(p.hw) || q.len - p.len);
  const names = [...new Set(named.map((e) => e.name!))];
  // "East York Street" and "West York Street" meeting at a corner are one street.
  const half = /^(East|West|North|South) /;
  return [
    ...new Set(
      names.map((n) => {
        const base = n.replace(half, '');
        return base !== n && names.some((o) => o !== n && o.replace(half, '') === base) ? base : n;
      }),
    ),
  ];
}

const PATHLIKE: Record<string, string> = {
  footway: 'Footpath',
  path: 'Footpath',
  steps: 'Steps',
  service: 'Alley',
  track: 'Track',
  cycleway: 'Cycle path',
  bridleway: 'Bridleway',
  pedestrian: 'Passage',
};

function baseTitle(town: Town, s: Stop): string {
  if (s.square) return s.square;
  const area = s.area >= 0 ? town.areas[s.area] : null;
  const names = streetsAt(town, s);
  const degree = s.edges.length;
  if (!names.length) {
    if (area?.name && area.kind !== 'square') return area.name;
    const main = s.edges.map((id) => town.edges[id]).sort((p, q) => rankOf(q.hw) - rankOf(p.hw))[0];
    const base = PATHLIKE[main?.hw ?? 'footway'] ?? 'Lane';
    if (main?.bridge && main.over) return `Bridge over the ${main.over.replace(/^the /i, '')}`;
    return base;
  }
  if (names.length === 1) {
    if (degree === 1 && !s.mid) return `End of ${names[0]}`;
    if (area?.name && area.kind === 'square' && area.name !== names[0]) return `${names[0]}, ${area.name}`;
    return names[0];
  }
  if (names.length === 2) return `Corner of ${names[0]} and ${names[1]}`;
  return `Where ${names[0]}, ${names[1]} and ${names[2]} meet`;
}

const COMPASS8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Make every title unique: a landmark beside it, then which end of the street it is. */
function dedupeTitles(town: Town): void {
  const groups = new Map<string, Stop[]>();
  for (const s of town.stops) {
    if (!groups.has(s.title)) groups.set(s.title, []);
    groups.get(s.title)!.push(s);
  }
  for (const [title, list] of groups) {
    if (list.length < 2) continue;
    const taken = new Set<string>();
    const free = (l: string) => !taken.has(l) && !groups.has(l);
    for (const s of list) {
      let label = '';
      // A landmark at the stop itself.
      const here = s.spots
        .map((id) => town.spots[id])
        .filter((sp) => sp.name && sp.kind.weight >= 2 && sp.name !== title)
        .sort((p, q) => q.kind.weight - p.kind.weight);
      for (const sp of here) {
        if (free(`${title}, outside ${sp.name}`)) {
          label = `${title}, outside ${sp.name}`;
          break;
        }
      }
      // Then something named close by, or the street it runs off.
      if (!label) {
        const near = town.spots
          .filter((sp) => sp.name && sp.name !== title && sp.kind.weight >= 2)
          .map((sp) => ({ sp, d: Math.hypot(sp.x - s.x, sp.y - s.y) }))
          .filter((o) => o.d < 90)
          .sort((p, q) => p.d - q.d);
        for (const { sp } of near) {
          if (free(`${title} near ${sp.name}`)) {
            label = `${title} near ${sp.name}`;
            break;
          }
        }
      }
      if (!label) {
        let bd = 60;
        let street = '';
        for (const e of town.edges) {
          if (!e.name || e.name === title || s.edges.includes(e.id)) continue;
          const [d] = nearestOn(e.pts, s.x, s.y);
          if (d < bd) {
            bd = d;
            street = e.name;
          }
        }
        if (street && free(`${title} off ${street}`)) label = `${title} off ${street}`;
      }
      if (!label) {
        let cx = 0;
        let cy = 0;
        for (const o of list) {
          cx += o.x;
          cy += o.y;
        }
        cx /= list.length;
        cy /= list.length;
        const ang = Math.atan2(s.x - cx, s.y - cy);
        const dir = COMPASS8[(Math.round(ang / (Math.PI / 4)) + 8) % 8];
        label = `${title}, ${dir} end`;
        let n = 2;
        while (!free(label)) label = `${title}, ${dir} end (${n++})`;
      }
      taken.add(label);
      s.title = label;
    }
  }
}

/** Bearing in degrees clockwise from north of a walk as it leaves a stop. */
export function leaving(town: Town, e: Edge, from: number): number {
  const pts = e.a === from ? e.pts : reverse(e.pts);
  const x0 = pts[0];
  const y0 = pts[1];
  let run = 0;
  for (let i = 2; i < pts.length; i += 2) {
    run += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (run >= 22 || i === pts.length - 2) {
      return ((Math.atan2(pts[i] - x0, pts[i + 1] - y0) * 180) / Math.PI + 360) % 360;
    }
  }
  const s = town.stops[from];
  const o = town.stops[e.a === from ? e.b : e.a];
  return ((Math.atan2(o.x - s.x, o.y - s.y) * 180) / Math.PI + 360) % 360;
}

/** Shortest walking distance from one stop to every other. */
export function distances(town: Town, from: number): Float64Array {
  const d = new Float64Array(town.stops.length).fill(Infinity);
  d[from] = 0;
  const done = new Uint8Array(town.stops.length);
  // The towns are small enough for a plain O(n²) Dijkstra.
  for (;;) {
    let v = -1;
    let bd = Infinity;
    for (let i = 0; i < d.length; i++)
      if (!done[i] && d[i] < bd) {
        bd = d[i];
        v = i;
      }
    if (v < 0) break;
    done[v] = 1;
    if (town.stops[v].out) continue;
    for (const id of town.stops[v].edges) {
      const e = town.edges[id];
      const o = e.a === v ? e.b : e.a;
      if (d[v] + e.len < d[o]) d[o] = d[v] + e.len;
    }
  }
  return d;
}
