// The five properties, as surfaces. A floor is a polygon in the flat plane, on the sphere, or on the hyperbolic
// plane, with its sides paired by isometries; a room stands on it with vertical walls, so gravity means the same
// thing everywhere and only the plan is curved.
//
// All three geometries share one model. A point is a homogeneous 3-vector: (x, y, 1) in the plane, a unit vector on
// the sphere, a point of the hyperboloid w^2 - x^2 - y^2 = 1. A geodesic is a plane through the origin, so a line is
// a covector, a line through two points is their cross product, and a side pairing is a 3 x 3 matrix. The same code
// runs for all of them; only the sines change.

export type Kappa = 0 | 1 | -1;
export type V3 = [number, number, number];
/** A 3 x 3 matrix, row by row. */
export type M3 = [number, number, number, number, number, number, number, number, number];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export const Ck = (k: Kappa, s: number) => (k === 0 ? 1 : k > 0 ? Math.cos(s) : Math.cosh(s));
export const Sk = (k: Kappa, s: number) => (k === 0 ? s : k > 0 ? Math.sin(s) : Math.sinh(s));
export const SkInv = (k: Kappa, x: number) => (k === 0 ? x : k > 0 ? Math.asin(clamp(x, -1, 1)) : Math.asinh(x));

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, t: number): V3 => [a[0] * t, a[1] * t, a[2] * t];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The inner product on tangent vectors and, for k != 0, on points. */
export const mdot = (k: Kappa, a: V3, b: V3) =>
  a[0] * b[0] + a[1] * b[1] + (k === 0 ? 0 : k > 0 ? a[2] * b[2] : -a[2] * b[2]);

/** Distance between two points of the surface. */
export function gdist(k: Kappa, a: V3, b: V3): number {
  if (k === 0) return Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (k > 0) return Math.acos(clamp(dot(a, b), -1, 1));
  return Math.acosh(Math.max(1, -mdot(k, a, b)));
}

/** Scales a covector so that n . p is the S of the distance from p to the line. */
export function unitLine(k: Kappa, n: V3): V3 {
  const q = k === 0 ? n[0] * n[0] + n[1] * n[1] : mdot(k, n, n);
  return scale(n, 1 / Math.sqrt(Math.max(q, 1e-12)));
}

/** The vector a covector raises to: its normal, once projected onto the tangent plane at p. */
export function normalAt(k: Kappa, n: V3, p: V3): V3 {
  const raised: V3 = k < 0 ? [n[0], n[1], -n[2]] : k === 0 ? [n[0], n[1], 0] : [n[0], n[1], n[2]];
  if (k === 0) return raised;
  const pp = mdot(k, p, p);
  return add(raised, scale(p, -mdot(k, raised, p) / pp));
}

export const walk = (k: Kappa, p: V3, d: V3, s: number): V3 => add(scale(p, Ck(k, s)), scale(d, Sk(k, s)));

/** The unit tangent at the end of walk(p, d, s). */
export function walkDir(k: Kappa, p: V3, d: V3, s: number): V3 {
  if (k === 0) return d;
  return add(scale(p, k > 0 ? -Math.sin(s) : Math.sinh(s)), scale(d, Ck(k, s)));
}

export const mul = (a: M3, b: M3): M3 => {
  const r = new Array(9).fill(0) as M3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let l = 0; l < 3; l++) r[3 * i + j] += a[3 * i + l] * b[3 * l + j];
    }
  }
  return r;
};

export const apply = (m: M3, v: V3): V3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

export function invert(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    C / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
}

export const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const rotate = (t: number): M3 => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

/** Slides along the x axis by t. */
const slide = (k: Kappa, t: number): M3 => {
  if (k === 0) return [1, 0, t, 0, 1, 0, 0, 0, 1];
  if (k > 0) return [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];
  return [Math.cosh(t), 0, Math.sinh(t), 0, 1, 0, Math.sinh(t), 0, Math.cosh(t)];
};

const MIRROR: M3 = [1, 0, 0, 0, -1, 0, 0, 0, 1];
const ANTIPODE: M3 = [-1, 0, 0, 0, -1, 0, 0, 0, -1];

/** The point at distance r from the middle of the room, in direction theta. */
export const polar = (k: Kappa, r: number, theta: number): V3 => {
  const s = Sk(k, r);
  return [s * Math.cos(theta), s * Math.sin(theta), Ck(k, r)];
};

