// Genomes: small feed-forward networks of functions, how founders are made, how a child
// differs from its parent, and how a genome travels in a link.

export const ACTS = ['sin', 'cos', 'gauss', 'tanh', 'edge', 'abs', 'tri', 'linear'] as const;
export type Act = (typeof ACTS)[number];

/** Input node ids: a constant, position, distance from the centre, and a slow clock. */
export const IN = { bias: 0, x: 1, y: 2, r: 3, ts: 4, tc: 5 } as const;
/** Output node ids: lightness and the two OKLab colour axes. */
export const OUT = { l: 6, a: 7, b: 8 } as const;
const INPUTS = [0, 1, 2, 3, 4, 5];
const OUTPUTS = [6, 7, 8];
const FIRST_HIDDEN = 9;

/** Shader size limits, so a long line still compiles quickly everywhere. */
const MAX_HIDDEN = 36;
const MAX_LINKS = 110;

export interface Node {
  id: number;
  act: Act;
  /** Order in the network: inputs are 0, outputs 1, hidden nodes in between. */
  depth: number;
}

export interface Link {
  from: number;
  to: number;
  w: number;
  on: boolean;
}

export interface Genome {
  /** Hidden nodes only; inputs and outputs are implied. */
  nodes: Node[];
  links: Link[];
  next: number;
}

export type Rng = () => number;

/** mulberry32: small, fast, and good enough to pick mutations. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mix32(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

function gauss(r: Rng): number {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

function pick<T>(r: Rng, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length) % xs.length];
}

const round = (w: number) => Math.round(w * 1000) / 1000;
const clampW = (w: number) => round(Math.max(-6, Math.min(6, w)));

/** The activations a new or swapped node may take; linear only joins wires. */
const SHAPERS: readonly Act[] = ['sin', 'sin', 'cos', 'gauss', 'gauss', 'tanh', 'edge', 'abs', 'tri'];
/** First-layer shapes lean to the symmetric ones, which give founders their bilateral, organic look. */
const FIRST: readonly Act[] = ['sin', 'cos', 'gauss', 'gauss', 'abs', 'tri', 'edge', 'tanh'];

export function depthOf(g: Genome, id: number): number {
  if (id < OUTPUTS[0]) return 0;
  if (id < FIRST_HIDDEN) return 1;
  return g.nodes.find((n) => n.id === id)?.depth ?? 0.5;
}

export function clone(g: Genome): Genome {
  return {
    nodes: g.nodes.map((n) => ({ ...n })),
    links: g.links.map((l) => ({ ...l })),
    next: g.next,
  };
}

/** A network with nothing wired: every output is zero, so it draws flat mid grey. */
export function blank(): Genome {
  return { nodes: [], links: [], next: FIRST_HIDDEN };
}

/** One founder: a layer of shapes drawn on position, a layer that combines them, and the colour read from both. */
export function founder(seed: number): Genome {
  const r = rng(seed);
  const g = blank();
  const spatial = [IN.bias, IN.x, IN.y, IN.r];
  const wire = (from: number, to: number, sd: number) => {
    if (!g.links.some((l) => l.from === from && l.to === to)) g.links.push({ from, to, w: clampW(gauss(r) * sd), on: true });
  };
  const layer = (count: number, depth: number, acts: readonly Act[]) =>
    Array.from({ length: count }, () => {
      const node: Node = { id: g.next++, act: pick(r, acts), depth: depth + 0.1 * r() };
      g.nodes.push(node);
      return node;
    });

  const first = layer(2 + Math.floor(r() * 3), 0.25, FIRST);
  for (const n of first) {
    // Every first-layer shape reads at least one coordinate.
    wire(pick(r, [IN.x, IN.y, IN.r, IN.r]), n.id, 2.6);
    for (let k = Math.floor(r() * 2.2); k > 0; k--) wire(pick(r, spatial), n.id, 2.4);
  }
  const second = layer(1 + Math.floor(r() * 3), 0.6, SHAPERS);
  for (const n of second) {
    for (let k = 2 + Math.floor(r() * 2); k > 0; k--) wire(pick(r, first).id, n.id, 2.2);
    if (r() < 0.35) wire(pick(r, spatial), n.id, 1.6);
  }
  const hidden = [...first, ...second];
  wire(pick(r, second).id, OUT.l, 2.2);
  wire(pick(r, hidden).id, OUT.l, 1.6);
  for (const out of [OUT.a, OUT.b]) {
    for (let k = 1 + Math.floor(r() * 2); k > 0; k--) wire(pick(r, hidden).id, out, 1.5);
  }
  return g;
}

