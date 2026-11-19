// The band, the beat, and the judging. Every blow in the plan gets an ideal time on an even beat with an
// open handstroke lead (one blow's rest before each handstroke row). Band ringers pull each bell about a
// second ahead of its blow, as a real ringer must, with a little human unsteadiness; the bells after yours
// hold up for you when they can see from your rope that you are late. Your own blows are judged against
// the beat.

import { Bell, strikeDelay } from './_bell';
import type { Plan } from './_method';

export interface Ringer {
  name: string;
  full: string;
}

export const BAND: Ringer[] = [
  { name: 'Joan', full: 'Joan Ashworth' },
  { name: 'Peter', full: 'Peter Lund' },
  { name: 'Ruth', full: 'Ruth Okafor' },
  { name: 'Dennis', full: 'Dennis Hale' },
  { name: 'Ann', full: 'Ann Whitlock' },
  { name: 'Sam', full: 'Sam Tregear' },
];

/** Who calls: Joan from the treble, or Dennis if you have taken her rope. */
export function conductor(mine: number): number {
  return mine === 1 ? 3 : 0;
}

export interface Blow {
  row: number;
  place: number;
  bell: number; // 0-based
  ideal: number;
  stroke: 'hand' | 'back';
  /** When it actually sounded, once it has. */
  at?: number;
  /** Your blows: error against the beat, in seconds, or null if missed. */
  error?: number | null;
}

export interface Judgement {
  blow: Blow;
  error: number | null;
  /** The place your bell actually struck in, if it landed in the wrong one. */
  wrongPlace: boolean;
}

export const SPEEDS = { steady: 0.34, brisk: 0.29 } as const;

const D = strikeDelay();

