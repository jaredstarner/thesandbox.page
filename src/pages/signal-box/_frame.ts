// Signal box: the lever frame, seen from where the signalman stands.
//
// Each lever pivots in a slot in the floor. Normal, it leans away toward the
// windows; pulled over, its handle comes back toward you, lower and nearer. The
// lean is projected from a viewpoint above and behind the frame, so a pulled
// lever's handle grows as it comes.

import { LEVERS, type LeverDef, type LeverKind } from './_layout';
import type { Box } from './_sim';
import { el, pts, set } from './_svg';

const PAINT: Record<LeverKind, { face: string; side: string; ink: string }> = {
  stop: { face: '#b42a1f', side: '#7a1a12', ink: '#fff6ea' },
  distant: { face: '#e3ad12', side: '#a47b06', ink: '#1d1a14' },
  points: { face: '#26231f', side: '#0f0e0c', ink: '#f3ead4' },
  fpl: { face: '#1f4f9b', side: '#123366', ink: '#f6f1e2' },
  spare: { face: '#ebe5d5', side: '#b8b09c', ink: '#2a2620' },
};

const GAP = 62;
const X0 = 48;
const PIVOT_Y = 352;
const EYE = 2.0;
const D0 = 2.6;
const LEN = 1.25;
const F = 560;
const Y0 = PIVOT_Y - (F * EYE) / D0;
const LEAN = (22 * Math.PI) / 180;
export const FRAME_W = X0 * 2 + GAP * (LEVERS.length - 1);
export const FRAME_H = 462;
/** The floor above the tallest handle is cropped off. */
const FRAME_TOP = 66;

function project(u: number, p: number): { y: number; k: number } {
  const th = -LEAN + 2 * LEAN * p;
  const h = u * LEN * Math.cos(th);
  const d = D0 - u * LEN * Math.sin(th);
  return { y: Y0 + (F * (EYE - h)) / d, k: D0 / d };
}

interface LeverView {
  def: LeverDef;
  x: number;
  g: SVGGElement;
  shadow: SVGPolygonElement;
  side: SVGPolygonElement;
  body: SVGPolygonElement;
  shine: SVGPolygonElement;
  catchBar: SVGPolygonElement;
  handle: SVGPolygonElement;
  glint: SVGPolygonElement;
  badge: SVGGElement;
  plate: SVGGElement;
  p: number;
  shown: number;
  jolt: number;
}

export class Frame {
  readonly svg: SVGSVGElement;
  private levers: LeverView[] = [];
  private target: number | null = null;

