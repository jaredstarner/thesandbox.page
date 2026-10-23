// Signal box: the track diagram over the frame. Black lines on an enamelled board,
// every signal and set of points numbered for its lever, and a lamp in each track
// circuit that lights when a train stands on it. The small arms repeat what the
// real ones outside are showing.

import type { TrackId } from './_layout';
import type { Box } from './_sim';
import { el, f1, set } from './_svg';

export const DIAGRAM_W = 760;
export const DIAGRAM_H = 196;

const DY = 98;
const UY = 136;
const BD = 30;
const BU = 66;

/** Each track circuit as polylines on the board. */
const TC: Record<TrackId, [number, number][][]> = {
  DA: [[[226, DY], [352, DY]]],
  DJ: [
    [[352, DY], [540, DY]],
    [[420, DY], [452, DY - 32]],
  ],
  DM1: [[[540, DY], [626, DY]]],
  DM2: [[[626, DY], [716, DY]]],
  DB1: [[[452, DY - 32], [484, BD], [600, BD]]],
  DB2: [[[600, BD], [700, BD]]],
  UA: [[[572, UY], [684, UY]]],
  UBA: [[[600, BU], [700, BU]]],
  UJ: [
    [[420, UY], [572, UY]],
    [[474, UY], [544, BU], [600, BU]],
  ],
  U1: [[[300, UY], [420, UY]]],
  U2: [[[196, UY], [300, UY]]],
};

interface SignalSym {
  n: number;
  x: number;
  y: number;
  /** Post length out to the arm; a bracket's second arm sits further out. */
  post?: number;
  /** Which side of the line the post stands: -1 above, 1 below. */
  side: -1 | 1;
  /** Facing east (down trains) or west (up trains). */
  dir: 1 | -1;
  distant?: boolean;
  fixed?: boolean;
}

const SIGNALS: SignalSym[] = [
  { n: 1, x: 150, y: DY, side: -1, dir: 1, distant: true },
  { n: 3, x: 352, y: DY, side: -1, dir: 1, post: 30 },
  { n: 2, x: 352, y: DY, side: -1, dir: 1, post: 17 },
  { n: 4, x: 626, y: DY, side: -1, dir: 1 },
  { n: 5, x: 600, y: BD, side: -1, dir: 1 },
  { n: 13, x: 690, y: UY, side: 1, dir: -1, distant: true },
  { n: 12, x: 572, y: UY, side: 1, dir: -1 },
  { n: 10, x: 300, y: UY, side: 1, dir: -1 },
  { n: 11, x: 600, y: BU, side: 1, dir: -1 },
  { n: 0, x: 712, y: BU, side: 1, dir: -1, distant: true, fixed: true },
];

export class Diagram {
  readonly svg: SVGSVGElement;
  private lamps = new Map<TrackId, SVGElement[]>();
  private arms = new Map<number, { g: SVGGElement; a: number; base: number; dir: number }>();
  private points = new Map<number, SVGElement>();

