// Image-field helpers for /rubbings/: distance transforms that turn flat
// masks into cut and cast profiles, morphology for the crayon's bridging,
// blurs, and lattice noise for wear, grain, and paper tooth. Everything works
// on row-major Float32Array fields of w x h.

/** A small seeded PRNG (mulberry32), so every surface is the same on every visit. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const INF = 1e20;

/** Felzenszwalb and Huttenlocher's 1D squared distance transform, in place on f via scratch buffers. */
function dt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/** Euclidean distance, in pixels, from each pixel to the nearest pixel where `seed(i)` is true. */
export function distanceTo(w: number, h: number, seed: (i: number) => boolean): Float32Array {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = seed(i) ? 0 : INF;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    dt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    dt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[row + x] = Math.sqrt(d[x]);
  }
  return out;
}

/**
 * Signed distance from an 8-bit mask, in pixels: positive inside (distance to
 * the edge), negative outside. The mask's antialiased edge nudges the result
 * by a fraction of a pixel, so cut walls don't step.
 */
export function signedDistance(mask: Uint8Array, w: number, h: number): Float32Array {
  const toOut = distanceTo(w, h, (i) => mask[i] < 128);
  const toIn = distanceTo(w, h, (i) => mask[i] >= 128);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = mask[i] / 255;
    out[i] = mask[i] >= 128 ? toOut[i] - 1 + a : -(toIn[i] - a);
  }
  return out;
}

/** A separable box blur of radius r, repeated `passes` times (three passes is close to a Gaussian). */
export function blur(src: Float32Array, w: number, h: number, r: number, passes = 3): Float32Array {
  const rad = Math.max(0, Math.round(r));
  let a = Float32Array.from(src);
  if (rad === 0) return a;
  let b = new Float32Array(w * h);
  const span = 2 * rad + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let k = -rad; k <= rad; k++) sum += a[row + clampIndex(k, w)];
      for (let x = 0; x < w; x++) {
        b[row + x] = sum / span;
        sum += a[row + clampIndex(x + rad + 1, w)] - a[row + clampIndex(x - rad, w)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -rad; k <= rad; k++) sum += b[clampIndex(k, h) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / span;
        sum += b[clampIndex(y + rad + 1, h) * w + x] - b[clampIndex(y - rad, h) * w + x];
      }
    }
  }
  return a;
}

const clampIndex = (i: number, n: number) => (i < 0 ? 0 : i >= n ? n - 1 : i);

/** van Herk/Gil-Werman running maximum over 2r + 1 samples along one line. */
function maxLine(src: Float32Array, dst: Float32Array, n: number, r: number, g: Float32Array, hbuf: Float32Array) {
  const k = 2 * r + 1;
  const m = n + 2 * r;
  for (let i = 0; i < m; i++) {
    const v = src[clampIndex(i - r, n)];
    g[i] = i % k === 0 ? v : Math.max(g[i - 1], v);
  }
  for (let i = m - 1; i >= 0; i--) {
    const v = src[clampIndex(i - r, n)];
    hbuf[i] = i === m - 1 || (i + 1) % k === 0 ? v : Math.max(hbuf[i + 1], v);
  }
  for (let i = 0; i < n; i++) dst[i] = Math.max(g[i + 2 * r], hbuf[i]);
}

/** Grey-scale dilation by a (2r + 1)-pixel square: each pixel takes the highest value near it. */
export function dilate(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const rad = Math.max(0, Math.round(r));
  const out = Float32Array.from(src);
  if (rad === 0) return out;
  const n = Math.max(w, h);
  const line = new Float32Array(n);
  const res = new Float32Array(n);
  const g = new Float32Array(n + 2 * rad);
  const hb = new Float32Array(n + 2 * rad);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) line[x] = out[row + x];
    maxLine(line, res, w, rad, g, hb);
    for (let x = 0; x < w; x++) out[row + x] = res[x];
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) line[y] = out[y * w + x];
    maxLine(line, res, h, rad, g, hb);
    for (let y = 0; y < h; y++) out[y * w + x] = res[y];
  }
  return out;
}

/**
 * Value noise summed over octaves, in about [-1, 1]. `cell` is the first
 * octave's lattice spacing in pixels; `stretch` squashes the lattice along y
 * (above 1 makes streaks running along x).
 */
export function fbm(
  w: number,
  h: number,
  cell: number,
  octaves: number,
  seed: number,
  opts: { gain?: number; stretch?: number; lacunarity?: number } = {},
): Float32Array {
  const { gain = 0.5, stretch = 1, lacunarity = 2 } = opts;
  const out = new Float32Array(w * h);
  const rand = rng(seed);
  let amp = 1;
  let total = 0;
  let c = cell;
  for (let o = 0; o < octaves; o++) {
    const cx = Math.max(1, c);
    const cy = Math.max(1, c * stretch);
    const gw = Math.ceil(w / cx) + 2;
    const gh = Math.ceil(h / cy) + 2;
    const lat = new Float32Array(gw * gh);
    for (let i = 0; i < lat.length; i++) lat[i] = rand() * 2 - 1;
    const ox = rand() * cx;
    const oy = rand() * cy;
    for (let y = 0; y < h; y++) {
      const fy = (y + oy) / cy;
      const iy = Math.floor(fy);
      let ty = fy - iy;
      ty = ty * ty * (3 - 2 * ty);
      const r0 = iy * gw;
      const r1 = r0 + gw;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const fx = (x + ox) / cx;
        const ix = Math.floor(fx);
        let tx = fx - ix;
        tx = tx * tx * (3 - 2 * tx);
        const a = lat[r0 + ix] + (lat[r0 + ix + 1] - lat[r0 + ix]) * tx;
        const b = lat[r1 + ix] + (lat[r1 + ix + 1] - lat[r1 + ix]) * tx;
        out[row + x] += amp * (a + (b - a) * ty);
      }
    }
    total += amp;
    amp *= gain;
    c /= lacunarity;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * Cell-edge noise: F2 - F1 over jittered points one per `cell` pixels, so 0
 * lies on the borders between cells (a leaf's areoles, a stone's crazing).
 */
export function cellEdges(w: number, h: number, cell: number, seed: number): Float32Array {
  const rand = rng(seed);
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const px = new Float32Array(gw * gh);
  const py = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      px[j * gw + i] = (i - 1 + rand()) * cell;
      py[j * gw + i] = (j - 1 + rand()) * cell;
    }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const cj = Math.floor(y / cell) + 1;
    for (let x = 0; x < w; x++) {
      const ci = Math.floor(x / cell) + 1;
      let f1 = INF;
      let f2 = INF;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const k = (cj + dj) * gw + ci + di;
          const dx = px[k] - x;
          const dy = py[k] - y;
          const d = dx * dx + dy * dy;
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) f2 = d;
        }
      out[y * w + x] = Math.sqrt(f2) - Math.sqrt(f1);
    }
  }
  return out;
}

/** Bilinear sample of a field at fractional pixel coordinates, clamped at the edges. */
export function sample(f: Float32Array, w: number, h: number, x: number, y: number): number {
  const fx = clamp(x, 0, w - 1.001);
  const fy = clamp(y, 0, h - 1.001);
  const ix = fx | 0;
  const iy = fy | 0;
  const tx = fx - ix;
  const ty = fy - iy;
  const i = iy * w + ix;
  const a = f[i] + (f[i + 1] - f[i]) * tx;
  const b = f[i + w] + (f[i + w + 1] - f[i + w]) * tx;
  return a + (b - a) * ty;
}
