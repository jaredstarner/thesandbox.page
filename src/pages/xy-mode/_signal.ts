// The one signal. Everything that reaches the tube and the speakers is produced here, sample
// by sample, as a left channel (x) and a right channel (y). It has no DOM and no Web Audio in
// it, so it runs in an AudioWorklet when there is sound, on the page when there isn't, and in
// Node for the bench.

import { Path } from './_path';
import { Reel } from './_reel';

export type Mode = 'idle' | 'reel' | 'keys' | 'loop' | 'listen';
export type BenchName = 'treble' | 'bass' | 'drive' | 'crush' | 'echo' | 'spin' | 'width';

export type Command =
  | { type: 'mode'; mode: Mode }
  | { type: 'bench'; name: BenchName; value: number }
  | { type: 'pointer'; x: number; y: number }
  | { type: 'reel'; action: 'play' | 'stop'; bar?: number }
  | { type: 'note'; midi: number; on: boolean }
  | { type: 'notes'; midis: number[] }
  | { type: 'tuning'; just: boolean }
  | { type: 'turn'; value: number }
  | { type: 'path'; xs: number[]; ys: number[]; pens: number[]; closed: boolean }
  | { type: 'pitch'; freq: number }
  | { type: 'gate'; on: boolean }
  | { type: 'twist'; ms: number };

export interface Status {
  bar: number;
  playing: boolean;
}

export const midiToFreq = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** Five-limit ratios by semitone above the lowest note held, as numerator and denominator. */
export const JUST_RATIOS: [number, number][] = [
  [1, 1],
  [16, 15],
  [9, 8],
  [6, 5],
  [5, 4],
  [4, 3],
  [45, 32],
  [3, 2],
  [8, 5],
  [5, 3],
  [9, 5],
  [15, 8],
];

/** A note's frequency under the current tuning. Just intonation hangs off the lowest note. */
export function tunedFreq(m: number, lowest: number, just: boolean): number {
  if (!just || m === lowest) return midiToFreq(m);
  const semis = m - lowest;
  const octaves = Math.floor(semis / 12);
  const [num, den] = JUST_RATIOS[semis % 12];
  return midiToFreq(lowest) * 2 ** octaves * (num / den);
}

interface Voice {
  midi: number;
  f: number;
  target: number;
  ph: number;
  env: number;
  on: boolean;
  /** Gain of sin on x, sin on y, and cos on y. A lone note is a circle, so it uses the last. */
  gx: number;
  gy: number;
  hy: number;
  tgx: number;
  tgy: number;
  thy: number;
}

class Keys {
  private readonly voices: Voice[] = [];
  just = false;
  turn = 0;
  private turnNow = 0;
  private readonly attack: number;
  private readonly release: number;
  private readonly dt: number;
  private readonly slew: number;

  constructor(sr: number) {
    this.dt = 1 / sr;
    this.attack = 1 - Math.exp(-1 / (0.03 * sr));
    this.release = 1 - Math.exp(-1 / (0.28 * sr));
    this.slew = 1 - Math.exp(-1 / (0.05 * sr));
    for (let i = 0; i < 8; i++) {
      this.voices.push({
        midi: 0,
        f: 220,
        target: 220,
        ph: 0,
        env: 0,
        on: false,
        gx: 0,
        gy: 0,
        hy: 0,
        tgx: 0,
        tgy: 0,
        thy: 0,
      });
    }
  }

  noteOn(m: number): void {
    if (this.voices.some((v) => v.on && v.midi === m)) return;
    const free = this.voices.reduce((best, v) => (!v.on && v.env < best.env ? v : best), { env: 2 } as Voice);
    const voice = free.env === 2 ? this.voices[0] : free;
    voice.midi = m;
    voice.on = true;
    voice.f = midiToFreq(m);
    voice.target = voice.f;
    voice.ph = 0;
    this.assign();
  }

  noteOff(m: number): void {
    for (const v of this.voices) if (v.on && v.midi === m) v.on = false;
    this.assign();
  }

  setNotes(list: number[]): void {
    for (const v of this.voices) if (v.on && !list.includes(v.midi)) v.on = false;
    for (const m of list) this.noteOn(m);
    this.assign();
  }

  clear(): void {
    for (const v of this.voices) v.on = false;
    this.assign();
  }

