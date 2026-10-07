// The game: one rod, one float, and the lake's fish. A press and a release
// drive everything. Hold and let go to cast; tap to twitch; hold to reel in;
// strike when the float goes under; then reel while the fish rests and let go
// while it runs, until it comes to the dock.

import { Angler } from './_angler';
import { hoursAt, type Hours } from './_daylight';
import { Fight } from './_fight';
import { Fish, type Bait, type Pond } from './_fish';
import { Rope } from './_line';
import { Layer, rgb } from './_pixels';
import { BOOT_SPECIES, SPECIES } from './_species';
import { Water } from './_water';
import { BOOT_X, DOCK_X1, PX_PER_FT, WATER_X1, bedAt } from './_world';

export type GameState = 'ready' | 'charge' | 'flight' | 'wait' | 'hooked' | 'landing' | 'card' | 'snapped';

export type GameEvent =
  | { type: 'cast'; power: number }
  | { type: 'plop' }
  | { type: 'splash'; size: number }
  | { type: 'nibble' }
  | { type: 'bite' }
  | { type: 'strike' }
  | { type: 'miss' }
  | { type: 'snap' }
  | { type: 'lost' }
  | { type: 'jump' }
  | { type: 'land'; fish: Fish }
  | { type: 'release' }
  | { type: 'twitch' };

/** Seconds: a shorter press is a tap, a longer one a hold. */
const TAP = 0.22;
/** Line reeled in per second, in pixels. */
const REEL_SPEED = 22;
const GRAVITY = 150;
export const MIN_DEPTH_FT = 1;
export const MAX_DEPTH_FT = 10;

const LINE = rgb(0xe8f1f4);
const LINE_UNDER = rgb(0xcfe3ea, 200);
const FLOAT_RED = rgb(0xe5413a);
const FLOAT_RED_DARK = rgb(0xb22d28);
const FLOAT_WHITE = rgb(0xf4f1ea);
const WORM = rgb(0xe48a9a);
const WORM_DARK = rgb(0xb8616f);
const HOOK = rgb(0xb8bec7);
const METER_FRAME = rgb(0x1d2230);
const METER_EMPTY = rgb(0x3a4256);
const GREEN = rgb(0x6cd06a);
const YELLOW = rgb(0xf2d14b);
const RED = rgb(0xe8574b);

const rand = Math.random;
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);

export class Game implements Pond {
  state: GameState = 'ready';
  readonly water = new Water();
  readonly angler = new Angler();
  readonly rope = new Rope();
  readonly fish: Fish[] = [];
  readonly boot: Fish;
  hours: Hours = 'day';
  depthFt = 3;
  power = 0;
  tension = 0;
  /** The fish (or boot) on the card. */
  catch: Fish | null = null;
  message = '';
  reeling = false;
  /** Line slipping off the reel under a run. */
  dragging = false;
  readonly float = { x: 0, y: 0, vx: 0, vy: 0 };
  readonly hook = { x: 0, y: 0 };
  readonly bait: Bait = { x: 0, y: 0, active: false, onBottom: false, attract: 0 };
  tipX = 0;
  tipY = 0;

  private time = 0;
  private pressed = false;
  private pressAt = 0;
  /** The current press already did something (struck, cast, released). */
  private spent = false;
  private chargeT = 0;
  private engaged: Fish | null = null;
  private hooked: Fish | null = null;
  private fight: Fight | null = null;
  private line = 0;
  private timer = 0;
  private messageTimer = 0;
  private dip = 0;
  private dipTimer = 0;
  private snag = 0;
  private bootTimer = 0;
  private landFrom = { x: 0, y: 0 };
  private listeners: ((e: GameEvent) => void)[] = [];

  constructor() {
    for (const sp of SPECIES) {
      let leader: Fish | null = null;
      for (let i = 0; i < sp.count; i++) {
        const f = new Fish(sp);
        if (sp.school) {
          if (leader) f.leader = leader;
          else leader = f;
        }
        this.fish.push(f);
      }
    }
    this.boot = new Fish(BOOT_SPECIES);
    this.restBoot();
    [this.tipX, this.tipY] = this.angler.straightTip();
    this.resetRig();
  }

