// Tero, Kobayashi, and Nakagaki's 2007 flow model of Physarum, on a graph:
// protoplasm flows from a source oat to a sink oat through tubes; a tube that
// carries flow thickens, and one that doesn't withers. Run long enough, only
// the shortest route between the two oats is left. The maze uses it to decide
// which corridors dry up; the agents then leave them.
//
// Tubes respond to flow as |Q|^GAIN rather than |Q|: with GAIN above 1, two
// routes of equal length no longer share the flow forever, and one wins.

export interface Tube {
  a: number;
  b: number;
  length: number;
  conductivity: number;
}

const FLOOR = 1e-6;
const GAIN = 1.6;

export class FlowSolver {
  readonly tubes: Tube[];
  private readonly nodes: number;
  private readonly source: number;
  private readonly sink: number;

  constructor(nodes: number, links: [number, number][], source: number, sink: number) {
    this.nodes = nodes;
    this.source = source;
    this.sink = sink;
    // A little unevenness in the starting tubes keeps exact ties from holding.
    this.tubes = links.map(([a, b]) => ({ a, b, length: 1, conductivity: 0.9 + Math.random() * 0.2 }));
  }

  /** One step of dD/dt = |Q|^GAIN - D, with a unit flow from source to sink. */
  iterate(dt: number): void {
    const pressure = this.pressures();
    for (const t of this.tubes) {
      const q = (t.conductivity / t.length) * (pressure[t.a]! - pressure[t.b]!);
      t.conductivity = Math.max(FLOOR, t.conductivity + dt * (Math.abs(q) ** GAIN - t.conductivity));
    }
  }

  /** Each node's widest tube, 0 to about 1. */
  levels(): Float32Array {
    const out = new Float32Array(this.nodes);
    for (const t of this.tubes) {
      out[t.a] = Math.max(out[t.a]!, t.conductivity);
      out[t.b] = Math.max(out[t.b]!, t.conductivity);
    }
    return out;
  }

  /** Kirchhoff's law at every node, the sink held at zero, solved by Gaussian elimination. */
  private pressures(): Float64Array {
    const n = this.nodes;
    const m = new Float64Array(n * (n + 1));
    const row = (i: number) => i * (n + 1);
    for (const t of this.tubes) {
      const g = t.conductivity / t.length + FLOOR;
      m[row(t.a) + t.a]! += g;
      m[row(t.b) + t.b]! += g;
      m[row(t.a) + t.b]! -= g;
      m[row(t.b) + t.a]! -= g;
    }
    m[row(this.source) + n] = 1;
    // Pin the sink: its row becomes p = 0.
    m.fill(0, row(this.sink), row(this.sink) + n + 1);
    m[row(this.sink) + this.sink] = 1;

    for (let c = 0; c < n; c++) {
      let pivot = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(m[row(r) + c]!) > Math.abs(m[row(pivot) + c]!)) pivot = r;
      if (pivot !== c) {
        for (let k = c; k <= n; k++) {
          const tmp = m[row(c) + k]!;
          m[row(c) + k] = m[row(pivot) + k]!;
          m[row(pivot) + k] = tmp;
        }
      }
      const d = m[row(c) + c]!;
      if (Math.abs(d) < 1e-12) continue;
      for (let r = c + 1; r < n; r++) {
        const f = m[row(r) + c]! / d;
        if (f === 0) continue;
        for (let k = c; k <= n; k++) m[row(r) + k]! -= f * m[row(c) + k]!;
      }
    }
    const p = new Float64Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = m[row(r) + n]!;
      for (let k = r + 1; k < n; k++) s -= m[row(r) + k]! * p[k]!;
      const d = m[row(r) + r]!;
      p[r] = Math.abs(d) < 1e-12 ? 0 : s / d;
    }
    return p;
  }
}
