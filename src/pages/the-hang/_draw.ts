// Draws the wall two ways from one scene: the lit room, and the curator's hanging plan with its dimensions.

import type { Images } from './_images';
import { drawMat, drawMoulding, drawRod } from './_mount';
import { BENCH, boxOf, CL, DOOR, LOW, paintOf, WALL, type Box, type Guide, type Hung, type Scene } from './_scene';
import type { Work } from './_works';

export interface View {
  /** Wall point at the canvas centre, cm. */
  cx: number;
  cy: number;
  /** CSS px per cm. */
  s: number;
  /** Canvas size, CSS px. */
  w: number;
  h: number;
  dpr: number;
}

export interface Fonts {
  text: string;
  display: string;
}

export interface DrawState {
  scene: Scene;
  works: Map<number, Work>;
  images: Images;
  selected: number | null;
  guides: Guide[];
  /** The torch's spot on the wall, cm. */
  torch: { x: number; y: number } | null;
  fonts: Fonts;
}

export const toX = (v: View, x: number) => (x - v.cx) * v.s + v.w / 2;
export const toY = (v: View, y: number) => v.h / 2 - (y - v.cy) * v.s;
export const fromX = (v: View, px: number) => (px - v.w / 2) / v.s + v.cx;
export const fromY = (v: View, py: number) => v.cy - (py - v.h / 2) / v.s;

const rgb = (c: [number, number, number], k = 1, a = 1) =>
  `rgb(${Math.round(Math.min(255, c[0] * k))} ${Math.round(Math.min(255, c[1] * k))} ${Math.round(Math.min(255, c[2] * k))} / ${a})`;

const luma = (c: [number, number, number]) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

function visible(v: View, b: Box, pad = 60): boolean {
  return toX(v, b.x1) > -pad && toX(v, b.x0) < v.w + pad && toY(v, b.y0) > -pad && toY(v, b.y1) < v.h + pad;
}

/** The selected work last, so it draws over any neighbour it is dragged across. */
function onTop(items: Hung[], selected: number | null): Hung[] {
  if (selected === null) return items;
  return [...items.filter((i) => i.id !== selected), ...items.filter((i) => i.id === selected)];
}

/** Items whose outer boxes overlap another's. */
export function clashes(scene: Scene, works: Map<number, Work>): Set<number> {
  const out = new Set<number>();
  const list = scene.items.filter((i) => works.has(i.id)).map((i) => ({ i, b: boxOf(i, works.get(i.id)!) }));
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      const p = list[a].b;
      const q = list[b].b;
      if (p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1) {
        out.add(list[a].i.id);
        out.add(list[b].i.id);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The visitor and the bench, both in centimetres from the floor.

/** A visitor seen from behind in a long coat, feet at (0, 0), about 172 cm tall. */
const FIGURE: [number, number][] = (() => {
  const right: [number, number][] = [
    [4.5, 151],
    [7, 147.6],
    [13, 145.6],
    [18.6, 143.6],
    [22.2, 140],
    [23.6, 134],
    [24.2, 124],
    [24.2, 112],
    [23.8, 100],
    [23.2, 90],
    [22.8, 84],
    [22.4, 79.5],
    [20.6, 76.6],
    [18.6, 78],
    [18.4, 82],
    [19.6, 70],
    [20.6, 61],
    [19.6, 56.5],
    [14, 55.6],
    [13, 50],
    [12, 30],
    [11.4, 12],
    [12.2, 4.5],
    [14.6, 2],
    [14.2, 0],
    [5.2, 0],
    [4.6, 3],
    [4.6, 12],
    [3.6, 30],
    [2.6, 50],
    [1.4, 55.2],
  ];
  const left = right.map(([x, y]) => [-x, y] as [number, number]).reverse();
  // The head, from the left of the neck over the crown to the right, so the outline is one line.
  const head: [number, number][] = [];
  for (let a = 236; a >= -56; a -= 14) {
    const t = (a * Math.PI) / 180;
    head.push([9.2 * Math.cos(t), 161 + 11.6 * Math.sin(t)]);
  }
  return [...right, [0, 55.6], ...left, ...head];
})();

function smoothPath(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  const n = pts.length;
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = mid(p, pts[(i + 1) % n]);
    ctx.quadraticCurveTo(p[0], p[1], q[0], q[1]);
  }
  ctx.closePath();
}

function figurePath(ctx: CanvasRenderingContext2D, v: View, x: number) {
  smoothPath(
    ctx,
    FIGURE.map(([fx, fy]) => [toX(v, x + fx), toY(v, fy)] as [number, number]),
  );
}

export const FIGURE_HALF = 25;
export const FIGURE_TOP = 173;

// ---------------------------------------------------------------------------------------------------------------
// Room

function drawPicture(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (img) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x, y, w, h);
  } else {
    ctx.fillStyle = 'rgb(128 122 112)';
    ctx.fillRect(x, y, w, h);
  }
}

