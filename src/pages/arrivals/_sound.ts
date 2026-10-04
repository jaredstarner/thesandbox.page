// The clatter of landing flaps, made from scratch: a few milliseconds of noise
// that dies away fast, through a band-pass filter tuned to a hard plastic tick.

const random = (min: number, max: number) => min + Math.random() * (max - min);

export class Clatter {
  private ctx: AudioContext | null = null;
  private tick: AudioBuffer | null = null;
  private out: AudioNode | null = null;
  private on = false;

  get enabled(): boolean {
    return this.on;
  }

  /** Turns the sound on or off. The first call must come from a click or key press. */
  toggle(): boolean {
    this.on = !this.on;
    if (this.on && !this.ctx) this.build();
    if (this.ctx) void (this.on ? this.ctx.resume() : this.ctx.suspend());
    return this.on;
  }

  /** Plays the sound of this many flaps landing in the same frame. */
  land(count: number): void {
    const { ctx, tick, out } = this;
    if (!this.on || !ctx || !tick || !out) return;
    // A crowd of flaps sounds like rain, not one loud click: spread a few
    // ticks across the frame and let their loudness grow slowly with the count.
    const voices = Math.min(3, count);
    const gain = Math.min(0.5, 0.07 * Math.sqrt(count)) / voices;
    for (let i = 0; i < voices; i++) {
      const source = ctx.createBufferSource();
      const level = ctx.createGain();
      source.buffer = tick;
      source.playbackRate.value = random(0.75, 1.35);
      level.gain.value = gain * random(0.6, 1);
      source.connect(level).connect(out);
      source.start(ctx.currentTime + random(0, 0.016));
    }
  }

  private build(): void {
    const ctx = new AudioContext();
    const length = Math.round(ctx.sampleRate * 0.025);
    const tick = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = tick.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.0025));

    const body = ctx.createBiquadFilter();
    body.type = 'bandpass';
    body.frequency.value = 2600;
    body.Q.value = 1.4;
    body.connect(ctx.destination);

    this.ctx = ctx;
    this.tick = tick;
    this.out = body;
  }
}
