// The carving map: for every direction from the pumpkin's centre, how deep the
// carving goes below the skin (red byte, 0 to DEPTH_MAX cm) and whether that
// part of the shell belongs to the lid (green byte). Longitude runs across,
// from the back round to the back again; latitude runs down from the stem.
//
// Tools work in centimetres on the skin and are converted to texels where they
// land, so a brush keeps its size as it nears the stem.

import { DEPTH_MAX, outerRadius, wallAt, type Variety } from './_shape';

export const MAP_W = 2048;
export const MAP_H = 1024;
const THROUGH = 255;

export type Tool = 'saw' | 'gouge' | 'scraper';
export type UV = [number, number];

interface UndoRect {
  x: number;
  y: number;
  w: number;
  h: number;
  bytes: Uint8Array;
}

const wrap = (d: number) => d - Math.round(d);
const toByte = (cm: number) => Math.max(0, Math.min(255, Math.round((cm / DEPTH_MAX) * 255)));

export class Carving {
  readonly data = new Uint8Array(MAP_W * MAP_H * 2);
  private backup: Uint8Array | null = null;
  private stroke: [number, number, number, number] | null = null;
  private dirtyRect: [number, number, number, number] | null = null;
  private undos: UndoRect[] = [];

  constructor(public vr: Variety) {}

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  /** Bilinear lookup, as the texture filter does it. */
  sample(u: number, v: number): { depth: number; lid: number } {
    const fx = (((u % 1) + 1) % 1) * MAP_W - 0.5;
    const fy = Math.max(0, Math.min(MAP_H - 1, v * MAP_H - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const xa = ((x0 % MAP_W) + MAP_W) % MAP_W;
    const xb = (xa + 1) % MAP_W;
    const ya = y0;
    const yb = Math.min(MAP_H - 1, y0 + 1);
    const at = (x: number, y: number, c: number) => this.data[(y * MAP_W + x) * 2 + c];
    const lerp = (c: number) =>
      (at(xa, ya, c) * (1 - tx) + at(xb, ya, c) * tx) * (1 - ty) + (at(xa, yb, c) * (1 - tx) + at(xb, yb, c) * tx) * ty;
    return { depth: (lerp(0) / 255) * DEPTH_MAX, lid: lerp(1) / 255 };
  }

  /** Take the rectangle changed since the last call, for upload. */
  takeDirty(): [number, number, number, number] | null {
    const d = this.dirtyRect;
    this.dirtyRect = null;
    return d;
  }

  private touch(x0: number, y0: number, x1: number, y1: number): void {
    // x may run past either edge of the map; a wrapped rectangle widens to the whole row.
    if (x0 < 0 || x1 >= MAP_W) {
      x0 = 0;
      x1 = MAP_W - 1;
    }
    y0 = Math.max(0, y0);
    y1 = Math.min(MAP_H - 1, y1);
    const add = (r: [number, number, number, number] | null): [number, number, number, number] =>
      r ? [Math.min(r[0], x0), Math.min(r[1], y0), Math.max(r[2], x1), Math.max(r[3], y1)] : [x0, y0, x1, y1];
    this.dirtyRect = add(this.dirtyRect);
    if (this.backup) this.stroke = add(this.stroke);
  }

  beginStroke(): void {
    if (!this.backup) this.backup = new Uint8Array(this.data.length);
    this.backup.set(this.data);
    this.stroke = null;
  }

  endStroke(): void {
    const r = this.stroke;
    const b = this.backup;
    this.backup = null;
    this.stroke = null;
    if (!r || !b) return;
    const [x0, y0, x1, y1] = r;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const bytes = new Uint8Array(w * h * 2);
    for (let y = 0; y < h; y++) {
      const from = ((y0 + y) * MAP_W + x0) * 2;
      bytes.set(b.subarray(from, from + w * 2), y * w * 2);
    }
    this.undos.push({ x: x0, y: y0, w, h, bytes });
    if (this.undos.length > 40) this.undos.shift();
  }

  undo(): boolean {
    const r = this.undos.pop();
    if (!r) return false;
    for (let y = 0; y < r.h; y++) {
      const to = ((r.y + y) * MAP_W + r.x) * 2;
      this.data.set(r.bytes.subarray(y * r.w * 2, (y + 1) * r.w * 2), to);
    }
    this.touch(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1);
    return true;
  }

  clear(): void {
    this.data.fill(0);
    this.undos = [];
    this.touch(0, 0, MAP_W - 1, MAP_H - 1);
  }

  /** Centimetres of skin per unit of u and of v at a point. */
  scales(u: number, v: number): [number, number] {
    const theta = v * Math.PI;
    const phi = (u - 0.5) * Math.PI * 2;
    const { r } = outerRadius(this.vr, Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    return [Math.max(0.5, Math.PI * 2 * r * Math.sin(theta)), Math.PI * r];
  }

  /**
   * A round tool mark centred at (u, v): `shape` gives the depth (cm) it digs to at a
   * distance in cm from the centre, given the depth already there, or null outside it.
   * Depths only ever grow.
   */
  private dab(
    u: number,
    v: number,
    radius: number,
    shape: (dist: number, theta: number, old: number) => number | null,
  ): void {
    const [su, sv] = this.scales(u, v);
    const rx = Math.min(MAP_W / 2 - 1, Math.ceil((radius / su) * MAP_W) + 1);
    const ry = Math.ceil((radius / sv) * MAP_H) + 1;
    const cx = u * MAP_W - 0.5;
    const cy = v * MAP_H - 0.5;
    const x0 = Math.floor(cx - rx);
    const x1 = Math.ceil(cx + rx);
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(MAP_H - 1, Math.ceil(cy + ry));
    for (let y = y0; y <= y1; y++) {
      const dy = ((y - cy) / MAP_H) * sv;
      const theta = ((y + 0.5) / MAP_H) * Math.PI;
      for (let x = x0; x <= x1; x++) {
        const dx = wrap((x - cx) / MAP_W) * su;
        const dist = Math.hypot(dx, dy);
        if (dist > radius + 0.05) continue;
        const i = ((((x % MAP_W) + MAP_W) % MAP_W) + y * MAP_W) * 2;
        const want = shape(dist, theta, (this.data[i] / 255) * DEPTH_MAX);
        if (want === null) continue;
        const b = toByte(want);
        if (b > this.data[i]) this.data[i] = b;
      }
    }
    this.touch(x0, y0, x1, y1);
  }

  /** One dab of a tool. Saw marks are a kerf straight through; the others add depth up to a limit. */
  tool(tool: Tool, u: number, v: number, pressure = 1): void {
    const vr = this.vr;
    if (tool === 'saw') {
      const half = 0.13;
      this.dab(u, v, half + 0.06, (d) => (d <= half ? DEPTH_MAX : d <= half + 0.06 ? DEPTH_MAX * (1 - (d - half) / 0.06) : null));
      return;
    }
    if (tool === 'gouge') {
      // Each dab takes off a little; a pass lays several, and it stops short of the inside.
      const r = 0.75;
      const add = 0.1 * pressure;
      this.dab(u, v, r, (d, theta, old) => {
        if (d > r) return null;
        const cap = wallAt(vr, theta) - 0.32;
        if (old >= cap) return null;
        const prof = Math.pow(1 - (d / r) ** 2, 1.2);
        return Math.min(cap, old + add * prof);
      });
      return;
    }
    const r = 0.7;
    this.dab(u, v, r, (d) => {
      if (d > r) return null;
      const prof = 1 - smooth(r * 0.55, r, d);
      return (vr.rind + 0.14) * Math.min(1, prof * 1.4) * pressure;
    });
  }

  /** Lay tool dabs along a segment, about four to a brush width. */
  line(tool: Tool, a: UV, b: UV, pressure = 1): void {
    const [su, sv] = this.scales(a[0], a[1]);
    const len = Math.hypot(wrap(b[0] - a[0]) * su, (b[1] - a[1]) * sv);
    const spacing = tool === 'saw' ? 0.06 : 0.18;
    const n = Math.max(1, Math.ceil(len / spacing));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      this.tool(tool, a[0] + wrap(b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, pressure);
    }
  }

  /**
   * Cover a region of the map, given in u (unwrapped, may run past 0 or 1) and v:
   * `inside` says whether a point is in, and `apply` writes a texel at its coverage.
   */
  private cover(
    polys: UV[][],
    sub: UV[][],
    apply: (i: number, coverage: number, y: number) => void,
    poleClose: 0 | 1 | null = null,
    upTo = 1,
  ): void {
    const all = [...polys, ...sub];
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of all) {
      for (const [u, v] of p) {
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      }
    }
    if (poleClose === 0) minV = 0;
    if (poleClose === 1) maxV = 1;
    const x0 = Math.floor(minU * MAP_W) - 1;
    const x1 = Math.ceil(maxU * MAP_W) + 1;
    const y0 = Math.max(0, Math.floor(minV * MAP_H) - 1);
    // upTo carves only the top part of the region, so a tool can be seen working down it.
    const y1 = Math.min(MAP_H - 1, Math.ceil(maxV * MAP_H) + 1, Math.floor(y0 + (Math.ceil(maxV * MAP_H) + 2 - y0) * upTo));
    const SUB = 4;
    const width = x1 - x0 + 1;
    const cov = new Float32Array(width);
    const spans = (set: UV[][], vy: number): number[] => {
      const xs: number[] = [];
      for (const p of set) {
        for (let i = 0; i < p.length; i++) {
          const [ua, va] = p[i];
          const [ub, vb] = p[(i + 1) % p.length];
          if (va <= vy !== vb <= vy) xs.push(ua + ((vy - va) / (vb - va)) * (ub - ua));
        }
      }
      return xs.sort((a, b) => a - b);
    };
    for (let y = y0; y <= y1; y++) {
      cov.fill(0);
      for (let s = 0; s < SUB; s++) {
        const vy = (y + (s + 0.5) / SUB) / MAP_H;
        const inX = spans(polys, vy);
        const outX = spans(sub, vy);
        // Walk the add spans, cutting out the sub spans, and add coverage per texel.
        for (let k = 0; k + 1 < inX.length; k += 2) {
          let pieces: [number, number][] = [[inX[k] * MAP_W, inX[k + 1] * MAP_W]];
          for (let j = 0; j + 1 < outX.length; j += 2) {
            const a = outX[j] * MAP_W;
            const b = outX[j + 1] * MAP_W;
            pieces = pieces.flatMap(([p, q]) => {
              if (b <= p || a >= q) return [[p, q] as [number, number]];
              const out: [number, number][] = [];
              if (a > p) out.push([p, a]);
              if (b < q) out.push([b, q]);
              return out;
            });
          }
          for (const [p, q] of pieces) {
            const ia = Math.max(x0, Math.floor(p));
            const ib = Math.min(x1, Math.floor(q));
            for (let x = ia; x <= ib; x++) {
              const c = Math.min(q, x + 1) - Math.max(p, x);
              if (c > 0) cov[x - x0] += c / SUB;
            }
          }
        }
      }
      for (let x = x0; x <= x1; x++) {
        const c = cov[x - x0];
        if (c <= 0) continue;
        const i = ((((x % MAP_W) + MAP_W) % MAP_W) + y * MAP_W) * 2;
        apply(i, Math.min(1, c), y);
      }
    }
    this.touch(x0, y0, x1, y1);
  }

  /** Cut a region right through. */
  cutOut(polys: UV[][], sub: UV[][] = []): void {
    this.cover(polys, sub, (i, c) => {
      const b = Math.round(c * THROUGH);
      if (b > this.data[i]) this.data[i] = b;
    });
  }

  /** Carve a region down to a depth (cm), as a function of latitude; `upTo` carves only its top part. */
  carveTo(polys: UV[][], sub: UV[][], depth: (theta: number) => number, upTo = 1): void {
    this.cover(
      polys,
      sub,
      (i, c, y) => {
        const theta = ((y + 0.5) / MAP_H) * Math.PI;
        const b = toByte(depth(theta) * c);
        if (b > this.data[i]) this.data[i] = b;
      },
      null,
      upTo,
    );
  }

  /** Mark the part of the shell above a cut line as the lid: `edge(u)` is the cut's latitude at each longitude. */
  markLidBins(edge: Float32Array): void {
    const n = edge.length;
    const loop: UV[] = Array.from({ length: n + 1 }, (_, i) => [i / n, edge[i % n]] as UV);
    const poly: UV[] = [...loop, [1, 0], [0, 0]];
    this.cover(
      [poly],
      [],
      (i, c) => {
        const b = Math.round(c * 255);
        if (b > this.data[i + 1]) this.data[i + 1] = b;
      },
      0,
    );
  }

  /** Mark the part of the shell inside a loop round the stem as the lid. */
  markLid(loop: UV[]): void {
    const poly = closeAtPole(loop, 0);
    this.cover(
      [poly],
      [],
      (i, c) => {
        const b = Math.round(c * 255);
        if (b > this.data[i + 1]) this.data[i + 1] = b;
      },
      0,
    );
  }

  /** The range of latitude the lid covers, for the renderer's cone test. */
  lidCone(): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < MAP_H / 2; y++) {
      let any = false;
      let all = true;
      for (let x = 0; x < MAP_W; x += 4) {
        const g = this.data[(y * MAP_W + x) * 2 + 1];
        if (g > 127) any = true;
        else all = false;
      }
      const theta = ((y + 0.5) / MAP_H) * Math.PI;
      if (all) lo = Math.max(lo === Infinity ? 0 : lo, theta);
      if (any) hi = theta;
    }
    if (hi === -Infinity) return [-1, -1];
    return [Math.max(0, (lo === Infinity ? 0 : lo) - 0.02), hi + 0.03];
  }

