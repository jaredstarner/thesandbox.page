// The station indicator's little globe: an orthographic view turned to the needle's longitude, with
// the real day and night on it right now and a spark for every city on the dial.

const RAD = Math.PI / 180;
/** Cells per degree in the land bitmap the page is built with. */
export const LAND_PER_DEGREE = 2;
const COLS = 360 * LAND_PER_DEGREE;
const ROWS = 180 * LAND_PER_DEGREE;

export interface Dot {
  lat: number;
  lon: number;
}

/** The point on Earth with the sun overhead, in degrees, from a low-precision solar model. */
export function subsolar(now: Date): { lat: number; lon: number } {
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const day = (now.getTime() - start) / 86400000;
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10));
  const b = ((2 * Math.PI) / 364) * (day - 81);
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const hours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  let lon = -15 * (hours - 12 + eot / 60);
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: decl, lon };
}

export class Globe {
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private r: number;
  private land: Uint8Array;
  private img: ImageData;
  /** Per pixel inside the disc: x, y on the unit disc and z towards the viewer. */
  private px: Float32Array;
  private idx: Int32Array;
  private dots: Dot[];

  constructor(canvas: HTMLCanvasElement, base64: string, dots: Dot[]) {
    this.ctx = canvas.getContext('2d')!;
    this.size = canvas.width;
    this.r = this.size / 2 - 7;
    const bin = atob(base64);
    this.land = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) this.land[i] = bin.charCodeAt(i);
    this.img = this.ctx.createImageData(this.size, this.size);
    this.dots = dots;
    const c = this.size / 2;
    const xs: number[] = [];
    const ids: number[] = [];
    for (let j = 0; j < this.size; j++) {
      for (let i = 0; i < this.size; i++) {
        const x = (i + 0.5 - c) / this.r;
        const y = (c - j - 0.5) / this.r;
        const rr = x * x + y * y;
        if (rr > 1) continue;
        xs.push(x, y, Math.sqrt(1 - rr));
        ids.push((j * this.size + i) * 4);
      }
    }
    this.px = Float32Array.from(xs);
    this.idx = Int32Array.from(ids);
  }

  private bit(row: number, col: number): number {
    if (row < 0) row = 0;
    if (row > ROWS - 1) row = ROWS - 1;
    col = ((col % COLS) + COLS) % COLS;
    const i = row * COLS + col;
    return (this.land[i >> 3] >> (7 - (i & 7))) & 1;
  }

  /** How much of the cells around this point are land, blended, then sharpened into a smooth coast. */
  private landAt(lat: number, lon: number): number {
    const r = (90 - lat) * LAND_PER_DEGREE - 0.5;
    const c = (lon + 180) * LAND_PER_DEGREE - 0.5;
    const r0 = Math.floor(r);
    const c0 = Math.floor(c);
    const fr = r - r0;
    const fc = c - c0;
    const a = this.bit(r0, c0) * (1 - fc) + this.bit(r0, c0 + 1) * fc;
    const b = this.bit(r0 + 1, c0) * (1 - fc) + this.bit(r0 + 1, c0 + 1) * fc;
    const v = Math.min(1, Math.max(0, (a * (1 - fr) + b * fr - 0.3) / 0.4));
    return v * v * (3 - 2 * v);
  }

  draw(lon0: number, lat0: number, now: Date, here: Dot | null) {
    const { ctx, size, px, idx, img } = this;
    const d = img.data;
    d.fill(0);
    const sun = subsolar(now);
    const sd = Math.sin(sun.lat * RAD);
    const cd = Math.cos(sun.lat * RAD);
    const s0 = Math.sin(lat0 * RAD);
    const c0 = Math.cos(lat0 * RAD);
    for (let k = 0, n = idx.length; k < n; k++) {
      const x = px[k * 3];
      const y = px[k * 3 + 1];
      const z = px[k * 3 + 2];
      const sinLat = z * s0 + y * c0;
      const lat = Math.asin(sinLat) / RAD;
      const lon = lon0 + Math.atan2(x, z * c0 - y * s0) / RAD;
      const cosLat = Math.sqrt(Math.max(0, 1 - sinLat * sinLat));
      const cosZ = sinLat * sd + cosLat * cd * Math.cos((lon - sun.lon) * RAD);
      const t = Math.min(1, Math.max(0, (cosZ + 0.1) / 0.2));
      const day = t * t * (3 - 2 * t);
      const l = this.landAt(lat, lon);
      // Sea: deep blue-green by day, near black by night. Land: the dial's cream by day, umber by night.
      let red = 16 + (34 - 16) * day;
      let green = 22 + (58 - 22) * day;
      let blue = 26 + (66 - 26) * day;
      red += l * (40 + (214 - 40) * day - red);
      green += l * (30 + (186 - 30) * day - green);
      blue += l * (22 + (134 - 22) * day - blue);
      const limb = 0.5 + 0.5 * z;
      const o = idx[k];
      d[o] = red * limb;
      d[o + 1] = green * limb;
      d[o + 2] = blue * limb;
      d[o + 3] = 255;
    }
    ctx.clearRect(0, 0, size, size);
    ctx.putImageData(img, 0, 0);

    const c = size / 2;
    const r = this.r;
    const project = (p: Dot) => {
      const phi = p.lat * RAD;
      const lam = (p.lon - lon0) * RAD;
      const zc = s0 * Math.sin(phi) + c0 * Math.cos(phi) * Math.cos(lam);
      if (zc <= 0.05) return null;
      return {
        x: c + r * Math.cos(phi) * Math.sin(lam),
        y: c - r * (c0 * Math.sin(phi) - s0 * Math.cos(phi) * Math.cos(lam)),
        z: zc,
      };
    };

    // The needle's meridian, top to bottom of the disc.
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 106, 58, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c, c - r);
    ctx.lineTo(c, c + r);
    ctx.stroke();
    for (const dot of this.dots) {
      const p = project(dot);
      if (!p) continue;
      ctx.fillStyle = `rgba(255, 210, 130, ${0.35 + 0.5 * p.z})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (here) {
      const p = project(here);
      if (p) {
        ctx.strokeStyle = '#ffe2a8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#fff1d0';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // A thin bright rim, like the edge of a lens.
    ctx.strokeStyle = 'rgba(244, 228, 193, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, r + 0.75, 0, Math.PI * 2);
    ctx.stroke();
  }
}
