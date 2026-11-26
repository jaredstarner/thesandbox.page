// Wires the page together: the globe, the stopwatch, the solver, and the chart.

import { Chart, type Point } from './_chart';
import { Globe, type Scene, type View } from './_globe';
import { landMask } from './_land';
import { timeAll } from './_measure';
import { PLACES } from './_places';
import {
  EARTH_KM,
  KM_PER_RTT_MS,
  MAX_KM,
  SIGMA,
  bearing,
  boundKm,
  compass,
  fitAt,
  kmBetween,
  pretend,
  solve,
  toLatLon,
  toVec,
  type Fit,
  type Landmark,
  type Solution,
  type Vec3,
} from './_solve';
import { STATIONS } from './_stations';

type Mode = 'idle' | 'timing' | 'choose' | 'replay' | 'done';

const VECS: Vec3[] = STATIONS.map((s) => toVec(s.lat, s.lon));
const PLACE_VECS = PLACES.map(([name, lat, lon]) => ({ name, v: toVec(lat, lon) }));
/** Real seconds the replay takes, whatever the replies. */
const REPLAY_S = 8;
const NUMBER = new Intl.NumberFormat('en-GB');

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function roundTo(n: number, sig = 2): number {
  if (n <= 0) return 0;
  const k = 10 ** (Math.floor(Math.log10(n)) - sig + 1);
  return Math.round(n / k) * k;
}

function area(km2: number): string {
  if (km2 >= 1e6) return `${(km2 / 1e6).toFixed(km2 >= 1e7 ? 0 : 1)} million km²`;
  return `${NUMBER.format(roundTo(km2))} km²`;
}

/** "about 140 km north-east of Columbus", from the nearest large city. */
function describe(v: Vec3): string {
  let best = PLACE_VECS[0];
  let bestKm = Infinity;
  for (const p of PLACE_VECS) {
    const d = kmBetween(p.v, v);
    if (d < bestKm) {
      bestKm = d;
      best = p;
    }
  }
  if (bestKm < 35) return `close to ${best.name}`;
  const km = bestKm < 100 ? Math.round(bestKm / 5) * 5 : Math.round(bestKm / 10) * 10;
  return `about ${NUMBER.format(km)} km ${compass(bearing(best.v, v))} of ${best.name}`;
}

const fmtMs = (t: number) => `${t < 100 ? t.toFixed(1) : Math.round(t)} ms`;

