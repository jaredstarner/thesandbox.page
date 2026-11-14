// The layout: move key stations about a grid, one step at a time, keeping any move that lowers a
// weighted sum of the things a diagram is judged on (lines on the allowed angles, chains long enough
// for their stations, straight runs through junctions, room between lines, no crossings, the right
// way up), with a little pull back toward the real geography. A multicriteria hill climb in the
// spirit of Stott, Rodgers, et al.; everything here is plain arithmetic, so it runs in a worker.

export type Angle = 45 | 60 | 90;

export interface LayoutChain {
  a: number;
  b: number;
  /** Stations between the ends. */
  inner: number;
  /** Lines along the chain. */
  lines: number;
  /** +1 or -1: which side of the straight a-b line the real track bulges to; 0 when it doesn't. */
  side: number;
}

export interface LayoutInput {
  /** Key positions from geography, in layout units (one unit is one station spacing). */
  geo: Float64Array;
  chains: LayoutChain[];
  angle: Angle;
  seed: number;
}

export interface LayoutResult {
  /** Key positions after each sweep; the first is the geography itself, the last the finished diagram. */
  frames: Float32Array[];
  energy: number[];
}

/** Grid pitch in layout units. */
export const PITCH = 0.5;

const SQRT3_2 = Math.sqrt(3) / 2;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Moves of one grid step for each angle setting. */
function steps(angle: Angle): [number, number][] {
  if (angle === 60) {
    const out: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const t = (i * Math.PI) / 3;
      out.push([Math.cos(t) * PITCH, Math.sin(t) * PITCH]);
    }
    return out;
  }
  if (angle === 90)
    return [
      [PITCH, 0],
      [-PITCH, 0],
      [0, PITCH],
      [0, -PITCH],
      [PITCH, PITCH],
      [-PITCH, PITCH],
      [PITCH, -PITCH],
      [-PITCH, -PITCH],
    ];
  return [
    [PITCH, 0],
    [-PITCH, 0],
    [0, PITCH],
    [0, -PITCH],
    [PITCH, PITCH],
    [-PITCH, PITCH],
    [PITCH, -PITCH],
    [-PITCH, -PITCH],
  ];
}

/** Snap a point to the grid: square for 45 and 90 degrees, triangular for 60. */
export function snap(angle: Angle, x: number, y: number): [number, number] {
  if (angle === 60) {
    const j = Math.round(y / (PITCH * SQRT3_2));
    const i = Math.round(x / PITCH - j / 2);
    return [(i + j / 2) * PITCH, j * PITCH * SQRT3_2];
  }
  return [Math.round(x / PITCH) * PITCH, Math.round(y / PITCH) * PITCH];
}

/**
 * The drawn route of a chain from a to b: straight when a-b already lies on an allowed angle, otherwise
 * two legs on the two allowed angles either side of it. `side` picks which way the bend goes, so it follows
 * the real track; returns the bend point, or null for a straight run.
 */
export function bendPoint(
  angle: Angle,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  side: number,
): [number, number] | null {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const step = (angle * Math.PI) / 180;
  const th = Math.atan2(dy, dx);
  const lo = Math.floor(th / step) * step;
  const hi = lo + step;
  if (Math.abs(th - lo) < 1e-3 || Math.abs(hi - th) < 1e-3) return null;
  // Solve d = p * u1 + q * u2.
  const u1x = Math.cos(lo);
  const u1y = Math.sin(lo);
  const u2x = Math.cos(hi);
  const u2y = Math.sin(hi);
  const det = u1x * u2y - u1y * u2x;
  const p = (dx * u2y - dy * u2x) / det;
  const q = (u1x * dy - u1y * dx) / det;
  // Option one: leave a along u1, then u2. Option two: leave along u2, then u1.
  const o1x = ax + p * u1x;
  const o1y = ay + p * u1y;
  const o2x = ax + q * u2x;
  const o2y = ay + q * u2y;
  const s1 = Math.sign(dx * (o1y - ay) - dy * (o1x - ax));
  if (side === 0) {
    // No preference: keep the longer leg first from a, which reads as the main direction.
    return p >= q ? [o1x, o1y] : [o2x, o2y];
  }
  return s1 === side ? [o1x, o1y] : [o2x, o2y];
}

const W = {
  angle: 7,
  length: 2.2,
  short: 30,
  bend: 2.6,
  resolution: 14,
  cross: 60,
  clear: 14,
  near: 24,
  dir: 2.4,
  anchor: 0.012,
};

/** Angles below this between two chains leaving one key are penalised, by setting. */
const MIN_GAP: Record<Angle, number> = { 45: Math.PI / 4, 60: Math.PI / 3, 90: Math.PI / 2 };

