// Ropesight: the tower, the band, and you on one rope.

import { BAND, Performance, SPEEDS, conductor, type Judgement } from './_band';
import { Bell } from './_bell';
import { drawLine, drawStriking } from './_charts';
import { makePlan, methodById, type Plan } from './_method';
import { Ring, castRing } from './_sound';
import { BELLS, CROWN_FRAC, LEVELS, ROPE, ceilingAt, circlePos, floorAt, pxPerMetre, ropeDrop } from './_tower';

const SVGNS = 'http://www.w3.org/2000/svg';
/** Every blow is heard this long after the physics strikes it, so frame timing never jitters the rhythm. */
const LATENCY = 0.035;

const PLACE_NAMES = ['lead', '2nds', '3rds', '4ths', '5ths', '6ths'];
const BELL_NAMES = ['treble', '2nd', '3rd', '4th', '5th', 'tenor'];

interface RopeEls {
  g: SVGGElement;
  upper: SVGLineElement;
  sally: SVGRectElement;
  lower: SVGLineElement;
  tail: SVGPathElement;
  cue: SVGCircleElement | null;
  k: number;
  z: number;
  x: number;
  s: number;
}

export function start(root: HTMLElement): void {
  const svg = root.querySelector<SVGSVGElement>('svg.tower')!;
  const form = root.querySelector<HTMLFormElement>('form.setup')!;
  const live = root.querySelector<HTMLElement>('.live')!;
  const result = root.querySelector<HTMLElement>('.result')!;
  const caption = root.querySelector<HTMLElement>('.caption')!;
  const placeEl = root.querySelector<HTMLElement>('.place-note')!;
  const followEl = root.querySelector<HTMLElement>('.follow-note')!;
  const lastEl = root.querySelector<HTMLElement>('.last')!;
  const lineCanvas = root.querySelector<HTMLCanvasElement>('canvas.blue-line')!;
  const strikeCanvas = root.querySelector<HTMLCanvasElement>('canvas.striking')!;
  const touchSel = form.querySelector<HTMLSelectElement>('select[name="touch"]')!;
  const towerWrap = root.querySelector<HTMLElement>('.tower-wrap')!;
  const yoursText = svg.querySelector<SVGTextElement>('[data-yours]');

  const bellGroups = [...svg.querySelectorAll<SVGGElement>('g.bell')];
  const swings = bellGroups.map((g) => [...g.querySelectorAll<SVGGElement>('.swing')]);
  const plaques = [...svg.querySelectorAll<SVGGElement>('g.plaque')];
  const clappers = bellGroups.map((g) => g.querySelector<SVGGElement>('.clapper')!);
  const runs = [...svg.querySelectorAll<SVGLineElement>('.rope-runs line')];
  const ropesG = svg.querySelector<SVGGElement>('g.ropes')!;
  const spotsG = svg.querySelector<SVGGElement>('g.spots');
  const bossesG = svg.querySelector<SVGGElement>('g.bosses');
  const pendulum = svg.querySelector<SVGGElement>('.pendulum');
  const hourHand = svg.querySelector<SVGLineElement>('.hand.hour');
  const minuteHand = svg.querySelector<SVGLineElement>('.hand.minute');

  // Idle bells: up, at their stays, waiting.
  let idleBells: Bell[] = Array.from({ length: 6 }, () => new Bell());
  let ropes: RopeEls[] = [];
  let mine = 3; // 1-based
  let perf: Performance | null = null;
  let plan: Plan | null = null;
  let ctx: AudioContext | null = null;
  let ring: Ring | null = null;
  let state: 'idle' | 'ringing' | 'done' = 'idle';
  // Cast the bells while the page settles, so the first pull isn't kept waiting.
  let buffers: AudioBuffer[] | null = null;
  const casting = typeof OfflineAudioContext === 'function' ? castRing().then((b) => (buffers = b)) : null;
  casting?.catch(() => undefined);
  let guide = true;
  const pending: number[] = [];
  let captionUntil = 0;
  let shownCaption = -1;
  let lastRow = -2;
  let lookTo: { at: number; text: string; who: string }[] = [];
  let startedAt = 0;

  // The simulation keeps the page's clock, which runs whether or not sound has been allowed to start; each
  // blow is mapped onto the audio clock as it is scheduled.
  const clock = () => performance.now() / 1000;
  const eventTime = (e: Event) => {
    const now = clock();
    const t = e.timeStamp / 1000;
    return t > now - 0.25 && t <= now ? t : now;
  };
  const toAudio = (t: number) => (ctx ? ctx.currentTime + (t - clock()) : 0);

  // ---- Setup form ----
  const fillTouches = () => {
    const def = methodById(String(new FormData(form).get('method')));
    touchSel.replaceChildren(
      ...def.touches.map((t, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = t.label;
        return o;
      }),
    );
  };
  fillTouches();
  form.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'method') fillTouches();
    if (t.name === 'bell') {
      mine = Number(t.value);
      layoutRopes();
    }
    if (t.name === 'guide') guide = t.checked;
  });
  mine = Number(new FormData(form).get('bell') ?? 3);
  guide = form.querySelector<HTMLInputElement>('input[name="guide"]')?.checked ?? true;

  // ---- Ropes in the circle ----
  function layoutRopes(): void {
    ropesG.replaceChildren();
    spotsG?.replaceChildren();
    bossesG?.replaceChildren();
    ropes = [];
    for (let k = 0; k < 6; k++) {
      const p = circlePos(k + 1);
      const g = document.createElementNS(SVGNS, 'g');
      g.classList.add('rope');
      if (k + 1 === mine) g.classList.add('mine');
      const upper = document.createElementNS(SVGNS, 'line');
      upper.classList.add('hemp');
      const lower = document.createElementNS(SVGNS, 'line');
      lower.classList.add('hemp');
      const sally = document.createElementNS(SVGNS, 'rect');
      sally.classList.add('sally');
      const tail = document.createElementNS(SVGNS, 'path');
      tail.classList.add('tail');
      let cue: SVGCircleElement | null = null;
      g.append(upper, lower, tail, sally);
      if (k + 1 === mine) {
        cue = document.createElementNS(SVGNS, 'circle');
        cue.classList.add('cue-ring');
        g.append(cue);
      }
      ropes.push({ g, upper, sally, lower, tail, cue, k, z: p.z, x: p.x, s: p.s });
      // Where each ringer stands, and the boss where the rope comes through the ceiling.
      const spot = document.createElementNS(SVGNS, 'ellipse');
      spot.setAttribute('cx', p.x.toFixed(1));
      spot.setAttribute('cy', (floorAt(p.z) - 2).toFixed(1));
      spot.setAttribute('rx', (17 * p.s).toFixed(1));
      spot.setAttribute('ry', (4.2 * p.s).toFixed(1));
      if (k + 1 === mine) spot.classList.add('mine');
      spotsG?.append(spot);
      const boss = document.createElementNS(SVGNS, 'ellipse');
      boss.setAttribute('cx', p.x.toFixed(1));
      boss.setAttribute('cy', ceilingAt(p.z).toFixed(1));
      boss.setAttribute('rx', (7 * p.s).toFixed(1));
      boss.setAttribute('ry', (2.2 * p.s).toFixed(1));
      bossesG?.append(boss);
      runs[k]?.setAttribute('x2', p.x.toFixed(1));
      runs[k]?.setAttribute('y2', String(LEVELS.clockFloor));
      runs[k]?.setAttribute('x1', ropeDrop(k).toFixed(1));
    }
    // Back of the circle first, so nearer ropes pass in front.
    for (const r of [...ropes].sort((a, b) => a.z - b.z)) ropesG.append(r.g);
    bellGroups.forEach((g, i) => g.classList.toggle('mine', i + 1 === mine));
    plaques.forEach((g, i) => g.classList.toggle('mine', i + 1 === mine));
    renderScene(idleBells);
  }

  function renderRope(r: RopeEls, travel: number, now: number, cueAt: number | null): void {
    const ppm = pxPerMetre(r.z);
    const floor = floorAt(r.z);
    const lift = travel * ROPE.travel;
    const sTop = floor - (ROPE.sallyHigh + lift) * ppm;
    const sBot = floor - (ROPE.sallyLow + lift) * ppm;
    const tailY = floor - (ROPE.tailEnd + lift) * ppm;
    const w = 11 * r.s;
    const rw = 2.8 * r.s;
    r.upper.setAttribute('x1', r.x.toFixed(1));
    r.upper.setAttribute('x2', r.x.toFixed(1));
    r.upper.setAttribute('y1', ceilingAt(r.z).toFixed(1));
    r.upper.setAttribute('y2', sTop.toFixed(1));
    r.upper.style.strokeWidth = rw.toFixed(2);
    r.sally.setAttribute('x', (r.x - w / 2).toFixed(1));
    r.sally.setAttribute('y', sTop.toFixed(1));
    r.sally.setAttribute('width', w.toFixed(1));
    r.sally.setAttribute('height', (sBot - sTop).toFixed(1));
    r.sally.setAttribute('rx', (w / 2).toFixed(1));
    r.lower.setAttribute('x1', r.x.toFixed(1));
    r.lower.setAttribute('x2', r.x.toFixed(1));
    r.lower.setAttribute('y1', sBot.toFixed(1));
    r.lower.setAttribute('y2', (tailY - 6 * r.s).toFixed(1));
    r.lower.style.strokeWidth = rw.toFixed(2);
    // The tail end, doubled back on itself in a loop.
    const ty = tailY - 6 * r.s;
    const lw = 5 * r.s;
    r.tail.setAttribute(
      'd',
      `M ${r.x.toFixed(1)} ${ty.toFixed(1)} C ${(r.x - lw).toFixed(1)} ${(ty + 4 * r.s).toFixed(1)} ${(r.x - lw * 0.6).toFixed(1)} ${(tailY + 7 * r.s).toFixed(1)} ${r.x.toFixed(1)} ${(tailY + 7 * r.s).toFixed(1)} C ${(r.x + lw * 0.6).toFixed(1)} ${(tailY + 7 * r.s).toFixed(1)} ${(r.x + lw).toFixed(1)} ${(ty + 4 * r.s).toFixed(1)} ${r.x.toFixed(1)} ${ty.toFixed(1)}`,
    );
    r.tail.style.strokeWidth = rw.toFixed(2);
    if (r.cue) {
      // The guide: a ring that closes on the hand you pull with as the moment to pull arrives.
      const handY = travel < 0.5 ? (sTop + sBot) / 2 : tailY;
      if (cueAt === null || !guide) {
        r.cue.style.opacity = '0';
      } else {
        const left = cueAt - now;
        const k = Math.max(0, Math.min(1, left / 0.9));
        r.cue.setAttribute('cx', r.x.toFixed(1));
        r.cue.setAttribute('cy', handY.toFixed(1));
        r.cue.setAttribute('r', (9 + 34 * k).toFixed(1));
        r.cue.style.opacity = left > 0.9 || left < -0.25 ? '0' : left < 0 ? String(1 + left * 4) : String(0.35 + 0.65 * (1 - k));
        r.cue.classList.toggle('now', left <= 0.04);
      }
    }
  }

  function renderScene(bells: Bell[], now = clock(), cueAt: number | null = null, follow = -1): void {
    for (let i = 0; i < 6; i++) {
      const b = bells[i];
      const deg = (-b.theta * 180) / Math.PI;
      for (const sw of swings[i]) sw.setAttribute('transform', `rotate(${deg.toFixed(2)})`);
      // The clapper hangs from the crown, which the bell carries round on its swing.
      const h = BELLS[i].h;
      const crown = CROWN_FRAC * h;
      const cx = Math.sin(b.theta) * crown;
      const cy = Math.cos(b.theta) * crown;
      // The drawn clapper swings a little wider than the model's so its ball visibly meets the soundbow.
      const phi = b.theta + (b.phi - b.theta) * 1.4;
      clappers[i].setAttribute('transform', `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${((-phi * 180) / Math.PI).toFixed(2)})`);
      bellGroups[i].classList.toggle('follow', i === follow);
      plaques[i]?.classList.toggle('follow', i === follow);
    }
    for (const r of ropes) {
      renderRope(r, bells[r.k].rope(), now, r.cue ? cueAt : null);
      r.g.classList.toggle('follow', r.k === follow);
    }
  }

  layoutRopes();

  // ---- Clock and dial ----
  function renderClock(): void {
    const t = performance.now() / 1000;
    // A seconds pendulum: two seconds a full swing.
    pendulum?.setAttribute('transform', `rotate(${(Math.sin((t * Math.PI) / 1) * 6).toFixed(2)})`);
    const d = new Date();
    const min = d.getMinutes() + d.getSeconds() / 60;
    const hr = (d.getHours() % 12) + min / 60;
    hourHand?.setAttribute('transform', `rotate(${(hr * 30).toFixed(1)})`);
    minuteHand?.setAttribute('transform', `rotate(${(min * 6).toFixed(1)})`);
  }

  // ---- Input ----
  function pullNow(e: Event): void {
    if (state !== 'ringing' || !perf || perf.listen) return;
    pending.push(eventTime(e));
  }
  towerWrap.addEventListener('pointerdown', (e) => {
    if (state === 'ringing') {
      e.preventDefault();
      pullNow(e);
    }
  });
  root.querySelector('.pull')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pullNow(e);
  });
  window.addEventListener('keydown', (e) => {
    if (state !== 'ringing') return;
    if (e.code === 'Space' || e.code === 'Enter' || e.key === 'j' || e.key === 'f') {
      if (e.repeat) return;
      e.preventDefault();
      pullNow(e);
    }
    if (e.key === 'Escape') stand('You stood your bell.');
  });

  // ---- Captions ----
  function say(text: string, who: string, now: number, hold = 1.6): void {
    caption.innerHTML = '';
    const small = document.createElement('small');
    small.textContent = who;
    caption.append(small, document.createTextNode(text));
    caption.classList.add('on');
    captionUntil = now + hold;
  }

  // ---- Ringing ----
  function begin(listenOnly: boolean): void {
    const data = new FormData(form);
    const def = methodById(String(data.get('method')));
    const touch = def.touches[Number(data.get('touch') ?? 0)] ?? def.touches[0];
    const gap = SPEEDS[(String(data.get('speed')) as keyof typeof SPEEDS) || 'steady'] ?? SPEEDS.steady;
    mine = Number(data.get('bell') ?? 3);
    guide = data.get('guide') === 'on';
    try {
      if (!ctx) ctx = new AudioContext();
      if (ctx.state === 'suspended') void ctx.resume();
      const live = ctx;
      if (!ring && buffers) ring = new Ring(live, buffers);
      else if (!ring) void casting?.then((b) => (ring = ring ?? new Ring(live, b)));
      ring?.wake();
    } catch {
      ctx = null;
      ring = null;
    }
    plan = makePlan(def, touch.calls);
    const now = clock();
    const cond = conductor(mine);
    const treble = mine === 1 && !listenOnly ? 'You' : BAND[0].name;
    perf = new Performance(plan, mine - 1, gap, now, now + 2.6, Math.floor(Math.random() * 1e6), listenOnly);
    perf.onStrike = (i, at, speed) => ring?.strike(i, toAudio(at + LATENCY), 0.45 + speed / 10);
    perf.onJudge = judged;
    startedAt = now;
    lookTo = [
      { at: now + 0.05, text: 'Look to!', who: BAND[cond].name },
      { at: now + 1.3, text: "Treble's going", who: treble },
      { at: now + 2.6, text: "She's gone", who: treble },
    ];
    shownCaption = -1;
    lastRow = -2;
    state = 'ringing';
    root.dataset.state = 'ringing';
    form.hidden = true;
    result.hidden = true;
    live.hidden = false;
    lastEl.textContent = listenOnly
      ? `${BAND[mine - 1].name} is ringing the ${BELL_NAMES[mine - 1]} for you. Watch the blue line.`
      : '';
    if (yoursText) yoursText.textContent = 'Your touch goes here';
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    begin(false);
  });
  root.querySelector('.listen')?.addEventListener('click', () => begin(true));

  function judged(j: Judgement): void {
    if (!perf) return;
    if (j.error === null) {
      lastEl.textContent = 'Missed a blow';
      return;
    }
    const ms = Math.round(j.error * 1000);
    const abs = Math.abs(ms);
    let word: string;
    if (j.wrongPlace) word = ms > 0 ? 'Far too late: you struck in the next place' : 'Far too early: you cut in';
    else if (abs <= 20) word = 'Right on the beat';
    else if (abs <= 45) word = `${abs} ms ${ms > 0 ? 'late' : 'early'}`;
    else if (abs <= 100) word = `${abs} ms ${ms > 0 ? 'late, hold back less' : 'early, wait a touch'}`;
    else word = `${abs} ms ${ms > 0 ? 'late' : 'early'}: watch the rope you follow`;
    lastEl.textContent = word;
  }

  function stand(why: string): void {
    if (!perf || state !== 'ringing') return;
    perf.stand();
    finish(why);
  }

  function finish(why = ''): void {
    if (!perf || !plan) return;
    state = 'done';
    root.dataset.state = 'done';
    live.hidden = true;
    result.hidden = false;
    const s = perf.summary();
    const elapsed = Math.max(0, clock() - startedAt);
    const board = result.querySelector<HTMLElement>('.peal-board')!;
    const verdict = result.querySelector<HTMLElement>('.verdict')!;
    const complete = perf.finished && !perf.aborted;
    const touchName = plan.def.id === 'rounds' ? 'ROUNDS' : `${plan.changes} ${plan.def.name.toUpperCase()}`;
    board.hidden = !complete || perf.listen;
    if (complete && !perf.listen) {
      const date = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
      board.querySelector('.pb-date')!.textContent = `On ${date}`;
      board.querySelector('.pb-was')!.textContent = plan.def.id === 'rounds' ? 'were rung' : 'was rung a touch of';
      board.querySelector('.pb-touch')!.textContent = touchName;
      const mins = Math.floor(elapsed / 60);
      const secs = Math.round(elapsed % 60);
      board.querySelector('.pb-time')!.textContent = `in ${mins ? `${mins} min ` : ''}${secs} s`;
      const list = board.querySelector('.pb-band')!;
      list.replaceChildren(
        ...BAND.map((r, i) => {
          const li = document.createElement('li');
          if (i + 1 === mine) li.classList.add('you');
          const a = document.createElement('span');
          a.textContent = i === 0 ? 'Treble' : i === 5 ? 'Tenor' : String(i + 1);
          const b = document.createElement('span');
          const cond = conductor(mine) === i && i + 1 !== mine ? ' (C)' : '';
          b.textContent = i + 1 === mine ? 'You' : `${r.full}${cond}`;
          li.append(a, b);
          return li;
        }),
      );
      const pct = s.blows ? Math.round(((s.good + s.fair * 0.5) / s.blows) * 100) : 0;
      board.querySelector('.pb-note')!.textContent = `Striking ${pct}% · ${Math.round(s.rms * 1000)} ms from the beat`;
      if (yoursText) yoursText.textContent = `${touchName.slice(0, 26)} · ${pct}%`;
    }
    let text: string;
    if (perf.listen) text = 'That was the band on their own. Take your rope and ring it with them.';
    else if (!complete) text = why || 'The band stood.';
    else if (s.blows === 0) text = 'That came round.';
    else {
      const late = s.mean > 0.02 ? ' You were running a little late on average: pull fractionally sooner.' : s.mean < -0.02 ? ' You were running a little early on average: let the rope in front go first.' : '';
      const q =
        s.rms < 0.03
          ? 'Beautifully struck. The band would have you back any week.'
          : s.rms < 0.055
            ? 'Well struck: good, steady ringing.'
            : s.rms < 0.09
              ? 'A decent touch. A few blows wandered, but it came round.'
              : 'Rough in places, but you kept going and it came round. That counts.';
      text = `${q} ${s.good} of ${s.blows} blows within 45 ms of the beat${s.missed ? `, ${s.missed} missed` : ''}.${late}`;
    }
    verdict.textContent = text;
    caption.classList.remove('on');
  }

  root.querySelector('.stand')?.addEventListener('click', () => stand('You called stand. The band set their bells.'));
  root.querySelector('.again')?.addEventListener('click', () => {
    state = 'idle';
    root.dataset.state = 'idle';
    result.hidden = true;
    form.hidden = false;
    perf = null;
    idleBells = Array.from({ length: 6 }, () => new Bell());
    renderScene(idleBells);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state === 'ringing') stand('The band stood their bells when you left the tower.');
      ring?.hush();
      void ctx?.suspend();
    }
  });

  // A handle for automated checks, only with ?debug: the performance, so a test can time its pulls.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { ropesight: unknown }).ropesight = { perf: () => perf, state: () => state };
  }

  // ---- Frame loop ----
  function frame(): void {
    renderClock();
    const now = clock();
    if (state === 'ringing' && perf && plan) {
      // Pulls land at the moment you made them, not the moment the frame got round to them.
      pending.sort((a, b) => a - b);
      while (pending.length) {
        const t = Math.max(perf.clock, Math.min(now, pending.shift()!));
        perf.advance(t);
        perf.yourPull(t);
      }
      perf.advance(now);
      const gaveUp = perf.sweep(now);
      if (gaveUp) stand('You stopped ringing, so the band stood their bells.');
      else if (perf.finished) finish();

      // Captions: the look-to, then the conductor's calls as their rows come up.
      for (let k = shownCaption + 1; k < lookTo.length; k++) {
        if (now < lookTo[k].at) break;
        say(lookTo[k].text, lookTo[k].who, now, 1.2);
        shownCaption = k;
      }
      const row = perf.rowAt(now);
      if (row !== lastRow) {
        for (const c of plan.captions) {
          if (c.row === row && c.row > lastRow) {
            const cond = BAND[conductor(mine)].name;
            say(c.text, cond, now, 1.8);
          }
        }
        lastRow = row;
      }
      if (now > captionUntil) caption.classList.remove('on');

      // Where you are, whom you follow, and when to pull.
      const next = perf.yourNext();
      let follow = -1;
      let cueAt: number | null = null;
      const viewMine = mine;
      const shownRow = Math.max(0, perf.rowAt(now));
      if (next) {
        const r = plan.rows[next.row];
        placeEl.textContent = `${PLACE_NAMES[next.place][0].toUpperCase()}${PLACE_NAMES[next.place].slice(1)}`;
        const prev = next.place > 0 ? r[next.place - 1] : plan.rows[next.row - 1]?.[5];
        if (next.place > 0 && prev) {
          follow = prev - 1;
          followEl.textContent = `follow the ${BELL_NAMES[follow]}`;
        } else {
          // At lead you follow the last bell of the row before, over the handstroke gap or straight on.
          follow = prev ? prev - 1 : -1;
          followEl.textContent = prev ? `lead, after the ${BELL_NAMES[prev - 1]}` : 'lead';
        }
        if (!perf.listen) cueAt = next.ideal - perf.delay;
      } else {
        placeEl.textContent = '';
        followEl.textContent = '';
      }
      renderScene(perf.bells, now, cueAt, follow);
      drawLine(lineCanvas, perf, shownRow, viewMine);
      drawStriking(strikeCanvas, perf, shownRow, viewMine);
    } else if (state !== 'ringing') {
      const b = perf ? perf.bells : idleBells;
      if (perf) perf.advance(now);
      renderScene(b, now);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
