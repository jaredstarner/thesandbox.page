// The calculation engine. It reads every formula on a sheet, works out what depends on what, finds the loops,
// and writes a WebAssembly module that recalculates the sheet in dependency order.
//
// The rule for loops: a reference that stays inside its own loop reads the value from the last tick, and any
// other reference reads this tick's value. So cells on a loop behave like registers in a circuit, updating
// together, and where they sit on the sheet makes no difference. PREV(x) asks for last tick's value explicitly.
//
// Cells that share a formula share one compiled function, called with a run of cell addresses. Fourteen
// thousand cells of fire are a single short loop.

import { CELLS, COLS, FormulaError, colOf, index, rowOf, type Node, type Range, type Ref } from './_formula';
import {
  KEYS,
  PAGES,
  PREV,
  SLOT_KEYS,
  SLOT_RANDOM,
  SLOT_TICK,
  SLOT_TIME,
  SYSTEM,
  type Area,
  type Formula,
  type Sheet,
} from './_sheet';
import { ARITY } from './_functions';
import { Body, F64, I32, assemble, type ImportedFn, type LocalFn, type Signature } from './_wasm';

const ROW_BYTES = COLS * 8;
const COL_MASK = (COLS - 1) << 3;
const ROW_MASK = ~COL_MASK;

const one: Signature = { params: [F64], results: [F64] };
const two: Signature = { params: [F64, F64], results: [F64] };

const IMPORTS: ImportedFn[] = [
  { name: 'sin', sig: one },
  { name: 'cos', sig: one },
  { name: 'tan', sig: one },
  { name: 'asin', sig: one },
  { name: 'acos', sig: one },
  { name: 'atan', sig: one },
  { name: 'exp', sig: one },
  { name: 'log', sig: one },
  { name: 'log10', sig: one },
  { name: 'atan2', sig: two },
  { name: 'pow', sig: two },
  { name: 'round', sig: two },
];

const importAt = new Map(IMPORTS.map((f, i) => [f.name, i]));
const COUNT_OPS = ['=', '<>', '<', '<=', '>', '>='] as const;
const H_RANDOM = IMPORTS.length;
const H_SUM = H_RANDOM + 1;
const H_MIN = H_RANDOM + 2;
const H_MAX = H_RANDOM + 3;
const H_COUNT = H_RANDOM + 4;
const FIRST_FORMULA = H_COUNT + COUNT_OPS.length;

function isRangeLike(n: Node) {
  return n.t === 'range' || (n.t === 'call' && n.fn === 'PREV' && n.args[0]?.t === 'range');
}

/** Rejects anything the compiler can't turn into numbers, with a message fit for the formula bar. */
export function validate(n: Node, sheet: Sheet): void {
  switch (n.t) {
    case 'num':
    case 'var':
    case 'ref':
    case 'range':
      return;
    case 'str':
      throw new FormulaError(`Text like "${n.v}" only goes in KEY and COUNTIF`);
    case 'name':
      if (!sheet.names.has(n.v)) throw new FormulaError(`No cell here is named ${n.v}`);
      return;
    case 'paren':
    case 'un':
      return validate(n.a, sheet);
    case 'bin':
      validate(n.a, sheet);
      return validate(n.b, sheet);
    case 'let':
      for (const [, v] of n.binds) validate(v, sheet);
      return validate(n.body, sheet);
    case 'call': {
      const arity = ARITY[n.fn];
      if (!arity) throw new FormulaError(`There's no function called ${n.fn}`);
      if (n.args.length < arity[0] || n.args.length > arity[1]) throw new FormulaError(`${n.fn} has the wrong arguments`);
      if (n.fn === 'KEY') {
        const arg = n.args[0];
        if (arg.t !== 'str' || !KEYS.includes(arg.v.toLowerCase())) {
          throw new FormulaError(`KEY knows ${KEYS.map((k) => `"${k}"`).join(', ')}`);
        }
        return;
      }
      if (n.fn === 'COUNTIF') {
        if (!isRangeLike(n.args[0]) && n.args[0].t !== 'name') throw new FormulaError('COUNTIF needs a range first');
        const arg = n.args[1];
        if (arg.t !== 'str' || !parseCriterion(arg.v)) throw new FormulaError('COUNTIF needs a test like ">=1"');
        return validate(n.args[0], sheet);
      }
      if (n.fn === 'PREV') {
        const arg = n.args[0];
        if (arg.t !== 'ref' && arg.t !== 'range' && arg.t !== 'name') throw new FormulaError('PREV takes a cell or range');
        return validate(arg, sheet);
      }
      if (n.fn === 'INDEX') {
        const arg = n.args[0];
        if (!isRangeLike(arg) && arg.t !== 'name') throw new FormulaError('INDEX needs a range first');
      }
      for (const a of n.args) validate(a, sheet);
      return;
    }
  }
}

