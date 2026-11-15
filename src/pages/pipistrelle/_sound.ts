// Sound, the way a bat detector lets a person hear a bat. Every call is brought
// down ten times in pitch and stretched as the night is slowed, then the echoes
// the sonar found are laid into the same buffer at their real delays, panned to
// the side they came from, the far ones duller because air soaks up the top of
// an ultrasonic sweep first. Around it, the night itself: crickets in the
// hedges, an owl, and a church clock striking the hours across the fields.

import { SOUND, spreading, KIND_INSECT, type Echo } from './_sonar';
import { wrap } from './_sonar';

/** The night runs this many times slower than the bat lives it. */
export const STRETCH = 2.5;
/** Calls are played this many times lower than they are made. */
export const DIVIDE = 10;

const RATE = 48000;

export interface Point {
  x: number;
  y: number;
}

export class Sound {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private master: GainNode | null = null;
  private detector: GainNode | null = null;
  private world: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private callCache = new Map<string, Float32Array[]>();
  private crickets: { x: number; y: number; pitch: number; rate: number; next: number }[] = [];
  enabled = false;

  /** Must run inside a user gesture. */
  async start(crickets: Point[]): Promise<boolean> {
    if (this.ctx) {
      await this.ctx.resume().catch(() => undefined);
      return this.ctx.state === 'running';
    }
    const AC = window.AudioContext;
    if (!AC) return false;
    let ctx: AudioContext;
    try {
      ctx = new AC({ sampleRate: RATE, latencyHint: 'interactive' });
    } catch {
      try {
        ctx = new AC();
      } catch {
        return false;
      }
    }
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(comp).connect(ctx.destination);

    this.detector = ctx.createGain();
    this.detector.gain.value = 0.9;
    this.detector.connect(this.master);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0;
    this.analyser.minDecibels = -82;
    this.analyser.maxDecibels = -20;
    this.detector.connect(this.analyser);

    this.world = ctx.createGain();
    this.world.gain.value = 1;
    this.world.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeReverb(3.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.55;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.crickets = crickets.map((c, k) => ({
      x: c.x,
      y: c.y,
      pitch: 3150 + ((k * 137) % 5) * 70,
      rate: 0.42 + ((k * 53) % 7) * 0.035,
      next: 0,
    }));
    await ctx.resume().catch(() => undefined);
    this.enabled = ctx.state === 'running';
    return this.enabled;
  }

  async pause(): Promise<void> {
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend().catch(() => undefined);
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
  }

  /** Fades the whole mix to silence (or back) over a few seconds. */
  fade(to: number, seconds: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(to, t + seconds);
  }

  private makeReverb(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.round(seconds * ctx.sampleRate);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        // Filtered decaying noise: an open-air tail off distant walls and trees.
        lp += (Math.random() * 2 - 1 - lp) * 0.22;
        d[i] = lp * Math.exp(-t * 2.4) * (t < 0.03 ? t / 0.03 : 1);
      }
    }
    return buf;
  }

  /**
   * One call waveform, as heard: the sweep divided down, stretched, with three
   * versions that lose more of the sweep's top for echoes from further away.
   */
  private callWave(duration: number, f0: number, f1: number): Float32Array[] {
    const key = `${duration.toFixed(5)}|${f0.toFixed(1)}|${f1.toFixed(1)}`;
    const hit = this.callCache.get(key);
    if (hit) return hit;
    const rate = this.ctx!.sampleRate;
    const n = Math.max(16, Math.round(duration * STRETCH * rate));
    const a = (f0 * 1000) / DIVIDE;
    const b = (f1 * 1000) / DIVIDE;
    const out: Float32Array[] = [];
    for (const dull of [0, 0.55, 0.85]) {
      const w = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        // Steep at the start, flattening into the quasi-constant tail: the pipistrelle's hockey stick.
        const f = b + (a - b) * Math.pow(1 - u, 2.6);
        ph += (2 * Math.PI * f) / rate;
        const env = Math.sin(Math.PI * Math.min(1, u / 0.18) * 0.5) ** 2 * Math.min(1, (1 - u) / 0.32);
        const keep = 1 - dull * Math.pow(1 - u, 1.6);
        w[i] = Math.sin(ph) * env * keep;
      }
      out.push(w);
    }
    if (this.callCache.size > 160) this.callCache.clear();
    this.callCache.set(key, out);
    return out;
  }

  /** Plays a call and every echo the sonar found for it. */
  call(echoes: Echo[], heading: number, duration: number, f0: number, f1: number, range: number, own: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.detector) return;
    const rate = ctx.sampleRate;
    const waves = this.callWave(duration, f0, f1);
    const n = waves[0].length;
    const maxDelay = ((2 * range) / SOUND) * STRETCH;
    const len = n + Math.ceil(maxDelay * rate) + 8;
    const buf = ctx.createBuffer(2, len, rate);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    // The bat's own call, heard from inside its own head.
    const w0 = waves[0];
    for (let i = 0; i < n; i++) {
      L[i] += w0[i] * own;
      R[i] += w0[i] * own;
    }
    for (const e of echoes) {
      const d = Math.round(((2 * e.range) / SOUND) * STRETCH * rate);
      if (d + n >= len) continue;
      const a = e.amp * spreading(e.range) * (e.kind === KIND_INSECT ? 1.9 : 0.62);
      if (a < 0.002) continue;
      const rel = wrap(e.bearing - heading);
      const p = 0.5 + 0.45 * Math.sin(rel);
      const gl = Math.cos((p * Math.PI) / 2) * a;
      const gr = Math.sin((p * Math.PI) / 2) * a;
      const w = waves[e.range < 4 ? 0 : e.range < 10 ? 1 : 2];
      for (let i = 0; i < n; i++) {
        const s = w[i];
        L[d + i] += s * gl;
        R[d + i] += s * gr;
      }
    }
    // Keep a cluttered return from clipping, without distorting it.
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    if (peak > 0.7) {
      const k = 0.7 / peak;
      for (let i = 0; i < len; i++) {
        L[i] *= k;
        R[i] *= k;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.detector);
    src.start(ctx.currentTime + 0.012);
  }

  /** A garden tiger's clicks: a burst of broadband ticks, speeding up. */
  clicks(pan: number, level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.detector) return;
    const rate = ctx.sampleRate;
    const total = 0.45 * STRETCH;
    const len = Math.ceil((total + 0.02) * rate);
    const buf = ctx.createBuffer(2, len, rate);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const gl = Math.cos(((0.5 + 0.4 * pan) * Math.PI) / 2) * level;
    const gr = Math.sin(((0.5 + 0.4 * pan) * Math.PI) / 2) * level;
    const count = 22;
    for (let k = 0; k < count; k++) {
      const u = k / count;
      // Each tymbal buckling gives a click; the train accelerates as it goes.
      const t = total * (1 - Math.pow(1 - u, 1.7)) * 0.95;
      const start = Math.round(t * rate);
      const clen = Math.round(0.0016 * rate);
      let lp = 0;
      let hp = 0;
      for (let i = 0; i < clen && start + i < len; i++) {
        const x = Math.random() * 2 - 1;
        lp += (x - lp) * 0.55;
        const band = lp - hp;
        hp += (lp - hp) * 0.12;
        const env = Math.exp(-i / (clen * 0.22));
        const s = band * env * (k % 2 ? 0.75 : 1);
        L[start + i] += s * gl;
        R[start + i] += s * gr;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.detector);
    src.start();
  }

  /** A soft thud: flying into leaves or a wall. */
  bump(hard: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.world) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(hard ? 140 : 210, t);
    o.frequency.exponentialRampToValueAtTime(hard ? 60 : 120, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(hard ? 0.32 : 0.14, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (hard ? 0.22 : 0.14));
    o.connect(g).connect(this.world);
    o.start(t);
    o.stop(t + 0.3);
    if (!hard) {
      // Leaves: a short rustle of small ticks.
      this.ticks(7, 0.022, 0.05, 2600, 0.08);
    }
  }

  /** Chewing: a few small crunches after a catch. */
  munch(big: boolean): void {
    this.ticks(big ? 9 : 4, big ? 0.075 : 0.06, big ? 0.11 : 0.07, 1900, 0.12);
  }

  private ticks(count: number, spacing: number, level: number, centre: number, delay: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.world) return;
    const rate = ctx.sampleRate;
    const len = Math.ceil((count * spacing + 0.05) * rate);
    const buf = ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    const k = Math.exp((-2 * Math.PI * centre) / rate);
    for (let c = 0; c < count; c++) {
      const start = Math.round((c * spacing + Math.random() * spacing * 0.4) * rate);
      const clen = Math.round(0.006 * rate);
      let y1 = 0;
      let y2 = 0;
      const amp = level * (0.6 + Math.random() * 0.4);
      for (let i = 0; i < clen && start + i < len; i++) {
        // A tiny resonant body, struck.
        const x = i < 3 ? Math.random() * 2 - 1 : 0;
        const y = x + 2 * k * Math.cos((2 * Math.PI * centre * (0.8 + c * 0.03)) / rate) * y1 - k * k * y2;
        y2 = y1;
        y1 = y;
        d[start + i] += y * amp * 0.25;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.world);
    src.start(ctx.currentTime + delay);
  }

  /** The church clock across the fields strikes the hour. */
  strike(count: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.world || !this.reverbSend) return;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.value = 0.085;
    lp.connect(g);
    g.connect(this.world);
    g.connect(this.reverbSend);
    const base = 294;
    // A church bell's partials: hum, prime, minor third, fifth, nominal and above.
    const partials: [number, number, number][] = [
      [0.5, 0.55, 7],
      [1, 0.8, 4.2],
      [1.183, 0.5, 3.4],
      [1.506, 0.28, 2.6],
      [2, 0.45, 2.2],
      [2.514, 0.16, 1.4],
      [2.662, 0.14, 1.2],
      [3.011, 0.12, 1.0],
    ];
    const t0 = ctx.currentTime + 0.05;
    for (let s = 0; s < count; s++) {
      const t = t0 + s * 2.05;
      for (const [ratio, amp, decay] of partials) {
        const o = ctx.createOscillator();
        const e = ctx.createGain();
        o.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.0015);
        e.gain.setValueAtTime(0.0001, t);
        e.gain.exponentialRampToValueAtTime(amp, t + 0.006);
        e.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        o.connect(e).connect(lp);
        o.start(t);
        o.stop(t + decay + 0.05);
      }
    }
  }

  /** A tawny owl somewhere off in the wood: a long hoot, a pause, then the wavering one. */
  owl(pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.world || !this.reverbSend) return;
    const out = ctx.createGain();
    out.gain.value = 0.07;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    out.connect(lp).connect(p);
    p.connect(this.world);
    p.connect(this.reverbSend);
    const t0 = ctx.currentTime + 0.1;
    const hoot = (t: number, dur: number, f: number, waver: boolean) => {
      const o = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const e = ctx.createGain();
      const h2 = ctx.createGain();
      o.frequency.setValueAtTime(f * 1.04, t);
      o.frequency.linearRampToValueAtTime(f, t + dur * 0.3);
      o.frequency.linearRampToValueAtTime(f * 0.96, t + dur);
      o2.frequency.setValueAtTime(f * 2.08, t);
      o2.frequency.linearRampToValueAtTime(f * 1.92, t + dur);
      h2.gain.value = 0.12;
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(1, t + 0.06);
      e.gain.setValueAtTime(1, t + dur * 0.7);
      e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      if (waver) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 9;
        depth.gain.value = 0.4;
        lfo.connect(depth).connect(e.gain);
        lfo.start(t + dur * 0.25);
        lfo.stop(t + dur);
      }
      o.connect(e);
      o2.connect(h2).connect(e);
      e.connect(out);
      o.start(t);
      o2.start(t);
      o.stop(t + dur + 0.05);
      o2.stop(t + dur + 0.05);
    };
    hoot(t0, 0.9, 410, false);
    hoot(t0 + 3.4, 0.22, 400, false);
    hoot(t0 + 3.75, 0.18, 395, false);
    hoot(t0 + 4.1, 1.3, 405, true);
  }

  /** Schedules cricket chirps near the bat; call often with the bat's position. */
  tickCrickets(bx: number, by: number, heading: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.world) return;
    const now = ctx.currentTime;
    for (const c of this.crickets) {
      const d = Math.hypot(c.x - bx, c.y - by);
      if (d > 30) {
        c.next = Math.max(c.next, now);
        continue;
      }
      if (c.next > now + 0.2) continue;
      const t = Math.max(now + 0.02, c.next);
      c.next = t + c.rate * STRETCH * 0.4 * (0.95 + Math.random() * 0.1);
      const level = 0.05 / (1 + (d / 6) ** 2);
      if (level < 0.002) continue;
      const rel = wrap(Math.atan2(c.y - by, c.x - bx) - heading);
      const pan = Math.max(-0.9, Math.min(0.9, Math.sin(rel)));
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const p = ctx.createStereoPanner();
      o.frequency.value = c.pitch;
      p.pan.value = pan;
      g.gain.value = 0;
      // Three pulses to a chirp.
      for (let k = 0; k < 3; k++) {
        const s = t + k * 0.034;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(level, s + 0.006);
        g.gain.setValueAtTime(level, s + 0.016);
        g.gain.linearRampToValueAtTime(0, s + 0.024);
      }
      o.connect(g).connect(p).connect(this.world);
      o.start(t);
      o.stop(t + 0.12);
    }
  }
}
