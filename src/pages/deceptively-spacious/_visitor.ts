// The visitor: a point on the surface with a frame of two tangent vectors. Walking moves the point along a geodesic
// and carries the frame with it; a door applies the side pairing to all three, which is why a mirrored door needs no
// special handling. The frame simply comes out left-handed, and everything is drawn from it.

import type { FigureView, View } from './_gl';
import {
  IDENTITY,
  SkInv,
  add,
  apply,
  dot,
  gdist,
  invert,
  mdot,
  mul,
  normalAt,
  polar,
  scale,
  walk,
  walkDir,
  type M3,
  type Room,
  type V3,
} from './_rooms';

const BODY = 0.26;
const EYE = 1.6;
const SPEED = 1.5;
const STRIDE = 1.25;

const RADIUS: Record<string, number> = { lamp: 0.28, chair: 0.56, table: 0.42 };

export interface Crumb {
  /** Where on the floor plan, in the fundamental room. */
  p: V3;
  /** On the upper floor. */
  above: boolean;
  /** Starts a new line, after a door. */
  jump: boolean;
  /** Where that is in the developed plan: the room tile it would really be in. */
  q: V3;
}

export class Visitor {
  p: V3 = [0, 0, 1];
  f: V3 = [0, 1, 0];
  r: V3 = [1, 0, 0];
  pitch = 0;
  above = false;
  cell = -1;
  stride = 0;
  swing = 0;
  /** Maps the current chart into the developed plan: the floor as if the walls had been rolled out flat. */
  developed: M3 = IDENTITY;
  crumbs: Crumb[] = [];
  /** Doors gone through since the room was entered. */
  crossings = 0;
  private lastCrumb: V3 = [0, 0, 1];
  room: Room;
  /** Called when a door is crossed. */
  onCross: (() => void) | null = null;

  constructor(room: Room) {
    this.room = room;
    this.place(room);
  }

  /** Stands the visitor a little way in from the door behind them, looking at the door ahead. */
  place(room: Room) {
    this.room = room;
    const k = room.kappa;
    const u = room.unit;
    // Face door 1 from the opposite side of the room, or door 0 where there is no door 1 facing north.
    const facing = room.theta[room.n === 6 ? 0 : 1]!;
    const start = polar(k, 1.5 / u, facing + Math.PI);
    this.p = start;
    // The tangent at the start pointing at the room's middle.
    const toward: V3 =
      k === 0
        ? [Math.cos(facing), Math.sin(facing), 0]
        : scale(add([0, 0, 1] as V3, scale(start, -mdot(k, [0, 0, 1], start) / mdot(k, start, start))), 1);
    this.f = normalise(k, toward);
    this.r = turnRight(k, this.p, this.f);
    this.pitch = -0.02;
    this.above = false;
    this.cell = -1;
    this.stride = 0;
    this.swing = 0;
    this.developed = IDENTITY;
    this.crumbs = [{ p: this.p, above: false, jump: true, q: this.p }];
    this.crossings = 0;
    this.lastCrumb = this.p;
  }

