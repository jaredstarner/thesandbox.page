// One worksheet: what each cell holds, how the cells are grouped, and the block of memory its values live in.

import { CELLS, FormulaError, cellName, colOf, index, parseFormula, rowOf, unparse, type Node } from './_formula';

/** Bytes of cell values in one calculation buffer. */
export const BUFFER = CELLS * 8;
/** Byte offset of the previous tick's values. */
export const PREV = BUFFER;
/** Byte offset of the slots the page and the compiled code share: tick, time, random state, keys. */
export const SYSTEM = BUFFER * 2;
export const SLOT_TICK = 0;
export const SLOT_TIME = 1;
export const SLOT_RANDOM = 2;
export const SLOT_KEYS = 8;
export const PAGES = Math.ceil((SYSTEM + 8 * 256) / 65536);

export const KEYS = ['left', 'right', 'up', 'down', 'space', 'a', 'd', 'w', 's', 'r'];

export interface Area {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export const areaHas = (a: Area, r: number, c: number) => r >= a.r1 && r <= a.r2 && c >= a.c1 && c <= a.c2;

export interface Formula {
  id: number;
  ast: Node;
}

/** A range filled with one formula. Editing any of its cells edits them all. */
export interface Fill extends Area {
  formula: Formula;
}

/** A range drawn as colour: the sheet's conditional format. */
export interface Block extends Area {
  /** Palette lookup, 1,024 packed RGBA entries. */
  palette: Uint32Array;
  min: number;
  max: number;
  /** Decimals shown when zoomed in far enough to read the figures. */
  places: number;
  /** A drag through the block writes `value` in a disc of `radius` cells; Alt writes `erase`. */
  poke?: { value: number; radius: number; erase?: number; write?: (r: number, c: number) => number };
}

export type Align = 'left' | 'right' | 'center';

export interface Merge extends Area {
  /** Text size in sheet units of one cell, so type scales with the zoom. */
  size: number;
  weight: number;
  family: 'label' | 'typed';
  align: Align;
  color: string;
  /** An input box: paper-white, ruled, and meant to be typed in. */
  box?: boolean;
  /** A word that acts when clicked. */
  action?: () => void;
  /** Decimals for a number shown here. */
  places?: number;
  /** How a number reads here, when plain digits won't do. */
  show?: (v: number) => string;
  /** Wrap the text to the merged width. */
  wrap?: boolean;
}

let nextFormula = 1;

export function makeFormula(text: string, row: number, col: number): Formula {
  return { id: nextFormula++, ast: parseFormula(text, row, col) };
}

export class Sheet {
  readonly memory = new WebAssembly.Memory({ initial: PAGES, maximum: PAGES });
  readonly values = new Float64Array(this.memory.buffer);
  readonly formulas = new Map<number, Formula>();
  readonly texts = new Map<number, string>();
  readonly constants = new Set<number>();
  readonly fills: Fill[] = [];
  readonly blocks: Block[] = [];
  readonly merges: Merge[] = [];
  readonly mergeAt = new Map<number, Merge>();
  readonly names = new Map<string, Area>();
  /** Cells outside the blocks that hold something, the only ones drawn at low zoom. */
  readonly loose = new Set<number>();
  /** The area the view opens on and fits to. */
  frame: Area = { r1: 0, c1: 0, r2: 40, c2: 60 };
  /** Calculations a second, unless the sheet has a cell named "rate". */
  rate = 30;
  /** Sets the values loops start from. */
  begin: (() => void) | undefined;
  /** Cells to pulse on the first tick. */
  opening: number[] = [];
  /** The sheet reads the keyboard, so keys drive it and touch screens get a pad. */
  pad = false;
  /** CSS pixels a cell measures at 100%. */
  unit = 8;
  /** Rows of plain heading above the ruled part of the sheet. */
  band = 0;

  constructor(readonly title: string) {}

  name(id: string, area: Area | number) {
    const a = typeof area === 'number' ? { r1: rowOf(area), c1: colOf(area), r2: rowOf(area), c2: colOf(area) } : area;
    this.names.set(id.toLowerCase(), a);
  }

  private track(cell: number) {
    const r = rowOf(cell);
    const c = colOf(cell);
    if (this.blocks.some((b) => areaHas(b, r, c))) this.loose.delete(cell);
    else this.loose.add(cell);
  }

