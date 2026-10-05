// Client survey: measures this browser, runs the test table, and writes each
// row's verdict, condition report, and memory note. What the visitor sees
// arrive (form values inking in, lights, stamps, the foot) is the ceremony's
// job; this module only writes the results. Nothing measured leaves the browser.
import { readEnvironment, refreshText, type EnvironmentValues } from './_environment';
import { TECHNIQUES, normalizeTag, type SurveyEnvironment, type TestResult } from './_tests';
import { FUNCTIONAL_VERDICTS, VERDICT_WORDS, assess, type Finding, type Verdict } from './_verdict';

const memo = new Map<string, Promise<TestResult>>();

function run(key: string): Promise<TestResult> | null {
  const technique = TECHNIQUES[key];
  if (!technique?.test) return null;
  let pending = memo.get(key);
  if (!pending) {
    pending = Promise.resolve()
      .then(() => technique.test!())
      .catch((error: unknown) => ({ state: 'unknown' as const, detail: `test threw: ${String(error)}` }));
    memo.set(key, pending);
  }
  return pending;
}

const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n: number) => String(n).padStart(2, '0');
const stampDate = (d: Date) =>
  `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const stateWords: Record<TestResult['state'], string> = {
  detected: 'Detected',
  absent: 'Absent',
  blocked: 'Blocked',
  unknown: 'Undetermined',
};

// ---- memory: the last verdict per accession number, for this viewer only ----

const MEMORY_KEY = 'tsp.register.v1';

interface Memory {
  at: string;
  verdicts: Record<string, Verdict>;
}

function recall(): Memory | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? 'null') as Memory | null;
    if (!parsed || typeof parsed.at !== 'string' || typeof parsed.verdicts !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function remember(memory: Memory) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Storage blocked: the page works the same, without memory notes.
  }
}

/** "earlier today", or "of 1 Oct" (with the year when it differs). */
function since(iso: string, now: Date): string | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  if (then.toDateString() === now.toDateString()) return 'earlier today';
  const format = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(then.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return `of ${format.format(then)}`;
}

// ---- one row ----------------------------------------------------------------

const lightState = (result: TestResult, required: boolean) =>
  result.state === 'detected' ? 'detected' : required ? 'failed-required' : result.state === 'absent' ? 'absent' : 'gray';

/**
 * Write a row's results. The Medium column's lights get data-result, which the
 * ceremony turns into data-state as the lamp ticks them; the condition report
 * sits in a closed disclosure, so its lights take data-state at once.
 */
async function surveyRow(row: HTMLElement, env: SurveyEnvironment, now: Date): Promise<Verdict> {
  const tags = (row.dataset.tags ?? '').split(' ').filter(Boolean);
  const requiresAttr = row.dataset.requires;
  const required = new Set((requiresAttr ?? '').split(' ').filter(Boolean).map(normalizeTag));
  const findings: Finding[] = [];
  const notes = new Set<string>();

  for (const tag of tags) {
    const key = normalizeTag(tag);
    const technique = TECHNIQUES[key];
    const pending = run(key);
    const result = pending ? await pending : null;
    findings.push({ key, label: technique?.label ?? tag, required: required.has(key), result });
    if (result) {
      const state = lightState(result, required.has(key));
      const light = row.querySelector<HTMLElement>(`.c-medium [data-key="${key}"]`);
      if (light) light.dataset.result = state;
      const evidence = row.querySelector<HTMLElement>(`.r-evidence [data-key="${key}"]`);
      if (evidence) {
        evidence.dataset.state = state;
        evidence.querySelector('.r-state')!.textContent = `${stateWords[result.state]} (${result.detail})`;
      }
    }
    const note = technique?.context ? await Promise.resolve(technique.context(env)).catch(() => null) : null;
    if (note) notes.add(note);
  }

  const untested = [...required].filter((key) => !TECHNIQUES[key]?.test);
  const assessment = assess(findings, requiresAttr !== undefined, untested);
  row.dataset.verdict = assessment.verdict;

  const stamp = row.querySelector<HTMLElement>('.stamp');
  if (stamp) {
    stamp.querySelector('.s-verdict')!.textContent = assessment.word;
    stamp.querySelector('.s-date')!.textContent = stampDate(now);
  }
  const text = row.querySelector('.cond-text');
  if (text) text.textContent = assessment.reason ? `${assessment.word}: ${assessment.reason}` : assessment.word;

  const envList = row.querySelector('.r-env ul');
  if (envList) {
    envList.replaceChildren(
      ...[...notes].map((note) => {
        const li = document.createElement('li');
        li.textContent = note;
        return li;
      }),
    );
    for (const el of row.querySelectorAll<HTMLElement>('.r-env, .r-env-t')) el.hidden = notes.size === 0;
  }
  return assessment.verdict;
}

// ---- the whole survey -------------------------------------------------------

export interface SurveyHooks {
  /** The form's values are known (all but the refresh rate). */
  environment(values: Partial<EnvironmentValues>, repeatVisit: boolean): void;
  /** The refresh rate has been measured, or could not be. */
  refresh(values: Partial<EnvironmentValues>): void;
}

export interface SurveyOutcome {
  rows: HTMLElement[];
  at: Date;
  /** "2 of 2 objects functional in this browser." */
  tally: string;
  /** The foot's memory line, or null on a first visit. */
  memory: string | null;
  /** True when this viewer has surveyed before and no verdict changed. */
  unchanged: boolean;
}

/** Run the survey and write its results. Returns null, after saying so on the page, if it could not run. */
export async function survey(hooks: SurveyHooks): Promise<SurveyOutcome | null> {
  const page = document.documentElement;
  const rows = [...document.querySelectorAll<HTMLElement>('.row')];
  const resurvey = document.querySelector<HTMLButtonElement>('[data-resurvey]');
  const announcer = document.querySelector('[data-announce]');

  page.dataset.survey = 'running';
  if (resurvey) resurvey.disabled = true;
  memo.clear();

  try {
    const now = new Date();
    const previous = recall();
    const reading = await readEnvironment();
    hooks.environment(reading.values, previous !== null);
    reading.env.refreshHz = await reading.refresh;
    hooks.refresh({ refresh: refreshText(reading.env.refreshHz) });

    const verdicts: Record<string, Verdict> = {};
    let changed = 0;
    const when = previous && since(previous.at, now);
    for (const row of rows) {
      const verdict = await surveyRow(row, reading.env, now);
      const acc = row.dataset.acc!;
      verdicts[acc] = verdict;

      const was = previous?.verdicts[acc];
      const differs = was !== undefined && Object.hasOwn(VERDICT_WORDS, was) && was !== verdict;
      const memoryNote = row.querySelector<HTMLElement>('.cond-memory');
      if (memoryNote) {
        memoryNote.hidden = !differs;
        memoryNote.textContent = differs
          ? `Condition changed since your survey ${when ?? 'last time'}: was ${VERDICT_WORDS[was].toUpperCase()}.`
          : '';
      }
      if (differs) changed++;
    }

    const functional = Object.values(verdicts).filter((v) => FUNCTIONAL_VERDICTS.has(v)).length;
    const total = rows.length;
    const tally = `${functional} of ${total} ${total === 1 ? 'object' : 'objects'} functional in this browser.`;
    if (announcer) announcer.textContent = tally;

    const memory = !when
      ? null
      : changed === 0
        ? `Re-surveyed: no change since your survey ${when}.`
        : `${changed} ${changed === 1 ? 'condition' : 'conditions'} changed since your survey ${when}.`;

    remember({ at: now.toISOString(), verdicts });
    page.dataset.survey = 'done';
    return { rows, at: now, tally, memory, unchanged: !!when && changed === 0 };
  } catch (error) {
    console.error('Accession register: the survey could not run.', error);
    for (const row of rows) {
      delete row.dataset.verdict;
      const text = row.querySelector('.cond-text');
      if (text) text.textContent = 'Survey could not run in this browser';
    }
    const tally = document.querySelector('.tally');
    if (tally) tally.textContent = 'The survey could not run in this browser.';
    page.dataset.survey = 'failed';
    return null;
  } finally {
    if (resurvey) resurvey.disabled = false;
  }
}