/** Founders, passing over any that would draw an almost flat field. */
export function founders(seed: number, count: number): Genome[] {
  return Array.from({ length: count }, (_, i) => {
    let best = founder(mix32(seed, i + 1));
    let spread = contrast(best);
    for (let k = 1; k < 8 && spread < 0.1; k++) {
      const g = founder(mix32(mix32(seed, i + 1), k));
      const s = contrast(g);
      if (s > spread) [best, spread] = [g, s];
    }
    return best;
  });
}

const F: Record<Act, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  gauss: (x) => 2 * Math.exp(-2.5 * x * x) - 1,
  tanh: Math.tanh,
  edge: (x) => Math.tanh(5 * x),
  abs: (x) => Math.abs(x) - 0.5,
  tri: (x) => {
    const f = 0.25 * x + 0.25;
    return 1 - 4 * Math.abs(f - Math.floor(f) - 0.5);
  },
  linear: (x) => x,
};

/** The network's outputs at one point, on the CPU; the shader computes the same sums. */
export function evaluate(g: Genome, x: number, y: number, t = 0.9): [number, number, number] {
  const v = new Map<number, number>([
    [IN.bias, 1],
    [IN.x, x],
    [IN.y, y],
    [IN.r, Math.hypot(x, y) * 1.4],
    [IN.ts, Math.sin(t)],
    [IN.tc, Math.cos(t)],
  ]);
  const sum = (id: number) => g.links.reduce((s, l) => (l.on && l.to === id ? s + l.w * (v.get(l.from) ?? 0) : s), 0);
  for (const n of [...g.nodes].sort((a, b) => a.depth - b.depth || a.id - b.id)) v.set(n.id, F[n.act](sum(n.id)));
  return [sum(OUT.l), sum(OUT.a), sum(OUT.b)];
}

/** Spread of lightness over a coarse grid of the frame: near zero for a flat picture. */
export function contrast(g: Genome): number {
  const ls: number[] = [];
  for (let j = 0; j < 9; j++) {
    for (let i = 0; i < 13; i++) {
      const [l] = evaluate(g, -1.5 + (3 * i) / 12, -1 + (2 * j) / 8);
      ls.push(0.5 + 0.48 * Math.tanh(0.9 * l));
    }
  }
  const mean = ls.reduce((a, b) => a + b, 0) / ls.length;
  return Math.sqrt(ls.reduce((a, b) => a + (b - mean) ** 2, 0) / ls.length);
}

/** A child: its parent with a few changes. `strength` scales how many and how large. */
export function child(parent: Genome, seed: number, strength: number): Genome {
  const r = rng(seed);
  const g = clone(parent);
  let changed = false;

  // Nudge some wires.
  const live = g.links.filter((l) => l.on);
  if (live.length) {
    const n = Math.max(1, Math.round(live.length * 0.18 * strength + r() * strength));
    for (let k = 0; k < n; k++) {
      const l = pick(r, live);
      l.w = clampW(r() < 0.08 * strength ? gauss(r) * 2 : l.w + gauss(r) * 0.7 * strength);
    }
    changed = true;
  }

  const p = (base: number) => r() < Math.min(0.9, base * strength);

  // Splice a new function into a wire. Its depth sits between the two ends, so wires still run forward.
  if (g.nodes.length < MAX_HIDDEN && live.length && p(0.4)) {
    const l = pick(r, live);
    const node: Node = {
      id: g.next++,
      act: pick(r, SHAPERS),
      depth: (depthOf(g, l.from) + depthOf(g, l.to)) / 2,
    };
    l.on = false;
    g.nodes.push(node);
    g.links.push({ from: l.from, to: node.id, w: 1, on: true }, { from: node.id, to: l.to, w: l.w, on: true });
    changed = true;
  }

  // Add a new wire, rarely from the clock.
  if (g.links.length < MAX_LINKS && p(0.5)) {
    if (addLink(g, r, r() < 0.035 * strength)) changed = true;
  }

  // Swap one function for another.
  if (g.nodes.length && p(0.2)) {
    const n = pick(r, g.nodes);
    const next = pick(
      r,
      SHAPERS.filter((a) => a !== n.act),
    );
    n.act = next;
    changed = true;
  }

  // Cut a wire now and then.
  if (live.length > 4 && p(0.04)) {
    pick(r, live).on = false;
    changed = true;
  }

  if (!changed) addLink(g, r, false);
  return g;
}

