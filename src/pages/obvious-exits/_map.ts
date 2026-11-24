// The map you keep as you go, in pencil on squared paper, the way adventure players drew theirs:
// a box for every place you've stood, a line for every way you've walked, a stub for each way you
// haven't tried yet, and a ring round where you are now. Drawn as SVG, north up, true to scale.

import { COMPASS_WORD, exitsOf, hash } from './_describe';
import type { Game } from './_game';
import type { Spot } from './_town';

const NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  const j = (k: number) => ((hash(seed, k) % 100) / 100 - 0.5) * 1.6;
  const a = [x - r + j(1), y - r + j(2)];
  const b = [x + r + j(3), y - r + j(4)];
  const c = [x + r + j(5), y + r + j(6)];
  const d = [x - r + j(7), y + r + j(8)];
  return [
    stroke(a[0], a[1], b[0], b[1], seed),
    stroke(b[0], b[1], c[0], c[1], seed + 1),
    stroke(c[0], c[1], d[0], d[1], seed + 2),
    stroke(d[0], d[1], a[0], a[1], seed + 3),
  ].join('');
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
  private raf = 0;
  private game: Game | null = null;
  private width = 0;
  private height = 0;
  /** Room kept clear at the top for the taped-on list. */
  private top = 0;
  private still: MediaQueryList;
  /** Walks already drawn, and the ones being drawn in now. */
  private known = new Set<number>();
  private fresh = new Map<number, { from: number; t0: number }>();

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    this.still = matchMedia('(prefers-reduced-motion: reduce)');
    new ResizeObserver(() => this.resize()).observe(svg);
  }

  setTop(px: number): void {
    this.top = px;
  }

  private resize(): void {
    const r = this.svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.width = r.width;
    this.height = r.height;
    this.svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    if (this.game) {
      this.view = this.fit(this.game);
      this.draw(performance.now());
    }
  }

  clear(): void {
    this.game = null;
    this.view = null;
    this.known.clear();
    this.fresh.clear();
    cancelAnimationFrame(this.raf);
    this.svg.replaceChildren();
  }

  /** Redraw for the game as it now stands, gliding to the new framing and pencilling in new walks. */
  update(game: Game): void {
    const newGame = this.game !== game;
    this.game = game;
    if (newGame) {
      this.known.clear();
      this.fresh.clear();
    }
    if (!this.width) this.resize();
    if (!this.width) return;
    const now = performance.now();
    for (const id of game.walked) {
      if (this.known.has(id)) continue;
      this.known.add(id);
      if (!newGame && !this.still.matches) this.fresh.set(id, { from: game.prev, t0: now });
    }
    const to = this.fit(game);
    if (!this.view || this.still.matches || newGame) {
      this.view = to;
      this.draw(now);
      return;
    }
    const from = { ...this.view };
    cancelAnimationFrame(this.raf);
    const step = (t: number) => {
      const p = Math.min(1, (t - now) / 650);
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      this.view = { cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, k: from.k * (to.k / from.k) ** e };
      const drawing = this.draw(t);
      if (p < 1 || drawing) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Frame everywhere you have been, centred in the paper below the list. */
  private fit(g: Game): View {
    const town = g.town;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const here = town.stops[g.at];
    for (const id of [...g.visited, g.at]) {
      const s = town.stops[id];
      x0 = Math.min(x0, s.x);
      y0 = Math.min(y0, s.y);
      x1 = Math.max(x1, s.x);
      y1 = Math.max(y1, s.y);
    }
    const pad = 64;
    const usableH = this.height - this.top;
    const k = Math.max(0.42, Math.min(2.2, (this.width - pad * 2) / Math.max(x1 - x0, 240), (usableH - pad * 2) / Math.max(y1 - y0, 240)));
    let cx = (x0 + x1) / 2;
    let cy = (y0 + y1) / 2;
    // When the whole walk won't fit, follow where you are.
    if (Math.abs(here.x - cx) * k > this.width / 2 - pad / 2 || Math.abs(here.y - cy) * k > usableH / 2 - pad / 2) {
      cx = here.x;
      cy = here.y;
    }
    return { cx, cy, k };
  }

  /** Draw a frame; true while a walk is still being pencilled in. */
  private draw(now: number): boolean {
    const g = this.game;
    const v = this.view;
    if (!g || !v) return false;
    const town = g.town;
    const W = this.width;
    const H = this.height;
    const midY = this.top + (H - this.top) / 2;
    const px = (x: number) => W / 2 + (x - v.cx) * v.k;
    const py = (y: number) => midY - (y - v.cy) * v.k;
    const svg = this.svg;
    svg.replaceChildren();
    const defs = el('defs', {}, svg);
    const f = el('filter', { id: 'oe-pencil', x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: 2, seed: 3, result: 'n' }, f);
    el('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: 1.6, xChannelSelector: 'R', yChannelSelector: 'G' }, f);

    const lines = el('g', { class: 'pencil', filter: 'url(#oe-pencil)' }, svg);
    const marks = el('g', { class: 'marks' }, svg);
    const labels = el('g', { class: 'labels' }, svg);

    // Ways walked; a new one is drawn in from where you set off.
    let d = '';
    let drawing = false;
    for (const id of g.walked) {
      const e = town.edges[id];
      const fr = this.fresh.get(id);
      const a = town.stops[fr && fr.from === e.b ? e.b : e.a];
      const b = town.stops[fr && fr.from === e.b ? e.a : e.b];
      const path = stroke(px(a.x), py(a.y), px(b.x), py(b.y), id * 7);
      if (!fr) {
        d += path;
        continue;
      }
      const p = Math.min(1, (now - fr.t0) / 700);
      if (p >= 1) {
        this.fresh.delete(id);
        d += path;
        continue;
      }
      drawing = true;
      const len = Math.hypot(px(b.x) - px(a.x), py(b.y) - py(a.y)) * 1.06 + 6;
      el('path', { d: path, class: 'walked', 'stroke-dasharray': `${len.toFixed(1)} ${len.toFixed(1)}`, 'stroke-dashoffset': (len * (1 - p * p * (3 - 2 * p))).toFixed(1) }, lines);
    }
    el('path', { d, class: 'walked' }, lines);

    // Ways seen but not taken: a stub from each visited place.
    let stubs = '';
    for (const sid of g.visited) {
      const s = town.stops[sid];
      for (const x of exitsOf(town, sid)) {
        if (g.walked.has(x.edge)) continue;
        const ang = (x.bearing * Math.PI) / 180;
        const x1 = px(s.x) + Math.sin(ang) * 8;
        const y1 = py(s.y) - Math.cos(ang) * 8;
        const len = x.out ? 8 : Math.max(9, Math.min(24, town.edges[x.edge].len * v.k * 0.45));
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
      const list = flagged.get(sp.at)!;
      if (!list.includes(text)) list.push(text);
    };
    for (const id of g.seen) {
      const sp = town.spots[id];
      if (sp.at < 0) continue;
      for (const e of pending) if (e.def.tags.includes(sp.kind.tag)) flag(sp, sp.name ?? sp.kind.noun);
    }
    if (g.meet && !g.meet.done && g.seen.has(g.meet.spot)) flag(town.spots[g.meet.spot], `${town.spots[g.meet.spot].name}`);

    // Labels: where you are, flagged places, where you started, then as many others as fit.
    const placed: [number, number, number, number][] = [];
    const fits = (x: number, y: number, w: number, h: number) => {
      if (x < 4 || y < 4 || x + w > W - 4 || y + h > H - 4) return false;
      for (const [a, b, c, dd] of placed) if (x < c && x + w > a && y < dd && y + h > b) return false;
      return true;
    };
    const label = (sid: number, text: string, cls: string, gap = 9): boolean => {
      const s = town.stops[sid];
      const x = px(s.x);
      const y = py(s.y);
      const w = text.length * 6.4 + 4;
      const h = 15;
      for (const [ox, oy] of [
        [gap, -4],
        [-gap - w, -4],
        [-w / 2, -gap - 12],
        [-w / 2, gap + 11],
      ]) {
        if (fits(x + ox, y + oy - 10, w, h)) {
          placed.push([x + ox, y + oy - 10, x + ox + w, y + oy - 10 + h]);
          el('text', { x: (x + ox + 2).toFixed(1), y: (y + oy + 1).toFixed(1), class: cls }, labels).textContent = text;
          return true;
        }
      }
      return false;
    };
    for (const sid of g.visited) {
      const s = town.stops[sid];
      placed.push([px(s.x) - 6, py(s.y) - 6, px(s.x) + 6, py(s.y) + 6]);
    }
    // The town and the day, titled across the foot of the page.
    const [yy, mm, dd] = g.sky.date.split('-').map(Number);
    const title = `${g.where.name}, ${DAYS[g.sky.weekday]} ${dd} ${MONTHS[mm - 1]}`;
    const tw = title.length * 8.6;
    if (W > 520 && H > 420) {
      const tx = W - tw - 22;
      const ty = H - 22;
      placed.push([tx - 4, ty - 20, W, H]);
      el('text', { x: tx, y: ty, class: 'lab title' }, labels).textContent = title;
      el('path', { d: stroke(tx - 2, ty + 6, tx + tw, ty + 5, yy + mm + dd), class: 'underline' }, lines);
    }

    const short = (t: string) => {
      const m = /^Corner of (.+?) and (.+)$/.exec(t) ?? /^Where (.+?), (.+?) and (.+) meet/.exec(t);
      const base = m ? m[1] : t.replace(/,.*$/, '').replace(/ (near|off) .*$/, '');
      return base.length > 22 ? `${base.slice(0, 21)}…` : base;
    };
    const here = town.stops[g.at];
    el('path', { d: ring(px(here.x), py(here.y), 11, g.moves + g.at), class: 'here' }, marks);
    placed.push([px(here.x) - 14, py(here.y) - 12, px(here.x) + 14, py(here.y) + 12]);
    label(g.at, short(here.title), 'lab here-lab', 15);
    for (const [sid, texts] of flagged) {
      const s = town.stops[sid];
      el('path', { d: `M${(px(s.x) + 7).toFixed(1)} ${(py(s.y) - 13).toFixed(1)}l3 6l-6 0z`, class: 'star' }, marks);
      label(sid, texts.slice(0, 2).join(', '), 'lab flag');
    }
    if (town.start !== g.at && g.visited.has(town.start)) label(town.start, short(town.stops[town.start].title), 'lab');
    const named = [...g.visited].filter((id) => id !== g.at && id !== town.start && !flagged.has(id));
    named.sort((p, q) => town.stops[q].edges.length - town.stops[p].edges.length || p - q);
    let shown = 0;
    const used = new Set<string>([short(here.title)]);
    for (const sid of named) {
      if (shown > 40) break;
      const t = short(town.stops[sid].title);
      if (used.has(t)) continue;
      if (label(sid, t, 'lab')) {
        shown++;
        used.add(t);
      }
    }

    // Compass and scale, in the corners as you'd draw them.
    const cx = W - 34;
    const cy = 42;
    el('path', { d: `${stroke(cx, cy + 16, cx, cy - 16, 11)}M${cx - 5} ${cy - 9}L${cx} ${cy - 17}L${cx + 5} ${cy - 9}`, class: 'compass' }, lines);
    el('text', { x: cx - 4, y: cy - 21, class: 'lab n' }, labels).textContent = 'N';
    const metres = [20, 50, 100, 200, 500].find((m) => m * v.k > 60) ?? 500;
    const sx = 22;
    const sy = H - 22;
    el(
      'path',
      { d: `${stroke(sx, sy, sx + metres * v.k, sy, 5)}M${sx} ${sy - 4}L${sx} ${sy + 4}M${(sx + metres * v.k).toFixed(1)} ${sy - 4}L${(sx + metres * v.k).toFixed(1)} ${sy + 4}`, class: 'scale' },
      lines,
    );
    el('text', { x: sx, y: sy - 8, class: 'lab' }, labels).textContent = `${metres} m`;
    this.svg.setAttribute(
      'aria-label',
      `Your map: ${g.visited.size} places visited. You are at ${here.title}; ways lead ${exitsOf(town, g.at)
        .map((x) => (x.dir ? COMPASS_WORD[x.dir] : 'off unmarked'))
        .join(', ')}.`,
    );
    return drawing;
  }
}
