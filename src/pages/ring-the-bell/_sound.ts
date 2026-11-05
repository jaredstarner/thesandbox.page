// The machine's sound, synthesised. A sixties electromechanical has no speaker: every sound is a coil, a
// relay, a bell, or the ball. So nothing here runs continuously. The chimes are struck bars (a free-free
// bar's inharmonic modes), the bell is a cast bell's partials, coils and relays are short filtered bursts,
// and silence between them is part of the sound.

import type { GameEvent } from './_game';

interface Mode {
  ratio: number;
  amp: number;
  decay: number;
}

/** A free-free bar's first four bending modes. */
const BAR: Mode[] = [
  { ratio: 1, amp: 1, decay: 1.5 },
  { ratio: 2.756, amp: 0.42, decay: 0.55 },
  { ratio: 5.404, amp: 0.18, decay: 0.2 },
  { ratio: 8.933, amp: 0.08, decay: 0.08 },
];

/** A cast bell's partials, relative to its nominal: hum, prime, tierce, quint, nominal, and up. */
const BELL: Mode[] = [
  { ratio: 0.5, amp: 0.32, decay: 4.2 },
  { ratio: 1, amp: 0.55, decay: 3 },
  { ratio: 1.19, amp: 0.45, decay: 2.4 },
  { ratio: 1.5, amp: 0.22, decay: 1.8 },
  { ratio: 2, amp: 0.7, decay: 2 },
  { ratio: 2.51, amp: 0.26, decay: 1 },
  { ratio: 2.66, amp: 0.2, decay: 0.8 },
  { ratio: 3.01, amp: 0.14, decay: 0.6 },
];

/** The three chimes: ten, hundred, thousand. A G major triad, high to low. */
const CHIME_HZ: Record<10 | 100 | 1000, number> = { 10: 987.8, 100: 784, 1000: 587.3 };

