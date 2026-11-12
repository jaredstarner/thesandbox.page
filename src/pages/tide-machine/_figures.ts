// The essay's three working figures: one wheel you can set by hand, the moon's and sun's wheels over a
// month, and four wheels set for three harbours. Each is a small Machine running while it is on screen.

import { el, Machine, type Layout, type WheelState } from './_machine';
import { NAMES, PORTS } from './_ports';
import { elongation, height, wheels, type Station, type Wheel } from './_tides';

const HOUR = 3600000;
const RAD = Math.PI / 180;
const M2_SPEED = 28.984104;

function station(id: string, names: string[]): Station {
  const p = PORTS.find((x) => x.id === id) ?? PORTS[0];
  return {
    z0: 0,
    harmonics: p.h
      .map(([amp, phase, speed], i) => ({ name: NAMES[i] as string, amp, phase, speed }))
      .filter((h) => names.includes(h.name)),
  };
}

/** Runs `tick` every frame while `target` is on screen. */
function whileVisible(target: Element, tick: (dt: number) => void): void {
  let raf = 0;
  let last = 0;
  const loop = (now: number) => {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (!document.hidden) tick(dt);
    raf = requestAnimationFrame(loop);
  };
  new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && !raf) {
        last = 0;
        raf = requestAnimationFrame(loop);
      } else if (!entry.isIntersecting && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: '60px' },
  ).observe(target);
}

/** A label with a leader line; the function it returns re-points the line at a moving part. */
function callout(svg: SVGSVGElement, text: string, tx: number, ty: number, x: number, y: number) {
  const g = el('g', { class: 'tm-callout' }, svg);
  const line = el('path', { stroke: '#a88e5c', 'stroke-width': 1, fill: 'none' }, g);
  const dot = el('circle', { r: 2.6, fill: '#e3c88a' }, g);
  const t = el('text', { x: tx, y: ty, 'text-anchor': 'end', class: 'tm-note', fill: '#cdbf9f', 'font-size': 18 }, g);
  t.textContent = text;
  const move = (px: number, py: number) => {
    line.setAttribute('d', `M${tx + 8} ${ty - 6}L${(tx + 8 + px) / 2 + 10} ${ty - 6}L${px.toFixed(1)} ${py.toFixed(1)}`);
    dot.setAttribute('cx', px.toFixed(1));
    dot.setAttribute('cy', py.toFixed(1));
  };
  move(x, y);
  return move;
}

/** Fig. 1: one wheel. Drag the pin to set its radius and its starting angle. */
export function figOne(svg: SVGSVGElement): void {
  const layout: Layout = {
    width: 1000,
    height: 520,
    gearR: 84,
    upperY: 128,
    lowerY: 0,
    reach: 160,
    pulleyR: 22,
    units: [{ name: 'M2', row: 'upper', x: 640 }],
    anchor: { x: 560, y: 352 },
    guide: { x: 872, y: 278, r: 12 },
    paper: { x0: 30, x1: 970, y0: 376, y1: 504 },
    hours: 30,
    tags: false,
  };
  const m = new Machine(svg, layout);
  const pinMax = layout.gearR * 0.86;
  m.setScale(-1.15, 1.15, 0.5, '', 1);
  let amp = 0.8;
  let phase = 40;
  let t = Date.UTC(2026, 0, 1);
  let dragging = false;
  const state: WheelState[] = [{ pin: amp * pinMax, angle: 0, engaged: true }];
  const angle = () => M2_SPEED * (t / HOUR) + phase;
  const cx = 640;
  const R = layout.gearR;

  callout(svg, 'Wheel', 470, 58, cx - R * 0.62, layout.upperY - R * 0.62);
  const toPin = callout(svg, 'Pin: drag it', 470, 108, cx, layout.upperY);
  const toFrame = callout(svg, 'Sliding frame', 470, 168, cx - R, layout.upperY);
  const toPulley = callout(svg, 'Pulley', 470, 262, cx - 22, 288);
  callout(svg, 'Chain', 470, 330, 590, 330);
  const penX = layout.guide.x + layout.guide.r;
  const penLabel = el('text', { x: penX + 30, y: 360, class: 'tm-note', fill: '#cdbf9f', 'font-size': 18 }, svg);
  penLabel.textContent = 'Pen';

  const pts: [number, number][] = [];
  for (let ms = t - 31 * HOUR; ms <= t; ms += 6 * 60000) {
    pts.push([ms, amp * Math.cos((M2_SPEED * (ms / HOUR) + phase) * RAD)]);
  }
  m.fill(pts);

  const draw = () => {
    state[0].pin = amp * pinMax;
    state[0].angle = angle();
    m.frame(t, state, amp * Math.cos(angle() * RAD));
    const u = m.unitState('M2');
    if (u) {
      toPin(u.pinX, u.pinY);
      toFrame(cx - R * 1.02, layout.upperY + u.dy);
      toPulley(cx - layout.pulleyR * 0.75, u.pulleyY + layout.pulleyR * 0.65);
    }
  };

  const center = m.unitCenter('M2')!;
  const setFrom = (e: PointerEvent) => {
    const p = m.toLocal(e.clientX, e.clientY);
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    amp = Math.min(1, Math.hypot(dx, dy) / pinMax);
    phase = Math.atan2(dx, -dy) / RAD - M2_SPEED * (t / HOUR);
  };
  svg.addEventListener('pointerdown', (e) => {
    const p = m.toLocal(e.clientX, e.clientY);
    if (Math.hypot(p.x - center.x, p.y - center.y) > layout.gearR * 1.25) return;
    e.preventDefault();
    dragging = true;
    svg.classList.add('dragging');
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't be captured */
    }
    setFrom(e);
    draw();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    setFrom(e);
    draw();
  });
  const end = () => {
    dragging = false;
    svg.classList.remove('dragging');
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  draw();
  whileVisible(svg, (dt) => {
    if (!dragging) t += dt * 2 * HOUR;
    draw();
  });
}

