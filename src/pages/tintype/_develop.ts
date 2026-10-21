// The developer: poured across the plate in one stroke, it sheets outward
// from wherever it lands at a fixed speed until the poured volume is spent.
// Arrival times come from a Dijkstra pass over the grid, so a hesitant pour
// leaves a front that reaches some of the plate late, or never. Each cell then
// develops on its own clock until the plate is rinsed, and fogs if left too
// long. Where the stream lands, fresh developer works harder (a surge mark).

/** Seconds for development to reach 63% of its full density. */
const TAU = 4.5;
/** Seconds of development before fog starts to veil the shadows, and its rate. */
const FOG_AFTER = 17;
const FOG_RATE = 1 / 30;
const FOG_MAX = 0.4;

export class Developer {
  readonly w: number;
  readonly h: number;
  /** When each cell was reached; Infinity while dry. */
  readonly wetAt: Float32Array;
  readonly surge: Float32Array;
  private readonly arrival: Float32Array;
  /** Cells' worth of developer poured, and cells wetted. */
  private capacity = 0;
  private wetCount = 0;
  /** Cells per second the front sheets across the plate. */
  speed = 46;
  time = 0;
  stoppedAt = Infinity;
  firstPourAt = Infinity;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.wetAt = new Float32Array(w * h).fill(Infinity);
    this.surge = new Float32Array(w * h);
    this.arrival = new Float32Array(w * h).fill(Infinity);
  }

  get poured() {
    return this.firstPourAt < Infinity;
  }

  /** Fraction of the plate under developer. */
  coverage() {
    return this.wetCount / (this.w * this.h);
  }

  /** Pour for `dt` seconds at a point in cell units. */
  pourAt(x: number, y: number, dt: number) {
    if (this.stoppedAt < Infinity) return;
    if (this.firstPourAt === Infinity) this.firstPourAt = this.time;
    this.capacity += dt * 9000;
    const r = 2.6;
    const seeds: number[] = [];
    for (let j = Math.max(0, Math.floor(y - r)); j <= Math.min(this.h - 1, Math.ceil(y + r)); j++) {
      for (let i = Math.max(0, Math.floor(x - r)); i <= Math.min(this.w - 1, Math.ceil(x + r)); i++) {
        const d2 = (i - x) ** 2 + (j - y) ** 2;
        if (d2 > r * r) continue;
        const a = j * this.w + i;
        this.surge[a] = Math.min(1, this.surge[a] + dt * 2.2 * (1 - d2 / (r * r)));
        if (this.time < this.arrival[a]) {
          this.arrival[a] = this.time;
          seeds.push(a);
        }
      }
    }
    if (seeds.length) this.relax(seeds);
  }

  /** Dijkstra from newly seeded cells, lowering arrival times across the grid. */
  private relax(seeds: number[]) {
    const { w, h, arrival } = this;
    const heap: number[] = [];
    const key = (a: number) => arrival[a];
    const push = (a: number) => {
      heap.push(a);
      let n = heap.length - 1;
      while (n > 0) {
        const p = (n - 1) >> 1;
        if (key(heap[p]) <= key(heap[n])) break;
        [heap[p], heap[n]] = [heap[n], heap[p]];
        n = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let n = 0;
        for (;;) {
          const l = n * 2 + 1;
          const r = l + 1;
          let m = n;
          if (l < heap.length && key(heap[l]) < key(heap[m])) m = l;
          if (r < heap.length && key(heap[r]) < key(heap[m])) m = r;
          if (m === n) break;
          [heap[m], heap[n]] = [heap[n], heap[m]];
          n = m;
        }
      }
      return top;
    };
    for (const s of seeds) push(s);
    const step = 1 / this.speed;
    const diag = Math.SQRT2 / this.speed;
    const settled = new Uint8Array(w * h);
    while (heap.length) {
      const a = pop();
      if (settled[a]) continue;
      settled[a] = 1;
      const i = a % w;
      const j = (a - i) / w;
      const t = arrival[a];
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
          const b = nj * w + ni;
          const nt = t + (di && dj ? diag : step);
          if (nt < arrival[b]) {
            arrival[b] = nt;
            push(b);
          }
        }
      }
    }
  }

  step(dt: number) {
    this.time += dt;
    if (this.stoppedAt < Infinity) return;
    const { arrival, wetAt } = this;
    for (let a = 0; a < arrival.length && this.wetCount < this.capacity; a++) {
      if (wetAt[a] === Infinity && arrival[a] <= this.time) {
        wetAt[a] = arrival[a];
        this.wetCount++;
      }
    }
  }

  rinse() {
    if (this.stoppedAt === Infinity) this.stoppedAt = this.time;
  }

  /**
   * Per cell: development progress, fog, surge, and the wet front's freshness,
   * packed RGBA for the plate's texture.
   */
  fill(out: Float32Array) {
    const end = Math.min(this.time, this.stoppedAt);
    for (let a = 0; a < this.wetAt.length; a++) {
      const o = a * 4;
      const at = this.wetAt[a];
      if (at === Infinity) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
        continue;
      }
      const t = Math.max(0, end - at);
      const s = this.surge[a];
      out[o] = 1 - Math.exp((-t * (1 + s * 0.9)) / TAU);
      out[o + 1] = Math.min(FOG_MAX, Math.max(0, t - FOG_AFTER) * FOG_RATE);
      out[o + 2] = s;
      // 1 at the moment the front arrives, fading as the film settles; 0.25 while it stays wet.
      out[o + 3] = this.stoppedAt < Infinity ? 0.25 : 0.25 + 0.75 * Math.max(0, 1 - (this.time - at) / 0.4);
    }
  }
}
