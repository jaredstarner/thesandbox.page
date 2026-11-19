// The tower in section, shared by the static drawing (built into the page) and the script that moves it.
// Units are SVG user units in a 640 x 960 view: belfry at the top, clock room, then the ringing chamber.

export const VIEW = { w: 640, h: 960 };

export const WALL = { outer: 36, inner: 64, right: 604, rightInner: 576 };

export const LEVELS = {
  parapet: 46,
  belfryTop: 78,
  axis: 188,
  belfryFloor: 352,
  clockFloor: 504,
  chamberTop: 520,
  backFloor: 812,
  frontFloor: 902,
  ground: 960,
};

export interface BellGeom {
  /** Headstock axis. */
  x: number;
  y: number;
  /** Height of the bell from crown to lip. */
  h: number;
  /** Wheel radius. */
  r: number;
}

export const BELLS: BellGeom[] = Array.from({ length: 6 }, (_, i) => {
  const pit = (WALL.rightInner - WALL.inner) / 6;
  const h = 44 + i * 3.6;
  return { x: WALL.inner + pit * (i + 0.5), y: LEVELS.axis, h, r: 30 + i * 1.4 };
});

/** Where each bell's rope leaves its wheel and drops through the belfry floor. */
export function ropeDrop(i: number): number {
  return BELLS[i].x - BELLS[i].r;
}

/** Crown sits this far below the headstock axis, as a fraction of the bell's height. */
export const CROWN_FRAC = 0.16;

/**
 * The bell's outline, mouth down, with the headstock axis at the origin, in units of its height.
 * Built from a half profile mirrored about the centre line.
 */
export function bellPath(h: number): string {
  const c = CROWN_FRAC;
  // Right half, crown to lip: shoulder, waist, soundbow flaring to the lip.
  const half: [number, number][][] = [
    [
      [0.17, c],
      [0.28, c + 0.01],
      [0.3, c + 0.12],
    ],
    [
      [0.31, c + 0.36],
      [0.33, c + 0.56],
      [0.41, c + 0.74],
    ],
    [
      [0.46, c + 0.85],
      [0.52, c + 0.9],
      [0.53, c + 1.0],
    ],
  ];
  const f = (x: number, y: number) => `${(x * h).toFixed(2)} ${(y * h).toFixed(2)}`;
  let d = `M ${f(0, c)}`;
  for (const [a, b, e] of half) d += ` C ${f(a[0], a[1])} ${f(b[0], b[1])} ${f(e[0], e[1])}`;
  // Across the mouth: the lip's thickness, a shallow curve, and back out to the other lip.
  d += ` L ${f(0.44, c + 1.0)} Q ${f(0, c + 0.94)} ${f(-0.44, c + 1.0)} L ${f(-0.53, c + 1.0)}`;
  // The left half, walked back up from lip to crown: the same curves mirrored, control points reversed.
  const back = [
    [
      [-0.52, c + 0.9],
      [-0.46, c + 0.85],
      [-0.41, c + 0.74],
    ],
    [
      [-0.33, c + 0.56],
      [-0.31, c + 0.36],
      [-0.3, c + 0.12],
    ],
    [
      [-0.28, c + 0.01],
      [-0.17, c],
      [0, c],
    ],
  ];
  for (const [a, b, e] of back) d += ` C ${f(a[0], a[1])} ${f(b[0], b[1])} ${f(e[0], e[1])}`;
  return d + ' Z';
}

/** The soundbow's thick band, drawn as a darker stripe just above the lip. */
export function bowPath(h: number): string {
  const c = CROWN_FRAC;
  const f = (x: number, y: number) => `${(x * h).toFixed(2)} ${(y * h).toFixed(2)}`;
  return `M ${f(-0.47, c + 0.86)} Q ${f(0, c + 0.8)} ${f(0.47, c + 0.86)} L ${f(0.53, c + 1.0)} L ${f(0.44, c + 1.0)} Q ${f(0, c + 0.94)} ${f(-0.44, c + 1.0)} L ${f(-0.53, c + 1.0)} Z`;
}

/** The ringing chamber's rope circle, in perspective: depth z from -1 (back) to 1 (front). */
export const CIRCLE = { cx: 320, rx: 196 };

export function floorAt(z: number): number {
  return LEVELS.backFloor + ((LEVELS.frontFloor - LEVELS.backFloor) * (z + 1)) / 2;
}

export function ceilingAt(z: number): number {
  return LEVELS.chamberTop + 34 * (1 - (z + 1) / 2);
}

/** Pixels per metre of height at depth z; the chamber is four metres floor to ceiling. */
export function pxPerMetre(z: number): number {
  return (floorAt(z) - ceilingAt(z)) / 4;
}

/** Rope k's place on the circle when the visitor's rope is front and centre. */
export function circlePos(k: number, mine: number): { x: number; z: number; s: number } {
  const a = ((k - mine) * Math.PI) / 3;
  const z = Math.cos(a);
  const s = 0.72 + 0.28 * ((z + 1) / 2);
  return { x: CIRCLE.cx - CIRCLE.rx * Math.sin(a) * (0.86 + 0.14 * s), z, s };
}

/** Heights, in metres above the floor, of a rope's parts with the bell at handstroke. */
export const ROPE = { sallyLow: 1.18, sallyHigh: 2.02, tailEnd: 0.42, travel: 1.32 };
