// What the sheet shows at any point between true geography (u = 0) and the finished diagram (u = 1):
// key positions read from the layout's frames, plain stations sliding from where they stand onto their
// chain's drawn route, and every line's path offset into its place in the bundle.

import type { Graph } from './_graph';
import type { Prepared } from './_prep';
import { bendPoint, type Angle } from './_layout';

export interface Scene {
  g: Graph;
  prep: Prepared;
  angle: Angle;
  /** Key positions: true geography first, then the layout's frames. */
  frames: Float32Array[];
  colours: string[];
}

export interface DrawnChain {
  /** Centreline through the chain's stations (and its bend), flat x, y pairs. */
  pts: number[];
  /** Index into pts (as a point number) of each station along the chain, ends included. */
  at: number[];
  /** Line indexes, in bundle order. */
  lines: number[];
  /** Each line's offset from the centreline, in layout units, left of the a-to-b direction. */
  offsets: number[];
}

export interface Frame {
  /** Station positions, NaN for stations nothing serves. */
  pos: Float64Array;
  chains: DrawnChain[];
  /** 0 while stations stand where they really are, 1 once they sit evenly on the drawn routes. */
  settle: number;
}

/** Line width and the distance between neighbouring lines in a bundle, in layout units. */
export const LINE = 0.22;
export const GAP = 0.26;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function frameAt(scene: Scene, u: number): Frame {
  const { g, prep, frames, angle } = scene;
  const n = g.names.length;
  const total = frames.length;
  const f = Math.min(total - 1, Math.max(0, u * (total - 1)));
  const f0 = Math.floor(f);
  const f1 = Math.min(total - 1, f0 + 1);
  const t = f - f0;
  const A = frames[f0];
  const B = frames[f1];
  const key = (k: number, axis: number) => A[k * 2 + axis] * (1 - t) + B[k * 2 + axis] * t;

  // Stations first move with the opened-out start (frame 0 to 1), then onto their routes.
  const open = Math.min(1, f);
  const settle = smooth(1, 1 + Math.max(2, (total - 2) * 0.45), f);

  const pos = new Float64Array(n * 2).fill(NaN);
  const base = (s: number, axis: number) =>
    prep.truth[s * 2 + axis] * (1 - open) + prep.opened[s * 2 + axis] * open;

  g.keys.forEach((s, k) => {
    pos[s * 2] = key(k, 0);
    pos[s * 2 + 1] = key(k, 1);
  });

  const chains: DrawnChain[] = [];
  g.chains.forEach((c, ci) => {
    const ax = key(c.a, 0);
    const ay = key(c.a, 1);
    const bx = key(c.b, 0);
    const by = key(c.b, 1);
    const side = prep.chains[ci].side;
    const bp = bendPoint(angle, ax, ay, bx, by, side);
    // The drawn route and its length.
    const route = bp ? [ax, ay, bp[0], bp[1], bx, by] : [ax, ay, bx, by];
    const segs: number[] = [];
    let total = 0;
    for (let i = 2; i < route.length; i += 2) {
      const l = Math.hypot(route[i] - route[i - 2], route[i + 1] - route[i - 1]);
      segs.push(l);
      total += l;
    }
    const along = (frac: number): [number, number] => {
      let d = frac * total;
      for (let i = 0; i < segs.length; i++) {
        if (d <= segs[i] || i === segs.length - 1) {
          const q = segs[i] > 0 ? d / segs[i] : 0;
          return [
            route[i * 2] + (route[i * 2 + 2] - route[i * 2]) * q,
            route[i * 2 + 1] + (route[i * 2 + 3] - route[i * 2 + 1]) * q,
          ];
        }
        d -= segs[i];
      }
      return [bx, by];
    };
    const k = c.inner.length;
    const bendFrac = bp && total > 0 ? segs[0] / total : -1;

    const pts: number[] = [ax, ay];
    const at: number[] = [0];
    let bendDone = !bp;
    for (let j = 0; j < k; j++) {
      const s = c.inner[j];
      const frac = (j + 1) / (k + 1);
      const [rx, ry] = along(frac);
      const x = base(s, 0) * (1 - settle) + rx * settle;
      const y = base(s, 1) * (1 - settle) + ry * settle;
      if (!bendDone && frac > bendFrac) {
        // The bend falls before this station: place it between the last point and this one.
        const lastFrac = j / (k + 1);
        const q = (bendFrac - lastFrac) / (frac - lastFrac);
        const px = pts[pts.length - 2];
        const py = pts[pts.length - 1];
        pts.push(px + (x - px) * q + (bp![0] - (px + (x - px) * q)) * settle);
        pts.push(py + (y - py) * q + (bp![1] - (py + (y - py) * q)) * settle);
        bendDone = true;
      }
      pos[s * 2] = x;
      pos[s * 2 + 1] = y;
      at.push(pts.length / 2);
      pts.push(x, y);
    }
    if (!bendDone && bp) {
      const px = pts[pts.length - 2];
      const py = pts[pts.length - 1];
      const lastFrac = k / (k + 1);
      const q = (bendFrac - lastFrac) / (1 - lastFrac);
      pts.push(px + (bx - px) * q + (bp[0] - (px + (bx - px) * q)) * settle);
      pts.push(py + (by - py) * q + (bp[1] - (py + (by - py) * q)) * settle);
    }
    at.push(pts.length / 2);
    pts.push(bx, by);

    // Bundle order: by line index, read in a fixed compass direction so neighbouring chains agree.
    const flip = bx - ax < -1e-6 || (Math.abs(bx - ax) <= 1e-6 && by - ay < 0) ? -1 : 1;
    const m = c.lines.length;
    const offsets = c.lines.map((_, j) => (j - (m - 1) / 2) * GAP * flip);
    chains.push({ pts, at, lines: c.lines, offsets });
  });

  return { pos, chains, settle };
}

