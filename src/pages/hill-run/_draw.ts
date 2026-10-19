// Hill run: the hill, drawn as a screenprint.
//
// Ground is drawn straight down from above. Anything standing up is lifted up the
// screen by its height and leaned away from the middle, as a camera high over the
// hill would see it, so the houses show their street fronts and the trees lean out.
// Each course prints in its own handful of inks on cream stock, with grain on top.

import {
  BANK,
  BLOCK,
  BLOCKS,
  CROSS,
  CURB,
  ICE,
  WALK,
  crossStreets,
  moveX,
  mulberry,
  sample,
  STEP,
  type LevelId,
  type Thing,
} from './_course';
import type { Run } from './_sim';

type Inks = {
  paper: string;
  ground: string;
  groundDark: string;
  groundLight: string;
  key: string;
  shadow: string;
  red: string;
  gold: string;
  blue: string;
  green: string;
  skin: string;
  coats: string[];
};

export const INKS: Record<LevelId, Inks> = {
  bomb: {
    paper: '#f1e6cf',
    ground: '#4a5068',
    groundDark: '#3a3f55',
    groundLight: '#5d6480',
    key: '#232637',
    shadow: 'rgba(28, 30, 52, 0.38)',
    red: '#d4482f',
    gold: '#f0b13c',
    blue: '#7fa7c4',
    green: '#3f6b4a',
    skin: '#e3a882',
    coats: ['#d4482f', '#2f7f86', '#f0b13c', '#e9e0cc', '#8a5a9e', '#3a6ea5'],
  },
  cheese: {
    paper: '#f4ead2',
    ground: '#7fa45a',
    groundDark: '#628a45',
    groundLight: '#a3c172',
    key: '#2c3320',
    shadow: 'rgba(38, 52, 28, 0.32)',
    red: '#cf4b33',
    gold: '#f2c24a',
    blue: '#4f7fb0',
    green: '#3e5e33',
    skin: '#e8b08c',
    coats: ['#cf4b33', '#f4ead2', '#4f7fb0', '#f2c24a', '#2c3320', '#d97a9b', '#e47f2f'],
  },
  luge: {
    paper: '#eef1f2',
    ground: '#e3eaf0',
    groundDark: '#c9d6e2',
    groundLight: '#f7f9fb',
    key: '#14203a',
    shadow: 'rgba(20, 32, 64, 0.3)',
    red: '#c8323c',
    gold: '#f2b84b',
    blue: '#2e5fa6',
    green: '#1f3b3a',
    skin: '#e3b08f',
    coats: ['#c8323c', '#2e5fa6', '#f2b84b', '#1f3b3a', '#eef1f2', '#7a3f8a'],
  },
};

const HOUSE = ['#e9a66b', '#8fb3a6', '#d98a8a', '#e8cf87', '#9fb6cf', '#c9b2d6', '#e6d9bf'];
const CARS = ['#d4482f', '#e9e0cc', '#2f7f86', '#3a3f55', '#f0b13c', '#7fa7c4', '#9a9a8e', '#5b3f52'];

/** How far up the screen a metre of height goes, as a fraction of a metre across. */
const RISE = 0.82;
/** How far a tall thing leans away from the middle, per metre of height, per pixel out. */
const LEAN = 0.012;

export interface Camera {
  x: number;
  y: number;
  s: number;
  /** Screen position of the camera point, as a fraction of height. */
  ay: number;
  shake: number;
}

