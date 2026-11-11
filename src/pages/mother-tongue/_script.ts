// The writing systems. The parent script's letters are short walks on a 3 x 3 grid,
// chosen to be easy to tell apart and simplest for the commonest sounds. Daughter
// scripts inherit them and drift the way real scripts have: the stylus gives way to a
// pen and corners round off, the hand slants, a headline joins the letters, the writing
// direction flips and every letter mirrors with it, and complex letters lose a stroke.
// A sound that is new to a language gets its parent sound's letter plus a mark.

import { isVowel, seg, vowel, type Word } from './_phon';
import type { Rng } from './_rng';

export type ScriptType = 'alphabet' | 'abjad' | 'abugida';

/** A letter: strokes through the nodes of a 3 x 3 grid, numbered row by row. */
export interface Glyph {
  strokes: number[][];
}

export type MarkKind = 'dot' | 'bar' | 'tick' | 'hook' | 'ring' | 'pair' | 'chevron' | 'stroke';
export type MarkPlace = 'above' | 'below' | 'right' | 'through';

export interface Mark {
  kind: MarkKind;
  place: MarkPlace;
}

export interface ScriptState {
  /** 0 sharp corners, 1 fully rounded. */
  round: number;
  slant: number;
  /** Width of a letter over its height. */
  aspect: number;
  /** Stroke width over letter height. */
  weight: number;
  /** 0 a monoline stylus, 1 a broad nib. */
  contrast: number;
  nib: number;
  /** 1 as first written, -1 mirrored with a change of direction. */
  mirror: number;
  headline: number;
  /** 0 cut in stone, 1 written in ink. */
  ink: number;
  /** Lines alternate direction, as ox turns a plough. */
  bous: number;
  /** Words are parted by a mark until spaces take over. */
  spaces: number;
}

export type OpKind =
  | 'round'
  | 'slant'
  | 'nib'
  | 'mirror'
  | 'headline'
  | 'narrow'
  | 'widen'
  | 'simplify'
  | 'ink'
  | 'settle'
  | 'spaces'
  | 'vowels';

export interface ScriptOp {
  t: number;
  dur: number;
  kind: OpKind;
  /** The state's value once the op is done, for continuous ops. */
  to?: number;
  /** For simplify: letter keys and the stroke each loses. */
  cuts?: [string, number][];
}

export const OP_TEXT: Record<OpKind, string> = {
  round: 'corners round off as scribes write faster',
  slant: 'the hand begins to slant',
  nib: 'a broad pen replaces the stylus: thick and thin strokes',
  mirror: 'the writing direction turns round and the letters mirror with it',
  headline: 'a headline joins the letters of each word',
  narrow: 'letters grow narrow',
  widen: 'letters grow wide',
  simplify: 'complex letters lose a stroke',
  ink: 'writing moves from stone to ink',
  settle: 'lines stop turning back and run one way',
  spaces: 'spaces replace the word dividers',
  vowels: 'letters for lost sounds are reused to write vowels',
};

export interface Script {
  type: ScriptType;
  letters: Map<string, Glyph>;
  /** Marks added to a parent letter for sounds that arose later. */
  derived: Map<string, { base: string; mark: Mark }>;
  vowelMarks: Map<string, Mark>;
  carrier: Glyph;
  inherent: string;
  virama: Mark;
  state: ScriptState;
  /** Whether vowels are written (an abjad that took the Greek route). */
  vowelsWritten: boolean;
}

const NODE = (i: number): [number, number] => [(i % 3) / 2, Math.floor(i / 3) / 2];

function neighbours(i: number, diagonal: boolean): number[] {
  const x = i % 3;
  const y = Math.floor(i / 3);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (!diagonal && dx && dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < 3 && ny >= 0 && ny < 3) out.push(ny * 3 + nx);
    }
  return out;
}

