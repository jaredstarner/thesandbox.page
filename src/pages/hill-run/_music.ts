// Hill run: the music under each run and on the results card, the stings at the
// bottom, and the crowd and birds on the cheese hill.
//
// A small step sequencer schedules every note on the audio clock a beat ahead, so
// the rhythm holds whatever the frame rate does. Run songs follow your speed: the
// pad opens up and the arpeggio doubles as you go faster, so the music is the
// speedometer rather than a wall of wind.

import type { LevelId } from './_course';

type Arp = 'pluck' | 'bell';
type Lead = 'square' | 'whistle';

export interface Song {
  bpm: number;
  /** Steps per bar: 16 for straight sixteenths, 12 for a jig's triplets. */
  steps: number;
  /** One chord per bar, MIDI notes, root first. */
  chords: number[][];
  pad: number;
  bass: number;
  /** Steps between bass notes. */
  bassEvery: number;
  arp: Arp;
  /** Octaves above the chord the arpeggio sits. */
  arpOct: number;
  /** Notes per bar for the arpeggio, slow to fast; driven songs pick by speed. */
  arpDivs: number[];
  lead?: { voice: Lead; notes: [bar: number, step: number, midi: number, len: number][] };
  drums?: boolean;
  /** Speed drives the arrangement. */
  driven: boolean;
  volume: number;
}

const D = [62, 66, 69];
const Bm = [59, 62, 66];
const G = [55, 59, 62];
const A = [57, 61, 64];
const Em = [52, 55, 59];

export const RUN_SONGS: Record<LevelId, Song> = {
  // A bright morning street: D major, an electric-piano arpeggio over a soft pad.
  bomb: {
    bpm: 100,
    steps: 16,
    chords: [D, Bm, G, A, D, Bm, Em, A],
    pad: 1,
    bass: 1,
    bassEvery: 8,
    arp: 'pluck',
    arpOct: 1,
    arpDivs: [4, 8, 16],
    driven: true,
    volume: 0.6,
  },
  // A lilting jig in F for a country fair, harp-like.
  cheese: {
    bpm: 104,
    steps: 12,
    chords: [
      [53, 57, 60],
      [48, 52, 55],
      [50, 53, 57],
      [46, 50, 53],
      [53, 57, 60],
      [48, 52, 55],
      [46, 50, 53],
      [48, 52, 55],
    ],
    pad: 0.7,
    bass: 0.9,
    bassEvery: 6,
    arp: 'pluck',
    arpOct: 2,
    arpDivs: [4, 6, 12],
    driven: true,
    volume: 0.58,
  },
  // Night ice: A minor, slow, bells over a deep pad.
  luge: {
    bpm: 78,
    steps: 16,
    chords: [
      [57, 60, 64],
      [53, 57, 60],
      [52, 55, 60],
      [55, 59, 62],
      [57, 60, 64],
      [53, 57, 60],
      [55, 59, 62],
      [56, 59, 64],
    ],
    pad: 1.25,
    bass: 0.8,
    bassEvery: 8,
    arp: 'bell',
    arpOct: 1,
    arpDivs: [2, 4, 8],
    driven: true,
    volume: 0.6,
  },
};

const KEY: Record<LevelId, number> = { bomb: 2, cheese: 5, luge: -3 };

function shift(song: Song, k: number): Song {
  return {
    ...song,
    chords: song.chords.map((c) => c.map((n) => n + k)),
    lead: song.lead && { ...song.lead, notes: song.lead.notes.map(([b, s, n, l]) => [b, s, n + k, l]) },
  };
}

