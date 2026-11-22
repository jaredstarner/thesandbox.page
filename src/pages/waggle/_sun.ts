// Where the sun stands over the valley: a southern European latitude in July.

export const LATITUDE = 44;
/** Day of the year the first day falls on (8 July). */
export const FIRST_DAY = 189;

const RAD = Math.PI / 180;

export interface Sun {
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Degrees above the horizon. */
  altitude: number;
}

/** Sun position for a day of the year and a local solar time in hours. */
export function sunAt(dayOfYear: number, hours: number): Sun {
  const phi = LATITUDE * RAD;
  const decl = 23.44 * RAD * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const h = (hours - 12) * 15 * RAD;
  const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(h);
  const altitude = Math.asin(sinAlt) / RAD;
  const fromSouth = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
  const azimuth = (fromSouth / RAD + 180 + 360) % 360;
  return { azimuth, altitude };
}

/** Signed angle a - b folded into -180..180. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function formatClock(minutes: number): string {
  const m = Math.floor(minutes) % (24 * 60);
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
