// The studio: takes a sitter from the camera, a photograph, or the colour
// chart, and walks one plate through coating, the silver bath, exposure,
// development, fixing, and varnish.

import { drawChart } from './_card';
import { Developer } from './_develop';
import { PlateRenderer, type PlateState } from './_gl';
import { COLLODION, Pour, VARNISH } from './_pour';

type Stage = 'open' | 'compose' | 'coat' | 'bath' | 'expose' | 'develop' | 'fix' | 'varnish' | 'done';
type Rgb = [number, number, number];

const STEPS: Stage[] = ['compose', 'coat', 'bath', 'expose', 'develop', 'fix', 'varnish'];
const GW = 64;
const GH = 80;
/** The integrated exposure's resolution, plate-shaped. */
const ACC_W = 600;
const ACC_H = 750;
/** A scene this bright (collodion's view, centre-weighted) is right at this many seconds. */
const REF_ORTHO = 0.12;
const REF_SECONDS = 4;
const STOPS = [1, 2, 3, 4, 6, 8, 12];
const POUR_RATE = 520;
const POUR_MAX = 900;
const POUR_MIN = 380;
const BATH_SECONDS = 3.2;
const DAY: Rgb = [1, 0.985, 0.955];
const SAFE: Rgb = [0.62, 0.17, 0.06];
const WINDOW_LIGHT: [number, number] = [0.3, 0.16];

interface Sitter {
  kind: 'camera' | 'photo' | 'card';
  el: HTMLVideoElement | ImageBitmap | HTMLCanvasElement;
}

const LIN = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** Collodion's view of a pixel: blue and violet, a little green, no red. */
const ortho = (g: number, b: number) => 0.12 * LIN[g] + 0.88 * LIN[b];

