// Loads each work's picture at the size it is shown, from the museum's IIIF image server, with the blurred
// placeholder the API sends standing in until the first size arrives.

import { imageUrl, widthFor, type Rec } from './_works';

interface Entry {
  img: HTMLImageElement;
  width: number;
  ready: boolean;
  failed: boolean;
}

const MAX_LOADS = 6;

export class Images {
  private byWork = new Map<string, Entry[]>();
  private lqip = new Map<string, HTMLImageElement>();
  private queue: { rec: Rec; width: number }[] = [];
  private loading = 0;

  constructor(private onLoad: () => void) {}

  /** The best picture on hand for drawing `px` device pixels wide; asks for a better one when needed. */
  get(rec: Rec, px: number): HTMLImageElement | null {
    const want = widthFor(rec, px);
    const list = this.byWork.get(rec.image) ?? [];
    if (!list.some((e) => e.width === want)) this.request(rec, want);
    let best: Entry | null = null;
    for (const e of list) {
      if (!e.ready) continue;
      // The smallest at or above the wanted size, else the largest below it.
      if (!best) best = e;
      else if (e.width >= want ? best.width < want || e.width < best.width : best.width < want && e.width > best.width)
        best = e;
    }
    if (best) return best.img;
    return this.placeholder(rec);
  }

  /** True once any real picture of the work has loaded. */
  has(rec: Rec): boolean {
    return (this.byWork.get(rec.image) ?? []).some((e) => e.ready);
  }

  private placeholder(rec: Rec): HTMLImageElement | null {
    if (!rec.lqip) return null;
    let img = this.lqip.get(rec.image);
    if (!img) {
      img = new Image();
      img.onload = () => this.onLoad();
      img.src = rec.lqip;
      this.lqip.set(rec.image, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  private request(rec: Rec, width: number) {
    const list = this.byWork.get(rec.image) ?? [];
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const entry: Entry = { img, width, ready: false, failed: false };
    list.push(entry);
    this.byWork.set(rec.image, list);
    this.queue.push({ rec, width });
    this.pump();
  }

  private pump() {
    while (this.loading < MAX_LOADS && this.queue.length) {
      const { rec, width } = this.queue.shift()!;
      const entry = this.byWork.get(rec.image)!.find((e) => e.width === width)!;
      this.loading++;
      entry.img.onload = () => {
        entry.ready = true;
        this.loading--;
        this.onLoad();
        this.pump();
      };
      entry.img.onerror = () => {
        entry.failed = true;
        this.loading--;
        this.pump();
      };
      entry.img.src = imageUrl(rec, width);
    }
  }
}
