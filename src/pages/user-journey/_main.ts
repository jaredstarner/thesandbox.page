import { USER, makeUser, ride, resolve, step, type Box, type Event, type Solid, type World } from './_engine';
import { makeSound } from './_sound';

const MIN_W = 360;
const MAX_W = 1120;
const STEP_DT = 1 / 120;
const RESPAWN_AFTER = 1.1;

interface Spec {
  el: Element;
  clip: Element | null;
  section: number;
  goal: boolean;
}

export function start(root: HTMLElement) {
  const q = <T extends Element>(sel: string) => {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`user-journey: missing ${sel}`);
    return el;
  };
  const stage = q<HTMLElement>('[data-stage]');
  const frame = q<HTMLElement>('[data-frame]');
  const site = q<HTMLElement>('[data-site]');
  const walkerEl = q<HTMLElement>('[data-walker]');
  const bubble = q<HTMLButtonElement>('[data-bubble]');
  const bubbleText = q<HTMLElement>('[data-bubble-text]');
  const goBtn = q<HTMLButtonElement>('[data-go]');
  const widthIn = q<HTMLInputElement>('[data-width]');
  const widthOut = q<HTMLOutputElement>('[data-width-out]');
  const fallsEl = q<HTMLElement>('[data-falls]');
  const soundBtn = q<HTMLButtonElement>('[data-sound]');
  const stepsEl = q<HTMLElement>('[data-steps]');
  const pricing = q<HTMLElement>('[data-pricing]');
  const billing = q<HTMLInputElement>('[data-billing]');
  const track = q<HTMLElement>('[data-track]');
  const nameIn = q<HTMLInputElement>('[data-name]');
  const finale = q<HTMLElement>('[data-finale]');
  const params = new URLSearchParams(location.search);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || params.has('instant');
  const sound = makeSound();

  if (params.has('instant')) root.classList.add('instant');

  // ---- Page width and the scale that fits it on screen ----

  let W = 1040;
  let scale = 1;
  const widthsTried = new Set<number>();

  function available() {
    const cs = getComputedStyle(stage);
    const handles = matchMedia('(width < 640px)').matches ? 0 : 44;
    return stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - handles;
  }

  function fit() {
    scale = Math.min(1, available() / W);
    site.style.transform = scale < 1 ? `scale(${scale})` : '';
    frame.style.width = `${W * scale}px`;
    frame.style.height = `${site.offsetHeight * scale}px`;
  }

  function setWidth(w: number) {
    W = Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));
    site.style.width = `${W}px`;
    widthIn.value = String(W);
    widthOut.value = String(W);
    widthsTried.add(W);
    fit();
  }

  const avail0 = available();
  // Open wide enough that the hero's two buttons are apart; on a phone, no wider than that, so it stays legible.
  setWidth(avail0 >= 600 ? Math.min(1040, avail0) : 540);
  widthsTried.clear();
  // Fitting changes the frame's size, so refit on the next frame rather than inside the observer.
  const refit = new ResizeObserver(() => requestAnimationFrame(fit));
  refit.observe(site);
  refit.observe(stage);
  widthIn.addEventListener('input', () => setWidth(Number(widthIn.value)));

  for (const handle of root.querySelectorAll<HTMLElement>('[data-handle]')) {
    const side = Number(handle.dataset.handle);
    handle.addEventListener('pointerdown', (e) => {
      const x0 = e.clientX;
      const w0 = W;
      const s0 = scale;
      handle.dataset.drag = '';
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // A synthetic pointer can't be captured; dragging still works while it stays over the handle.
      }
      const move = (ev: PointerEvent) => setWidth(w0 + (side * 2 * (ev.clientX - x0)) / s0);
      const up = () => {
        delete handle.dataset.drag;
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
      e.preventDefault();
    });
  }

  // ---- The page's own controls ----

  billing.addEventListener('change', () => {
    pricing.dataset.billing = billing.checked ? 'yearly' : 'monthly';
  });

  const cardStep = () => {
    const card = track.querySelector<HTMLElement>('.card');
    return card ? card.offsetWidth + parseFloat(getComputedStyle(track).columnGap || '0') : 300;
  };
  q<HTMLButtonElement>('[data-prev]').addEventListener('click', () =>
    track.scrollBy({ left: -cardStep(), behavior: reduced ? 'auto' : 'smooth' }),
  );
  q<HTMLButtonElement>('[data-next]').addEventListener('click', () =>
    track.scrollBy({ left: cardStep(), behavior: reduced ? 'auto' : 'smooth' }),
  );

  // The name field grows with its text. Browsers without field-sizing get the same from a measurement.
  const sizesItself = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');
  const measureCtx = document.createElement('canvas').getContext('2d');
  function sizeName() {
    if (sizesItself || !measureCtx) return;
    const cs = getComputedStyle(nameIn);
    measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = nameIn.value || nameIn.placeholder;
    const pad =
      parseFloat(cs.paddingLeft) +
      parseFloat(cs.paddingRight) +
      parseFloat(cs.borderLeftWidth) +
      parseFloat(cs.borderRightWidth);
    const spacing = parseFloat(cs.letterSpacing) || 0;
    nameIn.style.width = `${Math.ceil(measureCtx.measureText(text).width + spacing * text.length + pad + 2)}px`;
  }
  nameIn.addEventListener('input', sizeName);
  sizeName();
  void document.fonts?.ready.then(sizeName);

  // ---- The world, measured ----

  const specs: Spec[] = [...site.querySelectorAll('[data-solid]')].map((el) => ({
    el,
    clip: el.parentElement?.closest('[data-clip]') ?? null,
    section: Number(el.closest('[data-section]')?.getAttribute('data-section') ?? 0),
    goal: el.hasAttribute('data-goal'),
  }));

  function toSite(r: DOMRect, sr: DOMRect): Box {
    const k = 1 / scale;
    return {
      l: (r.left - sr.left) * k,
      t: (r.top - sr.top) * k,
      r: (r.right - sr.left) * k,
      b: (r.bottom - sr.top) * k,
    };
  }

  function measure(): World {
    const sr = site.getBoundingClientRect();
    const clips = new Map<Element, Box>();
    const solids: Solid[] = [];
    for (const sp of specs) {
      const r = sp.el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const raw = toSite(r, sr);
      let box: Box = raw;
      if (sp.clip) {
        let c = clips.get(sp.clip);
        if (!c) {
          c = toSite(sp.clip.getBoundingClientRect(), sr);
          clips.set(sp.clip, c);
        }
        box = {
          l: Math.max(raw.l, c.l),
          t: Math.max(raw.t, c.t),
          r: Math.min(raw.r, c.r),
          b: Math.min(raw.b, c.b),
        };
        if (box.r - box.l < 1 || box.b - box.t < 1) continue;
      }
      solids.push({ ...box, el: sp.el, raw, section: sp.section, goal: sp.goal });
    }
    return { solids, width: W, height: site.offsetHeight };
  }

  // ---- The user ----

  const u = makeUser();
  let splatTimer = 0;
  let falls = 0;
  let startedAt = 0;
  let spawnedAt = 0;
  let everWent = false;
  let finished = false;

  function spawn(section: number) {
    const anchor = site.querySelector(`[data-section="${section}"] [data-spawn]`);
    if (!anchor) return;
    const box = toSite(anchor.getBoundingClientRect(), site.getBoundingClientRect());
    const left = anchor.getAttribute('data-spawn') === 'left';
    u.x = left ? box.l + 24 : box.r - 24;
    u.y = box.t;
    u.dir = left ? 1 : -1;
    u.vy = 0;
    u.mode = 'stand';
    u.go = false;
    u.paused = false;
    u.ground = null;
    u.groundRaw = null;
    u.section = section;
    spawnedAt = performance.now();
    walkerEl.dataset.spawn = '';
    setTimeout(() => delete walkerEl.dataset.spawn, 500);
    updateSteps();
  }

  function updateSteps() {
    for (const li of stepsEl.querySelectorAll<HTMLElement>('[data-step]')) {
      const n = Number(li.dataset.step);
      li.dataset.state = finished || n < u.section ? 'done' : n === u.section ? 'now' : '';
    }
  }

  function setFalls(n: number) {
    falls = n;
    fallsEl.textContent = `${n} ${n === 1 ? 'fall' : 'falls'}`;
  }

  function running() {
    return u.go && !u.paused && u.mode !== 'splat' && u.mode !== 'done';
  }

  function toggleGo() {
    if (u.mode === 'done') return;
    sound.wake();
    if (running()) {
      u.paused = true;
    } else {
      u.go = true;
      u.paused = false;
      sound.go();
      if (!startedAt) startedAt = performance.now();
      everWent = true;
    }
    render();
  }

  goBtn.addEventListener('click', toggleGo);
  bubble.addEventListener('click', toggleGo);
  root.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, button, summary, select, a, [contenteditable]')) return;
    e.preventDefault();
    toggleGo();
  });

  soundBtn.addEventListener('click', () => {
    const on = soundBtn.getAttribute('aria-pressed') !== 'true';
    soundBtn.setAttribute('aria-pressed', String(on));
    sound.setOn(on);
    if (on) sound.wake();
  });

  // Any interaction with the page counts as a gesture that may start audio.
  root.addEventListener('pointerdown', () => sound.wake(), { passive: true });

  // ---- Effects ----

  function dust(x: number, y: number, n: number, colour: string) {
    for (let i = 0; i < n; i++) {
      const d = document.createElement('span');
      const size = 3 + Math.random() * 4;
      Object.assign(d.style, {
        position: 'absolute',
        left: `${x - size / 2}px`,
        top: `${y - size / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        background: colour,
        pointerEvents: 'none',
        zIndex: '4',
      });
      site.append(d);
      const a = (Math.PI * (i + 0.5)) / n;
      const dist = 10 + Math.random() * 14;
      d.animate(
        [
          { transform: 'translate(0, 0)', opacity: 0.9 },
          { transform: `translate(${-Math.cos(a) * dist}px, ${-Math.sin(a) * dist * 0.6}px)`, opacity: 0 },
        ],
        { duration: 520 + Math.random() * 200, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
      ).onfinish = () => d.remove();
    }
  }

  function oof(x: number, y: number) {
    const t = document.createElement('span');
    t.textContent = 'Oof.';
    Object.assign(t.style, {
      position: 'absolute',
      left: `${x}px`,
      top: `${y - 34}px`,
      translate: '-50% 0',
      color: '#e8431f',
      font: '800 13px var(--font-uj-sans)',
      letterSpacing: '-0.02em',
      pointerEvents: 'none',
      zIndex: '6',
    });
    site.append(t);
    t.animate(
      [
        { transform: 'translateY(6px)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1, offset: 0.2 },
        { transform: 'translateY(-14px)', opacity: 0 },
      ],
      { duration: 1000, easing: 'ease-out' },
    ).onfinish = () => t.remove();
  }

  function confetti(x: number, y: number) {
    const colours = ['#ff5b3a', '#d9f46a', '#5b49e0', '#17161d', '#ece7ff'];
    for (let i = 0; i < 70; i++) {
      const c = document.createElement('span');
      const w = 5 + Math.random() * 5;
      Object.assign(c.style, {
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${w}px`,
        height: `${w * 0.45}px`,
        background: colours[i % colours.length],
        pointerEvents: 'none',
        zIndex: '7',
      });
      site.append(c);
      const vx = (Math.random() * 2 - 0.4) * 260;
      const vy = -(220 + Math.random() * 280);
      const spin = (Math.random() * 2 - 1) * 900;
      const frames: Keyframe[] = [];
      for (let k = 0; k <= 10; k++) {
        const t = (k / 10) * 1.6;
        frames.push({
          transform: `translate(${vx * t}px, ${vy * t + 420 * t * t}px) rotate(${spin * t}deg)`,
          opacity: k < 7 ? 1 : 1 - (k - 7) / 3,
        });
      }
      c.animate(frames, { duration: 1600, easing: 'linear' }).onfinish = () => c.remove();
    }
  }

  // ---- Camera: keep the user on screen without fighting the visitor's own scrolling ----

  let userScrolledAt = -1e9;
  for (const type of ['wheel', 'touchmove'] as const) {
    addEventListener(type, () => (userScrolledAt = performance.now()), { passive: true });
  }
  addEventListener('keydown', (e) => {
    if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      userScrolledAt = performance.now();
    }
  });

  function userScreenY() {
    return frame.getBoundingClientRect().top + (u.y - USER.h / 2) * scale;
  }

  function lookAtUser(force = false) {
    const now = performance.now();
    if (!force && now - userScrolledAt < 2500) return;
    const y = userScreenY();
    const top = 56 + innerHeight * 0.18;
    const bottom = innerHeight * 0.8;
    if (!force && y > top && y < bottom) return;
    scrollTo({ top: scrollY + y - innerHeight * 0.42, behavior: reduced ? 'auto' : 'smooth' });
  }

  // ---- Events from the simulation ----

  function handle(events: Event[]) {
    for (const ev of events) {
      if (ev.type === 'land') {
        sound.land(ev.height);
        if (ev.height > 40) dust(u.x, u.y, 4, '#c9c3b5');
      } else if (ev.type === 'enter') {
        u.go = false;
        sound.chime();
        updateSteps();
        lookAtUser(true);
      } else if (ev.type === 'splat') {
        setFalls(falls + 1);
        sound.splat();
        const y = Math.min(u.y, site.offsetHeight - 4);
        dust(u.x, y, 7, '#9aa0ab');
        oof(u.x, y);
        fallsEl.dataset.flash = '';
        setTimeout(() => delete fallsEl.dataset.flash, 120);
        splatTimer = RESPAWN_AFTER;
      } else if (ev.type === 'goal') {
        finish();
      }
    }
  }

  function finish() {
    finished = true;
    updateSteps();
    sound.goal();
    confetti(u.x, u.y - 10);
    const secs = Math.round((performance.now() - (startedAt || performance.now())) / 1000);
    const name = nameIn.value.trim();
    q<HTMLElement>('[data-finale-title]').textContent = name ? `Welcome aboard, ${name}.` : 'Welcome aboard.';
    q<HTMLElement>('[data-stat-time]').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    q<HTMLElement>('[data-stat-falls]').textContent = String(falls);
    q<HTMLElement>('[data-stat-widths]').textContent = String(widthsTried.size);
    setTimeout(() => {
      finale.hidden = false;
      q<HTMLButtonElement>('[data-again]').focus();
    }, 1500);
  }

  q<HTMLButtonElement>('[data-again]').addEventListener('click', () => {
    finale.hidden = true;
    finished = false;
    for (const d of root.querySelectorAll<HTMLDetailsElement>('details[open]')) d.open = false;
    billing.checked = false;
    pricing.dataset.billing = 'monthly';
    track.scrollTo({ left: 0 });
    nameIn.value = '';
    sizeName();
    setFalls(0);
    widthsTried.clear();
    startedAt = 0;
    scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    requestAnimationFrame(() => spawn(1));
  });

  // ---- Drawing ----

  function render() {
    walkerEl.style.transform = `translate(${u.x - USER.w / 2}px, ${u.y - USER.h}px) scale(${u.dir}, 1)`;
    walkerEl.dataset.mode =
      u.mode === 'fall'
        ? 'falling'
        : u.mode === 'splat'
          ? 'splat'
          : u.mode === 'done'
            ? 'done'
            : running()
              ? 'walking'
              : 'standing';
    const showBubble = u.mode === 'stand' && !running() && performance.now() - spawnedAt > 350;
    bubble.hidden = !showBubble;
    if (showBubble) {
      bubbleText.textContent = u.paused ? 'Paused' : everWent ? 'Go' : 'Press Go';
      bubble.style.left = `${u.x * scale}px`;
      bubble.style.top = `${(u.y - USER.h - 8) * scale}px`;
    }
    const label = running() ? 'Pause' : 'Go';
    if (goBtn.textContent !== label) goBtn.textContent = label;
    goBtn.dataset.mode = running() ? 'pause' : 'go';
  }

  // ---- The loop ----

  let acc = 0;
  function tick(dt: number) {
    const world = measure();
    if (u.mode !== 'splat' && u.mode !== 'done') {
      ride(u, world);
      if (!resolve(u, world)) {
        u.mode = 'splat';
        handle([{ type: 'splat', reason: 'squash', height: 0 }]);
      }
    }
    const events: Event[] = [];
    acc += dt;
    while (acc >= STEP_DT) {
      step(u, world, STEP_DT, events);
      acc -= STEP_DT;
    }
    handle(events);
    if (u.mode === 'splat') {
      splatTimer -= dt;
      if (splatTimer <= 0) spawn(u.section);
    }
    render();
    if (running() || u.mode === 'fall') lookAtUser();
  }

  let last = performance.now();
  function loop(now: number) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    tick(dt);
    requestAnimationFrame(loop);
  }

  // Wait a frame so fonts and layout have settled before placing the user.
  requestAnimationFrame(() => {
    spawn(1);
    render();
    requestAnimationFrame(loop);
  });
  void document.fonts?.ready.then(() => {
    if (!everWent && u.section === 1) spawn(1);
  });

  if (params.has('debug')) {
    Object.assign(window, {
      __uj: {
        user: u,
        setWidth,
        measure,
        spawn,
        go: toggleGo,
        /** Run the simulation synchronously for a number of seconds at 60 frames a second. */
        sim(seconds: number) {
          const n = Math.round(seconds * 60);
          for (let i = 0; i < n; i++) tick(1 / 60);
          return { x: u.x, y: u.y, mode: u.mode, section: u.section, go: u.go, falls };
        },
        state: () => ({ x: u.x, y: u.y, mode: u.mode, section: u.section, go: u.go, dir: u.dir, falls, W, scale }),
      },
    });
  }
}