  on(listener: (e: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(e: GameEvent): void {
    for (const l of this.listeners) l(e);
  }

  private say(text: string, seconds = 2.2): void {
    this.message = text;
    this.messageTimer = seconds;
  }

  get depthPx(): number {
    return this.depthFt * PX_PER_FT;
  }

  setDepth(ft: number): void {
    this.depthFt = Math.max(MIN_DEPTH_FT, Math.min(MAX_DEPTH_FT, Math.round(ft)));
  }

  get canSetDepth(): boolean {
    return this.state === 'ready' || this.state === 'charge' || this.state === 'wait' || this.state === 'flight';
  }

  /** What the page shows: the state, with a bite called out. */
  get uiState(): string {
    if (this.state === 'wait' && this.engaged?.state === 'bite') return 'bite';
    return this.state;
  }

  get hint(): string {
    if (this.message) return this.message;
    switch (this.state) {
      case 'ready':
        return 'Hold to cast';
      case 'charge':
        return 'Let go to cast';
      case 'wait':
        if (this.engaged?.state === 'bite') return 'Strike!';
        if (this.engaged?.state === 'nibble') return 'A nibble. Wait for it…';
        if (this.reeling) return 'Reeling in';
        return 'Wait for a bite. Tap to twitch, hold to reel in';
      case 'hooked':
        if (this.fight && this.fight.tension > 0.95) return 'Let go! The line is straining';
        return 'Hold to reel. Let go when it runs';
      default:
        return '';
    }
  }

  /** Where the camera should look: the float, the fish, or the dock. */
  get focusX(): number {
    if (this.state === 'flight' || this.state === 'wait') return this.float.x;
    if (this.state === 'hooked' && this.hooked) return this.hooked.x;
    return this.angler.x;
  }

  // ---- input ---------------------------------------------------------------

  pressDown(): void {
    if (this.pressed) return;
    this.pressed = true;
    this.pressAt = this.time;
    this.spent = false;
    switch (this.state) {
      case 'ready':
        this.state = 'charge';
        this.chargeT = 0;
        this.power = 0;
        this.angler.target = 2.25;
        this.angler.speed = 8;
        this.spent = true;
        break;
      case 'wait': {
        const e = this.engaged;
        if (e && e.state === 'bite') {
          this.strike(e);
          this.spent = true;
        } else if (e && e.state === 'nibble') {
          this.release(e);
          e.flee(this.hook.x, 1.2, 15);
          this.hook.y -= 4;
          this.water.push(this.float.x, 1, 10);
          this.emit({ type: 'miss' });
          this.say('Too soon. It got away.');
          this.spent = true;
        }
        break;
      }
      case 'hooked':
        this.reeling = true;
        break;
      case 'card':
        this.releaseCatch();
        this.spent = true;
        break;
    }
  }

  pressUp(): void {
    if (!this.pressed) return;
    this.pressed = false;
    const held = this.time - this.pressAt;
    switch (this.state) {
      case 'charge':
        this.cast();
        break;
      case 'wait':
        if (this.reeling) this.reeling = false;
        else if (!this.spent && held < TAP) this.twitch();
        break;
      case 'hooked':
        this.reeling = false;
        break;
    }
  }

  // ---- the pond, as the fish see it -------------------------------------------

  claim(fish: Fish): boolean {
    if (this.engaged || this.state !== 'wait' || this.reeling) return false;
    this.engaged = fish;
    return true;
  }

  release(fish: Fish): void {
    if (this.engaged === fish) this.engaged = null;
  }

  nibble(): void {
    this.dip = 1.6;
    this.dipTimer = 0.16;
    this.water.push(this.float.x, 1, 5);
    this.water.disturb(this.float.x, this.float.y + 1, 3);
    this.emit({ type: 'nibble' });
  }

  bite(fish: Fish): void {
    this.dip = fish === this.boot ? 3.5 : 5;
    this.dipTimer = fish === this.boot ? 2.4 : fish.sp.window;
    this.water.push(this.float.x, 2, 16);
    this.water.disturb(this.float.x, this.float.y + 2, 8);
    for (let i = 0; i < 3; i++) this.water.bubble(this.hook.x + (rand() - 0.5) * 3, this.hook.y - 1);
    this.emit({ type: 'bite' });
  }

  letGo(fish: Fish): void {
    this.release(fish);
    if (fish === this.boot) {
      this.restBoot();
      this.snag = -20;
      return;
    }
    fish.flee(this.hook.x, 1, 10);
    this.say('Too slow. It let go.');
    this.emit({ type: 'lost' });
  }

  // ---- actions -------------------------------------------------------------

  private restBoot(): void {
    const b = this.boot;
    b.state = 'resting';
    b.facing = 1;
    b.x = BOOT_X;
    b.y = bedAt(BOOT_X) - 2;
  }

  private resetRig(): void {
    if (this.engaged) {
      this.engaged.flee(this.hook.x, 0.8, 3);
      this.engaged = null;
    }
    this.reeling = false;
    this.angler.reeling = false;
    this.float.x = this.tipX + 1;
    this.float.y = this.tipY + 7;
    this.float.vx = this.float.vy = 0;
    this.hook.x = this.float.x;
    this.hook.y = this.float.y + 3;
    this.rope.length = 7;
    this.rope.reset(this.tipX, this.tipY, this.float.x, this.float.y);
    this.bait.active = false;
    this.angler.target = 0.75;
    this.angler.speed = 6;
  }

  private cast(): void {
    const p = this.power;
    this.state = 'flight';
    this.angler.target = 0.35;
    this.angler.speed = 22;
    const speed = 70 + p * 150;
    const a = 0.62;
    this.float.x = this.tipX;
    this.float.y = this.tipY;
    this.float.vx = Math.cos(a) * speed;
    this.float.vy = -Math.sin(a) * speed;
    this.rope.length = 8;
    this.emit({ type: 'cast', power: p });
  }

  private twitch(): void {
    this.float.vx -= 10;
    this.hook.y -= 4;
    this.water.push(this.float.x, 1, 7);
    this.water.disturb(this.hook.x, this.hook.y, 4);
    this.bait.attract = 4;
    this.engaged?.provoke(this);
    this.emit({ type: 'twitch' });
  }

  private strike(e: Fish): void {
    this.engaged = null;
    this.hooked = e;
    e.state = 'hooked';
    this.fight = new Fight(e.sp);
    this.line = dist(this.tipX, this.tipY, e.mouthX, e.mouthY) + 2;
    this.state = 'hooked';
    this.reeling = false;
    this.angler.target = 1.05;
    this.angler.speed = 14;
    this.water.splash(this.float.x, 0.35);
    for (const f of this.fish) {
      if (f !== e && f.state === 'cruise' && dist(f.x, f.y, e.x, e.y) < 30) f.flee(e.x, 0.8, 3);
    }
    this.emit({ type: 'strike' });
  }

  private snapLine(): void {
    const f = this.hooked!;
    f.state = 'cruise';
    f.airborne = false;
    if (f === this.boot) this.restBoot();
    else f.flee(this.tipX, 1.5, 30);
    this.hooked = null;
    this.fight = null;
    this.tension = 0;
    this.reeling = false;
    this.dragging = false;
    this.angler.reeling = false;
    this.state = 'snapped';
    this.timer = 1.6;
    this.rope.length = 12;
    this.angler.target = 0.75;
    this.say('Snap! The line broke.', 1.6);
    this.emit({ type: 'snap' });
  }

  private lose(text: string): void {
    const f = this.hooked!;
    f.state = 'cruise';
    f.airborne = false;
    if (f === this.boot) this.restBoot();
    else f.flee(this.tipX, 1.2, 25);
    this.hooked = null;
    this.fight = null;
    this.tension = 0;
    this.reeling = false;
    this.dragging = false;
    this.angler.reeling = false;
    this.state = 'wait';
    this.float.y = this.water.surfaceAt(this.float.x);
    this.float.vy = -10;
    this.rope.length = dist(this.tipX, this.tipY, this.float.x, this.float.y) * 1.05;
    this.angler.target = 0.55;
    this.say(text);
    this.emit({ type: 'lost' });
  }

  private land(): void {
    const f = this.hooked!;
    this.state = 'landing';
    this.timer = 0.7;
    f.state = 'held';
    f.airborne = false;
    this.catch = f;
    this.landFrom = { x: f.x, y: f.y };
    this.hooked = null;
    this.fight = null;
    this.tension = 0;
    this.reeling = false;
    this.dragging = false;
    this.angler.reeling = false;
    this.angler.lifting = true;
    this.angler.target = 1.35;
    this.water.splash(f.x, 0.6);
  }

  private releaseCatch(): void {
    const f = this.catch;
    this.catch = null;
    this.angler.lifting = false;
    this.state = 'ready';
    if (f) {
      if (f === this.boot) {
        this.water.splash(DOCK_X1 + 8, 0.6);
        this.restBoot();
        this.snag = -30;
      } else {
        const [hx, hy] = this.angler.hand;
        f.x = hx + f.px / 2;
        f.y = hy;
        f.vx = 45;
        f.vy = -40;
        f.airborne = true;
        f.state = 'thrown';
      }
    }
    [this.tipX, this.tipY] = this.angler.straightTip();
    this.resetRig();
    this.emit({ type: 'release' });
  }

  // ---- simulation ------------------------------------------------------------

  update(dt: number, hour: number): void {
    this.time += dt;
    this.hours = hoursAt(hour);
    this.water.step(dt);
    this.angler.update(dt);
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message = '';
    }
    this.bait.attract = Math.max(0, this.bait.attract - dt);

    const target = this.lineTarget();
    [this.tipX, this.tipY] = this.angler.tip(target[0], target[1], this.tension);

    switch (this.state) {
      case 'ready':
        this.hang();
        break;
      case 'charge':
        this.chargeT += dt;
        this.power = this.chargeT < 0.25 ? 0 : 0.5 - 0.5 * Math.cos(((this.chargeT - 0.25) * Math.PI * 2) / 1.5);
        this.hang();
        break;
      case 'flight':
        this.flight(dt);
        break;
      case 'wait':
        this.waitStep(dt);
        break;
      case 'hooked':
        this.fightStep(dt);
        break;
      case 'landing': {
        this.timer -= dt;
        const f = this.catch!;
        const t = 1 - Math.max(0, this.timer) / 0.7;
        const e = 1 - (1 - t) * (1 - t);
        const [hx, hy] = this.heldAt(f);
        f.x = this.landFrom.x + (hx - this.landFrom.x) * e;
        f.y = this.landFrom.y + (hy - this.landFrom.y) * e - Math.sin(Math.PI * t) * 10;
        f.facing = 1;
        if (this.timer <= 0) {
          this.state = 'card';
          this.emit({ type: 'land', fish: f });
        }
        break;
      }
      case 'card': {
        const f = this.catch!;
        [f.x, f.y] = this.heldAt(f);
        break;
      }
      case 'snapped':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'ready';
          this.resetRig();
        }
        break;
    }

    for (const f of this.fish) f.update(dt, this);

    const [ex, ey] = this.lineEnd();
    this.rope.step(dt, this.tipX, this.tipY, ex, ey, (x) => this.water.surfaceAt(x));
  }

