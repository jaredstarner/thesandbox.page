// The print sheet: the dial at true size in black ink, a gnomon to cut out,
// setting-up steps, and the equation of time, so a printout makes a working dial.

import { R, type Dial } from './_dial';
import { dms, face } from './_draw';
import { RAD, season } from './_sun';
import { zoneLabel } from './_zones';

/** Millimetres per plate unit on paper: the slate's rim prints 150 mm across. */
export const MM = 150 / (2 * R.plate);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function inkFace(dial: Dial, motto: string, year: number, id: string): string {
  const footY = -dial.top.n * dial.k;
  const w = dial.width;
  return (
    `<circle r="${R.plate}" fill="none" stroke="#000" stroke-width="0.35"/>` +
    `<g fill="#000" stroke="#000" class="ink">${face(dial, { motto, year, id, print: true })}</g>` +
    // Where the gnomon stands, and the root it stands on.
    `<rect x="${-w / 2}" y="${footY}" width="${w}" height="${-footY}" fill="none" stroke="#000" stroke-width="0.25" stroke-dasharray="0.8 0.6"/>` +
    `<path d="M-2.4 0H2.4M0 -2.4V2.4" stroke="#000" stroke-width="0.25"/>`
  );
}

/** A standalone SVG of the dial face at true size, for a printer, a cutter, or an engraver. */
export function svgFile(dial: Dial, motto: string, year: number): string {
  const size = (2 * R.plate * MM).toFixed(1);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}mm" height="${size}mm" viewBox="${-R.plate - 2} ${-R.plate - 2} ${2 * R.plate + 4} ${2 * R.plate + 4}">` +
    `<style>text{font-family:Marcellus,'Trajan Pro',Georgia,serif}</style>` +
    inkFace(dial, motto, year, 'svg') +
    `</svg>\n`
  );
}

function gnomonTemplate(dial: Dial): string {
  const phi = Math.abs(dial.place.lat) * RAD;
  const base = dial.L * Math.cos(phi) * MM;
  const height = dial.L * Math.sin(phi) * MM;
  // The nodus: a notch in the sloping edge, whose shadow marks the date lines.
  const nx = dial.s * Math.cos(phi) * MM;
  const ny = dial.s * Math.sin(phi) * MM;
  const tab = 7;
  const pad = 4;
  const left = 24;
  const wv = Math.max(left + base + pad + 6, 66);
  const hv = height + tab + 2 * pad + 6;
  const x0 = left;
  const y0 = pad + height + 4;
  const arc = Math.min(base * 0.45, 9);
  const deg = Math.abs(dial.place.lat).toFixed(1);
  return `<svg class="gnomon-cut" width="${wv.toFixed(1)}mm" height="${hv.toFixed(1)}mm" viewBox="0 0 ${wv.toFixed(2)} ${hv.toFixed(2)}" aria-label="Gnomon template">
    <path d="M${x0} ${y0}L${x0 + base} ${y0}L${x0 + base} ${y0 - height}Z" fill="none" stroke="#000" stroke-width="0.3"/>
    <path d="M${x0} ${y0}L${x0 + base} ${y0}L${x0 + base - 1.5} ${y0 + tab}L${x0 + 1.5} ${y0 + tab}Z" fill="none" stroke="#000" stroke-width="0.25" stroke-dasharray="1 0.8"/>
    <path d="M${x0 + arc} ${y0}A${arc} ${arc} 0 0 0 ${x0 + arc * Math.cos(phi)} ${y0 - arc * Math.sin(phi)}" fill="none" stroke="#000" stroke-width="0.2"/>
    <text x="${x0 + arc + 1}" y="${y0 - 1.2}" font-size="2.6">${deg}°</text>
    <circle cx="${(x0 + nx).toFixed(2)}" cy="${(y0 - ny).toFixed(2)}" r="0.9" fill="none" stroke="#000" stroke-width="0.25"/>
    <text x="${(x0 + nx - 1.5).toFixed(2)}" y="${(y0 - ny - 2).toFixed(2)}" font-size="2.2" text-anchor="end">nodus: cut a small notch</text>
    <text x="${x0}" y="${y0 + tab + 3.2}" font-size="2.2">root end · fold the tab along the dashes</text>
  </svg>`;
}

function eotTable(year: number): string {
  let rows = '';
  for (let m = 0; m < 12; m++) {
    const cells = [1, 15]
      .map((d) => {
        const e = Math.round(season(Date.UTC(year, m, d, 12)).eot);
        const word = e === 0 ? 'right' : e > 0 ? `fast ${e}` : `slow ${-e}`;
        return `<td>${d} ${MONTHS[m]}</td><td>${word}</td>`;
      })
      .join('');
    rows += `<tr>${cells}</tr>`;
  }
  return `<table class="eot"><caption>The dial runs fast or slow by (minutes)</caption>${rows}</table>`;
}

export interface SheetInfo {
  /** Clock time of the sun's crossing of the meridian on the chosen day, already formatted. */
  noon: string;
  dayLabel: string;
  zoneName: string | null;
}

export function sheet(dial: Dial, motto: string, year: number, info: SheetInfo): string {
  const p = dial.place;
  const where = `${dms(p.lat, 'N', 'S')}, ${dms(p.lon, 'E', 'W')}`;
  const pole = dial.k > 0 ? 'north' : 'south';
  const size = (2 * R.plate * MM).toFixed(0);
  const zone = `${zoneLabel(p)}${info.zoneName ? ` (${info.zoneName})` : ''}`;
  return `
  <header class="sheet-head">
    <h2>A horizontal sundial for ${p.name || where}</h2>
    <p>${p.name ? `${where} · ` : ''}hour lines set for clocks on ${zone}</p>
  </header>
  <svg class="sheet-dial" width="${size}mm" height="${size}mm" viewBox="${-R.plate - 1} ${-R.plate - 1} ${2 * R.plate + 2} ${2 * R.plate + 2}" role="img" aria-label="The dial face at true size">${inkFace(dial, motto, year, 'print')}</svg>
  <div class="sheet-foot">
    <div class="sheet-make">
      ${gnomonTemplate(dial)}
      <ol>
        <li>Print at 100%, not fit to page; the bar below should measure 50 mm.</li>
        <li>Glue the dial to something flat and stiff. Cut out the gnomon, notch its sloping edge at the circle, fold its tab, and glue it on the dashed outline: its root on the cross, its sloping edge rising toward the ${pole} rim.</li>
        <li>Set the board level and turn it until the gnomon points to true ${pole}, not magnetic ${pole}. On ${info.dayLabel} the shadow of an upright stick lies on the true north-south line at ${info.noon} by your clocks.</li>
        <li>The shadow of the sloping edge gives the hour; the shadow of the notch runs along the date lines. Correct the hour by the table, and add an hour in summer time.</li>
      </ol>
      <p class="bar"><span></span> 50 mm</p>
    </div>
    ${eotTable(year)}
  </div>`;
}