  /** Lowest note to x, next to y, and on up. Sums shrink so a chord stays on the screen. */
  assign(): void {
    const held = this.voices.filter((v) => v.on).sort((a, b) => a.midi - b.midi);
    const onX = Math.ceil(held.length / 2);
    const onY = Math.floor(held.length / 2);
    const lowest = held.length ? held[0].midi : 0;
    held.forEach((v, i) => {
      v.target = tunedFreq(v.midi, lowest, this.just);
      if (held.length === 1) {
        v.tgx = 0.8;
        v.tgy = 0;
        v.thy = 0.8;
      } else if (i % 2 === 0) {
        v.tgx = 0.84 / onX;
        v.tgy = 0;
        v.thy = 0;
      } else {
        v.tgx = 0;
        v.tgy = 0.84 / onY;
        v.thy = 0;
      }
    });
  }

  render(x: Float32Array, y: Float32Array, n: number): void {
    const TAU = Math.PI * 2;
    const held = this.voices.filter((v) => v.on).sort((a, b) => a.midi - b.midi);
    // With two just notes the figure freezes wherever the phases happen to meet. Ease it round
    // to where the curve is most open instead of a line folded on itself.
    if (this.just && held.length === 2) {
      const semis = held[1].midi - held[0].midi;
      const [num, den] = JUST_RATIOS[semis % 12];
      const P = num * 2 ** Math.floor(semis / 12);
      // The curve folds onto itself a quarter-turn from its most open position, and which
      // phase that is depends on whether the two whole numbers of the ratio differ by an odd
      // or an even amount: 1:2 opens at 0, where 1:1 opens at a quarter (the circle).
      const open = (P - den) % 2 === 0 ? 0.25 : 0;
      const psi = den * held[1].ph - P * held[0].ph;
      let err = (open - (psi - Math.floor(psi))) % 0.5;
      if (err > 0.25) err -= 0.5;
      if (err < -0.25) err += 0.5;
      held[1].ph += (err * n * 7 * this.dt) / den;
    }
    this.turnNow += (this.turn - this.turnNow) * Math.min(1, n * 12 * this.dt);
    const turn = this.turnNow * TAU;
    for (let i = 0; i < n; i++) {
      let px = 0;
      let py = 0;
      for (let k = 0; k < this.voices.length; k++) {
        const v = this.voices[k];
        v.env += ((v.on ? 1 : 0) - v.env) * (v.on ? this.attack : this.release);
        if (v.env < 0.0004 && !v.on) continue;
        v.gx += (v.tgx - v.gx) * this.slew;
        v.gy += (v.tgy - v.gy) * this.slew;
        v.hy += (v.thy - v.hy) * this.slew;
        v.f += (v.target - v.f) * this.slew * 0.4;
        v.ph += v.f * this.dt;
        if (v.ph >= 1) v.ph -= 1;
        const a = TAU * v.ph;
        px += v.env * v.gx * Math.sin(a);
        py += v.env * (v.gy * Math.sin(a + turn) + v.hy * Math.cos(a));
      }
      x[i] = px;
      y[i] = py;
    }
  }
}

/** A path looped at a pitch: the Draw and Type modes. */
class Looper {
  private current = new Path(6000);
  private pending = new Path(6000);
  private hasPending = false;
  private ph = 0;
  private f = 130.81;
  target = 130.81;
  gate = false;
  private level = 0;
  private readonly dt: number;
  private readonly fade: number;
  private readonly glide: number;

  constructor(sr: number) {
    this.dt = 1 / sr;
    this.fade = 1 - Math.exp(-1 / (0.03 * sr));
    this.glide = 1 - Math.exp(-1 / (0.012 * sr));
  }

  setPath(xs: number[], ys: number[], pens: number[], closed: boolean): void {
    const p = this.pending;
    p.clear();
    for (let i = 0; i < xs.length; i++) {
      if (pens[i]) p.lineTo(xs[i], ys[i]);
      else p.moveTo(xs[i], ys[i]);
    }
    p.finish(closed);
    this.hasPending = true;
  }

  render(x: Float32Array, y: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      this.f += (this.target - this.f) * this.glide;
      this.ph += this.f * this.dt;
      if (this.ph >= 1) {
        this.ph %= 1;
        if (this.hasPending) {
          // Swapped between passes, so an edit never tears the note.
          const spare = this.current;
          this.current = this.pending;
          this.pending = spare;
          this.hasPending = false;
        }
      }
      this.level += ((this.gate && this.current.n > 0 ? 1 : 0) - this.level) * this.fade;
      this.current.sample(this.ph);
      x[i] = this.current.x * this.level;
      y[i] = this.current.y * this.level;
    }
  }
}