const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Rasterize a glyph small and soft, to compare letters for likeness. */
function raster(g: Glyph, size = 14): Float32Array {
  const out = new Float32Array(size * size);
  const pad = 2;
  const s = size - pad * 2 - 1;
  for (const stroke of g.strokes) {
    for (let k = 0; k < stroke.length - 1; k++) {
      const [x0, y0] = NODE(stroke[k]);
      const [x1, y1] = NODE(stroke[k + 1]);
      const steps = 24;
      for (let q = 0; q <= steps; q++) {
        const x = pad + (x0 + (x1 - x0) * (q / steps)) * s;
        const y = pad + (y0 + (y1 - y0) * (q / steps)) * s;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const px = Math.round(x) + dx;
            const py = Math.round(y) + dy;
            if (px < 0 || py < 0 || px >= size || py >= size) continue;
            const v = dx || dy ? 0.45 : 1;
            const idx = py * size + px;
            out[idx] = Math.max(out[idx], v);
          }
      }
    }
  }
  return out;
}

function likeness(a: Float32Array, b: Float32Array): number {
  let diff = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i] - b[i]);
    sum += a[i] + b[i];
  }
  return sum ? diff / sum : 0;
}

export const edgeCount = (g: Glyph) => g.strokes.reduce((n, s) => n + s.length - 1, 0);

function makeGlyph(r: Rng, diagonal: number, symmetry: number): Glyph | null {
  const used = new Set<string>();
  const touched = new Set<number>();
  const strokes: number[][] = [];
  const count = r.weighted([1, 2, 3], [2, 5, 2]);
  for (let s = 0; s < count; s++) {
    let start: number;
    if (!strokes.length) start = r.int(9);
    else start = r.pick([...touched]);
    const stroke = [start];
    const len = r.weighted([1, 2, 3], [4, 4, 1.5]);
    let prevDir: [number, number] | null = null;
    for (let k = 0; k < len; k++) {
      const here = stroke[stroke.length - 1];
      const options = neighbours(here, r() < diagonal).filter((n) => !used.has(edgeKey(here, n)));
      if (!options.length) break;
      // Prefer carrying straight on to zigzags.
      const weights = options.map((n) => {
        if (!prevDir) return 1;
        const d: [number, number] = [(n % 3) - (here % 3), Math.floor(n / 3) - Math.floor(here / 3)];
        return d[0] === prevDir[0] && d[1] === prevDir[1] ? 2.6 : 1;
      });
      const next = r.weighted(options, weights);
      prevDir = [(next % 3) - (here % 3), Math.floor(next / 3) - Math.floor(here / 3)];
      used.add(edgeKey(here, next));
      stroke.push(next);
    }
    if (stroke.length < 2) continue;
    for (const n of stroke) touched.add(n);
    strokes.push(stroke);
  }
  if (!strokes.length) return null;
  let g: Glyph = { strokes };
  if (r() < symmetry) {
    // Add each stroke's mirror image unless it retraces an edge already drawn.
    const mirrored = strokes.map((st) => st.map((n) => Math.floor(n / 3) * 3 + (2 - (n % 3))));
    const merged = [...strokes];
    for (const st of mirrored) {
      const keys = st.slice(1).map((n, i) => edgeKey(st[i], n));
      if (keys.every((k) => !used.has(k))) {
        keys.forEach((k) => used.add(k));
        merged.push(st);
      }
    }
    g = { strokes: merged };
  }
  const edges = edgeCount(g);
  if (edges < 2 || edges > 6) return null;
  return g;
}

/** A set of letters, all distinct from each other, ordered simplest first. */
export function makeLetters(r: Rng, count: number): Glyph[] {
  const diagonal = r.range(0.15, 0.75);
  const symmetry = r.range(0.05, 0.4);
  const chosen: { g: Glyph; ras: Float32Array }[] = [];
  let threshold = 0.42;
  for (let guard = 0; chosen.length < count && guard < 6000; guard++) {
    if (guard && guard % 1500 === 0) threshold -= 0.05;
    const g = makeGlyph(r, diagonal, symmetry);
    if (!g) continue;
    const ras = raster(g);
    if (chosen.every((c) => likeness(c.ras, ras) > threshold)) chosen.push({ g, ras });
  }
  return chosen.map((c) => c.g).sort((a, b) => edgeCount(a) - edgeCount(b));
}

