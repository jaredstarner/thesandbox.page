// Tracks, as droplets. Every generator walks a particle through the chamber in
// centimetres and MeV and drops a droplet wherever it ionises the air inside
// the sensitive layer, the few centimetres above the plate where the alcohol
// vapour is supersaturated. How many droplets a centimetre of path gets follows
// how much energy the particle loses there, so a muon leaves a sparse thread,
// a slow electron a denser one, and an alpha a solid cord.
//
// The numbers:
// - Alpha ranges follow Geiger's rule, 0.318 E^1.5 cm in air at 15 °C, shortened
//   for the colder, denser air near the plate. Energy loss along an alpha rises
//   as (R - s)^(-1/3), the same rule read backwards, so tracks thicken at the end
// - Electron ranges are Katz and Penfold's fit, R = 0.412 T^(1.265 - 0.0954 ln T)
//   g/cm², and each step scatters by Highland's formula for multiple scattering
// - In a field B (tesla) a charge turns 3B/p radians per centimetre, p in MeV/c
// - Cosmic muons arrive with a zenith angle distributed as cos³ through a flat
//   surface, and decay electrons carry Michel's spectrum up to 52.8 MeV

import type { Kind } from './_guide';

/** The tank inside the glass, cm: 30 by 20, turned lengthways on a portrait screen. */
export const G = { W: 30, D: 20 };
export const H = 14;

/** Air near the plate, g/cm³: cold, and thick with alcohol vapour. */
const RHO = 1.4e-3;
/** Radiation length of air, cm at that density. */
const X0 = 36.62 / RHO;
const ME = 0.511;

export type Rng = () => number;

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (r: Rng) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface Objects {
  rod?: { ax: number; ay: number; bx: number; by: number; r: number };
  marble?: { x: number; y: number; r: number };
  salt?: { x: number; y: number; r: number; h: number };
  /** Magnet centre under the plate, or none. */
  magnet?: { x: number; y: number };
}

export const ROD_R = 0.12;
export const MARBLE_R = 0.85;
export const SALT_R = 1.45;
export const SALT_H = 0.85;
export const DISH_R = 2.1;

/** Vertical field, tesla, from a disc magnet under the plate. */
export function field(o: Objects, x: number, y: number, z: number): number {
  if (!o.magnet) return 0;
  const r2 = ((x - o.magnet.x) ** 2 + (y - o.magnet.y) ** 2) / 16;
  return (0.32 / Math.pow(1 + r2, 1.5)) * Math.exp(-z / 6);
}

function inside(o: Objects, x: number, y: number, z: number): boolean {
  if (o.marble) {
    const m = o.marble;
    if ((x - m.x) ** 2 + (y - m.y) ** 2 + (z - m.r) ** 2 < m.r * m.r) return true;
  }
  if (o.rod) {
    const { ax, ay, bx, by, r } = o.rod;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    if ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 + (z - r) ** 2 < r * r) return true;
  }
  if (o.salt) {
    const s = o.salt;
    const q = ((x - s.x) ** 2 + (y - s.y) ** 2) / (s.r * s.r);
    if (q < 1 && z < s.h * (1 - q) + 0.12) return true;
  }
  return false;
}

/** How readily vapour condenses on an ion at a point, 0 to 1. */
export function sensitivity(x: number, y: number, z: number): number {
  const layer = smooth(0.05, 0.32, z) * (1 - smooth(0.85, 1.75, z));
  const wall = smooth(0.25, 1.9, Math.min(x, G.W - x, y, G.D - y));
  return layer * wall;
}

export interface Sink {
  /** A droplet `delay` seconds after the track's birth. */
  drop(x: number, y: number, z: number, delay: number, size: number, w0: number, diff: number, life: number): void;
}

export interface Track {
  kind: Kind;
  /** Visible stretches, as flat x, y, z runs, for picking and the specimen. */
  runs: number[][];
  /** Visible length in cm. */
  length: number;
  /** What made it, for the card. */
  facts: string;
  /** Droplets laid. */
  drops: number;
  /** Seconds after birth that the last part appears. */
  span: number;
}

interface Style {
  size: number;
  w0: number;
  diff: number;
  life: number;
}

