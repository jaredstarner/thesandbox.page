// The loom's draft: threading, tie-up, treadling, and the colour orders of
// warp and weft, plus the yarns and the pattern book of drafts to start from.

export const SHAFTS = 4;
export const TREADLES = 6;
/** Warp ends on the loom. */
export const ENDS = 64;
/** The longest treadling repeat the draft holds. */
export const MAX_REPEAT = 32;
/** Ends and picks per centimetre. */
export const SETT = 8;
/** Tabby picks woven to spread the warp after tying on, before the cloth proper. */
export const HEADER_PICKS = 6;

export interface Yarn {
  id: string;
  name: string;
  /** Linear-ish sRGB components, 0 to 255. */
  rgb: [number, number, number];
}

// Wool in natural dyes and undyed fleece.
export const YARNS: Yarn[] = [
  { id: 'undyed', name: 'Undyed', rgb: [226, 214, 190] },
  { id: 'charcoal', name: 'Black fleece', rgb: [48, 43, 40] },
  { id: 'indigo', name: 'Indigo', rgb: [36, 56, 98] },
  { id: 'woad', name: 'Woad', rgb: [118, 148, 182] },
  { id: 'madder', name: 'Madder', rgb: [164, 54, 42] },
  { id: 'weld', name: 'Weld', rgb: [214, 172, 66] },
  { id: 'walnut', name: 'Walnut', rgb: [112, 80, 56] },
  { id: 'moss', name: 'Weld over indigo', rgb: [86, 104, 58] },
];

export const hex = (rgb: [number, number, number]) =>
  '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export interface Draft {
  /** The shaft, 0 to 3, each warp end is threaded through. */
  threading: number[];
  /** The yarn of each warp end. */
  warp: number[];
  /** tieup[treadle][shaft]: the treadle lifts the shaft. */
  tieup: boolean[][];
  /** The treadle for each pick of the repeat. */
  treadling: number[];
  /** The yarn of each pick of the repeat. */
  weft: number[];
}

/** Bit s set when the treadle lifts shaft s. */
export function liftMask(tieup: boolean[][], treadle: number): number {
  let m = 0;
  for (let s = 0; s < SHAFTS; s++) if (tieup[treadle]?.[s]) m |= 1 << s;
  return m;
}

/** Which ends a shed raises: the ends threaded on the lifted shafts. */
export function raisedEnds(threading: number[], mask: number): Uint8Array {
  const out = new Uint8Array(threading.length);
  for (let j = 0; j < threading.length; j++) out[j] = (mask >> threading[j]) & 1;
  return out;
}

export function cloneDraft(d: Draft): Draft {
  return {
    threading: d.threading.slice(),
    warp: d.warp.slice(),
    tieup: d.tieup.map((row) => row.slice()),
    treadling: d.treadling.slice(),
    weft: d.weft.slice(),
  };
}

const tile = (unit: number[], n: number) => Array.from({ length: n }, (_, i) => unit[i % unit.length]);

/** Expand [yarn, count] runs into a colour order. */
const runs = (spec: [number, number][]) => spec.flatMap(([yarn, count]) => Array<number>(count).fill(yarn));

/** A tie-up from the shafts each treadle lifts, numbered from 1 as weavers write them. */
const tie = (lifts: number[][]) =>
  Array.from({ length: TREADLES }, (_, t) =>
    Array.from({ length: SHAFTS }, (_, s) => (lifts[t] ?? []).includes(s + 1)),
  );

/** Shafts and treadles counted from 1, as in a written draft. */
const from1 = (seq: number[]) => seq.map((n) => n - 1);

// Treadles 1 to 4 weave a 2/2 twill, 5 and 6 the two tabby sheds.
const TWILL_TIEUP = tie([[1, 2], [2, 3], [3, 4], [4, 1], [1, 3], [2, 4]]);
// A 3/1 twill: three shafts up on every twill treadle, so the warp shows on the face.
const WARP_FACED_TIEUP = tie([[1, 2, 3], [2, 3, 4], [3, 4, 1], [4, 1, 2], [1, 3], [2, 4]]);

const STRAIGHT = from1([1, 2, 3, 4]);
const POINT = from1([1, 2, 3, 4, 3, 2]);
// Reversed with a skipped shaft at each turn, so the twill breaks cleanly instead of pointing.
const HERRINGBONE = from1([1, 2, 3, 4, 1, 2, 3, 4, 2, 1, 4, 3, 2, 1, 4, 3]);
const ROSEPATH = from1([1, 2, 3, 4, 1, 4, 3, 2]);

const Y = Object.fromEntries(YARNS.map((y, i) => [y.id, i])) as Record<string, number>;

export interface Preset {
  id: string;
  name: string;
  /** One line for the pattern book. */
  note: string;
  draft: Draft;
}