  /** Little holes along an outline, a few millimetres apart, as a pin leaves them. */
  prick(outline: UV[], closed = true, spacing = 0.32): void {
    const pts = closed ? [...outline, outline[0]] : outline;
    let carry = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const [su, sv] = this.scales(a[0], a[1]);
      const len = Math.hypot(wrap(b[0] - a[0]) * su, (b[1] - a[1]) * sv);
      let t = carry;
      while (t < len) {
        const f = t / len;
        const u = a[0] + wrap(b[0] - a[0]) * f;
        const v = a[1] + (b[1] - a[1]) * f;
        this.dab(u, v, 0.09, (d) => (d < 0.05 ? 0.5 : d < 0.09 ? 0.5 * (1 - (d - 0.05) / 0.04) : null));
        t += spacing;
      }
      carry = t - len;
    }
  }
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Unwrap a path's longitudes so it runs continuously, across the seam if need be. */
export function unwrap(path: UV[]): UV[] {
  const out: UV[] = [];
  for (const p of path) {
    if (!out.length) out.push([p[0], p[1]]);
    else {
      const prev = out[out.length - 1];
      out.push([prev[0] + wrap(p[0] - prev[0]), p[1]]);
    }
  }
  return out;
}

/** Close a loop that goes once round a pole by running along the pole's edge of the map. */
export function closeAtPole(loop: UV[], pole: 0 | 1): UV[] {
  const p = unwrap(loop);
  const first = p[0];
  const last = p[p.length - 1];
  const turned = last[0] - first[0] + wrap(first[0] - last[0]);
  // Make sure the loop has gone a full turn; then join its ends along the pole.
  const end: UV = [first[0] + turned, first[1]];
  return [...p, end, [end[0], pole], [first[0], pole]];
}

