// Wires the page: the growing crystal, the cloud it falls through, the lights, and the slide box.

import { Lattice, type Params } from './_lattice';
import { Microscope, type Light } from './_render';
import { drawCloud, padToWeather, type Trail } from './_cloud';
import { clampWeather, Drift, paramsAt, type Weather } from './_weather';

/** One update stands for a few hundredths of a second of growth (the paper's estimate). */
const SECONDS_PER_UPDATE = 0.03;
/** The paper's mesoscopic cells are on the order of microns; at 5 µm a cell, its 400 to
 * 600 cell crystals come out a few millimetres across, as real ones do. */
const MICRONS_PER_CELL = 5;
/** Longest fall before the crystal lands on its own: an hour and a half. */
const MAX_TIME = 180000;
const STORE = 'snow-crystals:v1';
const MAX_SLIDES = 24;
const LIGHTS: Light[] = ['rheinberg', 'dark', 'bright', 'vapour', 'timeline'];

type Phase = 'falling' | 'paused' | 'landed';

interface Slide {
  id: string;
  at: number;
  /** Tip to tip, mm. */
  across: number;
  /** Seconds of fall. */
  fell: number;
  light: Light;
  img: string;
  path: Trail;
}

const seed32 = () => (Math.random() * 2 ** 32) >>> 0;

const load = (): Slide[] => {
  try {
    const raw = localStorage.getItem(STORE);
    const data = raw ? (JSON.parse(raw) as { slides?: Slide[] }) : null;
    return Array.isArray(data?.slides) ? data.slides : [];
  } catch {
    return [];
  }
};

const save = (slides: Slide[]) => {
  // When the browser's storage is full, drop the oldest slides until the box fits.
  for (let drop = 0; drop <= slides.length; drop++) {
    try {
      localStorage.setItem(STORE, JSON.stringify({ slides: slides.slice(drop) }));
      return;
    } catch {
      // Full or blocked: try again with one fewer.
    }
  }
};

export const formatFall = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m >= 60) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  return m > 0 ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
};

export const formatSize = (mm: number): string =>
  mm < 1 ? `${Math.round(mm * 1000 / 10) * 10} µm` : `${mm.toFixed(mm < 10 ? 2 : 1)} mm`;

const formatTemp = (t: number) => `${t < 0 ? '−' : ''}${Math.abs(t).toFixed(1)} °C`;

