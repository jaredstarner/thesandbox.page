// The two charts beside the tower: the method's lines through the changes, and the striking.

import type { Performance } from './_band';

function fit(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(canvas.clientWidth * dpr) || 300;
  const h = Math.round(canvas.clientHeight * dpr) || 300;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function cssVar(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/**
 * Rows as figures, as in any method book, with the treble's line in red and yours in blue. The current row
 * sits a third of the way down, so you can read the work coming.
 */
export function drawLine(canvas: HTMLCanvasElement, perf: Performance, row: number, mine: number): void {
  const ctx = fit(canvas);
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const font = cssVar(canvas, '--font-rs-text', 'sans-serif');
  ctx.clearRect(0, 0, W, H);
  const rows = perf.plan.rows;
  const lh = Math.max(15, Math.min(20, H / 16));
  const visible = Math.floor(H / lh);
  const cur = Math.max(0, row);
  const first = cur - Math.floor(visible / 3);
  const colW = Math.min(30, (W - 56) / 6);
  const x0 = 14;
  const xs = (p: number) => x0 + p * colW + colW / 2;
  const ys = (r: number) => (r - first) * lh + lh * 0.75;

  // Current row band.
  ctx.fillStyle = 'rgb(224 189 106 / 0.13)';
  ctx.fillRect(0, ys(cur) - lh * 0.72, W, lh);

  // Lines: treble red (unless that is you), yours blue.
  const drawPath = (bell: number, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    for (let r = Math.max(0, first - 1); r < Math.min(rows.length, first + visible + 2); r++) {
      const p = rows[r].indexOf(bell);
      const x = xs(p);
      const y = ys(r) - lh * 0.3;
      if (!started) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      started = true;
    }
    ctx.stroke();
  };
  if (mine !== 1) drawPath(1, 'rgb(210 74 63 / 0.75)', 1.6);
  drawPath(mine, '#5d8cf0', 2.6);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (let r = Math.max(0, first); r < Math.min(rows.length, first + visible + 1); r++) {
    const y = ys(r);
    const past = r < cur;
    for (let p = 0; p < 6; p++) {
      const b = rows[r][p];
      const isMine = b === mine;
      ctx.font = `${isMine ? 700 : 400} ${Math.round(lh * 0.66)}px ${font}`;
      ctx.fillStyle = isMine ? '#cfe0ff' : past ? '#5d5a52' : '#a9a392';
      ctx.fillText(String(b), xs(p), y);
    }
    // Strokes and calls in the margin.
    ctx.textAlign = 'left';
    ctx.font = `400 ${Math.round(lh * 0.55)}px ${font}`;
    const cap = perf.plan.captions.find((c) => c.row === r && c.kind === 'call');
    if (cap && cap.text !== 'Stand next') {
      ctx.fillStyle = '#e0bd6a';
      ctx.fillText(cap.text.replace('Go ', 'Go'), x0 + colW * 6 + 6, y);
    } else if (r === perf.plan.start) {
      ctx.fillStyle = '#7f7a6d';
      ctx.fillText('changes', x0 + colW * 6 + 6, y);
    }
    ctx.textAlign = 'center';
  }
}

/**
 * Striking, as ringing teachers chart it: each row a line, each blow a dot where it actually sounded against
 * where an even beat would put it. Yours are gold; a dot off its tick is a blow off the beat.
 */
export function drawStriking(canvas: HTMLCanvasElement, perf: Performance, row: number, mine: number): void {
  const ctx = fit(canvas);
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  ctx.clearRect(0, 0, W, H);
  const n = 12;
  const lh = H / (n + 0.5);
  const gap = perf.gap;
  const span = gap * 7; // six blows and the handstroke gap
  const px = (W - 24) / span;
  const firstRow = Math.max(0, row - n + 1);
  for (let k = 0; k < n; k++) {
    const r = firstRow + k;
    if (r > row || r >= perf.plan.rows.length) break;
    const y = (k + 0.75) * lh;
    const start = perf.rowStart[r];
    // Handstroke rows open with the gap.
    const lead = r % 2 === 0 ? gap : 0;
    ctx.strokeStyle = '#262b40';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, y);
    ctx.lineTo(W - 12, y);
    ctx.stroke();
    for (let p = 0; p < 6; p++) {
      const x = 12 + (lead + p * gap) * px;
      ctx.strokeStyle = '#363c57';
      ctx.beginPath();
      ctx.moveTo(x, y - lh * 0.28);
      ctx.lineTo(x, y + lh * 0.28);
      ctx.stroke();
    }
    for (const blow of perf.blows) {
      if (blow.row !== r || blow.at === undefined) continue;
      const x = 12 + (lead + (blow.at - start)) * px;
      const isMine = blow.bell + 1 === mine;
      ctx.fillStyle = isMine ? '#f0cf7a' : '#8a8676';
      ctx.beginPath();
      ctx.arc(x, y, isMine ? 3.6 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // A miss: an open ring on its tick.
    const missed = perf.byBell[mine - 1]?.find((b) => b.row === r && b.error === null);
    if (missed) {
      ctx.strokeStyle = '#d24a3f';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(12 + (lead + missed.place * gap) * px, y, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
