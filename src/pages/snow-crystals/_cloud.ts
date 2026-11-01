// The cloud chart: temperature across, vapour up, with the habits the page's crystals take in
// each part of it, the path the falling crystal has taken, and where it is now.

import { clampWeather, T_COLD, T_WARM, type Weather } from './_weather';

/** Temperature, vapour, and the update it was recorded at. */
export type Trail = [number, number, number][];

/** Plot margins in CSS pixels. */
const M = { l: 30, r: 10, t: 10, b: 26 };

type Habit = 'fern' | 'dendrite' | 'sectored' | 'stellarPlate' | 'plate';

/** Where this page's crystals take each habit, marked as on a Nakaya diagram. */
const HABITS: { label: string; kind: Habit; t: number; v: number }[] = [
  { label: 'fernlike', kind: 'fern', t: -15, v: 0.86 },
  { label: 'stellar dendrites', kind: 'dendrite', t: -15, v: 0.52 },
  { label: 'sectored plates', kind: 'sectored', t: -15, v: 0.17 },
  { label: 'stellar plates', kind: 'stellarPlate', t: -12.4, v: 0.72 },
  { label: 'stellar plates', kind: 'stellarPlate', t: -17.6, v: 0.72 },
  { label: 'plates', kind: 'plate', t: -10.9, v: 0.3 },
  { label: 'plates', kind: 'plate', t: -19.1, v: 0.3 },
];

/** A small line drawing of a habit, `r` across its arms. */
function glyph(ctx: CanvasRenderingContext2D, kind: Habit, cx: number, cy: number, r: number) {
  const at = (a: number, d: number): [number, number] => [cx + Math.cos(a) * d, cy + Math.sin(a) * d];
  const line = (p: [number, number], q: [number, number]) => {
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  };
  const hex = (x: number, y: number, rr: number, turn: number) => {
    for (let k = 0; k <= 6; k++) {
      const a = turn + (k * Math.PI) / 3;
      if (k === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
  };
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 3;
    if (kind === 'plate' || kind === 'sectored') {
      if (k === 0) hex(cx, cy, r, -Math.PI / 2);
      if (kind === 'sectored') line([cx, cy], at(a, r));
      continue;
    }
    line([cx, cy], at(a, r));
    if (kind === 'stellarPlate') {
      const [x, y] = at(a, r * 0.78);
      hex(x, y, r * 0.24, -Math.PI / 2);
      continue;
    }
    const twigs = kind === 'fern' ? [0.3, 0.45, 0.6, 0.75, 0.88] : [0.45, 0.72];
    for (const f of twigs) {
      const base = at(a, r * f);
      const len = r * (kind === 'fern' ? 0.22 : 0.3) * (1.1 - f * 0.5);
      for (const side of [-1, 1]) {
        const b = a + (side * Math.PI) / 3;
        line(base, [base[0] + Math.cos(b) * len, base[1] + Math.sin(b) * len]);
      }
    }
  }
  ctx.stroke();
}

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

  // The habits.
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.font = `italic 300 ${10.5 * s}px Literata, Georgia, serif`;
  ctx.lineWidth = 0.9 * s;
  ctx.lineCap = 'round';
  for (const h of HABITS) {
    const x = xOf(h.t, x0, x1);
    const y = yOf(h.v, y0, y1);
    ctx.strokeStyle = 'rgba(205, 222, 245, 0.5)';
    glyph(ctx, h.kind, x, y - 5 * s, 7.5 * s);
    ctx.fillStyle = 'rgba(205, 222, 245, 0.6)';
    ctx.fillText(h.label, x, y + 6 * s);
  }
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
