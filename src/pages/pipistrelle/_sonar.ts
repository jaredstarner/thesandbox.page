// One call, cast into the world: rays fan out across the bat's beam, scatter
// off leaves and reeds, glance off smooth walls like light off a mirror, pass
// over water, and come back as a list of echoes, each with the range and
// bearing the bat would hear it from. A ray bent by a wall comes back along the
// direction it left, so what a wall reflects is heard behind it, as a mirror
// image.

import { CELL, GW, GH, MAT_LEAF, MAT_REED, MAT_TRUNK, WORLD_H, WORLD_W, hash2, type World, type Wall } from './_world';

export const SOUND = 343; // metres per second

export const KIND_SCENE = 0;
export const KIND_INSECT = 1;
export const KIND_MIRROR = 2;
export const KIND_SOLID = 3;

export interface Echo {
  /** Where the bat hears it: along the call's direction, at the path's half length. */
  x: number;
  y: number;
  /** One-way path length, metres. */
  range: number;
  /** Bearing the echo arrives from, radians. */
  bearing: number;
  /** Strength before spreading loss, 0 to 1. */
  amp: number;
  kind: number;
  /** For insect echoes, the insect's id. */
  id: number;
}

export interface Target {
  id: number;
  x: number;
  y: number;
  /** Echo strength of the body. */
  size: number;
  /** Wing-flutter glint at this moment, 0 to 1. */
  glint: number;
}

export interface CallShape {
  range: number;
  rays: number;
  /** Half-width of the beam, radians. */
  beam: number;
}

function wallHit(w: Wall, ox: number, oy: number, dx: number, dy: number): number {
  const ex = w.x2 - w.x1;
  const ey = w.y2 - w.y1;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return Infinity;
  const qx = w.x1 - ox;
  const qy = w.y1 - oy;
  const t = (qx * ey - qy * ex) / den;
  const u = (qx * dy - qy * dx) / den;
  if (t <= 1e-4 || u < 0 || u > 1) return Infinity;
  // Only the face the ray approaches from reflects.
  if (dx * w.nx + dy * w.ny >= 0) return Infinity;
  return t;
}

function discHit(cx: number, cy: number, r: number, ox: number, oy: number, dx: number, dy: number): number {
  const fx = ox - cx;
  const fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 1e-4 ? t : Infinity;
}

/** Wraps an angle into [-PI, PI]. */
export function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Casts one call. `shimmer` reseeds which leaves answer, so foliage sparkles a
 * little from call to call the way a canopy moving in the air does.
 */
