// How this colony turns a flight into a dance and back again.
//
// Waggle-run duration grows with distance, but a bee measures distance by how fast the ground
// slides past her eyes. Tautz et al. (2004) moved feeders across a lake and found the duration
// grew three to four times more slowly per metre over water than over land. This colony's
// calibration sits inside their measured ranges: about 1.75 ms of waggle per metre of land,
// 0.5 ms per metre of water, plus a short fixed part.

import { fromBearing, type Land, type Pt } from './_land';

export const INTERCEPT_MS = 100;
export const LAND_MS_PER_M = 1.75;
export const WATER_MS_PER_M = 0.5;

/** The waggle duration a forager dances for a place, given what lies between it and the hive. */
export function durationFor(land: Land, x: number, y: number): number {
  const d = Math.hypot(x, y);
  const water = land.waterAlong(0, 0, x, y);
  return INTERCEPT_MS + LAND_MS_PER_M * (d - water) + WATER_MS_PER_M * water;
}

/** The duration if every metre were land, the way a reader who forgets the lake would count it. */
export function landDuration(distance: number): number {
  return INTERCEPT_MS + LAND_MS_PER_M * distance;
}

/** A recruit flies out on the bearing until her own odometer reads what the dance said. */
export function flyDance(land: Land, bearing: number, ms: number): Pt {
  const want = Math.max(0, ms - INTERCEPT_MS);
  const [ux, uy] = fromBearing(bearing, 1);
  let read = 0;
  let d = 0;
  const step = 8;
  while (read < want && d < 3600) {
    const x = ux * (d + step / 2);
    const y = uy * (d + step / 2);
    read += step * (land.isWater(x, y) ? WATER_MS_PER_M : LAND_MS_PER_M);
    d += step;
  }
  return [ux * d, uy * d];
}

/** How wide a recruit searches round the place she was sent, in metres. */
export function searchRadius(distance: number): number {
  return 70 + distance * 0.07;
}
