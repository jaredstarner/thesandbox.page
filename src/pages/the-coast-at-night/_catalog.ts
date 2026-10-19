// Build time only: reads the light snapshot, parses every characteristic and
// sector, and packs the result for the browser (see _lights.ts for the reader).

import tsv from './_data/lights.tsv?raw';
import { parseCharacter, code, type Colour, type Rhythm } from './_rhythm';
import { parseRanges, parseSeason, parseSectors } from './_sectors';

export const MAGIC = 0x4e414354;
/** Lights per details file, in catalogue order. */
export const CHUNK = 1000;

export interface Detail {
  name: string;
  region: string;
  label: string;
  height: number;
  range: string;
  structure: string;
  remarks: string;
  source: string;
}

interface Light {
  lat: number;
  lon: number;
  rhythm: number;
  sectors: number;
  height: number;
  range: number;
  colour: number;
  floating: boolean;
  season: [number, number] | null;
  detail: Detail;
  key: number;
}

const USCG_REGIONS: Record<string, string> = {
  '1': 'United States, Atlantic coast, Maine to New Jersey',
  '2': 'United States, Atlantic coast, New Jersey to South Carolina',
  '3': 'United States, Atlantic and Gulf coasts, South Carolina to Florida, and Puerto Rico',
  '4': 'United States, Gulf of Mexico',
  '5': 'United States, Mississippi River system',
  '6': 'United States, Pacific coast and islands',
  '7': 'Great Lakes, United States and Canada',
};

const SMALL = new Set(['and', 'of', 'the', 'de', 'da', 'del', 'la', 'le', 'du', 'des', 'di', 'do', 'y', 'e']);

/** "ITALY-WEST COAST AND ADJACENT ISLANDS" to "Italy, west coast and adjacent islands". */
function region(heading: string): string {
  const [country, ...rest] = heading.split('-');
  const word = (w: string, i: number) =>
    SMALL.has(w.toLowerCase()) && i > 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const c = country
    .trim()
    .split(/\s+/)
    .map((w, i) => (/^\(.*\)$/.test(w) ? w : word(w, i)))
    .join(' ');
  const tail = rest.join(' ').trim().toLowerCase();
  return tail ? `${c}, ${tail}` : c;
}

/** Remarks for the light card: radio activation and AIS boilerplate taken out. */
function remarksFor(r: string): string {
  return r
    .split(/(?<=\.)\s+/)
    .filter((s) => !/MRASS|Key microphone|VHF|MMSI|AIS\b|channel \d|Radar Reflector|Private Aid/i.test(s))
    .join(' ')
    .slice(0, 320);
}

/** Interleave 16 bits each of x and y, so nearby lights sit near each other in the file. */
function morton(x: number, y: number): number {
  let k = 0;
  for (let i = 15; i >= 0; i--) k = k * 4 + ((y >> i) & 1) * 2 + ((x >> i) & 1);
  return k;
}

