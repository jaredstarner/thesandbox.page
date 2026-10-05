import { drawText, textWidth } from './_font';
import type { Lab, Program } from './_lab';

// Snake on a 16 by 16 board, two pixels a cell, in the tab icon.

const N = 16;
const CELL = 2;
const BEST_KEY = 'favicon-lab:snake-best';

type Dir = 'up' | 'down' | 'left' | 'right';
type Cell = { x: number; y: number };
type Mode = 'demo' | 'play' | 'paused' | 'over';

const STEP: Record<Dir, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const DIRS = Object.keys(STEP) as Dir[];

const KEYS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

const COLORS = {
  back: '#0c1810',
  body: '#4fc85f',
  head: '#d6ff6a',
  food: '#ff5a3c',
  dead: '#8c2d22',
  text: '#d6ff6a',
};

const key = (c: Cell) => c.y * N + c.x;
const inside = (c: Cell) => c.x >= 0 && c.x < N && c.y >= 0 && c.y < N;
const add = (c: Cell, d: Dir): Cell => ({ x: c.x + STEP[d].x, y: c.y + STEP[d].y });

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(n: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(n));
  } catch {
    // Storage blocked; the best score lasts until the page closes.
  }
}

export function createSnake(lab: Lab): Program {
  const panel = lab.panel('snake');
  const scoreEl = panel.querySelector<HTMLElement>('[data-snake-score]')!;
  const bestEl = panel.querySelector<HTMLElement>('[data-snake-best]')!;
  const playButton = panel.querySelector<HTMLButtonElement>('[data-snake-play]')!;
  const coverButton = panel.querySelector<HTMLButtonElement>('[data-snake-cover]')!;
  const padButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-dir]')];
  const cover = lab.root.querySelector<HTMLElement>('[data-cover]')!;
  const { ctx } = lab;

  let snake: Cell[] = [];
  let dir: Dir = 'right';
  let queue: Dir[] = [];
  let food: Cell = { x: 0, y: 0 };
  let score = 0;
  let best = readBest();
  let mode: Mode = 'demo';
  let timer = 0;
  let flash = 0;
  let idleSince = 0;
  let swipeFrom: { x: number; y: number } | null = null;

  const placeFood = () => {
    const taken = new Set(snake.map(key));
    const free: Cell[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!taken.has(y * N + x)) free.push({ x, y });
    food = free[Math.floor(Math.random() * free.length)] ?? { x: 0, y: 0 };
  };

  const reset = (next: Mode) => {
    snake = [
      { x: 6, y: 8 },
      { x: 5, y: 8 },
      { x: 4, y: 8 },
    ];
    dir = 'right';
    queue = [];
    score = 0;
    mode = next;
    placeFood();
    scoreEl.textContent = '0';
  };

  const caption = () => {
    if (mode === 'demo') return 'Snake · press an arrow key';
    if (mode === 'paused') return `Paused · ${score}`;
    if (mode === 'over') return `Game over · ${score}`;
    return `Snake · ${score}`;
  };

  const draw = () => {
    ctx.fillStyle = COLORS.back;
    ctx.fillRect(0, 0, 32, 32);
    if (mode === 'over' && flash <= 0) {
      // The score, as big as it fits.
      const text = String(score);
      const scale = textWidth(text, 2) <= 30 ? 2 : 1;
      drawText(ctx, text, Math.round((32 - textWidth(text, scale)) / 2), Math.round((32 - 7 * scale) / 2), scale, COLORS.text);
    } else {
      ctx.fillStyle = COLORS.food;
      ctx.fillRect(food.x * CELL, food.y * CELL, CELL, CELL);
      const dead = mode === 'over' && flash % 2 === 1;
      snake.forEach((c, i) => {
        ctx.fillStyle = dead ? COLORS.dead : i === 0 ? COLORS.head : COLORS.body;
        ctx.fillRect(c.x * CELL, c.y * CELL, CELL, CELL);
      });
      if (mode === 'paused') {
        ctx.fillStyle = '#0c1810cc';
        ctx.fillRect(0, 0, 32, 32);
        ctx.fillStyle = COLORS.text;
        ctx.fillRect(10, 9, 4, 14);
        ctx.fillRect(18, 9, 4, 14);
      }
    }
    lab.present();
    lab.title(caption());
  };

  /** Cells reachable from `from` without crossing the body (the tail is about to move). */
  const reach = (from: Cell, body: Set<number>) => {
    const seen = new Set([key(from)]);
    const stack = [from];
    while (stack.length) {
      const c = stack.pop()!;
      for (const d of DIRS) {
        const n = add(c, d);
        if (inside(n) && !body.has(key(n)) && !seen.has(key(n))) {
          seen.add(key(n));
          stack.push(n);
        }
      }
    }
    return seen.size;
  };

  /** The demo player: the shortest path to the food, or failing that the roomiest turn. */
  const autopilot = (): Dir => {
    const body = new Set(snake.slice(0, -1).map(key));
    const head = snake[0]!;
    const first = new Map<number, Dir>();
    const queueCells: Cell[] = [];
    for (const d of DIRS) {
      const n = add(head, d);
      if (d === OPPOSITE[dir] || !inside(n) || body.has(key(n))) continue;
      first.set(key(n), d);
      queueCells.push(n);
    }
    for (let i = 0; i < queueCells.length; i++) {
      const c = queueCells[i]!;
      if (c.x === food.x && c.y === food.y) {
        const d = first.get(key(c))!;
        // Take the path only if it leaves room to live.
        if (reach(add(head, d), body) > snake.length) return d;
        break;
      }
      for (const d of DIRS) {
        const n = add(c, d);
        if (inside(n) && !body.has(key(n)) && !first.has(key(n))) {
          first.set(key(n), first.get(key(c))!);
          queueCells.push(n);
        }
      }
    }
    let bestDir = dir;
    let bestRoom = -1;
    for (const d of DIRS) {
      const n = add(head, d);
      if (d === OPPOSITE[dir] || !inside(n) || body.has(key(n))) continue;
      const room = reach(n, body);
      if (room > bestRoom) {
        bestRoom = room;
        bestDir = d;
      }
    }
    return bestDir;
  };

  const interval = () => (mode === 'demo' ? 110 : Math.max(80, 165 - score * 5));

  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = window.setTimeout(tick, ms);
  };

  const tick = () => {
    if (mode === 'paused') return;
    if (mode === 'over') {
      if (flash > 0) {
        flash--;
        draw();
        schedule(140);
      } else if (performance.now() - idleSince > 6000) {
        reset('demo');
        draw();
        schedule(interval());
      } else {
        draw();
        schedule(500);
      }
      return;
    }

    if (mode === 'demo') dir = autopilot();
    else {
      while (queue.length) {
        const next = queue.shift()!;
        if (next !== OPPOSITE[dir] && next !== dir) {
          dir = next;
          break;
        }
      }
    }

    const head = add(snake[0]!, dir);
    const eats = head.x === food.x && head.y === food.y;
    const body = snake.slice(0, eats ? snake.length : -1);
    if (!inside(head) || body.some((c) => c.x === head.x && c.y === head.y)) {
      if (mode === 'demo') {
        reset('demo');
        draw();
        schedule(600);
        return;
      }
      mode = 'over';
      flash = 6;
      idleSince = performance.now();
      if (score > best) {
        best = score;
        bestEl.textContent = String(best);
        writeBest(best);
      }
      draw();
      schedule(140);
      return;
    }

    snake.unshift(head);
    if (eats) {
      score++;
      if (mode === 'play') scoreEl.textContent = String(score);
      if (snake.length >= N * N) {
        reset(mode);
      } else placeFood();
    } else snake.pop();
    draw();
    schedule(interval());
  };

  const steer = (d: Dir) => {
    if (mode === 'demo' || mode === 'over') {
      reset('play');
      dir = d === 'left' ? 'right' : d;
      draw();
      schedule(interval());
      return;
    }
    if (mode === 'paused') {
      mode = 'play';
      queue = [d];
      draw();
      schedule(interval());
      return;
    }
    if (queue.length < 3) queue.push(d);
  };

  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable]')) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const d = KEYS[event.code];
    if (!d) return;
    event.preventDefault();
    steer(d);
  };

  const onVisibility = () => {
    if (document.hidden && mode === 'play') {
      mode = 'paused';
      clearTimeout(timer);
      draw();
    }
  };

  // Pointers steer on press, for speed; keyboard presses arrive as clicks with no detail.
  const onPad = (event: Event) => {
    if (event.type === 'click' && (event as MouseEvent).detail !== 0) return;
    const d = (event.currentTarget as HTMLElement).dataset.dir as Dir | undefined;
    if (d) {
      event.preventDefault();
      steer(d);
    }
  };

  // Swipes on the mirror steer too.
  const onDown = (event: PointerEvent) => {
    swipeFrom = { x: event.clientX, y: event.clientY };
  };
  const onUp = (event: PointerEvent) => {
    if (!swipeFrom) return;
    const dx = event.clientX - swipeFrom.x;
    const dy = event.clientY - swipeFrom.y;
    swipeFrom = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  };

  const onPlay = () => {
    reset('play');
    draw();
    schedule(interval());
  };

  const onCover = () => {
    const on = coverButton.getAttribute('aria-pressed') !== 'true';
    coverButton.setAttribute('aria-pressed', String(on));
    cover.hidden = !on;
  };

  return {
    start() {
      bestEl.textContent = String(best);
      reset('demo');
      draw();
      schedule(interval());
      addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', onVisibility);
      for (const b of padButtons) {
        b.addEventListener('pointerdown', onPad);
        b.addEventListener('click', onPad);
      }
      lab.canvas.addEventListener('pointerdown', onDown);
      lab.canvas.addEventListener('pointerup', onUp);
      lab.canvas.style.touchAction = 'none';
      playButton.addEventListener('click', onPlay);
      coverButton.addEventListener('click', onCover);
      cover.hidden = coverButton.getAttribute('aria-pressed') !== 'true';
    },
    stop() {
      clearTimeout(timer);
      removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const b of padButtons) {
        b.removeEventListener('pointerdown', onPad);
        b.removeEventListener('click', onPad);
      }
      lab.canvas.removeEventListener('pointerdown', onDown);
      lab.canvas.removeEventListener('pointerup', onUp);
      lab.canvas.style.touchAction = '';
      playButton.removeEventListener('click', onPlay);
      coverButton.removeEventListener('click', onCover);
      cover.hidden = true;
    },
  };
}
