// The light each tube gives off, as a list of wavelengths, and the colour the eye makes of it.
//
// A tube's colour is never picked by hand: it is the sum of its gas's emission lines (and, for a
// coated tube, the phosphor's broad band), passed through the glass, weighed against the CIE 1931
// colour-matching functions, and turned into sRGB. The same lists drive the diffraction grating.

export interface Line {
  nm: number;
  w: number;
}

export interface Band {
  nm: number;
  sigma: number;
  w: number;
}

// Visible lines of each gas in a sign tube's discharge. Wavelengths are the well-known lines; the
// weights are relative strengths set by eye for a low-pressure glow, not measured intensities.
const NEON: Line[] = [
  { nm: 533.1, w: 6 },
  { nm: 540.1, w: 14 },
  { nm: 585.2, w: 100 },
  { nm: 588.2, w: 38 },
  { nm: 594.5, w: 52 },
  { nm: 597.6, w: 18 },
  { nm: 603.0, w: 28 },
  { nm: 607.4, w: 40 },
  { nm: 609.6, w: 48 },
  { nm: 614.3, w: 70 },
  { nm: 616.4, w: 36 },
  { nm: 621.7, w: 38 },
  { nm: 626.6, w: 58 },
  { nm: 630.5, w: 40 },
  { nm: 633.4, w: 62 },
  { nm: 638.3, w: 72 },
  { nm: 640.2, w: 100 },
  { nm: 650.7, w: 70 },
  { nm: 653.3, w: 30 },
  { nm: 659.9, w: 42 },
  { nm: 667.8, w: 50 },
  { nm: 671.7, w: 40 },
  { nm: 693.0, w: 60 },
  { nm: 703.2, w: 80 },
  { nm: 717.4, w: 22 },
  { nm: 724.5, w: 40 },
];

const ARGON: Line[] = [
  { nm: 415.9, w: 30 },
  { nm: 418.2, w: 10 },
  { nm: 419.8, w: 20 },
  { nm: 420.1, w: 30 },
  { nm: 425.9, w: 25 },
  { nm: 427.2, w: 20 },
  { nm: 430.0, w: 20 },
  { nm: 451.1, w: 10 },
  { nm: 560.7, w: 5 },
  { nm: 603.2, w: 5 },
  { nm: 696.5, w: 40 },
  { nm: 706.7, w: 40 },
  { nm: 727.3, w: 20 },
  { nm: 738.4, w: 40 },
  { nm: 750.4, w: 90 },
];

const MERCURY: Line[] = [
  { nm: 404.7, w: 60 },
  { nm: 407.8, w: 10 },
  { nm: 435.8, w: 100 },
  { nm: 491.6, w: 4 },
  { nm: 546.1, w: 90 },
  { nm: 577.0, w: 34 },
  { nm: 579.1, w: 36 },
];

const HELIUM: Line[] = [
  { nm: 388.9, w: 50 },
  { nm: 402.6, w: 10 },
  { nm: 447.1, w: 60 },
  { nm: 471.3, w: 20 },
  { nm: 492.2, w: 25 },
  { nm: 501.6, w: 40 },
  { nm: 587.6, w: 100 },
  { nm: 667.8, w: 40 },
  { nm: 706.5, w: 50 },
  { nm: 728.1, w: 15 },
];

export type Rgb = [number, number, number];

export interface Glass {
  id: string;
  /** What the rack's label says. */
  name: string;
  /** The gas, for the spectrum's caption. */
  gas: 'neon' | 'helium' | 'argon';
  /** Glass that colours the light, or 'clear'. */
  glass: 'clear' | 'ruby' | 'cobalt' | 'canary';
  phosphor?: Band[];
  /** How bright the tube looks next to clear neon, at full warmth. */
  lum: number;
  /** What the unlit tube looks like: sRGB colour and how much of the scene behind it it hides. */
  body: Rgb;
  bodyOpacity: number;
  note: string;
}

