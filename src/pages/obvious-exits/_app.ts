// Page controller for /obvious-exits/: choose a town (a snapshot, a search, or where you are),
// build it, and play: every command is echoed, run, and answered in the transcript, the pencil
// map is redrawn, and the afternoon is saved as the list of commands so far.

import { COMPASS_WORD, hash } from './_describe';
import { newGame, run, status, type Block, type Game, type Where } from './_game';
import { PencilMap } from './_map';
import { compact, overpassQuery, pack, unpack, type Packed } from './_overpass.mjs';
import { PLACES, RADIUS, type Place } from './_places';
import { clockDigits, lightAt, skyOver, wetOf, type Sky } from './_sky';
import { buildTown, type Compact, type Town } from './_town';

// The snapshots ship as plain files fetched on demand, so no code is shared with other pages.
const dataUrls = import.meta.glob<string>('./_data/*.json', { query: '?url', import: 'default', eager: true });

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const GEOCODER = 'https://geocoding-api.open-meteo.com/v1/search';
const STORE = 'obvious-exits:v1';
const MAX_LOG = 500;

interface Saved {
  v: 1;
  key: string;
  where: Where;
  lat: number;
  lon: number;
  begin?: string;
  snapshot?: string;
  town?: Packed;
  date: string;
  log: string[];
}

interface Session {
  key: string;
  where: Where;
  lat: number;
  lon: number;
  begin?: string;
  snapshot?: string;
  compact: Compact;
  town: Town;
  sky: Sky;
  game: Game;
  log: string[];
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    return s.v === 1 && Array.isArray(s.log) ? s : null;
  } catch {
    return null;
  }
}

function save(s: Session): void {
  const out: Saved = {
    v: 1,
    key: s.key,
    where: s.where,
    lat: s.lat,
    lon: s.lon,
    begin: s.begin,
    snapshot: s.snapshot,
    town: s.snapshot ? undefined : pack(s.compact),
    date: s.sky.date,
    log: s.log,
  };
  try {
    localStorage.setItem(STORE, JSON.stringify(out));
  } catch {
    // A live town may be too big for storage; keep the snapshot towns at least.
    try {
      if (!s.snapshot) localStorage.removeItem(STORE);
    } catch {}
  }
}

function forget(): void {
  try {
    localStorage.removeItem(STORE);
  } catch {}
}

