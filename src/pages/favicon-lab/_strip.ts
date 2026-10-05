import { LED_COLS, drawLedLabel, drawSignWindow, fold } from './_font';
import type { Lab, Program } from './_lab';

// A scrolling sign strung across every tab showing Strip. The tabs find each
// other over a BroadcastChannel. Each tab draws its own window of the sign
// from the clock alone, so nothing per frame has to be agreed: the visible
// tab, whose timers run on time, just nudges the hidden ones to redraw, since
// a hidden tab's timers are held back but its messages are not.

const CHANNEL = 'favicon-lab:strip';
const STEP_MS = 110;
const BEAT_MS = 2000;
const LIVE_MS = 6500;
const QUIET_MS = 150000;
const DEFAULT_TEXT = 'Hello from the tab strip';

type Mode = 'run' | 'number';

interface Shared {
  text: string;
  mode: Mode;
  /** When the message started, so a new message enters at the first tab. */
  epoch: number;
  /** Tabs moved by hand, in order; the rest follow by when they joined. */
  order: string[];
  /** Newest wins. */
  v: number;
}

interface Member {
  joined: number;
  seen: number;
}

type Message =
  | { t: 'hello'; id: string; joined: number }
  | { t: 'here'; id: string; joined: number; shared: Shared }
  | { t: 'bye'; id: string }
  | { t: 'state'; shared: Shared }
  | { t: 'tick' }
  | { t: 'ping'; id: string };

interface Ghost {
  el: HTMLElement;
  ctx: CanvasRenderingContext2D;
  title: HTMLElement;
}

