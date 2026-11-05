// The table's layout, in millimetres on a standard 20.25 x 42 inch playfield (514 x 1067 mm).
// Origin is the top-left corner of the wood; +y runs down toward the player. The main field spans
// x 10-462; the shooter lane runs up the right edge, x 470-510.

import { BALL_R, disc, makeFlipper, seg, type Disc, type Flipper, type Seg, type Shape } from './_physics';

export const W = 514;
export const H = 1067;

/** Rubber rings and posts, metal rails and guides, and the playfield's wooden lane guides. */
const RUBBER = 0.72;
const POST = 0.62;
const METAL = 0.4;

export const ARCH = { cx: 260, cy: 255, r: 254 };
export const LEFT_WALL_X = 6;
export const RIGHT_WALL_X = 514;
export const DIVIDER_X = 466;
export const DIVIDER_TOP = 240;
export const APRON_Y = 1012;
/** The plunger's tip at rest, and how far it draws back. */
export const PLUNGER_REST = 1014;
export const PLUNGER_TRAVEL = 44;
export const SHOOTER_X = 490;

export const LANES = [190, 240, 290];
export const LANE_GUIDES = [165, 215, 265, 315];
export const LANE_TOP = 110;
export const LANE_BOTTOM = 172;
export const LANE_SENSOR_Y = 140;

export const BUMPERS = [
  { id: 'bumper0', x: 180, y: 278 },
  { id: 'bumper1', x: 292, y: 278 },
  { id: 'bumper2', x: 236, y: 356 },
];
export const BUMPER_R = 31;
export const BUMPER_KICK = 1650;

export const DUCK_Y = 500;
export const DUCK_X = [168, 202, 236, 270, 304];
export const DUCK_HALF = 12;
export const GALLERY = { left: 150, right: 322, back: 486 };

export const SAUCER = { x: 100, y: 410 };

export const ORBIT_X = 54;
export const ORBIT_BOTTOM = 620;
export const ORBIT_TOP = 300;
export const SPINNER_Y = 560;

/**
 * The strength test: a lane angled 24 degrees off vertical so that it points straight back at the left
 * flipper, where a late shot comes from. Positions in the lane are given as (t, s): t mm up its centre line
 * from the mouth, s mm across it (positive to the right). The mouth flares so a shot need not be exact.
 */
export const STRIKER = {
  mx: 340,
  my: 625,
  ux: 0.4032,
  uy: -0.9151,
  nx: 0.9151,
  ny: 0.4032,
  len: 228,
  half: 28,
  flare: 22,
  /** Where the speed trap sits, t mm up the lane. */
  trap: 28,
  /** The right wall turns up the divider to here, and the bell cap slopes down from it to the left wall. */
  capRight: { x: 458, y: 395 },
};

export function lanePoint(t: number, s = 0): { x: number; y: number } {
  return {
    x: STRIKER.mx + STRIKER.ux * t + STRIKER.nx * s,
    y: STRIKER.my + STRIKER.uy * t + STRIKER.ny * s,
  };
}

/** The strength test's ten lamps, bottom to top. */
export const LADDER = Array.from({ length: 10 }, (_, i) => lanePoint(45 + i * 17));

export const SEPARATOR_TOP = 690;
export const INLANE_GUIDE = { ax: 49, ay: 846, bx: 153, by: 940 };

export const SLING_L = { a: { x: 94, y: 724 }, b: { x: 94, y: 834 }, c: { x: 146, y: 872 } };
export const SLING_R = { a: { x: 378, y: 724 }, b: { x: 378, y: 834 }, c: { x: 326, y: 872 } };
export const SLING_KICK = 1700;

export const FLIPPER_L = { x: 165, y: 950 };
export const FLIPPER_R = { x: 307, y: 950 };
const DEG = Math.PI / 180;

export const ROLLOVERS = {
  lane0: { x: LANES[0], y: LANE_SENSOR_Y },
  lane1: { x: LANES[1], y: LANE_SENSOR_Y },
  lane2: { x: LANES[2], y: LANE_SENSOR_Y },
  inlaneL: { x: 70, y: 782 },
  inlaneR: { x: 402, y: 782 },
  outlaneL: { x: 28, y: 800 },
  outlaneR: { x: 444, y: 800 },
} as const;
export type RolloverId = keyof typeof ROLLOVERS;

