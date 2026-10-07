// One fish and how it behaves: cruising its part of the lake, noticing bait,
// coming over to nibble, biting, and bolting when spooked. Once hooked, the
// game moves it.

import type { Hours } from './_daylight';
import type { Layer } from './_pixels';
import { BOOT_ID, bootSprite, fishSprite, pixelLength, randomLength, weightOf, type Species } from './_species';
import type { Water } from './_water';
import { WATER_X0, WATER_X1, bedAt } from './_world';

export type FishState = 'cruise' | 'curious' | 'nibble' | 'bite' | 'flee' | 'hooked' | 'held' | 'thrown' | 'resting';

export interface Bait {
  x: number;
  y: number;
  /** In the water and fishable. */
  active: boolean;
  onBottom: boolean;
  /** Seconds left of a twitch's pull on nearby fish. */
  attract: number;
}

export interface Pond {
  bait: Bait;
  hours: Hours;
  water: Water;
  /** Ask to go for the bait; one fish at a time. */
  claim(fish: Fish): boolean;
  /** Give up the bait without biting. */
  release(fish: Fish): void;
  nibble(fish: Fish): void;
  bite(fish: Fish): void;
  /** The bite went unanswered and the fish let go. */
  letGo(fish: Fish): void;
}

const rand = Math.random;

export class Fish {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  state: FishState = 'cruise';
  cm: number;
  kg: number;
  px: number;
  half: number;
  leader: Fish | null = null;
  cooldown = 0;
  airborne = false;
  private tx = 0;
  private ty = 0;
  private timer = rand();
  private pause = 0;
  private nibbles = 0;
  private side: 1 | -1 = 1;
  private tail = rand() * 6;
  private fleeX = 0;
  private sparkTimer = 0;

  constructor(
    readonly sp: Species,
    cm = randomLength(sp),
  ) {
    this.cm = cm;
    this.kg = weightOf(sp, cm);
    this.px = sp.id === BOOT_ID ? 8 : pixelLength(cm);
    this.half = Math.max(2, Math.round((this.px * sp.depth) / 2) + 1);
    this.pickTarget();
    this.x = this.tx;
    this.y = this.ty;
    this.facing = rand() < 0.5 ? 1 : -1;
  }

  get mouthX(): number {
    return this.x + this.facing * (this.px / 2);
  }

  get mouthY(): number {
    return this.y;
  }

  /** Deepest the fish's center can go at x, keeping its belly off the bed. */
  floorAt(x: number): number {
    const r = this.px / 2;
    return Math.min(bedAt(x - r), bedAt(x), bedAt(x + r)) - this.half - 1;
  }

  pickTarget(): void {
    const sp = this.sp;
    if (this.leader) {
      this.tx = this.leader.tx + (rand() - 0.5) * 26;
      this.ty = this.leader.ty + (rand() - 0.5) * 10;
    } else {
      this.tx = sp.x0 + rand() * (sp.x1 - sp.x0);
      this.ty = sp.bottom ? this.floorAt(this.tx) - rand() * 5 : sp.y0 + rand() * (sp.y1 - sp.y0);
    }
    this.tx = Math.max(WATER_X0 + this.px, Math.min(WATER_X1 - this.px, this.tx));
    this.ty = Math.max(this.half + 3, Math.min(this.floorAt(this.tx), this.ty));
  }

  flee(fromX: number, seconds: number, cooldown: number): void {
    this.state = 'flee';
    this.fleeX = fromX;
    this.timer = seconds;
    this.cooldown = Math.max(this.cooldown, cooldown);
  }

  private canSee(b: Bait, act: number): boolean {
    const sp = this.sp;
    if (b.x < sp.x0 - 34 || b.x > sp.x1 + 34) return false;
    const range = sp.sense * (0.6 + 0.4 * act) * (b.attract > 0 ? 1.6 : 1);
    if (Math.hypot(b.x - this.mouthX, (b.y - this.y) * 1.5) > range) return false;
    if (sp.bottom) return b.y > bedAt(b.x) - 16;
    return b.y >= sp.y0 - 12 && b.y <= sp.y1 + 14;
  }

