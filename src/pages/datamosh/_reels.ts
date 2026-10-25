// The built-in footage, drawn frame by frame in the worker. Each reel loops
// seamlessly over its own length and moves in its own way, so their motion
// fields differ: a spin, a rush toward the camera, a sideways pan, slow
// swimming, and a climb.

import { W, H } from './_codec';

export interface Reel {
  id: string;
  name: string;
  /** Loop length in frames, at 24 frames a second. */
  length: number;
  render(frame: number, out: Uint8ClampedArray): void;
}

type Ctx = OffscreenCanvasRenderingContext2D;

function canvas(w: number, h: number): [OffscreenCanvas, Ctx] {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

/** Smooth periodic 1D noise: a sum of sines whose periods divide `period`. */
function ridge(period: number, seed: number, octaves: [number, number][]) {
  const r = rng(seed);
  const parts = octaves.map(([cycles, amp]) => ({ k: (TAU * cycles) / period, amp, ph: r() * TAU }));
  return (x: number) => parts.reduce((s, p) => s + p.amp * Math.sin(p.k * x + p.ph), 0);
}

// ---------------------------------------------------------------- spin

function spin(): Reel {
  const length = 120;
  const R = 142; // platter, with its strobe dots; the record itself is 132
  const size = R * 2 + 2;
  const cx = 214;
  const cy = 144;
  const r = rng(33);

  // The rotating surface: platter rim, splatter vinyl, grooves, and label.
  const [, d] = canvas(size, size);
  const o = size / 2;
  d.translate(o, o);
  d.fillStyle = '#2b2b2e';
  d.beginPath();
  d.arc(0, 0, R, 0, TAU);
  d.fill();
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * TAU;
    d.fillStyle = i % 2 ? '#c9c6bd' : '#77746c';
    d.beginPath();
    d.arc(Math.cos(a) * 137.5, Math.sin(a) * 137.5, 2.1, 0, TAU);
    d.fill();
  }
  d.save();
  d.beginPath();
  d.arc(0, 0, 132, 0, TAU);
  d.clip();
  d.fillStyle = '#b0141f';
  d.fillRect(-R, -R, size, size);
  // Splatter: lumpy pools of overlapping lobes, flung droplets, and a few teardrops pointing away.
  const splat = (x: number, y: number, s: number, colour: string) => {
    d.fillStyle = colour;
    const lobes = 5 + Math.floor(r() * 5);
    for (let k = 0; k < lobes; k++) {
      const a = r() * TAU;
      const off = s * r() * 0.7;
      d.beginPath();
      d.ellipse(x + Math.cos(a) * off, y + Math.sin(a) * off, s * (0.45 + r() * 0.4), s * (0.3 + r() * 0.35), r() * TAU, 0, TAU);
      d.fill();
    }
    const drops = 3 + Math.floor(r() * 9);
    for (let k = 0; k < drops; k++) {
      const a = r() * TAU;
      const dist = s * (1 + r() * 1.6);
      const ds = s * (0.06 + r() * 0.16);
      d.beginPath();
      if (r() < 0.4) {
        // A teardrop, its tail toward the pool.
        d.ellipse(x + Math.cos(a) * dist, y + Math.sin(a) * dist, ds * 2.4, ds, a, 0, TAU);
      } else {
        d.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist, ds, 0, TAU);
      }
      d.fill();
    }
  };
  for (let i = 0; i < 34; i++) {
    const a = r() * TAU;
    const rad = 56 + r() * 70;
    splat(Math.cos(a) * rad, Math.sin(a) * rad, 3 + r() * 10, ['#141214', '#141214', '#f3ecdc', '#e8b423'][i % 4]);
  }
  d.restore();
  // Label: cream paper, a red ring, and a black sector mark.
  d.fillStyle = '#efe5cf';
  d.beginPath();
  d.arc(0, 0, 47, 0, TAU);
  d.fill();
  d.strokeStyle = '#b0141f';
  d.lineWidth = 6;
  d.beginPath();
  d.arc(0, 0, 40, 0, TAU);
  d.stroke();
  d.fillStyle = '#141214';
  d.beginPath();
  d.moveTo(0, 0);
  d.arc(0, 0, 30, -0.35 * Math.PI, 0.15 * Math.PI);
  d.closePath();
  d.fill();
  d.fillStyle = '#141214';
  d.font = 'bold 11px sans-serif';
  d.textAlign = 'center';
  d.fillText('SIDE A', 0, 24);
  d.font = '8px sans-serif';
  d.fillText('33 1/3', 0, -18);
  d.fillStyle = '#b8b8b8';
  d.beginPath();
  d.arc(0, 0, 3.5, 0, TAU);
  d.fill();
  const tex = d.getImageData(0, 0, size, size).data;
  // Grooves: fine rings with darker gaps between tracks, baked into the surface.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rr = Math.hypot(x - o, y - o);
      if (rr < 49 || rr > 131) continue;
      const gap = [70, 88, 103, 117].some((g) => Math.abs(rr - g) < 0.9) ? 0.55 : 1;
      const k = (0.9 + 0.1 * Math.sin(rr * 2.7)) * gap;
      const p = (y * size + x) * 4;
      tex[p] *= k;
      tex[p + 1] *= k;
      tex[p + 2] *= k;
    }
  }

  // The still part: a walnut plinth with the light falling from the top left.
  const [, bg] = canvas(W, H);
  const wood = bg.createLinearGradient(0, 0, W, H);
  wood.addColorStop(0, '#4a2d1c');
  wood.addColorStop(1, '#22140c');
  bg.fillStyle = wood;
  bg.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    bg.strokeStyle = `rgba(${r() < 0.5 ? '20,10,5' : '120,80,50'},${0.05 + r() * 0.12})`;
    bg.lineWidth = 0.5 + r() * 2;
    const y0 = r() * H * 1.4 - H * 0.2;
    bg.beginPath();
    bg.moveTo(0, y0);
    bg.bezierCurveTo(W * 0.3, y0 + r() * 30 - 15, W * 0.6, y0 + r() * 30 - 15, W, y0 + r() * 40 - 20);
    bg.stroke();
  }
  bg.fillStyle = 'rgba(0,0,0,0.45)';
  bg.beginPath();
  bg.arc(cx + 6, cy + 8, R + 4, 0, TAU);
  bg.fill();
  const back = bg.getImageData(0, 0, W, H).data;

  // The tonearm sits still in the groove; drawn last, over the record.
  const [arm, a] = canvas(W, H);
  const pivot = [418, 52];
  const head = [cx + 98, cy + 62];
  a.fillStyle = 'rgba(0,0,0,0.35)';
  a.beginPath();
  a.arc(pivot[0] + 5, pivot[1] + 6, 25, 0, TAU);
  a.fill();
  const base = a.createRadialGradient(pivot[0] - 8, pivot[1] - 8, 2, pivot[0], pivot[1], 24);
  base.addColorStop(0, '#f2f2f0');
  base.addColorStop(1, '#6d6d6a');
  a.fillStyle = base;
  a.beginPath();
  a.arc(pivot[0], pivot[1], 22, 0, TAU);
  a.fill();
  a.lineCap = 'round';
  a.strokeStyle = 'rgba(0,0,0,0.4)';
  a.lineWidth = 7;
  a.beginPath();
  a.moveTo(pivot[0] + 5, pivot[1] + 7);
  a.lineTo(head[0] + 5, head[1] + 7);
  a.stroke();
  const tube = a.createLinearGradient(pivot[0], pivot[1] - 4, pivot[0] + 4, pivot[1] + 4);
  tube.addColorStop(0, '#fbfbf8');
  tube.addColorStop(1, '#8b8b87');
  a.strokeStyle = tube;
  a.lineWidth = 6;
  a.beginPath();
  a.moveTo(pivot[0], pivot[1]);
  a.quadraticCurveTo(pivot[0] - 10, pivot[1] + 90, head[0], head[1]);
  a.stroke();
  a.save();
  a.translate(head[0], head[1]);
  a.rotate(2.45);
  a.fillStyle = '#18181a';
  a.fillRect(-9, -7, 30, 14);
  a.fillStyle = '#d9d6cf';
  a.fillRect(-9, -7, 6, 14);
  a.restore();
  a.fillStyle = '#d0cdc6';
  a.beginPath();
  a.arc(pivot[0] + 28, pivot[1] - 16, 9, 0, TAU);
  a.fill();

  const [, m] = canvas(W, H);
  const img = m.createImageData(W, H);
  const px = img.data;
  return {
    id: 'spin',
    name: 'Spin',
    length,
    render(frame, out) {
      const ang = (frame / length) * TAU * 3;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = (y * W + x) * 4;
          const dx = x - cx;
          const dy = y - cy;
          const rr = Math.sqrt(dx * dx + dy * dy);
          if (rr > R) {
            px[p] = back[p];
            px[p + 1] = back[p + 1];
            px[p + 2] = back[p + 2];
            px[p + 3] = 255;
            continue;
          }
          // Sample the surface turned back by the current angle, bilinearly.
          const u = ca * dx + sa * dy + o;
          const v = -sa * dx + ca * dy + o;
          const x0 = Math.floor(u);
          const y0 = Math.floor(v);
          const fx = u - x0;
          const fy = v - y0;
          const i00 = (y0 * size + x0) * 4;
          const i10 = i00 + 4;
          const i01 = i00 + size * 4;
          const i11 = i01 + 4;
          // A still sheen across the grooves, where the light catches them.
          const th = Math.atan2(dy, dx);
          const lit = rr > 49 && rr < 132 ? 1 + 0.45 * Math.pow(Math.abs(Math.cos(th + 0.7)), 14) : 1;
          for (let c = 0; c < 3; c++) {
            const top = tex[i00 + c] + (tex[i10 + c] - tex[i00 + c]) * fx;
            const bot = tex[i01 + c] + (tex[i11 + c] - tex[i01 + c]) * fx;
            px[p + c] = (top + (bot - top) * fy) * lit;
          }
          px[p + 3] = 255;
        }
      }
      m.putImageData(img, 0, 0);
      m.drawImage(arm, 0, 0);
      out.set(m.getImageData(0, 0, W, H).data);
    },
  };
}

