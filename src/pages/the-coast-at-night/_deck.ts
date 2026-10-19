// The view from the deck: every light a lookout would see from one spot at
// sea, at its true bearing on the horizon.
//
// A light is in sight when it is within its nominal range, above the horizon
// (its geographic range, from its height and the eye's), in a sector that
// shows toward the boat, and not behind land. A strong light past the horizon
// but within range shows only its loom, a glow in the sky above where it is.

import { LIGHT_RGB } from './_chart';
import { DetailStore, type Detail } from './_card';
import { bearing, destination, dip, distanceNm, formatPosition, geographicRange, mercX, mercY } from './_geo';
import type { Land } from './_land';
import type { Lights } from './_lights';
import { levelAt, COLOURS } from './_rhythm';
import { sectorAt, span } from './_sectors';

interface Seen {
  i: number;
  nm: number;
  brg: number;
  /** Colour code shown toward the boat. */
  colour: number;
  /** 0 to about 3: how bright it reads at this distance. */
  bright: number;
  /** Degrees above the horizon. */
  alt: number;
  loom: boolean;
}

const MASK = 1024;
const MASK_NM = 48;
const SKY_STARS = 1100;

function rgb(code: number, a: number): string {
  const [r, g, b] = LIGHT_RGB[code];
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${a})`;
}

export class Deck {
  onLeave: () => void = () => {};
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private lat = 0;
  private lon = 0;
  private heading = 0;
  private turnTo: number | null = null;
  private fov = 64;
  private eye = 5;
  private seen: Seen[] = [];
  private coarse: Land | null = null;
  private fine: Land | null = null;
  private mask: Uint8Array | null = null;
  private sprites: HTMLCanvasElement[] = [];
  private stars: { az: number; alt: number; m: number; tw: number }[] = [];
  private pointer: { x: number; y: number } | null = null;
  private drag: { x: number; heading: number; id: number } | null = null;
  private pinch: { d: number; fov: number } | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private details: DetailStore;
  private names = new Map<number, Detail>();
  private rows = new Map<number, HTMLElement>();
  private tip: HTMLElement;
  private toast: HTMLElement;
  private toastTimer = 0;
  private dpr = 1;

  constructor(
    private root: HTMLElement,
    private lights: Lights,
  ) {
    this.canvas = root.querySelector<HTMLCanvasElement>('[data-deck]')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.tip = root.querySelector('[data-tip]')!;
    this.details = new DetailStore(location.pathname.replace(/\/?$/, '/'), lights.chunk);
    this.toast = document.createElement('p');
    this.toast.className = 'toast';
    this.toast.hidden = true;
    root.append(this.toast);
    this.makeSprites();
    let seed = 1725;
    const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let k = 0; k < SKY_STARS; k++) {
      const m = rand();
      this.stars.push({ az: rand() * 360, alt: (Math.asin(rand()) * 180) / Math.PI, m: m * m * m, tw: rand() * 6.28 });
    }

    root.querySelector('[data-deck-back]')!.addEventListener('click', () => this.leave());
    for (const r of root.querySelectorAll<HTMLInputElement>('input[name="eye"]')) {
      r.addEventListener('change', () => {
        this.eye = Number(r.value);
        this.compute();
      });
    }
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      try {
        c.setPointerCapture(e.pointerId);
      } catch {}
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.turnTo = null;
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: this.fov };
        this.drag = null;
      } else this.drag = { x: e.clientX, heading: this.heading, id: e.pointerId };
    });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      const t = this.touches.get(e.pointerId);
      if (t) {
        t.x = e.clientX;
        t.y = e.clientY;
      }
      if (this.pinch && this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        this.setFov(this.pinch.fov / (Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d));
      } else if (this.drag && this.drag.id === e.pointerId) {
        this.heading = (this.drag.heading - ((e.clientX - this.drag.x) * this.fov) / c.clientWidth + 720) % 360;
      }
    });
    const up = (e: PointerEvent) => {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = null;
      if (this.drag?.id === e.pointerId) this.drag = null;
      if (e.pointerType !== 'mouse') this.pointer = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => (this.pointer = null));
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.setFov(this.fov * Math.exp(e.deltaY * 0.0012));
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (this.root.dataset.mode !== 'deck') return;
      if (e.key === 'ArrowLeft') this.heading = (this.heading - 3 + 360) % 360;
      else if (e.key === 'ArrowRight') this.heading = (this.heading + 3) % 360;
      else if (e.key === '+' || e.key === '=') this.setFov(this.fov / 1.4);
      else if (e.key === '-' || e.key === '_') this.setFov(this.fov * 1.4);
      else if (e.key === 'Escape') this.leave();
      else return;
      this.turnTo = null;
    });
  }

  private setFov(f: number) {
    this.fov = Math.max(5, Math.min(90, f));
  }

  setLand(land: Land, coarse = false) {
    if (coarse) this.coarse = land;
    else this.fine = land;
    if (this.root.dataset.mode === 'deck') this.compute();
  }

  position(): [number, number] {
    return [this.lat, this.lon];
  }

  flash(msg: string) {
    this.toast.textContent = msg;
    this.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 2400);
  }

  private land(): Land | null {
    return this.fine ?? this.coarse;
  }

  /** Even-odd test against the land rings. */
  isLand(lat: number, lon: number): boolean {
    const land = this.land();
    if (!land) return false;
    const y = mercY(lat);
    // Rings may run past the antimeridian (see _landpack.ts), so try the point in each copy of the world.
    for (const shift of [0, 1, -1]) {
      const x = mercX(lon) + shift;
      let inside = false;
      for (const r of land.rings) {
        if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
        const xy = land.xy;
        for (let a = r.start, b = r.start + r.count - 1; a < r.start + r.count; b = a++) {
          const ya = xy[a * 2 + 1];
          const yb = xy[b * 2 + 1];
          if (ya > y !== yb > y && x < ((xy[b * 2] - xy[a * 2]) * (y - ya)) / (yb - ya) + xy[a * 2]) inside = !inside;
        }
      }
      if (inside) return true;
    }
    return false;
  }

  /** A spot at sea that looks at light i from inside its widest sector. */
  spotFor(i: number): { lat: number; lon: number; heading: number } | null {
    const L = this.lights;
    const sectors = L.sectors[L.sector[i]].filter((s) => s.colour);
    const range = Math.max(3, L.range[i] || 4);
    const geo = geographicRange(L.height[i] || 6, this.eye);
    const reach = Math.min(range, geo) * 0.9;
    const dirs: number[] = [];
    if (sectors.length) {
      const widest = [...sectors].sort((a, b) => span(b.from, b.to) - span(a.from, a.to));
      for (const s of widest) {
        const w = span(s.from, s.to);
        for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) dirs.push((s.from + w * f) % 360);
      }
    } else for (let a = 0; a < 360; a += 15) dirs.push(a);
    const dists = [0.45, 0.3, 0.65, 0.2, 0.85].map((f) => Math.max(0.6, reach * f));
    let best: { lat: number; lon: number; heading: number; score: number } | null = null;
    for (const d of dists) {
      for (const b of dirs) {
        // The vessel looks along b toward the light, so it lies on the reciprocal.
        const [lat, lon] = destination(L.lat[i], L.lon[i], (b + 180) % 360, d);
        if (this.isLand(lat, lon)) continue;
        // Prefer open water: count the sea around the spot.
        let sea = 0;
        for (let a = 0; a < 360; a += 45) {
          const [la, lo] = destination(lat, lon, a, Math.max(0.4, d * 0.4));
          if (!this.isLand(la, lo)) sea++;
        }
        const score = sea + (d === dists[0] ? 1 : 0);
        if (!best || score > best.score) best = { lat, lon, heading: b, score };
        if (sea === 8) return { lat, lon, heading: b };
      }
      if (best && best.score >= 6) break;
    }
    return best ? { lat: best.lat, lon: best.lon, heading: best.heading } : null;
  }

  enter(lat: number, lon: number, heading: number | null) {
    this.lat = lat;
    this.lon = lon;
    this.canvas.hidden = false;
    this.root.querySelector<HTMLElement>('[data-deckbar]')!.hidden = false;
    this.root.querySelector<HTMLElement>('[data-sight]')!.hidden = false;
    this.fov = window.innerWidth < 720 ? 48 : 64;
    this.compute();
    if (heading !== null) this.heading = heading;
    else {
      // Face the brightest light in sight, or the nearest coast.
      const top = [...this.seen].sort((a, b) => b.bright - a.bright)[0];
      this.heading = top ? top.brg : 0;
    }
    this.turnTo = null;
  }

  leave() {
    this.canvas.hidden = true;
    this.root.querySelector<HTMLElement>('[data-deckbar]')!.hidden = true;
    this.root.querySelector<HTMLElement>('[data-sight]')!.hidden = true;
    this.tip.hidden = true;
    this.onLeave();
  }

  /** Rasterises land around the boat, so each line of sight is a few pixel reads. */
  private buildMask() {
    const land = this.land();
    this.mask = null;
    if (!land) return;
    const c = document.createElement('canvas');
    c.width = MASK;
    c.height = MASK;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const k = MASK / (2 * MASK_NM);
    const cos = Math.cos((this.lat * Math.PI) / 180);
    const dLat = MASK_NM / 60;
    const dLon = MASK_NM / 60 / Math.max(0.05, cos);
    const x0 = mercX(this.lon - dLon);
    const x1 = mercX(this.lon + dLon);
    const y0 = mercY(this.lat + dLat);
    const y1 = mercY(this.lat - dLat);
    g.fillStyle = '#fff';
    g.beginPath();
    const xy = land.xy;
    for (const r of land.rings) {
      for (const shift of [-1, 0, 1]) {
        if (r.x1 + shift < x0 || r.x0 + shift > x1 || r.y1 < y0 || r.y0 > y1) continue;
        for (let p = 0; p < r.count; p++) {
          const lonP = (xy[(r.start + p) * 2] + shift) * 360 - 180;
          const latP = (Math.atan(Math.sinh(Math.PI * (1 - 2 * xy[(r.start + p) * 2 + 1]))) * 180) / Math.PI;
          const px = MASK / 2 + (lonP - this.lon) * 60 * cos * k;
          const py = MASK / 2 - (latP - this.lat) * 60 * k;
          if (p === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
      }
    }
    g.fill('evenodd');
    const img = g.getImageData(0, 0, MASK, MASK).data;
    this.mask = new Uint8Array(MASK * MASK);
    for (let p = 0; p < MASK * MASK; p++) this.mask[p] = img[p * 4] > 127 ? 1 : 0;
  }

  /** True when land lies between the boat and a point brg/nm away, near ends excepted. */
  private blocked(brg: number, nm: number): boolean {
    if (!this.mask) return false;
    const k = MASK / (2 * MASK_NM);
    const rad = (brg * Math.PI) / 180;
    const sx = Math.sin(rad);
    const sy = -Math.cos(rad);
    // The light stands on land itself, and charted coasts are only good to about a kilometre.
    const end = nm - Math.max(0.7, nm * 0.06);
    for (let d = 0.25; d < end && d < MASK_NM; d += 0.12) {
      const px = Math.round(MASK / 2 + sx * d * k);
      const py = Math.round(MASK / 2 + sy * d * k);
      if (px < 0 || py < 0 || px >= MASK || py >= MASK) return false;
      if (this.mask[py * MASK + px]) return true;
    }
    return false;
  }

  private compute() {
    this.buildMask();
    const L = this.lights;
    const seen: Seen[] = [];
    const dLat = 45 / 60;
    const dLon = 45 / 60 / Math.max(0.05, Math.cos((this.lat * Math.PI) / 180));
    for (let i = 0; i < L.n; i++) {
      if (!L.lit[i]) continue;
      if (Math.abs(L.lat[i] - this.lat) > dLat) continue;
      let dl = Math.abs(L.lon[i] - this.lon);
      if (dl > 180) dl = 360 - dl;
      if (dl > dLon) continue;
      const nm = distanceNm(this.lat, this.lon, L.lat[i], L.lon[i]);
      const brg = bearing(this.lat, this.lon, L.lat[i], L.lon[i]);
      let colour = L.colour[i];
      let nominal = L.range[i] || (L.floating[i] ? 3 : 5);
      const sectors = L.sectors[L.sector[i]];
      if (sectors.length) {
        const k = sectors.findIndex((s) => s === sectorAt(sectors, brg));
        if (k < 0 || !sectors[k].colour) continue;
        colour = COLOURS.indexOf(sectors[k].colour!) + 1;
        nominal = L.sectorRanges[L.sector[i]][k] || nominal;
      }
      const height = L.height[i] || (L.floating[i] ? 3 : 8);
      const geo = geographicRange(height, this.eye);
      if (nm > nominal * 1.15) continue;
      const loom = nm > geo;
      if (loom && nominal < 14) continue;
      if (!loom && this.blocked(brg, nm)) continue;
      const m = nm * 1852;
      // Angle above the sea horizon: the light's height over distance, less the
      // drop of the earth (with refraction) below the line of sight.
      const alt = loom
        ? 0
        : (Math.atan2(height - this.eye, m) * 180) / Math.PI -
          (m / (2 * 6371000 * 1.08)) * (180 / Math.PI) +
          dip(this.eye);
      const bright = Math.min(3.2, 0.12 * (nominal / Math.max(0.15, nm)) ** 2);
      seen.push({ i, nm, brg, colour, bright, alt: Math.max(0, alt), loom });
    }
    seen.sort((a, b) => a.brg - b.brg);
    this.seen = seen;
    this.renderList();
    this.root.querySelector('[data-deck-where]')!.textContent =
      `${formatPosition(this.lat, this.lon)}, eye ${this.eye} m above the water`;
  }

  private renderList() {
    const list = this.root.querySelector('[data-sight-list]')!;
    const none = this.root.querySelector<HTMLElement>('[data-sight-none]')!;
    const direct = this.seen.filter((s) => !s.loom);
    const looms = this.seen.filter((s) => s.loom);
    none.hidden = this.seen.length > 0;
    this.rows.clear();
    const make = (s: Seen) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const dot = document.createElement('i');
      dot.style.color = rgb(s.colour, 1);
      const name = document.createElement('span');
      name.textContent = this.names.get(s.i)?.[0] || '…';
      const em = document.createElement('em');
      em.textContent = `${String(Math.round(s.brg)).padStart(3, '0')}° ${s.nm < 10 ? s.nm.toFixed(1) : Math.round(s.nm)} M`;
      const small = document.createElement('small');
      const r = this.lights.rhythms[this.lights.rhythm[s.i]];
      small.textContent = s.loom ? `${r.label}, its loom only` : r.label;
      b.append(dot, name, em, small);
      b.addEventListener('click', () => (this.turnTo = s.brg));
      li.append(b);
      this.rows.set(s.i, dot);
      if (!this.names.has(s.i)) {
        this.details
          .get(s.i)
          .then((d) => {
            this.names.set(s.i, d);
            name.textContent = d[0] || 'Unnamed light';
          })
          .catch(() => (name.textContent = 'A light'));
      }
      return li;
    };
    // Nearest first reads best as a lookout's list; cap it so it stays a list.
    const sorted = [...direct].sort((a, b) => a.nm - b.nm).slice(0, 40);
    list.replaceChildren(...sorted.map(make), ...looms.slice(0, 8).map(make));
  }

  private makeSprites() {
    for (let c = 0; c < LIGHT_RGB.length; c++) {
      const s = document.createElement('canvas');
      s.width = s.height = 64;
      const g = s.getContext('2d')!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgb(255 255 255 / 1)');
      grad.addColorStop(0.06, rgb(c, 0.95));
      grad.addColorStop(0.2, rgb(c, 0.35));
      grad.addColorStop(0.5, rgb(c, 0.08));
      grad.addColorStop(1, rgb(c, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      this.sprites.push(s);
    }
  }

  draw(time: number) {
    const c = this.canvas;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(c.clientWidth * this.dpr);
    const H = Math.round(c.clientHeight * this.dpr);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    if (this.turnTo !== null) {
      let d = ((this.turnTo - this.heading + 540) % 360) - 180;
      if (Math.abs(d) < 0.2) {
        this.heading = this.turnTo;
        this.turnTo = null;
      } else {
        d *= 0.12;
        this.heading = (this.heading + d + 360) % 360;
      }
    }
    const g = this.ctx;
    const ppd = W / this.fov;
    const eyeY = H * 0.55;
    const horizonY = eyeY + dip(this.eye) * ppd;
    const rel = (brg: number) => ((brg - this.heading + 540) % 360) - 180;

    // Sky and sea.
    g.globalCompositeOperation = 'source-over';
    const sky = g.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, '#010204');
    sky.addColorStop(0.7, '#03070e');
    sky.addColorStop(1, '#0a1220');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, horizonY);
    const sea = g.createLinearGradient(0, horizonY, 0, H);
    sea.addColorStop(0, '#060c16');
    sea.addColorStop(0.08, '#03070d');
    sea.addColorStop(1, '#010205');
    g.fillStyle = sea;
    g.fillRect(0, horizonY, W, H - horizonY);

    // Stars: dimmer toward the horizon, where the air is thicker.
    for (const s of this.stars) {
      const r = rel(s.az);
      if (Math.abs(r) > this.fov / 2 + 1) continue;
      const x = W / 2 + r * ppd;
      const y = eyeY - s.alt * ppd;
      if (y < 0 || y > horizonY - 2) continue;
      const ext = Math.min(1, s.alt / 12);
      const a = (0.12 + 0.75 * s.m) * (0.35 + 0.65 * ext) * (0.85 + 0.15 * Math.sin(time * 2.3 + s.tw * 7));
      g.fillStyle = `rgb(220 226 240 / ${a.toFixed(3)})`;
      const size = (0.6 + s.m * 1.3) * this.dpr;
      g.fillRect(x - size / 2, y - size / 2, size, size);
    }

    // The sea's surface: faint swell lines, closer together toward the horizon.
    g.strokeStyle = 'rgb(140 170 200 / 0.035)';
    g.lineWidth = this.dpr;
    for (let k = 1; k < 26; k++) {
      const y = horizonY + (H - horizonY) * (k / 26) ** 2.2;
      g.beginPath();
      for (let x = 0; x <= W; x += 24 * this.dpr) {
        const yy =
          y + Math.sin(x / (90 * this.dpr) + time * 0.6 + k * 1.7 + this.heading * 0.05) * (0.5 + k * 0.12) * this.dpr;
        if (x === 0) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.stroke();
    }

    // Horizon.
    g.fillStyle = 'rgb(150 170 200 / 0.08)';
    g.fillRect(0, horizonY - this.dpr * 0.5, W, this.dpr);

    // Lights, nearest last so they sit over the far ones.
    g.globalCompositeOperation = 'lighter';
    const zoom = 64 / this.fov;
    const drawOrder = [...this.seen].sort((a, b) => b.nm - a.nm);
    let hover: Seen | null = null;
    let hoverD = 16 * this.dpr;
    for (const s of drawOrder) {
      const r = rel(s.brg);
      if (Math.abs(r) > this.fov / 2 + 4) continue;
      const L = this.lights;
      const rh = L.rhythms[L.rhythm[s.i]];
      const lv = levelAt(rh, time + L.phase[s.i]);
      const code = lv.code === 8 ? s.colour : lv.code;
      const x = W / 2 + r * ppd;
      const y = horizonY - s.alt * ppd;
      if (s.loom) {
        // The loom: a glow in the sky over a light still below the horizon.
        const a = 0.1 * lv.level * Math.min(1, s.bright * 4 + 0.4);
        const rad = (40 + 30 * Math.min(1, s.bright)) * this.dpr * Math.sqrt(zoom);
        g.globalAlpha = a;
        g.drawImage(this.sprites[code], x - rad, horizonY - rad * 0.55, rad * 2, rad * 1.1);
        g.globalAlpha = 1;
        continue;
      }
      const b = s.bright * lv.level;
      if (b <= 0.002) continue;
      const rad = (3 + 9 * Math.sqrt(Math.min(3, b))) * this.dpr * Math.min(2.5, Math.sqrt(zoom));
      g.globalAlpha = Math.min(1, 0.35 + b);
      g.drawImage(this.sprites[code], x - rad, y - rad, rad * 2, rad * 2);
      // Its path across the water toward the boat.
      const len = Math.min(H - y, (14 + 120 * Math.min(1, b)) * this.dpr * Math.sqrt(zoom));
      const segs = Math.max(4, Math.round(len / (5 * this.dpr)));
      g.fillStyle = rgb(code, 1);
      for (let k = 1; k < segs; k++) {
        const t = k / segs;
        const yy = y + 3 * this.dpr + t * len;
        const wob = Math.sin(time * 3.1 + k * 2.3 + s.i) * (1 + t * 5) * this.dpr;
        const w = (1 + t * 3.5) * this.dpr * Math.min(2, Math.sqrt(zoom));
        const a = (1 - t) * 0.22 * Math.min(1, b) * (0.5 + 0.5 * Math.sin(time * 5 + k * 1.3 + s.i * 0.7));
        g.globalAlpha = a;
        g.fillRect(x - w / 2 + wob, yy, w, 1.2 * this.dpr);
      }
      g.globalAlpha = 1;
      if (this.pointer) {
        const d = Math.hypot(this.pointer.x * this.dpr - x, this.pointer.y * this.dpr - y);
        if (d < hoverD) {
          hoverD = d;
          hover = s;
        }
      }
      const dot = this.rows.get(s.i);
      if (dot) dot.style.opacity = String(0.25 + 0.75 * lv.level);
    }
    g.globalCompositeOperation = 'source-over';

    this.drawTape(W, H, ppd, rel);
    this.showTip(hover, W);
  }

  private drawTape(W: number, H: number, ppd: number, rel: (b: number) => number) {
    const g = this.ctx;
    const d = this.dpr;
    const top = H - 46 * d;
    g.fillStyle = 'rgb(3 6 11 / 0.82)';
    g.fillRect(0, top, W, 46 * d);
    g.fillStyle = 'rgb(226 220 205 / 0.16)';
    g.fillRect(0, top, W, d);
    const step = this.fov > 40 ? 5 : this.fov > 15 ? 1 : 0.5;
    const labelEvery = this.fov > 40 ? 15 : this.fov > 15 ? 5 : 2;
    const start = Math.floor((this.heading - this.fov / 2) / step) * step;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    const names: Record<number, string> = {
      0: 'N',
      45: 'NE',
      90: 'E',
      135: 'SE',
      180: 'S',
      225: 'SW',
      270: 'W',
      315: 'NW',
    };
    for (let a = start; a <= this.heading + this.fov / 2 + step; a += step) {
      const b = ((a % 360) + 360) % 360;
      const x = W / 2 + rel(b) * ppd;
      const major = Math.abs(b / labelEvery - Math.round(b / labelEvery)) < 1e-6;
      g.fillStyle = `rgb(226 220 205 / ${major ? 0.55 : 0.25})`;
      g.fillRect(x - d / 2, top + 6 * d, d, (major ? 9 : 5) * d);
      if (major) {
        const n = names[Math.round(b)];
        g.font = `${n ? 500 : 400} ${11 * d}px ${getComputedStyle(this.root).getPropertyValue('--font-coast-mono') || 'monospace'}`;
        g.fillStyle = n ? 'rgb(226 220 205 / 0.85)' : 'rgb(226 220 205 / 0.5)';
        g.fillText(n ?? String(Math.round(b * 10) / 10).padStart(3, '0'), x, top + 19 * d);
      }
    }
    // Each light's bearing, marked on the tape.
    for (const s of this.seen) {
      const x = W / 2 + rel(s.brg) * ppd;
      if (x < 0 || x > W) continue;
      g.fillStyle = rgb(s.colour, s.loom ? 0.35 : 0.85);
      g.beginPath();
      g.moveTo(x, top + 1 * d);
      g.lineTo(x - 3 * d, top - 4 * d);
      g.lineTo(x + 3 * d, top - 4 * d);
      g.fill();
    }
    // Lubber line and heading.
    g.fillStyle = 'rgb(255 217 138 / 0.9)';
    g.fillRect(W / 2 - d, top - 8 * d, 2 * d, 22 * d);
    g.font = `500 ${12 * d}px ${getComputedStyle(this.root).getPropertyValue('--font-coast-mono') || 'monospace'}`;
    g.fillStyle = 'rgb(255 217 138 / 0.95)';
    g.fillText(`${String(Math.round(this.heading) % 360).padStart(3, '0')}°`, W / 2, top + 32 * d);
  }

  private showTip(s: Seen | null, W: number) {
    if (!s || !this.pointer) {
      this.tip.hidden = true;
      return;
    }
    const L = this.lights;
    const r = L.rhythms[L.rhythm[s.i]];
    const d = this.names.get(s.i);
    const key = `${s.i}`;
    if (this.tip.dataset.for !== key) {
      this.tip.dataset.for = key;
      this.tip.replaceChildren();
      const name = document.createElement('span');
      name.textContent = d?.[0] || '…';
      const i = document.createElement('i');
      i.textContent = r.label;
      const small = document.createElement('small');
      small.textContent = `${s.nm < 10 ? s.nm.toFixed(1) : Math.round(s.nm)} miles, bearing ${String(Math.round(s.brg)).padStart(3, '0')}°`;
      this.tip.append(name, i, small);
    }
    this.tip.hidden = false;
    const x = Math.min(this.pointer.x + 14, W / this.dpr - 220);
    this.tip.style.translate = `${x}px ${this.pointer.y + 14}px`;
  }
}
