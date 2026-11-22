// Waggle: a honeybee's dance floor and the valley round the hive.

import { makeLand } from './_land';
import { MapView, type Overlay } from './_mapdraw';
import { FIRST_DAY, sunAt } from './_sun';

export function start(root: HTMLElement): void {
  const mapCanvas = root.querySelector<HTMLCanvasElement>('[data-map]')!;
  const mapCtx = mapCanvas.getContext('2d')!;
  const land = makeLand();
  const map = new MapView(land);
  const params = new URLSearchParams(location.search);
  const hour = Number(params.get('h') ?? 9.5);

  const fit = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = mapCanvas.getBoundingClientRect();
    mapCanvas.width = Math.round(r.width * dpr);
    mapCanvas.height = Math.round(r.height * dpr);
    map.resize(r.width, r.height, dpr);
  };
  new ResizeObserver(fit).observe(mapCanvas);
  fit();

  const frame = (t: number) => {
    const overlay: Overlay = {
      sun: sunAt(FIRST_DAY, hour),
      mark: null,
      searchRadius: 0,
      feeder: null,
      flyers: [],
      found: [],
      reveal: null,
      target: null,
      sunRay: 1,
      showAngle: false,
    };
    map.draw(mapCtx, overlay, t);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (params.has('debug')) Object.assign(window, { __wg: { land, map } });
  root.dataset.ready = 'true';
}
