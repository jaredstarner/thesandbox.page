// The catalogue: each plate is an encounter, a moment, and a way of looking at it.
// Encounters are set up after Toomre and Toomre (1972) where the paper gave
// them, and tuned by eye against the real pairs where it did not.

import type { Encounter } from './_orbit';

export interface View {
  /** Turn of the pair about the orbit's axis, degrees. */
  az: number;
  /** Tilt away from looking straight down on the orbit, degrees. */
  el: number;
  /** Roll of the picture on the plate, degrees. */
  roll: number;
  /** Half the plate's width, kpc. */
  extent: number;
}

export interface Plate {
  id: string;
  cat: string;
  /** Short label for the plate's corner. */
  no: string;
  name: string;
  ngc: string;
  caption: string;
  enc: Encounter;
  /** Myr after closest approach. */
  time: number;
  view: View;
}

export const PLATES: Plate[] = [
  {
    id: 'antennae',
    cat: 'Arp 244',
    no: '244',
    name: 'The Antennae',
    ngc: 'NGC 4038 and 4039',
    caption:
      'Two equal spirals on a bound orbit, each disk tilted 60° to it, seen edge on 600 million years after the first pass. From this side the two tails seem to cross below the pair, though they never meet.',
    enc: {
      ratio: 1,
      peri: 20,
      ecc: 0.5,
      a: { tilt: 60, turn: -30, on: true },
      b: { tilt: 60, turn: -30, on: true },
    },
    time: 600,
    view: { az: -60, el: 90, roll: 0, extent: 100 },
  },
  {
    id: 'mice',
    cat: 'Arp 242',
    no: '242',
    name: 'The Mice',
    ngc: 'NGC 4676 A and B',
    caption:
      'A first close pass between equal galaxies. One disk lies nearly in the orbit plane and throws a long straight tail; the other is steeply tilted and seen almost edge on.',
    enc: {
      ratio: 1,
      peri: 22,
      ecc: 0.8,
      a: { tilt: 25, turn: -100, on: true },
      b: { tilt: 70, turn: -90, on: true },
    },
    time: 190,
    view: { az: -40, el: 70, roll: 0, extent: 55 },
  },
  {
    id: 'whirlpool',
    cat: 'Arp 85',
    no: '85',
    name: 'The Whirlpool',
    ngc: 'M51 and NGC 5195',
    caption:
      'A companion a third the mass swings past a large disk on a bound orbit. Its pull raises two long spiral arms, and one of them reaches out to it as a bridge.',
    enc: {
      ratio: 0.35,
      peri: 18,
      ecc: 0.6,
      a: { tilt: 25, turn: -90, on: true },
      b: { tilt: 0, turn: 0, on: false },
    },
    time: 200,
    view: { az: 0, el: 20, roll: 0, extent: 45 },
  },
  {
    id: 'bridge',
    cat: 'Arp 295',
    no: '295',
    name: 'A long bridge',
    ngc: 'Arp 295 A and B',
    caption:
      'Two disks spinning the same way as the pass, on a parabolic orbit. Each pulls a bridge of stars toward the other and flings a counter-tail away behind it.',
    enc: {
      ratio: 1,
      peri: 28,
      ecc: 1,
      a: { tilt: 0, turn: 0, on: true },
      b: { tilt: 0, turn: 0, on: true },
    },
    time: 260,
    view: { az: 0, el: 30, roll: 0, extent: 80 },
  },
  {
    id: 'ring',
    cat: 'Arp 147',
    no: '147',
    name: 'A ring',
    ngc: 'Arp 147',
    caption:
      'A smaller galaxy drops straight through the middle of a disk. Its passing pull sends a ring of stars rolling outward, like a stone thrown into a pond.',
    enc: {
      ratio: 0.45,
      peri: 2,
      ecc: 1,
      a: { tilt: 90, turn: 0, on: true },
      b: { tilt: 0, turn: 0, on: false },
    },
    time: 120,
    view: { az: 0, el: 50, roll: 0, extent: 40 },
  },
  {
    id: 'spin',
    cat: 'Toomre, 1972',
    no: 'T',
    name: 'With and against',
    ngc: 'Direct and retrograde',
    caption:
      'One pass, two identical disks. The lower one spins the same way the pair goes round and is torn into a bridge and a tail; the upper one spins against it and keeps its shape.',
    enc: {
      ratio: 1,
      peri: 25,
      ecc: 1,
      a: { tilt: 0, turn: 0, on: true },
      b: { tilt: 180, turn: 0, on: true },
    },
    time: 300,
    view: { az: 0, el: 0, roll: 0, extent: 80 },
  },
];
