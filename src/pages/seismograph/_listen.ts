// Audification: the trace itself played as a waveform, thousands of times
// faster than it was recorded. Ocean microseisms, a few seconds per sway in
// the ground, come up as a hiss around a kilohertz; a distant quake's surface
// waves arrive as a low roll and a near one as a crack. Nothing is
// synthesised: every sample is ground velocity, softly limited so the noise
// stays audible next to a big quake.

import type { Trace } from './_signal';

/** Every browser has to accept buffers at this rate; playbackRate does the rest. */
const BUFFER_RATE = 8000;

export class Listener {
  private ctx: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private from = 0;
  private speed = 1;
  playing = false;

  /** Plays samples [from, to) at `speed` samples per second of sound; resolves when it ends or stops. */
  async play(trace: Trace, from: number, to: number, speed: number, noise: number): Promise<void> {
    this.stop();
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const ctx = this.ctx;
    const n = Math.max(0, to - from);
    if (n < 16) return;
    const buf = ctx.createBuffer(1, n, BUFFER_RATE);
    const ch = buf.getChannelData(0);
    // Soft limiting: noise sits about a tenth of full scale, quakes saturate gently.
    const k = 1 / (noise * 9);
    for (let i = 0; i < n; i++) {
      const v = trace.values[from + i];
      ch[i] = Number.isNaN(v) ? 0 : Math.tanh(v * k) * 0.85;
    }
    // Fades so the edges don't click.
    const fade = Math.min(400, n >> 3);
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      ch[i] *= g;
      ch[n - 1 - i] *= g;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = speed / BUFFER_RATE;
    // The fastest sway left after the station's own anti-alias filter would land
    // right at the top of the band; a gentle low-pass keeps it from fizzing.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(ctx.sampleRate / 2 - 100, speed * 0.42);
    lp.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    src.connect(lp).connect(gain).connect(ctx.destination);
    this.src = src;
    this.from = from;
    this.speed = speed;
    this.startedAt = ctx.currentTime;
    this.playing = true;
    await new Promise<void>((resolve) => {
      src.onended = () => {
        if (this.src === src) {
          this.src = null;
          this.playing = false;
        }
        resolve();
      };
      src.start();
    });
  }

  /** The sample index playing now, or -1. */
  position(): number {
    if (!this.playing || !this.ctx) return -1;
    return this.from + (this.ctx.currentTime - this.startedAt) * this.speed;
  }

  stop(): void {
    if (this.src) {
      const s = this.src;
      this.src = null;
      this.playing = false;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
  }
}
