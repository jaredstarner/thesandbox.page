// Drawing the trough, the films of colour on it, and the paper they print on.

import type { Blot } from './_engine';
import { GALL, PAPER_HEX, PIGMENTS, SIZE_HEX, rimOf } from './_pigments';

/** Trough units to device pixels: X = ox + x * scale. */
export interface Frame {
  scale: number;
  ox: number;
  oy: number;
}

const RIMS = PIGMENTS.map((p) => rimOf(p.hex));

/** Trace a film as a smooth closed curve through its vertices' midpoints. */
function trace(ctx: CanvasRenderingContext2D, pts: Float64Array): void {
  const n = pts.length / 2;
  const px = pts[(n - 1) * 2];
  const py = pts[(n - 1) * 2 + 1];
  ctx.moveTo((px + pts[0]) / 2, (py + pts[1]) / 2);
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2];
    const y = pts[i * 2 + 1];
    const nx = i === n - 1 ? pts[0] : pts[i * 2 + 2];
    const ny = i === n - 1 ? pts[1] : pts[i * 2 + 3];
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  ctx.closePath();
}

export interface PaintOptions {
  /** Draw as a print: gall shows bare paper, and the sheet is mirrored left to right. */
  print?: { w: number; inset: number };
  /** Device pixels per rim line. */
  rimPx?: number;
}