  update(dt: number, pond: Pond): void {
    const sp = this.sp;
    if (sp.id === BOOT_ID || this.state === 'hooked' || this.state === 'held') return;
    const act = sp.hours[pond.hours];
    const b = pond.bait;
    this.cooldown -= dt;
    let speed = sp.speed * (0.45 + 0.55 * act);
    let goalX = this.tx;
    let goalY = this.ty;
    let turn = 2.2;

    switch (this.state) {
      case 'thrown': {
        this.vy += 150 * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.vy > 0 && this.y >= pond.water.surfaceAt(this.x)) {
          pond.water.splash(this.x, 0.7);
          this.airborne = false;
          this.flee(this.x - 30, 1.5, 40);
        }
        return;
      }
      case 'cruise': {
        if (this.pause > 0) {
          this.pause -= dt;
          speed *= 0.12;
        } else if (Math.hypot(this.tx - this.x, this.ty - this.y) < 3) {
          this.pause = 0.4 + rand() * 2.6 * (1.2 - act);
          this.pickTarget();
        }
        this.timer -= dt;
        if (this.timer <= 0) {
          this.timer = 0.35 + rand() * 0.3;
          const p = 0.3 * sp.bold * act + (b.attract > 0 ? 0.25 : 0);
          if (this.cooldown <= 0 && b.active && this.canSee(b, act) && rand() < p && pond.claim(this)) {
            this.state = 'curious';
          }
        }
        break;
      }
      case 'curious': {
        if (!b.active) {
          pond.release(this);
          this.flee(b.x, 0.6, 4);
          break;
        }
        this.side = this.x >= b.x ? 1 : -1;
        goalX = b.x + this.side * (this.px / 2 + 1);
        goalY = b.y;
        speed = sp.speed * (sp.nibbles[1] === 0 ? 1.1 : 0.6);
        turn = 3;
        if (Math.hypot(goalX - this.x, goalY - this.y) < 1.5) {
          this.state = 'nibble';
          this.nibbles = sp.nibbles[0] + Math.floor(rand() * (sp.nibbles[1] - sp.nibbles[0] + 1));
          this.timer = 0.3 + rand() * 0.6;
          if (this.nibbles === 0) this.startBite(pond);
        }
        break;
      }
      case 'nibble': {
        goalX = b.x + this.side * (this.px / 2 + 1);
        goalY = b.y;
        speed = 6;
        turn = 6;
        if (!b.active || Math.hypot(goalX - this.x, goalY - this.y) > 5) {
          this.state = 'curious';
          break;
        }
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.nibbles > 0) {
            this.nibbles--;
            this.vx -= this.side * 10;
            pond.nibble(this);
            this.timer = 0.45 + rand() * 0.9;
          } else if (rand() < Math.min(0.95, Math.max(0.3, sp.bold * act + 0.25))) {
            this.startBite(pond);
          } else {
            pond.release(this);
            this.flee(b.x, 1, 8);
          }
        }
        break;
      }
      case 'bite': {
        // Backs off with the bait, a little deeper, dragging the float under.
        goalX = this.x + this.side * 12;
        goalY = Math.min(this.floorAt(this.x), this.y + 3);
        speed = 5;
        this.timer -= dt;
        if (this.timer <= 0) pond.letGo(this);
        break;
      }
      case 'flee': {
        const away = this.x >= this.fleeX ? 1 : -1;
        goalX = this.x + away * 30;
        goalY = this.y + 4;
        speed = sp.speed * 2.2;
        turn = 4;
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'cruise';
          this.pickTarget();
        }
        break;
      }
      case 'resting':
        break;
    }

    const dx = goalX - this.x;
    const dy = goalY - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, turn * dt);
    const want = Math.min(speed, d * 3);
    this.vx += ((dx / d) * want - this.vx) * k;
    this.vy += ((dy / d) * want * 0.7 - this.vy) * k;
    this.move(dt, pond.water);
    if (this.state === 'curious' || this.state === 'nibble' || this.state === 'bite') this.facing = this.side === 1 ? -1 : 1;
    else if (Math.abs(this.vx) > 0.6) this.facing = this.vx > 0 ? 1 : -1;

    // At night the plankton show where fish swim.
    this.sparkTimer -= dt * Math.hypot(this.vx, this.vy);
    if (this.sparkTimer <= 0) {
      this.sparkTimer = 14;
      pond.water.disturb(this.x - this.facing * (this.px / 2), this.y, 1.4);
    }
  }

  /** A twitch while it nibbles: half the time it takes the bait, else it bolts. */
  provoke(pond: Pond): void {
    if (this.state !== 'nibble') return;
    if (rand() < 0.5) this.startBite(pond);
    else {
      pond.release(this);
      this.flee(pond.bait.x, 1, 10);
    }
  }

  private startBite(pond: Pond): void {
    this.state = 'bite';
    this.timer = this.sp.window;
    pond.bite(this);
  }

  /** Move by velocity, kept inside the water. */
  move(dt: number, water: Water): void {
    this.tail += dt * (3 + Math.hypot(this.vx, this.vy) * 0.6);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x = Math.max(WATER_X0 + this.px * 0.6, Math.min(WATER_X1 - this.px * 0.6, this.x));
    if (this.airborne) return;
    const top = water.surfaceAt(this.x) + this.half + 1;
    const floor = this.floorAt(this.x);
    if (this.y < top) {
      this.y = top;
      this.vy = Math.max(0, this.vy);
    }
    if (this.y > floor) {
      this.y = Math.max(top, floor);
      this.vy = Math.min(0, this.vy);
    }
  }

  draw(layer: Layer): void {
    if (this.sp.id === BOOT_ID) {
      const s = bootSprite();
      layer.blit(s, this.x - s.w / 2, this.y - s.h / 2);
      return;
    }
    const swimming = this.state !== 'held' && this.state !== 'resting';
    const frame: 0 | 1 = swimming && Math.sin(this.tail) > 0 ? 1 : 0;
    const s = fishSprite(this.sp, this.px, frame);
    layer.blit(s, this.x - s.w / 2, this.y - s.h / 2, this.facing === -1);
  }
}
