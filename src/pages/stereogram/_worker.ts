// The drawing half of /stereogram/: it owns every scene, solves the sheet,
// paints it, and hands the page a finished bitmap for each frame it asks for.

import { Sheet } from './_sirds';
import { dots, mottle, type Grain, type InkId } from './_inks';
import {
  Clay,
  Pond,
  discs,
  drawMesh,
  knot,
  relief,
  rotation,
  torus,
  type Brush,
  type Disc,
  type Mesh,
} from './_scenes';

export type Plate = 'ring' | 'pond' | 'word' | 'sculpt' | 'test';

export type Message =
  | { type: 'size'; w: number; h: number; eye: number }
  | { type: 'plate'; plate: Plate }
  | { type: 'look'; ink: InkId; grain: Grain; shimmer: boolean; cross: boolean; still: boolean }
  | { type: 'shape'; shape: 'torus' | 'knot' }
  | { type: 'words'; mask: Uint8Array; w: number; h: number; radius: number }
  | { type: 'drop'; x: number; y: number; strength: number }
  | { type: 'stroke'; points: number[]; r: number; brush: Brush }
  | { type: 'cursor'; x: number; y: number; r: number }
  | { type: 'cursor'; x: null }
  | { type: 'clear' }
  | { type: 'discs'; discs: Disc[]; seed: number }
  | { type: 'frame'; t: number };

export type Reply = { type: 'frame'; bitmap: ImageBitmap; w: number; h: number; ms: number } | { type: 'idle' };

const post = (reply: Reply, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: Reply, t: Transferable[]): void }).postMessage(reply, transfer);

let w = 0;
let h = 0;
let eye = 0;
let sheet: Sheet | null = null;
let depth = new Float32Array(0);
let image: ImageData | null = null;
let out: Uint32Array = new Uint32Array(0);
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

let plate: Plate = 'ring';
let ink: InkId = 'newsprint';
let grain: Grain = 'fine';
let shimmer = false;
let cross = false;
let still = false;

let tex: Uint32Array = new Uint32Array(0);
let texW = 1;
let texH = 1;
let seed = 1;

let relink = true;
let repaint = true;

// Scenes
const meshes: Record<'torus' | 'knot', Mesh | null> = { torus: null, knot: null };
let shape: 'torus' | 'knot' = 'torus';
let scratch = new Float32Array(0);
let pond: Pond | null = null;
let pondClock = -1;
let lastDrop = 0;
let words: Float32Array | null = null;
let clay: Clay | null = null;
let cursor: { x: number; y: number; r: number } | null = null;
let test: Disc[] = [];

function multiply(a: number[], b: number[]): number[] {
  const m = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) m[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return m;
}

function retexture() {
  if (!sheet) return;
  texW = sheet.far;
  texH = h;
  // The test always uses plain dots: a pattern could give the answer away at the edges of the discs.
  tex =
    grain === 'mottle' && plate !== 'test'
      ? mottle(ink, texW, texH, seed, Math.max(6, texW / 4))
      : dots(ink, texW, texH, seed);
  repaint = true;
}

function resize(nw: number, nh: number, ne: number) {
  w = nw;
  h = nh;
  eye = ne;
  sheet = new Sheet(w, h, eye);
  depth = new Float32Array(w * h);
  canvas = new OffscreenCanvas(w, h);
  ctx = canvas.getContext('2d');
  image = new ImageData(w, h);
  out = new Uint32Array(image.data.buffer);
  pond = null;
  words = null;
  // Clay survives a resize by being resampled.
  if (clay) {
    const old = clay;
    clay = new Clay(w, h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(old.h - 1, Math.floor((y / h) * old.h));
      for (let x = 0; x < w; x++) {
        clay.height[y * w + x] = old.height[sy * old.w + Math.min(old.w - 1, Math.floor((x / w) * old.w))];
      }
    }
  }
  retexture();
  relink = true;
}

