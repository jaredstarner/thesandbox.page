// The page: the particulars sheet, the viewing, the frame loop, and input.

import { Renderer } from './_gl';
import { Plan } from './_plan';
import { ROOMS, buildRoom, floorUV, type Room, type V3 } from './_rooms';
import { Visitor } from './_visitor';

const MARKS = 768;
const LOOK = 0.0042;

export function start(root: HTMLElement) {
  const wrap = root.querySelector<HTMLElement>('[data-stage]')!;
  const canvas = root.querySelector<HTMLCanvasElement>('[data-plate]')!;
  const planCanvas = root.querySelector<HTMLCanvasElement>('[data-plan]')!;
  const miniCanvas = root.querySelector<HTMLCanvasElement>('[data-plan-mini]')!;
  const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const lotButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-lot]')];
  const sheets = [...root.querySelectorAll<HTMLElement>('[data-sheet]')];
  const planNote = q('[data-plan-note]');
  const hintEl = q('[data-hint]');
  const nameEl = q('[data-view-name]');
  const handEl = q('[data-hand]');
  const doorsEl = q('[data-doors]');
  const chalkBtn = q<HTMLButtonElement>('[data-chalk]');

  const rooms: Room[] = ROOMS.map(buildRoom);
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let lot = Math.max(0, Math.min(rooms.length - 1, Number(params.get('room') ?? 0) || 0));
  let room = rooms[lot]!;
  const visitor = new Visitor(room);
  const plan = new Plan(planCanvas);
  const mini = new Plan(miniCanvas);

  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: debug,
  });
  if (!gl) root.dataset.nogl = '';
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    root.dataset.nogl = '';
    setViewing(false);
  });
  const renderer = gl ? new Renderer(canvas, gl) : null;

  // ---------------------------------------------------------------- chalk
  const marks = document.createElement('canvas');
  marks.width = MARKS;
  marks.height = MARKS;
  const mg = marks.getContext('2d')!;
  let chalk = true;
  let marksDirty = false;
  let lastMarked = 0;
  const clearMarks = () => {
    mg.globalCompositeOperation = 'source-over';
    mg.fillStyle = '#000';
    mg.fillRect(0, 0, MARKS, MARKS);
    lastMarked = visitor.crumbs.length;
    marksDirty = true;
  };
  const addMarks = () => {
    const crumbs = visitor.crumbs;
    if (!chalk || !viewing) {
      lastMarked = crumbs.length;
      return;
    }
    if (lastMarked >= crumbs.length) return;
    mg.globalCompositeOperation = 'lighter';
    mg.lineCap = 'round';
    mg.lineWidth = (MARKS / (room.extent * room.unit * 2)) * 0.038;
    for (let i = Math.max(1, lastMarked); i < crumbs.length; i++) {
      const a = crumbs[i - 1]!;
      const b = crumbs[i]!;
      if (b.jump) continue;
      const [ax, ay] = floorUV(room, a.p);
      const [bx, by] = floorUV(room, b.p);
      mg.strokeStyle = b.above ? '#0f0' : '#f00';
      mg.beginPath();
      mg.moveTo(ax * MARKS, (1 - ay) * MARKS);
      mg.lineTo(bx * MARKS, (1 - by) * MARKS);
      mg.stroke();
    }
    lastMarked = crumbs.length;
    marksDirty = true;
  };

  // ---------------------------------------------------------------- property
  let drawingRoom: Room | null = null;
  const showSheet = () => {
    lotButtons.forEach((b, i) => {
      b.setAttribute('aria-current', i === lot ? 'true' : 'false');
    });
    sheets.forEach((s, i) => {
      s.hidden = i !== lot;
    });
    planNote.textContent = room.spec.sheet.plan;
    nameEl.textContent = room.spec.sheet.name;
    hintEl.textContent = room.spec.sheet.hint;
  };
  const choose = (i: number) => {
    lot = (i + rooms.length) % rooms.length;
    room = rooms[lot]!;
    visitor.place(room);
    plan.setRoom(room);
    mini.setRoom(room);
    clearMarks();
    drawingRoom = null;
    if (!renderer?.ready(room.kappa)) delete root.dataset.drawn;
    hintEl.classList.remove('gone');
    showSheet();
    if (!history.replaceState) return;
    try {
      const url = new URL(location.href);
      if (lot === 0) url.searchParams.delete('room');
      else url.searchParams.set('room', String(lot));
      history.replaceState(null, '', url);
    } catch {
      // A sandboxed frame can refuse this; the address bar just stays as it was.
    }
  };

  // ---------------------------------------------------------------- viewing
  let viewing = false;
  const setViewing = (on: boolean) => {
    if (viewing === on) return;
    viewing = on;
    root.dataset.mode = on ? 'viewing' : 'sheet';
    document.documentElement.style.overflow = on ? 'hidden' : '';
    if (on) {
      clearMarks();
      visitor.crumbs = [visitor.crumbs[visitor.crumbs.length - 1]!];
      visitor.crumbs[0]!.jump = true;
      lastMarked = 1;
      visitor.crossings = 0;
      hintEl.classList.remove('gone');
      canvas.focus({ preventScroll: true });
    } else {
      // Back on the sheet the walk starts again from the door, not from wherever the visitor left off.
      keys.clear();
      target = null;
      visitor.place(room);
      clearMarks();
    }
    resize();
  };

  const keys = new Set<string>();
  let target: { yaw: number; left: number; last: V3; stuck: number } | null = null;
  let holdTimer = 0;
  let holding = false;

  addEventListener('keydown', (e) => {
    if (!viewing) return;
    if (e.key === 'Escape') {
      setViewing(false);
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    keys.add(e.key.toLowerCase());
    target = null;
    hintEl.classList.add('gone');
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());

  let drag: { id: number; x: number; y: number; moved: number; x0: number; y0: number } | null = null;
  // A click rather than a press, so that scrolling the sheet on a phone doesn't open the viewing.
  canvas.addEventListener('click', () => setViewing(true));
  canvas.addEventListener('pointerdown', (e) => {
    if (!viewing) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, x0: e.clientX, y0: e.clientY };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers have no capture to set.
    }
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => {
      if (drag && drag.moved < 8) holding = true;
    }, 320);
    target = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 6) {
      visitor.turn(-dx * LOOK, dy * LOOK);
      hintEl.classList.add('gone');
    }
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    clearTimeout(holdTimer);
    if (drag.moved < 8 && !holding) tapWalk(drag.x0, drag.y0);
    holding = false;
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', (e) => {
    holding = false;
    if (drag && e.pointerId === drag.id) drag = null;
  });

  /** Turns to face the place tapped and walks there, through a door if that is where it lies. */
  const tapWalk = (x: number, y: number) => {
    const box = canvas.getBoundingClientRect();
    const cx = ((x - box.left) / box.width - 0.5) * 2 * (box.width / box.height);
    const cy = -((y - box.top) / box.height - 0.5) * 2;
    const focal = Math.min(1.5, (box.width / box.height) * 1.35);
    const sp = Math.sin(visitor.pitch);
    const cp = Math.cos(visitor.pitch);
    const vy = cy * cp + focal * sp;
    const vz = -cy * sp + focal * cp;
    const yaw = Math.atan2(cx, vz);
    const down = -vy / Math.hypot(cx, vz);
    const left = down > 0.04 ? Math.min(6, 1.6 / down) : 3.5;
    target = { yaw, left, last: visitor.p, stuck: 0 };
    hintEl.classList.add('gone');
  };

  q('[data-view]').addEventListener('click', () => setViewing(true));
  q('[data-leave]').addEventListener('click', () => setViewing(false));
  q('[data-next]').addEventListener('click', () => choose(lot + 1));
  chalkBtn.addEventListener('click', () => {
    chalk = !chalk;
    chalkBtn.setAttribute('aria-pressed', String(chalk));
    if (!chalk) {
      clearMarks();
    }
  });
  lotButtons.forEach((b, i) => b.addEventListener('click', () => choose(i)));

  // ---------------------------------------------------------------- size
  const resize = () => {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, viewing ? 1.5 : 2);
    const w = Math.max(2, Math.round(box.width * dpr));
    const h = Math.max(2, Math.round(box.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    for (const c of [planCanvas, miniCanvas]) {
      const b = c.getBoundingClientRect();
      const s = Math.max(2, Math.round(b.width * Math.min(devicePixelRatio, 2)));
      if (c.width !== s) {
        c.width = s;
        c.height = s;
      }
    }
  };
  new ResizeObserver(resize).observe(wrap);
  resize();

  // ---------------------------------------------------------------- frame loop
  let visible = true;
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
  }).observe(wrap);

  let last = performance.now();
  let slow = 0;
  let frames = 0;
  let planTick = 0;
  let shownHand = '';
  let shownDoors = -1;

  const statusLine = () => {
    const hand = visitor.handedness();
    const text = hand > 0 ? 'Particulars in your right hand' : 'Particulars in your left hand';
    if (text !== shownHand) {
      handEl.textContent = text;
      handEl.dataset.left = hand > 0 ? 'false' : 'true';
      shownHand = text;
    }
    if (visitor.crossings !== shownDoors) {
      shownDoors = visitor.crossings;
      doorsEl.textContent =
        shownDoors === 0 ? 'No doors used yet' : shownDoors === 1 ? 'One door used' : `${shownDoors} doors used`;
    }
  };

  const step = (dt: number) => {
    if (!viewing) {
      if (!reduced && visible) visitor.move(1, 0, dt, 0.5);
      return;
    }
    let forward = 0;
    let side = 0;
    if (keys.has('w') || keys.has('arrowup')) forward += 1;
    if (keys.has('s') || keys.has('arrowdown')) forward -= 1;
    if (keys.has('d')) side += 1;
    if (keys.has('a')) side -= 1;
    const turnRate = 1.7 * dt;
    if (keys.has('arrowleft')) visitor.turn(-turnRate, 0);
    if (keys.has('arrowright')) visitor.turn(turnRate, 0);
    if (holding) forward = 1;
    if (target) {
      const ease = Math.min(1, dt * 6);
      const turn = target.yaw * ease;
      visitor.turn(turn, 0);
      target.yaw -= turn;
      if (Math.abs(target.yaw) < 0.12) {
        const before = visitor.p;
        visitor.move(1, 0, dt, keys.has('shift') ? 1.6 : 1);
        const moved = Math.hypot(visitor.p[0] - before[0], visitor.p[1] - before[1]);
        target.left -= 1.5 * dt;
        if (moved * room.unit < 0.2 * dt) target.stuck += dt;
        if (target.left <= 0 || target.stuck > 0.25) target = null;
        return;
      }
    }
    visitor.move(forward, side, dt, keys.has('shift') ? 1.6 : 1);
  };

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (document.hidden || (!visible && !viewing)) return;
    step(dt);
    addMarks();
    if (renderer) {
      renderer.prepare(room.kappa);
      if (renderer.ready(room.kappa)) {
        if (drawingRoom !== room) {
          renderer.setRoom(room);
          drawingRoom = room;
          root.dataset.drawn = '';
          marksDirty = true;
          // The other curvatures, so that changing property doesn't wait.
          for (const r of rooms) renderer.prepare(r.kappa);
        }
        if (marksDirty && performance.now() - lastUpload > 90) {
          renderer.uploadMarks(marks);
          marksDirty = false;
          lastUpload = performance.now();
        }
        renderer.draw(visitor.view());
        // Hold the frame rate by tracing fewer pixels; the pen stays sharp, since it is drawn at full size.
        frames++;
        slow = slow * 0.95 + dt * 0.05;
        if (frames >= 40) {
          frames = 0;
          if (slow > 0.024 && renderer.scale > 0.42) renderer.scale *= 0.86;
          else if (slow < 0.0125 && renderer.scale < 1) renderer.scale = Math.min(1, renderer.scale * 1.08);
        }
      }
    }
    planTick++;
    if (planTick % 3 === 0) {
      if (viewing) mini.draw(visitor);
      else plan.draw(visitor);
      statusLine();
    }
  };
  let lastUpload = 0;

  plan.setRoom(room);
  mini.setRoom(room);
  clearMarks();
  showSheet();
  root.dataset.mode = 'sheet';
  renderer?.prepare(0);
  renderer?.prepare(room.kappa);
  requestAnimationFrame(frame);

  // Lettering on the walls and the plan waits for the fonts.
  void document.fonts?.ready.then(() => {
    renderer?.refreshDecals();
    drawingRoom = null;
  });

  if (debug) {
    (window as unknown as { spacious: unknown }).spacious = {
      visitor,
      renderer,
      rooms,
      choose,
      setViewing,
      freeze: () => {
        Object.defineProperty(visitor, 'move', { value: () => undefined, configurable: true });
      },
      get lot() {
        return lot;
      },
      chalkLine(pts: [number, number][]) {
        for (const [f, s] of pts) visitor.move(f, s, s === 0 && f === 0 ? 0 : 0.05);
      },
    };
  }
}
