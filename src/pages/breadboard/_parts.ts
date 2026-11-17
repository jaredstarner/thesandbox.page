// /breadboard/: the parts. What each one is called, how its legs sit in the board, and how a
// board full of them becomes a netlist for the solver.

import { HOLE, holeAt, STRIPS, type Hole } from './_board';
import type { Circuit, Device, LedColor, MeterMode } from './_sim';

export type Kind =
  | 'wire'
  | 'res'
  | 'led'
  | 'ecap'
  | 'cap'
  | 'ldr'
  | 'button'
  | 'pot'
  | 'npn'
  | 'ne555'
  | 'cd4017'
  | 'buzzer'
  | 'battery';

export interface Part {
  id: string;
  kind: Kind;
  /** Two-lead parts (and the battery's leads): the holes the two legs sit in. */
  a?: string;
  b?: string;
  /** Footprint parts: the hole under pin 1, and quarter turns clockwise. */
  at?: string;
  rot?: number;
  /** Ohms for resistors, farads for capacitors. */
  value?: number;
  /** Wire insulation or LED colour. */
  color?: string;
  /** Trimmer position, 0 to 1. */
  pos?: number;
}

/** Leg spans allowed for two-lead parts, in hole pitches, and the default span from the drawer. */
export const TWO_LEAD: Partial<Record<Kind, { min: number; max: number; def: [number, number] }>> = {
  wire: { min: 1, max: 45, def: [3, 0] },
  res: { min: 1, max: 10, def: [4, 0] },
  led: { min: 1, max: 3.6, def: [1, 0] },
  ecap: { min: 1, max: 3.6, def: [1, 0] },
  cap: { min: 1, max: 4.5, def: [1, 0] },
  ldr: { min: 1, max: 3.6, def: [1, 0] },
};

/** Pin offsets from pin 1 for parts with rigid legs, before rotation. */
export const FOOTPRINT: Partial<Record<Kind, [number, number][]>> = {
  // A 6 mm tactile switch across the channel: legs in the same column are always joined,
  // and pressing joins the two columns.
  button: [
    [0, 0],
    [0, -3],
    [2, 0],
    [2, -3],
  ],
  pot: [
    [0, 0],
    [1, 0],
    [2, 0],
  ],
  // TO-92, flat face toward the viewer: emitter, base, collector.
  npn: [
    [0, 0],
    [1, 0],
    [2, 0],
  ],
  buzzer: [
    [0, 0],
    [3, 0],
  ],
  ne555: dip(8),
  cd4017: dip(16),
};

function dip(n: number): [number, number][] {
  const half = n / 2;
  const pins: [number, number][] = [];
  for (let i = 0; i < half; i++) pins.push([i, 0]);
  for (let i = half - 1; i >= 0; i--) pins.push([i, -3]);
  return pins;
}

export function rotate(dx: number, dy: number, rot: number): [number, number] {
  switch (((rot % 4) + 4) % 4) {
    case 1:
      return [-dy, dx];
    case 2:
      return [-dx, -dy];
    case 3:
      return [dy, -dx];
    default:
      return [dx, dy];
  }
}

export function isTwoLead(kind: Kind): boolean {
  return kind in TWO_LEAD || kind === 'battery';
}

/** The hole under each pin, or null for a pin that misses the board. */
export function pinHoles(p: Part): (Hole | null)[] {
  if (isTwoLead(p.kind)) return [p.a ? (HOLE.get(p.a) ?? null) : null, p.b ? (HOLE.get(p.b) ?? null) : null];
  return pinHolesAt(p.kind, p.at, p.rot ?? 0);
}

export function pinHolesAt(kind: Kind, at: string | undefined, rot: number): (Hole | null)[] {
  const fp = FOOTPRINT[kind] ?? [];
  const h0 = at ? HOLE.get(at) : undefined;
  return fp.map(([dx, dy]) => {
    if (!h0) return null;
    const [rx, ry] = rotate(dx, dy, rot);
    return holeAt(h0.x + rx, h0.y + ry);
  });
}

