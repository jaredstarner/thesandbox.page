// This afternoon in the chosen town: today's date there, when the sun sets, and the weather, from
// Open-Meteo's free forecast. If that doesn't answer, the sun is worked out here and the weather
// goes unmentioned.

export interface Weather {
  code: number;
  temp: number;
  wind: number;
}

export interface Sky {
  /** Minutes after local midnight. */
  sunset: number;
  /** Local date there, YYYY-MM-DD. */
  date: string;
  /** 0 is Sunday. */
  weekday: number;
  weather: Weather | null;
}

const FORECAST = 'https://api.open-meteo.com/v1/forecast';

/** Sunset by the NOAA approximation, in minutes after midnight at a given UTC offset. */
export function sunsetAt(lat: number, lon: number, date: Date, offsetMin: number): number {
  const rad = Math.PI / 180;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start) / 86400000);
  const g = ((2 * Math.PI) / 365) * (day - 1 + 0.5);
  const eqt =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const cosH = (Math.cos(90.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
  const h = Math.acos(Math.max(-1, Math.min(1, cosH))) / rad;
  const utc = 720 - 4 * (lon - h) - eqt;
  return (((utc + offsetMin) % 1440) + 1440) % 1440;
}

function guess(lat: number, lon: number): Sky {
  const now = new Date();
  const offset = Math.round(lon / 15) * 60;
  const local = new Date(now.getTime() + offset * 60000);
  return {
    sunset: sunsetAt(lat, lon, now, offset),
    date: local.toISOString().slice(0, 10),
    weekday: local.getUTCDay(),
    weather: null,
  };
}

/** Today's sky over a point; never throws. */
export async function skyOver(lat: number, lon: number): Promise<Sky> {
  const url =
    `${FORECAST}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    '&hourly=weather_code,temperature_2m,wind_speed_10m&daily=sunset&timezone=auto&forecast_days=1';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return guess(lat, lon);
    const j = await res.json();
    const date: string = j.daily.time[0];
    const sunset: string = j.daily.sunset[0];
    const [hh, mm] = sunset.slice(11, 16).split(':').map(Number);
    const at = j.hourly.time.findIndex((t: string) => t.endsWith('T17:00'));
    const i = at >= 0 ? at : Math.min(16, j.hourly.time.length - 1);
    const weather: Weather = {
      code: j.hourly.weather_code[i],
      temp: j.hourly.temperature_2m[i],
      wind: j.hourly.wind_speed_10m[i],
    };
    const [y, mo, d] = date.split('-').map(Number);
    return {
      sunset: hh * 60 + mm,
      date,
      weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(),
      weather: Number.isFinite(weather.code) ? weather : null,
    };
  } catch {
    return guess(lat, lon);
  }
}

export type Light = 'day' | 'low' | 'dusk' | 'dark';

/** How light it is, by minutes before or after sunset. */
export function lightAt(clock: number, sunset: number): Light {
  const d = clock - sunset;
  if (d < -50) return 'day';
  if (d < 5) return 'low';
  if (d < 35) return 'dusk';
  return 'dark';
}

export type Wet = 'dry' | 'drizzle' | 'rain' | 'snow' | 'fog' | 'storm';

export function wetOf(w: Weather | null): Wet {
  if (!w) return 'dry';
  const c = w.code;
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 95) return 'storm';
  return 'dry';
}

/** One sentence on the weather for the opening, or null. */
export function weatherLine(w: Weather | null, light: Light): string | null {
  if (!w) return null;
  const temp =
    w.temp < 1
      ? 'bitterly cold'
      : w.temp < 7
        ? 'cold'
        : w.temp < 13
          ? 'chilly'
          : w.temp < 20
            ? 'mild'
            : w.temp < 27
              ? 'warm'
              : 'hot';
  const windy = w.wind > 30 ? ' and blowing hard' : w.wind > 18 ? ' and breezy' : '';
  const wet = wetOf(w);
  const sky =
    wet === 'fog'
      ? 'Fog has come down over the rooftops'
      : wet === 'drizzle'
        ? 'A fine drizzle is falling'
        : wet === 'rain'
          ? 'It is raining steadily'
          : wet === 'snow'
            ? 'Snow is falling'
            : wet === 'storm'
              ? 'Thunder grumbles somewhere off to the west'
              : w.code <= 1
                ? light === 'day'
                  ? 'The sky is clear'
                  : 'The sky is clear and darkening'
                : w.code === 2
                  ? 'Clouds are drifting over'
                  : 'The sky is a lid of grey cloud';
  return `${sky}; it is ${temp}${windy}.`;
}

/** "half past five", "a quarter to six", "ten past four". */
export function clockWords(min: number): string {
  const m = Math.round(min) % 1440;
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const five = Math.round(mm / 5) * 5;
  const hour = (k: number) =>
    ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'][
      ((k % 12) + 12) % 12
    ];
  if (five === 0 || five === 60) return `${hour(five === 60 ? h + 1 : h)} o’clock`;
  if (five === 30) return `half past ${hour(h)}`;
  if (five === 15) return `a quarter past ${hour(h)}`;
  if (five === 45) return `a quarter to ${hour(h + 1)}`;
  const words = ['', 'five', 'ten', 'a quarter', 'twenty', 'twenty-five'];
  if (five < 30) return `${words[five / 5]} past ${hour(h)}`;
  h += 1;
  return `${words[(60 - five) / 5]} to ${hour(h)}`;
}

/** "4:47". */
export function clockDigits(min: number): string {
  const m = Math.floor(min) % 1440;
  const h = Math.floor(m / 60) % 12 || 12;
  return `${h}:${String(m % 60).padStart(2, '0')}`;
}
