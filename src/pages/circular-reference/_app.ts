// The workbook application: sheets, selection, the formula bar, the calculation loop, and input.

import { BOOK, type BookContext, type Room } from './_book';
import { Engine, areasRead, validate } from './_compile';
import { FormulaError, cellName, colOf, index, parseCellName, parseFormula, rowOf } from './_formula';
import { Grid } from './_grid';
import { KEYS, shortNumber, type Sheet } from './_sheet';

interface Page {
  sheet: Sheet;
  engine: Engine;
  ticks: number;
  acc: number;
  seconds: number;
  undo: (() => void)[];
}

const KEY_MAP: Record<string, string> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ' ': 'space',
  a: 'a',
  d: 'd',
  w: 'w',
  s: 's',
  r: 'r',
};

export function start(root: HTMLElement) {
  const need = <T extends HTMLElement>(selector: string) => {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`Missing ${selector}`);
    return el;
  };
  const canvas = need<HTMLCanvasElement>('[data-grid]');
  const work = need('[data-work]');
  const nameBox = need<HTMLInputElement>('[data-name]');
  const entry = need<HTMLInputElement>('[data-entry]');
  const complaint = need('[data-complaint]');
  const tabs = need('[data-tabs]');
  const status = need('[data-status]');
  const listing = need('[data-listing]');
  const listingBody = need('[data-listing-body]');
  const listingHead = need('[data-listing-head]');
  const pad = need('[data-pad]');
  const zoomLabel = need('[data-zoom]');
  const pauseButton = need<HTMLButtonElement>('[data-act="pause"]');
  const face = (name: string) => getComputedStyle(root).getPropertyValue(name).trim() || 'sans-serif';
  const faces = { label: face('--font-circular'), typed: face('--font-rubbings-type') };
  const grid = new Grid(canvas, faces);
  const dpr = () => Math.min(3, Math.max(1, Math.round((window.devicePixelRatio || 1) * 4) / 4));
  const size = () => {
    const box = work.getBoundingClientRect();
    return { w: Math.round(box.width), h: Math.round(box.height) };
  };
  grid.resize(size().w, size().h, dpr());

  const room: Room = { w: size().w - 34, h: size().h - 18 };
  const pulses: number[] = [];
  const context: BookContext = {
    room,
    pulse: (cell) => pulses.push(cell),
    rebuild: (sheet) => {
      if (sheet === page.sheet) void rebuild();
    },
    zoomTo: (cellPx, r, c) => easeZoom(cellPx, r, c),
  };

  const makePage = (i: number): Page => {
    const sheet = BOOK[i](context);
    sheet.begin?.();
    return { sheet, engine: new Engine(sheet), ticks: 0, acc: 0, seconds: 0, undo: [] };
  };

  const pages: (Page | null)[] = BOOK.map(() => null);
  let active = 0;
  pages[0] = makePage(0);
  let page = pages[0];
  let running = true;
  let dirty = true;
  let editing = false;
  let editOriginal = '';
  let stepOnce = false;
  const held = new Set<string>();
  const releasing = new Set<string>();

  async function rebuild() {
    await page.engine.build();
    dirty = true;
    updateFormulaBar();
    updateListing();
  }

  function rateOf(sheet: Sheet) {
    const named = sheet.names.get('rate');
    if (named) {
      const v = sheet.values[index(named.r1, named.c1)];
      if (Number.isFinite(v) && v > 0) return Math.min(240, v);
    }
    return sheet.rate;
  }

  function select(r: number, c: number, r2 = r, c2 = c) {
    const merge = page.sheet.mergeAt.get(index(r, c));
    const hr = merge ? merge.r1 : r;
    const hc = merge ? merge.c1 : c;
    grid.selection = {
      r: hr,
      c: hc,
      r1: Math.min(hr, r2),
      c1: Math.min(hc, c2),
      r2: Math.max(hr, r2),
      c2: Math.max(hc, c2),
    };
    if (r === r2 && c === c2) {
      grid.selection.r1 = grid.selection.r2 = hr;
      grid.selection.c1 = grid.selection.c2 = hc;
    }
    leaveEdit();
    updateFormulaBar();
    updateListing();
    dirty = true;
  }

  function updateFormulaBar() {
    const { r, c } = grid.selection;
    const cell = index(r, c);
    nameBox.value = cellName(r, c);
    if (!editing) entry.value = page.sheet.source(cell);
    grid.precedents = page.sheet.formulas.has(cell) ? areasRead(page.sheet, cell).slice(0, 12) : [];
  }

  function updateListing() {
    if (listing.hidden) return;
    const { r, c } = grid.selection;
    const cell = index(r, c);
    const list = page.engine.listing(cell);
    if (!list) {
      listingHead.textContent = `${cellName(r, c)} holds no formula`;
      listingBody.textContent = 'Select a cell with a formula to read the WebAssembly it compiled to.';
      return;
    }
    const shared = list.cells === 1 ? 'this one cell' : `${list.cells.toLocaleString('en-US')} cells`;
    listingHead.textContent = `Function ${list.id}, ${list.bytes} bytes, run for ${shared}`;
    listingBody.textContent = list.text;
  }

  function showComplaint(message: string) {
    complaint.textContent = message;
    complaint.hidden = !message;
  }

  function enterEdit(seed?: string) {
    editing = true;
    editOriginal = page.sheet.source(index(grid.selection.r, grid.selection.c));
    if (seed !== undefined) entry.value = seed;
    entry.focus();
    if (seed === undefined) entry.select();
    else entry.setSelectionRange(seed.length, seed.length);
    showComplaint('');
  }

  function leaveEdit() {
    editing = false;
    showComplaint('');
  }

  function commit(single: boolean) {
    const { r, c } = grid.selection;
    const cell = index(r, c);
    const { sheet } = page;
    const typed = entry.value;
    if (typed === editOriginal) {
      leaveEdit();
      canvas.focus();
      return;
    }
    const fill = sheet.fillAt(r, c);
    const before = sheet.source(cell);
    try {
      if (typed.trim().startsWith('=')) validate(parseFormula(typed, r, c), sheet);
      const undoFill = fill && !single ? { fill, formula: fill.formula } : null;
      const changed = sheet.enter(cell, typed, single);
      page.undo.push(() => {
        if (undoFill) sheet.fillWith(undoFill.fill, undoFill.formula);
        else sheet.enter(cell, before, true);
      });
      if (page.undo.length > 60) page.undo.shift();
      leaveEdit();
      canvas.focus();
      if (changed) void rebuild();
      else {
        updateFormulaBar();
        dirty = true;
      }
    } catch (err) {
      if (err instanceof FormulaError) showComplaint(err.message);
      else throw err;
    }
  }

  function undo() {
    const last = page.undo.pop();
    if (!last) return;
    last();
    void rebuild();
  }

  function moveSelection(dr: number, dc: number) {
    const { r, c } = grid.selection;
    const merge = page.sheet.mergeAt.get(index(r, c));
    const nr = Math.max(0, Math.min(255, (dr > 0 && merge ? merge.r2 : r) + dr));
    const nc = Math.max(0, Math.min(255, (dc > 0 && merge ? merge.c2 : c) + dc));
    select(nr, nc);
    grid.reveal(nr, nc);
  }

  function setTabs() {
    tabs.replaceChildren();
    BOOK.forEach((_, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = TAB_NAMES[i];
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(i === active));
      button.addEventListener('click', () => void openSheet(i));
      tabs.append(button);
    });
  }

  async function openSheet(i: number, fresh = false) {
    if (fresh) pages[i] = null;
    leaveEdit();
    for (const key of held) page.engine.key(KEYS.indexOf(key), false);
    held.clear();
    releasing.clear();
    let p = pages[i];
    const first = !p?.engine.ready;
    if (!p) {
      p = makePage(i);
      pages[i] = p;
    }
    active = i;
    page = p;
    grid.show(p.sheet);
    const lead = pickLead(p.sheet);
    grid.selection = { r: lead.r, c: lead.c, r1: lead.r, c1: lead.c, r2: lead.r, c2: lead.c };
    pad.hidden = !p.sheet.pad || !matchMedia('(pointer: coarse)').matches;
    setTabs();
    if (first) {
      p.engine.seed(Math.floor(Math.random() * 0xffffffff));
      await p.engine.build();
      pulses.push(...p.sheet.opening);
    }
    updateFormulaBar();
    updateListing();
    updateZoom();
    dirty = true;
    canvas.focus({ preventScroll: true });
  }

  /** Where the pointer starts: inside the sheet's main block, so the first thing in the bar is the formula. */
  function pickLead(sheet: Sheet) {
    if (sheet.lead !== undefined) return { r: rowOf(sheet.lead), c: colOf(sheet.lead) };
    const b = sheet.blocks[0];
    if (b) return { r: Math.round((b.r1 + b.r2) / 2), c: Math.round((b.c1 + b.c2) / 2) };
    const first = [...sheet.formulas.keys()][0] ?? 0;
    return { r: rowOf(first), c: colOf(first) };
  }

  function updateZoom() {
    zoomLabel.textContent = `${grid.zoomPercent()}%`;
  }

  /** Eases the view toward a cell size centred on a cell; with no size, back to the sheet's 100%. */
  function easeZoom(cellPx?: number, r?: number, c?: number) {
    const from = grid.cell;
    const fromX = grid.sx;
    const fromY = grid.sy;
    const to = cellPx ? Math.round(cellPx * grid.dpr) : Math.round(page.sheet.unit * grid.dpr);
    const viewW = grid.width - grid.headW;
    const viewH = grid.height - grid.headH;
    const toX = r === undefined || c === undefined ? 0 : (c + 0.5) * to - viewW / 2;
    const toY = r === undefined || c === undefined ? 0 : (r + 0.5) * to - viewH / 2;
    const started = performance.now();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const long = reduced ? 1 : 1500;
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / long);
      const e = t * t * (3 - 2 * t);
      // The size eases in ratio, so each step looks the same, and the view tracks the same fraction of the way.
      const size = from * (to / from) ** e;
      const cell = Math.round(size);
      const k = cell / to;
      const x = fromX * (cell / from) * (1 - e) + toX * k * e + (viewW / 2) * (k - 1) * e;
      const y = fromY * (cell / from) * (1 - e) + toY * k * e + (viewH / 2) * (k - 1) * e;
      grid.place(cell, x, y);
      updateZoom();
      dirty = true;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* Input */

  let press: {
    x: number;
    y: number;
    r: number;
    c: number;
    moved: boolean;
    mode: 'none' | 'poke' | 'range' | 'pan';
    last: { r: number; c: number } | null;
    erase: boolean;
  } | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; cell: number } | null = null;

  const local = (e: PointerEvent | MouseEvent | WheelEvent) => {
    const box = canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  function poke(r: number, c: number, erase: boolean) {
    const { sheet } = page;
    const b = sheet.blockAt(r, c);
    if (!b?.poke) return;
    const { radius, value, write } = b.poke;
    const v = erase ? (b.poke.erase ?? 0) : value;
    const R = Math.ceil(radius);
    for (let dr = -R; dr <= R; dr++) {
      for (let dc = -R; dc <= R; dc++) {
        if (dr * dr + dc * dc > radius * radius + 0.5) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < b.r1 || rr > b.r2 || cc < b.c1 || cc > b.c2) continue;
        const cell = write ? write(rr, cc) : index(rr, cc);
        sheet.values[cell] = v;
        sheet.values[cell + 65536] = v;
      }
    }
    dirty = true;
  }

  function startsErasing(r: number, c: number) {
    const b = page.sheet.blockAt(r, c);
    if (b?.poke?.erase === undefined) return false;
    const target = b.poke.write ? b.poke.write(r, c) : index(r, c);
    return page.sheet.values[target] !== 0;
  }

  function pokeLine(a: { r: number; c: number }, b: { r: number; c: number }, erase: boolean) {
    const n = Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c), 1);
    for (let i = 0; i <= n; i++) {
      poke(Math.round(a.r + ((b.r - a.r) * i) / n), Math.round(a.c + ((b.c - a.c) * i) / n), erase);
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus({ preventScroll: true });
    const p = local(e);
    touches.set(e.pointerId, p);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured.
    }
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cell: grid.cell };
      press = null;
      return;
    }
    const at = grid.hit(p.x, p.y);
    if (!at) {
      press = null;
      return;
    }
    const block = page.sheet.blockAt(at.r, at.c);
    const canPoke = !!block?.poke && !e.shiftKey;
    const isTouch = e.pointerType === 'touch';
    const mode = canPoke ? 'poke' : isTouch || e.button === 1 ? 'pan' : 'range';
    press = { x: p.x, y: p.y, r: at.r, c: at.c, moved: false, mode, last: at, erase: false };
    if (e.shiftKey && !isTouch) {
      const s = grid.selection;
      select(s.r, s.c, at.r, at.c);
      press.mode = 'range';
      press.r = s.r;
      press.c = s.c;
      press.moved = true;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (touches.has(e.pointerId)) touches.set(e.pointerId, p);
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      grid.zoomAt((pinch.cell * d) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      updateZoom();
      dirty = true;
      return;
    }
    if (!press) return;
    if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) < 4) return;
    const firstMove = !press.moved;
    press.moved = true;
    const at = grid.hit(p.x, p.y);
    if (press.mode === 'pan') {
      grid.panBy(press.x - p.x, press.y - p.y);
      press.x = p.x;
      press.y = p.y;
      dirty = true;
    } else if (press.mode === 'poke' && at) {
      // A stroke that starts on something drawn rubs out; one that starts on bare paper draws.
      if (firstMove) press.erase = startsErasing(press.r, press.c);
      pokeLine(press.last ?? at, at, press.erase);
      press.last = at;
    } else if (press.mode === 'range' && at) {
      select(press.r, press.c, at.r, at.c);
    }
  });

  const finish = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (!press) return;
    if (!press.moved) {
      const merge = page.sheet.mergeAt.get(index(press.r, press.c));
      if (merge?.action) merge.action();
      else select(press.r, press.c);
    }
    press = null;
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  canvas.addEventListener('dblclick', (e) => {
    const p = local(e);
    const at = grid.hit(p.x, p.y);
    if (!at) return;
    const merge = page.sheet.mergeAt.get(index(at.r, at.c));
    if (merge?.action) return;
    select(at.r, at.c);
    enterEdit();
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e);
      if (e.ctrlKey || e.metaKey) {
        grid.zoomBy(-Math.sign(e.deltaY), p.x, p.y);
        updateZoom();
      } else {
        grid.panBy(e.shiftKey ? e.deltaY : e.deltaX, e.shiftKey ? 0 : e.deltaY);
      }
      dirty = true;
    },
    { passive: false },
  );

  function setKey(name: string, down: boolean) {
    const slot = KEYS.indexOf(name);
    if (slot < 0) return;
    if (down) {
      held.add(name);
      releasing.delete(name);
      page.engine.key(slot, true);
    } else {
      releasing.add(name);
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.target === entry || e.target === nameBox) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
      return;
    }
    const mapped = KEY_MAP[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (page.sheet.pad && mapped) {
      e.preventDefault();
      if (!e.repeat) setKey(mapped, true);
      return;
    }
    if (document.activeElement && document.activeElement !== canvas && document.activeElement !== document.body) return;
    switch (e.key) {
      case 'ArrowLeft':
        moveSelection(0, -1);
        break;
      case 'ArrowRight':
        moveSelection(0, 1);
        break;
      case 'ArrowUp':
        moveSelection(-1, 0);
        break;
      case 'ArrowDown':
        moveSelection(1, 0);
        break;
      case 'Enter':
      case 'F2':
        enterEdit();
        break;
      case 'Delete':
      case 'Backspace':
        entry.value = '';
        editing = true;
        editOriginal = page.sheet.source(index(grid.selection.r, grid.selection.c));
        commit(false);
        break;
      default:
        if (e.key.length === 1 && !page.sheet.pad) enterEdit(e.key);
        else return;
    }
    e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    const mapped = KEY_MAP[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (mapped && held.has(mapped)) setKey(mapped, false);
  });

  window.addEventListener('blur', () => {
    for (const name of held) releasing.add(name);
  });

  entry.addEventListener('focus', () => {
    if (!editing) {
      editing = true;
      editOriginal = entry.value;
    }
  });
  entry.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      entry.value = editOriginal;
      leaveEdit();
      canvas.focus();
    }
  });
  nameBox.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const named = page.sheet.names.get(nameBox.value.trim().toLowerCase());
    const cell = named ? index(named.r1, named.c1) : parseCellName(nameBox.value);
    if (cell === null) return;
    select(rowOf(cell), colOf(cell));
    grid.reveal(rowOf(cell), colOf(cell));
    canvas.focus();
  });
  nameBox.addEventListener('focus', () => nameBox.select());

  /* Buttons */

  function act(name: string) {
    switch (name) {
      case 'pause':
        running = !running;
        pauseButton.textContent = running ? 'Pause' : 'Run';
        pauseButton.setAttribute('aria-pressed', String(!running));
        break;
      case 'step':
        running = false;
        pauseButton.textContent = 'Run';
        stepOnce = true;
        break;
      case 'reset':
        void openSheet(active, true);
        break;
      case 'zoom-in':
        grid.zoomBy(2, canvas.clientWidth / 2, canvas.clientHeight / 2);
        updateZoom();
        break;
      case 'zoom-out':
        grid.zoomBy(-2, canvas.clientWidth / 2, canvas.clientHeight / 2);
        updateZoom();
        break;
      case 'fit':
        easeZoom();
        break;
      case 'compiled':
        listing.hidden = !listing.hidden;
        root.querySelector('[data-act="compiled"]')?.setAttribute('aria-pressed', String(!listing.hidden));
        updateListing();
        break;
    }
    dirty = true;
  }

  root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((button) => {
    button.addEventListener('click', () => act(button.dataset.act ?? ''));
  });

  pad.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((button) => {
    const name = button.dataset.key ?? '';
    const up = (e: Event) => {
      e.preventDefault();
      setKey(name, false);
    };
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      setKey(name, true);
    });
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('pointerleave', up);
  });

  new ResizeObserver(() => {
    grid.resize(size().w, size().h, dpr());
    dirty = true;
  }).observe(work);

  /* The loop */

  let last = performance.now();
  let spent = 0;
  let spentN = 0;
  let statusAt = 0;

  function runTicks(n: number) {
    const { engine, sheet } = page;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const pulsing = pulses.splice(0);
      for (const cell of pulsing) sheet.values[cell] = 1;
      engine.tick(page.ticks, page.seconds);
      for (const cell of pulsing) sheet.values[cell] = 0;
      page.ticks++;
      page.seconds += 1 / rateOf(sheet);
      for (const name of releasing) {
        held.delete(name);
        engine.key(KEYS.indexOf(name), false);
      }
      releasing.clear();
    }
    spent += performance.now() - t0;
    spentN += n;
    dirty = true;
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (page.engine.ready) {
      if (stepOnce) {
        stepOnce = false;
        runTicks(1);
      } else if (running) {
        page.acc += dt * rateOf(page.sheet);
        const n = Math.min(4, Math.floor(page.acc));
        if (n > 0) {
          page.acc -= n;
          runTicks(n);
        }
      }
    }
    if (dirty) {
      dirty = false;
      grid.draw();
    }
    if (now > statusAt) {
      statusAt = now + 250;
      const { stats } = page.engine;
      const fmt = (n: number) => n.toLocaleString('en-US');
      const cost = spentN ? shortNumber(Number((spent / spentN).toFixed(2))) : '0';
      spent = 0;
      spentN = 0;
      const value = page.sheet.values[index(grid.selection.r, grid.selection.c)];
      const here = page.sheet.texts.has(index(grid.selection.r, grid.selection.c)) ? '' : shortNumber(value);
      status.textContent = [
        `${cellName(grid.selection.r, grid.selection.c)} ${here}`.trim(),
        `Tick ${fmt(page.ticks)}`,
        `${fmt(stats.formulas)} formulas`,
        `${fmt(stats.circular)} circular`,
        `${fmt(stats.functions)} compiled ${stats.functions === 1 ? 'function' : 'functions'}, ${fmt(stats.bytes)} bytes`,
        `${cost} ms a tick`,
      ].join('   ');
    }
  }

  const ready = async () => {
    const fonts = [
      `800 30px ${faces.label}`,
      `600 12px ${faces.label}`,
      `400 13px ${faces.label}`,
      `400 15px ${faces.typed}`,
    ];
    await Promise.all(fonts.map((f) => document.fonts.load(f))).catch(() => undefined);
    await openSheet(0);
    grid.draw();
    requestAnimationFrame(frame);
  };
  void ready();

  const debug = new URLSearchParams(location.search).has('debug');
  if (debug) {
    (window as unknown as { circular: unknown }).circular = {
      grid,
      get page() {
        return page;
      },
      open: openSheet,
      setRunning: (v: boolean) => (running = v),
      run: (n: number) => {
        for (let i = 0; i < n; i++) runTicks(1);
        grid.draw();
      },
      key: setKey,
      pokeLine,
      select,
      dirty: () => (dirty = true),
    };
  }
}

const TAB_NAMES = ['Fire', 'Waves', 'Life', 'Snake', 'Maze', 'Interest'];
