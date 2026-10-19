// The geometry of a horizontal dial for one place, in plate units: the plate is
// a circle of radius 100 around the gnomon's root. Everything is computed by
// casting the gnomon's shadow, so hour lines, date lines, and the noon figure
// eight all come from the same model the live shadow uses.
//
// Frames: the local frame is east, north, up. The display frame turns the
// plate so the gnomon points up the screen (north in the northern hemisphere,
// south in the southern): x = k * east, y = k * north, with y up.

import { DATE_LINES, OBLIQUITY, RAD, halfDay, season, sunVector, type Vec3 } from './_sun';

export const R = {
  plate: 93,
  numerals: 82.5,
  ringOut: 75.5,
  ringIn: 72,
  half: 69.5,
  clip: 70,
  band: 49,
  boss: 3.4,
} as const;

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** IANA zone, when known. */
  zone: string | null;
  /** The meridian of the clock zone's standard time, degrees east. */
  zoneLon: number;
}

export type Pt = [number, number];

export interface HourLine {
  /** Clock hour, 0 to 23, in standard time. */
  t: number;
  /** Display angle from the gnomon, clockwise, degrees. */
  angle: number;
  /** Where the line stops. */
  r1: number;
}

export interface DateCurve {
  decl: number;
  label?: string;
  major: boolean;
  segs: Pt[][];
}

export interface Dial {
  place: Place;
  /** +1 north of the equator, -1 south. */
  k: 1 | -1;
  /** Length of the style from root to tip. */
  s: number;
  /** The style's tip, the dial's nodus, in the local frame. */
  tip: Vec3;
  width: number;
  hours: HourLine[];
  ticks: { angle: number; half: boolean }[];
  curves: DateCurve[];
  analemma: Pt[][];
  /** Minutes the clock's zone meridian puts between solar and clock noon here. */
  shift: number;
}

const BAND_HALF = 52; // degrees either side of the bottom kept for the motto

function cross(a: Vec3, b: Vec3): Vec3 {
  return { e: a.n * b.u - a.u * b.n, n: a.u * b.e - a.e * b.u, u: a.e * b.n - a.n * b.e };
}

/** Where a point's shadow falls on the plate, in the local frame. Null when the sun is down. */
export function cast(p: Vec3, sun: Vec3): Pt | null {
  if (sun.u <= 1e-4) return null;
  const f = p.u / sun.u;
  return [p.e - f * sun.e, p.n - f * sun.n];
}

/** Local frame to display frame. */
export function show(k: 1 | -1, p: Pt): Pt {
  return [k * p[0], k * p[1]];
}

export function styleDir(lat: number): Vec3 {
  const k = lat < 0 ? -1 : 1;
  return { e: 0, n: k * Math.cos(lat * RAD), u: k * Math.sin(lat * RAD) };
}

/** The display angle of the style's shadow at an hour angle: the half-line the shadow lies on. */
export function hourAngleToDial(lat: number, ha: number): number {
  const k = lat < 0 ? -1 : 1;
  const u = styleDir(lat);
  const sun = sunVector(lat, 0, ha);
  const np = cross(u, sun);
  let d: Pt = [np.n, -np.e];
  if (d[0] * sun.e + d[1] * sun.n > 0) d = [-d[0], -d[1]];
  const [x, y] = show(k, d);
  return Math.atan2(x, y) / RAD;
}

export function roman(t: number): string {
  const h = t % 12 === 0 ? 12 : t % 12;
  return ['', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][h];
}

function inBand(angle: number): boolean {
  const a = ((angle % 360) + 360) % 360;
  return Math.abs(a - 180) < BAND_HALF;
}

/** Dial latitude: a horizontal dial at the equator has a flat gnomon and no shadow, so the model stops a degree short. */
export function dialLat(lat: number): number {
  const a = Math.max(1, Math.min(89.5, Math.abs(lat)));
  return lat < 0 ? -a : a;
}