  constructor() {
    this.svg = el('svg', {
      viewBox: `0 0 ${DIAGRAM_W} ${DIAGRAM_H}`,
      class: 'diagram-svg',
      role: 'img',
      'aria-label': 'Track diagram of Wenlow Junction',
    });
    this.svg.append(
      el(
        'defs',
        {},
        el(
          'linearGradient',
          { id: 'sb-board', x1: 0, x2: 0, y1: 0, y2: 1 },
          el('stop', { offset: 0, 'stop-color': '#f5efdc' }),
          el('stop', { offset: 1, 'stop-color': '#e7dcc0' }),
        ),
        el(
          'filter',
          { id: 'sb-glow', x: -0.2, y: -2, width: 1.4, height: 5 },
          el('feGaussianBlur', { stdDeviation: 2.2 }),
        ),
      ),
      el('rect', { x: 0, y: 0, width: DIAGRAM_W, height: DIAGRAM_H, rx: 4, fill: '#2c1b10' }),
      el('rect', { x: 6, y: 6, width: DIAGRAM_W - 12, height: DIAGRAM_H - 12, rx: 2, fill: 'url(#sb-board)' }),
    );

    // Plain track beyond the circuits, then each circuit, then its lamp layer.
    const ink = { stroke: '#1d1915', 'stroke-width': 3.2, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    const line = (p: [number, number][]) => el('polyline', { points: p.map(([x, y]) => `${x},${y}`).join(' '), ...ink });
    this.svg.append(
      line([[20, DY], [226, DY]]),
      line([[716, DY], [740, DY]]),
      line([[20, UY], [196, UY]]),
      line([[684, UY], [740, UY]]),
      line([[700, BD], [740, BD]]),
      line([[700, BU], [740, BU]]),
    );
    for (const [id, segs] of Object.entries(TC) as [TrackId, [number, number][][]][]) {
      const lit: SVGElement[] = [];
      for (const p of segs) {
        this.svg.append(line(p));
        const glow = el('polyline', {
          points: p.map(([x, y]) => `${x},${y}`).join(' '),
          stroke: '#ff3b22',
          'stroke-width': 6,
          fill: 'none',
          'stroke-linecap': 'round',
          filter: 'url(#sb-glow)',
          opacity: 0,
        });
        const core = el('polyline', {
          points: p.map(([x, y]) => `${x},${y}`).join(' '),
          stroke: '#d8261a',
          'stroke-width': 3.4,
          fill: 'none',
          'stroke-linecap': 'round',
          opacity: 0,
        });
        lit.push(glow, core);
        this.svg.append(glow, core);
      }
      this.lamps.set(id, lit);
      // Insulated joints at either end of each circuit.
      for (const p of segs) for (const end of [p[0], p[p.length - 1]]) this.svg.append(joint(end, p));
    }

    // The diamond, and the points with their lever numbers.
    this.svg.append(el('circle', { cx: 510, cy: DY, r: 2.6, fill: '#f5efdc', stroke: '#1d1915', 'stroke-width': 1.2 }));
    const p7 = el('g', {}, el('text', { x: 420, y: DY + 15, 'text-anchor': 'middle', class: 'dg-n' }, '7'));
    const p8 = el('g', {}, el('text', { x: 474, y: UY - 7, 'text-anchor': 'middle', class: 'dg-n' }, '8'));
    this.points.set(7, p7);
    this.points.set(8, p8);
    this.svg.append(
      p7,
      p8,
      el('text', { x: 404, y: DY + 15, 'text-anchor': 'middle', class: 'dg-fpl' }, '6'),
      el('rect', { x: 398, y: DY + 4, width: 12, height: 14, rx: 1, fill: 'none', stroke: '#1f4f9b', 'stroke-width': 0.8 }),
    );

    // Signals.
    for (const s of SIGNALS) {
      const g = el('g', { transform: `translate(${s.x} ${s.y})` });
      const up = s.side;
      const postTop = up * (s.post ?? 20);
      g.append(el('line', { x1: 0, y1: up * 4, x2: 0, y2: postTop, stroke: '#1d1915', 'stroke-width': 1.4 }));
      g.append(el('line', { x1: -3, y1: up * 4, x2: 3, y2: up * 4, stroke: '#1d1915', 'stroke-width': 1.4 }));
      const armG = el('g', { transform: `translate(0 ${postTop})` });
      const armLen = 12;
      const colour = s.distant ? '#e3ad12' : '#b42a1f';
      const d = s.distant
        ? `M 0 -2 L ${s.dir * armLen} -2 L ${s.dir * (armLen - 3)} 0 L ${s.dir * armLen} 2 L 0 2 Z`
        : `M 0 -2 L ${s.dir * armLen} -2 L ${s.dir * armLen} 2 L 0 2 Z`;
      const arm = el('g', {}, el('path', { d, fill: colour, stroke: '#1d1915', 'stroke-width': 0.6 }));
      armG.append(arm);
      g.append(armG);
      if (s.n)
        g.append(
          el(
            'text',
            { x: -s.dir * 8, y: postTop + (up < 0 ? 3 : 4), 'text-anchor': 'middle', class: 'dg-sig' },
            String(s.n),
          ),
        );
      this.svg.append(g);
      if (s.n) this.arms.set(s.n, { g: arm, a: 0, base: 0, dir: s.dir });
    }

    // Labels.
    const label = (x: number, y: number, text: string, anchor = 'start', cls = 'dg-l') =>
      el('text', { x, y, 'text-anchor': anchor, class: cls }, text);
    this.svg.append(
      label(22, DY - 8, 'DOWN MAIN'),
      label(22, UY + 16, 'UP MAIN'),
      label(22, 24, 'from CALLOW BANK', 'start', 'dg-to'),
      label(738, 186, 'to MARSH LANE', 'end', 'dg-to'),
      label(738, 18, 'to PELL WOOD', 'end', 'dg-to'),
      label(694, BD + 15, 'DOWN BRANCH', 'end'),
      label(694, BU + 16, 'UP BRANCH', 'end'),
    );
    // The box itself.
    this.svg.append(
      el('rect', { x: 400, y: UY + 18, width: 50, height: 16, fill: '#1d1915' }),
      el('text', { x: 425, y: UY + 29.5, 'text-anchor': 'middle', class: 'dg-box' }, 'WENLOW JN'),
    );
  }

  update(box: Box, dt: number): void {
    for (const [id, els] of this.lamps) {
      const on = box.occupied.has(id) ? '1' : '0';
      for (const e of els) if (e.getAttribute('opacity') !== on) e.setAttribute('opacity', on);
    }
    for (const [n, a] of this.arms) {
      const target = box.armOff(n) ? 1 : 0;
      if (a.a === target) continue;
      a.a += Math.sign(target - a.a) * Math.min(Math.abs(target - a.a), dt * 4);
      set(a.g, { transform: `rotate(${f1(-a.dir * 45 * a.a)})` });
    }
    for (const [n, g] of this.points) g.classList.toggle('rev', box.lever(n).reversed);
  }
}

function joint(at: [number, number], p: [number, number][]): SVGElement {
  const other = at === p[0] ? p[1] : p[p.length - 2];
  const dx = other[0] - at[0];
  const dy = other[1] - at[1];
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * 4;
  const ny = (dx / l) * 4;
  return el('line', {
    x1: f1(at[0] + nx),
    y1: f1(at[1] + ny),
    x2: f1(at[0] - nx),
    y2: f1(at[1] - ny),
    stroke: '#1d1915',
    'stroke-width': 1,
  });
}
