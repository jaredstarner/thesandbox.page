// The record sheet: one row per span of time, read like a page, with the
// trace laid down in rotating inks the way drum recorders cycle their colours
// so neighbouring lines stay apart when a big quake throws them together.

import type { Trace } from './_signal';

const INKS = ['#1a1a1a', '#b3261e', '#1e4fa3', '#1d7a46'];

export interface Layout {
  /** Epoch ms of the first row's start. */
  t0: number;
  /** Seconds per row. */
  rowSec: number;
  rows: number;
  /** Row pitch, CSS px. */
  rowH: number;
  /** Counts to CSS px. */
  gain: number;
}

export class Drum {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly margins: HTMLElement;
  private dpr = 1;
  width = 0;
  height = 0;
  left = 46;
  right = 46;
  top = 0;
  lay: Layout = { t0: 0, rowSec: 1800, rows: 48, rowH: 15, gain: 1 };

  constructor(canvas: HTMLCanvasElement, margins: HTMLElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.margins = margins;
  }

  get plotW(): number {
    return this.width - this.left - this.right;
  }

  /** Sizes the sheet and prints its grid and margins; the trace is drawn separately. */
  layout(width: number, lay: Layout): void {
    this.lay = lay;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    const narrow = width < 520;
    this.left = narrow ? 36 : 48;
    this.right = narrow ? 36 : 48;
    this.top = Math.round(lay.rowH * 1.4);
    this.height = Math.round(this.top * 2 + lay.rows * lay.rowH);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.height = `${this.height}px`;
    this.clear();
    this.printMargins();
  }

  clear(): void {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.printGrid();
  }

  private printGrid(): void {
    const { ctx, lay } = this;
    const mins = lay.rowSec / 60;
    const minor = mins > 30 ? 5 : 1;
    const major = mins > 30 ? 15 : 5;
    const y0 = this.top - lay.rowH * 0.5;
    const y1 = this.top + lay.rows * lay.rowH + lay.rowH * 0.5;
    for (let m = 0; m <= mins; m += minor) {
      const x = Math.round(this.left + (m / mins) * this.plotW) + 0.5;
      const isMajor = m % major === 0;
      ctx.strokeStyle = isMajor ? 'rgba(64, 112, 96, 0.30)' : 'rgba(64, 112, 96, 0.13)';
      ctx.lineWidth = isMajor ? 1 : 0.75;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }
    // Minute numbers printed along the top and bottom edges.
    ctx.fillStyle = 'rgba(40, 70, 58, 0.55)';
    ctx.font = `400 9px ${getComputedStyle(this.canvas).getPropertyValue('--m') || 'monospace'}`;
    ctx.textAlign = 'center';
    for (let m = 0; m <= mins; m += major) {
      const x = this.left + (m / mins) * this.plotW;
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(m), x, y0 - 3);
      ctx.textBaseline = 'top';
      ctx.fillText(String(m), x, y1 + 3);
    }
  }

  private printMargins(): void {
    const { lay } = this;
    const local = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const localDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
    const frag = document.createDocumentFragment();
    let lastDay = '';
    for (let r = 0; r < lay.rows; r++) {
      const t = lay.t0 + r * lay.rowSec * 1000;
      const y = this.baseline(r);
      const day = localDay.format(t);
      const l = document.createElement('span');
      l.className = 'margin l';
      if (day !== lastDay && r > 0) {
        l.classList.add('day');
        l.textContent = day;
        // Keep the date and the time together on a tall enough row; otherwise the date wins.
        if (lay.rowH >= 22) l.textContent = `${day} ${local.format(t)}`;
      } else {
        l.textContent = local.format(t);
      }
      if (r === 0) l.textContent = `${day} ${local.format(t)}`;
      lastDay = day;
      l.style.top = `${y}px`;
      const rt = document.createElement('span');
      rt.className = 'margin r';
      rt.textContent = new Date(t).toISOString().slice(11, 16);
      rt.style.top = `${y}px`;
      // Thin out labels when rows are tight.
      const every = lay.rowH < 13 ? 2 : 1;
      if (r % every === 0 || l.classList.contains('day')) frag.append(l);
      if (r % every === 0) frag.append(rt);
    }
    this.margins.querySelectorAll('.margin').forEach((m) => m.remove());
    this.margins.append(frag);
  }

  baseline(row: number): number {
    return this.top + (row + 0.5) * this.lay.rowH;
  }

  /** Paper position of a moment, on its row's baseline. */
  pos(time: number): { x: number; y: number; row: number } {
    const s = (time - this.lay.t0) / 1000;
    const row = Math.floor(s / this.lay.rowSec);
    const f = s / this.lay.rowSec - row;
    return { x: this.left + f * this.plotW, y: this.baseline(row), row };
  }

  /** The moment under a paper position, or null off the record. */
  timeAt(x: number, y: number): { time: number; row: number } | null {
    const row = Math.floor((y - this.top) / this.lay.rowH);
    const f = (x - this.left) / this.plotW;
    if (row < 0 || row >= this.lay.rows || f < 0 || f > 1) return null;
    return { time: this.lay.t0 + (row + f) * this.lay.rowSec * 1000, row };
  }

  /** Inks samples [from, to) of the trace onto the sheet. */
  draw(trace: Trace, from: number, to: number): void {
    const { ctx, lay } = this;
    const base = Math.round((lay.t0 - trace.t0) / 1000);
    const clip = lay.rowH * 2.6;
    const pxPerSec = this.plotW / lay.rowSec;
    ctx.lineWidth = this.plotW / lay.rowSec > 0.9 ? 1 : 0.85;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    let i = Math.max(from, base, 0);
    const end = Math.min(to, trace.end);
    while (i < end) {
      const s = i - base;
      const row = Math.floor(s / lay.rowSec);
      if (row >= lay.rows) break;
      const rowEnd = Math.min(end, base + (row + 1) * lay.rowSec);
      const y0 = this.baseline(row);
      const rowStartIdx = base + row * lay.rowSec;
      ctx.strokeStyle = INKS[(((Math.floor(lay.t0 / 1000 / lay.rowSec) + row) % 4) + 4) % 4];
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      let pen = false;
      // Join onto the sample before, so increments meet the line already drawn.
      const startK = i > rowStartIdx ? i - 1 : i;
      for (let k = startK; k < rowEnd; k++) {
        const v = trace.values[k];
        if (Number.isNaN(v)) {
          pen = false;
          continue;
        }
        const x = this.left + (k - rowStartIdx) * pxPerSec;
        const dy = Math.max(-clip, Math.min(clip, v * lay.gain));
        if (pen) ctx.lineTo(x, y0 - dy);
        else ctx.moveTo(x, y0 - dy);
        pen = true;
      }
      ctx.stroke();
      i = rowEnd;
    }
    ctx.globalAlpha = 1;
  }

  /** Paper position of sample i: x on its row, y where the pen sits. */
  sampleAt(trace: Trace, i: number): { x: number; y: number } {
    const t = trace.t0 + i * 1000;
    const p = this.pos(t);
    const v = trace.values[Math.max(0, Math.min(trace.end - 1, i))];
    const clip = this.lay.rowH * 2.6;
    const dy = Number.isNaN(v) ? 0 : Math.max(-clip, Math.min(clip, v * this.lay.gain));
    return { x: p.x, y: p.y - dy };
  }
}
