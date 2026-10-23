// Signal box: everything that happens at Wenlow Junction, stepped in seconds.
//
// The frame is interlocked as its locking table says; four signals are also held
// electrically, starting signals by the box ahead's line clear and home signals by
// the track circuits beyond them. The three neighbouring boxes work absolute block
// with us by bell and block instrument. Drivers obey what they can see and what
// the distant told them about what they can't. Nothing here knows about drawing.

import { BEAT_GAP, CLASSES, CODE_END, CODE_MEANING, beatTimes, isLineClearCode, parseTaps } from './_codes';
import {
  BOXES,
  LEVER,
  LEVERS,
  LIMITS,
  PASS_S,
  PATH_BOXES,
  PATH_END,
  PATH_SIGNALS,
  TRACKS,
  type BoxId,
  type PathId,
  type PathSignal,
  type TrackId,
} from './_layout';
import { consist, rng, runTime, trainLength, type Booking, type Shift, type Vehicle } from './_timetable';

export type BlockState = 'LB' | 'LC' | 'TOL';

export const BLOCK_NAMES: Record<BlockState, string> = {
  LB: 'Line blocked',
  LC: 'Line clear',
  TOL: 'Train on line',
};

export interface Entry {
  booked: number;
  offeredAt?: number;
  acceptedAt?: number;
  enteredAt?: number;
  offeredOnAt?: number;
  acceptedOnAt?: number;
  passedAt?: number;
  sentOnAt?: number;
  outAt?: number;
  clearedAt?: number;
}

export interface Train {
  id: number;
  b: Booking;
  path: PathId;
  from: BoxId;
  to: BoxId;
  vehicles: Vehicle[];
  len: number;
  s: number;
  v: number;
  state: 'due' | 'running' | 'gone';
  /** What the driver made of the distant: off, at caution, or not yet seen. */
  distant: 'off' | 'on' | null;
  /** Lever number of the stop signal the train is standing at, if any. */
  heldAt: number | null;
  heldSince: number;
  reaction: number;
  noTail: boolean;
  /** For a train without its tail lamp: we've rung 9 to the box ahead, and they've phoned to say it arrived complete. */
  toldAhead: boolean;
  complete: boolean;
  complained: boolean;
  rule55: boolean;
  caughtUp: boolean;
  tailSeen: boolean;
  goneAt: number | null;
  entry: Entry;
}

export type BoxEvent =
  | { type: 'bell'; box: BoxId; code: string; beats: number[] }
  | { type: 'sent'; box: BoxId; code: string }
  | { type: 'phone'; from: string; text: string }
  | { type: 'lever'; n: number; reversed: boolean; dur: number }
  | { type: 'locked'; n: number; reason: string }
  | { type: 'needle'; box: BoxId; which: 'in' | 'out'; state: BlockState }
  | { type: 'refused'; box: BoxId; reason: string }
  | { type: 'irregular'; text: string }
  | { type: 'horn'; train: number }
  | { type: 'pass'; train: number }
  | { type: 'end' };

interface LeverState {
  n: number;
  reversed: boolean;
  moving: boolean;
  /** Seconds left in a stroke under way. */
  left: number;
}

interface Ring {
  code: string;
  at: number;
  ack?: { code: string; every: number; then?: () => void };
  done?: () => void;
  /** A reply to something we rang: it goes out even while they wait on us for something else. */
  reply?: boolean;
}

export interface Offer {
  train: Train;
  stage: 'call' | 'ask' | 'accepted' | 'entered';
  askedAt: number;
  dep: number;
  /** We have repeated their is-line-clear code back. */
  repeated: boolean;
}

/** Where a train's starting signal stands: past it, the train is in the section ahead. */
export function starterOf(tr: Train): number {
  return PATH_SIGNALS[tr.path].find((g) => g.role === 'starting')!.s;
}

const STOP_SIGHT = 320;
const DISTANT_SIGHT = 260;
/** How far short of a stop signal a driver brings the front of the train. */
const STAND_OFF = 9;

