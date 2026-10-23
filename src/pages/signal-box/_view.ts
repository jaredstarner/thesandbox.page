// Signal box: the view from the box's front windows.
//
// Three panes, each its own perspective camera turned a little further along the
// line, so the sashes between them hide the seams: west down the line to the
// home signals, straight out over the junction, and east where the branch curves
// away to Pell Wood. Ground, track, hedges, and hills are drawn once into a
// cached layer; signals, trains, and smoke are drawn over it every frame.

import { DOWN_Y, PATH_SIGNALS, UP_Y, pathPoint, type PathId } from './_layout';
import type { Box, Train } from './_sim';
import { rng, type ShiftId, type Vehicle } from './_timetable';

type V3 = [number, number, number];

const CAM: V3 = [0, -4, 7.5];
const PITCH = (-8.5 * Math.PI) / 180;
const PANES = [
  { y0: -90, y1: -33 },
  { y0: -33, y1: 33 },
  { y0: 33, y1: 90 },
];
/** Signals drawn a little larger than life, so their arms read at this distance. */
const SIG_SCALE = 1.45;

interface Pane {
  x: number;
  w: number;
  h: number;
  yaw: number;
  f: number;
  cosY: number;
  sinY: number;
}

interface Palette {
  skyTop: string;
  skyMid: string;
  skyLow: string;
  haze: string;
  hills: [string, string, string];
  field: string[];
  hedge: string;
  tree: string;
  treeDark: string;
  ground: string;
  ballast: string;
  ballastDark: string;
  sleeper: string;
  rail: string;
  railShine: string;
  post: string;
  light: number;
  night: boolean;
  sun: { yaw: number; el: number; colour: string } | null;
  moon: boolean;
}

const PALETTES: Record<ShiftId, Palette> = {
  early: {
    skyTop: '#33416b',
    skyMid: '#a77d8c',
    skyLow: '#f2b27a',
    haze: '#d9b79e',
    hills: ['#7d7389', '#62627a', '#4b5262'],
    field: ['#5d6d55', '#6c7454', '#58664f', '#7a7559', '#686e50', '#4f5f4b'],
    hedge: '#2f3b30',
    tree: '#35443a',
    treeDark: '#243128',
    ground: '#5c6650',
    ballast: '#8d837c',
    ballastDark: '#5f5953',
    sleeper: '#3f3129',
    rail: '#4c4846',
    railShine: '#f6c9a2',
    post: '#d9d3c7',
    light: 0.72,
    night: false,
    sun: { yaw: 72, el: 1.4, colour: '#ffd39a' },
    moon: false,
  },
  day: {
    skyTop: '#5f8fc4',
    skyMid: '#9fbfdc',
    skyLow: '#dbe5e6',
    haze: '#c9d6d6',
    hills: ['#93a6a6', '#7b9184', '#647b62'],
    field: ['#7b9a52', '#8fa45b', '#6f8a4a', '#b5a463', '#9a9a5a', '#62803f'],
    hedge: '#3c5a2e',
    tree: '#446b35',
    treeDark: '#2e4c25',
    ground: '#7c9251',
    ballast: '#a49b92',
    ballastDark: '#79716a',
    sleeper: '#4a3a2e',
    rail: '#55524f',
    railShine: '#e8eef2',
    post: '#ecebe6',
    light: 1,
    night: false,
    sun: null,
    moon: false,
  },
  night: {
    skyTop: '#05070f',
    skyMid: '#0d1426',
    skyLow: '#1a2438',
    haze: '#1d2638',
    hills: ['#141b2a', '#10151f', '#0c1018'],
    field: ['#121a19', '#141c1a', '#101716', '#171d1a', '#131a17', '#0f1514'],
    hedge: '#080c0c',
    tree: '#0b100f',
    treeDark: '#070a0a',
    ground: '#111816',
    ballast: '#2a2a2c',
    ballastDark: '#1a1a1c',
    sleeper: '#141110',
    rail: '#1e1e20',
    railShine: '#6c7590',
    post: '#4c5160',
    light: 0.25,
    night: true,
    sun: null,
    moon: true,
  },
};

