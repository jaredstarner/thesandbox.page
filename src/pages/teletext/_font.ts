// The character generator. Every glyph is drawn on a 5 x 9 dot matrix, the
// way the teletext decoder chips of the 1970s held them, then expanded to
// 10 x 18 with character rounding: wherever two dots touch only at a corner,
// half-dots are added on either side of the join, so diagonals come out as
// smooth strokes instead of staircases.
//
// Codes follow the teletext English G0 set: 0x23 is a pound sign, 0x5F a
// hash, and 0x5B to 0x5E and 0x7B to 0x7F are arrows, fractions, and a block.

/** Glyph width and height on the dot matrix. */
export const DOT_W = 5;
export const DOT_H = 9;
/** Width and height after rounding. */
export const GLYPH_W = DOT_W * 2;
export const GLYPH_H = DOT_H * 2;

// Rows top to bottom; capitals sit on rows 0 to 6, descenders on 7 and 8.
// Glyphs with fewer than nine rows are blank below.
const DOTS: Record<number, string> = {
  0x20: '.....',
  0x21: '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  0x22: '.#.#. .#.#. .#.#.',
  0x23: '..##. .#..# .#... ###.. .#... .#... #####',
  0x24: '..#.. .#### #.#.. .###. ..#.# ####. ..#..',
  0x25: '##... ##..# ...#. ..#.. .#... #..## ...##',
  0x26: '.#... #.#.. #.#.. .#... #.#.# #..#. .##.#',
  0x27: '..#.. ..#.. .#...',
  0x28: '...#. ..#.. .#... .#... .#... ..#.. ...#.',
  0x29: '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
  0x2a: '..#.. #.#.# .###. ..#.. .###. #.#.# ..#..',
  0x2b: '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  0x2c: '..... ..... ..... ..... ..... ..#.. ..#.. .#...',
  0x2d: '..... ..... ..... .###. ..... ..... .....',
  0x2e: '..... ..... ..... ..... ..... ..... ..#..',
  0x2f: '..... ....# ...#. ..#.. .#... #.... .....',
  0x30: '..#.. .#.#. #...# #...# #...# .#.#. ..#..',
  0x31: '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  0x32: '.###. #...# ....# ..##. .#... #.... #####',
  0x33: '##### ....# ...#. ..##. ....# #...# .###.',
  0x34: '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  0x35: '##### #.... ####. ....# ....# #...# .###.',
  0x36: '..##. .#... #.... ####. #...# #...# .###.',
  0x37: '##### ....# ...#. ..#.. .#... .#... .#...',
  0x38: '.###. #...# #...# .###. #...# #...# .###.',
  0x39: '.###. #...# #...# .#### ....# ...#. .##..',
  0x3a: '..... ..... ..#.. ..... ..... ..#.. .....',
  0x3b: '..... ..... ..#.. ..... ..... ..#.. ..#.. .#...',
  0x3c: '...#. ..#.. .#... #.... .#... ..#.. ...#.',
  0x3d: '..... ..... ##### ..... ##### ..... .....',
  0x3e: '.#... ..#.. ...#. ....# ...#. ..#.. .#...',
  0x3f: '.###. #...# ...#. ..#.. ..#.. ..... ..#..',
  0x40: '.###. #...# #.### #.#.# #.### #.... .###.',
  0x41: '..#.. .#.#. #...# #...# ##### #...# #...#',
  0x42: '####. #...# #...# ####. #...# #...# ####.',
  0x43: '.###. #...# #.... #.... #.... #...# .###.',
  0x44: '####. #...# #...# #...# #...# #...# ####.',
  0x45: '##### #.... #.... ####. #.... #.... #####',
  0x46: '##### #.... #.... ####. #.... #.... #....',
  0x47: '.###. #...# #.... #.... #..## #...# .####',
  0x48: '#...# #...# #...# ##### #...# #...# #...#',
  0x49: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  0x4a: '....# ....# ....# ....# ....# #...# .###.',
  0x4b: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  0x4c: '#.... #.... #.... #.... #.... #.... #####',
  0x4d: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  0x4e: '#...# #...# ##..# #.#.# #..## #...# #...#',
  0x4f: '.###. #...# #...# #...# #...# #...# .###.',
  0x50: '####. #...# #...# ####. #.... #.... #....',
  0x51: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  0x52: '####. #...# #...# ####. #.#.. #..#. #...#',
  0x53: '.###. #...# #.... .###. ....# #...# .###.',
  0x54: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  0x55: '#...# #...# #...# #...# #...# #...# .###.',
  0x56: '#...# #...# #...# .#.#. .#.#. ..#.. ..#..',
  0x57: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  0x58: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  0x59: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  0x5a: '##### ....# ...#. ..#.. .#... #.... #####',
  // Left arrow, one half, right arrow, up arrow, hash.
  0x5b: '..... ..#.. .#... ##### .#... ..#.. .....',
  0x5c: '#.... #.... #...# #..#. ..#.. .#.## #...# ...#. ..###',
  0x5d: '..... ..#.. ...#. ##### ...#. ..#.. .....',
  0x5e: '..#.. .###. #.#.# ..#.. ..#.. ..#.. ..#..',
  0x5f: '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
  // A rule as long as the cell.
  0x60: '..... ..... ..... ##### ..... ..... .....',
  0x61: '..... ..... .###. ....# .#### #...# .####',
  0x62: '#.... #.... ####. #...# #...# #...# ####.',
  0x63: '..... ..... .#### #.... #.... #.... .####',
  0x64: '....# ....# .#### #...# #...# #...# .####',
  0x65: '..... ..... .###. #...# ##### #.... .###.',
  0x66: '..##. .#... .#... ###.. .#... .#... .#...',
  0x67: '..... ..... .#### #...# #...# #...# .#### ....# .###.',
  0x68: '#.... #.... ####. #...# #...# #...# #...#',
  0x69: '..#.. ..... .##.. ..#.. ..#.. ..#.. .###.',
  0x6a: '...#. ..... ..##. ...#. ...#. ...#. ...#. ...#. .##..',
  0x6b: '.#... .#... .#..# .#.#. .##.. .#.#. .#..#',
  0x6c: '.##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  0x6d: '..... ..... ##.#. #.#.# #.#.# #.#.# #.#.#',
  0x6e: '..... ..... ####. #...# #...# #...# #...#',
  0x6f: '..... ..... .###. #...# #...# #...# .###.',
  0x70: '..... ..... ####. #...# #...# #...# ####. #.... #....',
  0x71: '..... ..... .#### #...# #...# #...# .#### ....# ....#',
  0x72: '..... ..... .#.## .##.. .#... .#... .#...',
  0x73: '..... ..... .#### #.... .###. ....# ####.',
  0x74: '.#... .#... ###.. .#... .#... .#... ..##.',
  0x75: '..... ..... #...# #...# #...# #...# .####',
  0x76: '..... ..... #...# #...# .#.#. .#.#. ..#..',
  0x77: '..... ..... #...# #...# #.#.# #.#.# .#.#.',
  0x78: '..... ..... #...# .#.#. ..#.. .#.#. #...#',
  0x79: '..... ..... #...# #...# #...# #...# .#### ....# .###.',
  0x7a: '..... ..... ##### ...#. ..#.. .#... #####',
  // One quarter, double bar, three quarters, divide, block.
  0x7b: '#.... #.... #...# #..#. ..#.. .#.#. #.##. .#### ...#.',
  0x7c: '.#.#. .#.#. .#.#. .#.#. .#.#. .#.#. .#.#.',
  0x7d: '##... .#... ##..# .#.#. ###.. .#.#. #.##. .#### ...#.',
  0x7e: '..... ..#.. ..... ##### ..... ..#.. .....',
  0x7f: '##### ##### ##### ##### ##### ##### #####',
};

