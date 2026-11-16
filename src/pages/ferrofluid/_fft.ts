// A square 2D radix-2 complex FFT on split real and imaginary arrays.
// Rows are transformed in place, columns through a scratch copy.

export class FFT2 {
  readonly n: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly colRe: Float64Array;
  private readonly colIm: Float64Array;

  constructor(n: number) {
    if (n & (n - 1)) throw new Error('FFT size must be a power of two');
    this.n = n;
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / n);
      this.sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    this.colRe = new Float64Array(n);
    this.colIm = new Float64Array(n);
  }

  private line(re: Float64Array, im: Float64Array, off: number, inverse: boolean) {
    const n = this.n;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        const a = off + i;
        const b = off + j;
        let t = re[a];
        re[a] = re[b];
        re[b] = t;
        t = im[a];
        im[a] = im[b];
        im[b] = t;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = this.cos[k];
          const wi = sign * this.sin[k];
          const a = off + i + j;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }

  /** In place. The inverse includes the 1/n² scale. */
  transform(re: Float64Array, im: Float64Array, inverse: boolean) {
    const n = this.n;
    for (let y = 0; y < n; y++) this.line(re, im, y * n, inverse);
    const cr = this.colRe;
    const ci = this.colIm;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        cr[y] = re[y * n + x];
        ci[y] = im[y * n + x];
      }
      this.line(cr, ci, 0, inverse);
      for (let y = 0; y < n; y++) {
        re[y * n + x] = cr[y];
        im[y * n + x] = ci[y];
      }
    }
    if (inverse) {
      const s = 1 / (n * n);
      for (let i = 0; i < n * n; i++) {
        re[i] *= s;
        im[i] *= s;
      }
    }
  }
}
