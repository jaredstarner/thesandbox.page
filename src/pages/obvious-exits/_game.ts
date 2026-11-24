// The game: where you are, what you carry, what's left on the list, and the clock. A list of
// errands is drawn up from the shops this town actually has, the afternoon is timed so it can just
// be done, and every command you type moves the story and the clock on.

import {
  COMPASS,
  COMPASS_WORD,
  describe,
  edgeOfTown,
  exitsLine,
  exitsOf,
  hash,
  spotPhrase,
  walkLine,
  type Compass,
  type Exit,
} from './_describe';
import { closesAfter, opensAfter, spansOn } from './_hours';
import { clockDigits, clockWords, lightAt, weatherLine, wetOf, type Sky } from './_sky';
import { distances, type Spot, type Town } from './_town';
import { an, capital, insideLine, list, say, setEnglish, type English } from './_words';

export interface Item {
  id: string;
  name: string;
  desc: string;
  nouns: string[];
}

interface Def {
  id: string;
  line: string;
  verbs: string[];
  nouns: string[];
  tags: string[];
  carry?: Item;
  gives?: Item;
  minutes: number;
  done: (sp: Spot) => string;
}

export interface Errand {
  def: Def;
  done: boolean;
  where: number;
}

export interface Meet {
  spot: number;
  friend: string;
  done: boolean;
  late: number;
}

export type Block =
  | { k: 'banner'; lines: string[] }
  | { k: 'title'; text: string }
  | { k: 'p'; text: string }
  | { k: 'exits'; exits: Exit[] }
  | { k: 'event'; text: string }
  | { k: 'list'; items: { text: string; done: boolean }[] }
  | { k: 'end'; text: string }
  | { k: 'ui'; action: 'map' | 'restart' | 'elsewhere' };

export interface Where {
  name: string;
  region: string;
  english: English;
}

export interface Game {
  town: Town;
  where: Where;
  sky: Sky;
  at: number;
  prev: number;
  clock: number;
  start: number;
  close: number;
  moves: number;
  items: Item[];
  errands: Errand[];
  meet: Meet | null;
  visited: Set<number>;
  walked: Set<number>;
  seen: Set<number>;
  inside: number;
  flags: Set<string>;
  over: boolean;
  verbose: boolean;
  helped: boolean;
  /** Named places in town, for the exploring part of the score. */
  namedTotal: number;
}

const WALK = 78; // metres a minute
const lower = (s: string) => s[0].toLowerCase() + s.slice(1);
const CLOSE = 17 * 60 + 30;

const FRIENDS = ['Alex', 'Sam', 'Jo', 'Robin', 'Kit', 'Charlie', 'Frankie', 'Morgan', 'Jamie', 'Ash', 'Ronnie', 'Lou'];
const KIN = ['Aunt Ruth', 'Gran', 'Uncle Des', 'Aunt Mags', 'Grandpa', 'Cousin Bea'];

