// The machine drawn in SVG: wheels with crank pins, sliding frames, pulleys on two rows, one chain
// threaded over the top row and under the bottom one, and a pen on the chain's free end writing on a
// moving strip of paper. It draws whatever state it is handed; the page decides what the wheels do.

const NS = 'http://www.w3.org/2000/svg';
const RAD = Math.PI / 180;
const HOUR_MS = 3600000;

type Attrs = Record<string, string | number>;

export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

let uid = 0;

export interface UnitSpec {
  name: string;
  row: 'upper' | 'lower';
  x: number;
}

export interface Layout {
  width: number;
  height: number;
  gearR: number;
  /** Centre height of the upper and lower rows of wheels. */
  upperY: number;
  lowerY: number;
  /** From a sliding frame's slot to its pulley's axle. */
  reach: number;
  pulleyR: number;
  units: UnitSpec[];
  /** Where the chain is made fast. */
  anchor: { x: number; y: number };
  /** The fixed pulley the chain turns over before it drops to the pen. */
  guide: { x: number; y: number; r: number };
  paper: { x0: number; x1: number; y0: number; y1: number };
  /** Hours of paper between the left edge and the pen. */
  hours: number;
  crank?: { x: number; y: number; r: number };
  dials?: { x: number; dateY: number; clockY: number; clockR: number; heightY: number; heightR: number };
  nameplate?: { x: number; y: number; w: number };
  /** Show engraved tags with each wheel's name. */
  tags?: boolean;
  /** Draw the wheels' guide rails and drive shafts. */
  frame?: boolean;
}

export interface WheelState {
  /** Pin radius in px. */
  pin: number;
  /** Degrees; 0 puts the pin at the top. */
  angle: number;
  engaged: boolean;
}

export interface Clock {
  weekday: string;
  day: string;
  month: string;
  year: string;
  /** Hours since local midnight, fractional. */
  hours: number;
}

interface UnitNodes {
  spec: UnitSpec;
  cx: number;
  cy: number;
  group: SVGGElement;
  wheel: SVGGElement;
  slot: SVGRectElement;
  pin: SVGGElement;
  slide: SVGGElement;
  sheave: SVGGElement;
  tag?: SVGTextElement;
  disp: number;
  pinX: number;
  pinY: number;
  dy: number;
}

/** Tangent points for a belt between two circles; `side` +1 means the circle's centre is to the right of travel. */
function tangent(
  c1: { x: number; y: number },
  r1: number,
  s1: number,
  c2: { x: number; y: number },
  r2: number,
  s2: number,
): [number, number, number, number] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const L = Math.hypot(dx, dy);
  const k = s1 * r1 - s2 * r2;
  const phi = Math.atan2(dy, dx) + Math.asin(Math.max(-1, Math.min(1, k / L)));
  const nx = Math.sin(phi);
  const ny = -Math.cos(phi);
  return [c1.x + s1 * r1 * nx, c1.y + s1 * r1 * ny, c2.x + s2 * r2 * nx, c2.y + s2 * r2 * ny];
}

function gearPath(R: number, teeth: number): string {
  const depth = Math.max(2.2, R * 0.085);
  const r0 = R - depth;
  const step = (Math.PI * 2) / teeth;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts: [number, number][] = [
      [r0, a],
      [r0, a + step * 0.18],
      [R, a + step * 0.34],
      [R, a + step * 0.66],
      [r0, a + step * 0.82],
    ];
    for (const [r, t] of pts) {
      const x = (r * Math.sin(t)).toFixed(2);
      const y = (-r * Math.cos(t)).toFixed(2);
      d += (d ? 'L' : 'M') + x + ' ' + y;
    }
  }
  return d + 'Z';
}

function fmt(n: number): string {
  return n.toFixed(1);
}

export class Machine {
  readonly svg: SVGSVGElement;
  readonly layout: Layout;
  private id: string;
  private units: UnitNodes[] = [];
  /** Units in the order the chain meets them. */
  private chainOrder: UnitNodes[] = [];
  private chainBase!: SVGPathElement;
  private chainLinks!: SVGPathElement;
  private carriage!: SVGGElement;
  private grid!: SVGPathElement;
  private gridBold!: SVGPathElement;
  private gridLabels!: SVGGElement;
  private marks!: SVGGElement;
  private heightLabels!: SVGGElement;
  private trace!: SVGPathElement;
  private crankGroup?: SVGGElement;
  private clockHour?: SVGGElement;
  private clockMinute?: SVGGElement;
  private heightHand?: SVGGElement;
  private heightTicks?: SVGGElement;
  private dateTexts?: SVGTextElement[];
  private nameText?: SVGTextElement;
  private samples: { t: number; y: number }[] = [];
  private yMin = 0;
  private yMax = 1;
  private hMin = 0;
  private hMax = 1;
  private gridStep = 1;
  private unitLabel = 'ft';
  private unitScale = 1;
  private dayLabel: (ms: number) => string = () => '';
  private localHours: (ms: number) => number = (ms) => (ms / 3600000) % 24;
  private dialFrom = 0;
  private dialTo = 1;

  onWheel?: (name: string) => void;

  constructor(svg: SVGSVGElement, layout: Layout) {
    this.svg = svg;
    this.layout = layout;
    this.id = `tm${++uid}`;
    svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
    svg.replaceChildren();
    this.build();
  }

  private ref(name: string): string {
    return `url(#${this.id}-${name})`;
  }

