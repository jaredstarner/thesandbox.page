// Waggle: a honeybee's dance floor and the valley round the hive.
//
// A forager dances on the comb; the player reads the dance, marks the map, and sends a bee.
// Straight up the comb stands for the sun, so the run's angle from vertical is the flowers'
// bearing from the sun's azimuth, and the run's duration says how far.

import { Comb, PAINT, type DanceSpec, type Run } from './_comb';
import { durationFor, flyDance, landDuration, searchRadius } from './_dance';
import {
  bearingOf,
  chooseDay,
  distToRing,
  EXTENT,
  fromBearing,
  makeLand,
  PLANTS,
  type Patch,
  type Pt,
  type Ring,
} from './_land';
import { MapView, type Flyer, type Overlay } from './_mapdraw';
import { Sound } from './_sound';
import { angleDiff, FIRST_DAY, formatClock, sunAt, type Sun } from './_sun';

type Stage = 'intro' | 'watch' | 'flight' | 'result' | 'dance' | 'recruits' | 'dusk';

interface Leg {
  to: Pt;
  ms: number;
  /** Circle round a point instead of flying straight. */
  spiral?: { c: Pt; r: number };
}

interface Trip {
  flyer: Flyer;
  from: Pt;
  legs: Leg[];
  leg: number;
  t: number;
  delay: number;
  done: boolean;
}

interface DiaryEntry {
  time: number;
  text: string;
  ok: boolean;
}

interface Round {
  feeder: boolean;
  patches: Patch[];
  specs: DanceSpec[];
  /** The sun's azimuth when the dancing began, which the dances were measured from. */
  sunAz: number;
}

