// Signal box: the block shelf. One instrument for each box either side: a needle
// that repeats the box ahead's handle, our own needle and handle for the line from
// them, a tapper that rings their bell, and the bell they ring in here. And the clock.

import { BOXES, type BoxId } from './_layout';
import type { BlockState, Box } from './_sim';
import { el, f1, set } from './_svg';

const ANGLE: Record<BlockState, number> = { LC: -66, LB: 0, TOL: 66 };
const ORDER: BlockState[] = ['LC', 'LB', 'TOL'];

export interface InstrumentLabels {
  /** The line our trains take to them: their handle, our upper needle. */
  out: string;
  /** The line their trains take to us: our handle. */
  in: string;
}

/** A needle that swings toward its mark and settles, as a moving-iron needle does. */
class Needle {
  a = 0;
  v = 0;
  constructor(readonly g: SVGGElement) {}
  step(target: number, dt: number): boolean {
    const k = 120;
    const c = 11;
    const acc = k * (target - this.a) - c * this.v;
    this.v += acc * dt;
    this.a += this.v * dt;
    if (Math.abs(target - this.a) < 0.02 && Math.abs(this.v) < 0.05) {
      if (this.a === target) return false;
      this.a = target;
      this.v = 0;
    }
    set(this.g, { transform: `rotate(${f1(this.a)})` });
    return true;
  }
}

function dial(cx: number, cy: number, label: string, id: string): { g: SVGGElement; needle: SVGGElement } {
  const g = el('g', { transform: `translate(${cx} ${cy})` });
  g.append(
    el('circle', { r: 45, fill: '#2a1a10' }),
    el('circle', { r: 43, fill: '#c69a46' }),
    el('circle', { r: 40, fill: '#f4efe2' }),
    el('circle', { r: 40, fill: `url(#sb-dialshade-${id})` }),
  );
  // Three cards behind the needle, as the apertures on a block indicator.
  const marks: [BlockState, string, string, string, number, number][] = [
    ['LC', '#2d6a3b', '#f4efe2', 'LINE|CLEAR', -21, -9],
    ['LB', '#f4efe2', '#1d1a16', 'LINE|BLOCKED', 0, -28],
    ['TOL', '#a8261c', '#f4efe2', 'TRAIN|ON LINE', 21, -9],
  ];
  for (const [, bg, ink, text, x, y] of marks) {
    const [l1, l2] = text.split('|');
    const w = l2.length > 5 ? 30 : 26;
    g.append(
      el('rect', { x: x - w / 2, y: y - 8.5, width: w, height: 17, rx: 2, fill: bg, stroke: '#1d1a16', 'stroke-width': 0.6 }),
      el('text', { x, y: y - 1.6, 'text-anchor': 'middle', class: 'dial-t', fill: ink }, l1),
      el('text', { x, y: y + 5.4, 'text-anchor': 'middle', class: 'dial-t', fill: ink }, l2),
    );
  }
  const needle = el(
    'g',
    {},
    el('polygon', { points: '-2,12 2,12 0.8,-34 -0.8,-34', fill: '#141210' }),
    el('circle', { r: 4.2, fill: '#141210' }),
  );
  g.append(needle, el('circle', { r: 1.4, fill: '#c69a46' }));
  g.append(el('text', { x: 0, y: 56, 'text-anchor': 'middle', class: 'dial-cap' }, label));
  return { g, needle };
}

export class Instrument {
  readonly svg: SVGSVGElement;
  readonly caption: HTMLElement;
  readonly root: HTMLElement;
  private outNeedle: Needle;
  private inNeedle: Needle;
  private handle: SVGGElement;
  private handleA = 0;
  private bell: SVGGElement;
  private bellT = 0;
  private knob: SVGGElement;
  private knobT = 0;
  private tape: SVGTextElement;
  private captionT = 0;

