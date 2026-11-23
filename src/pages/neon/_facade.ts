// The shopfront, painted once per size as an albedo map: what each surface is made of, with no
// light on it. The shader lights it. Alpha carries what kind of surface each pixel is, so the
// shader knows what lights it: the street, the sign through the glass, or both.
//
// World units are centimetres: x from the middle of the window, y up from the pavement at the wall.

import type { Plan } from './_plan';

export interface View {
  /** Pixels per centimetre. */
  s: number;
  /** Screen position of the world origin, in canvas pixels. */
  ox: number;
  oy: number;
  w: number;
  h: number;
}

/** Surface classes, written to alpha. */
export const SURFACE = {
  wall: 255,
  frame: 200,
  interior: 128,
  darkGlass: 96,
  ground: 64,
} as const;

export const WINDOW = { x0: -125, x1: 125, y0: 62, y1: 252, transom: 228 };
export const EYE = { h: 160, d: 600 };

/** Fit the scene to a canvas, leaving `inset` pixels on the right for the panel. */
export function frame(w: number, h: number, inset: number): View {
  const side = inset > 0;
  const areaW = w - inset;
  const roi = side ? { x0: -152, x1: 152, y0: -72, y1: 270 } : { x0: -130, x1: 130, y0: -46, y1: 266 };
  const s = Math.min(areaW / (roi.x1 - roi.x0), h / (roi.y1 - roi.y0));
  const cy = (roi.y0 + roi.y1) / 2;
  return { s, ox: areaW / 2, oy: h / 2 + cy * s, w, h };
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

/** Paints albedo on one canvas and the surface class, as grey, on another. */
class Painter {
  constructor(
    readonly c: Ctx,
    readonly k: Ctx | null,
    readonly v: View,
  ) {}
  X(x: number) {
    return this.v.ox + x * this.v.s;
  }
  Y(y: number) {
    return this.v.oy - y * this.v.s;
  }
  /** Run a drawing call on the albedo canvas in `rgb`, and on the class canvas in the class grey. */
  both(rgb: string | CanvasGradient, surface: number, draw: (c: Ctx) => void) {
    this.c.fillStyle = rgb;
    this.c.strokeStyle = rgb;
    draw(this.c);
    if (this.k) {
      const g = `rgb(${surface},${surface},${surface})`;
      this.k.fillStyle = g;
      this.k.strokeStyle = g;
      draw(this.k);
    }
  }
  /** Fill a world rectangle with an albedo colour and a surface class. */
  rect(x0: number, y0: number, x1: number, y1: number, rgb: string, surface: number) {
    const l = Math.round(this.X(Math.min(x0, x1)));
    const r = Math.round(this.X(Math.max(x0, x1)));
    const t = Math.round(this.Y(Math.max(y0, y1)));
    const b = Math.round(this.Y(Math.min(y0, y1)));
    this.both(rgb, surface, (c) => c.fillRect(l, t, r - l, b - t));
  }
  line(x0: number, y0: number, x1: number, y1: number, rgb: string, surface: number, width: number) {
    this.both(rgb, surface, (c) => {
      c.lineWidth = Math.max(1, width * this.v.s);
      c.beginPath();
      c.moveTo(this.X(x0), this.Y(y0));
      c.lineTo(this.X(x1), this.Y(y1));
      c.stroke();
    });
  }
  poly(pts: [number, number][], rgb: string, surface: number) {
    this.both(rgb, surface, (c) => {
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(this.X(x), this.Y(y)) : c.moveTo(this.X(x), this.Y(y))));
      c.closePath();
      c.fill();
    });
  }
}