const MUON_STYLE: Style = { size: 0.7, w0: 0.012, diff: 0.03, life: 2.1 };
const ELECTRON_STYLE: Style = { size: 0.8, w0: 0.014, diff: 0.035, life: 2.3 };
const ALPHA_STYLE: Style = { size: 0.72, w0: 0.045, diff: 0.075, life: 3.1 };

/** Lays droplets along one particle's path and keeps the visible runs. */
class Path {
  runs: number[][] = [];
  length = 0;
  drops = 0;
  span = 0;
  private run: number[] | null = null;
  private lastKept = [0, 0, 0];
  private carry = 0;

  constructor(
    private r: Rng,
    private sink: Sink,
    private o: Objects,
    private ready: number,
  ) {}

  /**
   * One step from a to b with `density` droplets per cm at full sensitivity.
   * `thick` widens the cord, for the end of an alpha.
   */
  step(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    density: number,
    style: Style,
    delay: number,
    thick = 1,
  ): void {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    if (len === 0) return;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const mz = (az + bz) / 2;
    const s = sensitivity(mx, my, mz) * this.ready;
    if (s < 0.02 || inside(this.o, mx, my, mz)) {
      this.endRun();
      return;
    }
    this.length += len;
    this.span = Math.max(this.span, delay);
    this.carry += density * len * s;
    while (this.carry >= 1) {
      this.carry -= 1;
      const t = this.r();
      const w = style.w0 * thick;
      this.sink.drop(
        ax + (bx - ax) * t + gauss(this.r) * w,
        ay + (by - ay) * t + gauss(this.r) * w,
        az + (bz - az) * t + gauss(this.r) * w,
        delay + this.r() * 0.05,
        style.size * (0.7 + 0.6 * this.r()) * Math.min(1.6, thick),
        w,
        style.diff * Math.min(1.8, thick),
        style.life * (0.8 + 0.4 * this.r()) * (0.6 + 0.4 * s),
      );
      this.drops++;
    }
    if (!this.run) {
      this.run = [ax, ay, az];
      this.lastKept = [ax, ay, az];
    }
    if (Math.hypot(bx - this.lastKept[0], by - this.lastKept[1], bz - this.lastKept[2]) > 0.12) {
      this.run.push(bx, by, bz);
      this.lastKept = [bx, by, bz];
    }
  }

  endRun(): void {
    if (this.run && this.run.length >= 6) this.runs.push(this.run);
    this.run = null;
  }

  finish(): void {
    this.endRun();
  }
}

/** Where a straight line through p along d crosses into and out of the slab z0..z1 and the walls. */
function clipLine(
  px: number,
  py: number,
  pz: number,
  dx: number,
  dy: number,
  dz: number,
  z0: number,
  z1: number,
): [number, number] | null {
  let lo = -1e9;
  let hi = 1e9;
  const slab = (p: number, d: number, a: number, b: number) => {
    if (Math.abs(d) < 1e-9) return p >= a && p <= b;
    let t0 = (a - p) / d;
    let t1 = (b - p) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    lo = Math.max(lo, t0);
    hi = Math.min(hi, t1);
    return true;
  };
  if (!slab(px, dx, 0, G.W) || !slab(py, dy, 0, G.D) || !slab(pz, dz, z0, z1)) return null;
  return lo < hi ? [lo, hi] : null;
}

function straight(
  path: Path,
  px: number,
  py: number,
  pz: number,
  dx: number,
  dy: number,
  dz: number,
  t0: number,
  t1: number,
  density: (t: number) => number,
  style: Style,
  delay: number,
  thick: (t: number) => number = () => 1,
): void {
  const n = Math.max(2, Math.ceil((t1 - t0) / 0.05));
  for (let i = 0; i < n; i++) {
    const a = t0 + ((t1 - t0) * i) / n;
    const b = t0 + ((t1 - t0) * (i + 1)) / n;
    const m = (a + b) / 2;
    path.step(px + dx * a, py + dy * a, pz + dz * a, px + dx * b, py + dy * b, pz + dz * b, density(m), style, delay, thick(m));
  }
  path.endRun();
}