/** Shared driver for the figures that run real constituents. */
class Figure {
  readonly m: Machine;
  station: Station;
  t: number;
  private model: Wheel[] = [];
  readonly shown: WheelState[] = [];
  engaged: boolean[];
  pinScale = 1;
  private pinNow: number[] = [];
  private offsets: number[] = [];

  constructor(svg: SVGSVGElement, layout: Layout, st: Station, t: number) {
    this.m = new Machine(svg, layout);
    this.station = st;
    this.t = t;
    this.engaged = layout.units.map(() => true);
  }

  /** The wheels in the layout's order; `station` may list them in any order. */
  private target(): { pin: number; angle: number }[] {
    this.model = wheels(this.station, this.t, this.model);
    return this.m.layout.units.map((u) => {
      const w = this.model.find((x) => x.name === u.name);
      return { pin: (w?.amp ?? 0) * this.pinScale, angle: w?.angle ?? 0 };
    });
  }

  enabled = (name: string): boolean => {
    const i = this.m.layout.units.findIndex((u) => u.name === name);
    return i < 0 || this.engaged[i];
  };

  /** Set to a new harbour: wheels keep their place and settle to the new settings. */
  reset(st: Station, prefillHours: number): void {
    const before = this.target();
    this.station = st;
    const maxAmp = Math.max(...st.harmonics.map((h) => h.amp));
    this.pinScale = (this.m.layout.gearR * 0.8) / (maxAmp * 1.05);
    const after = this.target();
    after.forEach((w, i) => {
      const shown = this.shown[i];
      let d = ((shown ? shown.angle : w.angle) - w.angle) % 360;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      this.offsets[i] = shown ? d : 0;
      this.pinNow[i] = shown ? shown.pin : w.pin;
    });
    void before;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 24 * 32; k++) {
      const h = height(st, this.t - k * HOUR);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    const pad = (hi - lo) * 0.06;
    this.m.setScale(lo - pad, hi + pad, 1, '', 1);
    const pts: [number, number][] = [];
    for (let ms = this.t - (prefillHours + 1) * HOUR; ms <= this.t; ms += 10 * 60000) {
      pts.push([ms, height(st, ms, this.enabled)]);
    }
    this.m.fill(pts);
  }

  draw(dt: number): void {
    const target = this.target();
    const k = 1 - Math.exp(-Math.max(dt, 1 / 60) * 7);
    let h = this.station.z0;
    target.forEach((w, i) => {
      const goal = this.engaged[i] ? w.pin : 0;
      const p = this.pinNow[i] ?? goal;
      this.pinNow[i] = Math.abs(goal - p) < 0.05 ? goal : p + (goal - p) * k;
      const off = this.offsets[i] ?? 0;
      this.offsets[i] = Math.abs(off) < 0.05 ? 0 : off * (1 - k);
      const s = this.shown[i] ?? (this.shown[i] = { pin: 0, angle: 0, engaged: true });
      s.pin = this.pinNow[i];
      s.angle = w.angle + this.offsets[i];
      s.engaged = this.engaged[i];
      h += (s.pin / this.pinScale) * Math.cos(s.angle * RAD);
    });
    this.m.frame(this.t, this.shown, h);
  }
}

const PHASES = [
  'New moon',
  'Waxing crescent',
  'First quarter',
  'Waxing gibbous',
  'Full moon',
  'Waning gibbous',
  'Last quarter',
  'Waning crescent',
];

