// The lost property counter: keeps track of what has been found, answers
// the browser's own find-in-page through beforematch, and answers the
// counter slip for browsers (and phones) where Find can't open the book.

const KEY = 'lost-property:found';

const WORDS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
  'Twenty',
];

/** Words too common to look up: the clerk wants a thing, not a grammar. */
const STOP = new Set(
  'the and was his her for with who not had she him they that this from but have one are all any can did its our out you were when what which into than then them there these some been very also just only'.split(
    ' ',
  ),
);

/** More matches than this and the clerk asks you to be more particular. */
const LIMIT = 20;

function load(): Set<number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(raw)) return new Set(raw.filter((n): n is number => Number.isInteger(n)));
  } catch {
    // Storage may be blocked or hold something unreadable; start blank.
  }
  return new Set();
}

function save(found: Set<number>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...found].sort((a, b) => a - b)));
  } catch {
    // Nowhere to keep it; the book stays open for this visit only.
  }
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ');

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const counted = (n: number, one: string, many: string) =>
  `${n <= 20 ? WORDS[n] : String(n)} ${n === 1 ? one : many}`;

const nos = (list: number[]) => (list.length === 1 ? `No. ${list[0]}` : `Nos. ${list.join(', ')}`);

function start(root: HTMLElement) {
  const bodies = [...root.querySelectorAll<HTMLElement>('.body[data-no]')];
  const total = bodies.length;
  const found = load();
  const slip = root.querySelector<HTMLFormElement>('.slip');
  const input = root.querySelector<HTMLInputElement>('#lp-ask');
  const reply = root.querySelector<HTMLOutputElement>('.s-reply');
  const tally = root.querySelector<HTMLElement>('.s-tally');
  const reset = root.querySelector<HTMLButtonElement>('.s-reset');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  if (!('onbeforematch' in document.documentElement)) root.dataset.nofind = '';

  const index = new Map(bodies.map((b) => [b, normalize(b.textContent ?? '')]));
  const open = new Set(bodies.filter((b) => !b.hasAttribute('hidden')).map((b) => Number(b.dataset.no)));
  for (const n of open) found.add(n);

  const update = () => {
    const n = bodies.filter((b) => !b.hasAttribute('hidden')).length;
    if (n >= total) {
      root.dataset.complete = '';
      tally?.replaceChildren(`Every entry found, all ${total}`);
    } else {
      delete root.dataset.complete;
      const b = document.createElement('b');
      b.className = 's-count';
      b.textContent = String(n);
      tally?.replaceChildren('Found ', b, ` of ${total}`);
    }
  };

  const ink = (body: HTMLElement) => {
    body.classList.remove('fresh');
    // Restart the animation even when the same entry is asked for twice.
    void body.offsetWidth;
    body.classList.add('fresh');
    body.addEventListener('animationend', () => body.classList.remove('fresh'), { once: true });
  };

  const reveal = (body: HTMLElement) => {
    const no = Number(body.dataset.no);
    const wasHidden = body.hasAttribute('hidden');
    found.add(no);
    save(found);
    if (wasHidden) ink(body);
    body.removeAttribute('hidden');
    update();
    return wasHidden;
  };

  // Find in page (and #e-n links) fire beforematch, then remove hidden themselves.
  for (const body of bodies) {
    body.addEventListener('beforematch', () => {
      ink(body);
      found.add(Number(body.dataset.no));
      save(found);
      requestAnimationFrame(update);
    });
  }

  const say = (text: string) => {
    if (reply) reply.textContent = text;
  };

  const ask = (query: string) => {
    let q = normalize(query).trim();
    q = q.replace(/^(an?|the|some|my|a pair of)\s+/, '').replace(/^[^\w£]+|[^\w.]+$/g, '');
    if (q.length < 3 || STOP.has(q)) {
      say('The clerk asks for something more particular.');
      return;
    }
    // Whole words, singular or plural, the way a clerk would look it up.
    const forms = new Set([q, `${q}s`, `${q}es`]);
    if (q.length > 4 && q.endsWith('ies')) forms.add(q.slice(0, -3) + 'y');
    if (q.length > 4 && q.endsWith('es')) forms.add(q.slice(0, -2));
    if (q.length > 3 && q.endsWith('s') && !q.endsWith('ss')) forms.add(q.slice(0, -1));
    if (q.endsWith('y')) forms.add(q.slice(0, -1) + 'ies');
    const pattern = new RegExp(`(^|[^a-z0-9])(${[...forms].map(escape).join('|')})(?![a-z0-9])`);
    const matches = bodies.filter((b) => pattern.test(index.get(b) ?? ''));
    if (matches.length === 0) {
      say('Nothing answering the description.');
      return;
    }
    if (matches.length > LIMIT) {
      say(`${counted(matches.length, 'entry', 'entries')} answer that. The clerk asks you to be more particular.`);
      return;
    }
    const fresh = matches.filter((b) => reveal(b));
    const list = matches.map((b) => Number(b.dataset.no));
    if (fresh.length === 0) {
      say(`Already found: ${nos(list)}.`);
    } else if (fresh.length === matches.length) {
      say(`${counted(fresh.length, 'entry', 'entries')} answering that description: ${nos(list)}.`);
    } else {
      say(`${counted(fresh.length, 'new entry', 'new entries')} of ${WORDS[matches.length].toLowerCase()}: ${nos(list)}.`);
    }
    const first = (fresh[0] ?? matches[0]).closest<HTMLElement>('.row');
    if (first) {
      first.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'center' });
      for (const b of matches) {
        const row = b.closest<HTMLElement>('.row');
        if (!row) continue;
        row.classList.remove('asked');
        void row.offsetWidth;
        row.classList.add('asked');
        row.addEventListener('animationend', () => row.classList.remove('asked'), { once: true });
      }
    }
  };

  slip?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input) ask(input.value);
  });

  let armed = 0;
  reset?.addEventListener('click', () => {
    if (!armed) {
      reset.textContent = 'Start again: sure?';
      armed = window.setTimeout(() => {
        armed = 0;
        reset.textContent = 'Start again';
      }, 3000);
      return;
    }
    window.clearTimeout(armed);
    armed = 0;
    reset.textContent = 'Start again';
    found.clear();
    for (const b of bodies) {
      const no = Number(b.dataset.no);
      if (open.has(no)) found.add(no);
      else b.setAttribute('hidden', 'until-found');
    }
    save(found);
    say('The book is blank again.');
    update();
    window.scrollTo({ top: 0, behavior: reduced.matches ? 'auto' : 'smooth' });
  });

  update();

  // A handle for checks: reveal(no), hide all, read the index.
  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, {
      __lp: {
        ask,
        found: () => [...found].sort((a, b) => a - b),
        shown: () => bodies.filter((b) => !b.hasAttribute('hidden')).map((b) => Number(b.dataset.no)),
        total,
      },
    });
  }
}

const root = document.querySelector<HTMLElement>('.lp');
if (root) start(root);
