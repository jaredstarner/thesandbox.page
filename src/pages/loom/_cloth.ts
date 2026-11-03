// The cloth, drawn thread by thread. Every crossing of warp and weft shows
// whichever thread lies on top, shaded as a round yarn, with the other thread
// in shadow underneath it. Threads that float over several crossings are drawn
// as one unbroken length, and ends dive under where the float stops.

import { YARNS } from './_drafts';

export interface Pick {
  /** The shafts lifted for this pick, as bits. */
  mask: number;
  yarn: number;
  /** The edge the weft turned at after this pick: 1 the right, -1 the left. */
  turn: 1 | -1;
  /** Serial number, which seeds the yarn's small irregularities. */
  n: number;
  /** Woven to spread the warp, not part of the cloth. */
  header?: boolean;
}

export interface Warp {
  threading: number[];
  yarns: number[];
}

type RGB = [number, number, number];

export const GAP = 'rgb(17, 13, 10)';

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
export const shade = ([r, g, b]: RGB, k: number) => `rgb(${clamp255(r * k)}, ${clamp255(g * k)}, ${clamp255(b * k)})`;
const lift = ([r, g, b]: RGB, k: number, a: number) =>
  `rgba(${clamp255(r + (255 - r) * k)}, ${clamp255(g + (255 - g) * k)}, ${clamp255(b + (255 - b) * k)}, ${a})`;

/** A small, stable hash in [0, 1). */
export function hash(a: number, b = 0): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Yarn is never quite even: a gentle drift along the warp, and some ends a touch thicker or paler. */
export function endVariation(j: number): number {
  return Math.sin(j * 0.37 + 1.3) * 0.35 + Math.sin(j * 1.71) * 0.2 + (hash(j, 11) - 0.5) * 0.9;
}

export function pickVariation(n: number): number {
  return Math.sin(n * 0.29 + 0.4) * 0.3 + (hash(n, 23) - 0.5) * 1.0;
}

export function raised(warp: Warp, mask: number): Uint8Array {
  const t = warp.threading;
  const out = new Uint8Array(t.length);
  for (let j = 0; j < t.length; j++) out[j] = (mask >> t[j]) & 1;
  return out;
}

