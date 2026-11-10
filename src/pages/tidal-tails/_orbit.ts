// The two masses and their disks, in Toomre and Toomre's restricted three-body
// setup: each galaxy is one point of mass, and only the two masses pull.
//
// Units: G = 1, one length unit is 10 kpc, one mass unit is 1e11 solar
// masses, so one time unit is sqrt(L^3 / GM) = 47.15 Myr and one speed unit
// is 207 km/s.

export const KPC_PER_UNIT = 10;
export const MYR_PER_UNIT = 47.15;
/** Time per integration step, in time units (about 1.2 Myr). */
export const DT = 0.025;
/** How long the plate runs after closest approach, in time units (about 2.3 Gyr). */
const SPAN_AFTER = 48;
/** Furthest back the plate starts, in time units. */
const SPAN_BEFORE = 36;
/** The pair starts at least this far apart, unless the orbit turns back first. */
const START_APART = 9;
/** Softening of the pull between the two masses, so a head-on pass stays finite. */
const CORE_SOFT = 0.25;

export type Vec3 = [number, number, number];

export interface Disk {
  /** Angle between the disk and the orbit plane, degrees: 0 spins with the pass, 180 against it. */
  tilt: number;
  /** Where the tilted disk's line of nodes sits, from the closest-approach line, degrees. */
  turn: number;
  on: boolean;
}

export interface Encounter {
  /** Companion mass over the first galaxy's mass. */
  ratio: number;
  /** Closest approach, kpc. */
  peri: number;
  /** Orbit eccentricity: under 1 is bound, 1 parabolic, over 1 a flyby. */
  ecc: number;
  a: Disk;
  b: Disk;
}

export interface Galaxy {
  mass: number;
  /** Disk radius, length units. */
  radius: number;
  /** Plummer softening of this galaxy's pull, length units. */
  soft: number;
  /** Disk basis: e1 and e2 span the disk, n is the spin axis. */
  e1: Vec3;
  e2: Vec3;
  n: Vec3;
  on: boolean;
  /** Position and velocity of the mass at the plate's first step. */
  pos: Vec3;
  vel: Vec3;
}

export interface Orbit {
  /** Number of steps in the table. */
  steps: number;
  /** Step index of closest approach. */
  k0: number;
  /** Eight floats a step: A xyz, 0, B xyz, 0. */
  table: Float32Array;
  a: Galaxy;
  b: Galaxy;
}

const add = (p: Vec3, q: Vec3, s = 1): Vec3 => [p[0] + q[0] * s, p[1] + q[1] * s, p[2] + q[2] * s];
const scale = (p: Vec3, s: number): Vec3 => [p[0] * s, p[1] * s, p[2] * s];
const cross = (p: Vec3, q: Vec3): Vec3 => [
  p[1] * q[2] - p[2] * q[1],
  p[2] * q[0] - p[0] * q[2],
  p[0] * q[1] - p[1] * q[0],
];
const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const norm = (p: Vec3): Vec3 => {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
};
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Galaxy size grows with mass, roughly as observed disks do. */
export function sizeOf(mass: number) {
  const s = Math.sqrt(mass);
  return { radius: 1.5 * s, soft: 0.4 * s };
}

type State = { r: Vec3; v: Vec3 };

function accel(r: Vec3, m: number): Vec3 {
  const d2 = dot(r, r) + CORE_SOFT * CORE_SOFT;
  return scale(r, -m / (d2 * Math.sqrt(d2)));
}

function rk4(s: State, h: number, m: number): State {
  const a1 = accel(s.r, m);
  const r2 = add(s.r, s.v, h / 2);
  const v2 = add(s.v, a1, h / 2);
  const a2 = accel(r2, m);
  const r3 = add(s.r, v2, h / 2);
  const v3 = add(s.v, a2, h / 2);
  const a3 = accel(r3, m);
  const r4 = add(s.r, v3, h);
  const v4 = add(s.v, a3, h);
  const a4 = accel(r4, m);
  return {
    r: add(s.r, add(add(s.v, v4), add(v2, v3), 2), h / 6),
    v: add(s.v, add(add(a1, a4), add(a2, a3), 2), h / 6),
  };
}

function advance(s: State, h: number, m: number): State {
  const sub = 12;
  let t = s;
  for (let i = 0; i < sub; i++) t = rk4(t, h / sub, m);
  return t;
}