function drawWorkRoom(ctx: CanvasRenderingContext2D, v: View, item: Hung, work: Work, st: DrawState) {
  const m = work.mount;
  const s = v.s;
  const X = toX(v, item.x - m.w / 2);
  const Y = toY(v, item.y + m.h / 2);
  const W = m.w * s;
  const H = m.h * s;
  const px = X + m.pic.x * s;
  const py = Y + m.pic.y * s;
  const pw = m.pic.w * s;
  const ph = m.pic.h * s;

  // The work's shadow on the wall, thrown down by the lights above.
  ctx.save();
  ctx.shadowColor = 'rgb(0 0 0 / 0.5)';
  ctx.shadowBlur = Math.max(1, m.depth * s * 1.15 * v.dpr);
  ctx.shadowOffsetY = m.depth * s * 0.7 * v.dpr;
  ctx.shadowOffsetX = -m.depth * s * 0.16 * v.dpr;
  ctx.fillStyle = 'rgb(60 56 50)';
  if (m.finish === 'rod') ctx.fillRect(px, py, pw, ph);
  else ctx.fillRect(X, Y, W, H);
  ctx.restore();

  drawPicture(
    ctx,
    st.images.get(work, Math.max(pw, ph * (work.pw && work.ph ? work.pw / work.ph : 1)) * v.dpr),
    px,
    py,
    pw,
    ph,
  );

  if (m.finish === 'rod') {
    drawRod(ctx, px, Y + 2 * s, pw, 2.8 * s);
    return;
  }
  if (m.mat) {
    const f = m.frame * s;
    drawMat(ctx, m.mat.tone, X + f, Y + f, W - 2 * f, H - 2 * f, px, py, pw, ph, 0.32 * s);
  } else {
    // The frame's lip throws a shade across the top of the canvas.
    const d = Math.min(ph * 0.12, m.depth * 0.32 * s);
    if (d > 0.6) {
      const g = ctx.createLinearGradient(0, py, 0, py + d);
      g.addColorStop(0, 'rgb(0 0 0 / 0.42)');
      g.addColorStop(1, 'rgb(0 0 0 / 0)');
      ctx.fillStyle = g;
      ctx.fillRect(px, py, pw, d);
    }
  }
  if (m.glazed) {
    const g = ctx.createLinearGradient(px, py, px + pw, py + ph);
    g.addColorStop(0, 'rgb(255 255 255 / 0.1)');
    g.addColorStop(0.35, 'rgb(255 255 255 / 0.02)');
    g.addColorStop(0.62, 'rgb(255 255 255 / 0.06)');
    g.addColorStop(1, 'rgb(255 255 255 / 0)');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, pw, ph);
  }
  drawMoulding(ctx, m.finish, X, Y, W, H, Math.max(0.6, m.frame * s), m.frame, work.id);
}

/** The wall label's place: to the right of the work, at the height labels are read. */
export function labelBox(item: Hung, work: Work): Box {
  const b = boxOf(item, work);
  const w = 12;
  const h = 9;
  const cy = b.y0 > 140 ? b.y0 + h / 2 : Math.min(b.y1 - h / 2, 128);
  return { x0: b.x1 + 9, x1: b.x1 + 9 + w, y0: cy - h / 2, y1: cy + h / 2 };
}

function lifeOf(display: string | null): string | null {
  const m = display?.match(/\(([^)]*\d[^)]*)\)/);
  return m ? m[1] : null;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, lines: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      out.push(line);
      line = word;
      if (out.length === lines) break;
    } else line = next;
  }
  if (out.length < lines && line) out.push(line);
  if (out.length === lines && words.join(' ') !== out.join(' ')) {
    let last = out[lines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > max) last = last.slice(0, -1);
    out[lines - 1] = `${last.replace(/[\s,;:]+$/, '')}…`;
  }
  return out;
}

