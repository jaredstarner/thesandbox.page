// The plan of the premises: the floor unrolled. Every tile is the same room, drawn around the one you are in, with
// the visitor marked in each and the chalk line laid out where it really went. The flat rooms unroll onto the plane,
// the Octagon onto the Poincare disc, where equal tiles are drawn smaller toward the rim, and the Rotunda onto a
// globe, of which it is one half.

import { IDENTITY, apply, invert, mul, polar, type M3, type Room, type V3 } from './_rooms';
import type { Visitor } from './_visitor';

interface Tile {
  m: M3;
  /** Reached by an odd number of reversing doors. */
  flipped: boolean;
  /** On the other floor, for the Maisonette. */
  above: boolean;
  depth: number;
}

const INK = '#2b2622';
const PAPER = '#f4edde';
const SHADE = '#e2d6bf';
const RED = '#a23a26';

function tilesOf(room: Room): Tile[] {
  if (room.kappa > 0) return [{ m: IDENTITY, flipped: false, above: false, depth: 0 }];
  const limit = room.kappa < 0 ? 3 : 4;
  const seen = new Map<string, Tile>();
  const key = (m: M3) => {
    const c = apply(m, [0, 0, 1]);
    return `${(c[0] / c[2]).toFixed(3)},${(c[1] / c[2]).toFixed(3)}`;
  };
  const first: Tile = { m: IDENTITY, flipped: false, above: false, depth: 0 };
  seen.set(key(IDENTITY), first);
  const queue = [first];
  while (queue.length) {
    const t = queue.shift()!;
    if (t.depth >= limit) continue;
    for (let i = 0; i < room.n; i++) {
      const m = mul(t.m, invert(room.g[i]!));
      const k = key(m);
      if (seen.has(k)) continue;
      const next: Tile = {
        m,
        flipped: t.flipped !== room.mirrors[i],
        above: t.above !== room.flip[i],
        depth: t.depth + 1,
      };
      seen.set(k, next);
      queue.push(next);
    }
  }
  return [...seen.values()];
}

/** Samples a geodesic between two points of the model. */
function segment(room: Room, a: V3, b: V3, steps: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const v: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    if (room.kappa === 0) {
      out.push(v);
    } else {
      const q = room.kappa > 0 ? Math.hypot(v[0], v[1], v[2]) : Math.sqrt(Math.max(v[2] * v[2] - v[0] * v[0] - v[1] * v[1], 1e-9));
      out.push([v[0] / q, v[1] / q, v[2] / q]);
    }
  }
  return out;
}

