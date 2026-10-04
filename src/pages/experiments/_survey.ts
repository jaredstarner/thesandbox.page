// Client survey: runs the test table in this browser and stamps each row.
import { TECHNIQUES, normalizeTag, type TestResult } from './_tests';
import { assess, type Finding } from './_verdict';

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

export async function survey() {
  const now = new Date();
  const rows = [...document.querySelectorAll<HTMLElement>('.row')];
  for (const row of rows) {
    const tags = (row.dataset.tags ?? '').split(' ').filter(Boolean);
    const requiresAttr = row.dataset.requires;
    const required = new Set((requiresAttr ?? '').split(' ').filter(Boolean).map(normalizeTag));
    const findings: Finding[] = [];
    for (const tag of tags) {
      const key = normalizeTag(tag);
      const pending = run(key);
      const result = pending ? await pending : null;
      findings.push({ key, label: TECHNIQUES[key]?.label ?? tag, required: required.has(key), result });
      const li = row.querySelector<HTMLElement>(`.c-medium li[data-key="${key}"]`);
      if (li && result) li.dataset.state = result.state === 'detected' ? 'detected' : required.has(key) ? 'failed-required' : result.state === 'absent' ? 'absent' : 'grey';
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
    if (text) text.textContent = assessment.reason || assessment.word;
  }
}
