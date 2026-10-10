// Every sound the box makes is synthesized: no samples. The door's creak is
// stick-slip friction, a train of tiny clicks at a wandering rate rung
// through the resonances of a steel tunnel; the flag is a few inharmonic
// partials, like any struck sheet of metal.

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let enabled = true;

/** Create the audio graph on the first real gesture anywhere on the page. */
export function armAudio(): void {
  const unlock = () => {
    if (!ctx) {
      try {
        ctx = new AudioContext();
        out = ctx.createGain();
        out.gain.value = 0.55;
        out.connect(ctx.destination);
      } catch {
        ctx = null;
      }
    }
    void ctx?.resume();
  };
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }
}

export function setSound(on: boolean): void {
  enabled = on;
}

function ready(): AudioContext | null {
  if (!enabled || !ctx || !out || ctx.state !== 'running') return null;
  return ctx;
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function envelope(c: AudioContext, at: number, attack: number, hold: number, release: number, peak: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.setValueAtTime(peak, at + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
  return g;
}

/** A hinge creak: `seconds` long, rising in pitch when `opening`. */
export function creak(seconds: number, opening = true): void {
  const c = ready();
  if (!c || !out) return;
  const sr = c.sampleRate;
  const buf = c.createBuffer(1, Math.ceil(sr * seconds), sr);
  const d = buf.getChannelData(0);
  let t = 0;
  while (t < seconds) {
    const p = t / seconds;
    const base = opening ? 28 + 70 * p : 90 - 50 * p;
    const rate = base * (1 + 0.35 * Math.sin(t * 9.3) + 0.25 * (Math.random() - 0.5));
    const i0 = Math.floor(t * sr);
    const amp = 0.6 + 0.4 * Math.sin(Math.PI * p);
    for (let k = 0; k < 90 && i0 + k < d.length; k++) d[i0 + k] += amp * Math.exp(-k / 14) * (k % 2 ? -1 : 1);
    t += 1 / Math.max(12, rate);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const now = c.currentTime;
  const mix = c.createGain();
  mix.gain.value = 0.5;
  for (const [f, q, g] of [
    [780, 9, 1],
    [1460, 12, 0.7],
    [2630, 14, 0.35],
  ]) {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(f * (opening ? 0.9 : 1.05), now);
    bp.frequency.linearRampToValueAtTime(f * (opening ? 1.12 : 0.9), now + seconds);
    bp.Q.value = q;
    const gain = c.createGain();
    gain.gain.value = g;
    src.connect(bp).connect(gain).connect(mix);
  }
  mix.connect(envelope(c, now, 0.05, Math.max(0, seconds - 0.2), 0.15, 1)).connect(out);
  src.start(now);
}

/** The flag arm striking its stop: struck steel. */
export function clank(strength = 1): void {
  const c = ready();
  if (!c || !out) return;
  const now = c.currentTime;
  const bus = c.createGain();
  bus.gain.value = 0.22 * strength;
  bus.connect(out);
  for (const [f, decay] of [
    [523, 0.5],
    [1341, 0.32],
    [2207, 0.2],
    [3611, 0.12],
  ]) {
    const o = c.createOscillator();
    o.frequency.value = f * (0.98 + Math.random() * 0.04);
    const g = envelope(c, now, 0.002, 0, decay, 0.6);
    o.connect(g).connect(bus);
    o.start(now);
    o.stop(now + decay + 0.05);
  }
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c, 0.05);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  n.connect(hp).connect(envelope(c, now, 0.001, 0, 0.04, 0.8)).connect(bus);
  n.start(now);
}

/** The door shutting on its latch. */
export function thunk(): void {
  const c = ready();
  if (!c || !out) return;
  const now = c.currentTime;
  const o = c.createOscillator();
  o.frequency.setValueAtTime(150, now);
  o.frequency.exponentialRampToValueAtTime(55, now + 0.18);
  o.connect(envelope(c, now, 0.003, 0, 0.22, 0.5)).connect(out);
  o.start(now);
  o.stop(now + 0.3);
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c, 0.1);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  n.connect(lp).connect(envelope(c, now, 0.001, 0, 0.08, 0.6)).connect(out);
  n.start(now);
  clank(0.35);
}

/** Paper sliding over steel; `fast` for mail that is being thrown back out. */
export function slide(fast = false): void {
  const c = ready();
  if (!c || !out) return;
  const now = c.currentTime;
  const dur = fast ? 0.25 : 0.55;
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c, dur);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(fast ? 5000 : 1800, now);
  bp.frequency.exponentialRampToValueAtTime(fast ? 1400 : 3800, now + dur);
  n.connect(bp).connect(envelope(c, now, fast ? 0.01 : 0.12, dur * 0.4, dur * 0.4, fast ? 0.7 : 0.35)).connect(out);
  n.start(now);
}

/** A rubber stamp landing on paper. */
export function stampThud(): void {
  const c = ready();
  if (!c || !out) return;
  const now = c.currentTime;
  const o = c.createOscillator();
  o.frequency.setValueAtTime(110, now);
  o.frequency.exponentialRampToValueAtTime(50, now + 0.1);
  o.connect(envelope(c, now, 0.002, 0, 0.12, 0.6)).connect(out);
  o.start(now);
  o.stop(now + 0.2);
}
