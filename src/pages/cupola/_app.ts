// Wires the page: the station's orbit, the eye at the window, the picture
// levels, the readouts, and the ground track map.

import { loadTle, Orbit, type Fix, type TleSource } from './_orbit';
import { GLOBAL, Renderer, TILE } from './_render';
import { Tiles } from './_tiles';
import {
  add,
  cross,
  dot,
  gmst,
  latLon,
  moonDir,
  norm,
  R_EARTH,
  scale,
  subsolar,
  sunDir,
  toEarth,
  type Vec3,
} from './_sky';
import { Where } from './_places';

const D = Math.PI / 180;
/** Lenses on a full-frame camera, as the crew use: the field across the long side of the frame. */
const fovOf = (mm: number) => 2 * Math.atan(18 / mm);
const DEFAULT_LOOK = { yaw: 0, pitch: -36 };
const DAY_EXPOSURE = 5.2;
const NIGHT_EXPOSURE = 150;

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The day of pictures to show: yesterday (UTC), or the day before in the early hours while yesterday's last swaths are still being processed. */
function pictureDay(now: number): string {
  const d = new Date(now - (new Date(now).getUTCHours() < 6 ? 2 : 1) * 86400000);
  return d.toISOString().slice(0, 10);
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Rotate v about the unit axis k by angle a (Rodrigues). */
const rotate = (v: Vec3, k: Vec3, a: number): Vec3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
};

