// The towns on the opening page. Each one ships as a snapshot in _data/ (see _snapshot.mjs), so it
// opens at once and still works when OpenStreetMap's servers are busy; anywhere else is fetched live.

export interface Place {
  id: string;
  name: string;
  /** Where it is, for the banner. */
  region: string;
  lat: number;
  lon: number;
  /** One line on the opening page. */
  hint: string;
  /** Spelling and words for the story: British or American. */
  english: 'gb' | 'us';
  /** Where to begin, by the start of a place's name; otherwise somewhere busy near the middle. */
  begin?: string;
}

export const PLACES: Place[] = [
  {
    id: 'guildford',
    name: 'Guildford',
    region: 'Surrey, England',
    lat: 51.2362,
    lon: -0.5718,
    hint: 'A cobbled high street climbing from the river towards the castle.',
    english: 'gb',
  },
  {
    id: 'venice',
    name: 'Venice',
    region: 'San Polo and the Rialto, Italy',
    lat: 45.4372,
    lon: 12.3326,
    hint: 'Alleys, bridges, and squares, and not a single road.',
    english: 'gb',
    begin: 'Campo Sant',
  },
  {
    id: 'edinburgh',
    name: 'Edinburgh',
    region: 'The Old Town, Scotland',
    lat: 55.9496,
    lon: -3.1912,
    hint: 'Closes and wynds dropping steeply off a street along a ridge.',
    english: 'gb',
  },
  {
    id: 'lisbon',
    name: 'Lisbon',
    region: 'Alfama, Portugal',
    lat: 38.7113,
    lon: -9.1305,
    hint: 'Stairways and tram lines tumbling down towards the river.',
    english: 'gb',
    begin: 'Largo de São Miguel',
  },
  {
    id: 'stockholm',
    name: 'Stockholm',
    region: 'Gamla stan, Sweden',
    lat: 59.3249,
    lon: 18.0711,
    hint: 'An island old town of narrow lanes, with water on every side.',
    english: 'gb',
  },
  {
    id: 'savannah',
    name: 'Savannah',
    region: 'The Historic District, Georgia',
    lat: 32.0782,
    lon: -81.0926,
    hint: 'A grid of shady squares, a new one every couple of blocks.',
    english: 'us',
  },
  {
    id: 'greenwich-village',
    name: 'Greenwich Village',
    region: 'Manhattan, New York',
    lat: 40.7335,
    lon: -74.0018,
    hint: 'Where the grid gives up and the streets wander off on their own.',
    english: 'us',
  },
];

/** How far from the starting point the town reaches, in metres. */
export const RADIUS = 550;
