// The growth model. A plant is a tree of nodes, each with a birth age; the
// renderer shows every node born by the current age and works out thickness
// from what is alive. Oak and birch crowns grow by space colonization
// (Runions, Lane, and Prusinkiewicz 2007): attraction points fill the room the
// crown is allowed at each age, and each bud grows toward the points nearest
// it. The spruce follows a leader-and-whorl rule. Roots colonize the soil.

import { heightAt, type Species } from './_species';
import { makeRng, range, unit, type Rng } from './_rng';

const CAP = 70000;
const NEVER = 1e9;

export interface Plant {
  n: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  parent: Int32Array;
  birth: Float32Array;
  /** Age at which the node dies (turns to dead wood). */
  dead: Float32Array;
  /** Age at which the node is shed. */
  fall: Float32Array;
  order: Uint8Array;
  /** 0 stem, 1 root. */
  kind: Uint8Array;
  /** 1 on the main axis: the leader and trunk, or the taproot. */
  axis: Uint8Array;
  /** Path length from the root collar, for the bark pattern and sway. */
  dist: Float32Array;
  children: Uint16Array;
  /** Nodes that carry seed leaves. */
  cotyledons: number[];
}

function makePlant(): Plant {
  return {
    n: 0,
    x: new Float32Array(CAP),
    y: new Float32Array(CAP),
    z: new Float32Array(CAP),
    parent: new Int32Array(CAP),
    birth: new Float32Array(CAP),
    dead: new Float32Array(CAP).fill(NEVER),
    fall: new Float32Array(CAP).fill(NEVER),
    order: new Uint8Array(CAP),
    kind: new Uint8Array(CAP),
    axis: new Uint8Array(CAP),
    dist: new Float32Array(CAP),
    children: new Uint16Array(CAP),
    cotyledons: [],
  };
}

function addNode(
  p: Plant,
  parent: number,
  x: number,
  y: number,
  z: number,
  birth: number,
  kind: number,
  axis: number,
): number {
  if (p.n >= CAP) return -1;
  const i = p.n++;
  p.x[i] = x;
  p.y[i] = y;
  p.z[i] = z;
  p.parent[i] = parent;
  p.birth[i] = birth;
  p.kind[i] = kind;
  p.axis[i] = axis;
  if (parent >= 0) {
    const dx = x - p.x[parent];
    const dy = y - p.y[parent];
    const dz = z - p.z[parent];
    p.dist[i] = p.dist[parent] + Math.hypot(dx, dy, dz);
    p.order[i] = p.children[parent] > 0 && !axis ? p.order[parent] + 1 : p.order[parent];
    if (p.kind[parent] !== kind) p.order[i] = 0;
    p.children[parent]++;
  }
  return i;
}

/** A spatial hash for neighbour queries. */
class Grid {
  private cells = new Map<number, number[]>();
  constructor(private size: number) {}
  private key(cx: number, cy: number, cz: number): number {
    return ((cx + 512) * 1024 + (cy + 512)) * 1024 + (cz + 512);
  }
  reset(size: number): void {
    this.cells.clear();
    this.size = size;
  }
  add(i: number, x: number, y: number, z: number): void {
    const k = this.key(Math.floor(x / this.size), Math.floor(y / this.size), Math.floor(z / this.size));
    const c = this.cells.get(k);
    if (c) c.push(i);
    else this.cells.set(k, [i]);
  }
  /** Calls fn for every entry in the 27 cells around a point. */
  near(x: number, y: number, z: number, fn: (i: number) => void): void {
    const cx = Math.floor(x / this.size);
    const cy = Math.floor(y / this.size);
    const cz = Math.floor(z / this.size);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const cell = this.cells.get(this.key(cx + a, cy + b, cz + c));
          if (cell) for (const i of cell) fn(i);
        }
  }
}

