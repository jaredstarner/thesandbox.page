// Hill run: the three courses, laid out once from a seed.
//
// World units are metres. y runs downhill (and down the screen), x across the
// slope. Every course is a list of things sorted by y plus a slope profile; the
// luge also carries its track centreline.

export type LevelId = 'bomb' | 'cheese' | 'luge';

export type Effect = 'crash' | 'trip' | 'slow' | 'knock' | 'none';

export interface Move {
  /** Moves along x between from and to, wrapping. */
  from: number;
  to: number;
  /** m/s, signed: negative runs from `to` toward `from`. */
  speed: number;
  /** Metres into the cycle at t = 0. */
  phase: number;
}

export interface Thing {
  kind: string;
  x: number;
  y: number;
  /** Half extents of the footprint: across (x) and along (y). Round things use hw. */
  hw: number;
  hd: number;
  round: boolean;
  /** Height in metres, for drawing. */
  h: number;
  effect: Effect;
  /** 0 to 1, for colour and variant picks. */
  seed: number;
  move?: Move;
  /** Knocked over (a cone) or flattened (by the sweeper). */
  down?: number;
  /** A parked car's door: the side it opens to and when it opened. */
  door?: { side: -1 | 1; at: number };
  /** A luge thing's side of the track (-1 left, 1 right). */
  side?: number;
}

export interface Course {
  id: LevelId;
  /** Start line and finish line, as y. */
  start: number;
  finish: number;
  /** Where the course art ends. */
  end: number;
  /** The rideable edges, as x, for the street and the hill. */
  edge: number;
  /** sin(slope) sampled every metre from y = -40. */
  grade: Float32Array;
  things: Thing[];
  track?: Track;
  /** Named features, for the course strip and the curve calls. */
  marks: { y: number; label: string; dir?: -1 | 1 }[];
}

export interface Track {
  /** Samples every STEP metres of y from y = -40. */
  cx: Float32Array;
  dx: Float32Array;
  /** Signed curvature (1/m), positive turning toward +x. */
  k: Float32Array;
  /** Half width of the ice floor and how far the outside wall reaches, per sample. */
  half: number;
  wall: Float32Array;
}

export const STEP = 1;
const ORIGIN = -40;

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample a per-metre array at y, linearly. */
export function sample(a: Float32Array, y: number): number {
  const f = (y - ORIGIN) / STEP;
  const i = Math.max(0, Math.min(a.length - 2, Math.floor(f)));
  const t = Math.max(0, Math.min(1, f - i));
  return a[i] * (1 - t) + a[i + 1] * t;
}

function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function box(
  kind: string,
  x: number,
  y: number,
  hw: number,
  hd: number,
  h: number,
  effect: Effect,
  seed: number,
): Thing {
  return { kind, x, y, hw, hd, round: false, h, effect, seed };
}

function disc(kind: string, x: number, y: number, r: number, h: number, effect: Effect, seed: number): Thing {
  return { kind, x, y, hw: r, hd: r, round: true, h, effect, seed };
}

function gradeFrom(end: number, fn: (y: number) => number): Float32Array {
  const n = Math.ceil((end - ORIGIN) / STEP) + 2;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = fn(ORIGIN + i * STEP);
  return g;
}

// ---------------------------------------------------------------- hill bomb

export const BLOCK = 132;
export const CROSS = 16;
export const BLOCKS = 7;
export const CURB = 8;
export const WALK = 11.2;

/** The y of the top of each cross street; the first is the start, the last the finish. */
export function crossStreets(): number[] {
  const out: number[] = [];
  for (let k = 0; k <= BLOCKS; k++) out.push(k * (BLOCK + CROSS) - CROSS);
  return out;
}