function isotropic(r: Rng): [number, number, number] {
  const z = 2 * r() - 1;
  const a = 2 * Math.PI * r();
  const s = Math.sqrt(1 - z * z);
  return [s * Math.cos(a), s * Math.sin(a), z];
}

/** A direction at angle `theta` from d, at a random azimuth. */
function tilt(r: Rng, d: [number, number, number], theta: number): [number, number, number] {
  const [dx, dy, dz] = d;
  const ux = Math.abs(dz) < 0.9 ? 0 : 1;
  const uz = Math.abs(dz) < 0.9 ? 1 : 0;
  // e1 = normalize(u x d), e2 = d x e1
  let e1x = 0 * dz - uz * dy;
  let e1y = uz * dx - ux * dz;
  let e1z = ux * dy - 0 * dx;
  const n = Math.hypot(e1x, e1y, e1z);
  e1x /= n;
  e1y /= n;
  e1z /= n;
  const e2x = dy * e1z - dz * e1y;
  const e2y = dz * e1x - dx * e1z;
  const e2z = dx * e1y - dy * e1x;
  const a = 2 * Math.PI * r();
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [
    dx * c + s * (Math.cos(a) * e1x + Math.sin(a) * e2x),
    dy * c + s * (Math.cos(a) * e1y + Math.sin(a) * e2y),
    dz * c + s * (Math.cos(a) * e1z + Math.sin(a) * e2z),
  ];
}

const fmtE = (mev: number) =>
  mev >= 1000
    ? `${(mev / 1000).toFixed(mev >= 10000 ? 0 : 1)} GeV`
    : mev >= 1
      ? `${mev.toFixed(mev >= 10 ? 0 : 1)} MeV`
      : `${Math.round(mev * 1000)} keV`;

// --- Alphas ---------------------------------------------------------------

/** Range in the chamber's air, cm. */
export const alphaRange = (e: number) => 0.29 * Math.pow(e, 1.5);

interface AlphaOpts {
  /** Force a Rutherford scatter, for the debug handle. */
  scatter?: boolean;
  delay?: number;
}

/** Returns true if the alpha scattered and both sides of the bend show. */
function alpha(
  path: Path,
  r: Rng,
  e: number,
  px: number,
  py: number,
  pz: number,
  d: [number, number, number],
  opts: AlphaOpts = {},
): boolean {
  const range = alphaRange(e);
  const delay = opts.delay ?? 0;
  const dens = (left: number) => 520 * Math.min(2, Math.pow(Math.max(0.12, left) / range, -1 / 3));
  const thick = (left: number) => 1 + 0.25 * smooth(0.9, 0.05, left);
  const scatterAt = opts.scatter || r() < 0.06 ? range * (0.55 + 0.35 * r()) : -1;
  let [dx, dy, dz] = d;
  let x = px;
  let y = py;
  let z = pz;
  let s = 0;
  let scattered = false;
  const start = path.length;
  let atBend = -1;
  let stubLen = 0;
  const ds = 0.05;
  while (s < range) {
    const left = range - s;
    // Small straggle, stronger near the end where the alpha is slow.
    if (left < 0.6) [dx, dy, dz] = tilt(r, [dx, dy, dz], 0.02 * r());
    if (scatterAt > 0 && !scattered && s >= scatterAt) {
      scattered = true;
      atBend = path.length;
      const before: [number, number, number] = [dx, dy, dz];
      // Turn away, staying fairly flat so the bend shows.
      for (let k = 0; k < 8; k++) {
        const nd = tilt(r, before, (0.45 + 0.6 * r()) * (opts.scatter ? 1.2 : 1));
        if (Math.abs(nd[2]) < 0.45) {
          [dx, dy, dz] = nd;
          break;
        }
      }
      // The recoiling nucleus: a short, dense stub the other way.
      const rd = tilt(r, before, -(0.9 + 0.5 * r()));
      const stub = 0.08 + 0.08 * r();
      const beforeStub = path.length;
      straight(path, x, y, z, rd[0], rd[1], rd[2] * 0.4, 0, stub, () => 900, ALPHA_STYLE, delay, () => 1.25);
      stubLen = path.length - beforeStub;
    }
    const nx = x + dx * ds;
    const ny = y + dy * ds;
    const nz = z + dz * ds;
    if (nz < 0 || nx < 0 || nx > G.W || ny < 0 || ny > G.D) break;
    path.step(x, y, z, nx, ny, nz, dens(left), ALPHA_STYLE, delay, thick(left));
    x = nx;
    y = ny;
    z = nz;
    s += ds;
  }
  path.endRun();
  return scattered && atBend - start > 0.6 && path.length - atBend - stubLen > 0.6;
}

