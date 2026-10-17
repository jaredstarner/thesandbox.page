// Pin tumbler: input, the frame loop, and the page's controls around the canvas.

import { drawScene, layout, paintBench, toWorld, useFace, type Insets, type Layout } from './_draw';
import { LOCKS, Lock, T_JAM, TIP_LOW, type LockEvent, type LockSpec } from './_lock';
import { LockSound } from './_sound';

const STORE = 'pintumbler:best';
/** Vertical drag is geared down, so a finger's travel buys fine control of the tip. */
const LIFT_GEAR = 0.5;

const loadBest = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
};
const saveBest = (best: Record<string, number>) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(best));
  } catch {
    // Storage may be refused; times just won't be kept.
  }
};

export const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
};

const buzz = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not every browser lets a page vibrate.
  }
};

export function startPinTumbler(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-bench]');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel);
  const $$ = <T extends Element>(sel: string) => Array.from(root.querySelectorAll<T>(sel));
  const dek = $<HTMLElement>('[data-dek]');
  const tensionIn = $<HTMLInputElement>('[data-tension]');
  const timerEl = $<HTMLElement>('[data-timer]');
  const countEl = $<HTMLElement>('[data-count]');
  const msgEl = $<HTMLElement>('[data-msg]');
  const card = $<HTMLElement>('[data-card]');
  const cardTime = $<HTMLElement>('[data-card-time]');
  const cardBest = $<HTMLElement>('[data-card-best]');
  const nextBtn = $<HTMLButtonElement>('[data-next]');
  const againBtn = $<HTMLButtonElement>('[data-again]');
  const repinBtn = $<HTMLButtonElement>('[data-repin]');
  const labelsBtn = $<HTMLButtonElement>('[data-labels]');
  const peekBtn = $<HTMLButtonElement>('[data-peek]');
  const soundBtn = $<HTMLButtonElement>('[data-sound]');
  const lockBtns = $$<HTMLButtonElement>('[data-lock]');

  const debug = new URLSearchParams(location.search).has('debug');
  const sound = new LockSound();
  const best = loadBest();

  const face = getComputedStyle(document.documentElement).getPropertyValue('--font-pintumbler').trim();
  useFace(face);

  let spec: LockSpec = LOCKS[0];
  let lock = new Lock(spec, (Math.random() * 2 ** 31) | 0);
  let L: Layout;
  let bench: HTMLCanvasElement;
  let tension = 0;
  let tx = lock.px;
  let ty = TIP_LOW;
  let labels = true;
  let peeked = false;
  let started: number | null = null;
  let elapsed = 0;
  let msgUntil = 0;
  let lastMsg = '';
  let coachedJam = false;

  const insets = (): Insets => {
    const wide = window.innerWidth >= 820;
    if (wide) return { top: 104, right: 150, bottom: 96, left: 24 };
    return { top: 132, right: 0, bottom: 176, left: 0 };
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    L = layout(w, h, dpr, lock, insets());
    bench = paintBench(L, lock);
  };

  const say = (text: string, hold = 4.5) => {
    if (!msgEl) return;
    if (text !== lastMsg) msgEl.textContent = text;
    lastMsg = text;
    msgUntil = performance.now() + hold * 1000;
  };

  const teaching = () => !spec.blind;

  const showCount = () => {
    if (!countEl) return;
    countEl.textContent = spec.blind && !peeked ? `${spec.pins} pins` : `${lock.setCount} of ${spec.pins} set`;
  };

  const select = (next: LockSpec, seed = (Math.random() * 2 ** 31) | 0) => {
    spec = next;
    lock = new Lock(spec, seed);
    tx = lock.px;
    ty = TIP_LOW;
    started = null;
    elapsed = 0;
    peeked = false;
    coachedJam = false;
    labels = spec.coach;
    labelsBtn?.setAttribute('aria-pressed', String(labels));
    if (peekBtn) {
      peekBtn.hidden = !spec.blind;
      peekBtn.setAttribute('aria-pressed', 'false');
    }
    if (labelsBtn) labelsBtn.hidden = spec.blind;
    if (card) card.hidden = true;
    root.dataset.lock = spec.id;
    for (const b of lockBtns) b.setAttribute('aria-current', String(b.dataset.lock === spec.id));
    if (dek) dek.textContent = `${spec.name}: ${spec.blurb.toLowerCase()}`;
    lastMsg = '';
    if (msgEl) msgEl.textContent = '';
    if (spec.id === 'practice') say('Pull the wrench to about a third, then press below a pin and push up.', 9);
    else if (spec.blind) say('No window this time. Listen for the clicks and watch the plug’s face turn.', 7);
    resize();
    showCount();
    refreshBest();
  };

  const refreshBest = () => {
    for (const b of lockBtns) {
      const t = best[b.dataset.lock ?? ''];
      const el = b.querySelector<HTMLElement>('[data-best]');
      if (el) el.textContent = t ? formatTime(t) : '';
      b.classList.toggle('opened', !!t);
    }
  };

  const setTension = (v: number) => {
    tension = Math.max(0, Math.min(1, v));
    if (tensionIn && Number(tensionIn.value) !== Math.round(tension * 100))
      tensionIn.value = String(Math.round(tension * 100));
    root.style.setProperty('--tension', String(tension));
    if (tension > 0 && started === null && !lock.opened) started = performance.now();
  };

  const handle = (ev: LockEvent) => {
    switch (ev.type) {
      case 'set':
        sound.set();
        buzz(12);
        if (spec.coach)
          say(`Click. Pin ${ev.pin + 1} is set, and the plug turned a hair. Find the next one that binds.`);
        break;
      case 'groove':
        sound.groove();
        buzz(5);
        if (teaching() && !spec.coach)
          say('A small click, but the pin is still stiff: a serrated driver. Keep lifting.', 4);
        break;
      case 'caught':
        sound.caught();
        buzz(28);
        if (teaching())
          say(
            'False set: the plug swung further than a pin should turn it. A spool has caught. Lighten the wrench and lift the pin that pushes back.',
            7,
          );
        break;
      case 'overset':
        sound.overset();
        buzz([8, 30, 8]);
        if (teaching())
          say('Overset. That key pin went past the shear line and wedged. Let the wrench go to drop every pin.', 7);
        break;
      case 'reset':
        sound.reset(ev.pins);
        buzz(6);
        if (teaching()) say('The wrench let go and every pin dropped.', 3);
        break;
      case 'touch':
        sound.touch();
        break;
      case 'jam':
        sound.jam();
        if (teaching() && (!coachedJam || spec.coach)) {
          coachedJam = true;
          say(
            lock.binding?.state === 'caught'
              ? 'The spool won’t pass with the wrench this heavy. Ease off until it pushes back, then lift.'
              : 'Too much tension: the binding pin won’t budge. Ease the wrench off.',
            4,
          );
        }
        break;
      case 'open':
        sound.open();
        buzz([20, 60, 40]);
        finish();
        break;
    }
  };

  const finish = () => {
    if (started !== null) elapsed = (performance.now() - started) / 1000;
    started = null;
    const counts = !peeked;
    const prior = best[spec.id];
    const record = counts && (!prior || elapsed < prior);
    if (record) {
      best[spec.id] = elapsed;
      saveBest(best);
      refreshBest();
    }
    if (msgEl) msgEl.textContent = '';
    lastMsg = '';
    window.setTimeout(() => {
      if (!card || !cardTime || !cardBest) return;
      cardTime.textContent = formatTime(elapsed);
      cardBest.textContent = !counts
        ? 'You looked inside, so this one isn’t timed'
        : record
          ? prior
            ? `A new best, beating ${formatTime(prior)}`
            : 'Your first time through this lock'
          : `Your best is ${formatTime(best[spec.id] ?? elapsed)}`;
      const i = LOCKS.indexOf(spec);
      if (nextBtn) nextBtn.hidden = i === LOCKS.length - 1;
      card.hidden = false;
    }, 700);
  };

  // --- Pointer: press below a pin and push up. Across moves the pick in and out; up lifts.
  let drag: { id: number; y0: number; ty0: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    sound.unlock();
    if (lock.opened || drag) return;
    canvas.setPointerCapture(e.pointerId);
    const w = toWorld(L, e.clientX, e.clientY);
    tx = w.x;
    drag = { id: e.pointerId, y0: e.clientY, ty0: ty };
    if (started === null) started = performance.now();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const w = toWorld(L, e.clientX, e.clientY);
    tx = w.x;
    ty = drag.ty0 + ((drag.y0 - e.clientY) / L.s) * LIFT_GEAR;
  });
  const release = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    ty = TIP_LOW;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setTension(tension - Math.sign(e.deltaY) * 0.03);
    },
    { passive: false },
  );

  // --- Keyboard: arrows move and lift the pick, brackets or digits set the wrench.
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'range' && e.key.startsWith('Arrow')) return;
    if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
    sound.unlock();
    const fine = e.shiftKey ? 0.02 : 0.07;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const xs = lock.pins.map((p) => p.x - lock.slip);
      const cur = lock.px;
      const next = dir > 0 ? xs.find((x) => x > cur + 0.3) : [...xs].reverse().find((x) => x < cur - 0.3);
      if (next !== undefined) {
        tx = next;
        ty = TIP_LOW;
      }
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      ty = Math.max(ty, lock.py) + fine;
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      ty = Math.max(TIP_LOW, Math.min(ty, lock.py + 0.01) - fine * 3);
      e.preventDefault();
    } else if (e.key === ']') setTension(tension + 0.04);
    else if (e.key === '[') setTension(tension - 0.04);
    else if (/^[0-9]$/.test(e.key)) setTension(Number(e.key) / 10);
    else return;
    if (started === null && !lock.opened) started = performance.now();
  });

  tensionIn?.addEventListener('input', () => {
    sound.unlock();
    setTension(Number(tensionIn.value) / 100);
  });
  tensionIn?.addEventListener('pointerdown', () => sound.unlock());

  for (const b of lockBtns) {
    b.addEventListener('click', () => {
      const next = LOCKS.find((s) => s.id === b.dataset.lock);
      if (next) {
        setTension(0);
        select(next);
      }
    });
  }
  repinBtn?.addEventListener('click', () => {
    setTension(0);
    select(spec);
    say('Re-pinned: new key pin lengths, a new binding order.', 3);
  });
  againBtn?.addEventListener('click', () => {
    setTension(0);
    select(spec);
  });
  nextBtn?.addEventListener('click', () => {
    setTension(0);
    const i = LOCKS.indexOf(spec);
    select(LOCKS[Math.min(LOCKS.length - 1, i + 1)]);
  });
  labelsBtn?.addEventListener('click', () => {
    labels = !labels;
    labelsBtn.setAttribute('aria-pressed', String(labels));
  });
  peekBtn?.addEventListener('click', () => {
    const on = peekBtn.getAttribute('aria-pressed') !== 'true';
    peekBtn.setAttribute('aria-pressed', String(on));
    if (on) peeked = true;
    showCount();
  });
  soundBtn?.addEventListener('click', () => {
    sound.unlock();
    const on = soundBtn.getAttribute('aria-pressed') !== 'true';
    soundBtn.setAttribute('aria-pressed', String(on));
    sound.setMuted(!on);
  });

  window.addEventListener('resize', resize);
  select(spec);
  setTension(0);

  if (debug) {
    (window as unknown as Record<string, unknown>).pintumbler = {
      get lock() {
        return lock;
      },
      tip(x: number, y: number) {
        tx = x;
        ty = y;
      },
      tension: setTension,
      select: (id: string, seed?: number) => {
        const s = LOCKS.find((l) => l.id === id);
        if (s) select(s, seed);
      },
      sound,
      labels(on: boolean) {
        labels = on;
      },
      peek(on: boolean) {
        peekBtn?.setAttribute('aria-pressed', String(on));
      },
    };
  }

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const events = lock.step(dt, { tx, ty, tension });
    for (const e of events) handle(e);
    if (events.some((e) => e.type === 'set' || e.type === 'reset' || e.type === 'caught')) showCount();
    sound.feel(lock.feel.contact, lock.feel.speed, tension, dt);
    if (started !== null && timerEl) timerEl.textContent = formatTime((now - started) / 1000);
    else if (timerEl && lock.opened) timerEl.textContent = formatTime(elapsed);
    else if (timerEl) timerEl.textContent = '0:00.0';

    if (msgEl && lastMsg && now > msgUntil) {
      msgEl.textContent = '';
      lastMsg = '';
    }
    // Tension past the point where a binding pin can move gets a warning tint on the wrench control.
    root.classList.toggle('heavy', tension > T_JAM);

    const xray = !spec.blind || peekBtn?.getAttribute('aria-pressed') === 'true';
    drawScene(ctx, L, lock, bench, { xray, labels: labels && xray, coach: spec.coach, time: now / 1000 });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
