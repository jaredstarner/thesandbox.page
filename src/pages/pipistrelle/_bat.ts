// The bat: how it flies, and how it calls. In search flight it calls about ten
// times a second; closing in, the calls get shorter, quieter, and faster, until
// the feeding buzz at close to two hundred a second, and whatever is in front
// of it at the end of the buzz is taken.

import { WORLD_H, WORLD_W, insideBarn, sampleField, type World } from './_world';
import { wrap, type CallShape } from './_sonar';

export type Phase = 'roost' | 'search' | 'approach' | 'buzz' | 'pause';

export const CRUISE = 5.2;
const MAX_TURN = 3.6;

export interface Call {
  shape: CallShape;
  /** Call length in bat seconds. */
  duration: number;
  /** Sweep, kHz, start to end. */
  f0: number;
  f1: number;
  /** Level, for what a moth's ears make of it. */
  loud: number;
  attacking: boolean;
}

const SEARCH: Call = {
  shape: { range: 17, rays: 320, beam: 1.25 },
  duration: 0.0056,
  f0: 72,
  f1: 46.5,
  loud: 1,
  attacking: false,
};

const APPROACH_TIME = 0.28;
const BUZZ_TIME = 0.13;
const PAUSE_TIME = 0.12;

export class Bat {
  x: number;
  y: number;
  heading: number;
  speed = CRUISE;
  phase: Phase = 'roost';
  phaseT = 0;
  nextCall = 0;
  /** Wingbeat phase, radians. */
  wing = 0;
  stunned = 0;
  /** Steering target, metres, or null to hold the heading (keys steer). */
  target: { x: number; y: number } | null = null;
  turnInput = 0;
  wantsAttack = false;
  bumps = 0;

  constructor(private world: World) {
    this.x = world.roost.x;
    this.y = world.roost.y;
    this.heading = world.roostHeading;
  }

  reset(): void {
    this.x = this.world.roost.x;
    this.y = this.world.roost.y;
    this.heading = this.world.roostHeading;
    this.speed = CRUISE;
    this.phase = 'roost';
    this.phaseT = 0;
    this.nextCall = 0;
    this.stunned = 0;
    this.target = null;
    this.turnInput = 0;
    this.wantsAttack = false;
    this.bumps = 0;
  }

  /** The call due now, given the phase, or null if none is due. Advances the schedule. */
  callDue(t: number): Call | null {
    if (t < this.nextCall) return null;
    if (this.phase === 'roost') {
      this.nextCall = t + 0.35 + Math.random() * 0.4;
      return { ...SEARCH, shape: { range: 9, rays: 200, beam: 1.1 }, loud: 0.6 };
    }
    if (this.phase === 'pause') {
      this.nextCall = t + 0.01;
      return null;
    }
    if (this.phase === 'search') {
      this.nextCall = t + 0.095 * (0.88 + Math.random() * 0.24);
      return SEARCH;
    }
    if (this.phase === 'approach') {
      const u = Math.min(1, this.phaseT / APPROACH_TIME);
      this.nextCall = t + lerp(0.045, 0.012, u);
      return {
        shape: { range: lerp(8, 2.6, u), rays: Math.round(lerp(170, 80, u)), beam: lerp(1.05, 0.85, u) },
        duration: lerp(0.0036, 0.0016, u),
        f0: lerp(75, 70, u),
        f1: lerp(47, 43, u),
        loud: lerp(0.95, 0.65, u),
        attacking: true,
      };
    }
    // The buzz.
    this.nextCall = t + 0.0055;
    return {
      shape: { range: 1.5, rays: 48, beam: 0.85 },
      duration: 0.0007,
      f0: 62,
      f1: 38,
      loud: 0.5,
      attacking: true,
    };
  }

