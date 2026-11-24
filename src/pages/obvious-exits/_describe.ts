// The prose: what you see where you stand, the ways out, and the walk between. Every sentence comes
// from the survey (street names and kinds, surfaces, squares, parks, water, and the shops at each
// stop) plus the light and weather of the afternoon, and is chosen the same way each visit.

import { lightAt, wetOf, type Light, type Sky, type Wet } from './_sky';
import { leaving, rankOf, streetsAt, type Edge, type Spot, type Stop, type Town } from './_town';
import { an, capital, count, list, say } from './_words';

export type Compass = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export const COMPASS: Compass[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
export const COMPASS_WORD: Record<Compass, string> = {
  n: 'north',
  ne: 'north-east',
  e: 'east',
  se: 'south-east',
  s: 'south',
  sw: 'south-west',
  w: 'west',
  nw: 'north-west',
};

export interface Exit {
  dir: Compass | null;
  edge: number;
  to: number;
  bearing: number;
  /** "along High Street", "on a footpath", "over the Rialto Bridge". */
  how: string;
  out: boolean;
}

/** The light and weather the prose is written under. */
export interface Weathering {
  clock: number;
  sky: Sky;
}

/** A small stable hash, so each stop reads the same every visit. */
export function hash(...xs: (number | string)[]): number {
  let h = 2166136261;
  for (const x of xs) {
    const s = String(x);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e37;
  }
  return h >>> 0;
}
const pick = <T>(xs: T[], h: number): T => xs[h % xs.length];

const sectorOf = (b: number) => Math.round(b / 45) % 8;

const exitCache = new WeakMap<Town, Map<number, Exit[]>>();

/** The ways out of a stop, each with its own compass point where the streets allow. */
export function exitsOf(town: Town, stop: number): Exit[] {
  let cache = exitCache.get(town);
  if (!cache) exitCache.set(town, (cache = new Map()));
  const hit = cache.get(stop);
  if (hit) return hit;
  const s = town.stops[stop];
  const raw = s.edges.map((id) => {
    const e = town.edges[id];
    const to = e.a === stop ? e.b : e.a;
    return { e, to, bearing: leaving(town, e, stop) };
  });
  // Most important ways claim their nearest compass point first; the rest take a neighbour.
  raw.sort((p, q) => rankOf(q.e.hw) - rankOf(p.e.hw) || q.e.len - p.e.len);
  const taken = new Map<number, number>();
  const out: Exit[] = [];
  for (const r of raw) {
    const want = sectorOf(r.bearing);
    let dir: number | null = null;
    for (const d of [0, 1, -1, 2, -2]) {
      const k = (want + d + 8) % 8;
      if (taken.has(k)) continue;
      const off = Math.abs(((r.bearing - k * 45 + 540) % 360) - 180);
      if (off <= 80) {
        dir = k;
        break;
      }
    }
    if (dir !== null) taken.set(dir, r.e.id);
    out.push({
      dir: dir === null ? null : COMPASS[dir],
      edge: r.e.id,
      to: r.to,
      bearing: r.bearing,
      how: howOf(town, r.e, s),
      out: town.stops[r.to].out,
    });
  }
  out.sort((p, q) => (p.dir ? COMPASS.indexOf(p.dir) : 9) - (q.dir ? COMPASS.indexOf(q.dir) : 9));
  cache.set(stop, out);
  return out;
}

function howOf(town: Town, e: Edge, s: Stop): string {
  if (e.bridge && e.bridgeName) return `over ${theName(e.bridgeName)}`;
  if (e.bridge && e.over) return `over the ${bare(e.over)}`;
  if (e.name) {
    if (s.square && e.hw === 'pedestrian' && !e.len) return `across ${e.name}`;
    return `${e.hw === 'steps' ? 'by' : 'along'} ${e.name}`;
  }
  if (e.tunnel) return 'through a covered passage';
  const area = s.area >= 0 ? town.areas[s.area] : null;
  switch (e.hw) {
    case 'steps':
      return 'by a flight of steps';
    case 'service':
      return 'down an alley';
    case 'track':
      return 'along a track';
    case 'cycleway':
      return 'on a cycle path';
    case 'pedestrian':
      return 'through a passage';
    case 'footway':
    case 'path':
    case 'bridleway':
      return area?.kind === 'park' || area?.kind === 'garden' || area?.kind === 'cemetery' ? 'on a path' : 'on a footpath';
    default:
      return 'along an unnamed street';
  }
}

/** "the Rialto Bridge" but "Ponte di Rialto" and "Town Bridge". */
function theName(n: string): string {
  return /^(the |ponte|pont |puente|town |high |old |new )/i.test(n) || !/bridge$/i.test(n) ? n : `the ${n}`;
}
const bare = (n: string) => n.replace(/^the /i, '');

const COBBLED = new Set(['sett', 'cobblestone', 'unhewn_cobblestone', 'cobblestone:flattened', 'paving_stones:cobblestone']);

interface Paint {
  light: Light;
  wet: Wet;
}

function paintOf(w: Weathering): Paint {
  return { light: lightAt(w.clock, w.sky.sunset), wet: wetOf(w.sky.weather) };
}

/** The main way through a stop. */
function mainEdge(town: Town, s: Stop): Edge {
  return s.edges.map((id) => town.edges[id]).sort((p, q) => rankOf(q.hw) - rankOf(p.hw) || q.len - p.len)[0];
}

function streetLine(town: Town, s: Stop, p: Paint, h: number): string {
  const e = mainEdge(town, s);
  const area = s.area >= 0 ? town.areas[s.area] : null;
  const n = e?.name ?? '';
  const pave = say('pavement', 'sidewalk');
  const kerb = say('kerb', 'curb');
  const dark = p.light === 'dark' || p.light === 'dusk';
  if (s.square) {
    return pick(
      [
        `${s.square} opens out around you, paved from wall to wall.`,
        `The way opens out here into ${s.square}, with buildings shoulder to shoulder all round.`,
        `You stand on the open paving of ${s.square}.`,
      ],
      h,
    );
  }
  if (area && (area.kind === 'park' || area.kind === 'garden') && !n) {
    const name = area.name ?? `the ${area.kind}`;
    return dark
      ? pick([`The lawns of ${name} have gone grey in the dusk.`, `${capital(name)} is nearly empty at this hour; paths lead off between dark shrubs.`], h)
      : pick([`Paths cross the lawns of ${name} under old trees.`, `You are in ${name}. Someone is walking a dog on the far side of the grass.`], h);
  }
  if (area?.kind === 'cemetery') {
    return pick([`Headstones lean among the yews of ${area.name ?? 'an old burial ground'}.`, `The path runs between rows of weathered gravestones.`], h);
  }
  const cobbles = e?.surface && COBBLED.has(e.surface) ? ' The street is cobbled.' : '';
  switch (e?.hw) {
    case 'pedestrian':
      return (
        (dark
          ? pick([`Shop windows still glow along ${n || 'this paved street'}, though the crowds have thinned.`, `${n || 'The street'} is closed to traffic, and at this hour your footsteps carry.`], h)
          : pick([`${n || 'This street'} is paved from wall to wall and given over to people on foot.`, `Shoppers drift along ${n || 'the street'}, which is closed to traffic.`], h)) + cobbles
      );
    case 'primary':
    case 'primary_link':
    case 'secondary':
    case 'secondary_link':
      return (
        pick(
          [
            `Traffic grinds along ${n || 'the main road'} in both directions${dark ? ', headlights on' : ''}.`,
            `Buses and vans crowd ${n || 'the road'}; you wait at the ${kerb} for a gap.`,
            `${n || 'The road'} is busy, the ${pave} narrow and crowded.`,
          ],
          h,
        ) + cobbles
      );
    case 'tertiary':
    case 'tertiary_link':
    case 'unclassified':
    case 'road':
      return pick([`${n || 'The street'} carries a steady trickle of cars.`, `A delivery van is parked half on the ${pave} along ${n || 'the street'}.`], h) + cobbles;
    case 'residential':
      return (
        pick(
          [
            `${n || 'The street'} is a quiet street of houses${say(', cars parked nose to tail', ', cars parked along both curbs')}.`,
            `Front doors open straight onto the ${pave} along ${n || 'this street'}.`,
            `${n || 'The street'} is residential and quiet; ${dark ? 'lights are on behind the curtains' : 'a cat watches you from a windowsill'}.`,
          ],
          h,
        ) + cobbles
      );
    case 'living_street':
      return `${n || 'This'} is a shared street with no ${kerb}s, where the few cars creep.${cobbles}`;
    case 'steps':
      return pick([`A flight of steps${n ? `, ${n},` : ''} worn hollow in the middle.`, `Steps${n ? ` (${n})` : ''} climb between high walls.`], h);
    case 'service':
      return pick([`${n || 'An alley'} barely wider than your shoulders runs between the buildings.`, `${n || 'A back lane'} of bins and back doors.`], h) + cobbles;
    case 'track':
      return `A rough track${n ? `, ${n},` : ''} rutted and puddled.`;
    case 'cycleway':
      return `A cycle path${n ? `, ${n}` : ''}; a bell rings behind you and someone sweeps past.`;
    default:
      if (n) return pick([`${n} is narrow, more of a lane than a street.`, `${n} runs between old walls.`], h) + cobbles;
      return dark
        ? pick(['A narrow path runs between walls; it is dark along here.', 'A footpath, unlit, between fences and the backs of gardens.'], h)
        : pick(['A narrow path squeezes between two walls.', 'A footpath runs between hedges and the backs of gardens.'], h);
  }
}

function junctionLine(town: Town, s: Stop): string | null {
  const names = streetsAt(town, s);
  if (s.square || names.length < 2) return null;
  if (names.length === 2) return `${names[1]} meets it here.`;
  return `${list(names.slice(1, 4))} meet it here.`;
}

function waterLine(town: Town, s: Stop, h: number): string | null {
  const bridge = s.edges.map((id) => town.edges[id]).find((e) => e.bridge && e.over);
  if (bridge) {
    return pick(
      [
        `The ${bare(bridge.over!)} slides underneath the bridge.`,
        `Below the parapet the ${bare(bridge.over!)} runs dark and quick.`,
      ],
      h,
    );
  }
  if (s.water)
    return pick([`The ${bare(s.water)} runs close by beyond a low wall.`, `You can hear the ${bare(s.water)} lapping against stone.`], h);
  return null;
}

function ambientLine(p: Paint, s: Stop, town: Town, h: number): string | null {
  const lit = s.edges.some((id) => town.edges[id].lit);
  const choices: string[] = [];
  if (p.wet === 'rain') choices.push('Rain bounces off the paving and runs in the gutters.', 'Umbrellas jostle past.');
  if (p.wet === 'drizzle') choices.push('A fine drizzle hangs in the air.', 'Everything is slick with drizzle.');
  if (p.wet === 'snow') choices.push('Snow is settling on the window ledges.', 'Snowflakes turn in the light from the windows.');
  if (p.wet === 'fog') choices.push('Fog blurs the far end of the street.', 'The tops of the buildings are lost in fog.');
  if (p.light === 'low') choices.push('The low sun lays long shadows across the street.', 'Upper windows catch the last of the sun.');
  if (p.light === 'dusk') choices.push('The sky over the roofs has gone a deep blue.', 'Lights are coming on in the windows.');
  if (p.light === 'dark') choices.push(lit ? 'Street lamps throw pools of yellow light.' : 'It is properly dark now.', 'Your breath shows in the cold.');
  if (!choices.length || h % 3 === 0) return null;
  return pick(choices, h >>> 3);
}

/** How a named place is introduced. */
export function spotPhrase(sp: Spot): string {
  if (sp.name) return `${sp.name}, ${an(sp.kind.noun)}`;
  return an(sp.kind.noun);
}

function placesLines(town: Town, s: Stop, h: number, brief: boolean): string[] {
  const spots = s.spots.map((id) => town.spots[id]);
  if (!spots.length) return [];
  const named = spots.filter((sp) => sp.name).sort((p, q) => q.kind.weight - p.kind.weight || p.id - q.id);
  const things = spots.filter((sp) => !sp.name);
  const out: string[] = [];
  if (named.length) {
    const shown = named.slice(0, brief ? 4 : 6);
    const rest = named.length - shown.length;
    if (shown.length === 1 && !brief) {
      out.push(
        pick(
          [`Here stands ${spotPhrase(shown[0])}.`, `${capital(spotPhrase(shown[0]))}, is here.`, `Beside you is ${spotPhrase(shown[0])}.`],
          h,
        ),
      );
    } else if (brief) {
      out.push(`${capital(list(shown.map((sp) => sp.name!)))}${rest ? `, and ${count(rest)} more,` : ''} ${shown.length + rest > 1 ? 'are' : 'is'} here.`);
    } else {
      const lead = pick(['Here are', 'Along here are', 'Around you are'], h);
      const items = shown.map(spotPhrase);
      const body = rest
        ? `${items.join('; ')}; and ${count(rest)} more (LOOK AT SHOPS lists them all)`
        : `${items.slice(0, -1).join('; ')}; and ${items[items.length - 1]}`;
      out.push(`${lead} ${body}.`);
    }
  }
  if (things.length && !brief) {
    const kinds = new Map<string, { noun: string; plural: string; n: number }>();
    for (const t of things) {
      const k = kinds.get(t.kind.tag) ?? { noun: t.kind.noun, plural: t.kind.plural, n: 0 };
      k.n++;
      kinds.set(t.kind.tag, k);
    }
    const words = [...kinds.values()].map((k) => (k.n === 1 ? an(k.noun) : `${k.n > 3 ? 'several' : count(k.n)} ${k.plural}`));
    out.push(`There ${words[0].startsWith('a') ? 'is' : 'are'} ${list(words)} here.`);
  }
  return out;
}

const VISIBLE = new Set(['faith', 'sight']);
const FAR_TAGS = /historic=(castle|tower|monument|fort|palace|church)|amenity=(place_of_worship|townhall)|man_made=(tower|lighthouse)|tourism=(attraction|viewpoint)|railway=station/;

/** Something tall or famous visible from here, or null. */
function landmarkLine(town: Town, s: Stop, h: number): string | null {
  let best: Spot | null = null;
  let score = 0;
  for (const sp of town.spots) {
    if (sp.at === s.id || !sp.name || !VISIBLE.has(sp.kind.group) && sp.kind.tag !== 'railway=station') continue;
    if (!FAR_TAGS.test(sp.kind.tag)) continue;
    const d = Math.hypot(sp.x - s.x, sp.y - s.y);
    if (d < 40 || d > 320) continue;
    const v = sp.kind.weight / (1 + d / 120) + ((hash(sp.id, s.id) % 7) / 40);
    if (v > score) {
      score = v;
      best = sp;
    }
  }
  if (!best) return null;
  const ang = (Math.atan2(best.x - s.x, best.y - s.y) * 180) / Math.PI;
  const dir = COMPASS_WORD[COMPASS[(Math.round(ang / 45) + 8) % 8]];
  const t = best.kind.tag;
  const name = best.name!;
  if (t.startsWith('amenity=place_of_worship') || t === 'historic=church')
    return pick([`To the ${dir}, the tower of ${name} rises over the rooftops.`, `Off to the ${dir} you can see ${name} above the roofs.`], h);
  if (t === 'historic=castle' || t === 'historic=fort') return `${name} looms on its height to the ${dir}.`;
  if (t === 'railway=station') return `Trains rumble somewhere to the ${dir}, towards ${name}.`;
  return `To the ${dir} you can make out ${name}.`;
}

export interface Description {
  title: string;
  paras: string[];
  exits: Exit[];
}

/** The full account of a stop, or the short one for a place already visited. */
export function describe(town: Town, stop: number, w: Weathering, brief: boolean): Description {
  const s = town.stops[stop];
  const p = paintOf(w);
  const h = hash(stop, town.lat.toFixed(3));
  const exits = exitsOf(town, stop);
  const paras: string[] = [];
  if (!brief) {
    const first = [streetLine(town, s, p, h), junctionLine(town, s), waterLine(town, s, h >>> 2), ambientLine(p, s, town, hash(stop, Math.floor(w.clock / 20)))]
      .filter(Boolean)
      .join(' ');
    paras.push(first);
  }
  const places = placesLines(town, s, h >>> 4, brief);
  if (places.length) paras.push(places.join(' '));
  if (!brief) {
    const lm = landmarkLine(town, s, h >>> 6);
    if (lm) paras.push(lm);
  }
  return { title: s.title, paras, exits };
}

/** The exits as a sentence. */
export function exitsLine(exits: Exit[]): string {
  const parts = exits.map((x) => `${x.dir ? COMPASS_WORD[x.dir] : 'a way'} ${x.how}`);
  if (!parts.length) return 'There is no way on from here.';
  return `Exits: ${list(parts)}.`;
}

/** The walk from one stop to the next. */
export function walkLine(town: Town, x: Exit, w: Weathering): string {
  const e = town.edges[x.edge];
  const p = paintOf(w);
  const dir = x.dir ? COMPASS_WORD[x.dir] : 'on';
  const len = e.len;
  const far = len < 35 ? 'a few steps' : len < 80 ? 'a short way' : `${Math.round(len / 10) * 10} metres`;
  const h = hash(e.id, x.to);
  const parts: string[] = [];
  if (e.bridge && (e.over || e.bridgeName)) {
    const over = e.over ? ` the ${bare(e.over)}` : '';
    parts.push(e.bridgeName ? `You cross${over} by ${theName(e.bridgeName)}.` : `You cross${over || ' a bridge'}.`);
  } else if (e.hw === 'steps') {
    parts.push(pick([`You take the steps, ${far}.`, `You go by the steps, counting them under your breath.`], h));
  } else if (e.tunnel) {
    parts.push(e.name ? `You go through ${e.name}, a covered passage, your footsteps echoing.` : 'You go through a covered passage, your footsteps echoing.');
  } else if (e.name) {
    parts.push(pick([`You walk ${far} ${dir} along ${e.name}.`, `You head ${dir} along ${e.name}, ${far}.`], h));
  } else {
    const what = e.hw === 'service' ? 'alley' : e.hw === 'track' ? 'track' : 'path';
    parts.push(pick([`You follow the ${what} ${dir}, ${far}.`, `You go ${dir} along the ${what}, ${far}.`], h));
  }
  if ((p.light === 'dark' || p.light === 'dusk') && !e.lit && !e.name && len > 40) parts.push('It is dark along here; you keep to the middle.');
  else if (p.wet === 'rain' && h % 4 === 0 && /^(primary|secondary|tertiary)/.test(e.hw)) parts.push('A bus throws up a sheet of spray.');
  return parts.join(' ');
}

/** What you're told when a way leads out of the surveyed town. */
export function edgeOfTown(town: Town, x: Exit): string {
  const e = town.edges[x.edge];
  const h = hash(e.id);
  const way = e.name ?? 'The way';
  return pick(
    [
      `${way} carries on out of the part of town you know. Everything on your list is back the other way.`,
      `You look ${x.dir ? COMPASS_WORD[x.dir] : 'that way'} along ${e.name ?? 'the path'}. That’s further than your errands take you today.`,
    ],
    h,
  );
}