/** A plain world, drawn here, for the moments before the pictures arrive (or if they never do). */
function plainWorld(land: Path2D): { day: HTMLCanvasElement; aux: HTMLCanvasElement } {
  const w = GLOBAL.cols * TILE;
  const h = GLOBAL.rows * TILE;
  const k = w / 360;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const day = make();
  const g = day.getContext('2d')!;
  g.fillStyle = '#0d2a4a';
  g.fillRect(0, 0, w, h);
  const drawLand = (ctx: CanvasRenderingContext2D) => {
    for (const shift of [-360, 0, 360]) {
      ctx.setTransform(k, 0, 0, k, (180 + shift) * k, 90 * k);
      ctx.fill(land);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };
  g.fillStyle = '#56603f';
  drawLand(g);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = '#e8edf2';
  g.fillRect(0, (90 + 62) * k, w, h);
  g.fillRect((180 - 55) * k, 0, 35 * k, (90 - 60) * k);
  g.globalCompositeOperation = 'source-over';
  const aux = make();
  const a = aux.getContext('2d')!;
  a.fillStyle = '#000';
  a.fillRect(0, 0, w, h);
  a.globalCompositeOperation = 'destination-out';
  drawLand(a);
  return { day, aux };
}

export function start(root: HTMLElement) {
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const canvas = $<HTMLCanvasElement>('[data-view]');
  const notice = $('[data-notice]');
  const say = (text: string) => {
    notice.textContent = text;
    notice.hidden = !text;
  };

  const debug = new URLSearchParams(location.search).has('debug');
  const big = Math.max(screen.width, screen.height) * Math.min(devicePixelRatio, 2) > 1500;
  const n = big ? 4 : 3;
  let renderer: Renderer;
  try {
    renderer = new Renderer(canvas, n);
  } catch (err) {
    root.dataset.state = 'unsupported';
    say('This window needs WebGL 2, which this browser doesn’t offer.');
    if (debug) console.error(err);
    return;
  }

  const landPath = new Path2D(root.querySelector('[data-land]')?.getAttribute('d') ?? '');
  const plain = plainWorld(landPath);
  renderer.globalImage('day', plain.day);
  renderer.globalImage('aux', plain.aux);

  const whereData = JSON.parse(root.querySelector('[data-where]')?.textContent ?? '{}') as { names: string[]; rows: string };
  const where = new Where(whereData.names, whereData.rows);

  const date = pictureDay(Date.now());
  const tiles = new Tiles(renderer, n, date);
  let plainOnly = false;
  tiles.onGlobalFailure = () => {
    plainOnly = true;
    say('NASA’s picture service isn’t answering, so this is a plain map of the land, without clouds.');
  };
  $('[data-day]').textContent = fmtDay(date);

  // Time: the sim clock runs at `speed` from a base, so time-lapse and Live can hand over cleanly.
  let speed = 1;
  let baseSim = Date.now();
  let baseReal = performance.now();
  const simNow = () => baseSim + (performance.now() - baseReal) * speed;
  const setSpeed = (s: number) => {
    baseSim = s === 1 && speed !== 1 ? Date.now() : simNow();
    baseReal = performance.now();
    speed = s;
    tiles.finest = s >= 60 ? 0 : s >= 10 ? 1 : 2;
    root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s));
    });
    root.dataset.live = String(s === 1);
  };

  // The eye: yaw from the station's direction of travel, pitch from the horizontal.
  const look = { ...DEFAULT_LOOK };
  let fov = fovOf(28);
  const setLens = (mm: number) => {
    fov = fovOf(mm);
    syncLens();
  };
  const syncLens = () => {
    root.querySelectorAll<HTMLButtonElement>('[data-lens]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Math.abs(fovOf(Number(b.dataset.lens)) - fov) < 0.01));
    });
  };

  let orbit: Orbit | null = null;
  let source: TleSource = 'baked';
  let fix: Fix | null = null;
  let exposure = DAY_EXPOSURE;
  let lastFrame = performance.now();
  let renderScale = 1;
  let frameAvg = 16;

  const resize = () => {
    const dpr = Math.min(devicePixelRatio, 2) * renderScale;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };
  new ResizeObserver(resize).observe(canvas);

  const basis = (f: Fix) => {
    const flat = rotate(f.ahead, f.up, -look.yaw * D);
    const p = look.pitch * D;
    const fwd = norm(add(scale(flat, Math.cos(p)), scale(f.up, Math.sin(p))));
    const up = norm(add(scale(flat, -Math.sin(p)), scale(f.up, Math.cos(p))));
    const right = norm(cross(fwd, up));
    return { fwd, up, right };
  };

  const aspectTans = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const t = Math.tan(fov / 2);
    return w >= h ? { tanX: t, tanY: (t * h) / w } : { tanX: (t * w) / h, tanY: t };
  };

  /** The point on the ground under a direction from the station, or null if it misses the Earth. */
  const groundUnder = (pos: Vec3, d: Vec3): Vec3 | null => {
    const b = dot(pos, d);
    const c = dot(pos, pos) - R_EARTH * R_EARTH;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t > 0 ? add(pos, scale(d, t)) : null;
  };

  /** Share of the frame, 0 to 1, that is sunlit ground, lit sky, or the sun itself, from a coarse grid of rays. */
  const daylightInView = (f: Fix, b: { fwd: Vec3; up: Vec3; right: Vec3 }, sun: Vec3, tanX: number, tanY: number) => {
    let sum = 0;
    let weight = 0;
    for (let j = 0; j < 5; j++)
      for (let i = 0; i < 7; i++) {
        const x = -1 + (2 * (i + 0.5)) / 7;
        const y = -1 + (2 * (j + 0.5)) / 5;
        const d = norm(add(add(b.fwd, scale(b.right, x * tanX)), scale(b.up, y * tanY)));
        const hit = groundUnder(f.pos, d);
        if (hit) {
          sum += smooth(-0.12, 0.08, dot(norm(hit), sun));
          weight += 1;
          continue;
        }
        // Sky: lit only where the ray grazes sunlit air.
        const tc = -dot(f.pos, d);
        const p = add(f.pos, scale(d, tc));
        const h = Math.hypot(...p) - R_EARTH;
        if (tc > 0 && h < 100) {
          sum += 0.8 * smooth(-0.2, 0.05, dot(norm(p), sun));
          weight += 1;
        } else weight += 0.35;
      }
    let lit = weight ? sum / weight : 0;
    const toSun = Math.acos(clamp(dot(b.fwd, sun), -1, 1));
    if (toSun < Math.atan(Math.hypot(tanX, tanY)) && !groundUnder(f.pos, sun)) lit = Math.max(lit, 0.85);
    return lit;
  };

  // Focus of each window level: where the eye is looking, held within reach of the level's detail.
  const REACH = [1900, 650, 320];
  const focusPoints = (f: Fix, fwd: Vec3) => {
    let centre = groundUnder(f.pos, fwd);
    if (!centre) {
      // Looking above the horizon: take the horizon point in that direction.
      const flat = norm(add(fwd, scale(f.up, -dot(fwd, f.up))));
      const reach = Math.acos(R_EARTH / (R_EARTH + f.alt));
      centre = scale(add(scale(f.up, Math.cos(reach)), scale(flat, Math.sin(reach))), R_EARTH);
    }
    const c = norm(centre);
    const angle = Math.acos(clamp(dot(c, f.up), -1, 1));
    return REACH.map((km) => {
      const max = km / R_EARTH;
      if (angle <= max) return latLon(c);
      const axis = norm(cross(f.up, c));
      return latLon(rotate(f.up, axis, max));
    });
  };

  // Readouts.
  const el = {
    time: $('[data-time]'),
    clockDate: $('[data-date]'),
    next: $('[data-next]'),
    over: $('[data-over]'),
    latlon: $('[data-latlon]'),
    alt: $('[data-alt]'),
    speed: $('[data-speedo]'),
    station: $<SVGCircleElement>('[data-station]'),
    ahead: $<SVGPathElement>('[data-ahead]'),
    past: $<SVGPathElement>('[data-past]'),
    night: $<SVGPathElement>('[data-night]'),
    source: $('[data-source]'),
  };
  let next: { at: number; to: 'light' | 'dark' } | null = null;
  let nextChecked = 0;

  const fmtLat = (v: number) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'N' : 'S'}`;
  const fmtLon = (v: number) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'E' : 'W'}`;

  const trackPath = (pts: { lat: number; lon: number }[]) => {
    let d = '';
    let prev: number | null = null;
    for (const p of pts) {
      const jump = prev !== null && Math.abs(p.lon - prev) > 180;
      d += `${d && !jump ? 'L' : 'M'}${p.lon.toFixed(1)} ${(-p.lat).toFixed(1)}`;
      prev = p.lon;
    }
    return d;
  };

  const nightPath = (t: number) => {
    const s = subsolar(t);
    const lat0 = Math.abs(s.lat) < 0.05 ? 0.05 * Math.sign(s.lat || 1) : s.lat;
    const tanS = Math.tan(lat0 * D);
    let d = '';
    for (let lon = -180; lon <= 180; lon += 3) {
      const lat = Math.atan(-Math.cos((lon - s.lon) * D) / tanS) / D;
      d += `${d ? 'L' : 'M'}${lon} ${(-lat).toFixed(2)}`;
    }
    const pole = lat0 > 0 ? 90 : -90;
    return `${d}L180 ${pole}L-180 ${pole}Z`;
  };

  const hud = (t: number, f: Fix) => {
    const dt = new Date(t);
    el.time.textContent = `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
    el.clockDate.textContent = dt.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    el.over.textContent = where.at(f.lat, f.lon);
    el.latlon.textContent = `${fmtLat(f.lat)}  ${fmtLon(f.lon)}`;
    el.alt.textContent = `${Math.round(f.height)} km up`;
    el.speed.textContent = `${Math.round(f.speed * 3600).toLocaleString('en-GB')} km/h`;
    if (!next || t > next.at || Math.abs(t - nextChecked) > 30000 * speed) {
      next = orbit!.nextChange(t);
      nextChecked = t;
    }
    if (next) {
      const s = Math.max(0, (next.at - t) / 1000);
      el.next.textContent = `${next.to === 'light' ? 'Sunrise' : 'Sunset'} in ${pad(s / 60)}:${pad(s % 60)}`;
    }
    root.dataset.dark = String(f.dark);
    el.station.setAttribute('cx', f.lon.toFixed(2));
    el.station.setAttribute('cy', (-f.lat).toFixed(2));
  };

  let mapAt = 0;
  const map = (t: number) => {
    if (!orbit) return;
    el.past.setAttribute('d', trackPath(orbit.track(t - 46 * 60000, t, 30000)));
    el.ahead.setAttribute('d', trackPath(orbit.track(t, t + 92 * 60000, 30000)));
    el.night.setAttribute('d', nightPath(t));
  };

  // Look around: drag, arrow keys, wheel or pinch for the lens.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured.
    }
    root.dataset.dragging = 'true';
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = e.clientX;
      p.y = e.clientY;
      const [a2, b2] = [...pointers.values()];
      const after = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      if (pinch && before > 0) fov = clamp(fov * (before / after), fovOf(50), fovOf(14));
      pinch = after;
      syncLens();
      return;
    }
    const k = (fov / Math.max(canvas.clientWidth, canvas.clientHeight)) / D;
    look.yaw = (((look.yaw - (e.clientX - p.x) * k + 540) % 360) + 360) % 360 - 180;
    look.pitch = clamp(look.pitch + (e.clientY - p.y) * k, -90, 30);
    p.x = e.clientX;
    p.y = e.clientY;
  });
  const lift = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = 0;
    if (!pointers.size) delete root.dataset.dragging;
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      fov = clamp(fov * Math.exp(e.deltaY * 0.0012), fovOf(50), fovOf(14));
      syncLens();
    },
    { passive: false },
  );
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
    const step = e.shiftKey ? 10 : 3;
    if (e.key === 'ArrowLeft') look.yaw -= step;
    else if (e.key === 'ArrowRight') look.yaw += step;
    else if (e.key === 'ArrowUp') look.pitch = clamp(look.pitch + step, -90, 30);
    else if (e.key === 'ArrowDown') look.pitch = clamp(look.pitch - step, -90, 30);
    else return;
    e.preventDefault();
  });

  root.querySelectorAll<HTMLButtonElement>('[data-lens]').forEach((b) =>
    b.addEventListener('click', () => setLens(Number(b.dataset.lens))),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) =>
    b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-look]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.look === 'down') Object.assign(look, { yaw: 0, pitch: -90 });
      else if (b.dataset.look === 'ahead') Object.assign(look, DEFAULT_LOOK);
      else Object.assign(look, { yaw: 180, pitch: -18 });
    }),
  );

  let hudAt = 0;
  let focusAt = 0;
  const frame = () => {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(0.25, (now - lastFrame) / 1000);
    frameAvg += (now - lastFrame - frameAvg) * 0.05;
    lastFrame = now;
    if (!orbit) return;
    const t = simNow();
    const f = orbit.at(t);
    if (!f) return;
    fix = f;
    const g = gmst(t);
    const sun = norm(toEarth(sunDir(t), g));
    const m = moonDir(t);
    const moonE = norm(toEarth(m.dir, g));
    const phase = (1 - dot(sunDir(t), m.dir)) / 2;
    const b = basis(f);
    const { tanX, tanY } = aspectTans();

    // Exposure follows how much daylight is in the frame, as a camera's meter would.
    const lit = daylightInView(f, b, sun, tanX, tanY);
    const target = Math.exp(Math.log(NIGHT_EXPOSURE) + (Math.log(DAY_EXPOSURE) - Math.log(NIGHT_EXPOSURE)) * lit ** 0.6);
    exposure = Math.exp(Math.log(exposure) + (Math.log(target) - Math.log(exposure)) * (1 - Math.exp(-dt / 1.2)));

    if (now - focusAt > 700) {
      focusAt = now;
      tiles.focus(focusPoints(f, b.fwd));
    }

    // Hold the frame rate by trading resolution, a little at a time.
    if (frameAvg > 24 && renderScale > 0.5) {
      renderScale = Math.max(0.5, renderScale * 0.9);
      frameAvg = 16;
      resize();
    } else if (frameAvg < 13 && renderScale < 1) {
      renderScale = Math.min(1, renderScale * 1.05);
      frameAvg = 16;
      resize();
    }

    renderer.draw(
      {
        cam: f.pos,
        right: b.right,
        up: b.up,
        fwd: b.fwd,
        tanX,
        tanY,
        sun,
        moon: moonE,
        moonLight: 0.007 * phase ** 1.5,
        exposure,
        time: (t / 1000) % 100000,
        gmst: g,
        pix: (2 * tanY) / canvas.height,
      },
      tiles.residency(),
      now,
    );

    if (now - hudAt > 200) {
      hudAt = now;
      hud(t, f);
    }
    if (now - mapAt > 4000 / Math.sqrt(speed)) {
      mapAt = now;
      map(t);
    }
  };

  setSpeed(1);
  syncLens();
  resize();
  requestAnimationFrame(frame);

  loadTle().then(({ lines, source: src }) => {
    orbit = new Orbit(lines);
    source = src;
    root.dataset.state = 'live';
    const age = (Date.now() - orbit.epoch) / 86400000;
    el.source.textContent =
      src === 'baked'
        ? `an element set from ${fmtDay(new Date(orbit.epoch).toISOString().slice(0, 10))}`
        : `CelesTrak’s latest element set, ${age < 1 ? `${Math.max(1, Math.round(age * 24))} hours` : `${Math.round(age)} days`} old`;
    if (src === 'baked' && age > 2)
      say(
        `The orbit services didn’t answer, so the station flies on an element set ${Math.round(age)} days old and may be some way off where it really is.`,
      );
    map(simNow());
  });

  // Auroras: NOAA SWPC's OVATION nowcast, the chance of aurora overhead on a 1° grid.
  fetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { coordinates?: [number, number, number][] } | null) => {
      if (!j?.coordinates) return;
      const grid = new Uint8Array(360 * 181);
      for (const [lon, lat, v] of j.coordinates) {
        const x = ((Math.round(lon) % 360) + 360) % 360;
        const y = Math.round(lat) + 90;
        if (y >= 0 && y <= 180) grid[y * 360 + x] = clamp(v, 0, 100);
      }
      renderer.aurora(grid);
      root.dataset.aurora = 'true';
    })
    .catch(() => {
      // No auroras, then; everything else carries on.
    });

  if (debug) {
    (window as unknown as { cupola: unknown }).cupola = {
      at: (ms: number) => {
        baseSim = ms;
        baseReal = performance.now();
      },
      speed: setSpeed,
      look: (yaw: number, pitch: number) => Object.assign(look, { yaw, pitch }),
      lens: setLens,
      finest: (k: number) => {
        tiles.finest = k;
      },
      fix: () => fix,
      state: () => ({ source, plainOnly, busy: tiles.busy, loaded: tiles.loaded, fresh: tiles.freshShare, exposure, renderScale }),
    };
  }
}
