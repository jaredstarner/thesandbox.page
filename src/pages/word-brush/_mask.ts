// The painted mask: where the brush has made room for type. Strokes are kept
// as data, in CSS pixels, so the mask can be rebuilt after an undo or a resize.
// The mask itself is a canvas at one cell per CELL CSS pixels, painted in the
// wash color; its alpha channel is what the type reads.

export const CELL = 2;

export type Mode = 'paint' | 'erase';

/** A brush stroke: a polyline with a width at every point, flat as x, y, w. */
export interface LineStroke {
  kind: 'line';
  mode: Mode;
  pts: number[];
}

/** A filled shape: polygons as flat x, y lists, filled even-odd. */
export interface FillStroke {
  kind: 'fill';
  mode: Mode;
  rings: number[][];
}

export type Stroke = LineStroke | FillStroke;

export const WASH = '#5f7fa8';

export class Mask {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  /** Alpha per cell, row-major. */
  alpha = new Uint8Array(0);
  cols = 0;
  rows = 0;
  private dirty: [number, number, number, number] | null = null;

  constructor() {
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
  }

  /** Size the mask for a sheet of cssW by cssH, emptying it. */
  resize(cssW: number, cssH: number): void {
    this.cols = Math.max(1, Math.ceil(cssW / CELL));
    this.rows = Math.max(1, Math.ceil(cssH / CELL));
    this.canvas.width = this.cols;
    this.canvas.height = this.rows;
    this.alpha = new Uint8Array(this.cols * this.rows);
    this.ctx.setTransform(1 / CELL, 0, 0, 1 / CELL, 0, 0);
    this.dirty = null;
  }

