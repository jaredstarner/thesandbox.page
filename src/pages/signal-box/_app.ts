// Signal box: the page. Builds the frame, shelf, diagram, and window, runs the box
// against the clock, and plays what happens.

import { CLASSES, CODE_END, CODE_MEANING, beatTimes } from './_codes';
import { Diagram } from './_diagram';
import { Frame } from './_frame';
import { act, actionTime, advise, type Advice } from './_guide';
import { BOXES, LEVER, type BoxId } from './_layout';
import { Clock, Instrument } from './_shelf';
import { Box, type BlockState, type BoxEvent } from './_sim';
import { Sound } from './_sound';
import { SHIFT, SHIFTS, clock, type ShiftId } from './_timetable';
import { View } from './_view';

const IDS: BoxId[] = ['callow', 'pell', 'marsh'];
const LABELS: Record<BoxId, { out: string; in: string }> = {
  callow: { out: 'UP LINE', in: 'DOWN LINE' },
  marsh: { out: 'DOWN MAIN', in: 'UP MAIN' },
  pell: { out: 'DOWN BRANCH', in: 'UP BRANCH' },
};
const STORE = 'signalbox:v1';

type Mode = 'intro' | 'running' | 'demo' | 'ended';

export function startSignalBox(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const debug = new URLSearchParams(location.search).has('debug');
  const sound = new Sound();
  const view = new View(q<HTMLCanvasElement>('[data-view]'));
  const diagram = new Diagram();
  q('[data-diagram]').append(diagram.svg);
  const clockFace = new Clock();
  q('[data-clock]').append(clockFace.svg);

  let box: Box;
  let shiftId: ShiftId = 'early';
  let mode: Mode = 'intro';
  let guide = true;
  let hurry = false;
  let demoBusy = 0;
  const demoTaps: { t: number; box: BoxId }[] = [];
  let hintFlash = 0;
  let lastAdvice: Advice | null = null;
  let registerStamp = '';

  const frame = new Frame((n) => {
    if (mode !== 'running') return nudge();
    sound.unlock();
    box.pull(n);
  });
  q('[data-frame]').append(frame.svg);

  const instruments = {} as Record<BoxId, Instrument>;
  for (const id of IDS) {
    const ins = new Instrument(
      id,
      LABELS[id],
      () => {
        if (mode !== 'running') return nudge();
        sound.unlock();
        sound.tap();
        box.tap(id);
      },
      (st: BlockState) => {
        if (mode !== 'running') return nudge();
        sound.unlock();
        box.setCommutator(id, st);
      },
    );
    instruments[id] = ins;
    q(`[data-instrument="${id}"]`).append(ins.root);
  }

  const hint = q<HTMLElement>('[data-hint]');
  const phone = q<HTMLElement>('[data-phone]');
  const register = q<HTMLElement>('[data-register]');
  const intro = q<HTMLElement>('[data-intro]');
  const report = q<HTMLElement>('[data-report]');
  const guideBtn = q<HTMLButtonElement>('[data-guide]');
  const hurryBtn = q<HTMLButtonElement>('[data-hurry]');
  const soundBtn = q<HTMLButtonElement>('[data-sound]');
  const demoBtn = q<HTMLButtonElement>('[data-demo]');
  const turnLabel = q<HTMLElement>('[data-turn]');

  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    if (typeof saved.guide === 'boolean') guide = saved.guide;
    if (typeof saved.muted === 'boolean') sound.muted = saved.muted;
  } catch {}
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ guide, muted: sound.muted }));
    } catch {}
  };

  function newBox(id: ShiftId): void {
    shiftId = id;
    box = new Box(SHIFT.get(id)!, 1);
    view.setShift(id);
    root.dataset.shift = id;
    turnLabel.textContent = `${SHIFT.get(id)!.name}, from ${clock(SHIFT.get(id)!.start)}`;
    registerStamp = '';
    phone.replaceChildren();
    phone.classList.remove('on');
    demoTaps.length = 0;
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-pick]')) b.setAttribute('aria-pressed', String(b.dataset.pick === id));
    renderRegister();
  }

  function begin(m: 'running' | 'demo'): void {
    sound.unlock();
    if (mode === 'ended' || mode === m || box.t > 0) newBox(shiftId);
    mode = m;
    root.dataset.mode = m;
    intro.hidden = true;
    report.hidden = true;
    demoBtn.setAttribute('aria-pressed', String(m === 'demo'));
    demoBusy = box.t + 1;
    setHint(m === 'demo' ? 'Demonstration: the box is being worked for you. Watch the bells, the needles, and the levers.' : '');
  }

  function nudge(): void {
    if (mode === 'demo') setHint('This is the demonstration. Take the turn yourself to work the frame.', 4);
    else if (mode === 'intro') intro.classList.add('wiggle');
    setTimeout(() => intro.classList.remove('wiggle'), 400);
  }

  function setHint(text: string, hold = 0): void {
    if (hint.textContent !== text) hint.textContent = text;
    hint.classList.toggle('on', text !== '');
    hintFlash = hold;
  }

  // Controls.
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-pick]'))
    b.addEventListener('click', () => {
      const id = b.dataset.pick as ShiftId;
      newBox(id);
      if (mode !== 'intro') {
        mode = 'intro';
        root.dataset.mode = 'intro';
        intro.hidden = false;
        report.hidden = true;
      }
    });
  q('[data-start]').addEventListener('click', () => begin('running'));
  q('[data-watch]').addEventListener('click', () => begin('demo'));
  demoBtn.addEventListener('click', () => {
    if (mode === 'demo') {
      mode = 'running';
      root.dataset.mode = 'running';
      demoBtn.setAttribute('aria-pressed', 'false');
      setHint('You have the box. The demonstration has stopped where it was.', 5);
    } else begin('demo');
  });
  guideBtn.addEventListener('click', () => {
    guide = !guide;
    guideBtn.setAttribute('aria-pressed', String(guide));
    save();
    if (!guide) highlight(null);
  });
  guideBtn.setAttribute('aria-pressed', String(guide));
  hurryBtn.addEventListener('click', () => {
    hurry = !hurry;
    hurryBtn.setAttribute('aria-pressed', String(hurry));
  });
  soundBtn.addEventListener('click', () => {
    sound.unlock();
    sound.setMuted(!sound.muted);
    soundBtn.setAttribute('aria-pressed', String(!sound.muted));
    save();
  });
  soundBtn.setAttribute('aria-pressed', String(!sound.muted));
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-again]')) b.addEventListener('click', () => begin('running'));
  q('[data-next]').addEventListener('click', () => {
    const i = SHIFTS.findIndex((s) => s.id === shiftId);
    newBox(SHIFTS[(i + 1) % SHIFTS.length].id);
    begin('running');
  });

  // Bell codes on the card.
  const card = q<HTMLElement>('[data-codes]');
  for (const [code, meaning] of CODE_MEANING) {
    const row = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = code;
    const s = document.createElement('span');
    s.textContent = meaning;
    row.append(b, s);
    card.append(row);
  }

  newBox(shiftId);

  // Events from the box.
  function handle(e: BoxEvent): void {
    switch (e.type) {
      case 'bell': {
        const ins = instruments[e.box];
        for (const bt of e.beats) {
          const delay = Math.max(0, bt - box.t);
          sound.bell(e.box, delay);
          setTimeout(() => ins.ring(), delay * 1000);
        }
        const last = e.beats[e.beats.length - 1] - box.t;
        setTimeout(() => ins.say(`${BOXES[e.box].name} rang ${e.code}: ${box.meaning(e.code)}`), last * 1000 + 300);
        if (hurry) stopHurry();
        break;
      }
      case 'sent':
        instruments[e.box].say(`You rang ${e.code}: ${box.meaning(e.code)}`, 6);
        break;
      case 'phone':
        sound.phone();
        showPhone(e.from, e.text);
        if (hurry) stopHurry();
        break;
      case 'lever':
        sound.lever(LEVER.get(e.n)!.kind, e.dur);
        break;
      case 'locked':
        sound.locked();
        frame.jolt(e.n);
        setHint(`Lever ${e.n} won't come: ${e.reason}.`, 5);
        break;
      case 'refused':
        sound.locked();
        setHint(`${e.reason}.`, 5);
        break;
      case 'needle':
        if (e.which === 'in') sound.commutator();
        break;
      case 'irregular':
        if (mode === 'running') setHint(`Irregularity: ${e.text}.`, 7);
        break;
      case 'horn': {
        const tr = box.trains[e.train];
        const w = view.pan(tr);
        sound.horn(tr.vehicles[0].kind === 'steam', w.pan, w.dist);
        break;
      }
      case 'end':
        finish();
        break;
    }
  }

  function stopHurry(): void {
    hurry = false;
    hurryBtn.setAttribute('aria-pressed', 'false');
  }

  function showPhone(from: string, text: string): void {
    const p = document.createElement('p');
    const who = document.createElement('b');
    who.textContent = `${clock(box.shift.start + box.t)} ${from}`;
    p.append(who, document.createTextNode(` ${text}`));
    phone.prepend(p);
    while (phone.children.length > 3) phone.lastElementChild?.remove();
    phone.classList.add('on');
  }

  function highlight(a: Advice | null): void {
    frame.highlight(a?.kind === 'lever' ? a.n : null);
    for (const id of IDS) {
      const part = a?.kind === 'tap' && a.box === id ? 'tapper' : a?.kind === 'block' && a.box === id ? a.state : null;
      instruments[id].highlight(part);
    }
  }

  function renderRegister(): void {
    const stamp = box.trains.map((t) => JSON.stringify(t.entry) + (box.lateness(t) ?? '')).join('|');
    if (stamp === registerStamp) return;
    registerStamp = stamp;
    const start = box.shift.start;
    const tm = (x: number | undefined) => (x === undefined ? '' : clock(start + x));
    const rows = box.trains.map((tr) => {
      const e = tr.entry;
      const c = CLASSES[tr.b.cls];
      const late = box.lateness(tr);
      const tds = [
        `<td class="hc"><b>${tr.b.hc}</b><small>${c.code} ${c.short}, to ${BOXES[tr.to].short}</small></td>`,
        `<td class="bk">${clock(start + e.booked)}</td>`,
        `<td class="w">${tm(e.acceptedAt)}</td>`,
        `<td class="w">${tm(e.acceptedOnAt)}</td>`,
        `<td class="w">${tm(e.passedAt)}</td>`,
        `<td class="w">${tm(e.outAt)}</td>`,
        `<td class="w late">${late === null ? '' : late === 0 ? 'R.T.' : `${late}L`}</td>`,
      ];
      const cls = tr.state === 'running' ? 'live' : tr.state === 'gone' && e.outAt !== undefined ? 'done' : '';
      return `<tr class="${cls}">${tds.join('')}</tr>`;
    });
    register.innerHTML = `<table><thead><tr><th>Train</th><th>Booked</th><th>Accepted</th><th>Line clear on</th><th>Passed</th><th>Out of section</th><th>Time</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  function finish(): void {
    mode = 'ended';
    root.dataset.mode = 'ended';
    highlight(null);
    const trains = box.trains.length;
    const late = box.trains.map((t) => box.lateness(t) ?? 0);
    const rt = late.filter((l) => l === 0).length;
    const mins = late.reduce((a, b) => a + b, 0);
    q('[data-r-turn]').textContent = `${box.shift.name}, ${clock(box.shift.start)} to ${clock(box.shift.start + box.t)}`;
    q('[data-r-trains]').textContent = String(trains);
    q('[data-r-rt]').textContent = `${rt} of ${trains}`;
    q('[data-r-mins]').textContent = mins === 0 ? 'none' : `${mins} min`;
    const list = q<HTMLElement>('[data-r-irr]');
    list.replaceChildren();
    const irr = box.irregularities;
    if (!irr.length) {
      const li = document.createElement('li');
      li.textContent = 'No irregularities.';
      list.append(li);
    } else
      for (const i of irr) {
        const li = document.createElement('li');
        li.textContent = `${clock(box.shift.start + i.t)} ${i.text}.`;
        list.append(li);
      }
    q('[data-r-verdict]').textContent =
      irr.length === 0 && mins === 0
        ? 'A clean turn: every train right time, and nothing for the inspector.'
        : irr.length === 0
          ? 'No irregularities, though the timetable suffered.'
          : 'The inspector will want a word about the irregularities below.';
    report.hidden = false;
  }

  // The demonstration works the box with the guide's advice, at a signalman's pace.
  function demo(): void {
    while (demoTaps.length && demoTaps[0].t <= box.t) {
      const tp = demoTaps.shift()!;
      instruments[tp.box].svg.querySelector('.tapper')?.classList.add('down');
      sound.tap();
      box.tap(tp.box);
    }
    if (box.t < demoBusy || demoTaps.length) return;
    const a = advise(box);
    if (a.kind === 'wait') {
      demoBusy = box.t + 0.4;
      return;
    }
    if (a.kind === 'tap') {
      const bt = beatTimes(a.code);
      for (const b of bt) demoTaps.push({ t: box.t + 0.5 + b, box: a.box });
      demoBusy = box.t + 0.5 + bt[bt.length - 1] + CODE_END + 0.8;
    } else {
      act(box, a);
      demoBusy = box.t + actionTime(a) + 0.6;
    }
  }

  // The loop.
  let last = performance.now();
  let hidden = document.hidden;
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (hidden) sound.suspend();
    else {
      sound.resume();
      last = performance.now();
    }
  });
  const ro = new ResizeObserver(() => view.resize());
  ro.observe(q('[data-view]'));
  view.resize();

  function frameStep(now: number): void {
    requestAnimationFrame(frameStep);
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (hidden) return;
    if (mode === 'running' || mode === 'demo') {
      let speed = 1;
      if (hurry && mode === 'running') {
        const a = advise(box);
        if (a.kind !== 'wait') stopHurry();
        else speed = 6;
      }
      let left = dt * speed;
      while (left > 1e-6) {
        const h = Math.min(left, 1 / 30);
        box.step(h);
        left -= h;
        if (mode === 'demo') demo();
      }
      const evs = box.events;
      box.events = [];
      for (const e of evs) handle(e);
      if (guide && mode === 'running') {
        const a = advise(box);
        lastAdvice = a;
        highlight(a.kind === 'wait' ? null : a);
        if (hintFlash <= 0) setHint(a.why);
      } else if (mode === 'demo') {
        const a = advise(box);
        highlight(a.kind === 'wait' ? null : a);
        if (hintFlash <= 0) setHint(a.kind === 'wait' ? 'Demonstration: waiting for the next bell.' : `Demonstration: ${a.why}`);
      } else if (hintFlash <= 0 && hint.classList.contains('on')) setHint('');
      sound.tick(Math.floor(box.shift.start + box.t));
      sound.trains(box.trains, (tr) => view.pan(tr), dt, false);
      renderRegister();
    } else {
      sound.trains([], (tr) => view.pan(tr), dt, true);
      dt = 0;
    }
    if (hintFlash > 0) hintFlash -= Math.max(dt, 1 / 60);
    for (const id of IDS) instruments[id].update(box, Math.max(dt, 1 / 60));
    frame.update(box, Math.max(dt, 1 / 60));
    diagram.update(box, Math.max(dt, 1 / 60));
    clockFace.show(box.shift.start + box.t);
    view.render(box, dt, box.shift.start + box.t);
  }
  requestAnimationFrame(frameStep);

  let runBusy = 0;
  const runTaps: { t: number; b: BoxId }[] = [];
  if (debug)
    (window as unknown as { signalbox: unknown }).signalbox = {
      get box() {
        return box;
      },
      get mode() {
        return mode;
      },
      get advice() {
        return lastAdvice;
      },
      sound,
      begin,
      newBox,
      advise: () => advise(box),
      act: (a: Advice) => act(box, a),
      /** Run the box forward headlessly, the guide working it, for this many seconds. */
      run(seconds: number, work = true) {
        const taps = runTaps;
        const end = box.t + seconds;
        while (box.t < end && !box.ended) {
          box.step(1 / 30);
          while (taps.length && taps[0].t <= box.t) box.tap(taps.shift()!.b);
          if (!work || box.t < runBusy || taps.length) continue;
          const a = advise(box);
          if (a.kind === 'wait') continue;
          if (a.kind === 'tap') {
            const bt = beatTimes(a.code);
            for (const b of bt) taps.push({ t: box.t + b, b: a.box });
            runBusy = box.t + bt[bt.length - 1] + CODE_END + 0.5;
          } else {
            act(box, a);
            runBusy = box.t + actionTime(a);
          }
        }
        const evs = box.events;
        box.events = [];
        for (const e of evs) if (e.type === 'end') finish();
        return box.t;
      },
    };
}
