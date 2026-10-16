// Pin tumbler: the bench, the lock in section, the pick and wrench, and the face of the plug.

import {
  CHAMBER_TOP,
  DRIVER,
  FIRST,
  HOOK,
  KW_BOT,
  KW_TOP,
  PIN_D,
  PITCH,
  R,
  SHEAR,
  SPOOL_LIP,
  SPOOL_WAIST,
  type Lock,
  type Pin,
} from './_lock';

export interface Layout {
  w: number;
  h: number;
  dpr: number;
  /** Pixels per millimetre, and the screen position of the world origin (plug axis at the lock face). */
  s: number;
  ox: number;
  oy: number;
  wide: boolean;
  face: { x: number; y: number; r: number };
}

/** Room the page's own controls take up, in CSS pixels, so the lock sits clear of them. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const HOUSING_BOT = -R - 2.4;
const BIBLE_TOP = CHAMBER_TOP + 1.3;

export function layout(w: number, h: number, dpr: number, lock: Lock, inset: Insets): Layout {
  const wide = w >= 820;
  const len = lock.length;
  // The world box the lock needs: the face's collar on the left, the cam on the right, the wrench's
  // handle below, the bible's cap above.
  const x0 = -4.2;
  const x1 = len + 4.4;
  const y0 = HOUSING_BOT - 5.5;
  const y1 = BIBLE_TOP + 1.2;
  const faceRoom = wide ? Math.min(240, w * 0.2) : 0;
  const availW = w - inset.left - inset.right - faceRoom - (wide ? 56 : 32);
  const availH = h - inset.top - inset.bottom - (wide ? 24 : 96);
  const s = Math.max(6, Math.min(availW / (x1 - x0), availH / (y1 - y0), wide ? 30 : 16));
  const boxW = (x1 - x0) * s + faceRoom;
  const left = inset.left + (w - inset.left - inset.right - boxW) / 2;
  const ox = left - x0 * s;
  const top = inset.top + (wide ? 12 : 92) + (availH - (y1 - y0) * s) / 2;
  const oy = top + y1 * s;
  const face = wide
    ? { x: ox + x1 * s + faceRoom / 2 + 8, y: oy - (SHEAR - 2) * s, r: Math.min(faceRoom * 0.42, 96) }
    : { x: w - 16 - 40, y: inset.top + 50, r: 40 };
  return { w, h, dpr, s, ox, oy, wide, face };
}

export const toWorld = (L: Layout, x: number, y: number) => ({ x: (x - L.ox) / L.s, y: (L.oy - y) / L.s });

// ---------------------------------------------------------------------------
// Palette

const BRASS = { lit: '#d9b264', mid: '#b98d3e', deep: '#7c5a22', edge: '#4a3410' };
const PLUG = { lit: '#e4c27a', mid: '#c79d4c', deep: '#86622a', edge: '#4f3912' };
const STEEL = { lit: '#eef1f3', mid: '#a7adb3', deep: '#5d636a', edge: '#2c3035' };
const VOID = '#141210';
const SHEAR_INK = '#ef6a3a';

// ---------------------------------------------------------------------------
// The bench: a cutting mat ruled in millimetres under a lamp, cached per layout.

export function paintBench(L: Layout, lock: Lock): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(L.w * L.dpr);
  c.height = Math.round(L.h * L.dpr);
  const g = c.getContext('2d')!;
  g.scale(L.dpr, L.dpr);
  g.fillStyle = '#141b19';
  g.fillRect(0, 0, L.w, L.h);

  // The mat's ruling: tenths of a centimetre faint, centimetres firmer, numbered along the bottom.
  const cx = L.ox + (lock.length / 2) * L.s;
  const cy = L.oy - 4 * L.s;
  const xmin = Math.floor((0 - L.ox) / L.s) - 1;
  const xmax = Math.ceil((L.w - L.ox) / L.s) + 1;
  const ymin = Math.floor((L.oy - L.h) / L.s) - 1;
  const ymax = Math.ceil(L.oy / L.s) + 1;
  const minor = L.s >= 9;
  for (let mm = xmin; mm <= xmax; mm++) {
    const major = mm % 10 === 0;
    const half = mm % 5 === 0;
    if (!major && !half && !minor) continue;
    g.strokeStyle = major ? 'rgb(150 196 176 / 0.2)' : half ? 'rgb(150 196 176 / 0.11)' : 'rgb(150 196 176 / 0.05)';
    g.lineWidth = major ? 1 : 0.75;
    const x = Math.round(L.ox + mm * L.s) + 0.5;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, L.h);
    g.stroke();
  }
  for (let mm = ymin; mm <= ymax; mm++) {
    const major = mm % 10 === 0;
    const half = mm % 5 === 0;
    if (!major && !half && !minor) continue;
    g.strokeStyle = major ? 'rgb(150 196 176 / 0.2)' : half ? 'rgb(150 196 176 / 0.11)' : 'rgb(150 196 176 / 0.05)';
    g.lineWidth = major ? 1 : 0.75;
    const y = Math.round(L.oy - mm * L.s) + 0.5;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(L.w, y);
    g.stroke();
  }
  // Grain, so the mat isn't a flat fill.
  const grain = g.createImageData(128, 128);
  const r = mulberry(7);
  for (let i = 0; i < grain.data.length; i += 4) {
    const v = r() * 255;
    grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = v;
    grain.data[i + 3] = 10;
  }
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  tile.getContext('2d')!.putImageData(grain, 0, 0);
  g.fillStyle = g.createPattern(tile, 'repeat')!;
  g.fillRect(0, 0, L.w, L.h);

  // The lamp: a warm pool on the lock, falling off to the corners.
  const reach = Math.max(L.w, L.h) * 0.75;
  const lamp = g.createRadialGradient(cx, cy, 0, cx, cy, reach);
  lamp.addColorStop(0, 'rgb(255 214 150 / 0.13)');
  lamp.addColorStop(0.45, 'rgb(255 200 140 / 0.04)');
  lamp.addColorStop(1, 'rgb(0 0 0 / 0.55)');
  g.fillStyle = lamp;
  g.fillRect(0, 0, L.w, L.h);
  return c;
}

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Shapes, in millimetres

function housingPath(lock: Lock): Path2D {
  const p = new Path2D();
  const len = lock.length;
  const b0 = FIRST - PITCH / 2 - 0.2;
  const b1 = FIRST + (lock.spec.pins - 1) * PITCH + PITCH / 2 + 0.2;
  const shellTop = R + 2.4;
  const rr = 0.9;
  p.moveTo(0, HOUSING_BOT + rr);
  p.lineTo(0, shellTop);
  p.lineTo(b0 - rr, shellTop);
  p.quadraticCurveTo(b0, shellTop, b0, shellTop + rr);
  p.lineTo(b0, BIBLE_TOP - rr);
  p.quadraticCurveTo(b0, BIBLE_TOP, b0 + rr, BIBLE_TOP);
  p.lineTo(b1 - rr, BIBLE_TOP);
  p.quadraticCurveTo(b1, BIBLE_TOP, b1, BIBLE_TOP - rr);
  p.lineTo(b1, shellTop + rr);
  p.quadraticCurveTo(b1, shellTop, b1 + rr, shellTop);
  p.lineTo(len + 0.6 - rr, shellTop);
  p.quadraticCurveTo(len + 0.6, shellTop, len + 0.6, shellTop - rr);
  p.lineTo(len + 0.6, HOUSING_BOT + rr);
  p.quadraticCurveTo(len + 0.6, HOUSING_BOT, len + 0.6 - rr, HOUSING_BOT);
  p.lineTo(rr, HOUSING_BOT);
  p.quadraticCurveTo(0, HOUSING_BOT, 0, HOUSING_BOT + rr);
  p.closePath();
  return p;
}

/** The collar at the face, standing proud of the door. */
function collarPath(): Path2D {
  const p = new Path2D();
  const top = R + 3.6;
  const bot = HOUSING_BOT - 1.2;
  p.moveTo(-0.2, top);
  p.lineTo(-1.6, top - 0.4);
  p.quadraticCurveTo(-2.2, top - 0.6, -2.2, top - 1.4);
  p.lineTo(-2.2, bot + 1.4);
  p.quadraticCurveTo(-2.2, bot + 0.6, -1.6, bot + 0.4);
  p.lineTo(-0.2, bot);
  p.closePath();
  return p;
}

