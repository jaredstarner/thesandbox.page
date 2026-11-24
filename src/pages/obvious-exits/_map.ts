// The map you keep as you go, in pencil on squared paper, the way adventure players drew theirs:
// a box for every place you've stood, a line for every way you've walked, a stub for each way you
// haven't tried yet, and a ring round where you are now. Drawn as SVG, north up, true to scale.

import { COMPASS_WORD, exitsOf, hash } from './_describe';
import type { Game } from './_game';
import type { Spot } from './_town';

const NS = 'http://www.w3.org/2000/svg';

interface View {
  cx: number;
  cy: number;
  /** Pixels per metre. */
  k: number;
}

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, name);
  for (const a in attrs) e.setAttribute(a, String(attrs[a]));
  parent?.appendChild(e);
  return e;
}

/** A pencil line between two points: a slight bow and a little overshoot, the same each time. */
function stroke(x1: number, y1: number, x2: number, y2: number, seed: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = (((seed % 100) / 100 - 0.5) * Math.min(len, 90)) / 30;
  const over = 1.5 + (seed % 3);
  const ux = dx / len;
  const uy = dy / len;
  const sx = x1 - ux * over * 0.4;
  const sy = y1 - uy * over * 0.4;
  const ex = x2 + ux * over * 0.3;
  const ey = y2 + uy * over * 0.3;
  const mx = (sx + ex) / 2 + nx * bow;
  const my = (sy + ey) / 2 + ny * bow;
  return `M${sx.toFixed(1)} ${sy.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}

/** A hand-drawn box: four strokes that don't quite meet. */
function box(x: number, y: number, r: number, seed: number): string {
  const j = (k: number) => (((hash(seed, k) % 100) / 100) - 0.5) * 1.6;
  const a = [x - r + j(1), y - r + j(2)];
  const b = [x + r + j(3), y - r + j(4)];
  const c = [x + r + j(5), y + r + j(6)];
  const d = [x - r + j(7), y + r + j(8)];
  return [stroke(a[0], a[1], b[0], b[1], seed), stroke(b[0], b[1], c[0], c[1], seed + 1), stroke(c[0], c[1], d[0], d[1], seed + 2), stroke(d[0], d[1], a[0], a[1], seed + 3)].join('');
}

/** A loose ring, drawn round once and a bit. */
function ring(x: number, y: number, r: number, seed: number): string {
  const pts: string[] = [];
  const start = (seed % 628) / 100;
  for (let i = 0; i <= 28; i++) {
    const t = start + (i / 24) * Math.PI * 2;
    const rr = r * (1 + 0.08 * Math.sin(t * 2 + seed) + i * 0.004);
    pts.push(`${(x + Math.cos(t) * rr * 1.12).toFixed(1)} ${(y + Math.sin(t) * rr * 0.92).toFixed(1)}`);
  }
  return `M${pts.join('L')}`;
}

export class PencilMap {
  private svg: SVGSVGElement;
  private view: View | null = null;
  private target: View | null = null;
  private raf = 0;
  private game: Game | null = null;
  private width = 0;
  private height = 0;
  private still: MediaQueryList;

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    this.still = matchMedia('(prefers-reduced-motion: reduce)');
    new ResizeObserver(() => this.resize()).observe(svg);
  }

  private resize(): void {
    const r = this.svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.width = r.width;
    this.height = r.height;
    this.svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    if (this.game) {
      this.target = this.fit(this.game);
      this.view = { ...this.target };
      this.draw();
    }
  }

  clear(): void {
    this.game = null;
    this.view = null;
    this.svg.replaceChildren();
  }

  /** Redraw for the game as it now stands, gliding to the new framing. */
  update(game: Game): void {
    this.game = game;
    if (!this.width) this.resize();
    if (!this.width) return;
    this.target = this.fit(game);
    if (!this.view || this.still.matches) {
      this.view = { ...this.target };
      this.draw();
      return;
    }
    const from = { ...this.view };
    const to = this.target;
    const t0 = performance.now();
    cancelAnimationFrame(this.raf);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 650);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.view = {
        cx: from.cx + (to.cx - from.cx) * e,
        cy: from.cy + (to.cy - from.cy) * e,
        k: from.k * (to.k / from.k) ** e,
      };
      this.draw();
      if (t < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Frame everything visited plus the ways out of where you stand. */
  private fit(g: Game): View {
    const town = g.town;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const take = (x: number, y: number) => {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    };
    for (const id of g.visited) take(town.stops[id].x, town.stops[id].y);
    const here = town.stops[g.at];
    for (const x of exitsOf(town, g.at)) take(town.stops[x.to].x, town.stops[x.to].y);
    take(here.x, here.y);
    // Keep the newest part of the walk in view when the whole walk is large.
    const span = Math.max(x1 - x0, y1 - y0, 160);
    const pad = 70;
    const k = Math.min((this.width - pad * 2) / Math.max(x1 - x0, span * 0.6), (this.height - pad * 2) / Math.max(y1 - y0, span * 0.6), 2.4);
    const kk = Math.max(k, 0.35);
    let cx = (x0 + x1) / 2;
    let cy = (y0 + y1) / 2;
    // If the fit is too tight to show everything, centre on where you are.
    const halfW = (this.width / 2 - pad / 2) / kk;
    const halfH = (this.height / 2 - pad / 2) / kk;
    if (Math.abs(here.x - cx) > halfW || Math.abs(here.y - cy) > halfH) {
      cx = here.x;
      cy = here.y;
    }
    return { cx, cy, k: kk };
  }

  private draw(): void {
    const g = this.game;
    const v = this.view;
    if (!g || !v) return;
    const town = g.town;
    const W = this.width;
    const H = this.height;
    const px = (x: number) => W / 2 + (x - v.cx) * v.k;
    const py = (y: number) => H / 2 - (y - v.cy) * v.k;
    const svg = this.svg;
    svg.replaceChildren();
    const defs = el('defs', {}, svg);
    const f = el('filter', { id: 'oe-pencil', x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: 2, seed: 3, result: 'n' }, f);
    el('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: 1.6, xChannelSelector: 'R', yChannelSelector: 'G' }, f);

    const lines = el('g', { class: 'pencil', filter: 'url(#oe-pencil)' }, svg);
    const marks = el('g', { class: 'marks' }, svg);
    const labels = el('g', { class: 'labels' }, svg);

    // Ways walked.
    let d = '';
    for (const id of g.walked) {
      const e = town.edges[id];
      const a = town.stops[e.a];
      const b = town.stops[e.b];
      d += stroke(px(a.x), py(a.y), px(b.x), py(b.y), id * 7);
    }
    el('path', { d, class: 'walked' }, lines);

    // Ways seen but not taken: a short stub from each visited place.
    let stubs = '';
    for (const sid of g.visited) {
      const s = town.stops[sid];
      for (const x of exitsOf(town, sid)) {
        if (g.walked.has(x.edge)) continue;
        const ang = (x.bearing * Math.PI) / 180;
        const x1 = px(s.x) + Math.sin(ang) * 9;
        const y1 = py(s.y) - Math.cos(ang) * 9;
        const len = x.out ? 10 : 15;
        stubs += stroke(x1, y1, x1 + Math.sin(ang) * len, y1 - Math.cos(ang) * len, x.edge * 3 + sid);
      }
    }
    el('path', { d: stubs, class: 'stub' }, lines);

    // A box for every place stood in.
    let boxes = '';
    for (const sid of g.visited) {
      const s = town.stops[sid];
      boxes += box(px(s.x), py(s.y), s.square ? 6.5 : 5, sid);
    }
    el('path', { d: boxes, class: 'box' }, lines);

    // Errands and the meeting place, once seen.
    const pending = g.errands.filter((e) => !e.done);
    const flagged = new Map<number, string[]>();
    const flag = (sp: Spot, text: string) => {
      if (!flagged.has(sp.at)) flagged.set(sp.at, []);
      flagged.get(sp.at)!.push(text);
    };
    for (const id of g.seen) {
      const sp = town.spots[id];
      if (sp.at < 0) continue;
      for (const e of pending) if (e.def.tags.includes(sp.kind.tag)) flag(sp, sp.name ?? sp.kind.noun);
    }
    if (g.meet && !g.meet.done && g.seen.has(g.meet.spot)) flag(town.spots[g.meet.spot], `${town.spots[g.meet.spot].name}`);

    // Labels: where you are, where you started, flagged places, then as many others as fit.
    const placed: [number, number, number, number][] = [];
    const fits = (x: number, y: number, w: number, h: number) => {
      if (x < 4 || y < 4 || x + w > W - 4 || y + h > H - 4) return false;
      for (const [a, b, c, dd] of placed) if (x < c && x + w > a && y < dd && y + h > b) return false;
      return true;
    };
    const label = (sid: number, text: string, cls: string): boolean => {
      const s = town.stops[sid];
      const x = px(s.x);
      const y = py(s.y);
      const w = text.length * 6.4 + 4;
      const h = 15;
      for (const [ox, oy] of [
        [9, -4],
        [-9 - w, -4],
        [-w / 2, -21],
        [-w / 2, 10],
      ]) {
        if (fits(x + ox, y + oy - 10, w, h)) {
          placed.push([x + ox, y + oy - 10, x + ox + w, y + oy - 10 + h]);
          el('text', { x: (x + ox + 2).toFixed(1), y: (y + oy + 1).toFixed(1), class: cls }, labels).textContent = text;
          return true;
        }
      }
      return false;
    };
    // Reserve the boxes themselves so labels steer round them.
    for (const sid of g.visited) {
      const s = town.stops[sid];
      placed.push([px(s.x) - 6, py(s.y) - 6, px(s.x) + 6, py(s.y) + 6]);
    }
    const short = (t: string) => {
      const m = /^Corner of (.+?) and (.+)$/.exec(t) ?? /^Where (.+?), (.+?) and (.+) meet/.exec(t);
      const base = m ? m[1] : t.replace(/,.*$/, '').replace(/ (near|off) .*$/, '');
      return base.length > 22 ? `${base.slice(0, 21)}…` : base;
    };
    const here = town.stops[g.at];
    el('path', { d: ring(px(here.x), py(here.y), 11, g.moves + g.at), class: 'here' }, marks);
    label(g.at, short(here.title), 'lab here-lab');
    for (const [sid, texts] of flagged) {
      const s = town.stops[sid];
      el('path', { d: `M${px(s.x) + 7} ${py(s.y) - 13}l3 6l-6 0z`, class: 'star' }, marks);
      label(sid, texts.slice(0, 2).join(', '), 'lab flag');
    }
    if (town.start !== g.at && g.visited.has(town.start)) label(town.start, short(town.stops[town.start].title), 'lab');
    const named = [...g.visited].filter((id) => id !== g.at && id !== town.start && !flagged.has(id));
    named.sort((p, q) => town.stops[q].edges.length - town.stops[p].edges.length || p - q);
    let shown = 0;
    const seen = new Set<string>();
    for (const sid of named) {
      if (shown > 40) break;
      const t = short(town.stops[sid].title);
      if (seen.has(t)) continue;
      if (label(sid, t, 'lab')) {
        shown++;
        seen.add(t);
      }
    }

    // Compass and scale, in the corner as you'd draw them.
    const cx = W - 34;
    const cy = 40;
    el('path', { d: `${stroke(cx, cy + 16, cx, cy - 16, 11)}M${cx - 5} ${cy - 9}L${cx} ${cy - 17}L${cx + 5} ${cy - 9}`, class: 'compass' }, lines);
    el('text', { x: cx - 4, y: cy - 21, class: 'lab n' }, labels).textContent = 'N';
    const metres = [20, 50, 100, 200, 500].find((m) => m * v.k > 60) ?? 500;
    const sx = 22;
    const sy = H - 22;
    el('path', { d: `${stroke(sx, sy, sx + metres * v.k, sy, 5)}M${sx} ${sy - 4}L${sx} ${sy + 4}M${sx + metres * v.k} ${sy - 4}L${sx + metres * v.k} ${sy + 4}`, class: 'scale' }, lines);
    el('text', { x: sx, y: sy - 8, class: 'lab' }, labels).textContent = `${metres} m`;
    this.svg.setAttribute('aria-label', `Your map: ${g.visited.size} places visited. You are at ${here.title}, facing ways ${exitsOf(town, g.at).map((x) => (x.dir ? COMPASS_WORD[x.dir] : 'unnamed')).join(', ')}.`);
  }
}
