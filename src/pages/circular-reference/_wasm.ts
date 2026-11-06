// A hand-written WebAssembly binary encoder: just what the sheet compiler needs, with no toolchain behind it.
// A Body collects one function's instructions as bytes, and optionally as readable text for the Compiled pane.

export const I32 = 0x7f;
export const F64 = 0x7c;

export function u32(n: number): number[] {
  const out: number[] = [];
  let v = n >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return out;
}

export function s32(n: number): number[] {
  const out: number[] = [];
  let v = n | 0;
  for (;;) {
    const byte = v & 0x7f;
    v >>= 7;
    if ((v === 0 && !(byte & 0x40)) || (v === -1 && byte & 0x40)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

const f64Scratch = new DataView(new ArrayBuffer(8));

function f64Bytes(x: number): number[] {
  f64Scratch.setFloat64(0, x, true);
  return Array.from({ length: 8 }, (_, i) => f64Scratch.getUint8(i));
}

const utf8 = new TextEncoder();
const nameBytes = (s: string) => [...u32(s.length), ...utf8.encode(s)];
const section = (id: number, body: number[]) => [id, ...u32(body.length), ...body];
const vector = (items: number[][]) => [...u32(items.length), ...items.flat()];

/** Plain instructions by name, to opcode. */
const OPS = {
  'f64.add': 0xa0,
  'f64.sub': 0xa1,
  'f64.mul': 0xa2,
  'f64.div': 0xa3,
  'f64.min': 0xa4,
  'f64.max': 0xa5,
  'f64.abs': 0x99,
  'f64.neg': 0x9a,
  'f64.ceil': 0x9b,
  'f64.floor': 0x9c,
  'f64.trunc': 0x9d,
  'f64.nearest': 0x9e,
  'f64.sqrt': 0x9f,
  'f64.eq': 0x61,
  'f64.ne': 0x62,
  'f64.lt': 0x63,
  'f64.gt': 0x64,
  'f64.le': 0x65,
  'f64.ge': 0x66,
  'i32.eqz': 0x45,
  'i32.lt_u': 0x49,
  'i32.add': 0x6a,
  'i32.sub': 0x6b,
  'i32.mul': 0x6c,
  'i32.and': 0x71,
  'i32.or': 0x72,
  'i32.xor': 0x73,
  'i32.shl': 0x74,
  'i32.shr_u': 0x76,
  'f64.convert_i32_s': 0xb7,
  'f64.convert_i32_u': 0xb8,
} as const;

export type Op = keyof typeof OPS;

export class Body {
  readonly code: number[] = [];
  readonly text: string[] = [];
  private depth = 1;
  private readonly locals: number[] = [];

  constructor(
    private readonly params: number,
    private readonly trace = false,
  ) {}

  /** Declares a local and returns its index. */
  local(type: number): number {
    this.locals.push(type);
    return this.params + this.locals.length - 1;
  }

  private line(s: string) {
    if (this.trace) this.text.push('  '.repeat(this.depth) + s);
  }

  op(name: Op) {
    this.code.push(OPS[name]);
    this.line(name);
    return this;
  }

  i32(n: number) {
    this.code.push(0x41, ...s32(n));
    this.line(`i32.const ${n}`);
    return this;
  }

  f64(x: number) {
    this.code.push(0x44, ...f64Bytes(x));
    this.line(`f64.const ${x}`);
    return this;
  }

  get(i: number, label = `${i}`) {
    this.code.push(0x20, ...u32(i));
    this.line(`local.get ${label}`);
    return this;
  }

  set(i: number, label = `${i}`) {
    this.code.push(0x21, ...u32(i));
    this.line(`local.set ${label}`);
    return this;
  }

  tee(i: number, label = `${i}`) {
    this.code.push(0x22, ...u32(i));
    this.line(`local.tee ${label}`);
    return this;
  }

  load(offset: number) {
    this.code.push(0x2b, 3, ...u32(offset));
    this.line(`f64.load offset=${offset}`);
    return this;
  }

  store(offset = 0) {
    this.code.push(0x39, 3, ...u32(offset));
    this.line(offset ? `f64.store offset=${offset}` : 'f64.store');
    return this;
  }

  loadI32(offset: number) {
    this.code.push(0x28, 2, ...u32(offset));
    this.line(`i32.load offset=${offset}`);
    return this;
  }

  storeI32(offset: number) {
    this.code.push(0x36, 2, ...u32(offset));
    this.line(`i32.store offset=${offset}`);
    return this;
  }

  /** Saturating float to int, which never traps on NaN or a huge value. */
  truncSat() {
    this.code.push(0xfc, 0x02);
    this.line('i32.trunc_sat_f64_s');
    return this;
  }

  /** Bulk copy: dest, source, and length are on the stack. */
  memoryCopy() {
    this.code.push(0xfc, 0x0a, 0, 0);
    this.line('memory.copy');
    return this;
  }

  call(fn: number, label = `${fn}`) {
    this.code.push(0x10, ...u32(fn));
    this.line(`call $${label}`);
    return this;
  }

  /** Opens an if; `result` is F64 or I32 for a valued if, or undefined for none. */
  if(result?: number) {
    this.code.push(0x04, result ?? 0x40);
    this.line(result === F64 ? 'if (result f64)' : result === I32 ? 'if (result i32)' : 'if');
    this.depth++;
    return this;
  }

  else() {
    this.code.push(0x05);
    this.depth--;
    this.line('else');
    this.depth++;
    return this;
  }

  end() {
    this.code.push(0x0b);
    this.depth--;
    this.line('end');
    return this;
  }

  loop() {
    this.code.push(0x03, 0x40);
    this.line('loop');
    this.depth++;
    return this;
  }

  brIf(depth: number) {
    this.code.push(0x0d, ...u32(depth));
    this.line(`br_if ${depth}`);
    return this;
  }

  /** Finished body bytes: the local declarations, the code, and the closing end. */
  bytes(): number[] {
    const groups: number[][] = [];
    for (let i = 0; i < this.locals.length;) {
      let n = 1;
      while (this.locals[i + n] === this.locals[i]) n++;
      groups.push([...u32(n), this.locals[i]]);
      i += n;
    }
    const out = [...vector(groups), ...this.code, 0x0b];
    return [...u32(out.length), ...out];
  }
}

export interface Signature {
  params: number[];
  results: number[];
}

const sigKey = (s: Signature) => `${s.params.join()}>${s.results.join()}`;

export interface ImportedFn {
  name: string;
  sig: Signature;
}

export interface LocalFn {
  sig: Signature;
  body: number[];
  exportAs?: string;
}

/** Assembles a module that imports one memory and some functions from "env". */
export function assemble(imports: ImportedFn[], fns: LocalFn[], memoryPages: number): Uint8Array<ArrayBuffer> {
  const sigs: Signature[] = [];
  const keys = new Map<string, number>();
  const typeOf = (s: Signature) => {
    const key = sigKey(s);
    let i = keys.get(key);
    if (i === undefined) {
      i = sigs.length;
      sigs.push(s);
      keys.set(key, i);
    }
    return i;
  };

  const importEntries = [
    [...nameBytes('env'), ...nameBytes('mem'), 0x02, 0x00, ...u32(memoryPages)],
    ...imports.map((f) => [...nameBytes('env'), ...nameBytes(f.name), 0x00, ...u32(typeOf(f.sig))]),
  ];
  const fnTypes = fns.map((f) => u32(typeOf(f.sig)));
  const exports: number[][] = [];
  fns.forEach((f, i) => {
    if (f.exportAs) exports.push([...nameBytes(f.exportAs), 0x00, ...u32(imports.length + i)]);
  });
  const types = sigs.map((s) => [0x60, ...vector(s.params.map((p) => [p])), ...vector(s.results.map((r) => [r]))]);

  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...section(1, vector(types)),
    ...section(2, vector(importEntries)),
    ...section(3, vector(fnTypes)),
    ...section(7, vector(exports)),
    ...section(10, vector(fns.map((f) => f.body))),
  ]);
}
