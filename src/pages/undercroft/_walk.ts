// Optional: the undercroft walks without this. It adds arrow and WASD keys,
// and slides the plate round when you turn, using a same-page view
// transition around the fragment change.

const KEYS: Record<string, string> = {
  ArrowUp: 'ahead',
  KeyW: 'ahead',
  ArrowDown: 'back',
  KeyS: 'back',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

type Transitioning = Document & {
  startViewTransition?: (options: { update: () => void; types: string[] }) => unknown;
};

export function walk() {
  const root = document.querySelector<HTMLElement>('.undercroft.crawl');
  if (!root) return;
  const active = () => root.querySelector<HTMLElement>(`.view[data-dir="${location.hash.slice(1) || 'n'}"]`) ?? root.querySelector<HTMLElement>('.view');

  root.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-turn]');
    const doc = document as Transitioning;
    if (!link || !doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    const hash = link.hash;
    doc.startViewTransition({ update: () => void (location.hash = hash), types: [`turn-${link.dataset.turn}`] });
  });

  addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    const key = KEYS[event.code];
    if (!key) return;
    const target = active()?.querySelector<HTMLAnchorElement>(`.pad a[data-key="${key}"]`);
    event.preventDefault();
    target?.click();
  });
}
