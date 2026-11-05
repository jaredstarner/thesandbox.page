// The playfield's paint and fixed hardware, drawn once into an offscreen layer.
//
// The art follows a screen-printed sixties playfield: flat spot colours on a cream ground with dark keylines,
// a big-top canopy under the arch, a night sky behind the pop bumpers, a duck gallery on a wooden counter, a
// strength-test tower painted down its own lane, and a sunburst behind the ticket lamps. Rails are chrome,
// posts carry white rubber rings, and everything raised throws a soft shadow toward the player.

import {
  C,
  arcText,
  capsulePath,
  drawInsertOff,
  hexA,
  mixHex,
  roundRect,
  seeded,
  starPath,
  type Ctx,
  type Insert,
} from './_paint';
import { BALLS_PER_GAME, REPLAYS } from './_rules';
import {
  APRON_Y,
  ARCH,
  BUMPERS,
  DIVIDER_TOP,
  DIVIDER_X,
  DUCK_Y,
  GALLERY,
  H,
  INLANE_GUIDE,
  LADDER,
  LAMPS,
  LANE_BOTTOM,
  LANE_GUIDES,
  LANE_TOP,
  LEFT_WALL_X,
  ORBIT_BOTTOM,
  ORBIT_TOP,
  ORBIT_X,
  RIGHT_WALL_X,
  ROLLOVERS,
  SAUCER,
  SEPARATOR_TOP,
  SLING_L,
  SLING_R,
  SPINNER_Y,
  STRIKER,
  TICKETS,
  W,
  lanePoint,
} from './_table';

export interface Fonts {
  display: string;
  text: string;
}

const VALANCE_Y = 212;
const SKY_BOTTOM = 470;

/** Every lamp insert on the playfield, keyed by what lights it. */
export function buildInserts(): Record<string, Insert> {
  const ins: Record<string, Insert> = {
    lane0: { ...LAMPS.lane0, shape: 'round', r: 7, color: C.goldLight },
    lane1: { ...LAMPS.lane1, shape: 'round', r: 7, color: C.goldLight },
    lane2: { ...LAMPS.lane2, shape: 'round', r: 7, color: C.goldLight },
    spinner: { ...LAMPS.spinner, shape: 'round', r: 7.5, color: C.red },
    saucer: { ...LAMPS.saucer, shape: 'arrow', r: 9, color: C.teal },
    specialL: { ...LAMPS.specialL, shape: 'round', r: 8, color: C.red },
    specialR: { ...LAMPS.specialR, shape: 'round', r: 8, color: C.red },
    again: { ...LAMPS.again, shape: 'oval', r: 26, color: C.red },
  };
  for (const [i, t] of TICKETS.entries()) {
    ins[`ticket${i}`] = { ...t, shape: 'ticket', r: 11.5, color: C.gold, label: String(i + 1) };
  }
  for (const [i, p] of LADDER.entries()) {
    ins[`ladder${i}`] = { ...p, shape: 'round', r: 7, color: mixHex(C.goldLight, C.red, i / 9) };
  }
  return ins;
}

function shadow(ctx: Ctx, blur = 3, dx = 1.4, dy = 3, alpha = 0.38): void {
  ctx.shadowColor = `rgba(20, 12, 8, ${alpha})`;
  ctx.shadowBlur = blur * ctx.getTransform().a;
  ctx.shadowOffsetX = dx * ctx.getTransform().a;
  ctx.shadowOffsetY = dy * ctx.getTransform().a;
}

function noShadow(ctx: Ctx): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function archPath(ctx: Ctx, inset: number): void {
  ctx.beginPath();
  ctx.moveTo(LEFT_WALL_X + inset, H);
  ctx.lineTo(LEFT_WALL_X + inset, ARCH.cy);
  ctx.arc(ARCH.cx, ARCH.cy, ARCH.r - inset, Math.PI, 0);
  ctx.lineTo(RIGHT_WALL_X - inset, H);
  ctx.closePath();
}

// ---- Paint ----------------------------------------------------------------

function ground(ctx: Ctx): void {
  ctx.fillStyle = C.cream;
  ctx.fillRect(0, 0, W, H);
  // Print grain: a scatter of faint flecks so the cream doesn't read as a flat screen fill.
  const rnd = seeded(7);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(120, 90, 50, 0.07)' : 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(rnd() * W, rnd() * H, 0.7 + rnd() * 0.9, 0.7 + rnd() * 0.9);
  }
}

