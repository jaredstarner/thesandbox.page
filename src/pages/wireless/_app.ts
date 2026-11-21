// The set: a drum dial that turns under a fixed needle, a flywheel on the tuning, a magic eye that
// closes on a carrier, and the station indicator with its globe.

import data from './_stations.json';
import { Engine, type OnAir } from './_engine';
import { Globe } from './_globe';
import { carrierLon, towards, wrap } from './_tuning';

interface Station {
  id: string;
  name: string;
  url: string;
  tags: string[];
  cors: boolean;
}

interface City {
  name: string;
  cc: string;
  lat: number;
  lon: number;
  tz: string;
  stations: Station[];
}

interface Carrier {
  lon: number;
  city: number;
  station: number;
  dead: boolean;
}

/** How sharply a carrier tunes, in degrees: the width of its peak on the dial. */
const SIGMA = 0.14;
/** Within this many degrees of a city, the indicator names it. */
const CITY_REACH = 1.8;
const STORE = 'wireless:';
/** Turns of the tuning knob per degree of dial. */
const KNOB_RATIO = 18;

const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const clocks = new Map<string, Intl.DateTimeFormat>();

function clock(tz: string): Intl.DateTimeFormat {
  let f = clocks.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit' });
    clocks.set(tz, f);
  }
  return f;
}