/** Channels of a #rrggbb or rgb() colour. */
function channels(col: string): number[] {
  if (col.startsWith('#')) {
    const n = parseInt(col.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return (col.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
}

function mix(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  const out = ca.map((v, i) => Math.round(Math.min(255, Math.max(0, v + (cb[i] - v) * t))));
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

interface Field {
  pts: [number, number][];
  colour: string;
  d: number;
  /** Plough lines run this way across the field, in radians; null for grass. */
  furrow: number | null;
}

interface Building {
  x: number;
  y: number;
  /** Width along X, depth along Y, wall height, and the roof's rise to its ridge. */
  w: number;
  d: number;
  h: number;
  rise: number;
  wall: string;
  roof: string;
  /** A tower with a short spire. */
  tower?: boolean;
}

interface Sig {
  n: number;
  x: number;
  y: number;
  fwd: [number, number];
  left: [number, number];
  a: number;
  h: number;
}

interface Upright {
  x: number;
  y: number;
  kind: 'tree' | 'pole' | 'bush' | 'hut' | 'sheep';
  h: number;
  r: number;
  v: number;
}

interface Puff {
  x: number;
  y: number;
  z: number;
  r: number;
  age: number;
  life: number;
  vx: number;
  vz: number;
}

export class View {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private panes: Pane[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;
  private shift: ShiftId = 'early';
  private pal: Palette = PALETTES.early;
  private fields: Field[] = [];
  private buildings: Building[] = [];
  private uprights: Upright[] = [];
  private stars: [number, number, number][] = [];
  private bgStamp = '';
  private puffs: Puff[] = [];
  private arms = new Map<number, number>();
  private lastPuff = new Map<number, number>();
  /** How far the early turn's dawn has come, 0 to 1. */
  private dawn = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.bg = document.createElement('canvas');
    this.build();
  }

  setShift(id: ShiftId): void {
    this.shift = id;
    this.pal = PALETTES[id];
    this.bgStamp = '';
    this.puffs = [];
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, Math.round(r.width * this.dpr));
    this.h = Math.max(1, Math.round(r.height * this.dpr));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.bg.width = this.w;
    this.bg.height = this.h;
    const mull = Math.round(12 * this.dpr);
    const total = this.w - mull * 2;
    const span = PANES.reduce((a, p) => a + (p.y1 - p.y0), 0);
    let x = 0;
    this.panes = PANES.map((p) => {
      const pw = Math.round(((p.y1 - p.y0) / span) * total);
      const yaw = (((p.y0 + p.y1) / 2) * Math.PI) / 180;
      const fov = ((p.y1 - p.y0) * Math.PI) / 180;
      const pane: Pane = {
        x,
        w: pw,
        h: this.h,
        yaw,
        f: pw / 2 / Math.tan(fov / 2),
        cosY: Math.cos(yaw),
        sinY: Math.sin(yaw),
      };
      x += pw + mull;
      return pane;
    });
    this.bgStamp = '';
  }

  /** Project a ground point into a pane; null when behind the camera. */
  private proj(p: Pane, x: number, y: number, z: number): [number, number, number] | null {
    const dx = x - CAM[0];
    const dy = y - CAM[1];
    const dz = z - CAM[2];
    // Turn to the pane's heading (yaw from north toward east), then tip down by the pitch.
    const right = dx * p.cosY - dy * p.sinY;
    const fwd = dx * p.sinY + dy * p.cosY;
    const cp = Math.cos(PITCH);
    const sp = Math.sin(PITCH);
    const zc = fwd * cp + dz * sp;
    const yc = dz * cp - fwd * sp;
    if (zc < 0.4) return null;
    return [p.x + p.w / 2 + (p.f * right) / zc, p.h * 0.5 - (p.f * yc) / zc, zc];
  }

  /** Screen point for a direction (yaw, elevation in degrees) at infinity. */
  private dirProj(p: Pane, yawDeg: number, elDeg: number): [number, number] | null {
    const yw = (yawDeg * Math.PI) / 180;
    const e = (elDeg * Math.PI) / 180;
    const r = 1e6;
    const q = this.proj(
      p,
      CAM[0] + Math.sin(yw) * Math.cos(e) * r,
      CAM[1] + Math.cos(yw) * Math.cos(e) * r,
      CAM[2] + Math.sin(e) * r,
    );
    return q ? [q[0], q[1]] : null;
  }

  private build(): void {
    const r = rng(1964);
    // A patchwork of fields either side of the line, larger with distance.
    const bands = [26, 48, 90, 150, 240, 380, 600, 950, 1500, 2400];
    for (let b = 0; b < bands.length - 1; b++) {
      for (const side of [1, -1]) {
        const ya = side > 0 ? bands[b] : -bands[b] * 0.8 - 2;
        const yb = side > 0 ? bands[b + 1] : -bands[b + 1] * 0.8 - 2;
        let x = -3200;
        while (x < 3200) {
          const wdt = (60 + r() * 140) * (1 + bands[b] / 160);
          const x2 = x + wdt;
          const j = () => (r() - 0.5) * wdt * 0.25;
          const pts: [number, number][] = [
            [x + j(), ya],
            [x2 + j(), ya],
            [x2 + j(), yb],
            [x + j(), yb],
          ];
          if (side < 0 && Math.abs(ya) < 8) {
            pts[0][1] = Math.min(pts[0][1], UP_Y - 3.5);
            pts[1][1] = Math.min(pts[1][1], UP_Y - 3.5);
          }
          this.fields.push({ pts, colour: '', d: 0, furrow: null });
          // Hedgerow trees along the field's near edge.
          if (r() < 0.7) {
            const n = 1 + Math.floor(r() * 4);
            for (let k = 0; k < n; k++)
              this.uprights.push({
                x: x + r() * wdt,
                y: ya + (r() - 0.5) * 4,
                kind: 'tree',
                h: 8 + r() * 10,
                r: 3 + r() * 4,
                v: r(),
              });
          }
          if (r() < 0.6) {
            for (let k = 0; k < 5; k++)
              this.uprights.push({ x: x + r() * wdt, y: ya, kind: 'bush', h: 2 + r() * 1.5, r: 2 + r() * 2, v: r() });
          }
          x = x2;
        }
      }
    }
    // Pell Wood, where the branch goes, and a copse to the west.
    for (let k = 0; k < 70; k++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 160;
      this.uprights.push({
        x: 900 + Math.cos(a) * d * 1.6,
        y: 560 + Math.sin(a) * d,
        kind: 'tree',
        h: 12 + r() * 9,
        r: 5 + r() * 4,
        v: r(),
      });
    }
    for (let k = 0; k < 26; k++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 60;
      this.uprights.push({
        x: -620 + Math.cos(a) * d * 1.5,
        y: 120 + Math.sin(a) * d,
        kind: 'tree',
        h: 10 + r() * 7,
        r: 4 + r() * 3,
        v: r(),
      });
    }
    // The telegraph route along the north side of the line.
    for (let x = -1600; x <= 1600; x += 55) {
      if (Math.abs(x) < 12) continue;
      this.uprights.push({ x, y: DOWN_Y + 6.5, kind: 'pole', h: 8, r: 0.14, v: 0 });
    }
    // Sheep grazing the pasture beyond the line.
    for (let k = 0; k < 16; k++)
      this.uprights.push({ x: -70 + r() * 150, y: 58 + r() * 30, kind: 'sheep', h: 0.8, r: 0.55, v: r() });
    // Farms, a railway cottage, and a church on the skyline.
    const farm = (x: number, y: number) => {
      this.buildings.push({ x, y, w: 11, d: 7, h: 5.5, rise: 3.2, wall: '#cdbb9a', roof: '#6b4a3a' });
      this.buildings.push({ x: x + 16, y: y + 6, w: 18, d: 9, h: 6, rise: 2.6, wall: '#7b5038', roof: '#4d4c4a' });
      for (let k = 0; k < 5; k++)
        this.uprights.push({
          x: x - 10 + r() * 40,
          y: y + 14 + r() * 10,
          kind: 'tree',
          h: 11 + r() * 6,
          r: 4 + r() * 2,
          v: r(),
        });
    };
    farm(55, 240);
    farm(-260, 420);
    farm(420, 900);
    this.buildings.push({ x: -150, y: 36, w: 8, d: 6, h: 5, rise: 2.8, wall: '#b8805a', roof: '#3f3a38' });
    this.buildings.push({
      x: -720,
      y: 1900,
      w: 7,
      d: 7,
      h: 19,
      rise: 9,
      wall: '#a7a091',
      roof: '#55524d',
      tower: true,
    });
    this.buildings.push({ x: -706, y: 1896, w: 22, d: 10, h: 9, rise: 4, wall: '#a7a091', roof: '#5c5853' });
    // A platelayers' hut by the up line.
    this.uprights.push({ x: -62, y: UP_Y - 6.5, kind: 'hut', h: 2.6, r: 2, v: 0 });
    // Keep the tracks clear of trees, and the nearest fields clear of anything that would fill a pane.
    this.uprights = this.uprights.filter((u) => {
      if (u.kind === 'tree' && nearTrack(u.x, u.y, 14)) return false;
      if ((u.kind === 'tree' || u.kind === 'bush') && Math.hypot(u.x - CAM[0], u.y - CAM[1]) < 130) return false;
      return true;
    });
    for (const f of this.fields) {
      f.colour = String(Math.floor(r() * 6));
      if (f.colour === '3' || f.colour === '1') f.furrow = r() < 0.5 ? 0 : Math.PI / 2;
      const cx = f.pts.reduce((a, p) => a + p[0], 0) / 4;
      const cy = f.pts.reduce((a, p) => a + p[1], 0) / 4;
      f.d = Math.hypot(cx - CAM[0], cy - CAM[1]);
    }
    this.fields.sort((a, b) => b.d - a.d);
    for (let k = 0; k < 220; k++) this.stars.push([r() * 180 - 90, 2 + Math.pow(r(), 1.6) * 40, r()]);
  }

  /** Draw the static scene into the cached layer for this size, shift, and light. */
  private drawBackground(): void {
    const c = this.bg.getContext('2d')!;
    const pal = this.pal;
    c.clearRect(0, 0, this.w, this.h);
    for (const p of this.panes) {
      c.save();
      c.beginPath();
      c.rect(p.x, 0, p.w, p.h);
      c.clip();
      this.drawSky(c, p);
      this.drawHills(c, p);
      // Ground under everything.
      const hz = this.dirProj(p, (p.yaw * 180) / Math.PI, 0);
      const hy = hz ? hz[1] : 0;
      const g = c.createLinearGradient(0, hy, 0, p.h);
      g.addColorStop(0, mix(pal.haze, pal.ground, 0.3));
      g.addColorStop(0.25, pal.ground);
      g.addColorStop(1, mix(pal.ground, '#000000', 0.18));
      c.fillStyle = g;
      c.fillRect(p.x, hy, p.w, p.h - hy);
      for (const f of this.fields) this.drawField(c, p, f);
      this.drawCanal(c, p);
      this.drawTrack(c, p);
      // Point rodding from the box along the cess to the junction.
      c.strokeStyle = pal.night ? '#1a1a1a' : '#47413b';
      c.lineWidth = Math.max(0.8, 0.9 * this.dpr);
      for (const off of [0, 0.3, 0.6])
        this.groundLine(
          c,
          p,
          [
            [1.5 + off, 7.2],
            [2.5 + off, 8.1 + off],
            [28, 8.1 + off],
            [30 + off, UP_Y - 1.4],
          ],
          0.25,
        );
      this.drawFence(c, p);
      // Far uprights: trees, bushes, poles, and the hut beyond the near track are part of the scene.
      const ups = this.uprights
        .map((u) => ({ u, d: Math.hypot(u.x - CAM[0], u.y - CAM[1]) }))
        .sort((a, b) => b.d - a.d);
      for (const { u } of ups) this.drawUpright(c, p, u);
      for (const bd of this.buildings
        .map((bd) => ({ bd, d: Math.hypot(bd.x - CAM[0], bd.y - CAM[1]) }))
        .sort((a, b) => b.d - a.d))
        this.drawBuilding(c, p, bd.bd);
      this.drawWires(c, p);
      c.restore();
    }
  }

  private drawSky(c: CanvasRenderingContext2D, p: Pane): void {
    const pal = this.pal;
    const top = this.dirProj(p, (p.yaw * 180) / Math.PI, 40);
    const hz = this.dirProj(p, (p.yaw * 180) / Math.PI, 0);
    const ty = top ? top[1] : 0;
    const hy = hz ? hz[1] : p.h * 0.4;
    const g = c.createLinearGradient(0, ty, 0, hy);
    const d = this.shift === 'early' ? this.dawn : 0;
    g.addColorStop(0, d ? mix(pal.skyTop, '#5a74a4', d) : pal.skyTop);
    g.addColorStop(0.62, d ? mix(pal.skyMid, '#d8b7a6', d) : pal.skyMid);
    g.addColorStop(1, d ? mix(pal.skyLow, '#fbd6a2', d) : pal.skyLow);
    c.fillStyle = g;
    c.fillRect(p.x, 0, p.w, hy + 2);
    if (this.pal.night) {
      for (const [yw, e, b] of this.stars) {
        const q = this.dirProj(p, yw, e);
        if (!q || q[0] < p.x || q[0] > p.x + p.w) continue;
        c.fillStyle = `rgba(230,235,255,${0.25 + b * 0.6})`;
        const s = (0.5 + b * 1.1) * this.dpr;
        c.fillRect(q[0], q[1], s, s);
      }
    }
    if (this.pal.sun) {
      const s = this.pal.sun;
      const q = this.dirProj(p, s.yaw, s.el + this.dawn * 4.5);
      if (q) {
        const rad = 120 * this.dpr;
        const gl = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], rad * 2.4);
        gl.addColorStop(0, 'rgba(255,226,170,0.85)');
        gl.addColorStop(0.15, 'rgba(255,200,140,0.35)');
        gl.addColorStop(1, 'rgba(255,190,140,0)');
        c.fillStyle = gl;
        c.fillRect(p.x, 0, p.w, hy + 4);
        c.fillStyle = s.colour;
        c.beginPath();
        c.arc(q[0], q[1], 9 * this.dpr, 0, Math.PI * 2);
        c.fill();
      }
    }
    if (this.pal.moon) {
      const q = this.dirProj(p, -48, 24);
      if (q) {
        const gl = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], 60 * this.dpr);
        gl.addColorStop(0, 'rgba(200,210,240,0.25)');
        gl.addColorStop(1, 'rgba(200,210,240,0)');
        c.fillStyle = gl;
        c.fillRect(q[0] - 60 * this.dpr, q[1] - 60 * this.dpr, 120 * this.dpr, 120 * this.dpr);
        c.fillStyle = '#e8e6da';
        c.beginPath();
        c.arc(q[0], q[1], 7 * this.dpr, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = this.pal.skyMid;
        c.beginPath();
        c.arc(q[0] + 3 * this.dpr, q[1] - 2 * this.dpr, 6.2 * this.dpr, 0, Math.PI * 2);
        c.fill();
      }
    }
    if (!this.pal.night) {
      // A few long clouds, lit from below at dawn.
      const r = rng(77);
      for (let k = 0; k < 9; k++) {
        const yw = r() * 180 - 90;
        const e = 6 + r() * 16;
        const q = this.dirProj(p, yw, e);
        if (!q) continue;
        const len = (60 + r() * 160) * this.dpr;
        const th = (6 + r() * 10) * this.dpr;
        c.fillStyle =
          this.shift === 'early' ? `rgba(255,${190 + Math.round(r() * 30)},170,0.32)` : 'rgba(255,255,255,0.55)';
        for (let i = 0; i < 4; i++) {
          c.beginPath();
          c.ellipse(
            q[0] + (i - 1.5) * len * 0.28,
            q[1] + (r() - 0.5) * th,
            len * 0.3,
            th * (0.6 + r() * 0.5),
            0,
            0,
            Math.PI * 2,
          );
          c.fill();
        }
      }
    }
  }

  private drawHills(c: CanvasRenderingContext2D, p: Pane): void {
    const layers = [
      { h: 2.2, f: [0.04, 0.11, 0.023], ph: [0.3, 1.7, 2.9], col: this.pal.hills[0] },
      { h: 1.5, f: [0.06, 0.17, 0.031], ph: [2.1, 0.4, 1.1], col: this.pal.hills[1] },
      { h: 0.9, f: [0.09, 0.23, 0.05], ph: [1.3, 2.2, 0.2], col: this.pal.hills[2] },
    ];
    const y0 = (p.yaw * 180) / Math.PI - 40;
    const y1 = (p.yaw * 180) / Math.PI + 40;
    for (const L of layers) {
      c.fillStyle = L.col;
      c.beginPath();
      let first = true;
      for (let yw = y0; yw <= y1; yw += 0.5) {
        const e =
          L.h * (0.55 + 0.45 * Math.sin(yw * L.f[0] + L.ph[0])) +
          L.h * 0.35 * Math.sin(yw * L.f[1] + L.ph[1]) +
          L.h * 0.5 * Math.sin(yw * L.f[2] + L.ph[2]);
        const q = this.dirProj(p, yw, Math.max(0.15, e));
        if (!q) continue;
        if (first) {
          c.moveTo(q[0], q[1]);
          first = false;
        } else c.lineTo(q[0], q[1]);
      }
      const hz = this.dirProj(p, y1, -0.2);
      const hz0 = this.dirProj(p, y0, -0.2);
      if (hz && hz0) {
        c.lineTo(hz[0], hz[1] + 6);
        c.lineTo(hz0[0], hz0[1] + 6);
      }
      c.closePath();
      c.fill();
    }
  }

  private drawField(c: CanvasRenderingContext2D, p: Pane, f: Field): void {
    const pal = this.pal;
    const pts: [number, number][] = [];
    // Subdivide each edge so near fields bend properly in perspective.
    for (let i = 0; i < 4; i++) {
      const a = f.pts[i];
      const b = f.pts[(i + 1) % 4];
      for (let k = 0; k < 6; k++) {
        const t = k / 6;
        const q = this.proj(p, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0);
        if (q) pts.push([q[0], q[1]]);
      }
    }
    if (pts.length < 3) return;
    const minX = Math.min(...pts.map((q) => q[0]));
    const maxX = Math.max(...pts.map((q) => q[0]));
    if (maxX < p.x || minX > p.x + p.w) return;
    const haze = Math.min(0.85, Math.pow(f.d / 2600, 0.7));
    c.fillStyle = mix(pal.field[Number(f.colour)], pal.haze, haze * (pal.night ? 0.3 : 0.75));
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts) c.lineTo(q[0], q[1]);
    c.closePath();
    c.fill();
    if (f.furrow !== null && f.d < 900) {
      c.save();
      c.clip();
      c.strokeStyle = pal.night ? 'rgba(0,0,0,0.25)' : 'rgba(40,30,20,0.13)';
      c.lineWidth = Math.max(0.5, (1.2 * this.dpr * 200) / Math.max(200, f.d));
      const xs = f.pts.map((q) => q[0]);
      const ys = f.pts.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const step = 7;
      if (f.furrow === 0)
        for (let y = y0; y < y1; y += step)
          this.groundLine(
            c,
            p,
            [
              [x0, y],
              [x1, y],
            ],
            0.02,
          );
      else
        for (let x = x0; x < x1; x += step)
          this.groundLine(
            c,
            p,
            [
              [x, y0],
              [x, y1],
            ],
            0.02,
          );
      c.restore();
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (const q of pts) c.lineTo(q[0], q[1]);
      c.closePath();
    }
    c.strokeStyle = mix(pal.hedge, pal.haze, haze * 0.6);
    c.lineWidth = Math.max(0.6, (2.2 * this.dpr * 180) / Math.max(180, f.d));
    c.stroke();
  }

  private groundLine(c: CanvasRenderingContext2D, p: Pane, line: [number, number][], z = 0.05): void {
    c.beginPath();
    let on = false;
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const q = this.proj(p, ax + (bx - ax) * t, ay + (by - ay) * t, z);
        if (!q) {
          on = false;
          continue;
        }
        if (!on) c.moveTo(q[0], q[1]);
        else c.lineTo(q[0], q[1]);
        on = true;
      }
    }
    c.stroke();
  }

  /** Sample a path's centre line, finely near the box and coarsely far away. */
  private sample(path: PathId, s0: number, s1: number): { x: number; y: number; h: number }[] {
    const out: { x: number; y: number; h: number }[] = [];
    let s = s0;
    while (s < s1) {
      const q = pathPoint(path, s);
      out.push(q);
      const d = Math.hypot(q.x - CAM[0], q.y - CAM[1]);
      s += Math.max(1.5, Math.min(40, d * 0.06));
    }
    out.push(pathPoint(path, s1));
    return out;
  }

  private drawTrack(c: CanvasRenderingContext2D, p: Pane): void {
    const pal = this.pal;
    const runs: [PathId, number, number][] = [
      ['DM', 0, 3000],
      ['UM', 0, 3000],
      ['DB', 1530, 3000],
      ['UB', 0, 1470],
    ];
    // Ballast shoulders first, then sleepers, then rails, all in one pass per run.
    const strip = (pts: { x: number; y: number; h: number }[], w0: number, w1: number, z: number) => {
      const left: [number, number][] = [];
      const right: [number, number][] = [];
      for (const q of pts) {
        const nx = -Math.sin(q.h);
        const ny = Math.cos(q.h);
        const a = this.proj(p, q.x + nx * w0, q.y + ny * w0, z);
        const b = this.proj(p, q.x + nx * w1, q.y + ny * w1, z);
        if (a && b) {
          left.push([a[0], a[1]]);
          right.push([b[0], b[1]]);
        }
      }
      if (left.length < 2) return;
      c.beginPath();
      c.moveTo(left[0][0], left[0][1]);
      for (const q of left) c.lineTo(q[0], q[1]);
      for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
      c.closePath();
      c.fill();
    };
    for (const [path, a, b] of runs.slice(0, 2)) {
      const pts = this.sample(path, a, b);
      c.fillStyle = mix(pal.ballast, pal.ground, 0.45);
      strip(pts, path === 'DM' ? 2.2 : -3.6, path === 'DM' ? 3.6 : -2.2, 0.01);
    }
    for (const [path, a, b] of runs) {
      const pts = this.sample(path, a, b);
      c.fillStyle = pal.ballastDark;
      strip(pts, -2.3, 2.3, 0.02);
      c.fillStyle = pal.ballast;
      strip(pts, -1.75, 1.75, 0.22);
    }
    for (const [path, a, b] of runs) {
      // Sleepers where they can be seen one by one.
      c.fillStyle = pal.sleeper;
      for (let s = a; s < b; s += 0.72) {
        const q = pathPoint(path, s);
        const d = Math.hypot(q.x - CAM[0], q.y - CAM[1]);
        if (d > 140) {
          s += Math.min(20, d * 0.05);
          continue;
        }
        const nx = -Math.sin(q.h);
        const ny = Math.cos(q.h);
        const tx = Math.cos(q.h) * 0.13;
        const ty = Math.sin(q.h) * 0.13;
        const corners = [
          this.proj(p, q.x + nx * 1.3 - tx, q.y + ny * 1.3 - ty, 0.25),
          this.proj(p, q.x + nx * 1.3 + tx, q.y + ny * 1.3 + ty, 0.25),
          this.proj(p, q.x - nx * 1.3 + tx, q.y - ny * 1.3 + ty, 0.25),
          this.proj(p, q.x - nx * 1.3 - tx, q.y - ny * 1.3 - ty, 0.25),
        ];
        if (corners.some((k) => !k)) continue;
        c.beginPath();
        c.moveTo(corners[0]![0], corners[0]![1]);
        for (const k of corners) c.lineTo(k![0], k![1]);
        c.closePath();
        c.fill();
      }
    }
    for (const [path, a, b] of runs) {
      const pts = this.sample(path, a, b);
      for (const side of [-0.72, 0.72]) {
        c.strokeStyle = pal.rail;
        c.lineWidth = Math.max(1, 1.6 * this.dpr);
        const line: [number, number][] = pts.map((q) => [q.x - Math.sin(q.h) * side, q.y + Math.cos(q.h) * side]);
        this.groundLine(c, p, line, 0.32);
        c.strokeStyle = pal.railShine;
        c.globalAlpha = pal.night ? 0.35 : 0.55;
        c.lineWidth = Math.max(0.5, 0.7 * this.dpr);
        this.groundLine(c, p, line, 0.36);
        c.globalAlpha = 1;
      }
    }
  }

  private drawUpright(c: CanvasRenderingContext2D, p: Pane, u: Upright): void {
    const pal = this.pal;
    const base = this.proj(p, u.x, u.y, 0);
    if (!base) return;
    const top = this.proj(p, u.x, u.y, u.h);
    if (!top) return;
    const k = p.f / base[2];
    if (base[0] < p.x - 200 || base[0] > p.x + p.w + 200) return;
    const d = Math.hypot(u.x - CAM[0], u.y - CAM[1]);
    const haze = Math.min(0.85, Math.pow(d / 2600, 0.7)) * (pal.night ? 0.3 : 0.75);
    if (u.kind === 'tree' || u.kind === 'bush') {
      const r = u.r * k;
      if (r < 0.4) return;
      const trunk = u.kind === 'tree' ? u.h * 0.35 * k : 0;
      c.fillStyle = mix(pal.treeDark, pal.haze, haze);
      if (trunk > 1) c.fillRect(base[0] - Math.max(0.6, 0.25 * k), base[1] - trunk, Math.max(1.2, 0.5 * k), trunk);
      const cy = base[1] - (u.kind === 'tree' ? u.h * k * 0.62 : r * 0.7);
      const rr = rng(Math.floor(u.v * 1e6));
      for (let i = 0; i < 6; i++) {
        const ox = (rr() - 0.5) * r * 1.3;
        const oy = (rr() - 0.5) * r * (u.kind === 'tree' ? 1.5 : 0.6);
        c.fillStyle = mix(i < 3 ? pal.treeDark : pal.tree, pal.haze, haze);
        c.beginPath();
        c.ellipse(
          base[0] + ox,
          cy + oy,
          r * (0.55 + rr() * 0.35),
          r * (0.5 + rr() * 0.3) * (u.kind === 'tree' ? 1.1 : 0.7),
          0,
          0,
          Math.PI * 2,
        );
        c.fill();
      }
      if (!pal.night && this.shift !== 'night') {
        // Light catching the sunward side.
        c.fillStyle = 'rgba(255,240,200,0.08)';
        c.beginPath();
        c.ellipse(base[0] - r * 0.25, cy - r * 0.2, r * 0.5, r * 0.45, 0, 0, Math.PI * 2);
        c.fill();
      }
      return;
    }
    if (u.kind === 'sheep') {
      const r = Math.max(0.8, u.r * k);
      c.fillStyle = pal.night ? '#2a2c30' : mix('#e9e4d6', pal.haze, haze);
      c.beginPath();
      c.ellipse(base[0], base[1] - r * 0.8, r * 1.5, r * 0.85, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = pal.night ? '#101012' : '#2a2622';
      c.beginPath();
      c.arc(base[0] + (u.v > 0.5 ? 1 : -1) * r * 1.45, base[1] - r * 0.95, r * 0.42, 0, Math.PI * 2);
      c.fill();
      return;
    }
    if (u.kind === 'pole') {
      const w = Math.max(0.8, 0.26 * k);
      c.fillStyle = mix(pal.night ? '#151515' : '#4a3a2c', pal.haze, haze);
      c.fillRect(base[0] - w / 2, top[1], w, base[1] - top[1]);
      for (const zz of [u.h - 0.35, u.h - 1.0]) {
        const a = this.proj(p, u.x, u.y - 0.9, zz);
        const b = this.proj(p, u.x, u.y + 0.9, zz);
        if (!a || !b) continue;
        c.strokeStyle = c.fillStyle as string;
        c.lineWidth = Math.max(0.7, 0.14 * k);
        c.beginPath();
        c.moveTo(a[0], a[1]);
        c.lineTo(b[0], b[1]);
        c.stroke();
      }
      return;
    }
    if (u.kind === 'hut') {
      const corners: V3[] = [
        [u.x - 1.6, u.y + 1.2, 0],
        [u.x + 1.6, u.y + 1.2, 0],
        [u.x + 1.6, u.y + 1.2, 2.1],
        [u.x - 1.6, u.y + 1.2, 2.1],
      ];
      this.poly(c, p, corners, pal.night ? '#1a1412' : '#6b4636');
      this.poly(
        c,
        p,
        [
          [u.x - 1.8, u.y + 1.4, 2.1],
          [u.x + 1.8, u.y + 1.4, 2.1],
          [u.x + 1.8, u.y - 1.4, 2.6],
          [u.x - 1.8, u.y - 1.4, 2.6],
        ],
        pal.night ? '#101012' : '#3a3633',
      );
      this.poly(
        c,
        p,
        [
          [u.x - 0.4, u.y + 1.21, 0],
          [u.x + 0.4, u.y + 1.21, 0],
          [u.x + 0.4, u.y + 1.21, 1.8],
          [u.x - 0.4, u.y + 1.21, 1.8],
        ],
        pal.night ? '#0c0a0a' : '#3d2a20',
      );
    }
  }

  /** A canal running alongside the line, holding the sky, with a towpath on its near bank. */
  private drawCanal(c: CanvasRenderingContext2D, p: Pane): void {
    const pal = this.pal;
    const y0 = 146;
    const y1 = 156;
    const strip = (ya: number, yb: number, fill: string | CanvasGradient) => {
      const top: [number, number][] = [];
      const bot: [number, number][] = [];
      for (let x = -3000; x <= 3000; x += 25) {
        const a = this.proj(p, x, yb, 0.01);
        const b = this.proj(p, x, ya, 0.01);
        if (a && b) {
          top.push([a[0], a[1]]);
          bot.push([b[0], b[1]]);
        }
      }
      if (top.length < 2) return;
      c.fillStyle = fill;
      c.beginPath();
      c.moveTo(top[0][0], top[0][1]);
      for (const q of top) c.lineTo(q[0], q[1]);
      for (let i = bot.length - 1; i >= 0; i--) c.lineTo(bot[i][0], bot[i][1]);
      c.closePath();
      c.fill();
    };
    strip(y0 - 3.5, y0, pal.night ? '#141814' : mix('#b9ad8c', pal.haze, 0.25));
    const far = this.proj(p, 0, y1, 0);
    const near = this.proj(p, 0, y0, 0);
    let water: string | CanvasGradient = mix(pal.skyMid, pal.skyLow, 0.5);
    if (far && near && Math.abs(near[1] - far[1]) > 0.5) {
      const g = c.createLinearGradient(0, far[1], 0, near[1]);
      g.addColorStop(0, mix(pal.skyLow, '#000000', pal.night ? 0.2 : 0.05));
      g.addColorStop(1, mix(pal.skyMid, '#000000', pal.night ? 0.4 : 0.18));
      water = g;
    }
    strip(y0, y1, water);
    c.strokeStyle = pal.night ? 'rgba(160,170,200,0.12)' : 'rgba(255,255,255,0.28)';
    c.lineWidth = Math.max(0.5, 0.6 * this.dpr);
    this.groundLine(
      c,
      p,
      [
        [-3000, y0 + 3],
        [3000, y0 + 3],
      ],
      0.02,
    );
    c.strokeStyle = pal.night ? '#060808' : mix(pal.hedge, pal.haze, 0.2);
    c.lineWidth = Math.max(0.6, 1 * this.dpr);
    this.groundLine(
      c,
      p,
      [
        [-3000, y1],
        [3000, y1],
      ],
      0.02,
    );
  }

  /** The railway's boundary fence, posts and wire, along the north side. */
  private drawFence(c: CanvasRenderingContext2D, p: Pane): void {
    const y = DOWN_Y + 10.5;
    c.strokeStyle = this.pal.night ? 'rgba(60,60,70,0.5)' : 'rgba(58,48,38,0.55)';
    c.lineWidth = Math.max(0.5, 0.6 * this.dpr);
    for (const z of [0.55, 1.05])
      this.groundLine(
        c,
        p,
        [
          [-1800, y],
          [1800, y],
        ],
        z,
      );
    c.fillStyle = this.pal.night ? '#151518' : '#4b3c2e';
    for (let x = -260; x <= 260; x += 3) {
      const a = this.proj(p, x, y, 0);
      const b = this.proj(p, x, y, 1.2);
      if (!a || !b || a[0] < p.x - 4 || a[0] > p.x + p.w + 4) continue;
      const w = Math.max(0.6, (0.1 * p.f) / a[2]);
      c.fillRect(a[0] - w / 2, b[1], w, a[1] - b[1]);
    }
  }

  private drawBuilding(c: CanvasRenderingContext2D, p: Pane, bd: Building): void {
    const pal = this.pal;
    const d = Math.hypot(bd.x - CAM[0], bd.y - CAM[1]);
    const haze = Math.min(0.85, Math.pow(d / 2600, 0.7)) * (pal.night ? 0.3 : 0.7);
    const tone = (col: string, f = 0) =>
      mix(mix(col, pal.night ? '#05060a' : '#000000', pal.night ? 0.8 : f), pal.haze, haze);
    const x0 = bd.x - bd.w / 2;
    const x1 = bd.x + bd.w / 2;
    const y0 = bd.y - bd.d / 2;
    const y1 = bd.y + bd.d / 2;
    const ym = bd.y;
    const top = bd.h + bd.rise;
    const P = (x: number, y: number, z: number): V3 => [x, y, z];
    // The south wall faces the box; one gable end shows, whichever side the box is on.
    const gx = CAM[0] < x0 ? x0 : x1;
    this.poly(
      c,
      p,
      [P(gx, y0, 0), P(gx, y1, 0), P(gx, y1, bd.h), P(gx, ym, bd.tower ? bd.h : top), P(gx, y0, bd.h)],
      tone(bd.wall, 0.22),
    );
    this.poly(c, p, [P(x0, y0, 0), P(x1, y0, 0), P(x1, y0, bd.h), P(x0, y0, bd.h)], tone(bd.wall));
    if (bd.tower) {
      this.poly(c, p, [P(x0, y0, bd.h), P(x1, y0, bd.h), P(bd.x, bd.y, top)], tone(bd.roof));
      this.poly(c, p, [P(gx, y0, bd.h), P(gx, y1, bd.h), P(bd.x, bd.y, top)], tone(bd.roof, 0.25));
    } else {
      this.poly(
        c,
        p,
        [P(x0 - 0.3, y0 - 0.3, bd.h), P(x1 + 0.3, y0 - 0.3, bd.h), P(x1 + 0.3, ym, top), P(x0 - 0.3, ym, top)],
        tone(bd.roof),
      );
    }
    // Windows: lit at night, dark panes by day.
    if (!bd.tower && d < 1200) {
      const win = pal.night ? '#f2c46a' : tone('#2b2a28');
      const n = Math.max(1, Math.round(bd.w / 4.5));
      for (let i = 0; i < n; i++) {
        const cx = x0 + ((i + 0.5) / n) * bd.w;
        if (pal.night && i % 2) continue;
        this.poly(
          c,
          p,
          [
            P(cx - 0.5, y0 - 0.02, bd.h * 0.35),
            P(cx + 0.5, y0 - 0.02, bd.h * 0.35),
            P(cx + 0.5, y0 - 0.02, bd.h * 0.62),
            P(cx - 0.5, y0 - 0.02, bd.h * 0.62),
          ],
          win,
        );
      }
    }
  }

  private drawWires(c: CanvasRenderingContext2D, p: Pane): void {
    const poles = this.uprights.filter((u) => u.kind === 'pole').sort((a, b) => a.x - b.x);
    c.strokeStyle = this.pal.night ? 'rgba(90,100,120,0.35)' : 'rgba(40,36,32,0.55)';
    c.lineWidth = Math.max(0.5, 0.6 * this.dpr);
    for (let i = 0; i < poles.length - 1; i++) {
      const a = poles[i];
      const b = poles[i + 1];
      if (b.x - a.x > 80) continue;
      for (const [off, zz] of [
        [-0.7, a.h - 0.4],
        [0.7, a.h - 0.4],
        [-0.7, a.h - 1.05],
        [0.7, a.h - 1.05],
      ] as const) {
        c.beginPath();
        let on = false;
        for (let k = 0; k <= 8; k++) {
          const t = k / 8;
          const sag = 0.55 * 4 * t * (1 - t);
          const q = this.proj(p, a.x + (b.x - a.x) * t, a.y + off, zz - sag);
          if (!q) continue;
          if (!on) c.moveTo(q[0], q[1]);
          else c.lineTo(q[0], q[1]);
          on = true;
        }
        c.stroke();
      }
    }
  }

  private poly(c: CanvasRenderingContext2D, p: Pane, pts: V3[], fill: string): boolean {
    const q: [number, number][] = [];
    for (const v of pts) {
      const r = this.proj(p, v[0], v[1], v[2]);
      if (!r) return false;
      q.push([r[0], r[1]]);
    }
    c.fillStyle = fill;
    c.beginPath();
    c.moveTo(q[0][0], q[0][1]);
    for (const k of q) c.lineTo(k[0], k[1]);
    c.closePath();
    c.fill();
    return true;
  }

  /** Draw the scene for this moment. */
  render(box: Box, dt: number, clockT: number): void {
    if (this.shift === 'early') {
      const d = Math.min(1, Math.max(0, (clockT - (5 * 3600 + 40 * 60)) / 1800));
      if (Math.abs(d - this.dawn) > 0.02) {
        this.dawn = d;
        this.bgStamp = '';
      }
    } else this.dawn = 0;
    const stamp = `${this.w}x${this.h}:${this.shift}:${this.dawn.toFixed(2)}`;
    if (stamp !== this.bgStamp) {
      this.drawBackground();
      this.bgStamp = stamp;
    }
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.drawImage(this.bg, 0, 0);
    this.stepSmoke(box, dt);
    const sigs = this.signals(box, dt);
    const vs = this.vehicles(box);
    vs.sort((a, b) => b.d - a.d);
    for (const p of this.panes) {
      c.save();
      c.beginPath();
      c.rect(p.x, 0, p.w, p.h);
      c.clip();
      // Far side signals, then trains far to near, then near side signals.
      for (const s of sigs) if (s.y > UP_Y) this.drawSignal(c, p, s, box);
      for (const v of vs) this.drawVehicle(c, p, v);
      this.drawSmoke(c, p);
      for (const s of sigs) if (s.y <= UP_Y) this.drawSignal(c, p, s, box);
      c.restore();
    }
    this.drawSashes(c);
  }

  private signals(box: Box, dt: number): Sig[] {
    const out: Sig[] = [];
    for (const [path, n, h] of [
      ['DM', 2, 9.5],
      ['DB', 3, 7.5],
      ['DM', 4, 8.5],
      ['DB', 5, 8.5],
      ['UM', 12, 9],
      ['UB', 11, 8.5],
      ['UM', 10, 8.5],
    ] as [PathId, number, number][]) {
      const sig = PATH_SIGNALS[path].find((g) => g.lever === n)!;
      const q = pathPoint(path, sig.s);
      const fwd: [number, number] = [Math.cos(q.h), Math.sin(q.h)];
      // Posts stand on the driver's left, and the arm reaches out further left.
      const left: [number, number] = [-fwd[1], fwd[0]];
      const target = box.armOff(n) ? 1 : 0;
      let a = this.arms.get(n) ?? target;
      if (a !== target) a += Math.sign(target - a) * Math.min(Math.abs(target - a), dt * 2.2);
      this.arms.set(n, a);
      out.push({ n, x: q.x + left[0] * 2.6, y: q.y + left[1] * 2.6, fwd, left, a, h });
    }
    // The branch home shares the down main home's bracket, on a shorter doll to its left.
    const b2 = out.find((g) => g.n === 2)!;
    const b3 = out.find((g) => g.n === 3)!;
    b3.x = b2.x;
    b3.y = b2.y + 1.4;
    return out;
  }

  private drawSignal(c: CanvasRenderingContext2D, p: Pane, s: Sig, box: Box): void {
    const pal = this.pal;
    const H = s.h * SIG_SCALE;
    const base = this.proj(p, s.x, s.y, 0);
    const top = this.proj(p, s.x, s.y, H);
    if (!base || !top) return;
    if (base[0] < p.x - 60 || base[0] > p.x + p.w + 60) return;
    const k = p.f / base[2];
    const w = Math.max(1.4, 0.34 * k * SIG_SCALE);
    // Post, with its ladder and finial.
    c.fillStyle = pal.night ? '#2a2c33' : pal.post;
    c.fillRect(base[0] - w / 2, top[1], w, base[1] - top[1]);
    c.fillStyle = pal.night ? '#0d0d10' : '#2a2724';
    c.fillRect(base[0] - w / 2, base[1] - Math.max(2, 0.8 * k), w, Math.max(2, 0.8 * k));
    c.beginPath();
    c.arc(base[0], top[1], w * 0.9, Math.PI, 0);
    c.fill();
    if (k * SIG_SCALE > 3) {
      c.strokeStyle = pal.night ? 'rgba(80,80,90,0.6)' : 'rgba(40,36,32,0.5)';
      c.lineWidth = Math.max(0.5, 0.06 * k);
      const lx = base[0] + w * 0.9;
      c.beginPath();
      c.moveTo(lx, base[1]);
      c.lineTo(lx, top[1] + (base[1] - top[1]) * 0.18);
      for (let z = 0.4; z < H * 0.8; z += 0.4 * SIG_SCALE) {
        const q = this.proj(p, s.x, s.y, z);
        if (!q) continue;
        c.moveTo(base[0] + w * 0.5, q[1]);
        c.lineTo(lx, q[1]);
      }
      c.stroke();
    }
    // The arm: a plate square to the line, out to the driver's left, rising 45 degrees when off.
    const zArm = H - 0.9 * SIG_SCALE;
    const ang = (s.a * 45 * Math.PI) / 180;
    const L = 1.55 * SIG_SCALE;
    const T = 0.3 * SIG_SCALE;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const P = (a: number, b: number): V3 => [
      s.x + s.left[0] * (a * ca - b * sa),
      s.y + s.left[1] * (a * ca - b * sa),
      zArm + a * sa + b * ca,
    ];
    // A signal faces the trains coming to it; from the box we see some fronts and some backs.
    const facing = (s.x - CAM[0]) * s.fwd[0] + (s.y - CAM[1]) * s.fwd[1] > 0;
    const front = facing ? '#c0281c' : '#ece8dc';
    const stripe = facing ? '#f4f0e4' : '#1c1a18';
    this.poly(c, p, [P(0.15, -T / 2), P(L, -T / 2), P(L, T / 2), P(0.15, T / 2)], front);
    this.poly(
      c,
      p,
      [
        P(L - 0.42 * SIG_SCALE, -T / 2),
        P(L - 0.24 * SIG_SCALE, -T / 2),
        P(L - 0.24 * SIG_SCALE, T / 2),
        P(L - 0.42 * SIG_SCALE, T / 2),
      ],
      stripe,
    );
    // Spectacle and lamp by the post: red or green from the front, the small back light from behind.
    const lamp = this.proj(p, s.x + s.left[0] * 0.1, s.y + s.left[1] * 0.1, zArm - 0.35 * SIG_SCALE);
    if (lamp) {
      const r = Math.max(1, 0.16 * k * SIG_SCALE);
      c.fillStyle = '#1a1816';
      c.fillRect(lamp[0] - r * 1.4, lamp[1] - r * 1.4, r * 2.8, r * 2.8);
      const lit = facing ? (s.a > 0.5 ? '#7dffb2' : '#ff4a33') : s.a < 0.2 ? '#fff4d8' : null;
      if (lit) {
        const gl = pal.night || this.shift === 'early' ? 1 : 0.35;
        const glow = c.createRadialGradient(lamp[0], lamp[1], 0, lamp[0], lamp[1], r * (pal.night ? 9 : 5));
        glow.addColorStop(0, lit);
        glow.addColorStop(0.25, hexA(lit, 0.45 * gl));
        glow.addColorStop(1, hexA(lit, 0));
        c.fillStyle = glow;
        c.fillRect(lamp[0] - r * 9, lamp[1] - r * 9, r * 18, r * 18);
        c.fillStyle = lit;
        c.beginPath();
        c.arc(lamp[0], lamp[1], r * (facing ? 0.9 : 0.5), 0, Math.PI * 2);
        c.fill();
      }
    }
    void box;
  }

  private vehicles(
    box: Box,
  ): { tr: Train; v: Vehicle; a: { x: number; y: number }; b: { x: number; y: number }; d: number; idx: number }[] {
    const out: {
      tr: Train;
      v: Vehicle;
      a: { x: number; y: number };
      b: { x: number; y: number };
      d: number;
      idx: number;
    }[] = [];
    for (const tr of box.trains) {
      if (tr.state !== 'running') continue;
      let s = tr.s;
      for (const [idx, v] of tr.vehicles.entries()) {
        const sa = s;
        const sb = s - v.len;
        s = sb - 0.6;
        if (sb > 3000 || sa < 0) continue;
        const a = pathPoint(tr.path, sa);
        const b = pathPoint(tr.path, sb);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const d = Math.hypot(mx - CAM[0], my - CAM[1]);
        if (d > 1700) continue;
        out.push({ tr, v, a, b, d: d + (my - CAM[1]) * 0.6, idx });
      }
    }
    return out;
  }

  private drawVehicle(
    c: CanvasRenderingContext2D,
    p: Pane,
    o: { tr: Train; v: Vehicle; a: { x: number; y: number }; b: { x: number; y: number }; idx: number },
  ): void {
    const { tr, v, a, b } = o;
    const pal = this.pal;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;
    // The side toward the box, and the end toward it.
    let nx = -ty;
    let ny = tx;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if ((CAM[0] - mx) * nx + (CAM[1] - my) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const qa = this.proj(p, mx, my, 1);
    if (!qa || qa[0] < p.x - 500 || qa[0] > p.x + p.w + 500) return;
    const k = p.f / qa[2];
    const spec = SHAPES[v.kind];
    const W = spec.half;
    const z0 = spec.floor;
    const z1 = spec.top;
    const at = (t: number) => ({ x: b.x + dx * t, y: b.y + dy * t });
    const N = (t: number, z: number, w = W): V3 => {
      const q = at(t);
      return [q.x + nx * w, q.y + ny * w, z];
    };
    const F = (t: number, z: number, w = W): V3 => {
      const q = at(t);
      return [q.x - nx * w, q.y - ny * w, z];
    };
    const side = (t0: number, t1: number, za: number, zb: number, col: string, w = W) =>
      this.poly(c, p, [N(t0, za, w), N(t1, za, w), N(t1, zb, w), N(t0, zb, w)], col);
    const top = (t0: number, t1: number, z: number, col: string, w = W) =>
      this.poly(c, p, [N(t0, z, w), N(t1, z, w), F(t1, z, w), F(t0, z, w)], col);
    const endFace = (t: number, za: number, zb: number, col: string, w = W) =>
      this.poly(c, p, [N(t, za, w), F(t, za, w), F(t, zb, w), N(t, zb, w)], col);
    const night = pal.night;
    // Light on each face: the sides face the box, the roofs the sky.
    const face = (col: string) =>
      night ? mix(col, '#04050a', 0.78) : this.shift === 'early' ? mix(col, '#2c2236', 0.3) : col;
    const roofLit = (col: string) =>
      night ? mix(col, '#04050a', 0.7) : this.shift === 'early' ? mix(col, '#d6a58e', 0.18) : mix(col, '#c9d8e6', 0.2);
    const dark = (col: string, f: number) => mix(col, '#000000', f);
    const bodyCol = face(spec.colour(v));
    const endT = (CAM[0] - a.x) * tx + (CAM[1] - a.y) * ty > 0 ? 1 : 0;
    const crisp = k > 2.2;

    // Frames, wheels, and buffers.
    side(0.02, 0.98, 0.45, z0, night ? '#050505' : '#1a1816');
    if (k > 1.4) {
      const r = (v.kind === 'steam' ? 0.85 : 0.46) * k;
      const axles =
        v.kind === 'steam'
          ? [0.33, 0.53, 0.73]
          : v.kind === 'tender'
            ? [0.2, 0.5, 0.8]
            : len < 9
              ? [0.25, 0.75]
              : [0.1, 0.19, 0.81, 0.9];
      for (const t of axles) {
        const q = this.proj(p, ...N(t, v.kind === 'steam' ? 0.85 : 0.46, W - 0.25));
        if (!q) continue;
        c.fillStyle = night ? '#060606' : '#141312';
        c.beginPath();
        c.ellipse(q[0], q[1], r * 0.98, r, 0, 0, Math.PI * 2);
        c.fill();
        if (crisp) {
          c.strokeStyle = night ? '#1c1c1c' : '#5a5650';
          c.lineWidth = Math.max(0.6, 0.06 * k);
          c.stroke();
        }
      }
      if (v.kind === 'steam' && crisp) {
        // Coupling rod across the driving wheels.
        const r0 = this.proj(p, ...N(0.33, 0.7, W - 0.2));
        const r1 = this.proj(p, ...N(0.73, 0.7, W - 0.2));
        if (r0 && r1) {
          c.strokeStyle = night ? '#2a2a2a' : '#8b8780';
          c.lineWidth = Math.max(1, 0.12 * k);
          c.beginPath();
          c.moveTo(r0[0], r0[1]);
          c.lineTo(r1[0], r1[1]);
          c.stroke();
        }
      }
      // Buffers reaching out to the next vehicle.
      for (const t of [0, 1]) {
        const q0 = this.proj(p, ...N(t, 1.05, W - 0.35));
        const t2 = t === 0 ? -0.6 / len : 1 + 0.6 / len;
        const q1 = this.proj(p, ...N(t2, 1.05, W - 0.35));
        if (!q0 || !q1) continue;
        c.strokeStyle = night ? '#080808' : '#2a2725';
        c.lineWidth = Math.max(1, 0.32 * k);
        c.beginPath();
        c.moveTo(q0[0], q0[1]);
        c.lineTo((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2);
        c.stroke();
      }
    }

    switch (v.kind) {
      case 'steam':
        this.steamLoco(c, p, N, F, side, top, endT, bodyCol, roofLit, face);
        break;
      case 'tank': {
        // A barrel on a short frame, with a dome on top.
        side(0.03, 0.97, z0, z0 + 0.3, dark(bodyCol, 0.2));
        const t3 = this.proj(p, ...N(0.5, z1, W * 0.2));
        const b3 = this.proj(p, ...N(0.5, z0 + 0.3, W));
        const fill = t3 && b3 ? this.barrel(c, t3[1], b3[1], bodyCol) : bodyCol;
        this.polyFill(
          c,
          p,
          [
            N(0.04, z0 + 0.3),
            N(0.96, z0 + 0.3),
            N(0.96, z1 - 0.5, W * 0.95),
            N(0.96, z1, W * 0.35),
            N(0.04, z1, W * 0.35),
            N(0.04, z1 - 0.5, W * 0.95),
          ],
          fill,
        );
        this.poly(
          c,
          p,
          [N(0.44, z1), N(0.56, z1), N(0.56, z1 + 0.35, 0.3), N(0.44, z1 + 0.35, 0.3)],
          dark(bodyCol, 0.25),
        );
        break;
      }
      default: {
        if (spec.roof) {
          top(0, 1, z1, roofLit(spec.roof));
          if (spec.arched) side(0, 1, z1 - 0.22, z1, dark(roofLit(spec.roof), 0.12));
        }
        if (spec.load) top(0.04, 0.96, z1 - 0.25, face(spec.load), W - 0.12);
        endFace(endT, z0, z1, dark(bodyCol, 0.3));
        if (v.kind === 'diesel' || v.kind === 'dmu') {
          endFace(endT, z0 + 0.25, z0 + 1.35, face('#e6bd2a'));
          endFace(endT, z1 - 1.15, z1 - 0.45, night ? '#141410' : '#1d2628', W - 0.3);
        }
        side(0, 1, z0, spec.roof && spec.arched ? z1 - 0.22 : z1, bodyCol);
        if (k > 1.2) this.detail(c, p, v, N, z0, z1, k, o.idx, bodyCol);
        if (crisp) {
          c.strokeStyle = 'rgba(0,0,0,0.35)';
          c.lineWidth = Math.max(0.6, 0.05 * k);
          const q = [N(0, z0), N(1, z0), N(1, z1), N(0, z1)].map((v3) => this.proj(p, ...v3));
          if (q.every((x) => x)) {
            c.beginPath();
            c.moveTo(q[0]![0], q[0]![1]);
            for (const x of q) c.lineTo(x![0], x![1]);
            c.closePath();
            c.stroke();
          }
        }
      }
    }

    // Lamps: a tail lamp on the last vehicle, and headlamps on the leading end.
    const last = o.idx === tr.vehicles.length - 1;
    const first = o.idx === 0;
    if (last && !tr.noTail) {
      const q = this.proj(p, ...N(0, z0 + 0.45, W - 0.35));
      if (q) this.lamp(c, q, Math.max(1.2, 0.2 * k), '#ff2b1c', night ? 8 : 3.5);
    }
    if (first && (night || this.shift === 'early')) {
      const col = v.kind === 'steam' ? '#ffe0a0' : '#fff6e2';
      for (const w of [W - 0.4, -(W - 0.4)]) {
        const q = this.proj(p, ...N(1, z0 + 0.55, w));
        if (q) this.lamp(c, q, Math.max(1.2, 0.22 * k), col, night ? 10 : 4);
      }
    }
  }

  /** Fill a projected polygon with a colour or gradient. */
  private polyFill(c: CanvasRenderingContext2D, p: Pane, pts: V3[], fill: string | CanvasGradient): boolean {
    const q: [number, number][] = [];
    for (const v of pts) {
      const r = this.proj(p, v[0], v[1], v[2]);
      if (!r) return false;
      q.push([r[0], r[1]]);
    }
    c.fillStyle = fill;
    c.beginPath();
    c.moveTo(q[0][0], q[0][1]);
    for (const x of q) c.lineTo(x[0], x[1]);
    c.closePath();
    c.fill();
    return true;
  }

  /** A gradient across a barrel's height, lit from above. */
  private barrel(c: CanvasRenderingContext2D, y0: number, y1: number, col: string): CanvasGradient | string {
    if (!Number.isFinite(y0) || !Number.isFinite(y1) || Math.abs(y1 - y0) < 1) return col;
    const g = c.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, mix(col, '#ffffff', this.pal.night ? 0.04 : 0.28));
    g.addColorStop(0.35, mix(col, '#ffffff', this.pal.night ? 0.02 : 0.1));
    g.addColorStop(1, mix(col, '#000000', 0.35));
    return g;
  }

  /** A tender engine's side: frames, boiler, smokebox, chimney and dome, and the cab. */
  private steamLoco(
    c: CanvasRenderingContext2D,
    p: Pane,
    N: (t: number, z: number, w?: number) => V3,
    F: (t: number, z: number, w?: number) => V3,
    side: (t0: number, t1: number, za: number, zb: number, col: string, w?: number) => boolean,
    top: (t0: number, t1: number, z: number, col: string, w?: number) => boolean,
    endT: number,
    body: string,
    roofLit: (c: string) => string,
    face: (c: string) => string,
  ): void {
    const night = this.pal.night;
    // Running plate and valance.
    side(0, 1, 1.25, 1.5, face('#262422'));
    top(0, 1, 1.5, roofLit('#2a2826'));
    // The boiler, a cylinder lying along the front three quarters.
    const bt = this.proj(p, ...N(0.6, 3.25, 0.2));
    const bb = this.proj(p, ...N(0.6, 1.5, 1.2));
    const fill = bt && bb ? this.barrel(c, bt[1], bb[1], body) : body;
    this.polyFill(
      c,
      p,
      [
        N(0.26, 1.5, 1.25),
        N(0.98, 1.5, 1.25),
        N(0.98, 2.75, 1.25),
        N(0.98, 3.25, 0.4),
        N(0.26, 3.25, 0.4),
        N(0.26, 2.75, 1.25),
      ],
      fill,
    );
    // Boiler bands.
    for (const t of [0.42, 0.6, 0.78]) side(t, t + 0.008, 1.6, 3.2, face('#4a4744'), 1.26);
    // Smokebox front, if it faces the box.
    if (endT === 1)
      this.poly(
        c,
        p,
        [N(0.985, 1.5, 1.2), F(0.985, 1.5, 1.2), F(0.985, 3.2, 0.4), N(0.985, 3.2, 0.4)],
        face('#141312'),
      );
    // Chimney and dome.
    side(0.86, 0.92, 3.2, 4.15, face('#151413'), 0.35);
    top(0.86, 0.92, 4.15, face('#0d0c0c'), 0.35);
    side(0.56, 0.66, 3.2, 3.7, face('#1f1d1c'), 0.45);
    // Cab: sides, roof, and its window.
    side(0.02, 0.26, 1.5, 3.65, face('#1b1a19'), 1.4);
    top(0.0, 0.27, 3.75, roofLit('#232120'), 1.45);
    side(0.06, 0.2, 2.7, 3.35, night ? '#e9a24a' : face('#3b3d3e'), 1.41);
    // Buffer beam.
    side(0.995, 1.0, 1.0, 1.45, face('#8a1e14'));
  }

  private detail(
    c: CanvasRenderingContext2D,
    p: Pane,
    v: Vehicle,
    N: (t: number, z: number, w?: number) => V3,
    z0: number,
    z1: number,
    k: number,
    idx: number,
    body: string,
  ): void {
    const night = this.pal.night;
    const quad = (t0: number, t1: number, za: number, zb: number, col: string) =>
      this.poly(c, p, [N(t0, za), N(t1, za), N(t1, zb), N(t0, zb)], col);
    const glass = night ? '#ffd88a' : this.shift === 'early' ? '#b9aa92' : '#3c4a50';
    const dim = night ? '#15130f' : glass;
    const shade = (f: number) => mix(body, '#000000', f);
    switch (v.kind) {
      case 'coach':
      case 'sleeper': {
        // Lining at the waist and cantrail, a row of windows, and the doors between.
        quad(0, 1, z0 + 1.0, z0 + 1.05, night ? '#2a1e14' : '#d6b46a');
        quad(0, 1, z1 - 0.62, z1 - 0.58, night ? '#2a1e14' : '#d6b46a');
        const n = v.kind === 'coach' ? 8 : 11;
        for (let i = 0; i < n; i++) {
          const t0 = 0.06 + (i / n) * 0.88;
          const t1 = t0 + (0.88 / n) * (v.kind === 'coach' ? 0.66 : 0.38);
          const lit = !night || (i + idx + v.v) % 5 !== 0;
          quad(t0, t1, z0 + 1.2, z1 - (v.kind === 'coach' ? 0.78 : 1.1), lit ? glass : dim);
          if (v.kind === 'coach' && k > 3) quad(t1 + 0.012, t1 + 0.016, z0 + 0.1, z1 - 0.62, shade(0.3));
        }
        break;
      }
      case 'dmu': {
        quad(0, 1, z0 + 0.95, z0 + 1.0, night ? '#1e2a1e' : '#c9c49a');
        for (let i = 0; i < 9; i++) {
          const t0 = 0.12 + (i / 9) * 0.78;
          quad(t0, t0 + 0.065, z0 + 1.15, z1 - 0.7, glass);
        }
        quad(0.005, 0.06, z0 + 1.15, z1 - 0.65, night ? '#2a2a1e' : '#1d2628');
        quad(0.94, 0.995, z0 + 1.15, z1 - 0.65, night ? '#2a2a1e' : '#1d2628');
        break;
      }
      case 'diesel': {
        quad(0, 1, z0 + 0.55, z0 + 0.68, night ? '#1c241c' : '#b9c3ac');
        quad(0.03, 0.12, z1 - 1.25, z1 - 0.5, night ? '#2a2a1e' : '#1d2628');
        quad(0.88, 0.97, z1 - 1.25, z1 - 0.5, night ? '#2a2a1e' : '#1d2628');
        for (let i = 0; i < 6; i++) quad(0.22 + i * 0.1, 0.27 + i * 0.1, z1 - 1.1, z1 - 0.6, shade(0.35));
        break;
      }
      case 'van':
      case 'brake': {
        for (let i = 1; i < 6; i++) quad(i / 6 - 0.004, i / 6 + 0.004, z0 + 0.1, z1 - 0.3, shade(0.25));
        quad(0.4, 0.6, z0 + 0.15, z1 - 0.35, shade(0.12));
        if (v.kind === 'brake') {
          quad(0.02, 0.18, z0 + 0.45, z1 - 0.35, night ? '#080808' : '#262420');
          quad(0.82, 0.98, z0 + 0.45, z1 - 0.35, night ? '#080808' : '#262420');
        }
        break;
      }
      case 'mineral':
      case 'open': {
        for (let i = 1; i < 4; i++) quad(i / 4 - 0.006, i / 4 + 0.006, z0, z1, shade(0.3));
        quad(0.0, 1.0, z1 - 0.1, z1, mix(body, '#ffffff', night ? 0 : 0.12));
        break;
      }
      case 'tender':
        quad(0.04, 0.96, z1 - 0.15, z1, shade(0.2));
        break;
    }
  }

  private lamp(c: CanvasRenderingContext2D, q: [number, number, number], r: number, col: string, spread: number): void {
    const g = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], r * spread);
    g.addColorStop(0, col);
    g.addColorStop(0.3, hexA(col, 0.35));
    g.addColorStop(1, hexA(col, 0));
    c.fillStyle = g;
    c.fillRect(q[0] - r * spread, q[1] - r * spread, r * spread * 2, r * spread * 2);
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(q[0], q[1], r * 0.5, 0, Math.PI * 2);
    c.fill();
  }

  private stepSmoke(box: Box, dt: number): void {
    for (const tr of box.trains) {
      if (tr.state !== 'running') continue;
      const loco = tr.vehicles[0];
      if (loco.kind !== 'steam') continue;
      const q = pathPoint(tr.path, tr.s - loco.len * 0.15);
      const d = Math.hypot(q.x - CAM[0], q.y - CAM[1]);
      if (d > 1400) continue;
      const working = tr.v > 0.5;
      const rate = working ? 0.08 + 0.3 / (1 + tr.v) : 0.5;
      const last = this.lastPuff.get(tr.id) ?? 0;
      if (box.t - last > rate) {
        this.lastPuff.set(tr.id, box.t);
        const back = tr.path === 'UM' || tr.path === 'UB' ? 1 : -1;
        this.puffs.push({
          x: q.x,
          y: q.y,
          z: 4.6,
          r: 0.6,
          age: 0,
          life: working ? 5 + Math.random() * 3 : 3,
          vx: back * tr.v * 0.15 + (Math.random() - 0.5) * 0.6,
          vz: 1.6 + Math.random() * 1.2,
        });
      }
    }
    for (const pf of this.puffs) {
      pf.age += dt;
      pf.x += pf.vx * dt + 0.9 * dt;
      pf.z += pf.vz * dt;
      pf.vz *= 1 - 0.35 * dt;
      pf.r += dt * 1.25;
    }
    this.puffs = this.puffs.filter((pf) => pf.age < pf.life);
    if (this.puffs.length > 500) this.puffs.splice(0, this.puffs.length - 500);
  }

  private drawSmoke(c: CanvasRenderingContext2D, p: Pane): void {
    const night = this.pal.night;
    for (const pf of this.puffs) {
      const q = this.proj(p, pf.x, pf.y, pf.z);
      if (!q) continue;
      const r = (pf.r * p.f) / q[2];
      if (r < 0.5) continue;
      const a = (1 - pf.age / pf.life) * (night ? 0.18 : 0.42);
      c.fillStyle = night
        ? `rgba(120,125,140,${a})`
        : this.shift === 'early'
          ? `rgba(236,214,206,${a})`
          : `rgba(238,238,236,${a})`;
      c.beginPath();
      c.arc(q[0], q[1], r, 0, Math.PI * 2);
      c.fill();
    }
  }

  /** The window frame: painted sashes, mullions between the panes, a transom, and the glass. */
  private drawSashes(c: CanvasRenderingContext2D): void {
    const night = this.pal.night;
    const paint = night ? '#3a3328' : '#e4d9bc';
    const edge = night ? '#1d1912' : '#a8977a';
    for (const p of this.panes) {
      // A faint reflection on the glass: the room's lamp at night, daylight otherwise.
      const g = c.createLinearGradient(p.x, 0, p.x + p.w, p.h);
      if (night) {
        g.addColorStop(0, 'rgba(255,200,120,0.05)');
        g.addColorStop(0.5, 'rgba(255,200,120,0)');
        g.addColorStop(1, 'rgba(255,200,120,0.04)');
      } else {
        g.addColorStop(0, 'rgba(255,255,255,0.07)');
        g.addColorStop(0.45, 'rgba(255,255,255,0)');
        g.addColorStop(0.8, 'rgba(255,255,255,0.05)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
      }
      c.fillStyle = g;
      c.fillRect(p.x, 0, p.w, p.h);
    }
    for (let i = 0; i < this.panes.length - 1; i++) {
      const x0 = this.panes[i].x + this.panes[i].w;
      const x1 = this.panes[i + 1].x;
      c.fillStyle = paint;
      c.fillRect(x0, 0, x1 - x0, this.h);
      c.fillStyle = edge;
      c.fillRect(x1 - 2 * this.dpr, 0, 2 * this.dpr, this.h);
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.fillRect(x0, 0, 1.5 * this.dpr, this.h);
    }
    // Head and sill.
    c.fillStyle = paint;
    c.fillRect(0, 0, this.w, 6 * this.dpr);
    c.fillStyle = edge;
    c.fillRect(0, 6 * this.dpr, this.w, 1.5 * this.dpr);
  }

  /** Where a train is, as a fraction of the view across, for sound panning: -1 west to 1 east. */
  pan(tr: Train): { pan: number; dist: number } {
    const q = pathPoint(tr.path, Math.max(0, tr.s - tr.len / 2));
    const d = Math.hypot(q.x - CAM[0], q.y - CAM[1]);
    return { pan: Math.max(-1, Math.min(1, Math.atan2(q.x - CAM[0], q.y - CAM[1]) / (Math.PI / 2))), dist: d };
  }
}