function defs(kin: string): Def[] {
  return [
    {
      id: 'letter',
      line: `Post the letter to ${kin}`,
      verbs: ['post', 'mail', 'send', 'drop', 'put', 'deliver'],
      nouns: ['letter', 'envelope', 'mail'],
      tags: ['amenity=post_box', 'amenity=post_office'],
      carry: { id: 'letter', name: 'a stamped letter', desc: `An envelope addressed in your own hand to ${kin}, stamped and sealed.`, nouns: ['letter', 'envelope'] },
      minutes: 1,
      done: (sp) =>
        sp.kind.tag === 'amenity=post_box'
          ? `You push the letter into the ${sp.kind.noun}. It drops out of sight with a soft slap.`
          : `You queue behind someone posting a parcel to Australia, then hand the letter across the counter.`,
    },
    {
      id: 'book',
      line: 'Return the library book',
      verbs: ['return', 'give', 'hand', 'drop', 'take'],
      nouns: ['book', 'library book', 'hardback'],
      tags: ['amenity=library'],
      carry: { id: 'book', name: 'a library book', desc: 'A hardback in a plastic jacket, a history of the town’s drains, two weeks overdue.', nouns: ['book', 'hardback'] },
      minutes: 4,
      done: () => 'The librarian scans the book, raises an eyebrow at the date stamp, and lets it go this once.',
    },
    {
      id: 'bread',
      line: 'A loaf of bread',
      verbs: ['buy', 'get', 'purchase'],
      nouns: ['bread', 'loaf'],
      tags: ['shop=bakery', 'shop=supermarket', 'shop=convenience'],
      gives: { id: 'bread', name: 'a loaf of bread', desc: 'Wrapped in paper and still faintly warm.', nouns: ['bread', 'loaf'] },
      minutes: 4,
      done: (sp) =>
        sp.kind.tag === 'shop=bakery'
          ? 'The baker wraps the last good loaf in paper. It is still warm.'
          : 'You find a loaf near the back and queue at the till behind someone paying in coins.',
    },
    {
      id: 'cash',
      line: say('Get some cash out', 'Get some cash'),
      verbs: ['get', 'withdraw', 'take', 'draw'],
      nouns: ['cash', 'money', 'notes'],
      tags: ['amenity=atm', 'amenity=bank'],
      gives: { id: 'cash', name: 'some cash', desc: 'A few notes, folded once.', nouns: ['cash', 'money', 'notes'] },
      minutes: 2,
      done: () => 'The machine thinks about it for a worrying length of time, then counts out your notes.',
    },
    {
      id: 'medicine',
      line: 'Collect the prescription',
      verbs: ['collect', 'get', 'pick', 'fetch'],
      nouns: ['prescription', 'medicine', 'pills'],
      tags: ['amenity=pharmacy', 'healthcare=pharmacy', 'shop=chemist'],
      gives: { id: 'medicine', name: say('a paper bag from the chemist’s', 'a paper bag from the pharmacy'), desc: 'Stapled shut, with your name on a label.', nouns: ['bag', 'prescription', 'medicine', 'pills'] },
      minutes: 5,
      done: () => 'The pharmacist checks your name and date of birth, then hands over a paper bag stapled shut.',
    },
    {
      id: 'paper',
      line: 'Today’s paper',
      verbs: ['buy', 'get'],
      nouns: ['paper', 'newspaper'],
      tags: ['shop=newsagent', 'shop=newspaper', 'shop=kiosk', 'shop=convenience'],
      gives: { id: 'paper', name: 'a newspaper', desc: 'Today’s, folded under your arm. The crossword is still blank.', nouns: ['paper', 'newspaper'] },
      minutes: 2,
      done: () => 'You take the last copy of today’s paper from the rack.',
    },
    {
      id: 'flowers',
      line: 'Flowers for the table',
      verbs: ['buy', 'get'],
      nouns: ['flowers', 'bunch', 'bouquet'],
      tags: ['shop=florist'],
      gives: { id: 'flowers', name: 'a bunch of flowers', desc: 'Tulips, wrapped in brown paper.', nouns: ['flowers', 'bunch', 'tulips'] },
      minutes: 5,
      done: () => 'The florist wraps a bunch of tulips in brown paper and ties it with string.',
    },
    {
      id: 'key',
      line: 'Get a spare key cut',
      verbs: ['get', 'cut', 'have', 'collect'],
      nouns: ['key', 'spare'],
      tags: ['shop=locksmith', 'shop=shoe_repair', 'craft=key_cutter'],
      gives: { id: 'key', name: 'a newly cut key', desc: 'Bright brass, its edges still sharp from the machine.', nouns: ['key'] },
      minutes: 6,
      done: () => 'The machine whines through a blank, and you are handed a bright new key, still warm.',
    },
    {
      id: 'coat',
      line: say('Collect the coat from the dry cleaner’s', 'Pick up the coat from the dry cleaner'),
      verbs: ['collect', 'get', 'pick', 'fetch'],
      nouns: ['coat', 'cleaning'],
      tags: ['shop=dry_cleaning', 'shop=laundry'],
      gives: { id: 'coat', name: 'your coat, in plastic', desc: 'Pressed, on a wire hanger, under a crackling plastic sheet.', nouns: ['coat'] },
      minutes: 3,
      done: () => 'The rail turns, and your coat comes round under its plastic sheet.',
    },
    {
      id: 'card',
      line: 'A birthday card',
      verbs: ['buy', 'get'],
      nouns: ['card', 'birthday card'],
      tags: ['shop=stationery', 'shop=gift', 'shop=books', 'shop=newsagent'],
      gives: { id: 'card', name: 'a birthday card', desc: 'A card with a dog in a party hat on the front. It will do.', nouns: ['card'] },
      minutes: 4,
      done: () => 'You spend longer than you meant to choosing, and settle on a dog in a party hat.',
    },
    {
      id: 'bulbs',
      line: 'Light bulbs',
      verbs: ['buy', 'get'],
      nouns: ['bulbs', 'bulb', 'light bulbs'],
      tags: ['shop=hardware', 'shop=doityourself', 'shop=variety_store'],
      gives: { id: 'bulbs', name: 'a packet of light bulbs', desc: 'Two bulbs, the right fitting, you hope.', nouns: ['bulbs', 'bulb', 'packet'] },
      minutes: 4,
      done: () => 'The man in the brown coat asks which fitting. You guess, confidently.',
    },
    {
      id: 'cheese',
      line: 'Cheese for tonight',
      verbs: ['buy', 'get'],
      nouns: ['cheese'],
      tags: ['shop=cheese', 'shop=deli'],
      gives: { id: 'cheese', name: 'a wedge of cheese', desc: 'In waxed paper. It smells strongly through it.', nouns: ['cheese', 'wedge'] },
      minutes: 4,
      done: () => 'You are given three things to taste and buy the first one.',
    },
    {
      id: 'apples',
      line: 'Apples',
      verbs: ['buy', 'get'],
      nouns: ['apples', 'apple', 'fruit'],
      tags: ['shop=greengrocer', 'amenity=marketplace'],
      gives: { id: 'apples', name: 'a bag of apples', desc: 'Six apples in a paper bag that is already giving at the bottom.', nouns: ['apples', 'apple', 'bag'] },
      minutes: 3,
      done: () => 'Six apples go into a paper bag, weighed on the brass scales.',
    },
    {
      id: 'glasses',
      line: 'Pick up the mended glasses',
      verbs: ['collect', 'get', 'pick', 'fetch'],
      nouns: ['glasses', 'spectacles'],
      tags: ['shop=optician'],
      gives: { id: 'glasses', name: 'your glasses, mended', desc: 'A new screw in the left hinge. Everything is sharper.', nouns: ['glasses', 'spectacles'] },
      minutes: 4,
      done: () => 'Your glasses come back with a new screw in the hinge and a little cloth.',
    },
    {
      id: 'wine',
      line: 'A bottle of wine',
      verbs: ['buy', 'get'],
      nouns: ['wine', 'bottle'],
      tags: ['shop=wine', 'shop=alcohol'],
      gives: { id: 'wine', name: 'a bottle of red', desc: 'Red, from somewhere warm. Recommended.', nouns: ['wine', 'bottle', 'red'] },
      minutes: 4,
      done: () => 'Someone who knows about wine recommends a red, and you take it.',
    },
    {
      id: 'sausages',
      line: 'Sausages for supper',
      verbs: ['buy', 'get'],
      nouns: ['sausages', 'sausage', 'meat'],
      tags: ['shop=butcher'],
      gives: { id: 'sausages', name: 'a string of sausages', desc: 'Wrapped in white paper.', nouns: ['sausages', 'sausage'] },
      minutes: 4,
      done: () => 'The butcher wraps six sausages in white paper and writes the price on it in pencil.',
    },
    {
      id: 'fish',
      line: 'Fish for supper',
      verbs: ['buy', 'get'],
      nouns: ['fish'],
      tags: ['shop=seafood'],
      gives: { id: 'fish', name: 'a parcel of fish', desc: 'Wrapped twice. It is still a parcel of fish.', nouns: ['fish', 'parcel'] },
      minutes: 4,
      done: () => 'Two fillets, wrapped twice over.',
    },
  ];
}

