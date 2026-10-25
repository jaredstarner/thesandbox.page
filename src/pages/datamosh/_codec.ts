// A small block-motion video codec in the MPEG mould, written so the page can
// break it: 16x16 macroblocks over YCbCr 4:2:0, whole-pixel motion vectors,
// 8x8 DCT residuals, and keyframes that can be left out of the decode.

export const W = 512;
export const H = 288;
export const CW = W / 2;
export const CH = H / 2;
export const MBW = W / 16;
export const MBH = H / 16;
export const MBS = MBW * MBH;

export const SKIP = 0;
export const INTER = 1;
export const INTRA = 2;

const MV_RANGE = 32;

export interface Picture {
  y: Uint8ClampedArray;
  u: Uint8ClampedArray;
  v: Uint8ClampedArray;
}

export interface Frame {
  key: boolean;
  modes: Uint8Array;
  mvx: Int8Array;
  mvy: Int8Array;
  /** Coded blocks, packed as [block, count, zigzag position, level, ...]; block is macroblock * 6 + 0..5. */
  coefs: Int16Array;
  /** An estimate of the frame's size in bits, from the code lengths a real bitstream would spend. */
  bits: number;
}

export function picture(fill = 0): Picture {
  return {
    y: new Uint8ClampedArray(W * H).fill(fill),
    u: new Uint8ClampedArray(CW * CH).fill(128),
    v: new Uint8ClampedArray(CW * CH).fill(128),
  };
}

export function copyPicture(from: Picture, to: Picture) {
  to.y.set(from.y);
  to.u.set(from.u);
  to.v.set(from.v);
}

// ---------------------------------------------------------------- colour

/** RGBA (W x H) to YCbCr 4:2:0, full-range BT.601. */
export function fromRGBA(rgba: Uint8ClampedArray, out: Picture) {
  const { y, u, v } = out;
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    y[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  for (let cy = 0; cy < CH; cy++) {
    for (let cx = 0; cx < CW; cx++) {
      const p0 = (cy * 2 * W + cx * 2) * 4;
      const p1 = p0 + W * 4;
      const r = rgba[p0] + rgba[p0 + 4] + rgba[p1] + rgba[p1 + 4];
      const g = rgba[p0 + 1] + rgba[p0 + 5] + rgba[p1 + 1] + rgba[p1 + 5];
      const b = rgba[p0 + 2] + rgba[p0 + 6] + rgba[p1 + 2] + rgba[p1 + 6];
      const c = cy * CW + cx;
      u[c] = 128 + (-0.168736 * r - 0.331264 * g + 0.5 * b) / 4;
      v[c] = 128 + (0.5 * r - 0.418688 * g - 0.081312 * b) / 4;
    }
  }
}

export function toRGBA(pic: Picture, rgba: Uint8ClampedArray) {
  const { y, u, v } = pic;
  for (let py = 0; py < H; py++) {
    const crow = (py >> 1) * CW;
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const c = crow + (px >> 1);
      const Y = y[i];
      const cb = u[c] - 128;
      const cr = v[c] - 128;
      const p = i * 4;
      rgba[p] = Y + 1.402 * cr;
      rgba[p + 1] = Y - 0.344136 * cb - 0.714136 * cr;
      rgba[p + 2] = Y + 1.772 * cb;
      rgba[p + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------- transform

const COS = new Float64Array(64);
for (let u = 0; u < 8; u++) {
  for (let x = 0; x < 8; x++) {
    COS[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
}

const tmp = new Float64Array(64);

/** In-place 8x8 forward DCT. */
function fdct(block: Float64Array) {
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let x = 0; x < 8; x++) s += COS[u * 8 + x] * block[y * 8 + x];
      tmp[y * 8 + u] = s;
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let y = 0; y < 8; y++) s += COS[v * 8 + y] * tmp[y * 8 + u];
      block[v * 8 + u] = s;
    }
  }
}

/** In-place 8x8 inverse DCT. */
function idct(block: Float64Array) {
  for (let v = 0; v < 8; v++) {
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += COS[u * 8 + x] * block[v * 8 + u];
      tmp[v * 8 + x] = s;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += COS[v * 8 + y] * tmp[v * 8 + x];
      block[y * 8 + x] = s;
    }
  }
}

export const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47,
  55, 62, 63,
]);

