// Wires the page: the litter, picking, the line of ancestors, the tree, and looking closer.

import { compile } from './_compile';
import { blank, child, decode, encode, founders, key, mix32, moves, pack, size, unpack, type Genome } from './_genome';
import { Renderer, type Draw, type Program } from './_gl';

const STORE = 'lineage:v1';
const COUNT = 12;
const MAX_PICS = 600;
const GROUND: [number, number, number] = [0.059, 0.059, 0.063];
/** Seconds for one turn of the clock that moving pictures read. */
const CLOCK = 14;
const FADE = 160;
const GROW = 1300;
const HOME_VIEW: [number, number, number] = [0, 0, 1];

interface Pic {
  id: string;
  genome: Genome;
  parent: string | null;
  /** The generation of the litter it was picked from; founders are 0. */
  gen: number;
  /** Seed for its children, so going back to it shows the same litter. */
  litter: number;
  at: number;
}

interface Slot {
  genome: Genome;
  program: Program;
  prev: Program | null;
  prevM: number;
  start: number;
  m: number;
  moving: boolean;
}

interface Closer {
  genome: Genome;
  program: Program;
  view: [number, number, number];
  index: number;
}

const seed32 = () => (Math.random() * 2 ** 32) >>> 0;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function start(root: HTMLElement): void {
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel) as T;
  const canvas = $<HTMLCanvasElement>('[data-canvas]');
  const stage = $<HTMLElement>('[data-stage]');
  const notice = $<HTMLElement>('[data-notice]');
  const tiles = [...root.querySelectorAll<HTMLElement>('[data-tile]')];
  const genLabel = $<HTMLElement>('[data-gen-label]');
  const genNumber = $<HTMLElement>('[data-gen]');
  const sizeEl = $<HTMLElement>('[data-size]');
  const hint = $<HTMLElement>('[data-hint]');
  const ancestors = $<HTMLOListElement>('[data-ancestors]');
  const treeEl = $<HTMLElement>('[data-tree]');
  const treePlot = $<HTMLElement>('[data-tree-plot]');
  const treeLinks = $<SVGSVGElement>('[data-tree-links]');
  const treeToggle = $<HTMLButtonElement>('[data-tree-toggle]');
  const closerEl = $<HTMLElement>('[data-closer]');
  const zoomEl = $<HTMLElement>('[data-zoom]');
  const shareBtn = $<HTMLButtonElement>('[data-share]');
  const saveBtn = $<HTMLButtonElement>('[data-save]');

  let renderer = Renderer.create(canvas);
  if (!renderer) {
    notice.textContent = 'Lineage grows its pictures with WebGL 2, which this browser does not offer.';
    notice.hidden = false;
    root.dataset.view = 'none';
    return;
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  // State, kept between visits.
  const pics = new Map<string, Pic>();
  let current: string | null = null;
  let founderSeed = seed32();
  let variation = 1;
  let picked = false;

  const load = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as {
        pics?: Record<string, { g: unknown; p: unknown; gen: unknown; s: unknown; at: unknown }>;
        current?: unknown;
        founders?: unknown;
        variation?: unknown;
        picked?: unknown;
      } | null;
      if (!raw || typeof raw !== 'object') return;
      for (const [id, v] of Object.entries(raw.pics ?? {})) {
        const genome = unpack(v?.g);
        if (!genome || !/^[a-z0-9]{4,24}$/.test(id)) continue;
        pics.set(id, {
          id,
          genome,
          parent: typeof v.p === 'string' ? v.p : null,
          gen: Number.isInteger(v.gen) ? (v.gen as number) : 0,
          litter: Number.isInteger(v.s) ? (v.s as number) >>> 0 : seed32(),
          at: typeof v.at === 'number' ? v.at : 0,
        });
      }
      for (const p of pics.values()) if (p.parent && !pics.has(p.parent)) p.parent = null;
      if (typeof raw.current === 'string' && pics.has(raw.current)) current = raw.current;
      if (Number.isInteger(raw.founders)) founderSeed = (raw.founders as number) >>> 0;
      if (raw.variation === 0.5 || raw.variation === 1 || raw.variation === 2) variation = raw.variation;
      picked = raw.picked === true;
    } catch {}
  };

  const save = () => {
    prune();
    try {
      const out: Record<string, unknown> = {};
      for (const p of pics.values()) out[p.id] = { g: pack(p.genome), p: p.parent, gen: p.gen, s: p.litter, at: p.at };
      localStorage.setItem(STORE, JSON.stringify({ pics: out, current, founders: founderSeed, variation, picked }));
    } catch {}
  };

  /** Keeps storage bounded: drops the oldest pictures nothing descends from, off the current line. */
  const prune = () => {
    if (pics.size <= MAX_PICS) return;
    const keep = new Set(chain(current).map((p) => p.id));
    const parents = new Set([...pics.values()].map((p) => p.parent));
    const leaves = [...pics.values()].filter((p) => !keep.has(p.id) && !parents.has(p.id)).sort((a, b) => a.at - b.at);
    for (const p of leaves.slice(0, pics.size - MAX_PICS)) pics.delete(p.id);
  };

  /** A picture and its ancestors, root first. */
  const chain = (id: string | null): Pic[] => {
    const out: Pic[] = [];
    const seen = new Set<string>();
    let p = id ? pics.get(id) : undefined;
    while (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.unshift(p);
      p = p.parent ? pics.get(p.parent) : undefined;
    }
    return out;
  };

  // The litter on screen.
  let slots: Slot[] = [];
  let parentGenome: Genome | null = null;
  let closer: Closer | null = null;
  let raf = 0;

  const litterGenomes = (): Genome[] => {
    const p = current ? pics.get(current) : undefined;
    if (!p) return founders(founderSeed, COUNT);
    return Array.from({ length: COUNT }, (_, i) => child(p.genome, mix32(p.litter, i + 1), variation));
  };

  /** Replaces the litter. Each new picture fades in as its parent, in a wave from `origin`, then grows into itself. */
  const showLitter = (origin: number | null) => {
    const r = renderer;
    if (!r) return;
    const p = current ? pics.get(current) : undefined;
    parentGenome = p ? p.genome : null;
    const genomes = litterGenomes();
    const cols = getComputedStyle($('[data-litter]')).gridTemplateColumns.split(' ').length || 4;
    const now = performance.now();
    const instant = reduced.matches;
    slots = genomes.map((g, i) => {
      const old = slots[i];
      let delay: number;
      if (origin === null) delay = ((i % cols) + Math.floor(i / cols)) * 45;
      else {
        const dx = (i % cols) - (origin % cols);
        const dy = Math.floor(i / cols) - Math.floor(origin / cols);
        delay = Math.hypot(dx, dy) * 75;
      }
      return {
        genome: g,
        program: r.program(compile(g, parentGenome)),
        prev: old && !instant ? old.program : null,
        prevM: old ? old.m : 1,
        start: now + delay,
        m: instant ? 1 : 0,
        moving: moves(g),
      };
    });
    tiles.forEach((t, i) => {
      const flag = t.querySelector<HTMLElement>('[data-moving]');
      if (flag) flag.hidden = !slots[i].moving;
    });
    const gen = p ? p.gen + 1 : 0;
    genLabel.textContent = p ? 'Generation' : 'Founders';
    genNumber.textContent = String(gen);
    genNumber.hidden = !p;
    if (p) {
      const { nodes, links } = size(p.genome);
      sizeEl.textContent = `${nodes} ${nodes === 1 ? 'function' : 'functions'}, ${links} ${links === 1 ? 'wire' : 'wires'}`;
    }
    sizeEl.hidden = !p;
    hint.hidden = picked;
    renderLine();
    if (!treeEl.hidden) renderTree();
    kick();
  };

  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const rectOf = (el: Element) => {
    const c = canvas.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return { x: b.left - c.left, y: b.top - c.top, w: b.width, h: b.height };
  };

  const clockAt = (now: number) => (reduced.matches ? 0.9 : ((now / 1000) * 2 * Math.PI) / CLOCK);

  const frame = (now: number) => {
    raf = 0;
    const r = renderer;
    if (!r) return;
    r.resize();
    r.clear(GROUND);
    // The tree covers the stage; nothing behind it needs drawing.
    if (!treeEl.hidden) return;
    const list: Draw[] = [];
    let again = false;
    if (closer) {
      const box = rectOf(canvas);
      list.push({ program: closer.program, ...box, view: closer.view, m: 1, a: 1 });
      if (!r.ready(closer.program)) again = true;
      if (moves(closer.genome) && !reduced.matches) again = true;
    } else {
      slots.forEach((s, i) => {
        const box = rectOf(tiles[i]);
        const ready = r.ready(s.program);
        // Wait for a shader before starting its picture's change.
        if (!ready) {
          s.start = Math.max(s.start, now);
          again = true;
        }
        const since = now - s.start;
        const fade = s.prev ? ease(since / FADE) : 1;
        if (s.prev && fade < 1) {
          list.push({ program: s.prev, ...box, view: HOME_VIEW, m: s.prevM, a: 1 });
          again = true;
        }
        if (since >= 0 && ready) {
          s.m = reduced.matches ? 1 : ease((since - (s.prev ? FADE : 0)) / GROW);
          list.push({ program: s.program, ...box, view: HOME_VIEW, m: s.m, a: fade });
          if (fade >= 1) s.prev = null;
        } else again = true;
        if (s.m < 1) again = true;
        if (s.moving && !reduced.matches) again = true;
      });
    }
    r.draw(list, clockAt(now));
    if (again) kick();
  };

  // Thumbnails, drawn once per picture and kept.
  const thumbs = new Map<string, HTMLCanvasElement>();
  const thumbQueue: { pic: Pic; c: HTMLCanvasElement }[] = [];
  let thumbTimer = 0;

  const thumb = (pic: Pic, px: number): HTMLCanvasElement => {
    const k = `${pic.id}:${px}`;
    const hit = thumbs.get(k);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = c.height = px;
    thumbs.set(k, c);
    thumbQueue.push({ pic, c });
    if (!thumbTimer) thumbTimer = window.setTimeout(drawThumbs, 0);
    return c;
  };

  const drawThumbs = () => {
    thumbTimer = 0;
    const r = renderer;
    if (!r) return;
    const until = performance.now() + 12;
    while (thumbQueue.length && performance.now() < until) {
      const { pic, c } = thumbQueue.shift()!;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      const p = r.temp(compile(pic.genome, pic.genome));
      const data = r.pixels(p, c.width, c.height, HOME_VIEW, 0.9, 1);
      r.drop(p);
      ctx.putImageData(new ImageData(data, c.width, c.height), 0, 0);
    }
    if (thumbQueue.length) thumbTimer = window.setTimeout(drawThumbs, 16);
  };

  const thumbPx = (css: number) => Math.round(css * Math.min(window.devicePixelRatio || 1, 2));

  const renderLine = () => {
    const line = chain(current);
    ancestors.replaceChildren();
    if (!line.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'The pictures you pick line up here.';
      ancestors.append(li);
      return;
    }
    for (const p of line) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.goto = p.id;
      b.setAttribute('aria-label', p.gen === 0 && !p.parent ? 'The founder' : `Picked from generation ${p.gen}`);
      b.title = p.parent ? `Generation ${p.gen}` : 'Founder';
      b.append(thumb(p, thumbPx(40)));
      li.append(b);
      ancestors.append(li);
    }
    requestAnimationFrame(() => (ancestors.scrollLeft = ancestors.scrollWidth));
  };

  // The tree of everything picked.
  const NODE = 60;
  const COL = 92;
  const ROW = 76;
  const PAD = 28;

  const renderTree = () => {
    const kids = new Map<string | null, Pic[]>();
    for (const p of pics.values()) {
      const k = p.parent && pics.has(p.parent) ? p.parent : null;
      const list = kids.get(k) ?? [];
      list.push(p);
      kids.set(k, list);
    }
    for (const list of kids.values()) list.sort((a, b) => a.at - b.at);
    const pos = new Map<string, { col: number; row: number }>();
    let row = 0;
    let deepest = 0;
    const place = (p: Pic, col: number, seen: Set<string>): number => {
      if (seen.has(p.id)) return row;
      seen.add(p.id);
      deepest = Math.max(deepest, col);
      const ks = kids.get(p.id) ?? [];
      let r: number;
      if (!ks.length) r = row++;
      else {
        const rows = ks.map((k) => place(k, col + 1, seen));
        r = (rows[0] + rows[rows.length - 1]) / 2;
      }
      pos.set(p.id, { col, row: r });
      return r;
    };
    const seen = new Set<string>();
    for (const rootPic of kids.get(null) ?? []) {
      place(rootPic, 0, seen);
      row += 0.4;
    }

    treePlot.querySelectorAll('.node, .tree-empty').forEach((n) => n.remove());
    treeLinks.replaceChildren();
    if (!pics.size) {
      const p = document.createElement('p');
      p.className = 'tree-empty';
      p.textContent = 'Nothing picked yet. Pick a picture and it starts a line here.';
      treePlot.append(p);
      treePlot.style.width = treePlot.style.height = '';
      return;
    }
    const w = PAD * 2 + deepest * COL + NODE;
    const h = PAD * 2 + Math.max(0, row - 1) * ROW + NODE + 18;
    treePlot.style.width = `${w}px`;
    treePlot.style.height = `${h}px`;
    treeLinks.setAttribute('viewBox', `0 0 ${w} ${h}`);
    treeLinks.setAttribute('width', String(w));
    treeLinks.setAttribute('height', String(h));
    const xy = (id: string) => {
      const q = pos.get(id)!;
      return { x: PAD + q.col * COL, y: PAD + q.row * ROW };
    };
    const onLine = new Set(chain(current).map((p) => p.id));
    for (const p of pics.values()) {
      if (!pos.has(p.id)) continue;
      const { x, y } = xy(p.id);
      if (p.parent && pos.has(p.parent)) {
        const a = xy(p.parent);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const x0 = a.x + NODE;
        const y0 = a.y + NODE / 2;
        const y1 = y + NODE / 2;
        const mid = (x0 + x) / 2;
        path.setAttribute('d', `M${x0} ${y0}C${mid} ${y0} ${mid} ${y1} ${x} ${y1}`);
        if (onLine.has(p.id)) path.setAttribute('class', 'on');
        treeLinks.append(path);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'node';
      b.dataset.goto = p.id;
      b.style.left = `${x}px`;
      b.style.top = `${y}px`;
      b.style.width = b.style.height = `${NODE}px`;
      b.setAttribute('aria-label', p.parent ? `Picked from generation ${p.gen}` : 'A founder');
      b.title = p.parent ? `Generation ${p.gen}` : 'Founder';
      if (p.id === current) b.setAttribute('aria-current', 'true');
      b.append(thumb(p, thumbPx(NODE)));
      treePlot.append(b);
    }
    const here = current ? pos.get(current) : undefined;
    if (here) {
      const scroller = treePlot.parentElement!;
      requestAnimationFrame(() => {
        scroller.scrollLeft = PAD + here.col * COL - scroller.clientWidth / 2;
        scroller.scrollTop = PAD + here.row * ROW - scroller.clientHeight / 2;
      });
    }
  };

  const setTree = (open: boolean) => {
    if (open) closeCloser();
    treeEl.hidden = !open;
    treeToggle.setAttribute('aria-pressed', String(open));
    if (open) renderTree();
    kick();
  };

  // Moving through the lineage.
  const goTo = (id: string | null) => {
    current = id && pics.has(id) ? id : null;
    save();
    setTree(false);
    closeCloser();
    showLitter(null);
  };

  const pick = (i: number) => {
    const s = slots[i];
    if (!s) return;
    const parent = current;
    const gen = parent ? pics.get(parent)!.gen + 1 : 0;
    const k = key(s.genome);
    let pic = [...pics.values()].find((p) => p.parent === parent && key(p.genome) === k);
    if (!pic) {
      pic = { id: uid(), genome: s.genome, parent, gen, litter: seed32(), at: Date.now() };
      pics.set(pic.id, pic);
    }
    current = pic.id;
    picked = true;
    save();
    closeCloser();
    showLitter(i);
  };

  // Looking closer at one picture.
  const openCloser = (i: number) => {
    const r = renderer;
    const s = slots[i];
    if (!r || !s) return;
    closer = { genome: s.genome, program: r.program(compile(s.genome, s.genome)), view: [0, 0, 1], index: i };
    root.dataset.view = 'closer';
    closerEl.hidden = false;
    shareBtn.textContent = 'Copy link';
    updateZoom();
    $<HTMLButtonElement>('[data-closer-back]').focus();
    kick();
  };

  const closeCloser = () => {
    if (!closer) return;
    const i = closer.index;
    closer = null;
    root.dataset.view = 'litter';
    closerEl.hidden = true;
    tiles[i]?.querySelector<HTMLButtonElement>('.look')?.focus({ preventScroll: true });
    kick();
  };

  const updateZoom = () => {
    if (!closer) return;
    const z = 1 / closer.view[2];
    zoomEl.textContent = `${z >= 10 ? Math.round(z) : z >= 1 ? z.toFixed(1).replace(/\.0$/, '') : z.toFixed(2)}×`;
  };

  const zoomAt = (cx: number, cy: number, factor: number) => {
    if (!closer) return;
    const box = canvas.getBoundingClientRect();
    const v = closer.view;
    const unit = v[2] / (box.height / 2);
    // The world point under the cursor stays put.
    const wx = v[0] + (cx - box.width / 2) * unit;
    const wy = v[1] - (cy - box.height / 2) * unit;
    const next = Math.max(0.0005, Math.min(60, v[2] * factor));
    const k = next / v[2];
    closer.view = [wx + (v[0] - wx) * k, wy + (v[1] - wy) * k, next];
    updateZoom();
    kick();
  };

  const pointers = new Map<number, { x: number; y: number }>();
  canvas.addEventListener('pointerdown', (e) => {
    if (!closer) return;
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    root.dataset.dragging = '';
  });
  canvas.addEventListener('pointermove', (e) => {
    const last = pointers.get(e.pointerId);
    if (!closer || !last) return;
    const box = canvas.getBoundingClientRect();
    const now = { x: e.offsetX, y: e.offsetY };
    if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(now.x - other.x, now.y - other.y);
      if (before > 0 && after > 0) zoomAt((now.x + other.x) / 2, (now.y + other.y) / 2, before / after);
    } else {
      const unit = closer.view[2] / (box.height / 2);
      closer.view = [
        closer.view[0] - (now.x - last.x) * unit,
        closer.view[1] + (now.y - last.y) * unit,
        closer.view[2],
      ];
      kick();
    }
    pointers.set(e.pointerId, now);
  });
  const lift = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) delete root.dataset.dragging;
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!closer) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(e.offsetX, e.offsetY, Math.exp(dy * 0.0016));
    },
    { passive: false },
  );

  const saveImage = () => {
    const r = renderer;
    if (!closer || !r) return;
    const box = canvas.getBoundingClientRect();
    const limit = Math.min(4096, r.gl.getParameter(r.gl.MAX_TEXTURE_SIZE) as number);
    let h = 2160;
    let w = Math.round((h * box.width) / box.height);
    if (w > limit) {
      h = Math.round((h * limit) / w);
      w = limit;
    }
    const data = r.pixels(closer.program, w, h, closer.view, clockAt(performance.now()), 2);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')?.putImageData(new ImageData(data, w, h), 0, 0);
    const p = current ? pics.get(current) : undefined;
    const gen = p ? p.gen + 1 : 0;
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `lineage-generation-${gen}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
    kick();
  };

  const share = async () => {
    if (!closer) return;
    const p = current ? pics.get(current) : undefined;
    const code = await encode(closer.genome, p ? p.gen + 1 : 0);
    const url = `${location.origin}${location.pathname}#g=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = 'Link copied';
    } catch {
      history.replaceState(null, '', url);
      shareBtn.textContent = 'Link is in the address bar';
    }
  };

  // Controls.
  root.addEventListener('click', (e) => {
    const t = e.target as Element;
    const pickBtn = t.closest<HTMLElement>('[data-pick]');
    if (pickBtn) return pick(Number(pickBtn.dataset.pick));
    const look = t.closest<HTMLElement>('[data-look]');
    if (look) return openCloser(Number(look.dataset.look));
    const go = t.closest<HTMLElement>('[data-goto]');
    if (go) return goTo(go.dataset.goto ?? null);
    if (t.closest('[data-reroll]')) {
      const p = current ? pics.get(current) : undefined;
      if (p) p.litter = seed32();
      else founderSeed = seed32();
      save();
      setTree(false);
      closeCloser();
      return showLitter(null);
    }
    if (t.closest('[data-new-line]')) {
      founderSeed = seed32();
      return goTo(null);
    }
    if (t.closest('[data-tree-toggle]')) return setTree(treeEl.hasAttribute('hidden'));
    if (t.closest('[data-tree-close]')) return setTree(false);
    if (t.closest('[data-closer-back]')) return closeCloser();
    if (t.closest('[data-closer-reset]') && closer) {
      closer.view = [0, 0, 1];
      updateZoom();
      return kick();
    }
    if (t.closest('[data-closer-pick]') && closer) return pick(closer.index);
    if (t === saveBtn) return saveImage();
    if (t === shareBtn) void share();
  });

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name !== 'variation') return;
    variation = Number(t.value);
    save();
    showLitter(null);
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (closer) closeCloser();
      else if (!treeEl.hidden) setTree(false);
    }
  });

  new ResizeObserver(() => kick()).observe(stage);
  reduced.addEventListener('change', () => kick());

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    renderer = null;
    notice.textContent = 'The graphics card took the canvas back. It should return in a moment.';
    notice.hidden = false;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    renderer = Renderer.create(canvas);
    notice.hidden = !!renderer;
    thumbs.clear();
    if (renderer) {
      slots = [];
      showLitter(null);
    }
  });

  // Start: from storage, or from a link someone shared.
  load();
  root.querySelectorAll<HTMLInputElement>('input[name=variation]').forEach((i) => {
    i.checked = Number(i.value) === variation;
  });
  const shared = /^#g=([A-Za-z0-9_-]+)$/.exec(location.hash);
  const begin = async () => {
    if (shared) {
      const got = await decode(shared[1]);
      if (got) {
        const k = key(got.genome);
        let pic = [...pics.values()].find((p) => !p.parent && key(p.genome) === k);
        if (!pic) {
          pic = { id: uid(), genome: got.genome, parent: null, gen: got.gen, litter: seed32(), at: Date.now() };
          pics.set(pic.id, pic);
        }
        current = pic.id;
        save();
      }
      history.replaceState(null, '', location.pathname + location.search);
    }
    // The opening litter grows out of flat grey.
    const r = renderer;
    if (r) {
      const grey = r.program(compile(blank(), null));
      slots = Array.from({ length: COUNT }, () => ({
        genome: blank(),
        program: grey,
        prev: null,
        prevM: 1,
        start: 0,
        m: 1,
        moving: false,
      }));
    }
    showLitter(null);
  };
  void begin();

  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { lineage: unknown }).lineage = {
      pick,
      look: openCloser,
      back: closeCloser,
      tree: setTree,
      goTo,
      zoom: (f: number) => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, f),
      pan: (x: number, y: number) => {
        if (closer) closer.view = [x, y, closer.view[2]];
        kick();
      },
      state: () => ({
        current,
        pics: pics.size,
        gen: genNumber.textContent,
        line: chain(current).length,
        slots: slots.map((s) => ({ ...size(s.genome), moving: s.moving, m: s.m })),
        view: closer?.view ?? null,
      }),
      source: (i: number) => compile(slots[i].genome, parentGenome),
      // Times a full-size off-screen render, as Save image makes, without downloading anything.
      render: (w: number, h: number) => {
        const r = renderer;
        if (!r || !closer) return null;
        const t0 = performance.now();
        const d = r.pixels(closer.program, w, h, closer.view, 0.9, 2);
        let lit = 0;
        for (let k = 0; k < d.length; k += 4 * 997) if (d[k] + d[k + 1] + d[k + 2] > 0) lit++;
        return { ms: Math.round(performance.now() - t0), samples: Math.ceil(d.length / (4 * 997)), lit };
      },
    };
  }
}
