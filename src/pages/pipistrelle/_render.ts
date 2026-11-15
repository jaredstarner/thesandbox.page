// Drawing the night. Echoes land on a phosphor layer in screen space that fades
// as you watch, each one a short arc at the range it came back from, since a
// bat knows distance far better than direction. Everything heard also leaves a
// faint mark on a memory of the ground in world space, so the territory sketches
// itself in over the night. The only true light is the streetlamp.

import { WORLD_H, WORLD_W, type World } from './_world';
import { KIND_INSECT, KIND_SOLID, SOUND, spreading, type Echo } from './_sonar';
import { STRETCH } from './_sound';
import { LAMP_R } from './_dawn';
import type { Bat } from './_bat';
import type { Insect } from './_insects';

const MEMORY_PX = 16;
const ECHO_RGB = '214, 236, 228';
const SOLID_RGB = '240, 250, 246';
const AMBER_RGB = '255, 196, 107';

interface Pending {
  ox: number;
  oy: number;
  x: number;
  y: number;
  range: number;
  bearing: number;
  half: number;
  vis: number;
  born: number;
  kind: number;
}

interface Ring {
  x: number;
  y: number;
  heading: number;
  beam: number;
  range: number;
  t0: number;
  strong: number;
}

export interface Flash {
  x: number;
  y: number;
  t0: number;
  kind: 'catch' | 'bump' | 'click' | 'spit';
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private phosphor: HTMLCanvasElement;
  private pctx: CanvasRenderingContext2D;
  private memory: HTMLCanvasElement;
  private mctx: CanvasRenderingContext2D;
  private glowAmber: HTMLCanvasElement;
  private dot: HTMLCanvasElement;
  private lampSprite: HTMLCanvasElement | null = null;
  dawn: HTMLCanvasElement | null = null;
  private pending: Pending[] = [];
  /** Insect echoes, drawn fresh each frame so their glow fades cleanly. */
  private sparks: { x: number; y: number; vis: number; born: number }[] = [];
  private rings: Ring[] = [];
  flashes: Flash[] = [];
  /** Device pixels per CSS pixel. */
  dpr = 1;
  width = 0;
  height = 0;
  /** Camera centre in metres, and device pixels per metre. */
  camX = 0;
  camY = 0;
  zoom = 60;
  private lastPx = 0;
  private lastPy = 0;
  private fadeAcc = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.phosphor = document.createElement('canvas');
    this.pctx = this.phosphor.getContext('2d')!;
    this.memory = document.createElement('canvas');
    this.memory.width = Math.round(WORLD_W * MEMORY_PX);
    this.memory.height = Math.round(WORLD_H * MEMORY_PX);
    this.mctx = this.memory.getContext('2d')!;
    this.glowAmber = glow(AMBER_RGB);
    this.dot = softDot();
  }

  /** The zoom the night is flown at, for this screen. */
  flightZoom(): number {
    const cssW = this.width / this.dpr;
    const cssH = this.height / this.dpr;
    // About 16 metres across a desktop screen, 13 across a phone held upright.
    const pxPerM = Math.max(26, Math.min(88, Math.min(cssW / 16, cssH / 11)));
    return pxPerM * this.dpr;
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(r.width * this.dpr));
    this.height = Math.max(1, Math.round(r.height * this.dpr));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.phosphor.width = this.width;
    this.phosphor.height = this.height;
    this.lastPx = Math.round(this.camX * this.zoom);
    this.lastPy = Math.round(this.camY * this.zoom);
  }

  clearMemory(): void {
    this.mctx.clearRect(0, 0, this.memory.width, this.memory.height);
    this.pctx.clearRect(0, 0, this.width, this.height);
    this.pending.length = 0;
    this.sparks.length = 0;
    this.rings.length = 0;
    this.flashes.length = 0;
  }

  setDay(img: ImageData): void {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    this.dawn = c;
  }

  setLamp(img: ImageData): void {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    this.lampSprite = c;
  }

  /** Queues a call's echoes to land on the phosphor as they arrive. */
  addCall(echoes: Echo[], bx: number, by: number, heading: number, beam: number, range: number, rays: number, now: number, strong: number): void {
    const half = (beam / rays) * 1.15 + 0.004;
    for (const e of echoes) {
      const s = spreading(e.range);
      let vis = e.amp * s * (e.kind === KIND_INSECT ? 3.4 : 2.1);
      if (vis < 0.012) continue;
      vis = Math.min(1, Math.pow(vis, 0.75));
      this.pending.push({
        ox: bx,
        oy: by,
        x: e.x,
        y: e.y,
        range: e.range,
        bearing: e.bearing,
        half: e.kind === KIND_INSECT ? 0 : half * (1 + e.range * 0.02),
        vis,
        born: now + ((2 * e.range) / SOUND) * STRETCH,
        kind: e.kind,
      });
    }
    this.rings.push({ x: bx, y: by, heading, beam, range, t0: now, strong });
  }

  /** Moves the camera, keeping the phosphor registered to the ground. */
  setCamera(x: number, y: number, zoom: number): void {
    if (Math.abs(zoom - this.zoom) > 1e-6) {
      // A zoom can't be shifted; let the phosphor go.
      this.pctx.clearRect(0, 0, this.width, this.height);
      this.zoom = zoom;
      this.camX = x;
      this.camY = y;
      this.lastPx = Math.round(x * zoom);
      this.lastPy = Math.round(y * zoom);
      return;
    }
    this.camX = x;
    this.camY = y;
    const px = Math.round(x * zoom);
    const py = Math.round(y * zoom);
    const dx = px - this.lastPx;
    const dy = py - this.lastPy;
    if (dx || dy) {
      const p = this.pctx;
      p.save();
      p.globalCompositeOperation = 'copy';
      p.drawImage(this.phosphor, -dx, -dy);
      p.restore();
      this.lastPx = px;
      this.lastPy = py;
    }
  }

  /** World to device pixels, on the rounded camera the phosphor uses. */
  sx(x: number): number {
    return x * this.zoom - this.lastPx + this.width / 2;
  }

  sy(y: number): number {
    return y * this.zoom - this.lastPy + this.height / 2;
  }

  /** Device pixels to world. */
  wx(px: number): number {
    return (px - this.width / 2 + this.lastPx) / this.zoom;
  }

  wy(py: number): number {
    return (py - this.height / 2 + this.lastPy) / this.zoom;
  }

  private land(now: number, dt: number): void {
    const p = this.pctx;
    // Fade what is there; in steps, so faint traces clear instead of sticking.
    this.fadeAcc += dt;
    if (this.fadeAcc > 0.05) {
      const k = 1 - Math.exp(-this.fadeAcc / 0.62);
      this.fadeAcc = 0;
      p.save();
      p.globalCompositeOperation = 'destination-out';
      p.fillStyle = `rgba(0,0,0,${k.toFixed(4)})`;
      p.fillRect(0, 0, this.width, this.height);
      p.restore();
    }
    if (!this.pending.length) return;
    const buckets: Path2D[] = [];
    const solid: Path2D[] = [];
    const bucketsN = 7;
    for (let b = 0; b < bucketsN; b++) {
      buckets.push(new Path2D());
      solid.push(new Path2D());
    }
    const m = this.mctx;
    const keep: Pending[] = [];
    const z = this.zoom;
    p.save();
    p.globalCompositeOperation = 'lighter';
    for (const e of this.pending) {
      if (e.born > now) {
        keep.push(e);
        continue;
      }
      if (e.kind === KIND_INSECT) {
        this.sparks.push({ x: e.x, y: e.y, vis: e.vis, born: e.born });
        continue;
      }
      const b = Math.min(bucketsN - 1, Math.floor(e.vis * bucketsN));
      const path = e.kind === KIND_SOLID ? solid[b] : buckets[b];
      const cx = this.sx(e.ox);
      const cy = this.sy(e.oy);
      const r = e.range * z;
      const a0 = e.bearing - e.half;
      path.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
      path.arc(cx, cy, r, a0, e.bearing + e.half);
      // And a mark on the memory of the ground.
      if (e.vis > 0.05) {
        m.globalAlpha = Math.min(0.3, e.vis * 0.16);
        m.drawImage(this.dot, e.x * MEMORY_PX - 1.5, e.y * MEMORY_PX - 1.5, 3, 3);
      }
    }
    p.globalAlpha = 1;
    p.lineCap = 'round';
    for (let b = 0; b < bucketsN; b++) {
      const a = (b + 0.6) / bucketsN;
      p.lineWidth = (1.1 + a * 0.9) * this.dpr;
      p.strokeStyle = `rgba(${ECHO_RGB}, ${(a * 0.95).toFixed(3)})`;
      p.stroke(buckets[b]);
      p.lineWidth = (1.4 + a * 1.2) * this.dpr;
      p.strokeStyle = `rgba(${SOLID_RGB}, ${Math.min(1, a * 1.15).toFixed(3)})`;
      p.stroke(solid[b]);
    }
    p.restore();
    this.pending = keep;
  }

  draw(
    now: number,
    dt: number,
    bat: Bat,
    insects: Insect[],
    dawn: number,
    opts: { memoryAlpha: number; showBat: boolean; trail: { x: number; y: number }[] | null; catches: { x: number; y: number }[] | null; homeArrow: boolean },
  ): void {
    const c = this.ctx;
    const W = this.width;
    const H = this.height;
    this.land(now, dt);

    // Night sky over the ground, lifting towards dawn.
    const night = [3, 6, 10];
    const morning = [30, 38, 50];
    const k = dawn;
    c.fillStyle = `rgb(${Math.round(night[0] + (morning[0] - night[0]) * k)}, ${Math.round(night[1] + (morning[1] - night[1]) * k)}, ${Math.round(night[2] + (morning[2] - night[2]) * k)})`;
    c.fillRect(0, 0, W, H);

    const x0 = this.sx(0);
    const y0 = this.sy(0);
    const ww = WORLD_W * this.zoom;
    const wh = WORLD_H * this.zoom;

    if (this.dawn && dawn > 0) {
      c.save();
      c.globalAlpha = Math.min(1, dawn);
      c.imageSmoothingQuality = 'high';
      c.drawImage(this.dawn, x0, y0, ww, wh);
      c.restore();
    }

    // The lamp's pool of light: the one thing seen with eyes.
    const L = this.world.lamp;
    const lx = this.sx(L.x);
    const ly = this.sy(L.y);
    const lr = LAMP_R * this.zoom;
    const lampOn = 1 - Math.min(1, dawn * 1.4);
    if (lampOn > 0) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = lampOn * 0.52;
      c.imageSmoothingQuality = 'high';
      if (this.lampSprite) c.drawImage(this.lampSprite, lx - lr, ly - lr, lr * 2, lr * 2);
      c.globalAlpha = lampOn;
      const g = c.createRadialGradient(lx, ly, 0, lx, ly, lr);
      g.addColorStop(0, 'rgba(255, 154, 70, 0.1)');
      g.addColorStop(0.3, 'rgba(255, 140, 60, 0.035)');
      g.addColorStop(1, 'rgba(255, 120, 50, 0)');
      c.fillStyle = g;
      c.fillRect(lx - lr, ly - lr, lr * 2, lr * 2);
      // The lantern head.
      const hr = 0.55 * this.zoom;
      const h = c.createRadialGradient(lx, ly, 0, lx, ly, hr);
      h.addColorStop(0, 'rgba(255, 236, 200, 0.95)');
      h.addColorStop(0.25, 'rgba(255, 180, 100, 0.5)');
      h.addColorStop(1, 'rgba(255, 150, 70, 0)');
      c.fillStyle = h;
      c.fillRect(lx - hr, ly - hr, hr * 2, hr * 2);
      // Moths in the light, seen rather than heard.
      for (const i of insects) {
        const d = Math.hypot(i.x - L.x, i.y - L.y);
        if (d > LAMP_R * 0.85 || i.mode === 'down') continue;
        const lit = (1 - d / (LAMP_R * 0.85)) ** 1.6;
        const s = (i.sp === 'midge' ? 1.1 : i.sp === 'underwing' || i.sp === 'tiger' ? 2.2 : 1.6) * this.dpr;
        c.globalAlpha = lampOn * Math.min(1, lit * 1.4);
        c.fillStyle = 'rgb(255, 214, 160)';
        c.beginPath();
        c.arc(this.sx(i.x), this.sy(i.y), s, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }

    // What the bat remembers of the ground.
    if (opts.memoryAlpha > 0) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = opts.memoryAlpha;
      c.imageSmoothingEnabled = true;
      c.drawImage(this.memory, x0, y0, ww, wh);
      c.restore();
    }

    // The fresh echoes.
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.drawImage(this.phosphor, 0, 0);
    c.restore();

    // Wings caught in the call: each insect echo glints, then fades.
    if (this.sparks.length) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      const keep: typeof this.sparks = [];
      for (const s of this.sparks) {
        const age = now - s.born;
        if (age > 1.6) continue;
        keep.push(s);
        const env = age < 0.03 ? age / 0.03 : Math.exp(-(age - 0.03) / 0.42);
        const r = (2.6 + s.vis * 6.5) * this.dpr * Math.max(0.55, Math.min(1.2, this.zoom / (70 * this.dpr)));
        c.globalAlpha = Math.min(1, (0.3 + s.vis) * env);
        c.drawImage(this.glowAmber, this.sx(s.x) - r, this.sy(s.y) - r, r * 2, r * 2);
      }
      this.sparks = keep;
      c.restore();
    }

    // The range the echoes are arriving from right now.
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.lineWidth = 1 * this.dpr;
    const alive: Ring[] = [];
    for (const r of this.rings) {
      const rad = ((now - r.t0) * SOUND) / (2 * STRETCH);
      if (rad > r.range) continue;
      alive.push(r);
      const a = 0.16 * r.strong * (1 - rad / r.range);
      c.strokeStyle = `rgba(${ECHO_RGB}, ${a.toFixed(3)})`;
      c.beginPath();
      c.arc(this.sx(r.x), this.sy(r.y), rad * this.zoom, r.heading - r.beam, r.heading + r.beam);
      c.stroke();
    }
    this.rings = alive;
    c.restore();

    // Flashes: a catch, a bump, a moth's clicks.
    c.save();
    c.globalCompositeOperation = 'lighter';
    const fl: Flash[] = [];
    for (const f of this.flashes) {
      const age = now - f.t0;
      if (age > 1.2) continue;
      fl.push(f);
      const x = this.sx(f.x);
      const y = this.sy(f.y);
      if (f.kind === 'catch' || f.kind === 'spit') {
        const r = (8 + age * 40) * this.dpr;
        c.strokeStyle = f.kind === 'catch' ? `rgba(${AMBER_RGB}, ${(0.8 * (1 - age / 1.2)).toFixed(3)})` : `rgba(200, 120, 90, ${(0.7 * (1 - age / 1.2)).toFixed(3)})`;
        c.lineWidth = 1.5 * this.dpr;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.stroke();
      } else if (f.kind === 'bump') {
        const r = (6 + age * 70) * this.dpr;
        c.strokeStyle = `rgba(${SOLID_RGB}, ${(0.5 * (1 - age / 1.2)).toFixed(3)})`;
        c.lineWidth = 1 * this.dpr;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.stroke();
      } else {
        // Clicks: little ticks radiating from the moth.
        const n = 9;
        c.strokeStyle = `rgba(${AMBER_RGB}, ${(0.75 * (1 - age / 1.2)).toFixed(3)})`;
        c.lineWidth = 1.2 * this.dpr;
        c.beginPath();
        for (let q = 0; q < n; q++) {
          const a = (q / n) * Math.PI * 2 + f.t0;
          const r0 = (5 + age * 18) * this.dpr;
          const r1 = r0 + 4 * this.dpr;
          c.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
          c.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
        }
        c.stroke();
      }
    }
    this.flashes = fl;
    c.restore();

    // At the end: where the night took you.
    if (opts.trail && opts.trail.length > 1) {
      c.save();
      c.strokeStyle = `rgba(${AMBER_RGB}, 0.5)`;
      c.lineWidth = 1.1 * this.dpr;
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(this.sx(opts.trail[0].x), this.sy(opts.trail[0].y));
      for (const p of opts.trail) c.lineTo(this.sx(p.x), this.sy(p.y));
      c.stroke();
      if (opts.catches) {
        c.fillStyle = `rgb(${AMBER_RGB})`;
        for (const p of opts.catches) {
          c.beginPath();
          c.arc(this.sx(p.x), this.sy(p.y), 2.4 * this.dpr, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
    }

    // A hairline round the map once it is all in view.
    if (dawn > 0.95) {
      c.save();
      c.strokeStyle = `rgba(${ECHO_RGB}, 0.22)`;
      c.lineWidth = 1 * this.dpr;
      c.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(ww) - 1, Math.round(wh) - 1);
      c.restore();
    }

    if (opts.homeArrow) this.drawHomeArrow(bat, now);
    if (opts.showBat) this.drawBat(bat);
  }

  private drawHomeArrow(bat: Bat, now: number): void {
    const c = this.ctx;
    const R = this.world.roost;
    const rx = this.sx(R.x);
    const ry = this.sy(R.y);
    const pulse = 0.55 + 0.45 * Math.sin(now * 3);
    const m = 46 * this.dpr;
    const bottom = this.height - 150 * this.dpr;
    if (rx > m && rx < this.width - m && ry > m && ry < bottom) {
      // The roost is on screen: a warm mark under the eaves.
      c.save();
      c.globalCompositeOperation = 'lighter';
      const g = c.createRadialGradient(rx, ry, 0, rx, ry, 1.2 * this.zoom);
      g.addColorStop(0, `rgba(${AMBER_RGB}, ${(0.35 * pulse).toFixed(3)})`);
      g.addColorStop(1, `rgba(${AMBER_RGB}, 0)`);
      c.fillStyle = g;
      c.fillRect(rx - 1.2 * this.zoom, ry - 1.2 * this.zoom, 2.4 * this.zoom, 2.4 * this.zoom);
      c.restore();
      return;
    }
    const bx = this.sx(bat.x);
    const by = this.sy(bat.y);
    const a = Math.atan2(ry - by, rx - bx);
    const cx = Math.max(m, Math.min(this.width - m, bx + Math.cos(a) * this.width));
    const cy = Math.max(m, Math.min(bottom, by + Math.sin(a) * this.width));
    // Pull the arrow back along the ray to the screen edge.
    const t = Math.min(
      Math.abs((Math.cos(a) > 0 ? this.width - m - bx : m - bx) / (Math.cos(a) || 1e-6)),
      Math.abs((Math.sin(a) > 0 ? bottom - by : m - by) / (Math.sin(a) || 1e-6)),
    );
    const ax = Number.isFinite(t) ? bx + Math.cos(a) * t : cx;
    const ay = Number.isFinite(t) ? by + Math.sin(a) * t : cy;
    c.save();
    c.translate(ax, ay);
    c.rotate(a);
    c.fillStyle = `rgba(${AMBER_RGB}, ${(0.55 + 0.35 * pulse).toFixed(3)})`;
    const s = this.dpr;
    c.beginPath();
    c.moveTo(12 * s, 0);
    c.lineTo(-6 * s, -7 * s);
    c.lineTo(-2 * s, 0);
    c.lineTo(-6 * s, 7 * s);
    c.closePath();
    c.fill();
    c.restore();
  }

  /** A common pipistrelle from above, drawn larger than life so you can find yourself. */
  private drawBat(bat: Bat): void {
    const c = this.ctx;
    const x = this.sx(bat.x);
    const y = this.sy(bat.y);
    const span = Math.max(46 * this.dpr, Math.min(70 * this.dpr, 0.7 * this.zoom));
    // Seen from above, a downstroke barely narrows the span; keep the silhouette readable.
    const flap = 0.78 + 0.22 * Math.cos(bat.wing);
    const s = span / 2;
    c.save();
    // A little dark round the bat, so it reads over the lamp's light and the echoes.
    const halo = c.createRadialGradient(x, y, 0, x, y, s * 1.1);
    halo.addColorStop(0, 'rgba(3, 6, 10, 0.55)');
    halo.addColorStop(1, 'rgba(3, 6, 10, 0)');
    c.fillStyle = halo;
    c.fillRect(x - s * 1.1, y - s * 1.1, s * 2.2, s * 2.2);
    c.translate(x, y);
    c.rotate(bat.heading + Math.PI / 2);
    const membrane = 'rgba(178, 198, 192, 0.9)';
    const bone = 'rgba(3, 6, 10, 0.42)';
    for (const side of [-1, 1]) {
      const w = s * flap;
      const sh = { x: side * s * 0.07, y: -s * 0.14 };
      const wrist = { x: side * w * 0.48, y: -s * 0.27 };
      const tip = { x: side * w, y: -s * 0.02 };
      const f2 = { x: side * w * 0.82, y: s * 0.24 };
      const f3 = { x: side * w * 0.52, y: s * 0.34 };
      const foot = { x: side * s * 0.12, y: s * 0.3 };
      c.beginPath();
      c.moveTo(sh.x, sh.y);
      c.quadraticCurveTo(side * w * 0.22, -s * 0.3, wrist.x, wrist.y);
      c.quadraticCurveTo(side * w * 0.8, -s * 0.2, tip.x, tip.y);
      // The trailing edge, scalloped between the fingers.
      c.quadraticCurveTo(side * w * 0.86, s * 0.08, f2.x, f2.y);
      c.quadraticCurveTo(side * w * 0.66, s * 0.22, f3.x, f3.y);
      c.quadraticCurveTo(side * s * 0.3, s * 0.22, foot.x, foot.y);
      c.closePath();
      c.fillStyle = membrane;
      c.fill();
      c.strokeStyle = bone;
      c.lineWidth = 0.9 * this.dpr;
      c.beginPath();
      c.moveTo(wrist.x, wrist.y);
      c.lineTo(tip.x * 0.97, tip.y);
      c.moveTo(wrist.x, wrist.y);
      c.lineTo(f2.x, f2.y);
      c.moveTo(wrist.x, wrist.y);
      c.lineTo(f3.x, f3.y);
      c.stroke();
    }
    // Tail membrane.
    c.fillStyle = membrane;
    c.beginPath();
    c.moveTo(-s * 0.12, s * 0.3);
    c.quadraticCurveTo(0, s * 0.64, s * 0.12, s * 0.3);
    c.closePath();
    c.fill();
    // Body, head, and ears, a shade darker and warmer: the fur.
    c.fillStyle = 'rgb(150, 160, 150)';
    c.beginPath();
    c.ellipse(0, s * 0.07, s * 0.1, s * 0.25, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(0, -s * 0.25, s * 0.078, s * 0.088, 0, 0, Math.PI * 2);
    c.fill();
    for (const side of [-1, 1]) {
      c.beginPath();
      c.moveTo(side * s * 0.025, -s * 0.31);
      c.lineTo(side * s * 0.1, -s * 0.43);
      c.lineTo(side * s * 0.08, -s * 0.27);
      c.closePath();
      c.fill();
    }
    c.restore();
  }
}

function softDot(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, `rgba(${ECHO_RGB}, 1)`);
  grad.addColorStop(0.5, `rgba(${ECHO_RGB}, 0.45)`);
  grad.addColorStop(1, `rgba(${ECHO_RGB}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 16);
  return c;
}

function glow(rgb: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 48;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(24, 24, 0, 24, 24, 24);
  grad.addColorStop(0, `rgba(255, 250, 235, 1)`);
  grad.addColorStop(0.12, `rgba(${rgb}, 0.95)`);
  grad.addColorStop(0.4, `rgba(${rgb}, 0.28)`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 48, 48);
  return c;
}
