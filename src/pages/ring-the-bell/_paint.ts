// Shared paint: the machine's colours, the shapes its art is built from, and the lamp inserts.
// Everything is drawn in the caller's units (millimetres on the playfield, design units on the backglass).

export const C = {
  cream: '#f1e4c3',
  creamShade: '#ddc89c',
  paper: '#f8f0dc',
  red: '#c6302a',
  redDark: '#8c1c18',
  gold: '#e4a52b',
  goldLight: '#f7d47c',
  goldDark: '#a8701a',
  navy: '#1d2653',
  navyDeep: '#121738',
  teal: '#1f7c80',
  tealDark: '#13545a',
  ink: '#1c1922',
  white: '#fbf6e8',
  wood: '#a5703e',
  woodDark: '#6e4421',
  chrome: '#c9ccd2',
  chromeDark: '#6d7179',
  rubber: '#f4f1e8',
};

export type Ctx = CanvasRenderingContext2D;

/** A small seeded generator, so the art is the same on every load. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function starPath(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  points = 5,
  inner = 0.45,
  rot = -Math.PI / 2,
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const rr = i % 2 === 0 ? r : r * inner;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | number[]): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** A capsule (stadium) around segment a-b. */
export function capsulePath(ctx: Ctx, ax: number, ay: number, bx: number, by: number, r: number): void {
  const a = Math.atan2(by - ay, bx - ax);
  ctx.beginPath();
  ctx.arc(bx, by, r, a - Math.PI / 2, a + Math.PI / 2);
  ctx.arc(ax, ay, r, a + Math.PI / 2, a + (Math.PI * 3) / 2);
  ctx.closePath();
}

/** A tapered capsule: radius ra at a, rb at b (a flipper's outline). */
export function taperPath(ctx: Ctx, ax: number, ay: number, bx: number, by: number, ra: number, rb: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const a = Math.atan2(dy, dx);
  const k = Math.asin(Math.max(-1, Math.min(1, (ra - rb) / len)));
  ctx.beginPath();
  ctx.arc(bx, by, rb, a - Math.PI / 2 + k, a + Math.PI / 2 - k);
  ctx.arc(ax, ay, ra, a + Math.PI / 2 - k, a + (Math.PI * 3) / 2 + k);
  ctx.closePath();
}

/** Mix two hex colours. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const m = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `rgb(${m(16)}, ${m(8)}, ${m(0)})`;
}

/** Mix two hex colours into a hex colour. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  let out = 0;
  for (const s of [16, 8, 0]) {
    const ca = (pa >> s) & 255;
    const cb = (pb >> s) & 255;
    out |= Math.round(ca + (cb - ca) * t) << s;
  }
  return `#${out.toString(16).padStart(6, '0')}`;
}

export function hexA(hex: string, alpha: number): string {
  const p = parseInt(hex.slice(1), 16);
  return `rgba(${(p >> 16) & 255}, ${(p >> 8) & 255}, ${p & 255}, ${alpha})`;
}

/** Text set along an arc, centred on angle `mid` (radians; -PI/2 is the top). */
export function arcText(
  ctx: Ctx,
  text: string,
  cx: number,
  cy: number,
  r: number,
  mid: number,
  spacing = 0,
  inward = false,
): void {
  const widths = [...text].map((ch) => ctx.measureText(ch).width + spacing);
  const total = widths.reduce((s, w) => s + w, 0) - spacing;
  let a = mid - ((inward ? -1 : 1) * total) / 2 / r;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [i, ch] of [...text].entries()) {
    const w = widths[i];
    const step = ((inward ? -1 : 1) * w) / r;
    const at = a + step / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(at) * r, cy + Math.sin(at) * r);
    ctx.rotate(at + (inward ? -Math.PI / 2 : Math.PI / 2));
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += step;
  }
  ctx.restore();
}

// ---- Lamp inserts ---------------------------------------------------------

export type InsertShape = 'round' | 'ticket' | 'oval' | 'arrow';

export interface Insert {
  x: number;
  y: number;
  shape: InsertShape;
  /** Size: radius for round, half-width for the others. */
  r: number;
  color: string;
  rot?: number;
  label?: string;
}