  constructor(
    readonly id: BoxId,
    labels: InstrumentLabels,
    onTap: () => void,
    onTurn: (st: BlockState) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'instrument';
    this.root.dataset.box = id;
    this.svg = el('svg', { viewBox: '0 0 220 250', role: 'group', 'aria-label': `Block instrument for ${BOXES[id].name}` });
    const defs = el(
      'defs',
      {},
      el(
        'linearGradient',
        { id: `sb-case-${id}`, x1: 0, x2: 1, y1: 0, y2: 1 },
        el('stop', { offset: 0, 'stop-color': '#7b3a1d' }),
        el('stop', { offset: 0.45, 'stop-color': '#5a2814' }),
        el('stop', { offset: 1, 'stop-color': '#3a180b' }),
      ),
      el(
        'radialGradient',
        { id: `sb-dialshade-${id}`, cx: 0.4, cy: 0.3, r: 0.8 },
        el('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.35 }),
        el('stop', { offset: 0.7, 'stop-color': '#fff', 'stop-opacity': 0 }),
        el('stop', { offset: 1, 'stop-color': '#5b4a2a', 'stop-opacity': 0.22 }),
      ),
      el(
        'radialGradient',
        { id: `sb-brass-${id}`, cx: 0.35, cy: 0.3, r: 0.9 },
        el('stop', { offset: 0, 'stop-color': '#f7df9a' }),
        el('stop', { offset: 0.5, 'stop-color': '#c99b3f' }),
        el('stop', { offset: 1, 'stop-color': '#7d5a1c' }),
      ),
    );
    this.svg.append(defs);

    // The case, its moulded edge, and the brass plate with the box's name.
    this.svg.append(
      el('rect', { x: 4, y: 24, width: 212, height: 222, rx: 9, fill: '#1e0d05' }),
      el('rect', { x: 6, y: 25, width: 208, height: 218, rx: 8, fill: `url(#sb-case-${id})` }),
      el('rect', { x: 12, y: 31, width: 196, height: 206, rx: 5, fill: 'none', stroke: '#9a5532', 'stroke-opacity': 0.35 }),
      el('rect', { x: 66, y: 32, width: 140, height: 20, rx: 2, fill: `url(#sb-brass-${id})`, stroke: '#5b3f12', 'stroke-width': 0.6 }),
      el('text', { x: 136, y: 46.5, 'text-anchor': 'middle', class: 'nameplate' }, BOXES[id].name.toUpperCase()),
    );

    // The bell they ring, a brass dome on its bracket.
    this.bell = el(
      'g',
      { transform: 'translate(34 26)' },
      el('rect', { x: -2, y: -2, width: 4, height: 10, fill: '#3a2a1a' }),
      el('path', { d: 'M -19 2 Q -19 -18 0 -18 Q 19 -18 19 2 Z', fill: `url(#sb-brass-${id})`, stroke: '#5b3f12', 'stroke-width': 0.8 }),
      el('ellipse', { cx: 0, cy: 2, rx: 19, ry: 3, fill: '#8a6424' }),
      el('circle', { cx: 0, cy: -19, r: 2.6, fill: '#5b3f12' }),
    );
    this.svg.append(this.bell);

    const o = dial(59, 108, labels.out, id);
    const i = dial(161, 108, labels.in, id);
    this.outNeedle = new Needle(o.needle);
    this.inNeedle = new Needle(i.needle);
    this.svg.append(o.g, i.g);

    // The tapper: a black knob on a brass collar.
    this.knob = el(
      'g',
      { class: 'tapper', role: 'button', tabindex: 0, 'aria-label': `Bell tapper to ${BOXES[id].name}` },
      el('circle', { cx: 0, cy: 0, r: 22, fill: 'transparent' }),
      el('circle', { cx: 0, cy: 2, r: 17, fill: '#24130a' }),
      el('circle', { cx: 0, cy: 0, r: 15.5, fill: `url(#sb-brass-${id})` }),
      el('g', { class: 'knob' }, el('circle', { r: 11, fill: '#161311' }), el('circle', { cx: -3.5, cy: -3.5, r: 4, fill: '#fff', opacity: 0.16 })),
    );
    const tapG = el('g', { transform: 'translate(59 200)' }, this.knob);
    this.svg.append(tapG);
    this.tape = el('text', { x: 59, y: 236, 'text-anchor': 'middle', class: 'tape' }, '');
    this.svg.append(this.tape);
    const press = (e: Event) => {
      e.preventDefault();
      this.knobT = 0.12;
      onTap();
    };
    this.knob.addEventListener('pointerdown', press);
    this.knob.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) press(e);
    });

    // The commutator handle, turned to one of three positions.
    const turn = el('g', { transform: 'translate(161 204)', class: 'commutator', role: 'group', 'aria-label': `Block handle for the line from ${BOXES[id].name}` });
    turn.append(
      el('circle', { r: 14, fill: '#24130a' }),
      el('circle', { r: 12, fill: `url(#sb-brass-${id})` }),
    );
    for (const st of ORDER) {
      const a = (ANGLE[st] * Math.PI) / 180;
      turn.append(el('circle', { cx: f1(Math.sin(a) * 21), cy: f1(-Math.cos(a) * 21), r: 1.6, fill: '#c69a46' }));
    }
    this.handle = el(
      'g',
      {},
      el('path', { d: 'M -4 3 L -2.4 -22 Q 0 -25 2.4 -22 L 4 3 Z', fill: '#131110' }),
      el('circle', { r: 5.5, fill: '#131110' }),
      el('path', { d: 'M -1.4 -2 L -0.8 -19', stroke: '#fff', 'stroke-opacity': 0.25, 'stroke-width': 1 }),
    );
    turn.append(this.handle);
    for (const st of ORDER) {
      const a = ANGLE[st];
      const hit = el('path', {
        d: wedge(a - 23, a + 23, 30),
        fill: 'transparent',
        class: 'turn-hit',
        role: 'button',
        tabindex: 0,
        'data-state': st,
        'aria-label': `Turn to ${st === 'LC' ? 'Line clear' : st === 'LB' ? 'Line blocked' : 'Train on line'}`,
      });
      hit.addEventListener('click', () => onTurn(st));
      hit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTurn(st);
        }
      });
      turn.append(hit);
    }
    this.svg.append(turn);

    this.caption = document.createElement('p');
    this.caption.className = 'caption';
    this.caption.setAttribute('aria-live', 'polite');
    this.root.append(this.svg, this.caption);
  }

  ring(): void {
    this.bellT = 0.5;
  }

  /** Show what was rung, briefly. */
  say(text: string, hold = 9): void {
    this.caption.textContent = text;
    this.caption.classList.add('on');
    this.captionT = hold;
  }

  update(box: Box, dt: number): void {
    this.outNeedle.step(ANGLE[box.outState[this.id]], dt);
    this.inNeedle.step(ANGLE[box.inState[this.id]], dt);
    const target = ANGLE[box.inState[this.id]];
    if (this.handleA !== target) {
      this.handleA += Math.sign(target - this.handleA) * Math.min(Math.abs(target - this.handleA), dt * 420);
      set(this.handle, { transform: `rotate(${f1(this.handleA)})` });
    }
    if (this.bellT > 0) {
      this.bellT = Math.max(0, this.bellT - dt);
      const w = Math.sin(this.bellT * 95) * 7 * this.bellT;
      set(this.bell, { transform: `translate(34 26) rotate(${f1(w)})` });
    }
    if (this.knobT > 0) this.knobT = Math.max(0, this.knobT - dt);
    this.knob.classList.toggle('down', this.knobT > 0);
    const beats = box.pending(this.id);
    let tape = '';
    if (beats.length) {
      let g = 1;
      const groups: number[] = [];
      for (let k = 1; k < beats.length; k++) {
        if (beats[k] - beats[k - 1] > 0.42) {
          groups.push(g);
          g = 1;
        } else g++;
      }
      groups.push(g);
      tape = groups.map((n) => '•'.repeat(n)).join('  ');
    }
    if (this.tape.textContent !== tape) this.tape.textContent = tape;
    if (this.captionT > 0) {
      this.captionT -= dt;
      if (this.captionT <= 0) this.caption.classList.remove('on');
    }
  }

  highlight(part: 'tapper' | BlockState | null): void {
    this.knob.classList.toggle('next', part === 'tapper');
    for (const h of this.svg.querySelectorAll<SVGElement>('.turn-hit'))
      h.classList.toggle('next', part !== null && part !== 'tapper' && h.dataset.state === part);
  }
}