const STROKE: Record<string, number> = { distant: 1.25, stop: 0.75, points: 1.0, fpl: 0.55, spare: 0.6 };

export class Neighbour {
  readonly id: BoxId;
  private q: Ring[] = [];
  /** When our bell for this box falls quiet. */
  busyUntil = 0;
  awaiting: { code: string; next: number; every: number; then?: () => void } | null = null;
  offer: Offer | null = null;
  /** Bookings from this box, still to be offered. */
  queue: Train[] = [];
  /** A train of ours they gave line clear for, and the one in their section. */
  acceptedFor: Train | null = null;
  /** When we last called attention, and whether they've answered it. */
  called: number | null = null;
  answered = false;
  private clearing = new Set<number>();
  private replyDelay: () => number;

  constructor(
    id: BoxId,
    private box: Box,
    seed: number,
  ) {
    this.id = id;
    const r = rng(seed);
    this.replyDelay = () => 0.8 + r() * 0.9;
  }

  get name(): string {
    return BOXES[this.id].name;
  }

  /** Ring a code on our bell, in turn; a reply jumps the queue. */
  ring(code: string, opts: Partial<Ring> = {}, first = false): void {
    const r: Ring = { code, at: opts.at ?? this.box.t, ack: opts.ack, done: opts.done, reply: first };
    if (first) this.q.unshift(r);
    else this.q.push(r);
  }

  private later: { at: number; fn: () => void }[] = [];

  step(t: number): void {
    const box = this.box;
    // Start the next train's offer once the last one is out of section.
    if (!this.offer && this.queue.length) {
      const tr = this.queue[0];
      const offerAt = tr.entry.booked - runTime(tr.b) - 55;
      if (t >= offerAt) {
        this.queue.shift();
        this.offer = { train: tr, stage: 'call', askedAt: 0, dep: 0, repeated: false };
        this.ring('1', {
          ack: {
            code: '1',
            every: 9,
            then: () => {
              if (!this.offer) return;
              this.offer.stage = 'ask';
              this.offer.askedAt = box.t + 1;
              this.ring(CLASSES[tr.b.cls].code, { at: box.t + 1 });
              tr.entry.offeredAt ??= box.t + 1;
            },
          },
        });
      }
    }
    const o = this.offer;
    if (o?.stage === 'ask') {
      if (box.inState[this.id] === 'LC') {
        o.stage = 'accepted';
        o.train.entry.acceptedAt = t;
        const want = o.train.entry.booked - runTime(o.train.b);
        o.dep = Math.max(t + 5 + this.replyDelay() * 2, want);
      } else if (t - o.askedAt > 32 && !this.awaiting && t >= this.busyUntil) {
        // Not accepted: ask again.
        o.askedAt = t;
        this.ring('1', {
          ack: { code: '1', every: 9, then: () => this.ring(CLASSES[o.train.b.cls].code, { at: box.t + 1 }) },
        });
      }
    }
    if (o?.stage === 'accepted' && t >= o.dep) {
      o.stage = 'entered';
      box.depart(o.train);
      o.train.entry.enteredAt = t;
      this.ring('2', { ack: { code: '2', every: 12 } });
    }

    // Trains of ours that have run out of their section: give train out of section.
    for (const tr of box.trains) {
      if (tr.to !== this.id || tr.state !== 'gone' || this.clearing.has(tr.id)) continue;
      if (tr.goneAt === null || t < tr.goneAt + 5) continue;
      this.clearing.add(tr.id);
      if (tr.entry.sentOnAt === undefined) box.irregular(`${tr.b.hc} ran into ${this.name}'s section with no Train entering section from you`);
      if (tr.noTail && !tr.complete) {
        tr.complete = true;
        box.phone(this.name, `${tr.b.hc} has arrived here complete. Its tail lamp was out; we've lit it.`);
      }
      this.ring('1', {
        ack: {
          code: '1',
          every: 10,
          then: () =>
            this.ring('2-1', {
              at: box.t + 1,
              done: () => {
                box.setOut(this.id, 'LB');
                tr.entry.clearedAt = box.t;
                if (this.acceptedFor === tr) this.acceptedFor = null;
              },
            }),
        },
      });
    }

    // Ring out whatever is next, or ring again for a reply that hasn't come.
    if (t < this.busyUntil || box.tapping(this.id, t)) return;
    const i = this.q.findIndex((r) => r.at <= t && (r.reply || !this.awaiting));
    if (i >= 0) {
      const [r] = this.q.splice(i, 1);
      const end = this.play(r.code);
      if (r.ack) this.awaiting = { code: r.ack.code, next: end + r.ack.every, every: r.ack.every, then: r.ack.then };
      if (r.done) this.later.push({ at: end, fn: r.done });
      return;
    }
    if (this.awaiting && t >= this.awaiting.next) {
      this.play(this.awaiting.code);
      this.awaiting.next = t + this.awaiting.every;
    }
  }

