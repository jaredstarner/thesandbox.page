// Runs the dish off the main thread: advances the fluid about forty times a
// second and posts the surface as a transferable buffer, with the spikes
// and their lattice every few frames.

import { Dish, N, latticeStats, magnetDepth, type Inputs } from './_sim';

const scope = self as unknown as Worker;
const seed = Number(new URL(self.location.href).searchParams.get('seed')) || (Date.now() & 0xffff);
let dish = new Dish(seed);
let inputs: Inputs = { coil: 0, hand: null };
const pool: Float32Array[] = [];
let outstanding = 0;
let last = performance.now();
let frame = 0;
let speed = 1;
let paused = false;

scope.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.kind === 'input') {
    inputs = { coil: m.coil, hand: m.hand };
  } else if (m.kind === 'buffer') {
    pool.push(new Float32Array(m.buffer));
    outstanding = Math.max(0, outstanding - 1);
  } else if (m.kind === 'reset') {
    dish = new Dish(m.seed ?? seed, m.depth ?? 4.5);
  } else if (m.kind === 'pause') {
    paused = m.paused;
    last = performance.now();
  } else if (m.kind === 'speed') {
    speed = m.speed;
  } else if (m.kind === 'run') {
    // Debug: advance a fixed stretch of time synchronously, for render checks.
    const steps = Math.round(m.seconds * 40);
    for (let i = 0; i < steps; i++) dish.advance(1 / 40, inputs);
    scope.postMessage({ kind: 'ran', seconds: m.seconds });
  }
};

function tick() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000) * speed;
  last = now;
  if (!paused) dish.advance(dt, inputs);
  if (outstanding < 3) {
    const buf = pool.pop() ?? new Float32Array(2 * N * N);
    dish.compose(buf);
    const msg: Record<string, unknown> = {
      kind: 'frame',
      coil: dish.coil,
      magnet: { x: dish.magnet.x, y: dish.magnet.y, depth: magnetDepth(dish.magnet.lift), lift: dish.magnet.lift },
      data: buf,
    };
    if (frame % 5 === 0) {
      const spikes = dish.spikes();
      msg.spikes = spikes;
      msg.stats = latticeStats(spikes, false);
    }
    outstanding++;
    scope.postMessage(msg, [buf.buffer]);
    frame++;
  }
  setTimeout(tick, Math.max(1, 25 - (performance.now() - now)));
}

tick();
