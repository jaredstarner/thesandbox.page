// A small PNG writer: 16-bit RGB, no filtering, compressed with the browser's
// own CompressionStream, and a cICP chunk (PNG Third Edition) naming the
// color primaries and transfer function, so one file can be Display P3 or HDR.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function zlib(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  void writer.write(data);
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Color primaries and transfer function codes from ITU-T H.273. */
export interface Cicp {
  primaries: number;
  transfer: number;
}

export const CICP_P3_SRGB: Cicp = { primaries: 12, transfer: 13 };
export const CICP_BT2020_PQ: Cicp = { primaries: 9, transfer: 16 };

/** Encode a square image of encoded RGB samples, each 0 to 1, as a 16-bit PNG. */
export async function encodePng(size: number, rgb: Float32Array, cicp: Cicp): Promise<Uint8Array> {
  const raw = new Uint8Array(size * (1 + size * 6));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size * 3; x++) {
      const v = Math.round(Math.min(1, Math.max(0, rgb[y * size * 3 + x]!)) * 65535);
      raw[o++] = v >> 8;
      raw[o++] = v & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr.set([16, 2, 0, 0, 0], 8);
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('cICP', Uint8Array.from([cicp.primaries, cicp.transfer, 0, 1])),
    chunk('IDAT', await zlib(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function toDataUrl(bytes: Uint8Array, type = 'image/png'): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:${type};base64,${btoa(binary)}`;
}

/** The sRGB transfer function, linear light to encoded. */
export function srgbEncode(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** SMPTE ST 2084 (PQ): absolute luminance in nits to encoded. */
export function pqEncode(nits: number): number {
  const m1 = 2610 / 16384;
  const m2 = (2523 / 4096) * 128;
  const c1 = 3424 / 4096;
  const c2 = (2413 / 4096) * 32;
  const c3 = (2392 / 4096) * 32;
  const y = (Math.max(0, nits) / 10000) ** m1;
  return ((c1 + c2 * y) / (1 + c3 * y)) ** m2;
}
