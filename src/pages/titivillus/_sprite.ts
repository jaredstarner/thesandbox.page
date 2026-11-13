// Titivillus as a woodcut imp: a black figure with a big horned head, goat's
// legs, bat's wings, a barbed tail, and his sack over one shoulder. Drawn in a
// 26-unit-tall frame with the hooves at the origin, posed from a few numbers
// each frame. Small on the page, so the silhouette does the work: head and
// horns, the white sack, the hocked legs.

export type Pose = 'idle' | 'run' | 'jump' | 'fall' | 'pluck' | 'cheer';

export interface DevilState {
  pose: Pose;
  facing: 1 | -1;
  /** Run cycle phase in radians. */
  phase: number;
  /** Seconds since the page started, for idle motion. */
  t: number;
  /** 0 to 1 through a pluck. */
  pluck: number;
  /** Squash after a landing, 0 to 1. */
  squash: number;
  /** How full the sack is, 0 to 1. */
  sack: number;
  /** How hard the sack is stirring near a fault, 0 to 1. */
  stir: number;
  /** A quick swell of the sack as a fault goes in, 0 to 1. */
  gulp: number;
  /** Vertical speed, for the jump and fall shapes. */
  vy: number;
  /** A wing beat in the air, 1 falling to 0. */
  flap: number;
}

export const DEVIL_UNITS = 26;

const INK = '#15100c';
const PAPER = '#f1e7d0';

/** Where the sack's mouth sits, in screen pixels relative to the hooves. */
export function sackPoint(s: DevilState, scale: number): [number, number] {
  return [-4.6 * scale * s.facing, -19 * scale];
}

/** A goat's leg: thigh forward to the knee, shin back to the hock, cannon down to the hoof. */
function goatLeg(ctx: CanvasRenderingContext2D, hx: number, hy: number, swing: number, fold: number): void {
  const a1 = 0.35 + swing;
  const kx = hx + Math.sin(a1) * 3.4;
  const ky = hy + Math.cos(a1) * 3.4;
  const a2 = a1 - 1.25 - fold;
  const jx = kx + Math.sin(a2) * 3.0;
  const jy = ky + Math.cos(a2) * 3.0;
  const a3 = a2 + 1.0 + fold * 0.6;
  const fx = jx + Math.sin(a3) * 2.6;
  const fy = jy + Math.cos(a3) * 2.6;
  ctx.lineWidth = 2.3;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(kx, ky);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(kx, ky);
  ctx.lineTo(jx, jy);
  ctx.lineTo(fx, fy);
  ctx.stroke();
  // Cloven hoof.
  ctx.beginPath();
  ctx.moveTo(fx - 0.9, fy - 0.5);
  ctx.lineTo(fx + 1.4, fy - 0.3);
  ctx.lineTo(fx + 1.2, fy + 0.5);
  ctx.lineTo(fx - 1.0, fy + 0.5);
  ctx.closePath();
  ctx.fill();
}

