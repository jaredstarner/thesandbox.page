// The trough: every film of colour is a closed polygon floating on the size,
// and every gesture is an exact map of the plane, after Aubrey Jaffer's
// "Mathematical Marbling". A drop pushes everything radially outward so that
// area is kept; a tine drags everything beside it along its path, falling off
// with distance. Polygons are refined as they stretch, so the veins stay
// sharp at any zoom.

export interface Blot {
  /** Index into PIGMENTS, or -1 for clear gall water. */
  color: number;
  /** Interleaved x, y. */
  pts: Float64Array;
  /** Bounding box: min x, min y, max x, max y. */
  box: [number, number, number, number];
}

/** A map of the plane, written into `out` to avoid allocation. */
export type PlaneMap = (x: number, y: number, out: Float64Array) => void;

/** Whether a map can move anything inside a bounding box; films outside are left as they are. */
export type Touches = (x0: number, y0: number, x1: number, y1: number) => boolean;

/** Project a box onto a direction from an origin: the range it covers. */
function project(x0: number, y0: number, x1: number, y1: number, ox: number, oy: number, dx: number, dy: number): [number, number] {
  const a = (x0 - ox) * dx;
  const b = (x1 - ox) * dx;
  const c = (y0 - oy) * dy;
  const d = (y1 - oy) * dy;
  return [Math.min(a, b) + Math.min(c, d), Math.max(a, b) + Math.max(c, d)];
}

export function boxOf(pts: Float64Array): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i];
    const y = pts[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** How a set of tines is laid out: one pin, a row, or a grid. */
export interface Tines {
  /** Spacing along the bar, 0 for a single stylus. */
  spacing: number;
  /** Unit direction of the bar. */
  nx: number;
  ny: number;
  /** A second row direction, for a grid of pins (the French curl). */
  spacing2?: number;
  /** How far paint right at a tine is carried, in trough units. */
  z: number;
  /** The distance at which the drag falls to half. */
  half: number;
}

const LN2 = Math.LN2;

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Jaffer's drop: P -> C + (P - C) * sqrt(1 + r^2 / |P - C|^2). */
export function dropMap(cx: number, cy: number, r2: number): PlaneMap {
  return (x, y, out) => {
    const dx = x - cx;
    const dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-12) {
      out[0] = cx + Math.sqrt(r2);
      out[1] = cy;
      return;
    }
    const s = Math.sqrt(1 + r2 / d2);
    out[0] = cx + dx * s;
    out[1] = cy + dy * s;
  };
}

/**
 * One step of a tine stroke, from a to b. Jaffer's tine line moves a point
 * z * u^d along the stroke, d being its distance from the tine's track. Here
 * that displacement is paid out as the tine passes the point, over a ramp
 * twice z long, so a slow stroke and a fast one leave the same marks and a
 * curved stroke drags along its own path. The ramp is long enough that the
 * map never folds paint over itself.
 */
