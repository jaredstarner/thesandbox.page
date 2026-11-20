import {
  type Arm,
  type Node,
  type PaintKey,
  type Plate,
  type Pt,
  type ShapeKey,
  MAX_ARM,
  MIN_ARM,
  PAINTS,
  PAINT_KEYS,
  SHAPE_KEYS,
  SHAPE_NAMES,
  arms,
  balancePoint,
  decodeMobile,
  encodeMobile,
  mass,
  plateGeom,
  plates,
  presetByKey,
  balanceAll,
} from './_model';
import { Mobile, type ArmState, type Env, type PlateState, type V3 } from './_sim';
import { Renderer, project, type Camera, type Room } from './_render';
import { Clink } from './_sound';

const DT = 1 / 120;
const AIR = [0.07, 0.26, 0.62];

type Sel = { kind: 'plate'; plate: Plate } | { kind: 'arm'; arm: Arm } | null;

type Drag =
  | { kind: 'push'; ps: PlateState; x: number; y: number; t: number; vx: number; moved: boolean; id: number }
  | { kind: 'wire'; s: ArmState; x: number; y: number; t: number; vx: number; moved: boolean; id: number }
  | { kind: 'hook'; s: ArmState; id: number }
  | { kind: 'empty'; x: number; y: number; t0: number; moved: boolean; id: number };

interface Tween {
  arm: Arm;
  from: number;
  to: number;
  t: number;
  dur: number;
}

