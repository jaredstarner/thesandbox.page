// The view of a place (fixed for that place) and its blocks for one hour's weather.
// The image is 1000 x 1500 units, a vertical sheet with the sky above a lake or the sea.

import { moonIllumination, moonPosition, sunPosition, type MoonLight, type SkyPos } from './_sky';
import {
  clamp,
  css,
  fbm1,
  hashString,
  lerp,
  mix,
  mulberry32,
  smoothstep,
  type RGB,
  type Rng,
} from './_util';
import { describe, type Forecast, type Hour, type Kind } from './_weather';

export const IW = 1000;
export const IH = 1500;
export const MARGIN = 46;
export const SW = IW + 2 * MARGIN;
export const SH = IH + 2 * MARGIN;

const N = 101; // ridge samples, one every 10 units
const at = (arr: Float32Array, x: number) => {
  const f = clamp(x / 10, 0, N - 1);
  const i = Math.min(N - 2, Math.floor(f));
  return lerp(arr[i], arr[i + 1], f - i);
};

interface House {
  x: number;
  y: number;
  w: number;
  h: number;
  rh: number;
  gable: boolean;
  tile: boolean;
  windows: [number, number, number, number][];
  door: [number, number, number, number] | null;
  chimney: [number, number, number] | null;
}

interface Lump {
  dx: number;
  dy: number;
  rx: number;
  ry: number;
}

interface Cloud {
  x: number;
  y: number;
  w: number;
  lumps: Lump[];
}

interface Branch {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
}

interface Tree {
  pine: boolean;
  x: number;
  base: number;
  top: number;
  lean: number;
  branches: Branch[];
  pads: Lump[];
}

export interface Scene {
  key: string;
  seed: number;
  mirror: boolean;
  sea: boolean;
  horizon: number;
  far: Float32Array;
  far2: Float32Array;
  grove: Float32Array;
  ground: Float32Array;
  farHouses: House[];
  houses: House[];
  tree: Tree;
  path: { x0: number; w0: number; x1: number; w1: number; y1: number; bend: number };
  figure: { x: number; y: number; s: number };
  boat: { x: number; y: number; s: number } | null;
  clouds: Cloud[];
  stars: [number, number, number][];
  groveBumps: [number, number, number][];
  ripples: [number, number, number][];
  tufts: [number, number, number][];
  flakes: [number, number, number][];
  rain: [number, number, number][];
}

function makeHouse(rng: Rng, x: number, y: number, w: number): House {
  const h = w * (0.42 + rng() * 0.16);
  const rh = w * (0.32 + rng() * 0.14);
  const gable = rng() < 0.45;
  const windows: [number, number, number, number][] = [];
  const nw = w > 60 ? 1 + Math.floor(rng() * 2.4) : 1;
  const ww = Math.max(3, w * 0.13);
  const wh = Math.max(3, h * 0.3);
  for (let i = 0; i < nw; i++) {
    const cx = x + w * ((i + 1) / (nw + 1)) + (gable ? 0 : w * 0.08);
    windows.push([cx - ww / 2, y - h * 0.68, ww, wh]);
  }
  const door: House['door'] = w > 60 ? [x + w * (gable ? 0.42 : 0.16), y - h * 0.62, w * 0.14, h * 0.62] : null;
  const chimney: House['chimney'] = w > 60 && rng() < 0.7 ? [x + w * (0.2 + rng() * 0.55), w * 0.07, rh * 0.75] : null;
  return { x, y, w, h, rh, gable, tile: rng() < 0.5, windows, door, chimney };
}

