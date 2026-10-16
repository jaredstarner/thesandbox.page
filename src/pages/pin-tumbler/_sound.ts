// Pin tumbler: what the lock sounds like through the wrench.
//
// Every click here is a short burst of noise struck into a bank of narrow resonators,
// each tuned to a ringing mode of a part: the brass housing for a pin setting, the
// small steel pins for a drop, the plug and cam for the turn. Friction is a band of
// noise whose level follows how fast the pick is moving a pin, broken into
// stick-slip ticks when that pin is binding.

/** Ringing modes of the housing, in Hz, with their relative levels. */
const HOUSING: [number, number][] = [
  [2380, 1],
  [3720, 0.7],
  [5610, 0.45],
  [8120, 0.25],
];
/** A plug jumping in its bore: lower and fuller. */
const PLUG: [number, number][] = [
  [1240, 1],
  [2060, 0.8],
  [3310, 0.5],
  [4870, 0.3],
];
/** A little steel pin knocking about in its chamber. */
const PIN: [number, number][] = [
  [6800, 1],
  [9400, 0.6],
  [12100, 0.3],
];

export class LockSound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private rubGain: GainNode | null = null;
  private rubFilter: BiquadFilterNode | null = null;
  private zingGain: GainNode | null = null;
  private lastTick = 0;
  muted = false;

  /** Make the context on a user gesture; browsers won't start one otherwise. */
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
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    comp.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.9;
    this.out.connect(comp);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // The rub of pin on chamber wall, always running, its level set every frame.
    const rub = ctx.createBufferSource();
    rub.buffer = this.noise;
    rub.loop = true;
    this.rubFilter = ctx.createBiquadFilter();
    this.rubFilter.type = 'bandpass';
    this.rubFilter.frequency.value = 2600;
    this.rubFilter.Q.value = 1.6;
    this.rubGain = ctx.createGain();
    this.rubGain.gain.value = 0;
    rub.connect(this.rubFilter).connect(this.rubGain).connect(this.out);
    rub.start();

    // The faint singing of a coil spring rubbing its chamber as it's squeezed.
    const zing = ctx.createBufferSource();
    zing.buffer = this.noise;
    zing.loop = true;
    zing.loopStart = 0.31;
    const zf = ctx.createBiquadFilter();
    zf.type = 'bandpass';
    zf.frequency.value = 7400;
    zf.Q.value = 9;
    this.zingGain = ctx.createGain();
    this.zingGain.gain.value = 0;
    zing.connect(zf).connect(this.zingGain).connect(this.out);
    zing.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }

  /** Strike a bank of modes with a burst of noise. */
  private strike(modes: [number, number][], level: number, q: number, at = 0, burst = 0.0025, shift = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || !this.noise || this.muted) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.0004);
    env.gain.exponentialRampToValueAtTime(0.001, t + burst);
    src.connect(env);
    const sum = ctx.createGain();
    sum.gain.value = level;
    for (const [f, a] of modes) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * shift * (0.985 + Math.random() * 0.03);
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = a * Math.sqrt(q) * 0.9;
      env.connect(bp).connect(g).connect(sum);
    }
    // The click's own edge, before anything rings.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    const edge = ctx.createGain();
    edge.gain.value = 0.35;
    env.connect(hp).connect(edge).connect(sum);
    sum.connect(this.out);
    src.start(t, Math.random() * 0.8);
    src.stop(t + burst + 0.25);
  }

  /** A low knock: something heavy moving a fraction of a millimetre. */
  private thump(freq: number, level: number, decay: number, at = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || this.muted) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.012);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  /** A driver clears the shear line and drops onto the plug's edge; the plug jumps. */
  set(): void {
    this.strike(HOUSING, 0.55, 34, 0, 0.003);
    this.thump(420, 0.22, 0.03, 0.001);
  }

  /** A serrated driver's groove catches: the same click, smaller and brighter. */
  groove(): void {
    this.strike(HOUSING, 0.22, 30, 0, 0.002, 1.12);
  }

  /** A spool's waist reaches the shear line and the plug swings over: a fuller clunk. */
  caught(): void {
    this.strike(PLUG, 0.75, 22, 0, 0.005);
    this.thump(190, 0.45, 0.07, 0.002);
  }

  /** A key pin wedges across the shear line: dead, with no ring. */
  overset(): void {
    this.thump(300, 0.3, 0.04);
    this.strike(PLUG, 0.12, 6, 0, 0.004, 0.7);
  }

  /** Tension let go: every held pin snaps back down. */
  reset(pins: number): void {
    for (let i = 0; i < Math.max(2, pins + 1); i++) {
      const at = 0.004 + Math.random() * 0.07;
      this.strike(PIN, 0.18 + Math.random() * 0.12, 26, at, 0.0015, 0.9 + Math.random() * 0.2);
      this.strike(HOUSING, 0.08, 30, at + 0.001, 0.0015);
    }
  }

  /** The pick's tip meeting the next key pin. */
  touch(): void {
    this.strike(PIN, 0.09, 18, 0, 0.0012, 1.05);
  }

  /** The pick bending against a pin that won't move. */
  jam(): void {
    const now = performance.now();
    if (now - this.lastTick < 140) return;
    this.lastTick = now;
    this.strike(PLUG, 0.07, 4, 0, 0.02, 0.6);
  }

  /** The plug turns its quarter, the cam throws the bolt, and the bolt lands. */
  open(): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || !this.noise || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(1600, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.05);
    g.gain.linearRampToValueAtTime(0.1, t + 0.4);
    g.gain.linearRampToValueAtTime(0, t + 0.58);
    src.connect(bp).connect(g).connect(this.out);
    src.start(t, 0.2);
    src.stop(t + 0.6);
    this.strike(PLUG, 0.4, 20, 0.32, 0.004, 0.8);
    this.thump(140, 0.5, 0.09, 0.33);
    // The bolt sliding home, then hitting its stop.
    const slide = ctx.createBufferSource();
    slide.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t + 0.36);
    sg.gain.linearRampToValueAtTime(0.22, t + 0.42);
    sg.gain.linearRampToValueAtTime(0, t + 0.6);
    slide.connect(lp).connect(sg).connect(this.out);
    slide.start(t + 0.36, 0.5);
    slide.stop(t + 0.62);
    this.thump(95, 0.55, 0.12, 0.6);
    this.strike(PLUG, 0.35, 16, 0.6, 0.006, 0.55);
  }

  /** Called every frame with how the pick is moving the pin it's under. */
  feel(contact: string, speed: number, tension: number, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.rubGain || !this.zingGain || !this.rubFilter) return;
    const v = Math.min(1, speed / 12);
    const rub = contact === 'binding' ? v * (0.1 + tension * 0.3) : contact === 'loose' ? v * 0.04 : 0;
    const zing = contact === 'spring' ? v * 0.07 : contact === 'binding' ? v * 0.03 : 0;
    const now = ctx.currentTime;
    this.rubGain.gain.setTargetAtTime(this.muted ? 0 : rub, now, 0.015);
    this.zingGain.gain.setTargetAtTime(this.muted ? 0 : zing, now, 0.02);
    this.rubFilter.frequency.setTargetAtTime(2200 + tension * 1400, now, 0.05);
    // A binding driver doesn't slide; it sticks and slips, and each slip is a tiny tick.
    if (contact === 'binding' && speed > 0.3 && Math.random() < dt * (8 + speed * 3)) {
      this.strike(HOUSING, 0.035 + tension * 0.05, 20, 0, 0.0012, 1.3);
    }
  }
}
