// The skeletons: every character as the centreline a writer's pen would follow, in the
// order and direction it would be written (the ductus), so a pointed pen can swell on
// the downstrokes. Coordinates are font units, baseline at 0. The pen is swept along
// these later; here the lines are pulled in from the metric lines by the pen's own
// reach, so the finished letters, not their skeletons, sit on the baseline.

import { reach, broadNib, type Pen, type Pt } from './_pen';

export type Serif = 'none' | 'hook' | 'slab';

export interface Params {
  pen: Pen['kind'];
  /** Nib width in font units. */
  nib: number;
  /** Broad nib: edge as a share of width. Pointed pen: hairline as a share of the swell. */
  contrast: number;
  /** Broad nib angle, degrees. */
  angle: number;
  /** Slant, degrees. */
  slant: number;
  /** Width of the skeleton, 1 = regular. */
  width: number;
  /** x-height as a share of cap height. */
  xheight: number;
  /** Superellipse exponent of the bowls: 2 is an ellipse, higher is squarer. */
  round: number;
  /** How low the arches spring from the stem: 0 is roman, 1 is italic. */
  branch: number;
  serif: Serif;
}

export const CAP = 680;
export const ASC = 750;
export const DESC = -230;

export interface Metrics {
  p: Params;
  pen: Pen;
  xh: number;
  /** Skeleton lines: baseline, x-line, cap line, ascender, descender. */
  B: number;
  X: number;
  C: number;
  A: number;
  D: number;
  /** Where round skeletons peak, with overshoot. */
  XR: number;
  BR: number;
  CR: number;
  /** Reach of the pen off the skeleton: vertically at stem ends, horizontally on stems. */
  ey: number;
  ex: number;
  /** n's skeleton width and the cap width. */
  nw: number;
  cw: number;
  /** Serif size. */
  s: number;
  /** Superellipse exponent. */
  n: number;
}

export function penOf(p: Params): Pen {
  return { kind: p.pen, width: p.nib, contrast: p.contrast, angle: p.angle, slant: p.slant };
}

export function metrics(p: Params): Metrics {
  const pen = penOf(p);
  const xh = Math.round(CAP * p.xheight);
  let ey: number;
  let ex: number;
  let eyR: number;
  if (p.pen === 'broad') {
    const nib = broadNib(p.nib, p.nib * p.contrast, p.angle);
    ey = reach(nib, 0, 1);
    ex = reach(nib, 1, 0);
    eyR = ey;
  } else if (p.pen === 'round') {
    ey = ex = eyR = p.nib / 2;
  } else {
    const hair = Math.max(p.nib * p.contrast, 4);
    ey = (hair + (p.nib - hair) * 0.35) / 2;
    ex = p.nib / 2;
    eyR = hair / 2;
  }
  const ov = Math.round(CAP * 0.012);
  const nw = p.width * (0.52 * xh + 0.9 * ex);
  const cw = p.width * (0.6 * CAP + 0.8 * ex);
  return {
    p,
    pen,
    xh,
    B: ey,
    X: xh - ey,
    C: CAP - ey,
    A: ASC - ey,
    D: DESC + ey,
    XR: xh - eyR + ov,
    BR: eyR - ov,
    CR: CAP - eyR + ov,
    ey,
    ex,
    nw,
    cw,
    s: 0.16 * nw + 0.3 * ex,
    n: p.round,
  };
}

const spow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A stroke under construction. */
class Path {
  pts: Pt[] = [];
  constructor(
    private g: Glyph,
    x: number,
    y: number,
  ) {
    this.pts.push([x, y]);
  }
  private get last(): Pt {
    return this.pts[this.pts.length - 1];
  }
  to(x: number, y: number): this {
    this.pts.push([x, y]);
    return this;
  }
  /** A superellipse arc from angle a0 to a1 (degrees; a1 < a0 runs clockwise). */
  arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): this {
    const e = 2 / this.g.m.n;
    const span = Math.abs(a1 - a0);
    const per = Math.PI * 2 * Math.sqrt((rx * rx + ry * ry) / 2);
    const steps = Math.max(3, Math.ceil(((span / 360) * per) / 7));
    for (let i = 0; i <= steps; i++) {
      const t = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
      const pt: Pt = [cx + rx * spow(Math.cos(t), e), cy + ry * spow(Math.sin(t), e)];
      if (i === 0 && Math.hypot(pt[0] - this.last[0], pt[1] - this.last[1]) < 0.5) continue;
      this.pts.push(pt);
    }
    return this;
  }
  /** A quadratic curve through a control point. */
  q(cx: number, cy: number, x: number, y: number): this {
    const [x0, y0] = this.last;
    const len = Math.hypot(cx - x0, cy - y0) + Math.hypot(x - cx, y - cy);
    const steps = Math.max(3, Math.ceil(len / 8));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      this.pts.push([u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y]);
    }
    return this;
  }
  end(): void {
    this.g.strokes.push(this.pts);
  }
}

/** Where a stem ends, for serifs. */
type End = 'none' | 'entry' | 'asc' | 'foot' | 'footR' | 'exit' | 'desc' | 'cap' | 'capfoot';

export class Glyph {
  strokes: Pt[][] = [];
  dots: Pt[] = [];
  constructor(
    public m: Metrics,
    /** Spacing on the left and right: 1 beside a stem, less beside a bowl or an open side. */
    public side: [number, number] = [1, 1],
  ) {}

  path(x: number, y: number): Path {
    return new Path(this, x, y);
  }

  line(x0: number, y0: number, x1: number, y1: number): void {
    this.strokes.push([
      [x0, y0],
      [x1, y1],
    ]);
  }

  dot(x: number, y: number): void {
    this.dots.push([x, y]);
  }