export function layout(place: Place, year: number): Dial {
  const lat = dialLat(place.lat);
  const k: 1 | -1 = lat < 0 ? -1 : 1;
  const u = styleDir(lat);
  const lonShift = place.lon - place.zoneLon; // degrees of hour angle at clock noon, before the equation of time

  // Size the style so the winter solstice's noon shadow lands near the rim.
  const winter = -k * OBLIQUITY;
  const noonWinter = sunVector(lat, winter, 0);
  let s = 22;
  if (noonWinter.u > Math.sin(3 * RAD)) {
    const p = cast(u, noonWinter)!;
    s = (0.8 * R.clip) / Math.hypot(p[0], p[1]);
  }
  s = Math.max(12, Math.min(29, s));
  const tip: Vec3 = { e: 0, n: u.n * s, u: u.u * s };

  // Hours the sun can be up for at midsummer.
  const reach = Math.min(180, halfDay(lat, k * OBLIQUITY, 0) + 7.5);
  const hours: HourLine[] = [];
  const ticks: { angle: number; half: boolean }[] = [];
  for (let m = 0; m < 24 * 60; m += 10) {
    const ha = 15 * (m / 60 - 12) + lonShift;
    const wrapped = ((((ha + 180) % 360) + 360) % 360) - 180;
    if (Math.abs(wrapped) > reach) continue;
    const angle = hourAngleToDial(lat, wrapped);
    if (m % 60 === 0) hours.push({ t: m / 60, angle, r1: inBand(angle) ? R.band : R.ringOut });
    else ticks.push({ angle, half: m % 30 === 0 });
  }

  const curves: DateCurve[] = DATE_LINES.map((line) => ({ ...line, segs: trace(lat, k, tip, line.decl) }));

  // The noon figure eight: where the tip's shadow falls at noon on the clock (standard time), through the year.
  const analemma: Pt[][] = [];
  let seg: Pt[] = [];
  for (let day = 0; day <= 366; day += 2) {
    const ms = Date.UTC(year, 0, 1 + day, 12);
    const { decl, eot } = season(ms);
    const sun = sunVector(lat, decl, lonShift + eot / 4);
    const p = cast(tip, sun);
    if (p && Math.hypot(p[0], p[1]) < R.clip) seg.push(show(k, p));
    else {
      if (seg.length > 1) analemma.push(seg);
      seg = [];
    }
  }
  if (seg.length > 1) analemma.push(seg);

  return { place, k, s, tip, width: 1.7, hours, ticks, curves, analemma, shift: lonShift * 4 };
}

function trace(lat: number, k: 1 | -1, tip: Vec3, decl: number): Pt[][] {
  const segs: Pt[][] = [];
  let seg: Pt[] = [];
  const end = () => {
    if (seg.length > 1) segs.push(seg);
    seg = [];
  };
  for (let ha = -180; ha <= 180; ha += 0.5) {
    const sun = sunVector(lat, decl, ha);
    if (sun.u < Math.sin(1.5 * RAD)) {
      end();
      continue;
    }
    const p = cast(tip, sun)!;
    if (Math.hypot(p[0], p[1]) > R.clip) {
      end();
      continue;
    }
    seg.push(show(k, p));
  }
  end();
  return segs;
}

/** The gnomon's shadow on the plate, as a convex outline in the display frame. */
export function gnomonShadow(dial: Dial, sun: Vec3): Pt[] | null {
  if (sun.u <= Math.sin(0.2 * RAD)) return null;
  const w = dial.width / 2;
  const pts: Pt[] = [];
  for (const side of [-w, w]) {
    // Root, foot, and tip; the root and foot sit on the plate.
    pts.push(show(dial.k, [side, 0]));
    pts.push(show(dial.k, [side, dial.tip.n]));
    pts.push(show(dial.k, cast({ e: side, n: dial.tip.n, u: dial.tip.u }, sun)!));
  }
  return hull(pts);
}

function hull(points: Pt[]): Pt[] {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The dial's reading for a sun: clock hours in standard time, before the equation of time. */
export function reading(dial: Dial, ha: number): number {
  const t = 12 + (ha - dial.shift / 4) / 15;
  return ((t % 24) + 24) % 24;
}