/** The knobs: real signal processing, so each one shows up in the picture and in the sound. */
class Bench {
  readonly knobs: Record<BenchName, number> = { treble: 0, bass: 0, drive: 0, crush: 0, echo: 0, spin: 0, width: 0.5 };
  private readonly dt: number;
  private lp = [0, 0, 0, 0];
  private lpc = [1, 0, 0, 0, 0];
  private hp = [0, 0, 0, 0];
  private hpc = [1, 0, 0, 0, 0];
  private lpFc = 0;
  private hpFc = 0;
  private theta = 0;
  private holdLeft = 0;
  private holdX = 0;
  private holdY = 0;
  private readonly dx: Float32Array;
  private readonly dy: Float32Array;
  private write = 0;
  private delay = 0;
  private echoMix = 0;

  constructor(private readonly sr: number) {
    this.dt = 1 / sr;
    const size = Math.ceil(sr * 0.25);
    this.dx = new Float32Array(size);
    this.dy = new Float32Array(size);
  }

  private design(fc: number, high: boolean): number[] {
    const w = (2 * Math.PI * Math.min(fc, this.sr * 0.45)) / this.sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const alpha = sw / (2 * Math.SQRT1_2);
    const a0 = 1 + alpha;
    if (high) return [(1 + cw) / 2 / a0, -(1 + cw) / a0, (1 + cw) / 2 / a0, (-2 * cw) / a0, (1 - alpha) / a0];
    return [(1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0, (-2 * cw) / a0, (1 - alpha) / a0];
  }

  process(x: Float32Array, y: Float32Array, n: number): void {
    const k = this.knobs;
    const TAU = Math.PI * 2;

    const trebleOn = k.treble > 0.001;
    const bassOn = k.bass > 0.001;
    if (trebleOn) {
      const fc = 20000 * (60 / 20000) ** k.treble;
      this.lpFc = this.lpFc ? this.lpFc + (fc - this.lpFc) * 0.2 : fc;
      this.lpc = this.design(this.lpFc, false);
    }
    if (bassOn) {
      const fc = 15 * (2400 / 15) ** k.bass;
      this.hpFc = this.hpFc ? this.hpFc + (fc - this.hpFc) * 0.2 : fc;
      this.hpc = this.design(this.hpFc, true);
    }
    const spinHz = 400 * k.spin * k.spin;
    const dTheta = TAU * spinHz * this.dt;
    const easing = spinHz === 0;
    const width = k.width * 2;
    const driveOn = k.drive > 0.001;
    const g = 1 + 11 * k.drive * k.drive;
    const norm = driveOn ? 1 / Math.tanh(g) : 1;
    const crushOn = k.crush > 0.001;
    const levels = 2 ** (10.5 - 9.2 * k.crush);
    const hold = 1 + Math.floor(36 * k.crush * k.crush);
    const echoTarget = k.echo > 0.001 ? 0.62 * Math.min(1, k.echo * 8) : 0;
    const delayTarget = this.sr * (0.0015 * (180 / 1.5) ** k.echo);
    const size = this.dx.length;
    const [lb0, lb1, lb2, la1, la2] = this.lpc;
    const [hb0, hb1, hb2, ha1, ha2] = this.hpc;

    for (let i = 0; i < n; i++) {
      let px = x[i];
      let py = y[i];

      // Spin turns the stereo field. Fast enough, it is a ring modulator and draws rosettes.
      if (dTheta !== 0 || this.theta !== 0) {
        this.theta += dTheta;
        if (this.theta > Math.PI) this.theta -= TAU;
        if (easing) {
          this.theta *= 0.9995;
          if (Math.abs(this.theta) < 1e-4) this.theta = 0;
        }
        const c = Math.cos(this.theta);
        const s = Math.sin(this.theta);
        const rx = px * c - py * s;
        py = px * s + py * c;
        px = rx;
      }

      // Width: pull left and right together and a stereo picture folds onto the diagonal.
      if (width !== 1) {
        const m = (px + py) * 0.5;
        const d = (px - py) * 0.5 * width;
        px = m + d;
        py = m - d;
      }

      if (driveOn) {
        px = Math.tanh(px * g) * norm;
        py = Math.tanh(py * g) * norm;
      }

      if (bassOn) {
        const ox = hb0 * px + this.hp[0];
        this.hp[0] = hb1 * px - ha1 * ox + this.hp[1];
        this.hp[1] = hb2 * px - ha2 * ox;
        const oy = hb0 * py + this.hp[2];
        this.hp[2] = hb1 * py - ha1 * oy + this.hp[3];
        this.hp[3] = hb2 * py - ha2 * oy;
        px = ox;
        py = oy;
      }

      if (trebleOn) {
        const ox = lb0 * px + this.lp[0];
        this.lp[0] = lb1 * px - la1 * ox + this.lp[1];
        this.lp[1] = lb2 * px - la2 * ox;
        const oy = lb0 * py + this.lp[2];
        this.lp[2] = lb1 * py - la1 * oy + this.lp[3];
        this.lp[3] = lb2 * py - la2 * oy;
        px = ox;
        py = oy;
      }

      if (crushOn) {
        if (this.holdLeft <= 0) {
          this.holdX = Math.round(px * levels) / levels;
          this.holdY = Math.round(py * levels) / levels;
          this.holdLeft = hold;
        }
        this.holdLeft--;
        px = this.holdX;
        py = this.holdY;
      }

      this.echoMix += (echoTarget - this.echoMix) * 0.002;
      if (this.echoMix > 0.0005) {
        this.delay += (delayTarget - this.delay) * 0.0004;
        const read = this.write - this.delay;
        const r0 = Math.floor(read);
        const frac = read - r0;
        const a = ((r0 % size) + size) % size;
        const b = (a + 1) % size;
        const ex = this.dx[a] + (this.dx[b] - this.dx[a]) * frac;
        const ey = this.dy[a] + (this.dy[b] - this.dy[a]) * frac;
        this.dx[this.write] = px + ex * 0.28;
        this.dy[this.write] = py + ey * 0.28;
        const scale = 1 / (1 + this.echoMix * 0.55);
        px = (px + ex * this.echoMix) * scale;
        py = (py + ey * this.echoMix) * scale;
      } else {
        this.delay = delayTarget;
        this.dx[this.write] = px;
        this.dy[this.write] = py;
      }
      this.write = (this.write + 1) % size;

      x[i] = px > 1 ? 1 : px < -1 ? -1 : px;
      y[i] = py > 1 ? 1 : py < -1 ? -1 : py;
    }
  }
}

export class Signal {
  mode: Mode = 'idle';
  private pendingMode: Mode | null = null;
  private pendingBar: number | null = null;
  private fade = 1;
  private readonly fadeStep: number;
  private readonly reel: Reel;
  private readonly keys: Keys;
  private readonly looper: Looper;
  private readonly bench: Bench;
  // The idle dot, following the pointer.
  private tx = 0;
  private ty = 0;
  private dotX = 0;
  private dotY = 0;
  private readonly dotK: number;
  private steered = 0;
  private drift = 0;
  // Listening.
  private readonly twistBuf: Float32Array;
  private twistWrite = 0;
  private twistSamples = 0;
  private diff = 0;
  private energy = 0;
  private readonly sr: number;

