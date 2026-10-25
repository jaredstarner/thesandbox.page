// /seeing-things/: wires each figure's controls, checks the measured ones, and
// keeps the visitor's readings. Figures are drawn by _figures.ts at build time;
// this redraws only the part a control moves.

import {
  BUSES,
  FINS,
  finsAdjustable,
  finsTruth,
  gridBars,
  HALO,
  haloAdjustable,
  haloTruth,
  mortarRows,
  mortarTruth,
  stripesAdjustable,
  STRIPES,
  TABLES,
  tablesAdjustable,
  tablesTruth,
} from './_figures';

type MeasureId = 'fins' | 'tables' | 'mortar' | 'halo' | 'stripes';

interface Reading {
  /** The sentence after a check: before the figure, the figure, after it. */
  say: [string, string, string];
  /** The short form for the readings table. */
  short: string;
  /** Signed error scaled to about -1..1 for the readings bar. */
  bar: number;
}

interface Measure {
  adjust: (v: number) => string;
  truth: (v: number) => string;
  read: (v: number) => Reading;
  fresh: () => number;
  /** Labels for the context button while the context is hidden and shown. */
  context: [string, string];
}

const pct = (e: number) => `${(Math.abs(e) * 100).toFixed(Math.abs(e) < 0.1 ? 1 : 0)}%`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const away = (lo: number, hi: number) => (Math.random() < 0.5 ? -1 : 1) * (lo + Math.random() * (hi - lo));

const MEASURES: Record<MeasureId, Measure> = {
  fins: {
    adjust: finsAdjustable,
    truth: finsTruth,
    read: (v) => {
      const e = (v - FINS.len) / FINS.len;
      if (Math.abs(e) < 0.005) return { say: ['', 'Spot on', ': the two lines match.'], short: 'Spot on', bar: 0 };
      const way = e < 0 ? 'shorter' : 'longer';
      return {
        say: ['You made it ', pct(e), ` ${way} than the top line.`],
        short: `${pct(e)} ${e < 0 ? 'short' : 'long'}`,
        bar: e / 0.25,
      };
    },
    fresh: () => Math.round(clamp(FINS.len * (1 + away(0.1, 0.24)), 220, 500)),
    context: ['Show the fins', 'Hide the fins'],
  },
  tables: {
    adjust: tablesAdjustable,
    truth: tablesTruth,
    read: (v) => {
      const e = (v - TABLES.long) / TABLES.long;
      if (Math.abs(e) < 0.005) return { say: ['', 'Spot on', ': the tops match.'], short: 'Spot on', bar: 0 };
      const way = e < 0 ? 'shorter' : 'longer';
      return {
        say: ['You made it ', pct(e), ` ${way} than the left top.`],
        short: `${pct(e)} ${e < 0 ? 'short' : 'long'}`,
        bar: e / 0.3,
      };
    },
    fresh: () => Math.round(clamp(TABLES.long * (1 + away(0.12, 0.3)), 150, 380)),
    context: ['Show the legs', 'Hide the legs'],
  },
  mortar: {
    adjust: mortarRows,
    truth: () => mortarTruth(),
    read: (v) => {
      const deg = Math.abs(v);
      if (deg < 0.05) return { say: ['', 'Level', ': you saw them true.'], short: 'Level', bar: 0 };
      return {
        say: ['You tilted the lines ', `${deg.toFixed(1)}°`, ' to make them look level.'],
        short: `${deg.toFixed(1)}° tilt`,
        bar: v / 3,
      };
    },
    fresh: () => Math.round(away(1, 2.6) * 20) / 20,
    context: ['Show the tiles', 'Hide the tiles'],
  },
  halo: {
    adjust: haloAdjustable,
    truth: () => haloTruth(),
    read: (v) => {
      const e = (v - HALO.r) / HALO.r;
      if (Math.abs(e) < 0.01) return { say: ['', 'Spot on', ': the discs match.'], short: 'Spot on', bar: 0 };
      const way = e < 0 ? 'smaller' : 'larger';
      return {
        say: ['You made it ', pct(e), ` ${way} across than the left disc.`],
        short: `${pct(e)} ${way}`,
        bar: e / 0.35,
      };
    },
    fresh: () => Math.round(clamp(HALO.r * (1 + away(0.15, 0.35)), 20, 56) * 4) / 4,
    context: ['Show the rings', 'Hide the rings'],
  },
  stripes: {
    adjust: stripesAdjustable,
    truth: () => '',
    read: (v) => {
      const d = (v - STRIPES.grey) / 255;
      if (Math.abs(d) < 0.005) return { say: ['', 'Spot on', ': the greys match.'], short: 'Spot on', bar: 0 };
      const way = d < 0 ? 'darker' : 'lighter';
      return {
        say: ['Your grey was ', pct(d), ` ${way} than the left one.`],
        short: `${pct(d)} ${way}`,
        bar: d / 0.15,
      };
    },
    fresh: () => Math.round(clamp(STRIPES.grey + away(16, 44), 70, 190)),
    context: ['Show the stripes', 'Hide the stripes'],
  },
};

