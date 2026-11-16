// The page: the bench renderer, the worker running the dish, the coil supply
// panel, and the hand that holds a magnet under the dish.

import { Bench, FLOOR_Y, type View } from './_render';
import { DISH, MAGNET_K, type Spike, type LatticeStats } from './_sim';

interface Frame {
  kind: 'frame';
  coil: number;
  magnet: { x: number; y: number; depth: number; lift: number };
  data: Float32Array;
  spikes?: (Spike & { top: number })[];
  stats?: LatticeStats;
}

const VIEWS: Record<string, (aspect: number) => View> = {
  bench: (a) => ({
    target: [0, 42, a < 0.8 ? 10 : 18],
    el: 0.6,
    az: -0.12,
    dist: a < 0.8 ? 760 / Math.max(a, 0.45) ** 0.55 : a < 1.25 ? 600 : 520,
    fov: 0.5,
  }),
  above: (a) => ({ target: [0, FLOOR_Y, 4], el: 1.17, az: -0.08, dist: a < 1 ? 520 / Math.max(a, 0.45) : 380, fov: 0.42 }),
  low: (a) => ({ target: [0, FLOOR_Y + 6, 0], el: 0.15, az: -0.25, dist: a < 0.8 ? 560 : 330, fov: 0.42 }),
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function lerpView(a: View, b: View, t: number): View {
  const m = (x: number, y: number) => x + (y - x) * t;
  return {
    target: [m(a.target[0], b.target[0]), m(a.target[1], b.target[1]), m(a.target[2], b.target[2])],
    el: m(a.el, b.el),
    az: m(a.az, b.az),
    dist: m(a.dist, b.dist),
    fov: m(a.fov, b.fov),
  };
}

function start(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-scene]')!;
  const marks = root.querySelector<HTMLCanvasElement>('[data-marks]')!;
  const fallback = root.querySelector<HTMLElement>('[data-fallback]')!;
  const coilInput = root.querySelector<HTMLInputElement>('[data-coil]')!;
  const coilOut = root.querySelector<HTMLOutputElement>('[data-coil-out]')!;
  const needle = root.querySelector<SVGGElement>('[data-needle]')!;
  const countEl = root.querySelector<HTMLElement>('[data-count]')!;
  const spacingEl = root.querySelector<HTMLElement>('[data-spacing]')!;
  const latticeEl = root.querySelector<HTMLElement>('[data-lattice]')!;
  const hint = root.querySelector<HTMLElement>('[data-hint]')!;
  const marksBtn = root.querySelector<HTMLButtonElement>('[data-marks-btn]')!;
  const viewBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-view-btn]')];

  let bench: Bench;
  try {
    if (typeof Worker === 'undefined') throw new Error('no workers');
    bench = new Bench(canvas);
  } catch (err) {
    console.warn(err);
    fallback.hidden = false;
    root.querySelector<HTMLElement>('.panel')!.hidden = true;
    hint.hidden = true;
    return;
  }
  bench.magK = MAGNET_K;

  const worker = new Worker(new URL('./_worker.ts', import.meta.url), { type: 'module' });
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  if (params.has('seed')) worker.postMessage({ kind: 'reset', seed: Number(params.get('seed')) });

  let coil = 0;
  let hand: { x: number; y: number; down: boolean } | null = null;
  let showMarks = false;
  let spikes: (Spike & { top: number })[] = [];
  let actualCoil = 0;
  let frames = 0;

  const send = () => worker.postMessage({ kind: 'input', coil, hand });

  worker.onmessage = (e: MessageEvent) => {
    const m = e.data as Frame | { kind: 'ran' };
    if (m.kind !== 'frame') {
      ranResolve?.();
      ranResolve = null;
      return;
    }
    bench.upload(m.data);
    worker.postMessage({ kind: 'buffer', buffer: m.data.buffer }, [m.data.buffer]);
    bench.coil = m.coil;
    bench.magnet = m.magnet;
    actualCoil = m.coil;
    frames++;
    if (m.spikes) spikes = m.spikes;
    if (m.stats) {
      const s = m.stats;
      countEl.textContent = String(s.count);
      spacingEl.textContent = s.count > 2 ? `${s.spacing.toFixed(1)} mm` : '–';
      if (s.count === 0) latticeEl.textContent = 'flat';
      else if (s.count < 4) latticeEl.textContent = s.count === 1 ? 'a lone spike' : 'a few spikes';
      else {
        latticeEl.textContent = `hexagonal ${s.hex} · square ${s.square} · defects ${s.defect}`;
      }
    }
  };
  let ranResolve: (() => void) | null = null;

  // ---------------------------------------------------------- the panel

  const setCoil = (v: number) => {
    coil = Math.max(0, Math.min(40, v));
    coilInput.value = String(coil);
    coilOut.textContent = `${coil.toFixed(1)} mT`;
    send();
  };
  coilInput.addEventListener('input', () => setCoil(Number(coilInput.value)));

  let viewName = 'bench';
  let viewFrom: View | null = null;
  let viewT = 1;
  let current: View = VIEWS.bench(1);
  const setView = (name: string) => {
    if (!VIEWS[name] || name === viewName) return;
    viewFrom = current;
    viewName = name;
    viewT = 0;
    root.dataset.view = name;
    for (const b of viewBtns) b.setAttribute('aria-pressed', String(b.dataset.viewBtn === name));
  };
  for (const b of viewBtns) b.addEventListener('click', () => setView(b.dataset.viewBtn!));

  marksBtn.addEventListener('click', () => {
    showMarks = !showMarks;
    marksBtn.setAttribute('aria-pressed', String(showMarks));
  });

  // ---------------------------------------------------------- the hand

  let size = { w: 1, h: 1 };
  const toDish = (e: PointerEvent): [number, number] | null => {
    const r = canvas.getBoundingClientRect();
    return bench.pick(e.clientX - r.left, e.clientY - r.top, size.w, size.h, FLOOR_Y + 4);
  };
  const clampHand = (x: number, z: number): [number, number] => {
    const r = Math.hypot(x, z);
    const max = DISH.rim + 6;
    return r > max ? [(x / r) * max, (z / r) * max] : [x, z];
  };
  canvas.addEventListener('pointerdown', (e) => {
    const p = toDish(e);
    if (!p || Math.hypot(p[0], p[1]) > DISH.lip + 8) return;
    const [x, z] = clampHand(p[0], p[1]);
    hand = { x, y: z, down: true };
    root.dataset.pressing = '';
    hint.dataset.gone = '';
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer may not be capturable.
    }
    send();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toDish(e);
    if (!p) return;
    const [x, z] = clampHand(p[0], p[1]);
    const down = hand?.down ?? false;
    if (!down && Math.hypot(p[0], p[1]) > DISH.lip + 30) return;
    hand = { x, y: z, down };
    send();
  });
  const release = () => {
    if (!hand?.down) return;
    hand = { ...hand, down: false };
    delete root.dataset.pressing;
    send();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);

  // ---------------------------------------------------------- drawing

  const mctx = marks.getContext('2d')!;
  let dpr = 1;
  const resize = () => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w * h * dpr * dpr > 3.2e6) dpr = Math.sqrt(3.2e6 / (w * h));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    marks.width = Math.round(w * dpr);
    marks.height = Math.round(h * dpr);
    size = { w, h };
  };
  resize();
  new ResizeObserver(resize).observe(root);

  const drawMarks = () => {
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, marks.width, marks.height);
    if (!showMarks) return;
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const s of spikes) {
      const p = bench.project(s.x, FLOOR_Y + s.top + 1.2, s.y, size.w, size.h);
      if (!p) continue;
      if (s.kind === 0) continue;
      const colour = s.kind === 6 ? '#e9c46a' : s.kind === 4 ? '#7cc6d6' : '#e76f51';
      mctx.beginPath();
      if (s.kind === 4) mctx.rect(p[0] - 4, p[1] - 4, 8, 8);
      else if (s.kind === 6) {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const x = p[0] + 5 * Math.cos(a);
          const y = p[1] + 5 * Math.sin(a);
          if (k === 0) mctx.moveTo(x, y);
          else mctx.lineTo(x, y);
        }
        mctx.closePath();
      } else mctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2);
      mctx.lineWidth = 2;
      mctx.strokeStyle = 'rgb(0 0 0 / 0.6)';
      mctx.stroke();
      mctx.lineWidth = 1.4;
      mctx.strokeStyle = colour;
      mctx.stroke();
    }
  };

  let last = performance.now();
  let needleAngle = -50;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const aspect = size.w / size.h;
    const target = VIEWS[viewName](aspect);
    if (viewT < 1 && viewFrom) {
      viewT = Math.min(1, viewT + dt / 0.9);
      current = lerpView(viewFrom, target, ease(viewT));
    } else current = target;
    bench.setView(current, aspect);
    bench.draw(canvas.width, canvas.height);
    // The meter needle swings with a little lag, like a moving-coil movement.
    const goal = -50 + (Math.min(40, actualCoil) / 40) * 100;
    needleAngle += (goal - needleAngle) * (1 - Math.exp(-dt / 0.09));
    needle.style.transform = `rotate(${needleAngle.toFixed(2)}deg)`;
    drawMarks();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  document.addEventListener('visibilitychange', () => worker.postMessage({ kind: 'pause', paused: document.hidden }));

  if (debug) {
    Object.assign(window, {
      ferro: {
        setCoil,
        setView,
        marks: (on: boolean) => {
          showMarks = on;
          marksBtn.setAttribute('aria-pressed', String(on));
        },
        press: (x: number, y: number) => {
          hand = { x, y, down: true };
          send();
        },
        release: () => {
          if (hand) hand = { ...hand, down: false };
          send();
        },
        /** Advance the dish this many seconds at once, holding the current inputs. */
        run: (seconds: number) =>
          new Promise<void>((resolve) => {
            ranResolve = resolve;
            worker.postMessage({ kind: 'run', seconds });
          }),
        state: () => ({ coil, actualCoil, frames, spikes: spikes.length, view: viewName }),
      },
    });
  }
}

const root = document.querySelector<HTMLElement>('.ferro');
if (root) start(root);
