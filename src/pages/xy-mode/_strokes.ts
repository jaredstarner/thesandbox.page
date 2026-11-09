// A single-stroke alphabet: the beam can only draw lines, so letters are centrelines, not
// outlines. Glyphs sit on a baseline at 0 with capitals 6 units tall. M moves, L draws a
// line, Q draws a quadratic curve.

import type { Path } from './_path';

interface Glyph {
  width: number;
  /** Strokes as flat x, y lists. */
  strokes: number[][];
}

const SOURCE: Record<string, [number, string]> = {
  A: [4, 'M0 0 L2 6 L4 0 M0.7 2 L3.3 2'],
  B: [4.2, 'M0 3.2 L2.4 3.2 Q4 3.2 4 4.6 Q4 6 2.4 6 L0 6 L0 0 L2.4 0 Q4.2 0 4.2 1.6 Q4.2 3.2 2.4 3.2'],
  C: [4, 'M4 4.9 Q3.4 6 2.1 6 Q0 6 0 3 Q0 0 2.1 0 Q3.4 0 4 1.1'],
  D: [4.2, 'M0 0 L0 6 L1.6 6 Q4.2 6 4.2 3 Q4.2 0 1.6 0 L0 0'],
  E: [3.8, 'M3.8 6 L0 6 L0 0 L3.8 0 M0 3.2 L3 3.2'],
  F: [3.8, 'M3.8 6 L0 6 L0 0 M0 3.2 L3 3.2'],
  G: [4, 'M4 4.9 Q3.4 6 2.1 6 Q0 6 0 3 Q0 0 2.1 0 Q4 0 4 2.6 L2.4 2.6'],
  H: [4, 'M0 6 L0 0 M4 6 L4 0 M0 3.2 L4 3.2'],
  I: [0.6, 'M0.3 6 L0.3 0'],
  J: [3, 'M3 6 L3 1.6 Q3 0 1.5 0 Q0 0 0 1.6'],
  K: [4, 'M0 6 L0 0 M4 6 L0 2.4 M1.4 3.6 L4 0'],
  L: [3.4, 'M0 6 L0 0 L3.4 0'],
  M: [4.8, 'M0 0 L0 6 L2.4 1.6 L4.8 6 L4.8 0'],
  N: [4, 'M0 0 L0 6 L4 0 L4 6'],
  O: [4.2, 'M2.1 6 Q0 6 0 3 Q0 0 2.1 0 Q4.2 0 4.2 3 Q4.2 6 2.1 6'],
  P: [4, 'M0 0 L0 6 L2.4 6 Q4 6 4 4.3 Q4 2.6 2.4 2.6 L0 2.6'],
  Q: [4.4, 'M2.1 6 Q0 6 0 3 Q0 0 2.1 0 Q4.2 0 4.2 3 Q4.2 6 2.1 6 M2.6 1.3 L4.4 -0.4'],
  R: [4, 'M0 0 L0 6 L2.4 6 Q4 6 4 4.3 Q4 2.6 2.4 2.6 L0 2.6 M2.2 2.6 L4 0'],
  S: [4, 'M3.8 5 Q3.2 6 2 6 Q0.2 6 0.2 4.5 Q0.2 3.3 2 3 Q4 2.7 4 1.5 Q4 0 2 0 Q0.6 0 0 1.1'],
  T: [4.2, 'M0 6 L4.2 6 M2.1 6 L2.1 0'],
  U: [4, 'M0 6 L0 1.9 Q0 0 2 0 Q4 0 4 1.9 L4 6'],
  V: [4, 'M0 6 L2 0 L4 6'],
  W: [5.6, 'M0 6 L1.4 0 L2.8 4.6 L4.2 0 L5.6 6'],
  X: [4, 'M0 6 L4 0 M4 6 L0 0'],
  Y: [4, 'M0 6 L2 3 L4 6 M2 3 L2 0'],
  Z: [4, 'M0 6 L4 6 L0 0 L4 0'],
  '0': [3.6, 'M1.8 6 Q0 6 0 3 Q0 0 1.8 0 Q3.6 0 3.6 3 Q3.6 6 1.8 6'],
  '1': [1.8, 'M0 4.8 L1.4 6 L1.4 0'],
  '2': [3.8, 'M0.1 4.6 Q0.3 6 1.9 6 Q3.6 6 3.6 4.4 Q3.6 3.2 0 0 L3.8 0'],
  '3': [3.8, 'M0.2 5.1 Q0.8 6 1.9 6 Q3.6 6 3.6 4.5 Q3.6 3.2 1.6 3.2 Q3.8 3.2 3.8 1.6 Q3.8 0 1.9 0 Q0.6 0 0 1'],
  '4': [3.8, 'M2.8 0 L2.8 6 L0 1.8 L3.8 1.8'],
  '5': [3.8, 'M3.4 6 L0.5 6 L0.2 3.3 Q0.9 3.9 1.9 3.9 Q3.8 3.9 3.8 2 Q3.8 0 1.9 0 Q0.6 0 0 1'],
  '6': [3.7, 'M3.2 5.6 Q2.5 6 1.9 6 Q0 6 0 2.6 L0 2 Q0 0 1.9 0 Q3.7 0 3.7 1.9 Q3.7 3.7 1.9 3.7 Q0.6 3.7 0 2.6'],
  '7': [3.8, 'M0 6 L3.8 6 L1.2 0'],
  '8': [
    3.8,
    'M1.9 3.3 Q0.3 3.3 0.3 4.7 Q0.3 6 1.9 6 Q3.5 6 3.5 4.7 Q3.5 3.3 1.9 3.3 Q0 3.3 0 1.6 Q0 0 1.9 0 Q3.8 0 3.8 1.6 Q3.8 3.3 1.9 3.3',
  ],
  '9': [3.7, 'M0.6 0.4 Q1.2 0 1.8 0 Q3.7 0 3.7 3.4 L3.7 4 Q3.7 6 1.8 6 Q0 6 0 4.1 Q0 2.3 1.8 2.3 Q3.1 2.3 3.7 3.4'],
  '.': [0.6, 'M0 0 L0.6 0 L0.6 0.6 L0 0.6 L0 0 L0.6 0 L0.6 0.6 L0 0.6 L0 0'],
  ',': [0.6, 'M0.45 0.35 L0 -0.8'],
  ':': [0.6, 'M0 3.6 L0.6 3.6 L0.6 4.2 L0 4.2 L0 3.6 M0 0 L0.6 0 L0.6 0.6 L0 0.6 L0 0'],
  ';': [0.6, 'M0.45 4.2 L0.45 3.85 M0.45 0.35 L0 -0.8'],
  '!': [0.6, 'M0.3 6 L0.3 1.8 M0.3 0.35 L0.3 0'],
  '?': [3.4, 'M0 4.8 Q0.3 6 1.7 6 Q3.4 6 3.4 4.6 Q3.4 3.4 1.7 2.8 L1.7 1.7 M1.7 0.35 L1.7 0'],
  '-': [2.4, 'M0 2.6 L2.4 2.6'],
  _: [3.6, 'M0 -0.6 L3.6 -0.6'],
  '+': [3, 'M0 2.8 L3 2.8 M1.5 1.3 L1.5 4.3'],
  '=': [3, 'M0 3.6 L3 3.6 M0 1.9 L3 1.9'],
  '/': [3, 'M0 -0.4 L3 6.4'],
  '\\': [3, 'M3 -0.4 L0 6.4'],
  '*': [2.8, 'M1.4 5.8 L1.4 2.6 M0 5 L2.8 3.4 M2.8 5 L0 3.4'],
  "'": [0.6, 'M0.3 6 L0.3 4.4'],
  '"': [1.6, 'M0.2 6 L0.2 4.4 M1.4 6 L1.4 4.4'],
  '(': [1.4, 'M1.4 6.6 Q-0.4 3 1.4 -0.6'],
  ')': [1.4, 'M0 6.6 Q1.8 3 0 -0.6'],
  '&': [4.2, 'M4.2 0 L1 4.4 Q0.5 6 1.8 6 Q3.1 6 3 4.8 Q2.9 3.8 1.4 3 Q0 2.3 0 1.3 Q0 0 1.6 0 Q3.2 0 4.2 2.4'],
  '#': [4, 'M1.4 6 L0.8 0 M3.2 6 L2.6 0 M0 4 L4 4 M0 2 L4 2'],
  '@': [
    5,
    'M3.4 2.2 Q3.4 4 2.4 4 Q1.2 4 1.2 2.8 Q1.2 1.8 2.2 1.8 Q3.4 1.8 3.4 3 L3.4 2.2 Q3.4 1.5 4 1.5 Q5 1.5 5 3 Q5 6 2.5 6 Q0 6 0 3 Q0 0 2.5 0 Q3.6 0 4.4 0.5',
  ],
};

