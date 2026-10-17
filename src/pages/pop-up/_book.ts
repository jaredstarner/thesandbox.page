// The book: page size, leaves, and every pop-up piece, as a paper engineer
// would spec them. V-fold silhouettes are drawn flat, in units with x across
// the card (the middle fold at x = 0) and y up from the glue line.

import type { Pt } from './_geom';
import { arch, circle, mirror, rect, seeded, type Ring } from './_shapes';

/** Page width and height. */
export const W = 380;
export const H = 500;
/** Board thickness per leaf. */
export const T = 3;

export interface VFold {
  kind: 'v';
  y0: number;
  alpha: number;
  beta: number;
  /** +1: the corner points at the reader. -1: a flat that opens toward the reader. */
  sense: 1 | -1;
  /** Outer ring first, then holes, in flat units. */
  rings: Ring[];
  /** Pencil strokes on the card, in flat units. */
  marks?: Pt[][];
}

export interface Layer {
  kind: 'layer';
  d: number;
  h: number;
  y0: number;
  y1: number;
  /** Pencil strokes on the deck, in deck px: x across from the left wall, y down from the far edge. */
  deck?: Pt[][];
}

export type Piece = VFold | Layer;

export interface SpreadDef {
  title: string;
  pieces: Piece[];
  /** Pencil art for each page, as SVG markup in page px (x from the left edge, y down from the top). */
  left: string;
  right: string;
}

// ---------------------------------------------------------------------------
// Pencil helpers for page art. Page px: x across the page, y down from the top.

const note = (x: number, y: number, text: string, size = 13, rot = 0) =>
  `<text x="${x}" y="${y}" font-size="${size}"${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ''}>${text}</text>`;

const line = (pts: Pt[], extra = '') =>
  `<path d="M${pts.map(([x, y]) => `${+x.toFixed(1)} ${+y.toFixed(1)}`).join('L')}"${extra} />`;

/** A row of shallow swells, the way a pencil draws water. */
function swell(x: number, y: number, n: number, w = 14, amp = 2.4) {
  let d = `M${x} ${y}`;
  for (let i = 0; i < n; i++) d += `q${w / 2} ${-amp} ${w} 0`;
  return `<path d="${d}" />`;
}

/** A small arrow with a caption, pointing from the caption to a spot. */
const leader = (x0: number, y0: number, x1: number, y1: number) =>
  line(
    [
      [x0, y0],
      [x1, y1],
    ],
    ' class="thin"',
  ) + `<circle cx="${x1}" cy="${y1}" r="1.6" class="dot" />`;

/** The top of a ring's outline at x: the highest crossing of a vertical line. */
function topAt(ring: Ring, x: number): number {
  let best = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    if ((x0 - x) * (x1 - x) > 0 || x0 === x1) continue;
    best = Math.max(best, y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
  }
  return best;
}

/** Pencil contours that follow a ring's top edge, set down by each depth, where the card is tall enough. */
function contours(ring: Ring, x0: number, x1: number, depths: number[]): Pt[][] {
  const out: Pt[][] = [];
  for (const d of depths) {
    let cur: Pt[] = [];
    for (let x = x0; x <= x1; x += 3) {
      const y = topAt(ring, x) - d;
      if (y > 6) cur.push([x, y + Math.sin(x * 0.21 + d) * 1.2]);
      else if (cur.length) {
        if (cur.length > 2) out.push(cur);
        cur = [];
      }
    }
    if (cur.length > 2) out.push(cur);
  }
  return out;
}

