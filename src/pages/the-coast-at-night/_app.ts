// The coast at night: loads the lights and coast, drives the chart, the light
// card, and the view from the deck.

import { Chart, type View } from './_chart';
import { formatPosition, latOf, lonOf, mercX, mercY, nmPerUnit } from './_geo';
import { loadLand } from './_land';
import { loadLights, type Lights } from './_lights';
import { Card } from './_card';
import { Labels } from './_labels';
import { Finder } from './_finder';
import { Deck } from './_deck';
import { loadRivers } from './_rivers';

const root = document.querySelector<HTMLElement>('[data-coast]')!;
const canvas = root.querySelector<HTMLCanvasElement>('[data-chart]')!;
const base = location.pathname.replace(/\/?$/, '/');
const debug = new URLSearchParams(location.search).has('debug');

const MIN_S = 256;
const MAX_S = 256 * 2 ** 12;
const FINE_AT = 256 * 2 ** 4.6;

const clampS = (s: number) => Math.max(minScale(), Math.min(MAX_S, s));
function minScale() {
  // Fill the width, and on a tall phone screen the height too, so the poles stay off screen.
  return Math.max(MIN_S, canvas.clientWidth * 1.02, canvas.clientHeight * 1.12);
}

async function main() {
  let lights: Lights;
  let chart: Chart;
  try {
    lights = await loadLights(`${base}lights.bin`);
    chart = new Chart(canvas, lights);
  } catch (e) {
    root.querySelector<HTMLElement>('[data-fallback]')!.hidden = false;
    if (!(e instanceof Error && e.message === 'webgl2')) {
      root.querySelector<HTMLElement>('[data-fallback]')!.textContent =
        'The chart could not be loaded. Try again later.';
    }
    console.error(e);
    return;
  }
  const [coarse, rivers] = await Promise.all([
    loadLand(`${base}land-50m.bin`),
    loadRivers(`${base}rivers.bin`).catch((e) => {
      console.error(e);
      return null;
    }),
  ]);
  chart.setLand(coarse, 'coarse');
  const deck = new Deck(root, lights);
  deck.setLand(coarse, true);
  if (rivers) {
    chart.setRivers(rivers.segments);
    deck.setRivers(rivers);
  }
  let fineLoading = false;
  let fineReady = false;
  const wantFine = () => {
    if (fineLoading) return;
    fineLoading = true;
    loadLand(`${base}land-10m.bin`)
      .then((l) => {
        chart.setLand(l, 'fine');
        fineReady = true;
        deck.setLand(l);
      })
      .catch((e) => {
        fineLoading = false;
        console.error(e);
      });
  };

  chart.resize();
  const view: View = { x: mercX(-12), y: mercY(28), s: 0 };
  view.s = clampS(0);

  const labels = new Labels(root.querySelector('[data-labels]')!, lights, `${base}names.json`);
  const card = new Card(root, lights, base);
  const finder = new Finder(root, `${base}names.json`, lights, (i) => {
    select(i);
    reveal(i, Math.max(view.s, 256 * 2 ** 10.5), true);
  });

  /** Brings light i into the part of the screen the card leaves clear. */
  function reveal(i: number, s: number, always: boolean) {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const c = root.querySelector<HTMLElement>('[data-card]')!.getBoundingClientRect();
    const r = canvas.getBoundingClientRect();
    const phone = c.width > W * 0.8;
    // Where the light should land: the middle of the open water beside or above the card.
    const tx = phone ? W / 2 : (c.left - r.left) / 2;
    const ty = phone ? Math.max(120, (c.top - r.top) / 2 + 60) : H / 2;
    let dx = lights.xy[i * 2] - view.x;
    dx -= Math.round(dx);
    const px = dx * view.s + W / 2;
    const py = (lights.xy[i * 2 + 1] - view.y) * view.s + H / 2;
    const covered = phone ? py > c.top - r.top - 30 : px > c.left - r.left - 30;
    if (!always && !covered && s === view.s) return;
    flyTo(lights.xy[i * 2] - (tx - W / 2) / s, lights.xy[i * 2 + 1] - (ty - H / 2) / s, s);
  }

  let selected = -1;
  const pick = document.createElement('div');
  pick.className = 'pick';
  pick.hidden = true;
  root.querySelector('[data-labels]')!.after(pick);

  function select(i: number) {
    selected = i;
    if (i < 0) {
      card.hide();
      pick.hidden = true;
      return;
    }
    card.show(i);
  }
  card.onClose = () => select(-1);
  card.onDeck = (i) => {
    const spot = deck.spotFor(i);
    if (spot) enterDeck(spot.lat, spot.lon, spot.heading);
    else deck.flash('No open water near enough to see this light from.');
  };

  // Hit testing: a grid of light indices over the Mercator square.
  const GRID = 512;
  const cells = new Map<number, number[]>();
  for (let i = 0; i < lights.n; i++) {
    if (!lights.lit[i]) continue;
    const k = Math.floor(lights.xy[i * 2 + 1] * GRID) * GRID + Math.floor(lights.xy[i * 2] * GRID);
    let c = cells.get(k);
    if (!c) cells.set(k, (c = []));
    c.push(i);
  }
  function nearest(px: number, py: number, radius: number): number {
    const wx = view.x + (px - canvas.clientWidth / 2) / view.s;
    const wy = view.y + (py - canvas.clientHeight / 2) / view.s;
    const r = radius / view.s;
    const cr = Math.ceil(r * GRID);
    const cx = Math.floor((((wx % 1) + 1) % 1) * GRID);
    const cy = Math.floor(wy * GRID);
    let best = -1;
    let bestD = Infinity;
    for (let j = -cr; j <= cr; j++)
      for (let i = -cr; i <= cr; i++) {
        const c = cells.get((cy + j) * GRID + ((cx + i + GRID) % GRID));
        if (!c) continue;
        for (const k of c) {
          let dx = lights.xy[k * 2] - wx;
          dx -= Math.round(dx);
          const dy = lights.xy[k * 2 + 1] - wy;
          // Prefer the longer-range light when two sit close.
          const d = Math.hypot(dx, dy) * view.s - Math.sqrt(lights.range[k]) * 1.2;
          if (Math.hypot(dx, dy) < r && d < bestD) {
            bestD = d;
            best = k;
          }
        }
      }
    return best;
  }

  // Flights between places.
  let flight: { from: View; to: View; t0: number; dur: number } | null = null;
  function flyTo(x: number, y: number, s: number) {
    const to = { x, y, s: clampS(s) };
    let dx = to.x - view.x;
    dx -= Math.round(dx);
    to.x = view.x + dx;
    const dist = Math.hypot(dx, to.y - view.y) * Math.min(view.s, to.s);
    const dur = Math.min(2600, 900 + Math.log2(1 + dist / 200) * 320 + Math.abs(Math.log2(to.s / view.s)) * 90);
    flight = { from: { ...view }, to, t0: performance.now(), dur };
  }
  function stepFlight(now: number) {
    if (!flight) return;
    const u = Math.min(1, (now - flight.t0) / flight.dur);
    const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
    const { from, to } = flight;
    const l0 = Math.log2(from.s);
    const l1 = Math.log2(to.s);
    const far = Math.hypot(to.x - from.x, to.y - from.y);
    const arch = Math.max(0, Math.log2(1 + (far * Math.min(from.s, to.s)) / 600) * 1.1);
    const ls = l0 + (l1 - l0) * e - arch * Math.sin(Math.PI * e);
    view.s = clampS(2 ** ls);
    // Move in step with the scale, so the target stays put on screen as it nears.
    const k = Math.abs(from.s - to.s) < 1e-6 ? e : (1 / view.s - 1 / from.s) / (1 / to.s - 1 / from.s);
    const kk = Number.isFinite(k) ? Math.max(0, Math.min(1, arch > 0.3 ? e : k)) : e;
    view.x = from.x + (to.x - from.x) * kk;
    view.y = from.y + (to.y - from.y) * kk;
    if (u >= 1) flight = null;
  }

  function clampView() {
    view.s = clampS(view.s);
    view.x = ((view.x % 1) + 1) % 1;
    const hh = canvas.clientHeight / 2 / view.s;
    view.y = hh * 2 >= 1 ? 0.5 : Math.max(hh, Math.min(1 - hh, view.y));
  }

  function zoomAt(px: number, py: number, factor: number) {
    const s1 = clampS(view.s * factor);
    const ox = px - canvas.clientWidth / 2;
    const oy = py - canvas.clientHeight / 2;
    view.x += ox / view.s - ox / s1;
    view.y += oy / view.s - oy / s1;
    view.s = s1;
  }

  // Pointer input: drag, pinch, click, double-click.
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  let pinch: { d: number; s: number } | null = null;
  // A long press on open water does on a touch screen what a double-click does with a mouse.
  let press = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (root.dataset.mode !== 'chart') return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    flight = null;
    moved = 0;
    clearTimeout(press);
    if (e.pointerType !== 'mouse' && pointers.size === 1) {
      const x = e.clientX;
      const y = e.clientY;
      press = window.setTimeout(() => {
        if (moved < 8 && pointers.size === 1) {
          pointers.clear();
          goOnDeckAt(x, y, 'Press and hold on open water.');
        }
      }, 600);
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    cursorAt(px, py);
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') {
        const hit = nearest(px, py, 10);
        if (hit >= 0) root.dataset.hovering = '';
        else delete root.dataset.hovering;
      }
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    moved += Math.abs(dx) + Math.abs(dy);
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      zoomAt(mx, my, (pinch.s * (d / pinch.d)) / view.s);
      view.x -= dx / 2 / view.s;
      view.y -= dy / 2 / view.s;
    } else if (pointers.size === 1) {
      view.x -= dx / view.s;
      view.y -= dy / view.s;
      if (moved > 4) root.dataset.dragging = '';
    }
  });
  const up = (e: PointerEvent) => {
    clearTimeout(press);
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    delete root.dataset.dragging;
    if (pointers.size === 0 && moved < 6 && e.type === 'pointerup') {
      const r = canvas.getBoundingClientRect();
      const hit = nearest(e.clientX - r.left, e.clientY - r.top, e.pointerType === 'mouse' ? 10 : 18);
      select(hit);
      if (hit >= 0) reveal(hit, view.s, false);
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      flight = null;
      const r = canvas.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * 0.0016));
    },
    { passive: false },
  );
  function goOnDeckAt(clientX: number, clientY: number, again: string) {
    const r = canvas.getBoundingClientRect();
    const wx = view.x + (clientX - r.left - canvas.clientWidth / 2) / view.s;
    const wy = view.y + (clientY - r.top - canvas.clientHeight / 2) / view.s;
    const lat = latOf(wy);
    const lon = lonOf(((wx % 1) + 1) % 1);
    if (deck.isLand(lat, lon)) {
      deck.flash(`That is land. ${again}`);
      return;
    }
    enterDeck(lat, lon, null);
  }
  canvas.addEventListener('dblclick', (e) => goOnDeckAt(e.clientX, e.clientY, 'Double-click open water.'));
  window.addEventListener('keydown', (e) => {
    if (root.dataset.mode !== 'chart' || (e.target as HTMLElement).closest('input')) return;
    const step = 80 / view.s;
    if (e.key === 'ArrowLeft') view.x -= step;
    else if (e.key === 'ArrowRight') view.x += step;
    else if (e.key === 'ArrowUp') view.y -= step;
    else if (e.key === 'ArrowDown') view.y += step;
    else if (e.key === '+' || e.key === '=') zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.5);
    else if (e.key === '-' || e.key === '_') zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.5);
    else if (e.key === 'Escape') select(-1);
    else return;
    flight = null;
  });

  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-place]')) {
    b.addEventListener('click', () => {
      const [lat, lon, z] = b.dataset.place!.split(',').map(Number);
      flyTo(mercX(lon), mercY(lat), 256 * 2 ** z);
    });
  }

  // Readouts.
  const cursorEl = root.querySelector<HTMLElement>('[data-cursor]')!;
  const scaleEl = root.querySelector<HTMLElement>('[data-scale]')!;
  const scaleText = root.querySelector<HTMLElement>('[data-scale-text]')!;
  function cursorAt(px: number, py: number) {
    const wy = view.y + (py - canvas.clientHeight / 2) / view.s;
    const wx = view.x + (px - canvas.clientWidth / 2) / view.s;
    if (wy < 0 || wy > 1) return;
    cursorEl.textContent = formatPosition(latOf(wy), lonOf(((wx % 1) + 1) % 1));
  }
  let lastScale = '';
  function scaleBar() {
    const nmPerPx = nmPerUnit(latOf(view.y)) / view.s;
    const target = 90 * nmPerPx;
    const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
    const nm = nice.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const label = nm < 1 ? `${nm * 10} cables` : `${nm.toLocaleString('en-US')} nautical mile${nm === 1 ? '' : 's'}`;
    const w = Math.round(nm / nmPerPx);
    const key = `${label}|${w}`;
    if (key === lastScale) return;
    lastScale = key;
    scaleEl.style.setProperty('--w', `${w}px`);
    scaleText.textContent = label;
  }

  // On deck.
  function enterDeck(lat: number, lon: number, heading: number | null) {
    flight = null;
    select(-1);
    root.dataset.mode = 'deck';
    wantFine();
    deck.enter(lat, lon, heading);
  }
  deck.onLeave = () => {
    root.dataset.mode = 'chart';
    const [lat, lon] = deck.position();
    flyTo(mercX(lon), mercY(lat), Math.max(view.s, 256 * 2 ** 9));
  };

  const ro = new ResizeObserver(() => {
    chart.resize();
    clampView();
  });
  ro.observe(canvas);

  const t0 = performance.now();
  let shift = 0;
  let held: number | null = null;
  function frame(now: number) {
    const time = held ?? (now - t0) / 1000 + shift;
    if (root.dataset.mode === 'deck') {
      deck.draw(time);
    } else {
      stepFlight(now);
      clampView();
      if (view.s >= FINE_AT * 0.8) wantFine();
      const sectors = Math.max(0, Math.min(1, (Math.log2(view.s / 256) - 7.4) / 0.6));
      chart.draw(view, time, { fine: fineReady && view.s >= FINE_AT, sectors });
      labels.update(view, canvas.clientWidth, canvas.clientHeight, selected);
      scaleBar();
      if (selected >= 0) {
        let dx = lights.xy[selected * 2] - view.x;
        dx -= Math.round(dx);
        const px = dx * view.s + canvas.clientWidth / 2;
        const py = (lights.xy[selected * 2 + 1] - view.y) * view.s + canvas.clientHeight / 2;
        pick.hidden = false;
        pick.style.translate = `${px}px ${py}px`;
      }
      card.tick(time);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (debug) {
    (window as unknown as { coast: unknown }).coast = {
      view,
      lights,
      select,
      flyTo: (lat: number, lon: number, z: number) => flyTo(mercX(lon), mercY(lat), 256 * 2 ** z),
      jump: (lat: number, lon: number, z: number) => {
        flight = null;
        view.x = mercX(lon);
        view.y = mercY(lat);
        view.s = clampS(256 * 2 ** z);
      },
      deck: (lat: number, lon: number, heading: number | null) => enterDeck(lat, lon, heading),
      deckView: deck,
      fine: () => fineReady,
      /** Moves the page clock, so a render check can catch a light mid-flash. */
      setTime: (t: number) => (shift = t - (performance.now() - t0) / 1000),
      /** Stops the page clock at t seconds, or starts it again with null. */
      hold: (t: number | null) => (held = t),
      wantFine,
      finder,
    };
  }
}

main();
