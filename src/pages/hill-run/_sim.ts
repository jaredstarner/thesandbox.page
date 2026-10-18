// Hill run: one engine, three rides.
//
// The board and the runner steer by heading: gravity pulls along the fall line,
// so pointing across the slope trades speed for safety. The luge can't turn; it
// rides a lateral offset in an ice channel where the curve's centrifugal pull is
// held by the banked wall, until it isn't.

import {
  BANK,
  CURB,
  CROSS,
  ICE,
  buildCourse,
  crossStreets,
  moveX,
  mulberry,
  sample,
  type Course,
  type LevelId,
  type Thing,
} from './_course';

const G = 9.81;

export interface Profile {
  /** Rolling resistance (fraction of g) and drag (1/m), upright and tucked. */
  crr: number;
  cd: number;
  tuckCd: number;
  /** Braking deceleration, m/s^2. */
  brake: number;
  /** Turn rate (rad/s) and the widest heading allowed. */
  turn: number;
  maxHead: number;
  /** Speed lost to carving, per rad/s of turn per m/s. */
  carve: number;
  /** Collision radius. */
  r: number;
}

export const PROFILES: Record<LevelId, Profile> = {
  bomb: { crr: 0.012, cd: 0.0044, tuckCd: 0.0033, brake: 5.2, turn: 2.3, maxHead: 1.42, carve: 0.07, r: 0.32 },
  cheese: { crr: 0.05, cd: 0.02, tuckCd: 0.016, brake: 3.6, turn: 3.8, maxHead: 1.5, carve: 0.03, r: 0.33 },
  luge: { crr: 0.0035, cd: 0.0011, tuckCd: 0.0009, brake: 3.4, turn: 0, maxHead: 0, carve: 0, r: 0.3 },
};

export interface PursuerSpec {
  name: string;
  /** When it sets off (fraction of the course) and how far behind it starts. */
  release: number;
  gap: number;
  /** Speed at release and at the finish. */
  v0: number;
  v1: number;
  /** Lateral homing speed. */
  lateral: number;
  /** Footprint half extents. */
  hw: number;
  hd: number;
}

export const PURSUERS: Record<LevelId, PursuerSpec> = {
  bomb: { name: 'the street sweeper', release: 0.26, gap: 85, v0: 15, v1: 17, lateral: 3.2, hw: 1.25, hd: 3.4 },
  cheese: { name: 'a second cheese', release: 0.18, gap: 45, v0: 12, v1: 13.5, lateral: 1.6, hw: 0.55, hd: 0.55 },
  luge: { name: 'the four-man bob', release: 0.2, gap: 120, v0: 23.5, v1: 26.5, lateral: 1.5, hw: 0.55, hd: 1.9 },
};

export type State = 'ready' | 'ride' | 'crash' | 'tumble' | 'caught' | 'finish';

export interface Rider {
  x: number;
  y: number;
  heading: number;
  v: number;
  /** Luge: lateral offset across the channel and its rate. */
  u: number;
  du: number;
  state: State;
  /** Seconds left in a crash or tumble. */
  timer: number;
  /** Invulnerable for this long after getting up. */
  grace: number;
  /** Cheese: how close the runner is to losing their feet (0 to 1). */
  footing: number;
  /** Bomb: speed wobble, 0 to 1. */
  wobble: number;
  tuck: boolean;
  brake: boolean;
  /** The thing that ended the run or the last crash, for the caption. */
  cause: string;
  /** Running animation phase. */
  stride: number;
  /** Turn rate this step, for the lean. */
  omega: number;
  crashes: number;
  /** Where the crash threw the rider, for drawing. */
  spill: number;
}

export interface Pursuer {
  active: boolean;
  x: number;
  y: number;
  v: number;
  u: number;
  spin: number;
}

export interface Runner {
  x: number;
  y: number;
  v: number;
  heading: number;
  state: 'ride' | 'tumble' | 'finish';
  timer: number;
  footing: number;
  skill: number;
  stride: number;
  seed: number;
  /** Where it's heading next on its traverse. */
  aim: number;
  finishedAt: number;
}

export interface Wheel {
  x: number;
  y: number;
  v: number;
  z: number;
  vz: number;
  spin: number;
  drift: number;
}

