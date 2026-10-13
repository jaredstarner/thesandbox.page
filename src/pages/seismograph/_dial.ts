// The world as the station hears it: an azimuthal equidistant map centred on
// the station, so distance from the middle is distance over the surface and
// a quake's waves come in along a straight spoke. Rings every 30 degrees,
// and the band where the core hides direct P waves.

import { LAND_STEP } from './_landstep';
import type { Station } from './_stations';
import { geo } from './_travel';

const RAD = Math.PI / 180;

export interface DialQuake {
  id: string;
  lat: number;
  lon: number;
  mag: number;
  felt: boolean;
}

/** Unpacks the build-time land bitmap into dot coordinates, matching gridRows() in _land.ts. */
export function landDots(b64: string): Float32Array {
  const bin = atob(b64);
  const out: number[] = [];
  let k = 0;
  for (let lat = -90 + LAND_STEP / 2; lat < 90; lat += LAND_STEP) {
    const n = Math.max(1, Math.round((360 * Math.cos(lat * RAD)) / LAND_STEP));
    for (let i = 0; i < n; i++, k++) {
      if (bin.charCodeAt(k >> 3) & (1 << (7 - (k & 7)))) out.push(lat, -180 + ((i + 0.5) * 360) / n);
    }
  }
  return new Float32Array(out);
}

export class Dial {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dots: Float32Array;
  private station: Station | null = null;
  private quakes: DialQuake[] = [];
  private selected: string | null = null;
  /** Projected land, cached per station and size: x, y pairs in CSS px. */
  private land: Float32Array | null = null;
  private size = 0;
  private dpr = 1;
  private font = 'monospace';

