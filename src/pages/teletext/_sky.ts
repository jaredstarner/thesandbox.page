// The almanac: the Moon's phase from the mean synodic month, and sunrise and
// sunset from the standard sunrise equation. Both run in the browser, so these
// pages never wait on a feed.

const SYNODIC = 29.530588853;
// A new moon: 2000 January 6, 18:14 UT, as a Julian day.
const NEW_MOON_JD = 2451550.26;
const DEG = Math.PI / 180;

export function julian(ms: number): number {
  return ms / 86400000 + 2440587.5;
}

export interface Moon {
  /** Days since new moon. */
  age: number;
  /** 0 at new, 1 at full. */
  lit: number;
  /** 0 to 2π, new to new. */
  angle: number;
  name: string;
  nextFull: Date;
  nextNew: Date;
}

const PHASES = [
  'New moon',
  'Waxing crescent',
  'First quarter',
  'Waxing gibbous',
  'Full moon',
  'Waning gibbous',
  'Last quarter',
  'Waning crescent',
];

export function moon(now = Date.now()): Moon {
  const jd = julian(now);
  const age = (((jd - NEW_MOON_JD) % SYNODIC) + SYNODIC) % SYNODIC;
  const angle = (age / SYNODIC) * 2 * Math.PI;
  const lit = (1 - Math.cos(angle)) / 2;
  const name = PHASES[Math.floor(((age / SYNODIC) * 8 + 0.5) % 8)];
  const toFull = (SYNODIC / 2 - age + SYNODIC) % SYNODIC;
  const toNew = SYNODIC - age;
  return {
    age,
    lit,
    angle,
    name,
    nextFull: new Date(now + toFull * 86400000),
    nextNew: new Date(now + toNew * 86400000),
  };
}

/** Whether a point on the disc (u, v in -1..1, v down) is sunlit, seen from the north. */
export function moonLit(u: number, v: number, angle: number): boolean {
  const w = Math.sqrt(Math.max(0, 1 - v * v));
  return angle <= Math.PI ? u > Math.cos(angle) * w : u < -Math.cos(angle) * w;
}

export interface Sun {
  rise: Date | null;
  set: Date | null;
  /** Hours of daylight; 0 or 24 when the Sun stays down or up. */
  length: number;
}

/** Today's sunrise and sunset at a place (east longitude positive), for the date it is there. */
export function sun(lat: number, lon: number, tz: string, now = Date.now()): Sun {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(now))
    .split('-')
    .map(Number);
  const day = Math.round(julian(Date.UTC(y, m - 1, d, 12)) - 2451545.0);
  const jStar = day - lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * DEG) + 0.02 * Math.sin(2 * M * DEG) + 0.0003 * Math.sin(3 * M * DEG);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const transit = 2451545.0 + jStar + 0.0053 * Math.sin(M * DEG) - 0.0069 * Math.sin(2 * lambda * DEG);
  const dec = Math.asin(Math.sin(lambda * DEG) * Math.sin(23.4397 * DEG));
  const cosH = (Math.sin(-0.833 * DEG) - Math.sin(lat * DEG) * Math.sin(dec)) / (Math.cos(lat * DEG) * Math.cos(dec));
  if (cosH > 1) return { rise: null, set: null, length: 0 };
  if (cosH < -1) return { rise: null, set: null, length: 24 };
  const H = Math.acos(cosH) / DEG;
  const toMs = (jd: number) => new Date((jd - 2440587.5) * 86400000);
  return { rise: toMs(transit - H / 360), set: toMs(transit + H / 360), length: (2 * H) / 15 };
}

/** HH:MM in a time zone. */
export function clock(d: Date, tz?: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(
    d,
  );
}
