// Where a quake is from the station, and roughly when its waves arrive.
// Times are approximate: a shallow source in a standard layered Earth, from a
// coarse table at ten-degree steps, interpolated. Good enough to flag where
// to look on paper, not to pick phases.

const RAD = Math.PI / 180;

/** Great-circle distance in degrees and azimuth from a to b in degrees clockwise from north. */
export function geo(aLat: number, aLon: number, bLat: number, bLon: number): { dist: number; az: number } {
  const p1 = aLat * RAD;
  const p2 = bLat * RAD;
  const dl = (bLon - aLon) * RAD;
  const c = Math.acos(
    Math.min(1, Math.max(-1, Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl))),
  );
  const az = Math.atan2(
    Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
  );
  return { dist: c / RAD, az: (((az / RAD) % 360) + 360) % 360 };
}

// Seconds after origin, every 10 degrees from 0.
const P = [0, 148, 277, 373, 458, 538, 607, 668, 722, 773, 819];
// P diffracts around the core past about 100 degrees; then PKP returns past 140.
const PDIFF_SLOPE = 4.6;
const PKP = [
  [140, 1176],
  [150, 1192],
  [160, 1203],
  [170, 1209],
  [180, 1212],
];
const S = [0, 266, 505, 670, 830, 975, 1105, 1220, 1325, 1420];
/** Rayleigh waves travel the surface at roughly 3.8 km/s at the periods this channel sees. */
const RAYLEIGH_S_PER_DEG = 111.19 / 3.8;

function table(t: number[], d: number): number {
  const i = Math.min(t.length - 2, Math.floor(d / 10));
  const f = d / 10 - i;
  return t[i] + (t[i + 1] - t[i]) * f;
}

export interface Phase {
  name: 'P' | 'PKP' | 'S' | 'R1' | 'R2';
  /** Seconds after the origin time. */
  t: number;
}

export function phases(dist: number, mag: number): Phase[] {
  const out: Phase[] = [];
  if (dist <= 100) out.push({ name: 'P', t: table(P, dist) });
  else if (dist < 120) out.push({ name: 'P', t: P[10] + (dist - 100) * PDIFF_SLOPE });
  if (dist >= 140) {
    const i = Math.min(PKP.length - 2, Math.floor((dist - 140) / 10));
    const [d0, t0] = PKP[i];
    const [d1, t1] = PKP[i + 1];
    out.push({ name: 'PKP', t: t0 + ((t1 - t0) * (dist - d0)) / (d1 - d0) });
  }
  if (dist <= 90) out.push({ name: 'S', t: table(S, dist) });
  // Surface waves only stand out from a quake big enough to make them.
  if (mag >= 5 || dist < 20) out.push({ name: 'R1', t: dist * RAYLEIGH_S_PER_DEG });
  if (mag >= 6.5) out.push({ name: 'R2', t: (360 - dist) * RAYLEIGH_S_PER_DEG });
  return out;
}

/** Would this quake leave a visible mark on a long-period record at this distance? */
export function felt(dist: number, mag: number): boolean {
  if (mag >= 6) return true;
  if (mag >= 5.2) return dist < 120;
  if (mag >= 4.5) return dist < 40;
  if (mag >= 3.5) return dist < 8;
  return dist < 3;
}
