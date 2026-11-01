// The cloud chart: temperature across, vapour up, with the habits the page's crystals take in
// each part of it, the path the falling crystal has taken, and where it is now.

import { clampWeather, T_COLD, T_WARM, type Weather } from './_weather';

/** Temperature, vapour, and the update it was recorded at. */
export type Trail = [number, number, number][];

/** Plot margins in CSS pixels. */
const M = { l: 30, r: 10, t: 10, b: 26 };

const REGIONS: { label: string; t: number; v: number; rt: number; rv: number; tint: string }[] = [
  { label: 'fernlike', t: -15, v: 0.87, rt: 1.5, rv: 0.15, tint: '120, 175, 255' },
  { label: 'stellar dendrites', t: -15, v: 0.5, rt: 2.3, rv: 0.27, tint: '120, 165, 245' },
  { label: 'sectored', t: -15, v: 0.1, rt: 2.1, rv: 0.12, tint: '160, 195, 245' },
  { label: 'stellar plates', t: -12.5, v: 0.74, rt: 1.15, rv: 0.24, tint: '170, 205, 250' },
  { label: 'stellar plates', t: -17.5, v: 0.74, rt: 1.15, rv: 0.24, tint: '170, 205, 250' },
  { label: 'plates', t: -10.9, v: 0.3, rt: 1.0, rv: 0.32, tint: '210, 228, 250' },
  { label: 'plates', t: -19.1, v: 0.3, rt: 1.0, rv: 0.32, tint: '210, 228, 250' },
];

const STOPS: [number, number, number][] = [
  [0.62, 0.86, 1.0],
  [0.48, 0.52, 1.0],
  [0.9, 0.45, 0.84],
  [1.0, 0.73, 0.38],
];

/** The timeline light's colours, early to late; the same ramp as the microscope's. */
export function timeline(f: number): string {
  const x = Math.min(1, Math.max(0, f)) * 3;
  const i = Math.min(2, Math.floor(x));
  const k = x - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const c = (j: number) => Math.round((a[j] + (b[j] - a[j]) * k) * 255);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

const xOf = (t: number, x0: number, x1: number) => x0 + ((t - T_WARM) / (T_COLD - T_WARM)) * (x1 - x0);
const yOf = (v: number, y0: number, y1: number) => y1 - v * (y1 - y0);

/** A point on the chart, in CSS pixels within a `w` x `h` box, to weather. */
export function padToWeather(x: number, y: number, w: number, h: number): Weather {
  const fx = (x - M.l) / Math.max(1, w - M.l - M.r);
  const fy = (y - M.t) / Math.max(1, h - M.t - M.b);
  return clampWeather({ t: T_WARM + fx * (T_COLD - T_WARM), v: 1 - fy });
}

/** Draw the chart into a `w` x `h` device-pixel canvas at `s` device pixels per CSS pixel. */
export function drawCloud(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: number,
  now: Weather,
  path: Trail,
  time: number,
  active: boolean,
): void {
  const x0 = M.l * s;
  const x1 = w - M.r * s;
  const y0 = M.t * s;
  const y1 = h - M.b * s;
  ctx.clearRect(0, 0, w, h);

  // The habits, as soft patches.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();
  for (const r of REGIONS) {
    const cx = xOf(r.t, x0, x1);
    const cy = yOf(r.v, y0, y1);
    const rx = (Math.abs(r.rt) / (T_WARM - T_COLD)) * (x1 - x0);
    const ry = r.rv * (y1 - y0);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(${r.tint}, 0.16)`);
    g.addColorStop(0.7, `rgba(${r.tint}, 0.07)`);
    g.addColorStop(1, `rgba(${r.tint}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Grid and frame.
  ctx.lineWidth = s;
  ctx.strokeStyle = 'rgba(200, 215, 240, 0.08)';
  ctx.setLineDash([2 * s, 4 * s]);
  for (let t = -12; t >= -18; t -= 2) {
    const x = Math.round(xOf(t, x0, x1)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(200, 215, 240, 0.22)';
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);

  // Labels.
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(205, 222, 245, 0.62)';
  ctx.font = `italic 300 ${11 * s}px Literata, Georgia, serif`;
  for (const r of REGIONS) ctx.fillText(r.label, xOf(r.t, x0, x1), yOf(r.v, y0, y1));
  ctx.font = `400 ${9.5 * s}px "Spline Sans Mono", ui-monospace, monospace`;
  ctx.fillStyle = 'rgba(160, 176, 198, 0.9)';
  ctx.textBaseline = 'top';
  for (let t = -10; t >= -20; t -= 2) {
    const label = t === -20 ? `−20 °C` : `−${-t}`;
    ctx.textAlign = t === -10 ? 'left' : t === -20 ? 'right' : 'center';
    ctx.fillText(label, xOf(t, x0, x1), y1 + 7 * s);
  }
  ctx.save();
  ctx.translate(M.l * s * 0.45, (y0 + y1) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('drier', -(y1 - y0) / 2, 0);
  ctx.textAlign = 'right';
  ctx.fillText('wetter', (y1 - y0) / 2, 0);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(160, 176, 198, 0.55)';
  ctx.fillText('vapour', 0, 0);
  ctx.restore();

  // The path so far, coloured by when the crystal passed.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2 * s;
  const span = Math.max(1, time);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    ctx.strokeStyle = timeline(b[2] / span);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(xOf(a[0], x0, x1), yOf(a[1], y0, y1));
    ctx.lineTo(xOf(b[0], x0, x1), yOf(b[1], y0, y1));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (path.length) {
    ctx.fillStyle = timeline(0);
    ctx.beginPath();
    ctx.arc(xOf(path[0][0], x0, x1), yOf(path[0][1], y0, y1), 2.6 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Where the crystal is now: a hexagon, with lines to the axes.
  const mx = xOf(now.t, x0, x1);
  const my = yOf(now.v, y0, y1);
  ctx.strokeStyle = 'rgba(225, 236, 250, 0.25)';
  ctx.lineWidth = s;
  ctx.setLineDash([2 * s, 3 * s]);
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(mx, y1);
  ctx.moveTo(mx, my);
  ctx.lineTo(x0, my);
  ctx.stroke();
  ctx.setLineDash([]);
  const r = (active ? 9 : 7) * s;
  if (active) {
    const halo = ctx.createRadialGradient(mx, my, 0, mx, my, r * 2.6);
    halo.addColorStop(0, 'rgba(200, 230, 255, 0.28)');
    halo.addColorStop(1, 'rgba(200, 230, 255, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(mx, my, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    const px = mx + Math.cos(a) * r;
    const py = my + Math.sin(a) * r;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(8, 14, 26, 0.75)';
  ctx.fill();
  ctx.lineWidth = 1.5 * s;
  ctx.strokeStyle = '#eef5ff';
  ctx.stroke();
}
