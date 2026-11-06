// The formula language: A1 references, ranges, names, operators, and function calls, parsed into a tree.
// Relative references are stored as offsets from the cell that holds the formula (R1C1 style), so one parsed
// tree serves every cell of a fill, and the text a visitor reads for any one cell is rebuilt from the tree.

export const COLS = 256;
export const ROWS = 256;
export const CELLS = COLS * ROWS;

export const index = (row: number, col: number) => row * COLS + col;
export const rowOf = (cell: number) => cell >> 8;
export const colOf = (cell: number) => cell & 255;

export interface Ref {
  t: 'ref';
  /** Absolute row, or the offset from the home row when `rowAbs` is false. */
  row: number;
  col: number;
  rowAbs: boolean;
  colAbs: boolean;
}

export interface Range {
  t: 'range';
  a: Ref;
  b: Ref;
}

export type Node =
  | { t: 'num'; v: number; src: string }
  | { t: 'str'; v: string }
  | Ref
  | Range
  | { t: 'name'; v: string }
  | { t: 'var'; v: string }
  | { t: 'let'; binds: [string, Node][]; body: Node }
  | { t: 'paren'; a: Node }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] };

export class FormulaError extends Error {}

export function columnName(col: number): string {
  let s = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function columnNumber(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export const cellName = (row: number, col: number) => `${columnName(col)}${row + 1}`;

/** Reads "B7" or "aa12" as a cell, for the name box. */
export function parseCellName(text: string): number | null {
  const m = /^\s*\$?([a-z]{1,2})\$?([0-9]{1,3})\s*$/i.exec(text);
  if (!m) return null;
  const col = columnNumber(m[1]);
  const row = Number(m[2]) - 1;
  return col < COLS && row >= 0 && row < ROWS ? index(row, col) : null;
}

const REF = /^(\$?)([A-Za-z]{1,2})(\$?)([0-9]{1,3})$/;

interface Token {
  k: 'num' | 'str' | 'id' | 'op' | 'end';
  v: string;
  at: number;
}

function lex(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new FormulaError(`Stray "${ch}"`);
      out.push({ k: 'num', v: m[0], at: i });
      i += m[0].length;
    } else if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new FormulaError('A quote is left open');
      out.push({ k: 'str', v: src.slice(i + 1, end), at: i });
      i = end + 1;
    } else if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$.]*/.exec(src.slice(i));
      if (!m) throw new FormulaError(`Stray "${ch}"`);
      out.push({ k: 'id', v: m[0], at: i });
      i += m[0].length;
    } else {
      const two = src.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '<>') {
        out.push({ k: 'op', v: two, at: i });
        i += 2;
      } else if ('+-*/^%=<>(),:'.includes(ch)) {
        out.push({ k: 'op', v: ch, at: i });
        i++;
      } else {
        throw new FormulaError(`Stray "${ch}"`);
      }
    }
  }
  out.push({ k: 'end', v: '', at: src.length });
  return out;
}

class Parser {
  private p = 0;
  private scope: string[] = [];
  private readonly toks: Token[];

  constructor(
    src: string,
    private readonly row: number,
    private readonly col: number,
  ) {
    this.toks = lex(src);
  }

  private get tok() {
    return this.toks[this.p];
  }

  private isOp(v: string) {
    return this.tok.k === 'op' && this.tok.v === v;
  }

  private eat(v: string) {
    if (!this.isOp(v)) throw new FormulaError(this.tok.k === 'end' ? `Expected "${v}" at the end` : `Expected "${v}"`);
    this.p++;
  }

  whole(): Node {
    const n = this.compare();
    if (this.tok.k !== 'end') throw new FormulaError(`Unexpected "${this.tok.v}"`);
    return n;
  }

  private compare(): Node {
    let a = this.additive();
    while (this.tok.k === 'op' && ['=', '<>', '<', '<=', '>', '>='].includes(this.tok.v)) {
      const op = this.tok.v;
      this.p++;
      a = { t: 'bin', op, a, b: this.additive() };
    }
    return a;
  }