/** The view for a place: the same every visit, whatever the weather. */
export function makeScene(key: string, elevation: number): Scene {
  const seed = hashString(key);
  const rng = mulberry32(seed);
  const mirror = rng() < 0.5;
  const sea = elevation < 40 && rng() < 0.55;
  const horizon = 760 + rng() * 70;
  const mx = (x: number) => (mirror ? IW - x : x);

  const fFar = fbm1(seed + 1, 5);
  const fFar2 = fbm1(seed + 2, 4);
  const fGrove = fbm1(seed + 3, 3);
  const fGround = fbm1(seed + 4, 3);
  const amp = 150 + clamp(elevation / 2200) * 230 + rng() * 60;
  const cx = sea ? 0.18 + rng() * 0.18 : 0.3 + rng() * 0.45;
  const cx2 = sea ? 0.1 + rng() * 0.2 : clamp(1 - cx + (rng() - 0.5) * 0.3, 0.1, 0.9);

  const far = new Float32Array(N);
  const far2 = new Float32Array(N);
  const grove = new Float32Array(N);
  const ground = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const side = sea ? 1 - smoothstep(0.35, 0.62, u) : 1;
    const env = (0.22 + 0.78 * Math.exp(-(((u - cx) / 0.27) ** 2))) * side;
    far[i] = horizon - amp * env * (0.5 + 0.5 * fFar(u * 3.4)) - 6 * side;
    const env2 = (0.3 + 0.7 * Math.exp(-(((u - cx2) / 0.33) ** 2))) * (sea ? 1 - smoothstep(0.2, 0.42, u) : 1);
    far2[i] = horizon - amp * 0.42 * env2 * (0.45 + 0.55 * fFar2(u * 4.1)) - 2;
    grove[i] = sea ? horizon : horizon - 14 - 22 * fGrove(u * 6);
    const bank = 95 * (1 - smoothstep(0.04, 0.5, u));
    ground[i] = 1185 - bank + 16 * (fGround(u * 5) - 0.5);
  }
  if (mirror) {
    far.reverse();
    far2.reverse();
    grove.reverse();
    ground.reverse();
  }

  const groveBumps: [number, number, number][] = [];
  if (!sea) {
    for (let x = -4; x < IW + 8; x += 7 + rng() * 9) {
      const r = 6 + rng() * 9;
      groveBumps.push([x, at(grove, x) + r * 0.6, r]);
    }
  }

  const farHouses: House[] = [];
  if (!sea) {
    const n = 3 + Math.floor(rng() * 5);
    let x = 260 + rng() * 120;
    for (let i = 0; i < n && x < 900; i++) {
      const w = 13 + rng() * 14;
      farHouses.push(makeHouse(rng, mx(x) - (mirror ? w : 0), horizon + 3, w));
      x += w + 2 + rng() * (rng() < 0.3 ? 70 : 12);
    }
  }

  const houses: House[] = [];
  const hn = 2 + Math.floor(rng() * 2);
  let hx = 560 + rng() * 50;
  for (let i = 0; i < hn; i++) {
    const w = 150 + rng() * 60 - i * 14;
    const x = mx(hx) - (mirror ? w : 0);
    const y = at(ground, x + w / 2) + 60 + (i % 2) * 34 + rng() * 14;
    houses.push(makeHouse(rng, x, y, w));
    hx += w * (0.62 + rng() * 0.22);
    if (hx > 900) break;
  }
  // Back to front, so nearer houses draw over farther ones.
  houses.sort((a, b) => a.y - b.y);

  const pine = rng() < 0.5;
  const tx = mx(110 + rng() * 60);
  const dir = mirror ? -1 : 1;
  const crown = 360 + rng() * 140;
  const base = at(ground, tx) + 150;
  const top = pine ? crown : lerp(base, crown, 0.6);
  const tree: Tree = {
    pine,
    x: tx,
    base,
    top,
    lean: dir * (pine ? 40 + rng() * 60 : 15 + rng() * 25),
    branches: [],
    pads: [],
  };
  const trunkAt = (y: number) => {
    const u = (tree.base - y) / (tree.base - top);
    return tx + tree.lean * u * u + 14 * Math.sin(u * 5 + seed) + 4 * Math.sin(u * 7 + seed * 2);
  };
  if (pine) {
    const nb = 5 + Math.floor(rng() * 3);
    for (let i = 0; i < nb; i++) {
      const u = 0.3 + (i / nb) * 0.72;
      const y0 = lerp(tree.base, top, u);
      const x0 = trunkAt(y0);
      const reach = (180 - u * 90) * (0.7 + rng() * 0.6) * (i % 2 === 0 ? dir : -dir * 0.55);
      const x1 = x0 + reach;
      const y1 = y0 - 30 - rng() * 50;
      tree.branches.push({ x0, y0, x1, y1, w: 12 - u * 7 });
      const pw = Math.abs(reach) * 0.55 + 50;
      // Each pad a cloud of needle tufts lying along the branch.
      const tufts = 3 + Math.floor(rng() * 2);
      for (let k = 0; k < tufts; k++) {
        const u2 = k / (tufts - 1) - 0.5;
        tree.pads.push({
          dx: x1 + u2 * pw * 1.1 + (rng() - 0.5) * 10,
          dy: y1 - 8 + Math.abs(u2) * 14 + (rng() - 0.5) * 6,
          rx: pw * (0.36 + rng() * 0.12) * (1 - Math.abs(u2) * 0.5),
          ry: 17 + rng() * 9 - Math.abs(u2) * 6,
        });
      }
    }
    for (let k = 0; k < 3; k++)
      tree.pads.push({ dx: trunkAt(top) + dir * 10 + (k - 1) * 40, dy: top - 8 - (k === 1 ? 10 : 0), rx: 42, ry: 22 });
  } else {
    // A broadleaf: the trunk forks into a fan of limbs, each carrying rounded masses of leaves.
    const clump = (cx: number, cy: number, r: number) => {
      for (let k = 0; k < 15; k++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * r * 0.72;
        const pr = r * (0.26 + rng() * 0.2);
        tree.pads.push({ dx: cx + Math.cos(a) * d * 1.25, dy: cy + Math.sin(a) * d * 0.75, rx: pr, ry: pr * 0.86 });
      }
    };
    const fx = trunkAt(tree.top);
    const fy = tree.top;
    const limbs = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < limbs; i++) {
      const a = -Math.PI / 2 + ((i / (limbs - 1)) - 0.5) * 1.9 + (rng() - 0.5) * 0.25 + dir * 0.12;
      const len = 150 + rng() * 90 - Math.abs((i / (limbs - 1)) - 0.5) * 60;
      const x0 = fx + (rng() - 0.5) * 10;
      const y0 = fy + 8;
      const x1 = x0 + Math.cos(a) * len;
      const y1 = y0 + Math.sin(a) * len;
      tree.branches.push({ x0, y0, x1, y1, w: 9 + rng() * 3 });
      clump(x1, y1 - 10, 82 + rng() * 34);
      clump(lerp(x0, x1, 0.55), lerp(y0, y1, 0.55) - 14, 56 + rng() * 20);
    }
    clump(fx, fy - 22, 72);
  }

  const pathX0 = mx(560 + rng() * 120);
  const pathX1 = mx(470 + rng() * 120);
  const path = { x0: pathX0, w0: 230, x1: pathX1, w1: 26, y1: at(ground, pathX1) + 8, bend: (rng() - 0.5) * 160 };
  const fy = lerp(path.y1, IH, 0.42);
  const fu = (fy - path.y1) / (IH - path.y1);
  const figure = { x: lerp(path.x1, path.x0, fu) + path.bend * Math.sin(fu * Math.PI) * 0.5, y: fy, s: 0.95 + fu * 0.8 };

  const boat = sea ? { x: mx(520 + rng() * 260), y: horizon + 110 + rng() * 120, s: 1.1 + rng() * 0.5 } : null;

  const clouds: Cloud[] = [];
  for (let i = 0; i < 16; i++) {
    const w = 170 + rng() * 300;
    const lumps: Lump[] = [];
    const n = 4 + Math.floor(rng() * 5);
    for (let j = 0; j < n; j++) {
      const u = (j + 0.5) / n - 0.5;
      lumps.push({
        dx: u * w + (rng() - 0.5) * 30,
        dy: -Math.cos(u * Math.PI) * 14 + (rng() - 0.5) * 10,
        rx: w / n + 20 + rng() * 30,
        ry: 18 + rng() * 22 + Math.cos(u * Math.PI) * 14,
      });
    }
    clouds.push({ x: rng(), y: 90 + rng() * (horizon - 330), w, lumps });
  }

  const stars: [number, number, number][] = [];
  for (let i = 0; i < 150; i++) stars.push([rng() * IW, rng() * (horizon - 120), 0.9 + rng() ** 3 * 2.4]);

  const ripples: [number, number, number][] = [];
  for (let i = 0; i < 170; i++) {
    const u = rng() ** 1.5;
    const y = horizon + 6 + u * (1180 - horizon);
    ripples.push([rng() * IW, y, (14 + u * 110) * (0.45 + rng() * 0.8)]);
  }

  const tufts: [number, number, number][] = [];
  for (let i = 0; i < 46; i++) {
    const x = rng() * IW;
    tufts.push([x, at(ground, x) + 16 + rng() ** 1.3 * (IH - at(ground, x) - 24), 9 + rng() * 14]);
  }

  const flakes: [number, number, number][] = [];
  for (let i = 0; i < 520; i++) flakes.push([rng() * IW, rng() * IH, 1.6 + rng() ** 2 * 3.6]);
  const rain: [number, number, number][] = [];
  for (let i = 0; i < 420; i++) rain.push([rng() * IW * 1.4 - IW * 0.2, rng() * IH, 50 + rng() * 120]);

  return {
    key,
    seed,
    mirror,
    sea,
    horizon,
    far,
    far2,
    grove,
    ground,
    farHouses,
    houses,
    tree,
    path,
    figure,
    boat,
    clouds,
    stars,
    groveBumps,
    ripples,
    tufts,
    flakes,
    rain,
  };
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface Cond {
  hour: Hour;
  kind: Kind;
  sun: SkyPos;
  moon: SkyPos;
  moonLight: MoonLight;
  /** 0 at night, 1 in full day. */
  day: number;
  /** Strength of a sunrise or sunset glow, 0..1. */
  glow: number;
  dawn: boolean;
  overcast: number;
  /** 0..1, how far you can see. */
  clarity: number;
  mist: number;
  wet: number;
  season: Season;
  snowCover: number;
  /** Wind across the view, -1 (to the left) .. 1, and its strength 0..1. */
  windX: number;
  windY: number;
  breeze: number;
  /** The bearing the view faces: south in the northern hemisphere. */
  facing: number;
  localHour: number;
  localDay: number;
  localMonth: number;
  localYear: number;
}

export function localParts(t: number, utcOffset: number) {
  const d = new Date(t + utcOffset * 1000);
  return {
    hour: d.getUTCHours(),
    day: d.getUTCDate(),
    month: d.getUTCMonth(),
    year: d.getUTCFullYear(),
    weekday: d.getUTCDay(),
  };
}

