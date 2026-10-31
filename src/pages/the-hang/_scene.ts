// The wall and what hangs on it, in centimetres from the floor at the wall's left end (y up).

import type { Work } from './_works';

export const WALL = { w: 1600, h: 540 };
/** The centre line most museums hang to: 145 cm, about 57 inches, from the floor. */
export const CL = 145;
/** The lowest a frame's bottom edge snaps to, for works too tall for the centre line: clear of a bench seat. */
export const LOW = 50;
export const DOOR = { x: 70, w: 160, h: 300 };
export const BENCH = { w: 180, h: 46 };

export interface Hung {
  id: number;
  /** Centre of the outer box, cm. */
  x: number;
  y: number;
}

export type Light = 'spots' | 'wash' | 'torch';

export interface Scene {
  title: string;
  paint: string;
  light: Light;
  /** The visitor standing in the room, by the x of their feet. */
  person: number;
  bench: number;
  items: Hung[];
}

export const PAINTS: { id: string; label: string; rgb: [number, number, number] }[] = [
  { id: 'white', label: 'Gallery white', rgb: [236, 233, 226] },
  { id: 'stone', label: 'Stone', rgb: [201, 194, 182] },
  { id: 'red', label: 'Salon red', rgb: [122, 46, 42] },
  { id: 'green', label: 'Library green', rgb: [62, 86, 72] },
  { id: 'blue', label: 'Slate blue', rgb: [60, 75, 96] },
  { id: 'black', label: 'Charcoal', rgb: [44, 43, 42] },
];

