// Wires the machine to the page: layout, keyboard, touch, and gamepad input, the frame loop, and sound.

import type { Fonts } from './_art';
import { Game, type GameEvent } from './_game';
import { GlassView } from './_glass';
import { Sound } from './_sound';
import { DIVIDER_X, H, W } from './_table';
import { FieldView } from './_view';

const BEST_KEY = 'ringbell-best';

function readFonts(root: HTMLElement): Fonts {
  const css = getComputedStyle(root);
  const display = css.getPropertyValue('--font-ringbell').trim() || 'Georgia, serif';
  const text = css.getPropertyValue('--font-ringbell-text').trim() || '"Arial Narrow", Arial, sans-serif';
  return { display, text };
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(n: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(n));
  } catch {
    // Storage can be unavailable; the best score is only a nicety.
  }
}

type Action = 'L' | 'R' | 'plunger';

export function startMachine(root: HTMLElement): void {
  const fieldCanvas = root.querySelector<HTMLCanvasElement>('[data-playfield]');
  const glassCanvas = root.querySelector<HTMLCanvasElement>('[data-backglass]');
  const head = root.querySelector<HTMLElement>('.head');
  const home = root.querySelector<HTMLElement>('.home');
  if (!fieldCanvas || !glassCanvas || !head) return;
  const live = root.querySelector<HTMLElement>('[data-live]');
  const bestEl = root.querySelector<HTMLElement>('[data-best]');
  const soundBtn = root.querySelector<HTMLButtonElement>('[data-sound]');

  let fonts = readFonts(root);
  const sound = new Sound();
  const field = new FieldView(fieldCanvas, fonts);
  const glass = new GlassView(glassCanvas, fonts);
  field.touch = matchMedia('(pointer: coarse)').matches;
  field.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let best = loadBest();
  const showBest = () => {
    if (!bestEl) return;
    bestEl.hidden = best <= 0;
    bestEl.textContent = `Your best on this machine: ${best.toLocaleString('en-US')}`;
  };
  showBest();

  const say = (text: string) => {
    if (live) live.textContent = text;
  };

  const onEvent = (e: GameEvent) => {
    sound.play(e);
    if (e.type === 'serve') say(`Ball ${game.ballNumber}`);
    if (e.type === 'knocker') say('Free game');
    if (e.type === 'tilt') say('Tilt');
    if (e.type === 'gameOver') {
      say(`Game over. ${game.score.toLocaleString('en-US')} points`);
      if (game.score > best) {
        best = game.score;
        saveBest(best);
        showBest();
      }
    }
  };
  const game = new Game(onEvent);

  // ---- Layout ---------------------------------------------------------------

  const narrowQuery = matchMedia('(max-width: 1080px), (orientation: portrait)');
  const layout = () => {
    const narrow = narrowQuery.matches;
    const vh = window.innerHeight;
    if (narrow) {
      const avail = Math.min(560, root.clientWidth - 16);
      const stripW = Math.max(240, avail);
      glass.resize(stripW, 'strip');
      const stripH = (stripW * 250) / 1000;
      const homeH = home ? home.offsetHeight + 6 : 0;
      const fieldH = vh - stripH - homeH - 10 - 12 - 16;
      const width = Math.max(240, Math.min(avail - 12, (fieldH * W) / H));
      field.resize(Math.floor(width));
    } else {
      const fieldH = vh - 12 - 22 - 20 - 20;
      const width = Math.max(300, Math.floor((fieldH * W) / H));
      field.resize(width);
      glass.resize(Math.min(460, Math.max(240, head.clientWidth)), 'full');
    }
  };
  layout();
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(layout, 80);
  });

  if (document.fonts) {
    void Promise.all([
      document.fonts.load(`400 24px ${fonts.display}`),
      document.fonts.load(`600 24px ${fonts.text}`),
      document.fonts.load(`700 24px ${fonts.text}`),
    ])
      .catch(() => undefined)
      .then(() => {
        fonts = readFonts(root);
        field.setFonts(fonts);
        glass.setFonts(fonts);
      });
  }

  // ---- Input ----------------------------------------------------------------

  const wake = () => sound.wake();
  for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, wake, { capture: true });

  const press = (a: Action, down: boolean) => {
    if (a === 'plunger') game.pull(down);
    else game.flip(a, down);
  };

  const startOrPull = (down: boolean) => {
    if (down && game.phase === 'over') {
      game.start();
      return;
    }
    game.pull(down);
  };

  const keyAction: Record<string, Action> = {
    KeyZ: 'L',
    ShiftLeft: 'L',
    ArrowLeft: 'L',
    Slash: 'R',
    ShiftRight: 'R',
    ArrowRight: 'R',
  };

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const a = keyAction[e.code];
    if (a) {
      e.preventDefault();
      if (!e.repeat) press(a, true);
      return;
    }
    switch (e.code) {
      case 'Space':
      case 'Enter':
      case 'ArrowDown':
      case 'NumpadEnter':
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
        e.preventDefault();
        if (!e.repeat) startOrPull(true);
        break;
      case 'KeyX':
        if (!e.repeat) game.nudge('L');
        break;
      case 'Period':
        if (!e.repeat) game.nudge('R');
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!e.repeat) game.nudge('U');
        break;
      case 'Digit5':
      case 'KeyC':
        if (!e.repeat) game.coin();
        break;
      case 'Digit1':
      case 'KeyS':
        if (!e.repeat) game.start();
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    const a = keyAction[e.code];
    if (a) {
      press(a, false);
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowDown' || e.code === 'NumpadEnter') {
      game.pull(false);
    }
  });

  window.addEventListener('blur', () => {
    game.flip('L', false);
    game.flip('R', false);
    game.pull(false);
  });

  const pointers = new Map<number, Action>();
  fieldCanvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sound.wake();
    if (game.phase === 'over') {
      game.start();
      return;
    }
    const rect = fieldCanvas.getBoundingClientRect();
    const p = field.toField(e.clientX - rect.left, e.clientY - rect.top);
    let a: Action;
    if (p.x > DIVIDER_X - 6 && p.y > 820) a = 'plunger';
    else a = p.x < W / 2 - 21 ? 'L' : 'R';
    pointers.set(e.pointerId, a);
    try {
      fieldCanvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; the release still arrives on the canvas.
    }
    press(a, true);
  });
  const release = (e: PointerEvent) => {
    const a = pointers.get(e.pointerId);
    if (!a) return;
    pointers.delete(e.pointerId);
    if (![...pointers.values()].includes(a)) press(a, false);
  };
  fieldCanvas.addEventListener('pointerup', release);
  fieldCanvas.addEventListener('pointercancel', release);
  fieldCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  root.querySelector('[data-coin]')?.addEventListener('click', () => game.coin());
  root.querySelector('[data-start]')?.addEventListener('click', () => game.start());
  root.querySelector('[data-nudge]')?.addEventListener('click', () => game.nudge('U'));
  soundBtn?.addEventListener('click', () => {
    const on = soundBtn.getAttribute('aria-pressed') !== 'true';
    soundBtn.setAttribute('aria-pressed', String(on));
    sound.setEnabled(on);
  });

  // Gamepad: bumpers or triggers flip, A pulls the plunger, Start starts, the d-pad nudges.
  const padPrev: boolean[] = [];
  const pollPad = () => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return;
    const btn = (i: number) => !!pad.buttons[i]?.pressed;
    const edge = (i: number, fn: (down: boolean) => void) => {
      const now = btn(i);
      if (now !== !!padPrev[i]) fn(now);
      padPrev[i] = now;
    };
    const left = btn(4) || btn(6);
    const right = btn(5) || btn(7);
    game.flip('L', left);
    game.flip('R', right);
    edge(0, (d) => {
      sound.wake();
      startOrPull(d);
    });
    edge(9, (d) => d && game.start());
    edge(8, (d) => d && game.coin());
    edge(12, (d) => d && game.nudge('U'));
    edge(14, (d) => d && game.nudge('L'));
    edge(15, (d) => d && game.nudge('R'));
  };

  // ---- Loop -----------------------------------------------------------------

  let last = -1;
  const frame = (now: number) => {
    const t = now / 1000;
    const dt = last < 0 ? 0 : Math.max(0, Math.min(0.05, t - last));
    last = t;
    pollPad();
    game.update(dt);
    field.draw(game, t);
    glass.draw(game, t, dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      sound.suspend();
      game.flip('L', false);
      game.flip('R', false);
      game.pull(false);
    } else {
      last = -1;
      if (sound.enabled) sound.wake();
    }
  });

  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { ringbell: unknown }).ringbell = { game, field, glass, sound, layout };
  }
}
