// Fitting a picture into a valid QR code.
//
// Once a reader meets the terminator after the message it stops reading, so
// every data bit after it is ours to choose. Reed-Solomon check bits are linear
// over GF(2): each one is a fixed XOR of data bits. So asking a module to be
// dark is one equation over the free bits. Equations are added in priority
// order to a system kept in reduced row echelon form; one that contradicts what
// is already promised is skipped. Blocks are independent, so each is solved on
// its own.

import { mul, remainder } from './_gf';
import { fixedModules, layout, maskBit, messageBits, ROLE, type Level } from './_qr';

export interface SolveInput {
  version: number;
  level: Level;
  mask: number;
  text: string;
  /** Per module: -1 for no wish, 0 for light, 1 for dark. */
  target: Int8Array;
  /** Per module: higher wishes are granted first. */
  weight: Float32Array;
  /** Share of each block's correction budget to spend on wishes the code can't grant cleanly, 0 to 1. */
  spend: number;
  seed: number;
}

export interface SolveOutput {
  modules: Uint8Array;
  /** The valid code before any correction budget was spent. */
  clean: Uint8Array;
  /** Per module: 1 for a wish that went ungranted. */
  unmet: Uint8Array;
  /** Per module: 1 for a bit that holds the message (header, text, terminator). */
  message: Uint8Array;
  wishes: number;
  granted: number;
  /** Codewords per block left deliberately wrong to grant more wishes. */
  spent: number[];
  /** Free data bits in the whole code. */
  free: number;
  ms: number;
}

