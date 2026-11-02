// The sun and the moon, from the Astronomical Almanac's low-precision formulae
// (good to about 0.01° for the sun and 0.3° for the moon, plenty for lighting),
// and the turn from the stars' frame to the Earth's.

export type Vec3 = [number, number, number];

const D = Math.PI / 180;

/** Mean Earth radius, km. The page draws the Earth as a sphere. */
export const R_EARTH = 6371;

export const julian = (ms: number) => ms / 86400000 + 2440587.5;

/** Greenwich mean sidereal time, radians. */
export function gmst(ms: number): number {
  const d = julian(ms) - 2451545.0;
  const t = d / 36525;
  const deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000;
  return ((((deg % 360) + 360) % 360) * D) as number;
}

/** From the equatorial (inertial) frame to the Earth-fixed frame. */
export function toEarth(v: Vec3, g: number): Vec3 {
  const c = Math.cos(g);
  const s = Math.sin(g);
  return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2]];
}

const fromEcliptic = (lambda: number, beta: number, eps: number): Vec3 => {
  const cb = Math.cos(beta);
  const x = cb * Math.cos(lambda);
  const y = cb * Math.sin(lambda);
  const z = Math.sin(beta);
  return [x, y * Math.cos(eps) - z * Math.sin(eps), y * Math.sin(eps) + z * Math.cos(eps)];
};

/** Unit vector toward the sun, inertial frame. */
export function sunDir(ms: number): Vec3 {
  const n = julian(ms) - 2451545.0;
  const L = (280.46 + 0.9856474 * n) * D;
  const g = (357.528 + 0.9856003 * n) * D;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D;
  const eps = (23.439 - 0.0000004 * n) * D;
  return fromEcliptic(lambda, 0, eps);
}

/** Unit vector toward the moon (geocentric), inertial frame, and its distance in km. */
export function moonDir(ms: number): { dir: Vec3; km: number } {
  const T = (julian(ms) - 2451545.0) / 36525;
  const s = (a: number, b: number) => Math.sin((a + b * T) * D);
  const c = (a: number, b: number) => Math.cos((a + b * T) * D);
  const lambda =
    218.32 +
    481267.881 * T +
    6.29 * s(135.0, 477198.87) -
    1.27 * s(259.3, -413335.36) +
    0.66 * s(235.7, 890534.22) +
    0.21 * s(269.9, 954397.74) -
    0.19 * s(357.5, 35999.05) -
    0.11 * s(186.5, 966404.03);
  const beta = 5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21);
  const pi =
    0.9508 +
    0.0518 * c(135.0, 477198.87) +
    0.0095 * c(259.3, -413335.36) +
    0.0078 * c(235.7, 890534.22) +
    0.0028 * c(269.9, 954397.74);
  const eps = (23.439 - 0.0130042 * T) * D;
  return { dir: fromEcliptic(lambda * D, beta * D, eps), km: 6378.14 / Math.sin(pi * D) };
}

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const norm = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Latitude and longitude in degrees of an Earth-fixed vector. */
export function latLon(p: Vec3): { lat: number; lon: number } {
  return { lat: Math.asin(p[2] / len(p)) / D, lon: Math.atan2(p[1], p[0]) / D };
}

/** Earth-fixed unit vector of a latitude and longitude in degrees. */
export function fromLatLon(lat: number, lon: number): Vec3 {
  const cl = Math.cos(lat * D);
  return [cl * Math.cos(lon * D), cl * Math.sin(lon * D), Math.sin(lat * D)];
}

/** The sun's latitude and longitude (the subsolar point), for the map's night shade. */
export function subsolar(ms: number): { lat: number; lon: number } {
  return latLon(toEarth(sunDir(ms), gmst(ms)));
}