function bomb(seed: number): Course {
  const rnd = mulberry(seed);
  const things: Thing[] = [];
  const crosses = crossStreets();
  const finish = crosses[BLOCKS] + 4;
  const end = finish + 70;
  const steep = [0.15, 0.19, 0.17, 0.23, 0.2, 0.25, 0.18];

  const grade = gradeFrom(end, (y) => {
    // Flat cross streets, steep blocks, and a short break over each crest.
    for (let k = 0; k < BLOCKS; k++) {
      const top = crosses[k] + CROSS;
      const bottom = top + BLOCK;
      if (y >= top - 4 && y < bottom + 4) {
        const s = steep[k];
        return 0.015 + (s - 0.015) * smooth((y - top + 4) / 10) * smooth((bottom + 4 - y) / 10);
      }
    }
    return y > finish ? 0.0 : 0.015;
  });

  const marks: Course['marks'] = [];
  const streets = ['Alder', 'Cobb', 'Durrow', 'Elm', 'Fenwick', 'Garnet', 'Hale', 'Bay'];
  crosses.forEach((y, k) => marks.push({ y: y + CROSS / 2, label: `${streets[k]} St` }));

  for (let k = 0; k < BLOCKS; k++) {
    const top = crosses[k] + CROSS;
    const bottom = top + BLOCK;

    // Parked cars along both curbs, with driveways and hydrant gaps between.
    for (const side of [-1, 1] as const) {
      let y = top + 6 + rnd() * 6;
      while (y < bottom - 8) {
        if (rnd() < 0.82) {
          const len = 4.2 + rnd() * 0.8;
          const kind = rnd() < 0.18 ? 'van' : 'car';
          const car = box(kind, side * 6.85, y + len / 2, 0.95, len / 2, kind === 'van' ? 2.1 : 1.45, 'crash', rnd());
          // The driver's side faces the traffic lane; a few doors swing open as you come.
          if (kind === 'car' && rnd() < 0.16 && k > 0) car.door = { side: side === 1 ? -1 : 1, at: -1 };
          things.push(car);
          y += len + 0.8 + rnd() * 3;
        } else {
          y += 6 + rnd() * 6;
        }
      }
    }

    // Hazards in the lanes: potholes, plates, a roadworks pit, a double-parked van.
    const slots = 5 + Math.floor(rnd() * 3) + Math.floor(k / 2);
    const lane = () => (rnd() * 2 - 1) * 4.6;
    let works = k === 1 || k === 3 || k === 5;
    for (let i = 0; i < slots; i++) {
      const y = top + 14 + ((i + rnd() * 0.7) / slots) * (BLOCK - 28);
      const r = rnd();
      if (works && i === Math.floor(slots / 2)) {
        works = false;
        const side = rnd() < 0.5 ? -1 : 1;
        const cx = side * 2.6;
        things.push(box('pit', cx, y, 1.6, 4.2, 0.9, 'crash', rnd()));
        for (let c = 0; c < 7; c++) {
          const t = c / 6;
          things.push(disc('cone', cx - side * 2.2, y - 6.5 + t * 13, 0.22, 0.7, 'knock', rnd()));
        }
        things.push(disc('cone', cx, y - 6.2, 0.22, 0.7, 'knock', rnd()));
        things.push(box('sign', cx + side * 0.6, y - 5.4, 0.35, 0.1, 1.4, 'crash', rnd()));
      } else if (r < 0.42) {
        const x = lane();
        const n = 1 + Math.floor(rnd() * 3);
        for (let j = 0; j < n; j++) {
          things.push(
            disc('pothole', x + (rnd() - 0.5) * 2.4, y + (rnd() - 0.5) * 3, 0.35 + rnd() * 0.35, 0, 'trip', rnd()),
          );
        }
      } else if (r < 0.62) {
        things.push(disc('manhole', lane(), y, 0.42, 0, 'none', rnd()));
      } else if (r < 0.8 && k > 0) {
        const side = rnd() < 0.5 ? -1 : 1;
        things.push(box('truck', side * 3.6, y, 1.15, 3.3, 2.6, 'crash', rnd()));
      } else {
        things.push(box('plate', lane(), y, 1.1, 0.8, 0, 'none', rnd()));
      }
    }

    // Storm drains at the foot of the block, right against the curb.
    for (const side of [-1, 1]) things.push(box('grate', side * 7.45, bottom - 2.5, 0.42, 0.75, 0, 'crash', rnd()));
  }

  // Cross traffic and walkers at every cross street below the start.
  for (let k = 1; k <= BLOCKS; k++) {
    const y0 = crosses[k];
    if (k < BLOCKS) {
      const lanes = [
        { y: y0 + 4.6, speed: 7.5 + rnd() * 2 },
        { y: y0 + 11.4, speed: -(7.5 + rnd() * 2) },
      ];
      for (const l of lanes) {
        const n = 1 + Math.floor(rnd() * 2) + (k > 3 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const kind = rnd() < 0.2 ? 'bus' : 'car';
          const hw = kind === 'bus' ? 5.5 : 2.3;
          const t = box(kind, 0, l.y, hw, 1.0, kind === 'bus' ? 3 : 1.45, 'crash', rnd());
          t.move = { from: -70, to: 70, speed: l.speed, phase: (i / n) * 140 + rnd() * 20 };
          things.push(t);
        }
      }
      // Walkers on the crosswalks either side of the junction.
      for (const cy of [y0 - 1.6, y0 + CROSS + 1.6]) {
        if (rnd() < 0.7) {
          const t = disc('walker', 0, cy, 0.32, 1.7, 'crash', rnd());
          const sp = (1.2 + rnd() * 0.5) * (rnd() < 0.5 ? -1 : 1);
          t.move = { from: -16, to: 16, speed: sp, phase: rnd() * 32 };
          things.push(t);
        }
      }
    }
  }

  // Street furniture and the houses stepping down the hill.
  for (let k = -1; k < BLOCKS + 1; k++) {
    const top = k < 0 ? crosses[0] - BLOCK : crosses[k] + CROSS;
    const bottom = k < 0 ? crosses[0] : k < BLOCKS ? top + BLOCK : end;
    // Below the last cross street is the waterfront: nothing to build on.
    if (k === BLOCKS) continue;
    if (k < 0) {
      // Parked cars on the block above the start, for the view back up the hill.
      for (const side of [-1, 1]) {
        for (let y = bottom - 10; y > top; y -= 5.5 + rnd() * 3)
          things.push(box('car', side * 6.85, y, 0.95, 2.3, 1.45, 'none', rnd()));
      }
    }
    for (const side of [-1, 1]) {
      for (let y = top + 3 + rnd() * 4; y < bottom - 3; y += 7 + rnd() * 6) {
        const r = rnd();
        if (r < 0.55) things.push(disc('tree', side * 9.3, y, 0.5, 5 + rnd() * 2.5, 'none', rnd()));
        else if (r < 0.7) things.push(disc('lamp', side * 8.6, y, 0.15, 6.2, 'none', rnd()));
        else if (r < 0.8) things.push(disc('hydrant', side * 8.5, y, 0.2, 0.8, 'none', rnd()));
        else if (r < 0.9) things.push(box('bin', side * 8.7, y, 0.35, 0.35, 1.1, 'none', rnd()));
      }
      let y = top + 0.5;
      while (y < bottom - 4) {
        const depth = Math.min(bottom - 0.5 - y, 6.5 + rnd() * 2.5);
        if (depth < 4) break;
        const corner = y === top + 0.5 || y + depth > bottom - 6;
        things.push(
          box(
            corner ? 'shop' : 'house',
            side * (WALK + 6.5),
            y + depth / 2,
            6.5,
            depth / 2 - 0.15,
            corner ? 7 + rnd() * 3 : 9.5 + rnd() * 4,
            'none',
            rnd(),
          ),
        );
        y += depth;
      }
    }
  }

  things.push(box('line', 0, finish, CURB, 0.4, 0, 'none', 0));
  for (const x of [-9.5, -9.9, 9.6, 10.1])
    things.push(disc('crowd', x, finish + 2 + rnd() * 3, 0.3, 1.7, 'none', rnd()));
  return {
    id: 'bomb',
    start: crosses[0] + CROSS / 2,
    finish,
    end,
    edge: CURB,
    grade,
    things: sortThings(things),
    marks,
  };
}