  clear(): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.cols, this.rows);
    this.ctx.restore();
    this.alpha.fill(0);
    this.dirty = null;
  }

  private mark(x0: number, y0: number, x1: number, y1: number): void {
    const d = this.dirty;
    this.dirty = d
      ? [Math.min(d[0], x0), Math.min(d[1], y0), Math.max(d[2], x1), Math.max(d[3], y1)]
      : [x0, y0, x1, y1];
  }

  private begin(mode: Mode): CanvasRenderingContext2D {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.fillStyle = ctx.strokeStyle = WASH;
    return ctx;
  }

  /** One round-capped piece of a stroke, tapering from w0 to w1. */
  segment(mode: Mode, x0: number, y0: number, w0: number, x1: number, y1: number, w1: number): void {
    const ctx = this.begin(mode);
    const r0 = w0 / 2;
    const r1 = w1 / 2;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    ctx.beginPath();
    ctx.arc(x1, y1, r1, 0, Math.PI * 2);
    ctx.fill();
    if (len > Math.abs(r1 - r0)) {
      // The hull of two circles: tangent lines between them.
      const nx = dx / len;
      const ny = dy / len;
      const s = (r0 - r1) / len;
      const c = Math.sqrt(Math.max(0, 1 - s * s));
      const px = nx * s;
      const py = ny * s;
      const ax = -ny * c;
      const ay = nx * c;
      ctx.beginPath();
      ctx.moveTo(x0 + (px + ax) * r0, y0 + (py + ay) * r0);
      ctx.lineTo(x1 + (px + ax) * r1, y1 + (py + ay) * r1);
      ctx.lineTo(x1 + (px - ax) * r1, y1 + (py - ay) * r1);
      ctx.lineTo(x0 + (px - ax) * r0, y0 + (py - ay) * r0);
      ctx.closePath();
      ctx.fill();
    }
    const r = Math.max(r0, r1) + CELL;
    this.mark(Math.min(x0, x1) - r, Math.min(y0, y1) - r, Math.max(x0, x1) + r, Math.max(y0, y1) + r);
  }

  dot(mode: Mode, x: number, y: number, w: number): void {
    const ctx = this.begin(mode);
    ctx.beginPath();
    ctx.arc(x, y, w / 2, 0, Math.PI * 2);
    ctx.fill();
    const r = w / 2 + CELL;
    this.mark(x - r, y - r, x + r, y + r);
  }

  /** Fill polygons, optionally only between two heights (for pouring a shape in). */
  fill(mode: Mode, rings: number[][], band?: [number, number]): void {
    const ctx = this.begin(mode);
    ctx.save();
    if (band) {
      ctx.beginPath();
      ctx.rect(-CELL, band[0], (this.cols + 2) * CELL, band[1] - band[0]);
      ctx.clip();
    }
    ctx.beginPath();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i += 2) {
        const x = ring[i];
        const y = ring[i + 1];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      ctx.closePath();
    }
    ctx.fill('evenodd');
    ctx.restore();
    if (band) {
      y0 = Math.max(y0, band[0]);
      y1 = Math.min(y1, band[1]);
    }
    if (x0 <= x1 && y0 <= y1) this.mark(x0 - CELL, y0 - CELL, x1 + CELL, y1 + CELL);
  }

  /** The top and bottom of a recorded stroke. */
  static extent(stroke: Stroke): [number, number] {
    let y0 = Infinity;
    let y1 = -Infinity;
    if (stroke.kind === 'fill') {
      for (const ring of stroke.rings) {
        for (let i = 1; i < ring.length; i += 2) {
          y0 = Math.min(y0, ring[i]);
          y1 = Math.max(y1, ring[i]);
        }
      }
    } else {
      for (let i = 0; i < stroke.pts.length; i += 3) {
        y0 = Math.min(y0, stroke.pts[i + 1] - stroke.pts[i + 2] / 2);
        y1 = Math.max(y1, stroke.pts[i + 1] + stroke.pts[i + 2] / 2);
      }
    }
    return [y0, y1];
  }

  /** Paint a whole recorded stroke. */
  draw(stroke: Stroke): void {
    if (stroke.kind === 'fill') {
      this.fill(stroke.mode, stroke.rings);
      return;
    }
    const p = stroke.pts;
    if (p.length < 3) return;
    this.dot(stroke.mode, p[0], p[1], p[2]);
    for (let i = 3; i < p.length; i += 3) {
      this.segment(stroke.mode, p[i - 3], p[i - 2], p[i - 1], p[i], p[i + 1], p[i + 2]);
    }
  }

  /**
   * Copy what changed into the alpha array. Returns the changed rows as a
   * CSS pixel range, or null when nothing changed.
   */
  sync(): [number, number] | null {
    const d = this.dirty;
    if (!d) return null;
    this.dirty = null;
    const c0 = Math.max(0, Math.floor(d[0] / CELL));
    const r0 = Math.max(0, Math.floor(d[1] / CELL));
    const c1 = Math.min(this.cols, Math.ceil(d[2] / CELL));
    const r1 = Math.min(this.rows, Math.ceil(d[3] / CELL));
    if (c1 <= c0 || r1 <= r0) return null;
    const data = this.ctx.getImageData(c0, r0, c1 - c0, r1 - r0).data;
    const w = c1 - c0;
    for (let r = r0; r < r1; r++) {
      const row = r * this.cols;
      const src = (r - r0) * w * 4 + 3;
      for (let c = 0; c < w; c++) this.alpha[row + c0 + c] = data[src + c * 4];
    }
    return [r0 * CELL, r1 * CELL];
  }

  /**
   * Where a line of type fits in the band from y to y + height: runs of
   * columns covered across the middle of the band, as CSS pixel [x0, x1]
   * pairs, left to right, at least minWidth wide after the inset.
   */
  spans(y: number, height: number, minWidth: number, inset: number): number[] {
    const top = Math.max(0, Math.floor((y + height * 0.16) / CELL));
    const bottom = Math.min(this.rows - 1, Math.floor((y + height * 0.84) / CELL));
    const out: number[] = [];
    if (bottom < top) return out;
    const cols = this.cols;
    const alpha = this.alpha;
    let run = -1;
    for (let c = 0; c <= cols; c++) {
      let ok = c < cols;
      for (let r = top; ok && r <= bottom; r++) if (alpha[r * cols + c] < 128) ok = false;
      if (ok && run < 0) run = c;
      if (!ok && run >= 0) {
        const x0 = run * CELL + inset;
        const x1 = c * CELL - inset;
        if (x1 - x0 >= minWidth) out.push(x0, x1);
        run = -1;
      }
    }
    return out;
  }
}
