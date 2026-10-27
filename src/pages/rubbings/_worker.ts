// The surface half of /rubbings/: turns a scene's masks into heights, lights
// the thing under the paper, and works out what the paper will feel: how far
// each point sits below the crayon as it rides the high spots, how the sheet
// drapes, and the paper's own tooth.

import { compose } from './_compose';
import type { Masks } from './_draw';
import { placeById, LIGHT, type PlaceId } from './_places';
import { blur, clamp, dilate, fbm, sample } from './_field';

export interface Request {
  type: 'build';
  id: PlaceId;
  n: number;
  masks: Masks;
}

export interface Built {
  type: 'built';
  id: PlaceId;
  n: number;
  /** The scene, lit, as RGBA. */
  scene: Uint8ClampedArray;
  pw: number;
  ph: number;
  /** In paper pixels: how far below the crayon's riding plane each point lies, in millimetres. */
  gap: Float32Array;
  /** In paper pixels: the drape's light, -127 to 127 around flat. */
  drape: Int8Array;
  /** In paper pixels: the paper's tooth, 0 (valley) to 255 (peak). */
  tooth: Uint8Array;
  /** In paper pixels: the scene's colour under the sheet, for thin paper. */
  under: Uint8Array;
  ms: number;
}

const post = (m: Built, transfer: Transferable[]) =>
  (self as unknown as { postMessage(m: Built, t: Transferable[]): void }).postMessage(m, transfer);

const toLin = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const toSrgb = (v: number) => {
  const c = clamp(v);
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
};

/** How strongly each scene's relief is drawn in the light, beyond its true slope. */
const EXAGGERATE: Record<PlaceId, number> = {
  cover: 1.2,
  headstone: 1.4,
  leaves: 6,
  floor: 5,
  coin: 5,
  plate: 1.3,
};

function build(req: Request) {
  const t0 = performance.now();
  const place = placeById(req.id);
  const { n } = req;
  const mm = (place.sceneCm * 10) / n;
  const surface = compose(req.id, { n, mm, masks: req.masks });
  const { h } = surface;

  // The crayon rides the high spots: lift the surface to the highest point
  // within its bridging reach, then soften that riding plane.
  const reach = place.bridge / mm;
  const ride = blur(dilate(h, n, n, reach), n, n, reach * 0.5, 2);

  // Hollows, for colour and ambient light: how far below a broad riding plane.
  const broad = blur(dilate(h, n, n, (place.bridge * 3) / mm), n, n, (place.bridge * 2) / mm, 2);
  const cav = new Float32Array(n * n);
  const deep = place.reach[1] * 4;
  for (let i = 0; i < cav.length; i++) cav[i] = clamp((broad[i] - h[i]) / deep);

  const { rgb, gloss } = surface.paint(cav);

  // Light the scene.
  const ex = EXAGGERATE[req.id];
  const [lx, ly, lz] = LIGHT;
  const hx = lx;
  const hy = ly;
  const hz = lz + 1;
  const hl = Math.hypot(hx, hy, hz);
  const scene = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    const y0 = Math.max(0, y - 1) * n;
    const y1 = Math.min(n - 1, y + 1) * n;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(n - 1, x + 1);
      const dx = ((h[y * n + x1] - h[y * n + x0]) / (2 * mm)) * ex;
      const dy = ((h[y1 + x] - h[y0 + x]) / (2 * mm)) * ex;
      const nl = Math.hypot(dx, dy, 1);
      const nx = -dx / nl;
      const ny = -dy / nl;
      const nz = 1 / nl;
      const diff = Math.max(0, nx * lx + ny * ly + nz * lz);
      const amb = 0.42 * (1 - 0.75 * cav[i]);
      const spec = Math.pow(Math.max(0, (nx * hx + ny * hy + nz * hz) / hl), 40) * (gloss[i] / 255) * 0.6;
      const k = amb + 0.9 * diff;
      scene[i * 4] = toSrgb(toLin[rgb[i * 3]] * k + spec);
      scene[i * 4 + 1] = toSrgb(toLin[rgb[i * 3 + 1]] * k + spec);
      scene[i * 4 + 2] = toSrgb(toLin[rgb[i * 3 + 2]] * k + spec);
      scene[i * 4 + 3] = 255;
    }
  }

  // The paper, in its own pixels: a turned rectangle over the scene.
  const { paper } = place;
  const pw = Math.round(paper.w * n);
  const ph = Math.round(paper.h * n);
  const cx = (paper.x + paper.w / 2) * n;
  const cy = (paper.y + paper.h / 2) * n;
  const a = (paper.angle * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const sheet = blur(ride, n, n, 1.2 / mm, 2);
  const gap = new Float32Array(pw * ph);
  const drape = new Int8Array(pw * ph);
  const under = new Uint8Array(pw * ph * 3);
  const drapeEx = ex * 0.6;
  for (let j = 0; j < ph; j++)
    for (let i = 0; i < pw; i++) {
      const ox = i + 0.5 - pw / 2;
      const oy = j + 0.5 - ph / 2;
      const sx = cx + ox * ca - oy * sa - 0.5;
      const sy = cy + ox * sa + oy * ca - 0.5;
      const k = j * pw + i;
      gap[k] = Math.max(0, sample(ride, n, n, sx, sy) - sample(h, n, n, sx, sy));
      const dx = ((sample(sheet, n, n, sx + 1, sy) - sample(sheet, n, n, sx - 1, sy)) / (2 * mm)) * drapeEx;
      const dy = ((sample(sheet, n, n, sx, sy + 1) - sample(sheet, n, n, sx, sy - 1)) / (2 * mm)) * drapeEx;
      const nl = Math.hypot(dx, dy, 1);
      const lit = (-dx * lx - dy * ly + lz) / nl - lz;
      drape[k] = Math.max(-127, Math.min(127, Math.round(lit * 160)));
      const p = (Math.min(n - 1, Math.max(0, Math.round(sy))) * n + Math.min(n - 1, Math.max(0, Math.round(sx)))) * 4;
      under[k * 3] = scene[p];
      under[k * 3 + 1] = scene[p + 1];
      under[k * 3 + 2] = scene[p + 2];
    }

  // The paper's tooth: fine fibre, a little longer one way than the other.
  const fine = fbm(pw, ph, 2.2, 2, 91);
  const fibre = fbm(pw, ph, 5, 3, 92, { stretch: 0.45 });
  const cloud = fbm(pw, ph, 60, 3, 93);
  const tooth = new Uint8Array(pw * ph);
  for (let k = 0; k < tooth.length; k++) {
    const v = 0.5 + 0.62 * fine[k] + 0.5 * fibre[k] + 0.18 * cloud[k];
    tooth[k] = Math.round(255 * clamp(v));
  }

  post(
    {
      type: 'built',
      id: req.id,
      n,
      scene,
      pw,
      ph,
      gap,
      drape,
      tooth,
      under,
      ms: performance.now() - t0,
    },
    [scene.buffer, gap.buffer, drape.buffer, tooth.buffer, under.buffer],
  );
}

self.onmessage = (event: MessageEvent<Request>) => {
  if (event.data.type === 'build') build(event.data);
};
