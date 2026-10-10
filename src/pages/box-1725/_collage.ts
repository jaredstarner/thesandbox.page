// Cut-out lettering: a reply is pasted together from scraps of the mail the
// item has kept. Each scrap gets a typeface, paper, and ink from a stack of
// circulars, bills, and seed packets, a ragged clip-path for scissor edges,
// and a slight tilt. Words in {braces} were cut from the reader's own letter,
// so they come back in the reader's handwriting on ruled paper.

import { hash, rng, type Rand } from './_grammar';

interface Paper {
  font: string;
  size: number;
  bg: string;
  ink: string;
  weight?: number;
  italic?: boolean;
  upper?: boolean;
}

const HEADLINE = 'var(--font-box-headline), Georgia, serif';
const TYPE = 'var(--font-box-type), "Courier New", monospace';

const PAPERS: Paper[] = [
  { font: HEADLINE, size: 1.5, bg: '#ffffff', ink: '#111111' },
  { font: 'Georgia, "Times New Roman", serif', size: 1.1, bg: '#f1e9d4', ink: '#222222', italic: true },
  { font: 'Impact, Haettenschweiler, "Arial Narrow", sans-serif', size: 1.4, bg: '#ffde3a', ink: '#111111', upper: true },
  { font: '"Arial Black", "Helvetica Neue", Arial, sans-serif', size: 1.15, bg: '#d42a20', ink: '#ffffff', weight: 900, upper: true },
  { font: '"Times New Roman", Times, serif', size: 1.3, bg: '#ffffff', ink: '#1a1a1a' },
  { font: '"Courier New", Courier, monospace', size: 1.05, bg: '#e6eef6', ink: '#1f2f5c' },
  { font: 'Verdana, Geneva, sans-serif', size: 0.95, bg: '#ffe0e6', ink: '#a3122a' },
  { font: HEADLINE, size: 1.9, bg: '#151515', ink: '#f3ecdc' },
  { font: '"Trebuchet MS", "Segoe UI", sans-serif', size: 1.15, bg: '#c4e5cc', ink: '#1d4d2b', weight: 700 },
  { font: 'Palatino, "Palatino Linotype", "Book Antiqua", serif', size: 1.3, bg: '#f8f0dc', ink: '#5a2d0c', italic: true },
  { font: TYPE, size: 1.1, bg: '#fffdf6', ink: '#222222' },
  { font: '"Franklin Gothic Medium", "Arial Narrow", Arial, sans-serif', size: 1.3, bg: '#2f4f7f', ink: '#ffffff', upper: true },
  { font: HEADLINE, size: 1.25, bg: '#f6d7a8', ink: '#7a1f12' },
];

const HAND: Paper = { font: 'var(--font-box-hand), cursive', size: 1.75, bg: '#fdfbf4', ink: '#1f2f5c' };

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

// A rectangle with scissor-cut edges: jittered corners and a nick on each side.
function ragged(rand: Rand): string {
  const j = (max: number) => rand() * max;
  const pts = [
    [j(5), j(8)],
    [40 + j(20), j(6)],
    [100 - j(5), j(8)],
    [100 - j(3), 40 + j(20)],
    [100 - j(5), 100 - j(8)],
    [40 + j(20), 100 - j(6)],
    [j(5), 100 - j(8)],
    [j(3), 40 + j(20)],
  ];
  return `polygon(${pts.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(', ')})`;
}

function scrap(text: string, paper: Paper, rand: Rand, hand: boolean): HTMLElement {
  const outer = document.createElement('span');
  outer.className = hand ? 'scrap kept' : 'scrap';
  outer.style.setProperty('--r', `${((rand() - 0.5) * (hand ? 4 : 8)).toFixed(1)}deg`);
  outer.style.setProperty('--y', `${((rand() - 0.5) * 5).toFixed(1)}px`);
  const inner = document.createElement('span');
  const upper = paper.upper || (!hand && rand() < 0.22);
  inner.textContent = upper ? text.toUpperCase() : text;
  inner.style.setProperty('--clip', ragged(rand));
  inner.style.fontFamily = paper.font;
  inner.style.fontSize = `${(paper.size * (0.9 + rand() * 0.25)).toFixed(2)}em`;
  inner.style.fontWeight = String(paper.weight ?? 400);
  inner.style.fontStyle = paper.italic ? 'italic' : 'normal';
  inner.style.color = paper.ink;
  inner.style.background = hand
    ? `repeating-linear-gradient(transparent 0 0.95em, #8fb0d466 0.95em calc(0.95em + 1px)), ${paper.bg}`
    : paper.bg;
  outer.append(inner);
  return outer;
}

/** Paste `text` into `el` as cut-out scraps. Blank lines become gaps. */
export function paste(el: HTMLElement, text: string, seed = hash(text)): void {
  const rand = rng(seed);
  el.replaceChildren();

  const plain = document.createElement('p');
  plain.className = 'sr';
  plain.textContent = text.replace(/[{}]/g, '');
  const board = document.createElement('div');
  board.className = 'board';
  board.setAttribute('aria-hidden', 'true');
  board.style.display = 'contents';
  el.append(plain, board);

  let last = -1;
  const nextPaper = () => {
    let i = Math.floor(rand() * PAPERS.length);
    if (i === last) i = (i + 1) % PAPERS.length;
    last = i;
    return PAPERS[i];
  };

  const blocks = text.split(/\n+/);
  blocks.forEach((block, b) => {
    if (b > 0) {
      const gap = document.createElement('span');
      gap.className = 'gap';
      board.append(gap);
    }
    const tokens = block.split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length) {
      const kept = tokens[i].match(/^\{([^}]+)\}(.*)$/);
      if (kept) {
        board.append(scrap(kept[1] + kept[2], HAND, rand, true));
        i++;
        continue;
      }
      const r = rand();
      let n = r < 0.58 ? 1 : r < 0.9 ? 2 : 3;
      let j = i;
      while (j < tokens.length && j < i + n && !tokens[j].startsWith('{')) j++;
      n = Math.max(1, j - i);
      board.append(scrap(tokens.slice(i, i + n).join(' '), nextPaper(), rand, false));
      i += n;
    }
  });
}
