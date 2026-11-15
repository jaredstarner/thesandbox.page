// The night's ground plan: a lane between hedgerows at the edge of a village,
// a barn with smooth walls, an orchard, field trees, a pond with reeds, a row
// of poplars, and the wood beyond. Everything is in metres, y pointing south.
//
// Soft things that scatter sound (leaves, reeds, trunks) go into a 10 cm grid.
// Smooth walls are kept as segments, because they reflect like mirrors and need
// their exact normals. Water is a mask: it sends a call away and returns nothing.

export const WORLD_W = 120;
export const WORLD_H = 80;
export const CELL = 0.1;
export const GW = Math.round(WORLD_W / CELL);
export const GH = Math.round(WORLD_H / CELL);

export const MAT_EMPTY = 0;
export const MAT_LEAF = 1;
export const MAT_TRUNK = 2;
export const MAT_REED = 3;

export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Outward unit normal. */
  nx: number;
  ny: number;
  /** Specular strength: how much of a call it sends back square on. */
  gloss: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Pond {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
}

export interface World {
  /** Material per cell. */
  mat: Uint8Array;
  /** Leaf (or reed) density per cell, 0 to 255: the chance a step through it meets one. */
  dens: Uint8Array;
  /** 1 where there is open water. */
  water: Uint8Array;
  /** Signed distance to the edge of foliage, in metres: negative inside. */
  leafSd: Float32Array;
  walls: Wall[];
  /** Building corners: they send some sound back from any direction. */
  corners: Point[];
  /** Thin solid posts (the lamp standard), radius in metres. */
  posts: (Point & { r: number })[];
  barn: Point[];
  lane: (x: number) => number;
  lamp: Point & { r: number };
  roost: Point;
  /** Direction the bat leaves the roost. */
  roostHeading: number;
  pond: Pond;
  /** Where midges dance at dusk. */
  swarms: Point[];
  /** Where crickets sing. */
  crickets: Point[];
}

/** Small deterministic generator, so the village is the same every night. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash to [0, 1). */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [-1, 1]. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) * 2 - 1;
}

export function fbm(x: number, y: number): number {
  return noise2(x, y) * 0.6 + noise2(x * 2.1 + 17, y * 2.1 - 9) * 0.28 + noise2(x * 4.3 - 31, y * 4.3 + 5) * 0.12;
}

export function cellIndex(x: number, y: number): number {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return -1;
  return cy * GW + cx;
}

export function pondK(p: Pond, x: number, y: number): number {
  const dx = x - p.cx;
  const dy = y - p.cy;
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const u = (dx * c + dy * s) / p.rx;
  const v = (-dx * s + dy * c) / p.ry;
  const a = Math.atan2(v, u);
  const wobble = 1 + 0.07 * Math.sin(3 * a + 0.6) + 0.045 * Math.sin(5 * a + 2.1) + 0.03 * Math.sin(8 * a);
  return Math.hypot(u, v) / wobble;
}

/** How thick the reeds stand at a point, 0 to 1. They grow in beds round about two thirds of the bank. */
export function reedAt(p: Pond, x: number, y: number): number {
  const k = pondK(p, x, y);
  if (k < 1 || k > 1.16) return 0;
  const a = Math.atan2(y - p.cy, x - p.cx);
  const bed = Math.sin(a * 2 + 0.9) + 0.5 * Math.sin(a * 5) + 0.35 * fbm(x * 0.6, y * 0.6);
  if (bed <= -0.35) return 0;
  return Math.min(1, (bed + 0.35) * 2) * Math.min(1, (k - 1) / 0.025, (1.16 - k) / 0.04);
}