function hash(a: number): number {
  let h = a | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function solve(input: SolveInput): SolveOutput {
  const t0 = performance.now();
  const { version, level, mask, target, weight, seed } = input;
  const lay = layout(version, level);
  const st = lay.st;
  const size = st.size;
  const N = size * size;
  const msg = messageBits(input.text, version);
  const msgLen = msg.length;
  if (msgLen > st.dataBytes * 8) throw new Error('message too long');

  const fixed = fixedModules(lay, mask);
  const modules = new Uint8Array(N);
  const message = new Uint8Array(N);
  const maskAt = new Uint8Array(N);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) maskAt[y * size + x] = maskBit(mask, x, y);

  // Placement position of (block, index within block).
  const where: Int32Array[] = st.blocks.map((b) => new Int32Array(b.data + st.ecc));
  for (let g = 0; g < st.codewords; g++) where[lay.cwBlock[g]][lay.cwIndex[g]] = g;

  let free = 0;
  const unmet = new Uint8Array(N);
  const blockBytes: Uint8Array[] = [];

  for (let b = 0; b < st.blocks.length; b++) {
    const blk = st.blocks[b];
    const D = blk.data;
    const E = st.ecc;
    const pos = where[b];
    const moduleOf = (j: number, k: number) => lay.bitModule[pos[j] * 8 + k];

    // Fixed bits and the free variables of this block.
    const base = new Uint8Array(D);
    const varJ: number[] = [];
    const varK: number[] = [];
    for (let j = 0; j < D; j++)
      for (let k = 0; k < 8; k++) {
        const s = (blk.dataStart + j) * 8 + k;
        if (s < msgLen) {
          if (msg[s]) base[j] |= 0x80 >>> k;
          message[moduleOf(j, k)] = 1;
        } else {
          varJ.push(j);
          varK.push(k);
        }
      }
    const F = varJ.length;
    free += F;
    const W = (F + 1 + 31) >>> 5; // RHS lives at bit F
    const baseEcc = remainder(base, E);

    // Check-bit rows over the variables: row e is check byte e >> 3, bit e & 7.
    const eccRows: Uint32Array[] = [];
    for (let e = 0; e < E * 8; e++) eccRows.push(new Uint32Array(W));
    const unitRem: Uint8Array[] = [];
    for (let j = 0; j < D; j++) {
      const unit = new Uint8Array(D);
      unit[j] = 1;
      unitRem.push(remainder(unit, E));
    }
    for (let v = 0; v < F; v++) {
      const r = unitRem[varJ[v]];
      const c = 0x80 >>> varK[v];
      for (let i = 0; i < E; i++) {
        const byte = mul(r[i], c);
        if (!byte) continue;
        for (let k = 0; k < 8; k++) if (byte & (0x80 >>> k)) eccRows[i * 8 + k][v >>> 5] |= 1 << (v & 31);
      }
    }

    // Wishes in this block, as rows.
    interface Wish {
      w: number;
      tie: number;
      module: number;
      unitVar: number; // -1 for a check-bit wish
      ecc: number;
      rhs: number;
    }
    const list: Wish[] = [];
    const prefer = new Float64Array(F); // lower is the better variable to give up
    for (let v = 0; v < F; v++) {
      const c = moduleOf(varJ[v], varK[v]);
      const t = target[c];
      prefer[v] = (t < 0 ? 0 : 1 + weight[c]) + (hash(seed ^ (v * 7919 + b * 104729)) / 4294967296) * 0.5;
      if (t >= 0) list.push({ w: weight[c], tie: hash(c ^ seed), module: c, unitVar: v, ecc: -1, rhs: t ^ maskAt[c] });
    }
    for (let e = 0; e < E * 8; e++) {
      const c = moduleOf(D + (e >>> 3), e & 7);
      const t = target[c];
      if (t < 0) continue;
      const baseBit = (baseEcc[e >>> 3] >>> (7 - (e & 7))) & 1;
      list.push({ w: weight[c], tie: hash(c ^ seed), module: c, unitVar: -1, ecc: e, rhs: t ^ maskAt[c] ^ baseBit });
    }
    list.sort((a, b2) => b2.w - a.w || a.tie - b2.tie);

    // Incremental Gauss-Jordan.
    const pivotOf = new Int32Array(F).fill(-1); // row index whose pivot is this variable
    const rows: Uint32Array[] = [];
    const pivots: number[] = [];
    const scratch = new Uint32Array(W);
    for (const wish of list) {
      const r = scratch;
      if (wish.unitVar >= 0) {
        r.fill(0);
        r[wish.unitVar >>> 5] = 1 << (wish.unitVar & 31);
      } else r.set(eccRows[wish.ecc]);
      if (wish.rhs) r[F >>> 5] |= 1 << (F & 31);
      else r[F >>> 5] &= ~(1 << (F & 31));
      // Reduce by existing pivots (RREF, so one pass suffices).
      for (let wd = 0; wd < W; wd++) {
        let bits = r[wd];
        while (bits) {
          const low = bits & -bits;
          const col = (wd << 5) + (31 - Math.clz32(low));
          bits ^= low;
          if (col >= F) break;
          const pr = pivotOf[col];
          if (pr >= 0) {
            const row = rows[pr];
            for (let q = 0; q < W; q++) r[q] ^= row[q];
            bits = r[wd] & ~((low << 1) - 1);
          }
        }
      }
      // Pick a pivot among what is left.
      let best = -1;
      let bestScore = Infinity;
      for (let wd = 0; wd < W; wd++) {
        let bits = r[wd];
        while (bits) {
          const low = bits & -bits;
          const col = (wd << 5) + (31 - Math.clz32(low));
          bits ^= low;
          if (col >= F) break;
          if (prefer[col] < bestScore) {
            bestScore = prefer[col];
            best = col;
          }
        }
      }
      const rhs = (r[F >>> 5] >>> (F & 31)) & 1;
      if (best < 0) {
        // Already implied (granted) or contradicted (skipped).
        if (rhs) unmet[wish.module] = 1;
        continue;
      }
      const row = r.slice();
      const bw = best >>> 5;
      const bm = 1 << (best & 31);
      for (const p of pivots) {
        const other = rows[pivotOf[p]];
        if (other[bw] & bm) for (let q = 0; q < W; q++) other[q] ^= row[q];
      }
      pivotOf[best] = rows.length;
      rows.push(row);
      pivots.push(best);
    }

    // Free variables take seeded noise; pivots follow from them.
    const value = new Uint8Array(F);
    const assign = new Uint32Array(W);
    for (let v = 0; v < F; v++)
      if (pivotOf[v] < 0) {
        value[v] = hash(seed + (blk.dataStart * 8 + v) * 31 + 17) & 1;
        if (value[v]) assign[v >>> 5] |= 1 << (v & 31);
      }
    for (const p of pivots) {
      const row = rows[pivotOf[p]];
      let par = (row[F >>> 5] >>> (F & 31)) & 1;
      for (let q = 0; q < W; q++) {
        let x = row[q] & assign[q];
        if (q === F >>> 5) x &= (1 << (F & 31)) - 1;
        x ^= x >>> 16;
        x ^= x >>> 8;
        x ^= x >>> 4;
        x ^= x >>> 2;
        x ^= x >>> 1;
        par ^= x & 1;
      }
      value[p] = par;
    }
    const bytes = new Uint8Array(D + E);
    bytes.set(base);
    for (let v = 0; v < F; v++) if (value[v]) bytes[varJ[v]] |= 0x80 >>> varK[v];
    bytes.set(remainder(bytes.subarray(0, D), E), D);
    blockBytes.push(bytes);
  }

  // Write the code.
  for (let c = 0; c < N; c++) if (lay.role[c] !== ROLE.data && lay.role[c] !== ROLE.check) modules[c] = fixed[c];
  for (let g = 0; g < st.codewords; g++) {
    const byte = blockBytes[lay.cwBlock[g]][lay.cwIndex[g]];
    for (let k = 0; k < 8; k++) {
      const c = lay.bitModule[g * 8 + k];
      modules[c] = ((byte >>> (7 - k)) & 1) ^ maskAt[c];
    }
  }
  for (const c of lay.remainder) {
    const t = target[c];
    modules[c] = t >= 0 ? t : hash(seed ^ (c * 2246822519)) & 1;
  }

  // Recount against the finished code (implied wishes included).
  for (let c = 0; c < N; c++) {
    const r = lay.role[c];
    if (r !== ROLE.data && r !== ROLE.check) continue;
    const t = target[c];
    unmet[c] = t >= 0 && modules[c] !== t ? 1 : 0;
  }
  const clean = modules.slice();

  // Spend correction budget: whole codewords flipped to the wished bits.
  const spent: number[] = [];
  const cap = Math.floor(st.ecc / 2);
  const budget = Math.floor(Math.max(0, Math.min(1, input.spend)) * cap + 1e-9);
  const perBlock: { g: number; w: number }[][] = st.blocks.map(() => []);
  for (let g = 0; g < st.codewords; g++) {
    let w = 0;
    for (let k = 0; k < 8; k++) {
      const c = lay.bitModule[g * 8 + k];
      if (unmet[c]) w += 1 + weight[c];
    }
    if (w > 0) perBlock[lay.cwBlock[g]].push({ g, w });
  }
  for (let b = 0; b < st.blocks.length; b++) {
    const list = perBlock[b].sort((a, c) => c.w - a.w).slice(0, budget);
    for (const { g } of list)
      for (let k = 0; k < 8; k++) {
        const c = lay.bitModule[g * 8 + k];
        if (unmet[c]) {
          modules[c] = target[c];
          unmet[c] = 0;
        }
      }
    spent.push(list.length);
  }

  let totalWishes = 0;
  let totalGranted = 0;
  for (let c = 0; c < N; c++) {
    if (lay.role[c] === ROLE.remainder || lay.role[c] === ROLE.data || lay.role[c] === ROLE.check) {
      if (target[c] >= 0) {
        totalWishes++;
        if (!unmet[c]) totalGranted++;
      }
    }
  }
  return {
    modules,
    clean,
    unmet,
    message,
    wishes: totalWishes,
    granted: totalGranted,
    spent,
    free,
    ms: performance.now() - t0,
  };
}