export function start(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('.wt-room')!;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const renderer = new Renderer(canvas, ctx);
  const clink = new Clink();
  const $ = <T extends Element>(q: string) => root.querySelector<T>(q)!;
  const $$ = <T extends Element>(q: string) => Array.from(root.querySelectorAll<T>(q));

  const titleInput = $<HTMLInputElement>('.wt-title input');
  const labelEl = $<HTMLElement>('.wt-label');
  const mediumEl = $<HTMLElement>('.wt-medium');
  const dimsEl = $<HTMLElement>('.wt-dims');
  const hint = $<HTMLElement>('.wt-hint');
  const presetSelect = $<HTMLSelectElement>('.wt-presets select');
  const bench = $<HTMLElement>('.wt-bench');
  const benchTitle = $<HTMLElement>('#wt-bench-title');
  const benchNote = $<HTMLElement>('.wt-bench-note');
  const forPlate = $<HTMLElement>('.wt-for-plate');
  const forArm = $<HTMLElement>('.wt-for-arm');
  const above = $<HTMLElement>('.wt-above');
  const blowBtn = $<HTMLButtonElement>('.wt-blow');
  const shareBtn = $<HTMLButtonElement>('.wt-share');
  const soundBtn = $<HTMLButtonElement>('.wt-sound');

  // The mobile.
  let tree: Arm = presetByKey('cascade').build();
  balanceAll(tree);
  let mobile = new Mobile(tree);
  let sel: Sel = null;
  let tweens: Tween[] = [];
  settle();

  // The room.
  const cam: Camera = { W: 1, H: 1, dpr: 1, f: 900, camX: 0.25, camY: 1.55, camZ: 4.2, k0: 0, cx: 0, cy: 0 };
  const room: Room = { wallZ: -1, light: [-1.15, 3.2, 3.6], lightRadius: 0.035 };
  const target = { f: 900, k0: 0, cx: 0, wallZ: -1 };
  let framed = false;

  // Air.
  let air = 0;
  let airLevel = AIR[0]!;
  const modes = (() => {
    let seed = 5;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    return Array.from({ length: 6 }, () => ({
      kx: (rnd() - 0.5) * 9,
      ky: (rnd() - 0.5) * 7,
      kz: (rnd() - 0.5) * 9,
      w: 0.15 + rnd() * 0.5,
      ph: rnd() * Math.PI * 2,
      beta: rnd() * Math.PI * 2,
      a: 0.35 + rnd() * 0.45,
    }));
  })();
  const blow = { level: 0, want: 0, x: 0, y: 0, wide: true };

  function wind(p: V3, t: number): V3 {
    const s = airLevel;
    const psi = 2.4 + 0.9 * Math.sin(t * 0.023) + 0.5 * Math.sin(t * 0.051 + 1.7);
    let gust = 0.65 + 0.22 * Math.sin(t * 0.11 + 0.3) + 0.13 * Math.sin(t * 0.37 + 2.0);
    if (air === 2) gust += 0.7 * Math.max(0, Math.sin(t * 0.21)) ** 6;
    let tx = Math.cos(psi);
    let tz = Math.sin(psi);
    for (const m of modes) {
      const v = Math.sin(m.kx * p[0] + m.ky * p[1] + m.kz * p[2] - m.w * t + m.ph);
      tx += m.a * Math.cos(m.beta) * v;
      tz += m.a * Math.sin(m.beta) * v;
    }
    let wx = s * gust * tx;
    let wz = s * gust * tz;
    if (blow.level > 0.002) {
      const pr = project(cam, p);
      const rpx = ((blow.wide ? 0.7 : 0.3) * cam.f) / pr[2];
      const d = Math.hypot(pr[0] - blow.x, pr[1] - blow.y) / rpx;
      const g = Math.exp(-d * d) * blow.level * 1.7;
      const dx = p[0] - cam.camX;
      const dy = p[1] - cam.camY;
      const dz = p[2] - cam.camZ;
      const l = Math.hypot(dx, dy, dz) || 1;
      // Breath carries a little turbulence of its own.
      const flutter = 1 + 0.35 * Math.sin(t * 9.1 + p[0] * 13) * Math.sin(t * 5.3 + p[1] * 11);
      wx += (dx / l) * g * flutter;
      wz += (dz / l) * g * flutter;
    }
    return [wx, 0, wz];
  }

  const env: Env = { wind, steady: 0, face: null };

  /** Run the mobile quietly for a few seconds so it opens already hanging, not still rocking. */
  function settle(): void {
    const quiet: Env = { wind: () => [0, 0, 0], steady: 0.6, face: null };
    for (let i = 0; i < 600; i++) mobile.step(DT, quiet);
  }

  function rebuild(): void {
    mobile = new Mobile(tree, mobile);
    updateLabel();
  }

  // Selection helpers.
  const selPlateState = () => {
    const cur = sel;
    return cur?.kind === 'plate' ? mobile.platesList.find((p) => p.plate === cur.plate) : undefined;
  };
  const selArmState = () => {
    const cur = sel;
    return cur?.kind === 'arm' ? mobile.armsList.find((s) => s.arm === cur.arm) : undefined;
  };

  function parentOf(n: Node, at: Node = tree): { arm: Arm; side: 0 | 1 } | null {
    if (at.kind === 'plate') return null;
    for (const side of [0, 1] as const) {
      if (at.ends[side] === n) return { arm: at, side };
      const r = parentOf(n, at.ends[side]);
      if (r) return r;
    }
    return null;
  }

  // Camera framing.
  function frameTargets(): void {
    const W = cam.W;
    const H = cam.H;
    const phone = W < 720;
    const r = mobile.reachCache;
    const R = Math.max(0.28, r.typical * 1.15);
    const benchW = sel && !phone ? 344 : 0;
    const benchH = sel && phone ? H * 0.5 : 0;
    const topPad = phone ? 112 : 70;
    const botPad = phone ? (sel ? 16 : 126) : 92;
    const availW = W - benchW;
    const availH = Math.max(160, H - topPad - botPad - benchH);
    const spanX = 2 * R + (phone ? 0.3 : 0.6);
    const spanY = r.top + 0.1 - (r.bottom - 0.12);
    const fH = (0.94 * availW * cam.camZ) / spanX;
    const fV = (0.92 * availH * cam.camZ) / spanY;
    target.f = Math.min(fH, fV);
    target.cx = availW / 2;
    const yC = (r.top + 0.1 + r.bottom - 0.12) / 2;
    const screenY = topPad + availH / 2;
    target.k0 = (yC - cam.camY) / cam.camZ + (screenY - H / 2) / target.f;
    target.wallZ = -Math.max(0.85, r.radius * 0.8 + 0.25);
    if (!framed) {
      cam.f = target.f;
      cam.k0 = target.k0;
      cam.cx = target.cx;
      room.wallZ = target.wallZ;
      framed = true;
    }
  }

  function resize(): void {
    const W = root.clientWidth || window.innerWidth;
    const H = root.clientHeight || window.innerHeight;
    cam.W = W;
    cam.H = H;
    cam.cy = H / 2;
    cam.dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.resize(cam);
  }

  // Wall label.
  function updateLabel(): void {
    const ps = [...plates(tree)];
    const grams = Math.round(mass(tree) * 1000);
    const r = mobile.reachCache;
    const h = Math.round((r.top - r.bottom) * 100);
    const w = Math.round(r.typical * 2 * 100);
    dimsEl.textContent = `${h} × ${w} cm · ${ps.length} plates · ${grams} g`;
    const used = new Set(ps.map((p) => p.paint));
    const parts: string[] = [];
    const painted = ps.some((p) => !PAINTS[p.paint].metal);
    if (painted) parts.push('Painted aluminium');
    if (used.has('aluminium')) parts.push(painted ? 'bare aluminium' : 'Aluminium');
    if (used.has('copper')) parts.push(parts.length ? 'copper' : 'Copper');
    if (used.has('brass')) parts.push(parts.length ? 'brass' : 'Brass');
    parts.push('steel wire');
    mediumEl.textContent =
      parts.length > 2 ? `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}` : parts.join(' and ');
  }

  function placeLabel(): void {
    const phone = cam.W < 720;
    if (phone) {
      labelEl.style.transform = sel ? 'translate(-9999px, 0)' : 'none';
      labelEl.style.top = 'auto';
      labelEl.style.bottom = '138px';
      labelEl.style.left = '16px';
      return;
    }
    labelEl.style.bottom = 'auto';
    // On the wall to the left of the work, level with its lowest plates.
    const r = mobile.reachCache;
    const p = project(cam, [-(r.typical * 1.1 + 0.1), r.bottom + 0.08, room.wallZ]);
    const scale = Math.min(1.2, Math.max(1, ((cam.f / (cam.camZ - room.wallZ)) * 0.011) / 13));
    const wpx = labelEl.offsetWidth * scale;
    const hpx = labelEl.offsetHeight * scale;
    let x = p[0] - wpx;
    x = Math.max(clampLeft(), x);
    const y = Math.max(cam.H * 0.3, Math.min(cam.H - 110 - hpx, p[1]));
    labelEl.style.left = '0px';
    labelEl.style.top = '0px';
    labelEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`;
  }

  /** The label never runs off the wall or under the header. */
  function clampLeft(): number {
    return Math.max(16, Math.min(44, cam.W * 0.03));
  }

  // Bench.
  function openBench(next: Sel): void {
    sel = next;
    if (!sel) {
      bench.hidden = true;
      env.face = null;
      return;
    }
    bench.hidden = false;
    syncBench();
    hideHint();
  }

  function syncBench(): void {
    if (!sel) return;
    const isPlate = sel.kind === 'plate';
    forPlate.hidden = !isPlate;
    forArm.hidden = isPlate;
    if (sel.kind === 'plate') {
      const p = sel.plate;
      const g = plateGeom(p);
      benchTitle.textContent = typeof p.shape === 'string' ? SHAPE_NAMES[p.shape] : 'Your own cut';
      benchNote.textContent = `${PAINTS[p.paint].name} · ${Math.round(g.mass * 1000)} g`;
      for (const b of $$<HTMLButtonElement>('[data-shape]')) b.setAttribute('aria-pressed', String(b.dataset.shape === p.shape));
      for (const b of $$<HTMLButtonElement>('[data-paint]')) b.setAttribute('aria-pressed', String(b.dataset.paint === p.paint));
      setRange('size', p.size * 100, `${(p.size * 100).toFixed(1)} cm`);
      setRange('roll', p.roll, Math.abs(p.roll) < 3 ? 'upright' : Math.abs(p.roll) > 85 ? 'flat' : `${Math.round(p.roll)}°`);
      const par = parentOf(p);
      const removable = !!par && (par.arm !== tree || par.arm.ends[1 - par.side]!.kind === 'arm');
      $<HTMLButtonElement>('[data-act="remove-plate"]').disabled = !removable;
    } else {
      const a = sel.arm;
      const isTop = a === tree;
      benchTitle.textContent = isTop ? 'Top arm' : 'Arm';
      benchNote.textContent = `${(a.len * 100).toFixed(0)} cm of wire · carries ${Math.round(mass(a) * 1000)} g`;
      setRange('hook', a.hook * 100, `${(a.hook * a.len * 100).toFixed(1)} cm from the left`);
      setRange('len', a.len * 100, `${(a.len * 100).toFixed(1)} cm`);
      setRange('sag', a.sag * 100, `${(a.sag * a.len * 100).toFixed(1)} cm rise`);
      setRange('drop', a.drop * 100, `${(a.drop * 100).toFixed(1)} cm`);
      $<HTMLElement>('.wt-drop-name').textContent = isTop ? 'Thread from the ceiling' : 'Hangs by';
      $<HTMLButtonElement>('[data-act="remove-arm"]').disabled = isTop;
      $<HTMLButtonElement>('[data-act="level"]').disabled = Math.abs(balancePoint(a) - a.hook) < 0.002;
    }
    // Does the arm above still hang level?
    const node: Node = sel.kind === 'plate' ? sel.plate : sel.arm;
    const par = parentOf(node);
    above.hidden = !par || Math.abs(balancePoint(par.arm) - par.arm.hook) < 0.004;
  }

  function setRange(name: string, value: number, text: string): void {
    const input = $<HTMLInputElement>(`[data-edit="${name}"]`);
    if (document.activeElement !== input || input.value === '') input.value = String(value);
    $<HTMLOutputElement>(`[data-out="${name}"]`).textContent = text;
  }

  function levelArm(a: Arm, queue = false): void {
    const to = balancePoint(a);
    const tw: Tween = { arm: a, from: a.hook, to, t: 0, dur: 0.5 + Math.abs(to - a.hook) * 1.2 };
    if (queue) tweens.push(tw);
    else {
      tweens = tweens.filter((x) => x.arm !== a);
      tweens.unshift(tw);
    }
  }

  function levelAll(): void {
    tweens = [];
    // Bottom up: deepest arms first, the way the mobile is built.
    const list = [...arms(tree)];
    const depthOf = (a: Arm): number => {
      let d = 0;
      let n: Node = a;
      for (;;) {
        const p = parentOf(n);
        if (!p) return d;
        d++;
        n = p.arm;
      }
    };
    list.sort((p, q) => depthOf(q) - depthOf(p));
    for (const a of list) tweens.push({ arm: a, from: NaN, to: NaN, t: 0, dur: 0.55 });
  }

  function stepTweens(dt: number): boolean {
    const tw = tweens[0];
    if (!tw) return false;
    if (Number.isNaN(tw.from)) {
      tw.from = tw.arm.hook;
      tw.to = balancePoint(tw.arm);
      if (Math.abs(tw.to - tw.from) < 0.0015) {
        tweens.shift();
        return true;
      }
    }
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    tw.arm.hook = tw.from + (tw.to - tw.from) * e;
    if (k >= 1) tweens.shift();
    return true;
  }

  // Editing.
  const freshPlate = (like?: Plate): Plate => {
    const shapes = SHAPE_KEYS.filter((s) => s !== like?.shape);
    const paints = PAINT_KEYS.filter((p) => p !== like?.paint);
    return {
      kind: 'plate',
      shape: shapes[Math.floor(Math.random() * shapes.length)]!,
      size: Math.max(0.07, (like?.size ?? 0.13) * (0.75 + Math.random() * 0.3)),
      paint: paints[Math.floor(Math.random() * paints.length)]!,
      roll: Math.round((Math.random() - 0.5) * 120),
    };
  };

  function edited(): void {
    rebuild();
    syncBench();
  }

  for (const b of $$<HTMLButtonElement>('[data-shape]')) {
    b.addEventListener('click', () => {
      if (sel?.kind !== 'plate') return;
      sel.plate.shape = b.dataset.shape as ShapeKey;
      edited();
    });
  }
  for (const b of $$<HTMLButtonElement>('[data-paint]')) {
    b.addEventListener('click', () => {
      if (sel?.kind !== 'plate') return;
      sel.plate.paint = b.dataset.paint as PaintKey;
      edited();
    });
  }
  for (const input of $$<HTMLInputElement>('[data-edit]')) {
    input.addEventListener('input', () => {
      const v = Number(input.value);
      const name = input.dataset.edit;
      if (sel?.kind === 'plate') {
        if (name === 'size') sel.plate.size = v / 100;
        if (name === 'roll') sel.plate.roll = v;
      } else if (sel?.kind === 'arm') {
        const a = sel.arm;
        tweens = tweens.filter((t) => t.arm !== a);
        if (name === 'hook') a.hook = v / 100;
        if (name === 'len') a.len = Math.min(MAX_ARM, Math.max(MIN_ARM, v / 100));
        if (name === 'sag') a.sag = v / 100;
        if (name === 'drop') a.drop = v / 100;
      }
      edited();
    });
  }

  $('[data-act="branch"]').addEventListener('click', () => {
    if (sel?.kind !== 'plate') return;
    const p = sel.plate;
    const par = parentOf(p);
    if (!par) return;
    const arm: Arm = {
      kind: 'arm',
      len: Math.max(MIN_ARM, Math.min(0.42, par.arm.len * 0.62)),
      hook: 0.5,
      sag: 0.08,
      drop: 0.13,
      ends: par.side === 0 ? [freshPlate(p), p] : [p, freshPlate(p)],
    };
    arm.hook = balancePoint(arm);
    par.arm.ends[par.side] = arm;
    rebuild();
    openBench({ kind: 'arm', arm });
  });

  $('[data-act="remove-plate"]').addEventListener('click', () => {
    if (sel?.kind !== 'plate') return;
    const par = parentOf(sel.plate);
    if (!par) return;
    const other = par.arm.ends[1 - par.side]!;
    if (par.arm === tree) {
      if (other.kind !== 'arm') return;
      other.drop = tree.drop;
      tree = other;
      rebuild();
      openBench(null);
      return;
    }
    const gp = parentOf(par.arm);
    if (!gp) return;
    if (other.kind === 'arm') other.drop = par.arm.drop;
    gp.arm.ends[gp.side] = other;
    rebuild();
    openBench(other.kind === 'arm' ? { kind: 'arm', arm: gp.arm } : { kind: 'plate', plate: other });
  });

  $('[data-act="remove-arm"]').addEventListener('click', () => {
    if (sel?.kind !== 'arm' || sel.arm === tree) return;
    const par = parentOf(sel.arm);
    if (!par) return;
    const keep = [...plates(sel.arm)].sort((p, q) => q.size - p.size)[0];
    const plate: Plate = keep ? { ...keep } : freshPlate();
    par.arm.ends[par.side] = plate;
    rebuild();
    openBench({ kind: 'plate', plate });
  });

  $('[data-act="level"]').addEventListener('click', () => {
    if (sel?.kind === 'arm') levelArm(sel.arm);
  });
  $('[data-act="level-up"]').addEventListener('click', () => {
    if (!sel) return;
    const par = parentOf(sel.kind === 'plate' ? sel.plate : sel.arm);
    if (par) levelArm(par.arm);
  });
  $('.wt-done').addEventListener('click', () => openBench(null));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sel && !cutDialog.open) openBench(null);
  });

  // Bar.
  presetSelect.addEventListener('change', () => {
    const p = presetByKey(presetSelect.value);
    loadMobile(p.build(), p.title, true);
    history.replaceState(null, '', location.pathname + location.search);
  });
  for (const b of $$<HTMLButtonElement>('[data-air]')) {
    b.addEventListener('click', () => {
      air = Number(b.dataset.air);
      for (const o of $$<HTMLButtonElement>('[data-air]')) o.setAttribute('aria-checked', String(o === b));
    });
  }
  $('.wt-balance').addEventListener('click', () => levelAll());
  soundBtn.addEventListener('click', () => {
    clink.muted = !clink.muted;
    soundBtn.setAttribute('aria-pressed', String(!clink.muted));
  });
  shareBtn.addEventListener('click', async () => {
    const code = await encodeMobile(tree, titleInput.value || 'Untitled');
    history.replaceState(null, '', `${location.pathname}${location.search}#m=${code}`);
    let text = 'Link copied';
    try {
      await navigator.clipboard.writeText(location.href);
    } catch {
      text = 'Link is in the address bar';
    }
    shareBtn.textContent = text;
    window.setTimeout(() => (shareBtn.textContent = 'Copy link'), 2200);
  });

  const blowStart = (e: PointerEvent) => {
    clink.wake();
    blowBtn.setPointerCapture(e.pointerId);
    blowBtn.classList.add('on');
    const r = mobile.reachCache;
    const c = project(cam, [0, (r.top + r.bottom) / 2, 0]);
    blow.x = c[0];
    blow.y = c[1];
    blow.wide = true;
    blow.want = 1;
    hideHint();
  };
  const blowEnd = () => {
    blowBtn.classList.remove('on');
    blow.want = 0;
  };
  blowBtn.addEventListener('pointerdown', blowStart);
  blowBtn.addEventListener('pointerup', blowEnd);
  blowBtn.addEventListener('pointercancel', blowEnd);
  blowBtn.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      const r = mobile.reachCache;
      const c = project(cam, [0, (r.top + r.bottom) / 2, 0]);
      blow.x = c[0];
      blow.y = c[1];
      blow.wide = true;
      blow.want = 1;
      blowBtn.classList.add('on');
    }
  });
  blowBtn.addEventListener('keyup', blowEnd);

  function loadMobile(next: Arm, title: string, balance: boolean): void {
    if (balance) balanceAll(next);
    tree = next;
    titleInput.value = title;
    openBench(null);
    tweens = [];
    mobile = new Mobile(tree);
    settle();
    framed = false;
    frameTargets();
    updateLabel();
  }

  // Pointer on the room.
  let drag: Drag | null = null;

  function hitTest(x: number, y: number): { ps?: PlateState; s?: ArmState; hook?: ArmState } {
    const sa = selArmState();
    if (sa) {
      const h = project(cam, sa.H);
      if (Math.hypot(h[0] - x, h[1] - 6 - y) < 16) return { hook: sa };
    }
    let best: { ps: PlateState; depth: number } | null = null;
    for (const hp of renderer.hits.plates) {
      if (inside(hp.poly, x, y) && (!best || hp.depth < best.depth)) best = { ps: hp.ps, depth: hp.depth };
    }
    if (best) return { ps: best.ps };
    let wire: { s: ArmState; d: number } | null = null;
    for (const ha of renderer.hits.arms) {
      const d = distToLine(ha.line, x, y);
      if (d < 9 && (!wire || d < wire.d)) wire = { s: ha.s, d };
    }
    if (wire) return { s: wire.s };
    return {};
  }

  canvas.addEventListener('pointermove', (e) => {
    if (drag) return;
    const h = hitTest(e.offsetX, e.offsetY);
    canvas.classList.toggle('over-hook', !!h.hook);
    canvas.classList.toggle('over-part', !h.hook && !!(h.ps || h.s));
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (drag) return;
    clink.wake();
    hideHint();
    canvas.setPointerCapture(e.pointerId);
    const x = e.offsetX;
    const y = e.offsetY;
    const h = hitTest(x, y);
    const t = performance.now();
    if (h.hook) drag = { kind: 'hook', s: h.hook, id: e.pointerId };
    else if (h.ps) drag = { kind: 'push', ps: h.ps, x, y, t, vx: 0, moved: false, id: e.pointerId };
    else if (h.s) drag = { kind: 'wire', s: h.s, x, y, t, vx: 0, moved: false, id: e.pointerId };
    else drag = { kind: 'empty', x, y, t0: t, moved: false, id: e.pointerId };
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const x = e.offsetX;
    const y = e.offsetY;
    const t = performance.now();
    if (drag.kind === 'push' || drag.kind === 'wire') {
      const dt = Math.max(1, t - drag.t) / 1000;
      const vx = (x - drag.x) / dt;
      drag.vx = drag.vx * 0.4 + vx * 0.6;
      if (Math.hypot(x - drag.x, y - drag.y) > 0 && !drag.moved) {
        drag.moved = Math.abs(x - drag.x) > 4 || Math.abs(y - drag.y) > 4;
      }
      if (drag.moved) {
        drag.x = x;
        drag.y = y;
        drag.t = t;
      }
    } else if (drag.kind === 'hook') {
      const held = drag.s.arm;
      const hit = renderer.hits.arms.find((a) => a.s.arm === held);
      if (hit) {
        const u = paramOnLine(hit.line, x, y);
        const a = hit.s.arm;
        tweens = tweens.filter((tw) => tw.arm !== a);
        a.hook = Math.min(0.98, Math.max(0.02, u));
        rebuild();
        syncBench();
        const ns = mobile.armsList.find((s) => s.arm === a);
        if (ns) drag.s = ns;
      }
    } else if (drag.kind === 'empty') {
      if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) > 6) drag.moved = true;
      blow.x = x;
      blow.y = y;
      if (drag.moved) startPointerBlow(x, y);
    }
  });

  function startPointerBlow(x: number, y: number): void {
    blow.x = x;
    blow.y = y;
    blow.wide = false;
    blow.want = 1;
  }

  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    canvas.classList.remove('dragging');
    if (d.kind === 'push' && !d.moved) openBench({ kind: 'plate', plate: d.ps.plate });
    else if (d.kind === 'wire' && !d.moved) openBench({ kind: 'arm', arm: d.s.arm });
    else if (d.kind === 'empty') {
      const held = performance.now() - d.t0 > 220;
      if (!d.moved && !held && sel) openBench(null);
    }
    if (blow.wide === false) blow.want = 0;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /** While a plate or wire is held, pull it along with the finger; held still, it stops. */
  function applyPush(): void {
    if (!drag) return;
    if (drag.kind === 'empty') {
      if (!drag.moved && performance.now() - drag.t0 > 220) startPointerBlow(drag.x, drag.y);
      return;
    }
    if (drag.kind !== 'push' && drag.kind !== 'wire') return;
    if (!drag.moved) return;
    const idle = (performance.now() - drag.t) / 1000;
    const vScreen = idle > 0.06 ? 0 : drag.vx;
    if (drag.kind === 'push') {
      const ps = drag.ps;
      const fresh = mobile.platesList.find((p) => p.plate === ps.plate);
      if (!fresh) return;
      drag.ps = fresh;
      const D = project(cam, fresh.C)[2];
      const vWant = (vScreen * D) / cam.f;
      const s = fresh.owner;
      const vNow = -(fresh.C[2] - s.H[2]) * s.omega;
      const f = Math.max(-0.08, Math.min(0.08, 0.5 * (vWant - vNow)));
      fresh.px += f;
    } else {
      const held = drag.s.arm;
      const s = mobile.armsList.find((q) => q.arm === held);
      if (!s) return;
      drag.s = s;
      // Push at whichever end of the wire is nearer the finger.
      const D = project(cam, s.H)[2];
      const vWant = (vScreen * D) / cam.f;
      const pick = s.plates[0];
      if (pick) {
        const vNow = -(pick.C[2] - s.H[2]) * s.omega;
        pick.px += Math.max(-0.08, Math.min(0.08, 0.5 * (vWant - vNow)));
      } else {
        const lever = Math.max(0.05, s.arm.len / 2);
        s.omega += ((vWant / lever - s.omega) * 0.15) / 1;
      }
    }
  }

  function hideHint(): void {
    hint.classList.add('gone');
  }

  // Cutting your own plate.
  const cutDialog = $<HTMLDialogElement>('.wt-cut');
  const sheet = $<HTMLCanvasElement>('.wt-sheet');
  const sctx = sheet.getContext('2d')!;
  const cutDo = $<HTMLButtonElement>('.wt-cut-do');
  let stroke: Pt[] = [];
  let cutting = false;

  function drawSheet(): void {
    const w = sheet.width;
    const h = sheet.height;
    const g = sctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#d9dcdf');
    g.addColorStop(0.5, '#c4c8cc');
    g.addColorStop(1, '#d3d6d9');
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, w, h);
    // Brushed grain.
    let seed = 3;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 520; i++) {
      const y = rnd() * h;
      sctx.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(90,96,102,0.08)';
      sctx.lineWidth = 1;
      sctx.beginPath();
      sctx.moveTo(0, y);
      sctx.lineTo(w, y + (rnd() - 0.5) * 3);
      sctx.stroke();
    }
    if (stroke.length > 1) {
      sctx.beginPath();
      stroke.forEach(([x, y], i) => (i ? sctx.lineTo(x, y) : sctx.moveTo(x, y)));
      if (!cutting) {
        sctx.closePath();
        sctx.fillStyle = 'rgba(42, 38, 34, 0.14)';
        sctx.fill();
      }
      sctx.strokeStyle = '#2a2622';
      sctx.lineWidth = 2.5;
      sctx.setLineDash(cutting ? [] : [10, 7]);
      sctx.lineJoin = 'round';
      sctx.stroke();
      sctx.setLineDash([]);
      if (!cutting) {
        // The wire, meeting the outline at its left-most point.
        let lm = stroke[0]!;
        for (const p of stroke) if (p[0] < lm[0]) lm = p;
        sctx.strokeStyle = '#171615';
        sctx.lineWidth = 4;
        sctx.beginPath();
        sctx.moveTo(Math.max(0, lm[0] - 120), lm[1] - 18);
        sctx.quadraticCurveTo(lm[0] - 50, lm[1] - 6, lm[0], lm[1]);
        sctx.stroke();
      }
    }
  }

  $('.wt-cut-open').addEventListener('click', () => {
    stroke = [];
    cutDo.disabled = true;
    drawSheet();
    cutDialog.showModal();
  });
  $('.wt-cut-clear').addEventListener('click', () => {
    stroke = [];
    cutDo.disabled = true;
    drawSheet();
  });
  const sheetPoint = (e: PointerEvent): Pt => {
    const r = sheet.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * sheet.width, ((e.clientY - r.top) / r.height) * sheet.height];
  };
  sheet.addEventListener('pointerdown', (e) => {
    sheet.setPointerCapture(e.pointerId);
    cutting = true;
    stroke = [sheetPoint(e)];
    drawSheet();
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!cutting) return;
    const p = sheetPoint(e);
    const q = stroke[stroke.length - 1]!;
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 3) {
      stroke.push(p);
      drawSheet();
    }
  });
  const sheetUp = () => {
    if (!cutting) return;
    cutting = false;
    const area = Math.abs(polyArea(stroke));
    cutDo.disabled = stroke.length < 8 || area < sheet.width * sheet.height * 0.015;
    drawSheet();
  };
  sheet.addEventListener('pointerup', sheetUp);
  sheet.addEventListener('pointercancel', sheetUp);
  cutDialog.addEventListener('close', () => {
    if (cutDialog.returnValue !== 'cut' || sel?.kind !== 'plate' || stroke.length < 8) return;
    const pts = normaliseCut(stroke);
    if (!pts) return;
    sel.plate.shape = pts;
    edited();
  });

  // Share links.
  const hash = location.hash.match(/^#m=([A-Za-z0-9_-]+)$/);
  if (hash) {
    void decodeMobile(hash[1]!).then((got) => {
      if (!got) return;
      const opt = document.createElement('option');
      opt.value = 'link';
      opt.textContent = 'From a link';
      presetSelect.prepend(opt);
      presetSelect.value = 'link';
      loadMobile(got.root, got.title, false);
    });
  }

  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { __wt: unknown }).__wt = {
      get mobile() {
        return mobile;
      },
      get tree() {
        return tree;
      },
      cam,
      room,
      select: (kind: 'plate' | 'arm', i: number) => {
        if (kind === 'plate') openBench({ kind, plate: [...plates(tree)][i]! });
        else openBench({ kind, arm: [...arms(tree)][i]! });
      },
      setAir: (n: number) => {
        air = n;
        airLevel = AIR[n]!;
      },
      run: (seconds: number) => {
        for (let i = 0; i < seconds * 120; i++) mobile.step(DT, env);
      },
      blow: (x: number, y: number, level: number) => {
        blow.x = x;
        blow.y = y;
        blow.wide = false;
        blow.level = level;
        blow.want = level;
      },
    };
  }

  // Frame loop.
  resize();
  frameTargets();
  updateLabel();
  window.addEventListener('resize', () => {
    resize();
    frameTargets();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clink.suspend();
    else clink.resume();
  });

  let last = performance.now();
  let acc = 0;
  function frame(now: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (stepTweens(dt)) {
      rebuild();
      syncBench();
    }
    frameTargets();
    const ease = 1 - Math.exp(-dt * 3);
    cam.f += (target.f - cam.f) * ease;
    cam.k0 += (target.k0 - cam.k0) * ease;
    cam.cx += (target.cx - cam.cx) * ease;
    room.wallZ += (target.wallZ - room.wallZ) * ease;
    // The lamp is trained on the mobile from in front, up and to the left.
    const rc = mobile.reachCache;
    const lampY = (rc.top + rc.bottom) / 2 + 0.95;
    room.light[1] += (lampY - room.light[1]) * ease;
    airLevel += (AIR[air]! - airLevel) * (1 - Math.exp(-dt * 0.5));
    blow.level += (blow.want - blow.level) * (1 - Math.exp(-dt * (blow.want > blow.level ? 5 : 2.2)));
    const steadyWant = sel ? 1 : 0;
    env.steady += (steadyWant - env.steady) * (1 - Math.exp(-dt * 2.5));
    const sa = selArmState() ?? selPlateState()?.owner ?? null;
    env.face = sa ?? null;
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 8) {
      applyPush();
      mobile.step(DT, env);
      for (const c of mobile.contacts) clink.hit(c.speed, Math.min(c.a.plate.size, c.b.plate.size));
      acc -= DT;
      n++;
    }
    if (n === 8) acc = 0;
    const sArm = selArmState() ?? null;
    renderer.draw(cam, room, mobile, {
      plate: selPlateState() ?? null,
      arm: sArm,
      balance: sArm ? balancePoint(sArm.arm) : null,
    });
    placeLabel();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function inside(poly: [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function distToLine(line: [number, number][], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i]!;
    const [bx, by] = line[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

/** Where along a polyline (0 to 1, by index) a point falls nearest. */
function paramOnLine(line: [number, number][], x: number, y: number): number {
  let best = Infinity;
  let at = 0.5;
  const n = line.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = line[i]!;
    const [bx, by] = line[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
    if (d < best) {
      best = d;
      at = (i + t) / n;
    }
  }
  return at;
}

function polyArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** A drawn outline as plate coordinates: stem at its left-most point, far edge at u = 1. */
function normaliseCut(stroke: Pt[]): Pt[] | null {
  let simple = rdp(stroke, 2.2);
  if (simple.length > 140) simple = simple.filter((_, i) => i % Math.ceil(simple.length / 140) === 0);
  if (simple.length < 5) return null;
  let lm = 0;
  for (let i = 1; i < simple.length; i++) if (simple[i]![0] < simple[lm]![0]) lm = i;
  const [sx, sy] = simple[lm]!;
  const maxX = Math.max(...simple.map((p) => p[0]));
  const span = maxX - sx;
  if (span < 20) return null;
  // Start the outline at the stem.
  const ordered = [...simple.slice(lm), ...simple.slice(0, lm)];
  return ordered.map(([x, y]): Pt => [
    Math.round(((x - sx) / span) * 1000) / 1000,
    Math.round(Math.max(-1, Math.min(1, -(y - sy) / span)) * 1000) / 1000,
  ]);
}

function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const [ax, ay] = pts[0]!;
  const [bx, by] = pts[pts.length - 1]!;
  let worst = 0;
  let wi = 0;
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i]!;
    const d = Math.abs(dy * x - dx * y + bx * ay - by * ax) / l;
    if (d > worst) {
      worst = d;
      wi = i;
    }
  }
  if (worst <= eps) return [pts[0]!, pts[pts.length - 1]!];
  const left = rdp(pts.slice(0, wi + 1), eps);
  const right = rdp(pts.slice(wi), eps);
  return [...left.slice(0, -1), ...right];
}