/** The point a footprint part is drawn around (the middle of its pins), in units. */
export function footprintCentre(kind: Kind, x: number, y: number, rot: number): [number, number] {
  const fp = FOOTPRINT[kind] ?? [[0, 0]];
  let sx = 0,
    sy = 0;
  for (const [dx, dy] of fp) {
    const [rx, ry] = rotate(dx, dy, rot);
    sx += rx;
    sy += ry;
  }
  return [x + sx / fp.length, y + sy / fp.length];
}

/** Which holes are taken, and by which part. */
export function occupancy(parts: Part[], except?: string): Map<string, string> {
  const occ = new Map<string, string>();
  for (const p of parts) {
    if (p.id === except) continue;
    for (const h of pinHoles(p)) if (h) occ.set(h.id, p.id);
  }
  return occ;
}

export const RES_VALUES = [100, 220, 330, 470, 1e3, 2.2e3, 4.7e3, 10e3, 22e3, 47e3, 68e3, 100e3, 1e6];
export const ECAP_VALUES = [1e-6, 10e-6, 100e-6, 470e-6];
export const CAP_VALUES = [10e-9, 100e-9];
export const LED_COLORS: LedColor[] = ['red', 'yellow', 'green', 'blue', 'white'];
export const WIRE_COLORS = ['red', 'black', 'blue', 'green', 'yellow', 'orange', 'white'];

export function fmtOhms(r: number): string {
  if (r >= 1e6) return `${trim(r / 1e6)} MΩ`;
  if (r >= 1e3) return `${trim(r / 1e3)} kΩ`;
  return `${trim(r)} Ω`;
}

export function fmtFarads(c: number): string {
  if (c >= 1e-6) return `${trim(c * 1e6)} µF`;
  if (c >= 1e-9) return `${trim(c * 1e9)} nF`;
  return `${trim(c * 1e12)} pF`;
}

function trim(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

/** Ceramic capacitor code: two digits and a power of ten, in picofarads. */
export function capCode(c: number): string {
  const pf = Math.round(c * 1e12);
  const e = Math.max(0, Math.floor(Math.log10(pf)) - 1);
  return `${Math.round(pf / 10 ** e)}${e}`;
}

const BAND = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];

/** Four-band colour code for a resistor: two digits, a multiplier, and gold for 5%. */
export function resistorBands(r: number): string[] {
  const e = Math.floor(Math.log10(r)) - 1;
  const digits = Math.round(r / 10 ** e);
  return [BAND[Math.floor(digits / 10)], BAND[digits % 10], BAND[e], 'gold'];
}

export function partName(p: Part): string {
  switch (p.kind) {
    case 'wire':
      return 'Jumper wire';
    case 'res':
      return `${fmtOhms(p.value ?? 1e3)} resistor`;
    case 'led':
      return `${cap1(p.color ?? 'red')} LED`;
    case 'ecap':
      return `${fmtFarads(p.value ?? 10e-6)} electrolytic capacitor`;
    case 'cap':
      return `${fmtFarads(p.value ?? 100e-9)} ceramic capacitor`;
    case 'ldr':
      return 'Light-dependent resistor';
    case 'button':
      return 'Push button';
    case 'pot':
      return '10 kΩ trimmer';
    case 'npn':
      return '2N3904 NPN transistor';
    case 'ne555':
      return 'NE555 timer';
    case 'cd4017':
      return 'CD4017 decade counter';
    case 'buzzer':
      return 'Buzzer';
    case 'battery':
      return '9 V battery';
  }
}

