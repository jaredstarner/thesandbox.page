// Named starting points, each a different way of holding a pen.

import type { Params } from './_skeleton';

export interface Preset {
  id: string;
  name: string;
  note: string;
  params: Params;
}

export const PRESETS: Preset[] = [
  {
    id: 'chancery',
    name: 'Chancery',
    note: 'An edged pen at 35°, leaning, the arches springing low',
    params: {
      pen: 'broad',
      nib: 92,
      contrast: 0.14,
      angle: 35,
      slant: 8,
      width: 0.92,
      xheight: 0.66,
      round: 2.1,
      branch: 0.8,
      serif: 'hook',
    },
  },
  {
    id: 'book',
    name: 'Book roman',
    note: 'An edged pen at 26°, upright, with flat serifs',
    params: {
      pen: 'broad',
      nib: 92,
      contrast: 0.12,
      angle: 26,
      slant: 0,
      width: 1.18,
      xheight: 0.64,
      round: 2.0,
      branch: 0.1,
      serif: 'slab',
    },
  },
  {
    id: 'didone',
    name: 'Didone',
    note: 'The edge held level, so all the weight falls on the verticals',
    params: {
      pen: 'broad',
      nib: 112,
      contrast: 0.06,
      angle: 0,
      slant: 0,
      width: 1.04,
      xheight: 0.64,
      round: 2.3,
      branch: 0.05,
      serif: 'slab',
    },
  },
  {
    id: 'rustic',
    name: 'Rustic',
    note: 'The edge stood nearly upright: thin stems, heavy crossbars',
    params: {
      pen: 'broad',
      nib: 70,
      contrast: 0.12,
      angle: 80,
      slant: 0,
      width: 1.22,
      xheight: 0.7,
      round: 2.5,
      branch: 0.1,
      serif: 'slab',
    },
  },
  {
    id: 'grotesque',
    name: 'Grotesque',
    note: 'A round pen: one weight all the way round',
    params: {
      pen: 'round',
      nib: 76,
      contrast: 1,
      angle: 0,
      slant: 0,
      width: 1.08,
      xheight: 0.7,
      round: 2.4,
      branch: 0.15,
      serif: 'none',
    },
  },
  {
    id: 'egyptian',
    name: 'Egyptian',
    note: 'A round pen, heavy, with square slabs',
    params: {
      pen: 'round',
      nib: 104,
      contrast: 1,
      angle: 0,
      slant: 0,
      width: 1.2,
      xheight: 0.68,
      round: 2.8,
      branch: 0.1,
      serif: 'slab',
    },
  },
  {
    id: 'copperplate',
    name: 'Copperplate',
    note: 'A pointed pen that swells on every downstroke',
    params: {
      pen: 'pointed',
      nib: 100,
      contrast: 0.16,
      angle: 0,
      slant: 16,
      width: 0.82,
      xheight: 0.56,
      round: 2.0,
      branch: 0.7,
      serif: 'hook',
    },
  },
];
