// Heights and colours for each /rubbings/ scene, built in the worker from the
// masks _draw.ts made. Heights are millimetres; colours are linear light
// written out as sRGB bytes.

import type { PlaceId } from './_places';
import type { Masks } from './_draw';
import { blur, cellEdges, clamp, distanceTo, fbm, mix, smoothstep } from './_field';

export interface Surface {
  /** Height in millimetres. */
  h: Float32Array;
  /** Paints colour and gloss once the worker knows where the hollows are (`cav`, 0 to 1). */
  paint(cav: Float32Array): { rgb: Uint8Array; gloss: Uint8Array };
}

export interface Ctx {
  n: number;
  /** Millimetres per pixel. */
  mm: number;
  masks: Masks;
}

/** Distance in pixels from inside a mask to its edge (0 outside). Used where a profile needs a true V or dome. */
function inside(mask: Uint8Array, n: number): Float32Array {
  const d = distanceTo(n, n, (i) => mask[i] < 128);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] >= 128 ? d[i] - 0.5 : 0;
  return d;
}

/** A mask's coverage, blurred by about `bevel` pixels: 0.5 on the edge, 1 well inside. */
function soft(mask: Uint8Array | undefined, n: number, bevel: number): Float32Array {
  const out = new Float32Array(n * n);
  if (!mask) return out;
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] / 255;
  return blur(out, n, n, Math.max(0.5, bevel * 0.6), 2);
}

/** A cast or cut edge from a soft mask: 0 at the drawn edge, 1 a bevel inside it. */
const rise = (b: number) => smoothstep(0.5, 0.98, b);

const srgb = (v: number) => {
  const c = clamp(v);
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
};

function put(rgb: Uint8Array, i: number, r: number, g: number, b: number) {
  rgb[i * 3] = srgb(r);
  rgb[i * 3 + 1] = srgb(g);
  rgb[i * 3 + 2] = srgb(b);
}

/** A stable number in [0, 1) for a pair of integers. */
function hash(a: number, b: number) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 1. The surface-water cover, its frame, and the setts round it.
function cover({ n, mm, masks }: Ctx): Surface {
  const h = new Float32Array(n * n);
  const frame = soft(masks.frame, n, 2.5 / mm);
  const lid = soft(masks.cover, n, 1 / mm);
  const cast = soft(masks.cast, n, 2.4 / mm);
  const letters = soft(masks.letters, n, 1.3 / mm);
  const slots = soft(masks.slots, n, 2 / mm);
  const dome = soft(masks.setts, n, 22 / mm);
  const edge = soft(masks.setts, n, 4 / mm);
  const grit = fbm(n, n, 6 / mm, 3, 21);
  const pits = fbm(n, n, 3 / mm, 2, 22);
  const rough = fbm(n, n, 30 / mm, 4, 23);
  const half = n / 2;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const fx = (x - half) / n;
      const fy = (y - half) / n;
      const r = Math.hypot(fx, fy) / 0.314;
      const square = Math.abs(fx) < 0.388 && Math.abs(fy) < 0.388;
      const pit = smoothstep(0.25, 0.7, pits[i]);
      let v: number;
      if (lid[i] > 0.01) {
        v = 1.6 * (1 - r * r) + 5.5 * rise(cast[i]) + 4.2 * rise(letters[i]) - 15 * rise(slots[i]) - 0.35 * pit;
        v = mix(-30, v, rise(lid[i]));
      } else if (frame[i] > 0.01) {
        v = 0.4 + 5.5 * rise(cast[i]) - 0.3 * pit;
        v = mix(square ? -30 : -16, v, rise(frame[i]));
      } else if (square) {
        v = -30;
      } else {
        const top = rise(dome[i]);
        v = mix(-16 + 1.5 * grit[i], -5 + 3.2 * top + 0.9 * rough[i] * top, rise(edge[i]));
      }
      h[i] = v;
    }
  return {
    h,
    paint(cav) {
      const rgb = new Uint8Array(n * n * 3);
      const gloss = new Uint8Array(n * n);
      const speck = fbm(n, n, 1.6 / mm, 2, 24);
      const tone = fbm(n, n, 80 / mm, 3, 25);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const c = cav[i];
          const fx = (x - half) / n;
          const fy = (y - half) / n;
          const iron = lid[i] > 0.5 || frame[i] > 0.5;
          if (iron) {
            const rust = smoothstep(0.4, 0.9, c + 0.3 * tone[i] + 0.12 * grit[i]);
            const worn = 1 - smoothstep(0.02, 0.18, c);
            let r = mix(0.042, 0.13, rust);
            let g = mix(0.04, 0.06, rust);
            let b = mix(0.04, 0.03, rust);
            r = mix(r, 0.14, worn * 0.8);
            g = mix(g, 0.14, worn * 0.8);
            b = mix(b, 0.145, worn * 0.8);
            put(rgb, i, r, g, b);
            gloss[i] = Math.round(255 * worn * 0.9);
          } else if (Math.abs(fx) < 0.388 && Math.abs(fy) < 0.388) {
            put(rgb, i, 0.01, 0.009, 0.008);
          } else {
            const joint = 1 - rise(edge[i]);
            const s = speck[i];
            const fleck = smoothstep(0.25, 0.45, s) * 0.12 - smoothstep(-0.25, -0.45, s) * 0.12;
            const r = mix(0.22 + 0.06 * tone[i] + fleck, 0.09 + 0.03 * grit[i], joint);
            const g = mix(0.215 + 0.06 * tone[i] + fleck, 0.075 + 0.03 * grit[i], joint);
            const b = mix(0.21 + 0.055 * tone[i] + fleck * 0.9, 0.06 + 0.02 * grit[i], joint);
            put(rgb, i, r, g, b);
          }
        }
      return { rgb, gloss };
    },
  };
}

