// The mobile as data: a tree of wire arms, each carrying a painted plate or another arm at
// either end. Units are metres and kilograms throughout.

export type Pt = [number, number];

export type ShapeKey = 'disc' | 'leaf' | 'petal' | 'crescent' | 'bean' | 'fin' | 'blade' | 'fan';

export interface Plate {
  kind: 'plate';
  /** A named outline, or one the visitor cut: plate coordinates, stem at the origin, reaching along +u. */
  shape: ShapeKey | Pt[];
  /** Reach from the stem to the far edge, in metres. */
  size: number;
  paint: PaintKey;
  /** Turn of the plate about its wire, in degrees: 0 stands it upright, 90 lays it flat. */
  roll: number;
}

export interface Arm {
  kind: 'arm';
  /** Chord length end to end, metres. */
  len: number;
  /** Where the hanging loop sits along the arm, 0 (left end) to 1 (right end). */
  hook: number;
  /** Height of the arc above its chord, as a fraction of the length. */
  sag: number;
  /** Length of the link this arm hangs by: an S-hook below another arm, or the thread from the ceiling. */
  drop: number;
  ends: [Node, Node];
}

export type Node = Plate | Arm;

// Sheet and wire.
export const SHEET_DENSITY = 2700 * 0.0016; // 1.6 mm aluminium, kg/m^2
export const WIRE_DENSITY = 7850 * Math.PI * 0.00105 * 0.00105; // 2.1 mm steel wire, kg/m
export const LOOP_RISE = 0.012; // the hanging loop stands this far above the arc
export const MIN_ARM = 0.14;
export const MAX_ARM = 0.95;

export type PaintKey =
  | 'vermilion'
  | 'cadmium'
  | 'cobalt'
  | 'black'
  | 'chalk'
  | 'sage'
  | 'teal'
  | 'rose'
  | 'plum'
  | 'aluminium'
  | 'copper'
  | 'brass';

export interface Paint {
  name: string;
  /** sRGB colour of the paint in full light. */
  rgb: [number, number, number];
  /** Bare metal shows a hard sheen; enamel a soft one. */
  metal: boolean;
}

export const PAINTS: Record<PaintKey, Paint> = {
  vermilion: { name: 'Vermilion', rgb: [196, 62, 40], metal: false },
  cadmium: { name: 'Cadmium yellow', rgb: [226, 166, 36], metal: false },
  cobalt: { name: 'Cobalt', rgb: [40, 72, 150], metal: false },
  black: { name: 'Black', rgb: [30, 29, 28], metal: false },
  chalk: { name: 'Chalk white', rgb: [236, 231, 220], metal: false },
  sage: { name: 'Sage', rgb: [136, 152, 112], metal: false },
  teal: { name: 'Deep teal', rgb: [36, 104, 100], metal: false },
  rose: { name: 'Rose', rgb: [216, 140, 132], metal: false },
  plum: { name: 'Plum', rgb: [92, 52, 80], metal: false },
  aluminium: { name: 'Bare aluminium', rgb: [184, 188, 192], metal: true },
  copper: { name: 'Copper', rgb: [178, 104, 60], metal: true },
  brass: { name: 'Brass', rgb: [186, 150, 66], metal: true },
};

export const PAINT_KEYS = Object.keys(PAINTS) as PaintKey[];

export const SHAPE_NAMES: Record<ShapeKey, string> = {
  disc: 'Disc',
  leaf: 'Leaf',
  petal: 'Teardrop',
  crescent: 'Crescent',
  bean: 'Bean',
  fin: 'Fin',
  blade: 'Blade',
  fan: 'Fan',
};
export const SHAPE_KEYS = Object.keys(SHAPE_NAMES) as ShapeKey[];

