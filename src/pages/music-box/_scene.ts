// Draws the bench from above: a walnut table, the paper strip, the brass
// frame with its steel comb and star wheels, and the crank.

import { COMB, ROWS, midiOfRow, noteName, type Strip } from './_tunes';
import { midiToHz } from './_sound';

/** Blank paper before the first column and after the last. */
export const LEAD = 4;
export const TAIL = 3;

export interface Layout {
  w: number;
  h: number;
  dpr: number;
  phone: boolean;
  rowH: number;
  colW: number;
  stripTop: number;
  stripH: number;
  gridTop: number;
  /** x of the playing line: where a hole meets its star wheel. */
  play: number;
  tipX: number;
  combLeft: number;
  frameLeft: number;
  frameRight: number;
  frameTop: number;
  frameBottom: number;
  crank: { x: number; y: number; r: number };
  font: string;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function layout(w: number, h: number, dpr: number, font: string): Layout {
  const phone = w < 700;
  const rowH = phone ? clamp((h * 0.4) / 32, 8.5, 12) : clamp((h * 0.52) / 32, 10, 15.5);
  const margin = rowH * 1.3;
  const stripH = ROWS * rowH + margin * 2;
  const colW = rowH * 1.3;
  const stripTop = phone ? clamp(h * 0.17, 118, 190) : clamp((h - stripH) / 2 - h * 0.05, 128, 400);
  const gridTop = stripTop + margin;
  const play = Math.round(w * (phone ? 0.43 : 0.36));
  const tipX = play - rowH * 0.62;
  const longest = rowH * (phone ? 8.4 : 10);
  const heel = rowH * 2.3;
  const combLeft = tipX - longest - heel;
  const frameLeft = combLeft - rowH * 0.9;
  const frameRight = play + rowH * 1.5;
  const frameTop = stripTop - rowH * 1.1;
  const frameBottom = stripTop + stripH + rowH * 1.1;
  const r = phone ? 50 : clamp(rowH * 3.4, 40, 54);
  const crank = {
    x: phone ? Math.max(combLeft + r * 0.4, 20 + r) : combLeft + (tipX - combLeft) * 0.42,
    y: frameBottom + r + (phone ? 34 : 24),
    r,
  };
  return {
    w,
    h,
    dpr,
    phone,
    rowH,
    colW,
    stripTop,
    stripH,
    gridTop,
    play,
    tipX,
    combLeft,
    frameLeft,
    frameRight,
    frameTop,
    frameBottom,
    crank,
    font,
  };
}

export const rowY = (L: Layout, row: number) => L.gridTop + (row + 0.5) * L.rowH;
export const colX = (L: Layout, col: number, s: number) => L.play + (col - s) * L.colW;

/** How far back each tooth's slot is cut: pitch falls with the square of a cantilever's length. */
export const toothLength = (L: Layout, row: number) => {
  const longest = L.tipX - L.combLeft - L.rowH * 2.3;
  return longest * Math.sqrt(midiToHz(COMB[0]) / midiToHz(midiOfRow(row)));
};

// Smooth value noise for the wood.
const hash = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
const smooth = (t: number) => t * t * (3 - 2 * t);
const noise = (x: number, y: number) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
};

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** The walnut tabletop, lit by a lamp at the upper left. */
export function paintTable(L: Layout): HTMLCanvasElement {
  // Grain is soft, so half resolution is plenty.
  const scale = Math.min(1, L.dpr) * 0.75;
  const W = Math.ceil(L.w * scale);
  const H = Math.ceil(L.h * scale);
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const yy = y / scale;
    for (let x = 0; x < W; x++) {
      const xx = x / scale;
      // Long grain running with the strip, warped by slow noise, with darker figure lines.
      const warp = noise(xx * 0.0025, yy * 0.012) * 26 + noise(xx * 0.01, yy * 0.05) * 4;
      const g = Math.sin((yy + warp) * 0.42) * 0.5 + 0.5;
      const fine = noise(xx * 0.08, yy * 0.9);
      const figure = Math.pow(g, 6) * 0.55 + fine * 0.18 + noise(xx * 0.004, yy * 0.004) * 0.25;
      const i = (y * W + x) * 4;
      d[i] = 70 - figure * 34;
      d[i + 1] = 44 - figure * 22;
      d[i + 2] = 28 - figure * 14;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Lamp light and falloff.
  const lamp = ctx.createRadialGradient(W * 0.36, H * 0.32, 0, W * 0.36, H * 0.32, Math.hypot(W, H) * 0.72);
  lamp.addColorStop(0, 'rgba(255, 190, 120, 0.16)');
  lamp.addColorStop(0.45, 'rgba(255, 170, 100, 0.04)');
  lamp.addColorStop(1, 'rgba(0, 0, 0, 0.62)');
  ctx.fillStyle = lamp;
  ctx.fillRect(0, 0, W, H);
  return c;
}

/** Cream card with fibres; tiled under the moving strip. */
export function paintPaper(): HTMLCanvasElement {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#efe3c6';
  ctx.fillRect(0, 0, S, S);
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 900; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const len = 2 + rand() * 7;
    const a = rand() * Math.PI;
    ctx.strokeStyle = rand() < 0.5 ? `rgba(120, 90, 50, ${0.04 + rand() * 0.06})` : `rgba(255, 252, 240, ${0.15 + rand() * 0.2})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    // Wrap so the tile repeats without seams.
    ctx.moveTo(x - S, y);
    ctx.lineTo(x - S + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(110, 80, 40, ${rand() * 0.08})`;
    ctx.fillRect(rand() * S, rand() * S, 1, 1);
  }
  return c;
}

