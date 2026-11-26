// The user's physics. The world is whatever the browser laid out: every element marked data-solid is a box,
// measured fresh each frame. The user walks along box tops, turns at anything taller than a step, rides
// whatever box they stand on when the layout moves it, and falls off edges. A short fall is fine; a long one
// is a splat.

export const USER = {
  /** Body width and height, in page pixels. */
  w: 16,
  h: 26,
  /** Half-width of the feet: the part that needs something under it. */
  foot: 5,
  /** The tallest ledge they step up without stopping. */
  step: 8,
  /** The longest fall they walk away from. */
  safe: 150,
  speed: 52,
  gravity: 1700,
  vmax: 900,
};

export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface Solid extends Box {
  el: Element;
  /** The unclipped box, for following an element as it moves. */
  raw: Box;
  section: number;
  goal: boolean;
}

export type Mode = 'stand' | 'fall' | 'splat' | 'done';

export interface User {
  /** Centre of the feet. */
  x: number;
  /** Bottom of the feet. */
  y: number;
  dir: 1 | -1;
  vy: number;
  mode: Mode;
  /** Walking is allowed: false at each new section until Go. */
  go: boolean;
  paused: boolean;
  fallFrom: number;
  ground: Element | null;
  groundRaw: Box | null;
  section: number;
}

export type Event =
  | { type: 'land'; height: number; solid: Solid }
  | { type: 'splat'; reason: 'fall' | 'squash' | 'lost'; height: number }
  | { type: 'turn' }
  | { type: 'enter'; section: number }
  | { type: 'goal' };

export interface World {
  solids: Solid[];
  /** The page's width and height; the sides are walls, below the bottom is nothing. */
  width: number;
  height: number;
}

const EPS = 0.5;

export function makeUser(): User {
  return {
    x: 0,
    y: 0,
    dir: 1,
    vy: 0,
    mode: 'stand',
    go: false,
    paused: false,
    fallFrom: 0,
    ground: null,
    groundRaw: null,
    section: 1,
  };
}

const overlaps = (a: Box, b: Box, e = EPS) => a.l < b.r - e && a.r > b.l + e && a.t < b.b - e && a.b > b.t + e;

function body(u: User, x = u.x, y = u.y): Box {
  return { l: x - USER.w / 2, r: x + USER.w / 2, t: y - USER.h, b: y };
}

function underFeet(s: Box, x: number) {
  return s.l < x + USER.foot && s.r > x - USER.foot;
}

/** Follow the ground: if the box under the user moved, so do they. Run once per frame, after measuring. */
export function ride(u: User, world: World) {
  if (!u.ground || !u.groundRaw) return;
  const s = world.solids.find((o) => o.el === u.ground);
  if (!s) {
    u.ground = null;
    u.groundRaw = null;
    return;
  }
  u.x += s.raw.l - u.groundRaw.l;
  u.y += s.raw.t - u.groundRaw.t;
  u.groundRaw = s.raw;
}

/** Push the user out of anything the layout moved into them. Returns false when there was no way out. */
export function resolve(u: User, world: World): boolean {
  for (let pass = 0; pass < 4; pass++) {
    const me = body(u);
    const hit = world.solids.find((s) => overlaps(me, s));
    if (!hit) {
      if (u.x - USER.w / 2 < 0) u.x = USER.w / 2;
      if (u.x + USER.w / 2 > world.width) u.x = world.width - USER.w / 2;
      return true;
    }
    const up = me.b - hit.t;
    const left = me.r - hit.l;
    const right = hit.r - me.l;
    const down = hit.b - me.t;
    if (up <= 16) {
      u.y -= up;
    } else if (Math.min(left, right) <= 12) {
      u.x += left < right ? -left : right;
    } else if (u.mode === 'fall' && down <= 16) {
      u.y += down;
    } else {
      return false;
    }
  }
  return !world.solids.some((s) => overlaps(body(u), s));
}

function support(u: User, world: World): Solid | null {
  let best: Solid | null = null;
  for (const s of world.solids) {
    if (Math.abs(s.t - u.y) <= 1.5 && underFeet(s, u.x)) {
      if (!best || s.t < best.t) best = s;
    }
  }
  return best;
}

function standOn(u: User, s: Solid) {
  u.y = s.t;
  u.ground = s.el;
  u.groundRaw = s.raw;
}

/** One fixed step of the simulation. */
export function step(u: User, world: World, dt: number, out: Event[]) {
  if (u.mode === 'splat' || u.mode === 'done' || u.paused) return;

  if (u.mode === 'stand') {
    const s = support(u, world);
    if (s) {
      standOn(u, s);
      if (s.section > u.section) {
        u.section = s.section;
        out.push({ type: 'enter', section: s.section });
      }
      if (s.goal) {
        u.mode = 'done';
        out.push({ type: 'goal' });
        return;
      }
    } else {
      u.mode = 'fall';
      u.vy = 0;
      u.fallFrom = u.y;
      u.ground = null;
      u.groundRaw = null;
    }
  }

  if (u.mode === 'stand') {
    if (u.go) walk(u, world, dt, out);
    return;
  }

  if (u.mode === 'fall') {
    u.vy = Math.min(u.vy + USER.gravity * dt, USER.vmax);
    const ny = u.y + u.vy * dt;
    let land: Solid | null = null;
    for (const s of world.solids) {
      if (s.t >= u.y - EPS && s.t <= ny && underFeet(s, u.x)) {
        if (!land || s.t < land.t) land = s;
      }
    }
    if (land) {
      const height = land.t - u.fallFrom;
      standOn(u, land);
      u.vy = 0;
      if (height > USER.safe) {
        u.mode = 'splat';
        out.push({ type: 'splat', reason: 'fall', height });
        return;
      }
      u.mode = 'stand';
      out.push({ type: 'land', height, solid: land });
      if (land.section > u.section) {
        u.section = land.section;
        out.push({ type: 'enter', section: land.section });
      }
      if (land.goal) {
        u.mode = 'done';
        out.push({ type: 'goal' });
      }
    } else {
      u.y = ny;
      if (u.y > world.height + 120) {
        u.mode = 'splat';
        out.push({ type: 'splat', reason: 'lost', height: u.y - u.fallFrom });
      }
    }
  }
}

function walk(u: User, world: World, dt: number, out: Event[]) {
  const nx = u.x + u.dir * USER.speed * dt;
  if (nx - USER.w / 2 < 0 || nx + USER.w / 2 > world.width) {
    u.dir = u.dir === 1 ? -1 : 1;
    out.push({ type: 'turn' });
    return;
  }
  const next = body(u, nx);
  let climb = u.y;
  for (const s of world.solids) {
    if (!overlaps(next, s)) continue;
    if (s.t >= u.y - USER.step) {
      climb = Math.min(climb, s.t);
    } else {
      u.dir = u.dir === 1 ? -1 : 1;
      out.push({ type: 'turn' });
      return;
    }
  }
  if (climb < u.y && world.solids.some((s) => overlaps(body(u, nx, climb), s))) {
    u.dir = u.dir === 1 ? -1 : 1;
    out.push({ type: 'turn' });
    return;
  }
  u.x = nx;
  u.y = climb;
}
