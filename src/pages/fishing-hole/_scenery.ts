// The lake's furniture, drawn into the sprite layer each frame: trees, the
// dock and its lantern, weed beds that sway, the sunken log, rocks, a lost
// boot, and the far shore's reeds. All of it is drawn here in code.

import { Layer, rgb, sprite, type Sprite } from './_pixels';
import {
  DECK_Y,
  DOCK_X0,
  DOCK_X1,
  LOG,
  PILINGS,
  REEDS,
  ROCKS,
  TREES,
  WEEDS,
  bedAt,
  rng,
  type Tree,
} from './_world';

const PLANK = rgb(0x9a6538);
const PLANK_TOP = rgb(0xbb8350);
const PLANK_GAP = rgb(0x6b4224);
const PLANK_UNDER = rgb(0x4e301b);
const PILE = rgb(0x5d3c24);
const PILE_LIT = rgb(0x7a5232);
const WEED = [rgb(0x3f7d3a), rgb(0x55a048), rgb(0x2e6a3d)];
const WEED_TIP = rgb(0x8cc760);
const BARK = rgb(0x5a3a25);
const BARK_LIT = rgb(0x7a5333);
const BARK_DARK = rgb(0x3f2819);
const GRAIN = rgb(0xc89c66);
const MOSS = rgb(0x5f8a3c);
const ROCK = rgb(0x6c7480);
const ROCK_LIT = rgb(0x9098a3);
const ROCK_DARK = rgb(0x4d535d);
const REED = rgb(0x6d9a40);
const REED_DARK = rgb(0x4f7a2f);
const CATTAIL = rgb(0x6e4024);
const POST = rgb(0x4a3020);
const LANTERN_FRAME = rgb(0x2b2b33);
const LANTERN_GLASS = rgb(0xf1d48a);
const LANTERN_DARK = rgb(0x8a7d62);

const TACKLE: Sprite = sprite(['.hhh.', 'ggggg', 'gGggg', 'ggggg'], { h: 0x2c3a2c, g: 0x3f7a4a, G: 0xd6c25a });

function treeSprite(t: Tree, seed: number): Sprite {
  const rand = rng(seed);
  const w = t.kind === 'pine' ? Math.round(t.height * 0.55) | 1 : Math.round(t.height * 0.8) | 1;
  const h = t.height;
  const rows: string[] = [];
  const mid = (w - 1) / 2;
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x - mid);
      let c = '.';
      if (t.kind === 'pine') {
        const trunk = y >= h - 4;
        // Stacked tiers, each wider toward its base.
        const tier = (y % 6) / 6;
        const reach = ((y + 2) / h) * mid * (0.6 + tier * 0.5);
        if (!trunk && dx <= reach) c = x < mid - reach * 0.3 ? 'D' : rand() < 0.12 ? 'L' : 'G';
        if (trunk && dx < 1) c = 'T';
      } else {
        const crown = h * 0.68;
        const cy = crown * 0.52;
        const r = crown * 0.5;
        const d = Math.hypot(dx * 0.95, y - cy);
        if (y < crown && d <= r + (rand() - 0.5) * 1.2) c = y > cy + r * 0.35 || x < mid - r * 0.4 ? 'D' : rand() < 0.15 ? 'L' : 'G';
        if (y >= crown - 2 && dx < 1) c = 'T';
      }
      row += c;
    }
    rows.push(row);
  }
  return sprite(rows, { G: 0x3d6e3a, D: 0x2b5130, L: 0x5d8f45, T: 0x5a3c26 });
}

const TREE_SPRITES = TREES.map((t, i) => ({ t, s: treeSprite(t, 100 + i) }));

export interface SceneryState {
  time: number;
  wind: number;
  night: number;
}

/** Things behind the angler and the water: trees and the far shore's reeds. */
export function drawBack(layer: Layer, s: SceneryState): void {
  for (const { t, s: spr } of TREE_SPRITES) {
    const ground = bedAt(t.x + spr.w / 2);
    layer.blit(spr, t.x, ground - spr.h + 1);
  }
  for (const r of REEDS) {
    const base = bedAt(r.x);
    const top = -r.height;
    const sway = Math.sin(s.time * 1.2 + r.x * 0.7) * s.wind;
    for (let y = base; y >= top; y--) {
      const k = (base - y) / (base - top);
      layer.set(r.x + Math.round(sway * k * k * 1.4), y, y > 0 ? REED_DARK : REED);
    }
    if (r.cattail) {
      const x = r.x + Math.round(sway * 1.4);
      layer.rect(x, top + 1, 1, 3, CATTAIL);
    }
  }
}

