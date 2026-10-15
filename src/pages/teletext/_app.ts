// The set: keeps the header ticking, rolls through the pages in transmission
// while it searches, rotates carousels, and paints the page onto the tube.

import { A, COLS, Page, fit } from './_page';
import { PAGE_H, PAGE_W, render, flashes } from './_render';
import type { Service } from './_service';

/** How long each page takes to go by in the transmission cycle. */
const ROLL_MS = 70;
/** How long a carousel holds each subpage. */
const CAROUSEL_MS = 14000;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Size = 0 | 1 | 2;

export function start(root: HTMLElement, service: Service): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-screen]')!;
  const mirror = root.querySelector<HTMLElement>('[data-mirror]');
  const ctx = canvas.getContext('2d')!;
  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = PAGE_W;
  pageCanvas.height = PAGE_H;
  const pageCtx = pageCanvas.getContext('2d')!;
  const image = pageCtx.createImageData(PAGE_W, PAGE_H);
  // The page at twice its size, nearest neighbour, so the final smooth scale
  // softens edges without smearing the dots.
  const big = document.createElement('canvas');
  big.width = PAGE_W * 2;
  big.height = PAGE_H * 2;
  const bigCtx = big.getContext('2d')!;
  bigCtx.imageSmoothingEnabled = false;
  const canFilter = 'filter' in ctx;

  // What the viewer sees.
  let shown = 0;
  let sub = 0;
  let subAt = performance.now();
  let pages: Page[] = [new Page()];
  // Searching.
  let entry = '';
  let target: number | null = null;
  let roll = 0;
  let rollAt = 0;
  // Buttons.
  let hold = false;
  let reveal = false;
  let size: Size = 0;

  let dirty = true;
  let lastSecond = -1;
  let lastFlash = true;

  const cycle = () => service.numbers();

  function header(): Page {
    const p = new Page();
    const now = new Date();
    const typed = entry ? entry.padEnd(3, '-') : target !== null ? String(target) : String(shown || '').padStart(3, ' ');
    const list = cycle();
    const rolling = target !== null ? list[roll % list.length] : shown;
    const date = `${DAYS[now.getDay()]} ${String(now.getDate()).padStart(2, '0')} ${MONTHS[now.getMonth()]}`;
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}/${String(now.getSeconds()).padStart(2, '0')}`;
    p.put(0, 0, ' ', target !== null || entry ? A.green : A.white, `P${typed}`);
    p.put(0, 7, A.cyan, hold ? fit('  HOLD', 8) : 'TELEPAGE', A.white, String(rolling).padStart(3, ' '), ' ', date, A.yellow, time);
    return p;
  }

  function current(): Page {
    const body = pages[Math.min(sub, pages.length - 1)] ?? new Page();
    const p = new Page();
    p.copy(body);
    const h = header();
    p.buf.set(h.buf.subarray(0, COLS), 0);
    return p;
  }

  function show(n: number, s = 0): void {
    shown = n;
    pages = service.build(n);
    sub = Math.min(s, pages.length - 1);
    subAt = performance.now();
    reveal = false;
    dirty = true;
    try {
      history.replaceState(null, '', `#${n}`);
    } catch {
      // A sandboxed frame may refuse; the page still works.
    }
    if (mirror) {
      const body = pages[sub];
      const lines: string[] = [];
      for (let r = 1; r < 25; r++) {
        const t = body.text(r);
        if (t) lines.push(t);
      }
      mirror.textContent = `Page ${n}. ${lines.join('. ')}`;
    }
  }

  function search(n: number): void {
    entry = '';
    target = n;
    rollAt = performance.now();
    dirty = true;
  }

  function digit(d: string): void {
    if (!entry && (d === '0' || d === '9')) return;
    entry += d;
    if (entry.length === 3) {
      const n = Number(entry);
      entry = '';
      target = n;
      rollAt = performance.now();
    }
    dirty = true;
  }

  function step(by: number): void {
    const list = cycle();
    const base = target ?? shown;
    let i = list.indexOf(base);
    if (i < 0) {
      // Between pages: the next one up, or the last one below.
      i = list.findIndex((n) => n > base);
      if (i < 0) i = list.length;
      if (by > 0) i -= 1;
    }
    const n = list[(i + by + list.length * 2) % list.length];
    entry = '';
    target = null;
    show(n);
  }

  function subStep(by: number): void {
    if (pages.length < 2) return;
    sub = (sub + by + pages.length) % pages.length;
    subAt = performance.now();
    dirty = true;
  }

  function fastext(i: number): void {
    const links = service.links(shown, sub);
    const n = links[i];
    if (n) {
      entry = '';
      target = null;
      show(n);
    }
  }

  function press(key: string): void {
    if (/^[0-9]$/.test(key)) digit(key);
    else if (key === 'red') fastext(0);
    else if (key === 'green') fastext(1);
    else if (key === 'yellow') fastext(2);
    else if (key === 'cyan') fastext(3);
    else if (key === 'index') search(100);
    else if (key === 'reveal') reveal = !reveal;
    else if (key === 'hold') hold = !hold;
    else if (key === 'size') size = ((size + 1) % 3) as Size;
    else if (key === 'up') subStep(1);
    else if (key === 'down') subStep(-1);
    else if (key === 'next') step(1);
    else if (key === 'prev') step(-1);
    dirty = true;
    root.dataset.hold = String(hold);
    root.dataset.reveal = String(reveal);
    root.dataset.size = String(size);
    root.querySelector('[data-key="hold"]')?.setAttribute('aria-pressed', String(hold));
    root.querySelector('[data-key="reveal"]')?.setAttribute('aria-pressed', String(reveal));
  }

  // Remote.
  root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((b) => {
    b.addEventListener('click', () => press(b.dataset.key!));
  });

  // Keyboard.
  const KEYS: Record<string, string> = {
    r: 'red',
    g: 'green',
    y: 'yellow',
    c: 'cyan',
    b: 'cyan',
    i: 'index',
    '?': 'reveal',
    v: 'reveal',
    h: 'hold',
    s: 'size',
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowRight: 'next',
    ArrowLeft: 'prev',
    PageDown: 'next',
    PageUp: 'prev',
  };
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const key = /^[0-9]$/.test(e.key) ? e.key : KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
    if (!key) return;
    e.preventDefault();
    press(key);
    flashKey(key);
  });

  function flashKey(key: string): void {
    const b = root.querySelector<HTMLElement>(`[data-key="${key}"]`);
    if (!b) return;
    b.classList.add('is-down');
    setTimeout(() => b.classList.remove('is-down'), 140);
  }

  // Page numbers on the screen are links, and so is the Fastext row.
  let geometry = { x: 0, y: 0, w: 1, h: 1, y0: 0, rows: PAGE_H };
  function cellAt(e: PointerEvent): { row: number; col: number } | null {
    const r = canvas.getBoundingClientRect();
    const dpr = canvas.width / r.width;
    const x = ((e.clientX - r.left) * dpr - geometry.x) / geometry.w;
    const y = ((e.clientY - r.top) * dpr - geometry.y) / geometry.h;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
    const py = geometry.y0 + y * geometry.rows;
    return { row: Math.floor(py / 20), col: Math.floor(x * COLS) };
  }
  function linkAt(e: PointerEvent): { page?: number; fastext?: number } | null {
    const cell = cellAt(e);
    if (!cell || cell.row < 1) return null;
    const body = pages[sub];
    if (cell.row === 24 && service.links(shown, sub).some(Boolean)) return { fastext: Math.min(3, Math.floor(cell.col / 10)) };
    const text = Array.from({ length: COLS }, (_, c) => {
      const b = body.get(cell.row, c);
      return b >= 0x30 && b <= 0x39 ? String.fromCharCode(b) : ' ';
    }).join('');
    const re = /\d+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (cell.col >= m.index && cell.col < m.index + m[0].length && m[0].length === 3) {
        const n = Number(m[0]);
        if (n >= 100 && n <= 899 && service.has(n)) return { page: n };
      }
    }
    return null;
  }
  canvas.addEventListener('pointermove', (e) => {
    canvas.style.cursor = linkAt(e) ? 'pointer' : '';
  });
  canvas.addEventListener('click', (e) => {
    const link = linkAt(e as PointerEvent);
    if (!link) return;
    if (link.fastext !== undefined) fastext(link.fastext);
    else if (link.page) search(link.page);
  });

  function paint(): void {
    const page = current();
    render(page, image, { flashOn: lastFlash, reveal });
    pageCtx.putImageData(image, 0, 0);
    bigCtx.drawImage(pageCanvas, 0, 0, big.width, big.height);

    const W = canvas.width;
    const H = canvas.height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // The page fills about nine tenths of the tube's height, at a set's
    // aspect, leaving the overscan margin black.
    let h = H * 0.9;
    let w = h * 1.24;
    if (w > W * 0.94) {
      w = W * 0.94;
      h = w / 1.24;
    }
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    const y0 = size === 0 ? 0 : size === 1 ? 0 : 240;
    const rows = size === 0 ? PAGE_H : 260;
    geometry = { x, y, w, h, y0, rows };

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const src = [0, y0 * 2, big.width, rows * 2] as const;
    ctx.drawImage(big, ...src, x, y, w, h);

    if (canFilter) {
      // Bloom: the phosphor's light spilling into the glass.
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = `blur(${Math.max(1, w / 260)}px)`;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(big, ...src, x, y, w, h);
      ctx.filter = `blur(${Math.max(2, w / 70)}px)`;
      ctx.globalAlpha = 0.28;
      ctx.drawImage(big, ...src, x, y, w, h);
      ctx.filter = 'none';
    }

    // Scan lines, one per field line, when they are wide enough not to beat.
    const lines = rows / 2;
    const pitch = h / lines;
    ctx.globalCompositeOperation = 'source-over';
    if (pitch >= 3) {
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = '#000';
      const t = pitch * 0.36;
      for (let i = 0; i < lines; i++) ctx.fillRect(x - 4, y + i * pitch + pitch - t, w + 8, t);
    }
    ctx.globalAlpha = 1;
  }

  function resize(): void {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(r.width * dpr));
    const H = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
      dirty = true;
    }
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  service.onUpdate((n) => {
    if (n === shown || n === undefined) {
      const keep = sub;
      pages = service.build(shown);
      sub = Math.min(keep, pages.length - 1);
      dirty = true;
    }
  });

  function tick(): void {
    const now = performance.now();
    const second = Math.floor(Date.now() / 1000);
    if (second !== lastSecond) {
      lastSecond = second;
      dirty = true;
      if (service.live(shown)) {
        const keep = sub;
        pages = service.build(shown);
        sub = Math.min(keep, pages.length - 1);
      }
    }
    const flashOn = Date.now() % 1000 < 680;
    if (flashOn !== lastFlash) {
      lastFlash = flashOn;
      if (flashes(pages[sub] ?? new Page())) dirty = true;
    }
    if (target !== null) {
      const list = cycle();
      while (now - rollAt >= ROLL_MS) {
        rollAt += ROLL_MS;
        roll = (roll + 1) % list.length;
        dirty = true;
        if (list[roll] === target) {
          const n = target;
          target = null;
          show(n);
          break;
        }
      }
    } else if (!hold && pages.length > 1 && now - subAt >= CAROUSEL_MS) {
      sub = (sub + 1) % pages.length;
      subAt = now;
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      paint();
    }
  }

  // Opening: tune in to the requested page, or the index, from a random point
  // in the cycle, so the first wait is short but real.
  const fromHash = Number(location.hash.replace(/\D/g, ''));
  const first = fromHash >= 100 && fromHash <= 899 ? fromHash : 100;
  roll = Math.floor(Math.random() * cycle().length);
  const list = cycle();
  const ahead = list.indexOf(first);
  if (ahead >= 0) roll = (ahead - 8 - Math.floor(Math.random() * 14) + list.length * 2) % list.length;
  target = first;
  rollAt = performance.now();
  setInterval(tick, 30);
  tick();
  root.dataset.ready = 'true';

  // A read-only handle for render checks.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { telepage: unknown }).telepage = {
      press,
      show: (n: number, s = 0) => {
        target = null;
        show(n, s);
      },
      state: () => ({ shown, sub, subs: pages.length, target, entry, hold, reveal, size }),
    };
  }
}
