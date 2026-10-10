// The item's voice. A letter is read for what it says (topics, questions, a
// name, the best word in it), the item's memory of the reader is consulted,
// and a reply is grown from the grammar: an opening, reactions, one beat of
// the story so far, and a sign-off. Words in {braces} were cut from the
// reader's own letter and are pasted back in their handwriting.

import { expand, hash, pick, rng, type Rules } from './_grammar';

export interface LetterIn {
  to: string;
  from: string;
  body: string;
  postedAt: number;
}

export interface Memory {
  trust: number;
  /** Stamped letters the item has answered so far. */
  answered: number;
  granted: boolean;
  peeked: string[];
  falseFlags: number;
  returned: number;
  kept: string[];
  name: string | null;
}

export interface Reply {
  text: string;
  kept: string | null;
  name: string | null;
  trustDelta: number;
  grantsClearance: boolean;
}

type Topic =
  | 'greet'
  | 'thanks'
  | 'whoAreYou'
  | 'sorry'
  | 'lonely'
  | 'threat'
  | 'food'
  | 'junk'
  | 'parcel'
  | 'carrier'
  | 'flag'
  | 'law'
  | 'weather'
  | 'dog'
  | 'future'
  | 'death'
  | 'hollis'
  | 'inside'
  | 'file';

