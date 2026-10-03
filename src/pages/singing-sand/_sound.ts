// The plate's voice, and an ear for yours. Nothing recorded leaves the page.

/** Ratio of a struck plate's first inharmonic partial; it rings like metal instead of beeping. */
const PARTIAL = 2.76;

export class Voice {
  private readonly out: GainNode;
  private readonly main: OscillatorNode;
  private readonly partial: OscillatorNode;

  constructor(private readonly ctx: AudioContext) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(ctx.destination);

    const partialGain = ctx.createGain();
    partialGain.gain.value = 0.18;
    partialGain.connect(this.out);

    this.main = ctx.createOscillator();
    this.main.connect(this.out);
    this.partial = ctx.createOscillator();
    this.partial.connect(partialGain);
    this.main.start();
    this.partial.start();
  }

  /** Glide to freq at level (0 is silent). */
  set(freq: number, level: number): void {
    const t = this.ctx.currentTime;
    this.main.frequency.setTargetAtTime(freq, t, 0.03);
    this.partial.frequency.setTargetAtTime(freq * PARTIAL, t, 0.03);
    this.out.gain.setTargetAtTime(level, t, 0.08);
  }
}

export interface Heard {
  /** Fundamental in Hz, or null when nothing pitched is heard. */
  pitch: number | null;
  /** RMS of the input, 0 to about 1. */
  level: number;
}

export class Ear {
  private readonly buf: Float32Array<ArrayBuffer>;
  private readonly corr: Float32Array;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly stream: MediaStream,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly analyser: AnalyserNode,
  ) {
    this.buf = new Float32Array(analyser.fftSize);
    this.corr = new Float32Array(analyser.fftSize);
  }

  static async open(ctx: AudioContext): Promise<Ear> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    return new Ear(ctx, stream, source, analyser);
  }

  listen(minFreq: number, maxFreq: number): Heard {
    const { buf, corr } = this;
    this.analyser.getFloatTimeDomainData(buf);

    let sum = 0;
    for (const v of buf) sum += v * v;
    const level = Math.sqrt(sum / buf.length);
    if (level < 0.01) return { pitch: null, level };

    // Autocorrelation: the lag at which the wave best matches itself is one period.
    const rate = this.ctx.sampleRate;
    const minLag = Math.max(2, Math.floor(rate / maxFreq));
    const maxLag = Math.min(Math.floor(rate / minFreq), buf.length >> 1);
    const span = buf.length - maxLag - 1;

    let energy = 0;
    for (let i = 0; i < span; i++) energy += buf[i]! * buf[i]!;
    for (let lag = 0; lag <= maxLag + 1; lag++) {
      let s = 0;
      for (let i = 0; i < span; i++) s += buf[i]! * buf[i + lag]!;
      corr[lag] = s / energy;
    }

    // Skip the hump around zero lag, then take the first peak near the best one,
    // so a voice isn't heard an octave low.
    let start = minLag;
    while (start < maxLag && corr[start]! > 0.2) start++;
    let best = 0;
    for (let lag = start; lag <= maxLag; lag++) best = Math.max(best, corr[lag]!);
    if (best < 0.5) return { pitch: null, level };

    for (let lag = start; lag <= maxLag; lag++) {
      const c = corr[lag]!;
      if (c >= best * 0.9 && c >= corr[lag - 1]! && c >= corr[lag + 1]!) {
        // Fit a parabola through the peak for a fractional lag.
        const a = corr[lag - 1]!;
        const b = corr[lag + 1]!;
        const shift = (a - b) / (2 * (a - 2 * c + b) || 1);
        return { pitch: rate / (lag + shift), level };
      }
    }
    return { pitch: null, level };
  }

  close(): void {
    this.source.disconnect();
    for (const track of this.stream.getTracks()) track.stop();
  }
}
