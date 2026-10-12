// Marbling: the trough, the bench of tools, and the line the prints dry on.

import { drawSheen, drawTrough } from './_render';

export function startMarbling(root: HTMLElement): void {
  const stage = root.querySelector<HTMLElement>('[data-stage]');
  const canvas = root.querySelector<HTMLCanvasElement>('[data-tray]');
  const ctx = canvas?.getContext('2d');
  if (!stage || !canvas || !ctx) return;
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const rim = 20;
  const scale = Math.min((r.width - rim * 2) / 1200, (r.height - rim * 2) / 800);
  const cssW = 1200 * scale + rim * 2;
  const cssH = 800 * scale + rim * 2;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.drawImage(drawTrough(canvas.width, canvas.height, rim * dpr, dpr), 0, 0);
  ctx.drawImage(drawSheen(canvas.width, canvas.height, rim * dpr, dpr), 0, 0);
}