  /** Ring a code now; returns when its last beat sounds. */
  private play(code: string): number {
    const t = this.box.t;
    const beats = beatTimes(code).map((b) => t + b);
    const end = beats[beats.length - 1];
    this.busyUntil = end + 0.9;
    this.box.emit({ type: 'bell', box: this.id, code, beats });
    return end;
  }

  /** Run what was waiting on a ring to finish. */
  runCallbacks(t: number): void {
    const due = this.later.filter((l) => l.at <= t);
    if (!due.length) return;
    this.later = this.later.filter((l) => l.at > t);
    for (const l of due) l.fn();
  }

  /** Nothing rung, waited on, or due. */
  get quiet(): boolean {
    return !this.offer && !this.awaiting && this.queue.length === 0 && this.q.length === 0 && this.later.length === 0;
  }

  /** A code from our tapper, heard in their box. */
  hear(code: string): void {
    const box = this.box;
    const t = box.t;
    if (this.awaiting && code === this.awaiting.code) {
      const then = this.awaiting.then;
      this.awaiting = null;
      then?.();
      return;
    }
    const o = this.offer;
    // Our repeat of their offer, unless we couldn't take it anyway: then it's an offer of our own.
    if (o?.stage === 'ask' && code === CLASSES[o.train.b.cls].code && !box.whyNot(this.id, 'LC')) {
      o.repeated = true;
      return;
    }
    if (code === '1') {
      this.called = t;
      this.answered = false;
      this.ring('1', { at: t + this.replyDelay(), done: () => (this.answered = true) }, true);
      return;
    }
    this.called = null;
    this.answered = false;
    if (isLineClearCode(code)) {
      const tr = box.nextTrainTo(this.id);
      if (box.outState[this.id] !== 'LB' || this.acceptedFor) return; // can't accept: no reply
      this.acceptedFor = tr;
      if (tr) {
        tr.entry.offeredOnAt = t;
        if (CLASSES[tr.b.cls].code !== code)
          box.irregular(`Described ${tr.b.hc} to ${this.name} as ${code}; it is ${CLASSES[tr.b.cls].code}, ${CLASSES[tr.b.cls].asks}`);
      }
      this.ring(
        code,
        {
          at: t + this.replyDelay() + 0.4,
          done: () => {
            box.setOut(this.id, 'LC');
            if (tr) tr.entry.acceptedOnAt = box.t;
          },
        },
        true,
      );
      return;
    }
    if (code === '2') {
      if (box.outState[this.id] !== 'LC') return;
      const tr = this.acceptedFor;
      if (tr) tr.entry.sentOnAt = t;
      this.ring('2', { at: t + this.replyDelay(), done: () => box.setOut(this.id, 'TOL') }, true);
      return;
    }
    if (code === '2-1') {
      if (o?.stage === 'entered') {
        box.outOfSection(this, o.train);
        this.offer = null;
        this.ring('2-1', { at: t + this.replyDelay() }, true);
      }
      return;
    }
    if (code === '3-5') {
      // Cancelling: they take back a line clear for a train that hasn't entered their section.
      const tr = this.acceptedFor;
      const entered = tr && (tr.state === 'gone' || (tr.state === 'running' && tr.s > starterOf(tr)));
      if (box.outState[this.id] === 'LB' || entered) return;
      if (tr) {
        tr.entry.offeredOnAt = undefined;
        tr.entry.acceptedOnAt = undefined;
        tr.entry.sentOnAt = undefined;
      }
      this.acceptedFor = null;
      this.ring('3-5', { at: t + this.replyDelay(), done: () => box.setOut(this.id, 'LB') }, true);
      return;
    }
    if (code === '9' || code === '4-5' || code === '16' || code === '6') {
      this.ring(code, { at: t + this.replyDelay() }, true);
      if (code === '9') box.tailReported(this.id);
      return;
    }
    box.note(`${this.name} couldn't make out ${code} and didn't answer`);
  }
}

