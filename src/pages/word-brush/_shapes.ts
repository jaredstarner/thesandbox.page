// Shapes the page can draw for you. Each is built for the sheet's size, in
// CSS pixels, as ordinary strokes, so it undoes and redraws like your own.

import type { FillStroke, LineStroke, Stroke } from './_mask';

export interface Shape {
  id: string;
  label: string;
  /** A passage that belongs with the shape, by passage id. */
  passage?: string;
  build: (w: number, h: number, type: number) => Stroke[];
}

const line = (pts: number[]): LineStroke => ({ kind: 'line', mode: 'paint', pts });
const fill = (ring: number[], mode: FillStroke['mode'] = 'paint'): FillStroke => ({ kind: 'fill', mode, rings: [ring] });

/** The square-ish stage a shape is drawn on, leaving room for the masthead and tools. */
function stage(w: number, h: number) {
  const top = Math.min(110, h * 0.14);
  const bottom = Math.min(110, h * 0.16);
  const s = Math.min(w * 0.86, h - top - bottom);
  return { s, cx: w / 2, cy: top + (h - top - bottom) / 2 };
}

const circle = (cx: number, cy: number, r: number, n = 96) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
};

export const SHAPES: Shape[] = [
  {
    // Carroll's tail winds down the page and narrows to a point.
    id: 'tail',
    label: 'Tail',
    passage: 'tale',
    build(w, h, type) {
      const { s, cx, cy } = stage(w, h);
      const pts: number[] = [];
      const n = 220;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = cx + s * 0.2 * Math.sin(t * Math.PI * 3.3 + 0.5) * (1 - 0.45 * t) - s * 0.04;
        const y = cy - s * 0.47 + s * 0.94 * t;
        const width = Math.max(type * 1.6, s * (0.3 * Math.pow(1 - t, 1.15) + 0.02));
        pts.push(x, y, width);
      }
      return [line(pts)];
    },
  },
  {
    // Herbert's two wings: each line shorter and then longer again.
    id: 'wings',
    label: 'Wings',
    passage: 'wings',
    build(w, h) {
      const { s, cx, cy } = stage(w, h);
      const half = Math.min(s * 0.25, w * 0.23);
      const height = s * 0.92;
      const wing = (wx: number) => {
        const right: number[] = [];
        const left: number[] = [];
        const n = 60;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const y = cy - height / 2 + height * t;
          const hw = half * (0.14 + 0.86 * Math.pow(Math.abs(2 * t - 1), 1.35));
          right.push(wx + hw, y);
          left.unshift(wx - hw, y);
        }
        for (let i = 0; i < left.length; i += 2) right.push(left[i], left[i + 1]);
        return fill(right);
      };
      return [wing(cx - half * 1.08), wing(cx + half * 1.08)];
    },
  },
  {
    id: 'heart',
    label: 'Heart',
    build(w, h) {
      const { s, cx, cy } = stage(w, h);
      const k = s / 34;
      const ring: number[] = [];
      for (let i = 0; i < 160; i++) {
        const t = (i / 160) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        ring.push(cx + x * k, cy + (y + 2.5) * k);
      }
      return [fill(ring)];
    },
  },
  {
    // Slanting streaks, after Apollinaire's rain of letters.
    id: 'rain',
    label: 'Rain',
    build(w, h, type) {
      const { s, cy } = stage(w, h);
      const width = Math.max(type * 3.2, s * 0.07);
      const count = Math.max(4, Math.min(9, Math.floor((w * 0.86) / (width * 2.1))));
      const span = w * 0.8;
      const out: Stroke[] = [];
      for (let i = 0; i < count; i++) {
        const x = w / 2 - span / 2 + (span * (i + 0.5)) / count;
        const len = s * (0.62 + 0.3 * Math.abs(Math.sin(i * 2.4 + 1)));
        const y0 = cy - s * 0.46 + (i % 3) * s * 0.03;
        const pts: number[] = [];
        for (let j = 0; j <= 30; j++) {
          const t = j / 30;
          pts.push(x + len * 0.16 * t, y0 + len * t, width * (1 - 0.25 * t));
        }
        out.push(line(pts));
      }
      return out;
    },
  },
  {
    id: 'spiral',
    label: 'Spiral',
    build(w, h, type) {
      const { s, cx, cy } = stage(w, h);
      const width = Math.max(type * 3.4, s * 0.085);
      const turns = 2.6;
      const r1 = s * 0.46 - width / 2;
      const pts: number[] = [];
      const n = 360;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const a = t * turns * Math.PI * 2;
        const r = width * 0.4 + (r1 - width * 0.4) * t;
        pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r, width);
      }
      return [line(pts)];
    },
  },
  {
    id: 'moon',
    label: 'Moon',
    build(w, h) {
      const { s, cx, cy } = stage(w, h);
      const r = s * 0.46;
      return [fill(circle(cx, cy, r)), fill(circle(cx + r * 0.42, cy - r * 0.18, r * 0.86), 'erase')];
    },
  },
  {
    id: 'wave',
    label: 'Wave',
    build(w, h, type) {
      const { s, cy } = stage(w, h);
      const width = Math.max(type * 4, s * 0.16);
      const pts: number[] = [];
      const x0 = w * 0.08;
      const x1 = w * 0.92;
      for (let i = 0; i <= 160; i++) {
        const t = i / 160;
        pts.push(x0 + (x1 - x0) * t, cy + Math.sin(t * Math.PI * 3) * s * 0.26, width);
      }
      return [line(pts)];
    },
  },
];
