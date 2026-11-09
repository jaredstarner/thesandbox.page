// The reel: a short piece for two channels, written so the score and the picture are the
// same signal. The first section is pure sine tones, so the figures are simple and the
// sound is soft. Then the picture itself becomes the bass: a path redrawn 110 times a second
// is a 110 Hz note, its corners are the note's buzz, and the notes change without the picture
// changing. Drums go in as signal too, so the kick throws the image along the diagonal and
// the noise fuzzes the line.

import { Path } from './_path';
import { buildScene, type SceneId } from './_scenes';

const BPM = 92;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
export const REEL_BARS = 65;
export const REEL_SECONDS = REEL_BARS * BAR;

const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Caption text by bar, read by the page. */
export const CUES: { bar: number; text: string }[] = [
  { bar: 0, text: 'One dot of light, centred. No signal.' },
  { bar: 1, text: 'A note on the left channel only. The dot runs sideways, too fast to see as a dot.' },
  { bar: 2, text: 'The same note on the right channel as well. The dot now runs up and down too: a diagonal.' },
  { bar: 3, text: 'Delay the right channel by a quarter of a cycle and the line opens into a circle.' },
  { bar: 5, text: 'Now a different note on each side. The ratio between them sets the figure: 2 to 1.' },
  { bar: 6, text: '3 to 2, a fifth.' },
  { bar: 7, text: '4 to 3, a fourth.' },
  { bar: 8, text: '5 to 3, a major sixth.' },
  { bar: 9, text: '5 to 4, a major third.' },
  { bar: 10, text: '6 to 5, a minor third.' },
  { bar: 11, text: 'Chords that die away. The figures spiral in as they fade, the way a harmonograph draws.' },
  { bar: 19, text: 'A shape retraced 110 times a second is a 110 Hz note. Its corners are the buzz you hear.' },
  { bar: 23, text: 'The kick is in the signal too: it throws the whole picture along the diagonal.' },
  { bar: 27, text: 'A tesseract: all 32 edges in a single pass of the beam, once per cycle of the note.' },
  { bar: 31, text: 'The fine ripple along the lines is the melody, a small circle riding on the beam.' },
  { bar: 35, text: 'A torus knot needs no jumps, so there is no faint line where the beam crosses.' },
  { bar: 43, text: 'One spiral down the tunnel and another back up. The bend is the two channels drifting.' },
  { bar: 47, text: 'Ridges, one after another, drawn back and forth without the beam ever having to jump.' },
  { bar: 51, text: 'Every coast takes so long to draw that the note falls to 55 Hz and below. So it flickers.' },
  { bar: 59, text: 'This is what the address sounds like.' },
  { bar: 62, text: 'Back to one note.' },
  { bar: 64, text: 'Back to one dot.' },
];

interface Section {
  from: number;
  id: SceneId;
  /** Semitones above each bar's root, by eighth note. */
  pattern: number[];
  octave: number;
}

const FLAT = [0, 0, 0, 0, 0, 0, 0, 0];
const SECTIONS: Section[] = [
  { from: 19, id: 'cube', pattern: [0, 0, 12, 0, 7, 0, 12, 7], octave: 0 },
  { from: 27, id: 'tesseract', pattern: [0, 0, 0, 7, 0, 0, 12, 7], octave: 0 },
  { from: 35, id: 'knot23', pattern: [0, 7, 12, 7, 0, 7, 12, 19], octave: 0 },
  { from: 37, id: 'knot34', pattern: [0, 7, 12, 7, 0, 7, 12, 19], octave: 0 },
  { from: 39, id: 'knot25', pattern: [0, 7, 12, 7, 0, 7, 12, 19], octave: 0 },
  { from: 41, id: 'knot35', pattern: [0, 7, 12, 7, 0, 12, 7, 19], octave: 0 },
  { from: 43, id: 'tunnel', pattern: [0, 0, 12, 0, 0, 7, 0, 12], octave: 0 },
  { from: 47, id: 'ridge', pattern: [0, 0, 12, 0, 0, 7, 0, 12], octave: -12 },
  { from: 51, id: 'earth', pattern: FLAT, octave: -12 },
  { from: 59, id: 'title', pattern: FLAT, octave: -12 },
];

