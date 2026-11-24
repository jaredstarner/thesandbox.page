// Opening hours from OpenStreetMap's `opening_hours` tag, for the common forms ("Mo-Sa 09:00-17:30;
// Su 10:00-16:00", "24/7", "Tu off"). Rules with months, holidays, or sunrise are skipped rather
// than guessed at; a place whose hours can't be read falls back to the hours its kind keeps.

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const SELECTOR = new RegExp(`^(${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*)?\\s*(.*)$`);

function daysIn(sel: string): number[] {
  const out: number[] = [];
  for (const part of sel.split(',')) {
    const [a, b] = part.split('-').map((d) => DAYS.indexOf(d));
    if (b === undefined) out.push(a);
    else
      for (let d = a; ; d = (d + 1) % 7) {
        out.push(d);
        if (d === b) break;
      }
  }
  return out;
}

/** The spans a place is open on a weekday (0 is Sunday), in minutes; null when the tag can't be read. */
export function spansOn(tag: string | undefined, weekday: number): [number, number][] | null {
  if (!tag) return null;
  const table: ([number, number][] | undefined)[] = new Array(7);
  let any = false;
  for (const raw of tag.split(/;|\|\|/)) {
    const rule = raw.trim();
    if (!rule) continue;
    if (rule === '24/7') {
      table.fill([[0, 1440]]);
      any = true;
      continue;
    }
    const m = SELECTOR.exec(rule);
    if (!m) continue;
    const rest = m[2];
    if (/[A-Z][a-z]{2}|PH|SH|sun|dawn|dusk|week|"/.test(rest)) continue;
    const days = m[1] ? daysIn(m[1]) : [0, 1, 2, 3, 4, 5, 6];
    if (/^(off|closed)$/.test(rest)) {
      for (const d of days) table[d] = [];
      any = true;
      continue;
    }
    const spans: [number, number][] = [];
    for (const t of rest.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)) {
      const a = Number(t[1]) * 60 + Number(t[2]);
      let b = Number(t[3]) * 60 + Number(t[4]);
      if (b <= a) b += 1440;
      spans.push([a, b]);
    }
    if (!spans.length) continue;
    for (const d of days) table[d] = spans;
    any = true;
  }
  if (!any) return null;
  return table[weekday] ?? [];
}

/** When a place shuts on a weekday, counting from a moment it is open; null if it isn't open then. */
export function closesAfter(spans: [number, number][], at: number): number | null {
  for (const [a, b] of spans) if (at >= a && at < b) return b;
  return null;
}

/** When it next opens after a moment on the same day, if it does. */
export function opensAfter(spans: [number, number][], at: number): number | null {
  let best: number | null = null;
  for (const [a] of spans) if (a > at && (best === null || a < best)) best = a;
  return best;
}
