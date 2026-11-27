// The week as a strip of skies, one sliver an hour: drag along it to choose the hour to print.

import { localParts, makeCond, skyColors } from './_scene';
import { css, mix } from './_util';
import type { Forecast } from './_weather';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export class Strip {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private days: HTMLElement;
  private nowMark: HTMLElement;
  private cursor: HTMLElement;
  private label: HTMLElement;
  private f: Forecast | null = null;
  private n = 0;
  private now = 0;
  index = 0;
  onPick: (i: number, settled: boolean) => void = () => {};
  describe: (i: number) => string = () => '';
  short: (i: number) => string = () => '';

  constructor(root: HTMLElement) {
    this.root = root;
    this.canvas = root.querySelector<HTMLCanvasElement>('.sky')!;
    this.days = root.querySelector<HTMLElement>('.days')!;
    this.nowMark = root.querySelector<HTMLElement>('.now-mark')!;
    this.cursor = root.querySelector<HTMLElement>('.cursor')!;
    this.label = this.cursor.querySelector('span')!;

    let dragging = false;
    const at = (e: PointerEvent) => {
      const r = this.root.getBoundingClientRect();
      return Math.max(0, Math.min(this.n - 1, Math.floor(((e.clientX - r.left) / r.width) * this.n)));
    };
    root.addEventListener('pointerdown', (e) => {
      if (!this.n) return;
      dragging = true;
      try {
        root.setPointerCapture(e.pointerId);
      } catch {
        // A synthetic pointer can't be captured; dragging still works while it stays on the strip.
      }
      this.pick(at(e), false);
      root.focus({ preventScroll: true });
    });
    root.addEventListener('pointermove', (e) => {
      if (dragging) this.pick(at(e), false);
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      this.pick(at(e), true);
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('keydown', (e) => {
      if (!this.n) return;
      const step: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowDown: -1,
        ArrowUp: 1,
        PageDown: -24,
        PageUp: 24,
      };
      let i = this.index;
      if (e.key in step) i += step[e.key];
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = this.n - 1;
      else return;
      e.preventDefault();
      this.pick(Math.max(0, Math.min(this.n - 1, i)), true);
    });
  }

  private pick(i: number, settled: boolean) {
    const changed = i !== this.index;
    this.index = i;
    this.place();
    if (changed || settled) this.onPick(i, settled);
  }

  setForecast(f: Forecast, now: number) {
    this.f = f;
    this.n = f.hours.length;
    this.now = now;
    this.root.setAttribute('aria-valuemax', String(this.n - 1));
    this.draw();
  }

  setNow(now: number) {
    this.now = now;
    this.place();
  }

  set(i: number) {
    this.index = i;
    this.place();
  }

  /** Paint the skies, and mark the days. */
  draw() {
    const f = this.f;
    if (!f) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    const c = this.canvas.getContext('2d')!;
    const bw = w / this.n;
    this.days.textContent = '';
    for (let i = 0; i < this.n; i++) {
      const hour = f.hours[i];
      const cond = makeCond(f, hour);
      const { top, glow } = skyColors(cond);
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, css(top));
      g.addColorStop(1, css(mix(mix(top, '#ece4cf', 0.45 * cond.day), glow, cond.glow)));
      const x0 = Math.floor(i * bw);
      const x1 = Math.floor((i + 1) * bw);
      c.fillStyle = g;
      c.fillRect(x0, 0, x1 - x0, h);
      const fall = cond.kind.fall;
      if (fall !== 'none') {
        const ink = cond.day > 0.5 ? 'rgba(30, 36, 48, 0.55)' : 'rgba(220, 224, 232, 0.6)';
        if (fall === 'snow' || fall === 'hail') {
          c.fillStyle = 'rgba(250, 248, 242, 0.95)';
          const r = Math.max(1, dpr * 1.1);
          for (let y = h * 0.25; y < h; y += h * 0.22)
            c.fillRect(x0 + (x1 - x0) / 2 - r / 2 + (((i * 7 + y) % 3) - 1) * r, y, r, r);
        } else {
          c.strokeStyle = ink;
          c.lineWidth = Math.max(0.6, dpr * 0.6);
          c.beginPath();
          const lines = Math.max(1, Math.round(cond.wet * 3));
          for (let k = 0; k < lines; k++) {
            const x = x0 + ((k + 0.5) / lines) * (x1 - x0);
            c.moveTo(x, h * (0.3 + 0.2 * (k % 2)));
            c.lineTo(x - h * 0.08, h);
          }
          c.stroke();
        }
      }
      const local = localParts(hour.t, f.utcOffset);
      if (local.hour === 0 || i === 0) {
        if (local.hour === 0) {
          c.fillStyle = 'rgba(0, 0, 0, 0.55)';
          c.fillRect(x0, 0, Math.max(1, dpr), h);
        }
        if (local.hour === 0 || local.hour < 12) {
          const span = document.createElement('span');
          const wd = document.createElement('b');
          wd.textContent = DAYS[local.weekday];
          const dn = document.createElement('i');
          dn.textContent = ` ${local.day}`;
          span.append(wd, dn);
          span.style.left = `${(i / this.n) * 100}%`;
          this.days.append(span);
        }
      }
    }
    this.place();
  }

  private place() {
    if (!this.n) return;
    const pct = (i: number) => `${((i + 0.5) / this.n) * 100}%`;
    this.cursor.hidden = false;
    this.cursor.style.left = pct(this.index);
    this.label.textContent = this.short(this.index);
    const edge = this.index / this.n;
    this.label.style.translate = edge < 0.06 ? '-12% 0' : edge > 0.94 ? '-88% 0' : '-50% 0';
    this.nowMark.hidden = this.now < 0;
    this.nowMark.style.left = pct(this.now);
    this.root.setAttribute('aria-valuenow', String(this.index));
    this.root.setAttribute('aria-valuetext', this.describe(this.index));
  }
}