/** Attraction points for one colonizing system (crown or roots). */
class Points {
  x: number[] = [];
  y: number[] = [];
  z: number[] = [];
  born: number[] = [];
  add(x: number, y: number, z: number, born: number): void {
    this.x.push(x);
    this.y.push(y);
    this.z.push(z);
    this.born.push(born);
  }
  /** Keeps the points the predicate accepts. */
  keep(fn: (i: number) => boolean): void {
    let w = 0;
    for (let i = 0; i < this.x.length; i++) {
      if (!fn(i)) continue;
      this.x[w] = this.x[i];
      this.y[w] = this.y[i];
      this.z[w] = this.z[i];
      this.born[w] = this.born[i];
      w++;
    }
    this.x.length = this.y.length = this.z.length = this.born.length = w;
  }
  get count(): number {
    return this.x.length;
  }
}

/** The room a colonizing system may fill at an age. */
interface Envelope {
  /** Bottom and top of the region (y). */
  y0: number;
  y1: number;
  /** Radius at a height, or 0 outside. */
  radius: (y: number) => number;
}

function crownEnvelope(sp: Species, age: number, shrink = 1): Envelope {
  const h = heightAt(sp, age);
  const base = h * sp.crownBase(age);
  const top = base + (h * 1.02 - base) * shrink;
  const w = h * sp.widthRatio(age) * shrink;
  return {
    y0: base,
    y1: top,
    radius: (y) => {
      if (y < base || y > top || top <= base) return 0;
      return w * sp.shape((y - base) / (top - base));
    },
  };
}

function rootEnvelope(sp: Species, age: number): Envelope {
  const h = heightAt(sp, age);
  const depth = Math.min(sp.rootDepth(age), 0.15 + h * 0.6);
  const w = Math.max(0.03, h * sp.widthRatio(age) * sp.rootSpread);
  return {
    y0: -depth,
    y1: -0.01,
    radius: (y) => {
      if (y > -0.01 || y < -depth) return 0;
      const d = -y / depth;
      return w * Math.pow(1 - d * d, 0.75) * (0.35 + 0.65 * Math.pow(1 - d, 0.6));
    },
  };
}

function envelopeVolume(e: Envelope): number {
  const slices = 16;
  const dy = (e.y1 - e.y0) / slices;
  let v = 0;
  for (let i = 0; i < slices; i++) {
    const r = e.radius(e.y0 + (i + 0.5) * dy);
    v += Math.PI * r * r * dy;
  }
  return Math.max(0, v);
}

function insideEnvelope(e: Envelope, x: number, y: number, z: number): boolean {
  const r = e.radius(y);
  return r > 0 && x * x + z * z <= r * r;
}

/** Segment length by plant height: fine for a seedling, coarse for a mature crown. */
const segment = (h: number, root: boolean): number =>
  Math.min(root ? 0.55 : 0.42, Math.max(root ? 0.008 : 0.006, (root ? 0.06 : 0.045) * Math.pow(Math.max(h, 0.01), 0.75)));

interface System {
  kind: 0 | 1;
  points: Points;
  /** Density carry, so fractional point counts accumulate. */
  carry: number;
  /** The forced axis tip (leader or taproot), or -1. */
  tip: number;
  started: boolean;
  lastEnv: Envelope | null;
}

export class Grower {
  readonly plant = makePlant();
  /** The model has grown up to this age. */
  age = 0;
  done = false;
  /** Death and shedding ages are filled in once the model reaches maxAge. */
  deathsReady = false;
  private rng: Rng;
  private stem: System;
  private root: System;
  private nodeGrid = new Grid(1);
  private pointGrid = new Grid(1);
  private grow: Float32Array = new Float32Array(CAP * 3);
  private growN: Uint16Array = new Uint16Array(CAP);
  /** Nodes born from old-age regrowth; retrenchment spares them. */
  private reiterated = new Uint8Array(CAP);
  /** Spruce state: laterals and their shoots. */
  private whorlState: WhorlState | null = null;