function valueNoise(seed: number) {
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export function start(root: HTMLElement) {
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const $$ = <T extends Element>(sel: string) => [...root.querySelectorAll<T>(sel)];
  const canvas = $<HTMLCanvasElement>('[data-canvas]');
  const say = $<HTMLElement>('[data-say]');
  const count = $<HTMLElement>('[data-count]');
  const meter = $<HTMLElement>('[data-meter]');
  const note = $<HTMLElement>('[data-source-note]');
  const clock = $<HTMLElement>('[data-devclock]');
  const video = $<HTMLVideoElement>('[data-video]');
  const fileInput = $<HTMLInputElement>('[data-file]');
  const book = $<HTMLElement>('[data-book]');
  const bookList = $<HTMLElement>('[data-book-list]');
  const button = (name: string) => $<HTMLButtonElement>(`[data-${name}]`);

  let renderer: PlateRenderer;
  try {
    renderer = new PlateRenderer(canvas, GW, GH);
  } catch {
    $<HTMLElement>('[data-unsupported]').hidden = false;
    canvas.hidden = true;
    $$<HTMLButtonElement>('[data-source]').forEach((b) => (b.disabled = true));
    return;
  }

  const debug = new URLSearchParams(location.search).has('debug');
  const family = getComputedStyle(root).getPropertyValue('--font-tintype').trim() || 'Georgia, serif';

  // --- State -------------------------------------------------------------

  let stage: Stage = 'open';
  let sitter: Sitter | null = null;
  let stream: MediaStream | null = null;
  let seconds = 4;
  let chosenSeconds = false;
  let blue = false;
  let speed = 1;

  let pour = new Pour(GW, GH, COLLODION);
  let coatPhase: 'pour' | 'tilt' | 'auto' | 'set' = 'pour';
  let pointer: { x: number; y: number; down: boolean } = { x: 0, y: 0, down: false };
  let targetTilt: [number, number] = [0, 0];
  let auto: { t: number; plan: AutoStep[]; target: Pour } | null = null;

  let dipped = false;
  let dipTime = 0;
  let canLift = false;

  const acc = new Float32Array(ACC_W * ACC_H);
  const accCanvas = document.createElement('canvas');
  accCanvas.width = ACC_W;
  accCanvas.height = ACC_H;
  const accCtx = accCanvas.getContext('2d', { willReadFrequently: true })!;
  let exposing: { t: number; lead: number } | null = null;

  let dev = new Developer(GW, GH);
  const devBuf = new Float32Array(GW * GH * 4);
  let autoDev: number | null = null;
  let fixT = -1;
  let fixEnd = 0;
  let varnishPour: Pour | null = null;
  const zeroGrid = new Float32Array(GW * GH);
  const filmBuf = new Float32Array(GW * GH);

  const st: PlateState = {
    mode: 0,
    crop: [0, 0, 1, 1],
    flip: [1, 1],
    blue: false,
    latentScale: 1 / (REF_ORTHO * REF_SECONDS),
    hasLatent: false,
    swirl: 0.06,
    residual: COLLODION.residual,
    wetCoat: 0,
    drain: [1, 1],
    ridge: 0,
    streak: 0,
    sens: 0,
    devOn: false,
    fix: -1,
    wetFix: 0,
    varnish: 0,
    wetVarnish: 0,
    comets: new Array(16).fill(0),
    ambient: [...DAY],
    light: [...WINDOW_LIGHT],
    tilt: [0, 0],
    seed: Math.random() * 100,
    time: 0,
  };
  let ambientTarget: Rgb = DAY;
  let lightTarget: [number, number] = [...WINDOW_LIGHT];

  // --- Copy and controls ---------------------------------------------------

  const tell = (text: string) => {
    if (say.textContent !== text) say.textContent = text;
  };

  const setStage = (next: Stage) => {
    stage = next;
    root.dataset.stage = next;
    $$<HTMLElement>('[data-for]').forEach((g) => (g.hidden = g.dataset.for !== next));
    const at = STEPS.indexOf(next === 'done' ? 'varnish' : next);
    $$<HTMLElement>('[data-step]').forEach((li) => {
      const i = STEPS.indexOf(li.dataset.step as Stage);
      li.dataset.state = next === 'done' || i < at ? 'done' : i === at ? 'now' : '';
    });
    const safe = next === 'bath' || next === 'develop';
    root.dataset.light = safe ? 'safe' : 'day';
    ambientTarget = safe ? SAFE : DAY;
  };

  const sourceAspect = () => {
    if (!sitter) return 0.8;
    const el = sitter.el;
    const w = el instanceof HTMLVideoElement ? el.videoWidth : el.width;
    const h = el instanceof HTMLVideoElement ? el.videoHeight : el.height;
    return w && h ? w / h : 0.8;
  };

  /** The plate-shaped part of the sitter's picture, in the source's uv. */
  const crop = (): [number, number, number, number] => {
    const a = sourceAspect();
    if (a > 0.8) {
      const w = 0.8 / a;
      return [(1 - w) / 2, 0, w, 1];
    }
    const h = a / 0.8;
    // Keep heads in frame on tall pictures.
    return [0, (1 - h) * 0.3, 1, h];
  };

  const sourceSize = () => {
    const el = sitter!.el;
    return el instanceof HTMLVideoElement ? [el.videoWidth, el.videoHeight] : [el.width, el.height];
  };

  // --- Sitters -------------------------------------------------------------

  const stopCamera = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  };

  const startCamera = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('unavailable');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  };

  const useSitter = (s: Sitter) => {
    sitter = s;
    if (!(s.el instanceof HTMLVideoElement)) renderer.setSource(s.el);
    chosenSeconds = false;
    compose();
  };

  $$<HTMLButtonElement>('[data-source]').forEach((b) =>
    b.addEventListener('click', async () => {
      const kind = b.dataset.source as Sitter['kind'];
      if (kind === 'photo') {
        fileInput.value = '';
        fileInput.click();
        return;
      }
      if (kind === 'card') {
        await document.fonts.load(`italic 600 64px ${family}`).catch(() => undefined);
        useSitter({ kind: 'card', el: drawChart(family) });
        return;
      }
      b.disabled = true;
      note.textContent = 'Waiting for the camera…';
      try {
        await startCamera();
        note.textContent = 'The picture never leaves this page.';
        useSitter({ kind: 'camera', el: video });
      } catch (e) {
        stopCamera();
        const denied = e instanceof DOMException && e.name === 'NotAllowedError';
        note.textContent = denied
          ? 'The camera is blocked for this page. Bring a photograph instead, or use the colour chart.'
          : 'No camera answered. Bring a photograph instead, or use the colour chart.';
      } finally {
        b.disabled = false;
      }
    }),
  );

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const first = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, 2048 / Math.max(first.width, first.height));
      const bitmap =
        k < 1
          ? await createImageBitmap(first, {
              resizeWidth: Math.round(first.width * k),
              resizeHeight: Math.round(first.height * k),
              resizeQuality: 'high',
            })
          : first;
      if (bitmap !== first) first.close();
      useSitter({ kind: 'photo', el: bitmap });
    } catch {
      note.textContent = "That file didn't open as a picture. Try a JPEG or PNG.";
    }
  });

  // --- Compose: the ground glass --------------------------------------------

  const meterCanvas = document.createElement('canvas');
  meterCanvas.width = 40;
  meterCanvas.height = 50;
  const meterCtx = meterCanvas.getContext('2d', { willReadFrequently: true })!;
  let meterAt = 0;

  const meterLight = () => {
    if (!sitter) return;
    const [sw, sh] = sourceSize();
    if (!sw) return;
    const [cx, cy, cw, ch] = crop();
    meterCtx.drawImage(sitter.el, cx * sw, cy * sh, cw * sw, ch * sh, 0, 0, 40, 50);
    const px = meterCtx.getImageData(0, 0, 40, 50).data;
    let sum = 0;
    let wsum = 0;
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 40; x++) {
        const w = 0.3 + Math.exp(-((x / 40 - 0.5) ** 2 / 0.05 + (y / 50 - 0.42) ** 2 / 0.07));
        const i = (y * 40 + x) * 4;
        sum += ortho(px[i + 1], px[i + 2]) * w;
        wsum += w;
      }
    }
    const level = sum / wsum;
    const want = (REF_SECONDS * REF_ORTHO) / Math.max(level, 1e-3);
    const best = STOPS.reduce((a, b) => (Math.abs(Math.log(b / want)) < Math.abs(Math.log(a / want)) ? b : a));
    $$<HTMLLabelElement>('.seconds label').forEach((l) => {
      l.toggleAttribute('data-suggested', l.querySelector('input')!.value === String(best));
    });
    if (!chosenSeconds) setSeconds(best);
    meter.textContent =
      want > 16
        ? `Dim light for collodion: even 12 seconds will come out thin.`
        : want < 0.8
          ? `Bright, blue light: 1 second will be plenty.`
          : `The light here wants about ${best} ${best === 1 ? 'second' : 'seconds'}.`;
  };

  const setSeconds = (s: number) => {
    seconds = s;
    const input = root.querySelector<HTMLInputElement>(`input[name='exposure'][value='${s}']`);
    if (input) input.checked = true;
  };

  $$<HTMLInputElement>("input[name='exposure']").forEach((i) =>
    i.addEventListener('change', () => {
      seconds = Number(i.value);
      chosenSeconds = true;
    }),
  );

  button('blue').addEventListener('click', () => {
    blue = !blue;
    button('blue').setAttribute('aria-pressed', String(blue));
    tell(blue ? 'Through blue glass you see roughly what the plate will: reds go dark, blues go pale.' : glassLine());
  });

  const glassLine = () =>
    `This is the camera’s ground glass, so ${sitter?.kind === 'camera' ? 'you are' : 'the picture is'} upside down and back to front. Choose an exposure, then coat a plate.`;

  const compose = () => {
    setStage('compose');
    blue = false;
    button('blue').setAttribute('aria-pressed', 'false');
    tell(glassLine());
    meterAt = 0;
    canvas.setAttribute('aria-label', 'The camera’s ground glass, showing the sitter upside down');
  };

  button('to-open').addEventListener('click', () => {
    stopCamera();
    sitter = null;
    setStage('open');
    tell(
      'Sit for a portrait the way it was done in the 1860s: on a sheet of black iron, coated and developed by hand while it is still wet.',
    );
    canvas.setAttribute('aria-label', 'A blank tintype plate: a sheet of black iron');
  });

  // --- Coat ----------------------------------------------------------------

  interface AutoStep {
    until: number;
    tilt: [number, number];
    pour?: [number, number];
    rock?: boolean;
  }

  const corner = (n: number, k: number): [number, number] => {
    const s = Math.SQRT1_2 * k;
    return [
      [-s, -s],
      [s, -s],
      [s, s],
      [-s, s],
    ][n] as [number, number];
  };

  /** The usual order: pour high on the right, run it round the corners, drain from the last. */
  const coatPlan = (drain: number): AutoStep[] => [
    { until: 1.6, tilt: [0, 0], pour: [GW * 0.6, GH * 0.32] },
    { until: 2.0, tilt: [0, 0] },
    { until: 4.0, tilt: corner(1, 0.5) },
    { until: 6.3, tilt: corner(0, 0.5) },
    { until: 8.6, tilt: corner(3, 0.5) },
    { until: 9.6, tilt: [0, 0.45] },
    { until: 11.6, tilt: corner(2, 0.5) },
    { until: 16.4, tilt: corner(drain, 0.94), rock: true },
    { until: 17.4, tilt: [0, 0] },
  ];

  const newPlate = () => {
    pour = new Pour(GW, GH, COLLODION);
    coatPhase = 'pour';
    auto = null;
    targetTilt = [0, 0];
    dev = new Developer(GW, GH);
    autoDev = null;
    fixT = -1;
    varnishPour = null;
    dipped = false;
    dipTime = 0;
    acc.fill(0);
    st.seed = Math.random() * 100;
    st.hasLatent = false;
    st.sens = 0;
    st.streak = 0;
    st.ridge = 0;
    st.devOn = false;
    st.fix = -1;
    st.wetFix = 0;
    st.varnish = 0;
    st.wetVarnish = 0;
    st.wetCoat = 1;
    st.comets.fill(0);
    renderer.setCoat(pour.smoothed(filmBuf));
    renderer.setVarnish(zeroGrid);
    renderer.setClear(zeroGrid);
    dev.fill(devBuf);
    renderer.setDev(devBuf);
  };

  button('to-coat').addEventListener('click', () => {
    newPlate();
    setStage('coat');
    button('to-bath').disabled = true;
    button('auto-coat').disabled = false;
    tell('Hold down on the plate to pour a pool of collodion, about a third as wide as the plate.');
    canvas.setAttribute('aria-label', 'A tintype plate being coated with collodion');
  });

  button('wipe').addEventListener('click', () => {
    newPlate();
    button('to-bath').disabled = true;
    button('auto-coat').disabled = false;
    tell('Wiped clean. Hold down on the plate to pour a fresh pool.');
  });

  button('auto-coat').addEventListener('click', () => {
    if (pour.poured > 0) newPlate();
    coatPhase = 'auto';
    auto = { t: 0, plan: coatPlan(2), target: pour };
    button('auto-coat').disabled = true;
    tell('Pour high on one side, run the pool into each corner in turn, then drain it off the last corner.');
  });

  const cellAt = (e: PointerEvent): [number, number] => [
    (e.offsetX / canvas.clientWidth) * GW,
    (e.offsetY / canvas.clientHeight) * GH,
  ];

  canvas.addEventListener('pointerdown', (e) => {
    if (stage !== 'coat' && stage !== 'develop') return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured.
    }
    const [x, y] = cellAt(e);
    pointer = { x, y, down: true };
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = cellAt(e);
    pointer.x = x;
    pointer.y = y;
    // On a bare or finished plate, the window's reflection follows the pointer as if the plate were turned.
    if (stage === 'open' || stage === 'done') {
      lightTarget = [
        0.5 - (e.offsetX / canvas.clientWidth - 0.5) * 0.9,
        0.3 - (e.offsetY / canvas.clientHeight - 0.5) * 0.7,
      ];
    }
  });

  canvas.addEventListener('pointerleave', () => {
    lightTarget = [...WINDOW_LIGHT];
  });

  const release = () => {
    pointer.down = false;
    if (stage === 'coat' && coatPhase === 'pour' && pour.poured > 0) {
      if (pour.poured >= POUR_MIN) {
        coatPhase = 'tilt';
        tell('Now tip the plate: press and drag toward where the pool should run. Take it into each corner in turn.');
      } else tell('That pool won’t cover the plate. Pour a little more.');
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const coatStep = (dt: number) => {
    if (coatPhase === 'pour' && pointer.down && pour.poured < POUR_MAX) {
      pour.pourAt(pointer.x, pointer.y, POUR_RATE * dt);
    }
    if (coatPhase === 'tilt') {
      if (pointer.down) {
        // Inside the plate the tip stays gentle enough to hold the pool; past an edge it steepens.
        let tx = ((pointer.x / GW) * 2 - 1) * 0.45;
        let ty = ((pointer.y / GH) * 2 - 1) * 0.45;
        const m = Math.hypot(tx, ty);
        if (m > 1) {
          tx /= m;
          ty /= m;
        }
        targetTilt = [tx, ty];
      } else targetTilt = [0, 0];
    }
    const k = Math.min(1, dt * 7);
    pour.tiltX += (targetTilt[0] - pour.tiltX) * k;
    pour.tiltY += (targetTilt[1] - pour.tiltY) * k;
    pour.step(dt);
    renderer.setCoat(pour.smoothed(filmBuf));

    const cov = pour.coverage();
    const mobile = pour.mobile();
    if (coatPhase === 'tilt' || coatPhase === 'auto') {
      button('to-bath').disabled = coatPhase === 'auto' || cov < 0.4;
      button('wipe').disabled = coatPhase === 'auto';
      if (pour.setting() > 0.85 && coatPhase !== 'auto') {
        coatPhase = 'set';
        tell(
          cov > 0.99
            ? 'The collodion has set. Into the silver bath.'
            : 'The collodion has set. The bare patches will stay black on the finished plate. Into the silver bath.',
        );
      } else if (coatPhase === 'tilt') {
        if (mobile < 40 && pour.drained > 50) {
          tell(
            cov > 0.985
              ? 'Coated. Into the silver bath before the film skins over.'
              : 'Coated, but the pool missed some of the plate, and bare iron will print black. Into the bath anyway, or wipe it and pour again.',
          );
        } else if (cov > 0.97 && pour.drained < 50)
          tell(
            'Covered. Now drag out past one corner to tip the rest back into the bottle, rocking it a little as it drains.',
          );
      }
    }
  };

  // --- The silver bath -----------------------------------------------------

  /** Freeze the film: whatever still stands in a pool sets where it is. */
  const settleCoat = () => {
    const film = pour.smoothed(filmBuf);
    for (let i = 0; i < film.length; i++) film[i] = Math.min(film[i], COLLODION.residual + 0.14);
    renderer.setCoat(film);
    const drainCorner = pour.drained > 30 ? pour.drainCorner : 2;
    st.drain = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ][drainCorner] as [number, number];
    st.ridge = pour.drained > 30 ? Math.max(0.12, 0.75 - pour.rock * 0.3) : 0;
    // Dust in the collodion: a comet or two, their tails running the way the film drained.
    const n = Math.random() < 0.35 ? 0 : Math.random() < 0.7 ? 1 : 2;
    for (let i = 0; i < 4; i++) {
      if (i >= n) {
        st.comets.fill(0, i * 4, i * 4 + 4);
        continue;
      }
      const x = 0.15 + Math.random() * 0.7;
      const y = 0.12 + Math.random() * 0.76;
      const ang = Math.atan2((st.drain[1] - y) * 1.25, (st.drain[0] - x) * 1) + (Math.random() - 0.5) * 0.4;
      st.comets.splice(i * 4, 4, x, y, ang, 0.012 + Math.random() * 0.03);
    }
    st.wetCoat = 0.35;
  };

  button('to-bath').addEventListener('click', () => {
    if (coatPhase === 'auto') return;
    settleCoat();
    setStage('bath');
    dipped = false;
    dipTime = 0;
    canLift = false;
    button('lift').disabled = true;
    button('lift').hidden = false;
    button('rebath').hidden = true;
    button('to-expose').hidden = true;
    tell(
      'Three minutes in the silver bath turns the film creamy and sensitive to light. Lift it out when it stops looking greasy.',
    );
    setTimeout(() => dip(true), 350);
  });

  const dip = (down: boolean) => {
    dipped = down;
    root.toggleAttribute('data-dipped', down);
  };

  button('lift').addEventListener('click', () => {
    dip(false);
    button('lift').hidden = true;
    st.streak = Math.max(0, Math.min(1, (BATH_SECONDS - dipTime) / BATH_SECONDS));
    if (st.streak > 0.12) {
      button('rebath').hidden = false;
      button('to-expose').hidden = false;
      button('to-expose').textContent = 'Use it anyway';
      tell('Still greasy: the silver hasn’t taken everywhere yet, and those streaks will print.');
    } else {
      st.streak = 0;
      button('to-expose').hidden = false;
      button('to-expose').textContent = 'Load the holder';
      tell('Creamy and even. Into the holder while it is still wet.');
    }
  });

  button('rebath').addEventListener('click', () => {
    button('rebath').hidden = true;
    button('to-expose').hidden = true;
    button('lift').hidden = false;
    button('lift').disabled = true;
    canLift = false;
    tell('Back in the silver. Give it a little longer.');
    dip(true);
  });

  // --- Expose --------------------------------------------------------------

  button('to-expose').addEventListener('click', async () => {
    setStage('expose');
    button('uncap').hidden = false;
    count.hidden = true;
    if (sitter?.kind === 'camera' && !stream) {
      try {
        await startCamera();
      } catch {
        tell('The camera has gone. Bring a photograph or use the colour chart instead.');
      }
    }
    const span = `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
    tell(
      sitter?.kind === 'camera'
        ? `The plate is in the camera. Sit back, look into the lens, and keep still for ${span}.`
        : `The plate is in the camera, facing the picture. The lens will be open for ${span}.`,
    );
    canvas.setAttribute('aria-label', 'The sitter in the camera’s view, as the plate will see them');
  });

  button('uncap').addEventListener('click', () => {
    button('uncap').hidden = true;
    const live = sitter?.kind === 'camera';
    exposing = { t: 0, lead: live ? 3 : 0 };
    acc.fill(0);
    count.hidden = false;
    count.textContent = live ? '3' : '';
    tell(live ? 'Hold still…' : 'The cap is off.');
  });

  const accumulate = (dt: number) => {
    if (!sitter) return;
    const [sw, sh] = sourceSize();
    if (!sw) return;
    const [cx, cy, cw, ch] = crop();
    accCtx.setTransform(-1, 0, 0, 1, ACC_W, 0);
    accCtx.drawImage(sitter.el, cx * sw, cy * sh, cw * sw, ch * sh, 0, 0, ACC_W, ACC_H);
    accCtx.setTransform(1, 0, 0, 1, 0, 0);
    const px = accCtx.getImageData(0, 0, ACC_W, ACC_H).data;
    for (let i = 0, j = 0; i < acc.length; i++, j += 4) acc[i] += ortho(px[j + 1], px[j + 2]) * dt;
  };

  const exposeStep = (dt: number) => {
    if (!exposing) return;
    if (exposing.lead > 0) {
      exposing.lead -= dt;
      if (exposing.lead > 0) {
        count.textContent = String(Math.ceil(exposing.lead));
        return;
      }
      tell('The cap is off. Keep still.');
    }
    const step = Math.min(dt, seconds - exposing.t);
    if (sitter?.kind === 'camera') accumulate(step);
    exposing.t += step;
    count.textContent = String(Math.min(seconds, Math.floor(exposing.t) + 1));
    if (exposing.t >= seconds - 1e-6) {
      if (sitter?.kind !== 'camera') accumulate(seconds);
      exposing = null;
      count.hidden = true;
      if (sitter?.kind === 'camera') stopCamera();
      renderer.setLatent(acc, ACC_W, ACC_H);
      st.hasLatent = true;
      tell('Capped. Into the darkroom.');
      setTimeout(toDevelop, 900);
    }
  };

  // --- Develop -------------------------------------------------------------

  const toDevelop = () => {
    setStage('develop');
    st.devOn = true;
    button('rinse').disabled = true;
    button('auto-dev').disabled = false;
    clock.textContent = '';
    tell('Pour the developer: one smooth stroke across the plate, so it sheets over everything at once.');
    canvas.setAttribute('aria-label', 'The exposed plate, being developed under the safelight');
  };

  button('auto-dev').addEventListener('click', () => {
    autoDev = 0;
    button('auto-dev').disabled = true;
  });

  const devStep = (dt: number) => {
    if (autoDev !== null) {
      autoDev += dt;
      if (autoDev < 0.6) dev.pourAt(4 + (autoDev / 0.6) * (GW - 8), 5, dt);
      else autoDev = null;
    } else if (pointer.down && dev.stoppedAt === Infinity) dev.pourAt(pointer.x, pointer.y, dt);
    dev.step(dt);
    dev.fill(devBuf);
    renderer.setDev(devBuf);
    if (dev.poured && dev.stoppedAt === Infinity) {
      if (button('rinse').disabled) {
        button('rinse').disabled = false;
        button('auto-dev').disabled = true;
        tell(
          `Watch the light parts come up. Rinse when ${sitter?.kind === 'camera' ? 'your face' : 'the picture'} is clear and before the shadows start to veil: about fifteen seconds.`,
        );
      }
      clock.textContent = `${Math.floor(dev.time - dev.firstPourAt)} s`;
    }
  };

  button('rinse').addEventListener('click', () => {
    dev.rinse();
    button('rinse').disabled = true;
    const covered = dev.coverage();
    tell(
      covered < 0.97
        ? 'Rinsed. Where the developer never reached, the plate will clear to black.'
        : 'Rinsed. The plate is safe in the light now.',
    );
    setTimeout(() => {
      setStage('fix');
      button('to-fix').hidden = false;
      tell('Developed, but it still looks like a negative under the cream. Put it in the fixer.');
    }, 1200);
  });

  // --- Fix -----------------------------------------------------------------

  button('to-fix').addEventListener('click', () => {
    button('to-fix').hidden = true;
    const noise = valueNoise(st.seed);
    const clearMap = new Float32Array(GW * GH);
    let latest = 0;
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const edge = Math.min(i, GW - 1 - i, j, GH - 1 - j) / (GH / 2);
        const film = Math.max(0, pour.depth[j * GW + i] - COLLODION.residual);
        const t = 0.4 + edge * 3.4 + film * 9 + noise(i / 7, j / 7) * 0.9;
        clearMap[j * GW + i] = t;
        latest = Math.max(latest, t);
      }
    }
    renderer.setClear(clearMap);
    fixT = 0;
    fixEnd = latest + 0.8;
    st.wetFix = 1;
    tell('In the fixer, the unused cream dissolves away and the picture turns positive.');
  });

  const fixStep = (dt: number) => {
    if (fixT < 0) return;
    fixT += dt;
    st.fix = fixT;
    if (fixT >= fixEnd && stage === 'fix') {
      setStage('varnish');
      tell('Fixed. A coat of varnish, flowed on warm, protects it. Or leave it bare.');
    }
  };

  // --- Varnish -------------------------------------------------------------

  button('varnish').addEventListener('click', () => {
    varnishPour = new Pour(GW, GH, VARNISH);
    const plan = coatPlan(st.drain[0] === 0 ? (st.drain[1] === 0 ? 0 : 3) : st.drain[1] === 0 ? 1 : 2).map((s) => ({
      ...s,
      until: s.until * 0.7,
    }));
    auto = { t: 0, plan, target: varnishPour };
    button('varnish').disabled = true;
    button('bare').disabled = true;
    st.varnish = 0;
    st.wetVarnish = 1;
    tell('Warmed over the lamp, the plate takes the varnish evenly. The excess goes back in the bottle.');
  });

  button('bare').addEventListener('click', () => finish());

  // --- Done ----------------------------------------------------------------

  const plateImage = (w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.putImageData(renderer.snapshot({ ...st, light: [...WINDOW_LIGHT], tilt: [0, 0] }, w, h), 0, 0);
    return c;
  };

  const finish = () => {
    setStage('done');
    button('varnish').disabled = false;
    button('bare').disabled = false;
    st.wetVarnish = 0;
    tell(
      sitter?.kind === 'card'
        ? 'Your tintype of the colour chart: red gone to black, blue to white, and the lettering back to front.'
        : sitter?.kind === 'photo'
          ? 'Your tintype. Like every tintype it is a mirror image, the picture turned left for right.'
          : 'Your tintype. Like every tintype it is a mirror image: this is you as your mirror sees you.',
    );
    canvas.setAttribute('aria-label', 'The finished tintype');
    const thumb = plateImage(224, 280).toDataURL('image/png');
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.title = 'This plate';
    const img = document.createElement('img');
    img.src = thumb;
    img.alt = `Plate ${bookList.children.length + 1}`;
    b.append(img);
    li.append(b);
    bookList.append(li);
    book.hidden = false;
  };

  button('save').addEventListener('click', () => {
    plateImage(1600, 2000).toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      a.href = URL.createObjectURL(blob);
      a.download = `tintype-${stamp}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  });

  button('again').addEventListener('click', async () => {
    if (sitter?.kind === 'camera') {
      try {
        await startCamera();
      } catch {
        stopCamera();
        sitter = null;
        setStage('open');
        note.textContent = 'The camera didn’t come back. Bring a photograph instead, or use the colour chart.';
        return;
      }
    }
    newPlate();
    st.wetCoat = 0;
    compose();
  });

  // --- The loop ------------------------------------------------------------

  const autoStep = (dt: number) => {
    if (!auto) return;
    auto.t += dt;
    const step = auto.plan.find((s) => auto!.t < s.until);
    const target = auto.target;
    if (!step) {
      const done = auto;
      auto = null;
      if (done.target === pour) {
        coatPhase = 'tilt';
        targetTilt = [0, 0];
        tell('Coated. Into the silver bath before the film skins over.');
      } else finish();
      return;
    }
    let [tx, ty] = step.tilt;
    if (step.rock) {
      const r = Math.sin(auto.t * 5) * 0.12;
      tx += r;
      ty -= r;
    }
    if (step.pour) target.pourAt(step.pour[0], step.pour[1], POUR_RATE * dt);
    if (target === pour) targetTilt = [tx, ty];
    else {
      const k = Math.min(1, dt * 7);
      target.tiltX += (tx - target.tiltX) * k;
      target.tiltY += (ty - target.tiltY) * k;
      target.step(dt);
      renderer.setVarnish(target.smoothed(filmBuf));
      st.varnish = Math.min(1, auto.t / (auto.plan[auto.plan.length - 1].until * 0.8));
    }
  };

  const ease = (a: number, b: number, k: number) => a + (b - a) * k;
  let last = performance.now();
  let lastKey = '';

  const frame = (now: number) => {
    const real = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dt = real * speed;
    st.time += dt;

    autoStep(dt);
    if (stage === 'coat') coatStep(dt);
    if (stage === 'bath') {
      if (dipped) {
        dipTime += dt;
        st.sens = Math.min(1, st.sens + dt / (BATH_SECONDS * 0.8));
        if (!canLift && dipTime > 0.9) {
          canLift = true;
          button('lift').disabled = false;
        }
      }
    }
    if (stage === 'expose') exposeStep(dt);
    if (stage === 'develop' || (stage === 'fix' && dev.stoppedAt === Infinity)) devStep(dt);
    if (stage === 'fix' || stage === 'varnish') fixStep(dt);
    if (stage !== 'fix' && st.wetFix > 0 && fixT >= fixEnd) st.wetFix = Math.max(0, st.wetFix - dt * 0.5);
    if (stage === 'done' || stage === 'varnish') st.wetVarnish = Math.max(auto ? 1 : 0, st.wetVarnish - dt * 0.4);

    // The camera view and ground glass follow the live picture.
    if (sitter && (stage === 'compose' || stage === 'expose')) {
      if (sitter.el instanceof HTMLVideoElement && sitter.el.readyState >= 2) renderer.setSource(sitter.el);
      st.crop = crop();
      if (stage === 'compose' && now - meterAt > 400) {
        meterAt = now;
        meterLight();
      }
    }
    st.mode = stage === 'compose' ? 1 : stage === 'expose' && sitter ? 2 : 0;
    st.flip = stage === 'compose' ? [-1, -1] : [-1, 1];
    st.blue = blue;

    for (let i = 0; i < 3; i++) st.ambient[i] = ease(st.ambient[i], ambientTarget[i], Math.min(1, real * 1.6));
    if (stage !== 'done' && stage !== 'open') lightTarget = [...WINDOW_LIGHT];
    st.light[0] = ease(st.light[0], lightTarget[0], Math.min(1, real * 4));
    st.light[1] = ease(st.light[1], lightTarget[1], Math.min(1, real * 4));
    const tilt: [number, number] = stage === 'coat' ? [pour.tiltX, pour.tiltY] : [0, 0];
    st.tilt = tilt;
    root.style.setProperty('--tx', tilt[0].toFixed(3));
    root.style.setProperty('--ty', tilt[1].toFixed(3));

    renderer.resize();
    // A bare or finished plate at rest needs no redrawing.
    const still = stage === 'open' || stage === 'done' || (stage === 'varnish' && !auto);
    const key = still
      ? [stage, ...st.light, ...st.ambient, st.wetVarnish, st.wetFix, st.varnish, canvas.width, canvas.height]
          .map((v) => (typeof v === 'number' ? v.toFixed(4) : v))
          .join()
      : '';
    if (!still || key !== lastKey) renderer.draw(st);
    lastKey = key;
    requestAnimationFrame(frame);
  };

  // The camera goes dark while the page is out of sight, and comes back on return.
  let cameraPaused = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream && stage === 'compose') {
      stopCamera();
      cameraPaused = true;
    } else if (!document.hidden && cameraPaused) {
      cameraPaused = false;
      if (stage === 'compose' && sitter?.kind === 'camera') startCamera().catch(() => undefined);
    }
  });

  newPlate();
  st.wetCoat = 0;
  setStage('open');
  requestAnimationFrame(frame);

  if (debug) {
    Object.assign(window, {
      tintype: {
        get stage() {
          return stage;
        },
        set speed(v: number) {
          speed = v;
        },
        state: () => ({
          stage,
          coverage: pour.coverage(),
          poured: pour.poured,
          drained: pour.drained,
          mobile: pour.mobile(),
          setting: pour.setting(),
          rock: pour.rock,
          dipTime,
          streak: st.streak,
          seconds,
          latentMean: acc.reduce((a, b) => a + b, 0) / acc.length,
          devCoverage: dev.coverage(),
          devTime: dev.time - dev.firstPourAt,
          fix: st.fix,
          ambient: st.ambient,
        }),
        useChart: () => useSitter({ kind: 'card', el: drawChart(family) }),
        plate: () => plateImage(320, 400).toDataURL('image/png'),
      },
    });
  }
}
