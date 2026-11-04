// Things done to the printed code: marker, correction pen, coffee rings, and
// tears. Each mark is stored in module units (origin at the code's top-left
// module) and drawn the same way on screen and for the scanner, so what you see
// is what it reads.

export type Mark =
  | { kind: 'marker'; w: number; pts: number[] }
  | { kind: 'whiteout'; w: number; pts: number[] }
  | { kind: 'coffee'; x: number; y: number; r: number; seed: number }
  | { kind: 'tear'; x: number; y: number; r: number; seed: number };

export const INK = '#17151c';
export const PAPER = '#fdfcf8';
const BACKING = '#2c2a31';

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Smooth periodic noise around a circle, for ragged outlines. */
function ring(seed: number, n: number, amp: number[]): (t: number) => number {
  const r = rand(seed);
  const terms = amp.map((a, i) => ({ a, f: i + 2 + Math.floor(r() * 3), p: r() * Math.PI * 2 }));
  const jitter = Array.from({ length: n }, () => r() - 0.5);
  return (t: number) => {
    let v = 0;
    for (const { a, f, p } of terms) v += a * Math.sin(t * f + p);
    return v + jitter[Math.floor(((t / (Math.PI * 2)) * n + n) % n)] * (amp[amp.length - 1] ?? 0);
  };
}

function polyline(ctx: CanvasRenderingContext2D, pts: number[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  if (pts.length === 2) ctx.lineTo(pts[0] + 0.01, pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
}

export function tearOutline(m: { x: number; y: number; r: number; seed: number }): number[] {
  const n = 64;
  const big = ring(m.seed, 1, [0.18, 0.09, 0.05]);
  const fine = rand(m.seed ^ 0x9e3779b9);
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const rr = m.r * (1 + big(t)) * (0.94 + fine() * 0.12);
    pts.push(m.x + Math.cos(t) * rr, m.y + Math.sin(t) * rr);
  }
  return pts;
}

/** Draw one mark; the context is already transformed to module units. */
export function drawMark(ctx: CanvasRenderingContext2D, m: Mark, pxPerModule: number) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (m.kind) {
    case 'marker': {
      ctx.globalCompositeOperation = 'multiply';
      polyline(ctx, m.pts);
      ctx.strokeStyle = 'rgba(22, 18, 40, 0.86)';
      ctx.lineWidth = m.w;
      ctx.stroke();
      // A darker core where the felt presses hardest.
      ctx.strokeStyle = 'rgba(22, 18, 40, 0.35)';
      ctx.lineWidth = m.w * 0.55;
      ctx.stroke();
      break;
    }
    case 'whiteout': {
      polyline(ctx, m.pts);
      ctx.strokeStyle = 'rgba(40, 30, 20, 0.16)';
      ctx.lineWidth = m.w + 2 / pxPerModule;
      ctx.translate(0.08, 0.12);
      ctx.stroke();
      ctx.translate(-0.08, -0.12);
      polyline(ctx, m.pts);
      ctx.strokeStyle = '#f7f5ee';
      ctx.lineWidth = m.w;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = m.w * 0.45;
      ctx.translate(-0.05, -0.06);
      ctx.stroke();
      break;
    }
    case 'coffee': {
      ctx.globalCompositeOperation = 'multiply';
      const wob = ring(m.seed, 48, [0.06, 0.035, 0.02, 0.008]);
      const path = (scale: number) => {
        ctx.beginPath();
        for (let i = 0; i <= 96; i++) {
          const t = (i / 96) * Math.PI * 2;
          const rr = m.r * scale * (1 + wob(t));
          if (i === 0) ctx.moveTo(m.x + Math.cos(t) * rr, m.y + Math.sin(t) * rr);
          else ctx.lineTo(m.x + Math.cos(t) * rr, m.y + Math.sin(t) * rr);
        }
        ctx.closePath();
      };
      // The pale pool, then the dark rim where the coffee dried.
      path(1);
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
      g.addColorStop(0, 'rgba(176, 120, 64, 0.1)');
      g.addColorStop(0.8, 'rgba(160, 104, 52, 0.2)');
      g.addColorStop(1, 'rgba(140, 86, 40, 0.34)');
      ctx.fillStyle = g;
      ctx.fill();
      path(0.985);
      ctx.strokeStyle = 'rgba(122, 70, 30, 0.88)';
      ctx.lineWidth = Math.max(0.38, m.r * 0.07);
      ctx.stroke();
      path(1.01);
      ctx.strokeStyle = 'rgba(110, 62, 26, 0.5)';
      ctx.lineWidth = Math.max(0.18, m.r * 0.03);
      ctx.stroke();
      // A second, fainter ring where the cup was set down again.
      const r2 = rand(m.seed + 7);
      if (r2() < 0.7) {
        const dx = (r2() - 0.5) * m.r * 0.5;
        const dy = (r2() - 0.5) * m.r * 0.5;
        ctx.beginPath();
        const a0 = r2() * Math.PI * 2;
        ctx.arc(m.x + dx, m.y + dy, m.r * (0.96 + r2() * 0.06), a0, a0 + Math.PI * (0.6 + r2() * 0.7));
        ctx.strokeStyle = 'rgba(122, 70, 30, 0.42)';
        ctx.lineWidth = Math.max(0.22, m.r * 0.04);
        ctx.stroke();
      }
      break;
    }
    case 'tear': {
      const pts = tearOutline(m);
      const path = () => {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          if (i === 0) ctx.moveTo(pts[i], pts[i + 1]);
          else ctx.lineTo(pts[i], pts[i + 1]);
        }
        ctx.closePath();
      };
      // The board behind, with the sheet's shadow along the top edge of the hole.
      path();
      ctx.fillStyle = BACKING;
      ctx.fill();
      ctx.save();
      path();
      ctx.clip();
      ctx.translate(0.25, 0.35);
      path();
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.stroke();
      ctx.restore();
      // The torn fibres: a white, ragged lip.
      path();
      ctx.lineWidth = 0.42;
      ctx.strokeStyle = '#fffefa';
      ctx.stroke();
      path();
      ctx.lineWidth = 0.12;
      ctx.strokeStyle = 'rgba(120, 110, 96, 0.5)';
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}