function addLink(g: Genome, r: Rng, clock: boolean): boolean {
  const targets = [...g.nodes.map((n) => n.id), ...OUTPUTS];
  for (let tries = 0; tries < 12; tries++) {
    const to = clock && g.nodes.length ? pick(r, g.nodes).id : pick(r, targets);
    const dTo = depthOf(g, to);
    const sources = clock
      ? [IN.ts, IN.tc]
      : [IN.bias, IN.x, IN.y, IN.r, ...g.nodes.filter((n) => n.depth < dTo).map((n) => n.id)];
    const from = pick(r, sources);
    const existing = g.links.find((l) => l.from === from && l.to === to);
    if (existing) {
      if (existing.on) continue;
      existing.on = true;
      existing.w = clampW(gauss(r) * 1.4);
      return true;
    }
    g.links.push({ from, to, w: clampW(gauss(r) * (clock ? 0.9 : 1.4)), on: true });
    return true;
  }
  return false;
}

/** Whether the picture moves: a live wire from the clock that reaches an output. */
export function moves(g: Genome): boolean {
  const reach = new Set<number>([IN.ts, IN.tc]);
  const order = [...g.nodes].sort((a, b) => a.depth - b.depth).map((n) => n.id);
  for (const id of [...order, ...OUTPUTS]) {
    if (g.links.some((l) => l.on && l.to === id && reach.has(l.from) && l.w !== 0)) reach.add(id);
  }
  return OUTPUTS.some((o) => reach.has(o));
}

export function size(g: Genome): { nodes: number; links: number } {
  return { nodes: g.nodes.length, links: g.links.filter((l) => l.on).length };
}

/** A short stable key, for telling identical genomes apart from different ones. */
export function key(g: Genome): string {
  let h = 2166136261;
  const s = JSON.stringify(pack(g));
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

type Packed = { n: [number, number, number][]; l: [number, number, number, number][]; x: number };

export function pack(g: Genome): Packed {
  return {
    n: g.nodes.map((n) => [n.id, ACTS.indexOf(n.act), n.depth]),
    l: g.links.map((l) => [l.from, l.to, l.w, l.on ? 1 : 0]),
    x: g.next,
  };
}

/** Rebuilds a genome from untrusted data, or returns null if anything is off. */
export function unpack(raw: unknown): Genome | null {
  if (!raw || typeof raw !== 'object') return null;
  const { n, l, x } = raw as Partial<Packed>;
  if (!Array.isArray(n) || !Array.isArray(l) || typeof x !== 'number') return null;
  if (n.length > MAX_HIDDEN * 2 || l.length > MAX_LINKS * 2) return null;
  const nodes: Node[] = [];
  const ids = new Set<number>([...INPUTS, ...OUTPUTS]);
  for (const item of n) {
    if (!Array.isArray(item) || item.length !== 3) return null;
    const [id, act, depth] = item;
    if (!Number.isInteger(id) || id < FIRST_HIDDEN || id >= x || ids.has(id)) return null;
    if (!Number.isInteger(act) || act < 0 || act >= ACTS.length) return null;
    if (typeof depth !== 'number' || !(depth > 0 && depth < 1)) return null;
    ids.add(id);
    nodes.push({ id, act: ACTS[act], depth });
  }
  const g: Genome = { nodes, links: [], next: x };
  for (const item of l) {
    if (!Array.isArray(item) || item.length !== 4) return null;
    const [from, to, w, on] = item;
    if (!ids.has(from) || !ids.has(to) || typeof w !== 'number' || !Number.isFinite(w)) return null;
    // Wires run forward only: never out of an output, never into an input.
    const fromOutput = from >= OUTPUTS[0] && from < FIRST_HIDDEN;
    if (fromOutput || to < OUTPUTS[0] || depthOf(g, from) >= depthOf(g, to)) return null;
    g.links.push({ from, to, w: clampW(w), on: on === 1 });
  }
  return g;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Packs a genome and its generation into a URL-safe code: deflated when the browser can. */
export async function encode(g: Genome, gen: number): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ g: pack(g), gen }));
  if (typeof CompressionStream === 'function') {
    try {
      return 'z' + b64url(await pipe(json, new CompressionStream('deflate-raw')));
    } catch {}
  }
  return 'j' + b64url(json);
}

export async function decode(code: string): Promise<{ genome: Genome; gen: number } | null> {
  try {
    let bytes = unb64url(code.slice(1));
    if (code[0] === 'z') {
      if (typeof DecompressionStream !== 'function') return null;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    } else if (code[0] !== 'j') return null;
    if (bytes.length > 64_000) return null;
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as { g?: unknown; gen?: unknown };
    const genome = unpack(raw.g);
    if (!genome) return null;
    const gen = Number.isInteger(raw.gen) && (raw.gen as number) >= 0 ? Math.min(raw.gen as number, 99999) : 0;
    return { genome, gen };
  } catch {
    return null;
  }
}
