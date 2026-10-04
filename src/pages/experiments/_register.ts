// Build-time numbering and grouping for the accession register. Pure: no I/O.
import type { Experiment } from '../../experiments/list';

export interface RegisterEntry extends Experiment {
  /** Permanent accession number, TSP.YYYY.MMDD.N. */
  accession: string;
  /** The UTC ship date as YYYY-MM-DD. */
  iso: string;
  /** The day's lot as MMDD, which the search accepts. */
  lot: string;
  /** Ledger line within its folio, 1-based. Not permanent. */
  line: number;
}

export interface Folio {
  /** Anchor id, folio-YYYY-MM. */
  id: string;
  /** Months since the first experiment's month, plus one. */
  number: number;
  /** "October 2026". */
  label: string;
  entries: RegisterEntry[];
}

const monthLabel = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayParts = new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "03 Oct 2026", fixed width for the Accessioned column. */
export function formatEntryDate(date: Date): string {
  const parts = Object.fromEntries(dayParts.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.day} ${parts.month} ${parts.year}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const shortMonth = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });
const longMonth = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' });

/**
 * Every way the call slip accepts this entry's date, lowercased: "3 oct",
 * "03 oct 2026", "october 3", "2026-10-03", the lot "1003", the year, and the
 * accession number. The client matches a date-shaped query against whole keys,
 * so "3 oct" never finds 13 Oct.
 */
export function dateKeys(entry: RegisterEntry): string[] {
  const day = entry.date.getUTCDate();
  const year = entry.date.getUTCFullYear();
  const mon = shortMonth.format(entry.date).toLowerCase();
  const month = longMonth.format(entry.date).toLowerCase();
  const days = [String(day), pad2(day)];
  return [
    ...days.flatMap((d) => [`${d} ${mon}`, `${d} ${month}`, `${d} ${mon} ${year}`, `${d} ${month} ${year}`]),
    `${mon} ${day}`,
    `${month} ${day}`,
    `${month} ${year}`,
    entry.iso,
    entry.lot,
    String(year),
    entry.accession.toLowerCase(),
  ];
}

/**
 * Accession numbers are TSP.YYYY.MMDD.N: year, the day's lot, and the object's
 * ordinal within that lot, ordered by slug ascending with no zero padding.
 *
 * Every part derives from the ship date in the metadata, which never changes,
 * so adding or removing any other experiment never renumbers an existing
 * object. A lot can only gain members on its own day, because metadata dates
 * are ship dates; once that UTC day ends, its numbers are frozen.
 */
export function accessionNumbers(experiments: Experiment[]): Map<string, { accession: string; iso: string; lot: string }> {
  const lots = new Map<string, Experiment[]>();
  for (const experiment of experiments) {
    const iso = experiment.date.toISOString().slice(0, 10);
    const lot = lots.get(iso) ?? [];
    lot.push(experiment);
    lots.set(iso, lot);
  }

  const numbers = new Map<string, { accession: string; iso: string; lot: string }>();
  for (const [iso, members] of lots) {
    const [year, month, day] = iso.split('-');
    const lot = `${month}${day}`;
    [...members]
      .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
      .forEach((experiment, index) => {
        numbers.set(experiment.slug, { accession: `TSP.${year}.${lot}.${index + 1}`, iso, lot });
      });
  }
  return numbers;
}

/** One folio per UTC month, newest month first, rows newest first. */
export function buildFolios(experiments: Experiment[]): Folio[] {
  if (experiments.length === 0) return [];
  const numbers = accessionNumbers(experiments);
  const monthIndex = (date: Date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
  const first = Math.min(...experiments.map((experiment) => monthIndex(experiment.date)));

  const months = new Map<number, Experiment[]>();
  for (const experiment of experiments) {
    const key = monthIndex(experiment.date);
    const list = months.get(key) ?? [];
    list.push(experiment);
    months.set(key, list);
  }

  return [...months.entries()]
    .sort(([a], [b]) => b - a)
    .map(([key, members]) => {
      const sorted = members
        .map((experiment) => ({ ...experiment, ...numbers.get(experiment.slug)! }))
        .sort((a, b) => {
          if (a.iso !== b.iso) return a.iso < b.iso ? 1 : -1;
          const ordinal = (accession: string) => Number(accession.split('.').at(-1));
          return ordinal(a.accession) - ordinal(b.accession);
        });
      const year = Math.floor(key / 12);
      const month = (key % 12) + 1;
      return {
        id: `folio-${year}-${pad2(month)}`,
        number: key - first + 1,
        label: monthLabel.format(new Date(Date.UTC(year, month - 1, 1))),
        entries: sorted.map((entry, index) => ({ ...entry, line: index + 1 })),
      };
    });
}
