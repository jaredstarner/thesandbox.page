// Reads rivers.bin (written by _landpack.ts): the lit rivers, as segments for
// the chart and as a grid for asking whether a point is on the water.
//
// Natural Earth gives a river's centerline, not its banks, so a band either
// side of the line counts as water. The line is only good to about a
// kilometre, which sets the band's width.

import { latOf, lonOf } from './_geo';

const MAGIC = 0x53525652;
const GRID = 1 << 24;
/** Half the width of the band counted as river, km. */
export const RIVER_HALF_KM = 0.7;
const CELL = 0.05;

export interface Rivers {
  /** Segments in Mercator, x0 y0 x1 y1 each. */
  segments: Float32Array;
  /** The same in degrees, lon0 lat0 lon1 lat1, for distance tests. */
  degrees: Float64Array;
  /** Polylines in degrees, for drawing into the deck's land mask. */
  lines: [number, number][][];
  cells: Map<string, number[]>;
}

export async function loadRivers(url: string): Promise<Rivers> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`rivers ${res.status}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('rivers: bad file');
  const count = dv.getUint32(4, true);
  const points = dv.getUint32(8, true);
  const per = new Uint32Array(buf, 12, count);
  const d = new Int32Array(buf, 12 + 4 * count, points * 2);
  const segs: number[] = [];
  const degs: number[] = [];
  const lines: [number, number][][] = [];
  let x = 0;
  let y = 0;
  let k = 0;
  for (let l = 0; l < count; l++) {
    const line: [number, number][] = [];
    let px = 0;
    let py = 0;
    for (let i = 0; i < per[l]; i++) {
      x += d[k++];
      y += d[k++];
      const mx = x / GRID;
      const my = y / GRID;
      line.push([lonOf(mx), latOf(my)]);
      if (i > 0) segs.push(px, py, mx, my);
      px = mx;
      py = my;
    }
    for (let i = 1; i < line.length; i++) degs.push(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    lines.push(line);
  }
  const degrees = new Float64Array(degs);
  const cells = new Map<string, number[]>();
  for (let s = 0; s < degrees.length / 4; s++) {
    const [lo0, la0, lo1, la1] = degrees.subarray(s * 4, s * 4 + 4);
    for (let a = Math.floor(Math.min(la0, la1) / CELL); a <= Math.floor(Math.max(la0, la1) / CELL); a++)
      for (let b = Math.floor(Math.min(lo0, lo1) / CELL); b <= Math.floor(Math.max(lo0, lo1) / CELL); b++) {
        const key = `${a},${b}`;
        let c = cells.get(key);
        if (!c) cells.set(key, (c = []));
        c.push(s);
      }
  }
  return { segments: new Float32Array(segs), degrees, lines, cells };
}

/** Whether a point lies within the river band. */
export function onRiver(r: Rivers, lat: number, lon: number): boolean {
  return riverKm(r, lat, lon) < RIVER_HALF_KM;
}

/** Distance in km to the nearest drawn river, searched out to about 5 km; Infinity beyond. */
export function riverKm(r: Rivers, lat: number, lon: number): number {
  let best = Infinity;
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 111.32;
  const ca = Math.floor(lat / CELL);
  const cb = Math.floor(lon / CELL);
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (const s of r.cells.get(`${ca + a},${cb + b}`) ?? []) {
        const ax = (r.degrees[s * 4] - lon) * kx;
        const ay = (r.degrees[s * 4 + 1] - lat) * ky;
        const bx = (r.degrees[s * 4 + 2] - lon) * kx;
        const by = (r.degrees[s * 4 + 3] - lat) * ky;
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
      }
  return best;
}