  constructor(
    readonly sp: Species,
    readonly seed: number,
  ) {
    this.rng = makeRng(seed);
    addNode(this.plant, -1, 0, 0, 0, 0, 0, 1);
    this.stem = { kind: 0, points: new Points(), carry: 0, tip: 0, started: false, lastEnv: null };
    this.root = { kind: 1, points: new Points(), carry: 0, tip: -1, started: false, lastEnv: null };
    if (sp.model === 'whorl') this.whorlState = { laterals: [], shoots: [], lastYear: 0, spin: 0 };
  }

  /** Runs the model for up to budget milliseconds. Returns true while there is more to do. */
  run(budget: number): boolean {
    const t0 = performance.now();
    while (!this.done && performance.now() - t0 < budget) this.step();
    return !this.done;
  }

  step(): void {
    const sp = this.sp;
    if (this.age >= sp.maxAge) {
      this.finish();
      return;
    }
    const a0 = this.age;
    const h0 = heightAt(sp, a0);
    // Pace steps so the fastest-growing part advances about one segment per step.
    const look = Math.max(0.05, Math.min(2, a0 * 0.1));
    const h1 = heightAt(sp, a0 + look);
    const w0 = h0 * sp.widthRatio(a0);
    const w1 = h1 * sp.widthRatio(a0 + look);
    const speed = Math.max((h1 - h0) / look, (w1 - w0) / look, 0.004);
    const d = segment(h0, false);
    let dt = (d / speed) * 0.9;
    if (a0 < 1) dt = Math.min(dt, 0.04);
    dt = Math.min(dt, a0 > sp.oldAge ? 4 : 1.5);
    const a = a0 + dt;
    this.age = a;

    if (sp.model === 'whorl') this.growWhorl(a);
    else this.growCrown(a);
    this.growRoots(a);
  }

  // Crown: leader plus colonization.

  private growCrown(a: number): void {
    const sp = this.sp;
    const p = this.plant;
    if (a < sp.emerge) return;
    const h = heightAt(sp, a);
    const d = segment(h, false);
    const sys = this.stem;

    // The leader keeps pace with the height curve while it rules.
    if (a < sp.leaderLoss && sys.tip >= 0) {
      this.pushLeader(sys, a, h, d, 0.12);
    } else if (sys.tip >= 0 && a >= sp.leaderLoss) {
      sys.tip = -1;
    }

    // Old age: a smaller, lower crown regrows inside the old one.
    let env = crownEnvelope(sp, a);
    let budAny = false;
    if (sp.reiterate && a > sp.oldAge) {
      env = crownEnvelope(sp, Math.min(a, 160), 0.72);
      budAny = true;
    }
    this.scatter(sys, env, a, d, budAny);
    this.colonize(sys, a, d, budAny, p);
  }

  private pushLeader(sys: System, a: number, h: number, d: number, wobble: number): void {
    const sp = this.sp;
    const p = this.plant;
    const rng = this.rng;
    let guard = 0;
    while (p.y[sys.tip] < h && guard++ < 40) {
      const t = sys.tip;
      const px = p.parent[t];
      let dx = 0;
      let dz = 0;
      if (px >= 0) {
        dx = (p.x[t] - p.x[px]) * 0.4;
        dz = (p.z[t] - p.z[px]) * 0.4;
      }
      const j = unit(rng);
      dx += j[0] * wobble;
      dz += j[2] * wobble;
      const dy = sp.apical;
      const len = Math.hypot(dx, dy, dz);
      const step = Math.min(d, h - p.y[t] + d * 0.25);
      const i = addNode(p, t, p.x[t] + (dx / len) * step, p.y[t] + (dy / len) * step, p.z[t] + (dz / len) * step, a, 0, 1);
      if (i < 0) break;
      sys.tip = i;
      this.markCotyledons(i);
    }
  }

  private markCotyledons(i: number): void {
    const p = this.plant;
    if (p.cotyledons.length === 0 && this.sp.cotyledons > 0 && p.kind[i] === 0 && p.y[i] > 0.008) {
      p.cotyledons.push(i);
    }
  }

