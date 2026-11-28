// Raises a set-out window: the struck members become moulded stone bars, every opening they close off is glazed,
// and the whole is seen from inside against daylight or from outside in sun.

import type { Glazing } from './_commissions';
import { rng, type Piece, type Rect } from './_geom';

type RGB = [number, number, number];
type Side = 'inside' | 'outside';

const lin = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((c) => Math.pow(c, 2.2)) as RGB;
};
const toByte = (c: number): number => Math.round(255 * Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.2));

const GLASS = {
  ruby: lin('#a3101a'),
  cobalt: lin('#2340a6'),
  emerald: lin('#1b7038'),
  amber: lin('#dc9c1e'),
  murrey: lin('#6c2356'),
  white: lin('#cfd8bf'),
};
type GlassName = keyof typeof GLASS;

interface Pane {
  field: GlassName;
  border: GlassName | null;
  /** Border width in world units. */
  borderW: number;
  quarries: boolean;
  /** Streak direction and texture offset. */
  angle: number;
  seed: number;
}

/** World units. */
const BAR = 0.1;
const LEAD = 0.013;
/** The inner splay, lit by the glass. */
const SPLAY = 0.34;
/** The outer chamfered reveal, and the hood mould over the arch. */
const REVEAL = 0.15;
const HOOD: [number, number] = [0.2, 0.28];
const RECESS = 0.07;
const COURSE = 0.44;

const STONE_IN = lin('#3b332c');
const STONE_OUT = lin('#c4b18c');
const WALL_IN = '#2a241f';
const SUN = norm3([-0.5, -0.62, 0.6]);
const ROOM = norm3([-0.4, -0.5, 0.77]);

function norm3(v: number[]): RGB {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in [0, 1). */
function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const w = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}

/** Squared Euclidean distance transform (Felzenszwalb and Huttenlocher), in place over rows then columns. */
function edt(f: Float32Array, w: number, h: number): void {
  const n = Math.max(w, h);
  const z = new Float32Array(n + 1);
  const vv = new Int32Array(n);
  const tmp = new Float32Array(n);
  const out = new Float32Array(n);
  const pass = (get: (i: number) => number, set: (i: number, val: number) => void, len: number): void => {
    for (let i = 0; i < len; i++) tmp[i] = get(i);
    let k = 0;
    vv[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = (tmp[q] + q * q - (tmp[vv[k]] + vv[k] * vv[k])) / (2 * q - 2 * vv[k]);
      while (s <= z[k]) {
        k--;
        s = (tmp[q] + q * q - (tmp[vv[k]] + vv[k] * vv[k])) / (2 * q - 2 * vv[k]);
      }
      k++;
      vv[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      const d = q - vv[k];
      out[q] = d * d + tmp[vv[k]];
    }
    for (let i = 0; i < len; i++) set(i, out[i]);
  };
  for (let y = 0; y < h; y++) {
    const o = y * w;
    pass(
      (i) => f[o + i],
      (i, val) => (f[o + i] = val),
      w,
    );
  }
  for (let x = 0; x < w; x++) {
    pass(
      (i) => f[i * w + x],
      (i, val) => (f[i * w + x] = val),
      h,
    );
  }
}

function boxBlur(src: Float32Array, w: number, h: number, ch: number, r: number, passes: number): void {
  const tmp = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++)
      for (let c = 0; c < ch; c++) {
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += src[(y * w + Math.min(w - 1, Math.max(0, x))) * ch + c];
        for (let x = 0; x < w; x++) {
          tmp[(y * w + x) * ch + c] = acc / (2 * r + 1);
          const add = Math.min(w - 1, x + r + 1);
          const sub = Math.max(0, x - r);
          acc += src[(y * w + add) * ch + c] - src[(y * w + sub) * ch + c];
        }
      }
    for (let x = 0; x < w; x++)
      for (let c = 0; c < ch; c++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * ch + c];
        for (let y = 0; y < h; y++) {
          src[(y * w + x) * ch + c] = acc / (2 * r + 1);
          const add = Math.min(h - 1, y + r + 1);
          const sub = Math.max(0, y - r);
          acc += tmp[(add * w + x) * ch + c] - tmp[(sub * w + x) * ch + c];
        }
      }
  }
}

