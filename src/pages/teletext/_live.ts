// Pages set from the feeds: news, the day in history, the featured article,
// money, weather, the Moon and Sun, and earthquakes.

import { A, G, DOUBLE, FLASH, HOLD, NEW_BG, SEPARATE, CONTIG, Page, fit, wrap, type Colour } from './_page';
import { band, counter, fastext, notice, paginate, type Band, type Labels } from './_layout';
import { CURRENCIES, US_CITIES, WORLD_CITIES, sky, store, type Status } from './_feeds';
import { MAP } from './_mapgrid';
import { clock, moon, moonLit, sun } from './_sky';
import type { Service } from './_service';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** What a page shows while its feed is loading or down. */
function waiting(b: Band, status: Status, labels: Labels): Page[] {
  return [
    notice(
      b,
      status === 'error'
        ? ['This page is not in transmission at the moment.', 'The source it is set from did not answer. The set will try again.']
        : ['Updating...', 'This page is being set from the latest figures.'],
      labels,
    ),
  ];
}

/** Body lines across subpages: rows 5 to 21 under a band. */
function story(b: Band, lead: { text: string; colour: Colour }[], labels: Labels, first = 5, last = 21): Page[] {
  const lines: { text: string; colour: Colour }[] = [];
  for (const part of lead) {
    for (const l of wrap(part.text, 38)) lines.push({ text: l, colour: part.colour });
    lines.push({ text: '', colour: 'white' });
  }
  while (lines.length && !lines[lines.length - 1].text) lines.pop();
  const per = last - first + 1;
  const groups = paginate(lines, per);
  return groups.map((g, i) => {
    const p = new Page();
    band(p, b);
    // Don't start a subpage on a blank line.
    let r = first;
    g.forEach((l, k) => {
      if (k === 0 && !l.text) return;
      if (l.text) p.put(r, 0, A[l.colour], l.text);
      r++;
    });
    counter(p, i, groups.length);
    fastext(p, labels);
    return p;
  });
}

// News: the stories on Wikipedia's main page "In the news".
const NEWS: Band = { title: 'News', bg: 'red', fg: 'white', rule: 'red', tag: 'Headlines' };
const NEWS_LABELS: Labels = ['Headlines', 'Next', 'Weather', 'Index'];
const MAX_STORIES = 8;

function headlines(): Page[] {
  if (!store.news.length) return waiting(NEWS, store.wiki, NEWS_LABELS);
  const blocks = store.news.slice(0, MAX_STORIES).map((s, i) => ({ n: 102 + i, lines: wrap(s.headline, 34) }));
  const pages: Page[] = [];
  let p: Page | null = null;
  let r = 0;
  for (const b of blocks) {
    const need = Math.min(b.lines.length, 4);
    if (!p || r + need > 22) {
      p = new Page();
      band(p, NEWS);
      pages.push(p);
      r = 5;
    }
    p.put(r, 0, A.yellow, String(b.n), A.white, b.lines[0]);
    for (let k = 1; k < need; k++) {
      const more = k === need - 1 && b.lines.length > need;
      p.put(r + k, 4, A.white, more ? `${b.lines[k].slice(0, 31)}...` : b.lines[k]);
    }
    r += need + 1;
  }
  pages.forEach((pg, i) => {
    counter(pg, i, pages.length);
    fastext(pg, ['Top story', 'History', 'Weather', 'Index']);
  });
  return pages;
}

function storyPages(i: number): Page[] {
  const s = store.news[i];
  if (!s) return waiting(NEWS, store.wiki, NEWS_LABELS);
  const b = { ...NEWS, tag: `Story ${i + 1}` };
  const lead = [{ text: s.headline, colour: 'yellow' as Colour }];
  if (s.body) lead.push({ text: s.body, colour: 'white' });
  return story(b, lead, NEWS_LABELS);
}

function storyLinks(i: number): [number, number, number, number] {
  const next = i + 1 < Math.min(store.news.length, MAX_STORIES) ? 103 + i : 101;
  return [101, next, 400, 100];
}

// The day in history.
const HISTORY: Band = { title: 'On this day', bg: 'blue', fg: 'yellow', rule: 'cyan' };

