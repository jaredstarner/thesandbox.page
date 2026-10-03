// An idealised square plate with free edges, bolted at the centre, and the sand on it.

/**
 * One standing wave: the degenerate pair (n, m) and (m, n) mixed with a sign,
 *   cos(nπx)·cos(mπy) ± cos(mπx)·cos(nπy)
 * over the unit square. Every mode kept here is still at the centre, where the bolt is.
 */
export interface Mode {
  n: number;
  m: number;
  sign: 1 | -1;
  freq: number;
}

export const MIN_FREQ = 50;
export const MAX_FREQ = 1400;

/** Hz per unit of n² + m²; a real plate's frequencies grow with n² + m² too. */
const HZ_PER_UNIT = 11;
const MAX_ORDER = 8;
/** The + twin rings slightly higher, as it does on a real, imperfect plate. */
const TWIN_SHIFT = 1.035;
/** Quality factor: how sharp each resonance is. */
const Q = 90;

export const modes: Mode[] = (() => {
  const list: Mode[] = [];
  for (let n = 2; n <= MAX_ORDER; n++) {
    for (let m = 1; m < n; m++) {
      const freq = HZ_PER_UNIT * (n * n + m * m);
      list.push({ n, m, sign: -1, freq });
      // With both orders even, the + mode moves at the centre; the bolt forbids it.
      if (n % 2 === 1 || m % 2 === 1) list.push({ n, m, sign: 1, freq: freq * TWIN_SHIFT });
    }
  }
  return list.sort((a, b) => a.freq - b.freq);
})();

/** How strongly a mode answers a drive at freq: a Lorentzian peak, 1 at resonance. */
export function response(mode: Mode, freq: number): number {
  const d = (freq - mode.freq) / (mode.freq / Q);
  return 1 / (1 + d * d);
}

export class Plate {
  /** |displacement| per grid cell, scaled by how hard the plate is driven. */
  readonly field: Float32Array;
  /** The mode answering loudest, and how loudly (0 to 1). */
  strongest: Mode | null = null;
  resonance = 0;

  private readonly signed: Float32Array;
  private readonly cos: Float32Array[] = [];

  constructor(readonly grid = 192) {
    this.field = new Float32Array(grid * grid);
    this.signed = new Float32Array(grid * grid);
    for (let n = 0; n <= MAX_ORDER; n++) {
      const row = new Float32Array(grid);
      for (let i = 0; i < grid; i++) row[i] = Math.cos((n * Math.PI * i) / (grid - 1));
      this.cos.push(row);
    }
  }

  /** Drive the plate at freq; drive is 0 (still) to 1 (full). */
  tune(freq: number, drive: number): void {
    const { grid, cos, signed, field } = this;
    signed.fill(0);
    this.strongest = null;
    this.resonance = 0;

    for (const mode of modes) {
      const weight = response(mode, freq);
      if (weight < 0.01) continue;
      if (weight > this.resonance) {
        this.resonance = weight;
        this.strongest = mode;
      }
      const cn = cos[mode.n]!;
      const cm = cos[mode.m]!;
      for (let y = 0; y < grid; y++) {
        const a = cm[y]! * weight;
        const b = cn[y]! * weight * mode.sign;
        const row = y * grid;
        for (let x = 0; x < grid; x++) signed[row + x]! += cn[x]! * a + cm[x]! * b;
      }
    }

    for (let i = 0; i < field.length; i++) field[i] = Math.abs(signed[i]!) * drive;
  }
}

/** Random kick per frame at full amplitude, in plate widths. */
const JITTER = 0.02;
/** Drift down the slope of the vibration, toward the still lines. */
const PULL = 0.0002;

export class Sand {
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** A shade per grain, so the sand isn't flat. */
  readonly shade: Uint8Array;
  private next = 0;

  constructor(readonly count: number) {
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.shade = new Uint8Array(count);
    this.scatter();
  }

  scatter(): void {
    for (let i = 0; i < this.count; i++) {
      this.x[i] = Math.random();
      this.y[i] = Math.random();
      this.shade[i] = Math.floor(Math.random() * 4);
    }
  }

  /** Drop a handful at (u, v), reusing the oldest-poured grains. */
  pour(u: number, v: number, amount: number, radius: number): void {
    for (let k = 0; k < amount; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.count;
      const r = radius * Math.sqrt(Math.random());
      const t = Math.random() * Math.PI * 2;
      this.x[i] = clamp01(u + r * Math.cos(t));
      this.y[i] = clamp01(v + r * Math.sin(t));
    }
  }

  /** One frame: grains on moving plate get thrown, and roll toward the lines that stay still. */
  step(plate: Plate): void {
    const { grid, field } = plate;
    const last = grid - 1;
    const slope = last / 2;
    const { x, y } = this;

    for (let i = 0; i < this.count; i++) {
      const cx = Math.round(x[i]! * last);
      const cy = Math.round(y[i]! * last);
      const c = cy * grid + cx;
      const a = field[c]!;
      if (a < 0.002) continue;

      const gx = (field[cx < last ? c + 1 : c]! - field[cx > 0 ? c - 1 : c]!) * slope;
      const gy = (field[cy < last ? c + grid : c]! - field[cy > 0 ? c - grid : c]!) * slope;

      x[i] = bounce(x[i]! + (Math.random() - 0.5) * a * JITTER - gx * PULL);
      y[i] = bounce(y[i]! + (Math.random() - 0.5) * a * JITTER - gy * PULL);
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Reflect off the plate's rim. */
function bounce(v: number): number {
  return clamp01(v < 0 ? -v : v > 1 ? 2 - v : v);
}
