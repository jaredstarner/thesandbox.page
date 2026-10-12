// The classic patterns, each written as the marbler would make it: throw a
// ground of colour, then draw the tools through it in order.

import type { Tines } from './_engine';
import { GALL, pigmentIndex } from './_pigments';

export type Step =
  | { kind: 'caption'; text: string }
  | { kind: 'drop'; x: number; y: number; r: number; color: number }
  | { kind: 'stroke'; tines: Tines; path: number[]; ms: number }
  | { kind: 'pause'; ms: number };

export interface Recipe {
  id: string;
  name: string;
  /** One line for the pattern list. */
  line: string;
  build: (rng: () => number, w: number, h: number) => Step[];
}

/** mulberry32: small, fast, and seedable, so a link can bring back a pattern. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const c = pigmentIndex;
const OVER = 90;

export const STYLUS: Tines = { spacing: 0, nx: 0, ny: 1, z: 34, half: 4.5 };
export const RAKE: Tines = { spacing: 84, nx: 0, ny: 1, z: 46, half: 6.5 };
export const COMB: Tines = { spacing: 19, nx: 0, ny: 1, z: 24, half: 2.6 };

/** Turn a tool's bar so it lies across a stroke travelling along (dx, dy). */
export function across(t: Tines, dx: number, dy: number): Tines {
  const l = Math.hypot(dx, dy) || 1;
  return { ...t, nx: -dy / l, ny: dx / l };
}

interface Throw {
  color: number;
  count: number;
  r: [number, number];
}

function ground(rng: () => number, w: number, h: number, throws: Throw[], caption = 'Throwing the ground'): Step[] {
  const steps: Step[] = [{ kind: 'caption', text: caption }];
  // A ground is sized to the trough: more drops for a bigger tray.
  const k = (w * h) / (1200 * 800);
  for (const t of throws) {
    const n = Math.round(t.count * k);
    for (let i = 0; i < n; i++) {
      steps.push({
        kind: 'drop',
        x: -30 + rng() * (w + 60),
        y: -30 + rng() * (h + 60),
        r: t.r[0] + rng() * (t.r[1] - t.r[0]),
        color: t.color,
      });
    }
  }
  return steps;
}

const line = (x0: number, y0: number, x1: number, y1: number): number[] => [x0, y0, x1, y1];

/** Gel-git: a rake drawn the length of the trough, then back between its own lines. */
function gelgit(rng: () => number, w: number, h: number, horizontal = true): Step[] {
  const s = RAKE.spacing;
  const o = rng() * s;
  if (horizontal) {
    const t = across(RAKE, 1, 0);
    return [
      { kind: 'caption', text: 'Gel-git: the rake drawn along the trough' },
      { kind: 'stroke', tines: t, path: line(-OVER, o, w + OVER, o), ms: 1500 },
      { kind: 'caption', text: 'Gel-git: and back, between its own lines' },
      { kind: 'stroke', tines: across(RAKE, -1, 0), path: line(w + OVER, o + s / 2, -OVER, o + s / 2), ms: 1500 },
    ];
  }
  return [
    { kind: 'caption', text: 'The rake drawn down the trough' },
    { kind: 'stroke', tines: across(RAKE, 0, 1), path: line(o, -OVER, o, h + OVER), ms: 1300 },
    { kind: 'caption', text: 'And back up, between its own lines' },
    { kind: 'stroke', tines: across(RAKE, 0, -1), path: line(o + s / 2, h + OVER, o + s / 2, -OVER), ms: 1300 },
  ];
}

function nonpareil(rng: () => number, w: number, h: number): Step[] {
  const o = rng() * COMB.spacing;
  return [
    { kind: 'caption', text: 'Nonpareil: a fine comb drawn once across the rake lines' },
    { kind: 'stroke', tines: across(COMB, 0, 1), path: line(o, -OVER, o, h + OVER), ms: 2200 },
  ];
}

/** A wide comb drawn along a wave, which fans each stripe into a bouquet or an eye. */
function serpentine(w: number, h: number, spacing: number, amp: number, wave: number, caption: string): Step[] {
  const path: number[] = [];
  const y0 = h / 2;
  for (let x = -OVER; x <= w + OVER; x += 5) path.push(x, y0 + amp * Math.sin((x / wave) * Math.PI * 2));
  const t: Tines = { spacing, nx: 0, ny: 1, z: 30, half: 5 };
  return [
    { kind: 'caption', text: caption },
    { kind: 'stroke', tines: t, path, ms: 2600 },
  ];
}

const classicGround = (rng: () => number, w: number, h: number) =>
  ground(rng, w, h, [
    { color: c('indigo'), count: 46, r: [26, 40] },
    { color: c('venetian'), count: 46, r: [26, 40] },
    { color: c('ochre'), count: 46, r: [26, 40] },
    { color: c('black'), count: 30, r: [18, 30] },
  ]);

