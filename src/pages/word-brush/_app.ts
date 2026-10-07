// Word brush: wires the sheet, the brush, and the tools together.

export function startWordBrush(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-sheet]');
  if (!canvas) return;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  };
  resize();
  window.addEventListener('resize', resize);
}
