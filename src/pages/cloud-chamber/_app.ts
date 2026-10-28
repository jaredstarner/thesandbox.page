// Wires the page: the loop, the tray, dragging things around on the plate,
// tapping a track to name it, and the log of what this browser has seen.

import { Chamber, drift, type LiveTrack } from './_chamber';
import { ENTRIES, ENTRY, SOURCES, type Kind, type SourceId } from './_guide';
import { Renderer, type Insets } from './_gl';
import * as P from './_physics';

const LOG_KEY = 'cloud-chamber:log:v1';

interface LogItem {
  count: number;
  first: string;
  /** Specimen path, in a 100 x 64 box. */
  spec: string;
  width: number;
}

type Log = Partial<Record<Kind, LogItem>>;

function readLog(): Log {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) ?? '{}') as Record<string, Partial<LogItem>>;
    const log: Log = {};
    // Keep only well-formed entries for kinds this page knows.
    for (const e of ENTRIES) {
      const it = raw[e.kind];
      if (
        it &&
        typeof it.count === 'number' &&
        typeof it.first === 'string' &&
        typeof it.spec === 'string' &&
        /^[ML0-9. -]*$/.test(it.spec) &&
        typeof it.width === 'number'
      ) {
        log[e.kind] = { count: it.count, first: it.first, spec: it.spec, width: it.width };
      }
    }
    return log;
  } catch {
    return {};
  }
}

const SVG = 'http://www.w3.org/2000/svg';

/** Replaces a group's contents with one stroked path. */
function drawPath(g: Element, d: string, width: number): void {
  g.replaceChildren();
  if (!d) return;
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#e9ecef');
  path.setAttribute('stroke-width', String(width));
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  g.append(path);
}

function writeLog(log: Log): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    // Private windows may refuse storage; the log just won't outlast the visit.
  }
}

const STROKE: Record<Kind, number> = {
  muon: 0.9,
  shower: 0.9,
  decay: 1.1,
  delta: 1,
  electron: 1.1,
  alpha: 3,
  'long-alpha': 3,
  thoron: 3,
  scatter: 3,
};

/** The track's visible runs as an SVG path fitted into a w x h box. */
function specimen(t: LiveTrack, w: number, h: number, pad: number): string {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const run of t.runs)
    for (let i = 0; i < run.length; i += 3) {
      x0 = Math.min(x0, run[i]);
      x1 = Math.max(x1, run[i]);
      y0 = Math.min(y0, run[i + 1]);
      y1 = Math.max(y1, run[i + 1]);
    }
  // Below 2 cm keep the true scale, so a short track still looks short next to a long one.
  const span = Math.max(x1 - x0, ((y1 - y0) * w) / h, 2);
  const k = (w - 2 * pad) / span;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const parts: string[] = [];
  for (const run of t.runs) {
    let d = '';
    for (let i = 0; i < run.length; i += 3) {
      const x = w / 2 + (run[i] - cx) * k;
      const y = h / 2 - (run[i + 1] - cy) * k;
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    parts.push(d);
  }
  return parts.join('');
}

function insetsFor(w: number, h: number): Insets {
  if (w < 720) return { top: 92, right: 10, bottom: h > 700 ? 150 : 128, left: 10 };
  return { top: 64, right: w > 1100 ? 330 : 300, bottom: 92, left: 28 };
}

