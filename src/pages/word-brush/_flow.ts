// The typesetter. Pretext breaks the passage into lines that fit each span the
// mask offers, row by row and left to right, carrying on from wherever the
// last line stopped. Each line is then justified to its span, and every word
// gets an id that stays the same wherever it lands, so it can glide there.

import { layoutNextLine, prepareWithSegments, type LayoutCursor, type PreparedTextWithSegments } from '@chenglou/pretext';
import { SEPARATOR } from './_texts';

/** One word, or the part of a word that fit, placed on the sheet. */
export interface Piece {
  id: number;
  text: string;
  x: number;
  /** Baseline. */
  y: number;
  /** Set in red: pilcrows and the mark between passes. */
  rubric: boolean;
}

export interface Placement {
  pieces: Piece[];
  words: number;
  /** How many times through the passage, counting a partial pass. */
  passes: number;
}

const GAP_KINDS = new Set(['space', 'preserved-space', 'tab', 'zero-width-break', 'soft-hyphen', 'hard-break']);
const RUBRICS = new Set(['¶', SEPARATOR.trim()]);

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const split = (s: string) => Array.from(graphemes.segment(s), (g) => g.segment);

export class Typesetter {
  private prepared: PreparedTextWithSegments | null = null;
  private starts: number[] = [];
  private passLength = 1;
  private measure: CanvasRenderingContext2D;
  private font = '';
  private passage = '';
  private chars = 0;
  size = 16;
  lineHeight = 20;

  constructor() {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.measure = ctx;
  }

  /**
   * Set the passage and face. The passage repeats enough times to fill
   * `capacity` characters, so a big drawing never runs out of words.
   */
  set(passage: string, font: string, size: number, capacity: number): void {
    const pass = passage.trim() + SEPARATOR;
    const repeats = Math.max(2, Math.ceil(capacity / pass.length) + 1);
    this.measure.font = font;
    if (passage === this.passage && font === this.font && repeats * pass.length <= this.chars) return;
    this.passage = passage;
    this.font = font;
    this.size = size;
    this.lineHeight = Math.round(size * 1.24);
    this.passLength = pass.length;
    const text = pass.repeat(repeats);
    this.chars = text.length;
    this.prepared = prepareWithSegments(text, font);
    let at = 0;
    this.starts = this.prepared.segments.map((s) => {
      const start = at;
      at += s.length;
      return start;
    });
  }

  /** The average advance of a character in this face, for sizing the repeats. */
  averageAdvance(font: string): number {
    this.measure.font = font;
    return this.measure.measureText('the quick brown fox jumps over a lazy dog').width / 41;
  }

  private width(text: string): number {
    return this.measure.measureText(text).width;
  }

  /**
   * Fill the rows. rows[k] lists the spans of the band at k * lineHeight as
   * flat x0, x1 pairs.
   */
  place(rows: number[][]): Placement {
    const out: Piece[] = [];
    const prepared = this.prepared;
    if (!prepared) return { pieces: out, words: 0, passes: 0 };
    const { segments, kinds, widths } = prepared;
    const lh = this.lineHeight;
    const baseline = lh / 2 + this.size * 0.28;
    const maxGap = this.size * 2.2;
    let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
    let words = 0;
    let lastChar = 0;

    rows: for (let k = 0; k < rows.length; k++) {
      const spans = rows[k];
      const y = k * lh + baseline;
      for (let s = 0; s < spans.length; s += 2) {
        const x0 = spans[s];
        const room = spans[s + 1] - x0;
        const line = layoutNextLine(prepared, cursor, room);
        if (!line) break rows;
        cursor = line.end;

        // Walk the line's segments into words and gaps.
        const start = line.start;
        const end = line.end;
        const lineWords: { id: number; text: string; w: number; gapBefore: boolean }[] = [];
        let gap = false;
        const last = end.graphemeIndex > 0 ? end.segmentIndex : end.segmentIndex - 1;
        for (let i = start.segmentIndex; i <= last; i++) {
          if (GAP_KINDS.has(kinds[i])) {
            gap = lineWords.length > 0;
            continue;
          }
          const from = i === start.segmentIndex ? start.graphemeIndex : 0;
          const to = i === end.segmentIndex ? end.graphemeIndex : -1;
          let text = segments[i];
          let w = widths[i];
          if (from > 0 || to >= 0) {
            const g = split(text);
            text = g.slice(from, to >= 0 ? to : g.length).join('');
            w = this.width(text);
          }
          if (!text) continue;
          // A word broken across lines keeps one id per piece.
          const id = i * 1024 + Math.min(from, 1023);
          const prev = lineWords[lineWords.length - 1];
          if (prev && !gap) {
            // Glued to the previous segment (punctuation, a broken script run).
            prev.text += text;
            prev.w += w;
          } else {
            lineWords.push({ id, text, w, gapBefore: gap });
            if (from === 0) words++;
          }
          gap = false;
          lastChar = this.starts[i];
        }
        if (lineWords.length === 0) continue;

        // Justify to the span: spread the slack over the gaps, up to a limit,
        // and centre whatever is left.
        const space = this.width(' ');
        let natural = 0;
        let gaps = 0;
        for (const w of lineWords) {
          if (w.gapBefore) {
            natural += space;
            gaps++;
          }
          natural += w.w;
        }
        const slack = Math.max(0, room - natural);
        const extra = gaps > 0 ? Math.min(slack / gaps, maxGap) : 0;
        let x = x0 + (slack - extra * gaps) / 2;
        for (const w of lineWords) {
          if (w.gapBefore) x += space + extra;
          out.push({ id: w.id, text: w.text, x, y, rubric: RUBRICS.has(w.text) });
          x += w.w;
        }
      }
    }
    const passes = out.length ? Math.floor(lastChar / this.passLength) + 1 : 0;
    return { pieces: out, words, passes };
  }
}
