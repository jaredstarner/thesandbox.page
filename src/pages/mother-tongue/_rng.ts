// A small seeded random source, so one seed always grows the same family.

export interface Rng {
  /** A float in [0, 1). */
  (): number;
  int(n: number): number;
  range(a: number, b: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  shuffle<T>(items: T[]): T[];
  /** A child stream, so adding draws in one place doesn't move another. */
  fork(salt: string): Rng;
}

export function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function rng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9;
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.int = (n) => Math.floor(next() * n);
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.chance = (p) => next() < p;
  next.pick = (items) => items[Math.floor(next() * items.length)];
  next.weighted = (items, weights) => {
    let total = 0;
    for (const w of weights) total += w;
    let r = next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  };
  next.shuffle = (items) => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  };
  next.fork = (salt) => rng(Math.imul(hashString(salt) ^ seed, 2654435761) >>> 0);
  return next;
}
