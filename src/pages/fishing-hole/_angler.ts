// The angler at the end of the dock, and the rod: a quadratic curve from the
// hand that bends toward the line as tension rises.

import { Layer, rgb, sprite, type Sprite } from './_pixels';
import { ANGLER_X, DECK_Y } from './_world';

const BODY: Sprite = sprite(
  [
    '..HHH...',
    '.HhHHHH.',
    '..SSSs..',
    '..SSES..',
    '..sSS...',
    '.CCCCC..',
    '.CcCCc..',
    '.CCcCC..',
    '.cCCCC..',
    '..PPPP..',
    '..PP.PP.',
    '..PP.PP.',
    '..BB.BB.',
  ],
  {
    H: 0xd9b45a,
    h: 0xa8873e,
    S: 0xe3a47c,
    s: 0xc4835e,
    E: 0x2a1d1a,
    C: 0xc4453a,
    c: 0x8f2c2a,
    P: 0x3b5079,
    B: 0x3a2a20,
  },
);

const SLEEVE = rgb(0xc4453a);
const HAND = rgb(0xe3a47c);
const CORK = rgb(0xc9a26b);
const BLANK = rgb(0x3b2c24);
const BLANK_TIP = rgb(0x6a5546);
const REEL = rgb(0x9aa2ab);

const ROD_LENGTH = 24;

export class Angler {
  readonly x = ANGLER_X - 3;
  readonly top = DECK_Y - BODY.h;
  /** Rod angle in radians above the horizontal, toward the water. */
  angle = 0.75;
  target = 0.75;
  /** How fast the rod swings toward its target, per second. */
  speed = 10;
  reelPhase = 0;
  reeling = false;
  /** Raise the arms, for holding up a catch. */
  lifting = false;

  get shoulder(): [number, number] {
    return [this.x + 5, this.top + 5];
  }

  get hand(): [number, number] {
    if (this.lifting) return [this.x + 7, this.top + 2];
    const wind = this.reeling ? Math.round(Math.sin(this.reelPhase)) : 0;
    return [this.x + 7, this.top + 7 + wind];
  }

  update(dt: number): void {
    this.angle += (this.target - this.angle) * Math.min(1, this.speed * dt);
    if (this.reeling) this.reelPhase += dt * 16;
  }

  /** The rod's straight tip, before any bend. */
  straightTip(): [number, number] {
    const [hx, hy] = this.hand;
    return [hx + Math.cos(this.angle) * ROD_LENGTH, hy - Math.sin(this.angle) * ROD_LENGTH];
  }

  /**
   * Draw the angler and rod. The tip bends toward (lx, ly) by tension (0 to 1+).
   * Returns the bent tip, where the line starts.
   */
  draw(layer: Layer, lx: number, ly: number, tension: number): [number, number] {
    layer.blit(BODY, this.x, this.top);
    const [hx, hy] = this.hand;
    const [sx, sy] = this.shoulder;
    layer.line(sx, sy, hx - 1, hy, SLEEVE);
    layer.set(hx, hy, HAND);

    const dx = Math.cos(this.angle);
    const dy = -Math.sin(this.angle);
    let [tx, ty] = [hx + dx * ROD_LENGTH, hy + dy * ROD_LENGTH];
    // Bend: the tip is pulled toward the line, and droops a little anyway.
    const ux = lx - tx;
    const uy = ly - ty;
    const len = Math.hypot(ux, uy) || 1;
    const bend = Math.min(1.3, Math.max(0, tension)) * 8;
    tx += (ux / len) * bend;
    ty += (uy / len) * bend + 1;
    const cx = hx + dx * ROD_LENGTH * 0.55;
    const cy = hy + dy * ROD_LENGTH * 0.55;

    const steps = 30;
    let px = hx;
    let py = hy;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      const x = a * hx + b * cx + c * tx;
      const y = a * hy + b * cy + c * ty;
      layer.line(px, py, x, y, t < 0.16 ? CORK : t > 0.8 ? BLANK_TIP : BLANK);
      px = x;
      py = y;
    }
    layer.set(hx + Math.round(dx * 3), hy + Math.round(dy * 3) + 1, REEL);
    return [tx, ty];
  }
}
