// Wires the page: the wall's two views, hanging by drag or tap, the stores, the label card, undo, and share links.

import { clashes, drawPlan, drawRoom, FIGURE_HALF, FIGURE_TOP, fromX, fromY, toX, toY, type View } from './_draw';
import { Images } from './_images';
import {
  BENCH,
  boxOf,
  clampItem,
  decode,
  encode,
  lineY,
  OPENING,
  paintOf,
  placeFor,
  snap,
  WALL,
  type Guide,
  type Hung,
  type Light,
  type Scene,
} from './_scene';
import { artUrl, CRATE, fetchIds, imageUrl, KINDS, search, sizeText, toWork, type Rec, type Work } from './_works';

const STORE = 'the-hang:v1';
const MIN_S = 0.12;
const MAX_S = 40;

interface Saved {
  scene: Scene;
  recs: Rec[];
}

function q<T extends Element>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function cloneScene(s: Scene): Scene {
  return { ...s, items: s.items.map((i) => ({ ...i })) };
}

export function start(root: HTMLElement) {
  const stage = q<HTMLElement>(root, '[data-stage]');
  const roomCanvas = q<HTMLCanvasElement>(root, '[data-room]');
  const planCanvas = q<HTMLCanvasElement>(root, '[data-plan]');
  const roomCtx = roomCanvas.getContext('2d');
  const planCtx = planCanvas.getContext('2d');
  const lightCanvas = document.createElement('canvas');
  const lightCtx = lightCanvas.getContext('2d');
  if (!roomCtx || !planCtx || !lightCtx) {
    root.dataset.state = 'unsupported';
    return;
  }
  root.dataset.state = 'ready';

  const css = getComputedStyle(root);
  const fonts = {
    text: css.getPropertyValue('--hang-text').trim() || 'sans-serif',
    display: css.getPropertyValue('--hang-display').trim() || 'serif',
  };

  const works = new Map<number, Work>();
  for (const rec of CRATE) {
    const w = toWork(rec);
    if (w) works.set(w.id, w);
  }
  const crateIds = new Set(CRATE.map((r) => r.id));

  const images = new Images(() => requestDraw());
  let scene: Scene = cloneScene(OPENING);
  let selected: number | null = null;
  let guides: Guide[] = [];
  let torch: { x: number; y: number } | null = null;
  let mode: 'room' | 'plan' = 'room';
  const view: View = { cx: WALL.w / 2, cy: WALL.h / 2, s: 1, w: 1, h: 1, dpr: 1 };
  const past: string[] = [];
  const future: string[] = [];

  // ---- Loading: a shared link, then this browser's last hang, then the opening hang.
  let fromLink = false;
  let saved: Saved | null = null;
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) saved = JSON.parse(raw) as Saved;
  } catch {}
  for (const rec of saved?.recs ?? []) {
    const w = toWork(rec);
    if (w) works.set(w.id, w);
  }
  const hash = location.hash.match(/^#h=(.*)$/);
  const linked = hash ? decode(hash[1]) : null;
  if (linked) {
    scene = linked;
    fromLink = true;
  } else if (saved?.scene && Array.isArray(saved.scene.items)) {
    scene = { ...cloneScene(OPENING), ...saved.scene, items: saved.scene.items.map((i) => ({ ...i })) };
  }

  const missing = scene.items.map((i) => i.id).filter((id) => !works.has(id));
  if (missing.length) {
    fetchIds(missing)
      .then((list) => {
        for (const w of list) works.set(w.id, w);
        const lost = missing.filter((id) => !works.has(id)).length;
        if (lost) toast(`${lost} work${lost === 1 ? '' : 's'} from this hang couldn't be brought up from the stores.`);
        syncAll();
      })
      .catch(() => toast("The museum's stores aren't answering, so some works from this hang are missing."));
  }

  // ---- Elements.
  const titleInput = q<HTMLInputElement>(root, '[data-title]');
  const card = q<HTMLElement>(root, '[data-card]');
  const results = q<HTMLElement>(root, '[data-results]');
  const status = q<HTMLElement>(root, '[data-status]');
  const more = q<HTMLButtonElement>(root, '[data-more]');
  const form = q<HTMLFormElement>(root, '[data-search]');
  const qInput = q<HTMLInputElement>(root, '[data-q]');
  const scaleText = q<HTMLElement>(root, '[data-scale]');
  const scaleBar = q<HTMLElement>(root, '[data-scale-bar]');
  const checklist = q<HTMLOListElement>(root, '[data-checklist]');
  const blockTitle = q<HTMLElement>(root, '[data-block-title]');
  const blockScale = q<HTMLElement>(root, '[data-block-scale]');
  const toastEl = q<HTMLElement>(root, '[data-toast]');
  const undoBtn = q<HTMLButtonElement>(root, '[data-undo]');
  const redoBtn = q<HTMLButtonElement>(root, '[data-redo]');
  q<HTMLElement>(root, '[data-block-date]').textContent = new Date().toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  let toastTimer = 0;
  function toast(text: string) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), 3600);
  }

  // ---- Sizing and drawing.
  let fitS = 1;
  function resize() {
    const r = stage.getBoundingClientRect();
    view.w = Math.max(1, r.width);
    view.h = Math.max(1, r.height);
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [roomCanvas, planCanvas]) {
      c.width = Math.round(view.w * view.dpr);
      c.height = Math.round(view.h * view.dpr);
    }
    // The light map at one sample per CSS pixel; coarser maps showed their grid in broad pools when zoomed in.
    lightCanvas.width = Math.ceil(view.w);
    lightCanvas.height = Math.ceil(view.h);
    fitS = fitScale();
    requestDraw();
  }

  /** The scale that shows the whole wall; on a narrow screen, its full height. */
  function fitScale() {
    const sw = view.w / (WALL.w + 140);
    const sh = view.h / (WALL.h + 190);
    return view.w < 720 ? sh : Math.min(sw, sh);
  }

  function fit(animate = true) {
    const s = fitScale();
    const narrow = view.w < 720;
    // A narrow screen opens on the street scene with the visitor beside it, rather than a sliver of everything.
    const to = { cx: narrow ? 935 : WALL.w / 2, cy: WALL.h / 2 - 30, s };
    go(to, animate);
  }

  let anim = 0;
  function go(to: { cx: number; cy: number; s: number }, animate = true) {
    cancelAnimationFrame(anim);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduce) {
      Object.assign(view, to);
      clampView();
      requestDraw();
      return;
    }
    const from = { cx: view.cx, cy: view.cy, s: view.s };
    const t0 = performance.now();
    const step = (t: number) => {
      const u = Math.min(1, (t - t0) / 650);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      // Scale moves in log space so zooming reads evenly.
      view.s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e);
      view.cx = from.cx + (to.cx - from.cx) * e;
      view.cy = from.cy + (to.cy - from.cy) * e;
      clampView();
      draw();
      if (u < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  function clampView() {
    view.s = Math.min(MAX_S, Math.max(Math.min(MIN_S, fitS * 0.8), view.s));
    const mx = view.w / 2 / view.s;
    const my = view.h / 2 / view.s;
    view.cx = Math.min(WALL.w + 120 - Math.min(mx, WALL.w / 2 + 120), Math.max(-120 + Math.min(mx, WALL.w / 2 + 120), view.cx));
    view.cy = Math.min(WALL.h + 80 - Math.min(my, WALL.h / 2 + 80), Math.max(-110 + Math.min(my, WALL.h / 2 + 110), view.cy));
  }

  let queued = false;
  let both = 0;
  function requestDraw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      draw();
    });
  }

  function draw() {
    const st = { scene, works, images, selected, guides, torch: torch ?? defaultTorch(), fonts };
    const t = performance.now();
    if (mode === 'room' || t < both) drawRoom(roomCtx!, lightCtx!, view, st);
    if (mode === 'plan' || t < both) drawPlan(planCtx!, view, st);
    if (t < both) requestDraw();
    readouts();
  }

  function defaultTorch() {
    return { x: view.cx, y: Math.min(WALL.h - 60, Math.max(60, view.cy)) };
  }

  function readouts() {
    // A scale bar of a round length near 120 px.
    const lengths = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    const len = lengths.find((l) => l * view.s >= 70) ?? 500;
    scaleBar.style.width = `${Math.round(len * view.s)}px`;
    scaleText.textContent = len >= 100 ? `${len / 100} m` : `${len} cm`;
    const ratio = Math.max(1, Math.round(37.795 / view.s));
    blockScale.textContent = ratio === 1 ? 'Actual size' : `1:${ratio}`;
  }

  // ---- Changes.
  function remember() {
    past.push(encode(scene));
    if (past.length > 120) past.shift();
    future.length = 0;
    syncHistory();
  }

  function syncHistory() {
    undoBtn.disabled = past.length === 0;
    redoBtn.disabled = future.length === 0;
  }

  function restore(text: string) {
    const s = decode(text);
    if (!s) return;
    scene = s;
    if (selected !== null && !scene.items.some((i) => i.id === selected)) selected = null;
    syncAll();
  }

  function undo() {
    const prev = past.pop();
    if (!prev) return;
    future.push(encode(scene));
    restore(prev);
    syncHistory();
  }

  function redo() {
    const next = future.pop();
    if (!next) return;
    past.push(encode(scene));
    restore(next);
    syncHistory();
  }

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        const recs: Rec[] = [];
        for (const i of scene.items) {
          const w = works.get(i.id);
          if (w && !crateIds.has(w.id)) {
            const { size: _size, mount: _mount, ...rec } = w;
            void _size;
            void _mount;
            recs.push(rec);
          }
        }
        localStorage.setItem(STORE, JSON.stringify({ scene, recs } satisfies Saved));
      } catch {}
      if (fromLink) {
        history.replaceState(null, '', location.pathname);
        fromLink = false;
      }
    }, 300);
  }

  function syncAll() {
    titleInput.value = scene.title;
    root.dataset.light = scene.light;
    root.dataset.paint = scene.paint;
    for (const r of root.querySelectorAll<HTMLInputElement>('input[name="light"]')) r.checked = r.value === scene.light;
    for (const r of root.querySelectorAll<HTMLInputElement>('input[name="paint"]')) r.checked = r.value === scene.paint;
    syncCard();
    syncChecklist();
    syncResults();
    save();
    requestDraw();
  }

  function hang(work: Work, at?: { x: number; y: number }) {
    works.set(work.id, work);
    const existing = scene.items.find((i) => i.id === work.id);
    if (existing) {
      select(work.id);
      lookAt(existing, work);
      return;
    }
    remember();
    let pos: { x: number; y: number };
    if (at) {
      const snapped = snap(work.id, work, at.x, at.y, scene, works, 10 / view.s);
      pos = clampItem(snapped.x, snapped.y, work);
    } else {
      pos = placeFor(work, scene, works, view.cx);
    }
    const item = { id: work.id, ...pos };
    scene.items.push(item);
    select(work.id);
    if (!at) lookAt(item, work, false);
    syncAll();
  }

  function takeDown(id: number) {
    remember();
    scene.items = scene.items.filter((i) => i.id !== id);
    if (selected === id) selected = null;
    syncAll();
  }

  function select(id: number | null) {
    selected = id;
    syncCard();
    requestDraw();
  }

  /** Brings a work into view: closer when `close`, otherwise only far enough to show it. */
  function lookAt(item: Hung, work: Work, close = true) {
    if (close) {
      // On a phone the label card covers the bottom of the view, so the work sits in the upper part.
      const narrow = view.w < 720;
      const s = Math.min(MAX_S, Math.min((view.w * 0.55) / work.mount.w, (view.h * (narrow ? 0.42 : 0.6)) / work.mount.h));
      go({ cx: item.x + 6, cy: item.y - (narrow ? (view.h * 0.17) / s : 0), s });
      return;
    }
    const b = boxOf(item, work);
    const inside =
      toX(view, b.x0) > 20 && toX(view, b.x1) < view.w - 20 && toY(view, b.y1) > 20 && toY(view, b.y0) < view.h - 20;
    if (!inside) go({ cx: item.x, cy: view.cy, s: view.s });
  }

  // ---- The label card for the selected work.
  function syncCard() {
    const item = selected === null ? null : scene.items.find((i) => i.id === selected);
    const work = item ? works.get(item.id) : null;
    card.hidden = !work;
    if (!work || !item) return;
    const life = work.artistDisplay?.match(/\(([^)]*)\)/)?.[1];
    q<HTMLElement>(card, '[data-card-artist]').textContent = work.artist ?? 'Unknown maker';
    q<HTMLElement>(card, '[data-card-life]').textContent = life ?? '';
    q<HTMLElement>(card, '[data-card-title]').textContent = work.title;
    q<HTMLElement>(card, '[data-card-date]').textContent = work.date ?? '';
    q<HTMLElement>(card, '[data-card-medium]').textContent = work.medium ?? '';
    const framed = work.mount.mat
      ? `In its mat and frame, ${fmt(work.mount.h)} × ${fmt(work.mount.w)} cm`
      : work.mount.finish === 'rod'
        ? 'Hung from a rod'
        : work.mount.measuredFrame
          ? `Framed, ${fmt(work.mount.h)} × ${fmt(work.mount.w)} cm`
          : `In a frame of ours, ${fmt(work.mount.h)} × ${fmt(work.mount.w)} cm`;
    q<HTMLElement>(card, '[data-card-size]').textContent = `${sizeText(work)}. ${framed}.`;
    q<HTMLElement>(card, '[data-card-credit]').textContent = work.credit ?? '';
    q<HTMLElement>(card, '[data-card-centre]').textContent = `Centre ${fmt(item.y)} cm from the floor`;
    q<HTMLAnchorElement>(card, '[data-card-link]').href = artUrl(work);
  }

  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

  q<HTMLButtonElement>(card, '[data-card-down]').addEventListener('click', () => {
    if (selected !== null) takeDown(selected);
  });
  q<HTMLButtonElement>(card, '[data-card-line]').addEventListener('click', () => {
    const item = scene.items.find((i) => i.id === selected);
    const work = item && works.get(item.id);
    if (!item || !work) return;
    remember();
    Object.assign(item, clampItem(item.x, lineY(work), work));
    syncAll();
  });
  q<HTMLButtonElement>(card, '[data-card-look]').addEventListener('click', () => {
    const item = scene.items.find((i) => i.id === selected);
    const work = item && works.get(item.id);
    if (item && work) lookAt(item, work);
  });
  q<HTMLButtonElement>(card, '[data-card-close]').addEventListener('click', () => select(null));

  // ---- The plan's checklist.
  function syncChecklist() {
    blockTitle.textContent = scene.title.trim() || 'Untitled hang';
    const bad = clashes(scene, works);
    checklist.innerHTML = scene.items
      .filter((i) => works.has(i.id))
      .map((i) => {
        const w = works.get(i.id)!;
        return `<li${bad.has(i.id) ? ' class="clash"' : ''}><button type="button" data-goto="${w.id}"><span class="line"><span class="who">${esc(w.artist ?? 'Unknown maker')}</span>, <i>${esc(w.title)}</i></span><span class="dim">${esc(sizeText(w))}${bad.has(i.id) ? ' · overlaps a neighbour' : ''}</span></button></li>`;
      })
      .join('');
    root.dataset.empty = scene.items.length ? 'false' : 'true';
  }

  checklist.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('[data-goto]');
    if (!btn) return;
    const id = Number(btn.dataset.goto);
    const item = scene.items.find((i) => i.id === id);
    const work = works.get(id);
    if (item && work) {
      select(id);
      lookAt(item, work);
    }
  });

  // ---- The stores.
  let shown: Work[] = CRATE.map((r) => works.get(r.id)).filter((w): w is Work => !!w);
  let page = 1;
  let pages = 1;
  let query = '';
  let kind = 'all';
  let pending: AbortController | null = null;

  function scaleGlyph(w: Work): string {
    // At 0.12 px per cm beside the visitor, so a miniature is a speck and an altarpiece towers.
    const k = 0.12;
    const fw = Math.max(1, w.mount.w * k);
    const fh = Math.max(1, w.mount.h * k);
    const H = 58;
    const base = H - 2;
    const px = 4;
    const wx = 14;
    return `<svg class="glyph" viewBox="0 0 ${Math.ceil(wx + Math.min(fw, 60) + 2)} ${H}" width="${Math.ceil(wx + Math.min(fw, 60) + 2)}" height="${H}" aria-hidden="true"><g class="who"><circle cx="${px + 2.5}" cy="${base - 19.3}" r="1.5"/><path d="M${px} ${base - 17.6}h5l.6 9.4h-1.2l-.4 8.2h-3l-.4-8.2h-1.2z"/></g><rect x="${wx}" y="${(base - (w.mount.h > 0 ? lineY(w) + w.mount.h / 2 : 0) * k).toFixed(1)}" width="${Math.min(fw, 60).toFixed(1)}" height="${fh.toFixed(1)}"/><line x1="0" x2="100%" y1="${base}" y2="${base}"/></svg>`;
  }

  function syncResults() {
    const onWall = new Set(scene.items.map((i) => i.id));
    results.innerHTML = shown
      .map(
        (w) => `<li><button type="button" class="work${onWall.has(w.id) ? ' hung' : ''}" data-work="${w.id}">
          <span class="thumb"${w.lqip ? ` style="background-image:url('${esc(w.lqip)}')"` : ''}><img src="${imageUrl(w, 200)}" alt="" loading="lazy" decoding="async" width="64" height="64" /></span>
          <span class="meta"><span class="who">${esc(w.artist ?? 'Unknown maker')}</span><span class="what">${esc(w.title)}</span><span class="when">${esc(w.date ?? '')}</span><span class="size">${esc(sizeText(w))}${onWall.has(w.id) ? ' <b>On the wall</b>' : ''}</span></span>
          ${scaleGlyph(w)}
        </button></li>`,
      )
      .join('');
    more.hidden = page >= pages;
  }

  async function runSearch(next = false) {
    pending?.abort();
    const ctrl = new AbortController();
    pending = ctrl;
    const p = next ? page + 1 : 1;
    status.textContent = next ? 'Bringing up more…' : 'Searching the stores…';
    root.dataset.searching = 'true';
    try {
      const res = await search(query, kind, p, ctrl.signal);
      if (ctrl.signal.aborted) return;
      for (const w of res.works) if (!works.has(w.id)) works.set(w.id, w);
      shown = next ? [...shown, ...res.works.filter((w) => !shown.some((s) => s.id === w.id))] : res.works;
      page = res.page;
      pages = res.pages;
      const label = query ? `“${query}”` : 'Highlights';
      status.textContent =
        res.total === 0
          ? `Nothing in the stores for ${label}.`
          : `${label}: ${res.total.toLocaleString()} in the public domain${res.skipped ? `, ${res.skipped} on this page without measurements` : ''}.`;
      syncResults();
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      status.textContent = "The museum's stores aren't answering. The works below are kept here.";
      shown = CRATE.map((r) => works.get(r.id)).filter((w): w is Work => !!w);
      page = pages = 1;
      syncResults();
    } finally {
      if (pending === ctrl) root.dataset.searching = 'false';
    }
  }

  let typeTimer = 0;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(typeTimer);
    query = qInput.value.trim();
    runSearch();
  });
  qInput.addEventListener('input', () => {
    clearTimeout(typeTimer);
    typeTimer = window.setTimeout(() => {
      const next = qInput.value.trim();
      if (next === query) return;
      query = next;
      if (query.length === 0 || query.length > 2) runSearch();
    }, 650);
  });
  for (const r of root.querySelectorAll<HTMLInputElement>('input[name="kind"]')) {
    r.addEventListener('change', () => {
      kind = r.value in KINDS ? r.value : 'all';
      query = qInput.value.trim();
      runSearch();
    });
  }
  more.addEventListener('click', () => runSearch(true));
  // A thumbnail that fails leaves its blurred placeholder showing rather than a broken image.
  results.addEventListener(
    'error',
    (e) => {
      if (e.target instanceof HTMLImageElement) e.target.hidden = true;
    },
    true,
  );

  // Tap a work to hang it; drag one (mouse or pen) to hang it where it's dropped.
  let carry: { work: Work; id: number; x0: number; y0: number; ghost: HTMLElement | null } | null = null;
  results.addEventListener('pointerdown', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('[data-work]');
    if (!btn || e.button !== 0 || e.pointerType === 'touch') return;
    const work = works.get(Number(btn.dataset.work));
    if (!work) return;
    carry = { work, id: e.pointerId, x0: e.clientX, y0: e.clientY, ghost: null };
  });
  window.addEventListener('pointermove', (e) => {
    if (!carry || e.pointerId !== carry.id) return;
    if (!carry.ghost && Math.hypot(e.clientX - carry.x0, e.clientY - carry.y0) > 6) {
      const g = document.createElement('div');
      g.className = 'ghost';
      const w = Math.max(6, carry.work.mount.w * view.s);
      const h = Math.max(6, carry.work.mount.h * view.s);
      g.style.width = `${w}px`;
      g.style.height = `${h}px`;
      g.style.backgroundImage = `url("${imageUrl(carry.work, 400)}")`;
      root.append(g);
      carry.ghost = g;
      root.dataset.carrying = 'true';
    }
    if (carry.ghost) {
      e.preventDefault();
      carry.ghost.style.translate = `${e.clientX}px ${e.clientY}px`;
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (!carry || e.pointerId !== carry.id) return;
    const c = carry;
    carry = null;
    root.dataset.carrying = 'false';
    if (!c.ghost) return;
    c.ghost.remove();
    const r = stage.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    const over = document.elementFromPoint(e.clientX, e.clientY);
    if (inside && over && stage.contains(over)) {
      hang(c.work, { x: fromX(view, e.clientX - r.left), y: fromY(view, e.clientY - r.top) });
    }
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
  });
  let suppressClick = false;
  results.addEventListener('click', (e) => {
    if (suppressClick) return;
    const btn = (e.target as Element).closest<HTMLButtonElement>('[data-work]');
    const work = btn && works.get(Number(btn.dataset.work));
    if (!work) return;
    hang(work);
    if (matchMedia('(max-width: 719px)').matches) setStores(false);
  });

  // ---- The wall: select, drag, pan, pinch, wheel.
  interface Drag {
    kind: 'work' | 'person' | 'bench' | 'pan';
    id: number;
    ox: number;
    oy: number;
    moved: boolean;
    before: string;
  }
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: Drag | null = null;
  let pinch: { d: number; s: number; mx: number; my: number; cx: number; cy: number } | null = null;

  const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function hit(px: number, py: number): Drag['kind'] | number | null {
    const x = fromX(view, px);
    const y = fromY(view, py);
    for (let i = scene.items.length - 1; i >= 0; i--) {
      const item = scene.items[i];
      const work = works.get(item.id);
      if (!work) continue;
      const b = boxOf(item, work);
      const pad = 6 / view.s;
      if (x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad) return item.id;
    }
    if (Math.abs(x - scene.person) <= FIGURE_HALF && y >= 0 && y <= FIGURE_TOP) return 'person';
    if (Math.abs(x - scene.bench) <= BENCH.w / 2 && y >= 0 && y <= BENCH.h) return 'bench';
    return null;
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    stage.setPointerCapture?.(e.pointerId);
    if (scene.light === 'torch') {
      torch = { x: fromX(view, p.x), y: fromY(view, p.y) };
      requestDraw();
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag = null;
      guides = [];
      pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y),
        s: view.s,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        cx: view.cx,
        cy: view.cy,
      };
      return;
    }
    const h = hit(p.x, p.y);
    const before = encode(scene);
    if (typeof h === 'number') {
      const item = scene.items.find((i) => i.id === h)!;
      select(h);
      drag = { kind: 'work', id: h, ox: fromX(view, p.x) - item.x, oy: fromY(view, p.y) - item.y, moved: false, before };
    } else if (h === 'person' || h === 'bench') {
      const x = h === 'person' ? scene.person : scene.bench;
      drag = { kind: h, id: -1, ox: fromX(view, p.x) - x, oy: 0, moved: false, before };
    } else {
      drag = { kind: 'pan', id: -1, ox: p.x, oy: p.y, moved: false, before };
    }
    root.dataset.dragging = drag.kind;
  });

  stage.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (scene.light === 'torch' && mode === 'room') {
      torch = { x: fromX(view, p.x), y: fromY(view, p.y) };
      requestDraw();
    }
    if (!pointers.has(e.pointerId)) {
      stage.dataset.hover = hit(p.x, p.y) === null ? '' : 'true';
      return;
    }
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      view.s = Math.min(MAX_S, Math.max(fitS * 0.8, (pinch.s * d) / Math.max(1, pinch.d)));
      // Keep the wall point that was under the fingers' midpoint under it.
      const wx = (pinch.mx - view.w / 2) / pinch.s + pinch.cx;
      const wy = pinch.cy - (pinch.my - view.h / 2) / pinch.s;
      view.cx = wx - (mx - view.w / 2) / view.s;
      view.cy = wy + (my - view.h / 2) / view.s;
      clampView();
      requestDraw();
      return;
    }
    if (!drag) return;
    if (drag.kind === 'pan') {
      const dx = p.x - drag.ox;
      const dy = p.y - drag.oy;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      view.cx -= dx / view.s;
      view.cy += dy / view.s;
      drag.ox = p.x;
      drag.oy = p.y;
      clampView();
      requestDraw();
      return;
    }
    const x = fromX(view, p.x) - drag.ox;
    if (drag.kind === 'person' || drag.kind === 'bench') {
      drag.moved = true;
      const half = drag.kind === 'person' ? FIGURE_HALF : BENCH.w / 2;
      const nx = Math.min(WALL.w + 40 - half, Math.max(half - 40, x));
      if (drag.kind === 'person') scene.person = nx;
      else scene.bench = nx;
      requestDraw();
      return;
    }
    const item = scene.items.find((i) => i.id === drag!.id);
    const work = item && works.get(item.id);
    if (!item || !work) return;
    const y = fromY(view, p.y) - drag.oy;
    if (!drag.moved && Math.hypot(x - item.x, y - item.y) * view.s < 3) return;
    drag.moved = true;
    const snapped = e.altKey
      ? { x, y, guides: [] }
      : snap(item.id, work, x, y, scene, works, 8 / view.s);
    const c = clampItem(snapped.x, snapped.y, work);
    item.x = c.x;
    item.y = c.y;
    guides = snapped.guides;
    syncCard();
    requestDraw();
  });

  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }
    if (!drag) return;
    const d = drag;
    drag = null;
    root.dataset.dragging = '';
    guides = [];
    if (d.kind === 'pan' && !d.moved) select(null);
    if (d.moved && d.kind !== 'pan') {
      past.push(d.before);
      future.length = 0;
      syncHistory();
      syncAll();
    }
    requestDraw();
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('pointerleave', () => {
    stage.dataset.hover = '';
  });

  stage.addEventListener('dblclick', (e) => {
    const p = local(e);
    const h = hit(p.x, p.y);
    if (typeof h === 'number') {
      const item = scene.items.find((i) => i.id === h);
      const work = works.get(h);
      if (item && work) lookAt(item, work);
    } else fit();
  });

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.h : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) {
        view.cx += dx / view.s;
        clampView();
        requestDraw();
        return;
      }
      zoomAt(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
    },
    { passive: false },
  );

  function zoomAt(px: number, py: number, f: number) {
    cancelAnimationFrame(anim);
    const wx = fromX(view, px);
    const wy = fromY(view, py);
    view.s = Math.min(MAX_S, Math.max(fitS * 0.8, view.s * f));
    view.cx = wx - (px - view.w / 2) / view.s;
    view.cy = wy + (py - view.h / 2) / view.s;
    clampView();
    requestDraw();
  }

  q<HTMLButtonElement>(root, '[data-zoom-in]').addEventListener('click', () => zoomAt(view.w / 2, view.h / 2, 1.6));
  q<HTMLButtonElement>(root, '[data-zoom-out]').addEventListener('click', () => zoomAt(view.w / 2, view.h / 2, 1 / 1.6));
  q<HTMLButtonElement>(root, '[data-fit]').addEventListener('click', () => fit());

  stage.addEventListener('keydown', (e) => {
    const item = selected === null ? null : scene.items.find((i) => i.id === selected);
    const work = item && works.get(item.id);
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (item && work && moves[e.key]) {
      e.preventDefault();
      remember();
      const [mx, my] = moves[e.key];
      Object.assign(item, clampItem(item.x + mx, item.y + my, work));
      syncAll();
    } else if (item && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      takeDown(item.id);
    } else if (e.key === 'Escape') {
      select(null);
    } else if (e.key === '+' || e.key === '=') {
      zoomAt(view.w / 2, view.h / 2, 1.4);
    } else if (e.key === '-') {
      zoomAt(view.w / 2, view.h / 2, 1 / 1.4);
    } else if (e.key === '0') {
      fit();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.target as Element | null)?.closest('input, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  });

  // ---- Bar controls.
  titleInput.addEventListener('input', () => {
    scene.title = titleInput.value.slice(0, 80);
    syncChecklist();
    save();
    requestDraw();
  });

  for (const r of root.querySelectorAll<HTMLInputElement>('input[name="view"]')) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      mode = r.value === 'plan' ? 'plan' : 'room';
      root.dataset.view = mode;
      both = performance.now() + 450;
      requestDraw();
    });
  }
  for (const r of root.querySelectorAll<HTMLInputElement>('input[name="light"]')) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      scene.light = r.value as Light;
      root.dataset.light = scene.light;
      torch = null;
      save();
      requestDraw();
    });
  }
  for (const r of root.querySelectorAll<HTMLInputElement>('input[name="paint"]')) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      scene.paint = paintOf(r.value).id;
      root.dataset.paint = scene.paint;
      save();
      requestDraw();
    });
  }

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  q<HTMLButtonElement>(root, '[data-clear]').addEventListener('click', () => {
    if (!scene.items.length) return;
    remember();
    scene.items = [];
    selected = null;
    syncAll();
    toast('The wall is bare. Undo puts the hang back.');
  });
  q<HTMLButtonElement>(root, '[data-opening]').addEventListener('click', () => {
    remember();
    const keep = { paint: scene.paint, light: scene.light };
    scene = { ...cloneScene(OPENING), ...keep };
    selected = null;
    syncAll();
    fit();
  });

  q<HTMLButtonElement>(root, '[data-share]').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#h=${encode(scene)}`;
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      toast('Link to this hang copied.');
    } catch {
      toast('The link to this hang is in the address bar.');
    }
  });

  const storesBtn = q<HTMLButtonElement>(root, '[data-stores-toggle]');
  function setStores(open: boolean) {
    root.dataset.stores = open ? 'open' : 'closed';
    storesBtn.setAttribute('aria-expanded', String(open));
    requestAnimationFrame(resize);
  }
  storesBtn.addEventListener('click', () => setStores(root.dataset.stores !== 'open'));
  q<HTMLButtonElement>(root, '[data-stores-close]').addEventListener('click', () => setStores(false));

  // ---- Start.
  const wide = matchMedia('(min-width: 1100px)').matches;
  setStores(wide);
  new ResizeObserver(() => resize()).observe(stage);
  resize();
  fit(false);
  syncAll();
  syncHistory();
  if (fromLink) toast('A hang someone shared with you.');
  document.fonts?.ready.then(() => requestDraw());

  // Read-only handle for render checks.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { hang: unknown }).hang = {
      view,
      get scene() {
        return scene;
      },
      works,
      select: (id: number | null) => select(id),
      look: (id: number) => {
        const item = scene.items.find((i) => i.id === id);
        const work = works.get(id);
        if (item && work) lookAt(item, work);
      },
      go: (to: { cx: number; cy: number; s: number }) => go(to, false),
      torch: (x: number, y: number) => {
        torch = { x, y };
        requestDraw();
      },
      loaded: () => scene.items.every((i) => !works.has(i.id) || images.has(works.get(i.id)!)),
    };
  }
}
