// The colours on the bench. Index -1 is gall water: a clear drop that pushes
// colour aside and prints as bare paper.

export interface Pigment {
  id: string;
  name: string;
  hex: string;
}

export const PIGMENTS: Pigment[] = [
  { id: 'black', name: 'Lamp black', hex: '#25211e' },
  { id: 'indigo', name: 'Indigo', hex: '#283c66' },
  { id: 'prussian', name: 'Prussian blue', hex: '#1b5b78' },
  { id: 'rose', name: 'Rose madder', hex: '#b9485a' },
  { id: 'venetian', name: 'Venetian red', hex: '#93391f' },
  { id: 'ochre', name: 'Yellow ochre', hex: '#cf9b38' },
  { id: 'sap', name: 'Sap green', hex: '#55713a' },
  { id: 'chalk', name: 'Chalk white', hex: '#f3eee3' },
];

export const GALL = -1;

/** The size in the trough, and the paper a print is pulled on. */
export const SIZE_HEX = '#cdcdc3';
export const PAPER_HEX = '#f1eadb';

export const pigmentIndex = (id: string): number => {
  if (id === 'gall') return GALL;
  const i = PIGMENTS.findIndex((p) => p.id === id);
  return i < 0 ? 0 : i;
};

/** A darker, translucent version of a colour, for the thin rim where two films meet. */
export function rimOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const k = 0.62;
  return `rgba(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)}, 0.42)`;
}