// ---------------------------------------------------------------- tunnel

function tunnel(): Reel {
  const length = 120;
  const T = 512;
  // The wall, unrolled: u runs around the tunnel (twice per turn), v along it.
  // Glazed tiles in bands of colour, with strip lights that keep their glow in the dark.
  const tex = new Float32Array(T * T * 3);
  const glow = new Float32Array(T * T);
  const tile = 16;
  const bands: [number, number, number][] = [
    [31, 132, 128],
    [200, 86, 60],
    [226, 168, 44],
    [44, 78, 168],
  ];
  for (let y = 0; y < T; y++) {
    const row = Math.floor(y / tile);
    const ty = y % tile;
    for (let x = 0; x < T; x++) {
      const col = Math.floor(x / tile);
      const tx = x % tile;
      const i = y * T + x;
      let c: [number, number, number] = [214, 208, 192];
      if (row % 8 === 3) c = bands[(row >> 3) % bands.length];
      const h = Math.sin(col * 12.9898 + row * 78.233) * 43758.5453;
      const jitter = (h - Math.floor(h)) * 14 - 7;
      // Bevelled glaze: a highlight along each tile's leading edge.
      const bevel = 0.86 + 0.24 * Math.exp(-ty / 3) + 0.06 * Math.exp(-tx / 3);
      const grout = tx < 1.5 || ty < 1.5;
      for (let k = 0; k < 3; k++) tex[i * 3 + k] = grout ? 34 : (c[k] + jitter) * bevel;
      // Two strip lights per lap of the texture, on the ceiling and the floor.
      if (row % 16 === 11 && ty > 3 && ty < 13 && (col % 32 < 6 || (col % 32 >= 16 && col % 32 < 22))) {
        glow[i] = 1;
      }
    }
  }
  // Each row's average, for far away, where single tiles are smaller than a pixel and would only shimmer.
  const rowMean = new Float32Array(T * 3);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      for (let k = 0; k < 3; k++) rowMean[y * 3 + k] += tex[(y * T + x) * 3 + k] / T;
    }
  }
  const K = 26000;
  const LAMP = [255, 226, 170];
  const speed = T / length;
  const twist = T / length;
  return {
    id: 'tunnel',
    name: 'Tunnel',
    length,
    render(frame, out) {
      const ph = (frame / length) * TAU;
      const cx = W / 2 + Math.cos(ph) * 22;
      const cy = H / 2 + Math.sin(ph * 2) * 12;
      const shiftV = frame * speed;
      const shiftU = frame * twist;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const rr = Math.sqrt(dx * dx + dy * dy) + 0.5;
          const depth = K / rr;
          const u = ((((Math.atan2(dy, dx) / TAU) * T * 2 + shiftU) % T) + T) % T;
          const v = (depth + shiftV) % T;
          // Bilinear, so the wall slides smoothly instead of stepping a texel at a time.
          const row = v | 0;
          const colA = u | 0;
          const fy = v - row;
          const fx = u - colA;
          const i00 = row * T + colA;
          const i01 = row * T + ((colA + 1) % T);
          const i10 = ((row + 1) % T) * T + colA;
          const i11 = ((row + 1) % T) * T + ((colA + 1) % T);
          const w00 = (1 - fx) * (1 - fy);
          const w01 = fx * (1 - fy);
          const w10 = (1 - fx) * fy;
          const w11 = fx * fy;
          const p = (y * W + x) * 4;
          // Light falls off with depth; the lamps carry further.
          const fog = Math.exp(-depth / 520);
          const lit = (glow[i00] * w00 + glow[i01] * w01 + glow[i10] * w10 + glow[i11] * w11) * Math.exp(-depth / 1400);
          const far = Math.min(1, Math.max(0, (depth - 240) / 520));
          const near = 1 - far;
          for (let k = 0; k < 3; k++) {
            const t =
              tex[i00 * 3 + k] * w00 + tex[i01 * 3 + k] * w01 + tex[i10 * 3 + k] * w10 + tex[i11 * 3 + k] * w11;
            out[p + k] = (t * near + rowMean[row * 3 + k] * far) * fog + lit * LAMP[k];
          }
          out[p + 3] = 255;
        }
      }
    },
  };
}

