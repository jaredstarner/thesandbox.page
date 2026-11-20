// The one sound a mobile makes: two sheets of painted aluminium touching. A few inharmonic
// partials of a free plate, struck softly, pitched by the size of the smaller sheet.

const RATIOS = [1, 2.32, 4.25, 6.63];
const GAINS = [1, 0.55, 0.3, 0.16];

export class Clink {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private last = 0;
  muted = false;

  /** Start audio inside a gesture. */
  wake(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.ratio.value = 4;
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.32;
    this.out.connect(comp);
    comp.connect(this.ctx.destination);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended' && !this.muted) void this.ctx.resume();
  }

  /** speed in m/s at the contact; size in metres of the smaller plate. */
  hit(speed: number, size: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || this.muted || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - this.last < 0.035) return;
    this.last = now;
    const level = Math.min(1, speed / 0.25) ** 0.8;
    if (level < 0.04) return;
    // A 10 cm plate rings near 1.5 kHz; bigger sheets lower.
    const f0 = 600 + 90 / Math.max(0.04, size);
    const bus = ctx.createGain();
    bus.gain.value = 0.5 * level;
    // A plate rings longer than it buzzes: a little lowpass that opens with the strike.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2500 + 6000 * level;
    bus.connect(lp);
    lp.connect(this.out);
    RATIOS.forEach((r, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f0 * r * (1 + (Math.random() - 0.5) * 0.01);
      const g = ctx.createGain();
      const decay = (0.5 - i * 0.09) * (0.6 + 0.4 * level);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(GAINS[i]!, now + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      o.connect(g);
      g.connect(bus);
      o.start(now);
      o.stop(now + decay + 0.05);
    });
  }
}