export function tineMap(t: Tines, ax: number, ay: number, bx: number, by: number): { map: PlaneMap; touches?: Touches } | null {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1e-6) return null;
  const mx = (bx - ax) / len;
  const my = (by - ay) / len;
  const k = LN2 / t.half;
  const ramp = 2.2 * t.z;
  const reach = t.half * 9;
  const z = t.z;
  const s = t.spacing;
  const s2 = t.spacing2 ?? 0;
  // Second axis is the bar turned a right angle.
  const n2x = -t.ny;
  const n2y = t.nx;
  const span = s > 0 ? Math.max(1, Math.ceil(reach / s)) : 0;
  const span2 = s2 > 0 ? Math.max(1, Math.ceil(reach / s2)) : 0;

  const contrib = (qx: number, qy: number) => {
    const along = qx * mx + qy * my;
    const perp = Math.abs(qx * my - qy * mx);
    if (perp > reach) return 0;
    const frac = smooth((len - along) / ramp + 0.5) - smooth(-along / ramp + 0.5);
    if (frac === 0) return 0;
    return Math.exp(-perp * k) * frac;
  };

  // With the bar square to the stroke, every tine sees a point at the same
  // distance along, so points outside the moving band are skipped outright.
  const square = s === 0 || (s2 === 0 && Math.abs(t.nx * mx + t.ny * my) < 1e-3);

  const touches: Touches | undefined = square
    ? (x0, y0, x1, y1) => {
        const [lo, hi] = project(x0, y0, x1, y1, ax, ay, mx, my);
        if (hi < -ramp / 2 || lo > len + ramp / 2) return false;
        if (s > 0) return true;
        const [plo, phi] = project(x0, y0, x1, y1, ax, ay, my, -mx);
        return phi >= -reach && plo <= reach;
      }
    : undefined;

  const map: PlaneMap = (x, y, out) => {
    const rx = x - ax;
    const ry = y - ay;
    if (square) {
      const along = rx * mx + ry * my;
      if (along > len + ramp / 2 || along < -ramp / 2) {
        out[0] = x;
        out[1] = y;
        return;
      }
    }
    let total = 0;
    if (s === 0) {
      total = contrib(rx, ry);
    } else {
      const k0 = Math.round((rx * t.nx + ry * t.ny) / s);
      const j0 = s2 > 0 ? Math.round((rx * n2x + ry * n2y) / s2) : 0;
      for (let i = k0 - span; i <= k0 + span; i++) {
        const ox = i * s * t.nx;
        const oy = i * s * t.ny;
        if (s2 > 0) {
          for (let j = j0 - span2; j <= j0 + span2; j++) {
            total += contrib(rx - ox - j * s2 * n2x, ry - oy - j * s2 * n2y);
          }
        } else {
          total += contrib(rx - ox, ry - oy);
        }
      }
    }
    out[0] = x + mx * z * total;
    out[1] = y + my * z * total;
  };
  return { map, touches };
}

/** A regular polygon fine enough to read as a circle. */
export function circle(cx: number, cy: number, r: number): Float64Array {
  const n = Math.max(24, Math.min(360, Math.round((2 * Math.PI * r) / 2.2)));
  const pts = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts[i * 2] = cx + Math.cos(a) * r;
    pts[i * 2 + 1] = cy + Math.sin(a) * r;
  }
  return pts;
}

export class Trough {
  readonly w: number;
  readonly h: number;
  blots: Blot[] = [];
  /** Longest edge kept before it is split, and shortest before it is merged. */
  maxLen = 3;
  minLen = 1.1;
  /** How far past the walls paint is still tracked closely. */
  margin = 48;
  private buf = new Float64Array(1 << 16);
  private fa = new Float64Array(2);
  private fb = new Float64Array(2);
  private fm = new Float64Array(2);

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  get vertexCount(): number {
    let n = 0;
    for (const b of this.blots) n += b.pts.length / 2;
    return n;
  }

  clear(): void {
    this.blots = [];
  }

  /** Films are replaced, never edited in place, so a snapshot can share them. */
  snapshot(): Blot[] {
    return this.blots.map((b) => ({ ...b }));
  }

  restore(s: Blot[]): void {
    this.blots = s.map((b) => ({ ...b }));
  }

  /** Float a new drop: everything already there is pushed outward first. */
  drop(cx: number, cy: number, r: number, color: number): Blot {
    this.apply(dropMap(cx, cy, r * r));
    const pts = circle(cx, cy, r);
    const blot: Blot = { color, pts, box: boxOf(pts) };
    this.blots.push(blot);
    return blot;
  }

  /** Let a drop that is already floating spread from radius r0 to r1. */
  grow(blot: Blot, cx: number, cy: number, r0: number, r1: number): void {
    if (r1 <= r0) return;
    this.apply(dropMap(cx, cy, r1 * r1 - r0 * r0), blot);
    blot.pts = circle(cx, cy, r1);
    blot.box = boxOf(blot.pts);
  }

  stroke(t: Tines, ax: number, ay: number, bx: number, by: number): void {
    const f = tineMap(t, ax, ay, bx, by);
    if (f) this.apply(f.map, undefined, f.touches);
  }

