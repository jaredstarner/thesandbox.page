// A small 2D canvas of things that hang on the walls: the sampler, a landscape, a clock face, a chart, and the
// letters over the doors. The lettering is what shows the Reversing Room reversing.

export interface Decals {
  canvas: HTMLCanvasElement;
  /** Each cell's (u, v, width, height) in the atlas, measured from the bottom left. */
  cells: Record<'sampler' | 'landscape' | 'clock' | 'chart', [number, number, number, number]>;
  letters: [number, number, number, number][];
}

const SIZE = 1024;
const INK = '#2b2622';

function frame(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wood: string) {
  g.fillStyle = wood;
  g.fillRect(x, y, w, h);
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  g.strokeRect(x + 15, y + 15, w - 30, h - 30);
}

function sampler(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  frame(g, x, y, w, h, '#6a4527');
  g.fillStyle = '#efe6cf';
  g.fillRect(x + 16, y + 16, w - 32, h - 32);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#8c3a2b';
  g.font = `800 ${Math.round(h * 0.2)}px "Besley", Georgia, serif`;
  g.fillText('HOME', x + w / 2, y + h * 0.3);
  g.fillStyle = '#2d4c70';
  g.font = `800 ${Math.round(h * 0.15)}px "Besley", Georgia, serif`;
  g.fillText('SWEET', x + w / 2, y + h * 0.5);
  g.fillStyle = '#8c3a2b';
  g.font = `800 ${Math.round(h * 0.2)}px "Besley", Georgia, serif`;
  g.fillText('HOME', x + w / 2, y + h * 0.7);
  // A stitched border, and an unbalanced flourish so the picture has a handedness of its own.
  g.strokeStyle = '#6d7a35';
  g.lineWidth = 5;
  g.setLineDash([9, 7]);
  g.strokeRect(x + 34, y + 34, w - 68, h - 68);
  g.setLineDash([]);
  g.fillStyle = '#c58a26';
  g.beginPath();
  g.arc(x + 62, y + 62, 13, 0, 7);
  g.fill();
}

function landscape(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  frame(g, x, y, w, h, '#b58d3e');
  const ix = x + 16;
  const iy = y + 16;
  const iw = w - 32;
  const ih = h - 32;
  g.save();
  g.beginPath();
  g.rect(ix, iy, iw, ih);
  g.clip();
  g.fillStyle = '#d6dfd8';
  g.fillRect(ix, iy, iw, ih);
  g.fillStyle = '#a9b98c';
  g.beginPath();
  g.moveTo(ix, iy + ih * 0.6);
  g.bezierCurveTo(ix + iw * 0.3, iy + ih * 0.38, ix + iw * 0.5, iy + ih * 0.68, ix + iw, iy + ih * 0.46);
  g.lineTo(ix + iw, iy + ih);
  g.lineTo(ix, iy + ih);
  g.fill();
  g.fillStyle = '#7f9462';
  g.beginPath();
  g.moveTo(ix, iy + ih * 0.8);
  g.bezierCurveTo(ix + iw * 0.4, iy + ih * 0.62, ix + iw * 0.7, iy + ih * 0.9, ix + iw, iy + ih * 0.7);
  g.lineTo(ix + iw, iy + ih);
  g.lineTo(ix, iy + ih);
  g.fill();
  // A house, alone on the hill.
  g.fillStyle = '#efe6cf';
  g.fillRect(ix + iw * 0.3, iy + ih * 0.42, iw * 0.09, ih * 0.1);
  g.fillStyle = '#8c3a2b';
  g.beginPath();
  g.moveTo(ix + iw * 0.285, iy + ih * 0.42);
  g.lineTo(ix + iw * 0.345, iy + ih * 0.34);
  g.lineTo(ix + iw * 0.405, iy + ih * 0.42);
  g.fill();
  g.restore();
}

function clock(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const cx = x + s / 2;
  const cy = y + s / 2;
  const r = s / 2 - 4;
  g.fillStyle = '#6a4527';
  g.beginPath();
  g.arc(cx, cy, r, 0, 7);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#f4eedf';
  g.beginPath();
  g.arc(cx, cy, r * 0.87, 0, 7);
  g.fill();
  g.stroke();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(s * 0.085)}px "Besley", Georgia, serif`;
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillText(String(i), cx + Math.sin(a) * r * 0.7, cy - Math.cos(a) * r * 0.7);
  }
}

function chart(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  frame(g, x, y, w, h, '#3a3f4a');
  g.fillStyle = '#efe6cf';
  g.fillRect(x + 16, y + 16, w - 32, h - 32);
  g.fillStyle = INK;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.font = `700 ${Math.round(h * 0.11)}px "Besley", Georgia, serif`;
  g.fillText('ABCDEFG', x + 44, y + h * 0.34);
  g.font = `${Math.round(h * 0.1)}px "Besley", Georgia, serif`;
  g.fillText('hijklmn', x + 44, y + h * 0.52);
  g.fillText('opqrstu', x + 44, y + h * 0.68);
  g.font = `700 ${Math.round(h * 0.09)}px "Besley", Georgia, serif`;
  g.fillStyle = '#8c3a2b';
  g.fillText('1 2 3 4', x + 44, y + h * 0.84);
}

export function buildDecals(): Decals {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  g.clearRect(0, 0, SIZE, SIZE);

  sampler(g, 0, 0, 512, 354);
  landscape(g, 512, 0, 512, 384);
  clock(g, 0, 512, 360);
  chart(g, 512, 512, 512, 384);

  // Numbers, not letters: an A looks the same in a mirror.
  const LETTERS = ['1', '2', '3', '4'];
  const letters: [number, number, number, number][] = [];
  LETTERS.forEach((l, i) => {
    const x = 368 + i * 34;
    const y = 400;
    const s = 34;
    g.fillStyle = '#f4eedf';
    g.font = `800 ${Math.round(s * 0.74)}px "Besley", Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(l, x + s / 2, y + s / 2 + 1);
    letters.push([x / SIZE, 1 - (y + s) / SIZE, s / SIZE, s / SIZE]);
  });

  const cell = (x: number, y: number, w: number, h: number): [number, number, number, number] => [
    x / SIZE,
    1 - (y + h) / SIZE,
    w / SIZE,
    h / SIZE,
  ];
  return {
    canvas,
    cells: {
      sampler: cell(0, 0, 512, 354),
      landscape: cell(512, 0, 512, 384),
      clock: cell(0, 512, 360, 360),
      chart: cell(512, 512, 512, 384),
    },
    letters,
  };
}
