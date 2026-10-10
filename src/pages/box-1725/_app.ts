// Box 1725: wires the case file and the roadside together.

export function start(): void {
  const root = document.querySelector<HTMLElement>('[data-box1725]');
  if (!root) return;

  const reviewed = root.querySelector<HTMLElement>('[data-reviewed]');
  if (reviewed) reviewed.textContent = fileDate(Date.now()).split(' ').slice(0, 3).join(' ');

  for (const input of root.querySelectorAll<HTMLInputElement>('[data-clearance-switch] input')) {
    input.addEventListener('change', () => {
      if (input.checked) root.dataset.clearance = input.value;
    });
  }
}

/** The file's date format: 10 OCT 2026 06:41. */
export function fileDate(ms: number): string {
  const d = new Date(ms);
  const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())} ${month} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