const ROOTS = [45, 41, 48, 43]; // A2 F2 C3 G2
const CHORDS = [
  [57, 64, 72], // A E C
  [53, 60, 69], // F C A
  [60, 67, 76], // C G E
  [55, 62, 71], // G D B
];

// By eighth note: a pitch, 0 to rest, -1 to hold.
const TUNE: number[][] = [
  [76, -1, -1, 74, 72, -1, 69, -1],
  [72, -1, -1, 69, 65, -1, 69, -1],
  [67, -1, -1, 72, 76, -1, 72, -1],
  [74, -1, -1, 71, 67, -1, 74, -1],
  [76, -1, 79, -1, 76, 74, 72, -1],
  [72, -1, -1, 69, 77, -1, 76, 72],
  [67, -1, 72, -1, 76, -1, 84, -1],
  [83, -1, 79, -1, 74, -1, 71, -1],
];
const SLOW_TUNE = [76, 72, 79, 74, 76, 77, 79, 74];

const RATIOS = [2, 3 / 2, 4 / 3, 5 / 3, 5 / 4, 6 / 5];

const pulse = (bar: number, a: number, b: number) => smooth(a, b, bar);

interface Bell {
  f: number;
  ph: number;
  env: number;
  decay: number;
  gx: number;
  gy: number;
}

export class Reel {
  t = 0;
  playing = false;
  private readonly dt: number;
  private readonly a = new Path(4000);
  private readonly b = new Path(4000);
  private idA: SceneId | null = null;
  private idB: SceneId | null = null;
  private mix = 0;
  private ph = 0;
  private f = 110;
  private phX = 0;
  private phY = 0;
  private fy = 220;
  private fyTarget = 220;
  private readonly bells: Bell[] = [];
  private bellNext = 0;
  private lastStep = -1;
  // Drums
  private kickEnv = 0;
  private kickF = 60;
  private kickPh = 0;
  private snareEnv = 0;
  private snarePh = 0;
  private hatEnv = 0;
  private prevNX = 0;
  private prevNY = 0;
  private seed = 12345;
  // Lead and pad
  private leadF = 440;
  private leadTarget = 440;
  private leadPh = 0;
  private leadEnv = 0;
  private leadGate = false;
  private readonly padPh = [0, 0, 0];
  private readonly padF = [220, 330, 523];
  private padGain = 0;
  // A gentle cut, so what a corner does to the sound stays a buzz and doesn't turn to glass.
  private lpX = 0;
  private lpY = 0;
  private readonly lpK: number;
  private readonly lpSharp: number;

  constructor(readonly sr: number) {
    this.dt = 1 / sr;
    this.lpK = 1 - Math.exp((-2 * Math.PI * 8000) / sr);
    this.lpSharp = 1 - Math.exp((-2 * Math.PI * 18000) / sr);
    for (let i = 0; i < 16; i++) this.bells.push({ f: 220, ph: 0, env: 0, decay: 1, gx: 0, gy: 0 });
  }

  play(fromBar = 0): void {
    this.t = fromBar * BAR;
    this.playing = true;
    this.lastStep = Math.floor((this.t / BEAT) * 4) - 1;
    this.idA = null;
    this.idB = null;
    this.ph = 0;
    this.kickEnv = 0;
    this.snareEnv = 0;
    this.hatEnv = 0;
    for (const bell of this.bells) bell.env = 0;
    this.fy = this.fyTarget = 220;
    this.phY = this.phX;
    this.padGain = 0;
    this.lpX = 0;
    this.lpY = 0;
  }

  stop(): void {
    this.playing = false;
  }

  get bar(): number {
    return this.t / BAR;
  }

