// The draft on squared paper, laid out the way weavers write it: the warp's
// colour order and the threading across the top, the tie-up at the top right,
// the treadling and the weft's colour order down the right, and the drawdown
// in the big grid, worked out from the other three.

import { MAX_REPEAT, SHAFTS, TREADLES, YARNS, hex, liftMask, type Draft } from './_drafts';
import { hash } from './_cloth';

type Region = 'warp' | 'threading' | 'tieup' | 'treadling' | 'weft';

export interface SheetHooks {
  /** Whether the warp can be rethreaded or recoloured right now. */
  warpFree: () => boolean;
  /** Someone tried to change the warp while cloth is on the loom. */
  locked: () => void;
  changed: (what: Region) => void;
  /** The yarn to paint colour orders with. */
  yarn: () => number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const INK = '#25211c';
const GRID = 'rgba(70, 112, 108, 0.26)';
const GRID_CM = 'rgba(70, 112, 108, 0.5)';
const MADDER = '#a4362a';

export class DraftSheet {
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private draft: Draft;
  private hooks: SheetHooks;
  private c = 7;
  private dpr = 1;
  private boxes!: Record<Region | 'drawdown', Box>;
  private W = 0;
  private H = 0;
  private family = 'Georgia, serif';
  mode: 'ink' | 'colour' = 'ink';
  /** The next pick's row in the repeat. */
  cursor = 0;
  /** While a pick is being woven: the treadle pressed. */
  pressed: number | null = null;
  private drag: { region: Region; value: number | boolean; last: number } | null = null;

  constructor(canvas: HTMLCanvasElement, draft: Draft, hooks: SheetHooks, family: string) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d')!;
    this.draft = draft;
    this.hooks = hooks;
    this.family = family || this.family;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    const end = () => (this.drag = null);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  setDraft(d: Draft) {
    this.draft = d;
    this.draw();
  }

  /** Lay the sheet out for cells of c CSS pixels. */
  size(c: number) {
    this.c = c;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const ends = this.draft.threading.length;
    const left = 24;
    const top = 18;
    const gapX = Math.round(c * 1.8);
    const gapY = 20;
    const thread: Box = { x: left, y: top + c + 3, w: ends * c, h: SHAFTS * c };
    const warp: Box = { x: left, y: top, w: ends * c, h: c };
    const tieup: Box = { x: left + ends * c + gapX, y: thread.y, w: TREADLES * c, h: SHAFTS * c };
    const drawdown: Box = { x: left, y: thread.y + thread.h + gapY, w: ends * c, h: MAX_REPEAT * c };
    const treadling: Box = { x: tieup.x, y: drawdown.y, w: TREADLES * c, h: MAX_REPEAT * c };
    const weft: Box = { x: tieup.x + tieup.w + 4, y: drawdown.y, w: c, h: MAX_REPEAT * c };
    this.boxes = { warp, threading: thread, tieup, drawdown, treadling, weft };
    this.W = weft.x + weft.w + 16;
    this.H = drawdown.y + drawdown.h + 20;
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.draw();
  }

  /** Width the sheet needs for cells of c pixels. */
  static widthFor(c: number, ends: number) {
    return 24 + ends * c + Math.round(c * 1.8) + TREADLES * c + 4 + c + 16;
  }

  draw() {
    if (!this.boxes) return;
    const g = this.g;
    const d = this.draft;
    const c = this.c;
    const B = this.boxes;
    const L = d.treadling.length;
    const ends = d.threading.length;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);

    // Labels, in small capitals.
    g.fillStyle = '#5d5447';
    g.font = `600 12px ${this.family}`;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillText('threading', B.warp.x, B.warp.y - 6);
    g.fillText('tie-up', B.tieup.x, B.warp.y - 6);
    g.fillText('drawdown', B.drawdown.x, B.drawdown.y - 7);
    g.textAlign = 'right';
    g.fillText('treadling', B.weft.x + B.weft.w, B.treadling.y + B.treadling.h + 15);
    // Shaft numbers, 1 nearest the weaver at the bottom; treadle numbers under the tie-up.
    g.font = `400 10px ${this.family}`;
    g.fillStyle = '#7b705f';
    g.textAlign = 'center';
    for (let s = 0; s < SHAFTS; s++) {
      g.fillText(String(s + 1), B.threading.x - 10, B.threading.y + (SHAFTS - 1 - s) * c + c * 0.5 + 3.5);
    }
    for (let t = 0; t < TREADLES; t++) {
      g.fillText(String(t + 1), B.tieup.x + t * c + c / 2, B.tieup.y + B.tieup.h + 12);
    }

