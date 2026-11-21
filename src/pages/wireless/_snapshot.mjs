// Builds _stations.json, the dial's printing: which cities go on the glass and which stations
// each one carries. Run by hand with `node src/pages/wireless/_snapshot.mjs` when the dial needs
// reprinting; the page itself only reads the JSON, and asks Radio Browser for a fresh stream
// address each time a station is tuned.
//
// For every candidate city (in priority order) it asks the Radio Browser directory for HTTPS
// stations from that country listed within 40 km or in a region named for the city; a country's
// first city with too few of those also takes the country's most played stations. Then it opens
// each stream just long enough to read its headers: it must answer 200 with an audio type, and
// stations that send CORS headers (so the set can run them through its own valve tone) are kept
// first. A city goes on the dial if it has at least one working station, none already used by
// another city, and sits far enough from the cities already placed.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://de1.api.radio-browser.info';
const AGENT = 'thesandbox.page-wireless/1.0';
const OUT = fileURLToPath(new URL('./_stations.json', import.meta.url));
/** Closest two cities may sit on the glass, in degrees of longitude. */
const MIN_GAP = 2.2;
const PER_CITY = 3;
const CANDIDATES_PER_CITY = 10;

// name | ISO country | latitude | longitude | IANA zone, most wanted first.
const CANDIDATES = `
London|GB|51.507|-0.128|Europe/London
New York|US|40.713|-74.006|America/New_York
Tokyo|JP|35.690|139.692|Asia/Tokyo
Paris|FR|48.857|2.352|Europe/Paris
Rio de Janeiro|BR|-22.907|-43.173|America/Sao_Paulo
Cairo|EG|30.044|31.236|Africa/Cairo
Mumbai|IN|19.076|72.878|Asia/Kolkata
Sydney|AU|-33.869|151.209|Australia/Sydney
Mexico City|MX|19.433|-99.133|America/Mexico_City
Moscow|RU|55.756|37.617|Europe/Moscow
Lagos|NG|6.524|3.379|Africa/Lagos
Buenos Aires|AR|-34.604|-58.382|America/Argentina/Buenos_Aires
Reykjavík|IS|64.147|-21.942|Atlantic/Reykjavik
Honolulu|US|21.307|-157.858|Pacific/Honolulu
Los Angeles|US|34.052|-118.244|America/Los_Angeles
Anchorage|US|61.218|-149.900|America/Anchorage
Chicago|US|41.878|-87.630|America/Chicago
Havana|CU|23.113|-82.366|America/Havana
Lima|PE|-12.046|-77.043|America/Lima
Bogotá|CO|4.711|-74.072|America/Bogota
Dakar|SN|14.716|-17.467|Africa/Dakar
Lisbon|PT|38.722|-9.139|Europe/Lisbon
Berlin|DE|52.520|13.405|Europe/Berlin
Athens|GR|37.984|23.728|Europe/Athens
Nairobi|KE|-1.292|36.822|Africa/Nairobi
Johannesburg|ZA|-26.204|28.047|Africa/Johannesburg
Tehran|IR|35.689|51.389|Asia/Tehran
Bangkok|TH|13.756|100.502|Asia/Bangkok
Hong Kong|HK|22.320|114.169|Asia/Hong_Kong
Seoul|KR|37.567|126.978|Asia/Seoul
Auckland|NZ|-36.848|174.763|Pacific/Auckland
Vancouver|CA|49.283|-123.121|America/Vancouver
Denver|US|39.739|-104.990|America/Denver
New Orleans|US|29.951|-90.072|America/Chicago
Montréal|CA|45.502|-73.567|America/Toronto
Madrid|ES|40.417|-3.704|Europe/Madrid
Amsterdam|NL|52.368|4.904|Europe/Amsterdam
Stockholm|SE|59.329|18.069|Europe/Stockholm
Istanbul|TR|41.008|28.978|Europe/Istanbul
Dubai|AE|25.205|55.271|Asia/Dubai
Karachi|PK|24.861|67.010|Asia/Karachi
Delhi|IN|28.614|77.209|Asia/Kolkata
Kathmandu|NP|27.717|85.324|Asia/Kathmandu
Dhaka|BD|23.811|90.413|Asia/Dhaka
Jakarta|ID|-6.208|106.846|Asia/Jakarta
Manila|PH|14.600|120.984|Asia/Manila
Perth|AU|-31.952|115.861|Australia/Perth
Melbourne|AU|-37.814|144.963|Australia/Melbourne
Santiago|CL|-33.449|-70.669|America/Santiago
São Paulo|BR|-23.551|-46.633|America/Sao_Paulo
Addis Ababa|ET|9.030|38.740|Africa/Addis_Ababa
Accra|GH|5.604|-0.187|Africa/Accra
Dublin|IE|53.350|-6.260|Europe/Dublin
Copenhagen|DK|55.676|12.568|Europe/Copenhagen
Vienna|AT|48.208|16.373|Europe/Vienna
Warsaw|PL|52.230|21.012|Europe/Warsaw
Helsinki|FI|60.170|24.938|Europe/Helsinki
Kyiv|UA|50.450|30.523|Europe/Kyiv
Tbilisi|GE|41.716|44.783|Asia/Tbilisi
Tashkent|UZ|41.300|69.240|Asia/Tashkent
Almaty|KZ|43.238|76.946|Asia/Almaty
Ulaanbaatar|MN|47.886|106.906|Asia/Ulaanbaatar
Singapore|SG|1.352|103.820|Asia/Singapore
Taipei|TW|25.033|121.565|Asia/Taipei
Osaka|JP|34.694|135.502|Asia/Tokyo
Brisbane|AU|-27.470|153.025|Australia/Brisbane
Adelaide|AU|-34.929|138.601|Australia/Adelaide
Wellington|NZ|-41.286|174.776|Pacific/Auckland
Suva|FJ|-18.142|178.441|Pacific/Fiji
Papeete|PF|-17.535|-149.570|Pacific/Tahiti
San Francisco|US|37.775|-122.419|America/Los_Angeles
Seattle|US|47.606|-122.332|America/Los_Angeles
Phoenix|US|33.448|-112.074|America/Phoenix
Austin|US|30.267|-97.743|America/Chicago
Nashville|US|36.163|-86.781|America/Chicago
Atlanta|US|33.749|-84.388|America/New_York
Miami|US|25.762|-80.192|America/New_York
Boston|US|42.360|-71.059|America/New_York
Halifax|CA|44.649|-63.575|America/Halifax
St. John's|CA|47.561|-52.713|America/St_Johns
Nuuk|GL|64.181|-51.694|America/Nuuk
Recife|BR|-8.048|-34.877|America/Recife
Praia|CV|14.933|-23.513|Atlantic/Cape_Verde
Ponta Delgada|PT|37.741|-25.676|Atlantic/Azores
Las Palmas|ES|28.124|-15.436|Atlantic/Canary
Casablanca|MA|33.573|-7.590|Africa/Casablanca
Glasgow|GB|55.864|-4.252|Europe/London
Brussels|BE|50.850|4.352|Europe/Brussels
Zürich|CH|47.377|8.541|Europe/Zurich
Oslo|NO|59.914|10.752|Europe/Oslo
Budapest|HU|47.498|19.040|Europe/Budapest
Bucharest|RO|44.427|26.103|Europe/Bucharest
Minsk|BY|53.900|27.567|Europe/Minsk
Tel Aviv|IL|32.085|34.782|Asia/Jerusalem
Beirut|LB|33.894|35.502|Asia/Beirut
Riyadh|SA|24.713|46.675|Asia/Riyadh
Baku|AZ|40.409|49.867|Asia/Baku
Doha|QA|25.285|51.531|Asia/Qatar
Muscat|OM|23.588|58.383|Asia/Muscat
Kabul|AF|34.555|69.207|Asia/Kabul
Lahore|PK|31.520|74.359|Asia/Karachi
Bengaluru|IN|12.972|77.595|Asia/Kolkata
Chennai|IN|13.083|80.270|Asia/Kolkata
Colombo|LK|6.927|79.861|Asia/Colombo
Kolkata|IN|22.573|88.364|Asia/Kolkata
Yangon|MM|16.840|96.173|Asia/Yangon
Kuala Lumpur|MY|3.139|101.687|Asia/Kuala_Lumpur
Hanoi|VN|21.028|105.854|Asia/Ho_Chi_Minh
Ho Chi Minh City|VN|10.823|106.630|Asia/Ho_Chi_Minh
Chengdu|CN|30.573|104.066|Asia/Shanghai
Guangzhou|CN|23.129|113.264|Asia/Shanghai
Beijing|CN|39.904|116.407|Asia/Shanghai
Shanghai|CN|31.230|121.474|Asia/Shanghai
Busan|KR|35.180|129.076|Asia/Seoul
Vladivostok|RU|43.119|131.886|Asia/Vladivostok
Sapporo|JP|43.062|141.354|Asia/Tokyo
Darwin|AU|-12.463|130.846|Australia/Darwin
Hobart|AU|-42.882|147.327|Australia/Hobart
Port Moresby|PG|-9.443|147.180|Pacific/Port_Moresby
Nouméa|NC|-22.276|166.458|Pacific/Noumea
Christchurch|NZ|-43.532|172.637|Pacific/Auckland
Apia|WS|-13.834|-171.760|Pacific/Apia
Hilo|US|19.707|-155.082|Pacific/Honolulu
Juneau|US|58.302|-134.420|America/Juneau
Whitehorse|CA|60.721|-135.057|America/Whitehorse
Calgary|CA|51.045|-114.072|America/Edmonton
Salt Lake City|US|40.761|-111.891|America/Denver
Winnipeg|CA|49.895|-97.138|America/Winnipeg
Minneapolis|US|44.978|-93.265|America/Chicago
Detroit|US|42.331|-83.046|America/Detroit
Toronto|CA|43.653|-79.383|America/Toronto
Kingston|JM|17.971|-76.793|America/Jamaica
Panama City|PA|8.983|-79.517|America/Panama
Quito|EC|-0.181|-78.468|America/Guayaquil
Guatemala City|GT|14.634|-90.507|America/Guatemala
San José|CR|9.928|-84.091|America/Costa_Rica
Santo Domingo|DO|18.486|-69.931|America/Santo_Domingo
San Juan|PR|18.466|-66.106|America/Puerto_Rico
Caracas|VE|10.481|-66.904|America/Caracas
Port of Spain|TT|10.660|-61.508|America/Port_of_Spain
La Paz|BO|-16.490|-68.119|America/La_Paz
Montevideo|UY|-34.901|-56.165|America/Montevideo
Asunción|PY|-25.264|-57.576|America/Asuncion
Salvador|BR|-12.977|-38.501|America/Bahia
Belém|BR|-1.456|-48.490|America/Belem
Cayenne|GF|4.922|-52.313|America/Cayenne
Edinburgh|GB|55.953|-3.188|Europe/London
Cork|IE|51.899|-8.476|Europe/Dublin
Tórshavn|FO|62.009|-6.772|Atlantic/Faroe
Bergen|NO|60.391|5.322|Europe/Oslo
Tromsø|NO|69.649|18.956|Europe/Oslo
Riga|LV|56.950|24.105|Europe/Riga
Sofia|BG|42.698|23.322|Europe/Sofia
Belgrade|RS|44.787|20.457|Europe/Belgrade
Zagreb|HR|45.815|15.982|Europe/Zagreb
Prague|CZ|50.076|14.438|Europe/Prague
Munich|DE|48.135|11.582|Europe/Berlin
Milan|IT|45.464|9.190|Europe/Rome
Rome|IT|41.903|12.496|Europe/Rome
Barcelona|ES|41.385|2.173|Europe/Madrid
Marseille|FR|43.296|5.370|Europe/Paris
Valletta|MT|35.899|14.514|Europe/Malta
Tunis|TN|36.806|10.181|Africa/Tunis
Algiers|DZ|36.754|3.059|Africa/Algiers
Abidjan|CI|5.360|-4.008|Africa/Abidjan
Bamako|ML|12.639|-8.003|Africa/Bamako
Kinshasa|CD|-4.441|15.266|Africa/Kinshasa
Luanda|AO|-8.839|13.289|Africa/Luanda
Kampala|UG|0.347|32.582|Africa/Kampala
Dar es Salaam|TZ|-6.792|39.208|Africa/Dar_es_Salaam
Antananarivo|MG|-18.879|47.508|Indian/Antananarivo
Port Louis|MU|-20.161|57.501|Indian/Mauritius
Cape Town|ZA|-33.925|18.424|Africa/Johannesburg
Durban|ZA|-29.858|31.022|Africa/Johannesburg
Windhoek|NA|-22.560|17.066|Africa/Windhoek
Harare|ZW|-17.825|31.034|Africa/Harare
Amman|JO|31.954|35.911|Asia/Amman
Yerevan|AM|40.179|44.499|Asia/Yerevan
St Petersburg|RU|59.931|30.361|Europe/Moscow
Novosibirsk|RU|55.008|82.935|Asia/Novosibirsk
Yekaterinburg|RU|56.838|60.597|Asia/Yekaterinburg
Irkutsk|RU|52.287|104.305|Asia/Irkutsk
Bishkek|KG|42.875|74.570|Asia/Bishkek
Thimphu|BT|27.472|89.639|Asia/Thimphu
Phnom Penh|KH|11.556|104.928|Asia/Phnom_Penh
Cebu|PH|10.316|123.885|Asia/Manila
Okinawa|JP|26.212|127.681|Asia/Tokyo
Guam|GU|13.444|144.794|Pacific/Guam
Cairns|AU|-16.920|145.771|Australia/Brisbane
`
  .trim()
  .split('\n')
  .map((line) => {
    const [name, cc, lat, lon, tz] = line.split('|');
    return { name, cc, lat: +lat, lon: +lon, tz };
  });