export function makeCond(f: Forecast, hour: Hour): Cond {
  const { lat, lon } = f.place;
  const mid = hour.t + 30 * 60 * 1000;
  const sun = sunPosition(mid, lat, lon);
  const moon = moonPosition(mid, lat, lon);
  const moonLight = moonIllumination(mid);
  const kind = describe(hour.code);
  const local = localParts(hour.t, f.utcOffset);
  const day = smoothstep(-9, 7, sun.alt);
  const overcast = smoothstep(55, 97, hour.cloud) * (kind.fall !== 'none' ? 1 : 0.9) + (kind.fall !== 'none' ? 0.1 : 0);
  const glow = smoothstep(-13, -3, sun.alt) * (1 - smoothstep(3, 13, sun.alt)) * (1 - 0.75 * clamp(overcast));
  const wet = kind.fall === 'none' ? 0 : Math.max(kind.intensity, clamp(hour.precip / 6));
  const clarity = clamp(hour.visibility / 30000) * (kind.fog ? 0.15 : 1);
  const mist = clamp(
    (kind.fog ? 0.9 : 0) +
      smoothstep(86, 99, hour.humidity) * 0.55 * (1 - smoothstep(12, 30, hour.wind)) +
      (1 - clamp(hour.visibility / 12000)) * 0.6 +
      wet * 0.25,
  );
  const north = lat >= 0;
  const m = local.month;
  const s = north ? m : (m + 6) % 12;
  const season: Season = s >= 2 && s <= 4 ? 'spring' : s >= 5 && s <= 7 ? 'summer' : s >= 8 && s <= 10 ? 'autumn' : 'winter';
  const facing = north ? 180 : 0;
  const toward = ((hour.windFrom + 180) * Math.PI) / 180;
  const rel = toward - (facing * Math.PI) / 180;
  const breeze = smoothstep(2, 55, hour.wind);
  return {
    hour,
    kind,
    sun,
    moon,
    moonLight,
    day,
    glow,
    dawn: local.hour < 12,
    overcast: clamp(overcast),
    clarity,
    mist,
    wet,
    season,
    snowCover: smoothstep(0.005, 0.04, hour.snowDepth),
    windX: Math.sin(rel),
    windY: Math.cos(rel),
    breeze,
    facing,
    localHour: local.hour,
    localDay: local.day,
    localMonth: local.month,
    localYear: local.year,
  };
}

/** Where something in the sky lands in the image, or null when it's outside the view. */
export function skyPoint(scene: Scene, p: SkyPos, facing: number, pad = 60): [number, number] | null {
  let d = p.bearing - facing;
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  if (Math.abs(d) > 90) return null;
  // The whole half of the sky you face is pressed into the sheet, as a print may.
  const x = IW / 2 + Math.sin((d * Math.PI) / 180) * IW * 0.46;
  const y = scene.horizon - (p.alt / 68) * scene.horizon;
  if (x < -pad || x > IW + pad || y < -pad) return null;
  return [x, y];
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function timeWords(c: Cond): string {
  const a = c.sun.alt;
  const h = c.localHour;
  if (a < -6) return h >= 18 || h < 1 ? 'in the evening' : h < 5 ? 'in the small hours' : 'before dawn';
  if (a < 4) return c.dawn ? 'at dawn' : 'at dusk';
  if (h < 11) return 'in the morning';
  if (h < 14) return 'at midday';
  if (h < 17) return 'in the afternoon';
  return 'in the evening';
}

/** The print's title, as it reads in the cartouche. */
export function titleFor(c: Cond): string {
  const k = c.kind;
  const night = c.sun.alt < -6;
  if (!k.fog && k.fall === 'none' && c.hour.cloud < 40 && night && c.moon.alt > 3 && c.moonLight.fraction > 0.25)
    return c.moonLight.fraction > 0.92 ? 'Full moon' : 'Moonlight';
  if (!k.fog && k.fall === 'none' && c.hour.cloud < 25 && night) return 'A clear night';
  if (c.snowCover > 0.5 && k.fall === 'none' && c.hour.cloud < 60) return `Snow lying ${timeWords(c)}`;
  return `${k.words} ${timeWords(c)}`;
}

// The blocks. Each prints one colour; the order is the order they are pulled.

export interface Tools {
  /** Canvas pixels per image unit. */
  scale: number;
  /** Soft edges for what's drawn next (the atenashi wipe). */
  blur: (units: number) => void;
}

/** A graded wipe down the block: [y, alpha] stops, held beyond the ends. */
export type Bokashi = [number, number][];

export interface Block {
  id: string;
  name: string;
  pigment: string;
  carve: (ctx: CanvasRenderingContext2D, k: Tools) => void;
  bokashi?: Bokashi;
  strength?: number;
  grain?: number;
  pool?: number;
  /** Wiped where the mist lies. */
  misted?: boolean;
  /** 'ink' prints by multiplying; 'white' lays opaque shell white; 'blind' embosses; 'mica' glints. */
  mode?: 'ink' | 'white' | 'blind' | 'mica';
  /** Prints inside the cartouche and seal, which every other block leaves bare. */
  keep?: boolean;
}

export interface Plate {
  blocks: Block[];
  title: string;
  /** Mist bands: centre y, half height, strength. */
  mist: [number, number, number][];
  /** Mica glints: x, y, facet angle. */
  mica: [number, number, number][];
  /** Precipitation for the overlay. */
  fall: Kind['fall'];
  wet: number;
  thunder: boolean;
  windX: number;
  night: boolean;
  /** Rectangles left as bare paper: the cartouche and the seal. */
  reserve: [number, number, number, number][];
  /** Pencilled in the bottom margin, left and right. */
  margin: [string, string];
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clockWords = (h: number) => (h === 0 ? 'midnight' : h === 12 ? 'noon' : `${h % 12} ${h < 12 ? 'a.m.' : 'p.m.'}`);

const tint = (c: RGB) => css(c);

function ridge(ctx: CanvasRenderingContext2D, arr: Float32Array, bottom: number) {
  ctx.beginPath();
  ctx.moveTo(-10, at(arr, 0));
  for (let i = 0; i < N; i++) ctx.lineTo(i * 10, arr[i]);
  ctx.lineTo(IW + 10, at(arr, IW));
  ctx.lineTo(IW + 10, bottom);
  ctx.lineTo(-10, bottom);
  ctx.closePath();
}

function groundPath(ctx: CanvasRenderingContext2D, s: Scene) {
  ridge(ctx, s.ground, IH + 10);
}

function pathShape(ctx: CanvasRenderingContext2D, s: Scene) {
  const p = s.path;
  ctx.beginPath();
  ctx.moveTo(p.x1 - p.w1 / 2, p.y1);
  ctx.quadraticCurveTo(lerp(p.x1, p.x0, 0.5) + p.bend - p.w0 * 0.25, lerp(p.y1, IH, 0.5), p.x0 - p.w0 / 2, IH + 10);
  ctx.lineTo(p.x0 + p.w0 / 2, IH + 10);
  ctx.quadraticCurveTo(lerp(p.x1, p.x0, 0.5) + p.bend + p.w0 * 0.25, lerp(p.y1, IH, 0.5), p.x1 + p.w1 / 2, p.y1);
  ctx.closePath();
}

function houseWall(ctx: CanvasRenderingContext2D, h: House) {
  ctx.rect(h.x, h.y - h.h, h.w, h.h);
}

function houseRoof(ctx: CanvasRenderingContext2D, h: House) {
  const e = h.w * 0.08;
  if (h.gable) {
    ctx.moveTo(h.x - e, h.y - h.h + 2);
    ctx.lineTo(h.x + h.w / 2, h.y - h.h - h.rh);
    ctx.lineTo(h.x + h.w + e, h.y - h.h + 2);
    ctx.closePath();
  } else {
    ctx.moveTo(h.x - e, h.y - h.h + 2);
    ctx.lineTo(h.x + h.w * 0.16, h.y - h.h - h.rh);
    ctx.lineTo(h.x + h.w * 0.84, h.y - h.h - h.rh);
    ctx.lineTo(h.x + h.w + e, h.y - h.h + 2);
    ctx.closePath();
  }
}

function houseOutline(ctx: CanvasRenderingContext2D, h: House) {
  houseWall(ctx, h);
  houseRoof(ctx, h);
  if (h.chimney) {
    const [cx, cw, chh] = h.chimney;
    ctx.rect(cx, h.y - h.h - chh, cw, chh * 0.9);
  }
}

function allHouses(ctx: CanvasRenderingContext2D, s: Scene) {
  ctx.beginPath();
  for (const h of s.houses) houseOutline(ctx, h);
}

function figureShape(ctx: CanvasRenderingContext2D, s: Scene, umbrella: boolean) {
  const { x, y, s: k } = s.figure;
  ctx.beginPath();
  ctx.moveTo(x - 12 * k, y - 8 * k);
  ctx.lineTo(x - 8 * k, y - 52 * k);
  ctx.lineTo(x + 8 * k, y - 52 * k);
  ctx.lineTo(x + 13 * k, y - 8 * k);
  ctx.closePath();
  ctx.moveTo(x + 7 * k, y - 60 * k);
  ctx.arc(x, y - 60 * k, 7 * k, 0, Math.PI * 2);
  if (umbrella) {
    ctx.moveTo(x - 34 * k, y - 70 * k);
    ctx.quadraticCurveTo(x, y - 112 * k, x + 34 * k, y - 70 * k);
    ctx.closePath();
  }
}

/** Paths each near house back to front, first hiding whatever this block printed behind it. */
function eachHouse(ctx: CanvasRenderingContext2D, s: Scene, draw: (h: House) => void) {
  for (const h of s.houses) {
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    houseOutline(ctx, h);
    ctx.fill();
    ctx.globalCompositeOperation = op;
    draw(h);
  }
}

function treeTrunk(ctx: CanvasRenderingContext2D, s: Scene, limbs = true) {
  const t = s.tree;
  const steps = 24;
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const y = lerp(t.base, t.top, u);
    const x = t.x + t.lean * u * u + 14 * Math.sin(u * 5 + s.seed) + 4 * Math.sin(u * 7 + s.seed * 2);
    pts.push([x, y, lerp(t.pine ? 28 : 24, t.pine ? 6 : 8, u)]);
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0] - pts[0][2], pts[0][1]);
  for (const [x, y, w] of pts) ctx.lineTo(x - w, y);
  for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0] + pts[i][2], pts[i][1]);
  ctx.closePath();
  if (!limbs) return;
  for (const b of t.branches) {
    const nx = -(b.y1 - b.y0);
    const ny = b.x1 - b.x0;
    const l = Math.hypot(nx, ny) || 1;
    const ox = (nx / l) * b.w;
    const oy = (ny / l) * b.w;
    ctx.moveTo(b.x0 + ox, b.y0 + oy);
    ctx.quadraticCurveTo((b.x0 + b.x1) / 2 + ox * 0.5, (b.y0 + b.y1) / 2 - 10, b.x1, b.y1);
    ctx.quadraticCurveTo((b.x0 + b.x1) / 2 - ox * 0.5, (b.y0 + b.y1) / 2 - 10 + oy, b.x0 - ox, b.y0 - oy);
    ctx.closePath();
  }
}