function compose(t: number): boolean {
  if (!sheet) return false;
  switch (plate) {
    case 'ring': {
      if (still && !relink) return false;
      const mesh = (meshes[shape] ??= shape === 'torus' ? torus() : knot());
      if (scratch.length < mesh.pos.length) scratch = new Float32Array(mesh.pos.length);
      const s = still ? 4 : t / 1000;
      // Tip the shape back and forth between nearly face-on and well over, while the tilt slowly swings round,
      // so the ring's hole stays in view; the knot also turns about its own axis.
      const m = multiply(rotation(0.62 + 0.3 * Math.sin(s * 0.37), 0, s * 0.21), rotation(0, 0, s * 0.33));
      depth.fill(0);
      drawMesh(mesh, m, depth, w, h, Math.min(w, h) * 0.8, 0.52, 0.32, scratch);
      return true;
    }
    case 'pond': {
      if (!pond) {
        pond = new Pond(w, h);
        pondClock = t;
        lastDrop = t - 3000;
      }
      // Fixed steps at 60 a second, whatever the frame rate; never more than a quarter second's worth at once.
      if (t - pondClock > 250) pondClock = t - 250;
      let stepped = false;
      while (pondClock + 1000 / 60 <= t) {
        pond.step();
        pondClock += 1000 / 60;
        stepped = true;
      }
      // Now and then a drop falls on its own, so the pond never sits dead still.
      if (!still && t - lastDrop > 2600) {
        lastDrop = t - Math.random() * 1400;
        for (let tries = 0; tries < 20; tries++) {
          const x = Math.random() * w;
          const y = Math.random() * h;
          if (pond.wetAt(x, y)) {
            pond.drop(x, y, 0.35 + Math.random() * 0.25);
            break;
          }
        }
      }
      if (!stepped && !relink) return false;
      pond.render(depth);
      return true;
    }
    case 'word': {
      if (!relink) return false;
      if (words) depth.set(words);
      else depth.fill(0);
      return true;
    }
    case 'sculpt': {
      if (!relink) return false;
      clay ??= new Clay(w, h);
      clay.render(depth, cursor);
      return true;
    }
    case 'test': {
      if (!relink) return false;
      discs(depth, w, h, test);
      return true;
    }
  }
}

function frame(t: number) {
  if (!sheet || !ctx || !image || !canvas) return post({ type: 'idle' });
  const started = performance.now();
  const changed = compose(t);
  if (changed) {
    if (cross) for (let i = 0; i < depth.length; i++) depth[i] = 1 - depth[i];
    sheet.link(depth, true);
    relink = false;
    repaint = true;
  }
  if (shimmer) {
    seed = (seed + 1) >>> 0;
    retexture();
  }
  if (!repaint) return post({ type: 'idle' });
  sheet.paint(tex, texW, texH, out);
  ctx.putImageData(image, 0, 0);
  repaint = false;
  const bitmap = canvas.transferToImageBitmap();
  post({ type: 'frame', bitmap, w, h, ms: performance.now() - started }, [bitmap]);
}

self.onmessage = (event: MessageEvent<Message>) => {
  const m = event.data;
  switch (m.type) {
    case 'size':
      resize(m.w, m.h, m.eye);
      break;
    case 'plate':
      if (m.plate !== plate) {
        const wasTest = plate === 'test' || m.plate === 'test';
        plate = m.plate;
        if (wasTest) retexture();
        relink = true;
      }
      break;
    case 'look': {
      const retex = m.ink !== ink || m.grain !== grain;
      if (m.cross !== cross || m.still !== still) relink = true;
      ink = m.ink;
      grain = m.grain;
      shimmer = m.shimmer;
      cross = m.cross;
      still = m.still;
      if (retex) retexture();
      break;
    }
    case 'shape':
      shape = m.shape;
      relink = true;
      break;
    case 'words':
      if (m.w === w && m.h === h) {
        words = relief(m.mask, w, h, m.radius);
        relink = true;
      }
      break;
    case 'drop':
      pond?.drop(m.x, m.y, m.strength);
      break;
    case 'stroke': {
      clay ??= new Clay(w, h);
      const p = m.points;
      for (let i = 0; i + 1 < p.length; i += 2) clay.dab(p[i], p[i + 1], m.r, m.brush);
      relink = true;
      break;
    }
    case 'cursor':
      cursor = m.x === null ? null : { x: m.x, y: m.y, r: m.r };
      if (plate === 'sculpt') relink = true;
      break;
    case 'clear':
      clay?.clear();
      relink = true;
      break;
    case 'discs':
      test = m.discs;
      seed = m.seed >>> 0;
      retexture();
      relink = true;
      break;
    case 'frame':
      frame(m.t);
      break;
  }
};
