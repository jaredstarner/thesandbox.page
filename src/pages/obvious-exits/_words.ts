// What the story calls things: OpenStreetMap tags turned into nouns, groups, and the line you read
// when you step inside. British English by default; a town in the United States gets American words.

export type Tags = Record<string, string>;
export type English = 'gb' | 'us';

export type Group = 'shop' | 'food' | 'drink' | 'service' | 'civic' | 'faith' | 'sight' | 'transport' | 'thing';

export interface Kind {
  /** The tag that decided it, as `key=value`. */
  tag: string;
  /** Singular noun without an article: "bakery". */
  noun: string;
  plural: string;
  group: Group;
  /** How much it stands out in a description, 0 to 9. */
  weight: number;
  /** Can be walked into. */
  enter: boolean;
}

let english: English = 'gb';
export function setEnglish(e: English): void {
  english = e;
}
/** Pick the British or the American word. */
export const say = (gb: string, us: string): string => (english === 'us' ? us : gb);

type Row = [noun: string, plural: string, group: Group, weight: number, enter?: boolean];

// Nouns that differ across the Atlantic are functions of the current English.
const TABLE: Record<string, Row | (() => Row)> = {
  'shop=bakery': ['bakery', 'bakeries', 'shop', 5],
  'shop=butcher': () => [say('butcher’s', 'butcher shop'), say('butchers', 'butcher shops'), 'shop', 4],
  'shop=greengrocer': () => [say('greengrocer’s', 'produce store'), say('greengrocers', 'produce stores'), 'shop', 4],
  'shop=supermarket': ['supermarket', 'supermarkets', 'shop', 4],
  'shop=convenience': () => [say('corner shop', 'convenience store'), say('corner shops', 'convenience stores'), 'shop', 3],
  'shop=newsagent': () => [say('newsagent’s', 'newsstand'), say('newsagents', 'newsstands'), 'shop', 3],
  'shop=kiosk': ['kiosk', 'kiosks', 'shop', 2],
  'shop=florist': () => [say('florist’s', 'florist'), 'florists', 'shop', 4],
  'shop=books': () => [say('bookshop', 'bookstore'), say('bookshops', 'bookstores'), 'shop', 5],
  'shop=clothes': () => [say('clothes shop', 'clothing store'), say('clothes shops', 'clothing stores'), 'shop', 2],
  'shop=shoes': () => [say('shoe shop', 'shoe store'), say('shoe shops', 'shoe stores'), 'shop', 2],
  'shop=jewelry': () => [say('jeweller’s', 'jewelry store'), say('jewellers', 'jewelry stores'), 'shop', 2],
  'shop=hairdresser': () => [say('hairdresser’s', 'hair salon'), say('hairdressers', 'hair salons'), 'service', 1],
  'shop=barber': () => [say('barber’s', 'barbershop'), say('barbers', 'barbershops'), 'service', 2],
  'shop=beauty': ['beauty salon', 'beauty salons', 'service', 1],
  'shop=charity': () => [say('charity shop', 'thrift store'), say('charity shops', 'thrift stores'), 'shop', 3],
  'shop=second_hand': () => [say('second-hand shop', 'thrift store'), say('second-hand shops', 'thrift stores'), 'shop', 3],
  'shop=antiques': () => [say('antiques shop', 'antiques store'), say('antiques shops', 'antiques stores'), 'shop', 4],
  'shop=hardware': () => [say('ironmonger’s', 'hardware store'), say('ironmongers', 'hardware stores'), 'shop', 4],
  'shop=doityourself': () => [say('DIY shop', 'home improvement store'), say('DIY shops', 'home improvement stores'), 'shop', 3],
  'shop=optician': () => [say('optician’s', 'optometrist'), say('opticians', 'optometrists'), 'service', 2],
  'shop=chemist': () => [say('chemist’s', 'drugstore'), say('chemists', 'drugstores'), 'shop', 3],
  'shop=cosmetics': () => [say('cosmetics shop', 'cosmetics store'), say('cosmetics shops', 'cosmetics stores'), 'shop', 1],
  'shop=mobile_phone': () => [say('phone shop', 'phone store'), say('phone shops', 'phone stores'), 'shop', 1],
  'shop=electronics': () => [say('electronics shop', 'electronics store'), say('electronics shops', 'electronics stores'), 'shop', 1],
  'shop=computer': () => [say('computer shop', 'computer store'), say('computer shops', 'computer stores'), 'shop', 1],
  'shop=gift': () => [say('gift shop', 'gift shop'), 'gift shops', 'shop', 2],
  'shop=toys': () => [say('toyshop', 'toy store'), say('toyshops', 'toy stores'), 'shop', 3],
  'shop=sports': () => [say('sports shop', 'sporting goods store'), say('sports shops', 'sporting goods stores'), 'shop', 1],
  'shop=outdoor': () => [say('outdoor shop', 'outdoor store'), say('outdoor shops', 'outdoor stores'), 'shop', 1],
  'shop=stationery': () => [say('stationer’s', 'stationery store'), say('stationers', 'stationery stores'), 'shop', 3],
  'shop=art': ['art shop', 'art shops', 'shop', 2],
  'shop=music': () => [say('record shop', 'record store'), say('record shops', 'record stores'), 'shop', 3],
  'shop=musical_instrument': ['instrument shop', 'instrument shops', 'shop', 3],
  'shop=furniture': () => [say('furniture shop', 'furniture store'), say('furniture shops', 'furniture stores'), 'shop', 1],
  'shop=houseware': () => [say('kitchen shop', 'housewares store'), say('kitchen shops', 'housewares stores'), 'shop', 1],
  'shop=kitchen': () => [say('kitchen shop', 'kitchen store'), say('kitchen shops', 'kitchen stores'), 'shop', 1],
  'shop=department_store': ['department store', 'department stores', 'shop', 4],
  'shop=deli': ['delicatessen', 'delicatessens', 'shop', 4],
  'shop=cheese': () => [say('cheesemonger’s', 'cheese shop'), say('cheesemongers', 'cheese shops'), 'shop', 4],
  'shop=wine': () => [say('wine merchant’s', 'wine store'), say('wine merchants', 'wine stores'), 'shop', 3],
  'shop=alcohol': () => [say('off-licence', 'liquor store'), say('off-licences', 'liquor stores'), 'shop', 2],
  'shop=confectionery': () => [say('sweet shop', 'candy store'), say('sweet shops', 'candy stores'), 'shop', 3],
  'shop=chocolate': ['chocolatier', 'chocolatiers', 'shop', 3],
  'shop=tea': ['tea merchant', 'tea merchants', 'shop', 3],
  'shop=coffee': ['coffee merchant', 'coffee merchants', 'shop', 3],
  'shop=seafood': () => [say('fishmonger’s', 'fish market'), say('fishmongers', 'fish markets'), 'shop', 4],
  'shop=dry_cleaning': () => [say('dry cleaner’s', 'dry cleaner'), 'dry cleaners', 'service', 2],
  'shop=laundry': () => [say('launderette', 'laundromat'), say('launderettes', 'laundromats'), 'service', 2],
  'shop=locksmith': ['locksmith', 'locksmiths', 'service', 2],
  'shop=shoe_repair': ['cobbler', 'cobblers', 'service', 3],
  'shop=tailor': ['tailor', 'tailors', 'service', 2],
  'shop=bicycle': () => [say('bike shop', 'bike shop'), 'bike shops', 'shop', 2],
  'shop=pet': () => [say('pet shop', 'pet store'), say('pet shops', 'pet stores'), 'shop', 2],
  'shop=tobacco': () => [say('tobacconist’s', 'smoke shop'), say('tobacconists', 'smoke shops'), 'shop', 2],
  'shop=e-cigarette': ['vape shop', 'vape shops', 'shop', 0],
  'shop=bookmaker': () => [say('bookmaker’s', 'betting shop'), say('bookmakers', 'betting shops'), 'shop', 1],
  'shop=travel_agency': ['travel agent', 'travel agents', 'service', 1],
  'shop=estate_agent': () => [say('estate agent’s', 'real estate office'), say('estate agents', 'real estate offices'), 'service', 0],
  'shop=photo': () => [say('photo shop', 'photo store'), say('photo shops', 'photo stores'), 'shop', 2],
  'shop=frame': ['framer', 'framers', 'shop', 2],
  'shop=fabric': () => [say('fabric shop', 'fabric store'), say('fabric shops', 'fabric stores'), 'shop', 2],
  'shop=hearing_aids': ['hearing centre', 'hearing centres', 'service', 0],
  'shop=variety_store': () => [say('pound shop', 'dollar store'), say('pound shops', 'dollar stores'), 'shop', 1],
  'shop=general': ['general store', 'general stores', 'shop', 3],
  'shop=newspaper': () => [say('newsagent’s', 'newsstand'), say('newsagents', 'newsstands'), 'shop', 3],
  'office=estate_agent': () => [say('estate agent’s', 'real estate office'), say('estate agents', 'real estate offices'), 'service', 0],
  'amenity=pub': () => [say('pub', 'bar'), say('pubs', 'bars'), 'drink', 6],
  'amenity=bar': ['bar', 'bars', 'drink', 4],
  'amenity=biergarten': ['beer garden', 'beer gardens', 'drink', 4],
  'amenity=cafe': ['café', 'cafés', 'food', 4],
  'amenity=restaurant': ['restaurant', 'restaurants', 'food', 3],
  'amenity=fast_food': () => [say('takeaway', 'fast-food place'), say('takeaways', 'fast-food places'), 'food', 2],
  'amenity=ice_cream': ['ice cream parlour', 'ice cream parlours', 'food', 3],
  'amenity=bank': ['bank', 'banks', 'service', 3],
  'amenity=atm': () => [say('cash machine', 'ATM'), say('cash machines', 'ATMs'), 'thing', 1, false],
  'amenity=pharmacy': () => [say('chemist’s', 'pharmacy'), say('chemists', 'pharmacies'), 'shop', 4],
  'amenity=post_office': ['post office', 'post offices', 'civic', 5],
  'amenity=post_box': () => [say('post box', 'mailbox'), say('post boxes', 'mailboxes'), 'thing', 2, false],
  'amenity=library': ['library', 'libraries', 'civic', 6],
  'amenity=townhall': ['town hall', 'town halls', 'civic', 7],
  'amenity=courthouse': ['courthouse', 'courthouses', 'civic', 5],
  'amenity=police': () => [say('police station', 'police station'), 'police stations', 'civic', 4],
  'amenity=fire_station': ['fire station', 'fire stations', 'civic', 4],
  'amenity=theatre': ['theatre', 'theatres', 'sight', 6],
  'amenity=cinema': () => [say('cinema', 'movie theater'), say('cinemas', 'movie theaters'), 'sight', 5],
  'amenity=arts_centre': ['arts centre', 'arts centres', 'sight', 5],
  'amenity=community_centre': ['community centre', 'community centres', 'civic', 2],
  'amenity=place_of_worship': ['church', 'churches', 'faith', 7],
  'amenity=school': ['school', 'schools', 'civic', 3, false],
  'amenity=college': ['college', 'colleges', 'civic', 3, false],
  'amenity=university': ['university building', 'university buildings', 'civic', 4, false],
  'amenity=kindergarten': ['nursery', 'nurseries', 'civic', 1, false],
  'amenity=doctors': () => [say('doctor’s surgery', 'doctor’s office'), say('doctors’ surgeries', 'doctors’ offices'), 'service', 1],
  'amenity=dentist': () => [say('dentist’s', 'dentist'), 'dentists', 'service', 1],
  'amenity=marketplace': ['market', 'markets', 'shop', 6],
  'amenity=fountain': ['fountain', 'fountains', 'thing', 4, false],
  'amenity=drinking_water': ['drinking fountain', 'drinking fountains', 'thing', 1, false],
  'amenity=telephone': () => [say('telephone box', 'pay phone'), say('telephone boxes', 'pay phones'), 'thing', 2, false],
  'amenity=clock': ['clock', 'clocks', 'thing', 3, false],
  'amenity=bench': ['bench', 'benches', 'thing', 0, false],
  'amenity=toilets': () => [say('public toilet', 'restroom'), say('public toilets', 'restrooms'), 'thing', 0, false],
  'amenity=parking': () => [say('car park', 'parking lot'), say('car parks', 'parking lots'), 'thing', 0, false],
  'amenity=bicycle_rental': ['bike rack', 'bike racks', 'thing', 0, false],
  'amenity=nightclub': ['nightclub', 'nightclubs', 'drink', 2],
  'amenity=casino': ['casino', 'casinos', 'drink', 2],
  'amenity=gallery': ['gallery', 'galleries', 'sight', 5],
  'amenity=social_facility': ['day centre', 'day centres', 'civic', 0],
  'amenity=bus_station': ['bus station', 'bus stations', 'transport', 4],
  'amenity=ferry_terminal': ['ferry terminal', 'ferry terminals', 'transport', 5],
  'amenity=taxi': () => [say('taxi rank', 'taxi stand'), say('taxi ranks', 'taxi stands'), 'transport', 1, false],
  'healthcare=pharmacy': () => [say('chemist’s', 'pharmacy'), say('chemists', 'pharmacies'), 'shop', 4],
  'tourism=museum': ['museum', 'museums', 'sight', 7],
  'tourism=gallery': ['gallery', 'galleries', 'sight', 5],
  'tourism=hotel': ['hotel', 'hotels', 'service', 3],
  'tourism=guest_house': ['guest house', 'guest houses', 'service', 2],
  'tourism=hostel': ['hostel', 'hostels', 'service', 2],
  'tourism=information': () => [say('tourist information centre', 'visitor center'), 'information centres', 'civic', 3],
  'tourism=artwork': ['work of art', 'works of art', 'sight', 4, false],
  'tourism=attraction': ['sight', 'sights', 'sight', 6],
  'tourism=viewpoint': ['viewpoint', 'viewpoints', 'sight', 6, false],
  'historic=memorial': ['memorial', 'memorials', 'sight', 4, false],
  'historic=monument': ['monument', 'monuments', 'sight', 6, false],
  'historic=castle': ['castle', 'castles', 'sight', 9],
  'historic=church': ['old church', 'old churches', 'faith', 7],
  'historic=building': ['old building', 'old buildings', 'sight', 3],
  'historic=city_gate': ['old gate', 'old gates', 'sight', 6, false],
  'historic=ruins': ['ruin', 'ruins', 'sight', 6, false],
  'historic=wayside_cross': ['wayside cross', 'wayside crosses', 'sight', 3, false],
  'historic=fort': ['fort', 'forts', 'sight', 7],
  'historic=palace': ['palace', 'palaces', 'sight', 8],
  'historic=tower': ['tower', 'towers', 'sight', 7],
  'historic=house': ['historic house', 'historic houses', 'sight', 4],
  'historic=manor': ['manor house', 'manor houses', 'sight', 5],
  'historic=archaeological_site': ['dig', 'digs', 'sight', 4, false],
  'historic=heritage': ['heritage site', 'heritage sites', 'sight', 3, false],
  'historic=yes': ['historic site', 'historic sites', 'sight', 3, false],
  'leisure=fitness_centre': ['gym', 'gyms', 'service', 1],
  'leisure=sports_centre': ['sports centre', 'sports centres', 'civic', 2],
  'man_made=tower': ['tower', 'towers', 'sight', 4, false],
  'man_made=lighthouse': ['lighthouse', 'lighthouses', 'sight', 8, false],
  'railway=station': ['station', 'stations', 'transport', 7],
  'railway=halt': ['halt', 'halts', 'transport', 4],
  'railway=tram_stop': ['tram stop', 'tram stops', 'transport', 2, false],
  'railway=subway_entrance': () => [say('Underground entrance', 'subway entrance'), say('Underground entrances', 'subway entrances'), 'transport', 2, false],
};