  /** The start of a stroke that comes down from (x, top): an italic lead-in in the hook style. */
  lead(x: number, top: number, end: End): Path {
    if (this.m.p.serif === 'hook' && (end === 'entry' || end === 'asc')) {
      const h = 0.3 * this.m.nw;
      return this.path(x - h * 0.95, top - h * 0.55).q(x - h * 0.3, top + h * 0.08, x, top);
    }
    if (this.m.p.serif === 'slab' && (end === 'entry' || end === 'asc')) this.line(x - this.m.s, top, x, top);
    return this.path(x, top);
  }

  /** A vertical stem from top to bottom, with whatever its ends call for in this serif style. */
  stem(x: number, top: number, bot: number, topEnd: End = 'none', botEnd: End = 'none'): void {
    const { m } = this;
    const style = m.p.serif;
    const h = 0.3 * m.nw;
    const p = this.lead(x, top, topEnd);
    if (style === 'hook' && (botEnd === 'exit' || botEnd === 'foot' || botEnd === 'footR')) {
      p.to(x, bot + h * 0.9).q(x + h * 0.05, bot - h * 0.12, x + h, bot + h * 0.4);
    } else p.to(x, bot);
    p.end();
    if (style !== 'slab') return;
    const s = m.s;
    if (topEnd === 'cap') this.line(x - s, top, x + s, top);
    if (botEnd === 'foot' || botEnd === 'desc' || botEnd === 'capfoot') this.line(x - s, bot, x + s, bot);
    if (botEnd === 'footR') this.line(x, bot, x + s, bot);
  }

  /** A small slab centred on a point, for the ends of diagonals. */
  cap(x: number, y: number, k = 0.7): void {
    if (this.m.p.serif === 'slab') this.line(x - this.m.s * k, y, x + this.m.s * k, y);
  }
}

/** The arch of n, h, m: springs from the stem at x0 and comes down the right stem at x1. */
function arch(g: Glyph, x0: number, x1: number, top: number, bot: number, botEnd: End): void {
  const { m } = g;
  const w = x1 - x0;
  const hgt = top - bot;
  const ryR = 0.44 * hgt;
  const ryL = lerp(0.46, 0.74, m.p.branch) * hgt;
  const cx = x0 + w / 2;
  const p = g.path(x0, top - ryL).arc(cx, top - ryL, w / 2, ryL, 180, 90);
  p.arc(cx, top - ryR, w / 2, ryR, 90, 0).end();
  g.stem(x1, top - ryR, bot, 'none', botEnd);
}

/** The bowl of a, d, g, q: from the stem round the left and back. */
function bowlLeft(g: Glyph, x1: number, w: number, top: number, bot: number): void {
  const cy = (top + bot) / 2;
  const ry = (top - bot) / 2;
  const rx = w / 2;
  const cx = x1 - rx;
  g.path(cx + rx * 0.94, cy + ry * 0.62)
    .arc(cx, cy, rx, ry, 30, 330)
    .end();
}

/** The bowl of b and p: from the stem round the right and back. */
function bowlRight(g: Glyph, x0: number, w: number, top: number, bot: number): void {
  const cy = (top + bot) / 2;
  const ry = (top - bot) / 2;
  const rx = w / 2;
  const cx = x0 + rx;
  g.path(cx - rx * 0.94, cy + ry * 0.62)
    .arc(cx, cy, rx, ry, 150, -150)
    .end();
}

/** Angle on a superellipse where it crosses height y (upper right quadrant). */
function angleAt(m: Metrics, cy: number, ry: number, y: number): number {
  const v = Math.min(1, Math.max(0, (y - cy) / ry));
  return (Math.asin(Math.pow(v, m.n / 2)) * 180) / Math.PI;
}

type Draw = (g: Glyph, m: Metrics) => void;

interface Def {
  side: [number, number];
  draw: Draw;
}

const d = (side: [number, number], draw: Draw): Def => ({ side, draw });

