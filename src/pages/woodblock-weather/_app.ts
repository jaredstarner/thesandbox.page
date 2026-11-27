// Wires the page together: the place, the forecast, the press, and the week strip.

import { Finish } from './_finish';
import { Press } from './_press';
import { IH, IW, MARGIN, SH, SW, localParts, makeCond, makePlate, makeScene, setFont } from './_scene';
import type { Block, Plate, Scene } from './_scene';
import stored from './_stored.json';
import { Strip } from './_strip';
import {
  compass,
  describe,
  fetchForecast,
  guessPlace,
  parseForecast,
  searchPlaces,
  type FoundPlace,
  type Forecast,
  type Hour,
  type Place,
} from './_weather';

const STORE = 'woodblock-weather:place';
const STORED_PLACE: Place = { name: 'Bergen', where: 'Vestland, Norway', lat: 60.393, lon: 5.324 };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function imperial(): boolean {
  try {
    const loc = new Intl.Locale(navigator.language || 'en');
    const region = loc.maximize().region;
    return region === 'US' || region === 'LR' || region === 'MM';
  } catch {
    return false;
  }
}

const clock = (h: number) => (h === 0 ? 'midnight' : h === 12 ? 'noon' : `${h % 12} ${h < 12 ? 'a.m.' : 'p.m.'}`);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function start(root: HTMLElement): void {
  const sheet = root.querySelector<HTMLElement>('.sheet')!;
  const printCanvas = root.querySelector<HTMLCanvasElement>('.print')!;
  const finishCanvas = root.querySelector<HTMLCanvasElement>('.finish')!;
  const input = root.querySelector<HTMLInputElement>('#wbw-place')!;
  const suggest = root.querySelector<HTMLUListElement>('.suggest')!;
  const reading = root.querySelector<HTMLElement>('.reading')!;
  const list = root.querySelector<HTMLOListElement>('.block-list')!;
  const toNow = root.querySelector<HTMLButtonElement>('.to-now')!;
  const strip = new Strip(root.querySelector<HTMLElement>('.strip')!);
  const press = new Press(printCanvas, 20261127);
  const finish = new Finish(finishCanvas);
  const usUnits = imperial();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const family = getComputedStyle(root).getPropertyValue('--font-wbw').trim() || 'Georgia, serif';
  setFont(family);

  let forecast: Forecast | null = null;
  let scene: Scene | null = null;
  let plate: Plate | null = null;
  let place: Place = STORED_PLACE;
  let index = 0;
  let nowIndex = -1;
  let proof: string | null = null;
  let pulling = 0;
  let loadId = 0;

  // Sizing: the press works at the sheet's device pixels, up to a limit.
  const size = (): boolean => {
    const r = sheet.getBoundingClientRect();
    if (!r.width) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.min(1500, Math.round(r.width * dpr));
    const h = Math.round((w * SH) / SW);
    const changed = press.setSize(w, h);
    if (changed) finish.setSize(w, h, press.scale);
    return changed;
  };

  // The animation loop runs only while something on the sheet moves.
  let raf = 0;
  let last = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    finish.draw(now, dt);
    raf = finish.busy && !document.hidden ? requestAnimationFrame(tick) : 0;
    if (!raf) last = 0;
  };
  const wake = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) wake();
  });

  const tempText = (c: number) => (usUnits ? `${Math.round((c * 9) / 5 + 32)} °F` : `${Math.round(c)} °C`);
  const windText = (kmh: number) => (usUnits ? `${Math.round(kmh / 1.609)} mph` : `${Math.round(kmh)} km/h`);

  const whenText = (i: number, long = false) => {
    if (!forecast) return '';
    const h = forecast.hours[i];
    const p = localParts(h.t, forecast.utcOffset);
    const day = long ? DAYS_LONG[p.weekday] : DAYS[p.weekday];
    return `${day} ${p.day} ${MONTHS[p.month]}, ${clock(p.hour)}`;
  };
  strip.short = (i) => {
    if (!forecast) return '';
    const p = localParts(forecast.hours[i].t, forecast.utcOffset);
    return `${DAYS[p.weekday]} ${clock(p.hour)}`;
  };
  strip.describe = (i) => {
    if (!forecast) return '';
    const h = forecast.hours[i];
    return `${whenText(i, true)}: ${describe(h.code).words.toLowerCase()}, ${tempText(h.temp)}`;
  };

  const placeLabel = () => place.name;

  const readingFor = (i: number) => {
    if (!forecast) return;
    const h = forecast.hours[i];
    const k = describe(h.code);
    const when = whenText(i, true);
    const bits = [
      `<b>${escapeHtml(when)}</b>${when.endsWith('.') ? '' : '.'}`,
      `${escapeHtml(k.words)}, ${tempText(h.temp)}.`,
      h.wind >= 2 ? `Wind ${windText(h.wind)} from the ${compass(h.windFrom)}.` : 'Still air.',
      `${Math.round(h.cloud)}% cloud.`,
    ];
    if (h.snowDepth >= 0.01)
      bits.push(`Snow lying ${usUnits ? `${Math.round(h.snowDepth * 39.37)} in` : `${Math.round(h.snowDepth * 100)} cm`}.`);
    let lead = '';
    if (forecast.stored)
      lead = `<span class="stored">The weather service didn’t answer, so this is a week kept from Bergen in late November 2026.</span> `;
    else if (i < nowIndex) lead = 'Earlier: ';
    else if (i > nowIndex) lead = 'Forecast: ';
    reading.innerHTML = lead + bits.join(' ');
  };

  // The block list: each block as carved wood, inked where it prints, mirrored as the wood is.
  const thumbs = new Map<string, HTMLCanvasElement>();
  const drawThumb = (cv: HTMLCanvasElement, b: Block) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(40, Math.round((cv.clientWidth || 80) * dpr));
    const h = Math.round(w * 1.5);
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d')!;
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#c9a57c');
    g.addColorStop(1, '#b48d63');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(90, 60, 30, 0.22)';
    c.lineWidth = Math.max(0.5, w / 160);
    for (let y = 3; y < h; y += 4 + ((y * 13) % 5)) {
      c.beginPath();
      c.moveTo(0, y);
      c.bezierCurveTo(w * 0.3, y + 2, w * 0.6, y - 2, w, y + 1);
      c.stroke();
    }
    const s = w / IW;
    const inked: Block =
      b.mode === 'blind'
        ? { ...b, pigment: 'rgba(250, 230, 200, 0.9)' }
        : b.mode === 'white'
          ? { ...b, pigment: '#fbf8f0' }
          : b;
    press.carveInto(c, inked, s, w, (h - IH * s) / 2, true);
  };
  const buildList = (p: Plate) => {
    const ids = p.blocks.map((b) => b.id).join();
    if (list.dataset.ids !== ids) {
      list.dataset.ids = ids;
      list.textContent = '';
      thumbs.clear();
      for (const b of p.blocks) {
        const li = document.createElement('li');
        li.dataset.id = b.id;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-pressed', 'false');
        const cv = document.createElement('canvas');
        cv.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        const sw = document.createElement('i');
        sw.className = 'swatch';
        name.append(sw, document.createTextNode(b.name));
        btn.append(cv, name);
        li.append(btn);
        list.append(li);
        thumbs.set(b.id, cv);
        btn.addEventListener('click', () => setProof(proof === b.id ? null : b.id));
      }
    }
    for (const b of p.blocks) {
      const li = list.querySelector<HTMLLIElement>(`li[data-id="${b.id}"]`);
      if (!li) continue;
      const sw = li.querySelector<HTMLElement>('.swatch')!;
      sw.style.background = b.mode === 'blind' ? 'transparent' : b.pigment;
      sw.style.boxShadow = b.mode === 'blind' || b.mode === 'white' ? 'inset 0 0 0 1px #8a8273' : 'none';
      li.querySelector('span')!.lastChild!.textContent = b.name;
      drawThumb(thumbs.get(b.id)!, b);
    }
    markList(-1);
  };
  const markList = (current: number) => {
    list.querySelectorAll<HTMLLIElement>('li').forEach((li, i) => {
      li.toggleAttribute('data-pending', current >= 0 && i > current);
      li.toggleAttribute('data-current', i === current);
      li.querySelector('button')!.setAttribute('aria-pressed', String(proof === li.dataset.id));
    });
  };

  const setProof = (id: string | null) => {
    proof = id;
    pulling++;
    markList(-1);
    if (plate) {
      press.render(plate, proof ?? undefined);
      finish.setPlate(proof && proof !== 'blind' && proof !== 'mica' ? null : plate, press.relief, still);
      wake();
    }
  };

  const describePrint = (p: Plate) => {
    printCanvas.setAttribute(
      'aria-label',
      `A woodblock print titled “${p.title}, ${placeLabel()}”: ${scene?.sea ? 'the sea' : 'a lake'} under the sky, hills beyond, houses and a tree on the near shore, and someone walking down the path.`,
    );
  };

  const show = (i: number, mode: 'pull' | 'render') => {
    if (!forecast || !scene) return;
    index = i;
    const cond = makeCond(forecast, forecast.hours[i]);
    plate = makePlate(scene, cond, placeLabel());
    readingFor(i);
    describePrint(plate);
    buildList(plate);
    toNow.hidden = nowIndex < 0 || i === nowIndex;
    const token = ++pulling;
    if (mode === 'pull' && !still) {
      finish.setPlate(null, null, still);
      finish.draw(performance.now(), 0);
      root.dataset.state = 'printing';
      const p = plate;
      void press
        .pull(p, {
          onBlock: (k) => markList(k),
          isCancelled: () => token !== pulling,
        })
        .then((done) => {
          if (!done) return;
          markList(-1);
          root.dataset.state = 'ready';
          finish.setPlate(p, press.relief, still);
          wake();
        });
    } else {
      press.render(plate, proof ?? undefined);
      root.dataset.state = 'ready';
      finish.setPlate(plate, press.relief, still);
      wake();
    }
  };

  strip.onPick = (i, settled) => {
    if (proof) {
      proof = null;
    }
    if (settled || i !== index) show(i, 'render');
  };

  toNow.addEventListener('click', () => {
    if (nowIndex < 0) return;
    strip.set(nowIndex);
    show(nowIndex, 'render');
  });

  const findNow = (f: Forecast) => {
    const t = Date.now();
    const i = f.hours.findIndex((h) => t >= h.t && t < h.t + 3600000);
    if (i >= 0) return i;
    // The stored week: the same hour of the day, on its second day.
    const local = localParts(t, f.utcOffset).hour;
    const j = f.hours.findIndex((h, k) => k >= 24 && localParts(h.t, f.utcOffset).hour === local);
    return j >= 0 ? j : 24;
  };

  const load = async (p: Place, mode: 'pull' | 'render') => {
    const id = ++loadId;
    place = p;
    input.value = p.name;
    reading.textContent = `Finding the weather for ${p.name}…`;
    let f: Forecast;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 9000);
    try {
      f = await fetchForecast(p, ctl.signal);
    } catch {
      f = { ...parseForecast(STORED_PLACE, stored), stored: true };
      place = STORED_PLACE;
      input.value = STORED_PLACE.name;
    } finally {
      clearTimeout(timer);
    }
    if (id !== loadId) return;
    forecast = f;
    scene = makeScene(`${place.lat.toFixed(2)},${place.lon.toFixed(2)}`, f.elevation);
    nowIndex = f.stored ? -1 : findNow(f);
    index = f.stored ? findNow(f) : nowIndex;
    strip.setForecast(f, nowIndex);
    strip.set(index);
    proof = null;
    show(index, mode);
  };

  // Place search, through Open-Meteo's geocoder.
  let found: FoundPlace[] = [];
  let active = -1;
  let searchTimer = 0;
  let searchCtl: AbortController | null = null;
  const closeSuggest = () => {
    suggest.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const renderSuggest = () => {
    suggest.textContent = '';
    found.forEach((p, i) => {
      const li = document.createElement('li');
      li.id = `wbw-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      const b = document.createElement('b');
      b.textContent = p.name;
      li.append(b);
      if (p.where) li.append(document.createTextNode(`, ${p.where}`));
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        choose(p);
      });
      suggest.append(li);
    });
    suggest.hidden = found.length === 0;
    input.setAttribute('aria-expanded', String(found.length > 0));
    if (active >= 0) input.setAttribute('aria-activedescendant', `wbw-opt-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const choose = (p: FoundPlace) => {
    closeSuggest();
    const chosen: Place = { name: p.name, where: p.where, lat: p.lat, lon: p.lon };
    try {
      localStorage.setItem(STORE, JSON.stringify(chosen));
    } catch {
      // Private windows can refuse storage; the choice still holds for this visit.
    }
    input.blur();
    void load(chosen, 'pull');
  };
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      found = [];
      renderSuggest();
      return;
    }
    searchTimer = window.setTimeout(async () => {
      searchCtl?.abort();
      searchCtl = new AbortController();
      try {
        found = await searchPlaces(q, searchCtl.signal);
        active = found.length ? 0 : -1;
        renderSuggest();
      } catch {
        // A failed or superseded search leaves the list as it was.
      }
    }, 220);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!found.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
      renderSuggest();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const p = found[active >= 0 ? active : 0];
      if (p) choose(p);
    } else if (e.key === 'Escape') {
      closeSuggest();
      input.value = place.name;
    }
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', () => {
    setTimeout(() => {
      closeSuggest();
      if (document.activeElement !== input) input.value = place.name;
    }, 120);
  });
  root.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = found[active >= 0 ? active : 0];
    if (p) choose(p);
  });

  // The lamp follows the pointer over the sheet.
  const aimAt = (e: PointerEvent) => {
    const r = sheet.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * SW - MARGIN;
    const y = ((e.clientY - r.top) / r.height) * SH - MARGIN;
    finish.aim(x, y);
    const rr = root.getBoundingClientRect();
    root.style.setProperty('--lx', `${(((e.clientX - rr.left) / rr.width) * 100).toFixed(1)}%`);
    root.style.setProperty('--ly', `${(((e.clientY - rr.top) / rr.height) * 100).toFixed(1)}%`);
    wake();
  };
  sheet.addEventListener('pointermove', aimAt);
  sheet.addEventListener('pointerdown', aimAt);
  sheet.addEventListener('pointerleave', () => {
    finish.aim(null);
    wake();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && proof) setProof(null);
  });

  // Keep up with the clock: move to each new hour, and fetch again every half hour.
  setInterval(() => {
    if (!forecast || forecast.stored) return;
    const i = findNow(forecast);
    if (i !== nowIndex) {
      const following = index === nowIndex;
      nowIndex = i;
      strip.setNow(i);
      if (following) {
        strip.set(i);
        show(i, 'render');
      }
    }
  }, 30000);
  setInterval(
    () => {
      if (!document.hidden && forecast && !forecast.stored && index === nowIndex) void load(place, 'render');
    },
    30 * 60 * 1000,
  );

  // Resize: the press is re-laid at the new size and the print taken again.
  let resizeTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (size() && plate && root.dataset.state !== 'printing') {
        press.render(plate, proof ?? undefined);
        finish.setPlate(plate, press.relief, still);
        wake();
      }
      strip.draw();
      if (plate) for (const b of plate.blocks) drawThumb(thumbs.get(b.id)!, b);
    }, 120);
  }).observe(root);

  const begin = async () => {
    size();
    press.blank();
    try {
      await Promise.all([document.fonts.load(`700 33px ${family}`), document.fonts.load(`400 25px ${family}`)]);
    } catch {
      // The fallback serif letters the cartouche instead.
    }
    let p: Place | null = null;
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const v = JSON.parse(raw) as Place;
        if (typeof v.lat === 'number' && typeof v.lon === 'number' && typeof v.name === 'string') p = v;
      }
    } catch {
      p = null;
    }
    if (!p) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      try {
        p = await guessPlace(ctl.signal);
      } catch {
        p = null;
      } finally {
        clearTimeout(timer);
      }
    }
    await load(p ?? STORED_PLACE, 'pull');
  };
  void begin();

  // A handle for checking the print without the network (?debug).
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as Record<string, unknown>).wbw = {
      press,
      finish,
      get forecast() {
        return forecast;
      },
      get plate() {
        return plate;
      },
      show: (i: number) => {
        strip.set(i);
        show(i, 'render');
      },
      load: (p: Place) => load(p, 'render'),
      force: (patch: Partial<Hour>, key?: string, elevation = 100) => {
        if (!forecast || !scene) return null;
        if (key) scene = makeScene(key, elevation);
        const h = { ...forecast.hours[index], ...patch };
        plate = makePlate(scene, makeCond(forecast, h), placeLabel());
        press.render(plate, proof ?? undefined);
        finish.setPlate(plate, press.relief, still);
        buildList(plate);
        wake();
        return { title: plate.title, blocks: plate.blocks.map((b) => b.id), sea: scene.sea, pine: scene.tree.pine };
      },
      image: { IW, IH },
    };
  }
}
