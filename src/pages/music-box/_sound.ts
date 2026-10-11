// The comb's voice. Each tooth is a clamped-free steel beam: its first three
// bending modes ring at 1, 6.27, and 17.55 times the note (from the beam's
// eigenvalues 1.875, 4.694, 7.855, squared), each dying away faster than the
// one below. A pick adds a short scrape at the tip, a tooth caught mid-swing
// buzzes against the star wheel, and the box's body is a pair of resonances
// that only speak when it rests on wood.

const MODES = [
  { ratio: 1, amp: 1, decay: 1 },
  // A torsional twin just above the note: the slow beat heard in a long tooth.
  { ratio: 1.0024, amp: 0.2, decay: 0.85 },
  { ratio: 6.27, amp: 0.32, decay: 0.2 },
  { ratio: 17.55, amp: 0.09, decay: 0.07 },
];

interface Voice {
  out: GainNode;
  start: number;
  tau: number;
}

export const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Seconds for the fundamental to fall 60 dB: long bass teeth ring for seconds, the shortest barely one. */
export const ringTime = (midi: number) => {
  const low = Math.min(1, Math.max(0, (83 - midi) / 35));
  return 1.15 + 3.6 * low ** 1.25;
};

export class CombSound {
  ctx: AudioContext | null = null;
  private bus!: GainNode;
  private body!: { low: BiquadFilterNode; mid: BiquadFilterNode; cut: BiquadFilterNode; level: GainNode };
  private noise!: AudioBuffer;
  private rustle!: GainNode;
  private voices = new Map<number, Voice>();
  private onTable = true;
  muted = false;

