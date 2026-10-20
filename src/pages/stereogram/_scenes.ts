// Depth maps for each picture. Every scene writes depth in 0..1 into a
// w * h Float32Array: 0 is the far plane, 1 the near plane.

// ---------------------------------------------------------------- meshes

export interface Mesh {
  /** x, y, z per vertex, in units where the shape is about 1 across. */
  pos: Float32Array;
  tris: Uint32Array;
  /** Half the shape's depth extent at its deepest orientation, for scaling depth. */
  reach: number;
}

function grid(nu: number, nv: number, at: (u: number, v: number, out: number[]) => void): Omit<Mesh, 'reach'> {
  const pos = new Float32Array(nu * nv * 3);
  const p = [0, 0, 0];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      at((i / nu) * Math.PI * 2, (j / nv) * Math.PI * 2, p);
      pos.set(p, (i * nv + j) * 3);
    }
  }
  const tris = new Uint32Array(nu * nv * 6);
  let k = 0;
  for (let i = 0; i < nu; i++) {
    const i1 = (i + 1) % nu;
    for (let j = 0; j < nv; j++) {
      const j1 = (j + 1) % nv;
      const a = i * nv + j;
      const b = i1 * nv + j;
      const c = i1 * nv + j1;
      const d = i * nv + j1;
      tris.set([a, b, c, a, c, d], k);
      k += 6;
    }
  }
  return { pos, tris };
}

/** A ring: major radius 1, tube radius r. */
export function torus(r = 0.36): Mesh {
  const mesh = grid(144, 48, (u, v, out) => {
    const q = 1 + r * Math.cos(v);
    out[0] = q * Math.cos(u);
    out[1] = q * Math.sin(u);
    out[2] = r * Math.sin(v);
  });
  return { ...mesh, reach: 1 + r };
}

/** A trefoil knot drawn as a tube, scaled to about the ring's size. */
export function knot(r = 0.15): Mesh {
  const s = 1 / 2.9;
  const curve = (t: number) => [
    s * (Math.sin(t) + 2 * Math.sin(2 * t)),
    s * (Math.cos(t) - 2 * Math.cos(2 * t)),
    s * -Math.sin(3 * t) * 1.5,
  ];
  const mesh = grid(320, 28, (u, v, out) => {
    const e = 1e-3;
    const p = curve(u);
    const a = curve(u - e);
    const b = curve(u + e);
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz);
    // Frenet frame: the trefoil never straightens out, so its curvature never vanishes.
    let nx = b[0] - 2 * p[0] + a[0];
    let ny = b[1] - 2 * p[1] + a[1];
    let nz = b[2] - 2 * p[2] + a[2];
    const dot = (nx * tx + ny * ty + nz * tz) / (tl * tl);
    nx -= dot * tx;
    ny -= dot * ty;
    nz -= dot * tz;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const bx = (ty * nz - tz * ny) / tl;
    const by = (tz * nx - tx * nz) / tl;
    const bz = (tx * ny - ty * nx) / tl;
    const c = Math.cos(v) * r;
    const sn = Math.sin(v) * r;
    out[0] = p[0] + nx * c + bx * sn;
    out[1] = p[1] + ny * c + by * sn;
    out[2] = p[2] + nz * c + bz * sn;
  });
  return { ...mesh, reach: 1.05 };
}

/** A rotation matrix (row-major 3x3) from turns about x, then y, then z. */
export function rotation(ax: number, ay: number, az: number): number[] {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  // Rz * Ry * Rx
  return [
    cz * cy,
    cz * sy * sx - sz * cx,
    cz * sy * cx + sz * sx,
    sz * cy,
    sz * sy * sx + cz * cx,
    sz * sy * cx - cz * sx,
    -sy,
    cy * sx,
    cy * cx,
  ];
}

/**
 * Draw a mesh into a depth map with a z-buffer that keeps the nearest
 * surface. The view is orthographic: depth comes only from the shape.
 */
export function drawMesh(
  mesh: Mesh,
  m: number[],
  depth: Float32Array,
  w: number,
  h: number,
  size: number,
  mid: number,
  span: number,
  scratch: Float32Array,
): void {
  const { pos, tris, reach } = mesh;
  const cx = w / 2;
  const cy = h / 2;
  const scale = size / (2 * reach);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    scratch[i] = cx + (m[0] * x + m[1] * y + m[2] * z) * scale;
    scratch[i + 1] = cy - (m[3] * x + m[4] * y + m[5] * z) * scale;
    scratch[i + 2] = mid + ((m[6] * x + m[7] * y + m[8] * z) / reach) * span;
  }
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3;
    const b = tris[t + 1] * 3;
    const c = tris[t + 2] * 3;
    const x0 = scratch[a];
    const y0 = scratch[a + 1];
    const z0 = scratch[a + 2];
    const x1 = scratch[b];
    const y1 = scratch[b + 1];
    const z1 = scratch[b + 2];
    const x2 = scratch[c];
    const y2 = scratch[c + 1];
    const z2 = scratch[c + 2];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-6) continue;
    const inv = 1 / area;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      const row = y * w;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        if (z > depth[row + x]) depth[row + x] = z;
      }
    }
  }
}

