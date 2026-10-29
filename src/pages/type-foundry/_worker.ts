// Casts fonts off the main thread, so dragging a control never waits on the font writer.

import { cast } from './_font';
import type { Params } from './_skeleton';

interface Job {
  id: number;
  params: Params;
  family: string;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, params, family } = e.data;
  try {
    const buffer = cast(params, family);
    (self as unknown as Worker).postMessage({ id, buffer }, [buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