/** How many times a path goes round the stem: the change in longitude over a closed loop. */
export function turns(path: UV[]): number {
  const p = unwrap(path);
  const closing = wrap(p[0][0] - p[p.length - 1][0]);
  return (p[p.length - 1][0] - p[0][0] + closing) / 1;
}

/** Hit test against the shell: returns where along the ray it lands, or null. Local coordinates. */
export function pickShell(
  vr: Variety,
  carving: Carving,
  ro: number[],
  rd: number[],
  t0: number,
  t1: number,
  lidObj: boolean,
): { t: number; u: number; v: number; inner: boolean } | null {
  const at = (t: number) => {
    const x = ro[0] + rd[0] * t;
    const y = ro[1] + rd[1] * t;
    const z = ro[2] + rd[2] * t;
    const rho = Math.hypot(x, y, z);
    const { r, theta, phi } = outerRadius(vr, x / rho, y / rho, z / rho);
    const u = phi / (Math.PI * 2) + 0.5;
    const v = theta / Math.PI;
    const s = carving.sample(u, v);
    const rin = r - wallAt(vr, theta);
    const keep = lidObj ? s.lid > 0.5 : s.lid <= 0.5;
    return { rho, r, rin, d: s.depth, keep, u, v };
  };
  let t = Math.max(0, t0);
  let prev = t;
  for (let i = 0; i < 400 && t <= t1; i++) {
    const s = at(t);
    let step = 0.06;
    if (s.rho > s.r) step = (s.rho - s.r) * 0.7 + 0.008;
    else if (s.rho < s.rin) step = Math.max((s.rin - s.rho) * 0.6, 0.05);
    else if (s.keep && s.rho < s.r - s.d) {
      let a = prev;
      let b = t;
      for (let k = 0; k < 10; k++) {
        const m = (a + b) / 2;
        const sm = at(m);
        if (sm.keep && sm.rho < sm.r - sm.d && sm.rho > sm.rin) b = m;
        else a = m;
      }
      const h = at(b);
      return { t: b, u: h.u, v: h.v, inner: Math.abs(h.rho - h.rin) < 0.08 };
    }
    prev = t;
    t += step;
  }
  return null;
}
