// The water line is a row of columns joined by springs: a one-dimensional wave
// equation, so a splash sends ripples out both ways and they reflect off the
// shores. Wind adds a light chop on top. Drops thrown up by a splash fall back
// and make their own small rings; bubbles rise and pop; and at night the
// plankton light up wherever the water is disturbed.

import { Layer, rgb } from './_pixels';
import { WATER_X0, WATER_X1, WORLD_W, bedAt } from './_world';

const WAVE_SPEED = 42; // px per second
const RESTORE = 0.8;
const DAMPING = 1.1;
const SUBSTEPS = 2;

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  foam: boolean;
}

interface Bubble {
  x: number;
  y: number;
  vy: number;
  phase: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

const DROP = rgb(0xeefbff);
const DROP_BLUE = rgb(0x9fe3f4);
const BUBBLE = rgb(0xd8f6ff, 200);

export class Water {
  readonly h = new Float32Array(WORLD_W + 1);
  readonly v = new Float32Array(WORLD_W + 1);
  /** 0 calm to 1 breezy. */
  wind = 0.5;
  /** 0 by day to 1 at night: whether the plankton glow. */
  night = 0;
  private time = 0;
  private drops: Drop[] = [];
  private bubbles: Bubble[] = [];
  private sparks: Spark[] = [];

  step(dt: number): void {
    this.time += dt;
    const { h, v } = this;
    const sub = dt / SUBSTEPS;
    const c2 = WAVE_SPEED * WAVE_SPEED;
    for (let s = 0; s < SUBSTEPS; s++) {
      for (let i = WATER_X0; i <= WATER_X1; i++) {
        const left = i > WATER_X0 ? h[i - 1] : h[i];
        const right = i < WATER_X1 ? h[i + 1] : h[i];
        v[i] += (c2 * (left + right - 2 * h[i]) - RESTORE * h[i] - DAMPING * v[i]) * sub;
      }
      for (let i = WATER_X0; i <= WATER_X1; i++) h[i] += v[i] * sub;
    }

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.vy += 170 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.vy > 0 && d.y >= this.surfaceAt(d.x)) {
        this.push(d.x, 1, 6);
        this.drops.splice(i, 1);
      } else if (d.x < 0 || d.x > WORLD_W || d.y > 200) this.drops.splice(i, 1);
    }

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.y -= b.vy * dt;
      b.phase += dt * 5;
      if (b.y <= this.surfaceAt(b.x) + 0.5) {
        this.bubbles.splice(i, 1);
        this.push(b.x, 1, 1.5);
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      if (p.life <= 0) this.sparks.splice(i, 1);
    }
  }

  /** The chop the wind adds, in pixels, fading out toward the shores. */
  private chop(x: number): number {
    const t = this.time;
    const edge = Math.min(1, (x - WATER_X0) / 24, (WATER_X1 - x) / 24);
    if (edge <= 0) return 0;
    const w = 0.35 + this.wind * 0.75;
    return (
      edge * w * (0.5 * Math.sin(x * 0.11 + t * 1.6) + 0.32 * Math.sin(x * 0.047 - t * 0.9) + 0.22 * Math.sin(x * 0.23 + t * 2.7))
    );
  }

  /** World y of the water surface at x (0 is still water). */
  surfaceAt(x: number): number {
    if (x < WATER_X0 || x > WATER_X1) return 0;
    const i = Math.floor(x);
    const f = x - i;
    const a = this.h[i];
    const b = this.h[Math.min(WORLD_W, i + 1)];
    return a + (b - a) * f + this.chop(x);
  }

  /** Push the water down (positive) or up over a few columns. */
  push(x: number, width: number, strength: number): void {
    const x0 = Math.max(WATER_X0, Math.floor(x - width));
    const x1 = Math.min(WATER_X1, Math.ceil(x + width));
    for (let i = x0; i <= x1; i++) {
      const k = 1 - Math.abs(i - x) / (width + 1);
      if (k > 0) this.v[i] += strength * k;
    }
  }

  /** A splash: push the surface and throw drops up. */
  splash(x: number, size: number, dir = 0): void {
    if (x < WATER_X0 || x > WATER_X1) return;
    this.push(x, 2 + size * 1.5, 18 + size * 16);
    const n = Math.round(4 + size * 7);
    const y = this.surfaceAt(x) - 1;
    for (let i = 0; i < n; i++) {
      const spread = (Math.random() - 0.5) * 2;
      this.drops.push({
        x: x + spread * 2,
        y,
        vx: spread * (14 + size * 16) + dir * 20,
        vy: -(26 + Math.random() * (30 + size * 34)),
        foam: Math.random() < 0.6,
      });
    }
    this.disturb(x, y + 2, 6 + size * 8);
  }

  bubble(x: number, y: number): void {
    if (y < this.surfaceAt(x) + 1 || y > bedAt(x)) return;
    this.bubbles.push({ x, y, vy: 9 + Math.random() * 7, phase: Math.random() * 6 });
  }

  /** At night, plankton flash where something moves through the water. */
  disturb(x: number, y: number, count: number): void {
    if (this.night < 0.25) return;
    const n = Math.round(count * this.night);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 3;
      const sx = x + Math.cos(a) * r;
      const sy = Math.max(this.surfaceAt(sx) + 1, y + Math.sin(a) * r);
      if (sy >= bedAt(sx)) continue;
      const max = 0.5 + Math.random() * 1.1;
      this.sparks.push({ x: sx, y: sy, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, life: max, max });
    }
    if (this.sparks.length > 600) this.sparks.splice(0, this.sparks.length - 600);
  }

  draw(layer: Layer, glow: Layer): void {
    for (const d of this.drops) layer.set(d.x, d.y, d.foam ? DROP : DROP_BLUE);
    for (const b of this.bubbles) layer.set(b.x + Math.round(Math.sin(b.phase) * 0.6), b.y, BUBBLE);
    for (const p of this.sparks) {
      const k = p.life / p.max;
      glow.add(p.x, p.y, 0x46e8ff, 0.25 + 0.75 * k * k);
    }
  }
}