  private heldAt(f: Fish): [number, number] {
    const [hx, hy] = this.angler.hand;
    return [hx + f.px / 2 + 1, hy + 1];
  }

  private lineTarget(): [number, number] {
    if (this.state === 'hooked' && this.hooked) return [this.hooked.mouthX, this.hooked.mouthY];
    return [this.float.x, this.float.y];
  }

  private lineEnd(): [number, number] {
    if (this.state === 'snapped') return [this.tipX + 2, this.tipY + 12];
    if ((this.state === 'landing' || this.state === 'card') && this.catch) {
      const f = this.catch;
      this.rope.length = dist(this.tipX, this.tipY, f.mouthX, f.mouthY) * 1.1 + 2;
      return [f.mouthX, f.mouthY];
    }
    return [this.float.x, this.float.y];
  }

  /** The float hangs from the rod tip on a short line. */
  private hang(): void {
    this.rope.length = 7;
    this.float.x = this.tipX + 1;
    this.float.y = this.tipY + 7;
    this.hook.x = this.float.x;
    this.hook.y = this.float.y + 3;
    this.bait.active = false;
  }

  private flight(dt: number): void {
    const f = this.float;
    f.vy += GRAVITY * dt;
    f.vx *= 1 - 0.15 * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.x = Math.min(WATER_X1 - 6, f.x);
    this.rope.length = Math.max(this.rope.length, dist(this.tipX, this.tipY, f.x, f.y) * 1.04);
    this.hook.x = f.x - 2;
    this.hook.y = f.y + 2;
    if (f.vy > 0 && f.y >= this.water.surfaceAt(f.x)) {
      this.water.splash(f.x, 0.5);
      for (let i = 0; i < 4; i++) this.water.bubble(f.x + (rand() - 0.5) * 4, f.y + 2 + rand() * 3);
      this.state = 'wait';
      f.vx = 0;
      f.vy *= 0.2;
      this.hook.x = f.x;
      this.hook.y = f.y + 1;
      this.rope.length = dist(this.tipX, this.tipY, f.x, f.y) * 1.03;
      this.angler.target = 0.55;
      this.angler.speed = 6;
      this.emit({ type: 'plop' });
    }
  }

