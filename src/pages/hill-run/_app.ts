// Hill run: the level rack, the countdown, the run, pause, and the result card.

import { STEP as GRID, sample, type LevelId } from './_course';
import { Painter, INKS, clock } from './_draw';
import { HillSound } from './_sound';
import { Run, type Input, type Sound } from './_sim';

const LEVELS: LevelId[] = ['bomb', 'cheese', 'luge'];
const TITLE: Record<LevelId, string> = { bomb: 'Hill bomb', cheese: 'Cheese roll', luge: 'Luge' };
const WHERE: Record<LevelId, string> = {
  bomb: 'Calloway Street',
  cheese: "Hob's Edge",
  luge: 'The Black Vein',
};
const CHASER: Record<LevelId, string> = { bomb: 'Sweeper', cheese: 'Cheese', luge: 'Four-man bob' };
const LOOSE: Record<LevelId, string> = {
  bomb: 'The sweeper is coming down',
  cheese: 'Second cheese!',
  luge: 'The bob is out of the chute',
};
const CAUGHT: Record<LevelId, string> = { bomb: 'Swept up', cheese: 'Flattened', luge: 'Run down' };
const DONE: Record<LevelId, string> = { bomb: 'At the bottom', cheese: 'Down the hill', luge: 'Through the line' };
const FIXED = 1 / 120;
const SAVE_KEY = 'hill-run:v1';

interface Save {
  unlocked: number;
  best: Partial<Record<LevelId, number>>;
  /** The furthest you've got on a level you haven't finished, and whether it caught you there. */
  far: Partial<Record<LevelId, { m: number; caught: boolean }>>;
}

function load(): Save {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as Save | null;
    if (s && typeof s.unlocked === 'number') return { unlocked: s.unlocked, best: s.best ?? {}, far: s.far ?? {} };
  } catch {
    // Storage can be off; the rack just starts fresh.
  }
  return { unlocked: 1, best: {}, far: {} };
}

