// Wires the slime mold page: finds a GPU, pours a plate, and runs the loop.

import { DISH_RADIUS, Plate, SIZE, type Food } from './_plate';
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
