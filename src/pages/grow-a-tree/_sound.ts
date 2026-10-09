// The soundscape, all synthesized: wind from filtered noise, leaf rustle whose
// flutter comes from slow noise modulating its level, and now and then a bird.
// The same gust value that bends the branches drives the wind and the rustle.

export interface SoundInput {
  gust: number;
  breeze: number;
  /** 0 to 1: how much foliage is out to rustle. */
  leaves: number;
  needles: boolean;
  /** 0 to 1 around the year. */
  season: number;
  deciduous: boolean;
  /** Plant height in metres, so a seedling doesn't host a dawn chorus. */
  height: number;
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private whistle!: BiquadFilterNode;
  private whistleGain!: GainNode;
  private rustleGain!: GainNode;
  private rustleFilter!: BiquadFilterNode;
  private flutterDepth!: GainNode;
  private nextBird = 0;
  on = false;

  private build(): AudioContext {
    const ctx = new AudioContext();
    const buf = noiseBuffer(ctx, 4);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    // A limiter, so a strong gust can't clip.
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -12;
    limit.knee.value = 6;
    limit.ratio.value = 12;
    limit.attack.value = 0.01;
    limit.release.value = 0.25;
    this.master.connect(limit).connect(ctx.destination);

    // Wind: low, slow, breathing with the gusts.
    const a = ctx.createBufferSource();
    a.buffer = buf;
    a.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 300;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    a.connect(this.windFilter).connect(this.windGain).connect(this.master);
    // A faint resonance that rises in a strong gust.
    this.whistle = ctx.createBiquadFilter();
    this.whistle.type = 'bandpass';
    this.whistle.frequency.value = 520;
    this.whistle.Q.value = 9;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.windFilter.connect(this.whistle).connect(this.whistleGain).connect(this.master);
    a.start();

    // Rustle: bright noise, its level fluttered by much slower noise.
    const b = ctx.createBufferSource();
    b.buffer = buf;
    b.loop = true;
    b.playbackRate.value = 0.93;
    this.rustleFilter = ctx.createBiquadFilter();
    this.rustleFilter.type = 'highpass';
    this.rustleFilter.frequency.value = 1800;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowpass';
    shelf.frequency.value = 7500;
    this.rustleGain = ctx.createGain();
    this.rustleGain.gain.value = 0;
    b.connect(this.rustleFilter).connect(shelf).connect(this.rustleGain).connect(this.master);
    b.start();
    const c = ctx.createBufferSource();
    c.buffer = buf;
    c.loop = true;
    c.playbackRate.value = 0.37;
    const slow = ctx.createBiquadFilter();
    slow.type = 'lowpass';
    slow.frequency.value = 14;
    this.flutterDepth = ctx.createGain();
    this.flutterDepth.gain.value = 0;
    c.connect(slow).connect(this.flutterDepth).connect(this.rustleGain.gain);
    c.start();

    this.nextBird = ctx.currentTime + 2;
    return ctx;
  }

  async setOn(on: boolean): Promise<void> {
    this.on = on;
    if (on && !this.ctx) this.ctx = this.build();
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && ctx.state !== 'running') await ctx.resume();
    this.master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.4);
  }

  /** Suspends when the tab is hidden and resumes when it is back, if sound is on. */
  setVisible(visible: boolean): void {
    if (!this.ctx) return;
    if (!visible) void this.ctx.suspend();
    else if (this.on) void this.ctx.resume();
  }

  update(s: SoundInput): void {
    const ctx = this.ctx;
    if (!ctx || !this.on || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const g = Math.max(0, s.gust);
    this.windGain.gain.setTargetAtTime(0.18 + 1.6 * Math.pow(g, 1.3), t, 0.12);
    this.windFilter.frequency.setTargetAtTime(180 + 950 * g, t, 0.15);
    this.whistle.frequency.setTargetAtTime(420 + 380 * g, t, 0.3);
    this.whistleGain.gain.setTargetAtTime(Math.max(0, g - 0.55) * 0.5, t, 0.3);

    // Bare in winter, budding in spring.
    let foliage = s.leaves;
    if (s.deciduous) {
      const se = s.season;
      const out = se < 0.08 || se > 0.86 ? 0.04 : se < 0.16 ? 0.4 : 1;
      foliage *= out;
    }
    const level = foliage * (0.05 + 0.75 * Math.pow(g, 1.5));
    this.rustleGain.gain.setTargetAtTime(level, t, 0.08);
    this.flutterDepth.gain.setTargetAtTime(level * (s.needles ? 0.8 : 2.2), t, 0.08);
    this.rustleFilter.frequency.setTargetAtTime(s.needles ? 3600 : 1700, t, 0.5);

    // Birds come to a tree with leaves, in calmer air, and not in winter.
    const birdy = s.height > 2 && foliage > 0.2 && s.breeze < 0.85 && !(s.season > 0.86 || s.season < 0.06);
    if (birdy && t > this.nextBird) {
      this.phrase(t + 0.05);
      this.nextBird = t + 3 + Math.random() * 7 + s.breeze * 6;
    } else if (!birdy && t > this.nextBird) {
      this.nextBird = t + 2;
    }
  }

  private phrase(t0: number): void {
    const ctx = this.ctx as AudioContext;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const out = ctx.createGain();
    out.gain.value = 0.06 + Math.random() * 0.06;
    out.connect(pan).connect(this.master);
    const notes = 3 + Math.floor(Math.random() * 5);
    const base = 2600 + Math.random() * 1800;
    let t = t0;
    for (let k = 0; k < notes; k++) {
      const dur = 0.05 + Math.random() * 0.09;
      const f0 = base * (0.85 + Math.random() * 0.35);
      const f1 = f0 * (Math.random() < 0.5 ? 0.7 : 1.25);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const fm = ctx.createOscillator();
      fm.frequency.value = 30 + Math.random() * 60;
      const fmGain = ctx.createGain();
      fmGain.gain.value = f0 * 0.04;
      fm.connect(fmGain).connect(o.frequency);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(env).connect(out);
      o.start(t);
      fm.start(t);
      o.stop(t + dur + 0.02);
      fm.stop(t + dur + 0.02);
      t += dur + 0.03 + Math.random() * 0.08;
    }
    setTimeout(() => out.disconnect(), (t - ctx.currentTime + 0.5) * 1000);
  }
}