const MARK_KINDS: MarkKind[] = ['dot', 'bar', 'tick', 'hook', 'ring', 'pair', 'chevron', 'stroke'];

export function makeScript(r: Rng, phonemes: string[], frequency: Map<string, number>): Script {
  const type = r.weighted(['alphabet', 'abjad', 'abugida'] as const, [45, 25, 30]);
  const consonants = phonemes.filter((p) => !isVowel(p));
  const vowels = phonemes.filter((p) => isVowel(p) && !vowel(p)?.long);
  const inherent = vowels.includes('a') ? 'a' : vowels[0];
  const needed =
    type === 'alphabet' ? [...consonants, ...vowels] : type === 'abjad' ? consonants : [...consonants, ...vowels];
  const glyphs = makeLetters(r, needed.length + 6);
  // The commonest sounds take the simplest letters, with a little noise.
  const byFreq = [...needed].sort((a, b) => (frequency.get(b) ?? 0) * r.range(0.7, 1.3) - (frequency.get(a) ?? 0));
  const letters = new Map<string, Glyph>();
  byFreq.forEach((p, i) => letters.set(p, glyphs[i]));
  const carrier = glyphs[needed.length] ?? glyphs[0];
  const marks = r.shuffle([...MARK_KINDS]);
  const vowelMarks = new Map<string, Mark>();
  vowels
    .filter((v) => v !== inherent)
    .forEach((v, i) => {
      const kind = marks[i % marks.length];
      const place: MarkPlace = r.weighted(['above', 'below', 'right'] as const, [5, 3, 2]);
      vowelMarks.set(v, { kind, place });
    });
  return {
    type,
    letters,
    derived: new Map(),
    vowelMarks,
    carrier,
    inherent,
    virama: { kind: r.pick(['stroke', 'tick', 'dot'] as const), place: 'below' },
    state: {
      round: r.range(0, 0.12),
      slant: 0,
      aspect: r.range(0.62, 0.95),
      weight: r.range(0.085, 0.11),
      contrast: 0,
      nib: r.range(0.45, 0.85),
      mirror: 1,
      headline: 0,
      ink: 0,
      bous: r.chance(0.4) ? 1 : 0,
      spaces: 0,
    },
    vowelsWritten: type !== 'abjad',
  };
}

