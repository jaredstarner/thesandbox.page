// /breadboard/: drawing. Everything is drawn top down in board units (one hole pitch) on a 2D
// canvas, lit from the upper left. The board and parts go to a cached layer that is redrawn only
// when something changes; LED light, smoke, hover marks, and the meter probes go on each frame.

import { BATTERY, BENCH, BOARD, HOLES, HOLE, RAILS, ROW_LETTERS, ROW_Y, type Hole } from './_board';
import {
  FOOTPRINT,
  PIN_NAMES,
  capCode,
  footprintCentre,
  pinHoles,
  resistorBands,
  rotate,
  type Kind,
  type Part,
} from './_parts';

export interface View {
  /** CSS pixels per unit. */
  s: number;
  ox: number;
  oy: number;
  /** 0: board across the screen; 1: board turned a quarter clockwise, for tall screens. */
  rot: 0 | 1;
  dpr: number;
  w: number;
  h: number;
}

export interface PartLook {
  /** LED brightness 0 to about 1.3; buzzer drive; 555 output. */
  glow: number;
  dead: boolean;
  scorched: boolean;
  pressed: boolean;
  covered: boolean;
}

export interface Ghost {
  part: Part;
  /** Pin positions in units (may miss holes), and whether each is a valid hole. */
  pins: { x: number; y: number; ok: boolean }[];
  ok: boolean;
}

export interface Probe {
  color: 'red' | 'black';
  /** Hole the tip rests in, or a free position (units) while dragged, or null when holstered. */
  hole: string | null;
  free: { x: number; y: number } | null;
}

export interface Scene {
  parts: Part[];
  looks: Map<string, PartLook>;
  selected: string | null;
  hoverHole: Hole | null;
  /** Holes joined to the hovered one: its own strip first, then the rest of the net. */
  hoverStrip: Hole[];
  hoverNet: Hole[];
  hoverPart: string | null;
  ghost: Ghost | null;
  lamp: boolean;
  probes: Probe[];
  meterOn: boolean;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
  dark: number;
}

interface Flash {
  x: number;
  y: number;
  age: number;
}

const WIRE: Record<string, [string, string, string]> = {
  // base, edge, highlight
  red: ['#cf3a2e', '#7d1d16', '#f07a6c'],
  black: ['#26272a', '#0b0b0c', '#5d6066'],
  blue: ['#2c62c2', '#173a7a', '#6e9cf0'],
  green: ['#2c9449', '#175a2a', '#6fd08a'],
  yellow: ['#e6bf2c', '#8c6f0f', '#fbe58a'],
  orange: ['#e57d2a', '#8f4511', '#fbb47a'],
  white: ['#e9e7e0', '#9c9a92', '#ffffff'],
};

const BAND_PAINT: Record<string, string> = {
  black: '#1d1c1b',
  brown: '#7b4a27',
  red: '#c3322b',
  orange: '#e0782a',
  yellow: '#e6c534',
  green: '#3f8a46',
  blue: '#2f60b0',
  violet: '#7a4ea3',
  grey: '#8b8b88',
  white: '#efeee8',
  gold: '#c69a3e',
};

/** Epoxy colour when dark, glow colour when lit. */
const LED_TINT: Record<string, { body: string; deep: string; glow: [number, number, number] }> = {
  red: { body: '#d2443a', deep: '#7c1c17', glow: [255, 58, 40] },
  yellow: { body: '#e3bd3a', deep: '#86650f', glow: [255, 196, 46] },
  green: { body: '#63b54a', deep: '#265a1c', glow: [128, 255, 78] },
  blue: { body: '#7f9fdc', deep: '#2b4580', glow: [64, 128, 255] },
  white: { body: '#e8ecef', deep: '#9aa3ab', glow: [236, 242, 255] },
};

