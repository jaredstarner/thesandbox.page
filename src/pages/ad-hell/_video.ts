// The "video" ad: three spots drawn on a canvas frame by frame, each with a synthesized jingle.
// It plays on its own, with sound, and follows the reader down the page once they scroll past it.

import type { Hell } from './_hell';
import { audioReady, playTune, whenAudio, type Playing, type Tune } from './_sound';

const W = 640;
const H = 360;
const SPOT = 12;
const SKIP_AFTER = 5;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Spot {
  brand: string;
  tune: Tune;
  draw(g: CanvasRenderingContext2D, t: number): void;
}

// ---------- GRANITE ----------

let granite: HTMLCanvasElement | null = null;

function graniteTexture() {
  if (granite) return granite;
  granite = document.createElement('canvas');
  granite.width = W;
  granite.height = H;
  const g = granite.getContext('2d');
  if (!g) return granite;
  g.fillStyle = '#4a4f55';
  g.fillRect(0, 0, W, H);
  const r = rng(7);
  const tones = ['#2b2e33', '#6b7178', '#8d939a', '#1c1e21', '#b7b2a8', '#5a4a44'];
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = tones[Math.floor(r() * tones.length)];
    g.globalAlpha = 0.35 + r() * 0.6;
    const s = 0.6 + r() * r() * 7;
    g.fillRect(r() * W, r() * H, s, s * (0.5 + r()));
  }
  g.globalAlpha = 1;
  return granite;
}

function can(g: CanvasRenderingContext2D, x: number, y: number, rot: number) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  const body = g.createLinearGradient(-38, 0, 38, 0);
  body.addColorStop(0, '#15171a');
  body.addColorStop(0.35, '#5b6168');
  body.addColorStop(0.5, '#a9b0b7');
  body.addColorStop(1, '#101214');
  g.fillStyle = '#2a2d31';
  g.beginPath();
  g.roundRect(-14, -128, 28, 22, 5);
  g.fill();
  g.fillStyle = body;
  g.beginPath();
  g.roundRect(-38, -108, 76, 216, 18);
  g.fill();
  g.fillStyle = '#c9c2b6';
  g.fillRect(-38, -20, 76, 54);
  g.fillStyle = '#1b1d20';
  g.font = '900 17px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('GRANITE', 0, 8);
  g.restore();
}

const GRANITE: Spot = {
  brand: 'granite',
  tune: {
    bpm: 100,
    lead: 'A3 . . . E4 . . . A4 . G4 . E4 . . . F4 . . . C4 . . . E4 . D4 . B3 . . .',
    bass: 'A1 . A1 A1 . . A1 . G1 . G1 G1 . . E1 . F1 . F1 F1 . . F1 . E1 . E1 . G1 . G#1 .',
    leadWave: 'sawtooth',
    bassWave: 'square',
    leadLevel: 0.035,
    bassLevel: 0.06,
    leadLength: 2.5,
  },
  draw(g, t) {
    const s = 1 + t * 0.015;
    g.save();
    g.translate(W / 2, H / 2);
    g.scale(s, s);
    g.drawImage(graniteTexture(), -W / 2, -H / 2);
    g.restore();
    const v = g.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 420);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.8)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);

    const cx = W + 80 + (480 - W - 80) * easeOut(clamp(t / 1.2));
    const cy = 200 + Math.sin(t * 1.3) * 4;
    can(g, cx, cy, Math.sin(t * 0.8) * 0.05);

    // A cloud of spray from the nozzle.
    const r = rng(11);
    for (let i = 0; i < 70; i++) {
      const born = 2.3 + i * 0.045;
      const age = t - born;
      const dx = 120 + r() * 90;
      const dy = (r() - 0.5) * 70;
      if (age < 0 || age > 1.8) continue;
      g.fillStyle = `rgba(235,235,230,${(1 - age / 1.8) * 0.22})`;
      g.beginPath();
      g.arc(cx - 10 - age * dx, cy - 115 + dy * age, 4 + age * 20, 0, Math.PI * 2);
      g.fill();
    }

    if (t < 7) {
      const words: [string, number][] = [
        ['SMELL', 1],
        ['LIKE A', 2],
        ['COUNTERTOP.', 3],
      ];
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      words.forEach(([word, start], i) => {
        const k = clamp((t - start) / 0.25);
        if (k <= 0) return;
        const scale = 1.6 - 0.6 * easeOut(k);
        g.save();
        g.translate(40, 130 + i * 74);
        g.scale(scale, scale);
        g.globalAlpha = k;
        g.font = '900 64px Impact, "Arial Black", sans-serif';
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillText(word, 4, 4);
        g.fillStyle = '#f2efe8';
        g.fillText(word, 0, 0);
        g.restore();
      });
    } else {
      const a = clamp((t - 7) / 0.4);
      g.fillStyle = `rgba(0,0,0,${0.45 * a})`;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = a;
      g.textAlign = 'center';
      g.fillStyle = '#f2efe8';
      g.font = '900 112px Impact, "Arial Black", sans-serif';
      g.fillText('GRANITE', W / 2, 190);
      g.font = 'italic 24px Georgia, serif';
      g.fillText('For people who are mostly rock.', W / 2, 238);
      g.globalAlpha = 1;
      // A sheen across the logo.
      const sx = -200 + (W + 400) * clamp((t - 7.6) / 1.4);
      const sheen = g.createLinearGradient(sx - 80, 0, sx + 80, 0);
      sheen.addColorStop(0, 'rgba(255,255,255,0)');
      sheen.addColorStop(0.5, 'rgba(255,255,255,0.22)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sheen;
      g.fillRect(0, 100, W, 160);
    }
  },
};