// ---------------------------------------------------------------- cheese roll

export const BANK = 26;

function cheese(seed: number): Course {
  const rnd = mulberry(seed);
  const things: Thing[] = [];
  const finish = 560;
  const end = finish + 70;
  const ledges = [150, 330, 455];
  const grade = gradeFrom(end, (y) => {
    if (y < 0) return 0.05;
    let g = 0.08 + 0.44 * smooth(y / 30);
    // Each ledge is a short shelf and then a drop that takes your feet away.
    for (const l of ledges) {
      g -= 0.3 * smooth((y - l + 10) / 6) * smooth((l + 2 - y) / 4);
      g += 0.22 * smooth((y - l - 1) / 3) * smooth((l + 16 - y) / 8);
    }
    g -= 0.38 * smooth((y - (finish - 70)) / 60);
    return Math.max(0, g);
  });
  const marks: Course['marks'] = [
    { y: 0, label: 'The brow' },
    { y: ledges[0], label: 'First step' },
    { y: ledges[1], label: 'The Shelf' },
    { y: ledges[2], label: 'Long drop' },
    { y: finish, label: 'Bottom fence' },
  ];
  for (const l of ledges) things.push(box('ledge', 0, l, BANK, 1.2, 0, 'none', rnd()));

  // Tussocks everywhere, gorse in clumps, a few rocks and rabbit holes.
  for (let y = 12; y < finish - 10; y += 2.4) {
    const n = Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      things.push(
        disc('tussock', (rnd() * 2 - 1) * (BANK - 1), y + rnd() * 2.4, 0.4 + rnd() * 0.3, 0.45, 'trip', rnd()),
      );
    }
  }
  for (let i = 0; i < 26; i++) {
    const y = 30 + rnd() * (finish - 60);
    const x = (rnd() * 2 - 1) * (BANK - 2);
    const n = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) {
      things.push(
        disc('gorse', x + (rnd() - 0.5) * 3.5, y + (rnd() - 0.5) * 3.5, 0.9 + rnd() * 0.7, 1.2, 'crash', rnd()),
      );
    }
  }
  for (let i = 0; i < 16; i++)
    things.push(
      disc('rock', (rnd() * 2 - 1) * (BANK - 2), 25 + rnd() * (finish - 50), 0.45 + rnd() * 0.4, 0.5, 'crash', rnd()),
    );
  for (let i = 0; i < 22; i++)
    things.push(disc('hole', (rnd() * 2 - 1) * (BANK - 2), 20 + rnd() * (finish - 40), 0.28, 0, 'trip', rnd()));
  for (let i = 0; i < 14; i++)
    things.push(
      disc('thistle', (rnd() * 2 - 1) * (BANK - 3), 25 + rnd() * (finish - 50), 1.4 + rnd(), 0.5, 'slow', rnd()),
    );

  // Fences, the crowd along them, and the catchers waiting at the bottom.
  for (const side of [-1, 1]) {
    for (let y = -30; y < end; y += 3) things.push(disc('post', side * (BANK + 1), y, 0.1, 1.1, 'none', rnd()));
    for (let y = -30; y < end; y += 0.9 + rnd() * 1.4) {
      const dense = y < 40 || y > finish - 60 ? 1 : 0.35;
      if (rnd() < dense)
        things.push(disc('crowd', side * (BANK + 2.4 + rnd() * 5), y, 0.3, 1.6 + rnd() * 0.2, 'none', rnd()));
    }
  }
  // Hawthorns along the hedge line beyond the crowd.
  for (const side of [-1, 1]) {
    for (let y = -30; y < end; y += 14 + rnd() * 18) {
      things.push(disc('thorn', side * (BANK + 11 + rnd() * 8), y, 0.5, 4 + rnd() * 2, 'none', rnd()));
    }
  }
  for (let x = -BANK + 3; x < BANK - 2; x += 4 + rnd() * 3)
    things.push(disc('catcher', x, finish + 6 + rnd() * 3, 0.36, 1.85, 'none', rnd()));
  for (let x = -BANK; x <= BANK; x += 1.9) things.push(box('bale', x, finish + 18, 0.9, 0.55, 0.9, 'crash', rnd()));
  things.push(box('line', 0, finish, BANK, 0.4, 0, 'none', 0));
  things.push(box('line', 0, 0, BANK, 0.25, 0, 'none', 1));
  return { id: 'cheese', start: -2, finish, end, edge: BANK, grade, things: sortThings(things), marks };
}