  /** Writes a constant number. */
  setNumber(cell: number, v: number) {
    this.formulas.delete(cell);
    this.texts.delete(cell);
    this.constants.add(cell);
    this.values[cell] = v;
    this.values[CELLS + cell] = v;
    this.track(cell);
  }

  setText(cell: number, s: string) {
    this.formulas.delete(cell);
    this.constants.delete(cell);
    this.texts.set(cell, s);
    this.values[cell] = 0;
    this.values[CELLS + cell] = 0;
    this.track(cell);
  }

  setFormula(cell: number, f: Formula) {
    this.constants.delete(cell);
    this.texts.delete(cell);
    this.formulas.set(cell, f);
    this.track(cell);
  }

  clear(cell: number) {
    this.formulas.delete(cell);
    this.constants.delete(cell);
    this.texts.delete(cell);
    this.values[cell] = 0;
    this.values[CELLS + cell] = 0;
    this.loose.delete(cell);
  }

  /** Fills an area with a formula written as it reads from the area's first row, in column `homeCol`. */
  fill(area: Area, text: string, homeCol = area.c1): Fill {
    return this.fillWith(area, makeFormula(text, area.r1, homeCol));
  }

  fillWith(area: Area, formula: Formula): Fill {
    const fill = { ...area, formula };
    const at = this.fills.findIndex(
      (f) => f.r1 === area.r1 && f.c1 === area.c1 && f.r2 === area.r2 && f.c2 === area.c2,
    );
    if (at >= 0) this.fills[at] = fill;
    else this.fills.push(fill);
    for (let r = area.r1; r <= area.r2; r++) {
      for (let c = area.c1; c <= area.c2; c++) this.setFormula(index(r, c), formula);
    }
    return fill;
  }

  fillAt(r: number, c: number): Fill | undefined {
    const cell = index(r, c);
    const f = this.formulas.get(cell);
    if (!f) return undefined;
    return this.fills.find((x) => x.formula === f && areaHas(x, r, c));
  }

  blockAt(r: number, c: number): Block | undefined {
    return this.blocks.find((b) => areaHas(b, r, c));
  }

  /** What the formula bar shows for a cell. */
  source(cell: number): string {
    const f = this.formulas.get(cell);
    if (f) return `=${unparse(f.ast, rowOf(cell), colOf(cell))}`;
    const s = this.texts.get(cell);
    if (s !== undefined) return s;
    if (this.constants.has(cell)) return shortNumber(this.values[cell]);
    return '';
  }

  /**
   * Applies what a visitor typed. A cell that belongs to a fill changes the whole fill, unless `single` is set.
   * Throws FormulaError when a formula doesn't parse. Returns whether the dependency graph changed.
   */
  enter(cell: number, typed: string, single = false): boolean {
    const text = typed.trim();
    const r = rowOf(cell);
    const c = colOf(cell);
    const fill = this.fillAt(r, c);
    if (text.startsWith('=')) {
      const formula = makeFormula(text, r, c);
      if (fill && !single) {
        this.fillWith(fill, formula);
      } else {
        this.leaveFill(fill, cell);
        this.setFormula(cell, formula);
      }
      return true;
    }
    const wasFormula = this.formulas.has(cell);
    this.leaveFill(fill, cell);
    if (!text) this.clear(cell);
    else if (Number.isFinite(Number(text))) this.setNumber(cell, Number(text));
    else this.setText(cell, text);
    return wasFormula;
  }

  private leaveFill(fill: Fill | undefined, cell: number) {
    if (fill && fill.r1 === fill.r2 && fill.c1 === fill.c2 && index(fill.r1, fill.c1) === cell) {
      this.fills.splice(this.fills.indexOf(fill), 1);
    }
  }

  merge(m: Merge) {
    this.merges.push(m);
    for (let r = m.r1; r <= m.r2; r++) {
      for (let c = m.c1; c <= m.c2; c++) this.mergeAt.set(index(r, c), m);
    }
  }
}

export function shortNumber(v: number, places?: number): string {
  if (Number.isNaN(v)) return '#NUM!';
  if (!Number.isFinite(v)) return '#DIV/0!';
  if (places !== undefined) return v.toFixed(places);
  if (Number.isInteger(v) && Math.abs(v) < 1e7) return String(v);
  const a = Math.abs(v);
  if (a >= 1e7 || (a > 0 && a < 1e-3)) return v.toExponential(2);
  return String(Number(v.toPrecision(5)));
}

export { FormulaError, cellName };
