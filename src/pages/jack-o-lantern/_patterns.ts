// Carving patterns, drawn for this page. Coordinates are centimetres on the
// skin, x to the right and y up from the middle of the face. Each region is a
// set of polygons to carve, minus a set to leave alone (a pupil inside an eye,
// a cat against the moon), and a depth: cut right through, thin the wall so it
// glows, or take off only the skin.

export type Depth = 'cut' | 'thin' | 'skin';
export type Pt = [number, number];

export interface Region {
  depth: Depth;
  add: Pt[][];
  sub?: Pt[][];
}

export interface Pattern {
  id: string;
  name: string;
  note: string;
  regions: Region[];
}

const circle = (cx: number, cy: number, r: number, n = 40, ry = r): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + ry * Math.sin(a)];
  });

const mirror = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [-x, y] as Pt).reverse();

const place = (pts: Pt[], dx: number, dy: number, s = 1, rot = 0): Pt[] => {
  const c = Math.cos(rot);
  const n = Math.sin(rot);
  return pts.map(([x, y]) => [dx + s * (x * c - y * n), dy + s * (x * n + y * c)] as Pt);
};

// A four-point star, for the sky round the moon.
const star = (cx: number, cy: number, r: number): Pt[] => {
  const pts: Pt[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
    const rr = i % 2 ? r * 0.32 : r;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return pts;
};

// The classic face: triangle eyes, a nose, and a grin with three teeth.
const grin = (): Pt[] => {
  const w = 7.8;
  const n = 48;
  const top = (x: number) => -2.3 - 2.0 * (1 - (x / w) ** 2);
  const bottom = (x: number) => -2.3 - 5.2 * Math.pow(Math.max(0, 1 - (x / w) ** 2), 0.75);
  // A lip from one corner to the other, with square teeth: [from, to, how far they reach into the mouth].
  const lip = (edge: (x: number) => number, teeth: [number, number, number][], dir: 1 | -1): Pt[] => {
    const xs = new Set<number>();
    for (let i = 0; i <= n; i++) xs.add(-w + (2 * w * i) / n);
    for (const [a, b] of teeth) xs.add(a).add(b);
    const sorted = [...xs].sort((p, q) => (p - q) * dir);
    const pts: Pt[] = [];
    for (const x of sorted) {
      const tooth = teeth.find(([a, b]) => x > Math.min(a, b) && x < Math.max(a, b));
      const edgeOf = teeth.find(([a, b]) => x === a || x === b);
      if (edgeOf) {
        const entering = x === (dir === 1 ? Math.min(edgeOf[0], edgeOf[1]) : Math.max(edgeOf[0], edgeOf[1]));
        const lipY = edge(x);
        const toothY = lipY + edgeOf[2];
        pts.push(entering ? [x, lipY] : [x, toothY], entering ? [x, toothY] : [x, lipY]);
      } else {
        pts.push([x, edge(x) + (tooth ? tooth[2] : 0)]);
      }
    }
    return pts;
  };
  const upper = lip(
    top,
    [
      [-4.6, -2.9, -1.6],
      [1.2, 2.9, -1.6],
    ],
    1,
  );
  const lower = lip(bottom, [[-1.4, 0.2, 1.7]], -1);
  return [...upper, ...lower.slice(1, -1)];
};

const eye: Pt[] = [
  [-7.0, 1.4],
  [-2.3, 1.7],
  [-4.2, 5.6],
];

const classic: Pattern = {
  id: 'classic',
  name: 'Classic',
  note: 'Triangle eyes and a toothy grin, all cut right through.',
  regions: [
    { depth: 'cut', add: [eye] },
    { depth: 'cut', add: [mirror(eye)] },
    {
      depth: 'cut',
      add: [
        [
          [-1.2, -0.7],
          [1.2, -0.7],
          [0, 1.1],
        ],
      ],
    },
    { depth: 'cut', add: [grin()] },
  ],
};

// An owl: glowing eyes with solid pupils, a cut beak and glints, scraped tufts and breast feathers.
const tuft: Pt[] = [
  [-0.9, 3.7],
  [-2.6, 4.1],
  [-4.7, 6.3],
  [-4.3, 4.3],
  [-5.0, 2.6],
  [-4.4, 3.0],
  [-3.2, 3.6],
];

const crescentRow = (y: number, n: number, gap: number, r: number): Region => {
  const add: Pt[][] = [];
  const sub: Pt[][] = [];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * gap;
    add.push(circle(x, y, r, 28));
    sub.push(circle(x, y + r * 0.55, r * 0.92, 28));
  }
  return { depth: 'skin', add, sub };
};

