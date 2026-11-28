// The tracing floor: tools, snapping, commissions, and raising the window.

import { COMMISSIONS, stepPrim, type Commission, type Step } from './_commissions';
import { Floor, fitView, toScreen, toWorld, type Drawn, type Preview, type Tool, type View } from './_floor';
import {
  arrangement,
  circle,
  constructionPoints,
  dist,
  line,
  paramInside,
  pieceDist,
  pieceMid,
  samePrim,
  type Piece,
  type Prim,
  type Span,
  type Vec,
} from './_geom';
import { WindowView } from './_window';

interface Mark {
  prim: number;
  t0: number;
  t1: number;
}

type Action = { kind: 'prim'; prim: Prim; prick: Vec | null; free: Vec[] } | { kind: 'mark'; mark: Mark; on: boolean };

interface FloorState {
  drawn: Prim[];
  pricks: Vec[];
  free: Vec[];
  marks: Mark[];
  history: Action[];
}

const STORE = 'tracing-floor:v1';

interface Saved {
  done: string[];
  floors: Record<string, { drawn: number[][]; pricks: number[][]; free: number[][]; marks: number[][] }>;
}

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (Array.isArray(s.done) && s.floors) return s;
    }
  } catch {
    /* storage may be off */
  }
  return { done: [], floors: {} };
}

const enc = (p: Prim): number[] => (p.kind === 'line' ? [0, p.a.x, p.a.y, p.b.x, p.b.y] : [1, p.c.x, p.c.y, p.r]);
const dec = (n: number[]): Prim =>
  n[0] === 0 ? line({ x: n[1], y: n[2] }, { x: n[3], y: n[4] }) : circle({ x: n[1], y: n[2] }, n[3]);

const emptyFloor = (): FloorState => ({ drawn: [], pricks: [], free: [], marks: [], history: [] });