export function start(root: HTMLElement): void {
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel) as T;
  const canvas = $<HTMLCanvasElement>('[data-view]');
  const eyepiece = $<HTMLElement>('[data-eyepiece]');
  const notice = $<HTMLElement>('[data-notice]');
  const bar = $<HTMLElement>('[data-bar]');
  const barLabel = $<HTMLElement>('[data-bar-label]');
  const status = $<HTMLElement>('[data-status]');
  const pad = $<HTMLElement>('[data-pad]');
  const padCanvas = $<HTMLCanvasElement>('[data-pad-canvas]');
  const outTemp = $<HTMLElement>('[data-out-temp]');
  const outVapour = $<HTMLElement>('[data-out-vapour]');
  const outFall = $<HTMLElement>('[data-out-fall]');
  const outSize = $<HTMLElement>('[data-out-size]');
  const driftBtn = $<HTMLButtonElement>('[data-drift]');
  const pauseBtn = $<HTMLButtonElement>('[data-pause]');
  const catchBtn = $<HTMLButtonElement>('[data-catch]');
  const newBtn = $<HTMLButtonElement>('[data-new]');
  const fastBtn = $<HTMLButtonElement>('[data-fast]');
  const saveBtn = $<HTMLButtonElement>('[data-save]');
  const slidesEl = $<HTMLOListElement>('[data-slides]');
  const emptyEl = $<HTMLElement>('[data-empty]');
  const dialog = $<HTMLDialogElement>('[data-slide-dialog]');
  const debug = new URLSearchParams(location.search).has('debug');

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: debug });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
    notice.hidden = false;
    root.dataset.broken = '';
    return;
  }
  const lattice = new Lattice(gl);
  const microscope = new Microscope(gl, lattice);

  let light: Light = 'rheinberg';
  let weather: Weather = { t: -14 - Math.random() * 2, v: 0.35 + Math.random() * 0.3 };
  let drift = new Drift(seed32(), weather);
  let drifting = true;
  let dragging = false;
  let params: Params = paramsAt(weather);
  let phase: Phase = 'falling';
  let path: Trail = [];
  let view = 64;
  let capacity = 24;
  let avg = 1000 / 60;
  let atCapacity = false;
  let owed = 0;
  let fast = false;
  let turbo = 0;
  let last = 0;
  let period = 1000 / 60;
  const recent: number[] = [];
  let rate = 0.02;
  let lastReading = { r: 0, t: 0 };
  let slides = load();

  // ---- Growth --------------------------------------------------------------------------

  const setPhase = (p: Phase) => {
    phase = p;
    root.dataset.phase = p;
    pauseBtn.textContent = p === 'paused' ? 'Resume' : 'Pause';
    pauseBtn.disabled = p === 'landed';
    catchBtn.disabled = p === 'landed';
    status.textContent =
      p === 'falling' ? 'Falling through the cloud' : p === 'paused' ? 'Held in the air' : 'Landed on the slide';
  };

  const setDrift = (on: boolean) => {
    drifting = on;
    driftBtn.setAttribute('aria-pressed', String(on));
  };

  const begin = () => {
    drift = new Drift(seed32(), weather);
    params = paramsAt(weather);
    lattice.reset(params.rho, seed32());
    path = [[weather.t, weather.v, 0]];
    view = 64;
    rate = 0.02;
    lastReading = { r: 0, t: 0 };
    owed = 0;
    setPhase('falling');
  };

  const advance = (steps: number, seconds: number) => {
    if (drifting && !dragging) weather = drift.step(weather, seconds);
    const target = paramsAt(weather);
    // The attachment and melting rates follow the air over a few hundred updates; the
    // vapour around the crystal is scaled toward the new density, as in the paper's
    // changing-environment runs.
    const k = 1 - Math.exp(-steps / 800);
    for (const key of Object.keys(params) as (keyof Params)[]) {
      if (key !== 'rho') params[key] += (target[key] - params[key]) * k;
    }
    params.rho = target.rho;
    const ratio = target.rho / lattice.rho - 1;
    const grow = Math.max(-3e-4, Math.min(3e-4, ratio / Math.max(600, steps)));
    lattice.run(steps, params, grow);
    const tail = path[path.length - 1];
    if (lattice.time - tail[2] >= 120) path.push([weather.t, weather.v, lattice.time]);
  };

  /** Updates a second that keep the crystal's visible growth even: faster for slow plates,
   * slower for racing dendrites. */
  const pace = () => {
    const goal = 0.05 * (fast ? 2.6 : 1) * (lattice.radius + 40);
    return Math.max(200, Math.min(fast ? 20000 : 7000, goal / Math.max(rate, 1e-5)));
  };

  // ---- Drawing -------------------------------------------------------------------------

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const side = Math.round(canvas.clientWidth * dpr);
    if (side > 0 && canvas.width !== side) canvas.width = canvas.height = side;
    const pw = Math.round(pad.clientWidth * dpr);
    const ph = Math.round(pad.clientHeight * dpr);
    if (pw > 0 && (padCanvas.width !== pw || padCanvas.height !== ph)) {
      padCanvas.width = pw;
      padCanvas.height = ph;
    }
  };

  const NICE = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5];
  const drawScale = () => {
    const cssPerCell = canvas.clientWidth / 2 / view;
    const pxPerMm = (cssPerCell * 1000) / MICRONS_PER_CELL;
    const mm = NICE.find((n) => n * pxPerMm >= 56) ?? 5;
    bar.style.width = `${(mm * pxPerMm).toFixed(1)}px`;
    barLabel.textContent = mm < 1 ? `${Math.round(mm * 1000)} µm` : `${mm} mm`;
  };

  const across = () => (2 * lattice.radius * MICRONS_PER_CELL) / 1000;

  const readouts = () => {
    outTemp.textContent = formatTemp(weather.t);
    outVapour.textContent = params.rho.toFixed(3);
    outFall.textContent = formatFall(lattice.time * SECONDS_PER_UPDATE);
    outSize.textContent = lattice.radius > 0 ? formatSize(across()) : 'a few µm';
  };

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = last ? Math.min(100, now - last) : period;
    last = now;
    // The display's frame interval: a low percentile of recent frames, so one quick frame
    // after a stall doesn't set it.
    if (dt > 0) {
      recent.push(dt);
      if (recent.length > 90) recent.shift();
      if (recent.length >= 10) period = recent.slice().sort((a, b) => a - b)[Math.floor(recent.length * 0.25)];
    }
    resize();
    lattice.poll();
    if (lattice.radiusAt > lastReading.t + 300) {
      const inst = (lattice.radius - lastReading.r) / (lattice.radiusAt - lastReading.t);
      rate += (Math.max(inst, 1e-5) - rate) * 0.35;
      lastReading = { r: lattice.radius, t: lattice.radiusAt };
    }
    if (phase === 'falling') {
      // Hunt for the most updates a frame the GPU keeps up with, judged on smoothed frame
      // times so one slow frame doesn't throw it back.
      avg += (dt - avg) * 0.15;
      if (atCapacity && avg <= period * 1.3) capacity = Math.min(600, Math.ceil(capacity * 1.12));
      else if (avg > period * 1.7) capacity = Math.max(1, Math.floor(capacity * 0.85));
      owed += (pace() * dt) / 1000;
      let n = Math.floor(owed);
      atCapacity = n >= capacity;
      n = Math.min(n, capacity);
      owed = Math.min(owed - n, capacity);
      if (turbo) n = turbo;
      if (n > 0) advance(n, dt / 1000);
      if (lattice.radius >= Lattice.MAX_RADIUS || lattice.time >= MAX_TIME) land();
    } else if (dragging) {
      // Let the chart answer even while the crystal is held.
      params = paramsAt(weather);
    }
    const goal = Math.max(64, lattice.radius * 1.18 + 6);
    view += (goal - view) * Math.min(1, dt / 400);
    lattice.prepare();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    microscope.draw(light, canvas.width, canvas.height, view / (canvas.width / 2));
    drawScale();
    readouts();
    const ctx = padCanvas.getContext('2d');
    const s = padCanvas.width / Math.max(1, pad.clientWidth);
    if (ctx) drawCloud(ctx, padCanvas.width, padCanvas.height, s, weather, path, lattice.time, dragging);
  };

  // ---- Slides --------------------------------------------------------------------------

  const picture = (size: number) => microscope.picture(light, size, Math.max(26, lattice.radius * 1.12));

  const thin = (p: Trail, max: number): Trail => {
    if (p.length <= max) return p.map((q) => [+q[0].toFixed(2), +q[1].toFixed(3), q[2]]);
    const out: Trail = [];
    for (let i = 0; i < max; i++) {
      const q = p[Math.round((i * (p.length - 1)) / (max - 1))];
      out.push([+q[0].toFixed(2), +q[1].toFixed(3), q[2]]);
    }
    return out;
  };

  const renderSlides = () => {
    slidesEl.replaceChildren(
      ...slides
        .slice()
        .reverse()
        .map((s, i) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'slide';
          btn.dataset.id = s.id;
          btn.setAttribute('aria-label', `Slide ${slides.length - i}, ${formatSize(s.across)} across`);
          const img = document.createElement('img');
          img.src = s.img;
          img.alt = '';
          img.width = img.height = 72;
          const no = document.createElement('span');
          no.textContent = String(slides.length - i).padStart(2, '0');
          btn.append(img, no);
          li.append(btn);
          return li;
        }),
    );
    emptyEl.hidden = slides.length > 0;
  };

  const keep = () => {
    const img = picture(640);
    let data = img.toDataURL('image/webp', 0.9);
    if (!data.startsWith('data:image/webp')) data = img.toDataURL('image/jpeg', 0.9);
    const slide: Slide = {
      id: Date.now().toString(36),
      at: Date.now(),
      across: across(),
      fell: lattice.time * SECONDS_PER_UPDATE,
      light,
      img: data,
      path: thin(path, 160),
    };
    slides.push(slide);
    if (slides.length > MAX_SLIDES) slides = slides.slice(-MAX_SLIDES);
    save(slides);
    renderSlides();
  };

  function land() {
    if (phase === 'landed') return;
    setPhase('landed');
    path.push([weather.t, weather.v, lattice.time]);
    eyepiece.classList.remove('flash');
    void eyepiece.offsetWidth;
    eyepiece.classList.add('flash');
    keep();
  }

  const download = (canvasOrUrl: HTMLCanvasElement | string, name: string) => {
    const go = (url: string, revoke: boolean) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      if (revoke) setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
    if (typeof canvasOrUrl === 'string') go(canvasOrUrl, false);
    else canvasOrUrl.toBlob((b) => b && go(URL.createObjectURL(b), true), 'image/png');
  };

  const stamp = (t: number) => {
    const d = new Date(t);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const dImg = dialog.querySelector<HTMLImageElement>('[data-d-img]');
  const dNo = dialog.querySelector<HTMLElement>('[data-d-no]');
  const dMeta = dialog.querySelector<HTMLElement>('[data-d-meta]');
  const dTrail = dialog.querySelector<HTMLCanvasElement>('[data-d-trail]');
  let open: Slide | null = null;

  const showSlide = (id: string) => {
    const i = slides.findIndex((s) => s.id === id);
    if (i < 0) return;
    const s = slides[i];
    open = s;
    if (dImg) dImg.src = s.img;
    if (dNo) dNo.textContent = `Slide ${String(i + 1).padStart(2, '0')}`;
    if (dMeta) {
      const when = new Date(s.at).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      dMeta.textContent = `${formatSize(s.across)} across · fell ${formatFall(s.fell)} · caught ${when}`;
    }
    dialog.showModal();
    if (dTrail) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      dTrail.width = Math.round(dTrail.clientWidth * dpr);
      dTrail.height = Math.round(dTrail.clientHeight * dpr);
      const ctx = dTrail.getContext('2d');
      const end = s.path.length ? s.path[s.path.length - 1] : null;
      if (ctx && end) drawCloud(ctx, dTrail.width, dTrail.height, dpr, { t: end[0], v: end[1] }, s.path, end[2], false);
    }
  };

  slidesEl.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('button.slide');
    if (btn?.dataset.id) showSlide(btn.dataset.id);
  });
  dialog.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t === dialog || t.closest('[data-d-close]')) dialog.close();
    else if (t.closest('[data-d-save]') && open) download(open.img, `snow-crystal-${stamp(open.at)}.webp`);
    else if (t.closest('[data-d-remove]') && open) {
      const id = open.id;
      slides = slides.filter((s) => s.id !== id);
      save(slides);
      renderSlides();
      dialog.close();
    }
  });

  // ---- Controls ------------------------------------------------------------------------

  driftBtn.addEventListener('click', () => setDrift(!drifting));
  pauseBtn.addEventListener('click', () => {
    if (phase === 'falling') setPhase('paused');
    else if (phase === 'paused') setPhase('falling');
  });
  catchBtn.addEventListener('click', () => land());
  newBtn.addEventListener('click', () => begin());
  fastBtn.addEventListener('click', () => {
    fast = !fast;
    fastBtn.setAttribute('aria-pressed', String(fast));
  });
  saveBtn.addEventListener('click', () => download(picture(2048), `snow-crystal-${stamp(Date.now())}.png`));

  for (const input of root.querySelectorAll<HTMLInputElement>('input[name="light"]')) {
    input.addEventListener('change', () => {
      if (input.checked && (LIGHTS as string[]).includes(input.value)) {
        light = input.value as Light;
        root.dataset.light = light;
      }
    });
  }

  const steer = (e: PointerEvent) => {
    const r = padCanvas.getBoundingClientRect();
    weather = padToWeather(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  };
  pad.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    setDrift(false);
    try {
      pad.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer can't be captured.
    }
    steer(e);
    e.preventDefault();
  });
  pad.addEventListener('pointermove', (e) => {
    if (dragging) steer(e);
  });
  const release = () => {
    dragging = false;
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  pad.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 2.5 : 0.5;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step / 10],
      ArrowDown: [0, -step / 10],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setDrift(false);
    weather = clampWeather({ t: weather.t + m[0], v: weather.v + m[1] });
  });

  renderSlides();
  begin();
  root.dataset.light = light;
  requestAnimationFrame(frame);

  if (debug) {
    const w = window as unknown as Record<string, unknown>;
    w.snow = {
      lattice,
      get state() {
        return { time: lattice.time, radius: lattice.radius, rho: lattice.rho, params, weather, capacity, phase, rate };
      },
      set light(l: Light) {
        light = l;
      },
      set turbo(n: number) {
        turbo = n;
      },
      weather(t: number, v: number, keepDrift = false) {
        weather = { t, v };
        setDrift(keepDrift);
        params = paramsAt(weather);
      },
      reset() {
        begin();
      },
      picture(size: number, l: Light = light) {
        return microscope.picture(l, size, Math.max(26, lattice.radius * 1.1)).toDataURL();
      },
      /** Resolves once the crystal reaches `radius` cells or `max` updates. */
      until(radius: number, max = MAX_TIME) {
        return new Promise((resolve) => {
          const check = () => {
            if (lattice.radius >= radius || lattice.time >= max || phase === 'landed') {
              if (phase === 'falling') setPhase('paused');
              resolve({ time: lattice.time, radius: lattice.radius });
            } else setTimeout(check, 100);
          };
          check();
        });
      },
    };
  }
}