const FALLBACK: [number, string] = [3, 'M0 3 L1.5 4.5 L3 3 L1.5 1.5 L0 3'];

function parse(width: number, source: string): Glyph {
  const strokes: number[][] = [];
  const parts = source.trim().split(/\s+/);
  let stroke: number[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const op = part[0];
    if (op === 'M') {
      if (stroke.length) strokes.push(stroke);
      x = parseFloat(part.slice(1));
      y = parseFloat(parts[++i]);
      stroke = [x, y];
    } else if (op === 'L') {
      x = parseFloat(part.slice(1));
      y = parseFloat(parts[++i]);
      stroke.push(x, y);
    } else if (op === 'Q') {
      const cx = parseFloat(part.slice(1));
      const cy = parseFloat(parts[++i]);
      const ex = parseFloat(parts[++i]);
      const ey = parseFloat(parts[++i]);
      for (let k = 1; k <= 6; k++) {
        const t = k / 6;
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        const c = t * t;
        stroke.push(a * x + b * cx + c * ex, a * y + b * cy + c * ey);
      }
      x = ex;
      y = ey;
    }
  }
  if (stroke.length) strokes.push(stroke);
  return { width, strokes };
}

const GLYPHS = new Map<string, Glyph>();
for (const key of Object.keys(SOURCE)) GLYPHS.set(key, parse(SOURCE[key][0], SOURCE[key][1]));
const FALLBACK_GLYPH = parse(FALLBACK[0], FALLBACK[1]);

