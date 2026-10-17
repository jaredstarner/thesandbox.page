// Polygon helpers for cut paper. Rings are lists of [x, y] points; a shape is
// an outer ring followed by holes, filled even-odd.

import type { Pt } from './_geom';

export type Ring = Pt[];

export const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** A round-headed opening: straight jambs from y0 to the springing, then a half circle. */
export function arch(cx: number, span: number, y0: number, spring: number, steps = 10): Ring {
  const r = span / 2;
  const ring: Ring = [
    [cx - r, y0],
    [cx + r, y0],
  ];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI;
    ring.push([cx + r * Math.cos(t), spring + r * Math.sin(t)]);
  }
  return ring;
}

export function circle(cx: number, cy: number, r: number, steps = 18): Ring {
  const ring: Ring = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    ring.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return ring;
}

/** Mirror a ring across x = 0, keeping its winding readable. */
export const mirror = (ring: Ring): Ring => ring.map(([x, y]) => [-x, y] as Pt).reverse();

/** Keep the part of a ring on one side of x = 0 (Sutherland-Hodgman against a half-plane). */
export function clipX(ring: Ring, keep: 'neg' | 'pos'): Ring {
  const inside = (p: Pt) => (keep === 'pos' ? p[0] >= 0 : p[0] <= 0);
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i];
    const prev = ring[(i + ring.length - 1) % ring.length];
    const ci = inside(cur);
    const pi = inside(prev);
    if (ci !== pi) {
      const t = prev[0] / (prev[0] - cur[0]);
      out.push([0, prev[1] + (cur[1] - prev[1]) * t]);
    }
    if (ci) out.push(cur);
  }
  return out.length >= 3 ? out : [];
}

/** A small seeded generator, so every build cuts the same windows. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** SVG path data for a set of rings in px, y already pointing down. */
export const pathData = (rings: Ring[]) =>
  rings
    .filter((r) => r.length >= 3)
    .map((r) => 'M' + r.map(([x, y]) => `${+x.toFixed(2)} ${+y.toFixed(2)}`).join('L') + 'Z')
    .join('');
