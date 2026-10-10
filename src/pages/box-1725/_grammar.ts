// A small Tracery-style grammar: rules map a symbol to its choices, and
// #symbol# or #symbol.modifier# in a choice expands recursively. Variables
// passed in win over rules, so a letter's own facts can fill a slot.

export type Rules = Record<string, readonly string[]>;
export type Rand = () => number;

/** mulberry32: small, fast, and good enough to pick words. */
export function rng(seed: number): Rand {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string, for seeds. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const pick = <T>(rand: Rand, list: readonly T[]): T => list[Math.floor(rand() * list.length)];

const MODIFIERS: Record<string, (s: string) => string> = {
  capitalize: (s) => s.charAt(0).toUpperCase() + s.slice(1),
  caps: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  a: (s) => (/^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`),
  s: (s) => (/(s|x|ch|sh)$/.test(s) ? `${s}es` : /[^aeiou]y$/.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`),
};

const TAG = /#([A-Za-z0-9_]+)((?:\.[a-z]+)*)#/g;

export function expand(rules: Rules, text: string, rand: Rand, vars: Record<string, string> = {}, depth = 0): string {
  if (depth > 10) return text;
  return text.replace(TAG, (_, symbol: string, mods: string) => {
    let out: string;
    if (symbol in vars) out = vars[symbol];
    else if (rules[symbol]) out = expand(rules, pick(rand, rules[symbol]), rand, vars, depth + 1);
    else return `#${symbol}#`;
    for (const m of mods.split('.').filter(Boolean)) out = MODIFIERS[m]?.(out) ?? out;
    return out;
  });
}
