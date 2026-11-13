// Titivillus as a woodcut imp: a black figure with horns, bat's wings, a
// forked tail, and his sack over one shoulder. Drawn in a 26-unit-tall frame
// with the feet at the origin, posed from a few numbers each frame.

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
}

export const DEVIL_UNITS = 26;

const INK = '#16110d';
const PAPER = '#f1e7d0';

function limb(ctx: CanvasRenderingContext2D, x: number, y: number, a1: number, l1: number, a2: number, l2: number) {
  const kx = x + Math.sin(a1) * l1;
  const ky = y + Math.cos(a1) * l1;
  const fx = kx + Math.sin(a2) * l2;
  const fy = ky + Math.cos(a2) * l2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(kx, ky);
  ctx.lineTo(fx, fy);
  ctx.stroke();
  return [fx, fy] as const;
}

/** Where the sack's mouth sits, in screen pixels relative to the feet. */
export function sackPoint(s: DevilState, scale: number): [number, number] {
  return [-4.2 * scale * s.facing, -18.5 * scale];
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
  const breathe = Math.sin(s.t * 2.4) * 0.35;
  const bob = running ? -Math.abs(Math.sin(s.phase)) * 1.1 : air ? 0 : breathe * 0.4;
  const crouch = pluck * 2.6 + (cheer ? Math.max(0, Math.sin(s.t * 9)) * -1.4 : 0);
  const lean = running ? 0.22 : air ? 0.08 : pluck * 0.95;

  const hipX = 0;
  const hipY = -9.2 + bob + crouch;

  // Tail, behind everything: an S from the rump to a barbed tip.
  const sway = Math.sin(s.t * 3.1) * 1.2 + (running ? Math.sin(s.phase) * 1.5 : 0) + (air ? -s.vy * 0.004 : 0);
  ctx.lineWidth = 1.05;
  ctx.beginPath();
  ctx.moveTo(hipX - 2.1, hipY - 0.6);
  ctx.bezierCurveTo(hipX - 6.5, hipY + 1.5, hipX - 5.2 + sway, hipY - 6.5, hipX - 9 + sway, hipY - 7.4);
  ctx.stroke();
  ctx.save();
  ctx.translate(hipX - 9 + sway, hipY - 7.4);
  ctx.rotate(-2.4 + sway * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, -1.9);
  ctx.lineTo(2.2, 0.4);
  ctx.lineTo(0.2, 0.1);
  ctx.lineTo(-1.6, 1.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Legs: thigh and shin, a hoof at the end.
  const legs = (side: number) => {
    let a1: number;
    let a2: number;
    if (running) {
      const p = s.phase + (side > 0 ? 0 : Math.PI);
      a1 = Math.sin(p) * 0.85;
      a2 = a1 - Math.max(0, Math.cos(p)) * 1.25 - 0.15;
    } else if (air) {
      const tuck = s.vy < 0 ? 1 : 0.55;
      a1 = (side > 0 ? 0.75 : 0.25) * tuck;
      a2 = a1 - 1.35 * tuck;
    } else if (cheer) {
      const kick = Math.max(0, Math.sin(s.t * 9 + (side > 0 ? 0 : Math.PI)));
      a1 = (side > 0 ? 0.25 : -0.15) + kick * 0.5;
      a2 = a1 - kick * 0.9;
    } else {
      a1 = side > 0 ? 0.16 + pluck * 0.75 : -0.14 + pluck * 0.35;
      a2 = a1 - pluck * 1.55;
    }
    ctx.lineWidth = 1.55;
    const [fx, fy] = limb(ctx, hipX + side * 0.5, hipY, a1, 4.7, a2, 4.9);
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.moveTo(fx - 0.4, fy);
    ctx.lineTo(fx + 1.3, fy + 0.1);
    ctx.stroke();
  };
  legs(-1);

  // Torso, leaning into the run or bowed over a pluck.
  ctx.save();
  ctx.translate(hipX, hipY);
  ctx.rotate(lean);
  // Wings from the shoulder blades: folded on the ground, spread in the air.
  const flap = air ? (s.vy < 0 ? 0.9 : 0.4 + Math.sin(s.t * 22) * 0.35) : cheer ? 0.7 : 0.08 + breathe * 0.04;
  ctx.save();
  ctx.translate(-1.4, -7.4);
  ctx.rotate(-0.5 - flap * 1.1);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-1.2, -6.6);
  ctx.quadraticCurveTo(-2.4, -4.6, -3.9, -4.9);
  ctx.quadraticCurveTo(-4.0, -2.8, -5.6, -2.4);
  ctx.quadraticCurveTo(-4.4, -0.8, -4.8, 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Body: a pot belly with a hunched back.
  ctx.beginPath();
  ctx.moveTo(-2.3, 0.4);
  ctx.bezierCurveTo(-3.6, -2.6, -3.2, -6.6, -1.4, -8.6);
  ctx.bezierCurveTo(0.2, -9.8, 2.2, -9.0, 2.6, -7.2);
  ctx.bezierCurveTo(3.6, -4.6, 3.6, -1.6, 2.2, 0.4);
  ctx.closePath();
  ctx.fill();
  // A cut down the belly, the way a woodcutter would mark a rib.
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  ctx.moveTo(1.6, -6.2);
  ctx.quadraticCurveTo(2.5, -3.6, 1.4, -1.0);
  ctx.stroke();
  ctx.strokeStyle = INK;

  // Head, horns, ears.
  const headTilt = pluck * 0.5 + (cheer ? -0.25 : 0);
  ctx.save();
  ctx.translate(0.9, -10.6);
  ctx.rotate(headTilt);
  ctx.beginPath();
  ctx.ellipse(0.6, -1.4, 3.0, 2.7, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pointed snout and chin.
  ctx.beginPath();
  ctx.moveTo(2.8, -2.4);
  ctx.lineTo(5.0, -1.1);
  ctx.lineTo(2.9, -0.1);
  ctx.lineTo(3.6, 1.6);
  ctx.lineTo(1.0, 0.9);
  ctx.closePath();
  ctx.fill();
  // Horns curving back.
  for (const [hx, lift] of [
    [1.6, 0],
    [-0.4, 0.5],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(hx - 0.8, -3.6);
    ctx.quadraticCurveTo(hx - 0.6, -6.2 + lift, hx - 2.6, -7.4 + lift);
    ctx.quadraticCurveTo(hx - 0.8, -5.6 + lift, hx + 0.6, -3.7);
    ctx.closePath();
    ctx.fill();
  }
  // Ear, swept back.
  ctx.beginPath();
  ctx.moveTo(-1.6, -2.4);
  ctx.lineTo(-4.4, -3.4);
  ctx.lineTo(-1.8, -0.8);
  ctx.closePath();
  ctx.fill();
  // Eye and grin, cut white.
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.ellipse(2.3, -2.0, 0.75, 0.6, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(2.6, -2.0, 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(1.9, 0.0);
  ctx.quadraticCurveTo(3.0, 0.5, 3.8, -0.5);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.restore();

  // Far arm: swings with the run, reaches down to pluck, or punches the air.
  ctx.lineWidth = 1.3;
  let aa1: number;
  let aa2: number;
  if (s.pose === 'pluck') {
    aa1 = -0.2 + pluck * 0.15;
    aa2 = aa1 + 0.1;
  } else if (cheer) {
    aa1 = Math.PI - 0.5 + Math.sin(s.t * 9) * 0.3;
    aa2 = aa1 + 0.2;
  } else if (running) {
    aa1 = -Math.sin(s.phase) * 0.9;
    aa2 = aa1 - 0.9;
  } else if (air) {
    aa1 = 2.1;
    aa2 = 2.6;
  } else {
    aa1 = 0.25 + breathe * 0.05;
    aa2 = -0.25;
  }
  const [hx2, hy2] = limb(ctx, 1.4, -7.6, aa1, 3.8, aa2, 3.6);
  ctx.beginPath();
  ctx.arc(hx2, hy2, 0.75, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  legs(1);

  // The sack over the near shoulder, held by its neck.
  const swell = 0.62 + s.sack * 0.55 + s.gulp * 0.22;
  const stir = s.stir * Math.sin(s.t * 31) * 0.22 + s.stir * Math.sin(s.t * 17) * 0.12;
  const sx = hipX - 4.6 - lean * 3;
  const sy = hipY - 8.4 - pluck * 1.4;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-0.35 + stir + (running ? Math.sin(s.phase * 2) * 0.06 : 0));
  ctx.scale(swell, swell);
  ctx.beginPath();
  ctx.moveTo(1.6, -3.6);
  ctx.bezierCurveTo(4.6, -3.2, 5.4, 1.6, 3.4, 3.7);
  ctx.bezierCurveTo(1.2, 5.6, -3.8, 5.2, -4.8, 2.4);
  ctx.bezierCurveTo(-5.6, -0.4, -3.2, -3.2, -0.6, -3.4);
  ctx.closePath();
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.stroke();
  // Hatching on the shadow side of the bag.
  ctx.lineWidth = 0.42;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const hx = -3.6 + i * 1.35;
    ctx.moveTo(hx, 4.2 - i * 0.2);
    ctx.lineTo(hx - 0.9, 1.4 - i * 0.1);
  }
  ctx.stroke();
  // The tied neck.
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-0.2, -3.6);
  ctx.lineTo(0.6, -5.4);
  ctx.lineTo(1.6, -3.7);
  ctx.stroke();
  ctx.restore();

  // Near arm, up over the shoulder to the sack's neck.
  ctx.lineWidth = 1.3;
  const shoulderX = hipX + 1.2 + lean * 7.5;
  const shoulderY = hipY - 7.6 + lean * 1.2;
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.quadraticCurveTo(shoulderX + 0.4, shoulderY - 3.4, sx + 1.4, sy - 4.8 * swell);
  ctx.stroke();

  ctx.restore();
}
