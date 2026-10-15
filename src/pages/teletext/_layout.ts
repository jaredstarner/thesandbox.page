// The house style: a double-height title band, a dotted rule, body text with
// a colour cell at the left, a subpage counter, and the Fastext row.

import { dotMatrix, encode } from './_font';
import { A, G, DOUBLE, NEW_BG, SEPARATE, Page, fit, wrap, type Colour } from './_page';

export interface Band {
  title: string;
  /** Band colour. */
  bg: Colour;
  /** Title colour. */
  fg: Colour;
  /** Dotted rule colour under the band. */
  rule?: Colour;
  /** Short words at the right end of the band, such as a section name. */
  tag?: string;
}

/** Rows 1 to 3: the band and its rule. */
export function band(p: Page, b: Band): void {
  p.put(1, 0, G[b.bg], NEW_BG, A[b.fg], DOUBLE, b.title.toUpperCase());
  if (b.tag) {
    const tag = b.tag.toUpperCase();
    p.put(1, 39 - tag.length - 1, A[b.fg === 'white' ? 'yellow' : 'white'], tag);
  }
  p.put(3, 0, G[b.rule ?? b.bg], SEPARATE, Array(39).fill(0x23));
}

export type Links = [number, number, number, number];
export type Labels = [string, string, string, string];

const FASTEXT: Colour[] = ['red', 'green', 'yellow', 'cyan'];

/** Row 24: four coloured prompts, one per Fastext key. */
export function fastext(p: Page, labels: Labels): void {
  labels.forEach((label, i) => {
    if (label) p.put(24, i * 10, A[FASTEXT[i]], fit(label, 9));
  });
}

/** Row 23, right: which subpage of a carousel this is. */
export function counter(p: Page, sub: number, total: number): void {
  if (total < 2) return;
  const t = `${sub + 1}/${total}`;
  p.put(23, 39 - t.length, A.white, t);
}

/** Writes wrapped text from a row; returns the next free row. */
export function para(p: Page, row: number, text: string, colour: Colour = 'white', width = 38, indent = 0): number {
  for (const line of wrap(text, width)) {
    p.put(row++, indent, A[colour], line);
  }
  return row;
}

/** Splits lines across as many subpages as they need, `per` rows each. */
export function paginate<T>(items: T[], per: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out.length ? out : [[]];
}

/**
 * Letters made from block graphics: each dot of the text font becomes one
 * sixel wide and `tall` sixels high. Returns the lit test for `Page.mosaic`.
 */
export function bigText(text: string, tall = 2, gap = 1): { w: number; lit: (x: number, y: number) => boolean } {
  const codes = encode(text);
  const mats = codes.map((c) => dotMatrix(c));
  const pitch = 5 + gap;
  const w = codes.length * pitch - gap;
  return {
    w,
    lit: (x, y) => {
      const i = Math.floor(x / pitch);
      const dx = x - i * pitch;
      const dy = Math.floor(y / tall);
      if (i < 0 || i >= mats.length || dx >= 5 || dy < 0 || dy >= 9) return false;
      return mats[i][dy][dx];
    },
  };
}

/** A page of plain text with the house band, for errors and waits. */
export function notice(b: Band, lines: string[], labels: Labels): Page {
  const p = new Page();
  band(p, b);
  let row = 6;
  for (const l of lines) row = para(p, row, l, row === 6 ? 'yellow' : 'white') + 1;
  fastext(p, labels);
  return p;
}
