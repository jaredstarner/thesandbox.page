// Every sound on the page is synthesized here: no samples, no files.
// Browsers hold audio until the first gesture, so nothing plays before then.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
const waiting = new Set<() => void>();

const LEVEL = 0.7;

export function initAudio(): void {
  const unlock = () => {
    if (!ctx) {
      try {
        ctx = new AudioContext();
      } catch {
        return;
      }
      master = ctx.createGain();
      master.gain.value = muted ? 0 : LEVEL;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    for (const fn of waiting) fn();
    waiting.clear();
  };
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
    addEventListener(type, unlock, { capture: true });
  }
}

export const audioReady = (): boolean => !!ctx && ctx.state === 'running';

/** Run once audio is unlocked; right away if it already is. */
export function whenAudio(fn: () => void): void {
  if (audioReady()) fn();
  else waiting.add(fn);
}

export function setMuted(on: boolean): void {
  muted = on;
  if (ctx && master) master.gain.setTargetAtTime(on ? 0 : LEVEL, ctx.currentTime, 0.02);
}

export const isMuted = (): boolean => muted;

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

function voice(freq: number, start: number, dur: number, type: OscillatorType, peak: number, out: AudioNode) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(peak, start + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(env).connect(out);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function noiseBuffer(): AudioBuffer | null {
  if (!ctx) return null;
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

let noise: AudioBuffer | null = null;

type Sfx = 'ping' | 'ding' | 'buzz' | 'whoosh' | 'coin' | 'tick' | 'pop';

export function sfx(kind: Sfx): void {
  if (!ctx || !master || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.01;
  switch (kind) {
    case 'ping':
      voice(988, t, 0.16, 'sine', 0.35, master);
      voice(1319, t + 0.09, 0.3, 'sine', 0.3, master);
      break;
    case 'ding':
      voice(1568, t, 1.2, 'sine', 0.25, master);
      voice(2352, t, 0.7, 'sine', 0.12, master);
      voice(3136, t, 0.35, 'sine', 0.06, master);
      break;
    case 'buzz':
      voice(98, t, 0.22, 'square', 0.12, master);
      voice(103, t, 0.22, 'square', 0.1, master);
      break;
    case 'coin':
      voice(988, t, 0.08, 'square', 0.1, master);
      voice(1319, t + 0.07, 0.3, 'square', 0.1, master);
      break;
    case 'tick':
      voice(2200, t, 0.03, 'square', 0.05, master);
      break;
    case 'pop': {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.frequency.setValueAtTime(700, t);
      osc.frequency.exponentialRampToValueAtTime(180, t + 0.09);
      env.gain.setValueAtTime(0.3, t);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      osc.connect(env).connect(master);
      osc.start(t);
      osc.stop(t + 0.14);
      break;
    }
    case 'whoosh': {
      noise ??= noiseBuffer();
      if (!noise) return;
      const src = ctx.createBufferSource();
      const band = ctx.createBiquadFilter();
      const env = ctx.createGain();
      src.buffer = noise;
      band.type = 'bandpass';
      band.Q.value = 1.2;
      band.frequency.setValueAtTime(400, t);
      band.frequency.exponentialRampToValueAtTime(3200, t + 0.28);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.35, t + 0.08);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      src.connect(band).connect(env).connect(master);
      src.start(t);
      src.stop(t + 0.34);
      break;
    }
  }
}

// ---------- Jingles ----------

export interface Tune {
  bpm: number;
  /** Space-separated note names per sixteenth (C4, F#3, Bb2) or "." for a rest. */
  lead: string;
  bass: string;
  leadWave: OscillatorType;
  bassWave: OscillatorType;
  leadLevel: number;
  bassLevel: number;
  /** Sixteenths a lead note rings for. */
  leadLength?: number;
}

const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function parse(line: string): (number | null)[] {
  return line
    .trim()
    .split(/\s+/)
    .map((tok) => {
      if (tok === '.') return null;
      const m = /^([A-G])([#b]?)(-?\d)$/.exec(tok);
      if (!m) return null;
      const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
      return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + acc;
    });
}

export interface Playing {
  stop(): void;
}

/** Loop a tune on the audio clock until stopped. */
export function playTune(tune: Tune): Playing {
  if (!ctx || !master) return { stop() {} };
  const audio = ctx;
  const bus = audio.createGain();
  bus.gain.value = 0.55;
  bus.connect(master);
  const lead = parse(tune.lead);
  const bass = parse(tune.bass);
  const steps = Math.max(lead.length, bass.length);
  const step = 60 / tune.bpm / 4;
  let next = audio.currentTime + 0.06;
  let i = 0;
  const timer = setInterval(() => {
    while (next < audio.currentTime + 0.15) {
      const l = lead[i % lead.length];
      const b = bass[i % bass.length];
      if (l != null) voice(midi(l), next, step * (tune.leadLength ?? 1.6), tune.leadWave, tune.leadLevel, bus);
      if (b != null) voice(midi(b), next, step * 1.8, tune.bassWave, tune.bassLevel, bus);
      next += step;
      i = (i + 1) % steps;
    }
  }, 30);
  return {
    stop() {
      clearInterval(timer);
      bus.gain.setTargetAtTime(0, audio.currentTime, 0.03);
      setTimeout(() => bus.disconnect(), 400);
    },
  };
}