export const GLASSES: Glass[] = [
  {
    id: 'neon-clear',
    name: 'Neon, clear glass',
    gas: 'neon',
    glass: 'clear',
    lum: 1,
    body: [0.62, 0.66, 0.68],
    bodyOpacity: 0.12,
    note: "Neon's own light: a crowd of lines from yellow to deep red, and almost nothing shorter.",
  },
  {
    id: 'neon-ruby',
    name: 'Neon, ruby glass',
    gas: 'neon',
    glass: 'ruby',
    lum: 0.5,
    body: [0.42, 0.04, 0.05],
    bodyOpacity: 0.55,
    note: 'Ruby glass swallows the yellow and orange end of the neon lines and passes only the reds.',
  },
  {
    id: 'helium-clear',
    name: 'Helium, clear glass',
    gas: 'helium',
    glass: 'clear',
    lum: 0.55,
    body: [0.62, 0.66, 0.68],
    bodyOpacity: 0.12,
    note: "Helium's few lines are spread across the whole spectrum, with one strong yellow, so it burns a pale peach.",
  },
  {
    id: 'argon-clear',
    name: 'Argon and mercury, clear glass',
    gas: 'argon',
    glass: 'clear',
    lum: 0.42,
    body: [0.62, 0.66, 0.68],
    bodyOpacity: 0.12,
    note: "Mercury's violet, blue, green, and yellow lines. While the tube is cold, argon's red and violet lines win, and it starts out lilac.",
  },
  {
    id: 'argon-cobalt',
    name: 'Argon and mercury, cobalt glass',
    gas: 'argon',
    glass: 'cobalt',
    lum: 0.24,
    body: [0.08, 0.13, 0.5],
    bodyOpacity: 0.55,
    note: "Cobalt glass keeps mercury's violet and blue lines and lets a little of argon's deep red leak through.",
  },
  {
    id: 'argon-canary',
    name: 'Argon and mercury, canary glass',
    gas: 'argon',
    glass: 'canary',
    lum: 0.55,
    body: [0.8, 0.76, 0.24],
    bodyOpacity: 0.45,
    note: "Yellow canary glass cuts off mercury's violet and blue, leaving its green and yellow lines: a green tube with no green powder in it.",
  },
  {
    id: 'coat-white',
    name: 'Warm white coating',
    gas: 'argon',
    glass: 'clear',
    phosphor: [
      { nm: 482, sigma: 30, w: 0.55 },
      { nm: 584, sigma: 38, w: 1 },
    ],
    lum: 0.85,
    body: [0.9, 0.9, 0.87],
    bodyOpacity: 0.85,
    note: "Mercury's strongest line is ultraviolet and invisible. The powder on the glass turns it into two broad bands, blue and orange, that the eye adds up to white.",
  },
  {
    id: 'coat-pink',
    name: 'Pink coating',
    gas: 'argon',
    glass: 'clear',
    phosphor: [
      { nm: 611, sigma: 7, w: 1 },
      { nm: 452, sigma: 24, w: 0.32 },
    ],
    lum: 0.7,
    body: [0.92, 0.9, 0.9],
    bodyOpacity: 0.85,
    note: 'A narrow red band and a little blue from the powder, with mercury showing through on top.',
  },
  {
    id: 'coat-green',
    name: 'Green coating',
    gas: 'argon',
    glass: 'clear',
    phosphor: [{ nm: 525, sigma: 17, w: 1 }],
    lum: 0.95,
    body: [0.9, 0.91, 0.88],
    bodyOpacity: 0.85,
    note: 'One green band from the powder, close to where the eye is most sensitive, so it is the brightest tube on the rack.',
  },
  {
    id: 'coat-turquoise',
    name: 'Turquoise coating',
    gas: 'argon',
    glass: 'clear',
    phosphor: [{ nm: 492, sigma: 26, w: 1 }],
    lum: 0.75,
    body: [0.89, 0.91, 0.91],
    bodyOpacity: 0.85,
    note: 'A blue-green band from the powder, with mercury lines on top.',
  },
];

export const GLASS_INDEX: Record<string, number> = Object.fromEntries(GLASSES.map((g, i) => [g.id, i]));

/** Groups an emission entry belongs to, so warm-up can scale argon and mercury separately. */
export const Group = { Steady: 0, Argon: 1, Mercury: 2 } as const;
export type Group = (typeof Group)[keyof typeof Group];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How much of each wavelength the glass lets through. */
export function transmit(glass: Glass['glass'], nm: number): number {
  switch (glass) {
    case 'ruby':
      return 0.92 * smooth(588, 618, nm);
    case 'cobalt':
      return 0.85 * Math.exp(-(((nm - 438) / 52) ** 2)) + 0.55 * smooth(655, 705, nm);
    case 'canary':
      return 0.95 * smooth(468, 516, nm);
    default:
      return 0.96;
  }
}

// CIE 1931 2-degree colour-matching functions, as the piecewise-Gaussian fit of Wyman, Sloan, and
// Shirley (2013).
const g = (x: number, mu: number, s1: number, s2: number) => {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};

export function cmf(nm: number): Rgb {
  const x = 1.056 * g(nm, 599.8, 37.9, 31.0) + 0.362 * g(nm, 442.0, 16.0, 26.7) - 0.065 * g(nm, 501.1, 20.4, 26.2);
  const y = 0.821 * g(nm, 568.8, 46.9, 40.5) + 0.286 * g(nm, 530.9, 16.3, 31.1);
  const z = 1.217 * g(nm, 437.0, 11.8, 36.0) + 0.681 * g(nm, 459.0, 26.0, 13.8);
  return [x, y, z];
}

/** XYZ to linear sRGB (D65). */
export function xyzToRgb([x, y, z]: Rgb): Rgb {
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
}

/** Pull a colour back into gamut by adding white until no channel is negative. */
export function intoGamut(c: Rgb): Rgb {
  const low = Math.min(c[0], c[1], c[2]);
  if (low >= 0) return c;
  return [c[0] - low, c[1] - low, c[2] - low];
}

