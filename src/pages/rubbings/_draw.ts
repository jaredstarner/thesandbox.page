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

/** A canvas font string; `font` may lead with "italic ". */
const fontOf = (size: number, font: string) =>
  font.startsWith('italic ') ? `italic ${size}px ${font.slice(7)}` : `${size}px ${font}`;

/** Centred lines of text with letter spacing, for cut and cast inscriptions. */
function line(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, font: string, track = 0) {
  g.font = fontOf(size, font);
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

/** Shrink a line's size until it fits a width. */
function fit(g: CanvasRenderingContext2D, text: string, size: number, font: string, max: number, track = 0) {
  let s = size;
  for (let k = 0; k < 20; k++) {
    g.font = fontOf(s, font);
    const w = g.measureText(text).width + track * (text.length - 1);
    if (w <= max) break;
    s *= 0.97;
  }
  return s;
}

// 2. A slate headstone. One unit is 0.9 mm.
function stoneOutline(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.moveTo(95, 1010);
  g.lineTo(95, 178);
  g.quadraticCurveTo(95, 150, 124, 150);
  g.lineTo(252, 150);
  g.quadraticCurveTo(266, 150, 270, 136);
  g.bezierCurveTo(330, 44, 670, 44, 730, 136);
  g.quadraticCurveTo(734, 150, 748, 150);
  g.lineTo(876, 150);
  g.quadraticCurveTo(905, 150, 905, 178);
  g.lineTo(905, 1010);
  g.closePath();
}

function hourglass(g: CanvasRenderingContext2D) {
  g.lineWidth = 4;
  // Caps, posts, and the glass.
  g.strokeRect(474, 226, 52, 9);
  g.strokeRect(474, 307, 52, 9);
  g.beginPath();
  g.moveTo(479, 235);
  g.lineTo(479, 307);
  g.moveTo(521, 235);
  g.lineTo(521, 307);
  g.stroke();
  g.beginPath();
  g.moveTo(486, 236);
  g.bezierCurveTo(486, 258, 497, 262, 497, 271);
  g.bezierCurveTo(497, 280, 486, 284, 486, 306);
  g.moveTo(514, 236);
  g.bezierCurveTo(514, 258, 503, 262, 503, 271);
  g.bezierCurveTo(503, 280, 514, 284, 514, 306);
  g.stroke();
  // Sand run through: a heap below, a trickle, a little left above.
  g.beginPath();
  g.moveTo(488, 305);
  g.quadraticCurveTo(500, 284, 512, 305);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(492, 246);
  g.lineTo(508, 246);
  g.lineTo(500, 262);
  g.closePath();
  g.fill();
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(500, 268);
  g.lineTo(500, 290);
  g.stroke();
  // A wing on each side: primaries as long lens-shaped feathers, coverts as scallops.
  for (const side of [-1, 1]) {
    g.save();
    g.translate(500, 0);
    g.scale(side, 1);
    g.translate(-500, 0);
    g.lineWidth = 3.4;
    const rootX = 470;
    const rootY = 262;
    for (let j = 0; j < 7; j++) {
      const a = Math.PI + (-0.5 + j * 0.13);
      const len = 150 - Math.abs(j - 2) * 12;
      const tx = rootX + Math.cos(a) * len;
      const ty = rootY + Math.sin(a) * len * 0.55 + 4;
      const nx = -Math.sin(a) * 9;
      const ny = Math.cos(a) * 6;
      const mx = (rootX + tx) / 2;
      const my = (rootY + ty) / 2 - 8;
      g.beginPath();
      g.moveTo(rootX, rootY);
      g.quadraticCurveTo(mx + nx, my + ny, tx, ty);
      g.quadraticCurveTo(mx - nx, my - ny, rootX, rootY);
      g.stroke();
    }
    for (let row = 0; row < 2; row++) {
      const r = 34 + row * 22;
      for (let k = 0; k < 4 + row; k++) {
        const a = Math.PI + 0.55 - (k / (3 + row)) * 0.95;
        const x = rootX - 4 + Math.cos(a) * r;
        const y = rootY - 6 + Math.sin(a) * r * 0.7;
        g.beginPath();
        g.arc(x, y, 9, Math.PI * 0.15, Math.PI * 0.95);
        g.stroke();
      }
    }
    g.restore();
  }
}

function headstone(L: Layers, fonts: Fonts): Masks {
  const masks: Masks = {};
  masks.stone = L.draw((g) => {
    stoneOutline(g);
    g.fill();
  });
  masks.cut = L.draw((g) => {
    // A double border with notched corners.
    g.lineWidth = 3.4;
    for (const inset of [0, 13]) {
      const x0 = 132 + inset;
      const x1 = 868 - inset;
      const y0 = 190 + inset;
      const k = 22 - inset * 0.6;
      g.beginPath();
      g.moveTo(x0, 1010);
      g.lineTo(x0, y0 + k);
      g.arc(x0, y0, k, Math.PI / 2, 0, true);
      g.lineTo(x1 - k, y0);
      g.arc(x1, y0, k, Math.PI, Math.PI / 2, true);
      g.lineTo(x1, 1010);
      g.stroke();
    }
    hourglass(g);
    const f = fonts.cut;
    line(g, 'IN MEMORY OF', 500, 398, 29, f, 7);
    line(g, 'ANN MARSH', 500, 474, 66, f, 9);
    line(g, 'WIFE OF THOMAS MARSH, MILLER,', 500, 532, fit(g, 'WIFE OF THOMAS MARSH, MILLER,', 29, f, 600, 2), f, 2);
    line(g, 'WHO DEPARTED THIS LIFE', 500, 578, 29, f, 2);
    line(g, 'MARCH 4TH 1798,', 500, 624, 29, f, 2);
    line(g, 'AGED 41 YEARS.', 500, 670, 29, f, 2);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(420, 702);
    g.lineTo(488, 702);
    g.moveTo(512, 702);
    g.lineTo(580, 702);
    g.stroke();
    g.beginPath();
    g.moveTo(500, 694);
    g.lineTo(508, 702);
    g.lineTo(500, 710);
    g.lineTo(492, 702);
    g.closePath();
    g.fill();
    line(g, 'Afflictions sore long time she bore,', 500, 752, 30, `italic ${f}`);
    line(g, 'Physicians were in vain.', 500, 792, 30, `italic ${f}`);
  });
  masks.cut2 = L.draw((g) => {
    const f = fonts.cut;
    line(g, 'ALSO THOMAS HER HUSBAND,', 500, 862, fit(g, 'ALSO THOMAS HER HUSBAND,', 30, f, 560, 4), f, 4);
    line(g, 'DIED NOV. 9 1811, AGED 68.', 500, 904, fit(g, 'DIED NOV. 9 1811, AGED 68.', 30, f, 560, 4), f, 4);
    g.font = `italic 15px ${f}`;
    g.textAlign = 'right';
    g.fillText('J. Hole, sculpt.', 842, 960);
  });
  return masks;
}

// 3. Three leaves on a sandstone flag. One unit is 0.32 mm.
type Pt = [number, number];

interface Leaf {
  blade: Pt[];
  /** Veins as polylines with a width at each point, by order: midrib, secondaries, finer. */
  veins: [Pt[], number[]][][];
}

function quad(a: Pt, c: Pt, b: Pt, steps = 14): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

const taper = (pts: Pt[], w0: number, w1: number) => pts.map((_, i) => w0 + ((w1 - w0) * i) / (pts.length - 1));

/** A pinnate leaf: a midrib, a half-width either side of it, and veins out to the margin. */
function pinnate(kind: 'oak' | 'birch', base: Pt, angle: number, len: number, seed: number): Leaf {
  const rand = rng(seed);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const vx = -uy;
  const vy = ux;
  const petiole = kind === 'oak' ? len * 0.07 : len * 0.32;
  const bend = (rand() - 0.5) * 0.06;
  // Point at fraction t along the blade, offset s across it (left positive).
  const at = (t: number, s: number): Pt => {
    const along = petiole + t * len;
    const off = s + bend * len * Math.sin(Math.PI * t);
    return [base[0] + ux * along + vx * off, base[1] + uy * along + vy * off];
  };
  const N = 320;
  let width: (t: number, side: number) => number;
  let crests: number[][];
  if (kind === 'oak') {
    const m = 5.2;
    const phase = [0.12, 0.58];
    const env = (t: number) => len * 0.34 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.82)), 0.8) * (0.78 + 0.3 * t);
    const lobe = (f: number) => 0.5 + 0.5 * Math.pow(Math.sin(Math.PI * f), 0.42);
    width = (t, side) => {
      const f = (((t * m + phase[side]) % 1) + 1) % 1;
      const aur = t < 0.07 ? 0.08 * len * Math.sin((Math.PI * t) / 0.07) : 0;
      return env(t) * lobe(f) + aur;
    };
    crests = [0, 1].map((side) => {
      const out: number[] = [];
      for (let k = -1; k < 8; k++) {
        const t = (k + 0.5 - phase[side]) / m;
        if (t > 0.1 && t < 0.93) out.push(t);
      }
      return out;
    });
  } else {
    const teeth = 15;
    let peak = 0;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      peak = Math.max(peak, Math.pow(t, 0.5) * Math.pow(1 - t, 1.7));
    }
    const env = (t: number) => (len * 0.34 * Math.pow(t, 0.5) * Math.pow(1 - t, 1.7)) / peak;
    const saw = (f: number) => (f < 0.82 ? f / 0.82 : (1 - f) / 0.18);
    width = (t) => {
      const f1 = (t * teeth) % 1;
      const f2 = (t * teeth * 2) % 1;
      const fade = Math.min(1, t * 6) * Math.min(1, (1 - t) * 5);
      return env(t) + fade * (len * 0.022 * saw(f1) + len * 0.01 * saw(f2));
    };
    crests = [0, 1].map(() => {
      const out: number[] = [];
      for (let k = 1; k < 9; k++) out.push((k + 0.82) / teeth / 1.0 + k * 0.012);
      return out.filter((t) => t > 0.08 && t < 0.86);
    });
  }
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    left.push(at(t, width(t, 0)));
    right.push(at(t, -width(t, 1)));
  }
  const blade = [...right, ...left.reverse()];
  // The midrib runs on down the petiole.
  const mid: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    mid.push(at(t * 0.985, 0));
  }
  const stalk: Pt[] = [base, at(0, 0)];
  const order1: [Pt[], number[]][] = [
    [mid, taper(mid, kind === 'oak' ? 5.2 : 3.6, 1.2)],
    [stalk, [kind === 'oak' ? 6.5 : 3.6, kind === 'oak' ? 6 : 3.6]],
  ];
  const order2: [Pt[], number[]][] = [];
  const order3: [Pt[], number[]][] = [];
  const secs: Pt[][][] = [[], []];
  [0, 1].forEach((side) => {
    const sgn = side === 0 ? 1 : -1;
    for (const t of crests[side]) {
      const w = width(t, side);
      const back = kind === 'oak' ? 0.075 : 0.09;
      const a = at(t - back, 0);
      const b = at(t, sgn * w * (kind === 'oak' ? 0.94 : 0.97));
      const c = kind === 'oak' ? at(t - back * 0.35, sgn * w * 0.45) : at(t - back * 0.45, sgn * w * 0.5);
      const pts = quad(a, c, b);
      secs[side].push(pts);
      order2.push([pts, taper(pts, kind === 'oak' ? 2.6 : 1.9, 0.9)]);
    }
    // Finer veins: across between neighbouring secondaries, and out to the oak's sinuses.
    const list = secs[side];
    for (let k = 0; k + 1 < list.length; k++) {
      for (const s of [0.28, 0.48, 0.68, 0.84]) {
        const p = list[k][Math.round(s * 14)];
        const q = list[k + 1][Math.round(Math.min(1, s * 0.92 + rand() * 0.06) * 14)];
        const m: Pt = [(p[0] + q[0]) / 2 + (rand() - 0.5) * 6, (p[1] + q[1]) / 2 + (rand() - 0.5) * 6];
        const pts = quad(p, m, q, 6);
        order3.push([pts, taper(pts, 1.1, 1.1)]);
      }
      if (kind === 'oak') {
        const tm = (crests[side][k] + crests[side][k + 1]) / 2;
        const pts = quad(at(tm - 0.03, 0), at(tm - 0.01, sgn * width(tm, side) * 0.4), at(tm, sgn * width(tm, side) * 0.86), 8);
        order3.push([pts, taper(pts, 1.4, 0.9)]);
      }
    }
  });
  return { blade, veins: [order1, order2, order3] };
}

