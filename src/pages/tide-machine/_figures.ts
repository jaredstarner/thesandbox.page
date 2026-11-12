// The essay's three working figures: one wheel you can set by hand, the moon's and sun's wheels over a
// month, and four wheels set for three harbours. Each is a small Machine running while it is on screen,
// laid out narrower and with larger lettering on phones.

import { el, Machine, type Layout, type WheelState } from './_machine';
import { NAMES, PORTS } from './_ports';
import { elongation, height, wheels, type Station, type Wheel } from './_tides';

const HOUR = 3600000;
const RAD = Math.PI / 180;
const M2_SPEED = 28.984104;

/** Phones get their own figure layouts, so the lettering stays readable. */
function narrow(svg: SVGSVGElement): boolean {
  return (svg.parentElement?.clientWidth ?? svg.clientWidth) < 620;
}

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

function text(
  svg: SVGElement,
  x: number,
  y: number,
  size: number,
  content = '',
  cls = 'tm-note',
  anchor: 'start' | 'middle' | 'end' = 'start',
): SVGTextElement {
  const t = el('text', { x, y, class: cls, fill: '#cdbf9f', 'font-size': size, 'text-anchor': anchor }, svg);
  t.textContent = content;
  return t;
}

/** A label that follows a moving part, with a short leader to it. */
function tagAlong(svg: SVGSVGElement, label: string, size: number) {
  const g = el('g', { class: 'tm-callout' }, svg);
  const line = el('path', { stroke: '#a88e5c', 'stroke-width': 1, fill: 'none' }, g);
  const dot = el('circle', { r: 2.6, fill: '#e3c88a' }, g);
  const t = text(g, 0, 0, size, label);
  return (px: number, py: number, tx: number, ty: number, anchor: 'start' | 'end' = 'start') => {
    t.setAttribute('x', tx.toFixed(1));
    t.setAttribute('y', (ty + size * 0.34).toFixed(1));
    t.setAttribute('text-anchor', anchor);
    const lx = anchor === 'start' ? tx - 6 : tx + 6;
    line.setAttribute('d', `M${lx.toFixed(1)} ${ty.toFixed(1)}L${px.toFixed(1)} ${py.toFixed(1)}`);
    dot.setAttribute('cx', px.toFixed(1));
    dot.setAttribute('cy', py.toFixed(1));
  };
}

