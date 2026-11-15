// The village as it looks by day, painted from the same ground plan the bat
// hears: canopies rounded and lit from the east-north-east, soft shadows thrown
// west across dewy grass, the lane's ruts, the pond holding the sky, the barn's
// slate roof, and apples in the orchard. A second, smaller painting is the patch
// of ground the streetlamp lights at night, in sodium orange, with the hedges'
// shadows thrown away from the lamp.

import {
  CELL,
  GW,
  GH,
  MAT_TRUNK,
  WORLD_H,
  WORLD_W,
  fbm,
  hash2,
  insideBarn,
  noise2,
  pondK,
  reedAt,
  sampleField,
  type World,
} from './_world';

/** Pixels per metre of the day painting. */
export const DAWN_PX = 16;
/** Pixels per metre of the lamp's patch, and its radius in metres. */
export const LAMP_PX = 56;
export const LAMP_R = 5.5;
const LAMP_H = 6;

type RGB = [number, number, number];

export interface Painting {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function scale(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}

const GRASS: RGB = [84, 100, 82];
const GRASS_DEW: RGB = [112, 128, 114];
const VERGE: RGB = [100, 114, 88];
const GRAVEL: RGB = [156, 149, 134];
const RUT: RGB = [120, 112, 100];
const LEAF: RGB = [52, 76, 56];
const LEAF_LIT: RGB = [112, 134, 90];
const WOOD: RGB = [38, 60, 48];
const WOOD_LIT: RGB = [86, 108, 78];
const ORCHARD: RGB = [70, 96, 62];
const ORCHARD_LIT: RGB = [134, 152, 98];
const REED: RGB = [124, 130, 86];
const REED_DARK: RGB = [84, 92, 60];
const WATER_SKY: RGB = [188, 192, 196];
const WATER_DEEP: RGB = [78, 96, 112];
const MUD: RGB = [74, 70, 58];
const SLATE: RGB = [88, 94, 106];
const STONE: RGB = [150, 142, 128];
const SHADOW_TINT: RGB = [0.6, 0.66, 0.8];

// The sun, from the east-north-east and not yet high.
const SUN_X = 0.86;
const SUN_Y = -0.36;
const SUN_TAN = 0.5;
const LIGHT = (() => {
  const v = [SUN_X, SUN_Y, 0.62];
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
})();

const BARN_EAVES = 4.2;
const BARN_RIDGE = 6.6;
const WALL_H = 1.6;

/** Heights of everything standing, in metres, on the 10 cm grid. */
export function buildHeights(world: World): Float32Array {
  const n = GW * GH;
  // Leaves: inside-distance, capped, then blurred into rounded crowns.
  let a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.min(5, Math.max(0, -world.leafSd[i]));
  let b = new Float32Array(n);
  const r = 6;
  for (let pass = 0; pass < 3; pass++) {
    // Horizontal box blur.
    for (let y = 0; y < GH; y++) {
      let acc = 0;
      const row = y * GW;
      for (let x = -r; x <= r; x++) acc += a[row + Math.max(0, Math.min(GW - 1, x))];
      for (let x = 0; x < GW; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(GW - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    // Vertical.
    for (let x = 0; x < GW; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.max(0, Math.min(GH - 1, y)) * GW + x];
      for (let y = 0; y < GH; y++) {
        a[y * GW + x] = acc / (2 * r + 1);
        acc += b[Math.min(GH - 1, y + r + 1) * GW + x] - b[Math.max(0, y - r) * GW + x];
      }
    }
  }
  const H = b;
  for (let i = 0; i < n; i++) {
    const v = a[i];
    H[i] = world.leafSd[i] < 0.05 ? 2.3 * Math.sqrt(v) + 0.6 * v + 0.4 : 0;
  }
  // The barn: a pitched roof along its length.
  const bc = { x: (world.barn[0].x + world.barn[2].x) / 2, y: (world.barn[0].y + world.barn[2].y) / 2 };
  const ux = world.barn[1].x - world.barn[0].x;
  const uy = world.barn[1].y - world.barn[0].y;
  const ul = Math.hypot(ux, uy);
  const vl = Math.hypot(world.barn[3].x - world.barn[0].x, world.barn[3].y - world.barn[0].y);
  for (let gy = 0; gy < GH; gy++) {
    const y = (gy + 0.5) * CELL;
    if (Math.abs(y - bc.y) > 10) continue;
    for (let gx = 0; gx < GW; gx++) {
      const x = (gx + 0.5) * CELL;
      if (Math.abs(x - bc.x) > 10) continue;
      if (!insideBarn(world, x, y)) continue;
      const dx = x - bc.x;
      const dy = y - bc.y;
      const v = (-dx * uy + dy * ux) / ul;
      const across = Math.abs(v) / (vl / 2);
      H[gy * GW + gx] = BARN_RIDGE - (BARN_RIDGE - BARN_EAVES) * across;
    }
  }
  // The garden wall and the lamp standard.
  const wall = world.walls[world.walls.length - 1];
  const ex = wall.x2 - wall.x1;
  const ey = wall.y2 - wall.y1;
  const len = Math.hypot(ex, ey);
  for (let s = 0; s <= len; s += CELL * 0.5) {
    for (let o = -0.2; o <= 0.2; o += CELL * 0.5) {
      const x = wall.x1 + (ex / len) * s + wall.nx * o;
      const y = wall.y1 + (ey / len) * s + wall.ny * o;
      const i = Math.floor(y / CELL) * GW + Math.floor(x / CELL);
      if (i >= 0 && i < n) H[i] = Math.max(H[i], WALL_H);
    }
  }
  return H;
}

function heightAt(H: Float32Array, x: number, y: number): number {
  return sampleField(H, x, y);
}

/** Sun shadow on the grid: 0 lit, 1 in shade, soft at the edges. */
export function buildSunShadow(H: Float32Array): Float32Array {
  const S = new Float32Array(GW * GH);
  const step = 0.2;
  const maxH = 9;
  for (let gy = 0; gy < GH; gy++) {
    const y = (gy + 0.5) * CELL;
    for (let gx = 0; gx < GW; gx++) {
      const x = (gx + 0.5) * CELL;
      const h0 = H[gy * GW + gx];
      let excess = -1;
      for (let k = step; k * SUN_TAN < maxH - h0; k += step) {
        const sx = x + SUN_X * k;
        const sy = y + SUN_Y * k;
        if (sx < 0 || sy < 0 || sx >= WORLD_W || sy >= WORLD_H) break;
        const hs = H[Math.floor(sy / CELL) * GW + Math.floor(sx / CELL)];
        const e = hs - h0 - k * SUN_TAN;
        if (e > excess) excess = e;
        if (excess > 0.4) break;
      }
      S[gy * GW + gx] = Math.max(0, Math.min(1, (excess + 0.25) / 0.5));
    }
  }
  return S;
}

interface Surface {
  c: RGB;
  /** Surface normal. */
  n: [number, number, number];
  /** Takes shadow and light (water does not). */
  lit: boolean;
}

/** What is at a point, unlit. */
function surface(world: World, H: Float32Array, x: number, y: number, px: number, py: number): Surface {
  const ci = Math.min(GW - 1, Math.max(0, Math.floor(x / CELL))) + Math.min(GH - 1, Math.max(0, Math.floor(y / CELL))) * GW;
  const grain = hash2(px, py) - 0.5;
  const n1 = fbm(x * 0.22, y * 0.22);
  const n2 = noise2(x * 3.1, y * 3.1);
  const up: [number, number, number] = [0, 0, 1];

  if (insideBarn(world, x, y)) {
    const bc = { x: (world.barn[0].x + world.barn[2].x) / 2, y: (world.barn[0].y + world.barn[2].y) / 2 };
    const ux = world.barn[1].x - world.barn[0].x;
    const uy = world.barn[1].y - world.barn[0].y;
    const ul = Math.hypot(ux, uy);
    const vl = Math.hypot(world.barn[3].x - world.barn[0].x, world.barn[3].y - world.barn[0].y);
    const dx = x - bc.x;
    const dy = y - bc.y;
    const u = (dx * ux + dy * uy) / ul;
    const v = (-dx * uy + dy * ux) / ul;
    const across = v / (vl / 2);
    const course = (((v * 3.4) % 1) + 1) % 1;
    const stagger = Math.floor(v * 3.4) % 2 === 0 ? 0 : 0.5;
    const joint = (((u * 2.6 + stagger) % 1) + 1) % 1;
    let k = 1 + n2 * 0.04 + grain * 0.06;
    if (course < 0.1) k *= 0.82;
    if (joint < 0.05) k *= 0.9;
    if (Math.abs(across) < 0.04) k *= 0.7;
    if (Math.abs(across) > 0.95) k *= 0.8;
    let c = scale(SLATE, k);
    // Lichen on the slates.
    c = mix(c, [128, 136, 108], Math.max(0, fbm(x * 0.9, y * 0.9)) * 0.35);
    const tilt = (BARN_RIDGE - BARN_EAVES) / (vl / 2);
    const s = across < 0 ? -1 : 1;
    const nx = ((-uy / ul) * s * tilt) / Math.hypot(tilt, 1);
    const ny = ((ux / ul) * s * tilt) / Math.hypot(tilt, 1);
    return { c, n: [nx, ny, 1 / Math.hypot(tilt, 1)], lit: true };
  }
  if (world.water[ci]) {
    const k = pondK(world.pond, x, y);
    const east = (x - (world.pond.cx - world.pond.rx)) / (2 * world.pond.rx);
    let c = mix(WATER_DEEP, WATER_SKY, 0.15 + east * 0.5 + n1 * 0.08);
    c = scale(c, 1 + Math.sin(y * 16 + n2 * 2.5) * 0.015);
    c = mix(c, MUD, Math.max(0, (k - 0.84) / 0.16) * 0.6);
    // The trees on the far bank, upside down in the water.
    if (heightAt(H, x + 2.5, y - 1) > 0.5) c = mix(c, [54, 70, 66], 0.4);
    return { c, n: up, lit: false };
  }
  const sd = sampleField(world.leafSd, x, y);
  if (sd < 0) {
    const e = 0.15;
    const hx = heightAt(H, x + e, y) - heightAt(H, x - e, y);
    const hy = heightAt(H, x, y + e) - heightAt(H, x, y - e);
    const nx0 = -hx / (2 * e);
    const ny0 = -hy / (2 * e);
    const m = Math.hypot(nx0, ny0, 1);
    // Leafy clumps: their own little bumps in the light.
    const clump = noise2(x * 1.5, y * 1.5) * 0.55 + noise2(x * 4.2 + 9, y * 4.2) * 0.3 + grain * 0.15;
    const isWood = y < 15.5;
    const inOrchard = x > 39 && x < 59 && y > 55 && y < 73;
    const dark = isWood ? WOOD : inOrchard ? ORCHARD : LEAF;
    const lit = isWood ? WOOD_LIT : inOrchard ? ORCHARD_LIT : LEAF_LIT;
    let c = mix(dark, lit, 0.35 + clump * 0.45);
    if (world.mat[ci] === MAT_TRUNK && heightAt(H, x, y) < 1) c = [70, 60, 50];
    if (inOrchard && hash2(Math.floor(x * 6), Math.floor(y * 6)) > 0.986 && clump > 0) c = [176, 70, 52];
    return { c, n: [nx0 / m, ny0 / m, 1 / m], lit: true };
  }
  // Ground.
  const ly = world.lane(x);
  const fromLane = Math.abs(y - ly);
  let c: RGB;
  if (fromLane < 2.0) {
    const rut = Math.min(Math.abs(y - (ly - 0.75)), Math.abs(y - (ly + 0.75)));
    c = mix(GRAVEL, RUT, rut < 0.24 ? 0.75 * (1 - rut / 0.24) : 0);
    if (fromLane < 0.2) c = mix(c, VERGE, 0.55 + n2 * 0.2);
    if (fromLane > 1.8) c = mix(c, VERGE, (fromLane - 1.8) / 0.2);
    c = scale(c, 1 + n2 * 0.04 + grain * 0.09);
  } else {
    c = mix(GRASS, GRASS_DEW, 0.45 + n1 * 0.22 + n2 * 0.06);
    if (fromLane < 3.6) c = mix(c, VERGE, 0.35);
    c = scale(c, 1 + grain * 0.07 + noise2(x * 9, y * 9) * 0.03);
  }
  const reed = reedAt(world.pond, x, y);
  if (reed > 0) {
    const stalk = 0.5 + 0.5 * Math.sin(x * 21 + y * 6 + n2 * 5);
    c = mix(c, mix(REED_DARK, REED, stalk), Math.min(1, reed * 3));
  }
  return { c, n: up, lit: true };
}

export function paintDawn(world: World, H: Float32Array, S: Float32Array): Painting {
  const W = Math.round(WORLD_W * DAWN_PX);
  const Ht = Math.round(WORLD_H * DAWN_PX);
  const data = new Uint8ClampedArray(new ArrayBuffer(W * Ht * 4));
  const wall = world.walls[world.walls.length - 1];
  for (let py = 0; py < Ht; py++) {
    const y = (py + 0.5) / DAWN_PX;
    for (let px = 0; px < W; px++) {
      const x = (px + 0.5) / DAWN_PX;
      const s = surface(world, H, x, y, px, py);
      let c = s.c;
      if (s.lit) {
        const lambert = Math.max(0, s.n[0] * LIGHT[0] + s.n[1] * LIGHT[1] + s.n[2] * LIGHT[2]);
        const shade = sampleField(S, x, y);
        const sun = lambert * (1 - shade * 0.85);
        // Sky fill keeps the shade blue, the sun keeps the lit side warm.
        const k = 0.5 + 0.62 * sun;
        c = [c[0] * k, c[1] * k, c[2] * k];
        c = [
          c[0] * (1 - shade * (1 - SHADOW_TINT[0]) * 0.6),
          c[1] * (1 - shade * (1 - SHADOW_TINT[1]) * 0.6),
          c[2] * (1 - shade * (1 - SHADOW_TINT[2]) * 0.6),
        ];
      }
      // The garden wall's coping.
      const ex = wall.x2 - wall.x1;
      const ey = wall.y2 - wall.y1;
      const u = ((x - wall.x1) * ex + (y - wall.y1) * ey) / (ex * ex + ey * ey);
      if (u >= 0 && u <= 1) {
        const d = Math.hypot(x - (wall.x1 + ex * u), y - (wall.y1 + ey * u));
        if (d < 0.2) c = scale(STONE, 0.95 + (d < 0.07 ? 0.1 : 0) + (hash2(px, py) - 0.5) * 0.1);
      }
      const lp = world.posts[0];
      if (Math.hypot(x - lp.x, y - lp.y) < 0.14) c = [52, 54, 58];
      const o = (py * W + px) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
  }
  return { width: W, height: Ht, data };
}

/** The lamp's patch at night: light only, to be added onto the dark. */
export function paintLamp(world: World, H: Float32Array): Painting {
  const L = world.lamp;
  const size = Math.round(LAMP_R * 2 * LAMP_PX);
  const data = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  for (let py = 0; py < size; py++) {
    const y = L.y - LAMP_R + (py + 0.5) / LAMP_PX;
    for (let px = 0; px < size; px++) {
      const x = L.x - LAMP_R + (px + 0.5) / LAMP_PX;
      const dx = x - L.x;
      const dy = y - L.y;
      const d = Math.hypot(dx, dy);
      const o = (py * size + px) * 4;
      if (d > LAMP_R) continue;
      const s = surface(world, H, x, y, px * 3, py * 3);
      const h0 = s.lit ? heightAt(H, x, y) : 0;
      // Light from the lantern head, falling off with distance.
      const lx = -dx;
      const ly = -dy;
      const lz = LAMP_H - h0;
      const r = Math.hypot(lx, ly, lz);
      const lambert = Math.max(0, (s.n[0] * lx + s.n[1] * ly + s.n[2] * lz) / r);
      let I = ((LAMP_H * LAMP_H) / (r * r)) ** 2.6 * lambert;
      // Shadows thrown away from the lamp.
      if (d > 0.3) {
        for (let k = 0.15; k < d - 0.2; k += 0.12) {
          const t = k / d;
          const sx = x - dx * t;
          const sy = y - dy * t;
          const rayH = h0 + (LAMP_H - h0) * t;
          if (heightAt(H, sx, sy) > rayH) {
            I *= 0.12;
            break;
          }
        }
      }
      if (!s.lit) I *= 0.55;
      const edge = Math.max(0, Math.min(1, (LAMP_R - d) / (LAMP_R * 0.35)));
      I *= edge * edge;
      // Sodium light flattens colour to one hue, so the ground reads by its texture alone.
      const grit = 1 + (hash2(px, py) - 0.5) * 0.35 + noise2(x * 7, y * 7) * 0.12;
      const lum = ((s.c[0] * 0.3 + s.c[1] * 0.55 + s.c[2] * 0.15) / 255) * grit;
      const v = Math.min(1, lum * I * 1.7);
      data[o] = 255 * v;
      data[o + 1] = 148 * v;
      data[o + 2] = 58 * v;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}
