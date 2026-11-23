// From words to glass: lay out the lettering, then work out where the tubes run, where a tube has
// to jump between strokes (painted black so it doesn't light), and where one tube ends and the
// next begins with a pair of electrodes. Everything here is in centimetres, y up, on the window.

import { FONT_DATA } from './_fontdata';

export type Style = 'script' | 'sans' | 'square';

export interface Pt {
  x: number;
  y: number;
}

/** A point on a tube; `lit` says whether the segment arriving at this point glows or is blocked out. */
export interface TubePt extends Pt {
  lit: boolean;
}

export interface Unit {
  pts: TubePt[];
  glass: number;
  length: number;
}

export interface LineSpec {
  text: string;
  style: Style;
  glass: number;
}

export interface Stroke {
  pts: Pt[];
  glass: number;
}

export interface Plan {
  units: Unit[];
  /** Total glass, lit and blocked out, in cm. */
  glass: number;
  jumps: number;
  electrodes: number;
  /** Where each line of lettering sits, for the frame rails. */
  rows: { y: number; x0: number; x1: number }[];
  bounds: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** The area of the window the sign may fill. */
export const SIGN_AREA = { x0: -104, x1: 104, y0: 98, y1: 226 };
/** The longest tube the shop will bend in one piece. */
const UNIT_MAX = 240;
/** Strokes closer than this join without a jump. */
const JOIN = 1.4;
/** Longer jumps than this start a new tube instead. */
const JUMP_MAX = 26;
/** No letter taller than this, however short the word. */
const MAX_HEIGHT = 58;

interface Glyph {
  adv: number;
  strokes: Pt[][];
}

const cache: Partial<Record<Style, Map<string, Glyph>>> = {};

function font(style: Style): Map<string, Glyph> {
  const hit = cache[style];
  if (hit) return hit;
  const map = new Map<string, Glyph>();
  for (const [ch, enc] of Object.entries(FONT_DATA[style])) {
    const [adv, body] = enc.split('|');
    const strokes = (body ?? '')
      .split(',')
      .filter(Boolean)
      .map((s) => {
        const n = s.split(' ').map(Number);
        const pts: Pt[] = [];
        for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
        return pts;
      })
      .filter((p) => p.length > 0);
    map.set(ch, { adv: Number(adv), strokes });
  }
  cache[style] = map;
  return map;
}

const STYLE = {
  script: { squeeze: 1, track: 0 },
  sans: { squeeze: 0.86, track: 60 },
  square: { squeeze: 0.86, track: 70 },
} satisfies Record<Style, { squeeze: number; track: number }>;

/** Set a line of text in font units: every stroke, in reading order. */
function setLine(text: string, style: Style): Pt[][] {
  const glyphs = font(style);
  const { squeeze, track } = STYLE[style];
  const out: Pt[][] = [];
  let x = 0;
  for (const ch of text) {
    const g = glyphs.get(ch) ?? glyphs.get('?');
    if (!g) continue;
    for (const s of g.strokes) out.push(s.map((p) => ({ x: (x + p.x) * squeeze, y: p.y })));
    x += g.adv + (ch === ' ' ? 0 : track);
  }
  return out;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function length(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/** Make sure a stroke is long enough to be a tube: a dot becomes a short dash. */
function atLeast(pts: Pt[], min: number): Pt[] {
  if (pts.length >= 2 && length(pts) >= min) return pts;
  const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
  return [
    { x: c.x - min / 2, y: c.y - min * 0.15 },
    { x: c.x + min / 2, y: c.y + min * 0.15 },
  ];
}

/** Split a run of points at a given distance along it. */
function cut(pts: Pt[], at: number): [Pt[], Pt[]] {
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (run + d >= at) {
      const t = (at - run) / d;
      const m = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
      return [[...pts.slice(0, i), m], [m, ...pts.slice(i)]];
    }
    run += d;
  }
  return [pts, []];
}

/** Route strokes of one glass into tubes, in the order given. */
function route(strokes: Pt[][], glass: number, units: Unit[], counts: { jumps: number }) {
  let cur: Unit | null = null;
  const close = () => {
    if (cur && cur.pts.length > 1) units.push(cur);
    cur = null;
  };
  const start = (pts: Pt[]) => {
    cur = { pts: pts.map((p, i) => ({ ...p, lit: i > 0 })), glass, length: length(pts) };
  };
  for (let raw of strokes) {
    raw = atLeast(raw, 1.6);
    // A stroke too long for one tube is cut into pieces.
    const pieces: Pt[][] = [];
    while (length(raw) > UNIT_MAX) {
      const [a, b] = cut(raw, UNIT_MAX * 0.95);
      pieces.push(a);
      raw = b;
    }
    pieces.push(raw);
    for (let pts of pieces) {
      const unit = cur as Unit | null;
      if (!unit) {
        start(pts);
        continue;
      }
      const end = unit.pts[unit.pts.length - 1];
      if (dist(end, pts[pts.length - 1]) < dist(end, pts[0])) pts = [...pts].reverse();
      const gap = dist(end, pts[0]);
      const len = length(pts);
      if (gap <= JOIN && unit.length + len <= UNIT_MAX) {
        for (let i = gap < 0.05 ? 1 : 0; i < pts.length; i++) unit.pts.push({ ...pts[i], lit: true });
        unit.length += gap + len;
      } else if (gap <= JUMP_MAX && unit.length + gap + len <= UNIT_MAX) {
        unit.pts.push({ ...pts[0], lit: false });
        for (let i = 1; i < pts.length; i++) unit.pts.push({ ...pts[i], lit: true });
        unit.length += gap + len;
        counts.jumps++;
      } else {
        close();
        start(pts);
      }
    }
  }
  close();
}

/** Resample and smooth a freehand stroke into something glass can be bent to. */
export function smoothStroke(pts: Pt[]): Pt[] {
  if (pts.length < 2) return pts;
  // Even spacing first, so smoothing treats fast and slow strokes alike.
  const step = 1.2;
  const even: Pt[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = dist(a, b);
    let t = step - carry;
    while (t <= d) {
      even.push({ x: a.x + ((b.x - a.x) * t) / d, y: a.y + ((b.y - a.y) * t) / d });
      t += step;
    }
    carry = d - (t - step);
  }
  even.push(pts[pts.length - 1]);
  // Then a few passes of neighbour averaging, which rounds every bend to a radius glass can take.
  let cur = even;
  for (let pass = 0; pass < 4; pass++) {
    const next = cur.map((p, i) => {
      if (i === 0 || i === cur.length - 1) return p;
      const a = cur[i - 1];
      const b = cur[i + 1];
      return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
    });
    cur = next;
  }
  // Thin to a sensible number of points.
  const out: Pt[] = [cur[0]];
  for (let i = 1; i < cur.length - 1; i++) if (dist(out[out.length - 1], cur[i]) >= 1.6) out.push(cur[i]);
  out.push(cur[cur.length - 1]);
  return out;
}

/** Lay out the whole sign: lettering fitted to the window, plus any freehand strokes. */
export function plan(lines: LineSpec[], drawn: Stroke[]): Plan {
  const units: Unit[] = [];
  const counts = { jumps: 0 };
  const rows: Plan['rows'] = [];
  const set = lines
    .map((l) => ({ spec: l, strokes: setLine(l.text.trim(), l.style) }))
    .filter((l) => l.strokes.length > 0);

  const areaW = SIGN_AREA.x1 - SIGN_AREA.x0;
  const areaH = SIGN_AREA.y1 - SIGN_AREA.y0;
  const gap = 8;
  const slot = set.length > 0 ? (areaH - gap * (set.length - 1)) / set.length : 0;
  const fitted = set.map(({ spec, strokes }) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const s of strokes)
      for (const p of s) {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
    const w = Math.max(x1 - x0, 1);
    const h = Math.max(y1 - y0, 1);
    const k = Math.min(areaW / w, slot / h, MAX_HEIGHT / h);
    return { spec, strokes, x0, y0, w, h, k };
  });
  const total = fitted.reduce((a, f) => a + f.h * f.k, 0) + gap * Math.max(0, fitted.length - 1);
  let top = (SIGN_AREA.y0 + SIGN_AREA.y1) / 2 + total / 2;
  for (const f of fitted) {
    const hh = f.h * f.k;
    const ox = -(f.w * f.k) / 2;
    const oy = top - hh;
    const strokes = f.strokes.map((s) => s.map((p) => ({ x: ox + (p.x - f.x0) * f.k, y: oy + (p.y - f.y0) * f.k })));
    rows.push({ y: oy + hh * 0.45, x0: ox, x1: -ox });
    route(strokes, f.spec.glass, units, counts);
    top -= hh + gap;
  }

  for (const s of drawn) route([s.pts], s.glass, units, counts);

  let glass = 0;
  let bounds: Plan['bounds'] = null;
  for (const u of units) {
    glass += length(u.pts);
    for (const p of u.pts) {
      if (!bounds) bounds = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      else {
        bounds.x0 = Math.min(bounds.x0, p.x);
        bounds.y0 = Math.min(bounds.y0, p.y);
        bounds.x1 = Math.max(bounds.x1, p.x);
        bounds.y1 = Math.max(bounds.y1, p.y);
      }
    }
  }
  return { units, glass, jumps: counts.jumps, electrodes: units.length * 2, rows, bounds };
}
