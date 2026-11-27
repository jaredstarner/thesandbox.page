// The press: lays damp paper, inks each carved block, and pulls an impression with the baren.
// Each block is a mask the scene carves; the press grades it (bokashi), lets the ink pool at
// its edges, wipes it where the mist lies, lets the wood grain through, nudges it a hair off
// register, and prints it by multiplying, the way transparent water-based colour builds up.

import { IH, IW, MARGIN, SW, getFont, type Block, type Plate, type Tools } from './_scene';
import { clamp, hashString, mulberry32, noise2 } from './_util';

const FILTERS = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext('2d');
  if (!x) throw new Error('2d canvas unavailable');
  return x;
}

function reset(c: CanvasRenderingContext2D) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  if (FILTERS) c.filter = 'none';
}

const PAPER = [236, 228, 207];

/** Washi: warm, faintly mottled, with long kozo fibres lying in it. */
function makePaper(w: number, h: number, seed: number): { paper: HTMLCanvasElement; fibres: HTMLCanvasElement } {
  const hw = Math.ceil(w / 2);
  const hh = Math.ceil(h / 2);
  const half = makeCanvas(hw, hh);
  const hc = ctxOf(half);
  const img = hc.createImageData(hw, hh);
  const n1 = noise2(seed);
  const n2 = noise2(seed + 7);
  const rng = mulberry32(seed + 3);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const v = (n1(x * 0.012, y * 0.012) - 0.5) * 0.045 + (n2(x * 0.09, y * 0.09) - 0.5) * 0.03 + (rng() - 0.5) * 0.03;
      const i = (y * hw + x) * 4;
      img.data[i] = PAPER[0] * (1 + v);
      img.data[i + 1] = PAPER[1] * (1 + v);
      img.data[i + 2] = PAPER[2] * (1 + v * 1.2);
      img.data[i + 3] = 255;
    }
  }
  hc.putImageData(img, 0, 0);
  const paper = makeCanvas(w, h);
  const pc = ctxOf(paper);
  pc.imageSmoothingQuality = 'high';
  pc.drawImage(half, 0, 0, w, h);

  const fibres = makeCanvas(w, h);
  const fc = ctxOf(fibres);
  const k = w / SW;
  const count = Math.round(1800 * (w * h) / (1000 * 1460));
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const len = (14 + rng() * 70) * k;
    const a = rng() * Math.PI * 2;
    const bend = (rng() - 0.5) * len * 0.8;
    const dark = rng() < 0.18;
    const target = dark ? pc : fc;
    target.strokeStyle = dark ? 'rgba(140, 120, 90, 0.08)' : `rgba(255, 252, 242, ${0.16 + rng() * 0.2})`;
    target.lineWidth = (0.5 + rng() * 0.9) * k * 1.4;
    target.beginPath();
    target.moveTo(x, y);
    target.quadraticCurveTo(
      x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend,
      y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    );
    target.stroke();
  }
  pc.globalAlpha = 0.5;
  pc.drawImage(fibres, 0, 0);
  pc.globalAlpha = 1;
  return { paper, fibres };
}

