// Falling-sand home page: a cellular automaton on a low-resolution canvas,
// scaled up with pixelated rendering. Experiments are buried as relics;
// digging exposes them and reveals a link.

export interface RelicItem {
  title: string;
  summary: string;
  href: string;
}

type Tool = 'dig' | 'pour';
type Rgb = [number, number, number];

interface Relic {
  x: number;
  y: number;
  w: number;
  h: number;
  revealed: boolean;
  el: HTMLAnchorElement;
}

const EMPTY = 0;
const SAND = 1;
const TITLE = 2;
const RELIC = 3;
const RELIC_LIT = 4;

const SHADES = 16;
const GLINT = SHADES - 1; // a rare grain that glows like the relics
const GLINT_CHANCE = 0.004;
const MAX_CELLS = 90_000;
const MIN_CELL_PX = 3;
const SUBSTEPS = 2;
const POUR_RATE = 7;
const REVEAL_OPEN_RATIO = 0.6;

export function startSand(root: HTMLElement, items: RelicItem[]): void {
  const canvas = root.querySelector('canvas');
  const relicLayer = root.querySelector<HTMLElement>('[data-relics]');
  const toolButton = root.querySelector<HTMLButtonElement>('[data-tool]');
  const resetButton = root.querySelector<HTMLButtonElement>('[data-reset]');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx || !relicLayer) return;

  let W = 0;
  let H = 0;
  let type = new Uint8Array(0);
  let shade = new Uint8Array(0);
  let stamp = new Uint8Array(0);
  let tick = 0;
  let image: ImageData | null = null;
  let pixels = new Uint32Array(0);
  let palettes: Uint32Array[] = [];
  let relics: Relic[] = [];
  let collapseR = 3;
  let digR = 4;
  let pourR = 2;

  let tool: Tool = 'dig';
  const pointer = { x: -1, y: -1, down: false, shift: false };
  let running = false;
  let frameCount = 0;
  let builtFor = { w: 0, h: 0 };

  // ---- colors -------------------------------------------------------------

  function readColor(name: string): Rgb {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const probe = ctx!;
    probe.fillStyle = '#000';
    probe.fillStyle = value || '#000';
    const normalized = String(probe.fillStyle);
    if (normalized.startsWith('#')) {
      return [1, 3, 5].map((at) => parseInt(normalized.slice(at, at + 2), 16)) as Rgb;
    }
    const parts = normalized.match(/[\d.]+/g) ?? ['0', '0', '0'];
    return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
  }

  function pack([r, g, b]: Rgb): number {
    // ImageData is RGBA in memory; on little-endian hardware that reads as ABGR.
    return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  function ramp(rgb: Rgb, low: number, high: number, glint?: Rgb): Uint32Array {
    const out = new Uint32Array(SHADES);
    for (let s = 0; s < SHADES; s++) {
      const k = low + ((high - low) * Math.min(s, GLINT - 1)) / (GLINT - 1);
      out[s] = pack(rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * k)))) as Rgb);
    }
    if (glint) out[GLINT] = pack(glint);
    return out;
  }

  function buildPalettes(): void {
    const sand = readColor('--color-sand');
    const title = readColor('--color-sand-title');
    const relic = readColor('--color-relic');
    palettes = [
      new Uint32Array(SHADES), // EMPTY stays transparent
      ramp(sand, 0.7, 1.08, relic),
      ramp(title, 0.86, 1.1),
      ramp(relic, 0.35, 0.55),
      ramp(relic, 0.85, 1.2),
    ];
  }

  // ---- grid helpers ---------------------------------------------------------

  function randomShade(): number {
    return Math.random() < GLINT_CHANCE ? GLINT : Math.floor(Math.random() * GLINT);
  }

  function inBounds(x: number, y: number): boolean {
    return x >= 0 && x < W && y >= 0 && y < H;
  }

  function place(x: number, y: number, t: number, s = randomShade()): void {
    const i = y * W + x;
    type[i] = t;
    shade[i] = s;
  }

  function move(from: number, to: number): void {
    type[to] = type[from];
    shade[to] = shade[from];
    type[from] = EMPTY;
    stamp[to] = tick;
  }

  // ---- scene ----------------------------------------------------------------

  async function build(): Promise<void> {
    const rect = canvas!.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    builtFor = { w: rect.width, h: rect.height };

    const cell = Math.max(MIN_CELL_PX, Math.ceil(Math.sqrt((rect.width * rect.height) / MAX_CELLS)));
    W = Math.ceil(rect.width / cell);
    H = Math.ceil(rect.height / cell);
    canvas!.width = W;
    canvas!.height = H;
    type = new Uint8Array(W * H);
    shade = new Uint8Array(W * H);
    stamp = new Uint8Array(W * H);
    image = ctx!.createImageData(W, H);
    pixels = new Uint32Array(image.data.buffer);
    collapseR = Math.max(3, Math.round(W * 0.018));
    digR = Math.max(4, Math.round(W * 0.022));
    pourR = Math.max(2, Math.round(W * 0.008));

    buildPalettes();
    const heights = buildDune();
    buildRelics(heights);
    await buildTitle();
    render();
  }

  function buildDune(): number[] {
    const portrait = W / H < 0.9;
    const base = Math.max(H * (portrait ? 0.34 : 0.3), 26);
    const phase1 = Math.random() * Math.PI * 2;
    const phase2 = Math.random() * Math.PI * 2;
    const heights: number[] = [];
    for (let x = 0; x < W; x++) {
      const h =
        base +
        H * 0.06 * Math.sin((x / W) * Math.PI * 2.2 + phase1) +
        H * 0.025 * Math.sin((x / W) * Math.PI * 8.5 + phase2) +
        Math.random() * 1.5;
      heights.push(Math.max(4, Math.round(h)));
      for (let y = H - heights[x]!; y < H; y++) place(x, y, SAND);
    }
    return heights;
  }

  function buildRelics(heights: number[]): void {
    relicLayer!.replaceChildren();
    relics = [];
    const maxSlots = Math.max(1, Math.floor(W / 34));
    const shown = items.slice(0, maxSlots);
    const w = Math.max(10, Math.min(22, Math.round(W * 0.06)));
    const h = Math.max(6, Math.round(w * 0.55));
    const slot = W / shown.length;

    shown.forEach((item, k) => {
      const jitter = (Math.random() - 0.5) * slot * 0.3;
      const x = Math.round(Math.min(W - w - 2, Math.max(2, slot * k + slot / 2 - w / 2 + jitter)));
      const surface = H - Math.min(...heights.slice(x, x + w));
      const y = Math.min(H - h - 2, surface + 4 + Math.floor(Math.random() * 6));

      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const edge = dx === 0 || dy === 0 || dx === w - 1 || dy === h - 1;
          const glyph = !edge && (dx * 7 + dy * 3) % 5 === 0;
          place(x + dx, y + dy, RELIC, edge || glyph ? GLINT - 1 : 4 + Math.floor(Math.random() * 4));
        }
      }

      const el = document.createElement('a');
      el.className = 'relic';
      el.href = item.href;
      el.tabIndex = -1;
      el.setAttribute('aria-hidden', 'true');
      el.style.left = `${((x + w / 2) / W) * 100}%`;
      el.style.top = `${(y / H) * 100}%`;
      const title = document.createElement('strong');
      title.textContent = item.title;
      const summary = document.createElement('span');
      summary.textContent = item.summary;
      el.append(title, summary);
      relicLayer!.append(el);

      relics.push({ x, y, w, h, revealed: false, el });
    });
  }

  async function buildTitle(): Promise<void> {
    const family =
      getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'serif';
    try {
      await document.fonts.load(`800 100px ${family}`);
    } catch {
      // Fall back to whatever font is available.
    }

    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const o = off.getContext('2d', { willReadFrequently: true });
    if (!o) return;

    const lines = W / H < 0.9 ? ['thesandbox', '.page'] : ['thesandbox.page'];
    o.font = `800 100px ${family}`;
    const widest = Math.max(...lines.map((line) => o.measureText(line).width));
    let size = (100 * W * (lines.length > 1 ? 0.88 : 0.84)) / widest;
    const maxBlock = H * (lines.length > 1 ? 0.36 : 0.26);
    if (lines.length * size * 0.95 > maxBlock) size = maxBlock / (lines.length * 0.95);

    o.font = `800 ${size}px ${family}`;
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.fillStyle = '#fff';
    const centerY = H * (lines.length > 1 ? 0.3 : 0.32);
    lines.forEach((line, k) => {
      o.fillText(line, W / 2, centerY + (k - (lines.length - 1) / 2) * size * 0.95);
    });

    const alpha = o.getImageData(0, 0, W, H).data;
    for (let i = 0; i < W * H; i++) {
      if (alpha[i * 4 + 3]! > 120 && type[i] === EMPTY) {
        type[i] = TITLE;
        shade[i] = Math.min(GLINT - 1, Math.floor(Math.random() * 6 + ((i % W) / W) * 9));
      }
    }
  }

  // ---- simulation -------------------------------------------------------------

  function step(): boolean {
    tick = (tick + 1) & 255;
    let moved = false;
    for (let y = H - 2; y >= 0; y--) {
      const leftToRight = Math.random() < 0.5;
      for (let n = 0; n < W; n++) {
        const x = leftToRight ? n : W - 1 - n;
        const i = y * W + x;
        if (type[i] !== SAND || stamp[i] === tick) continue;
        const below = i + W;
        if (type[below] === EMPTY) {
          move(i, below);
          moved = true;
          continue;
        }
        const first = Math.random() < 0.5 ? -1 : 1;
        for (const dir of [first, -first]) {
          const nx = x + dir;
          if (nx < 0 || nx >= W) continue;
          if (type[below + dir] === EMPTY && type[i + dir] === EMPTY) {
            move(i, below + dir);
            moved = true;
            break;
          }
        }
      }
    }
    return moved;
  }

  function render(): void {
    if (!image) return;
    for (let i = 0; i < W * H; i++) pixels[i] = palettes[type[i]!]![shade[i]!]!;
    ctx!.putImageData(image, 0, 0);
  }

  function checkRelics(): void {
    for (const relic of relics) {
      if (relic.revealed) continue;
      let open = 0;
      const row = relic.y - 1;
      for (let x = relic.x; x < relic.x + relic.w; x++) {
        if (row < 0 || type[row * W + x] === EMPTY) open++;
      }
      if (open / relic.w >= REVEAL_OPEN_RATIO) reveal(relic);
    }
  }

  function reveal(relic: Relic): void {
    relic.revealed = true;
    for (let dy = 0; dy < relic.h; dy++) {
      for (let dx = 0; dx < relic.w; dx++) {
        const i = (relic.y + dy) * W + relic.x + dx;
        if (type[i] === RELIC) type[i] = RELIC_LIT;
      }
    }
    relic.el.tabIndex = 0;
    relic.el.removeAttribute('aria-hidden');
    relic.el.classList.add('revealed');
    render();
  }

  // ---- tools --------------------------------------------------------------

  function circle(cx: number, cy: number, r: number, fn: (x: number, y: number, i: number) => void): void {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (dx * dx + dy * dy <= r * r && inBounds(x, y)) fn(x, y, y * W + x);
      }
    }
  }

  function crumble(cx: number, cy: number): void {
    circle(cx, cy, collapseR, (_x, _y, i) => {
      if (type[i] === TITLE) type[i] = SAND;
    });
  }

  function dig(cx: number, cy: number): void {
    let removed = 0;
    circle(cx, cy, digR, (_x, _y, i) => {
      if (type[i] === SAND || type[i] === TITLE) {
        type[i] = EMPTY;
        removed++;
      }
    });
    // Throw the sand up and out of the hole, where some of it slides back in.
    for (let k = 0; k < removed; k++) {
      const angle = Math.random() * Math.PI;
      const dist = digR + 1 + Math.random() * digR;
      const x = Math.round(cx + Math.cos(angle) * dist);
      const y = Math.round(cy - Math.sin(angle) * dist);
      if (inBounds(x, y) && type[y * W + x] === EMPTY) place(x, y, SAND);
    }
  }

  function pour(cx: number, cy: number): void {
    for (let k = 0; k < POUR_RATE; k++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * pourR;
      const x = Math.round(cx + Math.cos(angle) * dist);
      const y = Math.round(cy + Math.sin(angle) * dist);
      if (inBounds(x, y) && type[y * W + x] === EMPTY) place(x, y, SAND);
    }
  }

  function activeTool(): Tool {
    if (!pointer.shift) return tool;
    return tool === 'dig' ? 'pour' : 'dig';
  }

  function applyTool(x: number, y: number): void {
    if (activeTool() === 'dig') dig(x, y);
    else pour(x, y);
  }

  // ---- loop -----------------------------------------------------------------

  function wake(): void {
    if (running) return;
    running = true;
    requestAnimationFrame(frame);
  }

  function frame(): void {
    if (pointer.down) applyTool(pointer.x, pointer.y);
    let moved = false;
    for (let s = 0; s < SUBSTEPS; s++) moved = step() || moved;
    render();
    if (++frameCount % 12 === 0) checkRelics();
    if (moved || pointer.down) {
      requestAnimationFrame(frame);
    } else {
      checkRelics();
      running = false;
    }
  }

  // ---- input ----------------------------------------------------------------

  function toGrid(event: PointerEvent): [number, number] {
    const rect = canvas!.getBoundingClientRect();
    return [
      Math.floor(((event.clientX - rect.left) / rect.width) * W),
      Math.floor(((event.clientY - rect.top) / rect.height) * H),
    ];
  }

  function trace(fromX: number, fromY: number, toX: number, toY: number, fn: (x: number, y: number) => void): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(toX - fromX, toY - fromY) / 2));
    for (let s = 1; s <= steps; s++) {
      fn(Math.round(fromX + ((toX - fromX) * s) / steps), Math.round(fromY + ((toY - fromY) * s) / steps));
    }
  }

  canvas.addEventListener('pointermove', (event) => {
    const [x, y] = toGrid(event);
    const [lastX, lastY] = pointer.x < 0 ? [x, y] : [pointer.x, pointer.y];
    pointer.shift = event.shiftKey;
    trace(lastX, lastY, x, y, (px, py) => {
      crumble(px, py);
      if (pointer.down) applyTool(px, py);
    });
    pointer.x = x;
    pointer.y = y;
    wake();
  });

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    [pointer.x, pointer.y] = toGrid(event);
    pointer.shift = event.shiftKey;
    pointer.down = true;
    crumble(pointer.x, pointer.y);
    wake();
  });

  const release = (): void => {
    pointer.down = false;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    pointer.x = -1;
    pointer.y = -1;
  });

  toolButton?.addEventListener('click', () => {
    tool = tool === 'dig' ? 'pour' : 'dig';
    toolButton.dataset.tool = tool;
    toolButton.textContent = tool === 'dig' ? 'Digging' : 'Pouring';
    toolButton.setAttribute('aria-label', `Tool: ${tool}. Switch tool`);
  });

  resetButton?.addEventListener('click', () => {
    void build().then(wake);
  });

  // Rebuild on real resizes only; mobile browser chrome changes the height constantly.
  let resizeTimer = 0;
  new ResizeObserver(() => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const rect = canvas.getBoundingClientRect();
      const widthChanged = Math.abs(rect.width - builtFor.w) > 1;
      const heightChanged = Math.abs(rect.height - builtFor.h) / Math.max(1, builtFor.h) > 0.15;
      if (widthChanged || heightChanged) void build().then(wake);
    }, 200);
  }).observe(canvas);

  // Repaint in the new palette when the theme toggles.
  new MutationObserver(() => {
    buildPalettes();
    render();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  void build().then(wake);
}