  private defs(): void {
    const d = el('defs', {}, this.svg);
    const grad = (type: 'linearGradient' | 'radialGradient', name: string, attrs: Attrs, stops: [number, string][]) => {
      const g = el(type, { id: `${this.id}-${name}`, ...attrs }, d);
      for (const [o, c] of stops) el('stop', { offset: o, 'stop-color': c }, g);
    };
    grad('radialGradient', 'brass', { cx: '34%', cy: '28%', r: '80%' }, [
      [0, '#fff3cc'],
      [0.3, '#e8c87e'],
      [0.7, '#b78b3f'],
      [1, '#6b4a1b'],
    ]);
    grad('radialGradient', 'recess', { cx: '50%', cy: '40%', r: '65%' }, [
      [0, '#6c4c1f'],
      [1, '#33240e'],
    ]);
    grad('linearGradient', 'rod', { x1: 0, x2: 1, y1: 0, y2: 0 }, [
      [0, '#4f585e'],
      [0.42, '#e4e9eb'],
      [0.7, '#99a3a9'],
      [1, '#3f474c'],
    ]);
    grad('linearGradient', 'bar', { x1: 0, x2: 0, y1: 0, y2: 1 }, [
      [0, '#f2d690'],
      [0.45, '#c79a4b'],
      [1, '#75521f'],
    ]);
    grad('linearGradient', 'rail', { x1: 0, x2: 0, y1: 0, y2: 1 }, [
      [0, '#8d969c'],
      [0.35, '#d9dfe2'],
      [0.65, '#7c868c'],
      [1, '#3c4449'],
    ]);
    grad('radialGradient', 'silver', { cx: '42%', cy: '36%', r: '75%' }, [
      [0, '#fbfaf5'],
      [0.75, '#e2ded2'],
      [1, '#bfb9aa'],
    ]);
    grad('linearGradient', 'paper', { x1: 0, x2: 0, y1: 0, y2: 1 }, [
      [0, '#e2d9c3'],
      [0.06, '#efe8d6'],
      [0.94, '#efe8d6'],
      [1, '#d8cfb8'],
    ]);
    grad('radialGradient', 'shade', { cx: '50%', cy: '50%', r: '50%' }, [
      [0, 'rgb(0 0 0 / 0.55)'],
      [0.62, 'rgb(0 0 0 / 0.32)'],
      [1, 'rgb(0 0 0 / 0)'],
    ]);
    grad('linearGradient', 'roll', { x1: 0, x2: 1, y1: 0, y2: 0 }, [
      [0, '#bfb59c'],
      [0.45, '#f4eedf'],
      [1, '#a89e86'],
    ]);
    const f = el('filter', { id: `${this.id}-lift`, x: '-30%', y: '-30%', width: '160%', height: '160%' }, d);
    el('feDropShadow', { dx: 0, dy: 2.5, stdDeviation: 2.4, 'flood-color': '#000', 'flood-opacity': 0.55 }, f);
    const g = el('filter', { id: `${this.id}-soft`, x: '-20%', y: '-20%', width: '140%', height: '140%' }, d);
    el('feDropShadow', { dx: 0, dy: 6, stdDeviation: 7, 'flood-color': '#000', 'flood-opacity': 0.5 }, g);
  }

  private build(): void {
    const L = this.layout;
    this.defs();
    const root = el('g', { class: 'tm-root' }, this.svg);

    // The paper strip, its rolls, and its grid.
    const P = L.paper;
    const paper = el('g', { class: 'tm-paper' }, root);
    el(
      'rect',
      {
        x: P.x0,
        y: P.y0,
        width: P.x1 - P.x0,
        height: P.y1 - P.y0,
        fill: this.ref('paper'),
        filter: this.ref('soft'),
      },
      paper,
    );
    const clipId = `${this.id}-clip`;
    const clip = el('clipPath', { id: clipId }, paper);
    el('rect', { x: P.x0, y: P.y0, width: P.x1 - P.x0, height: P.y1 - P.y0 }, clip);
    const inner = el('g', { 'clip-path': `url(#${clipId})` }, paper);
    this.grid = el('path', { fill: 'none', stroke: '#b9ae93', 'stroke-width': 0.7, opacity: 0.75 }, inner);
    this.gridBold = el('path', { fill: 'none', stroke: '#8f846b', 'stroke-width': 1.1, opacity: 0.8 }, inner);
    this.heightLabels = el('g', { class: 'tm-hlabels' }, inner);
    this.gridLabels = el('g', { class: 'tm-tlabels' }, inner);
    this.marks = el('g', { class: 'tm-marks' }, inner);
    this.trace = el(
      'path',
      {
        fill: 'none',
        stroke: '#1f4f84',
        'stroke-width': 2.2,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      },
      inner,
    );
    for (const x of [P.x0 - 9, P.x1 - 9]) {
      el('rect', { x, y: P.y0 - 8, width: 18, height: P.y1 - P.y0 + 16, rx: 7, fill: this.ref('roll') }, paper);
    }

    if (L.frame !== false) this.drawFrame(root);

    // Wheels, frames, and pulleys.
    const unitsG = el('g', { class: 'tm-units' }, root);
    for (const spec of L.units) this.units.push(this.drawUnit(unitsG, spec));
    this.chainOrder = [...this.units].sort((a, b) => a.spec.x - b.spec.x);

    // The guide pulley and the chain.
    const G = L.guide;
    const hangTop = L.frame === false ? G.y - G.r - 26 : this.railY('upper');
    el('rect', { x: G.x - 3, y: hangTop, width: 6, height: G.y - hangTop, rx: 3, fill: this.ref('rod') }, root);
    const guide = el('g', { filter: this.ref('lift') }, root);
    el('circle', { cx: G.x, cy: G.y, r: G.r, fill: this.ref('brass'), stroke: '#4a3412', 'stroke-width': 1 }, guide);
    el('circle', { cx: G.x, cy: G.y, r: G.r * 0.62, fill: 'none', stroke: '#6f501f', 'stroke-width': 1 }, guide);
    el('circle', { cx: G.x, cy: G.y, r: 2.6, fill: this.ref('rod') }, guide);
    // 2. The chain is made fast to an eye on a strut from the frame.
    const A = L.anchor;
    const strutEnd =
      L.units.some((u) => u.row === 'lower') && L.frame !== false ? this.railY('lower') : L.paper.y0 - 10;
    el(
      'rect',
      { x: A.x - 3, y: A.y, width: 6, height: Math.max(8, strutEnd - A.y), rx: 3, fill: this.ref('rod') },
      root,
    );
    el(
      'rect',
      { x: A.x - 9, y: strutEnd - 6, width: 18, height: 12, rx: 2, fill: this.ref('bar'), stroke: '#5a3f15' },
      root,
    );
    el('circle', { cx: A.x, cy: A.y, r: 6, fill: 'none', stroke: this.ref('bar'), 'stroke-width': 3.2 }, root);
    this.chainBase = el(
      'path',
      { fill: 'none', stroke: '#3c372f', 'stroke-width': 3.4, 'stroke-linejoin': 'round' },
      root,
    );
    this.chainLinks = el(
      'path',
      {
        fill: 'none',
        stroke: '#d8d2c2',
        'stroke-width': 1.9,
        'stroke-dasharray': '3.6 1.6',
        'stroke-linejoin': 'round',
      },
      root,
    );

    // The pen carriage: a weighted block on a guide rod, with the nib on its left.
    const penX = G.x + G.r;
    el('rect', { x: penX + 9, y: P.y0 - 14, width: 4, height: P.y1 - P.y0 + 28, rx: 2, fill: this.ref('rod') }, root);
    this.carriage = el('g', {}, root);
    el('rect', { x: penX - 5, y: -5, width: 28, height: 32, rx: 5, fill: 'rgb(0 0 0 / 0.28)' }, this.carriage);
    el(
      'rect',
      { x: penX - 7, y: -9, width: 26, height: 30, rx: 3, fill: this.ref('bar'), stroke: '#5a3f15' },
      this.carriage,
    );
    el('rect', { x: penX + 7.5, y: -9, width: 7, height: 30, fill: 'rgb(0 0 0 / 0.18)' }, this.carriage);
    el(
      'path',
      { d: `M${penX - 7} 0L${penX - 1} 0L${penX} 3L${penX - 1} 6L${penX - 7} 6Z`, fill: '#2a2a2a' },
      this.carriage,
    );
    el('circle', { cx: penX, cy: -9, r: 3, fill: this.ref('rod') }, this.carriage);

    if (L.crank) this.drawCrank(root, L.crank);
    if (L.dials) this.drawDials(root, L.dials);
    if (L.nameplate) this.drawNameplate(root, L.nameplate);
  }