/** Pick the drift a branch's scribes go through. */
export function chooseOps(r: Rng, t0: number, t1: number, state: ScriptState, first: boolean, script: Script): ScriptOp[] {
  const ops: ScriptOp[] = [];
  const span = t1 - t0;
  const slots = Math.max(1, Math.round(span / r.range(330, 520)));
  const kinds: OpKind[] = [];
  if (first && state.ink < 1) kinds.push('ink');
  if (state.bous > 0 && r.chance(first ? 0.8 : 0.5)) kinds.push('settle');
  if (state.spaces < 1 && r.chance(0.55)) kinds.push('spaces');
  const pool: [OpKind, number][] = [
    ['round', state.round < 0.8 ? 6 : 0],
    ['slant', Math.abs(state.slant) < 0.15 ? 4 : 0],
    ['nib', state.contrast < 0.5 ? 4 : 0],
    ['mirror', 1.4],
    ['headline', state.headline < 0.5 ? 1.6 : 0],
    ['narrow', state.aspect > 0.6 ? 2 : 0],
    ['widen', state.aspect < 0.9 ? 2 : 0],
    ['simplify', 3],
    ['vowels', script.type === 'abjad' && !script.vowelsWritten ? 3 : 0],
  ];
  while (kinds.length < slots + (first ? 1 : 0)) {
    const kind = r.weighted(
      pool.map((p) => p[0]),
      pool.map((p) => (kinds.includes(p[0]) ? 0 : p[1])),
    );
    if (kinds.includes(kind)) break;
    kinds.push(kind);
  }
  const times = kinds.map(() => r.range(t0 + span * 0.08, t1 - span * 0.08)).sort((a, b) => a - b);
  kinds.forEach((kind, i) => {
    const op: ScriptOp = { t: times[i], dur: Math.min(220, span * 0.25), kind };
    if (kind === 'round') op.to = Math.min(1, state.round + r.range(0.35, 0.6));
    if (kind === 'slant') op.to = r.range(0.12, 0.22) * (r.chance(0.8) ? 1 : -1);
    if (kind === 'nib') op.to = r.range(0.6, 1);
    if (kind === 'mirror') op.to = -state.mirror;
    if (kind === 'headline') op.to = 1;
    if (kind === 'narrow') op.to = Math.max(0.5, state.aspect * r.range(0.72, 0.85));
    if (kind === 'widen') op.to = Math.min(1.15, state.aspect * r.range(1.15, 1.3));
    if (kind === 'ink' || kind === 'spaces') op.to = 1;
    if (kind === 'settle') op.to = 0;
    if (kind === 'simplify') {
      op.cuts = [];
      for (const [key, g] of script.letters) {
        if (edgeCount(g) >= 4 && g.strokes.length >= 2 && r.chance(0.7)) op.cuts.push([key, r.int(g.strokes.length)]);
      }
    }
    ops.push(op);
    applyOp(state, op, 1);
  });
  return ops;
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Move a state by an op, a fraction k of the way. */
export function applyOp(state: ScriptState, op: ScriptOp, k: number): void {
  const e = ease(k);
  const lerp = (from: number, to: number) => from + (to - from) * e;
  switch (op.kind) {
    case 'round':
      state.round = lerp(state.round, op.to!);
      break;
    case 'slant':
      state.slant = lerp(state.slant, op.to!);
      break;
    case 'nib':
      state.contrast = lerp(state.contrast, op.to!);
      break;
    case 'mirror':
      state.mirror = lerp(state.mirror, op.to!);
      break;
    case 'headline':
      state.headline = lerp(state.headline, op.to!);
      break;
    case 'narrow':
    case 'widen':
      state.aspect = lerp(state.aspect, op.to!);
      break;
    case 'ink':
      state.ink = lerp(state.ink, 1);
      break;
    case 'settle':
      state.bous = lerp(state.bous, 0);
      break;
    case 'spaces':
      state.spaces = lerp(state.spaces, 1);
      break;
    default:
      break;
  }
}

export const cloneScript = (s: Script): Script => ({
  ...s,
  letters: new Map([...s.letters].map(([k, g]) => [k, { strokes: g.strokes.map((st) => [...st]) }])),
  derived: new Map(s.derived),
  vowelMarks: new Map(s.vowelMarks),
  state: { ...s.state },
});

/** Apply a finished simplify or vowels op to a script's letters. */
export function settleOp(s: Script, op: ScriptOp, inventory: Set<string>, frequency: Map<string, number>, r: Rng): void {
  if (op.kind === 'simplify' && op.cuts) {
    for (const [key, index] of op.cuts) {
      const g = s.letters.get(key);
      if (g && g.strokes.length > 1) g.strokes.splice(index % g.strokes.length, 1);
    }
  }
  if (op.kind === 'vowels' && s.type === 'abjad' && !s.vowelsWritten) {
    const spare = [...s.letters.keys()].filter((k) => !isVowel(k) && !inventory.has(k));
    const vowels = [...inventory].filter((p) => isVowel(p) && !vowel(p)?.long);
    vowels.sort((a, b) => (frequency.get(b) ?? 0) - (frequency.get(a) ?? 0));
    const kinds = r.shuffle([...MARK_KINDS]);
    vowels.forEach((v, i) => {
      const from = spare[i];
      if (from) {
        s.letters.set(v, s.letters.get(from)!);
        s.letters.delete(from);
      } else {
        // No spare letter: a consonant letter with a mark becomes the vowel's.
        const base = [...s.letters.keys()].find((k) => !isVowel(k)) ?? '';
        s.derived.set(v, { base, mark: { kind: kinds[i % kinds.length], place: 'above' } });
      }
    });
    s.vowelsWritten = true;
    s.type = 'alphabet';
  }
}

/** One written sign: a letter (or the carrier) and the marks it carries. */
export interface Sign {
  letter: string;
  marks: Mark[];
  /** Write the letter twice, for a long vowel. */
  twice?: boolean;
}

const LENGTH_MARK: Mark = { kind: 'bar', place: 'right' };

function letterFor(s: Script, p: string): Sign {
  if (s.letters.has(p)) return { letter: p, marks: [] };
  const d = s.derived.get(p);
  if (d) {
    const inner = letterFor(s, d.base);
    return { letter: inner.letter, marks: [...inner.marks, d.mark] };
  }
  const v = vowel(p);
  if (v && (v.long || v.nasal)) {
    const base = p[0];
    const inner = letterFor(s, base);
    const marks = [...inner.marks];
    if (v.nasal) marks.push({ kind: 'tick', place: 'above' });
    return { letter: inner.letter, marks, twice: v.long };
  }
  return { letter: '', marks: [{ kind: 'ring', place: 'through' }] };
}

/** Spell a word in a script. */
export function spell(s: Script, w: Word): Sign[] {
  const out: Sign[] = [];
  if (s.type === 'alphabet') {
    for (const p of w) out.push(letterFor(s, p));
    return out;
  }
  if (s.type === 'abjad') {
    w.forEach((p, i) => {
      if (isVowel(p)) {
        if (i === 0) out.push({ letter: '·carrier', marks: [] });
        return;
      }
      out.push(letterFor(s, p));
    });
    return out;
  }
  // Abugida: a consonant carries its vowel as a mark; a bare consonant takes the virama.
  for (let i = 0; i < w.length; i++) {
    const p = w[i];
    if (isVowel(p)) {
      const v = vowel(p)!;
      const base = p[0];
      const sign = letterFor(s, base === s.inherent ? s.inherent : base);
      if (v.long) sign.marks.push(LENGTH_MARK);
      if (v.nasal) sign.marks.push({ kind: 'tick', place: 'above' });
      out.push(sign);
      continue;
    }
    const sign = letterFor(s, p);
    const next = w[i + 1];
    if (isVowel(next)) {
      const v = vowel(next)!;
      const base = next[0];
      if (base !== s.inherent) {
        const mark = s.vowelMarks.get(base);
        if (mark) sign.marks.push(mark);
        else sign.marks.push({ kind: 'pair', place: 'above' });
      }
      if (v.long) sign.marks.push(LENGTH_MARK);
      if (v.nasal) sign.marks.push({ kind: 'tick', place: 'above' });
      i++;
    } else {
      sign.marks.push(s.virama);
    }
    out.push(sign);
  }
  return out;
}

/** Record letters for sounds new to the language: the parent sound's letter plus a mark. */
export function deriveLetters(s: Script, pairs: Map<string, string>, inventory: Set<string>, r: Rng): string[] {
  const added: string[] = [];
  const used = new Set([...s.derived.values()].map((d) => `${d.base}:${d.mark.kind}:${d.mark.place}`));
  for (const [from, to] of pairs) {
    if (!to || !seg(to)) continue;
    if (s.letters.has(to) || s.derived.has(to)) continue;
    if (s.type === 'abjad' && !s.vowelsWritten && isVowel(to)) continue;
    const v = vowel(to);
    if (v && (v.long || v.nasal) && (s.letters.has(to[0]) || s.derived.has(to[0]))) continue;
    if (s.type === 'abugida' && isVowel(to)) {
      if (!s.vowelMarks.has(to[0]) && to[0] !== s.inherent) {
        const kinds = MARK_KINDS.filter((k) => ![...s.vowelMarks.values()].some((m) => m.kind === k));
        s.vowelMarks.set(to[0], { kind: kinds[0] ?? 'pair', place: 'below' });
      }
      continue;
    }
    if (!inventory.has(to)) continue;
    let base = from;
    if (!s.letters.has(base) && !s.derived.has(base)) base = [...s.letters.keys()][0];
    let mark: Mark = { kind: 'dot', place: 'above' };
    for (const kind of r.shuffle([...MARK_KINDS])) {
      const place: MarkPlace = kind === 'stroke' ? 'through' : r.chance(0.7) ? 'above' : 'right';
      if (!used.has(`${base}:${kind}:${place}`)) {
        mark = { kind, place };
        break;
      }
    }
    used.add(`${base}:${mark.kind}:${mark.place}`);
    s.derived.set(to, { base, mark });
    added.push(to);
  }
  return added;
}

// --- Drawing ---------------------------------------------------------------------

type Pt = [number, number];

/** A polyline with its corners rounded by quadratic curves, sampled densely. */
function smooth(points: Pt[], round: number): Pt[] {
  if (points.length < 3 || round <= 0.001) return densify(points);
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const lab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lbc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const cut = round * 0.5 * Math.min(lab, lbc);
    const p: Pt = [b[0] + ((a[0] - b[0]) * cut) / lab, b[1] + ((a[1] - b[1]) * cut) / lab];
    const q: Pt = [b[0] + ((c[0] - b[0]) * cut) / lbc, b[1] + ((c[1] - b[1]) * cut) / lbc];
    out.push(...densify([out[out.length - 1], p]).slice(1));
    for (let k = 1; k <= 10; k++) {
      const t = k / 10;
      const u = 1 - t;
      out.push([u * u * p[0] + 2 * u * t * b[0] + t * t * q[0], u * u * p[1] + 2 * u * t * b[1] + t * t * q[1]]);
    }
  }
  out.push(...densify([out[out.length - 1], points[points.length - 1]]).slice(1));
  return out;
}

