// Build time only: Natural Earth's land (via world-atlas) packed into a half-degree bitmap for the
// readout's little globe, so the page ships about forty kilobytes instead of a coastline.

import topo from 'world-atlas/land-110m.json';
import { LAND_PER_DEGREE } from './_globe';

type Ring = [number, number][];

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: { land: { geometries: { type: string; arcs: number[][][] | number[][][][] }[] } };
}

function rings(t: Topology): Ring[] {
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
    for (const poly of polys) for (const r of poly) all.push(unwrap(ring(r)));
  }
  return all;
}

/**
 * Natural Earth joins some rings across the antimeridian (Chukotka, Fiji, Antarctica), stepping from
 * 180 to -180. Unwrap each ring so it runs on past 180 instead, and close one that circles a pole
 * along the pole itself.
 */
function unwrap(r: Ring): Ring {
  const out: Ring = [];
  let shift = 0;
  for (let i = 0; i < r.length; i++) {
    if (i > 0) {
      const d = r[i][0] - r[i - 1][0];
      if (d > 180) shift -= 360;
      if (d < -180) shift += 360;
    }
    out.push([r[i][0] + shift, r[i][1]]);
  }
  if (Math.abs(out[out.length - 1][0] - out[0][0]) > 180) {
    const pole = out.reduce((t, p) => t + p[1], 0) < 0 ? -90 : 90;
    out.push([out[out.length - 1][0], pole], [out[0][0], pole]);
  }
  return out;
}

/** Base64 bitmap of land, rows from the north, west to east, LAND_PER_DEGREE cells to a degree. */
export function landBitmap(): string {
  const all = rings(topo as unknown as Topology);
  const step = 1 / LAND_PER_DEGREE;
  const cols = 360 * LAND_PER_DEGREE;
  const rows = 180 * LAND_PER_DEGREE;
  const bytes = new Uint8Array((cols * rows) / 8);
  for (let row = 0; row < rows; row++) {
    const lat = 90 - step / 2 - row * step;
    // Even-odd scanline: every ring edge that crosses this latitude, sorted west to east.
    const xs: number[] = [];
    for (const r of all) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i];
        const [xj, yj] = r[j];
        if (yi > lat !== yj > lat) xs.push(xi + ((lat - yi) * (xj - xi)) / (yj - yi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let col = 0; col < cols; col++) {
      const lon = -180 + step / 2 + col * step;
      let inside = lat < -80;
      if (!inside) {
        // Count crossings for this longitude in all three copies of the world together, since an
        // unwrapped ring can reach into the next copy.
        let n = 0;
        for (const x of xs) {
          if (x < lon - 360) n++;
          if (x < lon) n++;
          if (x < lon + 360) n++;
        }
        inside = n % 2 === 1;
      }
      if (inside) {
        const i = row * cols + col;
        bytes[i >> 3] |= 1 << (7 - (i & 7));
      }
    }
  }
  return btoa(String.fromCharCode(...bytes));
}