const LETTER_GAP = 1.5;
const WORD_GAP = 3.6;
const LINE_GAP = 3.4;
const CAP = 6;

function glyphFor(ch: string): Glyph {
  return GLYPHS.get(ch.toUpperCase()) ?? FALLBACK_GLYPH;
}

function measure(text: string): number {
  let w = 0;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === ' ') {
      w += WORD_GAP;
      continue;
    }
    w += glyphFor(ch).width;
    if (i < chars.length - 1 && chars[i + 1] !== ' ') w += LETTER_GAP;
  }
  return w;
}

/** Break text into lines so the block comes out as close to square as the words allow. */
function wrap(text: string, maxLines: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const words = clean.split(' ');
  const full = measure(clean);
  let best: string[] = [clean];
  let bestScale = 0;
  for (let lines = 1; lines <= Math.min(maxLines, words.length); lines++) {
    const target = full / lines;
    const out: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > target * 1.12 && out.length < lines - 1) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
    const width = Math.max(...out.map(measure));
    const height = out.length * CAP + (out.length - 1) * LINE_GAP;
    const scale = Math.min(1.7 / width, 1.5 / height);
    if (scale > bestScale) {
      bestScale = scale;
      best = out;
    }
  }
  return best;
}

/** Add text to a path, centred on the tube and scaled to fit. */
export function setText(path: Path, text: string): void {
  const lines = wrap(text, 8);
  if (!lines.length) return;
  const width = Math.max(...lines.map(measure));
  const height = lines.length * CAP + (lines.length - 1) * LINE_GAP;
  const scale = Math.min(1.7 / width, 1.5 / height, 0.085);
  let baseline = (height / 2 - CAP) * scale;
  // A real typewriter goes back and forth; the beam reads each line left to right.
  for (const line of lines) {
    let x = (-measure(line) / 2) * scale;
    const chars = [...line];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === ' ') {
        x += WORD_GAP * scale;
        continue;
      }
      const glyph = glyphFor(ch);
      for (const stroke of glyph.strokes) {
        path.moveTo(x + stroke[0] * scale, baseline + stroke[1] * scale);
        for (let k = 2; k < stroke.length; k += 2) path.lineTo(x + stroke[k] * scale, baseline + stroke[k + 1] * scale);
      }
      x += glyph.width * scale;
      if (i < chars.length - 1 && chars[i + 1] !== ' ') x += LETTER_GAP * scale;
    }
    baseline -= (CAP + LINE_GAP) * scale;
  }
}