// The JPEG specification's example tables (Annex K), in raster order.
const LUMA_TABLE = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51,
  87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMA_TABLE = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99,
];

export interface Quality {
  intraLuma: Float64Array;
  intraChroma: Float64Array;
  /** Step for inter residuals; flat, as MPEG's default non-intra matrix is. */
  inter: number;
  lambda: number;
}

/** scale 1 is the JPEG tables at quality 50; larger is coarser. */
export function quality(scale: number): Quality {
  const make = (table: number[]) => Float64Array.from(table, (q) => Math.max(1, Math.round(q * scale)));
  return {
    intraLuma: make(LUMA_TABLE),
    intraChroma: make(CHROMA_TABLE),
    inter: Math.max(2, 28 * scale),
    lambda: 3 + 3 * scale,
  };
}

// ---------------------------------------------------------------- bit costs

/** Bits in an unsigned Exp-Golomb code. */
function ue(k: number) {
  return 2 * (31 - Math.clz32(k + 1)) + 1;
}

/** Bits in a signed Exp-Golomb code. */
function se(v: number) {
  return ue(v > 0 ? 2 * v - 1 : -2 * v);
}

function levelBits(run: number, level: number) {
  return 2 + ue(run) + se(level);
}

// ---------------------------------------------------------------- plane access

function plane(pic: Picture, b: number) {
  return b < 4 ? pic.y : b === 4 ? pic.u : pic.v;
}