const fmtDeg = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? pos : neg}`;

export function start(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const story = q<HTMLElement>('[data-story]');
  const log = q<HTMLElement>('[data-log]');
  const chooser = q<HTMLElement>('[data-chooser]');
  const prompt = q<HTMLFormElement>('[data-prompt]');
  const input = q<HTMLInputElement>('[data-command]');
  const statusLine = q<HTMLElement>('[data-status]');
  const slip = q<HTMLOListElement>('[data-slip]');
  const slipBox = q<HTMLElement>('[data-slip-box]');
  const pad = q<HTMLElement>('[data-pad]');
  const mapToggle = q<HTMLButtonElement>('[data-map-toggle]');
  const search = q<HTMLFormElement>('[data-search]');
  const searchInput = search.querySelector('input')!;
  const searchStatus = q<HTMLElement>('[data-search-status]');
  const hereButton = q<HTMLButtonElement>('[data-here]');
  const resume = q<HTMLButtonElement>('[data-resume]');
  const map = new PencilMap(q<SVGSVGElement>('[data-map]'));
  const fine = matchMedia('(pointer: fine)');

  let session: Session | null = null;
  let busy = false;
  let token = 0;
  const history: string[] = [];
  let historyAt = 0;

  const scrollDown = () => {
    story.scrollTop = story.scrollHeight;
  };

  // ---- Rendering --------------------------------------------------------------------------

  const add = (tag: string, cls: string, text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    log.appendChild(e);
    return e;
  };

  const retireExits = () => {
    for (const b of log.querySelectorAll<HTMLButtonElement>('.oe-exits button')) b.disabled = true;
  };

  function render(blocks: Block[]): void {
    for (const b of blocks) {
      switch (b.k) {
        case 'banner': {
          const box = add('div', 'oe-banner');
          b.lines.forEach((line, i) => {
            const p = document.createElement('p');
            p.className = i === 0 ? 'oe-banner-title' : 'oe-banner-line';
            p.textContent = line;
            box.appendChild(p);
          });
          break;
        }
        case 'title':
          add('h2', 'oe-title', b.text);
          break;
        case 'p':
          add('p', 'oe-p', b.text);
          break;
        case 'event':
          add('p', 'oe-event', b.text);
          break;
        case 'end':
          add('p', 'oe-end', b.text);
          break;
        case 'list': {
          const ul = add('ul', 'oe-list');
          for (const it of b.items) {
            const li = document.createElement('li');
            li.textContent = it.text;
            if (it.done) li.className = 'done';
            ul.appendChild(li);
          }
          break;
        }
        case 'exits': {
          retireExits();
          const p = add('p', 'oe-exits');
          const lead = document.createElement('span');
          lead.className = 'oe-exits-lead';
          lead.textContent = b.exits.length ? 'Exits:' : 'There is no way on from here.';
          p.appendChild(lead);
          for (const x of b.exits) {
            const btn = document.createElement('button');
            btn.type = 'button';
            const e = session?.town.edges[x.edge];
            const dir = x.dir ? COMPASS_WORD[x.dir] : '';
            btn.dataset.cmd = x.dir ?? `#e${x.edge}`;
            btn.dataset.say = x.dir ?? `go ${e?.name ?? x.how.replace(/^(along|by|on|through|down|over) (an? )?/, '')}`;
            btn.textContent = `${dir} ${x.how}`.trim();
            if (x.out) btn.classList.add('far');
            if (!btn.dataset.cmd) btn.disabled = true;
            p.appendChild(btn);
          }
          break;
        }
        case 'ui':
          if (b.action === 'map') root.classList.toggle('map-open', true);
          break;
      }
    }
  }

  function refresh(): void {
    if (!session) return;
    const g = session.game;
    statusLine.textContent = status(g);
    root.dataset.light = lightAt(g.clock, g.sky.sunset);
    root.dataset.wet = wetOf(g.sky.weather);
    slip.replaceChildren();
    for (const e of g.errands) {
      const li = document.createElement('li');
      li.textContent = e.def.line;
      if (e.done) li.className = 'done';
      slip.appendChild(li);
    }
    if (g.meet) {
      const li = document.createElement('li');
      li.textContent = `${g.meet.friend}, ${g.town.spots[g.meet.spot].name}, ${clockDigits(g.close)}`;
      if (g.meet.done) li.className = 'done';
      slip.appendChild(li);
    }
    slipBox.hidden = false;
    map.setTop(slipBox.offsetHeight ? slipBox.offsetTop + slipBox.offsetHeight + 4 : 0);
    map.update(g);
  }

  // ---- Choosing a town -------------------------------------------------------------------

  function showChooser(): void {
    token++;
    busy = false;
    session = null;
    log.replaceChildren();
    root.dataset.phase = 'choose';
    chooser.hidden = false;
    prompt.hidden = true;
    slipBox.hidden = true;
    statusLine.textContent = '';
    delete root.dataset.light;
    delete root.dataset.wet;
    map.clear();
    const saved = load();
    resume.hidden = !saved;
    if (saved)
      resume.textContent = `Carry on in ${saved.where.name} (${saved.log.length} ${saved.log.length === 1 ? 'command' : 'commands'} in)`;
    story.scrollTop = 0;
  }

  function begin(s: Omit<Session, 'game' | 'log'>, replay: string[] = []): void {
    const seed = hash(s.key, s.sky.date);
    const { game, blocks } = newGame(s.town, s.where, s.sky, seed);
    session = { ...s, game, log: [] };
    chooser.hidden = true;
    prompt.hidden = false;
    root.dataset.phase = 'play';
    log.replaceChildren();
    render(blocks);
    // Replaying a saved afternoon shows only its last stretch.
    const keepFrom = Math.max(0, replay.length - 12);
    replay.forEach((cmd, i) => {
      const out = run(game, cmd);
      session!.log.push(cmd);
      if (i >= keepFrom) {
        add('p', 'oe-echo', `> ${cmd}`);
        render(out.filter((b) => b.k !== 'ui'));
      }
    });
    if (replay.length > keepFrom && keepFrom > 0)
      add('p', 'oe-event', `(The start of your afternoon has been skipped; ${keepFrom} earlier commands.)`);
    refresh();
    save(session);
    scrollDown();
    if (fine.matches) input.focus({ preventScroll: true });
  }

  async function fromSnapshot(p: Place, replay: string[] = []): Promise<void> {
    if (busy) return;
    busy = true;
    const my = ++token;
    searchStatus.textContent = `Opening ${p.name}…`;
    try {
      const url = dataUrls[`./_data/${p.id}.json`];
      const [c, sky] = await Promise.all([
        fetch(url).then(async (r) => unpack((await r.json()) as Packed) as Compact),
        skyOver(p.lat, p.lon),
      ]);
      if (my !== token) return;
      const town = buildTown(c, p.begin);
      searchStatus.textContent = '';
      busy = false;
      begin(
        {
          key: p.id,
          where: { name: p.name, region: p.region, english: p.english },
          lat: p.lat,
          lon: p.lon,
          begin: p.begin,
          snapshot: p.id,
          compact: c,
          town,
          sky,
        },
        replay,
      );
    } catch {
      busy = false;
      if (my === token) searchStatus.textContent = `${p.name} wouldn’t open. Try again in a moment.`;
    }
  }

  async function fromLive(where: Where, lat: number, lon: number, c0?: Compact, replay: string[] = []): Promise<void> {
    if (busy) return;
    busy = true;
    const my = ++token;
    const say = (t: string) => {
      if (my === token) searchStatus.textContent = t;
    };
    try {
      let c = c0;
      const skyP = skyOver(lat, lon);
      if (!c) {
        say(`Surveying the streets of ${where.name} from OpenStreetMap. This can take up to a minute…`);
        root.classList.add('surveying');
        // The public servers turn queries away when they are full and ask for a retry with backoff.
        const body = new URLSearchParams({ data: overpassQuery(lat, lon, RADIUS) });
        let raw: { elements: unknown[] } | null = null;
        for (const wait of [0, 4000, 9000, 16000, 25000]) {
          if (wait) {
            say(`The map servers are busy. Trying again in ${wait / 1000} seconds…`);
            await new Promise((r) => setTimeout(r, wait));
            if (my !== token) return;
            say(`Surveying the streets of ${where.name} from OpenStreetMap…`);
          }
          try {
            const res = await fetch(OVERPASS, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body,
              signal: AbortSignal.timeout(100000),
            });
            if (res.ok) {
              raw = await res.json();
              break;
            }
            if (res.status !== 429 && res.status < 500) break;
          } catch {}
          if (my !== token) return;
        }
        if (!raw) throw new Error('no survey');
        c = compact(raw as { elements: [] }, lat, lon, RADIUS);
      }
      const town = buildTown(c);
      const sky = await skyP;
      if (my !== token) return;
      root.classList.remove('surveying');
      busy = false;
      if (town.stops.filter((s) => !s.out).length < 12) {
        say(`There aren’t enough streets mapped around ${where.name} to walk. Try somewhere a little bigger.`);
        return;
      }
      say('');
      begin({ key: `${lat.toFixed(3)},${lon.toFixed(3)}`, where, lat, lon, compact: c, town, sky }, replay);
    } catch {
      root.classList.remove('surveying');
      busy = false;
      say(`OpenStreetMap’s servers are busy right now. Try again in a minute, or pick one of the towns above.`);
    }
  }

  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-place]')) {
    b.addEventListener('click', () => {
      const p = PLACES.find((x) => x.id === b.dataset.place);
      if (p) void fromSnapshot(p);
    });
  }

  search.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = searchInput.value.trim();
    if (!name || busy) return;
    const my = ++token;
    searchStatus.textContent = `Looking for ${name}…`;
    try {
      const res = await fetch(`${GEOCODER}?name=${encodeURIComponent(name)}&count=5&language=en&format=json`, {
        signal: AbortSignal.timeout(10000),
      });
      const j = await res.json();
      if (my !== token) return;
      const hit = j.results?.[0];
      if (!hit) {
        searchStatus.textContent = `Couldn’t find “${name}”. Try adding the country, as in “Hobart, Australia”.`;
        return;
      }
      const region = [hit.admin1, hit.country].filter(Boolean).join(', ');
      await fromLive(
        { name: hit.name, region, english: hit.country_code === 'US' ? 'us' : 'gb' },
        hit.latitude,
        hit.longitude,
      );
    } catch {
      if (my === token)
        searchStatus.textContent = 'The place search didn’t answer. Try again in a moment, or pick a town above.';
    }
  });

  hereButton.addEventListener('click', () => {
    if (busy || !('geolocation' in navigator)) {
      searchStatus.textContent = 'Your browser can’t say where you are.';
      return;
    }
    searchStatus.textContent = 'Asking your browser where you are…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        const english = navigator.language === 'en-US' ? 'us' : 'gb';
        void fromLive(
          { name: 'Where you are', region: `${fmtDeg(lat, 'N', 'S')}, ${fmtDeg(lon, 'E', 'W')}`, english },
          lat,
          lon,
        );
      },
      () => {
        searchStatus.textContent = 'No location came back. Search for your town instead.';
      },
      { timeout: 15000, maximumAge: 600000 },
    );
  });

  resume.addEventListener('click', () => {
    const saved = load();
    if (!saved) return;
    const p = saved.snapshot ? PLACES.find((x) => x.id === saved.snapshot) : null;
    if (p) void fromSnapshot(p, saved.log);
    else if (saved.town) void fromLive(saved.where, saved.lat, saved.lon, unpack(saved.town) as Compact, saved.log);
  });

  // ---- Playing ---------------------------------------------------------------------------

  function command(raw: string, shown = raw): void {
    if (!session) return;
    const text = raw.trim();
    add('p', 'oe-echo', `> ${shown.trim()}`);
    if (text) {
      history.push(text);
      historyAt = history.length;
    }
    const out = run(session.game, text);
    const ui = out.find((b) => b.k === 'ui');
    if (ui && ui.k === 'ui' && ui.action === 'restart') {
      const s = session;
      forget();
      begin({
        key: s.key,
        where: s.where,
        lat: s.lat,
        lon: s.lon,
        begin: s.begin,
        snapshot: s.snapshot,
        compact: s.compact,
        town: s.town,
        sky: s.sky,
      });
      return;
    }
    if (ui && ui.k === 'ui' && ui.action === 'elsewhere') {
      showChooser();
      return;
    }
    render(out);
    if (text && session.log.length < MAX_LOG) session.log.push(text);
    refresh();
    save(session);
    scrollDown();
  }

  prompt.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = '';
    command(v);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && history.length) {
      historyAt = Math.max(0, historyAt - 1);
      input.value = history[historyAt];
      e.preventDefault();
    } else if (e.key === 'ArrowDown' && history.length) {
      historyAt = Math.min(history.length, historyAt + 1);
      input.value = history[historyAt] ?? '';
      e.preventDefault();
    }
  });

  log.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.oe-exits button');
    if (!b || b.disabled || !b.dataset.cmd) return;
    command(b.dataset.cmd, b.dataset.say ?? b.dataset.cmd);
    if (fine.matches) input.focus({ preventScroll: true });
  });

  mapToggle.addEventListener('click', () => {
    const open = root.classList.toggle('map-open');
    mapToggle.setAttribute('aria-expanded', String(open));
    if (session) map.update(session.game);
  });

  pad.addEventListener('click', () => {
    if (fine.matches) input.focus({ preventScroll: true });
  });

  showChooser();
}
