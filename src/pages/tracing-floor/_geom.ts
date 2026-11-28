// Compass-and-straightedge geometry for the tracing floor.
// World units: the window's span between springers is 2, y points up.

export interface Vec {
  x: number;
  y: number;
}

export interface Line {
  kind: 'line';
  a: Vec;
  b: Vec;
}

export interface Circle {
  kind: 'circle';
  c: Vec;
  r: number;
}

export type Prim = Line | Circle;

/** A stone member, as the renderer and the ochre guide draw it. Arcs run counterclockwise from a0 to a1 (radians). */
export type Piece = { kind: 'arc'; c: Vec; r: number; a0: number; a1: number } | { kind: 'seg'; p: Vec; q: Vec };

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Two constructions agree when they differ by less than this (the span is 2). */
export const EPS = 1e-5;
const TAU = Math.PI * 2;

export const v = (x: number, y: number): Vec => ({ x, y });
export const dist = (p: Vec, q: Vec): number => Math.hypot(p.x - q.x, p.y - q.y);
export const line = (a: Vec, b: Vec): Line => ({ kind: 'line', a, b });
export const circle = (c: Vec, r: number): Circle => ({ kind: 'circle', c, r });

export function normAngle(a: number): number {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

/** Counterclockwise sweep from a0 to a1, in [0, 2π). */
export function sweep(a0: number, a1: number): number {
  return normAngle(a1 - a0);
}

export function inRect(p: Vec, r: Rect): boolean {
  return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
}

export function samePrim(p: Prim, q: Prim): boolean {
  if (p.kind === 'circle' && q.kind === 'circle') return dist(p.c, q.c) < EPS && Math.abs(p.r - q.r) < EPS;
  if (p.kind === 'line' && q.kind === 'line') return pointLineDist(q.a, p) < EPS && pointLineDist(q.b, p) < EPS;
  return false;
}

export function pointLineDist(p: Vec, l: Line): number {
  const dx = l.b.x - l.a.x;
  const dy = l.b.y - l.a.y;
  const len = Math.hypot(dx, dy);
  return Math.abs((p.x - l.a.x) * dy - (p.y - l.a.y) * dx) / len;
}

/** Distance from p to the drawn curve of a primitive. */
export function primDist(p: Vec, prim: Prim): number {
  return prim.kind === 'line' ? pointLineDist(p, prim) : Math.abs(dist(p, prim.c) - prim.r);
}

/** Every point where two primitives meet; a tangency counts once. */
export function intersect(p: Prim, q: Prim): Vec[] {
  if (p.kind === 'line' && q.kind === 'line') return lineLine(p, q);
  if (p.kind === 'line' && q.kind === 'circle') return lineCircle(p, q);
  if (p.kind === 'circle' && q.kind === 'line') return lineCircle(q, p);
  return circleCircle(p as Circle, q as Circle);
}

function lineLine(p: Line, q: Line): Vec[] {
  const d1x = p.b.x - p.a.x;
  const d1y = p.b.y - p.a.y;
  const d2x = q.b.x - q.a.x;
  const d2y = q.b.y - q.a.y;
  const den = d1x * d2y - d1y * d2x;
  const scale = Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y);
  if (Math.abs(den) < 1e-12 * scale) return [];
  const t = ((q.a.x - p.a.x) * d2y - (q.a.y - p.a.y) * d2x) / den;
  return [v(p.a.x + t * d1x, p.a.y + t * d1y)];
}

function lineCircle(l: Line, c: Circle): Vec[] {
  const dx = l.b.x - l.a.x;
  const dy = l.b.y - l.a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  // Foot of the perpendicular from the centre.
  const t = (c.c.x - l.a.x) * ux + (c.c.y - l.a.y) * uy;
  const fx = l.a.x + t * ux;
  const fy = l.a.y + t * uy;
  const h = Math.hypot(c.c.x - fx, c.c.y - fy);
  const gap = h - c.r;
  if (gap > 1e-9) return [];
  if (Math.abs(gap) <= 1e-9) return [v(fx, fy)];
  const s = Math.sqrt(c.r * c.r - h * h);
  return [v(fx - s * ux, fy - s * uy), v(fx + s * ux, fy + s * uy)];
}

