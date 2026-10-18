// Hill run: what each ride sounds like, built from the parts that make the noise.
//
// Hill bomb: urethane wheels rumbling on asphalt, the bearings' whine climbing with
// speed, both trucks clacking over every tar seam, and the sweeper's diesel with
// its brushes thrashing. Cheese roll: footfalls on turf, a crowd of voices along
// the fences, and the second cheese thumping as it bounds. Luge: steel runners
// hissing on ice, the sled frame buzzing as it rides up a wall, cowbells on the
// big curves, and the bob's heavier roar coming down behind.

import type { LevelId } from './_course';
import type { Run, Sound } from './_sim';

interface Loop {
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

export class HillSound {
  on = true;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private level: LevelId | null = null;
  private nodes: AudioNode[] = [];
  private loops: Record<string, Loop> = {};
  private oscs: Record<string, { osc: OscillatorNode; gain: GainNode; filter?: BiquadFilterNode }> = {};
  private voices: { osc: OscillatorNode; gain: GainNode; base: number; swell: number }[] = [];
  private chaser: { pan: StereoPannerNode; gain: GainNode } | null = null;
  private crowd: GainNode | null = null;
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
      if (this.level) this.build(this.level);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setOn(on: boolean): void {
    this.on = on;
    if (on) this.unlock();
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05);
  }

  start(level: LevelId): void {
    this.stop();
    this.level = level;
    if (this.ctx) this.build(level);
  }

  stop(): void {
    for (const n of this.nodes) {
      try {
        if (n instanceof AudioScheduledSourceNode) n.stop();
        n.disconnect();
      } catch {
        // Already stopped.
      }
    }
    this.nodes = [];
    this.loops = {};
    this.oscs = {};
    this.voices = [];
    this.chaser = null;
    this.crowd = null;
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
    // Air past your ears at speed.
    this.loop('wind', 'lowpass', 300, 0.5);
    if (level === 'bomb') {
      this.loop('roll', 'bandpass', 220, 0.9);
      this.loop('grit', 'bandpass', 1800, 0.7);
      this.loop('slide', 'bandpass', 1100, 5);
      this.tone('bearing', 'triangle', 300);
      // Sweeper: a slow diesel, its harmonics, and the brushes.
      this.tone('diesel', 'sawtooth', 31, pan, 380);
      this.tone('diesel2', 'square', 62, pan, 240);
      this.loop('brush', 'bandpass', 2600, 1.2, pan);
    } else if (level === 'cheese') {
      // A crowd: a dozen voices shouting on open vowels, swelling and falling.
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = 820;
      formant.Q.value = 1.1;
      const formant2 = ctx.createBiquadFilter();
      formant2.type = 'bandpass';
      formant2.frequency.value = 1250;
      formant2.Q.value = 1.4;
      const crowd = ctx.createGain();
      crowd.gain.value = 0;
      formant.connect(crowd);
      formant2.connect(crowd);
      crowd.connect(this.out!);
      this.nodes.push(formant, formant2, crowd);
      this.crowd = crowd;
      for (let i = 0; i < 12; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const base = 150 + Math.random() * 190;
        osc.frequency.value = base;
        const g = ctx.createGain();
        g.gain.value = 0;
        osc.connect(g);
        g.connect(formant);
        g.connect(formant2);
        osc.start();
        this.nodes.push(osc, g);
        this.voices.push({ osc, gain: g, base, swell: Math.random() });
      }
      this.loop('turf', 'highpass', 2500, 0.6);
      this.loop('rind', 'bandpass', 160, 1.2, pan);
    } else {
      this.loop('hiss', 'bandpass', 5200, 0.8);
      this.loop('ice', 'lowpass', 160, 0.7);
      this.tone('frame', 'sawtooth', 38, undefined, 220);
      this.loop('bobhiss', 'bandpass', 3800, 0.9, pan);
      this.loop('bobroar', 'lowpass', 120, 0.8, pan);
    }
  }

  // ------------------------------------------------------------ continuous

