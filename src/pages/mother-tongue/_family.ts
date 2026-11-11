// The family tree: a parent language that splits, and splits again, over three thousand
// years. Each branch gets its own run of sound changes and its own scribal drift, so
// sister languages share an ancestor's words and letters but not their fate.

import { RULES, changedPairs, type Rule } from './_change';
import { linearize, tokenKeys, type Sentence } from './_fable';
import { compose, makeProto, MEANINGS, type Meaning, type Morph, type Proto } from './_lang';
import { isVowel, nuclei, romanize, romanStyle, ROMAN_STYLE_COUNT, type StressRule, type Word } from './_phon';
import { hashString, rng, type Rng } from './_rng';
import {
  applyOp,
  chooseOps,
  cloneScript,
  deriveLetters,
  makeScript,
  settleOp,
  type Script,
  type ScriptOp,
} from './_script';

export const SPAN = 3000;

export interface Change {
  t: number;
  rule: Rule;
  text: string;
  example: { meaning: Meaning; before: Word; after: Word } | null;
  pairs: Map<string, string>;
}

export interface Lang {
  id: number;
  parent: Lang | null;
  children: Lang[];
  t0: number;
  t1: number;
  depth: number;
  extinct: boolean;
  changes: Change[];
  ops: ScriptOp[];
  /** Forms after the first k changes, k = 0 to changes.length. */
  snapshots: Map<string, Word>[];
  stress: StressRule[];
  scriptStart: Script;
  name: string;
  color: string;
  romanIndex: number;
  longMark: Proto['longMark'];
  x: number;
}

export interface Family {
  seed: number;
  proto: Proto;
  sentences: Sentence[];
  keys: Map<string, (Meaning | Morph)[]>;
  root: Lang;
  nodes: Lang[];
  leaves: Lang[];
}

const INKS = ['#a3392b', '#2f5d8a', '#b07a1f', '#3f7a5a', '#7a3f74', '#4f6a78', '#9a5a2c', '#5b5f2a'];

// Words a visitor should never be shown, kept out of plain sight.
const BLOCKED = ['avtt', 'shpx', 'fuvg', 'phag', 'snt', 'xvxr', 'fcvp', 'puvax', 'encr', 'anmv', 'cvff', 'fyhg', 'jubER', 'qvpx', 'pbpx', 'gjng', 'jnax', 'ergneq', 'avtn', 'avtre'].map((w) =>
  w.toLowerCase().replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97)),
);

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function clean(text: string): boolean {
  const t = fold(text);
  return !BLOCKED.some((b) => t.includes(b));
}

function protoForms(proto: Proto, keys: Map<string, (Meaning | Morph)[]>): Map<string, Word> {
  const out = new Map<string, Word>();
  for (const [key, parts] of keys) {
    const words = parts.map((p) => (p in proto.roots ? proto.roots[p as Meaning] : proto.morphs[p as Morph]));
    out.set(key, compose(proto, words));
  }
  return out;
}

function growTree(r: Rng): Lang[] {
  for (let attempt = 0; attempt < 60; attempt++) {
    const nodes: Lang[] = [];
    const make = (parent: Lang | null, t0: number, depth: number): Lang => {
      const node = { id: nodes.length, parent, children: [], t0, t1: SPAN, depth, extinct: false } as unknown as Lang;
      nodes.push(node);
      return node;
    };
    const root = make(null, 0, 0);
    root.t1 = r.range(480, 820);
    const grow = (node: Lang) => {
      const count = node === root ? r.weighted([2, 3], [5, 5]) : r.weighted([2, 3], [8, 2]);
      for (let k = 0; k < count; k++) {
        const child = make(node, node.t1, node.depth + 1);
        node.children.push(child);
        const remaining = SPAN - child.t0;
        const odds = child.depth === 1 ? 0.7 : 0.4;
        if (child.depth < 3 && remaining > 1150 && r.chance(odds)) {
          child.t1 = child.t0 + r.range(450, Math.min(1300, remaining - 600));
          grow(child);
        }
      }
    };
    grow(root);
    const leaves = nodes.filter((n) => !n.children.length);
    if (leaves.length < 5 || leaves.length > 7) continue;
    // Sometimes a branch dies out, and is known only from what it left written down.
    if (r.chance(0.55)) {
      const candidates = leaves.filter((l) => SPAN - l.t0 > 1300);
      if (candidates.length) {
        const dead = r.pick(candidates);
        dead.extinct = true;
        dead.t1 = SPAN - r.range(650, Math.min(1500, SPAN - dead.t0 - 450));
      }
    }
    return nodes;
  }
  throw new Error('no tree');
}