const VARIANTS = 3;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export class ClothPainter {
  /** The size of one crossing, in device pixels. */
  readonly s: number;
  private sprites = new Map<string, HTMLCanvasElement>();
  private under = new Map<number, string>();

  constructor(s: number) {
    this.s = Math.max(3, Math.round(s));
  }

  private underColour(yarn: number): string {
    let c = this.under.get(yarn);
    if (!c) {
      c = shade(YARNS[yarn].rgb, 0.55);
      this.under.set(yarn, c);
    }
    return c;
  }

  /**
   * One crossing with its thread on top. Drawn running down the cell (a warp
   * end); a weft pick is the same drawing with the axes swapped, so its light
   * falls from the top instead of the left. capA and capB say whether the
   * thread dives under at its start or end, or carries on into the next cell.
   */
  sprite(yarn: number, weft: boolean, capA: boolean, capB: boolean, variant: number): HTMLCanvasElement {
    const key = `${yarn}${weft ? 'h' : 'v'}${+capA}${+capB}${variant}`;
    const hit = this.sprites.get(key);
    if (hit) return hit;

    const s = this.s;
    const rgb = YARNS[yarn].rgb;
    const c = canvas(s, s);
    const g = c.getContext('2d')!;
    // Local axes: u across the thread, v along it.
    if (weft) g.setTransform(0, 1, 1, 0, 0, 0);

    // Wool blooms to fill the sett, so the threads nearly close up.
    const w = s * 0.92;
    const u0 = (s - w) / 2;
    const u1 = u0 + w;
    const inset = s * 0.04;
    const v0 = capA ? inset : -1;
    const v1 = capB ? s - inset : s + 1;
    const r = w * 0.4;

    g.beginPath();
    g.roundRect(u0, v0, w, v1 - v0, [capA ? r : 0, capA ? r : 0, capB ? r : 0, capB ? r : 0]);
    const across = g.createLinearGradient(u0, 0, u1, 0);
    across.addColorStop(0, shade(rgb, 0.7));
    across.addColorStop(0.2, shade(rgb, 0.98));
    across.addColorStop(0.38, shade(rgb, 1.1));
    across.addColorStop(0.66, shade(rgb, 0.98));
    across.addColorStop(1, shade(rgb, 0.68));
    g.fillStyle = across;
    g.fill();

    g.save();
    g.clip();
    // Where the thread dives under, it turns away from the light.
    if (capA) {
      const end = g.createLinearGradient(0, v0, 0, v0 + s * 0.36);
      end.addColorStop(0, 'rgba(0, 0, 0, 0.3)');
      end.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = end;
      g.fillRect(u0, v0, w, s * 0.36);
    }
    if (capB) {
      const end = g.createLinearGradient(0, v1, 0, v1 - s * 0.36);
      end.addColorStop(0, 'rgba(0, 0, 0, 0.3)');
      end.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = end;
      g.fillRect(u0, v1 - s * 0.36, w, s * 0.36);
    }
    // The twist: two plies wound round each other, each a rounded ridge lit on
    // its upper side with a groove where it meets the next. The slant repeats
    // twice a cell, so floats join up without a seam.
    const period = s / 2;
    const slant = w * 0.42;
    const uc = (u0 + u1) / 2;
    for (let k = -3; k <= 4; k++) {
      const v = k * period;
      const ply = g.createLinearGradient(uc, v, uc + 0.4925 * period, v + 0.587 * period);
      ply.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
      ply.addColorStop(0.22, lift(rgb, 0.45, 0.2));
      ply.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
      ply.addColorStop(1, 'rgba(0, 0, 0, 0.2)');
      g.fillStyle = ply;
      g.beginPath();
      g.moveTo(u0 - 1, v + slant);
      g.lineTo(u1 + 1, v - slant);
      g.lineTo(u1 + 1, v - slant + period);
      g.lineTo(u0 - 1, v + slant + period);
      g.closePath();
      g.fill();
    }
    g.restore();

    // Stray fibres catching the light, more of them the closer you look.
    if (s >= 6) {
      const count = s >= 20 ? 7 : 2;
      g.lineWidth = Math.max(0.5, s * (s >= 20 ? 0.02 : 0.035));
      g.strokeStyle = lift(rgb, 0.55, s >= 20 ? 0.32 : 0.22);
      for (let k = 0; k < count; k++) {
        const a = hash(variant * 7 + k, yarn * 13 + (weft ? 5 : 0));
        const b = hash(variant * 3 + k, yarn * 29 + 1);
        const out = k % 2 === 0 ? -1 : 1;
        const side = out < 0 ? u0 + w * 0.12 : u1 - w * 0.12;
        const v = s * (0.1 + a * 0.8);
        g.beginPath();
        g.moveTo(side, v);
        g.quadraticCurveTo(side + out * s * 0.16, v + s * 0.08, side + out * s * 0.06 + (b - 0.5) * s * 0.2, v + s * 0.26);
        g.stroke();
      }
    }

    this.sprites.set(key, c);
    return c;
  }

  /**
   * Paint one pick across the warp into a band s high at y, clearing the band
   * first. above and below are the neighbouring picks (above is the newer), so
   * warp floats know whether they carry on.
   */
  paintRow(
    g: CanvasRenderingContext2D,
    x0: number,
    y: number,
    warp: Warp,
    pick: Pick,
    above: Pick | null,
    below: Pick | null,
  ) {
    const s = this.s;
    const ends = warp.threading.length;
    const up = raised(warp, pick.mask);
    const upA = above ? raised(warp, above.mask) : null;
    const upB = below ? raised(warp, below.mask) : null;

    g.fillStyle = GAP;
    g.fillRect(x0 - s * 1.5, y, ends * s + s * 3, s);

    const band = s * 0.84;
    const off = (s - band) / 2;
    const body = s * 0.92;
    const bodyOff = (s - body) / 2;
    const vPick = pickVariation(pick.n);

    for (let j = 0; j < ends; j++) {
      const x = x0 + j * s;
      const variant = Math.floor(hash(j, pick.n) * VARIANTS);
      if (up[j]) {
        g.fillStyle = this.underColour(pick.yarn);
        g.fillRect(x, y + off, s, band);
        const capA = !(upA && upA[j]);
        const capB = !(upB && upB[j]);
        g.drawImage(this.sprite(warp.yarns[j], false, capA, capB, variant), x, y);
        const v = endVariation(j);
        g.fillStyle = v > 0 ? `rgba(255, 244, 228, ${v * 0.07})` : `rgba(0, 0, 0, ${-v * 0.1})`;
        g.fillRect(x + bodyOff, y, body, s);
      } else {
        g.fillStyle = this.underColour(warp.yarns[j]);
        g.fillRect(x + off, y, band, s);
        const capL = j > 0 && up[j - 1] === 1;
        const capR = j < ends - 1 && up[j + 1] === 1;
        g.drawImage(this.sprite(pick.yarn, true, capL, capR, variant), x, y);
        g.fillStyle = vPick > 0 ? `rgba(255, 244, 228, ${vPick * 0.07})` : `rgba(0, 0, 0, ${-vPick * 0.1})`;
        g.fillRect(x, y + bodyOff, s, body);
      }
    }

    // The weft runs a little way past the edge ends on both sides.
    const rgb = YARNS[pick.yarn].rgb;
    g.fillStyle = shade(rgb, 0.78);
    g.fillRect(x0 - s * 0.3, y + bodyOff, s * 0.3, body);
    g.fillRect(x0 + ends * s, y + bodyOff, s * 0.3, body);
  }

  /** The weft turning at the selvedge from this pick into the newer one above it. */
  paintTurn(g: CanvasRenderingContext2D, x0: number, y: number, ends: number, pick: Pick, above: Pick) {
    if (above.yarn !== pick.yarn) return;
    const s = this.s;
    const rgb = YARNS[pick.yarn].rgb;
    const edge = pick.turn > 0 ? x0 + ends * s : x0;
    const dir = pick.turn;
    const yc = y + s / 2;
    const ya = yc - s;
    const reach = edge + dir * s * 0.42;
    g.lineWidth = s * 0.6;
    g.strokeStyle = shade(rgb, 0.7);
    g.beginPath();
    g.moveTo(edge - dir * s * 0.05, yc);
    g.bezierCurveTo(reach, yc, reach, ya, edge - dir * s * 0.05, ya);
    g.stroke();
    g.lineWidth = s * 0.18;
    g.strokeStyle = shade(rgb, 1.02);
    g.beginPath();
    g.moveTo(edge, yc - s * 0.12);
    g.bezierCurveTo(reach - dir * s * 0.1, yc - s * 0.12, reach - dir * s * 0.1, ya - s * 0.1, edge, ya - s * 0.1);
    g.stroke();
  }

  /**
   * Below the first pick: the warp gathered into bundles and knotted onto the
   * apron rod, with the apron cords running on toward the breast beam.
   */
  paintTieOn(g: CanvasRenderingContext2D, x0: number, y: number, warp: Warp, height: number) {
    const s = this.s;
    const ends = warp.threading.length;
    const span = Math.max(s * 7, 54 * (s / 10));
    const bundle = 8;
    const groups = Math.ceil(ends / bundle);
    const knotY = y + span * 0.62;
    const rodY = y + span * 0.86;

    g.fillStyle = GAP;
    g.fillRect(x0 - s * 3, y, ends * s + s * 6, height);

    // Apron cords from the rod onward.
    g.lineWidth = Math.max(1, s * 0.22);
    for (let k = 0; k < groups; k++) {
      const xb = x0 + (k * bundle + bundle / 2) * s;
      for (const dx of [-s * 0.5, s * 0.5]) {
        g.strokeStyle = 'rgb(196, 184, 160)';
        g.beginPath();
        g.moveTo(xb + dx * 0.6, rodY);
        g.lineTo(xb + dx * 1.6, y + height);
        g.stroke();
      }
    }

    // Each end, from the cloth to its knot.
    for (let j = 0; j < ends; j++) {
      const k = Math.floor(j / bundle);
      const xb = x0 + (k * bundle + bundle / 2) * s;
      const xj = x0 + (j + 0.5) * s;
      const rgb = YARNS[warp.yarns[j]].rgb;
      g.lineWidth = s * 0.5;
      g.strokeStyle = shade(rgb, 0.72);
      g.beginPath();
      g.moveTo(xj, y);
      g.quadraticCurveTo(xj, y + span * 0.3, xb + (xj - xb) * 0.18, knotY - s * 0.4);
      g.stroke();
      g.lineWidth = s * 0.16;
      g.strokeStyle = shade(rgb, 1.1);
      g.beginPath();
      g.moveTo(xj - s * 0.1, y);
      g.quadraticCurveTo(xj - s * 0.1, y + span * 0.3, xb + (xj - xb) * 0.18 - s * 0.08, knotY - s * 0.4);
      g.stroke();
    }

    // The rod.
    const rod = g.createLinearGradient(0, rodY - s * 0.45, 0, rodY + s * 0.45);
    rod.addColorStop(0, '#8d9093');
    rod.addColorStop(0.35, '#dfe2e4');
    rod.addColorStop(1, '#4b4e52');
    g.fillStyle = rod;
    g.fillRect(x0 - s * 2.5, rodY - s * 0.42, ends * s + s * 5, s * 0.84);

    // Knots, with the tails passing round the rod.
    for (let k = 0; k < groups; k++) {
      const xb = x0 + (k * bundle + bundle / 2) * s;
      const rgb = YARNS[warp.yarns[Math.min(ends - 1, k * bundle + 3)]].rgb;
      for (const side of [-1, 1]) {
        g.lineWidth = s * 0.9;
        g.strokeStyle = shade(rgb, 0.7);
        g.beginPath();
        g.moveTo(xb + side * s * 0.5, knotY);
        g.quadraticCurveTo(xb + side * s * 1.4, rodY - s * 0.2, xb + side * s * 0.9, rodY + s * 0.6);
        g.stroke();
      }
      const knot = g.createRadialGradient(xb - s * 0.4, knotY - s * 0.4, s * 0.2, xb, knotY, s * 1.3);
      knot.addColorStop(0, shade(rgb, 1.2));
      knot.addColorStop(0.6, shade(rgb, 0.85));
      knot.addColorStop(1, shade(rgb, 0.45));
      g.fillStyle = knot;
      g.beginPath();
      g.ellipse(xb, knotY, s * 1.25, s * 0.95, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/**
 * A finished length of cloth with its fringe, upright, for the shelf and for
 * download. s is the crossing size in pixels.
 */
export function renderPiece(warp: Warp, picks: Pick[], s: number): HTMLCanvasElement {
  const painter = new ClothPainter(s);
  const ends = warp.threading.length;
  const fringe = Math.round(s * 9);
  const margin = Math.round(s * 1.5);
  const w = ends * painter.s + margin * 2;
  const h = picks.length * painter.s + fringe * 2;
  const c = canvas(w, h);
  const g = c.getContext('2d')!;
  const x0 = margin;
  const S = painter.s;

  // The newest pick is at the top, as it came off the loom.
  for (let i = 0; i < picks.length; i++) {
    const k = picks.length - 1 - i;
    painter.paintRow(g, x0, fringe + i * S, warp, picks[k], picks[k + 1] ?? null, picks[k - 1] ?? null);
  }
  // Trim each band's clearing back to the cloth's own edges, then turn the weft round them.
  g.clearRect(0, fringe, x0 - S * 0.3, picks.length * S);
  g.clearRect(x0 + ends * S + S * 0.3, fringe, w, picks.length * S);
  for (let i = 1; i < picks.length; i++) {
    const k = picks.length - 1 - i;
    painter.paintTurn(g, x0, fringe + i * S, ends, picks[k], picks[k + 1]);
  }

  drawFringe(g, x0, fringe, warp, S, -1, fringe);
  drawFringe(g, x0, fringe + picks.length * S, warp, S, 1, fringe);
  return c;
}

/** Warp ends twisted in fours and knotted, hanging from one edge of the cloth. */
function drawFringe(g: CanvasRenderingContext2D, x0: number, y: number, warp: Warp, s: number, dir: 1 | -1, len: number) {
  const ends = warp.threading.length;
  const group = 4;
  for (let k = 0; k < ends; k += group) {
    const xc = x0 + (k + group / 2) * s;
    const sway = (hash(k, dir + 7) - 0.5) * s * 1.2;
    const gather = y + dir * s * 1.6;
    const knot = y + dir * len * 0.34;
    const tip = y + dir * (len * (0.86 + hash(k, 3) * 0.12));
    // The ends leaving the cloth and drawing together.
    for (let j = k; j < Math.min(ends, k + group); j++) {
      const rgb = YARNS[warp.yarns[j]].rgb;
      g.lineWidth = s * 0.62;
      g.strokeStyle = shade(rgb, 0.85);
      g.beginPath();
      g.moveTo(x0 + (j + 0.5) * s, y);
      g.quadraticCurveTo(x0 + (j + 0.5) * s, gather, xc + (j - k - 1.5) * s * 0.3, knot - dir * s * 0.6);
      g.stroke();
    }
    // Twisted cord: alternating slants in the group's colours.
    const cordW = s * 1.5;
    const steps = Math.max(2, Math.floor(Math.abs(tip - knot) / (s * 0.7)));
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const yy = knot + (tip - knot) * t;
      const xx = xc + sway * t;
      const rgb = YARNS[warp.yarns[Math.min(ends - 1, k + (i % group))]].rgb;
      g.strokeStyle = shade(rgb, i % 2 ? 0.8 : 1.02);
      g.lineWidth = s * 0.55;
      g.beginPath();
      g.moveTo(xx - cordW / 2, yy);
      g.lineTo(xx + cordW / 2, yy + dir * s * 0.75);
      g.stroke();
    }
    // Loose tips past the twist.
    for (let j = 0; j < group; j++) {
      const rgb = YARNS[warp.yarns[Math.min(ends - 1, k + j)]].rgb;
      g.strokeStyle = shade(rgb, 0.95);
      g.lineWidth = s * 0.3;
      g.beginPath();
      g.moveTo(xc + sway, tip);
      g.lineTo(xc + sway + (j - 1.5) * s * 0.35, tip + dir * s * 1.6);
      g.stroke();
    }
    // The knot.
    const rgb = YARNS[warp.yarns[Math.min(ends - 1, k + 1)]].rgb;
    const grad = g.createRadialGradient(xc - s * 0.3, knot - s * 0.3, s * 0.1, xc, knot, s * 1.1);
    grad.addColorStop(0, shade(rgb, 1.2));
    grad.addColorStop(1, shade(rgb, 0.55));
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(xc, knot, s * 1.05, s * 0.85, 0, 0, Math.PI * 2);
    g.fill();
  }
}
