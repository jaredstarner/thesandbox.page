// Draws the room, the light, the mobile, and its shadow. The camera faces the wall square on,
// so the wall maps to the screen by a plain scale and shift and every shadow can be drawn flat.

import { arcY, PAINTS } from './_model';
import { CEILING, type ArmState, type Mobile, type PlateState, type V3 } from './_sim';

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
const TEX_PPM = 90;
const LIGHT_COLOR: V3 = [1.0, 0.93, 0.82];
const AMBIENT: V3 = [0.36, 0.37, 0.4];
const SHADE = 'rgb(140, 136, 134)';

export class Renderer {
  private shade = document.createElement('canvas');
  private sctx: CanvasRenderingContext2D;
  private wallTex: HTMLCanvasElement;
  hits: Hits = { plates: [], arms: [] };

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
  ) {
    this.sctx = this.shade.getContext('2d')!;
    this.wallTex = makeWallTexture();
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
    const wallTop = wy(CEILING);
    const wallBottom = wy(0);
    const Wpx = this.canvas.width;
    const Hpx = this.canvas.height;

    // Ceiling.
    const cg = ctx.createLinearGradient(0, 0, 0, Math.max(1, wallTop));
    cg.addColorStop(0, '#8f8a83');
    cg.addColorStop(1, '#b4ada3');
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, Wpx, Math.max(0, wallTop));

    // Wall: limewash, then the light.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, wallTop, Wpx, wallBottom - wallTop);
    ctx.clip();
    ctx.setTransform((a * k) / TEX_PPM, 0, 0, (a * k) / TEX_PPM, wx(WALL_TEX_X0), wallTop);
    ctx.drawImage(this.wallTex, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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

    // The ceiling fitting and the thread down to the top arm.
    const anchor: V3 = [0, CEILING, 0];
    const pa = project(c, anchor);
    const top = project(c, m.root.H);
    ctx.strokeStyle = 'rgba(40, 36, 32, 0.55)';
    ctx.lineWidth = Math.max(0.6, 0.7 * k);
    ctx.beginPath();
    ctx.moveTo(pa[0] * k, pa[1] * k);
    ctx.lineTo(top[0] * k, top[1] * k);
    ctx.stroke();
    const cupR = (0.035 * c.f * k) / pa[2];
    ctx.fillStyle = '#d9d3c9';
    ctx.beginPath();
    ctx.ellipse(pa[0] * k, pa[1] * k, cupR, cupR * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // The mobile, back to front.
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [];
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
          ctx.lineWidth = Math.max(1, ((0.0016 * c.f) / depth) * k * 1.4);
          ctx.stroke();
          if (selected) {
            ctx.save();
            ctx.setLineDash([5 * k, 4 * k]);
            ctx.lineWidth = 1.6 * k;
            ctx.strokeStyle = '#ffffff';
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 3 * k;
            ctx.stroke();
            ctx.restore();
          }
        },
      });
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
    const pool = onWall(L, aim, room.wallZ);
    const Dw = c.camZ - room.wallZ;
    const a = (c.f / Dw) * k;
    const px = wx(pool[0]);
    const py = wy(pool[1]);
    s.globalCompositeOperation = 'destination-out';
    s.save();
    s.translate(px, py);
    s.scale(1.18, 1);
    const R = a * Math.max(1.45, m.reachCache.radius * 1.9);
    const g = s.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.93)');
    g.addColorStop(0.8, 'rgba(0,0,0,0.5)');
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
      const up: V3 = arm.parent ? arm.parent.ends[arm.side] : [0, CEILING, 0];
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
  const kd = metal ? 0.55 : 0.92;
  const out: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const tint = metal ? alb[i]! : 1;
    out[i] = alb[i]! * (AMBIENT[i]! * 0.9 + kd * diff * LIGHT_COLOR[i]!) + spec * tint * LIGHT_COLOR[i]!;
    // A little skylight from the room on the face the lamp misses, so dark faces read as metal, not holes.
    out[i] += alb[i]! * 0.06 * Math.max(0, n[1]);
  }
  const fill = rgb(out[0], out[1], out[2]);
  const edge = rgb(out[0] * 0.55, out[1] * 0.55, out[2] * 0.55);
  return { fill, edge };
}

function makeWallTexture(): HTMLCanvasElement {
  const w = WALL_TEX_W * TEX_PPM;
  const h = Math.ceil(CEILING * TEX_PPM);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ebe5da';
  g.fillRect(0, 0, w, h);
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // Limewash: broad, faint clouds of lighter and darker wash.
  for (let i = 0; i < 260; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 30 + rnd() * 160;
    const dark = rnd() < 0.5;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const al = 0.025 + rnd() * 0.035;
    grd.addColorStop(0, dark ? `rgba(150,130,105,${al})` : `rgba(255,252,246,${al * 1.4})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Fine grain.
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 7;
    d[i] = d[i]! + n;
    d[i + 1] = d[i + 1]! + n;
    d[i + 2] = d[i + 2]! + n;
  }
  g.putImageData(img, 0, 0);
  return cv;
}
