// The forecast: Open-Meteo's hourly model output for a place, and its place search.

export interface Place {
  name: string;
  /** Region and country, for telling namesakes apart. */
  where?: string;
  lat: number;
  lon: number;
}

export interface Hour {
  /** Start of the hour, epoch ms. */
  t: number;
  temp: number;
  /** WMO weather interpretation code. */
  code: number;
  cloud: number;
  cloudLow: number;
  /** mm in the hour. */
  precip: number;
  /** cm in the hour. */
  snowfall: number;
  /** Lying snow, m. */
  snowDepth: number;
  /** m. */
  visibility: number;
  /** km/h at 10 m. */
  wind: number;
  /** Degrees the wind blows from. */
  windFrom: number;
  humidity: number;
}

export interface Forecast {
  place: Place;
  /** Seconds east of UTC, for the place's local clock. */
  utcOffset: number;
  elevation: number;
  hours: Hour[];
  /** Set when this is the stored week rather than a live answer. */
  stored?: boolean;
}

const HOURLY = [
  'temperature_2m',
  'weather_code',
  'cloud_cover',
  'cloud_cover_low',
  'precipitation',
  'snowfall',
  'snow_depth',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'relative_humidity_2m',
] as const;

interface RawForecast {
  utc_offset_seconds: number;
  elevation: number;
  hourly: Record<string, (number | null)[]> & { time: number[] };
}

export function parseForecast(place: Place, raw: RawForecast): Forecast {
  const h = raw.hourly;
  const num = (key: string, i: number, fallback: number) => {
    const v = h[key]?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  const hours: Hour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    if (h.weather_code?.[i] == null) continue;
    hours.push({
      t: h.time[i] * 1000,
      temp: num('temperature_2m', i, 10),
      code: num('weather_code', i, 0),
      cloud: num('cloud_cover', i, 0),
      cloudLow: num('cloud_cover_low', i, 0),
      precip: num('precipitation', i, 0),
      snowfall: num('snowfall', i, 0),
      snowDepth: num('snow_depth', i, 0),
      visibility: num('visibility', i, 24000),
      wind: num('wind_speed_10m', i, 0),
      windFrom: num('wind_direction_10m', i, 270),
      humidity: num('relative_humidity_2m', i, 70),
    });
  }
  return { place, utcOffset: raw.utc_offset_seconds, elevation: raw.elevation, hours };
}

export async function fetchForecast(place: Place, signal?: AbortSignal): Promise<Forecast> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', place.lat.toFixed(3));
  url.searchParams.set('longitude', place.lon.toFixed(3));
  url.searchParams.set('hourly', HOURLY.join(','));
  url.searchParams.set('past_days', '1');
  url.searchParams.set('forecast_days', '7');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('timeformat', 'unixtime');
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  const raw = (await res.json()) as RawForecast;
  const f = parseForecast(place, raw);
  if (f.hours.length < 24) throw new Error('forecast too short');
  return f;
}

interface RawPlace {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  timezone?: string;
  population?: number;
}

export interface FoundPlace extends Place {
  timezone?: string;
  population?: number;
}

export async function searchPlaces(name: string, signal?: AbortSignal, count = 6): Promise<FoundPlace[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', name);
  url.searchParams.set('count', String(count));
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`geocoding ${res.status}`);
  const raw = (await res.json()) as { results?: RawPlace[] };
  return (raw.results ?? []).map((r) => ({
    name: r.name,
    where: [r.admin1, r.country].filter((s, i, a) => s && a.indexOf(s) === i && s !== r.name).join(', ') || undefined,
    lat: r.latitude,
    lon: r.longitude,
    timezone: r.timezone,
    population: r.population,
  }));
}

/** The city a time zone is named after, which is usually near the visitor. */
export function zoneCity(zone: string): string | null {
  const parts = zone.split('/');
  if (parts.length < 2 || parts[0] === 'Etc') return null;
  return parts[parts.length - 1].replace(/_/g, ' ');
}

/** Where a time zone's own city is, by asking the place search for it. */
export async function guessPlace(signal?: AbortSignal): Promise<Place | null> {
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return null;
  }
  const city = zoneCity(zone);
  if (!city) return null;
  const found = await searchPlaces(city, signal, 10);
  const match = found.find((p) => p.timezone === zone) ?? null;
  return match && { name: match.name, where: match.where, lat: match.lat, lon: match.lon };
}

// WMO weather interpretation codes, as Open-Meteo reports them.
export type Fall = 'none' | 'drizzle' | 'rain' | 'freezing' | 'snow' | 'hail';

export interface Kind {
  words: string;
  fall: Fall;
  /** 0..1, how hard it comes down. */
  intensity: number;
  fog: boolean;
  thunder: boolean;
}

export function describe(code: number): Kind {
  const k = (words: string, fall: Fall = 'none', intensity = 0, fog = false, thunder = false): Kind => ({
    words,
    fall,
    intensity,
    fog,
    thunder,
  });
  switch (code) {
    case 0:
      return k('Clear');
    case 1:
      return k('Mainly clear');
    case 2:
      return k('Broken cloud');
    case 3:
      return k('Overcast');
    case 45:
      return k('Fog', 'none', 0, true);
    case 48:
      return k('Freezing fog', 'none', 0, true);
    case 51:
      return k('Light drizzle', 'drizzle', 0.2);
    case 53:
      return k('Drizzle', 'drizzle', 0.35);
    case 55:
      return k('Thick drizzle', 'drizzle', 0.5);
    case 56:
    case 57:
      return k('Freezing drizzle', 'freezing', 0.35);
    case 61:
      return k('Light rain', 'rain', 0.35);
    case 63:
      return k('Rain', 'rain', 0.6);
    case 65:
      return k('Heavy rain', 'rain', 0.95);
    case 66:
    case 67:
      return k('Freezing rain', 'freezing', 0.6);
    case 71:
      return k('Light snow', 'snow', 0.35);
    case 73:
      return k('Snow', 'snow', 0.6);
    case 75:
      return k('Heavy snow', 'snow', 0.95);
    case 77:
      return k('Snow grains', 'snow', 0.25);
    case 80:
      return k('Showers', 'rain', 0.5);
    case 81:
      return k('Heavy showers', 'rain', 0.8);
    case 82:
      return k('Violent showers', 'rain', 1);
    case 85:
      return k('Snow showers', 'snow', 0.55);
    case 86:
      return k('Heavy snow showers', 'snow', 0.9);
    case 95:
      return k('Thunderstorm', 'rain', 0.8, false, true);
    case 96:
    case 99:
      return k('Thunderstorm with hail', 'hail', 0.9, false, true);
    default:
      return k(code > 3 ? 'Unsettled' : 'Clear');
  }
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
