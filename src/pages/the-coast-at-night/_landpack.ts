// Build time only: Natural Earth land (via world-atlas) as Web Mercator
// polygons for the browser to triangulate (see _land.ts for the reader).
//
// Layout: a 16-byte header (magic, polygon count, ring count, point count),
// rings per polygon, points per ring, then x and y on a 2^24 grid over the
// Mercator square, each a difference from the point before.

import land10 from 'world-atlas/land-10m.json';
import land50 from 'world-atlas/land-50m.json';

export const LAND_MAGIC = 0x444e414c;
export const GRID = 1 << 24;

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: { land: { geometries: { type: string; arcs: number[][][] | number[][][][] }[] } };
}

const mercY = (lat: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

function polygons(t: Topology): [number, number][][][] {
  const [sx, sy] = t.transform.scale;
  const [tx, ty] = t.transform.translate;
  const arcs = t.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty] as [number, number];
    });
  });
  const ring = (ids: number[]) => {
    const out: [number, number][] = [];
    for (const id of ids) {
      const a = id < 0 ? arcs[~id].slice().reverse() : arcs[id];
      out.push(...(out.length ? a.slice(1) : a));
    }
    return out;
  };
  const out: [number, number][][][] = [];
  for (const g of t.objects.land.geometries) {
    const polys = (g.type === 'Polygon' ? [g.arcs] : g.arcs) as number[][][];
    for (const p of polys) out.push(p.map(ring));
  }
  return out;
}

export function packLand(res: '50m' | '10m'): Uint8Array<ArrayBuffer> {
  const polys = polygons((res === '10m' ? land10 : land50) as unknown as Topology);
  const rings = polys.flat();
  const points = rings.reduce((a, r) => a + r.length, 0);
  const buf = new ArrayBuffer(16 + 4 * polys.length + 4 * rings.length + 8 * points);
  const dv = new DataView(buf);
  dv.setUint32(0, LAND_MAGIC, true);
  dv.setUint32(4, polys.length, true);
  dv.setUint32(8, rings.length, true);
  dv.setUint32(12, points, true);
  const perPoly = new Uint32Array(buf, 16, polys.length);
  const perRing = new Uint32Array(buf, 16 + 4 * polys.length, rings.length);
  const xy = new Int32Array(buf, 16 + 4 * polys.length + 4 * rings.length, points * 2);
  polys.forEach((p, i) => (perPoly[i] = p.length));
  rings.forEach((r, i) => (perRing[i] = r.length));
  let k = 0;
  let px = 0;
  let py = 0;
  for (const r of rings) {
    for (const [lon, lat] of r) {
      const x = Math.round(((lon + 180) / 360) * GRID);
      const y = Math.round(mercY(lat) * GRID);
      xy[k++] = x - px;
      xy[k++] = y - py;
      px = x;
      py = y;
    }
  }
  return new Uint8Array(buf);
}
