// Sounds as feature bundles. A word is an array of IPA segment strings; rules read
// the features and write new segments back by symbol.

export type Place = 'lab' | 'labdent' | 'dent' | 'alv' | 'post' | 'pal' | 'vel' | 'uvu' | 'glot';
export type Manner = 'stop' | 'fric' | 'affr' | 'nasal' | 'lat' | 'trill' | 'tap' | 'glide';

export interface Cons {
  kind: 'c';
  place: Place;
  manner: Manner;
  voice: boolean;
  /** Labialized velars (kʷ) and the labio-velar glide. */
  round?: boolean;
}

export interface Vowel {
  kind: 'v';
  /** 0 open, 1 open-mid, 2 close-mid, 3 close. */
  height: 0 | 1 | 2 | 3;
  /** 0 front, 1 central, 2 back. */
  back: 0 | 1 | 2;
  round: boolean;
  long: boolean;
  nasal: boolean;
}

export type Seg = Cons | Vowel;
export type Word = string[];

const C = (place: Place, manner: Manner, voice: boolean, round = false): Cons => ({
  kind: 'c',
  place,
  manner,
  voice,
  round,
});

export const CONSONANTS: Record<string, Cons> = {
  p: C('lab', 'stop', false),
  b: C('lab', 'stop', true),
  t: C('alv', 'stop', false),
  d: C('alv', 'stop', true),
  k: C('vel', 'stop', false),
  g: C('vel', 'stop', true),
  kʷ: C('vel', 'stop', false, true),
  gʷ: C('vel', 'stop', true, true),
  q: C('uvu', 'stop', false),
  ʔ: C('glot', 'stop', false),
  ɸ: C('lab', 'fric', false),
  β: C('lab', 'fric', true),
  f: C('labdent', 'fric', false),
  v: C('labdent', 'fric', true),
  θ: C('dent', 'fric', false),
  ð: C('dent', 'fric', true),
  s: C('alv', 'fric', false),
  z: C('alv', 'fric', true),
  ʃ: C('post', 'fric', false),
  ʒ: C('post', 'fric', true),
  ç: C('pal', 'fric', false),
  x: C('vel', 'fric', false),
  ɣ: C('vel', 'fric', true),
  χ: C('uvu', 'fric', false),
  ʁ: C('uvu', 'fric', true),
  h: C('glot', 'fric', false),
  ts: C('alv', 'affr', false),
  dz: C('alv', 'affr', true),
  tʃ: C('post', 'affr', false),
  dʒ: C('post', 'affr', true),
  m: C('lab', 'nasal', true),
  n: C('alv', 'nasal', true),
  ɲ: C('pal', 'nasal', true),
  ŋ: C('vel', 'nasal', true),
  l: C('alv', 'lat', true),
  ʎ: C('pal', 'lat', true),
  r: C('alv', 'trill', true),
  ɾ: C('alv', 'tap', true),
  w: C('vel', 'glide', true, true),
  j: C('pal', 'glide', true),
};

const VOWEL_BASES: Record<string, Omit<Vowel, 'long' | 'nasal'>> = {
  i: { kind: 'v', height: 3, back: 0, round: false },
  y: { kind: 'v', height: 3, back: 0, round: true },
  ɨ: { kind: 'v', height: 3, back: 1, round: false },
  u: { kind: 'v', height: 3, back: 2, round: true },
  e: { kind: 'v', height: 2, back: 0, round: false },
  ø: { kind: 'v', height: 2, back: 0, round: true },
  ə: { kind: 'v', height: 2, back: 1, round: false },
  o: { kind: 'v', height: 2, back: 2, round: true },
  ɛ: { kind: 'v', height: 1, back: 0, round: false },
  ɔ: { kind: 'v', height: 1, back: 2, round: true },
  a: { kind: 'v', height: 0, back: 1, round: false },
};

const TILDE = '̃';
const LONG = 'ː';
const cache = new Map<string, Seg | null>();

export function seg(symbol: string): Seg | null {
  const hit = cache.get(symbol);
  if (hit !== undefined) return hit;
  let out: Seg | null = CONSONANTS[symbol] ?? null;
  if (!out) {
    const base = VOWEL_BASES[symbol[0]];
    if (base) {
      const rest = symbol.slice(1);
      if (rest === '' || rest === TILDE || rest === LONG || rest === TILDE + LONG) {
        out = { ...base, nasal: rest.includes(TILDE), long: rest.includes(LONG) };
      }
    }
  }
  cache.set(symbol, out);
  return out;
}

export const isVowel = (s: string | undefined): boolean => !!s && seg(s)?.kind === 'v';
export const isCons = (s: string | undefined): boolean => !!s && seg(s)?.kind === 'c';

export function cons(s: string | undefined): Cons | null {
  const f = s ? seg(s) : null;
  return f && f.kind === 'c' ? f : null;
}

export function vowel(s: string | undefined): Vowel | null {
  const f = s ? seg(s) : null;
  return f && f.kind === 'v' ? f : null;
}

/** The symbol for a consonant's features, or null when the table has none. */
export function consSymbol(f: Partial<Cons> & Pick<Cons, 'place' | 'manner' | 'voice'>): string | null {
  for (const [sym, c] of Object.entries(CONSONANTS)) {
    if (c.place === f.place && c.manner === f.manner && c.voice === f.voice && !!c.round === !!f.round) return sym;
  }
  return null;
}

