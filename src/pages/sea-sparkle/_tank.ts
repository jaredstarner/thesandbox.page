// The one body of water behind every window of /sea-sparkle/. Run as a
// SharedWorker, it serves all of the page's windows at once: each reports
// where its viewport sits on the screen, the tank treats the union of them as
// its container, and each gets back the water inside its own rectangle. Where
// shared workers are missing it runs as a plain worker, one tank per tab.

import { Tank } from './_fluid';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ToTank =
  | { type: 'hello'; box: Box }
  | { type: 'box'; box: Box }
  | { type: 'hidden'; hidden: boolean }
  | { type: 'stick'; active: boolean; x: number; y: number; vx: number; vy: number }
  /** Gravity in the screen's plane, in multiples of g, from a phone's motion sensor. */
  | { type: 'gravity'; gx: number; gy: number }
  | { type: 'fill' }
  | { type: 'knock'; vx: number; vy: number }
  | { type: 'bye' };

export type FromTank =
  | { type: 'welcome'; slot: number; radius: number; shared: boolean }
  | {
      type: 'frame';
      /** x, y, vx, vy, light, tag for each particle in or near this window. */
      data: Float32Array;
      count: number;
      /** The other windows, for drawing the seams where glass meets glass. */
      others: Box[];
      /** Millilitres last inside this window, and in the whole tank. */
      volume: number;
      total: number;
      pouring: boolean;
      full: boolean;
      /** Milliseconds the last step took. */
      ms: number;
    };

export const STRIDE = 6;

/** 9.81 m/s² at 96 CSS px to the inch, halved: the water is real-scale but moves like a tank twice the size. */
const GRAVITY = 9.81 * (96 / 0.0254) * 0.5;
/** How deep the tank is from the glass to the back, for the volume readout. */
const DEPTH_MM = 40;
const MM_PER_PX = 25.4 / 96;
const STEP = 1 / 60;
/** How full the first window is poured. */
const FILL = 0.34;

interface Port {
  postMessage(message: FromTank, transfer?: Transferable[]): void;
}

interface Client {
  port: Port;
  slot: number;
  box: Box | null;
  hidden: boolean;
  seen: number;
  gravity: { gx: number; gy: number } | null;
}

const clients = new Set<Client>();
let tank: Tank | null = null;
let running = false;
let last = 0;
let carry = 0;
let stepMs = 0;
const census = new Map<number, number>();

function freeSlot() {
  for (let slot = 0; slot < 16; slot++) {
    let used = false;
    for (const c of clients) if (c.slot === slot) used = true;
    if (!used) return slot;
  }
  return -1;
}

/**
 * Size the grid so the first window's water is about 7,000 particles, which a
 * worker steps in well under a frame. A bigger window gets coarser water
 * rather than a slower tank.
 */
function makeTank(box: Box) {
  const particleArea = 0.312;
  const cell = Math.sqrt((box.w * box.h * FILL) / (7000 * particleArea));
  return new Tank({ cell: Math.max(8, Math.min(22, Math.round(cell))), cap: 26000, gravity: GRAVITY });
}

function particlesFor(t: Tank, fraction: number, box: Box) {
  return Math.round((box.w * box.h * fraction) / t.particleArea);
}

/** The most water the tank will hold: about half of every open window, so pours never brim over. */
function roomFor(t: Tank) {
  let area = 0;
  for (const c of clients) if (c.box) area += c.box.w * c.box.h;
  return Math.min(t.cap, Math.round((area * 0.5) / t.particleArea));
}

function attach(port: Port, shared: boolean) {
  const client: Client = { port, slot: -1, box: null, hidden: false, seen: performance.now(), gravity: null };
  return (message: ToTank) => {
    client.seen = performance.now();
    switch (message.type) {
      case 'hello': {
        if (!clients.has(client)) {
          client.slot = freeSlot();
          if (client.slot < 0) return;
          clients.add(client);
        }
        if (!tank) tank = makeTank(message.box);
        client.box = message.box;
        tank.placeWall(client.slot, message.box.x, message.box.y, message.box.w, message.box.h, 0);
        // The first window is poured full; later ones open empty, waiting to be poured into.
        if (clients.size === 1 && tank.count === 0 && !tank.pouring) {
          tank.pour(client.slot, particlesFor(tank, FILL, message.box), 0.32);
        }
        port.postMessage({ type: 'welcome', slot: client.slot, radius: tank.r, shared });
        run();
        break;
      }
      case 'box':
        if (sane(message.box)) client.box = message.box;
        break;
      case 'hidden':
        client.hidden = message.hidden;
        break;
      case 'stick':
        if (tank) Object.assign(tank.stick, message);
        break;
      case 'gravity':
        client.gravity = { gx: message.gx, gy: message.gy };
        break;
      case 'fill':
        if (tank && client.box) {
          const room = roomFor(tank) - tank.count;
          tank.pour(client.slot, Math.min(room, particlesFor(tank, 0.12, client.box)), 0.25 + 0.5 * Math.random());
        }
        break;
      case 'knock':
        tank?.knock(client.slot, message.vx, message.vy);
        break;
      case 'bye':
        leave(client);
        break;
    }
  };
}

