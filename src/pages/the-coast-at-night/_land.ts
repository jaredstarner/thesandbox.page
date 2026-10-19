// Reads land-50m.bin and land-10m.bin (written by _landpack.ts).
//
// The chart fills land with the stencil buffer rather than triangulating it:
// every ring is drawn as a fan of triangles from its first point, inverting
// the stencil, so inside counts odd and holes even. So the browser needs only
// an index list, never a triangulation of a 100,000-point coastline. Lakes
// are rings of their own, kept apart so the chart can cut them from land
// without ever turning sea into land where a lake's edge strays past a coast.

const MAGIC = 0x444e414c;
const GRID = 1 << 24;

export interface Land {
  /** Mercator x, y per point. */
  xy: Float32Array;
  /** Fan triangles for land rings: first point of the ring, then each edge. */
  fan: Uint32Array;
  /** The same for lake rings. */
  lakeFan: Uint32Array;
  /** Line strips per ring, parted by the primitive restart index. */
  lines: Uint32Array;
  /** Each ring's first point and point count, and its bounds in Mercator. */
  rings: { start: number; count: number; x0: number; y0: number; x1: number; y1: number; lake: boolean }[];
}

export async function loadLand(url: string): Promise<Land> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`land ${res.status}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('land: bad file');
  const polys = dv.getUint32(4, true);
  const ringCount = dv.getUint32(8, true);
  const points = dv.getUint32(12, true);
  const perRing = new Uint32Array(buf, 16 + 4 * polys, ringCount);
  const offKind = 16 + 4 * polys + 4 * ringCount;
  const kind = new Uint8Array(buf, offKind, ringCount);
  const d = new Int32Array(buf, (offKind + ringCount + 3) & ~3, points * 2);
  const xy = new Float32Array(points * 2);
  let x = 0;
  let y = 0;
  for (let i = 0; i < points; i++) {
    x += d[i * 2];
    y += d[i * 2 + 1];
    xy[i * 2] = x / GRID;
    xy[i * 2 + 1] = y / GRID;
  }
  let fanLen = 0;
  let lakeLen = 0;
  for (let r = 0; r < ringCount; r++) {
    if (kind[r]) lakeLen += Math.max(0, perRing[r] - 2) * 3;
    else fanLen += Math.max(0, perRing[r] - 2) * 3;
  }
  const fan = new Uint32Array(fanLen);
  const lakeFan = new Uint32Array(lakeLen);
  const lines = new Uint32Array(points + ringCount);
  const rings: Land['rings'] = [];
  let p = 0;
  let f = 0;
  let k = 0;
  let l = 0;
  for (let r = 0; r < ringCount; r++) {
    const n = perRing[r];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const px = xy[(p + i) * 2];
      const py = xy[(p + i) * 2 + 1];
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      lines[l++] = p + i;
    }
    lines[l++] = 0xffffffff;
    for (let i = 1; i < n - 1; i++) {
      if (kind[r]) {
        lakeFan[k++] = p;
        lakeFan[k++] = p + i;
        lakeFan[k++] = p + i + 1;
      } else {
        fan[f++] = p;
        fan[f++] = p + i;
        fan[f++] = p + i + 1;
      }
    }
    rings.push({ start: p, count: n, x0, y0, x1, y1, lake: kind[r] === 1 });
    p += n;
  }
  return { xy, fan, lakeFan, lines, rings };
}
