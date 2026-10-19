// Merges NGA List of Lights JSON (volumes 110 to 116) and USCG Light List rows
// (read from the PDFs by uscg.py) into one compact snapshot.
//
// usage: node merge.mjs <nga-dir> <uscg.json> <out.tsv>

import fs from 'node:fs';

const [ngaDir, uscgPath, outPath] = process.argv.slice(2);

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

function ngaPosition(p) {
  const m = [...p.matchAll(/(\d+)°(\d+)'([\d.]+)"([NSEW])/g)];
  if (m.length !== 2) return null;
  const v = (g) => (Number(g[1]) + Number(g[2]) / 60 + Number(g[3]) / 3600) * (g[4] === 'S' || g[4] === 'W' ? -1 : 1);
  return [v(m[0]), v(m[1])];
}

// RACONs and RAMARKs are radar beacons: Morse letters drawn as dashes and dots.
const isRadar = (r) => /RACON|RAMARK/i.test(r.name ?? '') || /^[A-Z]{1,2} ?\([-•\s]+\)/.test(clean(r.characteristic));

const lights = [];
let radar = 0;
for (const vol of [110, 111, 112, 113, 114, 115, 116]) {
  const rows = JSON.parse(fs.readFileSync(`${ngaDir}/nga-${vol}.json`, 'utf8')).ngalol;
  let principal = '';
  for (const r of rows) {
    if (isRadar(r)) {
      radar++;
      continue;
    }
    // A leading dash stands for the principal name above it.
    let name = clean(r.name).replace(/\.$/, '');
    if (!name.startsWith('-')) principal = name.split(',')[0];
    else name = principal ? `${principal}, ${name.replace(/^-+\s*/, '')}` : name.replace(/^-+\s*/, '');
    const pos = ngaPosition(r.position ?? '');
    if (!pos) continue;
    const char = (r.characteristic ?? '')
      .split('\n')
      .map((l) => clean(l))
      .filter(Boolean)
      .join('; ');
    if (!char) continue;
    const hm = (r.heightFeetMeters ?? '').split('\n').map(clean);
    lights.push({
      src: 'nga',
      ref: `${vol}-${clean(r.featureNumber).split(' ')[0]}`,
      name,
      region: clean(r.geopoliticalHeading),
      lat: pos[0],
      lon: pos[1],
      char,
      height: hm[1] ? Number(hm[1]) : null,
      range: clean(r.range),
      structure: clean(r.structure).replace(/;\s*\d+\.?$/, ''),
      remarks: clean(r.remarks),
    });
  }
}
const ngaCount = lights.length;

// USCG lists every lighted buoy; NGA lists only the major and outermost ones.
// Keep USCG buoys that mark an approach, an entrance, or safe water, so both
// lists follow the same rule.
const outer = /approach|entrance|sea buoy|separation|fairway|offshore|outer/i;
const uscg = JSON.parse(fs.readFileSync(uscgPath, 'utf8'));
let skipped = 0;
const usLights = [];
for (const r of uscg) {
  const char = clean(r.char);
  if (/buoy/i.test(r.name) && !(/Mo ?\(A\)/.test(char) || outer.test(r.name))) {
    skipped++;
    continue;
  }
  const ft = Number(r.height);
  usLights.push({
    src: 'uscg',
    ref: `${r.vol}-${r.n}`,
    name: clean(r.name),
    region: 'UNITED STATES',
    lat: r.lat,
    lon: r.lon,
    char,
    height: Number.isFinite(ft) && r.height !== '' ? Math.round(ft * 0.3048) : null,
    range: clean(r.range),
    structure: clean(r.structure),
    remarks: clean(r.remarks),
  });
}

// Where the lists overlap (east Florida, Puerto Rico, the Great Lakes, Hawaii),
// keep the USCG row: its positions are given to a thousandth of a second.
const cell = (lat, lon) => `${Math.round(lat * 200)},${Math.round(lon * 200)}`;
const grid = new Map();
for (const l of usLights) {
  const k = cell(l.lat, l.lon);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(l);
}
const metres = (a, b) => {
  const dy = (a.lat - b.lat) * 111320;
  const dx = (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
};
let dupes = 0;
const kept = lights.filter((l) => {
  const la = Math.round(l.lat * 200);
  const lo = Math.round(l.lon * 200);
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      for (const u of grid.get(`${la + i},${lo + j}`) ?? []) {
        if (metres(l, u) < 150) {
          dupes++;
          return false;
        }
      }
    }
  return true;
});

const all = [...kept, ...usLights];
const fields = ['src', 'ref', 'name', 'region', 'lat', 'lon', 'char', 'height', 'range', 'structure', 'remarks'];
const cellText = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
const rows = all.map((l) =>
  fields.map((f) => cellText(f === 'lat' || f === 'lon' ? Math.round(l[f] * 1e6) / 1e6 : l[f])).join('\t'),
);
fs.writeFileSync(outPath, [fields.join('\t'), ...rows].join('\n') + '\n');
console.log({ nga: ngaCount, radar, uscg: usLights.length, uscgBuoysSkipped: skipped, dupes, total: all.length });