/** A field maple: five rounded lobes from one point, a vein to each. */
function palmate(centre: Pt, turn: number, r: number, seed: number): Leaf {
  const rand = rng(seed);
  const lobes = [
    { a: -Math.PI / 2, s: 1, w: 0.42 },
    { a: -Math.PI / 2 + 0.95, s: 0.84, w: 0.4 },
    { a: -Math.PI / 2 - 0.95, s: 0.84, w: 0.4 },
    { a: -Math.PI / 2 + 1.95, s: 0.5, w: 0.36 },
    { a: -Math.PI / 2 - 1.95, s: 0.5, w: 0.36 },
  ];
  const radius = (th: number) => {
    let acc = Math.exp(0.28 * 12);
    for (const l of lobes) {
      let d = th - l.a;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const x = d / l.w;
      if (Math.abs(x) < 1) {
        // A blunt lobe, with two small lobules on its shoulders.
        const v = l.s * Math.sqrt(1 - x * x) * (1 + 0.07 * Math.sin(Math.abs(x) * Math.PI * 2.2));
        acc += Math.exp(v * 12);
      }
    }
    let v = Math.log(acc) / 12;
    const dp = Math.atan2(Math.sin(th - Math.PI / 2), Math.cos(th - Math.PI / 2));
    v *= 1 - 0.75 * Math.exp(-((dp / 0.32) ** 2));
    return v * r;
  };
  const rot = (p: Pt): Pt => {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const dx = p[0] - centre[0];
    const dy = p[1] - centre[1];
    return [centre[0] + dx * c - dy * s, centre[1] + dx * s + dy * c];
  };
  const blade: Pt[] = [];
  for (let i = 0; i < 480; i++) {
    const th = -Math.PI / 2 + (i / 480) * Math.PI * 2;
    const rr = radius(th);
    blade.push(rot([centre[0] + Math.cos(th) * rr, centre[1] + Math.sin(th) * rr]));
  }
  const order1: [Pt[], number[]][] = [];
  const order2: [Pt[], number[]][] = [];
  const order3: [Pt[], number[]][] = [];
  for (const l of lobes) {
    const tip = l.s * r * 0.93;
    const end: Pt = [centre[0] + Math.cos(l.a) * tip, centre[1] + Math.sin(l.a) * tip];
    const ctl: Pt = [
      centre[0] + Math.cos(l.a + 0.06) * tip * 0.5,
      centre[1] + Math.sin(l.a + 0.06) * tip * 0.5,
    ];
    const pts = quad(centre, ctl, end).map(rot);
    order1.push([pts, taper(pts, 3.4 * l.s + 1, 1)]);
    // Secondaries off each primary, out to the lobe's shoulders.
    for (const s of [0.42, 0.66]) {
      for (const sgn of [-1, 1]) {
        const p0: Pt = [centre[0] + Math.cos(l.a) * tip * s, centre[1] + Math.sin(l.a) * tip * s];
        const da = l.a + sgn * (0.55 + rand() * 0.15);
        const reach = radius(l.a + sgn * l.w * 0.7) * 0.9 - tip * s * 0.55;
        const p1: Pt = [p0[0] + Math.cos(da) * reach, p0[1] + Math.sin(da) * reach];
        const pc: Pt = [(p0[0] + p1[0]) / 2 + Math.cos(l.a) * 6, (p0[1] + p1[1]) / 2 + Math.sin(l.a) * 6];
        const sp = quad(p0, pc, p1, 8).map(rot);
        order2.push([sp, taper(sp, 1.6, 0.8)]);
      }
    }
  }
  const sa = rot(centre);
  const sb = rot([centre[0] + 6, centre[1] + r * 0.62]);
  const stalk = quad(sa, [(sa[0] + sb[0]) / 2 + 4, (sa[1] + sb[1]) / 2], sb, 10);
  order1.push([stalk, taper(stalk, 4.4, 3.4)]);
  return { blade, veins: [order1, order2, order3] };
}

