// Hill run: what each ride sounds like.
//
// Under every run is a little piece of music that follows your speed (see
// _music.ts). Over it, kept quiet, the ride itself: urethane wheels and both trucks
// clacking over tar seams, the sweeper's diesel; footfalls on turf, a crowd along
// the fences and birds over the hill, the second cheese thumping as it bounds;
// runners on ice, the sled frame buzzing up a wall, cowbells on the big curves and
// the bob coming down behind. At the bottom the ride sounds fade and a sting hands
// over to the results music.

import type { LevelId } from './_course';
import { Field, Music, RUN_SONGS, resultSong } from './_music';
import type { Run, Sound } from './_sim';

interface Loop {
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

const FAST: Record<LevelId, number> = { bomb: 22, cheese: 9, luge: 32 };

export class HillSound {
  on = true;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private music: Music | null = null;
  private field: Field | null = null;
  private level: LevelId | null = null;
  private nodes: AudioNode[] = [];
  private loops: Record<string, Loop> = {};
  private oscs: Record<string, { osc: OscillatorNode; gain: GainNode; filter?: BiquadFilterNode }> = {};
  private chaser: { pan: StereoPannerNode; gain: GainNode } | null = null;
  /** The run is over: ride sounds are gone, only music and the field play on. */
  private over = false;
  private going = false;
  private held = false;
  private bellT = 0;
  private bouncePhase = 0;
  private tumbleT = 0;

  /** Browsers only start audio from a gesture; call this from one. */
  unlock(): void {
    if (!this.on) return;
    if (!this.ctx) {
      const AC =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.85;
      this.out.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.music = new Music(this.ctx, this.out, this.noise);
      this.field = new Field(this.ctx, this.out, this.noise);
      if (this.level && !this.over) {
        this.build(this.level);
        if (this.going) this.go();
      }
    }
    if (this.ctx.state === 'suspended' && !this.held) void this.ctx.resume();
  }

  /** Pause: the whole sound stops where it is and picks up again on resume. */
  hold(on: boolean): void {
    this.held = on;
    if (!this.ctx) return;
    if (on) void this.ctx.suspend();
    else if (this.on) void this.ctx.resume();
  }

  setOn(on: boolean): void {
    this.on = on;
    if (on) this.unlock();
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05);
  }

  /** A new run: ride sounds built and waiting for the start. */
  start(level: LevelId): void {
    this.stop();
    this.level = level;
    this.over = false;
    this.going = false;
    if (this.ctx) this.build(level);
  }

  /** The start gun: the run's music comes in. */
  go(): void {
    this.going = true;
    if (!this.ctx || !this.level) return;
    this.music!.target = 0;
    this.music!.play(RUN_SONGS[this.level]);
    if (this.level === 'cheese') {
      this.field!.crowd = 0.5;
      this.field!.birds = 0.5;
    }
  }

  /** Back to the rack: everything stops. */
  stop(): void {
    this.dropBeds(0);
    this.music?.stop(0.3);
    this.field?.stop();
    this.going = false;
  }

  /** Over the line: the ride fades, a fanfare, then the results loop. */
  finish(): void {
    this.end(true);
  }

  /** Caught: the ride fades, a falling "wah wah", then a calmer loop. */
  caught(): void {
    this.end(false);
  }

  private end(won: boolean): void {
    this.over = true;
    if (!this.ctx || !this.level || !this.on) return;
    const level = this.level;
    this.dropBeds(0.35);
    this.music!.stop(0.4);
    const done = won ? this.music!.fanfare(level) : this.music!.wahwah(level);
    if (level === 'cheese') {
      // On the hill it's the crowd and the birds, not a jingle on a loop.
      this.field!.crowd = won ? 0.75 : 0.45;
      this.field!.birds = 0.9;
      if (won) this.field!.cheer(3.5);
    } else this.music!.play(resultSong(level, won), done + 0.2);
  }

