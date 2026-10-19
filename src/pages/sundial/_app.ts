// /sundial/: lays out a horizontal dial for a place, lights its engraving from
// the sun's real position, casts the gnomon's shadow, and keeps a print sheet
// in step with it.

import { R, gnomonShadow, layout, nodusShadow, reading, type Dial, type Place } from './_dial';
import { dms, face } from './_draw';
import { MOTTOS } from './_mottos';
import { sheet, svgFile } from './_print';
import { RAD, halfDay, season, sunAt, sunVector } from './_sun';
import { clockOffset, guessPlace, instantOf, placeIn, wallOf, zoneLabel } from './_zones';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const STORE = 'sundial.v1';
const SEARCH = 'https://geocoding-api.open-meteo.com/v1/search';

interface Saved {
  place?: Place;
  motto?: string;
}

function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* private window: nothing kept */
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
function hm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function zoneCity(zone: string | null): string | null {
  if (!zone) return null;
  const last = zone.split('/').pop() ?? '';
  return last.replace(/_/g, ' ') + ' time';
}

export function start(root: HTMLElement): void {
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const faceEl = $<SVGGElement>('[data-face]');
  const light = $<SVGElement>('[data-light]');
  const lamp = $<SVGElement>('[data-lamp]');
  const shadowEl = $<SVGPathElement>('[data-shadow]');
  const shadowGroup = $<SVGGElement>('[data-shadow-group]');
  const sides = [...root.querySelectorAll<SVGRectElement>('[data-side]')];
  const tint = $<SVGCircleElement>('[data-tint]');
  const sunmark = $<SVGCircleElement>('[data-sunmark]');
  const compass = $<SVGGElement>('[data-compass]');
  const ground = $<HTMLElement>('[data-ground]');
  const bead = $<SVGCircleElement>('[data-bead]');
  const beadShadow = $<SVGCircleElement>('[data-bead-shadow]');
  const big = $<HTMLElement>('[data-big]');
  const sub = $<HTMLElement>('[data-sub]');
  const sum = $<HTMLElement>('[data-sum]');
  const dayInput = $<HTMLInputElement>('[data-day]');
  const timeInput = $<HTMLInputElement>('[data-time]');
  const dayLabel = $<HTMLElement>('[data-day-label]');
  const timeLabel = $<HTMLElement>('[data-time-label]');
  const nowBtn = $<HTMLButtonElement>('[data-now]');
  const playBtn = $<HTMLButtonElement>('[data-play]');
  const search = $<HTMLInputElement>('[data-search]');
  const results = $<HTMLUListElement>('[data-results]');
  const map = $<HTMLCanvasElement>('[data-map]');
  const whereNote = $<HTMLElement>('[data-where-note]');
  const locate = $<HTMLButtonElement>('[data-locate]');
  const zoneEl = $<HTMLElement>('[data-zone]');
  const mottoSel = $<HTMLSelectElement>('[data-motto]');
  const printBtn = $<HTMLButtonElement>('[data-print]');
  const svgLink = $<HTMLAnchorElement>('[data-svg]');
  const sheetEl = $<HTMLElement>('[data-sheet]');

  const params = new URLSearchParams(location.search);
  const saved = load();
  const thisYear = new Date().getUTCFullYear();

  let place: Place = saved.place ?? guessPlace(thisYear);
  const qLat = Number(params.get('lat'));
  const qLon = Number(params.get('lon'));
  if (params.has('lat') && params.has('lon') && Math.abs(qLat) <= 90 && Math.abs(qLon) <= 180) {
    place = placeIn(params.get('name') ?? '', qLat, qLon, params.get('tz'), thisYear);
  }
  let motto = params.get('motto') ?? saved.motto ?? '0';
  if (motto !== 'none' && !MOTTOS[Number(motto)]) motto = '0';
  mottoSel.value = motto;

  const at = params.get('at');
  let ms = at ? (Number.isFinite(Number(at)) ? Number(at) : Date.parse(at)) : Date.now();
  if (!Number.isFinite(ms)) ms = Date.now();
  let live = !at;
  let dial: Dial = layout(place, thisYear);
  let svgUrl = '';

  // ---- The face and everything that depends only on the place ----

  function mottoText(): string {
    return motto === 'none' ? '' : (MOTTOS[Number(motto)]?.latin ?? '');
  }

  function drawFace(): void {
    const year = wallOf(place, ms).y;
    dial = layout(place, year);
    faceEl.innerHTML = face(dial, { motto: mottoText(), year, id: 'sd' });
    // The gnomon seen from above: a bronze plate from the root to its foot, lit on the sun's side.
    const foot = dial.top.n * dial.k;
    const w = dial.width;
    const nodusY = -dial.tip.n * dial.k;
    bead.setAttribute('cy', nodusY.toFixed(2));
    bead.setAttribute('r', String(w * 1.15));
    sides[0].setAttribute('x', String(-w / 2));
    sides[1].setAttribute('x', '0');
    for (const s of sides) {
      s.setAttribute('y', String(-foot));
      s.setAttribute('width', String(w / 2));
      s.setAttribute('height', String(foot));
    }
    const up = dial.k > 0 ? ['N', 'E', 'S', 'W'] : ['S', 'W', 'N', 'E'];
    compass.innerHTML = up
      .map((c, i) => {
        const a = (i * 90 * Math.PI) / 180;
        const r = 96.6;
        const x = r * Math.sin(a);
        const y = -r * Math.cos(a);
        return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${i * 90} ${x.toFixed(2)} ${y.toFixed(2)})">${c}</text>`;
      })
      .join('');
    drawSheet();
    drawZone();
    lastLight = '';
  }

  function drawZone(): void {
    const name = place.zone ? zoneCity(place.zone) : null;
    zoneEl.textContent = `Clocks on ${zoneLabel(place)}${name ? `, ${name}` : ', from the longitude'}`;
    if (!place.zone) {
      for (const d of [-1, 1]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = d < 0 ? '−' : '+';
        b.setAttribute('aria-label', d < 0 ? 'Zone an hour earlier' : 'Zone an hour later');
        b.addEventListener('click', () => {
          place = { ...place, zoneLon: Math.max(-180, Math.min(180, place.zoneLon + 15 * d)) };
          keep();
          drawFace();
          update();
        });
        zoneEl.append(b);
      }
    }
    const lat = Math.abs(place.lat);
    whereNote.textContent =
      lat < 12
        ? 'This close to the equator a horizontal dial’s gnomon lies nearly flat and its hours crowd toward noon; dials here are usually upright or equatorial.'
        : lat > 66.5
          ? 'Inside the polar circle the summer sun never sets, so this dial has all twenty-four hours, and in winter it has none.'
          : `${place.name ? place.name + ', ' : ''}${dms(place.lat, 'N', 'S')}, ${dms(place.lon, 'E', 'W')}`;
  }

  function drawSheet(): void {
    const year = wallOf(place, ms).y;
    const day = wallOf(place, ms);
    const { eot } = season(ms);
    const dst = clockOffset(place, ms) - place.zoneLon * 4;
    const noon = 720 - (place.lon - place.zoneLon) * 4 - eot + dst;
    sheetEl.innerHTML = sheet(dial, mottoText(), year, {
      noon: hm(noon),
      dayLabel: `${day.d} ${MONTHS[day.mo]}`,
      zoneName: place.zone ? zoneCity(place.zone) : null,
    });
    if (svgUrl) URL.revokeObjectURL(svgUrl);
    svgUrl = URL.createObjectURL(new Blob([svgFile(dial, mottoText(), year)], { type: 'image/svg+xml' }));
    svgLink.href = svgUrl;
    const slug = (place.name || `${place.lat.toFixed(2)}_${place.lon.toFixed(2)}`)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-|-$/g, '');
    svgLink.download = `sundial-${slug || 'here'}.svg`;
  }

  function keep(): void {
    save({ place, motto });
  }

  // ---- The sun ----

  let lastLight = '';

  function update(): void {
    const sun = sunAt(ms, place.lat, place.lon);
    const wall = wallOf(place, ms);
    const k = dial.k;
    const sx = k * sun.dir.e;
    const sy = k * sun.dir.n;

    // Light on the cut lines: from the sun by day, a cool sky glow by night.
    const day = sun.alt > -0.833;
    const twilight = Math.max(0, Math.min(1, (sun.alt + 6) / 6));
    const az = day ? (Math.atan2(-sy, sx) * 180) / Math.PI : 135;
    const el = day ? Math.max(6, sun.alt) : 60;
    const col = day
      ? mix([255, 214, 170], [255, 252, 244], Math.min(1, sun.alt / 25))
      : mix([70, 84, 110], [150, 140, 150], twilight);
    const key = `${az.toFixed(1)}|${el.toFixed(1)}|${col}`;
    if (key !== lastLight) {
      lastLight = key;
      light.setAttribute('azimuth', az.toFixed(2));
      light.setAttribute('elevation', el.toFixed(2));
      lamp.setAttribute('lighting-color', `rgb(${col})`);
    }

    // The gnomon's shadow.
    const outline = day ? gnomonShadow(dial, sun.dir) : null;
    shadowEl.setAttribute(
      'd',
      outline ? 'M' + outline.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join('L') + 'Z' : '',
    );
    shadowGroup.style.opacity = String(0.62 * Math.min(1, Math.max(0, sun.alt / 4)));
    const nod = day ? nodusShadow(dial, sun.dir) : null;
    if (nod && Math.hypot(nod[0], nod[1]) < 99) {
      beadShadow.setAttribute('cx', nod[0].toFixed(2));
      beadShadow.setAttribute('cy', (-nod[1]).toFixed(2));
      beadShadow.setAttribute('r', (dial.width * 1.15).toFixed(2));
      beadShadow.style.display = '';
    } else beadShadow.style.display = 'none';
    const litSide = sx >= 0 ? 1 : 0;
    sides[litSide].style.fill = day ? '#d9ab62' : '#5d4a2e';
    sides[1 - litSide].style.fill = day ? '#7b582b' : '#3c3020';

    // Where the light comes from, on the pedestal rim.
    if (day) {
      const h = Math.hypot(sx, sy) || 1;
      sunmark.setAttribute('cx', ((97.6 * sx) / h).toFixed(2));
      sunmark.setAttribute('cy', ((-97.6 * sy) / h).toFixed(2));
      sunmark.style.display = '';
    } else sunmark.style.display = 'none';

    // The pedestal's shadow on the lawn.
    if (day) {
      const h = Math.hypot(sx, sy) || 1;
      const len = Math.min(16, 3.2 / Math.tan(Math.max(4, sun.alt) * RAD));
      ground.style.setProperty('--gx', `${((-sx / h) * len).toFixed(2)}%`);
      ground.style.setProperty('--gy', `${((sy / h) * len).toFixed(2)}%`);
      ground.style.setProperty('--go', (0.3 + 0.25 * Math.min(1, sun.alt / 30)).toFixed(2));
      ground.style.setProperty('--gb', `${(10 + len * 0.9).toFixed(1)}px`);
    } else {
      ground.style.setProperty('--gx', '0%');
      ground.style.setProperty('--gy', '1.5%');
      ground.style.setProperty('--go', '0.4');
      ground.style.setProperty('--gb', '22px');
    }

    // Warm low sun, blue night.
    if (sun.alt > 12) tint.style.fill = 'transparent';
    else if (day) {
      tint.style.fill = '#ff9a40';
      tint.style.mixBlendMode = 'multiply';
      tint.style.opacity = String(0.22 * (1 - sun.alt / 12));
    } else {
      // Moonless: darker and cooler, not painted blue.
      tint.style.fill = '#39445c';
      tint.style.mixBlendMode = 'multiply';
      tint.style.opacity = String(0.92 - 0.45 * twilight);
    }

    // The reading.
    const dst = clockOffset(place, ms) - place.zoneLon * 4;
    const noon = 720 - (place.lon - place.zoneLon) * 4 - sun.eot + dst;
    const half = halfDay(place.lat, sun.decl) * 4;
    sum.innerHTML = '';
    if (day) {
      const dialMin = Math.round(reading(dial, sun.ha) * 60);
      const eot = Math.round(sun.eot);
      big.textContent = hm(dialMin);
      sub.textContent = `by the shadow · sun ${Math.round(sun.alt)}° up, bearing ${Math.round(sun.az)}°`;
      const rows: [string, string][] = [
        ['Shadow reads', hm(dialMin)],
        [eot >= 0 ? `Sun running fast, take off` : 'Sun running slow, add', `${Math.abs(eot)} min`],
      ];
      if (dst) rows.push(['Summer time, add', `${dst % 60 ? dst + ' min' : dst / 60 + ' h'}`]);
      rows.push(['On the clock', hm(dialMin - eot + dst)]);
      rows.forEach(([a, b], i) => {
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = a;
        dd.textContent = b;
        if (i === rows.length - 1) {
          dt.className = 'total';
          dd.className = 'total';
        }
        sum.append(dt, dd);
      });
    } else {
      big.textContent = 'Night';
      sub.textContent =
        half <= 0
          ? 'The sun stays below the horizon all day here.'
          : `The sun set at ${hm(noon + half)} and rises at ${hm(noon - half)}.`;
    }

    // Controls follow the instant.
    const days = (Date.UTC(wall.y + 1, 0, 1) - Date.UTC(wall.y, 0, 1)) / 86400e3;
    dayInput.max = String(days - 1);
    dayInput.value = String(Math.round((Date.UTC(wall.y, wall.mo, wall.d) - Date.UTC(wall.y, 0, 1)) / 86400e3));
    timeInput.value = String(Math.floor(wall.minutes));
    dayLabel.textContent = `${wall.d} ${MONTHS[wall.mo]}`;
    timeLabel.textContent = hm(Math.floor(wall.minutes)) + (live ? ' now' : '');
    if (half > 0 && half < 720) {
      const a = (((noon - half) % 1440) + 1440) % 1440;
      const b = (((noon + half) % 1440) + 1440) % 1440;
      const pa = ((a / 1440) * 100).toFixed(2);
      const pb = ((b / 1440) * 100).toFixed(2);
      timeInput.style.setProperty(
        '--day',
        a < b
          ? `linear-gradient(90deg, #26302a ${pa}%, #a27a3c ${pa}%, #e7b55a 50%, #a27a3c ${pb}%, #26302a ${pb}%)`
          : `linear-gradient(90deg, #a27a3c ${pb}%, #26302a ${pb}%, #26302a ${pa}%, #a27a3c ${pa}%)`,
      );
    } else timeInput.style.setProperty('--day', half >= 720 ? '#a27a3c' : '#26302a');
    nowBtn.setAttribute('aria-pressed', String(live));

    drawMap(sun.decl, sun.eot);
  }

  function mix(a: number[], b: number[], t: number): string {
    return a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(' ');
  }

  // ---- Map ----

  const step = Number(root.dataset.step) || 2;
  const cols = 360 / step;
  const rowsN = 180 / step;
  const land = (() => {
    try {
      const raw = atob(root.dataset.land ?? '');
      const bits = new Uint8Array(cols * rowsN);
      for (let i = 0; i < bits.length; i++) bits[i] = (raw.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
      return bits;
    } catch {
      return new Uint8Array(cols * rowsN);
    }
  })();
  let mapKey = '';
  const MAP_TOP = 80;
  const MAP_BOTTOM = -60;
  const maskCanvas = document.createElement('canvas');

  function drawMap(decl: number, eot: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(map.clientWidth * dpr);
    // The map shows 80° N to 60° S; h is the whole globe's height, the canvas only the shown band.
    const h = w / 2;
    const shown = Math.round((w * (MAP_TOP - MAP_BOTTOM)) / 360);
    if (!w) return;
    const minuteKey = Math.round(ms / 120000);
    const key = `${w}|${minuteKey}|${place.lat}|${place.lon}`;
    if (key === mapKey) return;
    mapKey = key;
    if (map.width !== w || map.height !== shown) {
      map.width = w;
      map.height = shown;
    }
    const g = map.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#e3dccb';
    g.fillRect(0, 0, w, shown);
    g.translate(0, (-(90 - MAP_TOP) / 180) * h);
    const d = new Date(ms);
    const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    const cw = w / cols;
    const ch = h / rowsN;
    // Night as a coarse alpha mask, scaled up smooth, then land dots over it.
    const nightAt = new Float32Array(cols * rowsN);
    const mask = new ImageData(cols, rowsN);
    for (let r = 0; r < rowsN; r++) {
      const lat = 90 - (r + 0.5) * step;
      for (let c = 0; c < cols; c++) {
        const lon = -180 + (c + 0.5) * step;
        const up = sunVector(lat, decl, (utcMin + eot + 4 * lon) / 4 - 180).u;
        const night = Math.max(0, Math.min(1, (0.06 - up) / 0.16));
        nightAt[r * cols + c] = night;
        const i = (r * cols + c) * 4;
        mask.data[i] = 23;
        mask.data[i + 1] = 34;
        mask.data[i + 2] = 27;
        mask.data[i + 3] = Math.round(110 * night);
      }
    }
    maskCanvas.width = cols;
    maskCanvas.height = rowsN;
    maskCanvas.getContext('2d')?.putImageData(mask, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(maskCanvas, 0, 0, w, h);
    for (let r = 0; r < rowsN; r++) {
      for (let c = 0; c < cols; c++) {
        const night = nightAt[r * cols + c];
        if (land[r * cols + c]) {
          g.fillStyle = night > 0.5 ? '#3d463f' : '#56605a';
          g.beginPath();
          g.arc((c + 0.5) * cw, (r + 0.5) * ch, Math.min(cw, ch) * 0.36, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    // Graticule: equator and tropics.
    g.strokeStyle = 'rgb(86 96 90 / 0.35)';
    g.lineWidth = Math.max(1, dpr * 0.6);
    for (const lat of [0, 23.44, -23.44]) {
      g.setLineDash(lat ? [3 * dpr, 3 * dpr] : []);
      g.beginPath();
      g.moveTo(0, ((90 - lat) / 180) * h);
      g.lineTo(w, ((90 - lat) / 180) * h);
      g.stroke();
    }
    g.setLineDash([]);
    // The point with the sun overhead.
    const sLon = (((((720 - utcMin - eot) / 4 + 180) % 360) + 360) % 360) - 180;
    const sx = ((sLon + 180) / 360) * w;
    const sy = ((90 - decl) / 180) * h;
    g.fillStyle = '#e7b55a';
    g.strokeStyle = '#8a5f1e';
    g.lineWidth = dpr;
    g.beginPath();
    g.arc(sx, sy, 4.5 * dpr, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // The dial.
    const px = ((place.lon + 180) / 360) * w;
    const py = ((90 - place.lat) / 180) * h;
    g.strokeStyle = '#a3381e';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.arc(px, py, 6 * dpr, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#a3381e';
    g.beginPath();
    g.arc(px, py, 2 * dpr, 0, Math.PI * 2);
    g.fill();
  }

  map.addEventListener('click', (e) => {
    const rect = map.getBoundingClientRect();
    const lon = ((e.clientX - rect.left) / rect.width) * 360 - 180;
    const lat = MAP_TOP - ((e.clientY - rect.top) / rect.height) * (MAP_TOP - MAP_BOTTOM);
    setPlace(placeIn('', round3(lat), round3(lon), null, wallOf(place, ms).y));
  });

  const round3 = (v: number) => Math.round(v * 1000) / 1000;

  function setPlace(p: Place): void {
    // Keep the same wall-clock moment at the new place when not live, so scrubbing carries over.
    const wall = wallOf(place, ms);
    place = p;
    if (!live) ms = instantOf(place, wall.y, wall.mo, wall.d, wall.minutes);
    keep();
    drawFace();
    update();
  }

  // ---- Search ----

  let searchTimer = 0;
  let searchAbort: AbortController | null = null;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = search.value.trim();
    if (q.length < 2) {
      results.hidden = true;
      return;
    }
    searchTimer = window.setTimeout(() => find(q), 300);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') results.hidden = true;
    if (e.key === 'ArrowDown') results.querySelector<HTMLButtonElement>('button')?.focus();
  });
  results.addEventListener('keydown', (e) => {
    const items = [...results.querySelectorAll<HTMLButtonElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') (i <= 0 ? search : items[i - 1]).focus();
    else if (e.key === 'Escape') {
      results.hidden = true;
      search.focus();
    } else return;
    e.preventDefault();
  });
  document.addEventListener('click', (e) => {
    if (!root.querySelector('.search')!.contains(e.target as Node)) results.hidden = true;
  });

  interface Hit {
    name: string;
    latitude: number;
    longitude: number;
    timezone?: string;
    admin1?: string;
    country_code?: string;
  }

  async function find(q: string): Promise<void> {
    searchAbort?.abort();
    searchAbort = new AbortController();
    const url = `${SEARCH}?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
    let hits: Hit[] = [];
    try {
      const res = await fetch(url, { signal: searchAbort.signal });
      if (!res.ok) throw new Error(String(res.status));
      hits = ((await res.json()) as { results?: Hit[] }).results ?? [];
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      showResults(null);
      return;
    }
    showResults(hits);
  }

  function showResults(hits: Hit[] | null): void {
    results.innerHTML = '';
    if (!hits || !hits.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = hits
        ? 'No town by that name.'
        : 'The town search is not answering. Click the map or use your location instead.';
      results.append(li);
    }
    const seen = new Set<string>();
    for (const h of hits ?? []) {
      const id = `${h.name}|${h.admin1}|${h.country_code}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = h.name + ' ';
      const small = document.createElement('small');
      small.textContent = [h.admin1, h.country_code].filter(Boolean).join(', ');
      b.append(small);
      b.addEventListener('click', () => {
        results.hidden = true;
        search.value = '';
        setPlace(placeIn(h.name, round3(h.latitude), round3(h.longitude), h.timezone ?? null, wallOf(place, ms).y));
      });
      li.append(b);
      results.append(li);
    }
    results.hidden = false;
  }

  // ---- Location ----

  locate.addEventListener('click', () => {
    if (!('geolocation' in navigator)) {
      whereNote.textContent = 'This browser cannot share a location. Search for a town or click the map.';
      return;
    }
    locate.disabled = true;
    whereNote.textContent = 'Asking for your location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locate.disabled = false;
        setPlace(
          placeIn('', round3(pos.coords.latitude), round3(pos.coords.longitude), browserZone(), wallOf(place, ms).y),
        );
      },
      () => {
        locate.disabled = false;
        whereNote.textContent = 'No location came back. Search for a town or click the map.';
      },
      { timeout: 12000, maximumAge: 600000 },
    );
  });

  // ---- Time ----

  dayInput.addEventListener('input', () => {
    stopPlay();
    const wall = wallOf(place, ms);
    live = false;
    const d = new Date(Date.UTC(wall.y, 0, 1 + Number(dayInput.value)));
    ms = instantOf(place, d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), wall.minutes);
    drawSheet();
    update();
  });

  timeInput.addEventListener('input', () => {
    stopPlay();
    const wall = wallOf(place, ms);
    live = false;
    ms = instantOf(place, wall.y, wall.mo, wall.d, Number(timeInput.value));
    update();
  });

  nowBtn.addEventListener('click', () => {
    stopPlay();
    live = true;
    ms = Date.now();
    drawFace();
    update();
  });

  let playing = 0;
  function stopPlay(): void {
    if (playing) cancelAnimationFrame(playing);
    playing = 0;
    playBtn.setAttribute('aria-pressed', 'false');
  }

  playBtn.addEventListener('click', () => {
    if (playing) {
      stopPlay();
      return;
    }
    live = false;
    const wall = wallOf(place, ms);
    const { decl, eot } = season(ms);
    const dst = clockOffset(place, ms) - place.zoneLon * 4;
    const noon = 720 - (place.lon - place.zoneLon) * 4 - eot + dst;
    const half = Math.min(720, halfDay(place.lat, decl) * 4);
    if (half <= 0) {
      sub.textContent = 'No sun to run today: it stays below the horizon.';
      return;
    }
    const from = noon - half - 15;
    const to = noon + half + 15;
    const duration = 16000;
    const t0 = performance.now();
    playBtn.setAttribute('aria-pressed', 'true');
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      ms = instantOf(place, wall.y, wall.mo, wall.d, from + (to - from) * (0.15 * t + 0.85 * eased));
      update();
      if (t < 1) playing = requestAnimationFrame(frame);
      else stopPlay();
    };
    playing = requestAnimationFrame(frame);
  });

  mottoSel.addEventListener('change', () => {
    motto = mottoSel.value;
    keep();
    drawFace();
    update();
  });

  printBtn.addEventListener('click', () => {
    drawSheet();
    window.print();
  });

  window.addEventListener('beforeprint', drawSheet);

  setInterval(() => {
    if (!live || document.hidden) return;
    const before = wallOf(place, ms).y;
    ms = Date.now();
    if (wallOf(place, ms).y !== before) drawFace();
    update();
  }, 15000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && live) {
      ms = Date.now();
      update();
    }
  });

  new ResizeObserver(() => {
    mapKey = '';
    update();
  }).observe(map);

  drawFace();
  update();

  if (params.has('debug')) {
    (window as unknown as { sundial: unknown }).sundial = {
      get place() {
        return place;
      },
      get dial() {
        return dial;
      },
      get ms() {
        return ms;
      },
      R,
      RAD,
    };
  }
}