// 2. The slate headstone, against a yew hedge.
function headstone({ n, mm, masks }: Ctx): Surface {
  const h = new Float32Array(n * n);
  const stone = soft(masks.stone, n, 4 / mm);
  const cut = inside(masks.cut, n);
  const cut2 = inside(masks.cut2, n);
  const wear = fbm(n, n, 140 / mm, 3, 41);
  const pits = fbm(n, n, 2.2 / mm, 2, 42);
  const patch = fbm(n, n, 40 / mm, 4, 43);
  const crust = fbm(n, n, 2.5 / mm, 3, 44);
  const cleave = fbm(n, n, 60 / mm, 2, 45, { stretch: 0.25 });
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const fx = x / n - 0.5;
      const fy = y / n;
      // Weather is worst at the top and the edges, where rain runs off.
      const exposed = smoothstep(0.55, 0.15, fy) * 0.6 + smoothstep(0.3, 0.44, Math.abs(fx)) * 0.5;
      const eroded = 0.62 + 0.38 * smoothstep(-0.4, 0.4, wear[i]);
      let v = 0.8 * (1 - (fx / 0.45) ** 2) + 0.14 * cleave[i] - 0.28 * smoothstep(0.38, 0.62, pits[i]);
      v -= Math.min(4.2, cut[i] * mm * 1.05) * eroded;
      v -= Math.min(3.2, cut2[i] * mm * 1.25);
      const lichen = smoothstep(0.36, 0.52, patch[i] + exposed * 0.4 - 0.22);
      v += lichen * (0.35 + 0.55 * smoothstep(-0.2, 0.4, crust[i]));
      h[i] = mix(-90, v, rise(stone[i]));
    }
  return {
    h,
    paint(cav) {
      const rgb = new Uint8Array(n * n * 3);
      const gloss = new Uint8Array(n * n);
      const tone = fbm(n, n, 30 / mm, 3, 46);
      const leaf = fbm(n, n, 30 / mm, 4, 47, { gain: 0.45 });
      const spot = fbm(n, n, 6 / mm, 2, 48);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const s = stone[i];
          if (s < 0.5) {
            // The yew behind, out of focus: dark needles, a few lit sprays.
            const lit = smoothstep(-0.1, 0.6, leaf[i]);
            put(rgb, i, 0.008 + lit * 0.014, 0.017 + lit * 0.026, 0.007 + lit * 0.01);
            continue;
          }
          const fx = x / n - 0.5;
          const fy = y / n;
          const exposed = smoothstep(0.55, 0.15, fy) * 0.6 + smoothstep(0.3, 0.44, Math.abs(fx)) * 0.5;
          const lichen =
            smoothstep(0.36, 0.52, patch[i] + exposed * 0.4 - 0.22) * (0.55 + 0.45 * smoothstep(-0.3, 0.5, crust[i]));
          const inCut = smoothstep(0.3, 1.5, cut[i] * mm + cut2[i] * mm);
          let r = 0.058 + 0.012 * tone[i];
          let g = 0.068 + 0.012 * tone[i];
          let b = 0.08 + 0.014 * tone[i];
          // Grime and moss in the letters.
          r = mix(r, 0.03, inCut * 0.7);
          g = mix(g, 0.042, inCut * 0.7);
          b = mix(b, 0.036, inCut * 0.7);
          // Grey-green crust lichen, with orange Xanthoria where it is sunniest.
          const orange = smoothstep(0.3, 0.5, spot[i]) * smoothstep(0.4, 0.8, exposed);
          r = mix(r, mix(0.3, 0.52, orange), lichen * 0.85);
          g = mix(g, mix(0.33, 0.22, orange), lichen * 0.85);
          b = mix(b, mix(0.27, 0.035, orange), lichen * 0.85);
          put(rgb, i, r, g, b);
          gloss[i] = Math.round(70 * (1 - lichen) * (1 - cav[i]));
        }
      return { rgb, gloss };
    },
  };
}

