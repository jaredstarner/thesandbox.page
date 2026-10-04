// A split-flap display. Each cell is a drum of printed flaps; changing a cell
// flips it through every flap between the old character and the new one, one
// half-flap falling at a time.

export const LETTER_DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-.,:'/&()!?";
export const DIGIT_DRUM = '0123456789';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Splits text into what a reader sees as single characters, so accents and combined glyphs share a cell. */
export const glyphs = (text: string): string[] => Array.from(segmenter.segment(text.normalize('NFC')), (s) => s.segment);

const random = (n: number) => Math.floor(Math.random() * n);

/** With reduced motion asked for, cells change at once instead of flipping. */
const still = matchMedia('(prefers-reduced-motion: reduce)');

/** The flaps a cell passes on its way from one character to another, ending with the target. */
function route(drum: string[], from: string, to: string): string[] {
  if (from === to) return [];
  const n = drum.length;
  const target = drum.indexOf(to);
  if (target < 0) {
    // Not printed on the drum: rattle through a few flaps, then show it anyway.
    const rattle = Array.from({ length: 2 + random(3) }, () => drum[1 + random(n - 1)]!);
    return [...rattle, to];
  }
  const start = Math.max(drum.indexOf(from), 0);
  if (start === target) return [to];
  const out: string[] = [];
  for (let k = (start + 1) % n; ; k = (k + 1) % n) {
    out.push(drum[k]!);
    if (k === target) return out;
  }
}

// Full-width characters (kanji, kana, hangul) print smaller to fit the cell.
const WIDE = /[p{Script=Han}p{Script=Hiragana}p{Script=Katakana}p{Script=Hangul}　-〿＀-￯]/u;

/** Prints a character on one half of a cell. */
function paint(face: HTMLSpanElement, char: string): void {
  face.textContent = char;
  face.classList.toggle('wide', WIDE.test(char));
}

function half(className: string, char: string): [HTMLSpanElement, HTMLSpanElement] {
  const outer = document.createElement('span');
  const face = document.createElement('span');
  outer.className = className;
  outer.append(face);
  paint(face, char);
  return [outer, face];
}

/**
 * One character on the board. Four halves: the still top and bottom, and the
 * two moving flaps. The top flap falls from upright to flat, showing the old
 * character; the bottom flap carries on from flat to hanging, showing the new.
 */
export class Cell {
  readonly el: HTMLSpanElement;
  private readonly drum: string[];
  private readonly top: HTMLSpanElement;
  private readonly bottom: HTMLSpanElement;
  private readonly flapTopFace: HTMLSpanElement;
  private readonly flapBottomFace: HTMLSpanElement;
  private readonly flapTop: HTMLSpanElement;
  private readonly flapBottom: HTMLSpanElement;
  private current = ' ';
  private queue: string[] = [];
  private start = 0;
  private duration = 70;

  constructor(drum: string, initial = ' ') {
    this.drum = glyphs(drum);
    this.current = initial;
    this.el = document.createElement('span');
    this.el.className = 'cell';
    const [topEl, top] = half('half top', initial);
    const [bottomEl, bottom] = half('half bottom', initial);
    const [flapTop, flapTopFace] = half('half top flap', initial);
    const [flapBottom, flapBottomFace] = half('half bottom flap', initial);
    this.el.append(topEl, bottomEl, flapTop, flapBottom);
    this.top = top;
    this.bottom = bottom;
    this.flapTop = flapTop;
    this.flapTopFace = flapTopFace;
    this.flapBottom = flapBottom;
    this.flapBottomFace = flapBottomFace;
  }

  get busy(): boolean {
    return this.queue.length > 0;
  }

  /** Sets the character to land on. Returns true if the cell has to move. */
  set(target: string, now: number): boolean {
    if (this.busy) {
      // Let the flap that is already falling land, then head for the new target.
      const landing = this.queue[0]!;
      this.queue = [landing, ...route(this.drum, landing, target)];
      return true;
    }
    this.queue = route(this.drum, this.current, target);
    if (!this.queue.length) return false;
    this.duration = 62 + random(22);
    this.el.classList.add('flipping');
    this.begin(now);
    return true;
  }

  /** Shows a character at once, with no flipping. */
  jump(char: string): void {
    this.queue = [];
    this.current = char;
    paint(this.top, char);
    paint(this.bottom, char);
    this.el.classList.remove('flipping');
  }

  /** Advances the animation. Returns how many flaps landed (0 or 1). */
  tick(now: number): number {
    if (!this.busy) return 0;
    const p = (now - this.start) / this.duration;
    if (p < 0.5) {
      // The top flap accelerates as it falls toward the viewer.
      const q = p / 0.5;
      this.flapTop.style.transform = `rotateX(${-90 * q * q}deg)`;
      this.flapBottom.style.transform = 'rotateX(90deg)';
      return 0;
    }
    if (p < 1) {
      // The bottom flap keeps falling, then bounces once off the stop.
      const q = (p - 0.5) / 0.5;
      const angle = q < 0.8 ? 90 * (1 - (q / 0.8) ** 2) : 9 * Math.sin((Math.PI * (q - 0.8)) / 0.2);
      this.flapTop.style.transform = 'rotateX(-90deg)';
      this.flapBottom.style.transform = `rotateX(${angle}deg)`;
      return 0;
    }
    this.current = this.queue.shift()!;
    paint(this.bottom, this.current);
    if (this.busy) this.begin(now);
    else this.el.classList.remove('flipping');
    return 1;
  }

  private begin(now: number): void {
    const next = this.queue[0]!;
    paint(this.top, next);
    paint(this.flapTopFace, this.current);
    paint(this.flapBottomFace, next);
    this.flapTop.style.transform = 'rotateX(0deg)';
    this.flapBottom.style.transform = 'rotateX(90deg)';
    this.start = now;
  }
}

/**
 * Runs the animation for a set of cells. It draws on whichever window shows
 * the cells, so the board keeps moving after it has been popped out into a
 * picture-in-picture window and the original tab is hidden.
 */
export class Flaps {
  onLand: (count: number) => void = () => {};
  onSettle: () => void = () => {};
  private readonly active = new Set<Cell>();
  private view: Window = window;
  private frame = 0;

  get busy(): boolean {
    return this.active.size > 0;
  }

  /** Moves the animation loop to another window. */
  attach(view: Window): void {
    if (this.frame) this.view.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.view = view;
    this.schedule();
  }

  set(cell: Cell, target: string): void {
    if (still.matches) return cell.jump(target);
    if (cell.set(target, performance.now())) {
      this.active.add(cell);
      this.schedule();
    }
  }

  forget(cells: Iterable<Cell>): void {
    for (const cell of cells) this.active.delete(cell);
  }

  private schedule(): void {
    if (!this.frame && this.active.size) this.frame = this.view.requestAnimationFrame(this.tick);
  }

  // Both windows share this clock: each window's performance.now() counts from
  // its own start, so the board never mixes them.
  private readonly tick = (): void => {
    this.frame = 0;
    const now = performance.now();
    let landed = 0;
    for (const cell of this.active) {
      landed += cell.tick(now);
      if (!cell.busy) this.active.delete(cell);
    }
    if (landed) this.onLand(landed);
    if (this.active.size) this.schedule();
    else this.onSettle();
  };
}