  private additive(): Node {
    let a = this.product();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.tok.v;
      this.p++;
      a = { t: 'bin', op, a, b: this.product() };
    }
    return a;
  }

  private product(): Node {
    let a = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = this.tok.v;
      this.p++;
      a = { t: 'bin', op, a, b: this.unary() };
    }
    return a;
  }

  private unary(): Node {
    if (this.isOp('-') || this.isOp('+')) {
      const op = this.tok.v;
      this.p++;
      return { t: 'un', op, a: this.unary() };
    }
    return this.power();
  }

  private power(): Node {
    const a = this.postfix();
    if (this.isOp('^')) {
      this.p++;
      return { t: 'bin', op: '^', a, b: this.unary() };
    }
    return a;
  }

  private postfix(): Node {
    let a = this.atom();
    while (this.isOp('%')) {
      this.p++;
      a = { t: 'un', op: '%', a };
    }
    return a;
  }

  private atom(): Node {
    const tok = this.tok;
    if (tok.k === 'num') {
      this.p++;
      return { t: 'num', v: Number(tok.v), src: tok.v };
    }
    if (tok.k === 'str') {
      this.p++;
      return { t: 'str', v: tok.v };
    }
    if (this.isOp('(')) {
      this.p++;
      const a = this.compare();
      this.eat(')');
      return { t: 'paren', a };
    }
    if (tok.k === 'id') {
      this.p++;
      if (this.isOp('(')) {
        this.p++;
        return this.call(tok.v.toUpperCase());
      }
      const lower = tok.v.toLowerCase();
      if (this.scope.includes(lower)) return { t: 'var', v: lower };
      const m = REF.exec(tok.v);
      if (m) {
        const a = this.ref(m);
        if (this.isOp(':')) {
          this.p++;
          const end = this.tok.k === 'id' ? REF.exec(this.tok.v) : null;
          if (!end) throw new FormulaError('Expected a cell after ":"');
          this.p++;
          return { t: 'range', a, b: this.ref(end) };
        }
        return a;
      }
      if (lower === 'true') return { t: 'num', v: 1, src: 'TRUE' };
      if (lower === 'false') return { t: 'num', v: 0, src: 'FALSE' };
      return { t: 'name', v: lower };
    }
    throw new FormulaError(tok.k === 'end' ? 'The formula stops short' : `Unexpected "${tok.v}"`);
  }

  private ref(m: RegExpExecArray): Ref {
    const colAbs = m[1] === '$';
    const rowAbs = m[3] === '$';
    const col = columnNumber(m[2]);
    const row = Number(m[4]) - 1;
    if (col >= COLS || row < 0 || row >= ROWS) throw new FormulaError(`${m[0]} is off the sheet`);
    return {
      t: 'ref',
      row: rowAbs ? row : row - this.row,
      col: colAbs ? col : col - this.col,
      rowAbs,
      colAbs,
    };
  }

  private call(fn: string): Node {
    if (fn === 'LET') return this.letCall();
    const args: Node[] = [];
    if (!this.isOp(')')) {
      args.push(this.compare());
      while (this.isOp(',')) {
        this.p++;
        args.push(this.compare());
      }
    }
    this.eat(')');
    return { t: 'call', fn, args };
  }

  private letCall(): Node {
    const binds: [string, Node][] = [];
    const depth = this.scope.length;
    for (;;) {
      const save = this.p;
      if (this.tok.k === 'id' && this.toks[this.p + 1]?.k === 'op' && this.toks[this.p + 1].v === ',') {
        const name = this.tok.v.toLowerCase();
        if (REF.test(name)) throw new FormulaError(`${this.tok.v} looks like a cell, so LET can't use it as a name`);
        this.p += 2;
        binds.push([name, this.compare()]);
        this.scope.push(name);
        this.eat(',');
      } else {
        this.p = save;
        break;
      }
    }
    if (!binds.length) throw new FormulaError('LET needs a name, a value, and a result');
    const body = this.compare();
    this.scope.length = depth;
    this.eat(')');
    return { t: 'let', binds, body };
  }
}

/** Parses formula text, with or without its leading "=", as if typed into the cell at (row, col). */
export function parseFormula(text: string, row: number, col: number): Node {
  return new Parser(text.replace(/^\s*=/, ''), row, col).whole();
}

function refText(n: Ref, row: number, col: number): string {
  const c = n.colAbs ? n.col : n.col + col;
  const r = n.rowAbs ? n.row : n.row + row;
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return '#REF!';
  return `${n.colAbs ? '$' : ''}${columnName(c)}${n.rowAbs ? '$' : ''}${r + 1}`;
}

/** Rebuilds a formula's text as it reads from the cell at (row, col). */
export function unparse(n: Node, row: number, col: number): string {
  switch (n.t) {
    case 'num':
      return n.src;
    case 'str':
      return `"${n.v}"`;
    case 'ref':
      return refText(n, row, col);
    case 'range':
      return `${refText(n.a, row, col)}:${refText(n.b, row, col)}`;
    case 'name':
    case 'var':
      return n.v;
    case 'paren':
      return `(${unparse(n.a, row, col)})`;
    case 'un':
      return n.op === '%' ? `${unparse(n.a, row, col)}%` : `${n.op}${unparse(n.a, row, col)}`;
    case 'bin':
      return `${unparse(n.a, row, col)}${n.op}${unparse(n.b, row, col)}`;
    case 'let':
      return `LET(${n.binds.map(([k, v]) => `${k},${unparse(v, row, col)}`).join(',')},${unparse(n.body, row, col)})`;
    case 'call':
      return `${n.fn}(${n.args.map((a) => unparse(a, row, col)).join(',')})`;
  }
}