function parseCriterion(s: string): { op: number; x: number } | null {
  const m = /^\s*(<=|>=|<>|<|>|=)?\s*(-?[0-9.]+)\s*$/.exec(s);
  if (!m) return null;
  return { op: COUNT_OPS.indexOf((m[1] ?? '=') as (typeof COUNT_OPS)[number]), x: Number(m[2]) };
}

/** How one reference behaves from one particular cell. */
interface Flag {
  prev: boolean;
  /** The reference falls off the sheet from here, so it reads as zero. */
  off: boolean;
  /** For a range: the clipped corner, as an offset from the written corner, and its size. */
  dr: number;
  dc: number;
  rows: number;
  cols: number;
}

type Flags = Map<Node, Flag>;

const resolveRow = (ref: Ref, home: number) => (ref.rowAbs ? ref.row : home + ref.row);
const resolveCol = (ref: Ref, home: number) => (ref.colAbs ? ref.col : home + ref.col);

function areaOf(n: Ref | Range, hr: number, hc: number): Area {
  if (n.t === 'ref') {
    const r = resolveRow(n, hr);
    const c = resolveCol(n, hc);
    return { r1: r, c1: c, r2: r, c2: c };
  }
  const ra = resolveRow(n.a, hr);
  const rb = resolveRow(n.b, hr);
  const ca = resolveCol(n.a, hc);
  const cb = resolveCol(n.b, hc);
  return { r1: Math.min(ra, rb), c1: Math.min(ca, cb), r2: Math.max(ra, rb), c2: Math.max(ca, cb) };
}

/** Visits each reference in a tree, noting those under PREV. */
function visit(n: Node, sheet: Sheet, see: (node: Node, area: Area | null, forced: boolean) => void, forced = false) {
  switch (n.t) {
    case 'ref':
    case 'range':
      see(n, null, forced);
      return;
    case 'name':
      see(n, sheet.names.get(n.v) ?? null, forced);
      return;
    case 'paren':
    case 'un':
      visit(n.a, sheet, see, forced);
      return;
    case 'bin':
      visit(n.a, sheet, see, forced);
      visit(n.b, sheet, see, forced);
      return;
    case 'let':
      for (const [, v] of n.binds) visit(v, sheet, see, forced);
      visit(n.body, sheet, see, forced);
      return;
    case 'call':
      for (const a of n.args) visit(a, sheet, see, forced || n.fn === 'PREV');
      return;
    default:
      return;
  }
}

/** The areas a formula cell reads, for outlining them on the sheet. */
export function areasRead(sheet: Sheet, cell: number): Area[] {
  const f = sheet.formulas.get(cell);
  if (!f) return [];
  const out: Area[] = [];
  const seen = new Set<string>();
  visit(f.ast, sheet, (node, named) => {
    const a = named ?? areaOf(node as Ref | Range, rowOf(cell), colOf(cell));
    const key = `${a.r1},${a.c1},${a.r2},${a.c2}`;
    if (!seen.has(key) && a.r1 >= 0 && a.c1 >= 0) {
      seen.add(key);
      out.push(sheet.mergeAt.get(index(a.r1, a.c1)) ?? a);
    }
  });
  return out;
}

class Emit {
  readonly scope = new Map<string, number>();
  private readonly tempA: number;
  private readonly tempB: number;

  constructor(
    readonly b: Body,
    readonly sheet: Sheet,
    readonly flags: Flags,
  ) {
    this.tempA = b.local(F64);
    this.tempB = b.local(F64);
  }

  /** Pushes a base address for a reference and returns the static offset to add to it. */
  private base(ref: Ref, dr: number, dc: number): number {
    const b = this.b;
    if (ref.rowAbs && ref.colAbs) {
      b.i32(0);
      return (ref.row + dr) * ROW_BYTES + (ref.col + dc) * 8;
    }
    if (ref.rowAbs) {
      b.get(0, '$cell').i32(COL_MASK).op('i32.and');
      return (ref.row + dr) * ROW_BYTES + (ref.col + dc) * 8;
    }
    if (ref.colAbs) {
      b.get(0, '$cell').i32(ROW_MASK).op('i32.and');
      return (ref.row + dr) * ROW_BYTES + (ref.col + dc) * 8;
    }
    b.get(0, '$cell');
    return (ref.row + dr) * ROW_BYTES + (ref.col + dc) * 8;
  }