function densify(points: Pt[]): Pt[] {
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.06));
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}

/** Merge runs of collinear edges, so a straight stroke has no false corners. */
function straighten(points: Pt[]): Pt[] {
  if (points.length < 3) return points;
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** The outline of one stroke, drawn with a stylus (round) or broad nib (flat). */
function strokeOutline(pts: Pt[], st: ScriptState, size: number): string {
  if (pts.length < 2) return '';
  const w = st.weight * size;
  const c = st.contrast;
  const nibW = w * 1.55;
  const nx = Math.cos(st.nib) * (nibW / 2);
  const ny = -Math.sin(st.nib) * (nibW / 2);
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const ox = -ty * (w / 2) * (1 - c) + nx * c;
    const oy = tx * (w / 2) * (1 - c) + ny * c;
    left.push([pts[i][0] + ox, pts[i][1] + oy]);
    right.push([pts[i][0] - ox, pts[i][1] - oy]);
  }
  let d = `M${f(left[0][0])} ${f(left[0][1])}`;
  for (let i = 1; i < left.length; i++) d += `L${f(left[i][0])} ${f(left[i][1])}`;
  for (let i = right.length - 1; i >= 0; i--) d += `L${f(right[i][0])} ${f(right[i][1])}`;
  d += 'Z';
  // Round ends for the stylus; a nib leaves its own flat ends.
  const cap = (w / 2) * (1 - c);
  if (cap > 0.2) {
    for (const p of [pts[0], pts[pts.length - 1]]) {
      d += `M${f(p[0] - cap)} ${f(p[1])}a${f(cap)} ${f(cap)} 0 1 0 ${f(cap * 2)} 0a${f(cap)} ${f(cap)} 0 1 0 ${f(-cap * 2)} 0Z`;
    }
  }
  return d;
}