const LOWER: Record<string, Def> = {
  a: d([0.8, 1], (g, m) => {
    bowlLeft(g, m.nw, m.nw, m.XR, m.BR);
    g.stem(m.nw, m.X, m.B, 'none', 'footR');
  }),
  b: d([1, 0.8], (g, m) => {
    g.stem(0, m.A, m.B, 'asc', 'none');
    bowlRight(g, 0, m.nw, m.XR, m.BR);
  }),
  c: d([0.8, 0.5], (g, m) => {
    const w = m.nw * 0.96;
    const cy = (m.XR + m.BR) / 2;
    g.path(w / 2 + (w / 2) * 0.8, cy + ((m.XR - m.BR) / 2) * 0.72)
      .arc(w / 2, cy, w / 2, (m.XR - m.BR) / 2, 50, 318)
      .end();
  }),
  d: d([0.8, 1], (g, m) => {
    bowlLeft(g, m.nw, m.nw, m.XR, m.BR);
    g.stem(m.nw, m.A, m.B, 'asc', 'footR');
  }),
  e: d([0.8, 0.6], (g, m) => {
    const w = m.nw * 1.0;
    const cy = (m.XR + m.BR) / 2;
    const ry = (m.XR - m.BR) / 2;
    const yb = cy + ry * 0.12;
    const a = angleAt(m, cy, ry, yb);
    const e = 2 / m.n;
    const xr = w / 2 + (w / 2) * spow(Math.cos((a * Math.PI) / 180), e);
    const xl = w - xr;
    g.path(xl, yb).to(xr, yb).arc(w / 2, cy, w / 2, ry, a, 322).end();
  }),
  f: d([0.9, 0.25], (g, m) => {
    const sx = 0.28 * m.nw;
    const r = 0.3 * m.nw;
    const top = m.A + (m.XR - m.X);
    g.path(sx + r * 1.85, top - r * 0.45)
      .arc(sx + r, top - r * 1.1, r, r * 1.1, 40, 180)
      .to(sx, m.B)
      .end();
    if (m.p.serif === 'slab') g.line(sx - m.s, m.B, sx + m.s, m.B);
    g.line(sx - 0.3 * m.nw, m.X, sx + 0.44 * m.nw, m.X);
  }),
  g: d([0.8, 0.9], (g, m) => {
    bowlLeft(g, m.nw, m.nw, m.XR, m.BR);
    const ry = 0.3 * (m.X - m.B);
    const p = g.path(m.nw, m.X).to(m.nw, m.D + ry);
    p.arc(m.nw / 2, m.D + ry, m.nw / 2, ry + (m.XR - m.X), 0, -165).end();
  }),
  h: d([1, 1], (g, m) => {
    g.stem(0, m.A, m.B, 'asc', 'foot');
    arch(g, 0, m.nw, m.XR, m.B, 'foot');
  }),
  i: d([1, 1], (g, m) => {
    g.stem(0, m.X, m.B, 'entry', 'foot');
    g.dot(0, m.xh + (ASC - m.xh) * 0.42);
  }),
  j: d([0.5, 1], (g, m) => {
    const rx = 0.36 * m.nw;
    const ry = 0.26 * (m.X - m.B);
    g.lead(0, m.X, 'entry')
      .to(0, m.D + ry)
      .arc(-rx, m.D + ry, rx, ry + (m.XR - m.X), 0, -160)
      .end();
    g.dot(0, m.xh + (ASC - m.xh) * 0.42);
  }),
  k: d([1, 0.35], (g, m) => {
    g.stem(0, m.A, m.B, 'asc', 'foot');
    const ax = 0.8 * m.nw;
    const jy = m.B + 0.34 * (m.X - m.B);
    g.line(ax, m.X, 0, jy);
    const t = 0.55;
    g.line(lerp(ax, 0, t), lerp(m.X, jy, t), 0.9 * m.nw, m.B);
    g.cap(ax, m.X);
    g.cap(0.9 * m.nw, m.B);
  }),
  l: d([1, 1], (g, m) => {
    g.stem(0, m.A, m.B, 'asc', 'foot');
  }),
  m: d([1, 1], (g, m) => {
    const w = 0.8 * m.nw;
    g.stem(0, m.X, m.B, 'entry', 'foot');
    arch(g, 0, w, m.XR, m.B, 'foot');
    arch(g, w, 2 * w, m.XR, m.B, 'foot');
  }),
  n: d([1, 1], (g, m) => {
    g.stem(0, m.X, m.B, 'entry', 'foot');
    arch(g, 0, m.nw, m.XR, m.B, 'foot');
  }),
  o: d([0.8, 0.8], (g, m) => {
    const w = m.nw * 1.04;
    const cy = (m.XR + m.BR) / 2;
    g.path(w / 2, m.XR)
      .arc(w / 2, cy, w / 2, (m.XR - m.BR) / 2, 90, 450)
      .end();
  }),
  p: d([1, 0.8], (g, m) => {
    g.stem(0, m.X, m.D, 'entry', 'desc');
    bowlRight(g, 0, m.nw, m.XR, m.BR);
  }),
  q: d([0.8, 1], (g, m) => {
    bowlLeft(g, m.nw, m.nw, m.XR, m.BR);
    g.stem(m.nw, m.X, m.D, 'none', 'desc');
  }),
  r: d([1, 0.3], (g, m) => {
    g.stem(0, m.X, m.B, 'entry', 'foot');
    const w = 0.78 * m.nw;
    const hgt = m.XR - m.B;
    const ryL = lerp(0.46, 0.74, m.p.branch) * hgt;
    const ryR = 0.3 * hgt;
    g.path(0, m.XR - ryL)
      .arc(w / 2, m.XR - ryL, w / 2, ryL, 180, 90)
      .arc(w / 2, m.XR - ryR, w / 2, ryR, 90, 25)
      .end();
  }),
  s: d([0.6, 0.6], (g, m) => {
    const w = 0.84 * m.nw;
    const mid = (m.XR + m.BR) / 2;
    const ry = (m.XR - m.BR) / 4;
    g.path(w / 2 + (w / 2) * 0.86, mid + ry + ry * 0.72)
      .arc(w / 2, mid + ry, (w / 2) * 0.92, ry, 38, 270)
      .arc(w / 2, mid - ry, w / 2, ry, 90, -142)
      .end();
  }),
  t: d([0.6, 0.45], (g, m) => {
    const sx = 0.2 * m.nw;
    const top = m.X + 0.42 * (m.A - m.X);
    g.stem(sx, top, m.B, 'none', 'exit');
    g.line(sx - 0.24 * m.nw, m.X, sx + 0.46 * m.nw, m.X);
  }),
  u: d([1, 1], (g, m) => {
    const hgt = m.X - m.BR;
    const ryL = 0.44 * hgt;
    const ryR = lerp(0.46, 0.74, m.p.branch) * hgt;
    const cx = m.nw / 2;
    g.lead(0, m.X, 'entry')
      .to(0, m.BR + ryL)
      .arc(cx, m.BR + ryL, m.nw / 2, ryL, 180, 270)
      .arc(cx, m.BR + ryR, m.nw / 2, ryR, 270, 360)
      .end();
    g.stem(m.nw, m.X, m.B, 'none', 'footR');
  }),
  v: d([0.35, 0.35], (g, m) => {
    const w = 0.96 * m.nw + 0.3 * m.ex;
    g.path(0, m.X)
      .to(w / 2, m.B - m.ey * 0.3)
      .to(w, m.X)
      .end();
    g.cap(0, m.X);
    g.cap(w, m.X);
  }),
  w: d([0.35, 0.35], (g, m) => {
    const w = 1.46 * m.nw + 0.4 * m.ex;
    g.path(0, m.X)
      .to(w * 0.25, m.B - m.ey * 0.3)
      .to(w * 0.5, m.X - 0.08 * (m.X - m.B))
      .to(w * 0.75, m.B - m.ey * 0.3)
      .to(w, m.X)
      .end();
    g.cap(0, m.X);
    g.cap(w, m.X);
  }),
  x: d([0.35, 0.35], (g, m) => {
    const w = 0.9 * m.nw + 0.3 * m.ex;
    g.line(0, m.X, w, m.B);
    g.line(w, m.X, 0, m.B);
    g.cap(0, m.X);
    g.cap(w, m.X);
    g.cap(0, m.B);
    g.cap(w, m.B);
  }),
  y: d([0.35, 0.35], (g, m) => {
    const w = 0.96 * m.nw + 0.3 * m.ex;
    const k = (m.B - m.D) / (m.X - m.B);
    g.line(0, m.X, w / 2, m.B);
    g.line(w, m.X, w / 2 - (w / 2) * k, m.D);
    g.cap(0, m.X);
    g.cap(w, m.X);
  }),
  z: d([0.55, 0.55], (g, m) => {
    const w = 0.84 * m.nw;
    g.path(0, m.X).to(w, m.X).to(0, m.B).to(w, m.B).end();
  }),
};

