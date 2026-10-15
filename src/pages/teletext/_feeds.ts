// The newsroom: fetches the live pages' material from free public sources,
// keeps the last good copy, and says when something changed. A source that
// fails leaves its pages showing a notice; nothing else depends on it.

export type Status = 'loading' | 'ok' | 'error';

export interface Story {
  headline: string;
  title: string;
  body: string;
}

export interface Weather {
  temp: number;
  code: number;
  isDay: boolean;
  hi: number;
  lo: number;
}

export interface Quake {
  mag: number;
  place: string;
  time: number;
  depth: number;
}

export interface Store {
  wiki: Status;
  news: Story[];
  onthisday: { year: number; text: string }[];
  tfa: { title: string; description: string; extract: string } | null;
  dyk: string[];
  fx: Status;
  /** Oldest first: each day's rates against one US dollar. */
  rates: { date: string; rates: Record<string, number> }[];
  weather: Status;
  /** Keyed by city name. */
  conditions: Record<string, Weather>;
  quakes: Status;
  quakeList: Quake[];
}

export const store: Store = {
  wiki: 'loading',
  news: [],
  onthisday: [],
  tfa: null,
  dyk: [],
  fx: 'loading',
  rates: [],
  weather: 'loading',
  conditions: {},
  quakes: 'loading',
  quakeList: [],
};

export interface City {
  name: string;
  /** A shorter name for narrow tables. */
  short?: string;
  lat: number;
  lon: number;
  tz: string;
}

export const US_CITIES: City[] = [
  { name: 'Seattle', lat: 47.61, lon: -122.33, tz: 'America/Los_Angeles' },
  { name: 'San Francisco', short: 'San Fran', lat: 37.77, lon: -122.42, tz: 'America/Los_Angeles' },
  { name: 'Los Angeles', lat: 34.05, lon: -118.24, tz: 'America/Los_Angeles' },
  { name: 'Phoenix', lat: 33.45, lon: -112.07, tz: 'America/Phoenix' },
  { name: 'Salt Lake City', short: 'Salt Lake', lat: 40.76, lon: -111.89, tz: 'America/Denver' },
  { name: 'Denver', lat: 39.74, lon: -104.99, tz: 'America/Denver' },
  { name: 'Minneapolis', lat: 44.98, lon: -93.27, tz: 'America/Chicago' },
  { name: 'Dallas', lat: 32.78, lon: -96.8, tz: 'America/Chicago' },
  { name: 'Chicago', lat: 41.88, lon: -87.63, tz: 'America/Chicago' },
  { name: 'Atlanta', lat: 33.75, lon: -84.39, tz: 'America/New_York' },
  { name: 'Miami', lat: 25.76, lon: -80.19, tz: 'America/New_York' },
  { name: 'New York', lat: 40.71, lon: -74.01, tz: 'America/New_York' },
];

export const WORLD_CITIES: City[] = [
  { name: 'Reykjavik', lat: 64.15, lon: -21.94, tz: 'Atlantic/Reykjavik' },
  { name: 'London', lat: 51.51, lon: -0.13, tz: 'Europe/London' },
  { name: 'Paris', lat: 48.86, lon: 2.35, tz: 'Europe/Paris' },
  { name: 'Moscow', lat: 55.76, lon: 37.62, tz: 'Europe/Moscow' },
  { name: 'Cairo', lat: 30.04, lon: 31.24, tz: 'Africa/Cairo' },
  { name: 'Nairobi', lat: -1.29, lon: 36.82, tz: 'Africa/Nairobi' },
  { name: 'Mumbai', lat: 19.08, lon: 72.88, tz: 'Asia/Kolkata' },
  { name: 'Beijing', lat: 39.9, lon: 116.41, tz: 'Asia/Shanghai' },
  { name: 'Tokyo', lat: 35.68, lon: 139.69, tz: 'Asia/Tokyo' },
  { name: 'Sydney', lat: -33.87, lon: 151.21, tz: 'Australia/Sydney' },
  { name: 'Honolulu', lat: 21.31, lon: -157.86, tz: 'Pacific/Honolulu' },
  { name: 'Anchorage', lat: 61.22, lon: -149.9, tz: 'America/Anchorage' },
  { name: 'Mexico City', lat: 19.43, lon: -99.13, tz: 'America/Mexico_City' },
  { name: 'Rio de Janeiro', short: 'Rio', lat: -22.91, lon: -43.17, tz: 'America/Sao_Paulo' },
];

export const CURRENCIES = ['EUR', 'GBP', 'JPY', 'CAD', 'MXN', 'CHF', 'AUD', 'CNY', 'INR', 'KRW', 'BRL', 'SEK'];

type Listener = (feed: 'wiki' | 'fx' | 'weather' | 'quakes') => void;
const listeners: Listener[] = [];
export function onFeed(fn: Listener): void {
  listeners.push(fn);
}
function emit(feed: 'wiki' | 'fx' | 'weather' | 'quakes'): void {
  for (const fn of listeners) fn(feed);
}

