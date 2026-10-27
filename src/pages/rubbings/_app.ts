// The page half of /rubbings/: the sheet, the crayon, and the controls. The
// worker works out what is under the paper; this side keeps the wax.

import { placeById, type Place, type PlaceId } from './_places';
import { drawMasks, type Fonts } from './_draw';
import type { Built, Request } from './_worker';
import { clamp, rng, smoothstep } from './_field';

type WaxId = 'black' | 'graphite' | 'gold' | 'silver' | 'red';
type PaperId = 'cartridge' | 'detail' | 'black';

/** Wax colours, and how much each catches the raking light. */
const WAX: Record<WaxId, { color: string; sheen: number }> = {
  black: { color: '#1b1714', sheen: 0.12 },
  graphite: { color: '#4d4f53', sheen: 0.55 },
  gold: { color: '#caa24f', sheen: 0.7 },
  silver: { color: '#c4c7ca', sheen: 0.6 },
  red: { color: '#8e2c25', sheen: 0.15 },
};

/** Paper colours; `thin` is how much of what is under it shows through. */
const PAPER: Record<PaperId, { color: string; back: string; thin: number; dark: boolean; ghost: number }> = {
  cartridge: { color: '#eee8da', back: '#e6dfcf', thin: 0, dark: false, ghost: 0.1 },
  detail: { color: '#e9e6de', back: '#dfdcd3', thin: 0.34, dark: false, ghost: 0.32 },
  black: { color: '#1c1b1a', back: '#242322', thin: 0, dark: true, ghost: 0.04 },
};

const toLin = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const LUT = 4096;
const toByte = new Uint8Array(LUT + 1);
for (let i = 0; i <= LUT; i++) {
  const c = i / LUT;
  toByte[i] = Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
}
const hexLin = (hex: string) => [1, 3, 5].map((k) => toLin[parseInt(hex.slice(k, k + 2), 16)]);

interface Sheet {
  place: Place;
  built: Built;
  /** Wax on the paper, 0 to 1. */
  wax: Float32Array;
}

/** A crayon edge isn't straight: chips and wear along it leave streaks in the direction of the stroke. */
const EDGE = (() => {
  const rand = rng(7);
  const raw = new Float32Array(256);
  for (let i = 0; i < 256; i++) raw[i] = rand();
  const out = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) s += raw[(i + k + 256) % 256];
    const v = s / 5;
    out[i] = 0.58 + 0.42 * smoothstep(0.25, 0.62, v) - (raw[i] > 0.94 ? 0.3 : 0);
  }
  return out;
})();

