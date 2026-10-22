// The page half of /sea-sparkle/: reports where this window sits on the
// screen, sends input to the tank, and draws the water it sends back.

import { Renderer } from './_gl';
import type { Box, FromTank, ToTank } from './_tank';

/** The tank is 40 mm deep from the glass to the back; see _tank.ts. */
const ML_PER_PX2 = ((25.4 / 96) * (25.4 / 96) * 40) / 1000;
const EMPTY = new Float32Array(0);

type Hint = 'filling' | 'drag' | 'phone' | 'open' | 'pour' | 'empty' | 'none';

export function start(root: HTMLElement) {
  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const canvas = $<HTMLCanvasElement>('[data-water]');
  const hintEl = $<HTMLElement>('[data-hint]');
  const tankEl = $<HTMLElement>('[data-tank]');
  const marksEl = $<HTMLElement>('[data-marks]');
  const openBtn = $<HTMLButtonElement>('[data-open]');
  const fillBtn = $<HTMLButtonElement>('[data-fill]');
  const tiltBtn = $<HTMLButtonElement>('[data-tilt]');
  const params = new URLSearchParams(location.search);

  let renderer: Renderer;
  try {
    if (typeof Worker !== 'function') throw new Error('no workers');
    renderer = new Renderer(canvas);
  } catch {
    $<HTMLElement>('[data-unsupported]').hidden = false;
    return;
  }

  // One tank for every window when shared workers exist; otherwise one per tab.
  const shared = typeof SharedWorker === 'function' && !params.has('solo');
  let port: { postMessage(message: ToTank): void };
  if (shared) {
    const worker = new SharedWorker(new URL('./_tank.ts', import.meta.url), { type: 'module', name: 'sea-sparkle' });
    worker.port.onmessage = (e: MessageEvent<FromTank>) => receive(e.data);
    worker.port.start();
    port = worker.port;
  } else {
    const worker = new Worker(new URL('./_tank.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<FromTank>) => receive(e.data);
    port = worker;
  }
  const send = (message: ToTank) => port.postMessage(message);

  // Where the viewport's top-left corner is on the screen. screenX is the
  // outer window's corner, so guess the frame from the outer and inner sizes,
  // then correct it exactly from the first pointer event that reports both.
  let calX = Math.max(0, (outerWidth - innerWidth) / 2);
  let calY = Math.max(0, outerHeight - innerHeight - calX);
  const fake = { x: 0, y: 0 };
  const box = (): Box => ({ x: screenX + calX + fake.x, y: screenY + calY + fake.y, w: innerWidth, h: innerHeight });
  const calibrate = (e: PointerEvent) => {
    if (fake.x !== 0 || fake.y !== 0) return;
    calX = e.screenX - e.clientX - screenX;
    calY = e.screenY - e.clientY - screenY;
  };

  const coarse = matchMedia('(pointer: coarse)').matches;
  let slot = -1;
  let radius = 3.6;
  let frame: { data: Float32Array; count: number; at: number } = { data: EMPTY, count: 0, at: 0 };
  let others: Box[] = [];
  let volume = 0;
  let total = 0;
  let pouring = true;
  let full = false;
  let stepMs = 0;
  let moved = false;
  let peak = 0;
  let poured = false;
  let tilting = false;
  const start = box();

  function receive(m: FromTank) {
    if (m.type === 'welcome') {
      slot = m.slot;
      radius = m.radius;
      tankEl.textContent = `Tank ${slot + 1}`;
      openBtn.hidden = !m.shared || coarse;
      if (slot > 0) openBtn.textContent = 'Open another tank';
    } else {
      frame = { data: m.data, count: m.count, at: performance.now() };
      others = m.others;
      volume = m.volume;
      total = m.total;
      pouring = m.pouring;
      full = m.full;
      stepMs = m.ms;
    }
  }

  send({ type: 'hello', box: box() });

  // The measuring marks: every 100 mL up the left edge, for a tank this wide.
  let marksFor = { w: 0, h: 0 };
  const drawMarks = () => {
    if (marksFor.w === innerWidth && marksFor.h === innerHeight) return;
    marksFor = { w: innerWidth, h: innerHeight };
    const perPx = innerWidth * ML_PER_PX2;
    const step = [50, 100, 250, 500, 1000].find((ml) => ml / perPx >= 22) ?? 1000;
    const label = step * (step >= 250 ? 2 : 5);
    const parts: string[] = [];
    // Up to just under the label and hint.
    const ceiling = innerHeight - (innerWidth <= 640 ? 190 : 150);
    for (let ml = step; ml / perPx < ceiling; ml += step) {
      const y = ml / perPx;
      const major = ml % label === 0;
      parts.push(`<i class="${major ? 'major' : ''}" style="bottom:${y.toFixed(1)}px"></i>`);
      if (major) parts.push(`<b style="bottom:${y.toFixed(1)}px">${ml >= 1000 ? `${ml / 1000} L` : ml}</b>`);
    }
    marksEl.innerHTML = parts.join('');
  };

  let hint: Hint | null = null;
  const setHint = (next: Hint) => {
    if (next === hint) return;
    hint = next;
    const text: Record<Hint, string> = {
      filling: 'Filling the tank.',
      drag: 'Drag this window around by its title bar. The arrow keys knock the tank, too.',
      phone: 'Tilt your phone, or stir the water with a finger.',
      open: 'Open a second tank, then drag one window over the other to pour across.',
      pour: 'Drag one window over the other to pour across.',
      empty: 'This tank is empty. Drag another tank over it and pour some in.',
      none: '',
    };
    hintEl.textContent = text[next];
  };

  const updateUi = (b: Box) => {
    if (!moved && (Math.abs(b.x - start.x) > 60 || Math.abs(b.y - start.y) > 60)) moved = true;
    peak = Math.max(peak, volume);
    if (volume < peak * 0.8) poured = true;
    if (others.length > 0 && volume < 1) setHint(total > 0 ? 'empty' : 'none');
    else if (others.length > 0 && slot === 0 && !poured) setHint('pour');
    else if (others.length > 0 || slot > 0) setHint('none');
    else if (pouring && total < 1 + volume * 2 && !moved) setHint('filling');
    else if (!moved) setHint(coarse ? 'phone' : 'drag');
    else if (!openBtn.hidden && others.length === 0) setHint('open');
    else setHint('none');
    tankEl.textContent = slot < 0 ? '' : `Tank ${slot + 1} · ${Math.round(volume).toLocaleString('en-US')} mL`;
    fillBtn.disabled = pouring || full;
    drawMarks();
  };

  // The stirring stick follows a pressed pointer, in screen pixels.
  let stirring = false;
  let last = { x: 0, y: 0, t: 0, vx: 0, vy: 0 };
  const stir = (e: PointerEvent, active: boolean) => {
    const b = box();
    const x = b.x + e.clientX;
    const y = b.y + e.clientY;
    const t = e.timeStamp / 1000;
    const dt = Math.max(1 / 240, t - last.t);
    const k = Math.min(1, dt * 30);
    const vx = last.t ? last.vx + ((x - last.x) / dt - last.vx) * k : 0;
    const vy = last.t ? last.vy + ((y - last.y) / dt - last.vy) * k : 0;
    last = { x, y, t, vx, vy };
    send({ type: 'stick', active, x, y, vx: clamp(vx, 3000), vy: clamp(vy, 3000) });
  };
  canvas.addEventListener('pointerdown', (e) => {
    calibrate(e);
    stirring = true;
    last = { x: 0, y: 0, t: 0, vx: 0, vy: 0 };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer can't be captured; stirring still works without it.
    }
    stir(e, true);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') calibrate(e);
    if (stirring) stir(e, true);
  });
  const stop = (e: PointerEvent) => {
    if (!stirring) return;
    stirring = false;
    stir(e, false);
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  const KNOCK = 650;
  addEventListener('keydown', (e) => {
    const dir: Record<string, [number, number]> = {
      ArrowLeft: [-KNOCK, 0],
      ArrowRight: [KNOCK, 0],
      ArrowUp: [0, -KNOCK],
      ArrowDown: [0, KNOCK * 0.5],
    };
    const d = dir[e.key];
    if (!d) return;
    e.preventDefault();
    moved = true;
    send({ type: 'knock', vx: d[0], vy: d[1] });
  });

  fillBtn.addEventListener('click', () => send({ type: 'fill' }));

  openBtn.addEventListener('click', () => {
    const w = Math.round(Math.max(420, outerWidth * 0.6));
    const h = Math.round(Math.max(360, outerHeight * 0.6));
    const sx = (screen as Screen & { availLeft?: number }).availLeft ?? 0;
    let left = screenX + outerWidth + 12;
    if (left + w > sx + screen.availWidth) left = screenX - w - 12;
    if (left < sx) left = screenX + 80;
    const top = Math.max(0, screenY + Math.round((outerHeight - h) / 2));
    window.open(location.href, `sea-sparkle-${Date.now()}`, `popup,width=${w},height=${h},left=${left},top=${top}`);
  });

  // Phones: gravity follows the tilt, and a shake sloshes.
  type Motion = { requestPermission?: () => Promise<PermissionState> };
  const motion = typeof DeviceMotionEvent === 'function' ? (DeviceMotionEvent as unknown as Motion) : null;
  let flip = 1;
  let samples = 0;
  let sumY = 0;
  let pendingGravity: { gx: number; gy: number } | null = null;
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null) return;
    // Gravity in the device's frame (x right, y up), from the reaction the sensor reads.
    const dx = -a.x * flip;
    const dy = -a.y * flip;
    const angle = ((screen.orientation?.angle ?? 0) * Math.PI) / 180;
    const wx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const wy = dx * Math.sin(angle) + dy * Math.cos(angle);
    let gx = wx / 9.81;
    let gy = -wy / 9.81;
    // Some browsers report the opposite sign. Nobody starts holding a phone
    // upside down, so if gravity points up the screen at first, turn it over.
    if (samples < 20) {
      samples++;
      sumY += gy;
      if (samples === 20 && sumY / 20 < -0.4) flip = -flip;
      return;
    }
    const mag = Math.hypot(gx, gy);
    if (mag > 1.6) {
      gx *= 1.6 / mag;
      gy *= 1.6 / mag;
    } else if (mag < 0.2) {
      // Flat on a table: keep a little pull toward whatever was last down.
      const k = 0.2 / Math.max(mag, 1e-3);
      gx = mag < 1e-3 ? 0 : gx * k;
      gy = mag < 1e-3 ? 0.2 : gy * k;
    }
    tilting = true;
    moved = true;
    pendingGravity = { gx, gy };
  };
  if (coarse && motion) {
    if (typeof motion.requestPermission === 'function') {
      tiltBtn.hidden = false;
      tiltBtn.addEventListener('click', async () => {
        try {
          if ((await motion.requestPermission!()) === 'granted') addEventListener('devicemotion', onMotion);
        } catch {
          // Refused or unavailable: the finger still stirs.
        }
        tiltBtn.hidden = true;
      });
    } else {
      addEventListener('devicemotion', onMotion);
    }
  }

  document.addEventListener('visibilitychange', () => send({ type: 'hidden', hidden: document.hidden }));
  addEventListener('pagehide', () => send({ type: 'bye' }));
  addEventListener('pageshow', (e) => {
    if (e.persisted) send({ type: 'hello', box: box() });
  });

  if (params.has('debug')) {
    Object.assign(window, {
      sparkle: {
        /** Slide this window's place on the screen, as a drag would, over ms milliseconds. */
        moveBy(dx: number, dy: number, ms = 300) {
          const from = { ...fake };
          const t0 = performance.now();
          return new Promise<void>((done) => {
            const tick = () => {
              const k = Math.min(1, (performance.now() - t0) / ms);
              const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
              fake.x = from.x + dx * e;
              fake.y = from.y + dy * e;
              if (k < 1) requestAnimationFrame(tick);
              else done();
            };
            tick();
          });
        },
        state: () => ({
          slot,
          count: frame.count,
          volume,
          total,
          pouring,
          full,
          stepMs,
          others: others.length,
          tilting,
          box: box(),
        }),
        light: () => {
          let lit = 0;
          for (let i = 0; i < frame.count; i++) if (frame.data[i * 6 + 4] > 0.2) lit++;
          return lit;
        },
      },
    });
  }

  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const b = box();
    send({ type: 'box', box: b });
    if (pendingGravity) {
      send({ type: 'gravity', ...pendingGravity });
      pendingGravity = null;
    }
    renderer.resize(innerWidth, innerHeight);
    const ahead = frame.at ? Math.min(0.034, (now - frame.at) / 1000) : 0;
    renderer.draw(
      frame.data,
      frame.count,
      ahead,
      { x: b.x, y: b.y, w: b.w, h: b.h, screenW: screen.width, screenH: screen.height },
      others,
      radius,
      radius / 0.3,
      now / 1000,
    );
    updateUi(b);
  };
  requestAnimationFrame(loop);
}

function clamp(v: number, max: number) {
  return Math.max(-max, Math.min(max, v));
}
