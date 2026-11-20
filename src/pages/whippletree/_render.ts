// Draws the room, the light, the mobile, and its shadow. The camera faces the wall square on,
// so the wall maps to the screen by a plain scale and shift and every shadow can be drawn flat.

import { arcY, PAINTS } from './_model';
import type { ArmState, Mobile, PlateState, V3 } from './_sim';

export interface Camera {
  /** CSS pixel size of the view. */
  W: number;
  H: number;
  dpr: number;
  f: number;
  camX: number;
  camY: number;
  camZ: number;
  /** Lens shift, so the mobile sits in frame without tilting the camera. */
  k0: number;
  cx: number;
  cy: number;
}

export interface Room {
  wallZ: number;
  light: V3;
  lightRadius: number;
}

export interface Hits {
  plates: { ps: PlateState; poly: [number, number][]; depth: number }[];
  arms: { s: ArmState; line: [number, number][]; depth: number }[];
}

export interface Selection {
  plate: PlateState | null;
  arm: ArmState | null;
  /** Where the arm would hang level, 0 to 1, shown while its hook is being moved. */
  balance: number | null;
}

export function project(c: Camera, P: V3): [number, number, number] {
  const D = c.camZ - P[2];
  return [c.cx + (c.f * (P[0] - c.camX)) / D, c.cy - c.f * ((P[1] - c.camY) / D - c.k0), D];
}

/** Screen point to a world point on the plane z = Z. */
export function unproject(c: Camera, sx: number, sy: number, Z: number): V3 {
  const D = c.camZ - Z;
  const X = ((sx - c.cx) * D) / c.f + c.camX;
  const Y = ((c.cy - sy) / c.f + c.k0) * D + c.camY;
  return [X, Y, Z];
}

const toLin = (v: number) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (x: number) => {
  const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};
const rgb = (r: number, g: number, b: number) => `rgb(${toSrgb(r)},${toSrgb(g)},${toSrgb(b)})`;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

const WALL_TEX_X0 = -6;
const WALL_TEX_W = 12;
const TEX_PPM = 50;
const WALL_TEX_H = 8;
const LIGHT_COLOR: V3 = [1.0, 0.94, 0.84];
const AMBIENT: V3 = [0.5, 0.51, 0.54];
const SHADE = 'rgb(166, 161, 157)';