  constructor(onPull: (n: number) => void) {
    this.svg = el('svg', {
      viewBox: `0 ${FRAME_TOP} ${FRAME_W} ${FRAME_H - FRAME_TOP}`,
      preserveAspectRatio: 'xMidYMax meet',
      class: 'frame-svg',
      role: 'group',
      'aria-label': 'Lever frame',
    });
    const defs = el(
      'defs',
      {},
      el(
        'linearGradient',
        { id: 'sb-steel', x1: 0, x2: 1, y1: 0, y2: 0 },
        el('stop', { offset: 0, 'stop-color': '#7f868c' }),
        el('stop', { offset: 0.28, 'stop-color': '#f6f7f8' }),
        el('stop', { offset: 0.52, 'stop-color': '#c3c8cc' }),
        el('stop', { offset: 0.8, 'stop-color': '#5f656b' }),
        el('stop', { offset: 1, 'stop-color': '#a4aaaf' }),
      ),
      el(
        'linearGradient',
        { id: 'sb-floor', x1: 0, x2: 0, y1: 0, y2: 1 },
        el('stop', { offset: 0, 'stop-color': '#2b1d14' }),
        el('stop', { offset: 0.55, 'stop-color': '#4a3020' }),
        el('stop', { offset: 1, 'stop-color': '#5d3c27' }),
      ),
      el(
        'linearGradient',
        { id: 'sb-rail', x1: 0, x2: 0, y1: 0, y2: 1 },
        el('stop', { offset: 0, 'stop-color': '#3a2a1e' }),
        el('stop', { offset: 0.12, 'stop-color': '#6e4a30' }),
        el('stop', { offset: 1, 'stop-color': '#3b281b' }),
      ),
      el(
        'linearGradient',
        { id: 'sb-enamel', x1: 0, x2: 0, y1: 0, y2: 1 },
        el('stop', { offset: 0, 'stop-color': '#f7f1df' }),
        el('stop', { offset: 1, 'stop-color': '#e3d9bf' }),
      ),
    );
    this.svg.append(defs);

    // The floor, the frame's cover plates and slot, and the rail of lever plates in front.
    this.svg.append(
      el('rect', { x: -1500, y: 0, width: FRAME_W + 3000, height: FRAME_H, fill: 'url(#sb-floor)' }),
      ...boards(),
      el('rect', { x: 6, y: PIVOT_Y - 12, width: FRAME_W - 12, height: 20, rx: 2, fill: '#1b1714' }),
      el('rect', { x: 6, y: PIVOT_Y - 12, width: FRAME_W - 12, height: 3, fill: '#4a4440' }),
      el('rect', { x: 6, y: PIVOT_Y + 8, width: FRAME_W - 12, height: 6, fill: '#0e0c0a', opacity: 0.6 }),
      el('rect', { x: -1500, y: 366, width: FRAME_W + 3000, height: 96, fill: 'url(#sb-rail)' }),
      el('rect', { x: -1500, y: 366, width: FRAME_W + 3000, height: 2, fill: '#8d6542', opacity: 0.7 }),
    );
    for (let i = 0; i < LEVERS.length; i++) {
      const x = X0 + i * GAP;
      this.svg.append(el('rect', { x: x - 5, y: PIVOT_Y - 9, width: 10, height: 15, rx: 2, fill: '#060505' }));
    }

    for (const [i, def] of LEVERS.entries()) {
      const x = X0 + i * GAP;
      const paint = PAINT[def.kind];
      const g = el('g', {
        class: 'lever',
        'data-lever': def.n,
        role: 'button',
        tabindex: 0,
        'aria-label': `Lever ${def.n}, ${def.name}`,
      });
      const hit = el('rect', { x: x - GAP / 2 + 2, y: 40, width: GAP - 4, height: FRAME_H - 44, fill: 'transparent' });
      const shadow = el('polygon', { fill: '#000', opacity: 0.28 });
      const side = el('polygon', { fill: paint.side });
      const body = el('polygon', { fill: paint.face });
      const shine = el('polygon', { fill: '#fff', opacity: def.kind === 'points' ? 0.1 : 0.16 });
      const catchBar = el('polygon', { fill: '#8e959b' });
      const handle = el('polygon', { fill: 'url(#sb-steel)' });
      const glint = el('polygon', { fill: '#fff', opacity: 0.7 });
      const badge = el(
        'g',
        {},
        el('rect', { x: -9, y: -7.5, width: 18, height: 15, rx: 2, fill: paint.side, stroke: paint.ink, 'stroke-width': 0.8 }),
        el('text', { x: 0, y: 4.6, 'text-anchor': 'middle', class: 'badge', fill: paint.ink }, String(def.n)),
      );
      const plate = this.makePlate(def, x);
      g.append(hit, shadow, side, body, shine, catchBar, handle, glint, badge, plate);
      g.addEventListener('click', () => onPull(def.n));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPull(def.n);
        }
      });
      this.svg.append(g);
      const v: LeverView = { def, x, g, shadow, side, body, shine, catchBar, handle, glint, badge, plate, p: 0, shown: -1, jolt: 0 };
      this.levers.push(v);
      this.draw(v);
    }
  }

  private makePlate(def: LeverDef, x: number): SVGGElement {
    const w = GAP - 8;
    const g = el('g', { class: 'plate', transform: `translate(${x - w / 2} 376)` });
    g.append(
      el('rect', { x: 0, y: 0, width: w, height: 74, rx: 3, fill: 'url(#sb-enamel)', stroke: '#2e2318', 'stroke-width': 1 }),
      el('rect', { class: 'plate-ring', x: 2, y: 2, width: w - 4, height: 70, rx: 2, fill: 'none', stroke: '#6b5a40', 'stroke-width': 0.6 }),
      el('text', { x: w / 2, y: 22, 'text-anchor': 'middle', class: 'plate-n' }, String(def.n)),
      el('text', { x: w / 2, y: 38, 'text-anchor': 'middle', class: 'plate-d' }, def.plate[0]),
      el('text', { x: w / 2, y: 49, 'text-anchor': 'middle', class: 'plate-d' }, def.plate[1]),
    );
    if (def.reverse?.length)
      g.append(el('text', { x: w / 2, y: 66, 'text-anchor': 'middle', class: 'plate-lead' }, def.reverse.join(' · ')));
    return g;
  }

  /** Draw one lever at its current lean. */
  private draw(v: LeverView): void {
    const p = v.p;
    const jx = v.jolt > 0 ? Math.sin(v.jolt * 70) * 1.4 * v.jolt * 3 : 0;
    const x = v.x + jx;
    const pt = (u: number, w: number, dx = 0): [number, number] => {
      const q = project(u, p);
      return [x + (w + dx) * q.k, q.y];
    };
    const half = (u: number) => 7.2 - 2.2 * u;
    const bodyTop = 0.77;
    const bodyL: [number, number][] = [];
    const bodyR: [number, number][] = [];
    const sideR: [number, number][] = [];
    for (const u of [0, 0.25, 0.5, bodyTop]) {
      bodyL.push(pt(u, -half(u)));
      bodyR.push(pt(u, half(u)));
      sideR.push(pt(u, half(u) + 2.2));
    }
    set(v.body, { points: pts([...bodyL, ...bodyR.reverse()]) });
    set(v.side, { points: pts([...bodyR.slice().reverse(), ...sideR.reverse()]) });
    const shineL: [number, number][] = [];
    const shineR: [number, number][] = [];
    for (const u of [0.04, 0.4, bodyTop - 0.02]) {
      shineL.push(pt(u, -half(u) + 1.2));
      shineR.push(pt(u, -half(u) + 2.6));
    }
    set(v.shine, { points: pts([...shineL, ...shineR.reverse()]) });

    // The handle: polished steel, a little narrower, with the catch handle behind it.
    const hL: [number, number][] = [];
    const hR: [number, number][] = [];
    for (const u of [bodyTop - 0.01, 0.86, 0.95, 1]) {
      const w = u === 1 ? 3.2 : 4.3;
      hL.push(pt(u, -w));
      hR.push(pt(u, w));
    }
    set(v.handle, { points: pts([...hL, ...hR.reverse()]) });
    set(v.glint, { points: pts([pt(0.79, -2.2), pt(0.97, -1.6), pt(0.97, -0.9), pt(0.79, -1.3)]) });
    const c0 = pt(0.72, 4.6);
    const c1 = pt(0.93, 4.0);
    set(v.catchBar, { points: pts([c0, c1, [c1[0] + 2.4 * project(0.93, p).k, c1[1]], [c0[0] + 2.8 * project(0.72, p).k, c0[1]]]) });

    // A soft shadow thrown back across the floor by the box's lamp.
    const s0: [number, number] = [x - 7, PIVOT_Y - 4];
    const top = project(1, p);
    const len = (PIVOT_Y - top.y) * 0.18;
    set(v.shadow, {
      points: pts([s0, [x + 7, PIVOT_Y - 4], [x + 10 + len, PIVOT_Y - 10 - len * 0.2], [x + 4 + len, PIVOT_Y - 12 - len * 0.2]]),
    });

    const b = project(0.66, p);
    set(v.badge, { transform: `translate(${(x).toFixed(1)} ${b.y.toFixed(1)}) scale(${(b.k * 0.92).toFixed(3)})` });
  }

  /** Follow the box: lean every lever to where the frame says it is. */
  update(box: Box, dt: number): void {
    for (const v of this.levers) {
      const l = box.lever(v.def.n);
      let p: number;
      if (l.moving) {
        const dur = strokeOf(v.def.kind);
        const f = Math.min(1, Math.max(0, 1 - l.left / dur));
        const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
        p = l.reversed ? e : 1 - e;
      } else p = l.reversed ? 1 : 0;
      if (v.jolt > 0) v.jolt = Math.max(0, v.jolt - dt);
      if (p !== v.p || v.jolt > 0 || v.shown !== p) {
        v.p = p;
        v.shown = p;
        this.draw(v);
      }
      const state = l.reversed ? 'reverse' : 'normal';
      if (v.g.dataset.state !== state) {
        v.g.dataset.state = state;
        v.g.setAttribute('aria-label', `Lever ${v.def.n}, ${v.def.name}, ${l.reversed ? 'pulled' : 'normal'}`);
      }
    }
  }

  /** A lever the frame won't release: the catch lifts and it shudders. */
  jolt(n: number): void {
    const v = this.levers[n - 1];
    v.jolt = 0.32;
    v.g.classList.remove('refused');
    void v.g.getBoundingClientRect();
    v.g.classList.add('refused');
  }

  /** Ring the lever the guide wants next. */
  highlight(n: number | null): void {
    if (this.target === n) return;
    if (this.target !== null) this.levers[this.target - 1].g.classList.remove('next');
    this.target = n;
    if (n !== null) this.levers[n - 1].g.classList.add('next');
  }
}

function strokeOf(kind: LeverKind): number {
  return { distant: 1.25, stop: 0.75, points: 1.0, fpl: 0.55, spare: 0.6 }[kind];
}

/** Floorboards, worn pale where the signalman walks along the frame. */
function boards(): SVGElement[] {
  const out: SVGElement[] = [];
  for (let i = 0; i < 9; i++) {
    const y = 18 + i * 37;
    out.push(el('rect', { x: -1500, y, width: FRAME_W + 3000, height: 1.2, fill: '#1a110b', opacity: 0.55 }));
  }
  out.push(
    el('rect', { x: -1500, y: 250, width: FRAME_W + 3000, height: 92, fill: '#c9a27a', opacity: 0.07 }),
    el('rect', { x: -1500, y: 300, width: FRAME_W + 3000, height: 40, fill: '#e4c194', opacity: 0.05 }),
  );
  return out;
}