/** Isotropic over the half facing away from a surface with outward normal n. */
function outward(r: Rng, n: [number, number, number]): [number, number, number] {
  const d = isotropic(r);
  const dot = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  return dot < 0 ? [d[0] - 2 * dot * n[0], d[1] - 2 * dot * n[1], d[2] - 2 * dot * n[2]] : d;
}

// --- Electrons --------------------------------------------------------------

/** CSDA range of an electron in the chamber's air, cm. */
export function electronRange(t: number): number {
  const g =
    t <= 2.5 ? 0.412 * Math.pow(t, 1.265 - 0.0954 * Math.log(Math.max(t, 0.002))) : 0.53 * t - 0.106;
  return g / RHO;
}

const RANGE_T: number[] = [];
const RANGE_R: number[] = [];
for (let i = 0; i <= 240; i++) {
  const t = 0.002 * Math.pow(3000 / 2, i / 240);
  RANGE_T.push(t);
  RANGE_R.push(electronRange(t));
}

/** Kinetic energy left with `r` cm of range to go. */
function energyForRange(r: number): number {
  if (r <= RANGE_R[0]) return RANGE_T[0];
  let lo = 0;
  let hi = RANGE_R.length - 1;
  if (r >= RANGE_R[hi]) return RANGE_T[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (RANGE_R[mid] < r) lo = mid;
    else hi = mid;
  }
  const f = (r - RANGE_R[lo]) / (RANGE_R[hi] - RANGE_R[lo]);
  return RANGE_T[lo] + f * (RANGE_T[hi] - RANGE_T[lo]);
}

/** Energy loss, MeV per cm, from the slope of the range curve. */
function stopping(t: number): number {
  const h = t * 0.02;
  return (2 * h) / (electronRange(t + h) - electronRange(t - h));
}

/** Minimum ionising, MeV per cm in the chamber's air. */
const MIP = 1.75 * RHO;

/** Highland's log term, taken at a fixed 1 mm so the result doesn't depend on step length. */
const HIGHLAND = 1 + 0.038 * Math.log(0.1 / X0);

/** Steps an electron (or a positron, charge +1) until it stops or leaves. */
function electron(
  path: Path,
  r: Rng,
  o: Objects,
  t0: number,
  px: number,
  py: number,
  pz: number,
  d: [number, number, number],
  delay = 0,
  charge = -1,
): void {
  let [dx, dy, dz] = d;
  let x = px;
  let y = py;
  let z = pz;
  let t = t0;
  let left = electronRange(t);
  for (let i = 0; i < 6000 && t > 0.004; i++) {
    const ds = Math.min(0.06, Math.max(0.006, left / 30));
    const p = Math.sqrt(t * t + 2 * t * ME);
    const beta = p / (t + ME);
    const theta = (13.6 / (beta * p)) * Math.sqrt(ds / X0) * HIGHLAND * 1.15;
    // Deflect: tilt by a Gaussian polar angle.
    const th = Math.abs(gauss(r)) * theta;
    if (th > 1e-5) [dx, dy, dz] = tilt(r, [dx, dy, dz], Math.min(th, 2.5));
    // Turn in the field about the vertical.
    const b = field(o, x, y, z);
    if (b > 0) {
      const phi = (charge * ds * 3 * b) / p;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
    }
    const nx = x + dx * ds;
    const ny = y + dy * ds;
    const nz = z + dz * ds;
    if (nz < 0.01 || nz > H || nx < 0 || nx > G.W || ny < 0 || ny > G.D || inside(o, nx, ny, nz)) break;
    const loss = t > 2.5 ? MIP : stopping(t);
    const dens = Math.min(240, 34 * Math.pow(loss / MIP, 0.75));
    path.step(x, y, z, nx, ny, nz, dens, ELECTRON_STYLE, delay, 1 + Math.min(0.5, (loss / MIP - 1) * 0.02));
    x = nx;
    y = ny;
    z = nz;
    if (t > 2.5) {
      t -= MIP * ds;
    } else {
      left -= ds;
      t = energyForRange(Math.max(left, 0));
    }
  }
  path.endRun();
}

