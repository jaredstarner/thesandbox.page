// Finding room for the names on the finished diagram. Each station tries a set of positions around
// itself (beside, above, below, at the corners, or set on the diagonal) and takes the cheapest: any
// collision with a line, a station, or a name already placed costs far more than a less favoured spot.
// Busy stations choose first, then each chain in order, so a run of stations keeps its names on one side.

import type { Graph } from './_graph';
import { GAP, LINE, type Frame } from './_scene';

export interface Label {
  station: number;
  /** Reference point of the text, layout units. */
  x: number;
  y: number;
  /** Rotation in radians (0, or plus or minus a quarter turn's half). */
  angle: number;
  align: 'left' | 'right' | 'center';
  /** True when no clear spot was found. */
  clash: boolean;
  /** Which side of the station the label sits, as a unit vector (for ticks). */
  sx: number;
  sy: number;
}

/** Text size and line height of names, layout units. */
export const NAME_SIZE = 0.38;

interface Box {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  ux: number;
  uy: number;
}

interface Capsule {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
}

const CELL = 3;

/** Distance from a point to a box (0 inside). */
function pointBox(px: number, py: number, b: Box): number {
  const dx = px - b.cx;
  const dy = py - b.cy;
  const lx = Math.abs(dx * b.ux + dy * b.uy) - b.hw;
  const ly = Math.abs(-dx * b.uy + dy * b.ux) - b.hh;
  return Math.hypot(Math.max(lx, 0), Math.max(ly, 0));
}

/** Distance from a segment to a box, 0 when they touch. */
function segBox(c: Capsule, b: Box): number {
  // Into box coordinates.
  const tx = (x: number, y: number): [number, number] => {
    const dx = x - b.cx;
    const dy = y - b.cy;
    return [dx * b.ux + dy * b.uy, -dx * b.uy + dy * b.ux];
  };
  const [x0, y0] = tx(c.ax, c.ay);
  const [x1, y1] = tx(c.bx, c.by);
  // Liang-Barsky clip against the box.
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (clip(-dx, x0 + b.hw) && clip(dx, b.hw - x0) && clip(-dy, y0 + b.hh) && clip(dy, b.hh - y0) && t0 <= t1) return 0;
  // Otherwise the nearest of: segment ends to box, box corners to segment.
  let best = Math.min(pointBox(c.ax, c.ay, b), pointBox(c.bx, c.by, b));
  const l2 = dx * dx + dy * dy;
  for (const [cx, cy] of [
    [b.hw, b.hh],
    [-b.hw, b.hh],
    [b.hw, -b.hh],
    [-b.hw, -b.hh],
  ]) {
    let t = l2 > 0 ? ((cx - x0) * dx + (cy - y0) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(cx - x0 - t * dx, cy - y0 - t * dy));
  }
  return best;
}

/** Separating-axis test for two boxes, with a margin. */
function boxesOverlap(a: Box, b: Box, margin: number): boolean {
  const axes = [
    [a.ux, a.uy],
    [-a.uy, a.ux],
    [b.ux, b.uy],
    [-b.uy, b.ux],
  ];
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  for (const [x, y] of axes) {
    const ra = a.hw * Math.abs(a.ux * x + a.uy * y) + a.hh * Math.abs(-a.uy * x + a.ux * y);
    const rb = b.hw * Math.abs(b.ux * x + b.uy * y) + b.hh * Math.abs(-b.uy * x + b.ux * y);
    if (Math.abs(dx * x + dy * y) > ra + rb + margin) return false;
  }
  return true;
}

interface Candidate {
  dx: number;
  dy: number;
  angle: number;
  align: Label['align'];
  cost: number;
  /** Extra distance from the station, for names set out in the gap between lines at a busy junction. */
  far?: number;
}