  /** Adds attraction points to fill what the envelope gained since last step. */
  private scatter(sys: System, env: Envelope, a: number, d: number, fresh: boolean): void {
    const rng = this.rng;
    const prev = sys.lastEnv;
    const gained = Math.max(0, envelopeVolume(env) - (prev && !fresh ? envelopeVolume(prev) : 0));
    const spacing = d * (sys.kind === 1 ? 2.6 : fresh ? 3.4 : 2.3);
    sys.carry += gained / (spacing * spacing * spacing);
    if (fresh) sys.carry = Math.min(sys.carry, 12);
    let want = Math.min(4000, Math.floor(sys.carry));
    sys.carry -= want;
    let tries = 0;
    while (want > 0 && tries++ < want * 30) {
      const y = sys.kind === 1 ? env.y1 - (env.y1 - env.y0) * Math.pow(rng(), 1.7) : range(rng, env.y0, env.y1);
      const r = env.radius(y);
      if (r <= 0) continue;
      const rr = r * Math.sqrt(rng());
      const t = rng() * Math.PI * 2;
      const x = Math.cos(t) * rr;
      const z = Math.sin(t) * rr;
      if (prev && !fresh && insideEnvelope(prev, x, y, z)) continue;
      sys.points.add(x, y, z, a);
      want--;
    }
    sys.lastEnv = env;
  }

  private colonize(sys: System, a: number, d: number, budAny: boolean, p: Plant): void {
    const sp = this.sp;
    const pts = sys.points;
    if (pts.count === 0) return;
    const di = d * 6;
    const dk = d * 1.7;
    const budLife = sys.kind === 1 ? 4 : sp.budLife;

    // Grid of nodes that can still grow.
    this.nodeGrid.reset(di);
    for (let i = 0; i < p.n; i++) {
      if (p.kind[i] !== sys.kind) continue;
      if (i === sys.tip) continue;
      if (p.dead[i] < NEVER) continue;
      const young = a - p.birth[i] < budLife;
      const tip = p.children[i] === 0;
      if (!young && !tip && !(budAny && p.order[i] <= 3 && this.reiterated[i] === 0 && p.y[i] > 1)) continue;
      if (sys.kind === 0 && i === 0) continue;
      if (sys.kind === 1 && p.kind[i] === 1 && p.y[i] > -0.005) continue;
      this.nodeGrid.add(i, p.x[i], p.y[i], p.z[i]);
    }

    const grow = this.grow;
    const growN = this.growN;
    const touched: number[] = [];
    for (let k = 0; k < pts.count; k++) {
      const x = pts.x[k];
      const y = pts.y[k];
      const z = pts.z[k];
      let best = -1;
      let bestD = di * di;
      this.nodeGrid.near(x, y, z, (i) => {
        const dx = p.x[i] - x;
        const dy = p.y[i] - y;
        const dz = p.z[i] - z;
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < bestD) {
          bestD = dd;
          best = i;
        }
      });
      if (best < 0) continue;
      const len = Math.sqrt(bestD) || 1;
      if (growN[best] === 0) {
        touched.push(best);
        grow[best * 3] = grow[best * 3 + 1] = grow[best * 3 + 2] = 0;
      }
      grow[best * 3] += (x - p.x[best]) / len;
      grow[best * 3 + 1] += (y - p.y[best]) / len;
      grow[best * 3 + 2] += (z - p.z[best]) / len;
      growN[best]++;
    }