  /** Height of the guide rail a row's rods slide through: clear of the wheels and of the pulleys. */
  private railY(row: 'upper' | 'lower'): number {
    const L = this.layout;
    const off = Math.max(L.reach * 0.52, L.gearR + 14);
    return row === 'upper' ? L.upperY + off : L.lowerY - off;
  }

  private drawFrame(root: SVGGElement): void {
    const L = this.layout;
    const xs = L.units.map((u) => u.x);
    const x0 = Math.min(...xs, L.anchor.x) - L.gearR - 10;
    const x1 = Math.max(...xs) + L.gearR + 10;
    const g = el('g', { class: 'tm-frame' }, root);
    const both = L.units.some((u) => u.row === 'upper') && L.units.some((u) => u.row === 'lower');
    // 4. One drive: a shaft up the end of the frame joins the two rows, and the crank turns the lower one.
    const driveX = x1 + 8;
    if (both) {
      el(
        'rect',
        { x: driveX - 3, y: L.upperY, width: 6, height: L.lowerY - L.upperY, rx: 3, fill: this.ref('rail') },
        g,
      );
    }
    for (const row of ['upper', 'lower'] as const) {
      if (!L.units.some((u) => u.row === row)) continue;
      const cy = row === 'upper' ? L.upperY : L.lowerY;
      // Drive shaft behind the wheels.
      const dx1 = row === 'lower' && L.crank ? L.crank.x : both ? driveX : x1;
      el('rect', { x: x0, y: cy - 3, width: dx1 - x0, height: 6, rx: 3, fill: this.ref('rail'), opacity: 0.9 }, g);
      if (both) {
        el(
          'rect',
          { x: driveX - 9, y: cy - 9, width: 18, height: 18, rx: 3, fill: this.ref('bar'), stroke: '#5a3f15' },
          g,
        );
        el('circle', { cx: driveX, cy, r: 2.6, fill: this.ref('rod') }, g);
      }
      // Guide rail the rods slide through, carried on to hang the guide pulley from.
      const ry = this.railY(row);
      const rx1 = row === 'upper' ? Math.max(x1, L.guide.x + 14) : x1;
      el('rect', { x: x0, y: ry - 5, width: rx1 - x0, height: 10, rx: 2, fill: this.ref('rail') }, g);
      for (const u of L.units) {
        if (u.row !== row) continue;
        el(
          'rect',
          { x: u.x - 7, y: ry - 8, width: 14, height: 16, rx: 2, fill: this.ref('bar'), stroke: '#5a3f15' },
          g,
        );
      }
    }
  }