const mercY = (lat: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

export interface Catalog {
  lights: Light[];
  rhythms: Rhythm[];
  sectors: [number, number, number, number][][];
}

let cached: Catalog | null = null;

export function catalog(): Catalog {
  if (cached) return cached;
  const rhythms: Rhythm[] = [];
  const rhythmIds = new Map<string, number>();
  const sectors: [number, number, number, number][][] = [];
  const sectorIds = new Map<string, number>();
  const lights: Light[] = [];

  const rows = tsv.split('\n').slice(1);
  for (const row of rows) {
    if (!row) continue;
    const [src, ref, raw, heading, lat, lon, char, height, range, structure, remarks] = row.split('\t');
    // NGA writes degrees in names as ^ and minutes as a backtick.
    const name = raw.replace(/(\d)\^/g, '$1°').replace(/(\d)`/g, '$1′');
    const c = parseCharacter(char);
    if (!c) continue;
    const rk = JSON.stringify(c.rhythm);
    let ri = rhythmIds.get(rk);
    if (ri === undefined) {
      ri = rhythms.length;
      rhythms.push(c.rhythm);
      rhythmIds.set(rk, ri);
    }
    const primary: Colour = c.colours.includes('W') ? 'W' : c.colours[0];
    const ranges = parseRanges(range, c.colours);
    const maxRange = Math.max(0, ...Object.values(ranges).map((n) => n ?? 0));
    const sec = parseSectors(remarks, primary, src as 'nga' | 'uscg');
    let si = 0;
    if (sec) {
      const packed = sec.map(
        (s) =>
          [
            Math.round(s.from * 10) / 10,
            Math.round(s.to * 10) / 10,
            code(s.colour ?? primary),
            ranges[s.colour ?? primary] ?? maxRange,
          ] as [number, number, number, number],
      );
      const sk = JSON.stringify(packed);
      si = sectorIds.get(sk) ?? 0;
      if (!si) {
        sectors.push(packed);
        si = sectors.length;
        sectorIds.set(sk, si);
      }
    }
    const la = Number(lat);
    const lo = Number(lon);
    const vol = ref.split('-')[0];
    lights.push({
      lat: la,
      lon: lo,
      rhythm: ri,
      sectors: si,
      height: Number(height) || 0,
      range: maxRange,
      colour: code(primary),
      floating: /buoy|lanby|light ?float|light ?vessel|lightship|superbuoy/i.test(name + ' ' + structure),
      season: parseSeason(remarks),
      detail: {
        name,
        region: src === 'uscg' ? USCG_REGIONS[vol] : region(heading),
        label: c.rhythm.label,
        height: Number(height) || 0,
        range,
        structure,
        remarks: remarksFor(remarks),
        source: src === 'uscg' ? `USCG Light List vol. ${vol}, ${ref.slice(vol.length + 1)}` : `NGA Pub. ${ref}`,
      },
      key: morton(Math.floor(((lo + 180) / 360) * 65535), Math.floor(mercY(la) * 65535)),
    });
  }
  lights.sort((a, b) => a.key - b.key);
  cached = { lights, rhythms, sectors };
  return cached;
}

/**
 * The browser's copy: a 16-byte header (magic, version, count, JSON length),
 * then typed columns, then a JSON tail with the rhythms, sector sets, and
 * seasons. Positions are microdegrees, each a difference from the light
 * before, so the file compresses well.
 */
export function packed(): Uint8Array<ArrayBuffer> {
  const { lights, rhythms, sectors } = catalog();
  const n = lights.length;
  const json = new TextEncoder().encode(
    JSON.stringify({
      chunk: CHUNK,
      rhythms: rhythms.map((r) => [r.label, r.says, r.period, r.steps, r.base]),
      sectors,
      seasons: lights.flatMap((l, i) => (l.season ? [[i, ...l.season]] : [])),
    }),
  );
  const pad4 = (b: number) => (b + 3) & ~3;
  const offLat = 16;
  const offLon = offLat + 4 * n;
  const offRhythm = offLon + 4 * n;
  const offSector = offRhythm + 2 * n;
  const offHeight = offSector + 2 * n;
  const offRange = offHeight + 2 * n;
  const offColour = offRange + n;
  const offFlags = offColour + n;
  const offJson = pad4(offFlags + n);
  const buf = new ArrayBuffer(offJson + json.length);
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, 1, true);
  dv.setUint32(8, n, true);
  dv.setUint32(12, json.length, true);
  const lat = new Int32Array(buf, offLat, n);
  const lon = new Int32Array(buf, offLon, n);
  const rhythm = new Uint16Array(buf, offRhythm, n);
  const sector = new Uint16Array(buf, offSector, n);
  const height = new Uint16Array(buf, offHeight, n);
  const range = new Uint8Array(buf, offRange, n);
  const colour = new Uint8Array(buf, offColour, n);
  const flags = new Uint8Array(buf, offFlags, n);
  let pLat = 0;
  let pLon = 0;
  lights.forEach((l, i) => {
    const a = Math.round(l.lat * 1e6);
    const o = Math.round(l.lon * 1e6);
    lat[i] = a - pLat;
    lon[i] = o - pLon;
    pLat = a;
    pLon = o;
    rhythm[i] = l.rhythm;
    sector[i] = l.sectors;
    height[i] = Math.min(65535, Math.round(l.height));
    range[i] = Math.min(255, Math.round(l.range));
    colour[i] = l.colour;
    flags[i] = l.floating ? 1 : 0;
  });
  new Uint8Array(buf, offJson).set(json);
  return new Uint8Array(buf);
}

/** Card details for one file of CHUNK lights, as arrays to keep the files small. */
export function details(chunk: number): (string | number)[][] {
  return catalog()
    .lights.slice(chunk * CHUNK, (chunk + 1) * CHUNK)
    .map(({ detail: d }) => [d.name, d.region, d.label, d.height, d.range, d.structure, d.remarks, d.source]);
}

export const chunkCount = () => Math.ceil(catalog().lights.length / CHUNK);
