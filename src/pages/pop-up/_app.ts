// Pop-up: every sheet of card is one HTML element placed by matrix3d. The
// fold kinematics in _geom.ts move them; the lamp lights each plane by its
// angle and distance, and every plane casts a shadow, cut windows and all,
// onto every other plane that faces the lamp.

import {
  DEG,
  add,
  backOf,
  dot,
  layer,
  leafDir,
  lerp,
  matrix,
  mul,
  norm,
  normalOf,
  sub,
  vfold,
  wingFrame,
  type Frame,
  type Pt,
  type Spread,
  type V3,
} from './_geom';
import { H, SPREADS, T, W, type Piece } from './_book';
import { clipX, pathData, type Ring } from './_shapes';

type RGB = [number, number, number];

const SVGNS = 'http://www.w3.org/2000/svg';
const LEAVES = SPREADS.length;
const PAPER: RGB = [0.95, 0.935, 0.9];
const CLOTH: RGB = [0.2, 0.25, 0.3];
const TABLE: RGB = [0.3, 0.24, 0.19];
const EDGE: RGB = [0.86, 0.84, 0.79];
const DAY: RGB = [0.2, 0.21, 0.26];
const NIGHT: RGB = [0.07, 0.08, 0.13];
/** Room light: dimmed as the bridge by night opens, so the lamp is all there is. */
const AMBIENT: RGB = [...DAY];
const LAMP: RGB = [1, 0.92, 0.8];
/** Lamp strength: direct light is K * cos / distance^2. */
const K = 4.6e5;
/** Camera tilt from straight down, and its turn about the table; a portrait screen looks down more steeply. */
let TILT = 56 * DEG;
let YAW = -11 * DEG;

interface Face {
  w: number;
  h: number;
  /** Cut outline and holes in the front side's px. */
  rings: Ring[];
  frame: Frame;
  front: HTMLElement;
  back: HTMLElement;
  frontShade: SVGGElement | null;
  backShade: SVGGElement | null;
  frontBase: RGB;
  backBase: RGB;
  /** How much lamp light shows through from the other side. */
  glow: number;
  visible: boolean;
  casts: boolean;
  /** Front texture layers, drawn over the light. */
  frontTex: string;
  backTex: string;
  /** World-space rings, filled each frame for casting. */
  world?: V3[][];
}

const faces: Face[] = [];

function el(cls: string, w: number, h: number): HTMLElement {
  const e = document.createElement('div');
  e.className = cls;
  e.style.width = `${w}px`;
  e.style.height = `${h}px`;
  return e;
}

function shadeLayer(host: HTMLElement, w: number, h: number): SVGGElement {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'pp-shade');
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('filter', 'url(#pp-soft)');
  svg.append(g);
  host.append(svg);
  return g;
}

const mirrorRings = (rings: Ring[], w: number): Ring[] => rings.map((r) => r.map(([x, y]) => [w - x, y] as Pt));

interface FaceOpts {
  w: number;
  h: number;
  rings?: Ring[];
  front?: string;
  back?: string;
  frontBase?: RGB;
  backBase?: RGB;
  glow?: number;
  casts?: boolean;
  receives?: boolean;
  cls?: string;
  frontTex?: string;
  backTex?: string;
}

function addFace(world: HTMLElement, o: FaceOpts): Face {
  const rings = o.rings ?? [
    [
      [0, 0],
      [o.w, 0],
      [o.w, o.h],
      [0, o.h],
    ],
  ];
  const cls = `pp-face ${o.cls ?? ''}`;
  const front = el(cls, o.w, o.h);
  const back = el(`${cls} pp-back`, o.w, o.h);
  if (o.rings) {
    front.style.clipPath = `path(evenodd, '${pathData(rings)}')`;
    back.style.clipPath = `path(evenodd, '${pathData(mirrorRings(rings, o.w))}')`;
  }
  if (o.front) front.insertAdjacentHTML('beforeend', o.front);
  if (o.back) back.insertAdjacentHTML('beforeend', o.back);
  const receives = o.receives ?? true;
  const face: Face = {
    w: o.w,
    h: o.h,
    rings,
    frame: { o: [0, 0, 0], ex: [1, 0, 0], ey: [0, -1, 0] },
    front,
    back,
    frontShade: receives ? shadeLayer(front, o.w, o.h) : null,
    backShade: receives ? shadeLayer(back, o.w, o.h) : null,
    frontBase: o.frontBase ?? PAPER,
    backBase: o.backBase ?? o.frontBase ?? PAPER,
    glow: o.glow ?? 0.3,
    visible: true,
    casts: o.casts ?? true,
    frontTex: o.frontTex ?? 'var(--pp-grain)',
    backTex: o.backTex ?? o.frontTex ?? 'var(--pp-grain)',
  };
  world.append(front, back);
  faces.push(face);
  return face;
}

