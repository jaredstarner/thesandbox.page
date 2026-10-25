// The figures on /seeing-things/, built as SVG markup from numbers alone. The
// page draws each one at build time, so the illusions stand without script, and
// the script redraws the part a control moves. Every figure sits in an 800x600
// viewBox.

export const INK = '#16130f';
export const PAPER = '#fbfaf6';
export const RED = '#e2412b';

const TAU = Math.PI * 2;

/** A number for an attribute: two decimals at most, no trailing zeros. */
const n = (v: number) => String(Math.round(v * 100) / 100);
const pt = (x: number, y: number) => `${n(x)} ${n(y)}`;
const rad = (deg: number) => (deg * Math.PI) / 180;

/* ---------------------------------------------------------------- Fins */

export const FINS = { len: 360, cx: 400, yTop: 220, yBottom: 390, fin: 50, angle: rad(36) };

/** One Müller-Lyer line: heads point the fins back along the shaft, tails splay them out past its ends. */
function finsLine(len: number, y: number, tails: boolean): string {
  const x0 = FINS.cx - len / 2;
  const x1 = FINS.cx + len / 2;
  const dx = FINS.fin * Math.cos(FINS.angle) * (tails ? -1 : 1);
  const dy = FINS.fin * Math.sin(FINS.angle);
  const fins =
    `M${pt(x0 + dx, y - dy)}L${pt(x0, y)}L${pt(x0 + dx, y + dy)}` +
    `M${pt(x1 - dx, y - dy)}L${pt(x1, y)}L${pt(x1 - dx, y + dy)}`;
  return `<path class="fins ctx" d="${fins}"/><path class="shaft" d="M${pt(x0, y)}H${n(x1)}"/>`;
}

export function finsAdjustable(len: number): string {
  return finsLine(len, FINS.yBottom, true);
}

export function finsFigure(len: number): string {
  return (
    `<rect class="card" width="800" height="600"/>` +
    `<g class="ink-lines">${finsLine(FINS.len, FINS.yTop, false)}<g data-adj>${finsAdjustable(len)}</g></g>` +
    `<g data-truth></g>`
  );
}

/** The true ends dropped from the upper line, and what the lower one is short by or over by. */
export function finsTruth(len: number): string {
  const { cx, yTop, yBottom } = FINS;
  const t0 = cx - FINS.len / 2;
  const t1 = cx + FINS.len / 2;
  const s0 = cx - len / 2;
  const s1 = cx + len / 2;
  return (
    `<path class="guide" d="M${pt(t0, yTop - 70)}V${n(yBottom + 70)}M${pt(t1, yTop - 70)}V${n(yBottom + 70)}"/>` +
    `<path class="error" d="M${pt(s0, yBottom)}H${n(t0)}M${pt(s1, yBottom)}H${n(t1)}"/>` +
    `<path class="tick" d="M${pt(t0, yTop - 16)}v32M${pt(t1, yTop - 16)}v32M${pt(t0, yBottom - 16)}v32M${pt(t1, yBottom - 16)}v32"/>`
  );
}

/* ---------------------------------------------------------------- Grid */

export const GRID = { step: 64, bar: 9, disc: 7.6 };

/** Bars on a dark ground with a white disc at every crossing; amp bends the bars into waves that still meet at the discs. */
export function gridBars(amp: number): string {
  const { step } = GRID;
  // Eleven by eight cells, so every disc sits whole inside the card and the bars run off its edges.
  const ox = 400 - step * 5.5;
  const oy = 300 - step * 4;
  const lines: string[] = [];
  for (let j = 0; j <= 8; j++) {
    const y0 = oy + j * step;
    let d = '';
    for (let x = -24; x <= 824; x += 4) {
      const y = y0 + amp * Math.sin((TAU * (x - ox)) / step);
      d += `${d ? 'L' : 'M'}${pt(x, y)}`;
    }
    lines.push(d);
  }
  for (let i = 0; i <= 11; i++) {
    const x0 = ox + i * step;
    let d = '';
    for (let y = -24; y <= 624; y += 4) {
      const x = x0 + amp * Math.sin((TAU * (y - oy)) / step);
      d += `${d ? 'L' : 'M'}${pt(x, y)}`;
    }
    lines.push(d);
  }
  let discs = '';
  for (let j = 0; j <= 8; j++) {
    for (let i = 0; i <= 11; i++)
      discs += `M${pt(ox + i * step - GRID.disc, oy + j * step)}a${n(GRID.disc)} ${n(GRID.disc)} 0 1 0 ${n(GRID.disc * 2)} 0a${n(GRID.disc)} ${n(GRID.disc)} 0 1 0 ${n(-GRID.disc * 2)} 0`;
  }
  return `<path class="grid-bars" d="${lines.join('')}"/><path class="grid-discs" d="${discs}"/>`;
}