/** Place a unit point on the page: mirror, width, slant, then scale. */
function place(p: Pt, st: ScriptState, size: number, mirror: number): Pt {
  const x = (p[0] - 0.5) * mirror * st.aspect + 0.5 * st.aspect;
  const y = p[1];
  return [(x + st.slant * (1 - y)) * size, y * size];
}

const MARK_SHAPES: Record<MarkKind, Pt[][]> = {
  dot: [[[0.5, 0.5], [0.5, 0.52]]],
  bar: [[[0.15, 0.5], [0.85, 0.5]]],
  tick: [[[0.3, 0.75], [0.7, 0.25]]],
  hook: [[[0.25, 0.3], [0.7, 0.3], [0.7, 0.75]]],
  ring: [[[0.5, 0.2], [0.8, 0.5], [0.5, 0.8], [0.2, 0.5], [0.5, 0.2]]],
  pair: [
    [[0.25, 0.5], [0.25, 0.52]],
    [[0.75, 0.5], [0.75, 0.52]],
  ],
  chevron: [[[0.15, 0.75], [0.5, 0.25], [0.85, 0.75]]],
  stroke: [[[0.2, 0.8], [0.8, 0.2]]],
};

/** Path data for a mark beside, above, below, or through a letter of the given width. */
function markPath(m: Mark, st: ScriptState, size: number, width: number, slot: number): string {
  const s = 0.34 * size;
  let ox: number;
  let oy: number;
  if (m.place === 'above') {
    ox = width / 2 - s / 2 + st.slant * size + (slot - 0.5) * s * 0.9 * (slot ? 1 : 0);
    oy = -s * 1.05 - slot * s * 0.85;
  } else if (m.place === 'below') {
    ox = width / 2 - s / 2 + slot * s * 0.9;
    oy = size + s * 0.1;
  } else if (m.place === 'right') {
    ox = width + s * 0.05;
    oy = size * 0.5 - s / 2 - slot * s;
  } else {
    ox = width / 2 - s * 0.9;
    oy = size / 2 - s * 0.9;
  }
  const scale = m.place === 'through' ? s * 1.8 : s;
  const markState = { ...st, weight: st.weight * (m.kind === 'dot' || m.kind === 'pair' ? 1.5 : 0.85), aspect: 1, slant: 0 };
  let d = '';
  for (const stroke of MARK_SHAPES[m.kind]) {
    const pts = densify(stroke.map(([x, y]) => [ox + x * scale, oy + y * scale] as Pt));
    d += strokeOutline(pts, markState, size);
  }
  return d;
}