/** Can radius in units: 5 mm up to 10 uF, 6.3 mm at 100 uF, 8 mm at 470 uF. */
export function ecapRadius(c: number): number {
  return c >= 400e-6 ? 1.57 : c >= 90e-6 ? 1.25 : 0.98;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private holeSprite: HTMLCanvasElement | null = null;
  private matPattern: CanvasPattern | null = null;
  view: View = { s: 20, ox: 0, oy: 0, rot: 0, dpr: 1, w: 1, h: 1 };
  dirty = true;
  mono = 'monospace';
  sans = 'sans-serif';
  private puffs: Puff[] = [];
  private flashes: Flash[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number) {
    const rot: 0 | 1 = h > w * 1.15 ? 1 : 0;
    const bw = BENCH.x1 - BENCH.x0,
      bh = BENCH.y1 - BENCH.y0;
    const sw = rot ? bh : bw,
      sh = rot ? bw : bh;
    const s = Math.min(w / sw, h / sh);
    const cx = (BENCH.x0 + BENCH.x1) / 2,
      cy = (BENCH.y0 + BENCH.y1) / 2;
    // Place the bench's centre at the canvas centre.
    const ox = rot ? w / 2 + cy * s : w / 2 - cx * s;
    const oy = rot ? h / 2 - cx * s : h / 2 - cy * s;
    this.view = { s, ox, oy, rot, dpr, w, h };
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.holeSprite = null;
    this.matPattern = null;
    this.dirty = true;
  }

  /** Screen (CSS px) to board units. */
  toWorld(sx: number, sy: number): { x: number; y: number } {
    const { s, ox, oy, rot } = this.view;
    return rot ? { x: (sy - oy) / s, y: (ox - sx) / s } : { x: (sx - ox) / s, y: (sy - oy) / s };
  }

  toScreen(x: number, y: number): { x: number; y: number } {
    const { s, ox, oy, rot } = this.view;
    return rot ? { x: ox - y * s, y: oy + x * s } : { x: ox + x * s, y: oy + y * s };
  }

  /** A screen-space offset expressed in units, so shadows fall the same way however the board turns. */
  private screenVec(dx: number, dy: number): [number, number] {
    const { s, rot } = this.view;
    return rot ? [dy / s, -dx / s] : [dx / s, dy / s];
  }

  private worldTransform(ctx: CanvasRenderingContext2D) {
    const { s, ox, oy, rot, dpr } = this.view;
    if (rot) ctx.setTransform(0, s * dpr, -s * dpr, 0, ox * dpr, oy * dpr);
    else ctx.setTransform(s * dpr, 0, 0, s * dpr, ox * dpr, oy * dpr);
  }

  private shadow(ctx: CanvasRenderingContext2D, lift: number) {
    const { s, dpr } = this.view;
    ctx.shadowColor = `rgba(8, 10, 12, ${0.42 + lift * 0.05})`;
    ctx.shadowBlur = s * dpr * (0.18 + lift * 0.22);
    ctx.shadowOffsetX = s * dpr * (0.08 + lift * 0.1);
    ctx.shadowOffsetY = s * dpr * (0.12 + lift * 0.14);
  }

  private noShadow(ctx: CanvasRenderingContext2D) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  // ---------------------------------------------------------------- static layer

  private drawLayer(scene: Scene) {
    const ctx = this.lctx;
    const { dpr, w, h } = this.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawMat(ctx, w, h);
    this.worldTransform(ctx);
    this.drawBoard(ctx);
    this.drawBatteryBody(ctx);
    // Low parts first, wires on top, tall parts (LEDs, capacitors, buzzer) over their neighbours.
    const order: Record<Kind, number> = {
      battery: 9,
      res: 1,
      ldr: 1,
      cap: 1,
      button: 2,
      pot: 2,
      npn: 2,
      ne555: 2,
      cd4017: 2,
      wire: 3,
      ecap: 4,
      led: 4,
      buzzer: 5,
    };
    const parts = [...scene.parts].sort((a, b) => order[a.kind] - order[b.kind]);
    for (const p of parts) {
      if (p.kind === 'battery') continue;
      const look = scene.looks.get(p.id);
      ctx.save();
      this.drawPart(ctx, p, look, false);
      ctx.restore();
    }
    for (const p of parts) if (p.kind === 'battery') this.drawBatteryLeads(ctx, p);
  }

  private drawMat(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.matPattern) {
      const t = document.createElement('canvas');
      t.width = t.height = 256;
      const c = t.getContext('2d')!;
      c.fillStyle = '#2a3337';
      c.fillRect(0, 0, 256, 256);
      // Mottled conductive vinyl.
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 2600; i++) {
        const x = rnd() * 256,
          y = rnd() * 256,
          r = 0.4 + rnd() * 1.6;
        c.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.012 + rnd() * 0.02})` : `rgba(0,0,0,${0.03 + rnd() * 0.05})`;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }
      this.matPattern = ctx.createPattern(t, 'repeat');
    }
    ctx.fillStyle = this.matPattern ?? '#2a3337';
    ctx.fillRect(0, 0, w, h);
    // Printed 10 mm grid.
    ctx.save();
    this.worldTransform(ctx);
    const step = 10 / 2.54;
    const tl = this.toWorld(0, 0),
      br = this.toWorld(w, h);
    const x0 = Math.min(tl.x, br.x),
      x1 = Math.max(tl.x, br.x),
      y0 = Math.min(tl.y, br.y),
      y1 = Math.max(tl.y, br.y);
    ctx.strokeStyle = 'rgba(190, 210, 214, 0.075)';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    for (let x = Math.floor(x0 / step) * step; x < x1; x += step) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let y = Math.floor(y0 / step) * step; y < y1; y += step) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
    ctx.restore();
    const g = ctx.createRadialGradient(w * 0.32, h * 0.2, 0, w * 0.32, h * 0.2, Math.max(w, h) * 0.95);
    g.addColorStop(0, 'rgba(255, 244, 222, 0.07)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.32)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private getHoleSprite(): HTMLCanvasElement {
    if (this.holeSprite) return this.holeSprite;
    const px = Math.max(4, Math.round(this.view.s * this.view.dpr * 0.62));
    const t = document.createElement('canvas');
    t.width = t.height = px;
    const c = t.getContext('2d')!;
    const k = px / 0.62;
    c.scale(k, k);
    const o = 0.31;
    const hs = 0.17;
    // Lip: light lower right, shade upper left, then the dark socket and a glint of the clip.
    c.fillStyle = 'rgba(255,255,255,0.7)';
    roundRect(c, o - hs + 0.03, o - hs + 0.03, hs * 2, hs * 2, 0.05);
    c.fill();
    c.fillStyle = 'rgba(80,70,50,0.35)';
    roundRect(c, o - hs - 0.03, o - hs - 0.03, hs * 2, hs * 2, 0.05);
    c.fill();
    const g = c.createLinearGradient(o - hs, o - hs, o + hs, o + hs);
    g.addColorStop(0, '#141312');
    g.addColorStop(1, '#3b3833');
    c.fillStyle = g;
    roundRect(c, o - hs, o - hs, hs * 2, hs * 2, 0.045);
    c.fill();
    c.fillStyle = 'rgba(190, 186, 170, 0.35)';
    c.fillRect(o - 0.08, o + 0.02, 0.16, 0.035);
    this.holeSprite = t;
    return t;
  }

  private drawBoard(ctx: CanvasRenderingContext2D) {
    const b = BOARD;
    ctx.save();
    this.shadow(ctx, 1.4);
    const g = ctx.createLinearGradient(0, b.y0, 0, b.y1);
    g.addColorStop(0, '#f5f2e9');
    g.addColorStop(1, '#e4dfd2');
    ctx.fillStyle = g;
    roundRect(ctx, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 0.45);
    ctx.fill();
    this.noShadow(ctx);
    // Bevel.
    ctx.lineWidth = 0.08;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    roundRect(ctx, b.x0 + 0.06, b.y0 + 0.06, b.x1 - b.x0 - 0.12, b.y1 - b.y0 - 0.12, 0.4);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,110,90,0.35)';
    ctx.lineWidth = 0.05;
    roundRect(ctx, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 0.45);
    ctx.stroke();
    // Seams between the rail strips and the main block.
    for (const y of [-1.45, 12.45]) groove(ctx, b.x0 + 0.2, y, b.x1 - 0.2, 0.09);
    // The channel down the middle.
    const cg = ctx.createLinearGradient(0, 4.85, 0, 6.15);
    cg.addColorStop(0, '#bdb7a6');
    cg.addColorStop(0.25, '#d9d4c5');
    cg.addColorStop(1, '#e2ddcf');
    ctx.fillStyle = cg;
    ctx.fillRect(b.x0 + 0.25, 4.85, b.x1 - b.x0 - 0.5, 1.3);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(b.x0 + 0.25, 6.12, b.x1 - b.x0 - 0.5, 0.05);
    // Printed rail lines and signs.
    const lines: [number, string][] = [
      [-4.05, '#cf3b30'],
      [-1.78, '#2f5db0'],
      [12.78, '#2f5db0'],
      [15.05, '#cf3b30'],
    ];
    for (const [y, col] of lines) {
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(0.55, y - 0.045, 29.0, 0.09);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const rail of RAILS) {
      ctx.fillStyle = rail.sign > 0 ? '#c8382e' : '#2c58a8';
      ctx.font = `700 0.62px ${this.mono}`;
      const t = rail.sign > 0 ? '+' : '−';
      for (const x of [-0.05, 30.05]) this.uprightText(ctx, t, x, rail.y + 0.02);
    }
    // Column numbers and row letters.
    ctx.fillStyle = '#8f8a7b';
    ctx.font = `400 0.4px ${this.mono}`;
    for (const c of [1, 5, 10, 15, 20, 25, 30]) {
      this.uprightText(ctx, String(c), c, -0.98);
      this.uprightText(ctx, String(c), c, 11.98);
    }
    for (let r = 0; r < 10; r++) {
      this.uprightText(ctx, ROW_LETTERS[r], -0.1, ROW_Y[r]);
      this.uprightText(ctx, ROW_LETTERS[r], 31.1, ROW_Y[r]);
    }
    // Holes.
    const spr = this.getHoleSprite();
    for (const hole of HOLES) ctx.drawImage(spr, hole.x - 0.31, hole.y - 0.31, 0.62, 0.62);
    ctx.restore();
  }

  /** Text that stays upright on screen even when the board is turned. */
  private uprightText(ctx: CanvasRenderingContext2D, t: string, x: number, y: number) {
    if (this.view.rot) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(t, 0, 0);
      ctx.restore();
    } else ctx.fillText(t, x, y);
  }

  private drawBatteryBody(ctx: CanvasRenderingContext2D) {
    const { x, y, w, h } = BATTERY;
    ctx.save();
    this.shadow(ctx, 3);
    // The steel jacket's crimped top edge shows round the snap.
    const g = ctx.createLinearGradient(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
    g.addColorStop(0, '#d9dde1');
    g.addColorStop(0.45, '#8d939a');
    g.addColorStop(1, '#5d636a');
    ctx.fillStyle = g;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 0.75);
    ctx.fill();
    this.noShadow(ctx);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.05;
    roundRect(ctx, x - w / 2 + 0.18, y - h / 2 + 0.18, w - 0.36, h - 0.36, 0.6);
    ctx.stroke();
    // The snap clip.
    ctx.save();
    this.shadow(ctx, 0.6);
    const sg = ctx.createLinearGradient(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
    sg.addColorStop(0, '#2e3033');
    sg.addColorStop(1, '#121315');
    ctx.fillStyle = sg;
    roundRect(ctx, x - w / 2 + 0.45, y - h / 2 + 0.45, w - 0.9, h - 0.9, 0.5);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 0.05;
    roundRect(ctx, x - w / 2 + 0.62, y - h / 2 + 0.62, w - 1.24, h - 1.24, 0.38);
    ctx.stroke();
    // Strain relief where the leads leave.
    ctx.fillStyle = '#1b1c1f';
    roundRect(ctx, x - 1.7, y - h / 2 - 0.15, 3.4, 0.9, 0.35);
    ctx.fill();
    // Two rivets over the terminals.
    for (const [dy, label] of [
      [-1.9, '+'],
      [1.9, '−'],
    ] as const) {
      const rg = ctx.createRadialGradient(x - 0.25, y + dy - 0.25, 0.05, x, y + dy, 0.75);
      rg.addColorStop(0, '#f2f3f4');
      rg.addColorStop(0.6, '#a9adb2');
      rg.addColorStop(1, '#5b5f63');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y + dy, 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(230,230,225,0.6)';
      ctx.font = `700 0.7px ${this.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      this.uprightText(ctx, label, x + 1.85, y + dy);
    }
    ctx.fillStyle = 'rgba(236,232,220,0.75)';
    ctx.font = `700 0.95px ${this.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.uprightText(ctx, '9V', x, y + h / 2 - 1.55);
    ctx.restore();
  }

  private batteryTerminal(which: 0 | 1): { x: number; y: number } {
    const { x, y, h } = BATTERY;
    return { x: x + (which ? 1.0 : -1.0), y: y - h / 2 + 0.2 };
  }

  private drawBatteryLeads(ctx: CanvasRenderingContext2D, p: Part) {
    const ends = [p.a, p.b];
    for (const k of [0, 1] as const) {
      const t = this.batteryTerminal(k);
      const hole = ends[k] ? HOLE.get(ends[k]!) : undefined;
      const end = hole ?? { x: t.x + (k ? 1.5 : -0.5), y: t.y - 2.2 };
      ctx.save();
      const color = k ? 'black' : 'red';
      const mid = { x: (t.x + end.x) / 2, y: Math.min(t.y, end.y) - 1.6 };
      const path = new Path2D();
      path.moveTo(t.x, t.y);
      path.bezierCurveTo(t.x, t.y - 1.4, mid.x - 0.8, mid.y, end.x - 0.9, end.y);
      path.lineTo(end.x - 0.25, end.y);
      this.strokeWire(ctx, path, color, 0.32);
      // Tinned tip.
      ctx.strokeStyle = '#b8bcc0';
      ctx.lineWidth = 0.16;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(end.x - 0.32, end.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      if (hole) this.legDot(ctx, hole.x, hole.y);
      ctx.restore();
    }
  }

  private strokeWire(ctx: CanvasRenderingContext2D, path: Path2D, color: string, width: number) {
    const [base, edge, hi] = WIRE[color] ?? WIRE.red;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.shadow(ctx, 0.8);
    ctx.strokeStyle = edge;
    ctx.lineWidth = width;
    ctx.stroke(path);
    this.noShadow(ctx);
    ctx.strokeStyle = base;
    ctx.lineWidth = width * 0.72;
    ctx.stroke(path);
    const [hx, hy] = this.screenVec(-1, -1.2);
    const n = Math.hypot(hx, hy) || 1;
    ctx.save();
    ctx.translate((hx / n) * width * 0.16, (hy / n) * width * 0.16);
    ctx.strokeStyle = hi;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = width * 0.2;
    ctx.stroke(path);
    ctx.restore();
  }

  /** A lead disappearing into a hole. */
  private legDot(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = '#0f0f0f';
    ctx.beginPath();
    ctx.arc(x, y, 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  private lead(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#7f8388';
    ctx.lineWidth = 0.14;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = '#d9dcdf';
    ctx.lineWidth = 0.06;
    ctx.stroke();
  }

  // ---------------------------------------------------------------- parts

  drawPart(ctx: CanvasRenderingContext2D, p: Part, look: PartLook | undefined, ghost: boolean) {
    const holes = pinHoles(p);
    switch (p.kind) {
      case 'wire':
        return this.drawWire(ctx, p, holes, ghost);
      case 'res':
        return this.drawResistor(ctx, p, holes, look);
      case 'led':
        return this.drawLed(ctx, p, holes, look);
      case 'ecap':
        return this.drawEcap(ctx, p, holes, look);
      case 'cap':
        return this.drawCeramic(ctx, p, holes);
      case 'ldr':
        return this.drawLdr(ctx, p, holes);
      case 'button':
      case 'pot':
      case 'npn':
      case 'ne555':
      case 'cd4017':
      case 'buzzer':
        return this.drawFootprint(ctx, p, look);
      case 'battery':
        return;
    }
  }

  private ends(holes: (Hole | null)[], p: Part): [{ x: number; y: number }, { x: number; y: number }] | null {
    const a = holes[0] ?? (p.a ? HOLE.get(p.a) : undefined);
    const b = holes[1] ?? (p.b ? HOLE.get(p.b) : undefined);
    if (!a || !b) return null;
    return [a, b];
  }

  wirePath(ax: number, ay: number, bx: number, by: number): Path2D {
    const path = new Path2D();
    const dx = bx - ax,
      dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (Math.abs(dx) < 0.01 || Math.abs(dy) < 0.01 || len < 1.6) {
      path.moveTo(ax, ay);
      path.lineTo(bx, by);
      return path;
    }
    // A loose arc, bowed to one side in proportion to its length.
    const nx = -dy / len,
      ny = dx / len;
    const side = ny < 0 || (ny === 0 && nx < 0) ? -1 : 1;
    const bow = Math.min(2.6, 0.16 * len) * side;
    path.moveTo(ax, ay);
    path.bezierCurveTo(
      ax + dx * 0.25 + nx * bow,
      ay + dy * 0.25 + ny * bow,
      ax + dx * 0.75 + nx * bow,
      ay + dy * 0.75 + ny * bow,
      bx,
      by,
    );
    return path;
  }

  private drawWire(ctx: CanvasRenderingContext2D, p: Part, holes: (Hole | null)[], ghost: boolean) {
    const e = this.ends(holes, p);
    if (!e) return;
    const [a, b] = e;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len,
      uy = dy / len;
    // Stripped ends.
    const strip = 0.38;
    const path = this.wirePath(a.x + ux * strip, a.y + uy * strip, b.x - ux * strip, b.y - uy * strip);
    for (const [hx, hy, sx, sy] of [
      [a.x, a.y, ux, uy],
      [b.x, b.y, -ux, -uy],
    ]) {
      ctx.strokeStyle = '#a7abb0';
      ctx.lineWidth = 0.15;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + sx * (strip + 0.05), hy + sy * (strip + 0.05));
      ctx.stroke();
      ctx.strokeStyle = '#e4e6e8';
      ctx.lineWidth = 0.05;
      ctx.stroke();
      this.legDot(ctx, hx, hy);
    }
    if (ghost) ctx.globalAlpha *= 0.85;
    this.strokeWire(ctx, path, p.color ?? 'red', 0.42);
  }

  private drawResistor(ctx: CanvasRenderingContext2D, p: Part, holes: (Hole | null)[], look?: PartLook) {
    const e = this.ends(holes, p);
    if (!e) return;
    const [a, b] = e;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const bands = resistorBands(p.value ?? 1e3);
    if (len < 2.95) {
      // Standing upright on leg a, the other lead looping over to b.
      this.lead(ctx, a.x, a.y, b.x, b.y);
      this.legDot(ctx, b.x, b.y);
      ctx.save();
      this.shadow(ctx, 2.2);
      const g = ctx.createRadialGradient(a.x - 0.15, a.y - 0.15, 0.05, a.x, a.y, 0.5);
      g.addColorStop(0, '#ecdcb3');
      g.addColorStop(1, '#b49a68');
      ctx.fillStyle = look?.dead ? '#2a2420' : look?.scorched ? '#6b5236' : g;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 0.48, 0, Math.PI * 2);
      ctx.fill();
      this.noShadow(ctx);
      ctx.strokeStyle = BAND_PAINT[bands[0]];
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#c9ccd0';
      ctx.beginPath();
      ctx.arc(a.x, a.y, 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    const L = 2.6;
    const ang = Math.atan2(dy, dx);
    this.lead(ctx, a.x, a.y, b.x, b.y);
    this.legDot(ctx, a.x, a.y);
    this.legDot(ctx, b.x, b.y);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang);
    const body = new Path2D();
    // Dog-bone: fuller at the end caps.
    body.moveTo(-L / 2, -0.4);
    body.bezierCurveTo(-L / 2 + 0.25, -0.5, -L / 2 + 0.55, -0.46, -L / 2 + 0.7, -0.36);
    body.lineTo(L / 2 - 0.7, -0.36);
    body.bezierCurveTo(L / 2 - 0.55, -0.46, L / 2 - 0.25, -0.5, L / 2, -0.4);
    body.arc(L / 2 - 0.02, 0, 0.4, -Math.PI / 2, Math.PI / 2);
    body.bezierCurveTo(L / 2 - 0.25, 0.5, L / 2 - 0.55, 0.46, L / 2 - 0.7, 0.36);
    body.lineTo(-L / 2 + 0.7, 0.36);
    body.bezierCurveTo(-L / 2 + 0.55, 0.46, -L / 2 + 0.25, 0.5, -L / 2, 0.4);
    body.arc(-L / 2 + 0.02, 0, 0.4, Math.PI / 2, (3 * Math.PI) / 2);
    body.closePath();
    this.shadow(ctx, 1);
    ctx.fillStyle = '#d6c296';
    ctx.fill(body);
    this.noShadow(ctx);
    ctx.save();
    ctx.clip(body);
    const bandAt = [-0.78, -0.42, -0.06, 0.72];
    bands.forEach((c, i) => {
      ctx.fillStyle = BAND_PAINT[c];
      ctx.fillRect(bandAt[i] - 0.1, -0.6, 0.2, 1.2);
    });
    // Round the body with light across its width.
    const [lx, ly] = this.screenVec(-1, -1.3);
    const ca = Math.cos(-ang),
      sa = Math.sin(-ang);
    const ly2 = lx * sa + ly * ca;
    const sgn = ly2 < 0 ? -1 : 1;
    const g = ctx.createLinearGradient(0, sgn * 0.5, 0, -sgn * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.75, 'rgba(0,0,0,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = g;
    ctx.fillRect(-L / 2 - 0.5, -0.6, L + 1, 1.2);
    if (look?.scorched || look?.dead) {
      const sg = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1.4);
      sg.addColorStop(0, look.dead ? 'rgba(10,8,6,0.95)' : 'rgba(60,35,15,0.75)');
      sg.addColorStop(1, look.dead ? 'rgba(40,25,10,0.6)' : 'rgba(90,60,25,0.15)');
      ctx.fillStyle = sg;
      ctx.fillRect(-L / 2 - 0.5, -0.6, L + 1, 1.2);
      if (look.dead) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.moveTo(-0.15, -0.5);
        ctx.lineTo(0.05, -0.05);
        ctx.lineTo(-0.08, 0.15);
        ctx.lineTo(0.12, 0.5);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.restore();
  }

  private drawLed(ctx: CanvasRenderingContext2D, p: Part, holes: (Hole | null)[], look?: PartLook) {
    const e = this.ends(holes, p);
    if (!e) return;
    const [a, b] = e;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    const tint = LED_TINT[p.color ?? 'red'] ?? LED_TINT.red;
    // Legs splay out from under the dome.
    this.lead(ctx, a.x, a.y, mx - (dx / len) * 0.25, my - (dy / len) * 0.25);
    this.lead(ctx, b.x, b.y, mx + (dx / len) * 0.25, my + (dy / len) * 0.25);
    this.legDot(ctx, a.x, a.y);
    this.legDot(ctx, b.x, b.y);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(Math.atan2(dy, dx));
    // Flange with the flat on the cathode side (toward b, +x).
    const rim = new Path2D();
    const R = 1.14;
    const flat = 1.02;
    const th = Math.acos(flat / R);
    rim.arc(0, 0, R, th, Math.PI * 2 - th);
    rim.closePath();
    this.shadow(ctx, 2.6);
    ctx.fillStyle = tint.deep;
    ctx.fill(rim);
    this.noShadow(ctx);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.04;
    ctx.stroke(rim);
    // Dome.
    const [lx, ly] = this.screenVec(-1, -1.2);
    const ang = Math.atan2(dy, dx);
    const ca = Math.cos(-ang),
      sa = Math.sin(-ang);
    const hx = (lx * ca - ly * sa) * 0.45 * this.view.s,
      hy = (lx * sa + ly * ca) * 0.45 * this.view.s;
    const n = Math.hypot(hx, hy) || 1;
    const hlx = (hx / n) * 0.42,
      hly = (hy / n) * 0.42;
    const g = ctx.createRadialGradient(hlx * 0.6, hly * 0.6, 0.05, 0, 0, 0.98);
    g.addColorStop(0, mixHex(tint.body, '#ffffff', 0.25));
    g.addColorStop(0.55, tint.body);
    g.addColorStop(1, tint.deep);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 0.94, 0, Math.PI * 2);
    ctx.fill();
    // The lead frame inside: anvil (cathode, larger) and post.
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = tint.deep;
    ctx.beginPath();
    ctx.moveTo(0.05, -0.32);
    ctx.lineTo(0.5, -0.42);
    ctx.lineTo(0.5, 0.42);
    ctx.lineTo(0.05, 0.32);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-0.45, -0.12, 0.3, 0.24);
    ctx.globalAlpha = 1;
    if (look?.dead) {
      ctx.fillStyle = 'rgba(20,14,10,0.7)';
      ctx.beginPath();
      ctx.arc(0, 0, 0.94, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,235,220,0.35)';
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.moveTo(-0.5, -0.55);
      ctx.lineTo(-0.1, -0.1);
      ctx.lineTo(0.2, -0.2);
      ctx.lineTo(0.55, 0.35);
      ctx.stroke();
    }
    // Specular.
    const sg = ctx.createRadialGradient(hlx, hly, 0, hlx, hly, 0.42);
    sg.addColorStop(0, 'rgba(255,255,255,0.85)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(hlx, hly, 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawEcap(ctx: CanvasRenderingContext2D, p: Part, holes: (Hole | null)[], look?: PartLook) {
    const e = this.ends(holes, p);
    if (!e) return;
    const [a, b] = e;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    const R = ecapRadius(p.value ?? 10e-6);
    this.lead(ctx, a.x, a.y, mx - (dx / len) * 0.3, my - (dy / len) * 0.3);
    this.lead(ctx, b.x, b.y, mx + (dx / len) * 0.3, my + (dy / len) * 0.3);
    this.legDot(ctx, a.x, a.y);
    this.legDot(ctx, b.x, b.y);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(Math.atan2(dy, dx));
    this.shadow(ctx, 3.4);
    ctx.fillStyle = '#1e3463';
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    this.noShadow(ctx);
    // The minus stripe faces the negative lead (b).
    ctx.fillStyle = '#c8d0da';
    ctx.beginPath();
    ctx.arc(0, 0, R, -0.75, 0.75);
    ctx.arc(0, 0, R - 0.2, 0.75, -0.75, true);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1e3463';
    for (const t of [-0.35, 0, 0.35]) {
      ctx.fillRect(Math.cos(t) * (R - 0.1) - 0.02, Math.sin(t) * (R - 0.1) - 0.05, 0.04, 0.1);
    }
    // Aluminium can top and its scored vent.
    const top = R - 0.2;
    const g = ctx.createRadialGradient(-top * 0.35, -top * 0.35, 0.05, 0, 0, top);
    g.addColorStop(0, '#f1f3f5');
    g.addColorStop(0.7, '#b6bcc3');
    g.addColorStop(1, '#7d848c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, top, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,46,54,0.55)';
    ctx.lineWidth = 0.045;
    ctx.beginPath();
    if (R > 1.1) {
      for (let k = 0; k < 3; k++) {
        const t = (k * Math.PI * 2) / 3 - Math.PI / 2;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(t) * top * 0.62, Math.sin(t) * top * 0.62);
      }
    } else {
      ctx.moveTo(-top * 0.55, 0);
      ctx.lineTo(top * 0.55, 0);
      ctx.moveTo(0, -top * 0.55);
      ctx.lineTo(0, top * 0.55);
    }
    ctx.stroke();
    if (look?.dead) {
      // Vent split open, electrolyte crust.
      ctx.fillStyle = 'rgba(120, 82, 40, 0.75)';
      ctx.beginPath();
      ctx.arc(0, 0, top * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2b2620';
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      ctx.moveTo(-top * 0.6, 0);
      ctx.lineTo(top * 0.6, 0);
      ctx.moveTo(0, -top * 0.6);
      ctx.lineTo(0, top * 0.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCeramic(ctx: CanvasRenderingContext2D, p: Part, holes: (Hole | null)[]) {
    const e = this.ends(holes, p);
    if (!e) return;
    const [a, b] = e;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    this.lead(ctx, a.x, a.y, b.x, b.y);
    this.legDot(ctx, a.x, a.y);
    this.legDot(ctx, b.x, b.y);
    ctx.save();
    ctx.translate(mx, my);
    let ang = Math.atan2(dy, dx);
    // Keep the printed code readable.
    if (this.view.rot) ang += Math.PI / 2;
    if (Math.cos(ang) < -0.01) ang += Math.PI;
    if (this.view.rot) ang -= Math.PI / 2;
    ctx.rotate(ang);
    this.shadow(ctx, 1.2);
    const g = ctx.createRadialGradient(-0.2, -0.15, 0.05, 0, 0, 0.8);
    g.addColorStop(0, '#e59a55');
    g.addColorStop(1, '#a8591f');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.72, 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    this.noShadow(ctx);
    ctx.fillStyle = 'rgba(50,25,10,0.85)';
    ctx.font = `700 0.36px ${this.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(capCode(p.value ?? 100e-9), 0, 0.02);
    ctx.restore();
  }

  private drawLdr(ctx: CanvasRenderingContext2D, p: Part, holes: (Hole | null)[]) {
    const e = this.ends(holes, p);
    if (!e) return;
    const [a, b] = e;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    this.lead(ctx, a.x, a.y, mx - (dx / len) * 0.3, my - (dy / len) * 0.3);
    this.lead(ctx, b.x, b.y, mx + (dx / len) * 0.3, my + (dy / len) * 0.3);
    this.legDot(ctx, a.x, a.y);
    this.legDot(ctx, b.x, b.y);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
    this.shadow(ctx, 1.6);
    ctx.fillStyle = '#e9e3d3';
    ctx.beginPath();
    ctx.arc(0, 0, 0.98, 0, Math.PI * 2);
    ctx.fill();
    this.noShadow(ctx);
    // Two gold combs and the cadmium sulphide track snaking between them.
    ctx.fillStyle = '#c8a24f';
    ctx.beginPath();
    ctx.arc(0, 0, 0.82, Math.PI * 0.12, Math.PI * 0.88);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 0.82, Math.PI * 1.12, Math.PI * 1.88);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#b5512a';
    ctx.lineWidth = 0.1;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const rows = 6;
    for (let i = 0; i <= rows; i++) {
      const y = -0.6 + (1.2 * i) / rows;
      const half = Math.sqrt(Math.max(0, 0.72 * 0.72 - y * y));
      if (i === 0) ctx.moveTo(-half, y);
      ctx.lineTo(i % 2 ? -half : half, y);
      if (i < rows) ctx.lineTo(i % 2 ? -half : half, y + 1.2 / rows);
    }
    ctx.stroke();
    // Clear lacquer.
    const g = ctx.createRadialGradient(-0.35, -0.35, 0, -0.2, -0.2, 0.9);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 0.98, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawFootprint(ctx: CanvasRenderingContext2D, p: Part, look?: PartLook) {
    const at = p.at ? HOLE.get(p.at) : undefined;
    if (!at) return;
    this.drawFootprintAt(ctx, p.kind, at.x, at.y, p.rot ?? 0, p, look);
  }

  drawFootprintAt(
    ctx: CanvasRenderingContext2D,
    kind: Kind,
    x: number,
    y: number,
    rot: number,
    p: Part,
    look?: PartLook,
  ) {
    const fp = FOOTPRINT[kind] ?? [];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rot * Math.PI) / 2);
    switch (kind) {
      case 'ne555':
      case 'cd4017':
        this.drawDip(ctx, fp.length / 2, kind === 'ne555' ? 'NE555P' : 'CD4017BE', rot);
        break;
      case 'button':
        this.drawButton(ctx, look?.pressed ?? false);
        break;
      case 'pot':
        this.drawPot(ctx, p.pos ?? 0.5);
        break;
      case 'npn':
        this.drawTo92(ctx, look?.dead ?? false, rot);
        break;
      case 'buzzer':
        this.drawBuzzer(ctx, rot);
        break;
    }
    ctx.restore();
  }

  private drawDip(ctx: CanvasRenderingContext2D, half: number, label: string, rot: number) {
    const x0 = -0.62,
      x1 = half - 1 + 0.62;
    const y0 = -2.75,
      y1 = -0.25;
    // Legs.
    for (let i = 0; i < half; i++) {
      for (const [ya, yb] of [
        [-0.05, y1],
        [y0, -2.95],
      ]) {
        const lg = ctx.createLinearGradient(i - 0.15, 0, i + 0.15, 0);
        lg.addColorStop(0, '#8e9297');
        lg.addColorStop(0.5, '#e3e5e7');
        lg.addColorStop(1, '#8e9297');
        ctx.fillStyle = lg;
        ctx.fillRect(i - 0.15, Math.min(ya, yb), 0.3, Math.abs(yb - ya));
      }
      this.legDot(ctx, i, 0);
      this.legDot(ctx, i, -3);
    }
    this.shadow(ctx, 1.4);
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#2a2b2e');
    g.addColorStop(1, '#151618');
    ctx.fillStyle = g;
    roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 0.12);
    ctx.fill();
    this.noShadow(ctx);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 0.05;
    roundRect(ctx, x0 + 0.08, y0 + 0.08, x1 - x0 - 0.16, y1 - y0 - 0.16, 0.08);
    ctx.stroke();
    // Notch at the pin 1 end, and the pin 1 dimple.
    ctx.fillStyle = '#0c0c0d';
    ctx.beginPath();
    ctx.arc(x0, (y0 + y1) / 2, 0.36, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(0, y1 - 0.45, 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.03;
    ctx.stroke();
    // Print, kept upright.
    ctx.save();
    ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
    const turn = (rot + (this.view.rot ? 1 : 0)) % 4;
    if (turn === 2 || turn === 3) ctx.rotate(Math.PI);
    ctx.fillStyle = 'rgba(214, 214, 206, 0.82)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${half > 4 ? 0.6 : 0.5}px ${this.mono}`;
    ctx.fillText(label, 0.15, -0.2);
    ctx.font = `400 0.36px ${this.mono}`;
    ctx.fillStyle = 'rgba(214, 214, 206, 0.55)';
    ctx.fillText(half > 4 ? '2646  MLY' : '2646', 0.15, 0.42);
    ctx.restore();
  }

  private drawButton(ctx: CanvasRenderingContext2D, pressed: boolean) {
    // Centre of the four legs (0,0), (2,0), (0,-3), (2,-3).
    const cx = 1,
      cy = -1.5;
    for (const [lx, ly] of [
      [0, 0],
      [2, 0],
      [0, -3],
      [2, -3],
    ]) {
      ctx.fillStyle = '#b9bdc2';
      ctx.fillRect(lx - 0.14, ly < cy ? ly : ly - 0.42, 0.28, 0.42);
      this.legDot(ctx, lx, ly);
    }
    this.shadow(ctx, 1.8);
    ctx.fillStyle = '#1f2023';
    roundRect(ctx, cx - 1.18, cy - 1.18, 2.36, 2.36, 0.18);
    ctx.fill();
    this.noShadow(ctx);
    // Steel cover plate.
    const g = ctx.createLinearGradient(cx - 1.1, cy - 1.1, cx + 1.1, cy + 1.1);
    g.addColorStop(0, '#e7e9eb');
    g.addColorStop(0.5, '#a8adb3');
    g.addColorStop(1, '#d4d7da');
    ctx.fillStyle = g;
    roundRect(ctx, cx - 1.05, cy - 1.05, 2.1, 2.1, 0.12);
    ctx.fill();
    ctx.fillStyle = 'rgba(60,64,70,0.5)';
    for (const [dx, dy] of [
      [-0.78, -0.78],
      [0.78, -0.78],
      [-0.78, 0.78],
      [0.78, 0.78],
    ]) {
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    // Actuator.
    ctx.fillStyle = '#121214';
    ctx.beginPath();
    ctx.arc(cx, cy, 0.74, 0, Math.PI * 2);
    ctx.fill();
    const r = pressed ? 0.6 : 0.66;
    const ag = ctx.createRadialGradient(cx - 0.2, cy - 0.22, 0.02, cx, cy, r);
    ag.addColorStop(0, pressed ? '#3a3c40' : '#5d6066');
    ag.addColorStop(1, pressed ? '#141416' : '#1d1e21');
    ctx.fillStyle = ag;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPot(ctx: CanvasRenderingContext2D, pos: number) {
    const cx = 1,
      cy = -0.85;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#c3c6ca';
      ctx.fillRect(i - 0.12, -0.35, 0.24, 0.35);
      this.legDot(ctx, i, 0);
    }
    this.shadow(ctx, 1.8);
    const g = ctx.createLinearGradient(cx - 1.3, cy - 1.3, cx + 1.3, cy + 1.3);
    g.addColorStop(0, '#3f72c0');
    g.addColorStop(1, '#22488a');
    ctx.fillStyle = g;
    roundRect(ctx, cx - 1.3, cy - 1.2, 2.6, 2.6, 0.2);
    ctx.fill();
    this.noShadow(ctx);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.05;
    roundRect(ctx, cx - 1.22, cy - 1.12, 2.44, 2.44, 0.16);
    ctx.stroke();
    // Rotor.
    const rg = ctx.createRadialGradient(cx - 0.25, cy - 0.25, 0.05, cx, cy, 0.95);
    rg.addColorStop(0, '#ffffff');
    rg.addColorStop(1, '#c9cdd2');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(cx, cy, 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.04;
    ctx.stroke();
    const a = ((-135 + pos * 270) * Math.PI) / 180 - Math.PI / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.fillStyle = '#4b5058';
    roundRect(ctx, -0.7, -0.1, 1.4, 0.2, 0.06);
    ctx.fill();
    roundRect(ctx, -0.1, -0.45, 0.2, 0.9, 0.06);
    ctx.fill();
    ctx.fillStyle = '#e04a3a';
    ctx.beginPath();
    ctx.moveTo(0.95, 0);
    ctx.lineTo(0.72, -0.13);
    ctx.lineTo(0.72, 0.13);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawTo92(ctx: CanvasRenderingContext2D, dead: boolean, rot: number) {
    const cx = 1;
    for (let i = 0; i < 3; i++) this.legDot(ctx, i, 0);
    const d = new Path2D();
    d.moveTo(cx - 0.98, 0.5);
    d.lineTo(cx + 0.98, 0.5);
    d.arc(cx, 0.5, 0.98, 0, Math.PI, true);
    d.closePath();
    this.shadow(ctx, 2);
    const g = ctx.createLinearGradient(cx - 1, -0.5, cx + 1, 0.5);
    g.addColorStop(0, '#36373b');
    g.addColorStop(1, '#141517');
    ctx.fillStyle = g;
    ctx.fill(d);
    this.noShadow(ctx);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.moveTo(cx - 0.95, 0.47);
    ctx.lineTo(cx + 0.95, 0.47);
    ctx.stroke();
    ctx.save();
    ctx.translate(cx, 0.05);
    const turn = (rot + (this.view.rot ? 1 : 0)) % 4;
    if (turn === 2) ctx.rotate(Math.PI);
    ctx.fillStyle = 'rgba(205,205,198,0.75)';
    ctx.font = `700 0.3px ${this.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('2N3904', 0, 0);
    ctx.restore();
    if (dead) {
      ctx.fillStyle = 'rgba(60,40,20,0.6)';
      ctx.beginPath();
      ctx.arc(cx, 0, 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBuzzer(ctx: CanvasRenderingContext2D, rot: number) {
    const cx = 1.5,
      cy = 0;
    this.legDot(ctx, 0, 0);
    this.legDot(ctx, 3, 0);
    this.shadow(ctx, 4);
    const g = ctx.createRadialGradient(cx - 0.8, cy - 0.8, 0.2, cx, cy, 2.36);
    g.addColorStop(0, '#3b3c40');
    g.addColorStop(1, '#141416');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.36, 0, Math.PI * 2);
    ctx.fill();
    this.noShadow(ctx);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.05, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 1.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#050505';
    ctx.beginPath();
    ctx.arc(cx, cy, 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(cx - 1.55, cy);
    if ((rot + (this.view.rot ? 1 : 0)) % 4 !== 0) ctx.rotate((-(rot + (this.view.rot ? 1 : 0)) * Math.PI) / 2);
    ctx.fillStyle = 'rgba(220,220,212,0.7)';
    ctx.font = `700 0.62px ${this.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', 0, 0);
    ctx.restore();
  }

  // ---------------------------------------------------------------- effects

  smoke(x: number, y: number, amount: number, dark = 0.5) {
    const [ux, uy] = this.screenVec(0, -1);
    const n = Math.hypot(ux, uy) || 1;
    for (let i = 0; i < amount; i++) {
      const sp = 0.6 + Math.random() * 1.2;
      this.puffs.push({
        x: x + (Math.random() - 0.5) * 0.6,
        y: y + (Math.random() - 0.5) * 0.6,
        vx: (ux / n) * sp + (Math.random() - 0.5) * 0.6,
        vy: (uy / n) * sp + (Math.random() - 0.5) * 0.6,
        r: 0.45 + Math.random() * 0.5,
        age: -Math.random() * 0.4,
        life: 1.6 + Math.random() * 1.6,
        dark,
      });
    }
  }

  flash(x: number, y: number) {
    this.flashes.push({ x, y, age: 0 });
  }

  // ---------------------------------------------------------------- frame

  frame(scene: Scene, dt: number) {
    if (this.dirty) {
      this.drawLayer(scene);
      this.dirty = false;
    }
    const ctx = this.ctx;
    const { w, h, dpr } = this.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    // Live parts: lit LEDs and held buttons are drawn over the cached layer.
    this.worldTransform(ctx);
    for (const p of scene.parts) {
      const look = scene.looks.get(p.id);
      if (p.kind === 'button' && look?.pressed) {
        ctx.save();
        this.drawPart(ctx, p, look, false);
        ctx.restore();
      }
    }
    if (!scene.lamp) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(4, 6, 14, 0.9)';
      ctx.fillRect(0, 0, w * dpr, h * dpr);
      this.worldTransform(ctx);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of scene.parts) {
      if (p.kind !== 'led') continue;
      const look = scene.looks.get(p.id);
      if (!look || look.dead || look.glow <= 0.002) continue;
      const hs = pinHoles(p);
      if (!hs[0] || !hs[1]) continue;
      this.drawGlow(ctx, (hs[0].x + hs[1].x) / 2, (hs[0].y + hs[1].y) / 2, p.color ?? 'red', look.glow, !scene.lamp);
    }
    ctx.restore();
    if (!scene.lamp) {
      // The covered LDR and pressed parts stay findable in the dark: a faint key light on the board.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(40, 50, 70, 0.06)';
      ctx.fillRect(BOARD.x0, BOARD.y0, BOARD.x1 - BOARD.x0, BOARD.y1 - BOARD.y0);
      ctx.restore();
    }
    this.drawHover(ctx, scene);
    this.drawEffects(ctx, dt);
    if (scene.ghost) this.drawGhost(ctx, scene.ghost);
    this.drawProbes(ctx, scene);
  }

  private drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, b: number, dark: boolean) {
    const [r, g, bl] = (LED_TINT[color] ?? LED_TINT.red).glow;
    const k = Math.min(1.4, b);
    // Spill on the board.
    const spill = (dark ? 8.5 : 3.4) * (0.5 + 0.5 * k);
    const sg = ctx.createRadialGradient(x, y, 0.4, x, y, spill);
    sg.addColorStop(0, `rgba(${r},${g},${bl},${(dark ? 0.5 : 0.2) * k})`);
    sg.addColorStop(0.35, `rgba(${r},${g},${bl},${(dark ? 0.16 : 0.05) * k})`);
    sg.addColorStop(1, `rgba(${r},${g},${bl},0)`);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(x, y, spill, 0, Math.PI * 2);
    ctx.fill();
    // The dome lit from within, hot at the die.
    const dg = ctx.createRadialGradient(x, y, 0, x, y, 1.0);
    dg.addColorStop(0, `rgba(255,255,255,${0.75 * k * k})`);
    dg.addColorStop(0.25, `rgba(${r},${g},${bl},${0.95 * k})`);
    dg.addColorStop(0.9, `rgba(${r},${g},${bl},${0.5 * k})`);
    dg.addColorStop(1, `rgba(${r},${g},${bl},0)`);
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.arc(x, y, 1.0, 0, Math.PI * 2);
    ctx.fill();
    // Bloom.
    const bg = ctx.createRadialGradient(x, y, 0.6, x, y, 2.2 + 1.4 * k);
    bg.addColorStop(0, `rgba(${r},${g},${bl},${0.42 * k})`);
    bg.addColorStop(1, `rgba(${r},${g},${bl},0)`);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(x, y, 2.2 + 1.4 * k, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawHover(ctx: CanvasRenderingContext2D, scene: Scene) {
    if (scene.hoverNet.length) {
      ctx.strokeStyle = 'rgba(255, 206, 84, 0.55)';
      ctx.lineWidth = 0.07;
      for (const hole of scene.hoverNet) {
        ctx.beginPath();
        ctx.arc(hole.x, hole.y, 0.3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (scene.hoverStrip.length) {
      ctx.fillStyle = 'rgba(255, 206, 84, 0.22)';
      const xs = scene.hoverStrip.map((hh) => hh.x),
        ys = scene.hoverStrip.map((hh) => hh.y);
      const x0 = Math.min(...xs) - 0.42,
        x1 = Math.max(...xs) + 0.42,
        y0 = Math.min(...ys) - 0.42,
        y1 = Math.max(...ys) + 0.42;
      roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 0.3);
      ctx.fill();
    }
    if (scene.hoverHole) {
      ctx.strokeStyle = '#ffd25a';
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      ctx.arc(scene.hoverHole.x, scene.hoverHole.y, 0.36, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Pin names round a hovered or selected chip.
    const chipId = scene.hoverPart ?? scene.selected;
    const chip = chipId ? scene.parts.find((p) => p.id === chipId) : undefined;
    if (chip && PIN_NAMES[chip.kind] && chip.kind !== 'buzzer') {
      const names = PIN_NAMES[chip.kind]!;
      const holes = pinHoles(chip);
      const at = chip.at ? HOLE.get(chip.at) : undefined;
      if (at) {
        const [cx, cy] = footprintCentre(chip.kind, at.x, at.y, chip.rot ?? 0);
        ctx.font = `700 0.34px ${this.mono}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        holes.forEach((hole, i) => {
          if (!hole) return;
          const dx = hole.x - cx,
            dy = hole.y - cy;
          const n = Math.hypot(dx, dy) || 1;
          const off = chip.kind === 'npn' || chip.kind === 'pot' ? 0.75 : 0.62;
          const tx = hole.x + (dx / n) * off * (chip.kind === 'npn' || chip.kind === 'pot' ? 0 : 1),
            ty = hole.y + (dy / n) * off + (chip.kind === 'npn' || chip.kind === 'pot' ? 0.7 : 0);
          const tw = names[i].length * 0.22 + 0.2;
          ctx.fillStyle = 'rgba(20, 22, 26, 0.86)';
          if (this.view.rot) roundRect(ctx, tx - 0.22, ty - tw / 2, 0.44, tw, 0.08);
          else roundRect(ctx, tx - tw / 2, ty - 0.22, tw, 0.44, 0.08);
          ctx.fill();
          ctx.fillStyle = '#ffe08a';
          this.uprightText(ctx, names[i], tx, ty + 0.01);
        });
      }
    }
    if (scene.selected) {
      const p = scene.parts.find((q) => q.id === scene.selected);
      if (p) {
        const bb = this.partBounds(p);
        if (bb) {
          ctx.save();
          ctx.setLineDash([0.22, 0.16]);
          ctx.strokeStyle = 'rgba(255, 214, 96, 0.9)';
          ctx.lineWidth = 0.07;
          roundRect(ctx, bb.x0 - 0.3, bb.y0 - 0.3, bb.x1 - bb.x0 + 0.6, bb.y1 - bb.y0 + 0.6, 0.35);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  /** Rough bounds of a part, in units. */
  partBounds(p: Part): { x0: number; y0: number; x1: number; y1: number } | null {
    const pts: [number, number][] = [];
    const holes = pinHoles(p);
    for (const hh of holes) if (hh) pts.push([hh.x, hh.y]);
    if (!pts.length) return null;
    let x0 = Math.min(...pts.map((q) => q[0])),
      x1 = Math.max(...pts.map((q) => q[0])),
      y0 = Math.min(...pts.map((q) => q[1])),
      y1 = Math.max(...pts.map((q) => q[1]));
    const grow = (r: number, cx: number, cy: number) => {
      x0 = Math.min(x0, cx - r);
      x1 = Math.max(x1, cx + r);
      y0 = Math.min(y0, cy - r);
      y1 = Math.max(y1, cy + r);
    };
    const mx = (x0 + x1) / 2,
      my = (y0 + y1) / 2;
    switch (p.kind) {
      case 'led':
        grow(1.12, mx, my);
        break;
      case 'ecap':
        grow(ecapRadius(p.value ?? 10e-6), mx, my);
        break;
      case 'ldr':
        grow(0.98, mx, my);
        break;
      case 'res':
        grow(0.5, mx, my);
        break;
      case 'buzzer':
        grow(2.36, mx, my);
        break;
      case 'pot':
      case 'button': {
        const at = p.at ? HOLE.get(p.at) : undefined;
        if (at) {
          const [cx, cy] = p.kind === 'pot' ? rotOff(at, 1, -0.85, p.rot ?? 0) : rotOff(at, 1, -1.5, p.rot ?? 0);
          grow(1.3, cx, cy);
        }
        break;
      }
      case 'npn':
        grow(0.6, mx, my);
        break;
      case 'ne555':
      case 'cd4017':
        grow(0.3, mx, my);
        break;
    }
    return { x0, y0, x1, y1 };
  }

  private drawEffects(ctx: CanvasRenderingContext2D, dt: number) {
    for (const f of this.flashes) {
      f.age += dt;
      const k = Math.max(0, 1 - f.age / 0.18);
      if (k <= 0) continue;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 3.5);
      g.addColorStop(0, `rgba(255,250,230,${0.95 * k})`);
      g.addColorStop(0.3, `rgba(255,190,90,${0.5 * k})`);
      g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    this.flashes = this.flashes.filter((f) => f.age < 0.2);
    for (const p of this.puffs) {
      p.age += dt;
      if (p.age < 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 0.6;
      p.vy *= 1 - dt * 0.6;
      p.r += dt * 0.9;
      const t = p.age / p.life;
      const a = Math.max(0, Math.min(1, t * 6) * (1 - t)) * 0.6;
      const c = Math.round(205 - p.dark * 140);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(${c},${c},${c - 6},${a})`);
      g.addColorStop(1, `rgba(${c},${c},${c - 6},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    this.puffs = this.puffs.filter((p) => p.age < p.life);
  }

  get busy(): boolean {
    return this.puffs.length > 0 || this.flashes.length > 0;
  }

  private drawGhost(ctx: CanvasRenderingContext2D, ghost: Ghost) {
    ctx.save();
    ctx.globalAlpha = 0.82;
    const p = ghost.part;
    if (
      p.kind === 'wire' ||
      p.kind === 'res' ||
      p.kind === 'led' ||
      p.kind === 'ecap' ||
      p.kind === 'cap' ||
      p.kind === 'ldr'
    ) {
      // Draw from the pin positions even when they miss the board.
      const [a, b] = ghost.pins;
      if (a && b) {
        const fake: Part = { ...p };
        const ha = HOLE.get(p.a ?? '') ?? null;
        const hb = HOLE.get(p.b ?? '') ?? null;
        const pa = ha ?? { x: a.x, y: a.y };
        const pb = hb ?? { x: b.x, y: b.y };
        this.drawTwoLeadAt(ctx, fake, pa, pb);
      }
    } else if (p.kind !== 'battery') {
      const pin1 = ghost.pins[0];
      if (pin1) this.drawFootprintAt(ctx, p.kind, pin1.x, pin1.y, p.rot ?? 0, p);
    }
    ctx.restore();
    for (const pin of ghost.pins) {
      ctx.strokeStyle = pin.ok ? 'rgba(120, 230, 140, 0.95)' : 'rgba(255, 90, 70, 0.95)';
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      ctx.arc(pin.x, pin.y, 0.34, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawTwoLeadAt(
    ctx: CanvasRenderingContext2D,
    p: Part,
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) {
    const fakeHoles = [a, b].map((q, i) => ({
      id: `ghost${i}`,
      x: q.x,
      y: q.y,
      strip: -1,
      rail: null,
      row: -1,
      col: -1,
    }));
    const holes = fakeHoles as Hole[];
    switch (p.kind) {
      case 'wire':
        return this.drawWire(ctx, p, holes, true);
      case 'res':
        return this.drawResistor(ctx, p, holes);
      case 'led':
        return this.drawLed(ctx, p, holes);
      case 'ecap':
        return this.drawEcap(ctx, p, holes);
      case 'cap':
        return this.drawCeramic(ctx, p, holes);
      case 'ldr':
        return this.drawLdr(ctx, p, holes);
    }
  }

  /** Draw one part, centred, into a drawer button's small canvas. */
  drawIcon(cv: HTMLCanvasElement, kind: Kind, color?: string) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = cv.clientWidth || 64,
      h = cv.clientHeight || 40;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const c = cv.getContext('2d')!;
    const boxes: Record<string, [number, number, number, number]> = {
      wire: [-0.4, -1.1, 3.4, 1.1],
      res: [-0.4, -0.75, 4.4, 0.75],
      led: [-1.3, -1.3, 2.3, 1.3],
      ecap: [-1.2, -1.2, 2.2, 1.2],
      cap: [-0.5, -0.8, 1.5, 0.8],
      ldr: [-1.1, -1.1, 2.1, 1.1],
      button: [-0.4, -3.3, 2.4, 0.3],
      pot: [-0.5, -2.3, 2.5, 0.5],
      npn: [-0.3, -0.8, 2.3, 0.8],
      ne555: [-1.0, -3.2, 4.0, 0.2],
      cd4017: [-1.0, -3.2, 8.0, 0.2],
      buzzer: [-1.0, -2.5, 4.0, 2.5],
    };
    const [x0, y0, x1, y1] = boxes[kind] ?? [-1, -1, 1, 1];
    const s = Math.min(w / (x1 - x0), h / (y1 - y0)) * 0.92;
    const saved = this.view;
    this.view = { ...saved, s, rot: 0, dpr, ox: w / 2 - ((x0 + x1) / 2) * s, oy: h / 2 - ((y0 + y1) / 2) * s };
    c.clearRect(0, 0, cv.width, cv.height);
    this.worldTransform(c);
    const p: Part = {
      id: 'icon',
      kind,
      value: kind === 'res' ? 4.7e3 : kind === 'ecap' ? 100e-6 : 100e-9,
      color: color ?? (kind === 'wire' ? 'blue' : 'red'),
      pos: 0.3,
      rot: 0,
    };
    const fake = (pts: [number, number][]) =>
      pts.map(([x, y], i) => ({ id: `icon${i}`, x, y, strip: -1, rail: null, row: -1, col: -1 }) as Hole);
    c.save();
    switch (kind) {
      case 'wire': {
        const path = this.wirePath(0.3, 0.5, 2.7, -0.5);
        this.strokeWire(c, path, p.color!, 0.42);
        break;
      }
      case 'res':
        this.drawResistor(
          c,
          p,
          fake([
            [0, 0],
            [4, 0],
          ]),
        );
        break;
      case 'led':
        this.drawLed(
          c,
          p,
          fake([
            [0, 0],
            [1, 0],
          ]),
        );
        break;
      case 'ecap':
        this.drawEcap(
          c,
          p,
          fake([
            [0, 0],
            [1, 0],
          ]),
        );
        break;
      case 'cap':
        this.drawCeramic(
          c,
          p,
          fake([
            [0, 0],
            [1, 0],
          ]),
        );
        break;
      case 'ldr':
        this.drawLdr(
          c,
          p,
          fake([
            [0, 0],
            [1, 0],
          ]),
        );
        break;
      default:
        this.drawFootprintAt(c, kind, 0, 0, 0, p);
    }
    c.restore();
    this.view = saved;
  }

  /** Where each probe's lead leaves the canvas, in CSS px. */
  probeAnchor(color: 'red' | 'black'): { x: number; y: number } {
    const { w, h } = this.view;
    return color === 'red' ? { x: w + 30, y: h - 70 } : { x: w + 30, y: h - 30 };
  }

  /** Resting place for a holstered probe tip, in CSS px. */
  probeRest(color: 'red' | 'black'): { x: number; y: number } {
    const { w, h } = this.view;
    const k = color === 'red' ? 0 : 1;
    return { x: w - 150 + k * 18, y: h - 66 + k * 26 };
  }

  /** The tip of each probe in CSS px. */
  probeTip(pr: Probe): { x: number; y: number } {
    if (pr.free) return this.toScreen(pr.free.x, pr.free.y);
    if (pr.hole) {
      const hh = HOLE.get(pr.hole);
      if (hh) return this.toScreen(hh.x, hh.y);
    }
    return this.probeRest(pr.color);
  }

  private drawProbes(ctx: CanvasRenderingContext2D, scene: Scene) {
    if (!scene.meterOn) return;
    const { dpr, s } = this.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = Math.max(0.7, Math.min(1.4, s / 26));
    for (const pr of scene.probes) {
      const tip = this.probeTip(pr);
      const parked = !pr.hole && !pr.free;
      const ang = parked ? Math.PI * 0.02 : Math.PI * 0.2;
      const dir = { x: Math.cos(ang), y: Math.sin(ang) };
      const needle = 15 * k,
        guard = 7 * k,
        handle = 70 * k;
      const hx = tip.x + dir.x * (needle + guard + handle),
        hy = tip.y + dir.y * (needle + guard + handle);
      const anchor = this.probeAnchor(pr.color);
      // Cable.
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 8 * k;
      const cable = new Path2D();
      cable.moveTo(hx, hy);
      cable.bezierCurveTo(hx + dir.x * 60, hy + dir.y * 60 + 30, anchor.x - 80, anchor.y + 10, anchor.x, anchor.y);
      ctx.save();
      ctx.translate(3, 4);
      ctx.stroke(cable);
      ctx.restore();
      ctx.strokeStyle = pr.color === 'red' ? '#b42d24' : '#1d1e20';
      ctx.lineWidth = 6 * k;
      ctx.stroke(cable);
      // Needle.
      ctx.strokeStyle = '#d7dadd';
      ctx.lineWidth = 2.6 * k;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x + dir.x * (needle + 2), tip.y + dir.y * (needle + 2));
      ctx.stroke();
      // Guard and handle.
      ctx.save();
      ctx.translate(tip.x, tip.y);
      ctx.rotate(ang);
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 5;
      const base = pr.color === 'red' ? '#d63a2f' : '#2a2b2f';
      const hi = pr.color === 'red' ? '#f07468' : '#55585e';
      const g = ctx.createLinearGradient(0, -6 * k, 0, 6 * k);
      g.addColorStop(0, hi);
      g.addColorStop(0.45, base);
      g.addColorStop(1, mixHex(base, '#000000', 0.45));
      ctx.fillStyle = g;
      roundRect(ctx, needle, -9 * k, guard, 18 * k, 2.5 * k);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      roundRect(ctx, needle + guard - 1, -6 * k, handle, 12 * k, 6 * k);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (let i = 0; i < 7; i++) ctx.fillRect(needle + guard + 12 * k + i * 6.5 * k, -6 * k, 2 * k, 12 * k);
      ctx.restore();
      if (pr.hole) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function rotOff(at: Hole, dx: number, dy: number, rot: number): [number, number] {
  const [rx, ry] = rotate(dx, dy, rot);
  return [at.x + rx, at.y + ry];
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function groove(ctx: CanvasRenderingContext2D, x0: number, y: number, x1: number, w: number) {
  ctx.fillStyle = 'rgba(120, 112, 92, 0.28)';
  ctx.fillRect(x0, y - w / 2, x1 - x0, w);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillRect(x0, y + w / 2, x1 - x0, w * 0.5);
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16),
    pb = parseInt(b.slice(1), 16);
  const ch = (v: number, sh: number) => (v >> sh) & 255;
  const m = (sh: number) => Math.round(ch(pa, sh) + (ch(pb, sh) - ch(pa, sh)) * t);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}