export function paintBlots(ctx: CanvasRenderingContext2D, blots: Blot[], frame: Frame, opts: PaintOptions = {}): void {
  ctx.save();
  if (opts.print) {
    // Paper laid face down comes up as the trough's mirror image.
    ctx.setTransform(
      -frame.scale,
      0,
      0,
      frame.scale,
      frame.ox + (opts.print.w - opts.print.inset) * frame.scale,
      frame.oy - opts.print.inset * frame.scale,
    );
  } else {
    ctx.setTransform(frame.scale, 0, 0, frame.scale, frame.ox, frame.oy);
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = (opts.rimPx ?? 1) / frame.scale;
  const gallFill = opts.print ? PAPER_HEX : SIZE_HEX;
  for (const b of blots) {
    ctx.beginPath();
    trace(ctx, b.pts);
    if (b.color === GALL) {
      ctx.fillStyle = gallFill;
      ctx.strokeStyle = 'rgba(60, 50, 40, 0.07)';
    } else {
      ctx.fillStyle = PIGMENTS[b.color].hex;
      ctx.strokeStyle = RIMS[b.color];
    }
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A tile of fine, soft noise for pigment grain and paper fibre. */
export function noiseTile(size: number, seed: number, amount: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return c;
  const img = g.createImageData(size, size);
  let s = seed >>> 0;
  for (let i = 0; i < size * size; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const v = 255 - ((s >>> 24) / 255) * amount * 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v * 0.985;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * The galvanised trough with its size, drawn once per layout: a zinc rim with
 * the crystal spangle of hot-dip galvanising, a shaded inner wall, and the
 * milky size with its meniscus.
 */
export function drawTrough(cw: number, ch: number, rim: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d');
  if (!g) return c;
  const outerR = 16 * dpr;
  const innerR = 7 * dpr;

  // Spangle: zinc crystals, each a flat facet that catches the light a little differently.
  const sw = Math.ceil(cw / 2);
  const sh = Math.ceil(ch / 2);
  const sp = document.createElement('canvas');
  sp.width = sw;
  sp.height = sh;
  const sg = sp.getContext('2d');
  if (sg) {
    const cell = 15 * dpr;
    const gx = Math.ceil(sw / cell) + 2;
    const gy = Math.ceil(sh / cell) + 2;
    let seed = 7;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const px = new Float32Array(gx * gy);
    const py = new Float32Array(gx * gy);
    const val = new Float32Array(gx * gy);
    const ang = new Float32Array(gx * gy);
    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        const k = j * gx + i;
        px[k] = (i - 1 + rnd()) * cell;
        py[k] = (j - 1 + rnd()) * cell;
        val[k] = rnd();
        ang[k] = rnd() * Math.PI * 2;
      }
    }
    const img = sg.createImageData(sw, sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const ci = Math.floor(x / cell) + 1;
        const cj = Math.floor(y / cell) + 1;
        let best = 1e18;
        let bk = 0;
        for (let j = cj - 1; j <= cj + 1; j++) {
          for (let i = ci - 1; i <= ci + 1; i++) {
            if (i < 0 || j < 0 || i >= gx || j >= gy) continue;
            const k = j * gx + i;
            const dx = x - px[k];
            const dy = y - py[k];
            const d = dx * dx + dy * dy;
            if (d < best) {
              best = d;
              bk = k;
            }
          }
        }
        // A facet is brighter along its crystal's grain.
        const grain = Math.sin((x * Math.cos(ang[bk]) + y * Math.sin(ang[bk])) * 0.9) * 0.5 + 0.5;
        const v = 156 + val[bk] * 24 + grain * 5;
        const o = (y * sw + x) * 4;
        img.data[o] = v;
        img.data[o + 1] = v + 4;
        img.data[o + 2] = v + 7;
        img.data[o + 3] = 255;
      }
    }
    sg.putImageData(img, 0, 0);
  }

  // The trough's shadow on the bench is the canvas's own CSS box shadow.
  rounded(g, 0, 0, cw, ch, outerR);
  g.fillStyle = '#9ba1a4';
  g.fill();

  g.save();
  rounded(g, 0, 0, cw, ch, outerR);
  g.clip();
  g.imageSmoothingEnabled = true;
  g.drawImage(sp, 0, 0, cw, ch);
  // Light from the window, upper left.
  const lg = g.createLinearGradient(0, 0, cw, ch);
  lg.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
  lg.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  lg.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
  g.fillStyle = lg;
  g.fillRect(0, 0, cw, ch);
  // Rolled outer lip.
  g.lineWidth = 2 * dpr;
  g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  rounded(g, dpr, dpr, cw - 2 * dpr, ch - 2 * dpr, outerR - dpr);
  g.stroke();
  g.restore();

  // Inner wall: the near walls lit, the far walls in shade.
  const ix = rim;
  const iy = rim;
  const iw = cw - rim * 2;
  const ih = ch - rim * 2;
  const wall = rim * 0.45;
  g.save();
  rounded(g, ix - wall, iy - wall, iw + wall * 2, ih + wall * 2, innerR + wall);
  g.fillStyle = '#7d8386';
  g.fill();
  g.clip();
  const wg = g.createLinearGradient(ix - wall, iy - wall, ix + iw + wall, iy + ih + wall);
  wg.addColorStop(0, 'rgba(20, 24, 26, 0.55)');
  wg.addColorStop(0.5, 'rgba(20, 24, 26, 0.15)');
  wg.addColorStop(1, 'rgba(255, 255, 255, 0.25)');
  g.fillStyle = wg;
  g.fillRect(ix - wall, iy - wall, iw + wall * 2, ih + wall * 2);
  g.restore();

  // The size.
  g.save();
  rounded(g, ix, iy, iw, ih, innerR);
  g.fillStyle = SIZE_HEX;
  g.fill();
  g.restore();
  return c;
}

/** Light lying on the wet surface: the meniscus at the walls and a window's soft reflection. */
export function drawSheen(cw: number, ch: number, rim: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d');
  if (!g) return c;
  const ix = rim;
  const iy = rim;
  const iw = cw - rim * 2;
  const ih = ch - rim * 2;
  g.save();
  rounded(g, ix, iy, iw, ih, 7 * dpr);
  g.clip();
  // Depth: the size darkens toward the walls, where the trough's shadow falls in.
  const band = 26 * dpr;
  const edges: [number, number, number, number, number, number, number, number, number][] = [
    [ix, iy, ix, iy + band, ix, iy, iw, band, 0.2],
    [ix, iy, ix + band, iy, ix, iy, band, ih, 0.16],
    [ix, iy + ih, ix, iy + ih - band, ix, iy + ih - band, iw, band, 0.06],
    [ix + iw, iy, ix + iw - band, iy, ix + iw - band, iy, band, ih, 0.06],
  ];
  for (const [x0, y0, x1, y1, rx, ry, rw, rh, a] of edges) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, `rgba(30, 34, 36, ${a})`);
    gr.addColorStop(1, 'rgba(30, 34, 36, 0)');
    g.fillStyle = gr;
    g.fillRect(rx, ry, rw, rh);
  }
  // A window reflected in the far corner, soft because the surface is never quite still.
  g.filter = `blur(${Math.round(36 * dpr)}px)`;
  g.fillStyle = 'rgba(255, 255, 255, 0.12)';
  g.beginPath();
  g.roundRect(ix + iw * 0.6, iy + ih * 0.06, iw * 0.3, ih * 0.34, 20 * dpr);
  g.fill();
  g.filter = 'none';
  g.restore();
  // Meniscus: size climbing the wall catches a thin line of light.
  g.save();
  g.lineWidth = 1.2 * dpr;
  g.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  rounded(g, ix + 1.5 * dpr, iy + 1.5 * dpr, iw - 3 * dpr, ih - 3 * dpr, 6 * dpr);
  g.stroke();
  g.restore();
  return c;
}

