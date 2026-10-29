// The foundry: the bench's controls, the live font, and the proof of the pen at work.

import { cut, describe, type Cut } from './_cut';
import { PRESETS } from './_cuts';
import { broadNib, nibsFor, dotNib, roundNib, sweep, type Pt } from './_pen';
import { ASC, CAP, CHARSET, DESC, metrics, penOf, type Params, type Serif } from './_skeleton';

const SVGNS = 'http://www.w3.org/2000/svg';

type NumKey = 'nib' | 'contrast' | 'angle' | 'slant' | 'width' | 'xheight' | 'round' | 'branch';

const RANGES: Record<NumKey, [number, number]> = {
  nib: [24, 170],
  contrast: [0.04, 0.6],
  angle: [-10, 90],
  slant: [-6, 22],
  width: [0.68, 1.4],
  xheight: [0.5, 0.82],
  round: [1.7, 4.5],
  branch: [0, 1],
};

const SHORT: Record<string, NumKey> = {
  n: 'nib',
  k: 'contrast',
  a: 'angle',
  s: 'slant',
  w: 'width',
  x: 'xheight',
  r: 'round',
  b: 'branch',
};

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const pathOf = (contours: Pt[][], flip = true) =>
  contours
    .map((c) => 'M' + c.map(([x, y]) => `${x.toFixed(1)} ${(flip ? -y : y).toFixed(1)}`).join('L') + 'Z')
    .join('');

