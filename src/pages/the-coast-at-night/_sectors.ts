// Sectors, ranges, and seasons, read from the printed remarks and range.
//
// Sector limits in both lists are true bearings of the light as seen from a
// vessel (from seaward toward the light), arranged clockwise. NGA chains them
// ("R. 271°-301°, W.-051°": red to 301°, then white to 051°); USCG writes each
// in full ("Obscured from 076° to 147°").

import { COLOURS, type Colour } from './_rhythm';

export interface Sector {
  /** Bearing from the vessel to the light, degrees true, clockwise to `to`. */
  from: number;
  to: number;
  /** Null for an obscured arc. */
  colour: Colour | null;
}

// 319°24` (NGA minutes are a backtick or an apostrophe); 120.5° (USCG).
const ANGLE = String.raw`(\d{1,3}(?:\.\d+)?)\s*°\s*(?:(\d{1,2}(?:\.\d+)?)\s*[\`'´′])?`;
const deg = (d: string, m?: string) => (parseFloat(d) + (m ? parseFloat(m) / 60 : 0)) % 360;

const NGA = new RegExp(
  String.raw`(?<![A-Za-z])(?:(?:F|Al|Fl|LFl|L\.Fl|Oc|Iso|Q|VQ|Mo)\.?(?:\(\w+\))?\s*)*` +
    String.raw`((?:(?:W|R|G|Y|Bu|Vi|Or)\.\s*)+|[Vv]isible|[Oo]bscured(?:[^\d,;.]{0,40}?)|[Ii]ntensified|[Uu]nintensified)` +
    String.raw`\s*(?:\([^)]*\)\s*)?(?:${ANGLE})?\s*-\s*${ANGLE}`,
  'g',
);

const USCG_WORD: Record<string, Colour | null | 'visible'> = {
  red: 'R',
  r: 'R',
  white: 'W',
  w: 'W',
  green: 'G',
  g: 'G',
  yellow: 'Y',
  y: 'Y',
  obscured: null,
  visible: 'visible',
};
const USCG = new RegExp(
  String.raw`\b(Red|White|Green|Yellow|R|W|G|Y|[Oo]bscured|[Vv]isible)\b[^.;]*?\bfrom\s+${ANGLE}\s*to\s+${ANGLE}` +
    String.raw`(?:\s*(?:,|and)\s*(?:from\s+)?${ANGLE}\s*to\s+${ANGLE})?`,
  'g',
);

/** Visible sectors, or null for a light shown all round. */
export function parseSectors(remarks: string, primary: Colour, src: 'nga' | 'uscg'): Sector[] | null {
  const raw: Sector[] = [];
  if (src === 'nga') {
    let prevEnd: number | null = null;
    for (const m of remarks.matchAll(NGA)) {
      const label = m[1].trim();
      const to = deg(m[4], m[5]);
      const from = m[2] !== undefined ? deg(m[2], m[3]) : prevEnd;
      if (/ntensified/i.test(label)) continue;
      if (from === null) {
        prevEnd = to;
        continue;
      }
      const colour = /isible/i.test(label)
        ? primary
        : /bscured/i.test(label)
          ? null
          : ((label.split('.')[0].trim() as Colour) ?? primary);
      if (colour !== null && !COLOURS.includes(colour)) continue;
      raw.push({ from, to, colour });
      prevEnd = to;
    }
    const onBearing = remarks.match(new RegExp(String.raw`[Vv]isible on (?:range line|bearing) ${ANGLE}`));
    if (!raw.length && onBearing) {
      const b = deg(onBearing[1], onBearing[2]);
      raw.push({ from: (b + 359) % 360, to: (b + 1) % 360, colour: primary });
    }
  } else {
    for (const m of remarks.matchAll(USCG)) {
      const w = USCG_WORD[m[1].toLowerCase()];
      const colour = w === 'visible' ? primary : (w ?? null);
      raw.push({ from: deg(m[2], m[3]), to: deg(m[4], m[5]), colour });
      if (m[6] !== undefined) raw.push({ from: deg(m[6], m[7]), to: deg(m[8], m[9]), colour });
    }
  }
  if (!raw.length) return null;

  // Obscured arcs listed alone ("Obscured 066°-089°") cut a light that is
  // otherwise shown all round.
  const shown = raw.filter((s) => s.colour !== null);
  const hidden = raw.filter((s) => s.colour === null);
  if (!shown.length) {
    const cuts = hidden.map((s) => [s.from, span(s.from, s.to)] as const).sort((a, b) => a[0] - b[0]);
    const out: Sector[] = [];
    for (let i = 0; i < cuts.length; i++) {
      const end = (cuts[i][0] + cuts[i][1]) % 360;
      const next = cuts[(i + 1) % cuts.length][0];
      if (span(end, next) > 0.1 && !(cuts.length === 1 && cuts[0][1] >= 359.9))
        out.push({ from: end, to: next, colour: primary });
    }
    return out.length ? out : null;
  }
  return shown.filter((s) => span(s.from, s.to) > 0.01);
}

/** Clockwise arc length from a to b, in degrees. */
export function span(a: number, b: number): number {
  const d = (b - a + 360) % 360;
  return d === 0 ? 360 : d;
}

/** The sector containing a bearing from the vessel, or undefined when obscured. */
export function sectorAt(sectors: readonly Sector[], bearing: number): Sector | undefined {
  for (const s of sectors) if ((bearing - s.from + 360) % 360 <= span(s.from, s.to)) return s;
  return undefined;
}

/** Nominal range in miles for each colour: "W. 14 ; R. 11", or one figure for all. */
export function parseRanges(range: string, colours: readonly Colour[]): Partial<Record<Colour, number>> {
  const out: Partial<Record<Colour, number>> = {};
  const per = [...range.matchAll(/\b(W|R|G|Y|Bu|Vi|Or)\.?\s*([\d.]+)/g)];
  for (const m of per) out[m[1] as Colour] = parseFloat(m[2]);
  if (!colours.some((c) => out[c] !== undefined)) {
    // One figure for every colour, or ranges by class ("F. 6 ; Fl. 12"): take the longest.
    const all = [...range.matchAll(/[\d.]+/g)].map((m) => parseFloat(m[0])).filter(Number.isFinite);
    if (all.length) for (const c of colours) out[c] = Math.max(...all);
  }
  return out;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS_BEFORE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Day of the year (1 to 365) from a month name and day. */
const doy = (month: string, day: string) => DAYS_BEFORE[MONTHS.indexOf(month.slice(0, 3).toLowerCase())] + Number(day);

/**
 * The part of the year a seasonal light is shown, as day-of-year bounds:
 * NGA "Shown Aug. 4 to May 2.", USCG "Maintained from 15 April to 15 November".
 */
export function parseSeason(remarks: string): [number, number] | null {
  const m = remarks.match(/\bShown (\w{3})\w*\.? (\d{1,2}) to (\w{3})\w*\.? (\d{1,2})/);
  if (m && MONTHS.includes(m[1].toLowerCase()) && MONTHS.includes(m[3].toLowerCase()))
    return [doy(m[1], m[2]), doy(m[3], m[4])];
  const u = remarks.match(/\b(?:Maintained|Lighted|Shown) from (\d{1,2}) (\w+) to (\d{1,2}) (\w+)/);
  if (u && MONTHS.includes(u[2].slice(0, 3).toLowerCase()) && MONTHS.includes(u[4].slice(0, 3).toLowerCase()))
    return [doy(u[2], u[1]), doy(u[4], u[3])];
  return null;
}
