// QR Code model 2: symbol layout, block structure, format and version
// information, masks, and the zigzag order data is written in (ISO/IEC 18004).

export type Level = 'L' | 'M' | 'Q' | 'H';
export const LEVELS: Level[] = ['L', 'M', 'Q', 'H'];

// Check bytes per block and number of blocks, indexed [level][version].
const ECC_PER_BLOCK: Record<Level, number[]> = {
  L: [
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  M: [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  Q: [
    -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  H: [
    -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
};
const BLOCKS: Record<Level, number[]> = {
  L: [
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19,
    19, 20, 21, 22, 24, 25,
  ],
  M: [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31,
    33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  Q: [
    -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40,
    43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  H: [
    -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48,
    51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
};
const LEVEL_BITS: Record<Level, number> = { L: 1, M: 0, Q: 3, H: 2 };

export const sizeOf = (version: number) => version * 4 + 17;

/** Module roles, for the anatomy view and for the scanner check. */
export const ROLE = {
  finder: 1,
  timing: 2,
  alignment: 3,
  format: 4,
  version: 5,
  dark: 6, // the single always-dark module
  data: 7, // a codeword's data bit
  check: 8, // a codeword's check bit
  remainder: 9, // the few bits after the last codeword
} as const;

function rawDataModules(version: number): number {
  let r = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const n = Math.floor(version / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (version >= 7) r -= 36;
  }
  return r;
}

export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = sizeOf(version) - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

export interface Block {
  /** Data bytes in this block. */
  data: number;
  /** Offset of this block's first data byte in the whole data stream. */
  dataStart: number;
}

export interface Structure {
  version: number;
  level: Level;
  size: number;
  ecc: number; // check bytes per block
  blocks: Block[];
  dataBytes: number; // total data bytes
  codewords: number; // total codewords
}

export function structure(version: number, level: Level): Structure {
  const ecc = ECC_PER_BLOCK[level][version];
  const n = BLOCKS[level][version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortLen = Math.floor(raw / n);
  const shortCount = n - (raw % n);
  const blocks: Block[] = [];
  let start = 0;
  for (let b = 0; b < n; b++) {
    const data = shortLen - ecc + (b < shortCount ? 0 : 1);
    blocks.push({ data, dataStart: start });
    start += data;
  }
  return { version, level, size: sizeOf(version), ecc, blocks, dataBytes: start, codewords: raw };
}

/** Byte-mode capacity in bytes, header included. */
export function byteCapacity(version: number, level: Level): number {
  const s = structure(version, level);
  return Math.floor((s.dataBytes * 8 - 4 - (version < 10 ? 8 : 16)) / 8);
}

export interface Layout {
  st: Structure;
  /** Role per module, row-major (y * size + x). */
  role: Uint8Array;
  /** Fixed values of the function patterns (format bits filled per mask by `fixedModules`). */
  fixed: Uint8Array;
  /** Module index of every codeword bit, in placement order (codeword g, bit k MSB first at g * 8 + k). */
  bitModule: Int32Array;
  /** Module indices of the remainder bits. */
  remainder: number[];
  /** For each codeword in placement order: its block and its index within that block (data first, then check). */
  cwBlock: Int16Array;
  cwIndex: Int16Array;
  /** Module indices of the two format copies and (version 7 and up) the two version copies, bit 0 first. */
  formatCells: [number[], number[]];
  versionCells: [number[], number[]] | null;
}

const layouts = new Map<string, Layout>();

export function layout(version: number, level: Level): Layout {
  const key = `${version}${level}`;
  const hit = layouts.get(key);
  if (hit) return hit;
  const st = structure(version, level);
  const size = st.size;
  const role = new Uint8Array(size * size);
  const fixed = new Uint8Array(size * size);
  const set = (x: number, y: number, r: number, v: number) => {
    role[y * size + x] = r;
    fixed[y * size + x] = v;
  };

  // Timing patterns.
  for (let i = 0; i < size; i++) {
    set(6, i, ROLE.timing, i % 2 === 0 ? 1 : 0);
    set(i, 6, ROLE.timing, i % 2 === 0 ? 1 : 0);
  }
  // Finders with their separators.
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, ROLE.finder, d !== 2 && d !== 4 ? 1 : 0);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  // Alignment patterns.
  const al = alignmentPositions(version);
  for (let i = 0; i < al.length; i++)
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(al[i] + dx, al[j] + dy, ROLE.alignment, Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0);
    }
  // Format areas (values per mask later), and the dark module.
  const f1: number[] = [];
  const f2: number[] = [];
  // Copy one runs down column 8 then left along row 8; copy two along row 8 at
  // the right, then down column 8 at the bottom.
  for (let i = 0; i <= 5; i++) f1.push(i * size + 8);
  f1.push(7 * size + 8, 8 * size + 8, 8 * size + 7);
  for (let i = 9; i < 15; i++) f1.push(8 * size + (14 - i));
  for (let i = 0; i < 8; i++) f2.push(8 * size + (size - 1 - i));
  for (let i = 8; i < 15; i++) f2.push((size - 15 + i) * size + 8);
  for (const c of [...f1, ...f2]) role[c] = ROLE.format;
  set(8, size - 8, ROLE.dark, 1);
  // Version areas.
  let versionCells: [number[], number[]] | null = null;
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    const v1: number[] = [];
    const v2: number[] = [];
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, ROLE.version, bit);
      set(b, a, ROLE.version, bit);
      v1.push(b * size + a);
      v2.push(a * size + b);
    }
    versionCells = [v1, v2];
  }

  // Zigzag placement of codeword bits.
  const total = st.codewords * 8;
  const bitModule = new Int32Array(total);
  const remainder: number[] = [];
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const c = y * size + x;
        if (role[c] !== 0) continue;
        if (i < total) {
          bitModule[i++] = c;
        } else {
          remainder.push(c);
          role[c] = ROLE.remainder;
        }
      }
  }

  // Interleaving: placement codeword g belongs to which block, at which index.
  const n = st.blocks.length;
  const cwBlock = new Int16Array(st.codewords);
  const cwIndex = new Int16Array(st.codewords);
  let g = 0;
  const maxData = st.blocks[n - 1].data;
  for (let k = 0; k < maxData; k++)
    for (let b = 0; b < n; b++)
      if (k < st.blocks[b].data) {
        cwBlock[g] = b;
        cwIndex[g++] = k;
      }
  for (let k = 0; k < st.ecc; k++)
    for (let b = 0; b < n; b++) {
      cwBlock[g] = b;
      cwIndex[g++] = st.blocks[b].data + k;
    }
  for (let gi = 0; gi < st.codewords; gi++) {
    const r = cwIndex[gi] < st.blocks[cwBlock[gi]].data ? ROLE.data : ROLE.check;
    for (let k = 0; k < 8; k++) role[bitModule[gi * 8 + k]] = r;
  }

  const out: Layout = { st, role, fixed, bitModule, remainder, cwBlock, cwIndex, formatCells: [f1, f2], versionCells };
  layouts.set(key, out);
  return out;
}

/** The 15 format bits for a level and mask. */
export function formatBits(level: Level, mask: number): number {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** All 32 valid format words, for decoding by nearest match. */
export const FORMAT_WORDS: { level: Level; mask: number; bits: number }[] = LEVELS.flatMap((level) =>
  Array.from({ length: 8 }, (_, mask) => ({ level, mask, bits: formatBits(level, mask) })),
);

export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

export function maskBit(mask: number, x: number, y: number): number {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0 ? 1 : 0;
    case 1:
      return y % 2 === 0 ? 1 : 0;
    case 2:
      return x % 3 === 0 ? 1 : 0;
    case 3:
      return (x + y) % 3 === 0 ? 1 : 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0 ? 1 : 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0 ? 1 : 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0 ? 1 : 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0 ? 1 : 0;
  }
}

/** Function pattern modules with the format bits for this mask written in. */
export function fixedModules(lay: Layout, mask: number): Uint8Array {
  const out = lay.fixed.slice();
  const bits = formatBits(lay.st.level, mask);
  for (let i = 0; i < 15; i++) {
    const v = (bits >>> i) & 1;
    out[lay.formatCells[0][i]] = v;
    out[lay.formatCells[1][i]] = v;
  }
  return out;
}

/** The header, message, and terminator as a bit array; everything after it is free. */
export function messageBits(text: string, version: number): number[] {
  const bytes = new TextEncoder().encode(text);
  const bits: number[] = [];
  const push = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, 4);
  return bits;
}

/** Standard mask penalty (four rules), lower is better for cameras. */
export function penalty(mods: Uint8Array, size: number): number {
  let score = 0;
  const at = (x: number, y: number) => mods[y * size + x];
  for (let pass = 0; pass < 2; pass++)
    for (let a = 0; a < size; a++) {
      let run = 1;
      let hist = 0;
      for (let b = 1; b <= size; b++) {
        const prev = pass ? at(a, b - 1) : at(b - 1, a);
        const cur = b < size ? (pass ? at(a, b) : at(b, a)) : -1;
        if (cur === prev) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
        hist = ((hist << 1) | prev) & 0x7ff;
        if (b >= 11 && (hist === 0b10111010000 || hist === 0b00001011101)) score += 40;
      }
    }
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
    }
  let dark = 0;
  for (let i = 0; i < mods.length; i++) dark += mods[i];
  const k = Math.ceil(Math.abs(dark * 20 - mods.length * 10) / mods.length) - 1;
  score += Math.max(0, k) * 10;
  return score;
}