/** The dot matrix for a code, as rows of booleans. */
function dots(code: number): boolean[][] {
  const rows = (DOTS[code] ?? DOTS[0x20]).split(' ');
  const out: boolean[][] = [];
  for (let y = 0; y < DOT_H; y++) {
    const r = rows[y] ?? '.....';
    out.push(Array.from({ length: DOT_W }, (_, x) => r[x] === '#'));
  }
  return out;
}

/** The dot matrix for a code, for drawing letters out of block graphics. */
export function dotMatrix(code: number): boolean[][] {
  return dots(code);
}

/**
 * Expands a 5 x 9 matrix to 10 x 18 with character rounding. Each dot becomes
 * 2 x 2; then every 2 x 2 group of dots that holds a bare diagonal (two dots
 * set corner to corner, the other two clear) gets the two inner half-dots of
 * the clear pair, which fills the notch on each side of the join.
 */
export function round(m: boolean[][]): Uint8Array {
  const out = new Uint8Array(GLYPH_W * GLYPH_H);
  const set = (x: number, y: number) => {
    out[y * GLYPH_W + x] = 1;
  };
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < DOT_W && y < DOT_H && m[y][x];
  for (let y = 0; y < DOT_H; y++) {
    for (let x = 0; x < DOT_W; x++) {
      if (!m[y][x]) continue;
      set(2 * x, 2 * y);
      set(2 * x + 1, 2 * y);
      set(2 * x, 2 * y + 1);
      set(2 * x + 1, 2 * y + 1);
    }
  }
  for (let y = 0; y < DOT_H - 1; y++) {
    for (let x = 0; x < DOT_W - 1; x++) {
      const a = at(x, y);
      const b = at(x + 1, y);
      const c = at(x, y + 1);
      const d = at(x + 1, y + 1);
      if (a && d && !b && !c) {
        // Falling diagonal: fill under the right dot's left edge and over the
        // left dot's right edge.
        set(2 * x + 2, 2 * y + 1);
        set(2 * x + 1, 2 * y + 2);
      }
      if (b && c && !a && !d) {
        // Rising diagonal.
        set(2 * x + 1, 2 * y + 1);
        set(2 * x + 2, 2 * y + 2);
      }
    }
  }
  return out;
}

