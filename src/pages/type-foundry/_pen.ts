// The pen: sweeps a nib along a skeleton stroke and returns the outline it leaves.
//
// The outline is the Minkowski sum of the stroke (a polyline) and the nib (a convex,
// centrally symmetric polygon). Each side of the stroke follows the nib's support point
// for that side's normal; where the stroke turns, the outer side walks round the nib's
// own edge and the inner side steps through the skeleton point, the way a stroker
// builds an inner join. Every piece then winds the same way, so filled with the nonzero
// rule (as every font renderer does) the overlaps union cleanly with no boolean ops.

export type Pt = [number, number];

export type PenKind = 'broad' | 'round' | 'pointed';

export interface Pen {
  kind: PenKind;
  /** Nib width in font units: the broad edge, the round pen's diameter, or the pointed pen's full swell. */
  width: number;
  /** Broad nib: edge thickness as a share of its width. Pointed pen: hairline as a share of the swell. */
  contrast: number;
  /** Broad nib angle in degrees, measured from the baseline. */
  angle: number;
  /** Slant in degrees; the pointed pen swells along the slanted downstroke. */
  slant: number;
}

const ROUND_SIDES = 28;

/** A nib as polygon offsets, counterclockwise. */
type Nib = Pt[];

export function broadNib(width: number, thick: number, angleDeg: number): Nib {
  const a = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const h = width / 2;
  const t = Math.max(thick, 0.5) / 2;
  return [
    [h * ux + t * uy, h * uy - t * ux],
    [h * ux - t * uy, h * uy + t * ux],
    [-h * ux - t * uy, -h * uy + t * ux],
    [-h * ux + t * uy, -h * uy - t * ux],
  ];
}

export function roundNib(radius: number): Nib {
  const r = Math.max(radius, 0.5);
  const out: Nib = [];
  for (let i = 0; i < ROUND_SIDES; i++) {
    const a = (i / ROUND_SIDES) * Math.PI * 2;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

function support(nib: Nib, nx: number, ny: number): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < nib.length; i++) {
    const d = nib[i][0] * nx + nib[i][1] * ny;
    if (d > bestDot + 1e-9) {
      bestDot = d;
      best = i;
    }
  }
  return best;
}

/** The nib's reach from its centre in a direction: how far the stroke's edge sits off the skeleton. */
export function reach(nib: Nib, nx: number, ny: number): number {
  const p = nib[support(nib, nx, ny)];
  return p[0] * nx + p[1] * ny;
}

/** Push the nib's vertices from index a to index b, walking clockwise (decreasing index). */
function walkCW(out: Pt[], at: Pt, nib: Nib, a: number, b: number): void {
  const k = nib.length;
  let i = a;
  for (let guard = 0; guard <= k; guard++) {
    pushIfNew(out, [at[0] + nib[i][0], at[1] + nib[i][1]]);
    if (i === b) return;
    i = (i - 1 + k) % k;
  }
}

function pushIfNew(out: Pt[], p: Pt): void {
  const last = out[out.length - 1];
  if (!last || Math.abs(last[0] - p[0]) > 1e-6 || Math.abs(last[1] - p[1]) > 1e-6) out.push(p);
}

function dedupe(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.05) out.push(p);
  }
  return out;
}

/** Pointed-pen pressure along a stroke: full on the downstroke, eased in at the start and out at the end. */
function pressures(points: Pt[], pen: Pen): number[] {
  const s = (pen.slant * Math.PI) / 180;
  const downX = -Math.sin(s);
  const downY = -Math.cos(s);
  const n = points.length;
  const dirs: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    dirs.push([(b[0] - a[0]) / len, (b[1] - a[1]) / len]);
  }
  const along: number[] = [0];
  for (let i = 1; i < n; i++)
    along.push(along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = along[n - 1];
  const taper = pen.width * 0.9;
  return dirs.map((d, i) => {
    const down = d[0] * downX + d[1] * downY;
    const t = Math.min(1, Math.max(0, (down - 0.2) / 0.7));
    let p = t * t * (3 - 2 * t);
    const edge = Math.min(along[i], total - along[i]);
    if (total > taper * 1.5) p *= Math.min(1, 0.35 + (0.65 * edge) / taper);
    return p;
  });
}

