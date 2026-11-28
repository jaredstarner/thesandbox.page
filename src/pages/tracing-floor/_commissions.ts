// The master's commissions: what each floor starts with, what must be struck, and one way to strike it.

import {
  arcDeg,
  arcPts,
  circle,
  constructionPoints,
  dist,
  line,
  v,
  type Circle,
  type Piece,
  type Prim,
  type Rect,
  type Vec,
} from './_geom';

export type Step =
  | { tool: 'rule'; a: Vec; b: Vec }
  | { tool: 'compass'; c: Vec; through: Vec }
  | { tool: 'dividers'; from: Vec; to: Vec; c: Vec };

export interface Target {
  prim: Prim;
  /** The stretches of it that become stone. */
  pieces: Piece[];
}

export type Glazing = 'geometric' | 'rose' | 'open';

export interface Commission {
  id: string;
  numeral: string;
  title: string;
  /** The master's note, one paragraph per entry. */
  brief: string[];
  /** Points scratched before the visitor starts. */
  points: Vec[];
  /** Lines and circles already on the floor. */
  prims: Prim[];
  /** Stone already settled: jambs, sill, and earlier commissions' members. */
  stone: Piece[];
  targets: Target[];
  /** One construction that strikes every target. */
  solution: Step[];
  /** The part of the floor to frame. */
  view: Rect;
  /** Crossings outside this are ignored. */
  bounds: Rect;
  /** The window's extent once raised, outline included. */
  frame: Rect;
  glazing: Glazing;
  /** A name for the raised window. */
  window: string;
}

const R3 = Math.sqrt(3);
const S1 = v(-1, 0);
const S2 = v(1, 0);
const SILL = -3;

// The great arch's circles, centred on the opposite springers.
const greatL = circle(S2, 2);
const greatR = circle(S1, 2);
const apex = v(0, R3);

// The two lights: half-size equilateral arches on (-1, 0)-(0, 0) and (0, 0)-(1, 0).
const M = v(0, 0);
const subMid = circle(M, 1);
const subL = circle(S1, 1);
const subR = circle(S2, 1);

// The circle in the head: on the axis, 3/4 span from each springer, radius 1/4 span.
const O = v(0, Math.sqrt(1.25));
const head = circle(O, 0.5);
const T = v(0, O.y + 0.5);
const B = v(0, O.y - 0.5);

// The quatrefoil: foils of half the head's radius, centred halfway out along the diameters.
const fTop = v(0, O.y + 0.25);
const fBot = v(0, O.y - 0.25);
const fLeft = v(-0.25, O.y);
const fRight = v(0.25, O.y);

const basePoints = [S1, S2, v(-1, SILL), v(1, SILL)];
const basePrims: Prim[] = [line(S1, v(-1, SILL)), line(S2, v(1, SILL)), line(v(-1, SILL), v(1, SILL))];
const baseStone: Piece[] = [
  { kind: 'seg', p: v(-1, SILL), q: S1 },
  { kind: 'seg', p: v(1, SILL), q: S2 },
  { kind: 'seg', p: v(-1, SILL), q: v(1, SILL) },
];

const windowView: Rect = { x0: -1.55, y0: -3.25, x1: 1.55, y1: 2.05 };
const windowBounds: Rect = { x0: -3.4, y0: -4.2, x1: 3.4, y1: 3.4 };
const windowFrame: Rect = { x0: -1.5, y0: -3.46, x1: 1.5, y1: 2.24 };

const lancetTargets: Target[] = [
  { prim: greatL, pieces: [arcPts(S2, 2, apex, S1)] },
  { prim: greatR, pieces: [arcPts(S1, 2, S2, apex)] },
];
const lancetSolution: Step[] = [
  { tool: 'compass', c: S2, through: S1 },
  { tool: 'compass', c: S1, through: S2 },
];

const lightsTargets: Target[] = [
  { prim: line(apex, v(0, -R3)), pieces: [{ kind: 'seg', p: v(0, SILL), q: M }] },
  { prim: subMid, pieces: [arcDeg(M, 1, 120, 180), arcDeg(M, 1, 0, 60)] },
  { prim: subL, pieces: [arcDeg(S1, 1, 0, 60)] },
  { prim: subR, pieces: [arcDeg(S2, 1, 120, 180)] },
];
const lightsSolution: Step[] = [
  { tool: 'rule', a: apex, b: v(0, -R3) },
  { tool: 'rule', a: S1, b: S2 },
  { tool: 'compass', c: M, through: S1 },
  { tool: 'compass', c: S1, through: M },
  { tool: 'compass', c: S2, through: M },
];