export interface DrawnSign {
  d: string;
  width: number;
}

/** Path data for a letter at a size, with some strokes retracting (k from 1 to 0). */
export function drawGlyph(g: Glyph, st: ScriptState, size: number, mirror = 1, fading?: Map<number, number>): string {
  let d = '';
  g.strokes.forEach((stroke, i) => {
    const k = fading?.get(i) ?? 1;
    if (k <= 0.02) return;
    let pts = straighten(stroke.map(NODE));
    if (k < 1) {
      // Retract toward the stroke's start.
      const total = pts.slice(1).reduce((n, p, j) => n + Math.hypot(p[0] - pts[j][0], p[1] - pts[j][1]), 0);
      let left = total * k;
      const cut: Pt[] = [pts[0]];
      for (let j = 1; j < pts.length && left > 0; j++) {
        const seglen = Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
        const t = Math.min(1, left / seglen);
        cut.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * t]);
        left -= seglen;
      }
      pts = cut;
    }
    const placed = smooth(pts, st.round).map((p) => place(p, st, size, mirror));
    d += strokeOutline(placed, st, size);
  });
  return d;
}

export function signWidth(st: ScriptState, size: number): number {
  return (st.aspect + Math.abs(st.slant)) * size;
}

export function drawMarks(marks: Mark[], st: ScriptState, size: number): string {
  const width = st.aspect * size;
  const counts: Partial<Record<MarkPlace, number>> = {};
  let d = '';
  for (const m of marks) {
    const slot = counts[m.place] ?? 0;
    counts[m.place] = slot + 1;
    d += markPath(m, st, size, width, slot);
  }
  return d;
}

/** A word divider: a stacked pair of points, as on old inscriptions. */
export function dividerPath(st: ScriptState, size: number, x: number): string {
  const r = st.weight * size * 0.75;
  let d = '';
  for (const y of [size * 0.32, size * 0.72]) {
    d += `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(r * 2)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-r * 2)} 0Z`;
  }
  return d;
}
