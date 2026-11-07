// The page: picks a property, keeps the frame loop, and takes input.

import { Renderer } from './_gl';
import { ROOMS, buildRoom, type Room } from './_rooms';
import { Visitor } from './_visitor';

export function start(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-plate]')!;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) return;

  const rooms: Room[] = ROOMS.map(buildRoom);
  const renderer = new Renderer(canvas, gl);
  const params = new URLSearchParams(location.search);
  const first = Number(params.get('room') ?? 0);
  let room = rooms[first]!;
  renderer.setRoom(room);
  const visitor = new Visitor(room);

  const size = () => {
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  };
  size();
  addEventListener('resize', size);

  const frame = () => {
    renderer.draw(visitor.view());
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (params.has('debug')) {
    (window as unknown as { spacious: unknown }).spacious = {
      visitor,
      renderer,
      rooms,
      setRoom(i: number) {
        room = rooms[i]!;
        renderer.setRoom(room);
        visitor.place(room);
      },
    };
  }
}