/** Rounded glyphs for codes 0x20 to 0x7F, built once. */
export function buildGlyphs(): Uint8Array[] {
  const glyphs: Uint8Array[] = [];
  for (let c = 0; c < 128; c++) glyphs.push(round(dots(c < 0x20 ? 0x20 : c)));
  return glyphs;
}

// Characters a page may be written in, mapped to G0 codes. Anything not here
// loses its accents, and then falls back to a question mark.
const SPECIAL: Record<string, number> = {
  '£': 0x23,
  '#': 0x5f,
  '←': 0x5b,
  '½': 0x5c,
  '→': 0x5d,
  '↑': 0x5e,
  '¼': 0x7b,
  '‖': 0x7c,
  '¾': 0x7d,
  '÷': 0x7e,
  '■': 0x7f,
  '[': 0x28,
  ']': 0x29,
  '{': 0x28,
  '}': 0x29,
  '\\': 0x2f,
  '^': 0x5e,
  _: 0x2d,
  '`': 0x27,
  '|': 0x7c,
  '~': 0x2d,
  '‘': 0x27,
  '’': 0x27,
  '“': 0x22,
  '”': 0x22,
  '–': 0x2d,
  '—': 0x2d,
  '−': 0x2d,
  '…': 0x2e,
  '×': 0x78,
  '°': 0x20,
  ' ': 0x20,
};

/** Encodes text as G0 codes. */
export function encode(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const special = SPECIAL[ch];
    if (special !== undefined) {
      out.push(special);
      if (ch === '…') out.push(0x2e, 0x2e);
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code < 0x7f) {
      out.push(code);
      continue;
    }
    const bare = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (bare.length === 1 && bare.charCodeAt(0) >= 0x20 && bare.charCodeAt(0) < 0x7f) out.push(bare.charCodeAt(0));
    else if (ch === 'ß') out.push(0x73, 0x73);
    else if (ch === 'æ') out.push(0x61, 0x65);
    else if (ch === 'ø') out.push(0x6f);
    else if (ch === 'ł') out.push(0x6c);
    else if (ch === 'đ') out.push(0x64);
    else if (/\s/.test(ch)) out.push(0x20);
    else out.push(0x3f);
  }
  return out;
}
