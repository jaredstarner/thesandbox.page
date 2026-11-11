// The sound changes a lineage can go through: a catalogue of the regular, conditioned
// changes the comparative method finds again and again (lenition between vowels, final
// devoicing, palatalization before front vowels, loss of unstressed vowels, and so on).
// Each rule rewrites every word at once, so a change is regular: it applies wherever its
// conditions hold.

import {
  cons,
  consSymbol,
  isCons,
  isFront,
  isObstruent,
  isVowel,
  nuclei,
  sonority,
  stressedIndex,
  vowel,
  withVowel,
  type StressRule,
  type Word,
} from './_phon';

export interface Rule {
  id: string;
  weight: number;
  /** A short statement of the change, written from the segments it touched. */
  describe(pairs: Map<string, string>): string;
  apply(w: Word, stress: StressRule): Word;
  /** A stress shift: the rule's apply is the identity and the lineage's stress rule changes. */
  stress?: StressRule;
  /** Rules that only make sense after others (by id), so drift reads in a plausible order. */
  after?: string[];
}

type Env = { w: Word; i: number; stress: number };
type Out = string | null | string[];

/** Rewrite each segment from the original word, so every change is simultaneous. */
function rewrite(w: Word, stress: StressRule, f: (s: string, e: Env) => Out | undefined): Word {
  const st = stressedIndex(w, stress);
  const out: Word = [];
  for (let i = 0; i < w.length; i++) {
    const r = f(w[i], { w, i, stress: st });
    if (r === undefined) out.push(w[i]);
    else if (r === null) continue;
    else if (Array.isArray(r)) out.push(...r);
    else out.push(r);
  }
  return out;
}

const V = isVowel;
const between = (e: Env) => V(e.w[e.i - 1]) && V(e.w[e.i + 1]);
const final = (e: Env) => e.i === e.w.length - 1;
const initial = (e: Env) => e.i === 0;
const beforeCons = (e: Env) => isCons(e.w[e.i + 1]);

function voiced(s: string): string | null {
  const c = cons(s);
  if (!c || c.voice || c.place === 'glot') return null;
  return consSymbol({ ...c, voice: true });
}

function devoiced(s: string): string | null {
  const c = cons(s);
  if (!c || !c.voice || !isObstruent(s)) return null;
  return consSymbol({ ...c, voice: false });
}

/** "p t k became b d g" from the pairs a rule produced. */
function listChange(pairs: Map<string, string>, where: string): string {
  const from: string[] = [];
  const to: string[] = [];
  for (const [a, b] of pairs) {
    from.push(a);
    to.push(b || '∅');
  }
  if (!from.length) return where;
  // One target for all: "a e o → ə", not "a e o → ə ə ə".
  const target = to.every((x) => x === to[0]) ? to[0] : to.join(' ');
  return `${from.join(' ')} → ${target} ${where}`.trim();
}

const simple = (id: string, weight: number, where: string, f: Rule['apply'], after?: string[]): Rule => ({
  id,
  weight,
  describe: (p) => listChange(p, where),
  apply: f,
  after,
});