export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  private lastChime: Record<number, number> = {};

  /** Create or wake the audio context; call from a user gesture. */
  wake(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      const out = ctx.createGain();
      out.gain.value = 0.55;
      out.connect(comp);
      comp.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.out = out;
      this.noise = buf;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.wake();
    else this.suspend();
  }

  private ready(): AudioContext | null {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  /** A bank of decaying sines: the modal voice behind the chimes and the bell. */
  private modes(f0: number, modes: Mode[], gain: number, detune = 0.0016): void {
    const ctx = this.ready();
    if (!ctx || !this.out) return;
    const t = ctx.currentTime + 0.004;
    const bus = ctx.createGain();
    bus.gain.value = gain;
    bus.connect(this.out);
    for (const m of modes) {
      const f = f0 * m.ratio;
      if (f > ctx.sampleRate / 2.2) continue;
      for (const tw of [1, 1 + detune]) {
        const o = ctx.createOscillator();
        o.frequency.value = f * tw;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(m.amp * 0.5, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + m.decay * 4);
        o.connect(g);
        g.connect(bus);
        o.start(t);
        o.stop(t + m.decay * 4 + 0.05);
      }
    }
  }

  /** A short band-passed burst: clicks, clacks, and the strike of a hammer. */
  private burst(freq: number, q: number, dur: number, gain: number, delay = 0): void {
    const ctx = this.ready();
    if (!ctx || !this.out || !this.noise) return;
    const t = ctx.currentTime + 0.003 + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.out);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  /** A falling sine thump: a coil's plunger hitting its stop, or wood being struck. */
  private thump(f0: number, f1: number, dur: number, gain: number, delay = 0): void {
    const ctx = this.ready();
    if (!ctx || !this.out) return;
    const t = ctx.currentTime + 0.003 + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  chime(value: 10 | 100 | 1000): void {
    const ctx = this.ready();
    if (!ctx) return;
    // A chime rung again before it has stopped swinging is damped by its own plunger: quieter.
    const last = this.lastChime[value] ?? -1;
    const again = ctx.currentTime - last < 0.12;
    this.lastChime[value] = ctx.currentTime;
    this.burst(2400, 1.2, 0.012, 0.25);
    this.modes(CHIME_HZ[value], BAR, again ? 0.16 : 0.24);
  }

  play(e: GameEvent): void {
    switch (e.type) {
      case 'chime':
        this.chime(e.value);
        break;
      case 'reel':
        this.burst(5200, 2.5, 0.012, 0.09);
        this.thump(420, 240, 0.02, 0.05);
        break;
      case 'motor':
        this.burst(3000, 3, 0.008, 0.06, 0.02);
        break;
      case 'bumper':
        this.thump(170, 62, 0.09, 0.5);
        this.burst(1800, 1.4, 0.03, 0.35);
        break;
      case 'sling':
        this.thump(140, 60, 0.07, 0.42);
        this.burst(2600, 1.2, 0.025, 0.3);
        break;
      case 'flipper':
        if (e.up) {
          this.thump(110, 55, 0.06, 0.32);
          this.burst(1500, 1.3, 0.03, 0.22);
        } else {
          this.burst(1100, 1.5, 0.02, 0.1);
        }
        break;
      case 'hit': {
        const level = Math.min(1, e.speed / 2500);
        if (e.id.startsWith('flipper')) this.thump(200, 90, 0.03, 0.18 * level);
        else if (e.id === 'bell') this.burst(3200, 6, 0.06, 0.2 * level);
        else if (/post|sling|Post|guide|sep/.test(e.id)) this.thump(260, 120, 0.035, 0.22 * level);
        else this.burst(4200, 2.2, 0.018, 0.22 * level);
        break;
      }
      case 'duck':
        this.thump(130, 70, 0.08, 0.4);
        this.burst(900, 1.5, 0.05, 0.25);
        break;
      case 'duckReset':
        this.thump(160, 80, 0.1, 0.45);
        this.burst(1200, 1, 0.06, 0.3);
        break;
      case 'rollover':
        this.burst(3600, 4, 0.01, 0.12);
        break;
      case 'spin':
        this.burst(2300, 5, 0.01, 0.1);
        break;
      case 'saucerIn':
        this.thump(90, 50, 0.12, 0.4);
        break;
      case 'saucerOut':
        this.thump(150, 60, 0.08, 0.5);
        this.burst(1400, 1.2, 0.04, 0.3);
        break;
      case 'striker':
        break;
      case 'bell':
        this.burst(3800, 1.5, 0.015, 0.35);
        this.modes(660, BELL, 0.22, 0.0009);
        break;
      case 'plunge':
        this.burst(900, 0.9, 0.05, 0.12 + e.power * 0.25);
        this.thump(240, 90, 0.05, 0.25 * e.power);
        break;
      case 'serve':
        this.thump(80, 45, 0.14, 0.5);
        this.burst(700, 1, 0.08, 0.25);
        this.burst(2600, 3, 0.02, 0.12, 0.25);
        break;
      case 'drain':
        this.thump(70, 40, 0.16, 0.45);
        break;
      case 'tilt':
        this.thump(120, 50, 0.12, 0.45);
        this.burst(2000, 2, 0.02, 0.2, 0.04);
        this.burst(2000, 2, 0.02, 0.2, 0.09);
        break;
      case 'nudge':
        this.thump(60, 35, 0.12, 0.35);
        break;
      case 'knocker':
        this.thump(130, 55, 0.16, 0.9);
        this.burst(600, 0.8, 0.05, 0.5);
        break;
      case 'coin':
        this.modes(3150, [{ ratio: 1, amp: 0.5, decay: 0.08 }, { ratio: 1.48, amp: 0.3, decay: 0.05 }], 0.18, 0.002);
        this.burst(5000, 3, 0.03, 0.08, 0.06);
        this.burst(4200, 3, 0.03, 0.06, 0.12);
        break;
      case 'start':
        this.thump(100, 50, 0.1, 0.4);
        this.burst(2400, 2, 0.015, 0.15, 0.05);
        break;
      case 'gameOver':
        this.thump(90, 45, 0.12, 0.35);
        break;
      case 'match':
        this.burst(2400, 2, 0.015, 0.15);
        break;
    }
  }
}
