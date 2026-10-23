// Signal box: the ground at Wenlow Junction, and the frame that works it.
//
// A double-track main line runs east and west past the box; the Pell Wood branch
// leaves it to the north-east. Down trains run east on the north track, up trains
// west on the south track. Ground coordinates are metres: X east, Y north, with the
// box at the origin. Each running line is a path measured in metres from the box
// in rear's starting signal, so a train's place is one number.

export type BoxId = 'callow' | 'marsh' | 'pell';
export type PathId = 'DM' | 'DB' | 'UM' | 'UB';
export type LeverKind = 'distant' | 'stop' | 'points' | 'fpl' | 'spare';

export const BOXES: Record<BoxId, { name: string; short: string; side: string }> = {
  callow: { name: 'Callow Bank', short: 'Callow Bk', side: 'west' },
  marsh: { name: 'Marsh Lane', short: 'Marsh La', side: 'east' },
  pell: { name: 'Pell Wood', short: 'Pell Wd', side: 'branch' },
};

/** Lever numbers that must be reversed (pulled) first, or normal (back) first, and those a reversed lever holds fast. */
export interface LeverDef {
  n: number;
  kind: LeverKind;
  name: string;
  /** Two short lines for the lever's plate. */
  plate: [string, string];
  reverse?: number[];
  normal?: number[];
  locks?: number[];
}

export const LEVERS: LeverDef[] = [
  { n: 1, kind: 'distant', name: 'Down main distant', plate: ['Down main', 'distant'], reverse: [2, 4] },
  { n: 2, kind: 'stop', name: 'Down main home', plate: ['Down main', 'home'], reverse: [6], normal: [7, 11] },
  { n: 3, kind: 'stop', name: 'Down branch home', plate: ['Down branch', 'home'], reverse: [6, 7] },
  { n: 4, kind: 'stop', name: 'Down main starting', plate: ['Down main', 'starting'] },
  { n: 5, kind: 'stop', name: 'Down branch starting', plate: ['Down branch', 'starting'] },
  { n: 6, kind: 'fpl', name: 'Facing point lock on 7 points', plate: ['F.P.L.', 'on 7'], locks: [7] },
  { n: 7, kind: 'points', name: 'Down junction points', plate: ['Down jcn', 'points'] },
  { n: 8, kind: 'points', name: 'Up junction points', plate: ['Up jcn', 'points'] },
  { n: 9, kind: 'spare', name: 'Spare', plate: ['Spare', ''] },
  { n: 10, kind: 'stop', name: 'Up starting', plate: ['Up', 'starting'] },
  { n: 11, kind: 'stop', name: 'Up branch home', plate: ['Up branch', 'home'], reverse: [8], normal: [2] },
  { n: 12, kind: 'stop', name: 'Up main home', plate: ['Up main', 'home'], normal: [8] },
  { n: 13, kind: 'distant', name: 'Up main distant', plate: ['Up main', 'distant'], reverse: [12, 10] },
  { n: 14, kind: 'spare', name: 'Spare', plate: ['Spare', ''] },
];

export const LEVER = new Map(LEVERS.map((l) => [l.n, l]));

/** Track circuits, each a lamp on the diagram. */
export type TrackId = 'DA' | 'DJ' | 'DM1' | 'DM2' | 'DB1' | 'DB2' | 'UA' | 'UBA' | 'UJ' | 'U1' | 'U2';

/** Where each running line's track circuits lie, as [from, to] in that path's metres. */
export const TRACKS: Record<PathId, [TrackId, number, number][]> = {
  DM: [
    ['DA', 1090, 1390],
    ['DJ', 1390, 1600],
    ['DM1', 1600, 1750],
    ['DM2', 1750, 2150],
  ],
  DB: [
    ['DA', 1090, 1390],
    ['DJ', 1390, 1600],
    ['DB1', 1600, 1750],
    ['DB2', 1750, 2150],
  ],
  UM: [
    ['UA', 1030, 1330],
    ['UJ', 1330, 1500],
    ['U1', 1500, 1650],
    ['U2', 1650, 2050],
  ],
  UB: [
    ['UBA', 1020, 1320],
    ['UJ', 1320, 1500],
    // The up branch crosses the down main on the diamond, inside the down junction's circuit.
    ['DJ', 1418, 1438],
    ['U1', 1500, 1650],
    ['U2', 1650, 2050],
  ],
};

export const TRACK_NAMES: Record<TrackId, string> = {
  DA: 'down approach',
  DJ: 'down junction',
  DM1: 'down main platform',
  DM2: 'down main departure',
  DB1: 'down branch',
  DB2: 'down branch departure',
  UA: 'up main approach',
  UBA: 'up branch approach',
  UJ: 'up junction',
  U1: 'up main',
  U2: 'up main departure',
};

