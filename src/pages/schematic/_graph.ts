// From a network of routes to the graph the layout works on: stations joined by track sections,
// express runs folded into the stopping line, and runs of plain stations contracted into chains
// between key stations (junctions, ends, interchanges), which are what the layout moves.

import type { Network } from './_osm';

export interface Chain {
  /** Key indexes at either end. */
  a: number;
  b: number;
  /** Interior station indexes, in order from a to b. */
  inner: number[];
  /** Line indexes running along the chain, ascending. */
  lines: number[];
  /** A walking connection between two stations of different names, with no line on it. */
  transfer?: boolean;
}

export interface Graph {
  names: string[];
  /** Station positions in kilometres, x east and y south, about the network's centre. */
  geo: Float64Array;
  /** Line indexes serving each station. */
  served: number[][];
  /** Station index of each key. */
  keys: number[];
  /** Key index of each station, or -1. */
  keyOf: Int32Array;
  /** 1 for stations joined to another by a walking transfer. */
  walk: Uint8Array;
  chains: Chain[];
  /** Median distance between neighbouring stations, km. */
  spacing: number;
  /** Bounds of the stations in km: minX, minY, maxX, maxY. */
  bounds: [number, number, number, number];
}

interface Edge {
  a: number;
  b: number;
  lines: Set<number>;
}

const edgeKey = (a: number, b: number) => (a < b ? a * 65536 + b : b * 65536 + a);

