// Engraves one plate: the view from a cell, facing one way, as an SVG string.
// Visibility comes from rays cast across the plan; faces are painted far to
// near, each as an aquatint tone with etched masonry and hatching laid along
// the stone, so lines converge and thicken with distance the way an
// engraver's would.

import { LEFT, RIGHT, STEP, inside, plan, type Cell, type Dir, type Feature } from './_maze';

export const VW = 1000;
export const VH = 640;
const CX = VW / 2;
const CY = 296;
const F = 640;
/** Wall height, in cell widths. */
const H = 1.25;
const EYE = 0.6;
/** How far behind the cell's centre the viewer stands. */
const BACKSET = 0.3;
const NEAR = 0.06;
const MAX_DEPTH = 9;

const PAPER = [236, 226, 203] as const;
const INK = [30, 23, 17] as const;
/** Sky at the top of the far stair: brighter than the paper, the one thing on the plate that is. */
const DAYLIGHT = '#fffbf0';

type V3 = [number, number, number]; // x right, y up, z forward, in cell widths; z is from the cell centre
type V2 = [number, number];

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

function tone(t: number, rgb: readonly number[] = PAPER) {
  const k = Math.max(0, Math.min(1, t));
  const c = rgb.map((p, i) => Math.round(p + (INK[i]! - p) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Depth from the eye. */
const zc = (p: V3) => p[2] + BACKSET;

function project(p: V3): V2 {
  const z = zc(p);
  return [CX + (F * p[0]) / z, CY - (F * (p[1] - EYE)) / z];
}

/** Clips a polygon to the near plane (Sutherland-Hodgman against one plane). */
function clipPoly(pts: V3[]): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const ia = zc(a) >= NEAR;
    const ib = zc(b) >= NEAR;
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (NEAR - zc(a)) / (zc(b) - zc(a));
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

function clipSeg(a: V3, b: V3): [V3, V3] | null {
  const ia = zc(a) >= NEAR;
  const ib = zc(b) >= NEAR;
  if (!ia && !ib) return null;
  if (ia && ib) return [a, b];
  const t = (NEAR - zc(a)) / (zc(b) - zc(a));
  const m: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return ia ? [a, m] : [m, b];
}

/** Tenths of a plate unit, so relative steps add up exactly. */
const tenth = (n: number) => Math.round(n * 10);

/** A number in tenths, written short: "-.5" for -0.5, "12" for 12.0. */
function num(t: number) {
  const s = (t / 10).toString();
  return s.replace(/^(-?)0\./, '$1.');
}

/** Joins numbers, letting a minus sign stand in for the separator. */
function nums(...t: number[]) {
  return t.map((v, i) => (i && v >= 0 ? ' ' : '') + num(v)).join('');
}

function polyPath(pts: V3[]) {
  const c = clipPoly(pts);
  if (c.length < 3) return '';
  let d = '';
  let px = 0;
  let py = 0;
  c.forEach((p, i) => {
    const [x, y] = project(p).map(tenth) as [number, number];
    d += (i ? 'l' : 'M') + (i ? nums(x - px, y - py) : nums(x, y));
    px = x;
    py = y;
  });
  return d + 'z';
}

/** Clips a plate-space segment to a margin round the plate (Liang-Barsky); null when it misses. */
function clipToPlate(ax: number, ay: number, bx: number, by: number): [number, number, number, number] | null {
  const m = 12;
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (const [p, q] of [
    [-dx, ax + m],
    [dx, VW + m - ax],
    [-dy, ay + m],
    [dy, VH + m - ay],
  ] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

/** Several segments as one path in relative steps, with h and v for level and plumb lines. */
function segPath(segs: [V3, V3][]) {
  let d = '';
  let px = 0;
  let py = 0;
  for (const [a0, b0] of segs) {
    const s = clipSeg(a0, b0);
    if (!s) continue;
    const [ax0, ay0] = project(s[0]);
    const [bx0, by0] = project(s[1]);
    if (!isFinite(ax0 + ay0 + bx0 + by0)) continue;
    const clipped = clipToPlate(ax0, ay0, bx0, by0);
    if (!clipped) continue;
    const [ax, ay, bx, by] = clipped.map(tenth) as [number, number, number, number];
    if (ax === bx && ay === by) continue;
    d += d ? `m${nums(ax - px, ay - py)}` : `M${nums(ax, ay)}`;
    if (ay === by) d += `h${num(bx - ax)}`;
    else if (ax === bx) d += `v${num(by - ay)}`;
    else d += `l${nums(bx - ax, by - ay)}`;
    px = bx;
    py = by;
  }
  return d;
}

/** A deterministic jitter in [-1, 1] for a stone joint. */
function hash(...n: number[]) {
  let h = 2166136261;
  for (const v of n) h = Math.imul(h ^ Math.round(v * 1000), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** A wall face: a rectangle mapped from (u along, v up) to the viewer's space. */
interface Face {
  at(u: number, v: number): V3;
  /** Cell widths along the face. */
  length: number;
  /** The nearest depth on the face, for line weights and hatch spacing. */
  near: number;
  front: boolean;
  seed: number;
}

function frontFace(d: number, l: number, seed: number): Face {
  const z = d + 0.5;
  return { at: (u, v) => [l - 0.5 + u, v, z], length: 1, near: zc([0, 0, z]), front: true, seed };
}

function sideFace(d: number, l: number, side: 'left' | 'right', seed: number): Face {
  const x = side === 'left' ? l - 0.5 : l + 0.5;
  const z0 = d - 0.5;
  // Facing a left wall, your left hand points back toward the viewer; facing a right wall, forward.
  const at = side === 'left' ? (u: number, v: number): V3 => [x, v, z0 + u] : (u: number, v: number): V3 => [x, v, z0 + 1 - u];
  return { at, length: 1, near: Math.max(NEAR, zc([0, 0, z0])), front: false, seed };
}

const lantern = (z: number) => 1 / (1 + (z / 1.8) ** 3);
const weight = (z: number) => Math.max(0.35, Math.min(1.7, 1.25 / z));

interface Out {
  parts: string[];
  defs: string[];
}

function lineSet(out: Out, segs: [V3, V3][], w: number, color: string, extra = '') {
  const d = segPath(segs);
  if (d) out.parts.push(`<path d="${d}" stroke="${color}" stroke-width="${fmt(w)}"${extra}/>`);
}

/** Tone for a surface at depth z in a cell. 0 is paper, 1 is ink. */
function surfaceTone(cell: Cell, z: number, bias: number) {
  const light = Math.min(1, lantern(z) * 0.92 + cell.light);
  return Math.min(1, Math.max(0, 1 - light + bias));
}

/** Hatch spacing on the plate, in plate units, as an engraver keeps it. */
const RULE = 6;
/** Past this depth the lines would be too many for too little; the wash carries the tone. */
const HATCH_DEPTH = 3.4;

/** World spacing that prints at about RULE units at depth z. */
const spacingAt = (z: number) => (RULE * z) / F;

/**
 * Engraver's tone: parallel lines whose width carries the darkness, with a
 * second set crossing them in the deep shadows. `z` is the depth the face
 * was ruled for.
 */
function hatch(out: Out, sets: [V3, V3][][], t: number, z: number) {
  // Even the lightest stone gets a fine rule; only the paper itself is left bare.
  if (z > HATCH_DEPTH) return;
  lineSet(out, sets[0]!, RULE * Math.min(0.48, Math.max(0.07, t * 0.56)), tone(0.97));
  if (t > 0.5 && sets[1]) lineSet(out, sets[1], RULE * Math.min(0.36, (t - 0.45) * 0.75), tone(0.97));
}

/** A surface's wash: the share of the tone the hatching doesn't carry. */
const wash = (t: number, z: number) => tone(z > HATCH_DEPTH ? t : t * 0.55);

/**
 * Parallel lines across a w x h rectangle in its own (a, b) coordinates, at
 * `slope` (b per a; 0 runs along a), about `sp` apart, each nudged a little
 * so the ruling looks cut by hand.
 */
function ruled(w: number, h: number, sp: number, slope: number, seed: number): [V2, V2][] {
  const lines: [V2, V2][] = [];
  if (slope === 0) {
    for (let b = sp / 2, i = 0; b < h; b += sp, i++) {
      const j = b + hash(seed, i) * sp * 0.18;
      lines.push([[0, j], [w, j]]);
    }
    return lines;
  }
  // Lines b = slope * a + c, stepped so their perpendicular gap is sp.
  const step = sp * Math.sqrt(1 + slope * slope);
  const cMin = Math.min(0, -slope * w);
  const cMax = Math.max(h, h - slope * w);
  for (let c = cMin + step / 2, i = 0; c < cMax; c += step, i++) {
    const cc = c + hash(seed, i) * step * 0.18;
    const pts: V2[] = [];
    const at = (a: number) => slope * a + cc;
    const ofB = (b: number) => (b - cc) / slope;
    for (const a of [0, w]) if (at(a) >= 0 && at(a) <= h) pts.push([a, at(a)]);
    for (const b of [0, h]) {
      const a = ofB(b);
      if (a > 0 && a < w) pts.push([a, b]);
    }
    if (pts.length >= 2) lines.push([pts[0]!, pts[1]!]);
  }
  return lines;
}

function hatchFace(out: Out, f: Face, t: number, z: number) {
  const sp = spacingAt(z);
  const map = (lines: [V2, V2][]) => lines.map(([a, b]): [V3, V3] => [f.at(a[0], a[1]), f.at(b[0], b[1])]);
  hatch(out, [map(ruled(f.length, H, sp, 0, f.seed)), map(ruled(f.length, H, sp * 1.15, 1.6, f.seed + 9))], t, z);
}

/** Hatching on a floor or ceiling cell: one set along or across the passage, crossed on the diagonal. */
function hatchFlat(out: Out, l: number, d: number, y: number, t: number, z: number, seed: number, primary: 'along' | 'across') {
  const sp = spacingAt(z);
  const toWorld = ([a, b]: V2): V3 => [l - 0.5 + a, y, d - 0.5 + b];
  const map = (lines: [V2, V2][]) => lines.map(([p, q]): [V3, V3] => [toWorld(p), toWorld(q)]);
  const rows = ruled(1, 1, sp, 0, seed);
  const across = map(rows);
  const along = map(rows.map(([p, q]): [V2, V2] => [[p[1], p[0]], [q[1], q[0]]]));
  const diag = map(ruled(1, 1, sp * 1.15, 0.7, seed + 5));
  hatch(out, [primary === 'along' ? along : across, diag], t, z);
}

function masonry(out: Out, f: Face, w: number, t: number, z: number) {
  const joints: [V3, V3][] = [];
  const bevels: [V3, V3][] = [];
  const courses = 6;
  const ch = H / courses;
  for (let c = 1; c < courses; c++) {
    joints.push([f.at(0, c * ch), f.at(f.length, c * ch)]);
    // The lower arris of each course catches the lamp: a pale line under the joint.
    bevels.push([f.at(0, c * ch - 0.016), f.at(f.length, c * ch - 0.016)]);
  }
  for (let c = 0; c < courses; c++) {
    const offset = c % 2 ? 0.25 : 0;
    for (let u = offset; u < f.length + 0.01; u += 0.5) {
      const j = u + hash(f.seed, c, u) * 0.05;
      if (j <= 0.02 || j >= f.length - 0.02) continue;
      joints.push([f.at(j, c * ch), f.at(j, (c + 1) * ch)]);
      bevels.push([f.at(j + 0.012, c * ch + 0.01), f.at(j + 0.012, (c + 1) * ch - 0.02)]);
    }
  }
  joints.push([f.at(0, 0), f.at(0, H)], [f.at(f.length, 0), f.at(f.length, H)]);
  joints.push([f.at(0, H), f.at(f.length, H)], [f.at(0, 0), f.at(f.length, 0)]);
  if (z < 2.6 && t < 0.8) lineSet(out, bevels, w * 1.1, tone(Math.max(0, t * 0.25 - 0.05)));
  lineSet(out, joints, w * 1.15, tone(1));
}

/** Where vault arches spring, and how high their crowns reach, in face coordinates. */
const SPRING = 0.9;
const CROWN = 1.15;

/** The intrados of a vault arch from u = 0 to 1: a flattened half ellipse. */
function archCurve(steps = 16): V2[] {
  const pts: V2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI - (Math.PI * i) / steps;
    pts.push([0.5 + Math.cos(a) * 0.5, SPRING + Math.sin(a) * (CROWN - SPRING)]);
  }
  return pts;
}

/**
 * A vault arch on a cell boundary. Open: the spandrel of masonry between the
 * arch and the ceiling, with its voussoirs. Closed: the same arch, cut as a
 * line on the wall where the vault meets it.
 */
function vault(out: Out, f: Face, t: number, w: number, z: number, open: boolean) {
  const curve = archCurve();
  if (open) {
    const spandrel = facePoly(f, [[0, H], [1, H], [1, 0.0], [0.94, 0.0], ...curve.slice().reverse().map(([u, v]): V2 => [0.06 + u * 0.88, v]), [0.06, 0], [0, 0]]);
    out.parts.push(`<path d="${polyPath(spandrel)}" fill="${wash(t, z)}"/>`);
    // Piers and spandrel, ruled like the walls: level lines stopped at the opening.
    const ruling: [V3, V3][] = [];
    const sp = spacingAt(z);
    if (z <= HATCH_DEPTH && t > 0.03) {
      for (let v = sp / 2; v < H; v += sp) {
        const gap = v < SPRING ? [0.06, 0.94] : v < CROWN ? spandrelGap(v) : null;
        if (gap) ruling.push([f.at(0, v), f.at(gap[0], v)], [f.at(gap[1], v), f.at(1, v)]);
        else ruling.push([f.at(0, v), f.at(1, v)]);
      }
      lineSet(out, ruling, RULE * Math.min(0.48, Math.max(0.07, t * 0.56)), tone(0.97));
    }
  }
  const ring: [V3, V3][] = [];
  const inner = curve.map(([u, v]): V2 => [0.06 + u * 0.88, v]);
  for (let i = 0; i < inner.length - 1; i++) ring.push([f.at(...inner[i]!), f.at(...inner[i + 1]!)]);
  if (open) {
    // Voussoirs: joints radiating from the arch's centre to the ceiling line.
    for (let i = 2; i < inner.length - 2; i += 2) {
      const [u, v] = inner[i]!;
      const du = u - 0.5;
      const dv = v - SPRING + 0.25;
      const k = 0.075 / Math.hypot(du, dv);
      ring.push([f.at(u, v), f.at(u + du * k, Math.min(H, v + dv * k))]);
    }
    ring.push([f.at(0.06, 0), f.at(0.06, SPRING)], [f.at(0.94, 0), f.at(0.94, SPRING)]);
    ring.push([f.at(0, SPRING), f.at(0.06, SPRING)], [f.at(0.94, SPRING), f.at(1, SPRING)]);
  }
  lineSet(out, ring, w * (open ? 1.2 : 0.9), tone(1));
}

/** Where a level line at height v between springing and crown leaves the spandrel for the arch's opening. */
function spandrelGap(v: number): [number, number] | null {
  const s = (v - SPRING) / (CROWN - SPRING);
  if (s <= 0) return null;
  const x = Math.sqrt(Math.max(0, 0.25 - (s / 2) ** 2));
  return [0.06 + (0.5 - x) * 0.88, 0.06 + (0.5 + x) * 0.88];
}

function facePoly(f: Face, pts: V2[]): V3[] {
  return pts.map(([u, v]) => f.at(u, v));
}

/** An arch outline in face coordinates: a rectangle up to the springing line, then a half circle. */
function arch(u0: number, u1: number, v0: number, spring: number, steps = 14): V2[] {
  const r = (u1 - u0) / 2;
  const cu = u0 + r;
  const pts: V2[] = [[u0, v0], [u0, spring]];
  for (let i = 1; i < steps; i++) {
    const a = Math.PI - (Math.PI * i) / steps;
    pts.push([cu + Math.cos(a) * r, spring + Math.sin(a) * r]);
  }
  pts.push([u1, spring], [u1, v0]);
  return pts;
}

function drawFeature(out: Out, f: Face, feature: Feature, t: number, w: number) {
  if (feature.kind === 'stair-up' || feature.kind === 'daylight') {
    const day = feature.kind === 'daylight';
    const [u0, u1, spring] = day ? [0.14, 0.86, 0.74] : [0.2, 0.8, 0.72];
    const opening = arch(u0, u1, 0, spring);
    const r = (u1 - u0) / 2;
    const vu = (u0 + u1) / 2;
    // The stairwell: dark sides, and at the top, the sky or the dim landing you came down from.
    out.parts.push(`<path d="${polyPath(facePoly(f, opening))}" fill="${tone(day ? 0.5 : 0.8)}"/>`);
    // The stairwell's walls, ruled plumb up to the arch.
    const well: [V3, V3][] = [];
    const sp = spacingAt(Math.max(0.6, f.near));
    for (let u = u0 + sp / 2; u < u1; u += sp) {
      const dx = (u - vu) / r;
      const v1 = spring + Math.sqrt(Math.max(0, 1 - dx * dx)) * r;
      well.push([f.at(u, 0), f.at(u, v1)]);
    }
    lineSet(out, well, RULE * (day ? 0.3 : 0.45), tone(1));
    const top = spring + r * 0.62;
    const sky = arch(vu - r * 0.42, vu + r * 0.42, top - 0.2, top - 0.06, 10);
    out.parts.push(`<path d="${polyPath(facePoly(f, sky))}" fill="${day ? DAYLIGHT : tone(0.6)}"/>`);
    // Steps climbing away: each band is a riser, lit more the nearer it is to the top.
    const n = 9;
    // Scaled so the last riser meets the landing at the top of the flight.
    const sMax = 1 - Math.pow(0.78, n);
    const edge = (s: number, side: -1 | 1): V2 => [vu + side * (r - 0.03) * (1 - (s / sMax) * 0.58), (s / sMax) * (top - 0.2)];
    for (let k = 0; k < n; k++) {
      const s0 = 1 - Math.pow(0.78, k);
      const s1 = 1 - Math.pow(0.78, k + 1);
      const lit = day ? 0.58 - (k / (n - 1)) * 0.56 : 0.86 - (k / (n - 1)) * 0.22;
      const band = facePoly(f, [edge(s0, -1), edge(s1, -1), edge(s1, 1), edge(s0, 1)]);
      out.parts.push(`<path d="${polyPath(band)}" fill="${tone(lit)}"/>`);
    }
    const nosings: [V3, V3][] = [];
    for (let k = 1; k <= n; k++) {
      const s = 1 - Math.pow(0.78, k);
      const a = edge(s, -1);
      const b = edge(s, 1);
      nosings.push([f.at(a[0], a[1]), f.at(b[0], b[1])]);
    }
    lineSet(out, nosings, w * 0.9, tone(day ? 0.04 : 0.45));
    if (day) {
      // Light falling down the stair: rays fanned from the top of the flight.
      const rays: [V3, V3][] = [];
      for (let k = 0; k < 13; k++) {
        const a = -0.6 + (k / 12) * 1.2;
        rays.push([f.at(vu + Math.sin(a) * 0.08, top - 0.14), f.at(vu + Math.sin(a) * 0.62, 0.02)]);
      }
      lineSet(out, rays, w * 0.6, tone(0), ' opacity="0.55"');
    }
    // Voussoirs around the arch.
    const ring: [V3, V3][] = [];
    for (let i = 0; i <= 9; i++) {
      const a = Math.PI - (Math.PI * i) / 9;
      const c = Math.cos(a);
      const s = Math.sin(a);
      ring.push([f.at(vu + c * r, spring + s * r), f.at(vu + c * (r + 0.1), spring + s * (r + 0.1))]);
    }
    for (let i = 0; i < 24; i++) {
      const a0 = Math.PI - (Math.PI * i) / 24;
      const a1 = Math.PI - (Math.PI * (i + 1)) / 24;
      const R = r + 0.1;
      ring.push([f.at(vu + Math.cos(a0) * R, spring + Math.sin(a0) * R), f.at(vu + Math.cos(a1) * R, spring + Math.sin(a1) * R)]);
    }
    lineSet(out, ring, w, tone(Math.max(0.8, t + 0.3)));
    out.parts.push(
      `<path d="${polyPath(facePoly(f, arch(u0, u1, 0, spring)))}" fill="none" stroke="${tone(0.92)}" stroke-width="${fmt(w * 1.4)}"/>`,
    );
    return;
  }

  if (feature.kind === 'candle') {
    const niche = arch(0.36, 0.64, 0.42, 0.66);
    out.parts.push(`<path d="${polyPath(facePoly(f, niche))}" fill="${tone(Math.min(0.9, t + 0.25))}" stroke="${tone(0.92)}" stroke-width="${fmt(w)}"/>`);
    const [fx, fy] = project(f.at(0.5, 0.6));
    const [ex] = project(f.at(0.56, 0.6));
    const rad = Math.abs(ex - fx) * 6;
    out.parts.push(`<circle cx="${fmt(fx)}" cy="${fmt(fy)}" r="${fmt(rad)}" fill="url(#uc-candle)"/>`);
    out.parts.push(`<path d="${polyPath(facePoly(f, [[0.48, 0.42], [0.48, 0.535], [0.52, 0.535], [0.52, 0.42]]))}" fill="${tone(0.08)}" stroke="${tone(0.7)}" stroke-width="${fmt(w * 0.5)}"/>`);
    const flame: V2[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const sx = Math.sin(a) * 0.016;
      const sy = Math.cos(a) * 0.03;
      flame.push([0.5 + sx * (1 - Math.max(0, Math.cos(a)) * 0.85), 0.575 + sy]);
    }
    out.parts.push(`<path d="${polyPath(facePoly(f, flame))}" fill="#fff8e6"/>`);
    return;
  }

  if (feature.kind === 'grille') {
    const hole: V2[] = [[0.3, 0.32], [0.3, 0.78], [0.7, 0.78], [0.7, 0.32]];
    out.parts.push(`<path d="${polyPath(facePoly(f, hole))}" fill="${tone(1)}" stroke="${tone(0.95)}" stroke-width="${fmt(w * 1.3)}"/>`);
    const bars: [V3, V3][] = [];
    for (let k = 1; k < 6; k++) bars.push([f.at(0.3 + k * 0.0667, 0.32), f.at(0.3 + k * 0.0667, 0.78)]);
    bars.push([f.at(0.3, 0.55), f.at(0.7, 0.55)]);
    lineSet(out, bars, w * 1.6, tone(Math.min(0.75, t + 0.15)));
    return;
  }

  if (feature.kind === 'words' && f.front) {
    const [, top] = project(f.at(0.5, 0.86));
    const [, below] = project(f.at(0.5, 0.86 - 0.11));
    const size = (below - top) * 0.62;
    const [cx] = project(f.at(0.5, 0));
    const lines = feature.lines;
    // Legible up close; past three paces the cuts are just marks.
    if (size < 7) {
      const marks: [V3, V3][] = lines.map((line, i) => {
        const half = Math.min(0.42, line.length * 0.018);
        const v = 0.82 - i * 0.11;
        return [f.at(0.5 - half, v), f.at(0.5 + half, v)];
      });
      lineSet(out, marks, w * 1.5, tone(Math.min(0.95, t + 0.35)));
      return;
    }
    // A dressed tablet for the words, smoother and paler than the courses around it.
    const widest = Math.max(...lines.map((line) => line.length));
    const half = Math.min(0.42, 0.06 + widest * 0.021);
    const tablet = facePoly(f, [
      [0.5 - half, 0.92],
      [0.5 + half, 0.92],
      [0.5 + half, 0.86 - lines.length * 0.11],
      [0.5 - half, 0.86 - lines.length * 0.11],
    ]);
    out.parts.push(
      `<path d="${polyPath(tablet)}" fill="${tone(Math.max(0, t * 0.7 - 0.04))}" stroke="${tone(1)}" stroke-width="${fmt(w * 1.3)}"/>`,
    );
    const spans = lines
      .map((line, i) => {
        const [, y] = project(f.at(0.5, 0.82 - i * 0.11));
        return `<tspan x="${fmt(cx)}" y="${fmt(y)}">${line}</tspan>`;
      })
      .join('');
    // Incised letters: the cut in shadow, and its lower lip catching the lamp.
    const lip = tone(0);
    const cut = tone(Math.min(1, t + 0.7));
    out.parts.push(
      `<text class="carved" font-size="${fmt(size)}" text-anchor="middle" fill="${lip}" transform="translate(${fmt(size * 0.03)} ${fmt(size * 0.05)})">${spans}</text>`,
      `<text class="carved" font-size="${fmt(size)}" text-anchor="middle" fill="${cut}">${spans}</text>`,
    );
  }
}

interface Hit {
  d: number;
  l: number;
  /** Local sides of this cell's walls that a ray stopped at. */
  walls: Set<'front' | 'left' | 'right'>;
}

/** What the viewer can see: cells by depth and lateral offset, and the walls that stop the eye. */
function cast(cell: Cell, facing: Dir) {
  const [fx, fy] = STEP[facing];
  const [rx, ry] = STEP[RIGHT[facing]];
  const grid = (d: number, l: number) => {
    const x = cell.x + d * fx + l * rx;
    const y = cell.y + d * fy + l * ry;
    return inside(x, y) ? plan.at(x, y) : null;
  };
  const hits = new Map<string, Hit>();
  const hit = (d: number, l: number) => {
    const k = `${d},${l}`;
    let h = hits.get(k);
    if (!h) hits.set(k, (h = { d, l, walls: new Set() }));
    return h;
  };
  const RAYS = 720;
  const half = CX / F;
  for (let i = 0; i <= RAYS; i++) {
    const s = -half * 1.02 + (2.04 * half * i) / RAYS;
    let x = 0;
    let z = -BACKSET;
    let d = 0;
    let l = 0;
    for (let guard = 0; guard < 40; guard++) {
      const c = grid(d, l);
      if (!c) break;
      const h = hit(d, l);
      if (d > MAX_DEPTH) break;
      const tz = d + 0.5 - z;
      const tx = s > 0 ? (l + 0.5 - x) / s : s < 0 ? (l - 0.5 - x) / s : Infinity;
      if (tz <= tx) {
        if (!c.open[facing]) {
          h.walls.add('front');
          break;
        }
        x += s * tz;
        z += tz;
        d += 1;
      } else {
        const side = s > 0 ? 'right' : 'left';
        const dir = side === 'right' ? RIGHT[facing] : LEFT[facing];
        if (!c.open[dir]) {
          h.walls.add(side);
          break;
        }
        x += s * tx;
        z += tx;
        l += s > 0 ? 1 : -1;
      }
    }
  }
  return { hits: [...hits.values()], grid };
}

export interface Plate {
  svg: string;
  /** Paces of open passage straight ahead before a wall, or null past the lantern's reach. */
  ahead: number | null;
  aheadFeature: Feature | undefined;
}

export function engrave(cell: Cell, facing: Dir): Plate {
  const { hits, grid } = cast(cell, facing);
  const out: Out = { parts: [], defs: [] };
  hits.sort((a, b) => b.d - a.d || Math.abs(b.l) - Math.abs(a.l));

  for (const h of hits) {
    const c = grid(h.d, h.l)!;
    const { d, l } = h;
    const seed = c.x * 31 + c.y * 7;
    const zMid = Math.max(NEAR, d + BACKSET);

    const fw = weight(zMid + 0.5);
    const zFlat = zMid + 0.35;

    // Floor: flagstones half a cell square, joints staggered row to row.
    const floorT = surfaceTone(c, zFlat, -0.06);
    const floorQuad: V3[] = [
      [l - 0.5, 0, d - 0.5],
      [l + 0.5, 0, d - 0.5],
      [l + 0.5, 0, d + 0.5],
      [l - 0.5, 0, d + 0.5],
    ];
    const floor = polyPath(floorQuad);
    if (floor) out.parts.push(`<path d="${floor}" fill="${wash(floorT, zFlat)}"/>`);
    hatchFlat(out, l, d, 0, floorT, zFlat, seed, 'along');
    const flags: [V3, V3][] = [
      [[l - 0.5, 0, d], [l + 0.5, 0, d]],
      [[l - 0.5, 0, d + 0.5], [l + 0.5, 0, d + 0.5]],
    ];
    for (const [z0, z1, off] of [[d - 0.5, d, 0], [d, d + 0.5, 0.25]] as const) {
      for (let u = off; u <= 1; u += 0.5) {
        const xx = l - 0.5 + u + hash(seed, z0, u) * 0.04;
        if (xx > l - 0.49 && xx < l + 0.49) flags.push([[xx, 0, z0], [xx, 0, z1]]);
      }
    }
    lineSet(out, flags, fw * 0.9, tone(0.95));
    if (c.drain) {
      const g = 0.13;
      const grate = polyPath([
        [l - g, 0, d - g],
        [l + g, 0, d - g],
        [l + g, 0, d + g],
        [l - g, 0, d + g],
      ]);
      if (grate) out.parts.push(`<path d="${grate}" fill="${tone(1)}" stroke="${tone(0.95)}" stroke-width="${fmt(fw * 1.4)}"/>`);
      const bars: [V3, V3][] = [];
      for (let k = -2; k <= 2; k++) bars.push([[l + k * g * 0.36, 0, d - g], [l + k * g * 0.36, 0, d + g]]);
      lineSet(out, bars, fw * 1.4, tone(Math.min(0.6, floorT + 0.1)));
    }

    // Ceiling: shadowed stone, a transverse rib at each cell's far edge.
    const ceilT = Math.min(1, surfaceTone(c, zFlat, 0.2) + 0.1);
    const ceil = polyPath([
      [l - 0.5, H, d - 0.5],
      [l + 0.5, H, d - 0.5],
      [l + 0.5, H, d + 0.5],
      [l - 0.5, H, d + 0.5],
    ]);
    // A ceiling this deep in shadow prints as solid tone; ruling it only shows the paper between the lines.
    const ruledCeiling = ceilT < 0.72;
    if (ceil) out.parts.push(`<path d="${ceil}" fill="${ruledCeiling ? wash(ceilT, zFlat) : tone(ceilT)}"/>`);
    if (ruledCeiling) hatchFlat(out, l, d, H, ceilT, zFlat, seed + 11, 'across');
    const walls: { side: 'front' | 'left' | 'right'; face: Face; dir: Dir; z: number }[] = [];
    if (h.walls.has('front')) walls.push({ side: 'front', face: frontFace(d, l, seed + 1), dir: facing, z: d + 0.5 + BACKSET });
    if (h.walls.has('left')) walls.push({ side: 'left', face: sideFace(d, l, 'left', seed + 2), dir: LEFT[facing], z: zMid + 0.2 });
    if (h.walls.has('right')) walls.push({ side: 'right', face: sideFace(d, l, 'right', seed + 3), dir: RIGHT[facing], z: zMid + 0.2 });
    for (const wall of walls) {
      const f = wall.face;
      const z = Math.max(0.25, wall.z);
      // Side walls take the lantern at a glancing angle, so they sit a little darker.
      const t = surfaceTone(c, z, wall.side === 'front' ? 0 : 0.08);
      const w = weight(z);
      out.parts.push(`<path d="${polyPath(facePoly(f, [[0, 0], [0, H], [1, H], [1, 0]]))}" fill="${wash(t, z)}"/>`);
      hatchFace(out, f, t, z);
      masonry(out, f, w, t, z);
      const feature = c.faces[wall.dir];
      if (feature) drawFeature(out, f, feature, t, w);
      else vault(out, f, t, w, z, false);
    }

    // Open boundaries carry a vault arch: across the passage ahead, and along it at open sides.
    // The arch overhead at the sides of the cell you stand in is mostly behind you; its
    // underside would show only as stray slivers at the plate's top corners.
    const arches: { face: Face; z: number; soffit: ((u: number, v: number) => V3) | null }[] = [];
    if (c.open[facing]) {
      const z = d + 0.5;
      arches.push({ face: frontFace(d, l, seed + 4), z: z + BACKSET, soffit: (u, v) => [l - 0.5 + u, v, z + 0.05] });
    }
    if (l <= 0 && c.open[LEFT[facing]]) {
      const x = l - 0.5;
      arches.push({ face: sideFace(d, l, 'left', seed + 5), z: zMid + 0.2, soffit: d ? (u, v) => [x - 0.05, v, d - 0.5 + u] : null });
    }
    if (l >= 0 && c.open[RIGHT[facing]]) {
      const x = l + 0.5;
      arches.push({ face: sideFace(d, l, 'right', seed + 6), z: zMid + 0.2, soffit: d ? (u, v) => [x + 0.05, v, d + 0.5 - u] : null });
    }
    for (const a of arches) {
      const z = Math.max(0.25, a.z);
      const t = Math.max(0, surfaceTone(c, z, 0) - 0.04);
      if (a.soffit) {
        // The underside of the arch, a sliver of shadow between its near and far faces.
        const curve = archCurve().map(([u, v]): V2 => [0.06 + u * 0.88, v]);
        const soffit = [...curve.map(([u, v]) => a.face.at(u, v)), ...curve.reverse().map(([u, v]) => a.soffit!(u, v))];
        const sp = polyPath(soffit);
        if (sp) out.parts.push(`<path d="${sp}" fill="${tone(Math.min(1, t + 0.55))}" stroke="${tone(1)}" stroke-width="${fmt(weight(z) * 0.9)}" stroke-linejoin="round"/>`);
      }
      vault(out, a.face, t, weight(z), z, true);
    }
  }

  // How far the passage runs straight ahead.
  let ahead: number | null = null;
  let k = 0;
  let c: Cell | null = cell;
  while (c && k <= MAX_DEPTH) {
    if (!c.open[facing]) {
      ahead = k;
      break;
    }
    k += 1;
    c = grid(k, 0);
  }
  const wallAhead = ahead === null ? undefined : grid(ahead, 0)!.faces[facing];

  const svg =
    `<svg viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
    `<rect width="${VW}" height="${VH}" fill="${tone(1)}"/>` +
    `<g fill="none" stroke-linecap="round">${out.parts.join('')}</g>` +
    `<rect class="lamp" fill="url(#uc-lamp)" width="${VW}" height="${VH}"/>` +
    `</svg>`;
  return { svg, ahead, aheadFeature: wallAhead };
}

