import type { Lab, Program } from './_lab';
import { CICP_BT2020_PQ, CICP_P3_SRGB, encodePng, pqEncode, srgbEncode, toDataUrl } from './_png';

// Two test icons written in the browser: a Display P3 file whose halves are
// sRGB's reddest red and P3's, and a PQ HDR file whose halves are SDR white
// and 1,000 nit white. The tab and the in-page copies can then be compared.

type Kind = 'p3' | 'hdr';

const SIZE = 32;
const NAMES: Record<Kind, string> = { p3: 'Wide color', hdr: 'HDR' };

/** sRGB's red, in linear Display P3. */
const SRGB_RED_IN_P3 = [0.8225, 0.0332, 0.0171] as const;

function halves(left: readonly number[], right: readonly number[], frame: readonly number[]): Float32Array {
  const rgb = new Float32Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const edge = x < 2 || y < 2 || x >= SIZE - 2 || y >= SIZE - 2;
      rgb.set(edge ? frame : x < SIZE / 2 ? left : right, (y * SIZE + x) * 3);
    }
  }
  return rgb;
}

async function build(): Promise<Record<Kind, string>> {
  const frame = [0.0085, 0.0062, 0.0037].map(srgbEncode);
  const p3 = halves(SRGB_RED_IN_P3.map(srgbEncode), [1, 0, 0], frame);
  const sdr = pqEncode(203);
  const bright = pqEncode(1000);
  const dark = pqEncode(2);
  const hdr = halves([sdr, sdr, sdr], [bright, bright, bright], [dark, dark, dark]);
  const [a, b] = await Promise.all([encodePng(SIZE, p3, CICP_P3_SRGB), encodePng(SIZE, hdr, CICP_BT2020_PQ)]);
  return { p3: toDataUrl(a), hdr: toDataUrl(b) };
}

export function createGamut(lab: Lab): Program {
  const panel = lab.panel('gamut');
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>('[data-gamut]')];
  const images = {
    p3: panel.querySelector<HTMLImageElement>('[data-gamut-img="p3"]')!,
    hdr: panel.querySelector<HTMLImageElement>('[data-gamut-img="hdr"]')!,
  };
  const gamutEl = panel.querySelector<HTMLElement>('[data-gamut-gamut]')!;
  const rangeEl = panel.querySelector<HTMLElement>('[data-gamut-range]')!;
  const note = panel.querySelector<HTMLElement>('[data-gamut-note]')!;

  let kind: Kind = 'p3';
  let urls: Promise<Record<Kind, string>> | null = null;
  let active = false;

  const show = async () => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.gamut === kind));
    lab.title(`Gamut · ${NAMES[kind]}`);
    if (!urls) return;
    try {
      const ready = await urls;
      if (active) lab.showImage(ready[kind], 'image/png');
    } catch {
      note.textContent = "The page couldn't write its test icons in this browser.";
    }
  };

  const onPick = (event: Event) => {
    kind = (event.currentTarget as HTMLElement).dataset.gamut === 'hdr' ? 'hdr' : 'p3';
    void show();
  };

  const media = (query: string) => matchMedia(query).matches;

  return {
    start() {
      active = true;
      gamutEl.textContent = media('(color-gamut: rec2020)')
        ? 'Rec. 2020'
        : media('(color-gamut: p3)')
          ? 'Display P3'
          : media('(color-gamut: srgb)')
            ? 'sRGB'
            : 'Unknown';
      rangeEl.textContent = media('(dynamic-range: high)') ? 'High (HDR)' : 'Standard';
      if (typeof CompressionStream !== 'function') {
        note.textContent = "This browser has no CompressionStream, so the page can't write its test icons.";
      } else {
        urls ??= build().then((ready) => {
          images.p3.src = ready.p3;
          images.hdr.src = ready.hdr;
          return ready;
        });
      }
      void show();
      for (const b of buttons) b.addEventListener('click', onPick);
    },
    stop() {
      active = false;
      for (const b of buttons) b.removeEventListener('click', onPick);
    },
  };
}