function bareTwigs(ctx: CanvasRenderingContext2D, s: Scene) {
  const rng = mulberry32(s.seed + 77);
  const twig = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    const x1 = x + Math.cos(a) * len;
    const y1 = y + Math.sin(a) * len;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    if (depth <= 0) return;
    twig(x1, y1, a - 0.35 - rng() * 0.4, len * (0.62 + rng() * 0.15), w * 0.66, depth - 1);
    twig(x1, y1, a + 0.3 + rng() * 0.4, len * (0.6 + rng() * 0.15), w * 0.66, depth - 1);
  };
  for (const b of s.tree.branches) {
    const a = Math.atan2(b.y1 - b.y0, b.x1 - b.x0);
    twig(b.x1, b.y1, a - 0.2, 60, 4, 4);
    twig(b.x1, b.y1, a + 0.35, 50, 3.4, 3);
  }
}

function pads(ctx: CanvasRenderingContext2D, s: Scene, shrink = 0) {
  ctx.beginPath();
  for (const p of s.tree.pads) {
    ctx.moveTo(p.dx + p.rx - shrink, p.dy);
    ctx.ellipse(p.dx, p.dy, Math.max(1, p.rx - shrink), Math.max(1, p.ry - shrink * 0.6), 0, 0, Math.PI * 2);
  }
}

function cloudShape(ctx: CanvasRenderingContext2D, c: Cloud, x: number, grow = 0, dy = 0) {
  for (const l of c.lumps) {
    ctx.moveTo(x + l.dx + l.rx + grow, c.y + l.dy + dy);
    ctx.ellipse(x + l.dx, c.y + l.dy + dy, l.rx + grow, Math.max(2, l.ry + grow * 0.5), 0, 0, Math.PI * 2);
  }
}

function moonShape(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, light: MoonLight, tilt: number) {
  const f = light.fraction;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.beginPath();
  // Lit limb on +x: a half circle, closed by the terminator's half ellipse.
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  const k = Math.abs(1 - 2 * f) * r;
  // A crescent's terminator bulges toward the lit limb; a gibbous moon's away from it.
  ctx.ellipse(0, 0, Math.max(0.01, k), r, 0, Math.PI / 2, -Math.PI / 2, f < 0.5);
  ctx.closePath();
  ctx.restore();
}

function seasonFoliage(s: Season, pine: boolean): string | null {
  if (pine) return '#35573f';
  if (s === 'summer') return '#4f7d47';
  if (s === 'autumn') return '#c76c32';
  if (s === 'spring') return '#e6b4bd';
  return null;
}

/** The sky's colour at its top, and the colour of any glow at the horizon. */
export function skyColors(c: Cond): { top: RGB; glow: RGB } {
  const storm = clamp(c.wet * 0.6 + (c.kind.thunder ? 0.4 : 0));
  const day = mix(mix('#2f63a0', '#8b929a', c.overcast), '#5d646d', storm * 0.8);
  const night = mix('#17234a', '#262b37', c.overcast);
  let top = mix(mix(night, day, c.day), c.dawn ? '#47507e' : '#3c3a68', c.glow * 0.7);
  if (c.kind.fog) top = mix(top, mix('#30343c', '#a4a9ad', c.day), 0.75);
  const glow = c.dawn ? mix('#f0c47a', '#e9a06a', 0.4) : mix('#e8935c', '#d8664a', 0.35);
  return { top, glow };
}