// ---------- SNOOZLE ----------

const SNOOZLE: Spot = {
  brand: 'snoozle',
  tune: {
    bpm: 84,
    lead: 'C5 . A4 . F4 . A4 . C5 . D5 . C5 . . . Bb4 . G4 . E4 . G4 . C5 . . . . . . .',
    bass: 'F2 . . . . . . . F2 . . . . . . . C2 . . . . . . . C2 . . . . . . .',
    leadWave: 'triangle',
    bassWave: 'triangle',
    leadLevel: 0.11,
    bassLevel: 0.14,
    leadLength: 3,
  },
  draw(g, t) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#8f7cf0');
    sky.addColorStop(0.6, '#d9b8f0');
    sky.addColorStop(1, '#ffd2b8');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    const r = rng(3);
    for (let i = 0; i < 40; i++) {
      const x = r() * W;
      const y = r() * H * 0.5;
      g.fillStyle = `rgba(255,255,255,${0.35 + 0.35 * Math.sin(t * 2 + i)})`;
      g.fillRect(x, y, 2, 2);
    }
    for (let i = 0; i < 4; i++) {
      const x = ((i * 190 + t * (14 + i * 5)) % (W + 240)) - 120;
      const y = 60 + i * 52;
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath();
      g.arc(x, y, 26, 0, Math.PI * 2);
      g.arc(x + 30, y - 12, 30, 0, Math.PI * 2);
      g.arc(x + 62, y, 24, 0, Math.PI * 2);
      g.fill();
    }

    const bounce = Math.abs(Math.sin(t * 3));
    const squash = 1 - 0.18 * (1 - Math.min(1, bounce * 4));
    const my = 262 - bounce * 46;
    g.save();
    g.translate(W / 2, my);
    g.scale(1 + (1 - squash) * 0.6, squash);
    g.fillStyle = '#fff';
    g.strokeStyle = '#9b8cd9';
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(-150, -36, 300, 72, 22);
    g.fill();
    g.stroke();
    g.strokeStyle = '#ddd5f7';
    g.lineWidth = 2;
    for (let x = -100; x <= 100; x += 50) {
      g.beginPath();
      g.moveTo(x, -32);
      g.lineTo(x, 32);
      g.stroke();
    }
    g.restore();

    g.fillStyle = '#5b4bd1';
    g.font = 'bold 30px Georgia, serif';
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.5 + i / 3) % 1;
      g.globalAlpha = 1 - p;
      g.fillText('z', W / 2 + 120 + p * 60 + i * 8, my - 50 - p * 120);
    }
    g.globalAlpha = 1;

    g.textAlign = 'center';
    if (t < 6) {
      g.globalAlpha = clamp((t - 0.5) / 0.6);
      g.fillStyle = '#2c2366';
      g.font = 'italic 36px Georgia, serif';
      g.fillText('Sleep is a subscription now.', W / 2, 90);
    } else {
      g.globalAlpha = clamp((t - 6) / 0.5);
      g.fillStyle = '#3b2fa0';
      g.font = '900 78px "Arial Black", Impact, sans-serif';
      g.fillText('SNOOZLE', W / 2, 98);
      g.font = '22px Arial, sans-serif';
      g.fillText('The 400-night trial. Free returns*', W / 2, 134);
      if (t > 9) {
        g.font = '12px Arial, sans-serif';
        g.fillText('*Returns must be made while asleep.', W / 2, 346);
      }
    }
    g.globalAlpha = 1;
  },
};