export function buildWorld(): World {
  const mat = new Uint8Array(GW * GH);
  const dens = new Uint8Array(GW * GH);
  const water = new Uint8Array(GW * GH);
  const rand = mulberry(1907);

  const setLeaf = (i: number, m: number, base: number, spread: number) => {
    if (mat[i] === MAT_TRUNK) return;
    mat[i] = m;
    dens[i] = Math.min(255, Math.round(base + hash2(i, 77) * spread));
  };

  const lane = (x: number) => 46 + 1.3 * Math.sin(x * 0.045 + 0.4) + 0.5 * Math.sin(x * 0.13);

  // A canopy: lobed, ragged at the edge, with a trunk at its heart.
  const canopy = (cx: number, cy: number, r: number, lobes: number, seed: number) => {
    const ph = seed * 1.7;
    const x0 = Math.max(0, Math.floor((cx - r * 1.4) / CELL));
    const x1 = Math.min(GW - 1, Math.ceil((cx + r * 1.4) / CELL));
    const y0 = Math.max(0, Math.floor((cy - r * 1.4) / CELL));
    const y1 = Math.min(GH - 1, Math.ceil((cy + r * 1.4) / CELL));
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const x = (gx + 0.5) * CELL;
        const y = (gy + 0.5) * CELL;
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const edge =
          r *
            (1 +
              0.11 * Math.sin(lobes * a + ph) +
              0.07 * Math.sin((lobes + 3) * a - ph * 0.5) +
              0.06 * noise2(Math.cos(a) * 2 + seed, Math.sin(a) * 2 - seed)) +
          0.45 * fbm(x * 0.9 + seed * 3, y * 0.9);
        const i = gy * GW + gx;
        if (d < Math.max(0.3, r * 0.06)) {
          mat[i] = MAT_TRUNK;
          dens[i] = 255;
        } else if (d < edge) {
          setLeaf(i, MAT_LEAF, 95, 120);
        }
      }
    }
  };

  // A hedge laid along y = f(x), with gaps for gates.
  const hedge = (f: (x: number) => number, half: number, gaps: [number, number][], seed: number) => {
    for (let gx = 0; gx < GW; gx++) {
      const x = (gx + 0.5) * CELL;
      if (gaps.some(([a, b]) => x > a && x < b)) continue;
      const yc = f(x);
      const w = half * (1 + 0.28 * fbm(x * 0.35 + seed, seed)) + 0.15 * noise2(x * 2.3, seed * 5);
      const y0 = Math.max(0, Math.floor((yc - w * 1.6) / CELL));
      const y1 = Math.min(GH - 1, Math.ceil((yc + w * 1.6) / CELL));
      for (let gy = y0; gy <= y1; gy++) {
        const y = (gy + 0.5) * CELL;
        const rough = 0.22 * fbm(x * 1.4 + seed * 2, y * 1.4);
        if (Math.abs(y - yc) < w + rough) setLeaf(gy * GW + gx, MAT_LEAF, 120, 110);
      }
    }
  };

  // The wood along the north edge.
  for (let gx = 0; gx < GW; gx++) {
    const x = (gx + 0.5) * CELL;
    const edge = 8.5 + 2.6 * fbm(x * 0.07, 3.3) + 1.6 * Math.sin(x * 0.031 + 1);
    for (let gy = 0; gy < GH; gy++) {
      const y = (gy + 0.5) * CELL;
      const e = edge + 0.5 * fbm(x * 0.8, y * 0.8);
      if (y < e) setLeaf(gy * GW + gx, MAT_LEAF, 130, 110);
      else break;
    }
  }

  // Hedgerows either side of the lane, and the field boundary to the south.
  hedge(
    (x) => lane(x) - 3.1,
    0.85,
    [
      [37.5, 42],
      [76, 79.5],
    ],
    11,
  );
  hedge(
    (x) => lane(x) + 3.1,
    0.85,
    [
      [55.5, 64],
      [83, 87.5],
    ],
    23,
  );
  hedge((x) => 77.6 + 0.7 * Math.sin(x * 0.07), 0.95, [[28, 31]], 41);

  // Field trees north of the lane.
  canopy(68, 27, 6.4, 7, 1);
  canopy(46.5, 21.5, 4.6, 6, 2);
  canopy(93, 19.5, 5.2, 8, 3);
  canopy(28, 28.5, 2.6, 5, 4);
  canopy(104.5, 34, 3.4, 6, 5);
  canopy(14, 22, 3.0, 6, 6);

  // The orchard behind the barn.
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const jitter = rand() * 0.8 - 0.4;
      canopy(42.5 + i * 6 + jitter, 58.5 + j * 5.4 + rand() * 0.6, 1.65 + rand() * 0.3, 5, 10 + i * 3 + j);
    }
  }

  // Poplars along the east edge.
  for (let k = 0; k < 6; k++) canopy(113 + rand() * 0.8, 52 + k * 4.3, 1.5 + rand() * 0.25, 5, 30 + k);

  // The pond, its reeds, and the water.
  const pond: Pond = { cx: 87, cy: 64.5, rx: 8.8, ry: 5.6, rot: 0.24 };
  for (let gy = 0; gy < GH; gy++) {
    const y = (gy + 0.5) * CELL;
    if (Math.abs(y - pond.cy) > 12) continue;
    for (let gx = 0; gx < GW; gx++) {
      const x = (gx + 0.5) * CELL;
      if (Math.abs(x - pond.cx) > 13) continue;
      const k = pondK(pond, x, y);
      const i = gy * GW + gx;
      if (k < 1) {
        water[i] = 1;
        mat[i] = MAT_EMPTY;
        dens[i] = 0;
      } else if (reedAt(pond, x, y) > 0) {
        setLeaf(i, MAT_REED, 60, 80);
      }
    }
  }

  // The barn: a long rectangle of smooth rendered walls, turned a little off square.
  const bc = { x: 26, y: 61.5 };
  const bw = 16;
  const bh = 8.6;
  const rot = -0.12;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const corner = (u: number, v: number): Point => ({ x: bc.x + u * cr - v * sr, y: bc.y + u * sr + v * cr });
  const barn = [corner(-bw / 2, -bh / 2), corner(bw / 2, -bh / 2), corner(bw / 2, bh / 2), corner(-bw / 2, bh / 2)];
  const walls: Wall[] = [];
  const addWall = (a: Point, b: Point, gloss: number, flip = false) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let nx = dy / len;
    let ny = -dx / len;
    if (flip) {
      nx = -nx;
      ny = -ny;
    }
    walls.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, nx, ny, gloss });
  };
  for (let k = 0; k < 4; k++) addWall(barn[k], barn[(k + 1) % 4], 0.95);
  // Clear any foliage that strayed inside the barn.
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = (gx + 0.5) * CELL;
      const y = (gy + 0.5) * CELL;
      if (Math.abs(x - bc.x) > 12 || Math.abs(y - bc.y) > 9) continue;
      const u = (x - bc.x) * cr + (y - bc.y) * sr;
      const v = -(x - bc.x) * sr + (y - bc.y) * cr;
      if (Math.abs(u) < bw / 2 + 0.6 && Math.abs(v) < bh / 2 + 0.6) {
        const i = gy * GW + gx;
        mat[i] = MAT_EMPTY;
        dens[i] = 0;
      }
    }
  }

  // A garden wall of dressed stone, smooth on both faces.
  const gwA = { x: 37, y: 73.2 };
  const gwB = { x: 60.5, y: 74.6 };
  addWall(gwA, gwB, 0.8);
  addWall(gwA, gwB, 0.8, true);

  const corners = [...barn, gwA, gwB];
  const lamp = { x: 60, y: lane(60) + 2.3, r: 7.5 };
  const posts = [{ x: lamp.x, y: lamp.y, r: 0.12 }];

  // The roost: a gap under the eaves at the barn's north-east corner.
  const ne = barn[1];
  const roost = { x: ne.x - 1.2 * cr + 0.7 * sr, y: ne.y - 1.2 * sr - 0.7 * cr };

  const leafSd = signedDistance(mat);

  return {
    mat,
    dens,
    water,
    leafSd,
    walls,
    corners,
    posts,
    barn,
    lane,
    lamp,
    roost,
    roostHeading: -Math.PI / 2 + rot - 0.5,
    pond,
    swarms: [
      { x: 84, y: 63 },
      { x: 91, y: 66.5 },
      { x: 63, y: 34.5 },
      { x: 39.5, y: lane(39.5) - 0.5 },
      { x: 108, y: 61 },
      { x: 20, y: 36 },
    ],
    crickets: [
      { x: 18, y: lane(18) - 3.1 },
      { x: 52, y: lane(52) + 3.1 },
      { x: 96, y: lane(96) - 3.1 },
      { x: 70, y: 77.6 },
      { x: 8, y: lane(8) + 3.1 },
      { x: 100, y: 77.8 },
    ],
  };
}

