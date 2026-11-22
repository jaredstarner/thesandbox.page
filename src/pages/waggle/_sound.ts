// The hive's sound: a low harmonic hum from many wings, the dancer's buzzing pulses during each
// waggle run, and small plucked notes for a bee that finds flowers or comes home empty.

export class Sound {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: GainNode | null = null;
  private buzz: GainNode | null = null;
  private pulseRate: OscillatorNode | null = null;
  private humLevel = 0;

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    const master = ctx.createGain();
    master.gain.value = this.enabled ? 0.55 : 0;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    // The hum: detuned saws near a worker's wingbeat, softened and slowly breathing.
    const hum = ctx.createGain();
    hum.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 0.6;
    const breathe = ctx.createOscillator();
    breathe.frequency.value = 0.06;
    const breatheAmt = ctx.createGain();
    breatheAmt.gain.value = 90;
    breathe.connect(breatheAmt).connect(lp.frequency);
    breathe.start();
    for (const f of [208, 214.5, 221, 229.3, 236.1, 243.8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const wob = ctx.createOscillator();
      wob.frequency.value = 0.1 + Math.random() * 0.25;
      const wobAmt = ctx.createGain();
      wobAmt.gain.value = 1.6;
      wob.connect(wobAmt).connect(o.frequency);
      wob.start();
      const g = ctx.createGain();
      g.gain.value = 0.16;
      o.connect(g).connect(lp);
      o.start();
    }
    lp.connect(hum).connect(master);
    this.hum = hum;

    // The waggle buzz: a 260 Hz tone chopped into pulses at the waggle rate.
    const tone = ctx.createOscillator();
    tone.type = 'triangle';
    tone.frequency.value = 262;
    const chop = ctx.createGain();
    chop.gain.value = 0;
    const rate = ctx.createOscillator();
    rate.type = 'square';
    rate.frequency.value = 13;
    const rateAmt = ctx.createGain();
    rateAmt.gain.value = 0.5;
    const bias = ctx.createConstantSource();
    bias.offset.value = 0.5;
    rate.connect(rateAmt).connect(chop.gain);
    bias.connect(chop.gain);
    rate.start();
    bias.start();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 300;
    bp.Q.value = 1.2;
    const buzz = ctx.createGain();
    buzz.gain.value = 0;
    tone.connect(chop).connect(bp).connect(buzz).connect(master);
    tone.start();
    this.buzz = buzz;
    this.pulseRate = rate;
    this.applyHum();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.08);
  }

  /** 0 for silence, 1 for a full dance floor. */
  setHum(level: number): void {
    if (Math.abs(level - this.humLevel) < 0.01) return;
    this.humLevel = level;
    this.applyHum();
  }

  private applyHum(): void {
    if (!this.ctx || !this.hum) return;
    this.hum.gain.setTargetAtTime(0.07 * this.humLevel, this.ctx.currentTime, 0.6);
  }

  setWaggle(on: boolean, slow: boolean): void {
    if (!this.ctx || !this.buzz || !this.pulseRate) return;
    const t = this.ctx.currentTime;
    this.buzz.gain.setTargetAtTime(on ? 0.055 : 0, t, on ? 0.02 : 0.05);
    this.pulseRate.frequency.setTargetAtTime(slow ? 13 / 4 : 13, t, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private pluck(freq: number, when: number, dur: number, level: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.01;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.master);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  found(): void {
    this.pluck(659.3, 0, 1.4, 0.16);
    this.pluck(987.8, 0.11, 1.6, 0.13);
    this.pluck(1318.5, 0.22, 1.8, 0.09);
  }

  miss(): void {
    this.pluck(293.7, 0, 1.1, 0.13, 'triangle');
    this.pluck(246.9, 0.16, 1.4, 0.12, 'triangle');
  }

  tick(): void {
    this.pluck(1760, 0, 0.08, 0.05);
  }

  /** A bee taking off: a short rising buzz. */
  takeoff(delay = 0, level = 0.07): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(250, t + 0.35);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.6);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.65);
  }
}