/** Top-left of block b (0..3 luma, 4 Cb, 5 Cr) of macroblock (mx, my), with its plane's stride. */
function blockOrigin(mx: number, my: number, b: number): [number, number, number] {
  if (b < 4) return [mx * 16 + (b & 1) * 8, my * 16 + (b >> 1) * 8, W];
  return [mx * 8, my * 8, CW];
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Sum of absolute differences between a 16x16 luma block and the reference at an offset, stopping past `limit`. */
function sad16(
  cur: Uint8ClampedArray,
  ref: Uint8ClampedArray,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  limit: number,
) {
  const rx = x0 + dx;
  const ry = y0 + dy;
  let s = 0;
  if (rx >= 0 && ry >= 0 && rx + 16 <= W && ry + 16 <= H) {
    for (let y = 0; y < 16; y++) {
      let c = (y0 + y) * W + x0;
      let r = (ry + y) * W + rx;
      for (let x = 0; x < 16; x++, c++, r++) {
        const d = cur[c] - ref[r];
        s += d < 0 ? -d : d;
      }
      if (s > limit) return s;
    }
    return s;
  }
  for (let y = 0; y < 16; y++) {
    const row = clamp(ry + y, 0, H - 1) * W;
    let c = (y0 + y) * W + x0;
    for (let x = 0; x < 16; x++, c++) {
      const d = cur[c] - ref[row + clamp(rx + x, 0, W - 1)];
      s += d < 0 ? -d : d;
    }
    if (s > limit) return s;
  }
  return s;
}

/** Copies an n x n block from ref, displaced, into out, clamping at the edges. */
function predict(
  ref: Uint8ClampedArray,
  out: Float64Array,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  stride: number,
  height: number,
) {
  const rx = x0 + dx;
  const ry = y0 + dy;
  if (rx >= 0 && ry >= 0 && rx + 8 <= stride && ry + 8 <= height) {
    for (let y = 0; y < 8; y++) {
      const r = (ry + y) * stride + rx;
      for (let x = 0; x < 8; x++) out[y * 8 + x] = ref[r + x];
    }
    return;
  }
  for (let y = 0; y < 8; y++) {
    const row = clamp(ry + y, 0, height - 1) * stride;
    for (let x = 0; x < 8; x++) out[y * 8 + x] = ref[row + clamp(rx + x, 0, stride - 1)];
  }
}

function median(a: number, b: number, c: number) {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

/** The motion vector predictor for a macroblock: the median of its left, top, and top-right neighbours. */
export function predictor(mvx: Int8Array, mvy: Int8Array, mx: number, my: number): [number, number] {
  const i = my * MBW + mx;
  if (my === 0) return mx > 0 ? [mvx[i - 1], mvy[i - 1]] : [0, 0];
  const t = i - MBW;
  // Past the right edge, the top-left neighbour stands in for the top-right, as in H.264.
  const c = mx < MBW - 1 ? t + 1 : mx > 0 ? t - 1 : -1;
  const lx = mx > 0 ? mvx[i - 1] : 0;
  const ly = mx > 0 ? mvy[i - 1] : 0;
  const cx = c >= 0 ? mvx[c] : 0;
  const cy = c >= 0 ? mvy[c] : 0;
  return [median(lx, mvx[t], cx), median(ly, mvy[t], cy)];
}

// ---------------------------------------------------------------- encoder

class CoefWriter {
  data = new Int16Array(4096);
  length = 0;
  push(v: number) {
    if (this.length === this.data.length) {
      const grown = new Int16Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = v;
  }
  take() {
    return this.data.slice(0, this.length);
  }
}

const blockBuf = new Float64Array(64);
const predBuf = new Float64Array(64);
const levels = new Int16Array(64);

/**
 * Encodes one picture. A keyframe codes every macroblock on its own; a delta
 * frame predicts each from `ref` (the encoder's own reconstruction of the
 * frame before, which this updates to the new reconstruction). `prevMv`
 * holds the last frame's vectors, used as search starting points.
 */
export class Encoder {
  readonly ref = picture(128);
  private started = false;
  private prevX = new Int8Array(MBS);
  private prevY = new Int8Array(MBS);
  constructor(public q: Quality) {}

  reset() {
    this.started = false;
    this.prevX.fill(0);
    this.prevY.fill(0);
  }

  encode(src: Picture, forceKey = false): Frame {
    const key = forceKey || !this.started;
    this.started = true;
    const modes = new Uint8Array(MBS);
    const mvx = new Int8Array(MBS);
    const mvy = new Int8Array(MBS);
    const out = new CoefWriter();
    const recon = picture();
    let bits = 32;
    for (let my = 0; my < MBH; my++) {
      for (let mx = 0; mx < MBW; mx++) {
        const i = my * MBW + mx;
        if (key) {
          modes[i] = INTRA;
          bits += this.intra(src, recon, mx, my, i, out);
          continue;
        }
        bits += this.inter(src, recon, mx, my, i, modes, mvx, mvy, out);
      }
    }
    copyPicture(recon, this.ref);
    this.prevX = mvx;
    this.prevY = mvy;
    return { key, modes, mvx, mvy, coefs: out.take(), bits };
  }

  private intra(src: Picture, recon: Picture, mx: number, my: number, mb: number, out: CoefWriter) {
    let bits = 3;
    for (let b = 0; b < 6; b++) {
      const [x0, y0, stride] = blockOrigin(mx, my, b);
      const s = plane(src, b);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blockBuf[y * 8 + x] = s[(y0 + y) * stride + x0 + x] - 128;
      fdct(blockBuf);
      const table = b < 4 ? this.q.intraLuma : this.q.intraChroma;
      bits += this.code(blockBuf, table, 0, mb * 6 + b, out, true);
      for (let k = 0; k < 64; k++) predBuf[k] = 128;
      reconstruct(blockBuf, predBuf, plane(recon, b), x0, y0, stride);
    }
    return bits;
  }

  private inter(
    src: Picture,
    recon: Picture,
    mx: number,
    my: number,
    mb: number,
    modes: Uint8Array,
    mvx: Int8Array,
    mvy: Int8Array,
    out: CoefWriter,
  ) {
    const ref = this.ref;
    const x0 = mx * 16;
    const y0 = my * 16;
    const [px, py] = predictor(mvx, mvy, mx, my);
    const lambda = this.q.lambda;
    const mvCost = (dx: number, dy: number) => lambda * (se(dx - px) + se(dy - py));

    let bestX = 0;
    let bestY = 0;
    let bestSad = sad16(src.y, ref.y, x0, y0, 0, 0, Infinity);
    let best = bestSad + mvCost(0, 0);
    const zeroSad = bestSad;
    const tryMv = (dx: number, dy: number) => {
      if (dx < -MV_RANGE || dx > MV_RANGE || dy < -MV_RANGE || dy > MV_RANGE) return false;
      const c = mvCost(dx, dy);
      if (c >= best) return false;
      const s = sad16(src.y, ref.y, x0, y0, dx, dy, best - c);
      if (s + c < best) {
        best = s + c;
        bestSad = s;
        bestX = dx;
        bestY = dy;
        return true;
      }
      return false;
    };

    // Skip: a still block costs one bit.
    if (zeroSad < 256 * 1.2) {
      modes[mb] = SKIP;
      copyBlock(ref, recon, mx, my, 0, 0);
      return 1;
    }

    tryMv(px, py);
    if (mx > 0) tryMv(mvx[mb - 1], mvy[mb - 1]);
    if (my > 0) tryMv(mvx[mb - MBW], mvy[mb - MBW]);
    if (my > 0 && mx < MBW - 1) tryMv(mvx[mb - MBW + 1], mvy[mb - MBW + 1]);
    tryMv(this.prevX[mb], this.prevY[mb]);
    if (mx < MBW - 1) tryMv(this.prevX[mb + 1], this.prevY[mb + 1]);
    if (my < MBH - 1) tryMv(this.prevX[mb + MBW], this.prevY[mb + MBW]);
    for (const step of [8, 4, 2, 1]) {
      for (let n = 0; n < 6; n++) {
        const cx = bestX;
        const cy = bestY;
        const moved = tryMv(cx + step, cy) || tryMv(cx - step, cy) || tryMv(cx, cy + step) || tryMv(cx, cy - step);
        if (!moved) break;
      }
    }
    if (best > 0) {
      const cx = bestX;
      const cy = bestY;
      tryMv(cx + 1, cy + 1);
      tryMv(cx - 1, cy + 1);
      tryMv(cx + 1, cy - 1);
      tryMv(cx - 1, cy - 1);
    }

    // Intra when prediction is worse than coding the block's own detail, with a bias toward inter.
    let mean = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) mean += src.y[(y0 + y) * W + x0 + x];
    mean /= 256;
    let dev = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) dev += Math.abs(src.y[(y0 + y) * W + x0 + x] - mean);
    if (dev + 900 < bestSad) {
      modes[mb] = INTRA;
      return this.intra(src, recon, mx, my, mb, out);
    }

    mvx[mb] = bestX;
    mvy[mb] = bestY;
    modes[mb] = INTER;
    let bits = 2 + se(bestX - px) + se(bestY - py);
    let coded = 0;
    const cdx = Math.round(bestX / 2);
    const cdy = Math.round(bestY / 2);
    for (let b = 0; b < 6; b++) {
      const [bx, by, stride] = blockOrigin(mx, my, b);
      const height = b < 4 ? H : CH;
      const r = plane(ref, b);
      const s = plane(src, b);
      predict(r, predBuf, bx, by, b < 4 ? bestX : cdx, b < 4 ? bestY : cdy, stride, height);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) blockBuf[y * 8 + x] = s[(by + y) * stride + bx + x] - predBuf[y * 8 + x];
      }
      fdct(blockBuf);
      const before = out.length;
      bits += this.code(blockBuf, null, this.q.inter, mb * 6 + b, out, false);
      if (out.length > before) coded++;
      reconstruct(blockBuf, predBuf, plane(recon, b), bx, by, stride);
    }
    bits += coded ? 4 : 1;
    if (!coded && bestX === 0 && bestY === 0) {
      modes[mb] = SKIP;
      return 1;
    }
    return bits;
  }

  /**
   * Quantizes the coefficients in `block` (leaving the dequantized values in
   * it for reconstruction) and writes the non-zero ones. Returns the bits spent.
   */
  private code(
    block: Float64Array,
    table: Float64Array | null,
    step: number,
    id: number,
    out: CoefWriter,
    intra: boolean,
  ) {
    let count = 0;
    for (let k = 0; k < 64; k++) {
      const q = table ? table[k] : step;
      const c = block[k] / q;
      // Inter residuals use a dead zone, as encoders do, so noise rounds to nothing.
      const level = intra ? Math.round(c) : Math.trunc(c + (c < 0 ? -0.25 : 0.25));
      levels[k] = level;
      block[k] = level * q;
      if (level) count++;
    }
    if (!count) return 1;
    out.push(id);
    out.push(count);
    let bits = 2;
    let run = 0;
    for (let z = 0; z < 64; z++) {
      const k = ZIGZAG[z];
      const level = levels[k];
      if (!level) {
        run++;
        continue;
      }
      out.push(z);
      out.push(level);
      bits += levelBits(run, level);
      run = 0;
    }
    return bits;
  }
}

