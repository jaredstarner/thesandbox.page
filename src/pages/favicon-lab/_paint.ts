import type { Lab, Program } from './_lab';
import { PALETTE } from './_palette';

// Paint on the enlarged icon; the tab follows every stroke.

type Tool = 'pen' | 'fill' | 'erase';

const STORE_KEY = 'favicon-lab:paint';

export function createPaint(lab: Lab): Program {
  const panel = lab.panel('paint');
  const toolButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-paint-tool]')];
  const colorButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-paint-color]')];
  const clearButton = panel.querySelector<HTMLButtonElement>('[data-paint-clear]')!;
  const saveButton = panel.querySelector<HTMLButtonElement>('[data-paint-save]')!;
  const { canvas, ctx } = lab;

  let tool: Tool = 'pen';
  let color: string = PALETTE[9];
  let last: { x: number; y: number } | null = null;
  let frame = 0;
  let loaded = 0;

  const store = () => {
    try {
      localStorage.setItem(STORE_KEY, canvas.toDataURL('image/png'));
    } catch {
      // Storage blocked; the drawing lasts until the page closes.
    }
  };

  const commit = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      lab.present();
    });
  };

  /** The lab's own starting icon, as somewhere to begin. */
  const starter = () => {
    ctx.clearRect(0, 0, 32, 32);
    ctx.fillStyle = PALETTE[0];
    ctx.beginPath();
    ctx.roundRect(0, 0, 32, 32, 6);
    ctx.fill();
    ctx.fillStyle = PALETTE[9];
    ctx.fillRect(9, 9, 14, 14);
  };

  const cell = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const clamp = (v: number) => Math.min(31, Math.max(0, Math.floor(v)));
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 32),
      y: clamp(((event.clientY - rect.top) / rect.height) * 32),
    };
  };

  const plot = (x: number, y: number) => {
    if (tool === 'erase') ctx.clearRect(x, y, 1, 1);
    else {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  };

  /** Every cell on the line between two cells, so fast strokes leave no gaps. */
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = Math.abs(b.x - a.x);
    const dy = -Math.abs(b.y - a.y);
    const sx = a.x < b.x ? 1 : -1;
    const sy = a.y < b.y ? 1 : -1;
    let err = dx + dy;
    let { x, y } = a;
    for (;;) {
      plot(x, y);
      if (x === b.x && y === b.y) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  };

  const flood = (x: number, y: number) => {
    const image = ctx.getImageData(0, 0, 32, 32);
    const px = new Uint32Array(image.data.buffer);
    const target = px[y * 32 + x]!;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
    const paint = new Uint32Array(ctx.getImageData(x, y, 1, 1).data.buffer)[0]!;
    if (paint === target) return;
    const stack = [y * 32 + x];
    while (stack.length) {
      const i = stack.pop()!;
      if (px[i] !== target) continue;
      px[i] = paint;
      const cx = i % 32;
      if (cx > 0) stack.push(i - 1);
      if (cx < 31) stack.push(i + 1);
      if (i >= 32) stack.push(i - 32);
      if (i < 32 * 31) stack.push(i + 32);
    }
    ctx.putImageData(image, 0, 0);
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const at = cell(event);
    if (tool === 'fill') {
      flood(at.x, at.y);
      commit();
      store();
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    last = at;
    plot(at.x, at.y);
    commit();
  };

  const onMove = (event: PointerEvent) => {
    if (!last) return;
    const at = cell(event);
    line(last, at);
    last = at;
    commit();
  };

  const onUp = () => {
    if (!last) return;
    last = null;
    store();
  };

  const onTool = (event: Event) => {
    tool = ((event.currentTarget as HTMLElement).dataset.paintTool as Tool) ?? 'pen';
    for (const b of toolButtons) b.setAttribute('aria-pressed', String(b.dataset.paintTool === tool));
  };

  const onColor = (event: Event) => {
    color = (event.currentTarget as HTMLElement).dataset.paintColor ?? color;
    for (const b of colorButtons) b.setAttribute('aria-pressed', String(b.dataset.paintColor === color));
    if (tool === 'erase') {
      tool = 'pen';
      for (const b of toolButtons) b.setAttribute('aria-pressed', String(b.dataset.paintTool === 'pen'));
    }
  };

  const onClear = () => {
    ctx.clearRect(0, 0, 32, 32);
    commit();
    store();
  };

  const onSave = () => {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'icon.png';
    a.click();
  };

  return {
    start() {
      lab.title('Paint · your own icon');
      starter();
      lab.present();
      // A drawing kept from before replaces the starter once it decodes.
      const run = ++loaded;
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(STORE_KEY);
      } catch {
        saved = null;
      }
      if (saved?.startsWith('data:image/png')) {
        const img = new Image();
        img.onload = () => {
          if (run !== loaded) return;
          ctx.clearRect(0, 0, 32, 32);
          ctx.drawImage(img, 0, 0);
          lab.present();
        };
        img.src = saved;
      }
      canvas.style.cursor = 'crosshair';
      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      for (const b of toolButtons) b.addEventListener('click', onTool);
      for (const b of colorButtons) b.addEventListener('click', onColor);
      clearButton.addEventListener('click', onClear);
      saveButton.addEventListener('click', onSave);
    },
    stop() {
      loaded++;
      cancelAnimationFrame(frame);
      frame = 0;
      last = null;
      canvas.style.cursor = '';
      canvas.style.touchAction = '';
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      for (const b of toolButtons) b.removeEventListener('click', onTool);
      for (const b of colorButtons) b.removeEventListener('click', onColor);
      clearButton.removeEventListener('click', onClear);
      saveButton.removeEventListener('click', onSave);
    },
  };
}
