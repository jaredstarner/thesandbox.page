// Casting: sweep the pen along every skeleton, space the letters, and write an OpenType
// font (CFF outlines) that the browser can load and a visitor can install.

import { Font, Glyph as OTGlyph, Path as OTPath } from 'opentype.js';
import { sweep, type Pt } from './_pen';
import { ASC, CAP, CHARSET, DESC, build, metrics, type Metrics, type Params } from './_skeleton';

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
  if (ch === ' ') return { ch, strokes: [], dots: [], contours: [], advance: Math.round(0.5 * m.nw + 1.1 * unit + m.ex) };

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

const glyphName = (ch: string): string => {
  if (/^[A-Za-z]$/.test(ch)) return ch;
  const names: Record<string, string> = {
    '0': 'zero',
    '1': 'one',
    '2': 'two',
    '3': 'three',
    '4': 'four',
    '5': 'five',
    '6': 'six',
    '7': 'seven',
    '8': 'eight',
    '9': 'nine',
    ' ': 'space',
  };
  return names[ch] ?? `uni${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
};

export function cast(p: Params, family: string, cuts: Cut[] = cutAll(p)): ArrayBuffer {
  const glyphs: OTGlyph[] = [new OTGlyph({ name: '.notdef', advanceWidth: 500, path: notdef() })];
  for (const c of cuts) {
    const path = new OTPath();
    for (const contour of c.contours) {
      if (contour.length < 3) continue;
      path.moveTo(Math.round(contour[0][0]), Math.round(contour[0][1]));
      for (let i = 1; i < contour.length; i++) path.lineTo(Math.round(contour[i][0]), Math.round(contour[i][1]));
      path.close();
    }
    glyphs.push(
      new OTGlyph({ name: glyphName(c.ch), unicode: c.ch.codePointAt(0)!, advanceWidth: c.advance, path }),
    );
  }
  const font = new Font({
    familyName: family,
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: ASC + 170,
    descender: DESC - 60,
    designer: 'You, with a pen',
    manufacturer: 'Type foundry, thesandbox.page',
    manufacturerURL: 'https://thesandbox.page/type-foundry/',
    version: '1.0',
    description: describe(p),
    glyphs,
  });
  return font.toArrayBuffer();
}

function notdef(): OTPath {
  const p = new OTPath();
  p.moveTo(60, 0);
  p.lineTo(440, 0);
  p.lineTo(440, CAP);
  p.lineTo(60, CAP);
  p.close();
  p.moveTo(110, 50);
  p.lineTo(110, CAP - 50);
  p.lineTo(390, CAP - 50);
  p.lineTo(390, 50);
  p.close();
  return p;
}

const PEN_NAMES = { broad: 'a broad nib', round: 'a round pen', pointed: 'a pointed pen' } as const;

export function describe(p: Params): string {
  const pen =
    p.pen === 'broad' ? `${PEN_NAMES.broad} held at ${Math.round(p.angle)}°` : PEN_NAMES[p.pen];
  const slant = Math.abs(p.slant) < 0.5 ? 'upright' : `leaning ${Math.abs(Math.round(p.slant))}°`;
  return `Cut with ${pen}, ${slant}.`;
}
