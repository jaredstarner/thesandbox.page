// Flat masks for each /rubbings/ scene, drawn on the main thread where the
// page's fonts are loaded. Every scene is drawn on a 1000-unit square; the
// worker turns the masks into heights (see _compose.ts).

import type { PlaceId } from './_places';
import { rng } from './_field';

export interface Fonts {
  /** The face cut into slate. */
  cut: string;
  /** The face cast in iron. */
  cast: string;
}

export type Masks = Record<string, Uint8Array>;

type Paint = (g: CanvasRenderingContext2D) => void;

class Layers {
  readonly g: CanvasRenderingContext2D;
  constructor(readonly n: number) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = n;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('no 2d context');
    this.g = g;
  }

  draw(paint: Paint): Uint8Array {
    const { g, n } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, n, n);
    g.setTransform(n / 1000, 0, 0, n / 1000, 0, 0);
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    paint(g);
    const data = g.getImageData(0, 0, n, n).data;
    const out = new Uint8Array(n * n);
    for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3];
    return out;
  }
}

const TAU = Math.PI * 2;

function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}

function ring(g: CanvasRenderingContext2D, x: number, y: number, r0: number, r1: number) {
  g.beginPath();
  g.arc(x, y, r1, 0, TAU);
  g.arc(x, y, r0, 0, TAU, true);
  g.fill('evenodd');
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

/**
 * Letters set round a circle. Top arcs read clockwise with their feet toward
 * the centre; bottom arcs read anticlockwise with their heads toward it, so
 * both read left to right.
 */
function arcText(
  g: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  r: number,
  size: number,
  font: string,
  side: 'top' | 'bottom',
  track = 0,
) {
  g.font = `${size}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const chars = [...text];
  const widths = chars.map((c) => g.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
  const mid = side === 'top' ? -Math.PI / 2 : Math.PI / 2;
  let s = -total / 2;
  chars.forEach((c, i) => {
    const arc = s + widths[i] / 2;
    const th = side === 'top' ? mid + arc / r : mid - arc / r;
    g.save();
    g.translate(cx + r * Math.cos(th), cy + r * Math.sin(th));
    g.rotate(side === 'top' ? th + Math.PI / 2 : th - Math.PI / 2);
    g.fillText(c, 0, 0);
    g.restore();
    s += widths[i] + track;
  });
}

/** Centred lines of text with letter spacing, for cut and cast inscriptions. */
function line(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, font: string, track = 0) {
  g.font = `${size}px ${font}`;
  g.textBaseline = 'alphabetic';
  if (!track) {
    g.textAlign = 'center';
    g.fillText(text, x, y);
    return;
  }
  g.textAlign = 'left';
  const chars = [...text];
  const widths = chars.map((c) => g.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
  let cx = x - total / 2;
  chars.forEach((c, i) => {
    g.fillText(c, cx, y);
    cx += widths[i] + track;
  });
}

// 1. A surface-water cover in Mill Lane. One unit is a millimetre.
function cover(L: Layers, fonts: Fonts): Masks {
  const c = 500;
  const masks: Masks = {};
  masks.frame = L.draw((g) => {
    g.fillRect(112, 112, 776, 776);
    g.globalCompositeOperation = 'destination-out';
    disc(g, c, c, 321);
  });
  masks.cover = L.draw((g) => disc(g, c, c, 314));
  masks.cast = L.draw((g) => {
    // The rim, and a bead round the frame's opening and its edge.
    ring(g, c, c, 287, 314);
    ring(g, c, c, 330, 340);
    g.lineWidth = 9;
    g.strokeRect(130, 130, 740, 740);
    for (const [x, y] of [
      [168, 168],
      [832, 168],
      [168, 832],
      [832, 832],
    ]) {
      disc(g, x, y, 13);
    }
    // Four rings of radial studs, staggered.
    const rings = [176, 206, 236, 266];
    rings.forEach((r, k) => {
      const n = Math.round((TAU * r) / 25);
      for (let i = 0; i < n; i++) {
        const a = ((i + (k % 2) * 0.5) / n) * TAU;
        g.save();
        g.translate(c + r * Math.cos(a), c + r * Math.sin(a));
        g.rotate(a);
        g.beginPath();
        g.roundRect(-11, -4.5, 22, 9, 3.5);
        g.fill();
        g.restore();
      }
    });
    // The lettering band's two beads.
    ring(g, c, c, 147, 154);
    ring(g, c, c, 106, 113);
    // Three waves across the boss.
    g.lineWidth = 8;
    for (const dy of [-26, 0, 26]) {
      g.beginPath();
      for (let x = -66; x <= 66; x += 2) {
        const y = c + dy + 5.5 * Math.sin((x / 31) * TAU);
        if (x === -66) g.moveTo(c + x, y);
        else g.lineTo(c + x, y);
      }
      g.stroke();
    }
  });
  masks.letters = L.draw((g) => {
    arcText(g, 'SURFACE WATER', c, c, 120, 31, fonts.cast, 'top', 3);
    arcText(g, 'MILL LANE · 1931', c, c, 141, 31, fonts.cast, 'bottom', 2);
  });
  masks.slots = L.draw((g) => {
    roundRect(g, c - 30, c - 76, 60, 15, 7.5);
    roundRect(g, c - 30, c + 61, 60, 15, 7.5);
  });
  masks.setts = L.draw((g) => {
    const rand = rng(11);
    const rowH = 112;
    for (let row = -1; row < 10; row++) {
      const y = row * rowH + 6;
      const shift = (row % 2) * 100 + rand() * 30;
      for (let x = -220 + shift; x < 1100; ) {
        const w = 180 + rand() * 50;
        const jx = (rand() - 0.5) * 6;
        const jy = (rand() - 0.5) * 6;
        g.beginPath();
        g.roundRect(x + jx, y + jy, w - 13, rowH - 13, 14 + rand() * 10);
        g.fill();
        x += w;
      }
    }
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(100, 100, 800, 800);
  });
  return masks;
}

export function drawMasks(id: PlaceId, n: number, fonts: Fonts): Masks {
  const L = new Layers(n);
  switch (id) {
    case 'cover':
      return cover(L, fonts);
    default:
      return cover(L, fonts);
  }
}

export { line, disc, ring, roundRect };