// ---------------------------------------------------------------- pond

const GROUND = 0;
const LIP = 0.6;
const WATER = 0.34;

/**
 * A pool set in the ground with a rounded stone lip, its water a ripple
 * tank: each cell moves toward the average of its neighbours and overshoots,
 * a cheap discrete wave equation, with the lip as a wall the waves bounce off.
 */
export class Pond {
  readonly w: number;
  readonly h: number;
  private readonly cell = 3;
  private readonly gw: number;
  private readonly gh: number;
  private a: Float32Array;
  private b: Float32Array;
  private readonly wet: Uint8Array;
  /** The pool and its lip, drawn once; water pixels are marked NaN and filled each frame. */
  private readonly base: Float32Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.gw = Math.ceil(w / this.cell) + 2;
    this.gh = Math.ceil(h / this.cell) + 2;
    this.a = new Float32Array(this.gw * this.gh);
    this.b = new Float32Array(this.gw * this.gh);
    this.wet = new Uint8Array(this.gw * this.gh);
    this.base = new Float32Array(w * h);

    const m = Math.min(w, h);
    const inset = Math.max(10, m * 0.075);
    const radius = m * 0.16;
    const lip = Math.max(8, m * 0.04);
    const hx = w / 2 - inset;
    const hy = h / 2 - inset;
    // Signed distance to the pool's rounded outline: negative inside.
    const edge = (x: number, y: number) => {
      const qx = Math.abs(x - w / 2) - (hx - radius);
      const qy = Math.abs(y - h / 2) - (hy - radius);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = edge(x + 0.5, y + 0.5);
        let z = GROUND;
        if (d < -lip) z = NaN;
        else if (d < 0) {
          const u = (d + lip / 2) / (lip / 2);
          z = LIP - 0.1 + 0.1 * Math.sqrt(Math.max(0, 1 - u * u));
        }
        this.base[y * w + x] = z;
      }
    }
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) {
        this.wet[j * this.gw + i] = edge((i - 0.5) * this.cell, (j - 0.5) * this.cell) < -lip + this.cell ? 1 : 0;
      }
    }
  }

  /** A stone dropped at (x, y) in sheet pixels; strength 1 is a good splash. */
  drop(x: number, y: number, strength = 1): void {
    const { gw, gh, a, wet, cell } = this;
    const ci = x / cell + 0.5;
    const cj = y / cell + 0.5;
    const r = 3.2;
    for (let j = Math.floor(cj - r * 2); j <= Math.ceil(cj + r * 2); j++) {
      for (let i = Math.floor(ci - r * 2); i <= Math.ceil(ci + r * 2); i++) {
        if (i < 1 || j < 1 || i >= gw - 1 || j >= gh - 1) continue;
        const k = j * gw + i;
        if (!wet[k]) continue;
        const d2 = ((i - ci) ** 2 + (j - cj) ** 2) / (r * r);
        a[k] -= 9 * strength * Math.exp(-d2);
      }
    }
  }

  /** Whether (x, y) is on the water. */
  wetAt(x: number, y: number): boolean {
    return Number.isNaN(this.base[Math.floor(y) * this.w + Math.floor(x)]);
  }

  step(): void {
    const { gw, gh, wet } = this;
    const a = this.a;
    const b = this.b;
    for (let j = 1; j < gh - 1; j++) {
      for (let i = 1; i < gw - 1; i++) {
        const k = j * gw + i;
        if (!wet[k]) {
          b[k] = 0;
          continue;
        }
        const v = (a[k - 1] + a[k + 1] + a[k - gw] + a[k + gw]) * 0.5 - b[k];
        b[k] = v * 0.988;
      }
    }
    this.a = b;
    this.b = a;
  }

  render(depth: Float32Array): void {
    const { w, h, gw, cell, base } = this;
    const a = this.a;
    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / cell + 0.5;
      const j = Math.floor(v);
      const fy = v - j;
      for (let x = 0; x < w; x++) {
        const i0 = y * w + x;
        const z = base[i0];
        if (!Number.isNaN(z)) {
          depth[i0] = z;
          continue;
        }
        const u = (x + 0.5) / cell + 0.5;
        const i = Math.floor(u);
        const fx = u - i;
        const k = j * gw + i;
        const top = a[k] + (a[k + 1] - a[k]) * fx;
        const bottom = a[k + gw] + (a[k + gw + 1] - a[k + gw]) * fx;
        const s = top + (bottom - top) * fy;
        depth[i0] = WATER + Math.max(-0.26, Math.min(0.24, s * 0.018));
      }
    }
  }
}