interface Shape {
  floor: number;
  top: number;
  /** Half the body's width. */
  half: number;
  roof: string | null;
  arched?: boolean;
  /** What shows over the sides of an open wagon. */
  load?: string;
  colour: (v: Vehicle) => string;
}

const SHAPES: Record<Vehicle['kind'], Shape> = {
  diesel: { floor: 1.05, top: 3.9, half: 1.38, roof: '#4a4f4c', colour: () => '#2c5a3d' },
  steam: { floor: 1.0, top: 3.6, half: 1.35, roof: null, colour: () => '#1d1c1b' },
  tender: { floor: 1.0, top: 3.0, half: 1.3, roof: '#262424', load: '#0e0e0e', colour: () => '#1d1c1b' },
  dmu: { floor: 1.05, top: 3.75, half: 1.4, roof: '#5a5d5a', arched: true, colour: () => '#2f5f41' },
  coach: {
    floor: 1.05,
    top: 3.85,
    half: 1.4,
    roof: '#56575a',
    arched: true,
    colour: (v) => ['#7a2431', '#74222e', '#80283a', '#6e2029'][v.v],
  },
  sleeper: { floor: 1.05, top: 3.85, half: 1.4, roof: '#56575a', arched: true, colour: () => '#6c1f2b' },
  van: {
    floor: 0.95,
    top: 3.3,
    half: 1.3,
    roof: '#7a7a76',
    arched: true,
    colour: (v) => ['#7d4a33', '#7a4630', '#84533a', '#6e3f2b'][v.v],
  },
  brake: { floor: 0.95, top: 3.4, half: 1.3, roof: '#6e6e6a', arched: true, colour: () => '#7a4630' },
  open: {
    floor: 0.95,
    top: 2.1,
    half: 1.3,
    roof: null,
    load: '#2a2826',
    colour: (v) => ['#5e6260', '#6a5a4a', '#585c5a', '#6b6d68'][v.v],
  },
  mineral: {
    floor: 0.95,
    top: 2.45,
    half: 1.3,
    roof: null,
    load: '#121212',
    colour: (v) => ['#5b5c58', '#646560', '#55534f', '#6a6a64'][v.v],
  },
  tank: { floor: 1.05, top: 3.15, half: 1.3, roof: null, colour: () => '#1e1e1e' },
};

function hexA(col: string, a: number): string {
  const [r, g, b] = channels(col);
  return `rgba(${r},${g},${b},${a})`;
}

function shadeHex(col: string, f: number): string {
  return mix(col, '#000000', f);
}

function nearTrack(x: number, y: number, m: number): boolean {
  if (Math.abs(y - (DOWN_Y + UP_Y) / 2) < m) return true;
  for (const path of ['DB', 'UB'] as PathId[])
    for (let s = 1400; s < 3000; s += 20) {
      const q = pathPoint(path, s);
      if (Math.hypot(q.x - x, q.y - y) < m) return true;
    }
  return false;
}