export class Painter {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private grain: CanvasPattern | null = null;
  private night: HTMLCanvasElement;
  private seams: number[] = [];
  cam: Camera = { x: 0, y: 0, s: 24, ay: 0.3, shake: 0 };
  bill = 'Impact, sans-serif';
  text = 'Arial, sans-serif';
  /** Paused: confetti hangs where it is. */
  hold = false;
  /** How far the rider is drawn above their shadow, in CSS pixels. */
  private air = 0;
  private confetti: { x: number; y: number; vx: number; vy: number; a: number; va: number; c: string; w: number }[] =
    [];
  private lastNow = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.night = document.createElement('canvas');
    const r = mulberry(77);
    for (let y = -8; y < 1200; y += 2.5 + r() * 5) this.seams.push(y);
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.night.width = Math.max(1, Math.round(w / 2));
    this.night.height = Math.max(1, Math.round(h / 2));
    this.grain = this.makeGrain();
  }

  /** The scale for this screen: about 36 m of hill top to bottom, never under 18 m across. */
  baseScale(): number {
    return Math.min(this.h / 36, this.w / 18);
  }

  private makeGrain(): CanvasPattern | null {
    const c = document.createElement('canvas');
    const n = 192;
    c.width = c.height = n;
    const g = c.getContext('2d')!;
    const img = g.createImageData(n, n);
    const r = mulberry(5);
    for (let i = 0; i < n * n; i++) {
      // Paper tooth: mostly fine speckle with the odd fleck of fibre.
      const v = 255 - Math.floor(r() ** 3 * 70) - (r() < 0.004 ? 60 : 0);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v - 3;
      img.data[i * 4 + 2] = v - 10;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return this.ctx.createPattern(c, 'repeat');
  }

  /** Follow the rider: ahead of them as they speed up, a little shake on a crash. */
  follow(run: Run, dt: number, snap = false): void {
    const r = run.rider;
    const cam = this.cam;
    const base = this.baseScale();
    const fast = run.id === 'luge' ? 34 : run.id === 'bomb' ? 24 : 14;
    const zoom = 1 - 0.22 * Math.min(1, r.v / fast);
    let tx = r.x;
    if (run.id === 'bomb') tx = r.x * 0.45;
    if (run.id === 'cheese') tx = r.x * 0.6;
    let ty = r.y;
    if (run.id === 'luge') {
      const m = sample(run.course.track!.dx, r.y);
      ty = r.y - (r.u * m) / Math.sqrt(1 + m * m);
      // Look along the track: lead the camera toward where it's going.
      const ahead = sample(run.course.track!.cx, r.y + 18) - sample(run.course.track!.cx, r.y);
      tx = r.x + ahead * 0.35;
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * 5);
    cam.x += (tx - cam.x) * k;
    cam.y = ty;
    cam.s += (base * zoom - cam.s) * (snap ? 1 : 1 - Math.exp(-dt * 1.5));
    cam.ay = 0.3 - 0.05 * Math.min(1, r.v / fast);
    cam.shake = Math.max(0, cam.shake - dt * 2.5);
  }

  /** Where the rider is on screen, in CSS pixels. */
  toScreen(run: Run): [number, number] {
    const r = run.rider;
    let y = r.y;
    if (run.id === 'luge') {
      const m = sample(run.course.track!.dx, r.y);
      y = r.y - (r.u * m) / Math.sqrt(1 + m * m);
    }
    return [this.X(r.x), this.Y(y)];
  }

  // ------------------------------------------------------------ projection

  private X(x: number): number {
    return this.w / 2 + (x - this.cam.x) * this.cam.s;
  }
  private Y(y: number): number {
    return this.h * this.cam.ay + (y - this.cam.y) * this.cam.s;
  }
  /** A point lifted by z metres. */
  private P(x: number, y: number, z: number): [number, number] {
    const gx = this.X(x);
    return [gx + (gx - this.w / 2) * z * LEAN, this.Y(y) - z * this.cam.s * RISE];
  }

  /** Throw confetti in these inks over the finish, or clear it with null. */
  celebrate(colors: string[] | null): void {
    this.confetti = [];
    if (!colors) return;
    const n = Math.round(Math.min(260, 90 + this.w * 0.12));
    for (let i = 0; i < n; i++) {
      // Two bursts from the bottom corners, the way a confetti cannon throws.
      const left = i % 2 === 0;
      this.confetti.push({
        x: left ? -10 : this.w + 10,
        y: this.h * (0.75 + Math.random() * 0.2),
        vx: (left ? 1 : -1) * (this.w * (0.25 + Math.random() * 0.45)),
        vy: -this.h * (0.9 + Math.random() * 0.7),
        a: Math.random() * Math.PI * 2,
        va: (Math.random() - 0.5) * 14,
        c: colors[i % colors.length],
        w: 6 + Math.random() * 7,
      });
    }
  }

  private drawConfetti(dt: number): void {
    if (!this.confetti.length) return;
    const ctx = this.ctx;
    const g = this.h * 1.1;
    for (const p of this.confetti) {
      if (dt > 0) {
        p.vy += g * dt;
        // Paper flutters: drag holds it to a slow fall.
        p.vx *= 1 - Math.min(1, 1.6 * dt);
        p.vy = Math.min(p.vy, this.h * 0.18);
        p.x += p.vx * dt + Math.sin(p.a) * 18 * dt;
        p.y += p.vy * dt;
        p.a += p.va * dt;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.scale(1, Math.abs(Math.cos(p.a * 1.3)) * 0.9 + 0.1);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.w * 0.3, p.w, p.w * 0.6);
      ctx.restore();
    }
    this.confetti = this.confetti.filter((p) => p.y < this.h + 30);
  }

  // ------------------------------------------------------------ frame

  draw(run: Run, now: number): void {
    const ctx = this.ctx;
    const ink = INKS[run.id];
    const dt = this.hold || !this.lastNow ? 0 : Math.min(0.05, (now - this.lastNow) / 1000);
    this.lastNow = now;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.cam.shake > 0) {
      const a = this.cam.shake * 6;
      ctx.translate(Math.sin(now * 0.09) * a, Math.cos(now * 0.07) * a);
    }
    ctx.fillStyle = ink.paper;
    ctx.fillRect(-20, -20, this.w + 40, this.h + 40);

    const top = this.cam.y - (this.h * this.cam.ay) / this.cam.s - 4;
    const bottom = this.cam.y + (this.h * (1 - this.cam.ay)) / this.cam.s + 14;
    if (run.id === 'bomb') this.groundBomb(run, top, bottom, ink);
    else if (run.id === 'cheese') this.groundCheese(run, top, bottom, ink);
    else this.groundLuge(run, top, bottom, ink);

    // Everything standing, back to front by where it meets the ground.
    const items: { y: number; draw: () => void }[] = [];
    const things = run.course.things;
    let lo = 0;
    let hi = things.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (things[m].y + things[m].hd < top - 16) lo = m + 1;
      else hi = m;
    }
    for (let i = lo; i < things.length; i++) {
      const t = things[i];
      if (t.y - t.hd > bottom + 4) break;
      const x = t.move ? moveX(t.move, run.t) : t.x;
      if (Math.abs(this.X(x) - this.w / 2) > this.w / 2 + (t.hw + 14) * this.cam.s) continue;
      items.push({ y: t.y + t.hd, draw: () => this.thing(run, t, x, ink, now) });
    }
    for (const n of run.runners)
      items.push({ y: n.y, draw: () => this.runner(n.x, n.y, n.state, n.stride, n.heading, n.seed, ink) });
    if (run.wheel) {
      const w = run.wheel;
      items.push({ y: w.y + 0.3, draw: () => this.cheeseWheel(w.x, w.y, w.z, w.spin, 0.42, ink, 0) });
    }
    if (run.pursuer.active) items.push({ y: run.pursuer.y + run.spec.hd, draw: () => this.pursuer(run, ink, now) });
    const r = run.rider;
    let ry = r.y;
    if (run.id === 'luge') {
      const m = sample(run.course.track!.dx, r.y);
      ry = r.y - (r.u * m) / Math.sqrt(1 + m * m);
    }
    // In the air, draw over whatever is underneath.
    items.push({ y: ry + 0.2 + (r.z > 0.15 ? 8 : 0), draw: () => this.rider(run, ry, ink, now) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // A printed starburst over everything for the first beat of a crash.
    const crashLen = run.id === 'luge' ? 1.6 : 1.2;
    if (r.state === 'crash' && crashLen - r.timer < 0.35) {
      this.burst(this.X(r.x), this.Y(ry) - this.cam.s * 0.6, (crashLen - r.timer) / 0.35, ink);
    }

    if (run.id === 'luge') this.nightfall(run, top, bottom, now);
    if (run.id === 'cheese') this.clouds(run, top, bottom);

    this.drawConfetti(dt);

    // Print grain over everything.
    if (this.grain) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = run.id === 'luge' ? 0.32 : 0.45;
      ctx.fillStyle = this.grain;
      ctx.fillRect(-20, -20, this.w + 40, this.h + 40);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ hill bomb ground

  private groundBomb(run: Run, top: number, bottom: number, ink: Inks): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const crosses = crossStreets();
    // Asphalt the whole width; the sidewalks and lots go over it.
    ctx.fillStyle = ink.ground;
    ctx.fillRect(this.X(-CURB), 0, CURB * 2 * s, this.h);

    // Aggregate: a scatter of lighter and darker stones fixed to the road.
    const r0 = Math.floor(top);
    for (let y = r0; y < bottom; y++) {
      const r = mulberry(y * 7919 + 13);
      for (let i = 0; i < 9; i++) {
        const x = (r() * 2 - 1) * CURB;
        ctx.fillStyle = r() < 0.5 ? ink.groundLight : ink.groundDark;
        ctx.fillRect(this.X(x), this.Y(y + r()), Math.max(1, s * 0.07), Math.max(1, s * 0.07));
      }
    }
    // Tar seams the wheels clack over, and the odd crack.
    ctx.strokeStyle = ink.groundDark;
    ctx.lineWidth = Math.max(1, s * 0.06);
    for (const y of this.seams) {
      if (y < top || y > bottom) continue;
      const r = mulberry(Math.floor(y * 100));
      ctx.beginPath();
      ctx.moveTo(this.X(-CURB), this.Y(y));
      for (let x = -CURB; x <= CURB; x += 2) ctx.lineTo(this.X(x), this.Y(y + (r() - 0.5) * 0.25));
      ctx.stroke();
    }

    // The block above the start is drawn too, so the street runs on up out of view.
    for (let k = -1; k <= BLOCKS; k++) {
      const yc = k < 0 ? crosses[0] - BLOCK - CROSS : crosses[k];
      const yb = yc + CROSS;
      if (k < BLOCKS) {
        const bt = yb + BLOCK;
        if (bt > top && yb < bottom) {
          // Centre lines: a double yellow down the block.
          ctx.fillStyle = ink.gold;
          for (const dx of [-0.16, 0.06])
            ctx.fillRect(this.X(dx), this.Y(yb + 3), Math.max(1.5, s * 0.1), (BLOCK - 6) * s);
          // Parking lane edge ticks.
          ctx.fillStyle = 'rgba(239, 231, 214, 0.7)';
          for (const side of [-1, 1]) {
            for (let y = yb + 4; y < bt - 4; y += 6.2)
              ctx.fillRect(this.X(side * 5.6) - s * 0.05, this.Y(y), Math.max(1, s * 0.1), s * 0.9);
          }
          // Sidewalks and the lots behind them.
          for (const side of [-1, 1]) {
            const x0 = side < 0 ? -WALK : CURB;
            ctx.fillStyle = '#cbc1aa';
            ctx.fillRect(this.X(x0), this.Y(yb), (WALK - CURB) * s, BLOCK * s);
            ctx.strokeStyle = 'rgba(80, 74, 60, 0.28)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let y = yb + 1.6; y < bt; y += 1.6) {
              if (y < top || y > bottom) continue;
              ctx.moveTo(this.X(x0), this.Y(y));
              ctx.lineTo(this.X(x0 + WALK - CURB), this.Y(y));
            }
            ctx.stroke();
            // The curb's lip.
            ctx.fillStyle = '#e7ddc6';
            ctx.fillRect(this.X(side * CURB) - (side < 0 ? s * 0.25 : 0), this.Y(yb), s * 0.25, BLOCK * s);
            ctx.fillStyle = ink.shadow;
            ctx.fillRect(this.X(side * CURB) - (side < 0 ? 0 : s * 0.12), this.Y(yb), s * 0.12, BLOCK * s);
            // Back gardens and alleys beyond the houses.
            ctx.fillStyle = '#b9ae95';
            const xb = side < 0 ? -WALK - 30 : WALK + 13;
            ctx.fillRect(this.X(xb), this.Y(yb), 17 * s, BLOCK * s);
          }
          // Steep blocks print a shade darker than the flats.
          const steep = sample(run.course.grade, yb + BLOCK / 2);
          ctx.fillStyle = `rgba(20, 22, 40, ${Math.min(0.16, steep * 0.6)})`;
          ctx.fillRect(this.X(-CURB), this.Y(yb + 6), CURB * 2 * s, (BLOCK - 12) * s);
        }
      }
      if (k < 0 || yb < top || yc > bottom) continue;
      // The cross street runs out of sight both ways.
      ctx.fillStyle = ink.ground;
      ctx.fillRect(0, this.Y(yc), this.w, CROSS * s);
      ctx.fillStyle = 'rgba(240, 177, 60, 0.85)';
      ctx.fillRect(0, this.Y(yc + CROSS / 2) - s * 0.05, this.X(-CURB - 1), Math.max(1.5, s * 0.1));
      ctx.fillRect(this.X(CURB + 1), this.Y(yc + CROSS / 2) - s * 0.05, this.w, Math.max(1.5, s * 0.1));
      // Zebra crossings over our street, stop bars on the downhill lanes.
      ctx.fillStyle = '#efe7d6';
      for (const cy of [yc - 2.6, yb + 0.6]) {
        for (let x = -CURB + 0.4; x < CURB - 0.4; x += 1.2) ctx.fillRect(this.X(x), this.Y(cy), s * 0.6, s * 2);
      }
      ctx.fillRect(this.X(-CURB), this.Y(yc - 3.4), CURB * s, s * 0.35);
      ctx.fillRect(this.X(0), this.Y(yb + 3.2), CURB * s, s * 0.35);
      // Corner sidewalks.
      ctx.fillStyle = '#cbc1aa';
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? -WALK : CURB;
        ctx.fillRect(this.X(x0), this.Y(yc - 3), (WALK - CURB) * s, 3 * s);
        ctx.fillRect(this.X(x0), this.Y(yb), (WALK - CURB) * s, 3 * s);
      }
      if (k === BLOCKS) {
        // The bottom of the hill: the flats and the water beyond.
        ctx.fillStyle = '#cbc1aa';
        ctx.fillRect(0, this.Y(yb), this.w, 4 * s);
        ctx.fillStyle = '#e7ddc6';
        ctx.fillRect(0, this.Y(yb + 4), this.w, 0.5 * s);
        ctx.fillStyle = '#5f8fa8';
        ctx.fillRect(0, this.Y(yb + 4.5), this.w, this.h);
        ctx.strokeStyle = 'rgba(239, 231, 214, 0.5)';
        ctx.lineWidth = Math.max(1, s * 0.08);
        for (let y = Math.ceil(yb + 7); y < bottom; y += 3) {
          const r = mulberry(y * 31);
          for (let i = 0; i < 6; i++) {
            const x = (r() * 2 - 1) * 40;
            ctx.beginPath();
            ctx.moveTo(this.X(x), this.Y(y));
            ctx.quadraticCurveTo(this.X(x + 0.6), this.Y(y - 0.3), this.X(x + 1.2), this.Y(y));
            ctx.stroke();
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ cheese ground

  private groundCheese(run: Run, top: number, bottom: number, ink: Inks): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    ctx.fillStyle = ink.ground;
    ctx.fillRect(this.X(-BANK - 30), 0, (BANK + 30) * 2 * s, this.h);
    // Steeper ground prints darker, so the ledges read before you reach them.
    const steep = ctx.createLinearGradient(0, this.Y(top), 0, this.Y(bottom));
    for (let i = 0; i <= 12; i++) {
      const y = top + ((bottom - top) * i) / 12;
      const a = Math.max(0, Math.min(0.26, (sample(run.course.grade, y) - 0.2) * 0.7));
      steep.addColorStop(i / 12, `rgba(40, 62, 30, ${a.toFixed(3)})`);
    }
    ctx.fillStyle = steep;
    ctx.fillRect(this.X(-BANK - 30), 0, (BANK + 30) * 2 * s, this.h);
    // Mottling: patches of lusher and drier grass.
    for (let cy = Math.floor(top / 6) * 6; cy < bottom; cy += 6) {
      const r = mulberry(cy * 131 + 9);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = r() < 0.5 ? 'rgba(163, 193, 114, 0.35)' : 'rgba(84, 120, 58, 0.35)';
        blob(ctx, this.X((r() * 2 - 1) * BANK), this.Y(cy + r() * 6), s * (2 + r() * 3), s * (1 + r() * 1.5), r());
        ctx.fill();
      }
    }
    // A worn line down the middle where the runners go every year.
    ctx.strokeStyle = 'rgba(160, 118, 66, 0.45)';
    ctx.lineCap = 'round';
    for (const off of [-6, 3, 11]) {
      ctx.lineWidth = s * (1.6 + Math.abs(off) * 0.05);
      ctx.beginPath();
      for (let y = Math.floor(top); y < bottom; y += 2) {
        const x = off + Math.sin(y / 23 + off) * 3 + Math.sin(y / 9) * 0.8;
        if (y === Math.floor(top)) ctx.moveTo(this.X(x), this.Y(y));
        else ctx.lineTo(this.X(x), this.Y(y));
      }
      ctx.stroke();
    }
    // Grass strokes, light and dark, fixed to the hill.
    ctx.lineWidth = Math.max(1, s * 0.06);
    for (let y = Math.floor(top); y < bottom; y++) {
      const r = mulberry(y * 4421 + 7);
      for (let i = 0; i < 22; i++) {
        const x = (r() * 2 - 1) * (BANK + 12);
        const yy = y + r();
        ctx.strokeStyle = r() < 0.55 ? ink.groundDark : ink.groundLight;
        const gx = this.X(x);
        const gy = this.Y(yy);
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + (r() - 0.5) * s * 0.3, gy - s * (0.18 + r() * 0.2));
        ctx.stroke();
      }
    }
    // Buttercups and clover heads.
    for (let y = Math.floor(top); y < bottom; y++) {
      const r = mulberry(y * 733 + 1);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = r() < 0.6 ? '#f2d24a' : '#f4ead2';
        ctx.fillRect(this.X((r() * 2 - 1) * BANK), this.Y(y + r()), Math.max(1.5, s * 0.1), Math.max(1.5, s * 0.1));
      }
    }
    // Outside the fences: trodden ground under the crowd.
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#a99467';
      const x0 = side < 0 ? -BANK - 14 : BANK + 1.4;
      ctx.fillRect(this.X(x0), 0, 12.6 * s, this.h);
      ctx.fillStyle = '#5f8a45';
      const x1 = side < 0 ? -BANK - 60 : BANK + 14;
      ctx.fillRect(this.X(x1), 0, 46 * s, this.h);
    }
  }

  /** Cloud shadows drifting slowly across the hill. */
  private clouds(run: Run, top: number, bottom: number): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const drift = run.t * 1.6 + 300;
    for (let cy = Math.floor((top - 40) / 70) * 70; cy < bottom + 40; cy += 70) {
      const r = mulberry(cy * 17 + 5);
      const x = ((r() * 160 + drift) % 160) - 80;
      const y = cy + r() * 40;
      // One shape per cloud, so its lobes merge instead of stacking.
      ctx.fillStyle = 'rgba(30, 50, 40, 0.12)';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const ex = this.X(x + (r() - 0.5) * 18);
        const ey = this.Y(y + (r() - 0.5) * 8);
        const rx = s * (7 + r() * 6);
        ctx.moveTo(ex + rx, ey);
        ctx.ellipse(ex, ey, rx, s * (4 + r() * 3), 0, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  // ------------------------------------------------------------ luge ground

  private groundLuge(run: Run, top: number, bottom: number, ink: Inks): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const tr = run.course.track!;
    ctx.fillStyle = ink.ground;
    ctx.fillRect(0, 0, this.w, this.h);
    // Wind-drift ripples in the snow.
    ctx.strokeStyle = ink.groundDark;
    ctx.lineWidth = Math.max(1, s * 0.05);
    for (let y = Math.floor(top); y < bottom; y += 1) {
      const r = mulberry(y * 911 + 3);
      for (let i = 0; i < 5; i++) {
        const x = this.cam.x + (r() * 2 - 1) * 40;
        ctx.beginPath();
        ctx.moveTo(this.X(x), this.Y(y + r()));
        ctx.lineTo(this.X(x + 1 + r() * 2), this.Y(y + r() * 0.2));
        ctx.stroke();
      }
    }
    // Build the channel's edges as offsets along the normal.
    const pts: { y: number; cx: number; nx: number; ny: number; wall: number }[] = [];
    for (let y = Math.floor(top) - 6; y <= bottom + 6; y += STEP * 0.5) {
      const m = sample(tr.dx, y);
      const nn = Math.sqrt(1 + m * m);
      pts.push({ y, cx: sample(tr.cx, y), nx: 1 / nn, ny: -m / nn, wall: sample(tr.wall, y) });
    }
    const edge = (p: (typeof pts)[number], u: number, z: number): [number, number] =>
      this.P(p.cx + p.nx * u, p.y + p.ny * u, z);
    const strip = (
      u0: number,
      z0: number,
      u1: (p: (typeof pts)[number]) => number,
      z1: (p: (typeof pts)[number]) => number,
      fill: string,
    ) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = edge(p, u0, z0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      for (let i = pts.length - 1; i >= 0; i--) {
        const [x, y] = edge(pts[i], u1(pts[i]), z1(pts[i]));
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    };
    // Shadowed snow banked up outside the walls.
    strip(
      -ICE - 0.2,
      0,
      (p) => -ICE - p.wall - 1.4,
      () => 0,
      ink.groundDark,
    );
    strip(
      ICE + 0.2,
      0,
      (p) => ICE + p.wall + 1.4,
      () => 0,
      ink.groundDark,
    );
    // The ice floor.
    strip(
      -ICE,
      0,
      () => ICE,
      () => 0,
      '#a9d4e6',
    );
    // Skate marks down the ice.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = Math.max(1, s * 0.04);
    for (const u of [-0.7, -0.25, 0.3, 0.75]) {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = edge(p, u + Math.sin(p.y / 13 + u * 5) * 0.12, 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    // Walls: the inside face climbing to the lip, lit on one side.
    strip(
      -ICE,
      0,
      (p) => -ICE - p.wall * 0.55,
      (p) => p.wall * 0.75,
      '#cfe4ee',
    );
    strip(
      ICE,
      0,
      (p) => ICE + p.wall * 0.55,
      (p) => p.wall * 0.75,
      '#e9f3f8',
    );
    // The lips, with the red line painted along them.
    for (const side of [-1, 1]) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, s * 0.22);
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = edge(p, side * (ICE + p.wall * 0.55), p.wall * 0.75);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.strokeStyle = ink.red;
      ctx.lineWidth = Math.max(1, s * 0.06);
      ctx.stroke();
    }
    // Distance boards every hundred metres.
    ctx.fillStyle = ink.key;
    ctx.font = `${Math.round(s * 0.9)}px ${this.bill}`;
    ctx.textAlign = 'center';
    for (let y = Math.ceil(top / 100) * 100; y < bottom; y += 100) {
      if (y <= 0 || y >= run.course.finish) continue;
      const m = sample(tr.dx, y);
      const nn = Math.sqrt(1 + m * m);
      const [x, yy] = this.P(sample(tr.cx, y) - (ICE + 3.2) / nn, y + (ICE + 3.2) * (m / nn), 0);
      ctx.fillText(`${y}`, x, yy);
    }
  }

  /** Night over the luge: the floodlit channel through dark woods. */
  private nightfall(run: Run, top: number, bottom: number, now: number): void {
    const n = this.night;
    const g = n.getContext('2d')!;
    const k = n.width / this.w;
    const s = this.cam.s;
    const tr = run.course.track!;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, this.w, this.h);
    g.fillStyle = 'rgba(9, 16, 38, 0.86)';
    g.fillRect(0, 0, this.w, this.h);
    g.globalCompositeOperation = 'destination-out';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const line = new Path2D();
    for (let y = top - 20; y <= bottom + 20; y += 2) {
      const px = this.X(sample(tr.cx, y));
      const py = this.Y(y);
      if (y === top - 20) line.moveTo(px, py);
      else line.lineTo(px, py);
    }
    // Spill along the whole channel, brightest on the ice.
    for (const [w, a] of [
      [26, 0.1],
      [21, 0.12],
      [16, 0.16],
      [12, 0.2],
      [8, 0.28],
    ]) {
      g.lineWidth = w * s;
      g.strokeStyle = `rgba(0, 0, 0, ${a})`;
      g.stroke(line);
    }
    const lamps: [number, number, number][] = [];
    for (const t of run.course.things) {
      if (t.kind !== 'flood') continue;
      if (t.y < top - 30 || t.y > bottom + 30) continue;
      // Each lamp throws a pool across the track from its pole.
      const cx = sample(tr.cx, t.y + 3);
      const sx = this.X(t.x + (cx - t.x) * 0.65);
      const sy = this.Y(t.y + 3);
      const rad = s * 13;
      const grd = g.createRadialGradient(sx, sy, 0, sx, sy, rad);
      grd.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
      grd.addColorStop(0.5, 'rgba(0, 0, 0, 0.4)');
      grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = grd;
      g.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
      const [hx, hy] = this.P(t.x, t.y, t.h);
      lamps.push([hx, hy, s * 16]);
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(n, 0, 0, this.w, this.h);
    // Warm glow off the lamp heads and in the air under them.
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, rad] of lamps) {
      const flick = 0.92 + 0.08 * Math.sin(now * 0.013 + x);
      const grd = ctx.createRadialGradient(x, y, 0, x, y, rad * 0.5);
      grd.addColorStop(0, `rgba(255, 214, 140, ${0.55 * flick})`);
      grd.addColorStop(0.15, `rgba(255, 190, 110, ${0.18 * flick})`);
      grd.addColorStop(1, 'rgba(255, 170, 80, 0)');
      ctx.fillStyle = grd;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ things

  private thing(run: Run, t: Thing, x: number, ink: Inks, now: number): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const gx = this.X(x);
    const gy = this.Y(t.y);
    switch (t.kind) {
      case 'house':
      case 'shop':
        return this.house(t, x, ink);
      case 'car':
      case 'van':
      case 'bus':
      case 'truck':
        return this.car(run, t, x, ink, now);
      case 'tree':
        return this.tree(x, t.y, t.h, t.seed, ink);
      case 'thorn':
        return this.tree(x, t.y, t.h, t.seed, ink, true);
      case 'lamp': {
        this.groundShadow(x, t.y, 0.25, 0.25);
        const [hx, hy] = this.P(x - Math.sign(x) * 1.2, t.y, t.h);
        const [px, py] = this.P(x, t.y, t.h);
        ctx.strokeStyle = ink.key;
        ctx.lineWidth = Math.max(1.5, s * 0.12);
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(px, py);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.fillStyle = ink.gold;
        ctx.beginPath();
        ctx.ellipse(hx, hy + s * 0.08, s * 0.35, s * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      case 'hydrant':
        this.groundShadow(x, t.y, 0.3, 0.2);
        ctx.fillStyle = ink.red;
        roundRect(ctx, gx - s * 0.18, gy - s * 0.7, s * 0.36, s * 0.7, s * 0.1);
        ctx.fill();
        ctx.fillRect(gx - s * 0.28, gy - s * 0.48, s * 0.56, s * 0.14);
        return;
      case 'bin':
        this.groundShadow(x, t.y, 0.4, 0.3);
        ctx.fillStyle = '#2f7f86';
        ctx.fillRect(gx - s * 0.32, gy - s * 0.9, s * 0.64, s * 0.9);
        ctx.fillStyle = ink.key;
        ctx.fillRect(gx - s * 0.36, gy - s * 0.98, s * 0.72, s * 0.14);
        return;
      case 'pothole': {
        ctx.fillStyle = ink.key;
        blob(ctx, gx, gy, t.hw * s, t.hw * s * 0.8, t.seed);
        ctx.fill();
        ctx.fillStyle = 'rgba(127, 167, 196, 0.35)';
        blob(ctx, gx + s * 0.05, gy + s * 0.04, t.hw * s * 0.5, t.hw * s * 0.35, t.seed + 0.3);
        ctx.fill();
        return;
      }
      case 'manhole':
        ctx.fillStyle = ink.groundDark;
        ctx.beginPath();
        ctx.arc(gx, gy, t.hw * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = ink.groundLight;
        ctx.lineWidth = 1;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(gx + i * t.hw * s * 0.3, gy - t.hw * s * 0.8);
          ctx.lineTo(gx + i * t.hw * s * 0.3, gy + t.hw * s * 0.8);
          ctx.stroke();
        }
        return;
      case 'plate':
        ctx.fillStyle = '#6f7486';
        ctx.fillRect(gx - t.hw * s, gy - t.hd * s, t.hw * 2 * s, t.hd * 2 * s);
        ctx.strokeStyle = ink.groundDark;
        ctx.strokeRect(gx - t.hw * s, gy - t.hd * s, t.hw * 2 * s, t.hd * 2 * s);
        return;
      case 'grate':
        ctx.fillStyle = ink.key;
        ctx.fillRect(gx - t.hw * s, gy - t.hd * s, t.hw * 2 * s, t.hd * 2 * s);
        ctx.fillStyle = ink.groundLight;
        for (let i = 0; i < 5; i++)
          ctx.fillRect(
            gx - t.hw * s,
            gy - t.hd * s + (i + 0.5) * ((t.hd * 2 * s) / 5),
            t.hw * 2 * s,
            Math.max(1, s * 0.06),
          );
        return;
      case 'pit': {
        ctx.fillStyle = '#7a5a3a';
        ctx.fillRect(gx - (t.hw + 0.3) * s, gy - (t.hd + 0.3) * s, (t.hw + 0.3) * 2 * s, (t.hd + 0.3) * 2 * s);
        ctx.fillStyle = '#3d2c1f';
        ctx.fillRect(gx - t.hw * s, gy - t.hd * s, t.hw * 2 * s, t.hd * 2 * s);
        // A plank fence round it, in barrier stripes.
        this.boxAt(x, t.y, t.hw + 0.35, t.hd + 0.35, 0.9, null, '#efe7d6', '#d9cfb8', true, ink);
        return;
      }
      case 'cone': {
        if (t.down !== undefined) {
          const age = Math.min(1, (run.t - t.down) * 2.2);
          ctx.save();
          ctx.translate(gx + age * s * 0.9 * (t.seed < 0.5 ? -1 : 1), gy + age * s * 0.6);
          ctx.rotate((t.seed < 0.5 ? -1 : 1) * age * 1.4);
          this.cone(0, 0, ink);
          ctx.restore();
          return;
        }
        this.groundShadow(x, t.y, 0.3, 0.2);
        this.cone(gx, gy, ink);
        return;
      }
      case 'sign':
        ctx.fillStyle = ink.key;
        ctx.fillRect(gx - s * 0.05, gy - s * 1.2, s * 0.1, s * 1.2);
        ctx.fillStyle = ink.gold;
        ctx.beginPath();
        ctx.moveTo(gx, gy - s * 1.95);
        ctx.lineTo(gx + s * 0.45, gy - s * 1.25);
        ctx.lineTo(gx - s * 0.45, gy - s * 1.25);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = ink.key;
        ctx.font = `${Math.round(s * 0.5)}px ${this.bill}`;
        ctx.textAlign = 'center';
        ctx.fillText('!', gx, gy - s * 1.35);
        return;
      case 'walker':
      case 'crowd':
      case 'catcher':
      case 'fan': {
        const walking = t.kind === 'walker' && t.move ? run.t * Math.abs(t.move.speed) * 3 : 0;
        this.person(gx, gy, t.h, t.seed, ink, {
          stride: walking,
          hiVis: t.kind === 'catcher',
          scarf: t.kind === 'fan',
          arms: t.kind === 'crowd' || t.kind === 'fan' ? Math.sin(now * 0.004 + t.seed * 20) : 0,
          face: t.kind === 'walker' ? Math.sign(t.move?.speed ?? 1) : 0,
        });
        return;
      }
      case 'line':
        return this.finishLine(run, t, x, ink);
      case 'kicker': {
        // A plywood wedge: low edge uphill, the lip up off the road at the bottom.
        const lo = t.y - t.hd;
        const hi = t.y + t.hd;
        const a = this.P(x - t.hw, lo, 0);
        const b = this.P(x + t.hw, lo, 0);
        const c = this.P(x + t.hw, hi, t.h);
        const d = this.P(x - t.hw, hi, t.h);
        const e = this.P(x + t.hw, hi, 0);
        const f = this.P(x - t.hw, hi, 0);
        this.groundShadow(x + 0.3, hi + 0.5, t.hw * 1.1, 0.5);
        // The face under the lip.
        ctx.fillStyle = '#8a6a3e';
        poly(ctx, [f, e, c, d]);
        ctx.fill();
        ctx.fillStyle = '#e2c387';
        poly(ctx, [a, b, c, d]);
        ctx.fill();
        // Grain lines, and a painted stripe on the lip.
        ctx.strokeStyle = 'rgba(138, 106, 62, 0.55)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
          const p0 = lerp2(a, d, i / 4);
          const p1 = lerp2(b, c, i / 4);
          ctx.beginPath();
          ctx.moveTo(p0[0], p0[1]);
          ctx.lineTo(p1[0], p1[1]);
          ctx.stroke();
        }
        ctx.fillStyle = ink.red;
        poly(ctx, [lerp2(a, d, 0.82), lerp2(b, c, 0.82), c, d]);
        ctx.fill();
        return;
      }
      case 'mound': {
        // A grassy hump: a lit crown and a shadow on its downhill side.
        ctx.fillStyle = ink.shadow;
        ctx.beginPath();
        ctx.ellipse(gx + s * 0.25, gy + t.hw * s * 0.35, t.hw * s * 1.05, t.hw * s * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ink.groundDark;
        ctx.beginPath();
        ctx.ellipse(gx, gy, t.hw * s, t.hw * s * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = ink.green;
        ctx.lineWidth = Math.max(1.5, s * 0.1);
        ctx.stroke();
        ctx.fillStyle = ink.groundLight;
        ctx.beginPath();
        ctx.ellipse(gx - t.hw * s * 0.15, gy - t.hw * s * 0.18, t.hw * s * 0.62, t.hw * s * 0.38, 0, 0, Math.PI * 2);
        ctx.fill();
        // Long grass along the crown, combed downhill.
        ctx.strokeStyle = ink.green;
        ctx.lineWidth = Math.max(1, s * 0.06);
        for (let i = -3; i <= 3; i++) {
          const fx = gx + i * t.hw * s * 0.22;
          const fy = gy + t.hw * s * (0.25 - Math.abs(i) * 0.04);
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx + s * 0.08, fy + s * 0.32);
          ctx.stroke();
        }
        return;
      }
      case 'bump': {
        // A ridge across the ice: a bright edge over its shadow.
        const half = t.hw * Math.sqrt(1 + sample(run.course.track!.dx, t.y) ** 2) * 0.9;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(46, 95, 166, 0.35)';
        ctx.lineWidth = Math.max(2, s * 0.22);
        ctx.beginPath();
        ctx.moveTo(this.X(x - half), gy + s * 0.12);
        ctx.lineTo(this.X(x + half), gy + s * 0.12);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1.5, s * 0.12);
        ctx.beginPath();
        ctx.moveTo(this.X(x - half), gy - s * 0.04);
        ctx.lineTo(this.X(x + half), gy - s * 0.04);
        ctx.stroke();
        return;
      }
      // Cheese hill.
      case 'tussock': {
        ctx.strokeStyle = ink.green;
        ctx.lineWidth = Math.max(1, s * 0.07);
        const rr = mulberry(Math.floor(t.seed * 1e6));
        ctx.fillStyle = ink.shadow;
        ctx.beginPath();
        ctx.ellipse(gx + s * 0.15, gy + s * 0.05, t.hw * s, t.hw * s * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 9; i++) {
          const a = (i / 8 - 0.5) * 1.6;
          const len = t.h * (0.7 + rr() * 0.5);
          ctx.strokeStyle = i % 3 === 0 ? '#c4c27a' : ink.green;
          ctx.beginPath();
          ctx.moveTo(gx + (i / 8 - 0.5) * t.hw * s, gy);
          ctx.quadraticCurveTo(gx + a * s * 0.2, gy - len * s * 0.6, gx + a * s * 0.55, gy - len * s * RISE);
          ctx.stroke();
        }
        return;
      }
      case 'gorse':
        return this.gorse(gx, gy, t, ink);
      case 'rock':
        this.groundShadow(x, t.y, t.hw * 1.1, t.hw * 0.5);
        ctx.fillStyle = '#a8a196';
        blob(ctx, gx, gy - t.h * s * 0.4, t.hw * s, t.h * s * 0.6, t.seed);
        ctx.fill();
        ctx.fillStyle = '#c9c3b6';
        blob(ctx, gx - t.hw * s * 0.25, gy - t.h * s * 0.65, t.hw * s * 0.45, t.h * s * 0.25, t.seed + 0.1);
        ctx.fill();
        return;
      case 'hole':
        ctx.fillStyle = '#4a3a22';
        ctx.beginPath();
        ctx.ellipse(gx, gy, t.hw * s, t.hw * s * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a07a46';
        ctx.beginPath();
        ctx.ellipse(gx + t.hw * s * 0.9, gy + t.hw * s * 0.4, t.hw * s * 0.7, t.hw * s * 0.35, 0.3, 0, Math.PI * 2);
        ctx.fill();
        return;
      case 'thistle': {
        ctx.fillStyle = 'rgba(62, 94, 51, 0.6)';
        blob(ctx, gx, gy, t.hw * s, t.hw * s * 0.6, t.seed);
        ctx.fill();
        const rr = mulberry(Math.floor(t.seed * 1e6));
        for (let i = 0; i < 9; i++) {
          const fx = gx + (rr() * 2 - 1) * t.hw * s * 0.8;
          const fy = gy + (rr() * 2 - 1) * t.hw * s * 0.4;
          ctx.strokeStyle = ink.green;
          ctx.lineWidth = Math.max(1, s * 0.05);
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx, fy - s * 0.5);
          ctx.stroke();
          ctx.fillStyle = '#9b5aa6';
          ctx.beginPath();
          ctx.arc(fx, fy - s * 0.55, s * 0.11, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      case 'post': {
        const [tx, ty] = this.P(x, t.y, t.h);
        ctx.strokeStyle = '#7a5a3a';
        ctx.lineWidth = Math.max(1.5, s * 0.12);
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        // Two strands of wire on up the hill to the next post.
        ctx.strokeStyle = 'rgba(60, 50, 40, 0.7)';
        ctx.lineWidth = 1;
        for (const z of [0.55, 1.0]) {
          const [ax, ay] = this.P(x, t.y, z);
          const [bx, by] = this.P(x, t.y - 3, z);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
        return;
      }
      case 'bale':
        return this.boxAt(x, t.y, t.hw, t.hd, t.h, '#e3c97a', '#d1b263', '#c09f50', false, ink);
      case 'ledge': {
        // A step in the hill: a bright lip of turf, a raw face of earth and chalk
        // under it, and the shadow it throws down the slope.
        const yy = this.Y(t.y);
        const r = mulberry(Math.floor(t.seed * 1e6));
        const lip: [number, number][] = [];
        const foot: [number, number][] = [];
        for (let xx = -BANK; xx <= BANK; xx += 1) {
          lip.push([this.X(xx), yy - s * 0.35 + Math.sin(xx * 0.9 + t.seed * 9) * s * 0.25]);
          foot.push([this.X(xx), yy + s * (0.7 + r() * 0.5 + Math.sin(xx * 0.37) * 0.3)]);
        }
        const shadow = ctx.createLinearGradient(0, yy + s * 0.8, 0, yy + s * 3.6);
        shadow.addColorStop(0, 'rgba(38, 52, 28, 0.42)');
        shadow.addColorStop(1, 'rgba(38, 52, 28, 0)');
        ctx.fillStyle = shadow;
        ctx.fillRect(this.X(-BANK), yy + s * 0.6, BANK * 2 * s, s * 3);
        ctx.fillStyle = '#8a6a3e';
        ctx.beginPath();
        lip.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        for (let i = foot.length - 1; i >= 0; i--) ctx.lineTo(foot[i][0], foot[i][1]);
        ctx.closePath();
        ctx.fill();
        // Chalk showing through the earth.
        ctx.fillStyle = '#e8dfc8';
        for (let i = 0; i < 40; i++) {
          const k = Math.floor(r() * (lip.length - 1));
          const fx = lip[k][0] + r() * s;
          const fy = lip[k][1] + (foot[k][1] - lip[k][1]) * (0.3 + r() * 0.6);
          ctx.fillRect(fx, fy, Math.max(1.5, s * 0.16), Math.max(1, s * 0.1));
        }
        ctx.strokeStyle = ink.groundLight;
        ctx.lineWidth = Math.max(2, s * 0.18);
        ctx.beginPath();
        lip.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
        return;
      }
      // Luge.
      case 'flood': {
        const [px, py] = this.P(x, t.y, t.h);
        ctx.strokeStyle = '#3a4560';
        ctx.lineWidth = Math.max(2, s * 0.16);
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.fillStyle = '#3a4560';
        ctx.fillRect(px - s * 0.8, py - s * 0.15, s * 1.6, s * 0.3);
        ctx.fillStyle = '#fff4d8';
        for (const dx of [-0.5, 0, 0.5]) {
          ctx.beginPath();
          ctx.arc(px + dx * s, py + s * 0.2, s * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      case 'spruce':
        return this.spruce(x, t.y, t.hw, t.h, ink);
      case 'starthouse': {
        // The start gantry: two posts either side of the channel and a lit board across.
        ctx.strokeStyle = '#3a4560';
        ctx.lineWidth = Math.max(2, s * 0.18);
        const ends = [-t.hw, t.hw].map((dx) => [this.P(x + dx, t.y, 0), this.P(x + dx, t.y, t.h)] as const);
        for (const [g0, g1] of ends) {
          ctx.beginPath();
          ctx.moveTo(g0[0], g0[1]);
          ctx.lineTo(g1[0], g1[1]);
          ctx.stroke();
        }
        const [la, lb] = [ends[0][1], ends[1][1]];
        ctx.fillStyle = ink.red;
        ctx.fillRect(la[0] - s * 0.2, la[1] - s * 1.1, lb[0] - la[0] + s * 0.4, s * 1.1);
        ctx.fillStyle = '#f2f6f9';
        ctx.font = `${Math.round(s * 0.85)}px ${this.bill}`;
        ctx.textAlign = 'center';
        ctx.fillText('START', (la[0] + lb[0]) / 2, la[1] - s * 0.25);
        return;
      }
      case 'clock': {
        this.boxAt(x, t.y, t.hw, t.hd, 0.1, null, ink.key, ink.key, false, ink);
        const [bx, by] = this.P(x, t.y + t.hd, t.h);
        const [lx, ly] = this.P(x, t.y + t.hd, 1.4);
        ctx.strokeStyle = ink.key;
        ctx.lineWidth = Math.max(2, s * 0.14);
        ctx.beginPath();
        ctx.moveTo(gx - t.hw * s * 0.8, gy);
        ctx.lineTo(lx - t.hw * s * 0.8, ly);
        ctx.moveTo(gx + t.hw * s * 0.8, gy);
        ctx.lineTo(lx + t.hw * s * 0.8, ly);
        ctx.stroke();
        ctx.fillStyle = '#0c1226';
        ctx.fillRect(bx - t.hw * s, by, t.hw * 2 * s, (ly - by) * 0.95);
        ctx.fillStyle = '#ffb347';
        ctx.font = `${Math.round(s * 1.25)}px ${this.bill}`;
        ctx.textAlign = 'center';
        ctx.fillText(clock(run.rider.state === 'finish' ? run.t : run.t), bx, by + (ly - by) * 0.68);
        return;
      }
    }
  }

  private groundShadow(x: number, y: number, rx: number, ry: number): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    ctx.fillStyle = INKS.bomb.shadow;
    ctx.beginPath();
    ctx.ellipse(this.X(x) + rx * s * 0.5, this.Y(y) + ry * s * 0.3, rx * s, ry * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /** A box on the ground: its street-facing side, its downhill front, its top. */
  private boxAt(
    x: number,
    y: number,
    hw: number,
    hd: number,
    h: number,
    top: string | null,
    front: string,
    side: string,
    stripes: boolean,
    ink: Inks,
  ): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const x0 = x - hw;
    const x1 = x + hw;
    const y0 = y - hd;
    const y1 = y + hd;
    // Shadow, thrown down and to the right.
    ctx.fillStyle = ink.shadow;
    ctx.beginPath();
    ctx.moveTo(this.X(x1), this.Y(y0));
    ctx.lineTo(this.X(x1) + h * s * 0.45, this.Y(y0) + h * s * 0.3);
    ctx.lineTo(this.X(x1) + h * s * 0.45, this.Y(y1) + h * s * 0.3);
    ctx.lineTo(this.X(x0) + h * s * 0.45, this.Y(y1) + h * s * 0.3);
    ctx.lineTo(this.X(x0), this.Y(y1));
    ctx.lineTo(this.X(x1), this.Y(y1));
    ctx.closePath();
    ctx.fill();
    const a = this.P(x0, y0, h);
    const b = this.P(x1, y0, h);
    const c = this.P(x1, y1, h);
    const d = this.P(x0, y1, h);
    const cx = this.X(x);
    // The side facing the middle of the screen shows.
    const sx = cx > this.w / 2 ? x0 : x1;
    const sTop0 = this.P(sx, y0, h);
    const sTop1 = this.P(sx, y1, h);
    ctx.fillStyle = side;
    poly(ctx, [[this.X(sx), this.Y(y0)], [this.X(sx), this.Y(y1)], sTop1, sTop0]);
    ctx.fill();
    ctx.fillStyle = front;
    poly(ctx, [[this.X(x0), this.Y(y1)], [this.X(x1), this.Y(y1)], c, d]);
    ctx.fill();
    if (stripes) {
      ctx.save();
      poly(ctx, [[this.X(x0), this.Y(y1)], [this.X(x1), this.Y(y1)], c, d]);
      ctx.clip();
      ctx.strokeStyle = ink.red;
      ctx.lineWidth = s * 0.25;
      for (let i = -10; i < 30; i++) {
        const bx = this.X(x0) + i * s * 0.6;
        ctx.beginPath();
        ctx.moveTo(bx, this.Y(y1));
        ctx.lineTo(bx + s * 1.2, d[1]);
        ctx.stroke();
      }
      ctx.restore();
      ctx.save();
      poly(ctx, [[this.X(sx), this.Y(y0)], [this.X(sx), this.Y(y1)], sTop1, sTop0]);
      ctx.clip();
      ctx.strokeStyle = ink.red;
      ctx.lineWidth = s * 0.25;
      for (let i = -30; i < 30; i++) {
        const by = this.Y(y0) + i * s * 0.6;
        ctx.beginPath();
        ctx.moveTo(this.X(sx), by);
        ctx.lineTo(sTop0[0], by - s * 1.2);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (top) {
      ctx.fillStyle = top;
      poly(ctx, [a, b, c, d]);
      ctx.fill();
    }
  }

  private house(t: Thing, x: number, ink: Inks): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const col = HOUSE[Math.floor(t.seed * HOUSE.length)];
    const darker = shade(col, -0.32);
    const shop = t.kind === 'shop';
    this.boxAt(x, t.y, t.hw, t.hd, t.h, null, darker, col, false, ink);
    // Windows on the street front, floor by floor, and a door at the bottom.
    const street = x < 0 ? x + t.hw : x - t.hw;
    const floors = Math.max(1, Math.floor(t.h / 3.2));
    const bays = Math.max(1, Math.floor((t.hd * 2) / 2.4));
    const y0 = t.y - t.hd;
    const span = t.hd * 2;
    for (let f = 0; f < floors; f++) {
      const z0 = 0.9 + f * 3.1;
      for (let b = 0; b < bays; b++) {
        const ya = y0 + ((b + 0.25) / bays) * span;
        const yb = y0 + ((b + 0.75) / bays) * span;
        if (shop && f === 0) continue;
        const p = [
          this.P(street, ya, z0),
          this.P(street, yb, z0),
          this.P(street, yb, z0 + 1.7),
          this.P(street, ya, z0 + 1.7),
        ];
        // Painted trim round each window, the glass set in it.
        ctx.fillStyle = '#efe7d6';
        poly(ctx, p);
        ctx.fill();
        const inset = (q: [number, number], k: number): [number, number] => {
          const cx = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4;
          const cy = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4;
          return [cx + (q[0] - cx) * k, cy + (q[1] - cy) * k];
        };
        ctx.fillStyle = f === 0 && b === bays - 1 ? ink.key : '#2c3550';
        poly(
          ctx,
          p.map((q) => inset(q, 0.74)),
        );
        ctx.fill();
        // A sash bar and a lit pane or two.
        if (mulberry(Math.floor(t.seed * 1e5) + f * 7 + b)() < 0.18) {
          ctx.fillStyle = 'rgba(240, 177, 60, 0.85)';
          poly(ctx, [p[0], p[1], [p[1][0], (p[1][1] + p[2][1]) / 2], [p[0][0], (p[0][1] + p[3][1]) / 2]]);
          ctx.fill();
        }
      }
    }
    if (shop) {
      // A striped awning over the shop window.
      const a = this.P(street, y0 + 0.4, 2.8);
      const b = this.P(street, y0 + span - 0.4, 2.8);
      const c = this.P(street + (x < 0 ? 1.2 : -1.2), y0 + span - 0.4, 2.3);
      const d = this.P(street + (x < 0 ? 1.2 : -1.2), y0 + 0.4, 2.3);
      ctx.fillStyle = '#efe7d6';
      poly(ctx, [a, b, c, d]);
      ctx.fill();
      ctx.fillStyle = t.seed < 0.5 ? ink.red : '#2f7f86';
      for (let i = 0; i < 8; i += 2) {
        const f0 = i / 8;
        const f1 = (i + 1) / 8;
        poly(ctx, [lerp2(a, b, f0), lerp2(a, b, f1), lerp2(d, c, f1), lerp2(d, c, f0)]);
        ctx.fill();
      }
      const w0 = this.P(street, y0 + 0.8, 0.4);
      const w1 = this.P(street, y0 + span - 0.8, 0.4);
      const w2 = this.P(street, y0 + span - 0.8, 2.1);
      const w3 = this.P(street, y0 + 0.8, 2.1);
      ctx.fillStyle = 'rgba(240, 177, 60, 0.75)';
      poly(ctx, [w0, w1, w2, w3]);
      ctx.fill();
    }
    // A flat tar-and-gravel roof behind a parapet in the house colour, with the
    // clutter roofs collect: a stair hatch, vents, a skylight, a deck.
    const a = this.P(x - t.hw, t.y - t.hd, t.h);
    const b = this.P(x + t.hw, t.y - t.hd, t.h);
    const c = this.P(x + t.hw, t.y + t.hd, t.h);
    const d = this.P(x - t.hw, t.y + t.hd, t.h);
    const r = mulberry(Math.floor(t.seed * 1e6));
    const tar = ['#9d978d', '#8f8a82', '#a8a196'][Math.floor(r() * 3)];
    ctx.fillStyle = tar;
    poly(ctx, [a, b, c, d]);
    ctx.fill();
    ctx.strokeStyle = shade(col, 0.15);
    ctx.lineWidth = Math.max(1.5, s * 0.35);
    poly(ctx, [a, b, c, d]);
    ctx.stroke();
    const roofBox = (cx: number, cy: number, hw: number, hd: number, h: number, fill: string, side: string) => {
      const p0 = this.P(cx - hw, cy - hd, t.h + h);
      const p1 = this.P(cx + hw, cy - hd, t.h + h);
      const p2 = this.P(cx + hw, cy + hd, t.h + h);
      const p3 = this.P(cx - hw, cy + hd, t.h + h);
      const q2 = this.P(cx + hw, cy + hd, t.h);
      const q3 = this.P(cx - hw, cy + hd, t.h);
      ctx.fillStyle = side;
      poly(ctx, [q3, q2, p2, p3]);
      ctx.fill();
      ctx.fillStyle = fill;
      poly(ctx, [p0, p1, p2, p3]);
      ctx.fill();
    };
    const inner = (k: number) => x + (x < 0 ? -1 : 1) * k;
    if (r() < 0.55) roofBox(inner(t.hw * 0.45), t.y - t.hd * 0.3, 1.1, 1.2, 2.2, shade(col, -0.05), darker);
    if (r() < 0.5) {
      const sx = inner((r() - 0.5) * t.hw);
      const sy = t.y + (r() - 0.2) * t.hd * 0.6;
      ctx.fillStyle = '#b9d0dc';
      poly(ctx, [
        this.P(sx - 0.8, sy - 0.5, t.h),
        this.P(sx + 0.8, sy - 0.5, t.h),
        this.P(sx + 0.8, sy + 0.5, t.h),
        this.P(sx - 0.8, sy + 0.5, t.h),
      ]);
      ctx.fill();
    }
    if (r() < 0.22) {
      // A plank deck at the back.
      const dx0 = inner(t.hw * 0.15);
      const dx1 = inner(t.hw * 0.85);
      const xa = Math.min(dx0, dx1);
      const xb = Math.max(dx0, dx1);
      ctx.fillStyle = '#b98c5a';
      poly(ctx, [
        this.P(xa, t.y - t.hd + 0.6, t.h),
        this.P(xb, t.y - t.hd + 0.6, t.h),
        this.P(xb, t.y + t.hd - 0.6, t.h),
        this.P(xa, t.y + t.hd - 0.6, t.h),
      ]);
      ctx.fill();
      ctx.strokeStyle = '#9a7146';
      ctx.lineWidth = 1;
      for (let yy = t.y - t.hd + 1; yy < t.y + t.hd - 0.6; yy += 0.5) {
        const pa = this.P(xa, yy, t.h);
        const pb = this.P(xb, yy, t.h);
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.stroke();
      }
    }
    for (let i = 0; i < 2; i++) {
      if (r() < 0.6)
        roofBox(x + (r() - 0.5) * t.hw * 1.2, t.y + (r() - 0.5) * t.hd, 0.3, 0.3, 0.7, '#6f6a63', '#5a5650');
    }
  }

  private car(run: Run, t: Thing, x: number, ink: Inks, now: number): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const col = t.kind === 'bus' ? '#f0b13c' : t.kind === 'truck' ? '#e9e0cc' : CARS[Math.floor(t.seed * CARS.length)];
    const along = t.hd > t.hw;
    const body = t.kind === 'car' ? 0.85 : t.h * 0.9;
    this.boxAt(x, t.y, t.hw, t.hd, body, shade(col, 0.05), shade(col, -0.2), shade(col, -0.1), false, ink);
    if (t.kind === 'car') {
      // The cabin, set back from the bonnet, with glass all round.
      const cw = along ? t.hw * 0.86 : t.hw * 0.5;
      const cd = along ? t.hd * 0.5 : t.hd * 0.86;
      const front = t.move ? Math.sign(t.move.speed) : x < 0 ? 1 : -1;
      const ox = along ? 0 : -front * t.hw * 0.08;
      const oy = along ? -front * t.hd * 0.06 : 0;
      const x0 = x + ox - cw;
      const x1 = x + ox + cw;
      const y0 = t.y + oy - cd;
      const y1 = t.y + oy + cd;
      const glass = '#2c3550';
      const z0 = body;
      const z1 = t.h;
      const sx = this.X(x) > this.w / 2 ? x0 : x1;
      ctx.fillStyle = glass;
      poly(ctx, [this.P(sx, y0, z0), this.P(sx, y1, z0), this.P(sx, y1 - 0.15, z1), this.P(sx, y0 + 0.15, z1)]);
      ctx.fill();
      poly(ctx, [
        this.P(x0, y1, z0),
        this.P(x1, y1, z0),
        this.P(x1 - 0.12, y1 - 0.2, z1),
        this.P(x0 + 0.12, y1 - 0.2, z1),
      ]);
      ctx.fill();
      ctx.fillStyle = shade(col, 0.1);
      poly(ctx, [
        this.P(x0 + 0.12, y0 + 0.15, z1),
        this.P(x1 - 0.12, y0 + 0.15, z1),
        this.P(x1 - 0.12, y1 - 0.2, z1),
        this.P(x0 + 0.12, y1 - 0.2, z1),
      ]);
      ctx.fill();
      // Lights on the front.
      if (t.move) {
        const fx = x + front * t.hw;
        ctx.fillStyle = '#fff4d8';
        for (const dy of [-0.6, 0.6]) {
          const [lx, ly] = this.P(fx, t.y + dy, 0.55);
          ctx.beginPath();
          ctx.arc(lx, ly, s * 0.13, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      // Windows down the side of the bus or the van's cab.
      const sx = this.X(x) > this.w / 2 ? x - t.hw : x + t.hw;
      ctx.fillStyle = '#2c3550';
      if (t.kind === 'bus') {
        for (let i = 0; i < 6; i++) {
          const xa = x - t.hw + 0.6 + i * ((t.hw * 2 - 1.2) / 6);
          const xb = xa + (t.hw * 2 - 1.2) / 6 - 0.25;
          poly(ctx, [
            this.P(xa, t.y + t.hd, 1.4),
            this.P(xb, t.y + t.hd, 1.4),
            this.P(xb, t.y + t.hd, 2.3),
            this.P(xa, t.y + t.hd, 2.3),
          ]);
          ctx.fill();
        }
      } else {
        const fy = x < 0 ? t.y + t.hd : t.y - t.hd;
        const cab = x < 0 ? -1 : 1;
        poly(ctx, [
          this.P(sx, fy - cab * 0.4, body * 0.55),
          this.P(sx, fy - cab * 1.4, body * 0.55),
          this.P(sx, fy - cab * 1.4, body * 0.85),
          this.P(sx, fy - cab * 0.4, body * 0.85),
        ]);
        ctx.fill();
        if (t.kind === 'truck') {
          // Hazards blinking.
          const on = Math.floor(now / 420) % 2 === 0;
          if (on) {
            ctx.fillStyle = ink.gold;
            for (const dx of [-t.hw + 0.2, t.hw - 0.2]) {
              const [lx, ly] = this.P(x + dx, t.y + t.hd, 0.7);
              ctx.beginPath();
              ctx.arc(lx, ly, s * 0.18, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          const [lx, ly] = this.P(x, t.y + t.hd, body * 0.6);
          ctx.fillStyle = ink.red;
          ctx.font = `${Math.round(s * 0.7)}px ${this.bill}`;
          ctx.textAlign = 'center';
          ctx.fillText('FRESH BREAD', lx, ly);
        }
      }
    }
    // A door flung open into the lane.
    if (t.door && t.door.at >= 0) {
      const open = Math.min(1, Math.max(0, (run.t - t.door.at) / 0.35));
      const hy = t.y + (t.door.side < 0 ? -t.hd + 1.1 : t.hd - 1.1);
      const hx = x + t.door.side * t.hw;
      const len = 1.1;
      const ang = open * 1.2;
      const ex = hx + t.door.side * Math.sin(ang) * len;
      const ey = hy + (t.door.side < 0 ? 1 : -1) * Math.cos(ang) * len;
      ctx.fillStyle = shade(col, -0.15);
      poly(ctx, [this.P(hx, hy, 0.25), this.P(ex, ey, 0.25), this.P(ex, ey, 1.2), this.P(hx, hy, 1.2)]);
      ctx.fill();
      ctx.fillStyle = '#2c3550';
      poly(ctx, [this.P(hx, hy, 0.85), this.P(ex, ey, 0.85), this.P(ex, ey, 1.2), this.P(hx, hy, 1.2)]);
      ctx.fill();
    }
  }

  private tree(x: number, y: number, h: number, seed: number, ink: Inks, wild = false): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    // Tree pit.
    if (!wild) {
      ctx.fillStyle = '#6d5a42';
      ctx.fillRect(this.X(x) - s * 0.6, this.Y(y) - s * 0.6, s * 1.2, s * 1.2);
    }
    const [tx, ty] = this.P(x, y, h * 0.6);
    ctx.strokeStyle = '#5a4632';
    ctx.lineWidth = Math.max(2, s * 0.22);
    ctx.beginPath();
    ctx.moveTo(this.X(x), this.Y(y));
    ctx.lineTo(tx, ty);
    ctx.stroke();
    // Canopy shadow thrown across the sidewalk.
    ctx.fillStyle = ink.shadow;
    ctx.beginPath();
    ctx.ellipse(this.X(x) + h * s * 0.35, this.Y(y) + s * 0.6, s * 2, s * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    const r = mulberry(Math.floor(seed * 1e6));
    const [cx, cy] = this.P(x, y, h);
    const rad = s * (1.6 + seed * 0.6);
    ctx.fillStyle = ink.green;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rad * 0.55, cy + Math.sin(a) * rad * 0.45, rad * (0.55 + r() * 0.2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = wild ? '#7d9a4a' : '#5f8f5a';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(
        cx - rad * 0.3 + (r() - 0.5) * rad * 0.6,
        cy - rad * 0.3 + (r() - 0.5) * rad * 0.4,
        rad * (0.3 + r() * 0.15),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  private spruce(x: number, y: number, r0: number, h: number, ink: Inks): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const gx = this.X(x);
    const gy = this.Y(y);
    ctx.fillStyle = 'rgba(120, 140, 170, 0.45)';
    ctx.beginPath();
    ctx.ellipse(gx + h * s * 0.2, gy + s * 0.3, r0 * s * 1.6, r0 * s * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const z0 = h * (0.12 + (i / tiers) * 0.7);
      const z1 = z0 + h * 0.36;
      const w = r0 * s * 1.5 * (1 - i / (tiers + 0.6));
      const [bx, by] = this.P(x, y, z0);
      const [tx, ty] = this.P(x, y, z1);
      ctx.fillStyle = i % 2 ? ink.green : '#284a47';
      ctx.beginPath();
      ctx.moveTo(bx - w, by);
      ctx.lineTo(tx, ty);
      ctx.lineTo(bx + w, by);
      ctx.quadraticCurveTo(bx, by + w * 0.25, bx - w, by);
      ctx.fill();
      // Snow on the boughs.
      ctx.fillStyle = '#f2f6f9';
      ctx.beginPath();
      ctx.moveTo(bx - w * 0.8, by - (by - ty) * 0.08);
      ctx.lineTo(tx - w * 0.15, ty + (by - ty) * 0.45);
      ctx.lineTo(bx - w * 0.3, by - (by - ty) * 0.15);
      ctx.fill();
    }
  }

  private gorse(gx: number, gy: number, t: Thing, ink: Inks): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const r = mulberry(Math.floor(t.seed * 1e6));
    ctx.fillStyle = ink.shadow;
    ctx.beginPath();
    ctx.ellipse(gx + t.hw * s * 0.4, gy + s * 0.1, t.hw * s * 1.1, t.hw * s * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i < 4 ? ink.green : '#557a3f';
      ctx.beginPath();
      ctx.arc(
        gx + (r() - 0.5) * t.hw * s * 1.4,
        gy - t.h * s * (0.3 + r() * 0.5),
        t.hw * s * (0.4 + r() * 0.25),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = ink.gold;
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      ctx.arc(
        gx + (r() - 0.5) * t.hw * s * 1.6,
        gy - t.h * s * (0.15 + r() * 0.85),
        Math.max(1, s * 0.07),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  private cone(x: number, y: number, ink: Inks): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    ctx.fillStyle = '#ec6b2d';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.24, y);
    ctx.lineTo(x - s * 0.06, y - s * 0.62);
    ctx.lineTo(x + s * 0.06, y - s * 0.62);
    ctx.lineTo(x + s * 0.24, y);
    ctx.fill();
    ctx.fillStyle = '#efe7d6';
    ctx.fillRect(x - s * 0.15, y - s * 0.38, s * 0.3, s * 0.1);
    ctx.fillStyle = ink.key;
    ctx.fillRect(x - s * 0.3, y - s * 0.05, s * 0.6, s * 0.08);
  }

  /** A person standing or walking, seen from up the hill. */
  private person(
    gx: number,
    gy: number,
    h: number,
    seed: number,
    ink: Inks,
    o: { stride?: number; hiVis?: boolean; scarf?: boolean; arms?: number; face?: number },
  ): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const k = (h / 1.75) * s;
    const coat = o.hiVis ? '#e6ef3a' : ink.coats[Math.floor(seed * ink.coats.length)];
    const legs = ink.coats[Math.floor(seed * 97) % ink.coats.length] === coat ? ink.key : '#3a3f55';
    const st = o.stride ? Math.sin(o.stride) * 0.25 : 0;
    ctx.fillStyle = INKS.bomb.shadow;
    ctx.beginPath();
    ctx.ellipse(gx + k * 0.3, gy + k * 0.04, k * 0.4, k * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = legs;
    ctx.lineCap = 'round';
    ctx.lineWidth = k * 0.16;
    ctx.beginPath();
    ctx.moveTo(gx - k * 0.1 + st * k, gy - k * 0.05);
    ctx.lineTo(gx - k * 0.08, gy - k * 0.75);
    ctx.moveTo(gx + k * 0.1 - st * k, gy - k * 0.05);
    ctx.lineTo(gx + k * 0.08, gy - k * 0.75);
    ctx.stroke();
    ctx.fillStyle = coat;
    roundRect(ctx, gx - k * 0.22, gy - k * 1.42, k * 0.44, k * 0.78, k * 0.12);
    ctx.fill();
    if (o.hiVis) {
      ctx.fillStyle = '#c9cfd2';
      ctx.fillRect(gx - k * 0.22, gy - k * 1.0, k * 0.44, k * 0.07);
    }
    const arm = o.arms ?? 0;
    ctx.strokeStyle = coat;
    ctx.lineWidth = k * 0.13;
    ctx.beginPath();
    ctx.moveTo(gx - k * 0.2, gy - k * 1.32);
    ctx.lineTo(gx - k * (0.32 + Math.max(0, arm) * 0.1), gy - k * (0.85 + Math.max(0, arm) * 0.95));
    ctx.moveTo(gx + k * 0.2, gy - k * 1.32);
    ctx.lineTo(gx + k * (0.32 + Math.max(0, -arm) * 0.1), gy - k * (0.85 + Math.max(0, -arm) * 0.95));
    ctx.stroke();
    if (o.scarf) {
      ctx.fillStyle = INKS.luge.red;
      ctx.fillRect(gx - k * 0.2, gy - k * 1.45, k * 0.4, k * 0.1);
    }
    ctx.fillStyle = ink.skin;
    ctx.beginPath();
    ctx.arc(gx + (o.face ?? 0) * k * 0.03, gy - k * 1.58, k * 0.17, 0, Math.PI * 2);
    ctx.fill();
    // Hair or a hat.
    ctx.fillStyle = seed > 0.5 ? '#3a2a20' : ink.key;
    ctx.beginPath();
    ctx.arc(gx, gy - k * 1.62, k * 0.17, Math.PI, 0);
    ctx.fill();
  }

  private finishLine(run: Run, t: Thing, x: number, ink: Inks): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const y = this.Y(t.y);
    if (run.id === 'bomb') {
      // Sprayed on the road by whoever got here first.
      ctx.fillStyle = 'rgba(239, 231, 214, 0.9)';
      for (let i = 0; i < 16; i++) {
        const x0 = -CURB + i;
        ctx.fillStyle = i % 2 ? 'rgba(239, 231, 214, 0.92)' : ink.key;
        ctx.fillRect(this.X(x0), y - s * 0.4, s, s * 0.8);
      }
      ctx.fillStyle = ink.red;
      ctx.font = `${Math.round(s * 2.2)}px ${this.bill}`;
      ctx.textAlign = 'center';
      ctx.fillText('BOTTOM', this.X(0), y + s * 3.2);
      return;
    }
    if (run.id === 'cheese') {
      if (t.seed === 1) {
        // The start: a scuffed chalk line at the brow.
        ctx.fillStyle = 'rgba(244, 234, 210, 0.75)';
        ctx.fillRect(this.X(-BANK), y - s * 0.12, BANK * 2 * s, s * 0.25);
        return;
      }
      ctx.fillStyle = '#f4ead2';
      ctx.fillRect(this.X(-BANK), y - s * 0.2, BANK * 2 * s, s * 0.4);
      // A banner on poles across the bottom.
      const [lx, ly] = this.P(-BANK + 1, t.y, 3);
      const [rx, ry] = this.P(BANK - 1, t.y, 3);
      ctx.strokeStyle = '#7a5a3a';
      ctx.lineWidth = Math.max(2, s * 0.14);
      ctx.beginPath();
      ctx.moveTo(this.X(-BANK + 1), y);
      ctx.lineTo(lx, ly);
      ctx.moveTo(this.X(BANK - 1), y);
      ctx.lineTo(rx, ry);
      ctx.stroke();
      ctx.fillStyle = ink.red;
      ctx.fillRect(lx, ly, rx - lx, s * 1.1);
      ctx.fillStyle = '#f4ead2';
      ctx.font = `${Math.round(s * 0.95)}px ${this.bill}`;
      ctx.textAlign = 'center';
      ctx.fillText('FIRST TO THE BOTTOM TAKES THE CHEESE', (lx + rx) / 2, ly + s * 0.88);
      return;
    }
    // Luge: a red timing line across the ice.
    const tr = run.course.track!;
    const m = sample(tr.dx, t.y);
    const nn = Math.sqrt(1 + m * m);
    const a = this.P(x - ICE / nn, t.y + (ICE * m) / nn, 0);
    const b = this.P(x + ICE / nn, t.y - (ICE * m) / nn, 0);
    ctx.strokeStyle = ink.red;
    ctx.lineWidth = Math.max(2, s * 0.25);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  // ------------------------------------------------------------ riders

  private rider(run: Run, ry: number, ink: Inks, now: number): void {
    const r = run.rider;
    const ctx = this.ctx;
    const gx = this.X(r.x);
    this.air = r.z * this.cam.s * RISE;
    const gy = this.Y(ry) - this.air;
    if (r.grace > 0 && Math.floor(now / 90) % 2 === 0 && r.state === 'ride') ctx.globalAlpha = 0.45;
    if (run.id === 'bomb') this.skater(run, gx, gy, ink, now);
    else if (run.id === 'cheese') {
      if (r.state === 'crash') this.sprawl(gx, gy, ink.red, ink, r.spill);
      else
        this.runnerFigure(
          gx,
          gy,
          r.state === 'tumble' ? 'tumble' : 'ride',
          r.stride,
          r.heading,
          ink.red,
          ink,
          true,
          r.brake,
        );
    } else this.luger(run, gx, gy, ink);
    ctx.globalAlpha = 1;
    this.air = 0;
  }

  private burst(x: number, y: number, age: number, ink: Inks): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const R = s * (1.1 + age * 0.9);
    ctx.save();
    ctx.globalAlpha = 1 - age * 0.6;
    for (const [k, fill] of [
      [1, ink.gold],
      [0.6, ink.red],
    ] as const) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + 0.2;
        const rr = (i % 2 ? 0.45 : 1) * R * k;
        if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8);
        else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private skater(run: Run, gx: number, gy: number, ink: Inks, now: number): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const r = run.rider;
    const coat = ink.red;
    if (r.state === 'crash') {
      // The board shoots off on its own; the skater's down on the tarmac.
      const age = 1.2 - r.timer;
      ctx.save();
      ctx.translate(gx + Math.sin(r.heading + r.spill) * age * s * 3, gy + age * s * 2.5);
      ctx.rotate(age * 6);
      this.deck(0, 0, 0, ink);
      ctx.restore();
      this.sprawl(gx, gy, coat, ink, r.spill);
      return;
    }
    if (r.state === 'caught') return;
    const lean = Math.max(-0.5, Math.min(0.5, r.omega * 0.18));
    const crouch = r.tuck ? 0.72 : 1;
    const wob = r.wobble > 0.05 ? Math.sin(now * 0.04) * r.wobble * 0.25 : 0;
    // The shadow stays on the road under a jump, shrinking as you rise.
    const shrink = 1 / (1 + this.air / (s * 2.5));
    ctx.fillStyle = ink.shadow;
    ctx.beginPath();
    ctx.ellipse(
      gx + s * 0.35 * shrink,
      gy + this.air + s * 0.08,
      s * 0.55 * shrink,
      s * 0.18 * shrink,
      r.heading,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    // A little tilt to the board in the air, as if grabbed.
    this.deck(gx, gy, r.heading + wob + (this.air > 0 ? 0.25 : 0), ink);
    // Drawn a size up from true scale, as a poster would.
    const k = s * 1.25;
    ctx.save();
    ctx.translate(gx, gy - k * 0.12);
    ctx.rotate(lean + wob * 0.5);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2b3048';
    ctx.lineWidth = k * 0.17;
    const legH = 0.78 * crouch;
    ctx.beginPath();
    ctx.moveTo(-k * 0.2, 0);
    ctx.lineTo(-k * 0.12, -k * legH * 0.5);
    ctx.lineTo(-k * 0.06, -k * legH);
    ctx.moveTo(k * 0.2, 0);
    ctx.lineTo(k * 0.14, -k * legH * 0.5);
    ctx.lineTo(k * 0.06, -k * legH);
    ctx.stroke();
    // Body, arms out for balance.
    const by = -k * legH;
    ctx.fillStyle = coat;
    roundRect(ctx, -k * 0.22, by - k * 0.62 * crouch, k * 0.44, k * 0.66 * crouch, k * 0.12);
    ctx.fill();
    ctx.strokeStyle = coat;
    ctx.lineWidth = k * 0.13;
    const reach = r.tuck ? 0.25 : 0.55;
    ctx.beginPath();
    ctx.moveTo(-k * 0.18, by - k * 0.5 * crouch);
    ctx.lineTo(-k * (0.2 + reach), by - k * (0.35 + lean * 0.6) * crouch);
    ctx.moveTo(k * 0.18, by - k * 0.5 * crouch);
    ctx.lineTo(k * (0.2 + reach), by - k * (0.35 - lean * 0.6) * crouch);
    ctx.stroke();
    // Head and helmet.
    const hy = by - k * 0.78 * crouch;
    ctx.fillStyle = ink.skin;
    ctx.beginPath();
    ctx.arc(0, hy, k * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink.gold;
    ctx.beginPath();
    ctx.arc(0, hy - k * 0.03, k * 0.18, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    ctx.restore();
    if (r.brake && r.v > 3) {
      ctx.fillStyle = 'rgba(239, 231, 214, 0.8)';
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        ctx.fillRect(gx + Math.cos(a) * s * 0.5, gy + Math.abs(Math.sin(a)) * s * 0.4, 2, 2);
      }
    }
  }

  private deck(x: number, y: number, heading: number, ink: Inks): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    ctx.save();
    ctx.translate(x, y);
    // Seen from above and behind: the deck runs along the heading.
    ctx.rotate(-heading);
    ctx.fillStyle = ink.key;
    roundRect(ctx, -s * 0.13, -s * 0.42, s * 0.26, s * 0.84, s * 0.12);
    ctx.fill();
    ctx.fillStyle = ink.gold;
    for (const dy of [-0.3, 0.3]) {
      ctx.fillRect(-s * 0.17, dy * s - s * 0.04, s * 0.06, s * 0.08);
      ctx.fillRect(s * 0.11, dy * s - s * 0.04, s * 0.06, s * 0.08);
    }
    ctx.restore();
  }

  /** Someone flat on the ground after a slam. */
  private sprawl(gx: number, gy: number, coat: string, ink: Inks, spill: number): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(spill * 0.8 + 0.4);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2b3048';
    ctx.lineWidth = s * 0.17;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 0.5, s * 0.5);
    ctx.moveTo(0, 0);
    ctx.lineTo(-s * 0.2, s * 0.65);
    ctx.stroke();
    ctx.strokeStyle = coat;
    ctx.lineWidth = s * 0.38;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -s * 0.6);
    ctx.stroke();
    ctx.lineWidth = s * 0.13;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.5);
    ctx.lineTo(s * 0.55, -s * 0.75);
    ctx.moveTo(0, -s * 0.5);
    ctx.lineTo(-s * 0.5, -s * 0.3);
    ctx.stroke();
    ctx.fillStyle = ink.skin;
    ctx.beginPath();
    ctx.arc(0, -s * 0.85, s * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private runner(x: number, y: number, state: string, stride: number, heading: number, seed: number, ink: Inks): void {
    const coat = ink.coats[Math.floor(seed * ink.coats.length)];
    this.runnerFigure(
      this.X(x),
      this.Y(y),
      state === 'tumble' ? 'tumble' : 'ride',
      stride,
      heading,
      coat,
      ink,
      false,
      false,
    );
  }

  /** A downhill runner, all elbows, or a tumbling ball of limbs. */
  private runnerFigure(
    gx: number,
    gy: number,
    state: 'ride' | 'tumble',
    stride: number,
    heading: number,
    coat: string,
    ink: Inks,
    you: boolean,
    brake: boolean,
  ): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const k = s * (you ? 1.25 : 1.1);
    const air = you ? this.air : 0;
    const shrink = 1 / (1 + air / (s * 2.5));
    ctx.fillStyle = ink.shadow;
    ctx.beginPath();
    ctx.ellipse(gx + k * 0.3 * shrink, gy + air + k * 0.05, k * 0.45 * shrink, k * 0.14 * shrink, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    if (state === 'tumble') {
      ctx.translate(gx, gy - k * 0.5);
      ctx.rotate(stride * 1.4);
      ctx.translate(0, k * 0.5);
    } else {
      ctx.translate(gx, gy);
      // Leaning back against the slope, digging in harder when braking.
      ctx.rotate(heading * 0.25 + (brake ? -0.08 : 0));
    }
    const sw = Math.sin(stride);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3a3f55';
    ctx.lineWidth = k * 0.17;
    ctx.beginPath();
    ctx.moveTo(-k * 0.08, -k * 0.75);
    ctx.lineTo(-k * 0.12 + sw * k * 0.28, -k * 0.35);
    ctx.lineTo(-k * 0.1 + sw * k * 0.18, 0);
    ctx.moveTo(k * 0.08, -k * 0.75);
    ctx.lineTo(k * 0.12 - sw * k * 0.28, -k * 0.35);
    ctx.lineTo(k * 0.1 - sw * k * 0.18, 0);
    ctx.stroke();
    ctx.fillStyle = coat;
    roundRect(ctx, -k * 0.22, -k * 1.38, k * 0.44, k * 0.68, k * 0.12);
    ctx.fill();
    if (you) {
      // The number bib.
      ctx.fillStyle = '#f4ead2';
      ctx.fillRect(-k * 0.15, -k * 1.22, k * 0.3, k * 0.24);
      ctx.fillStyle = ink.key;
      ctx.font = `${Math.round(k * 0.24)}px ${this.bill}`;
      ctx.textAlign = 'center';
      ctx.fillText('8', 0, -k * 1.02);
    }
    ctx.strokeStyle = coat;
    ctx.lineWidth = k * 0.13;
    ctx.beginPath();
    ctx.moveTo(-k * 0.2, -k * 1.3);
    ctx.lineTo(-k * 0.5, -k * (1.25 + sw * 0.3));
    ctx.moveTo(k * 0.2, -k * 1.3);
    ctx.lineTo(k * 0.5, -k * (1.25 - sw * 0.3));
    ctx.stroke();
    ctx.fillStyle = ink.skin;
    ctx.beginPath();
    ctx.arc(0, -k * 1.55, k * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a3a26';
    ctx.beginPath();
    ctx.arc(0, -k * 1.6, k * 0.17, Math.PI, 0);
    ctx.fill();
    ctx.restore();
  }

  /** A wheel of hard cheese, wobbling as it bounds, its paper label going round. */
  cheeseWheel(x: number, y: number, z: number, spin: number, rad: number, ink: Inks, phase: number): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const gx = this.X(x);
    const gy = this.Y(y);
    const R = rad * s;
    ctx.fillStyle = ink.shadow;
    ctx.beginPath();
    ctx.ellipse(gx + R * 0.3, gy, R * (0.9 - Math.min(0.5, z * 0.2)), R * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    const cy = gy - z * s * RISE - R;
    // It wobbles as it rolls, so its face swings in and out of view.
    const tilt = Math.sin(spin * 0.13 + phase);
    const face = 0.55 + 0.4 * Math.abs(tilt);
    const side = tilt < 0 ? -1 : 1;
    const thick = R * 0.42;
    ctx.save();
    ctx.translate(gx, cy);
    ctx.rotate(Math.sin(spin * 0.21 + phase) * 0.2);
    // The rind band, then the face over it.
    ctx.fillStyle = '#c98f2e';
    ctx.beginPath();
    ctx.ellipse(-side * thick * 0.5, 0, R * face, R, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2c24a';
    ctx.beginPath();
    ctx.ellipse(side * thick * 0.5, 0, R * face, R, 0, 0, Math.PI * 2);
    ctx.fill();
    // A cut-paper label on the face, turning with the roll.
    ctx.save();
    ctx.translate(side * thick * 0.5, 0);
    ctx.scale(face, 1);
    ctx.rotate(spin);
    ctx.fillStyle = ink.red;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4ead2';
    ctx.fillRect(-R * 0.42, -R * 0.09, R * 0.84, R * 0.18);
    ctx.strokeStyle = '#d9a53a';
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.82, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  private luger(run: Run, gx: number, gy: number, ink: Inks): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    const r = run.rider;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(-r.heading);
    ctx.scale(1.35, 1.35);
    if (r.state === 'crash') {
      // Off the sled, sliding on your back with the sled spinning away.
      const age = 1.6 - r.timer;
      ctx.save();
      ctx.translate(r.spill * age * s * 0.4, age * s * 2);
      ctx.rotate(age * 5);
      this.sled(ink, false);
      ctx.restore();
      ctx.rotate(r.spill * 0.6);
    } else if (r.state === 'caught') {
      ctx.restore();
      return;
    }
    if (r.state !== 'crash') this.sled(ink, true);
    // Lying back, feet first: helmet uphill, toes pointed downhill.
    const lean = (r.state === 'ride' ? r.omega : 0) * 0.08;
    ctx.fillStyle = ink.blue;
    roundRect(ctx, -s * 0.2, -s * 0.55, s * 0.4, s * 1.1, s * 0.18);
    ctx.fill();
    ctx.fillStyle = '#f2f6f9';
    ctx.fillRect(-s * 0.2, -s * 0.05, s * 0.4, s * 0.08);
    ctx.fillStyle = ink.red;
    ctx.beginPath();
    ctx.arc(lean * s, -s * 0.62, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14203a';
    ctx.fillRect(lean * s - s * 0.13, -s * 0.66, s * 0.26, s * 0.08);
    ctx.restore();
  }

  private sled(ink: Inks, under: boolean): void {
    const ctx = this.ctx;
    const s = this.cam.s;
    ctx.fillStyle = 'rgba(20, 32, 64, 0.35)';
    if (under) {
      ctx.beginPath();
      ctx.ellipse(s * 0.12, s * 0.1, s * 0.34, s * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#9aa6b8';
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    for (const dx of [-0.22, 0.22]) {
      ctx.beginPath();
      ctx.moveTo(dx * s, -s * 0.5);
      ctx.lineTo(dx * s, s * 0.6);
      ctx.quadraticCurveTo(dx * s, s * 0.8, dx * s * 0.6, s * 0.85);
      ctx.stroke();
    }
    ctx.fillStyle = ink.gold;
    roundRect(ctx, -s * 0.24, -s * 0.35, s * 0.48, s * 0.7, s * 0.1);
    ctx.fill();
  }

  private pursuer(run: Run, ink: Inks, now: number): void {
    const q = run.pursuer;
    const ctx = this.ctx;
    const s = this.cam.s;
    if (run.id === 'bomb') {
      // A runaway street sweeper: white cab, orange body, brushes spinning.
      const hw = run.spec.hw;
      const hd = run.spec.hd;
      const x = q.x;
      const y = q.y;
      for (const dx of [-hw - 0.15, hw + 0.15]) {
        const [bx, by] = this.P(x + dx, y + hd - 0.2, 0.25);
        ctx.fillStyle = '#5a4632';
        ctx.beginPath();
        ctx.ellipse(bx, by, s * 0.75, s * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#d9b26a';
        ctx.lineWidth = Math.max(1, s * 0.05);
        for (let i = 0; i < 10; i++) {
          const a = q.spin * 3 * Math.sign(dx) + (i / 10) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(a) * s * 0.75, by + Math.sin(a) * s * 0.3);
          ctx.stroke();
        }
      }
      this.boxAt(x, y - 0.5, hw, hd - 0.5, 2.4, '#ec6b2d', '#c95520', '#d8601f', false, ink);
      this.boxAt(x, y + hd - 0.6, hw * 0.9, 0.6, 2.7, '#efe7d6', '#d6ccb5', '#e3d9c2', false, ink);
      const [wx, wy] = this.P(x, y + hd, 1.6);
      ctx.fillStyle = '#2c3550';
      ctx.fillRect(wx - hw * s * 0.75, wy, hw * s * 1.5, s * 0.75);
      // The beacon.
      const [lx, ly] = this.P(x, y + hd - 0.6, 3.1);
      const on = Math.sin(now * 0.02) > 0;
      ctx.fillStyle = on ? '#ffd23a' : '#a87a14';
      ctx.beginPath();
      ctx.arc(lx, ly, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
      if (on) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, s * 4);
        g.addColorStop(0, 'rgba(255, 200, 60, 0.35)');
        g.addColorStop(1, 'rgba(255, 200, 60, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(lx - s * 4, ly - s * 4, s * 8, s * 8);
        ctx.restore();
      }
      return;
    }
    if (run.id === 'cheese') {
      const bounce = Math.abs(Math.sin(q.spin * 0.45)) * 1.4;
      this.cheeseWheel(q.x, q.y, bounce, q.spin * 2.4, 0.9, ink, 1.3);
      return;
    }
    // The four-man bob: a long red shell with four helmets in a row.
    const tr = run.course.track!;
    const m = sample(tr.dx, q.y);
    const nn = Math.sqrt(1 + m * m);
    const gx = this.X(q.x);
    const gy = this.Y(q.y - (q.u * m) / nn);
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(-Math.atan(m));
    ctx.fillStyle = 'rgba(20, 32, 64, 0.4)';
    ctx.beginPath();
    ctx.ellipse(s * 0.2, s * 0.2, s * 0.65, s * 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink.red;
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, -s * 1.9);
    ctx.lineTo(s * 0.55, -s * 1.9);
    ctx.lineTo(s * 0.55, s * 1.2);
    ctx.quadraticCurveTo(s * 0.5, s * 2, 0, s * 2.1);
    ctx.quadraticCurveTo(-s * 0.5, s * 2, -s * 0.55, s * 1.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f2f6f9';
    ctx.fillRect(-s * 0.55, s * 0.6, s * 1.1, s * 0.16);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = ink.gold;
      ctx.beginPath();
      ctx.arc(0, -s * 1.45 + i * s * 0.75, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ------------------------------------------------------------ small helpers

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function lerp2(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, seed: number): void {
  const r = mulberry(Math.floor(seed * 1e6) + 3);
  ctx.beginPath();
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.8 + r() * 0.35;
    const px = x + Math.cos(a) * rx * k;
    const py = y + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (k < 0) {
    r *= 1 + k;
    g *= 1 + k;
    b *= 1 + k;
  } else {
    r += (255 - r) * k;
    g += (255 - g) * k;
    b += (255 - b) * k;
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

export function clock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
