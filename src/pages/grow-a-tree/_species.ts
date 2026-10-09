// The three species: how each one grows, looks, and ages.

export type SpeciesId = 'spruce' | 'oak' | 'birch';

export interface Stage {
  name: string;
  /** Age in years when the stage begins. */
  age: number;
  text: string;
}

export interface Species {
  id: SpeciesId;
  latin: string;
  common: string;
  /** Colonize grows toward open space; whorl follows the conifer's leader-and-tiers rule. */
  model: 'colonize' | 'whorl';
  /** Chapman-Richards height curve: hMax * (1 - e^(-age / tau))^p, in metres. */
  hMax: number;
  tau: number;
  p: number;
  /** Height the seedling puts on in its first season, in metres. */
  firstYear: number;
  /** Age at which the shoot breaks the surface; the root starts a little earlier. */
  emerge: number;
  /** Retrenchment keeps nodes scoring under this alive (0 lets the whole tree die). */
  keepCrown: number;
  /** Weight of height against path length in the retrenchment score. */
  dieFromTop: number;
  /** Whether old age regrows a lower crown from the limbs. */
  reiterate: boolean;
  /** Crown radius as a share of height, by age. */
  widthRatio: (age: number) => number;
  /** Crown base as a share of height, by age. */
  crownBase: (age: number) => number;
  /** Crown radius profile from the crown base (u = 0) to the top (u = 1), 0 to 1. */
  shape: (u: number) => number;
  /** The age at which the leader stops being forced upward (decurrent species). */
  leaderLoss: number;
  /** Pull of the leader toward vertical while it rules. */
  apical: number;
  /** Upward pull on first-order shoots; negative droops. */
  liftOrder1: number;
  /** Pull on shoots of order two and up; negative droops (the birch's weeping tips). */
  liftHigher: number;
  /** Years a node keeps buds able to start a side shoot. */
  budLife: number;
  /** Radius of the finest twig, in metres. */
  tipR: number;
  /** Pipe model exponent: r^n = sum of children's r^n. */
  pipeN: number;
  /** Ring width added each year at the base of the trunk, in metres. */
  ring: number;
  /** How much the trunk swells at the root collar. */
  flare: number;
  /** Rooting depth in metres by age, and the root spread as a share of crown radius. */
  rootDepth: (age: number) => number;
  rootSpread: number;
  /** A taproot leads the roots straight down until this age. */
  taprootUntil: number;
  deciduous: boolean;
  leaf: 'oak' | 'birch' | 'needle';
  /** Leaf instances per node and their size relative to the node's segment length. */
  leavesPerNode: number;
  leafScale: number;
  /** Smallest and largest leaf instance, in metres. */
  leafMin: number;
  leafMax: number;
  /** A node carries leaves while its radius is under this many tip radii. */
  leafyR: number;
  /** Seed leaves above ground (0 for hypogeal germination). */
  cotyledons: number;
  /** Years the seed stays visible. */
  seedHold: number;
  /** Retrenchment: dieback starts here and the model ends at maxAge. */
  oldAge: number;
  maxAge: number;
  /** Bark colours: young, old, and the pattern accent. */
  bark: [number, number, number][];
  /** Leaf colours by season: spring, summer, autumn. */
  leafColors: [number, number, number][];
  stages: Stage[];
}

