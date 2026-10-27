// Heights and colours for each /rubbings/ scene, built in the worker from the
// masks _draw.ts made. Heights are millimetres; colours are sRGB bytes.

import type { PlaceId } from './_places';
import type { Masks } from './_draw';
import { blur, clamp, distanceTo, fbm, mix, smoothstep } from './_field';

export interface Surface {
  /** Height in millimetres. */
  h: Float32Array;
  /** Paints colour and gloss once the worker knows where the hollows are (`cav`, 0 to 1). */
  paint(cav: Float32Array): { rgb: Uint8Array; gloss: Uint8Array };
}

export interface Ctx {
  n: number;
  /** Millimetres per pixel. */
  mm: number;
  masks: Masks;
}

/** Distance in pixels from inside a mask to its edge (0 outside), nudged by the antialiased edge. */
export function inside(mask: Uint8Array, n: number): Float32Array {
  const d = distanceTo(n, n, (i) => mask[i] < 128);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] >= 128 ? d[i] - 0.5 : 0;
  return d;
}

/** A mask's coverage as 0 to 1. */
export function cover01(mask: Uint8Array): Float32Array {
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] / 255;
  return out;
}

const srgb = (v: number) => {
  const c = clamp(v);
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
};

/** Write a linear colour as sRGB bytes. */
export function put(rgb: Uint8Array, i: number, r: number, g: number, b: number) {
  rgb[i * 3] = srgb(r);
  rgb[i * 3 + 1] = srgb(g);
  rgb[i * 3 + 2] = srgb(b);
}

// 1. The surface-water cover.
function cover({ n, mm, masks }: Ctx): Surface {
  const h = new Float32Array(n * n);
  const frame = inside(masks.frame, n);
  const lid = cover01(masks.cover);
  const cast = inside(masks.cast, n);
  const letters = inside(masks.letters, n);
  const slots = inside(masks.slots, n);
  const setts = inside(masks.setts, n);
  const grit = fbm(n, n, 6 / mm, 3, 21);
  const pits = fbm(n, n, 3 / mm, 2, 22);
  const rough = fbm(n, n, 30 / mm, 4, 23);
  const half = n / 2;
  const coverR = 0.314; // as a fraction of the scene
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const fx = (x - half) / n;
      const fy = (y - half) / n;
      const r = Math.hypot(fx, fy) / coverR;
      let v: number;
      const inFrame = Math.abs(fx) < 0.388 && Math.abs(fy) < 0.388;
      if (lid[i] > 0.02) {
        v = 1.6 * (1 - r * r);
        v += 5.5 * smoothstep(0, 2.4, cast[i] * mm);
        v += 4.2 * smoothstep(0, 1.3, letters[i] * mm);
        v -= 15 * smoothstep(0, 2, slots[i] * mm);
        v -= 0.35 * smoothstep(0.25, 0.7, pits[i]);
        v = mix(-30, v, lid[i]);
      } else if (frame[i] > 0) {
        v = 0.4 + 5.5 * smoothstep(0, 2.4, cast[i] * mm) - 0.3 * smoothstep(0.3, 0.7, pits[i]);
        v -= 2 * (1 - smoothstep(0, 2.5, frame[i] * mm));
      } else if (inFrame) {
        v = -30;
      } else {
        const top = smoothstep(0, 26, setts[i] * mm);
        v = -5 + 3.2 * top + 0.9 * rough[i] * top;
        v = mix(-16 + 1.5 * grit[i], v, smoothstep(0, 4, setts[i] * mm));
      }
      h[i] = v;
    }
  return {
    h,
    paint(cav) {
      const rgb = new Uint8Array(n * n * 3);
      const gloss = new Uint8Array(n * n);
      const speck = fbm(n, n, 1.6 / mm, 2, 24);
      const tone = fbm(n, n, 80 / mm, 3, 25);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const c = cav[i];
          const fx = (x - half) / n;
          const fy = (y - half) / n;
          const iron = lid[i] > 0.5 || frame[i] > 0;
          if (iron) {
            const rust = smoothstep(0.15, 0.7, c + 0.25 * tone[i] + 0.15 * grit[i]);
            const worn = smoothstep(0.08, 0.0, c);
            let r = mix(0.05, 0.16, rust);
            let g = mix(0.048, 0.075, rust);
            let b = mix(0.046, 0.035, rust);
            r = mix(r, 0.12, worn * 0.7);
            g = mix(g, 0.12, worn * 0.7);
            b = mix(b, 0.125, worn * 0.7);
            put(rgb, i, r, g, b);
            gloss[i] = Math.round(255 * worn * 0.8);
          } else if (Math.abs(fx) < 0.388 && Math.abs(fy) < 0.388) {
            put(rgb, i, 0.01, 0.009, 0.008);
          } else {
            const joint = 1 - smoothstep(0, 3, setts[i] * mm);
            const s = speck[i];
            let r = 0.22 + 0.06 * tone[i];
            let g = 0.215 + 0.06 * tone[i];
            let b = 0.21 + 0.055 * tone[i];
            const fleck = smoothstep(0.25, 0.45, s) * 0.12 - smoothstep(-0.25, -0.45, s) * 0.12;
            r += fleck;
            g += fleck;
            b += fleck * 0.9;
            r = mix(r, 0.09 + 0.03 * grit[i], joint);
            g = mix(g, 0.075 + 0.03 * grit[i], joint);
            b = mix(b, 0.06 + 0.02 * grit[i], joint);
            put(rgb, i, r, g, b);
            gloss[i] = 0;
          }
        }
      return { rgb, gloss };
    },
  };
}

export function compose(id: PlaceId, ctx: Ctx): Surface {
  switch (id) {
    case 'cover':
      return cover(ctx);
    default:
      return cover(ctx);
  }
}

export { blur };
