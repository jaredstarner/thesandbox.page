// The dish, its fluid, and the fields on it. Pure TS with no DOM, so the
// worker runs it and a Node bench can too.
//
// Two coupled models share one square domain DOMAIN mm across, centred on the
// dish:
//   - Bulk: where the fluid is. A viscous thin layer on a coarse grid flows
//     down the gradient of p = bed + depth - head, where the head is the
//     magnetic pressure in millimetres of fluid. A uniform field pulls nowhere;
//     a magnet under the dish pulls the pool into a mound over it.
//   - Pattern: the spikes. A Swift-Hohenberg field u on a fine grid, solved
//     spectrally, with a quadratic term so hexagons come first and hold on
//     below onset, and a nonlocal cubic term that favours squares once the
//     spikes are tall. Its growth rate at each point follows the local field.

import { FFT2 } from './_fft';

export const N = 256;
export const DOMAIN = 128;
export const DX = DOMAIN / N;
export const NB = 64;
export const DXB = DOMAIN / NB;

/** Inner profile of the porcelain dish: a flat floor, a round fillet, the rim. */
export const DISH = { floor: 40, fillet: 18, rim: 58, lip: 62.5, foot: 44, height: 20 } as const;

export function bed(r: number): number {
  if (r <= DISH.floor) return 0;
  const t = r - DISH.floor;
  if (t >= DISH.fillet) return DISH.fillet + (t - DISH.fillet) * 4;
  return DISH.fillet - Math.sqrt(DISH.fillet * DISH.fillet - t * t);
}

/** APG 512A, the fluid Gollwitzer, Rehberg, and Richter measured. */
export const FLUID = { rho: 1236, sigma: 0.0306, chi: 1.17, ms: 28700 } as const;
/** Measured onset of the spikes in a uniform field, mT. */
export const BC = 16.7;
/** Capillary wavenumber sqrt(rho g / sigma), per mm: about 10 mm between rows. */
export const KC = Math.sqrt((FLUID.rho * 9.81) / FLUID.sigma) / 1000;

/** The coil's field across the dish, as a fraction of its centre value. */
export function coilProfile(r: number): number {
  const q = r / 50;
  return 1 - 0.035 * q * q;
}

export interface Magnet {
  x: number;
  y: number;
  /** 0 far below the dish, 1 pressed against its foot. */
  lift: number;
}

const MAG_NEAR = 22;
const MAG_FAR = 60;
/** Field on the magnet's axis at the fluid when pressed against the dish, mT. */
const MAG_B0 = 70;

/** Dipole strength for the renderer: B on axis at depth z is 2 MAGNET_K / z^3. */
export const MAGNET_K = (MAG_B0 * MAG_NEAR * MAG_NEAR * MAG_NEAR) / 2;

export function magnetDepth(lift: number): number {
  return MAG_FAR + (MAG_NEAR - MAG_FAR) * lift;
}

/** Field of the hand magnet (a dipole under the dish) at (x, y) on the floor, mT: [bx, by, bz]. */
export function magnetField(m: Magnet, x: number, y: number, out: Float64Array) {
  const z = magnetDepth(m.lift);
  const dx = x - m.x;
  const dy = y - m.y;
  const r2 = dx * dx + dy * dy + z * z;
  const r = Math.sqrt(r2);
  // B on axis at distance z is 2k / z^3; scale so the pressed magnet gives MAG_B0.
  const k = (MAG_B0 * MAG_NEAR * MAG_NEAR * MAG_NEAR) / 2;
  const f = k / (r2 * r);
  const c = (3 * z) / r2;
  out[0] = f * c * dx;
  out[1] = f * c * dy;
  out[2] = f * ((3 * z * z) / r2 - 1);
}

/** Magnetic pressure head in mm of fluid for a field of b mT, with the fluid saturating. */
export function head(b: number): number {
  const h = (b / 1000 / (4e-7 * Math.PI)) * FLUID.chi;
  const x = h / FLUID.ms;
  // ln cosh(x), stable for large x.
  const lc = x > 12 ? x - Math.LN2 : Math.log(Math.cosh(x));
  return HEAD_SCALE * lc;
}
// mu0 Ms^2 / (chi rho g) in mm is about 71; the effective scale is smaller,
// since the fluid's own magnetization weakens the field inside it and surface
// tension holds a mound together.
const HEAD_SCALE = 20;

