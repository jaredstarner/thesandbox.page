// The parent language: a sound inventory, syllable shapes, roots for every meaning the
// page needs, the grammatical endings and particles, and a word order. Word shapes follow
// the usual generator recipe: each class lists its sounds in order of preference and is
// sampled with a falling power law, so the first sounds are the commonest.

import { isCons, isVowel, romanStyle, ROMAN_STYLE_COUNT, type Romanization, type StressRule, type Word } from './_phon';
import type { Rng } from './_rng';

export const MEANINGS = [
  // The fable.
  'hill',
  'sheep',
  'wool',
  'horse',
  'wagon',
  'load',
  'man',
  'heart',
  'master',
  'coat',
  'plain',
  'have',
  'see',
  'pull',
  'carry',
  'say',
  'hurt',
  'drive',
  'listen',
  'make',
  'run',
  'heavy',
  'big',
  'warm',
  'quickly',
  'one',
  'I',
  'we',
  'self',
  'this',
  'and',
  'when',
  // More of the basic vocabulary, for comparing.
  'water',
  'fire',
  'mother',
  'father',
  'two',
  'three',
  'sun',
  'moon',
  'star',
  'night',
  'name',
  'tooth',
  'foot',
  'eye',
  'stone',
  'tree',
  'bird',
  'dog',
  'fish',
  'mouth',
  'people',
] as const;

export type Meaning = (typeof MEANINGS)[number];

/** Short words: grammar words and pronouns are one syllable where the language allows. */
const SHORT = new Set<Meaning>(['I', 'we', 'self', 'this', 'and', 'when', 'one', 'two', 'three']);

/** The basic vocabulary shown in the comparison table, in order. */
export const COMPARE: Meaning[] = [
  'mother',
  'father',
  'water',
  'fire',
  'sun',
  'moon',
  'star',
  'night',
  'stone',
  'tree',
  'bird',
  'dog',
  'fish',
  'horse',
  'sheep',
  'heart',
  'eye',
  'tooth',
  'foot',
  'mouth',
  'name',
  'one',
  'two',
  'three',
];

export const ENGLISH: Record<Meaning, string> = {
  hill: 'hill',
  sheep: 'sheep',
  wool: 'wool',
  horse: 'horse',
  wagon: 'wagon',
  load: 'load',
  man: 'man',
  heart: 'heart',
  master: 'master',
  coat: 'coat',
  plain: 'plain',
  have: 'have',
  see: 'see',
  pull: 'pull',
  carry: 'carry',
  say: 'say',
  hurt: 'hurt',
  drive: 'drive',
  listen: 'listen',
  make: 'make',
  run: 'run',
  heavy: 'heavy',
  big: 'big',
  warm: 'warm',
  quickly: 'quickly',
  one: 'one',
  I: 'I',
  we: 'we',
  self: 'self',
  this: 'this',
  and: 'and',
  when: 'when',
  water: 'water',
  fire: 'fire',
  mother: 'mother',
  father: 'father',
  two: 'two',
  three: 'three',
  sun: 'sun',
  moon: 'moon',
  star: 'star',
  night: 'night',
  name: 'name',
  tooth: 'tooth',
  foot: 'foot',
  eye: 'eye',
  stone: 'stone',
  tree: 'tree',
  bird: 'bird',
  dog: 'dog',
  fish: 'fish',
  mouth: 'mouth',
  people: 'people',
};

/** Grammatical morphemes, glossed with the Leipzig abbreviations. */
export const MORPHS = [
  'PL',
  'ACC',
  'GEN',
  'DAT',
  'ALL',
  'LOC',
  'PST',
  'NEG',
  'REL',
  '1SG.POSS',
  '1PL.POSS',
  'on',
  'to',
  'into',
  'for',
] as const;
export type Morph = (typeof MORPHS)[number];

export interface Grammar {
  order: 'SOV' | 'SVO' | 'VSO';
  adj: 'AN' | 'NA';
  gen: 'GN' | 'NG';
  adpos: 'pre' | 'post';
  rel: 'RN' | 'NR';
  /** Case endings: none, an accusative only, or a fuller set that replaces the adpositions. */
  cases: 'none' | 'acc' | 'full';
  plural: 'suffix' | 'prefix' | 'none';
  past: 'suffix' | 'prefix' | 'particle';
  possessive: 'pronoun' | 'suffix';
  negation: 'particle' | 'suffix';
}

export interface Proto {
  consonants: string[];
  vowels: string[];
  templates: string[];
  stress: StressRule;
  epenthetic: string;
  roots: Record<Meaning, Word>;
  morphs: Record<Morph, Word>;
  grammar: Grammar;
  roman: Romanization;
  romanIndex: number;
  longMark: 'macron' | 'double' | 'acute';
}