function canopy(ctx: Ctx): void {
  ctx.save();
  archPath(ctx, 0);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(0, 0, W, VALANCE_Y);
  ctx.clip();
  ctx.fillStyle = C.red;
  ctx.fillRect(0, 0, W, VALANCE_Y);
  // Canvas stripes fanning down from the tent pole, above the playfield.
  const cx = ARCH.cx;
  const cy = -90;
  const n = 26;
  for (let i = 0; i < n; i++) {
    if (i % 2) continue;
    const a0 = Math.PI * 0.12 + (i / n) * Math.PI * 0.76;
    const a1 = Math.PI * 0.12 + ((i + 1) / n) * Math.PI * 0.76;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * 600, cy + Math.sin(a0) * 600);
    ctx.lineTo(cx + Math.cos(a1) * 600, cy + Math.sin(a1) * 600);
    ctx.closePath();
    ctx.fillStyle = C.paper;
    ctx.fill();
  }
  // The canvas sags between the stripes: a soft darkening toward each seam's foot.
  const sag = ctx.createLinearGradient(0, 40, 0, VALANCE_Y);
  sag.addColorStop(0, 'rgba(60, 10, 5, 0)');
  sag.addColorStop(1, 'rgba(60, 10, 5, 0.22)');
  ctx.fillStyle = sag;
  ctx.fillRect(0, 0, W, VALANCE_Y);
  ctx.restore();
}

