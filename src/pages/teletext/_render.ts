// The decoder: turns a page's bytes into pixels, applying the Level 1 rules a
// set followed. Spacing attributes either act on their own cell ("set-at":
// steady, normal height, conceal, contiguous, separated, both backgrounds,
// hold) or from the next cell on ("set-after": colours, flash, double height,
// release). With hold on, an attribute cell in graphics shows the last mosaic
// instead of a space, which is how colour changes ran without gaps.

import { buildGlyphs, GLYPH_W, GLYPH_H } from './_font';
import { COLS, ROWS, DOUBLE, type Page } from './_page';

export const CELL_W = 12;
export const CELL_H = 20;
export const PAGE_W = COLS * CELL_W;
export const PAGE_H = ROWS * CELL_H;

// Phosphor-leaning primaries: the broadcast colours were pure, but a tube
// never showed them that way.
const PALETTE: [number, number, number][] = [
  [0, 0, 0],
  [255, 44, 36],
  [40, 250, 82],
  [255, 238, 52],
  [36, 64, 255],
  [255, 52, 236],
  [48, 244, 255],
  [246, 246, 240],
];

const RGBA = PALETTE.map(([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r);

const GLYPHS = buildGlyphs();

export interface Options {
  /** False during the off part of the flash cycle. */
  flashOn: boolean;
  /** Shows concealed text. */
  reveal: boolean;
}

/** One cell as the decoder resolved it. */
interface Cell {
  code: number;
  mosaic: boolean;
  separated: boolean;
  fg: number;
  bg: number;
  flash: boolean;
  conceal: boolean;
  double: boolean;
}

/** Resolves every cell of a row with the attribute rules. */
function decodeRow(page: Page, row: number): Cell[] {
  let fg = 7;
  let bg = 0;
  let graphics = false;
  let flash = false;
  let conceal = false;
  let double = false;
  let separated = false;
  let hold = false;
  let held = 0x20;
  let heldSep = false;
  const out: Cell[] = [];
  for (let col = 0; col < COLS; col++) {
    const b = page.get(row, col);
    // Set-at.
    if (b === 0x09) flash = false;
    else if (b === 0x0c) {
      if (double) held = 0x20;
      double = false;
    } else if (b === 0x18) conceal = true;
    else if (b === 0x19) separated = false;
    else if (b === 0x1a) separated = true;
    else if (b === 0x1c) bg = 0;
    else if (b === 0x1d) bg = fg;
    else if (b === 0x1e) hold = true;

    let cell: Cell;
    if (b < 0x20) {
      const showHeld = hold && graphics;
      cell = { code: showHeld ? held : 0x20, mosaic: showHeld, separated: heldSep, fg, bg, flash, conceal, double };
    } else if (graphics && b & 0x20) {
      held = b;
      heldSep = separated;
      cell = { code: b, mosaic: true, separated, fg, bg, flash, conceal, double };
    } else {
      cell = { code: b, mosaic: false, separated: false, fg, bg, flash, conceal, double };
    }
    out.push(cell);

    // Set-after.
    if (b >= 0x01 && b <= 0x07) {
      fg = b;
      if (graphics) held = 0x20;
      graphics = false;
      conceal = false;
    } else if (b >= 0x11 && b <= 0x17) {
      fg = b - 0x10;
      graphics = true;
      conceal = false;
    } else if (b === 0x08) flash = true;
    else if (b === 0x0d) {
      if (!double) held = 0x20;
      double = true;
    } else if (b === 0x1f) hold = false;
  }
  return out;
}

/** Whether a row turns on double height anywhere, which makes the next row its lower half. */
function hasDouble(page: Page, row: number): boolean {
  for (let c = 0; c < COLS; c++) if (page.get(row, c) === DOUBLE) return true;
  return false;
}

/**
 * Draws one cell. `part` is 0 for a normal row, 1 for the top of a double
 * height row and 2 for its bottom.
 */
function drawCell(px: Uint32Array, cx: number, cy: number, cell: Cell, part: 0 | 1 | 2, o: Options): void {
  const bg = RGBA[cell.bg];
  const fg = RGBA[cell.fg];
  const tall = cell.double && part !== 0;
  const scale = tall ? 2 : 1;
  const yOff = tall && part === 2 ? CELL_H : 0;
  const hidden = (cell.flash && !o.flashOn) || (cell.conceal && !o.reveal) || (part === 2 && !cell.double);
  const x0 = cx * CELL_W;
  const y0 = cy * CELL_H;
  const glyph = GLYPHS[cell.code & 0x7f];
  const bits = cell.code;
  for (let py = 0; py < CELL_H; py++) {
    const vy = py + yOff;
    let line = (y0 + py) * PAGE_W + x0;
    for (let pxi = 0; pxi < CELL_W; pxi++, line++) {
      let on = false;
      if (!hidden && cell.code !== 0x20) {
        if (cell.mosaic) {
          const col = pxi < 6 ? 0 : 1;
          const band = vy < 6 * scale ? 0 : vy < 14 * scale ? 1 : 2;
          const bit = band * 2 + col;
          const mask = bit === 5 ? 0x40 : 1 << bit;
          on = (bits & mask) !== 0;
          if (on && cell.separated) {
            const bx = pxi - col * 6;
            const top = band === 0 ? 0 : band === 1 ? 6 * scale : 14 * scale;
            const bottom = band === 0 ? 6 * scale : band === 1 ? 14 * scale : 20 * scale;
            if (bx < 1 || bx >= 5 || vy >= bottom - 2 * scale || vy < top) on = false;
          }
        } else {
          const gx = pxi - 1;
          const gy = Math.floor((vy - scale) / scale);
          if (gx >= 0 && gx < GLYPH_W && gy >= 0 && gy < GLYPH_H) on = glyph[gy * GLYPH_W + gx] === 1;
        }
      }
      px[line] = on ? fg : bg;
    }
  }
}

/** Renders a whole page into a 480 x 500 ImageData. */
export function render(page: Page, image: ImageData, o: Options): void {
  const px = new Uint32Array(image.data.buffer);
  let upper: Cell[] | null = null;
  for (let row = 0; row < ROWS; row++) {
    if (upper) {
      const cells = upper;
      for (let c = 0; c < COLS; c++) drawCell(px, c, row, cells[c], 2, o);
      upper = null;
      continue;
    }
    const cells = decodeRow(page, row);
    const top = row > 0 && row < ROWS - 1 && hasDouble(page, row);
    for (let c = 0; c < COLS; c++) drawCell(px, c, row, cells[c], top ? 1 : 0, o);
    if (top) upper = cells;
  }
}

/** Whether any cell on the page flashes, so the set knows to keep redrawing. */
export function flashes(page: Page): boolean {
  for (let row = 0; row < ROWS; row++) {
    for (let c = 0; c < COLS; c++) if (page.get(row, c) === 0x08) return true;
  }
  return false;
}