    // While a pick is woven, mark the lifted shafts and the treadle.
    const mask = this.pressed !== null ? liftMask(d.tieup, this.pressed) : 0;
    if (mask) {
      g.fillStyle = 'rgba(164, 54, 42, 0.12)';
      for (let s = 0; s < SHAFTS; s++) {
        if (mask & (1 << s)) g.fillRect(B.threading.x, B.threading.y + (SHAFTS - 1 - s) * c, B.threading.w, c);
      }
      g.fillRect(B.tieup.x + (this.pressed ?? 0) * c, B.tieup.y, c, B.tieup.h);
    }

    // The next pick's row.
    const row = L ? this.cursor % L : 0;
    g.fillStyle = 'rgba(164, 54, 42, 0.1)';
    g.fillRect(B.drawdown.x, B.drawdown.y + row * c, B.drawdown.w, c);
    g.fillRect(B.treadling.x, B.treadling.y + row * c, B.treadling.w, c);

    // Grids.
    this.grid(B.warp, ends, 1);
    this.grid(B.threading, ends, SHAFTS);
    this.grid(B.tieup, TREADLES, SHAFTS);
    this.grid(B.drawdown, ends, MAX_REPEAT);
    this.grid(B.treadling, TREADLES, MAX_REPEAT);
    this.grid(B.weft, 1, MAX_REPEAT);

    // Colour orders.
    for (let j = 0; j < ends; j++) this.swatch(B.warp.x + j * c, B.warp.y, d.warp[j], 1);
    for (let r = 0; r < MAX_REPEAT; r++) this.swatch(B.weft.x, B.weft.y + r * c, d.weft[r % L], r < L ? 1 : 0.35);

    // Threading and tie-up.
    for (let j = 0; j < ends; j++) this.ink(B.threading.x + j * c, B.threading.y + (SHAFTS - 1 - d.threading[j]) * c, 1, j);
    for (let t = 0; t < TREADLES; t++) {
      for (let s = 0; s < SHAFTS; s++) {
        if (d.tieup[t][s]) this.ink(B.tieup.x + t * c, B.tieup.y + (SHAFTS - 1 - s) * c, 1, t * 7 + s);
      }
    }

    // Treadling, and the drawdown it makes; past the repeat, both carry on faintly.
    for (let r = 0; r < MAX_REPEAT; r++) {
      const alpha = r < L ? 1 : 0.3;
      const t = d.treadling[r % L];
      this.ink(B.treadling.x + t * c, B.treadling.y + r * c, alpha, r * 31 + t);
      const m = liftMask(d.tieup, t);
      for (let j = 0; j < ends; j++) {
        const up = (m >> d.threading[j]) & 1;
        const x = B.drawdown.x + j * c;
        const y = B.drawdown.y + r * c;
        if (this.mode === 'colour') {
          const rgb = YARNS[up ? d.warp[j] : d.weft[r % L]].rgb;
          g.globalAlpha = alpha;
          g.fillStyle = hex(rgb);
          g.fillRect(x + 0.5, y + 0.5, c - 1, c - 1);
          g.globalAlpha = 1;
        } else if (up) this.ink(x, y, alpha, r * 977 + j);
      }
    }

    // The end of the repeat.
    g.strokeStyle = MADDER;
    g.lineWidth = 1.5;
    if (L < MAX_REPEAT) {
      const y = B.drawdown.y + L * c;
      g.beginPath();
      g.moveTo(B.drawdown.x - 4, y);
      g.lineTo(B.drawdown.x + B.drawdown.w, y);
      g.moveTo(B.treadling.x, y);
      g.lineTo(B.weft.x + B.weft.w + 4, y);
      g.stroke();
    }

    // The arrow at the next pick.
    const ay = B.treadling.y + row * c + c / 2;
    const ax = B.weft.x + B.weft.w + 3;
    g.fillStyle = MADDER;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(ax + 7, ay - 4.5);
    g.lineTo(ax + 7, ay + 4.5);
    g.closePath();
    g.fill();

    if (this.pressed !== null) {
      g.strokeStyle = MADDER;
      g.lineWidth = 1.5;
      g.strokeRect(B.tieup.x + this.pressed * c + 0.75, B.tieup.y + 0.75, c - 1.5, B.tieup.h - 1.5);
    }
  }

  private grid(b: Box, cols: number, rows: number) {
    const g = this.g;
    const c = this.c;
    g.lineWidth = 1;
    for (let k = 0; k <= cols; k++) {
      g.strokeStyle = k % 8 === 0 || k === cols ? GRID_CM : GRID;
      const x = Math.round(b.x + k * c) + 0.5;
      g.beginPath();
      g.moveTo(x, b.y);
      g.lineTo(x, b.y + rows * c);
      g.stroke();
    }
    for (let k = 0; k <= rows; k++) {
      g.strokeStyle = k % 8 === 0 || k === rows ? GRID_CM : GRID;
      const y = Math.round(b.y + k * c) + 0.5;
      g.beginPath();
      g.moveTo(b.x, y);
      g.lineTo(b.x + cols * c, y);
      g.stroke();
    }
  }

