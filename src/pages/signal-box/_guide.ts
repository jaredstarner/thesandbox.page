// Signal box: what a good signalman would do next, worked out from the box as it stands.
//
// The guide shows it as a hint; the demonstration does it. Each piece of advice is
// one action: a beat code on a tapper, a lever, or a block handle.

import { CLASSES, beatTimes } from './_codes';
import { BOXES, PASS_S, PATH_SIGNALS, type BoxId } from './_layout';
import type { BlockState, Box, Train } from './_sim';
import { clock } from './_timetable';

export type Advice =
  | { kind: 'tap'; box: BoxId; code: string; why: string }
  | { kind: 'lever'; n: number; why: string }
  | { kind: 'block'; box: BoxId; state: BlockState; why: string }
  | { kind: 'wait'; why: string };

const IDS: BoxId[] = ['callow', 'marsh', 'pell'];
const name = (b: BoxId) => BOXES[b].name;

/** Trains on their way to us or through the junction, with their offer accepted. */
function coming(box: Box): Train[] {
  const out: Train[] = [];
  for (const id of IDS) {
    const o = box.neighbours[id].offer;
    if (o && (o.stage === 'accepted' || o.stage === 'entered') && o.train.state !== 'gone') out.push(o.train);
  }
  for (const tr of box.trains) if (tr.state === 'running' && !out.includes(tr)) out.push(tr);
  return out.sort((a, b) => eta(a) - eta(b));
}

/** Rough seconds until a train reaches its home signal. */
function eta(tr: Train): number {
  const home = PATH_SIGNALS[tr.path].find((s) => s.role === 'home')!.s;
  if (tr.state === 'due') return 200 + (home - 0) / 20;
  return (home - tr.s) / Math.max(tr.v, 6);
}

function signalS(tr: Train, lever: number): number | null {
  return PATH_SIGNALS[tr.path].find((s) => s.lever === lever)?.s ?? null;
}

/** Whether any train still has to pass this signal lever's arm. */
function needed(box: Box, n: number): boolean {
  for (const tr of coming(box)) {
    const s = signalS(tr, n);
    if (s !== null && (tr.state !== 'running' || tr.s < s)) return true;
  }
  return false;
}

/** The levers a route wants reversed, in the order to pull them, with the starting signal only once it can be. */
function routeFor(box: Box, tr: Train): { points: [number, boolean][]; signals: number[] } {
  switch (tr.path) {
    case 'DM':
      return { points: [[7, false]], signals: box.outState.marsh === 'LC' ? [4, 2, 1] : [2] };
    case 'DB':
      return { points: [[7, true]], signals: box.outState.pell === 'LC' ? [5, 3] : [3] };
    case 'UM':
      return { points: [[8, false]], signals: box.outState.callow === 'LC' ? [10, 12, 13] : [12] };
    case 'UB':
      return { points: [[8, true]], signals: box.outState.callow === 'LC' ? [10, 11] : [11] };
  }
}

const quiet = (box: Box, id: BoxId) => box.t >= box.neighbours[id].busyUntil - 0.5 && box.pending(id).length === 0;

