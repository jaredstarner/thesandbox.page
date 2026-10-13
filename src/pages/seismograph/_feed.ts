// Live sources, both keyless and open to any origin: EarthScope's FDSN
// dataselect service for the waveform, and the USGS GeoJSON feeds for quakes.

import { parse, type Chunk } from './_mseed';

const DATASELECT = 'https://service.earthscope.org/fdsnws/dataselect/1/query';
const QUAKE_FEEDS = [
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
];

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

/** Vertical long-period samples from one station; an empty list when it has nothing for the span. */
export async function waveform(station: string, from: number, to: number, signal?: AbortSignal): Promise<Chunk[]> {
  const q = new URLSearchParams({
    net: 'IU',
    sta: station,
    loc: '00',
    cha: 'LHZ',
    starttime: iso(from),
    endtime: iso(to),
  });
  const res = await fetch(`${DATASELECT}?${q}`, { signal });
  if (res.status === 204 || res.status === 404) return [];
  if (!res.ok) throw new Error(`dataselect ${res.status}`);
  return parse(await res.arrayBuffer());
}

export interface Quake {
  id: string;
  mag: number;
  place: string;
  /** Origin time, epoch ms. */
  time: number;
  lat: number;
  lon: number;
  depth: number;
}

interface Feature {
  id: string;
  properties: { mag: number | null; place: string | null; time: number; type: string };
  geometry: { coordinates: [number, number, number] };
}

/** The last day's quakes of magnitude 2.5 and up, plus the last week's of 4.5 and up. */
export async function quakes(signal?: AbortSignal): Promise<Quake[]> {
  const got = await Promise.allSettled(
    QUAKE_FEEDS.map(async (url) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`usgs ${res.status}`);
      return ((await res.json()) as { features: Feature[] }).features;
    }),
  );
  const ok = got.filter((g): g is PromiseFulfilledResult<Feature[]> => g.status === 'fulfilled');
  if (!ok.length) throw new Error('no quake feed answered');
  const byId = new Map<string, Quake>();
  for (const g of ok) {
    for (const f of g.value) {
      const p = f.properties;
      if (p.mag == null || p.type !== 'earthquake' || byId.has(f.id)) continue;
      const [lon, lat, depth] = f.geometry.coordinates;
      byId.set(f.id, { id: f.id, mag: p.mag, place: p.place ?? 'Unnamed region', time: p.time, lat, lon, depth });
    }
  }
  return [...byId.values()].sort((a, b) => b.time - a.time);
}
