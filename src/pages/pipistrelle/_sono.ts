// The detector's sonogram: what you hear, as frequency against time, scrolling
// left. Labelled in the bat's own kilohertz, ten times what is played.

import { DIVIDE } from './_sound';

/** Top of the chart, in the bat's kHz. */
const TOP_KHZ = 120;
const SPEED = 110; // CSS px per second

export class Sonogram {
  private ctx: CanvasRenderingContext2D;
  private lut = new Uint8ClampedArray(256 * 4);
  private bins: Uint8Array<ArrayBuffer> | null = null;
  private col: ImageData | null = null;
  private acc = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    // Ink to deep teal to the echo colour to near white.
    const stops: [number, number, number, number][] = [
      [0, 3, 6, 10],
      [0.32, 8, 46, 52],
      [0.62, 92, 170, 152],
      [0.84, 214, 236, 228],
      [1, 255, 248, 226],
    ];
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let k = 0;
      while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      const [t0, r0, g0, b0] = stops[k];
      const [t1, r1, g1, b1] = stops[k + 1];
      const u = (t - t0) / (t1 - t0);
      this.lut[i * 4] = r0 + (r1 - r0) * u;
      this.lut[i * 4 + 1] = g0 + (g1 - g0) * u;
      this.lut[i * 4 + 2] = b0 + (b1 - b0) * u;
      this.lut[i * 4 + 3] = 255;
    }
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * this.dpr));
    const h = Math.max(1, Math.round(r.height * this.dpr));
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.fillStyle = 'rgb(3, 6, 10)';
    this.ctx.fillRect(0, 0, w, h);
    this.col = this.ctx.createImageData(1, h);
  }

  draw(dt: number, analyser: AnalyserNode | null, sampleRate: number): void {
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!this.col || this.col.height !== H) this.col = c.createImageData(1, H);
    this.acc += dt * SPEED * this.dpr;
    const shift = Math.floor(this.acc);
    if (shift < 1) return;
    this.acc -= shift;
    c.drawImage(this.canvas, -shift, 0);
    const col = this.col;
    const d = col.data;
    if (analyser) {
      if (!this.bins || this.bins.length !== analyser.frequencyBinCount) {
        this.bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      }
      analyser.getByteFrequencyData(this.bins);
      const nyquist = sampleRate / 2;
      const hzPerBin = nyquist / this.bins.length;
      for (let y = 0; y < H; y++) {
        const khz = (1 - (y + 0.5) / H) * TOP_KHZ;
        const hz = (khz * 1000) / DIVIDE;
        const fb = hz / hzPerBin;
        const b0 = Math.floor(fb);
        const t = fb - b0;
        const v = (this.bins[b0] ?? 0) * (1 - t) + (this.bins[b0 + 1] ?? 0) * t;
        const i = Math.max(0, Math.min(255, Math.round(v))) * 4;
        d[y * 4] = this.lut[i];
        d[y * 4 + 1] = this.lut[i + 1];
        d[y * 4 + 2] = this.lut[i + 2];
        d[y * 4 + 3] = 255;
      }
    } else {
      for (let y = 0; y < H; y++) {
        d[y * 4] = 3;
        d[y * 4 + 1] = 6;
        d[y * 4 + 2] = 10;
        d[y * 4 + 3] = 255;
      }
    }
    // A faint line at 45 kHz, where a common pipistrelle's calls end.
    const y45 = Math.round((1 - 45 / TOP_KHZ) * H);
    if (y45 >= 0 && y45 < H) {
      d[y45 * 4] = Math.max(d[y45 * 4], 70);
      d[y45 * 4 + 1] = Math.max(d[y45 * 4 + 1], 50);
      d[y45 * 4 + 2] = Math.max(d[y45 * 4 + 2], 22);
    }
    for (let x = W - shift; x < W; x++) c.putImageData(col, x, 0);
  }
}
