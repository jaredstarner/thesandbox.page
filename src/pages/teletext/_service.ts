// The service: every page number in transmission, how to build its subpages
// from what the newsroom has, and where its Fastext keys go.

import type { Page } from './_page';
import type { Links } from './_layout';

export interface Def {
  build: () => Page[];
  links: Links | ((sub: number) => Links);
  /** Rebuilt every second while on screen (clocks). */
  live?: boolean;
  /** In transmission only while this holds (stories that exist today). */
  exists?: () => boolean;
}

export class Service {
  private defs = new Map<number, Def>();
  private listeners: ((n?: number) => void)[] = [];

  add(n: number, def: Def): void {
    this.defs.set(n, def);
  }

  numbers(): number[] {
    return [...this.defs.entries()]
      .filter(([, d]) => !d.exists || d.exists())
      .map(([n]) => n)
      .sort((a, b) => a - b);
  }

  has(n: number): boolean {
    const d = this.defs.get(n);
    return !!d && (!d.exists || d.exists());
  }

  build(n: number): Page[] {
    const d = this.defs.get(n);
    return d ? d.build() : [];
  }

  links(n: number, sub: number): Links {
    const d = this.defs.get(n);
    if (!d) return [0, 0, 0, 0];
    return typeof d.links === 'function' ? d.links(sub) : d.links;
  }

  live(n: number): boolean {
    return !!this.defs.get(n)?.live;
  }

  onUpdate(fn: (n?: number) => void): void {
    this.listeners.push(fn);
  }

  /** Tells the set that pages changed; undefined means any page may have. */
  updated(n?: number): void {
    for (const fn of this.listeners) fn(n);
  }
}
