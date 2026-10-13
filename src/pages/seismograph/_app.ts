// Wires the page together: loads a station's last day, inks it onto the
// sheet, keeps the pen writing as new samples come in, and flags where each
// quake's waves should land.

import { Dial, type DialQuake } from './_dial';
import { Drum } from './_drum';
import { quakes as fetchQuakes, waveform, type Quake } from './_feed';
import { Listener } from './_listen';
import { Trace } from './_signal';
import { DEFAULT_STATION, STATIONS, type Station } from './_stations';
import { felt, geo, phases, type Phase } from './_travel';

const HOUR = 3600_000;
/** How much of the newest data the pen holds back on arrival, to write it out live. */
const CUSHION = 4 * 60_000;
const POLL_MS = 60_000;
const QUAKE_POLL_MS = 5 * 60_000;
const GAINS = [0.25, 0.5, 1, 2, 4, 8, 16];

const root = document.querySelector<HTMLElement>('[data-seismo]');
if (root) start(root);

interface Marked {
  q: Quake;
  dist: number;
  az: number;
  felt: boolean;
  phases: Phase[];
}

function start(root: HTMLElement): void {
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const paper = $<HTMLElement>('[data-paper]');
  const marks = $<HTMLElement>('[data-marks]');
  const pen = $<HTMLElement>('[data-pen]');
  const penTag = $<HTMLElement>('[data-pen-tag]');
  const cursor = $<HTMLElement>('[data-cursor]');
  const cursorText = $<HTMLElement>('[data-cursor-text]');
  const playhead = $<HTMLElement>('[data-playhead]');
  const blank = $<HTMLElement>('[data-blank]');
  const lamp = $<HTMLElement>('[data-lamp]');
  const lampText = $<HTMLElement>('[data-lamp-text]');
  const staCode = $<HTMLElement>('[data-sta-code]');
  const staWhere = $<HTMLElement>('[data-sta-where]');
  const heading = $<HTMLElement>('[data-heading]');
  const scaleOut = $<HTMLElement>('[data-scale]');
  const select = $<HTMLSelectElement>('[data-station]');
  const gainOut = $<HTMLOutputElement>('[data-gain-out]');
  const listenBtn = $<HTMLButtonElement>('[data-listen]');
  const listenText = $<HTMLElement>('[data-listen-text]');
  const listenHint = $<HTMLElement>('[data-listen-hint]');
  const quakeList = $<HTMLOListElement>('[data-quakes]');
  const quakeNote = $<HTMLElement>('[data-quakes-note]');

  const drum = new Drum($<HTMLCanvasElement>('[data-ink]'), marks);
  const dial = new Dial($<HTMLCanvasElement>('[data-dial]'), root.dataset.land ?? '');
  const listener = new Listener();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let station = pickStation();
  let trace: Trace | null = null;
  let noise = 1;
  let rowSec = 1800;
  let gainStep = 2;
  /** Sample index the pen has inked up to (exclusive). */
  let drawn = 0;
  /** How far behind the clock the pen writes, ms. */
  let lag = 0;
  let opening: { from: number; to: number; t0: number; dur: number } | null = null;
  let load: AbortController | null = null;
  let polling = 0;
  let allQuakes: Quake[] = [];
  let marked: Marked[] = [];
  let selected: string | null = null;

  const utc = (t: number, secs = true) => new Date(t).toISOString().slice(11, secs ? 19 : 16);
  const localFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

  function pickStation(): Station {
    const asked = new URLSearchParams(location.search).get('station')?.toUpperCase();
    const byCode = STATIONS.find((s) => s.code === asked);
    if (byCode) return byCode;
    // Nearest vault on the visitor's own continent, guessed from their time zone
    // without asking for a location.
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
      const area = zone.split('/')[0];
      const jan = new Date(new Date().getFullYear(), 0, 1).getTimezoneOffset();
      const lon = -jan / 4;
      const near = STATIONS.filter((s) => s.zone.split('/')[0] === area && Math.abs(s.lat) < 60);
      if (near.length) return near.sort((a, b) => Math.abs(a.lon - lon) - Math.abs(b.lon - lon))[0];
    } catch {
      /* fall through */
    }
    return STATIONS.find((s) => s.code === DEFAULT_STATION)!;
  }

  function setLamp(state: 'wait' | 'live' | 'down', text: string): void {
    lamp.dataset.state = state;
    lampText.textContent = text;
  }

  function describe(s: Station): void {
    staCode.textContent = `IU ${s.code} 00 LHZ`;
    const lat = `${Math.abs(s.lat).toFixed(2)}° ${s.lat >= 0 ? 'N' : 'S'}`;
    const lon = `${Math.abs(s.lon).toFixed(2)}° ${s.lon >= 0 ? 'E' : 'W'}`;
    const where = s.depth >= 20 ? `${Math.round(s.depth)} m underground` : 'in a surface vault';
    staWhere.textContent = `${s.place}, ${s.region} · ${lat} ${lon} · ${s.sensor}, ${where}`;
    select.value = s.code;
  }

  // ---- Layout -------------------------------------------------------------

  function windowStart(now: number): number {
    return Math.floor(now / HOUR) * HOUR - 23 * HOUR;
  }

  function rowsFor(t0: number, now: number): number {
    const end = Math.floor(now / HOUR) * HOUR + HOUR;
    return Math.round((end - t0) / (rowSec * 1000));
  }

  function rowHeight(rows: number): number {
    const narrow = paper.clientWidth < 520;
    const avail = window.innerHeight - (narrow ? 260 : 230);
    return Math.max(narrow ? 10 : 12, Math.min(28, Math.floor(avail / rows)));
  }

  function gainPx(rowH: number): number {
    // Typical background noise fills about a tenth of a line at ×1, so quakes stand out.
    return ((rowH * 0.055) / noise) * GAINS[gainStep];
  }

  function relayout(): void {
    if (!trace) return;
    const now = Date.now();
    const rows = rowsFor(trace.t0, now);
    const rowH = rowHeight(rows);
    drum.layout(paper.clientWidth, { t0: trace.t0, rowSec, rows, rowH, gain: gainPx(rowH) });
    drum.draw(trace, 0, drawn);
    const since = new Date(trace.t0).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    heading.textContent = `Vertical ground velocity, one line per ${rowSec >= 3600 ? 'hour' : `${rowSec / 60} minutes`}, from ${utc(trace.t0, false)} UTC on ${since}`;
    updateScale();
    placeFlags();
    placePen();
  }

  function updateScale(): void {
    // What one line's spacing means in ground speed at this magnification.
    const perLine = drum.lay.rowH / drum.lay.gain / station.scale;
    scaleOut.textContent = `One line apart = ${speed(perLine)}`;
    gainOut.textContent = `×${GAINS[gainStep] < 1 ? `1/${1 / GAINS[gainStep]}` : GAINS[gainStep]}`;
  }

  function speed(ms: number): string {
    const um = ms * 1e6;
    if (um >= 1000) return `${(um / 1000).toPrecision(2)} mm/s`;
    if (um >= 1) return `${um.toPrecision(2)} µm/s`;
    return `${(um * 1000).toPrecision(2)} nm/s`;
  }

  // ---- Loading ------------------------------------------------------------

  async function loadStation(s: Station): Promise<void> {
    load?.abort();
    const ctl = new AbortController();
    load = ctl;
    station = s;
    describe(s);
    listener.stop();
    stopPlayback();
    const now = Date.now();
    trace = new Trace(windowStart(now), 48 * 3600);
    drawn = 0;
    opening = null;
    pen.hidden = true;
    blank.hidden = true;
    listenBtn.disabled = true;
    setLamp('wait', `Calling ${s.code}`);
    relayout();
    dial.setStation(s);
    markQuakes();
    try {
      const chunks = await waveform(s.code, trace.t0, now, ctl.signal);
      if (ctl.signal.aborted) return;
      trace.add(chunks);
    } catch {
      if (ctl.signal.aborted) return;
      setLamp('down', 'No answer');
      blank.textContent = `${s.place} isn't answering right now. Try another station, or come back in a while.`;
      blank.hidden = false;
      return;
    }
    if (!trace.end) {
      setLamp('down', 'No recent data');
      blank.textContent = `${s.place} hasn't sent anything for the last day. Try another station.`;
      blank.hidden = false;
      return;
    }
    noise = trace.noise();
    relayout();
    const target = Math.max(0, trace.end - CUSHION / 1000);
    lag = Date.now() - (trace.t0 + target * 1000);
    if (reduced) {
      drum.draw(trace, 0, target);
      drawn = target;
    } else {
      opening = { from: 0, to: target, t0: performance.now(), dur: 2600 };
    }
    pen.hidden = false;
    listenBtn.disabled = false;
    refreshLamp();
    markQuakes();
  }

  async function poll(): Promise<void> {
    if (!trace || !trace.end || document.hidden) return;
    const s = station;
    const tr = trace;
    try {
      const chunks = await waveform(s.code, tr.endTime - 1000, Date.now());
      if (tr !== trace) return;
      tr.add(chunks);
      refreshLamp();
      // A new hour means a new block of lines.
      if (rowsFor(tr.t0, Date.now()) !== drum.lay.rows) relayout();
    } catch {
      if (tr === trace) setLamp('down', 'Line dropped; retrying');
    }
  }

  function refreshLamp(): void {
    if (!trace?.end) return;
    const age = Math.round((Date.now() - trace.endTime) / 60_000);
    setLamp(age > 60 ? 'down' : 'live', age > 60 ? `Newest sample ${Math.round(age / 60)} h old` : `Live · newest sample ${age} min old`);
  }

  async function loadQuakes(): Promise<void> {
    try {
      allQuakes = await fetchQuakes();
      markQuakes();
    } catch {
      quakeNote.textContent = "The earthquake list isn't answering right now; the record still runs without it.";
    }
  }

  // ---- Quakes -------------------------------------------------------------

  function markQuakes(): void {
    if (!trace) return;
    const from = trace.t0;
    const to = Math.floor(Date.now() / HOUR) * HOUR + HOUR;
    marked = [];
    const forDial: DialQuake[] = [];
    for (const q of allQuakes) {
      const { dist, az } = geo(station.lat, station.lon, q.lat, q.lon);
      const f = felt(dist, q.mag);
      const ph = phases(dist, q.mag).filter((p) => q.time + p.t * 1000 >= from && q.time + p.t * 1000 < to);
      if (q.time > from - 4 * HOUR) forDial.push({ id: q.id, lat: q.lat, lon: q.lon, mag: q.mag, felt: f && ph.length > 0 });
      if (f && ph.length) marked.push({ q, dist, az, felt: f, phases: ph });
    }
    dial.setQuakes(forDial);
    if (selected && !marked.some((m) => m.q.id === selected)) selected = null;
    dial.select(selected);
    renderList();
    placeFlags();
  }

  function renderList(): void {
    quakeList.replaceChildren();
    if (!allQuakes.length) return;
    const list = [...marked].sort((a, b) => b.q.time - a.q.time);
    quakeNote.textContent = list.length
      ? `${list.length} big or near enough to reach ${station.code}. Pick one to find its waves.`
      : `Nothing big or near enough to reach ${station.code} in the last day.`;
    for (const m of list) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.quake = m.q.id;
      b.setAttribute('aria-pressed', String(m.q.id === selected));
      const mag = document.createElement('span');
      mag.className = `mag${m.q.mag >= 6 ? ' big' : ''}`;
      mag.textContent = m.q.mag.toFixed(1);
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = m.q.place;
      const when = document.createElement('span');
      when.className = 'when';
      const first = m.phases[0];
      const km = Math.round(m.dist * 111.19).toLocaleString();
      when.textContent = `${utc(m.q.time, false)} UTC · ${Math.round(m.dist)}° away, ${km} km`;
      const due = document.createElement('span');
      due.className = 'when';
      due.textContent = `${first.name === 'R1' ? 'Surface waves' : `First ${first.name} wave`} due ${utc(m.q.time + first.t * 1000, false)} UTC`;
      b.append(mag, what, when, due);
      li.append(b);
      quakeList.append(li);
    }
  }

  function placeFlags(): void {
    marks.querySelectorAll('.flag').forEach((f) => f.remove());
    if (!trace) return;
    const frag = document.createDocumentFragment();
    // Labels claim room on their line, biggest quakes and first arrivals first;
    // a label that would land on another keeps its tick and drops its text.
    const taken = new Map<number, [number, number][]>();
    const order = [...marked].sort((a, b) => b.q.mag - a.q.mag);
    for (const m of order) {
      m.phases.forEach((p, i) => {
        const t = m.q.time + p.t * 1000;
        const pos = drum.pos(t);
        if (pos.row < 0 || pos.row >= drum.lay.rows) return;
        const w = i === 0 ? 50 : 14;
        const spans = taken.get(pos.row) ?? [];
        const clash = spans.some(([a, b]) => pos.x < b && pos.x + w > a);
        if (!clash) {
          spans.push([pos.x - 2, pos.x + w]);
          taken.set(pos.row, spans);
        }
        const el = document.createElement(i === 0 ? 'button' : 'span');
        el.className = 'flag';
        if (selected) el.classList.add(m.q.id === selected ? 'on' : 'dim');
        el.dataset.quake = m.q.id;
        el.style.left = `${pos.x}px`;
        el.style.top = `${pos.y - drum.lay.rowH * 0.95}px`;
        el.style.setProperty('--h', `${drum.lay.rowH * 1.2}px`);
        const tag = document.createElement('span');
        tag.className = 'ph';
        const name = p.name === 'R1' ? 'R' : p.name === 'R2' ? 'R2' : p.name;
        if (i === 0) {
          const b = document.createElement('b');
          b.textContent = name;
          const mag = document.createElement('i');
          mag.textContent = ` M${m.q.mag.toFixed(1)}`;
          tag.append(b, mag);
          (el as HTMLButtonElement).type = 'button';
          el.setAttribute('aria-label', `M${m.q.mag.toFixed(1)}, ${m.q.place}: expected ${name} arrival at ${utc(t)} UTC`);
        } else {
          tag.textContent = name;
        }
        if (clash) tag.classList.add('quiet');
        el.append(tag);
        frag.append(el);
      });
    }
    marks.append(frag);
  }

  function choose(id: string | null, scroll: boolean): void {
    selected = selected === id ? null : id;
    dial.select(selected);
    quakeList.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.quake === selected)));
    marks.querySelectorAll<HTMLElement>('.flag').forEach((f) => {
      f.classList.toggle('on', !!selected && f.dataset.quake === selected);
      f.classList.toggle('dim', !!selected && f.dataset.quake !== selected);
    });
    listenText.textContent = selected ? 'Listen to this quake' : 'Listen to the day';
    listenHint.textContent = selected
      ? 'Three hours from the moment it struck, sped up 2,000 times: the first arrivals, then the long roll of surface waves.'
      : 'A day of ground motion sped up 6,000 times, so the slow sway becomes sound.';
    if (selected && scroll) {
      const flag = marks.querySelector<HTMLElement>(`.flag[data-quake="${CSS.escape(selected)}"]`);
      flag?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  // ---- The pen ------------------------------------------------------------

  function placePen(): void {
    if (!trace || !drawn) return;
    const i = Math.min(drawn, trace.end) - 1;
    const p = drum.sampleAt(trace, i);
    pen.style.transform = `translate(${p.x}px, ${p.y}px)`;
    pen.classList.toggle('flip', p.x > drum.width - 260);
    pen.classList.toggle('above', p.y > drum.height - drum.lay.rowH * 2.5);
    const t = trace.t0 + (i + 1) * 1000;
    const behind = Math.max(0, Math.round((Date.now() - t) / 60_000));
    penTag.textContent = opening ? 'Inking the last day' : `${utc(t)} UTC · ${behind} min behind the ground`;
  }

  function frame(now: number): void {
    requestAnimationFrame(frame);
    if (!trace || !trace.end) return;
    if (opening) {
      const k = Math.min(1, (now - opening.t0) / opening.dur);
      const e = 1 - (1 - k) ** 3;
      const to = Math.round(opening.from + (opening.to - opening.from) * e);
      if (to > drawn) {
        drum.draw(trace, drawn, to);
        drawn = to;
      }
      if (k >= 1) opening = null;
      placePen();
      return;
    }
    const clock = Date.now();
    let target = clock - lag;
    if (target > trace.endTime) {
      // Out of ink: wait for the station, and pick up where it stopped.
      lag = clock - trace.endTime;
      target = trace.endTime;
    } else if (trace.endTime - target > CUSHION * 2.5) {
      // Fallen well behind after a long stall: hurry a little.
      lag = Math.max(0, lag - 500);
    }
    const idx = Math.min(trace.end, Math.floor((target - trace.t0) / 1000));
    if (idx > drawn) {
      drum.draw(trace, drawn, idx);
      drawn = idx;
    }
    placePen();
    const pos = listener.position();
    if (pos >= 0) placePlayhead(pos);
  }

  // ---- Listening ----------------------------------------------------------

  function placePlayhead(i: number): void {
    if (!trace) return;
    const p = drum.pos(trace.t0 + i * 1000);
    playhead.hidden = false;
    playhead.style.left = `${p.x}px`;
    playhead.style.top = `${p.y - drum.lay.rowH * 0.9}px`;
    playhead.style.height = `${drum.lay.rowH * 1.8}px`;
  }

  function stopPlayback(): void {
    playhead.hidden = true;
    listenBtn.setAttribute('aria-pressed', 'false');
  }

  listenBtn.addEventListener('click', async () => {
    if (!trace?.end) return;
    if (listener.playing) {
      listener.stop();
      stopPlayback();
      return;
    }
    let from = 0;
    let to = drawn;
    let rate = 6000;
    const m = marked.find((x) => x.q.id === selected);
    if (m) {
      from = Math.max(0, Math.floor((m.q.time - trace.t0) / 1000) - 60);
      to = Math.min(drawn, from + 3 * 3600);
      rate = 2000;
    }
    listenBtn.setAttribute('aria-pressed', 'true');
    await listener.play(trace, from, to, rate, noise);
    if (!listener.playing) stopPlayback();
  });

  // ---- Controls -----------------------------------------------------------

  select.addEventListener('change', () => {
    const s = STATIONS.find((x) => x.code === select.value);
    if (!s) return;
    const url = new URL(location.href);
    url.searchParams.set('station', s.code);
    history.replaceState(null, '', url);
    selected = null;
    choose(null, false);
    void loadStation(s);
  });

  root.querySelectorAll<HTMLInputElement>('input[name="sg-row"]').forEach((r) =>
    r.addEventListener('change', () => {
      rowSec = Number(r.value) * 60;
      relayout();
    }),
  );

  root.querySelectorAll<HTMLButtonElement>('[data-gain]').forEach((b) =>
    b.addEventListener('click', () => {
      gainStep = Math.max(0, Math.min(GAINS.length - 1, gainStep + Number(b.dataset.gain)));
      relayout();
    }),
  );

  quakeList.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-quake]');
    if (b) choose(b.dataset.quake!, true);
  });

  marks.addEventListener('click', (e) => {
    const f = (e.target as Element).closest<HTMLElement>('.flag');
    if (f?.dataset.quake) choose(f.dataset.quake, false);
  });

  const dialCanvas = $<HTMLCanvasElement>('[data-dial]');
  dialCanvas.addEventListener('click', (e) => {
    const r = dialCanvas.getBoundingClientRect();
    const id = dial.hit(e.clientX - r.left, e.clientY - r.top);
    if (id) choose(id, true);
  });

  paper.addEventListener('pointermove', (e) => {
    if (!trace) return;
    const r = paper.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const at = drum.timeAt(x, y);
    if (!at) {
      cursor.hidden = true;
      return;
    }
    cursor.hidden = false;
    cursor.style.left = `${x}px`;
    cursor.style.top = `${drum.baseline(at.row) - drum.lay.rowH * 0.9}px`;
    cursor.style.height = `${drum.lay.rowH * 1.8}px`;
    cursor.style.bottom = 'auto';
    cursor.classList.toggle('flip', x > drum.width - 190);
    const i = Math.round((at.time - trace.t0) / 1000);
    const v = i < trace.end ? trace.values[i] : NaN;
    const st = new Intl.DateTimeFormat(undefined, { timeZone: station.zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const lines = [`${utc(at.time)} UTC`, `${localFmt.format(at.time)} your time`, `${st.format(at.time)} at ${station.code}`];
    if (!Number.isNaN(v)) lines.push(`${speed(Math.abs(v) / station.scale)} ${v >= 0 ? 'up' : 'down'}`);
    cursorText.textContent = lines.join('\n');
  });
  paper.addEventListener('pointerleave', () => {
    cursor.hidden = true;
  });

  let resizeTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (Math.round(paper.clientWidth) !== drum.width) relayout();
      dial.resize();
    }, 80);
  }).observe(root);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void poll();
  });

  void document.fonts.ready.then(() => {
    dial.resize();
    void loadStation(station);
    void loadQuakes();
    clearInterval(polling);
    polling = window.setInterval(() => void poll(), POLL_MS);
    window.setInterval(() => void loadQuakes(), QUAKE_POLL_MS);
    requestAnimationFrame(frame);
  });
}