export function start(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>('[data-stage]')!;
  const ground = root.querySelector<HTMLCanvasElement>('[data-ground]')!;
  const sheetEl = root.querySelector<HTMLElement>('[data-sheet]')!;
  const paperCanvas = root.querySelector<HTMLCanvasElement>('[data-paper]')!;
  const flap = root.querySelector<HTMLElement>('[data-flap]')!;
  const flapCanvas = root.querySelector<HTMLCanvasElement>('[data-flap-canvas]')!;
  const crayon = root.querySelector<HTMLElement>('[data-crayon]')!;
  const what = root.querySelector<HTMLElement>('[data-what]')!;
  const scaleBar = root.querySelector<HTMLElement>('[data-scale-bar]')!;
  const scaleLabel = root.querySelector<HTMLElement>('[data-scale-label]')!;
  const liftButton = root.querySelector<HTMLButtonElement>('[data-lift]')!;

  if (typeof Worker !== 'function') {
    root.querySelector<HTMLElement>('[data-unsupported]')!.hidden = false;
    root.dataset.state = 'unsupported';
    return;
  }

  const g = paperCanvas.getContext('2d')!;
  const gg = ground.getContext('2d')!;
  const fg = flapCanvas.getContext('2d')!;
  const worker = new Worker(new URL('./_worker.ts', import.meta.url), { type: 'module' });
  const debug = new URLSearchParams(location.search).has('debug');

  // One resolution for the visit, from the stage's size on this screen.
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const n = Math.round(clamp(stage.clientWidth * dpr, 1024, 1600) / 2) * 2;

  const sheets = new Map<PlaceId, Sheet>();
  const lifted = new Set<PlaceId>();
  let current: Sheet | null = null;
  let wanted: PlaceId = 'cover';
  let waxId: WaxId = 'black';
  let paperId: PaperId = 'cartridge';
  let firm = true;
  let side = true;
  let image: ImageData | null = null;
  let base: Uint8Array | null = null;
  let dirty: [number, number, number, number] | null = null;
  let frame = 0;

  const family = (v: string) => getComputedStyle(root).getPropertyValue(v).trim() || 'serif';
  const fonts: Fonts = { cut: family('--font-rubbings'), cast: family('--font-rubbings-cast') };
  const fontsReady = Promise.all([
    document.fonts.load(`40px ${fonts.cut}`, 'IN MEMORY OF'),
    document.fonts.load(`italic 40px ${fonts.cut}`, 'Here also lieth'),
    document.fonts.load(`40px ${fonts.cast}`, 'SURFACE WATER'),
  ]).catch(() => undefined);

  // Laying out a place: draw its masks, have the worker build it.
  async function go(id: PlaceId) {
    wanted = id;
    root.dataset.place = id;
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-go]'))
      b.setAttribute('aria-pressed', String(b.dataset.go === id));
    const place = placeById(id);
    root.style.setProperty('--ground', place.ground);
    setLift(false, true);
    showWhat(place);
    sizeScale(place);
    root.dataset.state = 'loading';
    await fontsReady;
    if (wanted !== id) return;
    const masks = drawMasks(id, n, fonts);
    const req: Request = { type: 'build', id, n, masks };
    worker.postMessage(
      req,
      Object.values(masks).map((m) => m.buffer),
    );
  }

  worker.onmessage = (event: MessageEvent<Built>) => {
    const built = event.data;
    if (built.id !== wanted) return;
    const place = placeById(built.id);
    const kept = sheets.get(built.id);
    const wax = kept && kept.wax.length === built.pw * built.ph ? kept.wax : new Float32Array(built.pw * built.ph);
    current = { place, built, wax };
    sheets.set(built.id, current);
    if (debug) console.info(`rubbings: built ${built.id} at ${n}px in ${Math.round(built.ms)} ms (${built.marks})`);

    ground.width = ground.height = built.n;
    gg.putImageData(new ImageData(built.scene as Uint8ClampedArray<ArrayBuffer>, built.n, built.n), 0, 0);
    const { paper } = place;
    sheetEl.style.left = `${paper.x * 100}%`;
    sheetEl.style.top = `${paper.y * 100}%`;
    sheetEl.style.width = `${paper.w * 100}%`;
    sheetEl.style.height = `${paper.h * 100}%`;
    sheetEl.style.transform = `rotate(${paper.angle}deg)`;
    paperCanvas.width = built.pw;
    paperCanvas.height = built.ph;
    image = new ImageData(built.pw, built.ph);
    composeBase();
    paintAll();
    root.dataset.state = 'ready';
  };

  // The paper itself, before any wax: its colour, the drape over what is
  // under it in the raking light, its tooth, and, for thin paper, a shadow of
  // what is underneath.
  function composeBase() {
    if (!current) return;
    const { pw, ph, drape, tooth, under } = current.built;
    const p = PAPER[paperId];
    const [pr, pg, pb] = hexLin(p.color);
    const out = new Uint8Array(pw * ph * 3);
    const dark = p.dark;
    for (let k = 0; k < pw * ph; k++) {
      const fibre = (tooth[k] / 255 - 0.5) * (dark ? 0.16 : 0.07);
      let light = 1 + (drape[k] / 127) * (dark ? 0.3 : 0.2) + fibre;
      if (p.thin) {
        const u = 0.2126 * toLin[under[k * 3]] + 0.7152 * toLin[under[k * 3 + 1]] + 0.0722 * toLin[under[k * 3 + 2]];
        light *= 1 - p.thin + p.thin * clamp(0.3 + u * 2.4, 0, 1.15);
      }
      out[k * 3] = toByte[Math.round(clamp(pr * light) * LUT)];
      out[k * 3 + 1] = toByte[Math.round(clamp(pg * light) * LUT)];
      out[k * 3 + 2] = toByte[Math.round(clamp(pb * light) * LUT)];
    }
    base = out;
    root.dataset.paperTone = dark ? 'dark' : 'light';
  }

  function paintAll() {
    if (!current) return;
    paintRect(0, 0, current.built.pw, current.built.ph);
  }

  function paintRect(x0: number, y0: number, x1: number, y1: number) {
    if (!current || !image || !base) return;
    const { pw, drape, tooth } = current.built;
    const { wax } = current;
    const w = WAX[waxId];
    const [wr, wg, wb] = hexLin(w.color);
    const data = image.data;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const k = y * pw + x;
        const a = wax[k];
        const o = k * 4;
        if (a <= 0.001) {
          data[o] = base[k * 3];
          data[o + 1] = base[k * 3 + 1];
          data[o + 2] = base[k * 3 + 2];
        } else {
          const glint = 1 + w.sheen * ((drape[k] / 127) * 2.2 + (tooth[k] / 255 - 0.5) * 0.5);
          const r = toLin[base[k * 3]] * (1 - a) + wr * glint * a;
          const gch = toLin[base[k * 3 + 1]] * (1 - a) + wg * glint * a;
          const b = toLin[base[k * 3 + 2]] * (1 - a) + wb * glint * a;
          data[o] = toByte[Math.round(clamp(r) * LUT)];
          data[o + 1] = toByte[Math.round(clamp(gch) * LUT)];
          data[o + 2] = toByte[Math.round(clamp(b) * LUT)];
        }
        data[o + 3] = 255;
      }
    g.putImageData(image, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }

  function markDirty(x0: number, y0: number, x1: number, y1: number) {
    if (!current) return;
    const { pw, ph } = current.built;
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(pw, Math.ceil(x1));
    y1 = Math.min(ph, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    dirty = dirty
      ? [Math.min(dirty[0], x0), Math.min(dirty[1], y0), Math.max(dirty[2], x1), Math.max(dirty[3], y1)]
      : [x0, y0, x1, y1];
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (dirty) paintRect(...dirty);
        dirty = null;
      });
  }

  // The crayon. Its long side lies across the stroke; it bridges the gaps
  // between high points and only reaches so far down into them, and the
  // paper's tooth decides which specks take wax on each pass.
  const crayonSize = () => (side ? [n * 0.085, n * 0.026] : [n * 0.02, n * 0.016]);

  function rub(ax: number, ay: number, bx: number, by: number, axis: number, pressure: number) {
    if (!current) return;
    const { pw, ph, gap, tooth, press } = current.built;
    const { wax, place } = current;
    const [L, T] = crayonSize();
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.01) return;
    const dx = (bx - ax) / len;
    const dy = (by - ay) / len;
    const ux = Math.cos(axis);
    const uy = Math.sin(axis);
    const vx = -uy;
    const vy = ux;
    const da = dx * ux + dy * uy;
    const db = dx * vx + dy * vy;
    const crossing = Math.min(Math.abs(da) > 1e-4 ? L / Math.abs(da) : Infinity, Math.abs(db) > 1e-4 ? T / Math.abs(db) : Infinity);
    const reach = place.reach[0] + (place.reach[1] - place.reach[0]) * pressure;
    const hl = L / 2;
    const ht = T / 2;
    const ex = Math.abs(ux) * hl + Math.abs(vx) * ht;
    const ey = Math.abs(uy) * hl + Math.abs(vy) * ht;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - ex - 1));
    const x1 = Math.min(pw, Math.ceil(Math.max(ax, bx) + ex + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - ey - 1));
    const y1 = Math.min(ph, Math.ceil(Math.max(ay, by) + ey + 1));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const qx = x + 0.5 - ax;
        const qy = y + 0.5 - ay;
        const qa = qx * ux + qy * uy;
        const qb = qx * vx + qy * vy;
        // When is this pixel under the crayon as it moves from a to b?
        let t0 = 0;
        let t1 = len;
        if (Math.abs(da) > 1e-4) {
          const s0 = (qa - hl) / da;
          const s1 = (qa + hl) / da;
          t0 = Math.max(t0, Math.min(s0, s1));
          t1 = Math.min(t1, Math.max(s0, s1));
        } else if (Math.abs(qa) > hl) continue;
        if (Math.abs(db) > 1e-4) {
          const s0 = (qb - ht) / db;
          const s1 = (qb + ht) / db;
          t0 = Math.max(t0, Math.min(s0, s1));
          t1 = Math.min(t1, Math.max(s0, s1));
        } else if (Math.abs(qb) > ht) continue;
        if (t1 <= t0) continue;
        const exposure = Math.min(1, (t1 - t0) / crossing);
        const along = (qa - ((t0 + t1) / 2) * da) / hl;
        const ends = smoothstep(1, 0.82, Math.abs(along));
        if (ends <= 0) continue;
        const k = y * pw + x;
        const contact = 1 - smoothstep(reach * 0.1, reach * 1.4, gap[k]);
        if (contact <= 0) continue;
        // Proud points bear more of the weight, so they take wax sooner and
        // fill more of the paper's tooth.
        const weight = clamp(0.2 + 0.5 * pressure + 0.45 * (press[k] / 127));
        const have = wax[k];
        const lo = 0.6 - 0.62 * weight - 0.25 * have;
        const gate = smoothstep(lo, lo + 0.48, tooth[k] / 255);
        const edge = EDGE[Math.max(0, Math.min(255, ((along + 1) * 127.5) | 0))];
        const rate = 0.05 + 0.3 * weight;
        wax[k] = have + rate * exposure * contact * gate * edge * ends * (1 - have);
      }
    markDirty(x0, y0, x1, y1);
  }

  // Pointer handling: map the screen to the paper's own pixels.
  const toPaper = (cx: number, cy: number) => {
    if (!current) return [0, 0];
    const r = stage.getBoundingClientRect();
    const sx = ((cx - r.left) / r.width) * n;
    const sy = ((cy - r.top) / r.height) * n;
    const { paper } = current.place;
    const pcx = (paper.x + paper.w / 2) * n;
    const pcy = (paper.y + paper.h / 2) * n;
    const a = (-paper.angle * Math.PI) / 180;
    const ox = sx - pcx;
    const oy = sy - pcy;
    return [
      ox * Math.cos(a) - oy * Math.sin(a) + current.built.pw / 2,
      ox * Math.sin(a) + oy * Math.cos(a) + current.built.ph / 2,
    ];
  };

  let drawing: { id: number; x: number; y: number; ax: number; ay: number } | null = null;
  let axis = Math.PI / 2;
  let axisVec = [Math.cos(2 * axis), Math.sin(2 * axis)];

  const pressureOf = (e: PointerEvent) =>
    e.pointerType === 'pen' && e.pressure > 0 ? clamp(e.pressure * 1.3) : firm ? 1 : 0;

  function placeCrayon(e: PointerEvent) {
    const r = stage.getBoundingClientRect();
    const [L, T] = crayonSize();
    const scale = r.width / n;
    const angle = axis + ((current?.place.paper.angle ?? 0) * Math.PI) / 180;
    crayon.style.setProperty('--cl', `${L * scale}px`);
    crayon.style.setProperty('--ct', `${T * scale}px`);
    crayon.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px) rotate(${angle}rad)`;
    crayon.hidden = false;
  }

  paperCanvas.addEventListener('pointerdown', (e) => {
    if (!current || root.dataset.lifted !== undefined) return;
    e.preventDefault();
    try {
      paperCanvas.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer can't be captured; the stroke still works.
    }
    const [x, y] = toPaper(e.clientX, e.clientY);
    drawing = { id: e.pointerId, x, y, ax: x, ay: y };
    root.dataset.touched = '';
    placeCrayon(e);
  });

  paperCanvas.addEventListener('pointermove', (e) => {
    if (root.dataset.lifted !== undefined) return;
    placeCrayon(e);
    if (!drawing || e.pointerId !== drawing.id) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      const [x, y] = toPaper(ev.clientX, ev.clientY);
      const dx = x - drawing.x;
      const dy = y - drawing.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.75) continue;
      // The crayon's long side settles across the direction of travel; back
      // and forth along one line keeps it still.
      const [L] = crayonSize();
      const k = 1 - Math.exp(-len / (L * 0.5));
      const want = Math.atan2(dy, dx) + Math.PI / 2;
      axisVec = [axisVec[0] + (Math.cos(2 * want) - axisVec[0]) * k, axisVec[1] + (Math.sin(2 * want) - axisVec[1]) * k];
      axis = Math.atan2(axisVec[1], axisVec[0]) / 2;
      rub(drawing.x, drawing.y, x, y, axis, pressureOf(ev));
      drawing.x = x;
      drawing.y = y;
    }
  });

  const end = (e: PointerEvent) => {
    if (drawing && e.pointerId === drawing.id) drawing = null;
  };
  paperCanvas.addEventListener('pointerup', end);
  paperCanvas.addEventListener('pointercancel', end);
  paperCanvas.addEventListener('pointerleave', (e) => {
    if (!drawing) crayon.hidden = true;
    end(e);
  });

  // Lifting the sheet: fold it up from the bottom and back over the tape.
  let lift = 0;
  let liftTarget = 0;
  let liftFrame = 0;
  let liftAt = 0;

  function setLift(on: boolean, instant = false) {
    liftTarget = on ? 1 : 0;
    if (on) root.dataset.lifted = '';
    liftButton.setAttribute('aria-pressed', String(on));
    liftButton.textContent = on ? 'Lay it back' : 'Lift the sheet';
    if (on && current) {
      lifted.add(current.place.id);
      showWhat(current.place);
      drawFlap();
    }
    if (instant) {
      lift = liftTarget;
      applyLift();
      return;
    }
    liftAt = performance.now();
    if (!liftFrame) liftFrame = requestAnimationFrame(stepLift);
  }

  function stepLift(now: number) {
    const dt = Math.min(0.05, (now - liftAt) / 1000);
    liftAt = now;
    const dir = Math.sign(liftTarget - lift);
    lift = clamp(lift + dir * dt * 1.25);
    applyLift();
    if (lift !== liftTarget) liftFrame = requestAnimationFrame(stepLift);
    else liftFrame = 0;
  }

  // The back of the sheet, with the wax showing faintly through; it is
  // mirrored by the fold itself.
  const flapBack = document.createElement('canvas');
  function drawFlap() {
    if (!current) return;
    const p = PAPER[paperId];
    const w = Math.round(current.built.pw / 2);
    const h = Math.round(current.built.ph / 2);
    flapBack.width = flapCanvas.width = w;
    flapBack.height = flapCanvas.height = h;
    const bg = flapBack.getContext('2d')!;
    bg.fillStyle = p.back;
    bg.fillRect(0, 0, w, h);
    bg.globalAlpha = p.ghost;
    bg.drawImage(paperCanvas, 0, 0, w, h);
    bg.globalAlpha = 1;
  }

  /** Light on the folded part: bright along the crease, falling away toward the free edge. */
  function shadeFlap(nx: number, ny: number, c: number, W: number, H: number) {
    const w = flapCanvas.width;
    const h = flapCanvas.height;
    fg.drawImage(flapBack, 0, 0);
    const px = W / 2;
    const py = (c - nx * px) / ny;
    const sx = w / W;
    const sy = h / H;
    const reach = Math.max(40, H - py);
    const grad = fg.createLinearGradient(px * sx, py * sy, (px + nx * reach) * sx, (py + ny * reach) * sy);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
    grad.addColorStop(0.18, 'rgba(255, 255, 255, 0.06)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.2)');
    fg.fillStyle = grad;
    fg.fillRect(0, 0, w, h);
  }

  /** Clip a polygon to the half-plane where nx * x + ny * y <= c. */
  function clipHalf(poly: number[][], nx: number, ny: number, c: number) {
    const out: number[][] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const dp = nx * p[0] + ny * p[1] - c;
      const dq = nx * q[0] + ny * q[1] - c;
      if (dp <= 0) out.push(p);
      if (dp < 0 !== dq < 0) {
        const t = dp / (dp - dq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    return out;
  }

  function applyLift() {
    const e = lift * lift * (3 - 2 * lift);
    if (e <= 0) {
      paperCanvas.style.clipPath = '';
      flap.hidden = true;
      delete root.dataset.lifted;
      return;
    }
    const W = sheetEl.clientWidth;
    const H = sheetEl.clientHeight;
    // The fold runs a few degrees off level, from the bottom edge up past the tape.
    const tilt = (7 * Math.PI) / 180;
    const nx = -Math.sin(tilt);
    const ny = Math.cos(tilt);
    const py = H * (1.08 - 1.2 * e);
    const c = nx * (W / 2) + ny * py;
    const pad = 40;
    const box = [
      [-pad, -pad],
      [W + pad, -pad],
      [W + pad, H + pad],
      [-pad, H + pad],
    ];
    const rect = [
      [0, 0],
      [W, 0],
      [W, H],
      [0, H],
    ];
    const keep = clipHalf(box, nx, ny, c);
    const cut = clipHalf(rect, -nx, -ny, -c);
    const poly = (pts: number[][]) =>
      pts.length ? `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ')})` : 'inset(50%)';
    paperCanvas.style.clipPath = poly(keep);
    flap.hidden = cut.length < 3;
    flapCanvas.style.clipPath = poly(cut);
    // Reflect the cut part across the fold.
    const a = 1 - 2 * nx * nx;
    const b = -2 * nx * ny;
    const d = 1 - 2 * ny * ny;
    flap.style.transform = `matrix(${a}, ${b}, ${b}, ${d}, ${2 * c * nx}, ${2 * c * ny})`;
    if (!flap.hidden) shadeFlap(nx, ny, c, W, H);
  }

  liftButton.addEventListener('click', () => setLift(liftTarget === 0));

  root.querySelector('[data-fresh]')!.addEventListener('click', () => {
    if (!current) return;
    current.wax.fill(0);
    setLift(false);
    paintAll();
    delete root.dataset.touched;
  });

  root.querySelector('[data-save]')!.addEventListener('click', () => {
    if (!current) return;
    const id = current.place.id;
    paperCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rubbing-${current?.place.no ?? 0}-${id}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  });

  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-go]'))
    b.addEventListener('click', () => {
      if (b.dataset.go && b.dataset.go !== wanted) void go(b.dataset.go as PlaceId);
    });

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'wax') {
      waxId = t.value as WaxId;
      crayon.style.setProperty('--wax', WAX[waxId].color);
      paintAll();
    } else if (t.name === 'paper') {
      paperId = t.value as PaperId;
      composeBase();
      paintAll();
    } else if (t.name === 'pressure') firm = t.value === 'firm';
    else if (t.name === 'edge') side = t.value === 'side';
  });

  function showWhat(place: Place) {
    const seen = lifted.has(place.id);
    what.textContent = seen ? place.what : `${place.where}. Lift the sheet to see what is under it.`;
    what.classList.toggle('hushed', !seen);
  }

  function sizeScale(place: Place) {
    const px = stage.clientWidth / (place.sceneCm * 10);
    const steps = [10, 20, 50, 100, 200];
    let mm = steps[0];
    for (const s of steps) if (s * px <= 150) mm = s;
    scaleBar.style.width = `${mm * px}px`;
    scaleLabel.textContent = mm >= 10 ? `${mm / 10} cm` : `${mm} mm`;
  }

  window.addEventListener('resize', () => {
    if (current) sizeScale(current.place);
    if (lift > 0) applyLift();
  });

  if (debug) {
    (window as unknown as { rubbings: unknown }).rubbings = {
      n,
      ready: () => root.dataset.state === 'ready',
      place: (id: PlaceId) => go(id),
      /** Rub the whole sheet in zigzags: `passes` times over, at a pressure from 0 to 1. */
      rubAll(passes = 2, pressure = 1, cover = 1) {
        if (!current) return false;
        root.dataset.touched = '';
        const { pw, ph } = current.built;
        const [L] = crayonSize();
        const step = L * 0.55;
        for (let p = 0; p < passes; p++) {
          for (let y = step / 2 + p * step * 0.37; y < ph * cover; y += step) {
            let x = 0;
            let up = true;
            while (x < pw) {
              const nx = x + step * 0.35;
              const y0 = y + (up ? -1 : 1) * step * 0.5;
              const y1 = y + (up ? 1 : -1) * step * 0.5;
              rub(x, y0, nx, y1, 0, pressure);
              x = nx;
              up = !up;
            }
          }
        }
        paintAll();
        return true;
      },
      /** The paper's fields along a row through the middle, every `step` pixels. */
      probe(step = 16) {
        if (!current) return null;
        const { pw, ph, gap, tooth } = current.built;
        const y = Math.round(ph / 2);
        const out: string[] = [];
        for (let x = 0; x < pw; x += step) {
          const k = y * pw + x;
          out.push(`${x}:${gap[k].toFixed(3)}/${tooth[k]}/${current.wax[k].toFixed(2)}`);
        }
        return out.join(' ');
      },
      /** A region of the paper, as a PNG data URL, for detail checks. */
      crop(x: number, y: number, w: number, h: number) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d')!.drawImage(paperCanvas, x, y, w, h, 0, 0, w, h);
        return c.toDataURL('image/png');
      },
      lift: (on: boolean) => setLift(on, true),
      liftTo(v: number) {
        lift = clamp(v);
        liftTarget = lift;
        if (lift > 0) root.dataset.lifted = '';
        drawFlap();
        applyLift();
      },
    };
  }

  crayon.style.setProperty('--wax', WAX[waxId].color);
  void go('cover');
}