export function paintOf(id: string) {
  return PAINTS.find((p) => p.id === id) ?? PAINTS[0];
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function boxOf(item: Hung, work: Work): Box {
  return {
    x0: item.x - work.mount.w / 2,
    x1: item.x + work.mount.w / 2,
    y0: item.y - work.mount.h / 2,
    y1: item.y + work.mount.h / 2,
  };
}

const overlaps = (a: Box, b: Box, pad: number) =>
  a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

/** The centre height a work sits at on the line: centred at 145, or raised so its bottom stays 40 cm up. */
export function lineY(work: Work): number {
  return Math.max(CL, LOW + work.mount.h / 2);
}

/** Keeps a work on the wall: inside its ends, under the ceiling, off the floor, and out of the doorway. */
export function clampItem(x: number, y: number, work: Work): { x: number; y: number } {
  const hw = work.mount.w / 2;
  const hh = work.mount.h / 2;
  let cx = Math.min(WALL.w - hw - 4, Math.max(hw + 4, x));
  const cy = Math.min(WALL.h - hh - 12, Math.max(hh + 4, y));
  const doorR = DOOR.x + DOOR.w + 6;
  if (cy - hh < DOOR.h + 6 && cx - hw < doorR && cx + hw > DOOR.x - 6) {
    cx = cx < DOOR.x + DOOR.w / 2 && DOOR.x - 6 - hw >= hw + 4 ? DOOR.x - 6 - hw : doorR + hw;
  }
  return { x: cx, y: Math.min(WALL.h - hh - 12, Math.max(hh + 4, cy)) };
}

export interface Guide {
  /** 'x' guides are vertical lines at x; 'y' guides horizontal at y. */
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
  label?: string;
}

/**
 * Snaps a dragged work to the centre line, the low line, its neighbours' edges and centres, and the point
 * halfway between its neighbours. `tol` is the snapping distance in cm.
 */
export function snap(
  id: number,
  work: Work,
  x: number,
  y: number,
  scene: Scene,
  works: Map<number, Work>,
  tol: number,
): { x: number; y: number; guides: Guide[] } {
  const hw = work.mount.w / 2;
  const hh = work.mount.h / 2;
  const others = scene.items
    .filter((i) => i.id !== id && works.has(i.id))
    .map((i) => ({ item: i, box: boxOf(i, works.get(i.id)!) }));
  const guides: Guide[] = [];

  // Vertical position: centre line, low line, neighbours' centres, tops, and bottoms.
  let bestY: { d: number; y: number; g: Guide } | null = null;
  const tryY = (target: number, g: Guide) => {
    const d = Math.abs(target - y);
    if (d <= tol && (!bestY || d < bestY.d)) bestY = { d, y: target, g };
  };
  tryY(CL, { axis: 'y', at: CL, from: 0, to: WALL.w, label: 'CL 145' });
  tryY(LOW + hh, { axis: 'y', at: LOW, from: 0, to: WALL.w, label: `+${LOW}` });
  for (const { item, box } of others) {
    tryY(item.y, { axis: 'y', at: item.y, from: Math.min(box.x0, x - hw), to: Math.max(box.x1, x + hw) });
    tryY(box.y1 - hh, { axis: 'y', at: box.y1, from: Math.min(box.x0, x - hw), to: Math.max(box.x1, x + hw) });
    tryY(box.y0 + hh, { axis: 'y', at: box.y0, from: Math.min(box.x0, x - hw), to: Math.max(box.x1, x + hw) });
  }

  // Horizontal: neighbours' centres and edges, the wall's middle, and halfway between the nearest neighbours.
  let bestX: { d: number; x: number; g: Guide } | null = null;
  const tryX = (target: number, g: Guide) => {
    const d = Math.abs(target - x);
    if (d <= tol && (!bestX || d < bestX.d)) bestX = { d, x: target, g };
  };
  tryX(WALL.w / 2, { axis: 'x', at: WALL.w / 2, from: 0, to: WALL.h });
  for (const { item, box } of others) {
    const span = { from: Math.min(box.y0, y - hh), to: Math.max(box.y1, y + hh) };
    tryX(item.x, { axis: 'x', at: item.x, ...span });
    tryX(box.x0 + hw, { axis: 'x', at: box.x0, ...span });
    tryX(box.x1 - hw, { axis: 'x', at: box.x1, ...span });
  }
  const row = others.filter(({ box }) => box.y0 < y + hh && box.y1 > y - hh);
  const left = row.filter(({ box }) => box.x1 <= x).sort((a, b) => b.box.x1 - a.box.x1)[0];
  const right = row.filter(({ box }) => box.x0 >= x).sort((a, b) => a.box.x0 - b.box.x0)[0];
  if (left && right) {
    const mid = (left.box.x1 + right.box.x0) / 2;
    tryX(mid, { axis: 'x', at: mid, from: y - hh - 20, to: y + hh + 20, label: 'equal' });
  }

  const out = { x: bestX ? (bestX as { x: number }).x : x, y: bestY ? (bestY as { y: number }).y : y, guides };
  if (bestX) guides.push((bestX as { g: Guide }).g);
  if (bestY) guides.push((bestY as { g: Guide }).g);
  return out;
}

/**
 * A free place for a new work near `near`: on the line first, then above or below it salon-style, keeping a
 * clear space around neighbours. Falls back to `near` itself.
 */
export function placeFor(work: Work, scene: Scene, works: Map<number, Work>, near: number): { x: number; y: number } {
  const boxes = scene.items.filter((i) => works.has(i.id)).map((i) => boxOf(i, works.get(i.id)!));
  const hw = work.mount.w / 2;
  const hh = work.mount.h / 2;
  const gap = Math.min(60, Math.max(20, Math.max(work.mount.w, work.mount.h) * 0.4));
  const fits = (x: number, y: number) => {
    const c = clampItem(x, y, work);
    if (Math.abs(c.x - x) > 0.5 || Math.abs(c.y - y) > 0.5) return false;
    const b = { x0: x - hw, x1: x + hw, y0: y - hh, y1: y + hh };
    return boxes.every((o) => !overlaps(b, o, gap));
  };
  const rows = [lineY(work)];
  for (let k = 1; k <= 8; k++) rows.push(lineY(work) + k * 30, lineY(work) - k * 20);
  for (const y of rows) {
    let best: number | null = null;
    for (let x = hw + 4; x <= WALL.w - hw - 4; x += 5) {
      if (fits(x, y) && (best === null || Math.abs(x - near) < Math.abs(best - near))) best = x;
    }
    if (best !== null) return { x: best, y };
  }
  return clampItem(near, lineY(work), work);
}

// Share links: "#h=" then the title, paint, light, person, bench, and each work as id.x.y, joined with "~".

export function encode(scene: Scene): string {
  const items = scene.items.map((i) => `${i.id}.${Math.round(i.x)}.${Math.round(i.y)}`).join('_');
  return [
    encodeURIComponent(scene.title).replace(/~/g, '%7E'),
    scene.paint,
    scene.light,
    Math.round(scene.person),
    Math.round(scene.bench),
    items,
  ].join('~');
}

export function decode(text: string): Scene | null {
  const parts = text.split('~');
  if (parts.length !== 6) return null;
  const [title, paint, light, person, bench, items] = parts;
  let name = '';
  try {
    name = decodeURIComponent(title).slice(0, 80);
  } catch {
    return null;
  }
  const hung: Hung[] = [];
  for (const it of items ? items.split('_') : []) {
    const [id, x, y] = it.split('.').map(Number);
    if (Number.isInteger(id) && id > 0 && Number.isFinite(x) && Number.isFinite(y)) hung.push({ id, x, y });
  }
  return {
    title: name,
    paint: PAINTS.some((p) => p.id === paint) ? paint : 'white',
    light: light === 'wash' || light === 'torch' ? light : 'spots',
    person: Number.isFinite(Number(person)) ? Number(person) : 1000,
    bench: Number.isFinite(Number(bench)) ? Number(bench) : 900,
    items: hung.slice(0, 80),
  };
}

/** The show the room opens with. */
export const OPENING: Scene = {
  title: 'Opening hang',
  paint: 'white',
  light: 'spots',
  person: 1085,
  bench: 900,
  items: [
    { id: 111442, x: 380, y: 145 },
    { id: 80607, x: 506, y: 145 },
    { id: 28560, x: 642, y: 145 },
    { id: 20684, x: 900, y: 171 },
    { id: 64818, x: 1160, y: 145 },
    { id: 24645, x: 1306, y: 170 },
    { id: 69816, x: 1306, y: 105 },
    { id: 11659, x: 1373, y: 145 },
    { id: 29230, x: 1450, y: 145 },
  ],
};
