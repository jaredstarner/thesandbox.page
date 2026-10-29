// opentype.js 2.0 ships no types; this declares only the font-writing API the page uses.
declare module 'opentype.js' {
  export class Path {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    close(): void;
  }
  export interface GlyphOptions {
    name: string;
    unicode?: number;
    unicodes?: number[];
    advanceWidth: number;
    path: Path;
  }
  export class Glyph {
    constructor(options: GlyphOptions);
  }
  export interface FontOptions {
    familyName: string;
    styleName: string;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    designer?: string;
    designerURL?: string;
    manufacturer?: string;
    manufacturerURL?: string;
    license?: string;
    licenseURL?: string;
    version?: string;
    description?: string;
    copyright?: string;
    trademark?: string;
    glyphs: Glyph[];
  }
  export class Font {
    constructor(options: FontOptions);
    toArrayBuffer(): ArrayBuffer;
  }
}