function reconstruct(
  block: Float64Array,
  pred: Float64Array,
  dst: Uint8ClampedArray,
  x0: number,
  y0: number,
  stride: number,
) {
  idct(block);
  for (let y = 0; y < 8; y++) {
    const row = (y0 + y) * stride + x0;
    for (let x = 0; x < 8; x++) dst[row + x] = pred[y * 8 + x] + block[y * 8 + x];
  }
}

/** Moves a whole macroblock (luma and both chroma) from ref into out by a vector. */
function copyBlock(ref: Picture, out: Picture, mx: number, my: number, dx: number, dy: number) {
  const cdx = Math.round(dx / 2);
  const cdy = Math.round(dy / 2);
  for (let b = 0; b < 6; b++) {
    const [x0, y0, stride] = blockOrigin(mx, my, b);
    const height = b < 4 ? H : CH;
    predict(plane(ref, b), predBuf, x0, y0, b < 4 ? dx : cdx, b < 4 ? dy : cdy, stride, height);
    const dst = plane(out, b);
    for (let y = 0; y < 8; y++) {
      const row = (y0 + y) * stride + x0;
      for (let x = 0; x < 8; x++) dst[row + x] = predBuf[y * 8 + x];
    }
  }
}

// ---------------------------------------------------------------- decoder