/** Keys checked in order when a place carries several. */
// Parks and gardens are areas (see _town.ts), and offices are left out: a row of them reads as noise.
const ORDER = ['amenity', 'shop', 'healthcare', 'tourism', 'historic', 'railway', 'leisure', 'man_made', 'craft', 'office'];

const spaced = (v: string) => v.replace(/[_;]/g, ' ').replace(/\s+/g, ' ').trim();

/** What a place is, from its tags; null for things the story ignores. */
export function classify(t: Tags): Kind | null {
  for (const key of ORDER) {
    const value = t[key];
    if (!value || value === 'no' || value === 'vacant') continue;
    const tag = `${key}=${value}`;
    const hit = TABLE[tag];
    if (hit) {
      const [noun, plural, group, weight, enter = true] = typeof hit === 'function' ? hit() : hit;
      return { tag, noun: refine(noun, t), plural, group, weight, enter };
    }
    if (key === 'shop' && value !== 'yes') {
      const noun = `${spaced(value)} ${say('shop', 'store')}`;
      return { tag, noun, plural: `${noun}s`, group: 'shop', weight: 1, enter: true };
    }
    if (key === 'craft') {
      const noun = `${spaced(value)}’s workshop`;
      return { tag, noun, plural: `${spaced(value)} workshops`, group: 'service', weight: 2, enter: true };
    }
  }
  if (t.shop === 'yes') return { tag: 'shop=yes', noun: say('shop', 'store'), plural: say('shops', 'stores'), group: 'shop', weight: 1, enter: true };
  return null;
}

