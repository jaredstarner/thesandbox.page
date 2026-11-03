// The loom seen from the weaver's bench: the warp running back through the
// heddles, the beater with its reed, the shed the shuttle crosses, the fell
// where each pick is beaten in, and the cloth rolling over the breast beam.

import { ClothPainter, GAP, hash, raised, shade, type Pick, type Warp } from './_cloth';
import { SETT, SHAFTS, YARNS } from './_drafts';

export interface WeaveHooks {
  /** The treadle goes down and the shafts rise. */
  open?: () => void;
  /** The shuttle leaves the hand. */
  fly?: () => void;
  /** The shuttle is caught on the far side. */
  land?: () => void;
  /** The beater strikes the fell; the pick is now cloth. */
  impact: () => void;
  done?: () => void;
}

interface Active {
  pick: Pick;
  from: -1 | 1;
  lifted: Uint8Array;
  t0: number;
  dur: number;
  hooks: WeaveHooks;
  fired: Set<string>;
}

interface Layout {
  W: number;
  H: number;
  dpr: number;
  p: number;
  clothX: number;
  clothW: number;
  rail: number;
  heddleTop: number;
  shaftGap: number;
  fellY: number;
  beamY: number;
  beamR: number;
  reedFaceRest: number;
  handH: number;
  reedH: number;
  raceH: number;
  shuttleL: number;
  shuttleW: number;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeIn = (t: number) => t * t * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

// Phases of a pick, as fractions of its duration.
const OPEN = [0, 0.14];
const THROW = [0.14, 0.52];
const BEAT = [0.56, 0.72];
const BACK = [0.72, 0.94];
const CLOSE = [0.76, 1];

function woodTexture(w: number, h: number, base: [number, number, number], seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = shade(base, 1);
  g.fillRect(0, 0, w, h);
  // Long grain lines, gently wandering.
  for (let i = 0; i < h * 0.9; i++) {
    const y0 = hash(i, seed) * h;
    const dark = hash(i, seed + 1) < 0.6;
    g.strokeStyle = dark
      ? `rgba(60, 34, 14, ${0.05 + hash(i, seed + 2) * 0.12})`
      : `rgba(255, 228, 190, ${0.04 + hash(i, seed + 3) * 0.06})`;
    g.lineWidth = 0.6 + hash(i, seed + 4) * 1.6;
    g.beginPath();
    const amp = 1 + hash(i, seed + 5) * 4;
    const f = 0.004 + hash(i, seed + 6) * 0.01;
    for (let x = 0; x <= w; x += 8) {
      const y = y0 + Math.sin(x * f + i) * amp + Math.sin(x * f * 3.1 + i * 2) * amp * 0.3;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // A few pores.
  for (let i = 0; i < w * h * 0.004; i++) {
    g.fillStyle = `rgba(50, 28, 10, ${0.12 + hash(i, seed + 9) * 0.2})`;
    g.fillRect(hash(i, seed + 7) * w, hash(i, seed + 8) * h, 2 + hash(i, seed + 10) * 4, 0.8);
  }
  return c;
}

export class LoomView {
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private L!: Layout;
  private painter!: ClothPainter;
  private buffer = document.createElement('canvas');
  private bg: CanvasRenderingContext2D;
  private warp: Warp = { threading: [], yarns: [] };
  private picks: Pick[] = [];
  private shuttleSide: -1 | 1 = -1;
  private active: Active | null = null;
  private raf = 0;
  private grainH: HTMLCanvasElement;
  private grainV: HTMLCanvasElement;
  private shuttles = new Map<string, HTMLCanvasElement>();
  private pointer: { x: number; y: number } | null = null;
  private loupePainter: ClothPainter | null = null;
  private loupe = document.createElement('canvas');
  private loupeKey = '';
  /** Shown while a pick is waiting: the shafts the next treadle would lift. */
  private preview: Uint8Array | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d')!;
    this.bg = this.buffer.getContext('2d')!;
    this.grainH = woodTexture(900, 120, [176, 132, 86], 3);
    this.grainV = woodTexture(900, 120, [120, 84, 52], 17);
    this.resize();
  }

  get busy() {
    return this.active !== null;
  }

  /** How far through the current pick, 0 to 1, or null when idle. */
  progress(now = performance.now()): number | null {
    return this.active ? clamp01((now - this.active.t0) / this.active.dur) : null;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const W = Math.max(280, rect.width);
    const H = Math.max(300, rect.height);
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);

    const ends = Math.max(1, this.warp.threading.length || 64);
    const rail = Math.round(Math.min(22, Math.max(10, W * 0.025)));
    // The race runs well past the warp on both sides, where the shuttle rests between picks.
    const shuttleL = Math.round(Math.max(50, Math.min(96, W * 0.11)));
    // On a phone the cloth gets the width, and the resting shuttle tucks under the frame.
    const room = W - rail * 2 - shuttleL * (W < 560 ? 0.9 : 1.64);
    // Whole device pixels per crossing, so the cloth never blurs.
    const sDev = Math.max(4, Math.min(13 * dpr, Math.floor((room / ends) * dpr)));
    const p = sDev / dpr;
    const clothW = ends * p;
    const clothX = Math.round(((W - clothW) / 2) * dpr) / dpr;

    const heddleTop = Math.round(H * 0.03);
    const shaftGap = Math.max(8, Math.round(H * 0.022));
    const fellY = Math.round(H * 0.45);
    const beamR = Math.max(22, Math.round(H * 0.065));
    const beamY = H - beamR * 1.15;
    const handH = Math.max(12, Math.round(H * 0.03));
    const reedH = Math.max(7, Math.round(H * 0.014));
    const raceH = Math.max(18, Math.round(H * 0.045));
    const reedFaceRest = fellY - raceH - Math.max(14, Math.round(H * 0.035));
    const shuttleW = Math.min(raceH * 0.72, shuttleL * 0.22);

    this.L = {
      W,
      H,
      dpr,
      p,
      clothX,
      clothW,
      rail,
      heddleTop,
      shaftGap,
      fellY,
      beamY,
      beamR,
      reedFaceRest,
      handH,
      reedH,
      raceH,
      shuttleL,
      shuttleW,
    };
    this.painter = new ClothPainter(sDev);
    this.loupePainter = null;
    this.loupeKey = '';
    this.shuttles.clear();
    this.rebuild();
    this.draw();
  }

  setCloth(warp: Warp, picks: Pick[], shuttleSide: -1 | 1) {
    const sameEnds = warp.threading.length === this.warp.threading.length;
    this.warp = warp;
    this.picks = picks;
    this.shuttleSide = shuttleSide;
    this.active = null;
    this.loupeKey = '';
    if (!sameEnds) this.resize();
    else {
      this.rebuild();
      this.draw();
    }
  }

  setPreview(lifted: Uint8Array | null) {
    this.preview = lifted;
    this.requestDraw();
  }

  setPointer(p: { x: number; y: number } | null) {
    this.pointer = p;
    this.requestDraw();
  }

  /** Throw one pick: open the shed, fly the shuttle, beat it in. */
  weave(pick: Pick, dur: number, hooks: WeaveHooks) {
    if (this.active) return;
    this.active = {
      pick,
      from: this.shuttleSide,
      lifted: raised(this.warp, pick.mask),
      t0: performance.now(),
      dur,
      hooks,
      fired: new Set(),
    };
    this.loop();
  }

  private requestDraw() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  private loop() {
    this.requestDraw();
  }

  private frame() {
    this.raf = 0;
    const a = this.active;
    if (a) {
      const t = clamp01((performance.now() - a.t0) / a.dur);
      const fire = (name: string, at: number, fn?: () => void) => {
        if (t >= at && !a.fired.has(name)) {
          a.fired.add(name);
          fn?.();
          return true;
        }
        return false;
      };
      fire('open', 0, a.hooks.open);
      fire('fly', THROW[0], a.hooks.fly);
      fire('land', THROW[1], a.hooks.land);
      if (fire('impact', BEAT[1], a.hooks.impact)) {
        this.shuttleSide = -a.from as -1 | 1;
        this.scrollIn();
      }
      if (t >= 1) {
        this.active = null;
        a.hooks.done?.();
      }
    }
    this.draw();
    if (this.active) this.requestDraw();
  }

  /** Paint every visible row of cloth into the buffer, newest at the top. */
  private rebuild() {
    const { p, dpr, clothW, fellY, beamY, beamR } = this.L;
    const s = this.painter.s;
    const margin = Math.ceil(s * 3);
    const visible = (beamY - fellY + beamR * 1.7) * dpr;
    const rows = Math.ceil(visible / s) + 2;
    this.buffer.width = Math.round(clothW * dpr) + margin * 2;
    this.buffer.height = rows * s;
    const g = this.bg;
    g.fillStyle = GAP;
    g.fillRect(0, 0, this.buffer.width, this.buffer.height);
    const n = this.picks.length;
    for (let i = 0; i < rows; i++) {
      const k = n - 1 - i;
      if (k < 0) {
        this.painter.paintTieOn(g, margin, i * s, this.warp, this.buffer.height - i * s);
        break;
      }
      this.painter.paintRow(
        g,
        margin,
        i * s,
        this.warp,
        this.picks[k],
        this.picks[k + 1] ?? null,
        this.picks[k - 1] ?? null,
      );
    }
    for (let i = 1; i < rows; i++) {
      const k = n - 1 - i;
      if (k < 0) break;
      this.painter.paintTurn(g, margin, i * s, this.warp.threading.length, this.picks[k], this.picks[k + 1]);
    }
    void p;
  }

  /** The newest pick has been beaten in: move the cloth down a row and paint it. */
  private scrollIn() {
    const s = this.painter.s;
    const g = this.bg;
    const margin = Math.ceil(s * 3);
    g.drawImage(
      this.buffer,
      0,
      0,
      this.buffer.width,
      this.buffer.height - s,
      0,
      s,
      this.buffer.width,
      this.buffer.height - s,
    );
    const n = this.picks.length;
    const ends = this.warp.threading.length;
    if (n === 0) return;
    if (n > 1)
      this.painter.paintRow(g, margin, s, this.warp, this.picks[n - 2], this.picks[n - 1], this.picks[n - 3] ?? null);
    else this.painter.paintTieOn(g, margin, s, this.warp, this.buffer.height - s);
    this.painter.paintRow(g, margin, 0, this.warp, this.picks[n - 1], null, this.picks[n - 2] ?? null);
    if (n > 1) this.painter.paintTurn(g, margin, s, ends, this.picks[n - 2], this.picks[n - 1]);
    if (n > 2) this.painter.paintTurn(g, margin, 2 * s, ends, this.picks[n - 3], this.picks[n - 2]);
    this.loupeKey = '';
  }

  private shuttle(yarn: number): HTMLCanvasElement {
    const key = `${yarn}`;
    const hit = this.shuttles.get(key);
    if (hit) return hit;
    const { shuttleL: Ls, shuttleW: Ws, dpr } = this.L;
    const c = document.createElement('canvas');
    c.width = Math.ceil((Ls + 8) * dpr);
    c.height = Math.ceil((Ws + 10) * dpr);
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.translate(4, 4);
    // Shadow on the race.
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.beginPath();
    g.ellipse(Ls / 2 + 2, Ws / 2 + 3, Ls / 2, Ws / 2, 0, 0, Math.PI * 2);
    g.fill();
    // The boat: pointed at both ends.
    g.beginPath();
    g.moveTo(0, Ws / 2);
    g.bezierCurveTo(Ls * 0.18, -Ws * 0.02, Ls * 0.82, -Ws * 0.02, Ls, Ws / 2);
    g.bezierCurveTo(Ls * 0.82, Ws * 1.02, Ls * 0.18, Ws * 1.02, 0, Ws / 2);
    g.closePath();
    const body = g.createLinearGradient(0, 0, 0, Ws);
    body.addColorStop(0, '#e2b27a');
    body.addColorStop(0.35, '#c88e55');
    body.addColorStop(1, '#6f4524');
    g.fillStyle = body;
    g.fill();
    g.save();
    g.clip();
    g.globalAlpha = 0.35;
    g.drawImage(this.grainH, 0, 0, 400, 60, 0, 0, Ls, Ws);
    g.globalAlpha = 1;
    // Darker, polished tips.
    const tips = g.createLinearGradient(0, 0, Ls, 0);
    tips.addColorStop(0, 'rgba(40, 20, 8, 0.55)');
    tips.addColorStop(0.16, 'rgba(40, 20, 8, 0)');
    tips.addColorStop(0.84, 'rgba(40, 20, 8, 0)');
    tips.addColorStop(1, 'rgba(40, 20, 8, 0.55)');
    g.fillStyle = tips;
    g.fillRect(0, 0, Ls, Ws);
    g.restore();
    // The well, and the bobbin of weft in it.
    const wx = Ls * 0.27;
    const ww = Ls * 0.46;
    const wy = Ws * 0.24;
    const wh = Ws * 0.52;
    g.fillStyle = '#2a170b';
    g.beginPath();
    g.roundRect(wx, wy, ww, wh, wh * 0.4);
    g.fill();
    const rgb = YARNS[yarn].rgb;
    const by = wy + wh * 0.14;
    const bh = wh * 0.72;
    const bob = g.createLinearGradient(0, by, 0, by + bh);
    bob.addColorStop(0, shade(rgb, 1.25));
    bob.addColorStop(0.45, shade(rgb, 1));
    bob.addColorStop(1, shade(rgb, 0.5));
    g.fillStyle = bob;
    g.beginPath();
    g.roundRect(wx + ww * 0.08, by, ww * 0.84, bh, bh * 0.45);
    g.fill();
    g.strokeStyle = shade(rgb, 0.6);
    g.lineWidth = 0.7;
    for (let x = wx + ww * 0.1; x < wx + ww * 0.9; x += 2.2) {
      g.beginPath();
      g.moveTo(x, by + 0.5);
      g.lineTo(x + 1.6, by + bh - 0.5);
      g.stroke();
    }
    // A highlight along the rim.
    g.strokeStyle = 'rgba(255, 236, 205, 0.5)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Ls * 0.08, Ws * 0.36);
    g.bezierCurveTo(Ls * 0.25, Ws * 0.08, Ls * 0.75, Ws * 0.08, Ls * 0.92, Ws * 0.36);
    g.stroke();
    this.shuttles.set(key, c);
    return c;
  }

  private draw() {
    const g = this.g;
    const L = this.L;
    const { W, H, dpr, p, clothX, clothW, rail, fellY, beamY, beamR } = L;
    const now = performance.now();
    const a = this.active;
    const t = a ? clamp01((now - a.t0) / a.dur) : 0;

    // Shed: 0 closed, 1 open.
    const shed = a ? Math.min(ease(span(t, OPEN[0], OPEN[1])), 1 - ease(span(t, CLOSE[0], CLOSE[1]))) : 0;
    // Beater: 0 at rest, 1 at the fell.
    const beat = a ? (t < BEAT[1] ? easeIn(span(t, BEAT[0], BEAT[1])) : 1 - ease(span(t, BACK[0], BACK[1]))) : 0;
    const struck = a ? a.fired.has('impact') : false;
    // The cloth gives way by a row as the beater comes in, then the new row fills the gap.
    const give = a && !struck ? easeIn(span(t, BEAT[0], BEAT[1])) * p : 0;
    const lifted = a ? a.lifted : this.preview;
    const liftAmt = a ? shed : this.preview ? 0.35 : 0;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    // The dark of the loom's inside.
    const back = g.createLinearGradient(0, 0, 0, H);
    back.addColorStop(0, '#0d0907');
    back.addColorStop(0.45, '#1a130e');
    back.addColorStop(1, '#120d0a');
    g.fillStyle = back;
    g.fillRect(0, 0, W, H);

    const reedFace = L.reedFaceRest + beat * (fellY + p - L.reedFaceRest);
    const raceY = reedFace;
    const cx = W / 2;
    const ends = this.warp.threading.length;
    const xAt = (j: number, y: number) => {
      const xf = clothX + (j + 0.5) * p;
      const k = 1 - 0.1 * clamp01((fellY - y) / fellY);
      return cx + (xf - cx) * k;
    };

    // The race, under the warp, in front of the reed.
    this.wood(g, 0, raceY, W, L.raceH, 0.62, 'h');
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.fillRect(0, raceY + L.raceH - 3, W, 3);

    // The warp: the lowered layer first, then whatever is in the shed, then the raised layer.
    const warpBottom = fellY + give;
    const drawEnds = (up: boolean) => {
      for (let j = 0; j < ends; j++) {
        const isUp = lifted ? lifted[j] === 1 : false;
        if (isUp !== up) continue;
        const rgb = YARNS[this.warp.yarns[j]].rgb;
        const k = isUp ? 1 + 0.2 * liftAmt : 1 - 0.32 * liftAmt;
        const w = p * (0.6 + (isUp ? 0.1 * liftAmt : 0));
        const xt = xAt(j, 0);
        const xb = xAt(j, warpBottom);
        g.lineWidth = w;
        g.strokeStyle = shade(rgb, 0.62 * k);
        g.beginPath();
        g.moveTo(xt, 0);
        g.lineTo(xb, warpBottom);
        g.stroke();
        g.lineWidth = w * 0.32;
        g.strokeStyle = shade(rgb, 1.06 * k);
        g.beginPath();
        g.moveTo(xt - w * 0.16, 0);
        g.lineTo(xb - w * 0.16, warpBottom);
        g.stroke();
      }
    };
    drawEnds(false);

    // The cloth.
    this.drawCloth(g, give);

    // The weft in the shed and the shuttle.
    const shY = raceY + L.raceH * 0.5;
    if (a) {
      const rgb = YARNS[a.pick.yarn].rgb;
      const fly = ease(span(t, THROW[0], THROW[1]));
      const startX = a.from < 0 ? clothX - L.shuttleL * 0.3 : clothX + clothW + L.shuttleL * 0.3;
      const endX = a.from < 0 ? clothX + clothW + L.shuttleL * 0.3 : clothX - L.shuttleL * 0.3;
      const sx = startX + (endX - startX) * fly;
      const entry = a.from < 0 ? clothX - p * 0.3 : clothX + clothW + p * 0.3;
      const tail =
        a.from < 0
          ? Math.min(sx - L.shuttleL * 0.5, clothX + clothW + p * 0.3)
          : Math.max(sx + L.shuttleL * 0.5, clothX - p * 0.3);
      if (!struck && t > THROW[0]) {
        const wy = t < BEAT[0] ? shY : reedFace - p * 0.5;
        g.lineWidth = p * 0.72;
        g.strokeStyle = shade(rgb, 0.8);
        g.beginPath();
        g.moveTo(entry, wy);
        g.quadraticCurveTo((entry + tail) / 2, wy + (t < BEAT[0] ? p * 0.6 : 0), tail, wy);
        g.stroke();
        g.lineWidth = p * 0.22;
        g.strokeStyle = shade(rgb, 1.15);
        g.beginPath();
        g.moveTo(entry, wy - p * 0.15);
        g.quadraticCurveTo((entry + tail) / 2, wy - p * 0.15 + (t < BEAT[0] ? p * 0.6 : 0), tail, wy - p * 0.15);
        g.stroke();
      }
      const shX = t < THROW[0] ? startX : t > THROW[1] ? endX : sx;
      this.drawShuttle(g, a.pick.yarn, shX, raceY + (L.raceH - L.shuttleW) / 2);
    } else {
      const parked = this.shuttleSide < 0 ? clothX - L.shuttleL * 0.3 : clothX + clothW + L.shuttleL * 0.3;
      const next = this.nextYarn ?? 0;
      this.drawShuttle(g, next, parked, raceY + (L.raceH - L.shuttleW) / 2);
    }

    drawEnds(true);

    // Distance: the back of the loom falls into shadow.
    const fog = g.createLinearGradient(0, 0, 0, reedFace - L.reedH - L.handH);
    fog.addColorStop(0, 'rgba(8, 5, 3, 0.62)');
    fog.addColorStop(0.4, 'rgba(8, 5, 3, 0.3)');
    fog.addColorStop(1, 'rgba(8, 5, 3, 0)');
    g.fillStyle = fog;
    g.fillRect(0, 0, W, reedFace - L.reedH - L.handH);

    // The heddles: four shafts, each end through an eye on its own shaft.
    this.drawHeddles(g, lifted, liftAmt, xAt);

    // The beater: the reed, and the handtree above it.
    this.drawBeater(g, reedFace);

    // The side frames.
    this.wood(g, 0, 0, rail, H, 0.5, 'v');
    this.wood(g, W - rail, 0, rail, H, 0.5, 'v');
    const sideShade = g.createLinearGradient(0, 0, rail, 0);
    sideShade.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
    sideShade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = sideShade;
    g.fillRect(0, 0, rail, H);
    g.save();
    g.translate(W, 0);
    g.scale(-1, 1);
    g.fillRect(0, 0, rail, H);
    g.restore();

    // The breast beam, over the side frames.
    this.drawBeam(g);

    // The linen tester.
    if (this.pointer) this.drawLoupe(g, give);
    void beamY;
    void beamR;
  }

  /** The yarn on the shuttle while it waits. */
  nextYarn: number | null = null;

  private wood(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, dir: 'h' | 'v') {
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    if (dir === 'h') g.drawImage(this.grainH, 0, 0, 900, 120, x, y, w, Math.max(h, 40));
    else {
      g.translate(x + w, y);
      g.rotate(Math.PI / 2);
      g.drawImage(this.grainV, 0, 0, 900, 120, 0, 0, this.L.H, Math.max(w, 40));
    }
    g.restore();
    if (k < 1) {
      g.fillStyle = `rgba(20, 12, 6, ${1 - k})`;
      g.fillRect(x, y, w, h);
    }
  }

  private drawShuttle(g: CanvasRenderingContext2D, yarn: number, cxs: number, y: number) {
    const img = this.shuttle(yarn);
    const { shuttleL, dpr } = this.L;
    g.drawImage(img, cxs - shuttleL / 2 - 4, y - 4, img.width / dpr, img.height / dpr);
  }

  private drawCloth(g: CanvasRenderingContext2D, give: number) {
    const { dpr, clothX, fellY, beamY, beamR } = this.L;
    const s = this.painter.s;
    const margin = Math.ceil(s * 3);
    const bw = this.buffer.width / dpr;
    const bx = clothX - margin / dpr;
    const flatH = beamY - fellY - give;
    if (flatH > 0) {
      g.drawImage(this.buffer, 0, 0, this.buffer.width, flatH * dpr, bx, fellY + give, bw, flatH);
    }
    // Light falls off a little toward the beam.
    const fall = g.createLinearGradient(0, fellY, 0, beamY);
    fall.addColorStop(0, 'rgba(255, 240, 220, 0.04)');
    fall.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
    fall.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
    g.fillStyle = fall;
    g.fillRect(bx, fellY + give, bw, Math.max(0, flatH));
    void beamR;
  }

  private drawBeam(g: CanvasRenderingContext2D) {
    const { W, H, dpr, clothX, fellY, beamY, beamR, rail } = this.L;
    const s = this.painter.s;
    const margin = Math.ceil(s * 3);
    const bw = this.buffer.width / dpr;
    const bx = clothX - margin / dpr;
    const give =
      this.active && !this.active.fired.has('impact')
        ? easeIn(span(this.progress() ?? 0, BEAT[0], BEAT[1])) * this.L.p
        : 0;

    // The beam's own wood, out past the cloth.
    const top = beamY - beamR * 0.12;
    this.wood(g, rail * 0.5, top, W - rail, H - top, 0.85, 'h');
    const roll = g.createLinearGradient(0, top, 0, H);
    roll.addColorStop(0, 'rgba(255, 236, 205, 0.32)');
    roll.addColorStop(0.18, 'rgba(255, 236, 205, 0.06)');
    roll.addColorStop(0.55, 'rgba(0, 0, 0, 0.25)');
    roll.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
    g.fillStyle = roll;
    g.fillRect(rail * 0.5, top, W - rail, H - top);

    // The cloth wrapping over it, foreshortened as it turns away.
    const base = beamY - fellY - give;
    const slices = Math.ceil(beamR * 0.98);
    for (let i = 0; i < slices; i++) {
      const y0 = beamY + i;
      const th0 = Math.asin(Math.min(1, i / beamR));
      const th1 = Math.asin(Math.min(1, (i + 1) / beamR));
      const src0 = (base + beamR * th0) * dpr;
      const src1 = (base + beamR * th1) * dpr;
      if (src1 > this.buffer.height) break;
      g.drawImage(this.buffer, 0, src0, this.buffer.width, Math.max(0.5, src1 - src0), bx, y0, bw, 1.02);
    }
    // Light catches the cloth where it bends over the top of the beam.
    const wrap = g.createLinearGradient(0, beamY, 0, beamY + beamR);
    wrap.addColorStop(0, 'rgba(255, 240, 220, 0)');
    wrap.addColorStop(0.09, 'rgba(255, 240, 220, 0.17)');
    wrap.addColorStop(0.22, 'rgba(255, 240, 220, 0)');
    wrap.addColorStop(0.5, 'rgba(0, 0, 0, 0.25)');
    wrap.addColorStop(1, 'rgba(0, 0, 0, 0.82)');
    g.fillStyle = wrap;
    g.fillRect(bx, beamY, bw, beamR);
    g.fillStyle = '#0b0806';
    g.fillRect(rail * 0.5, beamY + beamR * 0.98, W - rail, H);
  }

  private drawHeddles(
    g: CanvasRenderingContext2D,
    lifted: Uint8Array | null,
    amt: number,
    xAt: (j: number, y: number) => number,
  ) {
    const { W, p, heddleTop, shaftGap } = this.L;
    const ends = this.warp.threading.length;
    // Which shafts are up: any end on them is raised.
    const up = new Array(SHAFTS).fill(false);
    if (lifted) for (let j = 0; j < ends; j++) if (lifted[j]) up[this.warp.threading[j]] = true;
    for (let s = SHAFTS - 1; s >= 0; s--) {
      const rise = up[s] ? amt * Math.max(3, shaftGap * 0.45) : 0;
      // Shaft 1 is nearest the weaver.
      const y = heddleTop + (SHAFTS - 1 - s) * shaftGap - rise;
      const k = up[s] ? 1 + amt * 0.5 : 1;
      // The heddle bar.
      g.fillStyle = shade([128, 132, 138], 0.75 * k);
      g.fillRect(0, y - 1.5, W, 3);
      g.fillStyle = `rgba(230, 235, 240, ${0.3 * k})`;
      g.fillRect(0, y - 1.5, W, 1);
      // An eye for every end threaded on this shaft.
      for (let j = 0; j < ends; j++) {
        if (this.warp.threading[j] !== s) continue;
        const x = xAt(j, y);
        g.strokeStyle = `rgba(206, 212, 218, ${Math.min(1, 0.62 * k)})`;
        g.lineWidth = Math.max(0.7, p * 0.1);
        g.beginPath();
        g.moveTo(x, y - shaftGap * 0.42);
        g.lineTo(x, y - p * 0.45);
        g.moveTo(x, y + p * 0.45);
        g.lineTo(x, y + shaftGap * 0.42);
        g.stroke();
        g.beginPath();
        g.ellipse(x, y, Math.max(1.2, p * 0.42), Math.max(1.6, p * 0.5), 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  private drawBeater(g: CanvasRenderingContext2D, reedFace: number) {
    const { W, p, clothX, clothW, reedH, handH } = this.L;
    const reedTop = reedFace - reedH;
    // The reed: steel dents the warp passes between.
    const steel = g.createLinearGradient(0, reedTop, 0, reedFace);
    steel.addColorStop(0, 'rgba(70, 74, 80, 0.85)');
    steel.addColorStop(0.5, 'rgba(150, 156, 164, 0.55)');
    steel.addColorStop(1, 'rgba(60, 64, 70, 0.8)');
    g.fillStyle = steel;
    g.fillRect(0, reedTop, W, reedH);
    g.strokeStyle = 'rgba(225, 230, 236, 0.55)';
    g.lineWidth = Math.max(0.6, p * 0.12);
    g.beginPath();
    const from = clothX - p * 6;
    const to = clothX + clothW + p * 6;
    for (let x = from; x <= to; x += p) {
      g.moveTo(x, reedTop + 1);
      g.lineTo(x, reedFace - 1);
    }
    g.stroke();
    // The handtree.
    const top = reedTop - handH;
    this.wood(g, 0, top, W, handH, 0.95, 'h');
    const round = g.createLinearGradient(0, top, 0, reedTop);
    round.addColorStop(0, 'rgba(255, 238, 210, 0.35)');
    round.addColorStop(0.4, 'rgba(255, 238, 210, 0.05)');
    round.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    g.fillStyle = round;
    g.fillRect(0, top, W, handH);
    g.fillStyle = 'rgba(0, 0, 0, 0.4)';
    g.fillRect(0, reedFace, W, 2);
  }

  /** A weaver's pick glass: a square of exactly one centimetre of cloth, magnified, for counting threads. */
  private drawLoupe(g: CanvasRenderingContext2D, give: number) {
    const pt = this.pointer;
    if (!pt) return;
    const { dpr, p, clothX, clothW, fellY, beamY } = this.L;
    if (pt.x < clothX || pt.x > clothX + clothW || pt.y < fellY || pt.y > beamY) return;
    const n = this.picks.length;
    const ends = this.warp.threading.length;
    const lp = Math.max(13, Math.round(p * 2.6));
    const cells = SETT;
    const win = cells * lp;
    // The window's cloth: centred on the pointer, kept inside the woven cloth.
    let j0 = Math.round((pt.x - clothX) / p - cells / 2);
    j0 = Math.max(0, Math.min(ends - cells, j0));
    let i0 = Math.round((pt.y - fellY - give) / p - cells / 2);
    i0 = Math.max(0, Math.min(n - cells, i0));
    if (n < cells) return;

    const key = `${lp}:${j0}:${i0}:${n}`;
    if (key !== this.loupeKey) {
      this.loupeKey = key;
      if (!this.loupePainter || this.loupePainter.s !== Math.round(lp * dpr))
        this.loupePainter = new ClothPainter(lp * dpr);
      const lpS = this.loupePainter.s;
      this.loupe.width = cells * lpS;
      this.loupe.height = cells * lpS;
      const lg = this.loupe.getContext('2d')!;
      lg.fillStyle = GAP;
      lg.fillRect(0, 0, this.loupe.width, this.loupe.height);
      for (let r = 0; r < cells; r++) {
        const k = n - 1 - (i0 + r);
        this.loupePainter.paintRow(
          lg,
          -j0 * lpS,
          r * lpS,
          this.warp,
          this.picks[k],
          this.picks[k + 1] ?? null,
          this.picks[k - 1] ?? null,
        );
      }
    }

    // Float the glass up and left of the pointer, so a finger doesn't cover it.
    const gap = 18;
    let x = pt.x - win - gap;
    let y = pt.y - win - gap;
    if (x < 8) x = pt.x + gap;
    if (y < 8) y = pt.y + gap;
    const rim = Math.max(7, lp * 0.55);

    g.save();
    g.shadowColor = 'rgba(0, 0, 0, 0.55)';
    g.shadowBlur = 18;
    g.shadowOffsetY = 6;
    const brass = g.createLinearGradient(x - rim, y - rim, x + win + rim, y + win + rim);
    brass.addColorStop(0, '#f1d48f');
    brass.addColorStop(0.45, '#b98a3e');
    brass.addColorStop(0.7, '#e4c27a');
    brass.addColorStop(1, '#7d5a22');
    g.fillStyle = brass;
    g.beginPath();
    g.roundRect(x - rim, y - rim, win + rim * 2, win + rim * 2, rim * 0.8);
    g.fill();
    g.restore();

    g.drawImage(this.loupe, x, y, win, win);
    // Lens glare.
    const glare = g.createRadialGradient(x + win * 0.3, y + win * 0.25, 0, x + win * 0.3, y + win * 0.25, win * 0.8);
    glare.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
    glare.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = glare;
    g.fillRect(x, y, win, win);
    g.strokeStyle = 'rgba(60, 40, 10, 0.8)';
    g.lineWidth = 1;
    g.strokeRect(x - 0.5, y - 0.5, win + 1, win + 1);
    // Ticks on the rim, one per thread.
    g.strokeStyle = 'rgba(50, 32, 8, 0.85)';
    g.lineWidth = 1;
    g.beginPath();
    for (let k = 0; k <= cells; k++) {
      const len = k % 4 === 0 ? rim * 0.7 : rim * 0.4;
      g.moveTo(x + k * lp, y - 1);
      g.lineTo(x + k * lp, y - 1 - len);
      g.moveTo(x - 1, y + k * lp);
      g.lineTo(x - 1 - len, y + k * lp);
    }
    g.stroke();
    // The pointer's own spot on the cloth.
    g.strokeStyle = 'rgba(255, 236, 200, 0.55)';
    g.lineWidth = 1;
    g.strokeRect(clothX + j0 * p, fellY + give + i0 * p, cells * p, cells * p);
  }

  /** Where a canvas point falls on the cloth, for pointer handling. */
  onCloth(x: number, y: number): boolean {
    const { clothX, clothW, fellY, beamY } = this.L;
    return x >= clothX && x <= clothX + clothW && y >= fellY && y <= beamY;
  }
}
