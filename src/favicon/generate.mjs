// Writes the site's raster icons to public/ from the Tray mark. No dependencies;
// run `node src/favicon/generate.mjs` after changing the mark and commit the
// output. src/favicon/tray.svg is the hand-written vector of the same shape.
//
// Every icon is an opaque tile, so one image reads on light and dark tab strips
// without alpha or media queries. The tab icon, favicon-hdr.png, is a 16-bit
// PNG whose cICP chunk declares BT.2020 primaries and the PQ transfer function
// (absolute luminance up to 10,000 nits). Where a browser honours it on an HDR
// display, the grain renders brighter than SDR white; elsewhere it is
// tone-mapped to an ordinary orange.

import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const out = new URL('../../public/', import.meta.url);

// --- The mark, on a 32-unit grid (matches public/favicon.svg) ---------------

/** The tray: two walls and a floor, 4 units thick, with rounded outer corners. */
function inTray(x, y) {
  if (y >= 6 && y <= 24 && ((x >= 4 && x <= 8) || (x >= 24 && x <= 28))) return true;
  if (y >= 24 && y <= 28 && x >= 8 && x <= 24) return true;
  if (y >= 24 && x <= 8) return (x - 8) ** 2 + (y - 24) ** 2 <= 16;
  if (y >= 24 && x >= 24) return (x - 24) ** 2 + (y - 24) ** 2 <= 16;
  return false;
}

/** The grain: a disc of radius 4 in the middle of the tray. */
const inGrain = (x, y) => (x - 16) ** 2 + (y - 16) ** 2 <= 16;

// --- Colour ------------------------------------------------------------------

const SDR_WHITE_NITS = 203; // ITU-R BT.2408 reference white for PQ content
const GRAIN_PEAK_NITS = 1000; // brightest channel of the HDR grain

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Linear sRGB to linear BT.2020 (ITU-R BT.2087). */
function srgbTo2020([r, g, b]) {
  return [
    0.6274 * r + 0.3293 * g + 0.0433 * b,
    0.0691 * r + 0.9195 * g + 0.0114 * b,
    0.0164 * r + 0.088 * g + 0.8956 * b,
  ];
}

/** PQ inverse EOTF (SMPTE ST 2084): nits to a 0..1 signal. */
function pq(nits) {
  const m1 = 0.1593017578125, m2 = 78.84375, c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
  const y = Math.max(0, nits) / 10000;
  const p = y ** m1;
  return ((c1 + c2 * p) / (1 + c3 * p)) ** m2;
}

/**
 * A colour as linear sRGB relative to SDR white, plus an HDR boost: the PQ
 * output scales it so its brightest BT.2020 channel reaches `peakNits`.
 */
function colour(h, peakNits) {
  const linear = hex(h).map(toLinear);
  const nits = srgbTo2020(linear).map((v) => v * SDR_WHITE_NITS);
  const scale = peakNits ? peakNits / Math.max(...nits) : 1;
  return { srgb: hex(h), pq: nits.map((v) => pq(v * scale)), linearNits: nits.map((v) => v * scale) };
}

// --- Rasterising ---------------------------------------------------------------

const SAMPLES = 16; // per axis, per pixel

/**
 * Renders the mark at `size` pixels on an opaque tile. `inset` pads the 32-unit
 * grid on every side, in grid units.
 */
function render(size, { ink, grain, tile, inset = 0 }) {
  const px = [];
  const unit = (32 + inset * 2) / size;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let t = 0, g = 0;
      for (let i = 0; i < SAMPLES; i++) {
        for (let j = 0; j < SAMPLES; j++) {
          const x = (col + (j + 0.5) / SAMPLES) * unit - inset;
          const y = (row + (i + 0.5) / SAMPLES) * unit - inset;
          if (inTray(x, y)) t++;
          else if (inGrain(x, y)) g++;
        }
      }
      const n = SAMPLES * SAMPLES;
      px.push({ tray: t / n, grain: g / n });
    }
  }
  return { size, px, ink, grain, tile };
}

/** 8-bit sRGB RGB samples, blended in linear light. */
function srgbSamples({ px, ink, grain, tile }) {
  const data = [];
  for (const { tray, grain: gc } of px) {
    for (let c = 0; c < 3; c++) {
      const v =
        toLinear(tile.srgb[c]) * (1 - tray - gc) + toLinear(ink.srgb[c]) * tray + toLinear(grain.srgb[c]) * gc;
      data.push(Math.round(toSrgb(clamp01(v)) * 255));
    }
  }
  return data;
}

/** 16-bit PQ RGB samples, blended in absolute linear light. */
function pqSamples({ px, ink, grain, tile }) {
  const data = [];
  for (const { tray, grain: gc } of px) {
    for (let c = 0; c < 3; c++) {
      const nits = tile.linearNits[c] * (1 - tray - gc) + ink.linearNits[c] * tray + grain.linearNits[c] * gc;
      data.push(Math.round(pq(nits) * 65535));
    }
  }
  return data;
}

// --- PNG and ICO -----------------------------------------------------------------

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/**
 * RGB PNG. `depth` is 8 or 16. `cicp` is [primaries, transfer, matrix, fullRange];
 * when absent, an sRGB chunk marks the image as sRGB.
 */
function png(size, samples, { depth = 8, cicp } = {}) {
  const bytesPer = depth / 8;
  const stride = size * 3 * bytesPer;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row++) {
    raw[row * (stride + 1)] = 0; // filter: none
    for (let i = 0; i < size * 3; i++) {
      const v = samples[row * size * 3 + i];
      const at = row * (stride + 1) + 1 + i * bytesPer;
      if (depth === 16) raw.writeUInt16BE(v, at);
      else raw[at] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([depth, 2, 0, 0, 0], 8); // colour type 2: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    cicp ? chunk('cICP', Buffer.from(cicp)) : chunk('sRGB', Buffer.from([0])),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO holding PNG images. */
function ico(images) {
  const dir = Buffer.alloc(6 + images.length * 16);
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(images.length, 4);
  let offset = dir.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    dir[e] = size >= 256 ? 0 : size;
    dir[e + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, e + 4); // planes
    dir.writeUInt16LE(24, e + 6); // bits per pixel
    dir.writeUInt32LE(data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([dir, ...images.map((i) => i.data)]);
}

// --- Output ------------------------------------------------------------------------

const BT2020_PQ = [9, 16, 0, 1]; // H.273 codes: BT.2020 primaries, PQ, identity matrix, full range
const ACCENT = '#ff4d1a';

const tile = colour('#111111');
const ink = colour('#f5f5f5');
const sdr = { tile, ink, grain: colour(ACCENT) };
const hdr = { tile, ink, grain: colour(ACCENT, GRAIN_PEAK_NITS) };

const icoImages = [16, 32, 48].map((size) => ({ size, data: png(size, srgbSamples(render(size, sdr))) }));
writeFileSync(new URL('favicon.ico', out), ico(icoImages));

writeFileSync(new URL('favicon-hdr.png', out), png(32, pqSamples(render(32, hdr)), { depth: 16, cicp: BT2020_PQ }));

// iOS rounds the corners of touch icons, so the mark sits further in. Kept SDR:
// a home-screen icon persists, and a reader that ignored cICP would show it washed out.
writeFileSync(new URL('apple-touch-icon.png', out), png(180, srgbSamples(render(180, { ...sdr, inset: 8 }))));
