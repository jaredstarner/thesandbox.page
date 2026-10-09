// Leaf shapes, drawn once into a six-cell texture: an oak spray, a birch
// spray, a spruce shoot of needles, a round seed leaf, and single oak and
// birch leaves for young plants. Each cell has its
// stalk at the bottom centre; colour comes from the shader, so the cells hold
// light and shade only.

import { makeRng, type Rng } from './_rng';

const CELL = 256;

function oakLeaf(ctx: CanvasRenderingContext2D, len: number, rng: Rng): void {
  // Lobed outline from stalk (t = 0) to tip (t = 1), with ear-like lobes at the base.
  const pts: [number, number][] = [];
  const lobes = 4 + Math.floor(rng() * 2);
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const body = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.75);
    const lobe = 0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * (lobes + 0.5)));
    const ear = t < 0.12 ? 0.6 * Math.sin((t / 0.12) * Math.PI) : 0;
    pts.push([Math.max(body * lobe, ear) * len * 0.36, t * len]);
  }
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (const [w, y] of pts) ctx.lineTo(w, -y);
  for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(-pts[i][0] * (0.92 + 0.08 * Math.sin(i)), -pts[i][1]);
  ctx.closePath();
  const g = ctx.createLinearGradient(-len * 0.3, 0, len * 0.3, -len);
  g.addColorStop(0, '#d8d8d8');
  g.addColorStop(1, '#ffffff');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,120,120,0.55)';
  ctx.lineWidth = len * 0.018;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -len * 0.95);
  ctx.stroke();
}

function birchLeaf(ctx: CanvasRenderingContext2D, len: number): void {
  // Triangular, pointed, with a double-toothed edge.
  const pts: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const body = t < 0.25 ? Math.sin((t / 0.25) * Math.PI * 0.5) : Math.pow(1 - (t - 0.25) / 0.75, 1.1);
    const tooth = 1 - 0.08 * Math.abs(Math.sin(t * Math.PI * 14)) - 0.05 * Math.abs(Math.sin(t * Math.PI * 7));
    pts.push([body * tooth * len * 0.42, t * len]);
  }
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (const [w, y] of pts) ctx.lineTo(w, -y);
  for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(-pts[i][0], -pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = '#f2f2f2';
  ctx.fill();
  ctx.strokeStyle = 'rgba(130,130,130,0.5)';
  ctx.lineWidth = len * 0.02;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -len * 0.9);
  ctx.stroke();
}

function spray(ctx: CanvasRenderingContext2D, cx: number, rng: Rng, kind: 'oak' | 'birch'): void {
  const count = kind === 'oak' ? 5 : 6;
  ctx.save();
  ctx.translate(cx + CELL / 2, CELL - 4);
  // Stalk.
  ctx.strokeStyle = 'rgba(110,100,90,1)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -CELL * 0.35);
  ctx.stroke();
  for (let k = 0; k < count; k++) {
    const t = (k + 0.5) / count;
    const ang = (t - 0.5) * (kind === 'oak' ? 2.1 : 2.6) + (rng() - 0.5) * 0.25;
    const len = CELL * (kind === 'oak' ? 0.5 : 0.36) * (0.82 + rng() * 0.25);
    ctx.save();
    ctx.translate(0, -CELL * (0.12 + 0.3 * rng()));
    ctx.rotate(ang);
    if (kind === 'birch') {
      ctx.strokeStyle = 'rgba(110,100,90,1)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -len * 0.3);
      ctx.stroke();
      ctx.translate(0, -len * 0.3);
      birchLeaf(ctx, len);
    } else {
      oakLeaf(ctx, len, rng);
    }
    ctx.restore();
  }
  ctx.restore();
}