const CUISINE: Record<string, string> = {
  italian: 'Italian',
  pizza: 'pizza',
  indian: 'Indian',
  chinese: 'Chinese',
  thai: 'Thai',
  japanese: 'Japanese',
  sushi: 'sushi',
  french: 'French',
  mexican: 'Mexican',
  greek: 'Greek',
  turkish: 'Turkish',
  spanish: 'Spanish',
  portuguese: 'Portuguese',
  lebanese: 'Lebanese',
  vietnamese: 'Vietnamese',
  korean: 'Korean',
  american: 'American',
  burger: 'burger',
  seafood: 'seafood',
  fish_and_chips: 'fish and chip',
  steak_house: 'steak',
  swedish: 'Swedish',
  scottish: 'Scottish',
  british: 'British',
  regional: 'local',
  nepalese: 'Nepalese',
  ethiopian: 'Ethiopian',
  kebab: 'kebab',
  vegan: 'vegan',
  vegetarian: 'vegetarian',
  tapas: 'tapas',
  noodle: 'noodle',
  ramen: 'ramen',
  coffee_shop: '',
};

const RELIGION: Record<string, string> = {
  christian: 'church',
  jewish: 'synagogue',
  muslim: 'mosque',
  buddhist: 'temple',
  hindu: 'temple',
  sikh: 'gurdwara',
};

