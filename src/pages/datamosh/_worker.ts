// The vision mixer's engine. Each reel is encoded once, in order, into a
// cached stream with a keyframe every GOP frames; live sources (camera,
// screen, a video file) are encoded as they arrive. The program output is
// one picture that every decoded frame is applied to, whichever source it
// came from.

import {
  Encoder,
  INTER,
  INTRA,
  MBS,
  W,
  H,
  copyPicture,
  decode,
  fromRGBA,
  picture,
  quality,
  toRGBA,
  type Frame,
  type Picture,
} from './_codec';
import { makeReels, type Reel } from './_reels';

export const GOP = 72;

export type FrameKind = 'key' | 'drop' | 'delta' | 'hold' | 'still';

export interface TickMessage {
  t: 'tick';
  hold: boolean;
  /** Decode keyframes; off, every keyframe is left out. */
  keyframes: boolean;
  heal: boolean;
  residual: boolean;
  /** RGBA for a live source on air. */
  live?: ArrayBuffer;
  /** A spent output buffer handed back for reuse. */
  recycle?: ArrayBuffer;
}

export type InMessage =
  | TickMessage
  | { t: 'cut'; source: string }
  | { t: 'key' }
  | { t: 'still'; id: string; rgba: ArrayBuffer }
  | { t: 'live'; id: string };

export interface FrameInfo {
  kind: FrameKind;
  bits: number;
  source: string;
  pos: number;
  length: number;
  modes: Uint8Array | null;
  mvx: Int8Array | null;
  mvy: Int8Array | null;
}

export type OutMessage =
  | { t: 'ready'; reels: { id: string; name: string; length: number }[] }
  | { t: 'poster'; id: string; bitmap: ImageBitmap }
  | { t: 'frame'; rgba: ArrayBuffer; info: FrameInfo }
  | { t: 'cached'; id: string; frames: number; length: number };

interface Source {
  id: string;
  kind: 'reel' | 'live' | 'still';
  encoder: Encoder;
  reel?: Reel;
  frames: Frame[];
  pos: number;
  still?: Picture;
  stillKey?: Frame;
  count: number;
}

const q = quality(1.4);
const sources = new Map<string, Source>();
const spare = new Encoder(q);
const rgba = new Uint8ClampedArray(W * H * 4);
const input = picture();
let cur = picture(16);
let nxt = picture(16);
let onAir: Source | null = null;
let pendingCut: string | null = null;
let wantKey = false;
let cutToStill = false;
let lastDelta: Frame | null = null;

