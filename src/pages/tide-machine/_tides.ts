// Harmonic tide prediction, the sum a Kelvin-type machine makes with pulleys:
//
//   h(t) = Z0 + sum of f * H * cos(V(t) + u(t) - G)
//
// H and G (amplitude and Greenwich phase lag) come from NOAA's harmonic constants for each station.
// V is the constituent's equilibrium argument, built from the mean longitudes of the moon and sun; f and u
// are the node factor and correction for the 18.6-year swing in the moon's orbit. Both follow Schureman's
// Manual of Harmonic Analysis and Prediction of Tides (1958), which is what NOAA's constants are referred to.

const RAD = Math.PI / 180;

/** Mean longitudes and the mean solar hour angle at Greenwich, in degrees. */
export interface Astro {
  /** Hour angle of the mean sun at Greenwich. */
  T: number;
  /** Moon. */
  s: number;
  /** Sun. */
  h: number;
  /** Lunar perigee. */
  p: number;
  /** Moon's ascending node. */
  N: number;
  /** Solar perigee. */
  p1: number;
}

/** Julian day number from a JavaScript time (ms since 1970, UTC). */
export function julianDay(ms: number): number {
  return ms / 86400000 + 2440587.5;
}

export function astro(ms: number): Astro {
  const jd = julianDay(ms);
  const c = (jd - 2451545.0) / 36525; // Julian centuries from J2000
  const frac = jd - Math.floor(jd); // 0 at noon UT, so 360 * frac is the mean sun's hour angle
  return {
    T: frac * 360,
    s: 218.3164477 + 481267.88123421 * c,
    h: 280.46646 + 36000.76983 * c,
    p: 83.3532465 + 4069.0137287 * c,
    N: 125.04452 - 1934.136261 * c,
    p1: 282.93768 + 1.71946 * c,
  };
}

/** Schureman's lunar orbit quantities, from the longitude of the node. Angles in degrees. */
export interface Nodal {
  I: number;
  nu: number;
  xi: number;
  nup: number;
  nupp2: number;
  P: number;
}

export function nodal(a: Astro): Nodal {
  const N = a.N * RAD;
  const I = Math.acos(0.9137 - 0.03569 * Math.cos(N));
  const nu = Math.asin((0.08884 * Math.sin(N)) / Math.sin(I));
  const xi = N - 2 * Math.atan(0.64412 * Math.tan(N / 2)) - nu;
  const nup = Math.atan2(Math.sin(2 * I) * Math.sin(nu), Math.sin(2 * I) * Math.cos(nu) + 0.3347);
  const nupp2 = Math.atan2(Math.sin(I) ** 2 * Math.sin(2 * nu), Math.sin(I) ** 2 * Math.cos(2 * nu) + 0.0727);
  return {
    I: I / RAD,
    nu: nu / RAD,
    xi: wrap180(xi / RAD),
    nup: nup / RAD,
    nupp2: nupp2 / RAD,
    P: a.p - wrap180(xi / RAD),
  };
}

