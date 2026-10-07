// The fishing line: a Verlet rope pinned at the rod tip and at the float. It
// sags when slack, straightens when taut, and sinks slowly where it lies in
// the water.

import type { Layer } from './_pixels';

const POINTS = 22;
const GRAVITY = 140;
const ITERATIONS = 12;

export class Rope {
  readonly x = new Float32Array(POINTS);
  readonly y = new Float32Array(POINTS);
  private readonly px = new Float32Array(POINTS);
  private readonly py = new Float32Array(POINTS);
  /** Length of line out, in pixels. */
  length = 8;

  reset(ax: number, ay: number, bx: number, by: number): void {
    for (let i = 0; i < POINTS; i++) {
      const t = i / (POINTS - 1);
      this.x[i] = this.px[i] = ax + (bx - ax) * t;
      this.y[i] = this.py[i] = ay + (by - ay) * t;
    }
  }

  step(dt: number, ax: number, ay: number, bx: number, by: number, surfaceAt: (x: number) => number): void {
    const { x, y, px, py } = this;
    for (let i = 1; i < POINTS - 1; i++) {
      const wet = y[i] > surfaceAt(x[i]);
      const keep = wet ? 0.86 : 0.985;
      const vx = (x[i] - px[i]) * keep;
      const vy = (y[i] - py[i]) * keep;
      px[i] = x[i];
      py[i] = y[i];
      x[i] += vx;
      y[i] += vy + (wet ? GRAVITY * 0.12 : GRAVITY) * dt * dt;
    }
    const rest = this.length / (POINTS - 1);
    for (let k = 0; k < ITERATIONS; k++) {
      x[0] = ax;
      y[0] = ay;
      x[POINTS - 1] = bx;
      y[POINTS - 1] = by;
      for (let i = 0; i < POINTS - 1; i++) {
        const dx = x[i + 1] - x[i];
        const dy = y[i + 1] - y[i];
        const d = Math.hypot(dx, dy) || 0.0001;
        if (d <= rest) continue;
        const diff = (d - rest) / d / 2;
        const ox = dx * diff;
        const oy = dy * diff;
        if (i > 0) {
          x[i] += ox;
          y[i] += oy;
        }
        if (i + 1 < POINTS - 1) {
          x[i + 1] -= ox;
          y[i + 1] -= oy;
        }
      }
    }
    x[0] = ax;
    y[0] = ay;
    x[POINTS - 1] = bx;
    y[POINTS - 1] = by;
  }

  draw(layer: Layer, color: number): void {
    for (let i = 0; i < POINTS - 1; i++) layer.line(this.x[i], this.y[i], this.x[i + 1], this.y[i + 1], color);
  }
}