  private random(): number {
    // xorshift: the reel renders the same every time, which lets the bench check it.
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  }

  private strike(f: number, amp: number, x: boolean, decay = 1.25): void {
    const bell = this.bells[this.bellNext];
    this.bellNext = (this.bellNext + 1) % this.bells.length;
    bell.f = f;
    bell.ph = 0;
    bell.env = 1;
    bell.decay = Math.exp(-this.dt / decay);
    bell.gx = x ? amp : 0;
    bell.gy = x ? 0 : amp;
  }

  private step(step: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = CHORDS[bar % 4];
    // Struck chords: root and fifth across the axes, the rest arriving through the bar.
    if (bar >= 11 && bar < 19) {
      if (s === 0) {
        this.strike(midi(chord[0]), 0.55, true);
        this.strike(midi(chord[1]), 0.55, false);
      }
      if (s === 6) this.strike(midi(chord[2]), 0.3, false);
      if (s === 8) this.strike(midi(chord[0] + 12), 0.34, true);
      if (s === 12) this.strike(midi(chord[1] + 12), 0.24, false);
    }
    // Drums.
    const groove = bar >= 19 && bar < 51;
    if (groove) {
      const four = bar >= 43;
      const kick = four ? s % 4 === 0 : s === 0 || s === 6 || s === 8;
      if (kick) this.kick(four ? 0.09 : bar >= 35 ? 0.06 : 0.09);
      const fill = bar % 8 === 2 && s >= 8 && s % 2 === 0;
      if (s === 4 || s === 12 || fill) this.snare(fill ? 0.7 : 1);
      if (s % 2 === 0 || bar >= 35) this.hat(s % 4 === 2 ? 1 : 0.55);
    }
    // Lead.
    if (s % 2 === 0) {
      const eighth = s / 2;
      if (bar >= 31 && bar < 51) {
        const note = TUNE[((bar - 31) >> 0) % 8][eighth];
        if (note > 0) {
          this.leadTarget = midi(note);
          this.leadEnv = Math.max(this.leadEnv, 0.4);
          this.leadGate = true;
        } else if (note === 0) {
          this.leadGate = false;
        }
      } else if (bar >= 51 && bar < 59) {
        if (eighth === 0) {
          this.leadTarget = midi(SLOW_TUNE[bar - 51]);
          this.leadGate = true;
        }
      } else {
        this.leadGate = false;
      }
    }
    for (let i = 0; i < 3; i++) this.padF[i] = midi(chord[i]);
  }

  private kick(amp: number): void {
    this.kickEnv = amp;
    this.kickF = 130;
    this.kickPh = 0;
  }

  private snare(amp: number): void {
    this.snareEnv = 0.032 * amp;
    this.snarePh = 0;
  }

  private hat(amp: number): void {
    this.hatEnv = 0.015 * amp;
  }

  private section(bar: number): void {
    let index = -1;
    for (let i = 0; i < SECTIONS.length; i++) if (bar >= SECTIONS[i].from - 0.5) index = i;
    if (index < 0) {
      this.idA = null;
      this.idB = null;
      this.mix = 0;
      return;
    }
    const cur = SECTIONS[index];
    const prev = index > 0 ? SECTIONS[index - 1] : null;
    this.idB = cur.id;
    this.idA = prev ? prev.id : null;
    // A half-bar either side of each section's start, the two pictures are blended point by
    // point, in time with the beam, so the sound turns into the next sound the same way.
    this.mix = prev ? smooth(cur.from - 0.5, cur.from + 0.5, bar) : 1;
    if (this.mix >= 1) this.idA = null;
  }

  private target(bar: number): number {
    let sec = SECTIONS[0];
    for (const s of SECTIONS) if (bar >= s.from) sec = s;
    const whole = Math.floor(bar);
    const root = ROOTS[whole % 4] + sec.octave;
    const eighth = Math.floor((bar - whole) * 8);
    return midi(root + sec.pattern[eighth]);
  }