const GOOD_CODECS = new Set(['MP3', 'AAC', 'AAC+', 'OGG']);
const BLOCK = /\b(xxx|sex|porn|erot|hentai|adult|nsfw|18\+)/i;
// Cable news simulcasts and partisan or factional outlets: the dial is for a city's own radio.
const OFF_DIAL = /\b(msnbc|fox news|cnn|newsmax|sky news|mojahed|republika|sputnik|rt news|infowars)\b/i;
const FORMAT = /\b(mp3|aac\+?|he-aac|ogg|opus|flac|\d+\s?k(bps|b\/s)?|hq|lq|hd|low|high|stream|mobile)\b/gi;

/** A station's name as printed: no stream formats, bitrates, or stray separators. */
function cleanName(name) {
  return name
    .replace(/\(([^)]*)\)/g, (m, inner) => (inner.replace(FORMAT, '').replace(/[\s,/|-]/g, '') === '' ? '' : m))
    .split('|')
    .filter((part, i) => i === 0 || part.replace(FORMAT, '').replace(/[\s,/-]/g, '') !== '')
    .join('|')
    .replace(/\s*[-–|]\s*powered by.*$/i, '')
    .replace(new RegExp(`(\\s*[-–|:]?\\s*${FORMAT.source})+\\s*$`, 'i'), '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–|:.#_]+|[\s\-–|:.]+$/g, '')
    .trim()
    .slice(0, 80)
    .trim();
}