const glen = [...runs([[Y.charcoal, 4], [Y.undyed, 4]]), ...runs([[Y.charcoal, 4], [Y.undyed, 4]]), ...tile(runs([[Y.charcoal, 2], [Y.undyed, 2]]), 16)];

const tartanHalf = runs([
  [Y.madder, 1],
  [Y.charcoal, 3],
  [Y.moss, 6],
  [Y.weld, 1],
  [Y.moss, 2],
  [Y.indigo, 3],
]);
const tartan = [...tartanHalf, ...tartanHalf.slice().reverse()];

const logCabin = [...tile([Y.indigo, Y.undyed], 8), ...tile([Y.undyed, Y.indigo], 8)];

export const PRESETS: Preset[] = [
  {
    id: 'gingham',
    name: 'Gingham',
    note: 'Plain weave in centimetre checks',
    draft: {
      threading: tile(STRAIGHT, ENDS),
      warp: tile(runs([[Y.madder, 8], [Y.undyed, 8]]), ENDS),
      tieup: TWILL_TIEUP,
      treadling: tile(from1([5, 6]), 16),
      weft: runs([[Y.madder, 8], [Y.undyed, 8]]),
    },
  },
  {
    id: 'denim',
    name: 'Denim',
    note: 'A 3/1 twill, indigo warp on undyed weft',
    draft: {
      threading: tile(STRAIGHT, ENDS),
      warp: tile([Y.indigo], ENDS),
      tieup: WARP_FACED_TIEUP,
      treadling: from1([1, 2, 3, 4]),
      weft: tile([Y.undyed], 4),
    },
  },
  {
    id: 'chevron',
    name: 'Chevron',
    note: 'Point threading turns the twill back on itself',
    draft: {
      threading: tile(POINT, ENDS),
      warp: tile([Y.walnut], ENDS),
      tieup: TWILL_TIEUP,
      treadling: from1([1, 2, 3, 4]),
      weft: tile([Y.weld], 4),
    },
  },
  {
    id: 'herringbone',
    name: 'Herringbone',
    note: 'The same twill, reversed with a break',
    draft: {
      threading: tile(HERRINGBONE, ENDS),
      warp: tile([Y.charcoal], ENDS),
      tieup: TWILL_TIEUP,
      treadling: from1([1, 2, 3, 4]),
      weft: tile([Y.undyed], 4),
    },
  },
  {
    id: 'goose-eye',
    name: 'Goose-eye',
    note: 'Pointed both ways, into diamonds',
    draft: {
      threading: tile(POINT, ENDS),
      warp: tile([Y.undyed], ENDS),
      tieup: TWILL_TIEUP,
      treadling: from1([1, 2, 3, 4, 3, 2]),
      weft: tile([Y.indigo], 6),
    },
  },
  {
    id: 'rosepath',
    name: 'Rosepath',
    note: 'Treadled as drawn in, in bands of colour',
    draft: {
      threading: tile(ROSEPATH, ENDS),
      warp: tile([Y.undyed], ENDS),
      tieup: TWILL_TIEUP,
      treadling: tile(from1([1, 2, 3, 4, 1, 4, 3, 2]), 24),
      weft: runs([[Y.madder, 8], [Y.weld, 8], [Y.indigo, 8]]),
    },
  },
  {
    id: 'log-cabin',
    name: 'Log cabin',
    note: 'Plain weave; the colour order makes the blocks',
    draft: {
      threading: tile(STRAIGHT, ENDS),
      warp: tile(logCabin, ENDS),
      tieup: TWILL_TIEUP,
      treadling: tile(from1([5, 6]), 16),
      weft: logCabin.slice(),
    },
  },
  {
    id: 'houndstooth',
    name: 'Houndstooth',
    note: 'A plain 2/2 twill in fours of dark and light',
    draft: {
      threading: tile(STRAIGHT, ENDS),
      warp: tile(runs([[Y.charcoal, 4], [Y.undyed, 4]]), ENDS),
      tieup: TWILL_TIEUP,
      treadling: tile(from1([1, 2, 3, 4]), 8),
      weft: runs([[Y.charcoal, 4], [Y.undyed, 4]]),
    },
  },
  {
    id: 'glen-check',
    name: 'Glen check',
    note: 'Houndstooth blocks crossed with twos',
    draft: {
      threading: tile(STRAIGHT, ENDS),
      warp: tile(glen, ENDS),
      tieup: TWILL_TIEUP,
      treadling: tile(from1([1, 2, 3, 4]), 32),
      weft: glen.slice(),
    },
  },
  {
    id: 'tartan',
    name: 'Tartan',
    note: 'One sett, mirrored, in warp and weft',
    draft: {
      threading: tile(STRAIGHT, ENDS),
      warp: tile(tartan, ENDS),
      tieup: TWILL_TIEUP,
      treadling: tile(from1([1, 2, 3, 4]), 32),
      weft: tartan.slice(),
    },
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);
