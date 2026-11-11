// The text every language on the page is shown in: August Schleicher's fable of the
// sheep and the horses (1868), the first text ever composed in a reconstructed parent
// language, retold here in plain English and encoded as clauses so each language can
// put it in its own word order with its own endings.

import type { Grammar, Meaning, Morph } from './_lang';
import { ENGLISH } from './_lang';

interface NP {
  head: Meaning;
  pl?: boolean;
  adj?: Meaning;
  poss?: 'I' | 'we';
  gen?: NP;
  rel?: Clause;
  app?: NP;
}

type Role = 'on' | 'to' | 'into' | 'for';

interface Clause {
  v: Meaning;
  tense: 'prs' | 'pst' | 'imp';
  neg?: boolean;
  subj?: NP;
  obj?: NP;
  comp?: Clause;
  obls?: { role: Role; np: NP }[];
  adv?: Meaning;
  voc?: NP;
}

interface Unit {
  main: Clause[];
  when?: { clause: Clause; front?: boolean };
  /** A leading "and" joining this sentence to the one before. */
  and?: boolean;
  end: string;
  open?: boolean;
  english: string;
}

const sheep: NP = { head: 'sheep' };
const horses: NP = { head: 'horse', pl: true };

export const FABLE: Unit[] = [
  {
    main: [
      {
        v: 'see',
        tense: 'pst',
        subj: { head: 'sheep', rel: { v: 'have', tense: 'pst', neg: true, obj: { head: 'wool' } } },
        obj: horses,
        obls: [{ role: 'on', np: { head: 'hill' } }],
      },
    ],
    end: '.',
    english: 'On a hill, a sheep that had no wool saw horses.',
  },
  {
    main: [
      { v: 'pull', tense: 'pst', subj: { head: 'one' }, obj: { head: 'wagon', adj: 'heavy' } },
      { v: 'carry', tense: 'pst', subj: { head: 'one' }, obj: { head: 'load', adj: 'big' } },
      { v: 'carry', tense: 'pst', subj: { head: 'one' }, obj: { head: 'man' }, adv: 'quickly' },
    ],
    end: '.',
    english: 'One was pulling a heavy wagon, one was carrying a big load, and one was carrying a man quickly.',
  },
  {
    main: [{ v: 'say', tense: 'pst', subj: sheep, obls: [{ role: 'to', np: horses }] }],
    end: ':',
    english: 'The sheep said to the horses:',
  },
  {
    main: [{ v: 'hurt', tense: 'prs', subj: { head: 'heart', poss: 'I' } }],
    when: {
      clause: { v: 'see', tense: 'prs', subj: { head: 'I' }, comp: { v: 'drive', tense: 'prs', subj: { head: 'man' }, obj: horses } },
    },
    end: '.”',
    open: true,
    english: '“My heart hurts when I see a man driving horses.”',
  },
  {
    main: [{ v: 'say', tense: 'pst', subj: horses }],
    end: ':',
    english: 'The horses said:',
  },
  {
    main: [{ v: 'listen', tense: 'imp', voc: sheep }],
    end: '!',
    open: true,
    english: '“Listen, sheep!',
  },
  {
    main: [{ v: 'hurt', tense: 'prs', subj: { head: 'heart', pl: true, poss: 'we' } }],
    when: { clause: { v: 'see', tense: 'prs', subj: { head: 'we' }, obj: { head: 'this' } } },
    end: ':',
    english: 'Our hearts hurt when we see this:',
  },
  {
    main: [
      {
        v: 'make',
        tense: 'prs',
        subj: { head: 'man', app: { head: 'master' } },
        obj: { head: 'wool', gen: sheep },
        obls: [
          { role: 'into', np: { head: 'coat', adj: 'warm' } },
          { role: 'for', np: { head: 'self' } },
        ],
      },
    ],
    end: ',',
    english: 'a man, the master, makes the sheep’s wool into a warm coat for himself,',
  },
  {
    main: [{ v: 'have', tense: 'prs', neg: true, subj: sheep, obj: { head: 'wool' } }],
    and: true,
    end: '.”',
    english: 'and the sheep has no wool.”',
  },
  {
    main: [{ v: 'run', tense: 'pst', subj: sheep, obls: [{ role: 'into', np: { head: 'plain' } }] }],
    when: { clause: { v: 'listen', tense: 'pst', subj: sheep, obj: { head: 'this' } }, front: true },
    end: '.',
    english: 'When the sheep heard this, it ran off into the plain.',
  },
];

export const FABLE_TITLE = 'The sheep and the horses';

/** One written word: the morphemes it joins, in order, and how to gloss it. */
export interface Token {
  key: string;
  parts: (Meaning | Morph)[];
  gloss: string;
  /** Punctuation after the word. */
  after: string;
  before: string;
}

export interface Sentence {
  tokens: Token[];
  english: string;
}

const CASE: Record<Role, Morph> = { on: 'LOC', to: 'DAT', into: 'ALL', for: 'DAT' };

function glossOf(parts: (Meaning | Morph)[], prefixCount: number): string {
  const word = (p: string) => (ENGLISH as Record<string, string>)[p] ?? p;
  const pre = parts.slice(0, prefixCount).map(word);
  const rest = parts.slice(prefixCount).map(word);
  return [...pre, ...rest].join('-');
}

function token(parts: (Meaning | Morph)[], prefixCount = 0): Token {
  return { key: parts.join('+'), parts, gloss: glossOf(parts, prefixCount), after: '', before: '' };
}

