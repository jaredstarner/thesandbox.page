// The survey ceremony: how results arrive on the page. Phase 1 inks the Survey
// Conditions in. Phase 2 runs a raking lamp down the ledger as its rows come
// into view, ticking each technique and bringing a dated stamp down on the
// row. Phase 3 prints the tally, punches the survey time through the leaf,
// and raises the seal. The survey has already written every result; this is
// presentation only. Reduced motion, Skip survey, or a key press while
// something is moving shows the end state at once.
import { fillForm, type EnvironmentValues } from './_environment';
import type { SurveyOutcome } from './_survey';

type Mode = 'full' | 'fast' | 'instant';

/** The lamp surveys at most this many rows; later rows stamp briefly as they appear. */
const LAMP_ROWS = 6;
const LAMP_HEIGHT = 220;
const EASE = 'cubic-bezier(0.45, 0, 0.25, 1)';

/** Keys that move around the page never skip the survey. */
const NAVIGATION_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
  'Tab',
  'Shift',
  'Control',
  'Alt',
  'Meta',
]);

// 5x7 dot-matrix glyphs for the perforating dater.
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['0', '0', '0', '0', '0', '0', '1'],
  ':': ['0', '0', '1', '0', '0', '1', '0'],
  ' ': ['00', '00', '00', '00', '00', '00', '00'],
};

const pad = (n: number) => String(n).padStart(2, '0');
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const allRows = () => [...document.querySelectorAll<HTMLElement>('.row')];

interface Lamp {
  el: HTMLElement;
  paper: HTMLElement;
  sheet: HTMLElement;
  y: number;
}

export class Ceremony {
  private mode: Mode;
  private skipped = false;
  private busy = false;
  private complete = false;
  private outcome: SurveyOutcome | null = null;
  private phase1: Promise<void> = Promise.resolve();
  private readonly wakers = new Set<() => void>();
  private readonly animations = new Set<Animation>();
  private readonly pending = new Set<HTMLElement>();
  private readonly inView = new Set<HTMLElement>();
  private rowObserver: IntersectionObserver | null = null;
  private footObserver: IntersectionObserver | null = null;
  private onRowsChanged: (() => void) | null = null;
  private lampDone = false;
  private footInView = false;
  private footPlayed = false;
  private readonly skipButton = document.querySelector<HTMLButtonElement>('[data-skip-survey]');
  private readonly onSkipClick = () => this.skip();
  private readonly onKey = (event: KeyboardEvent) => {
    if (!this.busy || NAVIGATION_KEYS.has(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
    this.skip();
  };

  constructor(private readonly rerun: boolean) {
    this.mode = reducedMotion() ? 'instant' : rerun ? 'fast' : 'full';
    document.documentElement.dataset.ceremony = 'running';
    for (const row of allRows()) {
      row.dataset.awaiting = '';
      delete row.dataset.stamped;
      for (const li of row.querySelectorAll<HTMLElement>('.c-medium li[data-state]')) delete li.dataset.state;
    }
    if (this.mode === 'instant') return;
    this.flattenSeal();
    window.addEventListener('keydown', this.onKey, true);
    this.skipButton?.addEventListener('click', this.onSkipClick);
    this.setBusy(true);
  }

  // ---- phase 1: the Survey Conditions form ----------------------------------

  printEnvironment(values: Partial<EnvironmentValues>, repeatVisit: boolean) {
    if (repeatVisit && this.mode === 'full') this.mode = 'fast';
    const cells = fillForm(values);
    if (this.mode === 'instant' || this.skipped) return;
    const stagger = this.mode === 'full' ? 35 : 0;
    cells.forEach((cell, i) => this.inkIn(cell, i * stagger));
    this.phase1 = this.sleep(cells.length * stagger + 120);
  }

  printRefresh(values: Partial<EnvironmentValues>) {
    const cells = fillForm(values);
    if (this.mode !== 'instant' && !this.skipped) cells.forEach((cell) => this.inkIn(cell, 0));
  }

  // ---- after the survey -----------------------------------------------------

  /** Present the survey's results; null means the survey could not run. */
  present(outcome: SurveyOutcome | null) {
    this.outcome = outcome;
    if (!outcome || this.skipped || this.mode === 'instant') return this.finish();
    // A first visit, or one where something changed, gets the lamp.
    if (!this.rerun) this.mode = outcome.unchanged ? 'fast' : 'full';
    for (const row of outcome.rows) this.pending.add(row);

    this.rowObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const row = entry.target as HTMLElement;
          if (entry.isIntersecting) this.inView.add(row);
          else this.inView.delete(row);
        }
        this.onRowsChanged?.();
        this.flush();
      },
      { threshold: 0.35 },
    );
    for (const row of outcome.rows) this.rowObserver.observe(row);

