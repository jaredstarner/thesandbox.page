// Web Mercator on the unit square, and the spherical sums a navigator does.

const R_NM = 3440.065;
const RAD = Math.PI / 180;

export const mercX = (lon: number) => (lon + 180) / 360;
export function mercY(lat: number): number {
  const s = Math.sin(Math.max(-85, Math.min(85, lat)) * RAD);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
export const lonOf = (x: number) => x * 360 - 180;
export const latOf = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RAD;

/** Great-circle distance in nautical miles. */
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial true bearing from point 1 to point 2, degrees. */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
  const x =
    Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
    Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** The point a distance (nm) along a true bearing. */
export function destination(lat: number, lon: number, brg: number, nm: number): [number, number] {
  const d = nm / R_NM;
  const t = brg * RAD;
  const p1 = lat * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 =
    lon * RAD + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / RAD, ((l2 / RAD + 540) % 360) - 180];
}

/**
 * Geographic range: how far off a light of height H clears the horizon for an
 * eye at height h (both metres), with standard refraction. Bowditch: 2.08
 * times the square roots of the heights in metres gives nautical miles.
 */
export const geographicRange = (lightM: number, eyeM: number) =>
  2.08 * (Math.sqrt(Math.max(0, lightM)) + Math.sqrt(eyeM));

/** Dip of the sea horizon below eye level, degrees (1.76' per root metre). */
export const dip = (eyeM: number) => (1.76 * Math.sqrt(eyeM)) / 60;

/** 50°12.4'N 004°08.7'W */
export function formatPosition(lat: number, lon: number): string {
  const part = (v: number, w: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    let d = Math.floor(a);
    let m = Math.round((a - d) * 600) / 10;
    if (m >= 60) {
      d += 1;
      m = 0;
    }
    return `${String(d).padStart(w, '0')}°${m.toFixed(1).padStart(4, '0')}′${v < 0 ? neg : pos}`;
  };
  return `${part(lat, 2, 'N', 'S')} ${part(lon, 3, 'E', 'W')}`;
}

/** Nautical miles per Mercator unit at a latitude. */
export const nmPerUnit = (lat: number) => 21600 * Math.cos(lat * RAD);