const N = 40;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Outline of a named shape in unit plate coordinates: stem at (0, 0), far edge at u = 1. */
function unitShape(key: ShapeKey): Pt[] {
  switch (key) {
    case 'disc':
      return range(N).map((i) => {
        const t = (i / N) * Math.PI * 2;
        return [0.5 - 0.5 * Math.cos(t), 0.5 * Math.sin(t)];
      });
    case 'leaf': {
      // Pointed at both ends and fuller towards the tip, like a willow leaf seen flat.
      const top = range(N / 2 + 1).map((i): Pt => {
        const t = (i / (N / 2)) * Math.PI;
        const u = (1 - Math.cos(t)) / 2;
        return [u, 0.3 * Math.sin(t) * (0.85 + 0.3 * u)];
      });
      const bottom = top
        .slice(1, -1)
        .reverse()
        .map(([u, v]): Pt => [u, -v * 0.92]);
      return [...top, ...bottom];
    }
    case 'petal': {
      // A teardrop: a point at the stem, round at the far end.
      const top = range(N / 2 + 1).map((i): Pt => {
        const t = (i / (N / 2)) * Math.PI;
        const u = (1 - Math.cos(t)) / 2;
        return [u, 0.42 * Math.sin(t) * Math.sqrt(u)];
      });
      const bottom = top
        .slice(1, -1)
        .reverse()
        .map(([u, v]): Pt => [u, -v]);
      return [...top, ...bottom];
    }
    case 'crescent': {
      // A horn of a new moon: a curved spine, widest in the middle, a point at each end.
      const spine = (s: number): Pt => [0.5 - 0.5 * Math.cos(Math.PI * s), 0.36 * Math.sin(Math.PI * s)];
      const out: Pt[] = [];
      const inner: Pt[] = [];
      const M = N / 2;
      for (let i = 0; i <= M; i++) {
        const s = i / M;
        const [x, y] = spine(s);
        const [x2, y2] = spine(Math.min(1, s + 0.001));
        const [x1, y1] = spine(Math.max(0, s - 0.001));
        const tx = x2 - x1;
        const ty = y2 - y1;
        const l = Math.hypot(tx, ty) || 1;
        const nx = -ty / l;
        const ny = tx / l;
        const w = 0.17 * Math.pow(Math.sin(Math.PI * s), 0.75);
        out.push([x + nx * w, y + ny * w * 1.25]);
        inner.push([x - nx * w * 0.35, y - ny * w * 0.6]);
      }
      return [...out, ...inner.slice(1, -1).reverse()];
    }
    case 'bean': {
      return range(N).map((i): Pt => {
        const t = (i / N) * Math.PI * 2 + Math.PI;
        const dent = 1 - 0.3 * Math.exp(-(((t % (Math.PI * 2)) - Math.PI / 2) ** 2) / 0.22);
        return [0.5 + 0.5 * Math.cos(t), 0.31 * Math.sin(t) * (Math.sin(t) > 0 ? dent : 1)];
      });
    }
    case 'fin': {
      // A rounded, lopsided triangle.
      const corners: Pt[] = [
        [0, 0],
        [1, -0.06],
        [0.42, 0.5],
      ];
      return roundPolygon(corners, 0.09, 10);
    }
    case 'blade': {
      const spine = (s: number): Pt => [s, 0.09 * Math.sin(Math.PI * s)];
      const out: Pt[] = [];
      const inner: Pt[] = [];
      const M = N / 2;
      for (let i = 0; i <= M; i++) {
        const s = i / M;
        const [x, y] = spine(s);
        const w = 0.1 * Math.pow(Math.sin(Math.PI * s), 0.7) * (0.8 + 0.4 * s);
        out.push([x, y + w]);
        inner.push([x, y - w]);
      }
      return [...out, ...inner.slice(1, -1).reverse()];
    }
    case 'fan': {
      const half = (34 * Math.PI) / 180;
      const arc = range(17).map((i): Pt => {
        const a = -half + (i / 16) * half * 2;
        return [Math.cos(a), Math.sin(a)];
      });
      return [[0, 0], ...arc];
    }
  }
}

