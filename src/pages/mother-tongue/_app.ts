// The page: the tree, the reading point, and everything drawn from it.

import { FABLE_TITLE } from './_fable';
import { eraName, formsAt, lineage, makeFamily, scriptAt, SPAN, yearsAgo, type Family, type Lang } from './_family';
import { COMPARE, ENGLISH, MORPHS, type Meaning } from './_lang';
import { CONSONANTS, ipa, isVowel, romanize, romanStyle, vowel, type Word } from './_phon';
import {
  dividerPath,
  drawGlyph,
  drawMarks,
  OP_TEXT,
  signWidth,
  spell,
  type Script,
  type ScriptState,
  type Sign,
} from './_script';

const SVG = 'http://www.w3.org/2000/svg';
const DEFAULT_SEED = 1;
const PLAY_SECONDS = 36;

interface View {
  fam: Family;
  node: Lang;
  t: number;
  /** The leaf the reader is heading for, so stepping down at a split stays on course. */
  aim: Lang;
  word: Meaning;
  playing: boolean;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const isMorph = (p: string) => (MORPHS as readonly string[]).includes(p);

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function roman(node: Lang, w: Word | undefined): string {
  if (!w) return '';
  return romanize(w, romanStyle(node.romanIndex), node.longMark);
}

function glossHtml(gloss: string): string {
  return gloss
    .split('-')
    .map((p) => (/^[0-9A-Z.]+$/.test(p) && p !== 'I' ? `<b>${esc(p)}</b>` : esc(p)))
    .join('-');
}

/** The lexical meaning a written word carries, for looking it up. */
function headMeaning(parts: string[]): Meaning | null {
  const m = parts.find((p) => !isMorph(p));
  return (m as Meaning) ?? null;
}

// --- Writing signs ------------------------------------------------------------------

interface SignCache {
  defs: SVGDefsElement;
  ids: Map<string, string>;
  next: number;
}

function signKey(sign: Sign): string {
  return `${sign.letter}|${sign.marks.map((m) => m.kind + m.place).join(',')}`;
}

function signPath(s: Script, sign: Sign, st: ScriptState, size: number, fading: Map<string, Map<number, number>>): string {
  const g = sign.letter === '·carrier' ? s.carrier : s.letters.get(sign.letter);
  let d = g ? drawGlyph(g, st, size, st.mirror < 0 ? Math.min(-0.05, st.mirror) : Math.max(0.05, st.mirror), fading.get(sign.letter)) : '';
  if (!g && sign.letter) d = '';
  d += drawMarks(sign.marks, st, size);
  return d;
}

/** Lay out and draw written words into an SVG, filling `width`. Returns the height used. */
function drawWriting(
  svg: SVGSVGElement,
  s: Script,
  fading: Map<string, Map<number, number>>,
  words: { signs: Sign[]; end?: boolean; hl?: boolean }[],
  width: number,
  size: number,
  layers: 'tablet' | 'plain',
): number {
  const st = s.state;
  svg.replaceChildren();
  const defs = el('defs');
  svg.append(defs);
  const cache: SignCache = { defs, ids: new Map(), next: 0 };
  const prefix = layers === 'tablet' ? 'mt-s' : `mt-p${Math.random().toString(36).slice(2, 7)}`;
  const idFor = (sign: Sign): string => {
    const key = signKey(sign);
    let id = cache.ids.get(key);
    if (!id) {
      id = `${prefix}${cache.next++}`;
      cache.ids.set(key, id);
      defs.append(el('path', { id, d: signPath(s, sign, st, size, fading) }));
    }
    return id;
  };

  const adv = signWidth(st, size);
  const gap = size * 0.16;
  const spaceGap = size * 0.62;
  const dividerGap = size * 0.85;
  const wordGap = dividerGap + (spaceGap - dividerGap) * st.spaces;
  const lineH = size * 2.15;
  const widths = words.map((w) => w.signs.reduce((n, sg) => n + (sg.twice ? 2 : 1) * (adv + gap), 0) - gap);
  const endRoom = size * 0.9;
  const room = (i: number) => widths[i] + (words[i].end ? endRoom : 0);

  // Greedy line filling, then each full line justified by widening its word gaps.
  const lines: number[][] = [[]];
  let x = 0;
  words.forEach((_, i) => {
    const need = room(i) + (x > 0 ? wordGap : 0);
    if (x > 0 && x + need > width) {
      lines.push([]);
      x = 0;
    }
    x += x > 0 ? wordGap + room(i) : room(i);
    lines[lines.length - 1].push(i);
  });

  const group = el('g', { id: `${prefix}-lines` });
  const marks = el('g', { class: 'hl' });
  const ruling = el('g', { class: 'ruling' });
  const rtl = st.mirror < 0;
  const bous = st.bous > 0.5;
  lines.forEach((line, li) => {
    const flip = bous && li % 2 === 1;
    const backwards = rtl !== flip;
    const y = size * 0.95 + li * lineH;
    const natural = line.reduce((n, wi) => n + room(wi), 0) + wordGap * (line.length - 1);
    const last = li === lines.length - 1;
    const stretch = !last && line.length > 1 ? Math.min((width - natural) / (line.length - 1), size * 1.4) : 0;
    const lineGap = wordGap + Math.max(0, stretch);
    const at = (px: number) => (backwards ? width - px : px);
    if (layers === 'tablet') {
      ruling.append(el('line', { x1: 0, x2: width, y1: y.toFixed(2), y2: y.toFixed(2) }));
      ruling.append(el('line', { x1: 0, x2: width, y1: (y + size).toFixed(2), y2: (y + size).toFixed(2) }));
    }
    let cx = 0;
    let dividers = '';
    line.forEach((wi, k) => {
      const w = words[wi];
      if (k > 0) {
        if (st.spaces < 0.98) {
          dividers += dividerPath({ ...st, weight: st.weight * (1 - st.spaces * 0.9) }, size, at(cx + lineGap / 2));
        }
        cx += lineGap;
      }
      const start = cx;
      for (const sign of w.signs) {
        for (let rep = 0; rep < (sign.twice ? 2 : 1); rep++) {
          const id = idFor(sign);
          const gx = backwards ? width - cx - adv : cx;
          const attrs: Record<string, string> = { href: `#${id}` };
          if (flip) attrs.transform = `translate(${(gx + adv).toFixed(2)} ${y.toFixed(2)}) scale(-1 1)`;
          else attrs.transform = `translate(${gx.toFixed(2)} ${y.toFixed(2)})`;
          group.append(el('use', attrs));
          cx += adv + gap;
        }
      }
      cx -= gap;
      if (w.hl && layers === 'tablet') {
        const a = Math.min(at(start), at(cx));
        const b = Math.max(at(start), at(cx));
        marks.append(
          el('rect', {
            x: (a - size * 0.2).toFixed(2),
            y: (y - size * 0.5).toFixed(2),
            width: (b - a + size * 0.4).toFixed(2),
            height: (size * 1.95).toFixed(2),
            rx: 3,
          }),
          el('line', {
            x1: (a - size * 0.1).toFixed(2),
            x2: (b + size * 0.1).toFixed(2),
            y1: (y + size * 1.38).toFixed(2),
            y2: (y + size * 1.38).toFixed(2),
          }),
        );
      }
      if (st.headline > 0.02) {
        const len = (cx - start + size * 0.2) * st.headline;
        const mid = (start + cx) / 2;
        const x0 = backwards ? width - mid - len / 2 : mid - len / 2;
        const h = st.weight * size * 1.1;
        group.append(
          el('rect', { x: x0.toFixed(2), y: (y - h * 0.45).toFixed(2), width: len.toFixed(2), height: h.toFixed(2) }),
        );
      }
      if (w.end) {
        // A sentence ends with a bar.
        cx += endRoom;
        const h = st.weight * size;
        const bx = at(cx - endRoom * 0.45);
        group.append(el('rect', { x: (bx - h / 2).toFixed(2), y: y.toFixed(2), width: h.toFixed(2), height: size.toFixed(2) }));
      }
    });
    if (dividers) group.append(el('path', { d: dividers, transform: `translate(0 ${y.toFixed(2)})` }));
  });
  defs.append(group);
  const height = size * 0.95 + (lines.length - 1) * lineH + size * 1.45;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('height', String(height));
  if (layers === 'tablet') {
    svg.append(ruling, marks);
    svg.append(el('use', { href: `#${prefix}-lines`, class: 'cut-light', transform: 'translate(1.1 1.3)' }));
    svg.append(el('use', { href: `#${prefix}-lines`, class: 'cut-dark' }));
    svg.append(el('use', { href: `#${prefix}-lines`, class: 'ink' }));
  } else {
    svg.append(el('use', { href: `#${prefix}-lines` }));
  }
  return height;
}

// --- The tree -----------------------------------------------------------------------

interface TreeGeom {
  w: number;
  h: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function geom(svg: SVGSVGElement): TreeGeom {
  const w = svg.clientWidth || 480;
  const h = svg.clientHeight || 700;
  return h < 400 ? { w, h, left: 50, right: 14, top: 30, bottom: 34 } : { w, h, left: 58, right: 24, top: 40, bottom: 52 };
}

const tx = (g: TreeGeom, n: Lang) => g.left + 26 + n.x * (g.w - g.left - g.right - 52);
const ty = (g: TreeGeom, t: number) => g.top + (t / SPAN) * (g.h - g.top - g.bottom);
const tAt = (g: TreeGeom, y: number) => ((y - g.top) / (g.h - g.top - g.bottom)) * SPAN;

function drawTree(svg: SVGSVGElement, v: View): void {
  const g = geom(svg);
  svg.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`);
  svg.replaceChildren();
  const onPath = new Set(lineage(v.node).map((n) => n.id));
  const aimPath = new Set(lineage(v.aim).map((n) => n.id));

  const axis = el('g', { class: 'axis' });
  for (let y = 0; y <= SPAN; y += 500) {
    const py = ty(g, y);
    axis.append(el('line', { x1: g.left - 6, x2: g.w - 4, y1: py, y2: py }));
    const label = el('text', { x: g.left - 10, y: py + 4, 'text-anchor': 'end' });
    label.textContent = y === SPAN ? 'today' : (SPAN - y).toLocaleString('en-US');
    axis.append(label);
  }
  const cap = el('text', { x: g.left - 10, y: g.top - 22, 'text-anchor': 'end' });
  cap.textContent = 'years ago';
  axis.append(cap);
  svg.append(axis);

  const branches = el('g');
  const marks = el('g');
  const labels = el('g');
  for (const n of v.fam.nodes) {
    const x = tx(g, n);
    const color = n.children.length ? '#2a2622' : n.color;
    const dim = !onPath.has(n.id) && !aimPath.has(n.id) && !isDescendant(n, v.node);
    const path = el('path', {
      class: `branch${dim ? ' dim' : ''}`,
      stroke: color,
      d: `M${x} ${ty(g, n.t0)}V${ty(g, n.t1)}`,
    });
    branches.append(path);
    if (n.children.length) {
      const xs = n.children.map((c) => tx(g, c));
      const y = ty(g, n.t1);
      branches.append(
        el('path', {
          class: `branch${dim && !n.children.some((c) => onPath.has(c.id) || aimPath.has(c.id)) ? ' dim' : ''}`,
          stroke: '#2a2622',
          d: `M${Math.min(...xs)} ${y}H${Math.max(...xs)}`,
        }),
      );
      marks.append(el('circle', { class: 'split', cx: x, cy: y, r: 4.5 }));
    }
    for (const c of n.changes) {
      const y = ty(g, c.t);
      marks.append(el('line', { class: 'tick-change', stroke: color, x1: x - 5, x2: x + 5, y1: y, y2: y, opacity: dim ? 0.35 : 1 }));
    }
    for (const op of n.ops) {
      const y = ty(g, op.t);
      marks.append(
        el('rect', {
          class: 'tick-script',
          stroke: color,
          x: x + 6,
          y: y - 3,
          width: 6,
          height: 6,
          transform: `rotate(45 ${x + 9} ${y})`,
          opacity: dim ? 0.35 : 1,
        }),
      );
    }
    if (!n.children.length) {
      const t = el('text', {
        class: 'leaf-name',
        x,
        y: ty(g, n.t1) + (n.extinct ? 4 : 22),
        'text-anchor': n.extinct ? 'start' : 'middle',
        dx: n.extinct ? 10 : 0,
        fill: n.color,
      });
      t.textContent = n.extinct ? `${n.name} †` : n.name;
      labels.append(t);
    } else {
      const t = el('text', {
        class: 'node-name',
        x: x + 9,
        y: n.parent ? ty(g, n.t1) - 8 : ty(g, n.t0) - 14,
        'text-anchor': n.parent ? 'start' : 'middle',
      });
      t.textContent = `Proto-${n.name}`;
      labels.append(t);
    }
  }
  svg.append(branches, marks, labels);

  // The reading point.
  const x = tx(g, v.node);
  const y = ty(g, v.t);
  const color = v.node.children.length ? '#2a2622' : v.node.color;
  const cursor = el('g', { class: 'cursor' });
  cursor.append(el('line', { class: 'cursor-line', stroke: color, x1: g.left - 4, x2: x, y1: y, y2: y }));
  cursor.append(el('circle', { class: 'cursor-ring', stroke: color, cx: x, cy: y, r: 8 }));
  cursor.append(el('circle', { fill: color, cx: x, cy: y, r: 3 }));
  svg.append(cursor);
  svg.setAttribute('aria-valuetext', `${eraName(v.fam, v.node, v.t)}, ${yearsAgo(v.t)}`);
}

function isDescendant(n: Lang, of: Lang): boolean {
  for (let p: Lang | null = n.parent; p; p = p.parent) if (p === of) return true;
  return false;
}

function nearest(v: View, g: TreeGeom, px: number, py: number): { node: Lang; t: number } {
  const t = Math.max(0, Math.min(SPAN, tAt(g, py)));
  let best = v.fam.root;
  let bestD = Infinity;
  for (const n of v.fam.nodes) {
    const ct = Math.max(n.t0, Math.min(n.t1, t));
    const d = Math.hypot(px - tx(g, n), (py - ty(g, ct)) * 0.6);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return { node: best, t: Math.max(best.t0, Math.min(best.t1, t)) };
}

// --- The page -----------------------------------------------------------------------

export function start(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const tree = q<SVGSVGElement>('[data-tree]');
  const inscription = q<SVGSVGElement>('[data-inscription]');
  const tablet = q<HTMLElement>('[data-tablet]');
  const eraEl = q<HTMLElement>('[data-era]');
  const whenEl = q<HTMLElement>('[data-when]');
  const mediumEl = q<HTMLElement>('[data-medium-label]');
  const captionEl = q<HTMLElement>('[data-script-caption]');
  const interlinear = q<HTMLElement>('[data-interlinear]');
  const etymology = q<HTMLElement>('[data-etymology]');
  const alphabet = q<HTMLElement>('[data-alphabet]');
  const alphabetSub = q<HTMLElement>('[data-alphabet-sub]');
  const history = q<HTMLElement>('[data-history]');
  const compare = q<HTMLTableElement>('[data-compare]');
  const seedEl = q<HTMLOutputElement>('[data-seed]');
  const playBtn = q<HTMLButtonElement>('[data-play]');
  const newBtn = q<HTMLButtonElement>('[data-new]');

  const params = new URLSearchParams(location.search);
  const seed = Math.max(1, Math.min(99999, Number.parseInt(params.get('family') ?? '', 10) || DEFAULT_SEED));
  const fam = makeFamily(seed);
  const startNode = fam.nodes[Number.parseInt(params.get('lang') ?? '', 10)] ?? fam.root;
  const ago = Number.parseFloat(params.get('ago') ?? '');
  const startT = Number.isFinite(ago) ? Math.max(startNode.t0, Math.min(startNode.t1, SPAN - ago)) : startNode.t0;
  const firstLeaf = (n: Lang): Lang => (n.children.length ? firstLeaf(n.children[0]) : n);
  const v: View = { fam, node: startNode, t: startT, aim: firstLeaf(startNode), word: 'sheep', playing: false };

  let dirty = true;
  let textKey = '';
  let lastUrl = '';
  const invalidate = () => {
    if (!dirty) {
      dirty = true;
      requestAnimationFrame(frame);
    }
  };

  function setFamily(f: Family): void {
    v.fam = f;
    v.node = f.root;
    v.t = 0;
    v.aim = firstLeaf(f.root);
    textKey = '';
    seedEl.textContent = `No. ${f.seed}`;
    drawCompare();
    invalidate();
  }

  function select(node: Lang, t: number): void {
    v.node = node;
    v.t = Math.max(node.t0, Math.min(node.t1, t));
    if (!node.children.length) v.aim = node;
    else if (!isDescendant(v.aim, node)) v.aim = firstLeaf(node);
    invalidate();
  }

  // Tree pointer and keys.
  let dragging = false;
  const pick = (e: PointerEvent) => {
    const rect = tree.getBoundingClientRect();
    const g = geom(tree);
    const hit = nearest(v, g, e.clientX - rect.left, e.clientY - rect.top);
    select(hit.node, hit.t);
  };
  tree.addEventListener('pointerdown', (e) => {
    stopPlay();
    dragging = true;
    tree.classList.add('dragging');
    try {
      tree.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured.
    }
    pick(e);
  });
  tree.addEventListener('pointermove', (e) => {
    if (dragging) pick(e);
  });
  const end = () => {
    dragging = false;
    tree.classList.remove('dragging');
  };
  tree.addEventListener('pointerup', end);
  tree.addEventListener('pointercancel', end);
  tree.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 100 : 25;
    if (e.key === 'ArrowDown') move(step);
    else if (e.key === 'ArrowUp') move(-step);
    else if (e.key === 'ArrowLeft') sideways(-1);
    else if (e.key === 'ArrowRight') sideways(1);
    else if (e.key === 'Home') select(v.fam.root, 0);
    else if (e.key === 'End') select(v.aim, v.aim.t1);
    else return;
    e.preventDefault();
    stopPlay();
  });

  function move(dt: number): void {
    let t = v.t + dt;
    let node = v.node;
    while (t > node.t1 && node.children.length) {
      node = node.children.find((c) => c === v.aim || isDescendant(v.aim, c)) ?? node.children[0];
    }
    while (t < node.t0 && node.parent) node = node.parent;
    t = Math.max(node.t0, Math.min(node.t1, t));
    select(node, t);
  }

  function sideways(dir: number): void {
    const here = v.fam.nodes.filter((n) => n.t0 <= v.t && n.t1 >= v.t).sort((a, b) => a.x - b.x);
    const i = here.indexOf(v.node);
    const next = here[i + dir];
    if (next) {
      v.aim = firstLeaf(next);
      select(next, v.t);
    }
  }

  // Play down the line of descent.
  let playFrom = 0;
  let playTo = 0;
  let playStart = 0;
  function stopPlay(): void {
    if (!v.playing) return;
    v.playing = false;
    playBtn.setAttribute('aria-pressed', 'false');
    playBtn.textContent = 'Play to here';
  }
  playBtn.addEventListener('click', () => {
    if (v.playing) return stopPlay();
    const atStart = v.node === v.fam.root && v.t < 40;
    playTo = atStart ? v.aim.t1 : v.t;
    if (!atStart) v.aim = v.node.children.length ? v.aim : v.node;
    playFrom = 0;
    playStart = performance.now();
    v.playing = true;
    playBtn.setAttribute('aria-pressed', 'true');
    playBtn.textContent = 'Stop';
    const target = v.aim;
    const tick = (now: number) => {
      if (!v.playing) return;
      const t = Math.min(playTo, playFrom + ((now - playStart) / 1000) * (SPAN / PLAY_SECONDS));
      const line = lineage(target);
      const node = line.find((n) => t >= n.t0 && t <= n.t1) ?? target;
      v.node = node;
      v.t = t;
      invalidate();
      if (t >= playTo) stopPlay();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  playBtn.textContent = v.node === v.fam.root && v.t < 40 ? 'Play' : 'Play to here';

  newBtn.addEventListener('click', () => {
    stopPlay();
    setFamily(makeFamily(1 + Math.floor(Math.random() * 99998)));
  });

  // Words: click any written word to trace it.
  interlinear.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-meaning]');
    if (!b?.dataset.meaning) return;
    v.word = b.dataset.meaning as Meaning;
    textKey = '';
    invalidate();
  });
  compare.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('[data-meaning]');
    if (!row) return;
    v.word = row.dataset.meaning as Meaning;
    textKey = '';
    invalidate();
    etymology.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  history.addEventListener('click', (e) => {
    const li = (e.target as Element).closest<HTMLElement>('[data-node]');
    if (!li) return;
    const node = v.fam.nodes[Number(li.dataset.node)];
    stopPlay();
    select(node, Number(li.dataset.t) + 1);
  });

  new ResizeObserver(() => {
    textKey = '';
    invalidate();
  }).observe(root);

  function drawCompare(): void {
    const langs = [v.fam.root, ...[...v.fam.leaves].sort((a, b) => a.x - b.x)];
    let html = '<thead><tr><th scope="col"></th>';
    for (const l of langs) {
      const name = l === v.fam.root ? `Proto-${l.name}` : l.extinct ? `${l.name} †` : l.name;
      html += `<th scope="col" style="color:${l === v.fam.root ? 'inherit' : l.color}">${esc(name)}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (const m of COMPARE) {
      html += `<tr data-meaning="${m}"><th scope="row">${esc(ENGLISH[m])}</th>`;
      for (const l of langs) {
        const w = l === v.fam.root ? l.snapshots[0].get(m) : l.snapshots[l.snapshots.length - 1].get(m);
        const text = l === v.fam.root ? `*${ipa(w ?? [])}` : roman(l, w);
        html += `<td>${esc(text)}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';
    compare.innerHTML = html;
  }

  function frame(): void {
    dirty = false;
    const { fam: f, node, t } = v;
    const { forms, applied } = formsAt(node, t);
    const { script, fading } = scriptAt(f, node, t);
    root.style.setProperty('--lang', node.children.length ? '#a3392b' : node.color);
    drawTree(tree, v);

    eraEl.textContent = eraName(f, node, t);
    whenEl.textContent = t <= 1 ? '3,000 years ago' : yearsAgo(t);
    const st = script.state;
    mediumEl.textContent = st.ink < 0.5 ? 'cut in stone' : 'written in ink';
    tablet.style.setProperty('--ink-k', st.ink.toFixed(3));

    // The inscription.
    const words = f.sentences.flatMap((s) =>
      s.tokens.map((tk, i) => ({
        signs: spell(script, forms.get(tk.key) ?? []),
        end: i === s.tokens.length - 1,
        hl: headMeaning(tk.parts) === v.word,
      })),
    );
    const width = Math.max(240, inscription.clientWidth || tablet.clientWidth - 60);
    // One letter size for the whole family, so the tablet keeps its size as you scrub.
    const target = width < 600 ? 470 : 540;
    const size = Math.max(15, Math.min(34, Math.sqrt((width * target) / (2.1 * signBudget(f)))));
    drawWriting(inscription, script, fading, words, width, size, 'tablet');
    captionEl.textContent = describeScript(script);

    // Text that changes only when the words do.
    const key = `${f.seed}:${node.id}:${applied}:${v.word}`;
    if (key !== textKey) {
      textKey = key;
      drawInterlinear(forms);
      drawEtymology(script, t);
      drawAlphabet(script, forms);
      for (const row of compare.querySelectorAll<HTMLElement>('tr[data-meaning]'))
        row.classList.toggle('on', row.dataset.meaning === v.word);
    }
    drawHistory(t);

    const url = `?family=${f.seed}&lang=${node.id}&ago=${Math.round(SPAN - t)}`;
    if (url !== lastUrl) {
      lastUrl = url;
      scheduleUrl(url);
    }
    if (!v.playing) playBtn.textContent = node === f.root && t < 40 ? 'Play' : 'Play to here';
    root.dataset.ready = 'true';
  }

  let urlTimer = 0;
  function scheduleUrl(url: string): void {
    clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      try {
        window.history.replaceState(null, '', url);
      } catch {
        // Some embeds refuse history changes.
      }
    }, 300);
  }

  function drawInterlinear(forms: Map<string, Word>): void {
    const node = v.node;
    let html = `<h3 class="fable-title">${esc(FABLE_TITLE)}</h3>`;
    v.fam.sentences.forEach((s, si) => {
      html += '<div class="sentence"><div class="words">';
      s.tokens.forEach((tk, i) => {
        let form = roman(node, forms.get(tk.key));
        if (si === 0 || /[.!?:”]$/.test(v.fam.sentences[si - 1]?.tokens.at(-1)?.after ?? '')) {
          if (i === 0) form = form.charAt(0).toUpperCase() + form.slice(1);
        }
        const m = headMeaning(tk.parts);
        const inner = `<span class="form">${esc(tk.before + form + tk.after)}</span><span class="gl">${glossHtml(tk.gloss)}</span>`;
        // Grammar words have no meaning to trace, so only content words are buttons.
        if (m) {
          const pressed = m === v.word ? 'true' : 'false';
          html += `<button type="button" class="word" data-meaning="${m}" aria-pressed="${pressed}">${inner}</button>`;
        } else {
          html += `<span class="word plain">${inner}</span>`;
        }
      });
      html += `</div><p class="translation">${esc(s.english)}</p></div>`;
    });
    interlinear.innerHTML = html;
  }

  function drawEtymology(script: Script, t: number): void {
    const m = v.word;
    const line = lineage(v.node);
    const protoForm = v.fam.root.snapshots[0].get(m) ?? [];
    const here = eraName(v.fam, v.node, t);
    const span = v.node === v.fam.root && t < 40 ? `as Proto-${v.fam.root.name} said it` : `traced from Proto-${v.fam.root.name} to ${here}`;
    let html = `<h3>‘${esc(ENGLISH[m])}’ <span class="sub">${esc(span)}</span></h3>`;
    html += '<ol class="chain">';
    html += `<li><span class="date">3,000 years ago</span><span class="step"><i class="proto">*${esc(ipa(protoForm))}</i></span></li>`;
    let prev = protoForm.join('');
    for (const n of line) {
      n.changes.forEach((c, k) => {
        if (c.t > t) return;
        const w = n.snapshots[k + 1].get(m) ?? [];
        const now = w.join('');
        if (now === prev) return;
        prev = now;
        html += `<li><span class="date">${esc(yearsAgo(c.t))}</span><span class="step"><i>${esc(ipa(w))}</i> <span class="why">${esc(c.text)}</span></span></li>`;
      });
    }
    html += '</ol>';
    const current = formsAt(v.node, t).forms.get(m) ?? [];
    html += `<p class="now"><span class="label">Now</span> <i class="big">${esc(roman(v.node, current))}</i> <span class="ipa">/${esc(ipa(current))}/</span> <svg class="mini" data-mini></svg></p>`;
    // The same word in every daughter.
    html += '<div class="kin">';
    for (const l of [...v.fam.leaves].sort((a, b) => a.x - b.x)) {
      const w = l.snapshots[l.snapshots.length - 1].get(m) ?? [];
      html += `<div class="kin-cell" style="--c:${l.color}"><svg class="mini" data-kin="${l.id}"></svg><i>${esc(roman(l, w))}</i><span>${esc(l.name)}${l.extinct ? ' †' : ''}</span></div>`;
    }
    html += '</div>';
    etymology.innerHTML = html;
    const mini = etymology.querySelector<SVGSVGElement>('[data-mini]')!;
    drawWord(mini, script, current, 22);
    for (const svg of etymology.querySelectorAll<SVGSVGElement>('[data-kin]')) {
      const l = v.fam.nodes[Number(svg.dataset.kin)];
      const s = scriptAt(v.fam, l, l.t1).script;
      drawWord(svg, s, l.snapshots[l.snapshots.length - 1].get(m) ?? [], 20);
    }
  }

  function drawWord(svg: SVGSVGElement, s: Script, w: Word, size: number): void {
    const signs = spell(s, w);
    const adv = signWidth(s.state, size);
    const width = signs.reduce((n, sg) => n + (sg.twice ? 2 : 1) * (adv + size * 0.16), 0) + size * 0.3;
    drawWriting(svg, s, new Map(), [{ signs }], Math.max(width, size), size, 'plain');
    svg.setAttribute('width', String(Math.ceil(Math.max(width, size))));
  }

  function drawAlphabet(script: Script, forms: Map<string, Word>): void {
    const inventory = new Set<string>();
    for (const w of forms.values()) for (const p of w) inventory.add(p);
    const sounds = [...inventory].sort(soundOrder);
    const proto = v.fam.root.scriptStart;
    alphabetSub.textContent = TYPE_TEXT[script.vowelsWritten ? script.type : 'abjad'];
    alphabet.replaceChildren();
    const written = sounds.filter((p) => {
      if (script.type === 'abjad' && !script.vowelsWritten) return !isVowel(p);
      if (script.type === 'abugida') return !isVowel(p) || p === script.inherent || p[0] === script.inherent;
      return true;
    });
    const seen = new Set<string>();
    for (const p of written) {
      const v0 = vowel(p);
      if (v0 && (v0.long || v0.nasal) && inventory.has(p[0])) continue;
      const sign = spell(script, [p])[0];
      if (!sign) continue;
      const key = signKey(sign) + (sign.twice ? '2' : '');
      if (seen.has(key)) continue;
      seen.add(key);
      const cell = document.createElement('div');
      cell.className = 'letter';
      const svg = document.createElementNS(SVG, 'svg');
      svg.classList.add('glyph');
      cell.append(svg);
      drawWriting(svg, script, new Map(), [{ signs: [sign] }], signWidth(script.state, 30) + 4, 30, 'plain');
      const label = document.createElement('span');
      label.className = 'snd';
      label.textContent = script.type === 'abugida' && !isVowel(p) ? `${p}${script.inherent}` : p;
      cell.append(label);
      const was = proto.letters.get(script.derived.get(p)?.base ?? p);
      if (was && v.node !== v.fam.root) {
        const ps = document.createElementNS(SVG, 'svg');
        ps.classList.add('was');
        cell.append(ps);
        drawWriting(ps, proto, new Map(), [{ signs: [{ letter: script.derived.get(p)?.base ?? p, marks: [] }] }], signWidth(proto.state, 14) + 2, 14, 'plain');
      }
      alphabet.append(cell);
    }
    if (script.type === 'abugida') {
      const marks = document.createElement('p');
      marks.className = 'note';
      marks.textContent = `Each consonant letter is read with ${script.inherent} after it; a mark above, below, or beside it changes the vowel, and a mark below with no vowel silences it.`;
      alphabet.append(marks);
    }
  }

  function drawHistory(t: number): void {
    const line = lineage(v.node);
    const items: { t: number; html: string; node: Lang }[] = [];
    for (const n of line) {
      for (const c of n.changes) {
        const ex = c.example ? ` <span class="ex">*${esc(ipa(c.example.before))} &gt; ${esc(ipa(c.example.after))} ‘${esc(ENGLISH[c.example.meaning])}’</span>` : '';
        items.push({ t: c.t, node: n, html: `${esc(c.text)}${ex}` });
      }
      for (const op of n.ops) items.push({ t: op.t, node: n, html: `<span class="script-change">${esc(OP_TEXT[op.kind])}</span>` });
      if (n.children.length) {
        const kids = n.children.map((c) => c.name).join(', ');
        items.push({ t: n.t1, node: n, html: `<span class="split-note">splits into ${esc(kids)}</span>` });
      }
    }
    items.sort((a, b) => a.t - b.t);
    const key = `${v.fam.seed}:${v.node.id}:${items.filter((i) => i.t <= t).length}`;
    if (history.dataset.key === key) return;
    history.dataset.key = key;
    history.innerHTML = items
      .map(
        (i) =>
          `<li class="${i.t > t ? 'future' : ''}" data-node="${i.node.id}" data-t="${i.t.toFixed(1)}"><span class="date">${esc(yearsAgo(i.t))}</span><span class="what">${i.html}</span></li>`,
      )
      .join('');
  }

  seedEl.textContent = `No. ${fam.seed}`;
  drawCompare();
  requestAnimationFrame(frame);
}

const budgets = new WeakMap<Family, number>();

/** How many letters the fable takes when every sound is written, for sizing the tablet. */
function signBudget(f: Family): number {
  let n = budgets.get(f);
  if (n === undefined) {
    n = 0;
    const forms = f.root.snapshots[0];
    for (const s of f.sentences) for (const tk of s.tokens) n += (forms.get(tk.key)?.length ?? 0) + 1.2;
    budgets.set(f, n);
  }
  return n;
}

const TYPE_TEXT: Record<string, string> = {
  alphabet: 'an alphabet: a letter for every sound',
  abjad: 'an abjad: only consonants are written',
  abugida: 'an abugida: each letter is a consonant with its vowel',
};

const CONSONANT_ORDER = Object.keys(CONSONANTS);
const VOWEL_ORDER = ['i', 'y', 'ɨ', 'u', 'e', 'ø', 'ə', 'o', 'ɛ', 'ɔ', 'a'];

function soundOrder(a: string, b: string): number {
  const va = isVowel(a);
  const vb = isVowel(b);
  if (va !== vb) return va ? 1 : -1;
  if (va) return VOWEL_ORDER.indexOf(a[0]) - VOWEL_ORDER.indexOf(b[0]) || a.length - b.length;
  return CONSONANT_ORDER.indexOf(a) - CONSONANT_ORDER.indexOf(b);
}

function describeScript(s: Script): string {
  const st = s.state;
  const parts: string[] = [];
  if (st.bous > 0.5) parts.push('Lines turn back and forth, and the letters face the way each line runs');
  else parts.push(st.mirror < 0 ? 'Written right to left' : 'Written left to right');
  if (st.headline > 0.5) parts.push('a bar hangs each word from the line');
  if (st.spaces < 0.5) parts.push('two points part the words');
  return parts.join('; ') + '.';
}