/** Sharpen a noun with the tags that say more: a cuisine, a faith, a kind of memorial. */
function refine(noun: string, t: Tags): string {
  if (t.amenity === 'place_of_worship') return RELIGION[t.religion ?? 'christian'] ?? 'place of worship';
  if ((t.amenity === 'restaurant' || t.amenity === 'fast_food') && t.cuisine) {
    const c = CUISINE[t.cuisine.split(';')[0]];
    if (c) return `${c} ${noun === 'restaurant' ? 'restaurant' : noun}`;
  }
  if (t.historic === 'memorial' && t.memorial) {
    const m: Record<string, string> = {
      war_memorial: 'war memorial',
      statue: 'statue',
      plaque: 'plaque',
      bust: 'bust',
      stone: 'memorial stone',
      obelisk: 'obelisk',
      blue_plaque: 'blue plaque',
      cross: 'memorial cross',
    };
    return m[t.memorial] ?? noun;
  }
  if (t.tourism === 'artwork' && t.artwork_type) {
    const m: Record<string, string> = {
      statue: 'statue',
      sculpture: 'sculpture',
      mural: 'mural',
      bust: 'bust',
      fountain: 'fountain',
      relief: 'carved relief',
      installation: 'installation',
    };
    return m[t.artwork_type] ?? noun;
  }
  return noun;
}