// ---------------------------------------------------------------------------
// Pencil marks as SVG.

const pencil = (w: number, h: number, inner: string, cls = 'pp-art') =>
  `<svg class="${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;

const polyPath = (lines: Pt[][]) =>
  lines.map((l) => `<path d="M${l.map(([x, y]) => `${+x.toFixed(1)} ${+y.toFixed(1)}`).join('L')}" />`).join('');

/** Split pencil strokes at the middle fold, keeping the part on one side. */
function strokesOn(lines: Pt[][], keep: 'neg' | 'pos'): Pt[][] {
  const inside = (p: Pt) => (keep === 'pos' ? p[0] >= 0 : p[0] <= 0);
  const out: Pt[][] = [];
  for (const l of lines) {
    let cur: Pt[] = [];
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      if (i > 0) {
        const q = l[i - 1];
        if (inside(p) !== inside(q)) {
          const t = q[0] / (q[0] - p[0]);
          const m: Pt = [0, q[1] + (p[1] - q[1]) * t];
          cur.push(m);
          if (!inside(p)) {
            out.push(cur);
            cur = [];
          } else cur = [m];
        }
      }
      if (inside(p)) cur.push(p);
    }
    if (cur.length > 1) out.push(cur);
  }
  return out;
}

/** Glue lines on a page, in that page's px. */
function glueMarks(pieces: Piece[], side: 'l' | 'r'): string {
  const toPx = (x: number, y: number): Pt => [side === 'r' ? x : x + W, H / 2 - y];
  let s = '';
  for (const p of pieces) {
    if (p.kind === 'v') {
      const ext = Math.max(...p.rings[0].map(([x]) => (side === 'r' ? x : -x)));
      const dir: Pt = [(side === 'r' ? 1 : -1) * Math.sin(p.alpha * DEG), p.sense * Math.cos(p.alpha * DEG)];
      const a = toPx(0, p.y0);
      const b = toPx(dir[0] * ext, p.y0 + dir[1] * ext);
      s += `<path class="glue" d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}" />`;
    } else {
      const x = side === 'r' ? p.d : -p.d;
      const a = toPx(x, p.y0);
      const b = toPx(x, p.y1);
      s += `<path class="glue" d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}" />`;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Pieces: each knows how to place its faces for a spread pose.

interface Placed {
  spread: number;
  faces: Face[];
  place: (s: Spread) => void;
}

function buildPiece(world: HTMLElement, p: Piece, spread: number): Placed {
  if (p.kind === 'v') {
    const outer = p.rings[0];
    const wl = Math.max(...outer.map(([x]) => -x));
    const wr = Math.max(...outer.map(([x]) => x));
    const top = Math.max(...p.rings.flat().map(([, y]) => y)) + 1;
    const wing = (keep: 'neg' | 'pos') => {
      const shift = keep === 'neg' ? wl : 0;
      const rings = p.rings.map((r) => clipX(r, keep)).filter((r) => r.length);
      const px = rings.map((r) => r.map(([x, y]) => [x + shift, top - y] as Pt));
      const marks = strokesOn(p.marks ?? [], keep).map((l) => l.map(([x, y]) => [x + shift, top - y] as Pt));
      const w = keep === 'neg' ? wl : wr;
      return addFace(world, {
        w,
        h: top,
        rings: px,
        front: marks.length ? pencil(w, top, polyPath(marks), 'pp-art pp-marks') : '',
        cls: 'pp-piece',
      });
    };
    const left = wing('neg');
    const right = wing('pos');
    return {
      spread,
      faces: [left, right],
      place: (s) => {
        const pose = vfold(s, p.y0, p.alpha, p.beta, p.sense);
        left.frame = wingFrame(pose, 'l', top, wl);
        right.frame = wingFrame(pose, 'r', top, wr);
      },
    };
  }
  const L = p.y1 - p.y0;
  const deckLines = p.deck ?? [];
  const deckHalf = (keep: 'l' | 'r') => {
    const lines = deckLines
      .filter((l) => (keep === 'l' ? l[0][0] < p.d : l[0][0] >= p.d))
      .map((l) => l.map(([x, y]) => [keep === 'l' ? x : x - p.d, y] as Pt));
    return lines.length ? pencil(p.d, L, polyPath(lines), 'pp-art pp-marks') : '';
  };
  const wallL = addFace(world, { w: L, h: p.h, cls: 'pp-piece' });
  const deckL = addFace(world, { w: p.d, h: L, cls: 'pp-piece', front: deckHalf('l') });
  const deckR = addFace(world, { w: p.d, h: L, cls: 'pp-piece', front: deckHalf('r') });
  const wallR = addFace(world, { w: L, h: p.h, cls: 'pp-piece' });
  const xz = (v: V3): V3 => [v[0], 0, v[2]];
  return {
    spread,
    faces: [wallL, deckL, deckR, wallR],
    place: (s) => {
      const q = layer(s, p.d, p.h);
      const wall = (foot: V3, head: V3): Frame => ({
        o: [head[0], p.y0, head[2]],
        ex: [0, 1, 0],
        ey: norm(sub(xz(foot), xz(head))),
      });
      wallL.frame = wall(q.p1, q.a1);
      wallR.frame = wall(q.p2, q.b1);
      deckL.frame = { o: [q.a1[0], p.y1, q.a1[2]], ex: norm(sub(xz(q.m), xz(q.a1))), ey: [0, -1, 0] };
      deckR.frame = { o: [q.m[0], p.y1, q.m[2]], ex: norm(sub(xz(q.b1), xz(q.m))), ey: [0, -1, 0] };
    },
  };
}

// ---------------------------------------------------------------------------
// Light.

const rgb = (base: RGB, light: RGB) =>
  `rgb(${base.map((b, i) => Math.round(255 * Math.pow(Math.min(1, b * light[i]), 0.85))).join(' ')})`;

const lightAt = (i: number): RGB => [AMBIENT[0] + i * LAMP[0], AMBIENT[1] + i * LAMP[1], AMBIENT[2] + i * LAMP[2]];

const RINGS = [0, 0.25, 0.5, 0.8, 1.2, 1.7, 2.4, 3.4, 5];

/** A radial gradient for a lit plane: brightest at the lamp's foot, falling off as cos / d^2. */
function lighting(f: Frame, w: number, h: number, lamp: V3, base: RGB, glow: number): { css: string; direct: number } {
  const rel = sub(lamp, f.o);
  const n = normalOf(f);
  const hl = dot(rel, n);
  const lit = hl > 0 ? 1 : glow;
  const hh = Math.max(1, Math.abs(hl));
  const fx = dot(rel, f.ex);
  const fy = dot(rel, f.ey);
  const stops = RINGS.map((k) => {
    const r = k * hh;
    const i = (lit * K * hh) / Math.pow(hh * hh + r * r, 1.5);
    return `${rgb(base, lightAt(i))} ${Math.round(r)}px`;
  });
  // Direct light at the middle of the face, for how dark its shadows read.
  const dx = fx - w / 2;
  const dy = fy - h / 2;
  const direct = (lit * K * hh) / Math.pow(hh * hh + dx * dx + dy * dy, 1.5);
  return { css: `radial-gradient(circle at ${fx.toFixed(1)}px ${fy.toFixed(1)}px, ${stops.join(', ')})`, direct };
}

// ---------------------------------------------------------------------------
// Shadows: clip each caster to the slab between the receiver's plane and the
// lamp, then project it from the lamp onto the plane.

function clipPlane(ring: V3[], o: V3, n: V3, min: number, max: number): V3[] {
  let pts = ring;
  for (const [bound, keepAbove] of [
    [min, true],
    [max, false],
  ] as const) {
    const out: V3[] = [];
    const f = (p: V3) => dot(sub(p, o), n) - bound;
    const inside = (p: V3) => (keepAbove ? f(p) >= 0 : f(p) <= 0);
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      if (inside(cur) !== inside(prev)) {
        const t = f(prev) / (f(prev) - f(cur));
        out.push(add(prev, mul(sub(cur, prev), t)));
      }
      if (inside(cur)) out.push(cur);
    }
    pts = out;
    if (pts.length < 3) return [];
  }
  return pts;
}

