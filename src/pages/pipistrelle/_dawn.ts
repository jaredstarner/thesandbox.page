// The village as it looks at first light, painted from the same ground plan the
// bat hears: canopies rounded and lit from a low sun in the east-north-east,
// long shadows thrown west across dewy grass, the lane's ruts, the pond holding
// the sky, the barn's slate roof, and apples in the orchard.

import {
  CELL,
  GW,
  MAT_REED,
  MAT_TRUNK,
  WORLD_H,
  WORLD_W,
  fbm,
  hash2,
  insideBarn,
  noise2,
  pondK,
  sampleField,
  type World,
} from './_world';

/** Pixels per metre of the painting. */
export const DAWN_PX = 16;

type RGB = [number, number, number];

function mix(a: RGB, b: RGB, t: number): RGB {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function scale(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}

const GRASS: RGB = [86, 101, 84];
const GRASS_DEW: RGB = [128, 142, 132];
const VERGE: RGB = [104, 118, 92];
const GRAVEL: RGB = [158, 151, 136];
const RUT: RGB = [118, 110, 98];
const LEAF_DARK: RGB = [30, 50, 40];
const LEAF_LIT: RGB = [104, 128, 88];
const WOOD_DARK: RGB = [22, 38, 33];
const WOOD_LIT: RGB = [78, 100, 74];
const ORCHARD_LIT: RGB = [122, 142, 92];
const REED: RGB = [120, 128, 86];
const WATER_SKY: RGB = [214, 196, 186];
const WATER_DEEP: RGB = [92, 108, 124];
const MUD: RGB = [70, 66, 56];
const SLATE: RGB = [86, 92, 104];
const STONE: RGB = [150, 142, 128];
const SHADOW_TINT: RGB = [0.62, 0.68, 0.82];

// The sun is low in the east-north-east.
const SUN_X = 0.86;
const SUN_Y = -0.36;
const SUN_TAN = 0.2;
const LIGHT = (() => {
  const v = [SUN_X, SUN_Y, 0.55];
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
})();

/** Canopy height in metres from the signed distance inside foliage. */
function heightAt(world: World, x: number, y: number): number {
  const sd = sampleField(world.leafSd, x, y);
  if (sd >= 0) return 0;
  const inside = -sd;
  // Woodland and big trees are tall; hedges are low, but they are thin, so the curve handles it.
  return Math.min(9, 2.2 * Math.sqrt(inside) + inside * 0.35);
}

export function paintDawn(world: World): { width: number; height: number; data: Uint8ClampedArray } {
  const W = Math.round(WORLD_W * DAWN_PX);
  const H = Math.round(WORLD_H * DAWN_PX);
  const data = new Uint8ClampedArray(W * H * 4);
  const barnC = {
    x: (world.barn[0].x + world.barn[2].x) / 2,
    y: (world.barn[0].y + world.barn[2].y) / 2,
  };
  const ux = world.barn[1].x - world.barn[0].x;
  const uy = world.barn[1].y - world.barn[0].y;
  const ulen = Math.hypot(ux, uy);
  const uax = ux / ulen;
  const uay = uy / ulen;
  const vlen = Math.hypot(world.barn[3].x - world.barn[0].x, world.barn[3].y - world.barn[0].y);
  const wall = world.walls[world.walls.length - 1];
  const e = 0.12;

  for (let py = 0; py < H; py++) {
    const y = (py + 0.5) / DAWN_PX;
    for (let px = 0; px < W; px++) {
      const x = (px + 0.5) / DAWN_PX;
      let c: RGB;
      const ci = Math.min(GW - 1, Math.floor(x / CELL)) + Math.min(Math.floor(y / CELL), Math.round(WORLD_H / CELL) - 1) * GW;
      const sd = sampleField(world.leafSd, x, y);
      const n1 = fbm(x * 0.35, y * 0.35);
      const n2 = noise2(x * 3.1, y * 3.1);
      const grain = hash2(px, py) - 0.5;

      if (insideBarn(world, x, y)) {
        // The roof: two slopes either side of a ridge along the barn's length.
        const dx = x - barnC.x;
        const dy = y - barnC.y;
        const u = dx * uax + dy * uay;
        const v = -dx * uay + dy * uax;
        const across = v / (vlen / 2);
        const course = Math.abs(((v * 3.4) % 1) + 1) % 1;
        const stagger = Math.floor(v * 3.4) % 2 === 0 ? 0 : 0.5;
        const joint = Math.abs(((u * 2.6 + stagger) % 1) + 1) % 1;
        let k = across < 0 ? 0.86 : 1.04;
        if (course < 0.12) k *= 0.8;
        if (joint < 0.06) k *= 0.9;
        if (Math.abs(across) < 0.05) k *= 0.68;
        if (Math.abs(across) > 0.94) k *= 0.85;
        c = scale(SLATE, k * (1 + n2 * 0.05 + grain * 0.06));
        c = mix(c, [120, 132, 112], Math.max(0, n1) * 0.25);
      } else if (world.water[ci]) {
        const k = pondK(world.pond, x, y);
        const east = (x - (world.pond.cx - world.pond.rx)) / (2 * world.pond.rx);
        c = mix(WATER_DEEP, WATER_SKY, 0.25 + east * 0.55 + n1 * 0.08);
        // Ripple lines and a darker rim of shallows.
        c = scale(c, 1 + Math.sin(y * 14 + n2 * 2.5) * 0.018);
        c = mix(c, MUD, Math.max(0, (k - 0.86) / 0.14) * 0.55);
        const reflect = heightAt(world, x + 3, y - 1);
        if (reflect > 0) c = mix(c, [60, 76, 72], 0.35);
      } else if (sd < 0) {
        const h = heightAt(world, x, y);
        const hx = heightAt(world, x + e, y) - heightAt(world, x - e, y);
        const hy = heightAt(world, x, y + e) - heightAt(world, x, y - e);
        let nx = -hx / (2 * e);
        let ny = -hy / (2 * e);
        let nz = 1;
        const m = Math.hypot(nx, ny, nz);
        nx /= m;
        ny /= m;
        nz /= m;
        const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        // Clumps of leaves catching the light.
        const clump = noise2(x * 1.6, y * 1.6) * 0.6 + noise2(x * 4.4 + 9, y * 4.4) * 0.4;
        const lit = Math.max(0, Math.min(1, lambert * 0.95 + clump * 0.32 + grain * 0.08));
        const isWood = y < 16 && x > 0;
        const inOrchard = x > 39 && x < 59 && y > 55 && y < 73;
        if (world.mat[ci] === MAT_TRUNK && h < 0.6) c = [62, 52, 44];
        else if (isWood) c = mix(WOOD_DARK, WOOD_LIT, lit);
        else if (inOrchard) c = mix(LEAF_DARK, ORCHARD_LIT, lit);
        else c = mix(LEAF_DARK, LEAF_LIT, lit);
        if (inOrchard && hash2(Math.floor(x * 7), Math.floor(y * 7)) > 0.985 && lambert > 0.5) c = [172, 64, 48];
        // A soft dark edge where the canopy meets the ground.
        c = scale(c, 0.82 + 0.18 * Math.min(1, -sd / 0.5));
      } else {
        // Ground: grass silvered with dew, the lane, verges.
        const ly = world.lane(x);
        const fromLane = Math.abs(y - ly);
        if (fromLane < 2.0) {
          const rut = Math.min(Math.abs(y - (ly - 0.75)), Math.abs(y - (ly + 0.75)));
          c = mix(GRAVEL, RUT, rut < 0.22 ? 0.7 : 0);
          if (Math.abs(y - ly) < 0.18) c = mix(c, VERGE, 0.55 + n2 * 0.2);
          c = scale(c, 1 + n2 * 0.05 + grain * 0.1);
        } else {
          const dew = 0.45 + n1 * 0.35 + n2 * 0.08;
          c = mix(GRASS, GRASS_DEW, dew);
          if (fromLane < 3.6) c = mix(c, VERGE, 0.4);
          c = scale(c, 1 + grain * 0.07);
        }
        if (world.mat[ci] === MAT_REED) {
          const stalk = Math.abs(Math.sin(x * 23 + n2 * 4)) > 0.7 ? 1 : 0.85;
          c = scale(mix(REED, [96, 104, 70], n2 * 0.5 + 0.5), stalk);
        }
        // Long shadows to the west of anything tall.
        let shade = 0;
        for (const k of [0.4, 0.9, 1.6, 2.6, 4, 6, 8.5]) {
          const hs = heightAt(world, x + SUN_X * k * 1.1, y + SUN_Y * k * 1.1);
          if (hs > k * SUN_TAN) {
            shade = 1;
            break;
          }
        }
        // The barn and the garden wall throw shadows too.
        if (!shade) {
          for (const k of [0.5, 1.5, 3, 5, 7.5, 10, 13]) {
            const sx = x + SUN_X * k;
            const sy = y + SUN_Y * k;
            if (insideBarn(world, sx, sy) && k * SUN_TAN < 5.5) {
              shade = 1;
              break;
            }
          }
        }
        if (!shade && wall) {
          const ex = wall.x2 - wall.x1;
          const ey = wall.y2 - wall.y1;
          for (const k of [0.3, 0.6, 1.0]) {
            const sx = x + SUN_X * k;
            const sy = y + SUN_Y * k;
            const u = ((sx - wall.x1) * ex + (sy - wall.y1) * ey) / (ex * ex + ey * ey);
            if (u >= 0 && u <= 1) {
              const qx = wall.x1 + ex * u;
              const qy = wall.y1 + ey * u;
              if (Math.hypot(sx - qx, sy - qy) < 0.22) {
                shade = 1;
                break;
              }
            }
          }
        }
        if (shade) c = [c[0] * SHADOW_TINT[0], c[1] * SHADOW_TINT[1], c[2] * SHADOW_TINT[2]];
      }

      // The garden wall's coping.
      if (wall) {
        const ex = wall.x2 - wall.x1;
        const ey = wall.y2 - wall.y1;
        const u = ((x - wall.x1) * ex + (y - wall.y1) * ey) / (ex * ex + ey * ey);
        if (u >= 0 && u <= 1) {
          const d = Math.hypot(x - (wall.x1 + ex * u), y - (wall.y1 + ey * u));
          if (d < 0.2) c = scale(STONE, 0.9 + (d < 0.08 ? 0.12 : 0) + grain * 0.1);
        }
      }
      // The lamp standard.
      const lp = world.posts[0];
      if (Math.hypot(x - lp.x, y - lp.y) < 0.13) c = [44, 46, 50];

      const o = (py * W + px) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}
