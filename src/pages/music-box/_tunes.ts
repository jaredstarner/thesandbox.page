// The comb's thirty notes, the punched strips that come with the box, and the
// strip's share-link format.

/** MIDI notes of the comb, low to high: C3 to B5, as a 30-note paper-strip comb is tuned. */
export const COMB = [
  48, 50, 52, 53, 55, 57, 58, 59, 60, 61, 62, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 76, 77, 78, 79, 80, 81, 82, 83,
] as const;

export const ROWS = COMB.length;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const noteName = (midi: number): string => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/** Row 0 is the top of the strip, the highest tooth. */
export const rowOfMidi = (midi: number): number => {
  const i = COMB.indexOf(midi as (typeof COMB)[number]);
  return i < 0 ? -1 : ROWS - 1 - i;
};

export const midiOfRow = (row: number): number => COMB[ROWS - 1 - row] ?? 60;

const parseNote = (name: string): number => {
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return NAMES.indexOf(m[1] + m[2]) + (Number(m[3]) + 1) * 12;
};

export interface Strip {
  /** Columns of music; each column is one eighth note. */
  length: number;
  /** Columns per bar, for the printed bar lines. */
  bar: number;
  /** Hole state per cell, `col * ROWS + row`: 0 paper, 1 hole, 2 taped-over hole. */
  cells: Uint8Array;
  /** Columns where a fresh length of paper was glued on. */
  seams: number[];
}

export const blankStrip = (length = 96, bar = 8): Strip => ({
  length,
  bar,
  cells: new Uint8Array(length * ROWS),
  seams: [],
});

export interface Tune {
  id: string;
  title: string;
  by: string;
  /** Crank speed it was arranged for, in quarter notes a minute. */
  tempo: number;
  bar: number;
  build: () => Strip;
}

/** A line of music: "E4:1 E4:1 G4:4 r:2", each note with its length in eighths. */
const line = (text: string, start = 0): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  let col = start;
  for (const token of text.trim().split(/\s+/)) {
    if (token === '|') continue;
    const [name, len] = token.split(':');
    const cols = Number(len ?? 1);
    if (name !== 'r') {
      for (const n of name!.split('+')) out.push([col, parseNote(n)]);
    }
    col += cols;
  }
  return out;
};

/** Bass and chord on each bar: "C" puts the chord's root on the downbeat and the rest on `offbeats`. */
const CHORDS: Record<string, string[]> = {
  C: ['C3', 'E3', 'G3'],
  F: ['F3', 'A3', 'C4'],
  G: ['G3', 'B3', 'D4'],
  Am: ['A3', 'C4', 'E4'],
  E: ['E3', 'B3', 'G#4'],
  Gmaj7: ['G3', 'B3+D4+F#4'],
  Dmaj7: ['D3', 'A3+C#4+F#4'],
  D: ['D3', 'A3', 'F#4'],
  Dend: ['D3', 'A3+D4+F#4'],
  AmE: ['A3', 'E3+B3'],
};

const comp = (chords: string, bar: number, offbeats: number[], start = 0): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  chords
    .trim()
    .split(/\s+/)
    .forEach((symbol, i) => {
      if (symbol === '-') return;
      const [root, ...rest] = CHORDS[symbol]!;
      const at = start + i * bar;
      out.push([at, parseNote(root!)]);
      offbeats.forEach((off, k) => {
        const group = rest[k % rest.length];
        if (group) for (const n of group.split('+')) out.push([at + off, parseNote(n)]);
      });
    });
  return out;
};

const punch = (bar: number, ...parts: Array<Array<[number, number]>>): Strip => {
  const notes = parts.flat();
  const last = Math.max(...notes.map(([c]) => c));
  const length = Math.ceil((last + 4) / bar) * bar;
  const strip = blankStrip(length, bar);
  for (const [col, midi] of notes) {
    const row = rowOfMidi(midi);
    if (row < 0) throw new Error(`${noteName(midi)} is not on the comb`);
    strip.cells[col * ROWS + row] = 1;
  }
  return strip;
};

