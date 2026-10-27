// The six sheets on /rubbings/: where each one is taped down, how big the
// scene is, and how the crayon meets what is under it. Shared by the page and
// the worker; drawing lives in _draw.ts and the surfaces in _compose.ts.

export type PlaceId = 'cover' | 'headstone' | 'leaves' | 'floor' | 'coin' | 'plate';

export interface Place {
  id: PlaceId;
  no: number;
  /** Where the sheet is, shown before anything is rubbed. */
  where: string;
  /** What is under it, shown once the sheet has been lifted. */
  what: string;
  /** Width of the square scene, in centimetres. */
  sceneCm: number;
  /** The sheet, as fractions of the scene, and its turn in degrees. */
  paper: { x: number; y: number; w: number; h: number; angle: number };
  /** How far the crayon bridges between high points, in millimetres. */
  bridge: number;
  /** How far below the crayon's plane the paper still takes wax, light and firm, in millimetres. */
  reach: [number, number];
  /** The colour of the scene behind the stage while it loads. */
  ground: string;
}

export const PLACES: Place[] = [
  {
    id: 'cover',
    no: 1,
    where: 'Mill Lane, in the road by the kerb',
    what: 'A cast-iron surface-water cover, 62 cm across, cast in 1931, in a frame set among granite setts.',
    sceneCm: 100,
    paper: { x: 0.1, y: 0.09, w: 0.8, h: 0.82, angle: -1.2 },
    bridge: 4,
    reach: [0.5, 1.6],
    ground: '#55524d',
  },
  {
    id: 'headstone',
    no: 2,
    where: 'The churchyard, against the north wall',
    what: 'A slate headstone cut in 1798, with a second name added in 1811 by a different carver.',
    sceneCm: 90,
    paper: { x: 0.15, y: 0.16, w: 0.7, h: 0.78, angle: 0.8 },
    bridge: 3,
    reach: [0.35, 1.1],
    ground: '#2f3437',
  },
  {
    id: 'leaves',
    no: 3,
    where: 'The bench under the oak',
    what: 'Three fallen leaves, face down on a sandstone flag: oak, field maple, and silver birch.',
    sceneCm: 32,
    paper: { x: 0.08, y: 0.08, w: 0.84, h: 0.84, angle: 1.5 },
    bridge: 1.1,
    reach: [0.05, 0.16],
    ground: '#8c7b62',
  },
  {
    id: 'floor',
    no: 4,
    where: 'The attic of the mill house',
    what: 'Pine floorboards, scrubbed for a century until the hard grain stands proud of the soft.',
    sceneCm: 70,
    paper: { x: 0.09, y: 0.1, w: 0.82, h: 0.8, angle: -0.6 },
    bridge: 2.2,
    reach: [0.07, 0.24],
    ground: '#6b5238',
  },
  {
    id: 'coin',
    no: 5,
    where: 'Found down the side of the armchair',
    what: 'A bronze penny of 1951, 31 mm across, with a heron in the reeds.',
    sceneCm: 6,
    paper: { x: 0.11, y: 0.12, w: 0.78, h: 0.76, angle: -2 },
    bridge: 0.6,
    reach: [0.025, 0.07],
    ground: '#3a2c24',
  },
  {
    id: 'plate',
    no: 6,
    where: 'The parapet of the canal bridge',
    what: 'A cast-iron weight-limit notice, bolted to the brickwork when the bridge was strengthened in 1897.',
    sceneCm: 80,
    paper: { x: 0.08, y: 0.17, w: 0.84, h: 0.66, angle: 0.7 },
    bridge: 3,
    reach: [0.4, 1.3],
    ground: '#5e3b2e',
  },
];

export const placeById = (id: string): Place => PLACES.find((p) => p.id === id) ?? PLACES[0];

/** The light that rakes across every scene, from the upper left. */
export const LIGHT = (() => {
  const v = [-0.52, -0.62, 0.59];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l] as const;
})();
