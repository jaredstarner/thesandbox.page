// Stock designs from the shop's pattern book.

import type { Style } from './_plan';

export interface Preset {
  name: string;
  lines: [string, Style, string][];
}

export const PRESETS: Preset[] = [
  {
    name: 'Open late',
    lines: [
      ['Open', 'script', 'neon-clear'],
      ['LATE', 'sans', 'argon-clear'],
    ],
  },
  {
    name: 'Cocktails',
    lines: [
      ['Cocktails', 'script', 'coat-pink'],
      ['LOUNGE', 'square', 'coat-turquoise'],
    ],
  },
  {
    name: 'No vacancy',
    lines: [
      ['No', 'script', 'neon-ruby'],
      ['VACANCY', 'sans', 'neon-clear'],
    ],
  },
  {
    name: 'Hot coffee',
    lines: [
      ['Hot', 'script', 'argon-canary'],
      ['COFFEE', 'square', 'coat-white'],
    ],
  },
  {
    name: 'Records',
    lines: [
      ['Records', 'script', 'argon-cobalt'],
      ['BOUGHT & SOLD', 'sans', 'helium-clear'],
    ],
  },
  {
    name: 'Rooms',
    lines: [
      ['Rooms', 'script', 'coat-green'],
      ['TV  BATH  AIR', 'square', 'neon-clear'],
    ],
  },
];