  private drawUnit(parent: SVGGElement, spec: UnitSpec): UnitNodes {
    const L = this.layout;
    const R = L.gearR;
    const cy = spec.row === 'upper' ? L.upperY : L.lowerY;
    const cx = spec.x;
    const group = el('g', { class: 'tm-unit', 'data-wheel': spec.name }, parent);

    // The sliding frame, its rod, and the pulley block move together.
    const slide = el('g', {}, group);
    const dir = spec.row === 'upper' ? 1 : -1;
    const sheaveY = dir * L.reach;
    el(
      'rect',
      {
        x: cx - 2.6,
        y: Math.min(cy, cy + sheaveY),
        width: 5.2,
        height: Math.abs(sheaveY),
        fill: this.ref('rod'),
      },
      slide,
    );
    const yokeW = R * 2.1;
    const yokeH = Math.max(9, R * 0.34);
    el(
      'rect',
      {
        x: cx - yokeW / 2,
        y: cy - yokeH / 2,
        width: yokeW,
        height: yokeH,
        rx: 2.5,
        fill: this.ref('bar'),
        stroke: '#5a3f15',
        'stroke-width': 0.8,
      },
      slide,
    );
    el(
      'rect',
      {
        x: cx - yokeW / 2 + 4,
        y: cy - yokeH * 0.22,
        width: yokeW - 8,
        height: yokeH * 0.44,
        rx: yokeH * 0.22,
        fill: '#2a1d0b',
      },
      slide,
    );
    // The pulley, with the cheek of its block in front.
    const pr = L.pulleyR;
    const py = cy + sheaveY;
    const sheave = el('g', {}, slide);
    el('circle', { cx, cy: py, r: pr, fill: this.ref('brass'), stroke: '#4a3412', 'stroke-width': 1 }, sheave);
    el('circle', { cx, cy: py, r: pr * 0.66, fill: this.ref('recess') }, sheave);
    for (let k = 0; k < 3; k++) {
      el(
        'rect',
        {
          x: cx - 1.4,
          y: py - pr * 0.66,
          width: 2.8,
          height: pr * 0.66,
          fill: '#c79a4b',
          transform: `rotate(${k * 120} ${cx} ${py})`,
        },
        sheave,
      );
    }
    el('circle', { cx, cy: py, r: Math.max(2.2, pr * 0.2), fill: this.ref('rod') }, sheave);
    const cheekW = Math.max(5, pr * 0.42);
    el(
      'rect',
      {
        x: cx - cheekW / 2,
        y: dir > 0 ? py - pr - 6 : py,
        width: cheekW,
        height: pr + 6,
        rx: cheekW / 2,
        fill: this.ref('rod'),
        stroke: '#2e363b',
        'stroke-width': 0.6,
      },
      slide,
    );
    el(
      'circle',
      { cx, cy: py, r: Math.max(2, pr * 0.16), fill: '#e9edef', stroke: '#2e363b', 'stroke-width': 0.6 },
      slide,
    );

    // The wheel, drawn under the sliding frame's slot but over its rod, on a still shadow (a filter on a
    // turning wheel would be redrawn every frame).
    const shadow = el('circle', { cx, cy: cy + 4, r: R * 1.18, fill: this.ref('shade') }, group);
    const wheel = el('g', { class: 'tm-wheel' }, group);
    group.insertBefore(shadow, slide);
    group.insertBefore(wheel, slide);
    const teeth = Math.max(24, Math.round(R * 1.15));
    el('path', { d: gearPath(R, teeth), fill: this.ref('brass'), stroke: '#4d3613', 'stroke-width': 0.7 }, wheel);
    el('circle', { r: R * 0.78, fill: this.ref('recess') }, wheel);
    for (let k = 0; k < 5; k++) {
      el(
        'path',
        {
          d: `M${-R * 0.07} 0L${-R * 0.045} ${-R * 0.8}L${R * 0.045} ${-R * 0.8}L${R * 0.07} 0Z`,
          fill: this.ref('brass'),
          transform: `rotate(${k * 72 + 36})`,
        },
        wheel,
      );
    }
    el('circle', { r: R * 0.8, fill: 'none', stroke: '#c9a056', 'stroke-width': Math.max(1.6, R * 0.07) }, wheel);
    el('circle', { r: R * 0.26, fill: this.ref('brass'), stroke: '#5a3f15', 'stroke-width': 0.6 }, wheel);
    // The adjustable arm: a radial slot the pin is clamped in.
    const slot = el(
      'rect',
      { x: -R * 0.07, y: -R * 0.86, width: R * 0.14, height: R * 0.86, rx: R * 0.07, fill: '#24190a' },
      wheel,
    );
    el('circle', { r: Math.max(2, R * 0.09), fill: this.ref('rod') }, wheel);

    // The pin rides in the sliding frame's slot, so it sits on top.
    const pin = el('g', { class: 'tm-pin' }, group);
    el('circle', { r: Math.max(3.2, R * 0.13), fill: this.ref('rod'), stroke: '#1f2528', 'stroke-width': 0.8 }, pin);
    el('circle', { r: Math.max(1.2, R * 0.045), fill: '#f7f9fa' }, pin);

    let tag: SVGTextElement | undefined;
    if (L.tags !== false) {
      const ty = spec.row === 'upper' ? cy - R - 10 : cy + R + 19;
      tag = el(
        'text',
        {
          x: cx,
          y: ty,
          'text-anchor': 'middle',
          class: 'tm-tag',
          fill: '#d9bd7f',
          'font-size': Math.max(13, R * 0.42),
          'letter-spacing': '0.06em',
        },
        group,
      );
      tag.textContent = spec.name;
    }

    wheel.setAttribute('transform', `translate(${cx} ${cy})`);
    group.addEventListener('click', () => this.onWheel?.(spec.name));
    return { spec, cx, cy, group, wheel, slot, pin, slide, sheave, tag, disp: 0, pinX: cx, pinY: cy, dy: 0 };
  }

