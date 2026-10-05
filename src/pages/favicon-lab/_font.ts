// A 5 by 7 font drawn for this page, and LED-style drawing on the 32 pixel icon.

const SOURCE: Record<string, string> = {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
  '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####',
  '3': '##### ...#. ..#.. ...#. ....# #...# .###.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '..##. .#... #.... ####. #...# #...# .###.',
  '7': '##### ....# ...#. ..#.. .#... .#... .#...',
  '8': '.###. #...# #...# .###. #...# #...# .###.',
  '9': '.###. #...# #...# .#### ....# ...#. .##..',
  ' ': '..... ..... ..... ..... ..... ..... .....',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  ',': '..... ..... ..... ..... .##.. ..#.. .#...',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  "'": '..#.. ..#.. .#... ..... ..... ..... .....',
  '"': '.#.#. .#.#. ..... ..... ..... ..... .....',
  '-': '..... ..... ..... .###. ..... ..... .....',
  _: '..... ..... ..... ..... ..... ..... #####',
  ':': '..... .##.. .##.. ..... .##.. .##.. .....',
  '/': '..... ....# ...#. ..#.. .#... #.... .....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  '=': '..... ..... ##### ..... ##### ..... .....',
  '*': '..... ..#.. #.#.# .###. #.#.# ..#.. .....',
  '&': '.##.. #..#. #.#.. .#... #.#.# #..#. .##.#',
  '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
  '@': '.###. #...# #.### #.#.# #.### #.... .###.',
  '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
  ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
  '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.',
  '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#...',
  '·': '..... ..... ..... ..#.. ..... ..... .....',
  '♥': '..... .#.#. ##### ##### .###. ..#.. .....',
};

/** Each glyph as seven rows of five bits, high bit on the left. */
const GLYPHS = new Map<string, number[]>(
  Object.entries(SOURCE).map(([ch, rows]) => [
    ch,
    rows.split(' ').map((row) => [...row].reduce((bits, c) => (bits << 1) | (c === '#' ? 1 : 0), 0)),
  ]),
);

export const GLYPH_W = 5;
export const GLYPH_H = 7;

/** Fold a message into characters the font has: capitals, no accents, unknowns as '?'. */
export function fold(text: string): string {
  return [...text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()]
    .map((ch) => (GLYPHS.has(ch) ? ch : ch.trim() === '' ? ' ' : '?'))
    .join('');
}

export function glyph(ch: string): number[] {
  return GLYPHS.get(ch) ?? GLYPHS.get('?')!;
}

/** True when column x (0 to 4), row y (0 to 6) of a glyph is lit. */
export function lit(rows: number[], x: number, y: number): boolean {
  return x >= 0 && x < GLYPH_W && y >= 0 && y < GLYPH_H && ((rows[y]! >> (GLYPH_W - 1 - x)) & 1) === 1;
}

/** Draw text in plain blocks of `scale` pixels, one column of space between letters. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: string,
): void {
  ctx.fillStyle = color;
  [...text].forEach((ch, i) => {
    const rows = glyph(ch);
    const left = x + i * (GLYPH_W + 1) * scale;
    for (let gy = 0; gy < GLYPH_H; gy++) {
      for (let gx = 0; gx < GLYPH_W; gx++) {
        if (lit(rows, gx, gy)) ctx.fillRect(left + gx * scale, y + gy * scale, scale, scale);
      }
    }
  });
}

/** Width in pixels of text drawn by drawText. */
export function textWidth(text: string, scale: number): number {
  const n = [...text].length;
  return n === 0 ? 0 : (n * (GLYPH_W + 1) - 1) * scale;
}

// The sign's LED panel: 8 columns by 7 rows of 3 pixel lamps on a 4 pixel pitch.
export const LED_COLS = 8;
const LED_ROWS = 7;
const PITCH = 4;
const LAMP = 3;
const ORIGIN_X = 1;
const ORIGIN_Y = 2;

export const LED_ON = '#ffb000';
const LED_OFF = '#2e2210';
const LED_BACK = '#110c05';

/**
 * Draw one tab's window onto a scrolling sign. The sign is the message laid
 * out one character to every 8 columns, glyph in columns 1 to 5, looping.
 * `column` is the sign's column at this tab's left edge.
 */
export function drawSignWindow(ctx: CanvasRenderingContext2D, message: string, column: number): void {
  const chars = [...message];
  const span = chars.length * LED_COLS;
  ctx.fillStyle = LED_BACK;
  ctx.fillRect(0, 0, 32, 32);
  for (let c = 0; c < LED_COLS; c++) {
    const at = span ? (((column + c) % span) + span) % span : 0;
    const rows = span ? glyph(chars[Math.floor(at / LED_COLS)]!) : glyph(' ');
    const gx = (at % LED_COLS) - 1;
    for (let r = 0; r < LED_ROWS; r++) {
      ctx.fillStyle = lit(rows, gx, r) ? LED_ON : LED_OFF;
      ctx.fillRect(ORIGIN_X + c * PITCH, ORIGIN_Y + r * PITCH, LAMP, LAMP);
    }
  }
}

/** Draw a short label (a tab's number) on the LED panel, centered as well as the lamps allow. */
export function drawLedLabel(ctx: CanvasRenderingContext2D, label: string): void {
  ctx.fillStyle = LED_BACK;
  ctx.fillRect(0, 0, 32, 32);
  const chars = [...label].slice(0, 2);
  if (chars.length === 1) {
    // One character fills the panel: each glyph pixel is a lamp.
    const rows = glyph(chars[0]!);
    for (let c = 0; c < LED_COLS; c++) {
      for (let r = 0; r < LED_ROWS; r++) {
        ctx.fillStyle = lit(rows, c - 1, r) ? LED_ON : LED_OFF;
        ctx.fillRect(ORIGIN_X + c * PITCH, ORIGIN_Y + r * PITCH, LAMP, LAMP);
      }
    }
    return;
  }
  // Two characters: small solid pixels, two to a glyph pixel.
  drawText(ctx, chars.join(''), 5, 9, 2, LED_ON);
}
