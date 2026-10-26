// The pumpkin as a radial function: from its centre, every direction meets the
// skin at one distance, so the shell is everything between that skin and an
// inner wall a wall's thickness further in. Ribs, the stem dimple, and the
// flattened base are all terms of that one distance. The renderer evaluates
// the same function in GLSL (see GLSL_SHAPE), and the carving tools use this
// copy to find where the pointer lands, so the two must stay in step.
//
// Units are centimetres. Local frame: y up, the pumpkin's centre at the origin.

export type VarietyId = 'howden' | 'cinderella' | 'lumina';

export interface Variety {
  id: VarietyId;
  name: string;
  note: string;
  /** Equatorial and polar semi-axes. */
  a: number;
  b: number;
  /** Superellipse exponent of the side profile: 2 is an ellipse, more is boxier. */
  boxy: number;
  ribs: number;
  /** Groove depth as a fraction of the radius, and how narrow the grooves are. */
  ribDepth: number;
  ribSharp: number;
  dimpleTop: number;
  dimpleBottom: number;
  wall: number;
  rind: number;
  /** Linear-light colours. */
  skin: [number, number, number];
  groove: [number, number, number];
  ground: [number, number, number];
  flesh: [number, number, number];
  /** Per-channel attenuation of light through the flesh, per cm, and through the rind. */
  fleshSigma: [number, number, number];
  rindSigma: [number, number, number];
  stem: { length: number; radius: number; bend: number; lean: number; color: [number, number, number] };
  /** Phases for the rib warp and lumps, so each pumpkin is its own. */
  seed: number;
}

const srgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
};

export const VARIETIES: Record<VarietyId, Variety> = {
  howden: {
    id: 'howden',
    name: 'Howden',
    note: 'The classic carving pumpkin: upright, evenly ribbed, with thick, even walls.',
    a: 15.5,
    b: 14.2,
    boxy: 2.35,
    ribs: 11,
    ribDepth: 0.075,
    ribSharp: 2.5,
    dimpleTop: 3.0,
    dimpleBottom: 2.2,
    wall: 2.6,
    rind: 0.22,
    skin: srgb('#e2731d'),
    groove: srgb('#a65a1c'),
    ground: srgb('#e3b25b'),
    flesh: srgb('#f5ab45'),
    fleshSigma: [0.85, 1.35, 2.6],
    rindSigma: [12, 20, 34],
    stem: { length: 7.5, radius: 1.55, bend: 1.6, lean: 0.12, color: srgb('#5b5a33') },
    seed: 1.7,
  },
  cinderella: {
    id: 'cinderella',
    name: 'Cinderella',
    note: "Rouge vif d'Étampes, the flat red French pumpkin: deep lobes and a stubby stem.",
    a: 19.5,
    b: 10.6,
    boxy: 2.6,
    ribs: 10,
    ribDepth: 0.12,
    ribSharp: 2.4,
    dimpleTop: 3.6,
    dimpleBottom: 2.0,
    wall: 3.1,
    rind: 0.2,
    skin: srgb('#cc4519'),
    groove: srgb('#8a3a16'),
    ground: srgb('#d89a4a'),
    flesh: srgb('#f29a3a'),
    fleshSigma: [0.9, 1.4, 2.7],
    rindSigma: [13, 21, 36],
    stem: { length: 4.2, radius: 1.7, bend: 0.8, lean: -0.08, color: srgb('#6a6038') },
    seed: 4.2,
  },
  lumina: {
    id: 'lumina',
    name: 'Lumina',
    note: 'A white pumpkin with orange flesh, so the carved parts glow brighter against the skin.',
    a: 13.6,
    b: 12.4,
    boxy: 2.2,
    ribs: 12,
    ribDepth: 0.055,
    ribSharp: 3.6,
    dimpleTop: 2.5,
    dimpleBottom: 1.9,
    wall: 2.2,
    rind: 0.16,
    skin: srgb('#e9e3d2'),
    groove: srgb('#b4b79c'),
    ground: srgb('#e3d6a6'),
    flesh: srgb('#f3a43c'),
    fleshSigma: [0.8, 1.3, 2.4],
    rindSigma: [11, 15, 22],
    stem: { length: 6.2, radius: 1.35, bend: 2.2, lean: 0.2, color: srgb('#6b6a45') },
    seed: 7.9,
  },
};

/** The carving map: depth below the skin (cm) and the lid mask, sampled by direction. */
export interface DepthSampler {
  (u: number, v: number): { depth: number; lid: number };
}

export interface Radii {
  /** Skin before carving, carved surface, and inner wall. */
  outer: number;
  carved: number;
  inner: number;
  /** Polar angle from the top (0) to the bottom (pi), and longitude. */
  theta: number;
  phi: number;
  u: number;
  v: number;
  lid: number;
}

const TAU = Math.PI * 2;

/** Groove amount at a longitude: 1 in a groove, 0 mid-lobe. */
export function grooveAt(vr: Variety, phi: number): number {
  const s = vr.seed;
  const warped = phi + 0.09 * Math.sin(phi + s) + 0.05 * Math.sin(2 * phi + s * 1.7) + 0.03 * Math.sin(3 * phi + s * 2.3);
  const k = (vr.ribs * warped) / TAU;
  const f = k - Math.floor(k);
  const lobe = Math.sin(Math.PI * f);
  return Math.pow(1 - lobe, vr.ribSharp);
}