  /** Starts audio; call from a user gesture. */
  wake(): AudioContext | null {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return null;
      }
      this.build(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  get live(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private build(ctx: AudioContext) {
    const sr = ctx.sampleRate;

    this.noise = ctx.createBuffer(1, sr, sr);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;

    // The box's body, then a small room.
    const cut = ctx.createBiquadFilter();
    cut.type = 'highpass';
    cut.Q.value = 0.6;
    const low = ctx.createBiquadFilter();
    low.type = 'peaking';
    low.frequency.value = 175;
    low.Q.value = 1.1;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 440;
    mid.Q.value = 1.4;
    const level = ctx.createGain();
    this.body = { low, mid, cut, level };

    this.bus = ctx.createGain();
    this.bus.gain.value = 0.5;
    this.bus.connect(cut).connect(low).connect(mid).connect(level);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;

    const room = ctx.createConvolver();
    room.buffer = this.roomImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.16;
    level.connect(comp);
    level.connect(room).connect(wet).connect(comp);
    comp.connect(ctx.destination);

    // Paper sliding over the drum, only while it moves.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 3800;
    band.Q.value = 0.6;
    this.rustle = ctx.createGain();
    this.rustle.gain.value = 0;
    src.connect(band).connect(this.rustle).connect(comp);
    src.start();

    this.setTable(this.onTable);
  }

  private roomImpulse(ctx: AudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 1.3);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        // Darkening tail: a one-pole lowpass whose cutoff falls as it decays.
        const k = 0.55 + 0.4 * Math.exp(-t * 3);
        lp = lp * (1 - k) + (Math.random() * 2 - 1) * k;
        d[i] = lp * Math.exp(-t * 5.2) * (t < 0.006 ? t / 0.006 : 1);
      }
    }
    return buf;
  }

  setTable(on: boolean) {
    this.onTable = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const { low, mid, cut, level } = this.body;
    // In the hand the comb has only its own small base to push against: thin, quiet.
    cut.frequency.setTargetAtTime(on ? 70 : 420, t, 0.08);
    low.gain.setTargetAtTime(on ? 7 : 0, t, 0.08);
    mid.gain.setTargetAtTime(on ? 4 : 1, t, 0.08);
    level.gain.setTargetAtTime(this.muted ? 0 : on ? 1 : 0.42, t, 0.08);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.setTable(this.onTable);
  }

  /** Pluck the tooth for `midi`. `row` keys the tooth so a second pick can catch it still moving. */
  pluck(row: number, midi: number, velocity = 0.9, when = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = Math.max(ctx.currentTime, when);
    const f0 = midiToHz(midi);
    const T60 = ringTime(midi);
    const tau = T60 / 6.91;

    const prev = this.voices.get(row);
    if (prev) {
      const age = t - prev.start;
      // The star wheel stops a tooth that is still swinging, then flicks it again.
      prev.out.gain.cancelScheduledValues(t);
      prev.out.gain.setTargetAtTime(0, t, 0.005);
      if (age < prev.tau * 1.4) this.buzz(f0, t, 1 - age / (prev.tau * 1.4));
    }

    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.bus);
    // Shorter teeth are stiffer and speak louder for the same pick; even them out.
    const level = 0.2 * velocity * (0.75 + 0.25 * Math.min(1, (midi - 48) / 35));
    const stopAt = t + tau * 7;

    for (const mode of MODES) {
      const f = f0 * mode.ratio;
      if (f > 16000) continue;
      // Upper modes are stronger in the short, stiff teeth.
      const bright = mode.ratio > 2 ? 0.55 + 0.45 * Math.min(1, (midi - 48) / 35) : 1;
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level * mode.amp * bright, t + 0.0015);
      g.gain.setTargetAtTime(0, t + 0.0015, tau * mode.decay);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(stopAt);
    }

    // The tip scraping off the star wheel's point.
    const scrape = ctx.createBufferSource();
    scrape.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = Math.min(9500, f0 * 7.5);
    band.Q.value = 1.8;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.09 * velocity, t);
    sg.gain.setTargetAtTime(0, t, 0.0035);
    scrape.connect(band).connect(sg).connect(out);
    scrape.start(t, Math.random() * 0.9, 0.03);

    this.voices.set(row, { out, start: t, tau });
    window.setTimeout(
      () => {
        if (this.voices.get(row)?.out === out) this.voices.delete(row);
        out.disconnect();
      },
      (stopAt - ctx.currentTime) * 1000 + 100,
    );
  }

  /** A tooth struck while still moving rattles against the point that stops it. */
  private buzz(f0: number, t: number, strength: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.value = Math.min(5000, f0 * 4);
    lp.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 * strength, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, 0.012);
    osc.connect(lp).connect(g).connect(this.bus);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  private click(freq: number, q: number, gain: number, len: number, tau: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = freq;
    band.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.setTargetAtTime(0, t, tau);
    src.connect(band).connect(g).connect(this.bus);
    src.start(t, Math.random() * 0.9, len);
  }

  /** One tooth of the drive gear passing. */
  gear() {
    this.click(1700 + Math.random() * 500, 4, 0.05 + Math.random() * 0.02, 0.012, 0.0018);
  }

  /** The pawl dropping into the ratchet when the crank is pushed backwards. */
  ratchet() {
    this.click(3200, 3, 0.16, 0.02, 0.0025);
    this.click(900, 2, 0.08, 0.02, 0.004);
  }

  /** A paper punch going through card: a thump of the die and the tick of the chad. */
  punch() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, 0.018);
    osc.connect(g).connect(this.bus);
    osc.start(t);
    osc.stop(t + 0.15);
    this.click(2200, 1.2, 0.3, 0.03, 0.006);
    this.click(6500, 1, 0.12, 0.02, 0.003);
  }

  /** Tape pressed over a hole: a soft rasp. */
  tape() {
    this.click(4800, 0.7, 0.05, 0.12, 0.03);
  }

  /** Paper speed in columns per second drives the rustle. */
  setRustle(speed: number) {
    if (!this.ctx) return;
    const v = Math.min(1, Math.abs(speed) / 6) * 0.018;
    this.rustle.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.06);
  }
}