/** Height in metres at an age: the Chapman-Richards curve plus a first season's flush of growth. */
export function heightAt(s: Species, age: number): number {
  const a = Math.max(0, age - s.emerge);
  return s.hMax * Math.pow(1 - Math.exp(-a / s.tau), s.p) + s.firstYear * (1 - Math.exp(-a / 0.3));
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.min(1, Math.max(0, t));

const rgb = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

export const SPECIES: Record<SpeciesId, Species> = {
  oak: {
    id: 'oak',
    latin: 'Quercus robur',
    common: 'English oak',
    model: 'colonize',
    hMax: 26,
    tau: 48,
    p: 1.4,
    firstYear: 0.12,
    emerge: 0.14,
    keepCrown: 0.5,
    dieFromTop: 0.5,
    reiterate: true,
    widthRatio: (a) => lerp(0.16, 0.62, (a - 6) / 90) + lerp(0, 0.12, (a - 250) / 250),
    crownBase: (a) => lerp(0.08, 0.2, (a - 8) / 60),
    shape: (u) => Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(u, 0.85))), 0.7),
    leaderLoss: 30,
    apical: 2.4,
    liftOrder1: 0.18,
    liftHigher: 0.05,
    budLife: 3,
    tipR: 0.0035,
    pipeN: 2.4,
    ring: 0.0021,
    flare: 0.6,
    rootDepth: (a) => lerp(0.25, 1.6, a / 60),
    rootSpread: 1.05,
    taprootUntil: 12,
    deciduous: true,
    leaf: 'oak',
    leavesPerNode: 2,
    leafScale: 1.15,
    leafMin: 0.035,
    leafMax: 0.7,
    leafyR: 2.6,
    cotyledons: 0,
    seedHold: 1,
    oldAge: 300,
    maxAge: 800,
    bark: [rgb(0x7d7a5e), rgb(0x5b5348), rgb(0x2e2a24)],
    leafColors: [rgb(0x9cc25a), rgb(0x4e7330), rgb(0xa8692a)],
    stages: [
      {
        name: 'Seed',
        age: 0,
        text: 'An acorn, fallen in autumn. Inside the shell, two fat seed leaves hold the food that will carry the seedling until it can feed itself. Jays bury acorns by the thousand; the ones they forget become oaks.',
      },
      {
        name: 'Germination',
        age: 0.08,
        text: "The root comes first: a radicle pushes down to anchor the acorn and draw in water. An oak's seed leaves never leave the shell. They stay at the surface and feed the shoot as it climbs, which botanists call hypogeal germination.",
      },
      {
        name: 'Seedling',
        age: 0.4,
        text: 'The first true leaves open. A seedling is at its most fragile now: deer, slugs, mildew, and shade all take their share.',
      },
      {
        name: 'Sapling',
        age: 4,
        text: "About half a metre tall, the Woodland Trust's rough mark for a sapling. The trunk is flexible, the bark is smooth, and it can't flower yet. Oak is long-lived, so it stays a sapling far longer than a birch.",
      },
      {
        name: 'Young',
        age: 15,
        text: 'A young oak grows like a conifer: one leader and a narrow crown. Around now the leader loses its grip, side branches catch up, and the crown begins to spread, the change from excurrent to decurrent growth.',
      },
      {
        name: 'Mature',
        age: 40,
        text: 'Around forty, the oak bears its first acorns. It is most productive between about 80 and 120 years and can keep going for about three centuries. The lowest limbs were shed as the crown rose toward the light.',
      },
      {
        name: 'Over-mature',
        age: 300,
        text: "Past its prime, the oak slows. The crown dies back from the top and the tips, leaving bare branches standing above the leaves: a 'stag-headed' oak.",
      },
      {
        name: 'Ancient',
        age: 480,
        text: 'Ancient means old for its kind, not a fixed age. The crown has retrenched, regrowing lower and closer to the trunk, which eases the load on an old stem. The trunk is wide and often hollow, and its dead wood feeds insects, fungi, birds, and bats.',
      },
    ],
  },
  birch: {
    id: 'birch',
    latin: 'Betula pendula',
    common: 'Silver birch',
    model: 'colonize',
    hMax: 21,
    tau: 18,
    p: 1.3,
    firstYear: 0.06,
    emerge: 0.12,
    keepCrown: 0,
    dieFromTop: 0.55,
    reiterate: false,
    widthRatio: (a) => lerp(0.14, 0.27, (a - 3) / 30),
    crownBase: (a) => lerp(0.08, 0.32, (a - 4) / 30),
    shape: (u) => Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(u, 0.7))), 0.85),
    leaderLoss: Infinity,
    apical: 1.6,
    liftOrder1: 0.32,
    liftHigher: -0.9,
    budLife: 2,
    tipR: 0.0022,
    pipeN: 2.3,
    ring: 0.0026,
    flare: 0.35,
    rootDepth: (a) => lerp(0.2, 0.9, a / 25),
    rootSpread: 1.4,
    taprootUntil: 3,
    deciduous: true,
    leaf: 'birch',
    leavesPerNode: 3,
    leafScale: 0.9,
    leafMin: 0.022,
    leafMax: 0.42,
    leafyR: 2.4,
    cotyledons: 2,
    seedHold: 0.25,
    oldAge: 75,
    maxAge: 140,
    bark: [rgb(0xe9e4da), rgb(0x3b3632), rgb(0x1f1c1a)],
    leafColors: [rgb(0xb6d46a), rgb(0x5f8a35), rgb(0xd9b13a)],
    stages: [
      {
        name: 'Seed',
        age: 0,
        text: 'A birch seed is a tiny nut with two papery wings, a few millimetres across. One tree sheds enormous numbers of them, and the wind carries them far, which is why birch is so often first onto open ground.',
      },
      {
        name: 'Germination',
        age: 0.08,
        text: 'Birch seed sprouts best in light, on bare ground rather than under a canopy. Its two round seed leaves rise above the soil and turn green, which is epigeal germination.',
      },
      {
        name: 'Seedling',
        age: 0.4,
        text: 'Tiny and quick. Seedlings are easily lost to drought, grazing, and shade, so birch makes up in numbers what it lacks in toughness.',
      },
      {
        name: 'Sapling',
        age: 2,
        text: 'Half a metre and climbing fast. Birch is short-lived, and it races through the sapling stage where oak and yew linger.',
      },
      {
        name: 'Young',
        age: 6,
        text: "A narrow, pointed crown on one stem. The bark turns white and peels in papery strips, and the twig tips start to hang, the habit behind the name pendula: hanging.",
      },
      {
        name: 'Mature',
        age: 15,
        text: 'Birch flowers young, hanging out catkins and shedding seed in its first decade or two. The base of the trunk cracks into dark, rugged diamonds, and the fine twigs fall in curtains from arching branches.',
      },
      {
        name: 'Over-mature',
        age: 75,
        text: 'Birch rarely lives much past a century. Fungi move into the wood, the crown thins, and branches die back from the top.',
      },
      {
        name: 'Ancient',
        age: 105,
        text: 'An old birch soon becomes a snag: a dead or dying tree left standing. Its soft wood rots fast, and woodpeckers, beetles, and fungi make the most of it.',
      },
    ],
  },
  spruce: {
    id: 'spruce',
    latin: 'Picea abies',
    common: 'Norway spruce',
    model: 'whorl',
    hMax: 30,
    tau: 42,
    p: 1.6,
    firstYear: 0.045,
    emerge: 0.14,
    keepCrown: 0.3,
    dieFromTop: 0.75,
    reiterate: false,
    widthRatio: () => 0.2,
    crownBase: (a) => lerp(0.02, 0.12, (a - 20) / 80),
    shape: (u) => 1 - u,
    leaderLoss: Infinity,
    apical: 3,
    liftOrder1: 0,
    liftHigher: 0,
    budLife: 1,
    tipR: 0.003,
    pipeN: 2.35,
    ring: 0.0024,
    flare: 0.45,
    rootDepth: (a) => lerp(0.18, 0.7, a / 30),
    rootSpread: 1.25,
    taprootUntil: 2,
    deciduous: false,
    leaf: 'needle',
    leavesPerNode: 2,
    leafScale: 1.5,
    leafMin: 0.03,
    leafMax: 0.6,
    leafyR: 3.2,
    cotyledons: 8,
    seedHold: 0.3,
    oldAge: 200,
    maxAge: 400,
    bark: [rgb(0x8a5a3c), rgb(0x5c4033), rgb(0x2f2219)],
    leafColors: [rgb(0x7fae55), rgb(0x3e6b36), rgb(0x3a6533)],
    stages: [
      {
        name: 'Seed',
        age: 0,
        text: 'A small seed with a single papery wing, shaken from a hanging cone. It spins as it falls, like a sycamore key, and can drift a long way on the wind.',
      },
      {
        name: 'Germination',
        age: 0.08,
        text: 'The root goes down first. Then the shoot hooks up through the soil carrying a ring of needle-like seed leaves, often still wearing the seed coat like a cap.',
      },
      {
        name: 'Seedling',
        age: 0.5,
        text: 'True needles grow above the ring of seed leaves. Spruce seedlings stand shade far better than oak or birch, so they can wait under older trees for a gap to open.',
      },
      {
        name: 'Sapling',
        age: 4,
        text: 'Half a metre. One leader grows straight up each year, and at its tip a whorl of buds sets the next tier of branches. Counting the tiers ages a young conifer.',
      },
      {
        name: 'Young',
        age: 15,
        text: 'Strong apical control: the leader holds back the branches below it, so they grow outward rather than up. The result is the classic cone, an excurrent crown.',
      },
      {
        name: 'Mature',
        age: 30,
        text: 'Long cones hang from the upper branches. Lower branches lose their light and die as the crown rises, though a spruce in the open can keep living branches almost to the ground.',
      },
      {
        name: 'Over-mature',
        age: 200,
        text: 'Growth slows and the top thins. Spruce roots run shallow, so an old tree with a heavy crown is easily thrown by the wind.',
      },
      {
        name: 'Ancient',
        age: 300,
        text: "Old spruces die back from the top down. In Sweden, one Norway spruce's root system has been dated to around 9,500 years: its stems die, and low branches that touch the ground take root and grow new ones.",
      },
    ],
  },
};
