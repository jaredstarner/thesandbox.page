// Build-time object classes and handling notes. The register's own vocabulary,
// in a containment-file voice, but every word is derived from an object's
// metadata and the Baseline data: nothing here is invented per object.
import { baselineNote } from './_baseline';
import { TECHNIQUES, normalizeTag } from './_tests';

export type ObjectClass = 'stable' | 'volatile' | 'uncataloged';

export interface Classification {
  cls: ObjectClass;
  /** The class as printed, for example "Volatile". */
  word: string;
  /** Why the object has this class, as one or two sentences. */
  reason: string;
  /** Handling notes, one sentence each, from the techniques the object uses. */
  handling: string[];
}

const list = (items: string[]) =>
  items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * Stable: everything the object requires is Baseline widely available.
 * Volatile: it requires something newly available or not yet Baseline.
 * Uncataloged: requirements are not cataloged, or Baseline has no data on them.
 */
export function classify(tags: string[], requires?: string[]): Classification {
  const handling = [
    ...new Set(tags.map((tag) => TECHNIQUES[normalizeTag(tag)]?.handling).filter((note): note is string => !!note)),
  ];
  if (handling.length === 0) handling.push('No special handling.');

  if (!requires) {
    return {
      cls: 'uncataloged',
      word: 'Uncataloged',
      reason: 'Requirements not cataloged, so the register cannot say which browsers can display it.',
      handling,
    };
  }
  if (requires.length === 0) {
    return { cls: 'stable', word: 'Stable', reason: 'It requires nothing in particular: every technique it uses is an enhancement.', handling };
  }

  const required = requires.map((tag) => {
    const key = normalizeTag(tag);
    const technique = TECHNIQUES[key];
    return { label: technique?.label ?? tag, note: baselineNote(technique?.webFeature) };
  });

  const limited = required.filter((r) => r.note?.tier === 'limited');
  const newly = required.filter((r) => r.note?.tier === 'newly');
  const untracked = required.filter((r) => !r.note);

  if (limited.length > 0) {
    return {
      cls: 'volatile',
      word: 'Volatile',
      reason: `Requires ${list(limited.map((r) => r.label))}, not yet available in every major browser.`,
      handling,
    };
  }
  if (newly.length > 0) {
    const latest = newly.reduce((a, b) => ((a.note!.year ?? 0) >= (b.note!.year ?? 0) ? a : b));
    return {
      cls: 'volatile',
      word: 'Volatile',
      reason: `Requires ${list(newly.map((r) => r.label))}, Baseline only since ${latest.note!.year}. Browsers from before then may not display it.`,
      handling,
    };
  }
  if (untracked.length > 0) {
    return {
      cls: 'uncataloged',
      word: 'Uncataloged',
      reason: `Requires ${list(untracked.map((r) => r.label))}, which Baseline does not track.`,
      handling,
    };
  }
  return {
    cls: 'stable',
    word: 'Stable',
    reason: 'Everything it requires is Baseline widely available.',
    handling,
  };
}