/** The polyline offset sideways by d (left of travel), with mitred corners. */
export function offsetLine(pts: number[], d: number): number[] {
  if (d === 0) return pts.slice();
  // Drop repeated points so normals are defined.
  const p: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const n = p.length;
    if (n >= 2 && Math.abs(p[n - 2] - pts[i]) < 1e-9 && Math.abs(p[n - 1] - pts[i + 1]) < 1e-9) continue;
    p.push(pts[i], pts[i + 1]);
  }
  const count = p.length / 2;
  if (count < 2) return p;
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    const dx = p[i * 2 + 2] - p[i * 2];
    const dy = p[i * 2 + 3] - p[i * 2 + 1];
    const l = Math.hypot(dx, dy) || 1;
    nx.push(-dy / l);
    ny.push(dx / l);
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let mx: number;
    let my: number;
    if (i === 0) {
      mx = nx[0];
      my = ny[0];
    } else if (i === count - 1) {
      mx = nx[count - 2];
      my = ny[count - 2];
    } else {
      const sx = nx[i - 1] + nx[i];
      const sy = ny[i - 1] + ny[i];
      const sl = Math.hypot(sx, sy);
      if (sl < 1e-6) {
        mx = nx[i];
        my = ny[i];
      } else {
        const ux = sx / sl;
        const uy = sy / sl;
        const cos = ux * nx[i] + uy * ny[i];
        const k = 1 / Math.max(cos, 0.5);
        mx = ux * k;
        my = uy * k;
      }
    }
    out.push(p[i * 2] + mx * d, p[i * 2 + 1] + my * d);
  }
  return out;
}

/** Bounds of the stations in a frame: minX, minY, maxX, maxY. */
export function frameBounds(fr: Frame): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < fr.pos.length; i += 2) {
    const x = fr.pos[i];
    if (Number.isNaN(x)) continue;
    const y = fr.pos[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}