export function start(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const stage = q<HTMLElement>('.stage');
  const canvas = q<HTMLCanvasElement>('.globe');
  const labelLayer = q<HTMLElement>('.labels');
  const probeEl = q<HTMLElement>('.probe');
  const truthEl = q<HTMLElement>('.truth');
  const bestEl = q<HTMLElement>('.best');
  const clock = q<HTMLElement>('.clock');
  const clockT = q<HTMLElement>('.clock-t b');
  const clockD = q<HTMLElement>('.clock-d b');
  const goBtn = q<HTMLButtonElement>('.go');
  const pretendBtn = q<HTMLButtonElement>('.pretend');
  const againBtn = q<HTMLButtonElement>('.again');
  const locateBtn = q<HTMLButtonElement>('.locate');
  const actions = q<HTMLElement>('.actions');
  const lead = q<HTMLElement>('.readout .lead');
  const detail = q<HTMLElement>('.readout .detail');
  const chart = new Chart(q<SVGSVGElement>('.plot'));
  const ledger = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>('.ledger li').forEach((li) => ledger.set(li.dataset.id!, li));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;

  let globe: Globe | null = null;
  try {
    globe = new Globe(canvas, VECS, landMask());
  } catch {
    q<HTMLElement>('.fallback').hidden = false;
    canvas.hidden = true;
  }

  // Station labels.
  const labels = STATIONS.map((s) => {
    const span = document.createElement('span');
    span.className = 'st';
    const b = document.createElement('b');
    b.textContent = s.name;
    const em = document.createElement('em');
    span.append(b, em);
    labelLayer.append(span);
    return { span, em };
  });

  let mode: Mode = 'idle';
  let source: 'real' | 'pretend' = 'real';
  const rtt = new Float32Array(STATIONS.length);
  let sol: Solution | null = null;
  let truth: Vec3 | null = null;
  let probe: Vec3 | null = null;
  let located = false;
  const scene: Scene = { rtt, grow: 0, tint: 1, fog: 0, fit: 0, best: 0, hot: -1 };
  let dirty = true;
  let drifting = !reduced;

  // The view starts on the visitor's side of the world, going by the clock's time zone.
  const tzLon = Math.max(-170, Math.min(170, -new Date().getTimezoneOffset() / 4));
  globe?.setView({ lat: 24, lon: tzLon, zoom: 1 });

  // Animations: each a function of elapsed seconds, returning false when finished.
  type Anim = (t: number) => boolean;
  const anims = new Map<string, { t0: number; fn: Anim }>();
  const animate = (key: string, fn: Anim) => anims.set(key, { t0: performance.now(), fn });

  function tweenView(to: View, seconds = 1.6): void {
    if (!globe) return;
    const from = { ...globe.view };
    let dLon = to.lon - from.lon;
    dLon = ((((dLon + 180) % 360) + 360) % 360) - 180;
    if (reduced) {
      globe.setView(to);
      dirty = true;
      return;
    }
    animate('view', (t) => {
      const k = ease(Math.min(1, t / seconds));
      globe!.setView({
        lat: from.lat + (to.lat - from.lat) * k,
        lon: from.lon + dLon * k,
        zoom: from.zoom * (to.zoom / from.zoom) ** k,
      });
      return t < seconds;
    });
  }

  function fade(key: 'tint' | 'fog' | 'fit', to: number, seconds: number, delay = 0): void {
    const from = scene[key];
    if (reduced) {
      scene[key] = to;
      dirty = true;
      return;
    }
    animate(key, (t) => {
      const k = Math.max(0, Math.min(1, (t - delay) / seconds));
      scene[key] = from + (to - from) * ease(k);
      return t < seconds + delay;
    });
  }

  const marks = (): Landmark[] => STATIONS.flatMap((_, i) => (rtt[i] > 0 ? [{ v: VECS[i], rtt: rtt[i] }] : []));
  const points = (): Point[] =>
    STATIONS.flatMap((s, i) => (rtt[i] > 0 ? [{ name: s.name, v: VECS[i], rtt: rtt[i] }] : []));

  function setLedger(i: number): void {
    const li = ledger.get(STATIONS[i].id);
    if (!li) return;
    const t = rtt[i];
    li.querySelector('.rtt')!.textContent = t > 0 ? fmtMs(t) : mode === 'timing' ? '…' : 'no reply';
    const km = boundKm(t);
    li.querySelector('.km')!.textContent =
      t <= 0 ? '' : km >= MAX_KM ? 'anywhere' : `≤ ${NUMBER.format(roundTo(km, 3))} km`;
  }

  function setButtons(busy: boolean): void {
    goBtn.disabled = busy;
    pretendBtn.disabled = busy;
    againBtn.disabled = busy;
    locateBtn.disabled = busy;
  }

  function chartFrom(): void {
    const pts = points();
    const from = probe ?? (mode === 'done' && sol ? sol.best : null);
    let fit: Fit | null = null;
    if (from && pts.length > 1 && mode === 'done') fit = fitAt(from, marks());
    const replied = STATIONS.flatMap((_, k) => (rtt[k] > 0 ? [k] : []));
    chart.endLabel = source === 'real' ? 'at your end' : 'at their end';
    chart.update(pts, from, fit, replied.indexOf(scene.hot));
  }

  chart.onHover = (i) => {
    // The chart's points are the stations that replied, in station order.
    const replied = STATIONS.flatMap((_, k) => (rtt[k] > 0 ? [k] : []));
    scene.hot = i >= 0 ? (replied[i] ?? -1) : -1;
    dirty = true;
    chartFrom();
  };

  // ---------- Timing the real replies ----------

  async function timeReplies(): Promise<void> {
    mode = 'timing';
    source = 'real';
    root.dataset.state = mode;
    truth = null;
    located = false;
    probe = null;
    sol = null;
    rtt.fill(0);
    Object.assign(scene, { grow: 0, tint: 1, fog: 0, fit: 0, hot: -1 });
    truthEl.hidden = true;
    probeEl.hidden = true;
    actions.hidden = true;
    setButtons(true);
    drifting = false;
    STATIONS.forEach((_, i) => setLedger(i));
    let answered = 0;
    let done = 0;
    lead.textContent = 'Asking thirty-four regions at once…';
    detail.textContent = '';
    chartFrom();
    dirty = true;
    await timeAll(
      STATIONS.map((s) => s.id),
      (i, t) => {
        done++;
        if (t !== null) {
          rtt[i] = t;
          answered++;
        }
        setLedger(i);
        lead.textContent = `${answered} of thirty-four have answered${done < STATIONS.length ? '…' : '.'}`;
      },
    );
    if (answered < 2) {
      mode = 'idle';
      root.dataset.state = mode;
      setButtons(false);
      lead.textContent = answered ? 'Only one region answered.' : 'No region answered.';
      detail.textContent =
        'Something between this page and the regions stopped the requests: no connection, a strict firewall, or a blocker. You can still pretend to be somewhere else.';
      STATIONS.forEach((_, i) => setLedger(i));
      return;
    }
    replay();
  }

  // ---------- Pretending ----------

  function choose(): void {
    mode = 'choose';
    root.dataset.state = mode;
    actions.hidden = true;
    drifting = false;
    lead.textContent = `${fine ? 'Click' : 'Tap'} anywhere on the globe to stand there.`;
    detail.textContent =
      'The page will make up the replies someone there might get, with all the usual slowness, and try to find them from those alone.';
  }

  function pretendAt(v: Vec3): void {
    source = 'pretend';
    truth = v;
    located = false;
    probe = null;
    const [lat, lon] = toLatLon(v);
    const seed = Math.round((lat + 90) * 1000) * 400000 + Math.round((lon + 180) * 1000);
    const fake = pretend(v, VECS, seed);
    fake.forEach((t, i) => (rtt[i] = t));
    truthEl.hidden = true;
    probeEl.hidden = true;
    STATIONS.forEach((_, i) => setLedger(i));
    replay();
  }

  // ---------- The replay ----------

  function replay(): void {
    mode = 'replay';
    root.dataset.state = mode;
    setButtons(true);
    actions.hidden = true;
    Object.assign(scene, { grow: 0, tint: 1, fog: 0, fit: 0, hot: -1 });
    const m = marks();
    sol = solve(m, 1);
    scene.best = sol.fit.score;
    const fastest = STATIONS.map((_, i) => i)
      .filter((i) => rtt[i] > 0)
      .sort((a, b) => rtt[a] - rtt[b]);
    const first = fastest[0];
    const end = Math.min(Math.max(...m.map((x) => x.rtt)), MAX_KM / KM_PER_RTT_MS) + 1;
    lead.textContent =
      source === 'real'
        ? 'Every reply is in. Here they are again, slowed down.'
        : 'The made-up replies are in. Here they are, slowed down.';
    detail.textContent =
      'Each circle grows as far as light in glass could have gone and come back, and stops when its reply arrived.';
    chartFrom();
    // Open on the first region to answer.
    const [fl, fo] = toLatLon(VECS[first]);
    const firstKm = boundKm(rtt[first]);
    tweenView({ lat: fl, lon: fo, zoom: Math.max(1, Math.min(3, (0.745 * EARTH_KM) / Math.max(firstKm, 500))) }, 1.2);
    clock.hidden = false;
    if (reduced) {
      finish();
      return;
    }
    animate('grow', (t) => {
      const u = Math.min(1, Math.max(0, t - 0.6) / REPLAY_S);
      scene.grow = end * u ** 1.6;
      clockT.textContent = scene.grow.toFixed(1);
      clockD.textContent = NUMBER.format(Math.round(scene.grow * KM_PER_RTT_MS));
      if (u >= 1) {
        finish();
        return false;
      }
      return true;
    });
  }

  function finish(): void {
    if (!sol) return;
    mode = 'done';
    root.dataset.state = mode;
    scene.grow = Infinity;
    clock.hidden = true;
    setButtons(false);
    fade('tint', 0, 0.9);
    fade('fog', 1, 0.9);
    fade('fit', 1, 1.1, 0.7);
    const [bl, bo] = toLatLon(sol.best);
    const patchKm = Math.sqrt(sol.feasibleKm2 / Math.PI);
    const frame = Math.max(patchKm * 0.85, sol.spreadKm * 2.2, 350);
    tweenView({ lat: bl, lon: bo, zoom: Math.max(1, Math.min(5, (0.745 * EARTH_KM) / frame)) }, 1.8);
    actions.hidden = false;
    locateBtn.hidden = source !== 'real';
    againBtn.textContent = source === 'real' ? 'Time them again' : 'Stand somewhere else';
    const where = describe(sol.best);
    const spread = NUMBER.format(roundTo(sol.spreadKm));
    const fit = sol.fit;
    const stretch = (fit.s * KM_PER_RTT_MS).toFixed(1);
    if (source === 'real') {
      const firstI = rtt.reduce((b, t, i) => (t > 0 && (b < 0 || t < rtt[b]) ? i : b), -1);
      lead.textContent = `Light puts you in the clear patch, ${area(sol.feasibleKm2)}. The replies line up best ${where}, give or take ${spread} km.`;
      detail.textContent = `${STATIONS[firstI].name} answered first, in ${fmtMs(rtt[firstI])}. About ${Math.round(fit.a)} ms of each reply was spent at your end; past that, replies took ${stretch} times as long as light in glass on a straight line.`;
    } else if (truth) {
      const err = kmBetween(truth, sol.best);
      const [tl, to] = toLatLon(truth);
      const inside = sol.feasible[rowCol(sol, tl, to)] === 1;
      lead.textContent = `Light puts them in the clear patch, ${area(sol.feasibleKm2)}. The replies line up best ${where}; they were standing ${NUMBER.format(roundTo(err))} km from there.`;
      detail.textContent = `${inside ? 'They were inside the clear patch, as anyone must be: no reply outruns light.' : 'They were just outside the clear patch, where its edge is drawn coarser than the globe.'} The fit put ${Math.round(fit.a)} ms at their end; the made-up routes ran 1.35 to 2.25 times longer than straight lines, now and then with a long detour.`;
      truthEl.hidden = false;
      truthEl.querySelector('span')!.textContent = 'They stood here';
    }
    STATIONS.forEach((_, i) => setLedger(i));
    chartFrom();
    dirty = true;
  }

  function rowCol(s: Solution, lat: number, lon: number): number {
    const r = Math.min(s.rows - 1, Math.max(0, Math.floor((90 - lat) / s.step)));
    const c = Math.min(s.cols - 1, Math.max(0, Math.floor((lon + 180) / s.step)));
    return r * s.cols + c;
  }

  // ---------- Checking against the visitor's own position ----------

  function locate(): void {
    if (!sol || !('geolocation' in navigator)) return;
    locateBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!sol) return;
        truth = toVec(pos.coords.latitude, pos.coords.longitude);
        located = true;
        const err = kmBetween(truth, sol.best);
        const inside = sol.feasible[rowCol(sol, pos.coords.latitude, pos.coords.longitude)] === 1;
        truthEl.hidden = false;
        truthEl.querySelector('span')!.textContent = 'You';
        detail.textContent = `Your browser puts you ${NUMBER.format(roundTo(err))} km from the best fit${
          inside
            ? ', inside the clear patch.'
            : ', outside the clear patch, which usually means your connection starts somewhere else, such as a VPN or a company network.'
        } Your position stays on this page.`;
        probe = truth;
        chartFrom();
        dirty = true;
      },
      () => {
        locateBtn.disabled = false;
        detail.textContent = 'Your browser kept your position to itself, which is fair.';
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  }

  goBtn.addEventListener('click', () => void timeReplies());
  againBtn.addEventListener('click', () => (source === 'real' ? void timeReplies() : choose()));
  pretendBtn.addEventListener('click', choose);
  locateBtn.addEventListener('click', locate);

  // ---------- Pointer: drag to turn, click to choose, hover to probe ----------

  let drag: { id: number; x: number; y: number; moved: number } | null = null;
  const local = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  stage.addEventListener('pointerdown', (e) => {
    if (!globe || e.button > 0) return;
    drag = { id: e.pointerId, ...local(e), moved: 0 };
    stage.setPointerCapture(e.pointerId);
    drifting = false;
    anims.delete('view');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!globe) return;
    const p = local(e);
    if (drag && drag.id === e.pointerId) {
      const dx = p.x - drag.x;
      const dy = p.y - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 4) stage.classList.add('dragging');
      const k = (180 / Math.PI / globe.radius) * 1;
      globe.setView({ lat: globe.view.lat + dy * k, lon: globe.view.lon - dx * k, zoom: globe.view.zoom });
      drag.x = p.x;
      drag.y = p.y;
      dirty = true;
      return;
    }
    if (mode === 'done' && e.pointerType === 'mouse' && !located) {
      probe = globe.unproject(p.x, p.y);
      chartFrom();
      dirty = true;
    }
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    const wasTap = drag.moved <= 4;
    drag = null;
    stage.classList.remove('dragging');
    if (wasTap && globe) {
      const p = local(e);
      const v = globe.unproject(p.x, p.y);
      if (v && mode === 'choose') pretendAt(v);
    }
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', () => {
    if (mode === 'done' && !located && probe) {
      probe = null;
      chartFrom();
      dirty = true;
    }
  });
  stage.addEventListener('dblclick', (e) => {
    if (!globe) return;
    const p = local(e as unknown as PointerEvent);
    const v = globe.unproject(p.x, p.y);
    if (!v) return;
    const [lat, lon] = toLatLon(v);
    tweenView({ lat, lon, zoom: Math.min(8, globe.view.zoom * 2) }, 0.7);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!globe) return;
      const z = globe.view.zoom * (b.dataset.zoom === 'in' ? 1.6 : 1 / 1.6);
      tweenView({ ...globe.view, zoom: Math.max(0.8, Math.min(8, z)) }, 0.45);
    }),
  );

  // ---------- Frame loop ----------

  const placeLabels = () => {
    if (!globe) return;
    const boxes: [number, number, number, number][] = [];
    const order = STATIONS.map((_, i) => i).sort((a, b) => {
      if (a === scene.hot) return -1;
      if (b === scene.hot) return 1;
      const ta = rtt[a] || 1e9;
      const tb = rtt[b] || 1e9;
      return ta - tb || a - b;
    });
    const { w, h } = globe.size;
    const proj = VECS.map((v) => globe!.project(v));
    // Every dot keeps a small clearing, so no label lands on another region, and so do the markers.
    for (const p of proj) if (p.z > 0.12) boxes.push([p.x - 4, p.y - 4, 8, 8]);
    const keepClear = (v: Vec3 | null, wide: number) => {
      if (!v) return;
      const p = globe!.project(v);
      if (p.z > 0) boxes.push([p.x - 12, p.y - 12, wide, 34]);
    };
    if (sol && mode === 'done') {
      const p = globe.project(sol.best);
      if (p.z > 0) boxes.push([p.x - 72, p.y - 24, 84, 36]);
    }
    if (truth && !truthEl.hidden) keepClear(truth, 120);
    for (const i of order) {
      const { span, em } = labels[i];
      const p = proj[i];
      const stopped = rtt[i] > 0 && (mode === 'done' || (mode === 'replay' && scene.grow >= rtt[i]));
      em.textContent = stopped ? fmtMs(rtt[i]) : '';
      const width = STATIONS[i].name.length * 7.4 + (stopped ? 46 : 0);
      // Right of the dot if there's room, else left, above, or below.
      const spots: [number, number][] = [
        [p.x + 7, p.y - 6],
        [p.x - 7 - width, p.y - 6],
        [p.x - width / 2, p.y - 21],
        [p.x - width / 2, p.y + 8],
      ];
      const free = (x: number, y: number) =>
        !boxes.some(([bx, by, bw, bh]) => x < bx + bw && bx < x + width && y < by + bh && by < y + 13);
      const inFrame = (x: number, y: number) => x > 2 && x + width < w - 2 && y > 2 && y + 14 < h - 2;
      const spot = spots.find(([x, y]) => inFrame(x, y) && free(x, y)) ?? (i === scene.hot ? spots[0] : null);
      const show = !!spot && p.z > 0.12 && p.x > -20 && p.x < w + 20 && p.y > -10 && p.y < h + 10;
      span.style.opacity = show ? (p.z < 0.3 ? String((p.z - 0.12) / 0.18) : '1') : '0';
      if (spot) {
        span.style.setProperty('--x', `${spot[0].toFixed(1)}px`);
        span.style.setProperty('--y', `${(spot[1] - 6).toFixed(1)}px`);
      }
      if (show && spot) boxes.push([spot[0] - 2, spot[1] - 2, width + 4, 16]);
    }
    const put = (el: HTMLElement, v: Vec3 | null) => {
      if (!v) return;
      const p = globe!.project(v);
      el.style.setProperty('--x', `${p.x.toFixed(1)}px`);
      el.style.setProperty('--y', `${p.y.toFixed(1)}px`);
      el.style.opacity = p.z > 0 ? '1' : '0';
    };
    put(truthEl, truth);
    bestEl.hidden = !(sol && mode === 'done');
    put(bestEl, sol ? sol.best : null);
    probeEl.hidden = !(probe && mode === 'done' && !located);
    put(probeEl, probe);
  };

  if (globe) {
    const ro = new ResizeObserver(() => {
      if (globe!.resize()) dirty = true;
    });
    ro.observe(stage);
    globe.resize();
  }

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (drifting && globe) {
      globe.setView({ ...globe.view, lon: globe.view.lon - dt * 3 });
      dirty = true;
    }
    for (const [key, a] of anims) {
      if (!a.fn((now - a.t0) / 1000)) anims.delete(key);
      dirty = true;
    }
    if (dirty && globe) {
      globe.render(scene, SIGMA);
      placeLabels();
      dirty = false;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  chartFrom();
  root.dataset.ready = '1';
}
