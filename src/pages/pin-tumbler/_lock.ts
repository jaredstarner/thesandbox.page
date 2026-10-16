// Pin tumbler: the lock itself, as a model in millimetres. No drawing or sound here.
//
// The section runs along the key axis: x from the lock face into the lock, y up
// from the plug's axis. The plug is a cylinder of radius R; its top edge in the
// section is the shear line. Each pin stack is a key pin in the plug and a driver
// in the housing above it, pushed down by a spring. The plug turns only when every
// stack is split exactly at the shear line.

/** Plug radius, and so the height of the shear line. Half an inch, as in most cylinders. */
export const R = 6.35;
export const SHEAR = R;
/** Pin diameter and the spacing between pin chambers: 0.115 in and 0.156 in. */
export const PIN_D = 2.92;
export const PITCH = 3.96;
/** Centre of the first pin chamber, measured in from the lock face. */
export const FIRST = 5.4;
/** The keyway, inside the plug. */
export const KW_BOT = -4.3;
export const KW_TOP = 3.0;
/** Where key pin tips hang when nothing lifts them. */
export const REST = -0.4;
export const DRIVER = 5.2;
/** Height of the top of each chamber, where the spring is capped. */
export const CHAMBER_TOP = SHEAR + 10.6;
/** A coiled spring can't compress shorter than this. */
export const SPRING_SOLID = 1.7;
/** The pick's hook: how far its tip stands above the shaft, and the tip's lowest and highest reach. */
export const HOOK = 2.2;
export const TIP_LOW = KW_BOT + 0.7 + HOOK;
export const TIP_HIGH = KW_TOP + 0.7;
/** A spool driver: a full-width lip at the bottom, then a narrow waist. */
export const SPOOL_LIP = 0.6;
export const SPOOL_WAIST = 1.0;
/** A serrated driver's grooves, measured up from its bottom. */
export const SERRATIONS = [0.62, 0.31];

/** Tension, 0 to 1: below HOLD nothing binds; above JAM the binding pin can't be lifted; spools need SPOOL or less to pass. */
export const T_HOLD = 0.08;
export const T_JAM = 0.82;
export const T_SPOOL = 0.42;

export type DriverKind = 'standard' | 'spool' | 'serrated';
export type PinState = 'free' | 'set' | 'caught' | 'overset';

export interface Pin {
  i: number;
  /** Centre of the chamber. */
  x: number;
  /** Key pin length; shorter key pins need lifting further. */
  key: number;
  depth: number;
  driver: DriverKind;
  /** How far the chamber was drilled off true: the largest binds first. */
  offset: number;
  /** Key pin tip height. */
  keyY: number;
  /** Driver bottom height. */
  drvY: number;
  state: PinState;
  /** Serration grooves already caught on the plug's edge. */
  caughtGrooves: number;
}

export interface LockSpec {
  id: string;
  name: string;
  blurb: string;
  pins: number;
  spools: number;
  serrated: number;
  /** Clear plastic housing, as practice locks are. */
  clear: boolean;
  /** The section is hidden: pick by feel and sound. */
  blind: boolean;
  /** Plain-words coaching and the binding tag. */
  coach: boolean;
}

export const LOCKS: LockSpec[] = [
  {
    id: 'practice',
    name: 'Practice lock',
    blurb: 'Three standard pins in clear plastic',
    pins: 3,
    spools: 0,
    serrated: 0,
    clear: true,
    blind: false,
    coach: true,
  },
  {
    id: 'four',
    name: 'Brass four',
    blurb: 'Four standard pins',
    pins: 4,
    spools: 0,
    serrated: 0,
    clear: false,
    blind: false,
    coach: true,
  },
  {
    id: 'deadbolt',
    name: 'Deadbolt',
    blurb: 'Five standard pins, a front door',
    pins: 5,
    spools: 0,
    serrated: 0,
    clear: false,
    blind: false,
    coach: false,
  },
  {
    id: 'spools',
    name: 'Spool five',
    blurb: 'Five pins, two of them spools',
    pins: 5,
    spools: 2,
    serrated: 0,
    clear: false,
    blind: false,
    coach: false,
  },
  {
    id: 'security',
    name: 'Security six',
    blurb: 'Six pins: spools and serrated drivers',
    pins: 6,
    spools: 2,
    serrated: 2,
    clear: false,
    blind: false,
    coach: false,
  },
  {
    id: 'blind',
    name: 'Blind',
    blurb: 'Five pins you can only hear and feel',
    pins: 5,
    spools: 1,
    serrated: 1,
    clear: false,
    blind: true,
    coach: false,
  },
];

