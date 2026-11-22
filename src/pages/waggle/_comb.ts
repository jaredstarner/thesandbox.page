// The dance floor: a patch of comb just inside the entrance, a crowd of workers milling over it,
// and foragers dancing. Units are millimetres from the top-left corner; up the screen is up the comb.

import { makeBeeSprites, PHASE_COUNT, type BeeSprites } from './_bee';
import { between, gauss, mulberry32, type Rng } from './_rng';

export const PAINT = {
  white: '#f3efe2',
  red: '#d9343e',
  green: '#3a9a47',
  yellow: '#f3d23a',
  blue: '#2f66e0',
} as const;

/** How far along the comb a waggle run of this length travels. */
export function runLengthMm(ms: number): number {
  return 3 + (6.5 * ms) / 1000;
}

const WAGGLE_HZ = 13;

type Mode = 'walk' | 'rest' | 'follow' | 'dance' | 'leave' | 'enter' | 'player';

interface Bee {
  x: number;
  y: number;
  /** Canvas angle of the head, radians. */
  a: number;
  v: number;
  mode: Mode;
  timer: number;
  legT: number;
  turn: number;
  slot: number;
  dance: Dance | null;
}

export interface DanceSpec {
  /** Degrees clockwise from straight up. */
  angle: number;
  durationMs: number;
  /** Time to loop back after each run; quicker loops mean better flowers. */
  returnMs: number;
  paint: string;
  pollen: string | null;
  /** Standard deviation of each run's angle, degrees. */
  spread: number;
}

export interface Run {
  angle: number;
  ms: number;
}

export class Dance {
  readonly spec: DanceSpec;
  readonly bee: Bee;
  spot: [number, number];
  phase: 'waggle' | 'return' = 'return';
  t = 0;
  runAngle = 0;
  runMs = 0;
  side = 1;
  runs = 0;
  start: [number, number];
  end: [number, number];
  /** Recent run lines for the faint trace. */
  trace: { a: [number, number]; b: [number, number]; age: number }[] = [];
  private rng: Rng;

  constructor(spec: DanceSpec, bee: Bee, spot: [number, number], seed: number) {
    this.spec = spec;
    this.bee = bee;
    this.spot = spot;
    this.start = [...spot];
    this.end = [...spot];
    this.rng = mulberry32(seed);
    this.t = this.spec.returnMs * 0.6;
    this.beginReturnFrom(spot);
  }

  get waggling(): boolean {
    return this.phase === 'waggle';
  }

  /** Circuits per 15 seconds, the way the vigour of a dance is counted. */
  get tempo(): number {
    return 15000 / (this.spec.durationMs + this.spec.returnMs);
  }

  private beginReturnFrom(end: [number, number]): void {
    this.phase = 'return';
    this.end = end;
    this.side = -this.side;
  }

  private beginRun(): void {
    this.phase = 'waggle';
    this.t = 0;
    this.runs++;
    this.runAngle = this.spec.angle + gauss(this.rng) * this.spec.spread;
    this.runMs = Math.max(150, this.spec.durationMs * (1 + gauss(this.rng) * 0.06));
    const jitter = 0.8;
    this.start = [this.spot[0] + gauss(this.rng) * jitter, this.spot[1] + gauss(this.rng) * jitter];
  }

  update(dt: number): void {
    const b = this.bee;
    this.t += dt;
    for (const tr of this.trace) tr.age += dt;
    this.trace = this.trace.filter((tr) => tr.age < 9000);
    if (this.phase === 'waggle') {
      const r = (this.runAngle * Math.PI) / 180;
      const ux = Math.sin(r);
      const uy = -Math.cos(r);
      const len = runLengthMm(this.runMs);
      const k = Math.min(1, this.t / this.runMs);
      b.x = this.start[0] + ux * len * k;
      b.y = this.start[1] + uy * len * k;
      b.a = Math.atan2(uy, ux);
      if (this.t >= this.runMs) {
        const end: [number, number] = [b.x, b.y];
        this.trace.push({ a: this.start, b: end, age: 0 });
        this.t = 0;
        this.beginReturnFrom(end);
      }
    } else {
      const total = this.spec.returnMs;
      const k = Math.min(1, this.t / total);
      const [sx, sy] = this.spot;
      const [ex, ey] = this.end;
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2;
      let ux = ex - sx;
      let uy = ey - sy;
      const len = Math.hypot(ux, uy) || 1;
      ux /= len;
      uy /= len;
      const nx = -uy * this.side;
      const ny = ux * this.side;
      const bw = Math.max(5.5, len * 0.5);
      const phi = Math.PI * easeInOut(k);
      b.x = mx + ux * (len / 2) * Math.cos(phi) + nx * bw * Math.sin(phi);
      b.y = my + uy * (len / 2) * Math.cos(phi) + ny * bw * Math.sin(phi);
      const tx = -ux * (len / 2) * Math.sin(phi) + nx * bw * Math.cos(phi);
      const ty = -uy * (len / 2) * Math.sin(phi) + ny * bw * Math.cos(phi);
      const want = Math.atan2(ty, tx);
      b.a = k > 0.92 ? turnToward(b.a, Math.atan2(uy, ux), 0.25) : want;
      if (this.t >= total) this.beginRun();
    }
    b.legT += dt * (this.phase === 'waggle' ? 0.004 : 0.012);
  }

