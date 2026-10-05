// The survey map: camera, input, and the plots laid over the terrain.
// Plots are real links in the page; this script only moves them. It sets three
// custom properties on the root (--cx, --cy, --z) and CSS places every plot.

import { OFFICE, plotCell } from './plots';
import { createTerrain, type Terrain } from './terrain';

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

const MIN_ZOOM = 5;
const MAX_ZOOM = 520;
const WORLD_LIMIT = 2000;
// Plots size their own labels (see Survey.astro); these zooms only pick where
// flights land: close enough for a title, or for the full entry.
const TITLE_ZOOM = 130;
const ENTRY_ZOOM = 280;
const DRAG_SLOP = 6;
// The daily run starts at 08:14 ET and its page is usually live by about 09:00.
const SURVEY_HOUR = 9;
const SURVEY_ZONE = 'America/New_York';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const ease = (t: number): number => 1 - Math.pow(1 - t, 3);

export function startSurvey(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-terrain]');
  const plotList = root.querySelector<HTMLElement>('[data-plots]');
  const scaleBar = root.querySelector<HTMLElement>('[data-scale]');
  const scaleLabel = root.querySelector<HTMLElement>('[data-scale-label]');
  const readout = root.querySelector<HTMLElement>('[data-readout]');
  if (!canvas || !plotList) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const terrain: Terrain | null = createTerrain(canvas);
  root.classList.toggle('sv-flat', !terrain);

  // ---- plots ----------------------------------------------------------------

  const plots = [...plotList.querySelectorAll<HTMLElement>('[data-plot]')].map((el) => ({
    el,
    link: el.querySelector<HTMLAnchorElement>('a'),
    plot: Number(el.dataset.plot),
    x: Number(el.dataset.x),
    y: Number(el.dataset.y),
  }));
  const claims = plots.filter((p) => p.plot > 0);
  const nextPlot = Math.max(0, ...plots.map((p) => p.plot)) + 1;
  const [stakeX, stakeY] = plotCell(nextPlot);
  const stake = buildStake(nextPlot, stakeX, stakeY);
  plotList.after(stake.el);
  const settled = Math.max(...plots.map((p) => Math.hypot(p.x, p.y)), Math.hypot(stakeX, stakeY)) + 1.5;

  // ---- camera ---------------------------------------------------------------

  const cam: Camera = { x: 0, y: 0, zoom: 100 };
  let reveal = reduceMotion.matches ? 1e5 : 0;
  let revealStart = 0;
  let dirty = true;
  let frame = 0;
  let flight: { from: Camera; to: Camera; start: number; duration: number } | null = null;
  let velocity = { x: 0, y: 0 };
  let coasting = false;

  const viewW = (): number => root.clientWidth;
  const viewH = (): number => root.clientHeight;

  function settle(c: Camera): Camera {
    return {
      x: clamp(c.x, -WORLD_LIMIT, WORLD_LIMIT),
      y: clamp(c.y, -WORLD_LIMIT, WORLD_LIMIT),
      zoom: clamp(c.zoom, MIN_ZOOM, MAX_ZOOM),
    };
  }

  // Every claim and the stake; the office stays out on its own lot.
  function fitAll(): Camera {
    const xs = [...claims.map((p) => p.x), stakeX];
    const ys = [...claims.map((p) => p.y), stakeY];
    const minX = Math.min(...xs) - 0.5;
    const maxX = Math.max(...xs) + 0.5;
    const minY = Math.min(...ys) - 0.5;
    const maxY = Math.max(...ys) + 0.5;
    // Leave room for the labels at the edges, the title block, and the controls.
    const zoom = Math.min((viewW() * 0.92) / (maxX - minX + 0.4), (viewH() * 0.62) / (maxY - minY + 1.2), ENTRY_ZOOM);
    return settle({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 - 0.04 * (viewH() / zoom), zoom });
  }

  function screenToWorld(sx: number, sy: number, c: Camera = cam): [number, number] {
    const rect = root.getBoundingClientRect();
    return [c.x + (sx - rect.left - viewW() / 2) / c.zoom, c.y + (sy - rect.top - viewH() / 2) / c.zoom];
  }

  function set(next: Camera): void {
    Object.assign(cam, settle(next));
    dirty = true;
    request();
  }

  function zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = screenToWorld(sx, sy);
    const zoom = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const rect = root.getBoundingClientRect();
    set({ zoom, x: wx - (sx - rect.left - viewW() / 2) / zoom, y: wy - (sy - rect.top - viewH() / 2) / zoom });
  }

  function flyTo(to: Camera, duration = 900): void {
    coasting = false;
    const target = settle(to);
    if (reduceMotion.matches) {
      flight = null;
      set(target);
      return;
    }
    flight = { from: { ...cam }, to: target, start: performance.now(), duration };
    request();
  }

  function stepFlight(now: number): void {
    if (!flight) return;
    const t = clamp((now - flight.start) / flight.duration, 0, 1);
    const k = ease(t);
    const { from, to } = flight;
    // Pull out a little mid-flight on long hops, like a map app does.
    const hop = Math.hypot(to.x - from.x, to.y - from.y) * Math.min(from.zoom, to.zoom);
    const lift = Math.sin(Math.PI * k) * clamp(hop / 2400, 0, 0.6);
    const logZoom = Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * k - lift;
    Object.assign(cam, { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, zoom: Math.exp(logZoom) });
    dirty = true;
    if (t >= 1) flight = null;
  }

  // ---- drawing --------------------------------------------------------------

  let revealedUpTo = -1;

  function draw(now: number): void {
    frame = 0;
    stepFlight(now);

    if (coasting) {
      cam.x -= velocity.x / cam.zoom;
      cam.y -= velocity.y / cam.zoom;
      velocity = { x: velocity.x * 0.92, y: velocity.y * 0.92 };
      Object.assign(cam, settle(cam));
      if (Math.hypot(velocity.x, velocity.y) < 0.2) coasting = false;
      dirty = true;
    }

    if (reveal < 1e5) {
      if (!revealStart) revealStart = now;
      const reach = Math.hypot(Math.abs(cam.x - stakeX) + viewW() / cam.zoom / 2, Math.abs(cam.y - stakeY) + viewH() / cam.zoom / 2) + 2;
      const t = clamp((now - revealStart) / 2200, 0, 1);
      reveal = t >= 1 ? 1e5 : ease(t) * reach;
      dirty = true;
    }

    if (dirty) {
      dirty = false;
      root.style.setProperty('--cx', cam.x.toFixed(4));
      root.style.setProperty('--cy', cam.y.toFixed(4));
      root.style.setProperty('--z', cam.zoom.toFixed(3));
      terrain?.render({ x: cam.x, y: cam.y, zoom: cam.zoom, reveal, revealX: stakeX, revealY: stakeY, settled, officeX: OFFICE.x, officeY: OFFICE.y });
      if (reveal !== revealedUpTo) {
        revealedUpTo = reveal;
        for (const p of plots) p.el.classList.toggle('sv-on', Math.hypot(p.x - stakeX, p.y - stakeY) <= reveal);
        stake.el.classList.add('sv-on');
      }
      updateScale();
    }

    if (flight || coasting || reveal < 1e5) request();
  }

  function request(): void {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  // A scale bar of a round number of sections, between about 60 and 150 px.
  function updateScale(): void {
    if (!scaleBar || !scaleLabel) return;
    const steps = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
    const length = steps.find((s) => s * cam.zoom >= 60) ?? steps.at(-1)!;
    scaleBar.style.width = `${Math.round(length * cam.zoom)}px`;
    const words: Record<number, string> = { 0.25: '¼ section', 0.5: '½ section', 1: '1 section' };
    scaleLabel.textContent = words[length] ?? `${length} sections`;
  }

  // ---- input ----------------------------------------------------------------

  const pointers = new Map<number, { x: number; y: number }>();
  let dragged = 0;
  let samples: { x: number; y: number; t: number }[] = [];

  function isChrome(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest('[data-chrome]');
  }

  root.addEventListener('pointerdown', (event) => {
    if (isChrome(event.target) || event.button > 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    flight = null;
    coasting = false;
    if (pointers.size === 1) {
      dragged = 0;
      samples = [];
    }
    root.classList.add('sv-grabbing');
  });

  window.addEventListener('pointermove', (event) => {
    if (readout && !pointers.size && !isChrome(event.target)) {
      const [wx, wy] = screenToWorld(event.clientX, event.clientY);
      readout.textContent = `${wy <= 0 ? 'N' : 'S'} ${Math.abs(wy).toFixed(2)}  ${wx >= 0 ? 'E' : 'W'} ${Math.abs(wx).toFixed(2)}`;
    }
    const last = pointers.get(event.pointerId);
    if (!last) return;
    const point = { x: event.clientX, y: event.clientY };

    if (pointers.size === 1) {
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      dragged += Math.hypot(dx, dy);
      set({ ...cam, x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom });
      samples.push({ x: point.x, y: point.y, t: performance.now() });
      if (samples.length > 6) samples.shift();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.entries()].map(([id, p]) => (id === event.pointerId ? point : p));
      const [pa, pb] = [...pointers.values()];
      const before = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const after = Math.hypot(a.x - b.x, a.y - b.y);
      const midBefore = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      const midAfter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      dragged += DRAG_SLOP;
      set({ ...cam, x: cam.x - (midAfter.x - midBefore.x) / cam.zoom, y: cam.y - (midAfter.y - midBefore.y) / cam.zoom });
      if (before > 0) zoomAt(midAfter.x, midAfter.y, after / before);
    }
    pointers.set(event.pointerId, point);
  });

  function release(event: PointerEvent): void {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size > 0) return;
    root.classList.remove('sv-grabbing');
    const first = samples[0];
    const last = samples.at(-1);
    if (!reduceMotion.matches && first && last && last.t - first.t > 0 && performance.now() - last.t < 80) {
      const ms = last.t - first.t;
      velocity = { x: ((last.x - first.x) / ms) * 16, y: ((last.y - first.y) / ms) * 16 };
      coasting = Math.hypot(velocity.x, velocity.y) > 1;
      request();
    }
  }
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  // Links would otherwise start a native drag and cancel the pan.
  root.addEventListener('dragstart', (event) => event.preventDefault());

  // A drag that starts on a plot must not open it.
  root.addEventListener(
    'click',
    (event) => {
      if (dragged > DRAG_SLOP && !isChrome(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
      dragged = 0;
    },
    true,
  );

  root.addEventListener(
    'wheel',
    (event) => {
      if (isChrome(event.target)) return;
      event.preventDefault();
      flight = null;
      coasting = false;
      const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.0018;
      const strength = event.ctrlKey ? 4 : 1;
      zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * unit * strength));
    },
    { passive: false },
  );

  root.addEventListener('dblclick', (event) => {
    if (isChrome(event.target) || (event.target instanceof Element && event.target.closest('a'))) return;
    const [wx, wy] = screenToWorld(event.clientX, event.clientY);
    flyTo({ x: wx, y: wy, zoom: cam.zoom * 2.2 }, 600);
  });

  window.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]')) return;
    const pan = 120 / cam.zoom;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => flyTo({ ...cam, x: cam.x - pan }, 220),
      ArrowRight: () => flyTo({ ...cam, x: cam.x + pan }, 220),
      ArrowUp: () => flyTo({ ...cam, y: cam.y - pan }, 220),
      ArrowDown: () => flyTo({ ...cam, y: cam.y + pan }, 220),
      '+': () => flyTo({ ...cam, zoom: cam.zoom * 1.6 }, 260),
      '=': () => flyTo({ ...cam, zoom: cam.zoom * 1.6 }, 260),
      '-': () => flyTo({ ...cam, zoom: cam.zoom / 1.6 }, 260),
      '0': () => flyTo(fitAll()),
      Home: () => flyTo(fitAll()),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  });

  // Keyboard users tab through the plots; the map follows the focus.
  plotList.addEventListener('focusin', (event) => {
    const item = plots.find((p) => p.el.contains(event.target as Node));
    if (!item || pointers.size) return;
    flyTo({ x: item.x, y: item.y, zoom: Math.max(cam.zoom, ENTRY_ZOOM) }, 700);
  });

  // ---- controls -------------------------------------------------------------

  const actions: Record<string, () => void> = {
    'zoom-in': () => flyTo({ ...cam, zoom: cam.zoom * 1.8 }, 320),
    'zoom-out': () => flyTo({ ...cam, zoom: cam.zoom / 1.8 }, 320),
    fit: () => flyTo(fitAll()),
    next: () => flyTo(onStake()),
    stumble: () => {
      if (claims.length === 0) return;
      const here = claims.filter((p) => Math.hypot(p.x - cam.x, p.y - cam.y) > 0.5 || cam.zoom < ENTRY_ZOOM);
      const pick = here[Math.floor(Math.random() * here.length)] ?? claims[0];
      flyTo({ x: pick.x, y: pick.y, zoom: ENTRY_ZOOM * 1.1 }, 1100);
      pick.el.classList.add('sv-picked');
      window.setTimeout(() => pick.el.classList.remove('sv-picked'), 2400);
    },
  };
  root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((button) => {
    button.addEventListener('click', () => actions[button.dataset.act ?? '']?.());
  });

  // ---- the next stake -------------------------------------------------------

  function buildStake(plot: number, x: number, y: number): { el: HTMLElement } {
    const el = document.createElement('div');
    el.className = 'sv-plot sv-stake';
    el.style.setProperty('--px', String(x));
    el.style.setProperty('--py', String(y));
    el.innerHTML = `<div class="sv-parcel" role="note" aria-label="Plot ${plot}, staked for the next experiment">
      <span class="sv-flag" aria-hidden="true"></span>
      <span class="sv-label"><span class="sv-no"><span class="sv-no-word">Plot </span>${plot}</span><span class="sv-title">Staked</span>
      <span class="sv-date">Check back soon for the next survey</span><span class="sv-eta" title="Estimated time to the next survey">~<span data-countdown>--:--:--</span></span></span></div>`;
    return { el };
  }

  const countdown = stake.el.querySelector<HTMLElement>('[data-countdown]');
  const zoneClock = new Intl.DateTimeFormat('en-US', {
    timeZone: SURVEY_ZONE,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  function tick(): void {
    if (!countdown) return;
    const parts = Object.fromEntries(zoneClock.formatToParts(new Date()).map((p) => [p.type, p.value]));
    const now = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
    let left = SURVEY_HOUR * 3600 - now;
    if (left <= 0) left += 86400;
    const pad = (n: number): string => String(n).padStart(2, '0');
    countdown.textContent = `${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`;
  }
  tick();
  window.setInterval(tick, 1000);

  // ---- start ----------------------------------------------------------------

  // Where overflow: clip is unsupported, undo any scroll a deep link or focus causes.
  root.addEventListener('scroll', () => {
    root.scrollTop = 0;
    root.scrollLeft = 0;
  });

  new ResizeObserver(() => {
    dirty = true;
    request();
  }).observe(root);

  const linkedPlot = (): (typeof plots)[number] | undefined => {
    const hash = decodeURIComponent(location.hash.slice(1));
    return plots.find((p) => p.el.id === hash);
  };
  const plotView = (p: (typeof plots)[number]): Camera =>
    settle({ x: p.x, y: p.y, zoom: ENTRY_ZOOM });
  window.addEventListener('hashchange', () => {
    const p = linkedPlot();
    if (p) flyTo(plotView(p));
  });
  const linked = linkedPlot();
  // Open on the stake, close enough to read it, and draw the land out from there.
  function onStake(): Camera {
    return settle({ x: stakeX, y: stakeY, zoom: clamp(Math.min(viewW(), viewH()) * 0.22, 160, 200) });
  }
  Object.assign(cam, linked ? plotView(linked) : onStake());
  root.classList.add('sv-live');
  request();
}