interface Built {
  w: number;
  h: number;
  px: number;
  frame: Rect;
  /** Pane index per pixel, -1 for stone, -2 for outside. */
  label: Int32Array;
  panes: Pane[];
  /** Distance to the nearest glass pixel (stone) or to the nearest stone pixel (glass), in pixels. */
  dGlass: Float32Array;
  dStone: Float32Array;
  glass: Record<Side, HTMLCanvasElement | null>;
  stone: Record<Side, HTMLCanvasElement | null>;
  glow: HTMLCanvasElement | null;
  /** Average transmitted colour, for the light on the wall. */
  tint: RGB;
  /** World height of the springing; the hood mould stops there. */
  springY: number;
  hood: boolean;
  glazing: Glazing;
}

export class WindowView {
  private ctx: CanvasRenderingContext2D;
  private built: Built | null = null;
  private side: Side = 'inside';
  private t0 = 0;
  private raf = 0;
  private progress = 1;
  private dpr = 1;
  private w = 0;
  private h = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    this.ctx = ctx;
  }

  /** Returns false when the stone closes nothing off. */
  build(pieces: Piece[], frame: Rect, glazing: Glazing): boolean {
    const fw = frame.x1 - frame.x0;
    const fh = frame.y1 - frame.y0;
    const px = Math.min(1250 / fh, 1000 / fw);
    const w = Math.ceil(fw * px);
    const h = Math.ceil(fh * px);
    const n = w * h;

    // Strike the stone.
    const m = document.createElement('canvas');
    m.width = w;
    m.height = h;
    const g = m.getContext('2d', { willReadFrequently: true });
    if (!g) return false;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#000';
    g.lineWidth = BAR * px;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const X = (x: number): number => (x - frame.x0) * px;
    const Y = (y: number): number => (frame.y1 - y) * px;
    for (const p of pieces) {
      g.beginPath();
      if (p.kind === 'seg') {
        g.moveTo(X(p.p.x), Y(p.p.y));
        g.lineTo(X(p.q.x), Y(p.q.y));
      } else {
        g.arc(X(p.c.x), Y(p.c.y), p.r * px, -p.a1, -p.a0);
      }
      g.stroke();
    }
    const img = g.getImageData(0, 0, w, h).data;
    const label = new Int32Array(n);
    for (let i = 0; i < n; i++) label[i] = img[i * 4] < 128 ? -1 : -3;

    // Outside: everything open that reaches the edge.
    const queue = new Int32Array(n);
    const flood = (
      seed: number,
      id: number,
    ): { area: number; sx: number; sy: number; x0: number; x1: number; y0: number; y1: number } => {
      let head = 0;
      let tail = 0;
      queue[tail++] = seed;
      label[seed] = id;
      let area = 0;
      let sx = 0;
      let sy = 0;
      let x0 = w;
      let x1 = 0;
      let y0 = h;
      let y1 = 0;
      while (head < tail) {
        const i = queue[head++];
        const x = i % w;
        const y = (i - x) / w;
        area++;
        sx += x;
        sy += y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        const visit = (j: number): void => {
          if (label[j] !== -3) return;
          label[j] = id;
          queue[tail++] = j;
        };
        if (x > 0) visit(i - 1);
        if (x < w - 1) visit(i + 1);
        if (y > 0) visit(i - w);
        if (y < h - 1) visit(i + w);
      }
      return { area, sx, sy, x0, x1, y0, y1 };
    };
    for (let x = 0; x < w; x++) {
      if (label[x] === -3) flood(x, -2);
      if (label[(h - 1) * w + x] === -3) flood((h - 1) * w + x, -2);
    }
    for (let y = 0; y < h; y++) {
      if (label[y * w] === -3) flood(y * w, -2);
      if (label[y * w + w - 1] === -3) flood(y * w + w - 1, -2);
    }

    // Every enclosed opening is a pane.
    const panes: Pane[] = [];
    const stats: { area: number; cx: number; cy: number; bw: number; bh: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (label[i] !== -3) continue;
      const id = panes.length;
      const s = flood(i, id);
      const minArea = Math.max(24, (0.002 * px * px) | 0);
      if (s.area < minArea) {
        // Too small to glaze: fill with stone. The queue still holds the sliver's pixels.
        for (let j = 0; j < s.area; j++) label[queue[j]] = -1;
        continue;
      }
      stats.push({
        area: s.area / (px * px),
        cx: frame.x0 + s.sx / s.area / px,
        cy: frame.y1 - s.sy / s.area / px,
        bw: (s.x1 - s.x0) / px,
        bh: (s.y1 - s.y0) / px,
      });
      panes.push({ field: 'white', border: null, borderW: 0, quarries: false, angle: 0, seed: id });
    }
    if (!panes.length) {
      this.built = null;
      return false;
    }
    panes.forEach((p, k) => Object.assign(p, choosePane(stats[k], glazing, k)));
    const keep = panes;

    // Distances both ways across every stone-glass edge.
    const dGlass = new Float32Array(n);
    const dStone = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const glass = label[i] >= 0;
      dGlass[i] = glass ? 0 : 1e12;
      dStone[i] = glass ? 1e12 : 0;
    }
    edt(dGlass, w, h);
    edt(dStone, w, h);
    for (let i = 0; i < n; i++) {
      dGlass[i] = Math.sqrt(dGlass[i]);
      dStone[i] = Math.sqrt(dStone[i]);
    }

    this.built = {
      w,
      h,
      px,
      frame,
      label,
      panes: keep,
      dGlass,
      dStone,
      glass: { inside: null, outside: null },
      stone: { inside: null, outside: null },
      glow: null,
      tint: [0, 0, 0],
      springY: glazing === 'rose' ? frame.y0 : 0,
      hood: true,
      glazing,
    };
    this.paintGlass('inside');
    this.paintGlow();
    this.paintStone('inside');
    return true;
  }

  setSide(s: Side): void {
    this.side = s;
    if (this.built && !this.built.glass[s]) {
      this.paintGlass(s);
      this.paintStone(s);
    }
    this.draw();
  }

  show(still: boolean): void {
    this.resize();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still || reduce) {
      this.progress = 1;
      this.draw();
      return;
    }
    this.progress = 0;
    this.t0 = performance.now();
    const tick = (now: number): void => {
      this.progress = Math.min(1, (now - this.t0) / 2600);
      this.draw();
      if (this.progress < 1) this.raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(tick);
  }

  hide(): void {
    cancelAnimationFrame(this.raf);
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    if (!this.w || !this.h) return;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.draw();
  }

  private paintGlass(side: Side): void {
    const b = this.built;
    if (!b) return;
    const { w, h, px, label, panes, dStone, frame } = b;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return;
    const img = g.createImageData(w, h);
    const d = img.data;
    const lead = Math.max(2.2, LEAD * px);
    const half = lead / 2;
    const ang = (63 * Math.PI) / 180;
    const cs = Math.cos(ang);
    const sn = Math.sin(ang);
    const q = 0.16 * px;
    const ox = -frame.x0 * px;
    const sumT: RGB = [0, 0, 0];
    let count = 0;
    const frac = (t: number): number => t - Math.floor(t);
    for (let y = 0; y < h; y++) {
      const sky = 0.9 + 0.18 * (1 - y / h);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const l = label[i];
        if (l < 0) continue;
        const p = panes[l];
        const ds = dStone[i];
        const bw = p.borderW * px;
        const inBorder = p.border !== null && ds < bw;
        // Distance to the nearest lead: the stone edge, the border's lead, and the quarry leads.
        let dl = ds;
        if (p.border) dl = Math.min(dl, Math.abs(ds - bw));
        let paint = 0;
        let cellA = 0;
        let cellB = 0;
        if (!inBorder && p.quarries) {
          // Diamond quarries: two families of leads, mirrored about the window's axis.
          const xx = x - ox;
          const u1 = (xx * sn + y * cs) / q;
          const u2 = (-xx * sn + y * cs) / q;
          const a = frac(u1);
          const bb = frac(u2);
          cellA = Math.floor(u1);
          cellB = Math.floor(u2);
          dl = Math.min(dl, Math.min(a, 1 - a) * q, Math.min(bb, 1 - bb) * q);
          // A small painted flower in every quarry.
          const pa = a - 0.5 + (bb - 0.5);
          const pm = a - 0.5 - (bb - 0.5);
          const r0 = Math.hypot(pa, pm);
          const petal = Math.min(
            Math.hypot(pa - 0.24, pm),
            Math.hypot(pa + 0.24, pm),
            Math.hypot(pa, pm - 0.24),
            Math.hypot(pa, pm + 0.24),
          );
          if (r0 < 0.055 || petal < 0.075) paint = 0.82;
          else if (Math.abs(r0 - 0.24) < 0.012) paint = 0.35;
        }
        const col = GLASS[inBorder && p.border ? p.border : p.field];
        let r: number;
        let gg: number;
        let bl: number;
        if (side === 'inside') {
          const ca = Math.cos(p.angle);
          const sa = Math.sin(p.angle);
          const u = (x * ca + y * sa) / px;
          const vv = (-x * sa + y * ca) / px;
          const mottle =
            0.65 * noise(x / (0.2 * px) + p.seed * 13.1, y / (0.2 * px) + p.seed * 7.7) +
            0.35 * noise(x / (0.06 * px) + p.seed * 3.3, y / (0.06 * px));
          const streak = noise(u * 2.2 + p.seed, vv * 24);
          const pieceTone = p.quarries ? 0.88 + 0.24 * hash(cellA * 7 + p.seed, cellB * 13) : 1;
          let t = sky * (0.58 + 0.55 * mottle) * (0.9 + 0.18 * streak) * pieceTone;
          // Paint and grime gather along the leads.
          if (dl < half + 4) t *= 0.62 + 0.38 * Math.max(0, (dl - half) / 4);
          if (hash(x * 3 + 1, y * 5 + p.seed) < 0.0006) t *= 1.6;
          t *= 1 - paint;
          r = col[0] * t;
          gg = col[1] * t;
          bl = col[2] * t;
          if (dl < half) r = gg = bl = 0.0025;
          sumT[0] += r;
          sumT[1] += gg;
          sumT[2] += bl;
          count++;
        } else {
          // From outside the glass is dark: the sky reflects off each piece at its own slight angle.
          const cell = p.quarries ? hash(cellA + p.seed * 31, cellB) : hash(p.seed, 7);
          const refl =
            (0.05 + 0.1 * (1 - y / h)) * (0.6 + 0.8 * cell) * (0.85 + 0.3 * noise(x / (0.3 * px), y / (0.3 * px)));
          r = 0.014 + col[0] * 0.035 + refl * 0.78;
          gg = 0.017 + col[1] * 0.035 + refl * 0.88;
          bl = 0.022 + col[2] * 0.035 + refl * 1.04;
          if (dl < half) r = gg = bl = 0.045 + 0.02 * (1 - dl / half);
        }
        d[i * 4] = toByte(r);
        d[i * 4 + 1] = toByte(gg);
        d[i * 4 + 2] = toByte(bl);
        d[i * 4 + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    b.glass[side] = c;
    if (side === 'inside' && count) b.tint = [sumT[0] / count, sumT[1] / count, sumT[2] / count];
  }

  /** The light the glass throws: a heavily blurred copy at a sixth of the size. */
  private paintGlow(): void {
    const b = this.built;
    const src = b?.glass.inside;
    if (!b || !src) return;
    const f = 6;
    const sw = Math.ceil(b.w / f);
    const sh = Math.ceil(b.h / f);
    const s = document.createElement('canvas');
    s.width = sw;
    s.height = sh;
    const g = s.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    g.drawImage(src, 0, 0, sw, sh);
    const data = g.getImageData(0, 0, sw, sh);
    const fl = new Float32Array(sw * sh * 3);
    for (let i = 0; i < sw * sh; i++)
      for (let c = 0; c < 3; c++) fl[i * 3 + c] = Math.pow(data.data[i * 4 + c] / 255, 2.2);
    boxBlur(fl, sw, sh, 3, 4, 3);
    for (let i = 0; i < sw * sh; i++) {
      for (let c = 0; c < 3; c++) data.data[i * 4 + c] = toByte(fl[i * 3 + c] * 1.6);
      data.data[i * 4 + 3] = 255;
    }
    g.putImageData(data, 0, 0);
    b.glow = s;
  }

  private paintStone(side: Side): void {
    const b = this.built;
    if (!b) return;
    const { w, h, px, label, dGlass, frame } = b;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return;
    const img = g.createImageData(w, h);
    const d = img.data;
    let glowData: Uint8ClampedArray | null = null;
    let gw = 0;
    let gh = 0;
    if (side === 'inside' && b.glow) {
      gw = b.glow.width;
      gh = b.glow.height;
      glowData = b.glow.getContext('2d')?.getImageData(0, 0, gw, gh).data ?? null;
    }
    const bevel = 0.05 * px;
    const inside = side === 'inside';
    const band = (inside ? SPLAY : REVEAL) * px;
    const hood0 = HOOD[0] * px;
    const hood1 = HOOD[1] * px;
    // The hood mould runs only over the arch, down to the springing.
    const springRow = (frame.y1 - b.springY) * px;
    const height = (i: number, y: number): number => {
      const dg = dGlass[i];
      if (label[i] === -2) {
        if (!inside && b.hood && dg >= hood0 && dg <= hood1 && y <= springRow)
          return 1 + 2.2 * Math.sin((Math.PI * (dg - hood0)) / (hood1 - hood0));
        if (dg > band) return 1;
      }
      return Math.min(1, dg / bevel);
    };
    const recess = Math.round(RECESS * px * 0.7);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const l = label[i];
        if (l >= 0) continue;
        const dg = dGlass[i];
        const outside = l === -2;
        const onHood = !inside && b.hood && outside && dg >= hood0 - 1 && dg <= hood1 + 1 && y <= springRow;
        if (outside && dg > band + 1 && !onHood) continue;
        const hx = height(i - 1, y) - height(i + 1, y);
        const hy = height(i - w, y - 1) - height(i + w, y + 1);
        const k = onHood ? 1.6 : 1.9;
        let nx = hx * k;
        let ny = hy * k;
        let nz = 1;
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const grain =
          0.88 +
          0.24 * noise(x / (0.04 * px), y / (0.04 * px)) * (0.6 + 0.4 * noise(x / (0.35 * px), y / (0.35 * px)));
        let r: number;
        let gg: number;
        let bl: number;
        let alpha = 1;
        if (inside) {
          let gr = 0;
          let gG = 0;
          let gB = 0;
          if (glowData) {
            const sx = Math.min(gw - 1, Math.floor((x / w) * gw));
            const sy = Math.min(gh - 1, Math.floor((y / h) * gh));
            const o = (sy * gw + sx) * 4;
            gr = Math.pow(glowData[o] / 255, 2.2);
            gG = Math.pow(glowData[o + 1] / 255, 2.2);
            gB = Math.pow(glowData[o + 2] / 255, 2.2);
          }
          const facing = 1 - nz;
          const room = Math.max(0, nx * ROOM[0] + ny * ROOM[1] + nz * ROOM[2]);
          // The splay of the opening is a plane of dressed stone lit by the glass, brightest beside it.
          let s = outside ? 0.3 + 0.7 * Math.pow(Math.max(0, 1 - dg / band), 1.3) : 0;
          if (outside && this.isJoint(b, x, y)) s *= 0.5;
          const amb = 0.42 + 0.3 * room;
          const sg = outside ? grain * grain : 1;
          r = STONE_IN[0] * grain * amb + gr * (facing * 0.85 + 0.05 + s * 0.25) + s * 0.12 * 0.98 * sg;
          gg = STONE_IN[1] * grain * amb + gG * (facing * 0.85 + 0.05 + s * 0.25) + s * 0.12 * 0.93 * sg;
          bl = STONE_IN[2] * grain * amb + gB * (facing * 0.85 + 0.05 + s * 0.25) + s * 0.12 * 0.84 * sg;
          if (outside) {
            alpha = Math.min(1, Math.max(0, band - dg + 0.5));
            // A pale arris where the splay meets the wall.
            if (dg > band - 1.6) {
              r += 0.012;
              gg += 0.011;
              bl += 0.01;
            }
          }
        } else {
          const lam = Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
          let shade = 0.36 + 0.72 * lam;
          if (outside && !onHood && this.isJoint(b, x, y)) shade *= 0.72;
          r = STONE_OUT[0] * grain * shade;
          gg = STONE_OUT[1] * grain * shade;
          bl = STONE_OUT[2] * grain * shade;
          if (outside && !onHood) alpha = Math.min(1, Math.max(0, band - dg + 0.5));
          if (onHood) alpha = Math.min(1, Math.max(0, Math.min(dg - hood0 + 1, hood1 - dg + 1)));
        }
        d[i * 4] = toByte(r);
        d[i * 4 + 1] = toByte(gg);
        d[i * 4 + 2] = toByte(bl);
        d[i * 4 + 3] = Math.round(alpha * 255);
      }
    }
    if (!inside) {
      // The sun throws the stone's shadow onto the glass set back behind it, and the hood's onto the wall.
      const sx = Math.round(-SUN[0] * recess * 1.2);
      const sy = Math.round(-SUN[1] * recess * 1.2);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const xs = x - sx;
          const ys = y - sy;
          if (xs < 0 || ys < 0 || xs >= w || ys >= h) continue;
          const j = ys * w + xs;
          if (label[i] >= 0 && label[j] < 0) {
            d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 0;
            d[i * 4 + 3] = 120;
          } else if (b.hood && label[i] === -2 && d[i * 4 + 3] === 0 && ys <= springRow) {
            const dj = dGlass[j];
            if (label[j] === -2 && dj >= hood0 && dj <= hood1 && dGlass[i] > hood1) {
              d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 0;
              d[i * 4 + 3] = 60;
            }
          }
        }
    }
    g.putImageData(img, 0, 0);
    b.stone[side] = c;
  }

  /** Joints in the dressed stone round the opening: coursed in the jambs, radiating in the arch. */
  private isJoint(b: Built, x: number, y: number): boolean {
    const wx = b.frame.x0 + x / b.px;
    const wy = b.frame.y1 - y / b.px;
    const jw = Math.max(0.6 / b.px, 0.007);
    if (b.glazing === 'rose') {
      const th = Math.atan2(wy, wx);
      const step = (Math.PI * 2) / 18;
      const f = th / step - Math.round(th / step);
      return Math.abs(f) * step * Math.hypot(wx, wy) < jw;
    }
    if (wy < b.springY) {
      const k = (wy - b.springY) / COURSE;
      return Math.abs(k - Math.round(k)) * COURSE < jw;
    }
    if (Math.abs(wx) < jw) return true;
    const cx = wx < 0 ? 1 : -1;
    const th = Math.atan2(wy - b.springY, wx - cx);
    const r = Math.hypot(wx - cx, wy - b.springY);
    const step = COURSE / r;
    const f = th / step - Math.round(th / step);
    return Math.abs(f) * step * r < jw;
  }

  private draw(): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const W = this.w;
    const H = this.h;
    if (!W || !H) return;
    const b = this.built;
    const side = this.side;
    const narrow = W < 760;
    const plaque = narrow ? 230 : 0;
    const availH = H - plaque - (narrow ? 30 : 70);
    const availW = W - (narrow ? 30 : 140);
    if (!b) {
      ctx.fillStyle = WALL_IN;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const fw = b.frame.x1 - b.frame.x0;
    const fh = b.frame.y1 - b.frame.y0;
    const S = Math.min(availH / fh, availW / fw);
    const cx = narrow ? W / 2 : W / 2 + Math.min(120, W * 0.06);
    const cy = (narrow ? 15 : 35) + availH / 2;
    const left = cx - (fw * S) / 2;
    const top = cy - (fh * S) / 2;
    const p = this.progress;
    const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
    const pStone = ease(p / 0.3);
    const pGlass = ease((p - 0.22) / 0.5);
    const pGlow = ease((p - 0.6) / 0.4);

    this.drawWall(side, W, H, left, top, S, b, pGlow);

    const glass = b.glass[side];
    const stone = b.stone[side];
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (glass && pGlass > 0) {
      ctx.save();
      // Glazed from the sill upwards.
      const rise = top + fh * S * (1 - pGlass);
      ctx.beginPath();
      ctx.rect(left, rise, fw * S, fh * S);
      ctx.clip();
      ctx.drawImage(glass, left, top, fw * S, fh * S);
      ctx.restore();
    }
    if (stone) {
      ctx.globalAlpha = pStone;
      ctx.drawImage(stone, left, top, fw * S, fh * S);
      ctx.globalAlpha = 1;
    }
    if (side === 'inside' && b.glow && pGlow > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.13 * pGlow;
      ctx.drawImage(b.glow, left, top, fw * S, fh * S);
      ctx.restore();
    }
  }

  /** Coursed ashlar, laid from the springing line so the courses run through behind the window. */
  private drawWall(side: Side, W: number, H: number, left: number, top: number, S: number, b: Built, glow: number): void {
    const { ctx } = this;
    const inside = side === 'inside';
    const course = COURSE * S;
    const r = rng(41);
    const springY = top + (b.frame.y1 - b.springY) * S;
    const midX = left + -b.frame.x0 * S;
    ctx.fillStyle = inside ? '#100d0b' : '#7d6e55';
    ctx.fillRect(0, 0, W, H);
    const firstRow = Math.floor((0 - springY) / course) - 1;
    const lastRow = Math.ceil((H - springY) / course) + 1;
    const base = inside ? STONE_IN : STONE_OUT;
    const j = Math.max(1.2, 0.014 * S);
    for (let row = firstRow; row <= lastRow; row++) {
      const y = springY + row * course;
      let x = midX - (row % 2 === 0 ? 0.35 : 0.95) * S - Math.ceil(midX / S + 2) * S;
      while (x < W) {
        const len = (0.7 + r() * 0.75) * S;
        const v = 0.84 + r() * 0.26;
        const warm = r() * 0.06;
        const k = inside ? 0.5 * v : (0.36 + 0.72 * SUN[2]) * v;
        ctx.fillStyle = `rgb(${toByte(base[0] * k * (1 + warm))}, ${toByte(base[1] * k)}, ${toByte(base[2] * k * (1 - warm))})`;
        ctx.fillRect(x + j / 2, y + j / 2, len - j, course - j);
        if (!inside) {
          // Sun on the top arris, shadow under the bottom one.
          ctx.fillStyle = 'rgba(255, 248, 230, 0.16)';
          ctx.fillRect(x + j / 2, y + j / 2, len - j, j * 0.8);
          ctx.fillStyle = 'rgba(40, 28, 14, 0.12)';
          ctx.fillRect(x + j / 2, y + course - j * 1.4, len - j, j * 0.9);
        }
        x += len;
      }
    }
    // Tooling and weathering over everything.
    const tex = stoneTexture();
    const pat = tex ? ctx.createPattern(tex, 'repeat') : null;
    if (pat) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = inside ? 0.45 : 0.4;
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    const cx = left - b.frame.x0 * S;
    const cy = top + (b.frame.y1 - (b.frame.y0 + b.frame.y1) / 2) * S;
    if (inside) {
      // Daylight from the window falling on the wall round it, its colour mostly washed out.
      const t = b.tint;
      const grey = (t[0] + t[1] + t[2]) / 3;
      const mix = (c: number): number => toByte((c * 0.45 + grey * 0.55) * 1.6);
      const rad = Math.max(W, H) * 0.7;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const col = (a: number): string => `rgba(${mix(t[0])}, ${mix(t[1])}, ${mix(t[2])}, ${a})`;
      g.addColorStop(0, col(0.2 * glow + 0.05));
      g.addColorStop(0.3, col(0.08 * glow + 0.02));
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      const vg = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.25, cx, cy, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vg.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    } else {
      const vg = ctx.createLinearGradient(0, 0, W, H);
      vg.addColorStop(0, 'rgba(255, 244, 220, 0.12)');
      vg.addColorStop(1, 'rgba(30, 20, 10, 0.25)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
  }
}

let texCache: HTMLCanvasElement | null = null;
/** A tile of tooled stone: fine pitting over soft cloudy variation, mid-grey so it overlays cleanly. */
function stoneTexture(): HTMLCanvasElement | null {
  if (texCache) return texCache;
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(n, n);
  const per = (x: number, y: number, s: number): number => {
    // Tileable value noise: wrap the lattice.
    const xi = Math.floor(x / s);
    const yi = Math.floor(y / s);
    const m = n / s;
    const xf = x / s - xi;
    const yf = y / s - yi;
    const u = xf * xf * (3 - 2 * xf);
    const w = yf * yf * (3 - 2 * yf);
    const hh = (a: number, bb: number): number => hash(((a % m) + m) % m, ((bb % m) + m) % m);
    const a = hh(xi, yi);
    const b2 = hh(xi + 1, yi);
    const c2 = hh(xi, yi + 1);
    const d2 = hh(xi + 1, yi + 1);
    return a + (b2 - a) * u + (c2 - a) * w + (a - b2 - c2 + d2) * u * w;
  };
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = 0.45 * per(x, y, 64) + 0.3 * per(x, y, 16) + 0.25 * per(x, y, 4);
      const pit = hash(x * 5 + 3, y * 7 + 1) < 0.02 ? -0.25 : 0;
      const val = Math.max(0, Math.min(255, Math.round((0.5 + (v - 0.5) * 0.7 + pit) * 255)));
      const o = (y * n + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = val;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  texCache = c;
  return c;
}

function choosePane(
  s: { area: number; cx: number; cy: number; bw: number; bh: number },
  glazing: Glazing,
  k: number,
): Partial<Pane> {
  const angle = 1.2 + hash(k, 3) * 0.7;
  if (glazing === 'rose') {
    const rad = Math.hypot(s.cx, s.cy);
    if (rad < 0.62) return { field: 'ruby', border: null, quarries: false, angle };
    if (rad < 1.0) return { field: 'cobalt', border: 'white', borderW: 0.03, quarries: false, angle };
    return { field: 'white', border: 'amber', borderW: 0.028, quarries: true, angle };
  }
  if (glazing === 'geometric') {
    if (s.bh > 1.4) return { field: 'cobalt', border: 'ruby', borderW: 0.075, quarries: true, angle };
    if (Math.abs(s.cx) < 0.06) {
      if (s.area > 0.12) return { field: 'amber', border: 'ruby', borderW: 0.045, quarries: false, angle };
      return { field: 'ruby', border: null, quarries: false, angle };
    }
    if (s.area > 0.1) return { field: 'emerald', border: 'amber', borderW: 0.035, quarries: false, angle };
    return { field: 'ruby', border: null, quarries: false, angle };
  }
  // The open floor: tall openings are lights; everything else takes a colour by where it sits, mirrored.
  if (s.bh > 1.4 || s.area > 0.8)
    return {
      field: Math.round(Math.abs(s.cx) * 4) % 2 === 0 ? 'cobalt' : 'ruby',
      border: Math.round(Math.abs(s.cx) * 4) % 2 === 0 ? 'ruby' : 'cobalt',
      borderW: 0.07,
      quarries: true,
      angle,
    };
  const names: GlassName[] = ['ruby', 'amber', 'emerald', 'cobalt', 'murrey'];
  const key = Math.round(Math.abs(s.cx) * 6) * 3 + Math.round(s.cy * 6) * 7 + (s.area > 0.15 ? 1 : 0);
  const field = names[((key % names.length) + names.length) % names.length];
  return {
    field,
    border: s.area > 0.15 ? (field === 'amber' ? 'ruby' : 'amber') : null,
    borderW: 0.04,
    quarries: false,
    angle,
  };
}