/** A beta spectrum's kinetic energy, roughly sqrt(x)(1-x)² in x = T/Q. */
function betaEnergy(r: Rng, q: number): number {
  for (;;) {
    const x = r();
    if (r() * 0.29 < Math.sqrt(x) * (1 - x) * (1 - x)) return Math.max(0.01, x * q);
  }
}

// --- Muons ------------------------------------------------------------------

/** Sea-level muon momentum, GeV/c: flat below a few GeV, E^-2.7 above. */
function muonEnergy(r: Rng): number {
  const u = r();
  if (u < 0.45) return 0.3 + 2.7 * r();
  return 3 * Math.pow(1 - r(), -1 / 1.7);
}

function muonDirection(r: Rng, minTheta = 0): [number, number, number] {
  for (;;) {
    const c = Math.pow(r(), 1 / 4);
    const th = Math.acos(c);
    if (th < minTheta) continue;
    const a = 2 * Math.PI * r();
    const s = Math.sin(th);
    return [s * Math.cos(a), s * Math.sin(a), -c];
  }
}

const muonDens = () => 34;

function muonLine(
  path: Path,
  px: number,
  py: number,
  pz: number,
  d: [number, number, number],
  delay = 0,
): [number, number] | null {
  const span = clipLine(px, py, pz, d[0], d[1], d[2], 0, 2);
  if (!span) return null;
  straight(path, px, py, pz, d[0], d[1], d[2], span[0], span[1], muonDens, MUON_STYLE, delay);
  return span;
}

// --- Events ------------------------------------------------------------------

export interface Ctx {
  r: Rng;
  sink: Sink;
  o: Objects;
  /** 0 while the layer is still forming, 1 once it is sensitive. */
  ready: number;
}

const inLayer = (r: Rng): [number, number, number] => [
  1 + (G.W - 2) * r(),
  1 + (G.D - 2) * r(),
  0.25 + 0.95 * r(),
];

function done(path: Path, kind: Kind, facts: string): Track {
  path.finish();
  return { kind, runs: path.runs, length: path.length, facts, drops: path.drops, span: path.span };
}

export function muon(c: Ctx, delta?: boolean): Track {
  const path = new Path(c.r, c.sink, c.o, c.ready);
  const d = muonDirection(c.r);
  const [px, py, pz] = inLayer(c.r);
  const span = muonLine(path, px, py, pz, d);
  const e = muonEnergy(c.r);
  let kind: Kind = 'muon';
  let facts = `Muon / about ${fmtE(e * 1000)} / from above, ${Math.round((Math.acos(-d[2]) * 180) / Math.PI)}° off vertical`;
  if (span && (delta ?? c.r() < 0.14)) {
    // Knock-on electron: mostly soft, steeply falling spectrum.
    const t = Math.min(0.12, 0.012 / (1 - c.r() * 0.9));
    const at = span[0] + (span[1] - span[0]) * (0.2 + 0.6 * c.r());
    const before = path.drops;
    const nd = tilt(c.r, d, 1.0 + 0.4 * c.r());
    electron(path, c.r, c.o, t, px + d[0] * at, py + d[1] * at, Math.max(0.3, pz + d[2] * at), [
      nd[0],
      nd[1],
      nd[2] * 0.3,
    ]);
    if (path.drops - before > 12) {
      kind = 'delta';
      facts = `Muon, about ${fmtE(e * 1000)}, and an electron it knocked loose at ${fmtE(t)}`;
    }
  }
  return done(path, kind, facts);
}

