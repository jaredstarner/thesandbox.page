// The stamp sheet on the writing desk. Three cover a letter; the penny stamp
// does not, and the item notices.

export interface Stamp {
  id: string;
  label: string;
  /** True when the stamp alone pays for a letter. */
  sufficient: boolean;
  svg: string;
}

const W = 50;
const H = 60;

// White stamp paper with perforation holes punched along every edge.
function perforated(inner: string): string {
  const holes: string[] = [];
  const r = 2.1;
  for (let x = 3; x <= W - 2; x += 5.5) holes.push(`<circle cx="${x}" cy="0" r="${r}"/><circle cx="${x}" cy="${H}" r="${r}"/>`);
  for (let y = 3; y <= H - 2; y += 5.5) holes.push(`<circle cx="0" cy="${y}" r="${r}"/><circle cx="${W}" cy="${y}" r="${r}"/>`);
  return (
    `<svg viewBox="-1 -1 ${W + 2} ${H + 2}" aria-hidden="true">` +
    `<rect width="${W}" height="${H}" fill="#fbf7ee"/>` +
    inner +
    `<g fill="#fdfbf4">${holes.join('')}</g>` +
    `</svg>`
  );
}

const value = (text: string, fill: string) =>
  `<text x="25" y="52" text-anchor="middle" font-family="Courier New, monospace" font-size="6" letter-spacing="0.6" fill="${fill}">${text}</text>`;

export const STAMPS: Stamp[] = [
  {
    id: 'flag',
    label: 'Forever stamp: a red mailbox flag on blue',
    sufficient: true,
    svg: perforated(
      `<rect x="5" y="5" width="40" height="50" fill="#2f4f7f"/>` +
        `<rect x="14" y="14" width="3" height="30" fill="#e9e2d0"/>` +
        `<path d="M17 14 H35 V26 H17 Z" fill="#d42a20"/>` +
        `<circle cx="15.5" cy="44" r="2.5" fill="#e9e2d0"/>` +
        value('FOREVER', '#e9e2d0'),
    ),
  },
  {
    id: 'crow',
    label: 'Forever stamp: a crow on a wire',
    sufficient: true,
    svg: perforated(
      `<rect x="5" y="5" width="40" height="50" fill="#efe3c6"/>` +
        `<path d="M5 33 Q25 37 45 32" stroke="#2a2520" stroke-width="0.8" fill="none"/>` +
        `<path d="M14 30 C15 24 21 20 27 21 L31 18 L33 19 L30 22 C33 24 34 28 32 31 L38 34 L31 33 C27 35 20 34 17 32 Z" fill="#1b1a19"/>` +
        `<circle cx="29.5" cy="21" r="0.7" fill="#efe3c6"/>` +
        value('FOREVER', '#2a2520'),
    ),
  },
  {
    id: 'tunnel',
    label: 'Forever stamp: the 1915 tunnel mailbox',
    sufficient: true,
    svg: perforated(
      `<rect x="5" y="5" width="40" height="50" fill="#3e6b4a"/>` +
        `<path d="M13 38 V24 A9 9 0 0 1 31 24 V38 Z" fill="#e9e2d0"/>` +
        `<path d="M31 36 L37 35 V22 L31 23" fill="#c9c1ac"/>` +
        `<rect x="20" y="38" width="4" height="8" fill="#e9e2d0"/>` +
        `<text x="25" y="13" text-anchor="middle" font-family="Courier New, monospace" font-size="5.5" fill="#e9e2d0">1915</text>` +
        value('FOREVER', '#e9e2d0'),
    ),
  },
  {
    id: 'penny',
    label: 'One-cent stamp, old stock',
    sufficient: false,
    svg: perforated(
      `<rect x="5" y="5" width="40" height="50" fill="#a8742c"/>` +
        `<ellipse cx="25" cy="25" rx="12" ry="14" fill="none" stroke="#f3e2bd" stroke-width="1.2"/>` +
        `<text x="25" y="31" text-anchor="middle" font-family="Georgia, serif" font-size="16" fill="#f3e2bd">1¢</text>` +
        value('ONE CENT', '#f3e2bd'),
    ),
  },
];

export const stampById = (id: string | null | undefined): Stamp | undefined => STAMPS.find((s) => s.id === id);