export class Box {
  t = 0;
  readonly shift: Shift;
  readonly levers: LeverState[];
  inState: Record<BoxId, BlockState> = { callow: 'LB', marsh: 'LB', pell: 'LB' };
  outState: Record<BoxId, BlockState> = { callow: 'LB', marsh: 'LB', pell: 'LB' };
  readonly neighbours: Record<BoxId, Neighbour>;
  readonly trains: Train[];
  occupied = new Set<TrackId>();
  events: BoxEvent[] = [];
  irregularities: { t: number; text: string }[] = [];
  notes: { t: number; text: string }[] = [];
  calls: { t: number; from: string; text: string }[] = [];
  ended = false;
  private taps: Record<BoxId, number[]> = { callow: [], marsh: [], pell: [] };

  constructor(shift: Shift, seed = 1) {
    this.shift = shift;
    this.levers = LEVERS.map((l) => ({ n: l.n, reversed: false, moving: false, left: 0 }));
    const night = shift.id === 'night';
    this.trains = shift.bookings.map((b, i) => {
      const vehicles = consist(b, night);
      const route = PATH_BOXES[b.path];
      return {
        id: i,
        b,
        path: b.path,
        from: route.from,
        to: route.to,
        vehicles,
        len: trainLength(vehicles),
        s: 0,
        v: 0,
        state: 'due',
        distant: null,
        heldAt: null,
        heldSince: 0,
        reaction: 0,
        noTail: !!b.noTailLamp,
        toldAhead: false,
        complete: false,
        complained: false,
        rule55: false,
        caughtUp: false,
        tailSeen: false,
        goneAt: null,
        entry: { booked: b.booked },
      } satisfies Train;
    });
    this.neighbours = {
      callow: new Neighbour('callow', this, seed * 7 + 1),
      marsh: new Neighbour('marsh', this, seed * 7 + 2),
      pell: new Neighbour('pell', this, seed * 7 + 3),
    };
    for (const tr of this.trains) this.neighbours[tr.from].queue.push(tr);
  }

  emit(e: BoxEvent): void {
    this.events.push(e);
  }

  irregular(text: string): void {
    this.irregularities.push({ t: this.t, text });
    this.emit({ type: 'irregular', text });
  }

  note(text: string): void {
    this.notes.push({ t: this.t, text });
  }

  phone(from: string, text: string): void {
    this.calls.push({ t: this.t, from, text });
    this.emit({ type: 'phone', from, text });
  }

  lever(n: number): LeverState {
    return this.levers[n - 1];
  }

  isR(n: number): boolean {
    const l = this.lever(n);
    return l.reversed && !l.moving;
  }

  isN(n: number): boolean {
    const l = this.lever(n);
    return !l.reversed && !l.moving;
  }

  clear(...ids: TrackId[]): boolean {
    return ids.every((id) => !this.occupied.has(id));
  }

