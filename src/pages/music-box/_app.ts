// Music box: the bench, the strip, the crank, and the comb's voice, wired together.

import { CombSound, ringTime } from './_sound';
import {
  LEAD,
  TAIL,
  cellAt,
  drawBench,
  layout,
  onPaper,
  paintMovement,
  paintPaper,
  paintTable,
  type Layout,
  type Ring,
} from './_scene';
import { ROWS, TUNES, blankStrip, decodeStrip, encodeStrip, midiOfRow, noteName, type Strip } from './_tunes';

/** One full turn of the crank draws four eighth notes of paper through. */
const COLS_PER_TURN = 4;
const GEAR_TEETH = 12;
/** Notes are scheduled this far ahead, so frame timing doesn't jitter the rhythm. */
const LOOKAHEAD = 0.035;
const STORE = 'musicbox:strip';

interface Saved {
  code: string;
  title: string;
  tempo: number;
}

const load = (): Saved | null => {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
};

const save = (data: Saved) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(data));
  } catch {
    // Private windows may refuse storage; the strip still works.
  }
};

export function startMusicBox(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-bench]');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel);
  const titleEl = $<HTMLElement>('[data-tune-title]');
  const cue = $<HTMLElement>('[data-cue]');
  const note = $<HTMLElement>('[data-note]');
  const autoBtn = $<HTMLButtonElement>('[data-auto]');
  const tempoIn = $<HTMLInputElement>('[data-tempo]');
  const tempoOut = $<HTMLOutputElement>('[data-tempo-out]');
  const tableBtn = $<HTMLButtonElement>('[data-table]');

  const sound = new CombSound();
  const debug = new URLSearchParams(location.search).has('debug');

  let L: Layout;
  let table: HTMLCanvasElement;
  let movement: HTMLCanvasElement;
  const paperTile = paintPaper();
  const paper = ctx.createPattern(paperTile, 'repeat');

  let strip: Strip = blankStrip();
  let title = '';
  let s = -LEAD;
  let crankAngle = -Math.PI / 2;
  let tempo = 84;
  let auto = false;
  let held = false;
  let rewind: { from: number; t0: number } | null = null;
  let hover: { col: number; row: number } | null = null;
  let cranked = false;
  let dirty = true;
  let speed = 0;
  const rings: Array<Ring | null> = new Array(ROWS).fill(null);
  let lastGearTooth = 0;
  let ratchetAccum = 0;

  // --- Strip state ---

  const persist = () => save({ code: encodeStrip(strip), title, tempo });

  const setTitle = (text: string) => {
    title = text;
    if (titleEl) titleEl.textContent = text;
  };

  const setTempo = (bpm: number) => {
    tempo = Math.round(bpm);
    if (tempoIn) tempoIn.value = String(tempo);
    if (tempoOut) tempoOut.value = String(tempo);
  };

  const setStrip = (next: Strip, name: string, bpm?: number) => {
    strip = next;
    s = -LEAD;
    rewind = null;
    setAuto(false);
    setTitle(name);
    if (bpm) setTempo(bpm);
    rings.fill(null);
    dirty = true;
    persist();
  };

  let noteTimer = 0;
  const say = (text: string, ms = 2600) => {
    if (!note) return;
    note.textContent = text;
    note.classList.add('on');
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => note.classList.remove('on'), ms);
  };

  // --- Layout ---

  const fontFamily = () =>
    getComputedStyle(root).getPropertyValue('--font-musicbox').trim() || "'Cormorant Garamond', Georgia, serif";

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = root.clientWidth;
    const h = root.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    L = layout(w, h, dpr, fontFamily());
    table = paintTable(L);
    movement = paintMovement(L);
    placeCue();
    dirty = true;
  };

  const placeCue = () => {
    if (!cue || !L) return;
    const { x, y, r } = L.crank;
    cue.style.left = `${x - r * 0.75}px`;
    cue.style.top = `${y - r * 0.55}px`;
    if (L.phone) {
      cue.style.left = `${x + r + 104}px`;
      cue.style.top = `${y - r * 0.2}px`;
    }
  };

  // --- Playing ---

  const toPerf = (audioTime: number) =>
    sound.ctx ? performance.now() / 1000 + (audioTime - sound.ctx.currentTime) : performance.now() / 1000;

  /** Draws `ds` columns of paper past the star wheels over `dt` seconds, picking every open hole it crosses. */
  const advance = (ds: number, dt: number) => {
    if (ds <= 0) return;
    const end = strip.length + TAIL;
    const from = s;
    const to = Math.min(end, s + ds);
    const rate = ds / Math.max(dt, 1 / 240);
    const now = sound.ctx?.currentTime ?? 0;
    for (let c = Math.max(0, Math.floor(from) + 1); c <= Math.floor(to) && c < strip.length; c++) {
      const when = now + LOOKAHEAD + (c - from) / rate;
      for (let r = 0; r < ROWS; r++) {
        if (strip.cells[c * ROWS + r] !== 1) continue;
        const midi = midiOfRow(r);
        sound.pluck(r, midi, 0.86 + Math.random() * 0.1, when);
        rings[r] = { start: toPerf(when), tau: ringTime(midi) / 6.91 };
      }
    }
    s = to;
    crankAngle += (ds / COLS_PER_TURN) * Math.PI * 2;
    const tooth = Math.floor((crankAngle / (Math.PI * 2)) * GEAR_TEETH);
    if (tooth !== lastGearTooth) {
      lastGearTooth = tooth;
      sound.gear();
    }
    if (from < strip.length && to >= strip.length) {
      setAuto(false);
      say('The strip has run through. Rewind to hear it again.', 4200);
    }
    dirty = true;
  };

  const setAuto = (on: boolean) => {
    auto = on;
    autoBtn?.setAttribute('aria-pressed', String(on));
    if (on) {
      sound.wake();
      markCranked();
      if (s >= strip.length) startRewind();
    }
  };

  const startRewind = () => {
    if (s <= -LEAD) return;
    rewind = { from: s, t0: performance.now() };
  };

  const markCranked = () => {
    if (cranked) return;
    cranked = true;
    if (cue) cue.hidden = true;
    dirty = true;
  };

  // --- Pointer input ---

  type Drag =
    | { kind: 'crank'; id: number; angle: number; t: number }
    | { kind: 'paper'; id: number; x0: number; y0: number; x: number; moved: boolean };
  let drag: Drag | null = null;

  const point = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const nearCrank = (x: number, y: number) => {
    const d = Math.hypot(x - L.crank.x, y - L.crank.y);
    return d < L.crank.r + 30;
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = point(e);
    sound.wake();
    if (nearCrank(p.x, p.y)) {
      drag = { kind: 'crank', id: e.pointerId, angle: Math.atan2(p.y - L.crank.y, p.x - L.crank.x), t: performance.now() };
      rewind = null;
    } else if (onPaper(L, strip, s, p.x, p.y)) {
      drag = { kind: 'paper', id: e.pointerId, x0: p.x, y0: p.y, x: p.x, moved: false };
    } else {
      return;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; the drag still works while over the canvas.
    }
    dirty = true;
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = point(e);
    if (drag && drag.id === e.pointerId) {
      if (drag.kind === 'crank') {
        const a = Math.atan2(p.y - L.crank.y, p.x - L.crank.x);
        let da = a - drag.angle;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        const t = performance.now();
        if (da > 0) {
          advance((da / (Math.PI * 2)) * COLS_PER_TURN, (t - drag.t) / 1000);
          speed = speed * 0.6 + (((da / (Math.PI * 2)) * COLS_PER_TURN) / Math.max(0.004, (t - drag.t) / 1000)) * 0.4;
          if (Math.abs(da) > 0.02) markCranked();
          ratchetAccum = 0;
        } else {
          // The pawl holds: the crank won't go back, it just clicks.
          ratchetAccum += -da;
          if (ratchetAccum > (Math.PI * 2) / 20) {
            ratchetAccum = 0;
            sound.ratchet();
          }
        }
        drag.angle = a;
        drag.t = t;
      } else {
        if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) > 6) drag.moved = true;
        if (drag.moved) {
          slide(-(p.x - drag.x) / L.colW);
          hover = null;
        }
        drag.x = p.x;
      }
      dirty = true;
      return;
    }
    const next = e.pointerType === 'mouse' ? cellAt(L, strip, s, p.x, p.y) : null;
    if (next?.col !== hover?.col || next?.row !== hover?.row) {
      hover = next;
      dirty = true;
    }
    canvas.style.cursor = nearCrank(p.x, p.y) ? 'grab' : next ? 'crosshair' : onPaper(L, strip, s, p.x, p.y) ? 'ew-resize' : '';
  });

  const endDrag = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.kind === 'paper' && !drag.moved && e.type === 'pointerup') {
      const p = point(e);
      const cell = cellAt(L, strip, s, p.x, p.y);
      if (cell) punch(cell.col, cell.row);
    }
    drag = null;
    dirty = true;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    if (hover) {
      hover = null;
      dirty = true;
    }
  });

  const slide = (dCols: number) => {
    rewind = null;
    s = Math.min(strip.length + TAIL, Math.max(-LEAD - 2, s + dCols));
    dirty = true;
  };

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const px = e.deltaMode === 1 ? d * 16 : d;
      slide(px / L.colW / 2);
    },
    { passive: false },
  );

  const punch = (col: number, row: number) => {
    const i = col * ROWS + row;
    const state = strip.cells[i];
    sound.wake();
    if (state === 1) {
      strip.cells[i] = 2;
      sound.tape();
      say(`${noteName(midiOfRow(row))} taped over`, 1400);
    } else {
      strip.cells[i] = 1;
      sound.punch();
      // Thumb the tooth, the way you'd check a note before punching the next.
      const midi = midiOfRow(row);
      sound.pluck(row, midi, 0.5, (sound.ctx?.currentTime ?? 0) + 0.06);
      rings[row] = { start: performance.now() / 1000 + 0.06, tau: ringTime(midi) / 6.91 };
    }
    persist();
    dirty = true;
  };

  // --- Keyboard ---

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) {
      if (e.key !== ' ' || e.target instanceof HTMLInputElement) return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) {
        held = true;
        sound.wake();
        markCranked();
        rewind = null;
      }
    } else if (e.key === 'ArrowRight') {
      slide(e.shiftKey ? 8 : 1);
    } else if (e.key === 'ArrowLeft') {
      slide(e.shiftKey ? -8 : -1);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') held = false;
  });
  window.addEventListener('blur', () => {
    held = false;
  });

  // --- Controls ---

  autoBtn?.addEventListener('click', () => setAuto(!auto));
  // Space on the focused button should crank, not toggle it.
  autoBtn?.addEventListener('keydown', (e) => {
    if (e.key === ' ') e.preventDefault();
  });
  autoBtn?.addEventListener('keyup', (e) => {
    if (e.key === ' ') e.preventDefault();
  });
  tempoIn?.addEventListener('input', () => {
    setTempo(Number(tempoIn.value));
    persist();
  });
  $<HTMLButtonElement>('[data-rewind]')?.addEventListener('click', () => {
    setAuto(false);
    startRewind();
  });
  $<HTMLButtonElement>('[data-extend]')?.addEventListener('click', () => {
    const add = strip.bar * 8;
    const cells = new Uint8Array((strip.length + add) * ROWS);
    cells.set(strip.cells);
    strip = { ...strip, cells, seams: [...strip.seams, strip.length], length: strip.length + add };
    say(`Glued on ${add / strip.bar} more bars`, 1800);
    persist();
    dirty = true;
  });
  $<HTMLButtonElement>('[data-blank]')?.addEventListener('click', () => {
    setStrip(blankStrip(), 'A fresh strip');
    say('A fresh strip is in. Click it to punch.', 2400);
  });
  $<HTMLButtonElement>('[data-share]')?.addEventListener('click', async () => {
    const url = new URL(location.href);
    url.search = '';
    url.hash = `s=${encodeStrip(strip)}&t=${tempo}`;
    try {
      await navigator.clipboard.writeText(url.toString());
      say('Link copied: it carries every hole on the strip');
    } catch {
      history.replaceState(null, '', url);
      say('The link to this strip is in the address bar');
    }
  });
  tableBtn?.addEventListener('click', () => {
    const on = tableBtn.getAttribute('aria-pressed') !== 'true';
    tableBtn.setAttribute('aria-pressed', String(on));
    tableBtn.textContent = on ? 'On the table' : 'In the hand';
    sound.setTable(on);
    sound.wake();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-tune]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tune = TUNES.find((t) => t.id === btn.dataset.tune);
      if (!tune) return;
      setStrip(tune.build(), `${tune.title} · ${tune.by}`, tune.tempo);
      say('Strip fed in. Turn the crank.', 2000);
    });
  });

  // --- Opening strip: a shared link, the last one on this bench, or the lullaby ---

  const opening = () => {
    const hash = new URLSearchParams(location.hash.slice(1));
    const shared = hash.get('s');
    if (shared) {
      const decoded = decodeStrip(shared);
      if (decoded) {
        setStrip(decoded, 'A strip someone punched for you', Number(hash.get('t')) || 84);
        return;
      }
    }
    const saved = load();
    const restored = saved ? decodeStrip(saved.code) : null;
    if (saved && restored) {
      setStrip(restored, saved.title || 'Your strip', saved.tempo || 84);
      return;
    }
    const first = TUNES[0]!;
    setStrip(first.build(), `${first.title} · ${first.by}`, first.tempo);
  };

  // --- Frame loop ---

  let last = performance.now();
  const frame = (t: number) => {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;

    if (rewind) {
      const k = Math.min(1, (t - rewind.t0) / 700);
      const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const target = -LEAD;
      const prev = s;
      s = rewind.from + (target - rewind.from) * ease;
      speed = (s - prev) / Math.max(dt, 0.001);
      if (k >= 1) rewind = null;
      dirty = true;
    } else if (auto || held) {
      const rate = (tempo / 60) * 2;
      advance(rate * dt, dt);
      speed = rate;
    } else if (!drag || drag.kind !== 'crank') {
      speed *= 0.8;
    } else {
      speed *= 0.92;
    }
    sound.setRustle(speed);

    const now = performance.now() / 1000;
    const ringing = rings.some((r) => r && now - r.start < r.tau * 4);
    if (dirty || ringing || auto || held || rewind) {
      drawBench(ctx, L, table, paper, movement, {
        strip,
        s,
        crankAngle,
        hover: drag ? null : hover,
        rings,
        now,
        showGuide: !cranked,
        grabbing: drag?.kind === 'crank',
      });
      dirty = false;
    }
    requestAnimationFrame(frame);
  };

  resize();
  opening();
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 120);
  });
  // Engraving and print use the page's face; redraw once it has loaded.
  document.fonts?.ready.then(() => resize());
  if (cue) cue.hidden = false;
  requestAnimationFrame(frame);

  if (debug) {
    (window as unknown as Record<string, unknown>).musicbox = {
      get s() {
        return s;
      },
      get strip() {
        return strip;
      },
      layout: () => L,
      crank: (cols: number) => advance(cols, cols / ((tempo / 60) * 2)),
      punch,
      slide,
      setS: (v: number) => {
        s = v;
        dirty = true;
      },
      sound,
    };
  }
}