/** Where the plank's grain and the baren's pressure keep ink off: alpha is the ink taken away. */
function makeGrain(w: number, h: number, seed: number): HTMLCanvasElement {
  const hw = Math.ceil(w / 2);
  const hh = Math.ceil(h / 2);
  const half = makeCanvas(hw, hh);
  const hc = ctxOf(half);
  const img = hc.createImageData(hw, hh);
  const warp = noise2(seed + 11);
  const warp2 = noise2(seed + 15);
  const tone = noise2(seed + 12);
  const mottle = noise2(seed + 13);
  const patch = noise2(seed + 16);
  const rng = mulberry32(seed + 14);
  const k = (hw * 2) / (SW * 1.3);
  const spacing = 7 * k;
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      // Growth rings, bent around knots and bunched or spread as the plank's grain wanders.
      const yy =
        y +
        (warp(x * 0.0018 / k, y * 0.005 / k) - 0.5) * 160 * k +
        (warp2(x * 0.007 / k, y * 0.02 / k) - 0.5) * 18 * k;
      const ring = 0.5 + 0.5 * Math.cos((yy / spacing) * Math.PI * 2 * (0.8 + 0.5 * tone(x * 0.0015 / k, 3.1)));
      const show = Math.max(0, patch(x * 0.0024 / k, y * 0.004 / k) - 0.38) / 0.62;
      const lines = ring ** 14 * show * (0.4 + 0.6 * tone(x * 0.012 / k, y * 0.05 / k));
      const m = mottle(x * 0.004 / k, y * 0.004 / k);
      const speck = rng() < 0.0012 ? 0.6 : 0;
      const a = clamp(lines * 0.85 + Math.max(0, m - 0.58) * 0.8 + speck + rng() * 0.04);
      img.data[(y * hw + x) * 4 + 3] = a * 255;
    }
  }
  hc.putImageData(img, 0, 0);
  const grain = makeCanvas(hw * 2, hh * 2);
  ctxOf(grain).drawImage(half, 0, 0, hw * 2, hh * 2);
  return grain;
}

function makeBrush(r: number): HTMLCanvasElement {
  const c = makeCanvas(r * 2, r * 2);
  const x = ctxOf(c);
  const g = x.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.75)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, r * 2, r * 2);
  return c;
}

export interface PullHooks {
  onBlock?: (index: number) => void;
  isCancelled?: () => boolean;
  /** Milliseconds per block. */
  pace?: number;
}

export class Press {
  readonly view: HTMLCanvasElement;
  private vctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  scale = 1;
  private paper!: HTMLCanvasElement;
  private fibres!: HTMLCanvasElement;
  private grain!: HTMLCanvasElement;
  private blk!: HTMLCanvasElement;
  private tmp!: HTMLCanvasElement;
  private done!: HTMLCanvasElement;
  private reveal!: HTMLCanvasElement;
  /** Height of whatever was blind-printed, blurred into slopes. */
  relief!: HTMLCanvasElement;
  private brush!: HTMLCanvasElement;
  private seed: number;

  constructor(view: HTMLCanvasElement, seed = 1) {
    this.view = view;
    this.vctx = ctxOf(view);
    this.seed = seed;
  }

  /** Size the press to the sheet's pixels; textures are made again only when the size changes. */
  setSize(w: number, h: number): boolean {
    w = Math.round(w);
    h = Math.round(h);
    if (w === this.w && h === this.h) return false;
    this.w = w;
    this.h = h;
    this.scale = w / SW;
    this.view.width = w;
    this.view.height = h;
    const { paper, fibres } = makePaper(w, h, this.seed);
    this.paper = paper;
    this.fibres = fibres;
    this.grain = makeGrain(w * 1.3, h * 1.3, this.seed);
    this.blk = makeCanvas(w, h);
    this.tmp = makeCanvas(w, h);
    this.done = makeCanvas(w, h);
    this.reveal = makeCanvas(w, h);
    this.relief = makeCanvas(w, h);
    this.brush = makeBrush(Math.round((IH / 6) * 0.9 * this.scale));
    return true;
  }

  private tools(c: CanvasRenderingContext2D, scale: number): Tools {
    return {
      scale,
      blur: (units: number) => {
        if (FILTERS) c.filter = units > 0 ? `blur(${(units * scale).toFixed(2)}px)` : 'none';
      },
    };
  }

  /** Carve a block onto any canvas: the press's own, or a thumbnail's (mirrored, as the wood is). */
  carveInto(c: CanvasRenderingContext2D, b: Block, scale: number, ox: number, oy: number, mirror = false) {
    c.save();
    c.setTransform(mirror ? -scale : scale, 0, 0, scale, ox, oy);
    c.beginPath();
    c.rect(0, 0, IW, IH);
    c.clip();
    c.fillStyle = b.pigment;
    c.strokeStyle = b.pigment;
    b.carve(c, this.tools(c, scale));
    c.restore();
  }