  private waitStep(dt: number): void {
    const { water, float: f, hook: h } = this;
    if (this.pressed && !this.spent && this.time - this.pressAt > TAP) this.reeling = true;
    this.angler.reeling = this.reeling;
    const out = dist(this.tipX, this.tipY, this.float.x, this.float.y);
    if (this.reeling) this.rope.length -= REEL_SPEED * dt;
    // Take up slack, the way an angler does after the cast settles.
    else if (this.rope.length > out + 3) this.rope.length = Math.max(out + 3, this.rope.length - 10 * dt);

    // The float rides the surface, pulled down by a nibble or a bite, and
    // tethered above the bait.
    const e = this.engaged;
    if (this.dipTimer > 0) {
      this.dipTimer -= dt;
      if (this.dipTimer <= 0) this.dip = 0;
    }
    const surf = water.surfaceAt(f.x);
    let goal = surf + this.dip;
    if (e && e.state === 'bite') goal = Math.max(goal, h.y - this.depthPx);
    f.vy += ((goal - f.y) * 70 - f.vy * 9) * dt;
    f.y += f.vy * dt;
    let pullX = water.wind * 0.6 - f.vx;
    if (e && e.state === 'bite') pullX += (h.x - f.x) * 2;
    f.vx += pullX * 0.8 * dt;
    f.x += f.vx * dt;

    // The line can't stretch: a short line drags the float toward the dock.
    const dy = f.y - this.tipY;
    const L = Math.max(this.rope.length, Math.abs(dy) + 1);
    this.rope.length = L;
    if (dist(this.tipX, this.tipY, f.x, f.y) > L) {
      const nx = this.tipX + Math.sqrt(Math.max(0, L * L - dy * dy));
      if (this.reeling) water.push(f.x, 1, Math.min(3, (f.x - nx) * 4));
      f.x = nx;
      f.vx = Math.min(0, f.vx);
    }

    // The bait hangs below the float, unless a fish has it.
    if (e && e.state === 'bite') {
      h.x = e.mouthX;
      h.y = e.mouthY;
    } else {
      const floor = bedAt(h.x) - 1;
      const ty = Math.min(f.y + this.depthPx, floor);
      h.x += (f.x - h.x) * Math.min(1, 1.6 * dt);
      h.y += Math.max(-36 * dt, Math.min(18 * dt, ty - h.y));
      h.y = Math.min(h.y, floor);
    }
    const inWater = h.y > water.surfaceAt(h.x) + 1;
    this.bait.x = h.x;
    this.bait.y = h.y;
    this.bait.active = inWater && !this.reeling;
    this.bait.onBottom = h.y >= bedAt(h.x) - 1.5;
    this.tension = this.reeling ? 0.15 : 0.03;

    // Rest the bait by the old boot long enough and it snags.
    if (!e && this.bait.onBottom && Math.abs(h.x - BOOT_X) < 7 && !this.reeling) {
      this.snag += dt;
      if (this.snag > 3 && rand() < dt * 0.35) {
        this.engaged = this.boot;
        this.boot.state = 'bite';
        this.bootTimer = 2.4;
        this.bite(this.boot);
      }
    } else if (this.snag > 0) this.snag = 0;
    else this.snag = Math.min(0, this.snag + dt);
    if (this.engaged === this.boot) {
      this.bootTimer -= dt;
      if (this.bootTimer <= 0) this.letGo(this.boot);
    }

    if (f.x < DOCK_X1 + 6 || this.rope.length < Math.abs(dy) + 3) {
      this.state = 'ready';
      this.resetRig();
    }
  }