  /** Why a lever can't be moved to reverse (toR) or back to normal, or null when it can. */
  whyLocked(n: number, toR: boolean): string | null {
    const def = LEVER.get(n);
    if (!def) return 'no such lever';
    const me = this.lever(n);
    if (me.moving) return 'already moving';
    if (def.kind === 'spare') return null;
    for (const x of LEVERS) {
      if (x.n === n) continue;
      const lx = this.lever(x.n);
      if (!lx.reversed && !lx.moving) continue;
      if (x.locks?.includes(n)) return `${x.n} is pulled and holds ${n}`;
      if (toR && x.normal?.includes(n)) return `${x.n} is pulled; put ${x.n} back first`;
      if (!toR && x.reverse?.includes(n)) return `${x.n} is pulled; put ${x.n} back first`;
    }
    if (toR) {
      const need = (def.reverse ?? []).filter((r) => !this.isR(r));
      if (need.length) return `pull ${need.join(' and ')} first`;
      const back = (def.normal ?? []).filter((r) => !this.isN(r));
      if (back.length) return `${back.join(' and ')} must be back`;
      for (const l of def.locks ?? []) if (this.lever(l).moving) return `${l} is moving`;
      switch (n) {
        case 2:
          if (!this.clear('DJ', 'DM1')) return 'track circuits ahead of it are occupied';
          break;
        case 3:
          if (!this.clear('DJ', 'DB1')) return 'track circuits ahead of it are occupied';
          break;
        case 11:
          if (!this.clear('UJ', 'U1', 'DJ')) return 'track circuits ahead of it are occupied';
          break;
        case 12:
          if (!this.clear('UJ', 'U1')) return 'track circuits ahead of it are occupied';
          break;
        case 4:
          if (this.outState.marsh !== 'LC') return 'it needs Line clear from Marsh Lane';
          break;
        case 5:
          if (this.outState.pell !== 'LC') return 'it needs Line clear from Pell Wood';
          break;
        case 10:
          if (this.outState.callow !== 'LC') return 'it needs Line clear from Callow Bank';
          break;
      }
    }
    if ((n === 6 || n === 7) && !this.clear('DJ')) return 'a train is on the down junction';
    if (n === 8 && !this.clear('UJ')) return 'a train is on the up junction';
    return null;
  }

  /** Pull a lever over, or put it back. Returns the reason when the frame won't let it move. */
  pull(n: number): string | null {
    const l = this.lever(n);
    const toR = !l.reversed;
    const why = this.whyLocked(n, toR);
    if (why) {
      if (why !== 'already moving') this.emit({ type: 'locked', n, reason: why });
      return why;
    }
    const dur = STROKE[LEVER.get(n)!.kind];
    l.moving = true;
    l.left = dur;
    l.reversed = toR;
    if (n === 4 || n === 5 || n === 10) {
      if (toR) this.released.add(n);
      else this.released.delete(n);
    }
    this.emit({ type: 'lever', n, reversed: toR, dur });
    return null;
  }

  /** Whether a signal's arm stands off, as the driver sees it. */
  armOff(n: number): boolean {
    if (n === 0) return false;
    if (!this.isR(n)) return false;
    switch (n) {
      case 1:
        return this.armOff(2) && this.armOff(4);
      case 13:
        return this.armOff(12) && this.armOff(10);
      case 2:
        return this.clear('DJ', 'DM1');
      case 3:
        return this.clear('DJ', 'DB1');
      case 11:
        return this.clear('UJ', 'U1', 'DJ');
      case 12:
        return this.clear('UJ', 'U1');
      // A starting signal gets one pull per line clear; the train replaces it as it passes, and a
      // cancelled line clear puts it back.
      case 4:
        return this.released.has(4) && this.clear('DM2') && this.outState.marsh !== 'LB';
      case 5:
        return this.released.has(5) && this.clear('DB2') && this.outState.pell !== 'LB';
      case 10:
        return this.released.has(10) && this.clear('U2') && this.outState.callow !== 'LB';
    }
    return false;
  }

