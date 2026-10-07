// The sky follows the visitor's clock. Sunrise and sunset are fixed stand-ins
// (about 6:20 and 7:20), not worked out for anyone's location; the moon's phase
// is real, counted from a known new moon.

export type Color = [number, number, number];

export interface Sky {
  skyTop: Color;
  skyHorizon: Color;
  hillFar: Color;
  hillNear: Color;
  cloud: Color;
  waterTop: Color;
  waterDeep: Color;
  /** Multiplier for everything lit by the sky. */
  light: Color;
  stars: number;
  rays: number;
  caustics: number;
  /** 0 by day, 1 at night: lanterns, the glowing float, plankton. */
  night: number;
}

const hex = (h: number): Color => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

type Palette = [number, number, number, number, number, number, number];

interface Key {
  hour: number;
  sky: Sky;
}

function key(hour: number, c: Palette, light: Color, stars: number, rays: number, caustics: number, night: number): Key {
  return {
    hour,
    sky: {
      skyTop: hex(c[0]),
      skyHorizon: hex(c[1]),
      hillFar: hex(c[2]),
      hillNear: hex(c[3]),
      cloud: hex(c[4]),
      waterTop: hex(c[5]),
      waterDeep: hex(c[6]),
      light,
      stars,
      rays,
      caustics,
      night,
    },
  };
}

//                  sky top   horizon   far hill  near hill cloud     water top deep water
const NIGHT: Palette = [0x0a1230, 0x1c2a58, 0x1a2344, 0x111a34, 0x2a3560, 0x1f4f88, 0x0a1a3a];
const PREDAWN: Palette = [0x262f68, 0xc56f88, 0x3b3a64, 0x27294a, 0x8c6f9a, 0x3a669e, 0x132950];
const DAWN: Palette = [0x6f9fd8, 0xffc58c, 0x8c88a8, 0x5d6a7b, 0xffe0c4, 0x4ca0c8, 0x1b4d85];
const DAY: Palette = [0x78b2f4, 0xcde6ff, 0x9fb5ca, 0x6c8d78, 0xffffff, 0x3cb3d6, 0x195ca6];
const GOLDEN: Palette = [0x86a3dc, 0xffd290, 0xb29a9b, 0x7b796a, 0xfff0d6, 0x48a2c3, 0x1a4e88];
const DUSK: Palette = [0x3c3d85, 0xf08a6b, 0x5c4a6e, 0x3a3452, 0xc98a92, 0x386a9c, 0x12305c];

const KEYS: Key[] = [
  key(0, NIGHT, [0.36, 0.43, 0.7], 1, 0, 0.12, 1),
  key(4.6, NIGHT, [0.36, 0.43, 0.7], 1, 0, 0.12, 1),
  key(5.6, PREDAWN, [0.6, 0.56, 0.74], 0.35, 0.1, 0.3, 0.6),
  key(6.6, DAWN, [1, 0.86, 0.78], 0, 0.6, 0.7, 0.05),
  key(8.5, DAY, [1, 1, 1], 0, 1, 1, 0),
  key(16.5, DAY, [1, 1, 1], 0, 1, 1, 0),
  key(18.2, GOLDEN, [1.04, 0.9, 0.76], 0, 0.8, 0.8, 0),
  key(19.3, DUSK, [0.74, 0.62, 0.72], 0.2, 0.2, 0.35, 0.45),
  key(20.3, NIGHT, [0.36, 0.43, 0.7], 1, 0, 0.12, 1),
  key(24, NIGHT, [0.36, 0.43, 0.7], 1, 0, 0.12, 1),
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixColor = (a: Color, b: Color, t: number): Color => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** The sky at an hour of the day, 0 to 24. */
export function skyAt(hour: number): Sky {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].hour <= h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = (h - a.hour) / (b.hour - a.hour);
  const s = t * t * (3 - 2 * t);
  return {
    skyTop: mixColor(a.sky.skyTop, b.sky.skyTop, s),
    skyHorizon: mixColor(a.sky.skyHorizon, b.sky.skyHorizon, s),
    hillFar: mixColor(a.sky.hillFar, b.sky.hillFar, s),
    hillNear: mixColor(a.sky.hillNear, b.sky.hillNear, s),
    cloud: mixColor(a.sky.cloud, b.sky.cloud, s),
    waterTop: mixColor(a.sky.waterTop, b.sky.waterTop, s),
    waterDeep: mixColor(a.sky.waterDeep, b.sky.waterDeep, s),
    light: mixColor(a.sky.light, b.sky.light, s),
    stars: mix(a.sky.stars, b.sky.stars, s),
    rays: mix(a.sky.rays, b.sky.rays, s),
    caustics: mix(a.sky.caustics, b.sky.caustics, s),
    night: mix(a.sky.night, b.sky.night, s),
  };
}

const SUNRISE = 6.33;
const SUNSET = 19.33;

/** The sun's path: 0 at sunrise to 1 at sunset, or null below the horizon. */
export function sunProgress(hour: number): number | null {
  const s = (hour - SUNRISE) / (SUNSET - SUNRISE);
  return s >= 0 && s <= 1 ? s : null;
}

/** The moon crosses the night sky between sunset and sunrise (a stand-in path). */
export function moonProgress(hour: number): number | null {
  const night = 24 - (SUNSET - SUNRISE);
  const m = (((hour - SUNSET) % 24) + 24) % 24;
  return m <= night ? m / night : null;
}

const SYNODIC_DAYS = 29.530588853;
/** A new moon: 6 January 2000, 18:14 UTC. */
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

/** The moon's phase, 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
export function moonPhase(date: Date): number {
  const days = (date.getTime() - NEW_MOON_MS) / 86_400_000;
  return (((days / SYNODIC_DAYS) % 1) + 1) % 1;
}

/** A word for the time of day. */
export function partOfDay(hour: number): string {
  if (hour < 4.6) return 'Night';
  if (hour < 6.6) return 'Dawn';
  if (hour < 11) return 'Morning';
  if (hour < 14) return 'Midday';
  if (hour < 17.5) return 'Afternoon';
  if (hour < 19.3) return 'Evening';
  if (hour < 20.3) return 'Dusk';
  return 'Night';
}

/** Coarse time bands the fish keep. */
export type Hours = 'dawn' | 'day' | 'dusk' | 'night';

export function hoursAt(hour: number): Hours {
  if (hour >= 4.8 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17.8) return 'day';
  if (hour >= 17.8 && hour < 20.6) return 'dusk';
  return 'night';
}