export function gridFigure(amp: number): string {
  return `<rect class="dark" width="800" height="600"/><g data-adj>${gridBars(amp)}</g>`;
}

/* ---------------------------------------------------------------- Tables */

interface Top {
  p0: [number, number];
  u: [number, number];
  v: [number, number];
}

export const TABLES = {
  long: 262,
  short: 150,
  /** The left top's long side leans this far from level; the right top is the same shape turned a quarter turn. */
  angle: -70,
  skew: 82,
  left: [150, 432] as [number, number],
  right: [468, 196] as [number, number],
  leg: 86,
  edge: 11,
};

function top(p0: [number, number], angle: number, long: number): Top {
  const a = rad(angle);
  const b = rad(angle + TABLES.skew);
  return {
    p0,
    u: [long * Math.cos(a), long * Math.sin(a)],
    v: [TABLES.short * Math.cos(b), TABLES.short * Math.sin(b)],
  };
}

export function leftTop(): Top {
  return top(TABLES.left, TABLES.angle, TABLES.long);
}

export function rightTop(long: number): Top {
  return top(TABLES.right, TABLES.angle + 90, long);
}

function corners(t: Top): [number, number][] {
  const [x, y] = t.p0;
  return [
    [x, y],
    [x + t.u[0], y + t.u[1]],
    [x + t.u[0] + t.v[0], y + t.u[1] + t.v[1]],
    [x + t.v[0], y + t.v[1]],
  ];
}

export function centroid(t: Top): [number, number] {
  return [t.p0[0] + (t.u[0] + t.v[0]) / 2, t.p0[1] + (t.u[1] + t.v[1]) / 2];
}

function poly(pts: [number, number][]): string {
  return 'M' + pts.map(([x, y]) => pt(x, y)).join('L') + 'Z';
}

/** A table: legs from every corner, the edge faces that turn toward the viewer, then the top over them. */
function table(t: Top, cls: string): string {
  const c = corners(t);
  const [cx, cy] = centroid(t);
  const { leg, edge } = TABLES;
  // Each leg is set in from its corner and starts under the top, so none pokes out past an edge;
  // a leg under the far corners is hidden by the top it holds up.
  let legs = '';
  for (const [x, y] of c) {
    const lx = x + Math.sign(cx - x) * 8;
    legs += poly([
      [lx - 6.5, y + 6],
      [lx + 6.5, y + 6],
      [lx + 6.5, y + leg],
      [lx - 6.5, y + leg],
    ]);
  }
  let sides = '';
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = c[i];
    const [bx, by] = c[(i + 1) % 4];
    // The outward normal of this edge points down the screen when the edge faces us.
    const mx = (ax + bx) / 2 - cx;
    const my = (ay + by) / 2 - cy;
    const nx = by - ay;
    const ny = -(bx - ax);
    const outward = nx * mx + ny * my > 0 ? ny : -ny;
    if (outward > 0)
      sides += poly([
        [ax, ay],
        [bx, by],
        [bx, by + edge],
        [ax, ay + edge],
      ]);
  }
  return (
    `<g class="${cls}"><path class="legs ctx" d="${legs}"/><path class="edges ctx" d="${sides}"/>` +
    `<path class="top" d="${poly(c)}"/></g>`
  );
}

export function tablesAdjustable(long: number): string {
  return table(rightTop(long), 'table');
}

