// What flies on a July night, and how each kind behaves when a bat comes calling.
// Midges dance in swarms over the pond and in the lee of trees. Caddisflies keep
// to the water. Crane flies blunder about low and slow. Large yellow underwings
// are fast, and they can hear: a distant call turns them away, a loud close one
// sends them diving for the grass. Garden tigers answer an attack with clicks,
// an honest warning, because they taste foul. Moths circling the lamp are
// dazzled and slow to dodge.

import { CELL, GW, MAT_EMPTY, WORLD_H, WORLD_W, insideBarn, pondK, sampleField, type World } from './_world';
import { wrap } from './_sonar';

export type Species = 'midge' | 'caddis' | 'crane' | 'underwing' | 'tiger';

export interface SpeciesInfo {
  name: string;
  /** Echo strength of the body. */
  size: number;
  /** Cruising speed, metres per second. */
  speed: number;
  /** Wingbeats a second; sets how its echo flickers. */
  wingbeat: number;
  ears: boolean;
  foul: boolean;
}

export const SPECIES: Record<Species, SpeciesInfo> = {
  midge: { name: 'Midges and gnats', size: 0.17, speed: 0.7, wingbeat: 420, ears: false, foul: false },
  caddis: { name: 'Caddisflies', size: 0.3, speed: 1.3, wingbeat: 32, ears: false, foul: false },
  crane: { name: 'Crane flies', size: 0.42, speed: 0.9, wingbeat: 48, ears: false, foul: false },
  underwing: { name: 'Large yellow underwings', size: 0.62, speed: 3.6, wingbeat: 38, ears: true, foul: false },
  tiger: { name: 'Garden tigers', size: 0.55, speed: 2.4, wingbeat: 34, ears: true, foul: true },
};

export const ORDER: Species[] = ['midge', 'caddis', 'crane', 'underwing', 'tiger'];

export type Mode = 'fly' | 'swarm' | 'orbit' | 'flee' | 'dive' | 'down';

export interface Insect {
  id: number;
  sp: Species;
  x: number;
  y: number;
  heading: number;
  speed: number;
  mode: Mode;
  /** Time left in the current mode, bat seconds. */
  modeT: number;
  ax: number;
  ay: number;
  vx: number;
  vy: number;
  /** Orbit radius and direction round the lamp. */
  orbitR: number;
  orbitDir: number;
  phase: number;
  /** Bat time until which a tiger is clicking. */
  clickUntil: number;
  /** Heading wander. */
  wander: number;
}

let nextId = 1;

function bell(f: number, mu: number, sigma: number): number {
  const z = (f - mu) / sigma;
  return Math.exp(-0.5 * z * z);
}

/** How many of each kind are about, by fraction of the night (0 at dusk, 1 at first light). */
export function population(f: number): Record<Species, number> {
  return {
    midge: Math.round(70 + 170 * bell(f, 0.06, 0.13) + 90 * bell(f, 0.97, 0.07)),
    caddis: Math.round(4 + 9 * bell(f, 0.22, 0.22)),
    crane: Math.round(6 + 4 * bell(f, 0.3, 0.3)),
    underwing: Math.round(5 + 12 * bell(f, 0.45, 0.26)),
    tiger: Math.round(2 + 5 * bell(f, 0.5, 0.24)),
  };
}

function openAt(w: World, x: number, y: number, clearance: number): boolean {
  if (x < 1 || y < 1 || x > WORLD_W - 1 || y > WORLD_H - 1) return false;
  if (insideBarn(w, x, y)) return false;
  if (sampleField(w.leafSd, x, y) < clearance) return false;
  const ci = Math.floor(y / CELL) * GW + Math.floor(x / CELL);
  return w.mat[ci] === MAT_EMPTY;
}