/** The displayable colour of one wavelength, at the brightness the eye gives it. */
export function lineRgb(nm: number): Rgb {
  return intoGamut(xyzToRgb(cmf(nm)));
}

export interface Emission {
  nm: number;
  /** Linear sRGB this entry adds, already scaled by glass, strength, and the tube's brightness. */
  rgb: Rgb;
  /** Relative strength before colour, for drawing the spectrum. */
  w: number;
  group: Group;
  /** Phosphor samples are slices of a band, not lines. */
  band: boolean;
  source: 'Ne' | 'He' | 'Ar' | 'Hg' | 'powder';
}

export interface GlassLight {
  entries: Emission[];
  /** Colour sums by group, so warm-up can mix them each frame. */
  steady: Rgb;
  argon: Rgb;
  mercury: Rgb;
}

const BAND_STEP = 5;

function rawEntries(glass: Glass): Omit<Emission, 'rgb'>[] {
  const out: Omit<Emission, 'rgb'>[] = [];
  const add = (lines: Line[], scale: number, group: Group, source: Emission['source']) => {
    for (const l of lines) out.push({ nm: l.nm, w: (l.w / 100) * scale, group, band: false, source });
  };
  if (glass.gas === 'neon') add(NEON, 1, Group.Steady, 'Ne');
  else if (glass.gas === 'helium') add(HELIUM, 1, Group.Steady, 'He');
  else {
    // Argon carries the discharge until the mercury warms up and takes over.
    add(ARGON, 0.55, Group.Argon, 'Ar');
    add(MERCURY, glass.phosphor ? 0.35 : 1, Group.Mercury, 'Hg');
    if (glass.phosphor) {
      for (let nm = 380; nm <= 760; nm += BAND_STEP) {
        let w = 0;
        for (const b of glass.phosphor) w += b.w * Math.exp(-0.5 * ((nm - b.nm) / b.sigma) ** 2);
        if (w < 0.01) continue;
        out.push({ nm, w: w * 0.9, group: Group.Mercury, band: true, source: 'powder' });
      }
    }
  }
  return out;
}

/** Work out each entry's colour, normalised so the warm tube's luminance matches the rack. */
export function glassLight(glass: Glass): GlassLight {
  const raw = rawEntries(glass);
  // Luminance at full warmth: argon lines are mostly drowned out by then.
  let yFull = 0;
  for (const e of raw) {
    const t = transmit(glass.glass, e.nm);
    const groupScale = e.group === Group.Argon ? 0.2 : 1;
    yFull += e.w * t * cmf(e.nm)[1] * groupScale;
  }
  const k = glass.lum / Math.max(yFull, 1e-6);
  const sums: Record<Group, Rgb> = { 0: [0, 0, 0], 1: [0, 0, 0], 2: [0, 0, 0] };
  const entries: Emission[] = raw.map((e) => {
    const t = transmit(glass.glass, e.nm);
    const xyz = cmf(e.nm);
    const lin = xyzToRgb(xyz);
    const s = e.w * t * k;
    const rgb: Rgb = [lin[0] * s, lin[1] * s, lin[2] * s];
    const sum = sums[e.group];
    sum[0] += rgb[0];
    sum[1] += rgb[1];
    sum[2] += rgb[2];
    // The grating shows each line on its own, so each needs to be displayable by itself.
    return { ...e, w: e.w * t, rgb: intoGamut(rgb) };
  });
  return { entries, steady: sums[0], argon: sums[1], mercury: sums[2] };
}

/** How far a mercury tube has warmed up, 0 cold to 1 full, after `t` seconds lit. */
export function warmth(t: number): number {
  return 1 - 0.82 * Math.exp(-t / 7);
}

/** A tube's colour at a given warmth (linear sRGB, before brightness). */
export function colourAt(light: GlassLight, warm: number): Rgb {
  const a = 1 - 0.8 * warm;
  const c: Rgb = [
    light.steady[0] + light.argon[0] * a + light.mercury[0] * warm,
    light.steady[1] + light.argon[1] * a + light.mercury[1] * warm,
    light.steady[2] + light.argon[2] * a + light.mercury[2] * warm,
  ];
  return intoGamut(c);
}

/** Linear to sRGB-encoded, clamped, for CSS swatches. */
export function toCss(c: Rgb, gain = 1): string {
  const enc = (v: number) => {
    const x = Math.min(1, Math.max(0, v * gain));
    return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
  };
  return `rgb(${enc(c[0])} ${enc(c[1])} ${enc(c[2])})`;
}

/** A swatch colour: the warm tube, scaled so its brightest channel is full. */
export function swatch(glass: Glass): string {
  const c = colourAt(glassLight(glass), 1);
  const m = Math.max(c[0], c[1], c[2], 1e-6);
  return toCss(c, 1 / m);
}
