// A page is 25 rows of 40 bytes, exactly as a decoder stores it. Row 0 is the
// header the set writes itself; rows 1 to 24 are the page. Bytes below 0x20
// are spacing attributes: each takes a cell (shown as a space) and changes how
// the rest of the row is drawn.

import { encode } from './_font';

export const COLS = 40;
export const ROWS = 25;

/** Colours, in teletext order. */
export const C = { black: 0, red: 1, green: 2, yellow: 3, blue: 4, magenta: 5, cyan: 6, white: 7 } as const;

/** Alphanumeric colour codes: text in that colour from the next cell. */
export const A = { red: 0x01, green: 0x02, yellow: 0x03, blue: 0x04, magenta: 0x05, cyan: 0x06, white: 0x07 } as const;
/** Mosaic colour codes: block graphics in that colour from the next cell. */
export const G = { red: 0x11, green: 0x12, yellow: 0x13, blue: 0x14, magenta: 0x15, cyan: 0x16, white: 0x17 } as const;

export const FLASH = 0x08;
export const STEADY = 0x09;
export const NORMAL = 0x0c;
export const DOUBLE = 0x0d;
export const CONCEAL = 0x18;
export const CONTIG = 0x19;
export const SEPARATE = 0x1a;
export const BLACK_BG = 0x1c;
export const NEW_BG = 0x1d;
export const HOLD = 0x1e;
export const RELEASE = 0x1f;

export type Colour = keyof typeof A;
export type Part = number | string | Part[];

/** A mosaic code from six cells, top-left to bottom-right, read across. */
export function sixel(tl: boolean, tr: boolean, ml: boolean, mr: boolean, bl: boolean, br: boolean): number {
  return 0x20 | (tl ? 1 : 0) | (tr ? 2 : 0) | (ml ? 4 : 0) | (mr ? 8 : 0) | (bl ? 16 : 0) | (br ? 64 : 0);
}

export class Page {
  readonly buf = new Uint8Array(COLS * ROWS).fill(0x20);

  /** Writes parts (codes, text, nested lists) from a column, clipped at 40. */
  put(row: number, col: number, ...parts: Part[]): number {
    const flat = (p: Part): number[] =>
      typeof p === 'number' ? [p] : typeof p === 'string' ? encode(p) : p.flatMap(flat);
    for (const b of parts.flatMap(flat)) {
      if (col >= COLS) break;
      if (col >= 0 && row >= 0 && row < ROWS) this.buf[row * COLS + col] = b;
      col++;
    }
    return col;
  }

  get(row: number, col: number): number {
    return this.buf[row * COLS + col];
  }

  clearRow(row: number): void {
    this.buf.fill(0x20, row * COLS, (row + 1) * COLS);
  }

  /** Copies another page's rows over this one. */
  copy(from: Page, rows = [1, ROWS - 1]): void {
    this.buf.set(from.buf.subarray(rows[0] * COLS, (rows[1] + 1) * COLS), rows[0] * COLS);
  }

  /**
   * Draws a bitmap of mosaic cells: `lit(x, y)` is asked for every sixel in a
   * block `w` cells wide and `h` rows tall starting at (row, col). The caller
   * sets the graphics colour in an earlier cell.
   */
  mosaic(row: number, col: number, w: number, h: number, lit: (x: number, y: number) => boolean): void {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const x = c * 2;
        const y = r * 3;
        this.buf[(row + r) * COLS + col + c] = sixel(
          lit(x, y),
          lit(x + 1, y),
          lit(x, y + 1),
          lit(x + 1, y + 1),
          lit(x, y + 2),
          lit(x + 1, y + 2),
        );
      }
    }
  }

  /** The visible text of a row, attributes as spaces, for the screen reader mirror. */
  text(row: number): string {
    let s = '';
    let graphics = false;
    for (let c = 0; c < COLS; c++) {
      const b = this.get(row, c);
      if (b < 0x20) {
        if (b >= 0x01 && b <= 0x07) graphics = false;
        if (b >= 0x11 && b <= 0x17) graphics = true;
        s += ' ';
      } else if (graphics && (b < 0x40 || b >= 0x60)) s += ' ';
      else s += String.fromCharCode(b === 0x23 ? 0xa3 : b === 0x5f ? 0x23 : b);
    }
    return s.replace(/\s+/g, ' ').trim();
  }
}

/** Splits text into lines of at most `width` characters, breaking on spaces. */
export function wrap(text: string, width: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (let w of words) {
    while (w.length > width) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(w.slice(0, width - 1) + '-');
      w = w.slice(width - 1);
    }
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += ' ' + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Pads or clips text to exactly `n` characters. */
export function fit(text: string, n: number, align: 'left' | 'right' = 'left'): string {
  const t = text.length > n ? text.slice(0, n) : text;
  return align === 'left' ? t.padEnd(n) : t.padStart(n);
}
