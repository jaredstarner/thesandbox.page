// Keeps the picture levels filled around where the eye is looking. The whole
// world sits at zoom 2; three finer levels (zooms 5, 7, and 8: about 2 km,
// 500 m, and 250 m a pixel) are windows of n by n tiles that slide with the
// station, each tile kept in slot (column mod n, row mod n) so a slide only
// fetches the new edge.

import { GLOBAL, type Renderer, type Residency } from './_render';
import type { TileDone, TileJob } from './_worker';

/** Zooms of the sliding windows; the first two also carry night lights and water. */
const WINDOWS = [5, 7, 8];
const span = (z: number) => 288 / 2 ** z;
const colsAt = (z: number) => Math.ceil(360 / span(z));
const rowsAt = (z: number) => Math.ceil(180 / span(z));
const mod = (a: number, n: number) => ((a % n) + n) % n;

interface Win {
  z: number;
  /** First column (unwrapped, so the window can run on across the antimeridian) and first row. */
  c0: number;
  r0: number;
  /** What each slot holds, as "col,row", per kind. */
  day: (string | null)[];
  aux: (string | null)[];
  set: boolean;
}

interface Pending {
  job: TileJob;
  level: number;
  priority: number;
}

export class Tiles {
  private worker: Worker;
  private wins: Win[];
  private gDay = 0;
  private gAux = 0;
  private queue: Pending[] = [];
  private flight = new Map<number, Pending>();
  private nextId = 1;
  private failedGlobal = 0;
  /** How much of the loaded world tiles came from the chosen day, for the credit line. */
  freshShare = 0;
  private freshSeen: number[] = [];
  /** Finest window allowed: time-lapse can outrun the fine levels. */
  finest = 2;
  onGlobalFailure?: () => void;
  onProgress?: (loaded: number) => void;
  loaded = 0;