const DAY_START = 8 * 60 + 20;
const DAY_END = 19 * 60;
const STORE = 'waggle:v1';

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass = (b: number) => COMPASS[Math.round(b / 45) % 8];
const fmtDist = (m: number) =>
  m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 3000 ? 2 : 1)} km`;
const fmtSecs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const sideOf = (deg: number) => (deg >= 0 ? 'right' : 'left');
const PAINT_NAMES: Record<string, string> = {
  [PAINT.white]: 'white',
  [PAINT.red]: 'red',
  [PAINT.green]: 'green',
  [PAINT.yellow]: 'yellow',
};

function load(): { tutorial: boolean; water: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '{}') as { tutorial?: boolean; water?: boolean };
    return { tutorial: !!v.tutorial, water: !!v.water };
  } catch {
    return { tutorial: false, water: false };
  }
}

function save(v: { tutorial: boolean; water: boolean }): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    // Storage can be unavailable; the page works without it.
  }
}

function circleRing(c: Pt, r: number): Ring {
  const ring: Ring = [];
  for (let k = 0; k < 20; k++) {
    const t = (k / 20) * Math.PI * 2;
    ring.push([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r]);
  }
  return ring;
}

export function start(root: HTMLElement): void {
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const combCanvas = $<HTMLCanvasElement>('[data-comb]');
  const mapCanvas = $<HTMLCanvasElement>('[data-map]');
  const combCtx = combCanvas.getContext('2d')!;
  const mapCtx = mapCanvas.getContext('2d')!;
  const ui = {
    day: $<HTMLElement>('[data-day]'),
    time: $<HTMLElement>('[data-time]'),
    loads: $<HTMLElement>('[data-loads]'),
    loadsWord: $<HTMLElement>('[data-loads-word]'),
    prompt: $<HTMLElement>('[data-prompt]'),
    slow: $<HTMLButtonElement>('[data-slow]'),
    sound: $<HTMLButtonElement>('[data-sound]'),
    watch: $<HTMLButtonElement>('[data-watch]'),
    watchRead: $<HTMLElement>('[data-watch-read]'),
    watchLabel: $<HTMLElement>('[data-watch-label]'),
    dancers: $<HTMLElement>('[data-dancers]'),
    you: $<HTMLElement>('[data-you]'),
    readout: $<HTMLElement>('[data-readout]'),
    send: $<HTMLButtonElement>('[data-send]'),
    result: $<HTMLElement>('[data-result]'),
    resultTitle: $<HTMLElement>('[data-result-title]'),
    resultLine: $<HTMLElement>('[data-result-line]'),
    resultLesson: $<HTMLElement>('[data-result-lesson]'),
    danceBtn: $<HTMLButtonElement>('[data-dance]'),
    next: $<HTMLButtonElement>('[data-next]'),
    intro: $<HTMLElement>('[data-intro]'),
    startBtn: $<HTMLButtonElement>('[data-start]'),
    dusk: $<HTMLElement>('[data-dusk]'),
    duskTitle: $<HTMLElement>('[data-dusk-title]'),
    duskLine: $<HTMLElement>('[data-dusk-line]'),
    diary: $<HTMLElement>('[data-diary]'),
    morning: $<HTMLButtonElement>('[data-morning]'),
  };

  const land = makeLand();
  const map = new MapView(land);
  const comb = new Comb();
  const sound = new Sound();
  const stored = load();
  const params = new URLSearchParams(location.search);

  let stage: Stage = 'intro';
  let day = 1;
  let clock = DAY_START;
  let loads = 0;
  let todays = chooseDay(land, day);
  let found: Patch[] = [];
  let roundNo = 0;
  let round: Round | null = null;
  let mark: Pt | null = null;
  let markDown = false;
  let trips: Trip[] = [];
  let reveal: Overlay['reveal'] = null;
  let diary: DiaryEntry[] = [];
  let watchOn = false;
  let watchMs = 0;
  let clockTarget: number | null = null;
  let tutorial = !stored.tutorial;
  let waterLesson = stored.water;
  let playerPatch: Patch | null = null;
  let feederPt: Pt | null = null;
  let lastHeader = '';

  const sun = (): Sun => sunAt(FIRST_DAY + day - 1, clock / 60);

  // ---------- sizing ----------

  const fit = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rc = combCanvas.getBoundingClientRect();
    if (rc.width > 0 && rc.height > 0) {
      combCanvas.width = Math.round(rc.width * dpr);
      combCanvas.height = Math.round(rc.height * dpr);
      comb.resize(rc.width, rc.height, dpr);
    }
    const rm = mapCanvas.getBoundingClientRect();
    if (rm.width > 0 && rm.height > 0) {
      mapCanvas.width = Math.round(rm.width * dpr);
      mapCanvas.height = Math.round(rm.height * dpr);
      map.resize(rm.width, rm.height, dpr);
    }
  };
  const ro = new ResizeObserver(fit);
  ro.observe(combCanvas);
  ro.observe(mapCanvas);
  fit();

  // ---------- stage and text ----------

  const setStage = (s: Stage) => {
    stage = s;
    root.dataset.stage = s;
    ui.send.hidden = !(s === 'watch' && mark);
    ui.readout.hidden = !((s === 'watch' && mark) || s === 'dance' || s === 'recruits');
    ui.result.hidden = s !== 'result';
    ui.dancers.hidden = !(s === 'watch' && round && round.specs.length > 1);
    ui.you.hidden = !(s === 'dance' || s === 'recruits');
    ui.watch.hidden = !(s === 'watch' || s === 'dance');
    ui.intro.hidden = s !== 'intro';
    ui.dusk.hidden = s !== 'dusk';
  };

  const say = (text: string) => {
    ui.prompt.textContent = text;
  };

  const updateHeader = () => {
    const key = `${day}|${Math.floor(clock)}|${loads}`;
    if (key === lastHeader) return;
    lastHeader = key;
    ui.day.textContent = `Day ${day}`;
    ui.time.textContent = formatClock(clock);
    ui.loads.textContent = String(loads);
    ui.loadsWord.textContent = loads === 1 ? 'load home' : 'loads home';
  };

  const describeMark = (m: Pt) => {
    const s = sun();
    const dist = Math.hypot(m[0], m[1]);
    const theta = angleDiff(bearingOf(m[0], m[1]), s.azimuth);
    const ms = waterLesson ? durationFor(land, m[0], m[1]) : landDuration(dist);
    return { dist, theta, ms };
  };

  const updateReadout = () => {
    if (stage !== 'watch' || !mark) return;
    const { dist, theta, ms } = describeMark(mark);
    ui.readout.innerHTML =
      `<b>${Math.abs(Math.round(theta))}°</b> ${sideOf(theta)} of the sun, <b>${fmtDist(dist)}</b> out<br>` +
      `danced as a <b>${fmtSecs(ms)}</b> run`;
  };

  // ---------- rounds ----------

  const specFor = (p: Patch, paint: string): DanceSpec => {
    const s = sun();
    return {
      angle: angleDiff(p.bearing, s.azimuth),
      durationMs: durationFor(land, p.center[0], p.center[1]),
      returnMs: 2500 - 1500 * p.plant.quality,
      paint,
      pollen: p.plant.pollen,
      spread: Math.max(3, (24 * 300) / (p.distance + 300)),
    };
  };

  const startRound = (forced?: Patch[]) => {
    mark = null;
    reveal = null;
    trips = [];
    playerPatch = null;
    comb.endPlayer();
    const s = sun();
    if (tutorial) {
      const bearing = (s.azimuth + 38 + 360) % 360;
      feederPt = fromBearing(bearing, 430);
      const feeder: Patch = {
        id: -1,
        plant: PLANTS.feeder,
        ring: circleRing(feederPt, 35),
        center: feederPt,
        distance: 430,
        bearing,
        water: 0,
      };
      round = { feeder: true, patches: [feeder], specs: [specFor(feeder, PAINT.yellow)], sunAz: s.azimuth };
      comb.setDances(round.specs);
      setStage('watch');
      const theta = Math.round(round.specs[0].angle);
      say(
        `Straight up the comb stands for the sun. The yellow-dotted forager runs ${Math.abs(theta)}° ${sideOf(theta)} of straight up, ` +
          `so her sugar water lies ${Math.abs(theta)}° ${sideOf(theta)} of the sun. Tap the blue feeder on the map, then send a bee.`,
      );
      return;
    }
    feederPt = null;
    roundNo++;
    const unfound = todays.filter((p) => !found.includes(p));
    const pool = unfound.length ? unfound : todays;
    const two = roundNo >= 3 && roundNo % 3 === 0 && unfound.length >= 2;
    const pickOne = (exclude: Patch | null) => {
      const options = pool.filter((p) => p !== exclude);
      // Lean toward nearer patches early in the day, farther ones later.
      options.sort((a, b) => a.distance - b.distance);
      const bias = Math.min(1, roundNo / 8);
      const idx = Math.min(options.length - 1, Math.floor(Math.pow(Math.random(), 1.4 - bias) * options.length));
      return options[idx];
    };
    const first = pickOne(null);
    const patches = forced ?? (two ? [first, pickOne(first)] : [first]);
    const paints = roundNo % 2 ? [PAINT.red, PAINT.yellow] : [PAINT.green, PAINT.white];
    const specs = patches.map((p, i) => specFor(p, paints[i]));
    round = { feeder: false, patches, specs, sunAz: s.azimuth };
    comb.setDances(specs);
    renderDancerChips();
    setStage('watch');
    if (patches.length > 1) {
      say(
        'Two foragers are dancing for different flowers. Read either one: tap a dancer to line your mark up against her.',
      );
    } else if (roundNo === 1) {
      say(
        'A forager is back from flowers nobody has seen yet. Time her straight runs, tap the map where you think she means, and line the blue arrow up with her runs.',
      );
    } else {
      say('Another forager is dancing. Read her straight runs, mark the map, and send a bee.');
    }
  };

  const renderDancerChips = () => {
    ui.dancers.replaceChildren();
    if (!round || round.specs.length < 2) return;
    round.specs.forEach((spec, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(i === comb.selected));
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = spec.paint;
      b.append(dot, `${PAINT_NAMES[spec.paint] ?? 'dotted'} dot`);
      b.addEventListener('click', () => selectDancer(i));
      ui.dancers.append(b);
    });
  };

  const selectDancer = (i: number) => {
    comb.selected = i;
    [...ui.dancers.children].forEach((c, j) => c.setAttribute('aria-pressed', String(j === i)));
  };

  // ---------- flights ----------

  const flySpeed = (dist: number) => 700 + dist * 0.85;

  const addTrip = (legs: Leg[], color: string, delay = 0) => {
    const trip: Trip = {
      flyer: { x: 0, y: 0, trail: [[0, 0]], color },
      from: [0, 0],
      legs,
      leg: 0,
      t: 0,
      delay,
      done: false,
    };
    trips.push(trip);
    return trip;
  };

  const stepTrips = (dt: number) => {
    for (const trip of trips) {
      if (trip.done) continue;
      if (trip.delay > 0) {
        trip.delay -= dt;
        continue;
      }
      trip.t += dt;
      let leg = trip.legs[trip.leg];
      while (leg && trip.t >= leg.ms) {
        trip.t -= leg.ms;
        trip.from = [trip.flyer.x, trip.flyer.y];
        trip.leg++;
        leg = trip.legs[trip.leg];
      }
      if (!leg) {
        trip.done = true;
        trip.flyer.x = 0;
        trip.flyer.y = 0;
        trip.flyer.trail.push([0, 0]);
        continue;
      }
      const k = Math.min(1, trip.t / leg.ms);
      let x: number;
      let y: number;
      if (leg.spiral) {
        const turns = 2.2;
        const a = k * Math.PI * 2 * turns;
        const r = leg.spiral.r * Math.sqrt(k);
        x = leg.spiral.c[0] + Math.cos(a) * r;
        y = leg.spiral.c[1] + Math.sin(a) * r;
      } else {
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        x = trip.from[0] + (leg.to[0] - trip.from[0]) * e;
        y = trip.from[1] + (leg.to[1] - trip.from[1]) * e;
      }
      trip.flyer.x = x;
      trip.flyer.y = y;
      const lastPt = trip.flyer.trail[trip.flyer.trail.length - 1];
      if (Math.hypot(x - lastPt[0], y - lastPt[1]) > 12) trip.flyer.trail.push([x, y]);
    }
  };

  const tripsDone = () => trips.every((t) => t.done);

  const sendBee = () => {
    if (stage !== 'watch' || !mark || !round) return;
    const m = mark;
    const dist = Math.hypot(m[0], m[1]);
    const r = searchRadius(dist);
    let hit: Patch | null = null;
    let best = Infinity;
    for (const p of round.patches) {
      const d = distToRing(m[0], m[1], p.ring);
      if (d <= r && d < best) {
        best = d;
        hit = p;
      }
    }
    const legs: Leg[] = [{ to: m, ms: flySpeed(dist) }];
    legs.push({ to: m, ms: 1500, spiral: { c: m, r } });
    if (hit) {
      const c = hit.center;
      const into: Pt = distToRing(m[0], m[1], hit.ring) === 0 ? m : nearestInside(hit, m);
      legs.push({ to: into, ms: 500 });
      legs.push({ to: into, ms: 700, spiral: { c: into, r: 18 } });
      legs.push({ to: [0, 0], ms: flySpeed(Math.hypot(c[0], c[1])) * 0.8 });
    } else {
      legs.push({ to: [0, 0], ms: flySpeed(dist) * 0.8 });
    }
    addTrip(legs, '#f0b23a');
    sound.takeoff();
    comb.clearDances();
    setStage('flight');
    say('Your bee flies the line, then circles round your mark searching for the scent...');
    // Out and back at about seven metres a second, plus time at the flowers or searching.
    const minutes = ((2 * dist) / 7 + (hit ? 600 : 300)) / 60;
    clockTarget = clock + minutes;
    pending = () => finishFlight(m, hit, r);
  };

  let pending: (() => void) | null = null;

  const nearestInside = (p: Patch, m: Pt): Pt => {
    // Walk from the mark toward the patch centre until inside.
    const [cx, cy] = p.center;
    for (let k = 0; k <= 1; k += 0.05) {
      const x = m[0] + (cx - m[0]) * k;
      const y = m[1] + (cy - m[1]) * k;
      if (distToRing(x, y, p.ring) === 0) return [x + (cx - x) * 0.15, y + (cy - y) * 0.15];
    }
    return p.center;
  };

  const finishFlight = (m: Pt, hit: Patch | null, r: number) => {
    if (!round) return;
    const az = round.sunAz;
    const wasTutorial = round.feeder;
    const target = hit ?? closestPatch(round.patches, m);
    const dist = target.distance;
    const theta = angleDiff(target.bearing, az);
    const err = Math.round(distToRing(m[0], m[1], target.ring));
    ui.resultLesson.hidden = true;
    ui.danceBtn.hidden = true;
    if (hit) {
      sound.found();
      reveal = { patch: hit, good: true };
      const gained = wasTutorial ? 4 : 8 + Math.round(hit.plant.quality * 14);
      loads += gained;
      if (!wasTutorial && !found.includes(hit)) found.push(hit);
      ui.resultTitle.textContent = wasTutorial ? 'Found the feeder' : `Found: ${hit.plant.name.toLowerCase()}`;
      ui.resultLine.textContent =
        `${fmtDist(dist)} out, ${Math.abs(Math.round(theta))}° ${sideOf(theta)} of the sun. ` +
        (err === 0
          ? 'Your mark landed right on them.'
          : `Your mark was ${fmtDist(err)} off, close enough to catch the scent.`) +
        ` +${gained} ${gained === 1 ? 'load' : 'loads'}.`;
      if (wasTutorial) {
        ui.resultLesson.hidden = false;
        ui.resultLesson.textContent =
          'That one you could see. From here on the flowers are hidden: all you have is the dance. Remember the run is measured from straight up, and up means the sun, wherever it is in the sky right now.';
        tutorial = false;
        save({ tutorial: true, water: waterLesson });
      } else {
        ui.danceBtn.hidden = false;
        if (round.patches.length > 1) {
          const other = round.patches.find((p) => p !== hit)!;
          const mine = round.specs[round.patches.indexOf(hit)];
          const theirs = round.specs[round.patches.indexOf(other)];
          const tempo = (sp: DanceSpec) => Math.round(15000 / (sp.durationMs + sp.returnMs));
          if (other.plant.quality > hit.plant.quality + 0.05) {
            ui.resultLesson.hidden = false;
            ui.resultLesson.textContent =
              `The ${PAINT_NAMES[theirs.paint]}-dotted forager was looping back faster, ${tempo(theirs)} circuits a quarter-minute to her sister's ${tempo(mine)}: ` +
              `her ${other.plant.noun} were the richer flowers. Bees put their effort where the dancing is liveliest.`;
          }
        }
      }
      diary.push({ time: clock, text: `${hit.plant.name}, ${fmtDist(dist)} ${compass(hit.bearing)}`, ok: true });
    } else {
      sound.miss();
      reveal = { patch: target, good: false };
      ui.resultTitle.textContent = 'Nothing there';
      ui.resultLine.textContent = `She was dancing for ${target.plant.noun}, ${fmtDist(dist)} out, ${Math.abs(Math.round(theta))}° ${sideOf(theta)} of the sun. Your mark was ${fmtDist(err)} away.`;
      const mDist = Math.hypot(m[0], m[1]);
      const mTheta = angleDiff(bearingOf(m[0], m[1]), az);
      const angleOff = Math.abs(angleDiff(mTheta, theta));
      let lesson = '';
      if (target.water > 150 && !waterLesson && mDist < dist * 0.9) {
        lesson =
          'She flew over the lake. A bee judges distance by how fast the ground slides past her eyes, and calm water barely seems to move, so the crossing counted for little and she danced it short. From now on the blue arrow on the comb allows for water.';
        waterLesson = true;
        save({ tutorial: true, water: true });
      } else if (angleOff > 18) {
        lesson = `Your mark was ${Math.round(angleOff)}° off her direction. Watch which way the straight run points against straight up, and remember the sun has moved since this morning.`;
      } else if (Math.abs(mDist - dist) > r) {
        lesson =
          mDist < dist
            ? 'Right direction, not far enough: her runs were longer than your mark would be danced.'
            : 'Right direction, too far: her runs were shorter than your mark would be danced.';
      }
      if (lesson) {
        ui.resultLesson.hidden = false;
        ui.resultLesson.textContent = lesson;
      }
      diary.push({ time: clock, text: `${target.plant.name}, ${fmtDist(dist)} ${compass(target.bearing)}`, ok: false });
    }
    playerPatch = hit && !wasTutorial ? hit : null;
    ui.next.textContent = clock >= DAY_END - 20 ? 'End the day' : 'Next forager';
    setStage('result');
    say(hit ? 'She is home with a full crop.' : 'She is home with nothing.');
  };

  const closestPatch = (patches: Patch[], m: Pt) => {
    let best = patches[0];
    let bd = Infinity;
    for (const p of patches) {
      const d = distToRing(m[0], m[1], p.ring);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };

  // ---------- the player's own dance ----------

  const startPlayerDance = () => {
    if (!playerPatch) return;
    mark = null;
    comb.startPlayer();
    setStage('dance');
    ui.you.textContent = 'Run 1 of 3';
    const p = playerPatch;
    const s = sun();
    const theta = angleDiff(p.bearing, s.azimuth);
    const ms = durationFor(land, p.center[0], p.center[1]);
    ui.readout.innerHTML =
      `<b>${Math.abs(Math.round(theta))}°</b> ${sideOf(theta)} of the sun, <b>${fmtDist(p.distance)}</b> out<br>` +
      `dance <b>${fmtSecs(ms)}</b> runs`;
    say(
      'Your turn. Press on the comb and drag the way to run, measured from straight up. Hold as long as the run should last, and let go to loop back. Three runs.',
    );
  };

  const onPlayerRun = (run: Run) => {
    const p = comb.player;
    if (!p) return;
    sound.tick();
    const n = p.runs.length;
    ui.you.textContent =
      `Run ${n}: ${Math.abs(Math.round(run.angle))}° ${sideOf(run.angle)} of up, ${fmtSecs(run.ms)}` +
      (n < 3 ? ` · run ${n + 1} of 3 next` : '');
    if (n >= 3) setTimeout(() => launchRecruits(p.runs.slice()), 900);
  };

  const launchRecruits = (runs: Run[]) => {
    if (stage !== 'dance' || !playerPatch) return;
    const patch = playerPatch;
    const s = sun();
    setStage('recruits');
    say('Your sisters have followed your runs and are flying where they told them...');
    const n = 8;
    let hits = 0;
    const r = searchRadius(patch.distance) * 0.8;
    for (let i = 0; i < n; i++) {
      // Each recruit follows a couple of runs and averages them, with her own small errors.
      const a = runs[i % runs.length];
      const b = runs[(i + 1) % runs.length];
      const angle = (a.angle + b.angle) / 2 + gaussish() * 6;
      const ms = ((a.ms + b.ms) / 2) * (1 + gaussish() * 0.06);
      const dest = flyDance(land, (s.azimuth + angle + 360) % 360, ms);
      const ok = distToRing(dest[0], dest[1], patch.ring) <= r;
      if (ok) hits++;
      const d = Math.hypot(dest[0], dest[1]);
      addTrip(
        [
          { to: dest, ms: flySpeed(d) },
          { to: dest, ms: 900, spiral: { c: dest, r: 30 } },
          { to: [0, 0], ms: flySpeed(d) * 0.8 },
        ],
        ok ? '#f0b23a' : '#c9b9a0',
        i * 160,
      );
      sound.takeoff(i * 0.16, 0.04);
    }
    comb.endPlayer();
    clockTarget = clock + ((2 * patch.distance) / 7 + 500) / 60;
    pending = () => {
      const gained = hits * 3;
      loads += gained;
      if (hits > 0) sound.found();
      else sound.miss();
      reveal = { patch, good: true };
      const avg = runs.reduce((acc, rn) => acc + rn.angle, 0) / runs.length;
      const want = angleDiff(patch.bearing, s.azimuth);
      const off = Math.round(angleDiff(avg, want));
      const avgMs = runs.reduce((acc, rn) => acc + rn.ms, 0) / runs.length;
      const wantMs = durationFor(land, patch.center[0], patch.center[1]);
      ui.resultTitle.textContent = hits === 0 ? 'Nobody found them' : `${hits} of ${n} found the ${patch.plant.noun}`;
      ui.resultLine.textContent =
        `Your runs pointed ${Math.abs(off) < 3 ? 'right at them' : `${Math.abs(off)}° ${off > 0 ? 'right' : 'left'} of them`} and lasted ${fmtSecs(avgMs)} against ${fmtSecs(wantMs)}.` +
        (gained ? ` +${gained} loads.` : '');
      ui.resultLesson.hidden = true;
      ui.danceBtn.hidden = true;
      diary.push({ time: clock, text: `Danced for ${patch.plant.noun}: ${hits} of ${n} followed`, ok: hits > n / 2 });
      playerPatch = null;
      ui.next.textContent = clock >= DAY_END - 20 ? 'End the day' : 'Next forager';
      setStage('result');
      say(hits > n / 2 ? 'Your sisters are working your flowers.' : 'Most of them came back with nothing.');
    };
  };

  const gaussish = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;

  // ---------- the end of the day ----------

  const endDay = () => {
    comb.clearDances();
    comb.endPlayer();
    setStage('dusk');
    ui.duskTitle.textContent = `Evening, day ${day}`;
    const ok = diary.filter((d) => d.ok).length;
    ui.duskLine.textContent =
      `${loads} ${loads === 1 ? 'load' : 'loads'} of nectar came home today, from ${found.length} ${found.length === 1 ? 'patch' : 'patches'} you read right. ` +
      (ok === diary.length && diary.length > 0
        ? 'Not a wasted flight all day.'
        : 'The foragers will dance again at first light.');
    ui.diary.replaceChildren(
      ...diary.map((d) => {
        const li = document.createElement('li');
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = formatClock(d.time);
        const w = document.createElement('span');
        w.textContent = d.text;
        const r = document.createElement('span');
        r.className = d.ok ? 'ok' : 'no';
        r.textContent = d.ok ? 'found' : 'missed';
        li.append(t, w, r);
        return li;
      }),
    );
    say('The light is going. The foragers are all home.');
  };

  const nextMorning = () => {
    day++;
    clock = DAY_START;
    loads = 0;
    found = [];
    diary = [];
    roundNo = 0;
    todays = chooseDay(land, day);
    startRound();
  };

  // ---------- input ----------

  const mapPoint = (e: PointerEvent): Pt => {
    const r = mapCanvas.getBoundingClientRect();
    const [x, y] = map.toWorld(e.clientX - r.left, e.clientY - r.top);
    const lim = EXTENT + 300;
    return [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, y))];
  };

  mapCanvas.addEventListener('pointerdown', (e) => {
    if (stage !== 'watch') return;
    markDown = true;
    try {
      mapCanvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured.
    }
    mark = mapPoint(e);
    setStage('watch');
    updateReadout();
  });
  mapCanvas.addEventListener('pointermove', (e) => {
    if (!markDown || stage !== 'watch') return;
    mark = mapPoint(e);
    updateReadout();
  });
  const mapUp = () => {
    markDown = false;
  };
  mapCanvas.addEventListener('pointerup', mapUp);
  mapCanvas.addEventListener('pointercancel', mapUp);

  const combPoint = (e: PointerEvent): [number, number] => {
    const r = combCanvas.getBoundingClientRect();
    return comb.toMm(e.clientX - r.left, e.clientY - r.top);
  };
  let combDown = false;
  combCanvas.addEventListener('pointerdown', (e) => {
    const [x, y] = combPoint(e);
    if (stage === 'watch' && round && round.specs.length > 1) {
      const i = comb.dancerAt(x, y);
      if (i >= 0) selectDancer(i);
      return;
    }
    if (stage !== 'dance') return;
    combDown = true;
    try {
      combCanvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured.
    }
    comb.press(x, y);
  });
  combCanvas.addEventListener('pointermove', (e) => {
    if (!combDown) return;
    const [x, y] = combPoint(e);
    comb.move(x, y);
  });
  const combUp = () => {
    if (!combDown) return;
    combDown = false;
    const run = comb.release();
    if (run) onPlayerRun(run);
  };
  combCanvas.addEventListener('pointerup', combUp);
  combCanvas.addEventListener('pointercancel', combUp);

  const watchStart = () => {
    if (watchOn) return;
    watchOn = true;
    watchMs = 0;
    ui.watch.setAttribute('aria-pressed', 'true');
    ui.watchLabel.textContent = 'Timing...';
  };
  const watchStop = () => {
    if (!watchOn) return;
    watchOn = false;
    ui.watch.setAttribute('aria-pressed', 'false');
    ui.watchLabel.textContent = 'Last run timed';
  };
  ui.watch.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      ui.watch.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured.
    }
    watchStart();
  });
  ui.watch.addEventListener('pointerup', watchStop);
  ui.watch.addEventListener('pointercancel', watchStop);
  ui.watch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      watchStart();
    }
  });
  ui.watch.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') watchStop();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
    if (e.key === ' ' && (stage === 'watch' || stage === 'dance')) {
      e.preventDefault();
      if (!e.repeat) watchStart();
    } else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey) {
      toggleSlow();
    } else if (e.key === 'Enter' && stage === 'watch' && mark) {
      sendBee();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') watchStop();
  });

  const toggleSlow = () => {
    comb.slow = !comb.slow;
    ui.slow.setAttribute('aria-pressed', String(comb.slow));
  };
  ui.slow.addEventListener('click', toggleSlow);
  ui.sound.addEventListener('click', () => {
    const on = ui.sound.getAttribute('aria-pressed') !== 'true';
    ui.sound.setAttribute('aria-pressed', String(on));
    sound.setEnabled(on);
  });
  ui.send.addEventListener('click', sendBee);
  ui.next.addEventListener('click', () => {
    if (clock >= DAY_END - 20) endDay();
    else startRound();
  });
  ui.danceBtn.addEventListener('click', startPlayerDance);
  ui.morning.addEventListener('click', nextMorning);
  ui.startBtn.addEventListener('click', () => {
    sound.start();
    startRound();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sound.suspend();
    else sound.resume();
  });

  // ---------- the loop ----------

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.max(0, Math.min(50, now - last));
    last = now;
    const scale = comb.slow ? 0.25 : 1;
    comb.update(dt * scale);
    if (watchOn) {
      watchMs += dt * scale;
      ui.watchRead.textContent = `${(watchMs / 1000).toFixed(2)} s`;
      ui.watch.style.setProperty('--hand', `${(watchMs / 1000) * 360}deg`);
    }
    if (stage === 'watch' || stage === 'dance') clock = Math.min(DAY_END + 30, clock + dt / 2500);
    if (trips.length) {
      stepTrips(dt);
      if (clockTarget !== null) {
        clock += (clockTarget - clock) * Math.min(1, dt / 600);
      }
      if (tripsDone() && pending) {
        const p = pending;
        pending = null;
        if (clockTarget !== null) clock = clockTarget;
        clockTarget = null;
        p();
      }
    }
    if (stage === 'watch' && mark) updateReadout();
    updateHeader();

    const s = sun();
    const inHive =
      stage === 'watch' || stage === 'dance' || stage === 'recruits' || stage === 'flight' || stage === 'result';
    sound.setHum(inHive ? (stage === 'watch' || stage === 'dance' ? 1 : 0.55) : 0);
    sound.setWaggle(comb.waggling && (stage === 'watch' || stage === 'dance'), comb.slow);

    let ghost = null;
    if (stage === 'watch' && mark) {
      const d = describeMark(mark);
      ghost = { angle: d.theta, ms: d.ms };
    }
    comb.draw(combCtx, {
      ghost,
      showUp: (stage === 'watch' && (tutorial || !!mark)) || stage === 'dance',
      trace: stage === 'watch',
      time: now,
    });

    const targetForDance = stage === 'dance' || stage === 'recruits' ? playerPatch : null;
    const overlay: Overlay = {
      sun: s,
      mark: stage === 'dance' && targetForDance ? targetForDance.center : mark,
      searchRadius:
        stage === 'flight' || stage === 'result' ? (mark ? searchRadius(Math.hypot(mark[0], mark[1])) : 0) : 0,
      feeder: feederPt,
      flyers: trips
        .filter((t) => !t.done && t.delay <= 0)
        .map((t) => t.flyer)
        .concat(stage === 'result' ? trips.filter((t) => t.done).map((t) => ({ ...t.flyer, x: 0, y: 0 })) : []),
      found: found.filter((p) => !reveal || p !== reveal.patch),
      reveal: stage === 'dance' && targetForDance ? { patch: targetForDance, good: true } : reveal,
      target: null,
      sunRay: 1,
      showAngle: stage === 'watch' || stage === 'dance',
    };
    map.draw(mapCtx, overlay, now);
    requestAnimationFrame(frame);
  };

  setStage('intro');
  updateHeader();
  requestAnimationFrame(frame);

  if (params.has('debug')) {
    Object.assign(window, {
      __wg: {
        land,
        map,
        comb,
        sound,
        get stage() {
          return stage;
        },
        get round() {
          return round;
        },
        get clock() {
          return clock;
        },
        set clock(v: number) {
          clock = v;
        },
        get trips() {
          return trips;
        },
        start: () => {
          ui.intro.hidden = true;
          startRound();
        },
        setMark: (x: number, y: number) => {
          mark = [x, y];
          setStage('watch');
          updateReadout();
        },
        send: sendBee,
        skip: () => {
          for (const t of trips) {
            t.delay = 0;
            t.leg = t.legs.length;
          }
        },
        next: () => ui.next.click(),
        dance: startPlayerDance,
        force: (idx: number[]) => startRound(idx.map((i) => todays[i])),
        endDay,
        get tutorial() {
          return tutorial;
        },
        set tutorial(v: boolean) {
          tutorial = v;
        },
        get water() {
          return waterLesson;
        },
        todays: () => todays,
      },
    });
  }
  root.dataset.ready = 'true';
}