const headTargets: Target[] = [{ prim: head, pieces: [arcDeg(O, 0.5, 0, 360)] }];
const headSolution: Step[] = [
  { tool: 'rule', a: v(-0.5, R3 / 2), b: v(-0.5, -R3 / 2) },
  { tool: 'compass', c: S2, through: v(-0.5, 0) },
  { tool: 'dividers', from: v(-0.5, 0), to: M, c: O },
];

const foilTargets: Target[] = [
  { prim: circle(fTop, 0.25), pieces: [arcDeg(fTop, 0.25, 0, 180)] },
  { prim: circle(fLeft, 0.25), pieces: [arcDeg(fLeft, 0.25, 90, 270)] },
  { prim: circle(fBot, 0.25), pieces: [arcDeg(fBot, 0.25, 180, 360)] },
  { prim: circle(fRight, 0.25), pieces: [arcDeg(fRight, 0.25, 270, 450)] },
];
const foilSolution: Step[] = [
  { tool: 'compass', c: T, through: O },
  { tool: 'rule', a: v(-R3 / 4, O.y + 0.25), b: v(R3 / 4, O.y + 0.25) },
  { tool: 'dividers', from: O, to: fTop, c: O },
  { tool: 'compass', c: T, through: B },
  { tool: 'compass', c: B, through: T },
  { tool: 'rule', a: v(-R3 / 2, O.y), b: v(R3 / 2, O.y) },
  { tool: 'compass', c: fTop, through: O },
  { tool: 'compass', c: fLeft, through: O },
  { tool: 'compass', c: fBot, through: O },
  { tool: 'compass', c: fRight, through: O },
];

// The rose: a rim, six petals struck from the six steps of the radius round it, and three spokes.
const RO = v(0, 0);
const RIM = 1;
const OUTER = 1.22;
const hex = Array.from({ length: 6 }, (_, k) => {
  const a = ((90 + 60 * k) * Math.PI) / 180;
  return v(Math.cos(a), Math.sin(a));
});
const roseTargets: Target[] = [
  { prim: circle(RO, RIM), pieces: [arcDeg(RO, RIM, 0, 360)] },
  ...hex.map((h, k) => {
    const back = 90 + 60 * k + 180;
    return { prim: circle(h, RIM), pieces: [arcDeg(h, RIM, back - 60, back + 60)] };
  }),
  ...[0, 1, 2].map((k) => {
    const a = hex[k];
    const b = hex[k + 3];
    const out = (p: Vec, r: number): Vec => v(p.x * r, p.y * r);
    return {
      prim: line(a, b),
      pieces: [
        { kind: 'seg', p: a, q: out(a, OUTER) } as Piece,
        { kind: 'seg', p: b, q: out(b, OUTER) } as Piece,
      ],
    };
  }),
];
const roseSolution: Step[] = [
  { tool: 'compass', c: RO, through: hex[0] },
  { tool: 'compass', c: hex[0], through: RO },
  { tool: 'compass', c: hex[1], through: RO },
  { tool: 'compass', c: hex[5], through: RO },
  { tool: 'compass', c: hex[2], through: RO },
  { tool: 'compass', c: hex[4], through: RO },
  { tool: 'compass', c: hex[3], through: RO },
  { tool: 'rule', a: hex[0], b: hex[3] },
  { tool: 'rule', a: hex[1], b: hex[4] },
  { tool: 'rule', a: hex[2], b: hex[5] },
];

