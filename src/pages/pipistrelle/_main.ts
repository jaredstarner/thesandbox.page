// /pipistrelle/: a July night at the edge of a village, flown by ear.

import { buildWorld, WORLD_H, WORLD_W, cellIndex, type World } from './_world';
import { castCall, wrap, type Echo, type Target } from './_sonar';
import { Bat, type Phase } from './_bat';
import { Swarm, SPECIES, ORDER, type Insect, type Species } from './_insects';
import { Sound, STRETCH } from './_sound';
import { Renderer } from './_render';
import { Sonogram } from './_sono';

/** Wall-clock seconds from dusk to first light. */
const NIGHT_SECONDS = 360;
const DUSK = 21 * 60 + 40;
const DAWN = 4 * 60 + 45 + 24 * 60;
const HOME_CALL = 0.86;

type State = 'intro' | 'night' | 'end';

interface Hints {
  wall: boolean;
  leaves: boolean;
  dive: boolean;
  clicks: boolean;
  spat: boolean;
  lamp: boolean;
  pond: boolean;
  first: boolean;
  home: boolean;
}

const PHASE_LABEL: Record<Phase, string> = {
  roost: 'at the roost',
  search: 'searching',
  approach: 'closing in',
  buzz: 'feeding buzz',
  pause: 'feeding buzz',
};

