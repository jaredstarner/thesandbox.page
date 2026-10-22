// The page half of /sea-sparkle/: reports where this window sits on the
// screen, sends input to the tank, and draws the water it sends back.

export function start(root: HTMLElement) {
  root.querySelector<HTMLElement>('[data-hint]')!.textContent = 'Filling the tank.';
}
