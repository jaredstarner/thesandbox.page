// The call slip: search the register, and after the survey, filter it to the
// objects functional in this browser. "/" focuses the field; Esc clears it.
import { FUNCTIONAL_VERDICTS } from './_verdict';

// Date-shaped queries match whole keys (see dateKeys), so "3 oct" never finds 13 Oct.
const DATE_SHAPED = [
  /^\d{1,2} [a-z]+( \d{4})?$/,
  /^[a-z]+ \d{1,2}$/,
  /^[a-z]+ \d{4}$/,
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{4}$/,
];

export function callSlip(): { refresh(): void } {
  const form = document.querySelector<HTMLFormElement>('.call-slip');
  const input = form?.querySelector<HTMLInputElement>('input[name="q"]');
  const check = form?.querySelector<HTMLInputElement>('input[name="functional"]');
  const tally = form?.querySelector('.call-tally');
  const announcer = document.querySelector('[data-announce]');
  const rows = [...document.querySelectorAll<HTMLElement>('.row')];
  const folios = [...document.querySelectorAll<HTMLElement>('.folio')];
  if (!form || !input || !check || !tally) return { refresh() {} };

  const total = rows.length;
  let timer: number | undefined;

  const apply = (announce: boolean) => {
    const query = input.value.trim().toLowerCase().replace(/\s+/g, ' ');
    const dateShaped = DATE_SHAPED.some((pattern) => pattern.test(query));
    const onlyFunctional = check.checked && !check.disabled;
    let shown = 0;
    for (const row of rows) {
      const haystack = row.dataset.search ?? '';
      const found = !query || (dateShaped ? haystack.includes(`|${query}|`) : haystack.includes(query));
      const keep = found && (!onlyFunctional || FUNCTIONAL_VERDICTS.has(row.dataset.verdict ?? ''));
      row.hidden = !keep;
      if (keep) shown++;
    }
    for (const folio of folios) folio.toggleAttribute('data-empty', !folio.querySelector('.row:not([hidden])'));
    tally.textContent = `${shown} of ${total} ${total === 1 ? 'object' : 'objects'}`;
    if (announce && announcer) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => (announcer.textContent = tally.textContent), 700);
    }
  };

  form.addEventListener('submit', (event) => event.preventDefault());
  input.addEventListener('input', () => apply(true));
  check.addEventListener('change', () => apply(true));
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !input.value) return;
    input.value = '';
    apply(true);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')) return;
    event.preventDefault();
    input.focus();
  });

  return {
    /** After a survey: enable the functional filter once verdicts exist, and reapply. */
    refresh() {
      check.disabled = !rows.some((row) => row.dataset.verdict);
      apply(false);
    },
  };
}
