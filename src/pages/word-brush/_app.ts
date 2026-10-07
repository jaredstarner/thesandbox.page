// Word brush: wires the sheet, the brush, and the tools together.

import { CELL, Mask, type LineStroke, type Mode, type Stroke } from './_mask';
import { readingOrder, Typesetter, type Placement } from './_flow';
import { Ink } from './_ink';
import { SHAPES } from './_shapes';
import { PASSAGES, type Passage } from './_texts';
import setterSource from './_flow.ts?raw';

const INK = '#241b15';
const RED = '#a3402a';
const PAPER = '#f2ecdf';

const SETTER: Passage = {
  id: 'setter',
  title: 'The typesetter',
  credit: '',
  // Code reads better as prose with its indentation folded away.
  text: setterSource.replace(/\s+/g, ' ').trim(),
};

export function startWordBrush(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-sheet]');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const $ = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const hint = $<HTMLElement>('[data-hint]');
  const tally = $<HTMLElement>('[data-tally]');
  const ring = $<HTMLElement>('[data-ring]');
  const undoButton = $<HTMLButtonElement>('[data-undo]');
  const clearButton = $<HTMLButtonElement>('[data-clear]');
  const saveButton = $<HTMLButtonElement>('[data-save]');
  const own = $<HTMLTextAreaElement>('[data-own]');
  const brushInput = $<HTMLInputElement>('[data-brush]');
  const sizeInput = $<HTMLInputElement>('[data-size]');

  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
    if (hint) hint.textContent = 'This brush needs Intl.Segmenter, which this browser lacks.';
    return;
  }

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
    ownText: '',
    italic: false,
    byShape: true,
    keepWash: false,
    strokes: [] as Stroke[],
  };
  const history: Stroke[][] = [];
  if (sizeInput) sizeInput.value = String(state.size);

  let W = 0;
  let H = 0;
  let dpr = 1;
  let rows: number[][] = [];
  let rowsDirty: [number, number] | null = null;
  let placement: Placement = { pieces: [], words: 0, passes: 0 };
  let needsLayout = false;
  let ready = false;

  const font = () => `${state.italic ? 'italic ' : ''}400 ${state.size}px ${family}`;

  /** Prepare the passage again: on a new passage, face, size, or a bigger sheet. */
  function retype(): void {
    const f = font();
    const capacity = (W * H) / (setter.averageAdvance(f) * Math.round(state.size * 1.24));
    setter.set(state.passage.text, f, state.size, capacity);
    rows = [];
    rowsDirty = [0, H];
    needsLayout = true;
    request();
  }

  function rebuildMask(): void {
    mask.clear();
    for (const s of state.strokes) mask.draw(s);
    rowsDirty = [0, H];
    request();
  }

  function resize(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas!.clientWidth;
    H = canvas!.clientHeight;
    canvas!.width = Math.round(W * dpr);
    canvas!.height = Math.round(H * dpr);
    mask.resize(W, H);
    rebuildMask();
    if (ready) retype();
  }

  /** Refresh the spans of every band the mask changed under. */
  function updateRows(changed: [number, number]): void {
    const lh = setter.lineHeight;
    const count = Math.ceil(H / lh);
    if (rows.length !== count) {
      rows = Array.from({ length: count }, () => []);
      changed = [0, H];
    }
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
      ? `${state.passage.title} · ${words.toLocaleString()} ${words === 1 ? 'word' : 'words'} set` +
        (passes > 1 ? ` · ${passes} times through` : '')
      : '';
  }

  function syncButtons(): void {
    if (undoButton) undoButton.disabled = history.length === 0;
    if (clearButton) clearButton.disabled = state.strokes.length === 0;
    if (saveButton) saveButton.disabled = placement.pieces.length === 0;
  }

  // The wash shows the brush's reach while drawing, then fades so only the
  // type is left, unless it is kept.
  let wash = 0;
  let washHold = 0;
  const washTarget = () => (live || playing || washHold > 0 ? 0.16 : state.keepWash ? 0.1 : 0);

  let frameRequested = false;
  let last = 0;
  function frame(now: number): void {
    frameRequested = false;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    if (playing) playStep(dt);
    const changed = mask.sync();
    if (changed) rowsDirty = rowsDirty ? [Math.min(rowsDirty[0], changed[0]), Math.max(rowsDirty[1], changed[1])] : changed;
    if (rowsDirty && ready) {
      updateRows(rowsDirty);
      rowsDirty = null;
    }
    if (needsLayout && ready) {
      placement = setter.place(readingOrder(rows, state.byShape));
      needsLayout = false;
      ink.update(placement.pieces, setter.lineHeight * 1.5, still.matches ? 0 : state.size * 0.22);
      writeTally();
      syncButtons();
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
    if (busy || live || playing || washHold > 0) request();
    else last = 0;
  }
  function request(): void {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(frame);
  }

  /** Record the strokes as they are, so the next change can be undone. */
  function remember(): void {
    history.push(state.strokes.slice());
    if (history.length > 60) history.shift();
    syncButtons();
  }

  function dismissHint(): void {
    hint?.setAttribute('data-gone', '');
  }

  // ---- the brush ----

  let live: LineStroke | null = null;
  let pointer = -1;

  canvas.addEventListener('pointerdown', (e) => {
    if (!ready || live || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return;
    e.preventDefault();
    if (playing) finishPlaying();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer tracks; the stroke still works.
    }
    pointer = e.pointerId;
    const mode: Mode = e.button === 2 || e.altKey ? (state.mode === 'paint' ? 'erase' : 'paint') : state.mode;
    const w = widthAt(e);
    remember();
    live = { kind: 'line', mode, pts: [e.offsetX, e.offsetY, w] };
    mask.dot(mode, e.offsetX, e.offsetY, w);
    dismissHint();
    request();
  });

  canvas.addEventListener('pointermove', (e) => {
    moveRing(e);
    if (!live || e.pointerId !== pointer) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
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
    syncButtons();
    request();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function widthAt(e: PointerEvent): number {
    if (e.pointerType === 'pen' && e.pressure > 0) return state.brush * (0.35 + 0.85 * e.pressure);
    return state.brush;
  }

  // The ring that shows the brush's width, for a mouse or pen.
  function moveRing(e: PointerEvent): void {
    if (!ring) return;
    if (e.pointerType === 'touch') {
      ring.style.opacity = '0';
      return;
    }
    ring.style.translate = `${e.clientX}px ${e.clientY}px`;
    ring.style.opacity = '1';
  }
  function sizeRing(): void {
    if (!ring) return;
    ring.style.width = ring.style.height = `${state.brush}px`;
    ring.style.margin = `${-state.brush / 2}px 0 0 ${-state.brush / 2}px`;
    ring.toggleAttribute('data-erase', state.mode === 'erase');
  }
  canvas.addEventListener('pointerleave', () => {
    if (ring) ring.style.opacity = '0';
  });

  // ---- shapes that draw themselves ----

  let playing: { strokes: Stroke[]; t: number; duration: number; bands: [number, number][]; drawn: number[] } | null =
    null;

  function playShape(id: string): void {
    const shape = SHAPES.find((s) => s.id === id);
    if (!shape) return;
    if (playing) finishPlaying();
    if (shape.passage && shape.passage !== state.passage.id) choosePassage(shape.passage, true);
    remember();
    state.strokes = [];
    mask.clear();
    rowsDirty = [0, H];
    const strokes = shape.build(W, H, state.size);
    dismissHint();
    playing = {
      strokes,
      t: 0,
      duration: still.matches ? 0 : 2.6,
      bands: strokes.map((s) => Mask.extent(s)),
      drawn: strokes.map(() => 0),
    };
    request();
  }

  /** Draw the next slice of each stroke: lines along their length, fills from the top down. */
  function playStep(dt: number): void {
    const p = playing!;
    p.t += dt;
    const done = p.duration === 0 || p.t >= p.duration;
    const k = done ? 1 : 1 - Math.pow(1 - p.t / p.duration, 2);
    p.strokes.forEach((s, i) => {
      if (s.kind === 'line') {
        const count = s.pts.length / 3;
        const upto = Math.round(k * (count - 1));
        for (let j = Math.max(1, p.drawn[i]); j <= upto; j++) {
          const a = (j - 1) * 3;
          const b = j * 3;
          mask.segment(s.mode, s.pts[a], s.pts[a + 1], s.pts[a + 2], s.pts[b], s.pts[b + 1], s.pts[b + 2]);
        }
        if (p.drawn[i] === 0) mask.dot(s.mode, s.pts[0], s.pts[1], s.pts[2]);
        p.drawn[i] = Math.max(p.drawn[i], upto, 1);
      } else {
        const [y0, y1] = p.bands[i];
        // Bands land on whole mask cells, so no seam is painted twice.
        const from = p.drawn[i] || Math.floor((y0 - 1) / CELL) * CELL;
        const to = Math.ceil((y0 + (y1 - y0) * k + 1) / CELL) * CELL;
        if (to > from) mask.fill(s.mode, s.rings, [from, to]);
        p.drawn[i] = to;
      }
    });
    if (done) {
      state.strokes = p.strokes;
      playing = null;
      washHold = 0.9;
      syncButtons();
    }
  }

  function finishPlaying(): void {
    if (!playing) return;
    playing.duration = 0;
    playStep(0);
  }

  // ---- tools ----

  function setMode(mode: Mode): void {
    state.mode = mode;
    const radio = root.querySelector<HTMLInputElement>(`[data-tool][value="${mode}"]`);
    if (radio) radio.checked = true;
    sizeRing();
  }
  root.querySelectorAll<HTMLInputElement>('[data-tool]').forEach((r) =>
    r.addEventListener('change', () => setMode(r.value as Mode)),
  );

  function setBrush(width: number): void {
    state.brush = Math.max(24, Math.min(260, width));
    if (brushInput) brushInput.value = String(state.brush);
    sizeRing();
  }
  brushInput?.addEventListener('input', () => setBrush(Number(brushInput.value)));

  sizeInput?.addEventListener('input', async () => {
    state.size = Number(sizeInput.value);
    await loadFace();
    retype();
  });

  function passageFor(id: string): Passage {
    if (id === 'setter') return SETTER;
    if (id === 'own') {
      return {
        id: 'own',
        title: 'Your words',
        credit: '',
        text: state.ownText.trim() || 'Type something in the box, and it fills whatever you draw.',
      };
    }
    return PASSAGES.find((p) => p.id === id) ?? PASSAGES[0];
  }

  function choosePassage(id: string, check = false): void {
    state.passage = passageFor(id);
    if (check) {
      const radio = root.querySelector<HTMLInputElement>(`[data-passage][value="${id}"]`);
      if (radio) radio.checked = true;
    }
    if (own) own.hidden = id !== 'own';
    ink.retire();
    retype();
  }
  root.querySelectorAll<HTMLInputElement>('[data-passage]').forEach((r) =>
    r.addEventListener('change', () => {
      choosePassage(r.value);
      if (r.value === 'own') own?.focus();
    }),
  );

  // Your own words reflow as you type. Words before the change keep their
  // places; everything after it moves on.
  let typing = 0;
  own?.addEventListener('input', () => {
    state.ownText = own.value;
    window.clearTimeout(typing);
    typing = window.setTimeout(() => {
      state.passage = passageFor('own');
      retype();
    }, 60);
  });

  $<HTMLInputElement>('[data-italic]')?.addEventListener('change', async (e) => {
    state.italic = (e.target as HTMLInputElement).checked;
    await loadFace();
    retype();
  });
  $<HTMLInputElement>('[data-byshape]')?.addEventListener('change', (e) => {
    state.byShape = (e.target as HTMLInputElement).checked;
    needsLayout = true;
    request();
  });
  $<HTMLInputElement>('[data-wash]')?.addEventListener('change', (e) => {
    state.keepWash = (e.target as HTMLInputElement).checked;
    request();
  });

  root.querySelectorAll<HTMLButtonElement>('[data-shape]').forEach((b) =>
    b.addEventListener('click', () => {
      document.getElementById('wb-shapes')?.hidePopover?.();
      playShape(b.dataset.shape ?? '');
    }),
  );

  function undo(): void {
    if (live) return;
    if (playing) finishPlaying();
    const previous = history.pop();
    if (!previous) return;
    state.strokes = previous;
    rebuildMask();
    syncButtons();
  }
  undoButton?.addEventListener('click', undo);

  clearButton?.addEventListener('click', () => {
    if (playing) finishPlaying();
    if (!state.strokes.length) return;
    remember();
    state.strokes = [];
    rebuildMask();
    syncButtons();
  });

  saveButton?.addEventListener('click', () => {
    const out = document.createElement('canvas');
    const scale = Math.max(2, dpr);
    out.width = Math.round(W * scale);
    out.height = Math.round(H * scale);
    const o = out.getContext('2d');
    if (!o) return;
    o.scale(scale, scale);
    o.fillStyle = PAPER;
    o.fillRect(0, 0, W, H);
    if (state.keepWash) {
      o.globalAlpha = 0.1;
      o.drawImage(mask.canvas, 0, 0, W, H);
      o.globalAlpha = 1;
    }
    o.font = font();
    o.textBaseline = 'alphabetic';
    ink.draw(o, INK, RED, true);
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'word-brush.png';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }, 'image/png');
  });

  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('textarea, input[type="text"]')) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'b' || e.key === 'B') setMode('paint');
    else if (e.key === 'e' || e.key === 'E') setMode('erase');
    else if (e.key === '[') setBrush(state.brush - 10);
    else if (e.key === ']') setBrush(state.brush + 10);
  });

  // ---- start ----

  async function loadFace(): Promise<void> {
    try {
      await document.fonts.load(font());
    } catch {
      // Measure with whatever face the browser has; Pretext will match it.
    }
  }

  sizeRing();
  resize();
  let resizing = 0;
  window.addEventListener('resize', () => {
    window.cancelAnimationFrame(resizing);
    resizing = window.requestAnimationFrame(resize);
  });

  loadFace().then(() => {
    ready = true;
    retype();
  });
}
