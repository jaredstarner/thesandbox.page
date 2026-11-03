// The loom's sounds, all short and all wood or steel: the treadle going down,
// the heddles chinking as the shafts rise, the shuttle running across the race
// and dropping into the hand, and the beater striking the fell. Nothing
// sustains, so the room is quiet whenever the weaver stops.

export class LoomSound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  /** Create the audio graph; call from a user gesture. */
  wake() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 4;
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.55;
      this.out.connect(comp).connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) this.wake();
    else if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  private get live() {
    return this.enabled && this.ctx && this.out && this.ctx.state === 'running' ? this.ctx : null;
  }

  /** A struck piece of wood: a few inharmonic modes dying away fast. */
  private knock(at: number, freqs: number[], level: number, decay: number) {
    const ctx = this.live;
    if (!ctx || !this.out) return;
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const peak = level / (1 + i * 0.9);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, at + decay / (1 + i * 0.5));
      o.connect(g).connect(this.out!);
      o.start(at);
      o.stop(at + decay + 0.05);
    });
  }

  /** A short burst of filtered noise. */
  private brush(at: number, dur: number, f0: number, f1: number, q: number, level: number) {
    const ctx = this.live;
    if (!ctx || !this.out || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, at);
    bp.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + dur * 0.25);
    g.gain.linearRampToValueAtTime(level * 0.7, at + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(bp).connect(g).connect(this.out);
    src.start(at, Math.random() * 0.3);
    src.stop(at + dur + 0.02);
  }

  treadle() {
    const ctx = this.live;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.knock(t, [128, 341, 612], 0.22, 0.14);
    // The heddles on the rising shafts chink against each other.
    for (let i = 0; i < 4; i++) {
      this.knock(t + 0.03 + Math.random() * 0.08, [2900 + Math.random() * 1800, 5200 + Math.random() * 900], 0.012, 0.06);
    }
  }

  fly(dur: number) {
    const ctx = this.live;
    if (!ctx) return;
    this.brush(ctx.currentTime, dur, 900, 1500, 1.4, 0.05);
  }

  land() {
    const ctx = this.live;
    if (!ctx) return;
    this.knock(ctx.currentTime, [520, 1310], 0.06, 0.05);
  }

  beat() {
    const ctx = this.live;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.knock(t, [84, 196, 455, 930], 0.42, 0.22);
    this.brush(t, 0.03, 2400, 1800, 1.2, 0.05);
    // The beater bounces off the fell once, lightly.
    this.knock(t + 0.085, [96, 230, 520], 0.12, 0.1);
  }
}
