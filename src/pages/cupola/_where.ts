// Build time only: a half-degree grid of what lies under every point on Earth,
// from Natural Earth's countries (via world-atlas) and a coarse hand-drawn
// split of the open water into oceans and seas. The page ships it run-length
// encoded and reads "Over the Coral Sea" from it as the station moves.

import topo from 'world-atlas/countries-50m.json';

type Ring = [number, number][];

interface Geometry {
  type: string;
  properties?: { name?: string };
  arcs: number[][][] | number[][];
}

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: { countries: { geometries: Geometry[] } };
}

/** Cells per degree. */
export const WHERE_RES = 2;
const W = 360 * WHERE_RES;
const H = 180 * WHERE_RES;

/** Natural Earth's short names, spelled out for a sentence. */
const FULL: Record<string, string> = {
  'United States of America': 'United States',
  'Dem. Rep. Congo': 'Democratic Republic of the Congo',
  'Central African Rep.': 'Central African Republic',
  'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'S. Sudan': 'South Sudan',
  'Eq. Guinea': 'Equatorial Guinea',
  'Fr. S. Antarctic Lands': 'French Southern and Antarctic Lands',
  'N. Cyprus': 'Northern Cyprus',
  'W. Sahara': 'Western Sahara',
  'Solomon Is.': 'Solomon Islands',
  'Falkland Is.': 'Falkland Islands',
  'Dominican Rep.': 'Dominican Republic',
  'Cayman Is.': 'Cayman Islands',
  'Faeroe Is.': 'Faroe Islands',
  'Marshall Is.': 'Marshall Islands',
  'N. Mariana Is.': 'Northern Mariana Islands',
  'Cook Is.': 'Cook Islands',
  'Turks and Caicos Is.': 'Turks and Caicos Islands',
  'British Virgin Is.': 'British Virgin Islands',
  'U.S. Virgin Is.': 'United States Virgin Islands',
  'Heard I. and McDonald Is.': 'Heard Island and McDonald Islands',
  'S. Geo. and the Is.': 'South Georgia',
  'Br. Indian Ocean Ter.': 'British Indian Ocean Territory',
  'Fr. Polynesia': 'French Polynesia',
  'St. Pierre and Miquelon': 'Saint Pierre and Miquelon',
  'St. Vin. and Gren.': 'Saint Vincent and the Grenadines',
  'St. Kitts and Nevis': 'Saint Kitts and Nevis',
  'Antigua and Barb.': 'Antigua and Barbuda',
  'São Tomé and Principe': 'São Tomé and Príncipe',
  'Wallis and Futuna Is.': 'Wallis and Futuna',
  'Ashmore and Cartier Is.': 'Ashmore and Cartier Islands',
  'Indian Ocean Ter.': 'Australian Indian Ocean Territories',
  'Siachen Glacier': 'the Siachen Glacier',
};

/** Seas checked before the open oceans, first match wins: [name, west, south, east, north]. */
const SEAS: [string, number, number, number, number][] = [
  ['the Caspian Sea', 46, 36, 55, 47.5],
  ['the Black Sea', 27, 40.5, 42, 47.5],
  ['the Sea of Azov', 34.5, 45, 39.5, 47.5],
  ['the Mediterranean Sea', -6, 30, 37, 46],
  ['the Red Sea', 32, 12.5, 44, 30],
  ['the Gulf of Aden', 43, 10, 52, 15.5],
  ['the Persian Gulf', 47, 23, 57, 31],
  ['the Arabian Sea', 50, 5, 77, 26],
  ['the Andaman Sea', 92, 5, 99, 17],
  ['the Bay of Bengal', 78, 5, 95, 23],
  ['the South China Sea', 99, 0, 121, 23],
  ['the Java Sea', 105, -8, 120, -3],
  ['the Banda Sea', 120, -8, 133, -3],
  ['the Timor Sea', 120, -15, 130, -8],
  ['the Arafura Sea', 130, -14, 142, -8],
  ['the Coral Sea', 145, -30, 165, -9],
  ['the Tasman Sea', 147, -47, 175, -30],
  ['the Philippine Sea', 121, 5, 145, 33],
  ['the East China Sea', 117, 23, 131, 33],
  ['the Yellow Sea', 117, 33, 127, 41],
  ['the Sea of Japan', 127, 33, 142, 52],
  ['the Sea of Okhotsk', 135, 43, 163, 62],
  ['the Bering Sea', 162, 51, 203, 66],
  ['the Gulf of Alaska', -160, 50, -130, 61],
  ['the Gulf of California', -115, 22, -106, 32],
  ['the Gulf of Mexico', -98, 18, -81, 31],
  ['the Caribbean Sea', -88, 9, -60, 22],
  ['Hudson Bay', -95, 51, -77, 66],
  ['Baffin Bay', -80, 66, -50, 78],
  ['the Labrador Sea', -64, 53, -45, 66],
  ['the Gulf of Saint Lawrence', -67, 45, -56, 52],
  ['the North Sea', -4, 51, 9, 61],
  ['the Baltic Sea', 9, 53, 31, 66],
  ['the Norwegian Sea', -10, 61, 15, 72],
  ['the Barents Sea', 15, 67, 60, 82],
  ['the Gulf of Guinea', -10, -5, 10, 6],
  ['the Mozambique Channel', 33, -26, 49, -11],
  ['the Great Australian Bight', 115, -40, 140, -31],
  ['the Weddell Sea', -62, -78, -15, -65],
  ['the Ross Sea', 160, -86, 210, -70],
];

