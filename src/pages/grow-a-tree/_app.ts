// Grow a tree: wires the page to the growth model, the renderer, and the sound.

import * as THREE from 'three';
import { Grower } from './_grow';
import { computePose, makePose } from './_pose';
import { SPECIES, type Species, type SpeciesId } from './_species';
import { Scene } from './_scene';
import { windAt, type Wind } from './_wind';
import { Sound } from './_sound';
import { describe, drawRings, hitPosition, pick, type Hit, type SwayState } from './_inspect';

const SCRUB_K = 7.5;

const $ = <T extends Element>(root: Element, sel: string): T => root.querySelector(sel) as T;

/** Years per second at an age: slow through the first season, centuries in a minute. */
const pace = (age: number): number => 0.05 + 0.12 * age;

export function startArbor(root: HTMLElement): void {
  const canvas = $<HTMLCanvasElement>(root, '[data-view]');
  const fallback = $<HTMLElement>(root, '[data-fallback]');
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!canvas || !probe) {
    fallback.hidden = false;
    root.dataset.state = 'unsupported';
    return;
  }

  const ui = {
    latin: $<HTMLElement>(root, '[data-latin]'),
    common: $<HTMLElement>(root, '[data-common]'),
    species: [...root.querySelectorAll<HTMLButtonElement>('[data-species]')],
    plant: $<HTMLButtonElement>(root, '[data-plant]'),
    ladder: $<HTMLOListElement>(root, '[data-ladder]'),
    stageName: $<HTMLElement>(root, '[data-stage-name]'),
    stageText: $<HTMLElement>(root, '[data-stage-text]'),
    play: $<HTMLButtonElement>(root, '[data-play]'),
    step: $<HTMLButtonElement>(root, '[data-step]'),
    scrub: $<HTMLInputElement>(root, '[data-scrub]'),
    ticks: $<HTMLElement>(root, '[data-ticks]'),
    age: $<HTMLOutputElement>(root, '[data-age]'),
    speed: $<HTMLSelectElement>(root, '[data-speed]'),
    seasons: [...root.querySelectorAll<HTMLInputElement>('input[name="arbor-season"]')],
    breeze: $<HTMLInputElement>(root, '[data-breeze]'),
    hint: $<HTMLElement>(root, '[data-hint]'),
    status: $<HTMLElement>(root, '[data-status]'),
    inspect: $<HTMLElement>(root, '[data-inspect]'),
    inspectKicker: $<HTMLElement>(root, '[data-inspect-kicker]'),
    inspectTitle: $<HTMLElement>(root, '[data-inspect-title]'),
    inspectText: $<HTMLElement>(root, '[data-inspect-text]'),
    inspectClose: $<HTMLButtonElement>(root, '[data-inspect-close]'),
    rings: $<HTMLCanvasElement>(root, '[data-rings]'),
    ringsNote: $<HTMLElement>(root, '[data-rings-note]'),
    marker: $<HTMLElement>(root, '[data-marker]'),
    sound: $<HTMLButtonElement>(root, '[data-sound]'),
  };

  const params = new URLSearchParams(location.search);
  let speciesId: SpeciesId = (['spruce', 'oak', 'birch'] as const).find((s) => s === params.get('tree')) ?? 'oak';
  let seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e9);

  let sp: Species = SPECIES[speciesId];
  let grower = new Grower(sp, seed);
  const pose = makePose(70000);
  const scene = new Scene(canvas, pose);
  scene.setSpecies(sp);

  let age = 0;
  let poseAge = -1;
  let playing = false;
  /** Stepped growth stops here; continuous growth runs to the end. */
  let target: number | null = null;
  let season = 0.4;
  let seasonTarget = 0.4;
  let breeze = Number(ui.breeze.value) / 100;
  let stageIndex = -1;
  let scrubbing = false;

  // Camera framing follows the tree unless the visitor has moved in or out.
  const camTarget = new THREE.Vector3(0, 0.01, 0);
  let zoom = 1;
  let userActive = false;
  let autoDist = 0.3;
  scene.controls.addEventListener('start', () => {
    userActive = true;
    ui.hint.dataset.gone = '';
  });
  scene.controls.addEventListener('end', () => {
    userActive = false;
    const d = scene.camera.position.distanceTo(scene.controls.target);
    zoom = Math.min(4, Math.max(0.12, d / autoDist));
  });
  {
    const az = 0.55;
    const pol = 1.22;
    scene.camera.position.set(Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az)).multiplyScalar(0.3);
  }

  function ageToU(a: number): number {
    return Math.log(1 + (a / sp.maxAge) * (Math.exp(SCRUB_K) - 1)) / SCRUB_K;
  }
  function uToAge(u: number): number {
    return (sp.maxAge * (Math.exp(SCRUB_K * u) - 1)) / (Math.exp(SCRUB_K) - 1);
  }

  function buildLadder(): void {
    ui.ladder.textContent = '';
    ui.ticks.textContent = '';
    let lastLabel = -1;
    sp.stages.forEach((st, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.stage = String(i);
      const name = document.createElement('span');
      name.className = 'stage-name';
      name.textContent = st.name;
      const when = document.createElement('span');
      when.className = 'stage-age';
      when.textContent = formatAge(st.age, true);
      b.append(name, when);
      b.addEventListener('click', () => goToStage(i));
      li.append(b);
      ui.ladder.append(li);
      if (i >= 3) {
        const t = document.createElement('span');
        const u = ageToU(st.age);
        t.style.left = `${u * 100}%`;
        // Labels that would collide are left off.
        t.dataset.label = st.age >= 1 && u - lastLabel > 0.075 ? `${st.age}y` : '';
        if (t.dataset.label) lastLabel = u;
        ui.ticks.append(t);
      }
    });
    stageIndex = -1;
  }

  function formatAge(a: number, short = false): string {
    if (a < 0.02) return short ? 'day one' : 'Day one';
    if (a < 1) {
      const m = Math.max(1, Math.round(a * 12));
      return `${m} month${m === 1 ? '' : 's'}`;
    }
    const y = Math.floor(a);
    return short ? `${y} yr` : `Year ${y}`;
  }

  function setSpecies(id: SpeciesId, newSeed: number): void {
    speciesId = id;
    sp = SPECIES[id];
    seed = newSeed;
    grower = new Grower(sp, seed);
    scene.setSpecies(sp);
    age = 0;
    poseAge = -1;
    target = null;
    setPlaying(false);
    ui.latin.textContent = sp.latin;
    ui.common.textContent = sp.common;
    for (const b of ui.species) b.setAttribute('aria-pressed', String(b.dataset.species === id));
    closeInspect();
    buildLadder();
    const url = new URL(location.href);
    url.searchParams.set('tree', id);
    url.searchParams.set('seed', String(seed));
    history.replaceState(null, '', url);
  }

  function setPlaying(on: boolean): void {
    playing = on;
    ui.play.setAttribute('aria-pressed', String(on));
    ui.play.setAttribute('aria-label', on ? 'Pause' : 'Grow continuously');
    if (!on) target = null;
  }

  function goToStage(i: number): void {
    const a = sp.stages[i].age + 0.001;
    if (a > age) {
      target = a;
      playing = true;
      ui.play.setAttribute('aria-pressed', 'true');
    } else {
      age = a;
      setPlaying(false);
    }
  }

  ui.play.addEventListener('click', () => {
    if (!playing && age >= sp.maxAge - 0.01) age = 0;
    setPlaying(!playing);
  });
  ui.step.addEventListener('click', () => {
    const next = sp.stages.findIndex((s) => s.age > age + 0.0011);
    if (next < 0) {
      target = sp.maxAge;
    } else {
      target = sp.stages[next].age + 0.001;
    }
    playing = true;
    ui.play.setAttribute('aria-pressed', 'true');
  });
  ui.scrub.addEventListener('input', () => {
    scrubbing = true;
    setPlaying(false);
    age = Math.min(maxShown(), uToAge(Number(ui.scrub.value) / 1000));
  });
  ui.scrub.addEventListener('change', () => {
    scrubbing = false;
  });
  for (const b of ui.species) {
    b.addEventListener('click', () => {
      const id = b.dataset.species as SpeciesId;
      if (id !== speciesId) setSpecies(id, Math.floor(Math.random() * 1e9));
    });
  }
  ui.plant.addEventListener('click', () => setSpecies(speciesId, Math.floor(Math.random() * 1e9)));
  for (const r of ui.seasons) r.addEventListener('change', () => (seasonTarget = Number(r.value)));
  ui.breeze.addEventListener('input', () => (breeze = Number(ui.breeze.value) / 100));

  const sound = new Sound();
  ui.sound.addEventListener('click', () => {
    const on = !sound.on;
    ui.sound.setAttribute('aria-pressed', String(on));
    void sound.setOn(on);
  });
  document.addEventListener('visibilitychange', () => sound.setVisible(document.visibilityState === 'visible'));

  /** The model must be ahead of what is shown; deaths are known once it finishes. */
  function maxShown(): number {
    if (grower.done) return sp.maxAge;
    return Math.min(grower.age - 0.05, 6);
  }

  function updateStage(): void {
    let idx = 0;
    for (let i = 0; i < sp.stages.length; i++) if (age >= sp.stages[i].age) idx = i;
    if (idx === stageIndex) return;
    stageIndex = idx;
    const st = sp.stages[idx];
    ui.stageName.textContent = st.name;
    ui.stageText.textContent = st.text;
    ui.ladder.querySelectorAll('button').forEach((b, i) => {
      b.dataset.reached = String(i <= idx);
      if (i === idx) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    ui.step.disabled = false;
  }

  // Inspecting: a tap (not a drag) names the part under it.
  let hit: Hit | null = null;
  let hitAge = -1;
  const sway: SwayState = { time: 0, freq: 1, breeze: 0, height: 1, wind: { gust: 0, dirX: 1, dirZ: 0 } };
  let down: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 600;
    down = null;
    if (moved > 6 || !quick) return;
    const rect = canvas.getBoundingClientRect();
    const seedAt = age < sp.seedHold ? scene.seedPosition(sp) : null;
    const found = pick(e.clientX - rect.left, e.clientY - rect.top, scene.camera, rect.width, rect.height, pose, sway, seedAt, scene.plugR);
    if (found) openInspect(found);
    else closeInspect();
  });
  ui.inspectClose.addEventListener('click', closeInspect);

  function openInspect(h: Hit): void {
    hit = h;
    hitAge = -1;
    ui.inspect.hidden = false;
    ui.marker.hidden = false;
    ui.hint.dataset.gone = '';
    refreshInspect();
  }

  function closeInspect(): void {
    hit = null;
    ui.inspect.hidden = true;
    ui.marker.hidden = true;
  }

  function refreshInspect(): void {
    if (!hit || Math.abs(hitAge - poseAge) < 0.25) return;
    hitAge = poseAge;
    if (hit.kind !== 'seed' && (!pose.shown[hit.node] || (hit.kind === 'leaf' && pose.leafNode[hit.leaf] !== hit.node))) {
      closeInspect();
      return;
    }
    const d = describe(hit, grower.plant, pose, sp, poseAge);
    ui.inspectKicker.textContent = d.kicker;
    ui.inspectTitle.textContent = d.title;
    ui.inspectText.textContent = d.text;
    ui.rings.hidden = !d.rings;
    ui.ringsNote.hidden = !d.rings;
    if (d.rings) {
      drawRings(ui.rings, sp, seed, d.rings);
      const cm = d.rings.radius * 200;
      const across = cm < 100 ? `${Math.max(1, Math.round(cm))} cm` : `${(cm / 100).toFixed(1)} m`;
      ui.ringsNote.textContent = `${d.rings.years} ring${d.rings.years === 1 ? '' : 's'}, about ${across} across${d.rings.hollow > 0.05 ? ', hollow at the heart' : ''}`;
    }
  }

  function placeMarker(): void {
    if (!hit) return;
    const p = hitPosition(hit, pose, sway, scene.seedPosition(sp));
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(scene.camera);
    const rect = canvas.getBoundingClientRect();
    ui.marker.style.transform = `translate(${(v.x * 0.5 + 0.5) * rect.width}px, ${(-v.y * 0.5 + 0.5) * rect.height}px)`;
  }

  function frame(dt: number): void {
    if (!grower.done) grower.run(8);

    // Growth.
    if (playing) {
      const speed = Number(ui.speed.value) * (target !== null ? 2.2 : 1);
      age += dt * pace(age) * speed;
      if (target !== null && age >= target) {
        age = target;
        setPlaying(false);
      }
      if (age >= sp.maxAge) {
        age = sp.maxAge;
        setPlaying(false);
      }
    }
    const limit = maxShown();
    ui.status.textContent = age > limit + 0.01 ? 'Growing the model…' : '';
    const shownAge = Math.min(age, limit);

    if (Math.abs(shownAge - poseAge) > 1e-5) {
      computePose(pose, grower.plant, sp, shownAge);
      scene.upload(pose, sp, shownAge);
      poseAge = shownAge;
      if (!scrubbing) ui.scrub.value = String(Math.round(ageToU(shownAge) * 1000));
      const h = pose.height;
      const tall = h < 0.005 ? '' : h < 1 ? ` · ${Math.round(h * 100)} cm` : ` · ${h.toFixed(h < 10 ? 1 : 0)} m`;
      ui.age.textContent = `${formatAge(shownAge)}${tall}`;
      updateStage();
    }

    // Season eases forward around the year.
    if (Math.abs(seasonTarget - season) > 0.002) {
      let d = seasonTarget - season;
      if (d < 0) d += 1;
      season = (season + Math.min(d, dt * 0.45)) % 1;
    }
    scene.setSeason(season);

    // Wind.
    const now = performance.now() / 1000;
    windAt(now, breeze, wind);
    scene.setWind({ time: now, freq: scene.freq, gust: wind.gust, breeze, dirX: wind.dirX, dirZ: wind.dirZ });
    sway.time = now;
    sway.freq = scene.freq;
    sway.breeze = breeze;
    sway.height = Math.max(0.02, pose.height);
    sway.wind = wind;
    sound.update({
      gust: wind.gust,
      breeze,
      leaves: pose.leafAmount,
      needles: sp.leaf === 'needle',
      season,
      deciduous: sp.deciduous,
      height: pose.height,
    });

    frameCamera(dt);
    refreshInspect();
    placeMarker();
    scene.render();
  }

  const wind: Wind = { gust: 0, dirX: 1, dirZ: 0 };
  const off = new THREE.Vector3();

  // The part of the screen the panels leave free, measured on resize.
  const band = { top: 0, bottom: 1, height: 1, width: 1 };
  const panels = {
    env: $<HTMLElement>(root, '.env'),
    caption: $<HTMLElement>(root, '.caption'),
    time: $<HTMLElement>(root, '.time'),
  };
  function measureBand(): void {
    const r = root.getBoundingClientRect();
    const phone = r.width < 640;
    band.width = r.width;
    band.height = r.height;
    band.top = phone ? panels.env.getBoundingClientRect().bottom - r.top + 4 : 0;
    band.bottom = (phone ? panels.caption : panels.time).getBoundingClientRect().top - r.top - 4;
    if (band.bottom - band.top < r.height * 0.3) {
      band.top = 0;
      band.bottom = r.height;
    }
    const shift = r.height / 2 - (band.top + band.bottom) / 2;
    scene.camera.setViewOffset(r.width, r.height, 0, shift, r.width, r.height);
  }

  function frameCamera(dt: number): void {
    const h = Math.max(pose.height, 0);
    const depth = scene.plugDepth;
    const seedFrame = sp.id === 'oak' ? 0.07 : 0.035;
    const tall = Math.max(h * 1.08 + depth * 0.5, seedFrame) * (band.height / Math.max(1, band.bottom - band.top));
    const wide = Math.max(scene.plugR * 2.1, pose.crownR * 2.2, seedFrame);
    const fov = (scene.camera.fov * Math.PI) / 180;
    const t = Math.tan(fov / 2);
    const aspect = scene.camera.aspect;
    const fit = Math.max(tall / (2 * t), wide / (2 * t * aspect)) * 1.32;
    const k = 1 - Math.exp(-dt * 2.5);
    autoDist += (fit - autoDist) * k;
    const ty = (h * 1.02 - depth * 0.5) / 2;
    camTarget.y += (ty - camTarget.y) * k;
    off.copy(scene.camera.position).sub(scene.controls.target);
    scene.controls.target.copy(camTarget);
    if (!userActive) off.setLength(autoDist * zoom);
    scene.camera.position.copy(camTarget).add(off);
    scene.camera.near = Math.max(0.001, autoDist * zoom * 0.02);
    scene.camera.far = autoDist * zoom * 40 + 10;
    scene.camera.updateProjectionMatrix();
    scene.controls.minDistance = autoDist * 0.12;
    scene.controls.maxDistance = autoDist * 4;
    scene.controls.update();
  }

  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    scene.resize(w, h);
    measureBand();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  setSpecies(speciesId, seed);
  grower.run(40);
  // A shared link can open on an age.
  const startAge = Number(params.get('age'));
  if (startAge > 0) age = Math.min(sp.maxAge, startAge);
  root.dataset.state = 'ready';
  // A read-only handle for render checks.
  if (params.has('debug')) Object.assign(window, { arbor: { pose, sound, get grower() { return grower; } } });

  let last = performance.now();
  const loop = (t: number): void => {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