const INK = 'rgba(158, 58, 40, ';

function screw(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, turn: number) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, '#f2f0ea');
  g.addColorStop(0.6, '#9a9a96');
  g.addColorStop(1, '#4b4a46');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30, 24, 18, 0.85)';
  ctx.lineWidth = Math.max(1, r * 0.28);
  ctx.beginPath();
  ctx.moveTo(x - Math.cos(turn) * r * 0.8, y - Math.sin(turn) * r * 0.8);
  ctx.lineTo(x + Math.cos(turn) * r * 0.8, y + Math.sin(turn) * r * 0.8);
  ctx.stroke();
}

/** The static parts of the movement, at device resolution: frame, drum, comb, engraving, screws. */
export function paintMovement(L: Layout): HTMLCanvasElement {
  const c = makeCanvas(L.w * L.dpr, L.h * L.dpr);
  const ctx = c.getContext('2d')!;
  ctx.scale(L.dpr, L.dpr);
  const { rowH } = L;
  const fx = L.frameLeft;
  const fw = L.frameRight - L.frameLeft;
  const fy = L.frameTop;
  const fh = L.frameBottom - L.frameTop;

  // Brass frame, with a cast shadow onto the paper and table.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetX = 5;
  ctx.shadowOffsetY = 9;
  ctx.fillStyle = '#a07a38';
  ctx.beginPath();
  ctx.roundRect(fx, fy, fw, fh, rowH * 0.5);
  ctx.fill();
  ctx.restore();

  const brass = ctx.createLinearGradient(fx, fy, fx + fw * 0.6, fy + fh);
  brass.addColorStop(0, '#e8c983');
  brass.addColorStop(0.35, '#c79d52');
  brass.addColorStop(0.7, '#a77c37');
  brass.addColorStop(1, '#7d5a25');
  ctx.fillStyle = brass;
  ctx.beginPath();
  ctx.roundRect(fx, fy, fw, fh, rowH * 0.5);
  ctx.fill();
  // Brushed finish.
  ctx.save();
  ctx.clip();
  for (let y = fy; y < fy + fh; y += 1.5) {
    ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '255, 240, 200' : '60, 40, 10'}, ${0.03 + Math.random() * 0.04})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(fx, y);
    ctx.lineTo(fx + fw, y + (Math.random() - 0.5));
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255, 236, 190, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1, rowH * 0.5);
  ctx.stroke();

  // A window over the drum, where the paper shows as it rolls past the star wheels.
  const wx0 = L.tipX - 1;
  const wx1 = L.frameRight - rowH * 0.4;
  const wy0 = L.stripTop - 1;
  const wy1 = L.stripTop + L.stripH + 1;
  ctx.clearRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
  // The strip bends over the drum: shade it like a cylinder.
  const bend = ctx.createLinearGradient(wx0, 0, wx1, 0);
  bend.addColorStop(0, 'rgba(30, 18, 8, 0.55)');
  bend.addColorStop(0.3, 'rgba(30, 18, 8, 0.12)');
  bend.addColorStop(0.5, 'rgba(255, 250, 235, 0.12)');
  bend.addColorStop(0.75, 'rgba(30, 18, 8, 0.1)');
  bend.addColorStop(1, 'rgba(30, 18, 8, 0.5)');
  ctx.fillStyle = bend;
  ctx.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
  // The rail's inner edges.
  ctx.fillStyle = 'rgba(40, 25, 10, 0.5)';
  ctx.fillRect(wx0, wy0 - 1.5, wx1 - wx0, 1.5);
  ctx.fillStyle = 'rgba(255, 236, 190, 0.5)';
  ctx.fillRect(wx0, wy1, wx1 - wx0, 1);
  const wellTop = wy0;
  const wellBottom = wy1;

  // The comb: one steel plate, its teeth cut from the tip side to the depth each pitch needs.
  const cTop = L.gridTop - rowH * 0.15;
  const cBottom = L.gridTop + ROWS * rowH + rowH * 0.15;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#9ca1a4';
  ctx.fillRect(L.combLeft, cTop, L.tipX - L.combLeft, cBottom - cTop);
  ctx.restore();
  const steel = ctx.createLinearGradient(0, cTop, 0, cBottom);
  steel.addColorStop(0, '#e3e6e7');
  steel.addColorStop(0.18, '#b4b9bc');
  steel.addColorStop(0.5, '#d3d6d7');
  steel.addColorStop(0.8, '#92989b');
  steel.addColorStop(1, '#c4c8ca');
  ctx.fillStyle = steel;
  ctx.fillRect(L.combLeft, cTop, L.tipX - L.combLeft, cBottom - cTop);
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.combLeft, cTop, L.tipX - L.combLeft, cBottom - cTop);
  ctx.clip();
  for (let x = L.combLeft; x < L.tipX; x += 1.2) {
    ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '255, 255, 255' : '40, 44, 48'}, ${0.04 + Math.random() * 0.05})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, cTop);
    ctx.lineTo(x, cBottom);
    ctx.stroke();
  }
  ctx.restore();

  // Slots between teeth, each as deep as the longer of its neighbours.
  const slot = Math.max(1.1, rowH * 0.16);
  for (let b = 0; b <= ROWS; b++) {
    const y = L.gridTop + b * rowH;
    const depth = Math.max(b > 0 ? toothLength(L, b - 1) : 0, b < ROWS ? toothLength(L, b) : 0);
    const x0 = L.tipX - depth;
    const yy = b === 0 ? cTop : b === ROWS ? cBottom - slot : y - slot / 2;
    ctx.fillStyle = '#1d1712';
    ctx.fillRect(x0, yy, L.tipX - x0 + 1, slot);
    // Light catches the lower edge of each cut.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(x0, yy + slot, L.tipX - x0, 0.6);
    ctx.beginPath();
    ctx.arc(x0, yy + slot / 2, slot / 2, Math.PI / 2, Math.PI * 1.5);
    ctx.fillStyle = '#1d1712';
    ctx.fill();
  }
  // Tooth tips, slightly rounded and darker where the star wheels wear them.
  for (let r = 0; r < ROWS; r++) {
    const y = rowY(L, r);
    ctx.fillStyle = 'rgba(40, 40, 40, 0.35)';
    ctx.fillRect(L.tipX - rowH * 0.25, y - rowH * 0.32, rowH * 0.25, rowH * 0.64);
  }

  // Engraved pitch at the root of each tooth.
  const size = clamp(rowH * 0.62, 6.5, 9.5);
  ctx.font = `700 ${size}px ${L.font}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < ROWS; r++) {
    const x = L.tipX - toothLength(L, r) - rowH * 0.35;
    const y = rowY(L, r) + 0.5;
    const label = noteName(midiOfRow(r));
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillText(label, x + 0.5, y + 0.7);
    ctx.fillStyle = 'rgba(40, 36, 32, 0.82)';
    ctx.fillText(label, x, y);
  }

  // Screws: comb to frame, frame to case.
  const sr = clamp(rowH * 0.42, 4, 6.5);
  const hx = L.combLeft + rowH * 0.8;
  screw(ctx, hx, cTop + rowH * 2.2, sr, 0.6);
  screw(ctx, hx, cBottom - rowH * 2.2, sr, 2.1);
  screw(ctx, hx, (cTop + cBottom) / 2, sr, 1.2);
  const fy0 = fy + (wellTop - fy) / 2;
  const fy1 = wellBottom + (L.frameBottom - wellBottom) / 2;
  for (const [x, y, t] of [
    [fx + rowH * 0.9, fy0, 0.3],
    [L.frameRight - rowH * 0.8, fy0, 1.9],
    [fx + rowH * 0.9, fy1, 2.6],
    [L.frameRight - rowH * 0.8, fy1, 0.9],
  ] as const) {
    screw(ctx, x, y, sr, t);
  }

  // The drive shaft bearing, where the crank's shaft enters the frame.
  const by = L.frameBottom;
  const bx = L.crank.x;
  const bearing = ctx.createLinearGradient(bx - 9, 0, bx + 9, 0);
  bearing.addColorStop(0, '#6e5022');
  bearing.addColorStop(0.45, '#f0d28d');
  bearing.addColorStop(1, '#6e5022');
  ctx.fillStyle = bearing;
  ctx.beginPath();
  ctx.roundRect(bx - 9, by - 7, 18, 12, 3);
  ctx.fill();
  return c;
}

export interface Ring {
  /** performance.now() seconds when the tooth was picked. */
  start: number;
  tau: number;
}

export interface View {
  strip: Strip;
  s: number;
  crankAngle: number;
  hover: { col: number; row: number } | null;
  rings: Array<Ring | null>;
  now: number;
  showGuide: boolean;
  grabbing: boolean;
}

export function drawBench(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  table: HTMLCanvasElement,
  paper: CanvasPattern | null,
  movement: HTMLCanvasElement,
  v: View,
) {
  const { rowH, colW } = L;
  ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(table, 0, 0, L.w, L.h);

  // --- The paper strip ---
  const { strip, s } = v;
  const x0 = Math.max(-20, colX(L, -LEAD, s) - colW * 0.5);
  const x1 = Math.min(L.w + 20, colX(L, strip.length + TAIL, s) - colW * 0.5);
  const top = L.stripTop;
  const bottom = L.stripTop + L.stripH;
  if (x1 > x0) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#efe3c6';
    ctx.fillRect(x0, top, x1 - x0, L.stripH);
    ctx.restore();
    if (paper) {
      paper.setTransform(new DOMMatrix().translate(-s * colW, 0));
      ctx.fillStyle = paper;
      ctx.fillRect(x0, top, x1 - x0, L.stripH);
    }
    // Paper darkens a touch where it has run under the comb.
    const played = Math.min(x1, L.frameLeft);
    if (played > x0) {
      ctx.fillStyle = 'rgba(90, 60, 30, 0.05)';
      ctx.fillRect(x0, top, played - x0, L.stripH);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, top, x1 - x0, L.stripH);
    ctx.clip();

    const cFirst = Math.max(-LEAD, Math.floor(s - L.play / colW) - 1);
    const cLast = Math.min(strip.length + TAIL, Math.ceil(s + (L.w - L.play) / colW) + 1);
    const gx0 = Math.max(x0, colX(L, 0, s));
    const gx1 = Math.min(x1, colX(L, strip.length - 1, s));
    const gTop = rowY(L, 0);
    const gBottom = rowY(L, ROWS - 1);

    // Note lines: printed where the holes go, with the Cs a little stronger.
    if (gx1 > gx0) {
      for (let r = 0; r < ROWS; r++) {
        const y = Math.round(rowY(L, r)) + 0.5;
        const isC = midiOfRow(r) % 12 === 0;
        ctx.strokeStyle = INK + (isC ? '0.55)' : '0.26)');
        ctx.lineWidth = isC ? 1 : 0.8;
        ctx.beginPath();
        ctx.moveTo(gx0, y);
        ctx.lineTo(gx1, y);
        ctx.stroke();
      }
    }
    // Beat lines solid, half beats dotted, bars heavier with their numbers.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${clamp(rowH * 0.7, 7, 10.5)}px ${L.font}`;
    for (let c = Math.max(0, cFirst); c <= Math.min(strip.length - 1, cLast); c++) {
      const x = Math.round(colX(L, c, s)) + 0.5;
      const bar = c % strip.bar === 0;
      if (bar || c % 2 === 0) {
        ctx.setLineDash([]);
        ctx.strokeStyle = INK + (bar ? '0.62)' : '0.34)');
        ctx.lineWidth = bar ? 1.1 : 0.8;
      } else {
        ctx.setLineDash([1.5, 2.5]);
        ctx.strokeStyle = INK + '0.3)';
        ctx.lineWidth = 0.8;
      }
      ctx.beginPath();
      ctx.moveTo(x, gTop);
      ctx.lineTo(x, gBottom);
      ctx.stroke();
      if (bar) {
        ctx.fillStyle = INK + '0.75)';
        ctx.fillText(String(c / strip.bar + 1), x, top + rowH * 0.65);
      }
    }
    ctx.setLineDash([]);

    // Leader: the note names and the feed arrow, printed as on a bought strip.
    const lx = colX(L, -0.7, s);
    if (lx > -40 && lx < L.w + 40) {
      ctx.textAlign = 'right';
      ctx.font = `700 ${clamp(rowH * 0.6, 6.5, 9.5)}px ${L.font}`;
      ctx.fillStyle = INK + '0.8)';
      for (let r = 0; r < ROWS; r++) ctx.fillText(noteName(midiOfRow(r)), lx, rowY(L, r) + 0.5);
      const ax = colX(L, -LEAD + 0.6, s);
      const ay = top + rowH * 0.65;
      ctx.strokeStyle = INK + '0.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(ax + colW * 1.6, ay);
      ctx.lineTo(ax, ay);
      ctx.lineTo(ax + 4, ay - 3);
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + 4, ay + 3);
      ctx.stroke();
    }
    // End mark.
    const ex = colX(L, strip.length + 0.4, s);
    if (ex > -20 && ex < L.w + 20) {
      ctx.strokeStyle = INK + '0.7)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(ex, gTop);
      ctx.lineTo(ex, gBottom);
      ctx.moveTo(ex + 3, gTop);
      ctx.lineTo(ex + 3, gBottom);
      ctx.stroke();
    }

    // Glue seams where paper was added.
    for (const seam of strip.seams) {
      const sx = colX(L, seam - 0.5, s);
      if (sx < -colW || sx > L.w + colW) continue;
      ctx.fillStyle = 'rgba(150, 110, 50, 0.13)';
      ctx.fillRect(sx - colW * 0.35, top, colW * 0.7, L.stripH);
      ctx.strokeStyle = 'rgba(110, 80, 40, 0.4)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(sx + colW * 0.35, top);
      ctx.lineTo(sx + colW * 0.35, bottom);
      ctx.stroke();
    }

    // Holes, and tape over the ones taken back.
    const hr = Math.min(rowH, colW) * 0.34;
    for (let c = Math.max(0, cFirst); c <= Math.min(strip.length - 1, cLast); c++) {
      const x = colX(L, c, s);
      for (let r = 0; r < ROWS; r++) {
        const state = strip.cells[c * ROWS + r];
        if (!state) continue;
        const y = rowY(L, r);
        ctx.fillStyle = '#21150d';
        ctx.beginPath();
        ctx.arc(x, y, hr, 0, Math.PI * 2);
        ctx.fill();
        // The cut edge: shadowed on the lamp side, lit on the far side.
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = 'rgba(255, 250, 235, 0.75)';
        ctx.beginPath();
        ctx.arc(x, y, hr, -0.2, Math.PI * 0.75);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(90, 60, 30, 0.45)';
        ctx.beginPath();
        ctx.arc(x, y, hr + 0.4, Math.PI * 0.9, Math.PI * 1.8);
        ctx.stroke();
        if (state === 2) {
          const tilt = (hash(c, r) - 0.5) * 0.35;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(tilt);
          const tw = colW * 1.05;
          const th = rowH * 1.25;
          ctx.fillStyle = 'rgba(232, 220, 175, 0.86)';
          ctx.fillRect(-tw / 2, -th / 2, tw, th);
          ctx.strokeStyle = 'rgba(160, 140, 90, 0.45)';
          ctx.lineWidth = 0.7;
          ctx.strokeRect(-tw / 2, -th / 2, tw, th);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
          ctx.fillRect(-tw / 2, -th / 2, tw, th * 0.3);
          ctx.restore();
        }
      }
    }

    // Where the next hole would go.
    if (v.hover) {
      const x = colX(L, v.hover.col, s);
      const y = rowY(L, v.hover.row);
      ctx.strokeStyle = 'rgba(40, 25, 15, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(x, y, hr + 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // Paper edges.
    ctx.strokeStyle = 'rgba(255, 252, 240, 0.6)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x0, top + 0.5);
    ctx.lineTo(x1, top + 0.5);
    ctx.stroke();
  }

  // --- The movement ---
  ctx.drawImage(movement, 0, 0, L.w, L.h);

  // Star wheels, one per tooth, turned by the paper.
  const wr = rowH * 0.42;
  const spin = (s * colW) / wr;
  for (let r = 0; r < ROWS; r++) {
    const cx = L.play;
    const cy = rowY(L, r);
    ctx.save();
    ctx.translate(cx, cy);
    // Seen from above, a wheel standing on edge: a thin brass blade whose points pass by.
    ctx.fillStyle = '#7b5b26';
    ctx.fillRect(-wr, -rowH * 0.12, wr * 2, rowH * 0.24);
    for (let k = 0; k < 6; k++) {
      const a = spin + (k * Math.PI) / 3;
      const px = Math.cos(a) * wr;
      if (Math.sin(a) < 0) continue;
      ctx.fillStyle = `rgba(245, 214, 140, ${0.35 + 0.65 * Math.sin(a)})`;
      ctx.fillRect(px - 0.9, -rowH * 0.17, 1.8, rowH * 0.34);
    }
    ctx.restore();
  }

  // Ringing teeth shimmer.
  for (let r = 0; r < ROWS; r++) {
    const ring = v.rings[r];
    if (!ring) continue;
    const age = v.now - ring.start;
    if (age < 0) continue;
    const e = Math.exp(-age / ring.tau);
    if (e < 0.02) continue;
    const len = toothLength(L, r);
    const y = rowY(L, r);
    const flick = 0.55 + 0.45 * Math.sin(v.now * 60 + r * 1.7);
    const g = ctx.createLinearGradient(L.tipX - len, 0, L.tipX, 0);
    g.addColorStop(0, 'rgba(255, 255, 255, 0)');
    g.addColorStop(1, `rgba(255, 250, 230, ${0.85 * e * flick})`);
    ctx.fillStyle = g;
    const half = rowH * 0.34;
    ctx.fillRect(L.tipX - len, y - half, len, half * 2);
    // The tip blurs as it swings.
    const sway = e * rowH * 0.18 * Math.sin(v.now * 90 + r);
    ctx.fillStyle = `rgba(255, 244, 210, ${0.5 * e})`;
    ctx.fillRect(L.tipX - rowH * 0.9, y - half + sway, rowH * 0.9, half * 2);
  }

  drawCrank(ctx, L, v);

  // A last breath of lamp falloff over everything, so brass and paper sit in the same light.
  const fall = ctx.createRadialGradient(L.w * 0.36, L.h * 0.32, L.h * 0.25, L.w * 0.36, L.h * 0.32, Math.hypot(L.w, L.h) * 0.75);
  fall.addColorStop(0, 'rgba(0, 0, 0, 0)');
  fall.addColorStop(1, 'rgba(10, 5, 2, 0.4)');
  ctx.fillStyle = fall;
  ctx.fillRect(0, 0, L.w, L.h);
}

