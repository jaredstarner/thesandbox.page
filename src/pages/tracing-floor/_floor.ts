// Draws the plaster floor: raking light, old drawings half brushed out, fresh scratches, and the tools.

import { clipLine, rng, type Piece, type Prim, type Rect, type Vec } from './_geom';

export interface View {
  /** CSS pixels per world unit. */
  s: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
}

export function fitView(r: Rect, w: number, h: number, pad: { l: number; r: number; t: number; b: number }): View {
  const aw = Math.max(40, w - pad.l - pad.r);
  const ah = Math.max(40, h - pad.t - pad.b);
  const s = Math.min(aw / (r.x1 - r.x0), ah / (r.y1 - r.y0));
  const cx = pad.l + aw / 2;
  const cy = pad.t + ah / 2;
  return { s, ox: cx - ((r.x0 + r.x1) / 2) * s, oy: cy + ((r.y0 + r.y1) / 2) * s, w, h };
}

export const toScreen = (vw: View, p: Vec): Vec => ({ x: p.x * vw.s + vw.ox, y: vw.oy - p.y * vw.s });
export const toWorld = (vw: View, x: number, y: number): Vec => ({ x: (x - vw.ox) / vw.s, y: (vw.oy - y) / vw.s });

/** The world rectangle the screen shows. */
export function viewRect(vw: View, margin = 0): Rect {
  const a = toWorld(vw, -margin, vw.h + margin);
  const b = toWorld(vw, vw.w + margin, -margin);
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}

export type Tool = 'compass' | 'dividers' | 'rule' | 'chisel';

export interface Drawn {
  prim: Prim;
  /** 0 for the newest stroke, rising as more are struck over it. */
  age: number;
  given: boolean;
}

export type Preview =
  | { tool: 'compass'; c: Vec; p: Vec }
  | { tool: 'rule'; a: Vec; b: Vec }
  | { tool: 'dividers'; a: Vec; b: Vec; c?: Vec }
  | null;

export interface FloorScene {
  view: View;
  drawn: Drawn[];
  points: Vec[];
  /** Points the visitor scratched by hand, and the springers. */
  marks: Vec[];
  /** Holes left by the compass point. */
  pricks: Vec[];
  /** The master's drawing still to be struck. */
  guides: Piece[];
  /** Members struck and settled as stone. */
  cut: Piece[];
  /** Stretches marked with the chisel on the open floor. */
  chiselled: Piece[];
  hover: Piece | null;
  snap: Vec | null;
  preview: Preview;
  hint: Prim | null;
  hintPoints: Vec[];
  /** 0..1, how far the floor has faded for the raised window. */
  fade: number;
}

const OCHRE = 'rgba(164, 72, 40, ';
/** The finished bar's width in world units, matching the raised window. */
export const BAR_WIDTH = 0.1;

export class Floor {
  private ctx: CanvasRenderingContext2D;
  private plaster: HTMLCanvasElement | null = null;
  private plasterKey = '';
  private grain: HTMLCanvasElement;
  dpr = 1;
  w = 0;
  h = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    this.ctx = ctx;
    this.grain = makeGrain();
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  /** Each commission gets its own patch of floor. */
  ensurePlaster(seed: number): void {
    const key = `${seed}:${this.w}x${this.h}:${this.dpr}`;
    if (key === this.plasterKey) return;
    this.plasterKey = key;
    this.plaster = makePlaster(this.w, this.h, this.dpr, seed, this.grain);
  }