export function advise(box: Box): Advice {
  const t = box.t;
  // Answer anything a box is waiting on us to repeat.
  for (const id of IDS) {
    const nb = box.neighbours[id];
    if (!nb.awaiting || !quiet(box, id)) continue;
    const code = nb.awaiting.code;
    if (code === '1') return { kind: 'tap', box: id, code, why: `${name(id)} is calling attention. Answer with one beat.` };
    if (code === '2') {
      const hc = nb.offer?.train.b.hc ?? 'the train';
      return {
        kind: 'tap',
        box: id,
        code,
        why: `${name(id)} rang 2, Train entering section: ${hc} is on its way. Acknowledge with 2.`,
      };
    }
    return { kind: 'tap', box: id, code, why: `${name(id)} is waiting for you to repeat ${code}.` };
  }

  // A train is in the section from a box: the block shows it.
  for (const id of IDS) {
    const o = box.neighbours[id].offer;
    if (o?.stage === 'entered' && box.inState[id] === 'LC')
      return {
        kind: 'block',
        box: id,
        state: 'TOL',
        why: `${o.train.b.hc} has entered the section from ${name(id)}. Turn ${name(id)}'s handle to Train on line.`,
      };
  }

  // Send the train on: Train entering section to the box ahead once it's past the box and the starting signal.
  for (const tr of box.trains) {
    if (tr.state !== 'running' || tr.entry.passedAt === undefined || tr.entry.sentOnAt !== undefined) continue;
    if (box.outState[tr.to] !== 'LC' || !quiet(box, tr.to)) continue;
    const starter = PATH_SIGNALS[tr.path].find((g) => g.role === 'starting')!;
    if (tr.s < starter.s && !(box.armOff(starter.lever) && tr.v > 3)) continue;
    return {
      kind: 'tap',
      box: tr.to,
      code: '2',
      why: `${tr.b.hc} has passed the box. Ring 2, Train entering section, to ${name(tr.to)}.`,
    };
  }

  // A train entering section rung too soon, with the train still held at the starting signal: cancel it.
  for (const tr of box.trains) {
    const starter = PATH_SIGNALS[tr.path].find((g) => g.role === 'starting')!;
    if (tr.state !== 'running' || tr.heldAt !== starter.lever || box.outState[tr.to] !== 'TOL') continue;
    if (box.armOff(starter.lever)) continue;
    if (!quiet(box, tr.to)) continue;
    return {
      kind: 'tap',
      box: tr.to,
      code: '3-5',
      why: `${tr.b.hc} is standing at your ${starter.lever} signal, but ${name(tr.to)} shows Train on line. Ring 3-5, Cancelling, then offer it again.`,
    };
  }

  // Put signals back once their train has passed them, distants first. An arm already
  // knocked back to danger by its train needs its lever back too, before it can be pulled again.
  for (const n of [1, 13, 2, 3, 11, 12, 4, 5, 10]) {
    if (!box.isR(n)) continue;
    if (needed(box, n) && box.armOff(n)) continue;
    if (box.whyLocked(n, false)) continue;
    return { kind: 'lever', n, why: `The train has passed signal ${n}. Put lever ${n} back.` };
  }

  // Tail lamps, then train out of section to the box in rear.
  for (const id of IDS) {
    const nb = box.neighbours[id];
    const o = nb.offer;
    if (o?.stage !== 'entered') continue;
    const tr = o.train;
    const clearOf = tr.state === 'gone' || tr.s - tr.len > PASS_S + 60;
    if (!clearOf) continue;
    if (tr.noTail && !tr.complete) {
      if (!tr.toldAhead && quiet(box, tr.to))
        return {
          kind: 'tap',
          box: tr.to,
          code: '9',
          why: `${tr.b.hc} went by with no tail lamp: part of it may have been left behind. Ring 9 to ${name(tr.to)}, and wait to hear it arrived complete.`,
        };
      continue;
    }
    if (!quiet(box, id)) continue;
    if (nb.called === null || (!nb.answered && t - nb.called > 12))
      return {
        kind: 'tap',
        box: id,
        code: '1',
        why: `${tr.b.hc} is clear of the junction with its tail lamp. Call attention to ${name(id)} before Train out of section.`,
      };
    if (nb.answered)
      return { kind: 'tap', box: id, code: '2-1', why: `Ring 2-1, Train out of section, to ${name(id)} for ${tr.b.hc}.` };
  }

  // Block handles back to normal once the section is empty.
  for (const id of IDS) {
    const o = box.neighbours[id].offer;
    if (box.inState[id] === 'TOL' && (!o || o.stage === 'call' || o.stage === 'ask'))
      return { kind: 'block', box: id, state: 'LB', why: `The section from ${name(id)} is clear. Turn its handle back to Line blocked.` };
  }

  // Accept an offered train.
  let held: string | null = null;
  for (const id of IDS) {
    const o = box.neighbours[id].offer;
    if (o?.stage !== 'ask' || !quiet(box, id)) continue;
    const c = CLASSES[o.train.b.cls];
    const why = box.whyNot(id, 'LC');
    if (why) {
      held = `${name(id)} is offering ${o.train.b.hc}, but you can't accept it yet: ${why.toLowerCase()}.`;
      continue;
    }
    if (!o.repeated)
      return {
        kind: 'tap',
        box: id,
        code: c.code,
        why: `${name(id)} rang ${c.code}: is line clear for ${c.asks}? It's ${o.train.b.hc}, for ${name(o.train.to)}. Repeat ${c.code} to accept it.`,
      };
    return { kind: 'block', box: id, state: 'LC', why: `Now turn ${name(id)}'s handle to Line clear.` };
  }

  // Offer trains on to the box ahead.
  for (const tr of coming(box)) {
    const ahead = box.neighbours[tr.to];
    if (box.outState[tr.to] !== 'LB' || ahead.acceptedFor || box.nextTrainTo(tr.to) !== tr) continue;
    // While they're offering us a train we can take, deal with that first.
    const asking = ahead.offer?.stage === 'ask' && !box.whyNot(tr.to, 'LC');
    if (ahead.awaiting || ahead.offer?.stage === 'call' || asking || !quiet(box, tr.to)) continue;
    const c = CLASSES[tr.b.cls];
    if (ahead.called === null || (!ahead.answered && t - ahead.called > 12))
      return {
        kind: 'tap',
        box: tr.to,
        code: '1',
        why: `Offer ${tr.b.hc} on to ${name(tr.to)}: call attention with one beat.`,
      };
    if (ahead.answered)
      return {
        kind: 'tap',
        box: tr.to,
        code: c.code,
        why: `Ask ${name(tr.to)} if the line is clear for ${c.asks}: ring ${c.code}.`,
      };
  }

  // Set the road for the next train on each side of the junction.
  const down = coming(box).find((tr) => tr.from === 'callow' && !passed(tr, 'starting'));
  const up = coming(box).find((tr) => tr.from !== 'callow' && !passed(tr, 'starting'));
  for (const tr of [down, up]) {
    if (!tr) continue;
    const a = road(box, tr);
    if (a) return a;
  }

  if (held) return { kind: 'wait', why: held };
  const next = box.trains
    .filter((tr) => tr.state === 'due' && tr.entry.offeredAt === undefined)
    .sort((a, b) => a.entry.booked - b.entry.booked)[0];
  if (next)
    return {
      kind: 'wait',
      why: `Nothing to do until the next bell. Next booked past the box: ${next.b.hc}, ${CLASSES[next.b.cls].asks}, from ${name(next.from)} for ${name(next.to)}, at ${clock(box.shift.start + next.entry.booked)}.`,
    };
  return { kind: 'wait', why: 'Nothing to do until the next bell.' };
}