export function tablesFigure(long: number): string {
  return (
    `<rect class="card" width="800" height="600"/>` +
    `${table(leftTop(), 'table')}<g data-adj>${tablesAdjustable(long)}</g><g data-truth></g>`
  );
}

/** The right top in red, ready to be turned back onto the left one. */
export function tablesTruth(long: number): string {
  const t = rightTop(long);
  const [rx, ry] = centroid(t);
  const [lx, ly] = centroid(leftTop());
  return (
    `<path class="outline" d="${poly(corners(leftTop()))}"/>` +
    `<path class="turned" d="${poly(corners(t))}" style="transform-origin:${n(rx)}px ${n(ry)}px;` +
    `--dx:${n(lx - rx)}px;--dy:${n(ly - ry)}px"/>`
  );
}

/* ---------------------------------------------------------------- Chaser */

export const CHASER = { ring: 205, disc: 36, count: 12, step: 0.125 };

export function chaserFigure(): string {
  let discs = '';
  for (let i = 0; i < CHASER.count; i++) {
    const a = rad(-90 + (360 / CHASER.count) * i);
    const x = 400 + CHASER.ring * Math.cos(a);
    const y = 300 + CHASER.ring * Math.sin(a);
    discs += `<circle class="chase" cx="${n(x)}" cy="${n(y)}" r="${CHASER.disc}" style="animation-delay:${n(i * CHASER.step)}s"/>`;
  }
  return (
    `<defs><filter id="seeing-chaser-blur" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur data-blur stdDeviation="13"/></filter></defs>` +
    `<rect class="chaser-ground" width="800" height="600"/>` +
    `<g filter="url(#seeing-chaser-blur)">${discs}</g>` +
    `<path class="cross" d="M386 300H414M400 286V314"/>`
  );
}

/* ---------------------------------------------------------------- Mortar */

export const MORTAR = { tileW: 64, tileH: 50, gap: 5, rows: 8, x0: 40, x1: 760 };

function mortarY(i: number): number {
  const pitch = MORTAR.tileH + MORTAR.gap;
  return 300 - (pitch * MORTAR.rows) / 2 + i * pitch;
}

/** The mortar lines tilt alternately by tilt degrees about the middle; tiles fill the rows between them. */
export function mortarRows(tilt: number): string {
  const { tileW, gap, rows, x0, x1 } = MORTAR;
  const line = (i: number) => {
    const k = Math.tan(rad(i % 2 ? tilt : -tilt));
    return (x: number) => mortarY(i) + (x - 400) * k;
  };
  let light = '';
  let dark = '';
  for (let r = 0; r < rows; r++) {
    const above = line(r);
    const below = line(r + 1);
    const quad = (a: number, b: number) =>
      poly([
        [a, above(a) + gap / 2],
        [b, above(b) + gap / 2],
        [b, below(b) - gap / 2],
        [a, below(a) - gap / 2],
      ]);
    light += quad(x0, x1);
    // Alternate rows shift half a tile, as bricks are laid.
    const shift = r % 2 ? tileW / 2 : 0;
    for (let k = -2; (k - 2) * tileW < x1; k += 2) {
      const a = Math.max(x0, x0 + k * tileW + shift);
      const b = Math.min(x1, x0 + (k + 1) * tileW + shift);
      if (b > a) dark += quad(a, b);
    }
  }
  let mortar = '';
  for (let i = 0; i <= rows; i++) {
    const f = line(i);
    mortar += `M${pt(x0, f(x0))}L${pt(x1, f(x1))}`;
  }
  return (
    `<g class="ctx"><path class="tile-light" d="${light}"/><path class="tile-dark" d="${dark}"/></g>` +
    `<path class="mortar" d="${mortar}"/>`
  );
}

export function mortarFigure(tilt: number): string {
  return `<rect class="card" width="800" height="600"/><g data-adj>${mortarRows(tilt)}</g><g data-truth></g>`;
}

/** True level through the middle of every mortar line. */
export function mortarTruth(): string {
  let d = '';
  for (let i = 0; i <= MORTAR.rows; i++) d += `M${pt(MORTAR.x0 - 16, mortarY(i))}H${n(MORTAR.x1 + 16)}`;
  return `<path class="guide" d="${d}"/>`;
}