function moonPath(cx: number, cy: number, r: number, e: number): string {
  const rx = r * Math.abs(Math.cos(e * RAD));
  if (e < 180) {
    // Lit on the right.
    const sweep = e < 90 ? 0 : 1;
    return `M${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx} ${cy + r}A${rx.toFixed(2)} ${r} 0 0 ${sweep} ${cx} ${cy - r}Z`;
  }
  const sweep = e > 270 ? 1 : 0;
  return `M${cx} ${cy - r}A${r} ${r} 0 0 0 ${cx} ${cy + r}A${rx.toFixed(2)} ${r} 0 0 ${sweep} ${cx} ${cy - r}Z`;
}

/** Times within [from, to] when the moon passes new, first quarter, full, and last quarter. */
function quarters(from: number, to: number): { ms: number; q: number }[] {
  const out: { ms: number; q: number }[] = [];
  const step = 6 * HOUR;
  let prev = elongation(from);
  for (let t = from + step; t <= to; t += step) {
    const e = elongation(t);
    for (let q = 0; q < 4; q++) {
      const target = q * 90;
      const a = (prev - target + 360) % 360;
      const b = (e - target + 360) % 360;
      if (a > 300 && b < 60) {
        let lo = t - step;
        let hi = t;
        for (let k = 0; k < 16; k++) {
          const mid = (lo + hi) / 2;
          const c = (elongation(mid) - target + 360) % 360;
          if (c > 180) lo = mid;
          else hi = mid;
        }
        out.push({ ms: (lo + hi) / 2, q });
      }
    }
    prev = e;
  }
  return out;
}

/** Fig. 2: the moon's wheel and the sun's, over a month. */
export function figTwo(svg: SVGSVGElement, sunBtn: HTMLButtonElement | null): void {
  const layout: Layout = {
    width: 1000,
    height: 640,
    gearR: 40,
    upperY: 96,
    lowerY: 386,
    reach: 120,
    pulleyR: 16,
    units: [
      { name: 'M2', row: 'upper', x: 540 },
      { name: 'S2', row: 'lower', x: 620 },
    ],
    anchor: { x: 486, y: 282 },
    guide: { x: 930, y: 212, r: 12 },
    paper: { x0: 30, x1: 975, y0: 474, y1: 624 },
    hours: 720,
  };
  const start = Date.UTC(2026, 10, 12, 12);
  const fig = new Figure(svg, layout, station('9410170', ['M2', 'S2']), start);
  fig.m.setTime(
    (ms) => {
      const d = new Date(ms);
      return Math.floor(ms / 86400000) % 7 === 0
        ? `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`
        : '';
    },
    (ms) => ((((ms - 8 * HOUR) / HOUR) % 24) + 24) % 24,
  );
  fig.reset(fig.station, 720);

  const note = (x: number, y: number, size: number, cls = 'tm-note', anchor = 'start') =>
    el('text', { x, y, class: cls, fill: '#cdbf9f', 'font-size': size, 'text-anchor': anchor }, svg);
  const n1 = note(574, 46, 17);
  n1.textContent = 'the moon, 12 h 25 min';
  const n2 = note(654, 445, 17);
  n2.textContent = 'the sun, 12 h';

  // A moon showing its phase, and the date.
  const mx = 170;
  const my = 176;
  const mr = 70;
  el('circle', { cx: mx, cy: my, r: mr + 10, fill: 'rgb(255 240 200 / 0.05)' }, svg);
  el('circle', { cx: mx, cy: my, r: mr, fill: '#26313a', stroke: '#3a4752', 'stroke-width': 1 }, svg);
  const lit = el('path', { fill: '#ece2c6' }, svg);
  const phaseText = note(mx, my + mr + 40, 21, 'tm-note-big', 'middle');
  const dateText = note(mx, my + mr + 66, 16, 'tm-note', 'middle');
  const springText = note(mx, my + mr + 92, 16, 'tm-note-em', 'middle');

  const marks = fig.m.overlay;
  const markPool: SVGGElement[] = [];
  const drawMarks = () => {
    const qs = quarters(fig.t - 722 * HOUR, fig.t);
    qs.forEach((q, i) => {
      let g = markPool[i];
      if (!g) {
        g = el('g', {}, marks);
        markPool.push(g);
      }
      const x = fig.m.xAt(q.ms, fig.t);
      const y = layout.paper.y0 + 14;
      g.replaceChildren();
      el('circle', { cx: x, cy: y, r: 6, fill: q.q === 0 ? '#3b3a33' : '#efe8d6', stroke: '#3b3a33', 'stroke-width': 1.2 }, g);
      if (q.q === 1 || q.q === 3) {
        el('path', { d: moonPath(x, y, 6, q.q === 1 ? 90 : 270), fill: '#3b3a33' }, g);
      }
      g.removeAttribute('display');
    });
    for (let i = qs.length; i < markPool.length; i++) markPool[i].setAttribute('display', 'none');
  };

  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const update = (dt: number) => {
    fig.draw(dt);
    const e = elongation(fig.t);
    lit.setAttribute('d', moonPath(mx, my, mr, e));
    phaseText.textContent = PHASES[Math.round(e / 45) % 8];
    dateText.textContent = fmt.format(fig.t);
    // Springs follow new and full moon by a day or two; call it from the phase.
    const fromSyzygy = Math.min(e % 180, 180 - (e % 180));
    springText.textContent = !fig.engaged[1] ? '' : fromSyzygy < 35 ? 'Spring tides' : fromSyzygy > 55 ? 'Neap tides' : '';
    drawMarks();
  };

  sunBtn?.addEventListener('click', () => {
    fig.engaged[1] = !fig.engaged[1];
    sunBtn.setAttribute('aria-pressed', String(fig.engaged[1]));
    sunBtn.textContent = fig.engaged[1] ? "Sun's wheel in gear" : "Sun's wheel out of gear";
  });

  update(0);
  whileVisible(svg, (dt) => {
    fig.t += dt * 24 * HOUR;
    update(dt);
  });
}