function clockText(minutes: number): string {
  const m = Math.floor(minutes) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function start(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-night]');
  const sonoCanvas = root.querySelector<HTMLCanvasElement>('[data-sono]');
  if (!canvas || !sonoCanvas) return;
  const el = {
    clock: root.querySelector<HTMLElement>('[data-clock]')!,
    phase: root.querySelector<HTMLElement>('[data-phase]')!,
    tally: root.querySelector<HTMLElement>('[data-tally]')!,
    bumps: root.querySelector<HTMLElement>('[data-bumps]')!,
    readout: root.querySelector<HTMLElement>('[data-readout]')!,
    toast: root.querySelector<HTMLElement>('[data-toast]')!,
    intro: root.querySelector<HTMLElement>('[data-intro]')!,
    end: root.querySelector<HTMLElement>('[data-end]')!,
    endTitle: root.querySelector<HTMLElement>('[data-end-title]')!,
    endLine: root.querySelector<HTMLElement>('[data-end-line]')!,
    endSheet: root.querySelector<HTMLElement>('[data-end-sheet]')!,
    start: root.querySelector<HTMLButtonElement>('[data-start]')!,
    again: root.querySelector<HTMLButtonElement>('[data-again]')!,
    buzz: root.querySelector<HTMLButtonElement>('[data-buzz]')!,
  };

  const world: World = buildWorld();
  const bat = new Bat(world);
  const swarm = new Swarm(world, (Date.now() & 0xffff) ^ 0x51ed);
  const sound = new Sound();
  const view = new Renderer(canvas, world);
  const sono = new Sonogram(sonoCanvas);

  let state: State = 'intro';
  let night = 0;
  let batTime = 0;
  let wallTime = 0;
  let last = performance.now();
  let lastHour = Math.floor(DUSK / 60);
  let nextOwl = 40 + Math.random() * 30;
  let nextPopulate = 0;
  let nextCricket = 0;
  let nextTrail = 0;
  let calls = 0;
  let buzzes = 0;
  let endT = 0;
  let homeAt = '';
  let lock: Insect | null = null;
  let toastTimer = 0;
  const caught: Record<Species, number> = { midge: 0, caddis: 0, crane: 0, underwing: 0, tiger: 0 };
  const catches: { x: number; y: number }[] = [];
  const trail: { x: number; y: number }[] = [];
  const hints: Hints = {
    wall: false,
    leaves: false,
    dive: false,
    clicks: false,
    spat: false,
    lamp: false,
    pond: false,
    first: false,
    home: false,
  };
  const echoes: Echo[] = [];
  const targets: Target[] = [];

  // Pointer state.
  let pointer: { x: number; y: number; type: string } | null = null;
  let touchHold: { x: number; y: number } | null = null;
  let mouseDown = false;
  let spaceDown = false;
  let buzzDown = false;
  const keys = { left: false, right: false };

  // The first-light painting, made off the main thread.
  try {
    const worker = new Worker(new URL('./_dawn-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (
      ev: MessageEvent<{ kind: 'lamp' | 'day'; width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> }>,
    ) => {
      const { kind, width, height, data } = ev.data;
      const img = new ImageData(data, width, height);
      if (kind === 'lamp') view.setLamp(img);
      else {
        view.setDay(img);
        worker.terminate();
      }
    };
  } catch {
    // No painting at dawn; the night still works.
  }

  function toast(text: string, seconds = 4.5): void {
    el.toast.textContent = text;
    el.toast.classList.add('show');
    toastTimer = seconds;
  }

  function renderTally(fresh: Species | null = null): void {
    const rows: string[] = [];
    for (const sp of ORDER) {
      const n = caught[sp];
      if (!n) continue;
      const name = sp === 'tiger' ? 'Garden tigers, spat out' : SPECIES[sp].name;
      rows.push(`<li${sp === fresh ? ' class="fresh"' : ''}><span>${name}</span><b>${n}</b></li>`);
    }
    if (!rows.length) rows.push('<li><span>nothing yet</span></li>');
    el.tally.innerHTML = rows.join('');
    if (bat.bumps) {
      el.bumps.hidden = false;
      el.bumps.textContent = bat.bumps === 1 ? 'One collision' : `${bat.bumps} collisions`;
    } else {
      el.bumps.hidden = true;
    }
  }

  function resize(): void {
    view.resize();
    sono.resize();
    view.setCamera(view.camX, view.camY, state === 'end' ? endZoom() : view.flightZoom());
  }

  /** At the end, the map fits beside the card on a wide screen, or under it on a narrow one. */
  function endFrame(): { zoom: number; cx: number; cy: number } {
    const d = view.dpr;
    const wide = view.width / d > 1000;
    const left = wide ? 440 * d : 0;
    const top = 70 * d;
    const bottom = (wide ? 130 : 96) * d;
    const zoom = Math.min((view.width - left - 24 * d) / WORLD_W, (view.height - top - bottom) / WORLD_H);
    const cx = WORLD_W / 2 - (left - 24 * d) / 2 / zoom;
    const cy = WORLD_H / 2 - (top - bottom) / 2 / zoom;
    return { zoom, cx, cy };
  }

  function endZoom(): number {
    return endFrame().zoom;
  }

  function beginNight(): void {
    state = 'night';
    root.dataset.state = 'night';
    el.intro.hidden = true;
    el.end.hidden = true;
    night = 0;
    batTime = 0;
    wallTime = 0;
    lastHour = Math.floor(DUSK / 60);
    calls = 0;
    buzzes = 0;
    lock = null;
    for (const k of ORDER) caught[k] = 0;
    catches.length = 0;
    trail.length = 0;
    bat.reset();
    bat.leaveRoost();
    swarm.insects.length = 0;
    swarm.populate(0, bat.x, bat.y, true);
    view.clearMemory();
    view.setCamera(bat.x, bat.y, view.flightZoom());
    hints.home = false;
    renderTally();
    sound.fade(0.75, 1.5);
    void sound.start(world.crickets).then((ok) => {
      el.readout.textContent = ok ? 'detector on' : 'no sound in this browser';
    });
    canvas?.focus({ preventScroll: true });
  }

  function endNight(late: boolean): void {
    homeAt = clockText(DUSK + night * (DAWN - DUSK));
    state = 'end';
    root.dataset.state = 'end';
    endT = 0;
    bat.wantsAttack = false;
    const total = ORDER.reduce((s, k) => s + (k === 'tiger' ? 0 : caught[k]), 0);
    el.endTitle.textContent = late ? 'Caught out by first light' : 'Home before first light';
    el.endLine.textContent = late
      ? `The sky was already pale when you gave up the hunt at ${homeAt}, with ${total} insect${total === 1 ? '' : 's'} inside you. This is the ground you flew over in the dark, as it looks by day, with what you heard of it laid over the top.`
      : `In under the eaves at ${homeAt}, with ${total} insect${total === 1 ? '' : 's'} inside you. This is the ground you flew over in the dark, as it looks by day, with what you heard of it laid over the top.`;
    const rows: string[] = [];
    for (const sp of ORDER) {
      if (!caught[sp]) continue;
      const name = sp === 'tiger' ? 'Garden tigers, spat out' : SPECIES[sp].name;
      rows.push(`<dt>${name}</dt><dd>${caught[sp]}</dd>`);
    }
    rows.push(`<dt>Calls made</dt><dd>${calls.toLocaleString('en-US')}</dd>`);
    rows.push(`<dt>Feeding buzzes</dt><dd>${buzzes}</dd>`);
    rows.push(`<dt>Collisions</dt><dd>${bat.bumps}</dd>`);
    el.endSheet.innerHTML = rows.join('');
    el.phase.textContent = late ? 'caught out' : 'at the roost';
    window.setTimeout(() => {
      if (state === 'end') el.end.hidden = false;
    }, 3200);
    sound.fade(0, 4);
    el.toast.classList.remove('show');
  }

  function doCall(now: number): void {
    const call = bat.callDue(batTime);
    if (!call) return;
    calls++;
    targets.length = 0;
    for (const i of swarm.insects) {
      if (!swarm.catchable(i)) continue;
      if (Math.abs(i.x - bat.x) > call.shape.range || Math.abs(i.y - bat.y) > call.shape.range) continue;
      targets.push({ id: i.id, x: i.x, y: i.y, size: SPECIES[i.sp].size, glint: swarm.glint(i, batTime) });
    }
    castCall(world, bat.x, bat.y, bat.heading, call.shape, targets, (calls * 7919) & 0xffff, echoes);
    const strong = call.attacking ? 0.6 : 1;
    view.addCall(echoes, bat.x, bat.y, bat.heading, call.shape.beam, call.shape.range, call.shape.rays, now, strong);
    if (state === 'night') {
      sound.call(echoes, bat.heading, call.duration, call.f0, call.f1, call.shape.range, call.attacking ? 0.1 : 0.16);
      const clicking = swarm.hear(bat.x, bat.y, bat.heading, call.loud, call.attacking, batTime);
      for (const t of clicking) {
        const rel = wrap(Math.atan2(t.y - bat.y, t.x - bat.x) - bat.heading);
        sound.clicks(Math.sin(rel), 0.5);
        view.flashes.push({ x: t.x, y: t.y, t0: now, kind: 'click' });
        if (!hints.clicks) {
          hints.clicks = true;
          toast('Clicking: a garden tiger warning you off. Let go of the buzz, or find out why.');
        }
      }
    }
  }

  function update(now: number, dt: number): void {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) el.toast.classList.remove('show');
    }

    if (state === 'intro') {
      // Hanging under the eaves, calling now and then into the yard.
      batTime += dt / STRETCH;
      bat.heading = world.roostHeading + Math.sin(now * 0.4) * 0.5;
      doCall(now);
      view.setCamera(world.roost.x, world.roost.y - 1.5, view.flightZoom());
      return;
    }

    if (state === 'end') {
      endT += dt;
      const z0 = view.flightZoom();
      const z1 = endZoom();
      const u = Math.min(1, endT / 3.5);
      const e = u * u * (3 - 2 * u);
      const zoom = z0 + (z1 - z0) * e;
      const f = endFrame();
      view.setCamera(bat.x + (f.cx - bat.x) * e, bat.y + (f.cy - bat.y) * e, zoom);
      return;
    }

    wallTime += dt;
    night = Math.min(1, wallTime / NIGHT_SECONDS);
    const dtBat = dt / STRETCH;
    batTime += dtBat;

    // Steering from the pointer, the keys, or a finger.
    if (keys.left || keys.right) {
      bat.target = null;
      bat.turnInput = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    } else if (pointer) {
      bat.target = { x: view.wx(pointer.x), y: view.wy(pointer.y) };
      bat.turnInput = 0;
    } else if (touchHold) {
      bat.target = touchHold;
      bat.turnInput = 0;
    } else {
      bat.turnInput = 0;
    }
    bat.wantsAttack = mouseDown || spaceDown || buzzDown;

    if (bat.phase === 'approach' && bat.phaseT < 0.02 && !lock) {
      lock = swarm.lock(bat.x, bat.y, bat.heading, 5.5);
    }
    if (lock && !swarm.insects.includes(lock)) lock = null;
    if (lock && !swarm.catchable(lock)) {
      if (lock.mode === 'dive' && !hints.dive && SPECIES[lock.sp].ears) {
        hints.dive = true;
        toast('It heard you coming and dropped into the grass. Underwings have ears.');
      }
      lock = null;
    }
    if (bat.phase === 'search') lock = null;

    const res = bat.update(dtBat, lock && (bat.phase === 'approach' || bat.phase === 'buzz') ? lock : null);
    if (res.bumped) {
      sound.bump(res.bumped !== 'leaves');
      view.flashes.push({ x: bat.x, y: bat.y, t0: now, kind: 'bump' });
      if (res.bumped === 'wall' && !hints.wall) {
        hints.wall = true;
        toast('The barn wall. Smooth walls send a call away like a mirror, so they only show when you face them square.', 6.5);
      } else if (res.bumped === 'leaves' && !hints.leaves) {
        hints.leaves = true;
        toast('Into the leaves. Fly along the edges, where the echoes are clean.');
      }
      lock = null;
      renderTally();
    }
    if (res.buzzEnded) {
      buzzes++;
      const got = swarm.reach(bat.x, bat.y, bat.heading, 0.8);
      if (got) {
        swarm.remove(got);
        caught[got.sp]++;
        catches.push({ x: got.x, y: got.y });
        const mx = bat.x + Math.cos(bat.heading) * 0.3;
        const my = bat.y + Math.sin(bat.heading) * 0.3;
        if (SPECIES[got.sp].foul) {
          view.flashes.push({ x: mx, y: my, t0: now, kind: 'spit' });
          sound.bump(false);
          if (!hints.spat) {
            hints.spat = true;
            toast('Spat out. Garden tigers taste foul, and the clicks were saying so.');
          }
        } else {
          view.flashes.push({ x: mx, y: my, t0: now, kind: 'catch' });
          sound.munch(got.sp === 'underwing' || got.sp === 'crane');
          if (!hints.first) {
            hints.first = true;
            toast(got.sp === 'midge' ? 'A midge. Small, but there are thousands.' : `Caught: ${SPECIES[got.sp].name.toLowerCase().replace(/s$/, '')}.`);
          } else if (got.sp === 'underwing') {
            toast('A large yellow underwing: the biggest meal out here.', 3);
          }
        }
        renderTally(got.sp);
      }
      lock = null;
    }

    let n = 0;
    while (n++ < 6 && batTime >= bat.nextCall) doCall(now);

    swarm.update(dtBat);
    if (wallTime > nextPopulate) {
      nextPopulate = wallTime + 0.5;
      swarm.populate(night, bat.x, bat.y);
    }
    if (wallTime > nextCricket) {
      nextCricket = wallTime + 0.12;
      // The crickets fall quiet in the small hours as it cools.
      if (night < 0.55 || night > 0.92) sound.tickCrickets(bat.x, bat.y, bat.heading);
    }
    if (wallTime > nextOwl) {
      nextOwl = wallTime + 45 + Math.random() * 55;
      const owlX = 70 + Math.random() * 30;
      const rel = wrap(Math.atan2(3 - bat.y, owlX - bat.x) - bat.heading);
      sound.owl(Math.sin(rel) * 0.7);
    }
    if (wallTime > nextTrail) {
      nextTrail = wallTime + 0.2;
      trail.push({ x: bat.x, y: bat.y });
    }

    // The church clock.
    const minutes = DUSK + night * (DAWN - DUSK);
    const hour = Math.floor(minutes / 60);
    if (hour > lastHour) {
      lastHour = hour;
      const h12 = hour % 12 || 12;
      sound.strike(h12);
    }
    el.clock.textContent = clockText(minutes);

    // Places worth a word, the first time.
    if (!hints.lamp && Math.hypot(bat.x - world.lamp.x, bat.y - world.lamp.y) < world.lamp.r * 0.8) {
      hints.lamp = true;
      toast('Moths circling the lamp are dazzled, and slow to dodge.');
    }
    const ci = cellIndex(bat.x, bat.y);
    if (!hints.pond && ci >= 0 && world.water[ci]) {
      hints.pond = true;
      toast('Over the pond the echoes stop: water sends every call away, so anything flying over it stands out.', 6);
    }
    if (night >= HOME_CALL && !hints.home) {
      hints.home = true;
      toast('The sky is paling. Head home to the barn eaves before first light.', 6);
    }
    if (night >= HOME_CALL && Math.hypot(bat.x - world.roost.x, bat.y - world.roost.y) < 1.6) {
      endNight(false);
      return;
    }
    if (night >= 1) {
      endNight(true);
      return;
    }

    el.phase.textContent = bat.stunned > 0 ? 'bumped' : PHASE_LABEL[bat.phase];
    const rate = bat.phase === 'search' ? 10 : bat.phase === 'approach' ? Math.round(1 / Math.max(0.012, 0.045 - (bat.phaseT / 0.28) * 0.033)) : bat.phase === 'buzz' ? 180 : 0;
    if (sound.enabled) {
      el.readout.textContent = rate
        ? `${rate} calls a second · played ten times lower, two and a half times slower`
        : 'played ten times lower, two and a half times slower';
    }

    // Camera: a little ahead of the bat.
    const lead = 2.2;
    const tx = bat.x + Math.cos(bat.heading) * lead;
    const ty = bat.y + Math.sin(bat.heading) * lead;
    const k = Math.min(1, dt * 2.4);
    view.setCamera(view.camX + (tx - view.camX) * k, view.camY + (ty - view.camY) * k, view.flightZoom());
  }

  function frame(t: number): void {
    const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
    last = t;
    const now = t / 1000;
    update(now, dt);
    const dawn = state === 'end' ? Math.min(1, 0.25 + endT / 3) : Math.max(0, (night - 0.9) / 0.1) * 0.55;
    view.draw(now, dt, bat, swarm.insects, dawn, {
      memoryAlpha: state === 'end' ? 0.85 : 0.26,
      showBat: state !== 'end' || endT < 1.5,
      trail: state === 'end' && endT > 1.2 ? trail : null,
      catches: state === 'end' ? catches : null,
      homeArrow: state === 'night' && night >= HOME_CALL,
    });
    sono.draw(dt, sound.enabled ? sound.analyser : null, sound.ctx?.sampleRate ?? 48000);
    raf = requestAnimationFrame(frame);
  }

  // Input.
  canvas.tabIndex = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      pointer = { x: e.offsetX * view.dpr, y: e.offsetY * view.dpr, type: e.pointerType };
    } else if (touchHold && state === 'night') {
      touchHold = { x: view.wx(e.offsetX * view.dpr), y: view.wy(e.offsetY * view.dpr) };
    }
  });
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') {
      // Keep circling where the pointer left.
      if (pointer) touchHold = { x: view.wx(pointer.x), y: view.wy(pointer.y) };
      pointer = null;
    }
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'night') return;
    if (e.pointerType === 'mouse') {
      if (e.button === 0) mouseDown = true;
      pointer = { x: e.offsetX * view.dpr, y: e.offsetY * view.dpr, type: 'mouse' };
    } else {
      touchHold = { x: view.wx(e.offsetX * view.dpr), y: view.wy(e.offsetY * view.dpr) };
      pointer = null;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured.
    }
  });
  const up = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') mouseDown = false;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  el.buzz.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    buzzDown = true;
    el.buzz.setAttribute('aria-pressed', 'true');
    try {
      el.buzz.setPointerCapture(e.pointerId);
    } catch {
      // As above.
    }
  });
  const buzzUp = () => {
    buzzDown = false;
    el.buzz.setAttribute('aria-pressed', 'false');
  };
  el.buzz.addEventListener('pointerup', buzzUp);
  el.buzz.addEventListener('pointercancel', buzzUp);
  el.buzz.addEventListener('lostpointercapture', buzzUp);

  window.addEventListener('keydown', (e) => {
    if (state === 'intro' && (e.key === 'Enter' || e.key === ' ') && document.activeElement !== el.start) {
      e.preventDefault();
      beginNight();
      return;
    }
    if (state !== 'night') return;
    if (e.key === ' ') {
      e.preventDefault();
      spaceDown = true;
    } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      keys.left = true;
      e.preventDefault();
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      keys.right = true;
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') spaceDown = false;
    else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
    if (!keys.left && !keys.right && !pointer) {
      // Keys released: hold the course ahead.
      touchHold = { x: bat.x + Math.cos(bat.heading) * 6, y: bat.y + Math.sin(bat.heading) * 6 };
    }
  });
  window.addEventListener('blur', () => {
    mouseDown = false;
    spaceDown = false;
    buzzDown = false;
    keys.left = false;
    keys.right = false;
  });

  el.start.addEventListener('click', beginNight);
  el.again.addEventListener('click', beginNight);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      void sound.pause();
    } else {
      last = performance.now();
      if (state === 'night') void sound.resume();
      raf = requestAnimationFrame(frame);
    }
  });

  window.addEventListener('resize', resize);
  resize();
  renderTally();
  let raf = requestAnimationFrame(frame);

  // A handle for checking the page from outside: ?debug only.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { pip: unknown }).pip = {
      world,
      bat,
      swarm,
      sound,
      view,
      begin: beginNight,
      end: endNight,
      setNight(f: number) {
        wallTime = f * NIGHT_SECONDS;
      },
      get state() {
        return state;
      },
      get caught() {
        return caught;
      },
      get echoes() {
        return echoes;
      },
      press(on: boolean) {
        spaceDown = on;
      },
      aim(x: number, y: number) {
        touchHold = { x, y };
        pointer = null;
      },
    };
  }
}