/** The results card: an arcade loop after a finish, a slower one after you're caught. */
export function resultSong(level: LevelId, won: boolean): Song {
  const k = KEY[level];
  if (won) {
    return shift(
      {
        bpm: 132,
        steps: 16,
        chords: [
          [60, 64, 67],
          [57, 60, 64],
          [53, 57, 60],
          [55, 59, 62],
        ],
        pad: 0.45,
        bass: 1,
        bassEvery: 4,
        arp: 'pluck',
        arpOct: 1,
        arpDivs: [8],
        drums: true,
        driven: false,
        volume: 0.55,
        lead: {
          voice: 'square',
          notes: [
            [0, 0, 72, 2],
            [0, 2, 76, 2],
            [0, 4, 79, 4],
            [0, 10, 76, 2],
            [0, 12, 77, 2],
            [0, 14, 76, 2],
            [1, 0, 76, 4],
            [1, 4, 72, 2],
            [1, 6, 69, 2],
            [1, 8, 72, 6],
            [2, 0, 69, 2],
            [2, 2, 72, 2],
            [2, 4, 77, 4],
            [2, 8, 76, 2],
            [2, 10, 74, 2],
            [2, 12, 72, 4],
            [3, 0, 71, 2],
            [3, 2, 74, 2],
            [3, 4, 79, 4],
            [3, 8, 77, 2],
            [3, 10, 76, 2],
            [3, 12, 74, 4],
          ],
        },
      },
      k,
    );
  }
  return shift(
    {
      bpm: 92,
      steps: 16,
      chords: [
        [57, 60, 64],
        [53, 57, 60],
        [55, 59, 62],
        [56, 59, 64],
      ],
      pad: 0.8,
      bass: 0.8,
      bassEvery: 8,
      arp: 'pluck',
      arpOct: 1,
      arpDivs: [8],
      driven: false,
      volume: 0.5,
      lead: {
        voice: 'whistle',
        notes: [
          [0, 0, 76, 6],
          [0, 6, 74, 2],
          [0, 8, 72, 8],
          [1, 0, 72, 4],
          [1, 4, 69, 4],
          [1, 8, 72, 8],
          [2, 0, 71, 6],
          [2, 6, 72, 2],
          [2, 8, 74, 8],
          [3, 0, 76, 8],
          [3, 8, 68, 8],
        ],
      },
    },
    k,
  );
}

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

interface Playing {
  song: Song;
  bus: GainNode;
  padF: BiquadFilterNode;
  arpF: BiquadFilterNode;
  step: number;
  next: number;
  leads: Map<string, [number, number]>;
}