  constructor(
    private renderer: Renderer,
    readonly n: number,
    readonly date: string,
  ) {
    this.worker = new Worker(new URL('./_worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<TileDone>) => this.done(e.data);
    this.wins = WINDOWS.map((z) => ({
      z,
      c0: 0,
      r0: 0,
      day: new Array(n * n).fill(null),
      aux: new Array(n * n).fill(null),
      set: false,
    }));
    for (let r = 0; r < GLOBAL.rows; r++)
      for (let c = 0; c < GLOBAL.cols; c++) {
        this.queue.push({ job: this.job('day', GLOBAL.z, r, c), level: -1, priority: r === 2 ? 1 : 0 });
        this.queue.push({ job: this.job('aux', GLOBAL.z, r, c), level: -1, priority: 50 });
      }
  }

  private job(kind: 'day' | 'aux', z: number, row: number, col: number): TileJob {
    return { id: this.nextId++, kind, z, row, col, date: this.date };
  }

  /** Slide the windows so each centres on its focus point (degrees). */
  focus(points: { lat: number; lon: number }[]) {
    const n = this.n;
    this.wins.forEach((w, k) => {
      const p = points[k];
      const s = span(w.z);
      const fc = (p.lon + 180) / s;
      const fr = (90 - p.lat) / s;
      const cols = colsAt(w.z);
      const lastRow = rowsAt(w.z) - n;
      // Bring the focus column round the world to sit nearest the window, so columns run on continuously.
      const fcU = w.set ? fc + Math.round((w.c0 + n / 2 - fc) / cols) * cols : fc;
      const inC = fcU - w.c0;
      const inR = fr - w.r0;
      const margin = n === 3 ? 0.9 : 1.1;
      const settled =
        w.set &&
        inC > margin &&
        inC < n - margin &&
        (inR > margin || w.r0 === 0) &&
        (inR < n - margin || w.r0 === lastRow);
      if (!settled) {
        w.c0 = Math.round(fcU - n / 2);
        w.r0 = Math.max(0, Math.min(lastRow, Math.round(fr - n / 2)));
        w.set = true;
      }
      this.enqueue(k);
    });
    this.pump();
  }

  private enqueue(k: number) {
    const w = this.wins[k];
    const n = this.n;
    // Drop queued jobs this window no longer needs.
    this.queue = this.queue.filter((q) => q.level !== k || this.inWindow(w, q.job.col, q.job.row));
    if (k > this.finest) return;
    const cols = colsAt(w.z);
    for (let dr = 0; dr < n; dr++)
      for (let dc = 0; dc < n; dc++) {
        const col = mod(w.c0 + dc, cols);
        const row = w.r0 + dr;
        const key = `${col},${row}`;
        const slot = mod(w.r0 + dr, n) * n + mod(w.c0 + dc, n);
        const kinds: ('day' | 'aux')[] = k < 2 ? ['day', 'aux'] : ['day'];
        for (const kind of kinds) {
          if (w[kind][slot] === key) continue;
          const busy = [...this.queue, ...this.flight.values()].some(
            (q) => q.level === k && q.job.kind === kind && q.job.col === col && q.job.row === row,
          );
          if (busy) continue;
          const centre = Math.hypot(dc + 0.5 - n / 2, dr + 0.5 - n / 2);
          this.queue.push({
            job: this.job(kind, w.z, row, col),
            level: k,
            priority: 10 + k * 10 + centre + (kind === 'aux' ? 25 : 0),
          });
        }
      }
  }

  private inWindow(w: Win, col: number, row: number) {
    const dc = mod(col - w.c0, colsAt(w.z));
    const dr = row - w.r0;
    return dc < this.n && dr >= 0 && dr < this.n;
  }

  private pump() {
    this.queue.sort((a, b) => a.priority - b.priority);
    while (this.flight.size < 6 && this.queue.length) {
      const p = this.queue.shift()!;
      this.flight.set(p.job.id, p);
      this.worker.postMessage(p.job);
    }
  }

  private done(d: TileDone) {
    const p = this.flight.get(d.id);
    this.flight.delete(d.id);
    if (!p) return;
    const { job } = p;
    if (p.level < 0) {
      if (d.ok && d.data) {
        this.renderer.globalTile(job.kind, job.col, job.row, d.data);
        const bit = 1 << (job.row * GLOBAL.cols + job.col);
        if (job.kind === 'day') {
          this.gDay |= bit;
          if (job.row < 2 && d.fresh !== undefined) this.freshSeen.push(d.fresh);
          this.freshShare = this.freshSeen.reduce((a, b) => a + b, 0) / (this.freshSeen.length || 1);
        } else this.gAux |= bit;
      } else if (job.kind === 'day' && ++this.failedGlobal >= 4) this.onGlobalFailure?.();
    } else if (d.ok && d.data) {
      const w = this.wins[p.level];
      if (this.inWindow(w, job.col, job.row)) {
        const dc = mod(job.col - w.c0, colsAt(w.z));
        const sc = mod(w.c0 + dc, this.n);
        const sr = mod(job.row, this.n);
        this.renderer.windowTile(job.kind, p.level, sc, sr, d.data);
        w[job.kind][sr * this.n + sc] = `${job.col},${job.row}`;
      }
    }
    this.loaded++;
    this.onProgress?.(this.loaded);
    this.pump();
  }

  residency(): Residency {
    const n = this.n;
    const win: number[] = [];
    const dayMask: number[] = [];
    const auxMask: number[] = [];
    this.wins.forEach((w, k) => {
      const cols = colsAt(w.z);
      win.push(w.c0, w.r0, span(w.z), cols);
      let dm = 0;
      let am = 0;
      if (w.set && k <= this.finest) {
        for (let dr = 0; dr < n; dr++)
          for (let dc = 0; dc < n; dc++) {
            const key = `${mod(w.c0 + dc, cols)},${w.r0 + dr}`;
            const slot = mod(w.r0 + dr, n) * n + mod(w.c0 + dc, n);
            if (w.day[slot] === key) dm |= 1 << (dr * n + dc);
            if (w.aux[slot] === key) am |= 1 << (dr * n + dc);
          }
      }
      dayMask.push(dm);
      if (k < 2) auxMask.push(am);
    });
    return { win, dayMask, auxMask, gDayMask: this.gDay, gAuxMask: this.gAux };
  }

  /** Requests still to be answered, for the loading note. */
  get busy() {
    return this.queue.length + this.flight.size;
  }
}