function chooseChanges(
  r: Rng,
  node: Lang,
  start: Map<string, Word>,
  stress: StressRule,
  used: Set<string>,
): { changes: Change[]; snapshots: Map<string, Word>[]; stress: StressRule[] } {
  const span = node.t1 - node.t0;
  const count = Math.max(node.parent ? 1 : 2, Math.round(span / r.range(150, 220)));
  const times = Array.from({ length: count }, () => r.range(node.t0 + 25, node.t1 - 25)).sort((a, b) => a - b);
  const changes: Change[] = [];
  const snapshots = [start];
  const stresses = [stress];
  let forms = start;
  const rootKeys = MEANINGS as readonly string[];
  for (const t of times) {
    const candidates = RULES.filter((rule) => !used.has(rule.id) && (!rule.after || rule.after.some((a) => used.has(a))));
    for (let tries = 0; tries < 40 && candidates.length; tries++) {
      const rule = r.weighted(
        candidates,
        candidates.map((c) => c.weight),
      );
      if (rule.stress) {
        if (stress === rule.stress) continue;
        changes.push({ t, rule, text: rule.describe(new Map()), example: null, pairs: new Map() });
        used.add(rule.id);
        stress = rule.stress;
        snapshots.push(forms);
        stresses.push(stress);
        break;
      }
      const next = new Map<string, Word>();
      let ok = true;
      for (const [key, w] of forms) {
        const out = rule.apply(w, stress);
        if (!out.length || (!out.some(isVowel) && w.some(isVowel))) {
          ok = false;
          break;
        }
        next.set(key, out);
      }
      if (!ok) continue;
      const before = rootKeys.map((k) => forms.get(k)!);
      const after = rootKeys.map((k) => next.get(k)!);
      let changed = 0;
      for (let i = 0; i < before.length; i++) if (before[i].join('') !== after[i].join('')) changed++;
      if (changed < 2) continue;
      const distinctBefore = new Set(before.map((w) => w.join(''))).size;
      const distinctAfter = new Set(after.map((w) => w.join(''))).size;
      if (distinctBefore - distinctAfter > 2) continue;
      if (after.filter((w) => nuclei(w).length === 1 && w.length <= 1).length > 0) continue;
      const pairs = changedPairs(rule, before, after);
      let example: Change['example'] = null;
      const order = ['water', 'fire', 'mother', 'father', 'star', 'night', 'horse', 'sheep', 'stone', 'name', 'heart'];
      for (const meaning of [...order, ...rootKeys]) {
        const i = rootKeys.indexOf(meaning);
        if (before[i].join('') !== after[i].join('')) {
          example = { meaning: meaning as Meaning, before: before[i], after: after[i] };
          break;
        }
      }
      changes.push({ t, rule, text: rule.describe(pairs), example, pairs });
      used.add(rule.id);
      forms = next;
      snapshots.push(forms);
      stresses.push(stress);
      break;
    }
  }
  return { changes, snapshots, stress: stresses };
}

function inventoryOf(forms: Map<string, Word>): Set<string> {
  const out = new Set<string>();
  for (const w of forms.values()) for (const s of w) out.add(s);
  return out;
}

function frequencyOf(forms: Map<string, Word>): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of forms.values()) for (const s of w) out.set(s, (out.get(s) ?? 0) + 1);
  return out;
}

/** A language's script at a moment, with retracting strokes for a simplification under way. */
export interface ScriptAt {
  script: Script;
  fading: Map<string, Map<number, number>>;
}

