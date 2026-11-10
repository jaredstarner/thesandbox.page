// Wires the tidal tails page: picks a plate, runs the encounter on the GPU,
// and keeps the controls, marks, and link in step with it.

import { coresAt, KPC_PER_UNIT, myrAt, solve, stepAt, type Encounter, type Orbit, type Vec3 } from './_orbit';
import { PLATES, type Plate, type View } from './_plates';
import { Sky } from './_sky';

type Rows = [number[], number[], number[]];
type Mode = 'negative' | 'print';

/** Myr of plate time per second of playback at 1×. */
const RATE = 70;
const SEED = 0x7a11;

const rad = (d: number) => (d * Math.PI) / 180;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function mul(a: Rows, b: Rows): Rows {
  const out: Rows = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) out[i]![j] = a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!;
  return out;
}
const rotX = (t: number): Rows => [
  [1, 0, 0],
  [0, Math.cos(t), -Math.sin(t)],
  [0, Math.sin(t), Math.cos(t)],
];
const rotY = (t: number): Rows => [
  [Math.cos(t), 0, Math.sin(t)],
  [0, 1, 0],
  [-Math.sin(t), 0, Math.cos(t)],
];
const rotZ = (t: number): Rows => [
  [Math.cos(t), -Math.sin(t), 0],
  [Math.sin(t), Math.cos(t), 0],
  [0, 0, 1],
];

/** World to plate: turn about the orbit's axis, tilt toward edge on, then roll on the plate. */
const rowsOf = (v: View): Rows => mul(rotZ(rad(v.roll)), mul(rotX(-rad(v.el)), rotZ(rad(v.az))));

/** Keep the rotation orthonormal after many small turns. */
function tidy(m: Rows): Rows {
  const a = m[0]!;
  const la = Math.hypot(a[0]!, a[1]!, a[2]!);
  const x = a.map((c) => c / la);
  const b = m[1]!;
  const d = x[0]! * b[0]! + x[1]! * b[1]! + x[2]! * b[2]!;
  const y0 = b.map((c, i) => c - d * x[i]!);
  const lb = Math.hypot(y0[0]!, y0[1]!, y0[2]!);
  const y = y0.map((c) => c / lb);
  const z = [x[1]! * y[2]! - x[2]! * y[1]!, x[2]! * y[0]! - x[0]! * y[2]!, x[0]! * y[1]! - x[1]! * y[0]!];
  return [x, y, z];
}

const minus = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const myrText = (myr: number) => {
  const r = Math.round(myr);
  return Math.abs(r) >= 1000 ? `${minus(Math.round(r / 10) / 100)} Gyr` : `${minus(r)} Myr`;
};