// 3. Leaves, face down on a sandstone flag.
function leaves({ n, mm, masks }: Ctx): Surface {
  const h = new Float32Array(n * n);
  const oak = soft(masks.oak, n, 0.4 / mm);
  const maple = soft(masks.maple, n, 0.4 / mm);
  const birch = soft(masks.birch, n, 0.4 / mm);
  const v1 = soft(masks.v1, n, 0.3 / mm);
  const v2 = soft(masks.v2, n, 0.22 / mm);
  const v3 = soft(masks.v3, n, 0.14 / mm);
  const joint = soft(masks.joint, n, 1.5 / mm);
  const cell = 1.15 / mm;
  const areole = cellEdges(n, n, cell, 51);
  const grain = fbm(n, n, 0.45 / mm, 3, 52);
  const bed = fbm(n, n, 25 / mm, 3, 53, { stretch: 0.2 });
  const wrinkle = fbm(n, n, 6 / mm, 2, 54);
  const blade = new Float32Array(n * n);
  for (let i = 0; i < blade.length; i++) blade[i] = smoothstep(0.15, 0.85, Math.max(oak[i], maple[i], birch[i]));
  for (let i = 0; i < h.length; i++) {
    const b = blade[i];
    let v = 0.06 * grain[i] + 0.05 * bed[i] - 2.4 * rise(joint[i]);
    if (b > 0 || v1[i] > 0.02) {
      const net = 1 - smoothstep(cell * 0.04, cell * 0.16, areole[i]);
      v +=
        b * (0.24 + 0.03 * wrinkle[i] + 0.03 * net + 0.05 * smoothstep(0.1, 0.9, v3[i])) +
        0.22 * smoothstep(0.05, 0.95, v1[i]) +
        b * 0.11 * smoothstep(0.05, 0.95, v2[i]);
    }
    h[i] = v;
  }
  return {
    h,
    paint() {
      const rgb = new Uint8Array(n * n * 3);
      const gloss = new Uint8Array(n * n);
      const tone = fbm(n, n, 12 / mm, 3, 55);
      const blot = fbm(n, n, 4 / mm, 3, 56);
      const speck = fbm(n, n, 0.6 / mm, 2, 57);
      for (let i = 0; i < h.length; i++) {
        // Sandstone: buff, with darker grains and a gritty joint.
        const sp = speck[i];
        let r = 0.48 + 0.06 * tone[i] - 0.08 * smoothstep(0.2, 0.5, sp);
        let g = 0.36 + 0.05 * tone[i] - 0.07 * smoothstep(0.2, 0.5, sp);
        let b = 0.21 + 0.03 * tone[i] - 0.05 * smoothstep(0.2, 0.5, sp);
        const j = rise(joint[i]);
        r = mix(r, 0.16, j);
        g = mix(g, 0.12, j);
        b = mix(b, 0.08, j);
        const kind = oak[i] >= maple[i] && oak[i] >= birch[i] ? 0 : maple[i] >= birch[i] ? 1 : 2;
        const bl = blade[i];
        if (bl > 0) {
          const brown = smoothstep(0.1, 0.5, blot[i]);
          let lr: number;
          let lg: number;
          let lb: number;
          if (kind === 0) {
            lr = mix(0.27, 0.2, brown);
            lg = mix(0.22, 0.1, brown);
            lb = mix(0.09, 0.035, brown);
          } else if (kind === 1) {
            lr = mix(0.6, 0.42, brown * 0.6);
            lg = mix(0.44, 0.22, brown * 0.6);
            lb = mix(0.05, 0.03, brown * 0.6);
          } else {
            lr = mix(0.66, 0.36, brown * 0.5);
            lg = mix(0.5, 0.2, brown * 0.5);
            lb = mix(0.08, 0.04, brown * 0.5);
          }
          const vein = Math.max(smoothstep(0.1, 0.9, v1[i]), smoothstep(0.1, 0.9, v2[i]) * 0.8);
          lr = mix(lr, lr * 1.25 + 0.06, vein);
          lg = mix(lg, lg * 1.2 + 0.05, vein);
          lb = mix(lb, lb * 1.2 + 0.03, vein);
          r = mix(r, lr, bl);
          g = mix(g, lg, bl);
          b = mix(b, lb, bl);
        } else if (v1[i] > 0.1) {
          const st = smoothstep(0.1, 0.9, v1[i]);
          r = mix(r, 0.3, st);
          g = mix(g, 0.22, st);
          b = mix(b, 0.08, st);
        }
        put(rgb, i, r, g, b);
        gloss[i] = 0;
      }
      return { rgb, gloss };
    },
  };
}