/** Two listings of one programme (an MP3 and an AAC feed) share this key. */
function sameKey(name) {
  return cleanName(name)
    .toLowerCase()
    .replace(FORMAT, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function cleanTags(tags) {
  return tags
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => /^[a-z][a-z &'-]{1,15}$/.test(t))
    .slice(0, 2);
}

function lonGap(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(20000) });
      if (res.ok) return await res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return [];
}

/** Open the stream, read its headers, and hang up. */
async function probe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': AGENT, Origin: 'https://thesandbox.page', 'Icy-MetaData': '0' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const acao = res.headers.get('access-control-allow-origin');
    const finalUrl = res.url;
    ctrl.abort();
    const audio = /audio\/|application\/ogg/.test(type) && !/mpegurl|x-scpls/.test(type);
    return {
      ok: res.status === 200 && audio && finalUrl.startsWith('https:'),
      cors: acao === '*' || acao === 'https://thesandbox.page',
    };
  } catch {
    return { ok: false, cors: false };
  } finally {
    clearTimeout(timer);
  }
}

function usable(list) {
  return list
    .filter((s) => !s.hls && GOOD_CODECS.has(s.codec) && s.bitrate >= 32 && s.lastcheckok === 1)
    .filter((s) => s.url_resolved.startsWith('https://') && !/\.m3u8|\.pls|\.m3u(\?|$)/i.test(s.url_resolved))
    .filter((s) => !BLOCK.test(`${s.name} ${s.tags}`) && !OFF_DIAL.test(s.name))
    .filter((s) => sameKey(s.name).length >= 2);
}