  constructor(canvas: HTMLCanvasElement, landB64: string) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.dots = landDots(landB64);
  }

  setStation(s: Station): void {
    this.station = s;
    this.land = null;
    this.draw();
  }

  setQuakes(q: DialQuake[]): void {
    this.quakes = q;
    this.draw();
  }

  select(id: string | null): void {
    this.selected = id;
    this.draw();
  }

  resize(): void {
    const size = Math.round(this.canvas.clientWidth);
    if (!size) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = size;
    this.canvas.width = Math.round(size * this.dpr);
    this.canvas.height = Math.round(size * this.dpr);
    this.font = getComputedStyle(this.canvas).getPropertyValue('--m').trim() || 'monospace';
    this.land = null;
    this.draw();
  }

  private get radius(): number {
    return this.size / 2 - 20;
  }

  private project(lat: number, lon: number): { x: number; y: number; dist: number; az: number } {
    const s = this.station!;
    const { dist, az } = geo(s.lat, s.lon, lat, lon);
    const r = (dist / 180) * this.radius;
    return { x: this.size / 2 + r * Math.sin(az * RAD), y: this.size / 2 - r * Math.cos(az * RAD), dist, az };
  }

  draw(): void {
    if (!this.station || !this.size) return;
    const { ctx, size } = this;
    const c = size / 2;
    const R = this.radius;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // The face.
    const face = ctx.createRadialGradient(c, c * 0.8, R * 0.1, c, c, R);
    face.addColorStop(0, '#1f1c17');
    face.addColorStop(1, '#100e0b');
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fill();

    // The core's shadow: P waves skip from about 103 to 140 degrees.
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, (140 / 180) * R, 0, Math.PI * 2);
    ctx.arc(c, c, (103 / 180) * R, 0, Math.PI * 2, true);
    ctx.clip();
    ctx.strokeStyle = 'rgba(232, 163, 58, 0.10)';
    ctx.lineWidth = 1;
    for (let d = -size; d < size * 2; d += 5) {
      ctx.beginPath();
      ctx.moveTo(d, 0);
      ctx.lineTo(d - size, size);
      ctx.stroke();
    }
    ctx.restore();

    // Land.
    if (!this.land) {
      const pts = new Float32Array(this.dots.length);
      for (let i = 0; i < this.dots.length; i += 2) {
        const p = this.project(this.dots[i], this.dots[i + 1]);
        pts[i] = p.x;
        pts[i + 1] = p.y;
      }
      this.land = pts;
    }
    ctx.fillStyle = 'rgba(217, 210, 191, 0.42)';
    const dot = Math.max(1.1, size / 300);
    for (let i = 0; i < this.land.length; i += 2) ctx.fillRect(this.land[i] - dot / 2, this.land[i + 1] - dot / 2, dot, dot);

    // Range rings and their labels.
    ctx.font = `400 9px ${this.font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const d of [30, 60, 90, 120, 150]) {
      const r = (d / 180) * R;
      ctx.strokeStyle = d === 90 ? 'rgba(217, 210, 191, 0.32)' : 'rgba(217, 210, 191, 0.16)';
      ctx.setLineDash(d === 90 ? [] : [2, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const label = `${d}°`;
      const lx = c + r * Math.cos(-Math.PI / 4) + 3;
      const ly = c + r * Math.sin(-Math.PI / 4) - 3;
      ctx.fillStyle = 'rgba(16, 14, 11, 0.8)';
      const w = ctx.measureText(label).width;
      ctx.fillRect(lx - 2, ly - 6, w + 4, 12);
      ctx.fillStyle = 'rgba(217, 210, 191, 0.6)';
      ctx.fillText(label, lx, ly);
    }

    // The rim: compass ticks every 10 degrees.
    ctx.strokeStyle = '#3a352c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(217, 210, 191, 0.4)';
    ctx.lineWidth = 1;
    for (let a = 0; a < 360; a += 10) {
      const len = a % 90 === 0 ? 7 : a % 30 === 0 ? 4 : 2;
      const s = Math.sin(a * RAD);
      const k = -Math.cos(a * RAD);
      ctx.beginPath();
      ctx.moveTo(c + s * R, c + k * R);
      ctx.lineTo(c + s * (R + len), c + k * (R + len));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(217, 210, 191, 0.75)';
    ctx.font = `700 10px ${this.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [l, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
      ctx.fillText(l, c + Math.sin(a * RAD) * (R + 14), c - Math.cos(a * RAD) * (R + 14));
    }

    // Quakes, smallest first so the big ones sit on top.
    const sel = this.quakes.find((q) => q.id === this.selected);
    if (sel) {
      const p = this.project(sel.lat, sel.lon);
      ctx.strokeStyle = 'rgba(255, 122, 92, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(c, c);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const sorted = [...this.quakes].sort((a, b) => a.mag - b.mag);
    for (const q of sorted) {
      const p = this.project(q.lat, q.lon);
      const r = Math.max(1.5, (q.mag - 2.5) * 1.9);
      const on = q.id === this.selected;
      ctx.beginPath();
      ctx.arc(p.x, p.y, on ? r + 1.5 : r, 0, Math.PI * 2);
      if (q.felt) {
        ctx.fillStyle = on ? 'rgba(255, 122, 92, 0.55)' : 'rgba(232, 163, 58, 0.28)';
        ctx.fill();
        ctx.strokeStyle = on ? '#ff7a5c' : 'rgba(232, 163, 58, 0.95)';
        ctx.lineWidth = on ? 2 : 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(217, 210, 191, 0.3)';
        ctx.fill();
      }
    }

    // The station: a triangle, as seismic maps mark them.
    ctx.fillStyle = '#e8a33a';
    ctx.strokeStyle = '#100e0b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c, c - 7);
    ctx.lineTo(c + 6.5, c + 5);
    ctx.lineTo(c - 6.5, c + 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.font = `700 10px ${this.font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(16, 14, 11, 0.8)';
    const code = this.station.code;
    const w = ctx.measureText(code).width;
    ctx.fillRect(c + 9, c - 6, w + 6, 13);
    ctx.fillStyle = '#e8a33a';
    ctx.fillText(code, c + 12, c + 0.5);
  }

  /** The quake drawn nearest a point on the dial, within reach of a finger. */
  hit(x: number, y: number): string | null {
    if (!this.station) return null;
    let best: string | null = null;
    let bestD = 14;
    for (const q of this.quakes) {
      if (!q.felt) continue;
      const p = this.project(q.lat, q.lon);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = q.id;
      }
    }
    return best;
  }
}
