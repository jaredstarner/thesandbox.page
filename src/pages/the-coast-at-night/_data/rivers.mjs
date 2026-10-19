// Natural Earth's river centerlines, kept only where the river is lit: a
// river stays when at least three lights stand within 1.5 km of its line.
// One line per polyline, points "lon,lat" parted by spaces.
//
// usage: node rivers.mjs <ne_10m_rivers_lake_centerlines.geojson> <lights.tsv> <rivers.tsv>

import fs from 'node:fs';

const [src, lightsPath, out] = process.argv.slice(2);
const NEAR_KM = 1.5;
const MIN_LIGHTS = 3;
const CELL = 0.05;

const grid = new Map();
const rows = fs.readFileSync(lightsPath, 'utf8').split('\n').slice(1).filter(Boolean);
rows.forEach((row, i) => {
  const cols = row.split('\t');
  const lat = Number(cols[4]);
  const lon = Number(cols[5]);
  const k = `${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push([i, lat, lon]);
});

const km = (lat1, lon1, lat2, lon2) => {
  const dy = (lat2 - lat1) * 111.32;
  const dx = (lon2 - lon1) * 111.32 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dx, dy);
};

/** Lights within NEAR_KM of a polyline, sampled about every 500 m. */
function lightsNear(line) {
  const seen = new Set();
  for (let s = 1; s < line.length; s++) {
    const [lon0, lat0] = line[s - 1];
    const [lon1, lat1] = line[s];
    const steps = Math.max(1, Math.ceil(km(lat0, lon0, lat1, lon1) / 0.5));
    for (let t = 0; t <= steps; t++) {
      const lat = lat0 + ((lat1 - lat0) * t) / steps;
      const lon = lon0 + ((lon1 - lon0) * t) / steps;
      const ci = Math.floor(lat / CELL);
      const cj = Math.floor(lon / CELL);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const [i, la, lo] of grid.get(`${ci + a},${cj + b}`) ?? []) {
            if (!seen.has(i) && km(lat, lon, la, lo) < NEAR_KM) seen.add(i);
          }
    }
  }
  return seen.size;
}

const g = JSON.parse(fs.readFileSync(src, 'utf8'));
const lines = [];
const names = new Set();
for (const f of g.features) {
  if (!f.geometry || f.properties.featurecla !== 'River') continue;
  const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  if (parts.reduce((n, p) => n + lightsNear(p), 0) < MIN_LIGHTS) continue;
  names.add(f.properties.name);
  for (const p of parts) lines.push(p.map(([lon, lat]) => `${lon.toFixed(4)},${lat.toFixed(4)}`).join(' '));
}
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log({ rivers: names.size, lines: lines.length, names: [...names].filter(Boolean).sort().join(', ') });
