// The valley round the hive, in metres: x runs east, y runs south, and the hive stands at (0, 0).
// A river comes down from the north into a reservoir west of the hive; farmland fills the valley
// floor, lavender, vines, and olives climb the slopes, and scrub and woods cap the hills.

import { Delaunay } from 'd3-delaunay';
import { between, fbm, makeNoise, mulberry32, pick, weighted, type Rng } from './_rng';

export const EXTENT = 2500;
const GEN = 2900;

export type Pt = readonly [number, number];
export type Ring = Pt[];

export type Use =
  | 'water'
  | 'village'
  | 'garden'
  | 'orchard'
  | 'wheat'
  | 'sunflower'
  | 'maize'
  | 'hay'
  | 'clover'
  | 'pasture'
  | 'fallow'
  | 'lavender'
  | 'vineyard'
  | 'olive'
  | 'garrigue'
  | 'oak'
  | 'chestnut';

export interface Field {
  ring: Ring;
  use: Use;
  centroid: Pt;
  /** Row direction, radians. */
  angle: number;
  /** Where the field's rows are measured from, shared by every cell of one field. */
  origin: Pt;
  /** Cells with the same group and use read as one field. */
  group: number;
  /** -1..1, a nudge to the field's colour. */
  tone: number;
  variant: number;
}

export type TreeKind = 'oak' | 'cypress' | 'plane' | 'olive' | 'fruit' | 'poplar' | 'lime' | 'pine' | 'bale';

export interface Tree {
  x: number;
  y: number;
  r: number;
  h: number;
  kind: TreeKind;
}

export type BuildingKind = 'house' | 'church' | 'tower' | 'barn' | 'hive' | 'pool';

export interface Building {
  x: number;
  y: number;
  /** Along the ridge. */
  w: number;
  d: number;
  a: number;
  h: number;
  kind: BuildingKind;
  tone: number;
}

export interface Road {
  pts: Pt[];
  kind: 'road' | 'lane' | 'street' | 'track';
}

export interface Plant {
  name: string;
  /** Lower-case name for sentences. */
  noun: string;
  quality: number;
  /** Colour of the pollen loads foragers carry home, or null for nectar only. */
  pollen: string | null;
}

export interface Patch {
  id: number;
  plant: Plant;
  ring: Ring;
  center: Pt;
  distance: number;
  bearing: number;
  /** Metres of open water on the straight line from the hive. */
  water: number;
}

export const PLANTS = {
  lavender: { name: 'Lavender', noun: 'lavender', quality: 0.9, pollen: null },
  sunflower: { name: 'Sunflowers', noun: 'sunflowers', quality: 0.7, pollen: '#f0b21c' },
  chestnut: { name: 'Sweet chestnut in flower', noun: 'chestnut flowers', quality: 0.75, pollen: '#e9d46c' },
  clover: { name: 'White clover', noun: 'clover', quality: 0.6, pollen: '#9b6b3d' },
  hay: { name: 'Meadow flowers', noun: 'meadow flowers', quality: 0.5, pollen: '#d8a13b' },
  thyme: { name: 'Wild thyme on the hill', noun: 'wild thyme', quality: 0.65, pollen: null },
  lime: { name: 'Lime trees in the square', noun: 'lime blossom', quality: 1, pollen: '#e4dc8e' },
  bramble: { name: 'Bramble along the river', noun: 'bramble', quality: 0.55, pollen: '#d6d2c2' },
  feeder: { name: "The beekeeper's feeder", noun: 'sugar water', quality: 0.8, pollen: null },
} satisfies Record<string, Plant>;

export interface Land {
  fields: Field[];
  woods: Field[];
  trees: Tree[];
  buildings: Building[];
  roads: Road[];
  river: Pt[];
  riverWidth: (y: number) => number;
  lake: Ring;
  dam: [Pt, Pt];
  square: Pt;
  candidates: Patch[];
  borders: [Pt, Pt][];
  elevation: (x: number, y: number) => number;
  isWater: (x: number, y: number) => boolean;
  waterAlong: (x0: number, y0: number, x1: number, y1: number) => number;
}

// ---------- geometry helpers ----------

export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to a ring, zero inside it. */
export function distToRing(x: number, y: number, ring: Ring): number {
  if (pointInRing(x, y, ring)) return 0;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    best = Math.min(best, segDist(x, y, ring[j][0], ring[j][1], ring[i][0], ring[i][1]));
  }
  return best;
}