// ---------------------------------------------------------------- luge

export const ICE = 1.2;

function luge(seed: number): Course {
  const rnd = mulberry(seed);
  const finish = 1250;
  const end = finish + 120;
  // Each curve bends the track to slope m (dx/dy) and back. Names go on the calls.
  const curves: { y: number; len: number; m: number; label: string }[] = [
    { y: 70, len: 70, m: 0.9, label: 'Curve 1' },
    { y: 165, len: 60, m: -1.1, label: 'Curve 2' },
    { y: 250, len: 90, m: 1.8, label: 'Kettle' },
    { y: 370, len: 34, m: -0.8, label: 'Labyrinth' },
    { y: 406, len: 34, m: 0.9, label: 'Labyrinth' },
    { y: 442, len: 34, m: -0.9, label: 'Labyrinth' },
    { y: 540, len: 110, m: -2.1, label: 'Horseshoe' },
    { y: 700, len: 60, m: 1.2, label: 'Curve 8' },
    { y: 800, len: 80, m: -1.5, label: 'Cellar' },
    { y: 920, len: 70, m: 1.6, label: 'Omega' },
    { y: 990, len: 70, m: -1.6, label: 'Omega' },
    { y: 1110, len: 60, m: 0.7, label: 'Run-in' },
  ];
  const n = Math.ceil((end - ORIGIN) / STEP) + 2;
  const dx = new Float32Array(n);
  const cx = new Float32Array(n);
  const k = new Float32Array(n);
  const wall = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const y = ORIGIN + i * STEP;
    let m = 0;
    for (const c of curves) {
      const t = (y - c.y) / c.len;
      if (t > 0 && t < 1) m += c.m * Math.sin(Math.PI * t) ** 2;
    }
    dx[i] = m;
  }
  for (let i = 1; i < n; i++) cx[i] = cx[i - 1] + ((dx[i - 1] + dx[i]) / 2) * STEP;
  for (let i = 0; i < n; i++) {
    const a = dx[Math.max(0, i - 1)];
    const b = dx[Math.min(n - 1, i + 1)];
    const d2 = (b - a) / (2 * STEP);
    const nn = Math.sqrt(1 + dx[i] * dx[i]);
    k[i] = d2 / (nn * nn * nn);
  }
  // The outside wall climbs with the curve so there's banking to ride up.
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let j = Math.max(0, i - 12); j < Math.min(n, i + 12); j++) peak = Math.max(peak, Math.abs(k[j]));
    wall[i] = 0.55 + Math.min(1.5, peak * 36);
  }
  const track: Track = { cx, dx, k, half: ICE, wall };
  const grade = gradeFrom(end, (y) => {
    if (y < 0) return 0.06;
    if (y > finish + 10) return Math.max(-0.12, 0.11 - (y - finish - 10) * 0.012);
    return 0.11 + 0.035 * Math.sin(y / 97) + 0.025 * smooth((y - 600) / 200);
  });

  const things: Thing[] = [];
  const at = (y: number) => sample(cx, y);
  // An offset measured square to the track, so curves that run across the hill keep their clearance.
  const off = (y: number, d: number) => at(y) + d * Math.sqrt(1 + sample(dx, y) ** 2);
  // Floodlights on the inside of every curve and every 45 m between.
  for (let y = -20; y < end; y += 22 + rnd() * 10) {
    const side = sample(k, y + 10) > 0.002 ? 1 : sample(k, y + 10) < -0.002 ? -1 : rnd() < 0.5 ? -1 : 1;
    const t = disc('flood', off(y, side * (ICE + 3.4)), y, 0.18, 11, 'none', rnd());
    t.side = side;
    things.push(t);
  }
  // Spruce stands either side, kept clear of the track and of each other.
  for (let y = -40; y < end; y += 2.2) {
    for (const side of [-1, 1]) {
      if (rnd() < 0.5) continue;
      const x = off(y, side * (ICE + 6 + rnd() * 22));
      let clear = true;
      for (let d = -24; d <= 24; d += 4)
        if (Math.abs(x - at(y + d)) < (ICE + 5) * Math.sqrt(1 + sample(dx, y + d) ** 2)) clear = false;
      if (!clear) continue;
      things.push(disc('spruce', x, y, 1 + rnd() * 0.8, 6 + rnd() * 6, 'none', rnd()));
    }
  }
  // Spectators bunched on the outside of the big curves.
  for (const c of curves) {
    const mid = c.y + c.len / 2;
    const side = c.m > 0 ? -1 : 1;
    for (let i = 0; i < 18; i++) {
      const y = mid - 18 + rnd() * 36;
      const t = disc('fan', off(y, side * (ICE + 2.6 + rnd() * 2.4)), y, 0.28, 1.7, 'none', rnd());
      t.side = side;
      things.push(t);
    }
  }
  things.push(box('line', at(0), 0, ICE, 0.3, 0, 'none', 1));
  things.push(box('line', at(finish), finish, ICE, 0.3, 0, 'none', 0));
  things.push(box('starthouse', at(-6), -6, 3.4, 2.4, 3.4, 'none', 0));
  things.push(box('clock', off(finish + 6, ICE + 4), finish + 6, 2.4, 0.3, 4.6, 'none', 0));

  const marks: Course['marks'] = [];
  const seen = new Set<string>();
  for (const c of curves) {
    if (seen.has(c.label)) continue;
    seen.add(c.label);
    marks.push({ y: c.y, label: c.label, dir: c.m > 0 ? 1 : -1 });
  }
  return { id: 'luge', start: -2, finish, end, edge: 0, grade, things: sortThings(things), marks, track };
}

function sortThings(things: Thing[]): Thing[] {
  return things.sort((a, b) => a.y + a.hd - (b.y + b.hd));
}

const SEEDS: Record<LevelId, number> = { bomb: 4417, cheese: 1888, luge: 2026 };

export function buildCourse(id: LevelId): Course {
  const seed = SEEDS[id];
  return id === 'bomb' ? bomb(seed) : id === 'cheese' ? cheese(seed) : luge(seed);
}

/** Where a moving thing is at time t. */
export function moveX(m: Move, t: number): number {
  const span = m.to - m.from;
  const d = (((m.phase + m.speed * t) % span) + span) % span;
  return m.from + d;
}
