// The undercroft's plan: a seeded 12 x 12 labyrinth with two halls, its lights,
// and what is cut into its walls. Everything is decided at build time, so every
// build lays the same stones.

export const SIZE = 12;
export type Dir = 'n' | 'e' | 's' | 'w';
export const DIRS: Dir[] = ['n', 'e', 's', 'w'];
export const STEP: Record<Dir, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
export const LEFT: Record<Dir, Dir> = { n: 'w', e: 'n', s: 'e', w: 's' };
export const RIGHT: Record<Dir, Dir> = { n: 'e', e: 's', s: 'w', w: 'n' };
export const BACK: Record<Dir, Dir> = { n: 's', e: 'w', s: 'n', w: 'e' };
export const DIR_NAME: Record<Dir, string> = { n: 'north', e: 'east', s: 'south', w: 'west' };

const COLUMNS = 'abcdefghijkl';

/** A cell's name on the chart: column letter, then row from the north, as in "f1". */
export const cellId = (x: number, y: number) => `${COLUMNS[x]}${y + 1}`;
export const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

/** What stands in a wall face, seen from the cell it belongs to. */
export type Feature =
  | { kind: 'stair-up' }
  | { kind: 'daylight' }
  | { kind: 'candle' }
  | { kind: 'words'; lines: string[] }
  | { kind: 'grille' };

export interface Cell {
  x: number;
  y: number;
  id: string;
  open: Record<Dir, boolean>;
  /** Daylight and candlelight that reach the cell, 0 to 1. */
  light: number;
  /** Paces from the way out, through open passages. */
  fromExit: number;
  faces: Partial<Record<Dir, Feature>>;
  drain: boolean;
}

export interface Plan {
  cells: Cell[];
  at(x: number, y: number): Cell;
  start: Cell;
  exit: { cell: Cell; dir: Dir };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Carved by an earlier visitor. Each entry is one face's lines.
const WORDS: string[][] = [
  ['THE AIR MOVES', 'TOWARD THE LIGHT'],
  ['I HAVE PASSED', 'THIS STONE TWICE'],
  ['NO WAY ON'],
  ['HERE THE MASONS', 'STOPPED FOR BREAD'],
  ['TURNING BACK', 'IS ALSO A WAY'],
  ['MDCCCXII'],
  ['THE LAMP IS LOW', 'THE WALLS ARE NOT'],
  ['ALL PASSAGES', 'ARE THE SAME', 'PASSAGE'],
];

function build(seed: number): Plan {
  const rand = mulberry32(seed);
  const cells: Cell[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      cells.push({
        x,
        y,
        id: cellId(x, y),
        open: { n: false, e: false, s: false, w: false },
        light: 0,
        fromExit: Infinity,
        faces: {},
        drain: false,
      });
    }
  }
  const at = (x: number, y: number) => cells[y * SIZE + x]!;
  const join = (c: Cell, d: Dir) => {
    const [dx, dy] = STEP[d];
    if (!inside(c.x + dx, c.y + dy)) return;
    c.open[d] = true;
    at(c.x + dx, c.y + dy).open[BACK[d]] = true;
  };
  const neighbours = (c: Cell) =>
    DIRS.filter((d) => inside(c.x + STEP[d][0], c.y + STEP[d][1])).map((d) => ({
      d,
      c: at(c.x + STEP[d][0], c.y + STEP[d][1]),
    }));

  // Recursive backtracker: long, winding passages.
  const seen = new Set<Cell>();
  const stack: Cell[] = [at(5, 0)];
  seen.add(stack[0]!);
  while (stack.length) {
    const c = stack[stack.length - 1]!;
    const next = neighbours(c).filter((n) => !seen.has(n.c));
    if (!next.length) {
      stack.pop();
      continue;
    }
    const n = next[Math.floor(rand() * next.length)]!;
    join(c, n.d);
    seen.add(n.c);
    stack.push(n.c);
  }