function castOnto(recv: Face, side: Frame, lamp: V3, casters: Face[]): string {
  const n = normalOf(side);
  const hl = dot(sub(lamp, side.o), n);
  let d = '';
  for (const c of casters) {
    if (c === recv || !c.world) continue;
    let part = '';
    for (const ring of c.world) {
      const kept = clipPlane(ring, side.o, n, 0.6, hl - 2);
      if (!kept.length) continue;
      part +=
        'M' +
        kept
          .map((p) => {
            const toP = sub(p, lamp);
            const s = dot(sub(side.o, lamp), n) / dot(toP, n);
            const hit = sub(add(lamp, mul(toP, s)), side.o);
            return `${dot(hit, side.ex).toFixed(1)} ${dot(hit, side.ey).toFixed(1)}`;
          })
          .join('L') +
        'Z';
    }
    if (part) d += `<path d="${part}" />`;
  }
  return d;
}

// ---------------------------------------------------------------------------

export function mount(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>('[data-stage]')!;
  const world = root.querySelector<HTMLElement>('[data-world]')!;
  const where = root.querySelector<HTMLElement>('[data-where]')!;
  const prev = root.querySelector<HTMLButtonElement>('[data-prev]')!;
  const next = root.querySelector<HTMLButtonElement>('[data-next]')!;
  const coverLabel = root.querySelector<HTMLTemplateElement>('[data-cover]')!.innerHTML;

  // The table, under everything.
  // The table takes light and shadows, and fades into the dark at its edges.
  const TW = 2400;
  const near = addFace(world, {
    w: TW,
    h: 1800,
    frontBase: TABLE,
    glow: 0,
    casts: false,
    cls: 'pp-table pp-far',
    frontTex: 'var(--pp-wood)',
  });
  near.frame = { o: [-TW / 2, 900, -T - 0.4], ex: [1, 0, 0], ey: [0, -1, 0] };

  // The board edges of each half of the book block.
  const edgeFront = [0, 1].map(() =>
    addFace(world, {
      w: W,
      h: 10,
      frontBase: EDGE,
      glow: 0,
      casts: false,
      receives: false,
      frontTex: 'var(--pp-edge)',
    }),
  );
  const edgeSide = [0, 1].map(() =>
    addFace(world, {
      w: H,
      h: 10,
      frontBase: EDGE,
      glow: 0,
      casts: false,
      receives: false,
      frontTex: 'var(--pp-edge)',
    }),
  );

  // Leaves: the cover, then a board per spread; the back board never turns.
  const art = (inner: string) => pencil(W, H, inner);
  const leaves: Face[] = [];
  for (let i = 0; i < LEAVES; i++) {
    const front = i === 0 ? coverLabel : art(SPREADS[i - 1].right + glueMarks(SPREADS[i - 1].pieces, 'r'));
    const back = art(SPREADS[i].left + glueMarks(SPREADS[i].pieces, 'l'));
    leaves.push(
      addFace(world, {
        w: W,
        h: H,
        front,
        back,
        frontBase: i === 0 ? CLOTH : PAPER,
        backBase: PAPER,
        glow: i === 0 ? 0 : 0.22,
        cls: 'pp-leaf',
        frontTex: i === 0 ? 'var(--pp-cloth)' : 'var(--pp-grain)',
        backTex: 'var(--pp-grain)',
      }),
    );
  }
  const lastSpread = SPREADS[LEAVES - 1];
  const backBoard = addFace(world, {
    w: W,
    h: H,
    front: art(lastSpread.right + glueMarks(lastSpread.pieces, 'r')),
    cls: 'pp-leaf',
    glow: 0,
  });

  const pieces: Placed[] = [];
  SPREADS.forEach((s, k) => s.pieces.forEach((p) => pieces.push(buildPiece(world, p, k + 1))));

  // -------------------------------------------------------------------------
  // State.

  let t = 0;
  let target = 0;
  let vel = 0;
  const lamp: V3 = [-230, -470, 700];
  let scale = 1;
  let persp = 2000;
  let ox = 0;
  let oy = 0;
  let dirty = true;

  const zRight = (i: number) => (LEAVES - i) * T;
  const zLeft = (i: number) => i * T;
  const phiOf = (i: number) => 180 * Math.min(1, Math.max(0, t - i));

  function layout() {
    const vw = stage.clientWidth;
    const vh = stage.clientHeight;
    const narrow = vw < 640;
    const portrait = vh > vw * 1.2;
    TILT = (portrait ? 46 : 56) * DEG;
    YAW = (portrait ? -7 : -11) * DEG;
    // The open spread, turned by the yaw, plus room for the perspective's nearer edge.
    const across = 2 * W * Math.cos(YAW) + H * Math.abs(Math.sin(YAW));
    scale = Math.min(
      1.4,
      (vw - (narrow ? 16 : 40)) / (across * (narrow ? 1.3 : 1.04)),
      (vh - (narrow ? 150 : 170)) / (H * Math.cos(TILT) + 230),
    );
    persp = 1700 * scale;
    stage.style.perspective = `${persp}px`;
    dirty = true;
  }

  function cameraOffset() {
    // A shut book sits centred; an open one centres on its spine.
    const shut = Math.max(0, 1 - t * 1.6);
    ox = (-W / 2) * scale * shut;
    oy = 70 * scale;
    world.style.transform =
      `translate3d(${ox.toFixed(2)}px, ${oy.toFixed(2)}px, 0) scale(${scale.toFixed(4)}) ` +
      `rotateX(${TILT}rad) rotateZ(${YAW}rad)`;
  }

  /** Screen position of a world point, by the same transforms the world element gets. */
  function project(p: V3): Pt {
    const r = stage.getBoundingClientRect();
    const X0 = p[0];
    const Y0 = -p[1];
    const X = X0 * Math.cos(YAW) - Y0 * Math.sin(YAW);
    const Yc = X0 * Math.sin(YAW) + Y0 * Math.cos(YAW);
    const Z = p[2];
    const y1 = Yc * Math.cos(TILT) - Z * Math.sin(TILT);
    const z1 = Yc * Math.sin(TILT) + Z * Math.cos(TILT);
    const qz = scale * z1;
    const k = persp / (persp - qz);
    return [r.left + r.width / 2 + (scale * X + ox) * k, r.top + r.height / 2 + (scale * y1 + oy) * k];
  }

  /** The world point under a screen point, on the level plane at height z0. */
  function unproject(cx: number, cy: number, z0: number): Pt {
    const r = stage.getBoundingClientRect();
    const sx = cx - (r.left + r.width / 2);
    const sy = cy - (r.top + r.height / 2);
    const sn = Math.sin(TILT);
    const cs = Math.cos(TILT);
    const P = persp;
    const s = scale;
    const y = (P * oy - sy * P - P * s * z0 * sn + sy * s * z0 * cs) / (s * (sy * sn + P * cs));
    const qz = s * (-y * sn + z0 * cs);
    const xr = (sx * ((P - qz) / P) - ox) / s;
    const yr = -y;
    // Undo the yaw.
    const X = xr * Math.cos(YAW) + yr * Math.sin(YAW);
    const Yc = -xr * Math.sin(YAW) + yr * Math.cos(YAW);
    return [X, -Yc];
  }

  // -------------------------------------------------------------------------
  // Each frame: pose the leaves and pieces, light them, cast shadows.

  function render() {
    cameraOffset();
    const dusk = Math.max(0, Math.min(1, t - (LEAVES - 1)));
    for (let i = 0; i < 3; i++) AMBIENT[i] = lerp(DAY[i], NIGHT[i], dusk);
    const phis = leaves.map((_, i) => phiOf(i));
    const hinge = (i: number) => lerp(zRight(i), zLeft(i), phis[i] / 180);
    leaves.forEach((f, i) => {
      f.frame = { o: [0, H / 2, hinge(i)], ex: leafDir(phis[i]), ey: [0, -1, 0] };
      const coveredRight = i > 0 && phis[i - 1] < 0.01 && phis[i] < 0.01;
      const coveredLeft = i < LEAVES - 1 && phis[i + 1] > 179.99 && phis[i] > 179.99;
      f.visible = !coveredRight && !coveredLeft;
    });
    backBoard.frame = { o: [0, H / 2, 0], ex: [1, 0, 0], ey: [0, -1, 0] };
    backBoard.visible = phis[LEAVES - 1] > 0.01;

    // Book block edges.
    const rightTop = phis.filter((p) => p < 0.01).length * T;
    const leftTop = phis.filter((p) => p > 179.99).length * T;
    const blocks: [number, number][] = [
      [rightTop + T, 1],
      [leftTop, -1],
    ];
    blocks.forEach(([hgt, side], j) => {
      const f = edgeFront[j];
      const g = edgeSide[j];
      f.visible = g.visible = hgt > 0.5;
      const top = hgt - T;
      f.frame = { o: [side > 0 ? 0 : -W, -H / 2, top], ex: [1, 0, 0], ey: [0, 0, -1] };
      g.frame =
        side > 0
          ? { o: [W, -H / 2, top], ex: [0, 1, 0], ey: [0, 0, -1] }
          : { o: [-W, H / 2, top], ex: [0, -1, 0], ey: [0, 0, -1] };
      for (const e of [f, g]) {
        e.h = Math.max(1, hgt);
        e.front.style.height = e.back.style.height = `${e.h}px`;
      }
    });

    // Spreads.
    for (const pc of pieces) {
      const k = pc.spread;
      const phiL = phis[k - 1];
      const phiR = k < LEAVES ? phis[k] : 0;
      const open = phiL - phiR > 1.2;
      for (const f of pc.faces) f.visible = open;
      if (!open) continue;
      const pose: Spread = {
        hl: [0, 0, hinge(k - 1)],
        hr: [0, 0, k < LEAVES ? hinge(k) : 0],
        a: leafDir(phiL),
        b: leafDir(phiR),
      };
      pc.place(pose);
    }

    // World rings for casters.
    const live = faces.filter((f) => f.visible);
    for (const f of live) {
      f.world = f.casts
        ? f.rings.map((r) => r.map(([x, y]) => add(f.frame.o, add(mul(f.frame.ex, x), mul(f.frame.ey, y)))))
        : undefined;
    }
    const casters = live.filter((f) => f.casts);

    for (const f of faces) {
      const show = f.visible ? '' : 'hidden';
      if (f.front.style.visibility !== show) f.front.style.visibility = f.back.style.visibility = show;
      if (!f.visible) continue;
      const fb = backOf(f.frame, f.w);
      f.front.style.transform = matrix(f.frame);
      f.back.style.transform = matrix(fb);
      const lf = lighting(f.frame, f.w, f.h, lamp, f.frontBase, f.glow);
      const lb = lighting(fb, f.w, f.h, lamp, f.backBase, f.glow);
      f.front.style.backgroundImage = `${f.frontTex}, ${lf.css}`;
      f.back.style.backgroundImage = `${f.backTex}, ${lb.css}`;
      f.front.style.setProperty('--lum', Math.min(1.15, 0.22 + lf.direct).toFixed(3));
      // Shadows land on whichever side faces the lamp.
      const frontLit = dot(sub(lamp, f.frame.o), normalOf(f.frame)) > 0;
      const [litSide, litShade, darkShade, direct] = frontLit
        ? [f.frame, f.frontShade, f.backShade, lf.direct]
        : [fb, f.backShade, f.frontShade, lb.direct];
      if (darkShade) darkShade.innerHTML = '';
      if (litShade) {
        litShade.innerHTML = castOnto(f, litSide, lamp, casters);
        const frac = direct / (direct + 0.22);
        litShade.setAttribute('opacity', (0.78 * frac).toFixed(3));
      }
    }

    const k = Math.round(t);
    where.textContent = k === 0 ? 'Cover' : `${k} · ${SPREADS[k - 1].title}`;
    prev.disabled = target <= 0;
    next.disabled = target >= LEAVES;
    root.dataset.open = String(k);
  }

  // -------------------------------------------------------------------------
  // Motion: a damped spring toward the target page.

  let last = performance.now();
  let raf = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function frame(now: number) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!drag && Math.abs(target - t) > 1e-4) {
      const k = reduced.matches ? 160 : 38;
      const c = 2 * Math.sqrt(k);
      vel += (k * (target - t) - c * vel) * dt;
      t += vel * dt;
      if (Math.abs(target - t) < 2e-4 && Math.abs(vel) < 0.01) {
        t = target;
        vel = 0;
      }
      t = Math.max(0, Math.min(LEAVES, t));
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      render();
    }
    if (dirty || drag || Math.abs(target - t) > 1e-4) raf = requestAnimationFrame(frame);
  }
  function kick() {
    dirty = true;
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  function goTo(k: number) {
    target = Math.max(0, Math.min(LEAVES, k));
    kick();
  }

  // -------------------------------------------------------------------------
  // Input: drag a page to turn it, or drag the table to move the lamp.

  let drag: null | {
    kind: 'turn' | 'lamp';
    id: number;
    x: number;
    /** Where on the page it was grabbed, in world x; 0 when grabbed mid-turn. */
    wx: number;
    reach: number;
    leaf: number;
    t0: number;
    moved: number;
    dir: number;
    hist: [number, number][];
  } = null;

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const onBook = (e.target as Element).closest('.pp-leaf, .pp-piece');
    const [wx] = unproject(e.clientX, e.clientY, LEAVES * T);
    let reach = 0;
    let kind: 'turn' | 'lamp' = onBook ? 'turn' : 'lamp';
    let leaf = 0;
    let dir = 1;
    if (kind === 'turn') {
      const settled = Math.abs(t - Math.round(t)) < 0.02;
      if (settled) {
        const k = Math.round(t);
        dir = wx >= 0 ? 1 : -1;
        leaf = dir > 0 ? k : k - 1;
        // The grabbed point stays under the pointer as the page swings over the spine.
        reach = Math.max(Math.abs(wx), W * 0.45);
        if (leaf < 0 || leaf >= LEAVES) kind = 'lamp';
      } else {
        leaf = Math.floor(t);
        dir = target > t ? 1 : -1;
      }
    }
    drag = {
      kind,
      id: e.pointerId,
      x: e.clientX,
      wx,
      reach,
      leaf,
      t0: t,
      moved: 0,
      dir,
      hist: [[performance.now(), t]],
    };
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {}
    if (kind === 'lamp') moveLamp(e.clientX, e.clientY);
    root.dataset.drag = kind;
    kick();
  });

  function moveLamp(cx: number, cy: number) {
    const [x, y] = unproject(cx, cy, -T);
    const r = Math.hypot(x, y);
    const max = 900;
    const k = r > max ? max / r : 1;
    lamp[0] = x * k;
    lamp[1] = Math.max(-900, Math.min(700, y * k));
    dirty = true;
  }

  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.moved = Math.max(drag.moved, Math.abs(e.clientX - drag.x));
    if (drag.kind === 'lamp') {
      moveLamp(e.clientX, e.clientY);
    } else {
      const [x] = unproject(e.clientX, e.clientY, LEAVES * T);
      const along = drag.reach
        ? Math.acos(Math.max(-1, Math.min(1, x / drag.reach))) / Math.PI
        : drag.t0 - drag.leaf + (drag.wx - x) / (2 * W);
      t = drag.leaf + Math.max(0, Math.min(1, along));
      target = t;
      drag.hist.push([performance.now(), t]);
      if (drag.hist.length > 6) drag.hist.shift();
    }
    kick();
  });

  function release(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    delete root.dataset.drag;
    if (d.kind === 'turn') {
      if (d.moved < 6) {
        target = d.dir > 0 ? d.leaf + 1 : d.leaf;
      } else {
        const [ta, va] = d.hist[0];
        const [tb, vb] = d.hist[d.hist.length - 1];
        const v = tb > ta ? ((vb - va) / (tb - ta)) * 1000 : 0;
        vel = v * 0.6;
        const along = t - d.leaf + v * 0.18;
        target = d.leaf + (along > 0.5 ? 1 : 0);
      }
    }
    kick();
  }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  prev.addEventListener('click', () => goTo(Math.round(target) - 1));
  next.addEventListener('click', () => goTo(Math.round(target) + 1));
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') goTo(Math.round(target) + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') goTo(Math.round(target) - 1);
    else return;
    e.preventDefault();
  });

  new ResizeObserver(() => {
    layout();
    kick();
  }).observe(stage);
  layout();
  kick();

  // A read-only handle for render checks.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { popup: unknown }).popup = {
      set(tt: number) {
        t = target = tt;
        vel = 0;
        kick();
      },
      lamp(x: number, y: number, z?: number) {
        lamp[0] = x;
        lamp[1] = y;
        if (z) lamp[2] = z;
        kick();
      },
      get t() {
        return t;
      },
      /** Screen position of a world point, for scripted drags. */
      project: (x: number, y: number, z: number) => project([x, y, z]),
    };
  }
}