export interface Input {
  /** -1..1 from keys or a stick: turn rate (board, runner) or push (luge). */
  steer: number;
  /** Set when the pointer gives a heading to aim at instead (radians from straight down). */
  aim: number | null;
  tuck: boolean;
  brake: boolean;
}

export type Sound =
  | { type: 'crash'; what: string; v: number }
  | { type: 'trip'; v: number }
  | { type: 'knock'; v: number }
  | { type: 'bump'; v: number }
  | { type: 'seam'; v: number }
  | { type: 'step'; v: number }
  | { type: 'wall'; v: number }
  | { type: 'release' }
  | { type: 'caught' }
  | { type: 'finish' }
  | { type: 'door' };

export class Run {
  readonly course: Course;
  readonly id: LevelId;
  readonly p: Profile;
  readonly spec: PursuerSpec;
  rider: Rider;
  pursuer: Pursuer;
  runners: Runner[] = [];
  wheel: Wheel | null = null;
  /** Seconds since the start gun. */
  t = 0;
  /** Cheeses that went by without taking you. */
  dodged = 0;
  events: Sound[] = [];
  /** Distance seams the board has crossed, for the clack. */
  private lastSeam = 0;
  private rnd: () => number;
  private seams: number[] = [];
  /** The last pothole or tussock ridden over, so it only counts once. */
  private lastTrip: Thing | null = null;

  constructor(id: LevelId, course?: Course) {
    this.id = id;
    this.course = course ?? buildCourse(id);
    this.p = PROFILES[id];
    this.spec = PURSUERS[id];
    this.rnd = mulberry(9001);
    const c = this.course;
    this.rider = {
      x: id === 'bomb' ? 2.6 : id === 'luge' ? sample(c.track!.cx, c.start) : 0,
      y: c.start,
      heading: 0,
      v: 0,
      u: 0,
      du: 0,
      state: 'ready',
      timer: 0,
      grace: 0,
      footing: 0,
      wobble: 0,
      tuck: false,
      brake: false,
      cause: '',
      stride: 0,
      omega: 0,
      crashes: 0,
      spill: 0,
    };
    this.pursuer = { active: false, x: 0, y: c.start - 200, v: 0, u: 0, spin: 0 };
    if (id === 'cheese') {
      for (let i = 0; i < 7; i++) {
        const side = i % 2 ? 1 : -1;
        const x = side * (2.2 + Math.floor(i / 2) * 2.4);
        this.runners.push({
          x,
          y: c.start + (this.rnd() - 0.5) * 0.8,
          v: 0,
          heading: 0,
          state: 'ride',
          timer: 0,
          footing: 0,
          skill: 0.75 + this.rnd() * 0.35,
          stride: this.rnd() * 6,
          seed: this.rnd(),
          aim: x,
          finishedAt: 0,
        });
      }
      this.wheel = { x: 0, y: c.start + 3, v: 0, z: 0, vz: 0, spin: 0, drift: 0 };
    }
    if (id === 'bomb') {
      // Tar seams across the street every few metres, for the wheels to clack over.
      const r = mulberry(77);
      for (let y = c.start; y < c.end; y += 2.5 + r() * 5) this.seams.push(y);
    }
  }

  get progress(): number {
    const c = this.course;
    return Math.max(0, Math.min(1, (this.rider.y - c.start) / (c.finish - c.start)));
  }

  /** Metres the pursuer is behind the rider, or null before it sets off. */
  get gap(): number | null {
    return this.pursuer.active ? this.rider.y - this.pursuer.y : null;
  }

  start(): void {
    this.rider.state = 'ride';
  }

  step(dt: number, input: Input): void {
    const r = this.rider;
    if (r.state === 'ready' || r.state === 'caught') return;
    this.t += dt;
    if (r.state === 'finish') {
      // Coast to a stop past the line.
      r.v = Math.max(0, r.v - 6 * dt);
      if (this.id === 'luge') this.stepLuge(dt, { steer: 0, aim: null, tuck: false, brake: true });
      else {
        r.heading *= 1 - Math.min(1, 3 * dt);
        r.x += r.v * Math.sin(r.heading) * dt;
        r.y += r.v * Math.cos(r.heading) * dt;
      }
      this.stepWorld(dt);
      return;
    }
    if (this.id === 'luge') this.stepLuge(dt, input);
    else this.stepBoard(dt, input);
    this.stepWorld(dt);
    this.stepPursuer(dt);
    // The pursuer may have caught you in this step.
    if ((r.state as State) !== 'caught' && r.y >= this.course.finish) {
      r.state = 'finish';
      r.timer = 0;
      this.events.push({ type: 'finish' });
    }
  }

