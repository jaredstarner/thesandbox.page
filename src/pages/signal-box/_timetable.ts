// Signal box: the working timetable for each turn of duty, and the trains in it.

import { CLASSES, type TrainClass } from './_codes';
import { PASS_S, PATH_BOXES, type BoxId, type PathId } from './_layout';

export type ShiftId = 'early' | 'day' | 'night';

export type VehicleKind =
  'diesel' | 'steam' | 'tender' | 'dmu' | 'coach' | 'van' | 'open' | 'mineral' | 'tank' | 'brake' | 'sleeper';

export interface Vehicle {
  kind: VehicleKind;
  len: number;
  /** A small per-vehicle number for variety in the drawing. */
  v: number;
}

export interface Booking {
  hc: string;
  cls: TrainClass;
  path: PathId;
  /** Seconds after the shift starts that the train is booked to pass the box. */
  booked: number;
  /** A tail lamp gone out, or never lit. */
  noTailLamp?: boolean;
  /** Steam on a freight; otherwise diesel. */
  steam?: boolean;
}

export interface Shift {
  id: ShiftId;
  name: string;
  /** Clock time the shift opens, seconds after midnight. */
  start: number;
  bookings: Booking[];
}

const m = (min: number, sec = 0) => min * 60 + sec;

export const SHIFTS: Shift[] = [
  {
    id: 'early',
    name: 'Early turn',
    start: 5 * 3600 + 40 * 60,
    bookings: [
      { hc: '2B04', cls: 'stopping', path: 'DB', booked: m(2, 40) },
      { hc: '8F31', cls: 'freight', path: 'UM', booked: m(4, 50), steam: true },
      { hc: '1A02', cls: 'express', path: 'DM', booked: m(7, 30) },
      { hc: '2B05', cls: 'stopping', path: 'UB', booked: m(8, 40) },
      { hc: '0B70', cls: 'light', path: 'DB', booked: m(12, 0) },
      { hc: '1V17', cls: 'express', path: 'UM', booked: m(13, 10) },
      { hc: '4M48', cls: 'expressFreight', path: 'DM', booked: m(16, 20) },
      { hc: '2B09', cls: 'stopping', path: 'UB', booked: m(17, 40) },
      { hc: '2B12', cls: 'stopping', path: 'DB', booked: m(21, 0) },
      { hc: '7F44', cls: 'mineral', path: 'UM', booked: m(22, 30), steam: true },
      { hc: '1A08', cls: 'express', path: 'DM', booked: m(26, 0) },
      { hc: '5B71', cls: 'ecs', path: 'UB', booked: m(27, 50) },
    ],
  },
  {
    id: 'day',
    name: 'Afternoon turn',
    start: 13 * 3600 + 20 * 60,
    bookings: [
      { hc: '1A31', cls: 'express', path: 'DM', booked: m(2, 20) },
      { hc: '2B33', cls: 'stopping', path: 'UB', booked: m(3, 10) },
      { hc: '1V40', cls: 'express', path: 'UM', booked: m(4, 50) },
      { hc: '2B36', cls: 'stopping', path: 'DB', booked: m(6, 40) },
      { hc: '6M12', cls: 'expressFreight', path: 'UM', booked: m(8, 50) },
      { hc: '1A35', cls: 'express', path: 'DM', booked: m(10, 30) },
      { hc: '9B52', cls: 'freight', path: 'UB', booked: m(12, 0), steam: true },
      { hc: '2B40', cls: 'stopping', path: 'DB', booked: m(14, 30) },
      { hc: '1V44', cls: 'express', path: 'UM', booked: m(15, 40) },
      { hc: '4M60', cls: 'expressFreight', path: 'DM', booked: m(18, 0) },
      { hc: '2B41', cls: 'stopping', path: 'UB', booked: m(19, 0) },
      { hc: '0F72', cls: 'light', path: 'UM', booked: m(21, 20) },
      { hc: '1A39', cls: 'express', path: 'DM', booked: m(23, 10) },
      { hc: '2B44', cls: 'stopping', path: 'DB', booked: m(25, 30) },
    ],
  },
  {
    id: 'night',
    name: 'Night turn',
    start: 22 * 3600 + 30 * 60,
    bookings: [
      { hc: '6V20', cls: 'expressFreight', path: 'UM', booked: m(2, 50) },
      { hc: '1A80', cls: 'express', path: 'DM', booked: m(4, 10) },
      { hc: '8B14', cls: 'freight', path: 'UB', booked: m(6, 40), steam: true, noTailLamp: true },
      { hc: '4M75', cls: 'expressFreight', path: 'DM', booked: m(9, 0) },
      { hc: '1S56', cls: 'express', path: 'UM', booked: m(11, 20) },
      { hc: '7B30', cls: 'mineral', path: 'DB', booked: m(14, 40), steam: true },
      { hc: '3C81', cls: 'ecs', path: 'DM', booked: m(17, 30) },
      { hc: '6V24', cls: 'expressFreight', path: 'UM', booked: m(19, 10) },
      { hc: '2B90', cls: 'stopping', path: 'UB', booked: m(21, 30) },
      { hc: '1A84', cls: 'express', path: 'DM', booked: m(24, 0) },
    ],
  },
];

