// Stamps for drawing into the code: shapes rasterized at module size, and a
// 5 x 7 pixel alphabet. Each returns a small grid of -1 (no wish), 0 (paper),
// or 1 (ink), already ringed with a one-module paper halo so it reads against
// the noise around it.

export interface Stamp {
  w: number;
  h: number;
  cells: Int8Array;
}

export const STAMPS = ['heart', 'star', 'smile', 'cat', 'moon', 'bolt'] as const;
export type StampName = (typeof STAMPS)[number];

function halo(s: Stamp): Stamp {
  const w = s.w + 2;
  const h = s.h + 2;
  const cells = new Int8Array(w * h).fill(-1);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) cells[(y + 1) * w + x + 1] = s.cells[y * s.w + x];
  const out = cells.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x] !== -1) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && cells[yy * w + xx] === 1) {
            near = true;
            break;
          }
        }
      if (near) out[y * w + x] = 0;
    }
  return { w, h, cells: out };
}

/** Rasterize an inside test over [-1, 1]^2 at n x n modules, 4 x 4 samples each. */
function raster(n: number, inside: (x: number, y: number) => number): Stamp {
  const cells = new Int8Array(n * n).fill(-1);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      let ink = 0;
      let paper = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const x = ((i + (sx + 0.5) / 4) / n) * 2 - 1;
          const y = ((j + (sy + 0.5) / 4) / n) * 2 - 1;
          const v = inside(x, y);
          if (v === 1) ink++;
          else if (v === 0) paper++;
        }
      if (ink >= 8) cells[j * n + i] = 1;
      else if (ink + paper >= 8) cells[j * n + i] = 0;
    }
  return { w: n, h: n, cells };
}

function inPolygon(x: number, y: number, pts: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const STAR = Array.from({ length: 10 }, (_, k) => {
  const a = -Math.PI / 2 + (k * Math.PI) / 5;
  const r = k % 2 === 0 ? 1 : 0.42;
  return [Math.cos(a) * r, Math.sin(a) * r * 1.02 + 0.08];
});

const BOLT = [
  [0.2, -1],
  [-0.55, 0.12],
  [-0.02, 0.12],
  [-0.3, 1],
  [0.6, -0.22],
  [0.06, -0.22],
  [0.42, -1],
];

const CAT = [
  ' #             # ',
  ' ##           ## ',
  ' #.#         #.# ',
  ' #..#########..# ',
  ' #.............# ',
  '#...............#',
  '#...##.....##...#',
  '#...##.....##...#',
  '#...............#',
  '#.......#.......#',
  '#......#.#......#',
  ' #....#...#....# ',
  ' #.............# ',
  '  ##.........##  ',
  '    #########    ',
];

function fromRows(rows: string[], scale: number): Stamp {
  const w = rows[0].length * scale;
  const h = rows.length * scale;
  const cells = new Int8Array(w * h).fill(-1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = rows[Math.floor(y / scale)][Math.floor(x / scale)];
      cells[y * w + x] = ch === '#' ? 1 : ch === '.' ? 0 : -1;
    }
  return { w, h, cells };
}

/** A stamp at size 1, 2, or 3. */
export function stamp(name: StampName, size: number): Stamp {
  const n = [0, 11, 17, 25][size] ?? 17;
  switch (name) {
    case 'heart':
      return halo(
        raster(n, (x, y) => {
          const X = x * 1.25;
          const Y = -(y * 1.25 - 0.18);
          const v = (X * X + Y * Y - 1) ** 3 - X * X * Y * Y * Y;
          return v <= 0 ? 1 : -1;
        }),
      );
    case 'star':
      return halo(raster(n, (x, y) => (inPolygon(x, y, STAR) ? 1 : -1)));
    case 'moon':
      return halo(
        raster(n, (x, y) => {
          const a = x * x + y * y < 0.92;
          const b = (x - 0.42) ** 2 + (y + 0.26) ** 2 < 0.62;
          return a && !b ? 1 : -1;
        }),
      );
    case 'bolt':
      return halo(raster(n, (x, y) => (inPolygon(x * 1.08, y * 1.02, BOLT) ? 1 : -1)));
    case 'smile':
      return halo(
        raster(n, (x, y) => {
          const r = Math.hypot(x, y);
          if (r > 0.97) return -1;
          const ring = n < 14 ? 0.8 : 0.84;
          if (r > ring) return 1;
          const eye = (ex: number) => Math.hypot((x - ex) * 1.4, (y + 0.28) * 0.8) < 0.17;
          if (eye(-0.33) || eye(0.33)) return 1;
          const mr = Math.hypot(x, y + 0.08);
          const band = n < 14 ? 0.15 : 0.11;
          if (y > 0.12 && Math.abs(mr - 0.5) < band) return 1;
          return 0;
        }),
      );
    case 'cat':
      return halo(fromRows(CAT, size >= 3 ? 2 : 1));
  }
}

// 5 x 7 capitals, digits, and a little punctuation; each glyph is 7 rows of 5 bits.
const GLYPHS: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  '?': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  ',': [0x00, 0x00, 0x00, 0x00, 0x0c, 0x04, 0x08],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  "'": [0x0c, 0x04, 0x08, 0x00, 0x00, 0x00, 0x00],
  '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  '+': [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
  ':': [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
  '#': [0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a],
  '<': [0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02],
  '>': [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08],
  '3h': [0x00, 0x0a, 0x1f, 0x1f, 0x0e, 0x04, 0x00],
};

/** Letters stamped at scale 1 or 2, lines split on "/" or newlines. */
export function lettering(text: string, scale: number): Stamp | null {
  const lines = text
    .toUpperCase()
    .replace(/♥|❤/g, '\u0001')
    .split(/\n|\//)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const glyph = (ch: string) => (ch === '\u0001' ? GLYPHS['3h'] : GLYPHS[ch]);
  const widths = lines.map((l) => Math.max(0, l.length * 6 - 1));
  const w0 = Math.max(...widths);
  const h0 = lines.length * 8 - 1;
  if (w0 <= 0) return null;
  const s = Math.max(1, Math.min(2, scale));
  const w = w0 * s;
  const h = h0 * s;
  const cells = new Int8Array(w * h).fill(0);
  lines.forEach((line, li) => {
    const x0 = Math.floor((w0 - widths[li]) / 2);
    [...line].forEach((ch, ci) => {
      const g = glyph(ch);
      if (!g) return;
      for (let gy = 0; gy < 7; gy++)
        for (let gx = 0; gx < 5; gx++)
          if (g[gy] & (0x10 >>> gx))
            for (let sy = 0; sy < s; sy++)
              for (let sx = 0; sx < s; sx++) {
                const x = (x0 + ci * 6 + gx) * s + sx;
                const y = (li * 8 + gy) * s + sy;
                cells[y * w + x] = 1;
              }
    });
  });
  // A paper plate behind the letters, one module wider all round.
  const pw = w + 2;
  const ph = h + 2;
  const plate = new Int8Array(pw * ph).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) plate[(y + 1) * pw + x + 1] = cells[y * w + x];
  return { w: pw, h: ph, cells: plate };
}
