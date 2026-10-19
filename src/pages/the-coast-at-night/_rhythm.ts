// A light's character: the rhythm of light and dark it repeats, read from the
// characteristic as printed in the NGA and USCG lists ("Fl.(2+1)W.; period
// 15s; fl. 0.1s, ec. 2.5s; ...", "Fl (2)R 6s", "Q G", "Mo (A) W").
//
// A rhythm is a list of [duration, code] steps over one period. Code 0 is
// dark, ON (8) is the light's own colour at the bearing it is seen from, and
// 1 to 7 is a set colour, for alternating lights.

export const COLOURS = ['W', 'R', 'G', 'Y', 'Bu', 'Vi', 'Or'] as const;
export type Colour = (typeof COLOURS)[number];
export const ON = 8;

/** Colour code for a colour letter: 1 for W through 7 for Or. */
export const code = (c: Colour): number => COLOURS.indexOf(c) + 1;

export interface Rhythm {
  /** Chart abbreviation, e.g. "Fl(2)WR.10s". */
  label: string;
  /** Seconds; 0 for a fixed light. */
  period: number;
  /** [duration, code] pairs, flattened. Empty for a fixed light. */
  steps: number[];
  /** Level between flashes, for a fixed and flashing light (F.Fl). */
  base: number;
}

export interface Character {
  rhythm: Rhythm;
  /** Colours in the order printed. */
  colours: Colour[];
  /** Directional light: shown on a narrow sector only. */
  directional: boolean;
}

const MORSE: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
};

type Kind = 'F' | 'FFl' | 'Fl' | 'LFl' | 'Oc' | 'Iso' | 'Q' | 'VQ' | 'UQ' | 'IQ' | 'IVQ' | 'IUQ' | 'Mo';

interface Part {
  kind: Kind;
  group: string;
}

/** Seconds between flashes for the quick classes. */
const QUICK: Partial<Record<Kind, number>> = { Q: 1, VQ: 0.5, UQ: 0.25, IQ: 1, IVQ: 0.5, IUQ: 0.25 };

const round = (n: number) => Math.round(n * 100) / 100;

