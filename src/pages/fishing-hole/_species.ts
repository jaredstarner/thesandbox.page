// The lake's fish, and how each is drawn. Sprites are built in code at each
// fish's own length, so a big bass is drawn bigger than a small one, not
// scaled. Sizes and weights are game numbers in a plausible range, not survey
// data.

import { rgb, type Sprite } from './_pixels';
import type { Hours } from './_daylight';

export type Pattern = 'sunfish' | 'bars' | 'blotches' | 'spots' | 'beans' | 'speckles' | 'scales' | 'none';

export interface Species {
  id: string;
  name: string;
  minCm: number;
  maxCm: number;
  /** kg = k * cm^3: deep-bodied fish weigh more for their length. */
  k: number;
  /** Body depth as a share of length. */
  depth: number;
  back: number;
  flank: number;
  belly: number;
  fin: number;
  mark: number;
  pattern: Pattern;
  forked: boolean;
  barbels: boolean;
  /** Where it lives: x range, and y range (world) unless it keeps to the bottom. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  bottom: boolean;
  school: boolean;
  /** Cruising speed, px per second. */
  speed: number;
  /** How hard it pulls, 0 to 1. */
  power: number;
  /** How long it keeps pulling. */
  endurance: number;
  /** How far away it notices bait, px. */
  sense: number;
  /** How readily it bites, 0 to 1. */
  bold: number;
  nibbles: [number, number];
  /** Seconds the float stays under before it lets go. */
  window: number;
  hours: Record<Hours, number>;
  jumps: boolean;
  count: number;
  /** A note for the catch card, by time band when it matters. */
  note: string;
}

export const SPECIES: Species[] = [
  {
    id: 'pumpkinseed',
    name: 'Pumpkinseed',
    minCm: 10,
    maxCm: 23,
    k: 2.1e-5,
    depth: 0.52,
    back: 0x5f7038,
    flank: 0xc9a24a,
    belly: 0xf0892c,
    fin: 0x7d8a48,
    mark: 0x3fa3a0,
    pattern: 'sunfish',
    forked: false,
    barbels: false,
    x0: 70,
    x1: 170,
    y0: 5,
    y1: 26,
    bottom: false,
    school: false,
    speed: 9,
    power: 0.22,
    endurance: 0.6,
    sense: 36,
    bold: 0.8,
    nibbles: [1, 4],
    window: 0.5,
    hours: { dawn: 0.8, day: 1, dusk: 0.8, night: 0.15 },
    jumps: false,
    count: 4,
    note: 'Keeps to the weeds by the dock.',
  },
  {
    id: 'perch',
    name: 'Yellow perch',
    minCm: 14,
    maxCm: 33,
    k: 1.3e-5,
    depth: 0.3,
    back: 0x4c5d2b,
    flank: 0xd8c047,
    belly: 0xf1ead0,
    fin: 0xe0782e,
    mark: 0x34401f,
    pattern: 'bars',
    forked: true,
    barbels: false,
    x0: 120,
    x1: 300,
    y0: 22,
    y1: 58,
    bottom: false,
    school: true,
    speed: 11,
    power: 0.32,
    endurance: 0.7,
    sense: 40,
    bold: 0.62,
    nibbles: [1, 3],
    window: 0.55,
    hours: { dawn: 1, day: 1, dusk: 0.8, night: 0.1 },
    jumps: false,
    count: 5,
    note: 'Travels in a school over the drop-off.',
  },
  {
    id: 'bass',
    name: 'Largemouth bass',
    minCm: 24,
    maxCm: 58,
    k: 1.56e-5,
    depth: 0.31,
    back: 0x3b582c,
    flank: 0x8fa65a,
    belly: 0xe9e4c4,
    fin: 0x5f7a3e,
    mark: 0x283b20,
    pattern: 'blotches',
    forked: false,
    barbels: false,
    x0: 214,
    x1: 312,
    y0: 34,
    y1: 70,
    bottom: false,
    school: false,
    speed: 13,
    power: 0.72,
    endurance: 1,
    sense: 52,
    bold: 0.55,
    nibbles: [0, 2],
    window: 0.7,
    hours: { dawn: 1, day: 0.6, dusk: 1, night: 0.35 },
    jumps: true,
    count: 2,
    note: 'Waits by the sunken log.',
  },
  {
    id: 'trout',
    name: 'Rainbow trout',
    minCm: 24,
    maxCm: 56,
    k: 1.17e-5,
    depth: 0.25,
    back: 0x56695a,
    flank: 0xc7cec7,
    belly: 0xf2f0ea,
    fin: 0x8d9a8e,
    mark: 0xe27a8c,
    pattern: 'spots',
    forked: true,
    barbels: false,
    x0: 150,
    x1: 420,
    y0: 10,
    y1: 46,
    bottom: false,
    school: false,
    speed: 16,
    power: 0.66,
    endurance: 0.9,
    sense: 46,
    bold: 0.45,
    nibbles: [1, 3],
    window: 0.5,
    hours: { dawn: 1, day: 0.45, dusk: 1, night: 0.2 },
    jumps: true,
    count: 2,
    note: 'Cruises open water, hungriest at dawn and dusk.',
  },
  {
    id: 'catfish',
    name: 'Channel catfish',
    minCm: 34,
    maxCm: 82,
    k: 1.16e-5,
    depth: 0.22,
    back: 0x56606b,
    flank: 0x8c96a0,
    belly: 0xe6e6e0,
    fin: 0x5b636c,
    mark: 0x2f353c,
    pattern: 'speckles',
    forked: true,
    barbels: true,
    x0: 170,
    x1: 372,
    y0: 0,
    y1: 0,
    bottom: true,
    school: false,
    speed: 8,
    power: 0.84,
    endurance: 1.3,
    sense: 62,
    bold: 0.72,
    nibbles: [2, 5],
    window: 1,
    hours: { dawn: 0.5, day: 0.2, dusk: 0.8, night: 1 },
    jumps: false,
    count: 2,
    note: 'Feeds on the bottom, mostly after dark.',
  },
  {
    id: 'pike',
    name: 'Northern pike',
    minCm: 45,
    maxCm: 102,
    k: 7.8e-6,
    depth: 0.16,
    back: 0x2e482b,
    flank: 0x5d7b3d,
    belly: 0xeae6c8,
    fin: 0xa35a3a,
    mark: 0xc8d68a,
    pattern: 'beans',
    forked: false,
    barbels: false,
    x0: 84,
    x1: 176,
    y0: 12,
    y1: 42,
    bottom: false,
    school: false,
    speed: 10,
    power: 0.9,
    endurance: 1.1,
    sense: 56,
    bold: 0.5,
    nibbles: [0, 0],
    window: 0.65,
    hours: { dawn: 0.9, day: 1, dusk: 0.8, night: 0.1 },
    jumps: false,
    count: 1,
    note: 'Hides at the weed edge and strikes without a nibble.',
  },
  {
    id: 'carp',
    name: 'Common carp',
    minCm: 35,
    maxCm: 80,
    k: 1.62e-5,
    depth: 0.32,
    back: 0x6b5a2a,
    flank: 0xc79a3e,
    belly: 0xead7a0,
    fin: 0x8a6a34,
    mark: 0xa47c2c,
    pattern: 'scales',
    forked: true,
    barbels: true,
    x0: 296,
    x1: 420,
    y0: 0,
    y1: 0,
    bottom: true,
    school: false,
    speed: 7,
    power: 0.8,
    endurance: 1.4,
    sense: 40,
    bold: 0.3,
    nibbles: [3, 6],
    window: 0.9,
    hours: { dawn: 0.7, day: 1, dusk: 0.6, night: 0.4 },
    jumps: false,
    count: 2,
    note: 'Grubs along the far bottom, wary of anything odd.',
  },
];