function shade(rgb: string, k: number, rand = 0): string {
  const n = parseInt(rgb.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k + rand)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Project an interior point at `depth` cm behind the glass onto the window plane. */
function inside(x: number, y: number, depth: number): [number, number] {
  const k = EYE.d / (EYE.d + depth);
  return [x * k, EYE.h + (y - EYE.h) * k];
}

function paintInterior(p: Painter) {
  const W = WINDOW;
  const clip = (c: Ctx) => {
    c.save();
    c.beginPath();
    c.rect(p.X(W.x0), p.Y(W.y1), (W.x1 - W.x0) * p.v.s, (W.y1 - W.y0) * p.v.s);
    c.clip();
  };
  clip(p.c);
  if (p.k) clip(p.k);
  const I = SURFACE.interior;
  // Ceiling and back wall.
  p.rect(W.x0, W.y0, W.x1, W.y1, '#2c2a27', I);
  const [, ceil] = inside(0, 300, 380);
  p.rect(W.x0, ceil, W.x1, W.y1, '#1f1e1c', I);
  const [bx0, by0] = inside(-250, 0, 380);
  const [bx1, by1] = inside(250, 300, 380);
  p.rect(bx0, by0, bx1, by1, '#4a4640', I);
  // A dado rail and the darker wall below it.
  const [, dado] = inside(0, 105, 380);
  p.rect(bx0, by0, bx1, dado, '#34302b', I);
  p.line(bx0, dado, bx1, dado, '#6b655c', I, 0.8);

  // The glass rack on the back wall: long tubes laid across brackets.
  const rand = rng(17);
  for (const [y, count] of [
    [168, 9],
    [196, 8],
    [224, 7],
  ] as const) {
    const [, ry] = inside(0, y, 376);
    for (const xb of [-180, -60, 60, 180]) {
      const [x] = inside(xb, y, 376);
      p.rect(x - 0.8, ry - 4, x + 0.8, ry + 0.5, '#26231f', I);
    }
    for (let i = 0; i < count; i++) {
      const x0 = -230 + rand() * 40;
      const x1 = 200 + rand() * 40;
      const yy = y + 1 + i * 1.4;
      const [ax, ay] = inside(x0, yy, 374 - i);
      const [bx] = inside(x1, yy, 374 - i);
      const tone = ['#a9b4b6', '#b9a59a', '#9fb0c4', '#c4bea0'][i % 4];
      p.line(ax, ay, bx, ay, tone, I, 0.6);
    }
  }

  // Patterns pinned to the wall: pale sheets with the ghost of a drawn letter.
  for (const [x, y, w, h, seed] of [
    [-205, 122, 46, 34, 3],
    [-150, 128, 30, 40, 5],
    [118, 120, 52, 36, 9],
    [180, 132, 34, 30, 11],
  ] as const) {
    const [ax, ay] = inside(x, y, 378);
    const [bx, byy] = inside(x + w, y + h, 378);
    p.rect(ax, ay, bx, byy, '#bdb5a3', I);
    const r2 = rng(seed);
    const loops = [0, 1, 2].map((k) => ({
      cx: ax + (bx - ax) * (0.25 + 0.25 * k),
      cy: (ay + byy) / 2,
      r: (byy - ay) * (0.2 + r2() * 0.1),
      end: Math.PI * (1.2 + r2()),
    }));
    p.both('#5d574d', I, (c) => {
      c.lineWidth = Math.max(1, 0.35 * p.v.s);
      c.beginPath();
      for (const l of loops) {
        c.moveTo(p.X(l.cx + l.r), p.Y(l.cy));
        c.ellipse(p.X(l.cx), p.Y(l.cy), l.r * p.v.s, l.r * p.v.s * 1.3, 0, 0, l.end);
      }
      c.stroke();
    });
  }

  // The bench, a burner on it, and a coil of tubing.
  const [bxa, bya] = inside(-210, 92, 180);
  const [bxb] = inside(70, 92, 180);
  const [, byb] = inside(0, 0, 180);
  p.rect(bxa, byb, bxb, bya, '#191714', I);
  p.rect(bxa, bya - 2.2, bxb, bya, '#5a4a3a', I);
  const [rx0, ry0] = inside(-120, 96, 182);
  const [rx1, ry1] = inside(-60, 104, 182);
  p.rect(rx0, ry0, rx1, ry1, '#3a3836', I);
  for (let i = 0; i < 12; i++) {
    const [jx] = inside(-118 + i * 5, 104, 182);
    p.rect(jx - 0.4, ry1, jx + 0.4, ry1 + 0.8, '#8a7f72', I);
  }
  const [cx0, cy0] = inside(20, 100, 178);
  p.both('#9aa8ab', I, (c) => {
    c.lineWidth = Math.max(1, 0.5 * p.v.s);
    c.beginPath();
    for (let k = 0; k < 3; k++) {
      c.moveTo(p.X(cx0 + 9), p.Y(cy0 + k * 0.7));
      c.ellipse(p.X(cx0), p.Y(cy0 + k * 0.7), 9 * p.v.s, 3 * p.v.s, 0, 0, Math.PI * 2);
    }
    c.stroke();
  });

  // A pendant lamp, switched off.
  const [lx, ly] = inside(70, 212, 150);
  const [, lTop] = inside(70, 300, 150);
  p.line(lx, ly + 8, lx, lTop, '#121110', I, 0.4);
  p.poly(
    [
      [lx - 3, ly + 8],
      [lx + 3, ly + 8],
      [lx + 14, ly],
      [lx - 14, ly],
    ],
    '#1e3a2e',
    I,
  );
  p.rect(lx - 13, ly - 0.8, lx + 13, ly, '#d8d2c2', I);

  // The display bed just inside the glass, seen from above.
  const [, bedBack] = inside(0, 62, 60);
  p.rect(W.x0, W.y0, W.x1, bedBack, '#221d1a', I);
  p.c.restore();
  p.k?.restore();
}

function paintBrick(p: Painter, x0: number, y0: number, x1: number, y1: number) {
  const rand = rng(4242);
  const course = 7.5;
  const len = 22.5;
  p.rect(x0, y0, x1, y1, '#5d574e', SURFACE.wall);
  const base = '#6a3426';
  for (let row = 0; y0 + row * course < y1; row++) {
    const y = y0 + row * course;
    const off = row % 2 ? len / 2 : 0;
    for (let x = x0 - len + off; x < x1; x += len) {
      const k = 0.78 + rand() * 0.38;
      const tint = rand() < 0.08 ? shade('#3e2a24', 1) : shade(base, k, (rand() - 0.5) * 10);
      p.rect(x + 0.5, y + 0.5, x + len - 0.5, y + course - 0.5, tint, SURFACE.wall);
      // A little pitting and a lighter top arris catch the light.
      if (rand() < 0.5) {
        const px = x + 2 + rand() * (len - 5);
        p.rect(px, y + 1.5, px + 1.4, y + 2.6, shade(tint, 0.7), SURFACE.wall);
      }
      p.rect(x + 0.5, y + course - 1.3, x + len - 0.5, y + course - 0.5, shade(tint, 1.12), SURFACE.wall);
    }
  }
}

function paintGround(p: Painter) {
  const G = SURFACE.ground;
  const bottom = -400;
  p.rect(-600, bottom, 600, 0, '#3a3936', G);
  // Paving slabs in perspective: joints every 60 cm in depth and across.
  const yAt = (depth: number) => EYE.h * (1 - EYE.d / (EYE.d - depth));
  const rand = rng(99);
  for (let k = 0; k < 9; k++) {
    const d0 = k * 60 + 6;
    const d1 = d0 + 60;
    const ya = yAt(d0);
    const yb = yAt(d1);
    if (ya < bottom) break;
    const za = EYE.d - d0;
    const zb = EYE.d - d1;
    for (let j = -8; j <= 8; j++) {
      const xa = j * 60 + (k % 2) * 30;
      const xb = xa + 60;
      const tone = shade('#403f3b', 0.85 + rand() * 0.3);
      p.poly(
        [
          [(xa * EYE.d) / za, ya],
          [(xb * EYE.d) / za, ya],
          [(xb * EYE.d) / zb, yb],
          [(xa * EYE.d) / zb, yb],
        ],
        tone,
        G,
      );
    }
    p.line(-900, ya, 900, ya, '#1e1d1b', G, 0.5 + k * 0.25);
  }
  // A gutter of setts along the foot of the wall.
  p.rect(-600, yAt(6), 600, 0, '#2a2927', G);
}

function paintDoor(p: Painter) {
  const F = SURFACE.frame;
  const wood = '#1b2420';
  p.rect(-252, 0, -146, 262, wood, F);
  // Recess shadow, then the door leaf.
  p.rect(-240, 4, -152, 240, '#0d100e', F);
  p.rect(-234, 6, -158, 220, '#22302a', F);
  p.rect(-226, 112, -166, 210, '#070809', SURFACE.darkGlass);
  p.rect(-226, 112, -166, 113.4, '#3d4c45', F);
  p.rect(-226, 30, -198, 100, '#1d2925', F);
  p.rect(-194, 30, -166, 100, '#1d2925', F);
  p.rect(-224, 32, -200, 98, '#26352f', F);
  p.rect(-192, 32, -168, 98, '#26352f', F);
  // Letter plate, knob, and the step.
  p.rect(-206, 104, -186, 108, '#8a6b2e', F);
  p.rect(-224, 92, -219, 97, '#a8853a', F);
  p.rect(-246, 0, -146, 4, '#6d6a63', F);
  // Fanlight with the number painted on it.
  p.rect(-234, 224, -158, 250, '#070809', SURFACE.darkGlass);
  p.rect(-240, 220, -152, 224, wood, F);
}

function paintShopfront(p: Painter, family: string) {
  const W = WINDOW;
  const F = SURFACE.frame;
  const wood = '#1b2420';
  const woodHi = '#2c3a33';
  // Pilasters with console brackets under the fascia's ends.
  for (const [x0, x1] of [
    [-146, -134],
    [134, 146],
    [-264, -252],
  ] as const) {
    p.rect(x0, 0, x1, 266, wood, F);
    p.rect(x0 + 1.5, 10, x0 + 3, 256, woodHi, F);
    p.rect(x0 - 2, 266, x1 + 2, 320, wood, F);
    p.rect(x0 - 1, 300, x1 + 1, 318, woodHi, F);
  }
  // The window frame, with a transom bar and a top light.
  p.rect(-134, 54, 134, 262, wood, F);
  p.rect(-131, 57, 131, 58.5, woodHi, F);
  p.rect(W.x0, W.transom, W.x1, W.transom + 6, wood, F);
  p.rect(W.x0, W.transom + 5, W.x1, W.transom + 6, woodHi, F);
  for (const x of [-42, 42]) p.rect(x - 2.5, W.transom + 6, x + 2.5, W.y1, wood, F);
  // Stone sill.
  p.rect(-144, 47, 144, 55, '#7d7970', F);
  p.rect(-144, 54, 144, 55, '#9a968d', F);
  p.rect(-144, 45.5, 144, 47, '#2a2825', F);
  // Stall riser of glazed tiles over a granite plinth.
  p.rect(-134, 0, 134, 45.5, '#1c1210', F);
  const rand = rng(7);
  for (let y = 8; y < 45; y += 7.6) {
    for (let x = -134; x < 134; x += 15.2) {
      const tone = shade('#5c1e19', 0.85 + rand() * 0.3);
      p.rect(Math.max(-133.5, x + 0.4), y + 0.4, Math.min(133.5, x + 14.8), Math.min(45, y + 7.2), tone, F);
    }
  }
  p.rect(-134, 0, 134, 8, '#262729', F);
  // Fascia and cornice.
  p.rect(-266, 266, 148, 312, '#111815', F);
  p.rect(-264, 268, 146, 270, '#2b2410', F);
  p.rect(-264, 308, 146, 310, '#2b2410', F);
  p.rect(-272, 312, 154, 318, '#4b4a45', F);
  p.rect(-274, 318, 156, 324, '#6e6b63', F);
  p.rect(-272, 311, 154, 312.4, '#0a0b0a', F);

  // Gold leaf on the fascia.
  const c = p.c;
  const size = 26 * p.v.s;
  const text = 'NEON SIGNS  \u00b7  GLASS BENT TO ORDER';
  const setFont = (ctx: Ctx, px: number) => {
    ctx.font = `700 ${px}px ${family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  };
  setFont(c, size);
  if (p.k) setFont(p.k, size);
  // Letter spacing is not on every canvas yet; spread the letters by hand.
  const spacing = 0.12 * size;
  const chars = [...text];
  const widths = chars.map((ch) => c.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - spacing;
  let x = p.X(-59) - total / 2;
  const y = p.Y(289);
  const grad = c.createLinearGradient(0, y - size / 2, 0, y + size / 2);
  grad.addColorStop(0, '#f3d98a');
  grad.addColorStop(0.5, '#b8902f');
  grad.addColorStop(1, '#e8c46a');
  const drop = 0.7 * p.v.s;
  for (let i = 0; i < chars.length; i++) {
    const cx = x + widths[i] / 2 - spacing / 2;
    const ch = chars[i];
    p.both('#070605', F, (ctx) => ctx.fillText(ch, cx + drop, y + drop));
    p.both(grad, F, (ctx) => ctx.fillText(ch, cx, y));
    x += widths[i];
  }
  // The street number on the fanlight.
  setFont(c, 16 * p.v.s);
  if (p.k) setFont(p.k, 16 * p.v.s);
  p.both('#d9b562', F, (ctx) => ctx.fillText('17', p.X(-196), p.Y(237)));

  // A cast-iron downpipe.
  p.rect(176, 0, 186, 330, '#151616', SURFACE.wall);
  p.rect(177.5, 0, 179, 330, '#2b2c2c', SURFACE.wall);
  for (const y of [40, 160, 280]) p.rect(174, y, 188, y + 4, '#1d1e1e', SURFACE.wall);
  p.rect(172, 0, 190, 8, '#151616', SURFACE.wall);
}

/** Paint the street and the shopfront as albedo, for a given view. */
export function paintFacade(c: Ctx, k: Ctx, v: View, family: string) {
  c.clearRect(0, 0, v.w, v.h);
  k.clearRect(0, 0, v.w, v.h);
  const p = new Painter(c, k, v);
  const x0 = -v.ox / v.s - 20;
  const x1 = (v.w - v.ox) / v.s + 20;
  const y1 = v.oy / v.s + 20;
  paintBrick(p, Math.min(x0, -700), 0, Math.max(x1, 700), Math.max(y1, 400));
  paintGround(p);
  paintInterior(p);
  paintShopfront(p, family);
  paintDoor(p);
}

/**
 * Paint what holds the sign up: chains from the head of the window, a black steel frame behind
 * the tubes, and the transformer on the display bed with its cable up to the frame.
 */
export function paintFittings(c: Ctx, v: View, plan: Plan) {
  c.clearRect(0, 0, v.w, v.h);
  if (!plan.bounds) return;
  const p = new Painter(c, null, v);
  const I = SURFACE.interior;
  const b = plan.bounds;
  const pad = 5;
  const fx0 = b.x0 - pad;
  const fx1 = b.x1 + pad;
  const fy0 = b.y0 - pad;
  const fy1 = b.y1 + pad;
  const steel = '#141414';
  // Chains to the transom bar.
  c.strokeStyle = '#57524a';
  c.lineWidth = Math.max(1, 0.3 * v.s);
  for (const x of [fx0 + 12, fx1 - 12]) {
    for (let y = fy1; y < WINDOW.transom; y += 2.6) {
      c.beginPath();
      const odd = Math.round((y - fy1) / 2.6) % 2;
      c.ellipse(p.X(x), p.Y(y + 1.3), (odd ? 0.4 : 0.8) * v.s, 1.5 * v.s, 0, 0, Math.PI * 2);
      c.stroke();
    }
  }
  // The frame: a top and bottom bar, uprights, and a rail behind each row of lettering.
  p.rect(fx0, fy1 - 1.4, fx1, fy1, steel, I);
  p.rect(fx0, fy0, fx1, fy0 + 1.4, steel, I);
  p.rect(fx0, fy0, fx0 + 1.4, fy1, steel, I);
  p.rect(fx1 - 1.4, fy0, fx1, fy1, steel, I);
  for (const r of plan.rows) p.rect(fx0, r.y - 0.6, fx1, r.y + 0.6, steel, I);
  // Supports where the tubes cross a rail: small glass posts.
  for (const u of plan.units) {
    let last = -Infinity;
    let run = 0;
    for (let i = 1; i < u.pts.length; i++) {
      const a = u.pts[i - 1];
      const q = u.pts[i];
      run += Math.hypot(q.x - a.x, q.y - a.y);
      for (const r of plan.rows) {
        if ((a.y - r.y) * (q.y - r.y) <= 0 && run - last > 18) {
          const t = a.y === q.y ? 0 : (r.y - a.y) / (q.y - a.y);
          const x = a.x + (q.x - a.x) * t;
          p.rect(x - 0.9, r.y - 0.9, x + 0.9, r.y + 0.9, '#7f8a8a', I);
          last = run;
        }
      }
    }
  }
  // The transformer and its cable.
  const tx = Math.max(WINDOW.x0 + 24, Math.min(WINDOW.x1 - 24, fx1 - 30));
  p.rect(tx - 16, 63, tx + 16, 77, '#0e0e0f', I);
  p.rect(tx - 16, 76, tx + 16, 77, '#2c2c2e', I);
  p.rect(tx - 7, 68, tx + 4, 73, '#a39f92', I);
  c.strokeStyle = '#8d8a83';
  c.lineWidth = Math.max(1, 0.7 * v.s);
  c.beginPath();
  c.moveTo(p.X(tx + 16), p.Y(70));
  c.bezierCurveTo(p.X(tx + 30), p.Y(72), p.X(fx1 - 4), p.Y(fy0 - 16), p.X(fx1 - 4), p.Y(fy0));
  c.stroke();
}
