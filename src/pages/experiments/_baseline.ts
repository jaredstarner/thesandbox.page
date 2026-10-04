// Build-time Baseline notes from the web-features dataset. Nothing here ships
// to the browser: the page prints the results into its HTML.
import { features } from 'web-features';

export interface BaselineNote {
  /** "Baseline 2026", or "Limited". */
  short: string;
  /** A longer line for the condition report, without the feature's name. */
  long: string;
  /** The year the feature reached Baseline, or null when it has not. */
  year: number | null;
  tier: 'widely' | 'newly' | 'limited';
  /** "18 Aug 2026", or null when the feature has not reached Baseline. */
  since: string | null;
}

const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Read a feature's Baseline status; null when the ID is unknown to the dataset. */
export function baselineNote(id: string | undefined): BaselineNote | null {
  if (!id) return null;
  const feature = (features as Record<string, unknown>)[id] as
    | { kind: string; status?: { baseline: 'high' | 'low' | false; baseline_low_date?: string } }
    | undefined;
  if (!feature || feature.kind !== 'feature' || !feature.status) return null;
  const { baseline, baseline_low_date: low } = feature.status;
  if (baseline === false || !low) {
    return { short: 'Limited', long: 'Limited availability, not yet Baseline', year: null, tier: 'limited', since: null };
  }
  // Dates may carry a "≤" prefix when the exact release is unknown.
  const clean = low.replace(/^[^\d]+/, '');
  const year = Number(clean.slice(0, 4));
  const since = longDate.format(new Date(`${clean}T00:00:00Z`));
  const tier = baseline === 'high' ? 'widely' : 'newly';
  return { short: `Baseline ${year}`, long: `Baseline ${tier} available, since ${since}`, year, tier, since };
}
