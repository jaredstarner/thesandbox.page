// The mobile in moving air. Every arm hangs from a free swivel, so it turns on its own: air
// pushes on the plates, a plate's push passes up through its hook to every arm above it, and
// each arm tilts until its weight hangs under the loop it hangs from.

import {
  type Arm,
  type Node,
  type Plate,
  type PlateGeom,
  LOOP_RISE,
  arcSlope,
  arcY,
  mass,
  massPoints,
  plateGeom,
} from './_model';

export type V3 = [number, number, number];

export const CEILING = 3.05;
const G = 9.81;
const RHO = 1.2; // air, kg/m^3
const CD = 1.15; // drag coefficient of a flat plate face-on
const TILT_ZETA = 0.11;
const MAX_TILT = 1.35;
const MAX_SPIN = 5;

export interface PlateState {
  plate: Plate;
  geom: PlateGeom;
  owner: ArmState;
  side: 0 | 1;
  /** Outline in the world, recomputed every step. */
  outline: V3[];
  C: V3;
  u: V3;
  w: V3;
  n: V3;
  /** Horizontal force on the plate this step (x, z). */
  fx: number;
  fz: number;
  /** External push (a finger, a neighbour) to apply on the next step. */
  px: number;
  pz: number;
}

export interface ArmState {
  arm: Arm;
  parent: ArmState | null;
  side: 0 | 1;
  depth: number;
  theta: number;
  omega: number;
  phi: number;
  phiDot: number;
  /** Rest angle relative to the parent: a twist in the hook it slowly returns to. */
  rest: number;
  // Cached from the structure.
  pts: { m: number; dx: number; dy: number }[];
  xh: number;
  yh: number;
  total: number;
  children: [ArmState | null, ArmState | null];
  plates: PlateState[];
  // World, recomputed every step.
  H: V3;
  d: V3;
  nh: V3;
  ends: [V3, V3];
  /** Horizontal force on everything hanging from this arm, passed up to its parent's end. */
  sfx: number;
  sfz: number;
  torque: number;
}

export interface Contact {
  a: PlateState;
  b: PlateState;
  speed: number;
}

