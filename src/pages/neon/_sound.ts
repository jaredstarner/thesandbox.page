// What the window sounds like: a transformer's hum at twice the mains frequency while the sign is
// lit, the clack of the switch, and a few ticks as each tube strikes. Nothing plays until the
// visitor touches a control, and nothing hums when the sign is off or the tab is hidden.

const MAINS = 60;

export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private hum: GainNode | null = null;
  private humLevel = 0;
  enabled = true;

  /** Start the audio graph; call from a user gesture. */
  wake() {
    if (!this.ctx) {
      try {
        this.build();
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const out = ctx.createGain();
    out.gain.value = this.enabled ? 1 : 0;
    out.connect(ctx.destination);
    this.out = out;

    // Magnetostriction hums at twice the mains frequency, rich in even harmonics, softened by the box.
    const real = new Float32Array(9);
    const imag = new Float32Array([0, 1, 0.42, 0.22, 0.16, 0.08, 0.05, 0.03, 0.02]);
    const wave = ctx.createPeriodicWave(real, imag);
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = MAINS * 2;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 700;
    tone.Q.value = 0.5;
    // A slow wobble in level, as a real core's hum never sits quite still.
    const wob = ctx.createOscillator();
    wob.frequency.value = 0.31;
    const wobDepth = ctx.createGain();
    wobDepth.gain.value = 0.12;
    const hum = ctx.createGain();
    hum.gain.value = 0;
    const humBody = ctx.createGain();
    humBody.gain.value = 1;
    wob.connect(wobDepth).connect(humBody.gain);
    osc.connect(tone).connect(humBody).connect(hum).connect(out);
    osc.start();
    wob.start();
    this.hum = hum;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  /** Hum level from how much is lit: 0 for nothing, 1 for a full window. */
  setHum(level: number) {
    const ctx = this.ctx;
    if (!ctx || !this.hum) return;
    const target = Math.min(1, level) * 0.022;
    if (Math.abs(target - this.humLevel) < 1e-4) return;
    this.humLevel = target;
    this.hum.gain.setTargetAtTime(target, ctx.currentTime, target > 0 ? 0.06 : 0.12);
  }

  /** The switch: a short knock and a brighter click on top. */
  clack(on: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.12));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = on ? 2600 : 2100;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    src.connect(bp).connect(g).connect(this.out);
    src.start(t);
    const knock = ctx.createOscillator();
    knock.type = 'sine';
    knock.frequency.setValueAtTime(on ? 190 : 160, t);
    knock.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    const kg = ctx.createGain();
    kg.gain.setValueAtTime(0.0001, t);
    kg.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    knock.connect(kg).connect(this.out);
    knock.start(t);
    knock.stop(t + 0.14);
  }

  /** A tube striking: a brief buzz as the gas breaks down. */
  strike(delay: number) {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = MAINS * 2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.02, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(lp).connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  suspend() {
    if (this.ctx?.state === 'running') void this.ctx.suspend();
  }

  resume() {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }
}