export function shower(c: Ctx): Track {
  const path = new Path(c.r, c.sink, c.o, c.ready);
  const d = muonDirection(c.r, 0.9);
  const n = 3 + Math.floor(c.r() * 5);
  // Spread the members across the direction of travel.
  const h = Math.hypot(d[0], d[1]);
  const px = -d[1] / h;
  const py = d[0] / h;
  const cx = 5 + (G.W - 10) * c.r();
  const cy = 4 + (G.D - 8) * c.r();
  let shown = 0;
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * (1.2 + c.r() * 1.8) + gauss(c.r) * 0.4;
    const before = path.length;
    muonLine(path, cx + px * off, cy + py * off, 0.5 + 0.5 * c.r(), d, c.r() * 0.01);
    if (path.length - before > 1) shown++;
  }
  if (shown < 2) return done(path, 'muon', `Muon from a cosmic-ray shower whose other particles missed the layer`);
  return done(path, 'shower', `${shown} particles from one cosmic-ray shower, arriving together`);
}

export function muonDecay(c: Ctx): Track {
  const path = new Path(c.r, c.sink, c.o, c.ready);
  // A slow muon entering at a shallow angle so it shows before it stops.
  const az = 2 * Math.PI * c.r();
  const dip = 0.05 + 0.08 * c.r();
  const d: [number, number, number] = [Math.cos(az) * Math.cos(dip), Math.sin(az) * Math.cos(dip), -Math.sin(dip)];
  const sx = 6 + (G.W - 12) * c.r();
  const sy = 5 + (G.D - 10) * c.r();
  const sz = 0.45 + 0.25 * c.r();
  const len = 5 + 4 * c.r();
  // Walk back from the stopping point; dE/dx climbs over the last few cm.
  straight(
    path,
    sx,
    sy,
    sz,
    -d[0],
    -d[1],
    -d[2],
    0,
    len,
    (t) => 34 * (1 + 7 * Math.pow(Math.max(0.15, t) / 0.15, -0.8)),
    MUON_STYLE,
    0,
    (t) => 1 + 0.8 * smooth(1.6, 0, t),
  );
  // Michel electron: up to 52.8 MeV, fast, nearly straight.
  let te = 0;
  for (;;) {
    const x = c.r();
    if (c.r() < x * x * (3 - 2 * x)) {
      te = 52.8 * x;
      break;
    }
  }
  let ed = tilt(c.r, d, 0.7 + 1.3 * c.r());
  if (Math.abs(ed[2]) > 0.2) ed = [ed[0], ed[1], Math.sign(ed[2]) * 0.2];
  const n = Math.hypot(...ed);
  const before = path.length;
  electron(path, c.r, c.o, te, sx, sy, sz, [ed[0] / n, ed[1] / n, ed[2] / n], 0.004);
  if (path.length - before < 1) return done(path, 'muon', `Slow muon that stopped here; its decay electron left the layer`);
  return done(path, 'decay', `Muon stopped here and decayed / electron about ${fmtE(te)}`);
}

export function radonAlpha(c: Ctx, scatter = false): Track {
  const path = new Path(c.r, c.sink, c.o, c.ready);
  const [px, py, pz] = inLayer(c.r);
  const d = isotropic(c.r);
  const flat: [number, number, number] = [d[0], d[1], d[2] * (scatter ? 0.12 : 0.45)];
  const n = Math.hypot(...flat);
  const bounced = alpha(path, c.r, 5.49, px, py, pz, [flat[0] / n, flat[1] / n, flat[2] / n], { scatter });
  return done(
    path,
    bounced ? 'scatter' : 'alpha',
    `Radon-222 in the room's air / 5.5 MeV / range ${alphaRange(5.49).toFixed(1)} cm`,
  );
}

