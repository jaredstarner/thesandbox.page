// Fold kinematics for a pop-up book, in world units (CSS pixels at scale 1).
// World axes: x to the right, y up the page (away from the reader), z up off
// the table. The spine lies along y at x = 0. A leaf turns about the spine by
// its angle phi: 0 lies flat on the right, 180 flat on the left.

export type V3 = [number, number, number];
export type Pt = [number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const DEG = Math.PI / 180;
export const Y: V3 = [0, 1, 0];

/** Where a flat face sits: its top-left corner and unit vectors along its px x (right) and px y (down). */
export interface Frame {
  o: V3;
  ex: V3;
  ey: V3;
}

/** The side a face's front looks out of. */
export const normalOf = (f: Frame): V3 => cross(f.ey, f.ex);

/** A point on a face, from its px coordinates. */
export const at = (f: Frame, x: number, y: number): V3 => add(f.o, add(mul(f.ex, x), mul(f.ey, y)));

/** The same face seen from behind: mirrored across its width so its own front is the other side. */
export const backOf = (f: Frame, w: number): Frame => ({ o: at(f, w, 0), ex: mul(f.ex, -1), ey: f.ey });

/** CSS matrix3d for a face. World y runs up the page; CSS y runs down the screen, so y flips. */
export function matrix(f: Frame): string {
  const c = (v: V3) => [v[0], -v[1], v[2]];
  const ex = c(f.ex);
  const ey = c(f.ey);
  const n = c(normalOf(f));
  const o = c(f.o);
  const r = (n: number) => +n.toFixed(5);
  return `matrix3d(${[...ex, 0, ...ey, 0, ...n, 0, ...o, 1].map(r).join(',')})`;
}

/** A leaf's direction from the spine at turn angle phi (degrees). */
export const leafDir = (phi: number): V3 => [Math.cos(phi * DEG), 0, Math.sin(phi * DEG)];

/** The pose of one open spread: the spine point and the two page directions. */
export interface Spread {
  /** Spine origin of the left page (the leaf that has turned). */
  hl: V3;
  /** Spine origin of the right page. */
  hr: V3;
  a: V3;
  b: V3;
}

/** Unit vector into the valley between the pages, square to the line between them. */
export function valley(s: Spread): V3 {
  const d = sub(s.b, s.a);
  // In the xz plane, rotate (b - a) a quarter turn toward +z.
  const n: V3 = [-d[2], 0, d[0]];
  return len(n) < 1e-6 ? [0, 0, 1] : norm(n);
}

/** Half the angle between the pages, in radians. */
export const halfOpen = (s: Spread) => Math.acos(Math.max(-1, Math.min(1, dot(s.a, s.b)))) / 2;

// ---------------------------------------------------------------------------
// V-fold: a card folded down its middle, each half glued to one page along a
// line through the spine point at angle alpha from the spine. Each half is a
// rigid plane, and the paper's own angle between glue line and middle fold is
// beta. sense +1 points the glue lines up the page (a corner toward the
// reader), -1 down it (a backdrop that opens toward the reader).

export interface VFoldPose {
  apex: V3;
  /** Glue line directions on the left and right pages. */
  gl: V3;
  gr: V3;
  /** The middle fold. */
  c: V3;
}

export function vfold(s: Spread, y0: number, alpha: number, beta: number, sense: 1 | -1): VFoldPose {
  const n = valley(s);
  const half = halfOpen(s);
  const ca = Math.cos(alpha * DEG);
  const sa = Math.sin(alpha * DEG);
  const cb = Math.cos(beta * DEG);
  const along: V3 = [0, sense, 0];
  const gl = norm(add(mul(along, ca), mul(s.a, sa)));
  const gr = norm(add(mul(along, ca), mul(s.b, sa)));
  // The fold lies in the plane of symmetry: c = p*along + q*n, with c.g = cos(beta) for both glue lines.
  const A = ca;
  const B = sa * Math.cos(half);
  const R = Math.hypot(A, B);
  const phi0 = Math.atan2(B, A);
  const k = Math.max(-1, Math.min(1, cb / R));
  const psi = phi0 + Math.acos(k);
  const c = norm(add(mul(along, Math.cos(psi)), mul(n, Math.sin(psi))));
  const apex: V3 = [0, y0, (s.hl[2] + s.hr[2]) / 2];
  return { apex, gl, gr, c };
}

/**
 * One wing's frame. The wing is drawn in px with x along the glue line, from
 * the middle fold outward, and y down from `top` units above the glue line.
 * The left wing is mirrored so both wings read left to right from the front.
 */
export function wingFrame(p: VFoldPose, side: 'l' | 'r', top: number, width: number): Frame {
  const g = side === 'l' ? p.gl : p.gr;
  const up = norm(sub(p.c, mul(g, dot(p.c, g))));
  if (side === 'r') return { o: add(p.apex, mul(up, top)), ex: g, ey: mul(up, -1) };
  return { o: add(add(p.apex, mul(g, width)), mul(up, top)), ex: mul(g, -1), ey: mul(up, -1) };
}

// ---------------------------------------------------------------------------
// Floating layer: two walls glued square along lines parallel to the spine at
// distance d, carrying a deck that folds at the spine. The walls stay along
// the valley's bisector and each half of the deck stays parallel to its page.

export interface LayerPose {
  p1: V3;
  a1: V3;
  m: V3;
  b1: V3;
  p2: V3;
}

export function layer(s: Spread, d: number, h: number): LayerPose {
  const n = valley(s);
  const w = mul(n, h);
  const hm = mul(add(s.hl, s.hr), 0.5);
  const p1 = add(s.hl, mul(s.a, d));
  const p2 = add(s.hr, mul(s.b, d));
  return { p1, a1: add(p1, w), m: add(hm, w), b1: add(p2, w), p2 };
}