  // ------------------------------------------------------------ board and runner

  private stepBoard(dt: number, input: Input): void {
    const r = this.rider;
    const p = this.p;
    const c = this.course;
    const grade = sample(c.grade, r.y);
    r.grace = Math.max(0, r.grace - dt);

    if (r.state === 'crash') {
      r.timer -= dt;
      r.v = Math.max(0, r.v - 14 * dt);
      r.x += r.v * Math.sin(r.heading + r.spill) * dt;
      r.y += r.v * Math.cos(r.heading + r.spill) * dt;
      if (r.timer <= 0) {
        r.state = 'ride';
        // Back up and running onto the board, or back on your feet.
        r.v = this.id === 'bomb' ? 4 : 1.5;
        r.heading = 0;
        r.grace = 1.4;
        r.wobble = 0;
        r.footing = 0;
      }
      this.keepInside(dt);
      return;
    }

    if (r.state === 'tumble') {
      // Head over heels: no steering, gravity still pulling, a little sideways drift.
      r.timer -= dt;
      const a = G * grade * 0.8 - 0.05 * r.v * r.v - 1.5;
      r.v = Math.max(0, r.v + a * dt);
      r.heading += (this.rnd() - 0.5) * 3 * dt;
      r.heading = Math.max(-0.9, Math.min(0.9, r.heading));
      r.x += r.v * Math.sin(r.heading) * dt;
      r.y += r.v * Math.cos(r.heading) * dt;
      r.stride += r.v * dt * 1.3;
      this.collide(true);
      if (r.timer <= 0 && r.v < 7) {
        r.state = 'ride';
        r.footing = 0.35;
        r.v *= 0.55;
        r.grace = 0.6;
      }
      this.keepInside(dt);
      return;
    }

    r.tuck = input.tuck;
    r.brake = input.brake;
    let target: number;
    if (input.aim !== null) {
      target = input.aim;
      // Aiming back up the hill means stop.
      if (Math.abs(target) > Math.PI / 2) {
        r.brake = true;
        target = Math.sign(target) * p.maxHead;
      }
    } else target = r.heading + input.steer * p.turn * dt;
    target = Math.max(-p.maxHead, Math.min(p.maxHead, target));
    const turn = Math.max(-p.turn * dt, Math.min(p.turn * dt, target - r.heading));
    r.omega = turn / dt;
    r.heading += turn;

    // Speed wobbles past about 60 km/h unless tucked down low: the board shimmies
    // either side of where you point it, and past a point it throws you.
    let wob = 0;
    if (this.id === 'bomb') {
      const over = r.v - (r.tuck ? 18.5 : 16.5);
      r.wobble = Math.max(0, Math.min(1, r.wobble + (over > 0 ? over * 0.06 : -0.5) * dt));
      wob = Math.sin(this.t * 38) * r.wobble * 0.09;
      if (r.wobble >= 1) {
        if (r.grace <= 0) return this.crash('speed wobbles', 0.6);
        r.wobble = 0.9;
      }
    }

    const cd = r.tuck ? p.tuckCd : p.cd;
    let a = G * grade * Math.cos(r.heading) - cd * r.v * r.v - p.crr * G - p.carve * Math.abs(r.omega) * r.v;
    if (r.brake) a -= p.brake;
    if (this.id === 'cheese') {
      // Legs: you can run to a speed on a gentle bank, and fight to slow on a steep one.
      if (r.v < 6) a += (r.tuck ? 3.2 : 2.2) * (1 - r.v / 6);
      const run = r.tuck ? 8.4 : 7.6;
      const over = r.v - run;
      const steep = Math.max(0.2, grade * 2);
      r.footing += (over > 0 ? over * 0.55 * steep : -0.6) * dt * (r.brake ? 0.45 : 1);
      r.footing = Math.max(0, r.footing);
      if (r.footing >= 1) {
        this.tumble('lost your feet');
        return;
      }
      r.stride += r.v * dt * 1.25;
    } else {
      // Push off from a standstill on the flats.
      if (r.v < 5 && !r.brake) a += 2.4 * (1 - r.v / 5);
    }
    r.v = Math.max(0, r.v + a * dt);
    r.x += r.v * Math.sin(r.heading + wob) * dt;
    r.y += r.v * Math.cos(r.heading + wob) * dt;

    if (this.id === 'bomb') {
      while (this.lastSeam < this.seams.length && this.seams[this.lastSeam] < r.y) {
        this.lastSeam++;
        if (r.v > 2) this.events.push({ type: 'seam', v: r.v });
      }
    }
    if (this.id === 'cheese' && Math.floor(r.stride / Math.PI) !== Math.floor((r.stride - r.v * dt * 1.25) / Math.PI)) {
      this.events.push({ type: 'step', v: r.v });
    }

    this.keepInside(dt);
    if (r.state === 'ride') this.collide(false);
  }