  private loadCell(ref: Ref, flag: Flag) {
    const b = this.b;
    if (flag.off) {
      b.f64(0);
      return;
    }
    let at = this.base(ref, 0, 0) + (flag.prev ? PREV : 0);
    if (at < 0) {
      b.i32(at).op('i32.add');
      at = 0;
    }
    b.load(at);
  }

  private loadArea(area: Area, flag: Flag) {
    const at = index(area.r1, area.c1) * 8 + (flag.prev ? PREV : 0);
    this.b.i32(0).load(at);
  }

  /** Pushes the byte address of a range's first (clipped) cell. */
  private rangeAddress(n: Node): Flag {
    const b = this.b;
    if (n.t === 'call') return this.rangeAddress(n.args[0]);
    const flag = this.flags.get(n);
    if (!flag) throw new FormulaError('Unresolved range');
    if (n.t === 'name') {
      const area = this.sheet.names.get(n.v);
      if (!area) throw new FormulaError(`No cell here is named ${n.v}`);
      b.i32(index(area.r1, area.c1) * 8 + (flag.prev ? PREV : 0));
      return flag;
    }
    if (n.t !== 'range') throw new FormulaError('Expected a range');
    const low: Ref = {
      t: 'ref',
      row: Math.min(n.a.row, n.b.row),
      col: Math.min(n.a.col, n.b.col),
      rowAbs: n.a.rowAbs,
      colAbs: n.a.colAbs,
    };
    const at = this.base(low, flag.dr, flag.dc) + (flag.prev ? PREV : 0);
    if (at) b.i32(at).op('i32.add');
    return flag;
  }

  /** Leaves an i32 truth value. */
  cond(n: Node): void {
    const b = this.b;
    if (n.t === 'paren') return this.cond(n.a);
    if (n.t === 'bin' && ['=', '<>', '<', '<=', '>', '>='].includes(n.op)) {
      this.expr(n.a);
      this.expr(n.b);
      const ops = { '=': 'f64.eq', '<>': 'f64.ne', '<': 'f64.lt', '<=': 'f64.le', '>': 'f64.gt', '>=': 'f64.ge' } as const;
      b.op(ops[n.op as keyof typeof ops]);
      return;
    }
    if (n.t === 'call' && (n.fn === 'AND' || n.fn === 'OR')) {
      const and = n.fn === 'AND';
      this.cond(n.args[0]);
      for (const a of n.args.slice(1)) {
        b.if(I32);
        if (and) {
          this.cond(a);
          b.else().i32(0).end();
        } else {
          b.i32(1).else();
          this.cond(a);
          b.end();
        }
      }
      return;
    }
    if (n.t === 'call' && n.fn === 'NOT') {
      this.cond(n.args[0]);
      b.op('i32.eqz');
      return;
    }
    this.expr(n);
    b.f64(0).op('f64.ne');
  }

  /** Leaves an f64 value. */
  expr(n: Node) {
    const b = this.b;
    switch (n.t) {
      case 'num':
        b.f64(n.v);
        return;
      case 'str':
        throw new FormulaError('Unexpected text');
      case 'paren':
        this.expr(n.a);
        return;
      case 'var': {
        const slot = this.scope.get(n.v);
        if (slot === undefined) throw new FormulaError(`Unknown name ${n.v}`);
        b.get(slot, `$${n.v}`);
        return;
      }
      case 'ref': {
        const flag = this.flags.get(n);
        if (!flag) throw new FormulaError('Unresolved reference');
        this.loadCell(n, flag);
        return;
      }
      case 'range': {
        // A bare range used as a number reads its first cell.
        if (this.flags.get(n)?.off) b.f64(0);
        else {
          this.rangeAddress(n);
          b.load(0);
        }
        return;
      }
      case 'name': {
        const area = this.sheet.names.get(n.v);
        const flag = this.flags.get(n);
        if (!area || !flag) throw new FormulaError(`No cell here is named ${n.v}`);
        this.loadArea(area, flag);
        return;
      }
      case 'un':
        this.expr(n.a);
        if (n.op === '-') b.op('f64.neg');
        else if (n.op === '%') b.f64(100).op('f64.div');
        return;
      case 'bin':
        this.binary(n.op, n.a, n.b);
        return;
      case 'let': {
        const saved: [string, number | undefined][] = [];
        for (const [name, value] of n.binds) {
          this.expr(value);
          const slot = b.local(F64);
          b.set(slot, `$${name}`);
          saved.push([name, this.scope.get(name)]);
          this.scope.set(name, slot);
        }
        this.expr(n.body);
        for (const [name, was] of saved.reverse()) {
          if (was === undefined) this.scope.delete(name);
          else this.scope.set(name, was);
        }
        return;
      }
      case 'call':
        this.call(n.fn, n.args, n);
        return;
    }
  }

