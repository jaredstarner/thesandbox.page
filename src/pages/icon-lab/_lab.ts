// What every program gets from the lab, and what it hands back.

export type ProgramId = 'snake' | 'clock' | 'paint' | 'native' | 'gamut' | 'strip';

export const PROGRAM_IDS: readonly ProgramId[] = ['snake', 'clock', 'paint', 'native', 'gamut', 'strip'];

export interface Program {
  /** Take over the tab icon and the mirror. */
  start(): void;
  /** Stop every timer, listener, and sound the program started. */
  stop(): void;
}

export interface Lab {
  root: HTMLElement;
  /** The 32 by 32 framebuffer, shown enlarged as the mirror. */
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Push the framebuffer to the tab icon. */
  present(): void;
  /** Point the tab icon at any URL; the mirror shows the same file. */
  showImage(href: string, type: string, smooth?: boolean): void;
  /** Go back to showing the framebuffer in the mirror. */
  showCanvas(): void;
  /** Set the tab's title, and the enlarged one. */
  title(text: string): void;
  /** The panel element for a program. */
  panel(id: ProgramId): HTMLElement;
}