/** A small seeded generator. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** The hours a place keeps today, from its tag or from what its kind usually keeps. */
export function hoursOf(g: Game, sp: Spot): [number, number][] {
  const real = spansOn(sp.tags.opening_hours, g.sky.weekday);
  if (real) return real;
  if (sp.kind.group === 'thing') return [[0, 1440]];
  if (sp.kind.group === 'drink') return [[11 * 60, 23 * 60]];
  if (sp.kind.tag === 'amenity=fast_food') return [[11 * 60, 23 * 60]];
  if (sp.kind.tag === 'amenity=cafe') return [[8 * 60, 18 * 60]];
  if (sp.kind.tag === 'amenity=restaurant') return [[12 * 60, 23 * 60]];
  if (sp.kind.group === 'faith') return [[8 * 60, 19 * 60]];
  if (sp.kind.tag === 'shop=supermarket' || sp.kind.tag === 'shop=convenience') return [[7 * 60, 22 * 60]];
  return [[9 * 60, CLOSE]];
}

const isOpen = (g: Game, sp: Spot, at = g.clock) => closesAfter(hoursOf(g, sp), at) !== null;

function matches(def: Def, sp: Spot): boolean {
  if (!def.tags.includes(sp.kind.tag)) return false;
  if (def.id === 'cash' && sp.kind.tag === 'amenity=bank') return sp.tags.atm !== 'no';
  return true;
}