  private drawCrank(root: SVGGElement, c: { x: number; y: number; r: number }): void {
    const g = el('g', { class: 'tm-crank' }, root);
    el('circle', { cx: c.x, cy: c.y + 4, r: c.r * 1.45, fill: this.ref('shade') }, g);
    const turn = el('g', {}, g);
    el(
      'circle',
      { cx: c.x, cy: c.y, r: c.r, fill: 'none', stroke: this.ref('brass'), 'stroke-width': c.r * 0.2 },
      turn,
    );
    el('circle', { cx: c.x, cy: c.y, r: c.r, fill: 'none', stroke: '#4d3613', 'stroke-width': 0.8 }, turn);
    for (let k = 0; k < 6; k++) {
      el(
        'rect',
        {
          x: c.x - 2.5,
          y: c.y - c.r,
          width: 5,
          height: c.r,
          fill: '#b68a3e',
          transform: `rotate(${k * 60} ${c.x} ${c.y})`,
        },
        turn,
      );
    }
    el('circle', { cx: c.x, cy: c.y, r: c.r * 0.22, fill: this.ref('brass'), stroke: '#4d3613' }, turn);
    // Handle: an arm out past the rim and a wooden grip.
    el('rect', { x: c.x - 4, y: c.y - c.r * 1.32, width: 8, height: c.r * 1.32, rx: 4, fill: this.ref('rod') }, turn);
    el(
      'circle',
      { cx: c.x, cy: c.y - c.r * 1.32, r: 10, fill: '#5b2d16', stroke: '#2b140a', 'stroke-width': 1.2 },
      turn,
    );
    el('circle', { cx: c.x - 3, cy: c.y - c.r * 1.32 - 3, r: 3.2, fill: '#9c5a33', opacity: 0.7 }, turn);
    el('circle', { cx: c.x, cy: c.y, r: c.r * 1.55, fill: 'transparent', class: 'tm-crank-hit' }, g);
    this.crankGroup = turn;
  }

  private drawDials(root: SVGGElement, D: NonNullable<Layout['dials']>): void {
    const g = el('g', { class: 'tm-dials' }, root);

    // Date: four windows in a brass bezel.
    const widths = [50, 34, 50, 62];
    const total = widths.reduce((a, b) => a + b, 0) + 6 * (widths.length - 1);
    let x = D.x - total / 2;
    el(
      'rect',
      {
        x: x - 12,
        y: D.dateY - 26,
        width: total + 24,
        height: 52,
        rx: 6,
        fill: this.ref('bar'),
        filter: this.ref('lift'),
      },
      g,
    );
    this.dateTexts = [];
    for (const w of widths) {
      el('rect', { x, y: D.dateY - 17, width: w, height: 34, rx: 3, fill: '#f1ece0', stroke: '#5a3f15' }, g);
      el('rect', { x, y: D.dateY - 17, width: w, height: 8, rx: 3, fill: 'rgb(0 0 0 / 0.12)' }, g);
      const t = el(
        'text',
        { x: x + w / 2, y: D.dateY + 7, 'text-anchor': 'middle', class: 'tm-date', fill: '#1c1e1d', 'font-size': 18 },
        g,
      );
      this.dateTexts.push(t);
      x += w + 6;
    }

    // A 24-hour clock.
    const c = { x: D.x, y: D.clockY, r: D.clockR };
    this.dialFace(g, c.x, c.y, c.r);
    const ticks = el('g', {}, g);
    for (let k = 0; k < 96; k++) {
      const major = k % 4 === 0;
      const r1 = c.r * 0.86;
      const r2 = c.r * (major ? 0.74 : 0.81);
      const a = (k / 96) * Math.PI * 2;
      el(
        'line',
        {
          x1: c.x + r1 * Math.sin(a),
          y1: c.y - r1 * Math.cos(a),
          x2: c.x + r2 * Math.sin(a),
          y2: c.y - r2 * Math.cos(a),
          stroke: '#2a2a28',
          'stroke-width': major ? 1.6 : 0.7,
        },
        ticks,
      );
      if (major && (k / 4) % 2 === 0) {
        const n = k / 4 === 0 ? 24 : k / 4;
        const r3 = c.r * 0.6;
        const t = el(
          'text',
          {
            x: c.x + r3 * Math.sin(a),
            y: c.y - r3 * Math.cos(a) + 5,
            'text-anchor': 'middle',
            class: 'tm-dialnum',
            fill: '#222',
            'font-size': c.r * 0.17,
          },
          ticks,
        );
        t.textContent = String(n);
      }
    }
    this.label(g, c.x, c.y + c.r * 0.33, 'HOURS', c.r * 0.11);
    this.clockMinute = this.hand(g, c.x, c.y, c.r * 0.8, 2.2, '#1c2f4a');
    this.clockHour = this.hand(g, c.x, c.y, c.r * 0.52, 4, '#1c2f4a');
    el('circle', { cx: c.x, cy: c.y, r: 4.5, fill: '#1c2f4a' }, g);
    el('circle', { cx: c.x, cy: c.y, r: 1.6, fill: '#d8dde0' }, g);

    // Height above chart datum.
    const h = { x: D.x, y: D.heightY, r: D.heightR };
    this.dialFace(g, h.x, h.y, h.r);
    this.heightTicks = el('g', {}, g);
    this.heightHand = this.hand(g, h.x, h.y, h.r * 0.84, 3, '#7c2618');
    el('circle', { cx: h.x, cy: h.y, r: 5, fill: '#7c2618' }, g);
    el('circle', { cx: h.x, cy: h.y, r: 1.8, fill: '#e8e2d6' }, g);
  }

  private dialFace(g: SVGGElement, x: number, y: number, r: number): void {
    el('circle', { cx: x, cy: y, r: r + 9, fill: this.ref('brass'), filter: this.ref('lift') }, g);
    el('circle', { cx: x, cy: y, r: r + 3, fill: 'none', stroke: '#5a3f15', 'stroke-width': 1.4 }, g);
    el('circle', { cx: x, cy: y, r, fill: this.ref('silver') }, g);
    el('circle', { cx: x, cy: y, r: r * 0.88, fill: 'none', stroke: '#2a2a28', 'stroke-width': 0.6 }, g);
  }