export class Plan {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private room: Room | null = null;
  private tiles: Tile[] = [];
  private outline: V3[] = [];
  private doorEnds: [V3, V3, number][] = [];
  private scale = 1;
  private inks: string[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  setRoom(room: Room) {
    this.room = room;
    this.tiles = tilesOf(room);
    const k = room.kappa;
    const n = room.n;
    const r = room.apothem;
    this.outline = [];
    this.doorEnds = [];
    this.inks = room.spec.palette.doors;
    if (k > 0) {
      for (let i = 0; i < 96; i++) this.outline.push([Math.cos((i / 96) * 6.2832), Math.sin((i / 96) * 6.2832), 0]);
    } else {
      // Corners of the outer polygon, from its sides.
      const corner = (i: number): V3 => {
        const a = room.outer[i]!;
        const b = room.outer[(i + 1) % n]!;
        const c: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const w = k === 0 ? c[2] : Math.sqrt(Math.abs(c[2] * c[2] - c[0] * c[0] - c[1] * c[1])) * Math.sign(c[2] || 1);
        return [c[0] / w, c[1] / w, c[2] / w];
      };
      for (let i = 0; i < n; i++) {
        const pts = segment(room, corner((i + n - 1) % n), corner(i), k < 0 ? 12 : 1);
        this.outline.push(...pts.slice(0, -1));
      }
    }
    for (let i = 0; i < n; i++) {
      const th = room.theta[i]!;
      const foot = polar(k, r, th);
      const t: [number, number] = [Math.sin(th), -Math.cos(th)];
      const w = room.doorW;
      const end = (s: number): V3 => {
        const C = k === 0 ? 1 : k > 0 ? Math.cos(s) : Math.cosh(s);
        const S = k === 0 ? s : k > 0 ? Math.sin(s) : Math.sinh(s);
        return [foot[0] * C + t[0] * S, foot[1] * C + t[1] * S, foot[2] * C];
      };
      this.doorEnds.push([end(-w), end(w), Math.min(i, room.pair[i]!)]);
    }
    if (k === 0) {
      this.scale = 0.5 / (r * 2.5);
    } else {
      this.scale = 0.46;
    }
  }

  /** Canvas position of a model point, in units of the canvas's size, from its centre. */
  private project(p: V3): [number, number] {
    const room = this.room!;
    if (room.kappa === 0) return [(p[0] / p[2]) * this.scale, (p[1] / p[2]) * this.scale];
    if (room.kappa > 0) return [p[0] * this.scale, p[1] * this.scale];
    return [(p[0] / (1 + p[2])) * this.scale * 2.05, (p[1] / (1 + p[2])) * this.scale * 2.05];
  }

  draw(visitor: Visitor) {
    const room = this.room;
    if (!room) return;
    const c = this.ctx;
    const S = this.canvas.width;
    const k = room.kappa;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    c.setTransform(S, 0, 0, -S, S / 2, S / 2);
    const px = 1 / S;
    const dpr = S / Math.max(this.canvas.clientWidth, 1);

    c.save();
    c.beginPath();
    if (k === 0) {
      c.rect(-0.5, -0.5, 1, 1);
    } else {
      c.arc(0, 0, k > 0 ? this.scale : this.scale * 2.05 * 0.985, 0, 6.2832);
    }
    c.fillStyle = PAPER;
    c.fill();
    c.clip();

    const path = (m: M3) => {
      c.beginPath();
      this.outline.forEach((p, i) => {
        const [x, y] = this.project(apply(m, p));
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      });
      c.closePath();
    };

    for (const t of this.tiles) {
      path(t.m);
      if (t.flipped) {
        c.fillStyle = SHADE;
        c.fill();
      }
    }
    for (const t of this.tiles) {
      const [cx, cy] = this.project(apply(t.m, [0, 0, 1]));
      if (Math.hypot(cx, cy) > 0.62) continue;
      path(t.m);
      c.strokeStyle = INK;
      c.globalAlpha = t.depth === 0 ? 1 : 0.42;
      c.lineWidth = (t.depth === 0 ? 1.5 : 0.8) * dpr * px;
      c.stroke();
      c.globalAlpha = 1;
    }

    // Doors, in their pairs' colours.
    for (const t of this.tiles) {
      for (const [a, b, pair] of this.doorEnds) {
        const [x0, y0] = this.project(apply(t.m, a));
        const [x1, y1] = this.project(apply(t.m, b));
        if (Math.hypot(x0, y0) > 0.7) continue;
        c.strokeStyle = this.inks[pair] ?? INK;
        c.lineWidth = (t.depth === 0 ? 3.6 : 2) * dpr * px;
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.stroke();
      }
    }

    // A letter in each tile, so a reversed one looks reversed.
    if (k === 0) {
      for (const t of this.tiles) {
        const [o0, o1] = this.project(apply(t.m, [0, 0, 1]));
        if (Math.hypot(o0, o1) > 0.72) continue;
        const [ax, ay] = this.project(apply(t.m, [1, 0, 1]));
        const [bx, by] = this.project(apply(t.m, [0, 1, 1]));
        c.save();
        c.transform(ax - o0, ay - o1, bx - o0, by - o1, o0, o1);
        c.scale(0.012, -0.012);
        c.font = '700 110px "Besley", Georgia, serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = INK;
        c.globalAlpha = t.depth === 0 ? 0.32 : 0.2;
        c.fillText('R', 0, 0);
        c.restore();
      }
      c.globalAlpha = 1;
    }

    // The chalk line, where it really went.
    if (visitor.crumbs.length > 1) {
      const back = invert(visitor.developed);
      c.strokeStyle = RED;
      c.lineWidth = 1.4 * dpr * px;
      c.lineJoin = 'round';
      c.beginPath();
      let pen = false;
      for (const crumb of visitor.crumbs) {
        const q = apply(back, crumb.q);
        if (k > 0 && q[2] < 0) {
          pen = false;
          continue;
        }
        const [x, y] = this.project(q);
        if (pen) c.lineTo(x, y);
        else c.moveTo(x, y);
        pen = true;
      }
      c.stroke();
    }

    // You, in every room.
    const you = (m: M3, main: boolean) => {
      const p = apply(m, visitor.p);
      const [x, y] = this.project(p);
      if (Math.hypot(x, y) > 0.75) return;
      const ahead = apply(m, [
        visitor.p[0] + visitor.f[0] * 0.25,
        visitor.p[1] + visitor.f[1] * 0.25,
        visitor.p[2] + visitor.f[2] * 0.25,
      ]);
      const [ax, ay] = this.project(ahead);
      const dx = ax - x;
      const dy = ay - y;
      const len = Math.hypot(dx, dy) || 1;
      const base = this.tileScale(x, y);
      const r = (main ? 4.4 : 3) * base * dpr * px;
      c.fillStyle = main ? RED : INK;
      c.globalAlpha = main ? 1 : 0.72;
      c.beginPath();
      c.arc(x, y, r, 0, 6.2832);
      c.fill();
      c.strokeStyle = c.fillStyle;
      c.lineWidth = (main ? 1.6 : 1.1) * dpr * px;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (dx / len) * r * 2.5, y + (dy / len) * r * 2.5);
      c.stroke();
      c.globalAlpha = 1;
    };
    this.tiles.forEach((t, i) => you(t.m, i === 0));
    if (k > 0) you([-1, 0, 0, 0, -1, 0, 0, 0, -1], false);
    c.restore();

    if (k !== 0) {
      c.beginPath();
      c.arc(0, 0, k > 0 ? this.scale : this.scale * 2.05 * 0.985, 0, 6.2832);
      c.strokeStyle = INK;
      c.lineWidth = 1 * dpr * px;
      c.stroke();
    } else {
      c.strokeStyle = INK;
      c.lineWidth = 1 * dpr * px;
      c.strokeRect(-0.5 + px, -0.5 + px, 1 - 2 * px, 1 - 2 * px);
    }
  }

  private tileScale(x: number, y: number): number {
    const room = this.room!;
    if (room.kappa >= 0) return 1;
    const d = Math.hypot(x, y) / (this.scale * 2.05);
    return Math.max(0.35, 1 - d * d);
  }
}
