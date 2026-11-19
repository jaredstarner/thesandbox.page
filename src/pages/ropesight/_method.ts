// Change ringing as data: place notation, methods, touches, and the plan a band rings from.
// A row lists bells in striking order, so row[0] is the bell at lead and row[n-1] the one behind.
// Bells are numbered 1 (the treble, highest) to 6 (the tenor, lowest).

export const TOWER_BELLS = 6;

export type Call = 'P' | 'B' | 'S';

export interface Touch {
  label: string;
  calls: Call[];
}

const calling = (s: string): Call[] => s.split('') as Call[];

export interface MethodDef {
  id: string;
  name: string;
  /** Bells that change; on a stage below the tower's, the tenor covers behind. */
  stage: number;
  /** Place notation for the plain lead, one token per change. */
  lead: string[];
  /** How many changes at the end of the lead a call replaces. */
  callSpan: number;
  bob: string[];
  single: string[];
  /** Touches the band knows, each a calling with one letter per lead; the first is rung by default. */
  touches: Touch[];
  /** Short words for the method picker. */
  blurb: string;
}

/** Parse place notation such as "x16x16x16x16x16x12" or "5.1.5.1.5.1.5.1.5.125" into tokens. */
export function parsePN(pn: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of pn.replace(/\s+/g, '')) {
    if (ch === 'x' || ch === 'X' || ch === '-') {
      if (cur) out.push(cur);
      cur = '';
      out.push('x');
    } else if (ch === '.') {
      if (cur) out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const PLACE_CHARS = '1234567890ET';

/** Apply one change to a row: bells in the named places stay, every other adjacent pair swaps. */
export function applyChange(row: readonly number[], token: string, stage: number): number[] {
  const next = row.slice();
  const stays = new Set<number>();
  if (token !== 'x') for (const ch of token) stays.add(PLACE_CHARS.indexOf(ch));
  let i = 0;
  while (i < stage) {
    if (stays.has(i) || i + 1 >= stage || stays.has(i + 1)) {
      i += 1;
      continue;
    }
    next[i] = row[i + 1];
    next[i + 1] = row[i];
    i += 2;
  }
  return next;
}

export function rounds(n = TOWER_BELLS): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

export function isRounds(row: readonly number[]): boolean {
  return row.every((b, i) => b === i + 1);
}

export const METHODS: MethodDef[] = [
  {
    id: 'rounds',
    name: 'Rounds',
    stage: 6,
    lead: [],
    callSpan: 0,
    bob: [],
    single: [],
    touches: [{ label: 'Forty rows', calls: [] }],
    blurb: 'Every bell in order, treble to tenor, again and again',
  },
  {
    id: 'plain-hunt',
    name: 'Plain Hunt on Six',
    stage: 6,
    lead: parsePN('x16x16x16x16x16x16'),
    callSpan: 0,
    bob: [],
    single: [],
    // Plain hunt repeats itself every twelve rows; a learner rings it twice through.
    touches: [
      { label: 'Twice through, 24 changes', calls: calling('PP') },
      { label: 'Once through, 12 changes', calls: calling('P') },
    ],
    blurb: 'Each bell works out to the back and down to lead, one place a blow',
  },
  {
    id: 'plain-bob-doubles',
    name: 'Plain Bob Doubles',
    stage: 5,
    lead: parsePN('5.1.5.1.5.1.5.1.5.125'),
    callSpan: 1,
    bob: parsePN('145'),
    single: parsePN('123'),
    touches: [
      { label: 'Plain course, 40 changes', calls: calling('PPPP') },
      { label: 'Touch of 60', calls: calling('PBPBPB') },
      { label: 'Extent, 120', calls: calling('PPPBPPPBPPPB') },
    ],
    blurb: 'Plain hunting with dodges where the treble leads; the tenor covers',
  },
  {
    id: 'grandsire-doubles',
    name: 'Grandsire Doubles',
    stage: 5,
    lead: parsePN('3.1.5.1.5.1.5.1.5.1'),
    callSpan: 2,
    bob: parsePN('3.1'),
    single: parsePN('3.123'),
    touches: [
      { label: 'Plain course, 30 changes', calls: calling('PPP') },
      { label: 'Touch of 60', calls: calling('PBPBPB') },
      { label: 'Extent, 120', calls: calling('PBPBPSPBPBPS') },
    ],
    blurb: 'Two hunt bells and the oldest method still rung; the tenor covers',
  },
  {
    id: 'plain-bob-minor',
    name: 'Plain Bob Minor',
    stage: 6,
    lead: parsePN('x16x16x16x16x16x12'),
    callSpan: 1,
    bob: parsePN('14'),
    single: parsePN('1234'),
    touches: [
      { label: 'Touch of 36', calls: calling('BBB') },
      { label: 'Plain course, 60 changes', calls: calling('PPPPP') },
      { label: 'Touch of 120', calls: calling('PPPBBPPPBB') },
    ],
    blurb: 'All six bells working, with bobs to bring the course round early',
  },
];

export function methodById(id: string): MethodDef {
  return METHODS.find((m) => m.id === id) ?? METHODS[0];
}

/** Rows of a touch, from the first change off rounds to the row that comes back into rounds. */
export function touchRows(def: MethodDef, calls: readonly Call[]): { rows: number[][]; calls: Map<number, Call> } {
  const rows: number[][] = [];
  const callAt = new Map<number, Call>();
  if (!def.lead.length) return { rows, calls: callAt };
  let row = rounds(TOWER_BELLS);
  for (const call of calls) {
    const changes = def.lead.slice();
    if (call !== 'P') {
      const swap = call === 'B' ? def.bob : def.single;
      changes.splice(changes.length - def.callSpan, def.callSpan, ...swap);
      // The call takes effect at the first replaced change; the row it produces is where it bites.
      callAt.set(rows.length + changes.length - def.callSpan, call);
    }
    for (const t of changes) {
      row = applyChange(row, t, def.stage);
      rows.push(row);
    }
  }
  return { rows, calls: callAt };
}

/** True when no row repeats before the touch comes round, and it does come round at the end. */
export function isTrue(rows: readonly number[][]): boolean {
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const key = rows[i].join('');
    if (seen.has(key)) return false;
    seen.add(key);
    if (isRounds(rows[i]) && i !== rows.length - 1) return false;
  }
  return rows.length > 0 && isRounds(rows[rows.length - 1]);
}

export type Caption = { row: number; text: string; kind: 'call' | 'info' };

export interface Plan {
  def: MethodDef;
  /** Every row the band rings, rounds included; even indices are handstrokes. */
  rows: number[][];
  /** First and last rows of method (changes), or -1 for rounds only. */
  start: number;
  end: number;
  captions: Caption[];
  /** Rows of method between the first change and coming round. */
  changes: number;
}

/**
 * The whole performance: rounds, the conductor's "Go", the touch, "That's all", rounds, and "Stand".
 * Calls are given a whole pull (two rows) before the row where they bite, at a handstroke.
 */
export function makePlan(def: MethodDef, calls: readonly Call[] = def.touches[0].calls): Plan {
  const leadIn = 8; // four whole pulls of rounds
  const rows: number[][] = [];
  const captions: Caption[] = [];
  for (let i = 0; i < leadIn; i++) rows.push(rounds());
  const { rows: method, calls: callAt } = touchRows(def, calls);
  let start = -1;
  let end = -1;
  if (method.length) {
    captions.push({ row: leadIn - 2, text: `Go ${def.name}`, kind: 'call' });
    start = rows.length;
    for (let i = 0; i < method.length; i++) {
      const c = callAt.get(i);
      // Called at a handstroke, at least a whole pull before the row where it bites.
      const bite = start + i;
      if (c) captions.push({ row: bite % 2 ? bite - 3 : bite - 2, text: c === 'B' ? 'Bob' : 'Single', kind: 'call' });
      rows.push(method[i]);
    }
    end = rows.length - 1;
    captions.push({ row: end, text: "That's all", kind: 'call' });
  } else {
    // Rounds alone: a longer stretch, so there is time to find the rhythm.
    for (let i = 0; i < 40; i++) rows.push(rounds());
  }
  // Rounds to finish; the method's last row is already rounds.
  const tail = method.length ? 5 : 0;
  for (let i = 0; i < tail; i++) rows.push(rounds());
  // Stand at a handstroke: the stand call comes a whole pull before the last handstroke.
  if (rows.length % 2 === 0) rows.push(rounds());
  captions.push({ row: rows.length - 3, text: 'Stand next', kind: 'call' });
  return { def, rows, start, end, captions, changes: method.length };
}

/** A bell's place (0-based) in each row, for drawing its line. */
export function placesOf(bell: number, rows: readonly number[][]): number[] {
  return rows.map((r) => r.indexOf(bell));
}