export class Swarm {
  insects: Insect[] = [];
  private rand: () => number;
  constructor(
    private world: World,
    seed: number,
  ) {
    let a = seed >>> 0;
    this.rand = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private spawnPoint(sp: Species, bx: number, by: number): { x: number; y: number; ax: number; ay: number } | null {
    const w = this.world;
    for (let tries = 0; tries < 40; tries++) {
      let x: number;
      let y: number;
      let ax = 0;
      let ay = 0;
      if (sp === 'midge') {
        const s = w.swarms[Math.floor(this.rand() * w.swarms.length)];
        ax = s.x + (this.rand() - 0.5) * 2;
        ay = s.y + (this.rand() - 0.5) * 2;
        x = ax + (this.rand() - 0.5) * 2.4;
        y = ay + (this.rand() - 0.5) * 2.4;
      } else if (sp === 'caddis') {
        const a = this.rand() * Math.PI * 2;
        const k = 0.3 + this.rand() * 0.9;
        x = w.pond.cx + Math.cos(a) * w.pond.rx * k;
        y = w.pond.cy + Math.sin(a) * w.pond.ry * k;
      } else {
        x = 2 + this.rand() * (WORLD_W - 4);
        y = 10 + this.rand() * (WORLD_H - 13);
      }
      // Keep new arrivals out of the bat's immediate hearing where possible.
      const far = Math.hypot(x - bx, y - by) > (sp === 'midge' || sp === 'caddis' ? 4 : 9);
      if (far && openAt(w, x, y, 0.3)) return { x, y, ax, ay };
    }
    return null;
  }

  private make(sp: Species, x: number, y: number, ax: number, ay: number): Insect {
    const info = SPECIES[sp];
    return {
      id: nextId++,
      sp,
      x,
      y,
      heading: this.rand() * Math.PI * 2,
      speed: info.speed * (0.8 + this.rand() * 0.4),
      mode: sp === 'midge' ? 'swarm' : 'fly',
      modeT: 0,
      ax,
      ay,
      vx: 0,
      vy: 0,
      orbitR: 0.7 + this.rand() * 2.4,
      orbitDir: this.rand() < 0.5 ? -1 : 1,
      phase: this.rand() * 1000,
      clickUntil: -1,
      wander: 0,
    };
  }

  /** Keeps numbers near the target for this time of night, spawning and retiring out of earshot. */
  populate(f: number, bx: number, by: number, fill = false): void {
    const want = population(f);
    const have: Record<Species, number> = { midge: 0, caddis: 0, crane: 0, underwing: 0, tiger: 0 };
    for (const i of this.insects) have[i.sp]++;
    for (const sp of Object.keys(want) as Species[]) {
      let need = want[sp] - have[sp];
      let budget = fill ? need : Math.min(need, sp === 'midge' ? 6 : 1);
      while (need > 0 && budget > 0) {
        const p = this.spawnPoint(sp, bx, by);
        if (!p) break;
        this.insects.push(this.make(sp, p.x, p.y, p.ax, p.ay));
        need--;
        budget--;
      }
      if (need < 0) {
        // Retire the furthest ones.
        const list = this.insects
          .filter((i) => i.sp === sp)
          .sort((a, b) => Math.hypot(b.x - bx, b.y - by) - Math.hypot(a.x - bx, a.y - by));
        for (let k = 0; k < Math.min(-need, 3); k++) {
          const victim = list[k];
          if (victim && Math.hypot(victim.x - bx, victim.y - by) > 12) {
            this.insects.splice(this.insects.indexOf(victim), 1);
          }
        }
      }
    }
  }

  glint(i: Insect, t: number): number {
    const s = Math.abs(Math.sin(Math.PI * SPECIES[i.sp].wingbeat * t + i.phase));
    return s * s * s;
  }

  catchable(i: Insect): boolean {
    return i.mode !== 'dive' && i.mode !== 'down';
  }

  /**
   * A call reaches every eared insect. `loud` is the call's level (1 in search,
   * falling through the approach); `attacking` marks the approach and buzz.
   * Returns the tigers that start clicking.
   */
  hear(bx: number, by: number, heading: number, loud: number, attacking: boolean, t: number): Insect[] {
    const clicking: Insect[] = [];
    const lamp = this.world.lamp;
    for (const i of this.insects) {
      if (!SPECIES[i.sp].ears || i.mode === 'dive' || i.mode === 'down') continue;
      const dx = i.x - bx;
      const dy = i.y - by;
      const d = Math.hypot(dx, dy);
      if (d > 18) continue;
      const off = Math.abs(wrap(Math.atan2(dy, dx) - heading));
      const beam = off < 1.3 ? 1 : 0.35;
      // Under the lamp a moth is dazzled and hears far less.
      const dazzle = Math.hypot(i.x - lamp.x, i.y - lamp.y) < lamp.r * 0.75 ? 0.3 : 1;
      const level = ((loud * beam) / Math.max(0.25, d * d)) * dazzle;
      if (i.sp === 'tiger') {
        if (attacking && d < 2.6 && off < 1.1 && t > i.clickUntil) {
          i.clickUntil = t + 0.45;
          clicking.push(i);
        } else if (level > 0.09 && i.mode !== 'orbit') {
          i.mode = 'flee';
          i.modeT = 0.6;
          i.heading = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.8;
        }
        continue;
      }
      if (attacking && level > 0.22) {
        // Close and loud: fold the wings and drop.
        i.mode = 'dive';
        i.modeT = 0.45;
      } else if (level > 0.035 && i.mode !== 'flee') {
        // Faint and far: turn and fly away from it.
        i.mode = 'flee';
        i.modeT = 0.9;
        i.heading = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.6;
        i.speed = SPECIES[i.sp].speed * 1.25;
      }
    }
    return clicking;
  }

  update(dt: number): void {
    const w = this.world;
    const lamp = w.lamp;
    for (let n = this.insects.length - 1; n >= 0; n--) {
      const i = this.insects[n];
      const info = SPECIES[i.sp];
      i.modeT -= dt;
      if (i.mode === 'swarm') {
        // A dancing column of midges: springy pull to the swarm's centre, jitter on top.
        const jx = (this.rand() - 0.5) * 9;
        const jy = (this.rand() - 0.5) * 9;
        i.vx += ((i.ax - i.x) * 2.2 + jx) * dt;
        i.vy += ((i.ay - i.y) * 2.2 + jy) * dt;
        const v = Math.hypot(i.vx, i.vy);
        const cap = info.speed * 1.3;
        if (v > cap) {
          i.vx *= cap / v;
          i.vy *= cap / v;
        }
        i.vx *= 1 - 0.8 * dt;
        i.vy *= 1 - 0.8 * dt;
        i.x += i.vx * dt;
        i.y += i.vy * dt;
        continue;
      }
      if (i.mode === 'dive') {
        if (i.modeT <= 0) {
          i.mode = 'down';
          i.modeT = 2.5 + this.rand() * 2;
        }
        i.x += Math.cos(i.heading) * i.speed * 0.4 * dt;
        i.y += Math.sin(i.heading) * i.speed * 0.4 * dt;
        continue;
      }
      if (i.mode === 'down') {
        if (i.modeT <= 0) {
          // Back up out of the grass, somewhere nearby, heading off.
          i.mode = 'fly';
          i.heading = this.rand() * Math.PI * 2;
          i.speed = info.speed;
        }
        continue;
      }
      if (i.mode === 'flee' && i.modeT <= 0) {
        i.mode = 'fly';
        i.speed = info.speed * (0.85 + this.rand() * 0.3);
      }
      const toLamp = Math.hypot(i.x - lamp.x, i.y - lamp.y);
      const moth = i.sp === 'underwing' || i.sp === 'tiger';
      if (i.mode === 'fly' && moth && toLamp < lamp.r * 1.3 && this.rand() < dt * 0.5) {
        i.mode = 'orbit';
        i.modeT = 8 + this.rand() * 18;
      }
      if (i.mode === 'orbit') {
        if (i.modeT <= 0) {
          i.mode = 'fly';
          i.heading = Math.atan2(i.y - lamp.y, i.x - lamp.x);
        } else {
          // Round and round the light, wobbling in and out.
          const a = Math.atan2(i.y - lamp.y, i.x - lamp.x);
          const r = i.orbitR * (1 + 0.25 * Math.sin(i.phase + i.modeT * 2.3));
          const want = a + i.orbitDir * (Math.PI / 2) + (toLamp - r) * 0.9 * i.orbitDir;
          i.heading += wrap(want - i.heading) * Math.min(1, dt * 6);
          const sp = info.speed * 0.6;
          i.x += Math.cos(i.heading) * sp * dt;
          i.y += Math.sin(i.heading) * sp * dt;
          continue;
        }
      }
      // Free flight: a wandering heading that steers clear of leaves and the edges.
      i.wander += (this.rand() - 0.5) * dt * (i.sp === 'crane' ? 10 : i.sp === 'caddis' ? 14 : 5);
      i.wander *= 1 - dt * 1.5;
      i.heading += i.wander * dt * 3;
      if (i.sp === 'caddis') {
        const k = pondK(w.pond, i.x, i.y);
        if (k > 1.35) i.heading += wrap(Math.atan2(w.pond.cy - i.y, w.pond.cx - i.x) - i.heading) * dt * 3;
      }
      const lookX = i.x + Math.cos(i.heading) * 1.2;
      const lookY = i.y + Math.sin(i.heading) * 1.2;
      if (!openAt(w, lookX, lookY, 0.2)) i.heading += (i.orbitDir || 1) * dt * 5;
      if (i.x < 3) i.heading += wrap(0 - i.heading) * dt * 2;
      if (i.x > WORLD_W - 3) i.heading += wrap(Math.PI - i.heading) * dt * 2;
      if (i.y < 11) i.heading += wrap(Math.PI / 2 - i.heading) * dt * 2;
      if (i.y > WORLD_H - 4) i.heading += wrap(-Math.PI / 2 - i.heading) * dt * 2;
      const nx = i.x + Math.cos(i.heading) * i.speed * dt;
      const ny = i.y + Math.sin(i.heading) * i.speed * dt;
      if (openAt(w, nx, ny, 0.05)) {
        i.x = nx;
        i.y = ny;
      } else {
        i.heading += Math.PI * (0.5 + this.rand() * 0.5);
      }
    }
  }

  /** The insect within reach of a buzz that ends now, if any. */
  reach(bx: number, by: number, heading: number, radius: number): Insect | null {
    let best: Insect | null = null;
    let bestD = Infinity;
    for (const i of this.insects) {
      if (!this.catchable(i)) continue;
      const dx = i.x - bx;
      const dy = i.y - by;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const off = Math.abs(wrap(Math.atan2(dy, dx) - heading));
      if (off > 1.35 && d > radius * 0.35) continue;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** The best target ahead to steer in on during an approach. */
  lock(bx: number, by: number, heading: number, range: number): Insect | null {
    let best: Insect | null = null;
    let bestScore = Infinity;
    for (const i of this.insects) {
      if (!this.catchable(i)) continue;
      const dx = i.x - bx;
      const dy = i.y - by;
      const d = Math.hypot(dx, dy);
      if (d > range) continue;
      const off = Math.abs(wrap(Math.atan2(dy, dx) - heading));
      if (off > 0.9) continue;
      const score = d * (1 + off * 1.5) / (0.6 + SPECIES[i.sp].size);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  remove(i: Insect): void {
    const k = this.insects.indexOf(i);
    if (k >= 0) this.insects.splice(k, 1);
  }
}
