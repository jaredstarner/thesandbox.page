// A salt maze for the plate: a recursive-backtracker maze in the square
// inside the dish, with a few extra walls knocked out so some routes loop and
// one is shortest, drawn as salt walls, with an oat in two far corners.

import type { Food } from './_plate';

export interface Maze {
  walls: Uint32Array;
  oats: Food[];
  /** True where an agent may start: inside the maze's corridors. */
  open: (x: number, y: number) => boolean;
  bounds: { x0: number; y0: number; side: number };
  cells: number;
  pitch: number;
  /** Open passages between cells, as cell index pairs (row-major). */
  links: [number, number][];
  /** The cells holding the two oats. */
  ends: [number, number];
}

export function buildMaze(size: number, dishRadius: number, cells = 9, loops = 7): Maze {
  const side = Math.floor(dishRadius * Math.SQRT2 * 0.94);
  const x0 = Math.floor(size / 2 - side / 2);
  const y0 = x0;
  const pitch = side / cells;
  const thick = Math.max(6, Math.round(pitch * 0.14));

  // Carve: each cell starts with all four walls; knock down walls along a random walk.
  const east = new Uint8Array(cells * cells).fill(1);
  const south = new Uint8Array(cells * cells).fill(1);
  const seen = new Uint8Array(cells * cells);
  const stack = [0];
  seen[0] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1]!;
    const cx = c % cells;
    const cy = Math.floor(c / cells);
    const next: number[] = [];
    if (cx > 0 && !seen[c - 1]) next.push(c - 1);
    if (cx < cells - 1 && !seen[c + 1]) next.push(c + 1);
    if (cy > 0 && !seen[c - cells]) next.push(c - cells);
    if (cy < cells - 1 && !seen[c + cells]) next.push(c + cells);
    if (!next.length) {
      stack.pop();
      continue;
    }
    const n = next[Math.floor(Math.random() * next.length)]!;
    if (n === c + 1) east[c] = 0;
    else if (n === c - 1) east[n] = 0;
    else if (n === c + cells) south[c] = 0;
    else south[n] = 0;
    seen[n] = 1;
    stack.push(n);
  }

  // Knock out a few more walls so the maze has loops, and so routes of different lengths.
  for (let k = 0, tries = 0; k < loops && tries < 500; tries++) {
    const c = Math.floor(Math.random() * cells * cells);
    const cx = c % cells;
    const cy = Math.floor(c / cells);
    if (Math.random() < 0.5) {
      if (cx < cells - 1 && east[c]) {
        east[c] = 0;
        k++;
      }
    } else if (cy < cells - 1 && south[c]) {
      south[c] = 0;
      k++;
    }
  }

  const links: [number, number][] = [];
  for (let c = 0; c < cells * cells; c++) {
    if (c % cells < cells - 1 && !east[c]) links.push([c, c + 1]);
    if (Math.floor(c / cells) < cells - 1 && !south[c]) links.push([c, c + cells]);
  }

  const walls = new Uint32Array(size * size);
  const rect = (ax: number, ay: number, bx: number, by: number) => {
    const xa = Math.max(0, Math.floor(Math.min(ax, bx)));
    const xb = Math.min(size - 1, Math.ceil(Math.max(ax, bx)));
    const ya = Math.max(0, Math.floor(Math.min(ay, by)));
    const yb = Math.min(size - 1, Math.ceil(Math.max(ay, by)));
    for (let y = ya; y <= yb; y++) walls.fill(1, y * size + xa, y * size + xb + 1);
  };
  const h = thick / 2;
  // The outer frame.
  rect(x0 - h, y0 - h, x0 + side + h, y0 + h);
  rect(x0 - h, y0 + side - h, x0 + side + h, y0 + side + h);
  rect(x0 - h, y0 - h, x0 + h, y0 + side + h);
  rect(x0 + side - h, y0 - h, x0 + side + h, y0 + side + h);
  // The inner walls that survived carving.
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const c = cy * cells + cx;
      const left = x0 + cx * pitch;
      const top = y0 + cy * pitch;
      if (cx < cells - 1 && east[c]) rect(left + pitch - h, top - h, left + pitch + h, top + pitch + h);
      if (cy < cells - 1 && south[c]) rect(left - h, top + pitch - h, left + pitch + h, top + pitch + h);
    }
  }

  const inset = pitch / 2;
  return {
    walls,
    oats: [
      { x: x0 + inset, y: y0 + inset },
      { x: x0 + side - inset, y: y0 + side - inset },
    ],
    open: (x, y) =>
      x > x0 + h && x < x0 + side - h && y > y0 + h && y < y0 + side - h && !walls[Math.floor(y) * size + Math.floor(x)],
    bounds: { x0, y0, side },
    cells,
    pitch,
    links,
    ends: [0, cells * cells - 1],
  };
}
