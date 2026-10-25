// The page: a program monitor fed by the worker, a source bus, the switches
// that decide how frames are decoded, and a meter of what went through.

import { H, INTER, INTRA, MBH, MBW, SKIP, W } from './_codec';
import type { FrameInfo, InMessage, OutMessage, TickMessage } from './_worker';

const FPS = 24;
const REEL_KEYS = ['bars', 'spin', 'tunnel', 'window', 'koi', 'balloons', 'camera', 'screen', 'file'];
const LIVE = new Set(['camera', 'screen', 'file']);

interface Settings {
  keyframes: 'drop' | 'keep';
  intra: 'heal' | 'smear';
  residual: 'on' | 'off';
  vectors: boolean;
  blocks: boolean;
}

interface Bar {
  kind: FrameInfo['kind'];
  bits: number;
  cut: string | null;
}

// The autopilot's running order, in seconds of program time: mostly a clean
// shot, then a cut without its keyframe, so each mosh starts from a picture
// you've just seen.
const SCRIPT: { at: number; cut?: string; hold?: number; key?: boolean }[] = [
  { at: 2.2, cut: 'spin' },
  { at: 4.6, key: true },
  { at: 5.6, cut: 'tunnel' },
  { at: 7.4, hold: 1.4 },
  { at: 9.6, key: true },
  { at: 10.4, cut: 'window' },
  { at: 13.0, key: true },
  { at: 14.0, cut: 'koi' },
  { at: 16.0, hold: 1.1 },
  { at: 17.6, key: true },
  { at: 18.6, cut: 'balloons' },
  { at: 21.6, key: true },
  { at: 22.4, cut: 'spin' },
  { at: 24.6, cut: 'tunnel' },
  { at: 26.0, hold: 1.2 },
  { at: 28.6, cut: 'bars' },
];
const SCRIPT_LENGTH = 30.6;

