// Ball physics for a pinball playfield, in millimetres and seconds.
//
// The playfield is a plane tilted 6.5 degrees toward the player; +y runs down the slope. The ball is a 27 mm
// steel ball that rolls, so gravity along the slope is (5/7) g sin(6.5 deg). Everything it can hit is a capsule
// (a segment with a radius), a circle, or a flipper (a tapered capsule turning about its pivot). The step is a
// fixed 1/1000 s: at the ball's top speed of about 6 m/s that is 6 mm per step, well under the ball's radius,
// so nothing can be skipped through.

export const BALL_R = 13.5;
const SLOPE = (6.5 * Math.PI) / 180;
export const GRAVITY = (5 / 7) * 9810 * Math.sin(SLOPE);
export const STEP = 1 / 1000;
const MAX_SPEED = 6800;
/** Rolling losses, per second. */
const ROLL_DAMP = 0.1;
/** Below this approach speed a contact doesn't bounce, so the ball slides along rails and rests on flippers. */
const REST_SPEED = 220;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rolling angle, for drawing the ball's spin. */
  spin: number;
  /** False while held in a saucer, in the trough, or drained. */
  live: boolean;
}

export interface Hit {
  id: string;
  /** Approach speed along the contact normal, mm/s. */
  speed: number;
  nx: number;
  ny: number;
}

interface Base {
  id: string;
  /** Coefficient of restitution. */
  e: number;
  /** Friction along the surface, as a fraction of the normal impulse. */
  f: number;
  on: boolean;
  /** A kicker drives the ball off at this speed along the normal when struck at least `kickMin` mm/s. */
  kick?: number;
  kickMin?: number;
  /** One-way: collide only while the ball is on this side (a unit normal). */
  oneWay?: { x: number; y: number };
}

export interface Seg extends Base {
  kind: 'seg';
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
}

export interface Disc extends Base {
  kind: 'disc';
  x: number;
  y: number;
  r: number;
}

export type Shape = Seg | Disc;

export interface Flipper {
  id: string;
  px: number;
  py: number;
  /** Centre-to-centre length, and radii at the pivot and the tip. */
  len: number;
  rb: number;
  rt: number;
  rest: number;
  up: number;
  angle: number;
  omega: number;
  held: boolean;
  /** Power off (tilt, game over): the flipper falls back and won't rise. */
  powered: boolean;
}

export const FLIPPER_E = 0.5;
const FLIPPER_F = 0.12;
/** rad/s^2 and rad/s for the stroke up, and the return spring. */
const FLIP_ACCEL = 2600;
const FLIP_SPEED = 70;
const RETURN_SPEED = 24;

export function seg(id: string, ax: number, ay: number, bx: number, by: number, r: number, e: number, f = 0.03): Seg {
  return { kind: 'seg', id, ax, ay, bx, by, r, e, f, on: true };
}

export function disc(id: string, x: number, y: number, r: number, e: number, f = 0.04): Disc {
  return { kind: 'disc', id, x, y, r, e, f, on: true };
}

export function makeFlipper(id: string, px: number, py: number, rest: number, up: number): Flipper {
  return { id, px, py, len: 58, rb: 12.5, rt: 6, rest, up, angle: rest, omega: 0, held: false, powered: true };
}

export function flipperTip(fl: Flipper): { x: number; y: number } {
  return { x: fl.px + Math.cos(fl.angle) * fl.len, y: fl.py + Math.sin(fl.angle) * fl.len };
}

/** Advance a flipper's angle by one step: driven up while held and powered, sprung back otherwise. */
export function stepFlipper(fl: Flipper, dt: number): boolean {
  const dir = Math.sign(fl.up - fl.rest);
  const rising = fl.held && fl.powered;
  const prev = fl.angle;
  if (rising) {
    fl.omega = dir * Math.min(Math.abs(fl.omega) + FLIP_ACCEL * dt, FLIP_SPEED);
    if (Math.sign(fl.omega) !== dir) fl.omega = dir * FLIP_ACCEL * dt;
  } else {
    fl.omega = -dir * RETURN_SPEED;
  }
  fl.angle += fl.omega * dt;
  // Clamp at the stops.
  if (dir * (fl.angle - fl.up) > 0) {
    fl.angle = fl.up;
    fl.omega = 0;
  }
  if (dir * (fl.angle - fl.rest) < 0) {
    fl.angle = fl.rest;
    fl.omega = 0;
  }
  return prev !== fl.angle;
}

interface Contact {
  nx: number;
  ny: number;
  depth: number;
  /** Surface velocity at the contact. */
  sx: number;
  sy: number;
}

