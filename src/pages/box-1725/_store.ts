// What the item remembers about this reader, kept in this browser only.
// Every read and write is guarded: in a private window or with storage
// blocked, the page still works and simply forgets on reload.

import type { Memory } from './_compose';

export type LetterState = 'inside' | 'collected' | 'answered' | 'read' | 'returned';

export interface StoredLetter {
  id: number;
  to: string;
  from: string;
  body: string;
  stamp: string | null;
  postedAt: number;
  state: LetterState;
  collectedAt?: number;
  replyAt?: number;
  reply?: string;
  grants?: boolean;
}

export interface Incident {
  at: number;
  text: string;
}

export interface State {
  v: 1;
  seed: number;
  letters: StoredLetter[];
  memory: Memory;
  incidents: Incident[];
  clearance: number;
  sound: boolean;
}

const KEY = 'box-1725';

export function fresh(): State {
  return {
    v: 1,
    seed: Math.floor(Math.random() * 2 ** 31),
    letters: [],
    memory: { trust: 0, answered: 0, granted: false, peeked: [], falseFlags: 0, returned: 0, kept: [], name: null },
    incidents: [],
    clearance: 0,
    sound: true,
  };
}

export function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const s = JSON.parse(raw) as Partial<State>;
    if (s.v !== 1 || !Array.isArray(s.letters) || !s.memory) return fresh();
    const base = fresh();
    return { ...base, ...s, memory: { ...base.memory, ...s.memory } } as State;
  } catch {
    return fresh();
  }
}

export function save(state: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage is unavailable; the item forgets on reload.
  }
}
