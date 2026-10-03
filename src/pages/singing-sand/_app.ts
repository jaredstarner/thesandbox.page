import { MAX_FREQ, MIN_FREQ, Plate, Sand, modes, type Mode } from './_plate';
import { Ear, Voice } from './_sound';

const GRAINS = 22000;
const START_MODE = 9;
const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

const toSlider = (f: number) => Math.round((1000 * Math.log(f / MIN_FREQ)) / Math.log(MAX_FREQ / MIN_FREQ));
const fromSlider = (v: number) => MIN_FREQ * (MAX_FREQ / MIN_FREQ) ** (v / 1000);

export function startPlate(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const sandCanvas = q<HTMLCanvasElement>('[data-sand]');
  const waveCanvas = q<HTMLCanvasElement>('[data-wave-layer]');
  const slider = q<HTMLInputElement>('[data-freq]');
  const prev = q<HTMLButtonElement>('[data-prev]');
  const next = q<HTMLButtonElement>('[data-next]');
  const soundButton = q<HTMLButtonElement>('[data-sound]');
  const singButton = q<HTMLButtonElement>('[data-sing]');
  const waveButton = q<HTMLButtonElement>('[data-wave]');
  const scatterButton = q<HTMLButtonElement>('[data-scatter]');
  const hz = q<HTMLElement>('[data-hz]');
  const modeLabel = q<HTMLElement>('[data-mode]');
  const status = q<HTMLElement>('[data-status]');

  const plate = new Plate();
  const sand = new Sand(GRAINS);
  const ctx = sandCanvas.getContext('2d')!;
  const waveCtx = waveCanvas.getContext('2d')!;
  const wave = waveCtx.createImageData(plate.grid, plate.grid);
  const wavePixels = new Uint32Array(wave.data.buffer);
  waveCanvas.width = waveCanvas.height = plate.grid;

  const style = getComputedStyle(root);
  const sandRgb = cssColor(style.getPropertyValue('--color-sand'));
  const waveRgb = cssColor(style.getPropertyValue('--color-accent'));
  const palette = Uint32Array.from([0.72, 0.86, 1, 1.12], (k) => pack(sandRgb.map((c) => c * k), 255));

  let image = ctx.createImageData(1, 1);
  let pixels = new Uint32Array(image.data.buffer);
  let dot = 1;

  let freq = modes[START_MODE]!.freq;
  let drive = 1;
  let audio: AudioContext | null = null;
  let voice: Voice | null = null;
  let ear: Ear | null = null;
  let soundOn = false;
  let showWave = false;
  let frameCount = 0;
  let shownHz = '';
  let shownMode: Mode | null | undefined;

  slider.value = String(toSlider(freq));

  // ---- sizing ---------------------------------------------------------------

  function resize(): void {
    const size = Math.min(1100, Math.round(sandCanvas.clientWidth * Math.min(devicePixelRatio, 2)));
    if (size < 1 || size === sandCanvas.width) return;
    sandCanvas.width = sandCanvas.height = size;
    image = ctx.createImageData(size, size);
    pixels = new Uint32Array(image.data.buffer);
    dot = Math.max(1, Math.round(size / 550));
  }
  new ResizeObserver(resize).observe(sandCanvas);
  resize();

  // ---- drawing ----------------------------------------------------------------

  function drawSand(): void {
    const size = sandCanvas.width;
    const span = size - dot;
    pixels.fill(0);
    for (let i = 0; i < sand.count; i++) {
      const px = Math.round(sand.x[i]! * span);
      const py = Math.round(sand.y[i]! * span);
      const color = palette[sand.shade[i]!]!;
      for (let dy = 0; dy < dot; dy++) {
        const row = (py + dy) * size + px;
        for (let dx = 0; dx < dot; dx++) pixels[row + dx] = color;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  function drawWave(): void {
    const { field } = plate;
    for (let i = 0; i < field.length; i++) {
      wavePixels[i] = pack(waveRgb, Math.min(1, field[i]! / 2) * 150);
    }
    waveCtx.putImageData(wave, 0, 0);
  }

  // ---- readout ----------------------------------------------------------------

  function noteName(f: number): string {
    const midi = Math.round(69 + 12 * Math.log2(f / 440));
    return `${NOTES[midi % 12]}${Math.floor(midi / 12) - 1}`;
  }

  function updateReadout(): void {
    const text = `${Math.round(freq)} Hz · ${noteName(freq)}`;
    if (text !== shownHz) hz.textContent = shownHz = text;

    const mode = plate.resonance > 0.5 ? plate.strongest : null;
    if (mode === shownMode) return;
    shownMode = mode;
    modeLabel.textContent = mode ? `mode (${mode.n}, ${mode.m})${mode.sign > 0 ? '′' : ''}` : 'between resonances';
    root.toggleAttribute('data-resonant', mode !== null);
  }

  // ---- controls ---------------------------------------------------------------

  function setFreq(f: number, moveSlider = true): void {
    freq = Math.min(MAX_FREQ, Math.max(MIN_FREQ, f));
    if (moveSlider) slider.value = String(toSlider(freq));
  }

  function getAudio(): AudioContext {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    return audio;
  }

  slider.addEventListener('input', () => setFreq(fromSlider(Number(slider.value)), false));

  prev.addEventListener('click', () => {
    const below = modes.filter((m) => m.freq < freq / 1.001).at(-1);
    if (below) setFreq(below.freq);
  });

  next.addEventListener('click', () => {
    const above = modes.find((m) => m.freq > freq * 1.001);
    if (above) setFreq(above.freq);
  });

  soundButton.addEventListener('click', () => {
    soundOn = !soundOn;
    if (soundOn) voice ??= new Voice(getAudio());
    soundButton.setAttribute('aria-pressed', String(soundOn));
    soundButton.textContent = soundOn ? 'Sound on' : 'Sound off';
  });

  singButton.addEventListener('click', async () => {
    if (ear) {
      stopListening();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'This browser has no microphone access, so the slider drives the plate.';
      return;
    }
    singButton.disabled = true;
    try {
      ear = await Ear.open(getAudio());
      singButton.setAttribute('aria-pressed', 'true');
      singButton.textContent = 'Stop listening';
      slider.disabled = prev.disabled = next.disabled = true;
      status.textContent = 'Listening. Hum or sing a steady note; the plate only moves while it hears you.';
      drive = 0;
    } catch {
      status.textContent = 'No microphone, so the slider drives the plate.';
    } finally {
      singButton.disabled = false;
    }
  });

  function stopListening(): void {
    ear?.close();
    ear = null;
    drive = 1;
    singButton.setAttribute('aria-pressed', 'false');
    singButton.textContent = 'Sing to it';
    slider.disabled = prev.disabled = next.disabled = false;
    status.textContent = '';
  }

  waveButton.addEventListener('click', () => {
    showWave = !showWave;
    waveButton.setAttribute('aria-pressed', String(showWave));
    waveCanvas.hidden = !showWave;
  });

  scatterButton.addEventListener('click', () => sand.scatter());

  // Pour sand by pressing on the plate.
  let pouring = false;
  function pourAt(event: PointerEvent): void {
    const rect = sandCanvas.getBoundingClientRect();
    sand.pour((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, 90, 0.025);
  }
  sandCanvas.addEventListener('pointerdown', (event) => {
    pouring = true;
    sandCanvas.setPointerCapture(event.pointerId);
    pourAt(event);
  });
  sandCanvas.addEventListener('pointermove', (event) => {
    if (pouring) pourAt(event);
  });
  const stopPouring = () => (pouring = false);
  sandCanvas.addEventListener('pointerup', stopPouring);
  sandCanvas.addEventListener('pointercancel', stopPouring);

  // Hush when the tab is hidden; animation frames stop, oscillators don't.
  document.addEventListener('visibilitychange', () => {
    if (!audio) return;
    if (document.hidden) void audio.suspend();
    else if (soundOn || ear) void audio.resume();
  });

  // ---- loop -------------------------------------------------------------------

  function frame(): void {
    frameCount++;

    // Pitch tracking is the costliest step; every other frame is plenty.
    if (ear && frameCount % 2 === 0) {
      const { pitch, level } = ear.listen(MIN_FREQ, MAX_FREQ);
      const target = pitch ? Math.min(1, Math.max(0, (level - 0.01) * 15)) : 0;
      drive += (target - drive) * 0.2;
      // Glide in log space, so octaves feel even.
      if (pitch && pitch >= MIN_FREQ && pitch <= MAX_FREQ) setFreq(freq * (pitch / freq) ** 0.3);
    }

    plate.tune(freq, drive);
    sand.step(plate);
    drawSand();
    if (showWave) drawWave();
    updateReadout();

    if (voice) voice.set(freq, soundOn && !ear ? 0.03 + 0.17 * plate.resonance : 0);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/** Any CSS color as [r, g, b]. */
function cssColor(value: string): number[] {
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.fillStyle = value.trim() || '#d9b779';
  probe.fillRect(0, 0, 1, 1);
  return Array.from(probe.getImageData(0, 0, 1, 1).data.slice(0, 3));
}

/** An RGBA pixel for a little-endian Uint32Array view of ImageData. */
function pack([r = 0, g = 0, b = 0]: number[], alpha: number): number {
  const c = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return ((c(alpha) << 24) | (c(b) << 16) | (c(g) << 8) | c(r)) >>> 0;
}
