// Cutting: sweep the pen along every skeleton and space the letters. No font is written
// here, so the page can draw letters without loading the font writer.

import { sweep, type Pt } from './_pen';
import { CHARSET, build, metrics, type Metrics, type Params } from './_skeleton';

export interface Cut {
  ch: string;
  /** Skeleton strokes and dots, already slanted, in final glyph coordinates. */
  strokes: Pt[][];
  dots: Pt[];
  /** Outline contours in final glyph coordinates. */
  contours: Pt[][];
  advance: number;
}

const tanOf = (deg: number) => Math.tan((deg * Math.PI) / 180);

/** Sidebearing unit: a share of n's counter, so spacing follows weight and width. */
function sideUnit(m: Metrics): number {
  return Math.max(14, 0.3 * (m.nw - 2 * m.ex) + 0.18 * m.ex);
}

export function cut(ch: string, p: Params, m: Metrics = metrics(p)): Cut {
  const g = build(ch, m);
  const k = tanOf(p.slant);
  const lean = (pt: Pt): Pt => [pt[0] + pt[1] * k, pt[1]];
  const strokes = g.strokes.map((s) => s.map(lean));
  const dots = g.dots.map(lean);
  const contours: Pt[][] = [];
  for (const s of strokes) contours.push(sweep(s, m.pen));
  for (const dt of dots) contours.push(sweep([dt], m.pen));

  const unit = sideUnit(m);
  if (ch === ' ')
    return { ch, strokes: [], dots: [], contours: [], advance: Math.round(0.5 * m.nw + 1.1 * unit + m.ex) };

  // Space the letter by its bare form, measured along the slant so italics are spaced by
  // their upright extent; serifs and hooks then hang out into the sidebearings, as in type.
  const bare = p.serif === 'none' ? g : build(ch, { ...m, p: { ...p, serif: 'none' } });
  let lo = Infinity;
  let hi = -Infinity;
  const measure = (pts: Pt[]) => {
    for (const [x, y] of pts) {
      const u = x - y * k;
      if (u < lo) lo = u;
      if (u > hi) hi = u;
    }
  };
  for (const s of bare.strokes) measure(sweep(s.map(lean), m.pen));
  for (const dt of bare.dots) measure(sweep([lean(dt)], m.pen));
  const extra = p.serif === 'slab' ? 0.55 * m.s : p.serif === 'hook' ? 0.1 * m.nw : 0;
  const side = (f: number) => unit * f + (f >= 0.75 ? extra * f : 0);
  const left = side(g.side[0]);
  const right = side(g.side[1]);
  const dx = left - lo;
  const shift = (pt: Pt): Pt => [pt[0] + dx, pt[1]];
  return {
    ch,
    strokes: strokes.map((s) => s.map(shift)),
    dots: dots.map(shift),
    contours: contours.map((c) => c.map(shift)),
    advance: Math.round(hi - lo + left + right),
  };
}

export function cutAll(p: Params): Cut[] {
  const m = metrics(p);
  return CHARSET.map((ch) => cut(ch, p, m));
}

const PEN_NAMES = { broad: 'a broad nib', round: 'a round pen', pointed: 'a pointed pen' } as const;

export function describe(p: Params): string {
  const pen = p.pen === 'broad' ? `${PEN_NAMES.broad} held at ${Math.round(p.angle)}°` : PEN_NAMES[p.pen];
  const slant = Math.abs(p.slant) < 0.5 ? 'upright' : `leaning ${Math.abs(Math.round(p.slant))}°`;
  return `Cut with ${pen}, ${slant}.`;
}
