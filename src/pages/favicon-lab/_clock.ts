import type { Lab, Program } from './_lab';

// A clock in the tab icon, redrawn by a chain of timers, that logs every
// redraw so it can show what the browser allowed while the tab was hidden.

const TICK_MS = 250;
const KEEP = 6000;
const SVG = 'http://www.w3.org/2000/svg';

interface Wake {
  wall: number;
  hidden: boolean;
  hum: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${pad(s % 60)} s`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

function gapText(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : ms < 120000 ? `${(ms / 1000).toFixed(1)} s` : duration(ms);
}

function drawFace(ctx: CanvasRenderingContext2D, now: Date): void {
  const c = 16;
  ctx.clearRect(0, 0, 32, 32);
  ctx.beginPath();
  ctx.arc(c, c, 14.6, 0, Math.PI * 2);
  ctx.fillStyle = '#fbfaf6';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#16120c';
  ctx.stroke();

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c + Math.sin(a) * 11.2, c - Math.cos(a) * 11.2, i % 3 === 0 ? 1.3 : 0.8, 0, Math.PI * 2);
    ctx.fillStyle = '#16120c';
    ctx.fill();
  }

  const s = now.getSeconds() + now.getMilliseconds() / 1000;
  const m = now.getMinutes() + s / 60;
  const h = (now.getHours() % 12) + m / 60;
  const hand = (turn: number, length: number, tail: number, width: number, color: string) => {
    const a = turn * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c - Math.sin(a) * tail, c + Math.cos(a) * tail);
    ctx.lineTo(c + Math.sin(a) * length, c - Math.cos(a) * length);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  hand(h / 12, 7, 0, 2.6, '#16120c');
  hand(m / 60, 10.5, 0, 1.8, '#16120c');
  hand(s / 60, 12.5, 3, 1.1, '#e5372a');
  ctx.beginPath();
  ctx.arc(c, c, 1.7, 0, Math.PI * 2);
  ctx.fillStyle = '#e5372a';
  ctx.fill();
}

export function createClock(lab: Lab): Program {
  const panel = lab.panel('clock');
  const rateEl = panel.querySelector<HTMLElement>('[data-clock-rate]')!;
  const awayEl = panel.querySelector<HTMLElement>('[data-clock-away]')!;
  const humButton = panel.querySelector<HTMLButtonElement>('[data-clock-hum]')!;
  const report = panel.querySelector<HTMLElement>('[data-clock-report]')!;
  const summary = panel.querySelector<HTMLElement>('[data-clock-summary]')!;
  const chart = panel.querySelector<SVGSVGElement>('[data-clock-chart]')!;

  let wakes: Wake[] = [];
  let hiddenAt: number | null = null;
  let timer = 0;
  let humming = false;
  let audio: { context: AudioContext; gain: GainNode } | null = null;

  const tick = () => {
    const now = Date.now();
    wakes.push({ wall: now, hidden: document.hidden, hum: humming });
    if (wakes.length > KEEP) wakes = wakes.slice(-KEEP / 2);
    const date = new Date(now);
    drawFace(lab.ctx, date);
    lab.present();
    lab.title(`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} · Clock`);
    if (!document.hidden) {
      let n = 0;
      for (let i = wakes.length - 1; i >= 0 && now - wakes[i]!.wall <= 1000; i--) n++;
      rateEl.textContent = String(n);
    }
    timer = window.setTimeout(tick, TICK_MS);
  };

  const el = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, text?: string) => {
    const node = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text) node.textContent = text;
    return node;
  };

  const buildReport = (from: number, to: number) => {
    const away = to - from;
    let prev = from;
    for (const w of wakes) if (w.wall <= from) prev = w.wall;
    const points: { at: number; gap: number; hum: boolean }[] = [];
    for (const w of wakes) {
      if (w.wall <= from || w.wall > to || !w.hidden) continue;
      points.push({ at: w.wall - from, gap: w.wall - prev, hum: w.hum });
      prev = w.wall;
    }

    const onTime = points.filter((p) => p.gap < 600).length;
    const second = points.filter((p) => p.gap >= 600 && p.gap < 3000).length;
    const minute = points.filter((p) => p.gap >= 3000).length;
    const longest = points.reduce((m, p) => Math.max(m, p.gap), 0);
    const parts: string[] = [];
    if (onTime) parts.push(`${onTime} on time, a quarter second apart`);
    if (second) parts.push(`${second} about a second apart`);
    if (minute) parts.push(`${minute} with longer waits`);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
    const hummed = points.some((p) => p.hum);

    summary.textContent =
      points.length === 0
        ? `You were away ${duration(away)}, and the clock wasn't redrawn once while you were gone.`
        : `You were away ${duration(away)}. The clock was redrawn ${points.length} ${points.length === 1 ? 'time' : 'times'}: ${list}. ` +
          `The longest wait was ${gapText(longest)}.` +
          (hummed ? ' The hum was on for some or all of it.' : '');
    awayEl.textContent = duration(away);

    // Gap against time away, gaps on a log scale from 0.1 s to 2 min.
    const W = 640;
    const H = 210;
    const L = 52;
    const R = 12;
    const T = 10;
    const B = 30;
    const lo = Math.log(100);
    const hi = Math.log(120000);
    const y = (gap: number) => T + (H - T - B) * (1 - (Math.log(Math.min(Math.max(gap, 100), 120000)) - lo) / (hi - lo));
    const x = (at: number) => L + ((W - L - R) * at) / Math.max(away, 1);
    chart.replaceChildren();
    chart.setAttribute('viewBox', `0 0 ${W} ${H}`);
    for (const [gap, label] of [
      [250, '0.25 s'],
      [1000, '1 s'],
      [60000, '1 min'],
    ] as const) {
      chart.append(el('line', { class: 'grid', x1: L, x2: W - R, y1: y(gap), y2: y(gap) }));
      chart.append(el('text', { class: 'label', x: L - 8, y: y(gap) + 4, 'text-anchor': 'end' }, label));
    }
    if (away > 5 * 60000) {
      chart.append(el('line', { class: 'mark', x1: x(300000), x2: x(300000), y1: T, y2: H - B }));
      chart.append(el('text', { class: 'label', x: x(300000) + 5, y: T + 10 }, '5 min'));
    }
    chart.append(el('line', { class: 'axis', x1: L, x2: W - R, y1: H - B, y2: H - B }));
    chart.append(el('text', { class: 'label', x: L, y: H - 10 }, 'You left'));
    chart.append(el('text', { class: 'label', x: W - R, y: H - 10, 'text-anchor': 'end' }, `Back, ${duration(away)} later`));
    for (const p of points) {
      chart.append(el('circle', { class: p.hum ? 'dot hum' : 'dot', cx: x(p.at), cy: y(p.gap), r: 3.2 }));
    }
    report.hidden = false;
  };

  const onVisibility = () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    if (hiddenAt !== null) {
      const back = Date.now();
      if (back - hiddenAt > 1500) buildReport(hiddenAt, back);
      hiddenAt = null;
    }
    clearTimeout(timer);
    tick();
  };

  const stopHum = () => {
    if (!audio) return;
    const { context, gain } = audio;
    audio = null;
    gain.gain.setTargetAtTime(0, context.currentTime, 0.05);
    window.setTimeout(() => void context.close(), 300);
  };

  const onHum = () => {
    humming = !humming;
    humButton.setAttribute('aria-pressed', String(humming));
    humButton.textContent = humming ? 'Humming' : 'Hum';
    if (!humming) {
      stopHum();
      return;
    }
    try {
      const context = new AudioContext();
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.035, context.currentTime, 0.1);
      gain.connect(context.destination);
      for (const [freq, level] of [
        [196, 1],
        [392, 0.25],
      ] as const) {
        const osc = context.createOscillator();
        const g = context.createGain();
        osc.frequency.value = freq;
        g.gain.value = level;
        osc.connect(g).connect(gain);
        osc.start();
      }
      audio = { context, gain };
    } catch {
      humming = false;
      humButton.setAttribute('aria-pressed', 'false');
      humButton.textContent = 'No sound here';
      humButton.disabled = true;
    }
  };

  return {
    start() {
      wakes = [];
      hiddenAt = document.hidden ? Date.now() : null;
      document.addEventListener('visibilitychange', onVisibility);
      humButton.addEventListener('click', onHum);
      tick();
    },
    stop() {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      humButton.removeEventListener('click', onHum);
      if (humming) {
        humming = false;
        humButton.setAttribute('aria-pressed', 'false');
        humButton.textContent = 'Hum';
        stopHum();
      }
    },
  };
}
