// The chart: every cell drawn as four wedges, one per way you can face there.
// Each wedge is a link to that view, painted paper-white and blended with
// multiply, so it vanishes on the sheet until the browser marks the link
// visited and :visited inks it in. The walls ride along in the same link, so
// a cell's walls appear once you have stood there. Nothing is stored: the
// chart is your history.

import { BACK, DIRS, SIZE, plan, type Dir } from './_maze';

export const CELL = 20;
const half = CELL / 2;

function wedge(x: number, y: number, d: Dir) {
  const x0 = x * CELL;
  const y0 = y * CELL;
  switch (d) {
    case 'n':
      return `M${x0} ${y0}h${CELL}l-${half} ${half}z`;
    case 'e':
      return `M${x0 + CELL} ${y0}v${CELL}l-${half}-${half}z`;
    case 's':
      return `M${x0} ${y0 + CELL}h${CELL}l-${half}-${half}z`;
    case 'w':
      return `M${x0} ${y0}v${CELL}l${half}-${half}z`;
  }
}

function wall(x: number, y: number, d: Dir) {
  const x0 = x * CELL;
  const y0 = y * CELL;
  switch (d) {
    case 'n':
      return `M${x0} ${y0}h${CELL}`;
    case 'e':
      return `M${x0 + CELL} ${y0}v${CELL}`;
    case 's':
      return `M${x0} ${y0 + CELL}h${CELL}`;
    case 'w':
      return `M${x0} ${y0}v${CELL}`;
  }
}

/** The chart as SVG. `base` is the path from the page to the undercroft's folder, such as "../". */
export function chart(base: string) {
  const links: string[] = [];
  for (const c of plan.cells) {
    for (const d of DIRS) {
      // Facing one way you see the walls ahead and to either side, not the one behind you.
      const walls = DIRS.filter((k) => k !== BACK[d] && !c.open[k])
        .map((k) => wall(c.x, c.y, k))
        .join('');
      links.push(
        `<a href="${base}${c.id}/#${d}"><path d="${wedge(c.x, c.y, d)}"/>${walls ? `<path class="w" d="${walls}"/>` : ''}</a>`,
      );
    }
  }
  const span = SIZE * CELL;
  const ticks: string[] = [];
  for (let i = 1; i < SIZE; i++) ticks.push(`M${i * CELL} 0v${span}M0 ${i * CELL}h${span}`);
  const cols = [...'abcdefghijkl']
    .map((ch, i) => `<text x="${i * CELL + half}" y="-5">${ch.toUpperCase()}</text>`)
    .join('');
  const rows = Array.from({ length: SIZE }, (_, i) => `<text x="-5" y="${i * CELL + half + 3}" text-anchor="end">${i + 1}</text>`).join('');
  const start = plan.start;
  return (
    `<svg class="chart" viewBox="-18 -16 ${span + 24} ${span + 22}" role="img" aria-label="Your chart of the undercroft, inked from the places you have stood">` +
    `<path class="grid" d="${ticks.join('')}"/>` +
    `<g class="cells">${links.join('')}</g>` +
    `<rect class="edge" width="${span}" height="${span}"/>` +
    // The stair you came down by is the one mark the chart starts with.
    `<path class="stair" d="M${start.x * CELL + 4} 1.5h12M${start.x * CELL + 5} -1.5h10M${start.x * CELL + 6} -4.5h8"/>` +
    `<g class="labels">${cols}${rows}</g>` +
    `<path class="here" d="M0 -6.5l4.6 9.5-4.6-2.6-4.6 2.6z" data-here/>` +
    `</svg>`
  );
}
