// A worker honeybee seen from above, drawn once per pose into small canvases and stamped
// many times a frame. Units are millimetres, head toward +x, thorax at the origin.

export const BEE_LENGTH = 13;
const PHASES = 4;

export interface BeeSprites {
  /** [phase] with wings folded over the abdomen. */
  folded: HTMLCanvasElement[];
  /** [phase] with wings raised and buzzing, as in the waggle run. */
  buzzing: HTMLCanvasElement[];
  /** Pixels per millimetre the sprites were drawn at (device pixels). */
  scale: number;
  /** Sprite centre offset, in millimetres. */
  half: [number, number];
}

export function makeBeeSprites(pxPerMm: number): BeeSprites {
  const half: [number, number] = [11, 8];
  const make = (phase: number, buzz: boolean) => {
    const c = document.createElement('canvas');
    c.width = Math.ceil(half[0] * 2 * pxPerMm);
    c.height = Math.ceil(half[1] * 2 * pxPerMm);
    const g = c.getContext('2d')!;
    g.setTransform(pxPerMm, 0, 0, pxPerMm, half[0] * pxPerMm, half[1] * pxPerMm);
    drawBee(g, phase / PHASES, buzz, pxPerMm);
    return c;
  };
  const folded: HTMLCanvasElement[] = [];
  const buzzing: HTMLCanvasElement[] = [];
  for (let p = 0; p < PHASES; p++) {
    folded.push(make(p, false));
    buzzing.push(make(p, true));
  }
  return { folded, buzzing, scale: pxPerMm, half };
}

export const PHASE_COUNT = PHASES;

function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