export function scriptAt(fam: Family, node: Lang, t: number): ScriptAt {
  const s = cloneScript(node.scriptStart);
  const fading = new Map<string, Map<number, number>>();
  const r = rng(hashString(`derive:${fam.seed}:${node.id}`));
  type Ev = { t: number; op?: ScriptOp; change?: number };
  const events: Ev[] = [
    ...node.ops.map((op) => ({ t: op.t, op })),
    ...node.changes.map((c, i) => ({ t: c.t, change: i })),
  ].sort((a, b) => a.t - b.t);
  for (const ev of events) {
    if (ev.t > t) break;
    if (ev.op) {
      const op = ev.op;
      const k = Math.min(1, (t - op.t) / op.dur);
      applyOp(s.state, op, k);
      if (op.kind === 'simplify' && op.cuts) {
        if (k >= 1) settleOp(s, op, new Set(), new Map(), r);
        else
          for (const [key, index] of op.cuts) {
            const g = s.letters.get(key);
            if (!g || g.strokes.length < 2) continue;
            const m = fading.get(key) ?? new Map<number, number>();
            m.set(index % g.strokes.length, 1 - k);
            fading.set(key, m);
          }
      }
      if (op.kind === 'vowels' && k >= 0.5) {
        const forms = node.snapshots[node.changes.filter((c) => c.t <= op.t).length];
        settleOp(s, op, inventoryOf(forms), frequencyOf(forms), r);
      }
    } else if (ev.change !== undefined) {
      const c = node.changes[ev.change];
      deriveLetters(s, c.pairs, inventoryOf(node.snapshots[ev.change + 1]), r);
    }
  }
  return { script: s, fading };
}

export function makeFamily(seed: number): Family {
  for (let variant = 0; variant < 24; variant++) {
    const fam = build(seed, variant);
    if (fam) return fam;
  }
  return build(seed, 99, true)!;
}

