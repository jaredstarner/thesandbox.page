// Marbling: the trough, the bench of tools, and the line the prints dry on.

import { Trough, type Blot, type Tines } from './_engine';
import { GALL, PAPER_HEX, PIGMENTS, pigmentIndex } from './_pigments';
import { COMB, RAKE, RECIPES, STYLUS, across, recipeById, seeded, type Step } from './_recipes';
import {
  drawSheen,
  drawTrough,
  noiseTile,
  paintBlots,
  paperTexture,
  printSvg,
  renderPrint,
  shrink,
  type Frame,
} from './_render';

type Tool = 'drop' | 'sprinkle' | 'stylus' | 'rake' | 'comb';

const TOOLS: Tool[] = ['drop', 'sprinkle', 'stylus', 'rake', 'comb'];
const BASE: Record<'stylus' | 'rake' | 'comb', Tines> = { stylus: STYLUS, rake: RAKE, comb: COMB };
const HINT: Record<Tool, string> = {
  drop: 'Touch the size to drop colour; hold to let it spread',
  sprinkle: 'Drag to flick a scatter of small drops',
  stylus: 'Draw the stylus through the colour',
  rake: 'Draw the rake across the trough; its pins span the whole width',
  comb: 'Draw the fine comb across the trough',
};
const OPENERS = ['nonpareil', 'bouquet', 'curl', 'chevron', 'peacock', 'hatip', 'gelgit'];
const UNDO_DEPTH = 40;
const MAX_PRINTS = 12;
/** A held drop spreads by this much area a second, in square trough units. */
const SPREAD = 2600;
const DROPS_PER_SECOND = 110;

interface Ripple {
  x: number;
  y: number;
  t0: number;
}

type Gesture =
  | { kind: 'drop'; blot: Blot; x: number; y: number; r: number; t0: number }
  | { kind: 'sprinkle'; x: number; y: number; acc: number }
  | {
      kind: 'stroke';
      base: Tines;
      bar: boolean;
      tines: Tines | null;
      sx: number;
      sy: number;
      lx: number;
      ly: number;
      axis: 'x' | 'y' | null;
      pending: number[];
      moved: boolean;
    };

interface Runner {
  name: string;
  steps: Step[];
  i: number;
  t0: number;
  acc: number;
  // Progress along the current stroke.
  done: number;
  total: number;
  seg: number;
  lx: number;
  ly: number;
}

interface Print {
  n: number;
  blots: Blot[];
  canvas: HTMLCanvasElement;
  name: string;
}

