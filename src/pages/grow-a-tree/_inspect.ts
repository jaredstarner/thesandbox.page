// Naming what was tapped: find the part under the pointer, describe it, and
// draw a cross-section of the wood with one ring per year.

import * as THREE from 'three';
import { NEVER, type Plant } from './_grow';
import type { Pose } from './_pose';
import { hash1 } from './_rng';
import type { Species } from './_species';
import { swayAt, type Wind } from './_wind';

export interface Hit {
  kind: 'wood' | 'leaf' | 'seed';
  node: number;
  /** Leaf instance, for leaves. */
  leaf: number;
}

export interface SwayState {
  time: number;
  freq: number;
  breeze: number;
  height: number;
  wind: Wind;
}

const v = new THREE.Vector3();
const d3: [number, number, number] = [0, 0, 0];

function toScreen(cam: THREE.Camera, w: number, h: number, x: number, y: number, z: number): [number, number, number] {
  v.set(x, y, z).project(cam);
  return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h, v.z];
}

function displaced(x: number, y: number, z: number, flex: number, s: SwayState): [number, number, number] {
  swayAt(x, y, z, flex, s.time, s.freq, s.breeze, s.height, s.wind, d3);
  return [x + d3[0], y + d3[1], z + d3[2]];
}

/** The world position of a hit, as drawn now. */
export function hitPosition(hit: Hit, pose: Pose, s: SwayState, seedAt: THREE.Vector3): [number, number, number] {
  if (hit.kind === 'seed') return [seedAt.x, seedAt.y, seedAt.z];
  if (hit.kind === 'leaf') {
    const k = hit.leaf;
    const sz = pose.leafA[k * 4 + 3];
    return displaced(
      pose.leafPos[k * 3] + pose.leafA[k * 4] * sz * 0.5,
      pose.leafPos[k * 3 + 1] + pose.leafA[k * 4 + 1] * sz * 0.5,
      pose.leafPos[k * 3 + 2] + pose.leafA[k * 4 + 2] * sz * 0.5,
      pose.leafB[k * 4],
      s,
    );
  }
  const i = hit.node;
  return displaced(pose.ex[i], pose.ey[i], pose.ez[i], pose.flex[i], s);
}

export function pick(
  px: number,
  py: number,
  cam: THREE.PerspectiveCamera,
  w: number,
  h: number,
  pose: Pose,
  s: SwayState,
  seedAt: THREE.Vector3 | null,
  plugR: number,
): Hit | null {
  let best: Hit | null = null;
  let bestScore = Infinity;
  const scale = h / (2 * Math.tan((cam.fov * Math.PI) / 360));
  const camPos = cam.position;

  for (let k = 0; k < pose.segCount; k++) {
    const i = pose.segNode[k];
    const a = displaced(pose.segStart[k * 3], pose.segStart[k * 3 + 1], pose.segStart[k * 3 + 2], pose.segFlex[k * 2], s);
    const b = displaced(pose.segEnd[k * 3], pose.segEnd[k * 3 + 1], pose.segEnd[k * 3 + 2], pose.segFlex[k * 2 + 1], s);
    const sa = toScreen(cam, w, h, a[0], a[1], a[2]);
    const sb = toScreen(cam, w, h, b[0], b[1], b[2]);
    if (sa[2] > 1 || sb[2] > 1) continue;
    // Roots under the turf can't be seen from above.
    if (b[1] < 0 && camPos.y > 0) {
      const t = camPos.y / (camPos.y - b[1]);
      const gx = camPos.x + (b[0] - camPos.x) * t;
      const gz = camPos.z + (b[2] - camPos.z) * t;
      if (Math.hypot(gx, gz) < plugR) continue;
    }
    const dx = sb[0] - sa[0];
    const dy = sb[1] - sa[1];
    const l2 = dx * dx + dy * dy || 1e-6;
    const t = Math.max(0, Math.min(1, ((px - sa[0]) * dx + (py - sa[1]) * dy) / l2));
    const qx = sa[0] + dx * t - px;
    const qy = sa[1] + dy * t - py;
    const dist = Math.hypot(qx, qy);
    const depth = Math.hypot(b[0] - camPos.x, b[1] - camPos.y, b[2] - camPos.z) || 1;
    const rpx = (pose.segR[k * 2 + 1] * scale) / depth;
    const reach = Math.max(7, rpx + 3);
    if (dist > reach) continue;
    const score = dist / reach + depth * 1e-4;
    if (score < bestScore) {
      bestScore = score;
      best = { kind: 'wood', node: i, leaf: -1 };
    }
  }
  for (let k = 0; k < pose.leafCount; k++) {
    const sz = pose.leafA[k * 4 + 3];
    if (sz <= 0) continue;
    const p = displaced(
      pose.leafPos[k * 3] + pose.leafA[k * 4] * sz * 0.5,
      pose.leafPos[k * 3 + 1] + pose.leafA[k * 4 + 1] * sz * 0.5,
      pose.leafPos[k * 3 + 2] + pose.leafA[k * 4 + 2] * sz * 0.5,
      pose.leafB[k * 4],
      s,
    );
    const sp = toScreen(cam, w, h, p[0], p[1], p[2]);
    if (sp[2] > 1) continue;
    const depth = Math.hypot(p[0] - camPos.x, p[1] - camPos.y, p[2] - camPos.z) || 1;
    const reach = Math.max(8, ((sz * scale) / depth) * 0.45);
    const dist = Math.hypot(sp[0] - px, sp[1] - py);
    if (dist > reach) continue;
    const score = (dist / reach) * 0.9 + depth * 1e-4;
    if (score < bestScore) {
      bestScore = score;
      best = { kind: 'leaf', node: pose.leafNode[k], leaf: k };
    }
  }
  if (seedAt) {
    const sp = toScreen(cam, w, h, seedAt.x, seedAt.y, seedAt.z);
    const dist = Math.hypot(sp[0] - px, sp[1] - py);
    const depth = seedAt.distanceTo(camPos) || 1;
    const reach = Math.max(12, (0.012 * scale) / depth);
    if (dist < reach && dist / reach < bestScore) best = { kind: 'seed', node: 0, leaf: -1 };
  }
  return best;
}

