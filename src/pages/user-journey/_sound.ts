// A handful of short interface sounds: a tap when the user lands, a thud when they don't, a two-note chime at
// each new section, and a run of notes at the end. Nothing sustained; silence between events.

export interface Sound {
  /** Create or resume the context; call from a user gesture. */
  wake(): void;
  setOn(on: boolean): void;
  land(height: number): void;
  splat(): void;
  chime(): void;
  go(): void;
  goal(): void;
}

export function makeSound(): Sound {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let on = true;

  const ready = () => (on && ctx && master && ctx.state === 'running' ? ctx : null);

  function tone(freq: number, at: number, dur: number, peak: number, type: OscillatorType = 'sine', glide?: number) {
    const c = ready();
    if (!c || !master) return;
    const t = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function thump(at: number, dur: number, peak: number) {
    const c = ready();
    if (!c || !master) return;
    const t = c.currentTime + at;
    const len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = c.createBufferSource();
    src.buffer = buf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const g = c.createGain();
    g.gain.value = peak;
    src.connect(lp).connect(g).connect(master);
    src.start(t);
  }

  return {
    wake() {
      if (!ctx) {
        try {
          ctx = new AudioContext();
          master = ctx.createGain();
          master.gain.value = 0.16;
          master.connect(ctx.destination);
        } catch {
          ctx = null;
        }
      }
      if (ctx && ctx.state === 'suspended') void ctx.resume();
    },
    setOn(v) {
      on = v;
    },
    land(height) {
      if (height < 18) return;
      const k = Math.min(1, height / 150);
      tone(760 - 260 * k, 0, 0.07, 0.18 + 0.3 * k, 'triangle', 380 - 120 * k);
    },
    splat() {
      tone(190, 0, 0.32, 0.55, 'sine', 48);
      thump(0, 0.12, 0.5);
    },
    chime() {
      tone(659.25, 0, 0.5, 0.22, 'triangle');
      tone(987.77, 0.11, 0.7, 0.2, 'triangle');
    },
    go() {
      tone(880, 0, 0.08, 0.14, 'triangle', 1320);
    },
    goal() {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.09, 0.9 - i * 0.08, 0.2, 'triangle'));
    },
  };
}