export class Renderer {
  private shade = document.createElement('canvas');
  private sctx: CanvasRenderingContext2D;
  private wallTex: HTMLCanvasElement;
  private grain: CanvasPattern | null;
  hits: Hits = { plates: [], arms: [] };

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
  ) {
    this.sctx = this.shade.getContext('2d')!;
    this.wallTex = makeWallTexture();
    this.grain = ctx.createPattern(makeGrain(), 'repeat');
  }

  resize(c: Camera): void {
    const w = Math.round(c.W * c.dpr);
    const h = Math.round(c.H * c.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.shade.width = w;
      this.shade.height = h;
    }
  }

  draw(c: Camera, room: Room, m: Mobile, sel: Selection): void {
    const ctx = this.ctx;
    const k = c.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Wall-plane mapping.
    const Dw = c.camZ - room.wallZ;
    const a = c.f / Dw;
    const wx = (X: number) => (c.cx + a * (X - c.camX)) * k;
    const wy = (Y: number) => (c.cy - c.f * ((Y - c.camY) / Dw - c.k0)) * k;
    const wallTop = Math.min(0, wy(WALL_TEX_H));
    const wallBottom = wy(0);
    const Wpx = this.canvas.width;
    const Hpx = this.canvas.height;

    // Wall: limewash, then the light.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, wallTop, Wpx, wallBottom - wallTop);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform((a * k) / TEX_PPM, 0, 0, (a * k) / TEX_PPM, wx(WALL_TEX_X0), wy(WALL_TEX_H));
    ctx.drawImage(this.wallTex, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Fine grain of the plaster, at screen resolution so it never shows as a grid.
    if (this.grain) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = this.grain;
      ctx.fillRect(0, wallTop, Wpx, wallBottom - wallTop);
      ctx.globalAlpha = 1;
    }
    // Skirting.
    const sk = wy(0.1);
    ctx.fillStyle = '#efe9df';
    ctx.fillRect(0, sk, Wpx, wallBottom - sk);
    ctx.fillStyle = 'rgba(70, 60, 50, 0.22)';
    ctx.fillRect(0, sk, Wpx, Math.max(1, 0.8 * k));
    ctx.restore();

    // Floor: pale oak boards running away from the wall.
    const fg = ctx.createLinearGradient(0, wallBottom, 0, Hpx);
    fg.addColorStop(0, '#8d7558');
    fg.addColorStop(0.25, '#9c8263');
    fg.addColorStop(1, '#6f5b44');
    ctx.fillStyle = fg;
    ctx.fillRect(0, wallBottom, Wpx, Hpx - wallBottom);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, wallBottom, Wpx, Hpx - wallBottom);
    ctx.clip();
    ctx.strokeStyle = 'rgba(52, 38, 24, 0.28)';
    ctx.lineWidth = Math.max(1, 0.9 * k);
    ctx.beginPath();
    const near = c.camZ - 0.4;
    for (let X = -8; X <= 8; X += 0.142) {
      const p0 = project(c, [X, 0, room.wallZ]);
      const p1 = project(c, [X, 0, near]);
      ctx.moveTo(p0[0] * k, p0[1] * k);
      ctx.lineTo(p1[0] * k, p1[1] * k);
    }
    ctx.stroke();
    // A soft spill of the spotlight on the boards near the wall.
    const spill = project(c, [0.4, 0, room.wallZ + 0.6]);
    const sg = ctx.createRadialGradient(spill[0] * k, spill[1] * k, 0, spill[0] * k, spill[1] * k, a * 1.6 * k);
    sg.addColorStop(0, 'rgba(255, 236, 205, 0.16)');
    sg.addColorStop(1, 'rgba(255, 236, 205, 0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, wallBottom, Wpx, Hpx - wallBottom);
    // Contact shadow along the skirting.
    const cs = ctx.createLinearGradient(0, wallBottom, 0, wallBottom + 10 * k);
    cs.addColorStop(0, 'rgba(30, 20, 10, 0.35)');
    cs.addColorStop(1, 'rgba(30, 20, 10, 0)');
    ctx.fillStyle = cs;
    ctx.fillRect(0, wallBottom, Wpx, 10 * k);
    ctx.restore();

    // The shade layer: everything on the wall the spotlight doesn't reach.
    this.drawShade(c, room, m, wx, wy, wallTop, wallBottom);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.shade, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    // The thread up to a ceiling far out of frame.
    const pa = project(c, [m.root.H[0], m.root.H[1] + 0.7, m.root.H[2]]);
    const top = project(c, m.root.H);
    const tg = ctx.createLinearGradient(0, pa[1] * k, 0, top[1] * k);
    tg.addColorStop(0, 'rgba(40, 36, 32, 0)');
    tg.addColorStop(0.6, 'rgba(40, 36, 32, 0.45)');
    tg.addColorStop(1, 'rgba(40, 36, 32, 0.65)');
    ctx.strokeStyle = tg;
    ctx.lineWidth = Math.max(0.7, 0.75 * k);
    ctx.beginPath();
    ctx.moveTo(pa[0] * k, pa[1] * k);
    ctx.lineTo(top[0] * k, top[1] * k);
    ctx.stroke();

    // The mobile, back to front.
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [];
    const after: (() => void)[] = [];
    this.hits = { plates: [], arms: [] };
    const toLight = room.light;
    const eye: V3 = [c.camX, c.camY, c.camZ];
    for (const ps of m.platesList) {
      const poly = ps.outline.map((P) => project(c, P));
      const depth = project(c, ps.C)[2];
      const css = poly.map(([x, y]): [number, number] => [x, y]);
      this.hits.plates.push({ ps, poly: css, depth });
      const col = shadePlate(ps, toLight, eye);
      const selected = sel.plate === ps;
      items.push({
        depth,
        draw: () => {
          ctx.beginPath();
          poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
          ctx.closePath();
          ctx.fillStyle = col.fill;
          ctx.fill();
          ctx.lineJoin = 'round';
          ctx.strokeStyle = col.edge;
          ctx.lineWidth = Math.max(0.8 * k, ((0.0016 * c.f) / depth) * k);
          ctx.stroke();
        },
      });
      if (selected) {
        after.push(() => {
          ctx.save();
          ctx.beginPath();
          poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
          ctx.closePath();
          ctx.setLineDash([5 * k, 4 * k]);
          ctx.lineWidth = 1.6 * k;
          ctx.strokeStyle = '#ffffff';
          ctx.shadowColor = 'rgba(0,0,0,0.65)';
          ctx.shadowBlur = 3 * k;
          ctx.stroke();
          ctx.restore();
        });
      }
    }
    for (const s of m.armsList) {
      const pts = armPolyline(s, 24);
      const proj = pts.map((P) => project(c, P));
      const depth = proj.reduce((acc, p) => acc + p[2], 0) / proj.length;
      this.hits.arms.push({ s, line: proj.map(([x, y]): [number, number] => [x, y]), depth });
      const selected = sel.arm === s;
      // Draw each arm in four pieces so plates can pass in front of one end and behind the other.
      const pieces = 4;
      const per = Math.ceil((proj.length - 1) / pieces);
      for (let i = 0; i < pieces; i++) {
        const seg = proj.slice(i * per, Math.min(proj.length, i * per + per + 1));
        if (seg.length < 2) continue;
        const dd = seg.reduce((acc, p) => acc + p[2], 0) / seg.length;
        items.push({
          depth: dd,
          draw: () => {
            ctx.beginPath();
            seg.forEach(([x, y], j) => (j ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = selected ? '#ffffff' : '#171615';
            ctx.lineWidth = Math.max(1.1, ((0.0021 * c.f) / dd) * k) * (selected ? 1.8 : 1);
            if (selected) {
              ctx.save();
              ctx.shadowColor = 'rgba(0,0,0,0.7)';
              ctx.shadowBlur = 3 * k;
              ctx.stroke();
              ctx.restore();
            } else ctx.stroke();
          },
        });
      }
      // The hanging loop, and the link down from the arm above.
      const hp = project(c, s.H);
      const loopR = Math.max(1.6, ((0.006 * c.f) / hp[2]) * k);
      items.push({
        depth: hp[2] - 0.001,
        draw: () => {
          ctx.strokeStyle = '#171615';
          ctx.lineWidth = Math.max(1, ((0.0017 * c.f) / hp[2]) * k);
          ctx.beginPath();
          ctx.arc(hp[0] * k, hp[1] * k - loopR, loopR, 0, Math.PI * 2);
          ctx.stroke();
          if (s.parent) {
            const e = project(c, s.parent.ends[s.side]);
            ctx.beginPath();
            ctx.moveTo(e[0] * k, e[1] * k);
            ctx.lineTo(hp[0] * k, hp[1] * k - loopR * 2);
            ctx.lineWidth = Math.max(0.9, ((0.0014 * c.f) / hp[2]) * k);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(e[0] * k, e[1] * k + loopR * 0.7, loopR * 0.7, 0, Math.PI * 2);
            ctx.stroke();
          }
        },
      });
    }
    items.sort((p, q) => q.depth - p.depth);
    for (const it of items) it.draw();
    for (const f of after) f();

    // The balance mark on a selected arm: a small fulcrum where the hook would make it hang level.
    if (sel.arm && sel.balance !== null) {
      const s = sel.arm;
      const bx = sel.balance * s.arm.len;
      const P = armPoint(s, bx, arcY(s.arm, bx));
      const p = project(c, P);
      const h = 7 * k;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1 * k;
      ctx.beginPath();
      ctx.moveTo(p[0] * k, p[1] * k + 3 * k);
      ctx.lineTo(p[0] * k - h * 0.7, p[1] * k + 3 * k + h);
      ctx.lineTo(p[0] * k + h * 0.7, p[1] * k + 3 * k + h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawShade(
    c: Camera,
    room: Room,
    m: Mobile,
    wx: (X: number) => number,
    wy: (Y: number) => number,
    wallTop: number,
    wallBottom: number,
  ): void {
    const s = this.sctx;
    const k = c.dpr;
    const Wpx = this.shade.width;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over';
    s.clearRect(0, 0, Wpx, this.shade.height);
    s.save();
    s.beginPath();
    s.rect(0, wallTop, Wpx, wallBottom - wallTop);
    s.clip();
    s.fillStyle = SHADE;
    s.fillRect(0, wallTop, Wpx, wallBottom - wallTop);
    // The pool of light: aimed at the mobile, landing on the wall a little right of it and lower.
    const L = room.light;
    const aim: V3 = [m.root.H[0], (m.root.H[1] + m.reachCache.bottom) / 2, 0];
    const cast = onWall(L, aim, room.wallZ);
    const pool: V3 = [(aim[0] + cast[0]) / 2, (aim[1] + cast[1]) / 2, room.wallZ];
    const Dw = c.camZ - room.wallZ;
    const a = (c.f / Dw) * k;
    const px = wx(pool[0]);
    const py = wy(pool[1]);
    s.globalCompositeOperation = 'destination-out';
    s.save();
    s.translate(px, py);
    // A wider pool on a wide screen, a taller one on a tall screen.
    s.scale(1.25, Math.max(1, (c.H / c.W) * 0.95));
    const R = a * Math.max(1.3, m.reachCache.typical * 2.3);
    const g = s.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.96)');
    g.addColorStop(0.75, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    s.fillStyle = g;
    s.beginPath();
    s.arc(0, 0, R, 0, Math.PI * 2);
    s.fill();
    s.restore();

    // Shadows: every plate and wire cast from the lamp onto the wall. The further a part stands
    // from the wall, the wider its penumbra.
    s.globalCompositeOperation = 'source-over';
    const OFF = Wpx + 4000;
    s.shadowColor = SHADE;
    s.shadowOffsetX = OFF;
    s.fillStyle = SHADE;
    s.strokeStyle = SHADE;
    const blurFor = (P: V3) => {
      const S = onWall(L, P, room.wallZ);
      const pen = (room.lightRadius * len(sub(S, P))) / Math.max(0.2, len(sub(P, L)));
      return pen * a;
    };
    const toScreen = (P: V3): [number, number] => {
      const S = onWall(L, P, room.wallZ);
      return [wx(S[0]), wy(S[1])];
    };
    for (const ps of m.platesList) {
      s.shadowBlur = blurFor(ps.C);
      s.beginPath();
      ps.outline.forEach((P, i) => {
        const [x, y] = toScreen(P);
        if (i) s.lineTo(x - OFF, y);
        else s.moveTo(x - OFF, y);
      });
      s.closePath();
      s.fill();
    }
    for (const arm of m.armsList) {
      const pts = armPolyline(arm, 16);
      s.shadowBlur = blurFor(arm.H);
      s.lineWidth = Math.max(1, 0.0021 * a * 1.4);
      s.lineCap = 'round';
      s.beginPath();
      pts.forEach((P, i) => {
        const [x, y] = toScreen(P);
        if (i) s.lineTo(x - OFF, y);
        else s.moveTo(x - OFF, y);
      });
      // Its link up to the arm above, or the thread to the ceiling.
      const up: V3 = arm.parent ? arm.parent.ends[arm.side] : [arm.H[0], arm.H[1] + 6, arm.H[2]];
      const [hx, hy] = toScreen(arm.H);
      const [ux, uy] = toScreen(up);
      s.moveTo(hx - OFF, hy);
      s.lineTo(ux - OFF, uy);
      s.stroke();
    }
    s.shadowBlur = 0;
    s.shadowOffsetX = 0;
    s.restore();
  }
}

/** Where the ray from the lamp through P meets the wall. */
function onWall(L: V3, P: V3, wallZ: number): V3 {
  const dz = P[2] - L[2];
  const t = Math.abs(dz) < 1e-6 ? 1e6 : (wallZ - L[2]) / dz;
  return [L[0] + t * (P[0] - L[0]), L[1] + t * (P[1] - L[1]), wallZ];
}

/** A point on an arm, given in the arm's own plane, placed in the world. */
export function armPoint(s: ArmState, x: number, y: number): V3 {
  const dx = x - s.xh;
  const dy = y - s.yh;
  const cp = Math.cos(s.phi);
  const sp = Math.sin(s.phi);
  const X = dx * cp + dy * sp;
  const Y = -dx * sp + dy * cp;
  return [s.H[0] + X * s.d[0], s.H[1] + Y, s.H[2] + X * s.d[2]];
}

export function armPolyline(s: ArmState, n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * s.arm.len;
    out.push(armPoint(s, x, arcY(s.arm, x)));
  }
  return out;
}

function shadePlate(ps: PlateState, L: V3, eye: V3): { fill: string; edge: string } {
  const paint = PAINTS[ps.plate.paint];
  const alb: V3 = [toLin(paint.rgb[0]), toLin(paint.rgb[1]), toLin(paint.rgb[2])];
  const l = unit(sub(L, ps.C));
  const v = unit(sub(eye, ps.C));
  let n = ps.n;
  if (dot(n, v) < 0) n = [-n[0], -n[1], -n[2]];
  const ndl = dot(n, l);
  const diff = Math.max(0, ndl);
  // Reflection of the lamp in the sheet.
  const r: V3 = [2 * ndl * n[0] - l[0], 2 * ndl * n[1] - l[1], 2 * ndl * n[2] - l[2]];
  const rv = Math.max(0, dot(r, v));
  const metal = paint.metal;
  const spec = diff > 0 ? (metal ? 0.9 * rv ** 14 : 0.18 * rv ** 30) : 0;
  const kd = metal ? 0.5 : 0.78;
  const out: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const tint = metal ? alb[i]! : 1;
    out[i] = alb[i]! * (AMBIENT[i]! + kd * diff * LIGHT_COLOR[i]!) + spec * tint * LIGHT_COLOR[i]!;
    // A little skylight from the room on the face the lamp misses, so dark faces read as metal, not holes.
    out[i] += alb[i]! * 0.06 * Math.max(0, n[1]);
  }
  const fill = rgb(out[0], out[1], out[2]);
  const edge = rgb(out[0] * 0.78, out[1] * 0.78, out[2] * 0.78);
  return { fill, edge };
}

function makeWallTexture(): HTMLCanvasElement {
  // Limewash: a few octaves of smooth value noise, nudging the white warmer or cooler,
  // lighter or darker by a hair. Computed per texel, so nothing dithers when it is enlarged.
  const w = WALL_TEX_W * TEX_PPM;
  const h = WALL_TEX_H * TEX_PPM;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(w, h);
  const N = 64;
  const lattice: number[] = [];
  let seed = 11;
  for (let i = 0; i < N * N; i++) {
    seed = (seed * 16807) % 2147483647;
    lattice.push(seed / 2147483647);
  }
  const at = (x: number, y: number) => lattice[(((y % N) + N) % N) * N + (((x % N) + N) % N)]!;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = smooth(x - xi);
    const fy = smooth(y - yi);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx;
    return a + (b - a) * fy;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / TEX_PPM;
      const v = y / TEX_PPM;
      const n = noise(u * 1.3, v * 1.3) * 0.55 + noise(u * 3.7 + 9, v * 3.7) * 0.3 + noise(u * 9 + 3, v * 9 + 5) * 0.15;
      const t = noise(u * 0.6 + 20, v * 0.6 + 7);
      const d = (n - 0.5) * 9;
      const i = (y * w + x) * 4;
      img.data[i] = 235 + d + (t - 0.5) * 3;
      img.data[i + 1] = 229 + d;
      img.data[i + 2] = 218 + d - (t - 0.5) * 3;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/** A tile of fine, soft noise: light and dark specks at very low contrast. */
function makeGrain(): HTMLCanvasElement {
  const n = 160;
  const cv = document.createElement('canvas');
  cv.width = n;
  cv.height = n;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(n, n);
  let seed = 23;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rnd();
    const light = v > 0.5;
    img.data[i] = light ? 255 : 90;
    img.data[i + 1] = light ? 252 : 80;
    img.data[i + 2] = light ? 246 : 70;
    img.data[i + 3] = Math.round(Math.abs(v - 0.5) * 2 * 22);
  }
  g.putImageData(img, 0, 0);
  return cv;
}
