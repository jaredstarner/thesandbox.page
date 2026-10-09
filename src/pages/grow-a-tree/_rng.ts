// Seeded randomness, so a tree regrows the same from the same seed.

export type Rng = () => number;

/** mulberry32: a small, fast 32-bit generator. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();

/** A random unit vector, uniform on the sphere. */
export function unit(rng: Rng): [number, number, number] {
  const z = rng() * 2 - 1;
  const t = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), z, r * Math.sin(t)];
}

/** Hash an integer to [0, 1). */
export function hash1(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x: number, salt = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i * 7919 + salt * 104729) * 2 - 1;
  const b = hash1((i + 1) * 7919 + salt * 104729) * 2 - 1;
  return a + (b - a) * u;
}
