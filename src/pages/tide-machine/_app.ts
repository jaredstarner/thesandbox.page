import { figFour, figOne, figTwo } from './_figures';
import { gauge } from './_gauge';
import { Machine, type Layout, type UnitSpec, type WheelState } from './_machine';
import { NAMES, PORTS, type Port } from './_ports';
import { height, turns, wheels, type Station, type Turn, type Wheel } from './_tides';

const FT = 3.28084;
const HOUR = 3600000;
const RAD = Math.PI / 180;

function stationOf(port: Port): Station {
  return {
    z0: port.z0,
    harmonics: port.h.map(([amp, phase, speed], i) => ({ name: NAMES[i], amp, phase, speed })),
  };
}

/** Local-time helpers for a harbour's time zone. */
class Zone {
  readonly zone: string;
  private parts: Intl.DateTimeFormat;
  private offsets = new Map<number, number>();
  private dayFmt: Intl.DateTimeFormat;
  private timeFmt: Intl.DateTimeFormat;
  private zoneFmt: Intl.DateTimeFormat;

  constructor(zone: string) {
    this.zone = zone;
    this.parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    this.dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' });
    this.timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
    this.zoneFmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' });
  }

  /** Minutes the zone is ahead of UTC at `ms`. */
  offset(ms: number): number {
    const key = Math.floor(ms / HOUR);
    let off = this.offsets.get(key);
    if (off === undefined) {
      const p = this.fields(key * HOUR);
      off = (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - key * HOUR) / 60000;
      if (this.offsets.size > 5000) this.offsets.clear();
      this.offsets.set(key, off);
    }
    return off;
  }

  fields(ms: number) {
    const o: Record<string, string> = {};
    for (const p of this.parts.formatToParts(ms)) o[p.type] = p.value;
    return {
      year: +o.year,
      month: +o.month,
      day: +o.day,
      hour: +o.hour % 24,
      minute: +o.minute,
      weekday: o.weekday,
    };
  }

  hours(ms: number): number {
    const local = ms + this.offset(ms) * 60000;
    return (((local / HOUR) % 24) + 24) % 24;
  }

  /** The UTC time of local midnight starting the given calendar date. */
  midnight(y: number, m: number, d: number): number {
    const guess = Date.UTC(y, m - 1, d);
    return guess - this.offset(guess - 12 * HOUR) * 60000;
  }

  day(ms: number): string {
    return this.dayFmt.format(ms).replace(',', '');
  }

  time(ms: number): string {
    return this.timeFmt
      .format(ms)
      .replace(/\s?AM$/, ' a.m.')
      .replace(/\s?PM$/, ' p.m.');
  }

  abbr(ms: number): string {
    return this.zoneFmt.formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? '';
  }