/** The disk's basis, after Toomre and Toomre's tilt and argument of pericentre. */
function orient(disk: Disk, peri: Vec3, along: Vec3, spin: Vec3): Pick<Galaxy, 'e1' | 'e2' | 'n'> {
  // The line of nodes sits `turn` degrees back from the closest-approach line, in the orbit plane.
  const w = rad(-disk.turn);
  const node = norm(add(scale(peri, Math.cos(w)), along, Math.sin(w)));
  const i = rad(disk.tilt);
  const n = norm(add(scale(spin, Math.cos(i)), cross(node, spin), Math.sin(i)));
  return { e1: node, e2: norm(cross(n, node)), n };
}

/** The relative orbit, both masses' paths step by step, and each disk's setup. */
export function solve(enc: Encounter): Orbit {
  const mA = 1;
  const mB = enc.ratio;
  const m = mA + mB;
  const q = enc.peri / KPC_PER_UNIT;

  // Start at closest approach. Speed there comes from the orbit's energy,
  // so far from the pass the orbit has the chosen eccentricity.
  const energy = q > 1e-3 ? (-m * (1 - enc.ecc)) / (2 * Math.max(q, 0.05)) : 0;
  const well = m / Math.sqrt(q * q + CORE_SOFT * CORE_SOFT);
  const speed = Math.sqrt(Math.max(2 * (energy + well), 0.5 * well));
  const head = q < 0.02;
  const peri: Vec3 = head ? [0, 1, 0] : [1, 0, 0];
  const start: State = head ? { r: [0, 0, 0], v: [speed, 0, 0] } : { r: [q, 0, 0], v: [0, speed, 0] };
  const spin: Vec3 = [0, 0, 1];
  const along = norm(cross(spin, peri));

  // Back from closest approach until far enough, or until the orbit turns.
  const back: State[] = [];
  let s = start;
  let prev = Math.hypot(...s.r);
  for (let k = 0; k * DT < SPAN_BEFORE; k++) {
    s = advance(s, -DT, m);
    const d = Math.hypot(...s.r);
    if (d < prev - 1e-6 && k > 4) break;
    back.push(s);
    prev = d;
    if (d >= START_APART) break;
  }
  const forward: State[] = [start];
  s = start;
  for (let k = 0; k * DT < SPAN_AFTER; k++) {
    s = advance(s, DT, m);
    forward.push(s);
  }
  const states = back.reverse().concat(forward);
  const steps = states.length;
  const table = new Float32Array(steps * 8);
  const fa = -mB / m;
  const fb = mA / m;
  states.forEach((st, k) => {
    table.set([st.r[0] * fa, st.r[1] * fa, st.r[2] * fa, 0, st.r[0] * fb, st.r[1] * fb, st.r[2] * fb, 0], k * 8);
  });

  const first = states[0]!;
  const sa = sizeOf(mA);
  const sb = sizeOf(mB);
  const a: Galaxy = {
    mass: mA,
    ...sa,
    ...orient(enc.a, peri, along, spin),
    on: enc.a.on,
    pos: scale(first.r, fa),
    vel: scale(first.v, fa),
  };
  // The companion sees the first galaxy on the opposite side at closest approach.
  const b: Galaxy = {
    mass: mB,
    ...sb,
    ...orient(enc.b, scale(peri, -1), scale(along, -1), spin),
    on: enc.b.on,
    pos: scale(first.r, fb),
    vel: scale(first.v, fb),
  };
  return { steps, k0: back.length, table, a, b };
}

/** Position of each mass at a step, for the plate's marks. */
export function coresAt(orbit: Orbit, k: number): [Vec3, Vec3] {
  const i = Math.max(0, Math.min(orbit.steps - 1, Math.round(k))) * 8;
  const t = orbit.table;
  return [
    [t[i]!, t[i + 1]!, t[i + 2]!],
    [t[i + 4]!, t[i + 5]!, t[i + 6]!],
  ];
}

export const myrAt = (orbit: Orbit, k: number) => (k - orbit.k0) * DT * MYR_PER_UNIT;
export const stepAt = (orbit: Orbit, myr: number) => orbit.k0 + Math.round(myr / (DT * MYR_PER_UNIT));
