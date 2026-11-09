// The page: wires the controls to the signal, and the signal to the tube and the speakers.

import workletUrl from './_worklet.ts?worker&url';
import { Beam, PHOSPHORS, type PhosphorId } from './_beam';
import { BAR, CUES, REEL_BARS, REEL_SECONDS } from './_reel';
import {
  midiToFreq,
  Signal,
  tunedFreq,
  JUST_RATIOS,
  type BenchName,
  type Command,
  type Mode,
  type Status,
} from './_signal';
import { Path } from './_path';
import { setText } from './_strokes';

const root = document.querySelector<HTMLElement>('.xy');
const debug = new URLSearchParams(location.search).has('debug');

type UiMode = 'reel' | 'keys' | 'draw' | 'type' | 'listen';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m: number) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const INTERVALS = [
  'unison',
  'minor second',
  'major second',
  'minor third',
  'major third',
  'fourth',
  'tritone',
  'fifth',
  'minor sixth',
  'major sixth',
  'minor seventh',
  'major seventh',
];

// Two rows of a computer keyboard, the way trackers lay them out.
const KEYMAP: Record<string, number> = {
  z: 48,
  s: 49,
  x: 50,
  d: 51,
  c: 52,
  v: 53,
  g: 54,
  b: 55,
  h: 56,
  n: 57,
  j: 58,
  m: 59,
  q: 60,
  '2': 61,
  w: 62,
  '3': 63,
  e: 64,
  r: 65,
  '5': 66,
  t: 67,
  '6': 68,
  y: 69,
  '7': 70,
  u: 71,
  i: 72,
};

const CHORDS: { label: string; notes: number[] }[] = [
  { label: 'Octave', notes: [57, 69] },
  { label: 'Fifth', notes: [57, 64] },
  { label: 'Fourth', notes: [57, 62] },
  { label: 'Major third', notes: [57, 61] },
  { label: 'Minor third', notes: [57, 60] },
  { label: 'Major', notes: [57, 61, 64] },
  { label: 'Minor', notes: [57, 60, 64] },
  { label: 'Seventh', notes: [57, 61, 64, 67] },
];

