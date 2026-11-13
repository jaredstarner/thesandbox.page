// Titivillus: the devil, the page he runs on, and the faults he gathers.
//
// The browser typesets the account; _layout reads every word back into a mask
// so the devil can stand on the letters. Faults are set into the running text
// at random for each impression; plucking one mends the word, which reflows
// the paragraph, so the ground under the devil can move. A window resize
// reflows the whole page, and he keeps his footing on the same word.

import { AIR, SOLID, at, buildLayout, clearFontCache, lineOf, wrapIn, wrapWords, type Layout, type Word } from './_layout';
import { escapeHtml, mend, mulberry, setFaults, type Fault } from './_faults';
import { DEVIL_UNITS, drawDevil, sackPoint, type DevilState, type Pose } from './_sprite';
import * as sfx from './_sound';

const PER_LEAF = 3;
const STEP = 1 / 120;

type Action = 'left' | 'right' | 'jump' | 'down';

interface Physics {
  hw: number;
  height: number;
  stepUp: number;
  snap: number;
  run: number;
  accGround: number;
  accAir: number;
  friction: number;
  gravity: number;
  jumpV: number;
  fallMax: number;
  scale: number;
  clear: number;
}

interface Flyer {
  text: string;
  font: string;
  x: number;
  y: number;
  t: number;
  spin: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

interface Ring {
  x: number;
  y: number;
  t: number;
  r: number;
}

interface Anchor {
  el: HTMLElement | null;
  dx: number;
  dy: number;
  x: number;
  y: number;
}

const KEYMAP: Record<string, Action> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'jump',
  ArrowUp: 'jump',
  KeyW: 'jump',
  KeyZ: 'jump',
  ArrowDown: 'down',
  KeyS: 'down',
  KeyX: 'down',
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function spokenTime(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const sec = `${r} ${r === 1 ? 'second' : 'seconds'}`;
  return m ? `${m} ${m === 1 ? 'minute' : 'minutes'} and ${sec}` : sec;
}

export function start(root: HTMLElement): void {
  const leavesEl = root.querySelector<HTMLElement>('[data-leaves]');
  const stage = root.querySelector<HTMLCanvasElement>('[data-stage]');
  const ctx = stage?.getContext('2d');
  if (!leavesEl || !stage || !ctx) return;
  const leavesBox: HTMLElement = leavesEl;
  const canvas: HTMLCanvasElement = stage;
  const g: CanvasRenderingContext2D = ctx;

  const timeEl = root.querySelector<HTMLElement>('[data-time]');
  const hudCount = root.querySelector<HTMLElement>('.slip-count');
  const soundBtn = root.querySelector<HTMLButtonElement>('[data-sound]');
  const errataBtn = root.querySelector<HTMLButtonElement>('[data-goto-errata]');
  const errataList = root.querySelector<HTMLOListElement>('[data-errata]');
  const errataNone = root.querySelector<HTMLElement>('[data-errata-none]');
  const revealBtn = root.querySelector<HTMLButtonElement>('[data-reveal]');
  const againBtn = root.querySelector<HTMLButtonElement>('[data-again]');
  const finisEl = root.querySelector<HTMLElement>('[data-finis]');
  const finisNote = root.querySelector<HTMLElement>('[data-finis-note]');
  const errataLeaf = root.querySelector<HTMLElement>('.errata-leaf');
  const pad = root.querySelector<HTMLElement>('[data-pad]');

  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  let seed = Number(params.get('seed')) || (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;

  // ---- State -------------------------------------------------------------
  let layout: Layout | null = null;
  let wordByEl = new Map<HTMLElement, Word>();
  let P: Physics = physicsFor(21, 31.92);
  let faults: Fault[] = [];
  let found = 0;
  let idlePlucks = 0;
  let startedAt = 0;
  let endedAt = 0;
  let phase: 'ready' | 'playing' | 'finished' | 'revealed' = 'ready';
  let follow = true;
  let marks: { fault: Fault; el: HTMLElement }[] = [];
  let maskImage: HTMLCanvasElement | null = null;
  let relayoutTimer = 0;
  let last = performance.now();
  let acc = 0;
  let clock = 0;
  let stir = 0;

  const keys: Record<Action, boolean> = { left: false, right: false, jump: false, down: false };
  const flyers: Flyer[] = [];
  const motes: Mote[] = [];
  const rings: Ring[] = [];

  const d = {
    x: 0,
    y: 0,
    vis: 0,
    vx: 0,
    vy: 0,
    grounded: false,
    coyote: 0,
    jumpBuf: 0,
    jumpHeld: false,
    facing: 1 as 1 | -1,
    phase: 0,
    pluckT: -1,
    pluckDone: false,
    dropT: 0,
    dropY: 0,
    squash: 0,
    gulp: 0,
    cheerT: 0,
    peakY: 0,
  };

  const look: DevilState = {
    pose: 'idle',
    facing: 1,
    phase: 0,
    t: 0,
    pluck: 0,
    squash: 0,
    sack: 0,
    stir: 0,
    gulp: 0,
    vy: 0,
  };

  // ---- Terrain -----------------------------------------------------------
  function physicsFor(fs: number, lineH: number): Physics {
    const gravity = 80 * fs;
    return {
      hw: fs * 0.3,
      height: fs * 1.25,
      stepUp: fs * 0.48,
      snap: fs * 0.28,
      run: 7.8 * fs,
      accGround: 75 * fs,
      accAir: 46 * fs,
      friction: 95 * fs,
      gravity,
      jumpV: Math.sqrt(2 * gravity * 2.5 * lineH),
      fallMax: 36 * fs,
      scale: (fs * 1.3) / DEVIL_UNITS,
      clear: Math.max(3, Math.round(fs * 0.28)),
    };
  }

  /**
   * Is this row the top of something, at this column? It needs clear air above
   * it, so the floor of a letter's counter (inside an o or an e) doesn't count.
   */
  function surface(x: number, y: number): boolean {
    if (!layout) return false;
    const v = at(layout, x, y);
    if (v === AIR) return false;
    if (d.dropT > 0 && y <= d.dropY && v !== SOLID) return false;
    for (let k = 1; k <= P.clear; k++) if (at(layout, x, y - k) !== AIR) return false;
    return true;
  }

  /**
   * The highest top under the feet within a band, or null. Every pixel column
   * across his stance counts, so he bridges a word space and stands on a single
   * stem, but drops off the end of a line.
   */
  function groundIn(x: number, yTop: number, yBot: number): number | null {
    const c0 = Math.round(x - P.hw);
    const c1 = Math.round(x + P.hw);
    for (let y = Math.ceil(yTop); y <= Math.floor(yBot); y++) {
      for (let c = c0; c <= c1; c++) if (surface(c, y)) return y;
    }
    return null;
  }

  function solidAt(x: number, yTop: number, yBot: number): boolean {
    if (!layout) return false;
    for (let y = Math.floor(yTop); y <= Math.floor(yBot); y++) if (at(layout, x, y) === SOLID) return true;
    return false;
  }

  function wordAt(x: number, y: number): Word | null {
    if (!layout) return null;
    let best: Word | null = null;
    let bestD = Infinity;
    for (const w of layout.words) {
      if (x < w.x0 - P.hw || x > w.x1 + P.hw) continue;
      const h = w.y1 - w.y0;
      if (y < w.y0 - 3 || y > w.y0 + h * 0.78) continue;
      const dist = x < w.x0 ? w.x0 - x : x > w.x1 ? x - w.x1 : 0;
      if (dist < bestD) {
        bestD = dist;
        best = w;
      }
    }
    return best;
  }

  function captureAnchor(): Anchor {
    const w = d.grounded ? wordAt(d.x, d.y) : null;
    return w
      ? { el: w.el, dx: d.x - w.x0, dy: d.y - w.y0, x: d.x, y: d.y }
      : { el: null, dx: 0, dy: 0, x: d.x, y: d.y };
  }

  function restoreAnchor(a: Anchor): void {
    if (!layout) return;
    const w = a.el ? wordByEl.get(a.el) : null;
    if (w) {
      d.x = clamp(w.x0 + a.dx, w.x0, w.x1);
      const gy = groundIn(d.x, w.y0 - 4, w.y1);
      d.y = gy ?? w.y0 + a.dy;
      d.vis = d.y;
    } else {
      d.x = clamp(a.x, P.hw + 2, layout.w - P.hw - 2);
      d.y = Math.min(a.y, layout.h - 2);
      d.grounded = false;
    }
  }

  function relayout(): void {
    const anchor = layout ? captureAnchor() : null;
    layout = buildLayout(leavesBox);
    wordByEl = new Map(layout.words.map((w) => [w.el, w]));
    P = physicsFor(layout.fontSize, layout.lineH);
    placeMarks();
    if (anchor) restoreAnchor(anchor);
    maskImage = null;
  }

  function scheduleRelayout(): void {
    window.clearTimeout(relayoutTimer);
    relayoutTimer = window.setTimeout(() => {
      clearFontCache(leavesBox);
      relayout();
    }, 120);
  }

  // ---- Faults ------------------------------------------------------------
  function impression(): void {
    faults = setFaults(layout?.words ?? [], PER_LEAF, mulberry(seed));
    found = 0;
    idlePlucks = 0;
    startedAt = 0;
    endedAt = 0;
    phase = 'ready';
    updateHud();
    relayout();
  }

  function placeMarks(): void {
    if (!layout) return;
    for (const m of marks) {
      const w = wordByEl.get(m.fault.el);
      const leaf = m.el.parentElement;
      if (!w || !leaf) continue;
      const leafBox = leaf.getBoundingClientRect();
      const body = leaf.querySelector<HTMLElement>('[data-body]');
      const bodyBox = body?.getBoundingClientRect();
      const top = layout.oy + w.y0 - (leafBox.top + window.scrollY);
      const even = Number(leaf.dataset.leaf) % 2 === 0;
      m.el.style.top = `${top + (w.y1 - w.y0) * 0.12}px`;
      if (bodyBox) {
        if (even) {
          m.el.style.left = `${bodyBox.right - leafBox.left + 10}px`;
          m.el.style.right = '';
        } else {
          m.el.style.right = `${leafBox.right - bodyBox.left + 10}px`;
          m.el.style.left = '';
        }
      }
    }
  }

  function addErrata(f: Fault, w: Word): void {
    if (!errataList || !layout) return;
    const li = document.createElement('li');
    const line = lineOf(layout, w);
    li.dataset.order = String(w.leaf * 1000 + line);
    li.innerHTML =
      `Leaf ${w.leaf}, line ${line}: for <span class="w">${escapeHtml(f.lead)}${f.html}</span> read ` +
      `<span class="w">${escapeHtml(f.lead + f.core)}</span>.`;
    wrapIn(li);
    const after = [...errataList.children].find((c) => Number((c as HTMLElement).dataset.order) > w.leaf * 1000 + line);
    errataList.insertBefore(li, after ?? null);
    if (errataNone) errataNone.hidden = true;
  }

  function gather(f: Fault, w: Word): void {
    const [sx, sy] = [(w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2];
    const faultyText = (f.el.textContent ?? '').replace(/^[^a-z]+|[^a-z]+$/gi, '');
    const cs = getComputedStyle(f.el);
    flyers.push({ text: faultyText, font: `${cs.fontStyle} ${cs.fontSize} ${cs.fontFamily}`, x: sx, y: sy, t: 0, spin: (Math.random() - 0.5) * 7 });
    f.found = true;
    found++;
    addErrata(f, w);
    mend(f);
    f.el.classList.remove('set');
    void f.el.offsetWidth;
    f.el.classList.add('set');
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = f.mark;
    mark.setAttribute('aria-hidden', 'true');
    w.el.closest('[data-leaf]')?.append(mark);
    marks.push({ fault: f, el: mark });
    relayout();
    const nw = wordByEl.get(f.el);
    if (nw) rings.push({ x: (nw.x0 + nw.x1) / 2, y: (nw.y0 + nw.y1) / 2, t: 0, r: (nw.x1 - nw.x0) * 0.6 + 6 });
    sfx.gathered(found);
    window.setTimeout(() => (d.gulp = 1), 420);
    updateHud();
    if (found === faults.length) finish();
  }

  function idle(w: Word): void {
    idlePlucks++;
    w.el.classList.remove('bump');
    void w.el.offsetWidth;
    w.el.classList.add('bump');
    for (let i = 0; i < 5; i++) {
      motes.push({
        x: d.x + (Math.random() - 0.5) * 8,
        y: d.y - 1,
        vx: (Math.random() - 0.5) * 60,
        vy: -20 - Math.random() * 30,
        life: 0.5,
        size: 0.9,
      });
    }
    sfx.sound();
  }

  function finish(): void {
    phase = 'finished';
    endedAt = performance.now();
    d.cheerT = 2.4;
    sfx.finis();
    if (finisEl && finisNote) {
      finisNote.textContent = `All ${faults.length} gathered in ${spokenTime(endedAt - startedAt)}, with ${idlePlucks} idle ${
        idlePlucks === 1 ? 'pluck' : 'plucks'
      }.`;
      finisEl.hidden = false;
      wrapIn(finisNote);
    }
    updateHud();
    relayout();
  }

  function reveal(): void {
    if (phase === 'finished') return;
    for (const f of faults) {
      if (f.found) continue;
      f.el.classList.add('missed');
      const w = wordByEl.get(f.el);
      if (w && errataList && layout) {
        const li = document.createElement('li');
        const line = lineOf(layout, w);
        li.className = 'missed';
        li.dataset.order = String(w.leaf * 1000 + line);
        li.innerHTML =
          `Leaf ${w.leaf}, line ${line}: for <span class="w">${escapeHtml(f.lead)}${f.html}</span> read ` +
          `<span class="w">${escapeHtml(f.lead + f.core)}</span>, not gathered.`;
        wrapIn(li);
        const after = [...errataList.children].find(
          (c) => Number((c as HTMLElement).dataset.order) > w.leaf * 1000 + line,
        );
        errataList.insertBefore(li, after ?? null);
      }
    }
    if (errataNone) errataNone.hidden = true;
    if (phase === 'playing' || phase === 'ready') {
      phase = 'revealed';
      endedAt = performance.now();
    }
    updateHud();
    relayout();
  }

  function again(): void {
    for (const f of faults) {
      mend(f);
      f.el.classList.remove('missed', 'set');
    }
    for (const m of marks) m.el.remove();
    marks = [];
    if (errataList) errataList.textContent = '';
    if (errataNone) errataNone.hidden = false;
    if (finisEl) finisEl.hidden = true;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    relayout();
    impression();
    spawn();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    follow = true;
  }

  function updateHud(): void {
    if (!hudCount) return;
    hudCount.innerHTML =
      phase === 'finished'
        ? `All <b>${faults.length}</b> faults in the sack`
        : `<b>${found}</b> of <b>${faults.length}</b> faults in the sack`;
  }

  // ---- The devil ---------------------------------------------------------
  function spawn(): void {
    if (!layout) return;
    const title = leavesBox.querySelector<HTMLElement>('.tp-title .w');
    const w = title ? wordByEl.get(title) : null;
    if (w) {
      d.x = w.x0 + (w.x1 - w.x0) * 0.28;
      d.y = groundIn(d.x, w.y0 - 2, w.y1) ?? w.y0;
    } else {
      d.x = layout.w / 2;
      d.y = 40;
    }
    d.vis = d.y;
    d.vx = d.vy = 0;
    d.grounded = true;
    d.pluckT = -1;
    d.facing = 1;
  }

  function press(a: Action): void {
    follow = true;
    sfx.unlock();
    if (phase === 'ready') {
      phase = 'playing';
      startedAt = performance.now();
    }
    if (a === 'jump') {
      d.jumpHeld = true;
      if (d.pluckT >= 0 && !d.pluckDone) d.pluckT = -1;
      if (keys.down && d.grounded) dropThrough();
      else d.jumpBuf = 0.13;
    } else if (a === 'down') {
      if (d.grounded && d.pluckT < 0) {
        d.pluckT = 0;
        d.pluckDone = false;
      }
    }
  }

  function release(a: Action): void {
    if (a === 'jump') d.jumpHeld = false;
  }

  function dropThrough(): void {
    d.pluckT = -1;
    d.dropT = 0.22;
    d.dropY = d.y + (layout?.fontSize ?? 21);
    d.grounded = false;
    d.vy = 60;
    d.peakY = d.y;
  }

  function step(dt: number): void {
    if (!layout) return;
    clock += dt;
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const plucking = d.pluckT >= 0;

    // Run.
    if (dir && !plucking) {
      d.facing = dir as 1 | -1;
      const acc = d.grounded ? P.accGround : P.accAir;
      d.vx += clamp(dir * P.run - d.vx, -acc * dt, acc * dt);
    } else {
      const fr = (d.grounded ? P.friction : P.friction * 0.25) * dt;
      d.vx = Math.abs(d.vx) <= fr ? 0 : d.vx - Math.sign(d.vx) * fr;
    }
    let nx = d.x + d.vx * dt;
    nx = clamp(nx, P.hw + 2, layout.w - P.hw - 2);
    // Solid blocks (the woodcut initials) stop him at the body.
    const lead = nx + Math.sign(d.vx || 1) * P.hw;
    if (d.vx !== 0 && solidAt(lead, d.y - P.height + 2, d.y - P.stepUp - 1)) {
      nx = d.x;
      d.vx = 0;
    }
    d.x = nx;

    // Pluck.
    if (plucking) {
      d.pluckT += dt;
      if (!d.pluckDone && d.pluckT >= 0.16) {
        d.pluckDone = true;
        const w = wordAt(d.x, d.y) ?? wordAt(d.x - P.hw * 1.5, d.y) ?? wordAt(d.x + P.hw * 1.5, d.y);
        if (w) {
          const f = faults.find((ff) => ff.el === w.el && !ff.found);
          if (f && phase !== 'revealed') gather(f, w);
          else if (phase === 'playing') idle(w);
        }
      }
      if (d.pluckT >= 0.42) d.pluckT = -1;
    }

    // Jump.
    d.jumpBuf = Math.max(0, d.jumpBuf - dt);
    d.coyote = Math.max(0, d.coyote - dt);
    d.dropT = Math.max(0, d.dropT - dt);
    if (d.jumpBuf > 0 && (d.grounded || d.coyote > 0) && d.pluckT < 0) {
      d.vy = -P.jumpV;
      d.grounded = false;
      d.coyote = 0;
      d.jumpBuf = 0;
      d.peakY = d.y;
      sfx.leap();
    }

    if (d.grounded) {
      const gy = groundIn(d.x, d.y - P.stepUp, d.y + P.snap);
      if (gy === null) {
        d.grounded = false;
        d.coyote = 0.09;
        d.vy = 0;
        d.peakY = d.y;
      } else {
        d.y = gy;
      }
    }
    if (!d.grounded) {
      const rising = d.vy < 0;
      const gmul = rising && !d.jumpHeld ? 2.4 : 1;
      d.vy = Math.min(P.fallMax, d.vy + P.gravity * gmul * dt);
      const ny = d.y + d.vy * dt;
      if (d.vy > 0) {
        const gy = groundIn(d.x, d.y + 1, ny);
        if (gy !== null) {
          const fall = gy - d.peakY;
          d.y = gy;
          d.grounded = true;
          d.vy = 0;
          const hard = clamp(fall / (layout.lineH * 4), 0, 1);
          d.squash = 0.35 + hard * 0.65;
          if (fall > layout.lineH * 0.6) sfx.land(hard);
          if (hard > 0.35) {
            for (let i = 0; i < 6; i++) {
              const side = i % 2 ? 1 : -1;
              motes.push({
                x: d.x + side * P.hw,
                y: d.y - 1,
                vx: side * (30 + Math.random() * 40),
                vy: -15 - Math.random() * 25,
                life: 0.45,
                size: 0.8,
              });
            }
          }
        } else {
          d.y = ny;
        }
      } else {
        // Rising: letters let him through from below, but a block is a ceiling.
        if (solidAt(d.x, ny - P.height, ny - P.height + 1)) d.vy = 0;
        else d.y = ny;
        d.peakY = Math.min(d.peakY, d.y);
      }
      if (d.y > layout.h - 2) {
        d.y = layout.h - 2;
        d.vy = 0;
        d.grounded = true;
      }
    }

    // Smooth the drawn height over the bumps of the letters.
    d.vis = d.grounded ? d.vis + (d.y - d.vis) * (1 - Math.exp(-dt * 28)) : d.y;
    d.squash = Math.max(0, d.squash - dt * 5);
    d.gulp = Math.max(0, d.gulp - dt * 3);
    d.cheerT = Math.max(0, d.cheerT - dt);
    if (d.grounded && Math.abs(d.vx) > 1) d.phase += Math.abs(d.vx) * dt * (0.105 / (P.scale * 1.0));
  }

  // ---- Effects and drawing ----------------------------------------------
  function nearestFault(): number {
    if (!layout || phase === 'revealed') return Infinity;
    let best = Infinity;
    for (const f of faults) {
      if (f.found) continue;
      const w = wordByEl.get(f.el);
      if (!w) continue;
      const dx = (w.x0 + w.x1) / 2 - d.x;
      const dy = (w.y0 + w.y1) / 2 - (d.y - P.height * 0.4);
      best = Math.min(best, Math.hypot(dx, dy * 1.3));
    }
    return best;
  }

  function effects(dt: number): void {
    if (!layout) return;
    const near = nearestFault();
    const target = Math.pow(clamp(1 - near / (layout.lineH * 4.5), 0, 1), 1.4);
    stir += (target - stir) * (1 - Math.exp(-dt * 6));
    const [mx, my] = sackPoint(look, P.scale);
    if (stir > 0.12 && Math.random() < stir * 12 * dt) {
      motes.push({
        x: d.x + mx + (Math.random() - 0.5) * 4,
        y: d.vis + my,
        vx: (Math.random() - 0.5) * 14,
        vy: -18 - Math.random() * 22,
        life: 0.9,
        size: 0.6 + Math.random() * 0.7,
      });
    }
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i];
      m.life -= dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.vy += 30 * dt;
      if (m.life <= 0) motes.splice(i, 1);
    }
    for (let i = flyers.length - 1; i >= 0; i--) {
      flyers[i].t += dt / 0.5;
      if (flyers[i].t >= 1) flyers.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].t += dt / 0.7;
      if (rings[i].t >= 1) rings.splice(i, 1);
    }
  }