function centroid(ring: Ring): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += cross;
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  if (Math.abs(a) < 1e-6) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

/** Shrink a convex ring toward its centroid by a distance in metres. */
function inset(ring: Ring, by: number): Ring {
  const [cx, cy] = centroid(ring);
  return ring.map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy);
    const k = d > by ? (d - by) / d : 0.1;
    return [cx + (x - cx) * k, cy + (y - cy) * k] as Pt;
  });
}

/** Bearing in degrees clockwise from north, for a vector in this map's axes. */
export function bearingOf(dx: number, dy: number): number {
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
}

export function fromBearing(bearing: number, distance: number): Pt {
  const r = (bearing * Math.PI) / 180;
  return [Math.sin(r) * distance, -Math.cos(r) * distance];
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function nearestOnPolyline(x: number, y: number, pts: Pt[]): Pt {
  let best: Pt = pts[0];
  let bd = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < bd) {
      bd = d;
      best = [px, py];
    }
  }
  return best;
}

// ---------- the valley ----------

export function makeLand(seed = 1949): Land {
  const rng = mulberry32(seed);
  const noise = makeNoise(seed + 7);

  const riverX = (y: number) => -1250 + 260 * Math.sin(y / 820 + 0.6) + 90 * Math.sin(y / 310 + 2.1);
  const riverWidth = (y: number) => 22 + 8 * Math.sin(y / 400);
  const river: Pt[] = [];
  for (let y = -GEN; y <= GEN; y += 30) river.push([riverX(y), y]);

  // The reservoir, held back by a straight dam across the valley.
  const damY = 150;
  const lc: Pt = [riverX(-560), -560];
  const lake: Ring = [];
  for (let k = 0; k < 180; k++) {
    const t = (k / 180) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const base = 1 / Math.sqrt((c / 470) ** 2 + (s / 740) ** 2);
    const wob = 1 + 0.16 * noise(c * 1.6 + 11, s * 1.6 + 4) + 0.07 * noise(c * 5 + 2, s * 5 + 9);
    const x = lc[0] + c * base * wob - s * 60;
    const y = Math.min(damY, lc[1] + s * base * wob);
    lake.push([x, y]);
  }
  let damL = Infinity;
  let damR = -Infinity;
  for (const [x, y] of lake) {
    if (y >= damY - 0.01) {
      damL = Math.min(damL, x);
      damR = Math.max(damR, x);
    }
  }
  const dam: [Pt, Pt] = [
    [damL, damY],
    [damR, damY],
  ];

  const isWater = (x: number, y: number) => {
    if (pointInRing(x, y, lake)) return true;
    return Math.abs(x - riverX(y)) < riverWidth(y) / 2;
  };
  const waterAlong = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len / 8));
    let wet = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      if (isWater(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) wet++;
    }
    return (wet / steps) * len;
  };

  const elevation = (x: number, y: number) => {
    const d = x - riverX(y);
    let e = d >= 0 ? smoothstep(900, 3400, d) : 1.25 * smoothstep(150, 1100, -d);
    e += 0.55 * Math.exp(-((x - 2100) ** 2 + (y + 2000) ** 2) / 900 ** 2);
    e += 0.45 * Math.exp(-((x - 2200) ** 2 + (y - 2100) ** 2) / 800 ** 2);
    e += 0.16 * fbm(noise, x / 900 + 3, y / 900 - 2);
    return Math.max(0, e);
  };

  const square: Pt = [930, 520];

  // Fields: Voronoi cells over a jittered grid, gathered into larger farm parcels that mostly share one crop.
  const seeds: [number, number][] = [];
  const spacing = 205;
  for (let gy = -GEN; gy <= GEN; gy += spacing) {
    for (let gx = -GEN; gx <= GEN; gx += spacing) {
      seeds.push([gx + between(rng, -78, 78), gy + between(rng, -78, 78)]);
    }
  }
  const delaunay = Delaunay.from(seeds);
  const voronoi = delaunay.voronoi([-GEN, -GEN, GEN, GEN]);
  const hiveCell = delaunay.find(0, 0);

  const parcelSeeds: [number, number][] = [];
  for (let gy = -GEN; gy <= GEN; gy += 470) {
    for (let gx = -GEN; gx <= GEN; gx += 470) {
      parcelSeeds.push([gx + between(rng, -170, 170), gy + between(rng, -170, 170)]);
    }
  }
  const parcels = Delaunay.from(parcelSeeds);
  const valley = [
    ['sunflower', 26],
    ['wheat', 28],
    ['maize', 9],
    ['hay', 12],
    ['clover', 7],
    ['pasture', 8],
    ['fallow', 4],
    ['lavender', 6],
  ] as const;
  const slope = [
    ['lavender', 34],
    ['vineyard', 30],
    ['olive', 16],
    ['wheat', 8],
    ['hay', 6],
    ['garrigue', 6],
  ] as const;
  const zoneUse = (x: number, y: number, r: Rng): Use => {
    const e = elevation(x, y);
    if (e < 0.3) return weighted(r, valley);
    if (e < 0.64) return weighted(r, slope);
    return weighted(r, [
      ['garrigue', 40],
      ['oak', 26],
      ['chestnut', y < 300 ? 22 : 8],
      ['lavender', 12],
    ] as const);
  };
  const parcelUse = parcelSeeds.map(([x, y]) => zoneUse(x, y, rng));
  const parcelAngle = parcelSeeds.map(() => between(rng, 0, Math.PI));

  const fields: Field[] = [];
  const woods: Field[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const poly = voronoi.cellPolygon(i);
    if (!poly) continue;
    const ring: Ring = poly.slice(0, -1).map(([x, y]) => [x, y] as Pt);
    const c = centroid(ring);
    let use: Use;
    let group = 100000 + i;
    let angle = between(rng, 0, Math.PI);
    let origin: Pt = c;
    const dv = Math.hypot(c[0] - square[0], c[1] - square[1]);
    if (pointInRing(c[0], c[1], lake)) use = 'water';
    else if (i === hiveCell) use = 'orchard';
    else if (dv < 250) use = 'village';
    else if (dv < 400)
      use = weighted(rng, [
        ['garden', 3],
        ['olive', 2],
        ['pasture', 1],
        ['hay', 1],
      ] as const);
    else {
      const p = parcels.find(c[0], c[1]);
      const hilly = elevation(c[0], c[1]) > 0.64;
      if (rng() < (hilly ? 0.9 : 0.86)) {
        use = parcelUse[p];
        group = p;
        angle = parcelAngle[p];
        origin = parcelSeeds[p];
      } else {
        use = zoneUse(c[0], c[1], rng);
      }
    }
    const field: Field = {
      ring,
      use,
      centroid: c,
      angle,
      origin,
      group,
      tone: between(rng, -1, 1),
      variant: group < 100000 ? group % 3 : Math.floor(rng() * 3),
    };
    if (use === 'oak' || use === 'chestnut') woods.push(field);
    fields.push(field);
  }

  // Rows on slopes tend to run along the contour: lean each parcel's rows that way.
  for (const f of fields) {
    if (f.use !== 'lavender' && f.use !== 'vineyard' && f.use !== 'olive') continue;
    const [x, y] = f.origin;
    const gx = elevation(x + 30, y) - elevation(x - 30, y);
    const gy = elevation(x, y + 30) - elevation(x, y - 30);
    const jitter = ((f.group * 2654435761) % 1000) / 1000 - 0.5;
    f.angle = Math.atan2(gx, -gy) + jitter * 0.6;
  }

  // Field boundaries: only where neighbouring cells belong to different fields.
  const edgeOwner = new Map<string, number>();
  const borders: [Pt, Pt][] = [];
  const keyOf = (p: Pt) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  fields.forEach((f, fi) => {
    for (let i = 0; i < f.ring.length; i++) {
      const a = f.ring[i];
      const b = f.ring[(i + 1) % f.ring.length];
      const other = edgeOwner.get(`${keyOf(b)}|${keyOf(a)}`);
      if (other === undefined) {
        edgeOwner.set(`${keyOf(a)}|${keyOf(b)}`, fi);
        continue;
      }
      const g = fields[other];
      if (g.use === 'water' || f.use === 'water') continue;
      if (g.group !== f.group || g.use !== f.use) borders.push([a, b]);
    }
  });

  const trees: Tree[] = [];
  const buildings: Building[] = [];
  const roads: Road[] = [];
  const free = (cand: { x: number; y: number; w: number; d: number; a: number }, pad = 1) => {
    if (isWater(cand.x, cand.y)) return false;
    const r = Math.hypot(cand.w, cand.d) / 2;
    for (const b of buildings) {
      if (Math.hypot(b.x - cand.x, b.y - cand.y) > r + Math.hypot(b.w, b.d) / 2 + pad) continue;
      if (rectsOverlap(cand, b, pad)) return false;
    }
    return true;
  };

  // Roads first, so trees and houses can line them.
  const mainRoad: Pt[] = [];
  for (let y = -GEN; y <= GEN; y += 60) mainRoad.push([600 + 130 * Math.sin(y / 950 + 1) + 40 * Math.sin(y / 300), y]);
  roads.push({ pts: mainRoad, kind: 'road' });

  const junction = nearestOnPolyline(square[0] - 40, square[1], mainRoad);
  roads.push({ pts: curve(junction, [square[0] - 50, square[1]], 0.1, rng), kind: 'road' });
  roads.push({ pts: curve([square[0] + 50, square[1]], [GEN, 260], 0.2, rng), kind: 'road' });

  const hiveJunction = nearestOnPolyline(0, -40, mainRoad);
  roads.push({ pts: curve(hiveJunction, [40, -30], 0.1, rng), kind: 'track' });

  // Over the dam, then north along the reservoir's western shore and west into the hills.
  const damRoadStart = nearestOnPolyline(dam[1][0] + 300, damY + 220, mainRoad);
  const damRoad: Pt[] = [
    ...curve(damRoadStart, [dam[1][0] + 30, damY + 18], 0.12, rng),
    [dam[0][0] - 30, damY + 18],
    ...curve([dam[0][0] - 30, damY + 18], [-GEN, -700], 0.25, rng).slice(1),
  ];
  roads.push({ pts: damRoad, kind: 'road' });
  const shore: Pt[] = [[dam[0][0] - 40, damY + 10]];
  let shoreX = dam[0][0] - 60;
  for (let y = damY - 40; y >= -GEN; y -= 40) {
    let minX = Infinity;
    for (const [px, py] of lake) if (Math.abs(py - y) < 40) minX = Math.min(minX, px);
    const want = Number.isFinite(minX) ? minX - 70 : riverX(y) - 380;
    shoreX += (want - shoreX) * 0.6;
    shore.push([shoreX, y]);
  }
  roads.push({ pts: shore, kind: 'lane' });

  // The village: an open square with a church, and streets running out from it lined with houses.
  const churchA = 0.12;
  const church = { x: square[0] + 18, y: square[1] - 70, w: 34, d: 15, a: churchA };
  buildings.push({ ...church, h: 16, kind: 'church', tone: 0 });
  buildings.push({
    x: church.x + Math.cos(churchA) * 21,
    y: church.y + Math.sin(churchA) * 21,
    w: 8,
    d: 8,
    a: churchA,
    h: 28,
    kind: 'tower',
    tone: 0,
  });
  const streets: Pt[][] = [];
  const nStreets = 6;
  for (let k = 0; k < nStreets; k++) {
    const a = (k / nStreets) * Math.PI * 2 + between(rng, -0.22, 0.22) + 0.35;
    const len = between(rng, 210, 330);
    const startPt: Pt = [square[0] + Math.cos(a) * 46, square[1] + Math.sin(a) * 42];
    const endPt: Pt = [square[0] + Math.cos(a) * len, square[1] + Math.sin(a) * len];
    streets.push(curve(startPt, endPt, 0.1, rng));
  }
  const ringLane: Pt[] = [];
  for (let k = 0; k <= 48; k++) {
    const t = (k / 48) * Math.PI * 2;
    const r = 128 + 16 * noise(Math.cos(t) * 2 + 30, Math.sin(t) * 2 + 30);
    ringLane.push([square[0] + Math.cos(t) * r, square[1] + Math.sin(t) * r * 0.9]);
  }
  streets.push(ringLane);
  const squareEdge: Pt[] = [];
  for (let k = 0; k <= 24; k++) {
    const t = (k / 24) * Math.PI * 2;
    squareEdge.push([square[0] + Math.cos(t) * 46, square[1] + Math.sin(t) * 42]);
  }
  streets.push(squareEdge);
  for (const st of streets) roads.push({ pts: st, kind: 'street' });
  for (const st of streets) {
    for (let i = 1; i < st.length; i++) {
      const [ax, ay] = st[i - 1];
      const [bx, by] = st[i];
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const nx = -uy;
      const ny = ux;
      const a = Math.atan2(uy, ux);
      for (const side of [-1, 1]) {
        let t = between(rng, 0, 4);
        while (t < len) {
          const w = between(rng, 13, 21);
          const d = between(rng, 13, 17);
          const off = 6 + d / 2;
          const x = ax + ux * (t + w / 2) + nx * side * off;
          const y = ay + uy * (t + w / 2) + ny * side * off;
          const dist = Math.hypot(x - square[0], y - square[1]);
          const p = dist < 170 ? 0.96 : dist < 260 ? 0.72 : 0.38;
          const house = { x, y, w, d, a, h: between(rng, 7, 11), kind: 'house' as const, tone: between(rng, -1, 1) };
          if (rng() < p && dist > 55 && free(house, 0.6)) {
            buildings.push(house);
            if (dist < 200 && rng() < 0.7) {
              const d2 = between(rng, 12, 16);
              const back = { ...house, d: d2, w: house.w * between(rng, 0.7, 1.1), h: house.h - 1 };
              back.x = x + nx * side * (d / 2 + d2 / 2 + 1);
              back.y = y + ny * side * (d / 2 + d2 / 2 + 1);
              if (free(back, 0.6)) buildings.push(back);
            }
            if (rng() < 0.22) {
              const gx = x + nx * side * (d / 2 + 9);
              const gy = y + ny * side * (d / 2 + 9);
              trees.push({ x: gx, y: gy, r: between(rng, 4, 6), h: 7, kind: 'fruit' });
            }
          }
          t += w + (rng() < 0.12 ? between(rng, 6, 16) : 0.5);
        }
      }
    }
  }
  for (let k = 0; k < 8; k++) {
    const t = (k / 8) * Math.PI * 2 + 0.3;
    trees.push({
      x: square[0] + Math.cos(t) * 34,
      y: square[1] + Math.sin(t) * 30,
      r: 7.5,
      h: 13,
      kind: 'lime',
    });
  }

  // Farmsteads with a track out to the nearest road.
  const farmSpots = fields.filter(
    (f) =>
      ['sunflower', 'wheat', 'hay', 'lavender', 'vineyard', 'pasture', 'olive'].includes(f.use) &&
      Math.hypot(f.centroid[0], f.centroid[1]) > 320 &&
      Math.hypot(f.centroid[0] - square[0], f.centroid[1] - square[1]) > 520 &&
      Math.abs(f.centroid[0]) < GEN - 200 &&
      Math.abs(f.centroid[1]) < GEN - 200,
  );
  let farms = 0;
  for (let tries = 0; tries < 400 && farms < 16; tries++) {
    const f = pick(rng, farmSpots);
    const [cx, cy] = f.centroid;
    if (isWater(cx, cy) || distToWaterEdge(cx, cy) < 80) continue;
    if (buildings.some((b) => b.kind === 'house' && Math.hypot(b.x - cx, b.y - cy) < 380)) continue;
    const a = between(rng, 0, Math.PI);
    buildings.push({ x: cx, y: cy, w: 20, d: 10, a, h: 9, kind: 'house', tone: between(rng, -1, 1) });
    const bx = cx + Math.cos(a) * 9 - Math.sin(a) * 18;
    const by = cy + Math.sin(a) * 9 + Math.cos(a) * 18;
    buildings.push({ x: bx, y: by, w: 22, d: 12, a: a + Math.PI / 2, h: 8, kind: 'barn', tone: between(rng, -1, 1) });
    if (rng() < 0.55) {
      const px = cx - Math.cos(a) * 4 + Math.sin(a) * 16;
      const py = cy - Math.sin(a) * 4 - Math.cos(a) * 16;
      buildings.push({ x: px, y: py, w: 9, d: 4.5, a, h: 0, kind: 'pool', tone: 0 });
    }
    trees.push({ x: cx - Math.cos(a) * 18, y: cy - Math.sin(a) * 18, r: 8, h: 15, kind: 'plane' });
    trees.push({ x: cx + Math.cos(a) * 16 + Math.sin(a) * 6, y: cy + Math.sin(a) * 16, r: 7, h: 14, kind: 'plane' });
    let bestRoad: Pt = [cx, cy];
    let bd = Infinity;
    for (const road of roads) {
      if (road.kind === 'track') continue;
      const p = nearestOnPolyline(cx, cy, road.pts);
      const d = Math.hypot(p[0] - cx, p[1] - cy);
      if (d < bd) {
        bd = d;
        bestRoad = p;
      }
    }
    if (bd < 900) roads.push({ pts: [[cx, cy], bestRoad], kind: 'track' });
    farms++;
  }

  function distToWaterEdge(x: number, y: number): number {
    const lakeD = distToRing(x, y, lake);
    const riverD = Math.abs(x - riverX(y)) - riverWidth(y) / 2;
    return Math.min(lakeD, Math.max(0, riverD));
  }

  // The apiary: an old orchard with a row of white hives.
  const orchard = fields[fields.findIndex((f) => f.use === 'orchard')];
  if (orchard) {
    for (let gy = -110; gy <= 110; gy += 17) {
      for (let gx = -110; gx <= 110; gx += 17) {
        const x = gx + between(rng, -2, 2);
        const y = gy + between(rng, -2, 2);
        if (Math.hypot(x, y) < 26) continue;
        if (!pointInRing(x, y, inset(orchard.ring, 8))) continue;
        trees.push({ x, y, r: between(rng, 4.5, 6), h: 5, kind: 'fruit' });
      }
    }
  }
  for (let k = 0; k < 6; k++) {
    buildings.push({ x: -17.5 + k * 7, y: 4, w: 4.6, d: 4.2, a: 0, h: 1.2, kind: 'hive', tone: 0 });
  }

  // Trees: olive groves, windbreaks of cypress, hedgerow oaks, river poplars, field oaks, hay bales.
  const edgeSeen = new Set<string>();
  for (const f of fields) {
    if (f.use === 'olive') {
      const ring = inset(f.ring, 9);
      const ca = Math.cos(f.angle);
      const sa = Math.sin(f.angle);
      for (let v = -200; v <= 200; v += 19) {
        for (let u = -200; u <= 200; u += 19) {
          const x = f.centroid[0] + u * ca - v * sa;
          const y = f.centroid[1] + u * sa + v * ca;
          if (pointInRing(x, y, ring) && !isWater(x, y)) {
            trees.push({ x, y, r: between(rng, 4.6, 6.2), h: 5.5, kind: 'olive' });
          }
        }
      }
    }
    if (f.use === 'wheat' && rng() < 0.65) {
      const ca = Math.cos(f.angle);
      const sa = Math.sin(f.angle);
      const ring = inset(f.ring, 14);
      for (let v = -120; v <= 120; v += 34) {
        for (let u = -150; u <= 150; u += between(rng, 18, 40)) {
          const x = f.centroid[0] + u * ca - v * sa;
          const y = f.centroid[1] + u * sa + v * ca;
          if (rng() < 0.45 && pointInRing(x, y, ring)) trees.push({ x, y, r: 3.4, h: 1.6, kind: 'bale' });
        }
      }
    }
    if (['wheat', 'hay', 'pasture', 'sunflower', 'clover', 'fallow'].includes(f.use) && rng() < 0.28) {
      const ring = inset(f.ring, 20);
      const [cx, cy] = f.centroid;
      const x = cx + between(rng, -50, 50);
      const y = cy + between(rng, -50, 50);
      if (pointInRing(x, y, ring) && !isWater(x, y)) trees.push({ x, y, r: between(rng, 8, 11), h: 12, kind: 'oak' });
    }
    if (f.use === 'garrigue') {
      const ring = inset(f.ring, 6);
      for (let n = 0; n < 9; n++) {
        const x = f.centroid[0] + between(rng, -110, 110);
        const y = f.centroid[1] + between(rng, -110, 110);
        if (pointInRing(x, y, ring) && !isWater(x, y)) trees.push({ x, y, r: between(rng, 5, 7.5), h: 10, kind: 'pine' });
      }
    }
    const farmland = ['sunflower', 'wheat', 'maize', 'hay', 'clover', 'pasture', 'fallow', 'lavender', 'vineyard'];
    if (!farmland.includes(f.use)) continue;
    for (let i = 0; i < f.ring.length; i++) {
      const [ax, ay] = f.ring[i];
      const [bx, by] = f.ring[(i + 1) % f.ring.length];
      const key = [ax, ay, bx, by].map((v) => Math.round(v)).join(',');
      const rev = [bx, by, ax, ay].map((v) => Math.round(v)).join(',');
      if (edgeSeen.has(key) || edgeSeen.has(rev)) continue;
      edgeSeen.add(key);
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 50) continue;
      const eastWest = Math.abs(by - ay) < Math.abs(bx - ax) * 0.55;
      const roll = rng();
      if (eastWest && roll < 0.42) {
        for (let t = 6; t < len - 6; t += 8.5) {
          const x = ax + ((bx - ax) * t) / len;
          const y = ay + ((by - ay) * t) / len;
          if (!isWater(x, y)) trees.push({ x, y, r: between(rng, 2.6, 3.3), h: between(rng, 13, 17), kind: 'cypress' });
        }
      } else if (roll < 0.2) {
        for (let t = between(rng, 5, 30); t < len - 5; t += between(rng, 18, 48)) {
          const x = ax + ((bx - ax) * t) / len;
          const y = ay + ((by - ay) * t) / len;
          if (!isWater(x, y)) trees.push({ x, y, r: between(rng, 5.5, 8), h: 10, kind: 'oak' });
        }
      }
    }
  }

  // Poplars and planes along both banks below the dam, and pines round the lake.
  for (let y = -GEN; y <= GEN; y += between(rng, 12, 22)) {
    if (y < damY + 30 && y > lc[1] - 900) continue;
    const x = riverX(y);
    const w = riverWidth(y) / 2;
    for (const side of [-1, 1]) {
      if (rng() < 0.18) continue;
      const tx = x + side * (w + between(rng, 7, 14));
      const kind: TreeKind = rng() < 0.55 ? 'poplar' : 'plane';
      trees.push({ x: tx, y: y + between(rng, -4, 4), r: kind === 'poplar' ? 4.6 : 7.5, h: kind === 'poplar' ? 22 : 16, kind });
    }
  }
  for (let k = 0; k < lake.length; k += 1) {
    if (rng() > 0.45) continue;
    const [x, y] = lake[k];
    if (y > damY - 5) continue;
    const [cx, cy] = lc;
    const d = Math.hypot(x - cx, y - cy);
    const ox = x + ((x - cx) / d) * between(rng, 14, 40);
    const oy = y + ((y - cy) / d) * between(rng, 14, 40);
    if (!isWater(ox, oy)) trees.push({ x: ox, y: oy, r: between(rng, 5, 7), h: 11, kind: rng() < 0.6 ? 'pine' : 'oak' });
  }

  // Plane trees along the main road where it passes the village.
  for (let i = 1; i < mainRoad.length; i++) {
    const [ax, ay] = mainRoad[i - 1];
    const [bx, by] = mainRoad[i];
    if (ay < -900 || ay > 1500) continue;
    const len = Math.hypot(bx - ax, by - ay);
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    for (let t = 0; t < len; t += 21) {
      for (const side of [-1, 1]) {
        trees.push({ x: ax + ((bx - ax) * t) / len + nx * side * 10, y: ay + ((by - ay) * t) / len + ny * side * 10, r: 7, h: 16, kind: 'plane' });
      }
    }
  }

  // Keep trees off roofs and out of the water.
  const keptTrees = trees.filter((t) => {
    if (t.kind !== 'lime' && isWater(t.x, t.y)) return false;
    for (const b of buildings) {
      if (b.kind === 'hive') continue;
      if (Math.hypot(b.x - t.x, b.y - t.y) < Math.max(b.w, b.d) / 2 + t.r * 0.6) return false;
    }
    return true;
  });

  // Flower patches a forager could dance for.
  const candidates: Patch[] = [];
  const addPatch = (plant: Plant, ring: Ring, center?: Pt) => {
    const c = center ?? centroid(ring);
    const distance = Math.hypot(c[0], c[1]);
    if (distance < 280 || distance > 2350) return;
    if (Math.abs(c[0]) > EXTENT - 120 || Math.abs(c[1]) > EXTENT - 120) return;
    if (ringArea(ring) < 6000 && plant !== PLANTS.lime) return;
    candidates.push({
      id: candidates.length,
      plant,
      ring,
      center: c,
      distance,
      bearing: bearingOf(c[0], c[1]),
      water: waterAlong(0, 0, c[0], c[1]),
    });
  };
  for (const f of fields) {
    const plant =
      f.use === 'lavender'
        ? PLANTS.lavender
        : f.use === 'sunflower'
          ? PLANTS.sunflower
          : f.use === 'chestnut'
            ? PLANTS.chestnut
            : f.use === 'clover'
              ? PLANTS.clover
              : f.use === 'hay'
                ? PLANTS.hay
                : f.use === 'garrigue'
                  ? PLANTS.thyme
                  : null;
    if (plant) addPatch(plant, f.ring);
  }
  const squareRing: Ring = [];
  for (let k = 0; k < 24; k++) {
    const t = (k / 24) * Math.PI * 2;
    squareRing.push([square[0] + Math.cos(t) * 50, square[1] + Math.sin(t) * 45]);
  }
  addPatch(PLANTS.lime, squareRing, square);
  for (const y0 of [damY + 260, 900, 1500, -1700, -2200]) {
    const ring: Ring = [];
    const y1 = y0 + 300;
    for (let y = y0; y <= y1; y += 30) ring.push([riverX(y) + riverWidth(y) / 2 + 4, y]);
    for (let y = y1; y >= y0; y -= 30) ring.push([riverX(y) + riverWidth(y) / 2 + 48, y]);
    addPatch(PLANTS.bramble, ring);
  }

  return {
    fields,
    woods,
    trees: keptTrees,
    buildings,
    roads,
    river,
    riverWidth,
    lake,
    dam,
    square,
    candidates,
    borders,
    elevation,
    isWater,
    waterAlong,
  };
}