const inBox = (lon: number, lat: number, [, w, s, e, n]: (typeof SEAS)[number]) => {
  if (lat < s || lat > n) return false;
  // Boxes may run past 180° east (the Bering and Ross seas).
  return (lon >= w && lon <= e) || (lon + 360 >= w && lon + 360 <= e);
};

function ocean(lon: number, lat: number): string {
  for (const box of SEAS) if (inBox(lon, lat, box)) return box[0];
  if (lat < -60) return 'the Southern Ocean';
  if (lat > 66) return 'the Arctic Ocean';
  if (lat < 0) {
    if (lon >= -68 && lon < 20) return 'the South Atlantic Ocean';
    if (lon >= 20 && lon < 147) return 'the Indian Ocean';
    return 'the South Pacific Ocean';
  }
  if (lon >= 20 && lon <= 100) return 'the Indian Ocean';
  // The Americas' Pacific coast, roughly: west of it is Pacific, east Atlantic.
  const coast = lat < 9 ? -77 : lat < 20 ? -88 : -100;
  if (lon > 100 || lon < coast) return 'the North Pacific Ocean';
  return 'the North Atlantic Ocean';
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

/** Scanline fill of one country's rings (even-odd) into the grid. */
function fill(grid: Uint16Array, rings: Ring[], id: number) {
  // world-atlas joins some rings across the antimeridian; unwrap each so its longitudes run on.
  const unwrapped = rings.map((r) => {
    const out: Ring = [];
    let prev = r[0][0];
    let shift = 0;
    for (const [lon, lat] of r) {
      if (lon - prev > 180) shift -= 360;
      else if (prev - lon > 180) shift += 360;
      prev = lon;
      out.push([lon + shift, lat]);
    }
    return out;
  });
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) / WHERE_RES;
    const xs: number[] = [];
    for (const r of unwrapped) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i];
        const [xj, yj] = r[j];
        if (yi > lat !== yj > lat) xs.push(((xj - xi) * (lat - yi)) / (yj - yi) + xi);
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.ceil((xs[k] + 180) * WHERE_RES - 0.5);
      const x1 = Math.floor((xs[k + 1] + 180) * WHERE_RES - 0.5);
      for (let x = x0; x <= x1; x++) grid[y * W + (((x % W) + W) % W)] = id;
    }
  }
}

/** Names, and rows of `index*run` pairs in base 36 (`,` between pairs, `/` between rows). */
export function whereGrid(): { names: string[]; rows: string } {
  const t = topo as unknown as Topology;
  const arcs = decodeArcs(t);
  const names: string[] = ['the open sea'];
  const index = new Map<string, number>();
  const id = (name: string) => {
    let i = index.get(name);
    if (i === undefined) {
      i = names.length;
      names.push(name);
      index.set(name, i);
    }
    return i;
  };
  const grid = new Uint16Array(W * H);
  for (const g of t.objects.countries.geometries) {
    const raw = g.properties?.name;
    if (!raw || !g.arcs) continue;
    fill(grid, ringsOf(g, arcs), id(FULL[raw] ?? raw));
  }
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) / WHERE_RES;
    for (let x = 0; x < W; x++) {
      if (grid[y * W + x]) continue;
      grid[y * W + x] = id(ocean((x + 0.5) / WHERE_RES - 180, lat));
    }
  }
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    const runs: string[] = [];
    let x = 0;
    while (x < W) {
      const v = grid[y * W + x];
      let n = 1;
      while (x + n < W && grid[y * W + x + n] === v) n++;
      runs.push(n === 1 ? v.toString(36) : `${v.toString(36)}*${n.toString(36)}`);
      x += n;
    }
    rows.push(runs.join(','));
  }
  return { names, rows: rows.join('/') };
}
