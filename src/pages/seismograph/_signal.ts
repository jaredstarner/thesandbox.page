// The station's trace as one continuous, filtered day: records are stitched
// onto a grid of whole seconds, gaps stay NaN, and a high-pass filter strips
// the tides and drift so what's left is ground shaking.

import type { Chunk } from './_mseed';

export class Trace {
  /** Epoch ms of sample 0; always a whole second. */
  readonly t0: number;
  readonly values: Float32Array;
  /** Index one past the newest sample written. */
  end = 0;
  private x1 = NaN;
  private x2 = NaN;
  private y1 = 0;
  private y2 = 0;
  private last = -1;
  private readonly b: [number, number, number];
  private readonly a: [number, number];

  constructor(t0: number, seconds: number, cornerHz = 1 / 150) {
    this.t0 = t0;
    this.values = new Float32Array(seconds).fill(NaN);
    // Two-pole Butterworth high-pass at 1 sample per second (RBJ biquad).
    const w = 2 * Math.PI * cornerHz;
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    this.b = [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0];
    this.a = [(-2 * cos) / a0, (1 - alpha) / a0];
  }

  get length(): number {
    return this.values.length;
  }

  /** Epoch ms just past the newest sample. */
  get endTime(): number {
    return this.t0 + this.end * 1000;
  }

  /** Adds records in time order; returns the index of the first new sample, or -1. */
  add(records: Chunk[]): number {
    let first = -1;
    const sorted = records.filter((r) => r.rate === 1).sort((a, b) => a.start - b.start);
    for (const r of sorted) {
      const i0 = Math.round((r.start - this.t0) / 1000);
      for (let k = 0; k < r.samples.length; k++) {
        const i = i0 + k;
        if (i <= this.last || i < 0) continue;
        if (i >= this.values.length) break;
        if (i !== this.last + 1) this.reset();
        this.values[i] = this.filter(r.samples[k]);
        this.last = i;
        if (first < 0) first = i;
      }
    }
    this.end = this.last + 1;
    return first;
  }

  private reset(): void {
    this.x1 = this.x2 = NaN;
    this.y1 = this.y2 = 0;
  }

  private filter(x: number): number {
    // Start each run as if it had sat at its first value forever, so a gap
    // doesn't ring like a step.
    if (Number.isNaN(this.x1)) this.x1 = this.x2 = x;
    const [b0, b1, b2] = this.b;
    const [a1, a2] = this.a;
    const y = b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  /** A robust noise level (counts): the median absolute value, which a few quakes barely move. */
  noise(): number {
    const pick: number[] = [];
    const step = Math.max(1, Math.floor(this.end / 20000));
    for (let i = 0; i < this.end; i += step) {
      const v = this.values[i];
      if (!Number.isNaN(v)) pick.push(Math.abs(v));
    }
    if (!pick.length) return 1;
    pick.sort((a, b) => a - b);
    return Math.max(1, pick[Math.floor(pick.length / 2)]);
  }

  /** Peak absolute value (counts) between two epoch times. */
  peak(from: number, to: number): number {
    const a = Math.max(0, Math.floor((from - this.t0) / 1000));
    const b = Math.min(this.end, Math.ceil((to - this.t0) / 1000));
    let m = 0;
    for (let i = a; i < b; i++) {
      const v = Math.abs(this.values[i]);
      if (v > m) m = v;
    }
    return m;
  }
}
