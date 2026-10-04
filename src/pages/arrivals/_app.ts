import { Feed, printable, type Arrival, type Kind, type Status } from './_feed';
import { Cell, DIGIT_DRUM, Flaps, LETTER_DRUM, glyphs } from './_flaps';
import { Clatter } from './_sound';

const ROWS = 10;
/** How long a settled board stays put before the next arrival lands. */
const HOLD = 4000;
/** How long to gather arrivals before filling an empty board. */
const GATHER = 3000;
/** Below this board width, in pixels, the narrow layout drops the remarks. */
const NARROW_BELOW = 620;

type Key = 'time' | 'from' | 'title' | 'change' | 'remarks';
interface Column {
  key: Key;
  label: string;
  width: number;
  end?: boolean;
}

const WIDE: Column[] = [
  { key: 'time', label: 'Time', width: 8 },
  { key: 'from', label: 'From', width: 3 },
  { key: 'title', label: 'Article', width: 26 },
  { key: 'change', label: 'Bytes', width: 6, end: true },
  { key: 'remarks', label: 'Remarks', width: 8 },
];

const NARROW: Column[] = [
  { key: 'time', label: 'Time', width: 5 },
  { key: 'from', label: 'From', width: 3 },
  { key: 'title', label: 'Article', width: 14 },
  { key: 'change', label: 'Bytes', width: 5, end: true },
];

// Sizes in cell units, matching the stylesheet: a cell plus its gap is one unit.
const CELL_GAP = 0.12;
const COLUMN_GAP = 0.8;
const LAMP = 0.5;

const REMARKS: Record<Kind, string> = {
  new: 'NEW PAGE',
  revert: 'REVERTED',
  bot: 'BOT',
  anon: 'ANON',
  minor: 'MINOR',
  edit: 'LANDED',
};