/** Round each corner of a polygon with a short arc. */
function roundPolygon(pts: Pt[], r: number, steps: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const a = pts[(i + pts.length - 1) % pts.length]!;
    const b = pts[(i + 1) % pts.length]!;
    const da = norm([a[0] - p[0], a[1] - p[1]]);
    const db = norm([b[0] - p[0], b[1] - p[1]]);
    const p1: Pt = [p[0] + da[0] * r, p[1] + da[1] * r];
    const p2: Pt = [p[0] + db[0] * r, p[1] + db[1] * r];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // Quadratic Bezier through the corner.
      const x = (1 - t) * (1 - t) * p1[0] + 2 * (1 - t) * t * p[0] + t * t * p2[0];
      const y = (1 - t) * (1 - t) * p1[1] + 2 * (1 - t) * t * p[1] + t * t * p2[1];
      out.push([x, y]);
    }
  }
  // Keep the stem on the origin: shift so the leftmost point sits at u = 0, v of that point at 0.
  let minI = 0;
  for (let i = 1; i < out.length; i++) if (out[i]![0] < out[minI]![0]) minI = i;
  const [mu, mv] = out[minI]!;
  const maxU = Math.max(...out.map((q) => q[0])) - mu;
  return out.map(([u, v]): Pt => [(u - mu) / maxU, (v - mv) / maxU]);
}