  private fightStep(dt: number): void {
    const fish = this.hooked!;
    const fight = this.fight!;
    const { water } = this;
    const isBoot = fish === this.boot;
    this.angler.reeling = this.reeling;

    let d = dist(this.tipX, this.tipY, fish.mouthX, fish.mouthY);
    const result = fight.step(dt, this.reeling, this.line - d > 5);
    this.tension = fight.tension;
    if (result === 'snap') return this.snapLine();
    if (result === 'slack') return this.lose('It threw the hook.');

    this.dragging = false;
    if (this.reeling) {
      this.line -= REEL_SPEED * dt * (fight.running ? 0.35 : 1);
      if (fight.tension > 0.9) {
        this.line += (fight.tension - 0.9) * 60 * dt;
        this.dragging = true;
      }
    }

    if (!fish.airborne) {
      const run = fight.running && !isBoot;
      const sp = fish.sp;
      const speed = isBoot ? 0 : (8 + 26 * sp.power) * (0.4 + 0.6 * fight.stamina) * (run ? 1 : 0.25);
      const k = Math.min(1, 3 * dt);
      fish.vx += (Math.cos(fight.heading) * speed - fish.vx) * k;
      fish.vy += (Math.sin(fight.heading) * speed * 0.6 - fish.vy) * k;
      if (!run) fish.vx += (-4 - fish.vx) * dt;
      fish.facing = run && Math.cos(fight.heading) >= 0 ? 1 : -1;
      if (isBoot) fish.facing = 1;
      fish.move(dt, water);
      if (sp.jumps && run && fish.y < water.surfaceAt(fish.x) + fish.half + 10 && rand() < dt * 0.6) {
        fish.airborne = true;
        fish.vy = -55 - 25 * rand();
        fish.vx = 18 * fish.facing;
        water.splash(fish.x, 0.8, fish.facing);
        this.emit({ type: 'jump' });
      }
    } else {
      fish.vy += GRAVITY * dt;
      fish.x += fish.vx * dt;
      fish.y += fish.vy * dt;
      if (fish.vy > 0 && fish.y >= water.surfaceAt(fish.x)) {
        fish.airborne = false;
        water.splash(fish.x, 0.9);
        this.emit({ type: 'splash', size: 0.9 });
        if (rand() < (fight.tension < 0.3 ? 0.25 : 0.08)) return this.lose('It shook the hook in the air.');
      }
    }

    // A free reel pays line out to a running fish; a short line pulls it in.
    d = dist(this.tipX, this.tipY, fish.mouthX, fish.mouthY);
    if (!this.reeling) {
      if (d > this.line && fight.running) this.dragging = true;
      this.line = Math.max(this.line, d);
    }
    this.line = Math.max(12, this.line);
    if (d > this.line) {
      const k = this.line / d;
      const mx = this.tipX + (fish.mouthX - this.tipX) * k;
      const my = this.tipY + (fish.mouthY - this.tipY) * k;
      fish.x += mx - fish.mouthX;
      if (!fish.airborne) fish.y += my - fish.mouthY;
      fish.move(0, water);
    }

    this.float.x = fish.mouthX;
    this.float.y = Math.max(water.surfaceAt(this.float.x), fish.mouthY - this.depthPx);
    this.hook.x = fish.mouthX;
    this.hook.y = fish.mouthY;
    this.rope.length = Math.max(dist(this.tipX, this.tipY, this.float.x, this.float.y), this.line - this.depthPx);
    if (!isBoot) water.disturb(fish.x, fish.y, fight.running ? 1.2 : 0.4);
    if (rand() < dt * 1.5) water.bubble(fish.mouthX, fish.y - fish.half);

    if (!fish.airborne && fish.mouthX - this.tipX < 8 && fish.y < water.surfaceAt(fish.x) + 14) this.land();
  }