export function buildGraph(net: Network): Graph {
  const n = net.stations.length;
  let lat0 = 0;
  let lon0 = 0;
  for (const [, lat, lon] of net.stations) {
    lat0 += lat / n;
    lon0 += lon / n;
  }
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110.574;
  const geo = new Float64Array(n * 2);
  net.stations.forEach(([, lat, lon], i) => {
    geo[i * 2] = (lon - lon0) * kx;
    geo[i * 2 + 1] = -(lat - lat0) * ky;
  });
  const dist = (a: number, b: number) => Math.hypot(geo[a * 2] - geo[b * 2], geo[a * 2 + 1] - geo[b * 2 + 1]);

  // Track sections between consecutive calls.
  const edges = new Map<number, Edge>();
  net.lines.forEach((line, li) => {
    for (const route of line.routes) {
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1];
        const b = route[i];
        if (a === b) continue;
        const k = edgeKey(a, b);
        let e = edges.get(k);
        if (!e) {
          e = { a: Math.min(a, b), b: Math.max(a, b), lines: new Set() };
          edges.set(k, e);
        }
        e.lines.add(li);
      }
    }
  });

  // Fold express runs: a line's section a-b is dropped when the same line also reaches b from a
  // through stations in between, by a path not much longer than the direct one.
  const adjacencyFor = (li: number) => {
    const adj = new Map<number, number[]>();
    for (const e of edges.values()) {
      if (!e.lines.has(li)) continue;
      (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
      (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
    }
    return adj;
  };
  for (let li = 0; li < net.lines.length; li++) {
    const adj = adjacencyFor(li);
    const drop: Edge[] = [];
    for (const e of edges.values()) {
      if (!e.lines.has(li)) continue;
      const direct = dist(e.a, e.b);
      const limit = direct * 1.6 + 0.3;
      // Bounded depth-first search for another way round.
      const stack: [number, number, number][] = [[e.a, 0, 0]];
      const best = new Map<number, number>();
      let found = false;
      while (stack.length && !found) {
        const [u, len, depth] = stack.pop()!;
        if (depth > 12) continue;
        for (const v of adj.get(u) ?? []) {
          if (u === e.a && v === e.b) continue;
          if (u === e.b && v === e.a) continue;
          const l = len + dist(u, v);
          if (l > limit) continue;
          if (v === e.b) {
            if (depth >= 1) found = true;
            continue;
          }
          if ((best.get(v) ?? Infinity) <= l) continue;
          best.set(v, l);
          stack.push([v, l, depth + 1]);
        }
      }
      if (found) drop.push(e);
    }
    for (const e of drop) e.lines.delete(li);
  }
  for (const [k, e] of edges) if (e.lines.size === 0) edges.delete(k);

  // Adjacency over what is left.
  const nbrs: number[][] = Array.from({ length: n }, () => []);
  const edgeLines = new Map<number, number[]>();
  for (const e of edges.values()) {
    nbrs[e.a].push(e.b);
    nbrs[e.b].push(e.a);
    edgeLines.set(edgeKey(e.a, e.b), [...e.lines].sort((x, y) => x - y));
  }
  const linesOf = (a: number, b: number) => edgeLines.get(edgeKey(a, b)) ?? [];
  const sameLines = (p: number[], q: number[]) => p.length === q.length && p.every((x, i) => x === q[i]);

  // Key stations: ends, junctions, and stations where the set of lines changes.
  const isKey = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = nbrs[i].length;
    if (d === 0) continue;
    if (d !== 2) isKey[i] = 1;
    else if (!sameLines(linesOf(i, nbrs[i][0]), linesOf(i, nbrs[i][1]))) isKey[i] = 1;
  }

  // Walking transfers: stations a short walk apart, under different names, on lines that don't meet
  // there. Many systems name each line's platforms separately at one interchange.
  const lineSets: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (const e of edges.values())
    for (const li of e.lines) {
      lineSets[e.a].add(li);
      lineSets[e.b].add(li);
    }
  const transfers: [number, number][] = [];
  const walkMark = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!nbrs[i].length) continue;
    for (let j = i + 1; j < n; j++) {
      if (!nbrs[j].length || dist(i, j) > 0.22) continue;
      if ([...lineSets[i]].some((li) => lineSets[j].has(li))) continue;
      transfers.push([i, j]);
      walkMark[i] = 1;
      walkMark[j] = 1;
      isKey[i] = 1;
      isKey[j] = 1;
    }
  }

  // Walk chains from every key; a loop with no key gets one.
  const walk = (start: number, first: number) => {
    const inner: number[] = [];
    let prev = start;
    let cur = first;
    while (!isKey[cur]) {
      inner.push(cur);
      const next = nbrs[cur][0] === prev ? nbrs[cur][1] : nbrs[cur][0];
      prev = cur;
      cur = next;
      if ((cur === start && !isKey[start]) || inner.length > nbrs.length) break;
    }
    return { inner, end: cur };
  };

  const geoDeviation = (a: number, b: number, inner: number[]) => {
    const ax = geo[a * 2];
    const ay = geo[a * 2 + 1];
    const dx = geo[b * 2] - ax;
    const dy = geo[b * 2 + 1] - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let best = -1;
    let worst = 0;
    inner.forEach((s, i) => {
      const px = geo[s * 2] - ax;
      const py = geo[s * 2 + 1] - ay;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (len * len)));
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > worst) {
        worst = d;
        best = i;
      }
    });
    return { index: best, deviation: worst, length: len };
  };

  // Repeat until chains are well formed: no self loops, no two chains joining the same pair,
  // and no chain whose stations stray far from the straight line between its ends.
  let chains: { a: number; b: number; inner: number[] }[] = [];
  for (let pass = 0; pass < 40; pass++) {
    // Loops with no key at all.
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (isKey[i]) seen[i] = 1;
    for (let i = 0; i < n; i++) {
      if (seen[i] || nbrs[i].length === 0) continue;
      // Mark the whole component; if no key reached, make this one a key.
      const stack = [i];
      let hasKey = false;
      const comp: number[] = [];
      seen[i] = 1;
      while (stack.length) {
        const u = stack.pop()!;
        comp.push(u);
        for (const v of nbrs[u]) {
          if (isKey[v]) hasKey = true;
          else if (!seen[v]) {
            seen[v] = 1;
            stack.push(v);
          }
        }
      }
      if (!hasKey) isKey[comp[0]] = 1;
    }

    chains = [];
    const done = new Set<string>();
    for (let s = 0; s < n; s++) {
      if (!isKey[s]) continue;
      for (const f of nbrs[s]) {
        const { inner, end } = walk(s, f);
        const tag = inner.length
          ? [s, end].sort((x, y) => x - y).join('-') + ':' + [...inner].sort((x, y) => x - y).join(',')
          : [s, end].sort((x, y) => x - y).join('-');
        if (done.has(tag)) continue;
        done.add(tag);
        chains.push({ a: s, b: end, inner });
      }
    }

    let changed = false;
    const pairs = new Map<string, number>();
    for (const c of chains) {
      if (c.a === c.b) {
        // A loop back to its own key: split it at its middle.
        if (c.inner.length) {
          isKey[c.inner[Math.floor(c.inner.length / 2)]] = 1;
          changed = true;
        }
        continue;
      }
      const pk = c.a < c.b ? `${c.a}-${c.b}` : `${c.b}-${c.a}`;
      const prev = pairs.get(pk);
      if (prev !== undefined) {
        const other = chains[prev];
        const victim = c.inner.length >= other.inner.length ? c : other;
        if (victim.inner.length) {
          isKey[victim.inner[Math.floor(victim.inner.length / 2)]] = 1;
          changed = true;
        }
      } else pairs.set(pk, chains.indexOf(c));
      // Long or bent chains get a key where they bend most, so the drawing can follow them.
      if (c.inner.length >= 2) {
        const { index, deviation, length } = geoDeviation(c.a, c.b, c.inner);
        if (index >= 0 && (deviation > Math.max(0.35, length * 0.2) || c.inner.length > 14)) {
          const at = c.inner.length > 14 && deviation <= Math.max(0.35, length * 0.2) ? c.inner.length >> 1 : index;
          isKey[c.inner[at]] = 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const keys: number[] = [];
  const keyOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++)
    if (isKey[i] && nbrs[i].length) {
      keyOf[i] = keys.length;
      keys.push(i);
    }

  const out: Chain[] = chains
    .filter((c) => c.a !== c.b)
    .map((c) => ({
      a: keyOf[c.a],
      b: keyOf[c.b],
      inner: c.inner,
      lines: linesOf(c.a, c.inner.length ? c.inner[0] : c.b),
    }));
  for (const [i, j] of transfers) out.push({ a: keyOf[i], b: keyOf[j], inner: [], lines: [], transfer: true });

  const served: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges.values()) {
    for (const li of e.lines) {
      if (!served[e.a].includes(li)) served[e.a].push(li);
      if (!served[e.b].includes(li)) served[e.b].push(li);
    }
  }
  served.forEach((s) => s.sort((x, y) => x - y));

  const gaps: number[] = [];
  for (const e of edges.values()) gaps.push(dist(e.a, e.b));
  gaps.sort((x, y) => x - y);
  const spacing = gaps.length ? gaps[gaps.length >> 1] : 1;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!nbrs[i].length) continue;
    minX = Math.min(minX, geo[i * 2]);
    maxX = Math.max(maxX, geo[i * 2]);
    minY = Math.min(minY, geo[i * 2 + 1]);
    maxY = Math.max(maxY, geo[i * 2 + 1]);
  }

  return {
    names: net.stations.map((s) => s[0]),
    geo,
    served,
    keys,
    keyOf,
    walk: walkMark,
    chains: out,
    spacing,
    bounds: [minX, minY, maxX, maxY],
  };
}