export function layout(input: LayoutInput): LayoutResult {
  const { geo, chains, angle } = input;
  const n = geo.length / 2;
  const m = chains.length;
  const rand = mulberry32(input.seed);
  const period = (angle * Math.PI) / 180;
  const minGap = MIN_GAP[angle];

  const ca = new Int32Array(m);
  const cb = new Int32Array(m);
  const target = new Float64Array(m);
  const weight = new Float64Array(m);
  const geoAngle = new Float64Array(m);
  const side = new Int8Array(m);
  const inc: number[][] = Array.from({ length: n }, () => []);
  chains.forEach((c, i) => {
    ca[i] = c.a;
    cb[i] = c.b;
    target[i] = c.inner + 1;
    weight[i] = 1 + 0.12 * c.inner + 0.25 * (c.lines - 1);
    geoAngle[i] = Math.atan2(geo[c.b * 2 + 1] - geo[c.a * 2 + 1], geo[c.b * 2] - geo[c.a * 2]);
    side[i] = c.side;
    inc[c.a].push(i);
    inc[c.b].push(i);
  });
  const chainLines = chains.map((c) => c.lines);
  const nodeNbrs: number[][] = inc.map((list, v) => [...new Set(list.map((c) => (ca[c] === v ? cb[c] : ca[c])))]);

  // Positions start on the grid at the geography, nudged apart where two keys snap together.
  const pos = new Float64Array(n * 2);
  const taken = new Set<string>();
  const order = [...Array(n).keys()];
  const mv = steps(angle);
  for (const v of order) {
    let [x, y] = snap(angle, geo[v * 2], geo[v * 2 + 1]);
    let r = 1;
    while (taken.has(`${x.toFixed(3)},${y.toFixed(3)}`) && r < 50) {
      const [sx, sy] = mv[Math.floor(rand() * mv.length)];
      [x, y] = snap(angle, geo[v * 2] + sx * r, geo[v * 2 + 1] + sy * r);
      r++;
    }
    taken.add(`${x.toFixed(3)},${y.toFixed(3)}`);
    pos[v * 2] = x;
    pos[v * 2 + 1] = y;
  }

  // Each chain's drawn route, cached: [ax, ay, (bx, by,) cx, cy].
  const route = new Float64Array(m * 6);
  const bent = new Uint8Array(m);
  const plen = new Float64Array(m);
  const updateRoute = (c: number) => {
    const a = ca[c];
    const b = cb[c];
    const ax = pos[a * 2];
    const ay = pos[a * 2 + 1];
    const bx = pos[b * 2];
    const by = pos[b * 2 + 1];
    const o = c * 6;
    route[o] = ax;
    route[o + 1] = ay;
    route[o + 4] = bx;
    route[o + 5] = by;
    const bp = bendPoint(angle, ax, ay, bx, by, side[c]);
    if (bp) {
      bent[c] = 1;
      route[o + 2] = bp[0];
      route[o + 3] = bp[1];
      plen[c] = Math.hypot(bp[0] - ax, bp[1] - ay) + Math.hypot(bx - bp[0], by - bp[1]);
    } else {
      bent[c] = 0;
      route[o + 2] = (ax + bx) / 2;
      route[o + 3] = (ay + by) / 2;
      plen[c] = Math.hypot(bx - ax, by - ay);
    }
  };
  for (let c = 0; c < m; c++) updateRoute(c);

  // --- Energy terms ---

  const chainTerm = (c: number) => {
    const a = ca[c];
    const b = cb[c];
    const dx = pos[b * 2] - pos[a * 2];
    const dy = pos[b * 2 + 1] - pos[a * 2 + 1];
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) return 1e4;
    const th = Math.atan2(dy, dx);
    const s = Math.sin((Math.PI * th) / period);
    let e = W.angle * weight[c] * s * s;
    const t = target[c];
    const l = plen[c];
    e += W.length * ((l - t * 1.15) / t) ** 2;
    if (l < t) e += W.short * ((t - l) / t) ** 2;
    e += W.dir * weight[c] * (1 - Math.cos(th - geoAngle[c]));
    return e;
  };

  /** Direction of chain c leaving node v, as an angle. */
  const leave = (c: number, v: number) => {
    const o = c * 6;
    // First leg from v: toward the bend when bent, else toward the far end.
    let fx: number;
    let fy: number;
    if (bent[c]) {
      fx = route[o + 2];
      fy = route[o + 3];
    } else if (ca[c] === v) {
      fx = route[o + 4];
      fy = route[o + 5];
    } else {
      fx = route[o];
      fy = route[o + 1];
    }
    return Math.atan2(fy - pos[v * 2 + 1], fx - pos[v * 2]);
  };

  const nodeTerm = (v: number) => {
    const list = inc[v];
    if (list.length < 2) return 0;
    let e = 0;
    const angles = list.map((c) => leave(c, v));
    // Straight through: every pair of chains at v that share lines.
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const shared = Math.min(chainLines[list[i]], chainLines[list[j]]);
        let gap = Math.abs(angles[i] - angles[j]) % (2 * Math.PI);
        if (gap > Math.PI) gap = 2 * Math.PI - gap;
        if (list.length === 2) e += W.bend * shared * ((1 + Math.cos(gap)) / 2);
        else e += (W.bend * 0.5 * shared * ((1 + Math.cos(gap)) / 2)) / (list.length - 1);
        if (gap < minGap) e += W.resolution * ((minGap - gap) / minGap) ** 2;
      }
    }
    return e;
  };

  const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };

  const cross2 = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) => {
    const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };

  /** Penalty when two chains' routes cross (chains that share a key are exempt). */
  const crossTerm = (c: number, d: number) => {
    if (ca[c] === ca[d] || ca[c] === cb[d] || cb[c] === ca[d] || cb[c] === cb[d]) return 0;
    const o = c * 6;
    const p = d * 6;
    // Bounding boxes first.
    const cminx = Math.min(route[o], route[o + 2], route[o + 4]);
    const cmaxx = Math.max(route[o], route[o + 2], route[o + 4]);
    const dminx = Math.min(route[p], route[p + 2], route[p + 4]);
    const dmaxx = Math.max(route[p], route[p + 2], route[p + 4]);
    if (cmaxx < dminx || dmaxx < cminx) return 0;
    const cminy = Math.min(route[o + 1], route[o + 3], route[o + 5]);
    const cmaxy = Math.max(route[o + 1], route[o + 3], route[o + 5]);
    const dminy = Math.min(route[p + 1], route[p + 3], route[p + 5]);
    const dmaxy = Math.max(route[p + 1], route[p + 3], route[p + 5]);
    if (cmaxy < dminy || dmaxy < cminy) return 0;
    let hits = 0;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        if (
          cross2(
            route[o + i * 2],
            route[o + i * 2 + 1],
            route[o + i * 2 + 2],
            route[o + i * 2 + 3],
            route[p + j * 2],
            route[p + j * 2 + 1],
            route[p + j * 2 + 2],
            route[p + j * 2 + 3],
          )
        )
          hits++;
      }
    }
    return hits ? W.cross : 0;
  };

  /** Penalty when key u sits on or near chain c's route. */
  const clearTerm = (u: number, c: number) => {
    if (ca[c] === u || cb[c] === u) return 0;
    const o = c * 6;
    const px = pos[u * 2];
    const py = pos[u * 2 + 1];
    const reach = 1.0;
    const d = Math.min(
      segDist(px, py, route[o], route[o + 1], route[o + 2], route[o + 3]),
      segDist(px, py, route[o + 2], route[o + 3], route[o + 4], route[o + 5]),
    );
    return d < reach ? W.clear * ((reach - d) / reach) ** 2 : 0;
  };

  const nearTerm = (u: number, v: number) => {
    const d = Math.hypot(pos[u * 2] - pos[v * 2], pos[u * 2 + 1] - pos[v * 2 + 1]);
    return d < 1.2 ? W.near * ((1.2 - d) / 1.2) ** 2 : 0;
  };

  const anchorTerm = (v: number) =>
    W.anchor * ((pos[v * 2] - geo[v * 2]) ** 2 + (pos[v * 2 + 1] - geo[v * 2 + 1]) ** 2);

  const localEnergy = (v: number) => {
    let e = anchorTerm(v);
    for (const c of inc[v]) {
      e += chainTerm(c);
      for (let d = 0; d < m; d++) if (d !== c) e += crossTerm(c, d);
      for (let u = 0; u < n; u++) e += clearTerm(u, c);
    }
    for (let d = 0; d < m; d++) e += clearTerm(v, d);
    e += nodeTerm(v);
    for (const u of nodeNbrs[v]) e += nodeTerm(u);
    for (let u = 0; u < n; u++) if (u !== v) e += nearTerm(u, v);
    return e;
  };

  const totalEnergy = () => {
    let e = 0;
    for (let v = 0; v < n; v++) e += anchorTerm(v) + nodeTerm(v);
    for (let c = 0; c < m; c++) {
      e += chainTerm(c);
      for (let d = c + 1; d < m; d++) e += crossTerm(c, d);
      for (let u = 0; u < n; u++) e += clearTerm(u, c);
    }
    for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) e += nearTerm(u, v);
    return e;
  };

  const frames: Float32Array[] = [Float32Array.from(geo), Float32Array.from(pos)];
  const energy: number[] = [totalEnergy(), totalEnergy()];

  const place = (v: number, x: number, y: number) => {
    pos[v * 2] = x;
    pos[v * 2 + 1] = y;
    for (const c of inc[v]) updateRoute(c);
  };

  const radii = [10, 7, 5, 4, 3, 2, 1, 1];
  for (const r of radii) {
    for (let sweep = 0; sweep < 6; sweep++) {
      let moved = 0;
      // Shuffle the visiting order each sweep.
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (const v of order) {
        if (!inc[v].length) continue;
        const ox = pos[v * 2];
        const oy = pos[v * 2 + 1];
        let best = localEnergy(v);
        let bx = ox;
        let by = oy;
        for (const [sx, sy] of mv) {
          const [x, y] = snap(angle, ox + sx * r, oy + sy * r);
          place(v, x, y);
          const e = localEnergy(v);
          if (e < best - 1e-6) {
            best = e;
            bx = x;
            by = y;
          }
        }
        place(v, bx, by);
        if (bx !== ox || by !== oy) moved++;
      }
      frames.push(Float32Array.from(pos));
      energy.push(totalEnergy());
      if (moved === 0) break;
    }
  }

  return { frames, energy };
}