const newId = () =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function createStrip(lab: Lab): Program {
  const panel = lab.panel('strip');
  const textInput = panel.querySelector<HTMLInputElement>('[data-strip-text]')!;
  const statusEl = panel.querySelector<HTMLElement>('[data-strip-status]')!;
  const rosterEl = panel.querySelector<HTMLOListElement>('[data-strip-roster]')!;
  const modeButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-strip-mode]')];
  const tabsEl = lab.root.querySelector<HTMLElement>('[data-tabs]')!;
  const selfTab = lab.root.querySelector<HTMLElement>('[data-self-tab]')!;
  const plusTab = tabsEl.querySelector<HTMLElement>('.tab-new')!;

  const id = newId();
  let joined = 0;
  let channel: BroadcastChannel | null = null;
  let members = new Map<string, Member>();
  let shared: Shared = { text: DEFAULT_TEXT, mode: 'run', epoch: 0, order: [], v: 0 };
  let ghosts = new Map<string, Ghost>();
  let timer = 0;
  let lastBeat = 0;
  let lastPing = 0;
  let running = false;

  const post = (message: Message) => channel?.postMessage(message);

  const lineup = (): string[] => {
    const moved = shared.order.filter((m) => members.has(m));
    const rest = [...members.keys()]
      .filter((m) => !moved.includes(m))
      .sort((a, b) => members.get(a)!.joined - members.get(b)!.joined || (a < b ? -1 : 1));
    return [...moved, ...rest];
  };

  const message = () => `${fold(shared.text.trim())}   `;
  const column = () => Math.floor((Date.now() - shared.epoch) / STEP_MS);

  const paint = (ctx: CanvasRenderingContext2D, index: number) => {
    if (shared.mode === 'number') drawLedLabel(ctx, String(index + 1));
    else drawSignWindow(ctx, message(), column() + index * LED_COLS);
  };

  const draw = () => {
    if (!running) return;
    const order = lineup();
    const index = order.indexOf(id);
    paint(lab.ctx, index);
    lab.present();
    const caption = shared.mode === 'number' ? `Tab ${index + 1} of ${order.length}` : `Strip · ${index + 1} of ${order.length}`;
    if (document.title !== caption) lab.title(caption);
    if (!document.hidden) {
      order.forEach((m, i) => {
        const ghost = ghosts.get(m);
        if (ghost) paint(ghost.ctx, i);
      });
    }
  };

  const makeGhost = (): Ghost => {
    const el = document.createElement('div');
    el.className = 'tab';
    el.setAttribute('aria-hidden', 'true');
    const icon = document.createElement('div');
    icon.className = 'tab-icon';
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    icon.append(canvas);
    const title = document.createElement('span');
    title.className = 'tab-title';
    el.append(icon, title);
    return { el, ctx: canvas.getContext('2d')!, title };
  };

  const move = (from: number, by: number) => {
    const order = lineup();
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    change({ order });
  };

  /** Rebuild the enlarged tabs and the roster to match who's on the sign. */
  const layout = () => {
    if (!running) return;
    const order = lineup();
    for (const [m, ghost] of ghosts) {
      if (!members.has(m)) {
        ghost.el.remove();
        ghosts.delete(m);
      }
    }
    order.forEach((m, i) => {
      let el = selfTab;
      if (m !== id) {
        let ghost = ghosts.get(m);
        if (!ghost) {
          ghost = makeGhost();
          ghosts.set(m, ghost);
        }
        ghost.title.textContent = `Tab ${i + 1}`;
        el = ghost.el;
      }
      tabsEl.insertBefore(el, plusTab);
    });
    tabsEl.dataset.count = String(order.length);
    tabsEl.style.setProperty('--count', String(order.length));

    const index = order.indexOf(id);
    statusEl.textContent =
      order.length === 1
        ? 'This is the only tab on the sign. Open another to make it longer.'
        : `This is tab ${index + 1} of ${order.length} on the sign.`;

    rosterEl.replaceChildren(
      ...order.map((m, i) => {
        const li = document.createElement('li');
        if (m === id) li.className = 'is-self';
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = m === id ? `Tab ${i + 1} (this one)` : `Tab ${i + 1}`;
        li.append(who);
        for (const [by, glyph, label] of [
          [-1, '◀', 'left'],
          [1, '▶', 'right'],
        ] as const) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn';
          button.textContent = glyph;
          button.setAttribute('aria-label', `Move tab ${i + 1} ${label}`);
          button.disabled = i + by < 0 || i + by >= order.length;
          button.addEventListener('click', () => move(i, by));
          li.append(button);
        }
        return li;
      }),
    );
    draw();
  };

  const syncControls = () => {
    for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.stripMode === shared.mode));
    if (document.activeElement !== textInput && textInput.value !== shared.text) textInput.value = shared.text;
  };

  const adopt = (next: Shared) => {
    if (next.v <= shared.v) return;
    shared = next;
    syncControls();
    layout();
  };

  const change = (patch: Partial<Shared>) => {
    shared = { ...shared, ...patch, v: Math.max(Date.now(), shared.v + 1) };
    post({ t: 'state', shared });
    syncControls();
    layout();
  };

  const prune = () => {
    const now = Date.now();
    const limit = now - lastPing < BEAT_MS * 2 ? LIVE_MS : QUIET_MS;
    let gone = false;
    for (const [m, member] of members) {
      if (m !== id && now - member.seen > limit) {
        members.delete(m);
        gone = true;
      }
    }
    if (gone) layout();
  };

  const onMessage = (event: MessageEvent<Message>) => {
    const m = event.data;
    const now = Date.now();
    switch (m.t) {
      case 'hello':
        members.set(m.id, { joined: m.joined, seen: now });
        post({ t: 'here', id, joined, shared });
        layout();
        break;
      case 'here': {
        const known = members.has(m.id);
        members.set(m.id, { joined: m.joined, seen: now });
        if (m.shared.v > shared.v) adopt(m.shared);
        else if (!known) layout();
        break;
      }
      case 'bye':
        if (members.delete(m.id)) layout();
        break;
      case 'state':
        adopt(m.shared);
        break;
      case 'ping':
        lastPing = now;
        post({ t: 'here', id, joined, shared });
        prune();
        break;
      case 'tick':
        draw();
        break;
    }
  };

  /** One step of the sign, on the step boundary. The visible tab keeps time for the rest. */
  const loop = () => {
    draw();
    if (!document.hidden && channel) {
      post({ t: 'tick' });
      const now = Date.now();
      if (now - lastBeat >= BEAT_MS) {
        lastBeat = lastPing = now;
        post({ t: 'ping', id });
        prune();
      }
    }
    timer = window.setTimeout(loop, STEP_MS - ((Date.now() - shared.epoch) % STEP_MS) + 2);
  };

  const onVisibility = () => {
    if (document.hidden) return;
    lastBeat = 0;
    clearTimeout(timer);
    loop();
  };

  const onLeave = () => post({ t: 'bye', id });

  /** Back from the back-forward cache: say hello again, since the others said goodbye. */
  const onReturn = (event: PageTransitionEvent) => {
    if (event.persisted) post({ t: 'hello', id, joined });
  };

  const onInput = () => change({ text: textInput.value, epoch: Date.now() });

  const onMode = (event: Event) => {
    const mode = (event.currentTarget as HTMLElement).dataset.stripMode === 'number' ? 'number' : 'run';
    if (mode !== shared.mode) change({ mode });
  };

  return {
    start() {
      running = true;
      joined = Date.now();
      members = new Map([[id, { joined, seen: Infinity }]]);
      ghosts = new Map();
      if (typeof BroadcastChannel === 'function') {
        channel = new BroadcastChannel(CHANNEL);
        channel.addEventListener('message', onMessage);
        post({ t: 'hello', id, joined });
      }
      syncControls();
      textInput.addEventListener('input', onInput);
      for (const b of modeButtons) b.addEventListener('click', onMode);
      addEventListener('pagehide', onLeave);
      addEventListener('pageshow', onReturn);
      document.addEventListener('visibilitychange', onVisibility);
      layout();
      if (!channel) statusEl.textContent = 'This browser has no BroadcastChannel, so this tab is a sign on its own.';
      loop();
    },
    stop() {
      onLeave();
      running = false;
      clearTimeout(timer);
      channel?.close();
      channel = null;
      textInput.removeEventListener('input', onInput);
      for (const b of modeButtons) b.removeEventListener('click', onMode);
      removeEventListener('pagehide', onLeave);
      removeEventListener('pageshow', onReturn);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const ghost of ghosts.values()) ghost.el.remove();
      ghosts.clear();
      tabsEl.insertBefore(selfTab, tabsEl.firstChild);
      delete tabsEl.dataset.count;
      tabsEl.style.removeProperty('--count');
      rosterEl.replaceChildren();
    },
  };
}
