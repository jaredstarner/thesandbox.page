// Arithmetic in GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1, and the
// Reed-Solomon code QR uses: generator roots a^0 .. a^(n-1), codewords written
// highest degree first.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

export function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

export function div(a: number, b: number): number {
  if (b === 0) throw new Error('divide by zero');
  if (a === 0) return 0;
  return EXP[(LOG[a] + 255 - LOG[b]) % 255];
}

export function pow2(e: number): number {
  return EXP[((e % 255) + 255) % 255];
}

const divisors = new Map<number, Uint8Array>();

/** The generator polynomial of the given degree, leading 1 dropped, highest degree first. */
export function divisor(degree: number): Uint8Array {
  let d = divisors.get(degree);
  if (d) return d;
  d = new Uint8Array(degree);
  d[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      d[j] = mul(d[j], root);
      if (j + 1 < degree) d[j] ^= d[j + 1];
    }
    root = mul(root, 2);
  }
  divisors.set(degree, d);
  return d;
}

/** The check bytes for a block of data bytes. */
export function remainder(data: ArrayLike<number>, degree: number): Uint8Array {
  const g = divisor(degree);
  const r = new Uint8Array(degree);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ r[0];
    r.copyWithin(0, 1);
    r[degree - 1] = 0;
    if (factor) for (let j = 0; j < degree; j++) r[j] ^= mul(g[j], factor);
  }
  return r;
}

export interface Corrected {
  /** The block with its errors fixed, or null when there were more than the code can fix. */
  block: Uint8Array | null;
  /** Codewords found wrong (0 when the block was clean). */
  errors: number;
}

/** Evaluate a polynomial (highest degree first) at x. */
function evalPoly(p: ArrayLike<number>, x: number): number {
  let y = 0;
  for (let i = 0; i < p.length; i++) y = mul(y, x) ^ p[i];
  return y;
}

/**
 * Decode one block (data then check bytes) with errors only: syndromes,
 * Berlekamp-Massey for the locator, Chien search, then Forney for the values.
 */
export function correct(received: ArrayLike<number>, degree: number): Corrected {
  const n = received.length;
  const synd = new Uint8Array(degree);
  let clean = true;
  for (let j = 0; j < degree; j++) {
    synd[j] = evalPoly(received, pow2(j));
    if (synd[j]) clean = false;
  }
  if (clean) return { block: Uint8Array.from(received), errors: 0 };

  // Berlekamp-Massey; polynomials lowest degree first here.
  let lambda = [1];
  let prev = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let k = 0; k < degree; k++) {
    let delta = synd[k];
    for (let i = 1; i <= L; i++) delta ^= mul(lambda[i] ?? 0, synd[k - i]);
    if (delta === 0) {
      m++;
      continue;
    }
    const coef = div(delta, b);
    const next = lambda.slice();
    for (let i = 0; i < prev.length; i++) {
      const at = i + m;
      while (next.length <= at) next.push(0);
      next[at] ^= mul(coef, prev[i]);
    }
    if (2 * L <= k) {
      prev = lambda;
      L = k + 1 - L;
      b = delta;
      m = 1;
    } else m++;
    lambda = next;
  }
  while (lambda.length > 1 && lambda[lambda.length - 1] === 0) lambda.pop();
  const nu = lambda.length - 1;
  if (nu === 0 || 2 * nu > degree) return { block: null, errors: nu };

  // Chien search: position i (0 = first byte) has locator X = a^(n-1-i).
  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    const xinv = pow2(-(n - 1 - i));
    let v = 0;
    for (let d = nu; d >= 0; d--) v = mul(v, xinv) ^ lambda[d];
    if (v === 0) positions.push(i);
  }
  if (positions.length !== nu) return { block: null, errors: nu };

  // Omega = S(x) * Lambda(x) mod x^degree, lowest degree first.
  const omega = new Uint8Array(degree);
  for (let i = 0; i < degree; i++) {
    let v = 0;
    for (let j = 0; j <= Math.min(i, nu); j++) v ^= mul(lambda[j], synd[i - j]);
    omega[i] = v;
  }
  const out = Uint8Array.from(received);
  for (const i of positions) {
    const x = pow2(n - 1 - i);
    const xinv = pow2(-(n - 1 - i));
    let num = 0;
    for (let d = degree - 1; d >= 0; d--) num = mul(num, xinv) ^ omega[d];
    // Formal derivative: odd terms only.
    let den = 0;
    for (let d = 1; d <= nu; d += 2) den ^= mul(lambda[d], pow2(-(n - 1 - i) * (d - 1)));
    if (den === 0) return { block: null, errors: nu };
    out[i] ^= mul(x, div(num, den));
  }
  for (let j = 0; j < degree; j++) if (evalPoly(out, pow2(j))) return { block: null, errors: nu };
  return { block: out, errors: nu };
}