export class Music {
  /** How hard you're going, 0 to 1, for driven songs. */
  target = 0;
  private level = 0;
  private now: Playing | null = null;

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
    private noise: AudioBuffer,
  ) {}

  /** Start a song at a time on the audio clock, fading out whatever was playing. */
  play(song: Song, at = this.ctx.currentTime + 0.05): void {
    this.stop(0.5);
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.value = song.volume;
    bus.connect(this.out);
    const padF = ctx.createBiquadFilter();
    padF.type = 'lowpass';
    padF.frequency.value = song.driven ? 400 : 2200;
    padF.Q.value = 0.6;
    padF.connect(bus);
    const arpF = ctx.createBiquadFilter();
    arpF.type = 'lowpass';
    arpF.frequency.value = song.driven ? 1200 : 4200;
    arpF.connect(bus);
    const leads = new Map<string, [number, number]>();
    for (const [b, s, n, l] of song.lead?.notes ?? []) leads.set(`${b}:${s}`, [n, l]);
    this.now = { song, bus, padF, arpF, step: 0, next: at, leads };
  }

  stop(fade = 0.5): void {
    const p = this.now;
    if (!p) return;
    this.now = null;
    const t = this.ctx.currentTime;
    p.bus.gain.cancelScheduledValues(t);
    p.bus.gain.setValueAtTime(p.bus.gain.value, t);
    p.bus.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => p.bus.disconnect(), (fade + 2) * 1000);
  }

  /** Call every frame: eases the speed in and schedules the next notes. */
  tick(dt: number): void {
    const p = this.now;
    if (!p) return;
    const ctx = this.ctx;
    const s = p.song;
    // Ease toward the target over about a second, so a bump doesn't flip the arrangement.
    this.level += (this.target - this.level) * Math.min(1, dt * 1.2);
    const i = s.driven ? this.level : 1;
    const t = ctx.currentTime;
    if (s.driven) {
      p.padF.frequency.setTargetAtTime(380 + 2600 * i ** 1.2, t, 0.3);
      p.arpF.frequency.setTargetAtTime(1100 + 3800 * i, t, 0.3);
    }
    // After a stall (a hidden tab), skip ahead rather than play the backlog at once.
    if (p.next < t - 0.1) p.next = t + 0.05;
    const stepDur = 60 / s.bpm / (s.steps / 4);
    while (p.next < t + 0.2) {
      this.schedule(p, p.step, p.next, i);
      p.next += stepDur;
      p.step++;
    }
  }

  private schedule(p: Playing, n: number, t: number, i: number): void {
    const s = p.song;
    const bars = s.chords.length;
    const bar = Math.floor(n / s.steps) % bars;
    const pos = n % s.steps;
    const chord = s.chords[bar];
    const stepDur = 60 / s.bpm / (s.steps / 4);
    const barDur = stepDur * s.steps;

    if (pos === 0) for (const note of chord) this.padNote(note, t, barDur, 0.035 * s.pad, p.padF);

    if (pos % s.bassEvery === 0) {
      const fifth = pos !== 0 && s.bassEvery >= s.steps / 2;
      const note = (fifth ? chord[2] : chord[0]) - 24;
      this.bass(note, t, stepDur * Math.min(s.bassEvery, 6), 0.16 * s.bass);
    }
    // Faster, the bass picks up a walking note before the bar turns.
    if (s.driven && i > 0.6 && pos === s.steps - s.steps / 4) this.bass(chord[1] - 24, t, stepDur * 2, 0.11 * s.bass);

    const divs = s.arpDivs;
    const div = s.driven ? divs[i < 0.28 ? 0 : i < 0.62 ? 1 : divs.length - 1] : divs[0];
    const stride = s.steps / div;
    if (Number.isInteger(stride) && pos % stride === 0) {
      const k = pos / stride + bar * div;
      const tones = [chord[0], chord[1], chord[2], chord[0] + 12, chord[2], chord[1]];
      const note = tones[k % tones.length] + 12 * s.arpOct;
      const vel = s.driven ? 0.45 + 0.55 * i : 0.6;
      if (s.arp === 'bell') this.bell(note, t, vel, p.arpF);
      else this.pluck(note, t, vel, p.arpF);
    }

    // Off-beat ticks once you're really moving.
    const beat = s.steps / 4;
    if (s.driven && i > 0.55 && pos % beat === Math.floor(beat / 2)) this.tickHat(t, 0.02 * (i - 0.4));

    if (s.drums) {
      if (pos % (s.steps / 2) === 0) this.kick(t, 0.32);
      if (pos % (s.steps / 2) === s.steps / 4) this.clap(t, 0.06);
      if (pos % 2 === 1) this.tickHat(t, 0.012);
    }

    const lead = p.leads.get(`${bar}:${pos}`);
    if (lead && s.lead) this.lead(lead[0], t, lead[1] * stepDur, s.lead.voice, p.bus);
  }

  // ------------------------------------------------------------ voices

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private osc(type: OscillatorType, f: number, t: number, end: number, dest: AudioNode, level = 1): OscillatorNode {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    if (level !== 1) {
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(dest);
    } else o.connect(dest);
    o.start(t);
    o.stop(end);
    return o;
  }

  private padNote(m: number, t: number, dur: number, lvl: number, dest: AudioNode): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + 0.4);
    g.gain.setValueAtTime(lvl, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.6);
    g.connect(dest);
    const f = mtof(m);
    this.osc('triangle', f * 1.0035, t, t + dur + 0.7, g);
    this.osc('triangle', f / 1.0035, t, t + dur + 0.7, g);
  }

  private pluck(m: number, t: number, vel: number, dest: AudioNode): void {
    const g = this.ctx.createGain();
    this.env(g, t, 0.1 * vel, 0.004, 0.5);
    g.connect(dest);
    const f = mtof(m);
    this.osc('sine', f, t, t + 0.6, g);
    this.osc('triangle', f * 2, t, t + 0.6, g, 0.25);
  }

  private bell(m: number, t: number, vel: number, dest: AudioNode): void {
    const ctx = this.ctx;
    const f = mtof(m);
    const g = ctx.createGain();
    this.env(g, t, 0.08 * vel, 0.003, 1.6);
    g.connect(dest);
    this.osc('sine', f, t, t + 1.7, g);
    const g2 = ctx.createGain();
    this.env(g2, t, 0.025 * vel, 0.002, 0.45);
    g2.connect(dest);
    this.osc('sine', f * 2.76, t, t + 0.5, g2);
  }

  private bass(m: number, t: number, dur: number, lvl: number): void {
    const p = this.now!;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + 0.012);
    g.gain.exponentialRampToValueAtTime(lvl * 0.45, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(p.bus);
    const f = mtof(m);
    this.osc('sine', f, t, t + dur + 0.05, g);
    this.osc('triangle', f, t, t + dur + 0.05, g, 0.22);
  }

  private lead(m: number, t: number, dur: number, voice: Lead, dest: AudioNode): void {
    const ctx = this.ctx;
    const f = mtof(m);
    const o = ctx.createOscillator();
    o.type = voice === 'square' ? 'square' : 'sine';
    o.frequency.value = f;
    // A little vibrato on held notes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f * (voice === 'square' ? 0.004 : 0.008), t + Math.min(dur, 0.25));
    lfo.connect(depth).connect(o.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = voice === 'square' ? 2200 : 5000;
    const g = ctx.createGain();
    const lvl = voice === 'square' ? 0.045 : 0.08;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + 0.01);
    g.gain.setValueAtTime(lvl * 0.8, t + Math.max(0.02, dur - 0.05));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp).connect(g).connect(dest);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.02);
    lfo.stop(t + dur + 0.02);
  }

  private tickHat(t: number, lvl: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = ctx.createGain();
    this.env(g, t, lvl, 0.001, 0.03);
    src.connect(f).connect(g).connect(this.now!.bus);
    src.start(t, Math.random());
    src.stop(t + 0.05);
  }

  private kick(t: number, lvl: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    this.env(g, t, lvl, 0.002, 0.18);
    o.connect(g).connect(this.now!.bus);
    o.start(t);
    o.stop(t + 0.22);
  }

  private clap(t: number, lvl: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500;
    f.Q.value = 1;
    const g = ctx.createGain();
    this.env(g, t, lvl, 0.002, 0.09);
    src.connect(f).connect(g).connect(this.now!.bus);
    src.start(t, Math.random());
    src.stop(t + 0.12);
  }

  // ------------------------------------------------------------ stings

  /** A brass call up the chord and a held major chord. Returns when it ends. */
  fanfare(level: LevelId, t = this.ctx.currentTime + 0.02): number {
    const root = 60 + KEY[level];
    const steps = [0, 4, 7, 12];
    steps.forEach((s, i) => this.brass(root + s, t + i * 0.11, 0.1, 0.07));
    const hold = t + steps.length * 0.11;
    for (const s of [0, 4, 7, 12, 16]) this.brass(root + s, hold, 1.3, 0.045);
    return hold + 1.5;
  }

  /** The falling "wah wah" when you're caught. Returns when it ends. */
  wahwah(level: LevelId, t = this.ctx.currentTime + 0.02): number {
    const root = 60 + KEY[level];
    const notes = [7, 6, 5];
    notes.forEach((s, i) => this.brass(root + s, t + i * 0.34, 0.3, 0.05, 900));
    const last = t + notes.length * 0.34;
    this.brass(root + 4, last, 0.9, 0.05, 900, -0.6);
    return last + 1;
  }

  private brass(m: number, t: number, dur: number, lvl: number, cut = 2200, bend = 0): void {
    const ctx = this.ctx;
    const f = mtof(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + 0.02);
    g.gain.setValueAtTime(lvl * 0.85, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.12);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cut * 0.4, t);
    lp.frequency.linearRampToValueAtTime(cut, t + 0.06);
    lp.connect(g).connect(this.out);
    for (const d of [1.004, 0.996]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * d, t);
      if (bend) o.frequency.linearRampToValueAtTime(f * d * 2 ** (bend / 12), t + dur);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.15);
    }
  }
}