function onThisDay(): Page[] {
  if (!store.onthisday.length) return waiting(HISTORY, store.wiki, ['News', 'Featured', '', 'Index']);
  const now = new Date();
  const lines: { year?: number; text: string }[] = [];
  for (const e of store.onthisday) {
    const w = wrap(e.text, 33);
    w.forEach((t, k) => lines.push({ year: k === 0 ? e.year : undefined, text: t }));
    lines.push({ text: '' });
  }
  // Keep each event on one subpage.
  const pages: Page[] = [];
  let p: Page | null = null;
  let r = 0;
  let block: typeof lines = [];
  const flush = () => {
    if (!block.length) return;
    const need = block.filter((l) => l.text).length;
    if (!p || r + need > 21) {
      p = new Page();
      band(p, { ...HISTORY, tag: `${now.getDate()} ${SHORT_MONTHS[now.getMonth()]}` });
      pages.push(p);
      r = 5;
    }
    for (const l of block) {
      if (!l.text) continue;
      if (l.year !== undefined) p.put(r, 0, A.cyan, fit(l.year < 0 ? `${-l.year}BC` : String(l.year), 5), A.white, l.text);
      else p.put(r, 6, A.white, l.text);
      r++;
    }
    r++;
    block = [];
  };
  for (const l of lines) {
    if (!l.text) flush();
    else block.push(l);
  }
  flush();
  pages.forEach((pg, i) => {
    counter(pg, i, pages.length);
    fastext(pg, ['News', 'Featured', 'Facts', 'Index']);
  });
  return pages;
}

const FEATURED: Band = { title: 'Featured article', bg: 'green', fg: 'blue', rule: 'green' };

function featured(): Page[] {
  if (!store.tfa) return waiting(FEATURED, store.wiki, ['News', 'Facts', '', 'Index']);
  const t = store.tfa;
  const lead: { text: string; colour: Colour }[] = [{ text: t.title, colour: 'yellow' }];
  if (t.description) lead.push({ text: t.description, colour: 'cyan' });
  lead.push({ text: t.extract, colour: 'white' });
  return story(FEATURED, lead, ['News', 'Facts', 'History', 'Index']);
}

const DYK: Band = { title: 'Did you know', bg: 'magenta', fg: 'white', rule: 'magenta' };

function didYouKnow(): Page[] {
  if (!store.dyk.length) return waiting(DYK, store.wiki, ['News', 'Featured', '', 'Index']);
  const facts = store.dyk.map((d) => d.replace(/^\.\.\.\s*/, '...'));
  const pages: Page[] = [];
  let p: Page | null = null;
  let r = 0;
  for (const f of facts) {
    const w = wrap(f, 38);
    if (!p || r + w.length > 21) {
      p = new Page();
      band(p, DYK);
      pages.push(p);
      r = 5;
    }
    w.forEach((t, k) => p!.put(r + k, 0, A[k === 0 ? 'yellow' : 'white'], t));
    r += w.length + 1;
  }
  pages.forEach((pg, i) => {
    counter(pg, i, pages.length);
    fastext(pg, ['News', 'Featured', 'Quiz', 'Index']);
  });
  return pages;
}

// Money: what a dollar buys, from the European Central Bank's reference rates.
const MONEY: Band = { title: 'Money', bg: 'cyan', fg: 'blue', rule: 'yellow', tag: 'Currencies' };
const NAMES: Record<string, string> = {
  EUR: 'Euro',
  GBP: 'Pound sterling',
  JPY: 'Japanese yen',
  CAD: 'Canadian dollar',
  MXN: 'Mexican peso',
  CHF: 'Swiss franc',
  AUD: 'Australian dollar',
  CNY: 'Chinese yuan',
  INR: 'Indian rupee',
  KRW: 'Korean won',
  BRL: 'Brazilian real',
  SEK: 'Swedish krona',
};

function rate(v: number): string {
  if (v >= 1000) return v.toFixed(1);
  if (v >= 100) return v.toFixed(2);
  if (v >= 10) return v.toFixed(3);
  return v.toFixed(4);
}