  // ---- drawing -------------------------------------------------------------

  /** The fish and the boot, drawn before the dock. */
  drawFish(layer: Layer): void {
    if (this.boot.state === 'resting' || this.boot.state === 'bite') this.boot.draw(layer);
    for (const f of this.fish) if (f.state !== 'held' && f !== this.hooked) f.draw(layer);
    if (this.hooked && !this.hooked.airborne) this.hooked.draw(layer);
  }

  /** The angler, line, float, a jumping or held fish, and the meters. */
  drawRig(layer: Layer, glow: Layer, night: number): void {
    this.angler.draw(layer, this.tipX, this.tipY);
    this.rope.draw(layer, LINE);

    const f = this.float;
    const showFloat = this.state !== 'snapped' && this.state !== 'landing' && this.state !== 'card';
    if (showFloat) {
      const bitten = this.state === 'hooked' || this.engaged?.state === 'bite';
      if (this.state !== 'hooked') layer.line(f.x, f.y + 2, this.hook.x, this.hook.y, LINE_UNDER);
      else if (this.hooked) layer.line(f.x, f.y + 2, this.hooked.mouthX, this.hooked.mouthY, LINE_UNDER);
      layer.set(f.x, f.y - 3, FLOAT_RED_DARK);
      layer.rect(f.x - 1, f.y - 2, 3, 2, FLOAT_RED);
      layer.rect(f.x - 1, f.y, 3, 1, FLOAT_WHITE);
      layer.set(f.x, f.y + 1, FLOAT_WHITE);
      if (night > 0.3) glow.add(f.x, f.y - 3, 0x9cff6a, night * (bitten ? 1 : 0.8));
      if (this.state !== 'hooked' && !(this.engaged?.state === 'bite')) {
        layer.set(this.hook.x, this.hook.y, WORM);
        layer.set(this.hook.x, this.hook.y + 1, WORM_DARK);
        layer.set(this.hook.x + 1, this.hook.y + 1, HOOK);
      }
    }

    if (this.hooked?.airborne) this.hooked.draw(layer);
    if ((this.state === 'landing' || this.state === 'card') && this.catch) this.catch.draw(layer);

    const mx = this.angler.x - 4;
    const my = this.angler.top - 6;
    if (this.state === 'charge') this.meter(layer, mx, my, this.power, this.power > 0.85 ? RED : this.power > 0.55 ? YELLOW : GREEN);
    if (this.state === 'hooked' && this.fight) {
      const t = this.fight.tension;
      const blink = this.fight.strain > 0.35 && Math.floor(this.time * 10) % 2 === 0;
      this.meter(layer, mx, my, Math.min(1, t / 1.25), blink ? FLOAT_WHITE : t >= 1 ? RED : t > 0.72 ? YELLOW : GREEN);
      // The limit, marked.
      layer.set(mx + 1 + Math.round(15 * 0.8), my - 1, METER_FRAME);
    }
  }

  private meter(layer: Layer, x: number, y: number, value: number, color: number): void {
    layer.rect(x, y, 17, 4, METER_FRAME);
    layer.rect(x + 1, y + 1, 15, 2, METER_EMPTY);
    layer.rect(x + 1, y + 1, Math.round(15 * Math.max(0, Math.min(1, value))), 2, color);
  }
}
