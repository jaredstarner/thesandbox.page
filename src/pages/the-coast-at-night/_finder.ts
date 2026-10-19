// The search box: finds lights by name once the names file has loaded.

import { loadNames } from './_labels';
import type { Lights } from './_lights';

export class Finder {
  private names: string[] | null = null;
  private folded: string[] | null = null;
  private results: HTMLOListElement;
  private input: HTMLInputElement;
  private active = -1;

  constructor(
    root: HTMLElement,
    url: string,
    private lights: Lights,
    private onPick: (i: number) => void,
  ) {
    const form = root.querySelector<HTMLFormElement>('[data-find]')!;
    this.input = root.querySelector<HTMLInputElement>('[data-query]')!;
    this.results = root.querySelector<HTMLOListElement>('[data-results]')!;
    const load = () =>
      loadNames(url)
        .then((n) => {
          this.names = n;
          this.folded = n.map(fold);
          if (this.input.value) this.search();
        })
        .catch(() => {});
    this.input.addEventListener('focus', load, { once: true });
    this.input.addEventListener('input', () => this.search());
    this.input.addEventListener('keydown', (e) => {
      const buttons = [...this.results.querySelectorAll('button')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!buttons.length) return;
        this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons.forEach((b, k) => b.setAttribute('aria-selected', String(k === this.active)));
      } else if (e.key === 'Escape') {
        this.results.hidden = true;
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const buttons = [...this.results.querySelectorAll('button')];
      (buttons[Math.max(0, this.active)] as HTMLButtonElement | undefined)?.click();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!form.contains(e.target as Node)) this.results.hidden = true;
    });
  }

  search() {
    const q = fold(this.input.value.trim());
    this.active = -1;
    if (!q || !this.folded || !this.names) {
      this.results.hidden = true;
      return;
    }
    const L = this.lights;
    const hits: [number, number][] = [];
    for (let i = 0; i < this.folded.length; i++) {
      const at = this.folded[i].indexOf(q);
      if (at < 0) continue;
      const word = at === 0 || this.folded[i][at - 1] === ' ' || this.folded[i][at - 1] === ',';
      hits.push([i, (at === 0 ? 1000 : word ? 500 : 0) + L.range[i] * 4 + (L.floating[i] ? 0 : 20)]);
    }
    hits.sort((a, b) => b[1] - a[1]);
    const top = hits.slice(0, 8);
    this.results.replaceChildren(
      ...top.map(([i]) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = this.names![i];
        const small = document.createElement('small');
        const r = L.rhythms[L.rhythm[i]];
        small.textContent = [r.label, L.range[i] ? `${L.range[i]}M` : ''].filter(Boolean).join(' ');
        b.append(small);
        b.addEventListener('click', () => {
          this.results.hidden = true;
          this.input.blur();
          this.onPick(i);
        });
        li.append(b);
        return li;
      }),
    );
    if (!top.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No light by that name.';
      this.results.replaceChildren(li);
    }
    this.results.hidden = false;
  }
}

/** Lower case without accents, so "oresund" finds "Øresund" and "faro" finds "Faro". */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/å/g, 'a')
    .replace(/ß/g, 'ss');
}