function read(key: string): number | null {
  try {
    const v = localStorage.getItem(STORE + key);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function write(key: string, v: number) {
  try {
    localStorage.setItem(STORE + key, v.toFixed(3));
  } catch {}
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function fmtLon(lon: number): string {
  const a = Math.abs(lon);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  return `${d}° ${String(m).padStart(2, '0')}′ ${lon < 0 ? 'W' : 'E'}`;
}

/** Local mean time at a longitude: the sun's time there, before anyone drew zone boundaries. */
function meanTime(lon: number, now: Date): string {
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes() + lon * 4;
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function start(root: HTMLElement) {
  const cities = data.cities as City[];
  const carriers: Carrier[] = [];
  cities.forEach((c, ci) =>
    c.stations.forEach((_, si) =>
      carriers.push({ lon: carrierLon(c.lon, si, c.stations.length), city: ci, station: si, dead: false }),
    ),
  );

  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const win = q('.window');
  const drum = q('.drum');
  const print = q('.print');
  const eye = q('.eye');
  const statusEl = q('.status');
  const cityEl = q('.city');
  const whereEl = q('.where');
  const stationEl = q('.station');
  const power = q<HTMLButtonElement>('.power');
  const powerLabel = q('.power .label');
  const volKnob = q('.knob.volume');
  const toneKnob = q('.knob.tone');
  const tuneKnob = q('.knob.tuning');
  const canvas = q<HTMLCanvasElement>('.globe');
  const engine = new Engine(q<HTMLAudioElement>('.feed'), q<HTMLAudioElement>('.feed-raw'));
  const globe = new Globe(
    canvas,
    canvas.dataset.land ?? '',
    cities.map((c) => ({ lat: c.lat, lon: c.lon })),
  );

  root.dataset.js = '';
  // Three copies of the printed strip side by side, so the drum turns all the way round.
  const before = print.cloneNode(true) as HTMLElement;
  const after = print.cloneNode(true) as HTMLElement;
  before.setAttribute('aria-hidden', 'true');
  after.setAttribute('aria-hidden', 'true');
  drum.prepend(before);
  drum.append(after);
  const marks = carriers.map((_, k) => Array.from(drum.querySelectorAll(`[data-carrier="${k}"]`)));

  let K = print.offsetWidth / 360;

  const nearest = (lon: number, withDead = false) => {
    let best = -1;
    let bd = Infinity;
    for (let k = 0; k < carriers.length; k++) {
      if (carriers[k].dead && !withDead) continue;
      const d = towards(lon, carriers[k].lon);
      if (Math.abs(d) < Math.abs(bd)) {
        bd = d;
        best = k;
      }
    }
    return best < 0 ? null : { k: best, d: bd };
  };

  const nearestCity = (lon: number) => {
    let best = -1;
    let bd = CITY_REACH;
    cities.forEach((c, i) => {
      const d = Math.abs(towards(lon, c.lon));
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best < 0 ? null : best;
  };

  // Open on the visitor's own meridian, as near as their clock says, unless they've tuned before.
  const saved = read('pos');
  const home = -new Date().getTimezoneOffset() / 4;
  let pos = wrap(saved ?? carriers[nearest(home)?.k ?? 0].lon);
  let vel = 0;
  let target: number | null = null;
  let on = false;
  let warmFrom = 0;
  let volume = clamp01(read('volume') ?? 0.6);
  let tone = clamp01(read('tone') ?? 0.45);
  let current: number | null = null;
  let settle = 0;
  let away = 0;
  let eyeGap = 110;
  let glow = 0;
  let field = { s: 0, d: 0, has: false };
  let savedPos = pos;
  let lastSave = 0;
  let lastReadout = 0;
  let globeAt = { lon: NaN, lat: NaN, t: 0 };
  let globeLat = 18;

  engine.setVolume(volume);
  engine.setTone(tone);

  const turn = (knob: HTMLElement, deg: number) => knob.querySelector<HTMLElement>('.turn')!.style.setProperty('--turn', `${deg}deg`);
  const showVolume = () => {
    turn(volKnob, -135 + 270 * volume);
    volKnob.setAttribute('aria-valuenow', String(Math.round(volume * 100)));
  };
  const showTone = () => {
    turn(toneKnob, -135 + 270 * tone);
    toneKnob.setAttribute('aria-valuenow', String(Math.round(tone * 100)));
    toneKnob.setAttribute('aria-valuetext', tone < 0.33 ? 'Mellow' : tone < 0.66 ? 'Even' : 'Bright');
  };
  showVolume();
  showTone();

  function render() {
    const W = 360 * K;
    const x = win.clientWidth / 2 - (pos + 180) * K - W;
    drum.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
    turn(tuneKnob, (pos * KNOB_RATIO) % 360);
  }

  function setLive(k: number | null) {
    for (const list of marks) for (const m of list) m.classList.remove('live');
    if (k !== null) for (const m of marks[k]) m.classList.add('live');
  }

  function tune(k: number) {
    current = k;
    away = 0;
    setLive(null);
    const c = cities[carriers[k].city];
    const st = c.stations[carriers[k].station];
    void engine.play({ id: st.id, url: st.url, cors: st.cors });
  }

  engine.onState = (state: OnAir) => {
    root.dataset.air = state;
    if (state === 'failed' && current !== null) {
      carriers[current].dead = true;
      for (const m of marks[current]) {
        m.classList.remove('live');
        m.classList.add('dead');
      }
      current = null;
      settle = 0;
    } else if (state === 'playing' && current !== null) {
      setLive(current);
      announce(current);
    } else if (state === 'idle') {
      setLive(null);
    }
    lastReadout = 0;
  };

  function announce(k: number) {
    if (!('mediaSession' in navigator)) return;
    const c = cities[carriers[k].city];
    const st = c.stations[carriers[k].station];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: st.name,
        artist: `${c.name}, ${regions.of(c.cc) ?? c.cc}`,
        album: 'Wireless · thesandbox.page',
      });
      navigator.mediaSession.playbackState = 'playing';
    } catch {}
  }

  async function switchOn() {
    if (on) return;
    on = true;
    warmFrom = performance.now();
    root.dataset.state = 'on';
    power.setAttribute('aria-pressed', 'true');
    powerLabel.textContent = 'Off';
    settle = 0;
    current = null;
    lastReadout = 0;
    await engine.powerOn();
  }

  function switchOff() {
    if (!on) return;
    on = false;
    root.dataset.state = 'off';
    power.setAttribute('aria-pressed', 'false');
    powerLabel.textContent = 'On';
    engine.powerOff();
    current = null;
    setLive(null);
    lastReadout = 0;
    try {
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
    } catch {}
  }

  power.addEventListener('click', () => (on ? switchOff() : void switchOn()));

  if ('mediaSession' in navigator) {
    const actions: [MediaSessionAction, () => void][] = [
      ['play', () => void switchOn()],
      ['pause', switchOff],
      ['stop', switchOff],
      ['nexttrack', () => seek(1)],
      ['previoustrack', () => seek(-1)],
    ];
    for (const [action, fn] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch {}
    }
  }

  /** Glide to the next station east or west that's still answering. */
  function seek(dir: 1 | -1) {
    let best: number | null = null;
    for (const c of carriers) {
      if (c.dead) continue;
      let d = towards(pos, c.lon);
      if (dir > 0 && d <= 0.25) d += 360;
      if (dir < 0 && d >= -0.25) d -= 360;
      if (best === null || Math.abs(d) < Math.abs(best)) best = d;
    }
    if (best === null) return;
    target = wrap(pos + best);
    vel = 0;
  }

  q('.seek .west').addEventListener('click', () => seek(-1));
  q('.seek .east').addEventListener('click', () => seek(1));

  // Dragging the glass: the scale follows the finger, and a flick sets the flywheel spinning.
  let drag: { id: number; x: number; samples: [number, number][] } | null = null;
  win.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, samples: [[e.timeStamp, e.clientX]] };
    try {
      win.setPointerCapture(e.pointerId);
    } catch {}
    win.classList.add('dragging');
    vel = 0;
    target = null;
  });
  win.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    drag.x = e.clientX;
    pos = wrap(pos - dx / K);
    drag.samples.push([e.timeStamp, e.clientX]);
    while (drag.samples.length > 2 && e.timeStamp - drag.samples[0][0] > 90) drag.samples.shift();
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const s = drag.samples;
    const [t0, x0] = s[0];
    const [t1, x1] = s[s.length - 1];
    if (t1 - t0 > 8 && e.timeStamp - t1 < 60) {
      const pxPerS = ((x1 - x0) / (t1 - t0)) * 1000;
      vel = Math.max(-90, Math.min(90, -pxPerS / K));
    }
    drag = null;
    win.classList.remove('dragging');
  };
  win.addEventListener('pointerup', endDrag);
  win.addEventListener('pointercancel', endDrag);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    pos = wrap(pos + delta * (e.deltaMode === 1 ? 0.3 : 0.01));
    vel = 0;
    target = null;
  };
  win.addEventListener('wheel', onWheel, { passive: false });
  tuneKnob.addEventListener('wheel', onWheel, { passive: false });

  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.05;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') pos = wrap(pos + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') pos = wrap(pos - step);
    else if (e.key === 'PageDown' || e.key === ']') seek(1);
    else if (e.key === 'PageUp' || e.key === '[') seek(-1);
    else return;
    e.preventDefault();
    if (!e.key.startsWith('Page') && e.key !== '[' && e.key !== ']') {
      vel = 0;
      target = null;
    }
  };
  win.addEventListener('keydown', onKey);
  tuneKnob.addEventListener('keydown', onKey);

  // Turning a knob: follow the pointer's angle around its centre.
  function rotary(knob: HTMLElement, onTurn: (deg: number) => void, onEnd?: (degPerS: number) => void) {
    const cap = knob.querySelector<HTMLElement>('.cap')!;
    let grip: { id: number; a: number; samples: [number, number][]; total: number } | null = null;
    const angle = (e: PointerEvent) => {
      const r = cap.getBoundingClientRect();
      return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
    };
    knob.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      grip = { id: e.pointerId, a: angle(e), samples: [[e.timeStamp, 0]], total: 0 };
      try {
        knob.setPointerCapture(e.pointerId);
      } catch {}
      knob.focus({ preventScroll: true });
      e.preventDefault();
    });
    knob.addEventListener('pointermove', (e) => {
      if (!grip || e.pointerId !== grip.id) return;
      const a = angle(e);
      let d = a - grip.a;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      grip.a = a;
      grip.total += d;
      grip.samples.push([e.timeStamp, grip.total]);
      while (grip.samples.length > 2 && e.timeStamp - grip.samples[0][0] > 90) grip.samples.shift();
      onTurn(d);
    });
    const end = (e: PointerEvent) => {
      if (!grip || e.pointerId !== grip.id) return;
      const s = grip.samples;
      const [t0, a0] = s[0];
      const [t1, a1] = s[s.length - 1];
      if (onEnd && t1 - t0 > 8 && e.timeStamp - t1 < 60) onEnd(((a1 - a0) / (t1 - t0)) * 1000);
      grip = null;
    };
    knob.addEventListener('pointerup', end);
    knob.addEventListener('pointercancel', end);
  }

  rotary(
    tuneKnob,
    (d) => {
      pos = wrap(pos + d / KNOB_RATIO);
      vel = 0;
      target = null;
    },
    (degPerS) => {
      vel = Math.max(-60, Math.min(60, degPerS / KNOB_RATIO));
    },
  );
  rotary(volKnob, (d) => {
    volume = clamp01(volume + d / 270);
    engine.setVolume(volume);
    showVolume();
    write('volume', volume);
  });
  rotary(toneKnob, (d) => {
    tone = clamp01(tone + d / 270);
    engine.setTone(tone);
    showTone();
    write('tone', tone);
  });

  const smallKeys = (knob: HTMLElement, get: () => number, set: (v: number) => void) => {
    knob.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.2 : 0.05;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(clamp01(get() + step));
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(clamp01(get() - step));
      else return;
      e.preventDefault();
    });
    knob.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        set(clamp01(get() - Math.sign(e.deltaY) * 0.04));
      },
      { passive: false },
    );
  };
  smallKeys(
    volKnob,
    () => volume,
    (v) => {
      volume = v;
      engine.setVolume(v);
      showVolume();
      write('volume', v);
    },
  );
  smallKeys(
    toneKnob,
    () => tone,
    (v) => {
      tone = v;
      engine.setTone(v);
      showTone();
      write('tone', v);
    },
  );

  document.addEventListener('visibilitychange', () => {
    engine.setHidden(document.hidden);
    engine.field(field.s, field.d, field.has);
  });

  addEventListener('resize', () => {
    K = print.offsetWidth / 360;
    render();
  });

  function readout(now: Date) {
    const ci = nearestCity(pos);
    const any = nearest(pos, true);
    const onCarrier = any && Math.abs(any.d) < 0.3 ? any.k : null;
    const warming = on && performance.now() - warmFrom < 3200;
    let status: string;
    if (!on) status = 'Switched off';
    else if (warming) status = 'Warming up';
    else if (onCarrier !== null && carriers[onCarrier].dead) status = 'No answer';
    else if (current !== null && engine.onAir === 'loading') status = 'Tuning in';
    else if (engine.onAir === 'playing' && field.s > 0.3) status = 'On air';
    else status = 'Between stations';
    statusEl.textContent = status;

    if (ci !== null) {
      const c = cities[ci];
      cityEl.textContent = c.name;
      whereEl.textContent = `${regions.of(c.cc) ?? c.cc} · ${clock(c.tz).format(now)}`;
      let line: string;
      if (onCarrier !== null && carriers[onCarrier].city === ci) {
        const st = c.stations[carriers[onCarrier].station];
        line = st.tags.length ? `${st.name} · ${st.tags.join(', ')}` : st.name;
      } else {
        const live = carriers.filter((k) => k.city === ci && !k.dead).length;
        line =
          live === 0
            ? 'Nothing on air'
            : `${live} ${live === 1 ? 'station' : 'stations'} on the dial here`;
      }
      stationEl.textContent = on || onCarrier === null ? line : `${line}`;
    } else {
      cityEl.textContent = fmtLon(pos);
      whereEl.textContent = `Sun time ${meanTime(pos, now)}`;
      stationEl.textContent = 'Nothing on this stretch of the dial';
    }
    if (!on) stationEl.textContent = 'Press On, then turn the dial';
    win.setAttribute('aria-valuenow', pos.toFixed(1));
    win.setAttribute('aria-valuetext', ci !== null ? `${cities[ci].name}, ${fmtLon(pos)}` : fmtLon(pos));
  }

  let last = performance.now();
  function frame(t: number) {
    const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
    last = t;

    if (target !== null) {
      const diff = towards(pos, target);
      const step = diff * (1 - Math.exp(-dt * 5));
      const min = Math.sign(diff) * Math.min(Math.abs(diff), 1.2 * dt);
      pos = wrap(pos + (Math.abs(step) < Math.abs(min) ? min : step));
      if (Math.abs(towards(pos, target)) < 0.002) {
        pos = target;
        target = null;
      }
    } else if (!drag && vel !== 0) {
      pos = wrap(pos + vel * dt);
      vel *= Math.exp(-dt * 2.6);
      if (Math.abs(vel) < 0.03) vel = 0;
    }
    render();

    const n = nearest(pos);
    const s = n ? Math.exp(-((n.d / SIGMA) ** 2)) : 0;
    field = { s, d: n ? n.d : 0, has: !!n && Math.abs(n.d) < 1.2 };

    if (on) {
      const moving =
        drag !== null || Math.abs(vel) > 2.5 || (target !== null && Math.abs(towards(pos, target)) > 0.3);
      settle = n && Math.abs(n.d) < 0.42 && !moving ? settle + dt : 0;
      const warm = t - warmFrom > 1800;
      if (n && warm && settle > 0.2 && current !== n.k) tune(n.k);
      if (current !== null) {
        const dc = Math.abs(towards(pos, carriers[current].lon));
        away = dc > 0.8 ? away + dt : 0;
        if (away > 1.4) {
          engine.stop();
          current = null;
        }
      }
      engine.field(field.s, field.d, field.has);
    }

    // The eye: its cathode warms over a few seconds, then its shadow closes on a carrier.
    const glowTarget = on ? clamp01((t - warmFrom - 600) / 2400) : 0;
    glow += (glowTarget - glow) * (1 - Math.exp(-dt * (on ? 1.6 : 3)));
    const signal = on ? s * (engine.onAir === 'playing' ? 1 : 0.8) : 0;
    const shimmer = engine.onAir === 'playing' ? engine.level() * 26 : 0;
    const gapTarget = 112 - 104 * signal + shimmer;
    eyeGap += (gapTarget - eyeGap) * (1 - Math.exp(-dt * 9));
    eye.style.setProperty('--gap', `${eyeGap.toFixed(1)}deg`);
    eye.style.setProperty('--glow', glow.toFixed(3));

    const wall = Date.now();
    if (wall - lastReadout > 120) {
      lastReadout = wall;
      readout(new Date(wall));
    }

    const ci = nearestCity(pos);
    const latGoal = ci !== null ? Math.max(-50, Math.min(55, cities[ci].lat)) : 18;
    globeLat += (latGoal - globeLat) * (1 - Math.exp(-dt * 3));
    if (
      wall - globeAt.t > 60 &&
      (Math.abs(towards(globeAt.lon, pos)) > 0.2 || Math.abs(globeAt.lat - globeLat) > 0.2 || wall - globeAt.t > 30000)
    ) {
      globeAt = { lon: pos, lat: globeLat, t: wall };
      const here = ci !== null ? { lat: cities[ci].lat, lon: cities[ci].lon } : null;
      globe.draw(pos, globeLat, new Date(wall), here);
    }

    if (wall - lastSave > 1000 && Math.abs(towards(savedPos, pos)) > 0.01) {
      lastSave = wall;
      savedPos = pos;
      write('pos', pos);
    }

    requestAnimationFrame(frame);
  }

  render();
  readout(new Date());
  globe.draw(pos, globeLat, new Date(), null);
  requestAnimationFrame(frame);

  // A handle for checking the set from the console.
  (window as unknown as { wireless?: unknown }).wireless = {
    get pos() {
      return pos;
    },
    set pos(v: number) {
      pos = wrap(v);
      vel = 0;
      target = null;
    },
    get onAir() {
      return engine.onAir;
    },
    get current() {
      return current;
    },
    carriers,
    seek,
    engine,
  };
}
