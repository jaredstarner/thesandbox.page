// The lake's shape: a side-on cut through a small lake, in world pixels.
// x runs from the dock's shore (0) to the far shore (WORLD_W). y is 0 at the
// still water line and grows downward, so the bed sits at positive y and the
// sky at negative y. The lake is the same on every visit, so its spots can be
// learned.

export const WORLD_W = 480;
/** Eight pixels to the foot, which makes the deepest hole about eleven feet. */
export const PX_PER_FT = 8;

export const DOCK_X0 = 6;
export const DOCK_X1 = 64;
/** The top of the deck planks. */
export const DECK_Y = -7;
export const PILINGS = [14, 30, 46, 62];
/** Where the angler stands, at the end of the dock. */
export const ANGLER_X = 56;

/** A small seeded generator, so the lake and its weeds never change. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The bed's profile: the near shore, a shelf of weeds, the deep hole, a hump
// with rocks and the sunken log, a second hole, and the far shore's reeds.
const PROFILE: [number, number][] = [
  [0, -16],
  [8, -12],
  [16, -5],
  [24, 5],
  [40, 13],
  [64, 19],
  [92, 25],
  [120, 31],
  [148, 46],
  [176, 70],
  [204, 85],
  [230, 88],
  [256, 75],
  [280, 63],
  [300, 65],
  [322, 78],
  [346, 86],
  [372, 77],
  [398, 53],
  [420, 31],
  [438, 13],
  [450, 1],
  [462, -8],
  [480, -14],
];

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Bed height (world y) for every column, 0 to WORLD_W inclusive. */
export const BED: Float32Array = (() => {
  const bed = new Float32Array(WORLD_W + 1);
  const rand = rng(7);
  const bumps = Array.from({ length: 64 }, () => rand() * 2 - 1);
  for (let x = 0; x <= WORLD_W; x++) {
    let i = 0;
    while (i < PROFILE.length - 2 && PROFILE[i + 1][0] <= x) i++;
    const a = PROFILE[Math.max(0, i - 1)];
    const b = PROFILE[i];
    const c = PROFILE[i + 1];
    const d = PROFILE[Math.min(PROFILE.length - 1, i + 2)];
    const t = (x - b[0]) / (c[0] - b[0]);
    // A little roughness, smooth over about eight pixels.
    const u = x / 8;
    const k = Math.floor(u);
    const f = u - k;
    const s = f * f * (3 - 2 * f);
    const rough = bumps[k % 64] * (1 - s) + bumps[(k + 1) % 64] * s;
    bed[x] = catmull(a[1], b[1], c[1], d[1], t) + rough * 1.6;
  }
  return bed;
})();

/** Bed height at any x, clamped to the world. */
export function bedAt(x: number): number {
  const i = Math.max(0, Math.min(WORLD_W, Math.round(x)));
  return BED[i];
}

/** True where the column holds water (the bed is below the water line). */
export function wet(x: number): boolean {
  return bedAt(x) > 0.5;
}

/** The first and last wet columns. */
export const WATER_X0 = (() => {
  let x = 0;
  while (x < WORLD_W && BED[x] <= 0.5) x++;
  return x;
})();
export const WATER_X1 = (() => {
  let x = WORLD_W;
  while (x > 0 && BED[x] <= 0.5) x--;
  return x;
})();

export interface Weed {
  x: number;
  /** Strand height in pixels. */
  height: number;
  phase: number;
  /** 0 to 2: which of three greens. */
  tone: number;
}

function weedBed(rand: () => number, x0: number, x1: number, count: number, tall: number): Weed[] {
  const out: Weed[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.round(x0 + rand() * (x1 - x0));
    const room = bedAt(x) - 4;
    out.push({
      x,
      height: Math.max(3, Math.min(room, Math.round(tall * (0.45 + rand() * 0.6)))),
      phase: rand() * Math.PI * 2,
      tone: Math.floor(rand() * 3),
    });
  }
  return out;
}

const weedRand = rng(21);
export const WEEDS: Weed[] = [
  ...weedBed(weedRand, 74, 138, 26, 20),
  ...weedBed(weedRand, 150, 166, 5, 14),
  ...weedBed(weedRand, 384, 424, 16, 18),
];

/** Reeds and cattails standing out of the far shore's shallows. */
export const REEDS: { x: number; height: number; cattail: boolean }[] = (() => {
  const rand = rng(33);
  const out = [];
  for (let x = 426; x < 458; x += 1 + Math.floor(rand() * 3)) {
    out.push({ x, height: 8 + Math.floor(rand() * 9), cattail: rand() < 0.35 });
  }
  return out;
})();

/** The sunken log lies across the hump's shoulder. */
export const LOG = { x0: 244, x1: 274 };
export const ROCKS: { x: number; r: number }[] = [
  { x: 286, r: 3 },
  { x: 291, r: 2 },
  { x: 296, r: 4 },
  { x: 303, r: 2 },
  { x: 190, r: 2 },
  { x: 356, r: 3 },
];
/** Somebody lost a boot here. */
export const BOOT_X = 338;

export interface Tree {
  x: number;
  height: number;
  kind: 'pine' | 'round';
}

export const TREES: Tree[] = [
  { x: 1, height: 30, kind: 'pine' },
  { x: 8, height: 22, kind: 'round' },
  { x: 458, height: 18, kind: 'round' },
  { x: 467, height: 33, kind: 'pine' },
  { x: 476, height: 25, kind: 'pine' },
];