  private label(g: SVGGElement, x: number, y: number, text: string, size: number): SVGTextElement {
    const t = el(
      'text',
      {
        x,
        y,
        'text-anchor': 'middle',
        class: 'tm-plate',
        fill: '#3a3934',
        'font-size': size,
        'letter-spacing': '0.14em',
      },
      g,
    );
    t.textContent = text;
    return t;
  }

  private hand(g: SVGGElement, x: number, y: number, len: number, w: number, color: string): SVGGElement {
    const hand = el('g', {}, g);
    el(
      'path',
      {
        d: `M${x - w} ${y + len * 0.16}L${x - w * 0.5} ${y - len}L${x} ${y - len - w}L${x + w * 0.5} ${y - len}L${x + w} ${y + len * 0.16}Z`,
        fill: color,
      },
      hand,
    );
    return hand;
  }

  private drawNameplate(root: SVGGElement, n: NonNullable<Layout['nameplate']>): void {
    const g = el('g', {}, root);
    el(
      'rect',
      { x: n.x - n.w / 2, y: n.y - 30, width: n.w, height: 60, rx: 4, fill: this.ref('bar'), filter: this.ref('lift') },
      g,
    );
    el(
      'rect',
      { x: n.x - n.w / 2 + 5, y: n.y - 25, width: n.w - 10, height: 50, rx: 2, fill: 'none', stroke: '#6f501f' },
      g,
    );
    for (const sx of [-1, 1]) {
      el('circle', { cx: n.x + sx * (n.w / 2 - 12), cy: n.y, r: 3, fill: this.ref('rod') }, g);
    }
    const t1 = el(
      'text',
      {
        x: n.x,
        y: n.y - 5,
        'text-anchor': 'middle',
        class: 'tm-plate',
        fill: '#3b2a10',
        'font-size': 12.5,
        'letter-spacing': '0.2em',
      },
      g,
    );
    t1.textContent = 'TIDE PREDICTING MACHINE';
    this.nameText = el(
      'text',
      {
        x: n.x,
        y: n.y + 15,
        'text-anchor': 'middle',
        class: 'tm-plate',
        fill: '#3b2a10',
        'font-size': 14,
        'letter-spacing': '0.16em',
      },
      g,
    );
  }

  setName(name: string): void {
    if (this.nameText) this.nameText.textContent = name.toUpperCase();
  }

  /**
   * Set the paper's height scale. `hMin`/`hMax` in metres; `step` in display units; `scale` converts metres
   * to display units.
   */
  setScale(hMin: number, hMax: number, step: number, unit: string, scale: number): void {
    const P = this.layout.paper;
    this.hMin = hMin;
    this.hMax = hMax;
    this.yMin = P.y1 - (P.y1 - P.y0) * 0.1;
    this.yMax = P.y0 + (P.y1 - P.y0) * 0.1;
    this.gridStep = step;
    this.unitLabel = unit;
    this.unitScale = scale;
    this.samples = [];
    this.drawHeightGrid();
    this.drawHeightDial();
  }

  setTime(dayLabel: (ms: number) => string, localHours: (ms: number) => number): void {
    this.dayLabel = dayLabel;
    this.localHours = localHours;
  }

  clearPaper(): void {
    this.samples = [];
    this.head = null;
  }

  yOf(h: number): number {
    return this.yMin + ((h - this.hMin) / (this.hMax - this.hMin)) * (this.yMax - this.yMin);
  }

  private drawHeightGrid(): void {
    const P = this.layout.paper;
    this.heightLabels.replaceChildren();
    const lo = Math.ceil((this.hMin * this.unitScale) / this.gridStep - 0.4);
    const hi = Math.floor((this.hMax * this.unitScale) / this.gridStep + 0.4);
    let d = '';
    for (let k = lo; k <= hi; k++) {
      const y = this.yOf((k * this.gridStep) / this.unitScale);
      if (y < P.y0 + 4 || y > P.y1 - 4) continue;
      d += `M${P.x0} ${fmt(y)}H${P.x1}`;
      if (!this.unitLabel || y < P.y0 + 20) continue;
      const t = el(
        'text',
        { x: P.x0 + 16, y: y - 4, class: 'tm-hnum', fill: '#7a6f57', 'font-size': 14 },
        this.heightLabels,
      );
      const v = k * this.gridStep;
      t.textContent = `${Number.isInteger(v) ? v : v.toFixed(1)} ${this.unitLabel}`;
    }
    this.heightPath = d;
  }

  private heightPath = '';

  private drawHeightDial(): void {
    const D = this.layout.dials;
    if (!D || !this.heightTicks) return;
    const g = this.heightTicks;
    g.replaceChildren();
    const x = D.x;
    const y = D.heightY;
    const r = D.heightR;
    const from = Math.floor((this.hMin * this.unitScale) / this.gridStep) * this.gridStep;
    const to = Math.ceil((this.hMax * this.unitScale) / this.gridStep) * this.gridStep;
    this.dialFrom = from;
    this.dialTo = to;
    const span = 270;
    const n = Math.round((to - from) / this.gridStep);
    const sub = n <= 6 ? 5 : n <= 12 ? 2 : 1;
    for (let k = 0; k <= n * sub; k++) {
      const v = from + (k / sub) * this.gridStep;
      const a = (-135 + ((v - from) / (to - from)) * span) * RAD;
      const major = k % sub === 0;
      const r1 = r * 0.86;
      const r2 = r * (major ? 0.72 : 0.8);
      el(
        'line',
        {
          x1: x + r1 * Math.sin(a),
          y1: y - r1 * Math.cos(a),
          x2: x + r2 * Math.sin(a),
          y2: y - r2 * Math.cos(a),
          stroke: '#2a2a28',
          'stroke-width': major ? 1.6 : 0.7,
        },
        g,
      );
      const every = n > 10 ? 2 : 1;
      if (major && (k / sub) % every === 0) {
        const r3 = r * 0.57;
        const t = el(
          'text',
          {
            x: x + r3 * Math.sin(a),
            y: y - r3 * Math.cos(a) + 5,
            'text-anchor': 'middle',
            class: 'tm-dialnum',
            fill: '#222',
            'font-size': r * 0.16,
          },
          g,
        );
        t.textContent = Number.isInteger(v) ? String(v) : v.toFixed(1);
      }
    }
    const lbl = this.label(g, x, y + r * 0.42, this.unitLabel === 'ft' ? 'FEET' : 'METRES', r * 0.1);
    lbl.setAttribute('fill', '#3a3934');
  }