/** Skin radius in a direction (unit vector), before carving. */
export function outerRadius(vr: Variety, dx: number, dy: number, dz: number): { r: number; theta: number; phi: number } {
  const sinT = Math.min(1, Math.hypot(dx, dz));
  const cosT = dy;
  const theta = Math.atan2(sinT, cosT);
  const phi = Math.atan2(dz, dx);
  const n = vr.boxy;
  const re = Math.pow(Math.pow(sinT / vr.a, n) + Math.pow(Math.abs(cosT) / vr.b, n), -1 / n);
  const s = vr.seed;
  // Grooves fade out toward the poles, where they all meet.
  const depth = vr.ribDepth * (1 + 0.28 * Math.sin(3 * phi + s * 3.1) + 0.14 * Math.sin(5 * phi + s));
  let r = re * (1 - depth * grooveAt(vr, phi) * Math.pow(sinT, 0.6));
  // A slight lean and lumpiness, so it doesn't look turned on a lathe.
  r *= 1 + 0.025 * Math.sin(phi + s * 0.7) * sinT + 0.018 * Math.sin(2 * phi + s * 1.3) * sinT * sinT + 0.012 * cosT;
  r -= vr.dimpleTop * Math.exp(-((theta / 0.36) ** 2));
  r -= vr.dimpleBottom * Math.exp(-(((Math.PI - theta) / 0.42) ** 2));
  return { r, theta, phi };
}

/** Wall thickness in a direction: thicker round the stem and the base. */
export function wallAt(vr: Variety, theta: number): number {
  return vr.wall + 1.6 * Math.exp(-((theta / 0.42) ** 2)) + 0.8 * Math.exp(-(((Math.PI - theta) / 0.5) ** 2));
}

export function radii(vr: Variety, dx: number, dy: number, dz: number, sample: DepthSampler): Radii {
  const { r, theta, phi } = outerRadius(vr, dx, dy, dz);
  const u = phi / TAU + 0.5;
  const v = theta / Math.PI;
  const { depth, lid } = sample(u, v);
  return { outer: r, carved: r - depth, inner: r - wallAt(vr, theta), theta, phi, u, v, lid };
}

/** Height of the centre above the table, so the lowest point of the skin rests on it. */
export function restHeight(vr: Variety): number {
  let low = 0;
  for (let i = 0; i <= 400; i++) {
    const theta = Math.PI * (0.5 + 0.5 * (i / 400));
    for (let j = 0; j < 24; j++) {
      const phi = (j / 24) * TAU;
      const dx = Math.sin(theta) * Math.cos(phi);
      const dz = Math.sin(theta) * Math.sin(phi);
      const dy = Math.cos(theta);
      const { r } = outerRadius(vr, dx, dy, dz);
      low = Math.max(low, -dy * r);
    }
  }
  // Sit a few millimetres into the table, the way a heavy pumpkin settles.
  return low - 0.25;
}

/** The largest skin radius, for bounding spheres. */
export function maxRadius(vr: Variety): number {
  let hi = 0;
  for (let i = 0; i <= 64; i++) {
    const theta = Math.PI * (i / 64);
    for (let j = 0; j < 48; j++) {
      const phi = (j / 48) * TAU;
      const { r } = outerRadius(vr, Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
      hi = Math.max(hi, r);
    }
  }
  return hi * 1.02 + 0.2;
}

/**
 * The same functions in GLSL. Uniforms carry the variety's numbers; uDepth is
 * the carving map (r: depth / DEPTH_MAX, g: lid mask).
 */
export const GLSL_SHAPE = /* glsl */ `
uniform float uA, uB, uBoxy, uRibs, uRibDepth, uRibSharp, uDimpleTop, uDimpleBottom, uWall, uSeed;
uniform sampler2D uDepth;
const float TAU = 6.28318530718;
const float PI = 3.14159265359;
const float DEPTH_MAX = ${(4).toFixed(1)};

float grooveAt(float phi) {
  float s = uSeed;
  float w = phi + 0.09 * sin(phi + s) + 0.05 * sin(2.0 * phi + s * 1.7) + 0.03 * sin(3.0 * phi + s * 2.3);
  float k = uRibs * w / TAU;
  float lobe = sin(PI * fract(k));
  return pow(1.0 - lobe, uRibSharp);
}

// x: skin radius, y: theta, z: phi
vec3 outerRadius(vec3 d) {
  float sinT = min(1.0, length(d.xz));
  float cosT = d.y;
  float theta = atan(sinT, cosT);
  float phi = atan(d.z, d.x);
  float n = uBoxy;
  float re = pow(pow(sinT / uA, n) + pow(abs(cosT) / uB, n), -1.0 / n);
  float s = uSeed;
  float depth = uRibDepth * (1.0 + 0.28 * sin(3.0 * phi + s * 3.1) + 0.14 * sin(5.0 * phi + s));
  float r = re * (1.0 - depth * grooveAt(phi) * pow(sinT, 0.6));
  r *= 1.0 + 0.025 * sin(phi + s * 0.7) * sinT + 0.018 * sin(2.0 * phi + s * 1.3) * sinT * sinT + 0.012 * cosT;
  r -= uDimpleTop * exp(-pow(theta / 0.36, 2.0));
  r -= uDimpleBottom * exp(-pow((PI - theta) / 0.42, 2.0));
  return vec3(r, theta, phi);
}

float wallAt(float theta) {
  return uWall + 1.6 * exp(-pow(theta / 0.42, 2.0)) + 0.8 * exp(-pow((PI - theta) / 0.5, 2.0));
}

vec2 depthUv(float theta, float phi) {
  return vec2(phi / TAU + 0.5, theta / PI);
}
`;

export const DEPTH_MAX = 4;
