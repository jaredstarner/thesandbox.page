// The valley drawn from above: fields and water once, then trees, roofs, and their shadows
// again whenever the sun has moved, so the shadows on the map always point away from it.

import { EXTENT, type Field, type Land, type Patch, type Pt, type Ring, type Use } from './_land';
import { mulberry32, type Rng } from './_rng';
import type { Sun } from './_sun';

export interface Flyer {
  x: number;
  y: number;
  trail: Pt[];
  color: string;
}

export interface Overlay {
  sun: Sun;
  /** The player's mark, in metres. */
  mark: Pt | null;
  searchRadius: number;
  feeder: Pt | null;
  flyers: Flyer[];
  found: Patch[];
  reveal: { patch: Patch; good: boolean } | null;
  target: Patch | null;
  /** Fade for the sun ray, 0..1. */
  sunRay: number;
  showAngle: boolean;
}

type Tile = { canvas: HTMLCanvasElement; rows: boolean };

export class MapView {
  readonly land: Land;
  w = 0;
  h = 0;
  dpr = 1;
  /** CSS pixels per metre. */
  s = 1;
  private base = document.createElement('canvas');
  private live = document.createElement('canvas');
  private shade = document.createElement('canvas');
  private tiles = new Map<string, Tile>();
  private sunKey = '';

  constructor(land: Land) {
    this.land = land;
  }

  resize(w: number, h: number, dpr: number): void {
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.s = Math.min(w, h) / (2 * EXTENT);
    for (const c of [this.base, this.live, this.shade]) {
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
    }
    this.tiles.clear();
    this.relief = null;
    this.renderBase();
    this.sunKey = '';
  }

  /** World metres to CSS pixels. */
  toScreen(x: number, y: number): [number, number] {
    return [this.w / 2 + x * this.s, this.h / 2 + y * this.s];
  }

  toWorld(px: number, py: number): Pt {
    return [(px - this.w / 2) / this.s, (py - this.h / 2) / this.s];
  }

  private dev(x: number, y: number): [number, number] {
    const k = this.s * this.dpr;
    return [(this.w / 2) * this.dpr + x * k, (this.h / 2) * this.dpr + y * k];
  }

