// Where the Sun and Moon stand for a place and moment, and how much of the Moon is lit.
// Low-precision ephemerides (a fraction of a degree), plenty for placing them in a print.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toDays = (t: number) => t / DAY_MS - 0.5 + J1970 - J2000;

const rightAscension = (l: number, b: number) =>
  Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l: number, b: number) =>
  Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
/** Azimuth from south, positive toward the west. */
const azimuth = (h: number, phi: number, dec: number) =>
  Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
const altitude = (h: number, phi: number, dec: number) =>
  Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h));
const siderealTime = (d: number, lw: number) => RAD * (280.16 + 360.9856235 * d) - lw;

function refraction(h: number): number {
  const a = Math.max(h, 0);
  return 0.0002967 / Math.tan(a + 0.00312536 / (a + 0.08901179));
}

function sunCoords(d: number) {
  const m = RAD * (357.5291 + 0.98560028 * d);
  const c = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  const l = m + c + RAD * 102.9372 + Math.PI;
  return { dec: declination(l, 0), ra: rightAscension(l, 0) };
}

function moonCoords(d: number) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

export interface SkyPos {
  /** Degrees above the horizon. */
  alt: number;
  /** Compass bearing in degrees, 0 north, 90 east. */
  bearing: number;
}

function toPos(az: number, alt: number): SkyPos {
  return { alt: alt / RAD, bearing: (((az / RAD + 180) % 360) + 360) % 360 };
}

export function sunPosition(t: number, lat: number, lon: number): SkyPos {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(t);
  const c = sunCoords(d);
  const h = siderealTime(d, lw) - c.ra;
  return toPos(azimuth(h, phi, c.dec), altitude(h, phi, c.dec));
}

export function moonPosition(t: number, lat: number, lon: number): SkyPos {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(t);
  const c = moonCoords(d);
  const h = siderealTime(d, lw) - c.ra;
  const alt = altitude(h, phi, c.dec);
  return toPos(azimuth(h, phi, c.dec), alt + refraction(alt));
}

export interface MoonLight {
  /** Lit fraction of the disc, 0..1. */
  fraction: number;
  /** True while the lit part grows. */
  waxing: boolean;
}

export function moonIllumination(t: number): MoonLight {
  const d = toDays(t);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sdist = 149598000;
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra),
  );
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
  );
  return { fraction: (1 + Math.cos(inc)) / 2, waxing: angle < 0 };
}