export function drawDevil(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, s: DevilState): void {
  ctx.save();
  ctx.translate(x, y);
  const sq = s.squash;
  ctx.scale(scale * s.facing * (1 + sq * 0.16), scale * (1 - sq * 0.18));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;

  const running = s.pose === 'run';
  const air = s.pose === 'jump' || s.pose === 'fall';
  const pluck = s.pose === 'pluck' ? Math.sin(Math.min(1, s.pluck) * Math.PI) : 0;
  const cheer = s.pose === 'cheer';
  const hop = cheer ? Math.max(0, Math.sin(s.t * 9)) : 0;
  const breathe = Math.sin(s.t * 2.4);
  const bob = running ? -Math.abs(Math.sin(s.phase)) * 1.0 : air ? 0 : breathe * 0.18;
  const crouch = pluck * 2.4 - hop * 1.6;
  const lean = running ? 0.2 : air ? 0.06 : pluck * 0.8;

  const hipY = -8.4 + bob + crouch;

  // Tail, behind everything.
  const sway = Math.sin(s.t * 3.1) * 1.1 + (running ? Math.sin(s.phase) * 1.4 : 0) + (air ? -s.vy * 0.004 : 0);
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(-2.6, hipY - 0.4);
  ctx.bezierCurveTo(-7, hipY + 2, -6 + sway, hipY - 6.5, -9.6 + sway, hipY - 7.6);
  ctx.stroke();
  ctx.save();
  ctx.translate(-9.6 + sway, hipY - 7.6);
  ctx.rotate(-2.3 + sway * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, -2.2);
  ctx.lineTo(2.5, 0.5);
  ctx.lineTo(0.3, 0.1);
  ctx.lineTo(-1.8, 1.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Legs.
  const legPose = (side: number): [number, number] => {
    if (running) {
      const p = s.phase + (side > 0 ? 0 : Math.PI);
      return [Math.sin(p) * 0.8, Math.max(0, Math.cos(p)) * 0.7];
    }
    if (air) return s.vy < 0 ? [side > 0 ? 0.7 : 0.35, 0.8] : [side > 0 ? 0.35 : 0.1, 0.35];
    if (cheer) return [side > 0 ? 0.25 + hop * 0.4 : -0.2, hop * 0.6];
    return [side > 0 ? 0.08 + pluck * 0.6 : -0.12 + pluck * 0.25, pluck * 0.9];
  };
  {
    const [sw, fo] = legPose(-1);
    goatLeg(ctx, -0.6, hipY, sw, fo);
  }

  ctx.save();
  ctx.translate(0, hipY);
  ctx.rotate(lean);

  // Wings from the shoulder blades: folded on the ground, spread in the air.
  const beat = s.flap > 0 ? Math.sin((1 - s.flap) * Math.PI * 2) * 0.9 : 0;
  const open = (air ? (s.vy < 0 ? 0.95 : 0.45 + Math.sin(s.t * 22) * 0.35) : cheer ? 0.8 : 0.1 + breathe * 0.03) + beat;
  ctx.save();
  ctx.translate(-1.8, -8.2);
  ctx.rotate(-0.25 - open * 1.0);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-1.0, -7.4);
  ctx.quadraticCurveTo(-2.6, -5.2, -4.6, -5.6);
  ctx.quadraticCurveTo(-4.7, -3.2, -6.6, -2.8);
  ctx.quadraticCurveTo(-5.2, -1.0, -5.8, 0.8);
  ctx.closePath();
  ctx.fill();
  // Wing bones, cut white.
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  ctx.moveTo(-0.5, -1);
  ctx.lineTo(-4.3, -5.0);
  ctx.moveTo(-0.5, -1);
  ctx.lineTo(-6.0, -2.6);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.restore();

  // Pot belly and hunched back.
  ctx.beginPath();
  ctx.moveTo(-2.6, 0.6);
  ctx.bezierCurveTo(-4.4, -2.4, -3.8, -7.6, -1.4, -9.4);
  ctx.bezierCurveTo(0.6, -10.6, 2.8, -9.6, 3.2, -7.4);
  ctx.bezierCurveTo(4.6, -4.6, 4.2, -1.0, 2.4, 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(2.0, -6.6);
  ctx.quadraticCurveTo(3.1, -3.8, 1.8, -1.0);
  ctx.moveTo(0.9, -5.6);
  ctx.quadraticCurveTo(1.6, -3.6, 0.8, -1.8);
  ctx.stroke();
  ctx.strokeStyle = INK;

  // Head: big, with horns, a swept ear, a beak of a nose, and a goatee.
  const tilt = pluck * 0.55 - hop * 0.2;
  ctx.save();
  ctx.translate(1.2, -11.6);
  ctx.rotate(tilt);
  ctx.beginPath();
  ctx.ellipse(0.4, -2.0, 3.7, 3.4, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(3.2, -3.0);
  ctx.lineTo(6.0, -1.4);
  ctx.lineTo(3.6, -0.6);
  ctx.closePath();
  ctx.fill();
  // Goatee.
  ctx.beginPath();
  ctx.moveTo(1.4, 0.6);
  ctx.lineTo(3.6, 0.2);
  ctx.lineTo(2.2, 3.0);
  ctx.closePath();
  ctx.fill();
  // Horns, long and swept back.
  ctx.beginPath();
  ctx.moveTo(0.6, -4.9);
  ctx.quadraticCurveTo(1.4, -8.6, -1.6, -10.4);
  ctx.quadraticCurveTo(0.0, -7.8, -1.4, -5.0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(2.6, -4.4);
  ctx.quadraticCurveTo(4.2, -7.6, 2.6, -9.8);
  ctx.quadraticCurveTo(2.9, -7.2, 1.0, -4.9);
  ctx.closePath();
  ctx.fill();
  // Ear.
  ctx.beginPath();
  ctx.moveTo(-2.6, -2.8);
  ctx.lineTo(-6.0, -4.2);
  ctx.lineTo(-2.8, -0.8);
  ctx.closePath();
  ctx.fill();
  // Eye and grin, cut white.
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.ellipse(2.0, -2.6, 1.05, 0.85, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(2.45, -2.55, 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(1.0, -0.4);
  ctx.quadraticCurveTo(2.4, 0.4, 3.9, -0.8);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.restore();

  // Far arm: swings with the run, reaches down to pluck, or waves in the air.
  let a1: number;
  let a2: number;
  if (s.pose === 'pluck') {
    a1 = -0.1 + pluck * 0.2;
    a2 = a1 + 0.2;
  } else if (cheer) {
    a1 = Math.PI - 0.4 + Math.sin(s.t * 9) * 0.35;
    a2 = a1 + 0.3;
  } else if (running) {
    a1 = -Math.sin(s.phase) * 0.9;
    a2 = a1 - 0.9;
  } else if (air) {
    a1 = 2.2;
    a2 = 2.7;
  } else {
    a1 = 0.3;
    a2 = -0.3;
  }
  const ax = 1.8;
  const ay = -8.0;
  const ex = ax + Math.sin(a1) * 3.4;
  const ey = ay + Math.cos(a1) * 3.4;
  const hx = ex + Math.sin(a2) * 3.2;
  const hy = ey + Math.cos(a2) * 3.2;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ex, ey);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  // A clawed hand.
  ctx.beginPath();
  ctx.arc(hx, hy, 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + Math.sin(a2 + 0.5) * 1.8, hy + Math.cos(a2 + 0.5) * 1.8);
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + Math.sin(a2 - 0.5) * 1.8, hy + Math.cos(a2 - 0.5) * 1.8);
  ctx.stroke();
  ctx.restore();

  {
    const [sw, fo] = legPose(1);
    goatLeg(ctx, 0.8, hipY, sw, fo);
  }

  // The sack over the shoulder, held by its neck: bigger as it fills.
  const swell = 0.8 + s.sack * 0.55 + s.gulp * 0.25;
  const stir = s.stir * (Math.sin(s.t * 31) * 0.22 + Math.sin(s.t * 17) * 0.12);
  const sx = -5.0 - lean * 3.5;
  const sy = hipY - 8.4 - pluck * 1.2;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-0.35 + stir + (running ? Math.sin(s.phase * 2) * 0.06 : 0));
  ctx.scale(swell, swell);
  ctx.beginPath();
  ctx.moveTo(1.6, -3.8);
  ctx.bezierCurveTo(5.0, -3.4, 5.8, 1.8, 3.6, 4.0);
  ctx.bezierCurveTo(1.3, 6.0, -4.0, 5.6, -5.1, 2.6);
  ctx.bezierCurveTo(-6.0, -0.4, -3.4, -3.4, -0.6, -3.6);
  ctx.closePath();
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = 1.05;
  ctx.stroke();
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const lx = -4.0 + i * 1.3;
    ctx.moveTo(lx, 4.4 - i * 0.25);
    ctx.lineTo(lx - 1.0, 1.4 - i * 0.1);
  }
  ctx.stroke();
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(-0.3, -3.8);
  ctx.lineTo(0.6, -5.8);
  ctx.lineTo(1.7, -3.9);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = INK;

  // Near arm, up over the shoulder to the sack's neck.
  ctx.lineWidth = 1.5;
  const shx = 1.0 + lean * 7.5;
  const shy = hipY - 7.8 + lean * 1.0;
  ctx.beginPath();
  ctx.moveTo(shx, shy);
  ctx.quadraticCurveTo(shx + 0.6, shy - 3.8, sx + 1.2, sy - 5.2 * swell);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(sx + 1.2, sy - 5.2 * swell, 0.95, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