/** Fig. 1: one wheel. Drag the pin to set its radius and its starting angle. */
export function figOne(svg: SVGSVGElement): void {
  const phone = narrow(svg);
  const layout: Layout = phone
    ? {
        width: 600,
        height: 750,
        gearR: 96,
        upperY: 240,
        lowerY: 0,
        reach: 190,
        pulleyR: 24,
        units: [{ name: 'M2', row: 'upper', x: 330 }],
        anchor: { x: 250, y: 500 },
        guide: { x: 546, y: 416, r: 10 },
        paper: { x0: 18, x1: 586, y0: 548, y1: 734 },
        hours: 22,
        tags: false,
      }
    : {
        width: 1000,
        height: 540,
        gearR: 96,
        upperY: 130,
        lowerY: 0,
        reach: 176,
        pulleyR: 24,
        units: [{ name: 'M2', row: 'upper', x: 400 }],
        anchor: { x: 320, y: 372 },
        guide: { x: 872, y: 294, r: 12 },
        paper: { x0: 30, x1: 970, y0: 400, y1: 526 },
        hours: 30,
        tags: false,
      };
  const m = new Machine(svg, layout);
  const R = layout.gearR;
  const cx = layout.units[0].x;
  const cy = layout.upperY;
  const pinMax = R * 0.86;
  const fs = phone ? 25 : 18;
  m.setScale(-1.15, 1.15, 0.5, '', 1);
  let amp = 0.75;
  let phase = 40;
  let t = Date.UTC(2026, 0, 1);
  let dragging = false;
  const state: WheelState[] = [{ pin: amp * pinMax, angle: 0, engaged: true }];
  const angle = () => M2_SPEED * (t / HOUR) + phase;

  // Labels that ride with the parts they name.
  const wheelLabel = tagAlong(svg, 'Wheel', fs);
  const pinLabel = tagAlong(svg, 'Pin: drag it', fs);
  const frameLabel = tagAlong(svg, 'Sliding frame', fs);
  const pulleyLabel = tagAlong(svg, 'Pulley', fs);
  const penX = layout.guide.x + layout.guide.r;
  text(svg, penX - 14, layout.paper.y0 - 14, fs, 'Pen', 'tm-note', 'end');
  const chainMidX = (cx + layout.guide.x) / 2 + (phone ? 30 : 60);
  text(svg, chainMidX, layout.guide.y + (phone ? -44 : 40), fs, 'Chain', 'tm-note', 'middle');

  // The two settings, read off the wheel: across the top on phones, to the right on wider screens.
  const readX = phone ? 24 : 790;
  const readY = phone ? 34 : 70;
  const read2X = phone ? 300 : 790;
  const read2Y = phone ? 34 : 70 + fs * 3.2;
  text(svg, readX, readY, fs * 0.72, 'PIN OUT', 'tm-plate-dark');
  const readAmp = text(svg, readX, readY + fs * 1.5, fs * 1.5, '', 'tm-read');
  text(svg, read2X, read2Y, fs * 0.72, 'STARTED', 'tm-plate-dark');
  const readPhase = text(svg, read2X, read2Y + fs * 1.5, fs * 1.5, '', 'tm-read');

  const fill = () => {
    const pts: [number, number][] = [];
    for (let ms = t - (layout.hours + 1) * HOUR; ms <= t; ms += 6 * 60000) {
      pts.push([ms, amp * Math.cos((M2_SPEED * (ms / HOUR) + phase) * RAD)]);
    }
    m.fill(pts);
  };
  fill();

  const draw = () => {
    state[0].pin = amp * pinMax;
    state[0].angle = angle();
    m.frame(t, state, amp * Math.cos(angle() * RAD));
    const u = m.unitState('M2');
    if (!u) return;
    const a = angle() * RAD;
    // Wheel: a fixed point on the rim, lower left, where the frame rarely covers it.
    wheelLabel(cx - R * 0.8, cy + R * 0.52, cx - R - 30, cy + R * 0.95, 'end');
    // Pin: label beside the pin, to the right on phones and on whichever side it is otherwise.
    const side = phone || Math.sin(a) >= 0 ? 1 : -1;
    pinLabel(u.pinX, u.pinY, cx + side * (R + 30), u.pinY - 4, side > 0 ? 'start' : 'end');
    // Frame: label above its left end, riding with it.
    const fy = cy + u.dy;
    frameLabel(cx - R * 1.05 + 6, fy, cx - R - 30, Math.max(fs * 3.4, fy - 34), 'end');
    // Pulley.
    pulleyLabel(cx - layout.pulleyR * 0.7, u.pulleyY + layout.pulleyR * 0.7, cx - R - 30, u.pulleyY + 24, 'end');
    readAmp.textContent = `${Math.round(amp * 100)}%`;
    const start = ((((phase % 360) + 360) % 360) + 360) % 360;
    readPhase.textContent = `${Math.round(start)}° round`;
  };

  const setFrom = (e: PointerEvent) => {
    const p = m.toLocal(e.clientX, e.clientY);
    const dx = p.x - cx;
    const dy = p.y - cy;
    amp = Math.min(1, Math.hypot(dx, dy) / pinMax);
    phase = Math.atan2(dx, -dy) / RAD - M2_SPEED * (t / HOUR);
  };
  svg.addEventListener('pointerdown', (e) => {
    const p = m.toLocal(e.clientX, e.clientY);
    if (Math.hypot(p.x - cx, p.y - cy) > R * 1.25) return;
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
  /** True while the wheels settle to a new harbour: time waits for them. */
  hold = false;
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
    this.hold = this.shown.length > 0;
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

  /** Advance by `hours` unless the wheels are settling, then draw. */
  tick(dt: number, hours: number): void {
    if (!this.hold) this.t += hours * HOUR;
    if (!this.draw(dt)) this.hold = false;
  }

  /** Draw; returns true while any wheel is still settling. */
  draw(dt: number): boolean {
    const target = this.target();
    const k = 1 - Math.exp(-Math.max(dt, 1 / 60) * 7);
    let h = this.station.z0;
    let moving = false;
    target.forEach((w, i) => {
      const goal = this.engaged[i] ? w.pin : 0;
      const p = this.pinNow[i] ?? goal;
      this.pinNow[i] = Math.abs(goal - p) < 0.05 ? goal : p + (goal - p) * k;
      const off = this.offsets[i] ?? 0;
      this.offsets[i] = Math.abs(off) < 0.05 ? 0 : off * (1 - k);
      if (this.pinNow[i] !== goal || this.offsets[i] !== 0) moving = true;
      const s = this.shown[i] ?? (this.shown[i] = { pin: 0, angle: 0, engaged: true });
      s.pin = this.pinNow[i];
      s.angle = w.angle + this.offsets[i];
      s.engaged = this.engaged[i];
      h += (s.pin / this.pinScale) * Math.cos(s.angle * RAD);
    });
    this.m.frame(this.t, this.shown, h);
    return moving;
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
  const phone = narrow(svg);
  const layout: Layout = phone
    ? {
        width: 600,
        height: 820,
        gearR: 46,
        upperY: 96,
        lowerY: 410,
        reach: 128,
        pulleyR: 18,
        units: [
          { name: 'M2', row: 'upper', x: 360 },
          { name: 'S2', row: 'lower', x: 446 },
        ],
        anchor: { x: 300, y: 300 },
        guide: { x: 560, y: 224, r: 10 },
        paper: { x0: 18, x1: 586, y0: 540, y1: 806 },
        hours: 720,
      }
    : {
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

  const fs = phone ? 22 : 17;
  if (phone) {
    text(svg, 326, 42, fs, 'the moon, 12 h 25 min', 'tm-note', 'end');
    text(svg, 410, 495, fs, 'the sun, 12 h', 'tm-note', 'end');
  } else {
    text(svg, 574, 46, fs, 'the moon, 12 h 25 min');
    text(svg, 654, 445, fs, 'the sun, 12 h');
  }

  // A moon showing its phase, and the date.
  const mx = phone ? 110 : 170;
  const my = phone ? 164 : 176;
  const mr = phone ? 70 : 70;
  el('circle', { cx: mx, cy: my, r: mr + 10, fill: 'rgb(255 240 200 / 0.05)' }, svg);
  el('circle', { cx: mx, cy: my, r: mr, fill: '#26313a', stroke: '#3a4752', 'stroke-width': 1 }, svg);
  const lit = el('path', { fill: '#ece2c6' }, svg);
  const phaseText = text(svg, mx, my + mr + 40, phone ? 24 : 21, '', 'tm-note-big', 'middle');
  const dateText = text(svg, mx, my + mr + 68, phone ? 19 : 16, '', 'tm-note', 'middle');
  const springText = text(svg, mx, my + mr + 96, phone ? 19 : 16, '', 'tm-note-em', 'middle');

  const marks = fig.m.overlay;
  const markPool: SVGGElement[] = [];
  const mrk = phone ? 8 : 6;
  const drawMarks = () => {
    const qs = quarters(fig.t - 722 * HOUR, fig.t);
    qs.forEach((q, i) => {
      let g = markPool[i];
      if (!g) {
        g = el('g', {}, marks);
        markPool.push(g);
      }
      const x = fig.m.xAt(q.ms, fig.t);
      const y = layout.paper.y0 + mrk + 8;
      g.replaceChildren();
      el(
        'circle',
        { cx: x, cy: y, r: mrk, fill: q.q === 0 ? '#3b3a33' : '#efe8d6', stroke: '#3b3a33', 'stroke-width': 1.2 },
        g,
      );
      if (q.q === 1 || q.q === 3) el('path', { d: moonPath(x, y, mrk, q.q === 1 ? 90 : 270), fill: '#3b3a33' }, g);
      g.removeAttribute('display');
    });
    for (let i = qs.length; i < markPool.length; i++) markPool[i].setAttribute('display', 'none');
  };

  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const update = (dt: number, hours: number) => {
    fig.tick(dt, hours);
    const e = elongation(fig.t);
    lit.setAttribute('d', moonPath(mx, my, mr, e));
    phaseText.textContent = PHASES[Math.round(e / 45) % 8];
    dateText.textContent = fmt.format(fig.t);
    // Springs follow new and full moon by a day or two; call it from the phase.
    const fromSyzygy = Math.min(e % 180, 180 - (e % 180));
    springText.textContent = !fig.engaged[1]
      ? ''
      : fromSyzygy < 35
        ? 'Spring tides'
        : fromSyzygy > 55
          ? 'Neap tides'
          : '';
    drawMarks();
  };

  sunBtn?.addEventListener('click', () => {
    fig.engaged[1] = !fig.engaged[1];
    sunBtn.setAttribute('aria-pressed', String(fig.engaged[1]));
    sunBtn.textContent = fig.engaged[1] ? "Sun's wheel in gear" : "Sun's wheel out of gear";
  });

  update(0, 0);
  whileVisible(svg, (dt) => update(dt, dt * 24));
}

const KINDS: Record<string, [string, string]> = {
  '8443970': ['Boston', 'Two tides a day, nearly equal'],
  '9447130': ['Seattle', 'Two tides a day, one much higher'],
  '8729840': ['Pensacola', 'One tide a day'],
};

/** Fig. 3: four wheels set for three harbours. */
export function figFour(svg: SVGSVGElement, radios: NodeListOf<HTMLInputElement>): void {
  const phone = narrow(svg);
  const layout: Layout = phone
    ? {
        width: 600,
        height: 900,
        gearR: 38,
        upperY: 372,
        lowerY: 662,
        reach: 122,
        pulleyR: 15,
        units: [
          { name: 'K1', row: 'upper', x: 260 },
          { name: 'O1', row: 'lower', x: 332 },
          { name: 'S2', row: 'upper', x: 404 },
          { name: 'M2', row: 'lower', x: 476 },
        ],
        anchor: { x: 206, y: 555 },
        guide: { x: 560, y: 487, r: 10 },
        paper: { x0: 18, x1: 586, y0: 730, y1: 886 },
        hours: 72,
      }
    : {
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
  const title = text(svg, phone ? 24 : 40, phone ? 70 : 150, phone ? 50 : 46, '', 'tm-note-title');
  title.setAttribute('fill', '#e8e1d1');
  const kind = text(svg, phone ? 24 : 40, phone ? 110 : 190, phone ? 23 : 19);
  const barX = phone ? 24 : 40;
  const barY = phone ? 168 : 236;
  text(svg, barX, barY, phone ? 16 : 13, 'PIN SETTINGS AT THIS HARBOUR', 'tm-plate-dark');
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
  const hourFmt = new Map<string, Intl.DateTimeFormat>();
  const localHours = (z: string, ms: number) => {
    let f = hourFmt.get(z);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', { timeZone: z, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' });
      hourFmt.set(z, f);
    }
    const p: Record<string, string> = {};
    for (const x of f.formatToParts(ms)) p[x.type] = x.value;
    return (+p.hour % 24) + +p.minute / 60;
  };
  fig.m.setTime(
    (ms) => fmtFor(zone).format(ms).replace(',', ''),
    (ms) => localHours(zone, ms),
  );

  const choose = (id: string) => {
    const port = PORTS.find((p) => p.id === id) ?? PORTS[0];
    zone = port.zone;
    fig.reset(station(id, names), layout.hours);
    const [name, desc] = KINDS[id] ?? [port.name, ''];
    title.textContent = name;
    kind.textContent = desc;
    amps.replaceChildren();
    // Each wheel's amplitude for this harbour, on one scale for all three.
    const rowH = phone ? 40 : 34;
    const scale = phone ? 290 : 230;
    names.forEach((n, i) => {
      const h = fig.station.harmonics.find((x) => x.name === n);
      const y = barY + 38 + i * rowH;
      text(amps, barX, y, phone ? 20 : 16, n, 'tm-tag').setAttribute('fill', '#d9bd7f');
      const w = Math.max(2, (h?.amp ?? 0) * scale);
      el('rect', { x: barX + 52, y: y - 14, width: w, height: 15, rx: 2, fill: '#b68a3e' }, amps);
      const v = text(amps, barX + 62 + w, y, phone ? 18 : 15, `${((h?.amp ?? 0) * 3.28084).toFixed(1)} ft`);
      v.setAttribute('fill', '#a9a597');
    });
  };
  radios.forEach((r) =>
    r.addEventListener('change', () => {
      if (r.checked) choose(r.value);
    }),
  );
  choose([...radios].find((r) => r.checked)?.value ?? '8443970');
  fig.draw(0);
  whileVisible(svg, (dt) => fig.tick(dt, dt * 4));
}