const KINDS: Record<string, [string, string]> = {
  '8443970': ['Boston', 'Two tides a day, nearly equal'],
  '9447130': ['Seattle', 'Two tides a day, one much higher'],
  '8729840': ['Pensacola', 'One tide a day'],
};

/** Fig. 3: four wheels set for three harbours. */
export function figFour(svg: SVGSVGElement, radios: NodeListOf<HTMLInputElement>): void {
  const layout: Layout = {
    width: 1000,
    height: 610,
    gearR: 36,
    upperY: 92,
    lowerY: 382,
    reach: 120,
    pulleyR: 15,
    units: [
      { name: 'K1', row: 'upper', x: 580 },
      { name: 'O1', row: 'lower', x: 650 },
      { name: 'S2', row: 'upper', x: 720 },
      { name: 'M2', row: 'lower', x: 790 },
    ],
    anchor: { x: 530, y: 277 },
    guide: { x: 930, y: 209, r: 12 },
    paper: { x0: 30, x1: 975, y0: 456, y1: 594 },
    hours: 96,
  };
  const names = ['M2', 'S2', 'K1', 'O1'];
  const start = Date.UTC(2026, 10, 12, 17);
  const fig = new Figure(svg, layout, station('8443970', names), start);
  const title = el('text', { x: 40, y: 150, class: 'tm-note-title', fill: '#e8e1d1', 'font-size': 46 }, svg);
  const kind = el('text', { x: 40, y: 190, class: 'tm-note', fill: '#cdbf9f', 'font-size': 19 }, svg);
  const amps = el('g', { class: 'tm-amps' }, svg);

  let zone = 'America/New_York';
  const dayFmt = new Map<string, Intl.DateTimeFormat>();
  const fmtFor = (z: string) => {
    let f = dayFmt.get(z);
    if (!f) {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: z, weekday: 'short', day: 'numeric' });
      dayFmt.set(z, f);
    }
    return f;
  };
  const offsetH = (z: string, ms: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: z, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' })
      .formatToParts(ms)
      .reduce<Record<string, string>>((o, x) => ((o[x.type] = x.value), o), {});
    return (+p.hour % 24) + +p.minute / 60;
  };
  fig.m.setTime(
    (ms) => fmtFor(zone).format(ms).replace(',', ''),
    (ms) => offsetH(zone, ms),
  );

  const choose = (id: string) => {
    const port = PORTS.find((p) => p.id === id) ?? PORTS[0];
    zone = port.zone;
    fig.reset(station(id, names), 96);
    const [name, desc] = KINDS[id] ?? [port.name, ''];
    title.textContent = name;
    kind.textContent = desc;
    amps.replaceChildren();
    // Pin settings as a small table: each wheel's amplitude for this harbour.
    names.forEach((n, i) => {
      const h = fig.station.harmonics.find((x) => x.name === n);
      const y = 250 + i * 34;
      const label = el('text', { x: 40, y, class: 'tm-tag', fill: '#d9bd7f', 'font-size': 16 }, amps);
      label.textContent = n;
      const w = Math.max(2, (h?.amp ?? 0) * 230);
      el('rect', { x: 92, y: y - 13, width: w, height: 14, rx: 2, fill: '#b68a3e' }, amps);
      const v = el('text', { x: 100 + w, y, class: 'tm-note', fill: '#a9a597', 'font-size': 15 }, amps);
      v.textContent = `${((h?.amp ?? 0) * 3.28084).toFixed(1)} ft`;
    });
  };
  radios.forEach((r) =>
    r.addEventListener('change', () => {
      if (r.checked) choose(r.value);
    }),
  );
  choose([...radios].find((r) => r.checked)?.value ?? '8443970');
  fig.draw(0);
  whileVisible(svg, (dt) => {
    fig.t += dt * 4 * HOUR;
    fig.draw(dt);
  });
}
