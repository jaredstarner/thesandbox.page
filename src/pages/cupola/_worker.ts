// Fetches and pieces together the picture tiles off the main thread, from NASA
// GIBS (keyless, open to any page). A day tile is Suomi NPP's VIIRS true
// colour for the chosen day, its gaps filled from NOAA-20's, and anything left
// (missed swaths, polar night) from the Blue Marble. An aux tile carries the
// Black Marble's night lights in RGB and open water in alpha.

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/';
const SIZE = 512;

export interface TileJob {
  id: number;
  kind: 'day' | 'aux';
  z: number;
  row: number;
  col: number;
  date: string;
}

export interface TileDone {
  id: number;
  ok: boolean;
  data?: Uint8Array;
  /** How much of the tile came from the chosen day's pictures, 0 to 1. */
  fresh?: number;
}

const canvas = new OffscreenCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

async function pixels(url: string, crop?: { x: number; y: number; s: number }): Promise<Uint8ClampedArray | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    const bmp = await createImageBitmap(await res.blob());
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (crop) ctx.drawImage(bmp, crop.x, crop.y, crop.s, crop.s, 0, 0, SIZE, SIZE);
    else ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
    bmp.close();
    return ctx.getImageData(0, 0, SIZE, SIZE).data;
  } catch {
    return null;
  }
}

/** A layer's tile, or the matching quarter of its parent when the layer stops a zoom short. */
function tile(layer: string, time: string, set: '250m' | '500m', max: number, ext: string, z: number, row: number, col: number) {
  if (z <= max) return pixels(`${GIBS}${layer}/default/${time}/${set}/${z}/${row}/${col}.${ext}`);
  const up = z - max;
  const k = 1 << up;
  const s = SIZE / k;
  return pixels(`${GIBS}${layer}/default/${time}/${set}/${max}/${row >> up}/${col >> up}.${ext}`, {
    x: (col % k) * s,
    y: (row % k) * s,
    s,
  });
}

/** Rows of the tile that lie on the globe (zoom 2's bottom row runs past the south pole). */
function globeRows(z: number, row: number): number {
  const span = 288 / 2 ** z;
  const top = 90 - row * span;
  return Math.max(0, Math.min(SIZE, Math.round(((top + 90) / span) * SIZE)));
}

/** Pure black is GIBS for "no picture here"; widen each hole by two pixels to take JPEG fringes with it. */
function holes(px: Uint8ClampedArray, rows: number): Uint8Array {
  const miss = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < rows * SIZE; i++) {
    const k = i * 4;
    if (Math.max(px[k], px[k + 1], px[k + 2]) < 9) miss[i] = 1;
  }
  for (let pass = 0; pass < 2; pass++) {
    const prev = miss.slice();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        if (prev[i]) continue;
        if ((x > 0 && prev[i - 1]) || (x < SIZE - 1 && prev[i + 1]) || (y > 0 && prev[i - SIZE]) || (y < rows - 1 && prev[i + SIZE]))
          miss[i] = 1;
      }
    }
  }
  return miss;
}

async function day(job: TileJob): Promise<TileDone> {
  const rows = globeRows(job.z, job.row);
  const out = new Uint8Array(SIZE * SIZE * 4);
  const miss = new Uint8Array(SIZE * SIZE).fill(1);
  const fill = (px: Uint8ClampedArray) => {
    const own = holes(px, rows);
    let left = 0;
    for (let i = 0; i < rows * SIZE; i++) {
      if (!miss[i]) continue;
      if (own[i]) {
        left++;
        continue;
      }
      const k = i * 4;
      out[k] = px[k];
      out[k + 1] = px[k + 1];
      out[k + 2] = px[k + 2];
      out[k + 3] = 255;
      miss[i] = 0;
    }
    return left;
  };
  let left = rows * SIZE;
  const viirs = [
    'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    'VIIRS_NOAA21_CorrectedReflectance_TrueColor',
  ];
  // Every zoom fills gaps by the same rule, so the levels agree where they overlap.
  for (const layer of viirs) {
    const px = await tile(layer, job.date, '250m', 8, 'jpg', job.z, job.row, job.col);
    if (px) left = fill(px);
    if (!left) break;
  }
  const fresh = rows ? 1 - left / (rows * SIZE) : 0;
  if (left) {
    const px = await tile('BlueMarble_NextGeneration', 'default', '500m', 7, 'jpg', job.z, job.row, job.col);
    if (px) {
      for (let i = 0; i < rows * SIZE; i++) {
        if (!miss[i]) continue;
        const k = i * 4;
        out[k] = px[k];
        out[k + 1] = px[k + 1];
        out[k + 2] = px[k + 2];
        out[k + 3] = 255;
        miss[i] = 0;
        left--;
      }
    }
  }
  if (left >= rows * SIZE) return { id: job.id, ok: false };
  return { id: job.id, ok: true, data: out, fresh };
}

async function aux(job: TileJob): Promise<TileDone> {
  const [lights, water] = await Promise.all([
    tile('VIIRS_Black_Marble', '2016-01-01', '500m', 7, 'png', job.z, job.row, job.col),
    tile('OSM_Land_Water_Map', 'default', '250m', 8, 'png', job.z, job.row, job.col),
  ]);
  if (!lights && !water) return { id: job.id, ok: false };
  const out = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const k = i * 4;
    if (lights) {
      out[k] = lights[k];
      out[k + 1] = lights[k + 1];
      out[k + 2] = lights[k + 2];
    }
    // The land and water map paints water mid grey (128) and land dark grey (75).
    out[k + 3] = water ? Math.max(0, Math.min(255, ((water[k] - 75) / 53) * 255)) : 0;
  }
  return { id: job.id, ok: true, data: out };
}

self.onmessage = async (e: MessageEvent<TileJob>) => {
  const job = e.data;
  const done = job.kind === 'day' ? await day(job) : await aux(job);
  if (done.data) (self as unknown as Worker).postMessage(done, [done.data.buffer]);
  else (self as unknown as Worker).postMessage(done);
};