    const foot = document.querySelector('.leaf-foot');
    if (foot) {
      this.footObserver = new IntersectionObserver(
        ([entry]) => {
          this.footInView = !!entry?.isIntersecting;
          this.maybePlayFoot();
        },
        { threshold: 0.2 },
      );
      this.footObserver.observe(foot);
    }

    if (this.mode === 'full') {
      void this.runLamp();
    } else {
      this.lampDone = true;
      void this.phase1.then(() => this.setBusy(false));
    }
  }

  /** Complete everything now. Safe to call more than once. */
  skip() {
    this.skipped = true;
    this.finish();
  }

  // ---- phase 2: the lamp ----------------------------------------------------

  private async runLamp() {
    await this.phase1;
    this.setBusy(false);
    let lamp: Lamp | null = null;
    let surveyed = 0;
    while (surveyed < LAMP_ROWS && !this.skipped) {
      const next = this.nextInView() ?? (await this.waitForRow(lamp ? 900 : Infinity));
      if (!next || this.skipped) break;
      this.setBusy(true);
      const sheet = next.closest<HTMLElement>('.sheet')!;
      if (lamp && lamp.sheet !== sheet) {
        await this.exitLamp(lamp);
        lamp = null;
      }
      this.pending.delete(next);
      if (!lamp) lamp = this.enterLamp(sheet, next);
      await this.moveLamp(lamp, this.lampTarget(next));
      await this.tick(next, 60);
      await this.stampFull(next);
      surveyed++;
    }
    if (lamp && !this.skipped) await this.exitLamp(lamp);
    this.lampDone = true;
    this.setBusy(false);
    this.flush();
  }

  private nextInView(): HTMLElement | null {
    return allRows().find((row) => this.pending.has(row) && this.inView.has(row)) ?? null;
  }

  private waitForRow(timeout: number): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
      let timer: number | undefined;
      const done = (row: HTMLElement | null) => {
        window.clearTimeout(timer);
        this.wakers.delete(wake);
        this.onRowsChanged = null;
        resolve(row);
      };
      const wake = () => done(null);
      this.wakers.add(wake);
      this.onRowsChanged = () => {
        const row = this.nextInView();
        if (row) done(row);
      };
      if (Number.isFinite(timeout)) timer = window.setTimeout(() => done(null), timeout);
    });
  }

  private lampTarget(row: HTMLElement) {
    return row.offsetTop + Math.min(row.offsetHeight, 196) / 2 - LAMP_HEIGHT / 2;
  }

  private enterLamp(sheet: HTMLElement, first: HTMLElement): Lamp {
    const el = document.createElement('div');
    el.className = 'lamp';
    el.setAttribute('aria-hidden', 'true');
    const paper = document.createElement('div');
    paper.className = 'lamp-paper';
    const mark = document.createElement('div');
    mark.className = 'lamp-mark';
    paper.append(mark);
    el.append(paper);
    sheet.append(el);
    const height = sheet.offsetHeight;
    paper.style.height = `${height}px`;
    mark.style.top = `${Math.round(Math.min(height / 2, 360))}px`;
    const lamp = { el, paper, sheet, y: 0 };
    this.place(lamp, first.offsetTop - LAMP_HEIGHT * 0.9);
    this.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
    return lamp;
  }

  private place(lamp: Lamp, y: number) {
    lamp.y = y;
    lamp.el.style.transform = `translateY(${y}px)`;
    lamp.paper.style.transform = `translateY(${-y}px)`;
  }

  /** The band and its paper move in opposite directions, so the texture stays put while the light travels. */
  private async moveLamp(lamp: Lamp, y: number) {
    const from = lamp.y;
    const duration = Math.min(720, 280 + Math.abs(y - from) * 0.8);
    const options = { duration, easing: EASE };
    const band = this.animate(lamp.el, [{ transform: `translateY(${from}px)` }, { transform: `translateY(${y}px)` }], options);
    this.animate(lamp.paper, [{ transform: `translateY(${-from}px)` }, { transform: `translateY(${-y}px)` }], options);
    this.place(lamp, y);
    await this.until(band);
  }

  private async exitLamp(lamp: Lamp) {
    const from = lamp.y;
    const to = from + 140;
    const options = { duration: 360, easing: 'ease-in' };
    const band = this.animate(
      lamp.el,
      [
        { transform: `translateY(${from}px)`, opacity: 1 },
        { transform: `translateY(${to}px)`, opacity: 0 },
      ],
      options,
    );
    this.animate(lamp.paper, [{ transform: `translateY(${-from}px)` }, { transform: `translateY(${-to}px)` }], options);
    await this.until(band);
    lamp.el.remove();
  }

  // ---- stamps ---------------------------------------------------------------

  private async tick(row: HTMLElement, gap: number) {
    for (const li of row.querySelectorAll<HTMLElement>('.c-medium li[data-result]')) {
      li.dataset.state = li.dataset.result!;
      if (gap && !this.skipped) await this.sleep(gap);
    }
  }

  private reveal(row: HTMLElement) {
    row.dataset.stamped = '';
    delete row.dataset.awaiting;
  }

  /** Approach, contact, settle: the stamp comes into focus, lands with a nudge, and the ink eases off. */
  private async stampFull(row: HTMLElement) {
    const stamp = row.querySelector<HTMLElement>('.stamp');
    this.reveal(row);
    if (!stamp || getComputedStyle(stamp).display === 'none' || this.skipped) return;
    const approach = this.animate(
      stamp,
      [
        { opacity: 0, transform: 'scale(1.08)' },
        { opacity: 0.3, transform: 'scale(1)' },
      ],
      { duration: 120, easing: 'ease-in' },
    );
    await this.until(approach);
    const contact = this.animate(stamp, [{ opacity: 1 }, { opacity: 1 }], { duration: 50 });
    this.animate(row, [{ top: '0px' }, { top: '1px' }, { top: '0px' }], { duration: 110, easing: 'ease-out' });
    await this.until(contact);
    this.animate(
      stamp,
      [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0.92, transform: 'scale(1.004)' },
      ],
      { duration: 260, easing: 'ease-out' },
    );
    await this.sleep(140);
  }

  /** The compressed stamp for rows the lamp did not reach. */
  private async stampBrief(row: HTMLElement, delay: number) {
    if (delay) await this.sleep(delay);
    await this.tick(row, 0);
    const stamp = row.querySelector<HTMLElement>('.stamp');
    this.reveal(row);
    if (!stamp || this.skipped) return;
    this.animate(
      stamp,
      [
        { opacity: 0, transform: 'scale(1.05)' },
        { opacity: 1, transform: 'scale(1)', offset: 0.45 },
        { opacity: 0.92, transform: 'scale(1)' },
      ],
      { duration: 220, easing: 'ease-out' },
    );
  }

  /** Stamp rows the lamp is not handling as they come into view. */
  private flush() {
    if (this.skipped || !this.lampDone) return;
    let i = 0;
    for (const row of allRows()) {
      if (!this.pending.has(row) || !this.inView.has(row)) continue;
      this.pending.delete(row);
      void this.stampBrief(row, i++ * 70);
    }
    this.maybePlayFoot();
    this.maybeComplete();
  }

  // ---- phase 3: the foot ----------------------------------------------------

  private maybePlayFoot() {
    if (this.footPlayed || !this.lampDone || !this.footInView || !this.outcome || this.skipped) return;
    void this.playFoot();
  }

  private async playFoot() {
    this.footPlayed = true;
    this.setBusy(true);
    const quick = this.mode === 'fast';
    for (const line of this.writeTally()) this.inkIn(line, 0, 220);
    const holes = this.punch();
    const gap = quick ? 2 : 6;
    const lead = quick ? 80 : 260;
    for (const { el, col } of holes) {
      this.animate(el, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], {
        duration: quick ? 60 : 90,
        delay: lead + col * gap,
        easing: 'cubic-bezier(0.2, 0.7, 0.3, 1.3)',
        fill: 'backwards',
      });
    }
    const columns = holes.reduce((max, hole) => Math.max(max, hole.col), 0);
    await this.sleep(lead + columns * gap + 90);
    await this.raiseSeal(quick ? 500 : 900);
    this.setBusy(false);
    this.maybeComplete();
  }

  private writeTally(): HTMLElement[] {
    const tally = document.querySelector<HTMLElement>('.tally');
    const memory = document.querySelector<HTMLElement>('.tally-memory');
    const written: HTMLElement[] = [];
    if (tally && this.outcome) {
      tally.textContent = this.outcome.tally;
      written.push(tally);
    }
    if (memory) {
      memory.hidden = !this.outcome?.memory;
      memory.textContent = this.outcome?.memory ?? '';
      if (this.outcome?.memory) written.push(memory);
    }
    return written;
  }

  /** Lay the survey time out as holes: "04.10.26 09:41". */
  private punch(): { el: HTMLElement; col: number }[] {
    const box = document.querySelector<HTMLElement>('.perforation');
    if (!box || !this.outcome) return [];
    const at = this.outcome.at;
    const text = `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${pad(at.getFullYear() % 100)} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
    const holes: { el: HTMLElement; col: number }[] = [];
    let col = 0;
    for (const char of text) {
      const glyph = GLYPHS[char];
      if (!glyph) continue;
      glyph.forEach((line, r) => {
        [...line].forEach((bit, c) => {
          if (bit !== '1') return;
          const el = document.createElement('i');
          el.style.setProperty('--c', String(col + c));
          el.style.setProperty('--r', String(r));
          holes.push({ el, col: col + c });
        });
      });
      col += glyph[0]!.length + 1;
    }
    box.style.setProperty('--cols', String(col - 1));
    box.replaceChildren(...holes.map((hole) => hole.el));
    box.setAttribute('title', `Surveyed ${text}`);
    return holes;
  }

  private flattenSeal() {
    document.querySelector('.seal-relief')?.setAttribute('surfaceScale', '0');
  }

  private settleSeal() {
    document.querySelector('.seal-light')?.setAttribute('azimuth', '340');
    document.querySelector('.seal-relief')?.setAttribute('surfaceScale', '2.5');
  }

  /** Sweep the light across the seal while its relief rises out of the paper. */
  private raiseSeal(duration: number): Promise<void> {
    const light = document.querySelector('.seal-light');
    const relief = document.querySelector('.seal-relief');
    if (!light || !relief || this.skipped) {
      this.settleSeal();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now: number) => {
        const t = this.skipped ? 1 : Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - t) ** 3;
        light.setAttribute('azimuth', (200 + 140 * eased).toFixed(1));
        relief.setAttribute('surfaceScale', (2.5 * Math.min(1, eased * 1.4)).toFixed(2));
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  // ---- ending ---------------------------------------------------------------

  /** Show the end state of everything at once. */
  private finish() {
    for (const wake of [...this.wakers]) wake();
    for (const animation of this.animations) animation.finish();
    this.animations.clear();
    for (const lamp of document.querySelectorAll('.lamp')) lamp.remove();
    for (const row of allRows()) {
      if (row.dataset.verdict) {
        for (const li of row.querySelectorAll<HTMLElement>('.c-medium li[data-result]')) li.dataset.state = li.dataset.result!;
        row.dataset.stamped = '';
      }
      delete row.dataset.awaiting;
    }
    this.pending.clear();
    if (!this.outcome) return this.setBusy(false);
    this.lampDone = true;
    if (!this.footPlayed) {
      this.footPlayed = true;
      this.writeTally();
      this.punch();
    }
    this.settleSeal();
    this.maybeComplete();
  }

  private maybeComplete() {
    if (this.complete || !this.footPlayed || this.pending.size > 0 || (this.busy && !this.skipped)) return;
    this.complete = true;
    this.rowObserver?.disconnect();
    this.footObserver?.disconnect();
    window.removeEventListener('keydown', this.onKey, true);
    this.skipButton?.removeEventListener('click', this.onSkipClick);
    this.setBusy(false);
    delete document.documentElement.dataset.ceremony;
  }

  // ---- plumbing -------------------------------------------------------------

  private setBusy(busy: boolean) {
    this.busy = busy && !this.skipped;
    if (this.skipButton) this.skipButton.hidden = !this.busy;
  }

  private animate(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation {
    const animation = el.animate(keyframes, options);
    if (this.skipped) {
      animation.finish();
      return animation;
    }
    this.animations.add(animation);
    animation.finished.then(
      () => this.animations.delete(animation),
      () => this.animations.delete(animation),
    );
    return animation;
  }

  private inkIn(el: Element, delay: number, duration = 120) {
    this.animate(el, [{ opacity: 0, filter: 'blur(0.6px)' }, { opacity: 1, filter: 'blur(0px)' }], {
      duration,
      delay,
      easing: 'ease-out',
      fill: 'backwards',
    });
  }

  /** Resolves after ms, or at once when the survey is skipped. */
  private sleep(ms: number): Promise<void> {
    if (this.skipped || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        this.wakers.delete(done);
        resolve();
      };
      const timer = window.setTimeout(done, ms);
      this.wakers.add(done);
    });
  }

  /** Resolves when an animation ends, or at once when the survey is skipped. */
  private until(animation: Animation): Promise<void> {
    if (this.skipped) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.wakers.delete(done);
        resolve();
      };
      this.wakers.add(done);
      animation.finished.then(done, done);
    });
  }
}

/** The gilt label's foil catches the light: it follows the pointer, or scroll on touch screens. */
export function giltSheen() {
  const gilt = document.querySelector<HTMLElement>('.gilt');
  if (!gilt || reducedMotion()) return;
  let frame = 0;
  let angle = 105;
  const set = (next: number) => {
    angle = next;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      gilt.style.setProperty('--gilt-angle', `${angle.toFixed(1)}deg`);
    });
  };
  if (window.matchMedia('(hover: hover)').matches) {
    window.addEventListener(
      'pointermove',
      (event) => set(105 + (event.clientX / window.innerWidth - 0.5) * 50 + (event.clientY / window.innerHeight - 0.5) * 16),
      { passive: true },
    );
  } else {
    window.addEventListener('scroll', () => set(105 + Math.sin(window.scrollY / 240) * 30), { passive: true });
  }
}