function start(root: HTMLElement) {
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const plateEl = $('[data-plate]');
  const canvas = $<HTMLCanvasElement>('[data-sky]');
  const timeInput = $<HTMLInputElement>('[data-time]');
  const clock = $('[data-clock]');
  const playBtn = $('[data-play]');
  const busy = $('[data-busy]');
  const etchTime = $('[data-etch-time]');
  const etchPlate = $('[data-etch-plate]');
  const scaleBar = $('[data-scale-bar]');
  const scaleText = $('[data-scale-text]');
  const sleeveCat = $('[data-sleeve-cat]');
  const sleeveName = $('[data-sleeve-name]');
  const caption = $('[data-caption]');
  const trackA = $<SVGPathElement>('[data-track-a]');
  const trackB = $<SVGPathElement>('[data-track-b]');
  const tickA = $<SVGGElement>('[data-tick-a]');
  const tickB = $<SVGGElement>('[data-tick-b]');
  const svg = $<SVGSVGElement>('[data-marks]');
  const dials = new Map<string, HTMLInputElement>();
  for (const el of root.querySelectorAll<HTMLInputElement>('[data-dial]')) dials.set(el.dataset.dial!, el);
  const outs = new Map<string, HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-out]')) outs.set(el.dataset.out!, el);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = {
    plate: PLATES[0] as Plate | null,
    enc: structuredClone(PLATES[0]!.enc) as Encounter,
    rows: rowsOf(PLATES[0]!.view),
    extent: PLATES[0]!.view.extent,
    time: PLATES[0]!.time,
    playing: false,
    /** Playback pauses here, at the plate's catalogued moment. */
    stopAt: null as number | null,
    speed: 1,
    mode: 'negative' as Mode,
    marks: true,
    exposure: 0.5,
  };
  let orbit: Orbit = solve(state.enc);
  let sky: Sky | null = null;
  let dirty = true;
  let marksDirty = true;

  // ---- Reading and writing the link ----
  function readHash(): boolean {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.size) return false;
    const preset = PLATES.find((p) => p.id === h.get('p'));
    if (preset) applyPlate(preset, false);
    const num = (k: string, d: number) => {
      const v = Number(h.get(k));
      return h.has(k) && Number.isFinite(v) ? v : d;
    };
    const disk = (k: string, d: Encounter['a']) => {
      const v = (h.get(k) ?? '').split(',').map(Number);
      return v.length === 3 && v.every(Number.isFinite)
        ? { tilt: clamp(v[0]!, 0, 180), turn: clamp(v[1]!, -180, 180), on: v[2] !== 0 }
        : d;
    };
    if (!preset || h.has('r')) {
      state.plate = preset && !h.has('r') ? preset : null;
      state.enc = {
        ratio: clamp(num('r', state.enc.ratio), 0.1, 1),
        peri: clamp(num('q', state.enc.peri), 0, 50),
        ecc: clamp(num('e', state.enc.ecc), 0.3, 1.6),
        a: disk('a', state.enc.a),
        b: disk('b', state.enc.b),
      };
    }
    state.time = num('t', state.time);
    state.extent = clamp(num('x', state.extent), 8, 400);
    const m = (h.get('m') ?? '').split(',').map(Number);
    if (m.length === 9 && m.every(Number.isFinite))
      state.rows = tidy([m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)] as Rows);
    if (h.get('n') === 'print') state.mode = 'print';
    state.exposure = clamp(num('k', state.exposure), 0, 1);
    return true;
  }

  function linkFor(): string {
    const h = new URLSearchParams();
    const r3 = (n: number) => String(Math.round(n * 1000) / 1000);
    if (state.plate) h.set('p', state.plate.id);
    else {
      const e = state.enc;
      h.set('r', String(e.ratio));
      h.set('q', String(e.peri));
      h.set('e', String(e.ecc));
      h.set('a', `${e.a.tilt},${e.a.turn},${e.a.on ? 1 : 0}`);
      h.set('b', `${e.b.tilt},${e.b.turn},${e.b.on ? 1 : 0}`);
    }
    h.set('t', String(Math.round(state.time)));
    h.set('x', String(Math.round(state.extent)));
    h.set('m', state.rows.flat().map(r3).join(','));
    if (state.mode === 'print') h.set('n', 'print');
    if (state.exposure !== 0.5) h.set('k', String(state.exposure));
    return `${location.pathname}#${h.toString()}`;
  }
  let linkTimer = 0;
  const saveLink = () => {
    clearTimeout(linkTimer);
    linkTimer = window.setTimeout(() => history.replaceState(null, '', linkFor()), 400);
  };

  // ---- Controls ----
  function ratioText(r: number) {
    return r >= 0.995 ? '1 : 1' : `1 : ${(1 / r).toFixed(1).replace(/\.0$/, '')}`;
  }
  function eccText(e: number) {
    if (Math.abs(e - 1) < 0.015) return 'parabolic';
    return e < 1 ? `bound, e ${e.toFixed(2)}` : `flyby, e ${e.toFixed(2)}`;
  }
  function exposureText(x: number) {
    const min = Math.round(60 * 2 ** ((x - 0.5) * 4));
    return min >= 60 ? `${Math.round((min / 60) * 10) / 10} h`.replace('.0 h', ' h') : `${min} min`;
  }
  function syncControls() {
    const e = state.enc;
    const set = (k: string, v: number, text: string) => {
      const input = dials.get(k);
      if (input && document.activeElement !== input) input.value = String(v);
      outs.get(k)!.textContent = text;
    };
    set('ratio', e.ratio, ratioText(e.ratio));
    set('peri', e.peri, `${e.peri} kpc`);
    set('ecc', e.ecc, eccText(e.ecc));
    for (const k of ['a', 'b'] as const) {
      set(`${k}-tilt`, e[k].tilt, `${e[k].tilt}°`);
      set(`${k}-turn`, e[k].turn, `${e[k].turn < 0 ? '−' : ''}${Math.abs(e[k].turn)}°`);
      $<HTMLInputElement>(`[data-disk-on="${k}"]`).checked = e[k].on;
      $(`[data-disk="${k}"]`).toggleAttribute('data-off', !e[k].on);
    }
    set('exposure', state.exposure, exposureText(state.exposure));
    for (const b of root.querySelectorAll<HTMLElement>('[data-plate-pick]'))
      b.setAttribute('aria-pressed', String(b.dataset.platePick === state.plate?.id));
    for (const b of root.querySelectorAll<HTMLElement>('[data-mode-pick]'))
      b.setAttribute('aria-pressed', String(b.dataset.modePick === state.mode));
    for (const b of root.querySelectorAll<HTMLElement>('[data-speed]'))
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === state.speed));
    root.dataset.mode = state.mode;
    root.dataset.marks = state.marks ? 'on' : 'off';
    const p = state.plate;
    caption.textContent = p
      ? p.caption
      : 'Your own encounter. Start from any plate and change it; the link in the address bar keeps every setting.';
    sleeveCat.textContent = p ? p.cat : 'Encounter';
    sleeveName.textContent = p ? p.ngc : `${ratioText(e.ratio)} · ${e.peri} kpc · ${eccText(e.ecc)}`;
    etchPlate.textContent = p ? p.no : '—';
  }

  function syncTime() {
    const lo = myrAt(orbit, 0);
    const hi = myrAt(orbit, orbit.steps - 1);
    timeInput.min = String(Math.floor(lo));
    timeInput.max = String(Math.ceil(hi));
    if (document.activeElement !== timeInput) timeInput.value = String(Math.round(state.time));
    const text = myrText(state.time);
    clock.textContent = text;
    etchTime.textContent = text;
    playBtn.setAttribute('aria-pressed', String(state.playing));
    playBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  }

  function newOrbit() {
    orbit = solve(state.enc);
    state.time = clamp(state.time, myrAt(orbit, 0), myrAt(orbit, orbit.steps - 1));
    sky?.setOrbit(orbit, SEED);
    marksDirty = true;
    dirty = true;
    syncTime();
  }

  function applyPlate(p: Plate, replay: boolean) {
    state.plate = p;
    state.enc = structuredClone(p.enc);
    state.rows = rowsOf(p.view);
    state.extent = p.view.extent;
    orbit = solve(state.enc);
    if (replay && !reduced) {
      // Run the pass from just before closest approach and pause at the catalogued moment.
      state.time = Math.max(myrAt(orbit, 0), Math.min(-120, p.time - 400));
      state.stopAt = p.time;
      state.playing = true;
    } else {
      state.time = p.time;
      state.stopAt = null;
      state.playing = false;
    }
    sky?.setOrbit(orbit, SEED);
    marksDirty = true;
    dirty = true;
    syncControls();
    syncTime();
  }

  root.querySelector('[data-plates]')!.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest<HTMLElement>('[data-plate-pick]');
    const p = PLATES.find((x) => x.id === btn?.dataset.platePick);
    if (!p) return;
    applyPlate(p, true);
    saveLink();
  });

  for (const [key, input] of dials) {
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (key === 'exposure') {
        state.exposure = v;
        dirty = true;
        syncControls();
        saveLink();
        return;
      }
      const e = state.enc;
      if (key === 'ratio') e.ratio = v;
      else if (key === 'peri') e.peri = v;
      else if (key === 'ecc') e.ecc = Math.abs(v - 1) < 0.015 ? 1 : v;
      else {
        const [k, part] = key.split('-') as ['a' | 'b', 'tilt' | 'turn'];
        e[k][part] = v;
      }
      state.plate = null;
      state.stopAt = null;
      syncControls();
      newOrbit();
      saveLink();
    });
  }
  for (const k of ['a', 'b'] as const) {
    $<HTMLInputElement>(`[data-disk-on="${k}"]`).addEventListener('change', (ev) => {
      state.enc[k].on = (ev.target as HTMLInputElement).checked;
      state.plate = null;
      syncControls();
      newOrbit();
      saveLink();
    });
  }
  for (const b of root.querySelectorAll<HTMLElement>('[data-mode-pick]')) {
    b.addEventListener('click', () => {
      state.mode = b.dataset.modePick as Mode;
      dirty = true;
      syncControls();
      saveLink();
    });
  }
  $<HTMLInputElement>('[data-marks-on]').addEventListener('change', (ev) => {
    state.marks = (ev.target as HTMLInputElement).checked;
    syncControls();
  });
  for (const b of root.querySelectorAll<HTMLElement>('[data-speed]')) {
    b.addEventListener('click', () => {
      state.speed = Number(b.dataset.speed);
      syncControls();
    });
  }
  for (const b of root.querySelectorAll<HTMLElement>('[data-view]')) {
    b.addEventListener('click', () => {
      const which = b.dataset.view;
      if (which === 'face') state.rows = rowsOf({ az: 0, el: 0, roll: 0, extent: state.extent });
      else if (which === 'edge') state.rows = rowsOf({ az: 0, el: 90, roll: 0, extent: state.extent });
      else {
        const v = (state.plate ?? PLATES[0]!).view;
        state.rows = rowsOf(v);
        state.extent = v.extent;
      }
      marksDirty = true;
      dirty = true;
      saveLink();
    });
  }
  const shareBtn = $('[data-share]');
  shareBtn.addEventListener('click', async () => {
    const url = new URL(linkFor(), location.href).href;
    history.replaceState(null, '', linkFor());
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = 'Copied';
    } catch {
      shareBtn.textContent = 'Link in address bar';
    }
    setTimeout(() => (shareBtn.textContent = 'Copy link'), 1800);
  });

  playBtn.addEventListener('click', () => {
    if (!state.playing && state.time >= myrAt(orbit, orbit.steps - 1) - 1) state.time = myrAt(orbit, 0);
    state.playing = !state.playing;
    if (state.playing && state.stopAt !== null && state.time >= state.stopAt - 1) state.stopAt = null;
    syncTime();
  });
  timeInput.addEventListener('input', () => {
    state.time = Number(timeInput.value);
    state.playing = false;
    state.stopAt = null;
    syncTime();
    saveLink();
  });
  root.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLButtonElement) return;
    if (ev.key === ' ') {
      ev.preventDefault();
      playBtn.click();
    }
  });

  // ---- Turning and zooming the plate ----
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  plateEl.addEventListener('pointerdown', (ev) => {
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try {
      plateEl.setPointerCapture(ev.pointerId);
    } catch {
      // Synthetic pointers can't be captured; the drag still works inside the plate.
    }
    plateEl.classList.add('dragging');
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      pinch = Math.hypot(p!.x - q!.x, p!.y - q!.y);
    }
  });
  plateEl.addEventListener('pointermove', (ev) => {
    const prev = pointers.get(ev.pointerId);
    if (!prev) return;
    const cur = { x: ev.clientX, y: ev.clientY };
    pointers.set(ev.pointerId, cur);
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      const d = Math.hypot(p!.x - q!.x, p!.y - q!.y);
      if (pinch > 0 && d > 0) state.extent = clamp((state.extent * pinch) / d, 8, 400);
      pinch = d;
    } else {
      const k = 3.2 / Math.max(240, plateEl.clientWidth);
      state.rows = tidy(mul(mul(rotY((cur.x - prev.x) * k), rotX((cur.y - prev.y) * k)), state.rows));
    }
    marksDirty = true;
    dirty = true;
  });
  const lift = (ev: PointerEvent) => {
    pointers.delete(ev.pointerId);
    pinch = 0;
    if (!pointers.size) {
      plateEl.classList.remove('dragging');
      saveLink();
    }
  };
  plateEl.addEventListener('pointerup', lift);
  plateEl.addEventListener('pointercancel', lift);
  plateEl.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      state.extent = clamp(state.extent * Math.exp(ev.deltaY * 0.0012), 8, 400);
      marksDirty = true;
      dirty = true;
      saveLink();
    },
    { passive: false },
  );
  plateEl.addEventListener('dblclick', () => {
    const v = (state.plate ?? PLATES[0]!).view;
    state.rows = rowsOf(v);
    state.extent = v.extent;
    marksDirty = true;
    dirty = true;
    saveLink();
  });

  // ---- Marks on the plate ----
  let cssSize = 1;
  const project = (p: Vec3) => {
    const ppu = cssSize / 2 / (state.extent / KPC_PER_UNIT);
    const r = state.rows;
    const sx = r[0]![0]! * p[0] + r[0]![1]! * p[1] + r[0]![2]! * p[2];
    const sy = r[1]![0]! * p[0] + r[1]![1]! * p[1] + r[1]![2]! * p[2];
    return [cssSize / 2 + sx * ppu, cssSize / 2 - sy * ppu] as const;
  };
  function drawMarks(step: number) {
    if (marksDirty) {
      svg.setAttribute('viewBox', `0 0 ${cssSize} ${cssSize}`);
      let da = '';
      let db = '';
      for (let k = 0; k < orbit.steps; k += 3) {
        const [a, b] = coresAt(orbit, k);
        const pa = project(a);
        const pb = project(b);
        const cmd = k === 0 ? 'M' : 'L';
        da += `${cmd}${pa[0].toFixed(1)} ${pa[1].toFixed(1)}`;
        db += `${cmd}${pb[0].toFixed(1)} ${pb[1].toFixed(1)}`;
      }
      trackA.setAttribute('d', da);
      trackB.setAttribute('d', db);
      // A scale bar of a round length, about a fifth of the plate.
      const ppk = cssSize / 2 / state.extent;
      const want = (cssSize * 0.2) / ppk;
      const len = [5, 10, 20, 25, 50, 100, 200].reduce((best, c) => (Math.abs(c - want) < Math.abs(best - want) ? c : best));
      scaleBar.style.width = `${(len * ppk).toFixed(1)}px`;
      scaleText.textContent = `${len} kpc`;
      marksDirty = false;
    }
    const [a, b] = coresAt(orbit, step);
    const pa = project(a);
    const pb = project(b);
    tickA.setAttribute('transform', `translate(${pa[0].toFixed(1)} ${pa[1].toFixed(1)})`);
    tickB.setAttribute('transform', `translate(${pb[0].toFixed(1)} ${pb[1].toFixed(1)})`);
  }

  // ---- The loop ----
  let budget = 240;
  let measuring = false;
  let last = 0;
  let lastStep = -1;
  function frame(now: number) {
    const dt = last ? clamp((now - last) / 1000, 0, 0.1) : 0;
    last = now;
    if (state.playing) {
      const end = myrAt(orbit, orbit.steps - 1);
      let next = state.time + RATE * state.speed * dt;
      if (state.stopAt !== null && state.time < state.stopAt && next >= state.stopAt) {
        next = state.stopAt;
        state.playing = false;
        state.stopAt = null;
        saveLink();
      }
      if (next >= end) {
        next = end;
        state.playing = false;
      }
      state.time = next;
      syncTime();
    }
    const w = Math.max(1, Math.round(canvas.clientWidth * dprNow()));
    const h = Math.max(1, Math.round(canvas.clientHeight * dprNow()));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      cssSize = canvas.clientWidth;
      marksDirty = true;
      dirty = true;
    }
    if (sky) {
      const target = stepAt(orbit, state.time);
      const t0 = performance.now();
      const taken = sky.advance(target, budget);
      if (taken > 40 && !measuring) {
        measuring = true;
        sky.device.queue.onSubmittedWorkDone().then(() => {
          const ms = Math.max(1, performance.now() - t0);
          budget = Math.round(clamp((taken / ms) * 30, 30, 4000));
          measuring = false;
        });
      }
      busy.hidden = Math.abs(target - sky.step) < 40;
      if (taken > 0 || dirty || sky.step !== lastStep) {
        sky.render(w, h, {
          rows: state.rows,
          pxPerUnit: (w / 2) * (KPC_PER_UNIT / state.extent),
          dpr: dprNow(),
          exposure: 2 ** ((state.exposure - 0.5) * 4),
          mode: state.mode,
        });
        drawMarks(sky.step);
        lastStep = sky.step;
        dirty = false;
      }
    }
    requestAnimationFrame(frame);
  }
  const dprNow = () => Math.min(window.devicePixelRatio || 1, 2);

  const fromLink = readHash();
  syncControls();
  syncTime();
  if (!fromLink) applyPlate(PLATES[0]!, true);
  requestAnimationFrame(frame);

  // ---- The GPU ----
  const fail = (message: string) => {
    const el = $('[data-nogpu]');
    el.textContent = message;
    el.hidden = false;
    canvas.hidden = true;
    busy.hidden = true;
  };
  void (async () => {
    const gpu = navigator.gpu;
    const adapter = gpu ? await gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null) : null;
    if (!adapter) {
      fail(
        gpu
          ? 'This browser has WebGPU but found no graphics adapter to run the stars on. Check that hardware acceleration is on, or try another browser.'
          : "These plates are computed on the graphics card with WebGPU, which this browser doesn't offer. Recent Chrome, Edge, Safari, and Firefox on Windows do.",
      );
      return;
    }
    const small = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, innerWidth) < 700;
    try {
      sky = await Sky.create(canvas, adapter, 1 << 20);
    } catch (error) {
      fail(`The graphics card wouldn't take the plate: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (small) sky.active = 1 << 18;
    sky.device.lost.then((info) => {
      if (info.reason !== 'destroyed') fail('The graphics card dropped the plate. Reload the page to develop it again.');
    });
    sky.setOrbit(orbit, SEED);
    // A slow card gets fewer stars: time a short run and halve until it keeps up.
    for (let tries = 0; tries < 2; tries++) {
      const t0 = performance.now();
      sky.advance(60, 60);
      await sky.device.queue.onSubmittedWorkDone();
      const ms = performance.now() - t0;
      if (ms < 70 || sky.active <= 1 << 17) break;
      sky.active = Math.max(1 << 17, sky.active >> 1);
      sky.setOrbit(orbit, SEED);
    }
    sky.setOrbit(orbit, SEED);
    root.dataset.stars = String(sky.active);
    dirty = true;
  })();

  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { tidal: unknown }).tidal = {
      state,
      get sky() {
        return sky;
      },
      get orbit() {
        return orbit;
      },
      /** Resolves once the stars have caught up with the clock. */
      settle: () =>
        new Promise<number>((resolve) => {
          const check = () => {
            if (sky && sky.step === stepAt(orbit, state.time)) resolve(sky.step);
            else setTimeout(check, 50);
          };
          check();
        }),
      jump: (myr: number) => {
        state.playing = false;
        state.stopAt = null;
        state.time = myr;
        syncTime();
      },
      plate: (id: string) => {
        const p = PLATES.find((x) => x.id === id);
        if (p) applyPlate(p, false);
      },
    };
  }
}

const root = document.querySelector<HTMLElement>('.tidal');
if (root) start(root);
