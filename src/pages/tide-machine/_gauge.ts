// The machine's prediction for the last three days against the harbour's tide gauge, read live from NOAA's
// public data API (keyless, CORS-open). If the gauge doesn't answer, the machine's curve still draws.

import { el } from './_machine';
import type { Port } from './_ports';
import { NAMES } from './_ports';
import { height, type Station } from './_tides';

const HOUR = 3600000;
const FT = 3.28084;

interface Reading {
  ms: number;
  v: number;
}

const cache = new Map<string, { at: number; data: Reading[] }>();

async function readings(id: string): Promise<Reading[]> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.data;
  const url =
    'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&date=recent&datum=MLLW' +
    `&units=metric&time_zone=gmt&format=json&application=thesandbox.page&station=${encodeURIComponent(id)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { data?: { t: string; v: string }[] };
    const data = (json.data ?? [])
      .map((r) => ({ ms: Date.parse(r.t.replace(' ', 'T') + ':00Z'), v: Number.parseFloat(r.v) }))
      .filter((r) => Number.isFinite(r.ms) && Number.isFinite(r.v));
    if (!data.length) throw new Error('no data');
    cache.set(id, { at: Date.now(), data });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export interface GaugeView {
  show(port: Port, unit: 'ft' | 'm'): void;
}

export function gauge(section: HTMLElement): GaugeView {
  const svg = section.querySelector<SVGSVGElement>('[data-gauge-svg]')!;
  const read = section.querySelector<HTMLElement>('[data-gauge-read]')!;
  const portName = section.querySelector<HTMLElement>('[data-gauge-port]')!;
  // Phones get a narrower drawing, so the lettering stays readable.
  const phone = (svg.parentElement?.clientWidth ?? 1000) < 620;
  const W = phone ? 600 : 1000;
  const H = phone ? 470 : 380;
  const box = phone ? { x0: 78, x1: 586, y0: 22, y1: 410 } : { x0: 74, x1: 980, y0: 22, y1: 330 };
  const fs = phone ? 21 : 14;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  let current: { port: Port; unit: 'ft' | 'm' } | null = null;
  let seen = false;
  let token = 0;

  const stationOf = (p: Port): Station => ({
    z0: p.z0,
    harmonics: p.h.map(([amp, phase, speed], i) => ({ name: NAMES[i], amp, phase, speed })),
  });

  function draw(port: Port, unit: 'ft' | 'm', obs: Reading[] | null): void {
    const st = stationOf(port);
    const k = unit === 'ft' ? FT : 1;
    const end = obs?.length ? Math.max(obs[obs.length - 1].ms, Date.now() - 6 * 60000) : Date.now();
    const begin = end - 72 * HOUR;
    const pred: Reading[] = [];
    for (let ms = begin; ms <= end; ms += 6 * 60000) pred.push({ ms, v: height(st, ms) });
    const all = pred.map((p) => p.v).concat(obs ? obs.map((o) => o.v) : []);
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const x = (ms: number) => box.x0 + ((ms - begin) / (end - begin)) * (box.x1 - box.x0);
    const y = (v: number) => box.y1 - ((v - lo) / (hi - lo)) * (box.y1 - box.y0);

    svg.replaceChildren();
    const g = el('g', {}, svg);
    // Height grid.
    const range = (hi - lo) * k;
    const step = unit === 'ft' ? (range <= 3 ? 0.5 : range <= 10 ? 1 : 2) : range <= 1 ? 0.1 : range <= 3 ? 0.5 : 1;
    for (let v = Math.ceil((lo * k) / step) * step; v <= hi * k; v += step) {
      const yy = y(v / k);
      el('path', { d: `M${box.x0} ${yy.toFixed(1)}H${box.x1}`, stroke: '#cfc4aa', 'stroke-width': 0.8 }, g);
      const t = el('text', { x: box.x0 - 10, y: yy + fs * 0.35, 'text-anchor': 'end', class: 'tm-gnum', fill: '#6d6350', 'font-size': fs }, g);
      t.textContent = `${Number.isInteger(v) ? v : v.toFixed(1)} ${unit}`;
    }
    // Local midnights and day names.
    const dayFmt = new Intl.DateTimeFormat(
      'en-GB',
      phone
        ? { timeZone: port.zone, weekday: 'short', day: 'numeric' }
        : { timeZone: port.zone, weekday: 'long', day: 'numeric', month: 'short' },
    );
    const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: port.zone, hourCycle: 'h23', hour: 'numeric' });
    for (let ms = Math.ceil(begin / HOUR) * HOUR; ms <= end; ms += HOUR) {
      const hr = +hourFmt.format(ms) % 24;
      if (hr === 0) {
        el('path', { d: `M${x(ms).toFixed(1)} ${box.y0}V${box.y1}`, stroke: '#a89b7f', 'stroke-width': 1 }, g);
      }
      if (hr === 12) {
        const t = el('text', { x: x(ms), y: H - (phone ? 26 : 22), 'text-anchor': 'middle', class: 'tm-gday', fill: '#5d554a', 'font-size': fs + 1 }, g);
        t.textContent = dayFmt.format(ms).replace(',', '');
      }
    }

    const path = (pts: Reading[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.ms).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');

    if (obs?.length) {
      // The difference as a band between the two lines.
      const machineAt = (ms: number) => height(st, ms);
      const top = obs.map((o) => `${x(o.ms).toFixed(1)} ${y(o.v).toFixed(1)}`);
      const bottom = [...obs].reverse().map((o) => `${x(o.ms).toFixed(1)} ${y(machineAt(o.ms)).toFixed(1)}`);
      el('path', { d: `M${top.join('L')}L${bottom.join('L')}Z`, fill: 'rgb(196 69 47 / 0.22)' }, g);
    }
    el('path', { d: path(pred), fill: 'none', stroke: '#1f4f84', 'stroke-width': 2.4, 'stroke-linejoin': 'round' }, g);
    if (obs?.length) {
      const dots = el('g', { fill: '#c4452f' }, g);
      for (const o of obs) el('circle', { cx: x(o.ms).toFixed(1), cy: y(o.v).toFixed(1), r: phone ? 2.2 : 1.9 }, dots);
    }
    el('rect', { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0, fill: 'none', stroke: '#8f846b' }, g);
  }

  function fmt(m: number, unit: 'ft' | 'm'): string {
    return unit === 'ft' ? `${(m * FT).toFixed(2)} ft` : `${m.toFixed(2)} m`;
  }

  async function load(): Promise<void> {
    if (!current) return;
    const { port, unit } = current;
    const my = ++token;
    portName.textContent = port.name;
    draw(port, unit, null);
    read.textContent = `Asking the gauge at ${port.name}…`;
    try {
      const obs = await readings(port.id);
      if (my !== token) return;
      draw(port, unit, obs);
      const last = obs[obs.length - 1];
      const st = stationOf(port);
      const m = height(st, last.ms);
      const diff = last.v - m;
      const time = new Intl.DateTimeFormat('en-US', { timeZone: port.zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
        .format(last.ms)
        .replace(/\s?AM/, ' a.m.')
        .replace(/\s?PM/, ' p.m.');
      const side = Math.abs(diff) < 0.005 ? 'level with the prediction' : `${fmt(Math.abs(diff), unit)} ${diff > 0 ? 'above' : 'below'} the prediction`;
      read.textContent = `Latest reading, ${time}: the gauge says ${fmt(last.v, unit)}, the machine ${fmt(m, unit)}. The sea is ${side}.`;
    } catch {
      if (my !== token) return;
      read.textContent = `The gauge at ${port.name} didn't answer just now, so only the machine's curve is drawn.`;
    }
  }

  new IntersectionObserver(
    ([e]) => {
      if (e.isIntersecting && !seen) {
        seen = true;
        void load();
      }
    },
    { rootMargin: '200px' },
  ).observe(section);

  return {
    show(port, unit) {
      current = { port, unit };
      portName.textContent = port.name;
      if (seen) void load();
    },
  };
}
