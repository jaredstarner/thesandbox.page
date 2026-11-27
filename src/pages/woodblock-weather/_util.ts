// Seeded randomness and smooth noise: every place gets the same view each visit.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise in one dimension, 0..1. */
export function noise1(seed: number): (x: number) => number {
  return (x: number) => {
    const i = Math.floor(x);
    const f = smooth(x - i);
    const a = hash2(i, 0, seed);
    const b = hash2(i + 1, 0, seed);
    return a + (b - a) * f;
  };
}

/** Value noise in two dimensions, 0..1. */
export function noise2(seed: number): (x: number, y: number) => number {
  return (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = hash2(ix, iy, seed);
    const b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed);
    const d = hash2(ix + 1, iy + 1, seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Fractal sum of 1D noise, 0..1. */
export function fbm1(seed: number, octaves = 4): (x: number) => number {
  const layers = Array.from({ length: octaves }, (_, i) => noise1(seed + i * 101));
  return (x: number) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (const n of layers) {
      sum += n(x * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  };
}

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => smooth(clamp((v - a) / (b - a)));

export type RGB = [number, number, number];

export function hex(c: string): RGB {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string | RGB, b: string | RGB, t: number): RGB {
  const x = typeof a === 'string' ? hex(a) : a;
  const y = typeof b === 'string' ? hex(b) : b;
  return [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
}

export function css(c: string | RGB): string {
  if (typeof c === 'string') return c;
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
}
