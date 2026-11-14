// Drawing a frame: on the canvas while it moves, and as an SVG file to take away.
// Both read the same geometry, so the file is the diagram on the screen.

import type { Graph } from './_graph';
import { NAME_SIZE, type Label } from './_labels';
import { GAP, LINE, offsetLine, type Frame, type Scene } from './_scene';

export const INK = '#15171a';
const PAPER = '#ffffff';
const CASING = 0.07;
const CORNER = 0.55;
export const FONT_STACK = "'Signika', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
let family = FONT_STACK;

/** The canvas can't read CSS variables, so the page passes in the resolved font family. */
export function setFamily(f: string): void {
  if (f.trim()) family = f;
}
export function getFamily(): string {
  return family;
}

export interface View {
  /** CSS pixels per layout unit. */
  scale: number;
  ox: number;
  oy: number;
}

type Cmd = ['M', number, number] | ['L', number, number] | ['Q', number, number, number, number];

/** A polyline with its corners rounded off, as move, line, and quadratic commands. */
export function roundedPath(p: number[], radius: number): Cmd[] {
  const count = p.length / 2;
  const out: Cmd[] = [['M', p[0], p[1]]];
  for (let i = 1; i < count - 1; i++) {
    const x = p[i * 2];
    const y = p[i * 2 + 1];
    const ax = p[i * 2 - 2];
    const ay = p[i * 2 - 1];
    const bx = p[i * 2 + 2];
    const by = p[i * 2 + 3];
    const l1 = Math.hypot(x - ax, y - ay);
    const l2 = Math.hypot(bx - x, by - y);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const cos = ((x - ax) * (bx - x) + (y - ay) * (by - y)) / (l1 * l2);
    const turn = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (turn < 0.02) {
      out.push(['L', x, y]);
      continue;
    }
    const cut = Math.min(radius * Math.tan(turn / 2), l1 * 0.45, l2 * 0.45);
    const px = x - ((x - ax) / l1) * cut;
    const py = y - ((y - ay) / l1) * cut;
    const qx = x + ((bx - x) / l2) * cut;
    const qy = y + ((by - y) / l2) * cut;
    out.push(['L', px, py], ['Q', x, y, qx, qy]);
  }
  out.push(['L', p[p.length - 2], p[p.length - 1]]);
  return out;
}

/** Marker radius for each station: the interchange ring, or the reach of a tick. */
export function markerSizes(g: Graph): Float64Array {
  const n = g.names.length;
  const r = new Float64Array(n);
  const bundle = new Int32Array(n);
  for (const c of g.chains) {
    const m = c.lines.length;
    for (const s of [g.keys[c.a], g.keys[c.b], ...c.inner]) bundle[s] = Math.max(bundle[s], m);
  }
  for (let s = 0; s < n; s++) {
    if (!g.served[s].length) continue;
    const width = (Math.max(1, bundle[s]) - 1) * GAP + LINE;
    r[s] = isInterchange(g, s) ? width / 2 + 0.13 : width / 2 + 0.2;
  }
  return r;
}

export function isInterchange(g: Graph, s: number): boolean {
  return (g.served[s].length > 1 && g.keyOf[s] >= 0) || g.walk[s] === 1;
}

interface StationGeom {
  /** Unit direction of the line through the station. */
  dx: number;
  dy: number;
  /** Bundle half-width and the line offsets present at the station (for ticks on single lines). */
  half: number;
  line: number;
  offset: number;
  end: boolean;
}

function stationGeometry(scene: Scene, fr: Frame): Map<number, StationGeom> {
  const { g } = scene;
  const out = new Map<number, StationGeom>();
  // How many chain ends meet at each station: one means the end of a line.
  const ends = new Map<number, number>();
  for (const c of g.chains)
    for (const k of [c.a, c.b]) ends.set(g.keys[k], (ends.get(g.keys[k]) ?? 0) + 1);
  fr.chains.forEach((c, ci) => {
    const chain = g.chains[ci];
    const ids = [g.keys[chain.a], ...chain.inner, g.keys[chain.b]];
    const count = c.pts.length / 2;
    ids.forEach((s, j) => {
      const inner = j > 0 && j < ids.length - 1;
      if (!inner && out.has(s)) return;
      const pi = c.at[j];
      const i0 = Math.max(0, pi - 1);
      const i1 = Math.min(count - 1, pi + 1);
      let dx = c.pts[i1 * 2] - c.pts[i0 * 2];
      let dy = c.pts[i1 * 2 + 1] - c.pts[i0 * 2 + 1];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      out.set(s, {
        dx,
        dy,
        half: ((c.lines.length - 1) * GAP + LINE) / 2,
        line: c.lines[0],
        offset: c.offsets[0] ?? 0,
        end: !inner && ends.get(s) === 1,
      });
    });
  });
  return out;
}