  /** Starting signals pulled under a line clear, not yet passed by their train. */
  released = new Set<number>();

  /** Why our commutator for the line from a box can't go to this state, or null. */
  whyNot(box: BoxId, st: BlockState): string | null {
    if (st !== 'LC' || this.inState[box] === 'LC') return null;
    if (box === 'callow') {
      if (!this.isN(2) || !this.isN(3)) return 'Put the down home signals back first';
      if (!this.clear('DA', 'DJ')) return 'The down line is occupied up to the clearing point';
    } else if (box === 'marsh') {
      if (!this.isN(12)) return 'Put the up main home back first';
      if (!this.clear('UA', 'UJ')) return 'The up main is occupied up to the clearing point';
    } else {
      if (!this.isN(11)) return 'Put the up branch home back first';
      if (!this.clear('UBA', 'UJ')) return 'The up branch is occupied up to the clearing point';
    }
    return null;
  }

  setCommutator(box: BoxId, st: BlockState): string | null {
    const why = this.whyNot(box, st);
    if (why) {
      this.emit({ type: 'refused', box, reason: why });
      return why;
    }
    if (this.inState[box] === st) return null;
    this.inState[box] = st;
    this.emit({ type: 'needle', box, which: 'in', state: st });
    return null;
  }

  setOut(box: BoxId, st: BlockState): void {
    if (this.outState[box] === st) return;
    this.outState[box] = st;
    this.emit({ type: 'needle', box, which: 'out', state: st });
  }

  /** One beat on our tapper for a box. */
  tap(box: BoxId): void {
    this.taps[box].push(this.t);
  }

  /** Beats tapped so far on a box's tapper, not yet sent. */
  pending(box: BoxId): number[] {
    return this.taps[box];
  }

  tapping(box: BoxId, t: number): boolean {
    const b = this.taps[box];
    return b.length > 0 || t < this.neighbours[box].busyUntil - 0.9;
  }

  /** Ring a whole code at once, as the guide and the demonstration do. */
  send(box: BoxId, code: string): void {
    this.taps[box] = [];
    this.emit({ type: 'sent', box, code });
    this.neighbours[box].hear(code);
  }

  /** The first train booked to run on to a box that hasn't yet passed our starting signal or been accepted there. */
  nextTrainTo(box: BoxId): Train | null {
    let best: Train | null = null;
    const held = this.neighbours[box].acceptedFor;
    for (const tr of this.trains) {
      if (tr.to !== box || tr === held || tr.state === 'gone') continue;
      if (tr.state === 'running' && tr.s > starterOf(tr)) continue;
      if (!best || tr.entry.booked < best.entry.booked) best = tr;
    }
    return best;
  }

  depart(tr: Train): void {
    tr.state = 'running';
    tr.s = 0;
    tr.v = CLASSES[tr.b.cls].vmax * 0.4;
  }

  outOfSection(n: Neighbour, tr: Train): void {
    tr.entry.outAt = this.t;
    if (tr.state === 'running' && tr.s - tr.len < PASS_S + 40)
      this.irregular(`Gave Train out of section to ${n.name} for ${tr.b.hc} before it had cleared the junction`);
    else if (tr.noTail && !tr.complete)
      this.irregular(`Gave Train out of section for ${tr.b.hc} without seeing its tail lamp`);
    if (this.inState[n.id] === 'LC')
      this.irregular(`Left the block from ${n.name} at Line clear while ${tr.b.hc} was in the section`);
  }

  tailReported(box: BoxId): void {
    for (const tr of this.trains) {
      if (tr.to !== box || !tr.noTail || tr.complete || tr.state === 'due') continue;
      tr.toldAhead = true;
      if (tr.state === 'gone') {
        tr.complete = true;
        this.phone(BOXES[box].name, `${tr.b.hc} has arrived here complete. Its tail lamp was out; we've lit it.`);
      }
    }
  }

