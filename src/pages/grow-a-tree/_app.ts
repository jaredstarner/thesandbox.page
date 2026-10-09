// Grow a tree: wires the page to the growth model, the renderer, and the sound.

export function startArbor(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-view]');
  const fallback = root.querySelector<HTMLElement>('[data-fallback]');
  const gl = canvas?.getContext('webgl2');
  if (!canvas || !gl) {
    if (fallback) fallback.hidden = false;
    root.dataset.state = 'unsupported';
    return;
  }
  root.dataset.state = 'ready';
}