export interface Description {
  kicker: string;
  title: string;
  text: string;
  rings?: { years: number; radius: number; hollow: number; born: number };
}

const yearOf = (a: number): number => Math.floor(a) + 1;

function where(y: number): string {
  if (y < 0) return y > -1 ? `${Math.round(-y * 100)} cm down` : `${(-y).toFixed(1)} m down`;
  return y < 1 ? `${Math.round(y * 100)} cm up` : `${y.toFixed(1)} m up`;
}

function hollowAt(sp: Species, age: number, y: number): number {
  if (y > 4) return 0;
  const start = sp.id === 'oak' ? 380 : sp.id === 'birch' ? 82 : 220;
  const span = sp.id === 'oak' ? 380 : sp.id === 'birch' ? 60 : 300;
  const most = sp.id === 'spruce' ? 0.4 : 0.62;
  return Math.max(0, Math.min(most, ((age - start) / span) * most));
}

export function describe(hit: Hit, plant: Plant, pose: Pose, sp: Species, age: number): Description {
  const common = sp.common;
  if (hit.kind === 'seed') {
    const title = sp.id === 'oak' ? 'Acorn' : 'Seed';
    const text =
      sp.id === 'oak'
        ? 'The seed, still in its cup. Its two seed leaves stay inside and feed the oak through its first season.'
        : sp.id === 'birch'
          ? 'A winged nutlet, a few millimetres across. Light enough to ride the wind a long way.'
          : 'A small seed on a single papery wing. Once the seedling is up, the seed coat is shed.';
    return { kicker: common, title, text };
  }
  if (hit.kind === 'leaf') {
    const kind = pose.leafB[hit.leaf * 4 + 2];
    if (kind === 4) {
      const fruit =
        sp.id === 'oak'
          ? {
              title: 'Acorns',
              text: 'Two or three to a long stalk, which is why this species is also called the pedunculate oak. They ripen and drop in autumn.',
            }
          : sp.id === 'birch'
            ? {
                title: 'Catkin',
                text: 'Male catkins hang out in spring and shed pollen to the wind; the female ones ripen into seed catkins that break up and scatter in late summer and autumn.',
              }
            : {
                title: 'Cone',
                text: 'Norway spruce cones are long and hang down from the upper branches. They open to let the winged seeds fall, then drop whole.',
              };
      return { kicker: `${common}, ${where(pose.ey[hit.node])}`, ...fruit };
    }
    if (kind === 1 || kind === 2) {
      return {
        kicker: `${common}, seed leaf`,
        title: 'Cotyledon',
        text:
          sp.id === 'spruce'
            ? 'One of a ring of seed leaves; a spruce seedling usually has several. They are the seed’s own store, opened to the light, and they feed the seedling until true needles take over.'
            : 'Part of the seed’s own store, lifted into the light as a first leaf. It feeds the seedling until true leaves take over, then withers.',
      };
    }
    const text =
      sp.leaf === 'oak'
        ? 'Lobed, on almost no stalk, with two small ear-like lobes where it meets the twig: the English oak’s tell.'
        : sp.leaf === 'birch'
          ? 'Small and triangular with a double-toothed edge, on a slender stalk that lets it flutter in the lightest air.'
          : 'Needles: stiff, sharp, and four-sided, each on a little peg that stays on the twig when the needle falls. A spruce keeps its needles for several years.';
    return { kicker: `${common}, ${where(pose.ey[hit.node])}`, title: sp.leaf === 'needle' ? 'Needles' : 'Leaf', text };
  }

  const i = hit.node;
  const y = pose.ey[i];
  const r = pose.radius[i];
  const years = Math.max(0, Math.floor(age - plant.birth[i]));
  const kicker = `${common}, ${where(y)}`;
  const rings = (born: number) => ({ years, radius: r, hollow: hollowAt(sp, age, y), born });

  if (plant.kind[i] === 1) {
    if (plant.axis[i]) {
      return {
        kicker,
        title: 'Taproot',
        text:
          sp.id === 'oak'
            ? 'Driven straight down in the oak’s first years to reach water. Later the tree leans more on wide, shallow roots.'
            : 'The first root, the radicle, grown straight down from the seed before the shoot appeared.',
      };
    }
    return {
      kicker,
      title: 'Root',
      text: 'Most of a tree’s roots sit in the top metre of soil and spread at least as wide as the crown. The fine roots, wrapped in fungi, do most of the drinking.',
    };
  }
  if (age >= plant.dead[i] && plant.dead[i] < NEVER) {
    const died = yearOf(plant.dead[i]);
    if (plant.dead[i] < sp.oldAge) {
      return {
        kicker,
        title: 'Shed branch',
        text: `It lost its light as the crown rose above it and died in year ${died}. A tree lets shaded limbs go rather than keep feeding them.`,
      };
    }
    return {
      kicker,
      title: 'Dead wood',
      text: `Died back in year ${died}. Standing dead wood is habitat: beetles and fungi feed on it, and birds and bats nest in the holes they leave.`,
    };
  }
  if (plant.axis[i]) {
    if (y < Math.max(0.05, r * 2.5) && r > 0.01) {
      return {
        kicker,
        title: 'Root flare',
        text: 'Where the trunk widens into the roots and spreads the tree’s weight into the soil. Burying it under mulch or fill is a common way to harm a tree.',
        rings: rings(plant.birth[i]),
      };
    }
    if (y > pose.height * 0.82 && years < 6) {
      const text =
        sp.id === 'spruce'
          ? 'The main shoot. It keeps control for the tree’s whole life, which is what keeps a spruce a cone.'
          : sp.id === 'birch'
            ? 'The main shoot. A birch keeps one stem through most of its life.'
            : age < sp.leaderLoss
              ? 'The main shoot, for now. Within a few decades the oak’s side branches catch up, and the single leader is lost.'
              : 'Once the leader. The crown has since spread into many stems.';
      return { kicker, title: 'Leader', text };
    }
    return {
      kicker,
      title: 'Trunk',
      text: `This part of the stem grew in year ${yearOf(plant.birth[i])}, so a cut here shows ${years} ring${years === 1 ? '' : 's'}. Higher up, the stem is younger and has fewer.`,
      rings: years >= 1 ? rings(plant.birth[i]) : undefined,
    };
  }
  if (plant.children[i] === 0 || years < 1) {
    return {
      kicker,
      title: 'Shoot tip',
      text: 'A growing point. Next season’s shoot waits folded in the bud, and hormones from the tip hold back the buds below it: apical dominance.',
    };
  }
  if (plant.order[i] <= 1 && r > 0.015) {
    return {
      kicker,
      title: 'Branch',
      text: `A limb grown from a bud on the stem in year ${yearOf(plant.birth[i])}. Like the trunk, it adds a ring of wood every year it lives.`,
      rings: years >= 1 ? rings(plant.birth[i]) : undefined,
    };
  }
  return {
    kicker,
    title: 'Twig',
    text: `A shoot from year ${yearOf(plant.birth[i])}. Twigs carry the leaves; the thick wood behind them only holds them up to the light.`,
  };
}