function nounWord(g: Grammar, x: NP, caseMorph: Morph | null): Token {
  const parts: (Meaning | Morph)[] = [];
  let pre = 0;
  if (x.pl && g.plural === 'prefix') {
    parts.push('PL');
    pre = 1;
  }
  parts.push(x.head);
  if (x.pl && g.plural === 'suffix') parts.push('PL');
  if (x.poss && g.possessive === 'suffix') parts.push(x.poss === 'I' ? '1SG.POSS' : '1PL.POSS');
  if (caseMorph) parts.push(caseMorph);
  return token(parts, pre);
}

function adposition(g: Grammar, morph: Morph, np: Token[]): Token[] {
  const word = token([morph]);
  return g.adpos === 'pre' ? [word, ...np] : [...np, word];
}

function nounPhrase(g: Grammar, x: NP, caseMorph: Morph | null): Token[] {
  const head = nounWord(g, x, caseMorph);
  let out: Token[] = [head];
  if (x.adj) {
    const adj = token([x.adj]);
    out = g.adj === 'AN' ? [adj, ...out] : [...out, adj];
  }
  if (x.poss && g.possessive === 'pronoun') {
    const owner = g.cases === 'none' ? adposition(g, 'GEN', [token([x.poss])]) : [token([x.poss, 'GEN'])];
    out = g.gen === 'GN' ? [...owner, ...out] : [...out, ...owner];
  }
  if (x.gen) {
    const owner = g.cases === 'none' ? adposition(g, 'GEN', nounPhrase(g, x.gen, null)) : nounPhrase(g, x.gen, 'GEN');
    out = g.gen === 'GN' ? [...owner, ...out] : [...out, ...owner];
  }
  if (x.rel) {
    const rel = clause(g, x.rel);
    const marker = token(['REL']);
    out = g.rel === 'RN' ? [...rel, marker, ...out] : [...out, marker, ...rel];
  }
  if (x.app) {
    const app = nounPhrase(g, x.app, caseMorph);
    out[out.length - 1].after = ',';
    app[app.length - 1].after = ',';
    out = [...out, ...app];
  }
  return out;
}

function oblique(g: Grammar, role: Role, x: NP): Token[] {
  if (g.cases === 'full') return nounPhrase(g, x, CASE[role]);
  return adposition(g, role, nounPhrase(g, x, null));
}

function verbWords(g: Grammar, c: Clause): Token[] {
  const parts: (Meaning | Morph)[] = [];
  let pre = 0;
  const out: Token[] = [];
  if (c.neg && g.negation === 'particle') out.push(token(['NEG']));
  if (c.tense === 'pst' && g.past === 'particle') out.push(token(['PST']));
  if (c.tense === 'pst' && g.past === 'prefix') {
    parts.push('PST');
    pre = 1;
  }
  parts.push(c.v);
  if (c.tense === 'pst' && g.past === 'suffix') parts.push('PST');
  if (c.neg && g.negation === 'suffix') parts.push('NEG');
  out.push(token(parts, pre));
  return out;
}

function clause(g: Grammar, c: Clause): Token[] {
  const S = c.subj ? nounPhrase(g, c.subj, null) : [];
  const accusative = g.cases === 'none' ? null : 'ACC';
  const O = c.comp ? clause(g, c.comp) : c.obj ? nounPhrase(g, c.obj, accusative) : [];
  const X = (c.obls ?? []).flatMap((o) => oblique(g, o.role, o.np));
  const A = c.adv ? [token([c.adv])] : [];
  const V = verbWords(g, c);
  let out: Token[];
  if (g.order === 'SOV') out = [...S, ...X, ...O, ...A, ...V];
  else if (g.order === 'SVO') out = [...S, ...V, ...O, ...X, ...A];
  else out = [...V, ...S, ...O, ...X, ...A];
  if (c.voc) {
    const voc = nounPhrase(g, c.voc, null);
    if (g.order === 'SOV') {
      voc[voc.length - 1].after = ',';
      out = [...voc, ...out];
    } else {
      out[out.length - 1].after = ',';
      out = [...out, ...voc];
    }
  }
  return out;
}

/** Lay the fable out in a language's grammar. */
export function linearize(g: Grammar): Sentence[] {
  const ov = g.order === 'SOV';
  return FABLE.map((u) => {
    const parts = u.main.map((c) => clause(g, c));
    let main: Token[] = [];
    parts.forEach((p, i) => {
      if (i > 0) {
        if (i === parts.length - 1) main.push(token(['and']));
        else main[main.length - 1].after = ',';
      }
      main = main.concat(p);
    });
    let tokens = main;
    if (u.when) {
      const sub = clause(g, u.when.clause);
      const when = token(['when']);
      const subTokens = ov ? [...sub, when] : [when, ...sub];
      if (ov || u.when.front) {
        subTokens[subTokens.length - 1].after = ',';
        tokens = [...subTokens, ...main];
      } else {
        tokens = [...main, ...subTokens];
      }
    }
    if (u.and) tokens = [token(['and']), ...tokens];
    tokens[tokens.length - 1].after = u.end;
    if (u.open) tokens[0].before = '“';
    return { tokens, english: u.english };
  });
}

/** Every distinct morpheme combination a grammar uses, plus the bare roots. */
export function tokenKeys(sentences: Sentence[]): Map<string, (Meaning | Morph)[]> {
  const out = new Map<string, (Meaning | Morph)[]>();
  for (const s of sentences) for (const t of s.tokens) out.set(t.key, t.parts);
  return out;
}
