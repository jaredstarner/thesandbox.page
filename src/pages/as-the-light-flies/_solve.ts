// Constraint-based geolocation from round-trip times, after Gueye, Ziviani, Crovella, and Fdida,
// "Constraint-Based Geolocation of Internet Hosts" (IMC 2004). A reply that took t milliseconds
// round trip can't have come from farther away than light in glass covers in t / 2: about
// 100 km for every millisecond. Everything slower than that is an added delay.

export const EARTH_KM = 6371.0088;
/** Light in a vacuum, km per millisecond. */
export const C_KM_MS = 299.792458;
/** Light in optical fibre: about two thirds of c, as CBG takes it. */
export const FIBRE_KM_MS = (C_KM_MS * 2) / 3;
/** Kilometres of separation that one millisecond of round trip can cover at most. */
export const KM_PER_RTT_MS = FIBRE_KM_MS / 2;
/** Half the Earth's circumference: no two places are farther apart than this. */
export const MAX_KM = Math.PI * EARTH_KM;

const RAD = Math.PI / 180;

export type Vec3 = [number, number, number];

/** A unit vector: x towards 0° E on the equator, y towards 90° E, z towards the north pole. */
export function toVec(lat: number, lon: number): Vec3 {
  const p = lat * RAD;
  const l = lon * RAD;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}

export function toLatLon(v: Vec3): [number, number] {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [Math.asin(Math.max(-1, Math.min(1, v[2] / n))) / RAD, Math.atan2(v[1], v[0]) / RAD];
}

/** Great-circle distance in km between two unit vectors. */
export function kmBetween(a: Vec3, b: Vec3): number {
  // atan2 of the cross and dot products holds its precision at short and antipodal range alike.
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.atan2(Math.hypot(cx, cy, cz), dot) * EARTH_KM;
}

