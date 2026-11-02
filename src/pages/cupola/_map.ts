// Build time only: Natural Earth's land (via world-atlas) as one SVG path on a
// plate carrée, x = longitude and y = minus latitude, for the ground track map.

import topo from 'world-atlas/land-110m.json';

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: { land: { geometries: { type: string; arcs: number[][][] | number[][] }[] } };
}

export function landPath(): string {
  const t = topo as unknown as Topology;
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
  let d = '';
  for (const g of t.objects.land.geometries) {
    const polys = (g.type === 'Polygon' ? [g.arcs] : g.arcs) as number[][][];
    for (const poly of polys) {
      for (const ids of poly) {
        const ring: [number, number][] = [];
        for (const id of ids) {
          const a = id < 0 ? arcs[~id].slice().reverse() : arcs[id];
          ring.push(...(ring.length ? a.slice(1) : a));
        }
        // Rings that cross the antimeridian run on past ±180; the map draws the path
        // again a world to either side, so the overhang shows up on the other edge.
        let prev = ring[0][0];
        let shift = 0;
        d += ring
          .map(([lon, lat], i) => {
            if (lon - prev > 180) shift -= 360;
            else if (prev - lon > 180) shift += 360;
            prev = lon;
            return `${i ? 'L' : 'M'}${(lon + shift).toFixed(1)} ${(-lat).toFixed(1)}`;
          })
          .join('');
        d += 'Z';
      }
    }
  }
  return d;
}
