// A polyline the beam walks at a steady speed. Each pass of the path is one cycle of the
// note, so a path takes the same time to draw however long it is: a longer path means a
// faster beam, which is why long drawings come out dimmer.

/** How much of a drawn stroke's time a pen-up jump of the same length gets. */
const JUMP_WEIGHT = 0.05;

export class Path {
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  private readonly cum: Float32Array;
  private readonly pen: Uint8Array;
  n = 0;
  total = 0;
  /** The beam position from the last `sample`. */
  x = 0;
  y = 0;
  private cursor = 0;

  constructor(readonly capacity: number) {
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
    this.cum = new Float32Array(capacity + 1);
    this.pen = new Uint8Array(capacity + 1);
  }

  clear(): void {
    this.n = 0;
    this.total = 0;
    this.cursor = 0;
  }

  private push(x: number, y: number, pen: number): void {
    if (this.n >= this.capacity) return;
    this.xs[this.n] = x;
    this.ys[this.n] = y;
    this.pen[this.n] = pen;
    this.n++;
  }

  /** Jump here with the pen up: the beam can't switch off, so it crosses fast and faint. */
  moveTo(x: number, y: number): void {
    this.push(x, y, 0);
  }

  lineTo(x: number, y: number): void {
    this.push(x, y, 1);
  }

  /** Work out the walk. `closed` draws the way back to the start; otherwise it is a jump. */
  finish(closed = false): void {
    let sum = 0;
    this.cum[0] = 0;
    for (let i = 1; i < this.n; i++) {
      const len = Math.hypot(this.xs[i] - this.xs[i - 1], this.ys[i] - this.ys[i - 1]);
      sum += this.pen[i] ? len : len * JUMP_WEIGHT;
      this.cum[i] = sum;
    }
    if (this.n > 0) {
      const len = Math.hypot(this.xs[0] - this.xs[this.n - 1], this.ys[0] - this.ys[this.n - 1]);
      sum += closed ? len : len * JUMP_WEIGHT;
    }
    this.cum[this.n] = sum;
    this.total = sum;
    this.cursor = 0;
  }

  /** Write this path's pen flags into `out`, for keeping a laid-out path. */
  copyPens(out: Uint8Array): void {
    out.set(this.pen.subarray(0, Math.min(this.n, out.length)));
  }

  /** Beam position `u` of the way through a pass, 0 to 1. Fastest called with rising `u`. */
  sample(u: number): void {
    if (this.n === 0) {
      this.x = 0;
      this.y = 0;
      return;
    }
    if (this.n === 1 || this.total <= 0) {
      this.x = this.xs[0];
      this.y = this.ys[0];
      return;
    }
    const target = u * this.total;
    let i = this.cursor;
    if (target < this.cum[i]) i = 0;
    while (i < this.n - 1 && this.cum[i + 1] < target) i++;
    this.cursor = i;
    const j = i + 1 >= this.n ? 0 : i + 1;
    const span = this.cum[i + 1] - this.cum[i];
    const k = span > 0 ? (target - this.cum[i]) / span : 0;
    this.x = this.xs[i] + (this.xs[j] - this.xs[i]) * k;
    this.y = this.ys[i] + (this.ys[j] - this.ys[i]) * k;
  }
}
