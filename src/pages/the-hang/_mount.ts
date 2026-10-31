// How each work is presented on the wall (frame, mat, or rod) and how those are drawn: mouldings are height
// profiles shaded under the gallery's lights, so a gilt cove darkens where it turns away and glints where it faces up.

import type { Dims, Size } from './_dims';

export type Finish = 'carved' | 'gilt' | 'compo' | 'oak' | 'black' | 'thin-gilt' | 'ash' | 'white' | 'ebony' | 'rod';

export interface Mount {
  finish: Finish;
  /** Outer size on the wall, cm. */
  w: number;
  h: number;
  /** Moulding width, cm; 0 for a rod. */
  frame: number;
  /** Mat margins, cm. */
  mat: { top: number; side: number; bottom: number; tone: 'paper' | 'linen' } | null;
  /** The picture's rectangle inside the outer box, measured from its top-left, cm. */
  pic: { x: number; y: number; w: number; h: number };
  /** How far the front stands off the wall, cm. */
  depth: number;
  glazed: boolean;
  /** True when the frame's size came from the museum's own "Framed" measurement. */
  measuredFrame: boolean;
}

export interface MountInput {
  type: string | null;
  year: number | null;
  origin: string | null;
  pic: Size;
  dims: Dims;
}

const PAPER = new Set(['Print', 'Drawing and Watercolor', 'Photograph', 'Architectural Drawing', 'Graphic Design']);
const CLOTH = new Set(['Textile', 'Coverings and Hangings']);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function mountFor({ type, year, origin, pic, dims }: MountInput): Mount {
  const big = Math.max(pic.w, pic.h);
  const y = year ?? 1900;
  const t = type ?? '';

  if (CLOTH.has(t) && big >= 60) {
    const rod = 4;
    return {
      finish: 'rod',
      w: pic.w,
      h: pic.h + rod,
      frame: 0,
      mat: null,
      pic: { x: 0, y: rod, w: pic.w, h: pic.h },
      depth: 1.5,
      glazed: false,
      measuredFrame: false,
    };
  }

  if (PAPER.has(t) || CLOTH.has(t)) {
    const m = clamp(0.2 * big + 2.5, 3, 15);
    const mat = { top: m, side: m, bottom: m * 1.14, tone: CLOTH.has(t) ? ('linen' as const) : ('paper' as const) };
    const frame = big > 90 ? 3.2 : big > 40 ? 2.5 : 2;
    const japan = /japan/i.test(origin ?? '');
    const finish: Finish = CLOTH.has(t)
      ? 'white'
      : t === 'Photograph'
        ? 'black'
        : japan
          ? 'ash'
          : y < 1800
            ? 'ebony'
            : y < 1900
              ? 'thin-gilt'
              : 'oak';
    return {
      finish,
      w: pic.w + 2 * (mat.side + frame),
      h: pic.h + mat.top + mat.bottom + 2 * frame,
      frame,
      mat,
      pic: { x: frame + mat.side, y: frame + mat.top, w: pic.w, h: pic.h },
      depth: 3.5,
      glazed: true,
      measuredFrame: false,
    };
  }

  // Paintings, miniatures, icons, and anything else that hangs as an object.
  const mini = t === 'Miniature Painting' || big < 16;
  let frame = mini ? clamp(0.1 * big + 0.4, 0.5, 3) : clamp(0.055 * big + 2.5, 2.5, 16);
  let depth = mini ? 1.2 : clamp(frame * 0.6 + 2.5, 3, 14);
  let measuredFrame = false;
  const f = dims.framed;
  if (f) {
    // The framed size is given the same way round as the picture's own measurement.
    const turned = dims.image !== null && Math.abs(dims.image.w - pic.h) < 0.01 && Math.abs(dims.image.h - pic.w) < 0.01;
    const fw = turned ? f.h : f.w;
    const fh = turned ? f.w : f.h;
    const mx = (fw - pic.w) / 2;
    const my = (fh - pic.h) / 2;
    if (mx >= 0.2 && my >= 0.2 && mx <= 45 && my <= 45 && Math.abs(mx - my) <= Math.max(4, 0.5 * Math.max(mx, my))) {
      frame = (mx + my) / 2;
      measuredFrame = true;
    }
    if (f.d && f.d >= 1 && f.d <= 25) depth = f.d;
  }
  const finish: Finish = mini
    ? y < 1700
      ? 'ebony'
      : 'thin-gilt'
    : y < 1720
      ? 'carved'
      : y < 1860
        ? 'gilt'
        : y < 1905
          ? 'compo'
          : 'oak';
  return {
    finish,
    w: pic.w + 2 * frame,
    h: pic.h + 2 * frame,
    frame,
    mat: null,
    pic: { x: frame, y: frame, w: pic.w, h: pic.h },
    depth,
    glazed: mini,
    measuredFrame,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Drawing

type Material = 'gold' | 'black' | 'oak' | 'ash' | 'paint' | 'walnut';

interface Profile {
  /** Height stops across the moulding, outer edge (t 0) to sight edge (t 1), as fractions of its width. */
  z: [number, number][];
  /** Material by position; the last entry whose start is at or before t wins. */
  mats: [number, Material][];
  beads?: number[];
  gadroon?: [number, number];
  grain?: boolean;
}

const PROFILES: Record<Exclude<Finish, 'rod'>, Profile> = {
  carved: {
    z: [
      [0, 0.06],
      [0.035, 0.26],
      [0.07, 0.31],
      [0.1, 0.24],
      [0.14, 0.27],
      [0.2, 0.5],
      [0.3, 0.7],
      [0.4, 0.74],
      [0.5, 0.6],
      [0.62, 0.42],
      [0.72, 0.34],
      [0.77, 0.38],
      [0.81, 0.42],
      [0.85, 0.37],
      [0.9, 0.28],
      [0.95, 0.17],
      [1, 0.08],
    ],
    mats: [[0, 'gold']],
    beads: [0.068, 0.81],
    gadroon: [0.21, 0.5],
  },
  gilt: {
    z: [
      [0, 0.08],
      [0.05, 0.3],
      [0.1, 0.36],
      [0.16, 0.3],
      [0.3, 0.46],
      [0.42, 0.52],
      [0.55, 0.42],
      [0.7, 0.3],
      [0.8, 0.36],
      [0.86, 0.33],
      [0.93, 0.2],
      [1, 0.1],
    ],
    mats: [[0, 'gold']],
    beads: [0.83],
  },
  compo: {
    z: [
      [0, 0.16],
      [0.05, 0.5],
      [0.1, 0.64],
      [0.16, 0.56],
      [0.3, 0.34],
      [0.48, 0.24],
      [0.64, 0.28],
      [0.76, 0.38],
      [0.83, 0.42],
      [0.88, 0.36],
      [0.94, 0.22],
      [1, 0.12],
    ],
    mats: [[0, 'gold']],
    beads: [0.84],
    gadroon: [0.05, 0.16],
  },
  'thin-gilt': {
    z: [
      [0, 0.2],
      [0.2, 0.55],
      [0.45, 0.66],
      [0.75, 0.5],
      [1, 0.25],
    ],
    mats: [[0, 'gold']],
  },
  ebony: {
    z: [
      [0, 0.24],
      [0.15, 0.55],
      [0.55, 0.68],
      [0.8, 0.52],
      [0.86, 0.46],
      [0.88, 0.4],
      [0.94, 0.38],
      [1, 0.24],
    ],
    mats: [
      [0, 'black'],
      [0.87, 'gold'],
    ],
  },
  oak: {
    z: [
      [0, 0.3],
      [0.06, 0.62],
      [0.9, 0.62],
      [0.96, 0.5],
      [1, 0.34],
    ],
    mats: [[0, 'oak']],
    grain: true,
  },
  ash: {
    z: [
      [0, 0.32],
      [0.08, 0.6],
      [0.9, 0.6],
      [1, 0.4],
    ],
    mats: [[0, 'ash']],
    grain: true,
  },
  black: {
    z: [
      [0, 0.32],
      [0.1, 0.62],
      [0.9, 0.62],
      [1, 0.4],
    ],
    mats: [[0, 'black']],
  },
  white: {
    z: [
      [0, 0.32],
      [0.08, 0.6],
      [0.92, 0.6],
      [1, 0.42],
    ],
    mats: [[0, 'paint']],
  },
};

interface Look {
  albedo: [number, number, number];
  spec: [number, number, number];
  ks: number;
  shine: number;
}

const LOOKS: Record<Material, Look> = {
  gold: { albedo: [0.74, 0.55, 0.26], spec: [1, 0.9, 0.62], ks: 0.75, shine: 14 },
  black: { albedo: [0.07, 0.065, 0.06], spec: [0.9, 0.9, 0.88], ks: 0.32, shine: 36 },
  oak: { albedo: [0.6, 0.45, 0.29], spec: [1, 0.95, 0.88], ks: 0.07, shine: 10 },
  ash: { albedo: [0.82, 0.71, 0.55], spec: [1, 0.97, 0.9], ks: 0.06, shine: 10 },
  walnut: { albedo: [0.33, 0.22, 0.14], spec: [1, 0.95, 0.88], ks: 0.08, shine: 12 },
  paint: { albedo: [0.93, 0.92, 0.89], spec: [1, 1, 1], ks: 0.05, shine: 8 },
};

/** Toward the gallery's lights: from above, a little to the left, and out from the wall. */
const LIGHT = norm3([0.18, -0.78, 0.6]);
const HALF = norm3([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);

function norm3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function smoothZ(stops: [number, number][], t: number): number {
  let i = 0;
  while (i < stops.length - 2 && stops[i + 1][0] < t) i++;
  const [t0, z0] = stops[i];
  const [t1, z1] = stops[i + 1];
  const u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  const s = u * u * (3 - 2 * u);
  return z0 + (z1 - z0) * s;
}

function matAt(p: Profile, t: number): Material {
  let m = p.mats[0][1];
  for (const [start, mat] of p.mats) if (t >= start) m = mat;
  return m;
}

const SAMPLES = 34;

/** Shades a surface that rises by `slope` (cm per cm) toward the picture, on a side whose outward normal is (nx, ny). */
function shade(look: Look, slope: number, nx: number, ny: number, ao: number, lift = 1): string {
  const n = norm3([slope * nx, slope * ny, 1]);
  const diff = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
  const spec = Math.pow(Math.max(0, n[0] * HALF[0] + n[1] * HALF[1] + n[2] * HALF[2]), look.shine) * look.ks;
  const k = (0.3 + 0.85 * diff) * ao * lift;
  const r = look.albedo[0] * k + look.spec[0] * spec;
  const g = look.albedo[1] * k + look.spec[1] * spec;
  const b = look.albedo[2] * k + look.spec[2] * spec;
  return `rgb(${Math.round(Math.min(1, r) * 255)} ${Math.round(Math.min(1, g) * 255)} ${Math.round(Math.min(1, b) * 255)})`;
}

const SIDES: { nx: number; ny: number }[] = [
  { nx: 0, ny: -1 },
  { nx: 1, ny: 0 },
  { nx: 0, ny: 1 },
  { nx: -1, ny: 0 },
];

/** The four mitred pieces of a ring between an outer and an inner rectangle, as point lists. */
function ringPieces(x: number, y: number, w: number, h: number, m: number): [number, number][][] {
  const X = x + w;
  const Y = y + h;
  return [
    [
      [x, y],
      [X, y],
      [X - m, y + m],
      [x + m, y + m],
    ],
    [
      [X, y],
      [X, Y],
      [X - m, Y - m],
      [X - m, y + m],
    ],
    [
      [X, Y],
      [x, Y],
      [x + m, Y - m],
      [X - m, Y - m],
    ],
    [
      [x, Y],
      [x, y],
      [x + m, y + m],
      [x + m, Y - m],
    ],
  ];
}

function polygon(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function hash(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Draws a moulding ring with its outer box at (x, y, w, h) in px; `m` is the moulding width in px and `cm` the
 * moulding width in cm, which sets how steep the profile is.
 */
export function drawMoulding(
  ctx: CanvasRenderingContext2D,
  finish: Exclude<Finish, 'rod'>,
  x: number,
  y: number,
  w: number,
  h: number,
  m: number,
  cm: number,
  seed: number,
) {
  const p = PROFILES[finish];
  const relief = cm * 0.42;
  const zMax = Math.max(...p.z.map((s) => s[1]));
  const pieces = ringPieces(x, y, w, h, m);
  for (let side = 0; side < 4; side++) {
    const { nx, ny } = SIDES[side];
    const pts = pieces[side];
    // Gradient runs inward from the outer edge, square to the side.
    const ox = side === 1 ? x + w : side === 3 ? x : x + w / 2;
    const oy = side === 0 ? y : side === 2 ? y + h : y + h / 2;
    const grad = ctx.createLinearGradient(ox, oy, ox - nx * m, oy - ny * m);
    let prevMat: Material | null = null;
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const dt = 0.5 / SAMPLES;
      const slope = ((smoothZ(p.z, t + dt) - smoothZ(p.z, t - dt)) * relief) / (2 * dt * cm);
      const ao = 0.7 + (0.3 * smoothZ(p.z, t)) / zMax;
      const mat = matAt(p, t);
      const look = LOOKS[mat];
      const c = shade(look, slope, nx, ny, ao);
      if (prevMat && mat !== prevMat) grad.addColorStop(Math.max(0, t - 0.001), c);
      grad.addColorStop(t, c);
      prevMat = mat;
    }
    polygon(ctx, pts);
    ctx.fillStyle = grad;
    ctx.fill();

    if (p.grain && m > 6) {
      ctx.save();
      polygon(ctx, pts);
      ctx.clip();
      const along = side % 2 === 0;
      const len = along ? w : h;
      const lines = Math.min(28, Math.round(m / 1.6));
      for (let k = 0; k < lines; k++) {
        const r = hash(seed * 31 + side * 997 + k);
        const off = ((k + 0.5) / lines) * m;
        ctx.strokeStyle = r > 0.5 ? 'rgb(60 40 20 / 0.16)' : 'rgb(255 240 220 / 0.1)';
        ctx.lineWidth = Math.max(0.5, (m / lines) * (0.3 + r * 0.6));
        ctx.beginPath();
        const wobble = (hash(seed + k * 7 + side) - 0.5) * m * 0.12;
        if (along) {
          const yy = side === 0 ? y + off : y + h - off;
          ctx.moveTo(x, yy);
          ctx.bezierCurveTo(x + len * 0.33, yy + wobble, x + len * 0.66, yy - wobble, x + len, yy);
        } else {
          const xx = side === 3 ? x + off : x + w - off;
          ctx.moveTo(xx, y);
          ctx.bezierCurveTo(xx + wobble, y + len * 0.33, xx - wobble, y + len * 0.66, xx, y + len);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Gadrooning: a run of slanted reeds carved into one band, each lit on its upper flank.
  if (p.gadroon && m > 14) {
    const [g0, g1] = p.gadroon;
    const band = (g1 - g0) * m;
    const pitch = Math.max(3, band * 0.55);
    for (let side = 0; side < 4; side++) {
      const { nx, ny } = SIDES[side];
      ctx.save();
      polygon(ctx, ringPieces(x + g0 * m, y + g0 * m, w - 2 * g0 * m, h - 2 * g0 * m, band)[side]);
      ctx.clip();
      const along = side % 2 === 0;
      const len = along ? w : h;
      // A reed's flanks face along the side, so they are lit as if the side were turned a quarter.
      const lit = shade(LOOKS.gold, 0.9, -ny, nx, 1, 1.05);
      const dark = shade(LOOKS.gold, -0.9, -ny, nx, 0.75);
      for (let s = 0; s * pitch < len; s++) {
        const a = s * pitch;
        ctx.beginPath();
        if (along) {
          const yy = side === 0 ? y + g0 * m : y + h - g1 * m;
          ctx.moveTo(x + a, yy);
          ctx.lineTo(x + a + pitch * 0.5, yy);
          ctx.lineTo(x + a + pitch * 0.5 + band * 0.6, yy + band);
          ctx.lineTo(x + a + band * 0.6, yy + band);
        } else {
          const xx = side === 3 ? x + g0 * m : x + w - g1 * m;
          ctx.moveTo(xx, y + a);
          ctx.lineTo(xx, y + a + pitch * 0.5);
          ctx.lineTo(xx + band, y + a + pitch * 0.5 + band * 0.6);
          ctx.lineTo(xx + band, y + a + band * 0.6);
        }
        ctx.closePath();
        ctx.fillStyle = (s + side) % 2 === 0 ? lit : dark;
        ctx.globalAlpha = 0.42;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  // Beads: a row of pearls along one line of the profile, each lit from above.
  if (p.beads) {
    for (const bt of p.beads) {
      const inset = bt * m;
      const r = Math.max(0.6, m * 0.026);
      if (r < 1.1) continue;
      const gap = r * 2.5;
      const bx = x + inset;
      const by = y + inset;
      const bw = w - 2 * inset;
      const bh = h - 2 * inset;
      const runs: [number, number, number, number][] = [
        [bx, by, bw, 0],
        [bx + bw, by, 0, bh],
        [bx, by + bh, bw, 0],
        [bx, by, 0, bh],
      ];
      for (const [sx, sy, dx, dy] of runs) {
        const len = dx + dy;
        const n = Math.floor(len / gap);
        for (let i = 1; i < n; i++) {
          const cx = sx + (dx ? (i / n) * dx : 0);
          const cy = sy + (dy ? (i / n) * dy : 0);
          const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.45, r * 0.1, cx, cy, r * 1.1);
          g.addColorStop(0, 'rgb(255 238 186)');
          g.addColorStop(0.45, 'rgb(196 150 72)');
          g.addColorStop(1, 'rgb(92 62 26)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // Mitre joints.
  if (m > 5) {
    ctx.strokeStyle = 'rgb(30 20 10 / 0.35)';
    ctx.lineWidth = Math.max(0.5, m * 0.015);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + m, y + m);
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w - m, y + m);
    ctx.moveTo(x + w, y + h);
    ctx.lineTo(x + w - m, y + h - m);
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + m, y + h - m);
    ctx.stroke();
  }
}

/** A mat board with its bevelled window, outer box at (x, y, w, h) px, window at (wx, wy, ww, wh) px. */
export function drawMat(
  ctx: CanvasRenderingContext2D,
  tone: 'paper' | 'linen',
  x: number,
  y: number,
  w: number,
  h: number,
  wx: number,
  wy: number,
  ww: number,
  wh: number,
  bevel: number,
) {
  ctx.fillStyle = tone === 'linen' ? 'rgb(222 214 198)' : 'rgb(241 237 227)';
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.rect(wx + ww, wy, -ww, wh);
  ctx.fill('evenodd');
  if (bevel < 0.4) return;
  const core: Look = { albedo: [0.99, 0.98, 0.95], spec: [1, 1, 1], ks: 0, shine: 1 };
  const pieces = ringPieces(wx - bevel, wy - bevel, ww + 2 * bevel, wh + 2 * bevel, bevel);
  for (let side = 0; side < 4; side++) {
    const { nx, ny } = SIDES[side];
    polygon(ctx, pieces[side]);
    // The bevel falls toward the picture: a slope of -1 seen from the window's side.
    ctx.fillStyle = shade(core, 1, -nx, -ny, 1, 1.02);
    ctx.fill();
  }
}

/** A hanging rod with ball finials across the top of a textile, rod centred at y, px. */
export function drawRod(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number) {
  const over = d * 1.8;
  const g = ctx.createLinearGradient(0, y - d / 2, 0, y + d / 2);
  g.addColorStop(0, 'rgb(150 140 128)');
  g.addColorStop(0.35, 'rgb(232 226 214)');
  g.addColorStop(0.7, 'rgb(96 90 82)');
  g.addColorStop(1, 'rgb(52 48 44)');
  ctx.fillStyle = g;
  ctx.fillRect(x - over, y - d / 2, w + 2 * over, d);
  for (const cx of [x - over, x + w + over]) {
    const r = d * 0.85;
    const b = ctx.createRadialGradient(cx - r * 0.3, y - r * 0.4, r * 0.1, cx, y, r);
    b.addColorStop(0, 'rgb(240 234 222)');
    b.addColorStop(0.5, 'rgb(140 130 118)');
    b.addColorStop(1, 'rgb(48 44 40)');
    ctx.fillStyle = b;
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