export type SignalRole = 'distant' | 'home' | 'starting' | 'fixed-distant';

/** A signal a driver reads, at a place on a path. A lever of 0 is a fixed distant, always at caution. */
export interface PathSignal {
  s: number;
  lever: number;
  role: SignalRole;
  /** For a junction home on a bracket: the arm for the other route, which a driver reads as not for him. */
  other?: number;
}

export const PATH_SIGNALS: Record<PathId, PathSignal[]> = {
  DM: [
    { s: 600, lever: 1, role: 'distant' },
    { s: 1390, lever: 2, role: 'home', other: 3 },
    { s: 1750, lever: 4, role: 'starting' },
  ],
  DB: [
    { s: 600, lever: 1, role: 'distant' },
    { s: 1390, lever: 3, role: 'home', other: 2 },
    { s: 1750, lever: 5, role: 'starting' },
  ],
  UM: [
    { s: 600, lever: 13, role: 'distant' },
    { s: 1330, lever: 12, role: 'home' },
    { s: 1650, lever: 10, role: 'starting' },
  ],
  UB: [
    { s: 700, lever: 0, role: 'fixed-distant' },
    { s: 1320, lever: 11, role: 'home' },
    { s: 1650, lever: 10, role: 'starting' },
  ],
};

/** The box stands at this point on every path: where trains are booked to pass, and where they pass the window. */
export const PASS_S = 1500;
export const PATH_END = 3000;

/** Speed limits on each path, as [from, to, metres per second]. */
export const LIMITS: Record<PathId, [number, number, number][]> = {
  DM: [],
  // 25 mph over the junction and round the curve, then the branch's 50.
  DB: [
    [1520, 1660, 11.2],
    [1660, PATH_END, 22.4],
  ],
  UM: [],
  UB: [
    [0, 1330, 22.4],
    [1330, 1480, 11.2],
  ],
};

export const BRANCH_R = 250;
export const BRANCH_TURN = 0.5;
const ARC = BRANCH_R * BRANCH_TURN;
const UP_R = BRANCH_R + 3.5;
const UP_ARC = UP_R * BRANCH_TURN;
const JX = 30;
export const DOWN_Y = 15.5;
export const UP_Y = 12;

/** Ground position and heading (radians anticlockwise from east) of a point on a path. */
export function pathPoint(path: PathId, s: number): { x: number; y: number; h: number } {
  switch (path) {
    case 'DM':
      return { x: s - 1500, y: DOWN_Y, h: 0 };
    case 'UM':
      return { x: 1500 - s, y: UP_Y, h: Math.PI };
    case 'DB': {
      const j = 1500 + JX;
      if (s <= j) return { x: s - 1500, y: DOWN_Y, h: 0 };
      const a = s - j;
      if (a <= ARC) {
        const t = a / BRANCH_R;
        return { x: JX + BRANCH_R * Math.sin(t), y: DOWN_Y + BRANCH_R * (1 - Math.cos(t)), h: t };
      }
      const e = downBranchEnd();
      const d = a - ARC;
      return { x: e.x + d * Math.cos(BRANCH_TURN), y: e.y + d * Math.sin(BRANCH_TURN), h: BRANCH_TURN };
    }
    case 'UB': {
      const j = 1470;
      if (s >= j) return { x: JX - (s - j), y: UP_Y, h: Math.PI };
      const a = j - s;
      if (a <= UP_ARC) {
        const t = a / UP_R;
        return { x: JX + UP_R * Math.sin(t), y: DOWN_Y + BRANCH_R - UP_R * Math.cos(t), h: Math.PI + t };
      }
      const e = upBranchEnd();
      const d = a - UP_ARC;
      return {
        x: e.x + d * Math.cos(BRANCH_TURN),
        y: e.y + d * Math.sin(BRANCH_TURN),
        h: Math.PI + BRANCH_TURN,
      };
    }
  }
}

function downBranchEnd() {
  return { x: JX + BRANCH_R * Math.sin(BRANCH_TURN), y: DOWN_Y + BRANCH_R * (1 - Math.cos(BRANCH_TURN)) };
}

function upBranchEnd() {
  return { x: JX + UP_R * Math.sin(BRANCH_TURN), y: DOWN_Y + BRANCH_R - UP_R * Math.cos(BRANCH_TURN) };
}

/** Where each path begins and ends, by box. */
export const PATH_BOXES: Record<PathId, { from: BoxId; to: BoxId }> = {
  DM: { from: 'callow', to: 'marsh' },
  DB: { from: 'callow', to: 'pell' },
  UM: { from: 'marsh', to: 'callow' },
  UB: { from: 'pell', to: 'callow' },
};

/** The line each neighbour sends trains to us on, which our commutator controls. */
export const LINE_IN: Record<BoxId, 'down' | 'up'> = { callow: 'down', marsh: 'up', pell: 'up' };