function circleCircle(p: Circle, q: Circle): Vec[] {
  const d = dist(p.c, q.c);
  if (d < 1e-12) return [];
  if (d > p.r + q.r + 1e-9 || d < Math.abs(p.r - q.r) - 1e-9) return [];
  const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d);
  const ux = (q.c.x - p.c.x) / d;
  const uy = (q.c.y - p.c.y) / d;
  const mx = p.c.x + a * ux;
  const my = p.c.y + a * uy;
  const h2 = p.r * p.r - a * a;
  if (h2 <= 1e-14) return [v(mx, my)];
  const h = Math.sqrt(h2);
  return [v(mx - h * uy, my + h * ux), v(mx + h * uy, my - h * ux)];
}

/** Push a point unless one already sits within EPS. Returns the index of the point that holds it. */
export function addPoint(points: Vec[], p: Vec): number {
  for (let i = 0; i < points.length; i++) if (dist(points[i], p) < EPS) return i;
  points.push(p);
  return points.length - 1;
}

/** All construction points: the given points plus every crossing inside the bounds. */
export function constructionPoints(given: Vec[], prims: Prim[], bounds: Rect): Vec[] {
  const points: Vec[] = [];
  for (const g of given) addPoint(points, g);
  for (let i = 0; i < prims.length; i++)
    for (let j = i + 1; j < prims.length; j++)
      for (const p of intersect(prims[i], prims[j])) if (inRect(p, bounds)) addPoint(points, p);
  return points;
}

/** Angle of p seen from c. */
export const angleAt = (c: Vec, p: Vec): number => normAngle(Math.atan2(p.y - c.y, p.x - c.x));

/** Point on a circle at angle a. */
export const onCircle = (c: Vec, r: number, a: number): Vec => v(c.x + r * Math.cos(a), c.y + r * Math.sin(a));

/** Parameter of p along a line, measured from a in units of world length. */
export function lineParam(l: Line, p: Vec): number {
  const dx = l.b.x - l.a.x;
  const dy = l.b.y - l.a.y;
  const len = Math.hypot(dx, dy);
  return ((p.x - l.a.x) * dx + (p.y - l.a.y) * dy) / len;
}

export function linePoint(l: Line, t: number): Vec {
  const dx = l.b.x - l.a.x;
  const dy = l.b.y - l.a.y;
  const len = Math.hypot(dx, dy);
  return v(l.a.x + (t * dx) / len, l.a.y + (t * dy) / len);
}

