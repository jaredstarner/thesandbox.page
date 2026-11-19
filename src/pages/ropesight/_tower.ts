// The tower in section, shared by the static drawing (built into the page) and the script that moves it.
// Units are SVG user units in a 640 x 960 view: belfry at the top, clock room, then the ringing chamber.

export const VIEW = { w: 640, h: 960 };

export const WALL = { outer: 36, inner: 64, right: 604, rightInner: 576 };

export const LEVELS = {
  parapet: 46,
  belfryTop: 78,
  axis: 192,
  belfryFloor: 350,
  clockFloor: 432,
  chamberTop: 448,
  backFloor: 796,
  frontFloor: 902,
  ground: 960,
};

/** The ringing chamber's rope circle, in perspective: depth z from -1 (back) to 1 (front). */
export const CIRCLE = { cx: 320, rx: 206 };
/** The circle is seen a little off square, so no two ropes line up one behind the other. */
const RING_ROT = Math.PI / 12;

/** Rope k (1 to 6, clockwise from above) on the circle. The 2nd hangs nearest. */
export function circlePos(k: number): { x: number; z: number; s: number } {
  const a = RING_ROT + ((k - 2) * Math.PI) / 3;
  const z = Math.cos(a);
  const s = 0.7 + 0.3 * ((z + 1) / 2);
  return { x: CIRCLE.cx - CIRCLE.rx * Math.sin(a) * (0.84 + 0.16 * s), z, s };
}

export interface BellGeom {
  /** Headstock axis. */
  x: number;
  y: number;
  /** Height of the bell from crown to lip. */
  h: number;
  /** Wheel radius. */
  r: number;
}

/**
 * The frame's pits, left to right, hold the bells in the order their ropes fall in the circle below, so the
 * ropes drop through the clock room without crossing.
 */
const SLOT_OF: number[] = (() => {
  const xs = [1, 2, 3, 4, 5, 6].map((k) => circlePos(k).x);
  const order = [0, 1, 2, 3, 4, 5].sort((a, b) => xs[a] - xs[b]);
  const slot: number[] = [];
  order.forEach((bell, i) => (slot[bell] = i));
  return slot;
})();

export const BELLS: BellGeom[] = Array.from({ length: 6 }, (_, i) => {
  const pit = (WALL.rightInner - WALL.inner) / 6;
  const h = 45 + i * 2.2;
  return { x: WALL.inner + pit * (SLOT_OF[i] + 0.5), y: LEVELS.axis, h, r: 31 + i * 1.1 };
});

/** Where each bell's rope leaves its wheel and drops through the belfry floor. */
export function ropeDrop(i: number): number {
  return BELLS[i].x - BELLS[i].r;
}

/** Crown sits this far below the headstock axis, as a fraction of the bell's height. */
export const CROWN_FRAC = 0.16;

type Pt = [number, number];

/** Half profile of the bell's outside, crown to lip: a start point, then cubic segments, in units of height. */
const OUTER: Pt[] = [
  // English bell proportions: mouth about 1.28 times the height, shoulder half that, a waist that barely
  // swells, then the flare out to a heavy soundbow and a lip that turns down.
  [0.2, 0],
  [0.3, 0],
  [0.34, 0.035],
  [0.34, 0.12],
  [0.34, 0.32],
  [0.35, 0.46],
  [0.39, 0.58],
  [0.43, 0.7],
  [0.53, 0.8],
  [0.585, 0.88],
  [0.625, 0.93],
  [0.64, 0.96],
  [0.64, 1.0],
];

/** Wall thickness at a given depth: thin at the waist, thickest at the soundbow where the clapper strikes. */
function wall(y: number): number {
  return 0.055 + 0.095 * Math.exp(-Math.pow((y - 0.9) / 0.12, 2));
}

/** The profile's points for one side, outside or inside face, in drawing units. */
function profile(h: number, inset: boolean, side: 1 | -1): Pt[] {
  return OUTER.map(([x, y]) => {
    const xx = inset ? Math.max(0, x - wall(y)) : x;
    const yy = inset ? Math.max(y, 0.07) : y;
    return [side * xx * h, (yy + CROWN_FRAC) * h];
  });
}

const p2 = ([x, y]: Pt) => `${x.toFixed(2)} ${y.toFixed(2)}`;

/** Path commands walking the points forwards (M then Cs), or backwards (L to the end, then Cs). */
function walk(pts: Pt[], first: 'M' | 'L'): string {
  let d = `${first} ${p2(pts[0])}`;
  for (let i = 1; i + 2 < pts.length; i += 3) d += ` C ${p2(pts[i])} ${p2(pts[i + 1])} ${p2(pts[i + 2])}`;
  return d;
}

/** The whole bell's silhouette, mouth down, headstock axis at the origin: the dark inside, seen through the cut. */
export function bellPath(h: number): string {
  return `${walk(profile(h, false, 1), 'M')} ${walk(profile(h, false, -1).reverse(), 'L')} Z`;
}

/** One wall of the bell in section (side 1 right, -1 left): outside down to the lip, inside back up. */
export function wallPath(h: number, side: 1 | -1): string {
  return `${walk(profile(h, false, side), 'M')} ${walk(profile(h, true, side).reverse(), 'L')} Z`;
}

/** The crown's top plate, cut through, joining the two walls under the headstock. */
export function crownPath(h: number): string {
  const f = (x: number, y: number) => p2([x * h, (y + CROWN_FRAC) * h]);
  return `M ${f(-0.3, 0)} L ${f(0.3, 0)} L ${f(0.29, 0.075)} L ${f(-0.29, 0.075)} Z`;
}

export function floorAt(z: number): number {
  return LEVELS.backFloor + ((LEVELS.frontFloor - LEVELS.backFloor) * (z + 1)) / 2;
}

/** How far the ceiling's underside recedes before it meets the back wall. */
export const CEILING_DEPTH = 36;

export function ceilingAt(z: number): number {
  return LEVELS.chamberTop + CEILING_DEPTH * (1 - (z + 1) / 2);
}

/** Pixels per metre of height at depth z; the chamber is four metres floor to ceiling. */
export function pxPerMetre(z: number): number {
  return (floorAt(z) - ceilingAt(z)) / 4;
}

/** Heights, in metres above the floor, of a rope's parts with the bell at handstroke. */
export const ROPE = { sallyLow: 1.18, sallyHigh: 2.02, tailEnd: 0.42, travel: 1.32 };