    const born: number[] = [];
    for (const i of touched) {
      let gx = grow[i * 3] / growN[i];
      let gy = grow[i * 3 + 1] / growN[i];
      let gz = grow[i * 3 + 2] / growN[i];
      growN[i] = 0;
      const gl = Math.hypot(gx, gy, gz) || 1;
      gx /= gl;
      gy /= gl;
      gz /= gl;
      // Keep going roughly the way the shoot already points.
      const par = p.parent[i];
      if (par >= 0 && p.children[i] === 0) {
        const px = p.x[i] - p.x[par];
        const py = p.y[i] - p.y[par];
        const pz = p.z[i] - p.z[par];
        const pl = Math.hypot(px, py, pz) || 1;
        gx += (px / pl) * 0.35;
        gy += (py / pl) * 0.35;
        gz += (pz / pl) * 0.35;
      }
      if (sys.kind === 0) {
        const order = p.children[i] > 0 ? p.order[i] + 1 : p.order[i];
        gy += order <= 1 ? sp.liftOrder1 : sp.liftHigher;
      } else {
        gy -= p.axis[i] ? 0.5 : 0.08;
      }
      const l = Math.hypot(gx, gy, gz) || 1;
      const nx = p.x[i] + (gx / l) * d;
      let ny = p.y[i] + (gy / l) * d;
      const nz = p.z[i] + (gz / l) * d;
      if (sys.kind === 0 && ny < 0.02) ny = 0.02;
      if (sys.kind === 1 && ny > -0.01) ny = -0.01;
      const j = addNode(p, i, nx, ny, nz, a, sys.kind, 0);
      if (j < 0) break;
      if (budAny) this.reiterated[j] = 1;
      born.push(j);
    }

