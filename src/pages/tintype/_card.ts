// The studio's colour chart: six coloured patches and a grey scale on a
// card, for sitting a plate without a camera. Collodion turns the reds black
// and the blues white, and the plate prints the lettering back to front.

const PATCHES: [string, string][] = [
  ['Red', '#c62a25'],
  ['Orange', '#e57c21'],
  ['Yellow', '#ecd236'],
  ['Green', '#3b9548'],
  ['Blue', '#2b5cc8'],
  ['Violet', '#6d45b3'],
];

export function drawChart(family: string): HTMLCanvasElement {
  const w = 800;
  const h = 1000;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;

  const back = g.createRadialGradient(w * 0.45, h * 0.4, 80, w * 0.5, h * 0.5, h * 0.75);
  back.addColorStop(0, '#9b978f');
  back.addColorStop(1, '#5f5c57');
  g.fillStyle = back;
  g.fillRect(0, 0, w, h);

  // The card, pinned slightly askew on the backdrop.
  g.save();
  g.translate(w / 2, h / 2 + 10);
  g.rotate(-0.025);
  const cw = 660;
  const ch = 860;
  g.shadowColor = 'rgb(0 0 0 / 0.35)';
  g.shadowBlur = 24;
  g.shadowOffsetY = 8;
  g.fillStyle = '#e9e5db';
  g.fillRect(-cw / 2, -ch / 2, cw, ch);
  g.shadowColor = 'transparent';
  g.translate(-cw / 2, -ch / 2);

  g.fillStyle = '#1e1c19';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = `italic 600 64px ${family}`;
  g.fillText('Colour test', cw / 2, 110);

  const pw = 180;
  const ph = 150;
  const gap = 30;
  const left = (cw - pw * 3 - gap * 2) / 2;
  PATCHES.forEach(([name, colour], n) => {
    const x = left + (n % 3) * (pw + gap);
    const y = 176 + Math.floor(n / 3) * (ph + 66);
    g.fillStyle = colour;
    g.fillRect(x, y, pw, ph);
    g.fillStyle = '#1e1c19';
    g.font = `500 24px ${family}`;
    g.fillText(name, x + pw / 2, y + ph + 34);
  });

  // A grey scale, white to black.
  const steps = 8;
  const sw = (cw - 80) / steps;
  for (let i = 0; i < steps; i++) {
    const v = Math.round(242 - (i * (242 - 22)) / (steps - 1));
    g.fillStyle = `rgb(${v} ${v - 2} ${v - 6})`;
    g.fillRect(40 + i * sw, 640, sw, 110);
  }
  g.strokeStyle = '#1e1c19';
  g.lineWidth = 1.5;
  g.strokeRect(40, 640, cw - 80, 110);
  g.font = `500 20px ${family}`;
  g.fillStyle = '#1e1c19';
  for (let i = 0; i < steps; i++) g.fillText(String(i + 1), 40 + (i + 0.5) * sw, 784);
  g.font = `italic 500 22px ${family}`;
  g.fillText('thesandbox.page studio', cw / 2, 832);
  g.restore();
  return c;
}
