// Between the graph and the layout: put the stations in layout units, and give the layout a start
// where the crowded centre has been opened out. Each station keeps its bearing from the centre, but
// its distance is remapped so stations are about as dense downtown as in the suburbs, which is the
// first liberty every metro diagram takes.

import type { Graph } from './_graph';
import type { LayoutChain } from './_layout';

export interface Prepared {
  /** Every station's true position, in layout units. */
  truth: Float64Array;
  /** Every station's position after the centre is opened out, in layout units. */
  opened: Float64Array;
  /** Key positions after opening, the layout's start and anchor. */
  keyStart: Float64Array;
  chains: LayoutChain[];
  /** Layout units per kilometre of true geography. */
  unitsPerKm: number;
}

const MIX = 0.7;

export function prepare(g: Graph): Prepared {
  const n = g.names.length;
  const live: number[] = [];
  for (let i = 0; i < n; i++) if (g.served[i].length) live.push(i);

  // Centre: the median station.
  const xs = live.map((i) => g.geo[i * 2]).sort((a, b) => a - b);
  const ys = live.map((i) => g.geo[i * 2 + 1]).sort((a, b) => a - b);
  const cx = xs[xs.length >> 1] ?? 0;
  const cy = ys[ys.length >> 1] ?? 0;

  const radius = (i: number) => Math.hypot(g.geo[i * 2] - cx, g.geo[i * 2 + 1] - cy);
  const sorted = live.map(radius).sort((a, b) => a - b);
  const rMed = sorted[sorted.length >> 1] || 1;
  // Fraction of stations within r, by interpolation over the sorted radii.
  const frac = (r: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(1, (lo + 0.5) / sorted.length);
  };

  const openedKm = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const dx = g.geo[i * 2] - cx;
    const dy = g.geo[i * 2 + 1] - cy;
    const r = Math.hypot(dx, dy);
    if (r < 1e-9) {
      openedKm[i * 2] = cx;
      openedKm[i * 2 + 1] = cy;
      continue;
    }
    // Both mappings put the median station at rMed; the even one grows with the square root of the share.
    const even = Math.sqrt(frac(r) / 0.5) * rMed;
    const R = (1 - MIX) * r + MIX * even;
    openedKm[i * 2] = cx + (dx / r) * R;
    openedKm[i * 2 + 1] = cy + (dy / r) * R;
  }

  // Scale so a typical chain, once opened, is a little longer than its stations need.
  const ratios: number[] = [];
  for (const c of g.chains) {
    const a = g.keys[c.a];
    const b = g.keys[c.b];
    const len = Math.hypot(openedKm[a * 2] - openedKm[b * 2], openedKm[a * 2 + 1] - openedKm[b * 2 + 1]);
    ratios.push((c.inner.length + 1) / Math.max(len, 1e-6));
  }
  ratios.sort((a, b) => a - b);
  const unitsPerKm = (ratios[ratios.length >> 1] || 1) * 1.2;

  const truth = new Float64Array(n * 2);
  const opened = new Float64Array(n * 2);
  for (let i = 0; i < n * 2; i++) {
    truth[i] = (g.geo[i] - (i % 2 ? cy : cx)) * unitsPerKm;
    opened[i] = (openedKm[i] - (i % 2 ? cy : cx)) * unitsPerKm;
  }
  const keyStart = new Float64Array(g.keys.length * 2);
  g.keys.forEach((s, k) => {
    keyStart[k * 2] = opened[s * 2];
    keyStart[k * 2 + 1] = opened[s * 2 + 1];
  });

  // Which side of the straight line between its ends each chain's track bulges to.
  const chains: LayoutChain[] = g.chains.map((c) => {
    let side = 0;
    if (c.inner.length) {
      const A = g.keys[c.a];
      const B = g.keys[c.b];
      const ax = g.geo[A * 2];
      const ay = g.geo[A * 2 + 1];
      const bx = g.geo[B * 2];
      const by = g.geo[B * 2 + 1];
      const len = Math.hypot(bx - ax, by - ay) || 1e-9;
      let best = 0;
      for (const s of c.inner) {
        const d = ((bx - ax) * (g.geo[s * 2 + 1] - ay) - (by - ay) * (g.geo[s * 2] - ax)) / len;
        if (Math.abs(d) > Math.abs(best)) best = d;
      }
      if (Math.abs(best) > 0.06 * len) side = Math.sign(best);
    }
    return { a: c.a, b: c.b, inner: c.inner.length, lines: c.lines.length, side };
  });

  return { truth, opened, keyStart, chains, unitsPerKm };
}