const UPPER: Record<string, Def> = {
  A: d([0.3, 0.3], (g, m) => {
    const w = 1.04 * m.cw;
    g.path(0, m.B)
      .to(w / 2, m.C + m.ey * 0.3)
      .to(w, m.B)
      .end();
    const hb = m.B + 0.32 * (m.C - m.B);
    const t = (hb - m.B) / (m.C - m.B);
    g.line((w / 2) * t, hb, w - (w / 2) * t, hb);
    g.cap(0, m.B, 0.9);
    g.cap(w, m.B, 0.9);
  }),
  B: d([1.15, 0.85], (g, m) => {
    const w = 0.84 * m.cw;
    const mid = m.B + 0.54 * (m.C - m.B);
    g.stem(0, m.C, m.B, 'cap', 'capfoot');
    const ry1 = (m.C - mid) / 2;
    const ry2 = (mid - m.B) / 2;
    const w1 = 0.88 * w;
    g.path(0, m.C)
      .to(w1 - ry1, m.C)
      .arc(w1 - ry1, m.C - ry1, ry1, ry1, 90, -90)
      .to(0, mid)
      .end();
    g.path(0, mid)
      .to(w - ry2, mid)
      .arc(w - ry2, mid - ry2, ry2, ry2, 90, -90)
      .to(0, m.B)
      .end();
  }),
  C: d([0.85, 0.5], (g, m) => {
    const w = 1.0 * m.cw;
    const cy = (m.CR + m.BR) / 2;
    const ry = (m.CR - m.BR) / 2;
    g.path(w / 2 + (w / 2) * 0.82, cy + ry * 0.7)
      .arc(w / 2, cy, w / 2, ry, 48, 318)
      .end();
  }),
  D: d([1.15, 0.85], (g, m) => {
    const w = 1.04 * m.cw;
    const ry = (m.C - m.B) / 2;
    const rx = Math.min(w * 0.62, ry * 1.1);
    g.stem(0, m.C, m.B, 'cap', 'capfoot');
    g.path(0, m.C)
      .to(w - rx, m.C)
      .arc(w - rx, m.C - ry, rx, ry + (m.CR - m.C), 90, -90)
      .to(0, m.B)
      .end();
  }),
  E: d([1.15, 0.5], (g, m) => {
    const w = 0.74 * m.cw;
    const mid = m.B + 0.52 * (m.C - m.B);
    g.path(w, m.C).to(0, m.C).to(0, m.B).to(w * 1.03, m.B).end();
    g.line(0, mid, w * 0.86, mid);
    if (m.p.serif === 'slab') {
      g.line(0, m.C, -m.s, m.C);
      g.line(0, m.B, -m.s, m.B);
    }
  }),
  F: d([1.15, 0.4], (g, m) => {
    const w = 0.72 * m.cw;
    const mid = m.B + 0.5 * (m.C - m.B);
    g.path(w, m.C).to(0, m.C).to(0, m.B).end();
    g.line(0, mid, w * 0.84, mid);
    if (m.p.serif === 'slab') {
      g.line(-m.s, m.C, 0, m.C);
      g.line(-m.s, m.B, m.s, m.B);
    }
  }),
  G: d([0.85, 0.9], (g, m) => {
    const w = 1.02 * m.cw;
    const cy = (m.CR + m.BR) / 2;
    const ry = (m.CR - m.BR) / 2;
    const yb = m.B + 0.44 * (m.C - m.B);
    const end = -angleAt(m, cy, ry, cy + (cy - m.BR) * 0.2);
    const e = 2 / m.n;
    const xe = w / 2 + (w / 2) * spow(Math.cos((end * Math.PI) / 180), e);
    g.path(w / 2 + (w / 2) * 0.82, cy + ry * 0.7)
      .arc(w / 2, cy, w / 2, ry, 48, 360 + end)
      .to(xe, yb)
      .to(xe - 0.32 * w, yb)
      .end();
  }),
  H: d([1.15, 1.15], (g, m) => {
    const w = 0.96 * m.cw;
    g.stem(0, m.C, m.B, 'cap', 'capfoot');
    g.stem(w, m.C, m.B, 'cap', 'capfoot');
    const mid = m.B + 0.52 * (m.C - m.B);
    g.line(0, mid, w, mid);
  }),
  I: d([1.15, 1.15], (g, m) => {
    g.stem(0, m.C, m.B, 'cap', 'capfoot');
  }),
  J: d([0.5, 1.1], (g, m) => {
    const w = 0.56 * m.cw;
    const ry = 0.3 * (m.C - m.B);
    g.path(w, m.C)
      .to(w, m.B + ry)
      .arc(w / 2, m.BR + ry, w / 2, ry, 0, -165)
      .end();
    if (m.p.serif === 'slab') g.line(w - m.s, m.C, w + m.s, m.C);
  }),
  K: d([1.15, 0.35], (g, m) => {
    const w = 0.9 * m.cw;
    g.stem(0, m.C, m.B, 'cap', 'capfoot');
    const jy = m.B + 0.32 * (m.C - m.B);
    g.line(w, m.C, 0, jy);
    const t = 0.5;
    g.line(lerp(w, 0, t), lerp(m.C, jy, t), w * 1.04, m.B);
    g.cap(w, m.C);
    g.cap(w * 1.04, m.B);
  }),
  L: d([1.15, 0.4], (g, m) => {
    const w = 0.72 * m.cw;
    g.path(0, m.C).to(0, m.B).to(w, m.B).end();
    if (m.p.serif === 'slab') g.line(-m.s, m.C, m.s, m.C);
  }),
  M: d([1.05, 1.05], (g, m) => {
    const w = 1.2 * m.cw;
    g.path(0, m.B)
      .to(0.04 * w, m.C)
      .to(w / 2, m.B)
      .to(0.96 * w, m.C)
      .to(w, m.B)
      .end();
    g.cap(0, m.B);
    g.cap(w, m.B);
  }),
  N: d([1.1, 1.1], (g, m) => {
    const w = 0.98 * m.cw;
    g.path(0, m.B).to(0, m.C).to(w, m.B).to(w, m.C).end();
    g.cap(0, m.B);
    g.cap(w, m.C);
  }),
  O: d([0.85, 0.85], (g, m) => {
    const w = 1.12 * m.cw;
    const cy = (m.CR + m.BR) / 2;
    g.path(w / 2, m.CR)
      .arc(w / 2, cy, w / 2, (m.CR - m.BR) / 2, 90, 450)
      .end();
  }),
  P: d([1.15, 0.7], (g, m) => {
    const w = 0.86 * m.cw;
    const mid = m.B + 0.46 * (m.C - m.B);
    const ry = (m.C - mid) / 2;
    g.stem(0, m.C, m.B, 'cap', 'capfoot');
    g.path(0, m.C)
      .to(w - ry, m.C)
      .arc(w - ry, m.C - ry, ry, ry, 90, -90)
      .to(0, mid)
      .end();
  }),
  Q: d([0.85, 0.85], (g, m) => {
    const w = 1.12 * m.cw;
    const cy = (m.CR + m.BR) / 2;
    g.path(w / 2, m.CR)
      .arc(w / 2, cy, w / 2, (m.CR - m.BR) / 2, 90, 450)
      .end();
    g.line(w * 0.52, m.B + 0.14 * (m.C - m.B), w * 0.98, m.B - 0.16 * (m.C - m.B));
  }),
  R: d([1.15, 0.4], (g, m) => {
    const w = 0.88 * m.cw;
    const mid = m.B + 0.48 * (m.C - m.B);
    const ry = (m.C - mid) / 2;
    g.stem(0, m.C, m.B, 'cap', 'capfoot');
    g.path(0, m.C)
      .to(w - ry, m.C)
      .arc(w - ry, m.C - ry, ry, ry, 90, -90)
      .to(0, mid)
      .end();
    g.line(w * 0.42, mid, w * 1.02, m.B);
    g.cap(w * 1.02, m.B);
  }),
  S: d([0.6, 0.6], (g, m) => {
    const w = 0.82 * m.cw;
    const mid = (m.CR + m.BR) / 2 + 0.02 * (m.C - m.B);
    const ryU = (m.CR - mid) / 2;
    const ryL = (mid - m.BR) / 2;
    g.path(w / 2 + (w / 2) * 0.84, mid + ryU + ryU * 0.72)
      .arc(w / 2, mid + ryU, (w / 2) * 0.92, ryU, 38, 270)
      .arc(w / 2, mid - ryL, w / 2, ryL, 90, -142)
      .end();
  }),
  T: d([0.4, 0.4], (g, m) => {
    const w = 0.92 * m.cw;
    g.line(0, m.C, w, m.C);
    g.stem(w / 2, m.C, m.B, 'none', 'capfoot');
    if (m.p.serif === 'slab') {
      g.line(0, m.C, 0, m.C - m.s);
      g.line(w, m.C, w, m.C - m.s);
    }
  }),
  U: d([1.1, 1.1], (g, m) => {
    const w = 0.98 * m.cw;
    const ry = 0.4 * (m.C - m.B);
    g.path(0, m.C)
      .to(0, m.BR + ry)
      .arc(w / 2, m.BR + ry, w / 2, ry, 180, 360)
      .to(w, m.C)
      .end();
    g.cap(0, m.C);
    g.cap(w, m.C);
  }),
  V: d([0.3, 0.3], (g, m) => {
    const w = 1.0 * m.cw;
    g.path(0, m.C)
      .to(w / 2, m.B - m.ey * 0.3)
      .to(w, m.C)
      .end();
    g.cap(0, m.C);
    g.cap(w, m.C);
  }),
  W: d([0.3, 0.3], (g, m) => {
    const w = 1.46 * m.cw;
    g.path(0, m.C)
      .to(w * 0.24, m.B - m.ey * 0.3)
      .to(w * 0.5, m.C)
      .to(w * 0.76, m.B - m.ey * 0.3)
      .to(w, m.C)
      .end();
    g.cap(0, m.C);
    g.cap(w, m.C);
  }),
  X: d([0.3, 0.3], (g, m) => {
    const w = 0.96 * m.cw;
    g.line(0, m.C, w, m.B);
    g.line(w, m.C, 0, m.B);
    g.cap(0, m.C);
    g.cap(w, m.C);
    g.cap(0, m.B);
    g.cap(w, m.B);
  }),
  Y: d([0.3, 0.3], (g, m) => {
    const w = 0.96 * m.cw;
    const jy = m.B + 0.46 * (m.C - m.B);
    g.line(0, m.C, w / 2, jy);
    g.line(w, m.C, w / 2, jy);
    g.stem(w / 2, jy, m.B, 'none', 'capfoot');
    g.cap(0, m.C);
    g.cap(w, m.C);
  }),
  Z: d([0.5, 0.5], (g, m) => {
    const w = 0.88 * m.cw;
    g.path(0, m.C).to(w, m.C).to(0, m.B).to(w, m.B).end();
  }),
};