  step(dt: number): void {
    this.t += dt;
    const t = this.t;

    for (const l of this.levers)
      if (l.moving) {
        l.left -= dt;
        if (l.left <= 0) l.moving = false;
      }

    // Finish tapped codes once the tapper has been quiet long enough.
    for (const id of Object.keys(this.taps) as BoxId[]) {
      const b = this.taps[id];
      if (b.length && t - b[b.length - 1] > CODE_END) {
        const code = parseTaps(b);
        this.taps[id] = [];
        this.emit({ type: 'sent', box: id, code });
        this.neighbours[id].hear(code);
      }
    }

    this.occupy();
    for (const tr of this.trains) if (tr.state === 'running') this.drive(tr, dt);
    this.occupy();
    if (this.occupied.has('DM2')) this.released.delete(4);
    if (this.occupied.has('DB2')) this.released.delete(5);
    if (this.occupied.has('U2')) this.released.delete(10);

    for (const n of Object.values(this.neighbours)) {
      n.runCallbacks(t);
      n.step(t);
    }

    if (!this.ended && this.trains.every((tr) => tr.state === 'gone')) {
      const quiet = Object.values(this.neighbours).every((n) => n.quiet);
      const blocks = (Object.keys(this.outState) as BoxId[]).every((b) => this.outState[b] === 'LB');
      if (quiet && blocks && this.trains.every((tr) => tr.entry.clearedAt !== undefined)) {
        this.ended = true;
        this.emit({ type: 'end' });
      }
    }
  }

  private occupy(): void {
    this.occupied.clear();
    for (const tr of this.trains) {
      if (tr.state !== 'running') continue;
      const rear = tr.s - tr.len;
      for (const [id, a, b] of TRACKS[tr.path]) if (rear < b && tr.s > a) this.occupied.add(id);
    }
  }

  /** Whether the signal stands off for this train's route. */
  private offFor(sig: PathSignal): boolean {
    return this.armOff(sig.lever);
  }