  private binary(op: string, x: Node, y: Node) {
    const b = this.b;
    switch (op) {
      case '+':
      case '-':
      case '*':
      case '/':
        this.expr(x);
        this.expr(y);
        b.op(op === '+' ? 'f64.add' : op === '-' ? 'f64.sub' : op === '*' ? 'f64.mul' : 'f64.div');
        return;
      case '^':
        this.expr(x);
        if (y.t === 'num' && y.v === 2) {
          b.tee(this.tempA).get(this.tempA).op('f64.mul');
          return;
        }
        this.expr(y);
        b.call(importAt.get('pow') as number, 'pow');
        return;
      default:
        this.cond({ t: 'bin', op, a: x, b: y });
        b.op('f64.convert_i32_s');
    }
  }

  private fold(args: Node[], helper: number, label: string, op: 'f64.add' | 'f64.min' | 'f64.max') {
    const b = this.b;
    args.forEach((a, i) => {
      if (isRangeLike(a) || this.isNamedRange(a)) {
        if (this.isOff(a)) {
          b.f64(0);
        } else {
          const flag = this.rangeAddress(a);
          b.i32(flag.rows).i32(flag.cols).call(helper, label);
        }
      } else {
        this.expr(a);
      }
      if (i) b.op(op);
    });
  }

  private isOff(n: Node): boolean {
    if (n.t === 'call') return this.isOff(n.args[0]);
    return this.flags.get(n)?.off ?? false;
  }

  private isNamedRange(n: Node) {
    if (n.t !== 'name') return false;
    const area = this.sheet.names.get(n.v);
    return !!area && (area.r1 !== area.r2 || area.c1 !== area.c2);
  }

  private countOf(n: Node): number {
    if (n.t === 'call' && n.fn === 'PREV') return this.countOf(n.args[0]);
    const flag = this.flags.get(n);
    if ((n.t === 'range' || this.isNamedRange(n)) && flag) return flag.off ? 0 : flag.rows * flag.cols;
    return 1;
  }