  /** A square filled in by hand: never quite the same twice. */
  private ink(x: number, y: number, alpha: number, seed: number) {
    const g = this.g;
    const c = this.c;
    const inset = c >= 7 ? 1.5 : 1;
    const jx = (hash(seed, 1) - 0.5) * 0.5;
    const jy = (hash(seed, 2) - 0.5) * 0.5;
    g.globalAlpha = alpha * (0.84 + hash(seed, 3) * 0.14);
    g.fillStyle = INK;
    g.fillRect(Math.round(x) + inset + jx, Math.round(y) + inset + jy, c - inset * 2 + 0.5, c - inset * 2 + 0.5);
    g.globalAlpha = 1;
  }

  private swatch(x: number, y: number, yarn: number, alpha: number) {
    const g = this.g;
    const c = this.c;
    g.globalAlpha = alpha;
    g.fillStyle = hex(YARNS[yarn].rgb);
    g.fillRect(Math.round(x) + 1, Math.round(y) + 1, c - 1, c - 1);
    g.globalAlpha = 1;
  }

  private hit(e: PointerEvent): { region: Region; col: number; row: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = this.c;
    for (const region of ['warp', 'threading', 'tieup', 'treadling', 'weft'] as Region[]) {
      const b = this.boxes[region];
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
        return { region, col: Math.floor((x - b.x) / c), row: Math.floor((y - b.y) / c) };
      }
    }
    return null;
  }

  /** Grow the repeat to include row r, carrying the pattern on. */
  private reach(r: number) {
    const d = this.draft;
    const L = d.treadling.length;
    if (r < L) return;
    for (let i = L; i <= r; i++) {
      d.treadling[i] = d.treadling[i % L];
      d.weft[i] = d.weft[i % L];
    }
  }

  private down(e: PointerEvent) {
    const h = this.hit(e);
    if (!h) return;
    e.preventDefault();
    const d = this.draft;
    if ((h.region === 'warp' || h.region === 'threading') && !this.hooks.warpFree()) {
      this.hooks.locked();
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    let value: number | boolean;
    if (h.region === 'tieup') value = !d.tieup[h.col][SHAFTS - 1 - h.row];
    else if (h.region === 'threading') value = SHAFTS - 1 - h.row;
    else if (h.region === 'treadling') value = h.col;
    else value = this.hooks.yarn();
    this.drag = { region: h.region, value, last: h.region === 'warp' || h.region === 'threading' ? h.col : h.row };
    this.apply(h.region, h.col, h.row, value);
  }

  private move(e: PointerEvent) {
    if (!this.drag) return;
    const h = this.hit(e);
    if (!h || h.region !== this.drag.region) return;
    const { region, last } = this.drag;
    // Threading follows the pointer's row, so a drag draws the line it crosses.
    let value = this.drag.value;
    if (region === 'threading') value = SHAFTS - 1 - h.row;
    if (region === 'treadling') value = h.col;
    const along = region === 'warp' || region === 'threading' ? h.col : h.row;
    const step = along > last ? 1 : -1;
    for (let k = last; k !== along + step; k += step) {
      if (region === 'warp' || region === 'threading') this.apply(region, k, h.row, value);
      else if (region === 'tieup') this.apply(region, h.col, h.row, value);
      else this.apply(region, h.col, k, value);
    }
    this.drag.last = along;
  }

  private apply(region: Region, col: number, row: number, value: number | boolean) {
    const d = this.draft;
    if (region === 'warp') d.warp[col] = value as number;
    else if (region === 'threading') d.threading[col] = Math.max(0, Math.min(SHAFTS - 1, value as number));
    else if (region === 'tieup') d.tieup[col][SHAFTS - 1 - row] = value as boolean;
    else if (region === 'treadling') {
      this.reach(row);
      d.treadling[row] = value as number;
    } else {
      this.reach(row);
      d.weft[row] = value as number;
    }
    this.hooks.changed(region);
    this.draw();
  }
}

/** A pattern-book swatch: the drawdown in colour, a few repeats square. */
export function paintSwatch(canvas: HTMLCanvasElement, d: Draft) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const css = 72;
  canvas.width = css * dpr;
  canvas.height = css * dpr;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  const n = 24;
  const c = css / n;
  const L = d.treadling.length;
  for (let r = 0; r < n; r++) {
    const m = liftMask(d.tieup, d.treadling[r % L]);
    for (let j = 0; j < n; j++) {
      const up = (m >> d.threading[j]) & 1;
      g.fillStyle = hex(YARNS[up ? d.warp[j] : d.weft[r % L]].rgb);
      g.fillRect(j * c, r * c, c + 0.02, c + 0.02);
    }
  }
}
