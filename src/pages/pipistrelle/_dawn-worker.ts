// Paints the first-light view off the main thread, so the night never stutters.

import { buildWorld } from './_world';
import { paintDawn } from './_dawn';

const world = buildWorld();
const { width, height, data } = paintDawn(world);
(self as unknown as Worker).postMessage({ width, height, data }, [data.buffer]);