/** Where a line enters and leaves a rectangle, as line parameters; null if it misses. */
export function clipLine(l: Line, r: Rect): [number, number] | null {
  const dx = l.b.x - l.a.x;
  const dy = l.b.y - l.a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  let t0 = -Infinity;
  let t1 = Infinity;
  const slab = (o: number, u: number, lo: number, hi: number): boolean => {
    if (Math.abs(u) < 1e-12) return o >= lo && o <= hi;
    let a = (lo - o) / u;
    let b = (hi - o) / u;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  if (!slab(l.a.x, ux, r.x0, r.x1)) return null;
  if (!slab(l.a.y, uy, r.y0, r.y1)) return null;
  return [t0, t1];
}

/** One stretch of a primitive between neighbouring crossings: what the visitor marks as stone on the open floor. */
export interface Span {
  prim: number;
  /** Line parameters, or angles for a circle (counterclockwise from t0 to t1). */
  t0: number;
  t1: number;
  piece: Piece;
}

/** Cut every primitive at its crossings into spans, clipped to the bounds. */
export function arrangement(prims: Prim[], bounds: Rect): Span[] {
  const spans: Span[] = [];
  prims.forEach((prim, i) => {
    const hits: Vec[] = [];
    prims.forEach((other, j) => {
      if (i !== j) for (const p of intersect(prim, other)) if (inRect(p, bounds)) hits.push(p);
    });
    if (prim.kind === 'line') {
      const clip = clipLine(prim, bounds);
      if (!clip) return;
      const ts = hits.map((p) => lineParam(prim, p)).filter((t) => t > clip[0] && t < clip[1]);
      ts.push(clip[0], clip[1]);
      ts.sort((a, b) => a - b);
      for (let k = 0; k + 1 < ts.length; k++) {
        if (ts[k + 1] - ts[k] < EPS) continue;
        spans.push({
          prim: i,
          t0: ts[k],
          t1: ts[k + 1],
          piece: { kind: 'seg', p: linePoint(prim, ts[k]), q: linePoint(prim, ts[k + 1]) },
        });
      }
    } else {
      const as = hits.map((p) => angleAt(prim.c, p)).sort((a, b) => a - b);
      const uniq: number[] = [];
      for (const a of as) if (!uniq.length || a - uniq[uniq.length - 1] > EPS) uniq.push(a);
      if (uniq.length > 1 && TAU - uniq[uniq.length - 1] + uniq[0] < EPS) uniq.pop();
      if (uniq.length === 0) {
        spans.push({ prim: i, t0: 0, t1: TAU, piece: { kind: 'arc', c: prim.c, r: prim.r, a0: 0, a1: TAU } });
        return;
      }
      if (uniq.length === 1) {
        const a = uniq[0];
        spans.push({ prim: i, t0: a, t1: a + TAU, piece: { kind: 'arc', c: prim.c, r: prim.r, a0: a, a1: a + TAU } });
        return;
      }
      for (let k = 0; k < uniq.length; k++) {
        const a0 = uniq[k];
        const a1 = k + 1 < uniq.length ? uniq[k + 1] : uniq[0] + TAU;
        spans.push({ prim: i, t0: a0, t1: a1, piece: { kind: 'arc', c: prim.c, r: prim.r, a0, a1 } });
      }
    }
  });
  return spans;
}

// Arcs keep a0 < a1 and a1 - a0 <= 2π; a1 may run past 2π.

/** Midpoint of a piece, for hit tests and labels. */
export function pieceMid(p: Piece): Vec {
  if (p.kind === 'seg') return v((p.p.x + p.q.x) / 2, (p.p.y + p.q.y) / 2);
  return onCircle(p.c, p.r, (p.a0 + p.a1) / 2);
}

/** Distance from a point to a piece. */
export function pieceDist(pt: Vec, p: Piece): number {
  if (p.kind === 'seg') {
    const dx = p.q.x - p.p.x;
    const dy = p.q.y - p.p.y;
    const l2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((pt.x - p.p.x) * dx + (pt.y - p.p.y) * dy) / l2));
    return Math.hypot(pt.x - (p.p.x + t * dx), pt.y - (p.p.y + t * dy));
  }
  const full = p.a1 - p.a0 >= TAU - 1e-9;
  const a = angleAt(p.c, pt);
  if (full || sweep(p.a0, a) <= p.a1 - p.a0) return Math.abs(dist(pt, p.c) - p.r);
  return Math.min(dist(pt, onCircle(p.c, p.r, p.a0)), dist(pt, onCircle(p.c, p.r, p.a1)));
}

/** An arc piece between two angles in degrees, counterclockwise. */
export function arcDeg(c: Vec, r: number, d0: number, d1: number): Piece {
  const a0 = (d0 * Math.PI) / 180;
  let a1 = (d1 * Math.PI) / 180;
  while (a1 <= a0) a1 += TAU;
  return { kind: 'arc', c, r, a0, a1 };
}

/** An arc piece between two points on a circle, counterclockwise from p to q. */
export function arcPts(c: Vec, r: number, p: Vec, q: Vec): Piece {
  const a0 = angleAt(c, p);
  let a1 = angleAt(c, q);
  while (a1 <= a0) a1 += TAU;
  return { kind: 'arc', c, r, a0, a1 };
}

/** True when the parameter t lies inside the marked interval [t0, t1] of the same primitive. */
export function paramInside(prim: Prim, t: number, t0: number, t1: number): boolean {
  if (prim.kind === 'line') return t > t0 - EPS && t < t1 + EPS;
  if (t1 - t0 >= TAU - 1e-9) return true;
  return sweep(t0, t) <= t1 - t0 + EPS;
}

/** Seeded random numbers (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
