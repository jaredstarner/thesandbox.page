// What /obvious-exits/ asks OpenStreetMap for, and how the answer is cut down to what the story uses.
// Plain JavaScript so the page and the snapshot script (_snapshot.mjs, run with Node) share one copy.

/**
 * A town cut down to what the story reads. Coordinates are whole steps of 1e-5 degrees from the
 * centre, about a metre, which keeps the snapshots small.
 * @typedef {Record<string, string>} Tags
 * @typedef {{ v: 1, c: [number, number], r: number, n: number[], w: [number[], Tags][], p: [number, number, Tags][] }} Compact
 */

/** Keys the story reads; everything else in a tag list is dropped. */
const KEEP = new Set([
  'name',
  'name:en',
  'highway',
  'footway',
  'service',
  'access',
  'foot',
  'bridge',
  'bridge:name',
  'tunnel',
  'surface',
  'lit',
  'area',
  'indoor',
  'layer',
  'covered',
  'incline',
  'step_count',
  'amenity',
  'shop',
  'tourism',
  'historic',
  'leisure',
  'craft',
  'office',
  'healthcare',
  'cuisine',
  'religion',
  'denomination',
  'waterway',
  'natural',
  'landuse',
  'place',
  'building',
  'man_made',
  'memorial',
  'artwork_type',
  'railway',
  'station',
  'atm',
  'opening_hours',
  'tower:type',
  'height',
]);

/** Highway values that might carry someone on foot. */
const WALK =
  'primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|pedestrian|footway|path|steps|service|track|cycleway|bridleway|road';

const POI_KEYS = 'amenity|shop|tourism|historic|leisure|craft|office|healthcare|railway|man_made';

/**
 * The Overpass query for everything within `r` metres of a point.
 * @param {number} lat
 * @param {number} lon
 * @param {number} r
 */
export function overpassQuery(lat, lon, r) {
  const at = `(around:${r},${lat.toFixed(5)},${lon.toFixed(5)})`;
  return `[out:json][timeout:90];
(
  way${at}[highway~"^(${WALK})$"];
  way${at}[waterway~"^(river|canal|stream)$"];
  way${at}[leisure~"^(park|garden|playground|nature_reserve)$"];
  way${at}[landuse~"^(cemetery|grass|recreation_ground|allotments)$"];
  way${at}[amenity=grave_yard];
  way${at}[natural~"^(water|wood)$"];
  way${at}[place=square];
)->.g;
(
  node${at}[name][~"^(${POI_KEYS})$"~"."];
  node${at}[amenity~"^(post_box|atm|post_office|fountain|drinking_water|telephone|clock|bench)$"];
  node${at}[shop];
)->.pn;
way${at}[name][~"^(${POI_KEYS})$"~"."]->.pw;
.g out body geom qt;
.pn out body qt;
.pw out tags center qt;`;
}

/** @param {Record<string, string> | undefined} tags @returns {Tags} */
function trim(tags) {
  /** @type {Tags} */
  const out = {};
  if (!tags) return out;
  for (const k in tags) if (KEEP.has(k)) out[k] = tags[k];
  return out;
}

/**
 * Cut an Overpass answer down to a Compact town.
 * @param {{ elements: any[] }} raw
 * @param {number} lat
 * @param {number} lon
 * @param {number} r
 * @returns {Compact}
 */
export function compact(raw, lat, lon, r) {
  /** @type {Map<number, number>} */
  const index = new Map();
  /** @type {number[]} */
  const n = [];
  /** @type {[number[], Tags][]} */
  const w = [];
  /** @type {[number, number, Tags][]} */
  const p = [];
  const step = (/** @type {number} */ v, /** @type {number} */ o) => Math.round((v - o) * 1e5);
  for (const e of raw.elements) {
    if (e.type === 'way' && Array.isArray(e.geometry) && Array.isArray(e.nodes)) {
      /** @type {number[]} */
      const ids = [];
      for (let i = 0; i < e.nodes.length; i++) {
        const g = e.geometry[i];
        if (!g) continue;
        let k = index.get(e.nodes[i]);
        if (k === undefined) {
          k = n.length / 2;
          index.set(e.nodes[i], k);
          n.push(step(g.lat, lat), step(g.lon, lon));
        }
        ids.push(k);
      }
      if (ids.length > 1) w.push([ids, trim(e.tags)]);
    } else {
      const at = e.type === 'node' ? e : e.center;
      if (!at || typeof at.lat !== 'number') continue;
      const t = trim(e.tags);
      if (Object.keys(t).length) p.push([step(at.lat, lat), step(at.lon, lon), t]);
    }
  }
  return { v: 1, c: [lat, lon], r, n, w, p };
}
