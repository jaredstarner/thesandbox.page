// Colour scales: a value in a block picks an entry from one of these. Every scale runs from the pad's own
// paper into ink, so the work reads as printed or burnt into the sheet, never as a picture laid on it.

export const PAPER = '#e8efdc';
export const INK = '#1b2a39';
export const GREEN = '#2c6a4f';
export const RED = '#b5291f';
export const BLUE = '#27488c';

export const LUT = 1024;

type Stop = [position: number, color: string, alpha?: number];

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Builds a palette from stops. Two stops at one position make a hard edge. */
export function ramp(stops: Stop[]): Uint32Array {
  const out = new Uint32Array(LUT);
  for (let i = 0; i < LUT; i++) {
    const x = i / (LUT - 1);
    let hi = stops.findIndex((s) => s[0] > x);
    if (hi < 0) hi = stops.length - 1;
    const lo = Math.max(0, hi - 1);
    const a = stops[lo];
    const b = stops[hi];
    const span = b[0] - a[0];
    const t = span > 0 ? Math.min(1, Math.max(0, (x - a[0]) / span)) : 1;
    const ca = rgb(a[1]);
    const cb = rgb(b[1]);
    const alpha = (a[2] ?? 1) + ((b[2] ?? 1) - (a[2] ?? 1)) * t;
    const r = ca[0] + (cb[0] - ca[0]) * t;
    const g = ca[1] + (cb[1] - ca[1]) * t;
    const bl = ca[2] + (cb[2] - ca[2]) * t;
    out[i] = ((alpha * 255) << 24) | ((bl & 255) << 16) | ((g & 255) << 8) | (r & 255);
  }
  return out;
}

/** The paper scorches brown, chars black, then glows: fire eating the sheet rather than a picture of fire. */
export const BURN = ramp([
  [0, '#b89a5e', 0],
  [0.035, '#a98a50', 0.55],
  [0.1, '#4a3420', 0.95],
  [0.17, '#1a1210'],
  [0.3, '#5c0f0a'],
  [0.46, '#b5291f'],
  [0.62, '#ea5b0c'],
  [0.78, '#f9ae18'],
  [0.92, '#ffe487'],
  [1, '#fffbe8'],
]);

export const INKWASH = ramp([
  [0, '#f3f6ea'],
  [0.3, '#a9cdb6'],
  [0.55, '#3f8a84'],
  [0.8, '#23477f'],
  [1, '#141c31'],
]);

/** Paper, blue, overprint, red, and back to paper, so it can wrap without a seam. */
export const RISO = ramp([
  [0, '#f3f6ea'],
  [0.25, '#3a6cc0'],
  [0.5, '#2a2350'],
  [0.75, '#dc4630'],
  [1, '#f3f6ea'],
]);

/** Eight flat steps, like contours on a map. */
export const BANDS = ramp(
  Array.from({ length: 8 }, (_, i) => {
    const colors = ['#f3f6ea', '#d3e4cd', '#a9cdb6', '#74ad99', '#3f8a84', '#2d6a78', '#23477f', '#141c31'];
    return [
      [i / 8, colors[i]],
      [(i + 1) / 8 - 0.0001, colors[i]],
    ] as Stop[];
  }).flat(),
);

export const CHECKER = ramp([
  [0, '#f3f6ea'],
  [0.5, '#f3f6ea'],
  [0.5, '#1b2a39'],
  [1, '#1b2a39'],
]);

export const LIFE = ramp([
  [0, '#9fcbb0', 0],
  [0.06, '#b9d8c3'],
  [0.5, '#6ea98c'],
  [0.97, '#2c6a4f'],
  [1, '#12241d'],
]);

/** Snake runs from -1 (food) through 0 (paper) to 14 and up (the head). */
export const SNAKE = ramp([
  [0, RED],
  [0.06, RED],
  [0.0601, '#ffffff', 0],
  [0.12, '#ffffff', 0],
  [0.1201, '#a8bcd8'],
  [0.5, '#4f73ad'],
  [1, '#13203c'],
]);

/** The maze runs in four bands: green, red, and blue walls fading to paper with distance, then the floor. */
export const MAZE = ramp([
  [0, '#123b2c'],
  [0.2499, PAPER],
  [0.25, '#6e1610'],
  [0.4999, PAPER],
  [0.5, '#17305f'],
  [0.7499, PAPER],
  [0.75, '#a9c29d'],
  [1, PAPER],
]);

export const PLAN = ramp([
  [0, PAPER, 0],
  [0.124, PAPER, 0],
  [0.125, GREEN],
  [0.374, GREEN],
  [0.375, RED],
  [0.624, RED],
  [0.625, BLUE],
  [0.874, BLUE],
  [0.875, INK],
  [1, INK],
]);

export const HEAT = ramp([
  [0, '#f3f6ea'],
  [0.5, '#e7c76d'],
  [1, '#b5291f'],
]);