async function getJSON<T>(url: string): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Plain text from a fragment of Wikipedia's HTML, parsed inert. */
function plain(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function ymd(d: Date, sep = '/'): string {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join(sep);
}

interface WikiLink {
  titles: { canonical: string; normalized: string };
  extract?: string;
  description?: string;
}
interface Featured {
  news?: { story: string; links: WikiLink[] }[];
  onthisday?: { year: number; text: string }[];
  tfa?: WikiLink & { extract: string };
  dyk?: { html?: string; text?: string }[];
}

async function loadWiki(): Promise<void> {
  const today = new Date();
  let feed: Featured | null = null;
  for (const back of [0, 1]) {
    const d = new Date(today.getTime() - back * 86400000);
    try {
      feed = await getJSON<Featured>(`https://en.wikipedia.org/api/rest_v1/feed/featured/${ymd(d)}`);
      if (feed.news?.length) break;
    } catch {
      feed = null;
    }
  }
  if (!feed) {
    if (store.wiki !== 'ok') store.wiki = 'error';
    emit('wiki');
    return;
  }
  store.news = (feed.news ?? []).map((n) => {
    const doc = new DOMParser().parseFromString(`<body>${n.story}</body>`, 'text/html');
    const bold = doc.querySelector('b a[href]')?.getAttribute('href')?.replace(/^\.\//, '') ?? '';
    const link = n.links.find((l) => l.titles.canonical === decodeURIComponent(bold)) ?? n.links[0];
    return {
      headline: plain(n.story),
      title: link?.titles.normalized ?? '',
      body: link?.extract ?? '',
    };
  });
  store.onthisday = (feed.onthisday ?? []).map((e) => ({ year: e.year, text: e.text })).sort((a, b) => b.year - a.year);
  store.tfa = feed.tfa
    ? { title: feed.tfa.titles.normalized, description: feed.tfa.description ?? '', extract: feed.tfa.extract }
    : null;
  store.dyk = (feed.dyk ?? []).map((d) => (d.text ? d.text : plain(d.html ?? ''))).filter(Boolean);
  store.wiki = 'ok';
  emit('wiki');
}

async function loadFx(): Promise<void> {
  const start = new Date(Date.now() - 95 * 86400000);
  try {
    const j = await getJSON<{ rates: Record<string, Record<string, number>> }>(
      `https://api.frankfurter.dev/v1/${ymd(start, '-')}..?base=USD&symbols=${CURRENCIES.join(',')}`,
    );
    store.rates = Object.keys(j.rates)
      .sort()
      .map((date) => ({ date, rates: j.rates[date] }));
    store.fx = store.rates.length > 1 ? 'ok' : 'error';
  } catch {
    if (store.fx !== 'ok') store.fx = 'error';
  }
  emit('fx');
}

interface Meteo {
  current: { temperature_2m: number; weather_code: number; is_day: number };
  daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
}

async function loadWeather(): Promise<void> {
  const cities = [...US_CITIES, ...WORLD_CITIES];
  const lat = cities.map((c) => c.lat).join(',');
  const lon = cities.map((c) => c.lon).join(',');
  try {
    const j = await getJSON<Meteo[]>(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`,
    );
    cities.forEach((c, i) => {
      const m = j[i];
      if (!m) return;
      store.conditions[c.name] = {
        temp: m.current.temperature_2m,
        code: m.current.weather_code,
        isDay: m.current.is_day === 1,
        hi: m.daily.temperature_2m_max[0],
        lo: m.daily.temperature_2m_min[0],
      };
    });
    store.weather = 'ok';
  } catch {
    if (store.weather !== 'ok') store.weather = 'error';
  }
  emit('weather');
}

interface USGS {
  features: { properties: { mag: number; place: string; time: number }; geometry: { coordinates: number[] } }[];
}

async function loadQuakes(): Promise<void> {
  try {
    const j = await getJSON<USGS>('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson');
    store.quakeList = j.features
      .map((f) => ({
        mag: f.properties.mag,
        place: f.properties.place ?? 'Unknown place',
        time: f.properties.time,
        depth: f.geometry.coordinates[2] ?? 0,
      }))
      .sort((a, b) => b.time - a.time);
    store.quakes = 'ok';
  } catch {
    if (store.quakes !== 'ok') store.quakes = 'error';
  }
  emit('quakes');
}

/** Starts every feed and keeps them fresh while the page is open. */
export function startFeeds(): void {
  const every = (fn: () => Promise<void>, minutes: number) => {
    void fn();
    setInterval(() => {
      if (document.visibilityState === 'visible') void fn();
    }, minutes * 60000);
  };
  every(loadWiki, 30);
  every(loadFx, 60);
  every(loadWeather, 15);
  every(loadQuakes, 5);
}

/** Words for a WMO weather code, as a forecaster would put them, in ten letters or fewer. */
export function sky(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? 'Sunny' : 'Clear';
  if (code === 1) return isDay ? 'Bright' : 'Fair';
  if (code === 2) return 'Some cloud';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return code >= 65 ? 'Heavy rain' : 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Flurries';
  if (code >= 95) return 'Thunder';
  return 'Unsettled';
}