const FIGURES: Record<string, Def> = {
  '0': d([0.8, 0.8], (g, m) => {
    const w = 0.8 * m.cw;
    const cy = (m.CR + m.BR) / 2;
    g.path(w / 2, m.CR)
      .arc(w / 2, cy, w / 2, (m.CR - m.BR) / 2, 90, 450)
      .end();
  }),
  '1': d([0.8, 0.8], (g, m) => {
    const w = 0.7 * m.cw;
    const x = w * 0.55;
    g.path(x - 0.36 * w, m.C - 0.2 * (m.C - m.B))
      .to(x, m.C)
      .to(x, m.B)
      .end();
    if (m.p.serif === 'slab') g.line(x - m.s * 1.2, m.B, x + m.s * 1.2, m.B);
  }),
  '2': d([0.7, 0.7], (g, m) => {
    const w = 0.76 * m.cw;
    const ry = 0.28 * (m.C - m.B);
    g.path(w / 2 - (w / 2) * 0.9, m.CR - ry + ry * 0.5)
      .arc(w / 2, m.CR - ry, w / 2, ry, 150, -36)
      .to(0, m.B)
      .to(w * 1.02, m.B)
      .end();
  }),
  '3': d([0.65, 0.75], (g, m) => {
    const w = 0.74 * m.cw;
    const mid = m.B + 0.56 * (m.C - m.B);
    const ryU = (m.CR - mid) / 2;
    const ryL = (mid - m.BR) / 2;
    g.path(w / 2 - (w / 2) * 0.86, m.CR - ryU + ryU * 0.55)
      .arc(w / 2, mid + ryU, (w / 2) * 0.88, ryU, 145, -90)
      .end();
    g.path(w * 0.42, mid)
      .arc(w / 2, mid - ryL, w / 2, ryL, 90, -150)
      .end();
  }),
  '4': d([0.5, 0.7], (g, m) => {
    const w = 0.8 * m.cw;
    const yb = m.B + 0.3 * (m.C - m.B);
    g.path(w * 0.72, m.B)
      .to(w * 0.72, m.C)
      .to(0, yb)
      .to(w, yb)
      .end();
    if (m.p.serif === 'slab') g.line(w * 0.72 - m.s, m.B, w * 0.72 + m.s, m.B);
  }),
  '5': d([0.7, 0.75], (g, m) => {
    const w = 0.76 * m.cw;
    const ry = 0.32 * (m.C - m.B);
    const cy = m.BR + ry;
    const a = 140;
    const e = 2 / m.n;
    const jx = w / 2 + (w / 2) * spow(Math.cos((a * Math.PI) / 180), e);
    const jy = cy + ry * spow(Math.sin((a * Math.PI) / 180), e);
    g.path(w * 0.9, m.C)
      .to(w * 0.18, m.C)
      .to(jx, jy)
      .arc(w / 2, cy, w / 2, ry, a, -150)
      .end();
  }),
  '6': d([0.8, 0.75], (g, m) => {
    const w = 0.78 * m.cw;
    const ry = 0.3 * (m.C - m.B);
    const cy = m.BR + ry;
    g.path(w * 0.86, m.C)
      .q(w * 0.02, m.C - 0.12 * (m.C - m.B), 0, cy)
      .arc(w / 2, cy, w / 2, ry, 180, 540)
      .end();
  }),
  '7': d([0.6, 0.5], (g, m) => {
    const w = 0.74 * m.cw;
    g.path(0, m.C).to(w, m.C).to(w * 0.3, m.B).end();
  }),
  '8': d([0.75, 0.75], (g, m) => {
    const w = 0.78 * m.cw;
    const mid = m.B + 0.55 * (m.C - m.B);
    const ryU = (m.CR - mid) / 2;
    const ryL = (mid - m.BR) / 2;
    g.path(w / 2, m.CR)
      .arc(w / 2, mid + ryU, (w / 2) * 0.86, ryU, 90, 450)
      .end();
    g.path(w / 2, mid)
      .arc(w / 2, mid - ryL, w / 2, ryL, 90, 450)
      .end();
  }),
  '9': d([0.75, 0.8], (g, m) => {
    const w = 0.78 * m.cw;
    const ry = 0.3 * (m.C - m.B);
    const cy = m.CR - ry;
    g.path(w, cy)
      .arc(w / 2, cy, w / 2, ry, 0, 360)
      .q(w * 0.98, m.B + 0.12 * (m.C - m.B), w * 0.14, m.B)
      .end();
  }),
};