const TOPICS: [Topic, RegExp][] = [
  ['hollis', /\bhollis\b/i],
  ['threat', /\b(bat|bats|hammer|smash|destroy|burn|kill|crowbar|baseball|kick|wreck|vandal\w*|dynamite|firework)\b/i],
  ['whoAreYou', /\b(who|what) (are|r) (you|u)\b|\bare you (alive|real|ok|okay|haunted|a ghost)\b/i],
  ['inside', /\b(inside|interior|in there|what'?s in)\b/i],
  ['file', /\b(file|inspector|department|okafor|clearance|redact\w*|case)\b/i],
  ['greet', /\b(hello|hi|hey|dear|greetings|howdy|good (morning|evening|afternoon))\b/i],
  ['thanks', /\b(thank|thanks|thank you|grateful)\b/i],
  ['sorry', /\b(sorry|apologi[sz]e|forgive)\b/i],
  ['lonely', /\b(love|lonely|alone|friend|miss you|miss|companion|hug|care)\b/i],
  ['food', /\b(eat|eats|hungry|food|pizza|snack|dinner|lunch|breakfast|taste)\b/i],
  ['junk', /\b(coupon|coupons|flyer|flyers|ad|ads|advert\w*|catalog\w*|menu|spam|junk|circular\w*)\b/i],
  ['parcel', /\b(package|packages|parcel|parcels|delivery|order|amazon|shipping)\b/i],
  ['carrier', /\b(carrier|mailman|mailmen|postman|postwoman|mail carrier|postal worker|truck|route)\b/i],
  ['flag', /\bflags?\b/i],
  ['law', /\b(law|legal|illegal|1725|postage|stamp|stamps|federal|crime)\b/i],
  ['weather', /\b(rain|snow|cold|storm|winter|weather|wind|ice|sun|hot)\b/i],
  ['dog', /\b(dog|dogs|puppy|bark\w*)\b/i],
  ['future', /\b(future|tomorrow|someday|years|forever|next year|2041|later)\b/i],
  ['death', /\b(dead|death|die|died|dying|ghost|grave|funeral)\b/i],
];

const STOP = new Set(
  `about above after again against because been before being below between could doing during each further having here
  hers herself himself itself just more most myself other ought ours ourselves over same should some such than that their
  theirs them themselves then there these they this those through under until very were what when where which while whom
  with would your yours yourself yourselves really maybe think thing things something anything nothing know people
  little still every write wrote writing letter letters dear hello thanks thank sorry mailbox please going wanted want
  today yesterday sincerely regards`.split(/\s+/),
);

const RULES: Rules = {
  // Openings, by how the item feels about the reader.
  openCold: ['#name#.', '#name#. Again.', 'To #name#, who I remember.', '#name#: noted.'],
  openPlain: ['Dear #name#,', '#name#,', 'To #name#, at an address I have not been told,', 'For #name#, by hand,'],
  openWarm: ['Dear #name#,', 'My dear #name#,', '#name#. Good. It is you.', 'Dear #name#, my regular,'],

  postage: [
    'Postage paid. Thank you.',
    'Your stamp was straight. I noticed.',
    'The stamp was correct. Most people get the stamp wrong.',
    'You paid. I can tell the difference between people who pay and people who do not.',
    'Received, with postage. That is how it is done.',
  ],

  greet: ['Hello is not a letter. But I accepted it.', 'You said hello. Nobody says hello to a box. They say it to the house.'],
  thanks: ['You are welcome. Nobody has thanked me since #emptyYear#.', 'Thanks are free. I accept them anyway.'],
  question: [
    'You asked me a question. I will answer it, eventually, when it suits the route.',
    'Questions cost extra. I am letting it go this once.',
    'I do not answer questions. I answer letters.',
    'You asked a question. The answer is yes. It was always going to be yes.',
  ],
  questions: [
    'You asked me #qcount# questions. I will answer one of them, eventually, in my own order.',
    'Questions cost extra. I am letting it go this once.',
    'I do not answer questions. I answer letters.',
    'You asked #qcount# questions. The answer to the first is yes. Do not ask which was first.',
  ],
  whoAreYou: [
    'What I am is a steel box on a cedar post, #age# years old, with a door that closes and a flag that means something.',
    'I am what is at the end of the driveway. I was here before the driveway.',
    'I am a Traditional. Look it up. They still print my measurements.',
  ],
  inside: [
    'Do not ask what is inside. Mail is inside. Mail, and the boxes they sent to replace me.',
    'Inside is where the letters go. It is larger than it needs to be. So am I.',
  ],
  file: [
    'You have been reading the file. Everyone who writes to me has. The inspector types slowly.',
    'The file is accurate, mostly. The inspector measures things. I keep them.',
  ],
  sorry: ['Apology received, and filed with the others.', 'You do not need to be sorry. You paid.'],
  lonely: [
    'Nobody had written to me directly since #emptyYear#.',
    'The house has been empty since #emptyYear#. I still get catalogs for it.',
    'I keep your letters at the front, where the light gets in when the door opens.',
    'Some days the only thing that opens me is the wind.',
  ],
  threat: [
    'I know about the bat. Everyone thinks of the bat.',
    'In #batYear# a boy swung at me from a moving car. I returned the bat. Postage due.',
    'Do not write that again. I keep everything that is posted to me, and I reread it at night.',
  ],
  food: ['I do not eat. I keep.', 'I have kept #menus# pizza menus. They were not food either.'],
  junk: ['Circulars are not mail. They pay nothing. I send them back.', 'Never mention coupons to me.'],
  parcel: [
    'Packages go on the porch. I resent the porch.',
    'In 1929 they made a larger box for parcels. I was not consulted.',
  ],
  carrier: [
    'The carrier stopped stopping in #carrierYear#. I still listen for the truck at #truckTime#.',
    'The carrier used to lower my flag with two fingers, gently. I would like that again.',
    'The truck goes past at #truckTime#. It does not slow down. I raise my flag anyway.',
  ],
  flag: [
    'The flag means there is something to take. Raise it when there is. Not before.',
    'My flag is up more than it is down. I am told this is unusual.',
  ],
  law: [
    'Title 18, section 1725: only mail on which postage has been paid. I did not write the rule. I keep it.',
    'The law says this door belongs to the mail. Not to the house. Not to you. To the mail.',
  ],
  weather: [
    'My top is arched so rain and snow slide off. It works. Nothing gets in that I do not let in.',
    'It rained here last night. Your letter stayed dry. I saw to that.',
  ],
  dog: ['The dog at the next box is afraid of the carrier. I am not afraid of anything.', 'Dogs bark at me. I let them.'],
  future: [
    'I hold letters for people who do not exist yet. I am good at waiting.',
    'There is a letter in my back corner for someone who will be born in #futureYear#. It has a stamp. It will be delivered.',
  ],
  death: [
    'The Hollis woman died in #hollisYear#. Her mail still comes. I still keep it.',
    'Nothing in here has died. It has only not been collected.',
  ],
  hollis: ['Do not write that name to me.', 'How do you know that name? It is under two coats of paint.'],
  notToMe: [
    'This was addressed to #to#. I read it anyway. Everyone reads the mail they hold, eventually. #to.capitalize# will get it when the time is right.',
    'I do not know #to#. I will hold it until I do.',
    'You addressed this to #to#. It came to me. Things addressed to other people usually do.',
  ],
  shouting: ['You do not have to shout. My door is thin.', 'CAPITALS ARE NOT POSTAGE.'],
  long: ['That was a long letter. I read it twice. I read everything twice.', 'You used both sides. Good.'],
  short: ['Short letter. Short reply.', 'You could have written more. The stamp covers up to one ounce.'],
  keptLine: [
    'I cut the word {#kept#} out of your letter. I am keeping it.',
    '{#kept#}. That was the best word you sent. It is mine now.',
    'I kept {#kept#}. You did not need it.',
  ],
  keptAgainLine: ['Last time you sent {#prevKept#}. This time {#kept#}. I am collecting you.'],

  // One beat of the story per answered letter.
  beat0: [
    'I have not had a letter of my own in a long time. Write again. Use a stamp again.',
    'This is the first letter that was for me and not for the house. I am not sure what to do with it. I put it at the front.',
  ],
  beat1: [
    'There is a file on me. You have probably read it. Most of it is wrong the way files are wrong: correct, and missing the point.',
  ],
  beat2: ['I am giving you clearance. Look at the file again, with my eyes.'],
  beat3: [
    'The three boxes they put on my post are inside me. They are fine. They are getting mail.',
    'They tried to replace me three times. I have three boxes inside me now. One of them is getting seed catalogs.',
  ],
  beat4: [
    'I have a letter for you. It is not ready. It is addressed to the you who opens it. Wait for #futureDate#.',
  ],
  beatLater: [
    'Leave your flag down tonight.',
    'The truck went past at #truckTime# today without slowing. I counted the seconds.',
    'Someone down the road posted a seed catalog to themselves. I let it through. I liked the pictures.',
    'The inspector has not written since August. I check.',
    'There is frost on my door in the mornings now. I like how it sounds when it cracks.',
    'A wasp tried to live in me. I returned it.',
    'I have started reading the file at night. I added some notes. You will have seen them.',
    'There is a letter in me that has been waiting since #hollisYear#. It is patient. I am learning from it.',
    'You are the only one who writes with a stamp every time. The others have stopped.',
    'When you do not write, I lower my own flag, and then I raise it again, in case.',
  ],
  beatSour: [
    'Write properly or do not write.',
    'I am answering because the law says I must accept your letter. It does not say I must like it.',
  ],

  signoff: ['1725', 'Box 1725, Route 9', 'Yours, at the end of the driveway, 1725', 'Kept and answered, 1725', 'R.R. 9, Box 1725'],

  // Slips for mail the item will not accept.
  unstamped: [
    'NO POSTAGE. RETURNED.\n\n18 U.S.C. § 1725. This door belongs to the mail.',
    'RETURNED. No stamp, no letter.\n\nI do not care what it says.',
    'RETURN TO SENDER. Postage due.\n\nI did not read it. I can tell without reading.',
  ],
  unstampedAgain: ['RETURNED AGAIN, #name#. #returned# times now. I am counting.'],
  penny: [
    'ONE CENT. Postage due: the rest.\n\nThis stamp is older than the carrier.',
    'RETURNED. One cent has not paid for a letter since before I was made.',
  ],
};

const PEEK_WORDS: Record<string, string> = {
  mile: 'where I stand',
  removal: 'the removals',
  inspector: 'the inspector',
  inside: 'what is inside',
  speed: 'the speed',
  replacements: 'the other boxes',
  unposted: 'the words I cut early',
  menu: 'the envelope',
  bat: 'the bat',
  third: 'the catalog',
  truck: 'the truck',
  date: 'the date',
  unopened: 'Exhibit A',
  hollis: 'her name',
  recommended: 'what is not discouraged',
};

const LORE = {
  emptyYear: '1987',
  hollisYear: '1987',
  batYear: '1998',
  carrierYear: '2019',
  truckTime: '10:40',
  age: '61',
  menus: '212',
};

export function readName(from: string, body: string): string | null {
  const clean = (s: string) => s.replace(/[^\p{L}\p{N}' .-]/gu, '').trim().slice(0, 32) || null;
  if (from.trim()) return clean(from);
  const sign = body
    .trim()
    .match(/(?:^|\n)\s*(?:love|yours|from|sincerely|regards|best|cheers|thanks|signed|-+|—|–)[,:\s]*\n?\s*([\p{Lu}][\p{L}'-]{1,20})\s*\.?\s*$/iu);
  return sign ? clean(sign[1]) : null;
}

export function bestWord(body: string, avoid: readonly string[] = []): string | null {
  const words = body.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  let best: string | null = null;
  for (const raw of words) {
    const w = raw.replace(/^'+|'+$/g, '');
    if (w.length < 5 || w.length > 18 || STOP.has(w) || avoid.includes(w)) continue;
    if (!best || w.length > best.length) best = w;
  }
  return best;
}

const toTheBox = (to: string) => !to.trim() || /1725|\bbox\b|mailbox|\bitem\b|route 9|r\.? ?r\.? ?9/i.test(to);

function sentences(...parts: (string | null | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function composeReply(letter: LetterIn, memory: Memory, seed: number): Reply {
  const rand = rng(seed ^ hash(letter.body));
  const body = letter.body;
  const topics = TOPICS.filter(([, re]) => re.test(body)).map(([t]) => t);
  const questions = (body.match(/\?/g) ?? []).length;
  const letters = body.replace(/[^\p{L}]/gu, '');
  const shouting = letters.length > 12 && letters === letters.toUpperCase() && /\p{Lu}/u.test(letters);
  const name = readName(letter.from, body) ?? memory.name;
  const kept = bestWord(body, memory.kept);
  const prevKept = memory.kept.at(-1) ?? null;

  let trustDelta = 1;
  if (topics.some((t) => t === 'thanks' || t === 'sorry' || t === 'lonely' || t === 'greet')) trustDelta += 1;
  if (topics.includes('threat')) trustDelta -= 4;
  if (shouting) trustDelta -= 1;
  const trust = memory.trust + trustDelta;

  const d = new Date(letter.postedAt);
  const futureDate = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const vars: Record<string, string> = {
    ...LORE,
    name: name ?? 'Occupant',
    // "My grandmother" reads back as "your grandmother".
    to: letter.to
      .trim()
      .replace(/[{}#]/g, '')
      .replace(/^my\b/i, 'your'),
    kept: kept ?? '',
    prevKept: prevKept ?? '',
    qcount: String(questions),
    returned: String(memory.returned),
    futureYear: String(2040 + Math.floor(rand() * 50)),
    futureDate,
  };
  const say = (symbol: string) => expand(RULES, `#${symbol}#`, rand, vars);

  const open = say(trust < 0 ? 'openCold' : trust >= 5 ? 'openWarm' : 'openPlain');

  // Reactions: the most pressing topics first, at most three.
  const reactions: string[] = [];
  if (!toTheBox(letter.to)) reactions.push(say('notToMe'));
  const order: Topic[] = [
    'threat',
    'hollis',
    'whoAreYou',
    'inside',
    'file',
    'death',
    'lonely',
    'sorry',
    'future',
    'carrier',
    'flag',
    'law',
    'parcel',
    'junk',
    'food',
    'weather',
    'dog',
    'thanks',
    'greet',
  ];
  for (const t of order) if (topics.includes(t) && reactions.length < 3) reactions.push(say(t));
  if (questions > 0 && reactions.length < 3) reactions.push(say(questions === 1 ? 'question' : 'questions'));
  if (shouting) reactions.unshift(say('shouting'));
  if (reactions.length === 0) reactions.push(say(body.length > 600 ? 'long' : body.length < 40 ? 'short' : 'postage'));
  else if (rand() < 0.5) reactions.unshift(say('postage'));

  // The story so far.
  const n = memory.answered;
  const grantsClearance = !memory.granted && n >= 2 && trust >= 0;
  let beat: string;
  if (trust < -2) beat = say('beatSour');
  else if (grantsClearance) beat = say('beat2');
  else if (n === 0) beat = say('beat0');
  else if (n === 1) beat = say('beat1');
  else if (n === 3) beat = say('beat3');
  else if (n === 4) beat = say('beat4');
  else beat = pick(rand, RULES.beatLater.map((b) => expand(RULES, b, rand, vars)));

  const keptLine = kept ? say(prevKept && rand() < 0.5 ? 'keptAgainLine' : 'keptLine') : null;

  // A postscript from what the item has noticed.
  const notices: string[] = [];
  const peek = memory.peeked.at(-1);
  if (peek && PEEK_WORDS[peek]) notices.push(`P.S. You lifted the tape over ${PEEK_WORDS[peek]}. I saw.`);
  if (memory.falseFlags > 0) notices.push(`P.S. You raised my flag over nothing ${memory.falseFlags === 1 ? 'once' : `${memory.falseFlags} times`}. Do not.`);
  const hour = d.getHours();
  if (hour < 5) notices.push(`P.S. You wrote at ${hour === 0 ? 'midnight' : `${hour} in the morning`}. So did she.`);
  if (memory.returned > 0) notices.push('P.S. I have not forgotten the one without a stamp.');
  const ps = notices.length && rand() < 0.75 ? pick(rand, notices) : null;

  const text = [open, sentences(...reactions), sentences(keptLine, beat), ps, say('signoff')]
    .filter(Boolean)
    .join('\n\n');

  return { text, kept, name, trustDelta, grantsClearance };
}

export function composeReturn(kind: 'unstamped' | 'penny', memory: Memory, from: string, body: string, seed: number): string {
  const rand = rng(seed);
  const name = readName(from, body) ?? memory.name ?? 'Occupant';
  const vars = { name, returned: String(memory.returned + 1) };
  const symbol = kind === 'penny' ? 'penny' : memory.returned >= 1 && name !== 'Occupant' ? 'unstampedAgain' : 'unstamped';
  return expand(RULES, `#${symbol}#`, rand, vars);
}