const owl: Pattern = {
  id: 'owl',
  name: 'Owl',
  note: 'Thinned eyes that glow round solid pupils, scraped feathers that glow faintly.',
  regions: [
    { depth: 'thin', add: [circle(-2.75, 1.5, 2.35)], sub: [circle(-2.45, 1.35, 0.95)] },
    { depth: 'thin', add: [circle(2.75, 1.5, 2.35)], sub: [circle(2.45, 1.35, 0.95)] },
    { depth: 'cut', add: [circle(-2.15, 1.75, 0.3, 16)] },
    { depth: 'cut', add: [circle(2.15, 1.75, 0.3, 16)] },
    {
      depth: 'cut',
      add: [
        [
          [-0.6, 0.0],
          [0, 0.75],
          [0.6, 0.0],
          [0, -1.9],
        ],
      ],
    },
    { depth: 'skin', add: [tuft] },
    { depth: 'skin', add: [mirror(tuft)] },
    crescentRow(-3.3, 4, 1.9, 0.95),
    crescentRow(-4.9, 5, 1.9, 0.95),
    crescentRow(-6.5, 4, 1.9, 0.95),
  ],
};

// A cat on a roof ridge against a thinned moon, with stars cut round it.
const cat: Pt[] = place(
  [
    [-2.1, 0],
    [-2.25, 1.0],
    [-2.05, 2.0],
    [-1.55, 2.85],
    [-1.0, 3.35],
    [-1.2, 3.8],
    [-1.3, 4.4],
    [-1.2, 4.9],
    [-1.05, 6.2],
    [-0.35, 5.62],
    [0, 5.7],
    [0.35, 5.62],
    [1.05, 6.2],
    [1.2, 4.9],
    [1.3, 4.4],
    [1.2, 3.8],
    [1.0, 3.35],
    [1.55, 2.85],
    [2.05, 2.0],
    [2.25, 1.15],
    [2.2, 0.9],
    [2.8, 0.85],
    [3.5, 1.15],
    [3.95, 1.75],
    [4.05, 2.45],
    [3.85, 3.0],
    [4.2, 3.05],
    [4.55, 2.5],
    [4.6, 1.7],
    [4.25, 0.95],
    [3.6, 0.4],
    [2.7, 0.15],
    [2.0, -0.6],
    [-2.1, -0.6],
  ],
  -1.4,
  -1.6,
  0.78,
);

const roof: Pt[] = [
  [-9, -1.9],
  [-4.5, -2.1],
  [-1.0, -2.05],
  [3.0, -1.85],
  [3.0, -0.9],
  [4.4, -0.9],
  [4.4, -1.8],
  [9, -1.7],
  [9, -9],
  [-9, -9],
];

const moonCat: Pattern = {
  id: 'moon',
  name: 'Moon cat',
  note: 'A thinned moon that glows, with a cat and a chimney left solid against it.',
  regions: [
    { depth: 'thin', add: [circle(0.6, 1.4, 5.4, 72)], sub: [cat, roof] },
    { depth: 'cut', add: [star(-5.6, 4.6, 0.9)] },
    { depth: 'cut', add: [star(6.4, 5.0, 0.7)] },
    { depth: 'cut', add: [star(-6.6, 0.6, 0.6)] },
    { depth: 'cut', add: [star(7.0, 0.9, 0.85)] },
    { depth: 'skin', add: [[[-8.6, -2.6], [8.6, -2.3], [8.4, -3.3], [-8.4, -3.6]]] },
  ],
};

