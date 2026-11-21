// The set's sound: valve warm-up, the hiss and crackle between stations, the whistle of a carrier
// heard slightly off tune, and the live station itself, run through a band-limited AM tone.
//
// Live streams play through <audio>. A stream that answers with CORS headers can be routed into
// Web Audio (MediaElementSource) and shaped with everything else; one that doesn't still plays,
// straight from its element, with only its volume following the tuning.

const API = 'https://all.api.radio-browser.info';

export type OnAir = 'idle' | 'loading' | 'playing' | 'failed';

export interface StationRef {
  id: string;
  url: string;
  cors: boolean;
}

/** A few seconds of band noise: pink hiss, a slow swish, and scattered crackles of atmospherics. */
function staticBuffer(ctx: BaseAudioContext): AudioBuffer {
  const seconds = 4;
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let crackle = 0;
  let crackleDecay = 0.99;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    // Paul Kellet's pink filter.
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
    // Sferics: rare sharp clicks that ring down in a millisecond or two.
    if (Math.random() < 9 / ctx.sampleRate) {
      crackle = (Math.random() * 0.8 + 0.2) * (Math.random() < 0.5 ? -1 : 1);
      crackleDecay = 0.985 + Math.random() * 0.01;
    }
    crackle *= crackleDecay;
    const t = i / ctx.sampleRate;
    const swish = 0.75 + 0.25 * Math.sin(2 * Math.PI * (t / seconds) * 3 + Math.sin(t * 1.7));
    d[i] = pink * swish + crackle * (Math.random() * 0.6 + 0.4);
  }
  // Crossfade the ends so the loop has no seam.
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    d[i] = d[i] * a + d[n - fade + i] * (1 - a);
  }
  return buf;
}