// ---------------------------------------------------------------- pattern

export interface PatternParams {
  /** Quadratic coefficient: hexagons, and their hold below onset. */
  g2: number;
  /** Depth of the cubic kernel's notch at sqrt(2) k0: squares. */
  notch: number;
  notchWidth: number;
  /** Kernel at 2 k0, above 1 to penalize rolls, which ferrofluid never makes. */
  harmonic: number;
}

export const PATTERN: PatternParams = { g2: 1.0, notch: 0.45, notchWidth: 0.16, harmonic: 1.6 };

export class Pattern {
  readonly u = new Float64Array(N * N);
  private readonly w = new Float64Array(N * N);
  private readonly re = new Float64Array(N * N);
  private readonly im = new Float64Array(N * N);
  private readonly ka = new Float64Array(N * N);
  private readonly kb = new Float64Array(N * N);
  private readonly fft = new FFT2(N);
  private dt = 0;
  private c = 0;
  private key = '';
  private rand: () => number;
  params: PatternParams;

  constructor(seed: number, params: PatternParams = PATTERN) {
    this.rand = mulberry(seed);
    this.params = params;
  }

  /** k0 in radians per cell. */
  setScale(k0: number, dt: number, c: number) {
    const { notch, notchWidth, harmonic } = this.params;
    const key = `${k0.toFixed(4)}|${dt}|${c}|${notch.toFixed(2)}|${notchWidth}|${harmonic}`;
    if (key === this.key) return;
    this.key = key;
    this.dt = dt;
    this.c = c;
    for (let j = 0; j < N; j++) {
      const fy = j < N / 2 ? j : j - N;
      for (let i = 0; i < N; i++) {
        const fx = i < N / 2 ? i : i - N;
        const k = ((2 * Math.PI) / N) * Math.hypot(fx, fy);
        const q = k / k0;
        const l = 1 - q * q;
        const lin = -l * l;
        const idx = j * N + i;
        const d = (q - Math.SQRT2) / notchWidth;
        const e = (q - 2) / 0.2;
        this.ka[idx] = 1 - notch * Math.exp(-d * d) + (harmonic - 1) * Math.exp(-e * e);
        this.kb[idx] = 1 / (1 + dt * (c - lin));
      }
    }
  }

  /** One semi-implicit step with growth rate r per cell (r <= c). */
  step(r: Float64Array, noise: number) {
    const { u, w, re, im, ka, kb } = this;
    const dt = this.dt;
    const c = this.c;
    const g2 = this.params.g2;
    for (let i = 0; i < N * N; i++) {
      const v = u[i];
      re[i] = v * v;
      let x = v + dt * ((r[i] + c) * v + g2 * v * v - v * w[i]);
      if (noise > 0 && r[i] > -1) x += noise * (this.rand() - 0.5);
      im[i] = x;
    }
    this.fft.transform(re, im, false);
    // Unpack the two real signals' spectra, filter each by its own even
    // kernel, and pack them again: u squared through the cubic kernel, u
    // through the implicit linear operator.
    for (let j = 0; j < N; j++) {
      const jn = (N - j) % N;
      for (let i = 0; i < N; i++) {
        const p = j * N + i;
        const q = jn * N + ((N - i) % N);
        if (q < p) continue;
        const a = ka[p];
        const b = kb[p];
        if (q === p) {
          re[p] *= a;
          im[p] *= b;
          continue;
        }
        const pr = re[p];
        const pi = im[p];
        const qr = re[q];
        const qi = im[q];
        const ar = 0.5 * (pr + qr) * a;
        const ai = 0.5 * (pi - qi) * a;
        const br = 0.5 * (pi + qi) * b;
        const bi = -0.5 * (pr - qr) * b;
        re[p] = ar - bi;
        im[p] = ai + br;
        re[q] = ar + bi;
        im[q] = -ai + br;
      }
    }
    this.fft.transform(re, im, true);
    for (let i = 0; i < N * N; i++) {
      w[i] = re[i];
      u[i] = im[i];
    }
  }