/** Turn steps into primitives, resolving each named point against what is on the floor. */
export function playSteps(steps: Step[], points: Vec[], prims: Prim[], bounds: Rect): Prim[] {
  const out = [...prims];
  for (const step of steps) {
    const pts = constructionPoints(points, out, bounds);
    const find = (p: Vec): Vec => {
      let best: Vec | null = null;
      let bd = 1e-3;
      for (const q of pts) {
        const d = dist(p, q);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      if (!best) throw new Error(`No construction point near (${p.x.toFixed(4)}, ${p.y.toFixed(4)})`);
      return best;
    };
    out.push(stepPrim(step, find));
  }
  return out.slice(prims.length);
}

export function stepPrim(step: Step, find: (p: Vec) => Vec): Prim {
  if (step.tool === 'rule') return line(find(step.a), find(step.b));
  if (step.tool === 'compass') {
    const c = find(step.c);
    return circle(c, dist(c, find(step.through)));
  }
  const c = find(step.c);
  return circle(c, dist(find(step.from), find(step.to)));
}

function geometric(
  id: string,
  numeral: string,
  title: string,
  window: string,
  brief: string[],
  earlier: { targets: Target[]; solution: Step[] }[],
  targets: Target[],
  solution: Step[],
  view: Rect = windowView,
): Commission {
  let prims = [...basePrims];
  const stone = [...baseStone];
  for (const e of earlier) {
    prims = prims.concat(playSteps(e.solution, basePoints, prims, windowBounds));
    for (const t of e.targets) stone.push(...t.pieces);
  }
  return {
    id,
    numeral,
    title,
    brief,
    points: basePoints,
    prims,
    stone,
    targets,
    solution,
    view,
    bounds: windowBounds,
    frame: windowFrame,
    glazing: 'geometric',
    window,
  };
}

const lancet = { targets: lancetTargets, solution: lancetSolution };
const lights = { targets: lightsTargets, solution: lightsSolution };
const headC = { targets: headTargets, solution: headSolution };

export const COMMISSIONS: Commission[] = [
  geometric(
    'lancet',
    'I',
    'A lancet',
    'A single lancet',
    [
      'Every window starts from its springers, the two points where the arch leaves the jambs. Set the compass point on one springer, open the legs to the other, and strike.',
      'Do the same from the other side. The arcs cross at the apex, and the apex and the springers make an equilateral triangle: the plainest pointed arch there is.',
    ],
    [],
    lancetTargets,
    lancetSolution,
  ),
  geometric(
    'lights',
    'II',
    'Two lights',
    'A lancet of two lights',
    [
      'Split the lancet with a mullion down the middle and give each half its own arch, struck the same way as the great one at half the size.',
      'First find the middle. Your two arcs cross twice, at the apex and again below the springing; a line through both crossings is the axis.',
    ],
    [lancet],
    lightsTargets,
    lightsSolution,
  ),
  geometric(
    'head',
    'III',
    'A circle in the head',
    'Two lights with a circle in the head',
    [
      'Fill the head of the arch with a circle that touches the great arch on both sides and both small arches at once.',
      'Its centre is on the axis, three quarters of the span from either springer, and its radius is a quarter of the span. Neither length is on the floor yet.',
    ],
    [lancet, lights],
    headTargets,
    headSolution,
    { x0: -1.45, y0: -1.05, x1: 1.45, y1: 2.0 },
  ),
  geometric(
    'foils',
    'IV',
    'Four foils',
    'Two lights and a quatrefoil',
    [
      'Cut the circle into four foils. Each is half the circle’s radius, centred halfway out along the upright or the level diameter, so it touches the rim and the middle.',
      'The level diameter isn’t on the floor, and neither is half the radius. Start from where the circle crosses the axis.',
    ],
    [lancet, lights, headC],
    foilTargets,
    foilSolution,
    { x0: -1.05, y0: 0.42, x1: 1.05, y1: 1.86 },
  ),
  {
    id: 'rose',
    numeral: 'V',
    title: 'A rose of six',
    brief: [
      'A round window. Strike the rim from the centre through the mark above it, then walk the compasses round the rim without changing their opening: the radius steps round a circle exactly six times.',
      'Every step is the centre of a petal, struck back through the middle. Three straight lines through the centre carry the spokes out to the wall. The same six-petalled figure is scratched into church walls and roof timbers all over England.',
    ],
    points: [RO, hex[0]],
    prims: [circle(RO, OUTER)],
    stone: [arcDeg(RO, OUTER, 0, 360)],
    targets: roseTargets,
    solution: roseSolution,
    view: { x0: -1.4, y0: -1.4, x1: 1.4, y1: 1.4 },
    bounds: { x0: -2.6, y0: -2.6, x1: 2.6, y1: 2.6 },
    frame: { x0: -1.66, y0: -1.66, x1: 1.66, y1: 1.66 },
    glazing: 'rose',
    window: 'A rose of six petals',
  },
  {
    id: 'open',
    numeral: 'VI',
    title: 'Your own window',
    brief: [
      'A clean patch of floor with the jambs and sill set out. Strike whatever the compasses and rule allow, then take the chisel and mark which stretches become stone.',
      'Anything closed off by stone gets glass.',
    ],
    points: basePoints,
    prims: basePrims,
    stone: baseStone,
    targets: [],
    solution: [],
    view: windowView,
    bounds: windowBounds,
    frame: windowFrame,
    glazing: 'open',
    window: 'A window of your own',
  },
];

/** True when some drawn primitive is the target's. */
export const isCircle = (p: Prim): p is Circle => p.kind === 'circle';