function store(s: Save): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    // Nothing to do: the run still counts for this visit.
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function startHillRun(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const canvas = q<HTMLCanvasElement>('[data-hill]');
  const rack = q<HTMLElement>('[data-rack]');
  const hud = q<HTMLElement>('[data-hud]');
  const hudTitle = q<HTMLElement>('[data-hud-title]');
  const clockEl = q<HTMLElement>('[data-clock]');
  const speedEl = q<HTMLElement>('[data-speed]');
  const chaserEl = q<HTMLElement>('[data-chaser]');
  const callEl = q<HTMLElement>('[data-call]');
  const countEl = q<HTMLElement>('[data-count]');
  const bannerEl = q<HTMLElement>('[data-banner]');
  const stripCanvas = q<HTMLCanvasElement>('[data-strip]');
  const card = q<HTMLElement>('[data-card]');
  const pauseEl = q<HTMLElement>('[data-pause]');
  const pauseBtn = q<HTMLButtonElement>('[data-pause-btn]');
  const jumpBtn = q<HTMLButtonElement>('[data-jump-btn]');
  const soundBtn = q<HTMLButtonElement>('[data-sound]');
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');

  const painter = new Painter(canvas);
  const sound = new HillSound();
  const save = load();
  // ?debug opens every level for this visit without saving that.
  const open = () => (debug ? LEVELS.length : save.unlocked);

  let run: Run | null = null;
  let level: LevelId = 'bomb';
  let screen: 'rack' | 'count' | 'play' | 'end' = 'rack';
  let countT = 0;
  let acc = 0;
  let last = performance.now();
  let callTimer = 0;
  let ended = false;
  let paused = false;
  let jumpQueued = false;
  let padJump = false;
  const toldJump = new Set<LevelId>();

  // ------------------------------------------------------------ sizing and fonts

  const readFont = (v: string, fb: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb;
  painter.bill = readFont('--font-hillrun-bill', 'Impact, sans-serif');
  painter.text = readFont('--font-hillrun-text', 'Arial, sans-serif');

  function resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    painter.resize(root.clientWidth, root.clientHeight, dpr);
    const sw = stripCanvas.clientWidth;
    const sh = stripCanvas.clientHeight;
    stripCanvas.width = Math.round(sw * dpr);
    stripCanvas.height = Math.round(sh * dpr);
    if (run) painter.follow(run, 0, true);
  }
  window.addEventListener('resize', resize);
  resize();

  // ------------------------------------------------------------ the level posters

  const arts = new Map<LevelId, Painter>();
  function paintLevels(): void {
    for (const id of LEVELS) {
      const c = root.querySelector<HTMLCanvasElement>(`[data-art="${id}"]`);
      if (!c) continue;
      let p = arts.get(id);
      if (!p) {
        p = new Painter(c);
        p.bill = painter.bill;
        arts.set(id, p);
      }
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (!w || !h) continue;
      p.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
      p.draw(posed(id, p), 4200);
    }
    for (const id of LEVELS) {
      const i = LEVELS.indexOf(id);
      const btn = root.querySelector<HTMLButtonElement>(`[data-pick="${id}"]`)!;
      const best = root.querySelector<HTMLElement>(`[data-best="${id}"]`)!;
      btn.disabled = i >= open();
      const b = save.best[id];
      const far = save.far[id];
      if (i >= open()) best.textContent = `Finish level ${i} to open this one`;
      else if (b) best.textContent = `Best ${clock(b)}`;
      else if (far) best.textContent = `Best ${far.m} m${far.caught ? `, ${CAUGHT[id].toLowerCase()}` : ''}`;
      else best.textContent = 'Not yet run';
    }
  }

  /** A still of each course for its poster: a moment partway down. */
  function posed(id: LevelId, p: Painter): Run {
    const r = new Run(id);
    const rider = r.rider;
    rider.state = 'ride';
    if (id === 'bomb') {
      rider.y = 212;
      rider.x = 1.6;
      rider.v = 15;
      rider.heading = 0.18;
      rider.omega = 0.8;
      r.t = 21;
      r.pursuer.active = true;
      r.pursuer.x = 0.4;
      r.pursuer.y = 199;
    } else if (id === 'cheese') {
      rider.y = 44;
      rider.x = -1;
      rider.v = 7;
      rider.stride = 2;
      r.t = 6;
      r.runners.forEach((n, i) => {
        n.y = 38 + (i % 4) * 2.6;
        n.x = -8 + i * 2.6;
        n.stride = i * 1.7;
        if (i === 2) n.state = 'tumble';
      });
      r.wheel!.y = 56;
      r.wheel!.x = 0.6;
      r.wheel!.z = 0.6;
    } else {
      rider.y = 236;
      rider.v = 27;
      rider.u = 0.4;
      rider.x = sample(r.course.track!.cx, rider.y) + 0.9 / Math.sqrt(1 + sample(r.course.track!.dx, rider.y) ** 2);
      rider.heading = Math.atan(sample(r.course.track!.dx, rider.y));
      r.t = 14.2;
    }
    p.follow(r, 0, true);
    p.cam.s = p.baseScale() * 1.25;
    p.cam.ay = 0.62;
    return r;
  }

  void document.fonts?.load(`40px ${painter.bill}`).then(() => paintLevels());
  paintLevels();
  window.addEventListener('resize', paintLevels);

  // ------------------------------------------------------------ input

  const keys = new Set<string>();
  let pointer: { id: number; x: number; y: number } | null = null;

  function input(): Input {
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    let steer = (right ? 1 : 0) - (left ? 1 : 0);
    let tuck = keys.has('ArrowDown') || keys.has('KeyS');
    let brake = keys.has('ArrowUp') || keys.has('KeyW');
    let aim: number | null = null;
    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > 0.15) steer = Math.max(-1, Math.min(1, steer + ax));
      if (pad.buttons[0]?.pressed || ay > 0.5 || (pad.buttons[7]?.value ?? 0) > 0.3) tuck = true;
      if (pad.buttons[1]?.pressed || ay < -0.5 || (pad.buttons[6]?.value ?? 0) > 0.3) brake = true;
      // X or Y to jump, on the press.
      const j = !!(pad.buttons[2]?.pressed || pad.buttons[3]?.pressed);
      if (j && !padJump) jumpQueued = true;
      padJump = j;
    }
    if (pointer && run) {
      const [rx, ry] = painter.toScreen(run);
      const dx = pointer.x - rx;
      const dy = pointer.y - ry;
      if (run.id === 'luge') {
        aim = Math.max(-1, Math.min(1, dx / (painter.cam.s * 2.2)));
        if (dy < -painter.cam.s * 2) brake = true;
        else if (dy > painter.cam.s * 6) tuck = true;
      } else {
        aim = Math.atan2(dx, dy);
        // A finger far down the hill means go: tuck.
        if (Math.abs(aim) < 0.5 && Math.hypot(dx, dy) > painter.cam.s * 8) tuck = true;
      }
    }
    return { steer, aim, tuck, brake, jump: false };
  }

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    sound.unlock();
    const playKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];
    if (screen !== 'rack' && playKeys.includes(e.code) && !(paused && e.code === 'Space')) e.preventDefault();
    keys.add(e.code);
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (screen === 'play' || screen === 'count') setPaused(!paused);
      else if (screen === 'end' && e.code === 'Escape') showRack();
    } else if (paused) {
      return;
    } else if (e.code === 'KeyR' && run && screen !== 'rack') begin(level);
    else if (e.code === 'KeyM') toggleSound();
    else if (e.code === 'Space' && screen === 'play' && !e.repeat) jumpQueued = true;
    else if ((e.code === 'Enter' || e.code === 'Space') && screen === 'end') {
      const next = nextLevel();
      if (next && runFinished()) begin(next);
      else begin(level);
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    pointer = null;
    if (screen === 'play' || screen === 'count') setPaused(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (screen === 'play' || screen === 'count')) setPaused(true);
    else if (!document.hidden) last = performance.now();
  });

  canvas.addEventListener('pointerdown', (e) => {
    sound.unlock();
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer can't be captured; steering still works.
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointer && e.pointerId === pointer.id) {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    }
  });
  const lift = (e: PointerEvent) => {
    if (pointer && e.pointerId === pointer.id) pointer = null;
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  jumpBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sound.unlock();
    if (screen === 'play' && !paused) jumpQueued = true;
  });

  root.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => {
      sound.unlock();
      begin(b.dataset.pick as LevelId);
    }),
  );
  q<HTMLButtonElement>('[data-again]').addEventListener('click', () => begin(level));
  q<HTMLButtonElement>('[data-back]').addEventListener('click', () => showRack());
  q<HTMLButtonElement>('[data-next]').addEventListener('click', () => {
    const n = nextLevel();
    if (n) begin(n);
  });
  pauseBtn.addEventListener('click', () => {
    sound.unlock();
    setPaused(true);
  });
  q<HTMLButtonElement>('[data-resume]').addEventListener('click', () => setPaused(false));
  q<HTMLButtonElement>('[data-restart]').addEventListener('click', () => {
    recordFar(false);
    begin(level);
  });
  q<HTMLButtonElement>('[data-quit]').addEventListener('click', () => showRack());
  soundBtn.addEventListener('click', () => {
    sound.unlock();
    toggleSound();
  });

  function toggleSound(): void {
    sound.setOn(!sound.on);
    soundBtn.textContent = sound.on ? 'Sound on' : 'Sound off';
    soundBtn.setAttribute('aria-pressed', String(sound.on));
  }

  function setPaused(on: boolean): void {
    if (on === paused) return;
    paused = on;
    keys.clear();
    pointer = null;
    jumpQueued = false;
    sound.hold(on);
    painter.hold = on;
    pauseEl.hidden = !on;
    root.toggleAttribute('data-paused', on);
    if (on) q<HTMLButtonElement>('[data-resume]').focus({ preventScroll: true });
    else {
      last = performance.now();
      canvas.focus?.();
    }
  }

  function nextLevel(): LevelId | null {
    const i = LEVELS.indexOf(level);
    return i < LEVELS.length - 1 && i + 1 < open() ? LEVELS[i + 1] : null;
  }

  function runFinished(): boolean {
    return run?.rider.state === 'finish';
  }

  /** Keep the furthest you've got on a level you haven't finished yet. */
  function recordFar(caught: boolean): void {
    const r = run;
    if (!r || save.best[r.id] || r.rider.state === 'finish') return;
    const m = Math.max(0, Math.round(r.rider.y - r.course.start));
    if (m < 5) return;
    const prev = save.far[r.id];
    if (!prev || m > prev.m) {
      save.far[r.id] = { m, caught };
      store(save);
    }
  }

  // ------------------------------------------------------------ screens

  function showRack(): void {
    if (screen === 'play' || screen === 'count') recordFar(false);
    setPaused(false);
    screen = 'rack';
    run = null;
    sound.stop();
    painter.celebrate(null);
    root.dataset.screen = 'rack';
    rack.hidden = false;
    hud.hidden = true;
    card.hidden = true;
    paintLevels();
    root.querySelector<HTMLButtonElement>(`[data-pick="${level}"]`)?.focus({ preventScroll: true });
  }

  function begin(id: LevelId): void {
    setPaused(false);
    level = id;
    run = new Run(id);
    screen = 'count';
    countT = 0;
    acc = 0;
    ended = false;
    jumpQueued = false;
    root.dataset.screen = 'play';
    root.dataset.level = id;
    rack.hidden = true;
    hud.hidden = false;
    card.hidden = true;
    chaserEl.hidden = true;
    bannerEl.hidden = true;
    root.removeAttribute('data-done');
    callEl.removeAttribute('data-on');
    hudTitle.innerHTML = '';
    hudTitle.append(TITLE[id]);
    const small = document.createElement('small');
    small.textContent = WHERE[id];
    hudTitle.append(small);
    painter.celebrate(null);
    resize();
    sound.start(id);
    canvas.focus?.();
  }

  const COUNT: Record<LevelId, string[]> = {
    bomb: ['3', '2', '1', 'Drop in'],
    cheese: ['One to be ready', 'Two to be steady', 'Three to prepare', 'Four to be off!'],
    luge: ['Red', 'Red', 'Amber', 'Go'],
  };

  function countdown(dt: number): void {
    countT += dt;
    const steps = COUNT[level];
    const beat = level === 'cheese' ? 0.9 : 0.75;
    const i = Math.floor(countT / beat);
    if (i < steps.length - 1) {
      countEl.textContent = steps[i];
      if (countT - dt < i * beat || countT === dt) sound.beep(false);
      return;
    }
    countEl.textContent = steps[steps.length - 1];
    if (screen === 'count') {
      sound.beep(true);
      sound.go();
      screen = 'play';
      run!.start();
      setTimeout(() => {
        if (screen === 'play') countEl.textContent = '';
      }, 700);
      // The first time down each level, say how to jump.
      if (level !== 'luge' && !toldJump.has(level)) {
        toldJump.add(level);
        setTimeout(() => {
          if (screen === 'play' && callTimer <= 0)
            call(matchMedia('(pointer: coarse)').matches ? 'Tap Jump to jump' : 'Space to jump', 1.8);
        }, 1600);
      }
    }
  }

  function call(text: string, hold = 1.6): void {
    callEl.textContent = text;
    callEl.setAttribute('data-on', '');
    callTimer = hold;
  }

  function onEvents(r: Run, evs: Sound[]): void {
    for (const e of evs) {
      sound.event(e, r);
      if (e.type === 'crash') {
        painter.cam.shake = 1;
        call(r.id === 'luge' ? `Off the sled: ${e.what}` : `Slammed: ${e.what}`);
      } else if (e.type === 'trip' && r.id === 'cheese') {
        painter.cam.shake = 0.5;
        call(`Head over heels: ${r.rider.cause}`);
      } else if (e.type === 'release') {
        call(LOOSE[r.id], 2.2);
      } else if (e.type === 'door') {
        call('Door!', 0.9);
      } else if (e.type === 'land' && e.air > 1.2 && r.rider.state === 'ride') {
        call(e.air > 1.7 ? 'Big air' : 'Air', 0.8);
      } else if (e.type === 'finish') {
        celebrate(r);
      } else if (e.type === 'caught') {
        sound.caught();
        recordFar(true);
        root.setAttribute('data-done', '');
      }
    }
  }

  /** Over the line: a printed banner, confetti in the level's inks, the fanfare. */
  function celebrate(r: Run): void {
    sound.finish();
    let title = DONE[r.id];
    if (r.id === 'cheese') title = r.place === 1 ? 'The cheese is yours' : `${ordinal(r.place)} down`;
    bannerEl.textContent = title;
    bannerEl.hidden = false;
    root.setAttribute('data-done', '');
    callEl.removeAttribute('data-on');
    const ink = INKS[r.id];
    painter.celebrate([ink.red, ink.gold, ink.blue, ink.paper, ink.green]);
  }

  function end(r: Run): void {
    ended = true;
    screen = 'end';
    bannerEl.hidden = true;
    const finished = r.rider.state === 'finish';
    const i = LEVELS.indexOf(r.id);
    q<HTMLElement>('[data-card-kicker]').textContent = `Level ${i + 1} · ${TITLE[r.id]}`;
    const stats = q<HTMLElement>('[data-card-stats]');
    stats.innerHTML = '';
    const stat = (k: string, v: string) => {
      const d = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      d.append(dt, dd);
      stats.append(d);
    };
    let note = '';
    const nextBtn = q<HTMLButtonElement>('[data-next]');
    nextBtn.hidden = true;
    if (finished) {
      const prev = save.best[r.id];
      const record = !prev || r.t < prev;
      if (record) save.best[r.id] = r.t;
      delete save.far[r.id];
      const unlocking = i + 1 >= save.unlocked && i + 1 < LEVELS.length;
      save.unlocked = Math.max(save.unlocked, i + 2);
      store(save);
      let title = DONE[r.id];
      if (r.id === 'cheese') title = r.place === 1 ? 'The cheese is yours' : `${ordinal(r.place)} down`;
      q<HTMLElement>('[data-card-title]').textContent = title;
      stat('Time', clock(r.t));
      stat(record && prev ? 'New best' : 'Best', clock(save.best[r.id]!));
      if (r.id === 'cheese') stat('Cheeses dodged', String(r.dodged));
      else stat('Crashes', String(r.rider.crashes));
      if (unlocking) note = `Level ${i + 2} is open: ${TITLE[LEVELS[i + 1]]}.`;
      else if (i === LEVELS.length - 1) note = 'That is every level. Now take the times down.';
      const gap = r.gap;
      if (gap !== null) note = `${note} ${CHASER[r.id]} was ${Math.max(0, Math.round(gap))} m behind you.`.trim();
      if (i + 1 < LEVELS.length) {
        nextBtn.hidden = false;
        nextBtn.textContent = `Next: ${TITLE[LEVELS[i + 1]]}`;
      }
    } else {
      q<HTMLElement>('[data-card-title]').textContent = CAUGHT[r.id];
      const left = Math.max(0, Math.round(r.course.finish - r.rider.y));
      stat('Time', clock(r.t));
      stat('To go', `${left} m`);
      stat('Crashes', String(r.rider.crashes));
      let near = r.course.marks[0]?.label ?? '';
      for (const m of r.course.marks) if (m.y <= r.rider.y) near = m.label;
      const who = r.spec.name.charAt(0).toUpperCase() + r.spec.name.slice(1);
      note = `${who} got you ${left} m from the bottom${near ? `, past ${near}` : ''}.`;
      if (r.rider.crashes > 0) note += ' Every crash lets it close in.';
    }
    q<HTMLElement>('[data-card-note]').textContent = note;
    card.hidden = false;
    q<HTMLButtonElement>('[data-again]').focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ HUD

  function hudUpdate(r: Run, dt: number): void {
    clockEl.textContent = clock(r.t);
    speedEl.textContent = String(Math.round(r.rider.v * 3.6));
    const gap = r.gap;
    if (gap !== null && r.rider.state !== 'finish') {
      chaserEl.hidden = false;
      const g = Math.max(0, Math.round(gap));
      chaserEl.textContent = gap < -2 ? `${CHASER[r.id]} went by` : `${CHASER[r.id]} · ${g} m back`;
      chaserEl.toggleAttribute('data-close', gap < 28 && gap > -2);
    } else chaserEl.hidden = true;
    if (callTimer > 0) {
      callTimer -= dt;
      if (callTimer <= 0) callEl.removeAttribute('data-on');
    }
    if (r.rider.state === 'finish') return;
    if (r.id === 'luge') {
      // Call the next curve as you come up on it.
      for (const m of r.course.marks) {
        const d = m.y - r.rider.y;
        if (d > 0 && d < 70 && callTimer <= 0 && m.dir) {
          call(`${m.label} ${m.dir > 0 ? '→' : '←'}`, 1.2);
          break;
        }
      }
    }
    if (r.id === 'bomb' && r.rider.wobble > 0.45 && r.rider.state === 'ride' && callTimer <= 0)
      call('Speed wobbles: tuck or brake', 0.8);
    if (r.id === 'cheese' && r.rider.footing > 0.6 && r.rider.state === 'ride' && callTimer <= 0)
      call('Losing your feet: cut across', 0.8);
  }

  const profiles = new Map<LevelId, Float32Array>();
  function elevation(r: Run): Float32Array {
    let e = profiles.get(r.id);
    if (e) return e;
    const g = r.course.grade;
    e = new Float32Array(g.length);
    for (let i = 1; i < g.length; i++) e[i] = e[i - 1] + g[i] * GRID;
    profiles.set(r.id, e);
    return e;
  }

  function strip(r: Run): void {
    const c = stripCanvas;
    const g = c.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.width / dpr;
    const h = c.height / dpr;
    const ink = INKS[r.id];
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const e = elevation(r);
    const y0 = r.course.start;
    const y1 = r.course.finish;
    const e0 = sample(e, y0);
    const e1 = sample(e, y1);
    const pad = 10;
    const X = (y: number) => pad + ((y - y0) / (y1 - y0)) * (w - pad * 2);
    const Y = (y: number) => 8 + ((sample(e, y) - e0) / (e1 - e0)) * (h - 18);
    g.beginPath();
    g.moveTo(X(y0), h);
    for (let y = y0; y <= y1; y += (y1 - y0) / 160) g.lineTo(X(y), Y(y));
    g.lineTo(X(y1), h);
    g.closePath();
    g.fillStyle = r.id === 'luge' ? '#a9d4e6' : ink.ground;
    g.fill();
    g.strokeStyle = ink.key;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let y = y0; y <= y1; y += (y1 - y0) / 160) {
      if (y === y0) g.moveTo(X(y), Y(y));
      else g.lineTo(X(y), Y(y));
    }
    g.stroke();
    g.font = `600 10px ${painter.text}`;
    g.fillStyle = ink.key;
    g.textAlign = 'left';
    let lastX = -999;
    for (const m of r.course.marks) {
      if (m.y < y0 || m.y > y1 + 1) continue;
      const x = X(Math.min(y1, m.y));
      g.fillRect(x, Y(m.y) - 5, 1, 5);
      if (x - lastX > 64 && x < w - 40) {
        g.fillText(m.label.toUpperCase(), x + 3, Math.min(h - 3, Y(m.y) + 12));
        lastX = x;
      }
    }
    // The pursuer and you.
    if (r.pursuer.active) {
      const py = Math.max(y0, Math.min(y1, r.pursuer.y));
      g.fillStyle = ink.key;
      g.beginPath();
      g.arc(X(py), Y(py), 5, 0, Math.PI * 2);
      g.fill();
    }
    const ry = Math.max(y0, Math.min(y1, r.rider.y));
    g.fillStyle = ink.red;
    g.strokeStyle = ink.paper;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(X(ry), Y(ry), 6, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  // ------------------------------------------------------------ loop

  let stripTick = 0;
  function frame(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (run && screen !== 'rack') {
      const r = run;
      if (!paused) {
        if (screen === 'count') countdown(dt);
        if (screen === 'play' || screen === 'end') {
          acc += dt;
          const inp: Input =
            screen === 'end' ? { steer: 0, aim: null, tuck: false, brake: false, jump: false } : input();
          let guard = 0;
          while (acc >= FIXED && guard++ < 24) {
            inp.jump = jumpQueued;
            r.step(FIXED, inp);
            jumpQueued = false;
            acc -= FIXED;
          }
          if (guard >= 24) acc = 0;
          if (r.events.length) {
            onEvents(r, r.events);
            r.events.length = 0;
          }
          if (!ended && (r.rider.state === 'caught' || r.rider.state === 'finish')) {
            // Long enough at the bottom for the banner, the confetti, and the fanfare.
            const delay = r.rider.state === 'finish' ? 2300 : 1200;
            ended = true;
            setTimeout(() => {
              if (run === r) end(r);
            }, delay);
          }
        }
        sound.update(r, dt);
        painter.follow(r, dt);
        hudUpdate(r, dt);
      }
      painter.draw(r, now);
      if (stripTick++ % 3 === 0) strip(r);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const jump = params.get('level') as LevelId | null;
  if (jump && LEVELS.includes(jump) && LEVELS.indexOf(jump) < open()) begin(jump);
  else showRack();

  if (debug) {
    (window as unknown as { hillrun: unknown }).hillrun = {
      get run() {
        return run;
      },
      painter,
      sound,
      begin,
      showRack,
      setPaused,
      jump: () => {
        jumpQueued = true;
      },
      get screen() {
        return screen;
      },
      get paused() {
        return paused;
      },
    };
  }
}
