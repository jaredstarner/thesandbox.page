// The dial face as SVG markup, for the screen (one colour, lit by a filter) and
// for print (black ink at true size). Plate units: radius 100 around the root,
// y up; points are flipped to SVG's y-down as they are written.

import { R, roman, type Dial, type Pt } from './_dial';

const f = (v: number) => (Math.round(v * 100) / 100).toString();
const at = (r: number, angle: number): Pt => {
  const a = (angle * Math.PI) / 180;
  return [r * Math.sin(a), r * Math.cos(a)];
};
const xy = ([x, y]: Pt) => `${f(x)} ${f(-y)}`;

export function pathOf(seg: Pt[], close = false): string {
  return 'M' + seg.map(xy).join('L') + (close ? 'Z' : '');
}

export function dms(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  let d = Math.floor(a);
  let m = Math.round((a - d) * 60);
  if (m === 60) {
    d += 1;
    m = 0;
  }
  return `${d}°${String(m).padStart(2, '0')}′ ${v < 0 ? neg : pos}`;
}

export function yearNumeral(y: number): string {
  const table: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [n, s] of table) {
    while (y >= n) {
      out += s;
      y -= n;
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface FaceOptions {
  motto: string;
  year: number;
  /** Prefix for ids, so two faces can share a document. */
  id: string;
  /** Line weights for ink on paper rather than cuts in stone. */
  print?: boolean;
}

/** The engraved face: everything cut into the plate. */
export function face(dial: Dial, o: FaceOptions): string {
  const w = o.print ? { hour: 0.45, ring: 0.4, tick: 0.3, major: 0.35, minor: 0.22, ana: 0.25 } : { hour: 0.8, ring: 0.7, tick: 0.5, major: 0.6, minor: 0.38, ana: 0.42 };
  const out: string[] = [];
  const r0 = R.boss + 1.4;

  // Chapter ring and border.
  out.push(`<circle r="${R.ringOut}" fill="none" stroke-width="${w.ring}"/>`);
  out.push(`<circle r="${R.ringIn}" fill="none" stroke-width="${w.ring * 0.7}"/>`);
  out.push(`<circle r="${R.numerals + 6.6}" fill="none" stroke-width="${w.ring}"/>`);
  out.push(`<circle r="${R.numerals + 8.1}" fill="none" stroke-width="${w.ring * 0.6}"/>`);

  // Hour lines, then the ten-minute and half-hour ticks.
  let lines = '';
  for (const h of dial.hours) lines += `M${xy(at(r0, h.angle))}L${xy(at(h.r1, h.angle))}`;
  // Lines go in a group the date labels knock out of, so the labels read clear.
  const lined: string[] = [];
  const tags: string[] = [];
  const knock: string[] = [];
  lined.push(`<path d="${lines}" fill="none" stroke-width="${w.hour}" stroke-linecap="round"/>`);
  let ticks = '';
  let halves = '';
  for (const t of dial.ticks) {
    if (t.half) halves += `M${xy(at(R.half, t.angle))}L${xy(at(R.ringOut, t.angle))}`;
    else ticks += `M${xy(at(R.ringIn, t.angle))}L${xy(at(R.ringOut, t.angle))}`;
  }
  out.push(`<path d="${halves}" fill="none" stroke-width="${w.tick}"/>`);
  out.push(`<path d="${ticks}" fill="none" stroke-width="${w.tick * 0.8}"/>`);

  // Numerals, set on the radius and turned so none reads upside down.
  for (const h of dial.hours) {
    const [x, y] = at(R.numerals, h.angle);
    const a = ((h.angle % 360) + 360) % 360;
    const turn = a > 95 && a < 265 ? h.angle + 180 : h.angle;
    out.push(
      `<text class="num" font-size="8.2" x="${f(x)}" y="${f(-y)}" transform="rotate(${f(turn)} ${f(x)} ${f(-y)})" text-anchor="middle" dominant-baseline="central" stroke="none">${roman(h.t)}</text>`,
    );
  }

  // Date lines: where the tip of the shadow runs on the solstices, the equinoxes, and the signs between.
  for (const c of dial.curves) {
    const d = c.segs.map((s) => pathOf(s)).join('');
    if (!d) continue;
    lined.push(`<path d="${d}" fill="none" stroke-width="${c.major ? w.major : w.minor}" stroke-linejoin="round"/>`);
    if (c.label) {
      // Label beside the gnomon, where the line crosses noon.
      let best: Pt | null = null;
      for (const s of c.segs) for (const p of s) if (!best || Math.abs(p[0]) < Math.abs(best[0])) best = p;
      if (best && Math.abs(best[0]) < 4) {
        const y = -best[1] - 1;
        const width = c.label.length * 2.55 + 1.2;
        tags.push(
          `<text class="tag" font-size="3.1" letter-spacing="0.3" x="${f(-3.2)}" y="${f(y)}" text-anchor="end" stroke="none">${c.label}</text>`,
        );
        knock.push(`<rect x="${f(-3.2 - width)}" y="${f(y - 3)}" width="${f(width + 0.9)}" height="4" rx="0.6"/>`);
      }
    }
  }

  // The figure eight of clock noon.
  if (dial.analemma.length) {
    lined.push(
      `<path d="${dial.analemma.map((s) => pathOf(s)).join('')}" fill="none" stroke-width="${w.ana}" stroke-dasharray="${o.print ? '0.9 0.7' : '1.4 1'}"/>`,
    );
  }
  out.push(
    `<mask id="${o.id}-knock" maskUnits="userSpaceOnUse" x="-100" y="-100" width="200" height="200"><rect x="-100" y="-100" width="200" height="200" fill="#fff" stroke="none"/><g fill="#000" stroke="none">${knock.join('')}</g></mask>`,
    `<g mask="url(#${o.id}-knock)">${lined.join('')}</g>`,
    ...tags,
  );

  // Motto and place along the foot of the plate, and the year under the root.
  const arc = (r: number, id: string) => {
    const span = 50;
    const [x1, y1] = at(r, 180 + span);
    const [x2, y2] = at(r, 180 - span);
    return `<path id="${id}" d="M${f(x1)} ${f(-y1)}A${r} ${r} 0 0 0 ${f(x2)} ${f(-y2)}" fill="none" stroke="none"/>`;
  };
  const coords = `${dms(dial.place.lat, 'N', 'S')} · ${dms(dial.place.lon, 'E', 'W')}`;
  const place = dial.place.name ? `${dial.place.name.toUpperCase()} · ${coords}` : coords;
  out.push(`<defs>${arc(63.2, `${o.id}-motto`)}${arc(55.4, `${o.id}-place`)}</defs>`);
  if (o.motto) {
    out.push(
      `<text class="motto" font-size="4.9" letter-spacing="0.8" stroke="none"><textPath href="#${o.id}-motto" startOffset="50%" text-anchor="middle">${esc(o.motto.toUpperCase())}</textPath></text>`,
    );
  }
  out.push(
    `<text class="place" font-size="3.1" letter-spacing="0.5" stroke="none"><textPath href="#${o.id}-place" startOffset="50%" text-anchor="middle">${esc(place)}</textPath></text>`,
  );
  out.push(`<text class="year" font-size="3.4" letter-spacing="0.6" x="0" y="11.5" text-anchor="middle" stroke="none">${yearNumeral(o.year)}</text>`);

  return out.join('');
}