// Consonants in rough order of how common they are in the world's languages.
const CONSONANT_ORDER = [
  't',
  'k',
  'n',
  'm',
  's',
  'p',
  'l',
  'r',
  'j',
  'w',
  'h',
  'd',
  'g',
  'b',
  'ŋ',
  'tʃ',
  'ʃ',
  'f',
  'ts',
  'z',
  'ɲ',
  'q',
  'kʷ',
  'x',
  'ʔ',
  'v',
  'θ',
];

const CONSONANT_ODDS: Record<string, number> = {
  t: 1,
  k: 1,
  n: 1,
  m: 1,
  s: 0.95,
  p: 0.92,
  l: 0.85,
  r: 0.75,
  j: 0.82,
  w: 0.75,
  h: 0.55,
  ŋ: 0.3,
  tʃ: 0.3,
  ʃ: 0.33,
  f: 0.28,
  ts: 0.18,
  z: 0.18,
  ɲ: 0.15,
  q: 0.12,
  kʷ: 0.2,
  x: 0.16,
  ʔ: 0.18,
  v: 0.12,
  θ: 0.06,
};

/** Walk a list with a fixed chance of stopping at each item, wrapping round. */
export function powerPick<T>(r: Rng, items: readonly T[], stop = 0.32): T {
  for (let guard = 0; guard < 200; guard++) {
    for (const item of items) if (r() < stop) return item;
  }
  return items[0];
}

function nudge<T>(r: Rng, items: T[], swaps: number): T[] {
  for (let k = 0; k < swaps; k++) {
    const i = r.int(items.length - 1);
    [items[i], items[i + 1]] = [items[i + 1], items[i]];
  }
  return items;
}

function chooseGrammar(r: Rng): Grammar {
  const order = r.weighted(['SOV', 'SVO', 'VSO'] as const, [45, 40, 15]);
  const ov = order === 'SOV';
  return {
    order,
    adj: r.chance(ov ? 0.5 : 0.35) ? 'AN' : 'NA',
    gen: r.chance(ov ? 0.9 : 0.3) ? 'GN' : 'NG',
    adpos: r.chance(ov ? 0.9 : 0.1) ? 'post' : 'pre',
    rel: r.chance(ov ? 0.6 : 0.05) ? 'RN' : 'NR',
    cases: r.weighted(['none', 'acc', 'full'] as const, ov ? [2, 4, 4] : order === 'VSO' ? [4, 3, 3] : [6, 3, 1]),
    plural: r.weighted(['suffix', 'prefix', 'none'] as const, [7, 2, 1]),
    past: r.weighted(['suffix', 'prefix', 'particle'] as const, ov ? [7, 1, 2] : [4, 3, 3]),
    possessive: r.chance(0.45) ? 'suffix' : 'pronoun',
    negation: r.chance(0.75) ? 'particle' : 'suffix',
  };
}