export interface DecodeOptions {
  /** Decode intra macroblocks in delta frames. Off, they are moved with their neighbours instead, and nothing heals. */
  heal: boolean;
  /** Add the residual to moved blocks. Off, only the vectors act. */
  residual: boolean;
}

/**
 * Applies a frame to `ref`, writing the result to `out`. A delta frame moves
 * whatever picture it is given, which is the whole trick: give it the wrong one.
 */
export function decode(frame: Frame, q: Quality, ref: Picture, out: Picture, opts: DecodeOptions) {
  const { modes, mvx, mvy, coefs } = frame;
  // Index the coded blocks by id so each macroblock finds its own.
  const at = new Int32Array(MBS * 6).fill(-1);
  for (let p = 0; p < coefs.length; p += 2 + coefs[p + 1] * 2) at[coefs[p]] = p;

  for (let my = 0; my < MBH; my++) {
    for (let mx = 0; mx < MBW; mx++) {
      const mb = my * MBW + mx;
      const mode = modes[mb];
      if (mode === SKIP) {
        copyBlock(ref, out, mx, my, 0, 0);
        continue;
      }
      if (mode === INTRA && (frame.key || opts.heal)) {
        for (let b = 0; b < 6; b++) {
          const [x0, y0, stride] = blockOrigin(mx, my, b);
          dequant(coefs, at[mb * 6 + b], b < 4 ? q.intraLuma : q.intraChroma, 0);
          for (let k = 0; k < 64; k++) predBuf[k] = 128;
          reconstruct(blockBuf, predBuf, plane(out, b), x0, y0, stride);
        }
        continue;
      }
      if (mode === INTRA) {
        // Unhealed: carry the block along with its neighbours.
        const [px, py] = predictor(mvx, mvy, mx, my);
        copyBlock(ref, out, mx, my, px, py);
        continue;
      }
      const dx = mvx[mb];
      const dy = mvy[mb];
      const cdx = Math.round(dx / 2);
      const cdy = Math.round(dy / 2);
      for (let b = 0; b < 6; b++) {
        const [x0, y0, stride] = blockOrigin(mx, my, b);
        const height = b < 4 ? H : CH;
        predict(plane(ref, b), predBuf, x0, y0, b < 4 ? dx : cdx, b < 4 ? dy : cdy, stride, height);
        const p = at[mb * 6 + b];
        if (p >= 0 && opts.residual) {
          dequant(coefs, p, null, q.inter);
          reconstruct(blockBuf, predBuf, plane(out, b), x0, y0, stride);
        } else {
          const dst = plane(out, b);
          for (let y = 0; y < 8; y++) {
            const row = (y0 + y) * stride + x0;
            for (let x = 0; x < 8; x++) dst[row + x] = predBuf[y * 8 + x];
          }
        }
      }
    }
  }
}

function dequant(coefs: Int16Array, p: number, table: Float64Array | null, step: number) {
  blockBuf.fill(0);
  if (p < 0) return;
  const n = coefs[p + 1];
  for (let j = 0; j < n; j++) {
    const k = ZIGZAG[coefs[p + 2 + j * 2]];
    blockBuf[k] = coefs[p + 3 + j * 2] * (table ? table[k] : step);
  }
}