type RectLike = { x: number; y: number; w: number; d: number; a: number };

function corners(b: RectLike): Pt[] {
  const ca = Math.cos(b.a);
  const sa = Math.sin(b.a);
  const hw = b.w / 2;
  const hd = b.d / 2;
  return [
    [b.x - ca * hw + sa * hd, b.y - sa * hw - ca * hd],
    [b.x + ca * hw + sa * hd, b.y + sa * hw - ca * hd],
    [b.x + ca * hw - sa * hd, b.y + sa * hw + ca * hd],
    [b.x - ca * hw - sa * hd, b.y - sa * hw + ca * hd],
  ];
}

/** Separating-axis test for two rotated rectangles, with a gap they must keep. */
function rectsOverlap(p: RectLike, q: RectLike, pad: number): boolean {
  const pc = corners(p);
  const qc = corners(q);
  for (const a of [p.a, p.a + Math.PI / 2, q.a, q.a + Math.PI / 2]) {
    const ax = Math.cos(a);
    const ay = Math.sin(a);
    let p0 = Infinity;
    let p1 = -Infinity;
    let q0 = Infinity;
    let q1 = -Infinity;
    for (const [x, y] of pc) {
      const v = x * ax + y * ay;
      p0 = Math.min(p0, v);
      p1 = Math.max(p1, v);
    }
    for (const [x, y] of qc) {
      const v = x * ax + y * ay;
      q0 = Math.min(q0, v);
      q1 = Math.max(q1, v);
    }
    if (p1 + pad <= q0 || q1 + pad <= p0) return false;
  }
  return true;
}