const SPOKEN: Record<Kind, string> = {
  new: 'new page',
  revert: 'revert',
  bot: 'bot edit',
  anon: 'anonymous edit',
  minor: 'minor edit',
  edit: 'edit',
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const count = new Intl.NumberFormat();

function bytes(delta: number, width: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  const n = Math.abs(delta);
  for (const [div, suffix] of [
    [1, ''],
    [1e3, 'K'],
    [1e6, 'M'],
  ] as const) {
    const text = `${sign}${Math.round(n / div)}${suffix}`;
    if (text.length <= width) return text;
  }
  return sign;
}

function field(arrival: Arrival, column: Column): string {
  const t = arrival.time;
  switch (column.key) {
    case 'time':
      return `${pad2(t.getHours())}:${pad2(t.getMinutes())}${column.width >= 8 ? `:${pad2(t.getSeconds())}` : ''}`;
    case 'from':
      return arrival.wiki;
    case 'title':
      return arrival.title;
    case 'change':
      return bytes(arrival.delta, column.width);
    case 'remarks':
      return REMARKS[arrival.kind];
  }
}

/** Uppercases, trims, and pads text to exactly `width` cells. */
function fit(text: string, width: number, end = false): string[] {
  const chars = glyphs(text.toUpperCase()).slice(0, width);
  const pad = Array<string>(width - chars.length).fill(' ');
  return end ? [...pad, ...chars] : [...chars, ...pad];
}

const unitsFor = (columns: Column[]) =>
  LAMP + columns.reduce((sum, c) => sum + c.width - CELL_GAP + COLUMN_GAP, 0) + 0.2;

class Row {
  readonly el = document.createElement('a');
  private readonly groups: { column: Column; cells: Cell[] }[];

  constructor(columns: Column[]) {
    this.el.className = 'row';
    const lamp = document.createElement('span');
    lamp.className = 'lamp';
    this.el.append(lamp);
    this.groups = columns.map((column) => {
      const group = document.createElement('span');
      group.className = `col col-${column.key}`;
      group.setAttribute('aria-hidden', 'true');
      const cells = Array.from({ length: column.width }, () => new Cell(LETTER_DRUM));
      group.append(...cells.map((c) => c.el));
      this.el.append(group);
      return { column, cells };
    });
    this.clearLink();
  }

  get cells(): Cell[] {
    return this.groups.flatMap((g) => g.cells);
  }

  show(arrival: Arrival | null, flaps: Flaps): void {
    for (const { column, cells } of this.groups) {
      const chars = fit(arrival ? field(arrival, column) : '', column.width, column.end);
      cells.forEach((cell, i) => flaps.set(cell, chars[i]!));
    }
    if (!arrival) return this.clearLink();
    this.el.dataset.kind = arrival.kind;
    this.el.href = arrival.url;
    this.el.target = '_blank';
    this.el.rel = 'noopener';
    this.el.removeAttribute('aria-hidden');
    const delta = arrival.delta > 0 ? `plus ${arrival.delta}` : String(arrival.delta);
    this.el.setAttribute(
      'aria-label',
      `${arrival.title}, ${arrival.wiki} Wikipedia, ${SPOKEN[arrival.kind]}, ${delta} bytes. Opens the change.`,
    );
  }

  /** Writes a line of text across the article column. */
  say(text: string, flaps: Flaps): void {
    for (const { column, cells } of this.groups) {
      const line = column.key === 'title' ? text.padStart(Math.floor((column.width + text.length) / 2)) : '';
      const chars = fit(line, column.width);
      cells.forEach((cell, i) => flaps.set(cell, chars[i]!));
    }
    this.clearLink();
  }

  private clearLink(): void {
    delete this.el.dataset.kind;
    this.el.removeAttribute('href');
    this.el.removeAttribute('aria-label');
    this.el.setAttribute('aria-hidden', 'true');
  }
}

interface DocumentPictureInPicture extends EventTarget {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function startArrivals(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const board = q<HTMLElement>('[data-board]');
  const dock = q<HTMLElement>('[data-dock]');
  const away = q<HTMLElement>('[data-away]');
  const grid = q<HTMLElement>('[data-grid]');
  const clock = q<HTMLElement>('[data-clock]');
  const foot = q<HTMLElement>('[data-foot]');
  const statusText = q<HTMLElement>('[data-status]');
  const tally = q<HTMLElement>('[data-tally]');
  const holdNote = q<HTMLElement>('[data-hold]');
  const wikiSelect = q<HTMLSelectElement>('[data-wiki]');
  const botsButton = q<HTMLButtonElement>('[data-bots]');
  const soundButton = q<HTMLButtonElement>('[data-sound]');
  const popButton = q<HTMLButtonElement>('[data-pop]');
  const returnButton = q<HTMLButtonElement>('[data-return]');
  const popNote = q<HTMLElement>('[data-pop-note]');

  const rowFlaps = new Flaps();
  const clockFlaps = new Flaps();
  const clatter = new Clatter();
  const feed = new Feed();

  let view: Window = window;
  let columns: Column[] = [];
  let rows: Row[] = [];
  let shown: (Arrival | null)[] = Array(ROWS).fill(null);
  let pending: Arrival[] = [];
  let firstPending = 0;
  let settledAt = 0;
  let holding = false;
  let status: Status = 'connecting';
  let saying = false;

  let wiki: string | null = null;
  let hideBots = false;
  let landed = 0;
  let recent: number[] = [];

  // The board.

  function build(next: Column[]): void {
    rowFlaps.forget(rows.flatMap((r) => r.cells));
    columns = next;
    grid.style.setProperty('--units', String(unitsFor(columns)));

    const head = document.createElement('div');
    head.className = 'row head';
    head.setAttribute('aria-hidden', 'true');
    head.append(Object.assign(document.createElement('span'), { className: 'lamp' }));
    for (const column of columns) {
      const label = document.createElement('span');
      label.className = `col col-${column.key}`;
      label.style.setProperty('--w', String(column.width));
      label.textContent = column.label;
      head.append(label);
    }

    rows = Array.from({ length: ROWS }, () => new Row(columns));
    grid.replaceChildren(head, ...rows.map((r) => r.el));
    render();
  }

  function relayout(): void {
    const next = grid.clientWidth < NARROW_BELOW ? NARROW : WIDE;
    if (next !== columns) build(next);
  }

  function render(): void {
    saying = false;
    rows.forEach((row, i) => row.show(shown[i] ?? null, rowFlaps));
    // Nothing to flip (or reduced motion): the board is already settled.
    if (!rowFlaps.busy) settledAt = performance.now();
  }

  function say(lines: string[]): void {
    saying = true;
    const top = Math.floor((ROWS - lines.length) / 2);
    rows.forEach((row, i) => {
      const line = lines[i - top];
      if (line) row.say(line, rowFlaps);
      else row.show(null, rowFlaps);
    });
  }

  rowFlaps.onSettle = () => {
    settledAt = performance.now();
  };
  rowFlaps.onLand = clockFlaps.onLand = (n) => clatter.land(n);

  /** Lands the newest arrival on the board, or fills an empty board at once. */
  function step(): void {
    const now = performance.now();
    if (!pending.length) {
      if (status === 'down' && !shown.some(Boolean) && !saying) say(['NO ARRIVALS YET', 'CHECKING AGAIN SOON']);
      return;
    }
    if (holding || rowFlaps.busy) return;
    if (!shown.some(Boolean)) {
      if (now - firstPending < GATHER && pending.length < ROWS) return;
      // Wikis report at slightly different speeds, so sort by when each edit was made.
      const batch = pending.slice(-ROWS).sort((a, b) => b.time.getTime() - a.time.getTime());
      shown = [...batch, ...Array<null>(ROWS - batch.length).fill(null)];
    } else {
      if (now - settledAt < HOLD) return;
      shown = [pending.at(-1)!, ...shown.slice(0, ROWS - 1)];
    }
    pending = [];
    render();
  }

  // The clock in the corner flips once a minute.

  const clockCells = Array.from({ length: 4 }, () => new Cell(DIGIT_DRUM, '0'));
  const colon = Object.assign(document.createElement('span'), { className: 'colon', textContent: ':' });
  clock.append(clockCells[0]!.el, clockCells[1]!.el, colon, clockCells[2]!.el, clockCells[3]!.el);

  function setClock(): void {
    const d = new Date();
    const digits = `${pad2(d.getHours())}${pad2(d.getMinutes())}`;
    clockCells.forEach((cell, i) => clockFlaps.set(cell, digits[i]!));
    clock.setAttribute('aria-label', `Local time ${digits.slice(0, 2)}:${digits.slice(2)}`);
  }

  // Timers belong to whichever window shows the board: a hidden tab's timers
  // are throttled, but a picture-in-picture window's are not.

  let timers: { view: Window; step: number; clock: number } | null = null;

  function startTimers(): void {
    if (timers) {
      try {
        timers.view.clearInterval(timers.step);
        timers.view.clearTimeout(timers.clock);
      } catch {
        // The window has already closed, and its timers with it.
      }
    }
    const tickClock = () => {
      setClock();
      if (timers) timers.clock = view.setTimeout(tickClock, 60050 - (Date.now() % 60000));
    };
    timers = { view, step: view.setInterval(step, 250), clock: 0 };
    tickClock();
  }

  function attach(next: Window): void {
    view = next;
    rowFlaps.attach(next);
    clockFlaps.attach(next);
    next.addEventListener('resize', relayout);
    startTimers();
    relayout();
  }

  // The feed.

  const matches = (a: Arrival) => (wiki === null || a.wiki === wiki) && !(hideBots && a.bot);

  feed.onArrival = (arrival) => {
    if (!matches(arrival)) return;
    landed++;
    const now = Date.now();
    recent.push(now);
    while (recent[0]! < now - 60000) recent.shift();
    if (arrival.wiki.length <= 3 && printable(arrival.title)) {
      if (!pending.length) firstPending = performance.now();
      pending.push(arrival);
      if (pending.length > 50) pending.shift();
    }
    updateTally();
  };

  feed.onStatus = (next) => {
    status = next;
    foot.dataset.state = next;
    statusText.textContent = {
      connecting: 'Connecting',
      live: 'Live',
      polling: 'Polling recent changes',
      down: 'Delayed: no answer from Wikipedia',
    }[next];
    if (next !== 'down' && saying) render();
    updateTally();
  };

  function updateTally(): void {
    const since = `${count.format(landed)} ${landed === 1 ? 'edit' : 'edits'} since you arrived`;
    tally.textContent = status === 'live' ? `${since} · ${count.format(recent.length)} in the last minute` : since;
  }

  function reset(): void {
    pending = [];
    landed = 0;
    recent = [];
    shown = Array(ROWS).fill(null);
    render();
    updateTally();
  }

  // Controls.

  wikiSelect.addEventListener('change', () => {
    wiki = wikiSelect.value === 'all' ? null : wikiSelect.value;
    feed.wiki = wiki;
    reset();
  });

  botsButton.addEventListener('click', () => {
    hideBots = !hideBots;
    botsButton.setAttribute('aria-pressed', String(hideBots));
    reset();
  });

  soundButton.addEventListener('click', () => {
    const on = clatter.toggle();
    soundButton.setAttribute('aria-pressed', String(on));
    soundButton.textContent = on ? 'Sound on' : 'Sound off';
  });

  // Hold the board still while someone is reading it or reaching for a row.
  const hold = (on: boolean) => {
    holding = on;
    holdNote.hidden = !on;
  };
  board.addEventListener('pointerenter', () => hold(true));
  board.addEventListener('pointerleave', () => hold(false));
  board.addEventListener('focusin', () => hold(true));
  board.addEventListener('focusout', (e) => {
    if (!board.contains(e.relatedTarget as Node | null)) hold(false);
  });

  // Pop the board out into an always-on-top window.

  const pipApi = window.documentPictureInPicture;
  let pip: Window | null = null;
  popButton.hidden = !pipApi;
  popNote.hidden = !!pipApi;

  async function popOut(): Promise<void> {
    if (!pipApi) return;
    if (pip) return pip.close();
    const rect = board.getBoundingClientRect();
    const width = Math.round(Math.min(rect.width, 820));
    const win = await pipApi.requestWindow({ width, height: Math.round((width * rect.height) / rect.width) });
    pip = win;

    const doc = win.document;
    const base = doc.createElement('base');
    base.href = location.href;
    doc.head.append(base);
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const style = doc.createElement('style');
        style.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
        doc.head.append(style);
      } catch {
        if (!sheet.href) continue;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        doc.head.append(link);
      }
    }
    doc.title = 'Arrivals';
    doc.body.className = 'pip';
    doc.body.append(board);
    hold(false);
    away.hidden = false;
    popButton.setAttribute('aria-pressed', 'true');
    popButton.textContent = 'Bring it back';
    attach(win);

    win.addEventListener(
      'pagehide',
      () => {
        pip = null;
        dock.prepend(board);
        hold(false);
        away.hidden = true;
        popButton.setAttribute('aria-pressed', 'false');
        popButton.textContent = 'Pop out';
        attach(window);
      },
      { once: true },
    );
  }

  popButton.addEventListener('click', () => void popOut().catch(() => {}));
  returnButton.addEventListener('click', () => pip?.close());

  attach(window);
  feed.start();
}
