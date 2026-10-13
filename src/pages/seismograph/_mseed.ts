// A small miniSEED 2 reader: fixed headers, blockette 1000, and Steim-1 and
// Steim-2 compressed integer data, which is what FDSN dataselect services
// return for broadband channels.

export interface Chunk {
  /** Start time of the first sample, epoch milliseconds. */
  start: number;
  /** Samples per second. */
  rate: number;
  samples: Int32Array;
}

function sampleRate(factor: number, mult: number): number {
  if (factor === 0) return 0;
  let rate = factor > 0 ? factor : -1 / factor;
  if (mult > 0) rate *= mult;
  else if (mult < 0) rate /= -mult;
  return rate;
}

/** Sign-extends the low `bits` bits of `v`. */
function signed(v: number, bits: number): number {
  const shift = 32 - bits;
  return (v << shift) >> shift;
}

function steim(view: DataView, offset: number, length: number, count: number, level: 1 | 2): Int32Array {
  const diffs: number[] = [];
  let x0 = 0;
  const frames = Math.floor(length / 64);
  for (let f = 0; f < frames; f++) {
    const base = offset + f * 64;
    const ctrl = view.getUint32(base);
    for (let w = 1; w < 16; w++) {
      const code = (ctrl >>> (30 - 2 * w)) & 3;
      const word = view.getUint32(base + w * 4);
      if (f === 0 && w === 1) {
        x0 = word | 0;
        continue;
      }
      if (f === 0 && w === 2) continue; // the last sample, a check we don't need
      if (code === 0) continue;
      if (code === 1) {
        for (let k = 3; k >= 0; k--) diffs.push(signed(word >>> (k * 8), 8));
      } else if (level === 1) {
        if (code === 2) {
          diffs.push(signed(word >>> 16, 16), signed(word, 16));
        } else {
          diffs.push(word | 0);
        }
      } else {
        const dnib = word >>> 30;
        let n = 0;
        let bits = 0;
        if (code === 2) {
          [n, bits] = dnib === 1 ? [1, 30] : dnib === 2 ? [2, 15] : dnib === 3 ? [3, 10] : [0, 0];
        } else {
          [n, bits] = dnib === 0 ? [5, 6] : dnib === 1 ? [6, 5] : dnib === 2 ? [7, 4] : [0, 0];
        }
        for (let k = n - 1; k >= 0; k--) diffs.push(signed(word >>> (k * bits), bits));
      }
    }
  }
  const out = new Int32Array(count);
  if (count === 0) return out;
  // The first difference is relative to the previous record; the first sample is x0.
  out[0] = x0;
  for (let i = 1; i < count && i < diffs.length; i++) out[i] = out[i - 1] + diffs[i];
  return out;
}

export function parse(buffer: ArrayBuffer): Chunk[] {
  const view = new DataView(buffer);
  const records: Chunk[] = [];
  let offset = 0;
  while (offset + 64 <= buffer.byteLength) {
    const count = view.getUint16(offset + 30);
    const rate = sampleRate(view.getInt16(offset + 32), view.getInt16(offset + 34));
    const dataOffset = view.getUint16(offset + 44);
    let blockette = view.getUint16(offset + 46);
    let encoding = 11;
    let length = 512;
    let guard = 0;
    while (blockette && blockette + 8 <= buffer.byteLength - offset && guard++ < 8) {
      const type = view.getUint16(offset + blockette);
      if (type === 1000) {
        encoding = view.getUint8(offset + blockette + 4);
        length = 2 ** view.getUint8(offset + blockette + 6);
      }
      blockette = view.getUint16(offset + blockette + 2);
    }
    const year = view.getUint16(offset + 20);
    const day = view.getUint16(offset + 22);
    const hour = view.getUint8(offset + 24);
    const minute = view.getUint8(offset + 25);
    const second = view.getUint8(offset + 26);
    const tenthMs = view.getUint16(offset + 28);
    let start = Date.UTC(year, 0, day, hour, minute, second) + tenthMs / 10;
    // Add a time correction the station logged but didn't apply.
    if (!(view.getUint8(offset + 36) & 2)) start += view.getInt32(offset + 40) / 10;
    if (count > 0 && rate > 0 && (encoding === 10 || encoding === 11) && dataOffset > 0) {
      const samples = steim(view, offset + dataOffset, length - dataOffset, count, encoding === 10 ? 1 : 2);
      records.push({ start, rate, samples });
    }
    offset += length;
  }
  return records;
}