const root = document.querySelector<HTMLElement>('[data-seeing]');
if (root) start(root);

function start(root: HTMLElement) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = readStore();
  const last = { ...store };
  const now: Partial<Record<MeasureId, number>> = {};

  const plate = (id: string) => root.querySelector<HTMLElement>(`[data-plate="${id}"]`)!;
  const svgOf = (p: HTMLElement) => p.querySelector<SVGSVGElement>('[data-svg]')!;
  const inputOf = (p: HTMLElement) => p.querySelector<HTMLInputElement>('[data-input]')!;

  /* ---------------------------------------------------- measured figures */

  for (const id of Object.keys(MEASURES) as MeasureId[]) {
    const m = MEASURES[id];
    const p = plate(id);
    const svg = svgOf(p);
    const input = inputOf(p);
    const adj = svg.querySelector<SVGGElement>('[data-adj]')!;
    const truth = svg.querySelector<SVGGElement>('[data-truth]');
    const check = p.querySelector<HTMLButtonElement>('[data-check]')!;
    const again = p.querySelector<HTMLButtonElement>('[data-again]')!;
    const ctx = p.querySelector<HTMLButtonElement>('[data-context]')!;
    const result = p.querySelector<HTMLElement>('[data-result]')!;
    const note = p.querySelector<HTMLElement>('[data-note]')!;

    const draw = () => {
      adj.innerHTML = m.adjust(Number(input.value));
    };
    input.addEventListener('input', draw);

    check.addEventListener('click', () => {
      const v = Number(input.value);
      const r = m.read(v);
      input.disabled = true;
      p.dataset.state = 'checked';
      p.dataset.context = 'off';
      if (truth) truth.innerHTML = m.truth(v);
      result.replaceChildren(r.say[0], Object.assign(document.createElement('b'), { textContent: r.say[1] }), r.say[2]);
      note.hidden = false;
      check.hidden = true;
      again.hidden = false;
      ctx.hidden = false;
      ctx.textContent = m.context[0];
      now[id] = v;
      store[id] = v;
      writeStore(store);
      updateReadings();
      again.focus({ preventScroll: true });
    });

    ctx.addEventListener('click', () => {
      const off = p.dataset.context !== 'off';
      p.dataset.context = off ? 'off' : 'on';
      ctx.textContent = m.context[off ? 0 : 1];
    });

    again.addEventListener('click', () => {
      input.value = String(m.fresh());
      input.disabled = false;
      p.dataset.state = 'set';
      delete p.dataset.context;
      if (truth) truth.replaceChildren();
      result.replaceChildren();
      note.hidden = true;
      check.hidden = false;
      again.hidden = true;
      ctx.hidden = true;
      draw();
      input.focus({ preventScroll: true });
    });
  }

  /* ---------------------------------------------------- readings */

  const lede = root.querySelector<HTMLElement>('[data-readings-lede]')!;
  function updateReadings() {
    let count = 0;
    for (const id of Object.keys(MEASURES) as MeasureId[]) {
      const row = root.querySelector<HTMLElement>(`[data-reading="${id}"]`)!;
      const nowCell = row.querySelector<HTMLElement>('[data-now]')!;
      const bar = row.querySelector<HTMLElement>('[data-bar]')!;
      const lastCell = row.querySelector<HTMLElement>('[data-last]')!;
      const v = now[id];
      if (v !== undefined) {
        count++;
        const r = MEASURES[id].read(v);
        nowCell.textContent = r.short;
        const f = clamp(r.bar, -1, 1);
        bar.style.setProperty('--left', `${50 + Math.min(f, 0) * 50}%`);
        bar.style.setProperty('--width', `${Math.abs(f) * 50}%`);
      } else {
        nowCell.textContent = 'Not set';
        bar.style.removeProperty('--left');
        bar.style.removeProperty('--width');
      }
      const before = last[id];
      lastCell.textContent = before !== undefined ? MEASURES[id].read(before).short : '—';
      root.querySelector(`[data-rail="${id}"]`)?.toggleAttribute('data-done', v !== undefined);
    }
    lede.textContent =
      count === 5
        ? 'All five set. The bar runs from the truth at the red line to where you put it, out to the edge of the scale.'
        : count
          ? `${count} of 5 set. Zero is the truth; the bar shows which way you went.`
          : 'Set the five measured figures and your readings collect here. Zero is the truth.';
  }
  updateReadings();

  /* ---------------------------------------------------- watched figures */

  // Grid: bend the bars.
  {
    const p = plate('grid');
    const adj = svgOf(p).querySelector<SVGGElement>('[data-adj]')!;
    const input = inputOf(p);
    input.addEventListener('input', () => {
      adj.innerHTML = gridBars(Number(input.value));
    });
  }

  // Buses: two bars at one steady speed, and the stripes' contrast.
  const busPlate = plate('buses');
  const buses = [...busPlate.querySelectorAll<SVGRectElement>('[data-bus]')];
  const speed = BUSES.stripe * 2 * 0.9;
  const span = 800 + BUSES.len * 2;
  let busX = 0;
  let busFrame = 0;
  let busThen = 0;
  const busLoop = () => {
    if (!busPlate.hasAttribute('data-run')) {
      cancelAnimationFrame(busFrame);
      busFrame = 0;
      return;
    }
    if (busFrame) return;
    busThen = performance.now();
    const step = (t: number) => {
      busX = (busX + (speed * Math.min(t - busThen, 100)) / 1000) % span;
      busThen = t;
      const x = busX - BUSES.len;
      for (const b of buses) b.setAttribute('x', x.toFixed(2));
      busFrame = requestAnimationFrame(step);
    };
    busFrame = requestAnimationFrame(step);
  };
  {
    const svg = svgOf(busPlate);
    const input = inputOf(busPlate);
    const mid = 128;
    input.addEventListener('input', () => {
      const c = Number(input.value);
      const lo = Math.round(mid + (15 - mid) * c);
      const hi = Math.round(mid + (251 - mid) * c);
      svg.style.setProperty('--bus-dark', `rgb(${lo},${lo},${lo})`);
      svg.style.setProperty('--bus-light', `rgb(${hi},${hi},${hi})`);
    });
  }

  // Motion figures run only while on screen and not paused.
  const playing = new Map<HTMLElement, boolean>();
  const live = new Set<HTMLElement>();
  const sync = (p: HTMLElement) => {
    p.toggleAttribute('data-run', live.has(p) && playing.get(p) === true);
    if (p.dataset.plate === 'buses') busLoop();
  };
  for (const p of root.querySelectorAll<HTMLElement>('[data-motion]')) {
    const btn = p.querySelector<HTMLButtonElement>('[data-play]')!;
    const set = (on: boolean) => {
      playing.set(p, on);
      btn.textContent = on ? 'Pause' : 'Play';
      btn.setAttribute('aria-pressed', String(on));
      sync(p);
    };
    set(!reduced);
    btn.addEventListener('click', () => set(!playing.get(p)));
  }
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const p = e.target as HTMLElement;
        if (e.isIntersecting) live.add(p);
        else live.delete(p);
        sync(p);
      }
    },
    { threshold: 0.2 },
  );
  for (const p of root.querySelectorAll<HTMLElement>('[data-motion]')) seen.observe(p);

  // Chaser: disc colour and blur.
  {
    const p = plate('chaser');
    const svg = svgOf(p);
    const blur = svg.querySelector('[data-blur]')!;
    const input = inputOf(p);
    input.addEventListener('input', () => blur.setAttribute('stdDeviation', input.value));
    for (const r of p.querySelectorAll<HTMLInputElement>('[data-colour]')) {
      r.addEventListener('change', () => svg.style.setProperty('--chase', r.value));
    }
  }

  // Spiral: turn for twenty seconds, then stop and let the after-effect run.
  {
    const p = plate('spiral');
    const svg = svgOf(p);
    const btn = p.querySelector<HTMLButtonElement>('[data-start]')!;
    const say = p.querySelector<HTMLElement>('[data-spiral-say]')!;
    const first = say.textContent ?? '';
    const SECONDS = 20;
    let timer = 0;
    let left = 0;
    const dir = () => p.querySelector<HTMLInputElement>('[data-dir]:checked')?.value ?? 'out';
    const stop = (done: boolean) => {
      clearInterval(timer);
      timer = 0;
      delete svg.dataset.spinning;
      btn.textContent = `Start · ${SECONDS} s`;
      say.textContent = done
        ? 'Keep looking at the dot. The still spiral seems to flow the other way. Then look at these words.'
        : first;
    };
    btn.addEventListener('click', () => {
      if (timer) return stop(false);
      left = SECONDS;
      svg.dataset.spinning = dir();
      say.textContent = 'Keep your eyes on the red dot.';
      btn.textContent = `Stop · ${left} s`;
      timer = window.setInterval(() => {
        left--;
        if (left <= 0) stop(true);
        else btn.textContent = `Stop · ${left} s`;
      }, 1000);
    });
    for (const r of p.querySelectorAll<HTMLInputElement>('[data-dir]')) {
      r.addEventListener('change', () => {
        if (svg.dataset.spinning) svg.dataset.spinning = dir();
      });
    }
  }

  // Drift: contrast, colour, and the order of the steps.
  {
    const p = plate('drift');
    const svg = svgOf(p);
    const input = inputOf(p);
    const greyBtn = p.querySelector<HTMLButtonElement>('[data-grey]')!;
    const revBtn = p.querySelector<HTMLButtonElement>('[data-reverse]')!;
    const ground = [143, 145, 121];
    const colour: [number, number, number][] = [
      [13, 12, 11],
      [42, 79, 208],
      [255, 255, 255],
      [241, 210, 48],
    ];
    const grey: [number, number, number][] = [
      [13, 12, 11],
      [84, 84, 84],
      [255, 255, 255],
      [196, 196, 196],
    ];
    let mono = false;
    let reversed = false;
    const paint = () => {
      const c = Number(input.value);
      const set = mono ? grey : colour;
      // Reversing swaps the wide steps, so black runs into light and white into dark.
      const order = reversed ? [0, 3, 2, 1] : [0, 1, 2, 3];
      order.forEach((from, slot) => {
        const rgb = set[from].map((v, i) => Math.round(ground[i] + (v - ground[i]) * c));
        svg.style.setProperty(`--d${slot}`, `rgb(${rgb.join(',')})`);
      });
    };
    input.addEventListener('input', paint);
    greyBtn.addEventListener('click', () => {
      mono = !mono;
      greyBtn.setAttribute('aria-pressed', String(mono));
      paint();
    });
    revBtn.addEventListener('click', () => {
      reversed = !reversed;
      revBtn.setAttribute('aria-pressed', String(reversed));
      paint();
    });
  }

  /* ---------------------------------------------------- rail */

  const railFor = (id: string) => root.querySelector<HTMLAnchorElement>(`[data-rail="${id}"]`);
  const sections = [...root.querySelectorAll<HTMLElement>('.plate, .readings')];
  const where = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = (e.target as HTMLElement).id;
        for (const a of root.querySelectorAll('[data-rail]')) a.removeAttribute('aria-current');
        railFor(id)?.setAttribute('aria-current', 'true');
      }
    },
    { rootMargin: '-45% 0px -45% 0px' },
  );
  for (const s of sections) where.observe(s);

  // The rail stays off the opener, where it would sit on the pattern.
  const opener = root.querySelector<HTMLElement>('.opener');
  if (opener) {
    new IntersectionObserver(([e]) => root.toggleAttribute('data-opener', e.intersectionRatio > 0.35), {
      threshold: [0, 0.35, 1],
    }).observe(opener);
  }
}

/* ---------------------------------------------------- storage */

const KEY = 'seeing-things:readings';

function readStore(): Partial<Record<MeasureId, number>> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const out: Partial<Record<MeasureId, number>> = {};
    for (const id of Object.keys(MEASURES) as MeasureId[]) {
      const v = raw[id];
      if (typeof v === 'number' && Number.isFinite(v)) out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(v: Partial<Record<MeasureId, number>>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Private windows can refuse storage; the readings still show for this visit.
  }
}
