// Wires the slime mold page: finds a GPU, pours a plate, and runs the loop.

import { DISH_RADIUS, MAX_FOODS, Plate, SIZE, type Food } from './_plate';
import { STRAINS, toRules, type Strain } from './_strains';

const MAX_AGENTS = 1 << 20;
const MIN_AGENTS = 1 << 17;
const INOCULUM_RADIUS = 26;

export async function startSlime(root: HTMLElement): Promise<void> {
  const unsupported = root.querySelector<HTMLElement>('[data-unsupported]')!;
  const bench = root.querySelector<HTMLElement>('.bench')!;
  const fail = (message: string) => {
    unsupported.textContent = message;
    unsupported.hidden = false;
    bench.hidden = true;
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    plate.setView(canvas.width, canvas.height, view.cx * dpr, view.cy * dpr, view.scale * dpr);
  }
  new ResizeObserver(layout).observe(root);
  layout();

  function scatterOats(count: number): Food[] {
    const c = SIZE / 2;
    const oats: Food[] = [{ x: c, y: c }];
    for (let tries = 0; oats.length < count && tries < 4000; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (DISH_RADIUS - 60);
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (oats.every((o) => Math.hypot(o.x - x, o.y - y) > 120)) oats.push({ x, y });
    }
    return oats;
  }

  function inoculate(x: number, y: number): Float32Array {
    const data = new Float32Array(MAX_AGENTS * 4);
    for (let i = 0; i < MAX_AGENTS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * INOCULUM_RADIUS;
      data[i * 4] = x + Math.cos(a) * r;
      data[i * 4 + 1] = y + Math.sin(a) * r;
      data[i * 4 + 2] = a;
    }
    return data;
  }

  function fresh() {
    plate.foods = scatterOats(11);
    plate.pour(inoculate(SIZE / 2, SIZE / 2));
  }
  fresh();

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
    if (plate.foods.length !== before) plate.markFoods();
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
      plate.markFoods();
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

  let speed = 2;
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
        if (slow > 60 && plate.agents > MIN_AGENTS) plate.agents >>= 1;
        sampled = 0;
        slow = 0;
      }
    }
    plate.step(speed);
    plate.render(now / 1000);
    if (frames++ % 8 === 0) {
      readout.step.textContent = number.format(plate.steps);
      readout.pop.textContent = number.format(plate.agents);
      readout.oats.textContent = String(plate.foods.length);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