/** The line at distance r from the middle of the room, square to direction theta; the room is on its positive side. */
const lineAt = (k: Kappa, r: number, theta: number): V3 =>
  unitLine(k, [-Ck(k, r) * Math.cos(theta), -Ck(k, r) * Math.sin(theta), Sk(k, r)]);

/** Whether a door pair sends you back as you left, or changes something on the way. */
type Pairing = 'straight' | 'mirror' | 'ceiling' | 'antipode';

export interface Palette {
  wall: string;
  wall2: string;
  dado: string;
  trim: string;
  floorA: string;
  floorB: string;
  ceiling: string;
  rugA: string;
  rugB: string;
  fabric: string;
  /** One colour per door pair. */
  doors: string[];
}

export type PropKind = 'lamp' | 'chair' | 'table';

export interface Prop {
  kind: PropKind;
  /** Direction and distance from the middle of the room, in metres. */
  theta: number;
  r: number;
  /** Which way it faces, measured like theta. */
  yaw: number;
  /** Stands on the ceiling, for the room where that is a floor. */
  above?: boolean;
}

export interface Decal {
  /** Which wall, and how far along it from the door, in metres. */
  wall: number;
  a: number;
  /** Centre height and size, in metres. */
  z: number;
  w: number;
  h: number;
  /** Name of an atlas cell. */
  cell: 'sampler' | 'landscape' | 'clock' | 'chart';
}

export interface Particulars {
  /** The name on the sheet. */
  name: string;
  /** The opening paragraph. */
  blurb: string;
  /** Rows of the facts table. */
  facts: [string, string][];
  /** A line under the plan. */
  plan: string;
  /** What to try, shown once in the viewing. */
  hint: string;
}

export interface RoomSpec {
  id: string;
  kappa: Kappa;
  /** Metres to one unit of curvature; 1 in the flat rooms. */
  unit: number;
  sides: number;
  /** Outer polygon's inradius, in metres; the hemisphere's rim in the round room. */
  apothem: number;
  /** Rotates the whole plan, so that door 0 need not face east. */
  turn: number;
  pairing: Pairing[];
  height: number;
  doorWidth: number;
  doorHeight: number;
  wallpaper: number;
  floor: number;
  palette: Palette;
  props: Prop[];
  decals: Decal[];
  lamp: [number, number, number];
  sheet: Particulars;
}

export interface Room {
  spec: RoomSpec;
  kappa: Kappa;
  n: number;
  /** Metres to a unit. */
  unit: number;
  outer: V3[];
  wall: V3[];
  jambA: V3[];
  jambB: V3[];
  /** Directions along each wall, in the plane of the first two coordinates. */
  along: [number, number][];
  /** How far each wall runs either side of its door, from the middle to a corner. */
  halfWall: number[];
  corners: V3[];
  g: M3[];
  pair: number[];
  flip: boolean[];
  mirrors: boolean[];
  height: number;
  doorW: number;
  doorH: number;
  thickness: number;
  /** Largest x or y of the floor in chart coordinates, so that floor marks can use one texture. */
  extent: number;
  /** Direction of each wall from the middle of the room. */
  theta: number[];
  apothem: number;
}

const WALL = 0.24;