// ---------- BREADCOIN ----------

const CHART = (() => {
  const r = rng(42);
  const pts: number[] = [];
  let y = 300;
  for (let i = 0; i < 64; i++) {
    y += (r() - 0.68) * 26;
    y = Math.min(330, Math.max(70, y));
    pts.push(y);
  }
  return pts;
})();

const BREADCOIN: Spot = {
  brand: 'breadcoin',
  tune: {
    bpm: 128,
    lead: 'C5 E5 G5 C6 G5 E5 C5 E5 F5 A5 C6 F6 C6 A5 F5 A5 G5 B5 D6 G6 D6 B5 G5 B5 C6 . G5 . E5 . C5 .',
    bass: 'C3 . C3 . C3 . C3 . F2 . F2 . F2 . F2 . G2 . G2 . G2 . G2 . C3 . G2 . C3 . . .',
    leadWave: 'square',
    bassWave: 'triangle',
    leadLevel: 0.03,
    bassLevel: 0.13,
    leadLength: 1,
  },
  draw(g, t) {
    g.fillStyle = '#06261b';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(93,255,157,0.12)';
    g.lineWidth = 1;
    const off = (t * 30) % 40;
    for (let x = -off; x < W; x += 40) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    for (let y = 20; y < H; y += 40) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }

    const n = Math.floor(clamp(t / 7) * (CHART.length - 1)) + 1;
    g.save();
    g.strokeStyle = '#3dff9a';
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.shadowColor = '#3dff9a';
    g.shadowBlur = 14;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (CHART.length - 1)) * W;
      if (i === 0) g.moveTo(x, CHART[i]);
      else g.lineTo(x, CHART[i]);
    }
    g.stroke();
    g.restore();

    // A coin that spins.
    const spin = Math.cos(t * 3.2);
    const coin = g.createRadialGradient(495, 120, 6, 510, 140, 70);
    coin.addColorStop(0, '#fff3b0');
    coin.addColorStop(0.55, '#e8b923');
    coin.addColorStop(1, '#8c6606');
    g.fillStyle = coin;
    g.beginPath();
    g.ellipse(510, 140, Math.max(4, 64 * Math.abs(spin)), 64, 0, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.translate(510, 140);
    g.scale(Math.max(0.05, Math.abs(spin)), 1);
    g.fillStyle = '#6b4f00';
    g.font = '900 64px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('B', 0, 4);
    g.restore();

    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    if (t > 0.4) {
      g.fillStyle = '#ffd400';
      g.font = '900 58px Impact, "Arial Black", sans-serif';
      g.fillText('BREADCOIN', 36, 84);
    }
    if (t > 1.6) {
      g.fillStyle = '#c7f5dd';
      g.font = '22px Arial, sans-serif';
      g.fillText('Backed by actual bread.', 38, 118);
    }
    if (t > 3) {
      g.fillStyle = '#5dff9d';
      g.font = 'bold 52px "Courier New", monospace';
      g.fillText(`▲ ${Math.round(412 * clamp((t - 3) / 4))}%`, 36, 300);
    }
    if (t > 7.5) {
      const r = rng(9);
      for (let i = 0; i < 90; i++) {
        const x = r() * W;
        const speed = 80 + r() * 140;
        const y = -20 + (t - 7.5) * speed - r() * 120;
        g.fillStyle = ['#ffd400', '#3dff9a', '#ffffff', '#e8b923'][i % 4];
        g.save();
        g.translate(x + Math.sin(t * 3 + i) * 10, y);
        g.rotate(t * 4 + i);
        g.fillRect(-4, -2, 8, 4);
        g.restore();
      }
    }
    if (t > 8.5) {
      g.fillStyle = 'rgba(199,245,221,0.8)';
      g.font = '12px Arial, sans-serif';
      g.fillText('Not financial advice. Barely advice.', 36, 344);
    }
  },
};

