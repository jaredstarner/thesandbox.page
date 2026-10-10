// Box 1725: wires the case file and the roadside together.
//
// The ritual is the real one: write, stamp, put it in the box, raise the
// flag. The item collects its own mail (no carrier comes), writes back after
// a delay, and raises its own flag when the reply is waiting. Everything it
// does is written into the incident log, and everything it remembers stays in
// this browser.

import { paste } from './_collage';
import { composeReply, composeReturn } from './_compose';
import { hash } from './_grammar';
import { armAudio, clank, creak, setSound, slide, stampThud, thunk } from './_sound';
import { stampById } from './_stamps';
import { load, save, type State, type StoredLetter } from './_store';

const params = new URLSearchParams(location.search);
// ?debug shortens every wait to a few seconds, for testing.
const DEBUG = params.has('debug');
const IDLE_MS = DEBUG ? 4000 : 20000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, reducedMotion() ? Math.min(ms, 60) : ms));

/** The file's date format: 10 OCT 2026 06:41. */
export function fileDate(ms: number): string {
  const d = new Date(ms);
  const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  return `${pad(d.getDate())} ${month} ${d.getFullYear()} ${clock(ms)}`;
}
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** How long the item takes to answer its nth letter. Mail takes time. */
function replyDelay(n: number, seed: number): number {
  if (DEBUG) return 3 * SECOND;
  const steps = [1, 3, 8, 20];
  const jitter = 0.8 + ((seed % 1000) / 1000) * 0.4;
  if (n < steps.length) return steps[n] * MINUTE * jitter;
  return (45 + ((seed >>> 3) % 45)) * MINUTE;
}

const $ = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel) as T;