  private trace(ctx: CanvasRenderingContext2D, ring: Ring, dx = 0, dy = 0): void {
    ctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = this.dev(ring[i][0] + dx, ring[i][1] + dy);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // ---------- textures ----------

  private tile(key: string, make: (d: number, rng: Rng) => Tile): Tile {
    let t = this.tiles.get(key);
    if (!t) {
      t = make(this.dpr, mulberry32(key.length * 131 + key.charCodeAt(0) * 17 + key.charCodeAt(key.length - 1)));
      this.tiles.set(key, t);
    }
    return t;
  }

  private rows(
    key: string,
    soil: string,
    row: string,
    spacing: number,
    width: number,
    opts: { bumps?: boolean; speck?: [string, number, number][]; tram?: string } = {},
  ): Tile {
    return this.tile(key, (d, rng) => {
      const sp = Math.max(2, Math.round(spacing * d));
      const n = opts.tram ? Math.max(6, Math.round(24 / spacing)) : Math.ceil(72 / sp);
      const W = Math.round(144 * d);
      const H = sp * n;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d')!;
      g.fillStyle = soil;
      g.fillRect(0, 0, W, H);
      const rw = width * d;
      for (let j = 0; j < n; j++) {
        const y = j * sp + sp / 2;
        if (opts.bumps) {
          for (let x = 0; x < W + rw; x += rw * between01(rng, 0.7, 1)) {
            const r = (rw / 2) * between01(rng, 0.8, 1.15);
            g.fillStyle = row;
            g.globalAlpha = between01(rng, 0.82, 1);
            for (const ox of [0, -W, W]) {
              g.beginPath();
              g.arc(x + ox, y + between01(rng, -0.4, 0.4) * d, r, 0, Math.PI * 2);
              g.fill();
            }
          }
          g.globalAlpha = 1;
        } else {
          g.fillStyle = row;
          g.globalAlpha = between01(rng, 0.75, 1);
          g.fillRect(0, y - rw / 2, W, rw);
          g.globalAlpha = 1;
        }
      }
      if (opts.tram) {
        g.fillStyle = opts.tram;
        g.fillRect(0, H * 0.3, W, Math.max(1, 0.8 * d));
        g.fillRect(0, H * 0.3 + 2.2 * d, W, Math.max(1, 0.8 * d));
      }
      if (opts.speck) speckle(g, W, H, d, rng, opts.speck);
      return { canvas: c, rows: true };
    });
  }

  private speck(key: string, base: string, dots: [string, number, number][]): Tile {
    return this.tile(key, (d, rng) => {
      const W = Math.round(128 * d);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = W;
      const g = c.getContext('2d')!;
      g.fillStyle = base;
      g.fillRect(0, 0, W, W);
      speckle(g, W, W, d, rng, dots);
      return { canvas: c, rows: false };
    });
  }

  private fieldTile(f: Field): Tile {
    const v = f.variant;
    switch (f.use as Use) {
      case 'lavender': {
        const rowColour = ['#8467c2', '#9668b8', '#7570c4'][v];
        return this.rows(`lav${v}`, '#d8c7a0', rowColour, 3.4, 2.5, { bumps: true });
      }
      case 'vineyard':
        return this.rows(`vin${v}`, ['#cdb284', '#c9ab7a', '#d3bb8f'][v], '#5e8a38', 3.1, 1.6, { bumps: true });
      case 'sunflower':
        return this.rows(`sun${v}`, '#7a8f35', ['#efbd25', '#f2c534', '#e8b21f'][v], 2.4, 1.9, {
          bumps: true,
          speck: [['#8a5a14', 70, 0.35]],
        });
      case 'maize':
        return this.rows('maize', '#4a7a2b', '#3a6522', 2.2, 1, {});
      case 'wheat':
        return this.rows(`wheat${v}`, ['#e8d49a', '#e2ca8b', '#ecdaa6'][v], 'rgba(190, 160, 90, 0.5)', 2.6, 0.7, {
          tram: 'rgba(170, 140, 80, 0.45)',
        });
      case 'hay':
        return this.speck(`hay${v}`, ['#a8b562', '#b3b96a', '#9fb05c'][v], [
          ['#c9c27a', 260, 0.9],
          ['#8d9c4c', 220, 0.8],
          ['#f4f0dc', 50, 0.4],
          ['#e9c53a', 40, 0.4],
          ['#b77fc4', 18, 0.4],
        ]);
      case 'clover':
        return this.speck('clover', '#88ab55', [
          ['#9fbf65', 240, 0.8],
          ['#f6f4e6', 150, 0.45],
          ['#6f9445', 150, 0.7],
        ]);
      case 'pasture':
        return this.speck(`past${v}`, '#9cb45d', [
          ['#b0c46c', 200, 1.1],
          ['#86a04c', 200, 1],
        ]);
      case 'fallow':
        return this.speck('fallow', '#c9b98a', [
          ['#b3a676', 260, 1.2],
          ['#d8cba0', 200, 1],
          ['#9aa266', 60, 1],
        ]);
      case 'garrigue':
        return this.speck(`garr${v}`, ['#cfc196', '#d4c7a0', '#c8bb90'][v], [
          ['#8e966a', 150, 2.2],
          ['#7c8a5b', 110, 1.6],
          ['#a7a77c', 120, 1.4],
          ['#e8e0c8', 50, 0.9],
        ]);
      case 'garden':
        return this.speck('garden', '#a9b46a', [
          ['#7f9a48', 160, 1.6],
          ['#c8b98c', 120, 1.3],
          ['#d0c49a', 80, 2],
        ]);
      case 'village':
        return this.speck('village', '#d6c9ab', [
          ['#c8b996', 200, 1.3],
          ['#e2d7bd', 160, 1.1],
        ]);
      case 'orchard':
        return this.speck('orchard', '#a2b862', [
          ['#b5c873', 220, 1],
          ['#8ea653', 160, 0.9],
          ['#f4f2e2', 30, 0.4],
        ]);
      case 'olive':
        return this.speck(`oliv${v}`, '#d5c79c', [
          ['#c3b688', 200, 1.2],
          ['#b9b17e', 90, 1],
        ]);
      default:
        return this.speck('plain', '#c9bf98', [['#b8ad85', 120, 1]]);
    }
  }

  // ---------- the fixed layer ----------

  private renderBase(): void {
    const ctx = this.base.getContext('2d')!;
    const k = this.s * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#cdbf93';
    ctx.fillRect(0, 0, this.base.width, this.base.height);

    for (const f of this.land.fields) {
      if (f.use === 'water') continue;
      const tile = this.fieldTile(f);
      const pattern = ctx.createPattern(tile.canvas, 'repeat');
      if (!pattern) continue;
      const [cx, cy] = this.dev(f.origin[0], f.origin[1]);
      pattern.setTransform(new DOMMatrix().translateSelf(cx, cy).rotateSelf(tile.rows ? (f.angle * 180) / Math.PI : 0));
      this.trace(ctx, f.ring);
      ctx.fillStyle = pattern;
      ctx.fill();
      const tone = f.group < 100000 ? (((f.group * 2246822519) >>> 0) % 2000) / 1000 - 1 : f.tone;
      ctx.fillStyle = tone > 0 ? `rgba(255, 250, 230, ${tone * 0.08})` : `rgba(60, 50, 20, ${-tone * 0.08})`;
      ctx.fill();
    }
    ctx.beginPath();
    for (const [a, b] of this.land.borders) {
      const [ax, ay] = this.dev(a[0], a[1]);
      const [bx, by] = this.dev(b[0], b[1]);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.strokeStyle = 'rgba(80, 64, 32, 0.32)';
    ctx.lineWidth = Math.max(0.8, 0.8 * this.dpr);
    ctx.lineCap = 'round';
    ctx.stroke();

    // River below and above the reservoir.
    const river = this.land.river;
    const stroke = (width: number, colour: string) => {
      ctx.beginPath();
      for (let i = 0; i < river.length; i++) {
        const [x, y] = this.dev(river[i][0], river[i][1]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    stroke(Math.max(3 * this.dpr, 34 * k), '#8a9a6a');
    stroke(Math.max(2.2 * this.dpr, 24 * k), '#5f9fae');
    stroke(Math.max(1, 8 * k), 'rgba(160, 210, 215, 0.6)');

    // The reservoir: shallows paler, deep water darker, a pale beach line.
    const lake = this.land.lake;
    let lx = 0;
    let ly = 0;
    for (const [x, y] of lake) {
      lx += x;
      ly += y;
    }
    lx /= lake.length;
    ly /= lake.length;
    const [gx, gy] = this.dev(lx, ly);
    const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, 760 * k);
    grad.addColorStop(0, '#3f8ea6');
    grad.addColorStop(0.65, '#4f9db0');
    grad.addColorStop(1, '#7cbdbf');
    this.trace(ctx, lake);
    ctx.fillStyle = '#d9cfa8';
    ctx.lineWidth = Math.max(3, 14 * k);
    ctx.strokeStyle = '#ddd2ab';
    ctx.stroke();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const ripple = this.speck('ripple', 'rgba(0,0,0,0)', [['rgba(220, 245, 245, 0.35)', 70, 0.5]]);
    const rp = ctx.createPattern(ripple.canvas, 'repeat');
    if (rp) {
      rp.setTransform(new DOMMatrix().scaleSelf(1.6, 0.6));
      ctx.fillStyle = rp;
      ctx.fillRect(0, 0, this.base.width, this.base.height);
    }
    ctx.restore();
    this.trace(ctx, lake);
    ctx.strokeStyle = 'rgba(30, 80, 100, 0.35)';
    ctx.lineWidth = Math.max(1, 0.8 * this.dpr);
    ctx.stroke();

    // The dam: a pale concrete wall with its spillway.
    const [d0, d1] = this.land.dam;
    const [ax, ay] = this.dev(d0[0] - 20, d0[1] + 6);
    const [bx, by] = this.dev(d1[0] + 20, d1[1] + 6);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#b9b5a8';
    ctx.lineWidth = Math.max(3 * this.dpr, 20 * k);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.strokeStyle = '#e8e4d8';
    ctx.lineWidth = Math.max(1.6 * this.dpr, 12 * k);
    ctx.stroke();

    // Roads: a darker casing under a pale top.
    const roads = this.land.roads;
    const drawRoads = (
      kind: 'road' | 'lane' | 'street' | 'track',
      casing: number,
      top: number,
      cc: string,
      tc: string,
    ) => {
      for (const pass of [0, 1]) {
        for (const r of roads) {
          if (r.kind !== kind) continue;
          ctx.beginPath();
          r.pts.forEach(([x, y], i) => {
            const [px, py] = this.dev(x, y);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = pass === 0 ? cc : tc;
          ctx.lineWidth = (pass === 0 ? casing : top) * this.dpr;
          ctx.stroke();
        }
      }
    };
    drawRoads('track', 1.9, 1.1, 'rgba(120, 100, 60, 0.35)', '#e2d5b0');
    drawRoads('street', 1.9, 1.2, 'rgba(120, 100, 60, 0.4)', '#ece2c8');
    drawRoads('lane', 2.6, 1.7, 'rgba(110, 92, 56, 0.5)', '#efe6cc');
    drawRoads('road', 3.6, 2.5, 'rgba(100, 84, 50, 0.6)', '#f4eedc');
  }

  // ---------- the layer that follows the sun ----------

  private renderLive(sun: Sun): void {
    const ctx = this.live.getContext('2d')!;
    const sh = this.shade.getContext('2d')!;
    const k = this.s * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    sh.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.live.width, this.live.height);
    sh.clearRect(0, 0, this.shade.width, this.shade.height);

    const az = (sun.azimuth * Math.PI) / 180;
    const alt = Math.max(5, sun.altitude);
    const per = Math.min(6, 1 / Math.tan((alt * Math.PI) / 180));
    const sdx = -Math.sin(az) * per;
    const sdy = Math.cos(az) * per;
    const lx = Math.sin(az);
    const ly = -Math.cos(az);

    this.hillshade(ctx, sun);

    // Shadows, drawn solid then laid down at one strength so overlaps don't darken twice.
    sh.fillStyle = '#18202c';
    sh.strokeStyle = '#18202c';
    sh.lineCap = 'round';
    for (const wood of this.land.woods) {
      for (const t of [0.34, 0.67, 1]) {
        this.trace(sh, wood.ring, sdx * 15 * t, sdy * 15 * t);
        sh.fill();
      }
    }
    for (const t of this.land.trees) {
      const [x0, y0] = this.dev(t.x, t.y);
      const [x1, y1] = this.dev(t.x + sdx * t.h, t.y + sdy * t.h);
      sh.lineWidth = Math.max(1.2, 2 * t.r * k * (t.kind === 'cypress' ? 1.15 : 0.95));
      sh.beginPath();
      sh.moveTo(x0, y0);
      sh.lineTo(x1, y1);
      sh.stroke();
    }
    for (const b of this.land.buildings) {
      if (b.h <= 0) continue;
      const corners = rect(b);
      const pts: Pt[] = [...corners, ...corners.map(([x, y]) => [x + sdx * b.h, y + sdy * b.h] as Pt)];
      this.trace(sh, hull(pts));
      sh.fill();
    }
    ctx.globalAlpha = 0.3;
    ctx.drawImage(this.shade, 0, 0);
    ctx.globalAlpha = 1;

    // Woods.
    for (const wood of this.land.woods) {
      const chestnut = wood.use === 'chestnut';
      const tile = this.speck(chestnut ? 'chestnut' : 'oakwood', chestnut ? '#3f6629' : '#4c6b2d', [
        [chestnut ? '#4f7a32' : '#5d7d36', 140, 4.2],
        [chestnut ? '#2f5120' : '#3b5824', 120, 3.6],
        [chestnut ? '#6a8f3c' : '#6f8e3e', 80, 2.4],
        ...(chestnut ? ([['#e6dc9c', 90, 1.3]] as [string, number, number][]) : []),
      ]);
      const pattern = ctx.createPattern(tile.canvas, 'repeat');
      this.trace(ctx, wood.ring);
      ctx.fillStyle = pattern ?? '#4c6b2d';
      ctx.fill();
    }

    // Tree crowns, one path per kind, each with a highlight toward the sun.
    const colours: Record<string, [string, string]> = {
      oak: ['#53702e', '#6f8d3d'],
      cypress: ['#2c4722', '#3f5f2c'],
      plane: ['#68883a', '#89a64c'],
      olive: ['#8d9b6a', '#b1bc8c'],
      fruit: ['#6d9040', '#90b158'],
      poplar: ['#6c8d3a', '#8eab4d'],
      lime: ['#7b9c3e', '#b0c45e'],
      pine: ['#3d582b', '#557237'],
      bale: ['#cfac5d', '#ebd18b'],
    };
    const byKind = new Map<string, { body: Path2D; hi: Path2D }>();
    for (const t of this.land.trees) {
      let p = byKind.get(t.kind);
      if (!p) {
        p = { body: new Path2D(), hi: new Path2D() };
        byKind.set(t.kind, p);
      }
      const [x, y] = this.dev(t.x, t.y);
      const r = Math.max(0.9, t.r * k * (t.kind === 'bale' ? 1 : 1.05));
      p.body.moveTo(x + r, y);
      p.body.arc(x, y, r, 0, Math.PI * 2);
      const hr = r * 0.58;
      const hx = x + lx * r * 0.3;
      const hy = y + ly * r * 0.3;
      p.hi.moveTo(hx + hr, hy);
      p.hi.arc(hx, hy, hr, 0, Math.PI * 2);
    }
    for (const [kind, p] of byKind) {
      const [body, hi] = colours[kind] ?? colours.oak;
      ctx.fillStyle = body;
      ctx.fill(p.body);
      ctx.fillStyle = hi;
      ctx.globalAlpha = 0.85;
      ctx.fill(p.hi);
      ctx.globalAlpha = 1;
    }

    // Roofs: the slope facing the sun is lit.
    for (const b of this.land.buildings) {
      const corners = rect(b);
      if (b.kind === 'pool') {
        this.trace(ctx, corners);
        ctx.fillStyle = '#56c4d3';
        ctx.fill();
        ctx.strokeStyle = '#f4f1e8';
        ctx.lineWidth = Math.max(1, 1.2 * this.dpr);
        ctx.stroke();
        continue;
      }
      if (b.kind === 'hive') {
        this.trace(ctx, corners);
        ctx.fillStyle = '#f7f3e9';
        ctx.fill();
        ctx.strokeStyle = 'rgba(60, 50, 30, 0.6)';
        ctx.lineWidth = Math.max(0.8, 0.6 * this.dpr);
        ctx.stroke();
        continue;
      }
      const ca = Math.cos(b.a);
      const sa = Math.sin(b.a);
      const nx = -sa;
      const ny = ca;
      const litPlus = nx * lx + ny * ly > 0;
      const base =
        b.kind === 'barn'
          ? [32, 10, 58 + b.tone * 4]
          : b.kind === 'church' || b.kind === 'tower'
            ? [16, 34, 46]
            : [15 + b.tone * 5, 52 + b.tone * 6, 50 + b.tone * 5];
      const lit = `hsl(${base[0]} ${base[1]}% ${base[2] + 9}%)`;
      const dark = `hsl(${base[0]} ${base[1]}% ${base[2] - 8}%)`;
      if (b.kind === 'tower') {
        const [cx, cy] = [b.x, b.y];
        for (let i = 0; i < 4; i++) {
          const a0 = corners[i];
          const a1 = corners[(i + 1) % 4];
          const mx = (a0[0] + a1[0]) / 2 - cx;
          const my = (a0[1] + a1[1]) / 2 - cy;
          const facing = (mx * lx + my * ly) / Math.hypot(mx, my);
          this.trace(ctx, [a0, a1, [cx, cy]]);
          ctx.fillStyle = `hsl(${base[0]} ${base[1]}% ${base[2] + facing * 9}%)`;
          ctx.fill();
        }
        continue;
      }
      const half = b.d / 2;
      const ridgeA: Pt = [b.x - (ca * b.w) / 2, b.y - (sa * b.w) / 2];
      const ridgeB: Pt = [b.x + (ca * b.w) / 2, b.y + (sa * b.w) / 2];
      const plus: Ring = [
        ridgeA,
        ridgeB,
        [ridgeB[0] + nx * half, ridgeB[1] + ny * half],
        [ridgeA[0] + nx * half, ridgeA[1] + ny * half],
      ];
      const minus: Ring = [
        ridgeA,
        ridgeB,
        [ridgeB[0] - nx * half, ridgeB[1] - ny * half],
        [ridgeA[0] - nx * half, ridgeA[1] - ny * half],
      ];
      this.trace(ctx, plus);
      ctx.fillStyle = litPlus ? lit : dark;
      ctx.fill();
      this.trace(ctx, minus);
      ctx.fillStyle = litPlus ? dark : lit;
      ctx.fill();
      this.trace(ctx, corners);
      ctx.strokeStyle = 'rgba(70, 30, 10, 0.35)';
      ctx.lineWidth = Math.max(0.6, 0.5 * this.dpr);
      ctx.stroke();
    }
  }

  private relief: {
    cols: number;
    rows: number;
    nx: Float32Array;
    ny: Float32Array;
    nz: Float32Array;
    wet: Uint8Array;
  } | null = null;

  /** Surface normals on a coarse grid, worked out once per size; only the lighting changes with the sun. */
  private reliefGrid() {
    if (this.relief) return this.relief;
    const cols = 110;
    const rows = Math.max(1, Math.round((cols * this.h) / this.w));
    const n = cols * rows;
    const nx = new Float32Array(n);
    const ny = new Float32Array(n);
    const nz = new Float32Array(n);
    const wet = new Uint8Array(n);
    const e = this.land.elevation;
    const relief = 420;
    const step = 40;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const [x, y] = this.toWorld(((i + 0.5) / cols) * this.w, ((j + 0.5) / rows) * this.h);
        const o = j * cols + i;
        if (this.land.isWater(x, y)) {
          wet[o] = 1;
          continue;
        }
        const dzdx = ((e(x + step, y) - e(x - step, y)) * relief) / (2 * step);
        const dzdy = ((e(x, y + step) - e(x, y - step)) * relief) / (2 * step);
        const len = Math.hypot(dzdx, dzdy, 1);
        nx[o] = -dzdx / len;
        ny[o] = -dzdy / len;
        nz[o] = 1 / len;
      }
    }
    this.relief = { cols, rows, nx, ny, nz, wet };
    return this.relief;
  }

  /** Relief lit by the real sun: slopes facing it brighten, slopes away from it darken. */
  private hillshade(ctx: CanvasRenderingContext2D, sun: Sun): void {
    const g0 = this.reliefGrid();
    const { cols, rows } = g0;
    const c = document.createElement('canvas');
    c.width = cols;
    c.height = rows;
    const g = c.getContext('2d')!;
    const img = g.createImageData(cols, rows);
    const az = (sun.azimuth * Math.PI) / 180;
    const alt = (Math.max(4, sun.altitude) * Math.PI) / 180;
    const lx = Math.sin(az) * Math.cos(alt);
    const ly = -Math.cos(az) * Math.cos(alt);
    const lz = Math.sin(alt);
    for (let o = 0; o < cols * rows; o++) {
      if (g0.wet[o]) continue;
      const v = g0.nx[o] * lx + g0.ny[o] * ly + g0.nz[o] * lz - lz;
      const q = o * 4;
      if (v < 0) {
        img.data[q] = 28;
        img.data[q + 1] = 32;
        img.data[q + 2] = 60;
        img.data[q + 3] = Math.min(115, -v * 520);
      } else {
        img.data[q] = 255;
        img.data[q + 1] = 246;
        img.data[q + 2] = 214;
        img.data[q + 3] = Math.min(40, v * 300);
      }
    }
    g.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, this.live.width, this.live.height);
    ctx.restore();
  }

  // ---------- each frame ----------

  draw(ctx: CanvasRenderingContext2D, o: Overlay, time: number): void {
    const key = `${Math.round(o.sun.azimuth / 1.5)}:${Math.round(o.sun.altitude / 1.5)}`;
    if (key !== this.sunKey) {
      this.sunKey = key;
      this.renderLive(o.sun);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    ctx.drawImage(this.live, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const [hx, hy] = this.toScreen(0, 0);

    for (const p of o.found) this.outline(ctx, p.ring, 'rgba(255, 255, 255, 0.75)', [3, 3], 1.4);

    // The sun's line from the hive to the edge of the map.
    const az = (o.sun.azimuth * Math.PI) / 180;
    const ux = Math.sin(az);
    const uy = -Math.cos(az);
    const reach = this.edgeReach(ux, uy, 26);
    if (o.sunRay > 0) {
      ctx.save();
      ctx.globalAlpha = o.sunRay;
      ctx.setLineDash([7, 6]);
      ctx.lineDashOffset = -time * 0.012;
      ctx.strokeStyle = 'rgba(120, 70, 0, 0.45)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + ux * reach, hy + uy * reach);
      ctx.stroke();
      ctx.strokeStyle = '#ffcf5a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    this.sunGlyph(ctx, hx + ux * reach, hy + uy * reach, time);

    if (o.feeder) {
      const [fx, fy] = this.toScreen(o.feeder[0], o.feeder[1]);
      ctx.beginPath();
      ctx.arc(fx, fy, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#3d6fd8';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(fx, fy, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#cfe0ff';
      ctx.fill();
      label(ctx, 'feeder', fx, fy + 20, '#2b1d0e');
    }

    if (o.reveal) {
      const { patch, good } = o.reveal;
      const colour = good ? '#ffffff' : '#ff9a5c';
      const [px, py] = this.toScreen(patch.center[0], patch.center[1]);
      if (!good) {
        ctx.save();
        ctx.setLineDash([2, 5]);
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#c0542b';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.restore();
      }
      this.outline(ctx, patch.ring, colour, good ? [] : [6, 4], 2.6);
      if (patch.id >= 0) {
        const d = Math.hypot(patch.center[0], patch.center[1]) || 1;
        const off = this.ringRadius(patch.ring) * this.s + 16;
        const lx = px + (patch.center[0] / d) * off;
        const ly = py + (patch.center[1] / d) * off + 4;
        label(ctx, patch.plant.name, lx, ly, '#2b1d0e', true);
      }
    }

    // The mark, its line from the hive, and the angle it makes with the sun.
    if (o.mark) {
      const [mx, my] = this.toScreen(o.mark[0], o.mark[1]);
      if (o.searchRadius > 0) {
        ctx.beginPath();
        ctx.arc(mx, my, o.searchRadius * this.s, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(47, 95, 208, 0.12)';
        ctx.fill();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(47, 95, 208, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(mx, my);
      ctx.stroke();
      ctx.strokeStyle = '#2f5fd0';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      if (o.showAngle) this.angleArc(ctx, hx, hy, az, Math.atan2(my - hy, mx - hx) + Math.PI / 2);
      ctx.beginPath();
      ctx.arc(mx, my, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#2f5fd0';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#2f5fd0';
      ctx.fill();
    }

    // Bees in flight with their trails.
    for (const f of o.flyers) {
      if (f.trail.length > 1) {
        ctx.save();
        ctx.setLineDash([1.5, 5]);
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(43, 29, 14, 0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        f.trail.forEach(([x, y], i) => {
          const [px, py] = this.toScreen(x, y);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.restore();
      }
      const [bx, by] = this.toScreen(f.x, f.y);
      ctx.beginPath();
      ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff8e6';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx, by, 4, 0, Math.PI * 2);
      ctx.fillStyle = f.color;
      ctx.fill();
      ctx.fillStyle = '#2b1d0e';
      ctx.fillRect(bx - 4, by - 0.8, 8, 1.6);
    }

    // The apiary.
    ctx.beginPath();
    ctx.arc(hx, hy, 11, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(43, 29, 14, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(hx, hy, 12.6, 0, Math.PI * 2);
    ctx.stroke();
    label(ctx, 'hive', hx, hy + 25, '#2b1d0e');

    this.scaleBar(ctx);
  }

  /** How far a ray from the hive can go before it leaves the map, less a margin. */
  edgeReach(ux: number, uy: number, margin: number): number {
    const [hx, hy] = this.toScreen(0, 0);
    let t = Infinity;
    if (ux > 1e-6) t = Math.min(t, (this.w - margin - hx) / ux);
    if (ux < -1e-6) t = Math.min(t, (margin - hx) / ux);
    if (uy > 1e-6) t = Math.min(t, (this.h - margin - hy) / uy);
    if (uy < -1e-6) t = Math.min(t, (margin - hy) / uy);
    return t;
  }

  private ringRadius(ring: Ring): number {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of ring) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return (maxY - minY) / 2;
  }

  private outline(ctx: CanvasRenderingContext2D, ring: Ring, colour: string, dash: number[], width: number): void {
    ctx.save();
    ctx.beginPath();
    ring.forEach(([x, y], i) => {
      const [px, py] = this.toScreen(x, y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(43, 29, 14, 0.55)';
    ctx.lineWidth = width + 2;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  }

  private angleArc(ctx: CanvasRenderingContext2D, hx: number, hy: number, sunA: number, markA: number): void {
    // Angles here are compass radians (clockwise from north); canvas arcs start at east.
    let d = markA - sunA;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const r = 44;
    const a0 = sunA - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(hx, hy, r, a0, a0 + d, d < 0);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = '#2b1d0e';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const mid = a0 + d / 2;
    const deg = Math.round(Math.abs((d * 180) / Math.PI));
    label(ctx, `${deg}°`, hx + Math.cos(mid) * (r + 16), hy + Math.sin(mid) * (r + 16) + 4, '#2b1d0e', true);
  }

  private sunGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 0.00015);
    ctx.strokeStyle = '#b8731b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = 12;
      const r1 = i % 2 ? 16 : 19;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
    const g = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 10);
    g.addColorStop(0, '#fff3b0');
    g.addColorStop(1, '#f0a62a');
    ctx.beginPath();
    ctx.arc(x, y, 9.5, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#b8731b';
    ctx.stroke();
  }

  private scaleBar(ctx: CanvasRenderingContext2D): void {
    const m = 1000;
    const len = m * this.s;
    const x = this.w - 30 - len;
    const y = 26;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 250, 238, 0.85)';
    roundRect(ctx, x - 40, y - 15, len + 62, 30, 8);
    ctx.fill();
    ctx.fillStyle = '#2b1d0e';
    ctx.fillRect(x, y, len / 2, 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + len / 2, y, len / 2, 4);
    ctx.strokeStyle = '#2b1d0e';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, len, 4);
    ctx.font = '600 10px ' + fontOf(ctx);
    ctx.textAlign = 'center';
    ctx.fillText('0', x, y - 4);
    ctx.fillText('500 m', x + len / 2, y - 4);
    ctx.fillText('1 km', x + len, y - 4);
    // North arrow.
    const nx = x - 24;
    ctx.beginPath();
    ctx.moveTo(nx, y - 10);
    ctx.lineTo(nx + 5, y + 6);
    ctx.lineTo(nx, y + 3);
    ctx.lineTo(nx - 5, y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.font = '700 9px ' + fontOf(ctx);
    ctx.fillText('N', nx, y + 15);
    ctx.restore();
  }
}

let cachedFont = '';
function fontOf(ctx: CanvasRenderingContext2D): string {
  if (!cachedFont) {
    const root = (ctx.canvas as HTMLCanvasElement).closest?.('.waggle');
    const v = root ? getComputedStyle(root).getPropertyValue('--font-wg-text').trim() : '';
    cachedFont = v ? `${v}, sans-serif` : 'sans-serif';
  }
  return cachedFont;
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colour: string,
  strong = false,
): void {
  ctx.save();
  ctx.font = `${strong ? 700 : 600} ${strong ? 13 : 11}px ${fontOf(ctx)}`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255, 250, 238, 0.92)';
  ctx.lineWidth = 4;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function between01(rng: Rng, a: number, b: number): number {
  return a + (b - a) * rng();
}

function speckle(
  g: CanvasRenderingContext2D,
  W: number,
  H: number,
  d: number,
  rng: Rng,
  dots: [string, number, number][],
): void {
  for (const [colour, count, size] of dots) {
    g.fillStyle = colour;
    const n = Math.round((count * W * H) / (128 * 128 * d * d));
    for (let i = 0; i < n; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const r = size * d * (0.6 + rng() * 0.8);
      for (const [ox, oy] of [
        [0, 0],
        [-W, 0],
        [W, 0],
        [0, -H],
        [0, H],
      ]) {
        const px = x + ox;
        const py = y + oy;
        if (px + r < 0 || px - r > W || py + r < 0 || py - r > H) continue;
        g.beginPath();
        g.arc(px, py, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

function rect(b: { x: number; y: number; w: number; d: number; a: number }): Ring {
  const ca = Math.cos(b.a);
  const sa = Math.sin(b.a);
  const hw = b.w / 2;
  const hd = b.d / 2;
  return [
    [b.x - ca * hw + sa * hd, b.y - sa * hw - ca * hd],
    [b.x + ca * hw + sa * hd, b.y + sa * hw - ca * hd],
    [b.x + ca * hw - sa * hd, b.y + sa * hw + ca * hd],
    [b.x - ca * hw - sa * hd, b.y - sa * hw + ca * hd],
  ];
}

function hull(points: Pt[]): Ring {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