  clear() {
    this.u.fill(0);
    this.w.fill(0);
  }
}

// ---------------------------------------------------------------- bulk

export class Bulk {
  readonly d = new Float64Array(NB * NB);
  readonly b = new Float64Array(NB * NB);
  readonly m = new Float64Array(NB * NB);
  readonly inside = new Uint8Array(NB * NB);
  private readonly flux = new Float64Array(NB * NB);
  volume = 0;
  /** Mobility: how fast the pool flows, mm/s per mm of depth. */
  static D = 60;

  constructor(depth: number) {
    for (let j = 0; j < NB; j++) {
      for (let i = 0; i < NB; i++) {
        const x = (i + 0.5) * DXB - DOMAIN / 2;
        const y = (j + 0.5) * DXB - DOMAIN / 2;
        const r = Math.hypot(x, y);
        const k = j * NB + i;
        this.b[k] = bed(r);
        this.inside[k] = r < DISH.rim - 1 ? 1 : 0;
      }
    }
    this.fill(depth);
  }

  /** Pour to a level `depth` mm above the floor. */
  fill(depth: number) {
    let v = 0;
    for (let k = 0; k < NB * NB; k++) {
      this.d[k] = this.inside[k] ? Math.max(0, depth - this.b[k]) : 0;
      v += this.d[k];
    }
    this.volume = v;
  }

  step(dt: number) {
    const { d, b, m, inside, flux } = this;
    const D = Bulk.D;
    let left = dt;
    let guard = 0;
    while (left > 1e-9 && guard++ < 400) {
      let dmax = 0.5;
      for (let k = 0; k < NB * NB; k++) if (d[k] > dmax) dmax = d[k];
      const h = Math.min(left, (0.2 * DXB * DXB) / (D * dmax));
      left -= h;
      flux.fill(0);
      const s = (D * h) / (DXB * DXB);
      for (let j = 0; j < NB; j++) {
        for (let i = 0; i < NB; i++) {
          const k = j * NB + i;
          if (!inside[k]) continue;
          const pk = b[k] + d[k] - m[k];
          // East and north faces; each face once.
          if (i + 1 < NB && inside[k + 1]) {
            const pn = b[k + 1] + d[k + 1] - m[k + 1];
            const up = pk > pn ? d[k] : d[k + 1];
            const f = s * up * (pk - pn);
            flux[k] -= f;
            flux[k + 1] += f;
          }
          if (j + 1 < NB && inside[k + NB]) {
            const pn = b[k + NB] + d[k + NB] - m[k + NB];
            const up = pk > pn ? d[k] : d[k + NB];
            const f = s * up * (pk - pn);
            flux[k] -= f;
            flux[k + NB] += f;
          }
        }
      }
      for (let k = 0; k < NB * NB; k++) {
        const v = d[k] + flux[k];
        d[k] = v > 0 ? v : 0;
      }
    }
    // Hold the volume exactly; clipping at zero can gain a little.
    let v = 0;
    for (let k = 0; k < NB * NB; k++) v += d[k];
    if (v > 0) {
      const f = this.volume / v;
      for (let k = 0; k < NB * NB; k++) d[k] *= f;
    }
  }
}

// ---------------------------------------------------------------- lattice

export interface Spike {
  x: number;
  y: number;
  /** Height above the surrounding pool, mm. */
  h: number;
  /** 6: hexagonal neighbourhood, 4: square, 5: a defect (five or seven neighbours), 0: an edge. */
  kind: number;
}

export interface LatticeStats {
  count: number;
  hex: number;
  square: number;
  defect: number;
  /** Median distance to the nearest spike, mm. */
  spacing: number;
}

/**
 * Find spike tips as local maxima of u above `floor`, and classify each by its
 * neighbours: six at about the same distance and sixfold bond order is a
 * hexagonal neighbourhood, four with fourfold order is square.
 */