  private pathGain(bar: number): number {
    return smooth(18.5, 19.5, bar) * (1 - smooth(61.4, 62.4, bar));
  }

  /** Write `n` samples. Stops itself at the end. */
  render(x: Float32Array, y: Float32Array, n: number, offset = 0): void {
    if (!this.playing) {
      x.fill(0, offset, offset + n);
      y.fill(0, offset, offset + n);
      return;
    }
    const bar = this.bar;
    if (bar >= REEL_BARS) {
      this.playing = false;
      x.fill(0, offset, offset + n);
      y.fill(0, offset, offset + n);
      return;
    }

    // Per-block: where we are in the piece.
    const stepNow = Math.floor((this.t / BEAT) * 4);
    if (stepNow !== this.lastStep) {
      for (let s = this.lastStep + 1; s <= stepNow; s++) this.step(s);
      this.lastStep = stepNow;
    }
    this.section(bar);
    const pg = this.pathGain(bar);
    const fTarget = this.target(bar);
    const padTarget = 0.012 * smooth(19, 21, bar) * (1 - smooth(50, 51, bar));

    // The opening and closing: one note on each axis, faded and phased through the bar.
    const openX = pulse(bar, 1, 1.25) * (1 - pulse(bar, 11, 11.5));
    const openY = pulse(bar, 2, 2.25) * (1 - pulse(bar, 11, 11.5));
    const closeX = pulse(bar, 61.6, 62.4) * (1 - pulse(bar, 64, 64.9));
    const closeY = pulse(bar, 61.6, 62.4) * (1 - pulse(bar, 63, 63.8));
    const ax = Math.max(openX, closeX) * 0.82;
    const ay = Math.max(openY, closeY) * 0.82;
    const whole = Math.floor(bar);
    if (bar >= 4.5 && bar < 11) {
      this.fyTarget = 220 * RATIOS[Math.min(whole - 5, RATIOS.length - 1) < 0 ? 0 : Math.min(whole - 5, 5)] * 1.0003;
    } else {
      this.fyTarget = 220;
    }
    // Quarter-cycle delay arrives through bar 3 and stays until the intervals take over.
    const delta = (Math.PI / 2) * smooth(3, 4, bar);
    const locked = bar < 4.5 || bar >= 61;

    // Glides are written per sample at 48 kHz; devices can run at other rates.
    const q = 48000 / this.sr;
    const kF = 0.0006 * q;
    // Pictures with jumps get a sharper edge, so the jumps stay fast and faint.
    const dec = bar >= 51 && bar < 62 ? this.lpSharp : this.lpK;
    const leadOn = bar >= 31 && bar < 59;
    const leadLevel = bar >= 51 ? 0.012 : bar >= 43 ? 0.02 : bar >= 35 ? 0.032 : 0.028;

    const kickDecay = Math.exp(-this.dt / 0.11);
    const kickDrop = Math.exp(-this.dt / 0.035);
    const snareDecay = Math.exp(-this.dt / 0.05);
    const hatDecay = Math.exp(-this.dt / 0.012);
    const TAU = Math.PI * 2;

    for (let i = 0; i < n; i++) {
      let px = 0;
      let py = 0;

      // The path, which is also the bass.
      if (pg > 0.0005 && (this.idA || this.idB)) {
        this.f += (fTarget - this.f) * 0.002 * q;
        this.ph += this.f * this.dt;
        if (this.ph >= 1 || this.a.n + this.b.n === 0) {
          this.ph %= 1;
          if (this.idA) buildScene(this.idA, this.a, this.t);
          if (this.idB) buildScene(this.idB, this.b, this.t);
        }
        let sx = 0;
        let sy = 0;
        if (this.idB) {
          this.b.sample(this.ph);
          sx = this.b.x;
          sy = this.b.y;
        }
        if (this.idA && this.mix < 1) {
          this.a.sample(this.ph);
          const m = this.idB ? this.mix : 0;
          sx = this.a.x + (sx - this.a.x) * m;
          sy = this.a.y + (sy - this.a.y) * m;
        }
        const duck = 1 - this.kickEnv * 1.6;
        px += sx * pg * duck * 0.88;
        py += sy * pg * duck * 0.88;
      }

      // The opening notes.
      if (ax + ay > 0.0005) {
        this.phX += 220 * this.dt;
        if (this.phX >= 1) this.phX -= 1;
        this.fy += (this.fyTarget - this.fy) * kF;
        if (locked) {
          this.phY = this.phX + delta / TAU;
        } else {
          this.phY += this.fy * this.dt;
          if (this.phY >= 1) this.phY -= 1;
        }
        px += ax * Math.sin(TAU * this.phX);
        py += ay * Math.sin(TAU * this.phY);
      }

      // The struck chords.
      for (let b = 0; b < this.bells.length; b++) {
        const bell = this.bells[b];
        if (bell.env < 0.0008) continue;
        bell.ph += bell.f * this.dt;
        if (bell.ph >= 1) bell.ph -= 1;
        // A soft touch on the way in stops the strike clicking.
        const s = Math.sin(TAU * bell.ph) * bell.env;
        px += bell.gx * s;
        py += bell.gy * s;
        bell.env *= bell.decay;
      }

      // Pad: the chord, very small on the tube, so it thickens the line.
      this.padGain += (padTarget - this.padGain) * 0.0004 * q;
      if (this.padGain > 0.0005) {
        for (let v = 0; v < 3; v++) {
          this.padPh[v] += this.padF[v] * this.dt;
          if (this.padPh[v] >= 1) this.padPh[v] -= 1;
        }
        px += this.padGain * (Math.sin(TAU * this.padPh[0]) + Math.sin(TAU * this.padPh[2]));
        py += this.padGain * (Math.sin(TAU * this.padPh[1]) + Math.cos(TAU * this.padPh[0]));
      }

      // Lead: a small circle riding on the beam.
      const leadWant = leadOn && this.leadGate ? leadLevel : 0;
      this.leadEnv += (leadWant - this.leadEnv) * (leadWant > this.leadEnv ? 0.004 : 0.0006) * q;
      if (this.leadEnv > 0.0004) {
        this.leadF += (this.leadTarget - this.leadF) * 0.002 * q;
        this.leadPh += this.leadF * this.dt;
        if (this.leadPh >= 1) this.leadPh -= 1;
        px += this.leadEnv * Math.sin(TAU * this.leadPh);
        py += this.leadEnv * Math.cos(TAU * this.leadPh);
      }

      // Kick: both channels together, so the picture lurches along the diagonal.
      if (this.kickEnv > 0.0005) {
        this.kickF = 46 + (this.kickF - 46) * kickDrop;
        this.kickPh += this.kickF * this.dt;
        const s = this.kickEnv * Math.sin(TAU * this.kickPh);
        px += s;
        py += s;
        this.kickEnv *= kickDecay;
      }

      // Snare and hats: short noise, different on each side, which is why the line fuzzes.
      if (this.snareEnv > 0.0005 || this.hatEnv > 0.0005) {
        const nx = this.random();
        const ny = this.random();
        const hx = (nx - this.prevNX) * 0.5;
        const hy = (ny - this.prevNY) * 0.5;
        this.prevNX = nx;
        this.prevNY = ny;
        this.snarePh += 195 * this.dt;
        const tone = Math.sin(TAU * this.snarePh) * this.snareEnv * 1.8;
        px += nx * this.snareEnv + hx * this.hatEnv + tone;
        py += ny * this.snareEnv + hy * this.hatEnv + tone;
        this.snareEnv *= snareDecay;
        this.hatEnv *= hatDecay;
      }

      this.lpX += (px - this.lpX) * dec;
      this.lpY += (py - this.lpY) * dec;
      x[offset + i] = this.lpX;
      y[offset + i] = this.lpY;
      this.t += this.dt;
    }
  }
}
