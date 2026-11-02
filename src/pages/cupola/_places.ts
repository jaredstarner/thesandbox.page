// Reads the half-degree grid of places the build wrote (see _where.ts).

const RES = 2;
const W = 360 * RES;
const H = 180 * RES;

export class Where {
  private grid = new Uint16Array(W * H);

  constructor(
    private names: string[],
    rows: string,
  ) {
    rows.split('/').forEach((row, y) => {
      let x = 0;
      for (const run of row.split(',')) {
        const [v, n] = run.split('*');
        const id = parseInt(v, 36);
        const count = n ? parseInt(n, 36) : 1;
        this.grid.fill(id, y * W + x, y * W + x + count);
        x += count;
      }
    });
  }

  at(lat: number, lon: number): string {
    const y = Math.max(0, Math.min(H - 1, Math.floor((90 - lat) * RES)));
    const x = (((Math.floor((lon + 180) * RES) % W) + W) % W) as number;
    return this.names[this.grid[y * W + x]] ?? 'the open sea';
  }
}