function closestOnSeg(s: Seg, x: number, y: number): { cx: number; cy: number } {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((x - s.ax) * dx + (y - s.ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { cx: s.ax + dx * t, cy: s.ay + dy * t };
}

function contactShape(sh: Shape, b: Ball): Contact | null {
  let cx: number;
  let cy: number;
  if (sh.kind === 'seg') {
    const c = closestOnSeg(sh, b.x, b.y);
    cx = c.cx;
    cy = c.cy;
  } else {
    cx = sh.x;
    cy = sh.y;
  }
  const dx = b.x - cx;
  const dy = b.y - cy;
  const reach = BALL_R + sh.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= reach * reach) return null;
  const d = Math.sqrt(d2);
  let nx: number;
  let ny: number;
  if (d > 1e-6) {
    nx = dx / d;
    ny = dy / d;
  } else {
    nx = 0;
    ny = -1;
  }
  if (sh.oneWay && nx * sh.oneWay.x + ny * sh.oneWay.y < 0) return null;
  return { nx, ny, depth: reach - d, sx: 0, sy: 0 };
}

function contactFlipper(fl: Flipper, b: Ball): Contact | null {
  const tx = fl.px + Math.cos(fl.angle) * fl.len;
  const ty = fl.py + Math.sin(fl.angle) * fl.len;
  const dx = tx - fl.px;
  const dy = ty - fl.py;
  let t = ((b.x - fl.px) * dx + (b.y - fl.py) * dy) / (fl.len * fl.len);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = fl.px + dx * t;
  const cy = fl.py + dy * t;
  const r = fl.rb + (fl.rt - fl.rb) * t;
  const ox = b.x - cx;
  const oy = b.y - cy;
  const reach = BALL_R + r;
  const d2 = ox * ox + oy * oy;
  if (d2 >= reach * reach) return null;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = ox / d;
  const ny = oy / d;
  // Velocity of the flipper's surface where the ball touches it: omega x (point - pivot).
  const px = cx + nx * r - fl.px;
  const py = cy + ny * r - fl.py;
  return { nx, ny, depth: reach - d, sx: -fl.omega * py, sy: fl.omega * px };
}

function resolve(b: Ball, c: Contact, e: number, f: number, kick?: number, kickMin?: number): number {
  b.x += c.nx * c.depth;
  b.y += c.ny * c.depth;
  const rvx = b.vx - c.sx;
  const rvy = b.vy - c.sy;
  const vn = rvx * c.nx + rvy * c.ny;
  if (vn >= 0) return 0;
  const approach = -vn;
  if (kick !== undefined && approach >= (kickMin ?? 0)) {
    // A kicker: keep the sliding part and drive the ball off the face at the kick speed.
    const tx = rvx - vn * c.nx;
    const ty = rvy - vn * c.ny;
    b.vx = c.sx + tx * 0.85 + c.nx * kick;
    b.vy = c.sy + ty * 0.85 + c.ny * kick;
    return approach;
  }
  const bounce = approach < REST_SPEED ? 0 : e;
  const jn = (1 + bounce) * approach;
  let nvx = rvx + jn * c.nx;
  let nvy = rvy + jn * c.ny;
  // Friction along the surface, bounded by the tangential speed.
  const tvx = nvx - (nvx * c.nx + nvy * c.ny) * c.nx;
  const tvy = nvy - (nvx * c.nx + nvy * c.ny) * c.ny;
  const tv = Math.hypot(tvx, tvy);
  if (tv > 1e-6) {
    const cut = Math.min(f * jn, tv) / tv;
    nvx -= tvx * cut;
    nvy -= tvy * cut;
  }
  b.vx = nvx + c.sx;
  b.vy = nvy + c.sy;
  return approach;
}

export interface World {
  shapes: Shape[];
  flippers: Flipper[];
}

/** One fixed step for one ball: integrate, then resolve contacts. Returns the hits, with their approach speeds. */
export function stepBall(w: World, b: Ball, dt: number, hits: Hit[]): void {
  b.vy += GRAVITY * dt;
  const damp = 1 - ROLL_DAMP * dt;
  b.vx *= damp;
  b.vy *= damp;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > MAX_SPEED) {
    b.vx *= MAX_SPEED / sp;
    b.vy *= MAX_SPEED / sp;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.spin += (sp * dt) / BALL_R;

  // Two passes settle a ball wedged between two shapes (a post and a rail).
  for (let pass = 0; pass < 2; pass++) {
    for (const sh of w.shapes) {
      if (!sh.on) continue;
      const c = contactShape(sh, b);
      if (!c) continue;
      const speed = resolve(b, c, sh.e, sh.f, sh.kick, sh.kickMin);
      if (speed > 0 && pass === 0) hits.push({ id: sh.id, speed, nx: c.nx, ny: c.ny });
    }
    for (const fl of w.flippers) {
      const c = contactFlipper(fl, b);
      if (!c) continue;
      const speed = resolve(b, c, FLIPPER_E, FLIPPER_F);
      if (speed > 0 && pass === 0) hits.push({ id: fl.id, speed, nx: c.nx, ny: c.ny });
    }
  }
}

/** Which side of a directed line a point is on: positive to the right of a->b in screen coordinates. */
export function side(ax: number, ay: number, bx: number, by: number, x: number, y: number): number {
  return (bx - ax) * (y - ay) - (by - ay) * (x - ax);
}

/** Whether the ball's centre crossed segment a-b between two positions. */
export function crossed(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const s0 = side(ax, ay, bx, by, x0, y0);
  const s1 = side(ax, ay, bx, by, x1, y1);
  if (s0 === 0 || s0 > 0 === s1 > 0) return false;
  const t0 = side(x0, y0, x1, y1, ax, ay);
  const t1 = side(x0, y0, x1, y1, bx, by);
  return t0 > 0 !== t1 > 0;
}
