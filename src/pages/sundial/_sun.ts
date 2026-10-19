// The sun's place in the sky, from NOAA's general solar position equations
// (good to about a minute of time and a tenth of a degree, plenty for a dial).
// Angles in degrees, times in minutes, instants in UTC milliseconds.

export const RAD = Math.PI / 180;
export const OBLIQUITY = 23.44;

/** A direction in the dial's local frame: east, north, up. */
export interface Vec3 {
  e: number;
  n: number;
  u: number;
}

export interface Sun {
  /** Declination. */
  decl: number;
  /** Equation of time, apparent minus mean solar time, in minutes: positive when a sundial runs fast. */
  eot: number;
  /** Local hour angle, west of the meridian positive. */
  ha: number;
  alt: number;
  /** Azimuth from north, clockwise. */
  az: number;
  /** Unit vector toward the sun. */
  dir: Vec3;
}

/** Declination and equation of time for a fractional year angle. */
function orbit(gamma: number): { decl: number; eot: number } {
  const g = gamma;
  const eot =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    (0.006918 -
      0.399912 * Math.cos(g) +
      0.070257 * Math.sin(g) -
      0.006758 * Math.cos(2 * g) +
      0.000907 * Math.sin(2 * g) -
      0.002697 * Math.cos(3 * g) +
      0.00148 * Math.sin(3 * g)) /
    RAD;
  return { decl, eot };
}

function yearAngle(ms: number): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const days = Date.UTC(y + 1, 0, 1) - start === 366 * 86400e3 ? 366 : 365;
  const dayFrac = (ms - start) / 86400e3; // 0 at the start of 1 January
  return ((2 * Math.PI) / days) * (dayFrac - 0.5);
}

/** Declination and equation of time at an instant; they barely move in a day. */
export function season(ms: number): { decl: number; eot: number } {
  return orbit(yearAngle(ms));
}

/** Unit vector toward the sun for a latitude, declination, and hour angle. */
export function sunVector(lat: number, decl: number, ha: number): Vec3 {
  const p = lat * RAD;
  const d = decl * RAD;
  const h = ha * RAD;
  return {
    e: -Math.cos(d) * Math.sin(h),
    n: Math.cos(p) * Math.sin(d) - Math.sin(p) * Math.cos(d) * Math.cos(h),
    u: Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(h),
  };
}

export function sunAt(ms: number, lat: number, lon: number): Sun {
  const { decl, eot } = season(ms);
  const d = new Date(ms);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const ha = wrap180((minutes + eot + 4 * lon) / 4 - 180);
  const dir = sunVector(lat, decl, ha);
  return {
    decl,
    eot,
    ha,
    alt: Math.asin(Math.max(-1, Math.min(1, dir.u))) / RAD,
    az: (Math.atan2(dir.e, dir.n) / RAD + 360) % 360,
    dir,
  };
}

/** Half the day's arc: the hour angle of sunrise and sunset (0 in polar night, 180 under the midnight sun). */
export function halfDay(lat: number, decl: number, altitude = -0.833): number {
  const p = lat * RAD;
  const d = decl * RAD;
  const c = (Math.sin(altitude * RAD) - Math.sin(p) * Math.sin(d)) / (Math.cos(p) * Math.cos(d));
  if (c <= -1) return 180;
  if (c >= 1) return 0;
  return Math.acos(c) / RAD;
}

export function wrap180(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

/**
 * The date lines a dial traditionally carries: the sun's declination as it enters each sign of the zodiac,
 * so the solstices, the equinoxes, and the four pairs between (about 20 Jan and 22 Nov, 18 Feb and 23 Oct,
 * 20 Apr and 23 Aug, 21 May and 23 Jul).
 */
export const DATE_LINES: { decl: number; label?: string; major: boolean }[] = [
  { decl: OBLIQUITY, label: '21 JUN', major: true },
  { decl: 20.15, major: false },
  { decl: 11.47, major: false },
  { decl: 0, label: 'EQUINOX', major: true },
  { decl: -11.47, major: false },
  { decl: -20.15, major: false },
  { decl: -OBLIQUITY, label: '21 DEC', major: true },
];
