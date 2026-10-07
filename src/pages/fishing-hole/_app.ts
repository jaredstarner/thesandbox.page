// The fishing hole: wires the lake, the angler, and the page's controls together.

import { moonPhase, moonProgress, partOfDay, skyAt, sunProgress } from './_daylight';
import { Game } from './_game';
import { Renderer } from './_gl';
import { loadLog, paintSprite, record, renderLog, sizeText, spriteOf } from './_log';
import { Layer } from './_pixels';
import { drawBack, drawBed, drawDock, drawFireflies } from './_scenery';
import { Sound } from './_sound';
import { BOOT_ID } from './_species';
import { WORLD_W, bedAt } from './_world';

const STEP = 1 / 60;
/** The band of the world that should stay in view: hilltops to the deepest bed. */
const BAND_TOP = -50;
const BAND_BOTTOM = 96;

/** The hour to show: the visitor's clock, or ?hour=21.5 to visit another time. */
function clockHour(): number {
  const param = new URLSearchParams(location.search).get('hour');
  if (param !== null && param.trim() !== '' && Number.isFinite(Number(param))) return ((Number(param) % 24) + 24) % 24;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

function clockText(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'} · ${partOfDay(hour)}`;
}

export function startFishing(root: HTMLElement): void {
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const canvas = $<HTMLCanvasElement>('[data-view]');
  const unsupported = $('[data-unsupported]');
  const clock = $('[data-clock]');
  const hint = $('[data-hint]');
  const depthOut = $('[data-depth]');
  const shallower = $<HTMLButtonElement>('[data-shallower]');
  const deeper = $<HTMLButtonElement>('[data-deeper]');
  const card = $('[data-card]');
  const cardFish = $<HTMLCanvasElement>('[data-card-fish]');
  const cardFlag = $('[data-card-flag]');
  const cardName = $('[data-card-name]');
  const cardSize = $('[data-card-size]');
  const cardMetric = $('[data-card-metric]');
  const cardNote = $('[data-card-note]');
  const releaseButton = $<HTMLButtonElement>('[data-release]');
  const soundButton = $<HTMLButtonElement>('[data-sound]');
  const total = $('[data-total]');
  const logList = $('[data-log]');
  const logPanel = $('#fh-log');
  if (!canvas) return;

  const fail = (message: string) => {
    if (unsupported) {
      unsupported.textContent = message;
      unsupported.hidden = false;
    }
    root.dataset.state = 'unsupported';
  };

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
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

  const game = new Game();
  const sound = new Sound();
  game.on((e) => sound.play(e));
  const sprites = new Layer();
  const glow = new Layer();
  let cols = new Float32Array(0);

  // ---- view -----------------------------------------------------------------
  let scale = 1;
  let vw = 0;
  let vh = 0;
  let camX = 0;
  let camY = 0;
  let camReady = false;

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
    // A tall screen gives most of its spare height to the sky.
    camY = vh >= span ? BAND_TOP - Math.floor((vh - span) * 0.7) : BAND_BOTTOM - vh;
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  const cameraTarget = () => {
    if (vw >= WORLD_W) return (WORLD_W - vw) / 2;
    const t = Math.max(game.angler.x - vw * 0.2, game.focusX - vw * 0.7);
    return Math.max(0, Math.min(WORLD_W - vw, t));
  };

  // ---- input ----------------------------------------------------------------
  const popoverOpen = () => root.querySelector(':popover-open') !== null;

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || popoverOpen()) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    sound.unlock();
    game.pressDown();
  });
  const up = () => game.pressUp();
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('lostpointercapture', up);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  const isControl = (el: EventTarget | null) => el instanceof HTMLElement && el.closest('button, a, input, [popover]') !== null;
  window.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      if (isControl(event.target) || popoverOpen()) return;
      event.preventDefault();
      sound.unlock();
      if (!event.repeat) game.pressDown();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (popoverOpen()) return;
      event.preventDefault();
      setDepth(game.depthFt + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    } else if (event.key === 'm' || event.key === 'M') {
      toggleSound();
    } else if ((event.key === 'l' || event.key === 'L') && logPanel) {
      logPanel.togglePopover();
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') game.pressUp();
  });
  window.addEventListener('blur', up);

  let wheelAt = 0;
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const now = performance.now();
      if (now - wheelAt < 120 || Math.abs(event.deltaY) < 1) return;
      wheelAt = now;
      setDepth(game.depthFt + Math.sign(event.deltaY));
    },
    { passive: false },
  );

  const setDepth = (ft: number) => {
    if (!game.canSetDepth) return;
    game.setDepth(ft);
  };
  shallower?.addEventListener('click', () => setDepth(game.depthFt - 1));
  deeper?.addEventListener('click', () => setDepth(game.depthFt + 1));
  releaseButton?.addEventListener('click', () => {
    game.pressDown();
    game.pressUp();
  });
  const showSound = () => soundButton?.setAttribute('aria-pressed', String(sound.enabled));
  const toggleSound = () => {
    sound.setEnabled(!sound.enabled);
    showSound();
  };
  showSound();
  soundButton?.addEventListener('click', toggleSound);
  document.addEventListener('visibilitychange', () => sound.setHidden(document.hidden));

  // A mouse click leaves focus on a button, where Space would press it again.
  for (const b of root.querySelectorAll('button')) {
    b.addEventListener('click', (event) => {
      if (b !== soundButton) sound.unlock();
      if (event.detail > 0) b.blur();
    });
  }

  // ---- the catch card and the log ----------------------------------------------
  const log = loadLog();
  const showLog = () => {
    if (total) total.textContent = String(log.total);
    if (logList) renderLog(logList, log);
  };
  showLog();

  game.on((e) => {
    if (e.type === 'land' && card) {
      const f = e.fish;
      const news = record(log, f);
      showLog();
      if (cardFlag) cardFlag.textContent = news === 'first' ? 'First one!' : news === 'best' ? 'New best!' : '';
      if (cardFish) paintSprite(cardFish, spriteOf(f));
      if (cardName) cardName.textContent = f.sp.name;
      const [imperial, metric] = sizeText(f.cm, f.kg);
      if (cardSize) cardSize.textContent = f.sp.id === BOOT_ID ? 'Size 10 · 1 lb 5 oz' : imperial;
      if (cardMetric) cardMetric.textContent = f.sp.id === BOOT_ID ? '' : metric;
      if (cardNote) cardNote.textContent = f.sp.note;
      card.hidden = false;
    } else if (e.type === 'release' && card) {
      card.hidden = true;
    }
  });

  // ---- loop -----------------------------------------------------------------
  let time = 0;
  let last = performance.now();
  let acc = 0;
  const shown = { clock: '', hint: '', state: '', depth: '', depthOn: true };

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    const hour = clockHour();
    const sky = skyAt(hour);
    game.water.night = sky.night;
    while (acc >= STEP) {
      acc -= STEP;
      time += STEP;
      game.update(STEP, hour);
    }
    sound.update(dt, { night: sky.night, reeling: game.reeling, dragging: game.dragging, flying: game.state === 'flight' });

    // Page text, touched only when it changes.
    const text = clockText(hour);
    if (clock && text !== shown.clock) clock.textContent = shown.clock = text;
    if (hint && game.hint !== shown.hint) hint.textContent = shown.hint = game.hint;
    if (game.uiState !== shown.state) root.dataset.state = shown.state = game.uiState;
    const depth = `${game.depthFt} ft`;
    if (depthOut && depth !== shown.depth) depthOut.textContent = shown.depth = depth;
    if (game.canSetDepth !== shown.depthOn) {
      shown.depthOn = game.canSetDepth;
      if (shallower) shallower.disabled = !shown.depthOn;
      if (deeper) deeper.disabled = !shown.depthOn;
    }
    root.dataset.tension = game.tension.toFixed(2);

    // Camera follows the float or the fish, keeping the dock in view when it can.
    const target = cameraTarget();
    if (!camReady) {
      camX = target;
      camReady = true;
    }
    camX += (target - camX) * Math.min(1, dt * (game.state === 'flight' ? 3.5 : 2));
    const cx = Math.floor(camX);
    const cy = camY;
    sprites.ox = glow.ox = cx;
    sprites.oy = glow.oy = cy;
    sprites.clear();
    glow.clear();

    const scene = { time, wind: game.water.wind, night: sky.night };
    drawBack(sprites, scene);
    drawBed(sprites, scene);
    game.drawFish(sprites);
    drawDock(sprites, glow, scene);
    game.drawRig(sprites, glow, sky.night);
    game.water.draw(sprites, glow);
    drawFireflies(glow, scene);

    for (let i = 0; i <= vw; i++) {
      const wx = cx + i;
      cols[i * 2] = game.water.surfaceAt(wx);
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
