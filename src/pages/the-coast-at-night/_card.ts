// The light card: what the list says about one light, its rhythm drawn as a
// strip with a playhead, and its sectors as charted.

import { LIGHT_RGB } from './_chart';
import { inSeason, type Lights } from './_lights';
import { COLOURS, ON, levelAt } from './_rhythm';
import { span } from './_sectors';

const NS = 'http://www.w3.org/2000/svg';
const CSS_RGB = LIGHT_RGB.map(
  ([r, g, b]) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`,
);
const WORD: Record<string, string> = {
  W: 'white',
  R: 'red',
  G: 'green',
  Y: 'yellow',
  Bu: 'blue',
  Vi: 'violet',
  Or: 'orange',
};
const MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const DAYS_BEFORE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];

function dateOf(doy: number): string {
  let m = 0;
  while (m < 11 && doy > DAYS_BEFORE[m + 1]) m++;
  return `${MONTHS[m]} ${doy - DAYS_BEFORE[m]}`;
}

export type Detail = [string, string, string, number, string, string, string, string];

export class DetailStore {
  private chunks = new Map<number, Promise<Detail[]>>();
  constructor(
    private base: string,
    private size: number,
  ) {}
  get(i: number): Promise<Detail> {
    const c = Math.floor(i / this.size);
    let p = this.chunks.get(c);
    if (!p) {
      p = fetch(`${this.base}details/${c}.json`).then((r) => {
        if (!r.ok) throw new Error(`details ${r.status}`);
        return r.json() as Promise<Detail[]>;
      });
      this.chunks.set(c, p);
      p.catch(() => this.chunks.delete(c));
    }
    return p.then((rows) => rows[i - c * this.size]);
  }
}

const deg = (d: number) => `${String(Math.round(d * 10) / 10).padStart(3, '0')}°`;

export class Card {
  onClose: () => void = () => {};
  onDeck: (i: number) => void = () => {};
  readonly details: DetailStore;
  private el: HTMLElement;
  private strip: SVGSVGElement;
  private head: SVGLineElement | null = null;
  private span = 1;
  private current = -1;

  constructor(
    private root: HTMLElement,
    private lights: Lights,
    base: string,
  ) {
    this.el = root.querySelector('[data-card]')!;
    this.strip = root.querySelector('[data-card-strip]')!;
    this.details = new DetailStore(base, lights.chunk);
    root.querySelector('[data-card-close]')!.addEventListener('click', () => this.onClose());
    root.querySelector('[data-card-deck]')!.addEventListener('click', () => {
      if (this.current >= 0) this.onDeck(this.current);
    });
  }

  private q<T extends Element = HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel) as T;
  }

  hide() {
    this.current = -1;
    this.el.hidden = true;
  }

  async show(i: number) {
    this.current = i;
    const L = this.lights;
    const r = L.rhythms[L.rhythm[i]];
    const sectors = L.sectors[L.sector[i]];
    const own = COLOURS[L.colour[i] - 1];
    this.el.hidden = false;
    this.q('[data-card-name]').textContent = '…';
    this.q('[data-card-region]').textContent = '';
    const height = L.height[i];
    const notation = [r.label, height ? `${height}m` : '', L.range[i] ? `${L.range[i]}M` : '']
      .filter(Boolean)
      .join(' ');
    this.q('[data-card-notation]').textContent = notation;

    const coloursShown = sectors.length ? [...new Set(sectors.map((s) => s.colour ?? own))] : [];
    let says = r.says;
    if (coloursShown.length > 1 && !r.label.includes('Al.'))
      says += `, ${listOr(coloursShown.map((c) => WORD[c]))} by bearing`;
    this.q('[data-card-says]').textContent = `${says}.`;
    this.drawStrip(i);
    this.drawRose(i);

    const facts: [string, string][] = [];
    if (height) facts.push(['Height', `${height} m`]);
    const d = await this.details.get(i).catch(() => null);
    if (this.current !== i) return;
    if (d) {
      const [name, region, , , range, structure, remarks, source] = d;
      this.q('[data-card-name]').textContent = name || 'Unnamed light';
      this.q('[data-card-region]').textContent = region;
      if (range) facts.push(['Range', `${range.replace(/\s*;\s*/g, ', ').replace(/\b(W|R|G|Y)\.\s*/g, '$1 ')} miles`]);
      if (structure) facts.push(['Structure', structure.replace(/\.$/, '')]);
      this.q('[data-card-remarks]').textContent = remarks;
      this.q('[data-card-source]').textContent = source;
    } else {
      this.q('[data-card-name]').textContent = 'A light';
      if (L.range[i]) facts.push(['Range', `${L.range[i]} miles`]);
      this.q('[data-card-remarks]').textContent = '';
      this.q('[data-card-source]').textContent = '';
    }
    if (sectors.length) {
      facts.push([
        'Sectors',
        sectors.map((s) => `${s.colour ? WORD[s.colour] : 'obscured'} ${deg(s.from)} to ${deg(s.to)}`).join(', '),
      ]);
    }
    const season = L.seasons.get(i);
    if (season) {
      const now = new Date();
      const doy =
        Math.floor(
          (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 1)) / 864e5,
        ) + 1;
      facts.push([
        'Shown',
        `${dateOf(season[0])} to ${dateOf(season[1])}${inSeason(season, doy) ? '' : ', so dark tonight'}`,
      ]);
    }
    const dl = this.q('[data-card-facts]');
    dl.replaceChildren(
      ...facts.flatMap(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        return [dt, dd];
      }),
    );
    this.q<HTMLButtonElement>('[data-card-deck]').hidden = !L.lit[i];
  }

  private drawStrip(i: number) {
    const L = this.lights;
    const r = L.rhythms[L.rhythm[i]];
    const svg = this.strip;
    svg.replaceChildren();
    const own = CSS_RGB[L.colour[i]];
    if (!r.period) {
      this.span = 1;
      svg.append(rect(0, 0, 300, 40, own, 0.9));
      this.head = null;
      return;
    }
    // Show at least 4 seconds, so a quick light reads as many flashes.
    const reps = Math.max(1, Math.ceil(4 / r.period));
    this.span = r.period * reps;
    const k = 300 / this.span;
    for (let n = 0; n < reps; n++) {
      let t = n * r.period;
      for (let s = 0; s < r.steps.length; s += 2) {
        const d = r.steps[s];
        const c = r.steps[s + 1];
        if (c) svg.append(rect(t * k, 4, Math.max(0.8, d * k), 32, c === ON ? own : CSS_RGB[c], 0.95));
        else if (r.base) svg.append(rect(t * k, 14, d * k, 12, own, r.base));
        t += d;
      }
    }
    // Second ticks along the bottom.
    for (let s = 1; s < this.span; s++) {
      const tick = document.createElementNS(NS, 'line');
      tick.setAttribute('x1', String(s * k));
      tick.setAttribute('x2', String(s * k));
      tick.setAttribute('y1', '37');
      tick.setAttribute('y2', '40');
      tick.setAttribute('stroke', 'rgb(226 220 205 / 0.35)');
      tick.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(tick);
    }
    const head = document.createElementNS(NS, 'line');
    head.setAttribute('y1', '0');
    head.setAttribute('y2', '40');
    head.setAttribute('stroke', 'rgb(226 220 205 / 0.85)');
    head.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(head);
    this.head = head;
  }

  private drawRose(i: number) {
    const L = this.lights;
    const svg = this.q<SVGSVGElement>('[data-card-rose]');
    svg.replaceChildren();
    const sectors = L.sectors[L.sector[i]];
    const own = CSS_RGB[L.colour[i]];
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('r', '40');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'rgb(226 220 205 / 0.18)');
    svg.append(ring);
    for (let a = 0; a < 360; a += 10) {
      const t = document.createElementNS(NS, 'line');
      const rad = (a * Math.PI) / 180;
      const r0 = a % 90 === 0 ? 34 : 37.5;
      t.setAttribute('x1', String(Math.sin(rad) * r0));
      t.setAttribute('y1', String(-Math.cos(rad) * r0));
      t.setAttribute('x2', String(Math.sin(rad) * 40));
      t.setAttribute('y2', String(-Math.cos(rad) * 40));
      t.setAttribute('stroke', 'rgb(226 220 205 / 0.3)');
      t.setAttribute('stroke-width', '0.6');
      svg.append(t);
    }
    const n = document.createElementNS(NS, 'text');
    n.setAttribute('y', '-43');
    n.setAttribute('text-anchor', 'middle');
    n.setAttribute('font-size', '8');
    n.setAttribute('fill', 'rgb(226 220 205 / 0.6)');
    n.textContent = 'N';
    svg.append(n);
    const wedges = sectors.length
      ? sectors
          .filter((s) => s.colour)
          .map((s) => ({ from: (s.from + 180) % 360, span: span(s.from, s.to), c: s.colour! }))
      : [{ from: 0, span: 360, c: COLOURS[L.colour[i] - 1] }];
    for (const w of wedges) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', wedge(w.from, w.span, 30));
      const col = CSS_RGB[COLOURS.indexOf(w.c) + 1];
      path.setAttribute('fill', col);
      path.setAttribute('fill-opacity', '0.22');
      path.setAttribute('stroke', col);
      path.setAttribute('stroke-width', '1.2');
      path.setAttribute('stroke-opacity', '0.9');
      svg.append(path);
    }
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', '2.6');
    dot.setAttribute('fill', own);
    svg.append(dot);
  }

  /** Moves the strip's playhead with the light. */
  tick(time: number) {
    if (this.current < 0 || !this.head) return;
    const L = this.lights;
    const r = L.rhythms[L.rhythm[this.current]];
    const t = (time + L.phase[this.current]) % this.span;
    const x = (t / this.span) * 300;
    this.head.setAttribute('x1', String(x));
    this.head.setAttribute('x2', String(x));
    const { level } = levelAt(r, time + L.phase[this.current]);
    this.head.setAttribute('stroke-width', String(1 + level * 1.5));
  }
}

function listOr(words: string[]): string {
  return words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}

function rect(x: number, y: number, w: number, h: number, fill: string, opacity: number): SVGRectElement {
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('x', String(x));
  r.setAttribute('y', String(y));
  r.setAttribute('width', String(w));
  r.setAttribute('height', String(h));
  r.setAttribute('fill', fill);
  r.setAttribute('fill-opacity', String(opacity));
  return r;
}

/** A pie slice clockwise from a bearing, in the rose's frame (north up). */
function wedge(from: number, sweep: number, r: number): string {
  if (sweep >= 359.9) return `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r} Z`;
  const a0 = (from * Math.PI) / 180;
  const a1 = ((from + sweep) * Math.PI) / 180;
  const p = (a: number) => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
  return `M 0 0 L ${p(a0)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${p(a1)} Z`;
}