  private call(fn: string, args: Node[], n: Node) {
    const b = this.b;
    const math = (name: string) => {
      this.expr(args[0]);
      if (args[1]) this.expr(args[1]);
      b.call(importAt.get(name) as number, name);
    };
    const plain = (op: 'f64.abs' | 'f64.sqrt' | 'f64.floor' | 'f64.ceil' | 'f64.trunc') => {
      this.expr(args[0]);
      b.op(op);
    };
    switch (fn) {
      case 'SIN':
      case 'COS':
      case 'TAN':
      case 'ASIN':
      case 'ACOS':
      case 'ATAN':
      case 'EXP':
      case 'LOG10':
      case 'ATAN2':
        math(fn.toLowerCase());
        return;
      case 'LN':
        math('log');
        return;
      case 'POWER':
        math('pow');
        return;
      case 'ABS':
        plain('f64.abs');
        return;
      case 'SQRT':
        plain('f64.sqrt');
        return;
      case 'INT':
        plain('f64.floor');
        return;
      case 'CEILING':
        plain('f64.ceil');
        return;
      case 'TRUNC':
        plain('f64.trunc');
        return;
      case 'SIGN':
        this.expr(args[0]);
        b.tee(this.tempA).f64(0).op('f64.gt');
        b.get(this.tempA).f64(0).op('f64.lt').op('i32.sub').op('f64.convert_i32_s');
        return;
      case 'RADIANS':
        this.expr(args[0]);
        b.f64(Math.PI / 180).op('f64.mul');
        return;
      case 'DEGREES':
        this.expr(args[0]);
        b.f64(180 / Math.PI).op('f64.mul');
        return;
      case 'MOD': {
        const x = b.local(F64);
        const y = b.local(F64);
        this.expr(args[0]);
        b.set(x);
        this.expr(args[1]);
        b.set(y);
        b.get(x).get(x).get(y).op('f64.div').op('f64.floor').get(y).op('f64.mul').op('f64.sub');
        return;
      }
      case 'ROUND':
        this.expr(args[0]);
        if (args[1]) {
          this.expr(args[1]);
          b.call(importAt.get('round') as number, 'round');
        } else {
          b.op('f64.nearest');
        }
        return;
      case 'PI':
        b.f64(Math.PI);
        return;
      case 'RAND':
        b.call(H_RANDOM, 'rand');
        return;
      case 'TICK':
        b.i32(0).load(SYSTEM + SLOT_TICK * 8);
        return;
      case 'TIME':
        b.i32(0).load(SYSTEM + SLOT_TIME * 8);
        return;
      case 'ROW':
        b.get(0, '$cell').i32(11).op('i32.shr_u').i32(1).op('i32.add').op('f64.convert_i32_s');
        return;
      case 'COLUMN':
        b.get(0, '$cell').i32(COL_MASK).op('i32.and').i32(3).op('i32.shr_u');
        b.i32(1).op('i32.add').op('f64.convert_i32_s');
        return;
      case 'IF':
        this.cond(args[0]);
        b.if(F64);
        this.expr(args[1]);
        b.else();
        if (args[2]) this.expr(args[2]);
        else b.f64(0);
        b.end();
        return;
      case 'AND':
      case 'OR':
      case 'NOT':
        this.cond(n);
        b.op('f64.convert_i32_s');
        return;
      case 'SUM':
        this.fold(args, H_SUM, 'sum', 'f64.add');
        return;
      case 'MIN':
        this.fold(args, H_MIN, 'min', 'f64.min');
        return;
      case 'MAX':
        this.fold(args, H_MAX, 'max', 'f64.max');
        return;
      case 'AVERAGE': {
        this.fold(args, H_SUM, 'sum', 'f64.add');
        b.f64(Math.max(
          1,
          args.reduce((sum, a) => sum + this.countOf(a), 0),
        ));
        b.op('f64.div');
        return;
      }
      case 'COUNT':
        this.rangeOrZero(args[0], COUNT_OPS.indexOf('<>'), 0);
        return;
      case 'COUNTIF': {
        const crit = args[1].t === 'str' ? parseCriterion(args[1].v) : null;
        if (!crit) throw new FormulaError('COUNTIF needs a test like ">=1"');
        this.rangeOrZero(args[0], crit.op, crit.x);
        return;
      }
      case 'INDEX':
        this.indexOf(args);
        return;
      case 'CHOOSE': {
        const which = b.local(I32);
        this.expr(args[0]);
        b.truncSat().set(which);
        const choices = args.slice(1);
        choices.forEach((a, i) => {
          b.get(which).i32(i + 1).op('i32.sub').op('i32.eqz').if(F64);
          this.expr(a);
          b.else();
        });
        b.f64(0);
        for (let i = 0; i < choices.length; i++) b.end();
        return;
      }
      case 'PREV':
        this.expr(args[0]);
        return;
      case 'KEY': {
        const arg = args[0];
        const slot = arg.t === 'str' ? KEYS.indexOf(arg.v.toLowerCase()) : -1;
        b.i32(0).load(SYSTEM + (SLOT_KEYS + slot) * 8);
        return;
      }
      default:
        throw new FormulaError(`There's no function called ${fn}`);
    }
  }

  private rangeOrZero(a: Node, op: number, x: number) {
    const b = this.b;
    if ((!isRangeLike(a) && !this.isNamedRange(a)) || this.isOff(a)) {
      b.f64(0);
      return;
    }
    const flag = this.rangeAddress(a);
    b.i32(flag.rows).i32(flag.cols).f64(x).call(H_COUNT + op, `count${op}`);
  }

  private indexOf(args: Node[]) {
    const b = this.b;
    const row = b.local(I32);
    const col = b.local(I32);
    const base = b.local(I32);
    if (this.isOff(args[0])) {
      b.f64(0);
      return;
    }
    const flag = this.rangeAddress(args[0]);
    b.set(base);
    const single = args.length === 2;
    if (single && flag.rows === 1) {
      b.i32(0).set(row);
      this.expr(args[1]);
      b.truncSat().i32(1).op('i32.sub').set(col);
    } else {
      this.expr(args[1]);
      b.truncSat().i32(1).op('i32.sub').set(row);
      if (single) {
        b.i32(0).set(col);
      } else {
        this.expr(args[2] as Node);
        b.truncSat().i32(1).op('i32.sub').set(col);
      }
    }
    b.get(row).i32(flag.rows).op('i32.lt_u');
    b.get(col).i32(flag.cols).op('i32.lt_u').op('i32.and').if(F64);
    b.get(base).get(row).i32(ROW_BYTES).op('i32.mul').op('i32.add');
    b.get(col).i32(3).op('i32.shl').op('i32.add').load(0);
    b.else().f64(0).end();
  }
}

const paramSig: Signature = { params: [I32, I32, I32], results: [] };
const rangeSig: Signature = { params: [I32, I32, I32], results: [F64] };
const countSig: Signature = { params: [I32, I32, I32, F64], results: [F64] };