function polyFill(g: CanvasRenderingContext2D, pts: Pt[]) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
}

function veinStroke(g: CanvasRenderingContext2D, pts: Pt[], widths: number[]) {
  for (let i = 1; i < pts.length; i++) {
    g.lineWidth = (widths[i - 1] + widths[i]) / 2;
    g.beginPath();
    g.moveTo(pts[i - 1][0], pts[i - 1][1]);
    g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
  }
}

function leaves(L: Layers): Masks {
  const oak = pinnate('oak', [300, 745], -1.0, 455, 31);
  const birch = pinnate('birch', [835, 470], -2.35, 225, 32);
  const maple = palmate([660, 690], 0.35, 150, 33);
  const all = [oak, maple, birch];
  const masks: Masks = {};
  masks.oak = L.draw((g) => polyFill(g, oak.blade));
  masks.maple = L.draw((g) => polyFill(g, maple.blade));
  masks.birch = L.draw((g) => polyFill(g, birch.blade));
  ['v1', 'v2', 'v3'].forEach((key, order) => {
    masks[key] = L.draw((g) => {
      for (const leaf of all) for (const [pts, w] of leaf.veins[order]) veinStroke(g, pts, w);
    });
  });
  masks.joint = L.draw((g) => {
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(-20, 210);
    g.lineTo(330, -20);
    g.stroke();
  });
  return masks;
}

