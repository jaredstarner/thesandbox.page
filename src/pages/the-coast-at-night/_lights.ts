// Reads lights.bin (written by _catalog.ts) into columns.

import { ON, type Rhythm } from './_rhythm';
import type { Sector } from './_sectors';
import { COLOURS } from './_rhythm';
import { mercX, mercY } from './_geo';

export interface Lights {
  n: number;
  lat: Float64Array;
  lon: Float64Array;
  /** Mercator x and y, interleaved. */
  xy: Float32Array;
  rhythm: Uint16Array;
  sector: Uint16Array;
  height: Uint16Array;
  range: Uint8Array;
  colour: Uint8Array;
  floating: Uint8Array;
  /** 1 when the light is shown today; seasonal lights out of season are 0. */
  lit: Uint8Array;
  /** Seconds added to the clock for each light, so no two keep step. */
  phase: Float32Array;
  rhythms: Rhythm[];
  sectors: Sector[][];
  /** Nominal range of each sector, parallel to sectors. */
  sectorRanges: number[][];
  seasons: Map<number, [number, number]>;
  chunk: number;
}

const MAGIC = 0x4e414354;

/** A small integer hash, for each light's phase. */
function hash(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getFullYear(), 0, 1);
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 86400000) + 1;
}

export const inSeason = (season: [number, number], doy: number) =>
  season[0] <= season[1] ? doy >= season[0] && doy <= season[1] : doy >= season[0] || doy <= season[1];

export async function loadLights(url: string): Promise<Lights> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`lights ${res.status}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('lights: bad file');
  const n = dv.getUint32(8, true);
  const jsonLen = dv.getUint32(12, true);
  const offLat = 16;
  const offLon = offLat + 4 * n;
  const offRhythm = offLon + 4 * n;
  const offSector = offRhythm + 2 * n;
  const offHeight = offSector + 2 * n;
  const offRange = offHeight + 2 * n;
  const offColour = offRange + n;
  const offFlags = offColour + n;
  const offJson = (offFlags + n + 3) & ~3;
  const dLat = new Int32Array(buf, offLat, n);
  const dLon = new Int32Array(buf, offLon, n);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, offJson, jsonLen))) as {
    chunk: number;
    rhythms: [string, string, number, number[], number][];
    sectors: [number, number, number, number][][];
    seasons: [number, number, number][];
  };
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const xy = new Float32Array(n * 2);
  let a = 0;
  let o = 0;
  for (let i = 0; i < n; i++) {
    a += dLat[i];
    o += dLon[i];
    lat[i] = a / 1e6;
    lon[i] = o / 1e6;
    xy[i * 2] = mercX(lon[i]);
    xy[i * 2 + 1] = mercY(lat[i]);
  }
  const rhythms: Rhythm[] = meta.rhythms.map(([label, says, period, steps, base]) => ({
    label,
    says,
    period,
    steps,
    base,
  }));
  const sectors: Sector[][] = [[]];
  const sectorRanges: number[][] = [[]];
  for (const set of meta.sectors) {
    sectors.push(set.map(([from, to, c]) => ({ from, to, colour: COLOURS[c - 1] })));
    sectorRanges.push(set.map((s) => s[3]));
  }
  const seasons = new Map<number, [number, number]>(meta.seasons.map(([i, s, e]) => [i, [s, e]]));
  const rhythm = new Uint16Array(buf, offRhythm, n);
  const doy = dayOfYear(new Date());
  const lit = new Uint8Array(n).fill(1);
  for (const [i, s] of seasons) if (!inSeason(s, doy)) lit[i] = 0;
  const phase = new Float32Array(n);
  for (let i = 0; i < n; i++) phase[i] = hash(i) * (rhythms[rhythm[i]].period || 1);
  return {
    n,
    lat,
    lon,
    xy,
    rhythm,
    sector: new Uint16Array(buf, offSector, n),
    height: new Uint16Array(buf, offHeight, n),
    range: new Uint8Array(buf, offRange, n),
    colour: new Uint8Array(buf, offColour, n),
    floating: new Uint8Array(buf, offFlags, n),
    lit,
    phase,
    rhythms,
    sectors,
    sectorRanges,
    seasons,
    chunk: meta.chunk,
  };
}

export { ON };
