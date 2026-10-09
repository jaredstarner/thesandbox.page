// The tree at one age: which nodes show, how thick each is (pipe model plus
// annual rings), how far each bends in the wind, and where the leaves go.
// Written straight into the instance buffers the renderer draws.

import { NEVER, type Plant } from './_grow';
import { hash1 } from './_rng';
import { heightAt, type Species } from './_species';

export const SEG_CAP = 70000;
export const LEAF_CAP = 90000;

export interface Pose {
  segCount: number;
  segStart: Float32Array;
  segEnd: Float32Array;
  segR: Float32Array;
  segFlex: Float32Array;
  segDist: Float32Array;
  segInfo: Float32Array;
  segNode: Int32Array;
  leafCount: number;
  leafPos: Float32Array;
  leafA: Float32Array;
  leafB: Float32Array;
  leafNode: Int32Array;
  /** Per node, at this age. */
  radius: Float32Array;
  flex: Float32Array;
  shown: Uint8Array;
  /** Visible end of each node (partly grown shoots are shorter). */
  ex: Float32Array;
  ey: Float32Array;
  ez: Float32Array;
  height: number;
  crownR: number;
  crownMid: number;
  rootDepth: number;
  rootR: number;
  trunkR: number;
  leafAmount: number;
}

export function makePose(cap: number): Pose {
  return {
    segCount: 0,
    segStart: new Float32Array(SEG_CAP * 3),
    segEnd: new Float32Array(SEG_CAP * 3),
    segR: new Float32Array(SEG_CAP * 2),
    segFlex: new Float32Array(SEG_CAP * 2),
    segDist: new Float32Array(SEG_CAP * 2),
    segInfo: new Float32Array(SEG_CAP * 2),
    segNode: new Int32Array(SEG_CAP),
    leafCount: 0,
    leafPos: new Float32Array(LEAF_CAP * 3),
    leafA: new Float32Array(LEAF_CAP * 4),
    leafB: new Float32Array(LEAF_CAP * 4),
    leafNode: new Int32Array(LEAF_CAP),
    radius: new Float32Array(cap),
    flex: new Float32Array(cap),
    shown: new Uint8Array(cap),
    ex: new Float32Array(cap),
    ey: new Float32Array(cap),
    ez: new Float32Array(cap),
    height: 0,
    crownR: 0,
    crownMid: 0,
    rootDepth: 0,
    rootR: 0,
    trunkR: 0,
    leafAmount: 0,
  };
}

const acc = new Float32Array(70000);
const pipe = new Float32Array(70000);

/** Twig thickness by the plant's height when the twig grew: a seedling's shoots are fine. */
const tipCache = new WeakMap<Plant, { n: number; tip: Float32Array }>();
function tipScales(plant: Plant, sp: Species): Float32Array {
  let c = tipCache.get(plant);
  if (!c) {
    c = { n: 0, tip: new Float32Array(plant.x.length) };
    tipCache.set(plant, c);
  }
  for (let i = c.n; i < plant.n; i++) c.tip[i] = Math.min(1, 0.22 + heightAt(sp, plant.birth[i]) / 4);
  c.n = plant.n;
  return c.tip;
}

/** How long a new shoot takes to reach full length, by when it was born. */
const growTime = (birth: number): number => Math.max(0.02, Math.min(0.6, 0.03 + birth * 0.05));

