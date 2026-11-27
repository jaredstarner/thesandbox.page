// What lies on the paper's surface: blind embossing and mica that catch a lamp you move,
// and the rain or snow, falling in the print's own manner.

import { IH, IW, MARGIN, type Plate } from './_scene';
import { clamp, mulberry32 } from './_util';

interface Drop {
  x: number;
  y: number;
  len: number;
  v: number;
  phase: number;
}

export class Finish {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hi = document.createElement('canvas');
  private lo = document.createElement('canvas');
  private relief: HTMLCanvasElement | null = null;
  private plate: Plate | null = null;
  private drops: Drop[] = [];
  private scale = 1;
  /** The lamp, in image units; it eases toward where it's asked to be. */
  private lamp = { x: 180, y: -260, tx: 180, ty: -260 };
  private embossedFor = '';
  private flash = 0;
  private nextFlash = 0;
  private bolt: [number, number][] = [];
  private still = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('2d canvas unavailable');
    this.ctx = c;
  }

  setSize(w: number, h: number, scale: number) {
    this.canvas.width = Math.round(w);
    this.canvas.height = Math.round(h);
    this.hi.width = this.lo.width = Math.round(w / 2);
    this.hi.height = this.lo.height = Math.round(h / 2);
    this.scale = scale;
    this.embossedFor = '';
  }

  setPlate(plate: Plate | null, relief: HTMLCanvasElement | null, still: boolean) {
    this.plate = plate;
    this.relief = relief;
    this.still = still;
    this.embossedFor = '';
    const rng = mulberry32(7);
    const fall = plate?.fall ?? 'none';
    const n =
      fall === 'none'
        ? 0
        : fall === 'snow'
          ? Math.round(140 + plate!.wet * 420)
          : fall === 'drizzle'
            ? Math.round(110 + plate!.wet * 120)
            : Math.round(140 + plate!.wet * 300);
    this.drops = Array.from({ length: n }, () => ({
      x: rng() * IW * 1.4 - IW * 0.2,
      y: rng() * IH,
      len: fall === 'snow' ? 1.6 + rng() ** 2 * 3.4 : (fall === 'drizzle' ? 26 : 60) + rng() * (fall === 'drizzle' ? 40 : 120),
      v: fall === 'snow' ? 45 + rng() * 70 : (fall === 'drizzle' ? 900 : 1500) + rng() * 700,
      phase: rng() * Math.PI * 2,
    }));
    this.nextFlash = performance.now() + 3000 + Math.random() * 6000;
  }

  /** Move the lamp to a point on the sheet, in image units, or back to its rest. */
  aim(x: number | null, y = 0) {
    if (x === null) {
      this.lamp.tx = 180;
      this.lamp.ty = -260;
    } else {
      this.lamp.tx = x;
      this.lamp.ty = y;
    }
  }

  /** True while something on the surface is still moving. */
  get busy(): boolean {
    const l = this.lamp;
    return (
      Math.abs(l.tx - l.x) > 0.5 ||
      Math.abs(l.ty - l.y) > 0.5 ||
      (!this.still && this.drops.length > 0) ||
      (!this.still && !!this.plate?.thunder) ||
      this.flash > 0.01
    );
  }

  private emboss() {
    const key = `${Math.round(this.lamp.x / 6)},${Math.round(this.lamp.y / 6)}`;
    if (key === this.embossedFor || !this.relief) return;
    this.embossedFor = key;
    const w = this.hi.width;
    const h = this.hi.height;
    const cx = IW / 2;
    const cy = IH / 2;
    let lx = this.lamp.x - cx;
    let ly = this.lamp.y - cy;
    const l = Math.hypot(lx, ly) || 1;
    lx /= l;
    ly /= l;
    const d = 1.6 * this.scale;
    for (const [cv, sign] of [
      [this.hi, 1],
      [this.lo, -1],
    ] as const) {
      const c = cv.getContext('2d')!;
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, w, h);
      c.drawImage(this.relief, sign * lx * d, sign * ly * d, w, h);
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(this.relief, -sign * lx * d, -sign * ly * d, w, h);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = sign > 0 ? 'rgb(255, 253, 246)' : 'rgb(70, 60, 48)';
      c.fillRect(0, 0, w, h);
    }
  }

  /** Draw one frame; dt in seconds. */
  draw(now: number, dt: number) {
    const c = this.ctx;
    const s = this.scale;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const k = 1 - Math.exp(-dt * 9);
    this.lamp.x += (this.lamp.tx - this.lamp.x) * k;
    this.lamp.y += (this.lamp.ty - this.lamp.y) * k;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, W, H);
    const p = this.plate;
    if (!p) return;

    // The lamp's sheen on the paper.
    const lxp = (MARGIN + this.lamp.x) * s;
    const lyp = (MARGIN + this.lamp.y) * s;
    const g = c.createRadialGradient(lxp, lyp, 0, lxp, lyp, 900 * s);
    g.addColorStop(0, 'rgba(255, 248, 232, 0.07)');
    g.addColorStop(1, 'rgba(255, 248, 232, 0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // Blind embossing, lit from the lamp's side.
    if (this.relief) {
      this.emboss();
      c.globalAlpha = 0.85;
      c.drawImage(this.hi, 0, 0, W, H);
      c.globalAlpha = 0.5;
      c.drawImage(this.lo, 0, 0, W, H);
      c.globalAlpha = 1;
    }

    // Mica: each flake a tiny mirror at its own angle, bright only when it faces the lamp.
    if (p.mica.length) {
      c.save();
      c.translate(MARGIN * s, MARGIN * s);
      c.beginPath();
      c.rect(0, 0, IW * s, IH * s);
      c.clip();
      for (const [x, y, a] of p.mica) {
        const toward = Math.atan2(this.lamp.y - y, this.lamp.x - x);
        const b = Math.cos(a - toward);
        if (b < 0.93) continue;
        const v = ((b - 0.93) / 0.07) ** 2;
        c.fillStyle = `rgba(255, 250, 236, ${(0.25 + v * 0.75).toFixed(3)})`;
        const r = (0.7 + v * 1.4) * s;
        c.fillRect(x * s - r, y * s - r * 0.25, r * 2, r * 0.5);
        c.fillRect(x * s - r * 0.25, y * s - r, r * 0.5, r * 2);
      }
      c.restore();
    }

    // Rain in long fine strokes; snow as flicked shell white.
    if (this.drops.length) {
      c.save();
      c.translate(MARGIN * s, MARGIN * s);
      c.beginPath();
      c.rect(0, 0, IW * s, IH * s);
      c.clip();
      const t = this.still ? 0 : dt;
      const slant = clamp(p.windX, -1, 1) * 0.45;
      if (p.fall === 'snow' || p.fall === 'hail') {
        c.fillStyle = 'rgba(250, 247, 240, 0.95)';
        c.strokeStyle = 'rgba(120, 125, 135, 0.35)';
        c.lineWidth = 0.8 * s;
        for (const d of this.drops) {
          d.y += d.v * t * (p.fall === 'hail' ? 6 : 1);
          d.x += (slant * 160 + Math.sin(now / 900 + d.phase) * 22) * t;
          if (d.y > IH + 10) {
            d.y -= IH + 20;
            d.x = Math.random() * IW * 1.4 - IW * 0.2;
          }
          if (d.x < -40) d.x += IW + 80;
          if (d.x > IW + 40) d.x -= IW + 80;
          c.beginPath();
          c.arc(d.x * s, d.y * s, d.len * s * (p.fall === 'hail' ? 0.6 : 1), 0, Math.PI * 2);
          c.fill();
          c.stroke();
        }
      } else {
        c.strokeStyle = p.night ? 'rgba(196, 202, 214, 0.55)' : 'rgba(38, 46, 62, 0.55)';
        c.lineCap = 'round';
        c.lineWidth = (p.fall === 'drizzle' ? 0.8 : 1.15) * s;
        c.beginPath();
        for (const d of this.drops) {
          d.y += d.v * t;
          d.x += d.v * t * slant;
          if (d.y > IH + d.len) {
            d.y -= IH + d.len * 2;
            d.x = Math.random() * IW * 1.4 - IW * 0.2;
          }
          c.moveTo(d.x * s, d.y * s);
          c.lineTo((d.x - d.len * slant) * s, (d.y - d.len) * s);
        }
        c.stroke();
        if (p.fall === 'freezing') {
          c.fillStyle = 'rgba(250, 247, 240, 0.8)';
          for (let i = 0; i < this.drops.length; i += 5) {
            const d = this.drops[i];
            c.fillRect(d.x * s, d.y * s, 2 * s, 2 * s);
          }
        }
      }
      c.restore();
    }

    // Lightning: the sheet flares and a bolt is struck down to the hills.
    if (p.thunder && !this.still) {
      if (now > this.nextFlash) {
        this.flash = 1;
        this.nextFlash = now + 4000 + Math.random() * 9000;
        const x0 = 150 + Math.random() * (IW - 300);
        this.bolt = [[x0, 0]];
        let x = x0;
        for (let y = 0; y < 700; y += 40 + Math.random() * 50) {
          x += (Math.random() - 0.5) * 90;
          this.bolt.push([x, y]);
        }
      }
      if (this.flash > 0.01) {
        c.save();
        c.translate(MARGIN * s, MARGIN * s);
        c.fillStyle = `rgba(255, 252, 240, ${(this.flash * 0.45).toFixed(3)})`;
        c.fillRect(0, 0, IW * s, IH * s);
        c.strokeStyle = `rgba(255, 246, 200, ${this.flash.toFixed(3)})`;
        c.lineWidth = 3 * s;
        c.lineJoin = 'miter';
        c.beginPath();
        this.bolt.forEach(([bx, by], i) => (i ? c.lineTo(bx * s, by * s) : c.moveTo(bx * s, by * s)));
        c.stroke();
        c.restore();
        this.flash *= Math.exp(-dt * 7);
      }
    }
  }
}
