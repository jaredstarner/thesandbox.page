// The page half of /stereogram/: sizes the sheet, routes input to the worker,
// draws the bitmaps it sends back, and runs the depth test.

import { depthFor, separation } from './_sirds';
import { ground, type Grain, type InkId } from './_inks';
import type { Brush, Disc } from './_scenes';
import type { Message, Plate, Reply } from './_worker';

interface Look {
  ink: InkId;
  grain: Grain;
  shimmer: boolean;
  cross: boolean;
}

const LOOK_KEY = 'stereogram:look';
const HELP_KEY = 'stereogram:seen-help';
const INKS: InkId[] = ['newsprint', 'riso', 'phosphor', 'ember'];
const GRAINS: Grain[] = ['fine', 'coarse', 'mottle'];

/** Assumed for the test: a CSS pixel is 1/96 inch, and the eyes are 60 cm from the screen. */
const MM_PER_CSS_PX = 25.4 / 96;
const VIEWING_MM = 600;
const ARCSEC_PER_RADIAN = 206265;

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and blocked storage just forget.
  }
}

export function start(root: HTMLElement) {
  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const $$ = <T extends Element>(sel: string) => [...root.querySelectorAll(sel)] as T[];

  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') {
    $<HTMLElement>('[data-unsupported]').hidden = false;
    return;
  }

  const field = $<HTMLElement>('[data-field]');
  const sheetCanvas = $<HTMLCanvasElement>('[data-sheet]');
  const slideCanvas = $<HTMLCanvasElement>('[data-slide]');
  const veil = $<HTMLElement>('[data-veil]');
  const readout = $<HTMLElement>('[data-readout]');
  const guides = $<HTMLElement>('[data-guides]');
  const sheetCtx = sheetCanvas.getContext('2d')!;
  const slideCtx = slideCanvas.getContext('2d')!;

  const worker = new Worker(new URL('./_worker.ts', import.meta.url), { type: 'module' });
  const send = (m: Message, transfer: Transferable[] = []) => worker.postMessage(m, transfer);

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const stored = load<Partial<Look>>(LOOK_KEY) ?? {};
  const look: Look = {
    ink: INKS.includes(stored.ink as InkId) ? (stored.ink as InkId) : 'newsprint',
    grain: GRAINS.includes(stored.grain as Grain) ? (stored.grain as Grain) : 'mottle',
    shimmer: stored.shimmer === true,
    cross: stored.cross === true,
  };

  let plate: Plate = 'ring';
  let cssW = 0;
  let cssH = 0;
  let scale = 1;
  let W = 0;
  let H = 0;
  let eye = 0;
  let busy = false;
  let sliding = false;
  let slideOffset = 0;

  // ------------------------------------------------------------ look

  const sendLook = () => {
    root.dataset.ink = look.ink;
    document.body.style.background = ground(look.ink);
    for (const b of $$<HTMLButtonElement>('[data-ink-pick]')) b.ariaPressed = String(b.dataset.inkPick === look.ink);
    for (const b of $$<HTMLButtonElement>('[data-grain]')) b.ariaPressed = String(b.dataset.grain === look.grain);
    $<HTMLInputElement>('[data-shimmer]').checked = look.shimmer;
    $<HTMLInputElement>('[data-cross]').checked = look.cross;
    send({ type: 'look', ...look, still: motion.matches });
    save(LOOK_KEY, look);
    placeGuides();
  };

  // ------------------------------------------------------------ size

  const placeGuides = () => {
    if (!eye) return;
    // The guide dots sit at the separation of whatever is the background: the far plane, or the near one when crossed.
    const s = separation(look.cross ? 1 : 0, eye) / scale;
    guides.style.setProperty('--guide-x', `${s / 2}px`);
  };

  const resize = () => {
    const rect = field.getBoundingClientRect();
    cssW = rect.width;
    cssH = rect.height;
    if (cssW < 40 || cssH < 40) return;
    // The test draws in device pixels, so its steps in depth are as fine as the screen allows.
    scale = plate === 'test' ? Math.max(1, devicePixelRatio) : look.grain === 'coarse' ? 0.5 : 1;
    const far = Math.round(Math.min(120, cssW / 3.3) * scale);
    const nw = Math.round(cssW * scale);
    const nh = Math.round(cssH * scale);
    if (nw === W && nh === H && far * 2 === eye) return;
    W = nw;
    H = nh;
    eye = far * 2;
    send({ type: 'size', w: W, h: H, eye });
    placeGuides();
    if (plate === 'word') queueWords();
    if (plate === 'test' && trial) showTrial();
    if (sliding) setSlide(Math.min(slideOffset, W / 2));
  };

  new ResizeObserver(resize).observe(field);

  // ------------------------------------------------------------ frames

  const draw = (reply: Extract<Reply, { type: 'frame' }>) => {
    for (const c of [sheetCanvas, slideCanvas]) {
      if (c.width !== reply.w || c.height !== reply.h) {
        c.width = reply.w;
        c.height = reply.h;
      }
    }
    sheetCtx.drawImage(reply.bitmap, 0, 0);
    if (sliding) slideCtx.drawImage(reply.bitmap, 0, 0);
    reply.bitmap.close();
  };

  worker.onmessage = (event: MessageEvent<Reply>) => {
    busy = false;
    if (event.data.type === 'frame') draw(event.data);
  };

  const tick = (t: number) => {
    requestAnimationFrame(tick);
    if (busy || !W) return;
    busy = true;
    send({ type: 'frame', t });
  };
  requestAnimationFrame(tick);

  // ------------------------------------------------------------ plates

  const tools = $$<HTMLElement>('[data-tool]');

  const setPlate = (next: Plate) => {
    if (next !== plate && plate === 'test') endTest();
    plate = next;
    root.dataset.plate = plate;
    for (const b of $$<HTMLButtonElement>('[data-plate-pick]')) b.ariaPressed = String(b.dataset.platePick === plate);
    for (const t of tools) t.hidden = t.dataset.tool !== plate;
    send({ type: 'plate', plate });
    resize();
    if (plate === 'word') queueWords();
    if (plate === 'test') openTest();
  };

  for (const b of $$<HTMLButtonElement>('[data-plate-pick]')) {
    b.addEventListener('click', () => setPlate(b.dataset.platePick as Plate));
  }

  for (const b of $$<HTMLButtonElement>('[data-shape]')) {
    b.addEventListener('click', () => {
      for (const o of $$<HTMLButtonElement>('[data-shape]')) o.ariaPressed = String(o === b);
      send({ type: 'shape', shape: b.dataset.shape as 'torus' | 'knot' });
    });
  }

  // ------------------------------------------------------------ words

  const wordsInput = $<HTMLInputElement>('[data-words]');
  let wordsTimer = 0;

  const renderWords = async () => {
    const text = wordsInput.value.trim() || ' ';
    const family = getComputedStyle(root).getPropertyValue('--font-stereogram').trim() || 'sans-serif';
    try {
      await document.fonts.load(`800 64px ${family}`, text);
    } catch {
      // Draw with the fallback face.
    }
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d')!;
    g.font = `800 100px ${family}`;
    const width = Math.max(1, g.measureText(text).width);
    const size = Math.min(H * 0.46, (100 * W * 0.84) / width);
    g.font = `800 ${size}px ${family}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    const m = g.measureText(text);
    // Centre on the ink, not the em box.
    const mid = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    g.fillText(text, W / 2, H / 2 + mid);
    const rgba = g.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3];
    send({ type: 'words', mask, w: W, h: H, radius: size * 0.07 }, [mask.buffer]);
  };

  const queueWords = () => {
    clearTimeout(wordsTimer);
    wordsTimer = window.setTimeout(() => void renderWords(), 90);
  };
  wordsInput.addEventListener('input', queueWords);

  // ------------------------------------------------------------ carving

  let brush: Brush = 'raise';
  const sizeInput = $<HTMLInputElement>('[data-brush-size]');
  for (const b of $$<HTMLButtonElement>('[data-brush]')) {
    b.addEventListener('click', () => {
      brush = b.dataset.brush as Brush;
      for (const o of $$<HTMLButtonElement>('[data-brush]')) o.ariaPressed = String(o === b);
    });
  }
  $<HTMLButtonElement>('[data-clear]').addEventListener('click', () => send({ type: 'clear' }));

  // ------------------------------------------------------------ pointer

  const toSheet = (e: PointerEvent) => {
    const rect = field.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) * W) / rect.width, y: ((e.clientY - rect.top) * H) / rect.height };
  };

  let down: { x: number; y: number; cx: number; last: number } | null = null;

  field.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    try {
      field.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured.
    }
    const p = toSheet(e);
    down = { ...p, cx: e.clientX, last: performance.now() };
    if (sliding) return;
    if (plate === 'pond') send({ type: 'drop', x: p.x, y: p.y, strength: 1 });
    if (plate === 'sculpt') {
      const r = Number(sizeInput.value) * scale;
      send({ type: 'stroke', points: [p.x, p.y], r, brush });
    }
    if (plate === 'test' && trial && !trial.answered) pickNearest(p.x, p.y);
  });

  field.addEventListener('pointermove', (e) => {
    const p = toSheet(e);
    if (plate === 'sculpt' && !sliding) {
      send({ type: 'cursor', x: p.x, y: p.y, r: Number(sizeInput.value) * scale });
    }
    if (!down) return;
    if (sliding) {
      setSlide(slideOffset - ((e.clientX - down.cx) * W) / field.getBoundingClientRect().width);
      down.cx = e.clientX;
      return;
    }
    if (plate === 'sculpt') {
      const r = Number(sizeInput.value) * scale;
      const step = Math.max(1, r / 4);
      const dist = Math.hypot(p.x - down.x, p.y - down.y);
      if (dist < step) return;
      const points: number[] = [];
      for (let d = step; d <= dist; d += step) {
        points.push(down.x + ((p.x - down.x) * d) / dist, down.y + ((p.y - down.y) * d) / dist);
      }
      const n = points.length;
      down.x = points[n - 2];
      down.y = points[n - 1];
      send({ type: 'stroke', points, r, brush });
    }
    if (plate === 'pond') {
      const now = performance.now();
      if (now - down.last > 70) {
        down.last = now;
        send({ type: 'drop', x: p.x, y: p.y, strength: 0.35 });
      }
    }
  });

  const lift = () => {
    down = null;
  };
  field.addEventListener('pointerup', lift);
  field.addEventListener('pointercancel', lift);
  field.addEventListener('pointerleave', () => {
    if (plate === 'sculpt') send({ type: 'cursor', x: null });
  });

  // ------------------------------------------------------------ slide

  const slideButton = $<HTMLButtonElement>('[data-slide-toggle]');

  const setSlide = (offset: number) => {
    slideOffset = Math.round(Math.min(W / 2, Math.max(8, offset)));
    const css = slideOffset / scale;
    slideCanvas.style.transform = `translateX(${-css}px)`;
    veil.style.width = `${css}px`;
    const z = depthFor(slideOffset, eye);
    const where =
      slideOffset === separation(look.cross ? 1 : 0, eye)
        ? 'the background cancels out'
        : z > 0 && z <= 1
          ? `cancels whatever stands ${Math.round((look.cross ? 1 - z : z) * 100)}% of the way up`
          : 'nothing cancels at this shift';
    readout.textContent = `Shifted ${Math.round(css)} px: ${where}`;
  };

  const toggleSlide = (on: boolean) => {
    sliding = on;
    slideButton.ariaPressed = String(on);
    root.toggleAttribute('data-sliding', on);
    slideCanvas.hidden = veil.hidden = readout.hidden = !on;
    if (on) {
      slideCtx.drawImage(sheetCanvas, 0, 0);
      setSlide(separation(look.cross ? 1 : 0, eye));
    }
  };
  slideButton.addEventListener('click', () => toggleSlide(!sliding));

  // ------------------------------------------------------------ look panel

  for (const b of $$<HTMLButtonElement>('[data-ink-pick]')) {
    b.addEventListener('click', () => {
      look.ink = b.dataset.inkPick as InkId;
      sendLook();
    });
  }
  for (const b of $$<HTMLButtonElement>('[data-grain]')) {
    b.addEventListener('click', () => {
      look.grain = b.dataset.grain as Grain;
      sendLook();
      resize();
    });
  }
  $<HTMLInputElement>('[data-shimmer]').addEventListener('change', (e) => {
    look.shimmer = (e.target as HTMLInputElement).checked;
    sendLook();
  });
  $<HTMLInputElement>('[data-cross]').addEventListener('change', (e) => {
    look.cross = (e.target as HTMLInputElement).checked;
    sendLook();
    if (sliding) setSlide(separation(look.cross ? 1 : 0, eye));
  });
  motion.addEventListener('change', sendLook);

  // ------------------------------------------------------------ save

  $<HTMLButtonElement>('[data-save]').addEventListener('click', () => {
    if (!W) return;
    const strip = Math.round(36 * scale);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H + strip;
    const g = c.getContext('2d')!;
    g.drawImage(sheetCanvas, 0, 0);
    g.fillStyle = ground(look.ink);
    g.fillRect(0, H, W, strip);
    g.fillStyle = getComputedStyle(root).getPropertyValue('--ink').trim() || '#000';
    const s = separation(look.cross ? 1 : 0, eye);
    for (const x of [W / 2 - s / 2, W / 2 + s / 2]) {
      g.beginPath();
      g.arc(x, H + strip / 2, 6 * scale, 0, Math.PI * 2);
      g.fill();
    }
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `stereogram-${plate}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  });

  // ------------------------------------------------------------ test

  const card = $<HTMLElement>('[data-test-card]');
  const intro = $<HTMLElement>('[data-test-intro]');
  const result = $<HTMLElement>('[data-test-result]');
  const status = $<HTMLElement>('[data-test-status]');
  const LEVELS = [16, 12, 8, 6, 4, 3, 2, 1];

  interface Run {
    level: number;
    streak: number;
    direction: 0 | 1 | -1;
    reversals: number[];
    trials: number;
    misses: number;
    floorHits: number;
  }
  let run: Run | null = null;
  let trial: { target: number; seed: number; answered: boolean } | null = null;

  const layout = (): Disc[] => {
    const m = Math.min(W, H);
    const r = Math.round(m * 0.1);
    const d = m * 0.26;
    const cx = W / 2;
    const cy = H / 2;
    return [
      { x: cx, y: cy - d, r, z: 0 },
      { x: cx + d, y: cy, r, z: 0 },
      { x: cx, y: cy + d, r, z: 0 },
      { x: cx - d, y: cy, r, z: 0 },
    ];
  };

  const showTrial = () => {
    if (!run || !trial) return;
    // Every disc stands at the same height except the target, nearer by a whole number of pixels of separation.
    const base = separation(0.35, eye);
    const list = layout().map((disc, i) => ({
      ...disc,
      z: depthFor(i === trial!.target ? base - LEVELS[run!.level] : base, eye),
    }));
    send({ type: 'discs', discs: list, seed: trial.seed });
  };

  const nextTrial = () => {
    if (!run) return;
    trial = { target: Math.floor(Math.random() * 4), seed: (Math.random() * 2 ** 32) >>> 0, answered: false };
    status.textContent = `Trial ${run.trials + 1}: which disc is nearest? Arrow keys, or tap it`;
    showTrial();
  };

  const arcsec = (px: number) => ((px * MM_PER_CSS_PX) / scale / VIEWING_MM) * ARCSEC_PER_RADIAN;

  const finish = (kind: 'threshold' | 'floor' | 'none') => {
    if (!run) return;
    const r = run;
    run = null;
    trial = null;
    card.hidden = false;
    intro.hidden = true;
    result.hidden = false;
    const figure = $<HTMLElement>('[data-result-figure]');
    const note = $<HTMLElement>('[data-result-note]');
    const floor = Math.round(arcsec(1));
    if (kind === 'none') {
      $<HTMLElement>('[data-result-title]').textContent = 'No depth found';
      figure.textContent = '—';
      note.textContent =
        'The biggest step went unseen three times running. Try the Ring first with How to see it, then come back.';
    } else if (kind === 'floor') {
      figure.textContent = `${floor}″ or finer`;
      note.textContent = `You saw the smallest step this screen can draw, every time. That step is about ${floor} seconds of arc, assuming you sit about 60 cm away.`;
    } else {
      const tail = r.reversals.slice(2);
      const levels = tail.length >= 2 ? tail : r.reversals;
      const mean = Math.exp(levels.reduce((s, v) => s + Math.log(v), 0) / levels.length);
      figure.textContent = `${Math.round(arcsec(mean))}″`;
      note.textContent = `The smallest difference in depth you picked out reliably, as an angle between your two eyes' views, in seconds of arc, assuming you sit about 60 cm from the screen. This screen can't draw a step finer than ${floor}″.`;
    }
    status.textContent = 'Test finished';
  };

  const answer = (pick: number) => {
    if (!run || !trial || trial.answered) return;
    trial.answered = true;
    const r = run;
    r.trials++;
    const right = pick === trial.target;
    status.textContent = right ? 'Right' : 'Not that one';
    let move: 0 | 1 | -1 = 0;
    if (right) {
      r.misses = 0;
      r.streak++;
      if (r.streak >= 2) {
        r.streak = 0;
        if (r.level === LEVELS.length - 1) {
          r.floorHits++;
        } else move = 1;
      }
    } else {
      r.streak = 0;
      r.misses++;
      if (r.level === 0 && r.misses >= 3) return void setTimeout(() => finish('none'), 500);
      if (r.level > 0) move = -1;
    }
    if (move !== 0) {
      if (r.direction !== 0 && move !== r.direction) r.reversals.push(LEVELS[r.level]);
      r.direction = move;
      r.level += move;
    }
    let done: 'threshold' | 'floor' | null = null;
    if (r.floorHits >= 3) done = 'floor';
    else if (r.reversals.length >= 8 || r.trials >= 40) done = 'threshold';
    setTimeout(() => (done ? finish(r.reversals.length ? done : 'floor') : nextTrial()), 450);
  };

  const pickNearest = (x: number, y: number) => {
    const list = layout();
    let best = -1;
    let bestD = Infinity;
    list.forEach((d, i) => {
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    });
    if (best >= 0 && bestD < list[best].r * 1.8) answer(best);
  };

  const openTest = () => {
    run = null;
    trial = null;
    card.hidden = false;
    intro.hidden = false;
    result.hidden = true;
    status.textContent = 'Find the nearest disc';
    send({ type: 'discs', discs: layout().map((d) => ({ ...d, z: depthFor(separation(0.35, eye), eye) })), seed: 7 });
  };

  const endTest = () => {
    run = null;
    trial = null;
    card.hidden = true;
  };

  for (const b of $$<HTMLButtonElement>('[data-test-start]')) {
    b.addEventListener('click', () => {
      card.hidden = true;
      run = { level: 0, streak: 0, direction: 0, reversals: [], trials: 0, misses: 0, floorHits: 0 };
      nextTrial();
    });
  }

  // ------------------------------------------------------------ keys

  const ARROWS: Record<string, number> = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (sliding && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      setSlide(slideOffset + (e.key === 'ArrowRight' ? -1 : 1) * (e.shiftKey ? 10 : 1));
      e.preventDefault();
      return;
    }
    if (plate === 'test' && trial && e.key in ARROWS) {
      answer(ARROWS[e.key]);
      e.preventDefault();
    }
  });

  // ------------------------------------------------------------ go

  sendLook();
  resize();
  const help = document.getElementById('st-help');
  if (help && !load<boolean>(HELP_KEY)) {
    help.showPopover();
    save(HELP_KEY, true);
  }
}