// Bats round a thinned crescent moon.
const bat: Pt[] = (() => {
  const right: Pt[] = [
    [0, 0.85],
    [0.2, 0.85],
    [0.36, 1.32],
    [0.52, 0.62],
    [1.4, 0.95],
    [2.35, 1.3],
    [3.15, 1.15],
    [3.5, 0.45],
    [2.85, -0.08],
    [2.45, 0.22],
    [2.05, -0.36],
    [1.62, 0.02],
    [1.18, -0.46],
    [0.72, -0.18],
    [0.32, -0.82],
    [0, -1.0],
  ];
  const left = mirror(right).map(([x, y]) => [x, y] as Pt);
  return [...right, ...left.slice(1, -1)];
})();

const crescent: Region = {
  depth: 'thin',
  add: [circle(3.6, 3.2, 3.0, 56)],
  sub: [circle(4.9, 3.9, 2.65, 56)],
};

const bats: Pattern = {
  id: 'bats',
  name: 'Bats',
  note: 'Three bats cut through, flying past a thinned crescent moon.',
  regions: [
    crescent,
    { depth: 'cut', add: [place(bat, -3.6, 1.6, 1.25, 0.12)] },
    { depth: 'cut', add: [place(bat, 1.6, -3.6, 1.05, -0.18)] },
    { depth: 'cut', add: [place(bat, -6.0, -3.2, 0.7, 0.3)] },
    { depth: 'cut', add: [place(bat, 6.4, -0.4, 0.62, -0.1)] },
  ],
};

export const PATTERNS: Pattern[] = [classic, owl, moonCat, bats];

/** Bounds of a pattern in cm: [minX, minY, maxX, maxY]. */
export function bounds(p: Pattern): [number, number, number, number] {
  let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of p.regions) {
    for (const poly of r.add) {
      for (const [x, y] of poly) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
    }
  }
  return b;
}

const path = (pts: Pt[], s: number, ox: number, oy: number) =>
  'M' + pts.map(([x, y]) => `${(ox + x * s).toFixed(1)} ${(oy - y * s).toFixed(1)}`).join('L') + 'Z';

const FILL: Record<Depth, string> = { cut: '#1b120b', thin: '#ffd27a', skin: '#f6a54a' };
const SKIN = '#d9661c';

/** A small drawing of the pattern on a pumpkin-coloured disc, for its button. */
export function previewSvg(p: Pattern): string {
  const [x0, y0, x1, y1] = bounds(p);
  const s = 74 / Math.max(x1 - x0, y1 - y0);
  const ox = 50 - ((x0 + x1) / 2) * s;
  const oy = 50 + ((y0 + y1) / 2) * s;
  const defs: string[] = [];
  const parts = p.regions.map((r, i) => {
    const add = r.add.map((pts) => path(pts, s, ox, oy)).join('');
    let out = `<path d="${add}" fill="${FILL[r.depth]}"/>`;
    // What a region leaves alone is painted back in skin, clipped to the region so it never covers its neighbours.
    if (r.sub?.length) {
      defs.push(`<clipPath id="jol-${p.id}-${i}"><path d="${add}"/></clipPath>`);
      const sub = r.sub.map((pts) => path(pts, s, ox, oy)).join('');
      out += `<path d="${sub}" fill="${SKIN}" clip-path="url(#jol-${p.id}-${i})"/>`;
    }
    return out;
  });
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>${defs.join('')}</defs><circle cx="50" cy="50" r="49" fill="${SKIN}"/>${parts.join('')}</svg>`;
}