/** Split long straight segments so the pointed pen's pressure can change along them. */
function densify(points: Pt[], step: number): Pt[] {
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(len / step);
    for (let j = 1; j <= n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  return out;
}

export function nibsFor(points: Pt[], pen: Pen): Nib[] {
  if (pen.kind === 'broad') {
    const nib = broadNib(pen.width, pen.width * pen.contrast, pen.angle);
    return points.map(() => nib);
  }
  if (pen.kind === 'round') {
    const nib = roundNib(pen.width / 2);
    return points.map(() => nib);
  }
  const hair = Math.max(pen.width * pen.contrast, 4);
  return pressures(points, pen).map((p) => roundNib((hair + (pen.width - hair) * p) / 2));
}

/** The nib a lone point (a dot) leaves. */
export function dotNib(pen: Pen): Nib {
  if (pen.kind === 'broad') {
    // A short stroke square to the edge, the way a dot is made with an edged pen.
    return broadNib(pen.width, Math.max(pen.width * 0.72, pen.width * pen.contrast), pen.angle);
  }
  if (pen.kind === 'round') return roundNib(pen.width / 2);
  return roundNib(Math.max(pen.width * 0.42, pen.width * pen.contrast * 0.5));
}

/** Prepare a stroke for sweeping: the points the nib visits and the nib at each. */
export function prepare(stroke: Pt[], pen: Pen): { points: Pt[]; nibs: Nib[] } {
  let points = dedupe(stroke);
  if (pen.kind === 'pointed' && points.length > 1) points = densify(points, Math.max(6, pen.width / 6));
  return { points, nibs: nibsFor(points, pen) };
}

/** The closed outline one stroke leaves, counterclockwise. */
export function sweep(stroke: Pt[], pen: Pen): Pt[] {
  const { points, nibs } = prepare(stroke, pen);
  const n = points.length;
  if (n === 1) {
    const nib = dotNib(pen);
    return nib.map((v) => [points[0][0] + v[0], points[0][1] + v[1]] as Pt);
  }
  const dirs: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dy = points[i + 1][1] - points[i][1];
    const len = Math.hypot(dx, dy);
    dirs.push([dx / len, dy / len]);
  }
  const out: Pt[] = [];
  const at = (i: number, nib: Nib, k: number): Pt => [points[i][0] + nib[k][0], points[i][1] + nib[k][1]];

  // Left side, forward. Normals point left of travel.
  for (let i = 0; i < n - 1; i++) {
    const [dx, dy] = dirs[i];
    const nx = -dy;
    const ny = dx;
    if (i > 0) {
      const [px, py] = dirs[i - 1];
      const cross = px * dy - py * dx;
      const prevK = support(nibs[i], -py, px);
      const k = support(nibs[i], nx, ny);
      if (cross < -1e-9) walkCW(out, points[i], nibs[i], prevK, k);
      else if (prevK !== k) {
        pushIfNew(out, [points[i][0], points[i][1]]);
        pushIfNew(out, at(i, nibs[i], k));
      }
    } else {
      // Start cap: from the right side round the back of the nib to the left.
      walkCW(out, points[0], nibs[0], support(nibs[0], dy, -dx), support(nibs[0], nx, ny));
    }
    pushIfNew(out, at(i + 1, nibs[i + 1], support(nibs[i + 1], nx, ny)));
  }
  // End cap: from the left side round the front of the nib to the right.
  {
    const [dx, dy] = dirs[n - 2];
    walkCW(out, points[n - 1], nibs[n - 1], support(nibs[n - 1], -dy, dx), support(nibs[n - 1], dy, -dx));
  }
  // Right side, backward. Normals point right of travel.
  for (let i = n - 2; i >= 0; i--) {
    const [dx, dy] = dirs[i];
    const nx = dy;
    const ny = -dx;
    if (i < n - 2) {
      const [qx, qy] = dirs[i + 1];
      const cross = dx * qy - dy * qx;
      const prevK = support(nibs[i + 1], qy, -qx);
      const k = support(nibs[i + 1], nx, ny);
      if (cross > 1e-9) walkCW(out, points[i + 1], nibs[i + 1], prevK, k);
      else if (prevK !== k) {
        pushIfNew(out, [points[i + 1][0], points[i + 1][1]]);
        pushIfNew(out, at(i + 1, nibs[i + 1], k));
      }
    }
    pushIfNew(out, at(i, nibs[i], support(nibs[i], nx, ny)));
  }
  // The start cap opened the contour; drop a closing duplicate.
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) out.pop();
  // Built clockwise; fonts conventionally wind outer contours counterclockwise.
  return out.reverse();
}
