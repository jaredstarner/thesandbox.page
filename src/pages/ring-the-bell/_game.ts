// The game: rules, lamps, and the score motor, run on top of the ball physics.
//
// Scoring works the way an electromechanical machine's does. A 10, 100, or 1,000 point switch pulses a relay
// straight away: one step of a score reel and one strike of that value's chime. Anything bigger is paid out
// by the score motor as a run of pulses at its own steady pace (500 is five 100s), so a big award rings out
// as a string of chimes while play goes on. The end-of-ball ticket bonus counts down on the same motor.

import { BALL_R, STEP, crossed, stepBall, stepFlipper, type Ball, type Hit } from './_physics';
import { BALLS_PER_GAME, MAX_CREDITS, MAX_TICKETS, REPLAYS } from './_rules';
import {
  APRON_Y,
  BUMPER_KICK,
  DIVIDER_X,
  DUCK_X,
  PLUNGER_REST,
  PLUNGER_TRAVEL,
  ROLLOVERS,
  SAUCER,
  SLING_KICK,
  SPINNER_Y,
  STRIKER,
  buildTable,
  lanePoint,
  servePosition,
  type RolloverId,
  type Table,
} from './_table';

export type Phase = 'over' | 'reset' | 'serve' | 'play' | 'drain' | 'match';

export type GameEvent =
  | { type: 'chime'; value: 10 | 100 | 1000 }
  | { type: 'reel' }
  | { type: 'motor' }
  | { type: 'bumper'; index: number }
  | { type: 'sling'; side: 'L' | 'R' }
  | { type: 'flipper'; side: 'L' | 'R'; up: boolean }
  | { type: 'hit'; id: string; speed: number }
  | { type: 'duck'; index: number }
  | { type: 'duckReset' }
  | { type: 'rollover'; id: RolloverId }
  | { type: 'spin' }
  | { type: 'saucerIn' }
  | { type: 'saucerOut' }
  | { type: 'striker'; level: number; speed: number }
  | { type: 'bell' }
  | { type: 'plunge'; power: number }
  | { type: 'serve' }
  | { type: 'drain' }
  | { type: 'tilt' }
  | { type: 'nudge' }
  | { type: 'knocker' }
  | { type: 'coin' }
  | { type: 'start' }
  | { type: 'gameOver' }
  | { type: 'match'; won: boolean };

interface Pulse {
  value: number;
  motor: boolean;
  /** Bonus countdown pulses also put out a ticket lamp. */
  ticket?: boolean;
}

/** mm/s through the strength test's speed trap to ring the bell. */
export const BELL_SPEED = 3000;
const DIRECT_GAP = 0.055;
const MOTOR_GAP = 0.125;
const REEL_STEP = 0.05;

function decompose(points: number): Pulse[] {
  for (const unit of [10000, 1000, 100, 10]) {
    if (points % unit === 0 && points / unit <= 9) {
      const n = points / unit;
      return Array.from({ length: n }, () => ({ value: unit, motor: n > 1 }));
    }
  }
  return [];
}

export class Game {
  readonly table: Table;
  readonly ball: Ball;
  phase: Phase = 'over';
  credits = 0;
  score = 0;
  ballNumber = 0;
  tilted = false;
  /** The tilt bob's swing; past 1 it touches the ring. */
  bob = 0;
  /** Visual shake of the cabinet after a nudge, mm. */
  shakeX = 0;
  shakeY = 0;

  lanes = [false, false, false];
  spinnerLit = false;
  tickets = 0;
  saucerLit = false;
  extraBall = false;
  specialEarned = false;
  specialSide: 'L' | 'R' = 'L';
  matchNumber: number | null = null;
  /** Per duck: 0 standing to 1 down. */
  duckDown = [0, 0, 0, 0, 0];
  ducksResetAt = 0;
  spinnerAngle = 0;
  spinnerRate = 0;
  /** The strength test: level reached (0-10) and how far the lamps have climbed toward it. */
  ladderLevel = 0;
  ladderShown = 0;
  ladderHold = 0;
  bellFlash = 0;
  bumperFlash = [0, 0, 0];
  slingFlash = { L: 0, R: 0 };
  /** The score reels' shown positions, tens first; each moves toward its digit one step at a time. */
  reels = [0, 0, 0, 0, 0];
  plunger = 0;
  plungerHeld = false;
  plungerSnap = 0;
  best = 0;
  /** Seconds of game time. */
  time = 0;