function insertPath(ctx: Ctx, ins: Insert, grow = 0): void {
  const r = ins.r + grow;
  ctx.save();
  ctx.translate(ins.x, ins.y);
  if (ins.rot) ctx.rotate(ins.rot);
  ctx.beginPath();
  if (ins.shape === 'round') {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  } else if (ins.shape === 'oval') {
    ctx.ellipse(0, 0, r, r * 0.5, 0, 0, Math.PI * 2);
  } else if (ins.shape === 'ticket') {
    // A ticket stub: a rectangle with a half-round notch in each end.
    const h = r * 0.62;
    const n = h * 0.42;
    ctx.moveTo(-r, -h);
    ctx.lineTo(r, -h);
    ctx.lineTo(r, -n);
    ctx.arc(r, 0, n, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(r, h);
    ctx.lineTo(-r, h);
    ctx.lineTo(-r, n);
    ctx.arc(-r, 0, n, Math.PI / 2, -Math.PI / 2, true);
    ctx.closePath();
  } else {
    // An arrow pointing up.
    ctx.moveTo(0, -r * 1.25);
    ctx.lineTo(r, -r * 0.1);
    ctx.lineTo(r * 0.42, -r * 0.1);
    ctx.lineTo(r * 0.42, r);
    ctx.lineTo(-r * 0.42, r);
    ctx.lineTo(-r * 0.42, -r * 0.1);
    ctx.lineTo(-r, -r * 0.1);
    ctx.closePath();
  }
  ctx.restore();
}

/** An unlit insert: coloured plastic over a dark lamp socket, set into the paint with a fine dark rim. */
export function drawInsertOff(ctx: Ctx, ins: Insert): void {
  insertPath(ctx, ins, 0.9);
  ctx.fillStyle = hexA(C.ink, 0.85);
  ctx.fill();
  insertPath(ctx, ins);
  const g = ctx.createRadialGradient(ins.x - ins.r * 0.3, ins.y - ins.r * 0.35, ins.r * 0.1, ins.x, ins.y, ins.r * 1.2);
  g.addColorStop(0, mix(ins.color, '#ffffff', 0.12));
  g.addColorStop(0.55, mix(ins.color, '#000000', 0.42));
  g.addColorStop(1, mix(ins.color, '#000000', 0.62));
  ctx.fillStyle = g;
  ctx.fill();
  // A gloss highlight on the plastic.
  ctx.save();
  insertPath(ctx, ins);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.beginPath();
  ctx.ellipse(ins.x - ins.r * 0.25, ins.y - ins.r * 0.45, ins.r * 0.75, ins.r * 0.32, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (ins.label) drawInsertLabel(ctx, ins, hexA(C.ink, 0.75));
}

export function drawInsertLabel(ctx: Ctx, ins: Insert, color: string): void {
  if (!ins.label) return;
  ctx.save();
  ctx.translate(ins.x, ins.y);
  if (ins.rot) ctx.rotate(ins.rot);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ins.label, 0, ins.shape === 'arrow' ? ins.r * 0.32 : 0.4);
  ctx.restore();
}

const glowCache = new Map<string, HTMLCanvasElement>();

/** A soft additive glow sprite in a colour, cached. */
export function glowSprite(color: string): HTMLCanvasElement {
  const hit = glowCache.get(color);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, hexA(color, 0.75));
  grad.addColorStop(0.25, hexA(color, 0.38));
  grad.addColorStop(0.6, hexA(color, 0.1));
  grad.addColorStop(1, hexA(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowCache.set(color, c);
  return c;
}

/** A lit insert: the plastic glowing from beneath, hot at the bulb, with light spilling onto the paint. */
export function drawInsertOn(ctx: Ctx, ins: Insert, level = 1): void {
  if (level <= 0) return;
  ctx.save();
  ctx.globalAlpha = level;
  insertPath(ctx, ins);
  const g = ctx.createRadialGradient(ins.x, ins.y, 0, ins.x, ins.y, ins.r * 1.15);
  g.addColorStop(0, '#fffbe8');
  g.addColorStop(0.35, mix(ins.color, '#ffffff', 0.45));
  g.addColorStop(1, ins.color);
  ctx.fillStyle = g;
  ctx.fill();
  if (ins.label) drawInsertLabel(ctx, ins, hexA(C.ink, 0.85));
  ctx.globalCompositeOperation = 'lighter';
  const s = ins.r * 4.2;
  ctx.globalAlpha = level * 0.55;
  ctx.drawImage(glowSprite(ins.color), ins.x - s / 2, ins.y - s / 2, s, s);
  ctx.restore();
}