  function camera(dt: number): void {
    if (!layout || !follow) return;
    const vh = window.innerHeight;
    const docY = layout.oy + d.vis - P.height * 0.5;
    const top = window.scrollY + vh * 0.3;
    const bottom = window.scrollY + vh * 0.62;
    let target = window.scrollY;
    if (docY < top) target = docY - vh * 0.3;
    else if (docY > bottom) target = docY - vh * 0.62;
    if (Math.abs(target - window.scrollY) > 0.5) {
      const ny = window.scrollY + (target - window.scrollY) * (1 - Math.exp(-dt * 7));
      window.scrollTo(0, Math.round(ny));
    }
  }

  function buildMaskImage(): HTMLCanvasElement | null {
    if (!layout) return null;
    const c = document.createElement('canvas');
    c.width = layout.w;
    c.height = layout.h;
    const x = c.getContext('2d');
    if (!x) return null;
    const img = x.createImageData(layout.w, layout.h);
    for (let i = 0; i < layout.mask.length; i++) {
      const v = layout.mask[i];
      if (!v) continue;
      const j = i * 4;
      img.data[j] = v === SOLID ? 30 : 220;
      img.data[j + 1] = v === SOLID ? 90 : 30;
      img.data[j + 2] = v === SOLID ? 220 : 30;
      img.data[j + 3] = 110;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  // The devil is drawn off screen, then stamped over a paper-coloured halo, the
  // way a woodcut figure keeps a margin of white around it, so he reads cleanly
  // against the type behind him.
  const spr = document.createElement('canvas');
  const halo = document.createElement('canvas');
  function drawFigure(dpr: number): void {
    const size = Math.ceil(P.scale * 50 * dpr);
    if (spr.width !== size) {
      spr.width = spr.height = halo.width = halo.height = size;
    }
    const sx = spr.getContext('2d');
    const hx = halo.getContext('2d');
    if (!sx || !hx) return;
    const fx = size / 2;
    const fy = size * 0.76;
    sx.setTransform(1, 0, 0, 1, 0, 0);
    sx.clearRect(0, 0, size, size);
    drawDevil(sx, fx, fy, P.scale * dpr, look);
    hx.setTransform(1, 0, 0, 1, 0, 0);
    hx.globalCompositeOperation = 'source-over';
    hx.clearRect(0, 0, size, size);
    const r = 1.7 * dpr;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      hx.drawImage(spr, Math.cos(a) * r, Math.sin(a) * r);
    }
    hx.globalCompositeOperation = 'source-in';
    hx.fillStyle = 'rgba(239, 229, 207, 0.92)';
    hx.fillRect(0, 0, size, size);
    const x = d.x - fx / dpr;
    const y = d.vis - fy / dpr;
    g.drawImage(halo, x, y, size / dpr, size / dpr);
    g.drawImage(spr, x, y, size / dpr, size / dpr);
  }

  function draw(): void {
    if (!layout) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const ox = layout.ox - window.scrollX;
    const oy = layout.oy - window.scrollY;
    g.translate(ox, oy);

    if (debug) {
      maskImage ??= buildMaskImage();
      if (maskImage) g.drawImage(maskImage, 0, 0);
    }

    for (const r of rings) {
      const e = 1 - Math.pow(1 - r.t, 3);
      g.strokeStyle = `rgba(161, 43, 29, ${0.55 * (1 - r.t)})`;
      g.lineWidth = 1.4;
      g.beginPath();
      g.ellipse(r.x, r.y, r.r * (0.6 + e * 0.7), r.r * 0.42 * (0.6 + e * 0.7), 0, 0, Math.PI * 2);
      g.stroke();
    }

    const pose: Pose =
      d.cheerT > 0
        ? 'cheer'
        : d.pluckT >= 0
          ? 'pluck'
          : !d.grounded
            ? d.vy < 0
              ? 'jump'
              : 'fall'
            : Math.abs(d.vx) > 14
              ? 'run'
              : 'idle';
    look.pose = pose;
    look.facing = d.facing;
    look.phase = d.phase;
    look.t = clock;
    look.pluck = d.pluckT >= 0 ? d.pluckT / 0.42 : 0;
    look.squash = d.squash;
    look.sack = faults.length ? found / faults.length : 0;
    look.stir = stir;
    look.gulp = d.gulp;
    look.vy = d.vy;
    drawFigure(dpr);

    g.fillStyle = '#16110d';
    for (const m of motes) {
      g.globalAlpha = clamp(m.life * 1.6, 0, 1);
      g.beginPath();
      g.arc(m.x, m.y, m.size, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    const [mx, my] = sackPoint(look, P.scale);
    for (const f of flyers) {
      const tx = d.x + mx;
      const ty = d.vis + my;
      const e = f.t * f.t * (3 - 2 * f.t);
      const lift = Math.sin(f.t * Math.PI) * layout.lineH * 1.6;
      const x = f.x + (tx - f.x) * e;
      const y = f.y + (ty - f.y) * e - lift;
      const sc = 1 - e * 0.75;
      g.save();
      g.translate(x, y);
      g.rotate(f.spin * f.t);
      g.scale(sc, sc);
      g.font = f.font;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#a12b1d';
      g.fillText(f.text, 0, 0);
      g.restore();
    }
  }

  function frame(now: number): void {
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    acc += dt;
    while (acc >= STEP) {
      step(STEP);
      acc -= STEP;
    }
    effects(dt);
    camera(dt);
    draw();
    if (timeEl) {
      const end = endedAt || performance.now();
      timeEl.textContent = startedAt ? formatTime(end - startedAt) : '0:00';
    }
    requestAnimationFrame(frame);
  }

  // ---- Input ---------------------------------------------------------------
  function onKey(e: KeyboardEvent, down: boolean): void {
    const a = KEYMAP[e.code];
    if (!a) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'INPUT') && (e.code === 'Space' || e.code === 'Enter')) return;
    e.preventDefault();
    if (down) {
      if (!keys[a]) press(a);
      keys[a] = true;
    } else {
      keys[a] = false;
      release(a);
    }
  }

  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => {
    for (const k of Object.keys(keys) as Action[]) keys[k] = false;
    d.jumpHeld = false;
  });
  // A hand on the scroll wheel or the page means the reader wants to look around.
  window.addEventListener('wheel', () => (follow = false), { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (!(e.target as HTMLElement | null)?.closest('[data-pad]')) follow = false;
  }, { passive: true });

