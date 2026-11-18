// The Register of Articles kept at the Lost Property Office, Aldermoor Central,
// 1924 to 1986. Entries are in date order and numbered from that order, so a
// cross reference is written [[id]] and becomes "No. n" when the page builds.
// Straight quotes in the text are set as curly ones by `smart`.

export type Hand = 'pell' | 'dunmore' | 'mensah';

interface Raw {
  id: string;
  /** ISO date the entry was made. */
  date: string;
  /** The article, and where it was found. */
  article: string;
  /** How it was disposed of. */
  disposal: string;
  /** A pencilled afterthought. */
  pencil?: string;
}

export type Segment = { text: string } | { ref: number };

export interface Entry {
  no: number;
  id: string;
  date: string;
  year: number;
  day: string;
  hand: Hand;
  article: Segment[];
  disposal: Segment[];
  pencil: Segment[] | null;
  /** Lower-case plain text of everything hidden, for the counter's index. */
  index: string;
}

const RAW: Raw[] = [
  // Albert Pell, 1924 to 1951.
  {
    id: 'umbrella',
    date: '1924-03-03',
    article:
      "Umbrella, gent's, black silk, malacca handle; on the rack of the 8.14 from Saltcote. Rolled up inside it, a second umbrella, child's size, red.",
    disposal:
      'Claimed 4 Mar. by the owner of the large one, fee 2d. He said the small one was not his and he had never seen it before.',
  },
  {
    id: 'drawerkey',
    date: '1924-03-10',
    article: 'Key, small, brass, to the drawer of this counter; mislaid by me with the drawer locked.',
    disposal: 'Not found. Entered against myself.',
  },
  {
    id: 'spectacles',
    date: '1924-11-08',
    article:
      'Spectacles, gold-rimmed, the left lens painted with a very small view of Saltcote harbour, the right lens clear; in the refreshment room.',
    disposal: 'Unclaimed. Kept on my desk.',
  },
  {
    id: 'teeth1',
    date: '1925-02-12',
    article: "Teeth, false, upper set, in a mustard tin; under a seat in the ladies' waiting room.",
    disposal: 'Claimed by a gentleman. I did not ask.',
  },
  {
    id: 'dummy',
    date: '1925-07-30',
    article:
      "Ventriloquist's figure, a boy in a sailor suit, about three feet high, sitting upright in a first-class compartment of the 5.40 from Ellerby with no ticket.",
    disposal: 'Claimed 31 July by the owner, who did all his talking through the figure. The figure paid the fee.',
  },
  {
    id: 'leg',
    date: '1926-01-19',
    article: "Leg, wooden, gent's, left, with a brown boot laced on; in the gentlemen's waiting room.",
    disposal: 'Claimed next day by the owner, who walked in on his other one. He keeps a spare.',
  },
  {
    id: 'lobster',
    date: '1926-09-02',
    article: "Lobster, live, in a wet sack; in the guard's van of the night mail.",
    disposal: 'Unclaimed after six hours. Perishable. Disposed of under the regulations, to the refreshment room.',
  },
  {
    id: 'violin',
    date: '1927-04-21',
    article:
      "Violin and bow, in a case lined with green baize; on the 8.14. A note under the strings: 'I am giving it up. Whoever finds this, don't.'",
    disposal: 'Unclaimed after three months. To the finder under the regulations: Porter Coyle, for his boy Michael, aged nine.',
  },
  {
    id: 'goose',
    date: '1927-12-23',
    article: "Goose, plucked and dressed, labelled 'For Mother'; on the bench at Platform 2.",
    disposal:
      "Claimed 24 Dec. by a lady out of breath. She said her mother wouldn't have known the difference, but she would.",
  },
  {
    id: 'bowler',
    date: '1928-06-05',
    article:
      'Bowler hat, size 7, with two hundred pounds in five-pound notes sewn into the lining; on the 11.05 from Wrayford.',
    disposal:
      'Unclaimed, though advertised. After three months, to the finder under the regulations: Porter Dunn, who has bought a motorcycle.',
  },
  {
    id: 'baby',
    date: '1929-08-14',
    article: 'Infant, female, about six months, asleep in a basket on the bench at Platform 2, 5.40 p.m.',
    disposal: 'Claimed 5.52 p.m. by her mother, who had gone for an evening paper. The quickest claim in this book.',
  },
  {
    id: 'armour',
    date: '1930-03-27',
    article: "Suit of armour, in pieces, in three tea chests labelled only 'Act Two'; in the left luggage.",
    disposal: 'Claimed by the Aldermoor Amateur Operatic Society the night before the dress rehearsal.',
  },
  {
    id: 'eyes',
    date: '1930-10-09',
    article:
      'Glass eyes, a box of forty, assorted colours; on the 2.10 from Hollins Bay. One short, found two days later in my in-tray, looking at me.',
    disposal: "Claimed by an oculist's assistant, who counted them twice.",
  },
  {
    id: 'dog',
    date: '1931-05-26',
    article: "Dog, Airedale, answering to 'Major', in a first-class seat of the 8.14 with a ticket for Saltcote in his collar.",
    disposal: 'Claimed by his owner, who had put him on the train to visit her sister. He had not wanted to go.',
  },
  {
    id: 'sword',
    date: '1931-11-11',
    article: "Sword, cavalry, in its scabbard, in the umbrella stand of the gentlemen's waiting room.",
    disposal:
      'Claimed by a retired colonel, up for the Armistice service, who had used it to point at the departures board and then run for his train.',
  },
  {
    id: 'dress',
    date: '1932-05-19',
    article: "Wedding dress in a dressmaker's box, with the bill in it, unpaid; on the rack of the 8.14.",
    disposal: 'Claimed on the Friday by the dressmaker, not the bride. The wedding went ahead on the Saturday, the bride in her second best.',
  },
  {
    id: 'glove-l',
    date: '1933-01-26',
    article: "Glove, lady's, left hand, red kid with fur at the cuff, Bond & Howe of Aldermoor; on the footbridge.",
    disposal: 'Unclaimed. Kept.',
  },
  {
    id: 'churchkey',
    date: '1933-09-04',
    article:
      "Key, iron, five inches long, with a card label in an old hand: 'The Church'. Which church is not stated. On the windowsill of the booking hall.",
    disposal: 'Unclaimed. Tried at nine churches; fits none. Kept.',
  },
  {
    id: 'parrot',
    date: '1934-02-15',
    article:
      'Parrot, grey, in a covered cage, on the 5.40 from Ellerby. Calls every station from Ellerby to Saltcote, in order, in the voice of a guard.',
    disposal:
      "Claimed by a guard's widow. When she lifted the cover it said 'Saltcote, Saltcote, all change', and she had to sit down.",
  },
  {
    id: 'portrait',
    date: '1934-07-02',
    article: 'Picture, oil, in a gilt frame, of a gentleman holding this picture; on the rack of the 11.05.',
    disposal: 'Claimed by the gentleman in the picture.',
  },
  {
    id: 'bath',
    date: '1935-04-10',
    article: "Bath, cast iron, enamelled, on ball feet; in the guard's van, consigned to nobody.",
    disposal: 'Unclaimed. Too heavy for the sale. Put in the yard, where the porters grow tomatoes in it.',
  },
  {
    id: 'telescope',
    date: '1935-12-19',
    article:
      "Telescope, brass, three draws, engraved 'For seeing further'; on the bench at the end of Platform 7, pointed at the signal box.",
    disposal: 'Unclaimed. Lent to the signalman, who brings it back on Sundays.',
  },
  {
    id: 'pigeons',
    date: '1936-06-24',
    article: 'Pigeons, racing, twelve, in a basket labelled for release at Hollins Bay; on the 2.10, having missed their stop.',
    disposal:
      'Released from the office roof at 3.15 by order of the stationmaster. All found their own way home. Basket unclaimed.',
  },
  {
    id: 'watch',
    date: '1936-10-07',
    article: 'Watch, pocket, silver, stopped at 8.14; on the floor of the booking hall.',
    disposal: 'Unclaimed. Wound and kept. It runs four minutes slow, like the 8.14.',
  },
  {
    id: 'crowns',
    date: '1937-05-12',
    article: 'Paper crowns, a box of sixty, and a Union flag; on the rack of the 8.14, the morning of the Coronation.',
    disposal: "Claimed by a schoolmistress before the procession. One crown short; Porter Coyle's boy was wearing it.",
  },
  {
    id: 'horace',
    date: '1938-05-02',
    article:
      "Tortoise, live, in a hatbox with air holes punched in the lid, labelled 'Horace. Handle with care'; on the rack of the 11.05 from Wrayford.",
    disposal:
      'Unclaimed after three months. Kept by this office, the stationmaster agreeing. He likes lettuce and the warm pipe under the counter.',
  },
  {
    id: 'gasmask',
    date: '1939-09-01',
    article:
      "Gas mask in its cardboard box, child's, with a luggage label on string: 'Peter Wren, aged 7, St Anne's School, to Thursby'. Platform 1, the evacuation.",
    disposal: 'Unclaimed. Letters to Thursby not answered. Kept.',
    pencil:
      'The platform was full of children all day. Most of what they dropped went after them on the next train. These did not.',
  },
  {
    id: 'doll',
    date: '1939-09-01',
    article: "Doll, rag, in a knitted coat, 'Rosie' stitched on the hem; Platform 1, the evacuation, the same train as [[gasmask]].",
    disposal: 'Unclaimed. Kept with [[gasmask]].',
  },
  {
    id: 'kitbag',
    date: '1940-06-04',
    article: 'Kitbag, army, soaked through, with sand in the bottom and a cockle shell; on the first troop train up from the coast.',
    disposal: 'Claimed in August by the soldier, who asked if he could keep the sand. He could.',
  },
  {
    id: 'banana',
    date: '1942-07-21',
    article:
      "Parcel, brown paper, addressed 'Mrs E. Coyle, The Station', containing one banana, the first seen in Aldermoor since 1940.",
    disposal: 'Not lost; delivered. Entered because of the crowd.',
  },
  {
    id: 'onions',
    date: '1944-01-10',
    article: 'Horace ([[horace]]) found in the parcels office, in a crate of onions bound for Saltcote.',
    disposal: 'Returned to this office. Not an article; entered so that it is known where he is.',
  },
  {
    id: 'bunting',
    date: '1945-05-08',
    article:
      "Bunting, red, white and blue, about two hundred yards; and one shoe, lady's, silver, size 4. On the footbridge, after the dancing.",
    disposal: 'Bunting claimed by the Town Hall. The shoe not. Kept, in case.',
  },
  {
    id: 'film',
    date: '1946-10-15',
    article: "Cine film, one reel, 16 mm, in a tin marked 'DO NOT WATCH'; on the 8.14.",
    disposal: 'Unclaimed. Not watched.',
  },
  {
    id: 'glove-r',
    date: '1947-03-03',
    article:
      "Glove, lady's, right hand, red kid with fur at the cuff, Bond & Howe of Aldermoor; on the footbridge, in the snow.",
    disposal: 'Unclaimed.',
    pencil: 'Pair to [[glove-l]], fourteen years apart. Put together.',
  },
  {
    id: 'ship',
    date: '1947-08-19',
    article: 'Ship in a bottle, a three-masted barque under full sail, in a quart beer bottle; on the rack of the boat train.',
    disposal:
      "Claimed by a merchant seaman who had built it on watch in the war. He would not say how long it took, then said, 'Four years.'",
  },
  {
    id: 'pudding',
    date: '1948-12-21',
    article: 'Christmas pudding in a cloth, still warm; on the heating pipe under a seat of the 5.40 from Ellerby.',
    disposal: 'Claimed by a lady who had put it there to finish steaming. It was done.',
  },
  {
    id: 'typewriter',
    date: '1949-05-06',
    article:
      "Typewriter, portable, in its case, with a sheet still in the roller: page 212 of something, stopping mid-sentence at '...and then the train'. On the 8.14.",
    disposal: 'Unclaimed. Kept, with the page left in.',
  },
  {
    id: 'valentine',
    date: '1950-02-14',
    article: "Valentine, unsigned, addressed 'To the lady in the green hat on the 8.14'; on the floor of the booking hall.",
    disposal:
      "Put in the window at the stationmaster's suggestion. Claimed on the 16th by a lady in a green hat who was not the lady in the green hat. I let it go.",
  },
  {
    id: 'map',
    date: '1950-08-22',
    article: 'Map, Ordnance Survey, sheet 31, with a cross in red ink and the word HERE; on the 11.05.',
    disposal: 'Unclaimed. Mr Coyle went to look on his day off. A field. He says a very nice field.',
  },
  {
    id: 'pencil',
    date: '1951-06-29',
    article: 'Pencil, office, mine, worn to an inch. Not lost. Retiring, with me, after twenty-seven years.',
    disposal: 'This book to Miss I. Dunmore, with the keys and the tortoise. A.P.',
  },

  // Ivy Dunmore, 1951 to 1979.
  {
    id: 'continued',
    date: '1951-07-02',
    article:
      "Continued, from Mr Pell, who has gone to his sister's at Hollins Bay. Received with the book: the keys, Horace ([[horace]]), and a great many umbrellas.",
    disposal: 'I.D.',
  },
  {
    id: 'bleak1',
    date: '1952-03-14',
    article:
      "Book: 'Bleak House', vol. I, green cloth; on the 8.14 from Saltcote, third class, the corner seat facing the engine. Pencilled inside the cover: '9'.",
    disposal: 'Claimed the same day, 5.30, by a young lady, Miss M. Lindqvist.',
  },
  {
    id: 'bleak2',
    date: '1952-03-21',
    article: "Book: 'Bleak House', vol. II, green cloth; on the 8.14, the same corner seat. Pencilled inside the cover: '41'.",
    disposal:
      "Claimed the same day by a gentleman, Mr R. Abbot. He asked whether a lady had collected vol. I. I said I couldn't say.",
    pencil: 'See [[bleak1]].',
  },
  {
    id: 'bucket',
    date: '1952-08-11',
    article:
      "Bucket and spade, child's, tin, painted with lobsters; on the 2.10 up from Hollins Bay, full of wet sand and one crab.",
    disposal: 'Crab returned to the sea by the guard of the next down train. Bucket claimed.',
  },
  {
    id: 'basket',
    date: '1953-04-20',
    article:
      'A young lady asked to see the entry for the day she was left on Platform 2 in a basket. I showed her [[baby]]. She laughed until she had to sit down. Her mother had always told her it was five minutes.',
    disposal: 'Not an article.',
  },
  {
    id: 'television',
    date: '1953-06-02',
    article: 'Television set, twelve-inch, in a crate; delivered to the refreshment room on Coronation morning, addressed to nobody.',
    disposal:
      'Kept for the day. The whole station watched it. Claimed on the 3rd by a shop that had meant it for Aldermoor Road, Wrayford.',
  },
  {
    id: 'jane',
    date: '1953-10-12',
    article: "Book: 'Jane Eyre'; on the 8.14, the same corner seat. Pencilled inside the cover: '112'.",
    disposal: 'Claimed by Miss Lindqvist.',
    pencil: "I looked at p. 112 before she came. One word underlined, in pencil. I shan't write it here.",
  },
  {
    id: 'piano',
    date: '1954-02-08',
    article: "Piano, upright, walnut, in the guard's van; consigned to the Methodist hall and put off here by mistake.",
    disposal: 'Played in the booking hall for a week by anybody who could. Then delivered.',
  },
  {
    id: 'madding',
    date: '1954-05-17',
    article: "Book: 'Far from the Madding Crowd'; on the 8.14, the same seat. Pencilled inside the cover: '7'.",
    disposal: 'Claimed by Mr Abbot.',
    pencil: 'They are never in here at the same time. I think that is the point.',
  },
  {
    id: 'teeth2',
    date: '1954-11-03',
    article: "Teeth, false, lower set, wrapped in a ten-shilling note; in the ladies' waiting room.",
    disposal: 'The note claimed the same afternoon. The teeth not.',
  },
  {
    id: 'camera',
    date: '1955-03-28',
    article:
      'Camera, folding, on the bench at Platform 4. The film developed under the regulations to trace the owner: twenty-four pictures of this same bench, taken one a day.',
    disposal:
      "Claimed by a lady who said she had been waiting for somebody for twenty-four days. She didn't say whether they came.",
  },
  {
    id: 'north',
    date: '1955-09-19',
    article: "Book: 'North and South'; on the 8.14, the same seat. Pencilled inside the cover: '205'.",
    disposal: 'Claimed by Miss Lindqvist.',
    pencil: "She asked me whether I read them. I said I did. She said, 'Good. Then somebody does.'",
  },
  {
    id: 'snowman',
    date: '1956-02-06',
    article: 'Hat, bowler, and a clay pipe; on Platform 1, the snowman having gone.',
    disposal: 'Unclaimed. Kept for next winter.',
  },
  {
    id: 'woman',
    date: '1956-07-09',
    article: "Book: 'The Woman in White'; on the 8.14, the same seat. Pencilled inside the cover: '88'.",
    disposal:
      'Claimed by Miss Lindqvist, who is going to Ellerby for work in the autumn. She asked me to keep anything that came for her. I said I would.',
  },
  {
    id: 'cake',
    date: '1957-04-08',
    article: 'Wedding cake, three tiers, the bride and groom on top; in a box on the rack of the 11.05.',
    disposal: 'Claimed by the bride. The groom did not come in. She left us the top tier.',
  },
  {
    id: 'concert',
    date: '1957-06-15',
    article: "Concert at the Assembly Rooms. The soloist was Michael Coyle, the porter's boy, on the violin from [[violin]].",
    disposal: 'Not an article. Entered because Mr Pell would want it to be. I sent him the programme.',
  },
  {
    id: 'middlemarch',
    date: '1957-11-25',
    article: "Book: 'Middlemarch'; on the 8.14, the same seat. Pencilled inside the cover: '340'.",
    disposal: 'Claimed by Mr Abbot. He asked whether Miss L. still came in. I said not often, since Ellerby.',
  },
  {
    id: 'persuasion',
    date: '1958-06-09',
    article:
      "Book: 'Persuasion'; on the 8.14 from Saltcote, the same corner seat facing the engine. Pencilled inside the cover: '237'.",
    disposal: 'Unclaimed. Not to go to the sale. Kept on the shelf behind the counter. I.D.',
    pencil: "I have not looked at p. 237. It isn't mine to.",
  },
  {
    id: 'abbot',
    date: '1958-12-15',
    article:
      'Mr Abbot came in three times this year to ask whether the book ([[persuasion]]) had been collected. It has not. Miss Lindqvist left no address in Ellerby, and I have none to give him.',
    disposal: 'He said to keep it where it was, in case. He has not been in since the autumn.',
  },
  {
    id: 'ring',
    date: '1959-03-02',
    article: 'Ring, engagement, a small diamond, in a matchbox with NO written on it in pencil; on the 8.14.',
    disposal: 'Unclaimed.',
  },
  {
    id: 'yes',
    date: '1959-04-02',
    article:
      'Ring ([[ring]]) claimed by a young man. She had changed her mind. He crossed out NO on the matchbox, wrote YES, and asked me to witness it.',
    disposal: 'Witnessed. I.D.',
  },
  {
    id: 'pram',
    date: '1960-05-16',
    article: 'Pram, coach-built, navy; no baby (I looked twice), but full of library books overdue since 1957.',
    disposal: 'Books returned to the library. Pram claimed by a lady who said she had been looking for the books.',
  },
  {
    id: 'page212',
    date: '1961-01-09',
    article: 'Typewriter ([[typewriter]]) still here, page 212 still in it. I have begun to wonder what the train did.',
    disposal: 'Not an article.',
  },
  {
    id: 'urn',
    date: '1962-03-05',
    article:
      "Urn, brass, with ashes; a label tied to the handle: 'Uncle Wilf, for Saltcote, he liked the pier'. On the rack of the 2.10.",
    disposal: 'Claimed next morning by a nephew, very sorry. We had kept Uncle Wilf on the good shelf.',
  },
  {
    id: 'tomatoes',
    date: '1962-08-27',
    article: 'Tomatoes from the bath in the yard ([[bath]]) very good this year.',
    disposal: 'Not an article. Shared out.',
  },
  {
    id: 'goldfish',
    date: '1962-09-10',
    article: 'Goldfish in a bag of water, won at the fair; on the 2.10.',
    disposal: 'Unclaimed. Lives in a jar on the counter.',
  },
  {
    id: 'platform6',
    date: '1963-05-13',
    article: 'Horace ([[horace]]) found at seven in the morning on Platform 6. How he crossed the footbridge is not known.',
    disposal: 'Returned. Spoken to.',
  },
  {
    id: 'gloves',
    date: '1964-02-24',
    article:
      'Gloves, red kid, the pair ([[glove-l]] and [[glove-r]]), asked for by a lady who gave both dates without being asked: the left lost in 1933, the right in 1947. She came in now because she had finally lost the coat.',
    disposal: 'Claimed. Fee paid twice, once for each hand.',
  },
  {
    id: 'canoe',
    date: '1964-08-17',
    article: "Canoe, Canadian, sixteen feet, varnished; in the guard's van of the boat train. No paddle.",
    disposal: 'Unclaimed.',
  },
  {
    id: 'paddle',
    date: '1965-05-10',
    article: 'Paddle, one, varnished; on the 2.10. No canoe.',
    disposal: 'Claimed, with the canoe ([[canoe]]), by two schoolmasters who had each been certain the other one had it.',
  },
  {
    id: 'letter',
    date: '1965-11-22',
    article: "Letter, sealed, unstamped, addressed 'To whoever finds this'; on the bookstall counter.",
    disposal: "Opened, as addressed. It said: 'Hello. I hope the rest of your day is better.' It was. Pinned up over the counter.",
  },
  {
    id: 'wig',
    date: '1966-09-12',
    article: "Wig, gent's, auburn; on the rack of the 8.14.",
    disposal: 'The owner telephoned but would not come in. Posted in a plain wrapper, at his request and expense.',
  },
  {
    id: 'skeleton',
    date: '1967-10-30',
    article: 'Skeleton, human, articulated, in a long box marked GEORGE; on the 5.40 from Ellerby.',
    disposal: 'Claimed by a medical student after an hour with the police. George was very well behaved.',
  },
  {
    id: 'downline',
    date: '1968-02-19',
    article:
      "Book: 'The Down Line', a novel by F. Hesketh, new; posted to this office, not lost. Inscribed: 'For whoever kept my typewriter. I bought another and finished it.'",
    disposal: 'Kept, beside the typewriter ([[typewriter]]). The train, it turns out, was late.',
  },
  {
    id: 'goat',
    date: '1968-06-24',
    article: 'Goat, nanny, tethered to the bench at Platform 1, eating the timetable.',
    disposal: 'Claimed by a farmer from Wrayford, who paid for the timetable.',
  },
  {
    id: 'moon',
    date: '1969-07-21',
    article: 'Radio, transistor, still on, on the footbridge at four in the morning, tuned to the Moon.',
    disposal: 'Claimed by the night foreman, who had gone up the steps to look.',
  },
  {
    id: 'roses',
    date: '1970-03-16',
    article: "Roses, red, two dozen, with a card that said 'Sorry'; on the 8.14.",
    disposal: 'Unclaimed. Put in water. They lasted eleven days, which is longer than some apologies.',
  },
  {
    id: 'purse',
    date: '1971-02-15',
    article: "Purse, lady's, holding £1 3s. 4d. in the old money and a note: 'Decimal, no thank you.'",
    disposal: 'Claimed by the owner, who was given it back in the new money and did not care for it.',
  },
  {
    id: 'snake',
    date: '1972-06-05',
    article: 'Snake, grass, harmless, in a biscuit tin on the 11.05. Out of the tin before it could be entered.',
    disposal:
      'Entered anyway. Found three days later on the warm pipe under the counter, beside Horace. Taken to the museum at Wrayford.',
  },
  {
    id: 'wren',
    date: '1973-09-03',
    article:
      'Mr Peter Wren, aged 41, asked whether we had kept his gas mask from the first of September 1939. We had ([[gasmask]]). He put it on, took it off, and stood a long time.',
    disposal: 'Claimed, thirty-four years on. And the doll ([[doll]]), for his sister, who was on the same train.',
  },
  {
    id: 'candles',
    date: '1974-01-14',
    article: 'Candles, household, a box of a hundred and forty-four; on the 5.40, in the three-day week.',
    disposal: 'Unclaimed. Used.',
  },
  {
    id: 'forty',
    date: '1975-10-06',
    article:
      "Umbrella, gent's, black. Ordinary. Entered because, by my count, it is the forty-thousandth umbrella into this office since 1924.",
    disposal: 'Claimed. The owner was not interested in the count.',
  },
  {
    id: 'deckchair',
    date: '1976-07-05',
    article: 'Deckchair, striped, set up at the end of Platform 7 in the heat, with a newspaper and nobody in it.',
    disposal: 'Claimed after lunch.',
  },
  {
    id: 'ghost',
    date: '1977-11-14',
    article: "A gentleman asked whether anyone had handed in his ghost. I asked him to describe it. He said he couldn't.",
    disposal: 'Nothing answering the description.',
  },
  {
    id: 'coat',
    date: '1978-12-04',
    article: 'Coat, fur, full-length; on the night mail, with a ticket to Paris in the pocket.',
    disposal:
      'Claimed by a lady who said she had decided not to go, and then, at the counter, that she had decided to after all. She ran for the boat train.',
  },
  {
    id: 'handover',
    date: '1979-03-30',
    article:
      'Continued by Mr D. Mensah from Monday. I leave him the keys, Horace, and the book from [[persuasion]], which is not to be sold, read, or moved off the shelf behind the counter. He has promised.',
    disposal: 'I.D., twenty-eight years.',
  },

  // Desmond Mensah, 1979 to 1986.
  {
    id: 'took-over',
    date: '1979-04-02',
    article: 'Took over from Miss Dunmore. Spent the morning reading this book instead of working. Horace bit me.',
    disposal: 'D.M.',
  },
  {
    id: 'cat',
    date: '1980-05-12',
    article:
      "Cat, tabby, who travelled from Aldermoor to Saltcote and back six times before anyone noticed she wasn't with anybody.",
    disposal: 'Unclaimed. Lives at the station now. Horace not consulted.',
  },
  {
    id: 'cassette',
    date: '1980-09-22',
    article: "Cassette player, personal, with headphones; on the 8.14. The tape inside labelled 'For the 8.14'.",
    disposal: 'Claimed by a student. I had listened to side one. Not bad.',
  },
  {
    id: 'cube',
    date: '1980-11-03',
    article: 'Puzzle cube, coloured, solved on one face only; on the 2.10.',
    disposal: 'I did the rest at lunch. Claimed by a boy, who was not pleased.',
  },
  {
    id: 'clock',
    date: '1981-06-15',
    article:
      'Tried the key from [[churchkey]] in every lock in the station. It opens the station clock. Nobody knew the clock had a door.',
    disposal: 'Inside: a lot of dust and a penny from 1924. Key kept on the ring.',
  },
  {
    id: 'computer',
    date: '1982-04-19',
    article: 'Computer, home, in a carrier bag, with a cassette marked GAME, DO NOT ERASE; on the 5.40.',
    disposal: 'Claimed by a boy and his father, both in a state. The game had not been erased. I checked.',
  },
  {
    id: 'watched',
    date: '1983-01-31',
    article:
      'Film ([[film]]) watched at last, on a projector borrowed from the Institute. Eleven minutes of a dog on a beach. Very good dog.',
    disposal: 'Still unclaimed. Wrote WATCHED on the tin, under DO NOT WATCH.',
  },
  {
    id: 'teeth3',
    date: '1983-08-08',
    article: 'Teeth, false, upper and lower, together, in a tobacco tin; on the 8.14.',
    disposal: 'Claimed. They still come in, nearly sixty years on: see [[teeth1]] and [[teeth2]].',
  },
  {
    id: 'briefcase',
    date: '1984-03-12',
    article: 'Briefcase, locked; on the rack of the 8.14.',
    disposal: "Claimed by a man who wouldn't say what was in it, then told me anyway. Sandwiches.",
  },
  {
    id: 'surfboard',
    date: '1984-11-26',
    article: 'Surfboard; on the 2.10 up from Hollins Bay, in November.',
    disposal: 'Claimed by an optimist.',
  },
  {
    id: 'telephone',
    date: '1985-05-20',
    article: 'Telephone, portable, the size of a brick, ringing; under a seat of the 8.14.',
    disposal: 'I answered it. It was his wife. Claimed within the hour.',
  },
  {
    id: 'tickets',
    date: '1985-11-11',
    article:
      "Letter to this office from Michael Coyle (see [[violin]] and [[concert]]), playing his last concert with the city orchestra, with two tickets 'for whoever is at the counter now'.",
    disposal: 'Went. He played the violin from [[violin]]. Took Miss Dunmore.',
  },
  {
    id: 'harbour',
    date: '1986-03-03',
    article:
      "Spectacles ([[spectacles]]), still on the desk after sixty-two years. Put them on this morning. If you look at the window, the harbour's there.",
    disposal: 'Not an article.',
  },
  {
    id: 'claimed',
    date: '1986-10-17',
    article:
      "Book: 'Persuasion' ([[persuasion]]), claimed after twenty-eight years and four months by Mrs M. Abbot, born Lindqvist, aged 61. She and Mr Abbot met again in 1961, in a queue at the post office in Ellerby, and were married that winter. He died in March. He never told her about the book; she found it in his diary: 'Persuasion, the 8.14, 9 June 1958. She didn't come.' She came in to see if it was true.",
    disposal:
      "She read p. 237 at the counter and wouldn't tell me what was on it. I telephoned Miss Dunmore afterwards. I think we both cried.",
  },
  {
    id: 'drawer',
    date: '1986-10-30',
    article:
      "Key to the counter drawer ([[drawerkey]]), found at last in the lining of Mr Pell's old stool when it went for auction. In the drawer, locked since 1924: a child's umbrella, red, and a note in Mr Pell's hand, 'Found inside [[umbrella]]. Owner unknown.'",
    disposal: 'Unclaimed. Taken home, with this book.',
  },
  {
    id: 'last',
    date: '1986-10-31',
    article: 'Tortoise, Horace ([[horace]]). Handed in 1938. In good order, age not known. The last article in this office.',
    disposal:
      'Unclaimed after forty-eight years. Taken home by D. Mensah at closing, with this book and the umbrella. Office closed 5.30 p.m.',
  },
];

const MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

/** Curly quotes and a real ellipsis. */
export function smart(s: string): string {
  return s
    .replace(/\.\.\./g, '…')
    .replace(/(\w)'(\w)/g, '$1’$2')
    .replace(/(^|[\s(…])'/g, '$1‘')
    .replace(/'/g, '’');
}

function handFor(date: string): Hand {
  if (date < '1951-07-01') return 'pell';
  if (date < '1979-04-01') return 'dunmore';
  return 'mensah';
}

const numbers = new Map(RAW.map((r, i) => [r.id, i + 1]));

function segments(s: string): Segment[] {
  const out: Segment[] = [];
  const re = /\[\[([\w-]+)\]\]/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ text: smart(s.slice(last, m.index)) });
    const no = numbers.get(m[1]);
    if (!no) throw new Error(`lost-property: no entry "${m[1]}" to refer to`);
    out.push({ ref: no });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: smart(s.slice(last)) });
  return out;
}

const plain = (segs: Segment[]) => segs.map((s) => ('ref' in s ? `No. ${s.ref}` : s.text)).join('');

for (let i = 1; i < RAW.length; i++) {
  if (RAW[i].date < RAW[i - 1].date) throw new Error(`lost-property: ${RAW[i].id} is out of date order`);
}

export const ENTRIES: Entry[] = RAW.map((r, i) => {
  const [y, m, d] = r.date.split('-').map(Number);
  const article = segments(r.article);
  const disposal = segments(r.disposal);
  const pencil = r.pencil ? segments(r.pencil) : null;
  return {
    no: i + 1,
    id: r.id,
    date: r.date,
    year: y,
    day: `${d} ${MONTHS[m - 1]}`,
    hand: handFor(r.date),
    article,
    disposal,
    pencil,
    index: [plain(article), plain(disposal), pencil ? plain(pencil) : ''].join(' ').toLowerCase(),
  };
});

/** Entries shown from the start, so the form of the book is clear. */
export const OPEN = new Set([1]);