/** Two alphas from one point: Rn-220, then Po-216 after a fraction of a second. */
export function thoronPair(c: Ctx, at?: [number, number, number]): Track {
  const path = new Path(c.r, c.sink, c.o, c.ready);
  const [px, py, pz] = at ?? [1 + (G.W - 2) * c.r(), 1 + (G.D - 2) * c.r(), 0.4 + 0.5 * c.r()];
  const flatten = (d: [number, number, number]): [number, number, number] => {
    const f: [number, number, number] = [d[0], d[1], d[2] * 0.25];
    const n = Math.hypot(...f);
    return [f[0] / n, f[1] / n, f[2] / n];
  };
  const d1 = flatten(isotropic(c.r));
  let d2 = flatten(isotropic(c.r));
  // Keep the two legs apart enough to read as a V.
  for (let k = 0; k < 6 && d1[0] * d2[0] + d1[1] * d2[1] > 0.6; k++) d2 = flatten(isotropic(c.r));
  // Po-216: half-life 0.145 s.
  const wait = Math.min(0.9, 0.08 + (-Math.log(1 - c.r()) * 0.145) / Math.LN2);
  alpha(path, c.r, 6.29, px, py, pz, d1);
  const first = path.length;
  alpha(path, c.r, 6.78, px, py, pz, d2, { delay: wait });
  if (first < 1 || path.length - first < 1) {
    return done(path, 'alpha', `Thoron (radon-220) in the air / 6.3 MeV; the second alpha left the layer`);
  }
  return done(
    path,
    'thoron',
    `Radon-220, 6.3 MeV, then polonium-216, 6.8 MeV, ${(wait * 1000).toFixed(0)} ms later`,
  );
}

export function background(c: Ctx): Track {
  const path = new Path(c.r, c.sink, c.o, c.ready);
  const [px, py, pz] = inLayer(c.r);
  // Compton and photoelectrons: mostly soft.
  const t = 0.015 + 0.3 * Math.pow(c.r(), 2.2);
  const d = isotropic(c.r);
  const n = Math.hypot(d[0], d[1], d[2] * 0.5);
  electron(path, c.r, c.o, t, px, py, pz, [d[0] / n, d[1] / n, (d[2] * 0.5) / n]);
  return done(path, 'electron', `Electron set loose by a gamma ray / ${fmtE(t)}`);
}

// --- Sources -----------------------------------------------------------------

/** The thorium chain's alphas from a thoriated rod: nuclide, energy, weight per chain. */
const THORIUM: [string, number, number][] = [
  ['Thorium-232', 4.01, 1],
  ['Thorium-228', 5.42, 1],
  ['Radium-224', 5.69, 1],
  ['Radon-220', 6.29, 1],
  ['Polonium-216', 6.78, 1],
  ['Bismuth-212', 6.05, 0.36],
  ['Polonium-212', 8.78, 0.64],
];

function pick<T extends [string, number, number]>(r: Rng, table: T[]): T {
  const total = table.reduce((a, t) => a + t[2], 0);
  let u = r() * total;
  for (const t of table) {
    u -= t[2];
    if (u <= 0) return t;
  }
  return table[table.length - 1];
}

/** A point on the rod's upper surface and the outward normal there. */
function rodPoint(r: Rng, o: Objects): { p: [number, number, number]; n: [number, number, number] } | null {
  if (!o.rod) return null;
  const { ax, ay, bx, by, r: rr } = o.rod;
  const t = r();
  const len = Math.hypot(bx - ax, by - ay);
  const sx = -(by - ay) / len;
  const sy = (bx - ax) / len;
  const a = Math.PI * (0.05 + 0.9 * r());
  const n: [number, number, number] = [sx * Math.cos(a), sy * Math.cos(a), Math.sin(a)];
  return { p: [ax + (bx - ax) * t + n[0] * rr * 1.05, ay + (by - ay) * t + n[1] * rr * 1.05, rr + n[2] * rr * 1.05], n };
}

export function rodAlpha(c: Ctx): Track | null {
  const at = rodPoint(c.r, c.o);
  if (!at) return null;
  const path = new Path(c.r, c.sink, c.o, c.ready);
  const [name, e0] = pick(c.r, THORIUM);
  // Alphas from below the surface lose some energy getting out.
  const e = Math.max(1.5, e0 - c.r() * c.r() * 2.2);
  const d = outward(c.r, at.n);
  const f: [number, number, number] = [d[0], d[1], Math.abs(d[2]) * 0.3];
  const n = Math.hypot(...f);
  alpha(path, c.r, e, at.p[0], at.p[1], at.p[2], [f[0] / n, f[1] / n, f[2] / n], {});
  const long = e0 > 8 && path.length > 5.5;
  return done(path, long ? 'long-alpha' : 'alpha', `${name} in the welding rod / ${e.toFixed(1)} MeV leaving the metal`);
}