  if (pad) {
    for (const b of pad.querySelectorAll<HTMLButtonElement>('[data-key]')) {
      const key = b.dataset.key;
      const a: Action | null = key === 'left' || key === 'right' || key === 'jump' ? key : key === 'pluck' ? 'down' : null;
      if (!a) continue;
      const on = (e: PointerEvent) => {
        e.preventDefault();
        b.setPointerCapture?.(e.pointerId);
        b.classList.add('down');
        if (!keys[a]) press(a);
        keys[a] = true;
      };
      const off = () => {
        b.classList.remove('down');
        keys[a] = false;
        release(a);
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  let soundOn = true;
  try {
    soundOn = localStorage.getItem('titivillus-sound') !== 'off';
  } catch {
    /* storage may be blocked; sound stays on */
  }
  sfx.setEnabled(soundOn);
  soundBtn?.setAttribute('aria-pressed', String(soundOn));
  soundBtn?.addEventListener('click', () => {
    soundOn = !soundOn;
    sfx.setEnabled(soundOn);
    if (soundOn) sfx.unlock();
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    try {
      localStorage.setItem('titivillus-sound', soundOn ? 'on' : 'off');
    } catch {
      /* not remembered */
    }
    soundBtn.blur();
  });
  errataBtn?.addEventListener('click', () => {
    follow = false;
    errataLeaf?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    errataBtn.blur();
  });
  revealBtn?.addEventListener('click', () => {
    reveal();
    revealBtn.blur();
  });
  againBtn?.addEventListener('click', () => {
    again();
    againBtn.blur();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sfx.suspend();
    else last = performance.now();
  });

  // ---- Debug handle for render checks --------------------------------------
  if (debug) {
    Object.assign(window, {
      __tv: {
        get layout() {
          return layout;
        },
        get devil() {
          return { ...d, phase };
        },
        get faults() {
          return faults.map((f) => ({ word: f.el.textContent, original: f.original, kind: f.kind, found: f.found }));
        },
        get stir() {
          return stir;
        },
        teleport(x: number, y: number) {
          d.x = x;
          d.y = y;
          d.vis = y;
          d.vy = 0;
          d.grounded = false;
        },
        toFault(i: number) {
          const f = faults[i];
          const w = f && wordByEl.get(f.el);
          if (!w) return false;
          d.x = (w.x0 + w.x1) / 2;
          d.y = w.y0 - 4;
          d.vis = d.y;
          d.vy = 0;
          d.grounded = false;
          follow = true;
          return true;
        },
        press: (a: Action) => {
          if (!keys[a]) press(a);
          keys[a] = true;
        },
        release: (a: Action) => {
          keys[a] = false;
          release(a);
        },
        reveal,
        again,
        relayout,
      },
    });
  }

  // ---- Start -----------------------------------------------------------
  wrapWords(leavesBox);
  const begin = () => {
    clearFontCache(leavesBox);
    relayout();
    impression();
    spawn();
    root.dataset.state = 'ready';
    last = performance.now();
    requestAnimationFrame(frame);
  };
  document.fonts.ready.then(begin, begin);
  document.fonts.addEventListener('loadingdone', scheduleRelayout);
  new ResizeObserver(scheduleRelayout).observe(leavesBox);
  window.addEventListener('resize', scheduleRelayout);
}