  /** Fade the ride sounds out and let them go. */
  private dropBeds(fade: number): void {
    const ctx = this.ctx;
    const nodes = this.nodes;
    this.nodes = [];
    this.loops = {};
    this.oscs = {};
    this.chaser = null;
    if (!ctx) return;
    const kill = () => {
      for (const n of nodes) {
        try {
          if (n instanceof AudioScheduledSourceNode) n.stop();
          n.disconnect();
        } catch {
          // Already stopped.
        }
      }
    };
    if (fade <= 0) return kill();
    for (const n of nodes) if (n instanceof GainNode) n.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
    setTimeout(kill, fade * 1000 + 200);
  }

  // ------------------------------------------------------------ building blocks

  private loop(name: string, type: BiquadFilterType, freq: number, q: number, dest?: AudioNode): Loop {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src
      .connect(filter)
      .connect(gain)
      .connect(dest ?? this.out!);
    src.start(0, Math.random() * 1.5);
    this.nodes.push(src, filter, gain);
    const l = { src, filter, gain };
    this.loops[name] = l;
    return l;
  }

  private tone(name: string, type: OscillatorType, freq: number, dest?: AudioNode, lp?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    let filter: BiquadFilterNode | undefined;
    if (lp) {
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lp;
      osc.connect(filter).connect(gain);
      this.nodes.push(filter);
    } else osc.connect(gain);
    gain.connect(dest ?? this.out!);
    osc.start();
    this.nodes.push(osc, gain);
    this.oscs[name] = { osc, gain, filter };
  }

  private build(level: LevelId): void {
    const ctx = this.ctx!;
    // The pursuer gets its own panned bus.
    const pan = ctx.createStereoPanner();
    const pg = ctx.createGain();
    pg.gain.value = 0;
    pan.connect(pg).connect(this.out!);
    this.nodes.push(pan, pg);
    this.chaser = { pan, gain: pg };
    if (level === 'bomb') {
      // Wheels: a low rumble only, kept well under the music.
      this.loop('roll', 'lowpass', 150, 0.7);
      this.loop('slide', 'bandpass', 1100, 5);
      this.tone('bearing', 'triangle', 300);
      // Sweeper: a slow diesel, its harmonics, and the brushes.
      this.tone('diesel', 'sawtooth', 31, pan, 380);
      this.tone('diesel2', 'square', 62, pan, 240);
      this.loop('brush', 'bandpass', 2600, 1.2, pan);
    } else if (level === 'cheese') {
      this.loop('turf', 'bandpass', 900, 0.8);
      this.loop('rind', 'lowpass', 160, 1.2, pan);
    } else {
      this.loop('hiss', 'bandpass', 5200, 1.2);
      this.loop('ice', 'lowpass', 140, 0.7);
      this.tone('frame', 'sawtooth', 38, undefined, 220);
      this.loop('bobroar', 'lowpass', 120, 0.8, pan);
    }
  }

  // ------------------------------------------------------------ continuous

  update(run: Run, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.level || run.id !== this.level) return;
    const r = run.rider;
    const v = r.state === 'crash' || r.state === 'caught' ? 0 : r.v;
    if (this.music) {
      this.music.target = this.over ? 0 : Math.min(1, v / FAST[this.level]);
      this.music.tick(dt);
    }
    this.field?.tick();
    if (this.over) return;

    const t = ctx.currentTime;
    const set = (p: AudioParam, val: number, k = 0.06) => p.setTargetAtTime(val, t, k);
    const L = this.loops;
    const O = this.oscs;
    const air = r.z > 0.05;

    // The chaser: louder as it closes, panned to where it is.
    const q = run.pursuer;
    let near = 0;
    if (q.active && this.chaser) {
      const gap = Math.max(0, r.y - q.y);
      near = r.state === 'caught' ? 1 : 1 / (1 + (gap / 18) ** 2);
      set(this.chaser.gain.gain, near);
      set(this.chaser.pan.pan, Math.max(-0.8, Math.min(0.8, (q.x - r.x) / 10)));
    }