/* ---------------------------------------------------------------- Buses */

/** The bars are a whole number of stripe pairs long, so both ends of a bar cross the same shade at once. */
export const BUSES = { stripe: 16, len: 96, top: 196, bottom: 360, h: 44, y0: 0, y1: 600 };

export function busesFigure(): string {
  let stripes = '';
  for (let x = 0; x < 800; x += BUSES.stripe * 2)
    stripes += `M${n(x)} ${BUSES.y0}h${BUSES.stripe}V${BUSES.y1}h${-BUSES.stripe}Z`;
  return (
    `<rect class="card" width="800" height="600"/>` +
    `<rect class="bus-light" y="${BUSES.y0}" width="800" height="${BUSES.y1 - BUSES.y0}"/>` +
    `<path class="bus-dark" d="${stripes}"/>` +
    `<rect class="bus bus-yellow" data-bus x="${400 - BUSES.len / 2}" y="${BUSES.top}" width="${BUSES.len}" height="${BUSES.h}"/>` +
    `<rect class="bus bus-blue" data-bus x="${400 - BUSES.len / 2}" y="${BUSES.bottom}" width="${BUSES.len}" height="${BUSES.h}"/>`
  );
}

/* ---------------------------------------------------------------- Halo */

export const HALO = {
  r: 38,
  left: 236,
  right: 606,
  y: 300,
  big: { r: 56, d: 122, count: 6 },
  small: { r: 14, d: 74, count: 8 },
};

function ring(cx: number, r: number, d: number, count: number, turn: number): string {
  let out = '';
  for (let i = 0; i < count; i++) {
    const a = rad(turn + (360 / count) * i);
    const x = cx + d * Math.cos(a);
    const y = HALO.y + d * Math.sin(a);
    out += `M${pt(x - r, y)}a${n(r)} ${n(r)} 0 1 0 ${n(r * 2)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-r * 2)} 0`;
  }
  return out;
}

export function haloAdjustable(r: number): string {
  return `<circle class="halo-centre halo-set" cx="${HALO.right}" cy="${HALO.y}" r="${n(r)}"/>`;
}

export function haloFigure(r: number): string {
  const { big, small } = HALO;
  return (
    `<rect class="card" width="800" height="600"/>` +
    `<path class="halo-ring ctx" d="${ring(HALO.left, big.r, big.d, big.count, 0)}${ring(HALO.right, small.r, small.d, small.count, 22.5)}"/>` +
    `<circle class="halo-centre halo-fixed" cx="${HALO.left}" cy="${HALO.y}" r="${HALO.r}"/>` +
    `<g data-adj>${haloAdjustable(r)}</g><g data-truth></g>`
  );
}

/** Where the two centre discs slide to, side by side, and the true size's top and bottom. */
export const HALO_MEET = { left: 336, right: 464 };

export function haloTruth(): string {
  const { y, r } = HALO;
  return `<path class="guide" d="M${pt(240, y - r)}H560M${pt(240, y + r)}H560"/>`;
}

/* ---------------------------------------------------------------- Spiral */

export function spiralFigure(): string {
  const arms = 6;
  const twist = 0.032;
  const R = 262;
  let d = '';
  for (let k = 0; k < arms; k++) {
    const a0 = (TAU / arms) * k;
    const a1 = a0 + TAU / arms / 2;
    const out: string[] = [];
    const back: string[] = [];
    // Run the arms past the rim so the clip, not a chord, ends them.
    for (let r = 0; r <= R + 48; r += 3) {
      out.push(pt(400 + r * Math.cos(a0 + twist * r), 300 + r * Math.sin(a0 + twist * r)));
      back.push(pt(400 + r * Math.cos(a1 + twist * r), 300 + r * Math.sin(a1 + twist * r)));
    }
    d += 'M' + out.join('L') + 'L' + back.reverse().join('L') + 'Z';
  }
  return (
    `<rect class="card" width="800" height="600"/>` +
    `<defs><clipPath id="seeing-spiral-clip"><circle cx="400" cy="300" r="${R - 2}"/></clipPath></defs>` +
    `<g clip-path="url(#seeing-spiral-clip)"><g class="spin" data-spin><path class="spiral-arms" d="${d}"/></g></g>` +
    `<circle class="spiral-rim" cx="400" cy="300" r="${R - 2}"/>` +
    `<circle class="fix" cx="400" cy="300" r="7"/>`
  );
}