/** Chamfer distance transform of foliage, signed, in metres. */
function signedDistance(mat: Uint8Array): Float32Array {
  const n = GW * GH;
  const inside = new Float32Array(n);
  const outside = new Float32Array(n);
  const BIG = 1e6;
  for (let i = 0; i < n; i++) {
    const leafy = mat[i] === MAT_LEAF || mat[i] === MAT_TRUNK;
    inside[i] = leafy ? BIG : 0;
    outside[i] = leafy ? 0 : BIG;
  }
  const pass = (d: Float32Array) => {
    const D = 1;
    const E = Math.SQRT2;
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        let v = d[i];
        if (v === 0) continue;
        if (x > 0) v = Math.min(v, d[i - 1] + D);
        if (y > 0) {
          v = Math.min(v, d[i - GW] + D);
          if (x > 0) v = Math.min(v, d[i - GW - 1] + E);
          if (x < GW - 1) v = Math.min(v, d[i - GW + 1] + E);
        }
        d[i] = v;
      }
    }
    for (let y = GH - 1; y >= 0; y--) {
      for (let x = GW - 1; x >= 0; x--) {
        const i = y * GW + x;
        let v = d[i];
        if (v === 0) continue;
        if (x < GW - 1) v = Math.min(v, d[i + 1] + D);
        if (y < GH - 1) {
          v = Math.min(v, d[i + GW] + D);
          if (x < GW - 1) v = Math.min(v, d[i + GW + 1] + E);
          if (x > 0) v = Math.min(v, d[i + GW - 1] + E);
        }
        d[i] = v;
      }
    }
  };
  pass(inside);
  pass(outside);
  const sd = new Float32Array(n);
  for (let i = 0; i < n; i++) sd[i] = (outside[i] > 0 ? outside[i] - 0.5 : -(inside[i] - 0.5)) * CELL;
  return sd;
}

/** Bilinear sample of a cell field at a point in metres. */
export function sampleField(f: Float32Array, x: number, y: number): number {
  const fx = x / CELL - 0.5;
  const fy = y / CELL - 0.5;
  const x0 = Math.max(0, Math.min(GW - 2, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(GH - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const i = y0 * GW + x0;
  const a = f[i];
  const b = f[i + 1];
  const c = f[i + GW];
  const d = f[i + GW + 1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Is a point inside the barn (or its walls)? */
export function insideBarn(w: World, x: number, y: number): boolean {
  let inside = false;
  const p = w.barn;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i].y > y !== p[j].y > y && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) {
      inside = !inside;
    }
  }
  return inside;
}