/** The thing that isn't a fish. */
export const BOOT_ID = 'boot';

function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function darken(hex: number, k: number): number {
  const r = Math.round(((hex >> 16) & 255) * k);
  const g = Math.round(((hex >> 8) & 255) * k);
  const b = Math.round((hex & 255) * k);
  return (r << 16) | (g << 8) | b;
}

const cache = new Map<string, Sprite>();

/** A fish facing right, drawn at length len px. Frame 1 flicks the tail. */
export function fishSprite(sp: Species, len: number, frame: 0 | 1, silhouette = false): Sprite {
  const L = Math.max(7, Math.round(len));
  const id = `${sp.id}:${L}:${frame}:${silhouette ? 1 : 0}`;
  const hit = cache.get(id);
  if (hit) return hit;

  const H = Math.max(3, Math.round(L * sp.depth));
  const tail = Math.max(2, Math.round(L * 0.19));
  const body = L - tail;
  const w = L + (sp.barbels ? 1 : 0);
  const h = H + 4;
  const cy = 1.5 + (H - 1) / 2;
  const px = new Uint32Array(w * h);
  const put = (x: number, y: number, c: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    px[y * w + x] = rgb(silhouette ? 0x1c2433 : c);
  };
  const halfAt = (u: number) => Math.max(0.6, (H / 2) * Math.pow(Math.max(0, 1 - ((u - 0.55) / 0.56) ** 2), 0.75));

  // Tail first, so the body overlaps its root.
  for (let t = 0; t < tail; t++) {
    const x = tail - 1 - t;
    const reach = 0.8 + ((t + 1) / tail) * H * 0.48;
    const lift = frame === 1 && t > 0 ? 1 : 0;
    for (let y = Math.round(cy - reach); y <= Math.round(cy + reach); y++) {
      const notch = sp.forked && t === tail - 1 && Math.abs(y - cy) < reach * 0.45;
      if (notch) continue;
      const edge = Math.abs(y - cy) >= reach - 0.6;
      put(x, y - lift, edge ? darken(sp.fin, 0.8) : sp.fin);
    }
  }

  for (let bx = 0; bx < body; bx++) {
    const x = tail + bx;
    const u = body > 1 ? bx / (body - 1) : 1;
    const half = halfAt(u);
    const top = Math.round(cy - half);
    const bottom = Math.round(cy + half);
    for (let y = top; y <= bottom; y++) {
      const rel = (y - cy) / Math.max(half, 0.5);
      let c = rel < -0.35 ? sp.back : rel > 0.45 ? sp.belly : sp.flank;
      switch (sp.pattern) {
        case 'bars':
          if (bx % 3 === 1 && rel < 0.3 && u > 0.12 && u < 0.85) c = sp.mark;
          break;
        case 'blotches':
          if (Math.abs(rel) < 0.25 && (bx + (y & 1)) % 3 !== 0 && u > 0.1 && u < 0.85) c = sp.mark;
          break;
        case 'spots':
          if (Math.abs(rel) < 0.22 && u > 0.15) c = sp.mark;
          else if (rel < 0.1 && hash(bx, y, 3) < 0.22) c = 0x1d2420;
          break;
        case 'beans':
          if (rel > -0.5 && rel < 0.4 && hash(bx >> 1, y, 5) < 0.3 && (bx + y) % 2 === 0 && u < 0.88) c = sp.mark;
          break;
        case 'speckles':
          if (rel < 0.3 && hash(bx, y, 7) < 0.14) c = sp.mark;
          break;
        case 'scales':
          if (rel > -0.4 && rel < 0.45 && (bx + y) % 2 === 0) c = sp.mark;
          break;
        case 'sunfish':
          if (u > 0.62 && u < 0.86 && rel > -0.3 && rel < 0.25 && (bx + y) % 2 === 0) c = sp.mark;
          if (bx === Math.round(body * 0.7) && y === Math.round(cy - half * 0.25)) c = 0x1a1a1a;
          if (bx === Math.round(body * 0.7) + 1 && y === Math.round(cy - half * 0.25)) c = 0xd8462e;
          break;
      }
      if (y === bottom && rel > 0.45) c = darken(c, 0.82);
      if (y === top) c = darken(c, 0.85);
      put(x, y, c);
    }
    // Dorsal fin along the back's middle.
    if (u > 0.3 && u < 0.66 && H >= 4) put(x, top - 1, sp.pattern === 'bars' && bx % 2 ? darken(sp.fin, 0.7) : darken(sp.back, 0.9));
    // A pelvic fin under the belly.
    if (Math.abs(u - 0.62) < 0.05 && H >= 4) put(x, bottom + 1, sp.fin);
  }

  const eyeX = tail + body - 1 - Math.max(1, Math.round(L * 0.08));
  const eyeHalf = halfAt((eyeX - tail) / Math.max(1, body - 1));
  const eyeY = Math.round(cy - eyeHalf * 0.3);
  put(eyeX, eyeY, 0x0e0f12);
  if (L >= 16) put(eyeX + 1, eyeY, 0xe8e2c8);

  if (sp.barbels) {
    const nx = tail + body - 1;
    put(nx + 1, Math.round(cy + 0.5), darken(sp.back, 0.7));
    put(nx + 1, Math.round(cy + 1.5), darken(sp.back, 0.7));
    put(nx, Math.round(cy + 2), darken(sp.back, 0.7));
  }

  const sprite = { w, h, px };
  cache.set(id, sprite);
  return sprite;
}

