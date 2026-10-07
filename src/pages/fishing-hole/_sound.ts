// Every sound on the page is synthesized with Web Audio; there are no audio
// files. Water laps under everything. Birds call by day, crickets and the odd
// loon by night. The reel clicks as it turns and buzzes when a fish takes
// line, and each splash, nibble, bite, and snap has its own voice.

import type { GameEvent } from './_game';

const STORE_KEY = 'fishing-hole:sound';

export interface Ambient {
  night: number;
  reeling: boolean;
  dragging: boolean;
  flying: boolean;
}

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export class Sound {
  enabled = loadEnabled();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private echo: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private clickPhase = 0;
  private birdTimer = 3;
  private cricketTimer = 1;
  private loonTimer = 20;

  /** Start, or resume, from inside a user gesture. Safe to call on every one. */
  unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) this.build();
    const ctx = this.ctx;
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(STORE_KEY, on ? 'on' : 'off');
    } catch {
      // Storage may be blocked; the choice still holds for this visit.
    }
    if (on) this.unlock();
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  /** Pause the audio clock while the page is hidden. */
  setHidden(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else if (this.enabled) void this.ctx.resume();
  }

  private build(): void {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    // A short echo off the far shore, for the loon and the splashes.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.34;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1800;
    this.echo = ctx.createGain();
    this.echo.gain.value = 0.5;
    this.echo.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(this.master);

    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;

    // Water lapping: band-passed noise that swells and falls.
    const lap = ctx.createBufferSource();
    lap.buffer = buffer;
    lap.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 0.7;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 900;
    const lapGain = ctx.createGain();
    lapGain.gain.value = 0.035;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.21;
    const depth = ctx.createGain();
    depth.gain.value = 0.022;
    lfo.connect(depth);
    depth.connect(lapGain.gain);
    lap.connect(band);
    band.connect(low);
    low.connect(lapGain);
    lapGain.connect(this.master);
    lap.start();
    lfo.start();
  }

  private get ready(): boolean {
    return this.enabled && this.ctx !== null && this.ctx.state === 'running';
  }

  /** A burst of filtered noise with a quick decay. */
  private burst(type: BiquadFilterType, freq: number, q: number, level: number, length: number, at = 0, echo = false): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master!);
    if (echo) g.connect(this.echo!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + length + 0.02);
  }

  /** A pitched blip that glides from f0 to f1. */
  private tone(wave: OscillatorType, f0: number, f1: number, level: number, length: number, at = 0, echo = false): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + Math.min(0.012, length / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(g);
    g.connect(this.master!);
    if (echo) g.connect(this.echo!);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  private splash(size: number): void {
    this.burst('lowpass', 1300, 0.7, 0.16 * size, 0.32 + size * 0.2, 0, true);
    this.burst('highpass', 2600, 0.7, 0.05 * size, 0.18);
    this.tone('sine', 240, 80, 0.12 * size, 0.14);
  }

  private chirp(): void {
    const n = 2 + Math.floor(Math.random() * 3);
    const base = 2600 + Math.random() * 1200;
    for (let i = 0; i < n; i++) {
      this.tone('sine', base, base + (Math.random() < 0.5 ? 900 : -700), 0.03, 0.09, i * (0.12 + Math.random() * 0.05));
    }
  }

  private crickets(night: number): void {
    const f = 4300 + Math.random() * 300;
    for (let i = 0; i < 3; i++) this.tone('sine', f, f * 0.98, 0.012 * night, 0.03, i * 0.05);
  }

  private loon(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(960, t + 0.8);
    osc.frequency.setValueAtTime(960, t + 1.4);
    osc.frequency.exponentialRampToValueAtTime(860, t + 2.1);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = 10;
    vib.connect(vibDepth);
    vibDepth.connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.028, t + 0.3);
    g.gain.setValueAtTime(0.028, t + 1.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
    osc.connect(g);
    g.connect(this.master!);
    g.connect(this.echo!);
    osc.start(t);
    vib.start(t);
    osc.stop(t + 2.4);
    vib.stop(t + 2.4);
  }

  /** Called every frame: the reel's clicks and the lake's creatures. */
  update(dt: number, a: Ambient): void {
    if (!this.ready) return;
    const rate = a.dragging ? 34 : a.flying ? 26 : a.reeling ? 15 : 0;
    if (rate > 0) {
      this.clickPhase += dt * rate;
      while (this.clickPhase >= 1) {
        this.clickPhase -= 1;
        this.burst('highpass', a.dragging ? 4200 : 2600, 1, a.dragging ? 0.06 : 0.045, 0.012);
      }
    } else this.clickPhase = 0;

    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 3 + Math.random() * 7;
      if (a.night < 0.3) this.chirp();
    }
    this.cricketTimer -= dt;
    if (this.cricketTimer <= 0) {
      this.cricketTimer = 0.8 + Math.random() * 0.7;
      if (a.night > 0.35) this.crickets(a.night);
    }
    this.loonTimer -= dt;
    if (this.loonTimer <= 0) {
      this.loonTimer = 35 + Math.random() * 50;
      if (a.night > 0.6) this.loon();
    }
  }

  play(e: GameEvent): void {
    if (!this.ready) return;
    switch (e.type) {
      case 'cast':
        this.burst('bandpass', 900 + e.power * 1400, 1.2, 0.12, 0.3);
        break;
      case 'plop':
        this.tone('sine', 280, 90, 0.2, 0.14);
        this.burst('lowpass', 900, 0.7, 0.07, 0.12);
        break;
      case 'splash':
        this.splash(e.size);
        break;
      case 'nibble':
        this.tone('sine', 430, 260, 0.06, 0.05);
        break;
      case 'bite':
        this.tone('sine', 320, 70, 0.22, 0.24);
        this.burst('lowpass', 700, 0.7, 0.06, 0.2);
        break;
      case 'strike':
        this.burst('bandpass', 1900, 2, 0.12, 0.12);
        this.splash(0.4);
        break;
      case 'miss':
        this.tone('triangle', 200, 130, 0.08, 0.22);
        break;
      case 'snap':
        this.tone('sawtooth', 200, 150, 0.12, 0.45);
        this.burst('highpass', 3000, 1, 0.12, 0.03);
        break;
      case 'lost':
        this.tone('triangle', 392, 392, 0.05, 0.14);
        this.tone('triangle', 311, 311, 0.05, 0.22, 0.14);
        break;
      case 'jump':
        this.splash(0.9);
        break;
      case 'land':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone('square', f, f, 0.035, 0.12, i * 0.09));
        this.splash(0.5);
        break;
      case 'release':
        this.splash(0.6);
        break;
      case 'twitch':
        this.tone('sine', 520, 300, 0.06, 0.05);
        break;
    }
  }
}