export function findSpikes(u: Float64Array, floor: number, wrap: boolean, heightOf?: (i: number) => number): Spike[] {
  const spikes: Spike[] = [];
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      const v = u[k];
      if (v < floor) continue;
      if (
        v < u[k - 1] ||
        v <= u[k + 1] ||
        v < u[k - N] ||
        v <= u[k + N] ||
        v < u[k - N - 1] ||
        v <= u[k + N + 1] ||
        v < u[k - N + 1] ||
        v <= u[k + N - 1]
      )
        continue;
      // Parabola through the neighbours for a sub-cell tip.
      const ox = parabola(u[k - 1], v, u[k + 1]);
      const oy = parabola(u[k - N], v, u[k + N]);
      spikes.push({
        x: (i + 0.5 + ox) * DX - DOMAIN / 2,
        y: (j + 0.5 + oy) * DX - DOMAIN / 2,
        h: heightOf ? heightOf(k) : v,
        kind: 0,
      });
    }
  }
  classify(spikes, wrap);
  return spikes;
}

function parabola(a: number, b: number, c: number): number {
  const den = a - 2 * b + c;
  if (den >= 0) return 0;
  return Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
}

function classify(spikes: Spike[], wrap: boolean) {
  const n = spikes.length;
  if (n < 3) return;
  const nearest = new Float64Array(n).fill(Infinity);
  const delta = (a: Spike, b: Spike): [number, number] => {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (wrap) {
      if (dx > DOMAIN / 2) dx -= DOMAIN;
      else if (dx < -DOMAIN / 2) dx += DOMAIN;
      if (dy > DOMAIN / 2) dy -= DOMAIN;
      else if (dy < -DOMAIN / 2) dy += DOMAIN;
    }
    return [dx, dy];
  };
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const [dx, dy] = delta(spikes[a], spikes[b]);
      const d = Math.hypot(dx, dy);
      if (d < nearest[a]) nearest[a] = d;
      if (d < nearest[b]) nearest[b] = d;
    }
  }
  for (let a = 0; a < n; a++) {
    const cut = nearest[a] * 1.25;
    let count = 0;
    let c4 = 0;
    let s4 = 0;
    let c6 = 0;
    let s6 = 0;
    for (let b = 0; b < n; b++) {
      if (b === a) continue;
      const [dx, dy] = delta(spikes[a], spikes[b]);
      const d = Math.hypot(dx, dy);
      if (d > cut) continue;
      count++;
      const t = Math.atan2(dy, dx);
      c4 += Math.cos(4 * t);
      s4 += Math.sin(4 * t);
      c6 += Math.cos(6 * t);
      s6 += Math.sin(6 * t);
    }
    if (count === 0) continue;
    const psi4 = Math.hypot(c4, s4) / count;
    const psi6 = Math.hypot(c6, s6) / count;
    if (count === 6 && psi6 > 0.6) spikes[a].kind = 6;
    else if (count === 4 && psi4 > 0.6) spikes[a].kind = 4;
    else if (count === 5 || count === 7 || (count === 6 && psi6 <= 0.6)) spikes[a].kind = 5;
  }
}