/** One ring per year, wide when the tree was young and in good years, with heartwood and any hollow. */
export function drawRings(canvas: HTMLCanvasElement, sp: Species, seed: number, rings: NonNullable<Description['rings']>): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const cx = W / 2;
  const R = W * 0.46;
  ctx.clearRect(0, 0, W, W);
  const n = Math.max(1, rings.years);
  const widths: number[] = [];
  let sum = 0;
  const startYear = Math.floor(rings.born);
  for (let k = 0; k < n; k++) {
    const good = 0.55 + 0.9 * hash1(seed * 31 + startYear + k);
    const w = good / Math.sqrt(k + 3);
    widths.push(w);
    sum += w;
  }
  const bark = sp.id === 'birch' ? 0.035 : 0.07;
  const inner = R * (1 - bark);
  const wobble = (t: number, rr: number) => rr * (1 + 0.025 * Math.sin(3 * t + seed) + 0.015 * Math.sin(7 * t + seed * 2));
  const shape = (rr: number) => {
    ctx.beginPath();
    for (let s = 0; s <= 96; s++) {
      const t = (s / 96) * Math.PI * 2;
      const q = wobble(t, rr);
      if (s === 0) ctx.moveTo(cx + Math.cos(t) * q, cx + Math.sin(t) * q);
      else ctx.lineTo(cx + Math.cos(t) * q, cx + Math.sin(t) * q);
    }
    ctx.closePath();
  };
  // Bark.
  shape(R);
  ctx.fillStyle = sp.id === 'birch' ? '#d9d2c4' : sp.id === 'oak' ? '#4e463b' : '#6b4a36';
  ctx.fill();
  // Sapwood, then heartwood toward the middle.
  const sap = sp.id === 'oak' ? '#d8b98a' : sp.id === 'birch' ? '#e9dcc2' : '#ead7b0';
  const heart = sp.id === 'oak' ? '#9b6e3f' : sp.id === 'birch' ? '#e2d2b4' : '#dcc196';
  shape(inner);
  ctx.fillStyle = sap;
  ctx.fill();
  const heartRings = Math.max(0, n - (sp.id === 'oak' ? 22 : 35));
  let acc = 0;
  for (let k = 0; k < heartRings; k++) acc += widths[k];
  if (heartRings > 0) {
    shape((acc / sum) * inner);
    ctx.fillStyle = heart;
    ctx.fill();
  }
  // Latewood lines.
  const line = sp.id === 'oak' ? 'rgba(90,55,25,' : sp.id === 'birch' ? 'rgba(150,120,85,' : 'rgba(140,90,45,';
  const alpha = Math.min(0.85, Math.max(0.18, 3.5 / Math.sqrt(n)));
  ctx.lineWidth = Math.max(0.6, Math.min(2, (inner / n) * 0.45));
  acc = 0;
  for (let k = 0; k < n; k++) {
    acc += widths[k];
    shape((acc / sum) * inner);
    ctx.strokeStyle = `${line}${alpha})`;
    ctx.stroke();
  }
  // Oak's rays, running out from the pith.
  if (sp.id === 'oak' && n > 6) {
    ctx.strokeStyle = 'rgba(245,225,190,0.45)';
    ctx.lineWidth = 1;
    for (let k = 0; k < 44; k++) {
      const t = hash1(seed + k * 13) * Math.PI * 2;
      const r0 = hash1(seed + k * 7) * inner * 0.6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(t) * r0, cx + Math.sin(t) * r0);
      ctx.lineTo(cx + Math.cos(t) * inner * 0.97, cx + Math.sin(t) * inner * 0.97);
      ctx.stroke();
    }
  }
  // Pith.
  ctx.beginPath();
  ctx.arc(cx, cx, 1.6, 0, Math.PI * 2);
  ctx.fillStyle = '#5a3d22';
  ctx.fill();
  // A hollow heart in old trunks.
  if (rings.hollow > 0) {
    const hr = rings.hollow * inner;
    ctx.beginPath();
    for (let s = 0; s <= 64; s++) {
      const t = (s / 64) * Math.PI * 2;
      const q = hr * (0.8 + 0.35 * hash1(seed + s * 3 + (s === 64 ? -192 : 0)));
      if (s === 0) ctx.moveTo(cx + Math.cos(t) * q, cx + Math.sin(t) * q);
      else ctx.lineTo(cx + Math.cos(t) * q, cx + Math.sin(t) * q);
    }
    ctx.closePath();
    ctx.fillStyle = '#231a12';
    ctx.fill();
  }
}