export function buildRoom(spec: RoomSpec): Room {
  const k = spec.kappa;
  const n = spec.sides;
  const u = spec.unit;
  const rOuter = spec.apothem / u;
  const t = WALL / u;
  const rInner = rOuter - t;
  const doorW = spec.doorWidth / 2 / u;

  const theta: number[] = [];
  const outer: V3[] = [];
  const wall: V3[] = [];
  const jambA: V3[] = [];
  const jambB: V3[] = [];
  const along: [number, number][] = [];
  const g: M3[] = [];
  const pair: number[] = [];
  const flip: boolean[] = [];
  const mirrors: boolean[] = [];

  for (let i = 0; i < n; i++) {
    const th = spec.turn + (i * 2 * Math.PI) / n;
    theta.push(th);
    outer.push(lineAt(k, rOuter, th));
    wall.push(lineAt(k, rInner, th));
    // Along the wall, left to right as seen from inside the room.
    const tan: V3 = [Math.sin(th), -Math.cos(th), 0];
    along.push([tan[0], tan[1]]);

    const footIn = polar(k, rInner, th);
    const footOut = polar(k, rOuter, th);
    const on = (foot: V3, a: number) => walk(k, foot, tan, a);
    // Each jamb runs straight through the wall; the door's own side is the positive one.
    const a0 = cross(on(footOut, doorW), on(footIn, doorW));
    const b0 = cross(on(footIn, -doorW), on(footOut, -doorW));
    const mid = polar(k, (rInner + rOuter) / 2, th);
    const orient = (line: V3): V3 => {
      const unit = unitLine(k, line);
      return dot(unit, mid) < 0 ? scale(unit, -1) : unit;
    };
    jambA.push(orient(a0));
    jambB.push(orient(b0));

    const op = (i + n / 2) % n;
    pair.push(op);
    const kind = spec.pairing[i % spec.pairing.length]!;
    flip.push(kind === 'ceiling');
    mirrors.push(kind === 'mirror' || kind === 'ceiling' || kind === 'antipode');
    const axis = (m: M3) => mul(rotate(th), mul(m, rotate(-th)));
    if (kind === 'antipode') {
      g.push(ANTIPODE);
    } else if (kind === 'mirror' || kind === 'ceiling') {
      g.push(axis(mul(slide(k, -2 * rOuter), MIRROR)));
    } else {
      g.push(axis(slide(k, -2 * rOuter)));
    }
  }

  const corners: V3[] = [];
  for (let i = 0; i < n; i++) {
    const c = cross(wall[i]!, wall[(i + 1) % n]!);
    const w = k === 0 ? c[2] : Math.sqrt(Math.abs(mdot(k, c, c))) * Math.sign(c[2] || 1);
    corners.push(scale(c, 1 / w));
  }

  const halfWall = corners.map((c, i) => Math.abs(SkInv(k, c[0] * along[i]![0] + c[1] * along[i]![1])));

  const extent = k > 0 ? 1 : Math.max(...corners.flatMap((c) => [Math.abs(c[0] / c[2]), Math.abs(c[1] / c[2])])) * 1.12;

  return {
    spec,
    kappa: k,
    n,
    unit: u,
    outer,
    wall,
    jambA,
    jambB,
    along,
    halfWall,
    corners,
    g,
    pair,
    flip,
    mirrors,
    height: spec.height / u,
    doorW,
    doorH: spec.doorHeight / u,
    thickness: t,
    extent,
    theta,
    apothem: rOuter,
  };
}

/** Floor-texture coordinates of a point, in 0..1. */
export function floorUV(room: Room, p: V3): [number, number] {
  const x = room.kappa > 0 ? p[0] : p[0] / p[2];
  const y = room.kappa > 0 ? p[1] : p[1] / p[2];
  return [0.5 + (0.5 * x) / room.extent, 0.5 + (0.5 * y) / room.extent];
}

const HALF = Math.PI / 2;
const INK = {
  oxblood: '#8c3a2b',
  prussian: '#2d4c70',
  olive: '#6d7a35',
  ochre: '#c58a26',
};

