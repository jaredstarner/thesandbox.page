// Where the station is: its latest two-line element set, flown forward with
// SGP4 (satellite.js), turned into the Earth's frame, plus the station's own
// sunrises and sunsets.

import { eciToGeodetic, propagate, twoline2satrec, type SatRec } from 'satellite.js';
import { cross, dot, gmst, latLon, len, norm, R_EARTH, sub, sunDir, toEarth, type Vec3 } from './_sky';

/** The element set on hand when the page was built, for when neither source answers. */
const BAKED: [string, string] = [
  '1 25544U 98067A   26305.78918649  .00005925  00000+0  11503-3 0  9991',
  '2 25544  51.6332 339.1679 0007095 336.8847  23.1822 15.49143202593084',
];

export type TleSource = 'celestrak' | 'tle-api' | 'baked';

const timed = async (url: string, ms: number) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
};

const valid = (l1?: string, l2?: string): l1 is string =>
  !!l1 && !!l2 && l1.startsWith('1 25544') && l2.startsWith('2 25544') && l1.length >= 69 && l2.length >= 69;

/** CelesTrak first, then a second keyless mirror, then the baked set. */
export async function loadTle(): Promise<{ lines: [string, string]; source: TleSource }> {
  try {
    const text = await (await timed('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE', 6000)).text();
    const rows = text
      .split(/\r?\n/)
      .map((r) => r.trimEnd())
      .filter(Boolean);
    const l1 = rows.find((r) => r.startsWith('1 '));
    const l2 = rows.find((r) => r.startsWith('2 '));
    if (valid(l1, l2)) return { lines: [l1, l2!], source: 'celestrak' };
  } catch {
    // Fall through to the mirror.
  }
  try {
    const j = (await (await timed('https://tle.ivanstanojevic.me/api/tle/25544', 6000)).json()) as {
      line1?: string;
      line2?: string;
    };
    if (valid(j.line1, j.line2)) return { lines: [j.line1, j.line2!], source: 'tle-api' };
  } catch {
    // Fall through to the baked set.
  }
  return { lines: BAKED, source: 'baked' };
}

export interface Fix {
  ms: number;
  /** Earth-fixed position, km. */
  pos: Vec3;
  /** Local vertical, Earth-fixed. */
  up: Vec3;
  /** Along the orbit (the station's flying direction), level with the ground, Earth-fixed. */
  ahead: Vec3;
  lat: number;
  lon: number;
  /** Height above the mean sphere, km, as the page draws it. */
  alt: number;
  /** Height above the WGS 84 ellipsoid, km, as the readout gives it. */
  height: number;
  /** Speed in the inertial frame, km/s. */
  speed: number;
  /** True while the station is in the Earth's shadow. */
  dark: boolean;
}

/** The station counts as in shadow once the sun has set behind the Earth's limb, seen from orbit;
 * the extra 20 km stands in for the lower atmosphere, which hides the sun a little sooner. */
const SHADOW_R = R_EARTH + 20;

const shadowed = (posEci: Vec3, sun: Vec3) => {
  const along = dot(posEci, sun);
  if (along > 0) return false;
  const perp = sub(posEci, [sun[0] * along, sun[1] * along, sun[2] * along]);
  return len(perp) < SHADOW_R;
};

export class Orbit {
  readonly rec: SatRec;
  /** Epoch of the element set, ms. */
  readonly epoch: number;

  constructor(readonly lines: [string, string]) {
    this.rec = twoline2satrec(lines[0], lines[1]);
    const yy = Number(lines[0].slice(18, 20));
    const doy = Number(lines[0].slice(20, 32));
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    this.epoch = Date.UTC(year, 0, 1) + (doy - 1) * 86400000;
  }

  private eci(ms: number): { p: Vec3; v: Vec3 } | null {
    const pv = propagate(this.rec, new Date(ms));
    if (!pv || typeof pv.position !== 'object') return null;
    const { position: p, velocity: v } = pv;
    return { p: [p.x, p.y, p.z], v: [v.x, v.y, v.z] };
  }

  at(ms: number): Fix | null {
    const e = this.eci(ms);
    if (!e) return null;
    const g = gmst(ms);
    const pos = toEarth(e.p, g);
    const up = norm(pos);
    // The station flies in the orbit's frame, so "ahead" follows the inertial velocity.
    const vel = toEarth(e.v, g);
    const ahead = norm(cross(up, cross(vel, up)));
    const { lat, lon } = latLon(pos);
    return {
      ms,
      pos,
      up,
      ahead,
      lat,
      lon,
      alt: len(pos) - R_EARTH,
      height: eciToGeodetic({ x: e.p[0], y: e.p[1], z: e.p[2] }, g).height,
      speed: len(e.v),
      dark: shadowed(e.p, sunDir(ms)),
    };
  }

  /** Sub-station points from `from` to `to`, every `step` ms. */
  track(from: number, to: number, step: number): { lat: number; lon: number }[] {
    const out: { lat: number; lon: number }[] = [];
    for (let t = from; t <= to; t += step) {
      const e = this.eci(t);
      if (e) out.push(latLon(toEarth(e.p, gmst(t))));
    }
    return out;
  }

  /** The next time the station crosses into or out of the Earth's shadow, searched up to two orbits ahead. */
  nextChange(ms: number): { at: number; to: 'light' | 'dark' } | null {
    const lit = (t: number) => {
      const e = this.eci(t);
      return e ? !shadowed(e.p, sunDir(t)) : true;
    };
    const now = lit(ms);
    const step = 20000;
    for (let t = ms + step; t < ms + 3 * 3600000; t += step) {
      if (lit(t) !== now) {
        let lo = t - step;
        let hi = t;
        while (hi - lo > 200) {
          const mid = (lo + hi) / 2;
          if (lit(mid) === now) lo = mid;
          else hi = mid;
        }
        return { at: hi, to: now ? 'dark' : 'light' };
      }
    }
    return null;
  }
}
