// The window and its work order: state, controls, drawing on the glass, and the frame loop.

import { GLASSES, GLASS_INDEX, Group, colourAt, glassLight, lineRgb, swatch, type GlassLight } from './_spectra';
import { plan, smoothStroke, type Plan, type Pt, type Style } from './_plan';
import { WINDOW, frame, paintFacade, paintFittings, type View } from './_facade';
import { Renderer, TYPES } from './_gl';
import { Sound } from './_sound';
import { PRESETS } from './_presets';

const STORE = 'neon-sign-v1';
const STYLES: Style[] = ['script', 'sans', 'square'];
const MAX_STROKES = 40;

interface LineState {
  text: string;
  style: Style;
  glass: string;
}

interface StrokeState {
  pts: Pt[];
  glass: string;
}

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const clean = (s: string) =>
  s
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, 18)
    .replace(/^\s+/, '');

function presetLines(i: number): LineState[] {
  return PRESETS[i].lines.map(([text, style, glass]) => ({ text, style, glass }));
}

function readHash(): LineState[] | null {
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    const out: LineState[] = [];
    for (const key of ['l1', 'l2']) {
      const raw = params.get(key);
      if (raw === null) return null;
      const [text = '', style = 'script', glass = 'neon-clear'] = raw.split('|');
      out.push({
        text: clean(text),
        style: STYLES.includes(style as Style) ? (style as Style) : 'script',
        glass: glass in GLASS_INDEX ? glass : 'neon-clear',
      });
    }
    return out;
  } catch {
    return null;
  }
}

function readStore(): { lines: LineState[]; drawn: StrokeState[]; pen: string } | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const data = JSON.parse(raw) as { lines?: LineState[]; drawn?: StrokeState[]; pen?: string };
    if (!Array.isArray(data.lines) || data.lines.length !== 2) return null;
    const lines = data.lines.map((l) => ({
      text: clean(String(l.text ?? '')),
      style: STYLES.includes(l.style) ? l.style : 'script',
      glass: l.glass in GLASS_INDEX ? l.glass : 'neon-clear',
    }));
    const drawn = (Array.isArray(data.drawn) ? data.drawn : [])
      .filter((s) => Array.isArray(s.pts) && s.pts.length > 1 && s.glass in GLASS_INDEX)
      .slice(0, MAX_STROKES)
      .map((s) => ({ glass: s.glass, pts: s.pts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })) }));
    const pen = typeof data.pen === 'string' && data.pen in GLASS_INDEX ? data.pen : 'coat-pink';
    return { lines, drawn, pen };
  } catch {
    return null;
  }
}

