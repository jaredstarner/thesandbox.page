import { PROGRAM_IDS, type Lab, type Program, type ProgramId } from './_lab';
import { createSnake } from './_snake';

const isProgram = (value: string): value is ProgramId => (PROGRAM_IDS as readonly string[]).includes(value);

export function startLab(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const canvas = q<HTMLCanvasElement>('[data-screen]');
  const ctx = canvas.getContext('2d')!;
  const mirrorImg = q<HTMLImageElement>('[data-screen-img]');
  const titleEl = q<HTMLElement>('[data-tab-title]');
  const hashEl = q<HTMLElement>('[data-url-hash]');
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-program]')];

  let link = document.querySelector<HTMLLinkElement>('link[data-lab-icon]');
  let lastHref = '';

  /** Swap in a fresh link element: Firefox and Safari repaint the tab more reliably than when only href changes. */
  const setIcon = (href: string, type: string) => {
    if (href === lastHref) return;
    lastHref = href;
    const next = document.createElement('link');
    next.rel = 'icon';
    next.type = type;
    next.href = href;
    next.dataset.labIcon = '';
    if (link) link.replaceWith(next);
    else document.head.append(next);
    link = next;
  };

  const lab: Lab = {
    root,
    canvas,
    ctx,
    present() {
      setIcon(canvas.toDataURL('image/png'), 'image/png');
    },
    showImage(href, type, smooth = false) {
      setIcon(href, type);
      mirrorImg.src = href;
      mirrorImg.hidden = false;
      mirrorImg.parentElement!.classList.toggle('is-smooth', smooth);
      canvas.hidden = true;
    },
    showCanvas() {
      mirrorImg.hidden = true;
      mirrorImg.removeAttribute('src');
      mirrorImg.parentElement!.classList.remove('is-smooth');
      canvas.hidden = false;
    },
    title(text) {
      document.title = text;
      titleEl.textContent = text;
    },
    panel(id) {
      return q<HTMLElement>(`[data-panel="${id}"]`);
    },
  };

  const programs: Partial<Record<ProgramId, Program>> = {
    snake: createSnake(lab),
  };

  let current: ProgramId | null = null;

  const select = (id: ProgramId) => {
    if (id === current) return;
    if (current) programs[current]?.stop();
    current = id;
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.program === id));
    for (const pid of PROGRAM_IDS) lab.panel(pid).hidden = pid !== id;
    hashEl.textContent = `#${id}`;
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
    ctx.clearRect(0, 0, 32, 32);
    lab.showCanvas();
    const program = programs[id];
    if (program) program.start();
    else lab.title('Icon lab');
  };

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const id = button.dataset.program ?? '';
      if (isProgram(id)) select(id);
    });
  }

  addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (isProgram(id)) select(id);
  });

  const fromHash = location.hash.slice(1);
  select(isProgram(fromHash) ? fromHash : 'snake');
}