// 4. Pine floorboards, scrubbed until the hard latewood stands proud.
interface Board {
  x0: number;
  x1: number;
  /** Butt joints along the board, in millimetres from the top. */
  joints: number[];
}

const BOARDS: Board[] = [
  { x0: -40, x1: 101, joints: [430] },
  { x0: 105, x1: 248, joints: [] },
  { x0: 252, x1: 392, joints: [180] },
  { x0: 396, x1: 541, joints: [] },
  { x0: 545, x1: 686, joints: [560] },
  { x0: 690, x1: 836, joints: [] },
];

/** Smooth 1D noise in [-0.5, 0.5]. */
function ringJitter(x: number, seed: number) {
  const i = Math.floor(x);
  const f = x - i;
  const t = f * f * (3 - 2 * f);
  const a = hash(i, seed) - 0.5;
  return a + (hash(i + 1, seed) - 0.5 - a) * t;
}

function floor({ n, mm }: Ctx): Surface {
  const h = new Float32Array(n * n);
  const lateness = new Float32Array(n * n);
  /** 0 a gap, 1 wood, 2 a knot, 3 a nail head. */
  const what = new Uint8Array(n * n);
  const stain = new Float32Array(n * n);
  const which = new Uint8Array(n * n);
  const warp = fbm(n, n, 90 / mm, 3, 71, { stretch: 4 });
  const fine = fbm(n, n, 0.6 / mm, 2, 72, { stretch: 6 });
  const dirt = fbm(n, n, 20 / mm, 3, 73);
  const joists = [92, 492];
  const nails: [number, number, number][] = [];
  for (const b of BOARDS)
    for (const y of [...joists, ...b.joints.map((j) => j - 18), ...b.joints.map((j) => j + 18)])
      for (const u of [26, b.x1 - b.x0 - 26]) nails.push([b.x0 + u, y + (hash(b.x0, y) - 0.5) * 6, hash(y, b.x0) * 0.4 - 0.2]);
  const nailAt = (x: number, y: number) => {
    for (const [nx, ny, rot] of nails) {
      const dx = x - nx;
      const dy = y - ny;
      if (dx * dx + dy * dy > 64) continue;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const u = dx * c + dy * s;
      const v = -dx * s + dy * c;
      const e = Math.max(Math.abs(u) / 2.3, Math.abs(v) / 3.2);
      if (e < 1.6) return e;
    }
    return 9;
  };
  for (let y = 0; y < n; y++) {
    const ym = y * mm;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const xm = x * mm;
      const b = BOARDS.findIndex((bd) => xm >= bd.x0 && xm < bd.x1 + 4);
      const bd = BOARDS[b];
      if (!bd || xm > bd.x1) {
        h[i] = -7;
        continue;
      }
      which[i] = b;
      const seg = bd.joints.filter((j) => ym > j).length;
      const nearJoint = bd.joints.reduce((m, j) => Math.min(m, Math.abs(ym - j)), 99);
      if (nearJoint < 1.2) {
        h[i] = -5;
        continue;
      }
      const w = bd.x1 - bd.x0;
      const u = xm - bd.x0;
      const seed = b * 7 + seg * 3;
      const r1 = hash(seed, 1);
      const r2 = hash(seed, 2);
      const r3 = hash(seed, 3);
      // Rings meet the board's face as arches: the face runs at a slight angle to the pith.
      const pith = (r1 - 0.5) * 2 * (60 + r2 * 160);
      const depth = 14 + r3 * 50 + (ym - seg * 300) * (0.03 + r2 * 0.04);
      const spacing = 2.6 + hash(seed, 4) * 1.8;
      let rr = Math.hypot(u - w / 2 - pith, depth) + warp[i] * (4 + r3 * 5);
      // A knot, with the grain swirling round it.
      const kx = w * (0.25 + hash(seed, 5) * 0.5);
      const ky = 60 + hash(seed, 6) * 560;
      const kr = 7 + hash(seed, 7) * 7;
      const hasKnot = hash(seed, 8) > 0.35;
      let knot = 0;
      if (hasKnot) {
        const kd = Math.hypot(u - kx, (ym - ky) * 0.8);
        rr += spacing * 3 * Math.exp(-((kd / (kr * 2.4)) ** 2));
        knot = smoothstep(kr, kr * 0.85, kd);
        if (knot > 0) rr = mix(rr, kd * 2.2, knot);
      }
      // Years differ: some rings are wide, some crowded, and the latewood band varies too.
      let ring = rr / spacing;
      ring += 0.5 * ringJitter(ring * 0.45, seed + 9);
      const f = ((ring % 1) + 1) % 1;
      const start = 0.5 + 0.16 * hash(Math.floor(ring), seed + 10);
      const late = smoothstep(start, start + 0.1, f) * (1 - smoothstep(0.9, 0.99, f));
      const arris = smoothstep(0, 3.5, Math.min(u, w - u)) * smoothstep(0, 3, nearJoint);
      const cup = 0.18 * ((u / w - 0.5) * 2) ** 2;
      let v = 0.24 * late + 0.025 * fine[i] + cup + knot * 0.15;
      v = mix(-1.2, v, arris);
      const nail = nailAt(xm, ym);
      if (nail < 1.6) v = mix(v, 0.12 - 0.05 * nail * nail, smoothstep(1.6, 1.25, nail));
      h[i] = v;
      lateness[i] = late;
      what[i] = nail < 1.3 ? 3 : knot > 0.5 ? 2 : 1;
      stain[i] = nail < 7 ? (7 - nail) / 7 : 0;
    }
  }
  return {
    h,
    paint(cav) {
      const rgb = new Uint8Array(n * n * 3);
      const gloss = new Uint8Array(n * n);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const k = what[i];
          if (k === 0) {
            put(rgb, i, 0.012, 0.008, 0.005);
            continue;
          }
          if (k === 3) {
            put(rgb, i, 0.05, 0.045, 0.04);
            gloss[i] = 120;
            continue;
          }
          const shade = 0.85 + 0.3 * hash(which[i], 11);
          const lw = lateness[i];
          let r = mix(0.36, 0.17, lw) * shade;
          let g = mix(0.2, 0.085, lw) * shade;
          let bl = mix(0.085, 0.032, lw) * shade;
          if (k === 2) {
            r = 0.1;
            g = 0.045;
            bl = 0.02;
          }
          // Grey grime in the soft grain, and rust bled from the nails.
          const grime = clamp(cav[i] * 1.4 + dirt[i] * 0.25);
          r = mix(r, 0.1, grime * 0.5);
          g = mix(g, 0.08, grime * 0.5);
          bl = mix(bl, 0.06, grime * 0.5);
          const rust = stain[i] * stain[i];
          r = mix(r, 0.09, rust * 0.6);
          g = mix(g, 0.035, rust * 0.6);
          bl = mix(bl, 0.015, rust * 0.6);
          put(rgb, i, r, g, bl);
          gloss[i] = Math.round(50 * lw);
        }
      return { rgb, gloss };
    },
  };
}

