// Wires the slime mold page: finds a GPU, or says why it can't.

export async function startSlime(root: HTMLElement): Promise<void> {
  const unsupported = root.querySelector<HTMLElement>('[data-unsupported]')!;
  const gpu = navigator.gpu;
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
  if (!adapter) {
    unsupported.textContent = gpu
      ? 'This browser has WebGPU but found no GPU adapter to grow the plate on. Try another browser, or check that hardware acceleration is on.'
      : "This plate grows on the GPU with WebGPU, and this browser doesn't offer it. Recent Chrome, Edge, Safari, and Firefox do.";
    unsupported.hidden = false;
    root.querySelector<HTMLElement>('.bench')!.hidden = true;
  }
}