export function start(): void {
  const root = document.querySelector<HTMLElement>('[data-box1725]');
  if (!root) return;

  const s: State = load();
  const ui = {
    door: $<SVGGElement>(root, '[data-door]'),
    flag: $<SVGGElement>(root, '[data-flag]'),
    plate: $<SVGPathElement>(root, '.flag-plate'),
    mouth: $<SVGGElement>(root, '[data-mouth]'),
    glint: $<SVGGElement>(root, '[data-glint]'),
    status: $(root, '[data-status]'),
    write: $<HTMLButtonElement>(root, '[data-write]'),
    ledgerBtn: $<HTMLButtonElement>(root, '[data-ledger]'),
    ledgerCount: $(root, '[data-ledger-count]'),
    sound: $<HTMLButtonElement>(root, '[data-sound]'),
    desk: $<HTMLDialogElement>(root, '[data-desk]'),
    form: $<HTMLFormElement>(root, '[data-letter-form]'),
    slot: $<HTMLButtonElement>(root, '[data-stamp-slot]'),
    reply: $<HTMLDialogElement>(root, '[data-reply]'),
    replyTitle: $(root, '[data-reply-title]'),
    collage: $(root, '[data-reply-collage]'),
    returned: $(root, '[data-returned-stamp]'),
    replyMeta: $(root, '[data-reply-meta]'),
    ledger: $<HTMLDialogElement>(root, '[data-ledger-dialog]'),
    ledgerList: $(root, '[data-ledger-list]'),
    flight: $(root, '[data-flight]'),
    incidents: $(root, '[data-incidents]'),
    addressee: $(root, '[data-addressee]'),
    addresseeInput: $<HTMLInputElement>(root, '[data-addressee] input'),
  };
  const baseTitle = document.title;
  let stamp: string | null = null;
  let flagByReader = false;
  let collecting: ReturnType<typeof setTimeout> | null = null;
  let busy = false;

  const commit = () => save(s);

  // ---------- The file ----------

  const reviewed = root.querySelector<HTMLElement>('[data-reviewed]');
  if (reviewed) reviewed.textContent = fileDate(Date.now()).split(' ').slice(0, 3).join(' ');

  for (const note of root.querySelectorAll<HTMLElement>('[data-note]')) {
    const board = document.createElement('div');
    board.className = 'collage';
    note.append(board);
    paste(board, note.dataset.note ?? '');
  }
  for (const exhibit of root.querySelectorAll<HTMLElement>('[data-collage-static]')) {
    paste(exhibit, exhibit.dataset.text ?? '', hash(exhibit.dataset.collageStatic ?? ''));
  }

  const unlocked = () => s.letters.some((l) => l.grants && l.state === 'read');

  function setClearance(level: number) {
    if (level === 3 && !unlocked()) level = 2;
    s.clearance = level;
    root!.dataset.clearance = String(level);
    for (const input of root!.querySelectorAll<HTMLInputElement>('[data-clearance-switch] input')) {
      input.checked = input.value === String(level);
    }
    syncTape();
  }

  function syncLock() {
    const open = unlocked();
    ui.addresseeInput.disabled = !open;
    ui.addressee.classList.toggle('locked', !open);
    const note = ui.addressee.querySelector('[data-addressee-note]');
    if (note) note.textContent = open ? 'granted' : 'granted by the item';
  }

  for (const input of root.querySelectorAll<HTMLInputElement>('[data-clearance-switch] input')) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      setClearance(Number(input.value));
      commit();
    });
  }

  // Redaction tape: covered tape can be picked at, and the item notices.
  const tapes = [...root.querySelectorAll<HTMLElement>('.tape')];
  const covered = (t: HTMLElement) => !t.hasAttribute('data-peeled') && Number(t.dataset.below) > s.clearance;
  function syncTape() {
    for (const t of tapes) {
      if (covered(t)) {
        t.tabIndex = 0;
        t.setAttribute('role', 'button');
        t.setAttribute('aria-label', 'Redacted. Lift the tape.');
      } else {
        t.removeAttribute('tabindex');
        t.removeAttribute('role');
        t.removeAttribute('aria-label');
      }
    }
  }
  function lift(t: HTMLElement) {
    if (!covered(t)) return;
    t.setAttribute('data-peeled', '');
    t.setAttribute('data-lifting', '');
    t.addEventListener('animationend', () => t.removeAttribute('data-lifting'), { once: true });
    const key = t.dataset.key ?? '';
    if (key && !s.memory.peeked.includes(key)) {
      s.memory.peeked.push(key);
      log(`Reader lifted redaction tape without clearance (${key}). The item was not asked.`);
    }
    syncTape();
    commit();
  }
  for (const t of tapes) {
    if (s.memory.peeked.includes(t.dataset.key ?? '')) t.setAttribute('data-peeled', '');
    t.addEventListener('click', () => lift(t));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        lift(t);
      }
    });
  }

  // The incident log grows with what the reader does.
  function renderIncident(at: number, text: string, n: number, fresh: boolean) {
    const li = document.createElement('li');
    li.dataset.visitor = '';
    if (!fresh) li.style.animation = 'none';
    const b = document.createElement('b');
    b.textContent = `1725-R${n}`;
    const time = document.createElement('time');
    time.dateTime = new Date(at).toISOString();
    time.textContent = fileDate(at);
    li.append(b, ' ', time, ` ${text}`);
    ui.incidents.append(li);
  }
  function log(text: string) {
    const at = Date.now();
    s.incidents.push({ at, text });
    if (s.incidents.length > 60) s.incidents.splice(0, s.incidents.length - 60);
    renderIncident(at, text, s.incidents.length, true);
  }
  s.incidents.forEach((inc, i) => renderIncident(inc.at, inc.text, i + 1, false));

  // ---------- The roadside ----------

  const hour = new Date().getHours();
  root.dataset.sky = hour >= 5 && hour < 7 ? 'dawn' : hour >= 7 && hour < 17 ? 'day' : hour >= 17 && hour < 20 ? 'dusk' : 'night';

  const setDoor = (state: 'shut' | 'ajar' | 'open') => {
    root!.dataset.doorPos = state;
  };
  const setFlag = (up: boolean) => {
    root!.dataset.flagPos = up ? 'up' : 'down';
  };
  const waiting = () => s.letters.find((l) => l.state === 'answered');

  function render() {
    const inside = s.letters.filter((l) => l.state === 'inside');
    const collected = s.letters.filter((l) => l.state === 'collected');
    const reply = waiting();
    let line: string;
    if (reply) {
      line = 'The flag is up. You did not raise it.';
    } else if (inside.length && root!.dataset.flagPos === 'up') {
      line = 'Flag up. Waiting for collection.';
    } else if (inside.length) {
      line = 'Your letter is inside. Raise the flag so it gets collected.';
    } else if (collected.length) {
      const last = collected.at(-1)!;
      line = `Collected at ${clock(last.collectedAt ?? last.postedAt)}. Nobody came for it.`;
    } else if (s.letters.length) {
      line = 'Flag down. Nothing waiting.';
    } else {
      line = 'Flag down. Nothing waiting. It has never had a letter from you.';
    }
    ui.status.textContent = line;
    root!.toggleAttribute('data-waiting', !!reply);
    const count = s.letters.length;
    ui.ledgerCount.textContent = count ? `(${count})` : '';
    ui.ledgerBtn.disabled = count === 0;
    document.title = reply && document.hidden ? `(1) ${baseTitle}` : baseTitle;
  }

  // A reply that came due while the page was closed is already waiting.
  function tick() {
    const now = Date.now();
    let arrived = false;
    for (const l of s.letters) {
      if (l.state === 'collected' && (l.replyAt ?? Infinity) <= now) {
        l.state = 'answered';
        arrived = true;
      }
    }
    if (arrived) {
      if (root!.dataset.flagPos !== 'up') {
        setFlag(true);
        clank();
      }
      flagByReader = false;
      log('Item raised its own flag. A reply is waiting.');
      commit();
    }
    render();
  }

  // ---------- Presence: the flag twitches, the door opens if you linger ----------

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lingered = false;
  function idle() {
    if (busy || anyDialogOpen() || root!.dataset.doorPos !== 'shut') return;
    setDoor('ajar');
    creak(3, true);
    if (!lingered) {
      lingered = true;
      log('Reader stood at the item without posting anything. The door opened.');
      commit();
    }
  }
  function active() {
    if (root!.dataset.doorPos === 'ajar') {
      setDoor('shut');
      thunk();
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(idle, IDLE_MS);
  }
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(type, active, { passive: true });
  }
  let lastMove = 0;
  window.addEventListener(
    'pointermove',
    (e) => {
      const now = performance.now();
      if (now - lastMove < 70) return;
      lastMove = now;
      // Moving the mouse shuts a lingering door only after a real move, not a jitter.
      if (root!.dataset.doorPos === 'ajar' && Math.abs(e.movementX) + Math.abs(e.movementY) > 6) active();
      else if (root!.dataset.doorPos !== 'ajar') active();

      const plate = ui.plate.getBoundingClientRect();
      const dx = e.clientX - (plate.left + plate.width / 2);
      const dy = e.clientY - (plate.top + plate.height / 2);
      const d = Math.hypot(dx, dy);
      const reach = 180;
      const amp = d < reach && root!.dataset.flagPos === 'down' ? (1 - d / reach) * 9 : 0;
      ui.flag.style.setProperty('--twitch', `${((Math.random() - 0.5) * amp).toFixed(2)}deg`);

      const m = ui.mouth.getBoundingClientRect();
      const gx = Math.max(-3, Math.min(3, (e.clientX - (m.left + m.width / 2)) / 60));
      const gy = Math.max(-2, Math.min(2, (e.clientY - (m.top + m.height / 2)) / 80));
      ui.glint.style.setProperty('--gx', `${gx.toFixed(2)}px`);
      ui.glint.style.setProperty('--gy', `${gy.toFixed(2)}px`);
    },
    { passive: true },
  );

  // Late at night the door is already open when you arrive.
  if (hour < 5) setDoor('ajar');

  const anyDialogOpen = () => ui.desk.open || ui.reply.open || ui.ledger.open;

  // ---------- The flag ----------

  async function flagPressed() {
    if (busy) return;
    const reply = waiting();
    if (reply) return openReply(reply);
    if (root!.dataset.flagPos === 'up') {
      setFlag(false);
      clank(0.7);
      flagByReader = false;
      if (collecting) clearTimeout(collecting);
      collecting = null;
      render();
      return;
    }
    setFlag(true);
    flagByReader = true;
    clank();
    render();
    if (s.letters.some((l) => l.state === 'inside')) {
      collecting = setTimeout(collect, DEBUG ? 1500 : 4000 + Math.random() * 3000);
    } else {
      // A raised flag over an empty box is a lie, and the item corrects it.
      busy = true;
      await wait(1300);
      busy = false;
      if (!flagByReader || root!.dataset.flagPos !== 'up') return;
      setFlag(false);
      clank(1.2);
      flagByReader = false;
      s.memory.falseFlags++;
      s.memory.trust -= 1;
      log('Reader raised the flag over an empty box. The item lowered it.');
      commit();
      render();
    }
  }

  async function collect() {
    collecting = null;
    const inside = s.letters.filter((l) => l.state === 'inside');
    if (!inside.length) return;
    // No carrier comes. The door rattles, and the item takes its own mail.
    setDoor('open');
    creak(0.5, true);
    await wait(700);
    setDoor('shut');
    thunk();
    await wait(500);
    setFlag(false);
    clank(0.8);
    flagByReader = false;
    const now = Date.now();
    for (const l of inside) {
      const r = composeReply(l, s.memory, s.seed + l.id);
      s.memory.trust += r.trustDelta;
      if (r.kept) s.memory.kept.push(r.kept);
      if (r.name) s.memory.name = r.name;
      if (r.grantsClearance) s.memory.granted = true;
      l.reply = r.text;
      l.grants = r.grantsClearance;
      l.state = 'collected';
      l.collectedAt = now;
      l.replyAt = now + replyDelay(s.memory.answered, s.seed + l.id * 7919);
      s.memory.answered++;
    }
    log(`Item collected ${inside.length === 1 ? 'a letter' : `${inside.length} letters`} from itself. No carrier was present.`);
    commit();
    render();
  }

  // ---------- The desk ----------

  function chooseStamp(id: string | null) {
    stamp = id;
    const s0 = stampById(id);
    for (const b of ui.form.querySelectorAll<HTMLButtonElement>('[data-stamp]')) {
      b.setAttribute('aria-pressed', String(b.dataset.stamp === id));
    }
    if (s0) {
      ui.slot.innerHTML = s0.svg;
      ui.slot.setAttribute('aria-label', `Stamp: ${s0.label}. Press to peel it off.`);
      stampThud();
    } else {
      ui.slot.innerHTML = '<span>Place stamp here</span>';
      ui.slot.setAttribute('aria-label', 'Stamp: none. Pick one below.');
    }
  }
  for (const b of ui.form.querySelectorAll<HTMLButtonElement>('[data-stamp]')) {
    b.addEventListener('click', () => chooseStamp(b.dataset.stamp === stamp ? null : (b.dataset.stamp ?? null)));
  }
  ui.slot.addEventListener('click', () => chooseStamp(null));

  function openDesk() {
    if (busy) return;
    const from = ui.form.elements.namedItem('from') as HTMLInputElement;
    if (!from.value && s.memory.name) from.value = s.memory.name;
    setDoor('shut');
    ui.desk.showModal();
    (ui.form.elements.namedItem('body') as HTMLTextAreaElement).focus();
  }

  ui.form.addEventListener('submit', (e) => {
    const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value !== 'post') return;
    e.preventDefault();
    const data = new FormData(ui.form);
    const letter: StoredLetter = {
      id: (s.letters.at(-1)?.id ?? 0) + 1,
      to: String(data.get('to') ?? '').slice(0, 80),
      from: String(data.get('from') ?? '').slice(0, 40),
      body: String(data.get('body') ?? '').slice(0, 2400),
      stamp,
      postedAt: Date.now(),
      state: 'inside',
    };
    const from = ui.desk.getBoundingClientRect();
    ui.desk.close();
    void post(letter, from);
  });

  async function fly(from: DOMRect, to: DOMRect, stamped: boolean, back = false) {
    ui.flight.toggleAttribute('data-stamped', stamped);
    if (reducedMotion()) return;
    const a = { x: from.left + from.width / 2 - 60, y: from.top + from.height / 2 - 28 };
    const b = { x: to.left + to.width / 2 - 60, y: to.top + to.height / 2 - 28 };
    const [p, q] = back ? [b, a] : [a, b];
    const frames: Keyframe[] = [
      { transform: `translate(${p.x}px, ${p.y}px) rotate(${back ? -4 : -8}deg) scale(${back ? 0.25 : 1.4})`, opacity: back ? 0 : 1 },
      { transform: `translate(${(p.x + q.x) / 2}px, ${Math.min(p.y, q.y) - 60}px) rotate(${back ? 380 : 4}deg) scale(0.8)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${q.x}px, ${q.y}px) rotate(${back ? 720 : 0}deg) scale(${back ? 1.4 : 0.25})`, opacity: back ? 1 : 0 },
    ];
    await ui.flight.animate(frames, { duration: back ? 600 : 800, easing: 'cubic-bezier(0.45, 0, 0.3, 1)' }).finished;
  }

  async function post(letter: StoredLetter, from: DOMRect) {
    busy = true;
    setDoor('open');
    creak(0.5, true);
    await wait(380);
    slide();
    await fly(from, ui.mouth.getBoundingClientRect(), !!letter.stamp);
    const paid = stampById(letter.stamp)?.sufficient === true;
    if (!paid) {
      // Returned, at speed.
      const kind = letter.stamp ? 'penny' : 'unstamped';
      const slip = composeReturn(kind, s.memory, letter.from, letter.body, s.seed + letter.id);
      setDoor('shut');
      thunk();
      await wait(650);
      setDoor('open');
      slide(true);
      await fly(from, ui.mouth.getBoundingClientRect(), !!letter.stamp, true);
      setDoor('shut');
      letter.state = 'returned';
      letter.reply = slip;
      s.memory.returned++;
      s.memory.trust -= 1;
      s.letters.push(letter);
      log(
        kind === 'penny'
          ? 'Reader posted a letter with one cent of postage. Returned, postage due.'
          : 'Reader posted a letter without a stamp. Returned at speed.',
      );
      commit();
      busy = false;
      render();
      showLetter(letter, true);
      return;
    }
    await wait(250);
    setDoor('shut');
    thunk();
    s.letters.push(letter);
    s.memory.name = letter.from.trim() || s.memory.name;
    log('Reader posted a stamped letter. The item accepted it.');
    commit();
    ui.form.reset();
    (ui.form.elements.namedItem('from') as HTMLInputElement).value = letter.from;
    chooseStamp(null);
    busy = false;
    render();
    if (root!.dataset.flagPos === 'up' && flagByReader && !collecting) collecting = setTimeout(collect, 2500);
  }

  // ---------- Replies ----------

  function showLetter(l: StoredLetter, returned: boolean) {
    paste(ui.collage, l.reply ?? '', s.seed + l.id);
    ui.returned.hidden = !returned;
    ui.replyTitle.textContent = returned ? 'Your letter, returned' : 'A reply from Box 1725';
    ui.replyMeta.textContent = returned
      ? `Posted ${clock(l.postedAt)}. Returned the same second.`
      : `Your letter of ${fileDate(l.postedAt)}, answered ${fileDate(l.replyAt ?? l.postedAt)}.`;
    ui.reply.dataset.letter = String(l.id);
    ui.reply.showModal();
  }

  function openReply(l: StoredLetter) {
    setDoor('open');
    creak(0.6, true);
    slide();
    const first = l.state === 'answered';
    l.state = 'read';
    if (first) log('Reader took the reply from the item and lowered the flag.');
    commit();
    showLetter(l, false);
  }

  ui.reply.addEventListener('close', () => {
    setDoor('shut');
    thunk();
    if (!waiting() && root!.dataset.flagPos === 'up' && !flagByReader) {
      setFlag(false);
      clank(0.6);
    }
    const l = s.letters.find((x) => String(x.id) === ui.reply.dataset.letter);
    if (l?.grants && ui.addresseeInput.disabled) {
      syncLock();
      log('Item granted the reader clearance 3 (Addressee).');
      setClearance(3);
      commit();
      document.getElementById('box1725-title')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
    render();
  });

  // ---------- The ledger ----------

  const STATE_LABEL: Record<StoredLetter['state'], string> = {
    inside: 'In the box',
    collected: 'Collected, no reply yet',
    answered: 'Reply waiting',
    read: 'Answered',
    returned: 'Returned',
  };
  function openLedger() {
    ui.ledgerList.replaceChildren();
    for (const l of [...s.letters].reverse()) {
      const li = document.createElement('li');
      const head = document.createElement('span');
      head.textContent = `${fileDate(l.postedAt)} to ${l.to || 'the item'}`;
      const status = document.createElement('span');
      status.textContent = STATE_LABEL[l.state];
      const excerpt = document.createElement('span');
      excerpt.className = 'excerpt';
      excerpt.textContent = l.body.length > 90 ? `${l.body.slice(0, 88)}…` : l.body;
      li.append(head, status, excerpt);
      if (l.state === 'read' || l.state === 'returned') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = l.state === 'returned' ? 'See the slip' : 'Read the reply';
        btn.addEventListener('click', () => {
          ui.ledger.close();
          showLetter(l, l.state === 'returned');
        });
        li.append(btn);
      }
      ui.ledgerList.append(li);
    }
    ui.ledger.showModal();
  }

  // ---------- Controls ----------

  ui.door.addEventListener('click', () => {
    const reply = waiting();
    if (reply) openReply(reply);
    else openDesk();
  });
  ui.flag.addEventListener('click', (e) => {
    e.stopPropagation();
    void flagPressed();
  });
  for (const [el, fn] of [
    [ui.door, () => ui.door.dispatchEvent(new MouseEvent('click'))],
    [ui.flag, () => void flagPressed()],
  ] as const) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fn();
      }
    });
  }
  ui.write.addEventListener('click', openDesk);
  ui.ledgerBtn.addEventListener('click', openLedger);
  ui.sound.addEventListener('click', () => {
    s.sound = !s.sound;
    setSound(s.sound);
    ui.sound.setAttribute('aria-pressed', String(s.sound));
    commit();
  });

  document.addEventListener('visibilitychange', render);

  // ---------- Start ----------

  armAudio();
  setSound(s.sound);
  ui.sound.setAttribute('aria-pressed', String(s.sound));
  syncLock();
  setClearance(s.clearance);
  if (waiting()) setFlag(true);
  for (const b of [ui.write, ui.sound]) b.disabled = false;
  tick();
  setInterval(tick, SECOND);
  idleTimer = setTimeout(idle, IDLE_MS);
}