  draw(sc: FloorScene): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.plaster) ctx.drawImage(this.plaster, 0, 0, this.w, this.h);
    const vw = sc.view;

    // The master's drawing in red ochre, under everything struck.
    for (const g of sc.guides) chalk(ctx, vw, g);

    // Construction lines: incised, the newest the whitest.
    for (const d of sc.drawn) {
      const fresh = d.given ? 0.42 : Math.max(0.55, 1 - d.age * 0.05);
      incise(ctx, (c) => tracePrim(c, vw, d.prim), 1.15, fresh);
    }

    // Members settled as stone: a wash the width of the finished bar, then the line cut deep.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(132, 104, 76, 0.13)';
    ctx.lineWidth = Math.max(4, BAR_WIDTH * vw.s);
    ctx.beginPath();
    for (const p of sc.cut) tracePiece(ctx, vw, p);
    for (const p of sc.chiselled) tracePiece(ctx, vw, p);
    ctx.stroke();
    ctx.restore();
    for (const p of sc.cut) incise(ctx, (c) => tracePiece(c, vw, p), 2.3, 1, true);
    for (const p of sc.chiselled) incise(ctx, (c) => tracePiece(c, vw, p), 2.3, 1, true);
    if (sc.hover) {
      ctx.save();
      ctx.strokeStyle = 'rgba(60, 120, 170, 0.55)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      tracePiece(ctx, vw, sc.hover);
      ctx.stroke();
      ctx.restore();
    }

    // Compass holes and scratched marks.
    for (const p of sc.pricks) prick(ctx, toScreen(vw, p));
    for (const p of sc.marks) cross(ctx, toScreen(vw, p));

    // Every crossing, faint, so there is something to set the compass on.
    ctx.fillStyle = 'rgba(52, 40, 30, 0.5)';
    for (const p of sc.points) {
      const s = toScreen(vw, p);
      if (s.x < -4 || s.y < -4 || s.x > this.w + 4 || s.y > this.h + 4) continue;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }

    if (sc.hint) {
      ctx.save();
      ctx.setLineDash([7, 6]);
      ctx.strokeStyle = OCHRE + '0.85)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      tracePrim(ctx, vw, sc.hint);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of sc.hintPoints) {
        const s = toScreen(vw, p);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (sc.snap) {
      const s = toScreen(vw, sc.snap);
      ctx.save();
      ctx.strokeStyle = 'rgba(30, 24, 18, 0.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (sc.preview) this.drawPreview(sc.preview, vw);

    if (sc.fade > 0) {
      ctx.fillStyle = `rgba(16, 13, 11, ${sc.fade})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  private drawPreview(pv: NonNullable<Preview>, vw: View): void {
    const { ctx } = this;
    if (pv.tool === 'rule') {
      const a = toScreen(vw, pv.a);
      const b = toScreen(vw, pv.b);
      if (Math.hypot(b.x - a.x, b.y - a.y) > 2) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 252, 244, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        tracePrim(ctx, vw, { kind: 'line', a: pv.a, b: pv.b });
        ctx.stroke();
        ctx.restore();
        drawRule(ctx, a, b);
      }
      return;
    }
    if (pv.tool === 'compass') {
      const c = toScreen(vw, pv.c);
      const p = toScreen(vw, pv.p);
      const r = Math.hypot(p.x - c.x, p.y - c.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 252, 244, 0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      drawCompass(ctx, c, p, false);
      return;
    }
    const a = toScreen(vw, pv.a);
    const b = toScreen(vw, pv.b);
    if (!pv.c) {
      drawCompass(ctx, a, b, true);
      return;
    }
    const c = toScreen(vw, pv.c);
    const r = Math.hypot(b.x - a.x, b.y - a.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 252, 244, 0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawCompass(ctx, c, { x: c.x + r * 0.8, y: c.y + r * 0.6 }, true);
  }
}

function tracePrim(ctx: CanvasRenderingContext2D, vw: View, p: Prim): void {
  if (p.kind === 'circle') {
    const c = toScreen(vw, p.c);
    ctx.moveTo(c.x + p.r * vw.s, c.y);
    ctx.arc(c.x, c.y, p.r * vw.s, 0, Math.PI * 2);
    return;
  }
  const clip = clipLine(p, viewRect(vw, 20));
  if (!clip) return;
  const len = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
  const ux = (p.b.x - p.a.x) / len;
  const uy = (p.b.y - p.a.y) / len;
  const s0 = toScreen(vw, { x: p.a.x + ux * clip[0], y: p.a.y + uy * clip[0] });
  const s1 = toScreen(vw, { x: p.a.x + ux * clip[1], y: p.a.y + uy * clip[1] });
  ctx.moveTo(s0.x, s0.y);
  ctx.lineTo(s1.x, s1.y);
}

export function tracePiece(ctx: CanvasRenderingContext2D, vw: View, p: Piece): void {
  if (p.kind === 'seg') {
    const a = toScreen(vw, p.p);
    const b = toScreen(vw, p.q);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    return;
  }
  const c = toScreen(vw, p.c);
  const r = p.r * vw.s;
  ctx.moveTo(c.x + r * Math.cos(-p.a1), c.y + r * Math.sin(-p.a1));
  ctx.arc(c.x, c.y, r, -p.a1, -p.a0);
}

/** A groove in plaster under light from the upper left: a dark lower lip and a bright scratch. */
function incise(
  ctx: CanvasRenderingContext2D,
  path: (c: CanvasRenderingContext2D) => void,
  width: number,
  fresh: number,
  deep = false,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.save();
  ctx.translate(deep ? 1.1 : 0.7, deep ? 1.3 : 0.8);
  ctx.beginPath();
  path(ctx);
  ctx.strokeStyle = `rgba(74, 58, 44, ${(deep ? 0.62 : 0.4) * fresh})`;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  path(ctx);
  ctx.strokeStyle = `rgba(255, 253, 247, ${0.92 * fresh})`;
  ctx.lineWidth = width * (deep ? 0.62 : 0.75);
  ctx.stroke();
  if (deep) {
    ctx.strokeStyle = 'rgba(90, 70, 52, 0.32)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  ctx.restore();
}

/** Red ochre chalk: a grainy double stroke. */
function chalk(ctx: CanvasRenderingContext2D, vw: View, p: Piece): void {
  ctx.save();
  ctx.lineCap = 'round';
  const passes: [number, number, number, number[]][] = [
    [0, 0, 0.3, [9, 3, 4, 2]],
    [0.8, -0.6, 0.22, [3, 2, 11, 4]],
    [-0.6, 0.7, 0.16, [5, 6, 2, 3]],
  ];
  for (const [dx, dy, a, dash] of passes) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.setLineDash(dash);
    ctx.strokeStyle = OCHRE + a + ')';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    tracePiece(ctx, vw, p);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function prick(ctx: CanvasRenderingContext2D, s: Vec): void {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 252, 245, 0.85)';
  ctx.beginPath();
  ctx.arc(s.x - 0.5, s.y - 0.5, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(38, 28, 20, 0.85)';
  ctx.beginPath();
  ctx.arc(s.x + 0.3, s.y + 0.4, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function cross(ctx: CanvasRenderingContext2D, s: Vec): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s.x - 6, s.y - 6);
  ctx.lineTo(s.x + 6, s.y + 6);
  ctx.moveTo(s.x + 6, s.y - 6);
  ctx.lineTo(s.x - 6, s.y + 6);
  ctx.translate(0.7, 0.8);
  ctx.strokeStyle = 'rgba(74, 58, 44, 0.5)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.translate(-0.7, -0.8);
  ctx.strokeStyle = 'rgba(255, 253, 247, 0.9)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Wrought-iron compasses standing on the floor, point at c and the other leg at p. */
function drawCompass(ctx: CanvasRenderingContext2D, c: Vec, p: Vec, dividers: boolean): void {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const d = Math.hypot(dx, dy);
  const leg = Math.max(d / 2 + 18, Math.min(300, d * 0.62 + 70));
  const mx = (c.x + p.x) / 2;
  const my = (c.y + p.y) / 2;
  // Hinge over the midpoint, lifted towards the top of the screen.
  let nx = d > 0.5 ? -dy / d : 0;
  let ny = d > 0.5 ? dx / d : -1;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const rise = Math.sqrt(Math.max(0, leg * leg - (d / 2) * (d / 2)));
  // Seen from above, the hinge stands up out of the floor; foreshorten it.
  const hx = mx + nx * rise * 0.55;
  const hy = my + ny * rise * 0.55;
  const lift = rise * 0.5;

  // Shadow: the tips touch the floor, the hinge throws its shadow down and to the right.
  ctx.save();
  ctx.fillStyle = 'rgba(46, 34, 24, 0.22)';
  ctx.filter = 'blur(2px)';
  legShape(ctx, hx + lift * 0.7, hy + lift * 0.45, c, 9, 1.4);
  ctx.fill();
  legShape(ctx, hx + lift * 0.7, hy + lift * 0.45, p, 9, 1.4);
  ctx.fill();
  ctx.filter = 'none';
  ctx.restore();

  for (const tip of [c, p]) {
    const g = ctx.createLinearGradient(hx - 6, hy - 6, hx + 6, hy + 6);
    g.addColorStop(0, '#9a9792');
    g.addColorStop(0.45, '#4d4a46');
    g.addColorStop(1, '#2a2826');
    ctx.fillStyle = g;
    legShape(ctx, hx, hy, tip, 9, 1.4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20, 18, 16, 0.7)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    // A worn bright edge down the leg.
    ctx.strokeStyle = 'rgba(230, 226, 218, 0.45)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(hx - 2, hy - 1);
    ctx.lineTo(tip.x - 0.4, tip.y - 0.3);
    ctx.stroke();
  }
  // Point tips.
  ctx.fillStyle = '#1d1b19';
  ctx.beginPath();
  ctx.arc(c.x, c.y, 1.4, 0, Math.PI * 2);
  ctx.fill();
  if (!dividers) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // The joint.
  const jg = ctx.createRadialGradient(hx - 3, hy - 3, 1, hx, hy, 10);
  jg.addColorStop(0, '#c9c5be');
  jg.addColorStop(0.6, '#5a5651');
  jg.addColorStop(1, '#2b2926');
  ctx.fillStyle = jg;
  ctx.beginPath();
  ctx.arc(hx, hy, dividers ? 7 : 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d8d3ca';
  ctx.beginPath();
  ctx.arc(hx - 1, hy - 1, 2, 0, Math.PI * 2);
  ctx.fill();
}

function legShape(ctx: CanvasRenderingContext2D, hx: number, hy: number, tip: Vec, w0: number, w1: number): void {
  const dx = tip.x - hx;
  const dy = tip.y - hy;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  ctx.beginPath();
  ctx.moveTo(hx + nx * w0 * 0.5, hy + ny * w0 * 0.5);
  ctx.lineTo(tip.x + nx * w1 * 0.5, tip.y + ny * w1 * 0.5);
  ctx.lineTo(tip.x - nx * w1 * 0.5, tip.y - ny * w1 * 0.5);
  ctx.lineTo(hx - nx * w0 * 0.5, hy - ny * w0 * 0.5);
  ctx.closePath();
}

/** An oak straightedge laid along a-b, its working edge on the line. */
function drawRule(ctx: CanvasRenderingContext2D, a: Vec, b: Vec): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  const ux = dx / l;
  const uy = dy / l;
  // Lay the body on the upper side of the line.
  let nx = -uy;
  let ny = ux;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const ext = 46;
  const wide = 20;
  const p0 = { x: a.x - ux * ext, y: a.y - uy * ext };
  const p1 = { x: b.x + ux * ext, y: b.y + uy * ext };
  const quad = (o: number): void => {
    ctx.beginPath();
    ctx.moveTo(p0.x + o, p0.y + o * 0.7);
    ctx.lineTo(p1.x + o, p1.y + o * 0.7);
    ctx.lineTo(p1.x + nx * wide + o, p1.y + ny * wide + o * 0.7);
    ctx.lineTo(p0.x + nx * wide + o, p0.y + ny * wide + o * 0.7);
    ctx.closePath();
  };
  ctx.save();
  ctx.fillStyle = 'rgba(46, 34, 24, 0.2)';
  quad(6);
  ctx.fill();
  const g = ctx.createLinearGradient(a.x, a.y, a.x + nx * wide, a.y + ny * wide);
  g.addColorStop(0, '#8a6439');
  g.addColorStop(0.18, '#c1955f');
  g.addColorStop(0.8, '#a97c48');
  g.addColorStop(1, '#7a5530');
  ctx.fillStyle = g;
  quad(0);
  ctx.fill();
  ctx.clip();
  // Grain.
  const r = rng(Math.round(l));
  ctx.strokeStyle = 'rgba(80, 52, 26, 0.22)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 7; i++) {
    const o = 3 + r() * (wide - 5);
    const wob = r() * 2 - 1;
    ctx.beginPath();
    ctx.moveTo(p0.x + nx * o, p0.y + ny * o);
    ctx.quadraticCurveTo(
      (p0.x + p1.x) / 2 + nx * (o + wob * 3),
      (p0.y + p1.y) / 2 + ny * (o + wob * 3),
      p1.x + nx * o,
      p1.y + ny * o,
    );
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(40, 26, 12, 0.7)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
  ctx.restore();
}

function makeGrain(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const g = c.getContext('2d');
  if (!g) return c;
  const img = g.createImageData(192, 192);
  const r = rng(7);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = r();
    const v = n < 0.5 ? 0 : 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = Math.floor(Math.abs(n - 0.5) * 2 * 26);
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Smooth noise: a small random grid drawn up with bilinear smoothing. */
function blotch(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  cells: number,
  r: () => number,
  alpha: number,
): void {
  const cw = Math.max(2, Math.round((w / Math.max(w, h)) * cells));
  const ch = Math.max(2, Math.round((h / Math.max(w, h)) * cells));
  const t = document.createElement('canvas');
  t.width = cw;
  t.height = ch;
  const tg = t.getContext('2d');
  if (!tg) return;
  const img = tg.createImageData(cw, ch);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = r();
    const dark = n < 0.5;
    img.data[i] = dark ? 96 : 255;
    img.data[i + 1] = dark ? 84 : 252;
    img.data[i + 2] = dark ? 70 : 244;
    img.data[i + 3] = Math.floor(Math.abs(n - 0.5) * 2 * 255 * alpha);
  }
  tg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(t, 0, 0, w, h);
}

function makePlaster(w: number, h: number, dpr: number, seed: number, grain: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext('2d');
  if (!g) return c;
  g.scale(dpr, dpr);
  const r = rng(seed * 7919 + 13);

  g.fillStyle = '#e8e0cf';
  g.fillRect(0, 0, w, h);
  blotch(g, w, h, 6, r, 0.1);
  blotch(g, w, h, 17, r, 0.09);
  blotch(g, w, h, 46, r, 0.08);
  blotch(g, w, h, 130, r, 0.07);

  // Trowel sweeps from when the layer was laid.
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = r() * w;
    const y = r() * h;
    const len = 60 + r() * 220;
    const a = r() * Math.PI;
    const bend = (r() - 0.5) * len * 0.5;
    g.strokeStyle =
      r() < 0.5 ? `rgba(255, 252, 244, ${0.05 + r() * 0.07})` : `rgba(110, 96, 78, ${0.025 + r() * 0.04})`;
    g.lineWidth = 18 + r() * 50;
    g.beginPath();
    g.moveTo(x - Math.cos(a) * len, y - Math.sin(a) * len);
    g.quadraticCurveTo(x - Math.sin(a) * bend, y + Math.cos(a) * bend, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }

  // Where feet have gone: wide grey smudges.
  for (let i = 0; i < 9; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = (0.08 + r() * 0.22) * Math.max(w, h);
    const rg = g.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, `rgba(120, 108, 92, ${0.03 + r() * 0.05})`);
    rg.addColorStop(1, 'rgba(120, 108, 92, 0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
  }

  // Older drawings, brushed over: lines and arcs with no connection to one another.
  const unit = Math.min(w, h);
  g.lineCap = 'round';
  for (let i = 0; i < 54; i++) {
    const worn = 0.08 + r() * 0.18;
    const dash = [10 + r() * 90, 4 + r() * 30, 2 + r() * 40, 6 + r() * 20];
    g.setLineDash(dash);
    g.lineDashOffset = r() * 100;
    g.beginPath();
    if (r() < 0.55) {
      const cx = r() * w;
      const cy = r() * h;
      const rad = unit * (0.05 + r() * 0.7);
      const a0 = r() * Math.PI * 2;
      g.arc(cx, cy, rad, a0, a0 + 0.4 + r() * 3);
    } else {
      const x = r() * w;
      const y = r() * h;
      const a = r() < 0.5 ? Math.PI / 2 : r() * Math.PI;
      const l = unit * (0.2 + r() * 0.9);
      g.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    }
    g.strokeStyle = `rgba(255, 252, 246, ${worn * 2.4})`;
    g.lineWidth = 1;
    g.stroke();
    g.translate(0.7, 0.8);
    g.strokeStyle = `rgba(90, 74, 58, ${worn})`;
    g.stroke();
    g.translate(-0.7, -0.8);
  }
  g.setLineDash([]);

  // Old compass holes.
  for (let i = 0; i < 26; i++) {
    const x = r() * w;
    const y = r() * h;
    g.fillStyle = 'rgba(60, 46, 34, 0.22)';
    g.beginPath();
    g.arc(x, y, 1 + r(), 0, Math.PI * 2);
    g.fill();
  }

  // Grit.
  const pat = g.createPattern(grain, 'repeat');
  if (pat) {
    g.fillStyle = pat;
    g.fillRect(0, 0, w, h);
  }

  // Raking light from a window off to the upper left, with its mullion shadows.
  g.save();
  g.globalCompositeOperation = 'soft-light';
  const lg = g.createLinearGradient(0, 0, w, h);
  lg.addColorStop(0, 'rgba(255, 246, 222, 0.85)');
  lg.addColorStop(0.5, 'rgba(255, 246, 222, 0.2)');
  lg.addColorStop(1, 'rgba(40, 30, 20, 0.55)');
  g.fillStyle = lg;
  g.fillRect(0, 0, w, h);
  g.restore();

  g.save();
  g.globalCompositeOperation = 'multiply';
  const vg = g.createRadialGradient(w * 0.38, h * 0.36, unit * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.85);
  vg.addColorStop(0, 'rgba(255, 255, 255, 1)');
  vg.addColorStop(1, 'rgba(176, 158, 134, 1)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  g.restore();

  return c;
}