function drawLabel(ctx: CanvasRenderingContext2D, v: View, item: Hung, work: Work, fonts: Fonts) {
  const b = labelBox(item, work);
  const s = v.s;
  const x = toX(v, b.x0);
  const y = toY(v, b.y1);
  const w = (b.x1 - b.x0) * s;
  const h = (b.y1 - b.y0) * s;
  if (w < 1.5) return;
  ctx.save();
  ctx.shadowColor = 'rgb(0 0 0 / 0.25)';
  ctx.shadowBlur = Math.max(0.5, 0.25 * s * v.dpr);
  ctx.shadowOffsetY = 0.12 * s * v.dpr;
  ctx.fillStyle = 'rgb(250 249 246)';
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  // About 15 pt artist and title lines on a 12 × 9 cm card, as gallery labels are set to be read at arm's length.
  const pad = 0.8 * s;
  const size = 0.52 * s;
  const inner = w - 2 * pad;
  if (size * v.dpr < 4.5) {
    // Too small to read: the label's lines of type as grey rules.
    if (size < 0.35) return;
    ctx.fillStyle = 'rgb(40 40 40 / 0.55)';
    const rules = [0.55, 0.8, 0.7, 0.35, 0.6, 0.45];
    let yy = y + pad;
    rules.forEach((f, i) => {
      ctx.globalAlpha = i === 0 ? 0.9 : 0.55;
      ctx.fillRect(x + pad, yy, inner * f, Math.max(0.5, size * (i === 0 ? 0.7 : 0.5)));
      yy += size * (i === 1 ? 1.8 : 1.4);
    });
    ctx.globalAlpha = 1;
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = 'rgb(28 27 26)';
  ctx.textBaseline = 'top';
  let yy = y + pad;
  ctx.font = `700 ${size}px ${fonts.text}`;
  for (const line of wrap(ctx, work.artist ?? 'Unknown maker', inner, 2)) {
    ctx.fillText(line, x + pad, yy);
    yy += size * 1.25;
  }
  const life = lifeOf(work.artistDisplay);
  ctx.font = `400 ${size * 0.78}px ${fonts.text}`;
  if (life) {
    for (const line of wrap(ctx, life, inner, 1)) ctx.fillText(line, x + pad, yy);
    yy += size * 1.1;
  }
  yy += size * 0.5;
  ctx.font = `italic 500 ${size}px ${fonts.text}`;
  const titleLines = wrap(ctx, work.title, inner, 3);
  for (const line of titleLines) {
    ctx.fillText(line, x + pad, yy);
    yy += size * 1.22;
  }
  ctx.font = `400 ${size * 0.82}px ${fonts.text}`;
  if (work.date) {
    ctx.fillText(wrap(ctx, work.date, inner, 1)[0] ?? '', x + pad, yy);
    yy += size * 1.15;
  }
  ctx.font = `400 ${size * 0.74}px ${fonts.text}`;
  if (work.medium) {
    for (const line of wrap(ctx, work.medium, inner, 2)) {
      ctx.fillText(line, x + pad, yy);
      yy += size * 0.98;
    }
  }
  if (work.credit) {
    ctx.font = `400 ${size * 0.62}px ${fonts.text}`;
    const lines = wrap(ctx, work.credit, inner, 2);
    let cy = y + h - pad - size * 0.8 * lines.length;
    // The credit line sits at the foot of the card, and only when the text above leaves it room.
    if (yy + size * 0.3 < cy) {
      ctx.fillStyle = 'rgb(28 27 26 / 0.7)';
      for (const line of lines) {
        ctx.fillText(line, x + pad, cy);
        cy += size * 0.8;
      }
    }
  }
  ctx.restore();
}

function drawBench(ctx: CanvasRenderingContext2D, v: View, cx: number, light: number) {
  const s = v.s;
  const x0 = toX(v, cx - BENCH.w / 2);
  const w = BENCH.w * s;
  const seatTop = toY(v, BENCH.h);
  const seatBot = toY(v, BENCH.h - 11);
  // Shadow pooled on the floor.
  const sh = ctx.createRadialGradient(toX(v, cx), toY(v, 0), 0, toX(v, cx), toY(v, 0), w * 0.62);
  sh.addColorStop(0, `rgb(0 0 0 / ${0.4 * light + 0.1})`);
  sh.addColorStop(1, 'rgb(0 0 0 / 0)');
  ctx.fillStyle = sh;
  ctx.save();
  ctx.translate(0, toY(v, 0));
  ctx.scale(1, 0.12);
  ctx.translate(0, -toY(v, 0));
  ctx.fillRect(x0 - w * 0.2, toY(v, 0) - w, w * 1.4, w * 2);
  ctx.restore();
  // Steel legs.
  for (const lx of [cx - BENCH.w / 2 + 16, cx + BENCH.w / 2 - 20]) {
    const g = ctx.createLinearGradient(toX(v, lx), 0, toX(v, lx + 4), 0);
    g.addColorStop(0, rgb([70, 72, 74], light));
    g.addColorStop(0.5, rgb([190, 192, 194], light));
    g.addColorStop(1, rgb([60, 62, 64], light));
    ctx.fillStyle = g;
    ctx.fillRect(toX(v, lx), seatBot, 4 * s, toY(v, 0) - seatBot);
  }
  // Leather seat over an oak rail.
  ctx.fillStyle = rgb([118, 86, 56], light);
  ctx.fillRect(x0, seatBot - 3 * s, w, 3 * s);
  const g = ctx.createLinearGradient(0, seatTop, 0, seatBot - 3 * s);
  g.addColorStop(0, rgb([96, 86, 78], light));
  g.addColorStop(0.18, rgb([46, 40, 36], light));
  g.addColorStop(1, rgb([24, 21, 19], light));
  ctx.fillStyle = g;
  const r = 2.5 * s;
  ctx.beginPath();
  ctx.roundRect(x0, seatTop, w, seatBot - 3 * s - seatTop, [r, r, 0, 0]);
  ctx.fill();
  // Buttoned top seam.
  if (s > 0.6) {
    ctx.strokeStyle = rgb([16, 14, 12], light, 0.6);
    ctx.lineWidth = Math.max(0.5, 0.3 * s);
    ctx.beginPath();
    ctx.moveTo(x0 + r, seatTop + 1.6 * s);
    ctx.lineTo(x0 + w - r, seatTop + 1.6 * s);
    ctx.stroke();
  }
}

function drawFigureRoom(ctx: CanvasRenderingContext2D, v: View, x: number, light: number) {
  const sh = ctx.createRadialGradient(toX(v, x), toY(v, 0), 0, toX(v, x), toY(v, 0), 34 * v.s);
  sh.addColorStop(0, `rgb(0 0 0 / ${0.45 * light + 0.1})`);
  sh.addColorStop(1, 'rgb(0 0 0 / 0)');
  ctx.save();
  ctx.translate(0, toY(v, 0));
  ctx.scale(1, 0.14);
  ctx.translate(0, -toY(v, 0));
  ctx.fillStyle = sh;
  ctx.fillRect(toX(v, x - 40), toY(v, 0) - 40 * v.s, 80 * v.s, 80 * v.s);
  ctx.restore();
  const g = ctx.createLinearGradient(0, toY(v, FIGURE_TOP), 0, toY(v, 0));
  g.addColorStop(0, rgb([58, 54, 52], 0.55 + 0.6 * light));
  g.addColorStop(0.12, rgb([44, 46, 52], 0.55 + 0.6 * light));
  g.addColorStop(0.35, rgb([52, 58, 70], 0.5 + 0.55 * light));
  g.addColorStop(0.7, rgb([34, 36, 44], 0.5 + 0.5 * light));
  g.addColorStop(1, rgb([20, 20, 24], 0.6 + 0.4 * light));
  ctx.fillStyle = g;
  figurePath(ctx, v, x);
  ctx.fill();
}

function fillLightMap(lm: CanvasRenderingContext2D, v: View, k: number, st: DrawState) {
  const { scene } = st;
  const w = lm.canvas.width;
  const h = lm.canvas.height;
  lm.setTransform(1, 0, 0, 1, 0, 0);
  lm.globalCompositeOperation = 'source-over';
  const amb = scene.light === 'spots' ? 0.55 : scene.light === 'wash' ? 0.86 : 0.075;
  // Ceiling, floor, and returns keep one level of their own; only the wall takes the pools.
  const room = Math.round((scene.light === 'torch' ? 0.1 : scene.light === 'wash' ? 0.9 : 0.72) * 255);
  lm.fillStyle = `rgb(${room} ${room} ${room})`;
  lm.fillRect(0, 0, w, h);
  lm.setTransform(k, 0, 0, k, 0, 0);
  const a = Math.round(amb * 255);
  lm.fillStyle = `rgb(${a} ${a} ${a})`;
  lm.fillRect(toX(v, 0), toY(v, WALL.h), WALL.w * v.s, WALL.h * v.s);
  lm.save();
  lm.beginPath();
  lm.rect(toX(v, 0), toY(v, WALL.h), WALL.w * v.s, WALL.h * v.s);
  lm.clip();
  fillPools(lm, v, st, amb);
  lm.restore();
}

function fillPools(lm: CanvasRenderingContext2D, v: View, st: DrawState, amb: number) {
  const { scene, works } = st;
  if (scene.light === 'wash') {
    const g = lm.createLinearGradient(0, toY(v, WALL.h), 0, toY(v, 0));
    g.addColorStop(0, 'rgb(36 36 36)');
    g.addColorStop(0.5, 'rgb(14 14 14)');
    g.addColorStop(1, 'rgb(0 0 0)');
    lm.globalCompositeOperation = 'lighter';
    lm.fillStyle = g;
    lm.fillRect(toX(v, -100), toY(v, WALL.h), (WALL.w + 200) * v.s, WALL.h * v.s);
    return;
  }
  lm.globalCompositeOperation = 'lighter';
  const pool = (x: number, y: number, rx: number, ry: number, peak: number, soft = 0.62) => {
    const cx = toX(v, x);
    const cy = toY(v, y);
    lm.save();
    lm.translate(cx, cy);
    lm.scale(1, ry / rx);
    const r = rx * v.s;
    const g = lm.createRadialGradient(0, 0, 0, 0, 0, r);
    const p = Math.round(peak * 255);
    g.addColorStop(0, `rgb(${p} ${p} ${p})`);
    g.addColorStop(soft, `rgb(${Math.round(p * 0.72)} ${Math.round(p * 0.72)} ${Math.round(p * 0.72)})`);
    g.addColorStop(1, 'rgb(0 0 0)');
    lm.fillStyle = g;
    lm.fillRect(-r, -r, 2 * r, 2 * r);
    lm.restore();
  };
  if (scene.light === 'torch') {
    if (st.torch) {
      pool(st.torch.x, st.torch.y, 62, 62, 0.95, 0.35);
      pool(st.torch.x, st.torch.y, 26, 26, 0.3, 0.5);
    }
    // The exit sign over the door.
    pool(DOOR.x + DOOR.w / 2, DOOR.h + 22, 70, 46, 0.16, 0.2);
    return;
  }
  for (const item of scene.items) {
    const work = works.get(item.id);
    if (!work) continue;
    const m = work.mount;
    // A spot is focused a little wider than the frame, and never tighter than its beam allows.
    const rx = Math.max(m.w * 0.72, 44) + 40;
    const ry = Math.max(m.h * 0.78, 48) + 46;
    pool(item.x, item.y + m.h * 0.04, rx, ry, (1 - amb) * 0.88, 0.5);
    // The beam's upper edge on the wall, rising to the track: the scallop.
    const top = WALL.h;
    pool(item.x, top, rx * 0.7, (top - item.y) * 0.9, 0.07, 0.25);
  }
}

export function drawRoom(ctx: CanvasRenderingContext2D, lm: CanvasRenderingContext2D, v: View, st: DrawState) {
  const { scene, works, fonts } = st;
  const paint = paintOf(scene.paint).rgb;
  const dark = luma(paint) < 0.45;
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#121212';
  ctx.fillRect(0, 0, v.w, v.h);
  const s = v.s;
  const L = toX(v, 0);
  const R = toX(v, WALL.w);
  const T = toY(v, WALL.h);
  const B = toY(v, 0);

  // Side returns and ceiling.
  const ret = 90 * s;
  const lg = ctx.createLinearGradient(L - ret, 0, L, 0);
  lg.addColorStop(0, rgb(paint, 0.36));
  lg.addColorStop(1, rgb(paint, 0.62));
  ctx.fillStyle = lg;
  ctx.fillRect(Math.min(0, L - ret), T, Math.max(ret, L), B - T);
  const rg = ctx.createLinearGradient(R, 0, R + ret, 0);
  rg.addColorStop(0, rgb(paint, 0.66));
  rg.addColorStop(1, rgb(paint, 0.4));
  ctx.fillStyle = rg;
  ctx.fillRect(R, T, Math.max(ret, v.w - R), B - T);
  // A dark open ceiling, running up out of view, so the lit wall carries the room.
  const ceilTop = Math.min(0, T - 80 * s);
  const cg = ctx.createLinearGradient(0, ceilTop, 0, T);
  cg.addColorStop(0, 'rgb(26 26 27)');
  cg.addColorStop(Math.max(0, Math.min(0.99, 1 - (70 * s) / Math.max(1, T - ceilTop))), 'rgb(40 40 41)');
  cg.addColorStop(1, 'rgb(62 61 60)');
  ctx.fillStyle = cg;
  ctx.fillRect(0, ceilTop, v.w, T - ceilTop);

  // Floor: oak boards running along the wall, each nearer board a little wider, out to the bottom of the view.
  const floorBot = Math.max(v.h, B + 110 * s);
  const fg = ctx.createLinearGradient(0, B, 0, floorBot);
  fg.addColorStop(0, 'rgb(104 78 54)');
  fg.addColorStop(Math.min(1, (90 * s) / Math.max(1, floorBot - B)), 'rgb(132 98 66)');
  fg.addColorStop(1, 'rgb(96 72 50)');
  ctx.fillStyle = fg;
  ctx.fillRect(0, B, v.w, floorBot - B);
  ctx.strokeStyle = 'rgb(60 40 24 / 0.3)';
  ctx.lineWidth = Math.max(0.5, 0.2 * s);
  for (let i = 1, yy = B; i < 60; i++) {
    yy += (2 + i * 1.6) * s;
    if (yy > floorBot) break;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(yy) + 0.5);
    ctx.lineTo(v.w, Math.round(yy) + 0.5);
    ctx.stroke();
  }

  // The wall, its skirting, and the doorway through to the next room.
  ctx.fillStyle = rgb(paint);
  ctx.fillRect(L, T, R - L, B - T);
  ctx.fillStyle = rgb(paint, 0.9);
  ctx.fillRect(L, B - 8 * s, R - L, 8 * s);
  ctx.fillStyle = rgb(paint, 0.7);
  ctx.fillRect(L, B - 8 * s, R - L, Math.max(0.5, 0.4 * s));
  const dx = toX(v, DOOR.x);
  const dt = toY(v, DOOR.h);
  const dw = DOOR.w * s;
  const beyond = ctx.createLinearGradient(0, dt, 0, B);
  beyond.addColorStop(0, rgb(paint, 0.5));
  beyond.addColorStop(0.75, rgb(paint, 0.58));
  beyond.addColorStop(0.75, 'rgb(96 72 50)');
  beyond.addColorStop(1, 'rgb(112 84 58)');
  ctx.fillStyle = beyond;
  ctx.fillRect(dx, dt, dw, B - dt);
  // The next room: a pool of light on its far wall and the edge of a gilt frame, cut off by the opening.
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dt, dw, B - dt);
  ctx.clip();
  const glow = ctx.createRadialGradient(dx + dw * 0.95, toY(v, 150), 0, dx + dw * 0.95, toY(v, 150), 110 * s);
  glow.addColorStop(0, 'rgb(255 240 214 / 0.28)');
  glow.addColorStop(1, 'rgb(255 240 214 / 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(dx, dt, dw, B - dt);
  ctx.fillStyle = 'rgb(150 116 60 / 0.8)';
  ctx.fillRect(dx + dw * 0.72, toY(v, 196), dw * 0.6, 92 * s);
  ctx.fillStyle = 'rgb(70 62 52 / 0.9)';
  ctx.fillRect(dx + dw * 0.72 + 5 * s, toY(v, 191), dw * 0.6, 82 * s);
  ctx.restore();
  // Reveal: the wall's thickness shading the opening's left side.
  const jg = ctx.createLinearGradient(dx, 0, dx + 22 * s, 0);
  jg.addColorStop(0, rgb(paint, 0.62));
  jg.addColorStop(1, rgb(paint, 0.52));
  ctx.fillStyle = jg;
  ctx.fillRect(dx, dt, 22 * s, B - dt);

  // The show's title in vinyl letters beside the door.
  if (scene.title.trim()) {
    const size = 26 * s;
    if (size > 2) {
      ctx.fillStyle = dark ? 'rgb(244 240 232 / 0.92)' : 'rgb(34 32 30 / 0.92)';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `400 ${size}px ${fonts.display}`;
      ctx.fillText(scene.title.trim(), toX(v, DOOR.x), toY(v, DOOR.h + 62));
      ctx.font = `500 ${7 * s}px ${fonts.text}`;
      ctx.fillText('WORKS FROM THE ART INSTITUTE OF CHICAGO', toX(v, DOOR.x + 1), toY(v, DOOR.h + 40));
    }
  }

  const items = onTop(
    scene.items.filter((i) => works.has(i.id)),
    st.selected,
  );
  for (const item of items) {
    const work = works.get(item.id)!;
    if (visible(v, boxOf(item, work))) drawWorkRoom(ctx, v, item, work, st);
  }
  for (const item of items) {
    const work = works.get(item.id)!;
    const lb = labelBox(item, work);
    if (visible(v, lb)) drawLabel(ctx, v, item, work, fonts);
  }

  // Lights: the track and a fitting aimed at each work.
  ctx.fillStyle = 'rgb(24 24 24)';
  ctx.fillRect(0, T - 34 * s, v.w, Math.max(1, 3 * s));
  if (scene.light === 'spots') {
    for (const item of items) {
      const fx = toX(v, item.x + 18);
      const fy = T - 31 * s;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(0.35);
      ctx.fillStyle = 'rgb(30 30 30)';
      ctx.fillRect(-1.2 * s, 0, 2.4 * s, 9 * s);
      const cg2 = ctx.createLinearGradient(-5 * s, 0, 5 * s, 0);
      cg2.addColorStop(0, 'rgb(20 20 20)');
      cg2.addColorStop(0.4, 'rgb(70 70 70)');
      cg2.addColorStop(1, 'rgb(16 16 16)');
      ctx.fillStyle = cg2;
      ctx.beginPath();
      ctx.roundRect(-5 * s, 8 * s, 10 * s, 15 * s, 2 * s);
      ctx.fill();
      ctx.fillStyle = 'rgb(255 244 214 / 0.9)';
      ctx.fillRect(-4 * s, 22.4 * s, 8 * s, 1 * s);
      ctx.restore();
    }
  }

  // Light: multiply the whole room by the map of where the lamps fall.
  const k = lm.canvas.width / v.w;
  fillLightMap(lm, v, k, st);
  ctx.globalCompositeOperation = 'multiply';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(lm.canvas, 0, 0, v.w, v.h);
  ctx.globalCompositeOperation = 'source-over';

  // The lit works mirrored faintly in the polished floor.
  if (scene.light === 'spots') {
    for (const item of items) {
      const work = works.get(item.id)!;
      const x = toX(v, item.x);
      const r = Math.max(30, work.mount.w * 0.5) * s;
      const g = ctx.createRadialGradient(x, B + 6 * s, 0, x, B + 6 * s, r);
      g.addColorStop(0, 'rgb(255 236 210 / 0.12)');
      g.addColorStop(1, 'rgb(255 236 210 / 0)');
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(x, B);
      ctx.scale(1, 0.35);
      ctx.translate(-x, -B);
      ctx.fillRect(x - r, B - r, 2 * r, 2 * r * 2);
      ctx.restore();
    }
  }

  // The exit sign stays lit after hours.
  if (scene.light === 'torch') {
    const ex = toX(v, DOOR.x + DOOR.w / 2 - 15);
    const ey = toY(v, DOOR.h + 30);
    ctx.fillStyle = 'rgb(40 220 120 / 0.95)';
    ctx.fillRect(ex, ey, 30 * s, 13 * s);
    if (s > 0.5) {
      ctx.fillStyle = 'rgb(8 40 20)';
      ctx.font = `700 ${8 * s}px ${fonts.text}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('EXIT', ex + 6 * s, ey + 6.8 * s);
    }
  }

  const lightK = scene.light === 'spots' ? 0.62 : scene.light === 'wash' ? 0.95 : 0.12;
  drawBench(ctx, v, scene.bench, lightK);
  drawFigureRoom(ctx, v, scene.person, lightK);

  drawSelection(ctx, v, st, '#7fb3ff');
  drawGuides(ctx, v, st.guides, 'rgb(140 190 255 / 0.85)', fonts);
}

function drawSelection(ctx: CanvasRenderingContext2D, v: View, st: DrawState, color: string) {
  if (st.selected === null) return;
  const item = st.scene.items.find((i) => i.id === st.selected);
  const work = item && st.works.get(item.id);
  if (!item || !work) return;
  const b = boxOf(item, work);
  const pad = 6;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(toX(v, b.x0) - pad, toY(v, b.y1) - pad, (b.x1 - b.x0) * v.s + 2 * pad, (b.y1 - b.y0) * v.s + 2 * pad);
  ctx.setLineDash([]);
}

function drawGuides(ctx: CanvasRenderingContext2D, v: View, guides: Guide[], color: string, fonts: Fonts) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.font = `600 10px ${fonts.text}`;
  for (const g of guides) {
    ctx.beginPath();
    if (g.axis === 'y') {
      const y = Math.round(toY(v, g.at)) + 0.5;
      ctx.moveTo(toX(v, g.from), y);
      ctx.lineTo(toX(v, g.to), y);
    } else {
      const x = Math.round(toX(v, g.at)) + 0.5;
      ctx.moveTo(x, toY(v, g.from));
      ctx.lineTo(x, toY(v, g.to));
    }
    ctx.stroke();
    if (g.label) {
      ctx.textBaseline = 'bottom';
      if (g.axis === 'y') ctx.fillText(g.label, Math.max(6, toX(v, g.from)) + 4, toY(v, g.at) - 3);
      else ctx.fillText(g.label, toX(v, g.at) + 4, toY(v, g.to));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Plan

const INK = '#1f2b33';
const BLUE = '#2a63c9';
const RED = '#c33d25';

function fmt(cm: number): string {
  const r = Math.round(cm * 10) / 10;
  return Number.isInteger(r) ? `${r}` : r.toFixed(1);
}

function dimH(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  y: number,
  text: string,
  fonts: Fonts,
  color = INK,
  above = true,
) {
  if (x1 - x0 < 2) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  for (const x of [x0, x1]) {
    ctx.moveTo(x - 3, y + 3);
    ctx.lineTo(x + 3, y - 3);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
  }
  ctx.stroke();
  ctx.font = `500 10px ${fonts.text}`;
  const tw = ctx.measureText(text).width;
  if (tw + 6 < x1 - x0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = above ? 'bottom' : 'top';
    ctx.fillText(text, (x0 + x1) / 2, above ? y - 2 : y + 3);
    ctx.textAlign = 'left';
  }
}

function dimV(
  ctx: CanvasRenderingContext2D,
  x: number,
  y0: number,
  y1: number,
  text: string,
  fonts: Fonts,
  color = INK,
) {
  if (Math.abs(y1 - y0) < 2) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  for (const y of [y0, y1]) {
    ctx.moveTo(x - 3, y + 3);
    ctx.lineTo(x + 3, y - 3);
    ctx.moveTo(x - 5, y);
    ctx.lineTo(x + 5, y);
  }
  ctx.stroke();
  ctx.font = `500 10px ${fonts.text}`;
  const tw = ctx.measureText(text).width;
  if (tw + 6 < Math.abs(y1 - y0)) {
    ctx.save();
    ctx.translate(x - 3, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, step: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.beginPath();
  for (let i = -h; i < w; i += step) {
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawPlan(ctx: CanvasRenderingContext2D, v: View, st: DrawState) {
  const { scene, works, fonts } = st;
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#eef0eb';
  ctx.fillRect(0, 0, v.w, v.h);
  const s = v.s;
  const L = toX(v, 0);
  const R = toX(v, WALL.w);
  const T = toY(v, WALL.h);
  const B = toY(v, 0);

  // Grid: 10 cm when it's wide enough to read, metres always.
  const grid = (step: number, alpha: number) => {
    if (step * s < 7) return;
    ctx.strokeStyle = `rgb(40 80 110 / ${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = Math.ceil(fromX(v, 0) / step) * step;
    for (let x = x0; toX(v, x) < v.w; x += step) {
      const px = Math.round(toX(v, x)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, v.h);
    }
    const y0 = Math.ceil(fromY(v, v.h) / step) * step;
    for (let y = y0; toY(v, y) > 0; y += step) {
      const py = Math.round(toY(v, y)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(v.w, py);
    }
    ctx.stroke();
  };
  grid(10, 0.06);
  grid(100, 0.14);

  // Wall, floor, and ceiling in section.
  ctx.fillStyle = 'rgb(255 255 255 / 0.55)';
  ctx.fillRect(L, T, R - L, B - T);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.6;
  hatch(ctx, L - 30 * s, B, R - L + 60 * s, 18 * s, 6);
  hatch(ctx, L - 30 * s, T - 18 * s, R - L + 60 * s, 18 * s, 6);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(L - 30 * s, B);
  ctx.lineTo(R + 30 * s, B);
  ctx.moveTo(L - 30 * s, T);
  ctx.lineTo(R + 30 * s, T);
  ctx.stroke();
  ctx.lineWidth = 1.25;
  ctx.strokeRect(L, T, R - L, B - T);

  // The doorway, drawn as an opening.
  const dx = toX(v, DOOR.x);
  const dt = toY(v, DOOR.h);
  ctx.fillStyle = '#eef0eb';
  ctx.fillRect(dx, dt, DOOR.w * s, B - dt);
  ctx.lineWidth = 1;
  ctx.strokeRect(dx, dt, DOOR.w * s, B - dt);
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(dx, B);
  ctx.lineTo(dx + DOOR.w * s, dt);
  ctx.moveTo(dx + DOOR.w * s, B);
  ctx.lineTo(dx, dt);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = INK;
  ctx.font = `600 10px ${fonts.text}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('OPENING', dx + (DOOR.w * s) / 2, dt - 4);
  ctx.textAlign = 'left';

  // Centre line.
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 1;
  ctx.setLineDash([14, 4, 2, 4]);
  ctx.beginPath();
  ctx.moveTo(L - 24 * s, toY(v, CL));
  ctx.lineTo(R + 24 * s, toY(v, CL));
  ctx.stroke();
  ctx.setLineDash([2, 4]);
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(L, toY(v, LOW));
  ctx.lineTo(R, toY(v, LOW));
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = BLUE;
  ctx.font = `600 10px ${fonts.text}`;
  ctx.textBaseline = 'bottom';
  // Tagged just past the opening, or at the view's edge once the wall's start is out of sight.
  ctx.fillText('CL +145', Math.max(toX(v, DOOR.x + DOOR.w) + 6, 8), toY(v, CL) - 3);

  const items = scene.items.filter((i) => works.has(i.id));
  const bad = clashes(scene, works);

  // Works, numbered in the order they went up.
  const number = new Map(items.map((i, n) => [i.id, n + 1]));
  onTop(items, st.selected).forEach((item) => {
    const work = works.get(item.id)!;
    const b = boxOf(item, work);
    if (!visible(v, b, 120)) return;
    const m = work.mount;
    const X = toX(v, b.x0);
    const Y = toY(v, b.y1);
    const W = m.w * s;
    const H = m.h * s;
    const px = X + m.pic.x * s;
    const py = Y + m.pic.y * s;
    const pw = m.pic.w * s;
    const ph = m.pic.h * s;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(X, Y, W, H);
    const img = st.images.get(work, Math.max(pw, ph) * v.dpr);
    if (img) {
      ctx.globalAlpha = 0.8;
      ctx.drawImage(img, px, py, pw, ph);
      ctx.globalAlpha = 1;
      // Drained to ink and paper.
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = '#808080';
      ctx.fillRect(px, py, pw, ph);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgb(214 226 236)';
      ctx.fillRect(px, py, pw, ph);
      ctx.globalCompositeOperation = 'source-over';
    }
    const color = bad.has(item.id) ? RED : item.id === st.selected ? BLUE : INK;
    ctx.strokeStyle = color;
    ctx.lineWidth = item.id === st.selected ? 1.75 : 1.25;
    ctx.strokeRect(X, Y, W, H);
    ctx.lineWidth = 0.6;
    if (m.finish !== 'rod') ctx.strokeRect(px, py, pw, ph);
    if (m.mat) {
      const f = m.frame * s;
      ctx.strokeRect(X + f, Y + f, W - 2 * f, H - 2 * f);
    }
    if (m.finish === 'rod') {
      ctx.beginPath();
      ctx.moveTo(X - 5 * s, Y + 2 * s);
      ctx.lineTo(X + W + 5 * s, Y + 2 * s);
      ctx.stroke();
    }
    // The label, as a box beside the work.
    const lb = labelBox(item, work);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgb(31 43 51 / 0.6)';
    ctx.strokeRect(toX(v, lb.x0), toY(v, lb.y1), (lb.x1 - lb.x0) * s, (lb.y1 - lb.y0) * s);

    // Its number on the checklist.
    const r = 8;
    const nx = X + Math.min(W / 2, Math.max(r + 2, 0));
    const ny = Y - r - 6;
    ctx.fillStyle = color === INK ? '#ffffff' : color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(nx, ny, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color === INK ? INK : '#ffffff';
    ctx.font = `700 9.5px ${fonts.text}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number.get(item.id)), nx, ny + 0.5);
    ctx.textAlign = 'left';

    if (item.id === st.selected) {
      dimH(ctx, X, X + W, Y - 26, fmt(m.w), fonts, BLUE);
      dimV(ctx, X + W + 26 + (lb.x1 - b.x1) * s, Y, Y + H, fmt(m.h), fonts, BLUE);
      dimV(ctx, X - 14, Y + H, B, fmt(b.y0), fonts, BLUE);
      // Height of the centre, the number hangers check first.
      ctx.fillStyle = BLUE;
      ctx.font = `600 10px ${fonts.text}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(`⌖ ${fmt(item.y)}`, X + W + 6, toY(v, item.y));
    }
  });

  // The bench and visitor stand in front of the wall, drawn as an architect's scale figure.
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 0.9;
  const bx = toX(v, scene.bench - BENCH.w / 2);
  ctx.fillRect(bx, toY(v, BENCH.h), BENCH.w * s, (BENCH.h - 34) * s);
  ctx.strokeRect(bx, toY(v, BENCH.h), BENCH.w * s, (BENCH.h - 34) * s);
  for (const lx of [scene.bench - BENCH.w / 2 + 16, scene.bench + BENCH.w / 2 - 20]) {
    ctx.fillRect(toX(v, lx), toY(v, 34), 4 * s, 34 * s);
    ctx.strokeRect(toX(v, lx), toY(v, 34), 4 * s, 34 * s);
  }
  figurePath(ctx, v, scene.person);
  ctx.fill();
  ctx.stroke();
  if (s > 0.55) dimV(ctx, toX(v, scene.person + 34), toY(v, 0), toY(v, 172), '172', fonts, 'rgb(31 43 51 / 0.7)');

  // Running dimensions along the floor: wall end, each group of works, wall end.
  const spans = items
    .map((i) => boxOf(i, works.get(i.id)!))
    .sort((a, b) => a.x0 - b.x0)
    .reduce<[number, number][]>((acc, b) => {
      const last = acc[acc.length - 1];
      if (last && b.x0 <= last[1]) last[1] = Math.max(last[1], b.x1);
      else acc.push([b.x0, b.x1]);
      return acc;
    }, []);
  const stops = [0, ...spans.flat(), WALL.w];
  const chainY = B + 32 * s + 18;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const c = stops[i + 1];
    dimH(ctx, toX(v, a), toX(v, c), chainY, fmt(c - a), fonts, i % 2 === 1 ? INK : 'rgb(31 43 51 / 0.65)', false);
  }
  dimH(ctx, L, R, chainY + 22, `${fmt(WALL.w)} wall`, fonts, INK, false);
  dimV(ctx, R + 36 * s + 14, T, B, fmt(WALL.h), fonts);

  drawGuides(ctx, v, st.guides, BLUE, fonts);
}
