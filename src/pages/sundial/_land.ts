// Build time only: samples Natural Earth's land (via world-atlas) on a plain
// latitude-longitude grid and packs which cells are land into a bitmap, so the
// page's map ships a few kilobytes instead of a coastline.

import topo from 'world-atlas/land-110m.json';

/** Grid spacing in degrees; the client reads the same constant. */
export const MAP_STEP = 2;

type Ring = [number, number][];

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: { land: { geometries: { type: string; arcs: number[][][] | number[][] }[] } };
}

function decodeArcs(t: Topology): Ring[] {
  const [sx, sy] = t.transform.scale;
  const [tx, ty] = t.transform.translate;
  return t.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty] as [number, number];
    });
  });
}

function rings(t: Topology): Ring[] {
  const arcs = decodeArcs(t);
  const ring = (ids: number[]): Ring => {
    const out: Ring = [];
    for (const id of ids) {
      const a = id < 0 ? arcs[~id].slice().reverse() : arcs[id];
      out.push(...(out.length ? a.slice(1) : a));
    }
    return out;
  };
  const all: Ring[] = [];
  for (const g of t.objects.land.geometries) {
    const polys = (g.type === 'Polygon' ? [g.arcs] : g.arcs) as number[][][];
    for (const poly of polys) for (const r of poly) all.push(ring(r));
  }
  return all;
}

function inside(lon: number, lat: number, all: Ring[]): boolean {
  let hit = false;
  for (const r of all) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

/** Base64 bitmap, row by row from the north, west to east, of which grid cells are land. */
export function landBitmap(): string {
  const all = rings(topo as unknown as Topology);
  const bits: number[] = [];
  for (let lat = 90 - MAP_STEP / 2; lat > -90; lat -= MAP_STEP) {
    for (let lon = -180 + MAP_STEP / 2; lon < 180; lon += MAP_STEP) {
      bits.push(lat < -80 || inside(lon, lat, all) ? 1 : 0);
    }
  }
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => {
    if (b) bytes[i >> 3] |= 1 << (7 - (i & 7));
  });
  return btoa(String.fromCharCode(...bytes));
}
