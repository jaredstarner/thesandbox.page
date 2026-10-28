// The chamber over time: the plate cooling and the layer forming, events
// arriving at their rates, droplets written into a ring the renderer reads,
// and a short memory of recent tracks so a tap can be matched to one.
//
// Droplets never move on the CPU. Each is written once with where and when it
// formed, and the vertex shader works out where convection and settling have
// carried it since. `drift` below is that same sum, for picking.

import type { Kind } from './_guide';
import * as P from './_physics';
import type { Objects, Track } from './_physics';

/** Droplet capacity of the ring. */
export const RING = 1 << 17;
/** Floats per droplet: x y z birth / size w0 diff life / track fall seed 0. */
export const STRIDE = 12;

/** Seconds from switching on until the layer is fully sensitive. */
export const COOL_TIME = 16;

/** Events per second once the layer is ready. */
const RATES = {
  muon: 1.7,
  electron: 0.9,
  radon: 0.13,
  thoron: 1 / 70,
  decay: 1 / 55,
  shower: 1 / 75,
  rodAlpha: 1.1,
  rodBeta: 0.7,
  rodThoron: 1 / 18,
  marbleAlpha: 0.4,
  marbleBeta: 1.3,
  saltBeta: 0.55,
  rain: 260,
};

export interface LiveTrack extends Track {
  id: number;
  birth: number;
}

/** Horizontal convection, cm/s, sampled where and when a droplet formed. */
export function flow(x: number, y: number, t: number): [number, number] {
  return [
    0.14 * Math.sin(0.21 * y + 0.05 * t + 1.3) + 0.08 * Math.sin(0.43 * x - 0.07 * t + 0.4),
    0.14 * Math.cos(0.19 * x - 0.04 * t + 0.2) + 0.08 * Math.cos(0.37 * y + 0.06 * t + 2.1),
  ];
}

/** Where a track droplet formed at (x, y, z) at time tb has drifted to after `age` seconds. */
export function drift(x: number, y: number, z: number, tb: number, age: number): [number, number, number] {
  const [fx, fy] = flow(x, y, tb);
  return [x + fx * age, y + fy * age, z - 0.05 * age - 0.06 * age * age];
}

export function poisson(r: P.Rng, mean: number): number {
  if (mean < 0.05) return r() < mean ? 1 : 0;
  let k = 0;
  let p = Math.exp(-mean);
  let s = p;
  const u = r();
  while (u > s && k < 50) {
    k++;
    p *= mean / k;
    s += p;
  }
  return k;
}

export class Chamber {
  readonly data = new Float32Array(RING * STRIDE);
  /** Next slot to write. */
  head = 0;
  /** Slots written since the renderer last took them, as [start, count) in ring order. */
  written = 0;
  time = 0;
  /** Seconds since switch-on, which runs even while held. */
  clock = 0;
  objects: Objects = {};
  tracks: LiveTrack[] = [];
  private nextId = 1;
  private r: P.Rng;
  private trackId = 0;
  private trackBirth = 0;

  constructor(seed: number) {
    this.r = P.rng(seed);
  }

  /** 0 to 1 as the plate cools and the supersaturated layer forms. */
  get ready(): number {
    const t = Math.min(1, Math.max(0, (this.clock - 6) / (COOL_TIME - 6)));
    return t * t * (3 - 2 * t);
  }

  /** Plate temperature, °C. */
  get temperature(): number {
    const t = Math.min(1, this.clock / (COOL_TIME + 4));
    return 19 - 52 * (1 - Math.pow(1 - t, 2.2));
  }

  /** Jump past the cooling, for the debug handle. */
  warm(): void {
    this.clock = Math.max(this.clock, COOL_TIME + 4);
  }

  private sink: P.Sink = {
    drop: (x, y, z, delay, size, w0, diff, life) => {
      this.write(x, y, z, this.trackBirth + delay, size, w0, diff, life, this.trackId, 0);
    },
  };