/** Lamp positions for the inserts, by name. */
export const LAMPS = {
  lane0: { x: LANES[0], y: 162 },
  lane1: { x: LANES[1], y: 162 },
  lane2: { x: LANES[2], y: 162 },
  spinner: { x: 32, y: 610 },
  saucer: { x: 100, y: 452 },
  inlaneL: { x: 70, y: 740 },
  inlaneR: { x: 402, y: 740 },
  specialL: { x: 28, y: 862 },
  specialR: { x: 444, y: 862 },
  again: { x: 236, y: 884 },
} as const;
export type LampId = keyof typeof LAMPS;

/** The ten ticket inserts, in two rows above the flippers. */
export const TICKETS = Array.from({ length: 10 }, (_, i) => ({
  x: 180 + (i % 5) * 28,
  y: i < 5 ? 772 : 812,
}));

export interface Table {
  shapes: Shape[];
  flippers: Flipper[];
  ducks: Seg[];
  bumpers: Disc[];
  plunger: Seg;
  slings: Seg[];
}

function arch(): Seg[] {
  const out: Seg[] = [];
  const n = 40;
  let px = ARCH.cx + ARCH.r;
  let py = ARCH.cy;
  for (let i = 1; i <= n; i++) {
    const a = -(i / n) * Math.PI;
    const x = ARCH.cx + Math.cos(a) * ARCH.r;
    const y = ARCH.cy + Math.sin(a) * ARCH.r;
    out.push(seg(`arch${i}`, px, py, x, y, 4, METAL, 0.01));
    px = x;
    py = y;
  }
  return out;
}

function sling(side: 'L' | 'R', s: typeof SLING_L): Seg[] {
  const face = seg(`sling${side}`, s.a.x, s.a.y, s.c.x, s.c.y, 5, RUBBER, 0.05);
  face.kick = SLING_KICK;
  face.kickMin = 260;
  return [
    face,
    seg(`slingback${side}`, s.a.x, s.a.y, s.b.x, s.b.y, 4, POST),
    seg(`slingbase${side}`, s.b.x, s.b.y, s.c.x, s.c.y, 4, POST),
  ];
}

function mirror<T extends { x: number }>(p: T): T {
  return { ...p, x: 472 - p.x };
}

