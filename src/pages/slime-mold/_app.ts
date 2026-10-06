// Wires the slime mold page: finds a GPU, pours a plate, and runs the loop.

import { DISH_RADIUS, MAX_FOODS, Plate, SIZE, type Food } from './_plate';
import { FlowSolver } from './_flow';
import { buildMaze } from './_maze';
import { spanningTree } from './_mst';
import { DIALS, STRAINS, toRules, type Strain } from './_strains';

const MAX_AGENTS = 1 << 20;
/** A maze holds fewer, so the surviving route reads as a tube, not packed corridors. */
const MAZE_AGENTS = 1 << 17;
const MIN_AGENTS = 1 << 17;
/** A fresh plate starts this small and grows by division. */
const SEED_AGENTS = 1 << 12;
const INOCULUM_RADIUS = 40;

export async function startSlime(root: HTMLElement): Promise<void> {
  const unsupported = root.querySelector<HTMLElement>('[data-unsupported]')!;
  const bench = root.querySelector<HTMLElement>('.bench')!;
  // Without a plate, keep only the lab notes on the bench.
  const fail = (message: string) => {
    unsupported.textContent = message;
    unsupported.hidden = false;
    root.querySelector<HTMLElement>('.readout')!.hidden = true;
    root.querySelector<HTMLElement>('[data-tools]')!.hidden = true;
    for (const control of root.querySelectorAll<HTMLElement>('.actions > *')) {
      if (control.getAttribute('popovertarget') !== 'slime-notes') control.hidden = true;
    }
  };

  const gpu = navigator.gpu;
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
  if (!adapter) {
    fail(
      gpu
        ? 'This browser has WebGPU but found no GPU adapter to grow the plate on. Try another browser, or check that hardware acceleration is on.'
        : "This plate grows on the GPU with WebGPU, and this browser doesn't offer it. Recent Chrome, Edge, Safari, and Firefox do.",
    );
    return;
  }

  const canvas = root.querySelector<HTMLCanvasElement>('[data-plate]')!;
  const label = root.querySelector<HTMLElement>('.label')!;
  const strain: Strain = { ...STRAINS[0]! };
  let plate: Plate;
  try {
    plate = await Plate.create(canvas, adapter, MAX_AGENTS, toRules(strain));
  } catch (error) {
    fail(`The GPU wouldn't take the plate: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  plate.device.lost.then((info) => {
    if (info.reason !== 'destroyed') fail('The GPU dropped the plate. Reload the page to pour a fresh one.');
  });

  const readout = {
    step: root.querySelector<HTMLElement>('[data-step]')!,
    pop: root.querySelector<HTMLElement>('[data-pop]')!,
    oats: root.querySelector<HTMLElement>('[data-oats]')!,
  };
  const number = new Intl.NumberFormat('en-US');

  // The dish sits in the space the label and bench leave free.
  const view = { cx: 0, cy: 0, scale: 1 };
  function layout() {
    const w = root.clientWidth;
    const h = root.clientHeight;
    const benchTop = bench.hidden ? h : bench.getBoundingClientRect().top;
    const labelBox = label.getBoundingClientRect();
    const portrait = w < h * 0.9;
    const top = portrait ? labelBox.bottom + 8 : 12;
    const bottom = benchTop - 10;
    const d = Math.max(180, Math.min(w - 20, bottom - top));
    let cx = w / 2;
    if (!portrait) cx = Math.min(w - d / 2 - 10, Math.max(cx, labelBox.right + 12 + d / 2));
    view.cx = cx;
    view.cy = top + (bottom - top) / 2;
    view.scale = d / (2 * (DISH_RADIUS + 12));
    // Past about 1.75 device pixels per agar cell, extra pixels only cost frames.
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, (1.75 * SIZE) / d));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    plate.setView(canvas.width, canvas.height, view.cx * dpr, view.cy * dpr, view.scale * dpr);
    drawEngineer();
  }

  // The engineer's answer: straight lines, the shortest set that joins every oat.
  const SVG = 'http://www.w3.org/2000/svg';
  const MM_PER_CELL = 90 / (2 * DISH_RADIUS);
  const drafting = root.querySelector<SVGSVGElement>('[data-drafting]')!;
  const engineerButton = root.querySelector<HTMLButtonElement>('[data-engineer]')!;
  const engineerReadout = root.querySelector<HTMLElement>('[data-engineer-readout]')!;
  let engineer = false;
  function drawEngineer() {
    drafting.replaceChildren();
    engineerReadout.hidden = !engineer;
    if (!engineer) return;
    const css = (v: number, c: number) => (v - SIZE / 2) * view.scale + c;
    const edges = spanningTree(plate.foods);
    for (const e of edges) {
      const line = document.createElementNS(SVG, 'line');
      line.setAttribute('x1', String(css(e.a.x, view.cx)));
      line.setAttribute('y1', String(css(e.a.y, view.cy)));
      line.setAttribute('x2', String(css(e.b.x, view.cx)));
      line.setAttribute('y2', String(css(e.b.y, view.cy)));
      drafting.append(line);
    }
    for (const o of plate.foods) {
      const ring = document.createElementNS(SVG, 'circle');
      ring.setAttribute('cx', String(css(o.x, view.cx)));
      ring.setAttribute('cy', String(css(o.y, view.cy)));
      ring.setAttribute('r', String(Math.max(6, 22 * view.scale)));
      drafting.append(ring);
    }
    const total = edges.reduce((sum, e) => sum + e.length, 0) * MM_PER_CELL;
    engineerReadout.textContent =
      plate.foods.length < 2
        ? 'Engineer: drop two oats or more.'
        : `Engineer: ${Math.round(total)} mm of straight track joins ${plate.foods.length} oats in a 90 mm dish.`;
  }
  engineerButton.addEventListener('click', () => {
    engineer = !engineer;
    engineerButton.setAttribute('aria-pressed', String(engineer));
    drawEngineer();
  });
  function oatsChanged() {
    plate.markFoods();
    drawEngineer();
  }

  new ResizeObserver(layout).observe(root);
  layout();

  function scatterOats(count: number): Food[] {
    const c = SIZE / 2;
    const oats: Food[] = [];
    for (let tries = 0; oats.length < count && tries < 4000; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (DISH_RADIUS - 60);
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      // Keep the inoculation site bare, so the colony has to go looking.
      if (Math.hypot(x - c, y - c) > 110 && oats.every((o) => Math.hypot(o.x - x, o.y - y) > 120)) oats.push({ x, y });
    }
    return oats;
  }

  function inoculate(x: number, y: number): Float32Array {
    const data = new Float32Array(SEED_AGENTS * 4);
    for (let i = 0; i < SEED_AGENTS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * INOCULUM_RADIUS;
      data[i * 4] = x + Math.cos(a) * r;
      data[i * 4 + 1] = y + Math.sin(a) * r;
      data[i * 4 + 2] = a;
    }
    return data;
  }

  const plateNo = root.querySelector<HTMLElement>('[data-plate-no]')!;
  let pours = 0;
  function poured() {
    pours++;
    plateNo.textContent = String(pours);
  }

  // In a maze, Tero's flow model decides which corridors the slime abandons.
  let flow: FlowSolver | null = null;
  const FLOW_START = 900;
  const STEPS_PER_FLOW = 5;
  let flowSteps = 0;
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  function advanceFlow() {
    if (!flow || plate.steps < FLOW_START) return;
    let ran = false;
    while (flowSteps + STEPS_PER_FLOW <= plate.steps - FLOW_START) {
      flow.iterate(0.04);
      flowSteps += STEPS_PER_FLOW;
      ran = true;
    }
    if (ran) plate.setDryness(flow.levels().map((level) => 1 - smooth(0.03, 0.4, level)));
  }

  function fresh() {
    flow = null;
    plate.foods = scatterOats(11);
    plate.pour(inoculate(SIZE / 2, SIZE / 2), SEED_AGENTS);
    poured();
    oatsChanged();
  }
  fresh();

  // Nakagaki's maze: fill every corridor with slime, feed both ends, and wait.
  function maze() {
    const m = buildMaze(SIZE, DISH_RADIUS);
    const data = new Float32Array(MAZE_AGENTS * 4);
    const { x0, y0, side } = m.bounds;
    for (let i = 0; i < MAZE_AGENTS; i++) {
      let x = 0;
      let y = 0;
      do {
        x = x0 + Math.random() * side;
        y = y0 + Math.random() * side;
      } while (!m.open(x, y));
      data[i * 4] = x;
      data[i * 4 + 1] = y;
      data[i * 4 + 2] = Math.random() * Math.PI * 2;
    }
    plate.foods = m.oats;
    plate.pour(data, MAZE_AGENTS, {
      limit: MAZE_AGENTS,
      walls: m.walls,
      maze: { x0, y0, pitch: m.pitch, cells: m.cells },
    });
    flow = new FlowSolver(m.cells * m.cells, m.links, m.ends[0], m.ends[1]);
    flowSteps = 0;
    poured();
    oatsChanged();
  }
  root.querySelector('[data-maze]')!.addEventListener('click', maze);

  // The bench: oats by click, salt and scraping by drag, the lamp while held.
  type Tool = 'oat' | 'salt' | 'lamp' | 'scrape';
  let tool: Tool = 'oat';
  root.querySelector('[data-tools]')!.addEventListener('change', (event) => {
    tool = (event.target as HTMLInputElement).value as Tool;
  });

  const toSim = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - box.left - view.cx) / view.scale + SIZE / 2,
      y: (event.clientY - box.top - view.cy) / view.scale + SIZE / 2,
    };
  };
  const inDish = (p: { x: number; y: number }, margin = 0) =>
    Math.hypot(p.x - SIZE / 2, p.y - SIZE / 2) < DISH_RADIUS - margin;
  const OAT_GRAB = 20;
  const SALT_RADIUS = 7;
  const SCRAPE_RADIUS = 24;

  let drag: { x: number; y: number } | null = null;
  function scrapeOats(p: { x: number; y: number }) {
    const before = plate.foods.length;
    plate.foods = plate.foods.filter((o) => Math.hypot(o.x - p.x, o.y - p.y) > SCRAPE_RADIUS + 6);
    if (plate.foods.length !== before) oatsChanged();
  }
  function drawTo(p: { x: number; y: number }) {
    if (!drag) return;
    const radius = tool === 'salt' ? SALT_RADIUS : SCRAPE_RADIUS;
    plate.stroke({ ax: drag.x, ay: drag.y, bx: p.x, by: p.y, radius, salt: tool === 'salt' });
    if (tool === 'scrape') scrapeOats(p);
    drag = p;
  }

  canvas.addEventListener('pointerdown', (event) => {
    const p = toSim(event);
    if (tool === 'oat') {
      if (!inDish(p, 14)) return;
      const hit = plate.foods.findIndex((o) => Math.hypot(o.x - p.x, o.y - p.y) < OAT_GRAB);
      if (hit >= 0) plate.foods.splice(hit, 1);
      else if (plate.foods.length < MAX_FOODS) plate.foods.push(p);
      oatsChanged();
      return;
    }
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone can't be captured; the drag still works inside the canvas.
    }
    if (tool === 'lamp') {
      plate.lamp = { x: p.x, y: p.y, radius: 72, on: true };
      return;
    }
    drag = p;
    drawTo(p);
  });
  canvas.addEventListener('pointermove', (event) => {
    const p = toSim(event);
    if (tool === 'lamp' && plate.lamp.on) {
      plate.lamp.x = p.x;
      plate.lamp.y = p.y;
    } else if (drag) {
      drawTo(p);
    }
  });
  const release = () => {
    drag = null;
    plate.lamp.on = false;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // The strain: presets, and a dial for each rule.
  const strainButtons = STRAINS.map((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = preset.name;
    button.addEventListener('click', () => {
      Object.assign(strain, preset);
      applyStrain();
    });
    return button;
  });
  root.querySelector('[data-strains]')!.append(...strainButtons);
  const dials = DIALS.map((dial) => {
    const field = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = dial.label;
    const output = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(dial.min);
    input.max = String(dial.max);
    input.step = String(dial.step);
    input.addEventListener('input', () => {
      strain[dial.key] = Number(input.value);
      strain.name = '';
      applyStrain();
    });
    field.append(name, output, input);
    return { dial, input, output, field };
  });
  root.querySelector('[data-sliders]')!.append(...dials.map((d) => d.field));
  function applyStrain() {
    plate.rules = toRules(strain);
    strainButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(STRAINS[i]!.name === strain.name)));
    for (const { dial, input, output } of dials) {
      input.value = String(strain[dial.key]);
      const value = strain[dial.key];
      output.textContent = `${value}${value === 1 ? dial.unit.replace(/s$/, '') : dial.unit}`;
    }
  }
  applyStrain();

  // Time: pause, speed, a fresh plate, and a photograph of this one.
  const SPEEDS = [1, 2, 4, 8];
  let speed = 2;
  let paused = false;
  let photo = false;
  const pauseButton = root.querySelector<HTMLButtonElement>('[data-pause]')!;
  const speedButton = root.querySelector<HTMLButtonElement>('[data-speed]')!;
  pauseButton.addEventListener('click', () => {
    paused = !paused;
    pauseButton.setAttribute('aria-pressed', String(paused));
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
  });
  speedButton.addEventListener('click', () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
    speedButton.textContent = `${speed}×`;
  });
  root.querySelector('[data-fresh]')!.addEventListener('click', fresh);
  root.querySelector('[data-photo]')!.addEventListener('click', () => {
    photo = true;
  });

  // A WebGPU canvas can only be read in the same task that drew it.
  function takePhoto() {
    const name = `physarum-plate-${pours}-step-${plate.steps}.png`;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    }, 'image/png');
  }

  let frames = 0;
  let last = performance.now();
  let slow = 0;
  let sampled = 0;
  function frame(now: number) {
    const dt = now - last;
    last = now;
    // Halve the population while frames run long, down to a floor.
    if (dt < 250 && frames > 30) {
      sampled++;
      if (dt > 30) slow++;
      if (sampled >= 90) {
        if (slow > 60 && speed <= 2 && plate.target > MIN_AGENTS) {
          plate.target >>= 1;
          plate.agents = Math.min(plate.agents, plate.target);
        }
        sampled = 0;
        slow = 0;
      }
    }
    if (paused) plate.applyStrokes();
    else plate.step(speed);
    advanceFlow();
    plate.render(now / 1000);
    if (photo) {
      photo = false;
      takePhoto();
    }
    if (frames++ % 8 === 0) {
      readout.step.textContent = number.format(plate.steps);
      readout.pop.textContent = number.format(plate.agents);
      readout.oats.textContent = String(plate.foods.length);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
