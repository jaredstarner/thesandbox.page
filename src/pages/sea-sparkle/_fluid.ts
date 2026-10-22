// FLIP water for /sea-sparkle/, after Matthias Müller's "Ten Minute Physics"
// FLIP tutorial: particles carry the water and a staggered grid makes it
// incompressible every step. Everything is in screen CSS pixels with y down,
// and the container is the union of the browser windows showing the tank, so
// the walls move whenever a window does. Each particle also carries the light
// of the plankton in it, which flashes when the water around it is sheared.

/** One window's viewport on the screen, and how fast it is moving. */
export interface Wall {
  slot: number;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  /** The viewport's edges rounded to the grid lattice: the walls the water actually meets. */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Pour {
  slot: number;
  /** Particles still to add. */
  left: number;
  /** Fraction of the way across the window, 0 to 1. */
  at: number;
  carry: number;
  row: number;
}

const FLUID = 0;
const AIR = 1;
const SOLID = 2;

/** Fastest a wall may push the water, px/s; a flung window is fast, a snapped one is a jump. */
const MAX_WALL_SPEED = 4200;

export interface TankOptions {
  /** Grid cell size in px. */
  cell: number;
  /** Most particles the tank will hold. */
  cap: number;
  /** Downward pull in px/s². */
  gravity: number;
}

export class Tank {
  readonly h: number;
  readonly r: number;
  readonly cap: number;
  count = 0;

  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** Plankton light, 0 to about 1. */
  readonly light: Float32Array;
  /** How much light each particle's plankton has left to give. */
  readonly charge: Float32Array;
  /** The steady jostling each particle has got used to and no longer flashes at. */
  readonly used: Float32Array;
  /** A fixed random number per particle, for drawing. */
  readonly tag: Float32Array;
  /** The slot of the window the particle was last inside. */
  readonly owner: Int8Array;
  /** Shear rate around each particle, 1/s. */
  readonly shear: Float32Array;
  /** Neighbours within reach at the last shear measurement: few means the surface. */
  readonly crowd: Uint8Array;

  gravityX = 0;
  gravityY: number;
  walls: Wall[] = [];
  /** A stirring stick under the pointer, in screen px. */
  stick = { active: false, x: 0, y: 0, r: 26, vx: 0, vy: 0 };
  pressureIters = 36;
  flipRatio = 0.85;
  wallFlip = 0.3;
  driftGain = 0.05;

  private pours: Pour[] = [];
  restDensity: number;
  private rand = 0x2f6b9a1d;

  // The grid covers the bounding box of every window, plus a solid border.
  private gx0 = 0;
  private gy0 = 0;
  private nx = 0;
  private ny = 0;
  private gridCap = 0;
  private u = new Float32Array(0);
  private v = new Float32Array(0);
  private du = new Float32Array(0);
  private dv = new Float32Array(0);
  private pu = new Float32Array(0);
  private pv = new Float32Array(0);
  private s = new Float32Array(0);
  private wallU = new Float32Array(0);
  private wallV = new Float32Array(0);
  private density = new Float32Array(0);
  private type = new Uint8Array(0);

  // A finer hash grid for pushing particles apart and finding neighbours.
  private hx = 0;
  private hy = 0;
  private hashCap = 0;
  private cellCount = new Int32Array(0);
  private cellFirst = new Int32Array(0);
  private cellIds: Int32Array;

  constructor(opts: TankOptions) {
    this.h = opts.cell;
    this.r = 0.3 * opts.cell;
    this.cap = opts.cap;
    this.gravityY = opts.gravity;
    const n = opts.cap;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.light = new Float32Array(n);
    this.charge = new Float32Array(n);
    this.used = new Float32Array(n);
    this.tag = new Float32Array(n);
    this.owner = new Int8Array(n);
    this.shear = new Float32Array(n);
    this.crowd = new Uint8Array(n);
    this.cellIds = new Int32Array(n);
    // Particles settle about 2r apart on a hexagonal lattice; this is how many
    // that puts in a cell, a little under so the surface layer doesn't count against it.
    const dx = 2 * this.r;
    this.restDensity = (this.h * this.h) / (dx * dx * 0.866);
  }

  /** Area of water one particle stands for, in px². */
  get particleArea() {
    const dx = 2 * this.r;
    return dx * dx * 0.866;
  }