function formulaBody(sheet: Sheet, f: Formula, flags: Flags, trace = false) {
  const b = new Body(3, trace);
  const emit = new Emit(b, sheet, flags);
  b.loop();
  b.get(0, '$cell');
  emit.expr(f.ast);
  b.store();
  b.get(0, '$cell').get(2, '$step').op('i32.add').set(0, '$cell');
  b.get(1, '$count').i32(1).op('i32.sub').tee(1, '$count').brIf(0);
  b.end();
  return b;
}

function randomBody() {
  const b = new Body(0);
  const x = b.local(I32);
  const at = SYSTEM + SLOT_RANDOM * 8;
  b.i32(0).loadI32(at).set(x);
  b.get(x).get(x).i32(13).op('i32.shl').op('i32.xor').set(x);
  b.get(x).get(x).i32(17).op('i32.shr_u').op('i32.xor').set(x);
  b.get(x).get(x).i32(5).op('i32.shl').op('i32.xor').set(x);
  b.i32(0).get(x).storeI32(at);
  b.get(x).op('f64.convert_i32_u').f64(2.3283064365386963e-10).op('f64.mul');
  return b.bytes();
}

/** One function that walks a rectangle: (address, rows, cols) plus any extra parameters. */
function rectBody(params: number, start: number, step: (b: Body, acc: number, cell: number) => void) {
  const b = new Body(params);
  const acc = b.local(F64);
  const p = b.local(I32);
  const n = b.local(I32);
  b.f64(start).set(acc);
  b.loop();
  b.get(0).set(p).get(2).set(n);
  b.loop();
  step(b, acc, p);
  b.get(p).i32(8).op('i32.add').set(p);
  b.get(n).i32(1).op('i32.sub').tee(n).brIf(0);
  b.end();
  b.get(0).i32(ROW_BYTES).op('i32.add').set(0);
  b.get(1).i32(1).op('i32.sub').tee(1).brIf(0);
  b.end();
  b.get(acc);
  return b.bytes();
}

function helpers(): LocalFn[] {
  const accumulate = (op: 'f64.add' | 'f64.min' | 'f64.max') => (b: Body, acc: number, cell: number) => {
    b.get(acc).get(cell).load(0).op(op).set(acc);
  };
  const out: LocalFn[] = [
    { sig: { params: [], results: [F64] }, body: randomBody() },
    { sig: rangeSig, body: rectBody(3, 0, accumulate('f64.add')) },
    { sig: rangeSig, body: rectBody(3, Infinity, accumulate('f64.min')) },
    { sig: rangeSig, body: rectBody(3, -Infinity, accumulate('f64.max')) },
  ];
  const tests = ['f64.eq', 'f64.ne', 'f64.lt', 'f64.le', 'f64.gt', 'f64.ge'] as const;
  for (const test of tests) {
    const step = (b: Body, acc: number, cell: number) => {
      b.get(acc).get(cell).load(0).get(3).op(test).op('f64.convert_i32_s').op('f64.add').set(acc);
    };
    out.push({ sig: countSig, body: rectBody(4, 0, step) });
  }
  return out;
}

export interface Stats {
  formulas: number;
  circular: number;
  functions: number;
  runs: number;
  bytes: number;
  buildMs: number;
}

interface Compiled {
  formula: Formula;
  flags: Flags;
  cells: number;
}

