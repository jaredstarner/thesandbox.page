// Pages that need no feed: the index, the help page, the quiz, riddles, and
// the gallery.

import { A, G, CONCEAL, DOUBLE, FLASH, NEW_BG, SEPARATE, Page, fit, wrap } from './_page';
import { band, bigText, counter, fastext, para } from './_layout';
import type { Service } from './_service';
import { store } from './_feeds';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The directory on the index, in two columns. */
const DIRECTORY: [string, number][][] = [
  [
    ['News', 101],
    ['On this day', 120],
    ['Featured', 130],
    ['Did you know', 140],
    ['Money', 200],
    ['Currency charts', 201],
    ['How to use', 199],
  ],
  [
    ['Weather map', 400],
    ['US cities', 401],
    ['World cities', 402],
    ['Moon and sun', 500],
    ['Earthquakes', 600],
    ['Quiz', 700],
    ['Gallery', 800],
  ],
];

function indexPage(): Page {
  const p = new Page();
  // Masthead: the name in block letters on a blue band, between two rules.
  for (let r = 1; r <= 6; r++) p.put(r, 0, G.blue, NEW_BG, G.yellow);
  const logo = bigText('TELEPAGE', 2, 1);
  const cols = Math.ceil(logo.w / 2);
  const left = 3 + Math.floor((37 - cols) / 2);
  p.mosaic(1, left, cols, 6, (x, y) => logo.lit(x, y - 2));
  p.put(7, 0, G.red, Array(39).fill(0x23));
  const now = new Date();
  const date = `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
  p.put(8, 0, A.cyan, fit(date, 24), A.white, fit('Pages 100-899', 14, 'right'));

  DIRECTORY.forEach((column, ci) => {
    column.forEach(([name, n], ri) => {
      p.put(10 + ri, ci * 20, A.white, fit(name, 15), A.yellow, String(n));
    });
  });

  // The top story, when the newsroom has one.
  p.put(18, 0, G.red, SEPARATE, Array(39).fill(0x23));
  const top = store.news[0];
  if (top) {
    p.put(19, 0, A.red, 'TOP STORY', A.yellow, fit('101', 28, 'right'));
    const lines = wrap(top.headline, 38).slice(0, 3);
    lines.forEach((l, i) => p.put(20 + i, 0, A.white, l));
  } else {
    p.put(19, 0, A.red, 'TOP STORY');
    p.put(20, 0, A.white, store.wiki === 'error' ? 'News is off the air for now.' : 'Waiting for the newsroom...');
  }
  fastext(p, ['News', 'Weather', 'Quiz', 'Help']);
  return p;
}

function helpPages(): Page[] {
  const b = { title: 'How to use', bg: 'white', fg: 'blue', rule: 'cyan' } as const;
  const one = new Page();
  band(one, b);
  let r = 5;
  r = para(one, r, 'Key any three-digit page number on the remote or the keyboard.', 'yellow');
  r = para(one, r + 1, 'Pages go out one after another, round and round. The set waits for yours to come by: watch the counter roll in the top row.');
  r = para(one, r + 1, 'Some pages have several parts that turn over on their own. The counter at the bottom right says which part you are on.');
  r = para(one, r + 1, 'Every page number you see on screen can be clicked or tapped.');
  counter(one, 0, 2);
  fastext(one, ['Index', 'News', 'Weather', 'Quiz']);

  const two = new Page();
  band(two, b);
  const keys: [string, string, string][] = [
    ['Coloured keys', 'R G Y C', 'go straight to the pages named along the bottom row'],
    ['Reveal', '? or V', 'shows hidden answers'],
    ['Hold', 'H', 'stops a page turning over'],
    ['Size', 'S', 'doubles the text, top half then bottom half'],
    ['Page', '< >', 'steps to the next or last page'],
    ['Part', 'Up Down', 'steps through the parts of a page'],
    ['Index', 'I', 'back to page 100'],
  ];
  r = 5;
  for (const [name, key, what] of keys) {
    two.put(r, 0, A.yellow, fit(name, 14), A.cyan, key);
    r = para(two, r + 1, what, 'white', 36, 2);
  }
  counter(two, 1, 2);
  fastext(two, ['Index', 'News', 'Weather', 'Quiz']);
  return [one, two];
}

// The quiz: answer with the coloured keys; one wrong answer and it starts
// over, as quizzes on teletext did.
interface Question {
  q: string;
  options: [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
}

const QUESTIONS: Question[] = [
  { q: 'How many colours can a teletext page show, black included?', options: ['Six', 'Eight', 'Sixteen', '256'], answer: 1 },
  { q: 'Which is the capital of Australia?', options: ['Sydney', 'Melbourne', 'Perth', 'Canberra'], answer: 3 },
  { q: 'What is the chemical symbol for tungsten?', options: ['W', 'Tu', 'Tn', 'Ts'], answer: 0 },
  { q: 'How many columns of text fit across a teletext page?', options: ['32', '64', '40', '80'], answer: 2 },
  { q: 'Which is the longest bone in the human body?', options: ['Femur', 'Tibia', 'Humerus', 'Spine'], answer: 0 },
  { q: 'How many minutes are there in a day?', options: ['1,240', '1,440', '1,640', '2,400'], answer: 1 },
  { q: 'How many strings does a violin have?', options: ['Six', 'Five', 'Three', 'Four'], answer: 3 },
  { q: 'Which is the largest ocean?', options: ['Atlantic', 'Indian', 'Pacific', 'Southern'], answer: 2 },
];

const FAST: ('red' | 'green' | 'yellow' | 'cyan')[] = ['red', 'green', 'yellow', 'cyan'];
const QUIZ_BAND = { title: 'Eight to win', bg: 'magenta', fg: 'white', rule: 'yellow' } as const;
export const QUIZ_FIRST = 701;
export const QUIZ_WIN = 701 + QUESTIONS.length;
export const QUIZ_WRONG = 790;

function quizIntro(): Page {
  const p = new Page();
  band(p, QUIZ_BAND);
  let r = para(p, 5, 'Eight questions. Answer each one with the coloured key beside it.', 'yellow');
  r = para(p, r + 1, 'Get one wrong and you go back to the start. Get all eight right and you win.');
  r = para(p, r + 1, 'No prizes. There never were.', 'cyan');
  for (let i = 0; i < 4; i++) p.put(r + 2 + i, 2, G[FAST[i]], 0x7f, 0x7f, A.white, ['Red', 'Green', 'Yellow', 'Cyan'][i] + ' key');
  p.put(22, 0, A.green, 'Press red to begin');
  fastext(p, ['Begin', '', '', 'Index']);
  return p;
}

function question(i: number): Page {
  const q = QUESTIONS[i];
  const p = new Page();
  band(p, { ...QUIZ_BAND, title: `Question ${i + 1}`, tag: `${i + 1} of ${QUESTIONS.length}` });
  let r = para(p, 5, q.q, 'yellow', 38) + 1;
  q.options.forEach((o, k) => {
    p.put(r, 1, G[FAST[k]], 0x7f, 0x7f, A.white, o);
    r += 2;
  });
  fastext(p, q.options);
  return p;
}

function quizLinks(i: number): [number, number, number, number] {
  const q = QUESTIONS[i];
  const next = i + 1 < QUESTIONS.length ? QUIZ_FIRST + i + 1 : QUIZ_WIN;
  return [0, 1, 2, 3].map((k) => (k === q.answer ? next : QUIZ_WRONG)) as [number, number, number, number];
}

function wrongPage(): Page {
  const p = new Page();
  for (let r = 1; r <= 22; r++) p.put(r, 0, G.red, NEW_BG);
  const big = bigText('WRONG', 3, 1);
  const cols = Math.ceil(big.w / 2);
  for (let r = 4; r <= 12; r++) p.put(r, 2, G.white);
  p.mosaic(4, 3 + Math.floor((37 - cols) / 2), cols, 9, (x, y) => big.lit(x, y - 3));
  p.put(16, 2, A.white, DOUBLE, 'Back to the start.');
  p.put(19, 2, A.yellow, 'Question 1 is on page 701.');
  fastext(p, ['Start', '', '', 'Index']);
  return p;
}

function winPage(): Page {
  const p = new Page();
  band(p, { ...QUIZ_BAND, title: 'Full marks' });
  // A cup in one colour: bowl, handles, stem, and a stepped base.
  const cx = 17;
  const lit = (x: number, y: number): boolean => {
    const dx = (x + 0.5 - cx) / 1.16;
    const yy = y + 0.5;
    // Bowl: a half ellipse under a flat rim.
    if (yy >= 2 && yy < 4 && Math.abs(dx) < 9.2) return true;
    if (yy >= 4 && yy < 20) {
      const t = (yy - 4) / 16;
      if (Math.abs(dx) < 8.4 * Math.sqrt(1 - t * t)) return true;
    }
    // Handles: thick ears either side of the bowl.
    for (const side of [-1, 1]) {
      const hx = side * dx - 9;
      const d = Math.hypot(hx, (yy - 8) * 0.55);
      if (hx > 0 && d > 2 && d < 3.9) return true;
    }
    if (yy >= 20 && yy < 28 && Math.abs(dx) < 1.8 + Math.max(0, 21 - yy) * 1.2) return true;
    if (yy >= 28 && yy < 31 && Math.abs(dx) < 6) return true;
    if (yy >= 31 && yy < 35 && Math.abs(dx) < 8.5) return true;
    return false;
  };
  for (let r = 0; r < 13; r++) p.put(5 + r, 0, G.yellow);
  p.mosaic(5, 1, 18, 13, (x, y) => lit(x, y));
  p.put(7, 22, A.yellow, FLASH, DOUBLE, 'WINNER');
  p.put(11, 22, A.white, 'Eight out of');
  p.put(12, 22, A.white, 'eight.');
  p.put(14, 22, A.cyan, 'Try the riddles');
  p.put(15, 22, A.cyan, 'on page 720.');
  fastext(p, ['Again', 'Riddles', '', 'Index']);
  return p;
}

const RIDDLES: [string, string][] = [
  ['What has a face and two hands but no arms or legs?', 'A clock'],
  ['The more you take, the more you leave behind. What are they?', 'Footsteps'],
  ['What gets wetter the more it dries?', 'A towel'],
  ['What can you catch but not throw?', 'A cold'],
  ['What has keys but opens no locks?', 'A piano'],
  ['What goes up but never comes down?', 'Your age'],
];

function riddlePages(): Page[] {
  const groups = [RIDDLES.slice(0, 3), RIDDLES.slice(3)];
  return groups.map((g, gi) => {
    const p = new Page();
    band(p, { title: 'Riddles', bg: 'yellow', fg: 'blue', rule: 'yellow' });
    let r = 5;
    for (const [q, a] of g) {
      r = para(p, r, q, 'yellow');
      p.put(r, 0, A.cyan, 'Answer:', A.white, CONCEAL, a);
      r += 2;
    }
    p.put(22, 0, A.green, 'Press Reveal (? or V) for the answers');
    counter(p, gi, groups.length);
    fastext(p, ['Quiz', '', '', 'Index']);
    return p;
  });
}

function sunsetPage(): Page {
  const p = new Page();
  // Sky bands from blue down to yellow, the sun a striped disc, and the sea
  // below with a broken reflection and flashing glints.
  const sky: (keyof typeof G)[] = ['blue', 'blue', 'blue', 'magenta', 'magenta', 'magenta', 'red', 'red', 'red', 'red', 'yellow', 'yellow'];
  const horizon = 1 + sky.length;
  const sunCx = 40;
  const sunCy = (horizon - 1) * 3 + 1;
  const sunR = 13;
  for (let i = 0; i < sky.length; i++) {
    const r = 1 + i;
    const bg = sky[i];
    const next = sky[i + 1];
    // Where one band meets the next, dither the next colour in, unless the
    // sun is in the way.
    const sunRow = (i + 1) * 3 > sunCy - sunR;
    if (next && next !== bg && !sunRow) {
      p.put(r, 0, G[bg], NEW_BG, G[next]);
      p.put(r, 3, SEPARATE);
      p.mosaic(r, 4, 36, 1, (x, y) => (y === 2 ? true : y === 1 ? (x + i) % 2 === 0 : (x + i) % 4 === 0));
      continue;
    }
    const fg = bg === 'yellow' ? 'red' : 'yellow';
    p.put(r, 0, G[bg], NEW_BG, G[fg]);
    p.mosaic(r, 3, 37, 1, (x, y) => {
      const gx = x + 6;
      const gy = i * 3 + y;
      const dx = (gx - sunCx) / 1.16;
      const dy = gy - sunCy;
      if (dx * dx + dy * dy > sunR * sunR) return false;
      // Slots cut across the lower half, widening toward the horizon.
      const below = gy - (sunCy - sunR * 0.55);
      return !(below > 0 && y === 2 - (Math.floor(gy / 3) % 2) && below > 2 - i * 0.1);
    });
  }
  // The sea: the sun's path in broken dashes that narrow and thin with
  // distance, and white glints that flash.
  for (let r = horizon; r <= 22; r++) {
    const depth = r - horizon;
    p.put(r, 0, G.blue, NEW_BG, G.yellow);
    p.mosaic(r, 3, 37, 1, (x, y) => {
      const gx = x + 6;
      const half = 15 - depth * 1.2 + (depth % 2) * 2;
      if (y === 1 || Math.abs(gx - sunCx) > half) return false;
      return (gx * 5 + r * 3 + y * 7) % 9 > 1;
    });
    const g = (r * 13 + 5) % 33;
    if (depth > 0 && (g < 10 || g > 26)) p.put(r, 3 + g, G.white, FLASH, 0x23 | 0x40, G.yellow, 0x09);
  }
  p.put(23, 0, A.yellow, 'Sunset', A.white, 'in block graphics');
  counter(p, 0, 1);
  fastext(p, ['Test card', '', '', 'Index']);
  return p;
}

function testCard(): Page {
  const p = new Page();
  const bars: (keyof typeof G)[] = ['white', 'yellow', 'cyan', 'green', 'magenta', 'red', 'blue'];
  const widths = [6, 6, 6, 5, 5, 5, 6];
  for (let r = 1; r <= 9; r++) {
    let col = 0;
    bars.forEach((b, i) => {
      p.put(r, col, G[b], NEW_BG);
      col += widths[i];
    });
  }
  // The time, big, in block letters.
  const now = new Date();
  const t = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const big = bigText(t, 2, 1);
  const cols = Math.ceil(big.w / 2);
  for (let r = 11; r <= 15; r++) p.put(r, 0, G.white);
  p.mosaic(11, 1 + Math.floor((39 - cols) / 2), cols, 5, (x, y) => big.lit(x, y - 1));
  p.put(19, 0, A.yellow, fit('TELEPAGE', 19), A.white, fit(`${DAYS[now.getDay()].slice(0, 3)} ${now.getDate()} ${MONTHS[now.getMonth()].slice(0, 3)}`, 19, 'right'));
  p.put(21, 0, A.cyan, 'Every colour a teletext set can show.');
  counter(p, 0, 1);
  fastext(p, ['Sunset', '', '', 'Index']);
  return p;
}

export function addStatic(s: Service): void {
  s.add(100, { build: () => [indexPage()], links: [101, 400, 700, 199] });
  s.add(199, { build: helpPages, links: [100, 101, 400, 700] });
  s.add(700, { build: () => [quizIntro()], links: [QUIZ_FIRST, 0, 0, 100] });
  QUESTIONS.forEach((_, i) => s.add(QUIZ_FIRST + i, { build: () => [question(i)], links: quizLinks(i) }));
  s.add(QUIZ_WIN, { build: () => [winPage()], links: [QUIZ_FIRST, 720, 0, 100] });
  s.add(QUIZ_WRONG, { build: () => [wrongPage()], links: [QUIZ_FIRST, 0, 0, 100] });
  s.add(720, { build: riddlePages, links: [700, 0, 0, 100] });
  s.add(800, { build: () => [sunsetPage()], links: [801, 0, 0, 100] });
  s.add(801, { build: () => [testCard()], links: [800, 0, 0, 100], live: true });
}
