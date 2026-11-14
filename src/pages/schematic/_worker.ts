// Runs the layout off the main thread and sends back every sweep's key positions.

import { layout, type LayoutInput } from './_layout';

interface Job {
  id: number;
  input: LayoutInput;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, input } = e.data;
  const { frames } = layout(input);
  (self as unknown as Worker).postMessage(
    { id, frames },
    frames.map((f) => f.buffer as ArrayBuffer),
  );
};