/** Tarjan's strongly connected components, iterative, over an adjacency list. Dependencies come out first. */
function components(edges: number[][]) {
  const n = edges.length;
  const order = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const comp = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  const sizes: number[] = [];
  let counter = 0;
  for (let root = 0; root < n; root++) {
    if (order[root] >= 0) continue;
    const work: number[] = [root];
    const next: number[] = [0];
    order[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = 1;
    while (work.length) {
      const v = work[work.length - 1];
      const i = next[next.length - 1];
      if (i < edges[v].length) {
        next[next.length - 1]++;
        const w = edges[v][i];
        if (order[w] < 0) {
          order[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          work.push(w);
          next.push(0);
        } else if (onStack[w]) {
          low[v] = Math.min(low[v], order[w]);
        }
      } else {
        work.pop();
        next.pop();
        if (work.length) {
          const parent = work[work.length - 1];
          low[parent] = Math.min(low[parent], low[v]);
        }
        if (low[v] === order[v]) {
          const id = sizes.length;
          let size = 0;
          for (;;) {
            const w = stack.pop() as number;
            onStack[w] = 0;
            comp[w] = id;
            size++;
            if (w === v) break;
          }
          sizes.push(size);
        }
      }
    }
  }
  return { comp, sizes };
}

export class Engine {
  private tickFn: (() => void) | null = null;
  private building = 0;
  private fnOfCell = new Int32Array(CELLS).fill(-1);
  private compiled: Compiled[] = [];
  /** Cells in a loop, for the outlines and the status line. */
  circular = new Uint8Array(CELLS);
  stats: Stats = { formulas: 0, circular: 0, functions: 0, runs: 0, bytes: 0, buildMs: 0 };

  constructor(readonly sheet: Sheet) {}

  get ready() {
    return this.tickFn !== null;
  }

  /** Rebuilds the module from the sheet as it stands. Safe to call again before the last build finishes. */
  async build(): Promise<void> {
    const started = performance.now();
    const ticket = ++this.building;
    const { sheet } = this;

    // Nodes: one per formula cell, then one per distinct multi-cell range.
    const cells = [...sheet.formulas.keys()];
    const nodeOf = new Int32Array(CELLS).fill(-1);
    cells.forEach((cell, i) => (nodeOf[cell] = i));
    const edges: number[][] = cells.map(() => []);
    const rangeNodes = new Map<string, number>();
    const rangeNode = (area: Area) => {
      const key = `${area.r1},${area.c1},${area.r2},${area.c2}`;
      let id = rangeNodes.get(key);
      if (id === undefined) {
        id = edges.length;
        const targets: number[] = [];
        for (let r = area.r1; r <= area.r2; r++) {
          for (let c = area.c1; c <= area.c2; c++) {
            const t = nodeOf[index(r, c)];
            if (t >= 0) targets.push(t);
          }
        }
        edges.push(targets);
        rangeNodes.set(key, id);
      }
      return id;
    };
    const clip = (a: Area): Area => ({
      r1: Math.max(0, a.r1),
      c1: Math.max(0, a.c1),
      r2: Math.min(255, a.r2),
      c2: Math.min(255, a.c2),
    });

    cells.forEach((cell, i) => {
      const f = sheet.formulas.get(cell) as Formula;
      const hr = rowOf(cell);
      const hc = colOf(cell);
      visit(f.ast, sheet, (node, named, forced) => {
        if (forced) return;
        const area = named ?? areaOf(node as Ref | Range, hr, hc);
        const c = clip(area);
        if (c.r1 > c.r2 || c.c1 > c.c2) return;
        if (c.r1 === c.r2 && c.c1 === c.c2) {
          const t = nodeOf[index(c.r1, c.c1)];
          if (t >= 0) edges[i].push(t);
        } else {
          edges[i].push(rangeNode(c));
        }
      });
    });

    const { comp, sizes } = components(edges);
    const looped = sizes.map((s) => s > 1);
    edges.forEach((list, v) => {
      if (list.includes(v)) looped[comp[v]] = true;
    });

    // Levels: a component runs after everything it reads. Components come out of Tarjan dependencies-first.
    const levels = new Int32Array(sizes.length);
    const byComp: number[][] = sizes.map(() => []);
    edges.forEach((_, v) => byComp[comp[v]].push(v));
    for (let id = 0; id < sizes.length; id++) {
      let level = 0;
      for (const v of byComp[id]) {
        for (const w of edges[v]) {
          if (comp[w] !== id) level = Math.max(level, levels[comp[w]] + 1);
        }
      }
      levels[id] = level;
    }

    // Functions: cells share one when the formula is the same and every reference behaves the same from there.
    const keys = new Map<string, number>();
    const compiled: Compiled[] = [];
    const fnOfCell = new Int32Array(CELLS).fill(-1);
    const circular = new Uint8Array(CELLS);
    let circularCount = 0;

    cells.forEach((cell, i) => {
      const f = sheet.formulas.get(cell) as Formula;
      const hr = rowOf(cell);
      const hc = colOf(cell);
      const mine = comp[i];
      if (looped[mine]) {
        circular[cell] = 1;
        circularCount++;
      }
      const flags: Flags = new Map();
      let key = `${f.id}:`;
      visit(f.ast, sheet, (node, named, forced) => {
        const area = named ?? areaOf(node as Ref | Range, hr, hc);
        const c = clip(area);
        const empty = c.r1 > c.r2 || c.c1 > c.c2;
        let prev = forced;
        if (!forced && !empty) {
          if (c.r1 === c.r2 && c.c1 === c.c2) {
            const t = nodeOf[index(c.r1, c.c1)];
            prev = t >= 0 && comp[t] === mine && looped[mine];
          } else {
            const id = rangeNodes.get(`${c.r1},${c.c1},${c.r2},${c.c2}`);
            prev = id !== undefined && comp[id] === mine && looped[mine];
          }
        }
        const flag: Flag = {
          prev,
          off: empty,
          dr: empty ? 0 : c.r1 - area.r1,
          dc: empty ? 0 : c.c1 - area.c1,
          rows: empty ? 0 : c.r2 - c.r1 + 1,
          cols: empty ? 0 : c.c2 - c.c1 + 1,
        };
        flags.set(node, flag);
        key += `${prev ? 'p' : ''}${empty ? 'x' : ''}${flag.dr},${flag.dc},${flag.rows},${flag.cols};`;
      });
      let fn = keys.get(key);
      if (fn === undefined) {
        fn = compiled.length;
        keys.set(key, fn);
        compiled.push({ formula: f, flags, cells: 0 });
      }
      compiled[fn].cells++;
      fnOfCell[cell] = fn;
    });

    // Runs: within a level, cells of one function at an even step make one call.
    const ordered = cells.map((cell, i) => ({ cell, level: levels[comp[i]], fn: fnOfCell[cell] }));
    ordered.sort((a, b) => a.level - b.level || a.fn - b.fn || a.cell - b.cell);
    const runs: { fn: number; cell: number; count: number; step: number }[] = [];
    let lastLevel = -1;
    for (const item of ordered) {
      const run = runs[runs.length - 1];
      const fits =
        run && lastLevel === item.level && run.fn === item.fn
          ? run.count === 1
            ? item.cell > run.cell
            : item.cell - (run.cell + (run.count - 1) * run.step) === run.step
          : false;
      if (run && fits) {
        if (run.count === 1) run.step = item.cell - run.cell;
        run.count++;
      } else {
        runs.push({ fn: item.fn, cell: item.cell, count: 1, step: 1 });
      }
      lastLevel = item.level;
    }

    let lastRow = 0;
    for (const cell of [...sheet.formulas.keys(), ...sheet.constants]) lastRow = Math.max(lastRow, rowOf(cell));

    const tick = new Body(0);
    tick.i32(PREV).i32(0).i32((lastRow + 1) * ROW_BYTES).memoryCopy();
    for (const run of runs) {
      tick
        .i32(run.cell * 8)
        .i32(run.count)
        .i32(run.step * 8)
        .call(FIRST_FORMULA + run.fn, `f${run.fn}`);
    }

    const fns: LocalFn[] = [
      ...helpers(),
      ...compiled.map((c) => ({ sig: paramSig, body: formulaBody(sheet, c.formula, c.flags).bytes() })),
      { sig: { params: [], results: [] }, body: tick.bytes(), exportAs: 'tick' },
    ];
    const bytes = assemble(IMPORTS, fns, PAGES);
    const env: Record<string, unknown> = {
      mem: sheet.memory,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      asin: Math.asin,
      acos: Math.acos,
      atan: Math.atan,
      exp: Math.exp,
      log: Math.log,
      log10: Math.log10,
      atan2: Math.atan2,
      pow: Math.pow,
      round: (x: number, d: number) => {
        const k = 10 ** Math.trunc(d);
        return Math.round(x * k) / k;
      },
    };
    const { instance } = await WebAssembly.instantiate(bytes, { env } as WebAssembly.Imports);
    if (ticket !== this.building) return;
    this.tickFn = instance.exports.tick as () => void;
    this.compiled = compiled;
    this.fnOfCell = fnOfCell;
    this.circular = circular;
    this.stats = {
      formulas: cells.length,
      circular: circularCount,
      functions: compiled.length,
      runs: runs.length,
      bytes: bytes.length,
      buildMs: performance.now() - started,
    };
  }

  tick(ticks: number, seconds: number) {
    const { values } = this.sheet;
    const sys = SYSTEM / 8;
    values[sys + SLOT_TICK] = ticks;
    values[sys + SLOT_TIME] = seconds;
    this.tickFn?.();
  }

  seed(n: number) {
    new Uint32Array(this.sheet.memory.buffer)[(SYSTEM + SLOT_RANDOM * 8) / 4] = n >>> 0 || 1;
  }

  key(slot: number, down: boolean) {
    this.sheet.values[SYSTEM / 8 + SLOT_KEYS + slot] = down ? 1 : 0;
  }

  /** The compiled function behind a cell, as text, for the Compiled pane. */
  listing(cell: number): { text: string; cells: number; bytes: number; id: number } | null {
    const id = this.fnOfCell[cell];
    const c = this.compiled[id];
    if (!c) return null;
    const body = formulaBody(this.sheet, c.formula, c.flags, true);
    return { text: body.text.join('\n'), cells: c.cells, bytes: body.bytes().length, id };
  }
}