function drawCrank(ctx: CanvasRenderingContext2D, L: Layout, v: View) {
  const { x, y, r } = L.crank;

  // Guide: the circle the knob travels.
  if (v.showGuide) {
    ctx.strokeStyle = 'rgba(241, 230, 204, 0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Shaft up into the frame.
  const shaft = ctx.createLinearGradient(x - 5, 0, x + 5, 0);
  shaft.addColorStop(0, '#5f4419');
  shaft.addColorStop(0.45, '#f3d690');
  shaft.addColorStop(1, '#5f4419');
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = shaft;
  ctx.fillRect(x - 4.5, L.frameBottom, 9, y - L.frameBottom);

  // Arm.
  const a = v.crankAngle;
  const kx = x + Math.cos(a) * r;
  const ky = y + Math.sin(a) * r;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#8c6a2c';
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(kx, ky);
  ctx.stroke();
  ctx.restore();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#d9b46a';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(kx, ky);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 240, 200, 0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - Math.sin(a) * 2, y + Math.cos(a) * -2);
  ctx.lineTo(kx - Math.sin(a) * 2, ky + Math.cos(a) * -2);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // Hub.
  const hub = ctx.createRadialGradient(x - 4, y - 4, 1, x, y, 13);
  hub.addColorStop(0, '#fbe6b0');
  hub.addColorStop(0.6, '#c39a4e');
  hub.addColorStop(1, '#6e5022');
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fill();
  screw(ctx, x, y, 4.5, a);

  // Turned walnut knob.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 6;
  const kr = v.grabbing ? 13.5 : 14.5;
  const knob = ctx.createRadialGradient(kx - kr * 0.4, ky - kr * 0.45, 1, kx, ky, kr);
  knob.addColorStop(0, '#c48a55');
  knob.addColorStop(0.35, '#7a4625');
  knob.addColorStop(1, '#2c160a');
  ctx.fillStyle = knob;
  ctx.beginPath();
  ctx.arc(kx, ky, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(30, 15, 5, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(kx, ky, kr * 0.55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 220, 180, 0.35)';
  ctx.beginPath();
  ctx.ellipse(kx - kr * 0.35, ky - kr * 0.4, kr * 0.28, kr * 0.16, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

/** Which cell sits under a point, or null off the strip or under the frame. */
export function cellAt(L: Layout, strip: Strip, s: number, x: number, y: number) {
  if (x > L.frameLeft - 2 && x < L.frameRight + 2) return null;
  const row = Math.floor((y - L.gridTop) / L.rowH);
  if (row < 0 || row >= ROWS) return null;
  const col = Math.round(s + (x - L.play) / L.colW);
  if (col < 0 || col >= strip.length) return null;
  return { col, row };
}

export const onPaper = (L: Layout, strip: Strip, s: number, x: number, y: number) =>
  y >= L.stripTop &&
  y <= L.stripTop + L.stripH &&
  x >= colX(L, -LEAD, s) - L.colW / 2 &&
  x <= colX(L, strip.length + TAIL, s) - L.colW / 2 &&
  (x < L.frameLeft || x > L.frameRight);