function cleanName(s: string): string {
  const out = s
    .replace(/[^A-Za-z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return out || 'Untitled';
}

/** Something that turns parameters into a font file, in a worker when it can. */
function makeCaster(): (params: Params, family: string) => Promise<ArrayBuffer> {
  let worker: Worker | null = null;
  let seq = 0;
  const waiting = new Map<number, { resolve: (b: ArrayBuffer) => void; reject: (e: unknown) => void }>();
  let local: Promise<typeof import('./_font')> | null = null;
  const onMain = (params: Params, family: string) => {
    local ??= import('./_font');
    return local.then((m) => m.cast(params, family));
  };
  try {
    worker = new Worker(new URL('./_worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; buffer?: ArrayBuffer; error?: string }>) => {
      const job = waiting.get(e.data.id);
      if (!job) return;
      waiting.delete(e.data.id);
      if (e.data.buffer) job.resolve(e.data.buffer);
      else job.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      for (const job of waiting.values()) job.reject(new Error('worker failed'));
      waiting.clear();
    };
  } catch {
    worker = null;
  }
  return (params, family) => {
    if (!worker) return onMain(params, family);
    const id = ++seq;
    return new Promise<ArrayBuffer>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      worker!.postMessage({ id, params, family });
    }).catch(() => onMain(params, family));
  };
}

export function start(root: HTMLElement): void {
  root.dataset.js = '';
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel);
  const $$ = <T extends Element>(sel: string) => [...root.querySelectorAll<T>(sel)];

  const sheet = $<HTMLElement>('[data-sheet]')!;
  const nameEl = $<HTMLElement>('[data-name]')!;
  const describeEl = $<HTMLElement>('[data-describe]')!;
  const metaEl = $<HTMLElement>('[data-meta]')!;
  const fileEl = $<HTMLElement>('[data-file]')!;
  const echoEl = $<HTMLElement>('[data-name-echo]')!;
  const proofSvg = $<SVGSVGElement>('[data-proof]')!;
  const proofLabel = $<HTMLElement>('[data-proof-label]')!;
  const dial = $<HTMLElement>('[data-dial]')!;
  const dialNib = $<SVGGElement>('[data-nib]')!;
  const dialArm = $<SVGLineElement>('[data-arm]')!;
  const dialKnob = $<SVGCircleElement>('[data-knob]')!;
  const angleOut = $<HTMLOutputElement>('[data-angle-out]')!;
  const dialLabel = $<HTMLElement>('[data-dial-label]')!;
  const dialNote = $<HTMLElement>('[data-dial-note]')!;
  const bench = $<HTMLElement>('[data-bench]')!;
  const drawer = $<HTMLButtonElement>('[data-drawer]')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let params: Params = { ...PRESETS[0].params };
  let name = PRESETS[0].name;
  let nameEdited = false;
  let selected = 'a';

  // ---- State from the address, so a face can be passed on as a link ----

  function readHash(): void {
    const q = new URLSearchParams(location.hash.slice(1));
    const preset = PRESETS.find((p) => p.id === q.get('cut'));
    if (preset) {
      params = { ...preset.params };
      name = preset.name;
    }
    const pen = q.get('pen');
    if (pen === 'broad' || pen === 'round' || pen === 'pointed') params.pen = pen;
    const serif = q.get('ends');
    if (serif === 'none' || serif === 'hook' || serif === 'slab') params.serif = serif;
    for (const [short, key] of Object.entries(SHORT)) {
      const v = parseFloat(q.get(short) ?? '');
      if (Number.isFinite(v)) params[key] = clamp(v, RANGES[key]);
    }
    const n = q.get('name');
    if (n) {
      name = cleanName(n);
      nameEdited = true;
    }
  }

  let hashTimer = 0;
  function writeHash(): void {
    clearTimeout(hashTimer);
    hashTimer = window.setTimeout(() => {
      const q = new URLSearchParams();
      const preset = matchingPreset();
      if (preset) q.set('cut', preset.id);
      else {
        q.set('pen', params.pen);
        q.set('ends', params.serif);
        for (const [short, key] of Object.entries(SHORT)) q.set(short, String(+params[key].toFixed(3)));
      }
      if (nameEdited) q.set('name', name);
      history.replaceState(null, '', '#' + q.toString());
    }, 300);
  }

  function matchingPreset() {
    return PRESETS.find((p) =>
      (Object.keys(p.params) as (keyof Params)[]).every((k) => {
        const a = p.params[k];
        const b = params[k];
        return typeof a === 'number' ? Math.abs(a - (b as number)) < 1e-6 : a === b;
      }),
    );
  }

  // ---- The live font ----

  const caster = makeCaster();
  let live: FontFace | null = null;
  let flip = 0;
  let busy = false;
  let pending = false;

  /** Set each showing line to fill the measure exactly, as a specimen's display lines are. */
  const showLines = $$<HTMLElement>('.show-line');
  function fitLines(): void {
    for (const el of showLines) {
      el.style.whiteSpace = 'nowrap';
      el.style.fontSize = '100px';
      const range = document.createRange();
      range.selectNodeContents(el);
      const natural = range.getBoundingClientRect().width;
      const room = el.clientWidth;
      const size = natural > 0 ? (100 * room) / natural : 100;
      const max = Math.min(150, room / 4);
      const min = Math.min(34, room / 14);
      if (size < min) {
        el.style.whiteSpace = '';
        el.style.fontSize = `${min}px`;
      } else el.style.fontSize = `${Math.min(size * 0.995, max).toFixed(2)}px`;
    }
  }
  addEventListener('resize', fitLines);
  for (const el of showLines) el.addEventListener('input', fitLines);

  async function swapIn(buffer: ArrayBuffer): Promise<void> {
    const family = flip++ % 2 ? 'Foundry Live B' : 'Foundry Live A';
    const face = new FontFace(family, buffer);
    await face.load();
    document.fonts.add(face);
    root.style.setProperty('--face', `'${family}'`);
    if (live) document.fonts.delete(live);
    live = face;
    fitLines();
    metaEl.textContent = `${CHARSET.length} characters, ${(buffer.byteLength / 1024).toFixed(0)} KB, OpenType with PostScript outlines`;
    if (root.dataset.state !== 'ready') {
      root.dataset.state = 'ready';
      sheet.removeAttribute('aria-busy');
    }
  }

  async function recast(): Promise<void> {
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    do {
      pending = false;
      try {
        await swapIn(await caster({ ...params }, 'Foundry Live'));
      } catch (err) {
        console.warn('Type foundry: could not cast', err);
      }
    } while (pending);
    busy = false;
  }

  // ---- Controls ----

  const sliders = $$<HTMLInputElement>('input[data-param]');
  const outputs = new Map($$<HTMLOutputElement>('output[data-out]').map((o) => [o.dataset.out!, o]));

  const fmt: Record<string, (v: number) => string> = {
    nib: (v) => `${Math.round(v)}`,
    contrast: (v) => `${Math.round(v * 100)}%`,
    slant: (v) => `${v.toFixed(1).replace(/\.0$/, '')}°`,
    width: (v) => `${Math.round(v * 100)}%`,
    xheight: (v) => `${Math.round(v * 100)}%`,
    round: (v) => v.toFixed(2),
    branch: (v) => `${Math.round(v * 100)}%`,
  };

  function syncControls(): void {
    root.dataset.pen = params.pen;
    for (const input of sliders) {
      const key = input.dataset.param as NumKey;
      input.value = String(params[key]);
      const [lo, hi] = RANGES[key];
      input.style.setProperty('--fill', `${((params[key] - lo) / (hi - lo)) * 100}%`);
      const out = outputs.get(key);
      if (out) out.textContent = fmt[key](params[key]);
    }
    // A round pen has no edge to set.
    const contrastRow = sliders.find((s) => s.dataset.param === 'contrast')?.closest('label');
    if (contrastRow) contrastRow.hidden = params.pen === 'round';
    const nibLabel = root.querySelector('[data-label="nib"]');
    const edgeLabel = root.querySelector('[data-label="contrast"]');
    if (nibLabel) nibLabel.textContent = params.pen === 'broad' ? 'Nib' : params.pen === 'round' ? 'Diameter' : 'Swell';
    if (edgeLabel) edgeLabel.textContent = params.pen === 'pointed' ? 'Hairline' : 'Edge';
    for (const r of $$<HTMLInputElement>('input[name="pen"]')) r.checked = r.value === params.pen;
    for (const r of $$<HTMLInputElement>('input[name="serif"]')) r.checked = r.value === params.serif;
    const preset = matchingPreset();
    for (const b of $$<HTMLButtonElement>('[data-preset]'))
      b.setAttribute('aria-pressed', String(b.dataset.preset === preset?.id));
    drawDial();
    describeEl.textContent = describe(params);
  }

  function syncName(): void {
    if (document.activeElement !== nameEl) nameEl.textContent = name;
    echoEl.textContent = name;
    fileEl.textContent = `${cleanName(name).replace(/ /g, '-')}.otf`;
  }

  function changed(): void {
    syncControls();
    writeHash();
    void recast();
    drawProof();
  }

  for (const input of sliders)
    input.addEventListener('input', () => {
      const key = input.dataset.param as NumKey;
      params[key] = clamp(parseFloat(input.value), RANGES[key]);
      changed();
    });

  for (const r of $$<HTMLInputElement>('input[name="pen"]'))
    r.addEventListener('change', () => {
      if (!r.checked) return;
      params.pen = r.value as Params['pen'];
      changed();
    });

  for (const r of $$<HTMLInputElement>('input[name="serif"]'))
    r.addEventListener('change', () => {
      if (!r.checked) return;
      params.serif = r.value as Serif;
      changed();
    });

  for (const b of $$<HTMLButtonElement>('[data-preset]'))
    b.addEventListener('click', () => {
      const preset = PRESETS.find((p) => p.id === b.dataset.preset);
      if (!preset) return;
      params = { ...preset.params };
      if (!nameEdited) {
        name = preset.name;
        syncName();
      }
      changed();
      animateProof();
    });

  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameEl.blur();
    }
  });
  nameEl.addEventListener('input', () => {
    name = (nameEl.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Untitled';
    nameEdited = true;
    syncName();
    writeHash();
  });
  nameEl.addEventListener('blur', () => {
    nameEl.textContent = name;
  });

  drawer.addEventListener('click', () => {
    const open = bench.dataset.open !== 'true';
    bench.dataset.open = String(open);
    drawer.setAttribute('aria-expanded', String(open));
  });

  // ---- The dial: the nib seen from above, turned to its angle ----

  const ticks = $<SVGGElement>('[data-ticks]')!;
  for (let a = 0; a < 360; a += 15) {
    const major = a % 45 === 0;
    const r0 = major ? 92 : 96;
    const t = (a * Math.PI) / 180;
    ticks.appendChild(
      svg('line', {
        class: major ? 'tick tick-major' : 'tick',
        x1: (Math.cos(t) * r0).toFixed(2),
        y1: (-Math.sin(t) * r0).toFixed(2),
        x2: (Math.cos(t) * 102).toFixed(2),
        y2: (-Math.sin(t) * 102).toFixed(2),
      }),
    );
  }
  ticks.appendChild(svg('circle', { class: 'nib-ring', r: 70 }));

  function drawDial(): void {
    const scale = 0.62;
    dialNib.replaceChildren();
    let shape: Pt[];
    if (params.pen === 'broad') shape = broadNib(params.nib, Math.max(params.nib * params.contrast, 3), params.angle);
    else if (params.pen === 'round') shape = roundNib(params.nib / 2);
    else shape = roundNib(params.nib / 2);
    const poly = svg('polygon', {
      class: 'nib-shape',
      points: shape.map(([x, y]) => `${(x * scale).toFixed(2)},${(-y * scale).toFixed(2)}`).join(' '),
    });
    dialNib.appendChild(poly);
    if (params.pen === 'pointed') {
      const hair = Math.max(params.nib * params.contrast, 4) / 2;
      dialNib.appendChild(svg('circle', { r: (hair * scale).toFixed(2), fill: 'var(--red)' }));
    }
    const t = (params.angle * Math.PI) / 180;
    const x = Math.cos(t) * 86;
    const y = -Math.sin(t) * 86;
    dialArm.setAttribute('x1', (-x).toFixed(2));
    dialArm.setAttribute('y1', (-y).toFixed(2));
    dialArm.setAttribute('x2', x.toFixed(2));
    dialArm.setAttribute('y2', y.toFixed(2));
    dialKnob.setAttribute('cx', x.toFixed(2));
    dialKnob.setAttribute('cy', y.toFixed(2));
    if (params.pen === 'broad') {
      angleOut.textContent = `${Math.round(params.angle)}°`;
      dialLabel.textContent = 'Nib angle';
      dialNote.textContent = 'Drag the red knob to turn the edge';
      dial.setAttribute('aria-valuenow', String(Math.round(params.angle)));
      dial.setAttribute('aria-valuetext', `${Math.round(params.angle)} degrees`);
      dial.setAttribute('aria-disabled', 'false');
    } else if (params.pen === 'round') {
      angleOut.textContent = `${Math.round(params.nib)}`;
      dialLabel.textContent = 'Diameter';
      dialNote.textContent = 'A round pen has no angle: every stroke is one weight';
      dial.setAttribute('aria-disabled', 'true');
    } else {
      angleOut.textContent = `${Math.round(params.nib)}`;
      dialLabel.textContent = 'Full swell';
      dialNote.textContent = 'The tines spread on downstrokes, out to the outer ring';
      dial.setAttribute('aria-disabled', 'true');
    }
  }

  function setAngleFromPointer(e: PointerEvent): void {
    const r = dial.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = -(e.clientY - (r.top + r.height / 2));
    let a = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (a > 90) a -= 180;
    if (a < -90) a += 180;
    if (a < RANGES.angle[0] - 20) a = RANGES.angle[1];
    params.angle = Math.round(clamp(a, RANGES.angle));
    changed();
  }

  dial.addEventListener('pointerdown', (e) => {
    if (params.pen !== 'broad') return;
    try {
      dial.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't be captured */
    }
    dial.style.cursor = 'grabbing';
    setAngleFromPointer(e);
    const move = (ev: PointerEvent) => setAngleFromPointer(ev);
    const up = () => {
      dial.style.cursor = '';
      dial.removeEventListener('pointermove', move);
      dial.removeEventListener('pointerup', up);
      dial.removeEventListener('pointercancel', up);
    };
    dial.addEventListener('pointermove', move);
    dial.addEventListener('pointerup', up);
    dial.addEventListener('pointercancel', up);
  });

  dial.addEventListener('keydown', (e) => {
    if (params.pen !== 'broad') return;
    const step = e.shiftKey ? 5 : 1;
    let a = params.angle;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') a += step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') a -= step;
    else if (e.key === 'Home') a = RANGES.angle[0];
    else if (e.key === 'End') a = RANGES.angle[1];
    else return;
    e.preventDefault();
    params.angle = clamp(a, RANGES.angle);
    changed();
  });

  // ---- The proof: one letter large, with its skeleton and the pen that made it ----

  let anim = 0;

  function strokeLength(pts: Pt[]): number {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return len;
  }

  function prefix(pts: Pt[], len: number): Pt[] {
    const out: Pt[] = [pts[0]];
    let left = len;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (seg >= left) {
        const t = seg ? left / seg : 0;
        out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
        return out;
      }
      out.push(pts[i]);
      left -= seg;
    }
    return out;
  }

  const DOT_LEN = 60;

  /** Draw the proof with the pen this far along its strokes (Infinity for the finished letter). */
  function drawProof(progress = Infinity, c: Cut = cut(selected, params)): void {
    const m = metrics(params);
    const pen = penOf(params);
    const pad = 70;
    const h = ASC + 110 - (DESC - 90);
    const w = Math.max(h, c.advance + pad * 2);
    const vx = c.advance / 2 - w / 2;
    const vy = -(ASC + 110);
    proofSvg.setAttribute('viewBox', `${vx.toFixed(1)} ${vy} ${w.toFixed(1)} ${h}`);
    proofSvg.replaceChildren();
    const fs = h * 0.036;

    proofSvg.appendChild(svg('rect', { class: 'advance', x: 0, y: -ASC, width: c.advance, height: ASC - DESC }));
    const lines: [string, number][] = [
      ['ascender', ASC],
      ['cap height', CAP],
      ['x-height', m.xh],
      ['baseline', 0],
      ['descender', DESC],
    ];
    for (const [label, y] of lines) {
      proofSvg.appendChild(
        svg('line', {
          class: y === 0 ? 'metric metric-base' : 'metric',
          x1: vx,
          x2: vx + w,
          y1: -y,
          y2: -y,
        }),
      );
      const text = svg('text', { class: 'metric-label', x: vx + fs * 0.6, y: -y - fs * 0.4, 'font-size': fs });
      text.textContent = label;
      proofSvg.appendChild(text);
    }

    // Ghosts of the nib along each stroke: where the pen sat, every so often.
    const ghosts: Pt[][] = [];
    const every = Math.max(36, params.nib * 0.9);
    for (const s of c.strokes) {
      const nibs = nibsFor(s, pen);
      let next = 0;
      let along = 0;
      for (let i = 0; i < s.length; i++) {
        if (i > 0) along += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
        if (along >= next || i === s.length - 1) {
          ghosts.push(nibs[i].map(([x, y]) => [s[i][0] + x, s[i][1] + y] as Pt));
          next = along + every;
        }
      }
    }
    for (const d of c.dots) ghosts.push(dotNib(pen).map(([x, y]) => [d[0] + x, d[1] + y] as Pt));

    const done = progress === Infinity;

    // The ink so far.
    const ink: Pt[][] = [];
    let left = progress;
    let head: { at: Pt; nib: Pt[] } | null = null;
    for (const s of c.strokes) {
      if (left <= 0) break;
      const len = strokeLength(s);
      if (left >= len) {
        ink.push(sweep(s, pen));
      } else {
        const part = prefix(s, left);
        if (part.length > 1) ink.push(sweep(part, pen));
        const nibs = nibsFor(part, pen);
        head = { at: part[part.length - 1], nib: nibs[nibs.length - 1] };
      }
      left -= len;
    }
    for (const d of c.dots) {
      if (left <= 0) break;
      if (left >= DOT_LEN) ink.push(sweep([d], pen));
      else head = { at: d, nib: dotNib(pen) };
      left -= DOT_LEN;
    }
    proofSvg.appendChild(svg('path', { class: 'ink', d: pathOf(ink), 'fill-rule': 'nonzero' }));
    // Pressed into the finished ink: where the nib sat, every so often.
    if (done) proofSvg.appendChild(svg('path', { class: 'ghost', d: pathOf(ghosts) }));

    // The skeleton on top, the way the hand would follow it.
    for (const s of c.strokes)
      proofSvg.appendChild(
        svg('polyline', { class: 'bone', points: s.map(([x, y]) => `${x.toFixed(1)},${(-y).toFixed(1)}`).join(' ') }),
      );
    for (const d of c.dots) proofSvg.appendChild(svg('circle', { class: 'bone-dot', cx: d[0], cy: -d[1], r: 7 }));

    if (head) {
      const { at, nib } = head;
      proofSvg.appendChild(
        svg('polygon', {
          class: 'nib-now',
          points: nib.map(([x, y]) => `${(at[0] + x).toFixed(1)},${(-(at[1] + y)).toFixed(1)}`).join(' '),
        }),
      );
    }
    const code = 'U+' + selected.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
    proofLabel.textContent = `${selected} · ${code} · ${c.advance} units wide`;
    if (!done) return;
    cancelAnimationFrame(anim);
  }

  function animateProof(): void {
    cancelAnimationFrame(anim);
    const c = cut(selected, params);
    const total = c.strokes.reduce((a, s) => a + strokeLength(s), 0) + c.dots.length * DOT_LEN;
    if (reduced || total === 0) {
      drawProof(Infinity, c);
      return;
    }
    const speed = Math.max(700, total / 2.2);
    let t0 = -1;
    const frame = (now: number) => {
      if (t0 < 0) t0 = now;
      const dist = Math.max(0, ((now - t0) / 1000) * speed);
      if (dist >= total) {
        drawProof(Infinity, c);
        return;
      }
      drawProof(dist, c);
      anim = requestAnimationFrame(frame);
    };
    anim = requestAnimationFrame(frame);
  }

  const charButtons = $$<HTMLButtonElement>('[data-char]');
  function select(ch: string, write = true): void {
    selected = ch;
    for (const b of charButtons) b.setAttribute('aria-pressed', String(b.dataset.char === ch));
    if (write) animateProof();
    else drawProof();
  }
  for (const b of charButtons) b.addEventListener('click', () => select(b.dataset.char!));
  $<HTMLButtonElement>('[data-write]')!.addEventListener('click', () => animateProof());

  let seen = false;
  new IntersectionObserver(
    (entries) => {
      if (seen || !entries.some((e) => e.isIntersecting)) return;
      seen = true;
      animateProof();
    },
    { threshold: 0.4 },
  ).observe(proofSvg);

  // ---- Casting a copy to keep ----

  $<HTMLButtonElement>('[data-cast]')!.addEventListener('click', async () => {
    const family = cleanName(name);
    const prev = metaEl.textContent;
    metaEl.textContent = 'Casting…';
    try {
      const buffer = await caster({ ...params }, family);
      const blob = new Blob([buffer], { type: 'font/otf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${family.replace(/ /g, '-')}.otf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      metaEl.textContent = `Cast ${a.download}: ${(buffer.byteLength / 1024).toFixed(0)} KB, ${CHARSET.length} characters`;
    } catch (err) {
      console.warn('Type foundry: could not cast', err);
      metaEl.textContent = prev;
    }
  });

  // A link pasted into the address bar, or the back button, brings its face with it.
  addEventListener('hashchange', () => {
    nameEdited = false;
    readHash();
    syncName();
    changed();
  });

  // ---- Go ----

  readHash();
  syncName();
  syncControls();
  select(selected, false);
  void recast();
}
