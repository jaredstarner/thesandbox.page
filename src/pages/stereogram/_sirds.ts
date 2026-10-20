// The symmetric autostereogram algorithm of Thimbleby, Inglis, and Witten,
// "Displaying 3D Images: Algorithms for Single-Image Random-Dot Stereograms",
// IEEE Computer 27(10), 1994, including their hidden-surface test.
//
// Depth runs from 0 (the far plane, as far behind the screen as the eyes are
// in front of it) to 1 (the near plane, MU of the way back toward the eyes).
// A point at depth z shows up twice on the screen, once for each eye, a
// separation apart; those two pixels must share a colour. Every row is solved
// on its own: link each pair, then paint right to left so each pixel copies
// the colour of the pixel it is linked to, and free pixels take the texture.

/** Depth of field, as a fraction of the viewing distance (the paper's mu). */
export const MU = 1 / 3;

/** Image stereo separation in pixels for depth z, given the eye separation in pixels. */
export function separation(z: number, eye: number): number {
  return Math.round(((1 - MU * z) * eye) / (2 - MU * z));
}

/** The depth whose separation is exactly s pixels. */
export function depthFor(s: number, eye: number): number {
  return (eye - 2 * s) / (MU * (eye - s));
}

const LEVELS = 4096;

export class Sheet {
  readonly w: number;
  readonly h: number;
  readonly eye: number;
  /** Per pixel, the row index of a pixel to its right that shares its colour, or its own index when free. */
  readonly links: Int32Array;
  private readonly sep = new Int32Array(LEVELS);
  private readonly rise = new Float32Array(LEVELS);
  private readonly reach: number;
  private readonly near: Float32Array;
  private readonly padded: Float32Array;
  private readonly fore: Float32Array;
  private readonly back: Float32Array;

  constructor(w: number, h: number, eye: number) {
    this.w = w;
    this.h = h;
    this.eye = eye;
    this.links = new Int32Array(w * h);
    for (let i = 0; i < LEVELS; i++) {
      const z = i / (LEVELS - 1);
      this.sep[i] = separation(z, eye);
      // How far the line of sight climbs per pixel stepped sideways (the paper's zt).
      this.rise[i] = (2 * (2 - MU * z)) / (MU * eye);
    }
    // The widest the hidden-surface test ever looks, which is at the far plane.
    this.reach = Math.ceil((MU * eye) / 4) + 1;
    const padded = w + 2 * this.reach;
    this.near = new Float32Array(w);
    this.padded = new Float32Array(padded);
    this.fore = new Float32Array(padded);
    this.back = new Float32Array(padded);
  }

  /** Separation of the far plane, where guide dots go. */
  get far(): number {
    return separation(0, this.eye);
  }

  /** Solve every row's constraints for a depth map of w * h values in 0..1. */
  link(depth: Float32Array, hidden = true): void {
    const { w, h, links, sep, rise, near } = this;
    const top = LEVELS - 1;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) links[o + x] = x;
      if (hidden) this.windowMax(depth, o);
      const odd = y & 1;
      for (let x = 0; x < w; x++) {
        const z = depth[o + x];
        const lv = (z * top + 0.5) | 0;
        const s = sep[lv];
        let left = x - ((s + (s & odd)) >> 1);
        let right = left + s;
        if (left < 0 || right >= w) continue;
        if (hidden) {
          const d = rise[lv];
          // Nothing within reach stands taller than the first step of either line of sight: both eyes see it.
          // Otherwise climb both lines of sight; once they pass the tallest thing in reach, nothing can block them.
          const tallest = near[x];
          if (tallest >= z + d) {
            let visible = true;
            let t = 1;
            let zt: number;
            do {
              zt = z + d * t;
              const a = x - t >= 0 ? depth[o + x - t] : 0;
              const b = x + t < w ? depth[o + x + t] : 0;
              visible = a < zt && b < zt;
              t++;
            } while (visible && zt < 1 && zt <= tallest);
            if (!visible) continue;
          }
        }
        // Follow existing links rightward until left is free or already joined to right.
        let k = links[o + left];
        while (k !== left && k !== right) {
          if (k < right) {
            left = k;
          } else {
            left = right;
            right = k;
          }
          k = links[o + left];
        }
        links[o + left] = right;
      }
    }
  }

  /** near[x] = the deepest value (nearest the eyes) within reach of x, by van Herk and Gil-Werman. */
  private windowMax(depth: Float32Array, o: number): void {
    const { w, reach, padded, fore, back, near } = this;
    const n = w + 2 * reach;
    const k = 2 * reach + 1;
    padded.fill(0);
    padded.set(depth.subarray(o, o + w), reach);
    for (let i = 0; i < n; i++) {
      fore[i] = i % k === 0 ? padded[i] : Math.max(fore[i - 1], padded[i]);
    }
    for (let i = n - 1; i >= 0; i--) {
      back[i] = i === n - 1 || (i + 1) % k === 0 ? padded[i] : Math.max(back[i + 1], padded[i]);
    }
    for (let x = 0; x < w; x++) {
      const end = x + k - 1;
      near[x] = Math.max(back[x], end < n ? fore[end] : 0);
    }
  }

  /** Colour the sheet: free pixels take the texture at (x mod texW, y mod texH), the rest copy their link. */
  paint(tex: Uint32Array, texW: number, texH: number, out: Uint32Array): void {
    const { w, h, links } = this;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      const t = (y % texH) * texW;
      let tx = (w - 1) % texW;
      for (let x = w - 1; x >= 0; x--) {
        const k = links[o + x];
        out[o + x] = k === x ? tex[t + tx] : out[o + k];
        tx = tx === 0 ? texW - 1 : tx - 1;
      }
    }
  }
}
