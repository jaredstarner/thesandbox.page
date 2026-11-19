// The ring of six, cast in additive synthesis. Each bell is rendered once into a buffer from the partials of
// a true-harmonic (Simpson-tuned) English bell: hum, prime, tierce, quint, and nominal at 1 : 2 : 2.378 :
// 3 : 4, with the upper quint and double octave above. The low partials hum on long after the strike, the
// upper ones die fast, and a few are split into close doublets so the bell warbles as real castings do.
// In the ringing chamber the bells are a floor or two overhead, so they come through muffled, into a stone
// room's reverberation.

/** Nominals for a ring of six in F: treble D, then C, B flat, A, G, and the tenor F. */
const NOMINALS = [1174.66, 1046.5, 932.33, 880.0, 783.99, 698.46];

interface Partial {
  ratio: number;
  amp: number;
  /** Decay time constant in seconds, for the tenor; smaller bells die faster. */
  tau: number;
  /** Doublet split in Hz, for the slow warble. */
  split?: number;
}

const PARTIALS: Partial[] = [
  { ratio: 0.25, amp: 0.3, tau: 7.5, split: 0.35 }, // hum
  { ratio: 0.5, amp: 0.42, tau: 4.6, split: 0.6 }, // prime
  { ratio: 0.5945, amp: 0.46, tau: 3.6 }, // tierce, the minor third that gives a bell its colour
  { ratio: 0.749, amp: 0.16, tau: 1.1 }, // quint
  { ratio: 1.0, amp: 1.0, tau: 2.6, split: 0.9 }, // nominal
  { ratio: 1.255, amp: 0.2, tau: 1.3 }, // deciem
  { ratio: 1.497, amp: 0.5, tau: 1.15 }, // upper quint
  { ratio: 2.004, amp: 0.34, tau: 0.8 }, // double octave
  { ratio: 2.52, amp: 0.13, tau: 0.5 },
  { ratio: 2.67, amp: 0.1, tau: 0.42 },
  { ratio: 3.03, amp: 0.07, tau: 0.32 },
];

const LENGTH = 7; // seconds rendered per bell
const RATE = 48000;

/** Cast one bell offline: a sine per partial (two for a doublet), each dying away at its own rate. */
async function cast(i: number): Promise<AudioBuffer> {
  const off = new OfflineAudioContext(1, RATE * LENGTH, RATE);
  const f = NOMINALS[i];
  // Smaller bells ring shorter.
  const size = Math.pow(NOMINALS[NOMINALS.length - 1] / f, 0.8);
  const out = off.createGain();
  out.gain.setValueAtTime(0, 0);
  out.gain.linearRampToValueAtTime(1, 0.0006);
  out.connect(off.destination);
  const voice = (freq: number, amp: number, tau: number, phase: number) => {
    const osc = off.createOscillator();
    osc.frequency.value = freq;
    const g = off.createGain();
    g.gain.setValueAtTime(amp, 0);
    g.gain.setTargetAtTime(0, 0, tau);
    osc.connect(g).connect(out);
    osc.start(phase);
    osc.stop(Math.min(LENGTH, tau * 9.5));
  };
  PARTIALS.forEach((p, k) => {
    const tau = p.tau * size;
    // A hair of start offset per partial stands in for random phase.
    const phase = ((i * 7 + k * 3) % 11) * 0.00002;
    if (p.split) {
      voice(f * p.ratio, p.amp * 0.62, tau, phase);
      voice(f * p.ratio + p.split, p.amp * 0.38, tau, phase);
    } else {
      voice(f * p.ratio, p.amp, tau, phase);
    }
  });
  // The clapper's contact: a few milliseconds of bright, quickly damped clang.
  voice(f * 3.9, 0.16, 0.0028, 0);
  voice(f * 5.7, 0.11, 0.0022, 0);
  const buf = await off.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let n = 0; n < d.length; n++) peak = Math.max(peak, Math.abs(d[n]));
  if (peak > 0) for (let n = 0; n < d.length; n++) d[n] /= peak;
  return buf;
}

/** All six bells, cast in parallel; no sound plays and no permission is needed to do this. */
export function castRing(): Promise<AudioBuffer[]> {
  return Promise.all(NOMINALS.map((_, i) => cast(i)));
}

export class Ring {
  readonly ctx: AudioContext;
  private buffers: AudioBuffer[] = [];
  private input: GainNode;
  private master: GainNode;

  constructor(ctx: AudioContext, buffers: AudioBuffer[]) {
    this.ctx = ctx;
    this.buffers = buffers;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    // The bells overhead: through timber and stone, so the upper partials lose their edge.
    this.input = ctx.createGain();
    const floor = ctx.createBiquadFilter();
    floor.type = 'lowpass';
    floor.frequency.value = 3200;
    floor.Q.value = 0.5;
    const dry = ctx.createGain();
    dry.gain.value = 0.62;
    const wet = ctx.createGain();
    wet.gain.value = 0.38;
    const verb = ctx.createConvolver();
    verb.buffer = this.room();
    this.input.connect(floor);
    floor.connect(dry).connect(this.master);
    floor.connect(verb).connect(wet).connect(this.master);

  }

  /** A stone room's reverberation: decaying, darkening diffuse noise, the usual synthetic impulse. */
  private room(): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 2.2);
    const buf = this.ctx.createBuffer(2, len, sr);
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff - 0.5;
    };
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        // The tail darkens as it decays: a one-pole low-pass whose cutoff falls with time.
        const k = 0.5 * Math.exp(-t * 1.6) + 0.04;
        lp += (rnd() - lp) * k;
        d[i] = lp * Math.exp(-t * 3.1) * (t < 0.012 ? t / 0.012 : 1);
      }
    }
    return buf;
  }

  /** Strike bell i (0 = treble) at audio time `at`, as loud as the clapper's speed allows. */
  strike(i: number, at: number, loud = 1): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[i];
    const g = this.ctx.createGain();
    // The heavier bells sound bigger in the room; the treble cuts through anyway.
    g.gain.value = Math.min(1, loud) * (0.32 + i * 0.03);
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = (i - 2.5) * 0.12;
    src.connect(g).connect(pan).connect(this.input);
    src.start(Math.max(at, this.ctx.currentTime));
  }

  /** Fade everything out, for a stand or a hidden tab. */
  hush(): void {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 0.6);
  }

  wake(): void {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0.55, t + 0.05);
  }
}
