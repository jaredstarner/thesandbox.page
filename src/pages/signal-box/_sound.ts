// Signal box: what the box sounds like.
//
// The block bells are struck bells: a few sine partials each, decaying at their own
// rates, a different bell for each neighbouring box so you can tell who is calling.
// Levers are a catch, a stroke, and a thump against the frame. Outside, diesels
// are tuned engines with a filter that opens with power, steam is chuffs in time
// with the wheels, and every axle clicks over the rail joints near the box. The
// only sound that runs on its own is the clock.

import type { BoxId, LeverKind } from './_layout';
import type { Train } from './_sim';

const BELLS: Record<BoxId, { f: number; parts: [number, number, number][] }> = {
  // [ratio, level, decay seconds]
  callow: {
    f: 1240,
    parts: [
      [1, 1, 1.5],
      [2.32, 0.5, 0.8],
      [4.25, 0.3, 0.45],
      [6.63, 0.16, 0.25],
    ],
  },
  marsh: {
    f: 905,
    parts: [
      [1, 1, 1.9],
      [2.4, 0.45, 1],
      [3.94, 0.25, 0.55],
      [5.8, 0.12, 0.3],
    ],
  },
  // A lower, gong-like bell for the branch.
  pell: {
    f: 560,
    parts: [
      [1, 1, 2.3],
      [1.48, 0.55, 1.6],
      [2.11, 0.35, 0.9],
      [2.77, 0.2, 0.55],
    ],
  },
};

interface Voice {
  osc: OscillatorNode[];
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  whine: OscillatorNode | null;
  whineGain: GainNode | null;
  lastS: number;
  lastV: number;
  lastChuff: number;
  steam: boolean;
}

export class Sound {
  ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Map<number, Voice>();
  private lastTick = -1;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.75;
    this.out.connect(comp);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** The output bus, for measuring in checks. */
  get bus(): GainNode | null {
    return this.out;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(m ? 0 : 0.75, this.ctx.currentTime, 0.05);
  }

  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  /** The running context and its parts, or null before it starts or while it's suspended. */
  private live(): { c: AudioContext; out: GainNode; noise: AudioBuffer } | null {
    if (!this.ctx || !this.out || !this.noise || this.ctx.state !== 'running') return null;
    return { c: this.ctx, out: this.out, noise: this.noise };
  }