function normalise(s: string): string {
  return (
    s
      .replace(/\((?:vert|horiz|occas|U\.S\.)\.?\)/gi, ' ')
      .replace(/\bAero\b\.?/g, ' ')
      .replace(/\bFL\b/g, 'Fl')
      .replace(/I\.V\.Q/g, 'IVQ')
      .replace(/I\.U\.Q/g, 'IUQ')
      .replace(/V\.Q/g, 'VQ')
      .replace(/U\.Q/g, 'UQ')
      .replace(/I\.Q/g, 'IQ')
      .replace(/L\.Fl/g, 'LFl')
      .replace(/F\.Fl/g, 'FFl')
      // NGA prints dots between every part ("Fl.(2)W.R."); USCG prints spaces.
      .replace(/\./g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const PART = /\b(FFl|LFl|Fl|F|Oc|Iso|IVQ|IUQ|IQ|VQ|UQ|Q|Mo)\b\s*(?:\(([^)]*)\))?/g;
const COLOUR = /\b(Bu|Vi|Or|[WRGY]+)\b/g;

function colourList(s: string): Colour[] {
  const out: Colour[] = [];
  for (const m of s.matchAll(COLOUR)) {
    const t = m[1];
    if (t === 'Bu' || t === 'Vi' || t === 'Or') out.push(t);
    else for (const ch of t) out.push(ch as Colour);
  }
  return [...new Set(out)];
}

/** Light-on durations and gaps for one group of a class, before the long eclipse. */
function groupSteps(kind: Kind, group: string, period: number): { on: number; off: number }[] {
  const out: { on: number; off: number }[] = [];
  if (kind === 'Mo') {
    const code = MORSE[group.trim().toUpperCase()] ?? '.-';
    for (const ch of code) out.push({ on: ch === '-' ? 1.5 : 0.5, off: 0.5 });
    return out;
  }
  const quick = QUICK[kind];
  const counts = group
    .split('+')
    .map((g) => parseInt(g, 10))
    .filter((n) => n > 0);
  if (quick) {
    const n = counts[0] ?? 1;
    for (let i = 0; i < n; i++) out.push({ on: quick * 0.4, off: quick * 0.6 });
    return out;
  }
  if (kind === 'Oc') {
    // Occulting: light longer than dark; a group counts its eclipses.
    const n = counts[0] ?? 1;
    const e = Math.min(1, Math.max(0.5, period * 0.12));
    for (let i = 0; i < n; i++) out.push({ on: i === 0 ? 0 : 1, off: e });
    return out;
  }
  // Fl and LFl: a flash shorter than the eclipse after it.
  const long = kind === 'LFl';
  const n = counts.reduce((a, b) => a + b, 0) || 1;
  const flash = long ? Math.min(2, period * 0.3) : n === 1 ? Math.min(1, Math.max(0.2, period * 0.12)) : 0.5;
  const gap = n === 1 ? 0 : Math.min(1.5, Math.max(0.6, (period * 0.5 - n * flash) / Math.max(1, n - 1)));
  // In a composite group (2+1) the groups are parted by a longer eclipse.
  const groups = counts.length ? counts : [1];
  groups.forEach((g, gi) => {
    for (let i = 0; i < g; i++) {
      const lastOfGroup = i === g - 1;
      const lastOfAll = lastOfGroup && gi === groups.length - 1;
      out.push({ on: flash, off: lastOfAll ? 0 : lastOfGroup ? gap * 2.2 : gap });
    }
  });
  return out;
}

/** Parse a printed characteristic into a rhythm, its colours, and whether it is directional. */
export function parseCharacter(text: string): Character | null {
  const lines = text.split(';').map((l) => l.trim());
  const head = lines[0] ?? '';
  if (/^STROBE/i.test(head)) {
    return {
      rhythm: { label: 'Q.W', period: 1, steps: [0.1, ON, 0.9, 0], base: 0 },
      colours: ['W'],
      directional: false,
    };
  }
  const directional = /\bDir\b/.test(head);
  const alternating = /\bAl\b/.test(head);
  let s = normalise(head.replace(/\bDir\b\.?/g, ' ').replace(/\bAl\b\.?/g, ' '));
  s = s.replace(/^\d+\s+/, '');

  // Period: NGA gives it on its own line; USCG ends the head with it.
  let period = 0;
  const pl = lines.find((l) => /^period/i.test(l));
  const pm = pl?.match(/([\d.]+)\s*s/) ?? s.match(/([\d.]+)\s*s\b/i);
  if (pm) period = parseFloat(pm[1]);
  const printed = period;
  s = s.replace(/([\d.]+)\s*s\b/i, ' ');

  const parts: Part[] = [];
  let colourText = s;
  for (const m of s.matchAll(PART)) {
    parts.push({ kind: m[1] as Kind, group: m[2] ?? '' });
    colourText = colourText.replace(m[0], ' ');
  }
  const colours = colourList(colourText.replace(/\+/g, ' '));
  if (!colours.length) colours.push('W');
  if (!parts.length) parts.push({ kind: 'F', group: '' });

  const first = parts[0];
  const allFixed = parts.every((p) => p.kind === 'F');

  // NGA often prints every phase: "fl. 1.0s, ec. 4.0s" per flash.
  const phases: number[] = [];
  for (const l of lines.slice(1)) {
    const m = l.match(/^fl\.?\s*([\d.]+)\s*s\s*,\s*ec\.?\s*([\d.]+)\s*s/i);
    if (m) phases.push(parseFloat(m[1]), parseFloat(m[2]));
  }
  const phaseSum = phases.reduce((a, b) => a + b, 0);

  let steps: number[] = [];
  let base = 0;

  if (allFixed && !alternating) {
    period = 0;
  } else if (allFixed && alternating) {
    // Alternating fixed light: each colour in turn, no dark.
    if (!period) period = 2 * colours.length;
    for (const c of colours) steps.push(period / colours.length, code(c));
  } else {
    if (first.kind === 'Iso') {
      if (!period) period = 2;
      steps = [period / 2, ON, period / 2, 0];
    } else if (phases.length && period && Math.abs(phaseSum - period) < Math.max(0.3, period * 0.05)) {
      for (let i = 0; i < phases.length; i += 2) steps.push(phases[i], ON, phases[i + 1], 0);
    } else if (!period && parts.length === 1 && QUICK[first.kind] && !first.group && first.kind[0] !== 'I') {
      // Continuous quick: Q, VQ, UQ with no group or period.
      const q = QUICK[first.kind]!;
      period = q;
      steps = [q * 0.4, ON, q * 0.6, 0];
    } else {
      if (!period) {
        period =
          first.kind === 'Mo'
            ? 8
            : first.kind === 'LFl'
              ? 10
              : first.kind === 'Oc'
                ? 4
                : QUICK[first.kind]
                  ? 10
                  : first.group
                    ? 10
                    : 4;
      }
      for (const p of parts) {
        if (p.kind === 'F') continue;
        const kind: Kind = p.kind === 'FFl' ? 'Fl' : p.kind;
        if (kind === 'IQ' || kind === 'IVQ' || kind === 'IUQ') {
          // Interrupted quick: quick flashes, then a long eclipse.
          const q = QUICK[kind]!;
          const n = Math.max(1, Math.floor((period * 0.7) / q));
          for (let i = 0; i < n; i++) steps.push(q * 0.4, ON, q * 0.6, 0);
          continue;
        }
        if (kind === 'Oc') {
          const g = groupSteps('Oc', p.group, period);
          for (const { on, off } of g) {
            if (on) steps.push(on, ON);
            steps.push(off, 0);
          }
          continue;
        }
        for (const { on, off } of groupSteps(kind, p.group, period)) {
          steps.push(on, ON);
          if (off) steps.push(off, 0);
        }
      }
      const used = steps.reduce((a, v, i) => (i % 2 === 0 ? a + v : a), 0);
      if (first.kind === 'Oc') {
        // Occulting: the remainder of the period is light.
        steps.unshift(Math.max(0.2, period - used), ON);
      } else if (period > used) {
        steps.push(period - used, 0);
      } else {
        period = used;
      }
      if (parts.some((p) => p.kind === 'FFl') || (parts.some((p) => p.kind === 'F') && parts.length > 1)) base = 0.3;
    }
    if (alternating && colours.length > 1) {
      // Alternating: the flashes take each colour in turn, so a cycle may span several periods.
      const flashes = steps.filter((_, i) => i % 2 === 1 && steps[i] === ON).length || 1;
      const reps = colours.length / gcd(flashes, colours.length);
      const out: number[] = [];
      let k = 0;
      for (let r = 0; r < reps; r++)
        for (let i = 0; i < steps.length; i += 2)
          out.push(steps[i], steps[i + 1] === ON ? code(colours[k++ % colours.length]) : steps[i + 1]);
      steps = out;
      period *= reps;
    }
  }

  steps = steps.map((v, i) => (i % 2 === 0 ? round(v) : v));
  const total = steps.reduce((a, v, i) => (i % 2 === 0 ? a + v : a), 0);
  if (steps.length) period = round(total);
  const rhythm = { label: label(parts, colours, alternating, directional, printed), period, steps, base };
  return { rhythm, colours, directional };
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** Chart abbreviation in the Admiralty style: "Fl(2)WR.10s", "Q.G", "Dir.WRG". */
function label(parts: Part[], colours: Colour[], al: boolean, dir: boolean, printed: number): string {
  let cls = parts
    .map((p) => {
      const k = p.kind === 'FFl' ? 'F.Fl' : p.kind;
      return p.group ? `${k}(${p.group.replace(/\s+/g, '')})` : k;
    })
    .join('+');
  if (dir && cls === 'F') cls = '';
  const sep = cls && !cls.endsWith(')') ? '.' : '';
  const per = printed ? `.${round(printed)}s` : '';
  return `${dir ? 'Dir.' : ''}${al ? 'Al.' : ''}${cls}${sep}${colours.join('')}${per}`;
}

/**
 * The light's level and colour code at time t (seconds), for one cycle of its
 * rhythm. Each change is eased over a few tens of milliseconds, as a lamp is.
 */
export function levelAt(r: Rhythm, t: number): { level: number; code: number } {
  if (!r.period || !r.steps.length) return { level: 1, code: ON };
  let x = t % r.period;
  if (x < 0) x += r.period;
  for (let i = 0; i < r.steps.length; i += 2) {
    const d = r.steps[i];
    if (x < d) {
      const c = r.steps[i + 1];
      if (!c) return { level: r.base, code: ON };
      const edge = Math.min(x, d - x);
      const ramp = Math.min(1, edge / 0.06);
      return { level: r.base + (1 - r.base) * ramp, code: c };
    }
    x -= d;
  }
  return { level: r.base, code: ON };
}
