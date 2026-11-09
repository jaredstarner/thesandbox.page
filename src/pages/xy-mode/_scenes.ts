// The reel's pictures. Each one rewrites a path for the coming pass of the beam, in tube
// units where the screen runs from -1 to 1 each way.

import { COAST } from './_coast';
import type { Path } from './_path';
import { setText } from './_strokes';

export type SceneId =
  'cube' | 'tesseract' | 'knot23' | 'knot34' | 'knot25' | 'knot35' | 'tunnel' | 'ridge' | 'earth' | 'title';

// Cube corners are numbered by their bits (x, y, z). The cube has eight odd corners, so a
// single pass has to run over four of its edges twice.
const CUBE_WALK = [0, 1, 3, 2, 0, 4, 5, 7, 6, 4, 5, 1, 3, 7, 6, 2];

/** Hierholzer: every corner of a tesseract has four edges, so one pass can draw all 32 once. */
function tesseractWalk(): number[] {
  const left = new Map<number, number[]>();
  for (let v = 0; v < 16; v++)
    left.set(
      v,
      [1, 2, 4, 8].map((bit) => v ^ bit),
    );
  const stack = [0];
  const walk: number[] = [];
  while (stack.length) {
    const v = stack[stack.length - 1];
    const next = left.get(v)!;
    if (next.length) {
      const w = next.pop()!;
      const back = left.get(w)!;
      back.splice(back.indexOf(v), 1);
      stack.push(w);
    } else {
      walk.push(stack.pop()!);
    }
  }
  return walk;
}

const TESSERACT_WALK = tesseractWalk();

function buildCube(p: Path, t: number): void {
  const a = t * 0.9;
  const b = t * 0.53;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  for (let i = 0; i < CUBE_WALK.length; i++) {
    const v = CUBE_WALK[i];
    const x0 = v & 1 ? 1 : -1;
    const y0 = v & 2 ? 1 : -1;
    const z0 = v & 4 ? 1 : -1;
    const x1 = x0 * ca + z0 * sa;
    const z1 = -x0 * sa + z0 * ca;
    const y1 = y0 * cb - z1 * sb;
    const z2 = y0 * sb + z1 * cb;
    const k = 1.75 / (4.4 + z2);
    if (i === 0) p.moveTo(x1 * k, y1 * k);
    else p.lineTo(x1 * k, y1 * k);
  }
  p.finish(true);
}

function buildTesseract(p: Path, t: number): void {
  const a = t * 0.61;
  const b = t * 0.37;
  const c = t * 0.23;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cc = Math.cos(c);
  const sc = Math.sin(c);
  for (let i = 0; i < TESSERACT_WALK.length; i++) {
    const v = TESSERACT_WALK[i];
    const x0 = v & 1 ? 1 : -1;
    const y0 = v & 2 ? 1 : -1;
    const z0 = v & 4 ? 1 : -1;
    const w0 = v & 8 ? 1 : -1;
    // Turn in the x-w and y-w planes, which is what makes the inner cube swap with the outer.
    const x1 = x0 * ca - w0 * sa;
    const w1 = x0 * sa + w0 * ca;
    const y1 = y0 * cb - w1 * sb;
    const w2 = y0 * sb + w1 * cb;
    const x2 = x1 * cc - z0 * sc;
    const z2 = x1 * sc + z0 * cc;
    const k3 = 2.6 / (3.4 + w2);
    const k2 = 1.5 / (3.8 + z2 * k3 * 0.8);
    const x = x2 * k3 * k2;
    const y = y1 * k3 * k2;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.finish(true);
}

function buildKnot(p: Path, t: number, turns: number, loops: number): void {
  const a = t * 0.47;
  const b = 0.55 + 0.32 * Math.sin(t * 0.31);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const steps = 420;
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * Math.PI * 2;
    const r = 0.56 + 0.26 * Math.cos(loops * u);
    const x0 = r * Math.cos(turns * u);
    const y0 = r * Math.sin(turns * u);
    const z0 = 0.3 * Math.sin(loops * u);
    const x1 = x0 * ca + z0 * sa;
    const z1 = -x0 * sa + z0 * ca;
    const y1 = y0 * cb - z1 * sb;
    const z2 = y0 * sb + z1 * cb;
    const k = 2.7 / (2.7 + z2);
    if (i === 0) p.moveTo(x1 * k * 1.02, y1 * k * 1.02);
    else p.lineTo(x1 * k * 1.02, y1 * k * 1.02);
  }
  p.finish(true);
}