function norm([x, y]: Pt): Pt {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

const unitCache = new Map<ShapeKey, Pt[]>();
export function unitOutline(shape: ShapeKey | Pt[]): Pt[] {
  if (typeof shape !== 'string') return shape;
  let pts = unitCache.get(shape);
  if (!pts) {
    pts = unitShape(shape);
    unitCache.set(shape, pts);
  }
  return pts;
}

/** Area and centroid of a polygon (shoelace). */
export function areaCentroid(pts: Pt[]): { area: number; cu: number; cv: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    const c = x0 * y1 - x1 * y0;
    a += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return { area: 0, cu: 0.5, cv: 0 };
  return { area: Math.abs(a), cu: cx / (6 * a), cv: cy / (6 * a) };
}

export interface PlateGeom {
  outline: Pt[]; // metres
  area: number;
  mass: number;
  cu: number;
  cv: number;
  /** Distance from the centroid to the furthest point of the outline. */
  radius: number;
}

export function plateGeom(p: Plate): PlateGeom {
  const unit = unitOutline(p.shape);
  const outline = unit.map(([u, v]): Pt => [u * p.size, v * p.size]);
  const { area, cu, cv } = areaCentroid(outline);
  let radius = 0;
  for (const [u, v] of outline) radius = Math.max(radius, Math.hypot(u - cu, v - cv));
  return { outline, area, mass: area * SHEET_DENSITY, cu, cv, radius };
}

/** Height of an arm's arc above its chord at x along it. */
export function arcY(a: Arm, x: number): number {
  const s = x / a.len;
  return 4 * a.sag * a.len * s * (1 - s);
}

/** Slope of the arc at x. */
export function arcSlope(a: Arm, x: number): number {
  return 4 * a.sag * (1 - (2 * x) / a.len);
}

export function arcLength(a: Arm): number {
  return a.len * (1 + (8 / 3) * a.sag * a.sag);
}

export function mass(n: Node): number {
  if (n.kind === 'plate') return plateGeom(n).mass;
  return arcLength(n) * WIRE_DENSITY + mass(n.ends[0]) + mass(n.ends[1]);
}

/** Where a plate at an end puts its centroid, in the arm's own plane (x along the chord, y up). */
export function plateCentroidLocal(a: Arm, side: 0 | 1, g: PlateGeom, roll: number): Pt {
  const x = side === 0 ? 0 : a.len;
  const slope = arcSlope(a, x);
  // Outward tangent at this end, and the in-plane perpendicular that points upward.
  const ux0 = side === 0 ? -1 : 1;
  const uy0 = side === 0 ? -slope : slope;
  const l = Math.hypot(ux0, uy0);
  const ux = ux0 / l;
  const uy = uy0 / l;
  let wx = -uy;
  let wy = ux;
  if (wy < 0) {
    wx = -wx;
    wy = -wy;
  }
  const c = Math.cos((roll * Math.PI) / 180);
  return [x + g.cu * ux + g.cv * c * wx, g.cu * uy + g.cv * c * wy];
}

/** The point mass each part of an arm contributes, in the arm's plane, measured from the left end. */
export function massPoints(a: Arm): { m: number; x: number; y: number }[] {
  const pts: { m: number; x: number; y: number }[] = [];
  const wire = arcLength(a) * WIRE_DENSITY;
  const S = 10;
  for (let i = 0; i < S; i++) {
    const x = ((i + 0.5) / S) * a.len;
    pts.push({ m: wire / S, x, y: arcY(a, x) });
  }
  a.ends.forEach((n, i) => {
    const side = i as 0 | 1;
    if (n.kind === 'plate') {
      const g = plateGeom(n);
      const [x, y] = plateCentroidLocal(a, side, g, n.roll);
      pts.push({ m: g.mass, x, y });
    } else {
      pts.push({ m: mass(n), x: side === 0 ? 0 : a.len, y: 0 });
    }
  });
  return pts;
}

/** The hook position (0 to 1) at which the arm hangs level. */
export function balancePoint(a: Arm): number {
  let m = 0;
  let mx = 0;
  for (const p of massPoints(a)) {
    m += p.m;
    mx += p.m * p.x;
  }
  return Math.min(0.98, Math.max(0.02, mx / m / a.len));
}

/** Balance every arm from the bottom up, the way a mobile is built. */
export function balanceAll(n: Node): void {
  if (n.kind === 'plate') return;
  balanceAll(n.ends[0]);
  balanceAll(n.ends[1]);
  n.hook = balancePoint(n);
}

export function* arms(n: Node): Generator<Arm> {
  if (n.kind === 'plate') return;
  yield n;
  yield* arms(n.ends[0]);
  yield* arms(n.ends[1]);
}

export function* plates(n: Node): Generator<Plate> {
  if (n.kind === 'plate') {
    yield n;
    return;
  }
  yield* plates(n.ends[0]);
  yield* plates(n.ends[1]);
}

export function clone<T extends Node>(n: T): T {
  return JSON.parse(JSON.stringify(n)) as T;
}

// Presets. Hooks are found by balanceAll when a preset loads.
const P = (shape: ShapeKey, size: number, paint: PaintKey, roll = 0): Plate => ({
  kind: 'plate',
  shape,
  size,
  paint,
  roll,
});
const A = (len: number, drop: number, left: Node, right: Node, sag = 0.07): Arm => ({
  kind: 'arm',
  len,
  hook: 0.5,
  sag,
  drop,
  ends: [left, right],
});

export interface Preset {
  key: string;
  title: string;
  build: () => Arm;
}

export const PRESETS: Preset[] = [
  {
    key: 'cascade',
    title: 'Seven Leaves Falling',
    build: () =>
      A(
        0.74,
        0.34,
        P('leaf', 0.24, 'black', 12),
        A(
          0.6,
          0.15,
          A(0.34, 0.12, P('disc', 0.1, 'vermilion', 70), P('petal', 0.13, 'chalk', 20), 0.08),
          A(
            0.5,
            0.16,
            P('fin', 0.17, 'cobalt', 35),
            A(
              0.42,
              0.15,
              A(0.26, 0.11, P('blade', 0.12, 'cadmium', 80), P('disc', 0.08, 'black', 10), 0.09),
              P('crescent', 0.16, 'copper', 60),
            ),
          ),
        ),
      ),
  },
  {
    key: 'pair',
    title: 'Two Weights',
    build: () => A(0.56, 0.5, P('disc', 0.15, 'vermilion', 8), P('petal', 0.2, 'black', 70)),
  },
  {
    key: 'orchard',
    title: 'Orchard',
    build: () =>
      A(
        0.86,
        0.3,
        A(0.44, 0.16, P('leaf', 0.15, 'sage', 30), P('bean', 0.12, 'plum', 80), 0.08),
        A(
          0.5,
          0.13,
          A(0.36, 0.14, P('petal', 0.12, 'rose', 50), P('leaf', 0.13, 'teal', 15), 0.08),
          A(
            0.4,
            0.2,
            P('fan', 0.13, 'cadmium', 75),
            A(0.3, 0.12, P('disc', 0.09, 'chalk', 85), P('leaf', 0.12, 'sage', 40), 0.09),
          ),
        ),
      ),
  },
  {
    key: 'shoal',
    title: 'Shoal',
    build: () => {
      const paints: PaintKey[] = ['aluminium', 'teal', 'aluminium', 'cobalt', 'brass', 'aluminium', 'teal', 'chalk'];
      let n: Node = A(0.22, 0.1, P('blade', 0.13, paints[7]!, 10), P('blade', 0.11, paints[6]!, 20), 0.1);
      for (let i = 5; i >= 0; i--) {
        const len = 0.28 + (5 - i) * 0.075;
        n = A(len, i === 0 ? 0.32 : 0.12, P('blade', 0.13 + (5 - i) * 0.012, paints[i]!, 5 + i * 9), n, 0.07);
      }
      return n as Arm;
    },
  },
];

export function presetByKey(key: string): Preset {
  return PRESETS.find((p) => p.key === key) ?? PRESETS[0]!;
}

// A share link carries the whole mobile in the URL fragment.
type Packed = { p: string | number[]; s: number; c: string; r: number } | { l: number; h: number; g: number; d: number; e: [Packed, Packed] };

const r3 = (x: number) => Math.round(x * 1000) / 1000;

function pack(n: Node): Packed {
  if (n.kind === 'plate') {
    const p = typeof n.shape === 'string' ? n.shape : n.shape.flatMap(([u, v]) => [r3(u), r3(v)]);
    return { p, s: r3(n.size), c: n.paint, r: Math.round(n.roll) };
  }
  return { l: r3(n.len), h: r3(n.hook), g: r3(n.sag), d: r3(n.drop), e: [pack(n.ends[0]), pack(n.ends[1])] };
}

const clamp = (x: unknown, lo: number, hi: number, dflt: number) =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;

function unpack(o: unknown, depth: number): Node {
  if (depth > 12 || typeof o !== 'object' || o === null) throw new Error('bad mobile');
  const r = o as Record<string, unknown>;
  if ('e' in r) {
    const e = r.e;
    if (!Array.isArray(e) || e.length !== 2) throw new Error('bad arm');
    return {
      kind: 'arm',
      len: clamp(r.l, MIN_ARM, MAX_ARM, 0.4),
      hook: clamp(r.h, 0.02, 0.98, 0.5),
      sag: clamp(r.g, 0.02, 0.2, 0.07),
      drop: clamp(r.d, 0.05, 0.6, 0.14),
      ends: [unpack(e[0], depth + 1), unpack(e[1], depth + 1)],
    };
  }
  let shape: ShapeKey | Pt[];
  if (typeof r.p === 'string' && (SHAPE_KEYS as string[]).includes(r.p)) shape = r.p as ShapeKey;
  else if (Array.isArray(r.p) && r.p.length >= 6 && r.p.length <= 400 && r.p.every((x) => typeof x === 'number')) {
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < r.p.length; i += 2) pts.push([clamp(r.p[i], -0.2, 1.2, 0), clamp(r.p[i + 1], -1, 1, 0)]);
    shape = pts;
  } else shape = 'disc';
  const paint = typeof r.c === 'string' && (PAINT_KEYS as string[]).includes(r.c) ? (r.c as PaintKey) : 'black';
  return { kind: 'plate', shape, size: clamp(r.s, 0.05, 0.3, 0.12), paint, roll: clamp(r.r, -90, 90, 0) };
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeMobile(root: Arm, title: string): Promise<string> {
  const json = JSON.stringify({ t: title.slice(0, 80), m: pack(root) });
  const raw = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'function') {
    return 'z' + b64url(await pipe(raw, new CompressionStream('deflate-raw')));
  }
  return 'j' + b64url(raw);
}

export async function decodeMobile(code: string): Promise<{ root: Arm; title: string } | null> {
  try {
    let raw: Uint8Array;
    if (code.startsWith('z') && typeof DecompressionStream === 'function') {
      raw = await pipe(unb64url(code.slice(1)), new DecompressionStream('deflate-raw'));
    } else if (code.startsWith('j')) raw = unb64url(code.slice(1));
    else return null;
    const o = JSON.parse(new TextDecoder().decode(raw)) as { t?: unknown; m?: unknown };
    const root = unpack(o.m, 0);
    if (root.kind !== 'arm') return null;
    return { root, title: typeof o.t === 'string' ? o.t.slice(0, 80) : 'Untitled' };
  } catch {
    return null;
  }
}
