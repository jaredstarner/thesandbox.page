// The shared state every part of the page reports to.

export interface Stats {
  adClicks: number;
  fakeCloses: number;
  closed: number;
  windows: number;
  cookieClicks: number;
  cookieOutcome: 'accepted' | 'rejected' | 'partial' | null;
  shoves: number;
  peakDensity: number;
  cls: number | null;
  blockedMs: number;
}

export interface Hell {
  root: HTMLElement;
  site: HTMLElement;
  readonly blocked: boolean;
  readonly finished: boolean;
  /** True once the prestitial is gone and the ad clock may run. */
  readonly started: boolean;
  reducedMotion: boolean;
  stats: Stats;
  /** Milliseconds on the ad clock, which only runs while the reader can be interrupted. */
  adNow(): number;
  /** Run fn after delay on the ad clock. */
  at(delay: number, fn: () => void): void;
  see(id: string): void;
  /** A click on an ad: a call to action, or a close button that was part of the ad. */
  adClick(brand: string, fake?: boolean): void;
  openModal(name: string): void;
  closeModal(name: string): void;
  onBlock(fn: (blocked: boolean) => void): void;
}

export const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

export const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

export const clock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};