export function start(): void {
  const root = document.querySelector<HTMLElement>('.tracing');
  if (!root) return;
  const q = <T extends Element>(sel: string): T => {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`Missing ${sel}`);
    return el;
  };
  const canvas = q<HTMLCanvasElement>('.floor');
  const card = q<HTMLElement>('.card');
  const tools = q<HTMLElement>('.tools');
  const briefTitle = q<HTMLElement>('.brief .title');
  const briefNumeral = q<HTMLElement>('.brief .numeral');
  const briefText = q<HTMLElement>('.brief .text');
  const tally = q<HTMLElement>('.tally');
  const hintText = q<HTMLElement>('.hint-text');
  const askBtn = q<HTMLButtonElement>('.ask');
  const raiseBtn = q<HTMLButtonElement>('.raise');
  const undoBtn = q<HTMLButtonElement>('.undo');
  const brushBtn = q<HTMLButtonElement>('.brush');
  const chiselBtn = q<HTMLButtonElement>('.tools [data-tool="chisel"]');
  const raised = q<HTMLElement>('.raised');
  const commissionBtns = [...root.querySelectorAll<HTMLButtonElement>('.commissions button')];

  const floor = new Floor(canvas);
  const windowView = new WindowView(q<HTMLCanvasElement>('.window'));
  const saved = loadSaved();
  const params = new URLSearchParams(location.search);

  let ci = 0;
  let com: Commission = COMMISSIONS[0];
  const floors = new Map<string, FloorState>();
  let tool: Tool = 'compass';
  let view: View = fitView(com.view, 1, 1, { l: 0, r: 0, t: 0, b: 0 });
  let points: Vec[] = [];
  let spans: Span[] = [];
  let hint: Step | null = null;
  let snap: Vec | null = null;
  let hover: Piece | null = null;
  let preview: Preview = null;
  let span: { a: Vec; b: Vec } | null = null;
  let drag: { id: number; tool: Tool; a: Vec; b: Vec } | null = null;
  let fade = 0;
  let pointerXY: { x: number; y: number } | null = null;

  const restore = (c: Commission): FloorState => {
    const s = saved.floors[c.id];
    if (!s) return emptyFloor();
    try {
      const v2 = (n: number[]): Vec => ({ x: n[0], y: n[1] });
      return {
        drawn: s.drawn.map(dec),
        pricks: s.pricks.map(v2),
        free: s.free.map(v2),
        marks: s.marks.map((m) => ({ prim: m[0], t0: m[1], t1: m[2] })),
        history: [],
      };
    } catch {
      return emptyFloor();
    }
  };
  const state = (): FloorState => {
    let s = floors.get(com.id);
    if (!s) {
      s = restore(com);
      floors.set(com.id, s);
    }
    return s;
  };
  const persist = (): void => {
    const s = state();
    saved.floors[com.id] = {
      drawn: s.drawn.map(enc),
      pricks: s.pricks.map((p) => [p.x, p.y]),
      free: s.free.map((p) => [p.x, p.y]),
      marks: s.marks.map((m) => [m.prim, m.t0, m.t1]),
    };
    try {
      localStorage.setItem(STORE, JSON.stringify(saved));
    } catch {
      /* storage may be off */
    }
  };

  const allPrims = (): Prim[] => [...com.prims, ...state().drawn];
  const covered = (): boolean[] => {
    const prims = allPrims();
    return com.targets.map((t) => prims.some((p) => samePrim(p, t.prim)));
  };
  const complete = (): boolean => {
    if (com.glazing === 'open') return state().marks.length > 0;
    return covered().every(Boolean);
  };

  /** Stone from the marks on the open floor. */
  const chiselled = (): Piece[] => {
    const s = state();
    if (!s.marks.length) return [];
    const prims = allPrims();
    return spans
      .filter((sp) => {
        const mid = (sp.t0 + sp.t1) / 2;
        return s.marks.some((m) => m.prim === sp.prim && paramInside(prims[sp.prim], mid, m.t0, m.t1));
      })
      .map((sp) => sp.piece);
  };

  const recompute = (): void => {
    const s = state();
    points = constructionPoints([...com.points, ...s.free], allPrims(), com.bounds);
    spans = com.glazing === 'open' ? arrangement(allPrims(), com.bounds) : [];
  };

  const layout = (): void => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    floor.resize(w, h);
    floor.ensurePlaster(ci + 3);
    const narrow = w < 760;
    const toolsH = tools.offsetHeight;
    const pad = narrow
      ? { l: 16, r: 16, t: card.offsetHeight + 14, b: toolsH + 14 }
      : { l: card.offsetLeft + card.offsetWidth + 30, r: 40, t: 30, b: toolsH + 40 };
    view = fitView(com.view, w, h, pad);
  };

  const render = (): void => {
    const s = state();
    const cov = covered();
    const drawn: Drawn[] = [
      ...com.prims.map((prim) => ({ prim, age: 0, given: true })),
      ...s.drawn.map((prim, i) => ({ prim, age: s.drawn.length - 1 - i, given: false })),
    ];
    const cut = [...com.stone, ...com.targets.filter((_, i) => cov[i]).flatMap((t) => t.pieces)];
    const guides = com.targets.filter((_, i) => !cov[i]).flatMap((t) => t.pieces);
    const hintPrim = hint ? stepPrim(hint, nearestOrSelf) : null;
    const hintPoints = hint ? stepPoints(hint) : [];
    floor.draw({
      view,
      drawn,
      points,
      marks: [...com.points, ...s.free],
      pricks: s.pricks,
      guides,
      cut,
      chiselled: chiselled(),
      hover,
      snap,
      preview,
      hint: hintPrim,
      hintPoints,
      fade,
    });
  };

  const nearestOrSelf = (p: Vec): Vec => {
    let best = p;
    let bd = 1e-3;
    for (const q2 of points) {
      const d = dist(p, q2);
      if (d < bd) {
        bd = d;
        best = q2;
      }
    }
    return best;
  };
  const stepPoints = (st: Step): Vec[] =>
    st.tool === 'rule' ? [st.a, st.b] : st.tool === 'compass' ? [st.c, st.through] : [st.from, st.to, st.c];

  const updateCard = (): void => {
    const s = state();
    briefNumeral.textContent = `${com.numeral}.`;
    briefTitle.textContent = com.title;
    briefText.replaceChildren(
      ...com.brief.map((t) => {
        const p = document.createElement('p');
        p.textContent = t;
        return p;
      }),
    );
    const strokes = s.drawn.length;
    const strokeWord = `${strokes} ${strokes === 1 ? 'stroke' : 'strokes'}`;
    if (com.glazing === 'open') {
      tally.innerHTML = '';
      tally.append(
        `${strokeWord} on the floor, `,
        strong(`${s.marks.length}`),
        ` ${s.marks.length === 1 ? 'stretch' : 'stretches'} marked for stone.`,
      );
    } else {
      const cov = covered();
      const n = cov.filter(Boolean).length;
      tally.innerHTML = '';
      if (n === cov.length) {
        tally.append(strong('Every line is struck.'), ` ${strokeWord}; the master’s way takes ${com.solution.length}.`);
      } else {
        tally.append(strong(`${n} of ${cov.length}`), ` of the master’s lines struck, in ${strokeWord}.`);
      }
    }
    raiseBtn.disabled = !complete();
    askBtn.hidden = com.glazing === 'open';
    chiselBtn.hidden = com.glazing !== 'open';
    if (com.glazing !== 'open' && tool === 'chisel') setTool('compass');
    root.dataset.commission = com.id;
    commissionBtns.forEach((b, i) => {
      b.setAttribute('aria-current', i === ci ? 'true' : 'false');
      b.classList.toggle('done', saved.done.includes(COMMISSIONS[i].id));
    });
    undoBtn.disabled = s.drawn.length === 0 && s.marks.length === 0;
  };

  const strong = (t: string): HTMLElement => {
    const el = document.createElement('strong');
    el.textContent = t;
    return el;
  };

  const setHint = (h: Step | null, text = ''): void => {
    hint = h;
    hintText.hidden = !text;
    hintText.textContent = text;
  };

  const changed = (): void => {
    recompute();
    if (complete() && com.glazing !== 'open' && !saved.done.includes(com.id)) saved.done.push(com.id);
    persist();
    if (hint && allPrims().some((p) => samePrim(p, stepPrim(hint as Step, nearestOrSelf)))) setHint(null);
    updateCard();
    render();
  };

  const setTool = (t: Tool): void => {
    tool = t;
    span = null;
    drag = null;
    preview = null;
    root.dataset.tool = t;
    tools.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false');
    });
    render();
  };

  const go = (i: number): void => {
    ci = Math.max(0, Math.min(COMMISSIONS.length - 1, i));
    com = COMMISSIONS[ci];
    setHint(null);
    span = null;
    drag = null;
    preview = null;
    hover = null;
    snap = null;
    recompute();
    updateCard();
    layout();
    render();
    if (params.has('debug')) history.replaceState(null, '', `?debug&c=${com.id}`);
  };

  // Pointer handling.

  const snapRadius = (e: PointerEvent): number => (e.pointerType === 'touch' ? 26 : 16);
  const findSnap = (x: number, y: number, r: number): Vec | null => {
    let best: Vec | null = null;
    let bd = r;
    for (const p of points) {
      const s = toScreen(view, p);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };
  const at = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pick = (e: PointerEvent): Vec => {
    const { x, y } = at(e);
    return findSnap(x, y, snapRadius(e)) ?? toWorld(view, x, y);
  };
  const isFree = (p: Vec): boolean => !points.includes(p);

  const nearestSpan = (x: number, y: number, r: number): Span | null => {
    const w = toWorld(view, x, y);
    let best: Span | null = null;
    let bd = r / view.s;
    for (const sp of spans) {
      const d = pieceDist(w, sp.piece);
      if (d < bd) {
        bd = d;
        best = sp;
      }
    }
    return best;
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (drag || root.dataset.mode !== 'floor') return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't be captured */
    }
    const { x, y } = at(e);
    pointerXY = { x, y };
    if (tool === 'chisel') {
      const sp = nearestSpan(x, y, e.pointerType === 'touch' ? 18 : 10);
      if (sp) toggleMark(sp);
      return;
    }
    if (tool === 'dividers' && span) {
      // Second stage: set the dividers down at a centre.
      const c = pick(e);
      drag = { id: e.pointerId, tool, a: c, b: c };
      preview = { tool: 'dividers', a: span.a, b: span.b, c };
      snap = isFree(c) ? null : c;
      render();
      return;
    }
    const a = pick(e);
    drag = { id: e.pointerId, tool, a, b: a };
    snap = isFree(a) ? null : a;
    preview = previewFor(drag);
    render();
  });

  canvas.addEventListener('pointermove', (e) => {
    const { x, y } = at(e);
    pointerXY = { x, y };
    if (root.dataset.mode !== 'floor') return;
    if (!drag) {
      if (tool === 'chisel') {
        const sp = nearestSpan(x, y, 10);
        const h = sp ? sp.piece : null;
        if (h !== hover) {
          hover = h;
          render();
        }
        return;
      }
      const s2 = findSnap(x, y, snapRadius(e));
      if (s2 !== snap || (tool === 'dividers' && span)) {
        snap = s2;
        if (tool === 'dividers' && span) {
          const c = s2 ?? toWorld(view, x, y);
          preview = { tool: 'dividers', a: span.a, b: span.b, c };
        }
        render();
      }
      return;
    }
    if (e.pointerId !== drag.id) return;
    const b = pick(e);
    if (drag.tool === 'dividers' && span) {
      drag.a = drag.b = b;
      preview = { tool: 'dividers', a: span.a, b: span.b, c: b };
    } else {
      drag.b = b;
      preview = previewFor(drag);
    }
    snap = isFree(b) ? null : b;
    render();
  });

  const finish = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.tool === 'dividers' && span) {
      const r = dist(span.a, span.b);
      commit(circle(d.a, r), d.a, [span.a, span.b, d.a]);
      span = null;
      preview = null;
      render();
      return;
    }
    const len = dist(d.a, d.b) * view.s;
    if (len < 6) {
      preview = null;
      render();
      return;
    }
    if (d.tool === 'rule') commit(line(d.a, d.b), null, [d.a, d.b]);
    else if (d.tool === 'compass') commit(circle(d.a, dist(d.a, d.b)), d.a, [d.a, d.b]);
    else if (d.tool === 'dividers') {
      span = { a: d.a, b: d.b };
      const p = pointerXY ?? toScreen(view, d.b);
      preview = { tool: 'dividers', a: d.a, b: d.b, c: toWorld(view, p.x, p.y) };
      render();
      return;
    }
    preview = null;
    render();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', (e) => {
    if (drag && e.pointerId === drag.id) {
      drag = null;
      preview = null;
      render();
    }
  });
  canvas.addEventListener('pointerleave', () => {
    if (!drag && hover) {
      hover = null;
      render();
    }
  });

  const previewFor = (d: { tool: Tool; a: Vec; b: Vec }): Preview => {
    if (d.tool === 'rule') return { tool: 'rule', a: d.a, b: d.b };
    if (d.tool === 'compass') return { tool: 'compass', c: d.a, p: d.b };
    if (d.tool === 'dividers') return { tool: 'dividers', a: d.a, b: d.b };
    return null;
  };

  const commit = (prim: Prim, prick: Vec | null, used: Vec[]): void => {
    const s = state();
    if (prim.kind === 'circle' && prim.r * view.s < 3) return;
    if (allPrims().some((p) => samePrim(p, prim))) return;
    const free = used.filter((p) => isFree(p) && !s.free.some((f) => dist(f, p) < 1e-9));
    s.free.push(...free);
    s.drawn.push(prim);
    const hole = prick && !s.pricks.some((p) => dist(p, prick) < 1e-9) ? prick : null;
    if (hole) s.pricks.push(hole);
    s.history.push({ kind: 'prim', prim, prick: hole, free });
    changed();
  };

  const toggleMark = (sp: Span): void => {
    const s = state();
    const mid = (sp.t0 + sp.t1) / 2;
    const prims = allPrims();
    const existing = s.marks.findIndex((m) => m.prim === sp.prim && paramInside(prims[sp.prim], mid, m.t0, m.t1));
    if (existing >= 0) {
      const [m] = s.marks.splice(existing, 1);
      s.history.push({ kind: 'mark', mark: m, on: false });
    } else {
      const m = { prim: sp.prim, t0: sp.t0, t1: sp.t1 };
      s.marks.push(m);
      s.history.push({ kind: 'mark', mark: m, on: true });
    }
    changed();
  };

  const undo = (): void => {
    const s = state();
    const a = s.history.pop();
    if (!a) {
      // After a reload there is no history: take back the newest stroke.
      const prim = s.drawn.pop();
      if (!prim) return;
      const idx = com.prims.length + s.drawn.length;
      s.marks = s.marks.filter((m) => m.prim !== idx);
      changed();
      return;
    }
    if (a.kind === 'mark') {
      if (a.on) s.marks = s.marks.filter((m) => m !== a.mark);
      else s.marks.push(a.mark);
    } else {
      const i = s.drawn.lastIndexOf(a.prim);
      if (i >= 0) {
        const idx = com.prims.length + i;
        s.drawn.splice(i, 1);
        s.marks = s.marks.filter((m) => m.prim !== idx);
      }
      if (a.prick) s.pricks = s.pricks.filter((p) => p !== a.prick);
      s.free = s.free.filter((p) => !a.free.includes(p));
    }
    span = null;
    preview = null;
    changed();
  };

  const brush = (): void => {
    floors.set(com.id, emptyFloor());
    span = null;
    preview = null;
    changed();
  };

  const ask = (): void => {
    const prims = allPrims();
    const next = com.solution.find((st) => !prims.some((p) => samePrim(p, stepPrim(st, nearestOrSelf))));
    if (!next) {
      setHint(null, 'Nothing more to strike. Raise the window.');
      render();
      return;
    }
    const words =
      next.tool === 'rule'
        ? 'Lay the rule through the two ringed points.'
        : next.tool === 'compass'
          ? 'Set the compass point on the first ringed point and open the legs to the second.'
          : 'Take the span between the first two ringed points with the dividers, then set them down on the third.';
    setHint(next, words);
    render();
  };

  // Raising the window.

  const stoneNow = (): Piece[] =>
    com.glazing === 'open'
      ? [...com.stone, ...chiselled()]
      : [...com.stone, ...com.targets.flatMap((t) => t.pieces)];

  const raise = (): void => {
    const s = state();
    const ok = windowView.build(stoneNow(), com.frame, com.glazing);
    q<HTMLElement>('.plaque-kicker').textContent = `Commission ${com.numeral}`;
    q<HTMLElement>('.plaque-title').textContent = com.window;
    const strokes = s.drawn.length;
    q<HTMLElement>('.plaque-note').textContent = !ok
      ? 'Nothing closed off by stone, so there is nowhere to put glass. Mark a ring of stone all the way round.'
      : com.glazing === 'open'
        ? `Set out in ${strokes} ${strokes === 1 ? 'stroke' : 'strokes'} of the compasses and rule.`
        : `Set out in ${strokes} ${strokes === 1 ? 'stroke' : 'strokes'}; the master’s way takes ${com.solution.length}.`;
    q<HTMLButtonElement>('.next').hidden = ci >= COMMISSIONS.length - 1;
    root.dataset.mode = 'raised';
    raised.hidden = false;
    windowView.show(params.has('still'));
  };

  const lower = (): void => {
    windowView.hide();
    raised.hidden = true;
    root.dataset.mode = 'floor';
    fade = 0;
    render();
  };

  // Wiring.

  tools.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
    b.addEventListener('click', () => setTool(b.dataset.tool as Tool));
  });
  undoBtn.addEventListener('click', undo);
  brushBtn.addEventListener('click', brush);
  askBtn.addEventListener('click', ask);
  raiseBtn.addEventListener('click', raise);
  commissionBtns.forEach((b, i) => b.addEventListener('click', () => go(i)));
  q<HTMLButtonElement>('.back').addEventListener('click', lower);
  q<HTMLButtonElement>('.next').addEventListener('click', () => {
    lower();
    go(ci + 1);
  });
  root.querySelectorAll<HTMLButtonElement>('.side button').forEach((b) => {
    b.addEventListener('click', () => {
      root.querySelectorAll<HTMLButtonElement>('.side button').forEach((o) => {
        o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
      });
      windowView.setSide(b.dataset.side === 'outside' ? 'outside' : 'inside');
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (root.dataset.mode === 'floor') undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (root.dataset.mode === 'raised') lower();
      else {
        span = null;
        drag = null;
        preview = null;
        render();
      }
      return;
    }
    if (root.dataset.mode !== 'floor') return;
    const k = e.key.toLowerCase();
    if (k === 'c') setTool('compass');
    else if (k === 'd') setTool('dividers');
    else if (k === 'r') setTool('rule');
    else if (k === 's' && com.glazing === 'open') setTool('chisel');
  });

  let resizeQueued = false;
  new ResizeObserver(() => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      layout();
      render();
      windowView.resize();
    });
  }).observe(root);

  const startAt = COMMISSIONS.findIndex((c) => c.id === params.get('c'));
  go(startAt >= 0 ? startAt : 0);

  if (params.has('debug')) {
    (window as unknown as { tracing: unknown }).tracing = {
      go: (id: string) => go(COMMISSIONS.findIndex((c) => c.id === id)),
      /** Strike the master's own construction for the current commission, n steps of it. */
      solve: (n = Infinity) => {
        const s = state();
        for (const st of com.solution.slice(0, n)) {
          recompute();
          const p = stepPrim(st, nearestOrSelf);
          if (!allPrims().some((o) => samePrim(o, p))) {
            s.drawn.push(p);
            if (p.kind === 'circle') s.pricks.push(p.c);
          }
        }
        changed();
        return covered();
      },
      covered,
      complete,
      raise,
      lower,
      ask,
      undo,
      setTool,
      /** Screen position of a world point, for synthetic pointer tests. */
      screen: (x: number, y: number) => toScreen(view, { x, y }),
      /** Mark every span within r world units of a point (open floor). */
      chisel: (x: number, y: number) => {
        const s2 = toScreen(view, { x, y });
        const sp = nearestSpan(s2.x, s2.y, 12);
        if (sp) toggleMark(sp);
        return !!sp;
      },
      spans: () => spans.map((sp) => pieceMid(sp.piece)),
      strike: (p: Prim) => commit(p, p.kind === 'circle' ? p.c : null, []),
      state: () => ({ commission: com.id, strokes: state().drawn.length, points: points.length, tool }),
      side: (s: 'inside' | 'outside') => windowView.setSide(s),
    };
  }
}
