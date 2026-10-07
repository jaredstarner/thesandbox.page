// The catch log: what this browser has landed, kept in localStorage. Species
// not yet caught show as silhouettes. Nothing here leaves the page.

import type { Fish } from './_fish';
import type { Sprite } from './_pixels';
import { BOOT_ID, BOOT_SPECIES, SPECIES, bootSprite, fishSprite, pixelLength, type Species } from './_species';

const STORE_KEY = 'fishing-hole:log';

export interface Entry {
  count: number;
  bestCm: number;
  bestKg: number;
}

export interface Log {
  total: number;
  species: Record<string, Entry>;
}

export function loadLog(): Log {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Log> | null;
    if (raw && typeof raw.total === 'number' && raw.species && typeof raw.species === 'object') {
      const species: Record<string, Entry> = {};
      for (const [id, e] of Object.entries(raw.species)) {
        if (e && typeof e.count === 'number' && typeof e.bestCm === 'number' && typeof e.bestKg === 'number') species[id] = e;
      }
      return { total: raw.total, species };
    }
  } catch {
    // Blocked or corrupt storage: start a fresh log for this visit.
  }
  return { total: 0, species: {} };
}

function save(log: Log): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(log));
  } catch {
    // The log still holds for this visit.
  }
}

/** Record a catch; says whether it was the first of its kind or a new best. */
export function record(log: Log, f: Fish): 'first' | 'best' | null {
  log.total += 1;
  const e = log.species[f.sp.id];
  let result: 'first' | 'best' | null = null;
  if (!e) {
    log.species[f.sp.id] = { count: 1, bestCm: f.cm, bestKg: f.kg };
    result = 'first';
  } else {
    e.count += 1;
    if (f.cm > e.bestCm) {
      e.bestCm = f.cm;
      e.bestKg = f.kg;
      result = 'best';
    }
  }
  save(log);
  return result;
}

/** Inches and pounds-and-ounces, then centimeters and kilograms. */
export function sizeText(cm: number, kg: number): [string, string] {
  const inches = (cm / 2.54).toFixed(1);
  let lb = Math.floor(kg * 2.20462);
  let oz = Math.round((kg * 2.20462 - lb) * 16);
  if (oz === 16) {
    lb += 1;
    oz = 0;
  }
  const weight = lb === 0 ? `${oz} oz` : `${lb} lb ${oz} oz`;
  return [`${inches} in · ${weight}`, `${cm.toFixed(1)} cm · ${kg.toFixed(2)} kg`];
}

/** Paint a sprite into a small canvas, one canvas pixel per sprite pixel. */
export function paintSprite(canvas: HTMLCanvasElement, s: Sprite): void {
  canvas.width = s.w + 2;
  canvas.height = s.h + 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(s.w, s.h);
  new Uint32Array(img.data.buffer).set(s.px);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(img, 1, 1);
}

export function spriteOf(f: Fish): Sprite {
  return f.sp.id === BOOT_ID ? bootSprite() : fishSprite(f.sp, f.px, 0);
}

function rowSprite(sp: Species, caught: boolean): Sprite {
  if (sp.id === BOOT_ID) return bootSprite(!caught);
  return fishSprite(sp, pixelLength((sp.minCm + sp.maxCm) / 2), 0, !caught);
}

export function renderLog(list: HTMLElement, log: Log): void {
  const rows = [...SPECIES, BOOT_SPECIES].map((sp) => {
    const e = log.species[sp.id];
    const li = document.createElement('li');
    if (!e) li.className = 'unknown';
    const pic = document.createElement('canvas');
    pic.setAttribute('aria-hidden', 'true');
    paintSprite(pic, rowSprite(sp, Boolean(e)));
    const text = document.createElement('div');
    text.textContent = e ? sp.name : '???';
    const best = document.createElement('span');
    best.className = 'best';
    if (e) best.textContent = sp.id === BOOT_ID ? 'Size 10' : `Best ${sizeText(e.bestCm, e.bestKg)[0]}`;
    else best.textContent = 'Not caught yet';
    text.append(best);
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = e ? `×${e.count}` : '';
    li.append(pic, text, count);
    return li;
  });
  list.replaceChildren(...rows);
}
