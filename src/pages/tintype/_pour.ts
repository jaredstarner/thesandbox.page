// A thin-film model of collodion (or varnish) poured on a plate and run
// about by tipping it. Depth lives on a coarse grid; flow between cells is
// upwind lubrication flow, mobility (h - residual)^2, so a pool runs freely
// while the film it leaves behind barely moves. A dry cell is only wetted
// once the pressure across the edge beats a pinning threshold, which keeps
// the pool's front rounded, and liquid leaves the plate only where it is
// tipped hard over an edge (most easily at a corner).

export interface PourTuning {
  /** Flow rate. */
  mobility: number;
  /** Film left behind that no longer flows. */
  residual: number;
  /** Extra head a pool needs to advance onto dry plate. */
  pin: number;
  /** Tip toward a straight edge, and toward both edges of a corner, past which liquid spills. */
  spillEdge: number;
  spillCorner: number;
  /** Tip strength: head gained per cell travelled downhill at full tilt. */
  gravity: number;
  /** Seconds after pouring before the film starts to set, and how fast it then stiffens. */
  setAfter: number;
  setRate: number;
}

export const COLLODION: PourTuning = {
  mobility: 300,
  residual: 0.035,
  pin: 0.32,
  spillEdge: 1.6,
  spillCorner: 0.95,
  gravity: 0.5,
  setAfter: 22,
  setRate: 7,
};

export const VARNISH: PourTuning = {
  ...COLLODION,
  mobility: 380,
  residual: 0.05,
  setAfter: 40,
};

export class Pour {
  readonly w: number;
  readonly h: number;
  readonly depth: Float32Array;
  /** 1 once a cell has been under liquid. */
  readonly reached: Uint8Array;
  private readonly flux: Float32Array;
  readonly tune: PourTuning;
  /** Downhill direction times the sine of the tip, x right and y down the plate. */
  tiltX = 0;
  tiltY = 0;
  age = 0;
  poured = 0;
  drained = 0;
  /** Which corner the last spill left from: 0 top left, 1 top right, 2 bottom right, 3 bottom left. */
  drainCorner = 2;
  private cornerSpill = [0, 0, 0, 0];
  /** How much the plate was rocked while draining, for the ridges at the drain corner. */
  rock = 0;
  private draining = 0;
  private lastTilt = [0, 0];

  constructor(w: number, h: number, tune: PourTuning = COLLODION) {
    this.w = w;
    this.h = h;
    this.tune = tune;
    this.depth = new Float32Array(w * h);
    this.reached = new Uint8Array(w * h);
    this.flux = new Float32Array(w * h * 2);
  }

