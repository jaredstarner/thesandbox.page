// The fishing hole: wires the lake, the angler, and the page's controls together.

import { Angler } from './_angler';
import { moonPhase, moonProgress, partOfDay, skyAt, sunProgress } from './_daylight';
import { Renderer } from './_gl';
import { Rope } from './_line';
import { Layer, rgb } from './_pixels';
import { drawBack, drawBed, drawDock } from './_scenery';
import { Water } from './_water';
import { WORLD_W, bedAt } from './_world';

const STEP = 1 / 60;
/** The band of the world that should stay in view: hilltops to the deepest bed. */
const BAND_TOP = -50;
const BAND_BOTTOM = 96;

const LINE = rgb(0xe8f1f4);
const FLOAT_RED = rgb(0xe5413a);
const FLOAT_WHITE = rgb(0xf4f1ea);

/** The hour to show: the visitor's clock, or ?hour=21.5 to visit another time. */
function clockHour(): { hour: number; fixed: boolean } {
  const param = new URLSearchParams(location.search).get('hour');
  const fixed = param !== null && param.trim() !== '' && Number.isFinite(Number(param));
  if (fixed) return { hour: ((Number(param) % 24) + 24) % 24, fixed };
  const d = new Date();
  return { hour: d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600, fixed: false };
}

function clockText(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'} · ${partOfDay(hour)}`;
}

export function startFishing(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-view]');
  const unsupported = root.querySelector<HTMLElement>('[data-unsupported]');
  const clock = root.querySelector<HTMLElement>('[data-clock]');
  if (!canvas) return;

  const fail = (message: string) => {
    if (unsupported) {
      unsupported.textContent = message;
      unsupported.hidden = false;
    }
    root.dataset.state = 'unsupported';
  };

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
  if (!gl) {
    fail('This lake is drawn with WebGL 2, which this browser did not open.');
    return;
  }
  let renderer: Renderer;
  try {
    renderer = new Renderer(gl);
  } catch (error) {
    fail('The lake could not be drawn here: its shaders failed to build.');
    console.error(error);
    return;
  }

  const sprites = new Layer();
  const glow = new Layer();
  const water = new Water();
  const angler = new Angler();
  const rope = new Rope();
  let cols = new Float32Array(0);

  // ---- view -----------------------------------------------------------------
  let scale = 1;
  let vw = 0;
  let vh = 0;
  let camX = 0;
  let camY = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    canvas.width = w;
    canvas.height = h;
    scale = Math.max(1, Math.round(Math.min(w, h) / 150));
    vw = Math.ceil(w / scale);
    vh = Math.ceil(h / scale);
    sprites.resize(vw + 1, vh + 1);
    glow.resize(vw + 1, vh + 1);
    cols = new Float32Array((vw + 1) * 2);
    renderer.resize(vw + 1, vh + 1);
    const span = BAND_BOTTOM - BAND_TOP;
    camY = vh >= span ? BAND_TOP - Math.floor((vh - span) / 2) : BAND_BOTTOM - vh;
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  // ---- loop -----------------------------------------------------------------
  let time = 0;
  let last = performance.now();
  let acc = 0;
  let lastClock = '';

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP;
      time += STEP;
      water.step(STEP);
      angler.update(STEP);
      const [tx, ty] = angler.straightTip();
      rope.length = 7;
      rope.step(STEP, tx, ty, tx + 1, ty + 7, (x) => water.surfaceAt(x));
    }

    const { hour } = clockHour();
    const sky = skyAt(hour);
    water.night = sky.night;
    const text = clockText(hour);
    if (clock && text !== lastClock) clock.textContent = lastClock = text;

    // Camera: keep the dock in view for now.
    const target = vw >= WORLD_W ? (WORLD_W - vw) / 2 : Math.max(0, Math.min(WORLD_W - vw, 30 - vw * 0.12));
    camX = target;
    const cx = Math.floor(camX);
    const cy = camY;
    sprites.ox = glow.ox = cx;
    sprites.oy = glow.oy = cy;
    sprites.clear();
    glow.clear();

    const state = { time, wind: water.wind, night: sky.night };
    drawBack(sprites, state);
    drawBed(sprites, state);
    drawDock(sprites, glow, state);
    const end = rope.length;
    const [tx, ty] = angler.draw(sprites, rope.x[rope.x.length - 1], rope.y[rope.y.length - 1], 0);
    void tx;
    void ty;
    void end;
    rope.draw(sprites, LINE);
    const bx = rope.x[rope.x.length - 1];
    const by = rope.y[rope.y.length - 1];
    sprites.rect(bx - 1, by - 1, 3, 2, FLOAT_RED);
    sprites.rect(bx - 1, by + 1, 3, 1, FLOAT_WHITE);
    water.draw(sprites, glow);

    for (let i = 0; i <= vw; i++) {
      const wx = cx + i;
      cols[i * 2] = water.surfaceAt(wx);
      cols[i * 2 + 1] = bedAt(Math.max(0, Math.min(WORLD_W, wx)));
    }

    const waterLine = -cy;
    const skyH = Math.max(60, waterLine);
    const sun = sunProgress(hour);
    const moon = moonProgress(hour);
    const arc = (p: number) => Math.sin(Math.PI * p);
    renderer.draw({
      sprite: sprites.data,
      emit: glow.data,
      cols,
      camX: cx,
      camY: cy,
      fracX: camX - cx,
      fracY: 0,
      scale,
      sky,
      time,
      skyH,
      sun: sun === null ? [0, 0, 0, 0] : [vw * (0.1 + 0.8 * sun), waterLine - 6 - arc(sun) * (skyH - 20), 6, 0.001 + (1 - arc(sun)) * 0.999],
      moon:
        moon === null ? [0, 0, 0, 0] : [vw * (0.15 + 0.7 * moon), waterLine - 10 - arc(moon) * (skyH - 26), moonPhase(new Date()), 1],
      glow: 0.6 + 0.6 * sky.night,
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
