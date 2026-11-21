// Build time only: Natural Earth's land (via world-atlas) packed into a one-degree bitmap for the
// readout's little globe, so the page ships about eleven kilobytes instead of a coastline.

import topo from 'world-atlas/land-110m.json';

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
    for (const poly of polys) for (const r of poly) all.push(ring(r));
  }
  return all;
}

/** Base64 bitmap of land, 360 by 180 one-degree cells, rows from the north, west to east. */
export function landBitmap(): string {
  const all = rings(topo as unknown as Topology);
  const bytes = new Uint8Array((360 * 180) / 8);
  for (let row = 0; row < 180; row++) {
    const lat = 89.5 - row;
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
    for (let col = 0; col < 360; col++) {
      const lon = -179.5 + col;
      let inside = lat < -80;
      if (!inside) {
        let n = 0;
        for (const x of xs) if (x < lon) n++;
        inside = n % 2 === 1;
      }
      if (inside) {
        const i = row * 360 + col;
        bytes[i >> 3] |= 1 << (7 - (i & 7));
      }
    }
  }
  return btoa(String.fromCharCode(...bytes));
}