  /** Pour `amount` of liquid (depth times cells) around a point in cell units. */
  pourAt(x: number, y: number, amount: number) {
    const r = 3.2;
    const x0 = Math.max(0, Math.floor(x - r * 2));
    const x1 = Math.min(this.w - 1, Math.ceil(x + r * 2));
    const y0 = Math.max(0, Math.floor(y - r * 2));
    const y1 = Math.min(this.h - 1, Math.ceil(y + r * 2));
    let total = 0;
    const weights: number[] = [];
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d2 = (i - x) ** 2 + (j - y) ** 2;
        const k = Math.exp(-d2 / (r * r));
        weights.push(k);
        total += k;
      }
    }
    if (total <= 0) return;
    let n = 0;
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const idx = j * this.w + i;
        this.depth[idx] += (amount * weights[n++]) / total;
        if (this.depth[idx] > this.tune.residual) this.reached[idx] = 1;
      }
    }
    this.poured += amount;
  }

  /** The depth softened by one cell, for drawing: the grid's staircase would show along a pool's edge. */
  smoothed(out: Float32Array) {
    const { w, h, depth } = this;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let s = 0;
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const y = j + dj;
          if (y < 0 || y >= h) continue;
          for (let di = -1; di <= 1; di++) {
            const x = i + di;
            if (x < 0 || x >= w) continue;
            const k = (di ? 1 : 2) * (dj ? 1 : 2);
            s += depth[y * w + x] * k;
            n += k;
          }
        }
        out[j * w + i] = s / n;
      }
    }
    return out;
  }

  /** Fraction of the plate the liquid has reached. */
  coverage(): number {
    let n = 0;
    for (let i = 0; i < this.reached.length; i++) n += this.reached[i];
    return n / this.reached.length;
  }

  /** Liquid still free to run: everything above the residual film. */
  mobile(): number {
    const r = this.tune.residual;
    let v = 0;
    for (let i = 0; i < this.depth.length; i++) v += Math.max(0, this.depth[i] - r * 1.6);
    return v;
  }

  /** How far the film has set, 0 to 1. */
  setting(): number {
    return 1 - Math.exp(-Math.max(0, this.age - this.tune.setAfter) / this.tune.setRate);
  }

  step(dt: number) {
    // The film starts to set from the moment it is poured.
    if (this.poured > 0) this.age += dt;
    const t = this.tune;
    const mob = t.mobility * (1 - this.setting());
    const tiltMag = Math.hypot(this.tiltX, this.tiltY);
    const dTilt = Math.hypot(this.tiltX - this.lastTilt[0], this.tiltY - this.lastTilt[1]);
    this.lastTilt[0] = this.tiltX;
    this.lastTilt[1] = this.tiltY;
    if (mob < 1e-3) return;
    // Keep each substep stable: the fastest edge may move at most a fifth of its head.
    let maxH = 0;
    for (let i = 0; i < this.depth.length; i++) if (this.depth[i] > maxH) maxH = this.depth[i];
    const m = Math.max(1e-4, maxH - t.residual);
    const maxMob = mob * m * m * (maxH + tiltMag * t.gravity * 4);
    const sub = Math.min(48, Math.max(1, Math.ceil((dt * maxMob) / 0.12)));
    const h = dt / sub;
    for (let s = 0; s < sub; s++) this.substep(h, mob);
    // Rocking while liquid still runs off the plate breaks up the ridges at the drain corner.
    if (this.draining > 0) this.rock = this.rock * Math.exp(-dt / 6) + dTilt;
  }

  private substep(dt: number, mob: number) {
    const { w, h, depth, flux, tune, reached } = this;
    const gx = this.tiltX * tune.gravity;
    const gy = this.tiltY * tune.gravity;
    const res = tune.residual;
    const mobility = (d: number) => {
      const e = d - res;
      return e > 0 ? mob * e * e : 0;
    };
    // Fluxes on right and down edges: positive means flow toward the higher index.
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const a = j * w + i;
        const da = depth[a];
        if (i < w - 1) {
          const b = a + 1;
          const db = depth[b];
          const head = da - db + gx;
          let q = 0;
          if (head > 0) {
            if (reached[b] || head > tune.pin + res) q = mobility(da) * head;
          } else if (reached[a] || -head > tune.pin + res) q = -mobility(db) * -head;
          flux[a * 2] = q * dt;
        } else flux[a * 2] = 0;
        if (j < h - 1) {
          const b = a + w;
          const db = depth[b];
          const head = da - db + gy;
          let q = 0;
          if (head > 0) {
            if (reached[b] || head > tune.pin + res) q = mobility(da) * head;
          } else if (reached[a] || -head > tune.pin + res) q = -mobility(db) * -head;
          flux[a * 2 + 1] = q * dt;
        } else flux[a * 2 + 1] = 0;
      }
    }
    // Limit each cell's outflow to the liquid above its residual film.
    for (let a = 0; a < w * h; a++) {
      const i = a % w;
      const j = (a - i) / w;
      let out = 0;
      const r = flux[a * 2];
      const d = flux[a * 2 + 1];
      if (r > 0) out += r;
      if (d > 0) out += d;
      if (i > 0 && flux[(a - 1) * 2] < 0) out -= flux[(a - 1) * 2];
      if (j > 0 && flux[(a - w) * 2 + 1] < 0) out -= flux[(a - w) * 2 + 1];
      const avail = Math.max(0, depth[a] - res);
      if (out > avail && out > 0) {
        const k = avail / out;
        if (r > 0) flux[a * 2] *= k;
        if (d > 0) flux[a * 2 + 1] *= k;
        if (i > 0 && flux[(a - 1) * 2] < 0) flux[(a - 1) * 2] *= k;
        if (j > 0 && flux[(a - w) * 2 + 1] < 0) flux[(a - w) * 2 + 1] *= k;
      }
    }
    for (let a = 0; a < w * h; a++) {
      const i = a % w;
      const j = (a - i) / w;
      let d = depth[a] - flux[a * 2] - flux[a * 2 + 1];
      if (i > 0) d += flux[(a - 1) * 2];
      if (j > 0) d += flux[(a - w) * 2 + 1];
      depth[a] = d;
      if (d > res * 1.1) this.reached[a] = 1;
    }
    // Spill over the edges the plate is tipped toward: the meniscus holds until
    // the tip toward that edge (both edges, at a corner) passes a threshold.
    const spill = (a: number, outward: number, corner: number) => {
      const threshold = corner >= 0 ? tune.spillCorner : tune.spillEdge;
      if (outward <= threshold || depth[a] <= res) return;
      const head = depth[a] + (outward - threshold) * tune.gravity * 4;
      const q = Math.min(depth[a] - res, mobility(depth[a]) * head * dt * 2);
      depth[a] -= q;
      this.drained += q;
      if (corner >= 0) this.cornerSpill[corner] += q;
      this.draining = 1;
    };
    this.draining = Math.max(0, this.draining - dt * 2);
    const left = Math.max(0, -this.tiltX);
    const right = Math.max(0, this.tiltX);
    const top = Math.max(0, -this.tiltY);
    const bottom = Math.max(0, this.tiltY);
    // A corner drains through its own cell and the two beside it.
    const corners: [number, number, number, number][] = [
      [0, 1, w, left + top],
      [w - 1, w - 2, 2 * w - 1, right + top],
      [w * h - 1, w * h - 2, w * (h - 1) - 1, right + bottom],
      [(h - 1) * w, (h - 1) * w + 1, (h - 2) * w, left + bottom],
    ];
    corners.forEach(([c, a, b, out], n) => {
      spill(c, out, n);
      spill(a, out, n);
      spill(b, out, n);
    });
    for (let i = 2; i < w - 2; i++) {
      if (top > 0) spill(i, top, -1);
      if (bottom > 0) spill((h - 1) * w + i, bottom, -1);
    }
    for (let j = 2; j < h - 2; j++) {
      if (left > 0) spill(j * w, left, -1);
      if (right > 0) spill(j * w + w - 1, right, -1);
    }
    let best = this.drainCorner;
    for (let c = 0; c < 4; c++) if (this.cornerSpill[c] > this.cornerSpill[best]) best = c;
    this.drainCorner = best;
  }
}
