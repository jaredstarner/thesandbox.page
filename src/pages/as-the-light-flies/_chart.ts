// Fig. 2: every reply as a point, by its region's distance from the marked spot and its round trip.
// Light in glass draws the floor; the fitted line runs along the bottom of the points.

import { KM_PER_RTT_MS, MAX_KM, kmBetween, type Fit, type Vec3 } from './_solve';

const NS = 'http://www.w3.org/2000/svg';
const W = 400;
const H = 220;
const L = 46;
const R = 14;
const T = 12;
const B = 36;
const X_MAX = 20000;

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

export interface Point {
  name: string;
  v: Vec3;
  rtt: number;
}

export class Chart {
  private yMax = 250;
  private axes: SVGGElement;
  private floor: SVGGElement;
  private dots: SVGGElement;
  private names: SVGGElement;
  private fitLine: SVGLineElement;
  private fitLabel: SVGTextElement;
  private fitLegend: SVGGElement;
  private fitBack: SVGRectElement;
  private empty: SVGTextElement;
  onHover: (index: number) => void = () => {};
  /** Says whose end the fitted line's shared delay belongs to. */
  endLabel = 'at your end';

  constructor(svg: SVGSVGElement) {
    const defs = el('defs', {}, svg);
    const pat = el(
      'pattern',
      { id: 'alf-hatch', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      defs,
    );
    el('line', { x1: 0, y1: 0, x2: 0, y2: 5, stroke: '#1b2130', 'stroke-width': 0.6, 'stroke-opacity': 0.28 }, pat);
    this.floor = el('g', {}, svg);
    this.axes = el('g', { class: 'axes' }, svg);
    this.fitLine = el(
      'line',
      { stroke: '#d9432a', 'stroke-width': 1.4, 'stroke-dasharray': '5 3', visibility: 'hidden' },
      svg,
    );
    // The legend sits in the one place no reply can ever be: under the floor, bottom right.
    const lgX = W - R - 4;
    const lgY = H - B - 10;
    const lg = el('g', { 'font-size': 11.5, fill: '#565d6c', 'text-anchor': 'end' }, svg);
    this.fitLegend = el('g', { visibility: 'hidden' }, lg);
    this.fitBack = el('rect', { x: lgX - 200, y: lgY - 12, width: 204, height: 17, fill: '#f3f2ee' }, this.fitLegend);
    el(
      'line',
      { x1: lgX - 18, y1: lgY - 4, x2: lgX, y2: lgY - 4, stroke: '#d9432a', 'stroke-width': 1.4, 'stroke-dasharray': '5 3' },
      this.fitLegend,
    );
    this.fitLabel = el('text', { x: lgX - 24, y: lgY, fill: '#d9432a' }, this.fitLegend);
    this.dots = el('g', {}, svg);
    this.names = el('g', { 'font-size': 11.5, fill: '#1b2130' }, svg);
    this.empty = el(
      'text',
      { x: L + (W - L - R) * 0.24, y: T + (H - T - B) * 0.28, 'text-anchor': 'middle', 'font-size': 14, 'font-style': 'italic', fill: '#565d6c' },
      svg,
    );
    this.empty.textContent = 'No replies yet.';
    this.drawFrame();
  }

  private x(km: number): number {
    return L + (Math.min(km, X_MAX) / X_MAX) * (W - L - R);
  }

  private y(ms: number): number {
    return H - B - (Math.min(ms, this.yMax) / this.yMax) * (H - T - B);
  }

  private drawFrame(): void {
    this.axes.replaceChildren();
    this.floor.replaceChildren();
    const ax = this.axes;
    const ink = '#1b2130';
    // The floor: no reply can come back faster than light in glass.
    const kmAtTop = Math.min(X_MAX, this.yMax * KM_PER_RTT_MS);
    const pts = [
      [this.x(0), this.y(0)],
      [this.x(kmAtTop), this.y(kmAtTop / KM_PER_RTT_MS)],
      [this.x(X_MAX), this.y(X_MAX / KM_PER_RTT_MS)],
      [this.x(X_MAX), this.y(0)],
    ];
    el('polygon', { points: pts.map((p) => p.join(',')).join(' '), fill: 'url(#alf-hatch)' }, this.floor);
    el(
      'line',
      { x1: pts[0][0], y1: pts[0][1], x2: pts[2][0], y2: pts[2][1], stroke: ink, 'stroke-width': 1 },
      this.floor,
    );
    const ang = (Math.atan2(pts[2][1] - pts[0][1], pts[2][0] - pts[0][0]) * 180) / Math.PI;
    const lx = this.x(12500);
    const ly = this.y(12500 / KM_PER_RTT_MS) + 13;
    const lt = el(
      'text',
      { x: lx, y: ly, 'font-size': 11.5, 'font-style': 'italic', fill: '#565d6c', transform: `rotate(${ang} ${lx} ${ly})` },
      this.floor,
    );
    lt.textContent = 'faster than light in glass';

    el('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, stroke: ink, 'stroke-width': 0.8 }, ax);
    el('line', { x1: L, y1: T, x2: L, y2: H - B, stroke: ink, 'stroke-width': 0.8 }, ax);
    for (let km = 0; km <= X_MAX; km += 5000) {
      const x = this.x(km);
      el('line', { x1: x, y1: H - B, x2: x, y2: H - B + 4, stroke: ink, 'stroke-width': 0.8 }, ax);
      const t = el('text', { x, y: H - B + 16, 'text-anchor': 'middle', 'font-size': 11.5, fill: ink }, ax);
      t.textContent = km === 0 ? '0' : `${km / 1000},000`;
    }
    const step = this.yMax > 400 ? 200 : this.yMax > 160 ? 100 : 50;
    for (let ms = 0; ms <= this.yMax; ms += step) {
      const y = this.y(ms);
      el('line', { x1: L - 4, y1: y, x2: L, y2: y, stroke: ink, 'stroke-width': 0.8 }, ax);
      const t = el('text', { x: L - 7, y: y + 4, 'text-anchor': 'end', 'font-size': 11.5, fill: ink }, ax);
      t.textContent = String(ms);
    }
    const xl = el('text', { x: W - R, y: H - 4, 'text-anchor': 'end', 'font-size': 12, 'font-style': 'italic', fill: '#565d6c' }, ax);
    xl.textContent = 'distance from the marked spot, km';
    const yl = el('text', { x: L + 8, y: T + 4, 'font-size': 12, 'font-style': 'italic', fill: '#565d6c' }, ax);
    yl.textContent = 'round trip, ms';
  }

  /** Redraw the points as seen from `from`, with the fit there if one is given. */
  update(points: Point[], from: Vec3 | null, fit: Fit | null, hot = -1): void {
    const top = Math.max(230, ...points.map((p) => p.rtt));
    const yMax = Math.ceil((top * 1.08) / 50) * 50;
    if (yMax !== this.yMax) {
      this.yMax = yMax;
      this.drawFrame();
    }
    this.empty.setAttribute('visibility', points.length ? 'hidden' : 'visible');
    this.dots.replaceChildren();
    this.names.replaceChildren();
    if (!from) {
      this.fitLine.setAttribute('visibility', 'hidden');
      this.fitLegend.setAttribute('visibility', 'hidden');
      return;
    }
    const placed = points
      .map((p, i) => ({ ...p, i, d: kmBetween(from, p.v) }))
      .sort((a, b) => a.rtt - b.rtt);
    const taken: [number, number, number][] = [];
    const dotsAt = placed.map((p) => [this.x(p.d), this.y(p.rtt)]);
    placed.forEach((p, rank) => {
      const cx = this.x(p.d);
      const cy = this.y(p.rtt);
      const isHot = p.i === hot;
      const c = el(
        'circle',
        {
          cx,
          cy,
          r: isHot ? 5 : 3.4,
          fill: isHot ? '#1b2130' : '#2a55c9',
          stroke: '#f3f2ee',
          'stroke-width': 1,
        },
        this.dots,
      );
      c.addEventListener('pointerenter', () => this.onHover(p.i));
      c.addEventListener('pointerleave', () => this.onHover(-1));
      // Name the nearest few, and the one picked out, where there's room.
      if (rank < 4 || isHot) {
        const tx = cx + 6;
        const ty = cy - 5;
        const wide = p.name.length * 6.2;
        const clash =
          taken.some(([x, y, w]) => tx < x + w && x < tx + wide && Math.abs(ty - y) < 12) ||
          dotsAt.some(([x, y], k) => k !== rank && x > tx - 3 && x < tx + wide + 3 && y > ty - 13 && y < ty + 4);
        if (!clash || isHot) {
          const t = el('text', { x: tx, y: ty }, this.names);
          t.textContent = p.name;
          taken.push([tx, ty, wide]);
        }
      }
    });
    if (fit) {
      const x2 = Math.min(MAX_KM, X_MAX);
      const y2 = fit.a + fit.s * x2;
      this.fitLine.setAttribute('x1', String(this.x(0)));
      this.fitLine.setAttribute('y1', String(this.y(fit.a)));
      this.fitLine.setAttribute('x2', String(this.x(x2)));
      this.fitLine.setAttribute('y2', String(this.y(Math.min(y2, this.yMax))));
      if (y2 > this.yMax) {
        const xTop = (this.yMax - fit.a) / fit.s;
        this.fitLine.setAttribute('x2', String(this.x(xTop)));
        this.fitLine.setAttribute('y2', String(this.y(this.yMax)));
      }
      this.fitLine.setAttribute('visibility', 'visible');
      this.fitLabel.textContent = `best line: ${fit.a.toFixed(0)} ms ${this.endLabel}, then ${(fit.s * KM_PER_RTT_MS).toFixed(1)}× light`;
      this.fitLegend.setAttribute('visibility', 'visible');
      const tw = this.fitLabel.getComputedTextLength() + 30;
      this.fitBack.setAttribute('x', String(W - R - tw));
      this.fitBack.setAttribute('width', String(tw + 2));
    } else {
      this.fitLine.setAttribute('visibility', 'hidden');
      this.fitLegend.setAttribute('visibility', 'hidden');
    }
  }
}