function drawBee(g: CanvasRenderingContext2D, phase: number, buzz: boolean, pxPerMm: number): void {
  const hair = Math.max(0.12, 0.7 / pxPerMm);

  // Soft shadow on the comb.
  for (let i = 4; i >= 1; i--) {
    g.fillStyle = `rgba(10, 4, 0, ${0.07})`;
    ellipse(g, -1.4 + 0.5, 0.9, 6.2 + i * 0.45, 2.4 + i * 0.35);
    g.fill();
  }

  // Legs: three pairs, alternating tripods.
  const swing = Math.sin(phase * Math.PI * 2);
  const legs: [number, number, number, number][] = [
    // base x, knee dx, foot dx, tripod
    [2.5, 1.6, 2.6, 0],
    [1.5, 0.1, -0.4, 1],
    [0.4, -2.2, -4.2, 0],
  ];
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const side of [-1, 1]) {
    legs.forEach(([bx, kdx, fdx, tripod], i) => {
      const t = (tripod === 0) === (side > 0) ? swing : -swing;
      const off = t * (i === 1 ? 0.9 : 0.7);
      const kx = bx + kdx + off * 0.5;
      const ky = side * (i === 2 ? 3.1 : 2.9);
      const fx = bx + fdx + off;
      const fy = side * (i === 2 ? 4.6 : 4.3);
      g.strokeStyle = '#2a1708';
      g.lineWidth = i === 2 ? 0.62 : 0.48;
      g.beginPath();
      g.moveTo(bx, side * 1.1);
      g.lineTo(kx, ky);
      g.lineTo(fx, fy);
      g.stroke();
      g.strokeStyle = 'rgba(190, 140, 70, 0.35)';
      g.lineWidth = 0.18;
      g.stroke();
    });
  }

  // Abdomen: amber with dark bands and pale hair at the band edges.
  const ab = g.createLinearGradient(0, -2.6, 0, 2.6);
  ab.addColorStop(0, '#c9791d');
  ab.addColorStop(0.45, '#eba13a');
  ab.addColorStop(1, '#94520f');
  ellipse(g, -3.4, 0, 4.4, 2.55);
  g.fillStyle = ab;
  g.fill();
  g.save();
  ellipse(g, -3.4, 0, 4.4, 2.55);
  g.clip();
  for (const [x, w] of [
    [-1.6, 0.8],
    [-3.3, 0.95],
    [-5.0, 1.0],
    [-6.7, 2.0],
  ] as const) {
    g.fillStyle = '#3a2210';
    g.beginPath();
    g.moveTo(x + 0.35, -3);
    g.quadraticCurveTo(x - 0.5, 0, x + 0.35, 3);
    g.lineTo(x + 0.35 - w, 3);
    g.quadraticCurveTo(x - 0.5 - w, 0, x + 0.35 - w, -3);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(240, 205, 140, 0.55)';
    g.lineWidth = 0.22;
    g.beginPath();
    g.moveTo(x + 0.45, -3);
    g.quadraticCurveTo(x - 0.4, 0, x + 0.45, 3);
    g.stroke();
  }
  // Sheen along the back.
  const sheen = g.createLinearGradient(0, -2.4, 0, 0.6);
  sheen.addColorStop(0, 'rgba(255, 240, 200, 0.0)');
  sheen.addColorStop(0.5, 'rgba(255, 236, 190, 0.28)');
  sheen.addColorStop(1, 'rgba(255, 240, 200, 0)');
  g.fillStyle = sheen;
  g.fillRect(-8, -2.6, 8, 2.4);
  g.restore();

  // Thorax: brown and furry.
  const th = g.createRadialGradient(1.2, -0.5, 0.2, 1.4, 0, 2.3);
  th.addColorStop(0, '#7b4f22');
  th.addColorStop(0.7, '#5a3816');
  th.addColorStop(1, '#3b230c');
  ellipse(g, 1.4, 0, 2.15, 2.0);
  g.fillStyle = th;
  g.fill();
  g.strokeStyle = 'rgba(214, 170, 100, 0.55)';
  g.lineWidth = hair;
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + (i % 3) * 0.13;
    const r0 = 1.4 + (i % 4) * 0.12;
    g.beginPath();
    g.moveTo(1.4 + Math.cos(a) * r0, Math.sin(a) * r0 * 0.94);
    g.lineTo(1.4 + Math.cos(a) * (r0 + 0.75), Math.sin(a) * (r0 + 0.7) * 0.94);
    g.stroke();
  }

  // Head with large dark eyes and elbowed antennae.
  ellipse(g, 4.55, 0, 1.45, 1.85);
  g.fillStyle = '#2a170a';
  g.fill();
  g.fillStyle = '#4a3420';
  for (const side of [-1, 1]) {
    ellipse(g, 4.4, side * 1.15, 0.95, 0.55, side * 0.35);
    g.fill();
  }
  g.fillStyle = 'rgba(255, 240, 210, 0.18)';
  ellipse(g, 4.2, -1.25, 0.4, 0.22, -0.3);
  g.fill();
  g.strokeStyle = '#24140a';
  g.lineWidth = 0.32;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(5.6, side * 0.5);
    g.lineTo(6.9, side * 1.35);
    g.lineTo(8.2, side * 1.05 + (buzz ? side * 0.25 : 0));
    g.stroke();
  }

  // Wings.
  g.save();
  for (const side of [-1, 1]) {
    const lift = buzz ? 0.42 : 0.12;
    const copies = buzz ? 3 : 1;
    for (let k = 0; k < copies; k++) {
      const spread = lift + (buzz ? (k - 1) * 0.16 : 0);
      g.save();
      g.translate(1.2, side * 0.7);
      g.rotate(Math.PI - side * spread);
      ellipse(g, 3.7, 0, 3.9, 1.25, 0);
      g.fillStyle = buzz ? 'rgba(214, 222, 236, 0.1)' : 'rgba(205, 214, 228, 0.15)';
      g.fill();
      g.strokeStyle = buzz ? 'rgba(255, 255, 255, 0.16)' : 'rgba(240, 244, 250, 0.32)';
      g.lineWidth = 0.14;
      g.stroke();
      if (!buzz) {
        g.beginPath();
        g.moveTo(0.4, 0.15);
        g.quadraticCurveTo(3.2, 0.7, 6.8, 0.25);
        g.moveTo(0.6, -0.2);
        g.quadraticCurveTo(3.4, -0.55, 6.2, -0.6);
        g.strokeStyle = 'rgba(80, 60, 40, 0.25)';
        g.lineWidth = 0.1;
        g.stroke();
      }
      g.restore();
    }
    // Hind wing.
    g.save();
    g.translate(0.6, side * 0.8);
    g.rotate(Math.PI - side * (lift + 0.18));
    ellipse(g, 2.6, 0, 2.6, 0.85, 0);
    g.fillStyle = 'rgba(205, 214, 228, 0.1)';
    g.fill();
    g.restore();
  }
  g.restore();
}
