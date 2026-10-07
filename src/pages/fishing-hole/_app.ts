// The fishing hole: wires the lake, the angler, and the page's controls together.

export function startFishing(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-view]');
  const unsupported = root.querySelector<HTMLElement>('[data-unsupported]');
  if (!canvas) return;

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) {
    if (unsupported) {
      unsupported.textContent = 'This lake is drawn with WebGL 2, which this browser did not open.';
      unsupported.hidden = false;
    }
    root.dataset.state = 'unsupported';
    return;
  }
}
