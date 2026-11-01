// The cloud: a temperature from -10 to -20 °C and a vapour level, turned into the model's
// parameters. The paper's crystals cover this temperature band, where snow grows as thin
// plates, and its Nakaya diagram puts the fastest, most branched growth near -15 °C in the
// wettest air, with faceted plates toward either edge and in drier air. The placement of the
// paper's parameter families on that chart is this page's own.

import type { Params } from './_lattice';

export interface Weather {
  /** Temperature, °C, from -10 to -20. */
  t: number;
  /** Vapour, 0 (driest) to 1 (wettest). */
  v: number;
}

export const T_WARM = -10;
export const T_COLD = -20;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** How far toward faceted growth a temperature sits: 0 at -15 °C, 1 at -10 or -20 °C. */
export const facet = (t: number) => clamp01(Math.abs(t + 15) / 5);

export function paramsAt(w: Weather): Params {
  const f = facet(w.t);
  const v = clamp01(w.v);
  return {
    rho: lerp(0.38, 0.58, v),
    beta: lerp(1.3, 1.55, f),
    alpha: 0.08,
    theta: 0.025,
    kappa: 0.003 + 0.014 * v * (1 - f) * (1 - f),
    mu: lerp(0.04, 0.1, f),
    gamma: 0.00005,
    sigma: 0.00001,
  };
}

export const clampWeather = (w: Weather): Weather => ({
  t: Math.min(T_WARM, Math.max(T_COLD, w.t)),
  v: clamp01(w.v),
});

/** A crystal blown about inside the cloud: every few seconds it heads for a new spot, carried
 * there on a damped spring with a little turbulence, so its path curves and wanders. Measured
 * in seconds on screen, since the page paces growth to look even. */
export class Drift {
  private target: Weather;
  private wait = 0;
  private s: number;
  private vt = 0;
  private vv = 0;

  constructor(seed: number, from: Weather) {
    this.s = seed >>> 0 || 1;
    this.target = from;
  }

  private rand(): number {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Advance `seconds` from `w`. */
  step(w: Weather, seconds: number): Weather {
    this.wait -= seconds;
    if (this.wait <= 0) {
      // A new layer of the cloud: mostly a modest move, now and then a long one, toward a
      // spot inside the chart that leans to the wetter, more branched air near -15 °C.
      const reach = this.rand() < 0.25 ? 0.9 : 0.4;
      const spot = { t: -15 + (this.rand() - 0.5) * 8.6, v: 0.06 + 0.9 * Math.pow(this.rand(), 0.7) };
      this.target = clampWeather({ t: lerp(w.t, spot.t, reach), v: lerp(w.v, spot.v, reach) });
      this.wait = 3.5 + this.rand() * 5;
    }
    const dt = Math.min(seconds, 0.1);
    const kick = Math.sqrt(dt);
    this.vt += ((this.target.t - w.t) * 1.4 - this.vt * 2) * dt + (this.rand() - 0.5) * 2.5 * kick;
    this.vv += ((this.target.v - w.v) * 1.4 - this.vv * 2) * dt + (this.rand() - 0.5) * 0.25 * kick;
    const next = clampWeather({ t: w.t + this.vt * dt, v: w.v + this.vv * dt });
    if (next.t !== w.t + this.vt * dt) this.vt = 0;
    if (next.v !== w.v + this.vv * dt) this.vv = 0;
    return next;
  }
}