function needles(ctx: CanvasRenderingContext2D, cx: number, rng: Rng): void {
  // A shoot running bottom to top, needles all round it.
  ctx.save();
  ctx.translate(cx + CELL / 2, 0);
  ctx.strokeStyle = 'rgba(140,110,90,1)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, CELL);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const y = CELL * (0.02 + 0.96 * rng());
    const side = rng() < 0.5 ? -1 : 1;
    const len = CELL * (0.16 + 0.12 * rng()) * (1 - 0.35 * Math.abs(y / CELL - 0.5));
    const ang = side * (0.6 + 0.5 * rng());
    const shade = Math.floor(190 + rng() * 65);
    ctx.strokeStyle = `rgb(${shade},${shade},${shade})`;
    ctx.lineWidth = 4 + rng() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(Math.sin(ang) * len, y - Math.cos(ang) * len * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

function seedLeaf(ctx: CanvasRenderingContext2D, cx: number): void {
  ctx.save();
  ctx.translate(cx + CELL / 2, CELL - 4);
  ctx.strokeStyle = 'rgba(150,150,140,1)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -CELL * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, -CELL * 0.62, CELL * 0.3, CELL * 0.34, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#f0f0f0';
  ctx.fill();
  ctx.restore();
}

function single(ctx: CanvasRenderingContext2D, cx: number, rng: Rng, kind: 'oak' | 'birch'): void {
  ctx.save();
  ctx.translate(cx + CELL / 2, CELL - 4);
  ctx.strokeStyle = 'rgba(110,100,90,1)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -CELL * (kind === 'oak' ? 0.06 : 0.22));
  ctx.stroke();
  ctx.translate(0, -CELL * (kind === 'oak' ? 0.05 : 0.2));
  if (kind === 'oak') oakLeaf(ctx, CELL * 0.92, rng);
  else birchLeaf(ctx, CELL * 0.76);
  ctx.restore();
}

/** Fruit hangs from the bottom of its cell and is drawn in its own colours. */
function fruit(ctx: CanvasRenderingContext2D, cx: number, rng: Rng, kind: 'acorn' | 'catkin' | 'cone'): void {
  ctx.save();
  ctx.translate(cx + CELL / 2, CELL - 2);
  ctx.lineCap = 'round';
  if (kind === 'acorn') {
    // Pedunculate: two acorns on a long stalk.
    ctx.strokeStyle = '#6b5636';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -CELL * 0.42);
    ctx.stroke();
    for (const [dx, a] of [
      [-34, -0.35],
      [34, 0.35],
    ] as const) {
      ctx.save();
      ctx.translate(dx * 0.4, -CELL * 0.42);
      ctx.rotate(a);
      ctx.fillStyle = '#93853f';
      ctx.beginPath();
      ctx.ellipse(0, -CELL * 0.2, CELL * 0.085, CELL * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6a5434';
      ctx.beginPath();
      ctx.ellipse(0, -CELL * 0.07, CELL * 0.1, CELL * 0.075, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else if (kind === 'catkin') {
    ctx.strokeStyle = '#6e5a3c';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -CELL * 0.12);
    ctx.stroke();
    ctx.fillStyle = '#8f7f45';
    ctx.beginPath();
    ctx.ellipse(0, -CELL * 0.52, CELL * 0.075, CELL * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(70,55,30,0.55)';
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      ctx.arc((rng() - 0.5) * CELL * 0.11, -CELL * (0.14 + 0.75 * rng()), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = '#5a3f28';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -CELL * 0.08);
    ctx.stroke();
    ctx.fillStyle = '#7d5434';
    ctx.beginPath();
    ctx.moveTo(0, -CELL * 0.06);
    ctx.bezierCurveTo(CELL * 0.17, -CELL * 0.18, CELL * 0.16, -CELL * 0.8, 0, -CELL * 0.97);
    ctx.bezierCurveTo(-CELL * 0.16, -CELL * 0.8, -CELL * 0.17, -CELL * 0.18, 0, -CELL * 0.06);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,38,22,0.8)';
    ctx.lineWidth = 3;
    for (let y = 0.14; y < 0.92; y += 0.07) {
      const w = Math.sin(Math.PI * Math.min(1, (y - 0.04) / 0.92)) * CELL * 0.12;
      ctx.beginPath();
      ctx.arc(0, -CELL * y, w, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export const ATLAS_CELLS = 9;

export function drawLeafAtlas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CELL * ATLAS_CELLS;
  c.height = CELL;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const rng = makeRng(7);
  // The texture is flipped on upload, so the stalk at the bottom of a cell lands at v = 0.
  spray(ctx, 0, rng, 'oak');
  spray(ctx, CELL, rng, 'birch');
  needles(ctx, CELL * 2, rng);
  seedLeaf(ctx, CELL * 3);
  single(ctx, CELL * 4, rng, 'oak');
  single(ctx, CELL * 5, rng, 'birch');
  fruit(ctx, CELL * 6, rng, 'acorn');
  fruit(ctx, CELL * 7, rng, 'catkin');
  fruit(ctx, CELL * 8, rng, 'cone');
  return c;
}