export interface Env {
  /** Air velocity at a point, m/s. */
  wind: (p: V3, t: number) => V3;
  /** Extra damping while the visitor works on the mobile, 0 to 1. */
  steady: number;
  /** An arm to swing round broadside to the viewer, while it is being worked on. */
  face: ArmState | null;
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Mobile {
  root: ArmState;
  armsList: ArmState[] = [];
  platesList: PlateState[] = [];
  contacts: Contact[] = [];
  private touching = new Set<string>();
  t = 0;
  /** Reach and height, measured once when the mobile is put together. */
  reachCache: { radius: number; top: number; bottom: number } = { radius: 0.5, top: 2.7, bottom: 1.6 };

  constructor(
    top: Arm,
    prev?: Mobile,
    private anchor: V3 = [0, CEILING, 0],
  ) {
    const old = new Map<Arm, ArmState>();
    if (prev) for (const s of prev.armsList) old.set(s.arm, s);
    this.root = this.build(top, null, 0, 0, old);
    this.kinematics();
    this.reachCache = this.reach();
  }

  private build(arm: Arm, parent: ArmState | null, side: 0 | 1, depth: number, old: Map<Arm, ArmState>): ArmState {
    const was = old.get(arm);
    const xh = arm.hook * arm.len;
    const yh = arcY(arm, xh) + LOOP_RISE;
    const pts = massPoints(arm).map((p) => ({ m: p.m, dx: p.x - xh, dy: p.y - yh }));
    const s: ArmState = {
      arm,
      parent,
      side,
      depth,
      theta: was?.theta ?? (parent ? parent.theta + (side === 0 ? 0.9 : -1.3) + depth * 0.7 : 0.35),
      omega: was?.omega ?? 0,
      phi: was?.phi ?? 0,
      phiDot: was?.phiDot ?? 0,
      rest: 0,
      pts,
      xh,
      yh,
      total: mass(arm),
      children: [null, null],
      plates: [],
      H: [0, 0, 0],
      d: [1, 0, 0],
      nh: [0, 0, 1],
      ends: [
        [0, 0, 0],
        [0, 0, 0],
      ],
      sfx: 0,
      sfz: 0,
      torque: 0,
    };
    s.rest = was ? was.rest : parent ? wrap(s.theta - parent.theta) : s.theta;
    this.armsList.push(s);
    arm.ends.forEach((n: Node, i) => {
      const e = i as 0 | 1;
      if (n.kind === 'arm') s.children[e] = this.build(n, s, e, depth + 1, old);
      else {
        const ps: PlateState = {
          plate: n,
          geom: plateGeom(n),
          owner: s,
          side: e,
          outline: [],
          C: [0, 0, 0],
          u: [1, 0, 0],
          w: [0, 1, 0],
          n: [0, 0, 1],
          fx: 0,
          fz: 0,
          px: 0,
          pz: 0,
        };
        s.plates.push(ps);
        this.platesList.push(ps);
      }
    });
    return s;
  }

  /** Place every arm and plate in the world from the current angles, top down. */
  kinematics(): void {
    for (const s of this.armsList) {
      const a = s.arm;
      const top = s.parent ? s.parent.ends[s.side] : this.anchor;
      s.H = [top[0], top[1] - a.drop, top[2]];
      const c = Math.cos(s.theta);
      const sn = Math.sin(s.theta);
      s.d = [c, 0, sn];
      s.nh = [-sn, 0, c];
      const cp = Math.cos(s.phi);
      const sp = Math.sin(s.phi);
      const place = (dx: number, dy: number): V3 => {
        const X = dx * cp + dy * sp;
        const Y = -dx * sp + dy * cp;
        return [s.H[0] + X * c, s.H[1] + Y, s.H[2] + X * sn];
      };
      s.ends = [place(-s.xh, -s.yh), place(a.len - s.xh, -s.yh)];
      for (const p of s.plates) {
        const x = p.side === 0 ? 0 : a.len;
        const slope = arcSlope(a, x);
        let ux = p.side === 0 ? -1 : 1;
        let uy = p.side === 0 ? -slope : slope;
        const l = Math.hypot(ux, uy);
        ux /= l;
        uy /= l;
        let wx = -uy;
        let wy = ux;
        if (wy < 0) {
          wx = -wx;
          wy = -wy;
        }
        const tilt = (vx: number, vy: number): V3 => {
          const X = vx * cp + vy * sp;
          const Y = -vx * sp + vy * cp;
          return [X * c, Y, X * sn];
        };
        const u = tilt(ux, uy);
        const w0 = tilt(wx, wy);
        const r = (p.plate.roll * Math.PI) / 180;
        const w = add(scale(w0, Math.cos(r)), scale(s.nh, Math.sin(r)));
        const E = s.ends[p.side];
        p.u = u;
        p.w = w;
        p.n = unit(cross(u, w));
        p.outline = p.geom.outline.map(([pu, pv]) => add(E, add(scale(u, pu), scale(w, pv))));
        p.C = add(E, add(scale(u, p.geom.cu), scale(w, p.geom.cv)));
      }
    }
  }

  step(dt: number, env: Env): void {
    this.t += dt;
    const t = this.t;
    // Air on every plate.
    for (const p of this.platesList) {
      const s = p.owner;
      const rx = p.C[0] - s.H[0];
      const rz = p.C[2] - s.H[2];
      const v: V3 = [-rz * s.omega, 0, rx * s.omega];
      const wv = env.wind(p.C, t);
      const rel: V3 = [wv[0] - v[0], wv[1] - v[1], wv[2] - v[2]];
      const un = dot(rel, p.n);
      const f = 0.5 * RHO * CD * p.geom.area * Math.abs(un) * un;
      p.fx = f * p.n[0] + p.px;
      p.fz = f * p.n[2] + p.pz;
      p.px = 0;
      p.pz = 0;
    }
    this.collide();
    // Pass forces up the tree, bottom first (armsList is in pre-order, so walk it backwards).
    for (let i = this.armsList.length - 1; i >= 0; i--) {
      const s = this.armsList[i]!;
      let fx = 0;
      let fz = 0;
      let tq = 0;
      for (const p of s.plates) {
        fx += p.fx;
        fz += p.fz;
        tq += (p.C[0] - s.H[0]) * p.fz - (p.C[2] - s.H[2]) * p.fx;
      }
      for (const e of [0, 1] as const) {
        const ch = s.children[e];
        if (!ch) continue;
        fx += ch.sfx;
        fz += ch.sfz;
        tq += (s.ends[e][0] - s.H[0]) * ch.sfz - (s.ends[e][2] - s.H[2]) * ch.sfx;
      }
      s.sfx = fx;
      s.sfz = fz;
      s.torque = tq;
    }
    // Turn and tilt.
    for (const s of this.armsList) {
      const cp = Math.cos(s.phi);
      const sp = Math.sin(s.phi);
      let I = 1e-5;
      let It = 1e-5;
      let mX = 0;
      let depthSum = 0;
      for (const q of s.pts) {
        const X = q.dx * cp + q.dy * sp;
        I += q.m * X * X;
        It += q.m * (q.dx * q.dx + q.dy * q.dy);
        mX += q.m * X;
        depthSum -= q.m * q.dy;
      }
      for (const p of s.plates) I += p.geom.mass * (p.geom.radius * 0.4) ** 2;
      // Yaw: the swivel twists a little and rubs a little against the arm above.
      const pTheta = s.parent ? s.parent.theta : 0;
      const pOmega = s.parent ? s.parent.omega : 0;
      const kappa = I * (Math.PI * 2 / 70) ** 2;
      const mu = I * 0.02;
      let tq = s.torque + kappa * wrap(pTheta + s.rest - s.theta) + mu * (pOmega - s.omega);
      tq -= I * (0.012 + env.steady * 1.6) * s.omega;
      if (env.face === s) {
        const target = Math.abs(wrap(s.theta)) < Math.PI / 2 ? 0 : Math.PI;
        tq += I * 2.2 * wrap(target - s.theta) - I * 2.4 * s.omega;
      }
      s.omega += (tq / I) * dt;
      s.omega = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, s.omega));
      s.theta += s.omega * dt;
      // Tilt: weight hangs under the loop.
      const w0 = Math.sqrt((G * Math.max(depthSum, 1e-6)) / It);
      const acc = (G * mX) / It - 2 * TILT_ZETA * w0 * s.phiDot;
      s.phiDot += acc * dt;
      s.phi += s.phiDot * dt;
      if (s.phi > MAX_TILT) {
        s.phi = MAX_TILT;
        s.phiDot = Math.min(0, s.phiDot);
      } else if (s.phi < -MAX_TILT) {
        s.phi = -MAX_TILT;
        s.phiDot = Math.max(0, s.phiDot);
      }
    }
    this.kinematics();
  }

  /** The level the arm would settle at, given where its hook is now. */
  equilibriumTilt(s: ArmState): number {
    let mdx = 0;
    let depth = 0;
    for (const q of s.pts) {
      mdx += q.m * q.dx;
      depth -= q.m * q.dy;
    }
    return Math.atan2(mdx, depth);
  }

  /** Plates that meet push each other apart, as thin sheets: a sampled edge point inside a neighbour's face. */
  private collide(): void {
    this.contacts = [];
    const now = new Set<string>();
    const P = this.platesList;
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        const a = P[i]!;
        const b = P[j]!;
        if (a.owner === b.owner) continue;
        const dx = a.C[0] - b.C[0];
        const dy = a.C[1] - b.C[1];
        const dz = a.C[2] - b.C[2];
        const reach = a.geom.radius + b.geom.radius + 0.01;
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
        const hit = this.press(a, b) + this.press(b, a);
        if (hit > 0) {
          const key = i + ':' + j;
          now.add(key);
          if (!this.touching.has(key)) {
            const va = this.pointSpeed(a);
            const vb = this.pointSpeed(b);
            this.contacts.push({ a, b, speed: Math.hypot(va[0] - vb[0], va[1] - vb[1]) });
          }
        }
      }
    }
    this.touching = now;
  }

  private pointSpeed(p: PlateState): [number, number] {
    const s = p.owner;
    return [-(p.C[2] - s.H[2]) * s.omega, (p.C[0] - s.H[0]) * s.omega];
  }

  /** Push a's edge points out of b's face. Returns how many points pressed. */
  private press(a: PlateState, b: PlateState): number {
    const gap = 0.007;
    const out = b.geom.outline;
    const E = b.owner.ends[b.side];
    let count = 0;
    const stride = Math.max(1, Math.floor(a.outline.length / 14));
    for (let k = 0; k < a.outline.length; k += stride) {
      const q = a.outline[k]!;
      const r: V3 = [q[0] - E[0], q[1] - E[1], q[2] - E[2]];
      const h = dot(r, b.n);
      if (Math.abs(h) > gap) continue;
      const pu = dot(r, b.u);
      const pv = dot(r, b.w);
      if (!inside(out, pu, pv)) continue;
      count++;
      const depth = gap - Math.abs(h);
      const sign = h >= 0 ? 1 : -1;
      // A stiff spring with damping on the closing speed, so sheets meet and part rather than pass through.
      const va = this.pointSpeed(a);
      const vb = this.pointSpeed(b);
      const closing = (va[0] - vb[0]) * b.n[0] + (va[1] - vb[1]) * b.n[2];
      const push = Math.max(0, 22 * depth - 0.5 * closing * sign);
      const fx = b.n[0] * sign * push;
      const fz = b.n[2] * sign * push;
      a.fx += fx;
      a.fz += fz;
      b.fx -= fx;
      b.fz -= fz;
    }
    return count;
  }

  /** Horizontal extent the mobile can reach if every arm lines up, and its lowest point at rest. */
  reach(): { radius: number; top: number; bottom: number } {
    const walk = (s: ArmState): number => {
      let r = 0;
      for (const e of [0, 1] as const) {
        const arm = s.arm;
        const lever = e === 0 ? s.xh : arm.len - s.xh;
        const ch = s.children[e];
        const plate = s.plates.find((p) => p.side === e);
        const extra = ch ? walk(ch) : plate ? plate.plate.size : 0;
        r = Math.max(r, lever + extra);
      }
      return r;
    };
    let bottom = Infinity;
    let top = -Infinity;
    for (const s of this.armsList) {
      top = Math.max(top, s.H[1]);
      for (const e of s.ends) bottom = Math.min(bottom, e[1]);
    }
    for (const p of this.platesList) for (const q of p.outline) bottom = Math.min(bottom, q[1]);
    return { radius: walk(this.root), top, bottom };
  }
}

function inside(poly: [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