  private random() {
    // xorshift32: the tank needs no more than this, and it keeps runs repeatable.
    let x = this.rand;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rand = x >>> 0;
    return this.rand / 4294967296;
  }

  wall(slot: number) {
    for (const w of this.walls) if (w.slot === slot) return w;
    return null;
  }

  /**
   * Move a window's wall to where the window now is. A small move pushes the
   * water; a jump (a snapped or restored window) carries the window's own water with it.
   */
  placeWall(slot: number, x: number, y: number, w: number, h: number, dt: number) {
    const wall = this.wall(slot);
    if (!wall) {
      const wall = { slot, x, y, w, h, vx: 0, vy: 0, left: 0, right: 0, top: 0, bottom: 0 };
      this.snap(wall);
      this.walls.push(wall);
      return;
    }
    const dx = x - wall.x;
    const dy = y - wall.y;
    const jump = Math.max(Math.abs(dx), Math.abs(dy)) > 0.4 * Math.min(w, h, wall.w, wall.h);
    if (jump || dt <= 0) {
      for (let i = 0; i < this.count; i++) {
        if (this.owner[i] !== slot) continue;
        this.x[i] += dx;
        this.y[i] += dy;
      }
      wall.vx = 0;
      wall.vy = 0;
    } else {
      let vx = dx / dt;
      let vy = dy / dt;
      const speed = Math.hypot(vx, vy);
      if (speed > MAX_WALL_SPEED) {
        vx *= MAX_WALL_SPEED / speed;
        vy *= MAX_WALL_SPEED / speed;
      }
      wall.vx = vx;
      wall.vy = vy;
    }
    wall.x = x;
    wall.y = y;
    wall.w = w;
    wall.h = h;
    this.snap(wall);
  }

  /**
   * Round a window's edges to the grid lattice. The grid opens a cell when its
   * centre is inside the window, so these are the walls the pressure solve
   * sees; keeping the particles to the same walls stops the floor fizzing.
   * The water may end a few pixels past an edge, out of sight, or short of
   * it, which the drawn radius of each particle covers.
   */
  private snap(w: Wall) {
    const h = this.h;
    w.left = Math.round(w.x / h) * h;
    w.right = Math.round((w.x + w.w) / h) * h;
    w.top = Math.round(w.y / h) * h;
    w.bottom = Math.round((w.y + w.h) / h) * h;
  }