export function buildTable(): Table {
  const shapes: Shape[] = [];
  const add = (...s: Shape[]) => shapes.push(...s);

  // The cabinet: left wall, top arch, right wall, and the shooter lane's divider.
  add(seg('wallL', LEFT_WALL_X, ARCH.cy, LEFT_WALL_X, 1030, 4, METAL, 0.01));
  add(...arch());
  add(seg('wallR', RIGHT_WALL_X, ARCH.cy, RIGHT_WALL_X, 1030, 4, METAL, 0.01));
  add(seg('divider', DIVIDER_X, DIVIDER_TOP, DIVIDER_X, 1030, 4, METAL, 0.01));

  // One-way gates: out of the shooter lane, and up into the left loop.
  const gate = seg('gateShooter', 468, 234, 511, 210, 2, 0.3);
  gate.oneWay = { x: -0.488, y: -0.873 };
  const orbitGate = seg('gateOrbit', LEFT_WALL_X, 284, ORBIT_X, ORBIT_TOP, 2, 0.3);
  orbitGate.oneWay = { x: 0.316, y: -0.949 };
  add(gate, orbitGate);

  // The left loop's inner wall.
  add(seg('orbitWall', ORBIT_X, ORBIT_BOTTOM, ORBIT_X, ORBIT_TOP, 4, METAL, 0.01));

  // Top lane guides.
  for (const [i, x] of LANE_GUIDES.entries()) add(seg(`guide${i}`, x, LANE_TOP, x, LANE_BOTTOM, 4, POST));

  // Pop bumpers.
  const bumpers = BUMPERS.map((b) => {
    const d = disc(b.id, b.x, b.y, BUMPER_R, 0.5);
    d.kick = BUMPER_KICK;
    d.kickMin = 90;
    return d;
  });
  add(...bumpers);

  // The duck gallery: five drop targets in front of a back rail, with a rubber post at each end.
  const ducks = DUCK_X.map((x, i) => seg(`duck${i}`, x - DUCK_HALF, DUCK_Y, x + DUCK_HALF, DUCK_Y, 3, 0.35));
  add(...ducks);
  add(seg('galleryBack', GALLERY.left, GALLERY.back, GALLERY.right, GALLERY.back, 5, METAL));
  add(disc('galleryPostL', GALLERY.left, DUCK_Y - 2, 6, POST), disc('galleryPostR', GALLERY.right, DUCK_Y - 2, 6, POST));

  // The strength test: two walls and the bell cap at its head. The right wall runs on up to the divider and
  // the cap slopes down to the left, so a ball dropping onto it from the shooter gate rolls off into play.
  for (const [side, s] of [
    ['L', -1],
    ['R', 1],
  ] as const) {
    const mouth = lanePoint(-STRIKER.flare, s * (STRIKER.half + 18));
    const foot = lanePoint(0, s * STRIKER.half);
    const head = lanePoint(STRIKER.len, s * STRIKER.half);
    add(seg(`strikerFlare${side}`, mouth.x, mouth.y, foot.x, foot.y, 4, METAL, 0.01));
    add(seg(`strikerWall${side}`, foot.x, foot.y, head.x, head.y, 4, METAL, 0.01));
  }
  const headL = lanePoint(STRIKER.len, -STRIKER.half);
  const headR = lanePoint(STRIKER.len, STRIKER.half);
  const cap = STRIKER.capRight;
  add(seg('strikerTop', headR.x, headR.y, cap.x, cap.y, 4, METAL, 0.01));
  add(seg('bell', cap.x, cap.y, headL.x, headL.y, 5, 0.45));

  // Lane separators, with a rubber post on top, and the inlane guides down to the flippers.
  const sepL = { x: 49, y: SEPARATOR_TOP };
  for (const [side, p] of [
    ['L', sepL],
    ['R', mirror(sepL)],
  ] as const) {
    add(seg(`separator${side}`, p.x, p.y, p.x, 1030, 3, METAL, 0.01));
    add(disc(`sepPost${side}`, p.x, p.y, 6, POST));
  }
  add(seg('inlaneGuideL', INLANE_GUIDE.ax, INLANE_GUIDE.ay, INLANE_GUIDE.bx, INLANE_GUIDE.by, 3, METAL, 0.01));
  add(
    seg('inlaneGuideR', 472 - INLANE_GUIDE.ax, INLANE_GUIDE.ay, 472 - INLANE_GUIDE.bx, INLANE_GUIDE.by, 3, METAL, 0.01),
  );

  // Slingshots, with a rubber post at each corner.
  const slings = [...sling('L', SLING_L), ...sling('R', SLING_R)];
  add(...slings);
  for (const s of [SLING_L, SLING_R]) {
    for (const p of [s.a, s.b, s.c]) add(disc('slingPost', p.x, p.y, 6, POST));
  }

  // The plunger's tip, moved by the game as it is drawn back.
  const plunger = seg('plunger', 472, PLUNGER_REST, 508, PLUNGER_REST, 1, 0.1, 0.2);
  add(plunger);

  const flippers = [
    makeFlipper('flipperL', FLIPPER_L.x, FLIPPER_L.y, 30 * DEG, -28 * DEG),
    makeFlipper('flipperR', FLIPPER_R.x, FLIPPER_R.y, 150 * DEG, 208 * DEG),
  ];

  return { shapes, flippers, ducks, bumpers, plunger, slings: slings.filter((s) => s.kick) };
}

/** Where a new ball sits in the shooter lane, resting on the plunger. */
export function servePosition(): { x: number; y: number } {
  return { x: SHOOTER_X, y: PLUNGER_REST - BALL_R - 1.5 };
}