  /** Advances flight by dt bat seconds. Returns true when the buzz has just ended. */
  update(dt: number, lockTarget: { x: number; y: number } | null): { buzzEnded: boolean; bumped: string | null } {
    const out = { buzzEnded: false, bumped: null as string | null };
    if (this.phase === 'roost') return out;
    this.phaseT += dt;
    this.wing += dt * Math.PI * 2 * (this.phase === 'buzz' ? 13 : 11);

    // Phase machine.
    if (this.phase === 'search' && this.wantsAttack && this.stunned <= 0) {
      this.phase = 'approach';
      this.phaseT = 0;
      this.nextCall = 0;
    } else if (this.phase === 'approach') {
      if (!this.wantsAttack) {
        this.phase = 'search';
        this.phaseT = 0;
      } else if (this.phaseT >= APPROACH_TIME) {
        this.phase = 'buzz';
        this.phaseT = 0;
        this.nextCall = 0;
      }
    } else if (this.phase === 'buzz' && this.phaseT >= BUZZ_TIME) {
      this.phase = 'pause';
      this.phaseT = 0;
      out.buzzEnded = true;
    } else if (this.phase === 'pause' && this.phaseT >= PAUSE_TIME) {
      this.phase = 'search';
      this.phaseT = 0;
      this.nextCall = 0;
    }

    // Steering.
    let desired = this.heading;
    let turnCap = MAX_TURN * (this.phase === 'approach' || this.phase === 'buzz' ? 1.3 : 1);
    if (this.target) {
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy);
      const toward = Math.atan2(dy, dx);
      if (d < 1.4) {
        // Close to the pointer: circle it, the way a bat beats a small patch.
        const side = wrap(toward - this.heading) > 0 ? 1 : -1;
        desired = toward - side * (Math.PI / 2) * (1 - d / 2.8);
      } else {
        desired = toward;
      }
    } else if (this.turnInput !== 0) {
      desired = this.heading + this.turnInput * 1.2;
    }
    if (lockTarget && (this.phase === 'approach' || this.phase === 'buzz')) {
      const toward = Math.atan2(lockTarget.y - this.y, lockTarget.x - this.x);
      desired = this.heading + wrap(toward - this.heading) * 0.7 + wrap(desired - this.heading) * 0.3;
    }
    // Ease away from the edges of the map.
    const m = 3;
    if (this.x < m) desired = this.heading + wrap(0 - this.heading) * 0.8;
    if (this.x > WORLD_W - m) desired = this.heading + wrap(Math.PI - this.heading) * 0.8;
    if (this.y < m) desired = this.heading + wrap(Math.PI / 2 - this.heading) * 0.8;
    if (this.y > WORLD_H - m) desired = this.heading + wrap(-Math.PI / 2 - this.heading) * 0.8;
    // A flinch from leaves just ahead.
    const ahead = sampleField(this.world.leafSd, this.x + Math.cos(this.heading) * 0.9, this.y + Math.sin(this.heading) * 0.9);
    if (ahead < 0.1) {
      const left = sampleField(
        this.world.leafSd,
        this.x + Math.cos(this.heading - 0.6) * 1.1,
        this.y + Math.sin(this.heading - 0.6) * 1.1,
      );
      const right = sampleField(
        this.world.leafSd,
        this.x + Math.cos(this.heading + 0.6) * 1.1,
        this.y + Math.sin(this.heading + 0.6) * 1.1,
      );
      desired += (left > right ? -1 : 1) * 0.5;
      turnCap *= 1.2;
    }
    if (this.stunned > 0) {
      this.stunned -= dt;
      turnCap *= 0.4;
    }
    const turn = Math.max(-turnCap * dt, Math.min(turnCap * dt, wrap(desired - this.heading)));
    this.heading = wrap(this.heading + turn);

    const want = this.stunned > 0 ? 2 : this.phase === 'approach' || this.phase === 'buzz' ? CRUISE * 1.1 : CRUISE;
    this.speed += (want - this.speed) * Math.min(1, dt * 3);

    const nx = this.x + Math.cos(this.heading) * this.speed * dt;
    const ny = this.y + Math.sin(this.heading) * this.speed * dt;
    const hit = this.collide(nx, ny);
    if (hit) {
      out.bumped = hit;
      this.bumps++;
      this.stunned = 0.35;
      this.speed = 1.6;
      this.heading = wrap(this.heading + Math.PI * 0.75 * (Math.random() < 0.5 ? -1 : 1));
      if (this.phase === 'approach' || this.phase === 'buzz') {
        this.phase = 'pause';
        this.phaseT = 0;
      }
    } else {
      this.x = Math.max(0.5, Math.min(WORLD_W - 0.5, nx));
      this.y = Math.max(0.5, Math.min(WORLD_H - 0.5, ny));
    }
    return out;
  }

  /** What, if anything, the bat would fly into at (x, y). */
  private collide(x: number, y: number): string | null {
    const w = this.world;
    if (sampleField(w.leafSd, x, y) < -0.12) return 'leaves';
    for (const wall of w.walls) {
      const ex = wall.x2 - wall.x1;
      const ey = wall.y2 - wall.y1;
      const len2 = ex * ex + ey * ey;
      const u = Math.max(0, Math.min(1, ((x - wall.x1) * ex + (y - wall.y1) * ey) / len2));
      const px = wall.x1 + ex * u;
      const py = wall.y1 + ey * u;
      const d = Math.hypot(x - px, y - py);
      if (d < 0.14) {
        const approaching = Math.cos(this.heading) * wall.nx + Math.sin(this.heading) * wall.ny < 0;
        if (approaching) return 'wall';
      }
    }
    if (insideBarn(w, x, y)) return 'wall';
    for (const p of w.posts) if (Math.hypot(x - p.x, y - p.y) < p.r + 0.12) return 'post';
    return null;
  }

  leaveRoost(): void {
    this.phase = 'search';
    this.phaseT = 0;
    this.nextCall = 0;
    this.speed = CRUISE * 0.7;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
