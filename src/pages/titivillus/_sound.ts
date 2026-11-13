// A few small sounds, made on the spot: the pat of a landing, the tock of a
// sort lifted out of the line, a little bell as a fault drops into the sack,
// and a dull knock for a word that was sound all along. Between them the page
// is quiet, as a reading room should be.

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;
let enabled = true;

export function setEnabled(on: boolean): void {
  enabled = on;
  if (out && ctx) out.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, 0.02);
}

/** Make or wake the audio context; call from a user gesture. */
export function unlock(): void {
  if (!ctx) {
    const AC = window.AudioContext;
    if (!AC) return;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = enabled ? 0.5 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    out.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

/** Stop everything while the page is hidden. */
export function suspend(): void {
  if (ctx && ctx.state === 'running') void ctx.suspend();
}

function ready(): AudioContext | null {
  if (!ctx || !out || !enabled || ctx.state !== 'running') return null;
  return ctx;
}

function burst(at: number, dur: number, freq: number, q: number, level: number): void {
  if (!ctx || !out || !noise) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(at, Math.random() * 0.15, dur + 0.02);
}

function tone(at: number, freq: number, dur: number, level: number, type: OscillatorType = 'sine'): void {
  if (!ctx || !out) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** A small hand bell: an FM partial stack with a long, soft decay. */
function bell(at: number, freq: number, level: number, dur = 1.6): void {
  if (!ctx || !out) return;
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modGain = ctx.createGain();
  const g = ctx.createGain();
  car.frequency.value = freq;
  mod.frequency.value = freq * 3.5;
  modGain.gain.setValueAtTime(freq * 2.2, at);
  modGain.gain.exponentialRampToValueAtTime(freq * 0.05, at + dur * 0.6);
  mod.connect(modGain).connect(car.frequency);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  car.connect(g).connect(out);
  car.start(at);
  mod.start(at);
  car.stop(at + dur + 0.05);
  mod.stop(at + dur + 0.05);
  tone(at, freq * 2.01, dur * 0.4, level * 0.25);
}

export function leap(): void {
  const c = ready();
  if (!c) return;
  burst(c.currentTime, 0.07, 1900, 1.4, 0.05);
}

export function flap(): void {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  burst(t, 0.09, 900, 1.1, 0.06);
  burst(t + 0.05, 0.07, 1300, 1.3, 0.04);
}

export function land(hard: number): void {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  burst(t, 0.05 + hard * 0.03, 700 + hard * 300, 0.9, 0.06 + hard * 0.08);
  tone(t, 110 + hard * 30, 0.07, 0.05 + hard * 0.06);
}

export function gathered(n: number): void {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  // The sort lifts: a dry wooden tock.
  tone(t, 980, 0.05, 0.12, 'triangle');
  burst(t, 0.03, 3200, 2, 0.05);
  // It lands in the sack: a bell, rising a step for each fault gathered.
  const scale = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19];
  const f = 659.25 * Math.pow(2, scale[(n - 1) % scale.length] / 12);
  bell(t + 0.42, f, 0.16);
  burst(t + 0.42, 0.06, 5200, 3, 0.03);
}

export function sound(): void {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  tone(t, 196, 0.09, 0.12, 'triangle');
  tone(t + 0.07, 147, 0.12, 0.08, 'triangle');
}

export function finis(): void {
  const c = ready();
  if (!c) return;
  const t = c.currentTime + 0.1;
  // Rounds on five bells, then a last strike on the tenor.
  const peal = [880, 784, 698.5, 659.25, 587.3, 659.25, 784, 698.5, 880, 587.3];
  peal.forEach((f, i) => bell(t + i * 0.28, f, 0.13, 2.2));
  bell(t + peal.length * 0.28 + 0.2, 440, 0.16, 3.2);
}