  private queue: Pulse[] = [];
  private pulseWait = 0;
  private reelWait = 0;
  private phaseTime = 0;
  private acc = 0;
  private hits: Hit[] = [];
  private inside = new Set<RolloverId>();
  private saucerHold = -1;
  private still = 0;
  private bonusQueued = false;
  bellsThisBall = 0;
  private replaysWon = 0;
  private emit: (e: GameEvent) => void;
  private rand: () => number;

  constructor(emit: (e: GameEvent) => void, rand: () => number = Math.random) {
    this.emit = emit;
    this.rand = rand;
    this.table = buildTable();
    this.ball = { x: 0, y: 0, vx: 0, vy: 0, spin: 0, live: false };
    this.setFlipperPower(false);
  }

  // ---- Controls -------------------------------------------------------------

  flip(side: 'L' | 'R', down: boolean): void {
    const fl = this.table.flippers[side === 'L' ? 0 : 1];
    if (fl.held === down) return;
    fl.held = down;
    if (fl.powered) this.emit({ type: 'flipper', side, up: down });
  }

  pull(down: boolean): void {
    if (down) {
      this.plungerHeld = true;
      return;
    }
    if (!this.plungerHeld) return;
    this.plungerHeld = false;
    const power = this.plunger;
    const b = this.ball;
    const resting =
      b.live && b.x > DIVIDER_X && b.y + BALL_R > PLUNGER_REST + power * PLUNGER_TRAVEL - 5 && Math.abs(b.vy) < 400;
    if (resting && power > 0.04) {
      const speed = (500 + 3150 * power) * (1 + (this.rand() - 0.5) * 0.03);
      b.vy = -speed;
    }
    // The tip springs back to rest in one step; carry a ball that sits on it up too, so it never ends up below.
    if (b.live && b.x > DIVIDER_X) b.y = Math.min(b.y, PLUNGER_REST - BALL_R - 1);
    if (power > 0.04) this.emit({ type: 'plunge', power });
    this.plungerSnap = power;
    this.plunger = 0;
  }

  nudge(dir: 'L' | 'R' | 'U'): void {
    if (this.phase !== 'play' && this.phase !== 'serve') return;
    const b = this.ball;
    const kick = 230;
    if (b.live && !this.inSaucer()) {
      if (dir === 'L') b.vx -= kick;
      if (dir === 'R') b.vx += kick;
      if (dir === 'U') b.vy -= kick * 1.3;
    }
    this.shakeX += dir === 'L' ? 3 : dir === 'R' ? -3 : 0;
    this.shakeY += dir === 'U' ? 3 : 0;
    this.bob += dir === 'U' ? 0.5 : 0.4;
    this.emit({ type: 'nudge' });
    if (this.bob > 1 && !this.tilted) this.tilt();
  }

  coin(): void {
    if (this.credits >= MAX_CREDITS) return;
    this.credits++;
    this.emit({ type: 'coin' });
  }

  start(): void {
    if (this.phase !== 'over') return;
    if (this.credits === 0) this.coin();
    this.credits--;
    this.emit({ type: 'start' });
    this.phase = 'reset';
    this.phaseTime = 0;
    this.queue = [];
    this.score = 0;
    this.replaysWon = 0;
    this.matchNumber = null;
    this.ballNumber = 1;
    this.tilted = false;
    this.bob = 0;
    this.resetBall();
  }

  // ---- Simulation -----------------------------------------------------------

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.phaseTime += dt;
    this.updateMotor(dt);
    this.updateReels(dt);
    this.updateFeatures(dt);