// 5. A penny. One unit is 0.06 mm.
function coin(L: Layers, fonts: Fonts): Masks {
  const c = 500;
  const masks: Masks = {};
  masks.rim = L.draw((g) => ring(g, c, c, 238, 258));
  masks.beads = L.draw((g) => {
    const n = 104;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      disc(g, c + Math.cos(a) * 226, c + Math.sin(a) * 226, 4.6);
    }
  });
  masks.letters = L.draw((g) => {
    arcText(g, 'ONE PENNY', c, c, 176, 44, fonts.cut, 'top', 7);
    arcText(g, '1951', c, c, 214, 40, fonts.cut, 'bottom', 6);
  });
  masks.figure = L.draw((g) => {
    g.translate(c + 6, c - 4);
    // Body and tail.
    g.beginPath();
    g.ellipse(22, -4, 54, 29, -0.42, 0, TAU);
    g.fill();
    g.beginPath();
    g.moveTo(58, 8);
    g.lineTo(96, 44);
    g.lineTo(84, 46);
    g.lineTo(52, 22);
    g.closePath();
    g.fill();
    // The neck in an S, thick at the shoulder.
    g.lineWidth = 15;
    g.beginPath();
    g.moveTo(-12, -20);
    g.bezierCurveTo(-46, -34, -8, -70, -30, -88);
    g.stroke();
    g.lineWidth = 11;
    g.beginPath();
    g.moveTo(-26, -82);
    g.quadraticCurveTo(-34, -94, -40, -98);
    g.stroke();
    // Head and beak.
    g.beginPath();
    g.ellipse(-42, -100, 14, 10, -0.15, 0, TAU);
    g.fill();
    g.beginPath();
    g.moveTo(-50, -106);
    g.lineTo(-118, -92);
    g.lineTo(-52, -95);
    g.closePath();
    g.fill();
  });
  masks.thin = L.draw((g) => {
    g.translate(c + 6, c - 4);
    g.lineWidth = 5;
    // Legs.
    g.beginPath();
    g.moveTo(14, 18);
    g.lineTo(8, 62);
    g.lineTo(4, 100);
    g.moveTo(28, 16);
    g.lineTo(34, 60);
    g.lineTo(36, 100);
    g.stroke();
    // The crest plume, trailing back.
    g.lineWidth = 3.2;
    g.beginPath();
    g.moveTo(-34, -106);
    g.quadraticCurveTo(-14, -118, 6, -110);
    g.stroke();
    // Water.
    g.lineWidth = 4.5;
    for (const [y, x0, x1] of [
      [102, -110, 120],
      [118, -96, 104],
      [133, -70, 76],
    ]) {
      g.beginPath();
      for (let x = x0; x <= x1; x += 3) {
        const yy = y + 3.2 * Math.sin((x / 26) * TAU);
        if (x === x0) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.stroke();
    }
    // Reeds on the left, two with heads.
    const reeds: [number, number, number][] = [
      [-140, -40, -0.1],
      [-124, -82, 0.05],
      [-108, -20, -0.2],
      [-94, -62, 0.12],
    ];
    reeds.forEach(([x, top, lean], k) => {
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x, 104);
      g.quadraticCurveTo(x + lean * 30, (104 + top) / 2, x + lean * 70, top);
      g.stroke();
      if (k % 2 === 1) {
        g.beginPath();
        g.ellipse(x + lean * 64, top + 18, 6.5, 19, lean, 0, TAU);
        g.fill();
      }
    });
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(-120, 104);
    g.quadraticCurveTo(-150, 40, -176, 10);
    g.moveTo(-100, 104);
    g.quadraticCurveTo(-70, 50, -60, 20);
    g.stroke();
  });
  masks.incise = L.draw((g) => {
    g.translate(c + 6, c - 4);
    g.lineWidth = 2.6;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.moveTo(-6 + k * 10, -18 + k * 3);
      g.quadraticCurveTo(28 + k * 6, -12 + k * 5, 62 + k * 3, 6 + k * 6);
      g.stroke();
    }
    disc(g, -46, -102, 2.6);
  });
  return masks;
}