/** Laid paper: close wire lines across, chain lines down, and fibre. */
export function paperTexture(w: number, h: number, unit: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return c;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  const laid = Math.max(2, unit * 1.6);
  for (let y = 0; y < h; y += laid) {
    g.fillStyle = 'rgba(120, 100, 70, 0.07)';
    g.fillRect(0, y, w, Math.max(1, laid * 0.4));
  }
  const chain = unit * 30;
  for (let x = chain * 0.4; x < w; x += chain) {
    const gr = g.createLinearGradient(x - unit * 3, 0, x + unit * 3, 0);
    gr.addColorStop(0, 'rgba(120, 100, 70, 0)');
    gr.addColorStop(0.5, 'rgba(120, 100, 70, 0.1)');
    gr.addColorStop(1, 'rgba(120, 100, 70, 0)');
    g.fillStyle = gr;
    g.fillRect(x - unit * 3, 0, unit * 6, h);
  }
  const tile = noiseTile(128, seed, 0.12);
  const pat = g.createPattern(tile, 'repeat');
  if (pat) {
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = pat;
    g.fillRect(0, 0, w, h);
  }
  return c;
}

/** The pulled sheet, mirrored, on laid paper, at `k` pixels per trough unit. */
export function renderPrint(blots: Blot[], tw: number, th: number, inset: number, k: number): HTMLCanvasElement {
  const pw = Math.round((tw - inset * 2) * k);
  const ph = Math.round((th - inset * 2) * k);
  const c = document.createElement('canvas');
  c.width = pw;
  c.height = ph;
  const g = c.getContext('2d');
  if (!g) return c;
  g.fillStyle = PAPER_HEX;
  g.fillRect(0, 0, pw, ph);
  paintBlots(g, blots, { scale: k, ox: 0, oy: 0 }, { print: { w: tw, inset }, rimPx: Math.max(0.8, k * 0.7) });
  // Colour taken up by paper sits a shade softer than it floated.
  g.fillStyle = 'rgba(241, 234, 219, 0.07)';
  g.fillRect(0, 0, pw, ph);
  g.globalCompositeOperation = 'multiply';
  g.drawImage(paperTexture(pw, ph, k, 31), 0, 0);
  g.globalCompositeOperation = 'source-over';
  return c;
}

/** The same sheet as vectors: every vein exact at any size. */
export function printSvg(blots: Blot[], tw: number, th: number, inset: number): string {
  const pw = tw - inset * 2;
  const ph = th - inset * 2;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pw} ${ph}" width="${pw}" height="${ph}">`,
    `<rect width="${pw}" height="${ph}" fill="${PAPER_HEX}"/>`,
    `<g transform="matrix(-1 0 0 1 ${tw - inset} ${-inset})" stroke-width="0.6" stroke-linejoin="round">`,
  );
  for (const b of blots) {
    const n = b.pts.length / 2;
    let d = `M${b.pts[0].toFixed(1)} ${b.pts[1].toFixed(1)}L`;
    for (let i = 1; i < n; i++) d += `${b.pts[i * 2].toFixed(1)} ${b.pts[i * 2 + 1].toFixed(1)} `;
    d += 'Z';
    const fill = b.color === GALL ? PAPER_HEX : PIGMENTS[b.color].hex;
    const stroke = b.color === GALL ? 'none' : RIMS[b.color];
    parts.push(`<path d="${d}" fill="${fill}" stroke="${stroke}"/>`);
  }
  parts.push('</g></svg>');
  return parts.join('');
}

/** Scale a canvas down by halves, so fine veins average out instead of aliasing. */
export function shrink(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const next = document.createElement('canvas');
    next.width = Math.round(cur.width / 2);
    next.height = Math.round(cur.height / 2);
    const g = next.getContext('2d');
    if (!g) break;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d');
  if (g) {
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, w, h);
  }
  return out;
}