/** "a" or "an" before a word. */
export function an(word: string): string {
  const w = word.toLowerCase();
  if (/^(hour|honou?r|heir)/.test(w)) return `an ${word}`;
  if (/^(uni|use|usu|eu|one\b|once)/.test(w)) return `a ${word}`;
  if (/^atm\b/.test(w)) return `an ${word}`;
  return `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${word}`;
}

/** Join words as "a, b, and c" (British: "a, b and c"). */
export function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const comma = english === 'us' ? ',' : '';
  return `${items.slice(0, -1).join(', ')}${comma} and ${items[items.length - 1]}`;
}

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const count = (n: number): string => NUMBERS[n] ?? String(n);

export const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The name a place goes by in the story: its own, unless that is in a script the reader may not read. */
export function nameOf(t: Tags): string | null {
  const name = t.name?.trim();
  if (!name) return null;
  if (/[^\u0000-ɏḀ-ỿ -⁯’‘]/.test(name) && t['name:en']) return t['name:en'];
  return name;
}

/** Why you might step inside, by kind: the line you read on the way in. */
const INSIDE: Record<string, string[]> = {
  'shop=bakery': [
    'The window is fogged and the air smells of yeast and burnt sugar. Trays of rolls are going cheap at this hour.',
    'A bell over the door. Behind the counter, the last loaves sit in wicker baskets beside a tray of iced buns.',
  ],
  'shop=supermarket': [
    'Strip lights, a hum of fridges, and a queue at the only till that is open.',
    'Baskets by the door, trolleys tangled together, and an announcement nobody can make out.',
  ],
  'shop=convenience': [
    'Narrow aisles packed to the ceiling, a fridge of milk at the back, and a radio playing behind the counter.',
  ],
  'shop=newsagent': ['Racks of magazines, jars of sweets, and the evening paper in a stack by the till.'],
  'shop=books': [
    'Shelves to the ceiling and a ladder on a rail. Someone is reading in the armchair by the window and has no intention of buying anything.',
  ],
  'shop=florist': ['Buckets of stems on the floor and the cold green smell of cut leaves.'],
  'shop=charity': ['Racks of coats, a shelf of jigsaws with no promise of all their pieces, and a smell of other people’s houses.'],
  'shop=hardware': ['Drawers of screws sold by weight, coils of chain, mops hung from the ceiling, and a man in a brown coat who knows where everything is.'],
  'shop=butcher': ['Sawdust on the floor and a striped awning inside the window. The block has been scrubbed for the night.'],
  'shop=greengrocer': ['Crates of apples tilted towards the street and a set of brass scales.'],
  'shop=clothes': ['Rails of coats, a long mirror, and an assistant folding jumpers who does not look up.'],
  'shop=deli': ['Hams hanging from hooks, wheels of cheese, olives in tubs, and a slicer whirring.'],
  'shop=dry_cleaning': ['A rail of clothes in plastic turns slowly on its track when the assistant presses a pedal.'],
  'shop=locksmith': ['Blanks hang on a pegboard wall and a cutting machine whines through a key.'],
  'shop=shoe_repair': ['Heels on a shelf awaiting their owners, and a smell of glue and leather.'],
  'shop=stationery': ['Pens in jars, reams of paper, and a carousel of greetings cards for every occasion.'],
  'shop=optician': ['Frames on glass shelves under bright lights, and a chart with ever smaller letters on the far wall.'],
  'shop=department_store': ['Perfume counters, an escalator, and a store directory listing six floors.'],
  'amenity=pharmacy': ['A bell rings as you open the door. Shelves of plasters and cough syrup, and a counter at the back for prescriptions.'],
  'healthcare=pharmacy': ['A bell rings as you open the door. Shelves of plasters and cough syrup, and a counter at the back for prescriptions.'],
  'amenity=post_office': ['A queue snakes between ropes towards three windows, one of them open.'],
  'amenity=library': ['Quiet, warm, and carpeted. The returns desk is by the door, and someone is asleep over a newspaper.'],
  'amenity=bank': ['Marble floor, roped queue, and a row of cash machines in the lobby.'],
  'amenity=pub': [
    'Low beams, a fire going, and a dog asleep beneath a table. The barman nods at you.',
    'Dark wood, brass rails, and the murmur of the after-work crowd beginning to build.',
  ],
  'amenity=bar': ['Low light, bottles lit from below, and music a little too loud for the hour.'],
  'amenity=cafe': [
    'The milk steamer shrieks. A few people are bent over laptops, and the chairs are already going up on the tables at the back.',
    'Mismatched chairs, a chalkboard menu, and a cake under a glass dome.',
  ],
  'amenity=restaurant': ['Tables laid for the evening, candles not yet lit. A waiter tells you the kitchen opens at six.'],
  'amenity=fast_food': ['Bright lights, a menu over the counter, and a warm smell of frying.'],
  'amenity=place_of_worship': [
    'Cool, dim, and very quiet. Candles flicker on an iron stand, and your footsteps sound louder than they should.',
  ],
  'tourism=museum': ['Glass cases, a hushed attendant, and a sign that says the museum closes soon.'],
  'amenity=theatre': ['A foyer of red carpet and old posters. The box office is open for tonight’s performance.'],
  'amenity=cinema': ['A smell of popcorn and a board of tonight’s showings.'],
  'tourism=hotel': ['A revolving door, a reception desk, and a porter who looks at your shopping.'],
  'railway=station': ['A departures board clicks through its list. Somebody is running for a train.'],
  'amenity=townhall': ['A wide staircase, oil paintings of former mayors, and a porter at a desk.'],
  'amenity=marketplace': ['Stalls are packing up: awnings coming down, crates being stacked, the last apples going two for one.'],
};

const GROUP_INSIDE: Record<Group, string> = {
  shop: 'Shelves, a counter, and someone behind it who asks if you need any help.',
  food: 'A few tables, a counter, and a smell of whatever is on today.',
  drink: 'A few regulars at the bar, and a television on with the sound off.',
  service: 'A waiting area with three chairs and some old magazines.',
  civic: 'A reception desk and a noticeboard.',
  faith: 'Quiet and dim inside.',
  sight: 'An entrance hall and a desk with leaflets.',
  transport: 'A ticket office and a timetable on the wall.',
  thing: '',
};

export function insideLine(kind: Kind, pick: number): string {
  const lines = INSIDE[kind.tag];
  if (lines?.length) return lines[pick % lines.length];
  return GROUP_INSIDE[kind.group];
}
