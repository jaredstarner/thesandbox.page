// Solves pictures into codes off the main thread, and picks masks.

import { solve, type SolveInput } from './_art';
import { penalty, sizeOf, type Level } from './_qr';

export type Request =
  | { id: number; kind: 'solve'; input: SolveInput }
  | { id: number; kind: 'mask'; version: number; level: Level; text: string; seed: number };

export type Reply =
  | { id: number; kind: 'solve'; out: ReturnType<typeof solve> }
  | { id: number; kind: 'mask'; mask: number }
  | { id: number; kind: 'error'; message: string };

const post = (msg: Reply, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: Reply, t: Transferable[]): void }).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    if (req.kind === 'solve') {
      const out = solve(req.input);
      post({ id: req.id, kind: 'solve', out }, [
        out.modules.buffer,
        out.clean.buffer,
        out.unmet.buffer,
        out.message.buffer,
      ]);
    } else {
      // The mask with the lowest standard penalty for the code with no picture.
      const size = sizeOf(req.version);
      const target = new Int8Array(size * size).fill(-1);
      const weight = new Float32Array(size * size);
      let best = 0;
      let bestScore = Infinity;
      for (let mask = 0; mask < 8; mask++) {
        const out = solve({
          version: req.version,
          level: req.level,
          mask,
          text: req.text,
          target,
          weight,
          spend: 0,
          seed: req.seed,
        });
        const score = penalty(out.modules, size);
        if (score < bestScore) {
          bestScore = score;
          best = mask;
        }
      }
      post({ id: req.id, kind: 'mask', mask: best });
    }
  } catch (err) {
    post({ id: req.id, kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