    if (this.plungerHeld) this.plunger = Math.min(1, this.plunger + dt / 0.85);
    this.plungerSnap = Math.max(0, this.plungerSnap - dt * 30);
    const tip = PLUNGER_REST + this.plunger * PLUNGER_TRAVEL;
    this.table.plunger.ay = tip;
    this.table.plunger.by = tip;

    this.bob *= Math.exp(-dt / 1.1);
    this.shakeX *= Math.exp(-dt * 18);
    this.shakeY *= Math.exp(-dt * 18);

    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.physicsStep();
    }
    this.updatePhase();
  }

  private physicsStep(): void {
    for (const fl of this.table.flippers) stepFlipper(fl, STEP);
    const b = this.ball;
    if (!b.live) return;
    if (this.saucerHold >= 0) return;
    const x0 = b.x;
    const y0 = b.y;
    this.hits.length = 0;
    stepBall(this.table, b, STEP, this.hits);
    for (const h of this.hits) this.onHit(h);
    this.sensors(x0, y0);
  }

  private sensors(x0: number, y0: number): void {
    const b = this.ball;
    // Rollover buttons.
    for (const id of Object.keys(ROLLOVERS) as RolloverId[]) {
      const p = ROLLOVERS[id];
      const inside = Math.hypot(b.x - p.x, b.y - p.y) < 12;
      if (inside && !this.inside.has(id)) {
        this.inside.add(id);
        this.onRollover(id);
      } else if (!inside) this.inside.delete(id);
    }
    // The spinner across the left loop.
    if (crossed(10, SPINNER_Y, 50, SPINNER_Y, x0, y0, b.x, b.y)) {
      this.spinnerRate = Math.min(260, this.spinnerRate + Math.abs(b.vy) / 11);
      b.vx *= 0.96;
      b.vy *= 0.96;
    }
    // The strength test's speed trap, going up.
    if (b.vx * STRIKER.ux + b.vy * STRIKER.uy > 0) {
      const a = lanePoint(STRIKER.trap, -STRIKER.half);
      const c = lanePoint(STRIKER.trap, STRIKER.half);
      if (crossed(a.x, a.y, c.x, c.y, x0, y0, b.x, b.y)) this.onStriker(Math.hypot(b.vx, b.vy));
    }
    // The fortune teller's saucer: a shallow dish that draws a slow ball in.
    const dx = SAUCER.x - b.x;
    const dy = SAUCER.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d < 20) {
      const sp = Math.hypot(b.vx, b.vy);
      if (d < 8 && sp < 1500) {
        this.saucerHold = 0;
        b.x = SAUCER.x;
        b.y = SAUCER.y;
        b.vx = 0;
        b.vy = 0;
        this.onSaucer();
      } else if (d > 0.5) {
        const pull = 2600 * STEP;
        b.vx += (dx / d) * pull;
        b.vy += (dy / d) * pull;
      }
    }
    // Under the apron: drained.
    if ((b.y > APRON_Y + 12 && b.x < DIVIDER_X) || b.y > APRON_Y + 120) {
      b.live = false;
      this.onDrain();
    }
  }

  private inSaucer(): boolean {
    return this.saucerHold >= 0;
  }

  private onHit(h: Hit): void {
    const playing = this.phase === 'play' && !this.tilted;
    if (h.id.startsWith('bumper')) {
      if (h.speed < 90) return;
      const i = Number(h.id.slice(6));
      this.bumperFlash[i] = 1;
      this.emit({ type: 'bumper', index: i });
      if (playing) this.award(this.lanes[i] ? 100 : 10);
      return;
    }
    if (h.id === 'slingL' || h.id === 'slingR') {
      if (h.speed < 260) return;
      const side = h.id === 'slingL' ? 'L' : 'R';
      this.slingFlash[side] = 1;
      this.emit({ type: 'sling', side });
      if (playing) {
        this.award(10);
        this.specialSide = this.specialSide === 'L' ? 'R' : 'L';
      }
      return;
    }
    if (h.id.startsWith('duck')) {
      const i = Number(h.id.slice(4));
      const duck = this.table.ducks[i];
      if (!duck.on || h.speed < 80) return;
      duck.on = false;
      this.emit({ type: 'duck', index: i });
      if (playing) {
        this.award(500);
        this.addTickets(1);
        if (this.table.ducks.every((t) => !t.on)) {
          this.award(5000);
          this.saucerLit = !this.extraBall;
          this.ducksResetAt = this.time + 1.4;
        }
      } else if (this.table.ducks.every((t) => !t.on)) {
        this.ducksResetAt = this.time + 1.4;
      }
      return;
    }
    if (h.id === 'bell' && h.speed > 300) {
      this.emit({ type: 'hit', id: 'bell', speed: h.speed });
      return;
    }
    if (h.speed > 70) this.emit({ type: 'hit', id: h.id, speed: h.speed });
  }

  private onRollover(id: RolloverId): void {
    this.emit({ type: 'rollover', id });
    if (this.phase !== 'play' || this.tilted) return;
    if (id.startsWith('lane')) {
      const i = Number(id.slice(4));
      this.award(this.lanes[i] ? 1000 : 100);
      this.lanes[i] = true;
      if (this.lanes.every(Boolean)) this.spinnerLit = true;
    } else if (id.startsWith('inlane')) {
      this.award(500);
    } else {
      const side = id === 'outlaneL' ? 'L' : 'R';
      this.award(1000);
      if (this.specialEarned && this.specialSide === side) {
        this.specialEarned = false;
        this.freeGame();
      }
    }
  }

  private onStriker(speed: number): void {
    // A late flip on a ball rolling down the left flipper goes straight up the lane at 2.4 to 3.3 m/s, and a
    // ball met on the fly can come off faster still; one that glances off the mouth loses half of that.
    const level = speed >= BELL_SPEED ? 10 : Math.max(1, Math.min(9, 1 + Math.floor((speed - 600) / 270)));
    this.ladderLevel = level;
    this.ladderShown = 0;
    this.ladderHold = 0;
    this.emit({ type: 'striker', level, speed });
    if (this.phase !== 'play' || this.tilted) return;
    if (level === 10) {
      this.bellFlash = 1;
      this.bellsThisBall++;
      this.emit({ type: 'bell' });
      this.award(5000);
      this.addTickets(3);
      if (this.bellsThisBall >= 2) this.specialEarned = true;
    } else {
      this.award(level * 100);
    }
  }

  private onSaucer(): void {
    this.emit({ type: 'saucerIn' });
    if (this.phase === 'play' && !this.tilted) {
      this.award(1000);
      this.addTickets(2);
      if (this.saucerLit) {
        this.saucerLit = false;
        this.extraBall = true;
      }
    }
  }

  private onDrain(): void {
    this.emit({ type: 'drain' });
    if (this.phase === 'play') {
      this.phase = 'drain';
      this.phaseTime = 0;
      this.bonusQueued = false;
      this.setFlipperPower(false);
    }
  }

  private tilt(): void {
    this.tilted = true;
    this.setFlipperPower(false);
    for (const s of this.table.bumpers) s.kick = undefined;
    for (const s of this.table.slings) s.kick = undefined;
    this.queue = this.queue.filter((p) => !p.motor);
    this.emit({ type: 'tilt' });
  }

  private untilt(): void {
    this.tilted = false;
    for (const s of this.table.bumpers) s.kick = BUMPER_KICK;
    for (const s of this.table.slings) s.kick = SLING_KICK;
  }

  private setFlipperPower(on: boolean): void {
    for (const fl of this.table.flippers) fl.powered = on;
  }

  private addTickets(n: number): void {
    this.tickets = Math.min(MAX_TICKETS, this.tickets + n);
  }

  private freeGame(): void {
    if (this.credits < MAX_CREDITS) this.credits++;
    this.emit({ type: 'knocker' });
  }

  award(points: number): void {
    this.queue.push(...decompose(points));
  }

  // ---- Score motor and reels ------------------------------------------------

  private updateMotor(dt: number): void {
    this.pulseWait -= dt;
    if (this.pulseWait > 0 || this.queue.length === 0) return;
    const p = this.queue.shift()!;
    const before = this.score;
    this.score = (this.score + p.value) % 1_000_000;
    if (p.ticket) this.tickets = Math.max(0, this.tickets - 1);
    const chime = p.value >= 1000 ? 1000 : (p.value as 10 | 100);
    this.emit({ type: 'chime', value: chime });
    if (p.motor) this.emit({ type: 'motor' });
    this.pulseWait = p.motor ? MOTOR_GAP : DIRECT_GAP;
    for (const r of REPLAYS) {
      if (before < r && this.score >= r) {
        this.replaysWon++;
        this.freeGame();
      }
    }
  }

  private reelTargets(): number[] {
    return [1, 2, 3, 4, 5].map((k) => Math.floor(this.score / 10 ** k) % 10);
  }

  private updateReels(dt: number): void {
    this.reelWait -= dt;
    if (this.reelWait > 0) return;
    const targets = this.reelTargets();
    let moved = false;
    for (let k = 0; k < 5; k++) {
      const cur = Math.round(this.reels[k]) % 10;
      if (cur !== targets[k]) {
        this.reels[k] = (cur + 1) % 10;
        moved = true;
      }
    }
    if (moved) {
      this.emit({ type: 'reel' });
      this.reelWait = REEL_STEP;
    }
  }

  /** Whether every reel shows the score. */
  reelsSettled(): boolean {
    const t = this.reelTargets();
    return this.reels.every((r, k) => Math.round(r) % 10 === t[k]);
  }

  // ---- Features and phases --------------------------------------------------

  private updateFeatures(dt: number): void {
    for (let i = 0; i < 3; i++) this.bumperFlash[i] = Math.max(0, this.bumperFlash[i] - dt * 9);
    this.slingFlash.L = Math.max(0, this.slingFlash.L - dt * 10);
    this.slingFlash.R = Math.max(0, this.slingFlash.R - dt * 10);
    this.bellFlash = Math.max(0, this.bellFlash - dt * 0.6);

    // Ducks fall back when hit and stand up together when the bank resets.
    for (let i = 0; i < DUCK_X.length; i++) {
      const target = this.table.ducks[i].on ? 0 : 1;
      this.duckDown[i] += Math.sign(target - this.duckDown[i]) * Math.min(Math.abs(target - this.duckDown[i]), dt * 12);
    }
    if (this.ducksResetAt && this.time >= this.ducksResetAt) {
      this.ducksResetAt = 0;
      this.resetDucks();
    }

    // The spinner coasts down; each turn scores.
    if (this.spinnerRate > 0) {
      const before = Math.floor(this.spinnerAngle / (Math.PI * 2));
      this.spinnerAngle += this.spinnerRate * dt;
      this.spinnerRate = Math.max(0, this.spinnerRate - (this.spinnerRate * 2.2 + 18) * dt);
      const turns = Math.floor(this.spinnerAngle / (Math.PI * 2)) - before;
      for (let i = 0; i < turns; i++) {
        this.emit({ type: 'spin' });
        if (this.phase === 'play' && !this.tilted) this.award(this.spinnerLit ? 100 : 10);
      }
    }

    // The strength test's lamps climb to the level, hold, and go out.
    if (this.ladderLevel > 0) {
      if (this.ladderShown < this.ladderLevel) {
        this.ladderShown = Math.min(this.ladderLevel, this.ladderShown + dt * 26);
      } else {
        this.ladderHold += dt;
        if (this.ladderHold > (this.ladderLevel === 10 ? 2.6 : 1.3)) {
          this.ladderLevel = 0;
          this.ladderShown = 0;
        }
      }
    }

    // The saucer holds the ball while the motor pays out, then kicks it out.
    if (this.saucerHold >= 0) {
      this.saucerHold += dt;
      if (this.saucerHold > 1.1 && (this.queue.length === 0 || this.saucerHold > 3)) {
        this.saucerHold = -1;
        const b = this.ball;
        // Out to the right and a little down the table, toward the gallery.
        const a = (20 + (this.rand() - 0.5) * 8) * (Math.PI / 180);
        b.vx = Math.cos(a) * 1500;
        b.vy = Math.sin(a) * 1500;
        b.x += b.vx * 0.012;
        b.y += b.vy * 0.012;
        this.emit({ type: 'saucerOut' });
      }
    }

    // A ball that has stopped dead somewhere gets a shake loose, as an operator would.
    const b = this.ball;
    const cradled = this.table.flippers.some((f) => f.held);
    if (
      this.phase === 'play' &&
      b.live &&
      !cradled &&
      this.saucerHold < 0 &&
      b.x < DIVIDER_X &&
      Math.hypot(b.vx, b.vy) < 25
    ) {
      this.still += dt;
      if (this.still > 5) {
        this.still = 0;
        b.vx += (this.rand() - 0.5) * 500;
        b.vy -= 300;
        this.shakeY += 2;
      }
    } else this.still = 0;
  }

  private resetDucks(): void {
    for (const d of this.table.ducks) d.on = true;
    this.emit({ type: 'duckReset' });
  }

  private resetBall(): void {
    this.lanes = [false, false, false];
    this.spinnerLit = false;
    this.saucerLit = false;
    this.specialEarned = false;
    this.bellsThisBall = 0;
    this.tickets = 0;
    this.ducksResetAt = 0;
    if (this.table.ducks.some((d) => !d.on)) this.resetDucks();
  }

  private serve(): void {
    const p = servePosition();
    Object.assign(this.ball, { x: p.x, y: p.y - 30, vx: 0, vy: 0, live: true });
    this.untilt();
    this.bob = 0;
    this.setFlipperPower(true);
    this.phase = 'play';
    this.phaseTime = 0;
    this.emit({ type: 'serve' });
  }

  private updatePhase(): void {
    switch (this.phase) {
      case 'reset':
        if (this.reelsSettled() && this.phaseTime > 0.8) {
          this.phase = 'serve';
          this.phaseTime = 0;
        }
        break;
      case 'serve':
        if (this.phaseTime > 0.5) this.serve();
        break;
      case 'drain':
        if (this.phaseTime < 0.7) break;
        if (!this.bonusQueued) {
          // Count the tickets off on the motor, one lamp per thousand.
          this.bonusQueued = true;
          if (!this.tilted) {
            for (let i = 0; i < this.tickets; i++) this.queue.push({ value: 1000, motor: true, ticket: true });
          }
        }
        if (this.queue.length > 0 || !this.reelsSettled()) break;
        if (this.phaseTime < 1.2) break;
        this.nextBall();
        break;
      case 'match':
        if (this.phaseTime > 1.1 && this.matchNumber === null) {
          this.matchNumber = Math.floor(this.rand() * 10) * 10;
          const won = this.score % 100 === this.matchNumber;
          this.emit({ type: 'match', won });
          if (won) this.freeGame();
        }
        if (this.phaseTime > 1.6) {
          this.phase = 'over';
          this.best = Math.max(this.best, this.score);
          this.emit({ type: 'gameOver' });
        }
        break;
    }
  }

  private nextBall(): void {
    this.tickets = 0;
    if (this.extraBall && !this.tilted) {
      this.extraBall = false;
    } else {
      this.ballNumber++;
    }
    this.tilted = false;
    if (this.ballNumber > BALLS_PER_GAME) {
      this.ballNumber = 0;
      this.phase = 'match';
      this.phaseTime = 0;
      this.untilt();
      return;
    }
    this.resetBall();
    this.phase = 'serve';
    this.phaseTime = 0;
  }

  /** The motor is running (a multi-pulse award or the bonus count). */
  motorRunning(): boolean {
    return this.queue.some((p) => p.motor);
  }
}