export interface DrawOptions {
  labels: Label[] | null;
  labelAlpha: number;
  highlight: number | null;
  truth: number;
  marker: Float64Array;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  fr: Frame,
  view: View,
  width: number,
  height: number,
  opt: DrawOptions,
): void {
  const { g, colours } = scene;
  const S = view.scale;
  const X = (x: number) => x * S + view.ox;
  const Y = (y: number) => y * S + view.oy;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const lit = opt.highlight !== null ? new Set(g.served[opt.highlight]) : null;

  // Where each station really is, when asked.
  if (opt.truth > 0) {
    ctx.globalAlpha = opt.truth;
    ctx.strokeStyle = '#9aa0a8';
    ctx.lineWidth = Math.max(0.6, S * 0.035);
    ctx.setLineDash([S * 0.12, S * 0.1]);
    ctx.beginPath();
    for (let s = 0; s < g.names.length; s++) {
      const x = fr.pos[s * 2];
      if (Number.isNaN(x)) continue;
      ctx.moveTo(X(x), Y(fr.pos[s * 2 + 1]));
      ctx.lineTo(X(scene.prep.truth[s * 2]), Y(scene.prep.truth[s * 2 + 1]));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7d848d';
    for (let s = 0; s < g.names.length; s++) {
      if (Number.isNaN(fr.pos[s * 2])) continue;
      ctx.beginPath();
      ctx.arc(X(scene.prep.truth[s * 2]), Y(scene.prep.truth[s * 2 + 1]), Math.max(1.2, S * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const trace = (cmds: Cmd[]) => {
    ctx.beginPath();
    for (const c of cmds) {
      if (c[0] === 'M') ctx.moveTo(X(c[1]), Y(c[2]));
      else if (c[0] === 'L') ctx.lineTo(X(c[1]), Y(c[2]));
      else if (c[0] === 'Q') ctx.quadraticCurveTo(X(c[1]), Y(c[2]), X(c[3]), Y(c[4]));
    }
  };

  // Lines: a white casing pass so crossings read, then colour.
  const paths: { cmds: Cmd[]; line: number }[] = [];
  for (const c of fr.chains) {
    c.lines.forEach((li, j) => {
      paths.push({ cmds: roundedPath(offsetLine(c.pts, c.offsets[j]), CORNER), line: li });
    });
  }
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = (LINE + CASING * 2) * S;
  for (const p of paths) {
    trace(p.cmds);
    ctx.stroke();
  }
  ctx.lineWidth = LINE * S;
  for (const p of paths) {
    ctx.globalAlpha = lit && !lit.has(p.line) ? 0.18 : 1;
    ctx.strokeStyle = colours[p.line];
    trace(p.cmds);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Walking transfers: a connector between the two rings.
  fr.chains.forEach((c, ci) => {
    if (!g.chains[ci].transfer) return;
    const [ax, ay] = [c.pts[0], c.pts[1]];
    const [bx, by] = [c.pts[c.pts.length - 2], c.pts[c.pts.length - 1]];
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(X(ax), Y(ay));
    ctx.lineTo(X(bx), Y(by));
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.3 * S;
    ctx.stroke();
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = Math.max(0.1, 0.3 * S - Math.max(0.8, S * 0.065) * 2);
    ctx.stroke();
    ctx.lineCap = 'round';
  });

  // Stations.
  const geom = stationGeometry(scene, fr);
  const labelSide = new Map<number, Label>();
  if (opt.labels) for (const l of opt.labels) labelSide.set(l.station, l);
  const ink = Math.max(0.8, S * 0.065);
  for (let s = 0; s < g.names.length; s++) {
    const x = fr.pos[s * 2];
    if (Number.isNaN(x)) continue;
    const y = fr.pos[s * 2 + 1];
    const gm = geom.get(s);
    if (!gm) continue;
    const dim = lit && !g.served[s].some((li) => lit.has(li));
    ctx.globalAlpha = dim ? 0.25 : 1;
    if (isInterchange(g, s)) {
      ctx.beginPath();
      ctx.arc(X(x), Y(y), opt.marker[s] * S, 0, Math.PI * 2);
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.lineWidth = ink;
      ctx.strokeStyle = INK;
      ctx.stroke();
    } else if (g.served[s].length > 1) {
      // A shared run: a bar across the bundle.
      const nx = -gm.dy;
      const ny = gm.dx;
      const r = gm.half + 0.06;
      ctx.lineCap = 'round';
      ctx.lineWidth = 0.26 * S;
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.moveTo(X(x - nx * r), Y(y - ny * r));
      ctx.lineTo(X(x + nx * r), Y(y + ny * r));
      ctx.stroke();
      ctx.lineWidth = 0.26 * S - ink * 2;
      ctx.strokeStyle = PAPER;
      ctx.stroke();
    } else {
      // A tick toward the name, or a cross-bar at the end of a line.
      let nx = -gm.dy;
      let ny = gm.dx;
      const lab = labelSide.get(s);
      if (lab && nx * lab.sx + ny * lab.sy < 0) {
        nx = -nx;
        ny = -ny;
      }
      const ox = x + -gm.dy * gm.offset;
      const oy = y + gm.dx * gm.offset;
      ctx.lineCap = 'butt';
      ctx.lineWidth = LINE * 0.85 * S;
      ctx.strokeStyle = colours[gm.line];
      ctx.beginPath();
      const reach = LINE / 2 + 0.2;
      if (gm.end) {
        ctx.moveTo(X(ox - nx * reach), Y(oy - ny * reach));
      } else {
        ctx.moveTo(X(ox), Y(oy));
      }
      ctx.lineTo(X(ox + nx * reach), Y(oy + ny * reach));
      ctx.stroke();
      ctx.lineCap = 'round';
    }
  }
  ctx.globalAlpha = 1;

  // Names.
  const px = NAME_SIZE * S;
  if (opt.labels && opt.labelAlpha > 0 && px >= 4.5) {
    ctx.fillStyle = INK;
    ctx.font = `500 ${px}px ${family}`;
    ctx.textBaseline = 'middle';
    for (const l of opt.labels) {
      if (l.clash && l.station !== opt.highlight) continue;
      const dim = lit && !g.served[l.station].some((li) => lit.has(li));
      ctx.globalAlpha = opt.labelAlpha * (dim ? 0.25 : 1);
      ctx.textAlign = l.align;
      if (l.angle) {
        ctx.save();
        ctx.translate(X(l.x), Y(l.y));
        ctx.rotate(l.angle);
        ctx.fillText(g.names[l.station], 0, px * 0.04);
        ctx.restore();
      } else ctx.fillText(g.names[l.station], X(l.x), Y(l.y) + px * 0.04);
    }
    ctx.globalAlpha = 1;
  }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The finished diagram as a standalone SVG poster. */
export function toSVG(
  scene: Scene,
  fr: Frame,
  labels: Label[],
  marker: Float64Array,
  title: string,
  system: string,
  lineNames: string[],
): string {
  const { g, colours } = scene;
  // Bounds including names.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (let s = 0; s < g.names.length; s++) if (!Number.isNaN(fr.pos[s * 2])) grow(fr.pos[s * 2], fr.pos[s * 2 + 1]);
  for (const l of labels) {
    const w = g.names[l.station].length * NAME_SIZE * 0.52;
    const dir = l.align === 'left' ? 1 : l.align === 'right' ? -1 : 0;
    grow(l.x + Math.cos(l.angle) * w * dir, l.y + Math.sin(l.angle) * w * dir);
    if (dir === 0) {
      grow(l.x - w / 2, l.y);
      grow(l.x + w / 2, l.y);
    }
  }
  const pad = 2;
  const head = 3.2;
  const foot = 2.6;
  const x0 = minX - pad;
  const y0 = minY - pad - head;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2 + head + foot;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r2(x0)} ${r2(y0)} ${r2(w)} ${r2(h)}" width="${Math.round(w * 40)}" height="${Math.round(h * 40)}">`,
    `<rect x="${r2(x0)}" y="${r2(y0)}" width="${r2(w)}" height="${r2(h)}" fill="${PAPER}"/>`,
    `<g font-family="${esc(FONT_STACK)}" fill="${INK}">`,
    `<text x="${r2(x0 + pad)}" y="${r2(y0 + pad + 0.9)}" font-size="1.5" font-weight="700">${esc(title)}</text>`,
    `<text x="${r2(x0 + pad)}" y="${r2(y0 + pad + 2.05)}" font-size="0.7" fill="#5d6168">${esc(system)}</text>`,
    `</g>`,
  );
  const path = (cmds: Cmd[]) =>
    cmds.map((c) => (c[0] === 'Q' ? `Q${r2(c[1])} ${r2(c[2])} ${r2(c[3])} ${r2(c[4])}` : `${c[0]}${r2(c[1])} ${r2(c[2])}`)).join('');
  const casing: string[] = [];
  const strokes: string[] = [];
  for (const c of fr.chains) {
    c.lines.forEach((li, j) => {
      const d = path(roundedPath(offsetLine(c.pts, c.offsets[j]), CORNER));
      casing.push(`<path d="${d}"/>`);
      strokes.push(`<path d="${d}" stroke="${colours[li]}"/>`);
    });
  }
  parts.push(
    `<g fill="none" stroke="${PAPER}" stroke-width="${r2(LINE + CASING * 2)}" stroke-linecap="round" stroke-linejoin="round">${casing.join('')}</g>`,
    `<g fill="none" stroke-width="${LINE}" stroke-linecap="round" stroke-linejoin="round">${strokes.join('')}</g>`,
  );
  const walks: string[] = [];
  fr.chains.forEach((c, ci) => {
    if (!g.chains[ci].transfer) return;
    const d = `M${r2(c.pts[0])} ${r2(c.pts[1])}L${r2(c.pts[c.pts.length - 2])} ${r2(c.pts[c.pts.length - 1])}`;
    walks.push(`<path d="${d}" stroke="${INK}" stroke-width="0.3"/>`, `<path d="${d}" stroke="${PAPER}" stroke-width="0.17"/>`);
  });
  parts.push(`<g fill="none">${walks.join('')}</g>`);
  const geom = stationGeometry(scene, fr);
  const labelSide = new Map(labels.map((l) => [l.station, l]));
  const marks: string[] = [];
  for (let s = 0; s < g.names.length; s++) {
    const x = fr.pos[s * 2];
    if (Number.isNaN(x)) continue;
    const y = fr.pos[s * 2 + 1];
    const gm = geom.get(s);
    if (!gm) continue;
    if (isInterchange(g, s)) {
      marks.push(
        `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(marker[s])}" fill="${PAPER}" stroke="${INK}" stroke-width="0.065"/>`,
      );
    } else if (g.served[s].length > 1) {
      const nx = -gm.dy;
      const ny = gm.dx;
      const r = gm.half + 0.06;
      const a = `M${r2(x - nx * r)} ${r2(y - ny * r)}L${r2(x + nx * r)} ${r2(y + ny * r)}`;
      marks.push(`<path d="${a}" stroke="${INK}" stroke-width="0.26" stroke-linecap="round"/>`);
      marks.push(`<path d="${a}" stroke="${PAPER}" stroke-width="0.13" stroke-linecap="round"/>`);
    } else {
      let nx = -gm.dy;
      let ny = gm.dx;
      const lab = labelSide.get(s);
      if (lab && nx * lab.sx + ny * lab.sy < 0) {
        nx = -nx;
        ny = -ny;
      }
      const ox = x + -gm.dy * gm.offset;
      const oy = y + gm.dx * gm.offset;
      const reach = LINE / 2 + 0.2;
      const sx = gm.end ? ox - nx * reach : ox;
      const sy = gm.end ? oy - ny * reach : oy;
      marks.push(
        `<path d="M${r2(sx)} ${r2(sy)}L${r2(ox + nx * reach)} ${r2(oy + ny * reach)}" stroke="${colours[gm.line]}" stroke-width="${r2(LINE * 0.85)}"/>`,
      );
    }
  }
  parts.push(`<g>${marks.join('')}</g>`);
  const names: string[] = [];
  for (const l of labels) {
    if (l.clash) continue;
    const anchor = l.align === 'left' ? 'start' : l.align === 'right' ? 'end' : 'middle';
    const rot = l.angle ? ` transform="rotate(${r2((l.angle * 180) / Math.PI)} ${r2(l.x)} ${r2(l.y)})"` : '';
    names.push(
      `<text x="${r2(l.x)}" y="${r2(l.y)}" text-anchor="${anchor}" dominant-baseline="central"${rot}>${esc(g.names[l.station])}</text>`,
    );
  }
  parts.push(
    `<g font-family="${esc(FONT_STACK)}" font-size="${NAME_SIZE}" font-weight="500" fill="${INK}">${names.join('')}</g>`,
  );
  // Key along the foot.
  let kx = x0 + pad;
  const ky = y0 + h - foot + 1.1;
  const keys: string[] = [];
  lineNames.forEach((name, li) => {
    keys.push(
      `<rect x="${r2(kx)}" y="${r2(ky - 0.11)}" width="1" height="0.22" fill="${colours[li]}"/>`,
      `<text x="${r2(kx + 1.25)}" y="${r2(ky)}" dominant-baseline="central">${esc(name)}</text>`,
    );
    kx += 1.25 + name.length * 0.3 + 0.9;
  });
  parts.push(
    `<g font-family="${esc(FONT_STACK)}" font-size="0.5" fill="${INK}">${keys.join('')}</g>`,
    `<text x="${r2(x0 + pad)}" y="${r2(y0 + h - 0.6)}" font-family="${esc(FONT_STACK)}" font-size="0.36" fill="#5d6168">Network data © OpenStreetMap contributors, ODbL. Drawn at thesandbox.page/schematic/</text>`,
    '</svg>',
  );
  return parts.join('\n');
}