  /**
   * Draw the machine at time `t` (ms). `wheels` follows the layout's unit order. `h` is the height the pen
   * writes, in metres. `crankTurns` turns the crank. `clock` fills the dials.
   */
  frame(t: number, wheels: WheelState[], h: number, crankTurns = 0, clock?: Clock): void {
    const L = this.layout;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      const w = wheels[i];
      if (!w) continue;
      const upper = u.spec.row === 'upper';
      const angle = upper ? w.angle : w.angle + 180;
      u.wheel.setAttribute('transform', `translate(${u.cx} ${u.cy}) rotate(${fmt(angle % 360)})`);
      const a = angle * RAD;
      const px = u.cx + w.pin * Math.sin(a);
      const dy = -w.pin * Math.cos(a);
      u.pin.setAttribute('transform', `translate(${fmt(px)} ${fmt(u.cy + dy)})`);
      u.pinX = px;
      u.pinY = u.cy + dy;
      u.dy = dy;
      u.slide.setAttribute('transform', `translate(0 ${fmt(dy)})`);
      u.disp = upper ? -dy : dy; // chain taken up by this pulley's motion
      const off = !w.engaged;
      if (u.group.classList.contains('off') !== off) u.group.classList.toggle('off', off);
    }

    // The chain: anchor, then every pulley in order along the frame, then the guide, then down to the pen.
    const pr = L.pulleyR;
    type C = { x: number; y: number; r: number; s: number };
    const circles: C[] = [{ x: L.anchor.x, y: L.anchor.y, r: 0, s: 1 }];
    let taken = 0;
    for (const u of this.chainOrder) {
      const upper = u.spec.row === 'upper';
      const dy = upper ? -u.disp : u.disp;
      const y = u.cy + (upper ? L.reach : -L.reach) + dy;
      circles.push({ x: u.cx, y, r: pr, s: upper ? 1 : -1 });
      // Turn each pulley by the chain that has passed over it.
      const spin = ((taken * 2 + u.disp) / pr / RAD) % 360;
      taken += u.disp;
      u.sheave.setAttribute('transform', `rotate(${fmt(spin)} ${u.cx} ${u.cy + (upper ? L.reach : -L.reach)})`);
    }
    const G = L.guide;
    circles.push({ x: G.x, y: G.y, r: G.r, s: 1 });
    const penY = this.yOf(h);
    let d = `M${fmt(circles[0].x)} ${fmt(circles[0].y)}`;
    let prevEnd: [number, number] | null = null;
    for (let i = 0; i < circles.length - 1; i++) {
      const a = circles[i];
      const b = circles[i + 1];
      const [x1, y1, x2, y2] = tangent(a, a.r, a.s, b, b.r, b.s);
      if (prevEnd && a.r > 0) d += this.arc(a, prevEnd, [x1, y1]);
      d += `L${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`;
      prevEnd = [x2, y2];
    }
    const exit: [number, number] = [G.x + G.r, G.y];
    if (prevEnd) d += this.arc(circles[circles.length - 1], prevEnd, exit);
    d += `L${fmt(exit[0])} ${fmt(penY - 9)}`;
    this.chainBase.setAttribute('d', d);
    this.chainLinks.setAttribute('d', d);
    this.carriage.setAttribute('transform', `translate(0 ${fmt(penY)})`);

    // Paper: record the pen, then draw the visible window.
    this.record(t, penY);
    this.drawPaper(t);

