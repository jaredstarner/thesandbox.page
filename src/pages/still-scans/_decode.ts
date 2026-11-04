// Reading a QR code back from a grid of sampled modules, the way a scanner does
// once it has found the corners: format and version information by nearest
// valid word, unmask, de-interleave, correct each block, then parse segments.

import { correct } from './_gf';
import { FORMAT_WORDS, layout, maskBit, ROLE, sizeOf, versionBits, type Level } from './_qr';

export interface BlockReport {
  errors: number;
  capacity: number;
  ok: boolean;
}

export interface ReadResult {
  ok: boolean;
  text: string;
  reason: string;
  version: number;
  level: Level | null;
  mask: number;
  blocks: BlockReport[];
  /** Wrong modules in each of the three finder patterns (top left, top right, bottom left). */
  finders: [number, number, number];
  /** Share of timing pattern modules read wrong. */
  timing: number;
}

const popcount = (x: number) => {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
};

const CHAR_BITS: Record<number, [number, number, number]> = { 1: [10, 12, 14], 2: [9, 11, 13], 4: [8, 16, 16] };
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function parse(data: Uint8Array, version: number): string | null {
  let pos = 0;
  const total = data.length * 8;
  const read = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | ((data[pos >>> 3] >>> (7 - (pos & 7))) & 1);
      pos++;
    }
    return v;
  };
  const group = version < 10 ? 0 : version < 27 ? 1 : 2;
  const bytes: number[] = [];
  let text = '';
  const flush = () => {
    if (bytes.length) text += new TextDecoder().decode(new Uint8Array(bytes));
    bytes.length = 0;
  };
  while (total - pos >= 4) {
    const mode = read(4);
    if (mode === 0) break;
    if (mode === 7) {
      read(8);
      continue;
    }
    const cb = CHAR_BITS[mode];
    if (!cb) return null;
    const count = read(cb[group]);
    if (mode === 4) {
      if (pos + count * 8 > total) return null;
      for (let i = 0; i < count; i++) bytes.push(read(8));
    } else if (mode === 1) {
      flush();
      let left = count;
      while (left >= 3) {
        text += String(read(10)).padStart(3, '0');
        left -= 3;
      }
      if (left === 2) text += String(read(7)).padStart(2, '0');
      else if (left === 1) text += String(read(4));
    } else {
      flush();
      let left = count;
      while (left >= 2) {
        const v = read(11);
        text += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45];
        left -= 2;
      }
      if (left) text += ALNUM[read(6)];
    }
    if (pos > total) return null;
  }
  flush();
  return text;
}

export function read(grid: Uint8Array, size: number): ReadResult {
  const version = (size - 17) / 4;
  const fail = (reason: string, extra: Partial<ReadResult> = {}): ReadResult => ({
    ok: false,
    text: '',
    reason,
    version,
    level: null,
    mask: -1,
    blocks: [],
    finders: [0, 0, 0],
    timing: 0,
    ...extra,
  });
  if (!Number.isInteger(version) || version < 1 || version > 40) return fail('not a QR code size');

  // Format: the nearest of the 32 valid words over both copies.
  const base = layout(version, 'L');
  const word = (cells: number[]) => cells.reduce((acc, c, i) => acc | (grid[c] << i), 0);
  const w1 = word(base.formatCells[0]);
  const w2 = word(base.formatCells[1]);
  let best = FORMAT_WORDS[0];
  let bestD = 99;
  for (const f of FORMAT_WORDS) {
    const d = Math.min(popcount(f.bits ^ w1), popcount(f.bits ^ w2));
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }

  // Finder and timing damage, judged against the expected patterns.
  const finders: [number, number, number] = [0, 0, 0];
  let timingWrong = 0;
  let timingAll = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = y * size + x;
      const r = base.role[c];
      if (r === ROLE.finder) {
        // Separators don't count; cameras look for the 1:1:3:1:1 rings.
        const fx = x < 9 ? 3 : size - 4;
        const fy = y < 9 ? 3 : size - 4;
        if (Math.max(Math.abs(x - fx), Math.abs(y - fy)) > 3) continue;
        if (grid[c] !== base.fixed[c]) finders[x > size / 2 ? 1 : y > size / 2 ? 2 : 0]++;
      } else if (r === ROLE.timing) {
        timingAll++;
        if (grid[c] !== base.fixed[c]) timingWrong++;
      }
    }
  const timing = timingAll ? timingWrong / timingAll : 0;
  const partial = { finders, timing };
  if (bestD > 3) return fail('format information unreadable', partial);

  if (version >= 7 && base.versionCells) {
    const v1 = word(base.versionCells[0]);
    const v2 = word(base.versionCells[1]);
    let vBest = 0;
    let vD = 99;
    for (let v = 7; v <= 40; v++) {
      const bits = versionBits(v);
      const d = Math.min(popcount(bits ^ v1), popcount(bits ^ v2));
      if (d < vD) {
        vD = d;
        vBest = v;
      }
    }
    if (vD > 3 || sizeOf(vBest) !== size) return fail('version information unreadable', partial);
  }

  const { level, mask } = best;
  const lay = layout(version, level);
  const st = lay.st;
  const blocks = st.blocks.map((b) => new Uint8Array(b.data + st.ecc));
  for (let g = 0; g < st.codewords; g++) {
    let byte = 0;
    for (let k = 0; k < 8; k++) {
      const c = lay.bitModule[g * 8 + k];
      const x = c % size;
      const y = (c - x) / size;
      byte = (byte << 1) | (grid[c] ^ maskBit(mask, x, y));
    }
    blocks[lay.cwBlock[g]][lay.cwIndex[g]] = byte;
  }
  const cap = Math.floor(st.ecc / 2);
  const reports: BlockReport[] = [];
  const data = new Uint8Array(st.dataBytes);
  let ok = true;
  for (let b = 0; b < blocks.length; b++) {
    const res = correct(blocks[b], st.ecc);
    const good = res.block !== null;
    reports.push({ errors: good ? res.errors : Math.max(res.errors, cap + 1), capacity: cap, ok: good });
    if (!res.block) {
      ok = false;
      continue;
    }
    data.set(res.block.subarray(0, st.blocks[b].data), st.blocks[b].dataStart);
  }
  const common = { version, level, mask, blocks: reports, finders, timing };
  if (!ok) {
    const bad = reports.findIndex((r) => !r.ok);
    return { ...common, ok: false, text: '', reason: `block ${bad + 1} has more errors than it can fix` };
  }
  const text = parse(data, version);
  if (text === null) return { ...common, ok: false, text: '', reason: 'the data doesn’t parse' };
  return { ...common, ok: true, text, reason: '' };
}