/** Key pin length for a cut depth, 0 (shallowest cut, longest pin) to 7. */
export const keyLength = (depth: number) => 5.4 - depth * 0.3;
/** How far a key pin must be lifted from rest to split its stack at the shear line. */
export const liftToSet = (pin: Pin) => SHEAR - REST - pin.key;

/** A small seeded generator, so a lock can be rebuilt from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildPins(spec: LockSpec, seed: number): Pin[] {
  const rand = rng(seed);
  const n = spec.pins;
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const kinds: DriverKind[] = Array.from({ length: n }, () => 'standard');
  const slots = Array.from({ length: n }, (_, i) => i).sort(() => rand() - 0.5);
  for (let k = 0; k < spec.spools; k++) kinds[slots[k]] = 'spool';
  for (let k = 0; k < spec.serrated; k++) kinds[slots[spec.spools + k]] = 'serrated';

  let prev = -9;
  return order.map((rank, i) => {
    const kind = kinds[i];
    // Spools need room above the shear line for their waist, so they sit on deeper cuts.
    const lo = kind === 'spool' ? 2 : 0;
    let depth = lo + Math.floor(rand() * (8 - lo));
    // Neighbouring cuts more than five apart couldn't be cut on a real key.
    if (prev >= 0 && Math.abs(depth - prev) > 5) depth = prev + Math.sign(depth - prev) * 5;
    depth = Math.max(lo, Math.min(7, depth));
    prev = depth;
    const key = keyLength(depth);
    return {
      i,
      x: FIRST + i * PITCH,
      key,
      depth,
      driver: kind,
      offset: (n - rank) / n + rand() * 0.01,
      keyY: REST,
      drvY: REST + key,
      state: 'free',
      caughtGrooves: 0,
    };
  });
}

export type LockEvent =
  | { type: 'set'; pin: number }
  | { type: 'caught'; pin: number }
  | { type: 'groove'; pin: number }
  | { type: 'overset'; pin: number }
  | { type: 'reset'; pins: number }
  | { type: 'touch'; pin: number; speed: number }
  | { type: 'jam' }
  | { type: 'open' };

export interface PickInput {
  /** Where the hand wants the tip. */
  tx: number;
  ty: number;
  tension: number;
}

/** What the sound and the draw need to know about one frame of picking. */
export interface Feel {
  /** Speed of the pin under the tip, mm/s, and whether it is binding, springy, or loose. */
  speed: number;
  contact: 'none' | 'binding' | 'spring' | 'loose' | 'solid';
  /** How far the hand is ahead of the tip, in mm: the pick bends to take it up. */
  bend: number;
  /** Counter-rotation as a spool's lip pushes the plug back, 0 to 1. */
  counter: number;
}

export class Lock {
  readonly spec: LockSpec;
  readonly seed: number;
  pins: Pin[];
  /** The tip of the pick. */
  px = FIRST - 3;
  py = TIP_LOW;
  tension = 0;
  /** Plug rotation, in degrees, as drawn: a hair per set pin, more in a false set, 90 when open. */
  turn = 0;
  opened = false;
  /** Seconds since the plug began to turn. */
  openT = 0;
  feel: Feel = { speed: 0, contact: 'none', bend: 0, counter: 0 };
  binding: Pin | null = null;
  private touching = -1;

  constructor(spec: LockSpec, seed: number) {
    this.spec = spec;
    this.seed = seed;
    this.pins = buildPins(spec, seed);
  }

  /** The far end of the plug. */
  get length(): number {
    return FIRST + (this.spec.pins - 1) * PITCH + 3.4;
  }

  get setCount(): number {
    return this.pins.filter((p) => p.state === 'set').length;
  }

  /** How far the plug has turned, as a sideways slip of its pin holes in the section, in mm. */
  get slip(): number {
    if (this.opened) return 0;
    const sets = this.setCount;
    const caught = this.pins.some((p) => p.state === 'caught');
    const base = Math.min(0.32, 0.07 * sets + (sets > 0 ? 0.03 : 0));
    return caught ? base + 0.34 * (1 - this.feel.counter) : base;
  }