/** The blocks for one hour, light colours first and the key block near the end. */
export function makePlate(s: Scene, c: Cond, place: string): Plate {
  const night = c.sun.alt < -6;
  // Land keeps its colour into twilight; the sky's own colour follows the Sun more closely.
  const L = smoothstep(-12, 3, c.sun.alt);
  const oc = c.overcast;
  const wet = c.wet;
  const storm = clamp(wet * 0.6 + (c.kind.thunder ? 0.4 : 0));
  const snowy = c.snowCover;
  const blocks: Block[] = [];

  const { top: skyTop, glow: glowCol } = skyColors(c);

  const moonXY = c.moon.alt > -2 ? skyPoint(s, c.moon, c.facing, -40) : null;
  const sunXY = c.sun.alt > -1.5 && c.sun.alt < 9 ? skyPoint(s, c.sun, c.facing, -50) : null;
  const sunFor = skyPoint(s, c.sun, c.facing, 4000) ?? [IW / 2, s.horizon + 400];
  const moonVisible = moonXY && night && c.hour.cloud < 85 && !c.kind.fog;
  const moonR = 36;
  const moonTilt = moonXY ? Math.atan2(sunFor[1] - moonXY[1], sunFor[0] - moonXY[0]) : 0;

  // Clouds: how many of the place's pool show, drifting with the wind hour by hour.
  const nClouds = Math.round(clamp(c.hour.cloud / 100) * 13);
  const drift = (c.hour.t / 3600000) * c.windX * (4 + c.breeze * 30);
  const shown = s.clouds.slice(0, nClouds).map((cl) => {
    const span = IW + cl.w * 2;
    const x = ((((cl.x * span + drift) % span) + span) % span) - cl.w;
    return { cl, x };
  });
  const lowCloud = clamp(c.hour.cloudLow / 100);

  // Mist bands: across the base of the hills, and over the water when it's thick.
  const mist: [number, number, number][] = [];
  if (c.kind.fog) {
    mist.push([s.horizon - 30, 150, 0.97], [s.horizon + 110, 130, 0.85], [s.horizon - 260, 160, 0.8]);
  } else if (c.mist > 0.05) {
    mist.push([s.horizon - 16, 46 + c.mist * 50, c.mist]);
    if (c.mist > 0.35) mist.push([s.horizon - 150 - lowCloud * 60, 40 + c.mist * 40, (c.mist - 0.3) * 1.1]);
    if (c.mist > 0.6) mist.push([s.horizon + 120, 70, (c.mist - 0.55) * 1.6]);
  }

  // 1. Glow at the horizon, wiped upward.
  if (c.glow > 0.05) {
    blocks.push({
      id: 'glow',
      name: c.sun.alt > 2 && c.localHour >= 10 && c.localHour <= 14 ? 'Low sun gold' : c.dawn ? 'Dawn yellow' : 'Sunset rose',
      pigment: tint(glowCol),
      strength: clamp(c.glow * 1.1),
      grain: 0.25,
      carve: (ctx) => {
        ctx.fillRect(-10, -10, IW + 20, s.horizon + 10);
        if (!s.sea) ctx.fillRect(-10, s.horizon, IW + 20, 300);
        else ctx.fillRect(-10, s.horizon, IW + 20, 420);
        if (moonVisible && moonXY) {
          ctx.globalCompositeOperation = 'destination-out';
          moonShape(ctx, moonXY[0], moonXY[1], moonR + 1, c.moonLight, moonTilt);
          ctx.fill();
        }
      },
      bokashi: [
        [s.horizon - 520, 0],
        [s.horizon - 40, 1],
        [s.horizon + 10, 1],
        [s.horizon + 260, 0],
      ],
    });
  }

  // 2. The sky, wiped from the top: clouds and the moon are left as paper.
  const skyName = night ? 'Night indigo' : oc > 0.6 ? (storm > 0.4 ? 'Rain grey' : 'Cloud grey') : 'Prussian blue';
  blocks.push({
    id: 'sky',
    name: skyName,
    pigment: tint(skyTop),
    strength: 1,
    grain: 0.32,
    pool: 0.12,
    carve: (ctx, k) => {
      ctx.fillRect(-10, -10, IW + 20, s.horizon + 30);
      ctx.globalCompositeOperation = 'destination-out';
      if (oc < 0.85) {
        k.blur(8 + oc * 18);
        ctx.beginPath();
        for (const { cl, x } of shown) {
          // Cumulus: heaped tops on a long, flat base.
          cloudShape(ctx, cl, x, 0, -10);
          ctx.moveTo(x + cl.w * 0.5, cl.y + 6);
          ctx.ellipse(x, cl.y + 6, cl.w * 0.5, 13, 0, 0, Math.PI * 2);
        }
        ctx.fill();
        k.blur(0);
      }
      if (moonVisible && moonXY) {
        moonShape(ctx, moonXY[0], moonXY[1], moonR, c.moonLight, moonTilt);
        ctx.fill();
      }
    },
    bokashi: [
      [0, 1],
      [s.horizon - 40, c.kind.fog ? 0.15 : oc > 0.6 ? 0.55 : night ? 0.8 : 0.1 + c.glow * 0.1],
    ],
  });

  // 3. Cloud: the undersides of the clouds, or the whole low ceiling when it's overcast.
  if (c.hour.cloud > 12) {
    const cloudCol = night ? mix('#585d6b', '#3a3e48', oc) : mix(mix('#b9bcc0', '#8b9096', oc), '#6c7178', storm);
    blocks.push({
      id: 'cloud',
      name: night ? 'Night cloud' : storm > 0.4 ? 'Storm grey' : 'Cloud shadow',
      pigment: tint(cloudCol),
      strength: c.kind.fog ? 0.3 : night ? 0.9 : 0.55 + oc * 0.35,
      grain: 0.2,
      carve: (ctx, k) => {
        if (oc > 0.55) {
          // Bands of low stratus, darker toward the top.
          const rng = mulberry32(s.seed + Math.floor(c.hour.t / 7200000));
          k.blur(26);
          ctx.beginPath();
          for (let i = 0; i < 9; i++) {
            const y = 40 + i * ((s.horizon - 120) / 9) + rng() * 30;
            const h = 26 + rng() * 34;
            const x = rng() * IW;
            ctx.moveTo(x - 600, y);
            ctx.ellipse(x, y, 700, h, 0, 0, Math.PI * 2);
          }
          ctx.fill();
          k.blur(0);
        }
        k.blur(12);
        ctx.beginPath();
        for (const { cl, x } of shown) {
          if (night) {
            // By night the whole cloud is dim; only its rim, a little thinner here, stays pale.
            cloudShape(ctx, cl, x, -6, -10);
            ctx.moveTo(x + cl.w * 0.46, cl.y + 6);
            ctx.ellipse(x, cl.y + 6, cl.w * 0.46, 11, 0, 0, Math.PI * 2);
          } else {
            // A grey belly along each cloud's base.
            ctx.moveTo(x + cl.w * 0.42, cl.y + 4);
            ctx.ellipse(x, cl.y + 4, cl.w * 0.42, 15, 0, 0, Math.PI * 2);
          }
        }
        ctx.fill();
        k.blur(0);
        if (moonVisible && moonXY) {
          ctx.globalCompositeOperation = 'destination-out';
          moonShape(ctx, moonXY[0], moonXY[1], moonR + 2, c.moonLight, moonTilt);
          ctx.fill();
        }
      },
      bokashi: [
        [0, 1],
        [s.horizon, oc > 0.55 ? 0.7 : 0.35],
      ],
    });
  }

  // 4. The far range, wiped toward its foot; snow caps left as paper.
  const farCol = mix(mix(mix('#8fa3bd', '#9ca3aa', oc), '#c9d1db', snowy * 0.4), '#28335a', 1 - L);
  blocks.push({
    id: 'far',
    name: 'Distant blue',
    pigment: tint(farCol),
    strength: lerp(0.18, 1, c.clarity) * (1 - lowCloud * 0.35),
    grain: 0.3,
    pool: 0.1,
    misted: true,
    carve: (ctx, k) => {
      ridge(ctx, s.far, s.horizon + 40);
      ctx.fill();
      const peak = Math.min(...s.far);
      const cold = (c.hour.temp < 3 || snowy > 0.2) && s.horizon - peak > 170;
      if (cold) {
        // Snow above a ragged line, reaching down the gullies.
        ctx.globalCompositeOperation = 'destination-out';
        k.blur(2.5);
        const line = peak + 45 + clamp(c.hour.temp + 4, 0, 12) * 5 + (snowy > 0.2 ? 30 : 0);
        const gully = fbm1(s.seed + 21, 3);
        ctx.beginPath();
        for (let i = 0; i < N; i++) ctx.lineTo(i * 10, s.far[i] - 1);
        for (let i = N - 1; i >= 0; i--) {
          const snowline = line + (gully(i * 0.21) - 0.5) * 70 + Math.max(0, Math.sin(i * 0.9 + s.seed) * 18);
          ctx.lineTo(i * 10, Math.max(s.far[i] - 1, snowline));
        }
        ctx.closePath();
        ctx.fill();
        k.blur(0);
      }
    },
    bokashi: [
      [Math.min(...s.far), 1],
      [s.horizon + 10, 0.25],
    ],
  });

  // 5. The nearer hills, and on a lake the grove along the far shore.
  const hillCol = mix(mix(mix('#5f7d9b', '#7b858f', oc), '#aab6c4', snowy * 0.5), '#1c2644', 1 - L);
  blocks.push({
    id: 'hills',
    name: 'Hill blue',
    pigment: tint(hillCol),
    strength: lerp(0.35, 1, c.clarity),
    grain: 0.3,
    pool: 0.12,
    misted: true,
    carve: (ctx) => {
      ridge(ctx, s.far2, s.horizon + 30);
      ctx.fill();
    },
    bokashi: [
      [Math.min(...s.far2), 1],
      [s.horizon, 0.4],
    ],
  });

  if (!s.sea) {
    const groveDay: Record<Season, string> = {
      spring: '#5f8458',
      summer: '#3f6a50',
      autumn: '#86683b',
      winter: '#55615f',
    };
    const groveCol = mix(mix(groveDay[c.season], '#8e9aa4', snowy * 0.6), '#1d2733', 1 - L);
    blocks.push({
      id: 'grove',
      name: c.season === 'autumn' ? 'Grove ochre' : 'Grove green',
      pigment: tint(groveCol),
      strength: lerp(0.5, 1, c.clarity),
      grain: 0.25,
      pool: 0.15,
      misted: true,
      carve: (ctx) => {
        ctx.beginPath();
        ridge(ctx, s.grove, s.horizon + 4);
        ctx.fill();
        ctx.beginPath();
        for (const [x, y, r] of s.groveBumps) {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      },
      bokashi: [
        [s.horizon - 50, 1],
        [s.horizon + 4, 0.55],
      ],
    });
  }

  // 6. Water: darker under the far shore and toward you; the moon's path left as paper.
  const waterCol = mix(mix(mix('#3d73a8', '#6f8797', oc), '#56656f', storm * 0.7), '#131e3d', 1 - L);
  blocks.push({
    id: 'water',
    name: night ? 'Night water' : 'Water blue',
    pigment: tint(waterCol),
    strength: 1,
    grain: 0.38,
    pool: 0.1,
    misted: true,
    carve: (ctx) => {
      ctx.fillRect(-10, s.horizon, IW + 20, 1260 - s.horizon);
      ctx.globalCompositeOperation = 'destination-out';
      groundPath(ctx, s);
      ctx.fill();
      if (moonVisible && moonXY && c.moon.alt > 0) {
        const rng = mulberry32(s.seed + 9);
        const spread = 10 + c.breeze * 40;
        for (let y = s.horizon + 6; y < 1200; y += 7 + rng() * 9) {
          const u = (y - s.horizon) / (1200 - s.horizon);
          const w = (8 + u * 50) * (0.3 + rng()) * (0.4 + c.moonLight.fraction);
          const x = moonXY[0] + (rng() - 0.5) * spread * (1 + u * 3);
          ctx.fillRect(x - w / 2, y, w, 1.6 + u * 2.5);
        }
      }
      const calm = 1 - c.breeze;
      if (!night && c.overcast < 0.8) {
        // Sky light catching the far water when it's still.
        const rng = mulberry32(s.seed + 13);
        ctx.globalAlpha = 0.5 * calm;
        for (let i = 0; i < 30; i++) {
          const y = s.horizon + 10 + rng() * 60;
          ctx.fillRect(rng() * IW, y, 30 + rng() * 120, 1.4);
        }
        ctx.globalAlpha = 1;
      }
    },
    bokashi: [
      [s.horizon, 1],
      [s.horizon + 110, 0.45],
      [s.horizon + 200, 0.55],
      [1240, 1],
    ],
  });

  // 7. Earth: the bank, the path left pale; under snow, only the blue of its shadows.
  const earthDay: Record<Season, string> = {
    spring: '#93a65d',
    summer: '#7f9450',
    autumn: '#ad8f52',
    winter: '#9f9171',
  };
  const earthCol = mix(mix(earthDay[c.season], '#b8c4d2', snowy), '#2a2f37', 1 - L);
  blocks.push({
    id: 'earth',
    name: snowy > 0.5 ? 'Snow shadow' : c.season === 'autumn' || c.season === 'winter' ? 'Earth ochre' : 'Grass green',
    pigment: tint(earthCol),
    strength: lerp(1, 0.55, snowy),
    grain: 0.35,
    pool: 0.12,
    carve: (ctx) => {
      groundPath(ctx, s);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      pathShape(ctx, s);
      ctx.fill();
      allHouses(ctx, s);
      ctx.fill();
    },
    bokashi: [
      [Math.min(...s.ground), snowy > 0.5 ? 0.2 : 0.75],
      [IH, 1],
    ],
  });

  // 8. Ochre: plaster walls, the path, and the cartouche's ground.
  const ochre = mix('#e2cb97', '#4a443d', 1 - L);
  blocks.push({
    id: 'ochre',
    name: 'Pale ochre',
    pigment: tint(ochre),
    strength: 0.85,
    grain: 0.25,
    carve: (ctx) => {
      ctx.beginPath();
      for (const h of s.farHouses) houseWall(ctx, h);
      ctx.fill();
      eachHouse(ctx, s, (h) => {
        ctx.beginPath();
        houseWall(ctx, h);
        ctx.fill();
      });
      if (snowy < 0.5) {
        ctx.globalAlpha = 0.75;
        pathShape(ctx, s);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (s.boat) {
        const { x, y, s: k } = s.boat;
        ctx.beginPath();
        ctx.moveTo(x + 1.5 * k, y - 82 * k);
        ctx.lineTo(x + 40 * k, y - 14 * k);
        ctx.lineTo(x + 1.5 * k, y - 14 * k);
        ctx.closePath();
        ctx.fill();
      }
    },
  });

  // 9. Slate: roofs, bark, the walker's coat, the boat.
  const slate = mix('#4b5563', '#1d2129', 1 - L);
  blocks.push({
    id: 'slate',
    name: 'Slate grey',
    pigment: tint(slate),
    strength: 1,
    grain: 0.25,
    pool: 0.18,
    carve: (ctx) => {
      const roofs = (h: House) => {
        ctx.beginPath();
        houseRoof(ctx, h);
        if (h.chimney) {
          const [cx, cw, chh] = h.chimney;
          ctx.rect(cx, h.y - h.h - chh, cw, chh * 0.9);
        }
        ctx.fill();
        if (snowy > 0.3) {
          // Snow on the roof: all but the eaves left as paper.
          ctx.globalCompositeOperation = 'destination-out';
          ctx.save();
          ctx.translate(0, -h.rh * 0.12);
          ctx.beginPath();
          houseRoof(ctx, h);
          ctx.fill();
          ctx.restore();
          ctx.globalCompositeOperation = 'source-over';
        }
        // Windows and doors, dark by day.
        ctx.beginPath();
        if (!night) for (const [x, y, w, hh] of h.windows) ctx.rect(x, y, w, hh);
        if (h.door) ctx.rect(...h.door);
        ctx.fill();
      };
      for (const h of s.farHouses) roofs(h);
      eachHouse(ctx, s, roofs);
      treeTrunk(ctx, s);
      ctx.fill();
      if (leaf) {
        // The limbs disappear into the foliage.
        ctx.globalCompositeOperation = 'destination-out';
        pads(ctx, s, 6);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      figureShape(ctx, s, false);
      ctx.fill();
      if (s.boat) {
        const { x, y, s: k } = s.boat;
        ctx.beginPath();
        ctx.moveTo(x - 46 * k, y - 8 * k);
        ctx.lineTo(x + 46 * k, y - 8 * k);
        ctx.lineTo(x + 34 * k, y + 4 * k);
        ctx.lineTo(x - 36 * k, y + 4 * k);
        ctx.closePath();
        ctx.rect(x - 1.5 * k, y - 80 * k, 3 * k, 72 * k);
        ctx.fill();
      }
    },
  });

  // 10. Foliage, by season and kind of tree.
  const leaf = seasonFoliage(c.season, s.tree.pine);
  if (leaf) {
    blocks.push({
      id: 'leaf',
      name: s.tree.pine
        ? 'Pine green'
        : c.season === 'autumn'
          ? 'Maple red'
          : c.season === 'spring'
            ? 'Blossom pink'
            : 'Leaf green',
      pigment: tint(mix(leaf, '#1b2620', (1 - L) * 0.75)),
      strength: 1,
      grain: 0.28,
      pool: 0.2,
      bokashi: [
        [s.tree.top - 120, 0.72],
        [s.tree.top + 260, 1],
      ],
      carve: (ctx) => {
        pads(ctx, s);
        ctx.fill();
        if (c.season === 'autumn' && !s.tree.pine) {
          const rng = mulberry32(s.seed + 61);
          ctx.beginPath();
          for (let i = 0; i < 70; i++) {
            const x = s.tree.x + (rng() - 0.5) * 380;
            const y = at(s.ground, x) + 20 + rng() ** 2 * 200;
            ctx.moveTo(x + 4, y);
            ctx.ellipse(x, y, 4 + rng() * 3, 2 + rng() * 1.5, rng() * 3, 0, Math.PI * 2);
          }
          ctx.fill();
        }
        if (snowy > 0.3) {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          for (const p of s.tree.pads) {
            ctx.moveTo(p.dx + p.rx * 0.9, p.dy - p.ry * 0.35);
            ctx.ellipse(p.dx, p.dy - p.ry * 0.55, p.rx * 0.9, p.ry * 0.55, 0, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      },
    });
  }

  // 11. Lamp yellow: lit windows and their reflections, the walker's lantern.
  const lit = night || (c.day < 0.5 && oc > 0.5);
  if (lit) {
    blocks.push({
      id: 'lamp',
      name: 'Lamp yellow',
      pigment: '#f1c35a',
      strength: 1,
      grain: 0.15,
      carve: (ctx) => {
        const rng = mulberry32(s.seed + 31);
        const lights = (h: House) => {
          ctx.beginPath();
          for (const w of h.windows) if (rng() < 0.75 || h === s.houses[s.houses.length - 1]) ctx.rect(...w);
          ctx.fill();
        };
        for (const h of s.farHouses) lights(h);
        eachHouse(ctx, s, lights);
        if (!s.sea) {
          for (const h of s.farHouses) {
            for (let y = s.horizon + 8; y < s.horizon + 70; y += 6 + rng() * 6) {
              ctx.fillRect(h.x + h.w / 2 - 2 + (rng() - 0.5) * 4, y, 3 + rng() * 3, 1.6);
            }
          }
        }
        const { x, y, s: k } = s.figure;
        ctx.beginPath();
        ctx.arc(x + 18 * k, y - 26 * k, 5.5 * k, 0, Math.PI * 2);
        ctx.fill();
      },
    });
  }

  // 12. Vermilion: the sun on the horizon, an umbrella, the seal.
  const umbrella = c.kind.fall !== 'none' && c.kind.fall !== 'snow' ? true : c.kind.fall === 'snow' && wet > 0.5;
  blocks.push({
    id: 'red',
    keep: true,
    name: 'Vermilion',
    pigment: '#cc4a30',
    strength: 1,
    grain: 0.2,
    carve: (ctx) => {
      if (sunXY && c.hour.cloud < 75) {
        ctx.beginPath();
        ctx.arc(sunXY[0], sunXY[1], 42, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ridge(ctx, s.far, IH);
        ctx.fill();
        ridge(ctx, s.far2, IH);
        ctx.fill();
        ctx.fillRect(-10, s.horizon, IW + 20, IH);
        ctx.globalCompositeOperation = 'source-over';
        // Its path across the water.
        const rng = mulberry32(s.seed + 5);
        ctx.globalAlpha = 0.8;
        for (let y = s.horizon + 6; y < s.horizon + 220; y += 9 + rng() * 9) {
          const u = (y - s.horizon) / 220;
          const w = (40 - u * 30) * (0.4 + rng());
          ctx.fillRect(sunXY[0] - w / 2 + (rng() - 0.5) * 20, y, w, 2);
        }
        ctx.globalAlpha = 1;
      }
      if (umbrella) {
        const { x, y, s: k } = s.figure;
        ctx.beginPath();
        ctx.moveTo(x - 36 * k, y - 70 * k);
        ctx.quadraticCurveTo(x, y - 114 * k, x + 36 * k, y - 70 * k);
        ctx.quadraticCurveTo(x, y - 78 * k, x - 36 * k, y - 70 * k);
        ctx.fill();
      }
      seal(ctx, s, c, place);
    },
  });

  // 13. The key block: every line, and the lettering.
  const keyCol = mix('#283041', '#0e1117', 1 - L);
  blocks.push({
    id: 'key',
    keep: true,
    name: 'Key block',
    pigment: tint(keyCol),
    strength: 1,
    grain: 0.12,
    carve: (ctx) => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // The far shore.
      if (!s.sea) {
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = lerp(0.35, 0.9, c.clarity);
        ctx.beginPath();
        ctx.moveTo(0, s.horizon + 2);
        for (let x = 0; x <= IW; x += 25) ctx.lineTo(x, s.horizon + 2 + Math.sin(x * 0.07 + s.seed) * 1.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, s.horizon);
        ctx.lineTo(IW, s.horizon);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // Ripples, more and longer in wind.
      ctx.save();
      ctx.beginPath();
      ctx.rect(-10, s.horizon, IW + 20, IH);
      ctx.clip();
      ctx.globalCompositeOperation = 'source-over';
      const n = Math.round(lerp(24, s.ripples.length, c.breeze ** 0.8));
      const swell = (s.sea ? 2.2 : 1.2) + c.breeze * 3;
      for (let i = 0; i < n; i++) {
        const [x, y, len] = s.ripples[i];
        const u = (y - s.horizon) / (1180 - s.horizon);
        const l = len * (0.7 + c.breeze * 0.6);
        ctx.globalAlpha = 0.35 + u * 0.55;
        ctx.lineWidth = 0.9 + u * 1.1;
        ctx.beginPath();
        ctx.moveTo(x - l / 2, y);
        // A low swell along each line, steeper and curling in a wind on the open sea.
        ctx.bezierCurveTo(x - l / 6, y - swell * (0.4 + u), x + l / 6, y + swell * 0.5, x + l / 2, y - swell * 0.2);
        if (s.sea && c.breeze > 0.4 && i % 4 === 0) ctx.quadraticCurveTo(x + l / 2 + 6, y - 7 * c.breeze, x + l / 2 - 2, y - 9 * c.breeze);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Nothing of the water shows on the bank.
      ctx.globalCompositeOperation = 'destination-out';
      groundPath(ctx, s);
      ctx.fill();
      ctx.restore();
      // The bank's edge and tufts of grass.
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-10, at(s.ground, 0));
      for (let i = 0; i < N; i++) ctx.lineTo(i * 10, s.ground[i]);
      ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      for (const [x, y, h] of s.tufts) {
        const lean = c.windX * h * 0.25;
        ctx.moveTo(x - 4, y);
        ctx.quadraticCurveTo(x - 6, y - h * 0.6, x - 9 + lean, y - h * 0.8);
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 1, y - h * 0.7, x + 2 + lean, y - h);
        ctx.moveTo(x + 4, y);
        ctx.quadraticCurveTo(x + 7, y - h * 0.5, x + 10 + lean, y - h * 0.65);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Houses.
      ctx.lineWidth = 2;
      eachHouse(ctx, s, (h) => {
        ctx.beginPath();
        houseOutline(ctx, h);
        for (const w of h.windows) ctx.rect(...w);
        if (h.door) ctx.rect(...h.door);
        ctx.stroke();
      });
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const h of s.farHouses) houseOutline(ctx, h);
      ctx.stroke();
      // Smoke from the chimneys in the cold, leaning with the wind.
      if (c.hour.temp < 12) {
        ctx.lineWidth = 1.4;
        ctx.globalAlpha = 0.7;
        for (const h of s.houses) {
          if (!h.chimney) continue;
          const [cx, cw, chh] = h.chimney;
          let x = cx + cw / 2;
          let y = h.y - h.h - chh;
          ctx.beginPath();
          ctx.moveTo(x, y);
          for (let i = 1; i < 12; i++) {
            x += c.windX * (2 + c.breeze * 12) + Math.sin(i * 0.9 + s.seed) * 3;
            y -= 9 - c.breeze * 5;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // The tree: trunk, bark, and the scalloped undersides of pine needles.
      ctx.lineWidth = 2.2;
      const leafy = !!leaf;
      treeTrunk(ctx, s, !leafy);
      ctx.stroke();
      if (leafy) {
        ctx.globalCompositeOperation = 'destination-out';
        pads(ctx, s, 3);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      } else bareTwigs(ctx, s);
      if (s.tree.pine && leaf) {
        ctx.lineWidth = 1.6;
        for (const p of s.tree.pads) {
          ctx.beginPath();
          const steps = Math.max(4, Math.round(p.rx / 12));
          for (let i = 0; i <= steps; i++) {
            const a = Math.PI * (i / steps);
            const x = p.dx + Math.cos(a) * p.rx * 0.92;
            const y = p.dy + Math.sin(a) * p.ry * 0.85;
            ctx.moveTo(x, y);
            ctx.lineTo(x + (p.dx - x) * 0.12, y - p.ry * 0.32);
          }
          ctx.stroke();
        }
      }
      // The walker, and an umbrella over them when it rains.
      ctx.lineWidth = 1.8;
      figureShape(ctx, s, umbrella);
      ctx.stroke();
      const { x, y, s: k } = s.figure;
      ctx.beginPath();
      ctx.moveTo(x - 5 * k, y - 8 * k);
      ctx.lineTo(x - 7 * k, y + 2 * k);
      ctx.moveTo(x + 5 * k, y - 8 * k);
      ctx.lineTo(x + 8 * k, y + 1 * k);
      if (umbrella) {
        ctx.moveTo(x + 2 * k, y - 104 * k);
        ctx.lineTo(x + 2 * k, y - 34 * k);
      }
      ctx.stroke();
      if (s.boat) {
        const b = s.boat;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(b.x - 46 * b.s, b.y - 8 * b.s);
        ctx.lineTo(b.x + 46 * b.s, b.y - 8 * b.s);
        ctx.lineTo(b.x + 34 * b.s, b.y + 4 * b.s);
        ctx.lineTo(b.x - 36 * b.s, b.y + 4 * b.s);
        ctx.closePath();
        ctx.moveTo(b.x + 1.5 * b.s, b.y - 82 * b.s);
        ctx.lineTo(b.x + 40 * b.s, b.y - 14 * b.s);
        ctx.lineTo(b.x + 1.5 * b.s, b.y - 14 * b.s);
        ctx.stroke();
      }
      cartoucheLines(ctx, s, place, c);
    },
  });

  // 14. Shell white: stars on a clear night.
  const starry = night && c.hour.cloud < 60 && !c.kind.fog;
  if (starry) {
    blocks.push({
      id: 'gofun',
      name: 'Shell white',
      pigment: '#f6f2e8',
      mode: 'white',
      strength: 0.9,
      grain: 0.2,
      carve: (ctx) => {
        if (starry) {
          const show = Math.round(s.stars.length * (1 - c.hour.cloud / 70) * (moonVisible ? 0.55 : 1));
          ctx.beginPath();
          for (let i = 0; i < show; i++) {
            const [x, y, r] = s.stars[i];
            if (y > Math.min(at(s.far, x), at(s.far2, x)) - 10) continue;
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      },
    });
  }

  // 15. Blind printing: snow and the cartouche's border pressed into the paper without ink.
  blocks.push({
    id: 'blind',
    keep: true,
    name: 'Blind (no ink)',
    pigment: '#ffffff',
    mode: 'blind',
    carve: (ctx) => {
      cartoucheFrame(ctx, s, place, c);
      if (snowy > 0.3) {
        ctx.beginPath();
        for (const h of s.houses) {
          ctx.save();
          ctx.translate(0, -h.rh * 0.12);
          houseRoof(ctx, h);
          ctx.restore();
        }
        ctx.fill();
      }
      if (moonVisible && moonXY) {
        ctx.beginPath();
        ctx.arc(moonXY[0], moonXY[1], moonR - 3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  });

  // 16. Mica, dusted on a dark sky and dark water.
  const mica: [number, number, number][] = [];
  if (night) {
    const rng = mulberry32(s.seed + 53);
    for (let i = 0; i < 900; i++) {
      const sky = rng() < 0.6;
      const x = rng() * IW;
      const y = sky ? rng() ** 1.6 * (s.horizon * 0.62) : s.horizon + 6 + rng() * (1150 - s.horizon);
      if (sky && y > Math.min(at(s.far, x), at(s.far2, x)) - 6) continue;
      mica.push([x, y, rng() * Math.PI * 2]);
    }
    blocks.push({
      id: 'mica',
      name: 'Mica',
      pigment: '#c9c6bd',
      mode: 'mica',
      carve: (ctx) => {
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        for (const [x, y] of mica) {
          ctx.moveTo(x + 2, y);
          ctx.arc(x, y, 2, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.globalAlpha = 1;
      },
    });
  }

  return {
    blocks,
    title: titleFor(c),
    mist,
    mica,
    fall: c.kind.fall,
    wet,
    thunder: c.kind.thunder,
    windX: c.windX * (0.15 + c.breeze),
    night,
    reserve: reserveFor(s, place, c),
    margin: [`${c.localDay} ${MONTH_NAMES[c.localMonth]} ${c.localYear}, ${clockWords(c.localHour)}`, 'thesandbox.page'],
  };
}

// The cartouche: a titled panel in the corner away from the tree, and the date seal under it.

let fontFamily = 'Georgia, serif';
export function setFont(family: string): void {
  fontFamily = family;
}

export const getFont = () => fontFamily;

let measurer: CanvasRenderingContext2D | null = null;

function cartoucheBox(s: Scene, place: string, c: Cond) {
  const title = titleFor(c);
  measurer ??= document.createElement('canvas').getContext('2d');
  const ctx = measurer!;
  ctx.save();
  ctx.font = `700 33px ${fontFamily}`;
  const w1 = ctx.measureText(title).width;
  ctx.font = `400 25px ${fontFamily}`;
  const w2 = ctx.measureText(place).width;
  ctx.restore();
  const w = clamp(Math.max(w1, w2) + 56, 250, 600);
  const h = 104;
  const left = s.tree.x > IW / 2;
  const x = left ? 44 : IW - 44 - w;
  return { x, y: 44, w, h, title, left };
}

function reserveFor(s: Scene, place: string, c: Cond): [number, number, number, number][] {
  const b = cartoucheBox(s, place, c);
  const sl = sealBox(b);
  return [
    [b.x - 14, b.y - 14, b.w + 28, b.h + 28],
    [sl.x - 4, sl.y - 4, sl.size + 8, sl.size + 8],
  ];
}

function sealBox(b: ReturnType<typeof cartoucheBox>) {
  const size = 70;
  return { x: b.left ? b.x + b.w - size : b.x, y: b.y + b.h + 24, size };
}

function cartoucheFrame(ctx: CanvasRenderingContext2D, s: Scene, place: string, c: Cond) {
  const b = cartoucheBox(s, place, c);
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = ctx.fillStyle;
  ctx.strokeRect(b.x - 9, b.y - 9, b.w + 18, b.h + 18);
  ctx.restore();
}

function cartoucheLines(ctx: CanvasRenderingContext2D, s: Scene, place: string, c: Cond) {
  const b = cartoucheBox(s, place, c);
  ctx.save();
  ctx.lineWidth = 2.4;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 33px ${fontFamily}`;
  ctx.fillText(b.title, b.x + b.w / 2, b.y + 50, b.w - 30);
  ctx.font = `400 25px ${fontFamily}`;
  ctx.fillText(place, b.x + b.w / 2, b.y + 84, b.w - 30);
  ctx.restore();
}

function seal(ctx: CanvasRenderingContext2D, s: Scene, c: Cond, place: string) {
  const { x, y, size } = sealBox(cartoucheBox(s, place, c));
  ctx.save();
  ctx.fillRect(x, y, size, size);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 5, y + 5, size - 10, size - 10);
  ctx.textAlign = 'center';
  ctx.font = `700 25px ${fontFamily}`;
  ctx.fillText(String(c.localDay), x + size / 2, y + 33);
  ctx.font = `700 15px ${fontFamily}`;
  ctx.fillText(MONTHS[c.localMonth], x + size / 2, y + 55);
  ctx.restore();
}