  /** Run every film through a map, refining edges that stretch and culling paint pushed far off the tray. */
  apply(f: PlaneMap, skip?: Blot, touches?: Touches): void {
    const keep: Blot[] = [];
    for (const blot of this.blots) {
      const b = blot.box;
      if (blot !== skip && (!touches || touches(b[0], b[1], b[2], b[3]))) {
        const pts = this.remap(blot.pts, f);
        if (!pts) continue;
        blot.pts = pts;
        blot.box = this.lastBox;
      }
      keep.push(blot);
    }
    this.blots = keep;
  }

  private visible(x0: number, y0: number, x1: number, y1: number): boolean {
    const m = this.margin;
    if (x0 < -m && x1 < -m) return false;
    if (y0 < -m && y1 < -m) return false;
    if (x0 > this.w + m && x1 > this.w + m) return false;
    if (y0 > this.h + m && y1 > this.h + m) return false;
    return true;
  }

  private push(x: number, y: number): void {
    if (this.len + 2 > this.buf.length) {
      const next = new Float64Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = x;
    this.buf[this.len++] = y;
  }

  private len = 0;

  private split(f: PlaneMap, ax: number, ay: number, fax: number, fay: number, bx: number, by: number, fbx: number, fby: number, depth: number): void {
    const dx = fbx - fax;
    const dy = fby - fay;
    if (depth > 9 || dx * dx + dy * dy <= this.maxLen * this.maxLen || !this.visible(fax, fay, fbx, fby)) return;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    f(mx, my, this.fm);
    const fmx = this.fm[0];
    const fmy = this.fm[1];
    this.split(f, ax, ay, fax, fay, mx, my, fmx, fmy, depth + 1);
    this.push(fmx, fmy);
    this.split(f, mx, my, fmx, fmy, bx, by, fbx, fby, depth + 1);
  }

  private remap(pts: Float64Array, f: PlaneMap): Float64Array | null {
    const n = pts.length / 2;
    this.len = 0;
    f(pts[0], pts[1], this.fa);
    const f0x = this.fa[0];
    const f0y = this.fa[1];
    let fax = f0x;
    let fay = f0y;
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2];
      const ay = pts[i * 2 + 1];
      const last = i === n - 1;
      const bx = last ? pts[0] : pts[i * 2 + 2];
      const by = last ? pts[1] : pts[i * 2 + 3];
      let fbx: number;
      let fby: number;
      if (last) {
        fbx = f0x;
        fby = f0y;
      } else {
        f(bx, by, this.fb);
        fbx = this.fb[0];
        fby = this.fb[1];
      }
      this.push(fax, fay);
      this.split(f, ax, ay, fax, fay, bx, by, fbx, fby, 0);
      fax = fbx;
      fay = fby;
    }
    return this.thin();
  }

  private lastBox: [number, number, number, number] = [0, 0, 0, 0];

  /** Merge vertices that crowd together, and drop the film if it has left the tray for good. */
  private thin(): Float64Array | null {
    const src = this.buf;
    const total = this.len / 2;
    const m = this.margin;
    const min2 = this.minLen * this.minLen;
    const coarse2 = min2 * 400;
    let lx = src[0];
    let ly = src[1];
    let w = 2;
    let minX = lx;
    let maxX = lx;
    let minY = ly;
    let maxY = ly;
    for (let i = 1; i < total; i++) {
      const x = src[i * 2];
      const y = src[i * 2 + 1];
      const dx = x - lx;
      const dy = y - ly;
      const inside = x > -m && x < this.w + m && y > -m && y < this.h + m;
      if (dx * dx + dy * dy < (inside ? min2 : coarse2)) continue;
      src[w++] = x;
      src[w++] = y;
      lx = x;
      ly = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (w < 6) return null;
    // A film wholly outside the walls is gone for good.
    if (maxX < -m || minX > this.w + m || maxY < -m || minY > this.h + m) return null;
    this.lastBox = [minX, minY, maxX, maxY];
    return src.slice(0, w);
  }
}