  /** The curb and the fence. */
  private keepInside(dt: number): void {
    const r = this.rider;
    let edge = this.course.edge - this.p.r;
    if (this.id === 'bomb') {
      // Cross streets open up the sides.
      for (const y of crossStreets()) if (r.y > y + 1 && r.y < y + CROSS - 1) edge = 30;
    }
    if (Math.abs(r.x) <= edge) return;
    const out = Math.sign(r.x);
    const into = r.v * Math.sin(r.heading) * out;
    r.x = out * edge;
    if (r.state === 'ride' && into > 3.2 && r.grace <= 0) {
      this.crash(this.id === 'bomb' ? 'the curb' : 'the fence', -out * 0.6);
      return;
    }
    r.heading -= out * Math.min(Math.abs(r.heading), 2 * dt);
    r.v *= 1 - 0.5 * dt;
  }

  private crash(what: string, spill: number): void {
    const r = this.rider;
    if (r.grace > 0) return;
    r.state = 'crash';
    r.timer = this.id === 'luge' ? 1.6 : 1.2;
    r.cause = what;
    r.crashes++;
    r.spill = spill;
    r.wobble = 0;
    this.events.push({ type: 'crash', what, v: r.v });
    // A luger who comes off slides on down the ice; on the street or the bank you stop.
    r.v *= this.id === 'luge' ? 0.8 : 0.45;
  }

  private tumble(why: string): void {
    const r = this.rider;
    r.state = 'tumble';
    r.timer = 1.1 + this.rnd() * 0.9;
    r.cause = why;
    r.footing = 0;
    this.events.push({ type: 'trip', v: r.v });
  }