  private findBinding(): Pin | null {
    const caught = this.pins.find((p) => p.state === 'caught');
    if (caught) return caught;
    let best: Pin | null = null;
    for (const p of this.pins) if (p.state === 'free' && (!best || p.offset > best.offset)) best = p;
    return best;
  }

  /** The pin whose key pin the tip is under, if any. */
  pinAt(x: number): Pin | null {
    const slip = this.slip;
    for (const p of this.pins) if (Math.abs(x - (p.x - slip)) < PIN_D / 2 + 0.3) return p;
    return null;
  }

  reset(): number {
    let n = 0;
    for (const p of this.pins) {
      if (p.state !== 'free') n++;
      p.state = 'free';
      p.caughtGrooves = 0;
    }
    return n;
  }

  step(dt: number, input: PickInput): LockEvent[] {
    const ev: LockEvent[] = [];
    const t = input.tension;
    this.tension = t;

    if (this.opened) {
      this.openT += dt;
      this.turn = Math.min(90, this.turn + dt * 160);
      this.px += (FIRST - 3 - this.px) * Math.min(1, dt * 6);
      this.py += (TIP_LOW - this.py) * Math.min(1, dt * 6);
      return ev;
    }

    // Let go of the wrench and every held pin drops.
    if (t < T_HOLD) {
      const n = this.reset();
      if (n) ev.push({ type: 'reset', pins: n });
    }
    const binding = t >= T_HOLD ? this.findBinding() : null;
    this.binding = binding;

    // Move the tip toward the hand, a pin's width at a time so it can't jump a stack.
    const tx = Math.max(-1.2, Math.min(this.length - 1.4, input.tx));
    const ty = Math.max(TIP_LOW, Math.min(TIP_HIGH, input.ty));
    const steps = Math.max(1, Math.ceil(Math.abs(tx - this.px) / 0.4));
    let feel: Feel = { speed: 0, contact: 'none', bend: 0, counter: 0 };
    const before = this.pins.map((p) => p.keyY);
    for (let s = 1; s <= steps; s++) {
      const x = this.px + ((tx - this.px) * s) / steps;
      feel = this.push(x, ty, t, binding, ev);
    }

    // Pins the tip isn't holding fall back: springy stacks fast, loose key pins by their own weight.
    const under = this.pinAt(this.px);
    for (const p of this.pins) {
      const support = p === under ? this.py : -Infinity;
      const floor = Math.max(REST, support);
      if (p.state === 'free') {
        const held = p === binding && t > 0.24;
        if (!held && p.keyY > floor) {
          p.keyY += (floor - p.keyY) * Math.min(1, dt * 38);
          if (p.keyY - floor < 0.004) p.keyY = floor;
        }
        p.drvY = p.keyY + p.key;
      } else if (p.state === 'set' || p.state === 'caught') {
        if (p.keyY > floor) p.keyY += (floor - p.keyY) * Math.min(1, dt * 16);
        // The driver rests on the plug's edge; a set key pin falls away from it.
        const ledge = p.state === 'set' ? SHEAR + 0.02 : SHEAR - SPOOL_LIP - SPOOL_WAIST;
        p.drvY = Math.max(ledge, p.keyY + p.key);
      }
    }

    // Counter-rotation: a caught spool being lifted through its lip pushes the plug back.
    const caught = this.pins.find((p) => p.state === 'caught');
    feel.counter = caught
      ? Math.max(0, Math.min(1, (caught.drvY - (SHEAR - SPOOL_LIP)) / SPOOL_LIP))
      : 0;

    if (under) {
      const moved = (under.keyY - (before[under.i] ?? under.keyY)) / Math.max(dt, 1e-3);
      feel.speed = Math.abs(moved);
      if (under.i !== this.touching && this.py > REST - 0.05) {
        ev.push({ type: 'touch', pin: under.i, speed: Math.abs(moved) });
      }
    }
    this.touching = under && this.py > REST - 0.05 ? under.i : -1;
    this.feel = feel;

    // The plug turns when every stack is split at the shear line and nothing straddles it.
    const clear = this.pins.every((p) => p.state === 'set' && p.keyY + p.key <= SHEAR + 0.05);
    if (clear && t >= T_HOLD) {
      this.opened = true;
      this.openT = 0;
      ev.push({ type: 'open' });
    }
    const caughtNow = this.pins.some((p) => p.state === 'caught');
    const target = this.setCount * 1.6 + (caughtNow ? 7 * (1 - feel.counter) : 0) + t * 1.2;
    this.turn += (target - this.turn) * Math.min(1, dt * 18);
    return ev;
  }

