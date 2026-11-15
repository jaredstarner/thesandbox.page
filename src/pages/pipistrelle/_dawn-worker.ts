// Paints the day view and the lamp's patch off the main thread, so the night never stutters.

import { buildWorld } from './_world';
import { buildHeights, buildSunShadow, paintDawn, paintLamp } from './_dawn';

const world = buildWorld();
const H = buildHeights(world);
const lamp = paintLamp(world, H);
(self as unknown as Worker).postMessage({ kind: 'lamp', ...lamp }, [lamp.data.buffer]);
const S = buildSunShadow(H);
const day = paintDawn(world, H, S);
(self as unknown as Worker).postMessage({ kind: 'day', ...day }, [day.data.buffer]);