// ---------------------------------------------------------------- words

/** Box-blur a w * h field in place, three passes each way: close to a Gaussian. */
function blur(field: Float32Array, w: number, h: number, r: number, tmp: Float32Array): void {
  const n = 2 * r + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += field[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = sum / n;
        sum += field[o + Math.min(w - 1, x + r + 1)] - field[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        field[y * w + x] = sum / n;
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }
}

/** Letters raised off the far plane, with rounded shoulders, from an alpha mask. */
export function relief(mask: Uint8Array, w: number, h: number, radius: number): Float32Array {
  const field = new Float32Array(w * h);
  for (let i = 0; i < field.length; i++) field[i] = mask[i] / 255;
  blur(field, w, h, Math.max(1, Math.round(radius / 2)), new Float32Array(w * h));
  for (let i = 0; i < field.length; i++) {
    const t = Math.min(1, Math.max(0, (field[i] - 0.12) / 0.62));
    field[i] = 0.62 * t * t * (3 - 2 * t);
  }
  return field;
}

// ---------------------------------------------------------------- carving

export type Brush = 'raise' | 'carve' | 'smooth';

/** A slab of clay at a third of the way up, to raise, carve, and smooth by touch. */
export class Clay {
  readonly w: number;
  readonly h: number;
  readonly height: Float32Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.height = new Float32Array(w * h).fill(0.3);
  }

  clear(): void {
    this.height.fill(0.3);
  }

  dab(x: number, y: number, r: number, brush: Brush): void {
    const { w, h, height } = this;
    const x0 = Math.max(1, Math.floor(x - r));
    const x1 = Math.min(w - 2, Math.ceil(x + r));
    const y0 = Math.max(1, Math.floor(y - r));
    const y1 = Math.min(h - 2, Math.ceil(y + r));
    const amount = brush === 'raise' ? 0.035 : -0.035;
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d2 = ((i - x) ** 2 + (j - y) ** 2) / (r * r);
        if (d2 >= 1) continue;
        const f = (1 - d2) * (1 - d2);
        const k = j * w + i;
        if (brush === 'smooth') {
          const avg = (height[k - 1] + height[k + 1] + height[k - w] + height[k + w]) * 0.25;
          height[k] += (avg - height[k]) * 0.6 * f;
        } else {
          height[k] = Math.min(0.92, Math.max(0, height[k] + amount * f));
        }
      }
    }
  }

  /** The clay plus a ring hovering over it where the brush is, so the brush can be seen in depth too. */
  render(depth: Float32Array, cursor: { x: number; y: number; r: number } | null): void {
    depth.set(this.height);
    if (!cursor) return;
    const { w, h } = this;
    const { x, y, r } = cursor;
    const under =
      this.height[Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))];
    const lift = Math.min(1, under + 0.12);
    const band = Math.max(1.5, r * 0.06);
    for (let j = Math.max(0, Math.floor(y - r - band)); j <= Math.min(h - 1, Math.ceil(y + r + band)); j++) {
      for (let i = Math.max(0, Math.floor(x - r - band)); i <= Math.min(w - 1, Math.ceil(x + r + band)); i++) {
        const d = Math.abs(Math.hypot(i - x, j - y) - r);
        if (d < band) {
          const k = j * w + i;
          depth[k] = Math.max(depth[k], lift);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- test

export interface Disc {
  x: number;
  y: number;
  r: number;
  z: number;
}

/** Flat discs standing on the far plane, for the depth test. */
export function discs(depth: Float32Array, w: number, h: number, list: Disc[]): void {
  depth.fill(0);
  for (const { x, y, r, z } of list) {
    for (let j = Math.max(0, Math.floor(y - r)); j <= Math.min(h - 1, Math.ceil(y + r)); j++) {
      for (let i = Math.max(0, Math.floor(x - r)); i <= Math.min(w - 1, Math.ceil(x + r)); i++) {
        if ((i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2 <= r * r) depth[j * w + i] = z;
      }
    }
  }
}