  /** Move the tip to (x, y), lifting whatever key pin sits on it. */
  private push(x: number, y: number, t: number, binding: Pin | null, ev: LockEvent[]): Feel {
    let tipY = y;
    let contact: Feel['contact'] = 'none';
    let bend = 0;
    const pin = this.pinAt(x);
    if (pin && tipY > pin.keyY) {
      const want = tipY;
      if (pin.state === 'overset') {
        // The key pin is wedged across the shear line: nothing gives.
        tipY = pin.keyY;
        contact = 'solid';
      } else if (pin.state === 'free' && pin === binding) {
        contact = 'binding';
        if (t > T_JAM) {
          tipY = pin.keyY;
          if (want - pin.keyY > 0.25) ev.push({ type: 'jam' });
        } else {
          // Friction grips the driver: it moves in small slips, more grudgingly the harder the wrench pulls.
          const gap = 0.02 + 0.22 * Math.max(0, t - 0.35);
          if (want - pin.keyY > gap) pin.keyY = want - 0.01;
          tipY = Math.min(want, pin.keyY + 0.01);
        }
        pin.drvY = pin.keyY + pin.key;
        this.checkBinding(pin, t, ev);
      } else if (pin.state === 'free') {
        contact = 'spring';
        pin.keyY = tipY;
        const top = CHAMBER_TOP - SPRING_SOLID - DRIVER;
        if (pin.keyY + pin.key > top) {
          pin.keyY = top - pin.key;
          tipY = pin.keyY;
        }
        pin.drvY = pin.keyY + pin.key;
      } else if (pin.state === 'caught') {
        contact = 'binding';
        // A caught spool rides freely through its waist; its lip pushes the plug back and needs a light wrench.
        const lipFrom = SHEAR - SPOOL_LIP - pin.key;
        if (tipY > lipFrom && t > T_SPOOL) {
          tipY = Math.max(pin.keyY, Math.min(tipY, lipFrom));
          if (want - tipY > 0.25) ev.push({ type: 'jam' });
        }
        pin.keyY = tipY;
        pin.drvY = Math.max(pin.drvY, pin.keyY + pin.key);
        if (pin.drvY >= SHEAR) {
          pin.state = 'set';
          pin.drvY = SHEAR + 0.02;
          ev.push({ type: 'set', pin: pin.i });
        }
      } else {
        contact = 'loose';
        pin.keyY = tipY;
        pin.drvY = Math.max(pin.drvY, pin.keyY + pin.key);
        // Push a set key pin up past the shear line under tension and it wedges there.
        const over = 0.28 + 0.5 * (1 - t);
        if (pin.keyY + pin.key > SHEAR + over) {
          pin.state = 'overset';
          ev.push({ type: 'overset', pin: pin.i });
        }
      }
      bend = Math.max(0, want - tipY);
    }
    this.px = x;
    this.py = tipY;
    return { speed: 0, contact, bend, counter: 0 };
  }

  private checkBinding(pin: Pin, t: number, ev: LockEvent[]): void {
    if (pin.driver === 'serrated') {
      // Each groove catches on the plug's edge in turn: a click that feels like a set but isn't.
      const next = SERRATIONS[pin.caughtGrooves];
      if (next !== undefined && pin.drvY >= SHEAR - next) {
        pin.caughtGrooves++;
        ev.push({ type: 'groove', pin: pin.i });
      }
    }
    if (pin.driver === 'spool' && pin.drvY >= SHEAR - SPOOL_LIP - SPOOL_WAIST && pin.drvY < SHEAR) {
      pin.state = 'caught';
      ev.push({ type: 'caught', pin: pin.i });
      return;
    }
    if (pin.drvY >= SHEAR) {
      const overshoot = pin.drvY - SHEAR;
      pin.state = 'set';
      pin.drvY = SHEAR + 0.02;
      ev.push({ type: 'set', pin: pin.i });
      // Driven straight through in one shove, the key pin follows the driver into the housing.
      if (overshoot > 0.28 + 0.5 * (1 - t)) {
        pin.state = 'overset';
        ev.push({ type: 'overset', pin: pin.i });
      }
    }
  }
}