  /** Take a window away. Water that only it held is spilled. */
  removeWall(slot: number) {
    this.walls = this.walls.filter((w) => w.slot !== slot);
    this.pours = this.pours.filter((p) => p.slot !== slot);
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.owner[i] !== slot) continue;
      const k = this.containing(this.x[i], this.y[i], 0);
      if (k < 0) this.remove(i);
      else this.owner[i] = k;
    }
  }

  /** Pour this many particles in from the top of a window. */
  pour(slot: number, amount: number, at = 0.5) {
    const room = this.cap - this.count - this.pours.reduce((n, p) => n + p.left, 0);
    const left = Math.max(0, Math.min(amount, room));
    if (left > 0) this.pours.push({ slot, left, at, carry: 0, row: 0 });
    return left;
  }

  /** Fill a window to this fraction of its height at once, as still water. */
  fill(slot: number, level: number) {
    const w = this.wall(slot);
    if (!w) return;
    const dx = 2 * this.r;
    const dy = dx * 0.866;
    const top = w.y + w.h * (1 - level);
    let row = 0;
    for (let y = w.bottom - this.r; y > top; y -= dy, row++) {
      for (let x = w.left + this.r + (row % 2) * 0.5 * dx; x <= w.right - this.r; x += dx) this.add(x, y, 0, 0, slot);
    }
  }

  get pouring() {
    return this.pours.length > 0;
  }

  /** Jolt one window's water sideways, as if the tank had been knocked. */
  knock(slot: number, vx: number, vy: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.owner[i] !== slot) continue;
      this.vx[i] += vx * (0.85 + 0.3 * this.tag[i]);
      this.vy[i] += vy * (0.85 + 0.3 * this.tag[i]);
    }
  }

  /** Count the particles last inside each window. */
  census(into: Map<number, number>) {
    into.clear();
    for (const w of this.walls) into.set(w.slot, 0);
    for (let i = 0; i < this.count; i++) {
      const k = this.owner[i];
      into.set(k, (into.get(k) ?? 0) + 1);
    }
    return into;
  }

  step(dt: number, substeps = 2) {
    if (this.walls.length === 0) return;
    const sdt = dt / substeps;
    this.emit(dt);
    // Gravity first, then make the velocities incompressible, and only then
    // move the particles: moving them before the projection lets the water
    // sink into itself by g·dt² every step.
    for (let k = 0; k < substeps; k++) {
      this.accelerate(sdt);
      this.buildGrid();
      this.toGrid();
      this.updateDensity();
      this.solve(sdt);
      this.toParticles();
      this.advect(sdt);
      this.pushApart(2);
      this.collide();
    }
    this.measureShear();
    this.glow(dt);
    this.twinkle(dt);
  }

  /** A few cells flash on their own, as a culture left alone does now and then. */
  private twinkle(dt: number) {
    let n = this.count * 0.0006 * dt;
    while (n > 0 && this.count > 0) {
      if (this.random() < n) {
        const i = Math.floor(this.random() * this.count);
        this.light[i] = Math.max(this.light[i], 0.5 + 0.45 * this.random());
      }
      n -= 1;
    }
  }

  private containing(x: number, y: number, inset: number) {
    for (const w of this.walls) {
      if (x >= w.left + inset && x <= w.right - inset && y >= w.top + inset && y <= w.bottom - inset) return w.slot;
    }
    return -1;
  }

  private add(x: number, y: number, vx: number, vy: number, slot: number) {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.light[i] = 0;
    this.charge[i] = 1;
    this.used[i] = 0;
    this.tag[i] = this.random();
    this.owner[i] = slot;
    this.shear[i] = 0;
  }

  private remove(i: number) {
    const j = --this.count;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.light[i] = this.light[j];
    this.charge[i] = this.charge[j];
    this.used[i] = this.used[j];
    this.tag[i] = this.tag[j];
    this.owner[i] = this.owner[j];
    this.shear[i] = this.shear[j];
  }

  /** Feed the pours: rows of particles falling from just under each window's top edge. */
  private emit(dt: number) {
    const spacing = 2 * this.r * 1.02;
    const speed = 900;
    for (const p of this.pours) {
      const w = this.wall(p.slot);
      if (!w) {
        p.left = 0;
        continue;
      }
      const width = Math.min(w.w * 0.3, 26 * spacing);
      const across = Math.max(1, Math.floor(width / spacing));
      const cx = w.left + this.r + (w.right - w.left - 2 * this.r) * p.at;
      const x0 = Math.max(w.left + this.r, Math.min(w.right - this.r - across * spacing, cx - (across * spacing) / 2));
      // Rows owed since the last step, stacked down from the top edge as the stream would have carried them.
      p.carry += (speed * dt) / (spacing * 0.866);
      const rows = Math.floor(p.carry);
      p.carry -= rows;
      for (let k = 0; k < rows && p.left > 0; k++) {
        p.row ^= 1;
        const y = w.top + this.r + 2 + k * spacing * 0.866;
        for (let a = 0; a < across && p.left > 0; a++) {
          const x = x0 + (a + 0.5 * p.row) * spacing + (this.random() - 0.5) * 0.2 * this.r;
          this.add(x, y, (this.random() - 0.5) * 30, speed, p.slot);
          p.left--;
        }
      }
    }
    this.pours = this.pours.filter((p) => p.left > 0);
  }

  private accelerate(dt: number) {
    const gx = this.gravityX * dt;
    const gy = this.gravityY * dt;
    for (let i = 0; i < this.count; i++) {
      this.vx[i] += gx;
      this.vy[i] += gy;
    }
  }

  private advect(dt: number) {
    for (let i = 0; i < this.count; i++) {
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
  }

  /** Lay the hash grid over the windows' bounding box and sort particles into it. */
  private hashParticles() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const w of this.walls) {
      minX = Math.min(minX, w.x);
      minY = Math.min(minY, w.y);
      maxX = Math.max(maxX, w.x + w.w);
      maxY = Math.max(maxY, w.y + w.h);
    }
    const spacing = 2.2 * this.r;
    this.hashX0 = minX - spacing;
    this.hashY0 = minY - spacing;
    this.hx = Math.ceil((maxX - minX) / spacing) + 3;
    this.hy = Math.ceil((maxY - minY) / spacing) + 3;
    const cells = this.hx * this.hy;
    if (cells + 1 > this.hashCap) {
      this.hashCap = Math.ceil((cells + 1) * 1.25);
      this.cellCount = new Int32Array(this.hashCap);
      this.cellFirst = new Int32Array(this.hashCap);
    }
    const count = this.cellCount;
    const first = this.cellFirst;
    count.fill(0, 0, cells);
    const inv = 1 / spacing;
    for (let i = 0; i < this.count; i++) count[this.hashCell(i, inv)]++;
    let sum = 0;
    for (let c = 0; c < cells; c++) {
      sum += count[c];
      first[c] = sum;
    }
    first[cells] = sum;
    for (let i = 0; i < this.count; i++) {
      const c = this.hashCell(i, inv);
      first[c]--;
      this.cellIds[first[c]] = i;
    }
  }

  private hashX0 = 0;
  private hashY0 = 0;

  private hashCell(i: number, inv: number) {
    const xi = Math.max(0, Math.min(this.hx - 1, Math.floor((this.x[i] - this.hashX0) * inv)));
    const yi = Math.max(0, Math.min(this.hy - 1, Math.floor((this.y[i] - this.hashY0) * inv)));
    return xi * this.hy + yi;
  }

  private pushApart(iters: number) {
    this.hashParticles();
    const inv = 1 / (2.2 * this.r);
    const minDist = 2 * this.r;
    const minDist2 = minDist * minDist;
    const { x, y, cellFirst: first, cellIds: ids, hx, hy } = this;
    for (let iter = 0; iter < iters; iter++) {
      for (let i = 0; i < this.count; i++) {
        const px = x[i];
        const py = y[i];
        const pxi = Math.floor((px - this.hashX0) * inv);
        const pyi = Math.floor((py - this.hashY0) * inv);
        const x0 = Math.max(pxi - 1, 0);
        const y0 = Math.max(pyi - 1, 0);
        const x1 = Math.min(pxi + 1, hx - 1);
        const y1 = Math.min(pyi + 1, hy - 1);
        for (let xi = x0; xi <= x1; xi++) {
          for (let yi = y0; yi <= y1; yi++) {
            const c = xi * hy + yi;
            const end = first[c + 1];
            for (let k = first[c]; k < end; k++) {
              const j = ids[k];
              if (j === i) continue;
              let dx = x[j] - x[i];
              let dy = y[j] - y[i];
              const d2 = dx * dx + dy * dy;
              if (d2 > minDist2 || d2 === 0) continue;
              const d = Math.sqrt(d2);
              const s = (0.5 * (minDist - d)) / d;
              dx *= s;
              dy *= s;
              x[i] -= dx;
              y[i] -= dy;
              x[j] += dx;
              y[j] += dy;
            }
          }
        }
      }
    }
  }

  /** Keep every particle inside a window, and out from under the stirring stick. */
  private collide() {
    const r = this.r;
    const stick = this.stick;
    const reach = stick.r + r;
    for (let i = this.count - 1; i >= 0; i--) {
      if (stick.active) {
        const dx = this.x[i] - stick.x;
        const dy = this.y[i] - stick.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < reach * reach) {
          const d = Math.sqrt(d2) || 1;
          this.x[i] = stick.x + (dx / d) * reach;
          this.y[i] = stick.y + (dy / d) * reach;
          this.vx[i] = stick.vx;
          this.vy[i] = stick.vy;
        }
      }
      const px = this.x[i];
      const py = this.y[i];
      const inside = this.containing(px, py, r);
      if (inside >= 0) {
        this.owner[i] = inside;
        continue;
      }
      // Between windows, or past an edge: back into the window it came from.
      const w = this.wall(this.owner[i]) ?? this.nearest(px, py);
      if (!w) {
        this.remove(i);
        continue;
      }
      const left = w.left + r;
      const right = w.right - r;
      const top = w.top + r;
      const bottom = w.bottom - r;
      if (px < left) {
        this.x[i] = left;
        if (this.vx[i] < w.vx) this.vx[i] = w.vx;
      } else if (px > right) {
        this.x[i] = right;
        if (this.vx[i] > w.vx) this.vx[i] = w.vx;
      }
      if (py < top) {
        this.y[i] = top;
        if (this.vy[i] < w.vy) this.vy[i] = w.vy;
      } else if (py > bottom) {
        this.y[i] = bottom;
        if (this.vy[i] > w.vy) this.vy[i] = w.vy;
      }
    }
  }

  private nearest(x: number, y: number) {
    let best: Wall | null = null;
    let bestD = Infinity;
    for (const w of this.walls) {
      const dx = Math.max(w.x - x, 0, x - (w.x + w.w));
      const dy = Math.max(w.y - y, 0, y - (w.y + w.h));
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    return best;
  }

  /** Size the grid to the windows and mark which cells lie outside all of them. */
  private buildGrid() {
    const h = this.h;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const w of this.walls) {
      minX = Math.min(minX, w.x);
      minY = Math.min(minY, w.y);
      maxX = Math.max(maxX, w.x + w.w);
      maxY = Math.max(maxY, w.y + w.h);
    }
    // Snap the origin to the screen's own cell lattice, so cells stay put as windows move.
    this.gx0 = (Math.floor(minX / h) - 2) * h;
    this.gy0 = (Math.floor(minY / h) - 2) * h;
    this.nx = Math.ceil((maxX - this.gx0) / h) + 3;
    this.ny = Math.ceil((maxY - this.gy0) / h) + 3;
    const cells = this.nx * this.ny;
    if (cells > this.gridCap) {
      this.gridCap = Math.ceil(cells * 1.25);
      const n = this.gridCap;
      this.u = new Float32Array(n);
      this.v = new Float32Array(n);
      this.du = new Float32Array(n);
      this.dv = new Float32Array(n);
      this.pu = new Float32Array(n);
      this.pv = new Float32Array(n);
      this.s = new Float32Array(n);
      this.wallU = new Float32Array(n);
      this.wallV = new Float32Array(n);
      this.density = new Float32Array(n);
      this.type = new Uint8Array(n);
    }
    const { nx, ny, s, wallU, wallV } = this;
    s.fill(0, 0, cells);
    wallU.fill(0, 0, cells);
    wallV.fill(0, 0, cells);
    for (const w of this.walls) {
      // Open the cells whose centres lie inside this window, and give the ring
      // of closed cells around it the window's velocity, so moving glass pushes.
      const i0 = Math.max(0, Math.floor((w.x - this.gx0) / h - 2.5));
      const i1 = Math.min(nx - 1, Math.ceil((w.x + w.w - this.gx0) / h + 2.5));
      const j0 = Math.max(0, Math.floor((w.y - this.gy0) / h - 2.5));
      const j1 = Math.min(ny - 1, Math.ceil((w.y + w.h - this.gy0) / h + 2.5));
      for (let i = i0; i <= i1; i++) {
        const cx = this.gx0 + (i + 0.5) * h;
        const inX = cx > w.left && cx < w.right;
        for (let j = j0; j <= j1; j++) {
          const cy = this.gy0 + (j + 0.5) * h;
          const c = i * ny + j;
          if (inX && cy > w.top && cy < w.bottom) {
            s[c] = 1;
          } else if (s[c] === 0) {
            wallU[c] = w.vx;
            wallV[c] = w.vy;
          }
        }
      }
    }
    // The grid's own border is always closed.
    for (let i = 0; i < nx; i++) {
      s[i * ny] = 0;
      s[i * ny + ny - 1] = 0;
    }
    for (let j = 0; j < ny; j++) {
      s[j] = 0;
      s[(nx - 1) * ny + j] = 0;
    }
    const stick = this.stick;
    if (stick.active) {
      const i0 = Math.max(1, Math.floor((stick.x - stick.r - this.gx0) / h));
      const i1 = Math.min(nx - 2, Math.ceil((stick.x + stick.r - this.gx0) / h));
      const j0 = Math.max(1, Math.floor((stick.y - stick.r - this.gy0) / h));
      const j1 = Math.min(ny - 2, Math.ceil((stick.y + stick.r - this.gy0) / h));
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const dx = this.gx0 + (i + 0.5) * h - stick.x;
          const dy = this.gy0 + (j + 0.5) * h - stick.y;
          if (dx * dx + dy * dy > stick.r * stick.r) continue;
          const c = i * ny + j;
          s[c] = 0;
          wallU[c] = stick.vx;
          wallV[c] = stick.vy;
        }
      }
    }
  }

  private toGrid() {
    const { nx, ny, h, u, v, du, dv, s, type } = this;
    const cells = nx * ny;
    const inv = 1 / h;
    u.fill(0, 0, cells);
    v.fill(0, 0, cells);
    du.fill(0, 0, cells);
    dv.fill(0, 0, cells);
    for (let c = 0; c < cells; c++) type[c] = s[c] === 0 ? SOLID : AIR;
    for (let i = 0; i < this.count; i++) {
      const xi = Math.max(0, Math.min(nx - 1, Math.floor((this.x[i] - this.gx0) * inv)));
      const yi = Math.max(0, Math.min(ny - 1, Math.floor((this.y[i] - this.gy0) * inv)));
      const c = xi * ny + yi;
      if (type[c] === AIR) type[c] = FLUID;
    }
    this.splat(u, du, this.vx, 0, h * 0.5);
    this.splat(v, dv, this.vy, h * 0.5, 0);
    for (let c = 0; c < cells; c++) {
      if (du[c] > 0) u[c] /= du[c];
      if (dv[c] > 0) v[c] /= dv[c];
    }
    // Faces against closed cells take the closed cell's velocity: still for the
    // border, the window's for its glass, the stick's under the pointer.
    const { wallU, wallV } = this;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const c = i * ny + j;
        const solid = type[c] === SOLID;
        if (solid) {
          u[c] = wallU[c];
          v[c] = wallV[c];
        } else {
          if (i > 0 && type[c - ny] === SOLID) u[c] = wallU[c - ny];
          if (j > 0 && type[c - 1] === SOLID) v[c] = wallV[c - 1];
        }
      }
    }
    this.pu.set(u.subarray(0, cells));
    this.pv.set(v.subarray(0, cells));
  }

  /** Spread one velocity component onto its faces with bilinear weights. */
  private splat(f: Float32Array, d: Float32Array, vel: Float32Array, dx: number, dy: number) {
    const { nx, ny, h } = this;
    const inv = 1 / h;
    const lo = h;
    const hiX = (nx - 1) * h;
    const hiY = (ny - 1) * h;
    for (let i = 0; i < this.count; i++) {
      const x = Math.max(lo, Math.min(hiX, this.x[i] - this.gx0)) - dx;
      const y = Math.max(lo, Math.min(hiY, this.y[i] - this.gy0)) - dy;
      const x0 = Math.min(Math.floor(x * inv), nx - 2);
      const y0 = Math.min(Math.floor(y * inv), ny - 2);
      const tx = (x - x0 * h) * inv;
      const ty = (y - y0 * h) * inv;
      const x1 = Math.min(x0 + 1, nx - 2);
      const y1 = Math.min(y0 + 1, ny - 2);
      const sx = 1 - tx;
      const sy = 1 - ty;
      const w0 = sx * sy;
      const w1 = tx * sy;
      const w2 = tx * ty;
      const w3 = sx * ty;
      const n0 = x0 * ny + y0;
      const n1 = x1 * ny + y0;
      const n2 = x1 * ny + y1;
      const n3 = x0 * ny + y1;
      const pv = vel[i];
      f[n0] += pv * w0;
      d[n0] += w0;
      f[n1] += pv * w1;
      d[n1] += w1;
      f[n2] += pv * w2;
      d[n2] += w2;
      f[n3] += pv * w3;
      d[n3] += w3;
    }
  }

  private updateDensity() {
    const { nx, ny, h, density } = this;
    const inv = 1 / h;
    const half = 0.5 * h;
    density.fill(0, 0, nx * ny);
    for (let i = 0; i < this.count; i++) {
      const x = Math.max(h, Math.min((nx - 1) * h, this.x[i] - this.gx0)) - half;
      const y = Math.max(h, Math.min((ny - 1) * h, this.y[i] - this.gy0)) - half;
      const x0 = Math.floor(x * inv);
      const y0 = Math.floor(y * inv);
      const tx = (x - x0 * h) * inv;
      const ty = (y - y0 * h) * inv;
      const x1 = Math.min(x0 + 1, nx - 2);
      const y1 = Math.min(y0 + 1, ny - 2);
      const sx = 1 - tx;
      const sy = 1 - ty;
      density[x0 * ny + y0] += sx * sy;
      density[x1 * ny + y0] += tx * sy;
      density[x1 * ny + y1] += tx * ty;
      density[x0 * ny + y1] += sx * ty;
    }
  }

  /** Gauss-Seidel on the divergence, with over-relaxation and a push against packed cells. */
  private solve(dt: number) {
    const { nx, ny, u, v, s, type, density } = this;
    const rest = this.restDensity;
    const over = 1.9;
    // Packed cells push outward at a speed in proportion to how overfull they
    // are: half a cell per step for each particle too many.
    const drift = (this.driftGain * this.h) / dt;
    for (let iter = 0; iter < this.pressureIters; iter++) {
      for (let i = 1; i < nx - 1; i++) {
        for (let j = 1; j < ny - 1; j++) {
          const c = i * ny + j;
          if (type[c] !== FLUID) continue;
          const left = c - ny;
          const right = c + ny;
          const top = c - 1;
          const bottom = c + 1;
          const sx0 = s[left];
          const sx1 = s[right];
          const sy0 = s[top];
          const sy1 = s[bottom];
          const sum = sx0 + sx1 + sy0 + sy1;
          if (sum === 0) continue;
          let div = u[right] - u[c] + v[bottom] - v[c];
          const compression = density[c] - rest;
          if (compression > 0) div -= drift * compression;
          const p = (-div / sum) * over;
          u[c] -= sx0 * p;
          u[right] += sx1 * p;
          v[c] -= sy0 * p;
          v[bottom] += sy1 * p;
        }
      }
    }
  }

  private toParticles() {
    this.gather(this.u, this.pu, this.vx, 0, this.h * 0.5, this.ny);
    this.gather(this.v, this.pv, this.vy, this.h * 0.5, 0, 1);
  }

  /** Blend the grid's new velocity (PIC) with its change (FLIP) back onto the particles. */
  private gather(f: Float32Array, prev: Float32Array, vel: Float32Array, dx: number, dy: number, offset: number) {
    const { nx, ny, h, type } = this;
    const inv = 1 / h;
    for (let i = 0; i < this.count; i++) {
      // Against the glass, mostly PIC: pure FLIP keeps a jittering layer
      // alive on the floor, and the damping stands in for the drag of a real wall.
      const ci = Math.max(1, Math.min(nx - 2, Math.floor((this.x[i] - this.gx0) * inv)));
      const cj = Math.max(1, Math.min(ny - 2, Math.floor((this.y[i] - this.gy0) * inv)));
      const cc = ci * ny + cj;
      const walled =
        type[cc] === SOLID ||
        type[cc - ny] === SOLID ||
        type[cc + ny] === SOLID ||
        type[cc - 1] === SOLID ||
        type[cc + 1] === SOLID;
      const flip = walled ? this.wallFlip : this.flipRatio;
      const x = Math.max(h, Math.min((nx - 1) * h, this.x[i] - this.gx0)) - dx;
      const y = Math.max(h, Math.min((ny - 1) * h, this.y[i] - this.gy0)) - dy;
      const x0 = Math.min(Math.floor(x * inv), nx - 2);
      const y0 = Math.min(Math.floor(y * inv), ny - 2);
      const tx = (x - x0 * h) * inv;
      const ty = (y - y0 * h) * inv;
      const x1 = Math.min(x0 + 1, nx - 2);
      const y1 = Math.min(y0 + 1, ny - 2);
      const sx = 1 - tx;
      const sy = 1 - ty;
      const n0 = x0 * ny + y0;
      const n1 = x1 * ny + y0;
      const n2 = x1 * ny + y1;
      const n3 = x0 * ny + y1;
      // A face counts only if it borders water. Faces buried in the glass
      // would hand back none of the pressure that holds the water up, and
      // the water beside a wall would slide down it.
      const a0 = type[n0] === FLUID || type[n0 - offset] === FLUID ? 1 : 0;
      const a1 = type[n1] === FLUID || type[n1 - offset] === FLUID ? 1 : 0;
      const a2 = type[n2] === FLUID || type[n2 - offset] === FLUID ? 1 : 0;
      const a3 = type[n3] === FLUID || type[n3 - offset] === FLUID ? 1 : 0;
      const w0 = a0 * sx * sy;
      const w1 = a1 * tx * sy;
      const w2 = a2 * tx * ty;
      const w3 = a3 * sx * ty;
      const sum = w0 + w1 + w2 + w3;
      if (sum <= 0) continue;
      const pic = (w0 * f[n0] + w1 * f[n1] + w2 * f[n2] + w3 * f[n3]) / sum;
      const change =
        (w0 * (f[n0] - prev[n0]) + w1 * (f[n1] - prev[n1]) + w2 * (f[n2] - prev[n2]) + w3 * (f[n3] - prev[n3])) / sum;
      vel[i] = (1 - flip) * pic + flip * (vel[i] + change);
    }
  }

  /**
   * How hard the water around each particle is being sheared: the mean of
   * |relative velocity| / distance over its neighbours. Water at rest, or
   * moving all of a piece, scores near zero; a breaking wave or a splash scores high.
   */
  private measureShear() {
    this.hashParticles();
    const inv = 1 / (2.2 * this.r);
    const reach = 2.6 * this.r;
    const reach2 = reach * reach;
    const { x, y, vx, vy, cellFirst: first, cellIds: ids, hx, hy, shear } = this;
    for (let i = 0; i < this.count; i++) {
      const pxi = Math.floor((x[i] - this.hashX0) * inv);
      const pyi = Math.floor((y[i] - this.hashY0) * inv);
      let sum = 0;
      let n = 0;
      for (let xi = Math.max(pxi - 1, 0); xi <= Math.min(pxi + 1, hx - 1); xi++) {
        for (let yi = Math.max(pyi - 1, 0); yi <= Math.min(pyi + 1, hy - 1); yi++) {
          const c = xi * hy + yi;
          const end = first[c + 1];
          for (let k = first[c]; k < end; k++) {
            const j = ids[k];
            if (j === i) continue;
            const dx = x[j] - x[i];
            const dy = y[j] - y[i];
            const d2 = dx * dx + dy * dy;
            if (d2 > reach2) continue;
            const d = Math.max(Math.sqrt(d2), this.r);
            sum += Math.hypot(vx[j] - vx[i], vy[j] - vy[i]) / d;
            n++;
          }
        }
      }
      shear[i] = n > 0 ? sum / n : 0;
      this.crowd[i] = Math.min(255, n);
    }
  }

  /** Light from shear, as in a dinoflagellate: a flash that fades, and a charge that tires and recovers. */
  private glow(dt: number) {
    const fade = Math.exp(-dt / 0.32);
    const { light, charge, shear, crowd } = this;
    const near = 3 * this.h;
    const bySlot: (Wall | undefined)[] = [];
    for (const w of this.walls) bySlot[w.slot] = w;
    for (let i = 0; i < this.count; i++) {
      const w = bySlot[this.owner[i]];
      // Water resting against the glass fizzes a little in the solver; ask more of it there.
      let low = 7;
      let slow = 260;
      let rel = 0;
      if (w) {
        const x = this.x[i];
        const y = this.y[i];
        const side = Math.min(x - w.left, w.right - x);
        const end = Math.min(y - w.top, w.bottom - y);
        if (side < near && end < near) {
          // Wedged in a corner, where the fizz is worst.
          low = 30;
          slow = 700;
        } else if (Math.min(side, end) < near) {
          low = 16;
          slow = 450;
        }
        rel = Math.hypot(this.vx[i] - w.vx, this.vy[i] - w.vy);
      }
      const sheared = (shear[i] - low) / (50 - low);
      // The solver's walls don't drag, so it has no boundary layers to shear;
      // speed through the tank stands in for them, most of all at the surface.
      const surface = crowd[i] <= 4 ? 1 : 0.55;
      const stirred = ((rel - slow) / 700) * surface;
      const e = Math.min(1, Math.max(0, sheared, stirred));
      // Like any sense, they get used to a steady small stimulus, so the
      // solver's own fizz at rest fades to dark while a real disturbance still flashes.
      this.used[i] += (Math.min(e, 0.35) - this.used[i]) * Math.min(1, dt / 2.5);
      const flash = Math.max(0, e - this.used[i]) * charge[i];
      light[i] = Math.max(light[i] * fade, flash);
      charge[i] = Math.min(1, Math.max(0.3, charge[i] - flash * dt * 0.5 + dt / 9));
    }
  }
}