  private write(
    x: number,
    y: number,
    z: number,
    birth: number,
    size: number,
    w0: number,
    diff: number,
    life: number,
    track: number,
    fall: number,
  ): void {
    const o = this.head * STRIDE;
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = birth;
    d[o + 4] = size;
    d[o + 5] = w0;
    d[o + 6] = diff;
    d[o + 7] = life;
    d[o + 8] = track;
    d[o + 9] = fall;
    d[o + 10] = this.r();
    d[o + 11] = 0;
    this.head = (this.head + 1) % RING;
    this.written = Math.min(RING, this.written + 1);
  }

  /** Runs one generator as a new track born now (or `at`). */
  spawn(make: (c: P.Ctx) => Track | null, at = this.time, ready = this.ready): LiveTrack | null {
    const id = this.nextId++;
    this.trackId = id;
    this.trackBirth = at;
    const t = make({ r: this.r, sink: this.sink, o: this.objects, ready });
    if (!t || t.drops === 0) return null;
    const live: LiveTrack = { ...t, id, birth: at };
    this.tracks.push(live);
    return live;
  }

  private rain(n: number, dt: number): void {
    const r = this.r;
    for (let i = 0; i < n; i++) {
      const x = 0.4 + (P.G.W - 0.8) * r();
      const y = 0.4 + (P.G.D - 0.8) * r();
      // Fine mist condensing high in the tank and settling through the light.
      const z = 1.2 + 5 * r() * r();
      this.write(x, y, z, this.time + r() * dt, 0.45 + 0.4 * r(), 0, 0.02, 1.2 + 1.6 * r(), 0, 1.2 + 2.2 * r());
    }
  }

  step(dt: number, held: boolean): void {
    this.clock += dt;
    if (held) return;
    this.time += dt;
    const ready = this.ready;
    const r = this.r;
    const o = this.objects;
    const rainOn = Math.min(1, Math.max(0, (this.clock - 3) / 8));
    this.rain(poisson(r, RATES.rain * rainOn * dt), dt);
    if (ready > 0.02) {
      const k = (rate: number) => poisson(r, rate * ready * dt);
      const later = () => this.time + r() * dt;
      for (let i = k(RATES.muon); i-- > 0; ) this.spawn((c) => P.muon(c), later());
      for (let i = k(RATES.electron); i-- > 0; ) this.spawn((c) => P.background(c), later());
      for (let i = k(RATES.radon); i-- > 0; ) this.spawn((c) => P.radonAlpha(c), later());
      for (let i = k(RATES.thoron); i-- > 0; ) this.spawn((c) => P.thoronPair(c), later());
      for (let i = k(RATES.decay); i-- > 0; ) this.spawn((c) => P.muonDecay(c), later());
      for (let i = k(RATES.shower); i-- > 0; ) this.spawn((c) => P.shower(c), later());
      if (o.rod) {
        for (let i = k(RATES.rodAlpha); i-- > 0; ) this.spawn((c) => P.rodAlpha(c), later());
        for (let i = k(RATES.rodBeta); i-- > 0; ) this.spawn((c) => P.rodBeta(c), later());
        for (let i = k(RATES.rodThoron); i-- > 0; ) this.spawn((c) => P.rodThoron(c), later());
      }
      if (o.marble) {
        for (let i = k(RATES.marbleAlpha); i-- > 0; ) this.spawn((c) => P.marbleAlpha(c), later());
        for (let i = k(RATES.marbleBeta); i-- > 0; ) this.spawn((c) => P.marbleBeta(c), later());
      }
      if (o.salt) {
        for (let i = k(RATES.saltBeta); i-- > 0; ) this.spawn((c) => P.saltBeta(c), later());
      }
    }
    // Forget tracks that have faded.
    const cutoff = this.time - 7;
    if (this.tracks.length && this.tracks[0].birth < cutoff) {
      this.tracks = this.tracks.filter((t) => t.birth + t.span >= cutoff);
    }
  }

  /** How visible a track is now, 0 to 1. */
  presence(t: LiveTrack): number {
    const age = this.time - t.birth;
    if (age < 0.05) return 0;
    const life = t.kind === 'alpha' || t.kind === 'long-alpha' || t.kind === 'thoron' || t.kind === 'scatter' ? 3.1 : 2.2;
    return Math.max(0, 1 - Math.max(0, age - t.span - life * 0.5) / (life * 0.5));
  }
}

export type { Kind };
