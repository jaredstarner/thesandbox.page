// Casting: write the cut letters as an OpenType font (CFF outlines) that the browser can
// load and a visitor can install.

import ClipperLib from 'clipper-lib';
import { Font, Glyph as OTGlyph, Path as OTPath } from 'opentype.js';
import { cutAll, describe, type Cut } from './_cut';
import type { Pt } from './_pen';
import { ASC, CAP, DESC, type Params } from './_skeleton';

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

/** Fixed-point scale for the union: a quarter of a font unit. */
const Q = 4;

/**
 * Merge a letter's overlapping strokes into clean outlines. Renderers fill the raw
 * overlaps correctly at display sizes, but Windows' text rasterizer leaves hairline
 * seams inside them at reading sizes, and fonts are expected not to overlap.
 */
function union(contours: Pt[][]): Pt[][] {
  const clipper = new ClipperLib.Clipper();
  const paths = contours
    .filter((c) => c.length > 2)
    .map((c) => c.map(([x, y]) => ({ X: Math.round(x * Q), Y: Math.round(y * Q) })));
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const out: { X: number; Y: number }[][] = [];
  clipper.Execute(ClipperLib.ClipType.ctUnion, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out.map((c) => c.map(({ X, Y }) => [X / Q, Y / Q] as Pt));
}

export function cast(p: Params, family: string, cuts: Cut[] = cutAll(p)): ArrayBuffer {
  const glyphs: OTGlyph[] = [new OTGlyph({ name: '.notdef', advanceWidth: 500, path: notdef() })];
  for (const c of cuts) {
    const path = new OTPath();
    for (const contour of union(c.contours)) {
      // Round to whole units, dropping points that land on their neighbour.
      const pts: Pt[] = [];
      for (const [x, y] of contour) {
        const q: Pt = [Math.round(x), Math.round(y)];
        const last = pts[pts.length - 1];
        if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
      }
      if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      if (pts.length < 3) continue;
      path.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
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

