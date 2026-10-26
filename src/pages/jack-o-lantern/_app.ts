// The carving table: steps, tools, and input, the camera, the candle, and the
// lid, all driving the renderer in _gl.ts from the carving map in _carve.ts.

import { Carving, MAP_H, MAP_W, pickShell, unwrap, type Tool, type UV } from './_carve';
import { Renderer, type Frame, type Look } from './_gl';
import { boundaryRuns, PATTERNS, type Pattern, type Pt } from './_patterns';
import { maxRadius, outerRadius, restHeight, VARIETIES, wallAt, type Variety, type VarietyId } from './_shape';

type Step = 'choose' | 'lid' | 'carve' | 'lit';
type V3 = [number, number, number];

const TAU = Math.PI * 2;
const FOV = (30 * Math.PI) / 180;
const ELEV = 0.25;
const STORE = 'jack-o-lantern:v1';
const LID_BINS = 256;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wrap = (d: number) => d - Math.round(d);

// Rotations about the vertical axis, the same as toLocal/toWorld in the shader.
const toLocal = (v: V3, yaw: number): V3 => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c * v[0] - s * v[2], v[1], s * v[0] + c * v[2]];
};
const toWorld = (v: V3, yaw: number): V3 => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
};

// Smooth 1D noise for the flame.
const n1 = (t: number) => {
  const i = Math.floor(t);
  const f = t - i;
  const h = (k: number) => {
    const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
};

interface Geometry {
  vr: Variety;
  center: V3;
  rMax: number;
  floorY: number;
  stemBaseY: number;
  look: Look;
}

function geometry(vr: Variety): Geometry {
  const top = outerRadius(vr, 0, 1, 0).r;
  const bottom = outerRadius(vr, 0, -1, 0).r;
  return {
    vr,
    center: [0, restHeight(vr), 0],
    rMax: maxRadius(vr),
    floorY: -(bottom - wallAt(vr, Math.PI)) + 0.05,
    stemBaseY: top - 0.4,
    look: {
      a: vr.a,
      b: vr.b,
      boxy: vr.boxy,
      ribs: vr.ribs,
      ribDepth: vr.ribDepth,
      ribSharp: vr.ribSharp,
      dimpleTop: vr.dimpleTop,
      dimpleBottom: vr.dimpleBottom,
      wall: vr.wall,
      rind: vr.rind,
      seed: vr.seed,
      skin: vr.skin,
      groove: vr.groove,
      ground: vr.ground,
      flesh: vr.flesh,
      fleshSigma: vr.fleshSigma,
      rindSigma: vr.rindSigma,
      stem: [vr.stem.length, vr.stem.radius, vr.stem.bend, vr.stem.lean],
      stemColor: vr.stem.color,
      white: vr.id === 'lumina',
    },
  };
}

interface Job {
  kind: 'saw' | 'region' | 'lid';
  /** Seconds it takes. */
  dur: number;
  t: number;
  run: (from: number, to: number) => void;
  /** Where the tool is at a point in the job, for the brush ring. */
  at?: (t: number) => UV | null;
  done?: () => void;
}

export function start(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const stage = root.querySelector<HTMLElement>('[data-stage]')!;
  const brush = root.querySelector<HTMLElement>('[data-brush]')!;
  const say = root.querySelector<HTMLElement>('[data-say]')!;
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;

  let renderer: Renderer;
  try {
    renderer = new Renderer(canvas, MAP_W, MAP_H);
  } catch (err) {
    console.error(err);
    q<HTMLElement>('[data-unsupported]').hidden = false;
    return;
  }

  const debug = new URLSearchParams(location.search).has('debug');

  // ---- state -------------------------------------------------------------
  let geo = geometry(VARIETIES.howden);
  let carving = new Carving(geo.vr);
  let step: Step = 'choose';
  let tool: Tool = 'saw';
  let yaw = 0;
  let yawTarget = 0;
  let lidCut = false;
  let lidCone: [number, number] = [-1, -1];
  let lidSphere: [number, number] = [0, 1];
  let lidRest: V3 = [0, 0, 0];
  // 0: the lid sits on the pumpkin; 1: it rests on the table beside it.
  let lidPos = 0;
  let lidFrom = 0;
  let lidTo = 0;
  let lidAnim = 1;
  let lamp = 1;
  let lampTarget = 1;
  let candle = 0;
  let candleTarget = 0;
  let pattern: { p: Pattern; u: number; v: number; s: number } | null = null;
  const jobs: Job[] = [];
  let lidBins = new Float32Array(LID_BINS).fill(-1);
  let saveTimer = 0;
  // When the first cut was made: a carved pumpkin dries and goes mouldy over the following days.
  // ?days= shows it that many days on.
  let carvedAt: number | null = null;
  const daysParam = Number(new URLSearchParams(location.search).get('days'));
  const age = () =>
    Math.min(14, daysParam > 0 ? daysParam : carvedAt ? Math.max(0, (Date.now() - carvedAt) / 86_400_000) : 0);
  const noteCut = () => {
    carvedAt ??= Date.now();
  };

  const setLook = () => {
    renderer.setLook(geo.look);
  };
  setLook();
  renderer.uploadDepth(carving.data);

  // ---- camera ------------------------------------------------------------
  let cam = { pos: [0, 0, 0] as V3, right: [1, 0, 0] as V3, up: [0, 1, 0] as V3, fwd: [0, 0, -1] as V3 };
  const tanHalf = Math.tan(FOV / 2);
  const placeCamera = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const aspect = w / h;
    const vr = geo.vr;
    const top = geo.center[1] + vr.b + vr.stem.length;
    const target: V3 = [0, top * 0.46, 0];
    const halfH = top * 0.6 + 4;
    const halfW = vr.a * 1.55 + 4;
    const d = Math.max(halfH / tanHalf, halfW / (tanHalf * aspect)) * 1.04;
    const pos: V3 = [0, target[1] + d * Math.sin(ELEV), d * Math.cos(ELEV)];
    const fwd = norm(sub(target, pos));
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    cam = { pos, right, up, fwd };
  };

  // ---- lid geometry --------------------------------------------------------
  const measureLid = () => {
    lidCone = carving.lidCone();
    const vr = geo.vr;
    let minY = Infinity;
    let maxY = -Infinity;
    let maxXZ = 0;
    const hi = lidCone[1];
    for (let i = 0; i <= 8; i++) {
      const theta = (hi * i) / 8;
      for (let j = 0; j < 24; j++) {
        const phi = (j / 24) * TAU;
        const d: V3 = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
        const r = outerRadius(vr, ...d).r;
        for (const rr of [r, r - wallAt(vr, theta)]) {
          minY = Math.min(minY, d[1] * rr);
          maxY = Math.max(maxY, d[1] * rr);
          maxXZ = Math.max(maxXZ, Math.hypot(d[0], d[2]) * rr);
        }
      }
    }
    maxY = Math.max(maxY, geo.stemBaseY + vr.stem.length);
    const cy = (minY + maxY) / 2;
    const rad = Math.hypot(Math.max(maxXZ, vr.stem.radius * 2 + Math.abs(vr.stem.bend) + vr.stem.length * Math.abs(vr.stem.lean)), (maxY - minY) / 2) + 0.6;
    lidSphere = [cy, rad];
    // On the table to the right, a little behind the pumpkin.
    lidRest = [vr.a * 0.98 + maxXZ * 0.85, -geo.center[1] - minY + 0.05, -vr.a * 0.45];
  };

  const lidOffset = (): V3 => {
    const t = ease(lidPos);
    const lift = Math.sin(Math.PI * lidPos) * 7;
    return [lidRest[0] * t, lidRest[1] * t + lift, lidRest[2] * t];
  };

  const moveLid = (to: number) => {
    lidFrom = lidPos;
    lidTo = to;
    lidAnim = 0;
    wake();
  };

  // ---- picking -------------------------------------------------------------
  const rayAt = (cx: number, cy: number): { ro: V3; rd: V3 } => {
    const rect = canvas.getBoundingClientRect();
    const x = ((cx - rect.left) / rect.width) * 2 - 1;
    const y = 1 - ((cy - rect.top) / rect.height) * 2;
    const aspect = rect.width / rect.height;
    const rd = norm(add(cam.fwd, add(scale(cam.right, x * tanHalf * aspect), scale(cam.up, y * tanHalf))));
    return { ro: cam.pos, rd };
  };

  const sphere = (ro: V3, rd: V3, c: V3, r: number): [number, number] | null => {
    const oc = sub(ro, c);
    const b = dot(oc, rd);
    const h = b * b - (dot(oc, oc) - r * r);
    if (h < 0) return null;
    const s = Math.sqrt(h);
    return [-b - s, -b + s];
  };

  type Pick = { obj: 'body' | 'lid'; u: number; v: number; t: number; inner: boolean };
  const pick = (cx: number, cy: number): Pick | null => {
    const { ro, rd } = rayAt(cx, cy);
    let best: Pick | null = null;
    const rdL = toLocal(rd, yaw);
    const roB = toLocal(sub(ro, geo.center), yaw);
    const bb = sphere(roB, rdL, [0, 0, 0], geo.rMax);
    if (bb) {
      const h = pickShell(geo.vr, carving, roB, rdL, bb[0], bb[1], false);
      if (h) best = { obj: 'body', ...h };
    }
    if (lidCut) {
      const roL = toLocal(sub(ro, add(geo.center, lidOffset())), yaw);
      const lb = sphere(roL, rdL, [0, lidSphere[0], 0], lidSphere[1]);
      if (lb) {
        const h = pickShell(geo.vr, carving, roL, rdL, lb[0], Math.min(lb[1], best ? best.t : Infinity), true);
        if (h && (!best || h.t < best.t)) best = { obj: 'lid', ...h };
      }
    }
    return best;
  };

  /** Screen position of a point on the skin, for the brush ring during auto-carving. */
  const project = (u: number, v: number, obj: 'body' | 'lid' = 'body'): [number, number, number] | null => {
    const theta = v * Math.PI;
    const phi = (u - 0.5) * TAU;
    const d: V3 = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
    const r = outerRadius(geo.vr, ...d).r;
    const local = scale(d, r);
    const origin = obj === 'lid' ? add(geo.center, lidOffset()) : geo.center;
    const world = add(origin, toWorld(local, yaw));
    const rel = sub(world, cam.pos);
    const z = dot(rel, cam.fwd);
    if (z <= 0) return null;
    // Facing away from the camera: hidden.
    if (dot(toWorld(d, yaw), scale(rel, -1)) < 0) return null;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    const x = dot(rel, cam.right) / (z * tanHalf * aspect);
    const y = dot(rel, cam.up) / (z * tanHalf);
    return [((x + 1) / 2) * rect.width, ((1 - y) / 2) * rect.height, z];
  };

  // ---- the loop ------------------------------------------------------------
  let raf = 0;
  let last = performance.now();
  let renderScale = 1;
  let slow = 0;
  let fast = 0;
  let dirty = true;

  const wake = () => {
    dirty = true;
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    placeCamera();
    wake();
  };
  new ResizeObserver(resize).observe(stage);

  const frame = (now: number) => {
    raf = 0;
    const dt = Math.min(0.1, (now - last) / 1000);
    // Adapt the render size to keep up: drop it after a run of slow frames, raise it after fast ones.
    if (dt > 0.026) {
      slow++;
      fast = 0;
    } else if (dt < 0.019) {
      fast++;
      slow = 0;
    }
    if (slow > 4 && renderScale > 0.4) {
      renderScale = Math.max(0.4, renderScale * 0.85);
      slow = 0;
    }
    if (fast > 40 && renderScale < 1) {
      renderScale = Math.min(1, renderScale * 1.1);
      fast = 0;
    }
    last = now;
    let animating = false;

    yaw += (yawTarget - yaw) * Math.min(1, dt * 10);
    if (Math.abs(yawTarget - yaw) > 1e-4) animating = true;

    if (lidAnim < 1) {
      lidAnim = Math.min(1, lidAnim + dt / 1.1);
      lidPos = lidFrom + (lidTo - lidFrom) * lidAnim;
      animating = true;
    }
    const approach = (v: number, to: number, rate: number) => {
      if (Math.abs(to - v) < 1e-3) return to;
      animating = true;
      return v + (to - v) * Math.min(1, dt * rate);
    };
    lamp = approach(lamp, lampTarget, 3.5);
    candle = approach(candle, candleTarget, 2.2);

    // Auto-carving.
    if (jobs.length) {
      animating = true;
      const job = jobs[0];
      const from = job.t;
      job.t = Math.min(1, job.t + dt / job.dur);
      job.run(from, job.t);
      const at = job.at?.(job.t);
      const scr = at ? project(at[0], at[1]) : null;
      if (scr) {
        brush.style.transform = `translate(${scr[0]}px, ${scr[1]}px)`;
        brush.dataset.on = '';
      } else delete brush.dataset.on;
      if (job.t >= 1) {
        jobs.shift();
        job.done?.();
        if (!jobs.length) {
          delete brush.dataset.on;
          scheduleSave();
        }
      }
    }

    const d = carving.takeDirty();
    if (d) renderer.uploadDepth(carving.data, d[0], d[1], d[2] - d[0] + 1, d[3] - d[1] + 1);

    const lit = candle > 0.001;
    if (lit || animating || dirty) {
      dirty = false;
      draw(now / 1000);
    }
    if (lit || animating) raf = requestAnimationFrame(frame);
  };

  const draw = (time: number) => {
    const flick = 0.82 + 0.13 * n1(time * 6.3) + 0.08 * n1(time * 17.1 + 4) - 0.06 * Math.max(0, n1(time * 0.7) - 0.75) * 4;
    const sway: V3 = [(n1(time * 2.1) - 0.5) * 0.35, (n1(time * 5.3 + 2) - 0.5) * 0.2, (n1(time * 1.7 + 9) - 0.5) * 0.35];
    const f: Frame = {
      time,
      camPos: cam.pos,
      camRight: cam.right,
      camUp: cam.up,
      camFwd: cam.fwd,
      tanHalf,
      center: geo.center,
      yaw,
      hasLid: lidCut,
      lidOffset: lidOffset(),
      lidCone,
      lidSphere,
      lamp,
      candle: candle * flick,
      flame: [sway[0], geo.floorY + 1.55 + 1.35 + sway[1], sway[2]],
      floorY: geo.floorY,
      stemBaseY: geo.stemBaseY,
      rMax: geo.rMax,
      exposure: 1.0 + (1 - lamp) * 0.7,
      age: age(),
    };
    const w = Math.max(1, Math.round(canvas.width * renderScale));
    const h = Math.max(1, Math.round(canvas.height * renderScale));
    renderer.render(f, w, h);
  };

  // ---- steps ------------------------------------------------------------------
  const panels = [...root.querySelectorAll<HTMLElement>('[data-for]')];
  const marks = [...root.querySelectorAll<HTMLElement>('[data-step-mark]')];
  const order: Step[] = ['choose', 'lid', 'carve', 'lit'];
  const setStep = (s: Step, message?: string) => {
    step = s;
    root.dataset.step = s;
    for (const p of panels) p.hidden = p.dataset.for !== s;
    const idx = order.indexOf(s);
    for (const m of marks) {
      const i = order.indexOf(m.dataset.stepMark as Step);
      m.dataset.state = i < idx ? 'done' : i === idx ? 'now' : 'next';
    }
    say.textContent = message ?? defaultSay[s];
    delete brush.dataset.on;
    canvas.setAttribute('aria-label', label());
    updateButtons();
    scheduleSave();
  };
  const defaultSay: Record<Step, string> = {
    choose: 'Pick a pumpkin to carve.',
    lid: 'Saw all the way round the stem to take the lid off.',
    carve: 'Carve the side facing you. Drag on the table, or use the arrows, to turn it.',
    lit: 'Turn the face toward the wall and it is thrown up behind the pumpkin.',
  };
  const label = () =>
    step === 'lit'
      ? `A carved ${geo.vr.name} pumpkin lit from inside by a candle`
      : `A ${geo.vr.name} pumpkin on a wooden table under a lamp`;

  const undoBtn = q<HTMLButtonElement>('[data-undo]');
  const autoBtn = q<HTMLButtonElement>('[data-auto-carve]');
  const lampBtn = q<HTMLButtonElement>('[data-lamp]');
  const updateButtons = () => {
    undoBtn.disabled = !carving.canUndo || jobs.length > 0;
    autoBtn.disabled = !pattern || jobs.length > 0;
    lampBtn.setAttribute('aria-pressed', String(lampTarget > 0.5));
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-pattern]')) {
      b.setAttribute('aria-pressed', String(pattern?.p.id === b.dataset.pattern));
    }
  };

  // ---- choosing ------------------------------------------------------------------
  const resetPumpkin = (id: VarietyId) => {
    geo = geometry(VARIETIES[id]);
    carving = new Carving(geo.vr);
    carvedAt = null;
    lidCut = false;
    lidCone = [-1, -1];
    lidPos = 0;
    lidAnim = 1;
    lidBins = new Float32Array(LID_BINS).fill(-1);
    pattern = null;
    jobs.length = 0;
    yaw = yawTarget = 0;
    setLook();
    renderer.uploadDepth(carving.data);
    placeCamera();
    wake();
  };

  for (const input of root.querySelectorAll<HTMLInputElement>('input[name=variety]')) {
    input.addEventListener('change', () => {
      if (input.checked) {
        resetPumpkin(input.value as VarietyId);
        setStep('choose');
      }
    });
  }

  // The ring the lid is cut along: pricked round the stem, with a notch at the back so it goes back on the right way.
  const lidTheta = () => (geo.vr.id === 'cinderella' ? 0.62 : 0.56);
  const lidGuide = (): UV[] => {
    const pts: UV[] = [];
    const n = 160;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const back = Math.abs(wrap(u - 0.0));
      const notch = Math.max(0, 1 - back / 0.025) * 0.045;
      pts.push([u, (lidTheta() + notch) / Math.PI]);
    }
    return pts;
  };

  q('[data-take]').addEventListener('click', () => {
    carving.prick(lidGuide(), true, 0.42);
    carving.endStroke();
    setStep('lid');
    wake();
  });

  q('[data-back]').addEventListener('click', () => {
    resetPumpkin(geo.vr.id);
    setStep('choose');
  });

  // ---- the lid ---------------------------------------------------------------------
  const noteLidStroke = (path: UV[]) => {
    for (let i = 0; i + 1 < path.length; i++) {
      const [a, b] = [path[i], path[i + 1]];
      if (a[1] > 0.45 && b[1] > 0.45) continue;
      const steps = Math.max(1, Math.ceil(Math.abs(wrap(b[0] - a[0])) * LID_BINS * 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const u = a[0] + wrap(b[0] - a[0]) * t;
        const v = a[1] + (b[1] - a[1]) * t;
        const bin = ((Math.floor(u * LID_BINS) % LID_BINS) + LID_BINS) % LID_BINS;
        lidBins[bin] = Math.max(lidBins[bin], v);
      }
    }
    const covered = lidBins.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0);
    if (covered === LID_BINS) finishLid();
    else if (covered > 0) {
      const pct = Math.round((covered / LID_BINS) * 100);
      say.textContent = `About ${pct}% of the way round. Turn the pumpkin to reach the back and keep going.`;
    }
  };

  const finishLid = () => {
    // Fill tiny gaps between neighbouring bins, then mark everything above the cut as lid.
    const edge = new Float32Array(LID_BINS);
    for (let i = 0; i < LID_BINS; i++) edge[i] = lidBins[i];
    carving.markLidBins(edge);
    lidCut = true;
    measureLid();
    renderer.uploadDepth(carving.data);
    moveLid(1);
    setStep('carve', 'The lid is off. Now carve the side facing you.');
  };

  q('[data-auto-lid]').addEventListener('click', () => {
    if (jobs.length) return;
    const ring = lidGuide();
    const front = ring.length;
    jobs.push({
      kind: 'lid',
      dur: 2.6,
      t: 0,
      run: (a, b) => {
        const i0 = Math.floor(a * front);
        const i1 = Math.floor(b * front);
        for (let i = i0; i < i1; i++) carving.line('saw', ring[i], ring[(i + 1) % front]);
      },
      at: (t) => ring[Math.min(front - 1, Math.floor(t * front))],
      done: () => {
        noteLidStroke([...ring, ring[0]]);
      },
    });
    updateButtons();
    wake();
  });

  // ---- tools and strokes ---------------------------------------------------------------
  for (const input of root.querySelectorAll<HTMLInputElement>('input[name=tool]')) {
    input.addEventListener('change', () => {
      if (input.checked) tool = input.value as Tool;
    });
  }

  let stroke: { obj: 'body' | 'lid'; path: UV[]; tool: Tool } | null = null;
  let drag: { x: number; yaw: number } | null = null;
  let pointerId = -1;

  const toolRadius = () => (step === 'lid' || tool === 'saw' ? 0.25 : tool === 'gouge' ? 0.75 : 0.7);

  const showBrush = (cx: number, cy: number, t: number | null) => {
    if (t === null || step === 'choose' || step === 'lit') {
      delete brush.dataset.on;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const px = (toolRadius() / (t * tanHalf)) * (rect.height / 2);
    const size = Math.max(8, px * 2);
    brush.style.width = brush.style.height = `${size}px`;
    brush.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
    brush.style.transform = `translate(${cx - rect.left}px, ${cy - rect.top}px)`;
    brush.dataset.on = '';
  };

  const carvingSteps = () => step === 'lid' || step === 'carve';

  canvas.addEventListener('pointerdown', (e) => {
    if (pointerId !== -1 || jobs.length) return;
    canvas.focus({ preventScroll: true });
    const hit = carvingSteps() ? pick(e.clientX, e.clientY) : null;
    pointerId = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured.
    }
    if (hit && !hit.inner) {
      const t: Tool = step === 'lid' ? 'saw' : tool;
      if (step === 'lid' && hit.v > 0.45) {
        say.textContent = 'Cut the lid near the top, round the stem.';
      }
      carving.beginStroke();
      stroke = { obj: hit.obj, path: [[hit.u, hit.v]], tool: t };
      carving.tool(t, hit.u, hit.v);
      wake();
    } else {
      drag = { x: e.clientX, yaw: yawTarget };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) {
      if (pointerId === -1 && carvingSteps() && !jobs.length) {
        const hit = pick(e.clientX, e.clientY);
        showBrush(e.clientX, e.clientY, hit && !hit.inner ? hit.t : null);
      }
      return;
    }
    if (drag) {
      const rect = canvas.getBoundingClientRect();
      yawTarget = drag.yaw + ((e.clientX - drag.x) / rect.width) * Math.PI * 1.6;
      wake();
      return;
    }
    if (!stroke) return;
    const hit = pick(e.clientX, e.clientY);
    showBrush(e.clientX, e.clientY, hit && !hit.inner ? hit.t : null);
    if (!hit || hit.inner || hit.obj !== stroke.obj) return;
    const prev = stroke.path[stroke.path.length - 1];
    const uv: UV = [hit.u, hit.v];
    // Ignore jumps across the far side or a hole: they aren't one cut.
    const [su, sv] = carving.scales(prev[0], prev[1]);
    if (Math.hypot(wrap(uv[0] - prev[0]) * su, (uv[1] - prev[1]) * sv) > 6) return;
    carving.line(stroke.tool, prev, uv, e.pressure > 0 && e.pointerType === 'pen' ? 0.4 + e.pressure : 1);
    stroke.path.push(uv);
    wake();
  });

  const endPointer = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = -1;
    drag = null;
    const s = stroke;
    stroke = null;
    if (!s) return;
    if (s.tool === 'saw') finishSaw(s.path, s.obj);
    if (step === 'carve') noteCut();
    carving.endStroke();
    updateButtons();
    scheduleSave();
    wake();
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => {
    if (pointerId === -1) delete brush.dataset.on;
  });

  const pathLength = (path: UV[]) => {
    let len = 0;
    for (let i = 0; i + 1 < path.length; i++) {
      const [su, sv] = carving.scales(path[i][0], path[i][1]);
      len += Math.hypot(wrap(path[i + 1][0] - path[i][0]) * su, (path[i + 1][1] - path[i][1]) * sv);
    }
    return len;
  };

  const finishSaw = (path: UV[], obj: 'body' | 'lid') => {
    if (step === 'lid') {
      if (obj === 'body') noteLidStroke(path);
      return;
    }
    if (path.length < 3) return;
    const len = pathLength(path);
    const a = path[0];
    const b = path[path.length - 1];
    const [su, sv] = carving.scales(a[0], a[1]);
    const gap = Math.hypot(wrap(b[0] - a[0]) * su, (b[1] - a[1]) * sv);
    if (len > 2 && gap < Math.max(1.2, len * 0.15)) {
      carving.line('saw', b, a);
      carving.cutOut([unwrap(path)]);
      say.textContent = 'Cut out. Undo puts it back.';
    } else if (len > 2) {
      say.textContent = 'To take a piece out, saw all the way round it and end where you began.';
    }
  };

  // ---- turning ----------------------------------------------------------------------------
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-turn-by]')) {
    b.addEventListener('click', () => {
      yawTarget += Number(b.dataset.turnBy) * (Math.PI / 4);
      wake();
    });
  }
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      yawTarget += (e.key === 'ArrowLeft' ? -1 : 1) * (Math.PI / 12);
      e.preventDefault();
      wake();
    }
  });

  // ---- patterns -------------------------------------------------------------------------
  // The longitude facing the camera, where a pattern goes.
  const frontU = () => {
    const toCam = toLocal(sub(cam.pos, geo.center), yaw);
    return Math.atan2(toCam[2], toCam[0]) / TAU + 0.5;
  };

  const toUV = (pt: Pt, at: { u: number; v: number; s: number }): UV => {
    const [, sv] = carving.scales(at.u, at.v);
    const v = at.v - (pt[1] * at.s) / sv;
    const [su] = carving.scales(at.u, v);
    return [at.u + (pt[0] * at.s) / su, v];
  };

  const placePattern = (p: Pattern) => {
    const vr = geo.vr;
    const s = Math.min(1, vr.b / 13.4, vr.a / 14.5);
    const at = { u: frontU(), v: 0.5 - 0.035, s };
    carving.beginStroke();
    for (const r of p.regions) {
      for (const run of boundaryRuns(r)) carving.prick(run.map((pt) => toUV(pt, at)), false);
    }
    carving.endStroke();
    pattern = { p, ...at };
    say.textContent = `${p.name} is pricked onto the skin. Carve along the holes, or let the kit do it.`;
    updateButtons();
    scheduleSave();
    wake();
  };

  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-pattern]')) {
    b.addEventListener('click', () => {
      const p = PATTERNS.find((x) => x.id === b.dataset.pattern);
      if (p && !jobs.length) placePattern(p);
    });
  }

  const order2 = (d: string) => (d === 'skin' ? 0 : d === 'thin' ? 1 : 2);
  const queuePattern = (speed = 1) => {
    if (!pattern) return;
    const at = pattern;
    const vr = geo.vr;
    const depthOf = {
      cut: () => 4,
      thin: (theta: number) => wallAt(vr, theta) - 0.45,
      skin: () => vr.rind + 0.14,
    };
    // Shading first, then the cuts, the way carvers do it.
    const regions = [...at.p.regions].sort((a, b) => order2(a.depth) - order2(b.depth));
    carving.beginStroke();
    for (const r of regions) {
      const add = r.add.map((poly) => unwrap(poly.map((pt) => toUV(pt, at))));
      const subs = (r.sub ?? []).map((poly) => unwrap(poly.map((pt) => toUV(pt, at))));
      if (r.depth === 'cut') {
        for (const poly of add) {
          const ring = [...poly, poly[0]];
          const n = ring.length - 1;
          jobs.push({
            kind: 'saw',
            dur: Math.max(0.5, (pathLength(ring) / 14) * speed),
            t: 0,
            run: (a, b) => {
              const i0 = Math.floor(a * n);
              const i1 = b >= 1 ? n : Math.floor(b * n);
              for (let i = i0; i < i1; i++) carving.line('saw', ring[i], ring[i + 1]);
              if (b >= 1) carving.cutOut([poly], subs);
            },
            at: (t) => ring[Math.min(n, Math.floor(t * n))],
          });
        }
      } else {
        const depth = depthOf[r.depth];
        jobs.push({
          kind: 'region',
          dur: (r.depth === 'thin' ? 2.4 : 1.6) * speed,
          t: 0,
          run: (_a, b) => {
            carving.carveTo(add, subs, depth, b);
            // Finish along the outline, which takes the pin holes with it.
            if (b >= 1) for (const run of boundaryRuns(r)) carving.edge(run.map((pt) => toUV(pt, at)), depth);
          },
          at: (t) => {
            const p = add[0];
            const lo = Math.min(...p.map((x) => x[1]));
            const hi = Math.max(...p.map((x) => x[1]));
            const v = lo + (hi - lo) * t;
            const row = p.filter((x) => Math.abs(x[1] - v) < (hi - lo) * 0.2);
            const us = (row.length ? row : p).map((x) => x[0]);
            const u0 = Math.min(...us);
            const u1 = Math.max(...us);
            return [u0 + (u1 - u0) * (0.5 + 0.45 * Math.sin(t * 60)), v];
          },
        });
      }
    }
    const lastJob = jobs[jobs.length - 1];
    const prevDone = lastJob?.done;
    if (lastJob) {
      lastJob.done = () => {
        prevDone?.();
        carving.endStroke();
        say.textContent = `${at.p.name} is carved. Light the candle to see it glow.`;
        noteCut();
        updateButtons();
      };
    }
    say.textContent = `Carving ${at.p.name}…`;
    updateButtons();
    wake();
  };

  autoBtn.addEventListener('click', () => {
    if (!jobs.length) queuePattern();
  });

  undoBtn.addEventListener('click', () => {
    if (jobs.length) return;
    carving.undo();
    updateButtons();
    scheduleSave();
    wake();
  });

  // ---- lighting -------------------------------------------------------------------------
  const lightUp = () => {
    if (jobs.length) return;
    if (lidCut) moveLid(0);
    lampTarget = 0;
    candleTarget = 1;
    setStep('lit');
    wake();
  };
  q('[data-light-up]').addEventListener('click', lightUp);

  lampBtn.addEventListener('click', () => {
    lampTarget = lampTarget > 0.5 ? 0 : 1;
    lampBtn.textContent = lampTarget > 0.5 ? 'Lamp off' : 'Lamp on';
    updateButtons();
    wake();
  });

  q('[data-carve-more]').addEventListener('click', () => {
    lampTarget = 1;
    candleTarget = 0;
    lampBtn.textContent = 'Lamp on';
    setStep('carve', 'The candle is out and the lamp is on. Carve some more.');
    wake();
  });

  q('[data-new]').addEventListener('click', () => {
    lampTarget = 1;
    candleTarget = 0;
    lampBtn.textContent = 'Lamp on';
    resetPumpkin(geo.vr.id);
    setStep('choose');
  });

  q('[data-photo]').addEventListener('click', () => {
    draw(performance.now() / 1000);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'jack-o-lantern.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  });

  // ---- keeping it between visits ----------------------------------------------------------
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), 600);
  };

  const save = async () => {
    if (jobs.length || stroke) return;
    try {
      const meta = { variety: geo.vr.id, step, lidCut, lidBins: [...lidBins], yaw: yawTarget, carvedAt };
      let map: string | null = null;
      if ('CompressionStream' in window) {
        const stream = new Blob([carving.data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        const buf = new Uint8Array(await new Response(stream).arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        map = btoa(s);
      }
      localStorage.setItem(STORE, JSON.stringify({ ...meta, map }));
    } catch {
      // Storage is a convenience; the page works without it.
    }
  };

  const restore = async (): Promise<boolean> => {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return false;
      const s = JSON.parse(raw) as {
        variety: VarietyId;
        step: Step;
        lidCut: boolean;
        lidBins: number[];
        yaw: number;
        carvedAt?: number | null;
        map: string | null;
      };
      if (!VARIETIES[s.variety] || !s.map || !('DecompressionStream' in window)) return false;
      const bin = Uint8Array.from(atob(s.map), (c) => c.charCodeAt(0));
      const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const data = new Uint8Array(await new Response(stream).arrayBuffer());
      if (data.length !== MAP_W * MAP_H * 2) return false;
      resetPumpkin(s.variety);
      for (const input of root.querySelectorAll<HTMLInputElement>('input[name=variety]')) input.checked = input.value === s.variety;
      carving.data.set(data);
      lidBins = Float32Array.from(s.lidBins);
      lidCut = s.lidCut;
      carvedAt = typeof s.carvedAt === 'number' ? s.carvedAt : null;
      const days = Math.floor(age());
      const since =
        days < 1
          ? ''
          : `Carved ${days === 1 ? 'a day' : `${days} days`} ago. ` +
            (days >= 3 ? 'The cuts have dried brown, and there is mould on them. ' : 'The cut edges are drying out. ');
      if (lidCut) {
        measureLid();
        lidPos = s.step === 'lit' ? 0 : 1;
      }
      yaw = yawTarget = s.yaw || 0;
      renderer.uploadDepth(carving.data);
      if (s.step === 'lit') {
        lampTarget = lamp = 0;
        candleTarget = 1;
        lampBtn.textContent = 'Lamp on';
        setStep('lit', since || 'Still here from your last visit. Drag to turn it round.');
      } else {
        setStep(
          s.step === 'choose' ? 'choose' : s.step,
          s.step === 'choose' ? undefined : since || 'Your pumpkin is where you left it.',
        );
      }
      wake();
      return true;
    } catch {
      return false;
    }
  };

  setStep('choose');
  resize();
  void restore();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      last = performance.now();
      wake();
    }
  });

  if (debug) {
    (window as unknown as { lantern: unknown }).lantern = {
      get state() {
        return { step, tool, yaw, lidCut, lidCone, lidPos, lamp, candle, jobs: jobs.length, renderScale, variety: geo.vr.id };
      },
      variety: (id: VarietyId) => {
        resetPumpkin(id);
        setStep('choose');
      },
      take: () => q<HTMLButtonElement>('[data-take]').click(),
      autoLid: () => q<HTMLButtonElement>('[data-auto-lid]').click(),
      pattern: (id: string) => {
        const p = PATTERNS.find((x) => x.id === id);
        if (p) placePattern(p);
      },
      carvePattern: (speed = 0.05) => queuePattern(speed),
      finishJobs: () => {
        while (jobs.length) {
          const job = jobs.shift()!;
          job.run(job.t, 1);
          job.done?.();
        }
        wake();
      },
      light: lightUp,
      lamp: (on: boolean) => {
        lampTarget = lamp = on ? 1 : 0;
        wake();
      },
      settle: () => {
        lamp = lampTarget;
        candle = candleTarget;
        lidPos = lidTo;
        lidAnim = 1;
        yaw = yawTarget;
        wake();
      },
      turn: (a: number) => {
        yawTarget = yaw = a;
        wake();
      },
      tool: (t: Tool) => {
        tool = t;
      },
      stroke: (t: Tool, pts: [number, number][]) => {
        carving.beginStroke();
        for (let i = 0; i + 1 < pts.length; i++) carving.line(t, pts[i], pts[i + 1]);
        if (t === 'saw') finishSaw(pts, 'body');
        carving.endStroke();
        updateButtons();
        wake();
      },
      pick: (x: number, y: number) => pick(x, y),
      get carving() {
        return carving;
      },
      upload: () => {
        renderer.uploadDepth(carving.data);
        wake();
      },
      // A region of the canvas in device pixels, read straight after drawing it, as a PNG data URL.
      crop: (x: number, y: number, w: number, h: number) => {
        draw(performance.now() / 1000);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d')?.drawImage(canvas, x, y, w, h, 0, 0, w, h);
        return c.toDataURL('image/png');
      },
      project: (u: number, v: number) => {
        const p = project(u, v);
        const r = canvas.getBoundingClientRect();
        return p ? [p[0] + r.left, p[1] + r.top] : null;
      },
      frontU,
      scale: (s: number) => {
        renderScale = s;
        wake();
      },
    };
  }
}
