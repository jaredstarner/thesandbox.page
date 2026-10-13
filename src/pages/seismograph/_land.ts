// Build time only: samples Natural Earth's land (via world-atlas) on an
// equal-area grid of dots and packs which dots are land into a bitmap, so the
// page ships a few kilobytes instead of a coastline. The client rebuilds the
// same grid from LAND_STEP with landDots() in _dial.ts.

import topo from 'world-atlas/land-110m.json';
import { LAND_STEP } from './_landstep';

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

/** Row lengths of the dot grid, shared with the client. */
export function gridRows(step = LAND_STEP): { lat: number; n: number }[] {
  const rows = [];
  for (let lat = -90 + step / 2; lat < 90; lat += step) {
    rows.push({ lat, n: Math.max(1, Math.round((360 * Math.cos((lat * Math.PI) / 180)) / step)) });
  }
  return rows;
}

/** Base64 bitmap, row by row from the south pole, of which grid dots are land. */
export function landBitmap(): string {
  const all = rings(topo as unknown as Topology);
  const bits: number[] = [];
  for (const { lat, n } of gridRows()) {
    for (let i = 0; i < n; i++) {
      const lon = -180 + ((i + 0.5) * 360) / n;
      // Antarctica's interior, where the polygon's polar edge is unreliable on a flat test.
      bits.push(lat < -80 || inside(lon, lat, all) ? 1 : 0);
    }
  }
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => {
    if (b) bytes[i >> 3] |= 1 << (7 - (i & 7));
  });
  return btoa(String.fromCharCode(...bytes));
}