// ---------------------------------------------------------------- window

function trainWindow(): Reel {
  const length = 240;
  const r = rng(11);
  const [, sky] = canvas(W, H);
  const g = sky.createLinearGradient(0, 0, 0, 200);
  g.addColorStop(0, '#1c1a46');
  g.addColorStop(0.45, '#6d3f73');
  g.addColorStop(0.75, '#e0756a');
  g.addColorStop(1, '#f6bf78');
  sky.fillStyle = g;
  sky.fillRect(0, 0, W, H);
  const sun = sky.createRadialGradient(352, 168, 4, 352, 168, 90);
  sun.addColorStop(0, 'rgba(255,240,200,1)');
  sun.addColorStop(0.18, 'rgba(255,214,150,0.9)');
  sun.addColorStop(1, 'rgba(255,170,110,0)');
  sky.fillStyle = sun;
  sky.fillRect(0, 0, W, H);
  for (let i = 0; i < 7; i++) {
    sky.fillStyle = `rgba(255,190,170,${0.12 + r() * 0.12})`;
    sky.beginPath();
    sky.ellipse(r() * W, 40 + r() * 90, 40 + r() * 70, 3 + r() * 4, 0, 0, TAU);
    sky.fill();
  }

  // A layer is a strip that tiles sideways and slides at its own speed.
  const layer = (width: number, draw: (ctx: Ctx, w: number) => void) => {
    const [c, ctx] = canvas(width, H);
    draw(ctx, width);
    return c;
  };
  const far = layer(480, (ctx, w) => {
    const f = ridge(w, 1, [
      [1, 14],
      [3, 6],
      [7, 2.5],
    ]);
    ctx.fillStyle = '#8a5a86';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= w; x += 2) ctx.lineTo(x, 166 + f(x));
    ctx.lineTo(w, H);
    ctx.fill();
  });
  const mid = layer(720, (ctx, w) => {
    const f = ridge(w, 2, [
      [2, 6],
      [9, 3],
      [23, 1.5],
    ]);
    ctx.fillStyle = '#3d2a4d';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= w; x += 2) ctx.lineTo(x, 196 + f(x));
    ctx.lineTo(w, H);
    ctx.fill();
    // Trees: round crowns along the line.
    for (let x = 6; x < w; x += 9 + r() * 22) {
      const s = 5 + r() * 9;
      ctx.beginPath();
      ctx.arc(x, 194 + f(x) - s * 0.6, s, 0, TAU);
      ctx.fill();
    }
    // Houses with a lit window or two.
    for (const hx of [120, 300, 330, 560]) {
      const base = 196 + f(hx);
      ctx.fillStyle = '#2e2040';
      ctx.fillRect(hx, base - 16, 24, 18);
      ctx.beginPath();
      ctx.moveTo(hx - 3, base - 16);
      ctx.lineTo(hx + 12, base - 27);
      ctx.lineTo(hx + 27, base - 16);
      ctx.fill();
      ctx.fillStyle = '#ffcf6e';
      ctx.fillRect(hx + 4, base - 11, 4, 5);
      if (hx !== 330) ctx.fillRect(hx + 15, base - 11, 4, 5);
    }
  });
  const field = layer(960, (ctx, w) => {
    ctx.fillStyle = '#1d1a26';
    ctx.fillRect(0, 214, w, H - 214);
    // Furrows and hedges: marks that get larger toward the bottom.
    for (let i = 0; i < 260; i++) {
      const y = 216 + Math.pow(r(), 1.6) * 72;
      const s = 0.6 + (y - 214) / 22;
      ctx.fillStyle = r() < 0.5 ? '#2c2734' : '#141219';
      ctx.fillRect(r() * w, y, s * (3 + r() * 6), s * 0.8);
    }
    ctx.fillStyle = '#4a3348';
    for (let x = 0; x < w; x += 2) {
      const y = 214 + Math.sin((x / w) * TAU * 6) * 1.5;
      ctx.fillRect(x, y, 2, 2);
    }
  });
  const poles = layer(480, (ctx) => {
    ctx.fillStyle = '#09080c';
    ctx.fillRect(40, 0, 9, H);
    ctx.fillRect(18, 22, 54, 5);
    ctx.fillRect(24, 40, 42, 4);
    for (const x of [22, 34, 56, 68]) {
      ctx.fillStyle = '#5b5560';
      ctx.fillRect(x, 17, 3, 5);
      ctx.fillStyle = '#09080c';
    }
  });

  const [, ctx] = canvas(W, H);
  const slide = (c: OffscreenCanvas, offset: number) => {
    const w = c.width;
    let x = -(((offset % w) + w) % w);
    for (; x < W; x += w) ctx.drawImage(c, x, 0);
  };
  return {
    id: 'window',
    name: 'Window',
    length,
    render(frame, out) {
      ctx.drawImage(sky.canvas, 0, 0);
      slide(far, frame * 2);
      slide(mid, frame * 6);
      slide(field, frame * 12);
      // Wires sag between poles and rise to each one as it passes.
      const off = frame * 22;
      ctx.strokeStyle = '#0c0b10';
      ctx.lineWidth = 1.4;
      for (const [y0, sag] of [
        [23, 30],
        [41, 24],
      ]) {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const s = ((((x + off - 44) % 480) + 480) % 480) / 480;
          ctx.lineTo(x, y0 + sag * 4 * s * (1 - s));
        }
        ctx.stroke();
      }
      slide(poles, off);
      out.set(ctx.getImageData(0, 0, W, H).data);
    },
  };
}

