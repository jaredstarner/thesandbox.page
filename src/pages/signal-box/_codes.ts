// Signal box: the bell codes, and the trains they describe.
//
// Codes follow British Railways' Regulations for Train Signalling of 1960: beats in
// groups, written with dashes, so 3-1 is three beats, a pause, and one more.

export type TrainClass = 'express' | 'stopping' | 'expressFreight' | 'freight' | 'mineral' | 'light' | 'ecs';

export interface ClassDef {
  code: string;
  /** What the bell asks, after "Is line clear for". */
  asks: string;
  /** The short description in the register. */
  short: string;
  /** Line speed, metres per second. */
  vmax: number;
  /** Acceleration and service braking, m/s². */
  accel: number;
  brake: number;
}

export const CLASSES: Record<TrainClass, ClassDef> = {
  express: { code: '4', asks: 'an express passenger train', short: 'Express', vmax: 33.5, accel: 0.32, brake: 0.62 },
  stopping: { code: '3-1', asks: 'an ordinary passenger train', short: 'Passenger', vmax: 22.4, accel: 0.5, brake: 0.7 },
  expressFreight: {
    code: '3-1-1',
    asks: 'an express freight train',
    short: 'Exp. freight',
    vmax: 22.4,
    accel: 0.14,
    brake: 0.34,
  },
  freight: { code: '3', asks: 'a stopping freight train', short: 'Freight', vmax: 15.6, accel: 0.1, brake: 0.26 },
  mineral: { code: '4-1', asks: 'a mineral or empty wagon train', short: 'Mineral', vmax: 15.6, accel: 0.09, brake: 0.24 },
  light: { code: '2-3', asks: 'a light engine', short: 'Light eng.', vmax: 20, accel: 0.45, brake: 0.6 },
  ecs: { code: '2-2-1', asks: 'an empty coaching stock train', short: 'E.C.S.', vmax: 22.4, accel: 0.3, brake: 0.55 },
};

export const CLASS_BY_CODE = new Map(Object.entries(CLASSES).map(([k, c]) => [c.code, k as TrainClass]));

/** Every code the box understands, with what it means. */
export const CODES: [string, string][] = [
  ['1', 'Call attention'],
  ['4', 'Is line clear for an express passenger train?'],
  ['3-1', 'Is line clear for an ordinary passenger train?'],
  ['3-1-1', 'Is line clear for an express freight train?'],
  ['3', 'Is line clear for a stopping freight train?'],
  ['4-1', 'Is line clear for a mineral or empty wagon train?'],
  ['2-2-1', 'Is line clear for an empty coaching stock train?'],
  ['2-3', 'Is line clear for a light engine?'],
  ['2', 'Train entering section'],
  ['2-1', 'Train out of section'],
  ['3-5', 'Cancelling: take back Is line clear or Train entering section'],
  ['9', 'Train passed without a tail lamp (to the box in advance)'],
  ['4-5', 'Train passed without a tail lamp (to the box in rear)'],
  ['6', 'Obstruction danger'],
  ['16', 'Testing bells'],
];

export const CODE_MEANING = new Map(CODES);

export function isLineClearCode(code: string): boolean {
  return CLASS_BY_CODE.has(code);
}

/** Beats, in groups, as a code string: [3, 1] is "3-1". */
export function codeOf(groups: number[]): string {
  return groups.join('-');
}

export function groupsOf(code: string): number[] {
  return code.split('-').map((g) => Number(g));
}

/** Gaps, in seconds: beats closer than BEAT_GAP are one group; silence past CODE_END finishes the code. */
export const BEAT_GAP = 0.42;
export const CODE_END = 1.25;

/** Beat times, in seconds from the first, for a box ringing a code at an even pace. */
export function beatTimes(code: string): number[] {
  const out: number[] = [];
  let t = 0;
  for (const [gi, n] of groupsOf(code).entries()) {
    if (gi > 0) t += 0.62;
    for (let i = 0; i < n; i++) {
      if (i > 0) t += 0.24;
      out.push(t);
    }
  }
  return out;
}

/** Split a run of tap times into groups by the pauses between them. */
export function parseTaps(times: number[]): string {
  if (times.length === 0) return '';
  const groups: number[] = [1];
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > BEAT_GAP) groups.push(1);
    else groups[groups.length - 1]++;
  }
  return codeOf(groups);
}