export function castCall(
  world: World,
  bx: number,
  by: number,
  heading: number,
  shape: CallShape,
  targets: Target[],
  shimmer: number,
  out: Echo[],
): void {
  out.length = 0;
  const { mat, dens, water, walls, corners, posts } = world;
  const step = CELL * 0.7;
  for (let r = 0; r < shape.rays; r++) {
    const off = shape.beam * ((2 * (r + 0.5 + (hash2(r, shimmer) - 0.5) * 0.8)) / shape.rays - 1);
    const a0 = heading + off;
    // The beam is strongest straight ahead.
    const c = Math.cos((off / shape.beam) * (Math.PI / 2));
    const beamGain = 0.22 + 0.78 * c * c;
    const d0x = Math.cos(a0);
    const d0y = Math.sin(a0);
    let ox = bx;
    let oy = by;
    let dx = d0x;
    let dy = d0y;
    let travelled = 0;
    let energy = 1;
    let bounced = false;
    let lastCell = -1;

    while (travelled < shape.range && energy > 0.12) {
      // Nearest hard surface on this leg.
      let tHard = Infinity;
      let hardWall: Wall | null = null;
      let hardKind = -1;
      for (const w of walls) {
        const t = wallHit(w, ox, oy, dx, dy);
        if (t < tHard) {
          tHard = t;
          hardWall = w;
          hardKind = 0;
        }
      }
      for (const p of corners) {
        const t = discHit(p.x, p.y, 0.22, ox, oy, dx, dy);
        if (t < tHard) {
          tHard = t;
          hardWall = null;
          hardKind = 1;
        }
      }
      for (const p of posts) {
        const t = discHit(p.x, p.y, p.r, ox, oy, dx, dy);
        if (t < tHard) {
          tHard = t;
          hardWall = null;
          hardKind = 2;
        }
      }
      const legMax = Math.min(tHard, shape.range - travelled);

      // March the soft things up to it.
      let t = step * 0.5;
      let stopped = false;
      while (t < legMax) {
        const x = ox + dx * t;
        const y = oy + dy * t;
        if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) {
          stopped = true;
          break;
        }
        const cx = (x / CELL) | 0;
        const cy = (y / CELL) | 0;
        const ci = cy * GW + cx;
        if (ci !== lastCell) {
          lastCell = ci;
          const m = mat[ci];
          if (m !== 0 && water[ci] === 0) {
            const answer = hash2(ci, 3) * 0.8 + hash2(ci, shimmer) * 0.2;
            if (answer * 255 < dens[ci]) {
              const L = travelled + t;
              let strength: number;
              if (m === MAT_TRUNK) strength = 0.9;
              else if (m === MAT_REED) strength = 0.32;
              else strength = 0.5;
              out.push({
                x: bx + d0x * L,
                y: by + d0y * L,
                range: L,
                bearing: a0,
                amp: strength * energy * beamGain,
                kind: bounced ? KIND_MIRROR : m === MAT_TRUNK ? KIND_SOLID : KIND_SCENE,
                id: -1,
              });
              if (m === MAT_TRUNK) {
                stopped = true;
                break;
              }
              energy *= m === MAT_LEAF ? 0.42 : 0.62;
              if (energy <= 0.12) {
                stopped = true;
                break;
              }
            }
          }
        }
        t += step;
      }
      if (stopped || tHard === Infinity || tHard > shape.range - travelled) break;

      // The hard surface itself.
      const L = travelled + tHard;
      const hx = ox + dx * tHard;
      const hy = oy + dy * tHard;
      if (hardKind === 0 && hardWall) {
        const cosI = -(dx * hardWall.nx + dy * hardWall.ny);
        // Square on, a smooth wall throws nearly all of it back; at a slant, almost none.
        const spec = hardWall.gloss * Math.pow(Math.max(0, cosI), 36);
        const rough = 0.035;
        out.push({
          x: bx + d0x * L,
          y: by + d0y * L,
          range: L,
          bearing: a0,
          amp: (spec + rough) * energy * beamGain,
          kind: bounced ? KIND_MIRROR : KIND_SOLID,
          id: -1,
        });
        if (bounced) break;
        // Reflect and carry on: what it meets next is heard through the mirror.
        const dot = dx * hardWall.nx + dy * hardWall.ny;
        dx -= 2 * dot * hardWall.nx;
        dy -= 2 * dot * hardWall.ny;
        ox = hx + dx * 1e-3;
        oy = hy + dy * 1e-3;
        travelled = L;
        energy *= 0.8;
        bounced = true;
        lastCell = -1;
        continue;
      }
      out.push({
        x: bx + d0x * L,
        y: by + d0y * L,
        range: L,
        bearing: a0,
        amp: (hardKind === 1 ? 0.75 : 0.42) * energy * beamGain,
        kind: bounced ? KIND_MIRROR : KIND_SOLID,
        id: -1,
      });
      break;
    }
  }

  // Insects: small, but they flash with every wingbeat.
  for (const tg of targets) {
    const ddx = tg.x - bx;
    const ddy = tg.y - by;
    const L = Math.hypot(ddx, ddy);
    if (L < 0.05 || L > shape.range) continue;
    const bearing = Math.atan2(ddy, ddx);
    const off = wrap(bearing - heading);
    if (Math.abs(off) > shape.beam) continue;
    const c = Math.cos((off / shape.beam) * (Math.PI / 2));
    const beamGain = 0.22 + 0.78 * c * c;
    // Leaves between the bat and the insect soak up the call both ways.
    let e = 1;
    const n = Math.ceil(L / 0.12);
    let last = -1;
    for (let k = 1; k < n && e > 0.05; k++) {
      const x = bx + (ddx * k) / n;
      const y = by + (ddy * k) / n;
      const cx = (x / CELL) | 0;
      const cy = (y / CELL) | 0;
      if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) break;
      const ci = cy * GW + cx;
      if (ci === last) continue;
      last = ci;
      const m = mat[ci];
      if (m === MAT_TRUNK) e = 0;
      else if (m !== 0 && hash2(ci, 3) * 255 < dens[ci]) e *= m === MAT_LEAF ? 0.42 : 0.62;
    }
    if (e > 0.05) {
      for (const w of walls) {
        if (wallHit(w, bx, by, ddx / L, ddy / L) < L) {
          e = 0;
          break;
        }
      }
    }
    if (e <= 0.05) continue;
    out.push({
      x: tg.x,
      y: tg.y,
      range: L,
      bearing,
      amp: tg.size * (0.3 + 0.7 * tg.glint) * beamGain * e,
      kind: KIND_INSECT,
      id: tg.id,
    });
  }
}

/** How loud an echo arrives from a range: two-way spreading plus the air's toll on ultrasound. */
export function spreading(range: number): number {
  return 1 / (1 + (range / 5.5) ** 2) / Math.exp(range / 28);
}