/** A crowd murmuring along the fences, and birds over the hill. */
export class Field {
  /** 0 to 1: how many voices, and how loud. */
  crowd = 0;
  /** 0 to 1: how often birds sing. */
  birds = 0;
  private bus: GainNode;
  private nextVoice = 0;
  private nextBird = 0;
  private cheerUntil = 0;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
    private noise: AudioBuffer,
  ) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(lp).connect(out);
  }

  /** The crowd goes up: a burst of shouts and applause. */
  cheer(seconds = 3): void {
    this.cheerUntil = this.ctx.currentTime + seconds;
  }

  stop(): void {
    this.crowd = 0;
    this.birds = 0;
    this.cheerUntil = 0;
  }

  tick(): void {
    const t = this.ctx.currentTime;
    const ahead = t + 0.2;
    const cheering = t < this.cheerUntil;
    if (this.nextVoice < t - 0.2) this.nextVoice = t;
    if (this.nextBird < t - 0.2) this.nextBird = t + 0.5;
    // Voices arrive at random: a few a second when quiet, dozens in a cheer.
    const rate = cheering ? 45 : this.crowd * 28;
    while (rate > 0 && this.nextVoice < ahead) {
      this.syllable(this.nextVoice, cheering);
      if (cheering && Math.random() < 0.7) this.clapAt(this.nextVoice + Math.random() * 0.05);
      this.nextVoice += -Math.log(1 - Math.random()) / rate;
    }
    if (rate <= 0) this.nextVoice = ahead;
    if (this.birds > 0 && this.nextBird < ahead) {
      this.song(this.nextBird);
      this.nextBird += (1.2 + Math.random() * 3) / Math.max(0.3, this.birds);
    } else if (this.birds <= 0) this.nextBird = ahead;
  }

  /** One voice saying one thing: a buzz through two vowel formants, gliding a little. */
  private syllable(t: number, cheer: boolean): void {
    const ctx = this.ctx;
    const vowels: [number, number][] = [
      [730, 1090],
      [530, 1840],
      [570, 840],
      [300, 2200],
      [440, 1020],
    ];
    const [f1, f2] = vowels[Math.floor(Math.random() * vowels.length)];
    const high = Math.random() < 0.45;
    const f0 = (high ? 190 + Math.random() * 70 : 100 + Math.random() * 50) * (cheer ? 1.25 : 1);
    const dur = cheer ? 0.25 + Math.random() * 0.4 : 0.08 + Math.random() * 0.16;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * (cheer ? 1.15 : 0.9 + Math.random() * 0.2), t + dur);
    const g = ctx.createGain();
    const lvl = (cheer ? 0.14 : 0.09 + this.crowd * 0.08) * (0.4 + Math.random() * 0.6);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + Math.min(0.04, dur * 0.3));
    g.gain.linearRampToValueAtTime(0, t + dur);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 1.6;
    for (const [f, q] of [
      [f1, 6],
      [f2, 8],
    ]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      o.connect(bp).connect(g);
    }
    g.connect(pan).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private clapAt(t: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100 + Math.random() * 1400;
    f.Q.value = 1.4;
    const g = ctx.createGain();
    const lvl = 0.05 + Math.random() * 0.06;
    g.gain.setValueAtTime(lvl, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 1.8;
    src.connect(f).connect(g).connect(pan).connect(this.bus);
    src.start(t, Math.random());
    src.stop(t + 0.07);
  }

  /** A short bird phrase: falling chirps, a two-note call, or a trill. */
  private song(t: number): void {
    const kind = Math.floor(Math.random() * 3);
    const pan = (Math.random() - 0.5) * 1.6;
    const lvl = 0.03 + Math.random() * 0.03;
    if (kind === 0) {
      const n = 3 + Math.floor(Math.random() * 4);
      const top = 4200 + Math.random() * 1200;
      for (let i = 0; i < n; i++) this.chirp(t + i * 0.11, top - i * 250, top - i * 250 - 1400, 0.06, lvl, pan);
    } else if (kind === 1) {
      const a = 3400 + Math.random() * 800;
      for (let i = 0; i < 2; i++) {
        this.chirp(t + i * 0.42, a, a * 1.04, 0.15, lvl, pan);
        this.chirp(t + i * 0.42 + 0.18, a * 0.8, a * 0.78, 0.17, lvl, pan);
      }
    } else {
      const f = 4800 + Math.random() * 900;
      for (let i = 0; i < 9; i++) this.chirp(t + i * 0.045, f + 300, f - 300, 0.03, lvl * 0.8, pan);
    }
  }

  private chirp(t: number, from: number, to: number, dur: number, lvl: number, pan: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(200, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + dur * 0.2);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
