// The passages the brush can set. All are in the public domain. Verse line
// breaks fold into spaces: a calligram reads in rows across its shape, not in
// the poem's own lines. Stanza breaks become a pilcrow.

export interface Passage {
  id: string;
  /** Short name for the tally and the picker. */
  title: string;
  /** Author and source, for the picker. */
  credit: string;
  text: string;
}

const verse = (lines: string) =>
  lines
    .trim()
    .split(/\n\s*\n/)
    .map((stanza) => stanza.trim().split(/\s*\n\s*/).join(' '))
    .join(' ¶ ');

export const PASSAGES: Passage[] = [
  {
    id: 'tale',
    title: 'The Mouse’s Tale',
    credit: 'Lewis Carroll, Alice’s Adventures in Wonderland, 1865',
    text: verse(`
      Fury said to a mouse,
      That he met in the house,
      “Let us both go to law:
      I will prosecute you.
      Come, I’ll take no denial;
      We must have a trial:
      For really this morning
      I’ve nothing to do.”
      Said the mouse to the cur,
      “Such a trial, dear sir,
      With no jury or judge,
      would be wasting our breath.”
      “I’ll be judge, I’ll be jury,”
      Said cunning old Fury:
      “I’ll try the whole cause,
      and condemn you to death.”
    `),
  },
  {
    id: 'wings',
    title: 'Easter Wings',
    credit: 'George Herbert, The Temple, 1633',
    text: verse(`
      Lord, who createdst man in wealth and store,
      Though foolishly he lost the same,
      Decaying more and more,
      Till he became
      Most poore:
      With thee
      O let me rise
      As larks, harmoniously,
      And sing this day thy victories:
      Then shall the fall further the flight in me.

      My tender age in sorrow did beginne
      And still with sicknesses and shame
      Thou didst so punish sinne,
      That I became
      Most thinne.
      With thee
      Let me combine,
      And feel this day thy victorie:
      For, if I imp my wing on thine,
      Affliction shall advance the flight in me.
    `),
  },
  {
    id: 'sonnet',
    title: 'Sonnet 18',
    credit: 'William Shakespeare, 1609',
    text: verse(`
      Shall I compare thee to a summer’s day?
      Thou art more lovely and more temperate:
      Rough winds do shake the darling buds of May,
      And summer’s lease hath all too short a date;
      Sometime too hot the eye of heaven shines,
      And often is his gold complexion dimm’d;
      And every fair from fair sometime declines,
      By chance or nature’s changing course untrimm’d;
      But thy eternal summer shall not fade,
      Nor lose possession of that fair thou ow’st;
      Nor shall Death brag thou wander’st in his shade,
      When in eternal lines to time thou grow’st:
      So long as men can breathe or eyes can see,
      So long lives this, and this gives life to thee.
    `),
  },
  {
    id: 'whitman',
    title: 'Song of Myself',
    credit: 'Walt Whitman, Leaves of Grass, 1892',
    text: verse(`
      I celebrate myself, and sing myself,
      And what I assume you shall assume,
      For every atom belonging to me as good belongs to you.

      I loafe and invite my soul,
      I lean and loafe at my ease observing a spear of summer grass.

      My tongue, every atom of my blood, form’d from this soil, this air,
      Born here of parents born here from parents the same, and their parents the same,
      I, now thirty-seven years old in perfect health begin,
      Hoping to cease not till death.

      Creeds and schools in abeyance,
      Retiring back a while sufficed at what they are, but never forgotten,
      I harbor for good or bad, I permit to speak at every hazard,
      Nature without check with original energy.
    `),
  },
  {
    id: 'cicero',
    title: 'The real lorem ipsum',
    credit: 'Cicero, De finibus bonorum et malorum, 45 BC',
    text: `Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.`,
  },
];

/** Between one pass through a passage and the next. */
export const SEPARATOR = ' ❧ ';