  /** Ink a block and take its impression into the block canvas, ready to print. */
  private impression(b: Block, plate: Plate): HTMLCanvasElement {
    const c = ctxOf(this.blk);
    const s = this.scale;
    reset(c);
    c.clearRect(0, 0, this.w, this.h);
    const r = mulberry32(hashString(b.id) ^ this.seed);
    const jx = (r() - 0.5) * 1.6;
    const jy = (r() - 0.5) * 1.6;
    this.carveInto(c, b, s, (MARGIN + jx) * s, (MARGIN + jy) * s);
    reset(c);
    if (!b.keep && plate.reserve.length) {
      c.setTransform(s, 0, 0, s, MARGIN * s, MARGIN * s);
      c.globalCompositeOperation = 'destination-out';
      for (const [x, y, w, h] of plate.reserve) c.fillRect(x, y, w, h);
      reset(c);
    }
    if (b.mode === 'blind' || b.mode === 'mica') return this.blk;

    if (b.pool && FILTERS) {
      const t = ctxOf(this.tmp);
      reset(t);
      t.clearRect(0, 0, this.w, this.h);
      t.filter = `blur(${(2.4 * s).toFixed(2)}px)`;
      t.drawImage(this.blk, 0, 0);
      t.filter = 'none';
      c.globalCompositeOperation = 'destination-out';
      c.globalAlpha = b.pool;
      c.drawImage(this.tmp, 0, 0);
      c.globalAlpha = 1;
    }
    if (b.bokashi && b.bokashi.length > 1) {
      const stops = b.bokashi;
      const y0 = stops[0][0];
      const y1 = stops[stops.length - 1][0];
      const g = c.createLinearGradient(0, (MARGIN + y0) * s, 0, (MARGIN + y1) * s);
      for (const [y, a] of stops) g.addColorStop(clamp((y - y0) / (y1 - y0 || 1)), `rgba(0,0,0,${clamp(a)})`);
      c.globalCompositeOperation = 'destination-in';
      c.fillStyle = g;
      c.fillRect(0, 0, this.w, this.h);
    }
    if (b.misted && plate.mist.length) {
      c.globalCompositeOperation = 'destination-out';
      for (const [y, hh, a] of plate.mist) {
        const g = c.createLinearGradient(0, (MARGIN + y - hh) * s, 0, (MARGIN + y + hh) * s);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.5, `rgba(0,0,0,${clamp(a)})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, this.w, this.h);
      }
    }
    if (b.grain) {
      c.globalCompositeOperation = 'destination-out';
      c.globalAlpha = b.grain;
      const ox = r() * (this.grain.width - this.w);
      const oy = r() * (this.grain.height - this.h);
      c.drawImage(this.grain, -ox, -oy);
    }
    reset(c);
    return this.blk;
  }

  private laid(target: CanvasRenderingContext2D) {
    reset(target);
    target.drawImage(this.paper, 0, 0);
  }

  private printOnto(target: CanvasRenderingContext2D, b: Block, src: HTMLCanvasElement) {
    if (b.mode === 'mica') return;
    if (b.mode === 'blind') {
      const r = ctxOf(this.relief);
      reset(r);
      if (FILTERS) r.filter = `blur(${(1.4 * this.scale).toFixed(2)}px)`;
      r.drawImage(src, 0, 0);
      reset(r);
      return;
    }
    target.globalCompositeOperation = b.mode === 'white' ? 'source-over' : 'multiply';
    target.globalAlpha = clamp(b.strength ?? 1);
    target.drawImage(src, 0, 0);
    target.globalAlpha = 1;
    target.globalCompositeOperation = 'source-over';
  }

  private finishSheet(target: CanvasRenderingContext2D, plate?: Plate) {
    reset(target);
    target.globalAlpha = 0.16;
    target.drawImage(this.fibres, 0, 0);
    target.globalAlpha = 1;
    if (!plate) return;
    // Pencil in the bottom margin.
    const s = this.scale;
    target.fillStyle = 'rgba(92, 90, 86, 0.72)';
    target.font = `400 ${(17 * s).toFixed(1)}px ${getFont()}`;
    target.textBaseline = 'middle';
    const y = (MARGIN + IH + MARGIN / 2) * s;
    target.textAlign = 'left';
    target.fillText(plate.margin[0], (MARGIN + 4) * s, y);
    target.textAlign = 'right';
    target.fillText(plate.margin[1], (MARGIN + IW - 4) * s, y);
  }

  /** Print every block at once. `only` pulls a single proof. */
  render(plate: Plate, only?: string) {
    if (!this.w) return;
    const d = ctxOf(this.done);
    this.laid(d);
    ctxOf(this.relief).clearRect(0, 0, this.w, this.h);
    for (const b of plate.blocks) {
      if (only && b.id !== only) continue;
      this.printOnto(d, b, this.impression(b, plate));
    }
    this.finishSheet(d, only ? undefined : plate);
    reset(this.vctx);
    this.vctx.drawImage(this.done, 0, 0);
  }

  /** Lay a blank sheet. */
  blank() {
    if (!this.w) return;
    this.laid(this.vctx);
    this.finishSheet(this.vctx);
  }

  /** Print the blocks one by one, rubbing each into the paper in rows. Resolves false if cancelled. */
  async pull(plate: Plate, hooks: PullHooks = {}): Promise<boolean> {
    if (!this.w) return false;
    const d = ctxOf(this.done);
    this.laid(d);
    ctxOf(this.relief).clearRect(0, 0, this.w, this.h);
    const v = this.vctx;
    const t = ctxOf(this.tmp);
    const rv = ctxOf(this.reveal);
    const s = this.scale;
    const rows = 6;
    const br = this.brush.width / 2;
    const pace = hooks.pace ?? 560;
    const frame = () => new Promise<number>((res) => requestAnimationFrame(res));

    for (let i = 0; i < plate.blocks.length; i++) {
      if (hooks.isCancelled?.()) return false;
      const b = plate.blocks[i];
      hooks.onBlock?.(i);
      const src = this.impression(b, plate);
      if (b.mode === 'blind' || b.mode === 'mica') {
        this.printOnto(d, b, src);
        const until = performance.now() + pace * 0.45;
        while (performance.now() < until) {
          await frame();
          if (hooks.isCancelled?.()) return false;
        }
        continue;
      }
      reset(rv);
      rv.clearRect(0, 0, this.w, this.h);
      const rng = mulberry32(hashString(b.id) + 99);
      const start = performance.now();
      let last = 0;
      const total = rows;
      const point = (p: number): [number, number] => {
        const row = Math.min(rows - 1, Math.floor(p));
        const u = p - row;
        const y = (MARGIN + ((row + 0.5) / rows) * IH) * s;
        const x0 = (MARGIN - 40) * s;
        const x1 = (MARGIN + IW + 40) * s;
        return [row % 2 === 0 ? x0 + (x1 - x0) * u : x1 - (x1 - x0) * u, y];
      };
      for (;;) {
        const now = await frame();
        if (hooks.isCancelled?.()) return false;
        const p = Math.min(total, ((now - start) / pace) * total);
        const step = 14 / (IW * s);
        for (let q = last; q <= p; q += step) {
          const [x, y] = point(Math.min(q, total - 1e-6));
          rv.drawImage(this.brush, x - br + (rng() - 0.5) * 18 * s, y - br + (rng() - 0.5) * 40 * s);
        }
        last = p;
        reset(v);
        v.drawImage(this.done, 0, 0);
        reset(t);
        t.clearRect(0, 0, this.w, this.h);
        t.drawImage(src, 0, 0);
        t.globalCompositeOperation = 'destination-in';
        t.drawImage(this.reveal, 0, 0);
        this.printOnto(v, b, this.tmp);
        if (p >= total) break;
      }
      this.printOnto(d, b, src);
    }
    this.finishSheet(d, plate);
    reset(v);
    v.drawImage(this.done, 0, 0);
    return true;
  }
}