function build(seed: number, variant: number, force = false): Family | null {
  const r = rng(hashString(`family:${seed}:${variant}`));
  const proto = makeProto(r.fork('proto'));
  const sentences = linearize(proto.grammar);
  const keys = tokenKeys(sentences);
  for (const m of MEANINGS) keys.set(m, [m]);
  const nodes = growTree(r.fork('tree'));
  const root = nodes[0];
  const start = protoForms(proto, keys);
  const used = new Map<number, Set<string>>();

  const phonemes = [...inventoryOf(start)];
  const baseScript = makeScript(r.fork('script'), phonemes, frequencyOf(start));

  const leafStyles = r.fork('styles').shuffle([...Array(ROMAN_STYLE_COUNT * 2).keys()].map((i) => i % ROMAN_STYLE_COUNT));
  let leafIndex = 0;
  for (const node of nodes) {
    const parent = node.parent;
    const lineage = new Set(parent ? used.get(parent.id) : []);
    const begin = parent ? parent.snapshots[parent.snapshots.length - 1] : start;
    const stress = parent ? parent.stress[parent.stress.length - 1] : proto.stress;
    const result = chooseChanges(r.fork(`changes:${node.id}`), node, begin, stress, lineage);
    used.set(node.id, lineage);
    node.changes = result.changes;
    node.snapshots = result.snapshots;
    node.stress = result.stress;
    node.romanIndex = node.children.length || !parent ? proto.romanIndex : leafStyles[leafIndex++ % leafStyles.length];
    node.longMark = node.children.length || !parent ? proto.longMark : r.pick(['macron', 'double', 'acute'] as const);
  }

  // Scripts: each branch starts from its parent's script as the parent left it.
  const famStub = { seed } as Family;
  for (const node of nodes) {
    if (!node.parent) node.scriptStart = baseScript;
    else node.scriptStart = scriptAt(famStub, node.parent, node.parent.t1 + 1e6).script;
    const state = { ...node.scriptStart.state };
    node.ops = chooseOps(r.fork(`ops:${node.id}`), node.t0, node.t1, state, node.parent === root, node.scriptStart);
    if (!node.parent) node.ops = node.ops.filter((op) => op.kind !== 'ink' && op.kind !== 'mirror');
  }
  // Ops run to completion before the branch ends; give scriptAt a long t to finish them.
  for (const node of nodes) for (const op of node.ops) op.dur = Math.min(op.dur, Math.max(20, node.t1 - op.t - 1));

  // Names: each language's own word for its people, as it said it at the end.
  // The parent is named for its word for "people"; each branch for a place or people of
  // its own, as real languages are, so sisters' names needn't be cognate.
  const leaves = nodes.filter((n) => !n.children.length);
  const names = new Set<string>();
  const taken = new Set<Meaning>();
  const namers = r.fork('names').shuffle(['star', 'stone', 'tree', 'sun', 'moon', 'fish', 'bird', 'night', 'mouth', 'name', 'water', 'hill', 'plain', 'fire', 'dog'] as Meaning[]);
  const nameScore = (name: string): number => {
    const plain = fold(name);
    let score = Math.abs(plain.length - 6) * 0.6;
    if (plain.length < 3) score += 20;
    score += (name.match(/[ëəă]/g) ?? []).length * 1.5;
    score += (name.normalize('NFD').match(/[̀-ͯ]/g) ?? []).length * 1.1;
    if (/[^aeiouy]{3,}$/i.test(plain) || /[^aeiouy]{4}/i.test(plain)) score += 2.5;
    if (/[aeiouyëəăöüïèò]{3}/i.test(plain)) score += 4;
    if (/^[aeiou]{2}/i.test(plain)) score += 3;
    return score;
  };
  for (const node of nodes) {
    const forms = node.snapshots[node.snapshots.length - 1];
    const order = node.parent ? [...namers, ...MEANINGS] : (['people', ...namers, ...MEANINGS] as Meaning[]);
    let best = '';
    let bestScore = Infinity;
    let bestMeaning: Meaning | null = null;
    for (const [k, m] of order.entries()) {
      if (taken.has(m)) continue;
      const w = forms.get(m)!;
      const text = romanize(w, romanStyle(node.romanIndex), 'macron').replace(/[ʼ']/g, '');
      const cap = text.charAt(0).toUpperCase() + text.slice(1);
      if (names.has(cap)) continue;
      // Earlier meanings in the shuffled list win ties, so names vary from family to family.
      const score = nameScore(cap) + k * 0.15 + (!node.parent && m === 'people' ? -3 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = cap;
        bestMeaning = m;
      }
    }
    names.add(best);
    if (bestMeaning) taken.add(bestMeaning);
    node.name = best;
  }

  // Lay the leaves out left to right in tree order, parents above their children's middle.
  let column = 0;
  const place = (n: Lang): number => {
    if (!n.children.length) {
      n.x = column++;
      return n.x;
    }
    const xs = n.children.map(place);
    n.x = (Math.min(...xs) + Math.max(...xs)) / 2;
    return n.x;
  };
  place(root);
  for (const n of nodes) n.x = leaves.length > 1 ? n.x / (leaves.length - 1) : 0.5;
  leaves
    .slice()
    .sort((a, b) => a.x - b.x)
    .forEach((l, i) => (l.color = INKS[i % INKS.length]));
  for (const n of nodes) if (n.children.length) n.color = '#2a2622';

  const fam: Family = { seed, proto, sentences, keys, root, nodes, leaves };

  if (!force) {
    for (const node of nodes) {
      const style = romanStyle(node.romanIndex);
      for (const snap of node.snapshots) for (const w of snap.values()) if (!clean(romanize(w, style))) return null;
      if (!clean(node.name)) return null;
    }
  }
  return fam;
}

/** Forms on a branch at a moment. */
export function formsAt(node: Lang, t: number): { forms: Map<string, Word>; stress: StressRule; applied: number } {
  let k = 0;
  while (k < node.changes.length && node.changes[k].t <= t) k++;
  return { forms: node.snapshots[k], stress: node.stress[k], applied: k };
}

/** The lineage from the root down to a node. */
export function lineage(node: Lang): Lang[] {
  const out: Lang[] = [];
  for (let n: Lang | null = node; n; n = n.parent) out.unshift(n);
  return out;
}

/** What scholars would call the language at a point on its branch. */
export function eraName(fam: Family, node: Lang, t: number): string {
  if (!node.parent) return `Proto-${node.name}`;
  if (node.children.length) return `Proto-${node.name}`;
  if (node.extinct) return node.name;
  const k = (t - node.t0) / (node.t1 - node.t0);
  if (k < 0.4) return `Old ${node.name}`;
  if (k < 0.75) return `Middle ${node.name}`;
  return node.name;
}

export function yearsAgo(t: number): string {
  const y = Math.round((SPAN - t) / 50) * 50;
  if (y <= 0) return 'today';
  return `${y.toLocaleString('en-US')} years ago`;
}