function day(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${SHORT_DAYS[dt.getUTCDay()]} ${d} ${SHORT_MONTHS[m - 1]}`;
}

function money(): Page[] {
  if (store.rates.length < 2) return waiting(MONEY, store.fx, ['Charts', 'Weather', '', 'Index']);
  const last = store.rates[store.rates.length - 1];
  const prev = store.rates[store.rates.length - 2];
  const p = new Page();
  band(p, MONEY);
  p.put(5, 0, A.cyan, fit('One US dollar buys', 26), A.white, fit(day(last.date), 12, 'right'));
  p.put(6, 0, A.green, fit('', 23), fit('Rate', 9, 'right'), fit('Day', 7, 'right'));
  let r = 7;
  for (const c of CURRENCIES) {
    const now = last.rates[c];
    const was = prev.rates[c];
    if (now === undefined) continue;
    const pct = was ? ((now - was) / was) * 100 : 0;
    const flat = Math.abs(pct) < 0.005;
    const sign = flat ? '0.00' : `${pct > 0 ? '+' : '-'}${Math.abs(pct).toFixed(2)}`;
    p.put(r, 0, A.yellow, c, A.white, fit(NAMES[c], 19), fit(rate(now), 9, 'right'), A[flat ? 'white' : pct > 0 ? 'green' : 'red'], fit(sign, 6, 'right'));
    r++;
  }
  p.put(20, 0, A.white, 'Up means the dollar buys more.');
  p.put(21, 0, A.cyan, 'Reference rates, set once a working day.');
  fastext(p, ['Charts', 'Weather', 'News', 'Index']);
  return [p];
}

const CHARTED = ['EUR', 'GBP', 'JPY', 'CAD', 'MXN'];

function charts(): Page[] {
  const b: Band = { ...MONEY, tag: 'Three months' };
  if (store.rates.length < 2) return waiting(b, store.fx, ['Rates', 'Weather', '', 'Index']);
  return CHARTED.map((c, i) => {
    const series = store.rates.map((d) => d.rates[c]).filter((v): v is number => v !== undefined);
    const p = new Page();
    band(p, b);
    const lo = Math.min(...series);
    const hi = Math.max(...series);
    const span = hi - lo || hi * 0.01;
    const W = 32 * 2;
    const H = 12 * 3;
    // A filled area chart: each dot column rises to the day's rate.
    const height = (x: number) => {
      const t = (x / (W - 1)) * (series.length - 1);
      const a = series[Math.floor(t)];
      const z = series[Math.min(series.length - 1, Math.ceil(t))];
      const v = a + (z - a) * (t - Math.floor(t));
      return 2 + ((v - lo) / span) * (H - 4);
    };
    p.put(5, 0, A.yellow, `$1 in ${NAMES[c].toLowerCase()}`, A.white, fit(rate(series[series.length - 1]), 38 - 7 - NAMES[c].length - 1, 'right'));
    for (let r = 0; r < 12; r++) {
      const label = r === 0 ? rate(hi) : r === 11 ? rate(lo) : '';
      p.put(7 + r, 0, A.white, fit(label, 6), G.cyan);
      p.mosaic(7 + r, 8, 32, 1, (x, y) => H - (r * 3 + y) <= height(x));
    }
    p.put(19, 0, A.white, fit(day(store.rates[0].date), 19), fit(day(store.rates[store.rates.length - 1].date), 19, 'right'));
    const change = ((series[series.length - 1] - series[0]) / series[0]) * 100;
    p.put(21, 0, A.cyan, 'Over three months', A[change >= 0 ? 'green' : 'red'], `${change >= 0 ? '+' : '-'}${Math.abs(change).toFixed(1)}%`);
    counter(p, i, CHARTED.length);
    fastext(p, ['Rates', 'Weather', 'News', 'Index']);
    return p;
  });
}

// Weather.
const WEATHER: Band = { title: 'Weather', bg: 'blue', fg: 'white', rule: 'green', tag: 'Now' };
const toF = (c: number) => (c * 9) / 5 + 32;

/** Temperature colours, cold to hot. */
function tempColour(f: number): Colour {
  if (f < 40) return 'cyan';
  if (f < 60) return 'white';
  if (f < 85) return 'yellow';
  return 'red';
}

function weatherMap(mask: string): Page[] {
  const p = new Page();
  band(p, { ...WEATHER, title: 'Weather', tag: 'Temperatures F' });
  const kind = (x: number, y: number) => (x < 0 || y < 0 || x >= MAP.w || y >= MAP.h ? 0 : Number(mask[y * MAP.w + x] ?? 0));
  const rows = MAP.h / 3;
  const cols = MAP.w / 2;
  // Labels go in first so the map can route round them.
  const labels = new Map<number, { col: number; text: string; colour: Colour }>();
  const taken: boolean[][] = Array.from({ length: rows }, () => Array(cols + 4).fill(false));
  if (store.weather === 'ok') {
    for (const c of US_CITIES) {
      const w = store.conditions[c.name];
      if (!w) continue;
      const { x, y } = MAP.project(c.lon, c.lat);
      const r = Math.floor(y / 3);
      const text = String(Math.round(toF(w.temp)));
      let col = Math.floor(x / 2) - 1;
      col = Math.max(0, Math.min(cols - text.length - 2, col));
      if (r < 0 || r >= rows) continue;
      const span = [col, col + text.length + 1];
      let clash = false;
      for (let k = span[0]; k <= span[1] + 1; k++) if (taken[r][k]) clash = true;
      if (clash) continue;
      for (let k = span[0]; k <= span[1] + 1; k++) taken[r][k] = true;
      labels.set(r * 100 + col, { col, text, colour: tempColour(toF(w.temp)) });
    }
  }
  for (let r = 0; r < rows; r++) {
    const row = 4 + r;
    p.put(row, 0, G.blue, NEW_BG, HOLD, G.green);
    let mode = 1;
    let c = 0;
    while (c < cols) {
      const label = labels.get(r * 100 + c);
      if (label) {
        // A colour cell (showing the held block), the digits, and a cell to
        // get back to graphics. Separation survives the switch to text.
        p.put(row, 4 + c, A[label.colour], label.text, G.green);
        c += label.text.length + 2;
        continue;
      }
      const cells: number[] = [];
      for (let k = 0; k < 6; k++) cells.push(kind(c * 2 + (k % 2), r * 3 + Math.floor(k / 2)));
      const us = cells.filter((v) => v === 1).length;
      const near = cells.filter((v) => v === 2).length;
      const want = us === 0 && near === 0 ? mode : us >= near ? 1 : 2;
      if (want !== mode) {
        p.put(row, 4 + c, want === 2 ? SEPARATE : CONTIG);
        mode = want;
        c++;
        continue;
      }
      const lit = cells.map((v) => v !== 0);
      p.put(row, 4 + c, 0x20 | (lit[0] ? 1 : 0) | (lit[1] ? 2 : 0) | (lit[2] ? 4 : 0) | (lit[3] ? 8 : 0) | (lit[4] ? 16 : 0) | (lit[5] ? 64 : 0));
      c++;
    }
  }
  if (store.weather !== 'ok') {
    p.put(21, 0, A.white, store.weather === 'error' ? 'Temperatures are not in transmission.' : 'Updating temperatures...');
  } else {
    p.put(21, 0, A.white, 'Now:', A.cyan, 'below 40', A.white, '40-59', A.yellow, '60-84', A.red, '85 up');
  }
  fastext(p, ['US cities', 'World', 'Moon', 'Index']);
  return [p];
}

function cityTable(cities: typeof US_CITIES, title: string, fahrenheitFirst: boolean, labels: Labels): Page[] {
  const b = { ...WEATHER, tag: title };
  if (store.weather !== 'ok') return waiting(b, store.weather, labels);
  const p = new Page();
  band(p, b);
  p.put(5, 0, A.green, fit('', 15), fit(fahrenheitFirst ? 'F' : 'C', 4, 'right'), fit(fahrenheitFirst ? 'C' : 'F', 4, 'right'), fit('Hi/Lo', 7, 'right'), '  ', 'Sky');
  let r = 6;
  for (const c of cities) {
    const w = store.conditions[c.name];
    if (!w) continue;
    const f = Math.round(toF(w.temp));
    const cc = Math.round(w.temp);
    const hl = fahrenheitFirst ? `${Math.round(toF(w.hi))}/${Math.round(toF(w.lo))}` : `${Math.round(w.hi)}/${Math.round(w.lo)}`;
    p.put(r, 0, A.white, fit(c.name, 15), A[tempColour(f)], fit(String(fahrenheitFirst ? f : cc), 3, 'right'), A.white, fit(String(fahrenheitFirst ? cc : f), 3, 'right'), fit(hl, 7, 'right'), A.cyan, ' ', fit(sky(w.code, w.isDay), 12));
    r++;
  }
  p.put(21, 0, A.white, 'Now, and today\'s high and low.');
  fastext(p, labels);
  return [p];
}

// The Moon and the Sun.
const ALMANAC: Band = { title: 'Moon and sun', bg: 'blue', fg: 'white', rule: 'blue' };

function shortDate(d: Date): string {
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

function moonPage(): Page[] {
  const p = new Page();
  band(p, { ...ALMANAC, tag: 'Tonight' });
  const m = moon();
  // The disc: lit dots in white; cells wholly in shadow in blue, for
  // earthshine. A colour change takes the place of a cell, which held
  // graphics fill with the cell before it.
  const rows = 15;
  const cols = 19;
  const ry = 20.5;
  const rx = ry / 1.16;
  const cx = 19;
  const cy = (rows * 3) / 2;
  for (let r = 0; r < rows; r++) {
    const row = 5 + r;
    let colour = 0;
    p.put(row, 0, HOLD);
    for (let c = 1; c < cols; c++) {
      const disc: boolean[] = [];
      const lit: boolean[] = [];
      for (let k = 0; k < 6; k++) {
        const x = c * 2 + (k % 2) + 0.5;
        const y = r * 3 + Math.floor(k / 2) + 0.5;
        const u = (x - cx) / rx;
        const v = (y - cy) / ry;
        const inside = u * u + v * v <= 1;
        disc.push(inside);
        lit.push(inside && moonLit(u, v, m.angle));
      }
      const anyLit = lit.some(Boolean);
      const anyDisc = disc.some(Boolean);
      const want = anyLit ? 7 : anyDisc ? 4 : colour;
      if (want !== colour) {
        p.put(row, c, want === 7 ? G.white : G.blue);
        colour = want;
        continue;
      }
      const cells = anyLit ? lit : disc;
      p.put(row, c, 0x20 | (cells[0] ? 1 : 0) | (cells[1] ? 2 : 0) | (cells[2] ? 4 : 0) | (cells[3] ? 8 : 0) | (cells[4] ? 16 : 0) | (cells[5] ? 64 : 0));
    }
  }
  const x = 21;
  // Normal height: a double-height row would take the next row's half of the
  // disc with it.
  p.put(7, x, A.yellow, m.name.split(' ')[0]);
  if (m.name.includes(' ')) p.put(8, x, A.yellow, m.name.split(' ').slice(1).join(' '));
  p.put(11, x, A.white, fit(`${Math.round(m.lit * 100)}% lit`, 17));
  p.put(12, x, A.white, fit(`${m.age.toFixed(1)} days old`, 17));
  p.put(14, x, A.cyan, 'Next full moon');
  p.put(15, x, A.white, `about ${shortDate(m.nextFull)}`);
  p.put(17, x, A.cyan, 'Next new moon');
  p.put(18, x, A.white, `about ${shortDate(m.nextNew)}`);
  p.put(21, 0, A.white, 'As seen from the northern hemisphere.');
  fastext(p, ['Sunrise', 'Weather', 'Quakes', 'Index']);
  return [p];
}

const SUN_CITIES = [...US_CITIES.filter((c) => ['Seattle', 'Los Angeles', 'Denver', 'Chicago', 'New York', 'Miami'].includes(c.name)), ...WORLD_CITIES.filter((c) => ['Reykjavik', 'London', 'Cairo', 'Tokyo', 'Sydney', 'Anchorage', 'Nairobi'].includes(c.name))];

function sunPage(): Page[] {
  const p = new Page();
  band(p, { ...ALMANAC, title: 'Sunrise', tag: 'Local times' });
  p.put(5, 0, A.green, fit('', 15), fit('Rise', 6, 'right'), fit('Set', 7, 'right'), fit('Day', 8, 'right'));
  let r = 6;
  for (const c of SUN_CITIES) {
    const s = sun(c.lat, c.lon, c.tz);
    const len = s.length >= 24 ? 'All day' : s.length <= 0 ? 'None' : `${Math.floor(s.length)}h ${String(Math.round((s.length % 1) * 60)).padStart(2, '0')}m`;
    p.put(r, 0, A.white, fit(c.name, 15), A.yellow, fit(s.rise ? clock(s.rise, c.tz) : '--:--', 5, 'right'), A.white, ' ', fit(s.set ? clock(s.set, c.tz) : '--:--', 5, 'right'), A.cyan, fit(len, 8, 'right'));
    r++;
  }
  p.put(21, 0, A.white, 'Each city in its own time.');
  fastext(p, ['Moon', 'Weather', 'Quakes', 'Index']);
  return [p];
}

// Earthquakes: magnitude 4.5 and up, worldwide, last 24 hours, from the USGS.
const QUAKES: Band = { title: 'Earthquakes', bg: 'yellow', fg: 'red', rule: 'yellow', tag: 'Last 24 hours' };

function quakes(): Page[] {
  const labels: Labels = ['Moon', 'Weather', 'News', 'Index'];
  if (store.quakes !== 'ok') return waiting(QUAKES, store.quakes, labels);
  if (!store.quakeList.length) return [notice(QUAKES, ['No earthquakes of magnitude 4.5 or more in the last day.'], labels)];
  const groups = paginate(store.quakeList, 15);
  return groups.map((g, i) => {
    const p = new Page();
    band(p, QUAKES);
    p.put(5, 0, A.green, 'Time', fit('', 3), 'Mag', fit('', 2), 'Where');
    let r = 6;
    for (const q of g) {
      const t = clock(new Date(q.time));
      const big = q.mag >= 6.5;
      const colour: Colour = big ? 'red' : q.mag >= 5.5 ? 'yellow' : 'white';
      const place = q.place.replace(/^(\d+) km /, '$1km ');
      p.put(r, 0, A.cyan, t, A[colour], big ? FLASH : 0x20, q.mag.toFixed(1), A.white, big ? 0x09 : 0x20, fit(place, 27));
      r++;
    }
    p.put(22, 0, A.white, 'Magnitude 4.5 and up, worldwide. Your time.');
    counter(p, i, groups.length);
    fastext(p, labels);
    return p;
  });
}

export function addLive(s: Service, mask: string): void {
  s.add(101, { build: headlines, links: [102, 120, 400, 100] });
  for (let i = 0; i < MAX_STORIES; i++) {
    s.add(102 + i, { build: () => storyPages(i), links: () => storyLinks(i), exists: () => i < store.news.length });
  }
  s.add(120, { build: onThisDay, links: [101, 130, 140, 100] });
  s.add(130, { build: featured, links: [101, 140, 120, 100] });
  s.add(140, { build: didYouKnow, links: [101, 130, 700, 100] });
  s.add(200, { build: money, links: [201, 400, 101, 100] });
  s.add(201, { build: charts, links: [200, 400, 101, 100] });
  s.add(400, { build: () => weatherMap(mask), links: [401, 402, 500, 100] });
  s.add(401, { build: () => cityTable(US_CITIES, 'US cities', true, ['Map', 'World', 'Moon', 'Index']), links: [400, 402, 500, 100] });
  s.add(402, { build: () => cityTable(WORLD_CITIES, 'World', false, ['Map', 'US cities', 'Moon', 'Index']), links: [400, 401, 500, 100] });
  s.add(500, { build: moonPage, links: [501, 400, 600, 100] });
  s.add(501, { build: sunPage, links: [500, 400, 600, 100] });
  s.add(600, { build: quakes, links: [500, 400, 101, 100] });
}

export { MONTHS };