// 5. A bronze penny on a leather desk top.
function coin({ n, mm, masks }: Ctx): Surface {
  const h = new Float32Array(n * n);
  const rim = soft(masks.rim, n, 0.14 / mm);
  const beads = soft(masks.beads, n, 0.08 / mm);
  const letters = soft(masks.letters, n, 0.06 / mm);
  const thin = soft(masks.thin, n, 0.05 / mm);
  const incise = soft(masks.incise, n, 0.04 / mm);
  const figure = inside(masks.figure, n);
  const pebble = cellEdges(n, n, 0.5 / mm, 81);
  const wear = fbm(n, n, 3 / mm, 3, 82);
  const half = n / 2;
  const R = 0.258 * n;
  const lift = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const r = Math.hypot(x + 0.5 - half, y + 0.5 - half);
      const edge = smoothstep(R, R - 0.25 / mm, r);
      // Struck relief rises gently from the field and rounds over.
      const dome = 0.19 * Math.pow(smoothstep(0, 0.7, figure[i] * mm), 0.8);
      let top = 1.6 + 0.03 * (1 - (r / R) ** 2);
      top += 0.17 * Math.sqrt(rise(rim[i])) + 0.09 * rise(beads[i]) + 0.1 * rise(letters[i]);
      top += dome + 0.075 * smoothstep(0.3, 0.98, thin[i]) - 0.05 * rise(incise[i]) * (figure[i] > 0 ? 1 : 0);
      top -= 0.015 * smoothstep(0.2, 0.6, wear[i]);
      const desk = 0.03 * smoothstep(0, 0.15 * (0.5 / mm), pebble[i]);
      h[i] = mix(desk, top, edge);
      lift[i] = edge;
    }
  return {
    h,
    paint(cav) {
      const rgb = new Uint8Array(n * n * 3);
      const gloss = new Uint8Array(n * n);
      const tone = fbm(n, n, 8 / mm, 3, 83);
      const grain = fbm(n, n, 1 / mm, 2, 84);
      for (let i = 0; i < h.length; i++) {
        const e = lift[i];
        // Leather: oxblood, with dark creases between the pebbles.
        const crease = 1 - smoothstep(0, 0.12 * (0.5 / mm), pebble[i]);
        let r = mix(0.1, 0.045, crease) + 0.01 * grain[i];
        let g = mix(0.035, 0.018, crease);
        let b = mix(0.025, 0.014, crease);
        if (e > 0) {
          const c = cav[i];
          const high = 1 - smoothstep(0.0, 0.25, c);
          const toned = smoothstep(-0.3, 0.5, tone[i]);
          let cr = mix(0.3, 0.16, toned);
          let cg = mix(0.13, 0.07, toned);
          let cb = mix(0.05, 0.035, toned);
          cr = mix(cr, 0.07, smoothstep(0.3, 0.8, c));
          cg = mix(cg, 0.035, smoothstep(0.3, 0.8, c));
          cb = mix(cb, 0.02, smoothstep(0.3, 0.8, c));
          cr = mix(cr, 0.52, high * 0.7);
          cg = mix(cg, 0.26, high * 0.7);
          cb = mix(cb, 0.12, high * 0.7);
          r = mix(r, cr, e);
          g = mix(g, cg, e);
          b = mix(b, cb, e);
          gloss[i] = Math.round(255 * e * (0.35 + 0.5 * high));
        }
        put(rgb, i, r, g, b);
      }
      return { rgb, gloss };
    },
  };
}