function plugPath(lock: Lock, squash: number): Path2D {
  const p = new Path2D();
  const r = R * Math.max(0.0001, squash);
  p.rect(-2.2, -R, lock.length + 2.2 - 0.4, 2 * R);
  void r;
  return p;
}

function hatch(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, gap: number, dir: 1 | -1) {
  g.beginPath();
  const h = y1 - y0;
  for (let x = x0 - h; x < x1 + h; x += gap) {
    if (dir === 1) {
      g.moveTo(x, y0);
      g.lineTo(x + h, y1);
    } else {
      g.moveTo(x + h, y0);
      g.lineTo(x, y1);
    }
  }
  g.stroke();
}

function sectionFill(
  g: CanvasRenderingContext2D,
  path: Path2D,
  tone: typeof BRASS,
  box: [number, number, number, number],
  dir: 1 | -1,
  px: number,
  clear: boolean,
) {
  const [x0, y0, x1, y1] = box;
  if (clear) {
    g.fillStyle = 'rgb(176 222 236 / 0.13)';
    g.fill(path);
    g.save();
    g.clip(path);
    g.strokeStyle = 'rgb(220 245 255 / 0.07)';
    g.lineWidth = px;
    hatch(g, x0, y0, x1, y1, 0.9, dir);
    g.restore();
    g.strokeStyle = 'rgb(214 240 250 / 0.55)';
    g.lineWidth = px * 1.4;
    g.stroke(path);
    return;
  }
  const grad = g.createLinearGradient(0, y1, 0, y0);
  grad.addColorStop(0, tone.lit);
  grad.addColorStop(0.55, tone.mid);
  grad.addColorStop(1, tone.deep);
  g.fillStyle = grad;
  g.fill(path);
  g.save();
  g.clip(path);
  g.strokeStyle = 'rgb(60 38 8 / 0.3)';
  g.lineWidth = Math.max(px * 0.9, 0.05);
  hatch(g, x0, y0, x1, y1, 0.62, dir);
  g.restore();
  g.strokeStyle = tone.edge;
  g.lineWidth = px * 1.4;
  g.stroke(path);
}

function voidRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, clear: boolean, px: number) {
  if (clear) {
    g.fillStyle = 'rgb(10 20 24 / 0.38)';
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgb(214 240 250 / 0.4)';
    g.lineWidth = px;
    g.strokeRect(x, y, w, h);
    return;
  }
  const grad = g.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, '#060504');
  grad.addColorStop(0.2, VOID);
  grad.addColorStop(0.8, '#1d1a15');
  grad.addColorStop(1, '#0a0908');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
}

function cylinderGradient(g: CanvasRenderingContext2D, x: number, w: number, tone: typeof STEEL): CanvasGradient {
  const grad = g.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, tone.edge);
  grad.addColorStop(0.18, tone.deep);
  grad.addColorStop(0.4, tone.lit);
  grad.addColorStop(0.62, tone.mid);
  grad.addColorStop(1, tone.edge);
  return grad;
}

const KEYPIN = { lit: '#f7dc8f', mid: '#cfa448', deep: '#8c6a24', edge: '#4a3510' };

function drawKeyPin(g: CanvasRenderingContext2D, x: number, pin: Pin, px: number, alpha: number) {
  const w = PIN_D - 0.06;
  const l = x - w / 2;
  const b = pin.keyY;
  const t = pin.keyY + pin.key;
  const tip = 0.7;
  g.save();
  g.globalAlpha = alpha;
  g.beginPath();
  g.moveTo(l, t);
  g.lineTo(l + w, t);
  g.lineTo(l + w, b + tip);
  g.quadraticCurveTo(l + w * 0.8, b, x, b);
  g.quadraticCurveTo(l + w * 0.2, b, l, b + tip);
  g.closePath();
  g.fillStyle = cylinderGradient(g, l, w, KEYPIN);
  g.fill();
  g.strokeStyle = KEYPIN.edge;
  g.lineWidth = px;
  g.stroke();
  // The chamfer at the top end.
  g.strokeStyle = 'rgb(255 240 200 / 0.4)';
  g.beginPath();
  g.moveTo(l + 0.15, t - 0.18);
  g.lineTo(l + w - 0.15, t - 0.18);
  g.stroke();
  g.restore();
}