const common = { is_https: 'true', hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: '60' };

/** Stations listed within 40 km of the city, then any whose region names it. */
async function localListings(city) {
  const near = new URLSearchParams({
    ...common,
    geo_lat: String(city.lat),
    geo_long: String(city.lon),
    geo_distance: '40000',
    countrycode: city.cc,
  });
  const named = new URLSearchParams({ ...common, countrycode: city.cc, state: city.name });
  const a = await getJson(`${API}/json/stations/search?${near}`);
  const b = await getJson(`${API}/json/stations/search?${named}`);
  return usable([...a, ...b]);
}

/** The country's most played stations, for a city with nothing listed nearby. */
const national = new Map();
async function nationalListings(cc) {
  if (!national.has(cc)) {
    const q = new URLSearchParams({ ...common, countrycode: cc });
    national.set(cc, usable(await getJson(`${API}/json/stations/search?${q}`)));
  }
  return national.get(cc);
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function main() {
  const local = await pool(CANDIDATES, 6, (city) => localListings(city));
  const usedIds = new Set();
  const usedKeys = new Set();
  const placed = [];

  for (const [i, city] of CANDIDATES.entries()) {
    if (placed.some((p) => lonGap(p.lon, city.lon) < MIN_GAP)) continue;
    let list = local[i];
    let source = 'local';
    const fresh = (s) => !usedIds.has(s.stationuuid) && !usedKeys.has(sameKey(s.name));
    // Only a country's first city falls back to its national stations, which mostly broadcast from there.
    const lead = CANDIDATES.find((c) => c.cc === city.cc) === city;
    if (lead && list.filter(fresh).length < 2) {
      list = [...list, ...(await nationalListings(city.cc))];
      source = 'local+national';
    }
    const candidates = [];
    const seen = new Set();
    for (const s of list) {
      const key = sameKey(s.name);
      if (!fresh(s) || seen.has(key)) continue;
      seen.add(key);
      candidates.push(s);
      if (candidates.length >= CANDIDATES_PER_CITY) break;
    }
    const probes = await pool(candidates, 5, (s) => probe(s.url_resolved));
    const kept = candidates
      .map((s, rank) => ({ s, rank, p: probes[rank] }))
      .filter((k) => k.p.ok)
      .sort((a, b) => Number(b.p.cors) - Number(a.p.cors) || a.rank - b.rank)
      .slice(0, PER_CITY)
      .sort((a, b) => a.rank - b.rank);
    console.log(`${city.name}: ${kept.length} of ${candidates.length} (${source})`);
    if (!kept.length) continue;
    for (const { s } of kept) {
      usedIds.add(s.stationuuid);
      usedKeys.add(sameKey(s.name));
    }
    placed.push({
      ...city,
      stations: kept.map(({ s, p }) => ({
        id: s.stationuuid,
        name: cleanName(s.name),
        url: s.url_resolved,
        tags: cleanTags(s.tags),
        cors: p.cors,
      })),
    });
  }

  placed.sort((a, b) => a.lon - b.lon);
  const out = {
    printed: new Date().toISOString().slice(0, 10),
    cities: placed.map((c) => ({ name: c.name, cc: c.cc, lat: c.lat, lon: c.lon, tz: c.tz, stations: c.stations })),
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  const n = placed.reduce((t, c) => t + c.stations.length, 0);
  const cors = placed.reduce((t, c) => t + c.stations.filter((s) => s.cors).length, 0);
  console.log(`\n${placed.length} cities, ${n} stations (${cors} with CORS) -> ${OUT}`);
}

main();