// ---------------------------------------------------------------- koi

interface Fish {
  colours: [string, string, string | null];
  size: number;
  path: (t: number) => [number, number];
  patches: [number, number, number][];
  phase: number;
}

function koi(): Reel {
  const length = 192;
  const r = rng(5);
  const [, pond] = canvas(W, H);
  const water = pond.createRadialGradient(W * 0.45, H * 0.4, 20, W * 0.5, H * 0.5, W * 0.7);
  water.addColorStop(0, '#1f4a49');
  water.addColorStop(1, '#0a1c20');
  pond.fillStyle = water;
  pond.fillRect(0, 0, W, H);
  // Stones on the bottom, blurred by depth.
  for (let i = 0; i < 70; i++) {
    const x = r() * W;
    const y = r() * H;
    const s = 4 + r() * 16;
    const stone = pond.createRadialGradient(x - s * 0.3, y - s * 0.3, 1, x, y, s);
    stone.addColorStop(0, `rgba(${90 + r() * 40},${100 + r() * 30},${80 + r() * 20},0.35)`);
    stone.addColorStop(1, 'rgba(10,28,32,0)');
    pond.fillStyle = stone;
    pond.beginPath();
    pond.ellipse(x, y, s, s * (0.6 + r() * 0.4), r() * TAU, 0, TAU);
    pond.fill();
  }
  const bed = pond.getImageData(0, 0, W, H).data;

  // Caustics: two layers of wavering cell edges, soft, brightest where they cross. The tile repeats every C pixels.
  const C = 256;
  const caustic = new Float32Array(C * C);
  const layer = (count: number, warp: number, width: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < count; i++) pts.push([r() * C, r() * C]);
    const out = new Float32Array(C * C);
    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const wx = x + warp * Math.sin((y / C) * TAU * 4);
        const wy = y + warp * Math.sin((x / C) * TAU * 3);
        let d1 = Infinity;
        let d2 = Infinity;
        for (const [px, py] of pts) {
          let dx = Math.abs(wx - px) % C;
          let dy = Math.abs(wy - py) % C;
          if (dx > C / 2) dx = C - dx;
          if (dy > C / 2) dy = C - dy;
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
        const edge = Math.sqrt(d2) - Math.sqrt(d1);
        out[y * C + x] = Math.exp(-(edge * edge) / (2 * width * width));
      }
    }
    return out;
  };
  const a1 = layer(26, 7, 2.6);
  const a2 = layer(44, 5, 1.8);
  for (let i = 0; i < C * C; i++) caustic[i] = Math.min(1.4, a1[i] * 0.75 + a2[i] * 0.5 + a1[i] * a2[i] * 0.8);

  const loop = (t: number, ax: number, ay: number, cx: number, cy: number, k: number, ph: number): [number, number] => {
    const a = (t / length) * TAU * k + ph;
    return [cx + Math.sin(a) * ax, cy + Math.sin(a * 2) * ay];
  };
  const fish: Fish[] = [
    {
      colours: ['#f4efe6', '#d8361e', null],
      size: 1.8,
      path: (t) => loop(t, 170, 70, 256, 150, 1, 0),
      patches: [
        [0.08, 0.4, 0.5],
        [0.38, 0.3, 0.6],
        [0.62, 0.2, 0.4],
      ],
      phase: 0,
    },
    {
      colours: ['#e9a22a', '#f6d27a', null],
      size: 1.5,
      path: (t) => {
        const [x, y] = loop(t, 150, 60, 250, 140, 1, Math.PI * 0.85);
        return [x, H - y + 10];
      },
      patches: [[0.2, 0.5, 0.7]],
      phase: 1.7,
    },
    {
      colours: ['#f2ede3', '#141414', '#cf3a22'],
      size: 1.35,
      path: (t) => {
        const a = (t / length) * TAU * 2;
        return [256 + Math.cos(a) * 120, 140 + Math.sin(a) * 75];
      },
      patches: [
        [0.15, 0.35, 0.45],
        [0.45, 0.25, 0.5],
        [0.75, 0.15, 0.3],
      ],
      phase: 3.1,
    },
    {
      colours: ['#f4efe6', '#e06a1c', null],
      size: 1.15,
      path: (t) => {
        const a = -(t / length) * TAU * 2 + 1.2;
        return [300 + Math.cos(a) * 180, 150 + Math.sin(a) * 100];
      },
      patches: [[0.3, 0.45, 0.6]],
      phase: 4.4,
    },
  ];

  const pads: [number, number, number, number, boolean][] = [
    [70, 60, 30, 0.3, true],
    [460, 230, 36, 2.2, false],
    [420, 40, 22, 4.1, false],
    [110, 250, 26, 1.1, false],
  ];

  const [, ctx] = canvas(W, H);
  const img = ctx.createImageData(W, H);
  const SEG = 14;

  const drawFish = (f: Fish, t: number, shadow: boolean) => {
    // The spine follows the path a little behind the head, so the body bends into turns.
    const spine: [number, number][] = [];
    for (let i = 0; i <= SEG; i++) spine.push(f.path(t - i * 0.55 * f.size));
    const len = 46 * f.size;
    // Resample to a fixed body length.
    const pts: [number, number][] = [spine[0]];
    let need = len / SEG;
    for (let i = 1; i < spine.length && pts.length <= SEG; i++) {
      let [ax, ay] = spine[i - 1];
      const [bx, by] = spine[i];
      let seg = Math.hypot(bx - ax, by - ay);
      while (seg >= need && pts.length <= SEG) {
        const k = need / seg;
        ax += (bx - ax) * k;
        ay += (by - ay) * k;
        pts.push([ax, ay]);
        seg = Math.hypot(bx - ax, by - ay);
        need = len / SEG;
      }
      need -= seg;
    }
    while (pts.length <= SEG) pts.push(pts[pts.length - 1]);
    // Swimming wave, growing toward the tail.
    const wave = (i: number) => Math.sin(t * 0.55 + f.phase - i * 0.55) * (i / SEG) ** 1.5 * 6 * f.size;
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    const mid: [number, number][] = [];
    for (let i = 0; i <= SEG; i++) {
      const [x0, y0] = pts[Math.max(0, i - 1)];
      const [x1, y1] = pts[Math.min(SEG, i + 1)];
      let nx = -(y1 - y0);
      let ny = x1 - x0;
      const n = Math.hypot(nx, ny) || 1;
      nx /= n;
      ny /= n;
      const s = i / SEG;
      const width = (s < 0.25 ? Math.sqrt(s / 0.25) * 0.9 + 0.1 : 1 - Math.pow((s - 0.25) / 0.75, 1.3) * 0.85) * 8.5 * f.size;
      const w = wave(i);
      const cx = pts[i][0] + nx * w;
      const cy = pts[i][1] + ny * w;
      mid.push([cx, cy]);
      left.push([cx + nx * width, cy + ny * width]);
      right.push([cx - nx * width, cy - ny * width]);
    }
    const off = shadow ? 7 : 0;
    const body = new Path2D();
    body.moveTo(left[0][0] + off, left[0][1] + off);
    for (const [x, y] of left) body.lineTo(x + off, y + off);
    for (let i = right.length - 1; i >= 0; i--) body.lineTo(right[i][0] + off, right[i][1] + off);
    body.closePath();
    // Tail fin: two lobes from the last point.
    const [tx, ty] = mid[SEG];
    const [px0, py0] = mid[SEG - 2];
    const ang = Math.atan2(ty - py0, tx - px0);
    const flap = Math.sin(t * 0.55 + f.phase - SEG * 0.55) * 0.5;
    const tail = new Path2D();
    const L = 15 * f.size;
    tail.moveTo(tx + off, ty + off);
    tail.quadraticCurveTo(
      tx + Math.cos(ang + 0.7 + flap) * L * 0.8 + off,
      ty + Math.sin(ang + 0.7 + flap) * L * 0.8 + off,
      tx + Math.cos(ang + 0.45 + flap) * L + off,
      ty + Math.sin(ang + 0.45 + flap) * L + off,
    );
    tail.lineTo(tx + Math.cos(ang + flap) * L * 0.55 + off, ty + Math.sin(ang + flap) * L * 0.55 + off);
    tail.lineTo(tx + Math.cos(ang - 0.45 + flap) * L + off, ty + Math.sin(ang - 0.45 + flap) * L + off);
    tail.quadraticCurveTo(
      tx + Math.cos(ang - 0.7 + flap) * L * 0.8 + off,
      ty + Math.sin(ang - 0.7 + flap) * L * 0.8 + off,
      tx + off,
      ty + off,
    );
    // Pectoral fins, just behind the head.
    const fins = new Path2D();
    for (const side of [1, -1]) {
      const [bx, by] = side > 0 ? left[3] : right[3];
      const [hx, hy] = mid[2];
      const a = Math.atan2(by - hy, bx - hx) + side * 0.9 + Math.sin(t * 0.3 + f.phase) * 0.2 * side;
      fins.ellipse(bx + Math.cos(a) * 5 * f.size + off, by + Math.sin(a) * 5 * f.size + off, 7 * f.size, 3.2 * f.size, a, 0, TAU);
    }
    if (shadow) {
      ctx.fillStyle = 'rgba(2,10,12,0.42)';
      ctx.fill(body);
      ctx.fill(tail);
      ctx.fill(fins);
      return;
    }
    ctx.fillStyle = f.colours[0] + 'aa';
    ctx.fill(fins);
    ctx.fill(tail);
    ctx.fillStyle = f.colours[0];
    ctx.fill(body);
    ctx.save();
    ctx.clip(body);
    for (const [at, w, l] of f.patches) {
      const i0 = Math.round(at * SEG);
      const i1 = Math.min(SEG, Math.round((at + l * 0.5) * SEG));
      ctx.fillStyle = f.colours[1];
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) ctx.lineTo(left[i][0] * (1 - w) + mid[i][0] * w, left[i][1] * (1 - w) + mid[i][1] * w);
      for (let i = i1; i >= i0; i--) ctx.lineTo(right[i][0] * (0.6 + w * 0.3) + mid[i][0] * (0.4 - w * 0.3), right[i][1] * (0.6 + w * 0.3) + mid[i][1] * (0.4 - w * 0.3));
      ctx.fill();
    }
    if (f.colours[2]) {
      ctx.fillStyle = f.colours[2];
      ctx.beginPath();
      ctx.arc(mid[1][0], mid[1][1], 4.5 * f.size, 0, TAU);
      ctx.fill();
    }
    // Light from above along the back.
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2.2 * f.size;
    ctx.beginPath();
    for (let i = 1; i < SEG - 2; i++) ctx.lineTo(mid[i][0], mid[i][1]);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#101010';
    for (const side of [left, right]) {
      const [ex, ey] = side[1];
      ctx.beginPath();
      ctx.arc(mid[1][0] * 0.35 + ex * 0.65, mid[1][1] * 0.35 + ey * 0.65, 1.2 * f.size, 0, TAU);
      ctx.fill();
    }
  };

  const drawPad = (x: number, y: number, s: number, rot: number, flower: boolean, t: number) => {
    const a = rot + Math.sin((t / length) * TAU + rot) * 0.15;
    const dx = Math.cos((t / length) * TAU + rot) * 6;
    const dy = Math.sin((t / length) * TAU + rot) * 4;
    ctx.save();
    ctx.translate(x + dx, y + dy);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(0,10,10,0.4)';
    ctx.beginPath();
    ctx.ellipse(6, 7, s, s * 0.94, 0, 0.18, TAU - 0.18);
    ctx.lineTo(6, 7);
    ctx.fill();
    const leaf = ctx.createRadialGradient(-s * 0.3, -s * 0.3, 2, 0, 0, s);
    leaf.addColorStop(0, '#7fae4a');
    leaf.addColorStop(1, '#3d6b2c');
    ctx.fillStyle = leaf;
    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * 0.94, 0, 0.18, TAU - 0.18);
    ctx.lineTo(0, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,230,150,0.35)';
    ctx.lineWidth = 0.8;
    for (let k = 1; k < 9; k++) {
      const va = 0.18 + (k / 9) * (TAU - 0.36);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(va) * s * 0.9, Math.sin(va) * s * 0.85);
      ctx.stroke();
    }
    if (flower) {
      for (let k = 0; k < 10; k++) {
        const pa = (k / 10) * TAU;
        ctx.fillStyle = k % 2 ? '#f6c9d6' : '#e98fae';
        ctx.beginPath();
        ctx.ellipse(-s * 0.2 + Math.cos(pa) * 7, -s * 0.15 + Math.sin(pa) * 7, 8, 3.6, pa, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#f2d24b';
      ctx.beginPath();
      ctx.arc(-s * 0.2, -s * 0.15, 3.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  return {
    id: 'koi',
    name: 'Koi',
    length,
    render(frame, out) {
      const ox = Math.round((frame / length) * C);
      const oy = Math.round((frame / length) * C * 2) % C;
      const px = img.data;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = (y * W + x) * 4;
          const c = caustic[((y + oy) % C) * C + ((x + ox) % C)] * 30;
          px[p] = bed[p] + c * 0.6;
          px[p + 1] = bed[p + 1] + c;
          px[p + 2] = bed[p + 2] + c * 0.9;
          px[p + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      for (const f of fish) drawFish(f, frame, true);
      for (const f of fish) drawFish(f, frame, false);
      for (const [x, y, s, rot, flower] of pads) drawPad(x, y, s, rot, flower, frame);
      out.set(ctx.getImageData(0, 0, W, H).data);
    },
  };
}

// ---------------------------------------------------------------- balloons

function balloons(): Reel {
  const length = 192;
  const r = rng(21);
  const [, sky] = canvas(W, H);
  const g = sky.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1d5fae');
  g.addColorStop(1, '#a9d3ef');
  sky.fillStyle = g;
  sky.fillRect(0, 0, W, H);

  // Clouds: one tall tile of soft puffs that scrolls down as the camera climbs.
  const CH2 = 576;
  const [clouds, cl] = canvas(W, CH2);
  for (let i = 0; i < 14; i++) {
    const x = r() * W;
    const y = r() * CH2;
    const s = 20 + r() * 40;
    for (let k = 0; k < 9; k++) {
      const px = x + (r() - 0.5) * s * 2.6;
      const py = y + (r() - 0.5) * s * 0.5;
      const ps = s * (0.4 + r() * 0.5);
      for (const yy of [py, py - CH2, py + CH2]) {
        const puff = cl.createRadialGradient(px, yy - ps * 0.2, 1, px, yy, ps);
        puff.addColorStop(0, 'rgba(255,255,255,0.75)');
        puff.addColorStop(0.6, 'rgba(240,246,252,0.35)');
        puff.addColorStop(1, 'rgba(240,246,252,0)');
        cl.fillStyle = puff;
        cl.beginPath();
        cl.arc(px, yy, ps, 0, TAU);
        cl.fill();
      }
    }
  }

  interface Balloon {
    x: number;
    s: number;
    stripes: string[];
    period: number;
    laps: number;
    y0: number;
    sway: number;
  }
  const palettes = [
    ['#e63b2e', '#f5c242'],
    ['#2e6fe6', '#f4f1e8', '#e63b2e'],
    ['#7a2fb3', '#f08a24'],
    ['#1f9a5c', '#f4f1e8'],
    ['#f2a3b8', '#3a2d7a'],
    ['#f5c242', '#1d1d1f'],
  ];
  const list: Balloon[] = palettes.map((stripes, i) => {
    const s = [0.45, 0.6, 1.25, 0.8, 0.5, 1.6][i];
    return {
      x: [60, 170, 300, 430, 470, 120][i],
      s,
      stripes,
      period: H + 200 * s,
      laps: s > 1.1 ? 2 : 1,
      y0: r(),
      sway: r() * TAU,
    };
  });
  list.sort((a, b) => a.s - b.s);

  const [, ctx] = canvas(W, H);
  const drawBalloon = (b: Balloon, frame: number) => {
    const s = b.s * 46;
    const travel = ((frame / length) * b.laps + b.y0) % 1;
    const y = H + s * 2 - travel * b.period;
    const x = b.x + Math.sin((frame / length) * TAU + b.sway) * 6;
    ctx.save();
    ctx.translate(x, y);
    // Basket and lines.
    ctx.strokeStyle = 'rgba(40,30,20,0.7)';
    ctx.lineWidth = Math.max(0.6, b.s * 0.9);
    ctx.beginPath();
    ctx.moveTo(-s * 0.28, s * 0.9);
    ctx.lineTo(-s * 0.12, s * 1.28);
    ctx.moveTo(s * 0.28, s * 0.9);
    ctx.lineTo(s * 0.12, s * 1.28);
    ctx.stroke();
    ctx.fillStyle = '#6b4526';
    ctx.fillRect(-s * 0.13, s * 1.27, s * 0.26, s * 0.2);
    ctx.fillStyle = '#8d6236';
    ctx.fillRect(-s * 0.13, s * 1.27, s * 0.26, s * 0.05);
    // Envelope: a sphere that narrows to the mouth.
    const env = new Path2D();
    env.moveTo(-s * 0.26, s * 0.92);
    env.bezierCurveTo(-s * 0.75, s * 0.45, -s * 1.02, s * 0.1, -s, -s * 0.2);
    env.bezierCurveTo(-s * 0.98, -s * 0.85, -s * 0.5, -s * 1.2, 0, -s * 1.2);
    env.bezierCurveTo(s * 0.5, -s * 1.2, s * 0.98, -s * 0.85, s, -s * 0.2);
    env.bezierCurveTo(s * 1.02, s * 0.1, s * 0.75, s * 0.45, s * 0.26, s * 0.92);
    env.closePath();
    ctx.save();
    ctx.clip(env);
    // Gores: bands whose widths follow the curve of the sphere.
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + (i / n) * Math.PI;
      const a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI;
      ctx.fillStyle = b.stripes[i % b.stripes.length];
      ctx.fillRect(Math.sin(a0) * s * 1.05, -s * 1.3, (Math.sin(a1) - Math.sin(a0)) * s * 1.05 + 0.6, s * 2.4);
    }
    const shade = ctx.createRadialGradient(-s * 0.4, -s * 0.6, s * 0.1, 0, -s * 0.1, s * 1.3);
    shade.addColorStop(0, 'rgba(255,255,255,0.35)');
    shade.addColorStop(0.5, 'rgba(255,255,255,0)');
    shade.addColorStop(1, 'rgba(10,20,50,0.5)');
    ctx.fillStyle = shade;
    ctx.fillRect(-s * 1.1, -s * 1.3, s * 2.2, s * 2.4);
    ctx.restore();
    ctx.restore();
  };

  return {
    id: 'balloons',
    name: 'Balloons',
    length,
    render(frame, out) {
      ctx.drawImage(sky.canvas, 0, 0);
      const cy = Math.round((frame / length) * CH2);
      ctx.drawImage(clouds, 0, cy - CH2);
      ctx.drawImage(clouds, 0, cy);
      for (const b of list) drawBalloon(b, frame);
      out.set(ctx.getImageData(0, 0, W, H).data);
    },
  };
}

export function makeReels(): Reel[] {
  return [spin(), tunnel(), trainWindow(), koi(), balloons()];
}