function softClip(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export class Engine {
  ctx: AudioContext | null = null;
  onAir: OnAir = 'idle';
  /** Called whenever the station's state changes. */
  onState: (state: OnAir) => void = () => {};

  private feed: HTMLAudioElement;
  private raw: HTMLAudioElement;
  private active: HTMLAudioElement | null = null;
  private token = 0;
  private volume = 0.6;
  private tone = 0.45;
  private powered = false;
  private hidden = false;

  private master!: GainNode;
  private valves!: GainNode;
  private toneFilter!: BiquadFilterNode;
  private staticGain!: GainNode;
  private whistle!: OscillatorNode;
  private whistleGain!: GainNode;
  private stationGain!: GainNode;
  private rawLevel = 0;

  constructor(feed: HTMLAudioElement, raw: HTMLAudioElement) {
    this.feed = feed;
    this.raw = raw;
    for (const el of [feed, raw]) {
      el.addEventListener('playing', () => {
        if (el === this.active && this.onAir === 'loading') this.set('playing');
      });
      el.addEventListener('error', () => {
        if (el === this.active && this.onAir !== 'idle') this.failOrRetry(el);
      });
    }
  }

  private build() {
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.4;
    this.master = ctx.createGain();
    this.master.gain.value = this.volumeGain();
    this.master.connect(comp).connect(ctx.destination);

    // Everything the set produces passes the valves (warm-up and switch-off) and the tone control.
    this.valves = ctx.createGain();
    this.valves.gain.value = 0;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;
    hp.Q.value = 0.6;
    this.toneFilter = ctx.createBiquadFilter();
    this.toneFilter.type = 'lowpass';
    this.toneFilter.Q.value = 0.5;
    this.toneFilter.frequency.value = this.toneHz();
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 220;
    body.Q.value = 0.9;
    body.gain.value = 2.5;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(1.3);
    shaper.oversample = '2x';
    this.valves.connect(hp).connect(body).connect(this.toneFilter).connect(shaper).connect(this.master);

    // Between stations: hiss and crackle, kept in the band an AM set passes.
    const noise = ctx.createBufferSource();
    noise.buffer = staticBuffer(ctx);
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400;
    band.Q.value = 0.35;
    this.staticGain = ctx.createGain();
    this.staticGain.gain.value = 0;
    noise.connect(band).connect(this.staticGain).connect(this.valves);
    noise.start();

    // A carrier just off tune beats against the set's oscillator: a whistle that falls to nothing at the centre.
    this.whistle = ctx.createOscillator();
    this.whistle.type = 'sine';
    this.whistle.frequency.value = 2000;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.whistle.connect(this.whistleGain).connect(this.valves);
    this.whistle.start();

    this.stationGain = ctx.createGain();
    this.stationGain.gain.value = 0;
    this.stationGain.connect(this.valves);
    const src = ctx.createMediaElementSource(this.feed);
    src.connect(this.stationGain);
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 512;
    this.stationGain.connect(this.meter);
  }

  private meter: AnalyserNode | null = null;
  private meterBuf = new Float32Array(512);

  /** The live station's level (RMS, roughly 0 to 0.3), which the magic eye flickers with. */
  level(): number {
    if (!this.meter || this.onAir !== 'playing') return 0;
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let sum = 0;
    for (const v of this.meterBuf) sum += v * v;
    return Math.sqrt(sum / this.meterBuf.length);
  }

  private volumeGain() {
    // A knob taper: most of the travel is in the quiet half.
    return this.volume * this.volume * 0.9;
  }

  private toneHz() {
    return 2200 * Math.pow(12000 / 2200, this.tone);
  }

  async powerOn() {
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    await ctx.resume();
    this.powered = true;
    const t = ctx.currentTime;
    this.valves.gain.cancelScheduledValues(t);
    this.valves.gain.setValueAtTime(this.valves.gain.value, t);
    // Valves take a few seconds to come up to temperature.
    this.valves.gain.setTargetAtTime(1, t + 0.8, 0.9);
  }

  powerOff() {
    this.powered = false;
    this.stop();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.valves.gain.cancelScheduledValues(t);
    this.valves.gain.setValueAtTime(this.valves.gain.value, t);
    this.valves.gain.setTargetAtTime(0, t, 0.12);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(this.volumeGain(), this.ctx.currentTime, 0.03);
    this.applyRaw();
  }

  setTone(v: number) {
    this.tone = v;
    if (this.ctx) this.toneFilter.frequency.setTargetAtTime(this.toneHz(), this.ctx.currentTime, 0.03);
  }

  setHidden(hidden: boolean) {
    this.hidden = hidden;
  }

  /**
   * The field at the needle, each frame: `s` is how squarely a carrier is tuned (0 to 1), `d` how far
   * off it is in degrees, `carrier` whether there is one near at all, and `calm` (1 down to about
   * 0.3) how far the hiss has settled while the dial sits untouched between stations.
   */
  field(s: number, d: number, carrier: boolean, calm = 1) {
    if (!this.ctx || !this.powered) return;
    const t = this.ctx.currentTime;
    const live = this.onAir === 'playing';
    // Static gives way as a live station comes in, and only partly while one is still connecting.
    const capture = live ? s : s * 0.35;
    let hiss = 0.16 * (1 - capture) * (1 - capture) * (live ? 1 : calm);
    // A background tab between stations goes quiet; a station keeps playing.
    if (this.hidden && !live) hiss = 0;
    this.staticGain.gain.setTargetAtTime(hiss, t, 0.05);

    const ad = Math.abs(d);
    let w = carrier ? 0.032 * (1 - Math.exp(-((ad / 0.035) ** 2))) * Math.exp(-((ad / 0.42) ** 2)) : 0;
    if (this.hidden) w = 0;
    this.whistleGain.gain.setTargetAtTime(w, t, 0.03);
    this.whistle.frequency.setTargetAtTime(40 + ad * 7800, t, 0.02);

    const g = live ? Math.pow(s, 1.6) : 0;
    this.stationGain.gain.setTargetAtTime(g * 0.8, t, 0.06);
    this.rawLevel = g;
    this.applyRaw();
  }

  private applyRaw() {
    if (this.active === this.raw) this.raw.volume = Math.min(1, this.rawLevel * this.volumeGain() * 0.8);
  }

  private set(state: OnAir) {
    this.onAir = state;
    this.onState(state);
  }

  /** Tune in a station. Asks the directory for its current address, which also counts a listen. */
  async play(station: StationRef) {
    const token = ++this.token;
    this.halt();
    this.set('loading');
    let url = station.url;
    try {
      const res = await fetch(`${API}/json/url/${encodeURIComponent(station.id)}`, {
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const body: unknown = await res.json();
        const fresh = body && typeof body === 'object' && 'url' in body ? (body as { url: unknown }).url : null;
        if (typeof fresh === 'string' && safeUrl(fresh)) url = fresh;
      }
    } catch {}
    if (token !== this.token) return;
    this.start(station.cors && this.ctx ? this.feed : this.raw, url, token);
  }

  private start(el: HTMLAudioElement, url: string, token: number) {
    if (!safeUrl(url)) {
      this.set('failed');
      return;
    }
    this.active = el;
    el.dataset.url = url;
    el.src = url;
    if (el === this.raw) this.applyRaw();
    el.play().catch(() => {});
    // A station that hasn't started in ten seconds isn't going to.
    window.setTimeout(() => {
      if (token === this.token && this.active === el && this.onAir === 'loading') this.failOrRetry(el);
    }, 10000);
  }

  private failOrRetry(el: HTMLAudioElement) {
    const url = el.dataset.url;
    // A stream that refused CORS can still play without it, just not through the tone.
    if (el === this.feed && url) {
      this.halt();
      this.start(this.raw, url, this.token);
      return;
    }
    this.halt();
    this.set('failed');
  }

  private halt() {
    for (const el of [this.feed, this.raw]) {
      if (!el.getAttribute('src')) continue;
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.active = null;
    if (this.ctx) this.stationGain.gain.setValueAtTime(0, this.ctx.currentTime);
  }

  /** Hang up on the current station. */
  stop() {
    this.token++;
    this.halt();
    if (this.onAir !== 'idle') this.set('idle');
  }
}

function safeUrl(u: string): boolean {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
}