  update(run: Run, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.level || run.id !== this.level) return;
    const t = ctx.currentTime;
    const r = run.rider;
    const v = r.state === 'crash' || r.state === 'caught' ? 0 : r.v;
    const set = (p: AudioParam, val: number, k = 0.06) => p.setTargetAtTime(val, t, k);
    const L = this.loops;
    const O = this.oscs;
    set(L.wind.gain.gain, Math.min(0.22, (v / 30) ** 2 * 0.22));
    set(L.wind.filter.frequency, 200 + v * 45);

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
      const riding = r.state === 'ride' || r.state === 'finish';
      const k = riding ? Math.min(1, v / 20) : 0;
      set(L.roll.gain.gain, k ** 1.2 * 0.5);
      set(L.roll.filter.frequency, 140 + v * 14);
      set(L.grit.gain.gain, k * 0.06);
      // A 60 mm wheel turns about 5.3 times a second per m/s; the balls pass at about 3.6 times that.
      set(O.bearing.osc.frequency, 40 + v * 5.3 * 3.6);
      set(O.bearing.gain.gain, k * 0.018);
      set(L.slide.gain.gain, riding && r.brake && v > 3 ? Math.min(0.35, v / 40) : 0, 0.03);
      set(L.slide.filter.frequency, 900 + v * 25);
      const rev = 28 + Math.min(10, q.v * 0.5);
      set(O.diesel.osc.frequency, rev);
      set(O.diesel2.osc.frequency, rev * 2);
      set(O.diesel.gain.gain, q.active ? 0.22 : 0);
      set(O.diesel2.gain.gain, q.active ? 0.08 : 0);
      // Brushes thrash at about 7 turns a second: their bristles chop the hiss.
      const chop = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 7);
      set(L.brush.gain.gain, q.active ? 0.05 + chop * 0.07 : 0, 0.01);
    } else if (this.level === 'cheese') {
      // Crowds bunch at the top and the bottom fence.
      const c = run.course;
      const crowdNear = r.y < 60 ? 1 : r.y > c.finish - 80 ? 1 : 0.35;
      const excite =
        (q.active && near > 0.2 ? 0.4 : 0) + (r.state === 'tumble' ? 0.4 : 0) + (r.state === 'finish' ? 0.6 : 0);
      if (this.crowd) set(this.crowd.gain, Math.min(0.5, 0.12 + 0.18 * crowdNear + 0.25 * excite), 0.4);
      for (const vo of this.voices) {
        vo.swell += (Math.random() - 0.5) * dt * 2;
        vo.swell = Math.max(0, Math.min(1, vo.swell));
        set(vo.gain.gain, vo.swell ** 2 * 0.05, 0.15);
        set(vo.osc.frequency, vo.base * (1 + vo.swell * 0.25 + Math.sin(t * 5 + vo.base) * 0.02), 0.1);
      }
      set(L.turf.gain.gain, r.state === 'tumble' ? 0.12 : Math.min(0.05, v * 0.006));
      if (r.state === 'tumble') {
        this.tumbleT -= dt;
        if (this.tumbleT <= 0) {
          this.thud(70 + Math.random() * 40, 0.35, 0.12);
          this.tumbleT = 0.12 + Math.random() * 0.2;
        }
      }
      // The second cheese lands with a thump every bound and rumbles on the turf between.
      if (q.active) {
        set(L.rind.gain.gain, 0.15);
        const bounce = Math.sin(q.spin * 0.45);
        if (Math.sign(bounce) !== Math.sign(this.bouncePhase) && near > 0.02)
          this.thud(55, Math.min(0.8, near * 1.1), 0.18, this.chaser!.pan);
        this.bouncePhase = bounce;
      }
    } else {
      const riding = r.state === 'ride' || r.state === 'finish';
      const k = riding ? Math.min(1, v / 30) : 0;
      const climb = Math.max(0, Math.abs(r.u) - 1.2);
      set(L.hiss.gain.gain, k * 0.12 + (r.brake && riding ? 0.08 : 0));
      set(L.hiss.filter.frequency, 3800 + v * 60);
      set(L.ice.gain.gain, k * 0.45 + climb * 0.2);
      set(L.ice.filter.frequency, 110 + v * 3 + climb * 120);
      set(O.frame.osc.frequency, 34 + climb * 30 + v * 0.4);
      set(O.frame.gain.gain, riding ? Math.min(0.12, climb * 0.12) : 0, 0.03);
      if (r.state === 'crash') set(L.ice.gain.gain, 0.3);
      set(L.bobhiss.gain.gain, q.active ? 0.14 : 0);
      set(L.bobroar.gain.gain, q.active ? 0.6 : 0);
      // Cowbells from the fans on the big curves.
      let fans = 0;
      for (const m of run.course.marks) if (Math.abs(m.y + 30 - r.y) < 60) fans = 1;
      this.bellT -= dt;
      if (fans && this.bellT <= 0 && riding) {
        this.cowbell(0.04 + Math.random() * 0.06, (Math.random() - 0.5) * 1.4);
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
        const lvl = Math.min(0.5, e.v / 40);
        this.click(1700, lvl, 0);
        this.click(1500, lvl * 0.85, gap);
        break;
      }
      case 'bump':
        this.thud(90, 0.4, 0.08);
        this.click(900, 0.3, 0);
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
        this.thud(95 + Math.random() * 25, Math.min(0.5, 0.15 + e.v * 0.03), 0.07);
        this.scuff(4200, Math.min(0.12, e.v * 0.012), 0.05);
        break;
      case 'trip':
        this.thud(70, 0.6, 0.15);
        this.scuff(3000, 0.2, 0.25);
        break;
      case 'crash':
        this.thud(65, 0.8, 0.2);
        if (run.id === 'bomb') {
          this.scuff(700, 0.35, 0.4);
          for (let i = 0; i < 4; i++)
            this.click(2200 + Math.random() * 1200, 0.3, 0.05 + i * (0.06 + Math.random() * 0.08));
        } else if (run.id === 'luge') {
          this.scuff(2600, 0.3, 0.9);
          this.click(900, 0.4, 0.02);
        } else this.scuff(3000, 0.25, 0.4);
        break;
      case 'wall':
        this.thud(140, Math.min(0.7, e.v * 0.08), 0.1);
        this.click(2400, 0.2, 0);
        break;
      case 'caught':
        this.thud(50, 0.9, 0.4);
        this.scuff(500, 0.4, 0.6);
        break;
      case 'finish':
        this.beep(true);
        break;
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