  constructor(sr: number) {
    this.sr = sr;
    this.fadeStep = 1 / (0.018 * sr);
    this.reel = new Reel(sr);
    this.keys = new Keys(sr);
    this.looper = new Looper(sr);
    this.bench = new Bench(sr);
    this.dotK = 1 - Math.exp((-2 * Math.PI * 16) / sr);
    this.twistBuf = new Float32Array(Math.ceil(sr * 0.03));
    this.twistSamples = Math.round(0.0012 * sr);
  }

  apply(cmd: Command): void {
    switch (cmd.type) {
      case 'mode':
        if (cmd.mode !== this.mode || this.pendingMode) this.pendingMode = cmd.mode;
        break;
      case 'bench':
        this.bench.knobs[cmd.name] = cmd.value;
        break;
      case 'pointer':
        this.tx = cmd.x;
        this.ty = cmd.y;
        this.steered = 0;
        break;
      case 'reel':
        if (cmd.action === 'stop') {
          this.reel.stop();
        } else if (this.mode === 'reel' && this.reel.playing) {
          // Jumping while it sounds would click, so fade down, jump, and come back up.
          this.pendingBar = cmd.bar ?? 0;
          this.pendingMode = 'reel';
        } else {
          this.reel.play(cmd.bar ?? 0);
        }
        break;
      case 'note':
        if (cmd.on) this.keys.noteOn(cmd.midi);
        else this.keys.noteOff(cmd.midi);
        break;
      case 'notes':
        this.keys.setNotes(cmd.midis);
        break;
      case 'tuning':
        this.keys.just = cmd.just;
        this.keys.assign();
        break;
      case 'turn':
        this.keys.turn = cmd.value;
        break;
      case 'path':
        this.looper.setPath(cmd.xs, cmd.ys, cmd.pens, cmd.closed);
        break;
      case 'pitch':
        this.looper.target = cmd.freq;
        break;
      case 'gate':
        this.looper.gate = cmd.on;
        break;
      case 'twist':
        this.twistSamples = Math.min(this.twistBuf.length - 1, Math.max(1, Math.round((cmd.ms / 1000) * this.sr)));
        break;
    }
  }