  /** A short burst of filtered noise. */
  private burst(t: number, dur: number, f: number, q: number, level: number, type: BiquadFilterType = 'bandpass', dest?: AudioNode): void {
    const L = this.live();
    if (!L) return;
    const c = L.c;
    const src = c.createBufferSource();
    src.buffer = L.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = c.createBiquadFilter();
    bp.type = type;
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + Math.min(0.004, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(dest ?? L.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(t: number, f: number, dur: number, level: number, type: OscillatorType = 'sine', attack = 0.003, dest?: AudioNode): void {
    const L = this.live();
    if (!L) return;
    const c = L.c;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? L.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** One stroke on a box's bell, at a time offset in seconds from now. */
  bell(box: BoxId, delay = 0): void {
    const L = this.live();
    if (!L) return;
    const t = L.c.currentTime + delay;
    const b = BELLS[box];
    for (const [r, lv, dec] of b.parts) this.tone(t, b.f * r * (1 + (Math.random() - 0.5) * 0.002), dec, 0.13 * lv);
    this.burst(t, 0.012, 3800, 1.2, 0.08);
  }

  /** Our own tapper: a plunger knocking its stop. */
  tap(): void {
    const L = this.live();
    if (!L) return;
    const t = L.c.currentTime;
    this.burst(t, 0.03, 1800, 2.2, 0.22);
    this.tone(t, 210, 0.05, 0.12);
  }

  /** The handle on a block instrument clicking round to a new position. */
  commutator(): void {
    const L = this.live();
    if (!L) return;
    const t = L.c.currentTime;
    this.burst(t, 0.02, 2600, 3, 0.16);
    this.burst(t + 0.07, 0.03, 1500, 3, 0.2);
  }

  /** A lever pulled over or put back: the catch lifts, the lever travels, it lands. */
  lever(kind: LeverKind, dur: number): void {
    const L = this.live();
    if (!L) return;
    const t = L.c.currentTime;
    const heavy = kind === 'distant' ? 1.5 : kind === 'points' ? 1.25 : 1;
    this.burst(t, 0.018, 4200, 4, 0.18);
    this.tone(t, 2950, 0.05, 0.03);
    // The wire or rodding taking up, a low groan under the stroke.
    this.burst(t + 0.05, dur * 0.9, 260 * (2 - heavy * 0.5), 1.4, 0.09 * heavy, 'bandpass');
    const land = t + dur;
    this.tone(land, 95 / heavy, 0.22, 0.42);
    this.tone(land, 190 / heavy, 0.12, 0.16);
    this.burst(land, 0.08, 700, 1.1, 0.32);
    this.burst(land + 0.02, 0.025, 3600, 4, 0.14);
  }

  /** The catch lifting on a lever the locking won't let go. */
  locked(): void {
    const L = this.live();
    if (!L) return;
    const t = L.c.currentTime;
    this.burst(t, 0.02, 4200, 4, 0.16);
    this.tone(t + 0.05, 130, 0.12, 0.3);
    this.burst(t + 0.05, 0.05, 900, 1.5, 0.22);
  }

  /** The signal post telephone. */
  phone(): void {
    const L = this.live();
    if (!L) return;
    const t0 = L.c.currentTime;
    for (const start of [0, 0.75]) {
      for (let i = 0; i < 18; i++) {
        const t = t0 + start + i * 0.028;
        this.tone(t, i % 2 ? 1180 : 960, 0.12, 0.05);
      }
    }
  }

  /** The clock on the wall, once a second. */
  tick(second: number): void {
    const L = this.live();
    if (!L || second === this.lastTick) return;
    this.lastTick = second;
    const t = L.c.currentTime;
    this.burst(t, 0.012, 5200, 5, 0.035);
    this.tone(t, 1650, 0.02, 0.012);
  }

  /** A driver's two-tone horn, or a steam whistle, where the train is. */
  horn(steam: boolean, pan: number, dist: number): void {
    const L = this.live();
    if (!L) return;
    const c = L.c;
    const t = c.currentTime;
    const p = c.createStereoPanner();
    p.pan.value = pan * 0.8;
    const g = c.createGain();
    g.gain.value = Math.min(1, 40 / Math.max(25, dist));
    p.connect(g).connect(L.out);
    if (steam) {
      this.tone(t, 880, 0.9, 0.06, 'triangle', 0.05, p);
      this.tone(t, 1320, 0.8, 0.02, 'sine', 0.05, p);
      this.burst(t, 0.9, 900, 6, 0.03, 'bandpass', p);
      return;
    }
    for (const [f, start] of [
      [415, 0],
      [330, 0.55],
    ] as const) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      const e = c.createGain();
      e.gain.setValueAtTime(0, t + start);
      e.gain.linearRampToValueAtTime(0.05, t + start + 0.04);
      e.gain.setValueAtTime(0.05, t + start + 0.46);
      e.gain.linearRampToValueAtTime(0, t + start + 0.52);
      o.connect(lp).connect(e).connect(p);
      o.start(t + start);
      o.stop(t + start + 0.6);
    }
  }

  /** Engines, chuffs, and rail joints for every train near enough to hear. */
  trains(trains: Train[], where: (tr: Train) => { pan: number; dist: number }, dt: number, ended: boolean): void {
    const L = this.live();
    if (!L) return;
    const c = L.c;
    const t = c.currentTime;
    const live = new Set<number>();
    for (const tr of trains) {
      if (tr.state !== 'running' || ended) continue;
      const { pan, dist } = where(tr);
      if (dist > 1100) continue;
      live.add(tr.id);
      let v = this.voices.get(tr.id);
      const steam = tr.vehicles[0].kind === 'steam';
      const dmu = tr.vehicles[0].kind === 'dmu';
      if (!v) {
        const filter = c.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 2;
        const gain = c.createGain();
        gain.gain.value = 0;
        const panner = c.createStereoPanner();
        filter.connect(gain).connect(panner).connect(L.out);
        const osc: OscillatorNode[] = [];
        if (!steam) {
          for (const [type, mult, lv] of [
            ['sawtooth', 1, 0.5],
            ['square', 2.005, 0.18],
            ['sawtooth', 3.01, 0.12],
          ] as [OscillatorType, number, number][]) {
            const o = c.createOscillator();
            o.type = type;
            o.frequency.value = (dmu ? 58 : 38) * mult;
            const og = c.createGain();
            og.gain.value = lv;
            o.connect(og).connect(filter);
            o.start();
            osc.push(o);
          }
        }
        let whine: OscillatorNode | null = null;
        let whineGain: GainNode | null = null;
        if (dmu) {
          const w = c.createOscillator();
          w.type = 'triangle';
          const wg = c.createGain();
          wg.gain.value = 0;
          w.connect(wg).connect(panner);
          w.start();
          whine = w;
          whineGain = wg;
        }
        v = { osc, filter, gain, pan: panner, whine, whineGain, lastS: tr.s, lastV: tr.v, lastChuff: 0, steam };
        this.voices.set(tr.id, v);
      }
      const accel = (tr.v - v.lastV) / Math.max(dt, 1e-3);
      v.lastV = tr.v;
      const power = Math.max(0, Math.min(1, 0.25 + accel * 2.5));
      const near = Math.min(1, 22 / Math.max(16, dist));
      v.pan.pan.setTargetAtTime(pan * 0.85, t, 0.08);
      if (!steam) {
        const base = (dmu ? 52 : 34) + power * (dmu ? 22 : 16);
        for (const [i, o] of v.osc.entries()) o.frequency.setTargetAtTime(base * [1, 2.005, 3.01][i], t, 0.6);
        v.filter.frequency.setTargetAtTime(260 + power * 900, t, 0.3);
        v.gain.gain.setTargetAtTime((tr.v > 0.1 || power > 0.2 ? 0.16 : 0.07) * near, t, 0.15);
      }
      if (v.whine && v.whineGain) {
        v.whine.frequency.setTargetAtTime(180 + tr.v * 28, t, 0.2);
        v.whineGain.gain.setTargetAtTime(Math.min(0.012, tr.v * 0.0008) * near, t, 0.2);
      }
      // Steam: four chuffs to a turn of the driving wheels.
      if (steam && tr.v > 0.3) {
        const interval = (Math.PI * 1.75) / 4 / tr.v;
        if (t - v.lastChuff > Math.max(0.09, interval)) {
          v.lastChuff = t;
          const p = c.createStereoPanner();
          p.pan.value = pan * 0.85;
          p.connect(L.out);
          this.burst(t, Math.min(0.22, interval * 0.7), 620 + power * 300, 0.8, (0.08 + power * 0.18) * near, 'bandpass', p);
        }
      }
      // Rail joints every 18.3 m: each axle near the box clicks as it crosses one.
      const ds = tr.s - v.lastS;
      v.lastS = tr.s;
      if (ds > 0 && dist < 400) {
        let s = tr.s;
        let hits = 0;
        for (const veh of tr.vehicles) {
          const axles = veh.len < 9 ? [0.25, 0.75] : [0.12, 0.2, 0.8, 0.88];
          for (const a of axles) {
            const ax = s - veh.len * a;
            if (Math.floor(ax / 18.3) !== Math.floor((ax - ds) / 18.3) && hits < 6) {
              hits++;
              const p = c.createStereoPanner();
              p.pan.value = pan * 0.85;
              p.connect(L.out);
              const lv = Math.min(1, 30 / Math.max(18, dist)) * 0.16;
              this.burst(t + hits * 0.004, 0.045, 1100, 1.6, lv, 'bandpass', p);
              this.tone(t + hits * 0.004, 140, 0.05, lv * 0.7, 'sine', 0.002, p);
            }
          }
          s -= veh.len + 0.6;
          if (s < tr.s - 260) break;
        }
      }
    }
    for (const [id, v] of this.voices) {
      if (live.has(id)) continue;
      v.gain.gain.setTargetAtTime(0, t, 0.2);
      v.whineGain?.gain.setTargetAtTime(0, t, 0.2);
      for (const o of v.osc) o.stop(t + 1);
      v.whine?.stop(t + 1);
      this.voices.delete(id);
    }
  }
}