const post = (m: OutMessage, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(m, transfer);

function encodeNext(src: Source) {
  const reel = src.reel!;
  const k = src.frames.length;
  reel.render(k, rgba);
  fromRGBA(rgba, input);
  src.frames.push(src.encoder.encode(input, k % GOP === 0));
  if (src.frames.length === reel.length || src.frames.length % 24 === 0) {
    post({ t: 'cached', id: src.id, frames: src.frames.length, length: reel.length });
  }
}

function reelFrame(src: Source, pos: number) {
  while (src.frames.length <= pos) encodeNext(src);
  return src.frames[pos];
}

/** An intra-coded picture of what a source shows right now, for the Key button. */
function freshKey(src: Source): Frame {
  if (src.kind === 'reel') {
    src.reel!.render(src.pos, rgba);
    fromRGBA(rgba, input);
  } else if (src.kind === 'still') {
    copyPicture(src.still!, input);
  }
  spare.reset();
  return spare.encode(input, true);
}

function apply(frame: Frame, opts: { heal: boolean; residual: boolean }) {
  decode(frame, q, cur, nxt, opts);
  [cur, nxt] = [nxt, cur];
}

function moves(frame: Frame) {
  for (let i = 0; i < MBS; i++) if (frame.modes[i] === INTER && (frame.mvx[i] || frame.mvy[i])) return true;
  return false;
}

function tick(m: TickMessage) {
  if (pendingCut) {
    const next = sources.get(pendingCut);
    pendingCut = null;
    if (next) {
      onAir = next;
      if (next.kind === 'live') {
        next.encoder.reset();
        next.count = 0;
      }
      cutToStill = next.kind === 'still';
    }
  }
  const src = onAir;
  const opts = { heal: m.heal, residual: m.residual };
  let kind: FrameKind = 'still';
  let frame: Frame | null = null;
  let pos = 0;
  let length = 0;

  if (m.hold && lastDelta) {
    frame = lastDelta;
    apply(frame, opts);
    kind = 'hold';
  } else if (src) {
    if (src.kind === 'reel') {
      pos = src.pos;
      length = src.reel!.length;
      frame = wantKey ? freshKey(src) : reelFrame(src, pos);
      src.pos = (pos + 1) % length;
    } else if (src.kind === 'live' && m.live) {
      fromRGBA(new Uint8ClampedArray(m.live), input);
      frame = src.encoder.encode(input, wantKey || src.count % GOP === 0);
      pos = src.count++;
    } else if (src.kind === 'still' && (cutToStill || wantKey)) {
      frame = src.stillKey!;
    }
    if (frame) {
      if (frame.key) {
        if (m.keyframes || wantKey || cutToStill) {
          apply(frame, opts);
          kind = 'key';
        } else {
          kind = 'drop';
        }
      } else {
        apply(frame, opts);
        kind = 'delta';
        if (moves(frame)) lastDelta = frame;
      }
    }
    wantKey = false;
    cutToStill = false;
  }

  const out = m.recycle && m.recycle.byteLength === W * H * 4 ? new Uint8ClampedArray(m.recycle) : new Uint8ClampedArray(W * H * 4);
  toRGBA(cur, out);
  const info: FrameInfo = {
    kind,
    bits: frame ? frame.bits : 0,
    source: src?.id ?? '',
    pos,
    length,
    modes: frame ? frame.modes.slice() : null,
    mvx: frame ? frame.mvx.slice() : null,
    mvy: frame ? frame.mvy.slice() : null,
  };
  if (frame?.key) info.modes!.fill(INTRA);
  post({ t: 'frame', rgba: out.buffer, info }, [out.buffer]);
  schedule();
}

// Encode ahead while idle: the reel on air first, then the rest from their starts.
let idle = 0;
function schedule() {
  clearTimeout(idle);
  idle = self.setTimeout(work, 4);
}
function work() {
  const reels = [...sources.values()].filter((s) => s.kind === 'reel' && s.frames.length < s.reel!.length);
  if (!reels.length) return;
  const air = onAir?.kind === 'reel' && reels.includes(onAir) ? onAir : null;
  const target = air && air.frames.length < air.pos + 48 ? air : reels.reduce((a, b) => (a.frames.length <= b.frames.length ? a : b));
  encodeNext(target);
  idle = self.setTimeout(work, 0);
}

async function posters(reels: Reel[]) {
  const full = new OffscreenCanvas(W, H);
  const fctx = full.getContext('2d')!;
  const img = fctx.createImageData(W, H);
  for (const reel of reels) {
    reel.render(Math.floor(reel.length * 0.3), img.data);
    fctx.putImageData(img, 0, 0);
    const small = new OffscreenCanvas(192, 108);
    const sctx = small.getContext('2d')!;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(full, 0, 0, 192, 108);
    const bitmap = small.transferToImageBitmap();
    post({ t: 'poster', id: reel.id, bitmap }, [bitmap]);
  }
}

function init() {
  const reels = makeReels();
  for (const reel of reels) {
    sources.set(reel.id, { id: reel.id, kind: 'reel', encoder: new Encoder(q), reel, frames: [], pos: 0, count: 0 });
  }
  post({ t: 'ready', reels: reels.map(({ id, name, length }) => ({ id, name, length })) });
  void posters(reels).then(schedule);
}

self.onmessage = (e: MessageEvent<InMessage>) => {
  const m = e.data;
  switch (m.t) {
    case 'tick':
      tick(m);
      break;
    case 'cut':
      pendingCut = m.source;
      break;
    case 'key':
      wantKey = true;
      break;
    case 'still': {
      fromRGBA(new Uint8ClampedArray(m.rgba), input);
      const still = picture();
      copyPicture(input, still);
      spare.reset();
      const stillKey = spare.encode(still, true);
      const existing = sources.get(m.id);
      if (existing) {
        existing.still = still;
        existing.stillKey = stillKey;
      } else {
        sources.set(m.id, { id: m.id, kind: 'still', encoder: spare, frames: [], pos: 0, still, stillKey, count: 0 });
      }
      break;
    }
    case 'live':
      if (!sources.has(m.id) || sources.get(m.id)!.kind !== 'live') {
        sources.set(m.id, { id: m.id, kind: 'live', encoder: new Encoder(q), frames: [], pos: 0, count: 0 });
      }
      break;
  }
};

init();