function start(el: HTMLElement): void {
  const $ = <T extends Element>(sel: string) => el.querySelector<T>(sel)!;
  const $$ = <T extends Element>(sel: string) => [...el.querySelectorAll<T>(sel)];

  const canvas = $<HTMLCanvasElement>('[data-tube]');
  const slot = $<HTMLElement>('[data-slot]');

  let beam: Beam;
  try {
    beam = new Beam(canvas);
  } catch {
    $<HTMLElement>('[data-nogl]').hidden = false;
    return;
  }

  // ---------------------------------------------------------------- the signal

  const local = new Signal(48000);
  const localX = new Float32Array(8192);
  const localY = new Float32Array(8192);
  const localOut = new Float32Array(16384);

  let ctx: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let speakers: GainNode | null = null;
  let audioLive = false;
  let starting: Promise<void> | null = null;
  let status: Status = { bar: 0, playing: false };
  /** The state a late-starting worklet needs to be told about. */
  const state = new Map<string, Command>();
  let queue: Command[] = [];

  function send(cmd: Command): void {
    local.apply(cmd);
    if (cmd.type === 'bench') state.set(`bench:${cmd.name}`, cmd);
    else if (
      cmd.type === 'mode' ||
      cmd.type === 'tuning' ||
      cmd.type === 'turn' ||
      cmd.type === 'path' ||
      cmd.type === 'pitch' ||
      cmd.type === 'gate' ||
      cmd.type === 'twist'
    )
      state.set(cmd.type, cmd);
    if (audioLive && node) node.port.postMessage(cmd);
    else if (starting) queue.push(cmd);
  }

  // Everything a recording needs, in the order it arrived.
  let recording: Float32Array[] | null = null;
  let recorded = 0;

  function onSamples(samples: Float32Array): void {
    beam.push(samples);
    if (recording) {
      recording.push(samples.slice());
      recorded += samples.length / 2;
      if (recorded > 60 * beam.sampleRate) finishRecording();
    }
  }

  async function startAudio(): Promise<void> {
    if (audioLive) {
      if (ctx?.state === 'suspended') void ctx.resume();
      return;
    }
    if (starting) return starting;
    if (new URLSearchParams(location.search).has('silent')) return;
    starting = (async () => {
      try {
        ctx = new AudioContext({ latencyHint: 'interactive' });
        void ctx.resume();
        await ctx.audioWorklet.addModule(workletUrl);
        node = new AudioWorkletNode(ctx, 'xy-signal', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: 'explicit',
          channelInterpretation: 'discrete',
        });
        node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; status: Status }>) => {
          status = e.data.status;
          onSamples(e.data.samples);
        };
        // Coasts in the north leave more of the signal above the centre line than below it.
        // The tube should see that; a loudspeaker should not.
        const block = ctx.createBiquadFilter();
        block.type = 'highpass';
        block.frequency.value = 12;
        speakers = ctx.createGain();
        speakers.gain.value = currentVolume();
        node.connect(block);
        block.connect(speakers);
        speakers.connect(ctx.destination);
        beam.sampleRate = ctx.sampleRate;
        for (const cmd of state.values()) node.port.postMessage(cmd);
        for (const cmd of queue) node.port.postMessage(cmd);
        queue = [];
        audioLive = true;
      } catch (err) {
        console.warn('No audio, drawing silently', err);
      }
      starting = null;
    })();
    return starting;
  }

  function currentVolume(): number {
    const v = Number($<HTMLInputElement>('[data-volume]').value) / 100;
    // The mic never reaches the speakers: it would howl.
    return micStream ? 0 : idleMute ? 0 : 0.9 * v * v;
  }

  function applyVolume(): void {
    if (speakers && ctx) speakers.gain.setTargetAtTime(currentVolume(), ctx.currentTime, 0.04);
  }

  // ---------------------------------------------------------------- modes

  let mode: UiMode = 'reel';
  let reelRunning = false;

  function setPanel(next: UiMode): void {
    mode = next;
    el.dataset.mode = next;
    for (const b of $$<HTMLButtonElement>('[data-go]')) b.setAttribute('aria-pressed', String(b.dataset.go === next));
    for (const p of $$<HTMLElement>('[data-pane]')) p.hidden = p.dataset.pane !== next;
    layout();
  }

  function signalMode(m: Mode): void {
    send({ type: 'mode', mode: m });
  }

  function go(next: UiMode): void {
    if (next === mode) return;
    stopListening();
    releaseAll();
    touch();
    setPanel(next);
    if (next !== 'reel' && reelRunning) stopReel();
    if (next === 'reel') {
      signalMode('idle');
    } else {
      void startAudio();
    }
    if (next === 'keys') signalMode('keys');
    if (next === 'draw') {
      signalMode('loop');
      if (strokes.length) sendDrawing();
      else send({ type: 'gate', on: false });
      updateDrawRead();
    }
    if (next === 'type') {
      signalMode('loop');
      sendText();
      if (!matchMedia('(pointer: coarse)').matches) $<HTMLInputElement>('[data-text]').focus();
    }
    if (next === 'listen') signalMode('listen');
  }

  for (const b of $$<HTMLButtonElement>('[data-go]')) b.addEventListener('click', () => go(b.dataset.go as UiMode));

  // ---------------------------------------------------------------- the reel

  const toggle = $<HTMLButtonElement>('[data-reel-toggle]');
  const bar = $<HTMLElement>('[data-reel-bar]');
  const fill = $<HTMLElement>('[data-reel-fill]');
  const timeEl = $<HTMLElement>('[data-reel-time]');
  const cueEl = $<HTMLElement>('[data-cue]');
  const opening = cueEl.textContent ?? '';
  let cueIndex = -2;
  let finished = false;

  function playReel(fromBar = 0): void {
    touch();
    void startAudio();
    reelRunning = true;
    finished = false;
    signalMode('reel');
    send({ type: 'reel', action: 'play', bar: fromBar });
    status = { bar: fromBar, playing: true };
    toggle.textContent = 'Stop';
    cueIndex = -2;
  }

  function stopReel(): void {
    reelRunning = false;
    signalMode('idle');
    toggle.textContent = 'Play the reel';
    cueEl.textContent = opening;
    fill.style.width = '0';
    timeEl.textContent = clock(REEL_SECONDS);
  }

  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  toggle.addEventListener('click', () => (reelRunning ? stopReel() : playReel()));

  function updateReel(): void {
    if (!reelRunning) return;
    const b = status.bar;
    if (!status.playing && b >= REEL_BARS - 0.01) {
      reelRunning = false;
      finished = true;
      signalMode('idle');
      toggle.textContent = 'Play it again';
      cueEl.textContent = 'That was all one signal, two channels wide. Try the knobs, or draw something.';
      fill.style.width = '100%';
      return;
    }
    fill.style.width = `${Math.min(100, (b / REEL_BARS) * 100)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round((b / REEL_BARS) * 100)));
    timeEl.textContent = clock(Math.max(0, REEL_SECONDS - b * BAR));
    let index = 0;
    for (let i = 0; i < CUES.length; i++) if (b >= CUES[i].bar) index = i;
    if (index !== cueIndex) {
      cueIndex = index;
      cueEl.textContent = CUES[index].text;
    }
  }

  function scrub(clientX: number): void {
    const rect = bar.getBoundingClientRect();
    const k = Math.max(0, Math.min(0.995, (clientX - rect.left) / rect.width));
    playReel(k * REEL_BARS);
  }
  bar.addEventListener('pointerdown', (e) => {
    scrub(e.clientX);
    bar.setPointerCapture?.(e.pointerId);
  });
  bar.addEventListener('pointermove', (e) => {
    if (e.buttons) scrub(e.clientX);
  });
  bar.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 4 : e.key === 'ArrowLeft' ? -4 : 0;
    if (!step) return;
    e.preventDefault();
    playReel(Math.max(0, Math.min(REEL_BARS - 1, status.bar + step)));
  });

  // ---------------------------------------------------------------- keys

  const heldNotes = new Set<number>();
  let hold = false;
  let just = false;
  let drawNote = 48;

  function buildKeyboard(
    host: HTMLElement,
    from: number,
    onDown: (m: number) => void,
    onUp: (m: number) => void,
  ): void {
    const WHITE = [0, 2, 4, 5, 7, 9, 11];
    const SHARP: Record<number, number> = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 };
    for (let o = 0; o < 2; o++) {
      const octave = document.createElement('div');
      octave.className = 'octave';
      const base = from + o * 12;
      const make = (m: number, sharp: boolean) => {
        const key = document.createElement('button');
        key.type = 'button';
        key.className = sharp ? 'key sharp' : 'key';
        key.dataset.midi = String(m);
        key.setAttribute('aria-label', noteName(m));
        if (!sharp) key.textContent = m % 12 === 0 ? noteName(m) : NOTE_NAMES[m % 12];
        key.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          onDown(m);
        });
        const up = () => onUp(m);
        key.addEventListener('pointerup', up);
        key.addEventListener('pointerleave', up);
        key.addEventListener('pointercancel', up);
        key.addEventListener('keydown', (e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
            e.preventDefault();
            e.stopPropagation();
            onDown(m);
          }
        });
        key.addEventListener('keyup', (e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.stopPropagation();
            onUp(m);
          }
        });
        return key;
      };
      for (const n of WHITE) octave.append(make(base + n, false));
      for (const n of [1, 3, 6, 8, 10]) {
        const key = make(base + n, true);
        key.style.left = `calc(${(SHARP[n] / 7) * 100}% - 4.5%)`;
        octave.append(key);
      }
      host.append(octave);
    }
  }

  function markKeys(): void {
    for (const key of $$<HTMLElement>('[data-keyboard] .key'))
      key.dataset.on = String(heldNotes.has(Number(key.dataset.midi)));
    for (const key of $$<HTMLElement>('[data-keyboard-draw] .key'))
      key.dataset.on = String(Number(key.dataset.midi) === drawNote);
  }

  function noteDown(m: number): void {
    touch();
    void startAudio();
    if (hold && heldNotes.has(m)) {
      noteOffNow(m);
      return;
    }
    heldNotes.add(m);
    send({ type: 'note', midi: m, on: true });
    clearChipMarks();
    updateKeysRead();
    markKeys();
  }

  function noteOffNow(m: number): void {
    if (!heldNotes.has(m)) return;
    heldNotes.delete(m);
    send({ type: 'note', midi: m, on: false });
    updateKeysRead();
    markKeys();
  }

  function noteUp(m: number): void {
    if (!hold) noteOffNow(m);
  }

  function releaseAll(): void {
    heldNotes.clear();
    send({ type: 'notes', midis: [] });
    clearChipMarks();
    updateKeysRead();
    markKeys();
  }

  function clearChipMarks(): void {
    for (const chip of $$<HTMLElement>('[data-presets] .chip')) chip.setAttribute('aria-pressed', 'false');
  }

  const keysRead = $<HTMLElement>('[data-keys-read]');
  const keysPrompt = keysRead.textContent ?? '';

  function updateKeysRead(): void {
    const list = [...heldNotes].sort((a, b) => a - b);
    if (list.length === 0) {
      keysRead.textContent = keysPrompt;
    } else if (list.length === 1) {
      keysRead.textContent = `${noteName(list[0])}, ${midiToFreq(list[0]).toFixed(1)} Hz, on both channels a quarter-cycle apart: a circle. Add another note.`;
    } else if (list.length === 2) {
      const [lo, hi] = list;
      const semis = hi - lo;
      const [num, den] = JUST_RATIOS[semis % 12];
      const P = num * 2 ** Math.floor(semis / 12);
      const f1 = midiToFreq(lo);
      const f2 = just ? tunedFreq(hi, lo, true) : midiToFreq(hi);
      const name =
        semis === 12 ? 'octave' : semis > 12 ? `${INTERVALS[semis % 12]} plus an octave` : INTERVALS[semis % 12];
      if (just) {
        keysRead.textContent = `${noteName(lo)} and ${noteName(hi)}, a just ${name}: exactly ${P} to ${den}, so the figure stands still.`;
      } else {
        const cents = 1200 * Math.log2(f2 / (f1 * (P / den)));
        const beat = Math.abs(den * f2 - P * f1);
        const every = beat > 0 ? 1 / beat : 0;
        keysRead.textContent =
          Math.abs(cents) < 0.01
            ? `${noteName(lo)} and ${noteName(hi)}, an equal-tempered ${name}: exactly ${P} to ${den}, so the figure stands still.`
            : `${noteName(lo)} and ${noteName(hi)}, an equal-tempered ${name}: ${Math.abs(cents).toFixed(1)} cents ${cents > 0 ? 'wide of' : 'narrow of'} ${P} to ${den}, so the figure rolls over every ${every >= 1 ? `${every.toFixed(1)} s` : `${(every * 1000).toFixed(0)} ms`}.`;
      }
    } else {
      keysRead.textContent = `${list.map(noteName).join(', ')}. Notes take turns: lowest on the left channel, next on the right, and on up.`;
    }
  }

  buildKeyboard($<HTMLElement>('[data-keyboard]'), 48, noteDown, noteUp);
  buildKeyboard(
    $<HTMLElement>('[data-keyboard-draw]'),
    36,
    (m) => setDrawNote(m),
    () => {},
  );

  const presets = $<HTMLElement>('[data-presets]');
  for (const chord of CHORDS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = chord.label;
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      touch();
      void startAudio();
      const wasOn = chip.getAttribute('aria-pressed') === 'true';
      heldNotes.clear();
      clearChipMarks();
      if (!wasOn) {
        for (const m of chord.notes) heldNotes.add(m);
        chip.setAttribute('aria-pressed', 'true');
      }
      send({ type: 'notes', midis: [...heldNotes] });
      updateKeysRead();
      markKeys();
    });
    presets.append(chip);
  }

  const tuningButtons = $$<HTMLButtonElement>('[data-tuning]');
  for (const b of tuningButtons) {
    b.addEventListener('click', () => {
      touch();
      just = b.dataset.tuning === 'just';
      for (const other of tuningButtons) other.setAttribute('aria-pressed', String(other === b));
      send({ type: 'tuning', just });
      updateKeysRead();
    });
  }

  const holdButton = $<HTMLButtonElement>('[data-hold]');
  holdButton.addEventListener('click', () => {
    hold = !hold;
    holdButton.setAttribute('aria-pressed', String(hold));
    if (!hold) releaseAll();
  });

  $<HTMLInputElement>('[data-turn]').addEventListener('input', (e) => {
    send({ type: 'turn', value: Number((e.target as HTMLInputElement).value) / 100 });
  });

  const downKeys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.matches('input[type=text]')) return;
    const m = KEYMAP[e.key.toLowerCase()];
    if (m === undefined) {
      if (e.key === ' ' && mode === 'reel' && target === document.body) {
        e.preventDefault();
        if (reelRunning) stopReel();
        else playReel();
      }
      return;
    }
    if (downKeys.has(e.key)) return;
    downKeys.add(e.key);
    if (mode === 'keys') noteDown(m);
    else if (mode === 'draw') setDrawNote(m - 12);
  });
  window.addEventListener('keyup', (e) => {
    downKeys.delete(e.key);
    const m = KEYMAP[e.key.toLowerCase()];
    if (m !== undefined && mode === 'keys') noteUp(m);
  });
  window.addEventListener('blur', () => {
    downKeys.clear();
    if (mode === 'keys' && !hold) releaseAll();
  });

  // ---------------------------------------------------------------- draw

  /** Drawn strokes in tube units: each a flat x, y list. */
  let strokes: number[][] = [];
  let drawing: number[] | null = null;
  const drawRead = $<HTMLElement>('[data-draw-read]');
  const drawPrompt = drawRead.textContent ?? '';

  function setDrawNote(m: number): void {
    touch();
    void startAudio();
    drawNote = m;
    send({ type: 'pitch', freq: midiToFreq(m) });
    updateDrawRead();
    markKeys();
  }

  function sendDrawing(): void {
    const xs: number[] = [];
    const ys: number[] = [];
    const pens: number[] = [];
    let budget = 5900;
    for (const stroke of strokes) {
      for (let i = 0; i < stroke.length && budget > 0; i += 2) {
        xs.push(stroke[i]);
        ys.push(stroke[i + 1]);
        pens.push(i === 0 ? 0 : 1);
        budget--;
      }
    }
    // A single stroke that ends near where it began is a closed shape, so draw that last gap.
    let closed = false;
    if (strokes.length === 1 && xs.length > 2) {
      closed = Math.hypot(xs[0] - xs[xs.length - 1], ys[0] - ys[ys.length - 1]) < 0.15;
    }
    send({ type: 'path', xs, ys, pens, closed });
    send({ type: 'pitch', freq: midiToFreq(drawNote) });
    send({ type: 'gate', on: xs.length > 1 });
  }

  function updateDrawRead(): void {
    if (!strokes.length) {
      drawRead.textContent = drawPrompt;
      return;
    }
    const f = midiToFreq(drawNote);
    const samples = Math.round(beam.sampleRate / f);
    drawRead.textContent = `${noteName(drawNote)}: your shape, ${f.toFixed(1)} times a second, ${samples} samples each time. Lower notes draw it more finely. Higher ones cut its corners.`;
  }

  const toTube = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - beam.view.cx) / beam.view.r,
      y: -(e.clientY - rect.top - beam.view.cy) / beam.view.r,
    };
  };

  const shapesHost = $<HTMLElement>('[data-shapes]');
  const SHAPES: { label: string; make: () => number[][] }[] = [
    { label: 'Circle', make: () => [polygon(96, 0.75, 0)] },
    { label: 'Triangle', make: () => [polygon(3, 0.8, Math.PI / 2)] },
    { label: 'Square', make: () => [polygon(4, 0.85, Math.PI / 4)] },
    { label: 'Star', make: () => [star(5, 0.82, 0.32)] },
    { label: 'Clear', make: () => [] },
  ];
  function polygon(n: number, r: number, a0: number): number[] {
    const out: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      out.push(r * Math.cos(a), r * Math.sin(a));
    }
    return out;
  }
  function star(n: number, r: number, inner: number): number[] {
    const out: number[] = [];
    for (let i = 0; i <= n * 2; i++) {
      const a = Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
      const q = i % 2 ? inner : r;
      out.push(q * Math.cos(a), q * Math.sin(a));
    }
    return out;
  }
  for (const shape of SHAPES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = shape.label;
    chip.addEventListener('click', () => {
      touch();
      void startAudio();
      strokes = shape.make();
      if (strokes.length) sendDrawing();
      else send({ type: 'gate', on: false });
      updateDrawRead();
    });
    shapesHost.append(chip);
  }

  let drawFramePending = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'draw') return;
    e.preventDefault();
    touch();
    void startAudio();
    canvas.setPointerCapture?.(e.pointerId);
    const p = toTube(e);
    // A fresh gesture starts a fresh drawing if the last one has been sounding a while.
    if (e.shiftKey === false && strokes.length && performance.now() - lastStrokeEnd > 2500) strokes = [];
    drawing = [p.x, p.y];
    strokes.push(drawing);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drawing) {
      touch();
      // The coalesced list can come back empty, which must not lose the move itself.
      const moves = e.getCoalescedEvents?.() ?? [];
      for (const ev of moves.length ? moves : [e]) {
        const p = toTube(ev);
        const n = drawing.length;
        if (Math.hypot(p.x - drawing[n - 2], p.y - drawing[n - 1]) > 0.006) drawing.push(p.x, p.y);
      }
      if (!drawFramePending) {
        drawFramePending = true;
        requestAnimationFrame(() => {
          drawFramePending = false;
          sendDrawing();
        });
      }
    } else if (mode === 'reel' && !reelRunning) {
      const p = toTube(e);
      send({ type: 'pointer', x: Math.max(-1.6, Math.min(1.6, p.x)), y: Math.max(-1.2, Math.min(1.2, p.y)) });
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (mode !== 'reel' || reelRunning) return;
    if (e.target === canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (e.clientY > rect.bottom) return;
    const x = (e.clientX - rect.left - beam.view.cx) / beam.view.r;
    const y = -(e.clientY - rect.top - beam.view.cy) / beam.view.r;
    send({ type: 'pointer', x: Math.max(-1.6, Math.min(1.6, x)), y: Math.max(-1.2, Math.min(1.2, y)) });
  });
  let lastStrokeEnd = 0;
  const endStroke = () => {
    if (!drawing) return;
    drawing = null;
    lastStrokeEnd = performance.now();
    sendDrawing();
    updateDrawRead();
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  // ---------------------------------------------------------------- type

  const textInput = $<HTMLInputElement>('[data-text]');
  const typeRead = $<HTMLElement>('[data-type-read]');
  const typePrompt = typeRead.textContent ?? '';
  const measure = new Path(6000);
  const DEFAULT_TEXT = 'hello';

  function sendText(): void {
    const text = textInput.value.trim() || (textInput.value ? '' : DEFAULT_TEXT);
    measure.clear();
    setText(measure, text);
    measure.finish(false);
    if (!measure.n) {
      send({ type: 'gate', on: false });
      typeRead.textContent = typePrompt;
      return;
    }
    const xs = Array.from(measure.xs.subarray(0, measure.n));
    const ys = Array.from(measure.ys.subarray(0, measure.n));
    const pensArr = new Uint8Array(measure.n);
    measure.copyPens(pensArr);
    send({ type: 'path', xs, ys, pens: Array.from(pensArr), closed: false });
    // How long a pass has to be to keep the letters clean, snapped down to a real note so
    // that every sentence is in tune with something.
    const needed = measure.total / 0.016;
    const ideal = beam.sampleRate / Math.max(needed, 1);
    const m = Math.max(16, Math.min(57, Math.floor(69 + 12 * Math.log2(Math.max(ideal, 1) / 440))));
    const f = midiToFreq(m);
    send({ type: 'pitch', freq: f });
    send({ type: 'gate', on: true });
    const chars = [...text.replace(/\s/g, '')].length;
    typeRead.textContent = `${chars} ${chars === 1 ? 'letter' : 'letters'}, redrawn ${f < 100 ? f.toFixed(1) : f.toFixed(0)} times a second: that makes it the note ${noteName(m)}.${f < 40 ? ' The eye starts to catch it flickering about here.' : ''}`;
  }
  textInput.addEventListener('input', () => {
    touch();
    void startAudio();
    sendText();
  });

  // ---------------------------------------------------------------- listen

  const fileInput = $<HTMLInputElement>('[data-file]');
  const micButton = $<HTMLButtonElement>('[data-mic]');
  const stopButton = $<HTMLButtonElement>('[data-listen-stop]');
  const listenRead = $<HTMLElement>('[data-listen-read]');
  const listenPrompt = listenRead.textContent ?? '';
  let micStream: MediaStream | null = null;
  let micNode: MediaStreamAudioSourceNode | null = null;
  let fileNode: AudioBufferSourceNode | null = null;

  function stopListening(): void {
    if (fileNode) {
      fileNode.onended = null;
      try {
        fileNode.stop();
      } catch {}
      fileNode.disconnect();
      fileNode = null;
    }
    if (micNode) {
      micNode.disconnect();
      micNode = null;
    }
    if (micStream) {
      for (const track of micStream.getTracks()) track.stop();
      micStream = null;
    }
    micButton.setAttribute('aria-pressed', 'false');
    stopButton.hidden = true;
    listenRead.textContent = listenPrompt;
    applyVolume();
  }

  async function playFile(file: File): Promise<void> {
    touch();
    stopListening();
    await startAudio();
    if (!ctx || !node) {
      listenRead.textContent = "This browser wouldn't start its audio, so there's nothing to play the file through.";
      return;
    }
    listenRead.textContent = 'Decoding…';
    try {
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(node);
      source.onended = () => {
        if (fileNode === source) stopListening();
      };
      source.start();
      fileNode = source;
      signalMode('listen');
      stopButton.hidden = false;
      listenRead.textContent = `${clock(buffer.duration)}, ${buffer.numberOfChannels === 1 ? 'mono, twisted against itself' : 'stereo, drawn exactly as recorded'}. Mostly-mono mixes hug the diagonal. Wide ones fill the screen.`;
    } catch {
      listenRead.textContent = "That file wouldn't decode in this browser.";
    }
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void playFile(file);
    fileInput.value = '';
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      setPanel('listen');
      if (reelRunning) stopReel();
      void playFile(file);
    }
  });

  micButton.addEventListener('click', async () => {
    touch();
    if (micStream) {
      stopListening();
      return;
    }
    stopListening();
    await startAudio();
    if (!ctx || !node) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
      micNode = ctx.createMediaStreamSource(micStream);
      micNode.connect(node);
      signalMode('listen');
      micButton.setAttribute('aria-pressed', 'true');
      listenRead.textContent =
        "Speakers are off so it can't howl. Hold a steady note or a vowel and it curls into a loop. Change Twist to reshape it.";
      applyVolume();
    } catch {
      micStream = null;
      listenRead.textContent = "No microphone: the browser didn't get permission for one, or there isn't one.";
    }
  });
  stopButton.addEventListener('click', stopListening);
  $<HTMLInputElement>('[data-twist]').addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value) / 100;
    send({ type: 'twist', ms: 0.1 + 24 * v * v });
  });

  // ---------------------------------------------------------------- the bench

  const benchInputs = $$<HTMLInputElement>('[data-bench]');
  const resetButton = $<HTMLButtonElement>('[data-reset]');
  const hz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${Math.round(f)} Hz`);
  const FORMAT: Record<BenchName, (k: number) => string> = {
    treble: (k) => (k < 0.001 ? 'off' : hz(20000 * (60 / 20000) ** k)),
    bass: (k) => (k < 0.001 ? 'off' : hz(15 * (2400 / 15) ** k)),
    drive: (k) => (k < 0.001 ? 'off' : `x${(1 + 11 * k * k).toFixed(1)}`),
    crush: (k) => (k < 0.001 ? 'off' : `${(10.5 - 9.2 * k).toFixed(1)} bit`),
    echo: (k) => (k < 0.001 ? 'off' : `${(1.5 * (180 / 1.5) ** k).toFixed(k > 0.5 ? 0 : 1)} ms`),
    spin: (k) => (k < 0.001 ? 'off' : `${(400 * k * k).toFixed(k < 0.3 ? 1 : 0)} Hz`),
    width: (k) => (Math.abs(k - 0.5) < 0.005 ? 'stereo' : k < 0.005 ? 'mono' : `${Math.round(k * 200)}%`),
  };

  function benchInput(input: HTMLInputElement): void {
    const name = input.dataset.bench as BenchName;
    const k = Number(input.value) / 100;
    send({ type: 'bench', name, value: k });
    const out = $<HTMLElement>(`[data-out="${name}"]`);
    out.textContent = FORMAT[name](k);
    const touched = benchInputs.some((b) => b.value !== (b.dataset.bench === 'width' ? '50' : '0'));
    resetButton.hidden = !touched;
    touch();
  }
  for (const input of benchInputs) {
    input.addEventListener('input', () => benchInput(input));
    $<HTMLElement>(`[data-out="${input.dataset.bench}"]`).textContent = FORMAT[input.dataset.bench as BenchName](
      Number(input.value) / 100,
    );
  }
  resetButton.addEventListener('click', () => {
    for (const input of benchInputs) {
      input.value = input.dataset.bench === 'width' ? '50' : '0';
      benchInput(input);
    }
  });

  // Tube controls change only the picture, so they never touch the signal.
  const phosphorButtons = $$<HTMLButtonElement>('[data-phosphor-pick]');
  function setPhosphor(id: PhosphorId): void {
    beam.phosphor = id;
    el.dataset.phosphor = id;
    el.style.setProperty('--glow', PHOSPHORS[id].ui);
    for (const b of phosphorButtons) b.setAttribute('aria-pressed', String(b.dataset.phosphorPick === id));
    beam.clear();
    try {
      localStorage.setItem('xy-phosphor', id);
    } catch {}
  }
  for (const b of phosphorButtons) b.addEventListener('click', () => setPhosphor(b.dataset.phosphorPick as PhosphorId));

  function tubeInput(input: HTMLInputElement): void {
    const v = Number(input.value) / 100;
    switch (input.dataset.tubeSet) {
      case 'persist':
        beam.persistence = 0.35 * 18 ** v;
        break;
      case 'focus':
        beam.focus = 0.72 * 9 ** v;
        break;
      case 'bright':
        beam.intensity = 16 ** (v - 0.5);
        break;
      case 'illum':
        beam.illum = v * 2.2;
        break;
    }
  }
  for (const input of $$<HTMLInputElement>('[data-tube-set]')) {
    input.addEventListener('input', () => tubeInput(input));
    tubeInput(input);
  }
  $<HTMLInputElement>('[data-volume]').addEventListener('input', applyVolume);

  // ---------------------------------------------------------------- record

  const recordButton = $<HTMLButtonElement>('[data-record]');
  recordButton.addEventListener('click', () => {
    touch();
    if (recording) {
      finishRecording();
    } else {
      void startAudio();
      recording = [];
      recorded = 0;
      recordButton.setAttribute('aria-pressed', 'true');
      recordButton.textContent = 'Stop and save';
    }
  });

  function finishRecording(): void {
    if (!recording) return;
    const chunks = recording;
    const frames = recorded;
    recording = null;
    recordButton.setAttribute('aria-pressed', 'false');
    recordButton.textContent = 'Record a WAV';
    if (!frames) return;
    const bytes = new ArrayBuffer(44 + frames * 4);
    const view = new DataView(bytes);
    const text = (at: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
    };
    const rate = beam.sampleRate;
    text(0, 'RIFF');
    view.setUint32(4, 36 + frames * 4, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, frames * 4, true);
    let at = 44;
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.length; i++) {
        const v = Math.max(-1, Math.min(1, chunk[i]));
        view.setInt16(at, v * 32767, true);
        at += 2;
      }
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'xy-mode.wav';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------------------------------------------------------------- housekeeping

  // A tone that nobody is attending to shouldn't drone on in the background. Reel and Keys stop
  // by themselves, but Draw and Type hold a note for as long as there's a picture.
  let lastTouch = performance.now();
  let idleMute = false;
  function touch(): void {
    lastTouch = performance.now();
    if (idleMute) {
      idleMute = false;
      applyVolume();
    }
  }
  window.addEventListener('pointerdown', touch, { passive: true });
  window.addEventListener('keydown', touch, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });

  function layout(): void {
    const rect = canvas.getBoundingClientRect();
    const s = slot.getBoundingClientRect();
    const r = Math.max(40, Math.min(s.width, s.height) / 2);
    beam.resize({ cx: s.left - rect.left + s.width / 2, cy: s.top - rect.top + s.height / 2, r });
  }
  new ResizeObserver(layout).observe(slot);
  new ResizeObserver(layout).observe(canvas);
  window.addEventListener('resize', layout);
  setPanel('reel');
  send({ type: 'mode', mode: 'idle' });
  try {
    const saved = localStorage.getItem('xy-phosphor') as PhosphorId | null;
    if (saved && saved in PHOSPHORS) setPhosphor(saved);
  } catch {}

  // ---------------------------------------------------------------- the loop

  let lastTime = performance.now();
  let carry = 0;

  function frame(now: number): void {
    const dt = Math.max(0, (now - lastTime) / 1000);
    lastTime = now;
    if (!audioLive) {
      // No sound yet: the same signal, computed here and shown silently.
      carry += Math.min(dt, 0.1) * local.sampleRateValue;
      const want = Math.min(8192, Math.floor(carry));
      carry -= want;
      if (want > 0) {
        local.render(localX, localY, want);
        for (let i = 0; i < want; i++) {
          localOut[i * 2] = localX[i];
          localOut[i * 2 + 1] = localY[i];
        }
        onSamples(localOut.subarray(0, want * 2));
      }
      status = local.status();
    }
    beam.frame(dt);
    updateReel();
    if (audioLive && (mode === 'draw' || mode === 'type') && !idleMute && now - lastTouch > 60000) {
      idleMute = true;
      applyVolume();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (debug) {
    Object.assign(window, {
      xy: {
        local,
        beam,
        go,
        playReel,
        stopReel,
        send,
        setPhosphor,
        finished: () => finished,
        status: () => status,
        audioLive: () => audioLive,
        startAudio,
        ctx: () => ctx,
        node: () => node,
      },
    });
  }
}

if (root) start(root);
