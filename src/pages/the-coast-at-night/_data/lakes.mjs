// Natural Earth's lakes, which its land polygons do not cut out, as one
// polygon per line: rings parted by ";", points "lon,lat" parted by spaces.
//
// usage: node lakes.mjs <ne_50m_lakes.geojson> <lakes-50m.tsv> [max scale rank]

import fs from 'node:fs';

const [src, out, maxRank = '99'] = process.argv.slice(2);
const g = JSON.parse(fs.readFileSync(src, 'utf8'));
const lines = [];
for (const f of g.features) {
  if (f.properties.scalerank > Number(maxRank)) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const p of polys) {
    lines.push(p.map((ring) => ring.map(([lon, lat]) => `${lon.toFixed(4)},${lat.toFixed(4)}`).join(' ')).join(';'));
  }
}
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log({ features: g.features.length, polygons: lines.length });