  private drive(tr: Train, dt: number): void {
    const c = CLASSES[tr.b.cls];
    const t = this.t;
    let limit = Infinity;
    let heldBy: PathSignal | null = null;
    for (const sig of PATH_SIGNALS[tr.path]) {
      const d = sig.s - tr.s;
      if (d <= 0) continue;
      if (sig.role === 'distant' || sig.role === 'fixed-distant') {
        if (d <= DISTANT_SIGHT) tr.distant = this.offFor(sig) ? 'off' : 'on';
        continue;
      }
      if (d <= STOP_SIGHT) {
        if (this.offFor(sig)) continue;
        limit = sig.s - STAND_OFF;
        heldBy = sig;
        break;
      }
      if (tr.distant === 'on') {
        limit = sig.s - STAND_OFF;
        heldBy = sig;
        break;
      }
    }

    // A train ahead on the same line, which only a false Train out of section lets into one section with another:
    // the driver stops when he sees its tail.
    const ahead = this.trainAhead(tr);
    if (ahead) {
      const tail = ahead.s - ahead.len - 25;
      if (tail - tr.s < 450 && tail < limit) {
        limit = Math.max(tr.s, tail);
        heldBy = null;
        if (!tr.caughtUp && tr.s < 1440) {
          tr.caughtUp = true;
          this.irregular(`${tr.b.hc} was let into the section behind ${ahead.b.hc} and had to stop for it`);
        }
      }
    }

    // Speed: line speed, then limits ahead, then what's needed to stop short of a signal at danger.
    let vAllowed = c.vmax;
    for (const [a, b, vl] of LIMITS[tr.path]) {
      if (tr.s > a && tr.s - tr.len < b) vAllowed = Math.min(vAllowed, vl);
      else if (a > tr.s) vAllowed = Math.min(vAllowed, Math.sqrt(vl * vl + 2 * c.brake * (a - tr.s)));
    }
    const gap = limit - tr.s;
    if (Number.isFinite(limit)) vAllowed = Math.min(vAllowed, Math.sqrt(Math.max(0, 2 * c.brake * gap)));

    if (tr.v < 0.05 && gap < 2) {
      // Standing at a signal.
      tr.v = 0;
      if (heldBy && tr.heldAt !== heldBy.lever) {
        tr.heldAt = heldBy.lever;
        tr.heldSince = t;
        this.emit({ type: 'horn', train: tr.id });
        if (heldBy.other && this.armOff(heldBy.other) && !tr.complained) {
          tr.complained = true;
          const route = tr.to === 'pell' ? 'the Pell Wood branch' : 'the main line to Marsh Lane';
          this.phone(
            `Driver of ${tr.b.hc}`,
            `At your ${heldBy.lever} signal. The arm that's off isn't mine: I'm booked for ${route}.`,
          );
          this.irregular(`Set the wrong route for ${tr.b.hc}; the driver stopped at the ${heldBy.lever} signal`);
        }
      }
      if (heldBy && !tr.rule55 && t - tr.heldSince > 80) {
        tr.rule55 = true;
        const mins = Math.max(1, Math.round((t - tr.heldSince) / 60));
        this.phone(
          `Driver of ${tr.b.hc}`,
          `Standing at your ${heldBy.lever} signal, ${mins === 1 ? 'a minute and a half' : `${mins} minutes`} now.`,
        );
      }
      tr.reaction = 2.5 + (tr.id % 3) * 0.8;
      return;
    }
    if (tr.v < 0.05 && tr.reaction > 0) {
      tr.reaction -= dt;
      return;
    }
    if (tr.heldAt !== null && gap > 2) tr.heldAt = null;

    if (tr.v > vAllowed) {
      tr.v = Math.max(vAllowed, tr.v - c.brake * 1.6 * dt);
    } else {
      const pull = c.accel * Math.max(0.15, 1 - tr.v / (c.vmax * 1.15));
      tr.v = Math.min(vAllowed, tr.v + pull * dt);
    }
    const before = tr.s;
    tr.s += tr.v * dt;
    if (tr.s > limit) tr.s = Math.max(before, limit);

    if (before < PASS_S && tr.s >= PASS_S) {
      tr.entry.passedAt = t;
      this.emit({ type: 'pass', train: tr.id });
    }
    // Past the starting signal it is the box ahead's train, whichever train they gave the line clear for.
    const st = starterOf(tr);
    if (before < st && tr.s >= st) this.neighbours[tr.to].acceptedFor = tr;
    if (!tr.tailSeen && tr.s - tr.len >= PASS_S) tr.tailSeen = true;
    if (tr.s - tr.len > PATH_END) {
      tr.state = 'gone';
      tr.goneAt = t;
    }
  }

  /** The nearest train ahead of this one on track it will run over. */
  private trainAhead(tr: Train): Train | null {
    const down = tr.path === 'DM' || tr.path === 'DB';
    let best: Train | null = null;
    for (const o of this.trains) {
      if (o === tr || o.state !== 'running' || o.s <= tr.s) continue;
      const oDown = o.path === 'DM' || o.path === 'DB';
      if (oDown !== down) continue;
      // Down trains share the line up to the junction points; up trains share it from the up junction west.
      const shared = o.path === tr.path || (down ? o.s - o.len < 1530 : o.s - o.len >= 1470);
      if (!shared) continue;
      if (!best || o.s < best.s) best = o;
    }
    return best;
  }

  /** Minutes late past the box, for trains that have passed. */
  lateness(tr: Train): number | null {
    if (tr.entry.passedAt === undefined) return null;
    return Math.max(0, Math.round((tr.entry.passedAt - tr.entry.booked) / 60));
  }

  meaning(code: string): string {
    return CODE_MEANING.get(code) ?? 'not a code in the book';
  }
}

export { BEAT_GAP, CODE_END };
