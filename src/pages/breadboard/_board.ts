// /breadboard/: the board's geometry. One unit is the 0.1 inch (2.54 mm) hole pitch.
// Thirty numbered columns; each column's five holes a to e form one strip and f to j another,
// with the channel between e and f sized for chips. Two power rails run along each edge,
// the + rows outermost and the - rows inside, broken into groups of five holes.

export const COLS = 30;
export const ROW_LETTERS = 'abcdefghij';
export const ROW_Y = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11];

export type Rail = 'T+' | 'T-' | 'B-' | 'B+';

export const RAILS: { id: Rail; y: number; strip: number; sign: 1 | -1 }[] = [
  { id: 'T+', y: -3.4, strip: 60, sign: 1 },
  { id: 'T-', y: -2.4, strip: 61, sign: -1 },
  { id: 'B-', y: 13.4, strip: 62, sign: -1 },
  { id: 'B+', y: 14.4, strip: 63, sign: 1 },
];

export const STRIPS = 64;

export interface Hole {
  id: string;
  x: number;
  y: number;
  strip: number;
  rail: Rail | null;
  /** Row index 0 to 9 for the main area, -1 on a rail. */
  row: number;
  col: number;
}

/** Board body and the whole bench (board plus the battery beside it), in units. */
export const BOARD = { x0: -0.85, x1: 31.85, y0: -4.55, y1: 15.55 };
export const BENCH = { x0: -9.4, x1: 32.4, y0: -5.0, y1: 16.0 };

/** The battery stands upright to the left of the board; its snap's two terminals face up. */
export const BATTERY = { x: -5.2, y: 5.8, w: 6.9, h: 10.4 };

export function railHasCol(c: number): boolean {
  return c >= 1 && c <= 29 && c % 6 !== 0;
}

export const HOLES: Hole[] = [];
export const HOLE = new Map<string, Hole>();

for (let c = 1; c <= COLS; c++) {
  for (let r = 0; r < 10; r++) {
    const id = `${ROW_LETTERS[r]}${c}`;
    const h: Hole = { id, x: c, y: ROW_Y[r], strip: (r < 5 ? 0 : COLS) + c - 1, rail: null, row: r, col: c };
    HOLES.push(h);
    HOLE.set(id, h);
  }
}
for (const rail of RAILS) {
  for (let c = 1; c <= COLS; c++) {
    if (!railHasCol(c)) continue;
    const id = `${rail.id}${c}`;
    const h: Hole = { id, x: c, y: rail.y, strip: rail.strip, rail: rail.id, row: -1, col: c };
    HOLES.push(h);
    HOLE.set(id, h);
  }
}

/** Nearest hole to a point, within `reach` units. */
export function holeNear(x: number, y: number, reach = 0.55): Hole | null {
  let best: Hole | null = null;
  let bd = reach * reach;
  for (const h of HOLES) {
    const d = (h.x - x) ** 2 + (h.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

/** The hole exactly at a point, if any. */
export function holeAt(x: number, y: number): Hole | null {
  for (const h of HOLES) if (Math.abs(h.x - x) < 0.01 && Math.abs(h.y - y) < 0.01) return h;
  return null;
}

/** Every hole sharing a strip with this one. */
export function stripHoles(strip: number): Hole[] {
  return HOLES.filter((h) => h.strip === strip);
}

export function stripName(strip: number): string {
  if (strip >= 60) {
    const r = RAILS.find((x) => x.strip === strip)!;
    return `${r.id.startsWith('T') ? 'top' : 'bottom'} ${r.sign > 0 ? '+' : '−'} rail`;
  }
  const c = (strip % COLS) + 1;
  return strip < COLS ? `column ${c}, a–e` : `column ${c}, f–j`;
}