export const SHIFT = new Map(SHIFTS.map((s) => [s.id, s]));

/** A small seeded random source, so a shift's trains look the same every time. */
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

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The vehicles in a train, front first. */
export function consist(b: Booking, night: boolean): Vehicle[] {
  const r = rng(hash(b.hc));
  const out: Vehicle[] = [];
  const loco = () => {
    if (b.steam) {
      out.push({ kind: 'steam', len: 13.5, v: Math.floor(r() * 4) });
      out.push({ kind: 'tender', len: 7.5, v: 0 });
    } else out.push({ kind: 'diesel', len: 19.5, v: Math.floor(r() * 4) });
  };
  const add = (kind: VehicleKind, len: number, n: number) => {
    for (let i = 0; i < n; i++) out.push({ kind, len, v: Math.floor(r() * 4) });
  };
  switch (b.cls) {
    case 'express':
      loco();
      if (night && b.path === 'UM') {
        add('coach', 20, 3);
        add('sleeper', 20, 6);
      } else add('coach', 20, 9 + Math.floor(r() * 2));
      break;
    case 'stopping':
      add('dmu', 18.5, 2 + (r() < 0.3 ? 1 : 0));
      break;
    case 'ecs':
      loco();
      add('coach', 20, 7);
      break;
    case 'light':
      loco();
      break;
    case 'expressFreight':
      loco();
      add('van', 6.5, 22 + Math.floor(r() * 8));
      add('brake', 7.5, 1);
      break;
    case 'freight':
      loco();
      for (let i = 0; i < 24; i++) {
        const k = r();
        out.push(
          k < 0.45
            ? { kind: 'open', len: 5.8, v: Math.floor(r() * 4) }
            : k < 0.75
              ? { kind: 'van', len: 6.5, v: Math.floor(r() * 4) }
              : { kind: 'tank', len: 7.2, v: Math.floor(r() * 4) },
        );
      }
      add('brake', 7.5, 1);
      break;
    case 'mineral':
      loco();
      add('mineral', 5.5, 34);
      add('brake', 7.5, 1);
      break;
  }
  return out;
}

export function trainLength(vs: Vehicle[]): number {
  return vs.reduce((a, v) => a + v.len + 0.6, 0);
}

/** Seconds from standing at the box in rear's starting signal to passing this box, at the class's best. */
export function runTime(b: Booking): number {
  const c = CLASSES[b.cls];
  const spin = c.vmax / (2 * c.accel);
  const v = b.path === 'DB' || b.path === 'UB' ? Math.min(c.vmax, 22.4) : c.vmax;
  return PASS_S / v + spin + 8;
}

export function originOf(b: Booking): BoxId {
  return PATH_BOXES[b.path].from;
}

export function destOf(b: Booking): BoxId {
  return PATH_BOXES[b.path].to;
}

/** "05:42", or "05:42:30" with seconds. */
export function clock(t: number, seconds = false): string {
  const s = Math.floor(((t % 86400) + 86400) % 86400);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  if (!seconds) return `${hh}:${mm}`;
  return `${hh}:${mm}:${String(s % 60).padStart(2, '0')}`;
}