export function computePose(pose: Pose, plant: Plant, sp: Species, age: number): void {
  const n = plant.n;
  const { x, y, z, parent, birth, dead, fall, kind } = plant;
  const { radius, flex, shown, ex, ey, ez } = pose;
  const N = sp.pipeN;
  const tipR = sp.tipR;

  // Visibility and partly grown ends.
  shown[0] = 1;
  ex[0] = ey[0] = ez[0] = 0;
  for (let i = 1; i < n; i++) {
    const vis = birth[i] <= age && fall[i] > age && shown[parent[i]] === 1;
    shown[i] = vis ? 1 : 0;
    if (!vis) continue;
    const g = Math.min(1, (age - birth[i]) / growTime(birth[i]));
    const p = parent[i];
    ex[i] = ex[p] + (x[i] - x[p]) * g;
    ey[i] = ey[p] + (y[i] - y[p]) * g;
    ez[i] = ez[p] + (z[i] - z[p]) * g;
    acc[i] = 0;
  }
  acc[0] = 0;

  // Pipe model, tips first: a branch carries the r^n of everything above it.
  let rootCollar = 0;
  const tipScale = tipScales(plant, sp);
  for (let i = n - 1; i >= 1; i--) {
    if (!shown[i]) continue;
    const g = Math.min(1, (age - birth[i]) / growTime(birth[i]));
    const tip = (kind[i] ? tipR * 0.8 : tipR) * tipScale[i] * (0.35 + 0.65 * g);
    const s = acc[i] > 0 ? acc[i] : Math.pow(tip, N);
    pipe[i] = Math.pow(s, 1 / N);
    const p = parent[i];
    if (p === 0 && kind[i] === 1) rootCollar += s;
    else acc[p] += s;
  }
  pipe[0] = Math.pow(acc[0] || Math.pow(tipR * 0.5, N), 1 / N);

  // Wood laid down in annual rings, mostly on stout wood.
  const h = heightAt(sp, age);
  let trunkR = 0;
  for (let i = 0; i < n; i++) {
    if (!shown[i]) continue;
    const r0 = i === 0 ? pipe[0] : pipe[i];
    const years = Math.max(0, age - birth[i]);
    const stout = Math.min(1, r0 / 0.06);
    const share = kind[i] ? 0.5 : plant.axis[i] ? 1 : 0.45;
    let r = r0 + sp.ring * share * years * stout * stout;
    if (kind[i] === 0 && y[i] < 1.5) {
      const reach = Math.max(0.02, r * 2.2);
      r *= 1 + sp.flare * Math.exp(-Math.max(0, y[i]) / reach);
    }
    radius[i] = r;
    if (i === 0) trunkR = r;
  }
  void rootCollar;

  // Flex: thin wood far from the base bends most.
  let maxFlex = 0;
  flex[0] = 0;
  const stiff = tipR * 10;
  for (let i = 1; i < n; i++) {
    if (!shown[i] || kind[i]) {
      flex[i] = 0;
      continue;
    }
    const p = parent[i];
    const l = Math.hypot(ex[i] - ex[p], ey[i] - ey[p], ez[i] - ez[p]);
    flex[i] = flex[p] + l * Math.sqrt(stiff / Math.max(radius[i], stiff * 0.25));
    if (flex[i] > maxFlex) maxFlex = flex[i];
  }
  const amp = 0.03 * Math.pow(Math.max(h, 0.05), 0.85) + 0.004;
  const fs = maxFlex > 0 ? amp / maxFlex : 0;
  for (let i = 1; i < n; i++) if (shown[i]) flex[i] *= fs;

  // Segments.
  let sc = 0;
  let height = 0;
  let crownR = 0;
  let rootDepth = 0;
  let rootR = 0;
  const { segStart, segEnd, segR, segFlex, segDist, segInfo, segNode } = pose;
  for (let i = 1; i < n && sc < SEG_CAP; i++) {
    if (!shown[i]) continue;
    const p = parent[i];
    const k = sc * 3;
    const sx = p === 0 ? 0 : ex[p];
    const sy = p === 0 ? (kind[i] ? -0.002 : 0) : ey[p];
    const sz = p === 0 ? 0 : ez[p];
    segStart[k] = sx;
    segStart[k + 1] = sy;
    segStart[k + 2] = sz;
    segEnd[k] = ex[i];
    segEnd[k + 1] = ey[i];
    segEnd[k + 2] = ez[i];
    const r1 = radius[i];
    const rp = p === 0 ? (kind[i] ? radius[i] * 1.1 : radius[0]) : radius[p];
    segR[sc * 2] = Math.min(rp, r1 * 1.3);
    segR[sc * 2 + 1] = r1;
    segFlex[sc * 2] = flex[p];
    segFlex[sc * 2 + 1] = flex[i];
    segDist[sc * 2] = plant.dist[p];
    segDist[sc * 2 + 1] = plant.dist[i];
    segInfo[sc * 2] = dead[i] < NEVER ? Math.min(1, Math.max(0, (age - dead[i]) / 3)) : 0;
    segInfo[sc * 2 + 1] = kind[i];
    segNode[sc] = i;
    sc++;
    if (kind[i] === 0) {
      if (ey[i] > height) height = ey[i];
      const rr = Math.hypot(ex[i], ez[i]);
      if (rr > crownR) crownR = rr;
    } else {
      if (-ey[i] > rootDepth) rootDepth = -ey[i];
      const rr = Math.hypot(ex[i], ez[i]);
      if (rr > rootR) rootR = rr;
    }
  }
  pose.segCount = sc;
  pose.height = height;
  pose.crownR = crownR;
  pose.rootDepth = rootDepth;
  pose.rootR = rootR;
  pose.trunkR = trunkR;
  pose.crownMid = height * (0.5 + sp.crownBase(age) * 0.5);

  // Leaves on living twigs.
  let lc = 0;
  const { leafPos, leafA, leafB, leafNode } = pose;
  const leafyR = tipR * sp.leafyR;
  const needle = sp.leaf === 'needle';
  const young = !needle && h < 2.2;
  const per = young ? 1 : sp.leavesPerNode;
  const leafMin = young ? sp.leafMin * 0.8 : Math.max(sp.leafMin, h * (needle ? 0.016 : 0.011));
  for (let i = 1; i < n && lc < LEAF_CAP - per; i++) {
    if (!shown[i] || kind[i] || age >= dead[i]) continue;
    if (pipe[i] > leafyR) continue;
    const since = age - birth[i];
    if (since < 0.04) continue;
    const p = parent[i];
    const dx = ex[i] - ex[p];
    const dy = ey[i] - ey[p];
    const dz = ez[i] - ez[p];
    const len = Math.hypot(dx, dy, dz) || 1e-4;
    const grown = Math.min(1, since / 0.35);
    const size = (young ? Math.min(sp.leafMin * 2.2, Math.max(leafMin, len * 1.4)) : Math.min(sp.leafMax, Math.max(leafMin, len * sp.leafScale))) * grown;
    for (let s = 0; s < per; s++) {
      const hsh = hash1(i * 13 + s * 7 + 1);
      const h2 = hash1(i * 31 + s * 11 + 5);
      const h3 = hash1(i * 17 + s * 3 + 9);
      // Spread along the segment, offset a little off the wood.
      const t = needle ? (s + 0.5) / per : 0.35 + 0.65 * hsh;
      const k = lc * 3;
      leafPos[k] = ex[p] + dx * t;
      leafPos[k + 1] = ey[p] + dy * t;
      leafPos[k + 2] = ez[p] + dz * t;
      const q = lc * 4;
      if (needle) {
        leafA[q] = dx / len;
        leafA[q + 1] = dy / len;
        leafA[q + 2] = dz / len;
      } else {
        // Leaves angle outward from the shoot and toward the light.
        const ang = h2 * Math.PI * 2;
        let ox = Math.cos(ang) * 0.9 + (dx / len) * 0.6;
        let oy = (sp.liftHigher < -0.3 ? -0.5 : 0.55) + h3 * 0.5 + (dy / len) * 0.4;
        let oz = Math.sin(ang) * 0.9 + (dz / len) * 0.6;
        const ol = Math.hypot(ox, oy, oz) || 1;
        ox /= ol;
        oy /= ol;
        oz /= ol;
        leafA[q] = ox;
        leafA[q + 1] = oy;
        leafA[q + 2] = oz;
      }
      leafA[q + 3] = size * (needle ? 1 : 0.8 + 0.4 * h3);
      leafB[q] = flex[i] * (0.6 + 0.4 * t) + flex[p] * (0.4 - 0.4 * t);
      leafB[q + 1] = hsh;
      leafB[q + 2] = young ? 3 : 0;
      leafB[q + 3] = h2 * Math.PI * 2;
      leafNode[lc] = i;
      lc++;
    }
  }

  // Seed leaves, for a season after the shoot breaks the soil.
  if (sp.cotyledons > 0 && plant.cotyledons.length && age > sp.emerge && age < sp.emerge + 0.9) {
    const c = plant.cotyledons[0];
    if (shown[c]) {
      const life = age - sp.emerge;
      const open = Math.min(1, life / 0.08);
      const fade = life > 0.7 ? Math.max(0, 1 - (life - 0.7) / 0.2) : 1;
      const count = sp.cotyledons;
      for (let s = 0; s < count && lc < LEAF_CAP; s++) {
        const ang = (s / count) * Math.PI * 2 + 0.4;
        const lift = needle ? 0.6 : 0.25;
        const k = lc * 3;
        leafPos[k] = ex[c];
        leafPos[k + 1] = ey[c];
        leafPos[k + 2] = ez[c];
        const q = lc * 4;
        const ox = Math.cos(ang);
        const oz = Math.sin(ang);
        const l = Math.hypot(1, lift);
        leafA[q] = ox / l;
        leafA[q + 1] = lift / l;
        leafA[q + 2] = oz / l;
        leafA[q + 3] = (needle ? 0.016 : 0.011) * open * fade;
        leafB[q] = flex[c];
        leafB[q + 1] = 0.5;
        leafB[q + 2] = needle ? 2 : 1;
        leafB[q + 3] = 0;
        leafNode[lc] = c;
        lc++;
      }
    }
  }
  pose.leafCount = lc;
  pose.leafAmount = Math.min(1, lc / 4000);
}