const D = Math.SQRT1_2;
const CANDIDATES: Candidate[] = [
  { dx: 1, dy: 0, angle: 0, align: 'left', cost: 0 },
  { dx: -1, dy: 0, angle: 0, align: 'right', cost: 0.3 },
  { dx: D, dy: -D, angle: 0, align: 'left', cost: 0.8 },
  { dx: D, dy: D, angle: 0, align: 'left', cost: 0.9 },
  { dx: -D, dy: -D, angle: 0, align: 'right', cost: 1 },
  { dx: -D, dy: D, angle: 0, align: 'right', cost: 1.1 },
  { dx: 0, dy: -1, angle: 0, align: 'center', cost: 1.4 },
  { dx: 0, dy: 1, angle: 0, align: 'center', cost: 1.5 },
  { dx: D, dy: -D, angle: -Math.PI / 4, align: 'left', cost: 2.2 },
  { dx: -D, dy: D, angle: -Math.PI / 4, align: 'right', cost: 2.4 },
  { dx: D, dy: D, angle: Math.PI / 4, align: 'left', cost: 2.6 },
  { dx: -D, dy: -D, angle: Math.PI / 4, align: 'right', cost: 2.8 },
];
for (const c of CANDIDATES.slice(0, 8)) CANDIDATES.push({ ...c, cost: c.cost + 1.8, far: 0.5 });