function wedge(a0: number, a1: number, r: number): string {
  const p = (a: number) => {
    const t = (a * Math.PI) / 180;
    return `${f1(Math.sin(t) * r)} ${f1(-Math.cos(t) * r)}`;
  };
  return `M 0 0 L ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)} Z`;
}

/** A plain railway clock, its second hand stepping once a second. */
export class Clock {
  readonly svg: SVGSVGElement;
  private h: SVGLineElement;
  private m: SVGLineElement;
  private s: SVGLineElement;
  private last = -1;

  constructor() {
    this.svg = el('svg', { viewBox: '-50 -50 100 100', class: 'clock', role: 'img', 'aria-label': 'Clock' });
    this.svg.append(
      el('circle', { r: 48, fill: '#1c1712' }),
      el('circle', { r: 45, fill: '#f6f2e6' }),
    );
    for (let i = 0; i < 60; i++) {
      const a = (i * Math.PI) / 30;
      const big = i % 5 === 0;
      const r0 = big ? 35 : 39;
      this.svg.append(
        el('line', {
          x1: f1(Math.sin(a) * r0),
          y1: f1(-Math.cos(a) * r0),
          x2: f1(Math.sin(a) * 42),
          y2: f1(-Math.cos(a) * 42),
          stroke: '#1c1712',
          'stroke-width': big ? 2.6 : 0.8,
        }),
      );
    }
    for (let i = 1; i <= 12; i++) {
      const a = (i * Math.PI) / 6;
      this.svg.append(el('text', { x: f1(Math.sin(a) * 27), y: f1(-Math.cos(a) * 27 + 4), 'text-anchor': 'middle', class: 'clock-n' }, String(i)));
    }
    this.h = el('line', { x1: 0, y1: 5, x2: 0, y2: -22, stroke: '#1c1712', 'stroke-width': 4.2, 'stroke-linecap': 'round' });
    this.m = el('line', { x1: 0, y1: 6, x2: 0, y2: -36, stroke: '#1c1712', 'stroke-width': 2.8, 'stroke-linecap': 'round' });
    this.s = el('line', { x1: 0, y1: 9, x2: 0, y2: -38, stroke: '#a8261c', 'stroke-width': 1 });
    this.svg.append(this.h, this.m, this.s, el('circle', { r: 2.4, fill: '#a8261c' }));
  }

  show(t: number): void {
    const s = Math.floor(t);
    if (s === this.last) return;
    this.last = s;
    const sec = s % 60;
    const min = (s / 60) % 60;
    const hr = (s / 3600) % 12;
    set(this.s, { transform: `rotate(${sec * 6})` });
    set(this.m, { transform: `rotate(${f1(min * 6)})` });
    set(this.h, { transform: `rotate(${f1(hr * 30)})` });
  }
}