export function latticeStats(spikes: Spike[], wrap: boolean): LatticeStats {
  let hex = 0;
  let square = 0;
  let defect = 0;
  for (const s of spikes) {
    if (s.kind === 6) hex++;
    else if (s.kind === 4) square++;
    else if (s.kind === 5) defect++;
  }
  const near: number[] = [];
  for (let a = 0; a < spikes.length; a++) {
    let best = Infinity;
    for (let b = 0; b < spikes.length; b++) {
      if (a === b) continue;
      let dx = spikes[b].x - spikes[a].x;
      let dy = spikes[b].y - spikes[a].y;
      if (wrap) {
        if (dx > DOMAIN / 2) dx -= DOMAIN;
        else if (dx < -DOMAIN / 2) dx += DOMAIN;
        if (dy > DOMAIN / 2) dy -= DOMAIN;
        else if (dy < -DOMAIN / 2) dy += DOMAIN;
      }
      best = Math.min(best, Math.hypot(dx, dy));
    }
    if (best < Infinity) near.push(best);
  }
  near.sort((a, b) => a - b);
  return { count: spikes.length, hex, square, defect, spacing: near.length ? near[near.length >> 1] : 0 };
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- the dish

/** Growth rate per unit of supercriticality, above and below onset. */
const KAPPA = 0.5;
const KAPPA_BELOW = 0.3;
const R_MAX = 1;
const R_DRY = -2.5;
/** Pattern time units per second. */
const PATTERN_RATE = 14;
const PATTERN_DT = 0.3;
/** Spike height in mm per unit of u (on its sharpened positive part). */
const SPIKE_MM = 3;

export interface Inputs {
  /** Coil setting, mT at the centre of the dish. */
  coil: number;
  /** Where the hand is under the dish, mm, and whether it is pressed up. */
  hand: { x: number; y: number; down: boolean } | null;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Dish {
  readonly pattern: Pattern;
  readonly bulk: Bulk;
  readonly bedFine = new Float64Array(N * N);
  readonly rho = new Float64Array(N * N);
  readonly dFine = new Float64Array(N * N);
  readonly field = new Float64Array(N * N);
  private readonly r = new Float64Array(N * N);
  private readonly bv = new Float64Array(3);
  /** The coil's actual field, following the setting through its inductance. */
  coil = 0;
  magnet: Magnet = { x: 0, y: 0, lift: 0 };
  private owed = 0;
  steps = 0;

  constructor(seed: number, depth = 4.5) {
    this.pattern = new Pattern(seed);
    this.bulk = new Bulk(depth);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = (i + 0.5) * DX - DOMAIN / 2;
        const y = (j + 0.5) * DX - DOMAIN / 2;
        const r = Math.hypot(x, y);
        this.rho[j * N + i] = r;
        this.bedFine[j * N + i] = bed(Math.min(r, DISH.rim + 2));
      }
    }
  }

  /** Field magnitude at the floor, mT. */
  fieldAt(x: number, y: number, r: number): number {
    const bz0 = this.coil * coilProfile(r);
    if (this.magnet.lift <= 0.002) return Math.abs(bz0);
    magnetField(this.magnet, x, y, this.bv);
    const bx = this.bv[0] * this.magnet.lift;
    const by = this.bv[1] * this.magnet.lift;
    const bz = bz0 + this.bv[2] * this.magnet.lift;
    return Math.sqrt(bx * bx + by * by + bz * bz);
  }

  advance(dt: number, inputs: Inputs) {
    // The coil ramps with an L/R time constant of about 0.12 s.
    this.coil += (inputs.coil - this.coil) * (1 - Math.exp(-dt / 0.12));
    const m = this.magnet;
    if (inputs.hand) {
      const k = 1 - Math.exp(-dt / 0.06);
      m.x += (inputs.hand.x - m.x) * k;
      m.y += (inputs.hand.y - m.y) * k;
    }
    const target = inputs.hand?.down ? 1 : 0;
    const rate = target > m.lift ? 4.5 : 3;
    m.lift = target > m.lift ? Math.min(target, m.lift + rate * dt) : Math.max(target, m.lift - rate * dt);

    // Bulk: the head from the field at each coarse cell, then flow.
    const bulk = this.bulk;
    for (let j = 0; j < NB; j++) {
      for (let i = 0; i < NB; i++) {
        const x = (i + 0.5) * DXB - DOMAIN / 2;
        const y = (j + 0.5) * DXB - DOMAIN / 2;
        bulk.m[j * NB + i] = head(this.fieldAt(x, y, Math.hypot(x, y)));
      }
    }
    bulk.step(dt);
    this.upsample();

    // Pattern: growth rate from the local field and depth.
    const eCoil = (this.coil / BC) ** 2 - 1;
    const k0 = KC * DX * (1 - 0.05 * Math.max(0, Math.min(2, eCoil)));
    this.pattern.params = { ...PATTERN, notch: 0.45 + 0.47 * smooth(20, 27, this.coil) };
    this.pattern.setScale(k0, PATTERN_DT, 3);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const rr = this.rho[k];
        const d = this.dFine[k];
        if (rr > DISH.rim || d < 0.05) {
          this.r[k] = R_DRY;
          this.field[k] = 0;
          continue;
        }
        const x = (i + 0.5) * DX - DOMAIN / 2;
        const y = (j + 0.5) * DX - DOMAIN / 2;
        const b = this.fieldAt(x, y, rr);
        this.field[k] = b;
        // A thin layer needs a stronger field before it stands up.
        const s = (1 - Math.exp(-d / 1.2)) / 0.9765;
        const e = (b / BC) ** 2 * s - 1;
        let g = e < 0 ? KAPPA_BELOW * e : KAPPA * e;
        if (g > R_MAX) g = R_MAX;
        const wet = smooth(0.05, 0.6, d);
        this.r[k] = R_DRY + (g - R_DRY) * wet;
      }
    }
    this.owed += dt * PATTERN_RATE;
    let n = 0;
    while (this.owed >= PATTERN_DT && n < 3) {
      this.pattern.step(this.r, 0.004);
      this.owed -= PATTERN_DT;
      this.steps++;
      n++;
    }
    if (this.owed > PATTERN_DT) this.owed = PATTERN_DT;
  }

  private upsample() {
    const d = this.bulk.d;
    for (let j = 0; j < N; j++) {
      const gy = ((j + 0.5) * DX) / DXB - 0.5;
      const j0 = Math.max(0, Math.min(NB - 2, Math.floor(gy)));
      const fy = Math.max(0, Math.min(1, gy - j0));
      for (let i = 0; i < N; i++) {
        const gx = ((i + 0.5) * DX) / DXB - 0.5;
        const i0 = Math.max(0, Math.min(NB - 2, Math.floor(gx)));
        const fx = Math.max(0, Math.min(1, gx - i0));
        const a = d[j0 * NB + i0];
        const b = d[j0 * NB + i0 + 1];
        const c = d[(j0 + 1) * NB + i0];
        const e = d[(j0 + 1) * NB + i0 + 1];
        const v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
        // Keep the fluid off the rim.
        this.dFine[j * N + i] = this.rho[j * N + i] > DISH.rim ? 0 : v;
      }
    }
  }

  /** Spike height above the bulk surface for a cell, mm. */
  spikeAt(k: number): number {
    const u = this.pattern.u[k];
    const d = this.dFine[k];
    const avail = smooth(0, 2.5, d);
    const s = u > 0 ? Math.pow(u, 1.15) : 0.45 * u;
    const h = SPIKE_MM * s * avail;
    return Math.max(h, -0.85 * d);
  }

  /** Interleaved [surface height above the floor, bulk depth] for every fine cell. */
  compose(out: Float32Array) {
    for (let k = 0; k < N * N; k++) {
      const d = this.dFine[k];
      out[2 * k] = this.bedFine[k] + d + this.spikeAt(k);
      out[2 * k + 1] = d;
    }
  }

  /** Spike tips, each with `top`, the surface height there above the floor. */
  spikes(): (Spike & { top: number })[] {
    let max = 0;
    const u = this.pattern.u;
    for (let k = 0; k < N * N; k++) if (u[k] > max && this.dFine[k] > 0.3) max = u[k];
    if (max < 0.15) return [];
    const list = findSpikes(u, Math.max(0.12, max * 0.35), false, (k) => this.spikeAt(k));
    return list
      .filter((s) => s.h > 0.4)
      .map((s) => {
        const i = Math.max(0, Math.min(N - 1, Math.floor((s.x + DOMAIN / 2) / DX)));
        const j = Math.max(0, Math.min(N - 1, Math.floor((s.y + DOMAIN / 2) / DX)));
        const k = j * N + i;
        return { ...s, top: this.bedFine[k] + this.dFine[k] + this.spikeAt(k) };
      });
  }
}