const PUNCT: Record<string, Def> = {
  ' ': d([0, 0], () => {}),
  '.': d([0.7, 0.7], (g, m) => g.dot(0, m.ey)),
  ',': d([0.7, 0.7], (g, m) => comma(g, m, 0, m.ey)),
  ':': d([0.7, 0.7], (g, m) => {
    g.dot(0, m.ey);
    g.dot(0, m.xh - m.ey);
  }),
  ';': d([0.7, 0.7], (g, m) => {
    comma(g, m, 0, m.ey);
    g.dot(0, m.xh - m.ey);
  }),
  '!': d([0.8, 0.8], (g, m) => {
    g.line(0, m.C, 0, m.B + 0.3 * (m.C - m.B));
    g.dot(0, m.ey);
  }),
  '?': d([0.6, 0.6], (g, m) => {
    const w = 0.6 * m.cw;
    const ry = 0.24 * (m.C - m.B);
    g.path(w / 2 - (w / 2) * 0.9, m.CR - ry + ry * 0.5)
      .arc(w / 2, m.CR - ry, w / 2, ry, 150, -70)
      .to(w * 0.5, m.B + 0.3 * (m.C - m.B))
      .end();
    g.dot(w * 0.5, m.ey);
  }),
  "'": d([0.8, 0.8], (g, m) => g.line(0, m.C, 0, m.C - 0.24 * (m.C - m.B))),
  '"': d([0.8, 0.8], (g, m) => {
    const gap = 0.26 * m.nw + m.ex;
    g.line(0, m.C, 0, m.C - 0.24 * (m.C - m.B));
    g.line(gap, m.C, gap, m.C - 0.24 * (m.C - m.B));
  }),
  '‘': d([0.8, 0.8], (g, m) => turned(g, m, 0)),
  '’': d([0.8, 0.8], (g, m) => comma(g, m, 0, m.C - 0.1 * (m.C - m.B))),
  '“': d([0.8, 0.8], (g, m) => {
    turned(g, m, 0);
    turned(g, m, 0.3 * m.nw + m.ex * 1.6);
  }),
  '”': d([0.8, 0.8], (g, m) => {
    comma(g, m, 0, m.C - 0.1 * (m.C - m.B));
    comma(g, m, 0.3 * m.nw + m.ex * 1.6, m.C - 0.1 * (m.C - m.B));
  }),
  '-': d([0.6, 0.6], (g, m) => g.line(0, m.xh * 0.46, 0.5 * m.nw, m.xh * 0.46)),
  '–': d([0.4, 0.4], (g, m) => g.line(0, m.xh * 0.46, 1.1 * m.nw, m.xh * 0.46)),
  '(': d([0.9, 0.5], (g, m) => {
    const rx = 0.5 * m.nw;
    const cy = (m.A + m.D) / 2;
    g.path(rx + rx * 0.55, m.A)
      .arc(rx * 2.2, cy, rx * 2.2, (m.A - m.D) / 2, 112, 248)
      .end();
  }),
  ')': d([0.5, 0.9], (g, m) => {
    const rx = 0.5 * m.nw;
    const cy = (m.A + m.D) / 2;
    g.path(0, m.A)
      .arc(-rx * 1.2, cy, rx * 2.2, (m.A - m.D) / 2, 68, -68)
      .end();
  }),
  '[': d([1, 0.5], (g, m) => {
    const w = 0.34 * m.nw;
    g.path(w, m.A).to(0, m.A).to(0, m.D).to(w, m.D).end();
  }),
  ']': d([0.5, 1], (g, m) => {
    const w = 0.34 * m.nw;
    g.path(0, m.A).to(w, m.A).to(w, m.D).to(0, m.D).end();
  }),
  '/': d([0.3, 0.3], (g, m) => g.line(0, m.D, 0.62 * m.nw, m.A)),
  '\\': d([0.3, 0.3], (g, m) => g.line(0, m.A, 0.62 * m.nw, m.D)),
  '|': d([1, 1], (g, m) => g.line(0, m.A, 0, m.D)),
  '+': d([0.6, 0.6], (g, m) => {
    const w = mathW(m);
    const y = AXIS;
    g.line(0, y, w, y);
    g.line(w / 2, y + w / 2, w / 2, y - w / 2);
  }),
  '=': d([0.6, 0.6], (g, m) => {
    const w = mathW(m);
    const y = AXIS;
    const gap = 0.1 * CAP + m.ey * 0.6;
    g.line(0, y + gap, w, y + gap);
    g.line(0, y - gap, w, y - gap);
  }),
  '*': d([0.6, 0.6], (g, m) => {
    const r = 0.2 * CAP;
    const cy = m.C - r;
    for (let i = 0; i < 3; i++) {
      const a = (Math.PI / 2) + (i * Math.PI) / 3;
      g.line(r - Math.cos(a) * r, cy - Math.sin(a) * r, r + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  }),
  '<': d([0.5, 0.6], (g, m) => {
    const w = mathW(m) * 0.9;
    const y = AXIS;
    g.path(w, y + w * 0.5).to(0, y).to(w, y - w * 0.5).end();
  }),
  '>': d([0.6, 0.5], (g, m) => {
    const w = mathW(m) * 0.9;
    const y = AXIS;
    g.path(0, y + w * 0.5).to(w, y).to(0, y - w * 0.5).end();
  }),
  '#': d([0.5, 0.5], (g, m) => {
    const w = 0.84 * m.nw;
    const top = m.C - 0.1 * (m.C - m.B);
    const bot = m.B + 0.05 * (m.C - m.B);
    g.line(w * 0.36, top, w * 0.22, bot);
    g.line(w * 0.78, top, w * 0.64, bot);
    const y1 = bot + 0.32 * (top - bot);
    const y2 = bot + 0.68 * (top - bot);
    g.line(0, y1, w, y1);
    g.line(w * 0.06, y2, w * 1.04, y2);
  }),
  '%': d([0.6, 0.6], (g, m) => {
    const r = 0.17 * m.cw;
    const w = 0.92 * m.cw;
    g.path(r, m.CR)
      .arc(r, m.CR - r * 1.1, r, r * 1.1, 90, 450)
      .end();
    g.path(w - r, m.BR + r * 2.2)
      .arc(w - r, m.BR + r * 1.1, r, r * 1.1, 90, 450)
      .end();
    g.line(w * 0.86, m.C, w * 0.14, m.B);
  }),
  $: d([0.6, 0.6], (g, m) => {
    const w = 0.76 * m.cw;
    const mid = (m.CR + m.BR) / 2;
    const ryU = (m.CR - m.BR) / 4 - 0.04 * m.xh;
    const ryL = (m.CR - m.BR) / 4 - 0.04 * m.xh;
    g.path(w / 2 + (w / 2) * 0.84, mid + ryU + ryU * 0.72)
      .arc(w / 2, mid + ryU, (w / 2) * 0.92, ryU, 38, 270)
      .arc(w / 2, mid - ryL, w / 2, ryL, 90, -142)
      .end();
    g.line(w / 2, m.C + 0.08 * m.xh, w / 2, m.B - 0.08 * m.xh);
  }),
  '&': d([0.75, 0.4], (g, m) => {
    const w = 0.92 * m.cw;
    const ry = 0.2 * (m.C - m.B);
    const cy = m.CR - ry;
    const lry = 0.27 * (m.C - m.B);
    const lcy = m.BR + lry;
    g.path(w * 1.02, m.B)
      .to(w * 0.22, cy - ry * 0.7)
      .arc(w * 0.38, cy, w * 0.2, ry, 225, 90)
      .arc(w * 0.38, cy, w * 0.2, ry, 90, -50)
      .to(w * 0.12, lcy + lry * 0.6)
      .arc(w * 0.42, lcy, w * 0.4, lry, 150, 270)
      .q(w * 0.76, m.BR, w * 0.98, m.B + 0.42 * (m.C - m.B))
      .end();
  }),
  '@': d([0.8, 0.8], (g, m) => {
    const R = 0.62 * m.cw;
    const cy = (m.C + m.D * 0.6) / 2;
    const rx = 0.3 * m.cw;
    const ry = 0.24 * (m.C - m.B);
    const sx = R + rx * 0.9;
    g.path(sx, cy + ry * 0.4)
      .arc(R, cy, rx, ry, 20, 340)
      .end();
    g.path(sx, cy + ry)
      .to(sx, cy - ry * 0.9)
      .q(sx + R * 0.4, cy - ry * 1.3, R * 2, cy)
      .arc(R, cy, R, R * 0.95, 0, 300)
      .end();
  }),
  '^': d([0.5, 0.5], (g, m) => {
    const w = mathW(m);
    g.path(0, m.C - 0.36 * (m.C - m.B)).to(w / 2, m.C).to(w, m.C - 0.36 * (m.C - m.B)).end();
  }),
  _: d([0.2, 0.2], (g, m) => g.line(0, m.D * 0.5, 0.9 * m.nw, m.D * 0.5)),
  '`': d([0.6, 0.6], (g, m) => g.line(0, m.C, 0.18 * m.nw, m.C - 0.16 * (m.C - m.B))),
  '~': d([0.5, 0.5], (g, m) => {
    const w = mathW(m);
    const y = AXIS;
    const a = 0.08 * m.xh;
    const p = g.path(0, y - a * 0.6);
    for (let i = 1; i <= 20; i++) {
      const t = i / 20;
      p.to(t * w, y + Math.sin(t * Math.PI * 2 - Math.PI * 0.3) * a);
    }
    p.end();
  }),
  '{': d([0.8, 0.5], (g, m) => {
    const w = 0.4 * m.nw;
    const cy = (m.A + m.D) / 2;
    const h = m.A - m.D;
    g.path(w, m.A)
      .q(w * 0.35, m.A, w * 0.4, m.A - 0.12 * h)
      .to(w * 0.4, cy + 0.08 * h)
      .q(w * 0.4, cy, 0, cy)
      .q(w * 0.4, cy, w * 0.4, cy - 0.08 * h)
      .to(w * 0.4, m.D + 0.12 * h)
      .q(w * 0.35, m.D, w, m.D)
      .end();
  }),
  '}': d([0.5, 0.8], (g, m) => {
    const w = 0.4 * m.nw;
    const cy = (m.A + m.D) / 2;
    const h = m.A - m.D;
    g.path(0, m.A)
      .q(w * 0.65, m.A, w * 0.6, m.A - 0.12 * h)
      .to(w * 0.6, cy + 0.08 * h)
      .q(w * 0.6, cy, w, cy)
      .q(w * 0.6, cy, w * 0.6, cy - 0.08 * h)
      .to(w * 0.6, m.D + 0.12 * h)
      .q(w * 0.65, m.D, 0, m.D)
      .end();
  }),
};

/** Width of the arithmetic signs, and the height they centre on. */
function mathW(m: Metrics): number {
  return 0.36 * CAP * m.p.width + 0.6 * m.ex;
}
const AXIS = CAP * 0.36;

function comma(g: Glyph, m: Metrics, x: number, y: number): void {
  g.dot(x, y);
  const len = 0.22 * m.xh + m.ey;
  g.path(x + m.ex * 0.15, y)
    .q(x + m.ex * 0.2, y - len * 0.5, x - 0.12 * m.nw, y - len)
    .end();
}

/** An opening quote: a comma turned upside down. */
function turned(g: Glyph, m: Metrics, x: number): void {
  const y = m.C - 0.22 * (m.C - m.B) + m.ey;
  g.dot(x, y);
  const len = 0.22 * m.xh + m.ey;
  g.path(x - m.ex * 0.15, y)
    .q(x - m.ex * 0.2, y + len * 0.5, x + 0.12 * m.nw, y + len)
    .end();
}

export const DEFS: Record<string, Def> = { ...LOWER, ...UPPER, ...FIGURES, ...PUNCT };

export const CHARSET = Object.keys(DEFS);

export function build(ch: string, m: Metrics): Glyph {
  const def = DEFS[ch];
  const g = new Glyph(m, def.side);
  def.draw(g, m);
  return g;
}