const SPOTS = [GRANITE, SNOOZLE, BREADCOIN];

export interface Video {
  tick(): void;
  readonly pip: boolean;
  stop(): void;
}

export function initVideo(hell: Hell): Video {
  const slot = hell.root.querySelector<HTMLElement>('[data-video-slot]');
  const vid = slot?.querySelector<HTMLElement>('[data-video]');
  const canvas = vid?.querySelector<HTMLCanvasElement>('[data-video-canvas]');
  const g = canvas?.getContext('2d');
  if (!slot || !vid || !canvas || !g) return { tick() {}, pip: false, stop() {} };

  const q = <T extends HTMLElement>(sel: string) => vid.querySelector<T>(sel);
  const count = q('[data-video-count]');
  const bar = q('[data-video-bar]');
  const skip = q<HTMLButtonElement>('[data-video-skip]');
  const mute = q('[data-video-mute]');
  const cta = q('[data-video-cta]');

  let spot = 0;
  let t = 0;
  let last = performance.now();
  let muted = false;
  let visible = false;
  let pip = false;
  let pipClosedUntil = -1;
  let playing: Playing | null = null;
  let playingSpot = -1;
  let stopped = false;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  vid.dataset.live = '';

  const label = () => {
    const left = Math.max(0, Math.ceil(SPOT - t));
    if (count) count.textContent = `Ad ${spot + 1} of 3 · 0:${String(left).padStart(2, '0')}`;
    if (skip) {
      const wait = Math.ceil(SKIP_AFTER - t);
      skip.disabled = wait > 0;
      skip.textContent = wait > 0 ? `Skip ad in ${wait}` : 'Skip ad ›';
    }
    if (bar) bar.style.width = `${(t / SPOT) * 100}%`;
  };

  const next = () => {
    spot = (spot + 1) % SPOTS.length;
    t = 0;
    if (cta) cta.dataset.cta = SPOTS[spot].brand;
    label();
  };

  const sound = () => {
    const want = (visible || pip) && !muted && !hell.blocked && !hell.finished && hell.started && !document.hidden && !stopped;
    if (want && audioReady()) {
      if (!playing || playingSpot !== spot) {
        playing?.stop();
        playing = playTune(SPOTS[spot].tune);
        playingSpot = spot;
        hell.see('autoplay-sound');
      }
    } else if (playing) {
      playing.stop();
      playing = null;
      playingSpot = -1;
    }
  };
  whenAudio(sound);

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!stopped && !hell.blocked && (visible || pip)) {
      t += dt;
      if (t >= SPOT) next();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      SPOTS[spot].draw(g, t);
      label();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  label();

  skip?.addEventListener('click', () => {
    if (t >= SKIP_AFTER) next();
  });
  mute?.addEventListener('click', () => {
    muted = !muted;
    mute.setAttribute('aria-pressed', String(muted));
    sound();
  });
  q('[data-video-close]')?.addEventListener('click', () => {
    hell.stats.closed++;
    pipClosedUntil = hell.adNow() + 40000;
    setPip(false);
  });

  const setPip = (on: boolean) => {
    if (on === pip) return;
    pip = on;
    vid.classList.toggle('is-pip', on);
    if (on) hell.see('sticky-video');
  };

  return {
    get pip() {
      return pip;
    },
    tick() {
      const rect = slot.getBoundingClientRect();
      visible = rect.bottom > 44 && rect.top < innerHeight;
      const passed = rect.bottom < 44;
      setPip(passed && hell.started && !hell.blocked && !hell.finished && !stopped && hell.adNow() >= pipClosedUntil);
      sound();
    },
    stop() {
      stopped = true;
      setPip(false);
      sound();
    },
  };
}