/** Initial compass bearing in degrees from a to b. */
export function bearing(a: Vec3, b: Vec3): number {
  const [la1, lo1] = toLatLon(a).map((d) => d * RAD);
  const [la2, lo2] = toLatLon(b).map((d) => d * RAD);
  const y = Math.sin(lo2 - lo1) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compass = (deg: number) => POINTS[Math.round(deg / 45) % 8];

/** The farthest a reply of this round trip can have travelled, in km. */
export const boundKm = (rtt: number) => Math.min(MAX_KM, rtt * KM_PER_RTT_MS);

export interface Landmark {
  v: Vec3;
  /** Best round trip measured, in ms. */
  rtt: number;
}

export interface Fit {
  /** Delay shared by every reply, ms: the near end of the line and the server's moment to answer. */
  a: number;
  /** Milliseconds of round trip per km of distance on the far side of that delay. */
  s: number;
  /** Weighted mean squared relative misfit. */
  score: number;
  /** The most delay every reply could share and still have come from here; below 0, it can't. */
  slack: number;
}

const S_MIN = 1 / KM_PER_RTT_MS;

/**
 * How well a candidate place explains the replies: the straight line t = a + s·d through the
 * points (distance from here, round trip), weighted towards relative error so near landmarks
 * count as much as far ones. The line may not run faster than light (s ≥ 1 / 100 km), and its
 * shared delay may not be negative or so large that some reply would then beat light.
 */
export function fitAt(x: Vec3, marks: Landmark[], d: Float64Array = new Float64Array(marks.length)): Fit {
  let slack = Infinity;
  for (let i = 0; i < marks.length; i++) {
    d[i] = kmBetween(x, marks[i].v);
    slack = Math.min(slack, marks[i].rtt - d[i] * S_MIN);
  }
  const top = Math.max(0, slack);
  // Detours only ever add delay, so the line should run along the bottom of the points: replies
  // above it count for less on each pass (an expectile fit), replies below it for more.
  let a = 0;
  let s = S_MIN;
  for (let pass = 0; pass < PASSES; pass++) {
    let W = 0;
    let Sx = 0;
    let Sy = 0;
    let Sxx = 0;
    let Sxy = 0;
    for (let i = 0; i < marks.length; i++) {
      const t = marks[i].rtt;
      const side = pass === 0 ? 1 : t - a - s * d[i] > 0 ? TAU : 1 - TAU;
      const w = side / (t * t);
      W += w;
      Sx += w * d[i];
      Sy += w * t;
      Sxx += w * d[i] * d[i];
      Sxy += w * d[i] * t;
    }
    const den = W * Sxx - Sx * Sx;
    s = den > 1e-12 ? (W * Sxy - Sx * Sy) / den : S_MIN;
    if (s < S_MIN) s = S_MIN;
    a = (Sy - s * Sx) / W;
    if (a < 0 || a > top) {
      a = Math.max(0, Math.min(top, a));
      s = Sxx > 0 ? Math.max(S_MIN, (Sxy - a * Sx) / Sxx) : S_MIN;
    }
  }
  let e = 0;
  for (let i = 0; i < marks.length; i++) {
    const t = marks[i].rtt;
    const r = (t - a - s * d[i]) / t;
    e += r * r * (r > 0 ? TAU : 1 - TAU);
  }
  return { a, s, score: e / marks.length, slack };
}

/** Passes of the fit, and how much a reply above the line counts against one below it. */
export const PASSES = 3;
export const TAU = 0.15;

export interface Solution {
  /** Grid size: cells of `step` degrees, rows from the north. */
  cols: number;
  rows: number;
  step: number;
  /** Relative likelihood per cell, 0 to 1, 0 where light rules the place out. */
  like: Float32Array;
  /** 1 where every reply could have come from, by light alone. */
  feasible: Uint8Array;
  /** Area light alone leaves open, km². */
  feasibleKm2: number;
  best: Vec3;
  fit: Fit;
  /** Radius of a circle with the area of the likeliest half, km. */
  spreadKm: number;
}

/** How sharply the misfit separates places; matched to the scatter of real routes (see the bench). */
const SIGMA = 0.02;

export function solve(marks: Landmark[], step = 0.5): Solution {
  const cols = Math.round(360 / step);
  const rows = Math.round(180 / step);
  const like = new Float32Array(cols * rows);
  const feasible = new Uint8Array(cols * rows);
  const d = new Float64Array(marks.length);
  let bestScore = Infinity;
  let best: Vec3 = [1, 0, 0];
  let feasibleKm2 = 0;
  const cellKm2 = (lat: number) => (step * RAD * EARTH_KM) ** 2 * Math.cos(lat * RAD);
  for (let r = 0; r < rows; r++) {
    const lat = 90 - (r + 0.5) * step;
    for (let c = 0; c < cols; c++) {
      const lon = -180 + (c + 0.5) * step;
      const x = toVec(lat, lon);
      const f = fitAt(x, marks, d);
      const k = r * cols + c;
      if (f.slack < 0) continue;
      feasible[k] = 1;
      feasibleKm2 += cellKm2(lat);
      like[k] = f.score;
      if (f.score < bestScore) {
        bestScore = f.score;
        best = x;
      }
    }
  }
  // Refine the best cell on a finer grid around it.
  const [bl, bo] = toLatLon(best);
  const fine = step / 10;
  for (let la = bl - step * 2; la <= bl + step * 2; la += fine) {
    for (let lo = bo - step * 2; lo <= bo + step * 2; lo += fine) {
      const x = toVec(Math.max(-89.9, Math.min(89.9, la)), lo);
      const f = fitAt(x, marks, d);
      if (f.slack >= 0 && f.score < bestScore) {
        bestScore = f.score;
        best = x;
      }
    }
  }
  // Misfit to likelihood, relative to the best place.
  const pairs: [number, number][] = [];
  for (let k = 0; k < like.length; k++) {
    if (!feasible[k]) continue;
    const L = Math.exp(-(like[k] - bestScore) / (2 * SIGMA * SIGMA));
    like[k] = L;
    const lat = 90 - (Math.floor(k / cols) + 0.5) * step;
    pairs.push([L, L * cellKm2(lat)]);
  }
  pairs.sort((p, q) => q[0] - p[0]);
  const total = pairs.reduce((t, p) => t + p[1], 0);
  let acc = 0;
  let area = 0;
  for (const [L, m] of pairs) {
    if (acc >= total / 2) break;
    acc += m;
    area += m / L;
  }
  return {
    cols,
    rows,
    step,
    like,
    feasible,
    feasibleKm2,
    best,
    fit: fitAt(best, marks),
    spreadKm: Math.sqrt(area / Math.PI),
  };
}

/** A small seeded generator, so a pretend place gives the same replies each time. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Replies as they might come back to someone standing at x: a shared delay at the near end, then
 * each route slower than a great circle by its own factor (cables follow coasts and meet at hubs),
 * now and then a long detour through a far exchange, and a little jitter.
 */
export function pretend(x: Vec3, stations: Vec3[], seed: number): number[] {
  const rand = rng(seed);
  const near = 3 + rand() * 12;
  return stations.map((v) => {
    const km = kmBetween(x, v);
    const stretch = 1.35 + 0.9 * rand() ** 2;
    const backhaul = 400 * rand();
    const detour = rand() < 0.12 ? 8 + rand() * 30 : 0;
    const jitter = rand() * 1.5;
    return near + (km * stretch + backhaul) / KM_PER_RTT_MS + detour + jitter;
  });
}