function drawDriver(g: CanvasRenderingContext2D, x: number, pin: Pin, px: number) {
  const w = PIN_D - 0.06;
  const l = x - w / 2;
  const b = pin.drvY;
  const t = b + DRIVER;
  g.beginPath();
  if (pin.driver === 'spool') {
    const waist = w * 0.22;
    const y1 = b + SPOOL_LIP;
    const y2 = y1 + SPOOL_WAIST;
    g.moveTo(l, b);
    g.lineTo(l + w, b);
    g.lineTo(l + w, y1);
    g.quadraticCurveTo(l + w - waist, y1 + 0.1, l + w - waist, (y1 + y2) / 2);
    g.quadraticCurveTo(l + w - waist, y2 - 0.1, l + w, y2);
    g.lineTo(l + w, t);
    g.lineTo(l, t);
    g.lineTo(l, y2);
    g.quadraticCurveTo(l + waist, y2 - 0.1, l + waist, (y1 + y2) / 2);
    g.quadraticCurveTo(l + waist, y1 + 0.1, l, y1);
    g.closePath();
  } else if (pin.driver === 'serrated') {
    g.moveTo(l, t);
    g.lineTo(l + w, t);
    let y = b + 1.05;
    g.lineTo(l + w, y);
    for (const s of [0.93, 0.62, 0.31]) {
      g.lineTo(l + w - 0.22, b + s - 0.08);
      g.lineTo(l + w, b + s - 0.16);
    }
    g.lineTo(l + w, b);
    g.lineTo(l, b);
    y = b;
    for (const s of [0.31, 0.62, 0.93]) {
      g.lineTo(l, b + s - 0.16);
      g.lineTo(l + 0.22, b + s - 0.08);
    }
    g.lineTo(l, b + 1.05);
    g.closePath();
  } else {
    g.rect(l, b, w, DRIVER);
  }
  g.fillStyle = cylinderGradient(g, l, w, STEEL);
  g.fill();
  g.strokeStyle = STEEL.edge;
  g.lineWidth = px;
  g.stroke();
  g.strokeStyle = 'rgb(255 255 255 / 0.35)';
  g.beginPath();
  g.moveTo(l + 0.15, t - 0.18);
  g.lineTo(l + w - 0.15, t - 0.18);
  g.stroke();
}

function drawSpring(g: CanvasRenderingContext2D, x: number, bottom: number, top: number, px: number) {
  const coils = 9;
  const w = PIN_D * 0.86;
  const len = top - bottom;
  const wire = Math.max(0.2, Math.min(0.32, len / coils / 2.4));
  // Back half of each coil first, darker, then the front half over it.
  for (const front of [false, true]) {
    g.strokeStyle = front ? '#c5ccd2' : '#555c63';
    g.lineWidth = wire;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < coils; i++) {
      const y0 = bottom + (len * i) / coils;
      const y1 = bottom + (len * (i + 0.5)) / coils;
      const y2 = bottom + (len * (i + 1)) / coils;
      if (front) {
        g.moveTo(x - w / 2, y0);
        g.lineTo(x + w / 2, y1);
      } else {
        g.moveTo(x + w / 2, y1);
        g.lineTo(x - w / 2, y2);
      }
    }
    g.stroke();
  }
  g.lineCap = 'butt';
  void px;
}

// ---------------------------------------------------------------------------
// The pick and the wrench

function drawWrench(g: CanvasRenderingContext2D, px: number, tension: number) {
  // A bottom-of-keyway wrench: a short blade in the keyway, bent down out of the face.
  const blade = 0.75;
  const lean = tension * 0.9;
  g.beginPath();
  g.moveTo(3.2, KW_BOT);
  g.lineTo(3.2, KW_BOT + blade);
  g.lineTo(-2.9, KW_BOT + blade);
  g.quadraticCurveTo(-3.75, KW_BOT + blade, -3.75 - lean * 0.2, KW_BOT - 0.4);
  g.lineTo(-3.75 - lean, HOUSING_BOT - 5.2);
  g.lineTo(-2.95 - lean, HOUSING_BOT - 5.2);
  g.lineTo(-2.95 - lean * 0.2, KW_BOT - 0.3);
  g.quadraticCurveTo(-2.95, KW_BOT, -2.4, KW_BOT);
  g.closePath();
  const grad = g.createLinearGradient(0, KW_BOT + blade, 0, KW_BOT);
  grad.addColorStop(0, '#9aa3ab');
  grad.addColorStop(0.5, '#4c535a');
  grad.addColorStop(1, '#2b2f33');
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = '#15181b';
  g.lineWidth = px;
  g.stroke();
}

/** Where the pick's shaft crosses the keyway mouth, and its hook. */
function pickGeometry(lock: Lock) {
  const tipX = lock.px;
  const tipY = lock.py;
  const baseX = tipX - 1.5;
  const baseY = tipY - HOOK;
  const mouthX = -2.2;
  const mouthY = Math.max(KW_BOT + 1.25, Math.min(KW_TOP - 1.0, baseY - 0.3 - (baseX - mouthX) * 0.02));
  return { tipX, tipY, baseX, baseY, mouthX, mouthY };
}