function gauss(rnd: () => number): number {
  // Box-Muller from a seeded uniform source.
  const u = Math.max(1e-9, rnd());
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class Performance {
  readonly plan: Plan;
  readonly mine: number; // 0-based bell index
  readonly gap: number;
  readonly bells: Bell[] = [];
  readonly blows: Blow[] = [];
  /** Blows for each bell, in order. */
  readonly byBell: Blow[][] = [[], [], [], [], [], []];
  readonly rowStart: number[] = [];
  readonly t0: number;
  readonly delay = D;
  private nextBand = [0, 0, 0, 0, 0, 0];
  private planned = new Map<Blow, number>();
  private nextMine = 0;
  private rnd: () => number;
  /** Your latest pull's predicted lateness, for the bells that follow you. */
  private yourLate = 0;
  private yourLateBlow: Blow | null = null;
  missedRun = 0;
  finished = false;
  aborted = false;
  onJudge?: (j: Judgement) => void;
  onStrike?: (bell: number, at: number, speed: number) => void;

  /** Performance time the bells have been simulated up to. */
  clock: number;

  /** The band rings your bell too, while you watch. */
  readonly listen: boolean;
  private struckCount = [0, 0, 0, 0, 0, 0];

  constructor(plan: Plan, mine: number, gap: number, now: number, startAt: number, seed = 1, listen = false) {
    this.plan = plan;
    this.mine = mine;
    this.listen = listen;
    this.gap = gap;
    let s = seed * 9301 + 49297;
    this.rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    this.clock = now;
    for (let i = 0; i < 6; i++) {
      const bell = new Bell();
      bell.t = now; // bells keep performance time, so a blow's time is the bell's own clock
      this.bells.push(bell);
    }
    // The treble is pulled off at startAt, so the first blow comes one strike delay later.
    this.t0 = startAt + D;
    let t = this.t0;
    plan.rows.forEach((row, r) => {
      if (r > 0) t += 6 * gap + (r % 2 === 0 ? gap : 0);
      this.rowStart.push(t);
      row.forEach((b, p) => {
        const blow: Blow = { row: r, place: p, bell: b - 1, ideal: t + p * gap, stroke: r % 2 === 0 ? 'hand' : 'back' };
        this.blows.push(blow);
        this.byBell[b - 1].push(blow);
      });
    });
    this.blows.sort((a, b) => a.ideal - b.ideal);
  }

  /** The time a band bell means to strike this blow: the beat, a little unsteadiness, and you. */
  private target(blow: Blow): number {
    let t = this.planned.get(blow);
    if (t === undefined) {
      t = blow.ideal + gauss(this.rnd) * 0.011;
      this.planned.set(blow, t);
    }
    // The bells after yours see your rope: if you are late they hold up, for a few blows, easing off.
    const y = this.yourLateBlow;
    if (y && blow.ideal > y.ideal) {
      const after = Math.round((blow.ideal - y.ideal) / this.gap);
      const k = after <= 1 ? 0.6 : after === 2 ? 0.3 : after === 3 ? 0.12 : 0;
      t += k * Math.max(-0.08, Math.min(0.25, this.yourLate));
    }
    return t;
  }

  /** Advance the band and every bell to time `now`, in small steps. */
  advance(now: number): void {
    const h = 1 / 240;
    while (this.clock < now - 1e-9) {
      const step = Math.min(h, now - this.clock);
      this.clock += step;
      if (!this.aborted) this.decide(this.clock);
      for (let i = 0; i < 6; i++) this.bells[i].step(step, (s) => this.struck(i, s.t, s.speed));
    }
  }

  private decide(t: number): void {
    for (let i = 0; i < 6; i++) {
      if (i === this.mine && !this.listen) continue;
      const k = this.nextBand[i];
      const blow = this.byBell[i][k];
      if (!blow) continue;
      const bell = this.bells[i];
      const want = this.target(blow) - D;
      if (t >= want && bell.canPull() && this.strokeMatches(bell, blow)) {
        bell.pull();
        this.nextBand[i] = k + 1;
      }
    }
  }

  private strokeMatches(bell: Bell, blow: Blow): boolean {
    // A set bell rings the stroke it is waiting on; one still rising will ring the other.
    const ready = bell.set ? bell.next : bell.theta > 0 ? 'hand' : 'back';
    return ready === blow.stroke;
  }

  private struck(i: number, at: number, speed: number): void {
    this.onStrike?.(i, at, speed);
    if (i === this.mine && !this.listen) {
      this.judge(at);
      return;
    }
    const blow = this.byBell[i][this.struckCount[i]++];
    if (blow) blow.at = at;
  }

  /** Your pull: tell the band, if they can see you're late. */
  yourPull(now: number): boolean {
    const bell = this.bells[this.mine];
    if (this.listen || this.finished || !bell.canPull()) return false;
    const blow = this.byBell[this.mine][this.nextMine];
    bell.pull();
    if (blow) {
      this.yourLate = now + D - blow.ideal;
      this.yourLateBlow = blow;
    }
    return true;
  }

  /** The next blow you are due to ring, if any. */
  yourNext(): Blow | undefined {
    return this.byBell[this.mine][this.nextMine];
  }

  private judge(at: number): void {
    const mine = this.byBell[this.mine];
    const stroke = this.bells[this.mine].next;
    // Your bell can only ring the stroke it's on; blows of the other stroke in between were missed.
    while (this.nextMine < mine.length && mine[this.nextMine].stroke !== stroke) {
      this.miss(mine[this.nextMine]);
      this.nextMine++;
    }
    const blow = mine[this.nextMine];
    if (!blow) return;
    this.nextMine++;
    const error = at - blow.ideal;
    blow.at = at;
    blow.error = error;
    this.missedRun = 0;
    this.onJudge?.({ blow, error, wrongPlace: Math.abs(error) > this.gap * 0.55 });
  }

  private miss(blow: Blow): void {
    blow.error = null;
    this.missedRun++;
    this.onJudge?.({ blow, error: null, wrongPlace: false });
  }

  /** Mark your blows that have gone by unrung; returns true if you have stopped ringing altogether. */
  sweep(now: number): boolean {
    const last = this.blows[this.blows.length - 1];
    if (now > last.ideal + 1.5) this.finished = true;
    if (this.listen) return false;
    const mine = this.byBell[this.mine];
    while (this.nextMine < mine.length && now > mine[this.nextMine].ideal + this.gap * 3) {
      // Only if the bell is still sat at its stay: a bell in mid-swing will answer for this blow itself.
      if (!this.bells[this.mine].set) break;
      this.miss(mine[this.nextMine]);
      this.nextMine++;
    }
    return this.missedRun >= 4;
  }

  /** Stop the band: no more pulls; the bells come to rest at their stays. */
  stand(): void {
    this.aborted = true;
    this.finished = true;
  }

  /** The row being rung at time t (the last whose first blow has passed), or -1 before the start. */
  rowAt(t: number): number {
    let lo = -1;
    for (let r = 0; r < this.rowStart.length; r++) if (this.rowStart[r] - this.gap * 0.5 <= t) lo = r;
    return lo;
  }

  /** Summary of your striking, ignoring the first whole pull while you find the beat. */
  summary(): { blows: number; good: number; fair: number; missed: number; rms: number; mean: number } {
    const mine = this.byBell[this.mine].filter((b) => b.row >= 2 && b.error !== undefined);
    const hits = mine.filter((b) => b.error !== null) as (Blow & { error: number })[];
    const rms = hits.length ? Math.sqrt(hits.reduce((a, b) => a + b.error * b.error, 0) / hits.length) : 0;
    const mean = hits.length ? hits.reduce((a, b) => a + b.error, 0) / hits.length : 0;
    return {
      blows: mine.length,
      good: hits.filter((b) => Math.abs(b.error) <= 0.045).length,
      fair: hits.filter((b) => Math.abs(b.error) > 0.045 && Math.abs(b.error) <= 0.1).length,
      missed: mine.length - hits.length,
      rms,
      mean,
    };
  }
}