/** The lake bed's furniture: weeds, the log, rocks, and the boot. */
export function drawBed(layer: Layer, s: SceneryState): void {
  for (const r of ROCKS) {
    const base = bedAt(r.x) + 1;
    for (let dy = 0; dy <= r.r; dy++) {
      const half = Math.round(Math.sqrt(r.r * r.r - dy * dy + r.r) * 1.25);
      for (let dx = -half; dx <= half; dx++) {
        const c = dy >= r.r - 1 && dx < half - 1 ? ROCK_LIT : dx >= half - 1 || dy === 0 ? ROCK_DARK : ROCK;
        layer.set(r.x + dx, base - dy, c);
      }
    }
  }

  // The log rests on the bed, tilted to follow it, with its cut end showing rings.
  const restL = bedAt(LOG.x0 + 3);
  const restR = bedAt(LOG.x1 - 3);
  for (let x = LOG.x0; x <= LOG.x1; x++) {
    const t = (x - LOG.x0) / (LOG.x1 - LOG.x0);
    const top = Math.round(restL + (restR - restL) * t) - 5;
    const end = x === LOG.x0 || x === LOG.x1;
    for (let y = end ? 1 : 0; y < (end ? 4 : 5); y++) {
      let c = y === 0 ? BARK_LIT : y === 4 ? BARK_DARK : (x * 7 + y * 5) % 9 === 0 ? BARK_DARK : BARK;
      if (x === LOG.x0) c = y === 2 ? BARK_DARK : GRAIN;
      if (y === 0 && (x * 13) % 7 < 2) c = MOSS;
      layer.set(x, top + y, c);
    }
  }
  // A broken branch reaching up from the log.
  const branchX = LOG.x0 + 19;
  const branchTop = Math.round(restL + (restR - restL) * (19 / (LOG.x1 - LOG.x0))) - 5;
  for (let i = 1; i <= 5; i++) layer.set(branchX + Math.round(i * 0.7), branchTop - i, i === 5 ? BARK_LIT : BARK);
  layer.set(branchX + 4, branchTop - 5, BARK);

  for (const w of WEEDS) {
    const base = bedAt(w.x);
    const col = WEED[w.tone];
    for (let j = 0; j < w.height; j++) {
      const k = j / w.height;
      const sway = Math.sin(w.phase + s.time * 1.1 + j * 0.22) * k * (1.2 + s.wind);
      layer.set(w.x + Math.round(sway), base - j, j === w.height - 1 ? WEED_TIP : col);
    }
  }
}

/** The dock, its pilings, the tackle box, and the lantern post. */
export function drawDock(layer: Layer, glow: Layer, s: SceneryState): void {
  for (const x of PILINGS) {
    const bottom = bedAt(x + 1) + 1;
    for (let y = DECK_Y + 2; y <= bottom; y++) {
      layer.set(x, y, PILE_LIT);
      layer.set(x + 1, y, PILE);
    }
  }
  for (let x = DOCK_X0; x <= DOCK_X1; x++) {
    const gap = (x - DOCK_X0) % 7 === 6;
    layer.set(x, DECK_Y, gap ? PLANK_GAP : PLANK_TOP);
    layer.set(x, DECK_Y + 1, gap ? PLANK_GAP : PLANK);
    layer.set(x, DECK_Y + 2, PLANK_UNDER);
  }
  layer.blit(TACKLE, 22, DECK_Y - 4);

  // The lantern hangs from a post partway down the dock, and is lit at night.
  const px = 34;
  for (let y = DECK_Y - 13; y < DECK_Y; y++) layer.set(px, y, POST);
  layer.set(px + 1, DECK_Y - 13, POST);
  layer.set(px + 2, DECK_Y - 13, POST);
  layer.set(px + 3, DECK_Y - 13, POST);
  const lx = px + 3;
  const ly = DECK_Y - 12;
  layer.set(lx, ly, LANTERN_FRAME);
  layer.rect(lx - 1, ly + 1, 3, 1, LANTERN_FRAME);
  const lit = s.night > 0.3;
  layer.rect(lx - 1, ly + 2, 3, 2, lit ? LANTERN_GLASS : LANTERN_DARK);
  layer.rect(lx - 1, ly + 4, 3, 1, LANTERN_FRAME);
  if (lit) {
    const flicker = 0.85 + 0.15 * Math.sin(s.time * 9.1) * Math.sin(s.time * 5.3 + 1);
    const k = s.night * flicker;
    glow.add(lx, ly + 2, 0xffc46a, k);
    glow.add(lx, ly + 3, 0xffb050, k);
    glow.add(lx - 1, ly + 2, 0xff9c40, k * 0.6);
    glow.add(lx + 1, ly + 3, 0xff9c40, k * 0.6);
  }
}

/** After dusk, fireflies drift and blink over both shores. */
export function drawFireflies(glow: Layer, s: SceneryState): void {
  if (s.night < 0.35) return;
  for (let i = 0; i < 10; i++) {
    const near = i < 6;
    const bx = near ? 4 + i * 10 : 432 + (i - 6) * 12;
    const by = near ? -14 - (i % 3) * 5 : -12 - (i % 2) * 6;
    const x = bx + Math.sin(s.time * 0.3 * (1 + i * 0.13) + i) * 7;
    const y = by + Math.sin(s.time * 0.45 + i * 2.1) * 4;
    const b = Math.sin(s.time * (0.9 + i * 0.17) + i * 5.3);
    if (b > 0.55) glow.add(x, y, 0xd6ff6a, ((b - 0.55) / 0.45) * s.night);
  }
}
