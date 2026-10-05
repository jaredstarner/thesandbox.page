// Synthetic objects for checking the register at scale:
//   REGISTER_STRESS=300 pnpm astro dev
// Development only: nothing here is used unless that variable is set.
import type { Experiment } from '../../experiments/list';

const TAG_SETS = [
  ['css', 'has', 'container-queries'],
  ['canvas', 'web-audio'],
  ['webgl2', 'wasm'],
  ['webgpu', 'offscreen-canvas', 'web-workers'],
  ['view-transitions', 'popover', 'anchor-positioning'],
  ['eventsource', 'live-data'],
  ['getusermedia', 'web-audio', 'canvas'],
  ['scroll-driven-animations', 'at-property', 'css'],
  ['device-orientation', 'canvas'],
  ['gamepad', 'webgl'],
  ['speech-synthesis'],
  ['document-picture-in-picture', 'container-queries'],
];

const DAY = 86_400_000;

/** `count` objects, two a day, going back from the day before the first real object. */
export function stressEntries(count: number): Experiment[] {
  const start = Date.UTC(2026, 9, 2);
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => {
    const tags = TAG_SETS[i % TAG_SETS.length]!;
    return {
      slug: `stress-${i + 1}`,
      href: `/stress-${i + 1}/`,
      title: `Stress object ${i + 1}`,
      summary: 'A synthetic entry for checking the register at scale. It has no page.',
      date: new Date(start - Math.floor(i / 2) * DAY),
      tags,
      // Every third object leaves requirements uncataloged, to exercise that path.
      requires: i % 3 === 0 ? undefined : [tags[0]!],
    };
  });
}
