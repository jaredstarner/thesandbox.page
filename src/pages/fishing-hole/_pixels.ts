// A low-resolution RGBA pixel layer drawn in world coordinates. The renderer
// uploads it each frame; the shader decides what is underwater.

/** Pack a 0xRRGGBB color (and alpha) into the layer's little-endian RGBA word. */
export function rgb(hex: number, alpha = 255): number {
  return ((alpha << 24) | ((hex & 0xff) << 16) | (hex & 0xff00) | ((hex >> 16) & 0xff)) >>> 0;
}

/** Darken or lighten a 0xRRGGBB color by a factor. */
export function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * k));
  const b = Math.min(255, Math.round((hex & 0xff) * k));
  return (r << 16) | (g << 8) | b;
}

export interface Sprite {
  w: number;
  h: number;
  /** Packed colors, 0 for transparent. */
  px: Uint32Array;
}

/** Build a sprite from rows of characters and a palette; '.' and ' ' are clear. */
export function sprite(rows: string[], palette: Record<string, number>): Sprite {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const px = new Uint32Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = palette[row[x]];
      if (c !== undefined) px[y * w + x] = rgb(c);
    }
  });
  return { w, h, px };
}

export class Layer {
  data = new Uint32Array(0);
  w = 0;
  h = 0;
  /** World coordinates of the layer's top-left pixel. */
  ox = 0;
  oy = 0;

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.data = new Uint32Array(w * h);
  }

  clear(): void {
    this.data.fill(0);
  }

  set(wx: number, wy: number, color: number): void {
    const x = Math.round(wx) - this.ox;
    const y = Math.round(wy) - this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = color;
  }

  /** Add light: brighten what is there by color's channels, for the glow layer. */
  add(wx: number, wy: number, hex: number, k = 1): void {
    const x = Math.round(wx) - this.ox;
    const y = Math.round(wy) - this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    const old = this.data[i];
    const r = Math.min(255, (old & 0xff) + Math.round(((hex >> 16) & 0xff) * k));
    const g = Math.min(255, ((old >> 8) & 0xff) + Math.round(((hex >> 8) & 0xff) * k));
    const b = Math.min(255, ((old >> 16) & 0xff) + Math.round((hex & 0xff) * k));
    this.data[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  rect(wx: number, wy: number, w: number, h: number, color: number): void {
    const x0 = Math.max(0, Math.round(wx) - this.ox);
    const y0 = Math.max(0, Math.round(wy) - this.oy);
    const x1 = Math.min(this.w, Math.round(wx) - this.ox + w);
    const y1 = Math.min(this.h, Math.round(wy) - this.oy + h);
    for (let y = y0; y < y1; y++) this.data.fill(color, y * this.w + x0, y * this.w + Math.max(x0, x1));
  }

  /** A one-pixel line, Bresenham. */
  line(ax: number, ay: number, bx: number, by: number, color: number): void {
    let x0 = Math.round(ax);
    let y0 = Math.round(ay);
    const x1 = Math.round(bx);
    const y1 = Math.round(by);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 2048; guard++) {
      this.set(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Draw a sprite with its top-left at (wx, wy), optionally mirrored. */
  blit(s: Sprite, wx: number, wy: number, flip = false): void {
    const bx = Math.round(wx) - this.ox;
    const by = Math.round(wy) - this.oy;
    for (let y = 0; y < s.h; y++) {
      const ty = by + y;
      if (ty < 0 || ty >= this.h) continue;
      for (let x = 0; x < s.w; x++) {
        const c = s.px[y * s.w + (flip ? s.w - 1 - x : x)];
        if (!c) continue;
        const tx = bx + x;
        if (tx < 0 || tx >= this.w) continue;
        this.data[ty * this.w + tx] = c;
      }
    }
  }
}