  turn(yaw: number, pitch: number) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const f = add(scale(this.f, c), scale(this.r, s));
    const r = add(scale(this.r, c), scale(this.f, -s));
    this.f = f;
    this.r = r;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + pitch));
  }

  /** Walks forward and sideways, in fractions of walking pace, for dt seconds. */
  move(forward: number, sideways: number, dt: number, pace = 1) {
    const amount = Math.hypot(forward, sideways);
    const target = amount > 0.01 ? 1 : 0;
    this.swing += (target - this.swing) * Math.min(1, dt * 7);
    if (amount < 0.01) return;
    const room = this.room;
    const k = room.kappa;
    let left = (SPEED * pace * Math.min(amount, 1) * dt) / room.unit;
    this.stride += (((left * room.unit) / STRIDE) * Math.PI * 2) / 2;
    const fx = forward / amount;
    const sx = sideways / amount;
    // Short steps, so a door is never stepped over.
    while (left > 1e-6) {
      const ds = Math.min(left, 0.03 / room.unit);
      left -= ds;
      let v = normalise(k, add(scale(this.f, fx), scale(this.r, sx)));
      v = this.constrain(v, ds);
      const len = Math.sqrt(Math.max(mdot(k, v, v), 0));
      if (len < 1e-4) break;
      this.advance(scale(v, 1 / len), ds * len);
    }
    if (gdist(k, this.lastCrumb, this.p) * room.unit > 0.04) this.crumb(false);
  }

  private crumb(jump: boolean) {
    const q = apply(this.developed, this.p);
    this.crumbs.push({ p: this.p, above: this.above, jump, q });
    this.lastCrumb = this.p;
  }

  /** Takes out the part of a step that would go through a wall or a piece of furniture. */
  private constrain(v0: V3, ds: number): V3 {
    const room = this.room;
    const k = room.kappa;
    let v = v0;
    const p = this.p;
    const margin = BODY / room.unit;
    const block = (n: V3) => {
      const inward = mdot(k, n, v);
      if (inward < 0) v = add(v, scale(n, -inward));
    };
    for (let pass = 0; pass < 3; pass++) {
      const q = walk(k, p, v, ds);
      if (this.cell < 0) {
        for (let i = 0; i < room.n; i++) {
          const gap = SkInv(k, dot(room.wall[i]!, q));
          if (gap > margin) continue;
          const a = SkInv(k, q[0] * room.along[i]![0] + q[1] * room.along[i]![1]);
          const opening = Math.abs(a) < room.doorW - (0.5 * BODY) / room.unit;
          if (!opening) block(unit(k, normalAt(k, room.wall[i]!, p)));
        }
      } else {
        const i = this.cell;
        for (const jamb of [room.jambA[i]!, room.jambB[i]!]) {
          if (SkInv(k, dot(jamb, q)) < (0.5 * BODY) / room.unit) block(unit(k, normalAt(k, jamb, p)));
        }
      }
      for (const prop of room.spec.props) {
        if (!!prop.above !== this.above) continue;
        const c = polar(k, prop.r / room.unit, prop.theta);
        const reach = (RADIUS[prop.kind]! + BODY) / room.unit;
        const d = gdist(k, q, c);
        if (d < reach) {
          const toward = k === 0 ? ([c[0] - p[0], c[1] - p[1], 0] as V3) : add(c, scale(p, -mdot(k, c, p) / mdot(k, p, p)));
          block(scale(unit(k, toward), -1));
        }
      }
    }
    return v;
  }

  private advance(v: V3, ds: number) {
    const room = this.room;
    const k = room.kappa;
    // Parallel transport along the step: the part of the frame along v turns with it, the rest stays put.
    const fa = mdot(k, this.f, v);
    const ra = mdot(k, this.r, v);
    const nv = walkDir(k, this.p, v, ds);
    const fRest = add(this.f, scale(v, -fa));
    const rRest = add(this.r, scale(v, -ra));
    const q = walk(k, this.p, v, ds);
    this.f = normalise(k, add(fRest, scale(nv, fa)));
    this.r = normalise(k, add(rRest, scale(nv, ra)));
    this.p = renorm(k, q);

    if (this.cell < 0) {
      for (let i = 0; i < room.n; i++) {
        if (dot(room.wall[i]!, this.p) < 0) {
          this.cell = i;
          break;
        }
      }
    } else {
      const i = this.cell;
      if (dot(room.wall[i]!, this.p) >= 0) {
        this.cell = -1;
      } else if (dot(room.outer[i]!, this.p) < 0) {
        const g = room.g[i]!;
        this.p = apply(g, this.p);
        this.f = apply(g, this.f);
        this.r = apply(g, this.r);
        if (room.flip[i]) this.above = !this.above;
        this.developed = mul(this.developed, invert(g));
        this.cell = room.pair[i]!;
        this.crossings++;
        this.crumb(true);
        this.onCross?.();
      }
    }
  }

  private frame(): FigureView {
    return { p: this.p, f: this.f, r: this.r, above: this.above };
  }

  view(): View {
    const room = this.room;
    const k = room.kappa;
    const eye = (EYE + Math.sin(this.stride * 2) * 0.012 * this.swing) / room.unit;
    // A figure in a doorway is cut by the door's far side; a second copy stands in the next room to finish it.
    let ghost: FigureView | null = null;
    for (let i = 0; i < room.n; i++) {
      if (SkInv(k, dot(room.outer[i]!, this.p)) * room.unit < 0.55) {
        const g = room.g[i]!;
        ghost = {
          p: apply(g, this.p),
          f: apply(g, this.f),
          r: apply(g, this.r),
          above: room.flip[i] ? !this.above : this.above,
        };
        break;
      }
    }
    return {
      p: this.p,
      f: this.f,
      r: this.r,
      eyeZ: this.above ? room.height - eye : eye,
      pitch: this.pitch,
      up: this.above ? -1 : 1,
      cell: this.cell,
      figure: this.frame(),
      ghost,
      stride: this.stride,
      swing: this.swing,
    };
  }
}

const unit = (k: Room['kappa'], v: V3): V3 => normalise(k, v);

function normalise(k: Room['kappa'], v: V3): V3 {
  const q = mdot(k, v, v);
  return q > 1e-12 ? scale(v, 1 / Math.sqrt(q)) : v;
}

/** Pulls a point back onto the surface against rounding. */
function renorm(k: Room['kappa'], p: V3): V3 {
  if (k === 0) return [p[0], p[1], 1];
  const q = Math.sqrt(Math.abs(mdot(k, p, p)));
  return scale(p, 1 / q);
}

/** The unit tangent a quarter turn clockwise of f. */
function turnRight(k: Room['kappa'], p: V3, f: V3): V3 {
  if (k === 0) return [f[1], -f[0], 0];
  // In the tangent plane, the cross product (with the metric's sign) turns f by a right angle.
  const c: V3 = k > 0 ? cross3(f, p) : [f[1] * p[2] - f[2] * p[1], f[2] * p[0] - f[0] * p[2], -(f[0] * p[1] - f[1] * p[0])];
  return normalise(k, c);
}

const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
