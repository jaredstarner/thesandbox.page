// Chart labels: each prominent light on screen gets its name and its
// notation in the chart's italic ("Fl(2)WR.10s 23m 14M"), placed where it
// does not cover another.

import type { View } from './_chart';
import type { Lights } from './_lights';

const MAX = 42;

/** Smallest nominal range labelled at each zoom (log2 of pixels per world / 256). */
function threshold(z: number): number {
  if (z < 5.6) return Infinity;
  if (z < 6.5) return 24;
  if (z < 7.5) return 18;
  if (z < 8.5) return 12;
  if (z < 9.5) return 7;
  if (z < 10.5) return 4;
  return 0;
}

let namesPromise: Promise<string[]> | null = null;
export function loadNames(url: string): Promise<string[]> {
  if (!namesPromise) {
    namesPromise = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`names ${r.status}`);
      return r.json() as Promise<string[]>;
    });
    namesPromise.catch(() => (namesPromise = null));
  }
  return namesPromise;
}

export class Labels {
  private pool: HTMLSpanElement[] = [];
  private names: string[] | null = null;
  private last = '';
  private shown: number[] = [];

  private panels: HTMLElement[];

  constructor(
    private layer: HTMLElement,
    private lights: Lights,
    private namesUrl: string,
  ) {
    const root = layer.closest('[data-coast]')!;
    this.panels = [...root.querySelectorAll<HTMLElement>('.cartouche, .find, .card, .hint')];
  }

  update(v: View, w: number, h: number, selected: number) {
    const z = Math.log2(v.s / 256);
    const min = threshold(z);
    const key = `${v.x.toFixed(7)},${v.y.toFixed(7)},${v.s.toFixed(1)},${w},${h},${!!this.names},${selected}`;
    if (key === this.last) return;
    this.last = key;
    if (min === Infinity) {
      this.render([], v, w, h);
      return;
    }
    if (!this.names) {
      loadNames(this.namesUrl)
        .then((n) => {
          this.names = n;
          this.last = '';
        })
        .catch(() => {});
    }
    const L = this.lights;
    const hw = w / 2 / v.s;
    const hh = h / 2 / v.s;
    const cand: number[] = [];
    for (let i = 0; i < L.n; i++) {
      if (!L.lit[i] || L.range[i] < min) continue;
      let dx = L.xy[i * 2] - v.x;
      dx -= Math.round(dx);
      const dy = L.xy[i * 2 + 1] - v.y;
      if (Math.abs(dx) < hw && Math.abs(dy) < hh) cand.push(i);
    }
    cand.sort((a, b) => (b === selected ? 1 : 0) - (a === selected ? 1 : 0) || L.range[b] - L.range[a]);
    // Greedy placement: keep a label only if its box is clear of others and of the panels.
    const origin = this.layer.getBoundingClientRect();
    const boxes: [number, number, number, number][] = this.panels
      .filter((p) => !p.hidden && p.offsetParent)
      .map((p) => {
        const r = p.getBoundingClientRect();
        return [r.left - origin.left - 8, r.top - origin.top - 8, r.right - origin.left + 8, r.bottom - origin.top + 8];
      });
    const out: number[] = [];
    for (const i of cand) {
      if (out.length >= MAX) break;
      const [x, y] = this.screen(i, v, w, h);
      const box: [number, number, number, number] = [x - 6, y - 16, x + 160, y + 16];
      if (box[2] > w + 60 || box[1] < 0 || box[3] > h) continue;
      if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      out.push(i);
    }
    this.render(out, v, w, h);
  }

  private screen(i: number, v: View, w: number, h: number): [number, number] {
    const L = this.lights;
    let dx = L.xy[i * 2] - v.x;
    dx -= Math.round(dx);
    return [dx * v.s + w / 2, (L.xy[i * 2 + 1] - v.y) * v.s + h / 2];
  }

  private render(list: number[], v: View, w: number, h: number) {
    const L = this.lights;
    while (this.pool.length < list.length) {
      const s = document.createElement('span');
      s.append(document.createElement('b'), document.createTextNode(''));
      this.layer.append(s);
      this.pool.push(s);
    }
    this.pool.forEach((s, k) => {
      const i = list[k];
      if (i === undefined) {
        s.hidden = true;
        return;
      }
      s.hidden = false;
      if (this.shown[k] !== i) {
        const r = L.rhythms[L.rhythm[i]];
        const full = this.names?.[i] ?? '';
        // Charts letter the place, not the whole entry: "Hellerup, E. mole, SE. Range, front" reads "Hellerup".
        const name = full.length > 28 ? full.split(',')[0] : full;
        (s.firstChild as HTMLElement).textContent = name;
        (s.firstChild as HTMLElement).hidden = !name;
        s.lastChild!.textContent = [r.label, L.height[i] ? `${L.height[i]}m` : '', L.range[i] ? `${L.range[i]}M` : '']
          .filter(Boolean)
          .join(' ');
        this.shown[k] = i;
      }
      const [x, y] = this.screen(i, v, w, h);
      const off = 7 + Math.sqrt(L.range[i]) * 1.4;
      s.style.translate = `${Math.round(x + off)}px ${Math.round(y - 13)}px`;
    });
    if (!this.names) this.shown = [];
  }
}