export function start(root: HTMLElement) {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel);
  const canvas = q<HTMLCanvasElement>('[data-scene]');
  const stage = q<HTMLElement>('[data-stage]');
  const docket = q<HTMLElement>('.docket');
  if (!canvas || !stage || !docket) return;

  let renderer: Renderer;
  try {
    renderer = new Renderer(canvas);
  } catch {
    q('[data-fallback]')?.removeAttribute('hidden');
    q('[data-hint]')?.setAttribute('hidden', '');
    return;
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lights: GlassLight[] = GLASSES.map(glassLight);
  renderer.setBodies(
    GLASSES.map((g) => ({
      rgb: [srgbToLinear(g.body[0]), srgbToLinear(g.body[1]), srgbToLinear(g.body[2])],
      a: g.bodyOpacity,
    })),
  );
  renderer.setLines(lights.map((l) => l.entries.map((e) => ({ nm: e.nm, rgb: e.rgb, group: e.group }))));

  const stored = readStore();
  const state = {
    lines: readHash() ?? stored?.lines ?? presetLines(0),
    drawn: stored?.drawn ?? ([] as StrokeState[]),
    pen: stored?.pen ?? 'coat-pink',
    on: false,
    grating: false,
    rain: !reduced,
    sound: true,
    drawing: false,
    spec: -1,
  };

  const sound = new Sound();
  const warm = new Float32Array(TYPES).fill(0.18);
  const strikeAt = new Float64Array(TYPES).fill(Infinity);
  let present = new Set<number>();
  let current: Plan = plan([], []);
  let view: View | null = null;
  let live: StrokeState | null = null;
  let devScale = 1;

  const fitCanvas = document.createElement('canvas');
  const fitCtx = fitCanvas.getContext('2d');
  const albCanvas = document.createElement('canvas');
  const clsCanvas = document.createElement('canvas');
  const albCtx = albCanvas.getContext('2d', { willReadFrequently: true });
  const clsCtx = clsCanvas.getContext('2d', { willReadFrequently: true });
  if (!fitCtx || !albCtx || !clsCtx) return;

  // The shop's printing face, resolved from the page's font variable so the canvas can use it.
  const family =
    getComputedStyle(document.documentElement).getPropertyValue('--font-neon-print').trim() ||
    getComputedStyle(root).getPropertyValue('--font-neon-print').trim() ||
    "'Arial Narrow', sans-serif";
  const fontsReady = document.fonts
    ? Promise.race([
        document.fonts.load(`700 40px ${family}`).then(() => undefined),
        new Promise<void>((r) => setTimeout(r, 1500)),
      ]).catch(() => undefined)
    : Promise.resolve();

  /* ---------- the work order ---------- */

  const lineEls = [...root.querySelectorAll<HTMLElement>('[data-line]')];
  const penSelect = q<HTMLSelectElement>('[data-pen-glass]');
  const undoBtn = q<HTMLButtonElement>('[data-undo]');
  const clearBtn = q<HTMLButtonElement>('[data-clear]');
  const drawBtn = q<HTMLButtonElement>('[data-draw]');
  const switchBtn = q<HTMLButtonElement>('[data-switch]');
  const switchWord = q<HTMLElement>('[data-switch-word]');
  const gratingBtn = q<HTMLButtonElement>('[data-grating]');
  const rainBtn = q<HTMLButtonElement>('[data-rain]');
  const soundBtn = q<HTMLButtonElement>('[data-sound]');
  const spreadWrap = q<HTMLElement>('[data-spread-wrap]');
  const spread = q<HTMLInputElement>('[data-spread]');
  const mount = q<HTMLElement>('[data-mount]');
  const hint = q<HTMLElement>('[data-hint]');
  const penHint = q<HTMLElement>('[data-pen-hint]');
  const specPick = q<HTMLElement>('[data-spec-pick]');
  const specNote = q<HTMLElement>('[data-spec-note]');
  const strip = q<HTMLCanvasElement>('[data-spectrum]');
  const stripCtx = strip?.getContext('2d') ?? null;

  function syncForm() {
    lineEls.forEach((el, i) => {
      const l = state.lines[i];
      const input = el.querySelector<HTMLInputElement>('[data-text]');
      if (input && input.value !== l.text) input.value = l.text;
      el.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.style === l.style)),
      );
      const sel = el.querySelector<HTMLSelectElement>('[data-glass]');
      if (sel) sel.value = l.glass;
    });
    if (penSelect) penSelect.value = state.pen;
    if (undoBtn) undoBtn.disabled = state.drawn.length === 0;
    if (clearBtn) clearBtn.disabled = state.drawn.length === 0;
  }

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify({ lines: state.lines, drawn: state.drawn, pen: state.pen }));
      } catch {
        // Storage may be off; the sign just won't be remembered.
      }
      try {
        const p = new URLSearchParams();
        state.lines.forEach((l, i) => p.set(`l${i + 1}`, [l.text, l.style, l.glass].join('|')));
        history.replaceState(null, '', `#${p.toString()}`);
      } catch {
        // A sandboxed frame may refuse; nothing depends on it.
      }
    }, 400);
  }

  function setTally(p: Plan) {
    const set = (k: string, v: string) => {
      const el = q<HTMLElement>(`[data-tally="${k}"]`);
      if (el) el.textContent = v;
    };
    set('glass', `${(p.glass / 100).toFixed(1)} m`);
    set('units', String(p.units.length));
    set('jumps', String(p.jumps));
    set('electrodes', String(p.electrodes));
  }

  function setPicks() {
    if (!specPick) return;
    const kinds = [...present];
    if (kinds.length === 0) kinds.push(GLASS_INDEX[state.pen]);
    if (!kinds.includes(state.spec)) state.spec = kinds[0];
    const key = kinds.join(',') + ':' + state.spec;
    if (specPick.dataset.key === key) return;
    specPick.dataset.key = key;
    specPick.replaceChildren(
      ...kinds.map((k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-pressed', String(k === state.spec));
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.setProperty('--sw', swatch(GLASSES[k]));
        b.append(dot, document.createTextNode(GLASSES[k].name));
        b.addEventListener('click', () => {
          state.spec = k;
          setPicks();
          drawSpectrum(true);
        });
        return b;
      }),
    );
    if (specNote) specNote.textContent = GLASSES[state.spec].note;
  }

  let replanQueued = false;
  function replan() {
    if (replanQueued) return;
    replanQueued = true;
    requestAnimationFrame(() => {
      replanQueued = false;
      replanNow();
    });
  }

  function replanNow() {
    if (!view) return;
    const lines = state.lines.map((l) => ({ text: l.text, style: l.style, glass: GLASS_INDEX[l.glass] }));
    const strokes = [...state.drawn, ...(live ? [live] : [])].map((s) => ({ pts: s.pts, glass: GLASS_INDEX[s.glass] }));
    current = plan(lines, strokes);
    renderer.setPlan(current, view);
    paintFittings(fitCtx!, view, current);
    renderer.setFittings(fitCanvas);
    const next = new Set(current.units.map((u) => u.glass));
    // A glass newly in the window strikes on its own if the sign is lit.
    const now = performance.now() / 1000;
    for (const k of next)
      if (!present.has(k) && state.on) {
        strikeAt[k] = now + 0.05;
        if (!live) sound.strike(0.05);
      }
    present = next;
    setTally(current);
    setPicks();
    drawSpectrum(true);
    if (!live) save();
  }

  lineEls.forEach((el, i) => {
    el.querySelector<HTMLInputElement>('[data-text]')?.addEventListener('input', (e) => {
      const input = e.currentTarget as HTMLInputElement;
      const v = clean(input.value);
      if (v !== input.value) input.value = v;
      state.lines[i].text = v;
      replan();
    });
    el.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) =>
      b.addEventListener('click', () => {
        state.lines[i].style = b.dataset.style as Style;
        syncForm();
        replan();
      }),
    );
    el.querySelector<HTMLSelectElement>('[data-glass]')?.addEventListener('change', (e) => {
      const v = (e.currentTarget as HTMLSelectElement).value;
      if (!(v in GLASS_INDEX)) return;
      state.lines[i].glass = v;
      state.spec = GLASS_INDEX[v];
      replan();
    });
  });

  penSelect?.addEventListener('change', () => {
    if (penSelect.value in GLASS_INDEX) state.pen = penSelect.value;
    save();
  });

  drawBtn?.addEventListener('click', () => {
    state.drawing = !state.drawing;
    drawBtn.setAttribute('aria-pressed', String(state.drawing));
    root.dataset.drawing = String(state.drawing);
    penHint?.toggleAttribute('hidden', !state.drawing);
    hint?.toggleAttribute('hidden', state.drawing);
  });
  undoBtn?.addEventListener('click', () => {
    state.drawn.pop();
    syncForm();
    replan();
  });
  clearBtn?.addEventListener('click', () => {
    state.drawn = [];
    syncForm();
    replan();
  });

  root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      state.lines = presetLines(Number(b.dataset.preset));
      state.spec = GLASS_INDEX[state.lines[0].glass];
      syncForm();
      replan();
      if (!state.on) setOn(true);
    }),
  );

  function setOn(on: boolean, quiet = false) {
    state.on = on;
    switchBtn?.setAttribute('aria-pressed', String(on));
    if (switchWord) switchWord.textContent = on ? 'on' : 'off';
    if (!quiet) sound.clack(on);
    const now = performance.now() / 1000;
    if (on) {
      for (const k of present) {
        const delay = 0.04 + Math.random() * 0.22;
        strikeAt[k] = now + delay;
        if (!quiet) sound.strike(delay);
      }
    }
  }

  switchBtn?.addEventListener('click', () => {
    sound.wake();
    setOn(!state.on);
  });
  gratingBtn?.addEventListener('click', () => {
    state.grating = !state.grating;
    gratingBtn.setAttribute('aria-pressed', String(state.grating));
    mount?.toggleAttribute('hidden', !state.grating);
    spreadWrap?.toggleAttribute('hidden', !state.grating);
  });
  spread?.addEventListener('input', () => {
    renderer.gratingK = Number(spread.value) || 0.16;
  });
  rainBtn?.addEventListener('click', () => {
    state.rain = !state.rain;
    rainBtn.setAttribute('aria-pressed', String(state.rain));
  });
  rainBtn?.setAttribute('aria-pressed', String(state.rain));
  soundBtn?.addEventListener('click', () => {
    state.sound = !state.sound;
    soundBtn.setAttribute('aria-pressed', String(state.sound));
    sound.setEnabled(state.sound);
    if (state.sound) sound.wake();
  });
  // Any touch of the page may start the audio, so the hum can follow the sign.
  const wakeOnce = () => {
    if (state.sound) sound.wake();
  };
  root.addEventListener('pointerdown', wakeOnce);
  root.addEventListener('keydown', wakeOnce);

  /* ---------- the glass: pointing and drawing ---------- */

  function toWorld(e: PointerEvent): Pt | null {
    if (!view) return null;
    const r = canvas!.getBoundingClientRect();
    const px = (e.clientX - r.left) * devScale;
    const py = (e.clientY - r.top) * devScale;
    return { x: (px - view.ox) / view.s, y: (view.oy - py) / view.s };
  }

  const clampToGlass = (p: Pt): Pt => ({
    x: Math.min(WINDOW.x1 - 4, Math.max(WINDOW.x0 + 4, p.x)),
    y: Math.min(WINDOW.transom - 4, Math.max(WINDOW.y0 + 18, p.y)),
  });
  const onGlass = (p: Pt) => p.x > WINDOW.x0 && p.x < WINDOW.x1 && p.y > WINDOW.y0 && p.y < WINDOW.transom;

  canvas.addEventListener('pointerdown', (e) => {
    const p = toWorld(e);
    if (!p) return;
    if (state.drawing) {
      if (!onGlass(p) || state.drawn.length >= MAX_STROKES) return;
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Capture is a nicety.
      }
      live = { pts: [clampToGlass(p)], glass: state.pen };
      return;
    }
    // Otherwise, find the tube under the pointer and show its light.
    let best = 6;
    let hit = -1;
    for (const u of current.units)
      for (const pt of u.pts) {
        const d = Math.hypot(pt.x - p.x, pt.y - p.y);
        if (d < best) {
          best = d;
          hit = u.glass;
        }
      }
    if (hit >= 0) {
      state.spec = hit;
      setPicks();
      drawSpectrum(true);
      hint?.setAttribute('hidden', '');
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!live) return;
    const events = e.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) {
      const p = toWorld(ev);
      if (!p) continue;
      const c = clampToGlass(p);
      const last = live.pts[live.pts.length - 1];
      if (Math.hypot(c.x - last.x, c.y - last.y) >= 0.7) live.pts.push(c);
    }
    if (live.pts.length > 1) replan();
  });

  const endStroke = () => {
    if (!live) return;
    const pts = smoothStroke(live.pts);
    const glass = live.glass;
    live = null;
    if (pts.length > 1) state.drawn.push({ pts, glass });
    syncForm();
    replan();
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  /* ---------- the spectrum strip ---------- */

  let lastStrip = 0;
  function drawSpectrum(force = false) {
    if (!strip || !stripCtx) return;
    const now = performance.now();
    if (!force && now - lastStrip < 120) return;
    lastStrip = now;
    const k = state.spec >= 0 ? state.spec : 0;
    const light = lights[k];
    const w = warm[k];
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = Math.round(strip.clientWidth * dpr);
    const ch = Math.round(strip.clientHeight * dpr);
    if (cw === 0 || ch === 0) return;
    if (strip.width !== cw || strip.height !== ch) {
      strip.width = cw;
      strip.height = ch;
    }
    const c = stripCtx;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#050505';
    c.fillRect(0, 0, cw, ch);
    const pad = 10 * dpr;
    const lo = 380;
    const hi = 730;
    const X = (nm: number) => pad + ((nm - lo) / (hi - lo)) * (cw - 2 * pad);
    const top = 20 * dpr;
    const bottom = ch - 26 * dpr;
    const scaleOf = (g: number) => (g === Group.Steady ? 1 : g === Group.Argon ? 1 - 0.8 * w : w);
    const strength = light.entries.map((e) => e.w * scaleOf(e.group));
    const max = Math.max(...light.entries.map((e, i) => (e.band ? strength[i] * 2.2 : strength[i])), 1e-6);
    c.globalCompositeOperation = 'lighter';
    light.entries.forEach((e, i) => {
      const s = strength[i];
      if (s <= 0) return;
      const rgb = lineRgb(e.nm);
      const m = Math.max(rgb[0], rgb[1], rgb[2], 1e-6);
      const enc = (v: number) => Math.round(255 * Math.min(1, v / m) ** (1 / 2.2));
      const a = Math.min(1, ((e.band ? s * 2.2 : s) / max) ** 0.6);
      c.fillStyle = `rgba(${enc(rgb[0])},${enc(rgb[1])},${enc(rgb[2])},${a.toFixed(3)})`;
      if (e.band) {
        const x0 = X(e.nm - 2.5);
        c.fillRect(x0, top, X(e.nm + 2.5) - x0 + 0.5, bottom - top);
      } else {
        c.fillRect(X(e.nm) - dpr, top, 2 * dpr, bottom - top);
      }
    });
    c.globalCompositeOperation = 'source-over';
    // The scale.
    c.fillStyle = '#8b8577';
    c.font = `${10 * dpr}px ui-monospace, monospace`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    for (let nm = 380; nm <= 730; nm += 10) {
      const major = nm % 50 === 0;
      c.fillRect(Math.round(X(nm)), bottom + 3 * dpr, dpr, (major ? 7 : 3) * dpr);
      if (major && nm >= 400 && nm <= 700) c.fillText(`${nm}`, X(nm), bottom + 12 * dpr);
    }
    c.textAlign = 'right';
    c.fillText('nm', cw - pad * 0.3, bottom + 12 * dpr);
    // Name the strongest lines.
    const named = light.entries
      .map((e, i) => ({ e, s: e.band ? 0 : strength[i] * (0.15 + lineRgb(e.nm)[1]) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6);
    const taken: number[] = [];
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#d8d0bf';
    for (const { e } of named) {
      const label = `${e.source} ${Math.round(e.nm)}`;
      const half = c.measureText(label).width / 2;
      const x = Math.min(cw - half - 2 * dpr, Math.max(half + 2 * dpr, X(e.nm)));
      if (taken.some((t) => Math.abs(t - x) < half * 2 + 6 * dpr)) continue;
      taken.push(x);
      c.fillText(label, x, top - 6 * dpr);
    }
    if (specNote) specNote.textContent = GLASSES[k].note;
  }

  /* ---------- size and paint ---------- */

  async function layout() {
    const r = canvas!.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let w = Math.round(r.width * dpr);
    let h = Math.round(r.height * dpr);
    const cap = 3.6e6;
    if (w * h > cap) {
      const k = Math.sqrt(cap / (w * h));
      w = Math.round(w * k);
      h = Math.round(h * k);
    }
    devScale = w / r.width;
    const side = matchMedia('(min-width: 900px)').matches;
    const inset = side ? docket!.getBoundingClientRect().width * devScale : 0;
    view = frame(w, h, inset);
    renderer.resize(w, h);
    for (const c of [albCanvas, clsCanvas, fitCanvas]) {
      c.width = w;
      c.height = h;
    }
    await fontsReady;
    paintFacade(albCtx!, clsCtx!, view, family);
    const alb = albCtx!.getImageData(0, 0, w, h);
    const cls = clsCtx!.getImageData(0, 0, w, h).data;
    for (let i = 0; i < alb.data.length; i += 4) alb.data[i + 3] = cls[i];
    renderer.setFacade(alb);
    replanNow();
  }

  let resizeTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void layout(), 80);
  }).observe(stage);

  /* ---------- the frame loop ---------- */

  const colours = new Float32Array(TYPES * 3);
  const groups = new Float32Array(TYPES * 3);
  let raf = 0;
  let last = performance.now() / 1000;
  const hash = (n: number) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };

  function tick() {
    raf = requestAnimationFrame(tick);
    const t = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0, t - last));
    last = t;
    let lit = 0;
    for (let k = 0; k < TYPES; k++) {
      let b = 0;
      if (state.on && t >= strikeAt[k]) {
        const since = t - strikeAt[k];
        b = 1;
        if (since < 0.5 && !reduced) b = hash(Math.floor(since * 28) + k * 13.7) > 0.42 ? 1 : 0.12;
        warm[k] += (1 - warm[k]) * (1 - Math.exp(-dt / 7));
      } else if (!state.on) {
        warm[k] += (0.15 - warm[k]) * (1 - Math.exp(-dt / 40));
      }
      const c = k < GLASSES.length ? colourAt(lights[k], warm[k]) : [0, 0, 0];
      colours[k * 3] = c[0] * b;
      colours[k * 3 + 1] = c[1] * b;
      colours[k * 3 + 2] = c[2] * b;
      groups[k * 3] = b;
      groups[k * 3 + 1] = b * (1 - 0.8 * warm[k]);
      groups[k * 3 + 2] = b * warm[k];
      if (present.has(k)) lit += b;
    }
    renderer.frame({ time: t, colours, groups, grating: state.grating, rain: state.rain ? 1 : 0 });
    sound.setHum(state.on ? Math.min(1, 0.45 + 0.08 * current.units.length) * Math.min(1, lit) : 0);
    if (state.on) drawSpectrum();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
      sound.suspend();
    } else if (!raf) {
      last = performance.now() / 1000;
      raf = requestAnimationFrame(tick);
      sound.resume();
    }
  });

  syncForm();
  void layout().then(() => {
    raf = requestAnimationFrame(tick);
    // The shop lights the window a moment after you arrive.
    window.setTimeout(() => {
      if (!state.on) setOn(true, true);
    }, 700);
  });
}