  /** Lateral offset and yaw of the waggle at this moment, in millimetres and radians. */
  wobble(): [number, number] {
    if (this.phase !== 'waggle') return [0, 0];
    const s = Math.sin((2 * Math.PI * WAGGLE_HZ * this.t) / 1000);
    return [s * 0.95, s * 0.22];
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function turnToward(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export interface Ghost {
  angle: number;
  ms: number;
}

export interface PlayerState {
  bee: Bee;
  phase: 'ready' | 'run' | 'return';
  t: number;
  pointer: [number, number] | null;
  heading: number;
  start: [number, number];
  end: [number, number];
  side: number;
  runs: Run[];
}

export class Comb {
  w = 0;
  h = 0;
  dpr = 1;
  /** CSS pixels per millimetre. */
  ppm = 3;
  W = 0;
  H = 0;
  bees: Bee[] = [];
  dances: Dance[] = [];
  player: PlayerState | null = null;
  selected = 0;
  private bg = document.createElement('canvas');
  private sprites: BeeSprites | null = null;
  private rng = mulberry32(42);
  private recruitClock = 0;
  private danceSeed = 1;

  resize(w: number, h: number, dpr: number): void {
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    const oldW = this.W;
    const oldH = this.H;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.ppm = Math.max(2.1, Math.min(3, Math.min(w, h) / 112));
    this.W = w / this.ppm;
    this.H = h / this.ppm;
    this.bg.width = Math.max(1, Math.round(w * dpr));
    this.bg.height = Math.max(1, Math.round(h * dpr));
    this.sprites = makeBeeSprites(this.ppm * dpr);
    this.renderComb();
    if (oldW > 0) {
      for (const b of this.bees) {
        b.x = (b.x / oldW) * this.W;
        b.y = (b.y / oldH) * this.H;
      }
      for (const d of this.dances) d.spot = [(d.spot[0] / oldW) * this.W, (d.spot[1] / oldH) * this.H];
    }
    this.populate();
  }

  /** Where the dances happen: one spot, or two side by side. */
  spots(n: number): [number, number][] {
    if (n === 1) return [[this.W * 0.5, this.H * 0.55]];
    return [
      [this.W * 0.31, this.H * 0.5],
      [this.W * 0.69, this.H * 0.6],
    ];
  }

  private populate(): void {
    const want = Math.round((this.W * this.H) / 330);
    while (this.bees.length < want) this.bees.push(this.spawn(this.rng() * this.W, this.rng() * this.H));
    if (this.bees.length > want) {
      this.bees = this.bees.filter((b, i) => i < want || b.mode === 'dance' || b.mode === 'player');
    }
  }

  private spawn(x: number, y: number): Bee {
    return {
      x,
      y,
      a: this.rng() * Math.PI * 2,
      v: between(this.rng, 1, 7),
      mode: this.rng() < 0.35 ? 'rest' : 'walk',
      timer: between(this.rng, 500, 5000),
      legT: this.rng() * 10,
      turn: 0,
      slot: 0,
      dance: null,
    };
  }

  /** Set the foragers dancing. Each spec gets a bee from the crowd. */
  setDances(specs: DanceSpec[]): void {
    this.clearDances();
    const spots = this.spots(specs.length);
    specs.forEach((spec, i) => {
      const spot = spots[i];
      const bee = this.spawn(spot[0], spot[1] + 6);
      bee.mode = 'dance';
      this.bees.push(bee);
      const d = new Dance(spec, bee, spot, this.danceSeed++ * 977);
      bee.dance = d;
      this.dances.push(d);
    });
    this.selected = 0;
  }

  clearDances(): void {
    for (const d of this.dances) {
      d.bee.mode = 'leave';
      d.bee.dance = null;
      d.bee.v = 9;
      d.bee.a = Math.atan2(this.H + 20 - d.bee.y, this.W / 2 - d.bee.x);
    }
    for (const b of this.bees) {
      if (b.mode === 'follow') {
        b.mode = 'walk';
        b.dance = null;
      }
    }
    this.dances = [];
  }

  startPlayer(): void {
    this.clearDances();
    this.endPlayer();
    const [sx, sy] = this.spots(1)[0];
    const bee = this.spawn(sx, sy);
    bee.mode = 'player';
    bee.a = -Math.PI / 2;
    this.bees.push(bee);
    this.player = {
      bee,
      phase: 'ready',
      t: 0,
      pointer: null,
      heading: 0,
      start: [sx, sy],
      end: [sx, sy],
      side: 1,
      runs: [],
    };
  }

  endPlayer(): void {
    if (!this.player) return;
    const b = this.player.bee;
    b.mode = 'leave';
    b.v = 9;
    b.a = Math.atan2(this.H + 20 - b.y, this.W / 2 - b.x);
    this.player = null;
  }

  press(x: number, y: number): void {
    const p = this.player;
    if (!p || p.phase !== 'ready') return;
    p.phase = 'run';
    p.t = 0;
    p.pointer = [x, y];
    p.start = [p.bee.x, p.bee.y];
    const dx = x - p.start[0];
    const dy = y - p.start[1];
    if (Math.hypot(dx, dy) > 4) p.heading = (Math.atan2(dx, -dy) * 180) / Math.PI;
  }

  move(x: number, y: number): void {
    const p = this.player;
    if (!p) return;
    p.pointer = [x, y];
  }

  release(): Run | null {
    const p = this.player;
    if (!p || p.phase !== 'run') return null;
    const ms = p.t;
    p.phase = 'return';
    p.end = [p.bee.x, p.bee.y];
    p.side = -p.side;
    p.t = 0;
    if (ms < 180) return null;
    const run = { angle: p.heading, ms };
    p.runs.push(run);
    return run;
  }

  get waggling(): boolean {
    if (this.player) return this.player.phase === 'run';
    return this.dances.some((d) => d.waggling);
  }

  update(dt: number): void {
    const rng = this.rng;
    for (const d of this.dances) d.update(dt);
    if (this.player) this.updatePlayer(dt);

    // Followers gather round each dancer.
    this.recruitClock += dt;
    if (this.recruitClock > 350) {
      this.recruitClock = 0;
      const targets = this.dances.map((d) => d.bee);
      if (this.player && this.player.runs.length + (this.player.phase === 'run' ? 1 : 0) > 0)
        targets.push(this.player.bee);
      for (const db of targets) {
        const followers = this.bees.filter((b) => b.mode === 'follow' && b.dance && b.dance.bee === db).length;
        const followersP = this.bees.filter((b) => b.mode === 'follow' && b.dance === null && b.slot >= 100).length;
        const count = db.mode === 'player' ? followersP : followers;
        if (count >= 6) continue;
        let best: Bee | null = null;
        let bd = 30;
        for (const b of this.bees) {
          if (b.mode !== 'walk' && b.mode !== 'rest') continue;
          const d = Math.hypot(b.x - db.x, b.y - db.y);
          if (d < bd && rng() < 0.6) {
            bd = d;
            best = b;
          }
        }
        if (best) {
          best.mode = 'follow';
          best.timer = between(rng, 4000, 11000);
          if (db.mode === 'player') {
            best.dance = null;
            best.slot = 100 + count;
          } else {
            best.dance = db.dance;
            best.slot = count;
          }
        }
      }
    }

    const margin = 5;
    for (const b of this.bees) {
      if (b.mode === 'dance' || b.mode === 'player') continue;
      b.timer -= dt;
      if (b.mode === 'follow') {
        const leader = b.dance ? b.dance.bee : this.player?.bee;
        if (!leader || b.timer <= 0) {
          b.mode = 'walk';
          b.dance = null;
          b.timer = between(rng, 1500, 4000);
          b.a += Math.PI * between(rng, 0.6, 1.4);
          continue;
        }
        const slot = b.slot % 100;
        const back = 8.8 + (slot % 2) * 2.2;
        const lat = ((slot % 3) - 1) * 5.2 + (slot >= 3 ? 1.5 : 0);
        const ca = Math.cos(leader.a);
        const sa = Math.sin(leader.a);
        const tx = leader.x - ca * back - sa * lat;
        const ty = leader.y - sa * back + ca * lat;
        const dx = tx - b.x;
        const dy = ty - b.y;
        const dist = Math.hypot(dx, dy);
        const step = Math.min(dist, (dt / 1000) * 34);
        if (dist > 0.01) {
          b.x += (dx / dist) * step;
          b.y += (dy / dist) * step;
        }
        b.a = turnToward(b.a, Math.atan2(leader.y - b.y, leader.x - b.x), 0.15);
        b.legT += dt * 0.012 * Math.min(1, step * 4);
        continue;
      }
      if (b.mode === 'leave') {
        b.x += Math.cos(b.a) * b.v * (dt / 1000);
        b.y += Math.sin(b.a) * b.v * (dt / 1000);
        b.legT += dt * 0.012;
        if (b.y > this.H + 8) {
          b.mode = 'enter';
          b.x = this.W / 2 + between(rng, -18, 18);
          b.y = this.H + 6;
          b.a = -Math.PI / 2 + between(rng, -0.5, 0.5);
          b.v = between(rng, 5, 9);
          b.timer = between(rng, 2500, 5000);
        }
        continue;
      }
      if (b.mode === 'rest') {
        b.legT += dt * 0.002;
        if (b.timer <= 0) {
          b.mode = 'walk';
          b.timer = between(rng, 1500, 7000);
          b.v = between(rng, 1.5, 8);
        }
      } else {
        if (b.timer <= 0) {
          if (b.mode === 'walk' && rng() < 0.4) {
            b.mode = 'rest';
            b.timer = between(rng, 800, 5000);
          } else {
            b.mode = 'walk';
            b.timer = between(rng, 1500, 7000);
            b.v = between(rng, 1.5, 8);
          }
          // Now and then a bee heads out of the hive.
          if (b.y > this.H * 0.75 && rng() < 0.18) {
            b.mode = 'leave';
            b.v = 8;
            b.a = Math.atan2(this.H + 20 - b.y, this.W / 2 + between(rng, -15, 15) - b.x);
            continue;
          }
        }
        b.turn += gauss(rng) * 0.0025 * dt;
        b.turn *= Math.pow(0.5, dt / 400);
        b.a += b.turn * (dt / 1000);
        // Keep to the comb.
        let want: number | null = null;
        if (b.x < margin) want = 0;
        else if (b.x > this.W - margin) want = Math.PI;
        if (b.y < margin) want = Math.PI / 2;
        else if (b.y > this.H - margin && b.mode !== 'enter') want = -Math.PI / 2;
        if (want !== null) b.a = turnToward(b.a, want, 0.08);
        if (b.mode === 'enter' && b.timer <= 0) b.mode = 'walk';
        const v = b.mode === 'enter' ? b.v : b.v;
        b.x += Math.cos(b.a) * v * (dt / 1000);
        b.y += Math.sin(b.a) * v * (dt / 1000);
        b.legT += dt * 0.0016 * v;
      }
    }

    // The crowd makes room round each dance; followers stay close.
    const rooms: [number, number][] = this.player ? [this.spots(1)[0]] : this.dances.map((d) => d.spot);
    for (const b of this.bees) {
      if (b.mode !== 'walk' && b.mode !== 'rest' && b.mode !== 'enter') continue;
      for (const [rx, ry] of rooms) {
        const dx = b.x - rx;
        const dy = b.y - ry;
        const d = Math.hypot(dx, dy);
        const room = 19;
        if (d < room && d > 0.01) {
          const push = ((room - d) / d) * Math.min(1, dt / 300) * 0.5;
          b.x += dx * push;
          b.y += dy * push;
        }
      }
    }

    // Keep bees from piling on one another; dancers and the player push, and are not pushed.
    const cell = 9;
    const grid = new Map<number, Bee[]>();
    const key = (x: number, y: number) => Math.floor(x / cell) * 1000 + Math.floor(y / cell);
    for (const b of this.bees) {
      const k = key(b.x, b.y);
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(b);
    }
    const r0 = 7.4;
    for (const b of this.bees) {
      const cx = Math.floor(b.x / cell);
      const cy = Math.floor(b.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const list = grid.get(gx * 1000 + gy);
          if (!list) continue;
          for (const o of list) {
            if (o === b) continue;
            const dx = b.x - o.x;
            const dy = b.y - o.y;
            const d2 = dx * dx + dy * dy;
            const pushy = o.mode === 'dance' || o.mode === 'player';
            const fixed = b.mode === 'dance' || b.mode === 'player';
            const rr = pushy ? 9.5 : r0;
            if (d2 > rr * rr || d2 < 1e-6 || fixed) continue;
            const d = Math.sqrt(d2);
            const push = ((rr - d) / d) * (pushy ? 0.5 : b.mode === 'follow' ? 0.08 : 0.22);
            b.x += dx * push;
            b.y += dy * push;
          }
        }
      }
    }
    this.bees = this.bees.filter((b) => b.mode !== 'leave' || b.y < this.H + 12);
    this.populate();
  }

  private updatePlayer(dt: number): void {
    const p = this.player!;
    const b = p.bee;
    p.t += dt;
    if (p.phase === 'run') {
      if (p.pointer) {
        const dx = p.pointer[0] - p.start[0];
        const dy = p.pointer[1] - p.start[1];
        if (Math.hypot(dx, dy) > 4) p.heading = (Math.atan2(dx, -dy) * 180) / Math.PI;
      }
      const r = (p.heading * Math.PI) / 180;
      const ux = Math.sin(r);
      const uy = -Math.cos(r);
      const len = runLengthMm(p.t) - 3;
      b.x = p.start[0] + ux * len;
      b.y = p.start[1] + uy * len;
      b.a = Math.atan2(uy, ux);
      b.legT += dt * 0.004;
      // Keep the run on the comb.
      if (b.x < 4 || b.x > this.W - 4 || b.y < 4 || b.y > this.H - 4) {
        b.x = Math.max(4, Math.min(this.W - 4, b.x));
        b.y = Math.max(4, Math.min(this.H - 4, b.y));
      }
    } else if (p.phase === 'return') {
      const total = 1300;
      const k = Math.min(1, p.t / total);
      const [sx, sy] = this.spots(1)[0];
      const [ex, ey] = p.end;
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2;
      let ux = ex - sx;
      let uy = ey - sy;
      const len = Math.hypot(ux, uy) || 1;
      ux /= len;
      uy /= len;
      const nx = -uy * p.side;
      const ny = ux * p.side;
      const bw = Math.max(5.5, len * 0.5);
      const phi = Math.PI * easeInOut(k);
      b.x = mx + ux * (len / 2) * Math.cos(phi) + nx * bw * Math.sin(phi);
      b.y = my + uy * (len / 2) * Math.cos(phi) + ny * bw * Math.sin(phi);
      const tx = -ux * (len / 2) * Math.sin(phi) + nx * bw * Math.cos(phi);
      const ty = -uy * (len / 2) * Math.sin(phi) + ny * bw * Math.cos(phi);
      if (len > 1) b.a = Math.atan2(ty, tx);
      b.legT += dt * 0.012;
      if (p.t >= total) {
        p.phase = 'ready';
        p.t = 0;
        b.x = sx;
        b.y = sy;
      }
    }
  }

  // ---------- drawing ----------

  private renderComb(): void {
    const g = this.bg.getContext('2d')!;
    const k = this.ppm * this.dpr;
    const rng = mulberry32(7);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#b0752e';
    g.fillRect(0, 0, this.bg.width, this.bg.height);
    g.setTransform(k, 0, 0, k, 0, 0);
    const F = 5.3;
    const R = F / Math.sqrt(3);
    const dy = F * (Math.sqrt(3) / 2);
    const wall = 0.42;
    const pollen = ['#e7b22a', '#d9862a', '#c9bf47', '#8e8a46', '#b4472c', '#e2cf6a', '#a86a2a', '#6f6ca5'];
    const cols = Math.ceil(this.W / F) + 2;
    const rows = Math.ceil(this.H / dy) + 2;
    for (let j = -1; j < rows; j++) {
      for (let i = -1; i < cols; i++) {
        const cx = i * F + (j % 2 ? F / 2 : 0);
        const cy = j * dy;
        const fy = cy / this.H + gauss(rng) * 0.025;
        const r = R - wall;
        hex(g, cx, cy, r);
        let kind: 'honey' | 'pollen' | 'brood' | 'nectar' | 'empty';
        const roll = rng();
        if (fy < 0.13) kind = roll < 0.9 ? 'honey' : 'nectar';
        else if (fy < 0.27) kind = roll < 0.78 ? 'pollen' : roll < 0.9 ? 'nectar' : 'empty';
        else if (fy < 0.45) kind = roll < 0.82 ? 'brood' : 'empty';
        else kind = roll < 0.06 ? 'nectar' : roll < 0.08 ? 'pollen' : 'empty';
        if (kind === 'honey') {
          const gr = g.createRadialGradient(cx - r * 0.25, cy - r * 0.3, 0, cx, cy, r);
          gr.addColorStop(0, '#fbefc8');
          gr.addColorStop(1, '#e2c27c');
          g.fillStyle = gr;
          g.fill();
        } else if (kind === 'brood') {
          const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
          gr.addColorStop(0, '#d9b072');
          gr.addColorStop(1, '#a8783c');
          g.fillStyle = gr;
          g.fill();
        } else if (kind === 'pollen') {
          g.fillStyle = pollen[Math.floor(rng() * pollen.length)];
          g.fill();
          g.fillStyle = 'rgba(60, 30, 0, 0.18)';
          for (let n = 0; n < 5; n++) {
            g.beginPath();
            g.arc(cx + gauss(rng) * r * 0.35, cy + gauss(rng) * r * 0.35, 0.28, 0, Math.PI * 2);
            g.fill();
          }
        } else {
          const gr = g.createRadialGradient(cx + r * 0.15, cy + r * 0.2, 0, cx, cy, r);
          const old = Math.min(1, Math.max(0, (fy - 0.4) * 1.6));
          gr.addColorStop(0, `rgb(${34 - old * 10}, ${20 - old * 6}, ${8 - old * 3})`);
          gr.addColorStop(0.75, `rgb(${70 - old * 20}, ${42 - old * 12}, ${16 - old * 5})`);
          gr.addColorStop(1, `rgb(${120 - old * 30}, ${74 - old * 18}, ${30 - old * 8})`);
          g.fillStyle = gr;
          g.fill();
          if (kind === 'nectar') {
            g.fillStyle = 'rgba(214, 140, 40, 0.75)';
            hex(g, cx, cy + r * 0.12, r * 0.78);
            g.fill();
            g.fillStyle = 'rgba(255, 236, 180, 0.8)';
            g.beginPath();
            g.ellipse(cx - r * 0.25, cy - r * 0.15, r * 0.22, r * 0.12, -0.5, 0, Math.PI * 2);
            g.fill();
          } else {
            g.fillStyle = 'rgba(255, 220, 160, 0.10)';
            g.beginPath();
            g.arc(cx - r * 0.35, cy - r * 0.35, r * 0.45, 0, Math.PI * 2);
            g.fill();
          }
        }
        // Wax lip, catching the light along the top.
        hex(g, cx, cy, r);
        g.strokeStyle = `rgba(255, 214, 140, ${0.18 + rng() * 0.12})`;
        g.lineWidth = 0.22;
        g.stroke();
      }
    }

    // Light: dim inside, warm daylight from the entrance at the foot of the comb.
    g.setTransform(1, 0, 0, 1, 0, 0);
    const W = this.bg.width;
    const H = this.bg.height;
    const shade = g.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, 'rgba(20, 10, 2, 0.5)');
    shade.addColorStop(0.55, 'rgba(20, 10, 2, 0.18)');
    shade.addColorStop(1, 'rgba(20, 10, 2, 0.05)');
    g.fillStyle = shade;
    g.fillRect(0, 0, W, H);
    const vign = g.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.75);
    vign.addColorStop(0, 'rgba(0,0,0,0)');
    vign.addColorStop(1, 'rgba(12, 6, 0, 0.55)');
    g.fillStyle = vign;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const glow = g.createRadialGradient(W / 2, H + 10 * k, 0, W / 2, H + 10 * k, Math.max(W, H) * 0.55);
    glow.addColorStop(0, 'rgba(255, 200, 110, 0.45)');
    glow.addColorStop(0.4, 'rgba(255, 170, 70, 0.12)');
    glow.addColorStop(1, 'rgba(255, 170, 70, 0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    // The entrance: a bright slot in the wooden floor of the hive.
    const barH = 5 * k;
    g.fillStyle = '#4a2d14';
    g.fillRect(0, H - barH, W, barH);
    g.fillStyle = 'rgba(255, 220, 160, 0.25)';
    g.fillRect(0, H - barH, W, Math.max(1, 0.4 * k));
    const gap = Math.min(W * 0.4, 70 * k);
    const slot = g.createLinearGradient(0, H - barH, 0, H);
    slot.addColorStop(0, '#fff2c9');
    slot.addColorStop(1, '#f7c665');
    g.fillStyle = slot;
    g.fillRect(W / 2 - gap / 2, H - barH * 0.8, gap, barH * 0.8);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    opts: { ghost: Ghost | null; showUp: boolean; trace: boolean; time: number },
  ): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    const k = this.ppm * this.dpr;
    const sp = this.sprites;
    if (!sp) return;

    // The observation lamp: a warm pool of light where the dancing is.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const pools: [number, number, number][] = this.player
      ? [[...this.spots(1)[0], 0.3]]
      : this.dances.map((d, i) => [d.spot[0], d.spot[1], i === this.selected ? 0.3 : 0.2] as [number, number, number]);
    for (const [px, py, a] of pools) {
      const cx = px * k;
      const cy = py * k;
      const rad = 46 * k;
      const gl = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      gl.addColorStop(0, `rgba(255, 196, 110, ${a})`);
      gl.addColorStop(0.6, `rgba(255, 170, 80, ${a * 0.35})`);
      gl.addColorStop(1, 'rgba(255, 170, 80, 0)');
      ctx.fillStyle = gl;
      ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    ctx.globalCompositeOperation = 'source-over';

    // Faint trace of the last few waggle runs.
    if (opts.trace) {
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.lineCap = 'round';
      this.dances.forEach((d, i) => {
        for (const tr of d.trace) {
          const alpha = Math.max(0, 1 - tr.age / 9000) * (i === this.selected || this.dances.length === 1 ? 0.75 : 0.4);
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = d.spec.paint;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(tr.a[0], tr.a[1]);
          ctx.lineTo(tr.b[0], tr.b[1]);
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
    }

    const order: Bee[] = [];
    for (const b of this.bees) if (b.mode !== 'follow' && b.mode !== 'dance' && b.mode !== 'player') order.push(b);
    for (const b of this.bees) if (b.mode === 'follow') order.push(b);
    for (const d of this.dances) order.push(d.bee);
    if (this.player) order.push(this.player.bee);

    // A faint ring in each dancer's paint colour, so she can be followed through the crowd.
    for (const d of this.dances) {
      const sel = this.dances.length === 1 || d === this.dances[this.selected];
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.beginPath();
      ctx.arc(d.bee.x, d.bee.y, 9.5, 0, Math.PI * 2);
      ctx.globalAlpha = sel ? 0.8 : 0.5;
      ctx.strokeStyle = d.spec.paint;
      ctx.lineWidth = 0.6;
      ctx.setLineDash([1.6, 1.4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (this.player) {
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.beginPath();
      ctx.arc(this.player.bee.x, this.player.bee.y, 9.5, 0, Math.PI * 2);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = PAINT.blue;
      ctx.lineWidth = 0.6;
      ctx.setLineDash([1.6, 1.4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    for (const b of order) {
      const dance = b.dance && b.mode === 'dance' ? b.dance : null;
      const playerRun = b.mode === 'player' && this.player?.phase === 'run';
      let wob: [number, number] = [0, 0];
      let waggling = false;
      if (dance) {
        wob = dance.wobble();
        waggling = dance.waggling;
      } else if (playerRun) {
        const s = Math.sin((2 * Math.PI * WAGGLE_HZ * (this.player?.t ?? 0)) / 1000);
        wob = [s * 0.95, s * 0.22];
        waggling = true;
      }
      const phase = Math.floor((((b.legT % 1) + 1) % 1) * PHASE_COUNT) % PHASE_COUNT;
      const img = waggling ? sp.buzzing[phase] : sp.folded[phase];
      const stamp = (lat: number, yaw: number, alpha: number) => {
        const a = b.a + yaw;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const x = (b.x - Math.sin(b.a) * lat) * k;
        const y = (b.y + Math.cos(b.a) * lat) * k;
        ctx.setTransform(ca, sa, -sa, ca, x, y);
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, -sp.half[0] * sp.scale, -sp.half[1] * sp.scale);
      };
      if (waggling && opts.time >= 0) {
        // Too fast to see at full speed: blur it across the swing.
        const fast = !this.slow;
        if (fast) {
          stamp(-0.95, -0.2, 0.5);
          stamp(0.95, 0.2, 0.5);
          stamp(0, 0, 0.45);
        } else stamp(wob[0], wob[1], 1);
      } else stamp(0, 0, 1);
      ctx.globalAlpha = 1;

      // Paint dot and pollen loads on dancers.
      const paint = dance?.spec.paint ?? (b.mode === 'player' ? PAINT.blue : null);
      const pollen = dance?.spec.pollen ?? null;
      if (paint || pollen) {
        const a = b.a + (waggling && this.slow ? wob[1] : 0);
        const lat = waggling && this.slow ? wob[0] : 0;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const x = (b.x - Math.sin(b.a) * lat) * k;
        const y = (b.y + Math.cos(b.a) * lat) * k;
        ctx.setTransform(ca * k, sa * k, -sa * k, ca * k, x, y);
        if (pollen) {
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(-0.9, side * 3.3, 1.15, 0.85, 0, 0, Math.PI * 2);
            ctx.fillStyle = pollen;
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.beginPath();
            ctx.ellipse(-1.1, side * 3.1, 0.45, 0.3, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (paint) {
          ctx.beginPath();
          ctx.arc(1.4, 0, 1.35, 0, Math.PI * 2);
          ctx.fillStyle = paint;
          ctx.fill();
          ctx.lineWidth = 0.28;
          ctx.strokeStyle = 'rgba(20, 10, 0, 0.6)';
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(1.0, -0.45, 0.42, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.fill();
        }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Reading aids: straight up stands for the sun, and the run the mark would be danced as.
    const target = this.player ? this.spots(1)[0] : this.dances[this.selected]?.spot;
    if (!target) return;
    const css = this.dpr;
    ctx.setTransform(css, 0, 0, css, 0, 0);
    const sx = target[0] * this.ppm;
    const sy = target[1] * this.ppm;
    if (opts.showUp) {
      const top = Math.max(26, sy - 52 * this.ppm);
      ctx.save();
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(255, 226, 150, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, top + 14);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(sx, top, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#f2b23a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 236, 190, 0.9)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a) * 10.5, top + Math.sin(a) * 10.5);
        ctx.lineTo(sx + Math.cos(a) * 14, top + Math.sin(a) * 14);
        ctx.stroke();
      }
    }
    if (opts.ghost) {
      const r = (opts.ghost.angle * Math.PI) / 180;
      const len = runLengthMm(opts.ghost.ms) * this.ppm;
      const ex = sx + Math.sin(r) * len;
      const ey = sy - Math.cos(r) * len;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(70, 120, 240, 0.95)';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      const ah = 9;
      ctx.beginPath();
      ctx.moveTo(ex + Math.sin(r) * 3, ey - Math.cos(r) * 3);
      ctx.lineTo(ex - Math.sin(r - 0.5) * ah, ey + Math.cos(r - 0.5) * ah);
      ctx.lineTo(ex - Math.sin(r + 0.5) * ah, ey + Math.cos(r + 0.5) * ah);
      ctx.closePath();
      ctx.fillStyle = 'rgba(70, 120, 240, 0.95)';
      ctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  slow = false;

  /** Canvas CSS pixels to comb millimetres. */
  toMm(px: number, py: number): [number, number] {
    return [px / this.ppm, py / this.ppm];
  }

  /** The dancer nearest a point, if one is close. */
  dancerAt(x: number, y: number): number {
    let best = -1;
    let bd = 22;
    this.dances.forEach((d, i) => {
      const dist = Math.hypot(d.bee.x - x, d.bee.y - y);
      if (dist < bd) {
        bd = dist;
        best = i;
      }
    });
    return best;
  }
}

function hex(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}