  get sampleRateValue(): number {
    return this.sr;
  }

  status(): Status {
    return { bar: this.reel.bar, playing: this.reel.playing };
  }

  /** Move the reel without changing anything else: for checks, and for the progress bar. */
  seekReel(bar: number): void {
    this.reel.play(bar);
  }

  private source(x: Float32Array, y: Float32Array, n: number, inL?: Float32Array, inR?: Float32Array): void {
    switch (this.mode) {
      case 'reel':
        this.reel.render(x, y, n);
        break;
      case 'keys':
        this.keys.render(x, y, n);
        break;
      case 'loop':
        this.looper.render(x, y, n);
        break;
      case 'listen': {
        if (!inL) {
          x.fill(0, 0, n);
          y.fill(0, 0, n);
          break;
        }
        const r = inR ?? inL;
        // A mono source only ever draws a diagonal. Read one channel against itself a moment
        // later instead, and a steady voice or note curls into a loop.
        let d = 0;
        let e = 0;
        for (let i = 0; i < n; i++) {
          d += Math.abs(inL[i] - r[i]);
          e += Math.abs(inL[i]) + Math.abs(r[i]);
        }
        this.diff += (d - this.diff) * 0.08;
        this.energy += (e - this.energy) * 0.08;
        const mono = this.diff <= this.energy * 0.004;
        const size = this.twistBuf.length;
        for (let i = 0; i < n; i++) {
          x[i] = inL[i];
          this.twistBuf[this.twistWrite] = inL[i];
          const back = (this.twistWrite - this.twistSamples + size) % size;
          y[i] = mono ? this.twistBuf[back] : r[i];
          this.twistWrite = (this.twistWrite + 1) % size;
        }
        break;
      }
      default:
        for (let i = 0; i < n; i++) {
          // Left alone, the dot wanders, far too slowly to be heard.
          if (this.steered > this.sr * 4) {
            this.drift += 1 / this.sr;
            this.tx = 0.5 * Math.sin(this.drift * 0.83);
            this.ty = 0.36 * Math.sin(this.drift * 0.57 + 1);
          }
          this.steered++;
          this.dotX += (this.tx - this.dotX) * this.dotK;
          this.dotY += (this.ty - this.dotY) * this.dotK;
          x[i] = this.dotX;
          y[i] = this.dotY;
        }
    }
  }

  /** The whole signal for `n` samples. */
  render(x: Float32Array, y: Float32Array, n: number, inL?: Float32Array, inR?: Float32Array): void {
    this.source(x, y, n, inL, inR);
    if (this.mode !== 'idle') this.bench.process(x, y, n);
    // Crossfade between modes so a change never clicks.
    if (this.pendingMode !== null || this.fade < 1) {
      for (let i = 0; i < n; i++) {
        if (this.pendingMode !== null) {
          this.fade -= this.fadeStep;
          if (this.fade <= 0) {
            this.fade = 0;
            if (this.mode === 'reel' && this.pendingMode !== 'reel') this.reel.stop();
            this.mode = this.pendingMode;
            this.pendingMode = null;
            if (this.pendingBar !== null) {
              this.reel.play(this.pendingBar);
              this.pendingBar = null;
            }
          }
        } else if (this.fade < 1) {
          this.fade = Math.min(1, this.fade + this.fadeStep);
        }
        x[i] *= this.fade;
        y[i] *= this.fade;
      }
    }
  }
}