function drawPick(g: CanvasRenderingContext2D, lock: Lock, px: number, bend: number, inside: boolean) {
  const { tipX, tipY, baseX, baseY, mouthX, mouthY } = pickGeometry(lock);
  // The shaft is a lever through the keyway mouth: the handle end drops as the tip rises.
  const slope = (baseY - mouthY) / Math.max(0.5, baseX - mouthX);
  const handleX = -16;
  const handleY = mouthY - slope * (mouthX - handleX) - 0;
  const bow = Math.min(0.5, bend * 0.6);
  const thick = 0.62;

  g.save();
  if (!inside) {
    // Only the part outside the lock can be seen.
    g.beginPath();
    g.rect(-60, -60, 60 - 2.2, 120);
    g.clip();
  }
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const shaft = new Path2D();
  shaft.moveTo(handleX, handleY);
  shaft.quadraticCurveTo((handleX + baseX) / 2, (handleY + baseY) / 2 + bow, baseX, baseY);
  shaft.bezierCurveTo(baseX + 0.9, baseY, tipX - 0.1, tipY - HOOK * 0.55, tipX, tipY - 0.18);
  g.strokeStyle = '#23272b';
  g.lineWidth = thick + px * 2.4;
  g.stroke(shaft);
  g.strokeStyle = '#c3c9ce';
  g.lineWidth = thick;
  g.stroke(shaft);
  g.strokeStyle = 'rgb(255 255 255 / 0.55)';
  g.lineWidth = thick * 0.28;
  g.stroke(shaft);
  // The tip: a rounded toe.
  g.fillStyle = '#d6dbe0';
  g.beginPath();
  g.arc(tipX, tipY - 0.3, 0.34, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // The handle, wrapped in dark grip tape.
  const hx0 = handleX - 26;
  const ang = Math.atan2(handleY - (mouthY - slope * (mouthX - hx0)), handleX - hx0);
  g.save();
  g.translate(handleX, handleY);
  g.rotate(ang);
  const grip = g.createLinearGradient(0, -1.6, 0, 1.6);
  grip.addColorStop(0, '#3a3f45');
  grip.addColorStop(0.35, '#22262a');
  grip.addColorStop(1, '#0d0f11');
  g.fillStyle = grip;
  g.beginPath();
  g.roundRect(-30, -1.5, 30.5, 3, 1.4);
  g.fill();
  g.strokeStyle = 'rgb(255 255 255 / 0.05)';
  g.lineWidth = 0.18;
  for (let x = -29; x < -1; x += 0.9) {
    g.beginPath();
    g.moveTo(x, -1.4);
    g.lineTo(x + 0.5, 1.4);
    g.stroke();
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// The whole scene

export interface DrawOpts {
  xray: boolean;
  labels: boolean;
  coach: boolean;
  time: number;
}

export function drawScene(g: CanvasRenderingContext2D, L: Layout, lock: Lock, bench: HTMLCanvasElement, o: DrawOpts) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(bench, 0, 0);
  const px = 1 / L.s;
  g.setTransform(L.dpr * L.s, 0, 0, -L.dpr * L.s, L.dpr * L.ox, L.dpr * L.oy);

  const spec = lock.spec;
  const clear = spec.clear;
  const open = Math.min(1, lock.turn / 90);
  const squash = lock.opened ? Math.cos((lock.turn * Math.PI) / 180) : 1;
  const slip = lock.slip;
  const len = lock.length;
  const hidden = spec.blind && !o.xray;

  // A soft cast shadow under the lock body.
  g.save();
  g.shadowColor = 'rgb(0 0 0 / 0.55)';
  g.shadowBlur = 26 * L.dpr;
  g.shadowOffsetY = 8 * L.dpr;
  g.fillStyle = '#000';
  g.fill(housingPath(lock));
  g.restore();

  drawWrench(g, px, lock.tension);

  if (hidden) {
    drawExterior(g, lock, px);
    drawPick(g, lock, px, lock.feel.bend, false);
    drawFace(g, L, lock, o);
    return;
  }

  // Housing, hatched one way; plug, hatched the other, as a section drawing would.
  const housing = housingPath(lock);
  sectionFill(g, housing, BRASS, [0, HOUSING_BOT, len + 0.6, BIBLE_TOP], 1, px, clear);
  sectionFill(g, collarPath(), BRASS, [-2.2, HOUSING_BOT - 1.2, 0, R + 3.6], 1, px, clear);

  // Chambers in the housing.
  for (const p of lock.pins) voidRect(g, p.x - PIN_D / 2, SHEAR, PIN_D, CHAMBER_TOP - SHEAR, clear, px);
  // The cap strip that closes the chambers.
  g.fillStyle = clear ? 'rgb(214 240 250 / 0.18)' : '#8d6a2c';
  g.fillRect(lock.pins[0].x - PIN_D / 2 - 0.4, CHAMBER_TOP, (spec.pins - 1) * PITCH + PIN_D + 0.8, 0.5);

  // The plug turns about its axis, out of the plane of the section, so on opening its
  // section flattens toward the axis.
  g.save();
  g.translate(0, 0);
  g.scale(1, squash);
  const plug = plugPath(lock, 1);
  sectionFill(g, plug, PLUG, [-2.2, -R, len - 0.4, R], -1, px / Math.max(0.2, squash), clear);
  voidRect(g, -2.2, KW_BOT, len - 1.2, KW_TOP - KW_BOT, clear, px);
  // The keyway's wards, seen edge-on as two ribs.
  g.strokeStyle = clear ? 'rgb(214 240 250 / 0.22)' : 'rgb(120 96 50 / 0.5)';
  g.lineWidth = px;
  for (const y of [KW_BOT + 2.1, KW_TOP - 1.5]) {
    g.beginPath();
    g.moveTo(-2.2, y);
    g.lineTo(len - 3.4, y);
    g.stroke();
  }
  for (const p of lock.pins) voidRect(g, p.x - slip - PIN_D / 2, KW_TOP - 0.01, PIN_D, SHEAR - KW_TOP + 0.01, clear, px);
  g.restore();

  // The cam at the back of the plug.
  drawCam(g, lock, px, open);

  // Springs and drivers, in the housing.
  for (const p of lock.pins) {
    const lean = p === lock.binding ? 0.06 : p.state !== 'free' ? -0.04 : 0;
    const x = p.x + lean;
    drawSpring(g, x, p.drvY + DRIVER, CHAMBER_TOP, px);
    drawDriver(g, x, p, px);
  }

  // Key pins ride in the plug, so they turn away with it.
  g.save();
  g.scale(1, squash);
  for (const p of lock.pins) drawKeyPin(g, p.x - slip, p, px / Math.max(0.2, squash), 1 - open * 0.6);
  g.restore();

  // The shear line.
  g.save();
  g.strokeStyle = SHEAR_INK;
  g.lineWidth = px * 1.2;
  g.setLineDash([0.5, 0.35]);
  g.beginPath();
  g.moveTo(-2.6, SHEAR);
  g.lineTo(len + 1.4, SHEAR);
  g.stroke();
  g.restore();

  drawPick(g, lock, px, lock.feel.bend, true);

  // A sheen over clear plastic, on top of everything inside it.
  if (clear) {
    g.save();
    g.clip(housing);
    const sheen = g.createLinearGradient(0, BIBLE_TOP, len * 0.5, HOUSING_BOT);
    sheen.addColorStop(0, 'rgb(255 255 255 / 0.12)');
    sheen.addColorStop(0.4, 'rgb(255 255 255 / 0)');
    g.fillStyle = sheen;
    g.fillRect(0, HOUSING_BOT, len + 1, BIBLE_TOP - HOUSING_BOT);
    g.restore();
  }

  drawFace(g, L, lock, o);
  if (o.labels) drawLabels(g, L, lock, o);
}

function drawCam(g: CanvasRenderingContext2D, lock: Lock, px: number, open: number) {
  const x = lock.length - 0.4;
  g.fillStyle = '#5a5f64';
  g.fillRect(x, -1.2, 2.6, 2.4);
  g.strokeStyle = STEEL.edge;
  g.lineWidth = px;
  g.strokeRect(x, -1.2, 2.6, 2.4);
  // The tailpiece: a flat blade that turns with the plug and throws the bolt.
  const w = 2.4 * Math.abs(Math.cos(open * Math.PI * 0.5)) + 0.5;
  g.fillStyle = '#868c92';
  g.fillRect(x + 2.6, -w / 2, 1.6, w);
  g.strokeRect(x + 2.6, -w / 2, 1.6, w);
}

function drawExterior(g: CanvasRenderingContext2D, lock: Lock, px: number) {
  const housing = housingPath(lock);
  const grad = g.createLinearGradient(0, BIBLE_TOP, 0, HOUSING_BOT);
  grad.addColorStop(0, '#8a6527');
  grad.addColorStop(0.18, '#e3c27a');
  grad.addColorStop(0.32, '#c49543');
  grad.addColorStop(0.7, '#9b7230');
  grad.addColorStop(1, '#4e3812');
  g.fillStyle = grad;
  g.fill(housing);
  g.strokeStyle = BRASS.edge;
  g.lineWidth = px * 1.4;
  g.stroke(housing);
  // Turned rings and the bible's cap screws, so it reads as a solid cylinder.
  g.strokeStyle = 'rgb(60 40 10 / 0.35)';
  for (const x of [1.2, lock.length - 1.2]) {
    g.beginPath();
    g.moveTo(x, HOUSING_BOT + 0.2);
    g.lineTo(x, R + 2.2);
    g.stroke();
  }
  for (const p of lock.pins) {
    g.fillStyle = 'rgb(70 48 14 / 0.4)';
    g.beginPath();
    g.arc(p.x, CHAMBER_TOP - 1.4, 0.5, 0, Math.PI * 2);
    g.fill();
  }
  const collar = collarPath();
  g.fillStyle = grad;
  g.fill(collar);
  g.stroke(collar);
  drawCam(g, lock, px, Math.min(1, lock.turn / 90));
}

// ---------------------------------------------------------------------------
// The face of the lock: what a picker sees, and where tension shows

function drawFace(g: CanvasRenderingContext2D, L: Layout, lock: Lock, o: DrawOpts) {
  const { x, y } = L.face;
  const r = L.face.r * (lock.spec.blind && !o.xray && L.wide ? 1.25 : 1);
  g.save();
  g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  g.translate(x, y);

  // Shadow and the housing's collar.
  g.shadowColor = 'rgb(0 0 0 / 0.6)';
  g.shadowBlur = 18;
  g.shadowOffsetY = 6;
  const collar = g.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r);
  collar.addColorStop(0, '#f0d38e');
  collar.addColorStop(0.55, '#c39548');
  collar.addColorStop(1, '#6f5019');
  g.fillStyle = collar;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.shadowColor = 'transparent';
  g.strokeStyle = 'rgb(60 40 10 / 0.6)';
  g.lineWidth = 1;
  g.beginPath();
  g.arc(0, 0, r * 0.97, 0, Math.PI * 2);
  g.stroke();
  // Brushed rings on the collar.
  g.strokeStyle = 'rgb(255 236 190 / 0.08)';
  for (let k = 0.7; k < 0.96; k += 0.035) {
    g.beginPath();
    g.arc(0, 0, r * k, 0, Math.PI * 2);
    g.stroke();
  }

  const pr = r * 0.6;
  // A tick at top dead centre on the housing, for judging the turn against.
  g.strokeStyle = '#3b2a0c';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, -r * 0.94);
  g.lineTo(0, -pr - 3);
  g.stroke();

  const turn = (lock.turn * Math.PI) / 180;
  g.rotate(turn);
  // The plug: a gap ring around it, then its own face.
  g.fillStyle = '#2a1e0a';
  g.beginPath();
  g.arc(0, 0, pr + 1.5, 0, Math.PI * 2);
  g.fill();
  const plug = g.createRadialGradient(-pr * 0.35, -pr * 0.45, pr * 0.1, 0, 0, pr);
  plug.addColorStop(0, '#f6dc9c');
  plug.addColorStop(0.6, '#cfa253');
  plug.addColorStop(1, '#8d6826');
  g.fillStyle = plug;
  g.beginPath();
  g.arc(0, 0, pr, 0, Math.PI * 2);
  g.fill();
  // The plug's index mark, which leaves the housing's tick as it turns.
  g.strokeStyle = '#3b2a0c';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, -pr + 2);
  g.lineTo(0, -pr * 0.66);
  g.stroke();

  // A paracentric keyway: a zig-zag slot.
  const k = pr / 6.35;
  const kw = [
    [-0.7, 3.0],
    [0.7, 3.0],
    [0.7, 1.6],
    [0.15, 0.9],
    [0.7, 0.1],
    [0.7, -1.4],
    [0.2, -2.2],
    [0.7, -3.0],
    [0.7, -4.3],
    [-0.7, -4.3],
    [-0.7, -3.1],
    [-0.15, -2.3],
    [-0.7, -1.5],
    [-0.7, 0.0],
    [-0.2, 0.8],
    [-0.7, 1.5],
  ];
  g.fillStyle = '#0d0b08';
  g.beginPath();
  kw.forEach(([a, b], i) => (i ? g.lineTo(a * k, -b * k) : g.moveTo(a * k, -b * k)));
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgb(255 236 190 / 0.25)';
  g.lineWidth = 1;
  g.stroke();

  // The wrench, in the bottom of the keyway and out past the collar; it turns with the plug.
  g.fillStyle = '#596067';
  g.strokeStyle = '#15181b';
  g.beginPath();
  g.rect(-0.55 * k, 3.6 * k, 1.1 * k, r * 1.05 - 3.6 * k);
  g.fill();
  g.stroke();
  g.fillStyle = '#7d858c';
  g.fillRect(-0.55 * k, 3.6 * k, 1.1 * k, 0.6 * k);
  g.rotate(-turn);

  // Tension, as an arc of pressure on the wrench's handle.
  if (lock.tension > 0.01 && !lock.opened) {
    g.strokeStyle = `rgb(239 106 58 / ${0.35 + lock.tension * 0.6})`;
    g.lineWidth = 2 + lock.tension * 3;
    g.lineCap = 'round';
    const a0 = Math.PI / 2 + turn + 0.12;
    g.beginPath();
    g.arc(0, 0, r * 1.14, a0, a0 + 0.2 + lock.tension * 0.7);
    g.stroke();
    g.lineCap = 'butt';
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// Callouts

function drawLabels(g: CanvasRenderingContext2D, L: Layout, lock: Lock, o: DrawOpts) {
  g.save();
  g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  const sx = (x: number) => L.ox + x * L.s;
  const sy = (y: number) => L.oy - y * L.s;
  const fontSize = L.wide ? 13 : 11;
  g.font = `600 ${fontSize}px ${FACE}`;
  g.textBaseline = 'middle';
  const ink = 'rgb(232 226 212 / 0.86)';
  const lead = 'rgb(232 226 212 / 0.45)';

  const callout = (text: string, ax: number, ay: number, tx: number, ty: number, align: CanvasTextAlign) => {
    g.strokeStyle = lead;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(tx, ty);
    g.lineTo(tx + (align === 'left' ? 6 : -6), ty);
    g.stroke();
    g.fillStyle = lead;
    g.beginPath();
    g.arc(ax, ay, 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ink;
    g.textAlign = align;
    g.fillText(text.toUpperCase(), tx + (align === 'left' ? 10 : -10), ty);
  };

  const first = lock.pins[0];
  const last = lock.pins[lock.pins.length - 1];
  const leftX = sx(-2.6) - (L.wide ? 40 : 4);
  if (L.wide) {
    callout('Spring', sx(first.x - 0.6), sy(CHAMBER_TOP - 1.6), leftX, sy(CHAMBER_TOP - 0.6), 'right');
    callout('Driver pin', sx(first.x - 0.9), sy(first.drvY + DRIVER * 0.5), leftX, sy(SHEAR + 3.4), 'right');
    callout('Key pin', sx(first.x - lock.slip - 0.9), sy(first.keyY + first.key * 0.6), leftX, sy(SHEAR - 2.0), 'right');
    callout('Plug', sx(0.4), sy(-R + 1.0), leftX, sy(-R + 0.4), 'right');
    callout('Tension wrench', sx(-3.4), sy(HOUSING_BOT - 3.6), leftX, sy(HOUSING_BOT - 3.6), 'right');
    callout('Shear line', sx(lock.length + 1.4), sy(SHEAR), sx(lock.length + 2.6), sy(SHEAR + 1.4), 'left');
  } else {
    g.textAlign = 'left';
    g.fillStyle = 'rgb(239 106 58 / 0.9)';
    g.fillText('SHEAR LINE', sx(last.x + PIN_D / 2 + 0.2), sy(SHEAR) - 9);
  }

  // On coached locks, name the pin that's binding.
  const b = lock.binding;
  if (o.coach && b && !lock.opened) {
    const x = sx(b.x);
    const y = sy(BIBLE_TOP) - 12;
    g.textAlign = 'center';
    g.font = `700 ${fontSize}px ${FACE}`;
    const label = b.state === 'caught' ? 'CAUGHT SPOOL' : 'BINDING';
    const w = g.measureText(label).width + 12;
    g.fillStyle = '#ef6a3a';
    g.beginPath();
    g.roundRect(x - w / 2, y - 10, w, 20, 3);
    g.fill();
    g.beginPath();
    g.moveTo(x - 5, y + 10);
    g.lineTo(x + 5, y + 10);
    g.lineTo(x, y + 15);
    g.fill();
    g.fillStyle = '#1a0e08';
    g.fillText(label, x, y + 1);
  }
  g.restore();
}

let FACE = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

/** Canvas text can't read a CSS variable, so the page passes in the resolved family. */
export function useFace(family: string) {
  if (family) FACE = family;
}