/** Start a new afternoon in a town. */
export function newGame(town: Town, where: Where, sky: Sky, seed: number): { game: Game; blocks: Block[] } {
  setEnglish(where.english);
  const r = rng(seed);
  const kin = KIN[Math.floor(r() * KIN.length)];
  const friend = FRIENDS[Math.floor(r() * FRIENDS.length)];
  const fromStart = distances(town, town.start);
  const reachable = (sp: Spot) => sp.at >= 0 && Number.isFinite(fromStart[sp.at]) && !town.stops[sp.at].out;
  const probe = { sky } as Game;

  // Which errands this town can do, and how far away the nearest place for each is.
  const options = defs(kin)
    .map((def) => {
      const where2 = town.spots.filter((sp) => reachable(sp) && matches(def, sp) && closesAfter(hoursOf(probe, sp), CLOSE - 40) !== null);
      const near = Math.min(...where2.map((sp) => fromStart[sp.at]));
      return { def, where: where2, near };
    })
    .filter((o) => o.where.length > 0);
  const chosen: typeof options = [];
  const take = (id: string) => {
    const o = options.find((x) => x.def.id === id);
    if (o && !chosen.includes(o)) chosen.push(o);
  };
  take('letter');
  if (r() < 0.75) take('book');
  const rest = options
    .filter((o) => !chosen.includes(o))
    .map((o) => ({ o, w: (o.near > 90 && o.near < 480 ? 2 : 1) * (o.where.length <= 3 ? 1.6 : 1) * (0.5 + r()) }))
    .sort((a, b) => b.w - a.w);
  for (const { o } of rest) {
    if (chosen.length >= 4) break;
    chosen.push(o);
  }

  // Somewhere to meet: a pub, or a bar, or a café, a fair walk from the start.
  const meetKinds = where.english === 'gb' ? ['amenity=pub', 'amenity=bar', 'amenity=cafe'] : ['amenity=bar', 'amenity=pub', 'amenity=cafe'];
  let meetSpot = -1;
  for (const k of meetKinds) {
    const c = town.spots.filter((sp) => sp.kind.tag === k && sp.name && reachable(sp));
    if (!c.length) continue;
    const good = c.filter((sp) => fromStart[sp.at] > 120 && fromStart[sp.at] < 520);
    const pool = good.length ? good : c;
    meetSpot = pool[Math.floor(r() * pool.length)].id;
    break;
  }

  // Time the afternoon so the list can just be done: a greedy round from the start, with slack.
  let pos = town.start;
  let walk = 0;
  let work = 0;
  const left = [...chosen];
  while (left.length) {
    const d = distances(town, pos);
    let bi = 0;
    let bd = Infinity;
    let bs = pos;
    left.forEach((o, i) => {
      for (const sp of o.where)
        if (d[sp.at] < bd) {
          bd = d[sp.at];
          bi = i;
          bs = sp.at;
        }
    });
    walk += bd;
    work += left[bi].def.minutes;
    pos = bs;
    left.splice(bi, 1);
  }
  if (meetSpot >= 0) walk += distances(town, pos)[town.spots[meetSpot].at];
  const need = walk / WALK + work + 6;
  const budget = Math.max(45, Math.min(120, Math.ceil((need * 1.5 + 10) / 5) * 5));
  const start = CLOSE - budget;

  const named = new Set(town.spots.filter((sp) => sp.name && reachable(sp)).map((sp) => sp.id));
  const game: Game = {
    town,
    where,
    sky,
    at: town.start,
    prev: -1,
    clock: start,
    start,
    close: CLOSE,
    moves: 0,
    items: chosen.flatMap((o) => (o.def.carry ? [o.def.carry] : [])),
    errands: chosen.map((o) => ({ def: o.def, done: false, where: -1 })),
    meet: meetSpot >= 0 ? { spot: meetSpot, friend, done: false, late: 0 } : null,
    visited: new Set(),
    walked: new Set(),
    seen: new Set(),
    inside: -1,
    flags: new Set(),
    over: false,
    verbose: false,
    helped: false,
    namedTotal: named.size,
  };
  if (lightAt(start, sky.sunset) === 'dark') game.flags.add('sunset').add('lamps');
  if (start > sky.sunset) game.flags.add('sunset');
  return { game, blocks: opening(game) };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function opening(g: Game): Block[] {
  const [y, m, d] = g.sky.date.split('-').map(Number);
  const serial = `${String(y).slice(2)}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
  const toSunset = g.sky.sunset - g.start;
  const light =
    toSunset > 50
      ? 'with an hour or so of daylight left'
      : toSunset > 5
        ? 'and the sun is already low'
        : toSunset > -35
          ? 'and the sun has just gone down'
          : `and it has been dark since ${clockWords(g.sky.sunset)}`;
  const part = d <= 10 ? 'early' : d <= 20 ? 'the middle of' : 'late';
  const meet = g.meet ? `, ${g.meet.friend} to meet at ${g.town.spots[g.meet.spot].name} at ${clockWords(g.close)},` : '';
  const weather = weatherLine(g.sky.weather, lightAt(g.start, g.sky.sunset));
  const blocks: Block[] = [
    {
      k: 'banner',
      lines: ['OBVIOUS EXITS', 'An interactive errand', `${g.where.name}, ${g.where.region}`, `Release 1 / Serial number ${serial}`],
    },
    {
      k: 'p',
      text:
        `It is ${clockWords(g.start)} on a ${WEEKDAYS[g.sky.weekday]} afternoon in ${part === 'the middle of' ? 'the middle of ' : `${part} `}${MONTHS[m - 1]}, ${light}.` +
        (weather ? ` ${weather}` : '') +
        ` You have a list in your pocket${meet} and the shops shut at ${clockWords(g.close)}.`,
    },
    { k: 'event', text: 'Type LIST to read your list, LOOK to look around, or a direction such as NORTH to walk. HELP if you get stuck.' },
  ];
  return blocks.concat(arrive(g, false));
}

/** Describe where you are; the long version on a first visit. */
function arrive(g: Game, brief: boolean): Block[] {
  const first = !g.visited.has(g.at);
  g.visited.add(g.at);
  const d = describe(g.town, g.at, { clock: g.clock, sky: g.sky }, brief && !first && !g.verbose);
  for (const id of g.town.stops[g.at].spots) g.seen.add(id);
  const out: Block[] = [{ k: 'title', text: d.title }];
  for (const p of d.paras) out.push({ k: 'p', text: p });
  out.push({ k: 'exits', exits: d.exits });
  out.push(...meetCheck(g));
  return out;
}

/** Move the clock on and tell of anything that happens on the way. */
function pass(g: Game, minutes: number): Block[] {
  const before = g.clock;
  g.clock += minutes;
  const out: Block[] = [];
  const crossed = (t: number) => before < t && g.clock >= t;
  const once = (flag: string, t: number, text: string) => {
    if (!g.flags.has(flag) && crossed(t)) {
      g.flags.add(flag);
      out.push({ k: 'event', text });
    }
  };
  once('sunset', g.sky.sunset, wetOf(g.sky.weather) === 'dry' ? 'The sun goes down behind the roofs.' : 'Somewhere behind the cloud, the sun has set.');
  once('lamps', g.sky.sunset + 20, 'The street lamps come on, one after another, down the street.');
  once('warn', g.close - 15, `Your watch says ${clockWords(g.close - 15)}. The shops will be shutting soon.`);
  if (!g.flags.has('close') && crossed(g.close)) {
    g.flags.add('close');
    const left = g.errands.filter((e) => !e.done).length;
    out.push({
      k: 'event',
      text: `Somewhere a clock strikes ${clockWords(g.close).replace(' o’clock', '')}. Shutters rattle down along the street.${left ? ` ${capital(String(left === 1 ? 'one thing' : `${left} things`))} on your list will have to wait.` : ''}`,
    });
  }
  if (g.meet && !g.meet.done) {
    const pub = g.town.spots[g.meet.spot].name;
    once('buzz', g.close + 10, `Your phone buzzes. ${g.meet.friend}: “At ${pub}. Where are you?”`);
    if (!g.flags.has('gone') && crossed(g.close + 40)) {
      g.flags.add('gone');
      out.push({ k: 'event', text: `Your phone buzzes again. ${g.meet.friend} has given up and gone home.` });
      out.push(...finish(g));
    }
  }
  return out;
}

function meetCheck(g: Game): Block[] {
  if (!g.meet || g.meet.done || g.over) return [];
  const sp = g.town.spots[g.meet.spot];
  if (sp.at !== g.at) return [];
  if (g.clock < g.close - 25) return [{ k: 'p', text: `This is where you’re meeting ${g.meet.friend}, at ${clockWords(g.close)}.` }];
  if (g.clock < g.close) {
    return [{ k: 'p', text: `You’re early. ${g.meet.friend} isn’t here yet. (WAIT to wait.)` }];
  }
  g.meet.done = true;
  g.meet.late = Math.max(0, Math.round(g.clock - g.close));
  const wet = wetOf(g.sky.weather);
  const shake = wet === 'rain' || wet === 'drizzle' ? ', shaking rain off a coat' : wet === 'snow' ? ', stamping snow off their boots' : '';
  const text =
    g.meet.late < 3
      ? `${g.meet.friend} comes in right behind you${shake}, and you find a table by the window.`
      : g.meet.late < 15
        ? `${g.meet.friend} is at a table by the window and waves you over, already halfway down a drink.`
        : `${g.meet.friend} is at the bar, coat on, about to leave. You are forgiven, eventually.`;
  return [{ k: 'p', text: `You go into ${sp.name}. ${text}` }, ...finish(g)];
}

function scoreOf(g: Game): { score: number; max: number; parts: string[] } {
  const per = g.meet ? 15 : 20;
  const done = g.errands.filter((e) => e.done).length;
  let score = done * per;
  let max = g.errands.length * per;
  const parts = [`${done} of ${g.errands.length} errands`];
  if (g.meet) {
    max += 25;
    if (g.meet.done) {
      const m = g.meet.late < 3 ? 25 : g.meet.late < 15 ? 18 : 10;
      score += m;
      parts.push(g.meet.late < 3 ? `met ${g.meet.friend} on time` : `met ${g.meet.friend} ${g.meet.late} minutes late`);
    }
  }
  const explore = 100 - max;
  const named = [...g.seen].filter((id) => g.town.spots[id].name).length;
  const ex = Math.round(explore * Math.min(1, named / Math.max(20, Math.min(90, g.namedTotal * 0.25))));
  score += ex;
  max += explore;
  parts.push(`${named} named places seen`);
  return { score, max, parts };
}

function rank(score: number): string {
  if (score < 25) return 'Window Shopper';
  if (score < 50) return 'Errand Runner';
  if (score < 75) return 'Regular';
  if (score < 95) return 'Local';
  return 'Knows Every Alley';
}

function finish(g: Game): Block[] {
  if (g.over) return [];
  g.over = true;
  const s = scoreOf(g);
  return [
    { k: 'end', text: `*** The afternoon is over ***` },
    {
      k: 'p',
      text: `In ${g.moves} moves you scored ${s.score} out of a possible ${s.max} (${list(s.parts)}), which earns you the rank of ${rank(s.score)}.`,
    },
    { k: 'event', text: `The town is still here: wander as long as you like. Or type RESTART to try the afternoon again, or ELSEWHERE to go somewhere new.` },
  ];
}

const DIRS: Record<string, Compass> = {
  n: 'n',
  north: 'n',
  s: 's',
  south: 's',
  e: 'e',
  east: 'e',
  w: 'w',
  west: 'w',
  ne: 'ne',
  northeast: 'ne',
  'north-east': 'ne',
  nw: 'nw',
  northwest: 'nw',
  'north-west': 'nw',
  se: 'se',
  southeast: 'se',
  'south-east': 'se',
  sw: 'sw',
  southwest: 'sw',
  'south-west': 'sw',
};
const GO = new Set(['go', 'walk', 'head', 'run', 'move', 'travel', 'stroll', 'wander', 'take', 'follow', 'cross', 'climb', 'descend', 'g0']);
const FILLER = new Set(['the', 'a', 'an', 'some', 'my', 'to', 'please', 'then', 'up', 'down', 'along', 'onto', 'into', 'in', 'on', 'at']);

function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Loose name matching: every word typed appears at the start of a word in the name. */
function nameMatch(name: string, words: string[]): number {
  if (!words.length) return 0;
  const n = normalise(name)
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  const parts = n.split(/[\s'-]+/);
  let hit = 0;
  for (const w of words) {
    const ww = w.normalize('NFD').replace(/\p{M}/gu, '');
    if (parts.some((p) => p.startsWith(ww))) hit++;
    else if (!['street', 'st', 'road', 'rd', 'lane'].includes(ww)) return 0;
  }
  return hit / parts.length + hit;
}

function spotsHere(g: Game): Spot[] {
  return g.town.stops[g.at].spots.map((id) => g.town.spots[id]);
}

/** A place here named or described by the words typed. */
function findSpot(g: Game, words: string[]): Spot | null {
  const here = spotsHere(g);
  let best: Spot | null = null;
  let score = 0;
  for (const sp of here) {
    let s = sp.name ? nameMatch(sp.name, words) : 0;
    const noun = nameMatch(sp.kind.noun, words);
    if (noun > 0) s = Math.max(s, noun * 0.9);
    if (s > score) {
      score = s;
      best = sp;
    }
  }
  return best;
}

function walk(g: Game, x: Exit): Block[] {
  if (x.out) return [{ k: 'p', text: edgeOfTown(g.town, x) }];
  const out: Block[] = [];
  if (g.inside >= 0) {
    out.push({ k: 'p', text: 'You step back out onto the street.' });
    g.inside = -1;
  }
  const w = { clock: g.clock, sky: g.sky };
  out.push({ k: 'p', text: walkLine(g.town, x, w) });
  out.push(...pass(g, g.town.edges[x.edge].len / WALK));
  g.walked.add(x.edge);
  g.prev = g.at;
  g.at = x.to;
  out.push(...arrive(g, true));
  return out;
}

function errandHere(g: Game, verb: string, words: string[]): Block[] | null {
  const typed = new Set(words);
  const all = [...typed].join(' ');
  for (const e of g.errands) {
    const def = e.def;
    const nounHit = def.nouns.some((n) => all.includes(n));
    const verbHit = def.verbs.includes(verb);
    if (!nounHit || !verbHit) continue;
    if (e.done) return [{ k: 'p', text: 'You’ve already done that. It’s crossed off the list.' }];
    if (def.carry && !g.items.some((i) => i.id === def.carry!.id)) return [{ k: 'p', text: 'You don’t seem to have it any more.' }];
    // The place you are in if it will do, otherwise any place at this stop.
    const inside = g.inside >= 0 ? g.town.spots[g.inside] : null;
    const candidates = spotsHere(g)
      .filter((sp) => matches(def, sp))
      .sort((p, q) => Number(q.id === inside?.id) - Number(p.id === inside?.id));
    if (!candidates.length) {
      const what = def.tags.map((t) => t.split('=')[1].replace(/_/g, ' '));
      return [{ k: 'p', text: `You can’t do that here. You’ll need to find ${an(what[0] === 'post box' ? say('post box', 'mailbox') : what[0])}${what.length > 1 ? ' or similar' : ''}.` }];
    }
    const open = candidates.find((sp) => isOpen(g, sp));
    if (!open) {
      const sp = candidates[0];
      const spans = hoursOf(g, sp);
      const next = opensAfter(spans, g.clock);
      return [
        {
          k: 'p',
          text: `${capital(sp.name ?? `the ${sp.kind.noun}`)} is shut${next !== null ? `; it opens again at ${clockDigits(next)}` : ' for the day'}.`,
        },
      ];
    }
    const blocks: Block[] = [];
    if (open.kind.enter && g.inside !== open.id) blocks.push({ k: 'p', text: `You go into ${open.name ?? `the ${open.kind.noun}`}.` });
    if (open.kind.enter) g.inside = open.id;
    blocks.push({ k: 'p', text: def.done(open) });
    if (def.carry) g.items = g.items.filter((i) => i.id !== def.carry!.id);
    if (def.gives) g.items.push(def.gives);
    e.done = true;
    e.where = open.id;
    blocks.push({ k: 'event', text: `You cross “${def.line}” off your list.` });
    blocks.push(...pass(g, def.minutes));
    if (g.errands.every((x) => x.done)) {
      blocks.push({
        k: 'event',
        text: g.meet && !g.meet.done ? `That’s everything on the list. Now for ${g.town.spots[g.meet.spot].name}.` : 'That’s everything on the list.',
      });
      if (!g.meet) blocks.push(...finish(g));
    }
    return blocks;
  }
  return null;
}

/** Things you can buy for yourself at a café or a pub, for the time it takes. */
function treat(g: Game, verb: string, words: string[]): Block[] | null {
  const all = words.join(' ');
  const inside = g.inside >= 0 ? g.town.spots[g.inside] : null;
  const here = inside ? [inside, ...spotsHere(g).filter((sp) => sp.id !== inside.id)] : spotsHere(g);
  const want = (re: RegExp, tags: string[]) => re.test(all) && here.find((sp) => tags.includes(sp.kind.tag) && isOpen(g, sp));
  const coffee = want(/coffee|tea|latte|cappuccino|espresso|cake|bun/, ['amenity=cafe', 'shop=bakery']);
  if (coffee) {
    return [{ k: 'p', text: `You ${verb === 'drink' ? 'drink' : 'buy'} ${/tea/.test(all) ? 'a pot of tea' : /cake|bun/.test(all) ? 'something sticky' : 'a coffee'} standing up at the counter at ${coffee.name ?? `the ${coffee.kind.noun}`}. It helps.` }, ...pass(g, 7)];
  }
  const pint = want(/pint|beer|ale|drink|wine|whisky|cider/, ['amenity=pub', 'amenity=bar']);
  if (pint) {
    const meetHere = g.meet && g.town.spots[g.meet.spot].id === pint.id;
    return [
      { k: 'p', text: `You have a quick one at ${pint.name ?? 'the bar'}.${meetHere ? '' : ' The clock over the bar seems to run fast.'}` },
      ...pass(g, 15),
    ];
  }
  const chips = want(/chips|food|kebab|burger|pizza|fries|snack/, ['amenity=fast_food']);
  if (chips) return [{ k: 'p', text: `You eat ${say('chips', 'fries')} out of the paper as you stand on the ${say('pavement', 'sidewalk')}.` }, ...pass(g, 6)];
  return null;
}

function listBlock(g: Game): Block {
  const items = g.errands.map((e) => ({ text: e.def.line, done: e.done }));
  if (g.meet) items.push({ text: `${g.meet.friend}, ${g.town.spots[g.meet.spot].name}, ${clockDigits(g.close)}`, done: g.meet.done });
  return { k: 'list', items };
}

function examineSpot(g: Game, sp: Spot): Block[] {
  const spans = hoursOf(g, sp);
  const until = closesAfter(spans, g.clock);
  const next = opensAfter(spans, g.clock);
  const real = !!spansOn(sp.tags.opening_hours, g.sky.weekday);
  const bits: string[] = [`${capital(spotPhrase(sp))}.`];
  if (sp.kind.group !== 'thing') {
    if (until !== null) bits.push(real ? `A sign on the door says it is open today until ${clockDigits(until)}.` : `It looks open.`);
    else bits.push(next !== null ? `It is shut until ${clockDigits(next)}.` : real ? 'The sign on the door says it is closed today.' : 'It looks shut.');
  }
  const useful = g.errands.filter((e) => !e.done && matches(e.def, sp)).map((e) => lower(e.def.line));
  if (useful.length) bits.push(`You could see to ${list(useful)} here.`);
  if (g.meet && g.meet.spot === sp.id && !g.meet.done) bits.push(`This is where you’re meeting ${g.meet.friend}.`);
  return [{ k: 'p', text: bits.join(' ') }];
}

function hint(g: Game): Block[] {
  const pending = g.errands.filter((e) => !e.done);
  if (!pending.length) {
    if (g.meet && !g.meet.done) {
      const sp = g.town.spots[g.meet.spot];
      return [{ k: 'p', text: `Only ${g.meet.friend} left. ${sp.name} is ${direction(g, sp)}.` }];
    }
    return [{ k: 'p', text: 'There’s nothing left to do but wander.' }];
  }
  const d = distances(g.town, g.at);
  let best: { e: Errand; sp: Spot; dist: number } | null = null;
  for (const e of pending)
    for (const sp of g.town.spots)
      if (sp.at >= 0 && matches(e.def, sp) && isOpen(g, sp) && d[sp.at] < (best?.dist ?? Infinity)) best = { e, sp, dist: d[sp.at] };
  if (!best) return [{ k: 'p', text: 'You rack your brains, but nothing comes to mind.' }];
  const seen = g.seen.has(best.sp.id);
  const name = best.sp.name ?? `the ${best.sp.kind.noun}`;
  return [
    {
      k: 'p',
      text: seen
        ? `For “${lower(best.e.def.line)}”, you remember ${name} on ${g.town.stops[best.sp.at].title}.`
        : `For “${lower(best.e.def.line)}”, you have a feeling there’s ${an(best.sp.kind.noun)} somewhere ${direction(g, best.sp)}.`,
    },
  ];
}

function direction(g: Game, sp: Spot): string {
  const s = g.town.stops[g.at];
  const dist = Math.hypot(sp.x - s.x, sp.y - s.y);
  if (sp.at === g.at) return 'right here';
  const ang = (Math.atan2(sp.x - s.x, sp.y - s.y) * 180) / Math.PI;
  const dir = COMPASS_WORD[COMPASS[(Math.round(ang / 45) + 8) % 8]];
  return `${dist < 120 ? 'close by' : dist < 300 ? 'a little way' : 'some way'} to the ${dir}`;
}

const HELP = [
  'Walk by typing a direction: NORTH, SOUTH-EAST, or just N or SE. You can also type a street’s name, or BACK.',
  'LOOK describes where you are again. LOOK AT anything, or EXAMINE it (X for short): a shop, the sky, your list.',
  'ENTER a shop to step inside, and do your errands with plain words: BUY BREAD, POST LETTER, RETURN BOOK, GET CASH.',
  'LIST reads your list. INVENTORY (I) shows what you carry. TIME, SCORE, WAIT, HINT, MAP.',
  'RESTART begins the afternoon again; ELSEWHERE takes you to another town.',
];

/** Run one command. */
export function run(g: Game, raw: string): Block[] {
  // A tapped exit names its walk exactly, so two ways with the same street name can't be confused.
  const tapped = /^#e(\d+)$/.exec(raw.trim());
  if (tapped) {
    const x = exitsOf(g.town, g.at).find((e) => e.edge === Number(tapped[1]));
    if (x) {
      g.moves++;
      return walk(g, x);
    }
  }
  const text = normalise(raw);
  if (!text) return [{ k: 'p', text: 'Say again?' }];
  const words = text.split(' ').filter(Boolean);
  const verb = words[0];
  const rest = words.slice(1).filter((w) => !FILLER.has(w));
  g.moves++;

  // Directions on their own or after a verb of going.
  const dirWord = DIRS[verb] ?? (GO.has(verb) && rest.length === 1 ? DIRS[rest[0]] : undefined);
  if (dirWord) {
    const x = exitsOf(g.town, g.at).find((e) => e.dir === dirWord);
    if (!x) {
      const exits = exitsOf(g.town, g.at);
      return [{ k: 'p', text: `You can’t go ${COMPASS_WORD[dirWord]} from here. ${exitsLine(exits)}` }];
    }
    return walk(g, x);
  }
  if (['u', 'd', 'up', 'down'].includes(verb) && rest.length === 0) {
    const steps = exitsOf(g.town, g.at).filter((x) => g.town.edges[x.edge].hw === 'steps');
    if (steps.length === 1) return walk(g, steps[0]);
    return [{ k: 'p', text: 'Say which way: a compass direction, or the name of the street.' }];
  }

  switch (verb) {
    case 'l':
    case 'look':
      if (!rest.length || (rest.length === 1 && rest[0] === 'around')) {
        g.moves--;
        if (g.inside >= 0) {
          const sp = g.town.spots[g.inside];
          return [{ k: 'title', text: sp.name ?? capital(sp.kind.noun) }, { k: 'p', text: insideLine(sp.kind, hash(sp.id)) }, { k: 'p', text: 'OUT takes you back onto the street.' }];
        }
        const d = describe(g.town, g.at, { clock: g.clock, sky: g.sky }, false);
        return [{ k: 'title', text: d.title }, ...d.paras.map((p): Block => ({ k: 'p', text: p })), { k: 'exits', exits: d.exits }];
      }
      return examine(g, rest.filter((w) => w !== 'at'));
    case 'x':
    case 'examine':
    case 'read':
    case 'inspect':
    case 'check':
    case 'study':
      g.moves--;
      return examine(g, rest);
    case 'i':
    case 'inv':
    case 'inventory':
      g.moves--;
      return [{ k: 'p', text: `You are carrying ${list(['your list', ...g.items.map((i) => i.name), 'your phone'])}.` }];
    case 'list':
    case 'errands':
      g.moves--;
      return [listBlock(g)];
    case 'score': {
      g.moves--;
      const s = scoreOf(g);
      return [{ k: 'p', text: `Your score is ${s.score} of a possible ${s.max} (${list(s.parts)}), in ${g.moves} moves.` }];
    }
    case 'time':
    case 'watch':
    case 'clock':
      g.moves--;
      return [{ k: 'p', text: `Your watch says ${clockDigits(g.clock)}. The shops shut at ${clockDigits(g.close)}${g.clock < g.sky.sunset ? `, and the sun sets at ${clockDigits(g.sky.sunset)}` : ''}.` }];
    case 'z':
    case 'wait': {
      if (g.meet && !g.meet.done && g.town.spots[g.meet.spot].at === g.at && g.clock < g.close) {
        const out: Block[] = [{ k: 'p', text: 'You find a seat and watch the door.' }, ...pass(g, g.close - g.clock)];
        return out.concat(meetCheck(g));
      }
      return [{ k: 'p', text: 'Time passes.' }, ...pass(g, 5)];
    }
    case 'back':
    case 'return':
    case 'retreat':
      if (verb === 'return' && rest.length) break;
      return goBack(g);
    case 'out':
    case 'exit':
    case 'leave':
    case 'outside':
      if (g.inside >= 0) {
        const sp = g.town.spots[g.inside];
        g.inside = -1;
        return [{ k: 'p', text: `You step out of ${sp.name ?? `the ${sp.kind.noun}`} and back onto the street.` }, ...pass(g, 1)];
      }
      if (verb === 'exit' && !rest.length) return [{ k: 'p', text: exitsLine(exitsOf(g.town, g.at)) }];
      return [{ k: 'p', text: 'You are already outside.' }];
    case 'enter':
    case 'visit':
    case 'in':
    case 'inside':
      return enter(g, rest);
    case 'help':
    case 'about':
    case '?':
    case 'instructions':
      g.moves--;
      g.helped = true;
      return HELP.map((t): Block => ({ k: 'p', text: t }));
    case 'hint':
    case 'hints':
      return hint(g);
    case 'map':
      g.moves--;
      return [{ k: 'ui', action: 'map' }, { k: 'p', text: 'You check the map you have been keeping in pencil on squared paper.' }];
    case 'brief':
      g.moves--;
      g.verbose = false;
      return [{ k: 'p', text: 'Places you have been before will get a short description.' }];
    case 'verbose':
      g.moves--;
      g.verbose = true;
      return [{ k: 'p', text: 'Every place will get its full description, every time.' }];
    case 'restart':
      g.moves--;
      return [{ k: 'ui', action: 'restart' }];
    case 'elsewhere':
    case 'quit':
    case 'q':
    case 'travel':
      g.moves--;
      return [{ k: 'ui', action: 'elsewhere' }];
    case 'xyzzy':
    case 'plugh':
      return [{ k: 'p', text: 'Nothing happens. A pigeon regards you with contempt.' }];
    case 'jump':
      return [{ k: 'p', text: 'You jump on the spot. A small child stares at you.' }];
    case 'sing':
    case 'whistle':
      return [{ k: 'p', text: 'You hum a few bars of something. It sounds better in your head.' }];
    case 'dance':
      return [{ k: 'p', text: 'You do a little shuffle. Nobody minds.' }];
    case 'shout':
    case 'scream':
    case 'yell':
      return [{ k: 'p', text: 'Heads turn. You pretend you were calling a dog.' }];
    case 'sleep':
    case 'nap':
      return [{ k: 'p', text: 'There’s far too much to do.' }];
    case 'hello':
    case 'hi':
    case 'talk':
    case 'ask':
    case 'say':
      return [{ k: 'p', text: 'People nod back, but everyone is in a hurry at this time of day.' }];
    case 'call':
    case 'phone':
    case 'text':
      if (g.meet) return [{ k: 'p', text: `You text ${g.meet.friend}: “On my way.” Three dots appear, then a thumbs-up.` }];
      return [{ k: 'p', text: 'Nobody needs calling.' }];
    case 'eat':
      if (rest.some((w) => w === 'bread' || w === 'loaf') && g.items.some((i) => i.id === 'bread'))
        return [{ k: 'p', text: 'You tear the end off the loaf. Nobody need know.' }];
      if (rest.some((w) => w.startsWith('apple')) && g.items.some((i) => i.id === 'apples')) return [{ k: 'p', text: 'You eat an apple. It is a good apple.' }];
      break;
  }

  // Going by street name, or into a place by name.
  if (GO.has(verb) && rest.length) {
    const exits = exitsOf(g.town, g.at);
    let bx: Exit | null = null;
    let bs = 0;
    for (const x of exits) {
      const e = g.town.edges[x.edge];
      const s = Math.max(e.name ? nameMatch(e.name, rest) : 0, e.bridgeName ? nameMatch(e.bridgeName, rest) : 0, nameMatch(x.how, rest) * 0.5);
      if (s > bs) {
        bs = s;
        bx = x;
      }
    }
    if (bx && bs > 0.5) return walk(g, bx);
    const sp = findSpot(g, rest);
    if (sp) return enter(g, rest);
    return [{ k: 'p', text: 'You can’t see a way like that from here. Try a compass direction, or the name of a street.' }];
  }

  const errand = errandHere(g, verb === 'pick' ? 'pick' : verb, rest);
  if (errand) return errand;
  if (['buy', 'get', 'drink', 'have', 'order', 'eat', 'purchase'].includes(verb)) {
    const t = treat(g, verb, rest);
    if (t) return t;
    return [{ k: 'p', text: rest.length ? 'There’s nothing like that for sale here.' : 'Buy what?' }];
  }
  if (['post', 'return', 'collect', 'withdraw', 'pick', 'fetch', 'send', 'mail', 'cut'].includes(verb))
    return [{ k: 'p', text: rest.length ? 'That isn’t one of your errands.' : `${capital(verb)} what?` }];

  g.moves--;
  const tip = g.helped ? '' : ' (Type HELP for some ideas.)';
  return [{ k: 'p', text: `I don’t know how to “${verb}”.${tip}` }];
}

function goBack(g: Game): Block[] {
  if (g.prev < 0) return [{ k: 'p', text: 'You haven’t been anywhere yet.' }];
  const x = exitsOf(g.town, g.at).find((e) => e.to === g.prev);
  if (!x) return [{ k: 'p', text: 'You can’t retrace your steps from here.' }];
  return walk(g, x);
}

function enter(g: Game, words: string[]): Block[] {
  const here = spotsHere(g).filter((sp) => sp.kind.enter);
  const sp = words.length ? findSpot(g, words) : here.length === 1 ? here[0] : null;
  if (!sp) return [{ k: 'p', text: here.length ? `Enter which? ${capital(list(here.slice(0, 5).map((s) => s.name ?? `the ${s.kind.noun}`)))}${here.length > 5 ? ', or another' : ''}?` : 'There’s nowhere to go in here.' }];
  if (!sp.kind.enter) return [{ k: 'p', text: `You can’t go into ${sp.name ?? `the ${sp.kind.noun}`}.` }];
  if (!isOpen(g, sp)) {
    const next = opensAfter(hoursOf(g, sp), g.clock);
    return [{ k: 'p', text: `${capital(sp.name ?? `the ${sp.kind.noun}`)} is shut${next !== null ? ` until ${clockDigits(next)}` : ' for the day'}. You peer through the glass.` }];
  }
  g.inside = sp.id;
  const out: Block[] = [{ k: 'title', text: sp.name ?? capital(sp.kind.noun) }, { k: 'p', text: insideLine(sp.kind, hash(sp.id)) }];
  const useful = g.errands.filter((e) => !e.done && matches(e.def, sp));
  if (useful.length) out.push({ k: 'event', text: `You can see to ${list(useful.map((e) => `“${lower(e.def.line)}”`))} here.` });
  out.push(...pass(g, 1));
  if (g.meet && g.meet.spot === sp.id) out.push(...meetCheck(g));
  return out;
}

function examine(g: Game, words: string[]): Block[] {
  if (!words.length) return [{ k: 'p', text: 'Look at what?' }];
  const all = words.join(' ');
  if (/^(list|note|errands|paper list)$/.test(all)) return [listBlock(g)];
  if (/^(map|notebook|pencil)$/.test(all)) return [{ k: 'ui', action: 'map' }, { k: 'p', text: 'Your map, in pencil on squared paper, shows everywhere you have been.' }];
  if (/^(sky|weather|clouds|sun|rain)$/.test(all)) {
    const w = weatherLine(g.sky.weather, lightAt(g.clock, g.sky.sunset));
    const sun = g.clock < g.sky.sunset ? `The sun sets at ${clockDigits(g.sky.sunset)}.` : `The sun set at ${clockDigits(g.sky.sunset)}.`;
    return [{ k: 'p', text: `${w ?? 'You look up.'} ${sun}` }];
  }
  if (/^(watch|time|clock)$/.test(all)) return [{ k: 'p', text: `Your watch says ${clockDigits(g.clock)}.` }];
  if (/^(me|self|myself)$/.test(all)) return [{ k: 'p', text: 'You look like someone with a lot of errands.' }];
  if (/^(phone)$/.test(all))
    return [{ k: 'p', text: g.meet ? `Your last message, from ${g.meet.friend}: “${g.town.spots[g.meet.spot].name}, ${clockDigits(g.close)}? Don’t be late.”` : 'No new messages.' }];
  if (/^(shops|places|buildings|around|everything|shop|street)$/.test(all)) {
    const here = spotsHere(g);
    if (!here.length) return [{ k: 'p', text: 'There’s nothing much here but the street itself.' }];
    return [{ k: 'p', text: `${capital(list(here.map(spotPhrase)))}.` }];
  }
  const item = g.items.find((i) => i.nouns.some((n) => words.includes(n)));
  if (item) return [{ k: 'p', text: item.desc }];
  const sp = g.inside >= 0 && nameMatch(g.town.spots[g.inside].name ?? '', words) ? g.town.spots[g.inside] : findSpot(g, words);
  if (sp) return examineSpot(g, sp);
  const exits = exitsOf(g.town, g.at);
  for (const x of exits) {
    const e = g.town.edges[x.edge];
    if (e.name && nameMatch(e.name, words) > 0.5) return [{ k: 'p', text: `${e.name} leads ${x.dir ? COMPASS_WORD[x.dir] : 'away'} from here.` }];
  }
  return [{ k: 'p', text: 'You can’t see any such thing.' }];
}

/** For the map and the status line. */
export function status(g: Game): string {
  const s = scoreOf(g);
  return `${clockDigits(g.clock)} · Score ${s.score} · Moves ${g.moves}`;
}