/** The boot, as a catch. */
export const BOOT_SPECIES: Species = {
  ...SPECIES[0],
  id: BOOT_ID,
  name: 'Old boot',
  minCm: 28,
  maxCm: 28,
  k: 0,
  power: 0.18,
  endurance: 3,
  jumps: false,
  note: 'Size ten, left foot. Somebody went home with one wet sock.',
};

const BOOT_ROWS = ['.bbb....', '.bbb....', '.bbb....', '.bbbbbb.', 'bbbbbbbb', 'ssssssss'];

export function bootSprite(silhouette = false): Sprite {
  const w = 8;
  const h = BOOT_ROWS.length;
  const px = new Uint32Array(w * h);
  BOOT_ROWS.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      if (row[x] === '.') continue;
      px[y * w + x] = rgb(silhouette ? 0x1c2433 : row[x] === 's' ? 0x1d1714 : y < 3 && x === 1 ? 0x4c372c : 0x3a2a22);
    }
  });
  return { w, h, px };
}

/** Weight in kg for a length in cm. */
export function weightOf(sp: Species, cm: number): number {
  return sp.id === BOOT_ID ? 0.6 : sp.k * cm * cm * cm;
}

/** A random length, skewed toward the small end, with the odd big one. */
export function randomLength(sp: Species): number {
  const r = Math.random();
  const trophy = Math.random() < 0.06;
  const t = trophy ? 0.85 + Math.random() * 0.15 : Math.pow(r, 1.35) * 0.9;
  return Math.round((sp.minCm + (sp.maxCm - sp.minCm) * t) * 10) / 10;
}

/** Sprite length in lake pixels for a length in cm. */
export function pixelLength(cm: number): number {
  return Math.round(5 + cm * 0.24);
}