const BRICK = [
  [0.3, 0.085, 0.045],
  [0.26, 0.075, 0.045],
  [0.34, 0.12, 0.06],
  [0.22, 0.08, 0.055],
  [0.29, 0.1, 0.06],
  [0.14, 0.055, 0.045],
];

// 6. A cast-iron notice on brickwork.
function plate({ n, mm, masks }: Ctx): Surface {
  const h = new Float32Array(n * n);
  const bricks = soft(masks.bricks, n, 3 / mm);
  const face = soft(masks.plate, n, 2.5 / mm);
  const cast = soft(masks.cast, n, 2 / mm);
  const letters = soft(masks.letters, n, 1.2 / mm);
  const rough = fbm(n, n, 4 / mm, 3, 61);
  const chips = fbm(n, n, 18 / mm, 3, 62);
  const grit = fbm(n, n, 1.5 / mm, 2, 63);
  const pits = fbm(n, n, 2 / mm, 2, 64);
  for (let i = 0; i < h.length; i++) {
    const brick = rise(bricks[i]);
    const chipped = smoothstep(0.35, 0.6, chips[i]) * 0.8;
    const wall = mix(-9 + 1.2 * grit[i], 0.5 * rough[i] - chipped * (1 - brick) * 2, brick);
    const iron = 10 + 3 * rise(cast[i]) + 3.4 * rise(letters[i]) - 0.3 * smoothstep(0.3, 0.65, pits[i]);
    h[i] = mix(wall, iron, rise(face[i]));
  }
  return {
    h,
    paint(cav) {
      const rgb = new Uint8Array(n * n * 3);
      const gloss = new Uint8Array(n * n);
      const flake = fbm(n, n, 7 / mm, 3, 65);
      const soot = fbm(n, n, 60 / mm, 3, 66);
      const unit = n / 1000;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const iron = rise(face[i]);
          // Brick and mortar, each brick its own shade.
          const row = Math.floor(y / unit / 81);
          const col = Math.floor((x / unit + 269 - (row % 2) * 134.5) / 269);
          const t = hash(row, col);
          const brick = rise(bricks[i]);
          // Stock bricks fired unevenly: reds, browns, and a few dark overburnt ones.
          const kiln = BRICK[Math.floor(t * BRICK.length)];
          const blot = 0.85 + 0.3 * flake[i] + 0.12 * grit[i];
          let r = mix(0.3 + 0.03 * grit[i], kiln[0] * blot, brick);
          let g = mix(0.28 + 0.03 * grit[i], kiln[1] * blot, brick);
          let b = mix(0.23 + 0.025 * grit[i], kiln[2] * blot, brick);
          const dark = smoothstep(-0.2, 0.6, soot[i]) * 0.45;
          r *= 1 - dark;
          g *= 1 - dark;
          b *= 1 - dark;
          if (iron > 0) {
            // Black paint, the letters and border picked out in cream, flaking to rust.
            const picked = Math.max(rise(cast[i]), rise(letters[i]));
            const bare = smoothstep(0.38, 0.55, flake[i] + cav[i] * 0.3);
            let ir = mix(0.022, 0.62, picked);
            let ig = mix(0.022, 0.58, picked);
            let ib = mix(0.024, 0.46, picked);
            ir = mix(ir, 0.16, bare);
            ig = mix(ig, 0.065, bare);
            ib = mix(ib, 0.03, bare);
            r = mix(r, ir, iron);
            g = mix(g, ig, iron);
            b = mix(b, ib, iron);
            gloss[i] = Math.round(140 * iron * (1 - bare));
          }
          put(rgb, i, r, g, b);
        }
      return { rgb, gloss };
    },
  };
}

export function compose(id: PlaceId, ctx: Ctx): Surface {
  switch (id) {
    case 'cover':
      return cover(ctx);
    case 'headstone':
      return headstone(ctx);
    case 'leaves':
      return leaves(ctx);
    case 'floor':
      return floor(ctx);
    case 'coin':
      return coin(ctx);
    case 'plate':
      return plate(ctx);
  }
}