function wrap180(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

/** Node factor and correction for the families of constituents. */
interface Factors {
  f: number;
  u: number;
}

function baseFactors(n: Nodal) {
  const I = n.I * RAD;
  const nu = n.nu * RAD;
  const sinI = Math.sin(I);
  const cosHalf = Math.cos(I / 2);
  const sinHalf = Math.sin(I / 2);
  const tanHalf = Math.tan(I / 2);
  const M2: Factors = { f: cosHalf ** 4 / 0.9154, u: 2 * n.xi - 2 * n.nu };
  const O1: Factors = { f: (sinI * cosHalf ** 2) / 0.38, u: 2 * n.xi - n.nu };
  const K1: Factors = {
    f: Math.sqrt(0.8965 * Math.sin(2 * I) ** 2 + 0.6001 * Math.sin(2 * I) * Math.cos(nu) + 0.1006),
    u: -n.nup,
  };
  const K2: Factors = {
    f: Math.sqrt(19.0444 * sinI ** 4 + 2.7702 * sinI ** 2 * Math.cos(2 * nu) + 0.0981),
    u: -n.nupp2,
  };
  const J1: Factors = { f: Math.sin(2 * I) / 0.7214, u: -n.nu };
  const OO1: Factors = { f: (sinI * sinHalf ** 2) / 0.0164, u: -2 * n.xi - n.nu };
  const Mm: Factors = { f: (2 / 3 - sinI ** 2) / 0.5021, u: 0 };
  const Mf: Factors = { f: sinI ** 2 / 0.1578, u: -2 * n.xi };
  const M3: Factors = { f: cosHalf ** 6 / 0.8758, u: 3 * n.xi - 3 * n.nu };
  // L2 carries the evection term through Ra and R.
  const P = n.P * RAD;
  const invRa = Math.sqrt(1 - 12 * tanHalf ** 2 * Math.cos(2 * P) + 36 * tanHalf ** 4);
  const R = Math.atan2(Math.sin(2 * P), (1 / 6) * (1 / tanHalf) ** 2 - Math.cos(2 * P)) / RAD;
  const L2: Factors = { f: M2.f * invRa, u: M2.u - R };
  // M1 is small everywhere (a centimetre or so); its correction Q follows Schureman, and its factor is
  // taken as O1's.
  const Q = Math.atan2((5 * Math.cos(I) - 1) * Math.sin(P), (7 * Math.cos(I) + 1) * Math.cos(P)) / RAD;
  const M1: Factors = { f: O1.f, u: n.xi - n.nu + Q };
  return { M2, O1, K1, K2, J1, OO1, Mm, Mf, M3, L2, M1 };
}

const ONE: Factors = { f: 1, u: 0 };

type Coeffs = [T: number, s: number, h: number, p: number, N: number, p1: number, offset: number];

/**
 * Each constituent: its argument as multiples of (T, s, h, p, N, p1) plus a constant, and how its node
 * factor is made from the families above. Speeds in degrees per mean solar hour come from NOAA's table
 * and match these coefficients.
 */
interface Def {
  v: Coeffs;
  factors: (b: ReturnType<typeof baseFactors>) => Factors;
  /** A short name for the rhythm, for labels. */
  label: string;
  family: 'long' | 'diurnal' | 'semidiurnal' | 'shallow';
}

const pow = (a: Factors, k: number): Factors => ({ f: a.f ** k, u: a.u * k });
const mul = (a: Factors, b: Factors): Factors => ({ f: a.f * b.f, u: a.u + b.u });
const conj = (a: Factors): Factors => ({ f: a.f, u: -a.u });

export const CONSTITUENTS: Record<string, Def> = {
  M2: { v: [2, -2, 2, 0, 0, 0, 0], factors: (b) => b.M2, label: 'Principal lunar', family: 'semidiurnal' },
  S2: { v: [2, 0, 0, 0, 0, 0, 0], factors: () => ONE, label: 'Principal solar', family: 'semidiurnal' },
  N2: { v: [2, -3, 2, 1, 0, 0, 0], factors: (b) => b.M2, label: 'Larger lunar elliptic', family: 'semidiurnal' },
  K1: { v: [1, 0, 1, 0, 0, 0, 270], factors: (b) => b.K1, label: 'Lunisolar diurnal', family: 'diurnal' },
  M4: { v: [4, -4, 4, 0, 0, 0, 0], factors: (b) => pow(b.M2, 2), label: 'Shallow water overtide', family: 'shallow' },
  O1: { v: [1, -2, 1, 0, 0, 0, 90], factors: (b) => b.O1, label: 'Lunar diurnal', family: 'diurnal' },
  M6: { v: [6, -6, 6, 0, 0, 0, 0], factors: (b) => pow(b.M2, 3), label: 'Shallow water overtide', family: 'shallow' },
  MK3: {
    v: [3, -2, 3, 0, 0, 0, 270],
    factors: (b) => mul(b.M2, b.K1),
    label: 'Shallow water terdiurnal',
    family: 'shallow',
  },
  S4: { v: [4, 0, 0, 0, 0, 0, 0], factors: () => ONE, label: 'Shallow water overtide', family: 'shallow' },
  MN4: {
    v: [4, -5, 4, 1, 0, 0, 0],
    factors: (b) => pow(b.M2, 2),
    label: 'Shallow water quarter diurnal',
    family: 'shallow',
  },
  NU2: { v: [2, -3, 4, -1, 0, 0, 0], factors: (b) => b.M2, label: 'Larger lunar evectional', family: 'semidiurnal' },
  S6: { v: [6, 0, 0, 0, 0, 0, 0], factors: () => ONE, label: 'Shallow water overtide', family: 'shallow' },
  MU2: { v: [2, -4, 4, 0, 0, 0, 0], factors: (b) => b.M2, label: 'Variational', family: 'semidiurnal' },
  '2N2': {
    v: [2, -4, 2, 2, 0, 0, 0],
    factors: (b) => b.M2,
    label: 'Lunar elliptical, second order',
    family: 'semidiurnal',
  },
  OO1: { v: [1, 2, 1, 0, 0, 0, 270], factors: (b) => b.OO1, label: 'Lunar diurnal', family: 'diurnal' },
  LAM2: { v: [2, -1, 0, 1, 0, 0, 180], factors: (b) => b.M2, label: 'Smaller lunar evectional', family: 'semidiurnal' },
  S1: { v: [1, 0, 0, 0, 0, 0, 180], factors: () => ONE, label: 'Solar diurnal', family: 'diurnal' },
  M1: { v: [1, -1, 1, 1, 0, 0, 90], factors: (b) => b.M1, label: 'Smaller lunar elliptic', family: 'diurnal' },
  J1: { v: [1, 1, 1, -1, 0, 0, 270], factors: (b) => b.J1, label: 'Smaller lunar elliptic', family: 'diurnal' },
  MM: { v: [0, 1, 0, -1, 0, 0, 0], factors: (b) => b.Mm, label: 'Lunar monthly', family: 'long' },
  SSA: { v: [0, 0, 2, 0, 0, 0, 0], factors: () => ONE, label: 'Solar semiannual', family: 'long' },
  SA: { v: [0, 0, 1, 0, 0, 0, 0], factors: () => ONE, label: 'Solar annual', family: 'long' },
  MSF: {
    v: [0, 2, -2, 0, 0, 0, 0],
    factors: (b) => conj(b.M2),
    label: 'Lunisolar synodic fortnightly',
    family: 'long',
  },
  MF: { v: [0, 2, 0, 0, 0, 0, 0], factors: (b) => b.Mf, label: 'Lunisolar fortnightly', family: 'long' },
  RHO: {
    v: [1, -3, 3, -1, 0, 0, 90],
    factors: (b) => b.O1,
    label: 'Larger lunar evectional diurnal',
    family: 'diurnal',
  },
  Q1: { v: [1, -3, 1, 1, 0, 0, 90], factors: (b) => b.O1, label: 'Larger lunar elliptic diurnal', family: 'diurnal' },
  T2: { v: [2, 0, -1, 0, 0, 1, 0], factors: () => ONE, label: 'Larger solar elliptic', family: 'semidiurnal' },
  R2: { v: [2, 0, 1, 0, 0, -1, 180], factors: () => ONE, label: 'Smaller solar elliptic', family: 'semidiurnal' },
  '2Q1': {
    v: [1, -4, 1, 2, 0, 0, 90],
    factors: (b) => b.O1,
    label: 'Lunar elliptic diurnal, second order',
    family: 'diurnal',
  },
  P1: { v: [1, 0, -1, 0, 0, 0, 90], factors: () => ONE, label: 'Solar diurnal', family: 'diurnal' },
  '2SM2': {
    v: [2, 2, -2, 0, 0, 0, 0],
    factors: (b) => conj(b.M2),
    label: 'Shallow water semidiurnal',
    family: 'shallow',
  },
  M3: { v: [3, -3, 3, 0, 0, 0, 0], factors: (b) => b.M3, label: 'Lunar terdiurnal', family: 'shallow' },
  L2: { v: [2, -1, 2, -1, 0, 0, 180], factors: (b) => b.L2, label: 'Smaller lunar elliptic', family: 'semidiurnal' },
  '2MK3': {
    v: [3, -4, 3, 0, 0, 0, 90],
    factors: (b) => mul(pow(b.M2, 2), conj(b.K1)),
    label: 'Shallow water terdiurnal',
    family: 'shallow',
  },
  K2: { v: [2, 0, 2, 0, 0, 0, 0], factors: (b) => b.K2, label: 'Lunisolar semidiurnal', family: 'semidiurnal' },
  M8: {
    v: [8, -8, 8, 0, 0, 0, 0],
    factors: (b) => pow(b.M2, 4),
    label: 'Shallow water eighth diurnal',
    family: 'shallow',
  },
  MS4: {
    v: [4, -2, 2, 0, 0, 0, 0],
    factors: (b) => b.M2,
    label: 'Shallow water quarter diurnal',
    family: 'shallow',
  },
};

/** One constituent as set on a station's machine. */
export interface Harmonic {
  name: string;
  /** Amplitude, metres. */
  amp: number;
  /** Greenwich phase lag, degrees. */
  phase: number;
  /** Degrees per hour. */
  speed: number;
}

/** A station's settings: its constituents and its mean sea level above chart datum (MLLW). */
export interface Station {
  z0: number;
  harmonics: Harmonic[];
}

/**
 * The state of every wheel at a moment: each constituent's effective amplitude (f * H) and its angle
 * (V + u - G), so a pulley's height is amp * cos(angle).
 */
export interface Wheel {
  name: string;
  amp: number;
  /** Degrees, unwrapped. */
  angle: number;
  /** Degrees per hour. */
  speed: number;
}

/** Node factors change over years, so cache them by day. */
const factorCache = new Map<number, ReturnType<typeof baseFactors>>();
function factorsForDay(ms: number) {
  const day = Math.floor(ms / 86400000);
  let b = factorCache.get(day);
  if (!b) {
    b = baseFactors(nodal(astro(day * 86400000 + 43200000)));
    if (factorCache.size > 4000) factorCache.clear();
    factorCache.set(day, b);
  }
  return b;
}

export function argument(def: Def, a: Astro): number {
  const [cT, cs, ch, cp, cN, cp1, off] = def.v;
  return cT * a.T + cs * a.s + ch * a.h + cp * a.p + cN * a.N + cp1 * a.p1 + off;
}

/** Fill `out` with every wheel at time `ms`. Returns `out`. */
export function wheels(station: Station, ms: number, out: Wheel[] = []): Wheel[] {
  const a = astro(ms);
  const b = factorsForDay(ms);
  out.length = station.harmonics.length;
  for (let i = 0; i < station.harmonics.length; i++) {
    const hc = station.harmonics[i];
    const def = CONSTITUENTS[hc.name];
    const fu = def ? def.factors(b) : ONE;
    const v = def ? argument(def, a) : hc.speed * (ms / 3600000);
    const w = out[i] ?? (out[i] = { name: hc.name, amp: 0, angle: 0, speed: hc.speed });
    w.name = hc.name;
    w.amp = fu.f * hc.amp;
    w.angle = v + fu.u - hc.phase;
    w.speed = hc.speed;
  }
  return out;
}

/** Height above chart datum (metres) at `ms`. `enabled` switches constituents out of gear. */
export function height(station: Station, ms: number, enabled?: (name: string) => boolean): number {
  const a = astro(ms);
  const b = factorsForDay(ms);
  let sum = station.z0;
  for (const hc of station.harmonics) {
    if (enabled && !enabled(hc.name)) continue;
    const def = CONSTITUENTS[hc.name];
    if (!def) continue;
    const fu = def.factors(b);
    sum += fu.f * hc.amp * Math.cos((argument(def, a) + fu.u - hc.phase) * RAD);
  }
  return sum;
}

/** Rate of change, metres per hour: the "time side" of the machine, which finds high and low water. */
export function rate(station: Station, ms: number, enabled?: (name: string) => boolean): number {
  const a = astro(ms);
  const b = factorsForDay(ms);
  let sum = 0;
  for (const hc of station.harmonics) {
    if (enabled && !enabled(hc.name)) continue;
    const def = CONSTITUENTS[hc.name];
    if (!def) continue;
    const fu = def.factors(b);
    sum -= fu.f * hc.amp * hc.speed * RAD * Math.sin((argument(def, a) + fu.u - hc.phase) * RAD);
  }
  return sum;
}

export interface Turn {
  ms: number;
  height: number;
  kind: 'high' | 'low';
}

/**
 * High and low waters between two times, found where the rate changes sign and refined by bisection
 * to within a few seconds, as the machine's brake stopped the operator at each one.
 */
export function turns(
  station: Station,
  from: number,
  to: number,
  enabled?: (name: string) => boolean,
  stepMin = 6,
): Turn[] {
  const out: Turn[] = [];
  if (!(to > from)) return out;
  const n = Math.max(1, Math.ceil((to - from) / (stepMin * 60000)));
  const step = (to - from) / n;
  let t0 = from;
  let r0 = rate(station, t0, enabled);
  for (let i = 1; i <= n; i++) {
    const t1 = from + i * step;
    const r1 = rate(station, t1, enabled);
    if ((r0 > 0 && r1 <= 0) || (r0 < 0 && r1 >= 0)) {
      let lo = t0;
      let hi = t1;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        const rm = rate(station, mid, enabled);
        if ((r0 > 0 && rm > 0) || (r0 < 0 && rm < 0)) lo = mid;
        else hi = mid;
      }
      const ms = (lo + hi) / 2;
      out.push({ ms, height: height(station, ms, enabled), kind: r0 > 0 ? 'high' : 'low' });
    }
    t0 = t1;
    r0 = r1;
  }
  return out;
}

/** Phase of the moon as the sun-moon elongation, 0 at new moon and 180 at full, in degrees. */
export function elongation(ms: number): number {
  const a = astro(ms);
  return (((a.s - a.h) % 360) + 360) % 360;
}
