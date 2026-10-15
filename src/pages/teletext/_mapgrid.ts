// The weather map's grid, shared by the build (_map.ts) and the page: 36
// cells by 16 rows of block graphics, 72 by 48 dots, on a plate carrée
// stretched for 38° north so the lower 48 keep their shape on a 4:3 set.

const W = 72;
const H = 48;
const WEST = -125.6;
const EAST = -66.2;
const NORTH = 50.6;
// A dot on the set is about 1.16 times as wide as it is tall.
const SOUTH = NORTH - ((EAST - WEST) * Math.cos((38 * Math.PI) / 180) * H * 1) / (W * 1.16);

export const MAP = {
  w: W,
  h: H,
  project(lon: number, lat: number): { x: number; y: number } {
    return { x: ((lon - WEST) / (EAST - WEST)) * W, y: ((NORTH - lat) / (NORTH - SOUTH)) * H };
  },
  unproject(x: number, y: number): { lon: number; lat: number } {
    return { lon: WEST + (x / W) * (EAST - WEST), lat: NORTH - (y / H) * (NORTH - SOUTH) };
  },
};