/** Short grass strokes along a ring's top edge. */
function tufts(ring: Ring, x0: number, x1: number, every: number): Pt[][] {
  const rnd = seeded(x0 * 7 + x1);
  const out: Pt[][] = [];
  for (let x = x0; x <= x1; x += every * (0.6 + rnd() * 0.8)) {
    const y = topAt(ring, x);
    out.push([
      [x, y - 1.5],
      [x + 1.5 + rnd() * 2, y - 6 - rnd() * 4],
    ]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spread 1: the harbour. A headland flat behind, a lighthouse corner, a quay.

const headland: Ring = [
  [-250, 0],
  [-250, 58],
  [-232, 70],
  [-212, 84],
  [-190, 92],
  [-172, 103],
  [-162, 103],
  [-162, 116],
  [-151, 125],
  [-140, 116],
  [-140, 104],
  [-118, 108],
  [-98, 113],
  [-82, 110],
  [-74, 97],
  [-68, 74],
  [-60, 64],
  [-54, 44],
  [-42, 36],
  [-30, 24],
  [-14, 21],
  [0, 16],
  [18, 22],
  [32, 17],
  [50, 27],
  [64, 23],
  [80, 31],
  [98, 26],
  [116, 35],
  [130, 31],
  [150, 41],
  [168, 36],
  [184, 49],
  [200, 44],
  [214, 55],
  [230, 50],
  [230, 0],
];

function lighthouse(): Ring[] {
  const half: Pt[] = [
    [24, 0],
    [17, 148],
    [27, 148],
    [27, 156],
    [13, 156],
    [13, 182],
    [16, 182],
    [3, 196],
    [1.2, 196],
    [1.2, 203],
  ];
  const outer: Ring = [...half, ...mirror(half)];
  return [
    outer,
    rect(3, 160, 10, 179),
    rect(-10, 160, -3, 179),
    rect(3, 44, 7, 53),
    rect(3, 86, 7, 95),
    rect(3, 122, 7, 131),
    rect(-7, 64, -3, 73),
    rect(-7, 104, -3, 113),
    arch(-12, 8, 2, 12, 6),
  ];
}

const lighthouseBands = (): Pt[][] => {
  const bands: Pt[][] = [];
  for (const [h0, h1] of [
    [56, 72],
    [100, 116],
  ]) {
    for (let h = h0; h <= h1; h += 3.2) {
      const w = 24 - (7 * h) / 148;
      bands.push([
        [-w + 0.5, h],
        [w - 0.5, h + 1.5],
      ]);
    }
  }
  return bands;
};

const deckPlanks = (): Pt[][] => {
  const out: Pt[][] = [];
  for (let x = 9; x < 112; x += 9)
    out.push([
      [x, 2],
      [x, 80],
    ]);
  return out;
};

const harbour: SpreadDef = {
  title: 'The harbour',
  pieces: [
    {
      kind: 'v',
      y0: 70,
      alpha: 62,
      beta: 90,
      sense: -1,
      rings: [headland, rect(-155, 107, -150, 112), rect(-146, 107, -142, 112), rect(-149, 104, -146, 110)],
      marks: [
        ...tufts(headland, -246, -84, 7),
        ...contours(headland, -248, -76, [10, 22, 36]),
        ...contours(headland, -70, 228, [8]),
        // Strata down the cliff face.
        [
          [-72, 88],
          [-62, 86],
        ],
        [
          [-68, 72],
          [-56, 70],
        ],
        [
          [-60, 56],
          [-50, 55],
        ],
        // The path up to the cottage.
        [
          [-120, 6],
          [-104, 30],
          [-128, 52],
          [-112, 76],
          [-140, 98],
          [-148, 104],
        ],
      ],
    },
    { kind: 'v', y0: 2, alpha: 42, beta: 90, sense: 1, rings: lighthouse(), marks: lighthouseBands() },
    { kind: 'layer', d: 56, h: 22, y0: -232, y1: -150, deck: deckPlanks() },
  ],
  left:
    note(26, 40, '1. The harbour', 24) +
    note(26, 68, 'headland flat: V-fold, α 62°, β 90°', 14) +
    note(26, 88, 'opens toward you, shuts away', 14) +
    swell(40, 330, 9) +
    swell(70, 352, 13) +
    swell(30, 376, 8) +
    swell(110, 398, 14) +
    swell(52, 424, 9) +
    swell(140, 450, 10) +
    note(30, 470, 'quay: floating layer, walls 56 out, 22 tall', 14) +
    leader(120, 458, 300, 420),
  right:
    note(150, 128, 'light: V-fold corner, α 42°', 14) +
    note(150, 148, 'leans toward you as it shuts:', 14) +
    note(150, 168, 'keep sin α × 203 short of the quay', 14) +
    leader(150, 152, 40, 200) +
    swell(200, 320, 8) +
    swell(150, 344, 13) +
    swell(230, 368, 9) +
    swell(170, 392, 14) +
    swell(240, 418, 7) +
    `<g class="rose" transform="translate(318 66)"><circle r="20" /><path d="M0 -26L4 0L0 26L-4 0Z" /><path d="M-26 0L0 3L26 0L0 -3Z" /></g>` +
    note(313, 34, 'N', 14),
};

// ---------------------------------------------------------------------------
// Spread 2: the street. Four corners on the same alpha, so they lie parallel
// and fold down one over the next like dominoes.

interface House {
  y0: number;
  /** Gable-end width (left wing), side width (right wing), eave and ridge heights. */
  gw: number;
  sw: number;
  eave: number;
  ridge: number;
  floors: number;
  chimney?: number;
  stepped?: boolean;
}

function house(h: House): { rings: Ring[]; marks: Pt[][] } {
  const { gw, sw, eave, ridge } = h;
  const right: Pt[] = [
    [sw, 0],
    [sw, eave],
    [sw + 4, eave],
    [sw - 8, ridge],
  ];
  if (h.chimney) {
    const cx = h.chimney;
    right.push([cx + 6, ridge], [cx + 6, ridge + 12], [cx - 1, ridge + 12], [cx - 1, ridge]);
  }
  right.push([0, ridge], [0, eave]);
  const left: Pt[] = [];
  if (h.stepped) {
    const steps = 4;
    const rise = (ridge - eave) / steps;
    const run = gw / 2 / steps;
    for (let i = 0; i < steps; i++) {
      left.push([-run * i, eave + rise * i], [-run * i, eave + rise * (i + 1)]);
    }
    left.push([-gw / 2 + 4, ridge], [-gw / 2 + 4, ridge + 6], [-gw / 2 - 4, ridge + 6], [-gw / 2 - 4, ridge]);
    for (let i = steps - 1; i >= 0; i--) {
      left.push([-gw + run * i, eave + rise * (i + 1)], [-gw + run * i, eave + rise * i]);
    }
  } else {
    left.push([-gw / 2, ridge - 2], [-gw - 3, eave - 2]);
  }
  left.push([-gw, eave - (h.stepped ? 0 : 2)], [-gw, 0]);
  const outer: Ring = [[-gw, 0], ...right, ...left.slice(0, -1)];
  const rings: Ring[] = [outer];
  const storey = (eave - 6) / h.floors;
  // Side wall: a door, then windows by floor.
  rings.push(arch(9 + 5, 10, 1.5, Math.min(18, storey - 6), 6));
  for (let f = 0; f < h.floors; f++) {
    const y = 4 + f * storey + storey * 0.35;
    for (let x = f === 0 ? 28 : 8; x + 9 < sw - 3; x += 15) rings.push(rect(x, y, x + 8, y + storey * 0.42));
  }
  // Gable end: windows down the middle, and a round light in the gable.
  for (let f = 0; f < h.floors; f++) {
    const y = 4 + f * storey + storey * 0.35;
    rings.push(rect(-gw / 2 - 6, y, -gw / 2 + 6, y + storey * 0.42));
  }
  rings.push(circle(-gw / 2, eave + (ridge - eave) * 0.42, 3.2, 14));
  const marks: Pt[][] = [];
  for (let x = 4; x < sw - 8; x += 5)
    marks.push([
      [x, eave + 2],
      [x + 6, ridge - 2],
    ]);
  marks.push([
    [0.5, eave],
    [sw, eave],
  ]);
  return { rings, marks };
}

function tower(y0: number): { rings: Ring[]; marks: Pt[][] } {
  const w = 34;
  const half: Pt[] = [
    [w, 0],
    [w, 132],
    [w + 3, 132],
    [w + 3, 138],
    [w, 138],
    [1, 196],
    [1, 206],
  ];
  const outer: Ring = [...half, ...mirror(half)];
  const rings: Ring[] = [outer, arch(17, 18, 2, 18, 8), arch(-17, 18, 2, 18, 8)];
  for (const s of [1, -1]) {
    rings.push(arch(s * 17, 12, 104, 120, 8));
    rings.push(circle(s * 17, 80, 7, 16));
    rings.push(rect(s * 17 - 2, 40, s * 17 + 2, 54));
  }
  void y0;
  const marks: Pt[][] = [];
  for (let h = 144; h < 192; h += 6) {
    const x = w - ((h - 138) / 58) * (w - 1);
    marks.push(
      [
        [-x + 2, h],
        [-1, h + 3],
      ],
      [
        [1, h + 3],
        [x - 2, h],
      ],
    );
  }
  return { rings, marks };
}

const houses: House[] = [
  { y0: -182, gw: 40, sw: 52, eave: 36, ridge: 62, floors: 1, chimney: 32 },
  { y0: -88, gw: 46, sw: 58, eave: 62, ridge: 94, floors: 2, chimney: 12 },
  { y0: 8, gw: 48, sw: 62, eave: 104, ridge: 136, floors: 3, stepped: true },
];

const street: SpreadDef = {
  title: 'The street',
  pieces: [
    ...houses.map((h): VFold => ({ kind: 'v', y0: h.y0, alpha: 36, beta: 90, sense: 1, ...house(h) })),
    { kind: 'v', y0: 112, alpha: 36, beta: 90, sense: 1, ...tower(112) },
  ],
  left:
    note(26, 40, '2. The street', 24) +
    note(26, 68, 'four corners, all at α 36°', 14) +
    note(26, 88, 'parallel, so they shut like dominoes', 14) +
    note(26, 108, 'and never cut through each other', 14) +
    line(
      [
        [220, 492],
        [330, 150],
      ],
      ' class="thin"',
    ) +
    line(
      [
        [120, 492],
        [300, 140],
      ],
      ' class="thin"',
    ) +
    note(40, 300, 'tallest at the back:', 14) +
    note(40, 320, '206 × sin 36° = 121, clears the spine', 14),
  right:
    line(
      [
        [160, 492],
        [50, 150],
      ],
      ' class="thin"',
    ) +
    line(
      [
        [260, 492],
        [80, 140],
      ],
      ' class="thin"',
    ) +
    note(210, 400, 'cobbles', 14, -18) +
    `<g class="thin">${Array.from({ length: 22 }, (_, i) => {
      const r = seeded(i + 7);
      const x = 150 + i * 6.4 + r() * 6;
      const y = 470 - i * 13 + r() * 5;
      return `<path d="M${x.toFixed(1)} ${y.toFixed(1)}q4 -3 8 0" />`;
    }).join('')}</g>` +
    note(230, 90, 'gable ends face left,', 14) +
    note(230, 110, 'eaves run right', 14),
};

// ---------------------------------------------------------------------------
// Spread 3: the bridge by night. Two shallow flats on the same alpha, one
// behind the other, like a stage: a bridge of arches and a skyline of windows.

function bridge(): { rings: Ring[]; marks: Pt[][] } {
  const half: Pt[] = [];
  half.push([330, 0], [330, 40], [314, 60], [306, 60], [306, 70]);
  for (const px of [248, 160, 62]) {
    half.push([px + 3, 70], [px + 3, 80], [px + 5, 82], [px + 5, 88], [px - 5, 88], [px - 5, 82], [px - 3, 80]);
    half.push([px - 3, 70]);
  }
  half.push([0.8, 70]);
  const outer: Ring = [...half.reverse(), ...mirror(half)];
  const rings: Ring[] = [outer.reverse()];
  rings.push(arch(0, 84, 8, 16, 14));
  for (const s of [1, -1]) {
    rings.push(arch(s * 105, 72, 8, 14, 14));
    rings.push(arch(s * 190, 60, 8, 12, 14));
    rings.push(arch(s * 262, 44, 8, 10, 10));
    for (let x = 12; x < 300; x += 9) rings.push(rect(s * x - 2, 63, s * x + 2, 68));
  }
  const marks: Pt[][] = [
    [
      [-306, 60],
      [306, 60],
    ],
    [
      [-306, 61.5],
      [306, 61.5],
    ],
  ];
  return { rings, marks };
}

function skyline(): Ring[] {
  const rnd = seeded(41);
  // Buildings left to right: [width, height, roof]. Roofs: f flat, g gable, d dome, s spire, c clock tower.
  const plan: [number, number, string][] = [
    [26, 58, 'g'],
    [34, 84, 'f'],
    [22, 70, 'g'],
    [30, 104, 'c'],
    [36, 66, 'f'],
    [24, 92, 'f'],
    [40, 78, 'd'],
    [28, 60, 'g'],
    [30, 98, 's'],
    [34, 72, 'f'],
    [24, 86, 'g'],
    [38, 64, 'f'],
    [30, 110, 'f'],
    [26, 76, 'g'],
    [32, 58, 'f'],
    [28, 82, 'g'],
    [34, 62, 'f'],
  ];
  const total = plan.reduce((s, [w]) => s + w, 0);
  let x = -total / 2;
  const outer: Ring = [[x, 0]];
  const holes: Ring[] = [];
  let tallestX = 0;
  for (const [w, h, roof] of plan) {
    const x1 = x + w;
    outer.push([x, h]);
    if (roof === 'g') outer.push([x + w / 2, h + 14]);
    if (roof === 'd') {
      const dome = (i: number): Pt => {
        const t = (i / 10) * Math.PI;
        return [x + w / 2 - (Math.cos(t) * w) / 2.4, h + Math.sin(t) * 18];
      };
      for (let i = 1; i < 5; i++) outer.push(dome(i));
      outer.push([x + w / 2 - 1, h + 18], [x + w / 2 - 1, h + 26], [x + w / 2 + 1, h + 26], [x + w / 2 + 1, h + 18]);
      for (let i = 6; i < 10; i++) outer.push(dome(i));
    }
    if (roof === 's') outer.push([x + 6, h], [x + w / 2, h + 34], [x + w - 6, h]);
    if (roof === 'c') {
      outer.push([x + 4, h], [x + 4, h + 12], [x + w / 2, h + 26], [x + w - 4, h + 12], [x + w - 4, h]);
      holes.push(circle(x + w / 2, h - 12, 8, 18));
    }
    if (h === 110) tallestX = x + w / 2;
    outer.push([x1, h]);
    // Windows: a grid, about two in three cut.
    for (let wy = 8; wy + 9 < h - (roof === 'c' ? 24 : 6); wy += 11) {
      for (let wx = x + 4; wx + 4 < x1 - 3; wx += 7) if (rnd() < 0.62) holes.push(rect(wx, wy, wx + 3.4, wy + 5.5));
    }
    x = x1;
  }
  outer.push([x, 0]);
  // A crescent moon hung from the tallest roof on a thread of card. Both sit
  // outside the outline, so even-odd fills them as paper.
  const moon: Ring = [];
  const mx = tallestX + 34;
  const my = 125;
  for (let i = 0; i <= 16; i++) {
    const t = -Math.PI / 2 + (i / 16) * Math.PI;
    moon.push([mx + Math.cos(t) * 12, my + Math.sin(t) * 12]);
  }
  for (let i = 16; i >= 0; i--) {
    const t = -Math.PI / 2 + (i / 16) * Math.PI;
    moon.push([mx - 4 + Math.cos(t) * 9, my + Math.sin(t) * 11]);
  }
  const thread: Ring = [
    [tallestX + 9, 110],
    [tallestX + 11, 110],
    [mx + 0.6, my - 12.4],
    [mx - 1.4, my - 12.2],
  ];
  return [outer, ...holes, moon, thread];
}

const night: SpreadDef = {
  title: 'The bridge by night',
  pieces: [
    { kind: 'v', y0: 112, alpha: 80, beta: 90, sense: -1, rings: skyline() },
    { kind: 'v', y0: -40, alpha: 80, beta: 90, sense: -1, ...bridge() },
  ],
  left:
    note(26, 40, '3. The bridge, by night', 24) +
    note(26, 68, 'two flats, one behind the other, both α 80°', 14) +
    note(26, 88, 'every window is a hole: with the lamp in front', 14) +
    note(26, 108, 'the town is drawn again on the page, in light', 14) +
    swell(40, 360, 10, 16, 1.8) +
    swell(90, 384, 12, 16, 1.8) +
    swell(30, 410, 9, 16, 1.8) +
    swell(120, 436, 11, 16, 1.8),
  right:
    swell(10, 360, 11, 16, 1.8) +
    swell(60, 384, 9, 16, 1.8) +
    swell(20, 410, 12, 16, 1.8) +
    swell(100, 436, 8, 16, 1.8) +
    note(176, 456, 'Dummy no. 4, white 300 gsm board.', 14) +
    note(176, 472, 'Shut the book to check every piece folds flat.', 13),
};

export const SPREADS: SpreadDef[] = [harbour, street, night];
