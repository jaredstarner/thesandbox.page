// Faults a compositor can set: a sort turned upside down, two sorts that trade
// places, one doubled or dropped, one from the wrong fount (here, the italic
// case), and a literal, one letter mistaken for a neighbour in the case.

import type { Word } from './_layout';

export type FaultKind = 'turned' | 'transposed' | 'doubled' | 'dropped' | 'wrong-fount' | 'literal';

export interface Fault {
  el: HTMLElement;
  /** The token as printed correctly, punctuation included. */
  original: string;
  prefix: string;
  core: string;
  suffix: string;
  kind: FaultKind;
  /** The faulty core as markup, and as plain letters for the errata. */
  html: string;
  /** The proofreader's mark for the margin. */
  mark: string;
  found: boolean;
}

const LITERALS: Record<string, string> = { e: 'c', c: 'e', n: 'u', u: 'n', h: 'b', b: 'h', a: 'o', o: 'a', l: 't' };
const TURNABLE = 'aefghkrty';
const ITALIC_SHOWS = 'aefgkhmnpvwz';
const VOWELS = 'aeiou';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

type Rand = () => number;

function pickIndex(rand: Rand, from: number, to: number, ok: (i: number) => boolean): number {
  const opts: number[] = [];
  for (let i = from; i <= to; i++) if (ok(i)) opts.push(i);
  return opts.length ? opts[Math.floor(rand() * opts.length)] : -1;
}

/** Try to set one fault of this kind in a word; null when the word can't take it. */
function setFault(core: string, kind: FaultKind, rand: Rand, vocab: Set<string>): { html: string; mark: string; plain: string } | null {
  const n = core.length;
  const esc = escapeHtml;
  let i: number;
  switch (kind) {
    case 'turned':
      i = pickIndex(rand, 0, n - 1, (k) => TURNABLE.includes(core[k]));
      if (i < 0) return null;
      return {
        html: `${esc(core.slice(0, i))}<span class="tv-turn">${core[i]}</span>${esc(core.slice(i + 1))}`,
        mark: `${core[i]}/`,
        plain: core,
      };
    case 'wrong-fount':
      i = pickIndex(rand, 0, n - 1, (k) => ITALIC_SHOWS.includes(core[k]));
      if (i < 0) return null;
      return {
        html: `${esc(core.slice(0, i))}<span class="tv-wf">${core[i]}</span>${esc(core.slice(i + 1))}`,
        mark: 'wf',
        plain: core,
      };
    case 'transposed': {
      i = pickIndex(rand, 1, n - 3, (k) => core[k] !== core[k + 1]);
      if (i < 0) return null;
      const s = core.slice(0, i) + core[i + 1] + core[i] + core.slice(i + 2);
      if (vocab.has(s)) return null;
      return { html: esc(s), mark: 'tr', plain: s };
    }
    case 'doubled': {
      i = pickIndex(
        rand,
        1,
        n - 2,
        (k) => !VOWELS.includes(core[k]) && core[k] !== core[k - 1] && core[k] !== core[k + 1] && core[k] !== 'h',
      );
      if (i < 0) return null;
      const s = core.slice(0, i + 1) + core[i] + core.slice(i + 1);
      if (vocab.has(s)) return null;
      return { html: esc(s), mark: 'δ', plain: s };
    }
    case 'dropped': {
      i = pickIndex(rand, 1, n - 2, (k) => core[k] !== core[k - 1] && core[k] !== core[k + 1]);
      if (i < 0) return null;
      const s = core.slice(0, i) + core.slice(i + 1);
      if (vocab.has(s)) return null;
      return { html: esc(s), mark: `‸${core[i]}`, plain: s };
    }
    case 'literal': {
      i = pickIndex(rand, 1, n - 1, (k) => core[k] in LITERALS);
      if (i < 0) return null;
      const s = core.slice(0, i) + LITERALS[core[i]] + core.slice(i + 1);
      if (vocab.has(s)) return null;
      return { html: esc(s), mark: `${core[i]}/`, plain: s };
    }
  }
}

const KINDS: FaultKind[] = ['turned', 'transposed', 'doubled', 'dropped', 'wrong-fount', 'literal'];

/**
 * Choose and set this impression's faults: `perLeaf` on each leaf of running
 * text, spread out, of every kind in turn.
 */
export function setFaults(words: Word[], perLeaf: number, rand: Rand): Fault[] {
  const vocab = new Set<string>();
  for (const w of words) {
    const m = /[a-z]+/i.exec(w.el.textContent ?? '');
    if (m) vocab.add(m[0].toLowerCase());
  }
  const byLeaf = new Map<number, number[]>();
  words.forEach((w, i) => {
    if (!w.body) return;
    const token = w.el.textContent ?? '';
    if (!/^[^a-z]*[a-z]{4,}[^a-z]*$/.test(token)) return;
    if (!byLeaf.has(w.leaf)) byLeaf.set(w.leaf, []);
    byLeaf.get(w.leaf)?.push(i);
  });

  const kinds = [...KINDS].sort(() => rand() - 0.5);
  let k = 0;
  const faults: Fault[] = [];
  for (const [, idxs] of [...byLeaf.entries()].sort((a, b) => a[0] - b[0])) {
    // Split the leaf into equal stretches and set one fault in each.
    const chosen: number[] = [];
    for (let s = 0; s < perLeaf; s++) {
      const from = Math.floor((s / perLeaf) * idxs.length);
      const to = Math.floor(((s + 1) / perLeaf) * idxs.length);
      const pool = idxs.slice(from + 2, Math.max(from + 3, to - 2));
      for (let tries = 0; tries < 40 && pool.length; tries++) {
        const wi = pool[Math.floor(rand() * pool.length)];
        if (chosen.includes(wi)) continue;
        const el = words[wi].el;
        const token = el.textContent ?? '';
        const m = /^([^a-z]*)([a-z]+)([^a-z]*)$/.exec(token);
        if (!m) continue;
        const kind = kinds[k % kinds.length];
        const set = setFault(m[2], kind, rand, vocab);
        if (!set) continue;
        chosen.push(wi);
        k++;
        faults.push({
          el,
          original: token,
          prefix: m[1],
          core: m[2],
          suffix: m[3],
          kind,
          html: set.html,
          mark: set.mark,
          found: false,
        });
        break;
      }
    }
  }
  for (const f of faults) f.el.innerHTML = escapeHtml(f.prefix) + f.html + escapeHtml(f.suffix);
  return faults;
}

/** Put a word back as it should have been printed. */
export function mend(f: Fault): void {
  f.el.textContent = f.original;
}

/** A small seeded generator, so an impression can be reproduced from its number. */
export function mulberry(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