/** One spiral down the tunnel and another back up it the other way, which weaves a lattice. */
function buildTunnel(p: Path, t: number): void {
  const steps = 360;
  const near = 0.58;
  const far = 7;
  const turns = 5;
  const flow = t * 2.1;
  const log = Math.log(far / near);
  for (let leg = 0; leg < 2; leg++) {
    for (let i = 0; i <= steps; i++) {
      const s = leg === 0 ? i / steps : 1 - i / steps;
      const depth = near * Math.exp(log * s);
      const angle = (leg === 0 ? 1 : -1) * (s * turns * Math.PI * 2 + flow) + 0.4 * Math.sin(t * 0.6);
      const rho = 0.46 / depth;
      // The far end wanders, so the tunnel seems to bend as it flies.
      const bend = 1 - near / depth;
      const cx = 0.3 * bend * Math.sin(t * 0.71);
      const cy = 0.22 * bend * Math.cos(t * 0.53);
      const x = cx + rho * Math.cos(angle);
      const y = cy + rho * Math.sin(angle);
      if (i === 0 && leg === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
  }
  p.finish(false);
}

/** A mountain valley, one ridge at a time, back and forth, so the beam never has to jump. */
function buildRidge(p: Path, t: number): void {
  const scroll = t * 1.5;
  const whole = Math.floor(scroll);
  const frac = scroll - whole;
  const lines = 14;
  const steps = 38;
  for (let l = 0; l < lines; l++) {
    const index = l + 1 - frac;
    const z = 0.82 + index * index * 0.075 + index * 0.32;
    const world = whole + l;
    const reach = Math.min(4.3, (0.98 * z) / 0.92);
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const across = (l % 2 ? 1 - s * 2 : s * 2 - 1) * reach;
      const side = Math.abs(across) / 2.2;
      const rise = side * side * (1.1 + 0.3 * Math.sin(world * 0.37));
      const lumps =
        0.34 * Math.sin(across * 1.7 + world * 0.61) +
        0.2 * Math.sin(across * 3.9 - world * 0.97) +
        0.1 * Math.sin(across * 8.3 + world * 1.73);
      const h = Math.max(0, rise * (1 + lumps));
      const x = (across * 0.92) / z;
      const y = ((h - 1.04) * 0.92) / z + 0.2;
      if (l === 0 && i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
  }
  p.finish(false);
}

const RAD = Math.PI / 180;

const runX = new Float32Array(4096);
const runY = new Float32Array(4096);
const runStart = new Int32Array(256);
const runEnd = new Int32Array(256);
const runUsed = new Uint8Array(256);

function buildEarth(p: Path, t: number): void {
  const R = 0.84;
  const lon0 = 20 * RAD - t * 0.26;
  const tilt = 0.32;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const cl = Math.cos(lon0);
  const sl = Math.sin(lon0);
  // Find what faces us: runs of coast with their ends where they go over the limb.
  let points = 0;
  let runs = 0;
  for (const ring of COAST) {
    let open = false;
    for (let i = 0; i < ring.length; i += 2) {
      const lon = ring[i] * RAD;
      const lat = ring[i + 1] * RAD;
      const cp = Math.cos(lat);
      const x0 = cp * Math.sin(lon);
      const y0 = Math.sin(lat);
      const z0 = cp * Math.cos(lon);
      const x1 = x0 * cl + z0 * sl;
      const z1 = -x0 * sl + z0 * cl;
      const y1 = y0 * ct - z1 * st;
      const z2 = y0 * st + z1 * ct;
      if (z2 < 0.02) {
        if (open) runEnd[runs++] = points;
        open = false;
        continue;
      }
      if (!open) {
        runStart[runs] = points;
        open = true;
      }
      runX[points] = x1 * R;
      runY[points] = y1 * R;
      points++;
    }
    if (open) runEnd[runs++] = points;
  }
  // The limb first, so there is always a disc to read the coasts against.
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    if (i === 0) p.moveTo(R * Math.cos(a), R * Math.sin(a));
    else p.lineTo(R * Math.cos(a), R * Math.sin(a));
  }
  // The beam can't switch off, so every jump shows faintly. Take the coasts in whichever order
  // keeps the jumps short.
  runUsed.fill(0, 0, runs);
  let cx = R;
  let cy = 0;
  for (let k = 0; k < runs; k++) {
    let best = -1;
    let bestD = Infinity;
    let flip = false;
    for (let r = 0; r < runs; r++) {
      if (runUsed[r]) continue;
      const a = runStart[r];
      const b = runEnd[r] - 1;
      const da = (runX[a] - cx) ** 2 + (runY[a] - cy) ** 2;
      const db = (runX[b] - cx) ** 2 + (runY[b] - cy) ** 2;
      if (da < bestD) {
        bestD = da;
        best = r;
        flip = false;
      }
      if (db < bestD) {
        bestD = db;
        best = r;
        flip = true;
      }
    }
    runUsed[best] = 1;
    const a = runStart[best];
    const b = runEnd[best] - 1;
    const count = b - a;
    for (let i = 0; i <= count; i++) {
      const at = flip ? b - i : a + i;
      if (i === 0) p.moveTo(runX[at], runY[at]);
      else p.lineTo(runX[at], runY[at]);
      cx = runX[at];
      cy = runY[at];
    }
  }
  p.finish(false);
}

let titleX: Float32Array | null = null;
let titleY: Float32Array | null = null;
let titlePen: Uint8Array | null = null;

function buildTitle(p: Path, t: number): void {
  if (!titleX || !titleY || !titlePen) {
    // Laid out once; every pass after that only leans it.
    setText(p, 'thesandbox .page');
    titleX = p.xs.slice(0, p.n);
    titleY = p.ys.slice(0, p.n);
    titlePen = new Uint8Array(p.n);
    p.copyPens(titlePen);
    p.clear();
  }
  const lean = 0.16 * Math.sin(t * 0.8);
  const scale = 1.06;
  for (let i = 0; i < titleX.length; i++) {
    const x = titleX[i] * scale;
    const y = titleY[i] * scale;
    const k = 1 / (1 + x * lean * 0.4);
    if (titlePen[i]) p.lineTo(x * k, y * k);
    else p.moveTo(x * k, y * k);
  }
  p.finish(false);
}

export function buildScene(id: SceneId, p: Path, t: number): void {
  p.clear();
  switch (id) {
    case 'cube':
      return buildCube(p, t);
    case 'tesseract':
      return buildTesseract(p, t);
    case 'knot23':
      return buildKnot(p, t, 2, 3);
    case 'knot34':
      return buildKnot(p, t, 3, 4);
    case 'knot25':
      return buildKnot(p, t, 2, 5);
    case 'knot35':
      return buildKnot(p, t, 3, 5);
    case 'tunnel':
      return buildTunnel(p, t);
    case 'ridge':
      return buildRidge(p, t);
    case 'earth':
      return buildEarth(p, t);
    case 'title':
      return buildTitle(p, t);
  }
}
