// Draws one sheet on a canvas. All cells are the same size, so a position is a multiplication and a whole block
// of live cells is one small image scaled up with no smoothing. Figures appear once a cell is big enough to hold them.

import { COLS, ROWS, columnName, colOf, index, rowOf } from './_formula';
import { GREEN, INK, LUT, PAPER } from './_palette';
import { areaHas, shortNumber, type Area, type Block, type Merge, type Sheet } from './_sheet';

const RULE_MINOR = 'rgba(44,106,79,0.13)';
const RULE_MAJOR = 'rgba(44,106,79,0.27)';
const HEADER_PAPER = '#dbe5ce';
const SELECT = '#27488c';
const PRECEDENTS = ['#b5291f', '#b26a00', '#6a3fa0', '#0c7c6c', '#a31f7a', '#27488c'];

export interface Selection extends Area {
  /** The cell the formula bar shows. */
  r: number;
  c: number;
}

interface BlockImage {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  pixels: Uint32Array;
  block: Block;
}

export class Grid {
  private readonly ctx: CanvasRenderingContext2D;
  private images: BlockImage[] = [];
  private wrapped = new Map<Merge, { size: number; text: string; lines: string[] }>();
  dpr = 1;
  width = 1;
  height = 1;
  /** Device pixels a cell measures now. */
  cell = 8;
  /** Scroll position in device pixels. */
  sx = 0;
  sy = 0;
  sheet: Sheet | null = null;
  selection: Selection = { r: 0, c: 0, r1: 0, c1: 0, r2: 0, c2: 0 };
  precedents: Area[] = [];
  /** Cells on a loop, shown with a small mark. */
  private rowHead = 34;
  private colHead = 18;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly faces: { label: string; typed: string },
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('No 2D canvas');
    this.ctx = ctx;
  }

  get headW() {
    return Math.round(this.rowHead * this.dpr);
  }

  get headH() {
    return Math.round(this.colHead * this.dpr);
  }

  /** Text and rules scale by this against the sheet's own design size. */
  get scale() {
    return this.cell / (this.sheetUnit * this.dpr);
  }

  private get sheetUnit() {
    return this.sheet?.unit ?? 8;
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.dpr = dpr;
    this.width = Math.max(1, Math.round(cssW * dpr));
    this.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.clampScroll();
  }

  show(sheet: Sheet) {
    this.sheet = sheet;
    this.images = sheet.blocks.map((block) => {
      const canvas = document.createElement('canvas');
      canvas.width = block.c2 - block.c1 + 1;
      canvas.height = block.r2 - block.r1 + 1;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      const image = ctx.createImageData(canvas.width, canvas.height);
      return { canvas, ctx, image, pixels: new Uint32Array(image.data.buffer), block };
    });
    this.wrapped.clear();
    this.fit();
  }

  /** Opens the view on the sheet's frame at the sheet's own 100%. */
  fit() {
    this.cell = Math.max(2, Math.round(this.sheetUnit * this.dpr));
    this.sx = 0;
    this.sy = 0;
    this.clampScroll();
  }

  /** Sets the cell size and scroll position directly. */
  place(cell: number, sx: number, sy: number) {
    this.cell = Math.max(2, cell);
    this.sx = sx;
    this.sy = sy;
    this.clampScroll();
  }

  zoomPercent() {
    return Math.round(this.scale * 100);
  }

  /** Changes the cell size, keeping the point under (x, y) still. Sizes are whole device pixels. */
  zoomAt(nextCell: number, x: number, y: number) {
    const cell = Math.max(Math.round(2 * this.dpr), Math.min(Math.round(90 * this.dpr), Math.round(nextCell)));
    if (cell === this.cell) return;
    const px = x * this.dpr - this.headW;
    const py = y * this.dpr - this.headH;
    const cx = (px + this.sx) / this.cell;
    const cy = (py + this.sy) / this.cell;
    this.cell = cell;
    this.sx = cx * cell - px;
    this.sy = cy * cell - py;
    this.clampScroll();
  }

  zoomBy(steps: number, x: number, y: number) {
    const ratio = 1.16 ** steps;
    const next = this.cell * ratio;
    this.zoomAt(steps > 0 ? Math.max(next, this.cell + 1) : Math.min(next, this.cell - 1), x, y);
  }

  panBy(dx: number, dy: number) {
    this.sx += dx * this.dpr;
    this.sy += dy * this.dpr;
    this.clampScroll();
  }

  private clampScroll() {
    const w = this.width - this.headW;
    const h = this.height - this.headH;
    this.sx = Math.max(0, Math.min(COLS * this.cell - w, this.sx));
    this.sy = Math.max(0, Math.min(ROWS * this.cell - h, this.sy));
  }

  /** The cell under a point in CSS pixels, or null over the headers. */
  hit(x: number, y: number): { r: number; c: number } | null {
    const px = x * this.dpr - this.headW;
    const py = y * this.dpr - this.headH;
    if (px < 0 || py < 0) return null;
    const c = Math.floor((px + this.sx) / this.cell);
    const r = Math.floor((py + this.sy) / this.cell);
    return r < ROWS && c < COLS ? { r, c } : null;
  }

  /** Scrolls so a cell is on screen. */
  reveal(r: number, c: number) {
    const w = this.width - this.headW;
    const h = this.height - this.headH;
    const x = c * this.cell;
    const y = r * this.cell;
    if (x < this.sx) this.sx = x;
    else if (x + this.cell > this.sx + w) this.sx = x + this.cell - w;
    if (y < this.sy) this.sy = y;
    else if (y + this.cell > this.sy + h) this.sy = y + this.cell - h;
    this.clampScroll();
  }

  private font(size: number, weight: number, family: 'label' | 'typed') {
    return `${weight} ${size}px ${this.faces[family]}`;
  }

  draw() {
    const { ctx, sheet, cell, width, height, headW, headH } = this;
    if (!sheet) return;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(headW, headH, width - headW, height - headH);
    ctx.clip();
    ctx.translate(headW - this.sx, headH - this.sy);

    const c1 = Math.floor(this.sx / cell);
    const r1 = Math.floor(this.sy / cell);
    const c2 = Math.min(COLS - 1, Math.floor((this.sx + width - headW) / cell));
    const r2 = Math.min(ROWS - 1, Math.floor((this.sy + height - headH) / cell));

    this.drawBlocks();
    this.drawRules(c1, r1, c2, r2);
    this.drawBand();
    this.drawFrames();
    this.drawMerges(c1, r1, c2, r2);
    this.drawLoose(c1, r1, c2, r2);
    this.drawFigures(c1, r1, c2, r2);
    this.drawSelection();
    ctx.restore();

    this.drawHeaders(c1, r1, c2, r2);
  }

  private drawBlocks() {
    const { ctx, cell, sheet } = this;
    if (!sheet) return;
    const { values } = sheet;
    ctx.imageSmoothingEnabled = false;
    for (const im of this.images) {
      const { block, pixels } = im;
      const lut = block.palette;
      const k = (LUT - 1) / (block.max - block.min);
      const w = block.c2 - block.c1 + 1;
      let p = 0;
      for (let r = block.r1; r <= block.r2; r++) {
        let at = index(r, block.c1);
        for (let c = 0; c < w; c++) {
          const v = (values[at++] - block.min) * k;
          pixels[p++] = lut[v > 0 ? (v < LUT - 1 ? v | 0 : LUT - 1) : 0];
        }
      }
      im.ctx.putImageData(im.image, 0, 0);
      ctx.drawImage(
        im.canvas,
        block.c1 * cell,
        block.r1 * cell,
        (block.c2 - block.c1 + 1) * cell,
        (block.r2 - block.r1 + 1) * cell,
      );
    }
  }

  private drawRules(c1: number, r1: number, c2: number, r2: number) {
    const { ctx, cell, dpr } = this;
    if (cell < 4 * dpr) return;
    const x0 = c1 * cell;
    const y0 = r1 * cell;
    const w = (c2 - c1 + 1) * cell;
    const h = (r2 - r1 + 1) * cell;
    const thin = Math.max(1, Math.round(dpr * 0.5));
    ctx.fillStyle = RULE_MINOR;
    for (let c = c1; c <= c2 + 1; c++) {
      if (c % 5) ctx.fillRect(c * cell, y0, thin, h);
    }
    for (let r = r1; r <= r2 + 1; r++) {
      if (r % 5) ctx.fillRect(x0, r * cell, w, thin);
    }
    ctx.fillStyle = RULE_MAJOR;
    for (let c = c1 - c1 % 5; c <= c2 + 1; c += 5) ctx.fillRect(c * cell, y0, thin, h);
    for (let r = r1 - r1 % 5; r <= r2 + 1; r += 5) ctx.fillRect(x0, r * cell, w, thin);
  }

  private drawFrames() {
    const { ctx, cell, sheet, dpr } = this;
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, Math.round(1.25 * dpr));
    for (const b of sheet?.blocks ?? []) {
      if (!b.frame) continue;
      ctx.strokeRect(b.c1 * cell, b.r1 * cell, (b.c2 - b.c1 + 1) * cell, (b.r2 - b.r1 + 1) * cell);
    }
  }

  private drawBand() {
    const { ctx, cell, sheet, dpr } = this;
    if (!sheet?.band) return;
    const h = sheet.band * cell;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, COLS * cell, h);
    ctx.fillStyle = GREEN;
    ctx.fillRect(0, h - Math.round(2 * dpr), COLS * cell, Math.round(1.25 * dpr));
    ctx.fillRect(0, h, COLS * cell, Math.max(1, Math.round(0.5 * dpr)));
  }

  private wrap(m: Merge, text: string, width: number, size: number) {
    const known = this.wrapped.get(m);
    if (known && known.size === size && known.text === text) return known.lines;
    const { ctx } = this;
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const trial = line ? `${line} ${word}` : word;
      if (ctx.measureText(trial).width > width && line) {
        lines.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    if (line) lines.push(line);
    this.wrapped.set(m, { size, text, lines });
    return lines;
  }

  private drawMerges(c1: number, r1: number, c2: number, r2: number) {
    const { ctx, cell, sheet, dpr } = this;
    if (!sheet) return;
    const scale = this.scale;
    ctx.textBaseline = 'middle';
    for (const m of sheet.merges) {
      if (m.c2 < c1 || m.c1 > c2 || m.r2 < r1 || m.r1 > r2) continue;
      const x = m.c1 * cell;
      const y = m.r1 * cell;
      const w = (m.c2 - m.c1 + 1) * cell;
      const h = (m.r2 - m.r1 + 1) * cell;
      if (m.box) {
        ctx.fillStyle = '#f7f9f0';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(44,106,79,0.6)';
        ctx.lineWidth = Math.max(1, Math.round(dpr * 0.75));
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
      if (m.readout) {
        ctx.fillStyle = 'rgba(44,106,79,0.45)';
        ctx.fillRect(x, y + h - 1, w, Math.max(1, Math.round(dpr * 0.5)));
      }
      const at = index(m.r1, m.c1);
      const size = m.size * scale * dpr;
      if (size < 3) continue;
      ctx.font = this.font(size, m.weight, m.family);
      ctx.fillStyle = m.color;
      const pad = (m.box ? 6 : 1) * scale * dpr;
      const stored = sheet.texts.get(at);
      const text = stored ?? this.figure(at, m);
      if (m.wrap) {
        ctx.textAlign = 'left';
        const lines = this.wrap(m, text, w - pad * 2, size);
        const lead = size * 1.42;
        lines.forEach((line, i) => ctx.fillText(line, x + pad, y + lead * (i + 0.5)));
        continue;
      }
      ctx.textAlign = m.align;
      const tx = m.align === 'left' ? x + pad : m.align === 'right' ? x + w - pad : x + w / 2;
      ctx.fillText(text, tx, y + h / 2 + size * 0.04);
      if (m.action) {
        const tw = ctx.measureText(text).width;
        ctx.fillRect(tx, y + h / 2 + size * 0.62, tw, Math.max(1, Math.round(dpr * 0.75)));
      }
    }
    ctx.textAlign = 'left';
  }

  private figure(at: number, m: Merge) {
    const sheet = this.sheet as Sheet;
    const v = sheet.values[at];
    if (m.show) return m.show(v);
    if (!sheet.formulas.has(at) && !sheet.constants.has(at)) return '';
    return shortNumber(v, m.places);
  }

  private drawLoose(c1: number, r1: number, c2: number, r2: number) {
    const { ctx, cell, sheet, dpr } = this;
    if (!sheet) return;
    const size = Math.min(cell * 0.72, 13 * this.scale * dpr);
    if (size < 4) return;
    ctx.font = this.font(size, 400, 'typed');
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    for (const at of sheet.loose) {
      if (sheet.mergeAt.has(at)) continue;
      const r = rowOf(at);
      const c = colOf(at);
      if (r < r1 || r > r2 || c < c1 || c > c2) continue;
      const text = sheet.texts.get(at) ?? shortNumber(sheet.values[at]);
      ctx.fillText(text, c * cell + 2 * dpr, r * cell + cell / 2);
    }
  }

  /** The numbers themselves, once a cell can hold them. This is the sheet's real content. */
  private drawFigures(c1: number, r1: number, c2: number, r2: number) {
    const { ctx, cell, sheet, dpr } = this;
    if (!sheet || cell < 26 * dpr) return;
    const size = Math.min(cell * 0.34, 15 * dpr);
    ctx.font = this.font(size, 400, 'typed');
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const b of sheet.blocks) {
      const lo = Math.max(c1, b.c1);
      const hi = Math.min(c2, b.c2);
      const top = Math.max(r1, b.r1);
      const bottom = Math.min(r2, b.r2);
      const k = (LUT - 1) / (b.max - b.min);
      for (let r = top; r <= bottom; r++) {
        for (let c = lo; c <= hi; c++) {
          const v = sheet.values[index(r, c)];
          const entry = b.palette[Math.max(0, Math.min(LUT - 1, ((v - b.min) * k) | 0))];
          const alpha = (entry >>> 24) / 255;
          const luma = 0.3 * (entry & 255) + 0.59 * ((entry >> 8) & 255) + 0.11 * ((entry >> 16) & 255);
          ctx.fillStyle = luma * alpha + 232 * (1 - alpha) < 118 ? '#f4f7ea' : INK;
          ctx.fillText(shortNumber(v, b.places), (c + 1) * cell - 3 * dpr, r * cell + cell / 2);
        }
      }
    }
    ctx.textAlign = 'left';
  }

  private drawSelection() {
    const { ctx, cell, sheet, selection: s, dpr } = this;
    if (!sheet) return;
    this.precedents.forEach((a, i) => {
      ctx.strokeStyle = PRECEDENTS[i % PRECEDENTS.length];
      ctx.lineWidth = Math.max(1, Math.round(1.25 * dpr));
      ctx.setLineDash([Math.round(4 * dpr), Math.round(3 * dpr)]);
      ctx.strokeRect(a.c1 * cell, a.r1 * cell, (a.c2 - a.c1 + 1) * cell, (a.r2 - a.r1 + 1) * cell);
    });
    ctx.setLineDash([]);
    const merge = sheet.mergeAt.get(index(s.r, s.c));
    const area: Area = merge && s.r1 === s.r2 && s.c1 === s.c2 ? merge : s;
    const x = area.c1 * cell;
    const y = area.r1 * cell;
    const w = (area.c2 - area.c1 + 1) * cell;
    const h = (area.r2 - area.r1 + 1) * cell;
    if (area.c2 > area.c1 || area.r2 > area.r1) {
      if (!merge) {
        ctx.fillStyle = 'rgba(39,72,140,0.09)';
        ctx.fillRect(x, y, w, h);
      }
    }
    const inner = Math.max(1, Math.round(2 * dpr));
    ctx.strokeStyle = '#f7f9f0';
    ctx.lineWidth = inner + Math.round(2 * dpr);
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = inner;
    ctx.strokeRect(x, y, w, h);
  }

  private drawHeaders(c1: number, r1: number, c2: number, r2: number) {
    const { ctx, cell, width, height, headW, headH, dpr, selection: s } = this;
    ctx.fillStyle = HEADER_PAPER;
    ctx.fillRect(0, 0, width, headH);
    ctx.fillRect(0, 0, headW, height);
    ctx.fillStyle = 'rgba(44,106,79,0.55)';
    ctx.fillRect(0, headH - 1, width, 1);
    ctx.fillRect(headW - 1, 0, 1, height);

    const size = Math.round(9.5 * dpr);
    ctx.font = this.font(size, 600, 'label');
    ctx.textBaseline = 'middle';
    const everyC = cell >= 22 * dpr ? 1 : cell >= 11 * dpr ? 2 : 5;
    const everyR = cell >= 12 * dpr ? 1 : cell >= 6 * dpr ? 5 : 10;

    ctx.save();
    ctx.beginPath();
    ctx.rect(headW, 0, width - headW, headH);
    ctx.clip();
    ctx.textAlign = 'center';
    const xAt = (c: number) => headW + c * cell - this.sx;
    const yAt = (r: number) => headH + r * cell - this.sy;
    if (s.c2 >= c1 && s.c1 <= c2) {
      ctx.fillStyle = 'rgba(39,72,140,0.22)';
      ctx.fillRect(xAt(s.c1), 0, (s.c2 - s.c1 + 1) * cell, headH);
    }
    for (let c = c1 - c1 % everyC; c <= c2; c += everyC) {
      const mark = c % 5 === 0;
      ctx.fillStyle = 'rgba(44,106,79,0.6)';
      ctx.fillRect(xAt(c), headH - Math.round((mark ? 5 : 3) * dpr), 1, Math.round((mark ? 5 : 3) * dpr));
      if (everyC > 1 && !mark) continue;
      ctx.fillStyle = GREEN;
      if (everyC === 5 && c % 10) continue;
      ctx.fillText(columnName(c), xAt(c) + cell / 2, headH / 2 - dpr);
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, headH, headW, height - headH);
    ctx.clip();
    ctx.textAlign = 'right';
    if (s.r2 >= r1 && s.r1 <= r2) {
      ctx.fillStyle = 'rgba(39,72,140,0.22)';
      ctx.fillRect(0, yAt(s.r1), headW, (s.r2 - s.r1 + 1) * cell);
    }
    ctx.fillStyle = GREEN;
    for (let r = r1 - r1 % everyR; r <= r2; r += everyR) {
      if (everyR === 1 || r % 10 === 0 || everyR === 5) {
        ctx.fillText(String(r + 1), headW - 5 * dpr, yAt(r) + cell / 2);
      }
    }
    ctx.restore();
  }

  blockAtSelection(): Block | undefined {
    const { sheet, selection: s } = this;
    return sheet?.blockAt(s.r, s.c);
  }

  inSelection(r: number, c: number) {
    return areaHas(this.selection, r, c);
  }
}