export function startMarbling(root: HTMLElement): void {
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel);
  const stage = $<HTMLElement>('[data-stage]');
  const canvas = $<HTMLCanvasElement>('[data-tray]');
  const ctx = canvas?.getContext('2d');
  const caption = $<HTMLElement>('[data-caption]');
  const potName = $<HTMLElement>('[data-potname]');
  const undoBtn = $<HTMLButtonElement>('[data-undo]');
  const skimBtn = $<HTMLButtonElement>('[data-skim]');
  const layBtn = $<HTMLButtonElement>('[data-lay]');
  const straightIn = $<HTMLInputElement>('[data-straight]');
  const printsEl = $<HTMLOListElement>('[data-prints]');
  const emptyEl = $<HTMLElement>('[data-empty]');
  const viewer = $<HTMLDialogElement>('[data-viewer]');
  const sheetEl = $<HTMLElement>('[data-sheet]');
  const viewTitle = $<HTMLElement>('[data-viewtitle]');
  if (!stage || !canvas || !ctx || !caption || !printsEl || !viewer || !sheetEl) return;

  const params = new URLSearchParams(location.search);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const phoneQuery = matchMedia('(max-width: 760px)');

  // The trough's shape is chosen once, from the room the page has.
  const avail = () => {
    const r = stage.getBoundingClientRect();
    const w = r.width;
    const h = phoneQuery.matches ? Math.min(innerHeight * 0.64, w * 1.6) : r.height;
    return { w, h };
  };
  const first = avail();
  const portrait = first.w / Math.max(1, first.h) < 1;
  const W = portrait ? 800 : 1200;
  const H = portrait ? 1200 : 800;
  const INSET = 14;
  const trough = new Trough(W, H);

  let tool: Tool = 'drop';
  let color = pigmentIndex('indigo');
  let gesture: Gesture | null = null;
  let runner: Runner | null = null;
  let ripples: Ripple[] = [];
  let undo: Blot[][] = [];
  let dirty = true;
  let pointer: { x: number; y: number } | null = null;
  let hintTimer = 0;
  let printing: { t0: number; blots: Blot[] } | null = null;
  let ghost: { t0: number } | null = null;
  let skim: { t0: number; blots: Blot[] } | null = null;
  let printCount = 0;
  const prints: Print[] = [];

  // Layout: device pixels, the trough's scale, and the layers drawn once per size.
  let dpr = 1;
  let rimCss = 18;
  let scaleCss = 1;
  let frame: Frame = { scale: 1, ox: 0, oy: 0 };
  let troughLayer: HTMLCanvasElement | null = null;
  let sheenLayer: HTMLCanvasElement | null = null;
  let paperLayer: HTMLCanvasElement | null = null;
  let grain: CanvasPattern | null = null;
  let lastW = 0;
  let lastH = 0;

  const layout = () => {
    const a = avail();
    if (Math.abs(a.w - lastW) < 1 && Math.abs(a.h - lastH) < 1 && troughLayer) return;
    lastW = a.w;
    lastH = a.h;
    rimCss = Math.round(Math.max(12, Math.min(24, a.w * 0.022)));
    scaleCss = Math.max(0.1, Math.min((a.w - rimCss * 2) / W, (a.h - rimCss * 2) / H));
    const cssW = W * scaleCss + rimCss * 2;
    const cssH = H * scaleCss + rimCss * 2;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    if (phoneQuery.matches) stage.style.height = `${cssH}px`;
    else stage.style.removeProperty('height');
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    frame = { scale: scaleCss * dpr, ox: rimCss * dpr, oy: rimCss * dpr };
    troughLayer = drawTrough(canvas.width, canvas.height, rimCss * dpr, dpr);
    sheenLayer = drawSheen(canvas.width, canvas.height, rimCss * dpr, dpr);
    paperLayer = paperTexture(
      Math.round((W - INSET * 2) * frame.scale),
      Math.round((H - INSET * 2) * frame.scale),
      frame.scale,
      5,
    );
    if (!grain) grain = ctx.createPattern(noiseTile(160, 11, 0.16), 'repeat');
    dirty = true;
  };

  // ---------- Drawing ----------

  const interior = () => ({
    x: frame.ox,
    y: frame.oy,
    w: W * frame.scale,
    h: H * frame.scale,
  });

  /** Clip to one side of the line x + y = c: the side toward the origin, or away from it. */
  const halfPlane = (c: number, big: number, near: boolean) => {
    ctx.beginPath();
    if (near) {
      ctx.moveTo(-big, -big);
      ctx.lineTo(c + big, -big);
      ctx.lineTo(-big, c + big);
    } else {
      ctx.moveTo(c + big, -big);
      ctx.lineTo(c + big * 2, c + big * 2);
      ctx.lineTo(-big, c + big);
    }
    ctx.closePath();
    ctx.clip();
  };

  const drawSheet = (now: number) => {
    if (!printing) return;
    const t = now - printing.t0;
    const s = frame.scale;
    const px = frame.ox + INSET * s;
    const py = frame.oy + INSET * s;
    const pw = (W - INSET * 2) * s;
    const ph = (H - INSET * 2) * s;
    const fadeIn = Math.min(1, t / 220);
    const lay = reduced ? 1 : Math.max(0, Math.min(1, (t - 220) / 900));
    const soak = Math.max(0, Math.min(1, (t - 1120) / 420));
    // Contact runs from the near corner across the sheet on the diagonal.
    const reach = px + py + lay * (pw + ph) * 1.02;
    const big = (pw + ph) * 4;
    ctx.save();
    ctx.globalAlpha = fadeIn;
    // The part still held above the size, casting a shadow.
    ctx.save();
    halfPlane(reach, big, false);
    ctx.clip();
    ctx.shadowColor = 'rgba(40, 30, 20, 0.28)';
    ctx.shadowBlur = 22 * dpr;
    ctx.shadowOffsetX = 10 * dpr;
    ctx.shadowOffsetY = 14 * dpr;
    ctx.fillStyle = PAPER_HEX;
    ctx.fillRect(px, py, pw, ph);
    ctx.shadowColor = 'transparent';
    if (paperLayer) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(paperLayer, px, py, pw, ph);
      ctx.globalCompositeOperation = 'source-over';
    }
    // The sheet bends down toward the line of contact; shade the bend.
    const nx = 1 / Math.SQRT2;
    const bx = reach / 2;
    const g = ctx.createLinearGradient(bx, bx, bx + nx * 60 * dpr, bx + nx * 60 * dpr);
    g.addColorStop(0, `rgba(60, 45, 30, ${0.22 * (1 - soak)})`);
    g.addColorStop(1, 'rgba(60, 45, 30, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, pw, ph);
    ctx.restore();
    // The part lying on the size: wet through, so the colour shows from behind.
    if (lay > 0) {
      ctx.save();
      halfPlane(reach, big, true);
      ctx.clip();
      ctx.beginPath();
      ctx.rect(px, py, pw, ph);
      ctx.clip();
      ctx.globalAlpha = fadeIn * (0.66 - soak * 0.14);
      ctx.fillStyle = PAPER_HEX;
      ctx.fillRect(px, py, pw, ph);
      if (paperLayer) {
        ctx.globalAlpha = fadeIn * 0.8;
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(paperLayer, px, py, pw, ph);
      }
      ctx.restore();
    }
    ctx.restore();
  };

  const draw = (now: number) => {
    if (!troughLayer || !sheenLayer) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(troughLayer, 0, 0);
    const box = interior();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, 7 * dpr);
    ctx.clip();

    if (skim) {
      // A strip of newsprint drawn along the size lifts the colour with it.
      const p = reduced ? 1 : Math.min(1, (now - skim.t0) / 650);
      const edge = box.x - 40 * dpr + p * (box.w + 80 * dpr);
      ctx.save();
      ctx.beginPath();
      ctx.rect(edge, box.y, box.w + 80 * dpr, box.h);
      ctx.clip();
      paintBlots(ctx, skim.blots, frame, { rimPx: dpr * 0.9 });
      ctx.restore();
      ctx.fillStyle = 'rgba(70, 60, 50, 0.18)';
      ctx.fillRect(edge - 14 * dpr, box.y, 14 * dpr, box.h);
      ctx.fillStyle = '#e9e5da';
      ctx.fillRect(edge - 10 * dpr, box.y, 10 * dpr, box.h);
    } else {
      if (ghost) {
        const a = reduced ? 0 : Math.max(0, 0.16 * (1 - (now - ghost.t0) / 1400));
        ctx.globalAlpha = a;
      }
      if (ctx.globalAlpha > 0) paintBlots(ctx, trough.blots, frame, { rimPx: dpr * 0.9 });
      ctx.globalAlpha = 1;
    }

    if (grain) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = grain;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Rings where colour touched the surface.
    ctx.setTransform(frame.scale, 0, 0, frame.scale, frame.ox, frame.oy);
    for (const r of ripples) {
      const t = (now - r.t0) / 700;
      if (t < 0 || t > 1) continue;
      const rad = 10 + t * 46;
      ctx.lineWidth = (1.4 * dpr) / frame.scale;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.32 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(40, 40, 40, ${0.1 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sheenLayer, 0, 0);
    drawSheet(now);
    ctx.restore();

    drawTool();
  };

  /** Where the pins are: the stylus point, or every tine of a rake or comb across the trough. */
  const drawTool = () => {
    if (!pointer || printing || skim) return;
    const s = frame.scale;
    ctx.save();
    ctx.setTransform(s, 0, 0, s, frame.ox, frame.oy);
    const px = pointer.x;
    const py = pointer.y;
    const line = 1 / s;
    if (tool === 'drop' || tool === 'sprinkle') {
      const r = gesture?.kind === 'drop' ? gesture.r : tool === 'drop' ? 12 : 26;
      ctx.lineWidth = line * 1.2 * dpr;
      ctx.setLineDash(tool === 'sprinkle' ? [3 * dpr * line, 4 * dpr * line] : []);
      ctx.strokeStyle = 'rgba(30, 30, 30, 0.35)';
      ctx.beginPath();
      ctx.arc(
        gesture?.kind === 'drop' ? gesture.x : px,
        gesture?.kind === 'drop' ? gesture.y : py,
        r + 2,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    } else {
      let t: Tines | null = null;
      if (gesture?.kind === 'stroke') t = gesture.tines;
      if (!t && tool !== 'stylus') {
        // Before a stroke starts, show the bar as it will sit for the likelier direction.
        t = across(BASE[tool], W >= H ? 1 : 0, W >= H ? 0 : 1);
      }
      ctx.fillStyle = 'rgba(30, 30, 30, 0.5)';
      const pin = (x: number, y: number) => {
        ctx.beginPath();
        ctx.arc(x, y, 2.2 * dpr * line, 0, Math.PI * 2);
        ctx.fill();
      };
      if (!t || t.spacing === 0) {
        pin(px, py);
      } else {
        const n = Math.ceil(Math.max(W, H) / t.spacing) + 1;
        ctx.globalAlpha = 0.75;
        for (let k = -n; k <= n; k++) {
          const x = px + k * t.spacing * t.nx;
          const y = py + k * t.spacing * t.ny;
          if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
          pin(x, y);
        }
      }
    }
    ctx.restore();
  };

  // ---------- State ----------

  const say = (text: string, hold = 0) => {
    caption.textContent = text;
    clearTimeout(hintTimer);
    if (hold > 0) hintTimer = window.setTimeout(() => (caption.textContent = HINT[tool]), hold);
  };

  const pushUndo = () => {
    undo.push(trough.snapshot());
    if (undo.length > UNDO_DEPTH) undo.shift();
    if (undoBtn) undoBtn.disabled = false;
  };

  const doUndo = () => {
    if (printing || skim) return;
    stopRecipe();
    const s = undo.pop();
    if (!s) return;
    trough.restore(s);
    ghost = null;
    if (undoBtn) undoBtn.disabled = undo.length === 0;
    dirty = true;
  };

  const ripple = (x: number, y: number, now: number) => {
    if (reduced) return;
    ripples.push({ x, y, t0: now });
    if (ripples.length > 40) ripples.shift();
  };

  const clearGhost = () => {
    if (ghost) {
      ghost = null;
      trough.clear();
    }
  };

  // ---------- Patterns ----------

  const exec = (step: Step, now: number, animate: boolean) => {
    if (step.kind === 'caption') caption.textContent = step.text;
    else if (step.kind === 'drop') {
      trough.drop(step.x, step.y, step.r, step.color);
      if (animate && Math.random() < 0.35) ripple(step.x, step.y, now);
    } else if (step.kind === 'stroke') {
      const p = step.path;
      for (let i = 2; i < p.length; i += 2) trough.stroke(step.tines, p[i - 2], p[i - 1], p[i], p[i + 1]);
    }
  };

  const stopRecipe = () => {
    if (!runner) return;
    runner = null;
    delete root.dataset.busy;
    say(HINT[tool], 0);
  };

  const startRecipe = (id: string, seed: number, instant: boolean) => {
    const recipe = recipeById(id);
    if (!recipe || printing) return;
    stopRecipe();
    clearGhost();
    skim = null;
    if (trough.blots.length) pushUndo();
    trough.clear();
    const steps = recipe.build(seeded(seed), W, H);
    const now = performance.now();
    if (instant) {
      for (const s of steps) exec(s, now, false);
      say(`${recipe.name}, finished. Work into it, or lay paper`, 4000);
      dirty = true;
      return;
    }
    runner = { name: recipe.name, steps, i: 0, t0: now, acc: 0, done: 0, total: 0, seg: 2, lx: NaN, ly: NaN };
    root.dataset.busy = 'pattern';
  };

  const tickRunner = (now: number, dt: number) => {
    const r = runner;
    if (!r) return;
    r.acc += dt * DROPS_PER_SECOND;
    let budget = 40;
    while (r.i < r.steps.length && budget-- > 0) {
      const step = r.steps[r.i];
      if (step.kind === 'caption') {
        exec(step, now, true);
        r.i++;
        r.t0 = now;
      } else if (step.kind === 'pause') {
        if (now - r.t0 < step.ms) return;
        r.i++;
        r.t0 = now;
      } else if (step.kind === 'drop') {
        if (r.acc < 1) return;
        r.acc -= 1;
        exec(step, now, true);
        dirty = true;
        r.i++;
        r.t0 = now;
      } else {
        // Walk the stroke's path as far as its share of the time allows.
        const p = step.path;
        if (Number.isNaN(r.lx)) {
          r.lx = p[0];
          r.ly = p[1];
          r.seg = 2;
          r.done = 0;
          r.t0 = now;
          r.total = 0;
          for (let i = 2; i < p.length; i += 2) r.total += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
        }
        // The stroke moves at its own pace, but never takes more than a frame's worth of work at once,
        // so a slow frame can't snowball into a slower one.
        const want = Math.min(r.total, r.done + (r.total / step.ms) * Math.min(dt, 1 / 30) * 1000);
        const deadline = performance.now() + 14;
        while (r.done < want - 1e-6 && r.seg < p.length && performance.now() < deadline) {
          const tx = p[r.seg];
          const ty = p[r.seg + 1];
          const d = Math.hypot(tx - r.lx, ty - r.ly);
          const take = Math.min(d, want - r.done);
          if (take >= d - 1e-9) {
            trough.stroke(step.tines, r.lx, r.ly, tx, ty);
            r.lx = tx;
            r.ly = ty;
            r.seg += 2;
            r.done += d;
          } else {
            const nx = r.lx + ((tx - r.lx) * take) / d;
            const ny = r.ly + ((ty - r.ly) * take) / d;
            trough.stroke(step.tines, r.lx, r.ly, nx, ny);
            r.lx = nx;
            r.ly = ny;
            r.done += take;
          }
        }
        dirty = true;
        if (r.seg >= p.length || r.done >= r.total - 1e-6) {
          r.i++;
          r.lx = NaN;
          r.t0 = now;
        } else return;
      }
    }
    if (r.i >= r.steps.length) {
      runner = null;
      delete root.dataset.busy;
      say(`${r.name}, finished. Work into it, or lay paper`, 5000);
    }
  };

  // ---------- Gestures ----------

  const toTrough = (e: PointerEvent | MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left - rimCss) / scaleCss, y: (e.clientY - rect.top - rimCss) / scaleCss };
  };

  const emitSprinkle = (g: { x: number; y: number }, now: number) => {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * 34;
    const x = g.x + Math.cos(a) * d;
    const y = g.y + Math.sin(a) * d;
    trough.drop(x, y, 4 + Math.random() * 8, color);
    if (Math.random() < 0.3) ripple(x, y, now);
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || printing || skim) return;
    stopRecipe();
    clearGhost();
    const p = toTrough(e);
    pointer = p;
    const now = performance.now();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; the gesture still works.
    }
    pushUndo();
    if (tool === 'drop') {
      const r = 12;
      const blot = trough.drop(p.x, p.y, r, color);
      gesture = { kind: 'drop', blot, x: p.x, y: p.y, r, t0: now };
      ripple(p.x, p.y, now);
    } else if (tool === 'sprinkle') {
      gesture = { kind: 'sprinkle', x: p.x, y: p.y, acc: 0 };
      emitSprinkle(p, now);
    } else {
      gesture = {
        kind: 'stroke',
        base: BASE[tool],
        bar: tool !== 'stylus',
        tines: null,
        sx: p.x,
        sy: p.y,
        lx: p.x,
        ly: p.y,
        axis: null,
        pending: [],
        moved: false,
      };
    }
    dirty = true;
  });

  canvas.addEventListener('pointermove', (e) => {
    pointer = toTrough(e);
    dirty = true;
    const g = gesture;
    if (!g) return;
    if (g.kind === 'sprinkle') {
      g.x = pointer.x;
      g.y = pointer.y;
      return;
    }
    if (g.kind !== 'stroke') return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      let { x, y } = toTrough(ev);
      if (!g.tines) {
        const dx = x - g.sx;
        const dy = y - g.sy;
        if (Math.hypot(dx, dy) < 4) continue;
        const straight = g.bar && (straightIn?.checked ?? true);
        if (straight) {
          g.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
          g.tines = g.axis === 'x' ? across(g.base, 1, 0) : across(g.base, 0, 1);
        } else {
          g.tines = across(g.base, dx, dy);
        }
      }
      if (g.axis === 'x') y = g.sy;
      else if (g.axis === 'y') x = g.sx;
      g.pending.push(x, y);
    }
  });

  const endGesture = () => {
    const g = gesture;
    gesture = null;
    if (g?.kind === 'stroke') {
      flushStroke(g);
      // A press that never moved leaves nothing to undo.
      if (!g.moved) undo.pop();
      if (undoBtn) undoBtn.disabled = undo.length === 0;
    }
    dirty = true;
  };
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', endGesture);
  canvas.addEventListener('pointerleave', () => {
    if (!gesture) {
      pointer = null;
      dirty = true;
    }
  });

  const flushStroke = (g: Extract<Gesture, { kind: 'stroke' }>) => {
    if (!g.tines) return;
    const p = g.pending;
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i];
      const y = p[i + 1];
      // Points closer than this are folded into the next one: each step costs a pass over every outline.
      if (Math.hypot(x - g.lx, y - g.ly) < (i < p.length - 2 ? 5 : 0.5)) continue;
      trough.stroke(g.tines, g.lx, g.ly, x, y);
      g.lx = x;
      g.ly = y;
      g.moved = true;
    }
    g.pending = [];
    dirty = true;
  };

  // ---------- Paper ----------

  const finishPrint = (now: number) => {
    if (!printing) return;
    const blots = printing.blots;
    printCount++;
    const n = printCount;
    const k = Math.min(2, 2400 / Math.max(W, H));
    const full = renderPrint(blots, W, H, INSET, k);
    const name = runnerName || 'Marbled sheet';
    const print: Print = { n, blots, canvas: full, name };
    prints.unshift(print);

    // Its place on the line.
    const li = document.createElement('li');
    li.dataset.landing = '';
    li.style.setProperty('--tilt', `${(((n * 37) % 7) - 3) * 0.7}deg`);
    li.style.setProperty('--sag', `${Math.round(Math.sin(n * 1.7) * 3)}px`);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Print ${n}: ${name}`);
    const thumbH = 104;
    const tw = Math.round(thumbH * ((W - INSET * 2) / (H - INSET * 2)));
    const thumb = shrink(full, tw * 2, thumbH * 2);
    btn.append(thumb);
    const peg = document.createElement('span');
    peg.className = 'peg';
    peg.setAttribute('aria-hidden', 'true');
    li.append(peg, btn);
    btn.addEventListener('click', () => openPrint(print));
    printsEl.prepend(li);
    while (printsEl.children.length > MAX_PRINTS) printsEl.lastElementChild?.remove();
    while (prints.length > MAX_PRINTS) prints.pop();
    if (emptyEl) emptyEl.hidden = true;

    // The sheet itself: lifted off the trough, turned face up, and carried to the line.
    const box = canvas.getBoundingClientRect();
    const from = {
      x: box.left + rimCss + INSET * scaleCss,
      y: box.top + rimCss + INSET * scaleCss,
      w: (W - INSET * 2) * scaleCss,
      h: (H - INSET * 2) * scaleCss,
    };
    const land = () => {
      delete li.dataset.landing;
    };
    const to = thumb.getBoundingClientRect();
    const onScreen = to.bottom > 0 && to.top < innerHeight;
    if (reduced || !onScreen) {
      land();
    } else {
      const flight = document.createElement('div');
      flight.className = 'flight';
      flight.style.left = `${to.left}px`;
      flight.style.top = `${to.top}px`;
      flight.style.width = `${to.width}px`;
      flight.style.height = `${to.height}px`;
      const card = document.createElement('div');
      card.className = 'card';
      const back = document.createElement('canvas');
      back.width = Math.round(from.w);
      back.height = Math.round(from.h);
      const bg = back.getContext('2d');
      if (bg) {
        // From above, the back of a wet sheet with the colour showing through.
        bg.fillStyle = PAPER_HEX;
        bg.fillRect(0, 0, back.width, back.height);
        bg.globalAlpha = 0.4;
        const sx = back.width / (W - INSET * 2);
        paintBlots(bg, blots, { scale: sx, ox: -INSET * sx, oy: -INSET * sx });
        bg.globalAlpha = 1;
        bg.fillStyle = 'rgba(241, 234, 219, 0.25)';
        bg.fillRect(0, 0, back.width, back.height);
      }
      const front = shrink(full, back.width, back.height);
      front.className = 'front';
      card.append(back, front);
      flight.append(card);
      root.append(flight);
      const dx = from.x - to.left;
      const dy = from.y - to.top;
      const sx = from.w / to.width;
      const sy = from.h / to.height;
      const anim = flight.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, transformOrigin: '0 0' },
          {
            transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 60}px) scale(${sx * 0.7}, ${sy * 0.7})`,
            transformOrigin: '0 0',
            offset: 0.45,
          },
          { transform: 'translate(0, 0) scale(1, 1)', transformOrigin: '0 0' },
        ],
        { duration: 1100, easing: 'cubic-bezier(.45,.05,.3,1)' },
      );
      card.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }], {
        duration: 900,
        delay: 150,
        easing: 'cubic-bezier(.5,0,.3,1)',
        fill: 'both',
      });
      anim.finished
        .catch(() => undefined)
        .then(() => {
          land();
          flight.remove();
        });
    }

    printing = null;
    ghost = { t0: now };
    delete root.dataset.busy;
    say(`Print ${n} is on the line${onScreen ? '' : ' below'}. The size keeps a faint ghost of it`, 4200);
    dirty = true;
  };

  let runnerName = '';

  const layPaper = () => {
    if (printing || skim) return;
    if (runner) {
      runnerName = runner.name;
      stopRecipe();
    }
    clearGhost();
    if (!trough.blots.length) {
      say('Float some colour first', 2400);
      return;
    }
    gesture = null;
    pushUndo();
    printing = { t0: performance.now(), blots: trough.snapshot() };
    root.dataset.busy = 'print';
    say('Laying the sheet from one corner, so no air is trapped');
    dirty = true;
  };

  const startSkim = () => {
    if (printing || skim) return;
    stopRecipe();
    if (ghost) {
      clearGhost();
      dirty = true;
      return;
    }
    if (!trough.blots.length) return;
    pushUndo();
    skim = { t0: performance.now(), blots: trough.snapshot() };
    trough.clear();
    runnerName = '';
    dirty = true;
  };

  const openPrint = (p: Print) => {
    sheetEl.replaceChildren(p.canvas);
    if (viewTitle) viewTitle.textContent = `Print ${p.n}: ${p.name}`;
    viewer.dataset.n = String(p.n);
    viewer.showModal();
  };

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const current = () => prints.find((p) => String(p.n) === viewer.dataset.n);
  $<HTMLButtonElement>('[data-png]')?.addEventListener('click', () => {
    const p = current();
    p?.canvas.toBlob((b) => b && download(b, `marbling-${String(p.n).padStart(2, '0')}.png`), 'image/png');
  });
  $<HTMLButtonElement>('[data-svg]')?.addEventListener('click', () => {
    const p = current();
    if (p)
      download(
        new Blob([printSvg(p.blots, W, H, INSET)], { type: 'image/svg+xml' }),
        `marbling-${String(p.n).padStart(2, '0')}.svg`,
      );
  });
  $<HTMLButtonElement>('[data-close]')?.addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', (e) => {
    if (e.target === viewer) viewer.close();
  });

  // ---------- Bench ----------

  const setTool = (t: Tool) => {
    tool = t;
    const input = root.querySelector<HTMLInputElement>(`input[name="mb-tool"][value="${t}"]`);
    if (input) input.checked = true;
    if (!runner && !printing) say(HINT[t]);
    dirty = true;
  };

  root
    .querySelectorAll<HTMLInputElement>('input[name="mb-tool"]')
    .forEach((input) => input.addEventListener('change', () => setTool(input.value as Tool)));
  root.querySelectorAll<HTMLInputElement>('input[name="mb-pot"]').forEach((input) =>
    input.addEventListener('change', () => {
      color = pigmentIndex(input.value);
      if (potName) potName.textContent = color === GALL ? 'Gall water, clear' : PIGMENTS[color].name;
      // Picking up a colour means dropping it.
      if (tool !== 'drop' && tool !== 'sprinkle') setTool('drop');
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-recipe]').forEach((b) =>
    b.addEventListener('click', () => {
      runnerName = recipeById(b.dataset.recipe ?? '')?.name ?? '';
      startRecipe(b.dataset.recipe ?? '', (Math.random() * 2 ** 31) | 0, reduced);
    }),
  );
  undoBtn?.addEventListener('click', doUndo);
  skimBtn?.addEventListener('click', startSkim);
  layBtn?.addEventListener('click', layPaper);

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
    if (viewer.open || e.altKey) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      doUndo();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= TOOLS.length) setTool(TOOLS[n - 1]);
    else if (k === 'z') doUndo();
    else if (k === 'p') layPaper();
    else if (k === 'escape') stopRecipe();
  });

  // ---------- Loop ----------

  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const g = gesture;
    if (g?.kind === 'drop') {
      const r = Math.min(150, Math.sqrt(144 + SPREAD * ((now - g.t0) / 1000)));
      if (r > g.r + 0.05) {
        trough.grow(g.blot, g.x, g.y, g.r, r);
        g.r = r;
        dirty = true;
      }
    } else if (g?.kind === 'sprinkle') {
      g.acc += dt * 26;
      while (g.acc >= 1) {
        g.acc -= 1;
        emitSprinkle(g, now);
        dirty = true;
      }
    } else if (g?.kind === 'stroke' && g.pending.length) {
      flushStroke(g);
    }
    if (runner) tickRunner(now, dt);
    if (printing) {
      dirty = true;
      if (now - printing.t0 > (reduced ? 200 : 1600)) finishPrint(now);
    }
    if (ghost) {
      dirty = true;
      if (now - ghost.t0 > 1400) {
        ghost = null;
        trough.clear();
      }
    }
    if (skim) {
      dirty = true;
      if (reduced || now - skim.t0 > 650) {
        skim = null;
        say('Skimmed clean', 1800);
      }
    }
    if (ripples.length) {
      ripples = ripples.filter((r) => now - r.t0 < 700);
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      draw(now);
    }
    requestAnimationFrame(tick);
  };

  layout();
  new ResizeObserver(() => layout()).observe(stage);
  addEventListener('resize', layout);

  // Open on a pattern being made, so the trough is never empty for long.
  const ask = params.get('pattern');
  const opener = ask && recipeById(ask) ? ask : OPENERS[Math.floor(Math.random() * OPENERS.length)];
  const seed = Number(params.get('seed')) || (Math.random() * 2 ** 31) | 0;
  runnerName = recipeById(opener)?.name ?? '';
  startRecipe(opener, seed, reduced || params.has('still'));
  undo = [];
  if (undoBtn) undoBtn.disabled = true;

  if (params.has('debug')) {
    (window as unknown as { marbling: unknown }).marbling = {
      trough,
      recipes: RECIPES.map((r) => r.id),
      busy: () => ({ runner: !!runner, printing: !!printing, skim: !!skim, ghost: !!ghost }),
      prints: () => prints.length,
      layPaper,
      startRecipe,
      setTool,
      timeDraw: () => {
        const a = performance.now();
        draw(performance.now());
        return performance.now() - a;
      },
    };
  }
  requestAnimationFrame(tick);
}