export function rodBeta(c: Ctx): Track | null {
  const at = rodPoint(c.r, c.o);
  if (!at) return null;
  const path = new Path(c.r, c.sink, c.o, c.ready);
  const betas: [string, number, number][] = [
    ['Lead-212', 0.57, 1],
    ['Bismuth-212', 2.25, 0.64],
    ['Thallium-208', 1.8, 0.36],
    ['Actinium-228', 2.1, 1],
  ];
  const [name, q] = pick(c.r, betas);
  const t = betaEnergy(c.r, q);
  electron(path, c.r, c.o, t, at.p[0], at.p[1], at.p[2], outward(c.r, at.n));
  return done(path, 'electron', `Beta decay of ${name.toLowerCase()} in the welding rod / ${fmtE(t)}`);
}

/** Thoron that seeped out of the rod and drifted before decaying. */
export function rodThoron(c: Ctx): Track | null {
  if (!c.o.rod) return null;
  const { ax, ay, bx, by } = c.o.rod;
  const t = c.r();
  const x = ax + (bx - ax) * t + gauss(c.r) * 2;
  const y = ay + (by - ay) * t + gauss(c.r) * 2;
  if (x < 1 || x > G.W - 1 || y < 1 || y > G.D - 1) return null;
  return thoronPair(c, [x, y, 0.35 + 0.7 * c.r()]);
}

function marblePoint(r: Rng, o: Objects): { p: [number, number, number]; n: [number, number, number] } | null {
  if (!o.marble) return null;
  const m = o.marble;
  let n = isotropic(r);
  if (n[2] < -0.3) n = [n[0], n[1], -n[2]];
  return { p: [m.x + n[0] * m.r * 1.03, m.y + n[1] * m.r * 1.03, m.r + n[2] * m.r * 1.03], n };
}

export function marbleAlpha(c: Ctx): Track | null {
  const at = marblePoint(c.r, c.o);
  if (!at) return null;
  const path = new Path(c.r, c.sink, c.o, c.ready);
  const [name, e0] = pick(c.r, [
    ['Uranium-238', 4.2, 1],
    ['Uranium-234', 4.77, 1],
  ] as [string, number, number][]);
  const e = Math.max(1.2, e0 - c.r() * c.r() * 2);
  const d = outward(c.r, at.n);
  const f: [number, number, number] = [d[0], d[1], d[2] * 0.35];
  const n = Math.hypot(...f);
  const bounced = alpha(path, c.r, e, at.p[0], at.p[1], at.p[2], [f[0] / n, f[1] / n, f[2] / n]);
  return done(path, bounced ? 'scatter' : 'alpha', `${name} in the marble / ${e.toFixed(1)} MeV leaving the glass`);
}

export function marbleBeta(c: Ctx): Track | null {
  const at = marblePoint(c.r, c.o);
  if (!at) return null;
  const path = new Path(c.r, c.sink, c.o, c.ready);
  const pa = c.r() < 0.8;
  const t = betaEnergy(c.r, pa ? 2.27 : 0.27);
  const d = outward(c.r, at.n);
  electron(path, c.r, c.o, t, at.p[0], at.p[1], at.p[2], [d[0], d[1], d[2] * 0.6]);
  return done(
    path,
    'electron',
    `Beta decay of ${pa ? 'protactinium-234m' : 'thorium-234'} in the marble's uranium / ${fmtE(t)}`,
  );
}

export function saltBeta(c: Ctx): Track | null {
  const s = c.o.salt;
  if (!s) return null;
  const path = new Path(c.r, c.sink, c.o, c.ready);
  const a = 2 * Math.PI * c.r();
  const q = Math.sqrt(c.r()) * 0.95;
  const x = s.x + Math.cos(a) * s.r * q;
  const y = s.y + Math.sin(a) * s.r * q;
  const z = s.h * (1 - q * q) + 0.14;
  const t = betaEnergy(c.r, 1.31);
  const d = outward(c.r, [Math.cos(a) * q * 0.6, Math.sin(a) * q * 0.6, 1]);
  electron(path, c.r, c.o, t, x, y, z, [d[0], d[1], d[2] * 0.5]);
  return done(path, 'electron', `Beta decay of potassium-40 in the salt / ${fmtE(t)}`);
}