export const RECIPES: Recipe[] = [
  {
    id: 'stone',
    name: 'Stone',
    line: 'Colour thrown and left alone, each throw crowding the last into veins',
    build: (rng, w, h) =>
      ground(
        rng,
        w,
        h,
        [
          { color: c('black'), count: 34, r: [22, 34] },
          { color: c('venetian'), count: 40, r: [28, 44] },
          { color: c('indigo'), count: 40, r: [28, 44] },
          { color: c('ochre'), count: 44, r: [34, 52] },
        ],
        'Stone: each colour thrown over the last',
      ),
  },
  {
    id: 'gelgit',
    name: 'Gel-git',
    line: 'Come-and-go: a rake drawn along and back, folding the stone into zigzags',
    build: (rng, w, h) => [...classicGround(rng, w, h), ...gelgit(rng, w, h)],
  },
  {
    id: 'nonpareil',
    name: 'Nonpareil',
    line: 'Gel-git combed through with fine teeth, the endpaper of a thousand ledgers',
    build: (rng, w, h) => [...classicGround(rng, w, h), ...gelgit(rng, w, h), ...nonpareil(rng, w, h)],
  },
  {
    id: 'chevron',
    name: 'Chevron',
    line: 'Gel-git raked again the other way, so every stripe bends into a V',
    build: (rng, w, h) => [...classicGround(rng, w, h), ...gelgit(rng, w, h), ...gelgit(rng, w, h, false)],
  },
  {
    id: 'bouquet',
    name: 'Bouquet',
    line: 'Nonpareil drawn through again along a wave, fanning into sprays',
    build: (rng, w, h) => [
      ...classicGround(rng, w, h),
      ...gelgit(rng, w, h),
      ...nonpareil(rng, w, h),
      ...serpentine(w, h, 96, 30, 190, 'Bouquet: a wide comb drawn along a wave'),
    ],
  },
  {
    id: 'peacock',
    name: 'Peacock',
    line: 'A tight wave through nonpareil, until each tooth draws an eye',
    build: (rng, w, h) => [
      ...classicGround(rng, w, h),
      ...gelgit(rng, w, h),
      ...nonpareil(rng, w, h),
      ...serpentine(w, h, 48, 24, 96, 'Peacock: a close comb waved through, one eye per tooth'),
    ],
  },
  {
    id: 'curl',
    name: 'French curl',
    line: 'A grid of pins turned in spirals through gel-git, like snail shells',
    build: (rng, w, h) => {
      const s = 128;
      const steps: Step[] = [...classicGround(rng, w, h), ...gelgit(rng, w, h)];
      steps.push({ kind: 'caption', text: 'French curl: a frame of pins turned in a spiral' });
      const path: number[] = [];
      const turns = 1.7;
      const rMax = s * 0.36;
      const ox = rng() * s;
      const oy = rng() * s;
      for (let i = 0; i <= 140; i++) {
        const t = i / 140;
        const a = t * turns * Math.PI * 2;
        const r = rMax * t;
        path.push(ox + Math.cos(a) * r, oy + Math.sin(a) * r);
      }
      steps.push({ kind: 'stroke', tines: { spacing: s, spacing2: s, nx: 1, ny: 0, z: 24, half: 6 }, path, ms: 2600 });
      return steps;
    },
  },
  {
    id: 'hatip',
    name: 'Hatip',
    line: 'Rings of colour dropped one inside another, then pulled into hearts',
    build: (rng, w, h) => {
      const steps: Step[] = ground(
        rng,
        w,
        h,
        [
          { color: c('chalk'), count: 18, r: [60, 90] },
          { color: c('ochre'), count: 26, r: [14, 24] },
        ],
        'Hatip: a pale ground',
      );
      steps.push({ kind: 'caption', text: 'Hatip: rings dropped one inside the next' });
      const sx = 200;
      const sy = 210;
      const cols = Math.max(2, Math.round(w / sx));
      const rows = Math.max(2, Math.round(h / sy));
      const gx = w / cols;
      const gy = h / rows;
      const rings = [c('indigo'), c('chalk'), c('rose'), c('chalk'), c('venetian')];
      const sizes = [44, 34, 26, 16, 9];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = gx * (col + 0.5);
          const y = gy * (row + 0.42);
          rings.forEach((color, i) => steps.push({ kind: 'drop', x, y, r: sizes[i], color }));
        }
      }
      steps.push({ kind: 'pause', ms: 300 });
      steps.push({ kind: 'caption', text: 'Hatip: a stylus pulled down through every ring' });
      const t: Tines = { spacing: gx, nx: 1, ny: 0, z: 70, half: 5 };
      steps.push({ kind: 'stroke', tines: t, path: line(gx / 2, -OVER, gx / 2, h + OVER), ms: 2200 });
      return steps;
    },
  },
  {
    id: 'suminagashi',
    name: 'Suminagashi',
    line: 'Ink and clear water touched to one spot in turn, then breathed on',
    build: (rng, w, h) => {
      const steps: Step[] = [{ kind: 'caption', text: 'Suminagashi: ink, then clear water, touched to the same spot' }];
      const centres = [
        [w * (0.3 + rng() * 0.1), h * (0.35 + rng() * 0.1)],
        [w * (0.62 + rng() * 0.1), h * (0.58 + rng() * 0.12)],
      ];
      for (let i = 0; i < 26; i++) {
        for (const [x, y] of centres) {
          const ink = i % 5 === 3 ? c('indigo') : c('black');
          steps.push({ kind: 'drop', x, y, r: 8 + rng() * 3, color: ink });
          steps.push({ kind: 'drop', x, y, r: 11 + rng() * 4, color: GALL });
        }
      }
      steps.push({ kind: 'caption', text: 'Suminagashi: a breath across the water' });
      const soft: Tines = { spacing: 0, nx: 0, ny: 1, z: 60, half: 40 };
      for (let k = 0; k < 3; k++) {
        const path: number[] = [];
        const y0 = h * (0.2 + 0.3 * k + rng() * 0.1);
        const ph = rng() * 6;
        for (let x = -OVER; x <= w + OVER; x += 8) path.push(x, y0 + 60 * Math.sin(x / 210 + ph));
        steps.push({ kind: 'stroke', tines: soft, path, ms: 1800 });
      }
      return steps;
    },
  },
];

export const recipeById = (id: string) => RECIPES.find((r) => r.id === id);
