// The verdict rules, honest by construction. Pure, and kept in one place so
// the rules stay readable; the survey and the call slip both read them.
import type { TestResult } from './_tests';

export type Verdict = 'functional' | 'reduced' | 'inoperable' | 'uncertain' | 'not-surveyed';

/** Each verdict's word on the stamp. */
export const VERDICT_WORDS: Record<Verdict, string> = {
  functional: 'Functional',
  reduced: 'Reduced',
  inoperable: 'Inoperable here',
  uncertain: 'Uncertain',
  'not-surveyed': 'Not surveyed',
};

/** Verdicts the call slip counts as functional in this browser. */
export const FUNCTIONAL_VERDICTS: ReadonlySet<string> = new Set<Verdict>(['functional', 'reduced']);

export interface Finding {
  key: string;
  label: string;
  required: boolean;
  /** Null for technique notes with no test. */
  result: TestResult | null;
}

export interface Assessment {
  verdict: Verdict;
  /** The stamp's word. */
  word: string;
  /** One line of reason, empty when there is nothing to add. */
  reason: string;
}

const list = (labels: string[]) =>
  labels.length <= 2 ? labels.join(' and ') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;

const failed = (finding: Finding) => finding.result !== null && finding.result.state !== 'detected';

const why = (findings: Finding[]) =>
  list(
    findings.map((f) => {
      const state = f.result?.state;
      if (state === 'blocked') return `${f.label} blocked`;
      if (state === 'unknown') return `${f.label} undetermined`;
      return `no ${f.label}`;
    }),
  );

/**
 * 1. Every tested tag detected: FUNCTIONAL.
 * 2. Failures, requires present, none required: FUNCTIONAL, REDUCED.
 * 3. Any required key fails: INOPERABLE HERE.
 * 4. Failures and no requires: UNCERTAIN; the register never guesses.
 * 5. A required key has no test, or nothing is testable: NOT SURVEYED.
 */
export function assess(findings: Finding[], hasRequires: boolean, requiredWithoutTest: string[]): Assessment {
  const tested = findings.filter((f) => f.result !== null);
  if (requiredWithoutTest.length > 0) {
    return {
      verdict: 'not-surveyed',
      word: VERDICT_WORDS['not-surveyed'],
      reason: `requires ${list(requiredWithoutTest)}, which this register cannot test`,
    };
  }
  if (tested.length === 0) {
    return {
      verdict: 'not-surveyed',
      word: VERDICT_WORDS['not-surveyed'],
      reason: 'nothing catalogued that this browser can be tested for',
    };
  }
  const failures = tested.filter(failed);
  if (failures.length === 0) return { verdict: 'functional', word: VERDICT_WORDS.functional, reason: '' };
  if (!hasRequires) {
    return { verdict: 'uncertain', word: VERDICT_WORDS.uncertain, reason: `${why(failures)}; requirements not catalogued` };
  }
  const requiredFailures = failures.filter((f) => f.required);
  if (requiredFailures.length > 0) {
    return { verdict: 'inoperable', word: VERDICT_WORDS.inoperable, reason: why(requiredFailures) };
  }
  return { verdict: 'reduced', word: VERDICT_WORDS.reduced, reason: why(failures) };
}