    // Points reached by a new node are used up; stale ones expire.
    if (born.length) {
      this.pointGrid.reset(dk);
      for (const j of born) this.pointGrid.add(j, p.x[j], p.y[j], p.z[j]);
    }
    const dk2 = dk * dk;
    pts.keep((k) => {
      if (a - pts.born[k] > 25) return false;
      if (!born.length) return true;
      let hit = false;
      this.pointGrid.near(pts.x[k], pts.y[k], pts.z[k], (j) => {
        if (hit) return;
        const dx = p.x[j] - pts.x[k];
        const dy = p.y[j] - pts.y[k];
        const dz = p.z[j] - pts.z[k];
        if (dx * dx + dy * dy + dz * dz < dk2) hit = true;
      });
      return !hit;
    });
  }

  // Roots: a taproot early, then colonization of the soil.

  private growRoots(a: number): void {
    const sp = this.sp;
    const p = this.plant;
    const start = sp.emerge * 0.5;
    if (a < start) return;
    const sys = this.root;
    const h = Math.max(heightAt(sp, a), 0.02);
    const d = segment(h, true);
    if (!sys.started) {
      sys.started = true;
      sys.tip = addNode(p, 0, 0, -0.004, 0, a, 1, 1);
    }
    const env = rootEnvelope(sp, a);
    if (sys.tip >= 0) {
      if (a < sp.taprootUntil) {
        const target = env.y0 * (sp.taprootUntil > 5 ? 0.95 : 0.7);
        let guard = 0;
        while (p.y[sys.tip] > target && guard++ < 40) {
          const t = sys.tip;
          const j = unit(this.rng);
          const dx = j[0] * 0.15;
          const dz = j[2] * 0.15;
          const len = Math.hypot(dx, 1, dz);
          const i = addNode(p, t, p.x[t] + (dx / len) * d, p.y[t] - d / len, p.z[t] + (dz / len) * d, a, 1, 1);
          if (i < 0) break;
          sys.tip = i;
        }
      } else {
        sys.tip = -1;
      }
    }
    this.scatter(sys, env, a, d, false);
    this.colonize(sys, a, d, false, p);
  }

  // Spruce: one leader, a whorl of laterals a year, flat side shoots.

  private growWhorl(a: number): void {
    const sp = this.sp;
    const p = this.plant;
    const st = this.whorlState as WhorlState;
    const rng = this.rng;
    if (a < sp.emerge) return;
    const h = heightAt(sp, a);
    const d = segment(h, false);
    const sys = this.stem;
    if (sys.tip >= 0) this.pushLeader(sys, a, h, d, 0.05);

    // One growth unit a year while small, coarser as the tree gets big.
    const unitYears = h < 6 ? 1 : h < 14 ? 2 : 3;
    const year = Math.floor(a / unitYears) * unitYears;
    if (year <= st.lastYear || a < 1.5) return;
    const span = year - st.lastYear;
    st.lastYear = year;
    const dh = Math.max(0, heightAt(sp, a) - heightAt(sp, a - span));
    const slope = 0.32;

    // Grow last units' laterals, each by a share of the leader's gain.
    for (const lat of st.laterals) {
      if (p.dead[lat.tip] < NEVER) continue;
      const depth = h - lat.baseY;
      const target = Math.min(slope * depth, 0.2 * sp.hMax) * lat.vigor;
      const grow = Math.min(target - lat.length, dh * slope * 1.6 + 0.01);
      if (grow <= 0.004) continue;
      const age = a - lat.born;
      const pitch = lat.pitch - Math.min(0.5, age * 0.02);
      const dir: [number, number, number] = [
        Math.cos(lat.yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.sin(lat.yaw) * Math.cos(pitch),
      ];
      const t = lat.tip;
      const i = addNode(p, t, p.x[t] + dir[0] * grow, p.y[t] + dir[1] * grow, p.z[t] + dir[2] * grow, a, 0, 0);
      if (i < 0) return;
      lat.tip = i;
      lat.length += grow;
      // Side shoots, flat and to either side.
      for (const side of [-1, 1]) {
        if (rng() < 0.15) continue;
        const yaw = lat.yaw + side * range(rng, 0.8, 1.1);
        const sl = grow * range(rng, 0.55, 0.85);
        const sp2 = pitch - 0.15;
        const j = addNode(
          p,
          i,
          p.x[i] + Math.cos(yaw) * Math.cos(sp2) * sl,
          p.y[i] + Math.sin(sp2) * sl,
          p.z[i] + Math.sin(yaw) * Math.cos(sp2) * sl,
          a + 0.05,
          0,
          0,
        );
        if (j < 0) return;
        if (sl > 0.12) st.shoots.push({ tip: j, yaw, pitch: sp2, left: 1, length: sl });
      }
    }
    // Side shoots grow one more unit, then stop.
    const shoots = st.shoots;
    st.shoots = [];
    for (const s of shoots) {
      const t = s.tip;
      const sl = s.length * 0.6;
      const j = addNode(
        p,
        t,
        p.x[t] + Math.cos(s.yaw) * Math.cos(s.pitch) * sl,
        p.y[t] + Math.sin(s.pitch - 0.1) * sl,
        p.z[t] + Math.sin(s.yaw) * Math.cos(s.pitch) * sl,
        a + 0.1,
        0,
        0,
      );
      if (j < 0) return;
    }

    // A new whorl at the leader's tip.
    const top = sys.tip;
    if (top < 0) return;
    const count = 4 + (rng() < 0.45 ? 1 : 0) + (h > 8 && rng() < 0.3 ? 1 : 0);
    st.spin += 2.39996 + range(rng, -0.3, 0.3);
    for (let k = 0; k < count; k++) {
      const yaw = st.spin + (k / count) * Math.PI * 2 + range(rng, -0.25, 0.25);
      const pitch = range(rng, 0.25, 0.45);
      const l0 = Math.max(0.01, dh * 0.5);
      const i = addNode(
        p,
        top,
        p.x[top] + Math.cos(yaw) * Math.cos(pitch) * l0,
        p.y[top] + Math.sin(pitch) * l0,
        p.z[top] + Math.sin(yaw) * Math.cos(pitch) * l0,
        a,
        0,
        0,
      );
      if (i < 0) return;
      st.laterals.push({ tip: i, yaw, pitch, baseY: p.y[top], born: a, length: l0, vigor: range(rng, 0.8, 1.1) });
    }
  }

  // Deaths: crown lifting, old-age retrenchment, and shedding.

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.computeDeaths();
    this.deathsReady = true;
  }

  private computeDeaths(): void {
    const sp = this.sp;
    const p = this.plant;
    const rng = makeRng(this.seed ^ 0x5eed);
    const n = p.n;

    // Crown base by age, sampled, for "when did this junction fall below the crown".
    const ages: number[] = [];
    const bases: number[] = [];
    for (let a = 0; a <= sp.maxAge; a += 0.5) {
      ages.push(a);
      bases.push(heightAt(sp, a) * sp.crownBase(a));
    }
    const liftAge = (y: number): number => {
      let lo = 0;
      let hi = bases.length - 1;
      if (bases[hi] <= y) return NEVER;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (bases[m] > y) hi = m;
        else lo = m + 1;
      }
      return ages[lo];
    };

    // Each node's limb: the first node off the main axis on its path.
    const limb = new Int32Array(n).fill(-1);
    const junction = new Float32Array(n);
    let maxDist = 0;
    let maxY = 0;
    for (let i = 1; i < n; i++) {
      if (p.kind[i] !== 0) continue;
      const par = p.parent[i];
      if (p.axis[i]) continue;
      if (p.axis[par] || par === 0) {
        limb[i] = i;
        junction[i] = p.y[par];
      } else {
        limb[i] = limb[par];
        junction[i] = junction[par];
      }
      maxDist = Math.max(maxDist, p.dist[i]);
      maxY = Math.max(maxY, p.y[i]);
    }
    for (let i = 1; i < n; i++) if (p.kind[i] === 0) maxY = Math.max(maxY, p.y[i]);

    const limbJitter = new Float32Array(n);
    const limbDelay = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (limb[i] === i) {
        limbJitter[i] = range(rng, 0.65, 1.35);
        limbDelay[i] = range(rng, 0, 1);
      }
    }

    const span = sp.maxAge - sp.oldAge;
    for (let i = 1; i < n; i++) {
      if (p.kind[i] !== 0) continue;
      let dead = NEVER;
      let fall = NEVER;
      const l = limb[i];
      // Crown lifting sheds whole lower limbs.
      if (l >= 0) {
        const lift = liftAge(junction[i] + 0.05 * maxY);
        if (lift < NEVER) {
          dead = Math.max(p.birth[i] + 1, lift + limbDelay[l] * 4);
          fall = dead + 4 + limbDelay[l] * 10;
        }
      }
      // Old age dies back from the top and the tips.
      if (!this.reiterated[i]) {
        const s = (1 - sp.dieFromTop) * (p.dist[i] / (maxDist || 1)) + sp.dieFromTop * (p.y[i] / (maxY || 1));
        if (s > sp.keepCrown) {
          const jit = l >= 0 ? limbJitter[l] : 1;
          const f = Math.min(1, ((1 - s) / (1 - sp.keepCrown)) * jit);
          const d = sp.oldAge + Math.pow(f, 1.3) * span * 0.8;
          if (d < dead) {
            dead = d;
            const thin = p.order[i] >= 2 || p.children[i] === 0;
            fall = d + (thin ? range(rng, 3, 10) : range(rng, 25, 70));
          }
        }
      }
      p.dead[i] = dead;
      p.fall[i] = fall;
    }
    // A node can't outlive the wood that carries it.
    for (let i = 1; i < n; i++) {
      if (p.kind[i] !== 0) continue;
      const par = p.parent[i];
      if (par <= 0) continue;
      if (p.dead[par] < p.dead[i]) p.dead[i] = p.dead[par];
      if (p.fall[par] < p.fall[i]) p.fall[i] = p.fall[par];
    }
    // A dead birch's top snaps off; the trunk stands on as a snag.
    if (sp.keepCrown === 0) {
      for (let i = 1; i < n; i++) {
        if (p.kind[i] === 0 && p.axis[i] && p.y[i] > maxY * 0.55 && p.dead[i] < NEVER) {
          p.fall[i] = Math.min(p.fall[i], p.dead[i] + 8);
        }
      }
    }
  }
}

interface Lateral {
  tip: number;
  yaw: number;
  pitch: number;
  baseY: number;
  born: number;
  length: number;
  vigor: number;
}

interface Shoot {
  tip: number;
  yaw: number;
  pitch: number;
  left: number;
  length: number;
}

interface WhorlState {
  laterals: Lateral[];
  shoots: Shoot[];
  lastYear: number;
  spin: number;
}

export { NEVER };