export function vowelSymbol(f: Omit<Vowel, 'kind'>): string {
  let best = 'a';
  let bestScore = Infinity;
  for (const [sym, v] of Object.entries(VOWEL_BASES)) {
    const score =
      Math.abs(v.height - f.height) * 2 + Math.abs(v.back - f.back) * 1.5 + (v.round === f.round ? 0 : 1.2);
    if (score < bestScore) {
      bestScore = score;
      best = sym;
    }
  }
  return best + (f.nasal ? TILDE : '') + (f.long ? LONG : '');
}

/** Change some of a vowel's features and return the new symbol. */
export function withVowel(s: string, change: Partial<Omit<Vowel, 'kind'>>): string {
  const v = vowel(s);
  if (!v) return s;
  return vowelSymbol({ ...v, ...change });
}

export function sonority(s: string | undefined): number {
  const f = s ? seg(s) : null;
  if (!f) return -1;
  if (f.kind === 'v') return 5;
  switch (f.manner) {
    case 'glide':
      return 4;
    case 'lat':
    case 'trill':
    case 'tap':
      return 3;
    case 'nasal':
      return 2;
    case 'fric':
      return 1;
    default:
      return 0;
  }
}

export const isObstruent = (s: string | undefined): boolean => {
  const c = cons(s);
  return !!c && (c.manner === 'stop' || c.manner === 'fric' || c.manner === 'affr');
};

export const isFront = (s: string | undefined): boolean => {
  const v = vowel(s);
  if (v) return v.back === 0 && v.height >= 1;
  return s === 'j';
};

export type StressRule = 'initial' | 'penult' | 'final';

/** Indices of the syllable nuclei in a word. */
export function nuclei(w: Word): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.length; i++) if (isVowel(w[i])) out.push(i);
  return out;
}

export function stressedIndex(w: Word, rule: StressRule): number {
  const n = nuclei(w);
  if (!n.length) return -1;
  if (rule === 'initial') return n[0];
  if (rule === 'final') return n[n.length - 1];
  return n.length >= 2 ? n[n.length - 2] : n[0];
}

/** How a language spells its sounds in Latin letters. */
export type Romanization = Record<string, string>;

const ROMAN_BASE: Romanization = {
  ʔ: 'ʼ',
  ɸ: 'ph',
  β: 'bh',
  θ: 'th',
  ð: 'dh',
  ʃ: 'sh',
  ʒ: 'zh',
  ç: 'hy',
  x: 'kh',
  ɣ: 'gh',
  χ: 'qh',
  ʁ: 'rh',
  ts: 'ts',
  dz: 'dz',
  tʃ: 'ch',
  dʒ: 'j',
  ɲ: 'ny',
  ŋ: 'ng',
  ʎ: 'ly',
  ɾ: 'r',
  j: 'y',
  kʷ: 'kw',
  gʷ: 'gw',
  ɨ: 'ï',
  y: 'ü',
  ø: 'ö',
  ə: 'ë',
  ɛ: 'è',
  ɔ: 'ò',
};

/** Alternative spellings a language may choose, each a set of overrides. */
const ROMAN_STYLES: Romanization[] = [
  {},
  { ʃ: 'š', ʒ: 'ž', tʃ: 'č', dʒ: 'dž', x: 'x', ɣ: 'ǧ', j: 'j', θ: 'þ', ð: 'ð', ŋ: 'ŋ', ts: 'c', ə: 'ə' },
  { ʃ: 'x', tʃ: 'c', j: 'y', ts: 'tz', x: 'j', ɲ: 'ñ', ŋ: 'nh', ɛ: 'e', ɔ: 'o' },
  { ʃ: 'sch', tʃ: 'tsch', j: 'j', x: 'ch', ɣ: 'g', ŋ: 'ng', ø: 'eu', y: 'uy', ə: 'e' },
  { ʃ: 'ś', tʃ: 'ć', dʒ: 'dź', ɲ: 'ń', ʎ: 'ł', θ: 'ŧ', x: 'ĥ', ts: 'ṭs', ə: 'ă' },
];

export function romanStyle(index: number): Romanization {
  return { ...ROMAN_BASE, ...ROMAN_STYLES[index % ROMAN_STYLES.length] };
}

export const ROMAN_STYLE_COUNT = ROMAN_STYLES.length;

export function romanize(w: Word, style: Romanization, longMark: 'macron' | 'double' | 'acute' = 'macron'): string {
  let out = '';
  for (const s of w) {
    const v = vowel(s);
    if (v) {
      const base = s[0];
      let letter = style[base] ?? base;
      if (v.nasal) letter = letter + (letter.length === 1 ? '̃' : 'n');
      if (v.long) {
        if (longMark === 'double') letter = letter + letter;
        else if (letter.length === 1) letter = letter + (longMark === 'acute' ? '́' : '̄');
        else letter = letter + 'h';
      }
      out += letter;
    } else {
      out += style[s] ?? s;
    }
  }
  return out.normalize('NFC');
}

export function ipa(w: Word): string {
  return w.join('');
}