// 6. A notice plate on a canal bridge. One unit is 0.8 mm.
function plate(L: Layers, fonts: Fonts): Masks {
  const masks: Masks = {};
  masks.bricks = L.draw((g) => {
    const rand = rng(61);
    const bw = 269;
    const bh = 81;
    for (let row = -1; row < 14; row++) {
      const y = row * bh;
      const shift = (row % 2) * (bw / 2);
      for (let x = -bw + shift; x < 1100; x += bw) {
        g.beginPath();
        g.roundRect(x + 6 + (rand() - 0.5) * 3, y + 6 + (rand() - 0.5) * 3, bw - 13, bh - 13, 4 + rand() * 4);
        g.fill();
      }
    }
  });
  masks.plate = L.draw((g) => roundRect(g, 100, 255, 800, 490, 14));
  masks.cast = L.draw((g) => {
    g.lineWidth = 12;
    g.beginPath();
    g.roundRect(128, 283, 744, 434, 6);
    g.stroke();
    for (const [x, y] of [
      [160, 315],
      [840, 315],
      [160, 685],
      [840, 685],
    ]) {
      disc(g, x, y, 17);
    }
  });
  masks.letters = L.draw((g) => {
    const f = fonts.cast;
    const rows = ['THIS BRIDGE IS INSUFFICIENT', 'TO CARRY WEIGHTS BEYOND', 'THE ORDINARY TRAFFIC', 'OF THE DISTRICT'];
    const size = fit(g, rows[0], 52, f, 640, 3);
    rows.forEach((r, k) => line(g, r, 500, 372 + k * 72, size, f, 3));
    line(g, 'BY ORDER · 1897', 500, 666, size * 0.62, f, 6);
  });
  return masks;
}

export function drawMasks(id: PlaceId, n: number, fonts: Fonts): Masks {
  const L = new Layers(n);
  switch (id) {
    case 'cover':
      return cover(L, fonts);
    case 'headstone':
      return headstone(L, fonts);
    case 'leaves':
      return leaves(L);
    case 'floor':
      return {};
    case 'coin':
      return coin(L, fonts);
    case 'plate':
      return plate(L, fonts);
  }
}