/** A minimised window on Windows reports itself at -32000; keep it where it was. */
function sane(box: Box) {
  return box.x > -20000 && box.y > -20000 && box.w > 0 && box.h > 0;
}

function leave(client: Client) {
  if (!clients.delete(client)) return;
  tank?.removeWall(client.slot);
  if (clients.size === 0) tank = null;
}

function run() {
  if (running) return;
  running = true;
  last = performance.now();
  carry = 0;
  setTimeout(tick, 0);
}

function tick() {
  const now = performance.now();
  // A window that stopped talking while visible has crashed or been killed.
  for (const c of clients) if (!c.hidden && now - c.seen > 6000) leave(c);
  if (!tank || clients.size === 0) {
    running = false;
    return;
  }
  carry += Math.min(0.1, (now - last) / 1000);
  last = now;
  let steps = 0;
  while (carry >= STEP && steps < 2) {
    advance(tank);
    carry -= STEP;
    steps++;
  }
  // Fall behind rather than spiral: drop whatever time is still owed.
  if (carry > STEP) carry = 0;
  if (steps > 0) send(tank);
  setTimeout(tick, Math.max(1, STEP * 1000 - (performance.now() - now)));
}

function advance(t: Tank) {
  const t0 = performance.now();
  for (const c of clients) if (c.box) t.placeWall(c.slot, c.box.x, c.box.y, c.box.w, c.box.h, STEP);
  // A phone's tilt steers gravity, but only when it is the tank's one window.
  const only = clients.size === 1 ? [...clients][0] : null;
  if (only?.gravity) {
    t.gravityX = only.gravity.gx * GRAVITY;
    t.gravityY = only.gravity.gy * GRAVITY;
  } else {
    t.gravityX = 0;
    t.gravityY = GRAVITY;
  }
  t.step(STEP, 2);
  stepMs = performance.now() - t0;
}

function send(t: Tank) {
  t.census(census);
  const ml = (t.particleArea * MM_PER_PX * MM_PER_PX * DEPTH_MM) / 1000;
  const full = t.count >= roomFor(t) - 50;
  const margin = 3 * t.h;
  for (const c of clients) {
    if (c.hidden || !c.box) continue;
    const { x, y, w, h } = c.box;
    const x0 = x - margin;
    const y0 = y - margin;
    const x1 = x + w + margin;
    const y1 = y + h + margin;
    let n = 0;
    for (let i = 0; i < t.count; i++) {
      const px = t.x[i];
      const py = t.y[i];
      if (px >= x0 && px <= x1 && py >= y0 && py <= y1) n++;
    }
    const data = new Float32Array(n * STRIDE);
    let k = 0;
    for (let i = 0; i < t.count; i++) {
      const px = t.x[i];
      const py = t.y[i];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      data[k++] = px;
      data[k++] = py;
      data[k++] = t.vx[i];
      data[k++] = t.vy[i];
      data[k++] = t.light[i];
      data[k++] = t.tag[i];
    }
    const others: Box[] = [];
    for (const o of clients) if (o !== c && o.box) others.push(o.box);
    c.port.postMessage(
      {
        type: 'frame',
        data,
        count: n,
        others,
        volume: (census.get(c.slot) ?? 0) * ml,
        total: t.count * ml,
        pouring: t.pouring,
        full,
        ms: stepMs,
      },
      [data.buffer],
    );
  }
}

// Shared: one connect per window. Dedicated: this tab is the only client.
const scope = self as unknown as {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
if ('onconnect' in self) {
  scope.addEventListener('connect', (event: MessageEvent) => {
    const port = event.ports[0];
    const handle = attach(port as unknown as Port, true);
    port.onmessage = (e: MessageEvent<ToTank>) => handle(e.data);
    port.start();
  });
} else {
  const handle = attach(scope as unknown as Port, false);
  scope.addEventListener('message', (e: MessageEvent) => handle(e.data as ToTank));
}