function passed(tr: Train, role: 'home' | 'starting'): boolean {
  if (tr.state !== 'running') return false;
  const at = PATH_SIGNALS[tr.path].find((s) => s.role === role)!.s;
  return tr.s > at + 1;
}

/** The next lever to set a train's road, if any can be moved now. */
function road(box: Box, tr: Train): Advice | null {
  const r = routeFor(box, tr);
  // Past the home signal, the points are already set and held.
  if (passed(tr, 'home')) r.points = [];
  for (const [p, rev] of r.points) {
    const lev = box.lever(p);
    if (lev.moving) return null;
    if (lev.reversed === rev) continue;
    if (p === 7 && box.isR(6)) {
      if (box.whyLocked(6, false)) return null;
      return { kind: 'lever', n: 6, why: `Withdraw the facing point lock, 6, so the points can move for ${tr.b.hc}.` };
    }
    if (box.whyLocked(p, rev)) return null;
    const where = rev ? 'for the branch' : 'for the main line';
    return { kind: 'lever', n: p, why: `Set points ${p} ${where} for ${tr.b.hc}.` };
  }
  if ((tr.path === 'DM' || tr.path === 'DB') && !passed(tr, 'home')) {
    if (box.lever(6).moving) return null;
    if (!box.isR(6)) {
      if (box.whyLocked(6, true)) return null;
      return { kind: 'lever', n: 6, why: `Lock the facing points with 6 before clearing a signal over them.` };
    }
  }
  for (const n of r.signals) {
    if (box.isR(n) || box.lever(n).moving) continue;
    const at = signalS(tr, n);
    if (tr.state === 'running' && at !== null && tr.s > at) continue;
    if (box.whyLocked(n, true)) return null;
    const role = PATH_SIGNALS[tr.path].find((s) => s.lever === n)?.role ?? 'signal';
    return { kind: 'lever', n, why: `Pull ${n}, the ${role} signal, for ${tr.b.hc}.` };
  }
  return null;
}

/** How long an action keeps the signalman busy, in seconds. */
export function actionTime(a: Advice): number {
  switch (a.kind) {
    case 'tap': {
      const b = beatTimes(a.code);
      return b[b.length - 1] + 1.6;
    }
    case 'lever':
      return 1.4;
    case 'block':
      return 0.8;
    case 'wait':
      return 0.5;
  }
}

/** Carry out a piece of advice on the box. */
export function act(box: Box, a: Advice): void {
  if (a.kind === 'tap') box.send(a.box, a.code);
  else if (a.kind === 'lever') box.pull(a.n);
  else if (a.kind === 'block') box.setCommutator(a.box, a.state);
}
