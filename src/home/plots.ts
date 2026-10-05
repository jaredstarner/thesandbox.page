// Where a plot sits on the survey. Shared by the build (the markup) and the
// browser (the next stake), so both place plots the same way.
//
// The world is a grid of sections, one world unit each, centred on integers.
// Plots follow a square spiral of 2-by-2 blocks out from the origin, and each
// plot takes one section of its block, picked from its number, so the settled
// land looks homesteaded rather than tiled. A plot's place depends only on its
// number: claiming a new plot never moves an old one. The survey office (the
// register) has a block of its own out to the north-west, which the spiral
// steps over.

/** Block coordinates of the nth step of a square spiral; step 0 is the origin. */
function spiral(step: number): [number, number] {
  const n = step + 1;
  const k = Math.ceil((Math.sqrt(n) - 1) / 2);
  let t = 2 * k + 1;
  let m = t * t;
  t -= 1;
  if (n >= m - t) return [k - (m - n), -k];
  m -= t;
  if (n >= m - t) return [-k, -k + (m - n)];
  m -= t;
  if (n >= m - t) return [-k + (m - n), k];
  return [k, k - (m - n - t)];
}

/** A small integer hash, so a plot's corner of its block is fixed by its number. */
function corner(plot: number): [number, number] {
  let h = Math.imul(plot ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  const pick = (h >>> 0) % 4;
  return [pick % 2, pick >> 1];
}

/** The office's block, three rings out on the north-west diagonal. */
const OFFICE_BLOCK: [number, number] = [-3, -3];
const OFFICE_STEP = (() => {
  for (let step = 0; ; step++) {
    const [bx, by] = spiral(step);
    if (bx === OFFICE_BLOCK[0] && by === OFFICE_BLOCK[1]) return step;
  }
})();

/** The survey office: the centre of its whole 2-by-2 block, and its size in sections. */
export const OFFICE = { x: OFFICE_BLOCK[0] * 2 + 0.5, y: OFFICE_BLOCK[1] * 2 + 0.5, size: 2 };

/** The section a plot occupies; plot 1 is at the origin's block. */
export function plotCell(plot: number): [number, number] {
  let step = plot - 1;
  if (step >= OFFICE_STEP) step += 1;
  const [bx, by] = spiral(step);
  const [dx, dy] = corner(plot);
  return [bx * 2 + dx, by * 2 + dy];
}