    if (this.crankGroup && L.crank) {
      this.crankGroup.setAttribute('transform', `rotate(${fmt((crankTurns * 360) % 360)} ${L.crank.x} ${L.crank.y})`);
    }
    if (clock && L.dials && this.dateTexts) {
      const D = L.dials;
      const parts = [clock.weekday, clock.day, clock.month, clock.year];
      parts.forEach((p, i) => {
        const tnode = this.dateTexts![i];
        if (tnode.textContent !== p) tnode.textContent = p;
      });
      const hr = (clock.hours / 24) * 360;
      const mn = ((clock.hours % 1) * 360) % 360;
      this.clockHour?.setAttribute('transform', `rotate(${fmt(hr)} ${D.x} ${D.clockY})`);
      this.clockMinute?.setAttribute('transform', `rotate(${fmt(mn)} ${D.x} ${D.clockY})`);
      const v = h * this.unitScale;
      const frac = Math.max(-0.03, Math.min(1.03, (v - this.dialFrom) / (this.dialTo - this.dialFrom)));
      this.heightHand?.setAttribute('transform', `rotate(${fmt(-135 + frac * 270)} ${D.x} ${D.heightY})`);
    }
  }

  private arc(c: { x: number; y: number; r: number; s: number }, from: [number, number], to: [number, number]): string {
    const a0 = Math.atan2(from[1] - c.y, from[0] - c.x);
    const a1 = Math.atan2(to[1] - c.y, to[0] - c.x);
    // s = +1: centre on the right of travel, so the chain turns clockwise on screen.
    let sweep = c.s > 0 ? a1 - a0 : a0 - a1;
    while (sweep < 0) sweep += Math.PI * 2;
    const large = sweep > Math.PI ? 1 : 0;
    return `A${fmt(c.r)} ${fmt(c.r)} 0 ${large} ${c.s > 0 ? 1 : 0} ${fmt(to[0])} ${fmt(to[1])}`;
  }

  /** The pen's last position, drawn after the committed samples so the line always reaches the nib. */
  private head: { t: number; y: number } | null = null;

  private record(t: number, y: number): void {
    const s = this.samples;
    while (s.length && s[s.length - 1].t > t) s.pop();
    const last = s[s.length - 1];
    // Commit a point at most every two minutes of tide time.
    if (!last || t - last.t >= 120000) s.push({ t, y });
    this.head = { t, y };
    const keep = t - (this.layout.hours + 2) * 3600000;
    let drop = 0;
    while (drop < s.length - 1 && s[drop + 1].t < keep) drop++;
    if (drop > 0) s.splice(0, drop);
  }

  /** Lay down a stretch of trace at once, as if the machine had been running: `[ms, metres]` pairs. */
  fill(points: [number, number][]): void {
    this.samples = points.map(([t, h]) => ({ t, y: this.yOf(h) }));
    this.head = null;
  }

  /** Paper x for a moment, with the pen at time `t`. */
  xAt(ms: number, t: number): number {
    const L = this.layout;
    const penX = L.guide.x + L.guide.r;
    return penX - ((t - ms) / 3600000) * ((penX - L.paper.x0) / L.hours);
  }

  /** A group on the paper, under the trace, for the page's own marks. */
  get overlay(): SVGGElement {
    return this.marks;
  }

  private drawPaper(t: number): void {
    const L = this.layout;
    const P = L.paper;
    const penX = L.guide.x + L.guide.r;
    const pxh = (penX - P.x0) / L.hours;
    const xOf = (ms: number) => penX - ((t - ms) / 3600000) * pxh;

    // Trace.
    let d = '';
    for (let i = 0; i < this.samples.length; i++) {
      const p = this.samples[i];
      d += `${i ? 'L' : 'M'}${fmt(xOf(p.t))} ${fmt(p.y)}`;
    }
    if (this.head && d) d += `L${fmt(xOf(this.head.t))} ${fmt(this.head.y)}`;
    this.trace.setAttribute('d', d);

    // Hour lines move with the paper; midnights are bold and noons carry the day.
    const hoursLeft = L.hours + 1;
    const hoursRight = (P.x1 - penX) / pxh + 1;
    const lh = this.localHours(t);
    const startHour = Math.floor(lh - hoursLeft);
    const endHour = Math.ceil(lh + hoursRight);
    let thin = this.heightPath;
    let bold = '';
    const every = pxh < 2 ? 24 : pxh < 3 ? 6 : pxh < 8 ? 3 : 1;
    const weekly = pxh < 2;
    const labels: [number, number][] = [];
    for (let k = startHour; k <= endHour; k++) {
      const ms = t + (k - lh) * 3600000;
      const x = xOf(ms);
      if (x < P.x0 || x > P.x1) continue;
      const hod = ((k % 24) + 24) % 24;
      if (hod === 0 && (!weekly || Math.floor((ms + 12 * HOUR_MS) / 86400000) % 7 === 0))
        bold += `M${fmt(x)} ${P.y0}V${P.y1}`;
      else if (hod % every === 0) thin += `M${fmt(x)} ${P.y0}V${P.y1}`;
      if (hod === 12) labels.push([x, ms]);
    }
    this.grid.setAttribute('d', thin);
    this.gridBold.setAttribute('d', bold);

    // Day labels, reused.
    const pool = this.gridLabels.children;
    labels.forEach(([x, ms], i) => {
      let node = pool[i] as SVGTextElement | undefined;
      if (!node) {
        node = el(
          'text',
          { 'text-anchor': 'middle', class: 'tm-day', fill: '#6d6350', 'font-size': 14 },
          this.gridLabels,
        );
      }
      node.setAttribute('x', fmt(x));
      node.setAttribute('y', String(P.y1 - 11));
      const txt = this.dayLabel(ms);
      if (node.textContent !== txt) node.textContent = txt;
      node.removeAttribute('display');
    });
    for (let i = labels.length; i < pool.length; i++) pool[i].setAttribute('display', 'none');
  }

  /** The crank's centre in client coordinates, for dragging. */
  crankCenter(): { x: number; y: number } | null {
    const c = this.layout.crank;
    if (!c) return null;
    const m = this.svg.getScreenCTM();
    if (!m) return null;
    const pt = this.svg.createSVGPoint();
    pt.x = c.x;
    pt.y = c.y;
    const p = pt.matrixTransform(m);
    return { x: p.x, y: p.y };
  }

  /** Convert client coordinates to the SVG's own. */
  toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const m = this.svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const pt = this.svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  /** Where a unit's moving parts were last drawn: its pin, and its sliding frame's offset. */
  unitState(name: string): { pinX: number; pinY: number; dy: number; pulleyY: number } | null {
    const u = this.units.find((n) => n.spec.name === name);
    if (!u) return null;
    const upper = u.spec.row === 'upper';
    return {
      pinX: u.pinX,
      pinY: u.pinY,
      dy: u.dy,
      pulleyY: u.cy + (upper ? this.layout.reach : -this.layout.reach) + u.dy,
    };
  }

  unitCenter(name: string): { x: number; y: number; r: number } | null {
    const u = this.units.find((n) => n.spec.name === name);
    return u ? { x: u.cx, y: u.cy, r: this.layout.gearR } : null;
  }
}