    if (this.level === 'bomb') {
      const riding = (r.state === 'ride' || r.state === 'finish') && !air;
      const k = riding ? Math.min(1, v / 20) : 0;
      set(L.roll.gain.gain, k ** 1.3 * 0.12);
      set(L.roll.filter.frequency, 110 + v * 5);
      // A 60 mm wheel turns about 5.3 times a second per m/s; the balls pass at about 3.6 times that.
      set(O.bearing.osc.frequency, 40 + v * 5.3 * 3.6);
      set(O.bearing.gain.gain, k * 0.008);
      set(L.slide.gain.gain, riding && r.brake && v > 3 ? Math.min(0.2, v / 60) : 0, 0.03);
      set(L.slide.filter.frequency, 900 + v * 25);
      const rev = 28 + Math.min(10, q.v * 0.5);
      set(O.diesel.osc.frequency, rev);
      set(O.diesel2.osc.frequency, rev * 2);
      set(O.diesel.gain.gain, q.active ? 0.16 : 0);
      set(O.diesel2.gain.gain, q.active ? 0.05 : 0);
      // Brushes thrash at about 7 turns a second: their bristles chop the hiss.
      const chop = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 7);
      set(L.brush.gain.gain, q.active ? 0.015 + chop * 0.03 : 0, 0.01);
    } else if (this.level === 'cheese') {
      // Crowds bunch at the top and the bottom fence, and get louder when it's close.
      const c = run.course;
      const crowdNear = r.y < 60 ? 1 : r.y > c.finish - 80 ? 1 : 0.3;
      const excite = (q.active && near > 0.2 ? 0.3 : 0) + (r.state === 'tumble' ? 0.3 : 0);
      if (this.field) this.field.crowd = Math.min(1, 0.15 + 0.45 * crowdNear + excite);
      set(L.turf.gain.gain, r.state === 'tumble' ? 0.03 : 0);
      if (r.state === 'tumble') {
        this.tumbleT -= dt;
        if (this.tumbleT <= 0) {
          this.thud(70 + Math.random() * 40, 0.3, 0.12);
          this.tumbleT = 0.12 + Math.random() * 0.2;
        }
      }
      // The second cheese lands with a thump every bound and rumbles on the turf between.
      if (q.active) {
        set(L.rind.gain.gain, 0.08);
        const bounce = Math.sin(q.spin * 0.45);
        if (Math.sign(bounce) !== Math.sign(this.bouncePhase) && near > 0.02)
          this.thud(55, Math.min(0.8, near * 1.1), 0.18, this.chaser!.pan);
        this.bouncePhase = bounce;
      }
    } else {
      const riding = (r.state === 'ride' || r.state === 'finish') && !air;
      const k = riding ? Math.min(1, v / 30) : 0;
      const climb = Math.max(0, Math.abs(r.u) - 1.2);
      set(L.hiss.gain.gain, k * 0.025 + (r.brake && riding ? 0.04 : 0));
      set(L.hiss.filter.frequency, 3800 + v * 60);
      set(L.ice.gain.gain, k * 0.12 + climb * 0.12);
      set(L.ice.filter.frequency, 100 + v * 2 + climb * 120);
      set(O.frame.osc.frequency, 34 + climb * 30 + v * 0.4);
      set(O.frame.gain.gain, riding ? Math.min(0.1, climb * 0.1) : 0, 0.03);
      if (r.state === 'crash') set(L.ice.gain.gain, 0.15);
      set(L.bobroar.gain.gain, q.active ? 0.35 : 0);
      // Cowbells from the fans on the big curves.
      let fans = 0;
      for (const m of run.course.marks) if (Math.abs(m.y + 30 - r.y) < 60) fans = 1;
      this.bellT -= dt;
      if (fans && this.bellT <= 0 && riding) {
        this.cowbell(0.03 + Math.random() * 0.05, (Math.random() - 0.5) * 1.4);
        this.bellT = 0.08 + Math.random() * 0.3;
      }
    }
  }

  // ------------------------------------------------------------ one-shots

  event(e: Sound, run: Run): void {
    if (!this.ctx || !this.on) return;
    switch (e.type) {
      case 'seam': {
        // Front truck, then the back truck one wheelbase later.
        const gap = 0.38 / Math.max(2, e.v);
        const lvl = Math.min(0.35, e.v / 50);
        this.click(1700, lvl, 0);
        this.click(1500, lvl * 0.85, gap);
        break;
      }
      case 'bump':
        this.thud(90, 0.4, 0.08);
        this.click(900, 0.25, 0);
        break;
      case 'knock':
        // A traffic cone: hollow plastic.
        this.click(620, 0.5, 0, 9);
        this.thud(210, 0.25, 0.06);
        break;
      case 'door':
        this.click(1300, 0.35, 0);
        this.thud(120, 0.3, 0.1);
        break;
      case 'step':
        this.thud(95 + Math.random() * 25, Math.min(0.45, 0.15 + e.v * 0.03), 0.07);
        break;
      case 'trip':
        this.thud(70, 0.6, 0.15);
        break;
      case 'jump':
        if (run.id === 'bomb') {
          // An ollie: the tail snaps on the road.
          this.click(1900, 0.45, 0, 5);
          this.thud(180, 0.3, 0.05);
        } else this.thud(110, 0.35, 0.08);
        break;
      case 'launch':
        if (run.id === 'bomb') {
          // Over the plywood lip.
          this.thud(120, 0.5, 0.14);
          this.click(700, 0.3, 0, 6);
        } else this.thud(85, 0.4, 0.12);
        break;
      case 'land': {
        const lvl = Math.min(0.8, 0.25 + e.v * 0.07);
        this.thud(run.id === 'bomb' ? 95 : 75, lvl, 0.14);
        if (run.id === 'bomb') {
          // Both trucks hit at once.
          this.click(1600, lvl * 0.6, 0);
          this.click(1400, lvl * 0.5, 0.012);
        }
        break;
      }
      case 'crash':
        this.thud(65, 0.8, 0.2);
        if (run.id === 'bomb') {
          this.scuff(700, 0.25, 0.3);
          for (let i = 0; i < 4; i++)
            this.click(2200 + Math.random() * 1200, 0.3, 0.05 + i * (0.06 + Math.random() * 0.08));
        } else if (run.id === 'luge') {
          this.scuff(2600, 0.15, 0.6);
          this.click(900, 0.4, 0.02);
        } else this.scuff(1800, 0.15, 0.3);
        break;
      case 'wall':
        this.thud(140, Math.min(0.7, e.v * 0.08), 0.1);
        this.click(2400, 0.2, 0);
        break;
      case 'caught':
        this.thud(50, 0.9, 0.4);
        break;
      case 'finish':
      case 'release':
        break;
    }
  }

  /** The start lights' pips: short ones, then a long high one to go. */
  beep(go: boolean): void {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = go ? 1760 : 880;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.005);
    g.gain.setValueAtTime(0.16, t + (go ? 0.45 : 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (go ? 0.6 : 0.16));
    osc.connect(g).connect(this.out!);
    osc.start(t);
    osc.stop(t + 0.7);
  }

  private thud(freq: number, level: number, dur: number, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(freq * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest ?? this.out!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private click(freq: number, level: number, delay: number, q = 3): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random());
    src.stop(t + 0.05);
  }

  private scuff(freq: number, level: number, dur: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  /** A cowbell: two square partials near 540 and 800 Hz through a bandpass, struck. */
  private cowbell(level: number, pan: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2640;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(level * 0.3, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const pitch = 0.9 + Math.random() * 0.25;
    for (const hz of [540, 800]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hz * pitch;
      o.connect(f);
      o.start(t);
      o.stop(t + 0.55);
    }
    f.connect(g).connect(p).connect(this.out!);
  }
}