export const ROOMS: RoomSpec[] = [
  {
    id: 'through-lounge',
    kappa: 0,
    unit: 1,
    sides: 4,
    apothem: 3.12,
    turn: 0,
    pairing: ['straight'],
    height: 2.75,
    doorWidth: 1.1,
    doorHeight: 2.12,
    wallpaper: 0,
    floor: 0,
    palette: {
      wall: '#c9d6c6',
      wall2: '#b4c6b4',
      dado: '#e9e2cf',
      trim: '#f4eedf',
      floorA: '#c79a5c',
      floorB: '#b5874a',
      ceiling: '#f3eddd',
      rugA: '#a64b35',
      rugB: '#e6d3ae',
      fabric: '#b9743a',
      doors: [INK.oxblood, INK.prussian],
    },
    props: [
      { kind: 'lamp', theta: 2.3, r: 2.35, yaw: 0 },
      { kind: 'chair', theta: 3.75, r: 2.25, yaw: 0.65 },
      { kind: 'table', theta: 5.55, r: 2.2, yaw: 0 },
    ],
    decals: [
      { wall: 2, a: 1.75, z: 1.72, w: 0.74, h: 0.56, cell: 'landscape' },
      { wall: 3, a: -1.8, z: 1.72, w: 0.5, h: 0.5, cell: 'clock' },
    ],
    lamp: [2.3, 2.35, 1.5],
    sheet: {
      name: 'The Through Lounge',
      blurb:
        'A well-proportioned reception room with a door in each wall. The north door opens into the south door of the same room, and the east door into the west, so the room can be left in any direction and never is.',
      facts: [
        ['Accommodation', 'One room'],
        ['Doors', 'Four, in two pairs'],
        ['Corners', 'Four, which are one corner'],
        ['Floor', 'Flat. 36 m²'],
        ['Surface', 'Torus'],
      ],
      plan: 'Red opens into red and blue into blue. Every square is this room.',
      hint: 'Walk through the door and look back.',
    },
  },
  {
    id: 'reversing-room',
    kappa: 0,
    unit: 1,
    sides: 4,
    apothem: 3.12,
    turn: 0,
    pairing: ['mirror', 'straight'],
    height: 2.75,
    doorWidth: 1.1,
    doorHeight: 2.12,
    wallpaper: 1,
    floor: 1,
    palette: {
      wall: '#e6d59a',
      wall2: '#cdb36a',
      dado: '#efe6c8',
      trim: '#f7f1e2',
      floorA: '#e9e2d0',
      floorB: '#3b3a38',
      ceiling: '#f4eedd',
      rugA: '#3f6b63',
      rugB: '#e4d9bb',
      fabric: '#3f6b63',
      doors: [INK.olive, INK.oxblood],
    },
    props: [
      { kind: 'lamp', theta: 0.8, r: 2.4, yaw: 0 },
      { kind: 'table', theta: 2.35, r: 2.2, yaw: 0 },
      { kind: 'chair', theta: 5.5, r: 2.25, yaw: 2.3 },
    ],
    decals: [
      { wall: 1, a: 1.7, z: 1.68, w: 0.92, h: 0.64, cell: 'sampler' },
      { wall: 3, a: 1.7, z: 1.72, w: 0.5, h: 0.5, cell: 'clock' },
      { wall: 2, a: 1.75, z: 1.72, w: 0.74, h: 0.56, cell: 'chart' },
    ],
    lamp: [0.8, 2.4, 1.5],
    sheet: {
      name: 'The Reversing Room',
      blurb:
        'North and south behave as usual. The east and west doors return you to the room with left and right exchanged, so that the clock runs backwards, the sampler reads from right to left, and these particulars are in your other hand. A second trip puts everything back.',
      facts: [
        ['Accommodation', 'One room'],
        ['Doors', 'Four, in two pairs'],
        ['Corners', 'Four, which are one corner'],
        ['Floor', 'Flat. 36 m²'],
        ['Surface', 'Klein bottle'],
      ],
      plan: 'Crossing a green door turns the plan over. The R shows which way up it is.',
      hint: 'Read the sampler, then go out by the green door.',
    },
  },
  {
    id: 'maisonette',
    kappa: 0,
    unit: 1,
    sides: 4,
    apothem: 3.12,
    turn: 0,
    pairing: ['straight', 'ceiling'],
    height: 3.1,
    doorWidth: 1.2,
    doorHeight: 3.1,
    wallpaper: 2,
    floor: 2,
    palette: {
      wall: '#e3c3b4',
      wall2: '#cfa292',
      dado: '#ecdccb',
      trim: '#f6efe2',
      floorA: '#7f97a6',
      floorB: '#6c8496',
      ceiling: '#8d9a62',
      rugA: '#d9a441',
      rugB: '#f0e3c0',
      fabric: '#7a3f46',
      doors: [INK.prussian, INK.oxblood],
    },
    props: [
      { kind: 'lamp', theta: 0.75, r: 2.4, yaw: 0 },
      { kind: 'chair', theta: 3.9, r: 2.25, yaw: 0.8 },
      { kind: 'table', theta: 2.4, r: 2.2, yaw: 0, above: true },
      { kind: 'chair', theta: 5.6, r: 2.2, yaw: 2.4, above: true },
      { kind: 'lamp', theta: 3.9, r: 2.4, yaw: 0, above: true },
    ],
    decals: [],
    lamp: [0.75, 2.4, 1.55],
    sheet: {
      name: 'The Maisonette',
      blurb:
        'Two floors for the price of one. The north and south openings run from floor to ceiling and come back in upside down, which makes the ceiling the upper floor. It is carpeted and furnished as such. Going through puts you on it.',
      facts: [
        ['Accommodation', 'One room, on two levels'],
        ['Doors', 'Four, in two pairs'],
        ['Corners', 'Four, which are one corner'],
        ['Floors', 'Flat. 36 m² each, one above the other'],
        ['Surface', 'Torus, folded in two'],
      ],
      plan: 'Red openings lead to the other floor. Shaded squares are the room upside down.',
      hint: 'Look through the red opening at whoever is standing up there.',
    },
  },
  {
    id: 'rotunda',
    kappa: 1,
    unit: 2.5,
    sides: 6,
    apothem: HALF * 2.5,
    turn: Math.PI / 2,
    pairing: ['antipode'],
    height: 3.0,
    doorWidth: 1.1,
    doorHeight: 2.2,
    wallpaper: 3,
    floor: 3,
    palette: {
      wall: '#bdc7c9',
      wall2: '#9fb0b6',
      dado: '#dfdcce',
      trim: '#f1ecdf',
      floorA: '#c4935f',
      floorB: '#a97a48',
      ceiling: '#eae6d8',
      rugA: '#39586b',
      rugB: '#dcc99c',
      fabric: '#8c3a2b',
      doors: [INK.ochre, INK.oxblood, INK.prussian],
    },
    props: [
      { kind: 'lamp', theta: 2.75, r: 2.2, yaw: 0 },
      { kind: 'chair', theta: 0.9, r: 2.3, yaw: 3.9 },
      { kind: 'table', theta: 4, r: 2.35, yaw: 0 },
    ],
    decals: [
      { wall: 2, a: 1.8, z: 1.72, w: 0.74, h: 0.56, cell: 'landscape' },
      { wall: 4, a: 1.8, z: 1.7, w: 0.5, h: 0.5, cell: 'clock' },
    ],
    lamp: [2.75, 2.2, 1.5],
    sheet: {
      name: 'The Rotunda',
      blurb:
        'A circular room on a positively curved floor, ideal for entertaining. It gives 36 m² where a flat circle of the same width would give 43. Lines of sight spread apart and then close up again, so the far side of the room grows as you walk away from it. Each door opens into the one opposite, and you come back reversed.',
      facts: [
        ['Accommodation', 'One room'],
        ['Doors', 'Six, in three pairs'],
        ['Corners', 'None to speak of'],
        ['Floor', 'Positively curved. 36 m²'],
        ['Surface', 'Real projective plane'],
      ],
      plan: 'The plan is half a globe; the rim is joined to itself straight across.',
      hint: 'Walk up to a door, then turn round and look at the room.',
    },
  },
  {
    id: 'octagon',
    kappa: -1,
    unit: 2.55,
    sides: 8,
    // Inradius of a regular hyperbolic octagon with corners of 45 degrees: cosh r = cot(pi / 8).
    apothem: Math.acosh(1 / Math.tan(Math.PI / 8)) * 2.55,
    turn: 0,
    pairing: ['straight'],
    height: 2.75,
    doorWidth: 1.1,
    doorHeight: 2.12,
    wallpaper: 4,
    floor: 4,
    palette: {
      wall: '#5f8780',
      wall2: '#4c7069',
      dado: '#d9d2bb',
      trim: '#efe9d9',
      floorA: '#c99f62',
      floorB: '#b0844a',
      ceiling: '#ece6d5',
      rugA: '#b5542f',
      rugB: '#e9d6ae',
      fabric: '#caa248',
      doors: [INK.oxblood, INK.ochre, INK.prussian, INK.olive],
    },
    props: [
      { kind: 'lamp', theta: (3 * Math.PI) / 8, r: 3.0, yaw: 0 },
      { kind: 'chair', theta: Math.PI / 8, r: 3.9, yaw: Math.PI + Math.PI / 8 },
      { kind: 'table', theta: Math.PI / 8 + Math.PI, r: 3.9, yaw: 0 },
    ],
    decals: [
      { wall: 1, a: 2.1, z: 1.72, w: 0.74, h: 0.56, cell: 'landscape' },
      { wall: 3, a: 2.1, z: 1.72, w: 0.5, h: 0.5, cell: 'clock' },
    ],
    lamp: [(3 * Math.PI) / 8, 3.0, 1.5],
    sheet: {
      name: 'The Octagon',
      blurb:
        'A substantial eight-sided room on a negatively curved floor, giving 65 m² where a flat octagon of the same width would give 44. Each door opens into the one opposite. Measured to the centre of the walls, the corners are 45 degrees and all eight are the same corner, so eight rooms meet there, and all eight are this one.',
      facts: [
        ['Accommodation', 'One room'],
        ['Doors', 'Eight, in four pairs'],
        ['Corners', 'Eight, which are one corner'],
        ['Floor', 'Negatively curved. 65 m²'],
        ['Surface', 'Two-holed torus'],
      ],
      plan: 'Each tile is this room, the same size as the others. The drawing has to shrink them to fit them in.',
      hint: 'Walk a square: four equal sides and four right turns. You will not end up where you began.',
    },
  },
];
