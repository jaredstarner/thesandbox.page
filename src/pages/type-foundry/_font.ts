// Casting: write the cut letters as an OpenType font (CFF outlines) that the browser can
// load and a visitor can install.

import { Font, Glyph as OTGlyph, Path as OTPath } from 'opentype.js';
import { cutAll, describe, type Cut } from './_cut';
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