export function start(root: HTMLElement) {
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const picture = $<HTMLCanvasElement>('[data-picture]');
  const overlay = $<HTMLCanvasElement>('[data-overlay]');
  const strip = $<HTMLCanvasElement>('[data-strip]');
  const screen = $<HTMLElement>('[data-screen]');
  const status = $<HTMLElement>('[data-status]');
  const hint = $<HTMLElement>('[data-hint]');

  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') {
    $<HTMLElement>('[data-unsupported]').hidden = false;
    hint.hidden = true;
    return;
  }

  const pctx = picture.getContext('2d')!;
  const octx = overlay.getContext('2d')!;
  const sctx = strip.getContext('2d')!;
  const worker = new Worker(new URL('./_worker.ts', import.meta.url), { type: 'module' });
  const send = (m: InMessage, transfer: Transferable[] = []) => worker.postMessage(m, transfer);

  const settings: Settings = { keyframes: 'drop', intra: 'heal', residual: 'on', vectors: false, blocks: false };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let auto = !reduced;
  let held = false;
  let autoHoldUntil = 0;
  let onAir = 'bars';
  const names = new Map<string, string>([
    ['bars', 'Bars'],
    ['camera', 'Camera'],
    ['screen', 'Screen'],
    ['file', 'File'],
  ]);
  let inflight = false;
  let lastTick = 0;
  let programFrames = 0;
  let autoClock = 0;
  let autoStep = 0;
  let recycle: ArrayBuffer | undefined;
  let lastInfo: FrameInfo | null = null;
  const bars: Bar[] = [];
  let pendingCutMark: string | null = null;

  // ------------------------------------------------ live sources

  const grab = new OffscreenCanvas(W, H);
  const gctx = grab.getContext('2d', { willReadFrequently: true })!;
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let mirror = false;
  let fileUrl: string | null = null;
  let fileKind: 'image' | 'video' | null = null;

  function stopLive() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute('src');
      video.load();
    }
    video = null;
  }

  function cover(ctx: OffscreenCanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, flip: boolean) {
    const scale = Math.max(W / sw, H / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.save();
    if (flip) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
  }

  function grabLive(): ArrayBuffer | undefined {
    if (!video || video.readyState < 2 || !video.videoWidth) return undefined;
    gctx.fillStyle = '#000';
    gctx.fillRect(0, 0, W, H);
    cover(gctx, video, video.videoWidth, video.videoHeight, mirror);
    return gctx.getImageData(0, 0, W, H).data.buffer;
  }

  async function startVideo(media: MediaStream | string, flip: boolean) {
    stopLive();
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.loop = true;
    if (typeof media === 'string') v.src = media;
    else {
      stream = media;
      v.srcObject = media;
    }
    video = v;
    mirror = flip;
    await v.play();
  }

  async function liveSource(id: string) {
    try {
      if (id === 'camera') {
        say('Asking for the camera…');
        const media = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' },
          audio: false,
        });
        await startVideo(media, true);
        say('Move, and the picture moves with you. Key shows the camera as it is.');
      } else if (id === 'screen') {
        const media = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        media.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (onAir === 'screen') cut('bars');
        });
        await startVideo(media, false);
        say('Scroll or drag a window, and the picture follows.');
      }
      send({ t: 'live', id });
      cut(id, true);
    } catch {
      say(
        id === 'camera'
          ? "The camera wasn't available, or permission was refused."
          : "Screen capture wasn't started, or isn't available here.",
      );
    }
  }

  const fileInput = $<HTMLInputElement>('[data-file]');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    $<HTMLElement>('[data-file-name]').textContent = file.name;
    names.set('file', file.name);
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = URL.createObjectURL(file);
    try {
      if (file.type.startsWith('image/')) {
        stopLive();
        const bitmap = await createImageBitmap(file);
        gctx.fillStyle = '#000';
        gctx.fillRect(0, 0, W, H);
        cover(gctx, bitmap, bitmap.width, bitmap.height, false);
        bitmap.close();
        const data = gctx.getImageData(0, 0, W, H).data.buffer;
        send({ t: 'still', id: 'file', rgba: data }, [data]);
        fileKind = 'image';
        say('Your picture is on air. Cut to a moving reel and it gets dragged along.');
      } else {
        await startVideo(fileUrl, false);
        send({ t: 'live', id: 'file' });
        fileKind = 'video';
        say('Playing your video, muted, on a loop.');
      }
      cut('file', true);
    } catch {
      say("That file couldn't be opened here.");
    }
  });

  // ------------------------------------------------ the slate

  async function slate() {
    const c = new OffscreenCanvas(W, H);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    // Colour bars at 75%, after the broadcast test signal, with the reverse row and a pluge strip.
    const top = ['#bfbfbf', '#bfbf00', '#00bfbf', '#00bf00', '#bf00bf', '#bf0000', '#0000bf'];
    const mid = ['#0000bf', '#131313', '#bf00bf', '#131313', '#00bfbf', '#131313', '#bfbfbf'];
    const bw = W / 7;
    top.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(i * bw), 0, Math.ceil(bw), 192);
    });
    mid.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(i * bw), 192, Math.ceil(bw), 24);
    });
    const low: [string, number][] = [
      ['#00214c', 1.25],
      ['#ffffff', 1.25],
      ['#32006a', 1.25],
      ['#131313', 1.25],
      ['#090909', 0.333],
      ['#131313', 0.333],
      ['#1d1d1d', 0.334],
      ['#131313', 1],
    ];
    let x = 0;
    for (const [col, w] of low) {
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x), 216, Math.ceil(w * bw), H - 216);
      x += w * bw;
    }
    try {
      await document.fonts.load('800 40px "Martian Mono"');
    } catch {
      /* the fallback face will do */
    }
    const face = getComputedStyle(root).getPropertyValue('--font-datamosh') || 'monospace';
    ctx.fillStyle = '#0d0c0b';
    ctx.fillRect(122, 86, 268, 64);
    ctx.fillStyle = '#ebe6dc';
    ctx.font = `800 30px ${face}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DATAMOSH', W / 2, 112);
    ctx.font = `400 10px ${face}`;
    ctx.fillStyle = '#8c867b';
    ctx.fillText('THESANDBOX.PAGE', W / 2, 136);
    const poster = root.querySelector<HTMLCanvasElement>('[data-poster="bars"]');
    poster?.getContext('2d')?.drawImage(c, 0, 0, poster.width, poster.height);
    const data = ctx.getImageData(0, 0, W, H).data.buffer;
    send({ t: 'still', id: 'bars', rgba: data }, [data]);
  }

  // ------------------------------------------------ the bus

  function cut(id: string, byHand = false) {
    if (byHand) stopAuto();
    if (!LIVE.has(id)) say('');
    // Cameras and screens are only held open while they're on air.
    if (id !== onAir && LIVE.has(onAir) && !LIVE.has(id)) stopLive();
    onAir = id;
    pendingCutMark = id;
    send({ t: 'cut', source: id });
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-source]')) {
      b.setAttribute('aria-pressed', String(b.dataset.source === id));
    }
    $<HTMLElement>('[data-tally-name]').textContent = names.get(id) ?? id;
  }

  function choose(id: string) {
    if (id === 'camera' || id === 'screen') {
      stopAuto();
      void liveSource(id);
    } else if (id === 'file') {
      stopAuto();
      // A file already loaded comes back on air; pressing it again on air picks another.
      if (!fileKind || onAir === 'file') fileInput.click();
      else if (fileKind === 'video' && fileUrl) {
        void startVideo(fileUrl, false).then(() => cut('file', true));
      } else cut('file', true);
    } else {
      cut(id, true);
    }
  }

  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-source]')) {
    b.addEventListener('click', () => choose(b.dataset.source!));
  }
  // Phones and some browsers have no screen capture; leave the button out rather than fail.
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
    $<HTMLElement>('[data-source="screen"]').hidden = true;
  }
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    $<HTMLElement>('[data-source="camera"]').hidden = true;
  }

  function stopAuto() {
    auto = false;
    autoHoldUntil = 0;
    $<HTMLElement>('[data-auto]').setAttribute('aria-pressed', 'false');
  }

  $<HTMLButtonElement>('[data-auto]').addEventListener('click', () => {
    if (auto) {
      stopAuto();
      return;
    }
    auto = true;
    autoClock = 0;
    autoStep = 0;
    $<HTMLElement>('[data-auto]').setAttribute('aria-pressed', 'true');
  });

  // ------------------------------------------------ switches

  const syncSwitches = () => {
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-set]')) {
      const key = b.dataset.set as 'keyframes' | 'intra' | 'residual';
      b.setAttribute('aria-pressed', String(settings[key] === b.dataset.value));
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
      b.setAttribute('aria-pressed', String(settings[b.dataset.toggle as 'vectors' | 'blocks']));
    }
    drawOverlay();
  };
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-set]')) {
    b.addEventListener('click', () => {
      (settings as unknown as Record<string, string>)[b.dataset.set!] = b.dataset.value!;
      syncSwitches();
    });
  }
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
    b.addEventListener('click', () => {
      const key = b.dataset.toggle as 'vectors' | 'blocks';
      settings[key] = !settings[key];
      syncSwitches();
    });
  }

  // ------------------------------------------------ hold, key, record

  const holdButton = $<HTMLButtonElement>('[data-hold]');
  const setHold = (on: boolean) => {
    if (on) stopAuto();
    held = on;
    holdButton.setAttribute('aria-pressed', String(on));
    screen.classList.toggle('held', on);
    if (on) hint.classList.add('gone');
  };
  const pressHold = (el: HTMLElement) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointers can't be captured */
      }
      setHold(true);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      el.addEventListener(type, () => setHold(false));
    }
  };
  pressHold(screen);
  pressHold(holdButton);
  holdButton.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') setHold(true);
  });
  holdButton.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') setHold(false);
  });

  const key = () => {
    stopAuto();
    send({ t: 'key' });
  };
  $<HTMLButtonElement>('[data-key]').addEventListener('click', key);

  // Recording draws the program at twice its size and hands it to MediaRecorder.
  const recButton = $<HTMLButtonElement>('[data-record]');
  const save = $<HTMLAnchorElement>('[data-save]');
  const lamp = $<HTMLElement>('[data-rec-lamp]');
  let recorder: MediaRecorder | null = null;
  let recCanvas: HTMLCanvasElement | null = null;
  let recStart = 0;
  let saveUrl: string | null = null;
  const recordType = () =>
    ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(
      (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
    );
  function toggleRecord() {
    if (recorder) {
      recorder.stop();
      return;
    }
    const type = recordType();
    if (!type || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
      say("This browser can't record the canvas.");
      return;
    }
    recCanvas = document.createElement('canvas');
    recCanvas.width = W * 2;
    recCanvas.height = H * 2;
    recCanvas.getContext('2d')!.drawImage(picture, 0, 0, W * 2, H * 2);
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(recCanvas.captureStream(FPS), { mimeType: type, videoBitsPerSecond: 8_000_000 });
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: type.split(';')[0] });
      if (saveUrl) URL.revokeObjectURL(saveUrl);
      saveUrl = URL.createObjectURL(blob);
      save.href = saveUrl;
      save.download = `datamosh.${type.includes('mp4') ? 'mp4' : 'webm'}`;
      const seconds = Math.round((performance.now() - recStart) / 1000);
      save.textContent = `Save the recording (${seconds} s, ${(blob.size / 1e6).toFixed(1)} MB)`;
      save.hidden = false;
      recorder = null;
      recCanvas = null;
      lamp.hidden = true;
      recButton.setAttribute('aria-pressed', 'false');
    };
    recorder.start(1000);
    recStart = performance.now();
    lamp.hidden = false;
    save.hidden = true;
    recButton.setAttribute('aria-pressed', 'true');
  }
  recButton.addEventListener('click', toggleRecord);

  function say(text: string) {
    status.textContent = text;
  }

  // ------------------------------------------------ keyboard

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select')) return;
    if (e.code === 'Space') {
      if (target.closest('button, a')) return;
      e.preventDefault();
      if (!e.repeat) setHold(true);
      return;
    }
    if (e.repeat) return;
    const n = Number(e.key);
    if (n >= 1 && n <= REEL_KEYS.length) choose(REEL_KEYS[n - 1]);
    else if (e.key === 'k' || e.key === 'K') key();
    else if (e.key === 'r' || e.key === 'R') toggleRecord();
    else if (e.key === 'v' || e.key === 'V') {
      settings.vectors = !settings.vectors;
      syncSwitches();
    } else if (e.key === 'b' || e.key === 'B') {
      settings.blocks = !settings.blocks;
      syncSwitches();
    } else if (e.key === 'd' || e.key === 'D') {
      settings.keyframes = settings.keyframes === 'drop' ? 'keep' : 'drop';
      syncSwitches();
    }
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'Space' && held) setHold(false);
  });
  addEventListener('blur', () => setHold(false));

  // ------------------------------------------------ drawing

  function sizeCanvas(c: HTMLCanvasElement) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return dpr;
  }

  function drawOverlay() {
    sizeCanvas(overlay);
    const w = overlay.width;
    const h = overlay.height;
    octx.clearRect(0, 0, w, h);
    const info = lastInfo;
    if (!info?.modes || (!settings.vectors && !settings.blocks)) return;
    const sx = w / W;
    const sy = h / H;
    const bw = 16 * sx;
    const bh = 16 * sy;
    if (settings.blocks) {
      for (let my = 0; my < MBH; my++) {
        for (let mx = 0; mx < MBW; mx++) {
          const m = info.modes[my * MBW + mx];
          if (m === SKIP) continue;
          if (m === INTRA) {
            octx.fillStyle = 'rgba(255,91,58,0.38)';
            octx.fillRect(mx * bw, my * bh, bw, bh);
          } else {
            octx.strokeStyle = 'rgba(79,141,255,0.55)';
            octx.lineWidth = 1;
            octx.strokeRect(mx * bw + 0.5, my * bh + 0.5, bw - 1, bh - 1);
          }
        }
      }
    }
    if (settings.vectors && info.mvx && info.mvy && info.kind !== 'key') {
      octx.lineCap = 'round';
      for (let my = 0; my < MBH; my++) {
        for (let mx = 0; mx < MBW; mx++) {
          const i = my * MBW + mx;
          if (info.modes[i] !== INTER) continue;
          const dx = info.mvx[i];
          const dy = info.mvy[i];
          const cx = (mx * 16 + 8) * sx;
          const cy = (my * 16 + 8) * sy;
          // Each block came from (dx, dy) away; draw the trail it travelled.
          octx.strokeStyle = 'rgba(0,0,0,0.5)';
          octx.lineWidth = 3;
          octx.beginPath();
          octx.moveTo(cx + dx * sx, cy + dy * sy);
          octx.lineTo(cx, cy);
          octx.stroke();
          octx.strokeStyle = '#ffffff';
          octx.lineWidth = 1.25;
          octx.stroke();
          octx.fillStyle = '#ffffff';
          octx.beginPath();
          octx.arc(cx, cy, 1.8 * Math.min(2, sx / 2), 0, Math.PI * 2);
          octx.fill();
        }
      }
    }
  }

  const colours = { key: '#ff5b3a', delta: '#4f8dff', held: '#a9c6ff', line: '#2b2925', dim: '#8c867b' };
  function drawStrip() {
    const dpr = sizeCanvas(strip);
    const w = strip.width;
    const h = strip.height;
    sctx.clearRect(0, 0, w, h);
    const step = 4 * dpr;
    const barW = 3 * dpr;
    const n = Math.floor(w / step);
    const shown = bars.slice(-n);
    const top = 12 * dpr;
    const span = h - top - 1;
    // Linear, as codec analysers draw it, topping out at 200 kbit.
    const height = (bits: number) => Math.max(2 * dpr, Math.round(Math.min(1, bits / 200_000) * span));
    sctx.font = `${9 * dpr}px ${getComputedStyle(root).getPropertyValue('--font-datamosh') || 'monospace'}`;
    sctx.textBaseline = 'top';
    shown.forEach((b, i) => {
      const x = w - (shown.length - i) * step;
      if (b.cut) {
        sctx.fillStyle = colours.dim;
        sctx.fillRect(x, 0, 1 * dpr, h);
        sctx.fillText(names.get(b.cut) ?? b.cut, x + 3 * dpr, 0);
      }
      if (b.kind === 'still') return;
      const bh = height(b.bits);
      const y = h - bh;
      if (b.kind === 'drop') {
        // A keyframe left out: its outline as a dotted stack, with nothing inside.
        sctx.fillStyle = colours.key;
        for (let yy = h - 2 * dpr; yy >= y; yy -= 4 * dpr) sctx.fillRect(x, yy, barW, 2 * dpr);
        return;
      }
      sctx.fillStyle = b.kind === 'key' ? colours.key : b.kind === 'hold' ? colours.held : colours.delta;
      sctx.fillRect(x, y, barW, bh);
    });
  }

  const rFrame = $<HTMLElement>('[data-r-frame]');
  const rKind = $<HTMLElement>('[data-r-kind]');
  const rBits = $<HTMLElement>('[data-r-bits]');
  const rModes = $<HTMLElement>('[data-r-modes]');
  const kindWords: Record<FrameInfo['kind'], string> = {
    key: 'Keyframe',
    drop: 'Keyframe out',
    delta: 'Delta',
    hold: 'Delta, held',
    still: 'No change',
  };
  function readout(info: FrameInfo) {
    rFrame.textContent = `Frame ${String(programFrames).padStart(6, '0')}`;
    rKind.textContent = kindWords[info.kind];
    rBits.textContent = info.bits ? `${(info.bits / 1000).toFixed(1)} kbit` : '—';
    if (info.modes && info.kind !== 'key' && info.kind !== 'drop') {
      let inter = 0;
      let intra = 0;
      for (const m of info.modes) {
        if (m === INTER) inter++;
        else if (m === INTRA) intra++;
      }
      const pct = (v: number) => Math.round((v / info.modes!.length) * 100);
      rModes.textContent = `moved ${pct(inter)}% · intra ${pct(intra)}% · unchanged ${100 - pct(inter) - pct(intra)}%`;
    } else rModes.textContent = '';
  }

  // ------------------------------------------------ the clock

  function runAutopilot() {
    if (!auto) return;
    autoClock += 1 / FPS;
    if (autoClock >= SCRIPT_LENGTH) {
      autoClock -= SCRIPT_LENGTH;
      autoStep = 0;
    }
    while (autoStep < SCRIPT.length && SCRIPT[autoStep].at <= autoClock) {
      const s = SCRIPT[autoStep++];
      if (s.cut) cut(s.cut);
      if (s.hold) autoHoldUntil = autoClock + s.hold;
      if (s.key) send({ t: 'key' });
    }
  }

  function tick(now: number) {
    requestAnimationFrame(tick);
    if (inflight || now - lastTick < 1000 / FPS - 3) return;
    lastTick = now;
    runAutopilot();
    const autoHeld = auto && autoClock < autoHoldUntil;
    const live = onAir === 'camera' || onAir === 'screen' || (onAir === 'file' && video) ? grabLive() : undefined;
    const m: TickMessage = {
      t: 'tick',
      hold: held || autoHeld,
      keyframes: settings.keyframes === 'keep',
      heal: settings.intra === 'heal',
      residual: settings.residual === 'on',
      live,
      recycle,
    };
    recycle = undefined;
    const transfer: Transferable[] = [];
    if (live) transfer.push(live);
    if (m.recycle) transfer.push(m.recycle);
    inflight = true;
    send(m, transfer);
  }

  worker.onmessage = (e: MessageEvent<OutMessage>) => {
    const m = e.data;
    if (m.t === 'ready') {
      for (const r of m.reels) names.set(r.id, r.name);
      void slate().then(() => {
        cut('bars');
        requestAnimationFrame(tick);
      });
    } else if (m.t === 'poster') {
      const c = root.querySelector<HTMLCanvasElement>(`[data-poster="${m.id}"]`);
      c?.getContext('2d')?.drawImage(m.bitmap, 0, 0, c.width, c.height);
      m.bitmap.close();
    } else if (m.t === 'frame') {
      inflight = false;
      programFrames++;
      const img = new ImageData(new Uint8ClampedArray(m.rgba), W, H);
      pctx.putImageData(img, 0, 0);
      recycle = m.rgba;
      if (recCanvas) {
        recCanvas.getContext('2d')!.drawImage(picture, 0, 0, W * 2, H * 2);
        const s = Math.floor((performance.now() - recStart) / 1000);
        $<HTMLElement>('[data-rec-time]').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        if (s >= 60) recorder?.stop();
      }
      lastInfo = m.info;
      bars.push({ kind: m.info.kind, bits: m.info.bits, cut: pendingCutMark });
      pendingCutMark = null;
      if (bars.length > 600) bars.splice(0, bars.length - 600);
      drawOverlay();
      drawStrip();
      readout(m.info);
    }
  };

  setTimeout(() => hint.classList.add('gone'), 9000);
  addEventListener('resize', () => {
    drawOverlay();
    drawStrip();
  });
  syncSwitches();
  if (!auto) $<HTMLElement>('[data-auto]').setAttribute('aria-pressed', 'false');

  // A handle for scripted checks.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { datamosh: unknown }).datamosh = {
      cut: (id: string) => cut(id, true),
      key,
      hold: setHold,
      settings,
      get info() {
        return lastInfo;
      },
      get frames() {
        return programFrames;
      },
    };
  }
}
