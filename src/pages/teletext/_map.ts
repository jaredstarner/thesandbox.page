// Build time only: samples Natural Earth's countries (via world-atlas) onto
// the weather map's grid of block-graphic dots, so the page ships one short
// string instead of a coastline. 0 is sea, 1 the United States, 2 Canada or
// Mexico.

import topo from 'world-atlas/countries-50m.json';
import { MAP } from './_mapgrid';

type Ring = [number, number][];

interface Geometry {
  type: string;
  id?: string;
  arcs: number[][][] | number[][];
}

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: { countries: { geometries: Geometry[] } };
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

function ringsOf(g: Geometry, arcs: Ring[]): Ring[] {
  const ring = (ids: number[]): Ring => {
    const out: Ring = [];
    for (const id of ids) {
      const a = id < 0 ? arcs[~id].slice().reverse() : arcs[id];
      out.push(...(out.length ? a.slice(1) : a));
    }
    return out;
  };
  const polys = (g.type === 'Polygon' ? [g.arcs] : g.arcs) as number[][][];
  return polys.flatMap((poly) => poly.map(ring));
}

function inside(lon: number, lat: number, rings: Ring[]): boolean {
  let hit = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

/** One digit per dot, row by row from the north-west corner. */
export function mapMask(): string {
  const t = topo as unknown as Topology;
  const arcs = decodeArcs(t);
  const find = (id: string) => t.objects.countries.geometries.find((g) => g.id === id);
  const us = ringsOf(find('840')!, arcs);
  const near = [...ringsOf(find('124')!, arcs), ...ringsOf(find('484')!, arcs)];
  let out = '';
  for (let y = 0; y < MAP.h; y++) {
    for (let x = 0; x < MAP.w; x++) {
      const { lon, lat } = MAP.unproject(x + 0.5, y + 0.5);
      out += inside(lon, lat, us) ? '1' : inside(lon, lat, near) ? '2' : '0';
    }
  }
  return out;
}
