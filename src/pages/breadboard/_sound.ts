// /breadboard/: sound. The buzzer's tone follows the voltage across it; parts that fail make a
// short crack; placing a part clicks. Nothing plays until the visitor has touched the page.

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buzz: GainNode | null = null;
  private level = 0;
  enabled = true;

  /** Call from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.enabled ? 0.5 : 0;
    master.connect(ctx.destination);
    this.master = master;
    // A piezo element driven near its resonance: a bright fundamental with a little second harmonic.
    const buzz = ctx.createGain();
    buzz.gain.value = 0;
    const tone = ctx.createGain();
    tone.gain.value = 0.09;
    const f = 2350;
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    o1.connect(tone);
    o2.connect(g2).connect(tone);
    tone.connect(lp).connect(buzz).connect(master);
    o1.start();
    o2.start();
    this.buzz = buzz;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.02);
  }

  /** Buzzer drive, 0 to 1, updated once a frame. */
  setBuzz(level: number) {
    if (!this.ctx || !this.buzz) return;
    const v = level > 0.05 ? 0.35 + 0.65 * level : 0;
    if (Math.abs(v - this.level) < 0.01) return;
    this.level = v;
    this.buzz.gain.setTargetAtTime(v, this.ctx.currentTime, 0.004);
  }

  /** A part failing: a crack of filtered noise over a low thump. */
  pop(big = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.12);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.12));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.55 * big;
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.4 * big, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
  }

  /** A leg seating in a spring clip. */
  click() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.012);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.2));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.value = 0.25;
    src.connect(hp).connect(g).connect(this.master);
    src.start(t);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }
}