export const RULES: Rule[] = [
  simple('voice-between-vowels', 9, 'between vowels', (w, s) =>
    rewrite(w, s, (x, e) => {
      if (!between(e)) return;
      const c = cons(x);
      if (!c || !isObstruent(x) || c.manner === 'fric') return;
      return voiced(x) ?? undefined;
    }),
  ),
  simple(
    'spirantize-between-vowels',
    6,
    'between vowels',
    (w, s) =>
      rewrite(w, s, (x, e) => {
        if (!between(e)) return;
        const c = cons(x);
        if (!c || c.manner !== 'stop' || !c.voice || c.round) return;
        const place = c.place === 'alv' ? 'dent' : c.place;
        return consSymbol({ place, manner: 'fric', voice: true }) ?? undefined;
      }),
    ['voice-between-vowels'],
  ),
  simple(
    'lose-weak-fricatives',
    4,
    'are lost between vowels',
    (w, s) => rewrite(w, s, (x, e) => (between(e) && (x === 'ɣ' || x === 'ð') ? null : undefined)),
    ['spirantize-between-vowels'],
  ),
  simple('labial-fricatives', 3, '', (w, s) =>
    rewrite(w, s, (x) => (x === 'β' ? 'v' : x === 'ɸ' ? 'f' : undefined)),
  ),
  simple('final-devoicing', 7, 'at the end of a word', (w, s) =>
    rewrite(w, s, (x, e) => (final(e) ? (devoiced(x) ?? undefined) : undefined)),
  ),
  simple('palatalize-velars', 9, 'before front vowels', (w, s) =>
    rewrite(w, s, (x, e) => {
      if (!isFront(e.w[e.i + 1])) return;
      if (x === 'k') return 'tʃ';
      if (x === 'g') return 'dʒ';
      if (x === 'x') return 'ʃ';
    }),
  ),
  simple('assibilate-dentals', 5, 'before i and y', (w, s) =>
    rewrite(w, s, (x, e) => {
      const n = e.w[e.i + 1];
      if (n !== 'i' && n !== 'iː' && n !== 'j') return;
      if (x === 't') return 'ts';
      if (x === 'd') return 'dz';
    }),
  ),
  simple('deaffricate', 5, '', (w, s) =>
    rewrite(w, s, (x) => {
      if (x === 'tʃ') return 'ʃ';
      if (x === 'dʒ') return 'ʒ';
      if (x === 'ts') return 's';
      if (x === 'dz') return 'z';
    }),
  ),
  simple('apocope', 8, 'unstressed, at the end of a word', (w, s) => {
    const n = nuclei(w);
    if (n.length < 2) return w;
    const last = w.length - 1;
    if (!V(w[last]) || stressedIndex(w, s) === last) return w;
    // Only when what is left ends in a cluster a speaker could say: falling sonority.
    const a = w[last - 1];
    const b = w[last - 2];
    if (isCons(a) && isCons(b) && sonority(b) <= sonority(a)) return w;
    if (isCons(a) && isCons(b) && isCons(w[last - 3])) return w;
    return w.slice(0, last);
  }),
  simple('reduce-unstressed', 6, 'unstressed', (w, s) =>
    rewrite(w, s, (x, e) => {
      const v = vowel(x);
      if (!v || e.i === e.stress || v.long || x === 'ə') return;
      if (v.height === 3 && e.i !== e.w.length - 1) return;
      return 'ə';
    }),
  ),
  simple(
    'lose-final-schwa',
    5,
    'at the end of a word',
    (w, s) => {
      if (w[w.length - 1] !== 'ə' || nuclei(w).length < 2 || isCons(w[w.length - 3])) return w;
      return w.slice(0, -1);
    },
    ['reduce-unstressed'],
  ),
  simple('syncope', 5, 'unstressed, between single consonants', (w, s) => {
    const n = nuclei(w);
    if (n.length < 3) return w;
    const st = stressedIndex(w, s);
    for (let k = 1; k < n.length - 1; k++) {
      const i = n[k];
      if (i === st) continue;
      if (isCons(w[i - 1]) && isCons(w[i + 1]) && V(w[i - 2]) && V(w[i + 2])) {
        return [...w.slice(0, i), ...w.slice(i + 1)];
      }
    }
    return w;
  }),
  simple('lose-h', 6, '', (w, s) => {
    const out = rewrite(w, s, (x) => (x === 'h' ? null : undefined));
    return out.some(V) ? out : w;
  }),
  simple('lose-glottal-stop', 4, '', (w, s) => rewrite(w, s, (x) => (x === 'ʔ' ? null : undefined))),
  simple('s-to-h', 4, 'before a vowel', (w, s) =>
    rewrite(w, s, (x, e) => (x === 's' && V(e.w[e.i + 1]) && (initial(e) || V(e.w[e.i - 1])) ? 'h' : undefined)),
  ),
  simple('rhotacism', 4, 'between vowels', (w, s) =>
    rewrite(w, s, (x, e) => ((x === 'z' || x === 's') && between(e) ? 'r' : undefined)),
  ),
  simple('nasal-assimilation', 5, 'before labials and velars', (w, s) =>
    rewrite(w, s, (x, e) => {
      if (x !== 'n') return;
      const c = cons(e.w[e.i + 1]);
      if (!c) return;
      if (c.place === 'lab' || c.place === 'labdent') return 'm';
      if (c.place === 'vel') return 'ŋ';
    }),
  ),
  simple('lose-final-stops', 5, 'at the end of a word', (w, s) => {
    const last = w.length - 1;
    const c = cons(w[last]);
    if (!c || c.manner !== 'stop' || nuclei(w).length < 1 || w.length < 3) return w;
    return w.slice(0, last);
  }),
  simple('glottalize-final-stops', 3, 'at the end of a word', (w, s) =>
    rewrite(w, s, (x, e) => {
      const c = cons(x);
      return final(e) && c && c.manner === 'stop' && !c.voice && x !== 'ʔ' ? 'ʔ' : undefined;
    }),
  ),
  simple('degeminate', 4, 'doubled consonants are made single', (w) => {
    const out: Word = [];
    for (const x of w) if (!(isCons(x) && out[out.length - 1] === x)) out.push(x);
    return out;
  }),
  simple('raise-long-vowels', 4, 'long vowels rise', (w, s) =>
    rewrite(w, s, (x) => {
      const v = vowel(x);
      if (!v || !v.long) return;
      if (v.height === 3) return v.back === 0 ? ['a', 'j'] : v.back === 2 ? ['a', 'w'] : undefined;
      if (v.height === 0) return withVowel(x, { height: 1, back: 2, round: true });
      return withVowel(x, { height: (v.height + 1) as 2 | 3 });
    }),
  ),
  simple('raise-unstressed-mid', 4, 'unstressed', (w, s) =>
    rewrite(w, s, (x, e) => {
      const v = vowel(x);
      if (!v || e.i === e.stress || v.height !== 2 || v.back === 1) return;
      return withVowel(x, { height: 3 });
    }),
  ),
  simple('lower-in-closed-syllables', 4, 'before two consonants or at the end', (w, s) =>
    rewrite(w, s, (x, e) => {
      const v = vowel(x);
      if (!v || v.height !== 3 || v.back === 1 || v.long) return;
      const closed = isCons(e.w[e.i + 1]) && (isCons(e.w[e.i + 2]) || e.i + 2 === e.w.length);
      return closed ? withVowel(x, { height: 2 }) : undefined;
    }),
  ),
  simple('monophthongize', 6, 'ai and au become long e and o', (w) => {
    const out: Word = [];
    for (let i = 0; i < w.length; i++) {
      const v = vowel(w[i]);
      const g = w[i + 1];
      if (v && !v.long && (g === 'j' || g === 'w') && !V(w[i + 2])) {
        if (g === 'j') out.push(v.height === 0 ? 'eː' : v.back === 0 ? 'iː' : 'eː');
        else out.push(v.height === 0 ? 'oː' : v.back === 2 ? 'uː' : 'oː');
        i++;
      } else out.push(w[i]);
    }
    return out;
  }),
  simple('break-stressed-mid', 4, 'stressed e and o break into je and we', (w, s) =>
    rewrite(w, s, (x, e) => {
      if (e.i !== e.stress) return;
      if (x === 'e' || x === 'ɛ') return ['j', 'e'];
      if (x === 'o' || x === 'ɔ') return ['w', 'e'];
    }),
  ),
  simple('stops-to-fricatives', 5, 'except after s', (w, s) =>
    rewrite(w, s, (x, e) => {
      if (e.w[e.i - 1] === 's' || isObstruent(e.w[e.i - 1])) return;
      if (x === 'p') return 'f';
      if (x === 't') return 'θ';
      if (x === 'k') return 'x';
      if (x === 'kʷ') return 'w';
    }),
  ),
  simple('x-to-h', 4, '', (w, s) => rewrite(w, s, (x) => (x === 'x' ? 'h' : x === 'χ' ? 'h' : undefined))),
  simple('w-to-v', 4, 'except after consonants', (w, s) =>
    rewrite(w, s, (x, e) => (x === 'w' && !isCons(e.w[e.i - 1]) && V(e.w[e.i + 1]) ? 'v' : undefined)),
  ),
  simple('harden-initial-j', 3, 'at the start of a word', (w, s) =>
    rewrite(w, s, (x, e) => (x === 'j' && initial(e) ? 'dʒ' : undefined)),
  ),
  simple('prothesis', 3, 'a vowel grows before s and a consonant', (w) =>
    w[0] === 's' && isCons(w[1]) ? ['e', ...w] : w,
  ),
  simple('umlaut', 5, 'when i follows in the next syllable', (w, s) =>
    rewrite(w, s, (x, e) => {
      const v = vowel(x);
      if (!v || v.back === 0) return;
      let k = e.i + 1;
      while (k < e.w.length && isCons(e.w[k]) && e.w[k] !== 'j') k++;
      const n = e.w[k];
      if (k === e.i + 1 || !(n === 'i' || n === 'iː' || n === 'j')) return;
      if (v.height === 0) return withVowel(x, { height: 1, back: 0 });
      return withVowel(x, { back: 0 });
    }),
  ),
  simple('nasalize-vowels', 4, 'n and m before a consonant or the end of a word melt into the vowel', (w) => {
    const out: Word = [];
    for (let i = 0; i < w.length; i++) {
      const v = vowel(w[i]);
      const n = w[i + 1];
      if (v && !v.nasal && (n === 'n' || n === 'm') && (i + 2 === w.length || isCons(w[i + 2]))) {
        out.push(withVowel(w[i], { nasal: true }));
        i++;
      } else out.push(w[i]);
    }
    return out;
  }),
  simple('vocalize-l', 3, 'before a consonant or at the end of a word', (w, s) =>
    rewrite(w, s, (x, e) => (x === 'l' && V(e.w[e.i - 1]) && (beforeCons(e) || final(e)) ? 'w' : undefined)),
  ),
  simple('shorten-long-vowels', 4, 'long vowels shorten', (w, s) =>
    rewrite(w, s, (x) => {
      const v = vowel(x);
      return v && v.long ? withVowel(x, { long: false }) : undefined;
    }),
  ),
  simple('compensatory-lengthening', 4, 'before a consonant, lengthening the vowel', (w) => {
    const out: Word = [];
    for (let i = 0; i < w.length; i++) {
      const v = vowel(w[i]);
      const n = w[i + 1];
      if (v && !v.long && (n === 's' || n === 'h') && isCons(w[i + 2])) {
        out.push(withVowel(w[i], { long: true }));
        i++;
      } else out.push(w[i]);
    }
    return out;
  }),
  simple('labiovelars-to-labials', 4, '', (w, s) =>
    rewrite(w, s, (x) => (x === 'kʷ' ? 'p' : x === 'gʷ' ? 'b' : undefined)),
  ),
  simple('delabialize', 3, '', (w, s) => rewrite(w, s, (x) => (x === 'kʷ' ? 'k' : x === 'gʷ' ? 'g' : undefined))),
  simple(
    'front-dental-fricatives',
    3,
    '',
    (w, s) => rewrite(w, s, (x) => (x === 'θ' ? 'f' : x === 'ð' ? 'v' : undefined)),
    ['stops-to-fricatives'],
  ),
  simple(
    'stop-dental-fricatives',
    3,
    '',
    (w, s) => rewrite(w, s, (x) => (x === 'θ' ? 't' : x === 'ð' ? 'd' : undefined)),
    ['stops-to-fricatives'],
  ),
  simple('palatalize-s', 3, 'before i', (w, s) =>
    rewrite(w, s, (x, e) => {
      const n = e.w[e.i + 1];
      return x === 's' && (n === 'i' || n === 'iː' || n === 'j') ? 'ʃ' : undefined;
    }),
  ),
  simple('merge-open-mid', 3, '', (w, s) =>
    rewrite(w, s, (x) => {
      const v = vowel(x);
      return v && v.height === 1 ? withVowel(x, { height: 2 }) : undefined;
    }),
  ),
  simple('front-u', 3, '', (w, s) =>
    rewrite(w, s, (x) => {
      const v = vowel(x);
      return v && v.height === 3 && v.back === 2 ? withVowel(x, { back: 0 }) : undefined;
    }),
  ),
  simple('uvular-r', 2, '', (w, s) => rewrite(w, s, (x) => (x === 'r' ? 'ʁ' : undefined))),
  simple('yod-from-palatals', 3, '', (w, s) => rewrite(w, s, (x) => (x === 'ʎ' ? 'j' : x === 'ɲ' ? 'n' : undefined))),
  simple('uvulars-forward', 3, '', (w, s) => rewrite(w, s, (x) => (x === 'q' ? 'k' : undefined))),
  {
    id: 'stress-to-first',
    weight: 3,
    stress: 'initial',
    describe: () => 'stress moves to the first syllable',
    apply: (w) => w,
  },
];

export const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

/** Which segment changes a rule caused across a lexicon, for its description. */
export function changedPairs(rule: Rule, before: Word[], after: Word[]): Map<string, string> {
  const pairs = new Map<string, string>();
  for (let k = 0; k < before.length; k++) {
    const a = before[k];
    const b = after[k];
    if (a.length === b.length) {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !pairs.has(a[i])) pairs.set(a[i], b[i]);
    } else if (rule.id.startsWith('lose') || rule.id === 'apocope' || rule.id === 'syncope') {
      // A loss: find the first segment that went missing.
      let i = 0;
      while (i < b.length && a[i] === b[i]) i++;
      if (i < a.length && !pairs.has(a[i])) pairs.set(a[i], '');
    }
  }
  return pairs;
}
