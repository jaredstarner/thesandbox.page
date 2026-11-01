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
    kappa: lerp(0.003, 0.003 + 0.03 * v, 1 - f),
    mu: lerp(0.04, 0.1, f),
    gamma: 0.00005,
    sigma: 0.00001,
  };
}

export const clampWeather = (w: Weather): Weather => ({
  t: Math.min(T_WARM, Math.max(T_COLD, w.t)),
  v: clamp01(w.v),
});

/** A crystal blown about inside the cloud: it eases toward a new spot every few minutes of
 * its fall. Deterministic for a seed, and measured in updates, not wall time. */
export class Drift {
  private target: Weather;
  private next: number;
  private s: number;

  constructor(seed: number, from: Weather) {
    this.s = seed >>> 0 || 1;
    this.target = from;
    this.next = 0;
  }

  private rand(): number {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Advance `steps` updates from `w` at update `time`. */
  step(w: Weather, time: number, steps: number): Weather {
    if (time >= this.next) {
      // A new layer of the cloud: mostly a modest move, now and then a long one.
      const far = this.rand() < 0.25;
      const reach = far ? 1 : 0.45;
      this.target = clampWeather({
        t: w.t + (this.rand() * 2 - 1) * 10 * reach,
        v: w.v + (this.rand() * 2 - 1) * reach,
      });
      this.next = time + 2500 + this.rand() * 4500;
    }
    const k = 1 - Math.exp(-steps / 1600);
    return { t: lerp(w.t, this.target.t, k), v: lerp(w.v, this.target.v, k) };
  }
}
