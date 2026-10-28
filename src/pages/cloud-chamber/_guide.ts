// What the chamber can show, in the order the log lists it. Each kind is a
// way a track can look, not a particle: a muon that knocks an electron loose
// is logged as a delta ray, and one that stops and decays as a muon decay.

export type Kind =
  | 'muon'
  | 'alpha'
  | 'electron'
  | 'delta'
  | 'decay'
  | 'thoron'
  | 'shower'
  | 'long-alpha'
  | 'scatter';

export interface Entry {
  kind: Kind;
  name: string;
  /** How to recognise it, in a few words. */
  look: string;
  /** What made it. */
  story: string;
}

export const ENTRIES: Entry[] = [
  {
    kind: 'muon',
    name: 'Muon',
    look: 'Thin, dotted, dead straight',
    story:
      'A muon from a cosmic-ray shower that started about fifteen kilometres up. It moves at nearly the speed of light and ionises only a few dozen molecules per centimetre, so it leaves a faint line that nothing bends. Most cross the layer at a slant and show only a short stretch.',
  },
  {
    kind: 'alpha',
    name: 'Alpha',
    look: 'Short, thick, straight',
    story:
      "Two protons and two neutrons thrown out of a radon atom in the room's air. It is heavy and slow, ionises tens of thousands of molecules per centimetre, and stops within about four centimetres. The track thickens toward the end, where it loses energy fastest.",
  },
  {
    kind: 'electron',
    name: 'Electron',
    look: 'Thin and wandering, often curled',
    story:
      'An electron set loose by a gamma ray or thrown out in a beta decay. It is so light that every atom it passes pushes it off course, and the slower it gets, the tighter it turns. Over the magnet it winds into a spiral.',
  },
  {
    kind: 'delta',
    name: 'Delta ray',
    look: 'A straight track with a curl branching off',
    story:
      'A muon hit an electron hard enough to knock it out of its atom. The muon carries on in a straight line, and the electron curls away from the point where they met.',
  },
  {
    kind: 'decay',
    name: 'Muon decay',
    look: 'A track that thickens, stops, and turns',
    story:
      'A slow muon ran out of energy in the layer, thickening as it slowed, then decayed into an electron and two neutrinos. The electron leaves from the end at an angle. A muon at rest lives about two millionths of a second.',
  },
  {
    kind: 'thoron',
    name: 'Thoron pair',
    look: 'Two alphas from one point, a moment apart',
    story:
      'A thoron atom (radon-220) drifting in the air decayed, and the polonium-216 it became decayed again a fraction of a second later, from the same spot; its half-life is 0.145 seconds. Two alphas leave the point one after the other.',
  },
  {
    kind: 'shower',
    name: 'Air shower',
    look: 'Several straight tracks at once, all parallel',
    story:
      'One cosmic ray hit the top of the atmosphere and broke into millions of particles. A few of them crossed the chamber together, all heading the same way.',
  },
  {
    kind: 'long-alpha',
    name: 'Long alpha',
    look: 'An alpha that runs twice as far',
    story:
      'An alpha from polonium-212, near the end of the thorium chain. At 8.8 MeV it is the most energetic alpha in the chain and runs about eight centimetres, twice as far as one from radon.',
  },
  {
    kind: 'scatter',
    name: 'Alpha that bounced',
    look: 'An alpha with a sharp bend near its end',
    story:
      'An alpha passed close to a nucleus and was turned sharply aside, the scattering Rutherford used to find the nucleus. It happens near the end of the track, where the alpha is slowest. The stub at the corner is the nucleus recoiling.',
  },
];

export const ENTRY: Record<Kind, Entry> = Object.fromEntries(ENTRIES.map((e) => [e.kind, e])) as Record<Kind, Entry>;

export type SourceId = 'rod' | 'marble' | 'salt';

export interface SourceInfo {
  id: SourceId;
  name: string;
  /** What is radioactive in it. */
  note: string;
}

export const SOURCES: SourceInfo[] = [
  {
    id: 'rod',
    name: 'Welding rod',
    note: 'A thoriated tungsten electrode, red-tipped for 2% thorium. Alphas fan out along it, some very long.',
  },
  {
    id: 'marble',
    name: 'Uranium glass marble',
    note: 'Glass coloured with uranium. Short alphas from its surface and fast, wandering electrons.',
  },
  {
    id: 'salt',
    name: 'Salt substitute',
    note: 'Potassium chloride. About one potassium atom in ten thousand is radioactive potassium-40, which gives off electrons.',
  },
];
