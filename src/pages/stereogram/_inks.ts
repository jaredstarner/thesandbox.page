// Inks and the textures free pixels take their colour from. The solver only
// decides which pixels match; the texture decides what the match looks like.

export type InkId = 'newsprint' | 'riso' | 'phosphor' | 'ember';
export type Grain = 'fine' | 'coarse' | 'mottle';

interface Ink {
  /** Dot colours with their weights, for random dots. */
  dots: [string, number][];
  /** A ramp from ground to darkest, for the mottled pattern. */
  ramp: string[];
}

export const INKS: Record<InkId, Ink> = {
  newsprint: {
    dots: [
      ['#ebe5d8', 3],
      ['#cdc4b2', 2],
      ['#968e7f', 2],
      ['#55504a', 1.5],
      ['#1b1916', 1.5],
    ],
    ramp: ['#ebe5d8', '#d3cab8', '#a39b8b', '#6b655b', '#2c2925'],
  },
  riso: {
    dots: [
      ['#f3efe4', 3],
      ['#ff4f9a', 2],
      ['#2f5bd0', 2],
      ['#5b2f8c', 1.2],
      ['#ffb0cf', 1.3],
    ],
    ramp: ['#f3efe4', '#ffb0cf', '#ff4f9a', '#7f4fb8', '#2f5bd0'],
  },
  phosphor: {
    dots: [
      ['#060d08', 3.4],
      ['#0f3a1c', 2],
      ['#1f7a3a', 1.6],
      ['#5cff8a', 1.1],
      ['#c8ffd8', 0.5],
    ],
    ramp: ['#060d08', '#0c2c16', '#17592b', '#36b25a', '#8dffad'],
  },
  ember: {
    dots: [
      ['#150a06', 3.2],
      ['#4a160a', 2],
      ['#8c2c12', 1.6],
      ['#e0662a', 1.2],
      ['#f8c06a', 0.7],
    ],
    ramp: ['#150a06', '#3d1309', '#7a2810', '#d0581f', '#f6b45c'],
  },
};

/** A colour as the little-endian RGBA word ImageData expects. */
export function rgba(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  return (0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff)) >>> 0;
}

/** mulberry32: a small seeded generator, so a texture can be made again exactly. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted(ink: Ink): Uint32Array {
  // 64 slots, filled in proportion to the weights, so a pick is one lookup.
  const total = ink.dots.reduce((sum, [, w]) => sum + w, 0);
  const table = new Uint32Array(64);
  let i = 0;
  let acc = 0;
  for (const [hex, w] of ink.dots) {
    acc += w;
    const end = Math.round((acc / total) * 64);
    const c = rgba(hex);
    while (i < end) table[i++] = c;
  }
  while (i < 64) table[i++] = rgba(ink.dots[ink.dots.length - 1][0]);
  return table;
}

/** Random dots, one colour per texel. */
export function dots(id: InkId, w: number, h: number, seed: number): Uint32Array {
  const table = weighted(INKS[id]);
  const next = random(seed);
  const tex = new Uint32Array(w * h);
  for (let i = 0; i < tex.length; i++) tex[i] = table[(next() * 64) | 0];
  return tex;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/**
 * A mottled pattern that wraps seamlessly across its width (the far plane's
 * separation, so the background repeats without a seam), posterized to the
 * ink's ramp with ordered dithering, and flecked with dots so the eyes have
 * fine detail to lock on to.
 */
export function mottle(id: InkId, w: number, h: number, seed: number, cell: number): Uint32Array {
  const ink = INKS[id];
  const ramp = ink.ramp.map(rgba);
  const next = random(seed);
  const lattice = new Float32Array(4096);
  for (let i = 0; i < lattice.length; i++) lattice[i] = next();
  const hash = (ix: number, iy: number) => lattice[((ix * 73856093) ^ (iy * 19349663)) & 4095];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

  const octaves = [
    { cells: Math.max(2, Math.round(w / cell)), amp: 0.6 },
    { cells: Math.max(4, Math.round((w / cell) * 2.2)), amp: 0.28 },
    { cells: Math.max(8, Math.round((w / cell) * 5)), amp: 0.12 },
  ];
  const tex = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let o = 0; o < octaves.length; o++) {
        const { cells, amp } = octaves[o];
        const size = w / cells;
        const u = x / size;
        const t = y / size + o * 17.3;
        const ix = Math.floor(u);
        const iy = Math.floor(t);
        const fx = fade(u - ix);
        const fy = fade(t - iy);
        const x0 = ((ix % cells) + cells) % cells;
        const x1 = (x0 + 1) % cells;
        const a = hash(x0 + o * 977, iy);
        const b = hash(x1 + o * 977, iy);
        const c = hash(x0 + o * 977, iy + 1);
        const d = hash(x1 + o * 977, iy + 1);
        v += amp * (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy);
      }
      // Stretch the middle of the distribution so every step of the ramp shows up.
      const s = Math.min(0.999, Math.max(0, (v - 0.22) / 0.56));
      const level = s * (ramp.length - 1) + BAYER[(y & 3) * 4 + (x & 3)] - 0.5;
      const i = y * w + x;
      // Flecks a step or two off the local tone: fine detail without a coat of grit.
      const roll = next();
      const off = roll < 0.06 ? -1 : roll < 0.12 ? 1 : roll < 0.14 ? 2 : roll < 0.16 ? -2 : 0;
      tex[i] = ramp[Math.min(ramp.length - 1, Math.max(0, Math.round(level) + off))];
    }
  }
  return tex;
}

/** The ground colour of an ink, for the guide dots' strip and the page behind the picture. */
export function ground(id: InkId): string {
  return INKS[id].dots[0][0];
}
