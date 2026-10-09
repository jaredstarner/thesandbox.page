// One breeze for the picture and the sound: a slow wander plus gusts.

import { noise1 } from './_rng';

export interface Wind {
  /** Push along the wind direction, about 0 to 1.4. */
  gust: number;
  /** Direction in the ground plane, unit length. */
  dirX: number;
  dirZ: number;
}

export function windAt(t: number, breeze: number, out: Wind): Wind {
  const slow = 0.55 + 0.45 * noise1(t * 0.21, 1);
  const g = Math.max(0, noise1(t * 0.63, 2));
  const flurry = Math.max(0, noise1(t * 1.9, 3)) * 0.25;
  out.gust = breeze * (slow * 0.75 + g * g * 0.9 * breeze + flurry * breeze);
  const a = 0.35 + noise1(t * 0.05, 4) * 0.5;
  out.dirX = Math.cos(a);
  out.dirZ = Math.sin(a);
  return out;
}

/** The shader's sway, on the CPU, so taps can find a branch where it is drawn. */
export function swayAt(
  x: number,
  y: number,
  z: number,
  flex: number,
  t: number,
  freq: number,
  breeze: number,
  height: number,
  w: Wind,
  out: [number, number, number],
): [number, number, number] {
  const ph = (x * 0.31 + y * 0.17 + z * 0.23) / Math.max(0.15, height * 0.08);
  const s = t * freq;
  const along = w.gust * (0.85 + 0.15 * Math.sin(s * 1.3 + ph));
  const tw = (0.06 + 0.12 * breeze) * 1;
  let dx = w.dirX * along + Math.sin(s * 2.1 + ph * 1.7) * tw;
  let dz = w.dirZ * along + Math.cos(s * 1.7 + ph * 2.3) * tw;
  dx *= flex;
  dz *= flex;
  const dy = (-(dx * dx + dz * dz) / Math.max(height, 0.1)) * 0.6;
  out[0] = dx;
  out[1] = dy;
  out[2] = dz;
  return out;
}

export const SWAY_GLSL = /* glsl */ `
uniform float uTime;
uniform float uFreq;
uniform float uGust;
uniform float uBreeze;
uniform vec2 uWindDir;
uniform float uHeight;

vec3 sway(vec3 p, float f) {
  float ph = dot(p, vec3(0.31, 0.17, 0.23)) / max(0.15, uHeight * 0.08);
  float s = uTime * uFreq;
  float along = uGust * (0.85 + 0.15 * sin(s * 1.3 + ph));
  float tw = 0.06 + 0.12 * uBreeze;
  vec3 d = vec3(uWindDir.x * along + sin(s * 2.1 + ph * 1.7) * tw, 0.0, uWindDir.y * along + cos(s * 1.7 + ph * 2.3) * tw);
  d *= f;
  d.y = -dot(d.xz, d.xz) / max(uHeight, 0.1) * 0.6;
  return d;
}
`;