export function placeLabels(g: Graph, fr: Frame, marker: Float64Array, measure: (text: string) => number): Label[] {
  const h = NAME_SIZE * 1.18;
  // Obstacles: every chain's bundle as capsules, and every station's marker.
  const caps: Capsule[] = [];
  for (const c of fr.chains) {
    const r = c.lines.length ? ((c.lines.length - 1) * GAP + LINE) / 2 + 0.04 : 0.18;
    for (let i = 2; i < c.pts.length; i += 2)
      caps.push({ ax: c.pts[i - 2], ay: c.pts[i - 1], bx: c.pts[i], by: c.pts[i + 1], r });
  }
  const grid = new Map<number, number[]>();
  const cellKey = (i: number, j: number) => (i + 5000) * 10000 + (j + 5000);
  caps.forEach((c, idx) => {
    const i0 = Math.floor((Math.min(c.ax, c.bx) - c.r) / CELL);
    const i1 = Math.floor((Math.max(c.ax, c.bx) + c.r) / CELL);
    const j0 = Math.floor((Math.min(c.ay, c.by) - c.r) / CELL);
    const j1 = Math.floor((Math.max(c.ay, c.by) + c.r) / CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = cellKey(i, j);
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(idx);
      }
  });
  const stations: number[] = [];
  for (let s = 0; s < g.names.length; s++) if (!Number.isNaN(fr.pos[s * 2])) stations.push(s);
  const sGrid = new Map<number, number[]>();
  for (const s of stations) {
    const k = cellKey(Math.floor(fr.pos[s * 2] / CELL), Math.floor(fr.pos[s * 2 + 1] / CELL));
    (sGrid.get(k) ?? sGrid.set(k, []).get(k)!).push(s);
  }
  const placed: Box[] = [];
  const lGrid = new Map<number, number[]>();

  const near = (b: Box, map: Map<number, number[]>) => {
    const reach = Math.max(b.hw, b.hh) + 1;
    const i0 = Math.floor((b.cx - reach) / CELL);
    const i1 = Math.floor((b.cx + reach) / CELL);
    const j0 = Math.floor((b.cy - reach) / CELL);
    const j1 = Math.floor((b.cy + reach) / CELL);
    const out = new Set<number>();
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) for (const x of map.get(cellKey(i, j)) ?? []) out.add(x);
    return out;
  };

  // Order: interchanges and ends first, then the rest chain by chain.
  const order: number[] = [];
  const seen = new Set<number>();
  const busy = stations
    .filter((s) => g.served[s].length > 1 || g.keyOf[s] >= 0)
    .sort((a, b) => g.served[b].length - g.served[a].length);
  for (const s of busy) {
    if (!seen.has(s)) {
      seen.add(s);
      order.push(s);
    }
  }
  for (const c of g.chains)
    for (const s of c.inner)
      if (!seen.has(s)) {
        seen.add(s);
        order.push(s);
      }

  // Each station's previous choice along its chain, to keep runs consistent.
  const prevOf = new Map<number, number>();
  for (const c of g.chains) for (let i = 1; i < c.inner.length; i++) prevOf.set(c.inner[i], c.inner[i - 1]);
  const chosen = new Map<number, number>();

  const labels: Label[] = [];
  for (const s of order) {
    const x = fr.pos[s * 2];
    const y = fr.pos[s * 2 + 1];
    const w = measure(g.names[s]);
    const gap = marker[s] + 0.14;
    const allowed = g.served[s].length > 1 || g.keyOf[s] >= 0 ? 2 : 1;
    let best: { box: Box; label: Label; score: number; ci: number } | null = null;
    CANDIDATES.forEach((cand, ci) => {
      const ax = x + cand.dx * (gap + (cand.far ?? 0));
      const ay = y + cand.dy * (gap + (cand.far ?? 0));
      const ux = Math.cos(cand.angle);
      const uy = Math.sin(cand.angle);
      // Centre of the text box from the reference point and alignment.
      let along = 0;
      if (cand.align === 'left') along = w / 2;
      else if (cand.align === 'right') along = -w / 2;
      const cx = ax + ux * along;
      let cy = ay + uy * along;
      if (cand.angle === 0 && cand.align === 'center') cy += cand.dy * (h / 2);
      else if (cand.angle === 0 && cand.dy !== 0) cy += cand.dy * (h / 2) * 0.6;
      const box: Box = { cx, cy, hw: w / 2, hh: h / 2, ux, uy };
      let score = cand.cost;
      let hits = 0;
      for (const idx of near(box, grid)) {
        const c = caps[idx];
        if (segBox(c, box) < c.r) hits++;
      }
      score += hits * 40;
      let hard = 0;
      for (const o of near(box, sGrid)) {
        if (o === s) continue;
        if (pointBox(fr.pos[o * 2], fr.pos[o * 2 + 1], box) < marker[o] + 0.05) hard++;
      }
      for (const li of near(box, lGrid)) if (boxesOverlap(box, placed[li], 0.06)) hard++;
      score += hard * 200;
      const prev = prevOf.get(s);
      if (prev !== undefined && chosen.get(prev) === ci) score -= 0.7;
      if (!best || score < best.score) {
        const len = Math.hypot(cand.dx, cand.dy) || 1;
        best = {
          box,
          score,
          ci,
          label: {
            station: s,
            x: ax,
            y: cand.angle === 0 && cand.dy !== 0 ? cy : ay,
            angle: cand.angle,
            align: cand.align,
            // A name may cross a line or two (it is drawn with a halo), never another name or station.
            clash: hard > 0 || hits > allowed,
            sx: cand.dx / len,
            sy: cand.dy / len,
          },
        };
      }
    });
    if (!best) continue;
    const b = best as { box: Box; label: Label; score: number; ci: number };
    chosen.set(s, b.ci);
    labels.push(b.label);
    if (!b.label.clash) {
      const idx = placed.length;
      placed.push(b.box);
      const reach = Math.max(b.box.hw, b.box.hh);
      for (let i = Math.floor((b.box.cx - reach) / CELL); i <= Math.floor((b.box.cx + reach) / CELL); i++)
        for (let j = Math.floor((b.box.cy - reach) / CELL); j <= Math.floor((b.box.cy + reach) / CELL); j++) {
          const k = cellKey(i, j);
          (lGrid.get(k) ?? lGrid.set(k, []).get(k)!).push(idx);
        }
    }
  }
  return labels;
}

/** The area the placed names cover, layout units: minX, minY, maxX, maxY. */
export function labelExtent(
  g: Graph,
  labels: Label[],
  measure: (text: string) => number,
): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const h = (NAME_SIZE * 1.18) / 2;
  for (const l of labels) {
    if (l.clash) continue;
    const w = measure(g.names[l.station]);
    const ux = Math.cos(l.angle);
    const uy = Math.sin(l.angle);
    const from = l.align === 'left' ? 0 : l.align === 'right' ? -w : -w / 2;
    for (const along of [from, from + w])
      for (const across of [-h, h]) {
        const x = l.x + ux * along - uy * across;
        const y = l.y + uy * along + ux * across;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  }
  return [minX, minY, maxX, maxY];
}