/* ---------------------------------------------------------------- Stripes */

export const STRIPES = { y0: 90, h: 20, count: 21, x0: 60, x1: 740, left: [150, 310], right: [490, 650], grey: 128 };

export function stripesAdjustable(grey: number): string {
  const { y0, h, right } = STRIPES;
  let d = '';
  for (let j = 5; j <= 15; j += 2) d += `M${pt(right[0], y0 + j * h)}H${right[1]}v${h}H${right[0]}Z`;
  return `<path class="stripe-grey" d="${d}" fill="rgb(${grey},${grey},${grey})"/>`;
}

export function stripesFigure(grey: number): string {
  const { y0, h, count, x0, x1, left, grey: g } = STRIPES;
  let dark = '';
  for (let j = 0; j < count; j += 2) dark += `M${pt(x0, y0 + j * h)}H${x1}v${h}H${x0}Z`;
  let fixed = '';
  for (let j = 6; j <= 16; j += 2) fixed += `M${pt(left[0], y0 + j * h)}H${left[1]}v${h}H${left[0]}Z`;
  return (
    `<rect class="card" width="800" height="600"/>` +
    `<g class="ctx"><rect class="stripe-light" x="${x0}" y="${y0}" width="${x1 - x0}" height="${count * h}"/>` +
    `<path class="stripe-dark" d="${dark}"/></g>` +
    `<path class="stripe-grey" d="${fixed}" fill="rgb(${g},${g},${g})"/>` +
    `<g data-adj>${stripesAdjustable(grey)}</g>`
  );
}

/* ---------------------------------------------------------------- Drift */

const WHEELS: [number, number][] = [
  [146, 160],
  [400, 160],
  [654, 160],
  [146, 440],
  [400, 440],
  [654, 440],
];

/** An annular sector from angle a to b between radii r0 and r1. */
function sector(r0: number, r1: number, a: number, b: number, cx: number, cy: number): string {
  const p = (r: number, t: number) => pt(cx + r * Math.cos(t), cy + r * Math.sin(t));
  const large = b - a > Math.PI ? 1 : 0;
  return `M${p(r0, a)}L${p(r1, a)}A${n(r1)} ${n(r1)} 0 ${large} 1 ${p(r1, b)}L${p(r0, b)}A${n(r0)} ${n(r0)} 0 ${large} 0 ${p(r0, a)}Z`;
}

/**
 * Rings that repeat black, dark, white, light around each wheel, the narrow
 * black and white steps between the wide dark and light ones. Neighbouring
 * rings and wheels run the sequence the other way.
 */
export function driftFigure(): string {
  const paths = ['', '', '', ''];
  const widths = [0.14, 0.36, 0.14, 0.36];
  WHEELS.forEach(([cx, cy], w) => {
    const radii = [20, 40, 60, 80, 100, 120];
    for (let k = 0; k + 1 < radii.length; k++) {
      const r0 = radii[k] + 1.5;
      const r1 = radii[k + 1] - 1.5;
      const cells = Math.max(6, Math.round((TAU * (r0 + r1)) / 2 / 30));
      const sense = (k + w) % 2 ? -1 : 1;
      const offset = k * 0.37;
      for (let c = 0; c < cells; c++) {
        let a = offset + (TAU / cells) * c;
        for (let s = 0; s < 4; s++) {
          const span = (TAU / cells) * widths[s];
          const idx = sense > 0 ? s : (4 - s) % 4;
          paths[idx] += sector(r0, r1, a, a + span, cx, cy);
          a += span;
        }
      }
    }
  });
  return (
    `<rect class="drift-ground" width="800" height="600"/>` +
    paths.map((d, i) => `<path class="drift-${i}" d="${d}"/>`).join('')
  );
}