function valance(ctx: Ctx): void {
  // A scalloped valance along the canopy's hem, edged in gold, with a tassel at every point.
  const r = 13;
  ctx.save();
  ctx.beginPath();
  ctx.rect(LEFT_WALL_X, 0, DIVIDER_X - LEFT_WALL_X, H);
  ctx.clip();
  shadow(ctx, 3, 0.6, 2.4, 0.35);
  ctx.beginPath();
  ctx.moveTo(0, VALANCE_Y - 8);
  for (let x = 0; x <= W; x += r * 2) ctx.arc(x + r, VALANCE_Y, r, Math.PI, 0, true);
  ctx.lineTo(W, VALANCE_Y - 8);
  ctx.closePath();
  ctx.fillStyle = C.red;
  ctx.fill();
  noShadow(ctx);
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (let x = 0; x <= W; x += r * 2) ctx.arc(x + r, VALANCE_Y, r - 2.2, Math.PI, 0, true);
  ctx.stroke();
  ctx.fillStyle = C.goldLight;
  ctx.strokeStyle = C.goldDark;
  ctx.lineWidth = 0.7;
  for (let x = 0; x <= W; x += r * 2) {
    ctx.beginPath();
    ctx.arc(x, VALANCE_Y + 2.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // A gold band over the scallops' tops.
  ctx.fillStyle = C.gold;
  ctx.fillRect(0, VALANCE_Y - 9, W, 3);
  ctx.restore();
}

function sky(ctx: Ctx): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(LEFT_WALL_X, VALANCE_Y - 6, DIVIDER_X - LEFT_WALL_X, SKY_BOTTOM - VALANCE_Y + 6);
  ctx.clip();
  const g = ctx.createLinearGradient(0, VALANCE_Y, 0, SKY_BOTTOM);
  g.addColorStop(0, C.navyDeep);
  g.addColorStop(1, C.navy);
  ctx.fillStyle = g;
  ctx.fillRect(0, VALANCE_Y - 6, W, SKY_BOTTOM);
  // Stars, kept clear of the bumpers so they read.
  const rnd = seeded(31);
  let placed = 0;
  for (let tries = 0; placed < 46 && tries < 600; tries++) {
    const x = 18 + rnd() * 440;
    const y = VALANCE_Y + 18 + rnd() * (SKY_BOTTOM - VALANCE_Y - 30);
    if (BUMPERS.some((b) => Math.hypot(b.x - x, b.y - y) < 44)) continue;
    const big = rnd() < 0.22;
    const r = big ? 4 + rnd() * 2.5 : 1.2 + rnd() * 1.6;
    ctx.fillStyle = big ? C.goldLight : hexA(C.paper, 0.85);
    if (big) {
      starPath(ctx, x, y, r, 5, 0.45, -Math.PI / 2 + rnd() * 0.5);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    placed++;
  }
  // A crescent moon over the left loop.
  ctx.fillStyle = C.goldLight;
  ctx.beginPath();
  ctx.arc(92, 258, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.navyDeep;
  ctx.beginPath();
  ctx.arc(99, 253, 13.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // A string of festoon bulbs swagged across the sky.
  ctx.save();
  ctx.strokeStyle = hexA(C.ink, 0.9);
  ctx.lineWidth = 1;
  const swags = [
    [62, 232, 150, 232, 250],
    [322, 232, 410, 232, 250],
  ];
  for (const [x0, y0, x1, y1, sagY] of swags) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2, sagY + (sagY - y0), x1, y1);
    ctx.stroke();
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * ((x0 + x1) / 2) + t * t * x1;
      const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * (sagY + (sagY - y0)) + t * t * y1;
      const col = [C.goldLight, C.red, C.paper, C.teal, C.goldLight][i - 1];
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(x, y + 4, 2.6, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      ctx.arc(x - 0.8, y + 3, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function gallery(ctx: Ctx, fonts: Fonts): void {
  const { left, right } = GALLERY;
  const x0 = left - 14;
  const x1 = right + 14;
  // The gallery's backdrop: painted water with rolling waves, under a red-and-gold header board.
  ctx.save();
  ctx.fillStyle = C.teal;
  ctx.fillRect(x0, 458, x1 - x0, 34);
  ctx.strokeStyle = hexA(C.paper, 0.75);
  ctx.lineWidth = 1.4;
  for (const [row, y] of [462, 474].entries()) {
    ctx.beginPath();
    for (let x = x0 - 8 + row * 7; x < x1 + 8; x += 14) ctx.arc(x + 7, y + 6, 7, Math.PI, 0);
    ctx.stroke();
  }
  ctx.fillStyle = C.tealDark;
  ctx.fillRect(x0, 486, x1 - x0, 6);
  // Header board.
  ctx.fillStyle = C.red;
  ctx.fillRect(x0, 440, x1 - x0, 18);
  ctx.fillStyle = C.gold;
  ctx.fillRect(x0, 440, x1 - x0, 2);
  ctx.fillRect(x0, 456, x1 - x0, 2);
  ctx.fillStyle = C.paper;
  ctx.font = `400 10.5px ${fonts.display}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SHOOTING GALLERY', (x0 + x1) / 2, 449.5);
  // The counter in front of the ducks: wood planks with a gold rail.
  const top = DUCK_Y + 6;
  const g = ctx.createLinearGradient(0, top, 0, top + 22);
  g.addColorStop(0, '#b47c45');
  g.addColorStop(1, '#7a4a24');
  ctx.fillStyle = g;
  ctx.fillRect(x0, top, x1 - x0, 22);
  ctx.strokeStyle = 'rgba(60, 30, 10, 0.45)';
  ctx.lineWidth = 0.7;
  for (let x = x0 + 24; x < x1; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + 22);
    ctx.stroke();
  }
  ctx.fillStyle = C.gold;
  ctx.fillRect(x0, top, x1 - x0, 2.5);
  // Pennant bunting hanging from the counter.
  const cols = [C.red, C.goldLight, C.teal, C.paper];
  let k = 0;
  for (let x = x0; x < x1 - 1; x += 16) {
    ctx.fillStyle = cols[k++ % cols.length];
    ctx.beginPath();
    ctx.moveTo(x, top + 22);
    ctx.lineTo(x + 16, top + 22);
    ctx.lineTo(x + 8, top + 36);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hexA(C.ink, 0.5);
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  ctx.restore();
}

function ferrisWheel(ctx: Ctx, fonts: Fonts): void {
  const cx = 104;
  const cy = 556;
  const r = 36;
  ctx.save();
  // A-frame legs.
  ctx.strokeStyle = C.navy;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy + 58);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx + 26, cy + 58);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - 16, cy + 36);
  ctx.lineTo(cx + 16, cy + 36);
  ctx.stroke();
  // Rim and spokes.
  ctx.strokeStyle = C.red;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = C.navy;
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
  // Gondolas hanging plumb from the rim, and a bulb at every spoke end.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    const gx = cx + Math.cos(a) * r;
    const gy = cy + Math.sin(a) * r;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx, gy + 3);
    ctx.stroke();
    ctx.fillStyle = i % 3 === 0 ? C.teal : i % 3 === 1 ? C.gold : C.red;
    roundRect(ctx, gx - 3.4, gy + 3, 6.8, 5, [1, 1, 3, 3]);
    ctx.fill();
    const b = (i / 12) * Math.PI * 2;
    ctx.fillStyle = C.goldLight;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(b) * r, cy + Math.sin(b) * r, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = C.gold;
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function fortune(ctx: Ctx, fonts: Fonts): void {
  const { x, y } = SAUCER;
  ctx.save();
  // A crystal ball on a gold stand, drawn as the saucer's surround.
  const g = ctx.createRadialGradient(x - 8, y - 9, 2, x, y, 30);
  g.addColorStop(0, '#5a6db0');
  g.addColorStop(1, C.navyDeep);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.fillStyle = C.goldLight;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    starPath(ctx, x + Math.cos(a) * 22, y + Math.sin(a) * 22, i % 2 ? 2 : 3, 4, 0.35);
    ctx.fill();
  }
  ctx.fillStyle = C.gold;
  ctx.beginPath();
  ctx.moveTo(x - 16, y + 27);
  ctx.lineTo(x + 16, y + 27);
  ctx.lineTo(x + 11, y + 34);
  ctx.lineTo(x - 11, y + 34);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.paper;
  ctx.font = `400 9px ${fonts.display}`;
  arcText(ctx, 'FORTUNE', x, y, 35, -Math.PI / 2, 0.6);
  ctx.fillStyle = C.goldLight;
  ctx.font = `700 8.5px ${fonts.text}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('EXTRA', x - 25, LAMPS.saucer.y - 1);
  ctx.fillText('BALL', x - 25, LAMPS.saucer.y + 8);
  ctx.restore();
}

function strengthTest(ctx: Ctx, fonts: Fonts): void {
  const { half, len } = STRIKER;
  ctx.save();
  // The lane floor painted as the tower of a high striker: red and white bands up to the bell.
  const corner = (t: number, s: number) => lanePoint(t, s);
  ctx.beginPath();
  const a = corner(-STRIKER.flare, -half - 18);
  const b = corner(0, -half);
  const c = corner(len, -half);
  const d = corner(len, half);
  const e = corner(0, half);
  const f = corner(-STRIKER.flare, half + 18);
  ctx.moveTo(a.x, a.y);
  for (const p of [b, c, d, e, f]) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fillStyle = C.paper;
  ctx.fill();
  ctx.clip();
  for (let t = -STRIKER.flare; t < len; t += 17) {
    if (Math.round((t + STRIKER.flare) / 17) % 2) continue;
    const p0 = corner(t + 8.5, -half - 30);
    const p1 = corner(t + 8.5, half + 30);
    const q1 = corner(t + 17 + 8.5, half + 30);
    const q0 = corner(t + 17 + 8.5, -half - 30);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(q1.x, q1.y);
    ctx.lineTo(q0.x, q0.y);
    ctx.closePath();
    ctx.fillStyle = hexA(C.red, 0.9);
    ctx.fill();
  }
  // The striker's track: a cream strip up the middle that the lamps sit in.
  const s0 = corner(12, -11);
  const s1 = corner(len - 14, -11);
  const s2 = corner(len - 14, 11);
  const s3 = corner(12, 11);
  ctx.beginPath();
  ctx.moveTo(s0.x, s0.y);
  ctx.lineTo(s1.x, s1.y);
  ctx.lineTo(s2.x, s2.y);
  ctx.lineTo(s3.x, s3.y);
  ctx.closePath();
  ctx.fillStyle = C.paper;
  ctx.fill();
  ctx.strokeStyle = hexA(C.ink, 0.55);
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.restore();

  // The alcove between the lane and the shooter lane: a panel of night sky carrying the lane's name.
  ctx.save();
  const p0 = corner(-6, half + 4);
  const p1 = corner(len, half + 4);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(DIVIDER_X, p1.y);
  ctx.lineTo(DIVIDER_X, p0.y + 6);
  ctx.closePath();
  ctx.fillStyle = C.navy;
  ctx.fill();
  ctx.clip();
  const rnd = seeded(12);
  ctx.fillStyle = C.goldLight;
  for (let i = 0; i < 16; i++) {
    const q = corner(10 + rnd() * 200, half + 10 + rnd() * 40);
    starPath(ctx, q.x, q.y, 1.4 + rnd() * 2.4, 5, 0.45);
    ctx.fill();
  }
  const m = corner(112, half + 21);
  ctx.translate(m.x, m.y);
  ctx.rotate(Math.atan2(STRIKER.uy, STRIKER.ux));
  ctx.fillStyle = C.goldLight;
  ctx.font = `400 11px ${fonts.display}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STRENGTH TEST', 0, 0);
  ctx.restore();
}

function bell(ctx: Ctx): void {
  // The bell at the head of the strength test, mounted over the cap.
  const p = lanePoint(STRIKER.len - 4, 2);
  ctx.save();
  ctx.translate(p.x, p.y - 4);
  shadow(ctx, 3, 1.2, 2.6, 0.45);
  const g = ctx.createLinearGradient(-14, 0, 14, 0);
  g.addColorStop(0, C.goldDark);
  g.addColorStop(0.4, C.goldLight);
  g.addColorStop(0.7, C.gold);
  g.addColorStop(1, C.goldDark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-15, 8);
  ctx.bezierCurveTo(-13, 5, -10, 2, -9, -5);
  ctx.bezierCurveTo(-8, -12, -4, -14, 0, -14);
  ctx.bezierCurveTo(4, -14, 8, -12, 9, -5);
  ctx.bezierCurveTo(10, 2, 13, 5, 15, 8);
  ctx.closePath();
  ctx.fill();
  noShadow(ctx);
  ctx.strokeStyle = C.goldDark;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = C.goldDark;
  ctx.fillRect(-15, 7, 30, 2.2);
  ctx.beginPath();
  ctx.arc(0, -15.5, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function lowerField(ctx: Ctx, fonts: Fonts): void {
  ctx.save();
  // A sunburst behind the ticket lamps.
  const cx = 236;
  const cy = 800;
  ctx.beginPath();
  ctx.arc(cx, cy, 104, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#ead6a2';
  ctx.fillRect(cx - 110, cy - 110, 220, 220);
  ctx.fillStyle = '#f5e8c6';
  for (let i = 0; i < 36; i += 2) {
    const a0 = (i / 36) * Math.PI * 2;
    const a1 = ((i + 1) / 36) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 120, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = C.red;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 104, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 100, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = C.red;
  ctx.font = `400 10px ${fonts.display}`;
  arcText(ctx, 'TICKETS', cx, cy, 88, -Math.PI / 2, 0.8);
  ctx.fillStyle = C.navy;
  ctx.font = `600 7px ${fonts.text}`;
  arcText(ctx, '1,000 EACH WHEN THE BALL DRAINS', cx, cy, 92, Math.PI / 2, 0.3, true);
  ctx.restore();
}

function banner(ctx: Ctx, fonts: Fonts): void {
  const cx = 236;
  const cy = 612;
  const w = 150;
  ctx.save();
  shadow(ctx, 3, 1, 2.5, 0.3);
  // Tails folded behind the ribbon's ends.
  ctx.fillStyle = C.redDark;
  for (const d of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + d * (w / 2 - 6), cy - 4);
    ctx.lineTo(cx + d * (w / 2 + 22), cy - 4);
    ctx.lineTo(cx + d * (w / 2 + 12), cy + 9);
    ctx.lineTo(cx + d * (w / 2 + 22), cy + 22);
    ctx.lineTo(cx + d * (w / 2 - 6), cy + 22);
    ctx.closePath();
    ctx.fill();
  }
  // The ribbon, bowed slightly.
  ctx.fillStyle = C.red;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy - 13);
  ctx.quadraticCurveTo(cx, cy - 21, cx + w / 2, cy - 13);
  ctx.lineTo(cx + w / 2, cy + 13);
  ctx.quadraticCurveTo(cx, cy + 5, cx - w / 2, cy + 13);
  ctx.closePath();
  ctx.fill();
  noShadow(ctx);
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = C.paper;
  ctx.font = `400 13px ${fonts.display}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STEP RIGHT UP', cx, cy - 4);
  ctx.restore();
}

function apron(ctx: Ctx, fonts: Fonts): void {
  ctx.save();
  shadow(ctx, 5, 0, -2, 0.45);
  ctx.beginPath();
  ctx.moveTo(0, APRON_Y + 18);
  ctx.lineTo(44, APRON_Y + 18);
  ctx.quadraticCurveTo(70, APRON_Y - 4, 120, APRON_Y - 2);
  ctx.lineTo(352, APRON_Y - 2);
  ctx.quadraticCurveTo(402, APRON_Y - 4, 428, APRON_Y + 18);
  ctx.lineTo(W, APRON_Y + 18);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, APRON_Y - 4, 0, H);
  g.addColorStop(0, '#efe6d2');
  g.addColorStop(1, '#d9cdb3');
  ctx.fillStyle = g;
  ctx.fill();
  noShadow(ctx);
  ctx.strokeStyle = C.red;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // Card holders, left and right, and the machine's name between them.
  for (const x of [26, 360]) {
    ctx.fillStyle = C.paper;
    roundRect(ctx, x, APRON_Y + 24, 104, 30, 2);
    ctx.fill();
    ctx.strokeStyle = hexA(C.ink, 0.45);
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  ctx.fillStyle = C.ink;
  ctx.font = `600 6.6px ${fonts.text}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${BALLS_PER_GAME} BALLS PER GAME`, 78, APRON_Y + 34);
  ctx.fillText('MATCH FOR A FREE GAME', 78, APRON_Y + 44);
  ctx.fillText('FREE GAME AT', 412, APRON_Y + 34);
  ctx.fillText(REPLAYS.map((n) => n.toLocaleString('en-US')).join(' · '), 412, APRON_Y + 44);
  ctx.fillStyle = C.red;
  ctx.font = `400 15px ${fonts.display}`;
  ctx.fillText('Ring the Bell', 236, APRON_Y + 40);
  ctx.restore();
}

function shooterLane(ctx: Ctx): void {
  ctx.save();
  ctx.fillStyle = '#e7d5ac';
  ctx.fillRect(DIVIDER_X, DIVIDER_TOP - 10, RIGHT_WALL_X - DIVIDER_X, APRON_Y - DIVIDER_TOP + 10);
  // Red pinstripes down the lane, and three chevrons pointing the way up.
  ctx.fillStyle = hexA(C.red, 0.8);
  ctx.fillRect(DIVIDER_X + 6, DIVIDER_TOP, 1.4, APRON_Y - DIVIDER_TOP);
  ctx.fillRect(RIGHT_WALL_X - 7.4, DIVIDER_TOP, 1.4, APRON_Y - DIVIDER_TOP);
  ctx.strokeStyle = hexA(C.red, 0.85);
  ctx.lineWidth = 3;
  ctx.lineJoin = 'miter';
  for (const y of [880, 905, 930]) {
    ctx.beginPath();
    ctx.moveTo(480, y + 8);
    ctx.lineTo(490, y);
    ctx.lineTo(500, y + 8);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- Hardware -------------------------------------------------------------

function chromeLine(ctx: Ctx, pts: [number, number][], width: number, closed = false): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    if (closed) ctx.closePath();
  };
  shadow(ctx, 2.5, 1, 2.5, 0.42);
  path();
  ctx.strokeStyle = C.chromeDark;
  ctx.lineWidth = width;
  ctx.stroke();
  noShadow(ctx);
  path();
  ctx.strokeStyle = C.chrome;
  ctx.lineWidth = width * 0.62;
  ctx.stroke();
  path();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = width * 0.18;
  ctx.stroke();
  ctx.restore();
}

function rubberPost(ctx: Ctx, x: number, y: number, r: number, cap: string): void {
  ctx.save();
  shadow(ctx, 2, 1, 2.2, 0.45);
  ctx.fillStyle = C.rubber;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  noShadow(ctx);
  ctx.strokeStyle = 'rgba(40, 30, 20, 0.5)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.beginPath();
  ctx.arc(x - r * 0.18, y - r * 0.2, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function laneGuide(ctx: Ctx, x: number): void {
  ctx.save();
  shadow(ctx, 2, 1, 2.4, 0.4);
  capsulePath(ctx, x, LANE_TOP, x, LANE_BOTTOM, 4);
  const g = ctx.createLinearGradient(x - 4, 0, x + 4, 0);
  g.addColorStop(0, C.chromeDark);
  g.addColorStop(0.45, '#f4f5f7');
  g.addColorStop(1, C.chromeDark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  rubberPost(ctx, x, LANE_TOP, 5, C.red);
}

function rolloverButton(ctx: Ctx, x: number, y: number): void {
  ctx.save();
  ctx.fillStyle = hexA(C.ink, 0.55);
  ctx.beginPath();
  ctx.ellipse(x, y, 5, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createLinearGradient(x - 4, y, x + 4, y);
  g.addColorStop(0, C.chromeDark);
  g.addColorStop(0.5, '#f2f3f5');
  g.addColorStop(1, C.chromeDark);
  ctx.strokeStyle = g;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x, y + 6);
  ctx.stroke();
  ctx.restore();
}

function slingshot(ctx: Ctx, s: typeof SLING_L, side: 'L' | 'R'): void {
  ctx.save();
  // The rubber band stretched between the three corner posts.
  ctx.strokeStyle = C.rubber;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  shadow(ctx, 2, 1, 2.2, 0.4);
  ctx.beginPath();
  ctx.moveTo(s.a.x, s.a.y);
  ctx.lineTo(s.b.x, s.b.y);
  ctx.lineTo(s.c.x, s.c.y);
  ctx.closePath();
  ctx.stroke();
  noShadow(ctx);
  // The plastic over it: red with a gold star and a keyline, inset from the band.
  const inset = 7;
  const cx = (s.a.x + s.b.x + s.c.x) / 3;
  const cy = (s.a.y + s.b.y + s.c.y) / 3;
  const shrink = (p: { x: number; y: number }) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy);
    return { x: cx + (dx / d) * (d - inset), y: cy + (dy / d) * (d - inset) };
  };
  const pa = shrink(s.a);
  const pb = shrink(s.b);
  const pc = shrink(s.c);
  shadow(ctx, 4, 2, 4, 0.4);
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.lineTo(pc.x, pc.y);
  ctx.closePath();
  ctx.fillStyle = hexA(C.red, 0.93);
  ctx.fill();
  noShadow(ctx);
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = C.goldLight;
  starPath(ctx, cx + (side === 'L' ? -3 : 3), cy + 2, 9, 5, 0.45);
  ctx.fill();
  ctx.strokeStyle = C.goldDark;
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.restore();
  for (const p of [s.a, s.b, s.c]) rubberPost(ctx, p.x, p.y, 6, C.gold);
}

function bumperBase(ctx: Ctx, x: number, y: number): void {
  // The skirt's shadow and the metal ring on the playfield; the lit cap is drawn live.
  ctx.save();
  ctx.fillStyle = 'rgba(20, 12, 8, 0.35)';
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 5, 33, 32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function saucerHole(ctx: Ctx): void {
  const { x, y } = SAUCER;
  ctx.save();
  const g = ctx.createRadialGradient(x, y - 3, 2, x, y, 15);
  g.addColorStop(0, '#000');
  g.addColorStop(0.75, '#16161c');
  g.addColorStop(1, '#3a3a44');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 15.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.chrome;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.arc(x, y, 15.5, Math.PI * 1.05, Math.PI * 1.6);
  ctx.stroke();
  ctx.restore();
}

function wireGate(ctx: Ctx, ax: number, ay: number, bx: number, by: number): void {
  ctx.save();
  ctx.strokeStyle = C.chromeDark;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.strokeStyle = '#eef0f2';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.fillStyle = C.chromeDark;
  for (const [x, y] of [
    [ax, ay],
    [bx, by],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Draw the whole static layer: paint, inserts in their unlit state, rails, posts, and plastics. */
export function drawPlayfield(ctx: Ctx, fonts: Fonts, inserts: Record<string, Insert>): void {
  ground(ctx);
  canopy(ctx);
  sky(ctx);
  valance(ctx);
  gallery(ctx, fonts);
  ferrisWheel(ctx, fonts);
  fortune(ctx, fonts);
  lowerField(ctx, fonts);
  strengthTest(ctx, fonts);
  shooterLane(ctx);
  banner(ctx, fonts);

  // The left loop's floor, a strip of night down the left wall.
  ctx.save();
  ctx.fillStyle = hexA(C.navyDeep, 0.92);
  ctx.fillRect(LEFT_WALL_X + 4, SKY_BOTTOM, ORBIT_X - LEFT_WALL_X - 8, ORBIT_BOTTOM - SKY_BOTTOM);
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(30, SKY_BOTTOM + 6);
  ctx.lineTo(30, ORBIT_BOTTOM - 4);
  ctx.stroke();
  ctx.restore();

  // Inserts, unlit.
  ctx.save();
  for (const [id, ins] of Object.entries(inserts)) {
    ctx.font = id.startsWith('ticket') ? `700 9px ${fonts.text}` : `600 6px ${fonts.text}`;
    drawInsertOff(ctx, ins);
  }
  ctx.font = `700 6.5px ${fonts.text}`;
  ctx.fillStyle = C.paper;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SHOOT', LAMPS.again.x, LAMPS.again.y - 4);
  ctx.fillText('AGAIN', LAMPS.again.x, LAMPS.again.y + 4.5);
  ctx.restore();

  // Rollover buttons.
  for (const p of Object.values(ROLLOVERS)) rolloverButton(ctx, p.x, p.y);

  // Fixed hardware.
  saucerHole(ctx);
  for (const b of BUMPERS) bumperBase(ctx, b.x, b.y);
  chromeLine(
    ctx,
    [
      [LEFT_WALL_X, 1030],
      [LEFT_WALL_X, ARCH.cy],
    ],
    8,
  );
  const archPts: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = Math.PI + (i / 48) * Math.PI;
    archPts.push([ARCH.cx + Math.cos(a) * ARCH.r, ARCH.cy + Math.sin(a) * ARCH.r]);
  }
  chromeLine(ctx, archPts, 8);
  chromeLine(
    ctx,
    [
      [DIVIDER_X, 1030],
      [DIVIDER_X, DIVIDER_TOP],
    ],
    8,
  );
  chromeLine(
    ctx,
    [
      [ORBIT_X, ORBIT_BOTTOM],
      [ORBIT_X, ORBIT_TOP],
    ],
    8,
  );
  for (const side of [-1, 1]) {
    const m = lanePoint(-STRIKER.flare, side * (STRIKER.half + 18));
    const f = lanePoint(0, side * STRIKER.half);
    const h = lanePoint(STRIKER.len, side * STRIKER.half);
    const pts: [number, number][] = [
      [m.x, m.y],
      [f.x, f.y],
      [h.x, h.y],
    ];
    if (side === 1) pts.push([STRIKER.capRight.x, STRIKER.capRight.y]);
    chromeLine(ctx, pts, 8);
  }
  // The gallery's back rail, the separators, and the inlane guides.
  chromeLine(
    ctx,
    [
      [GALLERY.left, GALLERY.back],
      [GALLERY.right, GALLERY.back],
    ],
    10,
  );
  for (const x of [49, 423]) {
    chromeLine(
      ctx,
      [
        [x, 1030],
        [x, SEPARATOR_TOP],
      ],
      6,
    );
  }
  chromeLine(
    ctx,
    [
      [INLANE_GUIDE.ax, INLANE_GUIDE.ay],
      [INLANE_GUIDE.bx, INLANE_GUIDE.by],
    ],
    6,
  );
  chromeLine(
    ctx,
    [
      [472 - INLANE_GUIDE.ax, INLANE_GUIDE.ay],
      [472 - INLANE_GUIDE.bx, INLANE_GUIDE.by],
    ],
    6,
  );
  wireGate(ctx, 468, 234, 511, 210);
  wireGate(ctx, LEFT_WALL_X, 284, ORBIT_X, ORBIT_TOP);

  // The spinner's bracket across the left loop.
  ctx.save();
  ctx.strokeStyle = C.chromeDark;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(10, SPINNER_Y);
  ctx.lineTo(50, SPINNER_Y);
  ctx.stroke();
  ctx.restore();

  bell(ctx);
  for (const x of LANE_GUIDES) laneGuide(ctx, x);
  for (const p of [
    { x: GALLERY.left, y: DUCK_Y - 2 },
    { x: GALLERY.right, y: DUCK_Y - 2 },
  ])
    rubberPost(ctx, p.x, p.y, 6, C.red);
  rubberPost(ctx, 49, SEPARATOR_TOP, 6, C.red);
  rubberPost(ctx, 423, SEPARATOR_TOP, 6, C.red);
  slingshot(ctx, SLING_L, 'L');
  slingshot(ctx, SLING_R, 'R');
  apron(ctx, fonts);
}

/** The glass: a faint reflection of the room laid over everything. */
export function drawGlass(ctx: Ctx): void {
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.07)');
  g.addColorStop(0.35, 'rgba(255, 255, 255, 0)');
  g.addColorStop(0.62, 'rgba(255, 255, 255, 0)');
  g.addColorStop(0.7, 'rgba(255, 255, 255, 0.045)');
  g.addColorStop(0.78, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.3, W / 2, H * 0.5, H * 0.75);
  v.addColorStop(0, 'rgba(0, 0, 0, 0)');
  v.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
