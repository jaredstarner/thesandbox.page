// The engineer's answer: the minimum spanning tree over the oats, by Prim's
// algorithm. Straight lines only, and no junctions away from an oat.

import type { Food } from './_plate';

export interface Edge {
  a: Food;
  b: Food;
  length: number;
}

export function spanningTree(points: Food[]): Edge[] {
  const n = points.length;
  if (n < 2) return [];
  const inTree = new Uint8Array(n);
  const best = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const edges: Edge[] = [];
  best[0] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i]! < best[u]!)) u = i;
    inTree[u] = 1;
    if (from[u]! >= 0) edges.push({ a: points[from[u]!]!, b: points[u]!, length: best[u]! });
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = Math.hypot(points[u]!.x - points[v]!.x, points[u]!.y - points[v]!.y);
      if (d < best[v]!) {
        best[v] = d;
        from[v] = u;
      }
    }
  }
  return edges;
}
