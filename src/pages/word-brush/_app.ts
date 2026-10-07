// Word brush: wires the sheet, the brush, and the tools together.

import { Mask, type LineStroke, type Mode, type Stroke } from './_mask';
import { Typesetter, type Placement } from './_flow';
import { Ink } from './_ink';
import { PASSAGES } from './_texts';

const INK = '#241b15';
const RED = '#a3402a';

export function startWordBrush(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-sheet]');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const hint = root.querySelector<HTMLElement>('[data-hint]');
  const tally = root.querySelector<HTMLElement>('[data-tally]');

  const mask = new Mask();
  const setter = new Typesetter();
  const ink = new Ink();
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const family = getComputedStyle(root).getPropertyValue('--font-wordbrush').trim() || 'serif';

  const state = {
    mode: 'paint' as Mode,
    brush: 90,
    size: window.innerWidth < 640 ? 14 : 16,
    passage: PASSAGES[0],
    strokes: [] as Stroke[],
    keepWash: false,
  };

  let W = 0;
  let H = 0;
  let dpr = 1;
  let rows: number[][] = [];
  let rowsDirty: [number, number] | null = null;
  let placement: Placement = { pieces: [], words: 0, passes: 0 };
  let needsLayout = false;
  let ready = false;

  const font = () => `400 ${state.size}px ${family}`;

  function retype(): void {
    const f = font();
    const capacity = (W * H) / (setter.averageAdvance(f) * Math.round(state.size * 1.24));
    setter.set(state.passage.text, f, state.size, capacity);
    rows = [];
    rowsDirty = [0, H];
    needsLayout = true;
  }

  function resize(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas!.clientWidth;
    H = canvas!.clientHeight;
    canvas!.width = Math.round(W * dpr);
    canvas!.height = Math.round(H * dpr);
    mask.resize(W, H);
    for (const s of state.strokes) mask.draw(s);
    mask.sync();
    if (ready) retype();
  }

  /** Refresh the spans of every band the mask changed under. */
  function updateRows(changed: [number, number] | null): void {
    const lh = setter.lineHeight;
    const count = Math.ceil(H / lh);
    if (rows.length !== count) {
      rows = new Array(count).fill(null).map(() => []);
      changed = [0, H];
    }
    if (!changed) return;
    const minWidth = Math.max(state.size * 2, 22);
    const inset = state.size * 0.12;
    const k0 = Math.max(0, Math.floor(changed[0] / lh) - 1);
    const k1 = Math.min(count - 1, Math.ceil(changed[1] / lh) + 1);
    for (let k = k0; k <= k1; k++) rows[k] = mask.spans(k * lh, lh, minWidth, inset);
    needsLayout = true;
  }

  function draw(): void {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, W, H);
    if (wash > 0.002) {
      ctx!.globalAlpha = wash;
      ctx!.imageSmoothingEnabled = true;
      ctx!.drawImage(mask.canvas, 0, 0, W, H);
      ctx!.globalAlpha = 1;
    }
    ctx!.font = font();
    ctx!.textBaseline = 'alphabetic';
    ink.draw(ctx!, INK, RED);
  }

  function writeTally(): void {
    if (!tally) return;
    const { words, passes } = placement;
    tally.textContent = words
      ? `${state.passage.title} · ${words.toLocaleString()} words set` + (passes > 1 ? ` · ${passes} times through` : '')
      : '';
  }

  // The wash shows the brush's reach while drawing, then fades so only the
  // type is left, unless it is kept.
  let wash = 0;
  let washHold = 0;
  const washTarget = () => (live || washHold > 0 ? 0.16 : state.keepWash ? 0.1 : 0);

  let frameRequested = false;
  let last = 0;
  function frame(now: number): void {
    frameRequested = false;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    const changed = mask.sync();
    if (changed) rowsDirty = rowsDirty ? [Math.min(rowsDirty[0], changed[0]), Math.max(rowsDirty[1], changed[1])] : changed;
    if (rowsDirty) {
      updateRows(rowsDirty);
      rowsDirty = null;
    }
    if (needsLayout) {
      placement = setter.place(rows);
      needsLayout = false;
      ink.update(placement.pieces, setter.lineHeight * 1.5, still.matches ? 0 : state.size * 0.22);
      writeTally();
    }
    let busy = ink.step(dt, still.matches);
    washHold = Math.max(0, washHold - dt);
    const target = washTarget();
    if (wash !== target) {
      wash = still.matches ? target : wash + (target - wash) * (1 - Math.exp(-dt * (target > wash ? 12 : 2.2)));
      if (Math.abs(wash - target) < 0.002) wash = target;
      busy = true;
    }
    draw();
    if (busy || live || washHold > 0) request();
    else last = 0;
  }
  function request(): void {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(frame);
  }

  // ---- the brush ----

  let live: LineStroke | null = null;
  let pointer = -1;

  canvas.addEventListener('pointerdown', (e) => {
    if (!ready || live || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer tracks; the stroke still works.
    }
    pointer = e.pointerId;
    const mode: Mode = e.button === 2 || e.altKey ? (state.mode === 'paint' ? 'erase' : 'paint') : state.mode;
    const w = widthAt(e);
    live = { kind: 'line', mode, pts: [e.offsetX, e.offsetY, w] };
    mask.dot(mode, e.offsetX, e.offsetY, w);
    hint?.setAttribute('data-gone', '');
    request();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!live || e.pointerId !== pointer) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const p = live.pts;
      const n = p.length;
      const x = ev.offsetX;
      const y = ev.offsetY;
      if (Math.hypot(x - p[n - 3], y - p[n - 2]) < 1.5) continue;
      const w = widthAt(ev);
      mask.segment(live.mode, p[n - 3], p[n - 2], p[n - 1], x, y, w);
      p.push(x, y, w);
    }
    request();
  });

  const finish = (e: PointerEvent) => {
    if (!live || e.pointerId !== pointer) return;
    state.strokes.push(live);
    live = null;
    pointer = -1;
    washHold = 0.9;
    request();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function widthAt(e: PointerEvent): number {
    if (e.pointerType === 'pen' && e.pressure > 0) return state.brush * (0.35 + 0.85 * e.pressure);
    return state.brush;
  }

  // ---- start ----

  resize();
  window.addEventListener('resize', () => {
    resize();
    request();
  });

  document.fonts
    .load(font())
    .catch(() => undefined)
    .then(() => {
      ready = true;
      retype();
      request();
    });
}