export function makeProto(r: Rng): Proto {
  // Consonants: the core set nearly always, the rest by their world odds.
  const consonants = CONSONANT_ORDER.filter((c) => {
    if (c === 'b' || c === 'd' || c === 'g') return false;
    return r() < (CONSONANT_ODDS[c] ?? 0.2);
  });
  if (r.chance(0.6)) consonants.push('b', 'd', 'g');
  else if (r.chance(0.3)) consonants.push('b', 'd');
  const ordered = nudge(
    r,
    CONSONANT_ORDER.filter((c) => consonants.includes(c)),
    4,
  );

  const vowelSet = r.weighted(
    [
      ['a', 'i', 'u'],
      ['a', 'e', 'i', 'o', 'u'],
      ['a', 'e', 'i', 'o', 'u', 'ə'],
      ['a', 'e', 'i', 'o', 'u', 'ɛ', 'ɔ'],
    ],
    [12, 55, 15, 18],
  );
  const long = r.chance(0.3);
  const vowels = nudge(r, [...vowelSet], 2);
  if (long) vowels.push(...vowelSet.slice(0, 3).map((v) => v + 'ː'));

  const shape = r.weighted(['simple', 'moderate', 'complex'] as const, [3, 5, 2]);
  const templates =
    shape === 'simple'
      ? ['CV', 'CVN', 'V', 'CVC']
      : shape === 'moderate'
        ? ['CV', 'CVC', 'V', 'CRV', 'VC', 'CVN']
        : ['CVC', 'CV', 'CRVC', 'CRV', 'CVCC', 'VC', 'sCV'];
  const stress = r.weighted(['initial', 'penult', 'final'] as const, [4, 5, 2]);

  const nasals = ordered.filter((c) => c === 'n' || c === 'm' || c === 'ŋ');
  const liquids = ordered.filter((c) => c === 'r' || c === 'l' || c === 'w' || c === 'j');
  const stops = ordered.filter((c) => ['p', 't', 'k', 'b', 'd', 'g', 'kʷ'].includes(c));
  const codas = ordered.filter((c) => !['h', 'ʔ', 'w', 'j', 'kʷ'].includes(c) || c === 'ʔ');

  const syllable = (t: string): Word => {
    const out: Word = [];
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      const isCoda = i > 0 && t.slice(0, i).includes('V');
      if (ch === 'C') out.push(powerPick(r, isCoda ? codas : ordered));
      else if (ch === 'V') out.push(powerPick(r, vowels, 0.36));
      else if (ch === 'N') out.push(powerPick(r, nasals.length ? nasals : ['n']));
      else if (ch === 'R') {
        const prev = out[out.length - 1];
        if (!stops.includes(prev)) continue;
        out.push(powerPick(r, liquids.length ? liquids : ['r']));
      } else if (ch === 's') {
        if (consonants.includes('s')) out.push('s');
      }
    }
    return out;
  };

  const tooHard = (w: Word): boolean => {
    for (let i = 0; i < w.length - 1; i++) if (w[i] === w[i + 1]) return true;
    for (let i = 0; i < w.length - 2; i++) if (isCons(w[i]) && isCons(w[i + 1]) && isCons(w[i + 2])) return true;
    for (let i = 0; i < w.length - 1; i++) if (isVowel(w[i]) && isVowel(w[i + 1])) return true;
    return false;
  };

  const used = new Set<string>();
  const makeWord = (syllables: number, keep = true): Word => {
    for (let guard = 0; guard < 400; guard++) {
      let w: Word = [];
      for (let k = 0; k < syllables; k++) w = w.concat(syllable(powerPick(r, templates, 0.4)));
      if (!w.some(isVowel) || tooHard(w) || w.length < 2) continue;
      const key = w.join('');
      if (used.has(key)) continue;
      if (keep) used.add(key);
      return w;
    }
    return ['t', vowels[0], 'k', vowels[1] ?? vowels[0]];
  };

  const roots = {} as Record<Meaning, Word>;
  for (const m of MEANINGS) {
    const syl = SHORT.has(m) ? 1 : r.weighted([1, 2, 3], [3, 6, 1.5]);
    roots[m] = makeWord(syl);
  }

  // Endings: a single syllable, or a lone consonant for the commonest ones.
  const morphs = {} as Record<Morph, Word>;
  const affix = (lone: boolean): Word => {
    for (let guard = 0; guard < 200; guard++) {
      const w = lone && r.chance(0.45) ? [powerPick(r, codas)] : syllable(r.pick(['CV', 'V', 'CV', 'VC']));
      const key = '-' + w.join('');
      if (!w.length || used.has(key)) continue;
      used.add(key);
      return w;
    }
    return [vowels[0]];
  };
  for (const m of MORPHS) {
    if (m === 'on' || m === 'to' || m === 'into' || m === 'for' || m === 'REL') morphs[m] = makeWord(1);
    // Only endings that are never written as words of their own may be a lone consonant.
    else morphs[m] = affix(m === 'PL' || m === 'ACC');
  }

  const romanIndex = r.int(ROMAN_STYLE_COUNT);
  return {
    consonants: ordered,
    vowels,
    templates,
    stress,
    epenthetic: vowels.includes('ə') ? 'ə' : vowels.includes('e') ? 'e' : vowels.includes('i') ? 'i' : 'a',
    roots,
    morphs,
    grammar: chooseGrammar(r),
    roman: romanStyle(romanIndex),
    romanIndex,
    longMark: r.weighted(['macron', 'double', 'acute'] as const, [5, 3, 2]),
  };
}

/** Join a root and its endings, keeping the result sayable: a vowel breaks a cluster
 * of three consonants, and of two vowels meeting, the ending's goes. */
export function compose(proto: Proto, parts: Word[]): Word {
  let out: Word = [];
  for (const part of parts) {
    if (!out.length) {
      out = [...part];
      continue;
    }
    let next = [...part];
    const last = out[out.length - 1];
    if (isVowel(last) && isVowel(next[0])) next = next.slice(1);
    else if (isCons(last) && isCons(next[0]) && (isCons(out[out.length - 2]) || isCons(next[1]) || !next.some(isVowel)))
      next = [proto.epenthetic, ...next];
    out = out.concat(next);
  }
  return out;
}
