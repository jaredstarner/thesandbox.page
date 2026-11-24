// Builds _data/<id>.json, the snapshot of each town on the opening page, so those towns open at
// once and keep working when OpenStreetMap's servers are busy. Run by hand with
// `node src/pages/obvious-exits/_snapshot.mjs [id ...]` when a town needs a fresh survey; with no
// ids it surveys every town in _places.ts. The page sends the same query live for anywhere else.
//
// Map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compact, overpassQuery, pack } from './_overpass.mjs';

const API = 'https://overpass-api.de/api/interpreter';
const AGENT = 'thesandbox.page-obvious-exits/1.0';
const DIR = fileURLToPath(new URL('./_data/', import.meta.url));

// _places.ts is TypeScript; read the few fields needed straight out of its source.
const source = readFileSync(fileURLToPath(new URL('./_places.ts', import.meta.url)), 'utf8');
const radius = Number(/RADIUS = (\d+)/.exec(source)?.[1] ?? 550);
const places = [...source.matchAll(/id: '([^']+)',[\s\S]*?lat: (-?[\d.]+),\s*lon: (-?[\d.]+),/g)].map((m) => ({
  id: m[1],
  lat: Number(m[2]),
  lon: Number(m[3]),
}));

const wanted = process.argv.slice(2);
const todo = wanted.length ? places.filter((p) => wanted.includes(p.id)) : places;
mkdirSync(DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function survey(place) {
  const body = new URLSearchParams({ data: overpassQuery(place.lat, place.lon, radius) });
  for (let attempt = 1; attempt <= 6; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'User-Agent': AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(120000),
      });
      if (res.ok) {
        const raw = await res.json();
        console.log(`${place.id}: ${raw.elements.length} elements in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        return raw;
      }
      console.log(`${place.id}: HTTP ${res.status} on attempt ${attempt}`);
    } catch (err) {
      console.log(`${place.id}: ${err.name} on attempt ${attempt}`);
    }
    await sleep(15000 * attempt);
  }
  throw new Error(`${place.id}: no answer after six attempts`);
}

for (const place of todo) {
  const raw = await survey(place);
  const town = compact(raw, place.lat, place.lon, radius);
  const json = JSON.stringify(pack(town));
  writeFileSync(`${DIR}${place.id}.json`, json + '\n');
  console.log(`${place.id}: ${town.w.length} ways, ${town.p.length} places, ${(json.length / 1024).toFixed(0)} KB`);
  await sleep(5000);
}
