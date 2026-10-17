// The words under each plate: its number, where you stand, and what the plate shows.

import { DIRS, DIR_NAME, LEFT, RIGHT, plan, type Cell, type Dir, type Feature } from './_maze';

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** Plates are numbered through the survey: cell by cell, north, east, south, west. */
export const plateNumber = (cell: Cell, facing: Dir) => plan.cells.indexOf(cell) * 4 + DIRS.indexOf(facing) + 1;

const ON_WALL: Record<Feature['kind'], string> = {
  'stair-up': 'the stair you came down by',
  daylight: 'steps climbing to daylight',
  candle: 'a candle burning in a niche',
  words: 'words cut into the stone',
  grille: 'a barred grille with rock behind it',
};

function capital(s: string) {
  return s[0]!.toUpperCase() + s.slice(1);
}

export function describe(cell: Cell, facing: Dir, ahead: number | null, feature: Feature | undefined) {
  const parts: string[] = [];
  if (ahead === null) parts.push('The passage runs on past the reach of the lamp.');
  else if (ahead === 0) parts.push(feature ? `${capital(ON_WALL[feature.kind])}.` : 'A wall, close enough to touch.');
  else {
    const paces = ahead === 1 ? 'one pace' : `${NUMBERS[ahead] ?? ahead} paces`;
    parts.push(
      feature
        ? `${capital(ON_WALL[feature.kind])}, ${paces} ahead.`
        : ahead === 1
          ? 'A wall one pace ahead.'
          : `The passage runs ${paces} to a wall.`,
    );
  }
  const left = cell.open[LEFT[facing]];
  const right = cell.open[RIGHT[facing]];
  if (left && right) parts.push('Openings to the left and right.');
  else if (left) parts.push('An opening to the left.');
  else if (right) parts.push('An opening to the right.');
  if (cell.fromExit <= 4 && cell.fromExit > 0) parts.push('The air is fresher here.');
  return parts.join(' ');
}

export const where = (cell: Cell, facing: Dir) => `${cell.id.toUpperCase()}, looking ${DIR_NAME[facing]}`;
