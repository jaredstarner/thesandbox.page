// Ads that load late, above the reader, and the numbers that measure the damage:
// ad density, the way the Better Ads Standards measure it, and the page's own layout shift score.

import { rand, type Hell } from './_hell';

const LAZY: Record<string, string> = {
  local:
    `<p class="ad-label">Advertisement</p><button type="button" class="lz lz-local" data-cta="clickwell">` +
    `<span class="lz-big">Bakeries near you are furious about this one trick</span><span>Number three closed a bakery. Allegedly.</span><span class="cta">See the trick</span></button>`,
  games:
    `<p class="ad-label">Advertisement</p><button type="button" class="lz lz-games" data-cta="clickwell">` +
    `<span class="lz-big">99% of players can't pass level 2</span><span>Level 2 is the cookie banner.</span><span class="cta">Play free</span></button>`,
  mortgage:
    `<p class="ad-label">Advertisement</p><button type="button" class="lz lz-rates" data-cta="clickwell">` +
    `<span class="lz-big">Rates are toast. Refinance before lunch.</span><span>See how much you could save on things you don't own.</span><span class="cta">Check my rate</span></button>`,
  quiz:
    `<p class="ad-label">Advertisement</p><button type="button" class="lz lz-quiz" data-cta="quiz">` +
    `<span class="lz-big">Which toast are you?</span><span>Take the 30-question quiz. Question one is about clouds.</span><span class="cta">Start the quiz</span></button>`,
  plumber:
    `<p class="ad-label">Advertisement</p><button type="button" class="lz lz-plumb" data-cta="clickwell">` +
    `<span class="lz-big">Plumbers hate this one weird tap</span><span>You'll never call one again. They won't answer anyway.</span><span class="cta">See the tap</span></button>`,
  horoscope:
    `<p class="ad-label">Advertisement</p><button type="button" class="lz lz-stars" data-cta="clickwell">` +
    `<span class="lz-big">♉ Your horoscope is ready</span><span>Today you will eat toast. A stranger will mention butter.</span><span class="cta">Read more</span></button>`,
  card:
    `<p class="ad-label">Advertisement</p><button type="button" class="lz lz-card" data-cta="crumbtronic">` +
    `<span class="lz-big">Make this recipe with the CRUMBTRONIC 3000</span><span>Eleven browning presets and a cloud account.</span><span class="cta">Shop toasters</span></button>`,
};

interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

export function initShift(hell: Hell): { tick(): void; density(): number; clsSupported: boolean } {
  const post = hell.root.querySelector<HTMLElement>('[data-post]');
  const slots = [...hell.root.querySelectorAll<HTMLElement>('[data-lazy]')];
  const due = new Map<HTMLElement, number>();

  const load = (slot: HTMLElement) => {
    const html = LAZY[slot.dataset.lazy ?? ''];
    if (!html) return;
    slot.innerHTML = html;
    slot.dataset.loaded = '';
    hell.stats.shoves++;
    hell.see('layout-shift');
  };

  // CLS, by the Web Vitals definition: the largest burst of unexpected shifts, in windows
  // that close after a second's quiet or five seconds in all. Chromium only.
  const clsSupported = typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes ?? []).includes('layout-shift');
  if (clsSupported) {
    let windowValue = 0;
    let windowStart = 0;
    let last = -Infinity;
    let worst = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LayoutShift[]) {
        if (entry.hadRecentInput) continue;
        if (entry.startTime - last > 1000 || entry.startTime - windowStart > 5000) {
          windowValue = 0;
          windowStart = entry.startTime;
        }
        windowValue += entry.value;
        last = entry.startTime;
        worst = Math.max(worst, windowValue);
      }
      hell.stats.cls = worst;
    }).observe({ type: 'layout-shift', buffered: true });
  }

  return {
    clsSupported,
    // Polled rather than observed: a jump link can carry a slot from below the screen to above it
    // without ever crossing it, and an IntersectionObserver would never hear about it.
    tick() {
      if (!hell.started || hell.blocked || hell.finished) return;
      const now = performance.now();
      for (const slot of slots) {
        if ('loaded' in slot.dataset) continue;
        const pending = due.get(slot);
        if (pending === undefined) {
          if (slot.getBoundingClientRect().bottom < 0) due.set(slot, now + rand(300, 900));
        } else if (now >= pending) {
          due.delete(slot);
          load(slot);
        }
      }
    },
    density() {
      if (!post || hell.blocked) return 0;
      const total = post.getBoundingClientRect().height;
      if (!total) return 0;
      let ads = 0;
      for (const ad of post.querySelectorAll<HTMLElement>('.ad')) ads += ad.getBoundingClientRect().height;
      return Math.min(1, ads / total);
    },
  };
}