  // Two halls: open every wall inside each rectangle.
  const hall = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x < x0 + w - 1) join(at(x, y), 'e');
        if (y < y0 + h - 1) join(at(x, y), 's');
      }
    }
  };
  hall(4, 4, 3, 3);
  hall(8, 8, 2, 3);

  // Braid some dead ends into loops, so a wrong turn isn't always a long walk back.
  for (const c of cells) {
    const exits = DIRS.filter((d) => c.open[d]);
    if (exits.length !== 1 || rand() > 0.4) continue;
    if (c.x === 5 && c.y === 0) continue;
    const closed = neighbours(c).filter((n) => !c.open[n.d]);
    const n = closed[Math.floor(rand() * closed.length)];
    if (n) join(c, n.d);
  }

  const start = at(5, 0);
  start.faces.n = { kind: 'stair-up' };

  // The way out: a cell on the south or east edge about 32 paces from the stair
  // by the shortest route, far enough to get lost on the way, near enough to finish.
  const fromStart = distances(at, start);
  let exit = start;
  let exitDir: Dir = 's';
  const miss = (c: Cell) => Math.abs((fromStart.get(c) ?? 0) - 32);
  for (const c of cells) {
    const edge: Dir | null = c.y === SIZE - 1 ? 's' : c.x === SIZE - 1 ? 'e' : null;
    if (!edge) continue;
    if (miss(c) < miss(exit)) {
      exit = c;
      exitDir = edge;
    }
  }
  exit.faces[exitDir] = { kind: 'daylight' };

  const fromExit = distances(at, exit);
  for (const c of cells) c.fromExit = fromExit.get(c) ?? Infinity;

  // Candles in niches, and words, on the walls that close dead ends first.
  const closedFaces: { c: Cell; d: Dir }[] = [];
  for (const c of cells) {
    for (const d of DIRS) if (!c.open[d] && !c.faces[d]) closedFaces.push({ c, d });
  }
  const deadEndFaces = closedFaces.filter(({ c, d }) => {
    const exits = DIRS.filter((k) => c.open[k]);
    return exits.length === 1 && exits[0] === BACK[d];
  });
  const shuffle = <T>(list: T[]) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    return list;
  };
  const spaced: { c: Cell; d: Dir }[] = [];
  const far = (c: Cell, gap: number) => spaced.every((s) => Math.abs(s.c.x - c.x) + Math.abs(s.c.y - c.y) >= gap);
  for (const f of [...shuffle(deadEndFaces), ...shuffle(closedFaces.slice())]) {
    if (f.c === start || f.c === exit) continue;
    if (spaced.length >= WORDS.length + 7) break;
    if (far(f.c, 3)) spaced.push(f);
  }
  // "CLOSER" goes on the spaced face nearest the way out, short of the last few paces.
  const nearest = spaced
    .filter((f) => f.c.fromExit > 2)
    .reduce<{ c: Cell; d: Dir } | null>((best, f) => (!best || f.c.fromExit < best.c.fromExit ? f : best), null);
  const rest = spaced.filter((f) => f !== nearest);
  if (nearest) nearest.c.faces[nearest.d] = { kind: 'words', lines: ['CLOSER'] };
  WORDS.forEach((lines, i) => {
    const f = rest[i];
    if (f) f.c.faces[f.d] = { kind: 'words', lines };
  });
  const candles = rest.slice(WORDS.length, WORDS.length + 5);
  for (const f of candles) f.c.faces[f.d] = { kind: 'candle' };
  // Grilles: barred openings onto bare rock.
  for (const f of rest.slice(WORDS.length + 5)) f.c.faces[f.d] = { kind: 'grille' };

  // Light: daylight from the way out, a little from each candle.
  for (const c of cells) c.light = 0.9 * Math.exp(-c.fromExit / 2.6);
  for (const f of candles) {
    const d = distances(at, f.c);
    for (const c of cells) c.light += 0.22 * Math.exp(-(d.get(c) ?? Infinity) / 1.1);
  }
  for (const c of cells) c.light = Math.min(1, c.light);

  for (const c of cells) c.drain = rand() < 0.08;

  return { cells, at, start, exit: { cell: exit, dir: exitDir } };
}

function distances(at: (x: number, y: number) => Cell, from: Cell) {
  const dist = new Map<Cell, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const c = queue.shift()!;
    for (const d of DIRS) {
      if (!c.open[d]) continue;
      const n = at(c.x + STEP[d][0], c.y + STEP[d][1]);
      if (dist.has(n)) continue;
      dist.set(n, dist.get(c)! + 1);
      queue.push(n);
    }
  }
  return dist;
}

export const plan = build(1725);