function cap1(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const PIN_NAMES: Partial<Record<Kind, string[]>> = {
  ne555: ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DIS', 'VCC'],
  cd4017: ['Q5', 'Q1', 'Q0', 'Q2', 'Q6', 'Q7', 'Q3', 'VSS', 'Q8', 'Q4', 'Q9', 'CO', 'INH', 'CLK', 'RST', 'VDD'],
  npn: ['E', 'B', 'C'],
  pot: ['1', 'W', '3'],
  buzzer: ['+', '−'],
};

export interface CompileOptions {
  power: boolean;
  lux: number;
  /** LDRs a finger is covering, and buttons being held. */
  covered: Set<string>;
  pressed: Set<string>;
  meter: { mode: MeterMode; red: string | null; black: string | null };
}

export interface Compiled {
  circuit: Circuit;
  /** Net index for each strip, or -1 when no part uses that strip's net. */
  netOfStrip: Int32Array;
  /** Strips joined into one net share a root. */
  rootOfStrip: Int32Array;
}

/** Join strips by wires and button legs, then list each part as a solver device on those nets. */
export function compile(parts: Part[], o: CompileOptions): Compiled {
  const parent = new Int32Array(STRIPS);
  for (let i = 0; i < STRIPS; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const holes = new Map<string, (Hole | null)[]>();
  for (const p of parts) holes.set(p.id, pinHoles(p));
  for (const p of parts) {
    const h = holes.get(p.id)!;
    if (p.kind === 'wire' && h[0] && h[1]) union(h[0].strip, h[1].strip);
    if (p.kind === 'button') {
      if (h[0] && h[1]) union(h[0].strip, h[1].strip);
      if (h[2] && h[3]) union(h[2].strip, h[3].strip);
    }
  }
  const rootOfStrip = new Int32Array(STRIPS);
  for (let i = 0; i < STRIPS; i++) rootOfStrip[i] = find(i);
  const netOfRoot = new Map<number, number>();
  let nets = 0;
  const net = (h: Hole | null): number => {
    // A leg off the board gets a net of its own.
    if (!h) return nets++;
    const r = rootOfStrip[h.strip];
    let n = netOfRoot.get(r);
    if (n === undefined) {
      n = nets++;
      netOfRoot.set(r, n);
    }
    return n;
  };
  const devices: Device[] = [];
  let ground = -1;
  for (const p of parts) {
    const h = holes.get(p.id)!;
    switch (p.kind) {
      case 'battery': {
        const plus = net(h[0]),
          minus = net(h[1]);
        if (h[1]) ground = minus;
        devices.push({ t: 'battery', id: p.id, n: [plus, minus], v: 9, r: 1.5, on: o.power });
        break;
      }
      case 'res':
        devices.push({ t: 'res', id: p.id, n: [net(h[0]), net(h[1])], r: p.value ?? 1e3 });
        break;
      case 'led':
        devices.push({ t: 'led', id: p.id, n: [net(h[0]), net(h[1])], color: (p.color as LedColor) ?? 'red' });
        break;
      case 'ecap':
      case 'cap':
        devices.push({
          t: 'cap',
          id: p.id,
          n: [net(h[0]), net(h[1])],
          c: p.value ?? 10e-6,
          polar: p.kind === 'ecap',
        });
        break;
      case 'ldr':
        devices.push({
          t: 'ldr',
          id: p.id,
          n: [net(h[0]), net(h[1])],
          lux: o.covered.has(p.id) ? o.lux * 0.03 : o.lux,
        });
        break;
      case 'button':
        devices.push({ t: 'button', id: p.id, n: [net(h[0]), net(h[2])], pressed: o.pressed.has(p.id) });
        break;
      case 'pot':
        devices.push({ t: 'pot', id: p.id, n: [net(h[0]), net(h[1]), net(h[2])], r: 10e3, pos: p.pos ?? 0.5 });
        break;
      case 'npn':
        devices.push({ t: 'npn', id: p.id, n: [net(h[0]), net(h[1]), net(h[2])] });
        break;
      case 'buzzer':
        devices.push({ t: 'buzzer', id: p.id, n: [net(h[0]), net(h[1])] });
        break;
      case 'ne555':
        devices.push({ t: 'ne555', id: p.id, n: h.map(net) });
        break;
      case 'cd4017':
        devices.push({ t: 'cd4017', id: p.id, n: h.map(net) });
        break;
      case 'wire':
        break;
    }
  }
  const { meter } = o;
  if (meter.mode !== 'off' && meter.red && meter.black) {
    const r = HOLE.get(meter.red) ?? null,
      b = HOLE.get(meter.black) ?? null;
    if (r && b) devices.push({ t: 'meter', id: 'meter', n: [net(r), net(b)], mode: meter.mode });
  }
  const netOfStrip = new Int32Array(STRIPS).fill(-1);
  for (let i = 0; i < STRIPS; i++) {
    const n = netOfRoot.get(rootOfStrip[i]);
    if (n !== undefined) netOfStrip[i] = n;
  }
  if (nets === 0) nets = 1;
  return { circuit: { nets, ground: ground < 0 ? 0 : ground, devices }, netOfStrip, rootOfStrip };
}