  dateInput(ms: number): string {
    const f = this.fields(ms);
    return `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
  }
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Eases each wheel's pin and angle toward the model, so resetting a machine looks like setting it by hand. */
class Settle {
  pins: number[] = [];
  offsets: number[] = [];

  /** Start a change: keep the wheels where they were drawn and let them move to `target`. */
  begin(shown: WheelState[], target: { pin: number; angle: number }[]): void {
    target.forEach((w, i) => {
      const old = shown[i];
      if (!old) {
        this.pins[i] = w.pin;
        this.offsets[i] = 0;
        return;
      }
      this.pins[i] = old.pin;
      let d = (old.angle - w.angle) % 360;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      this.offsets[i] = d;
    });
  }

  /** Advance by `dt` seconds toward `target`; returns true while still moving. */
  step(target: { pin: number; angle: number }[], dt: number, out: WheelState[], engaged: boolean[]): boolean {
    const k = 1 - Math.exp(-dt * 7);
    let moving = false;
    target.forEach((w, i) => {
      const goal = engaged[i] ? w.pin : 0;
      const p = this.pins[i] ?? goal;
      const np = Math.abs(goal - p) < 0.05 ? goal : p + (goal - p) * k;
      this.pins[i] = np;
      const off = this.offsets[i] ?? 0;
      const no = Math.abs(off) < 0.05 ? 0 : off * (1 - k);
      this.offsets[i] = no;
      if (np !== goal || no !== 0) moving = true;
      const o = out[i] ?? (out[i] = { pin: 0, angle: 0, engaged: true });
      o.pin = np;
      o.angle = w.angle + no;
      o.engaged = engaged[i];
    });
    return moving;
  }
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Pick a grid step for the paper and height dial from a range in display units. */
function stepFor(range: number, unit: 'ft' | 'm'): number {
  if (unit === 'ft') return range <= 2.6 ? 0.5 : range <= 9 ? 1 : range <= 18 ? 2 : 4;
  return range <= 0.8 ? 0.1 : range <= 1.6 ? 0.25 : range <= 4 ? 0.5 : 1;
}

function rangeOf(station: Station, from: number, hours: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k <= hours; k++) {
    const h = height(station, from + k * HOUR);
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  const pad = (hi - lo) * 0.04;
  return [lo - pad, hi + pad];
}

// ---------------------------------------------------------------------------------------------------------
// The machine at the top of the page.

/** Wheel positions: the biggest constituents nearest the pen, alternating top row and bottom row. */
function heroUnits(x0: number, pitch: number): UnitSpec[] {
  return NAMES.map((name, k) =>
    k % 2 === 0
      ? { name, row: 'upper' as const, x: x0 + (18 - k / 2) * pitch }
      : { name, row: 'lower' as const, x: x0 + pitch / 2 + (17 - (k - 1) / 2) * pitch },
  );
}

const HERO: Layout = {
  width: 1600,
  height: 770,
  gearR: 26,
  upperY: 128,
  lowerY: 480,
  reach: 140,
  pulleyR: 12,
  units: heroUnits(92, 64),
  anchor: { x: 58, y: 352 },
  guide: { x: 1312, y: 268, r: 12 },
  paper: { x0: 60, x1: 1552, y0: 562, y1: 752 },
  hours: 72,
  crank: { x: 1470, y: 486, r: 30 },
  dials: { x: 1470, dateY: 50, clockY: 180, clockR: 52, heightY: 334, heightR: 62 },
  nameplate: { x: 640, y: 40, w: 400 },
};

interface BookRow {
  turn: Turn;
  node: HTMLLIElement;
}

function hero(root: HTMLElement, onChange: (port: Port, unit: 'ft' | 'm') => void): void {
  const svg = root.querySelector<SVGSVGElement>('[data-machine]')!;
  const machine = new Machine(svg, HERO);
  const portSel = root.querySelector<HTMLSelectElement>('[data-port]')!;
  const dateIn = root.querySelector<HTMLInputElement>('[data-date]')!;
  const todayBtn = root.querySelector<HTMLButtonElement>('[data-today]')!;
  const runBtn = root.querySelector<HTMLButtonElement>('[data-run]')!;
  const nextBtn = root.querySelector<HTMLButtonElement>('[data-next]')!;
  const gearedOut = root.querySelector<HTMLElement>('[data-geared]')!;
  const bookList = root.querySelector<HTMLOListElement>('[data-book]')!;
  const bookSub = root.querySelector<HTMLElement>('[data-book-sub]')!;
  const scroller = root.querySelector<HTMLElement>('[data-scroller]')!;

  let port = PORTS.find((p) => p.id === portSel.value) ?? PORTS[0];
  let station = stationOf(port);
  let zone = new Zone(port.zone);
  let unit: 'ft' | 'm' = 'ft';
  let speed = 4;
  let t = Date.now();
  let running = !reducedMotion();
  let crankTurns = 0;
  let pinScale = 1;
  const engaged = NAMES.map(() => true);
  const enabledSet = new Set<string>(NAMES);
  const enabled = (name: string) => enabledSet.has(name);
  const settle = new Settle();
  const shown: WheelState[] = [];
  let model: Wheel[] = [];
  const target: { pin: number; angle: number }[] = [];
  let book: BookRow[] = [];
  let glide: { from: number; to: number; start: number; dur: number } | null = null;
  let dirty = true;

  function computeTarget(): void {
    model = wheels(station, t, model);
    for (let i = 0; i < HERO.units.length; i++) {
      const w = model[i];
      target[i] = { pin: w.amp * pinScale, angle: w.angle };
    }
  }

  function heightShown(): number {
    let h = station.z0;
    for (let i = 0; i < shown.length; i++) {
      const s = shown[i];
      h += (s.pin / pinScale) * Math.cos(s.angle * RAD);
    }
    return h;
  }

  function fmtH(m: number): string {
    return unit === 'ft' ? `${(m * FT).toFixed(1)} ft` : `${m.toFixed(2)} m`;
  }

  function setScale(): void {
    const [lo, hi] = rangeOf(station, t - 183 * 24 * HOUR, 366 * 24);
    const k = unit === 'ft' ? FT : 1;
    machine.setScale(lo, hi, stepFor((hi - lo) * k, unit), unit, k);
    machine.setTime(
      (ms) => zone.day(ms),
      (ms) => zone.hours(ms),
    );
  }

  function prefill(): void {
    const pts: [number, number][] = [];
    for (let ms = t - (HERO.hours + 1) * HOUR; ms <= t; ms += 6 * 60000) pts.push([ms, height(station, ms, enabled)]);
    machine.fill(pts);
  }

  function renderBook(): void {
    bookList.replaceChildren();
    if (!book.length) {
      const li = document.createElement('li');
      li.className = 'book-empty';
      li.textContent = 'Run the machine to the next high or low water.';
      bookList.append(li);
    }
    for (const row of book) bookList.append(row.node);
    bookSub.textContent = `${port.name}, ${zone.abbr(t)}. Heights above chart datum.`;
  }

  function rowNode(turn: Turn, fresh: boolean): HTMLLIElement {
    const li = document.createElement('li');
    li.className = turn.kind + (fresh ? ' fresh' : '');
    const cells = [
      ['day', zone.day(turn.ms)],
      ['time', zone.time(turn.ms)],
      ['kind', turn.kind === 'high' ? 'High' : 'Low'],
      ['h', fmtH(turn.height)],
    ];
    for (const [cls, text] of cells) {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = text;
      li.append(s);
    }
    return li;
  }

  function addTurn(turn: Turn, fresh: boolean): void {
    if (book.some((r) => Math.abs(r.turn.ms - turn.ms) < 60000)) return;
    book.push({ turn, node: rowNode(turn, fresh) });
    book.sort((a, b) => a.turn.ms - b.turn.ms);
    while (book.length > 8) book.shift();
    renderBook();
  }

  function seedBook(): void {
    book = [];
    for (const turn of turns(station, t - 26 * HOUR, t, enabled)) addTurn(turn, false);
    renderBook();
  }

  function resetSheet(): void {
    setScale();
    prefill();
    seedBook();
    dateIn.value = zone.dateInput(t);
    dirty = true;
  }

  function choosePort(p: Port): void {
    port = p;
    station = stationOf(p);
    zone = new Zone(p.zone);
    const maxAmp = Math.max(...station.harmonics.map((h) => h.amp));
    pinScale = (HERO.gearR * 0.8) / (maxAmp * 1.05);
    machine.setName(`${p.name}, ${p.region}`);
    computeTarget();
    settle.begin(shown, target);
    resetSheet();
  }

  function setEngaged(names: Set<string>): void {
    enabledSet.clear();
    names.forEach((n) => enabledSet.add(n));
    HERO.units.forEach((u, i) => (engaged[i] = enabledSet.has(u.name)));
    gearedOut.textContent = `${enabledSet.size} of ${NAMES.length} in gear`;
    dirty = true;
  }

  function advance(to: number): void {
    const from = t;
    t = to;
    if (to > from) {
      for (const turn of turns(station, from, to, enabled, 6)) addTurn(turn, true);
    }
    dirty = true;
  }

  function setRunning(on: boolean): void {
    running = on;
    runBtn.setAttribute('aria-pressed', String(on));
    runBtn.textContent = on ? 'Stop' : 'Run';
  }

  // Controls.
  portSel.addEventListener('change', () => {
    const p = PORTS.find((x) => x.id === portSel.value);
    if (p) {
      choosePort(p);
      onChange(p, unit);
    }
  });
  dateIn.addEventListener('change', () => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIn.value);
    if (!m) return;
    const y = Math.min(2099, Math.max(1900, +m[1]));
    const lh = zone.hours(t);
    t = zone.midnight(y, +m[2], +m[3]) + lh * HOUR;
    glide = null;
    computeTarget();
    settle.begin(shown, target);
    resetSheet();
  });
  todayBtn.addEventListener('click', () => {
    t = Date.now();
    glide = null;
    computeTarget();
    settle.begin(shown, target);
    resetSheet();
  });
  runBtn.addEventListener('click', () => {
    glide = null;
    setRunning(!running);
  });
  nextBtn.addEventListener('click', () => {
    setRunning(false);
    const start = glide ? glide.to : t;
    const next = turns(station, start + 60000, start + 16 * HOUR, enabled, 6)[0];
    if (!next) return;
    const hours = (next.ms - t) / HOUR;
    glide = { from: t, to: next.ms, start: performance.now(), dur: Math.min(2400, 700 + hours * 160) };
  });
  root.querySelectorAll<HTMLInputElement>('input[name="speed"]').forEach((r) =>
    r.addEventListener('change', () => {
      if (r.checked) speed = Number(r.value);
    }),
  );
  root.querySelectorAll<HTMLInputElement>('input[name="units"]').forEach((r) =>
    r.addEventListener('change', () => {
      if (!r.checked) return;
      unit = r.value === 'm' ? 'm' : 'ft';
      const keep = book.map((b) => b.turn);
      setScale();
      prefill();
      book = [];
      keep.forEach((k) => addTurn(k, false));
      renderBook();
      onChange(port, unit);
      dirty = true;
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      const v = b.dataset.preset ?? 'all';
      setEngaged(new Set(v === 'all' ? NAMES : v.split(' ')));
    }),
  );
  machine.onWheel = (name) => {
    const next = new Set(enabledSet);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setEngaged(next);
  };

  // The crank: drag it round; one turn is three hours of tide.
  const hit = svg.querySelector<SVGCircleElement>('.tm-crank-hit');
  let cranking: { id: number; angle: number } | null = null;
  const angleAt = (e: PointerEvent) => {
    const c = machine.crankCenter();
    return c ? Math.atan2(e.clientX - c.x, -(e.clientY - c.y)) : 0;
  };
  hit?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setRunning(false);
    glide = null;
    cranking = { id: e.pointerId, angle: angleAt(e) };
    try {
      hit.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't be captured */
    }
    svg.classList.add('cranking');
  });
  hit?.addEventListener('pointermove', (e) => {
    if (!cranking || e.pointerId !== cranking.id) return;
    const a = angleAt(e);
    let d = a - cranking.angle;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    cranking.angle = a;
    advance(t + (d / (Math.PI * 2)) * 3 * HOUR);
  });
  const endCrank = () => {
    cranking = null;
    svg.classList.remove('cranking');
  };
  hit?.addEventListener('pointerup', endCrank);
  hit?.addEventListener('pointercancel', endCrank);

  let onScreen = true;
  new IntersectionObserver(([e]) => (onScreen = e.isIntersecting)).observe(svg);

  let last = 0;
  const loop = (now: number) => {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (onScreen && !document.hidden) {
      if (glide) {
        const k = Math.min(1, (now - glide.start) / glide.dur);
        const e = 1 - (1 - k) ** 3;
        advance(glide.from + (glide.to - glide.from) * e);
        if (k >= 1) glide = null;
      } else if (running && dt > 0) {
        advance(t + dt * speed * HOUR);
      }
      if (dirty || settle.pins.length) {
        computeTarget();
        const moving = settle.step(target, dt || 1 / 60, shown, engaged);
        crankTurns = (t / HOUR / 3) % 1;
        const f = zone.fields(t);
        machine.frame(t, shown, heightShown(), crankTurns, {
          weekday: (f.weekday ?? '').toUpperCase(),
          day: String(f.day),
          month: MONTHS[f.month - 1],
          year: String(f.year),
          hours: f.hour + f.minute / 60 + (t % 60000) / HOUR,
        });
        dirty = moving || running || !!glide;
      }
    }
    requestAnimationFrame(loop);
  };

  // Start on "now" with the paper already written, as if the machine had been turning all along.
  choosePort(port);
  onChange(port, unit);
  setEngaged(new Set(NAMES));
  setRunning(running);
  computeTarget();
  settle.step(target, 10, shown, engaged);
  settle.offsets = settle.offsets.map(() => 0);
  dirty = true;
  requestAnimationFrame(loop);

  // On narrow screens the machine scrolls sideways; open on the pen and dials.
  requestAnimationFrame(() => {
    scroller.scrollLeft = scroller.scrollWidth;
  });

}

export function start(root: HTMLElement): void {
  root.dataset.ready = 'true';
  const gaugeEl = root.querySelector<HTMLElement>('[data-gauge]');
  const view = gaugeEl ? gauge(gaugeEl) : null;
  hero(root, (port, unit) => view?.show(port, unit));
  const one = root.querySelector<SVGSVGElement>('[data-fig="one"]');
  if (one) figOne(one);
  const two = root.querySelector<SVGSVGElement>('[data-fig="two"]');
  if (two) figTwo(two, root.querySelector<HTMLButtonElement>('[data-fig2-sun]'));
  const four = root.querySelector<SVGSVGElement>('[data-fig="four"]');
  if (four) figFour(four, root.querySelectorAll<HTMLInputElement>('input[name="fig4"]'));
}
