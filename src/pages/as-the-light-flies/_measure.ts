// The stopwatch. The first request to each region pays for looking up its name and opening a secure
// connection, several round trips' worth; the ones after it ride the open connection and cost one
// round trip each, plus whatever the browser and server add. The quickest of those is the reading.

import { pingUrl } from './_stations';

const TIMED = 4;
const TIMEOUT_MS = 3000;

async function once(url: string): Promise<number | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const t0 = performance.now();
    const res = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: ctl.signal });
    await res.text();
    const dt = performance.now() - t0;
    return res.ok ? dt : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Times one region: the best of a few round trips on an open connection, or null for no reply. */
export async function timeRegion(id: string): Promise<number | null> {
  const url = pingUrl(id);
  if ((await once(url)) === null) return null;
  let best = Infinity;
  for (let i = 0; i < TIMED; i++) {
    const t = await once(url);
    if (t !== null) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : null;
}

/** Times every region at once, calling back as each one finishes. */
export async function timeAll(
  ids: string[],
  onReading: (index: number, rtt: number | null) => void,
): Promise<(number | null)[]> {
  return Promise.all(
    ids.map(async (id, i) => {
      const t = await timeRegion(id);
      onReading(i, t);
      return t;
    }),
  );
}