export const TUNES: Tune[] = [
  {
    id: 'wiegenlied',
    title: 'Wiegenlied',
    by: 'Johannes Brahms, 1868',
    tempo: 84,
    bar: 6,
    build: () =>
      punch(
        6,
        line(
          `r:4 B4:1 B4:1 | D5:4 B4:1 B4:1 | D5:4 B4:1 D5:1 | G5:2 F#5:3 E5:1 | E5:2 D5:2 A4:1 B4:1 |
           C5:2 A4:2 A4:1 B4:1 | C5:4 A4:1 C5:1 | F#5:1 E5:1 D5:2 F#5:2 | G5:4 G4:1 G4:1 |
           G5:4 E5:1 C5:1 | D5:4 B4:1 G4:1 | C5:2 D5:2 E5:2 | D5:4 G4:1 G4:1 |
           G5:4 E5:1 C5:1 | D5:4 B4:1 G4:1 | C5:2 B4:2 A4:2 | G4+B4+D5:6`,
        ),
        comp('- G G D D D D D G C G D G C G D G', 6, [2, 4]),
      ),
  },
  {
    id: 'gymnopedie',
    title: 'Gymnopédie No. 1',
    by: 'Erik Satie, 1888',
    tempo: 66,
    bar: 6,
    build: () =>
      punch(
        6,
        line(
          `r:24 | r:2 F#5:2 A5:2 | G5:2 F#5:2 C#5:2 | B4:2 C#5:2 D5:2 | A4:6 | F#4:6 | r:6 | r:6 | r:6 |
           r:2 F#5:2 A5:2 | G5:2 F#5:2 C#5:2 | B4:2 C#5:2 D5:2 | A4:6 | C#5:6 | F#5:6 | E5:6 | r:6 | r:6 | D5:6`,
        ),
        comp('Gmaj7 Dmaj7 Gmaj7 Dmaj7 Gmaj7 Dmaj7 Gmaj7 Dmaj7 Gmaj7 Dmaj7 Gmaj7 Dmaj7 Gmaj7 Dmaj7 Gmaj7 Dmaj7 Gmaj7 Dmaj7 Gmaj7 Dmaj7 Gmaj7 Dend', 6, [2]),
      ),
  },
  {
    id: 'greensleeves',
    title: 'Greensleeves',
    by: 'English, 1580s',
    tempo: 76,
    bar: 6,
    build: () =>
      punch(
        6,
        line(
          `r:5 A4:1 | C5:2 D5:1 E5:1 F5:1 E5:1 | D5:2 B4:1 G4:1 A4:1 B4:1 | C5:2 A4:1 A4:1 G#4:1 A4:1 |
           B4:2 G#4:1 E4:2 A4:1 | C5:2 D5:1 E5:1 F5:1 E5:1 | D5:2 B4:1 G4:1 A4:1 B4:1 |
           C5:1 B4:1 A4:1 G#4:1 F#4:1 G#4:1 | A4:6 |
           G5:3 G5:1 F#5:1 E5:1 | D5:2 B4:1 G4:1 A4:1 B4:1 | C5:2 A4:1 A4:1 G#4:1 A4:1 |
           B4:2 G#4:1 E4:3 | G5:3 G5:1 F#5:1 E5:1 | D5:2 B4:1 G4:1 A4:1 B4:1 |
           C5:1 B4:1 A4:1 G#4:1 F#4:1 G#4:1 | A4+C5+E5:6`,
        ),
        comp('- Am G F E Am G AmE Am C G Am E C G AmE Am', 6, [3]),
      ),
  },
];

// Share links: version byte, bar, length (two bytes), then one bit per open hole.

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string): Uint8Array => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export const encodeStrip = (strip: Strip): string => {
  const bits = new Uint8Array(Math.ceil((strip.length * ROWS) / 8));
  strip.cells.forEach((v, i) => {
    if (v === 1) bits[i >> 3]! |= 1 << (i & 7);
  });
  const out = new Uint8Array(4 + bits.length);
  out.set([1, strip.bar, strip.length & 255, strip.length >> 8]);
  out.set(bits, 4);
  return toBase64Url(out);
};

export const decodeStrip = (text: string): Strip | null => {
  try {
    const bytes = fromBase64Url(text);
    if (bytes[0] !== 1 || bytes.length < 4) return null;
    const bar = bytes[1]!;
    const length = bytes[2]! | (bytes[3]! << 8);
    if (bar < 2 || bar > 16 || length < 8 || length > 4096) return null;
    if (bytes.length < 4 + Math.ceil((length * ROWS) / 8)) return null;
    const strip = blankStrip(length, bar);
    for (let i = 0; i < strip.cells.length; i++) {
      if (bytes[4 + (i >> 3)]! & (1 << (i & 7))) strip.cells[i] = 1;
    }
    return strip;
  } catch {
    return null;
  }
};