  /** Things near the rider, including moving ones where they are now. */
  *near(y: number, reach: number): Generator<{ t: Thing; x: number }> {
    const things = this.course.things;
    let lo = 0;
    let hi = things.length;
    // things are sorted by their bottom edge
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (things[m].y + things[m].hd < y - reach) lo = m + 1;
      else hi = m;
    }
    for (let i = lo; i < things.length; i++) {
      const t = things[i];
      if (t.y - t.hd - 12 > y + reach) break;
      yield { t, x: t.move ? moveX(t.move, this.t) : t.x };
    }
  }

  private collide(tumbling: boolean): void {
    const r = this.rider;
    const rad = this.p.r;
    for (const { t, x } of this.near(r.y, 7)) {
      if (t.effect === 'none' && !t.door) continue;
      if (t.down) continue;
      // A door that has swung open sticks out into the lane.
      if (t.door && t.door.at >= 0) {
        const open = Math.min(1, (this.t - t.door.at) / 0.35);
        const dy = t.y + (t.door.side < 0 ? -t.hd + 1.7 : t.hd - 1.7) - r.y;
        const dx = x + t.door.side * (t.hw + 0.55 * open) - r.x;
        if (Math.abs(dx) < 0.55 * open + rad && Math.abs(dy) < 0.12 + rad && r.grace <= 0) {
          return this.crash('a car door', -t.door.side * 0.5);
        }
      }
      if (t.effect === 'none') continue;
      if (!hits(t, x, r.x, r.y, rad)) continue;
      if (t.effect === 'crash') {
        if (tumbling) {
          // A tumble into gorse or a bale just stops you dead.
          r.v *= 0.3;
          r.timer = Math.min(r.timer, 0.4);
          continue;
        }
        if (r.grace > 0) continue;
        return this.crash(nameOf(t), (x - r.x > 0 ? -1 : 1) * 0.7);
      }
      if (tumbling || r.grace > 0) continue;
      if (t.effect === 'trip') {
        if (t === this.lastTrip) continue;
        if (this.id === 'cheese') {
          if (r.v > 6.2) return this.tumble(t.kind === 'hole' ? 'a rabbit hole' : 'a tussock');
          r.v *= 0.93;
        } else if (r.v > 7.5) {
          return this.crash('a pothole', (this.rnd() - 0.5) * 1.2);
        } else {
          r.v *= 0.86;
          this.events.push({ type: 'bump', v: r.v });
        }
        this.lastTrip = t;
      } else if (t.effect === 'slow') {
        r.v = Math.max(0, r.v - 7 * (1 / 120));
        r.footing = Math.max(0, r.footing - 0.004);
      } else if (t.effect === 'knock') {
        t.down = this.t;
        r.v *= 0.94;
        this.events.push({ type: 'knock', v: r.v });
      }
    }
  }

  // ------------------------------------------------------------ luge

  private stepLuge(dt: number, input: Input): void {
    const r = this.rider;
    const p = this.p;
    const tr = this.course.track!;
    const grade = sample(this.course.grade, r.y);
    const m = sample(tr.dx, r.y);
    const nn = Math.sqrt(1 + m * m);
    const k = sample(tr.k, r.y);
    const wall = sample(tr.wall, r.y);
    r.grace = Math.max(0, r.grace - dt);

    if (r.state === 'crash') {
      // Off the sled and sliding on your back down the ice.
      r.timer -= dt;
      r.v = Math.max(0, r.v - 4 * dt);
      r.u *= 1 - Math.min(1, 2 * dt);
      r.du = 0;
      r.y += (r.v / nn) * dt;
      if (r.timer <= 0) {
        r.state = 'ride';
        r.grace = 1.2;
        r.u = 0;
      }
      this.placeLuge();
      return;
    }

    r.tuck = input.tuck;
    r.brake = input.brake;
    const cd = r.tuck ? p.tuckCd : p.cd;
    const climb = Math.max(0, Math.abs(r.u) - ICE);
    let a = G * grade - cd * r.v * r.v - p.crr * G - climb * 1.4;
    if (r.brake) a -= p.brake;
    if (r.v < 3 && !r.brake) a += 2.2;
    r.v = Math.max(0, r.v + a * dt);

    // Across the channel: the curve throws you outward, the dish and the wall push back.
    const steer = input.aim !== null ? Math.max(-1, Math.min(1, input.aim)) : input.steer;
    let au = -r.v * r.v * k + steer * 4.2 - 1.0 * r.du;
    if (Math.abs(r.u) <= ICE) au -= 2.2 * r.u;
    else au -= Math.sign(r.u) * (2.2 * ICE + 13 * climb);
    r.du += au * dt;
    r.u += r.du * dt;
    r.omega = steer;
    if (climb > wall) {
      r.u = Math.sign(r.u) * (ICE + wall);
      if (r.grace <= 0) {
        this.crash('over the wall', Math.sign(r.u));
        this.events.push({ type: 'wall', v: r.v });
      } else r.du = 0;
    }
    // A hard knock on the wall bleeds speed.
    if (climb > 0 && Math.abs(r.du) > 3.5 && Math.sign(r.du) === Math.sign(r.u)) {
      this.events.push({ type: 'wall', v: Math.abs(r.du) });
      r.v *= 0.97;
      r.du *= -0.35;
    }
    r.y += (r.v / nn) * dt;
    this.placeLuge();
  }

  private placeLuge(): void {
    const r = this.rider;
    const tr = this.course.track!;
    const m = sample(tr.dx, r.y);
    const nn = Math.sqrt(1 + m * m);
    // Along the normal to the track, which points to +x on a straight; y stays the
    // track parameter, and drawing adds the normal's y part.
    r.x = sample(tr.cx, r.y) + r.u / nn;
    r.heading = Math.atan(m);
  }

  // ------------------------------------------------------------ the rest of the hill

  private stepWorld(dt: number): void {
    const r = this.rider;
    if (this.id === 'bomb') {
      for (const { t } of this.near(r.y, 26)) {
        if (
          t.door &&
          t.door.at < 0 &&
          t.y - r.y > 6 &&
          t.y - r.y < 24 &&
          Math.abs(t.x - r.x) < 5.5 &&
          r.state === 'ride'
        ) {
          t.door.at = this.t;
          this.events.push({ type: 'door' });
        }
      }
    }
    if (this.id === 'cheese') this.stepCheese(dt);
  }

  private stepCheese(dt: number): void {
    const c = this.course;
    const w = this.wheel!;
    // The cheese goes when the runners do, a beat ahead, bouncing and drifting.
    if (this.t > 0) {
      const grade = sample(c.grade, w.y);
      w.v = Math.max(3, w.v + (G * grade * 0.9 - 0.012 * w.v * w.v - (w.y > c.finish + 4 ? 8 : 0)) * dt);
      if (w.y > c.finish + 15) w.v = 0;
      w.y += w.v * dt;
      w.drift += (this.rnd() - 0.5) * 2 * dt;
      w.drift = Math.max(-1.2, Math.min(1.2, w.drift));
      w.x = Math.max(-BANK + 2, Math.min(BANK - 2, w.x + w.drift * w.v * 0.08 * dt));
      w.vz -= G * dt;
      w.z += w.vz * dt;
      if (w.z < 0) {
        w.z = 0;
        w.vz = w.v > 6 ? Math.abs(w.vz) * 0.45 + this.rnd() * w.v * 0.18 : 0;
      }
      w.spin += (w.v / 0.17) * dt;
    }
    for (const n of this.runners) {
      if (n.state === 'finish') {
        n.v = Math.max(0, n.v - 6 * dt);
        n.y += n.v * dt;
        n.stride += n.v * dt * 1.25;
        continue;
      }
      const grade = sample(c.grade, n.y);
      if (n.state === 'tumble') {
        n.timer -= dt;
        n.v = Math.max(0, n.v + (G * grade * 0.8 - 0.05 * n.v * n.v - 1.5) * dt);
        n.y += n.v * Math.cos(n.heading) * dt;
        n.x += n.v * Math.sin(n.heading) * dt;
        n.stride += n.v * dt * 1.3;
        if (n.timer <= 0 && n.v < 7) {
          n.state = 'ride';
          n.v *= 0.55;
          n.footing = 0.3;
        }
      } else {
        // Traverse back and forth across the face to keep speed in hand.
        if (Math.abs(n.x - n.aim) < 1.5) n.aim = Math.max(-BANK + 4, Math.min(BANK - 4, n.x + (this.rnd() - 0.5) * 22));
        const want = Math.max(-1.1, Math.min(1.1, (n.aim - n.x) * 0.15)) * Math.min(1, grade * 2.4);
        n.heading += Math.max(-3 * dt, Math.min(3 * dt, want - n.heading));
        let a = G * grade * Math.cos(n.heading) - 0.02 * n.v * n.v - 0.05 * G;
        if (n.v < 6) a += 2.4 * (1 - n.v / 6);
        n.v = Math.max(0, n.v + a * dt);
        const over = n.v - 7.4 * n.skill;
        n.footing = Math.max(0, n.footing + (over > 0 ? over * 0.5 * Math.max(0.2, grade * 2) : -0.6) * dt);
        if (n.footing >= 1 || this.rnd() < 0.02 * dt * (1 + over)) {
          n.state = 'tumble';
          n.timer = 1 + this.rnd();
          n.footing = 0;
        }
        n.x += n.v * Math.sin(n.heading) * dt;
        n.y += n.v * Math.cos(n.heading) * dt;
        n.stride += n.v * dt * 1.25;
      }
      n.x = Math.max(-BANK + 1, Math.min(BANK - 1, n.x));
      if (n.y >= c.finish) {
        n.state = 'finish';
        n.finishedAt = this.t;
      }
      // Bumping a runner while both are up puts you both down.
      const r = this.rider;
      if (r.state === 'ride' && n.state === 'ride' && r.grace <= 0 && Math.hypot(n.x - r.x, n.y - r.y) < 0.6) {
        if (Math.abs(n.v - r.v) > 2.5 || r.v > 7) {
          this.tumble('another runner');
          n.state = 'tumble';
          n.timer = 1.2;
        }
      }
    }
  }

  /** Your finishing place among the runners. */
  get place(): number {
    return 1 + this.runners.filter((n) => n.state === 'finish' && n.finishedAt <= this.t).length;
  }

  // ------------------------------------------------------------ the pursuer

  private stepPursuer(dt: number): void {
    const s = this.spec;
    const q = this.pursuer;
    const r = this.rider;
    const c = this.course;
    if (!q.active) {
      if (this.progress < s.release) return;
      q.active = true;
      q.y = r.y - s.gap;
      q.x = this.id === 'luge' ? sample(c.track!.cx, q.y) : this.id === 'bomb' ? 0 : r.x * 0.5;
      q.v = s.v0;
      this.events.push({ type: 'release' });
    }
    const along = Math.max(0, Math.min(1, (q.y - c.start) / (c.finish - c.start)));
    let v = s.v0 + (s.v1 - s.v0) * along;
    const gap = r.y - q.y;
    // Never too far behind to matter: a clean run holds it off, a crash lets it in.
    if (gap > s.gap + 10) v += (gap - s.gap - 10) * 0.15;
    if (this.id === 'cheese') {
      // A cheese you dodge rolls on by, and they send another down after you.
      const grade = sample(c.grade, q.y);
      v *= 0.7 + grade * 0.9;
      if (gap < -30) {
        q.y = r.y - s.gap;
        q.x = r.x + (this.rnd() - 0.5) * 6;
        q.v = v;
        this.dodged++;
        this.events.push({ type: 'release' });
      }
    } else if (gap < 1.2) {
      // Alongside but not on you: it won't pass, it holds your speed and closes in sideways.
      v = Math.min(v, r.v * (gap < 0 ? 0.9 : 1));
    }
    q.v += (v - q.v) * Math.min(1, 2 * dt);
    if (this.id === 'luge') {
      const tr = c.track!;
      const m = sample(tr.dx, q.y);
      q.y += (q.v / Math.sqrt(1 + m * m)) * dt;
      q.u += Math.max(-s.lateral * dt, Math.min(s.lateral * dt, r.u * 0.6 - q.u));
      q.x = sample(tr.cx, q.y) + q.u / Math.sqrt(1 + m * m);
    } else {
      q.y += q.v * dt;
      const edge = c.edge - s.hw - 0.2;
      q.x += Math.max(-s.lateral * dt, Math.min(s.lateral * dt, r.x - q.x));
      q.x = Math.max(-edge, Math.min(edge, q.x));
    }
    q.spin += q.v * dt;
    if (this.id === 'bomb') {
      // The brushes take cones and anything else small in front of the truck.
      for (const { t } of this.near(q.y + s.hd, 2)) {
        if (t.kind === 'cone' && !t.down && Math.abs(t.x - q.x) < s.hw + 0.4) t.down = this.t;
      }
    }
    const dy = r.y - q.y;
    const dx = Math.abs(r.x - q.x);
    const reach = this.id === 'luge' ? Math.abs(r.u - q.u) < 0.9 : dx < s.hw + this.p.r + 0.15;
    if (dy < s.hd + this.p.r && dy > -s.hd && reach && r.state !== 'finish') {
      r.state = 'caught';
      r.cause = s.name;
      this.events.push({ type: 'caught' });
    }
  }
}

function hits(t: Thing, tx: number, x: number, y: number, r: number): boolean {
  if (t.round) return Math.hypot(tx - x, t.y - y) < t.hw + r;
  return Math.abs(tx - x) < t.hw + r && Math.abs(t.y - y) < t.hd + r;
}

function nameOf(t: Thing): string {
  const names: Record<string, string> = {
    car: 'a parked car',
    van: 'a parked van',
    truck: 'a delivery truck',
    bus: 'the crosstown bus',
    pit: 'the roadworks',
    sign: 'a roadworks sign',
    grate: 'a storm drain',
    walker: 'someone crossing',
    gorse: 'the gorse',
    rock: 'a rock',
    bale: 'the hay bales',
  };
  if (t.kind === 'car' && t.move) return 'cross traffic';
  return names[t.kind] ?? `a ${t.kind}`;
}

export { CURB };