export function start(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  let renderer: Renderer;
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    console.error(err);
    root.querySelector<HTMLElement>('[data-unsupported]')!.hidden = false;
    return;
  }

  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  const seed = Number(params.get('seed')) || Date.now() & 0x7fffffff;
  const ch = new Chamber(seed);

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const tempEl = $('[data-temp]');
  const stateEl = $('[data-state]');
  const hint = $('[data-hint]');
  const card = $('[data-card]');
  const cardSpec = card.querySelector<SVGGElement>('[data-card-spec]')!;
  const holdBtn = $<HTMLButtonElement>('[data-hold]');
  const magnetBtn = $<HTMLButtonElement>('[data-magnet]');
  const logToggle = $<HTMLButtonElement>('[data-log-toggle]');
  const logCount = $('[data-log-count]');

  let log = readLog();
  let held = false;
  let highlight = -1;
  let picked = false;
  /** Where things sit, as fractions of the tank, so a rotation keeps them in place. */
  const place = {
    rod: { u: 0.2, v: 0.36, on: false },
    marble: { u: 0.52, v: 0.66, on: false },
    salt: { u: 0.74, v: 0.3, on: false },
    magnet: { u: 0.48, v: 0.5, on: false },
  };

  const dims = (): [number, number] => (innerHeight > innerWidth * 1.05 ? [20, 30] : [30, 20]);

  function syncObjects(): void {
    const { W, D } = P.G;
    const o: P.Objects = {};
    if (place.rod.on) {
      // A 9 cm length of electrode, lying across the beam.
      const cx = place.rod.u * W;
      const cy = place.rod.v * D;
      const a = W > D ? 0.42 : 1.1;
      o.rod = {
        ax: cx - Math.cos(a) * 4.5,
        ay: cy - Math.sin(a) * 4.5,
        bx: cx + Math.cos(a) * 4.5,
        by: cy + Math.sin(a) * 4.5,
        r: P.ROD_R,
      };
    }
    if (place.marble.on) o.marble = { x: place.marble.u * W, y: place.marble.v * D, r: P.MARBLE_R };
    if (place.salt.on) o.salt = { x: place.salt.u * W, y: place.salt.v * D, r: P.SALT_R, h: P.SALT_H };
    if (place.magnet.on) o.magnet = { x: place.magnet.u * W, y: place.magnet.v * D };
    ch.objects = o;
    renderer.setObjects(o);
  }

  function layout(): void {
    const w = root.clientWidth;
    const h = root.clientHeight;
    const d = dims();
    if (d[0] !== P.G.W) {
      P.G.W = d[0];
      P.G.D = d[1];
      renderer.clear(ch);
      syncObjects();
    }
    renderer.resize(w, h, devicePixelRatio || 1, insetsFor(w, h), d);
  }

  // --- Log ---------------------------------------------------------------

  function renderLog(): void {
    let n = 0;
    for (const e of ENTRIES) {
      const li = root.querySelector<HTMLElement>(`[data-entry="${e.kind}"]`)!;
      const item = log[e.kind];
      const btn = li.querySelector('button')!;
      const g = li.querySelector('[data-spec]')!;
      if (item) {
        n++;
        li.dataset.seen = '';
        btn.disabled = false;
        btn.setAttribute('aria-label', `${e.name}, seen ${item.count} time${item.count === 1 ? '' : 's'}`);
        drawPath(g, item.spec, item.width);
      } else {
        delete li.dataset.seen;
        btn.disabled = true;
        btn.setAttribute('aria-label', `${e.name}, not seen yet`);
        g.replaceChildren();
      }
    }
    logCount.textContent = String(n);
  }

  function logTrack(t: LiveTrack): boolean {
    const fresh = !log[t.kind];
    const item = log[t.kind];
    if (item) item.count++;
    else {
      log[t.kind] = {
        count: 1,
        first: new Date().toISOString(),
        spec: specimen(t, 100, 64, 9),
        width: STROKE[t.kind] * 0.75,
      };
    }
    writeLog(log);
    renderLog();
    return fresh;
  }

  // --- Card ----------------------------------------------------------------

  function showCard(kicker: string, name: string, facts: string, story: string, spec: string, width: number): void {
    $('[data-card-kicker]').textContent = kicker;
    $('[data-card-name]').textContent = name;
    $('[data-card-facts]').textContent = facts;
    $('[data-card-story]').textContent = story;
    drawPath(cardSpec, spec, width);
    card.hidden = false;
  }

  function hideCard(): void {
    card.hidden = true;
    highlight = -1;
  }

  $('[data-card-close]').addEventListener('click', hideCard);

  root.querySelectorAll<HTMLButtonElement>('[data-entry] button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.closest<HTMLElement>('[data-entry]')!.dataset.entry as Kind;
      const item = log[kind];
      if (!item) return;
      const e = ENTRY[kind];
      const first = new Date(item.first).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      highlight = -1;
      showCard(
        'From your log',
        e.name,
        `${e.look} / first seen ${first} / identified ${item.count} time${item.count === 1 ? '' : 's'}`,
        e.story,
        item.spec.replace(/[\d.]+/g, (m) => (Number(m) * 1.6).toFixed(1)),
        STROKE[kind] * 1.1,
      );
      if (innerWidth < 720) setLogOpen(false);
    });
  });

  function setLogOpen(open: boolean): void {
    root.dataset.log = open ? 'open' : '';
    logToggle.setAttribute('aria-expanded', String(open));
  }
  logToggle.addEventListener('click', () => setLogOpen(root.dataset.log !== 'open'));

  // --- Picking ---------------------------------------------------------------

  function trackAt(px: number, py: number, touch: boolean): LiveTrack | null {
    let best: LiveTrack | null = null;
    let bestScore = touch ? 26 : 16;
    for (const t of ch.tracks) {
      const pres = ch.presence(t);
      if (pres < 0.12 || t.length < 0.4) continue;
      const age = Math.max(0, ch.time - t.birth);
      let dmin = Infinity;
      for (const run of t.runs) {
        for (let i = 0; i < run.length; i += 3) {
          const [x, y, z] = drift(run[i], run[i + 1], run[i + 2], t.birth, age);
          const [sx, sy] = renderer.project(x, y, Math.max(0, z));
          const d = Math.hypot(sx - px, sy - py);
          if (d < dmin) dmin = d;
        }
      }
      const score = dmin - 5 * pres;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  function identify(t: LiveTrack): void {
    picked = true;
    hint.hidden = true;
    highlight = t.id;
    const fresh = logTrack(t);
    const e = ENTRY[t.kind];
    showCard(
      fresh ? 'New in your log' : 'Identified',
      e.name,
      `${t.facts} / ${t.length.toFixed(1)} cm visible`,
      e.story,
      specimen(t, 160, 100, 12),
      STROKE[t.kind],
    );
  }

  // --- Things on the plate ---------------------------------------------------

  type Handle = SourceId | 'magnet';

  function handleAt(px: number, py: number): Handle | null {
    const at = renderer.unproject(px, py, 0.3);
    if (!at) return null;
    const [x, y] = at;
    const o = ch.objects;
    if (o.marble && Math.hypot(x - o.marble.x, y - o.marble.y) < 1.6) return 'marble';
    if (o.salt && Math.hypot(x - o.salt.x, y - o.salt.y) < P.DISH_R + 0.3) return 'salt';
    if (o.rod) {
      const { ax, ay, bx, by } = o.rod;
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < 0.9) return 'rod';
    }
    if (o.magnet && Math.abs(Math.hypot(x - o.magnet.x, y - o.magnet.y) - 2.6) < 0.7) return 'magnet';
    return null;
  }

  let drag: { id: Handle; x: number; y: number; du: number; dv: number; moved: boolean; pointer: number } | null = null;
  let down: { x: number; y: number; touch: boolean } | null = null;

  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.offsetX, y: e.offsetY, touch: e.pointerType !== 'mouse' };
    const id = handleAt(e.offsetX, e.offsetY);
    if (id) {
      const at = renderer.unproject(e.offsetX, e.offsetY, 0.3)!;
      const p = place[id];
      drag = {
        id,
        x: e.offsetX,
        y: e.offsetY,
        du: p.u - at[0] / P.G.W,
        dv: p.v - at[1] / P.G.D,
        moved: false,
        pointer: e.pointerId,
      };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // A synthetic pointer can't be captured; dragging still works inside the canvas.
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) {
      if (e.pointerType === 'mouse') canvas.style.cursor = handleAt(e.offsetX, e.offsetY) ? 'grab' : '';
      return;
    }
    if (!drag.moved && Math.hypot(e.offsetX - drag.x, e.offsetY - drag.y) < 6) return;
    drag.moved = true;
    canvas.style.cursor = 'grabbing';
    const at = renderer.unproject(e.offsetX, e.offsetY, 0.3);
    if (!at) return;
    const p = place[drag.id];
    const { W, D } = P.G;
    const edge = drag.id === 'rod' ? 5 : drag.id === 'salt' ? 3.2 : drag.id === 'magnet' ? 2.8 : 1.6;
    p.u = Math.min(1 - edge / W, Math.max(edge / W, at[0] / W + drag.du));
    p.v = Math.min(1 - Math.min(edge, 2.2) / D, Math.max(Math.min(edge, 2.2) / D, at[1] / D + drag.dv));
    syncObjects();
  });

  const release = (e: PointerEvent) => {
    const wasDrag = drag?.moved;
    const handle = drag?.id;
    drag = null;
    canvas.style.cursor = '';
    if (!down) return;
    const tap = Math.hypot(e.offsetX - down.x, e.offsetY - down.y) < 8;
    const touch = down.touch;
    down = null;
    if (wasDrag || !tap) return;
    const t = trackAt(e.offsetX, e.offsetY, touch);
    if (t) identify(t);
    else if (handle && handle !== 'magnet') {
      const s = SOURCES.find((x) => x.id === handle)!;
      highlight = -1;
      showCard('On the plate', s.name, 'Drag it to move it', s.note, '', 1);
    } else if (handle === 'magnet') {
      highlight = -1;
      showCard(
        'Under the plate',
        'Magnet',
        'Drag the ring to move it',
        'A neodymium disc under the plate, about 0.3 tesla at its face. Slow electrons curl into tight spirals over it; alphas and muons carry far too much momentum to bend visibly.',
        '',
        1,
      );
    } else hideCard();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => {
    drag = null;
    down = null;
  });

  // --- Tray -----------------------------------------------------------------

  root.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.source as SourceId;
      place[id].on = !place[id].on;
      btn.setAttribute('aria-pressed', String(place[id].on));
      syncObjects();
    });
  });

  magnetBtn.addEventListener('click', () => {
    place.magnet.on = !place.magnet.on;
    magnetBtn.setAttribute('aria-pressed', String(place.magnet.on));
    syncObjects();
  });

  function setHeld(on: boolean): void {
    held = on;
    holdBtn.setAttribute('aria-pressed', String(on));
    root.dataset.held = on ? 'true' : '';
  }
  holdBtn.addEventListener('click', () => setHeld(!held));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideCard();
    if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey) setHeld(!held);
  });

  // --- Loop -----------------------------------------------------------------

  let phase = '';
  function readout(): void {
    const t = Math.round(ch.temperature);
    tempEl.textContent = `${t > 0 ? '+' : t < 0 ? '−' : ''}${Math.abs(t)}`;
    const ready = ch.ready;
    const next = ready >= 1 ? 'ready' : 'cooling';
    stateEl.textContent = held
      ? 'Held'
      : ready >= 1
        ? 'Sensitive'
        : ready > 0
          ? 'Layer forming'
          : ch.clock > 3
            ? 'Mist falling'
            : 'Cooling';
    if (next !== phase) {
      phase = next;
      root.dataset.phase = next;
      if (next === 'ready') {
        hint.textContent = 'Tap a track to see what made it';
        hint.hidden = picked;
      }
    }
  }

  let last = performance.now();
  function tick(now: number): void {
    // The first frame's timestamp can come before `last`; never step backwards.
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    ch.step(dt, held);
    const frost = Math.min(1, Math.max(0, (19 - ch.temperature) / 48));
    renderer.setCooling(frost * frost * (3 - 2 * frost), ch.ready);
    readout();
    renderer.render(ch, highlight);
    requestAnimationFrame(tick);
  }

  layout();
  renderLog();
  addEventListener('resize', layout);
  document.fonts?.ready.then(() => {
    const fam = getComputedStyle(root).getPropertyValue('--font-chamber-mono').trim();
    if (fam) renderer.paintScale(fam);
  });
  requestAnimationFrame(tick);

  if (debug) {
    const kinds: Record<string, (c: P.Ctx) => P.Track | null> = {
      muon: (c) => P.muon(c),
      delta: (c) => P.muon(c, true),
      shower: (c) => P.shower(c),
      decay: (c) => P.muonDecay(c),
      alpha: (c) => P.radonAlpha(c),
      scatter: (c) => P.radonAlpha(c, true),
      thoron: (c) => P.thoronPair(c),
      electron: (c) => P.background(c),
      'rod-alpha': (c) => P.rodAlpha(c),
    };
    Object.assign(window, {
      chamber: {
        ch,
        renderer,
        warm: () => ch.warm(),
        hold: setHeld,
        spawn: (k: string) => {
          const t = ch.spawn(kinds[k], ch.time, 1);
          return t ? { id: t.id, kind: t.kind, length: t.length, runs: t.runs.length } : null;
        },
        place: (id: Handle, on = true, u?: number, v?: number) => {
          place[id].on = on;
          if (u !== undefined) place[id].u = u;
          if (v !== undefined) place[id].v = v;
          root.querySelector(`[data-source="${id}"]`)?.setAttribute('aria-pressed', String(on));
          if (id === 'magnet') magnetBtn.setAttribute('aria-pressed', String(on));
          syncObjects();
        },
        /** Screen position of a live track's middle, for tap checks. */
        where: (id: number) => {
          const t = ch.tracks.find((x) => x.id === id);
          if (!t || !t.runs.length) return null;
          const run = t.runs[0];
          const i = Math.floor(run.length / 6) * 3;
          const [x, y, z] = drift(run[i], run[i + 1], run[i + 2], t.birth, ch.time - t.birth);
          return renderer.project(x, y, z);
        },
        tap: (px: number, py: number) => {
          const t = trackAt(px, py, false);
          if (t) identify(t);
          return t ? t.kind : null;
        },
        log: () => log,
        resetLog: () => {
          log = {};
          writeLog(log);
          renderLog();
        },
      },
    });
  }
}