/** A gently bowed road between two points. */
function curve(a: Pt, b: Pt, bow: number, rng: Rng): Pt[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const k = bow * between(rng, -1, 1) * len;
  const k2 = 0.35 * bow * between(rng, -1, 1) * len;
  const pts: Pt[] = [];
  const n = Math.max(2, Math.ceil(len / 40));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = Math.sin(Math.PI * t) * k + Math.sin(2 * Math.PI * t) * k2;
    pts.push([a[0] + dx * t + nx * off, a[1] + dy * t + ny * off]);
  }
  return pts;
}

/** Pick the day's flowering patches: spread round the hive, and at least one across the lake. */
export function chooseDay(land: Land, day: number): Patch[] {
  const rng = mulberry32(9001 + day * 7919);
  const pool = land.candidates.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen: Patch[] = [];
  const ok = (p: Patch) =>
    chosen.every(
      (q) =>
        Math.hypot(p.center[0] - q.center[0], p.center[1] - q.center[1]) > 380 &&
        (q.plant !== p.plant || p.plant === PLANTS.lavender || rng() < 0.4),
    );
  const lime = pool.find((p) => p.plant === PLANTS.lime);
  if (lime && day % 2 === 1) chosen.push(lime);
  const wet = pool.filter((p) => p.water > 250 && p.distance > 1300);
  if (wet.length) chosen.push(wet[0]);
  for (const p of pool) {
    if (chosen.length >= 10) break;
    if (chosen.includes(p) || !ok(p)) continue;
    chosen.push(p);
  }
  return chosen;
}
