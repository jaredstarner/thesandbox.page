// Wires the page: the growing crystal, the cloud it falls through, the lights, and the slide box.

import { Lattice, type Params } from './_lattice';
import { Microscope, type Light } from './_render';
import { Drift, paramsAt, type Weather } from './_weather';

/** One update stands for a few hundredths of a second of growth (the paper's estimate). */
export const SECONDS_PER_UPDATE = 0.03;
/** The paper's mesoscopic cells are on the order of microns; at 5 µm a cell, its 400 to
 * 600 cell crystals come out a few millimetres across, as real ones do. */
export const MICRONS_PER_CELL = 5;
/** Longest fall before the crystal lands on its own. */
const MAX_TIME = 240000;

type Phase = 'falling' | 'paused' | 'landed';

export interface Crystal {
  lattice: Lattice;
  microscope: Microscope;
  weather: Weather;
  params: Params;
  path: { time: number; w: Weather }[];
  phase: Phase;
}

const seed32 = () => (Math.random() * 2 ** 32) >>> 0;

export function start(root: HTMLElement): void {
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel) as T;
  const canvas = $<HTMLCanvasElement>('[data-view]');
  const notice = $<HTMLElement>('[data-notice]');
  const debug = new URLSearchParams(location.search).has('debug');

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: debug });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
    notice.hidden = false;
    root.dataset.broken = '';
    return;
  }
  gl.getExtension('OES_texture_float_linear');
  const lattice = new Lattice(gl);
  const microscope = new Microscope(gl, lattice);

  let light: Light = 'rheinberg';
  let seed = seed32();
  let weather: Weather = { t: -14, v: 0.55 };
  let drift = new Drift(seed, weather);
  let drifting = true;
  let params = paramsAt(weather);
  let phase: Phase = 'falling';
  let path: { time: number; w: Weather }[] = [];
  let view = 26;
  let perFrame = 8;
  let turbo = 0;
  let last = 0;
  let period = 1000 / 60;

  const begin = (s = seed32()) => {
    seed = s;
    drift = new Drift(seed, weather);
    params = paramsAt(weather);
    lattice.reset(params.rho, seed);
    path = [{ time: 0, w: { ...weather } }];
    view = 26;
    phase = 'falling';
  };

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const side = Math.round(canvas.clientWidth * dpr);
    if (side > 0 && canvas.width !== side) canvas.width = canvas.height = side;
  };

  const advance = (steps: number) => {
    if (drifting) weather = drift.step(weather, lattice.time, steps);
    const target = paramsAt(weather);
    const k = 1 - Math.exp(-steps / 800);
    for (const key of Object.keys(params) as (keyof Params)[]) {
      if (key !== 'rho') params[key] += (target[key] - params[key]) * k;
    }
    params.rho = target.rho;
    const ratio = target.rho / lattice.rho - 1;
    const grow = Math.max(-3e-4, Math.min(3e-4, ratio / Math.max(600, steps)));
    lattice.run(steps, params, grow);
    const tail = path[path.length - 1];
    if (lattice.time - tail.time >= 150) path.push({ time: lattice.time, w: { ...weather } });
  };

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = last ? now - last : period;
    last = now;
    if (dt > 0 && dt < 250) period = Math.min(period * 1.002, dt);
    resize();
    lattice.poll();
    if (phase === 'falling') {
      // Hunt for the most updates a frame the GPU keeps up with.
      if (dt <= period * 1.3) perFrame = Math.min(500, Math.ceil(perFrame * 1.06));
      else if (dt > period * 1.7) perFrame = Math.max(1, Math.floor(perFrame * 0.8));
      advance(turbo || perFrame);
      if (lattice.radius >= Lattice.MAX_RADIUS || lattice.time >= MAX_TIME) phase = 'landed';
    }
    const goal = Math.max(26, lattice.radius * 1.2 + 6);
    view += (goal - view) * 0.08;
    lattice.prepare();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    microscope.draw(light, canvas.width, canvas.height, view / (canvas.width / 2));
  };

  begin(seed);
  requestAnimationFrame(frame);

  if (debug) {
    const w = window as unknown as Record<string, unknown>;
    w.snow = {
      lattice,
      get state() {
        return { time: lattice.time, radius: lattice.radius, rho: lattice.rho, params, weather, perFrame, phase };
      },
      set light(l: Light) {
        light = l;
      },
      set turbo(n: number) {
        turbo = n;
      },
      weather(t: number, v: number, drift = false) {
        weather = { t, v };
        drifting = drift;
        params = paramsAt(weather);
      },
      reset(s?: number) {
        begin(s);
      },
      /** Resolves once the crystal reaches `radius` cells or `max` updates. */
      until(radius: number, max = MAX_TIME) {
        return new Promise((resolve) => {
          const check = () => {
            if (lattice.radius >= radius || lattice.time >= max || phase === 'landed') {
              phase = 'paused';
              resolve({ time: lattice.time, radius: lattice.radius });
            } else setTimeout(check, 100);
          };
          check();
        });
      },
    };
  }
}
