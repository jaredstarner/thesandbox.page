// Still scans: wires the code, the painting tools, photos and the camera, the
// defacing tools, and the scanner that reads the result back.

import type { SolveInput, SolveOutput } from './_art';
import { read, type ReadResult } from './_decode';
import { drawMark, INK, PAPER, type Mark } from './_marks';
import { lettering, stamp as makeStamp, type Stamp, type StampName } from './_pictures';
import { byteCapacity, layout, ROLE, sizeOf, type Level } from './_qr';
import type { Reply, Request } from './_worker';

const PINK = '#ff48b0';
const BLUE = '#0078bf';
const ORANGE = '#ff6c2f';
const QUIET = 4;
const DEFAULT_TEXT = 'https://thesandbox.page/still-scans/';
const LEVEL_SHARE: Record<Level, string> = { L: '7%', M: '15%', Q: '25%', H: '30%' };

type Mode = 'draw' | 'photo' | 'deface';
type DrawTool = 'ink' | 'paper' | 'rub';
type DefaceTool = 'marker' | 'whiteout' | 'coffee' | 'tear';

interface Snapshot {
  target: Int8Array;
  weight: Float32Array;
  marks: number;
  version: number;
}

export function startScans(root: HTMLElement) {
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const $$ = <T extends Element>(sel: string) => Array.from(root.querySelectorAll<T>(sel));

  const stage = $<HTMLElement>('[data-stage]');
  const codeCanvas = $<HTMLCanvasElement>('[data-code]');
  const marksCanvas = $<HTMLCanvasElement>('[data-marks]');
  const video = $<HTMLVideoElement>('[data-video]');
  const ctx = codeCanvas.getContext('2d')!;
  const mctx = marksCanvas.getContext('2d')!;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const debug = new URLSearchParams(location.search).has('debug');

  // ---- state ----
  const state = {
    text: DEFAULT_TEXT,
    version: 11,
    level: 'M' as Level,
    mask: 0,
    spend: 0.3,
    seed: 20261104,
    mode: 'draw' as Mode,
    drawTool: 'ink' as DrawTool,
    defaceTool: 'marker' as DefaceTool,
    brush: 2,
    anatomy: false,
    target: new Int8Array(sizeOf(11) ** 2).fill(-1) as Int8Array,
    weight: new Float32Array(sizeOf(11) ** 2) as Float32Array,
    marks: [] as Mark[],
    placing: null as Stamp | null,
    photo: null as CanvasImageSource | null,
    exposure: 0,
  };
  let solved: SolveOutput | null = null;
  let shownVersion = 0;
  let lastRead: ReadResult | null = null;
  const undo: Snapshot[] = [];

  const size = () => sizeOf(state.version);

  // ---- worker ----
  const worker = new Worker(new URL('./_worker.ts', import.meta.url), { type: 'module' });
  // One request in flight at a time; a new mask always comes before the next solve.
  let reqId = 0;
  let busy = false;
  let needMask = false;
  let needSolve = false;
  let sent = { version: 0, key: '', live: false };
  let shownKey = '';
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const msg = e.data;
    busy = false;
    if (msg.kind === 'mask') state.mask = msg.mask;
    else if (msg.kind === 'solve') accept(msg.out);
    kick();
  };
  function kick() {
    if (busy) return;
    if (needMask) {
      needMask = false;
      busy = true;
      const req: Request = {
        id: ++reqId,
        kind: 'mask',
        version: state.version,
        level: state.level,
        text: state.text,
        seed: state.seed,
      };
      worker.postMessage(req);
    } else if (needSolve) {
      needSolve = false;
      busy = true;
      sent = { version: state.version, key: `${state.version}${state.level}${state.mask}`, live: cameraLive };
      const input: SolveInput = {
        version: state.version,
        level: state.level,
        mask: state.mask,
        text: state.text,
        target: state.target.slice(),
        weight: state.weight.slice(),
        spend: state.spend,
        seed: state.seed,
      };
      const req: Request = { id: ++reqId, kind: 'solve', input };
      worker.postMessage(req, [input.target.buffer, input.weight.buffer]);
    }
  }
  function requestSolve() {
    needSolve = true;
    kick();
  }
  function requestMask() {
    needMask = true;
    needSolve = true;
    kick();
  }

  // ---- flashes for modules that changed ----
  let flash = new Float32Array(0);
  let flashing = false;

  function accept(out: SolveOutput) {
    if (sent.version !== state.version) return;
    const s = sizeOf(sent.version);
    if (solved && shownKey === sent.key && !reduceMotion && !sent.live) {
      const now = performance.now();
      if (flash.length !== s * s) flash = new Float32Array(s * s);
      let changed = 0;
      for (let c = 0; c < s * s; c++) if (solved.modules[c] !== out.modules[c]) changed++;
      // A new photo changes most of the code; flashing all of it hides the picture.
      const any = changed > 0 && changed < s * s * 0.2;
      if (any) for (let c = 0; c < s * s; c++) if (solved.modules[c] !== out.modules[c]) flash[c] = now;
      if (any && !flashing) {
        flashing = true;
        requestAnimationFrame(tick);
      }
    } else flash = new Float32Array(s * s);
    solved = out;
    shownVersion = sent.version;
    shownKey = sent.key;
    drawCode();
    scheduleScan();
    updateReadouts();
    if (opening) {
      opening();
      opening = null;
    }
  }
  let opening: (() => void) | null = null;

  function tick() {
    drawCode();
    const now = performance.now();
    let live = false;
    for (let c = 0; c < flash.length; c++)
      if (flash[c] && now - flash[c] < 700) {
        live = true;
        break;
      }
    if (live) requestAnimationFrame(tick);
    else flashing = false;
  }

  // ---- geometry ----
  let W = 0;
  let cell = 0;
  let origin = 0;
  let dpr = 1;
  function resize() {
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const css = stage.clientWidth;
    W = Math.round(css * dpr);
    for (const c of [codeCanvas, marksCanvas]) {
      c.width = W;
      c.height = W;
    }
    const s = size();
    cell = Math.max(1, Math.floor(W / (s + QUIET * 2)));
    origin = Math.floor((W - cell * s) / 2);
    drawCode();
    drawMarks();
  }

  function moduleAt(e: PointerEvent): [number, number] {
    const r = codeCanvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * W;
    return [(px - origin) / cell, (py - origin) / cell];
  }

  // ---- drawing the code ----
  function roleColour(lay: ReturnType<typeof layout>, c: number, message: Uint8Array | null): string | null {
    const r = lay.role[c];
    if (r === ROLE.data) return message && message[c] ? BLUE : null;
    if (r === ROLE.check) return PINK;
    if (r === ROLE.remainder) return null;
    return ORANGE;
  }

  function drawCode() {
    if (!W) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, W);
    if (!solved || shownVersion !== state.version) {
      drawPlacing();
      return;
    }
    const s = size();
    const lay = layout(state.version, state.level);
    const mods = solved.modules;
    const now = performance.now();
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const c = y * s + x;
        const px = origin + x * cell;
        const py = origin + y * cell;
        if (state.anatomy) {
          const col = roleColour(lay, c, solved.message);
          if (mods[c]) {
            ctx.fillStyle = col ?? INK;
            ctx.fillRect(px, py, cell, cell);
          } else if (col) {
            ctx.globalAlpha = 0.16;
            ctx.fillStyle = col;
            ctx.fillRect(px, py, cell, cell);
            ctx.globalAlpha = 1;
          }
        } else if (mods[c]) {
          ctx.fillStyle = INK;
          ctx.fillRect(px, py, cell, cell);
        }
        const f = flash[c];
        if (f && now - f < 700) {
          const a = 1 - (now - f) / 700;
          ctx.globalAlpha = a * 0.85;
          ctx.fillStyle = PINK;
          ctx.fillRect(px, py, cell, cell);
          ctx.globalAlpha = 1;
        }
      }
    // Wishes the code couldn't keep, in draw mode.
    if (state.mode === 'draw' && !state.anatomy && cell >= 4) {
      ctx.fillStyle = PINK;
      const d = Math.max(2, Math.round(cell * 0.3));
      const o = Math.floor((cell - d) / 2);
      for (let c = 0; c < s * s; c++)
        if (solved.unmet[c]) {
          const x = c % s;
          const y = (c - x) / s;
          ctx.fillRect(origin + x * cell + o, origin + y * cell + o, d, d);
        }
    }
    drawPlacing();
  }

  let ghostAt: [number, number] | null = null;
  function drawPlacing() {
    if (!state.placing || !ghostAt) return;
    const st = state.placing;
    const [gx, gy] = ghostAt;
    const x0 = Math.round(gx - st.w / 2);
    const y0 = Math.round(gy - st.h / 2);
    for (let y = 0; y < st.h; y++)
      for (let x = 0; x < st.w; x++) {
        const v = st.cells[y * st.w + x];
        if (v < 0) continue;
        ctx.globalAlpha = v ? 0.75 : 0.55;
        ctx.fillStyle = v ? BLUE : '#ffffff';
        ctx.fillRect(origin + (x0 + x) * cell, origin + (y0 + y) * cell, cell, cell);
      }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.strokeRect(origin + x0 * cell + 0.5, origin + y0 * cell + 0.5, st.w * cell - 1, st.h * cell - 1);
    ctx.setLineDash([]);
  }

  function drawMarks() {
    if (!W) return;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, W, W);
    mctx.setTransform(cell, 0, 0, cell, origin, origin);
    for (const m of state.marks) drawMark(mctx, m, cell);
    if (liveMark) drawMark(mctx, liveMark, cell);
  }

  // ---- the scanner ----
  const SCAN_PX = 6;
  const scanCanvas = document.createElement('canvas');
  const sctx = scanCanvas.getContext('2d', { willReadFrequently: true })!;
  let scanTimer = 0;
  function scheduleScan(delay = 40) {
    clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, delay);
  }
  function composite(target: CanvasRenderingContext2D, px: number, withMarks: boolean) {
    const s = size();
    const span = (s + QUIET * 2) * px;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.fillStyle = PAPER;
    target.fillRect(0, 0, span, span);
    if (!solved) return;
    target.fillStyle = INK;
    for (let c = 0; c < s * s; c++)
      if (solved.modules[c]) {
        const x = c % s;
        const y = (c - x) / s;
        target.fillRect((x + QUIET) * px, (y + QUIET) * px, px, px);
      }
    if (withMarks) {
      target.setTransform(px, 0, 0, px, QUIET * px, QUIET * px);
      for (const m of state.marks) drawMark(target, m, px);
      target.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  function scan(): ReadResult | null {
    if (!solved || shownVersion !== state.version) return null;
    const s = size();
    const span = (s + QUIET * 2) * SCAN_PX;
    scanCanvas.width = span;
    scanCanvas.height = span;
    composite(sctx, SCAN_PX, true);
    const img = sctx.getImageData(0, 0, span, span).data;
    const grid = new Uint8Array(s * s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        // Average the middle of each module, as a scanner samples its centre.
        let sum = 0;
        for (let dy = 2; dy <= 3; dy++)
          for (let dx = 2; dx <= 3; dx++) {
            const i = (((y + QUIET) * SCAN_PX + dy) * span + (x + QUIET) * SCAN_PX + dx) * 4;
            sum += 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
          }
        grid[y * s + x] = sum / 4 < 128 ? 1 : 0;
      }
    lastRead = read(grid, s);
    showVerdict(lastRead);
    return lastRead;
  }

  // ---- verdict and meter ----
  const stampEl = $<HTMLElement>('[data-stamp]');
  const readsEl = $<HTMLOutputElement>('[data-reads]');
  const whyEl = $<HTMLElement>('[data-why]');
  const meter = $<HTMLElement>('[data-meter]');
  const meterNote = $<HTMLElement>('[data-meter-note]');
  function showVerdict(r: ReadResult) {
    const lostFinder = r.finders.findIndex((n) => n > 6);
    const timingBad = r.timing > 0.3;
    const ok = r.ok && lostFinder < 0 && !timingBad;
    stampEl.textContent = ok ? 'Scans' : 'Won’t scan';
    stampEl.dataset.ok = String(ok);
    readsEl.textContent = r.ok ? r.text : '';
    readsEl.hidden = !r.ok;
    let why = '';
    const corner = ['top left', 'top right', 'bottom left'];
    if (!r.ok) {
      if (r.reason.startsWith('block'))
        why = `Too much is wrong in ${r.reason.replace(' has more errors than it can fix', '')}: more than the code can repair.`;
      else if (r.reason.startsWith('format'))
        why = 'Both copies of the format strip are spoiled, so a reader can’t tell the mask or level.';
      else if (r.reason.startsWith('version')) why = 'Both copies of the version block are spoiled.';
      else why = 'The data doesn’t make sense once repaired.';
    } else if (lostFinder >= 0)
      why = `The data still checks out, but the ${corner[lostFinder]} square is covered, and cameras look for all three corner squares first.`;
    else if (timingBad)
      why = 'The data still checks out, but the dotted timing lines are too broken for a camera to count the rows.';
    whyEl.textContent = why;
    whyEl.hidden = !why;

    // Meter: one bar per block, a slot per codeword it can repair.
    const spent = solved?.spent ?? [];
    const cap = r.blocks[0]?.capacity ?? 0;
    if (meter.childElementCount !== r.blocks.length || meter.dataset.cap !== String(cap)) {
      meter.replaceChildren(
        ...r.blocks.map((_, b) => {
          const bar = document.createElement('span');
          bar.className = 'bar';
          bar.title = `Block ${b + 1}`;
          for (let i = 0; i < cap; i++) bar.append(document.createElement('i'));
          const over = document.createElement('b');
          bar.append(over);
          return bar;
        }),
      );
      meter.dataset.cap = String(cap);
    }
    let spentAll = 0;
    let worstDmg = 0;
    let worstB = 0;
    let past = -1;
    r.blocks.forEach((blk, b) => {
      const bar = meter.children[b] as HTMLElement;
      const sp = Math.min(spent[b] ?? 0, blk.errors);
      const dmg = Math.max(0, blk.errors - sp);
      spentAll += sp;
      const slots = bar.querySelectorAll('i');
      slots.forEach((slot, i) => {
        slot.className = i < sp ? 'spent' : i < sp + dmg ? 'hurt' : '';
      });
      bar.dataset.over = String(!blk.ok);
      if (!blk.ok && past < 0) past = b;
      if (dmg > worstDmg) {
        worstDmg = dmg;
        worstB = b;
      }
    });
    const n = r.blocks.length;
    if (!n) meterNote.textContent = 'Nothing could be read far enough to count.';
    else {
      let line = `Each of the ${n} blocks can repair ${cap} bytes.`;
      line += spentAll ? ` ${spentAll} spent on the picture.` : '';
      if (past >= 0) line += ` Block ${past + 1} is past repair.`;
      else if (worstDmg) {
        const left = cap - r.blocks[worstB].errors;
        line += ` Worst damage: block ${worstB + 1}, ${worstDmg} bytes, ${left} left to spare.`;
      } else line += ' No damage.';
      meterNote.textContent = line;
    }
  }

  // ---- readouts ----
  const slug = $<HTMLElement>('[data-slug]');
  const bytesEl = $<HTMLElement>('[data-bytes]');
  const versionOut = $<HTMLOutputElement>('[data-version-out]');
  const spendOut = $<HTMLOutputElement>('[data-spend-out]');
  const keptEl = $<HTMLElement>('[data-kept]');
  const legend = $<HTMLElement>('[data-legend]');
  function updateReadouts() {
    const s = size();
    versionOut.textContent = `${s} × ${s}`;
    const used = new TextEncoder().encode(state.text).length;
    const capB = byteCapacity(state.version, state.level);
    bytesEl.textContent = `${used} of ${capB} bytes`;
    bytesEl.dataset.over = String(used > capB);
    spendOut.textContent = `${Math.round(state.spend * 100)}%`;
    if (solved && shownVersion === state.version) {
      slug.textContent = `Version ${state.version} · ${s}×${s} · level ${state.level} · mask ${state.mask} · ${solved.free.toLocaleString('en')} spare bits`;
      if (solved.wishes) {
        const missed = solved.wishes - solved.granted;
        const dots = state.mode === 'draw' ? ` The pink dots are the ${missed.toLocaleString('en')} it couldn’t.` : '';
        keptEl.textContent = missed
          ? `Kept ${solved.granted.toLocaleString('en')} of ${solved.wishes.toLocaleString('en')} modules of your picture.${dots}`
          : `Kept all ${solved.wishes.toLocaleString('en')} modules of your picture.`;
      } else keptEl.textContent = 'Nothing drawn yet: every spare bit is noise.';
      const lay = layout(state.version, state.level);
      let fixed = 0;
      let msg = 0;
      let check = 0;
      let free = 0;
      for (let c = 0; c < s * s; c++) {
        const r = lay.role[c];
        if (r === ROLE.check) check++;
        else if (r === ROLE.data) {
          if (solved.message[c]) msg++;
          else free++;
        } else if (r === ROLE.remainder) free++;
        else fixed++;
      }
      legend.querySelector('[data-n="fixed"]')!.textContent = fixed.toLocaleString('en');
      legend.querySelector('[data-n="message"]')!.textContent = msg.toLocaleString('en');
      legend.querySelector('[data-n="check"]')!.textContent = check.toLocaleString('en');
      legend.querySelector('[data-n="free"]')!.textContent = free.toLocaleString('en');
    }
  }

  // ---- edits ----
  function snapshot() {
    undo.push({
      target: state.target.slice(),
      weight: state.weight.slice(),
      marks: state.marks.length,
      version: state.version,
    });
    if (undo.length > 60) undo.shift();
  }
  function restore() {
    const s = undo.pop();
    if (!s) return;
    if (s.version !== state.version) setVersion(s.version, false);
    state.target = s.target;
    state.weight = s.weight;
    state.marks.length = Math.min(state.marks.length, s.marks);
    drawMarks();
    requestSolve();
    scheduleScan();
  }

  const BRUSH_R = [0, 0.5, 1.2, 2.3];
  function paintAt(mx: number, my: number, tool: DrawTool) {
    const s = size();
    const r = BRUSH_R[state.brush];
    const lay = layout(state.version, state.level);
    const v = tool === 'ink' ? 1 : tool === 'paper' ? 0 : -1;
    for (let y = Math.floor(my - r); y <= Math.ceil(my + r); y++)
      for (let x = Math.floor(mx - r); x <= Math.ceil(mx + r); x++) {
        if (x < 0 || y < 0 || x >= s || y >= s) continue;
        if (
          Math.hypot(x + 0.5 - mx, y + 0.5 - my) > r + 0.01 &&
          !(r <= 0.5 && x === Math.floor(mx) && y === Math.floor(my))
        )
          continue;
        const c = y * s + x;
        const role = lay.role[c];
        if (role !== ROLE.data && role !== ROLE.check && role !== ROLE.remainder) continue;
        state.target[c] = v;
        state.weight[c] = v < 0 ? 0 : 2 + centreBias(x, y, s);
      }
  }
  const centreBias = (x: number, y: number, s: number) => 0.2 * (1 - Math.hypot(x - s / 2, y - s / 2) / s);

  function placeStamp(st: Stamp, cx: number, cy: number) {
    const s = size();
    const lay = layout(state.version, state.level);
    const x0 = Math.round(cx - st.w / 2);
    const y0 = Math.round(cy - st.h / 2);
    for (let y = 0; y < st.h; y++)
      for (let x = 0; x < st.w; x++) {
        const v = st.cells[y * st.w + x];
        if (v < 0) continue;
        const X = x0 + x;
        const Y = y0 + y;
        if (X < 0 || Y < 0 || X >= s || Y >= s) continue;
        const c = Y * s + X;
        const role = lay.role[c];
        if (role !== ROLE.data && role !== ROLE.check && role !== ROLE.remainder) continue;
        state.target[c] = v;
        state.weight[c] = 2 + centreBias(X, Y, s) + (v === 1 ? 0.3 : 0);
      }
  }

  // ---- pointer ----
  let drawing = false;
  let last: [number, number] | null = null;
  let liveMark: Mark | null = null;
  const MARK_W: Record<string, number[]> = { marker: [0, 0.9, 1.6, 2.6], whiteout: [0, 1.4, 2.4, 3.6] };
  const COFFEE_R = [0, 4.5, 7, 10];
  const TEAR_R = [0, 2.6, 4.2, 6.5];

  codeCanvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (!solved) return;
    const [mx, my] = moduleAt(e);
    if (state.placing) {
      snapshot();
      placeStamp(state.placing, mx, my);
      requestSolve();
      return;
    }
    if (state.mode === 'photo') return;
    try {
      codeCanvas.setPointerCapture(e.pointerId);
    } catch {}
    if (state.mode === 'draw') {
      snapshot();
      drawing = true;
      last = [mx, my];
      paintAt(mx, my, state.drawTool);
      requestSolve();
    } else {
      snapshot();
      const t = state.defaceTool;
      if (t === 'coffee') {
        state.marks.push({
          kind: 'coffee',
          x: mx,
          y: my,
          r: COFFEE_R[state.brush],
          seed: (Math.random() * 2 ** 31) | 0,
        });
        drawMarks();
        scheduleScan(0);
      } else if (t === 'tear') {
        state.marks.push({ kind: 'tear', x: mx, y: my, r: TEAR_R[state.brush], seed: (Math.random() * 2 ** 31) | 0 });
        drawMarks();
        scheduleScan(0);
      } else {
        drawing = true;
        liveMark = { kind: t, w: MARK_W[t][state.brush], pts: [mx, my] };
        drawMarks();
      }
    }
  });
  codeCanvas.addEventListener('pointermove', (e) => {
    const [mx, my] = moduleAt(e);
    showHover(mx, my);
    if (state.placing) {
      ghostAt = [mx, my];
      drawCode();
      return;
    }
    if (!drawing) return;
    if (state.mode === 'draw' && last) {
      const [lx, ly] = last;
      const steps = Math.max(1, Math.ceil(Math.hypot(mx - lx, my - ly) * 2));
      for (let i = 1; i <= steps; i++)
        paintAt(lx + ((mx - lx) * i) / steps, ly + ((my - ly) * i) / steps, state.drawTool);
      last = [mx, my];
      requestSolve();
    } else if (liveMark && 'pts' in liveMark) {
      const p = liveMark.pts;
      if (Math.hypot(mx - p[p.length - 2], my - p[p.length - 1]) > 0.25) {
        p.push(mx, my);
        drawMarks();
        scheduleScan(80);
      }
    }
  });
  const end = () => {
    if (liveMark) {
      state.marks.push(liveMark);
      liveMark = null;
      drawMarks();
      scheduleScan(0);
    }
    drawing = false;
    last = null;
  };
  codeCanvas.addEventListener('pointerup', end);
  codeCanvas.addEventListener('pointercancel', end);
  codeCanvas.addEventListener('pointerleave', () => {
    hoverEl.textContent = '';
    if (state.placing) {
      ghostAt = null;
      drawCode();
    }
  });

  const hoverEl = $<HTMLElement>('[data-hover]');
  function showHover(mx: number, my: number) {
    const s = size();
    const x = Math.floor(mx);
    const y = Math.floor(my);
    if (x < 0 || y < 0 || x >= s || y >= s || !solved) {
      hoverEl.textContent = '';
      return;
    }
    const lay = layout(state.version, state.level);
    const c = y * s + x;
    const r = lay.role[c];
    const names: Record<number, string> = {
      [ROLE.finder]: 'corner square',
      [ROLE.timing]: 'timing line',
      [ROLE.alignment]: 'alignment mark',
      [ROLE.format]: 'format strip: level and mask',
      [ROLE.version]: 'version block',
      [ROLE.dark]: 'the module that is always dark',
      [ROLE.remainder]: 'leftover bit nobody reads',
    };
    let what = names[r] ?? '';
    if (r === ROLE.data || r === ROLE.check) {
      let g = 0;
      for (let i = 0; i < lay.bitModule.length; i++)
        if (lay.bitModule[i] === c) {
          g = i >> 3;
          break;
        }
      const b = lay.cwBlock[g];
      if (r === ROLE.check) what = `check bit, block ${b + 1}`;
      else if (solved.message[c]) what = `message bit, block ${b + 1}`;
      else what = `spare bit, block ${b + 1}`;
    }
    hoverEl.textContent = `Column ${x + 1}, row ${y + 1}: ${what}`;
  }

  // ---- controls ----
  const msgInput = $<HTMLInputElement>('[data-msg]');
  msgInput.value = state.text;
  let textTimer = 0;
  msgInput.addEventListener('input', () => {
    clearTimeout(textTimer);
    textTimer = window.setTimeout(() => {
      const t = msgInput.value;
      if (new TextEncoder().encode(t).length > byteCapacity(state.version, state.level)) {
        bytesEl.dataset.over = 'true';
        bytesEl.textContent = `${new TextEncoder().encode(t).length} of ${byteCapacity(state.version, state.level)} bytes: make the code bigger or the message shorter`;
        return;
      }
      state.text = t;
      requestMask();
      updateReadouts();
    }, 180);
  });

  const versionInput = $<HTMLInputElement>('[data-version]');
  function setVersion(v: number, keep = true) {
    const old = size();
    const oldTarget = state.target;
    const oldWeight = state.weight;
    state.version = v;
    const s = size();
    const t = new Int8Array(s * s).fill(-1);
    const w = new Float32Array(s * s);
    if (keep) {
      // Resample the picture to the new grid, centred.
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const ox = Math.floor(((x + 0.5) / s) * old);
          const oy = Math.floor(((y + 0.5) / s) * old);
          t[y * s + x] = oldTarget[oy * old + ox];
          w[y * s + x] = oldWeight[oy * old + ox];
        }
      // Marks scale with the code.
      const k = s / old;
      for (const m of state.marks) {
        if ('pts' in m) {
          for (let i = 0; i < m.pts.length; i++) m.pts[i] *= k;
          m.w *= k;
        } else {
          m.x *= k;
          m.y *= k;
          m.r *= k;
        }
      }
    }
    state.target = t;
    state.weight = w;
    versionInput.value = String(v);
    if (state.photo) photoToTarget();
    resize();
    if (new TextEncoder().encode(state.text).length > byteCapacity(v, state.level)) {
      state.text = state.text.slice(0, byteCapacity(v, state.level));
      msgInput.value = state.text;
    }
    requestMask();
    updateReadouts();
  }
  versionInput.addEventListener('input', () => setVersion(Number(versionInput.value)));

  const levelButtons = $$<HTMLButtonElement>('[data-level]');
  function setLevel(l: Level) {
    if (new TextEncoder().encode(state.text).length > byteCapacity(state.version, l)) return;
    state.level = l;
    levelButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.level === l)));
    requestMask();
    updateReadouts();
  }
  levelButtons.forEach((b) => {
    b.title = `Can repair about ${LEVEL_SHARE[b.dataset.level as Level]} of the code`;
    b.addEventListener('click', () => setLevel(b.dataset.level as Level));
  });

  const spendInput = $<HTMLInputElement>('[data-spend]');
  spendInput.value = String(Math.round(state.spend * 100));
  spendInput.addEventListener('input', () => {
    state.spend = Number(spendInput.value) / 100;
    updateReadouts();
    requestSolve();
  });

  // Modes and tools.
  const tabs = $$<HTMLButtonElement>('[data-mode]');
  const panes = $$<HTMLElement>('[data-pane]');
  function setMode(m: Mode) {
    state.mode = m;
    state.placing = null;
    syncStampButtons();
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === m)));
    panes.forEach((p) => (p.hidden = p.dataset.pane !== m));
    root.dataset.mode = m;
    if (m !== 'photo') stopCamera(true);
    drawCode();
    updateReadouts();
  }
  tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode as Mode)));

  const drawTools = $$<HTMLButtonElement>('[data-draw-tool]');
  const defaceTools = $$<HTMLButtonElement>('[data-deface-tool]');
  function syncTools() {
    drawTools.forEach((b) =>
      b.setAttribute('aria-pressed', String(!state.placing && b.dataset.drawTool === state.drawTool)),
    );
    defaceTools.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.defaceTool === state.defaceTool)));
  }
  drawTools.forEach((b) =>
    b.addEventListener('click', () => {
      state.drawTool = b.dataset.drawTool as DrawTool;
      state.placing = null;
      syncStampButtons();
      syncTools();
      drawCode();
    }),
  );
  defaceTools.forEach((b) =>
    b.addEventListener('click', () => {
      state.defaceTool = b.dataset.defaceTool as DefaceTool;
      syncTools();
    }),
  );
  const brushButtons = $$<HTMLButtonElement>('[data-brush]');
  brushButtons.forEach((b) =>
    b.addEventListener('click', () => {
      state.brush = Number(b.dataset.brush);
      brushButtons.forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.brush === b.dataset.brush)));
      if (state.placing && placingName) {
        state.placing =
          placingName === 'letters'
            ? lettering(lettersInput.value, state.brush >= 3 ? 2 : 1)
            : makeStamp(placingName, state.brush);
        drawCode();
      }
    }),
  );

  // Stamps.
  let placingName: StampName | 'letters' | null = null;
  const stampButtons = $$<HTMLButtonElement>('[data-stamp-name]');
  function syncStampButtons() {
    if (!state.placing) placingName = null;
    stampButtons.forEach((b) => b.setAttribute('aria-pressed', String(placingName === b.dataset.stampName)));
    lettersButton.setAttribute('aria-pressed', String(placingName === 'letters'));
    syncTools();
    root.dataset.placing = String(!!state.placing);
  }
  stampButtons.forEach((b) => {
    const name = b.dataset.stampName as StampName;
    const icon = b.querySelector('canvas')!;
    const st = makeStamp(name, 2);
    const k = 2;
    icon.width = st.w * k;
    icon.height = st.h * k;
    const ic = icon.getContext('2d')!;
    for (let y = 0; y < st.h; y++)
      for (let x = 0; x < st.w; x++)
        if (st.cells[y * st.w + x] === 1) {
          ic.fillStyle = INK;
          ic.fillRect(x * k, y * k, k, k);
        }
    b.addEventListener('click', () => {
      if (placingName === name) {
        state.placing = null;
      } else {
        placingName = name;
        state.placing = makeStamp(name, state.brush);
      }
      syncStampButtons();
      drawCode();
    });
  });
  const lettersInput = $<HTMLInputElement>('[data-letters]');
  const lettersButton = $<HTMLButtonElement>('[data-letters-stamp]');
  lettersButton.addEventListener('click', () => {
    const st = lettering(lettersInput.value, state.brush >= 3 ? 2 : 1);
    if (!st) {
      lettersInput.focus();
      return;
    }
    placingName = 'letters';
    state.placing = st;
    syncStampButtons();
    drawCode();
  });
  lettersInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lettersButton.click();
  });

  $<HTMLButtonElement>('[data-clear]').addEventListener('click', () => {
    snapshot();
    state.target.fill(-1);
    state.weight.fill(0);
    state.photo = null;
    requestSolve();
  });
  $<HTMLButtonElement>('[data-clean]').addEventListener('click', () => {
    if (!state.marks.length) return;
    snapshot();
    state.marks.length = 0;
    drawMarks();
    scheduleScan(0);
  });
  $<HTMLButtonElement>('[data-undo]').addEventListener('click', restore);
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      restore();
    }
    if (e.key === 'Escape' && state.placing) {
      state.placing = null;
      syncStampButtons();
      drawCode();
    }
  });

  const anatomyButton = $<HTMLButtonElement>('[data-anatomy]');
  anatomyButton.addEventListener('click', () => {
    state.anatomy = !state.anatomy;
    anatomyButton.setAttribute('aria-pressed', String(state.anatomy));
    legend.hidden = !state.anatomy;
    root.dataset.anatomy = String(state.anatomy);
    drawCode();
  });

  // ---- photos and the camera ----
  const photoCanvas = document.createElement('canvas');
  const pctx = photoCanvas.getContext('2d', { willReadFrequently: true })!;
  function photoToTarget() {
    if (!state.photo) return;
    const s = size();
    const src = state.photo as HTMLVideoElement | HTMLImageElement | ImageBitmap;
    const iw = 'videoWidth' in src ? src.videoWidth : src.width;
    const ih = 'videoHeight' in src ? src.videoHeight : src.height;
    if (!iw || !ih) return;
    photoCanvas.width = s;
    photoCanvas.height = s;
    // Cover-fit, mirrored for the camera so it behaves like a mirror.
    const k = Math.max(s / iw, s / ih);
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.fillStyle = '#fff';
    pctx.fillRect(0, 0, s, s);
    if (cameraLive || frozenFromCamera) {
      pctx.translate(s, 0);
      pctx.scale(-1, 1);
    }
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(src, (s - iw * k) / 2, (s - ih * k) / 2, iw * k, ih * k);
    const data = pctx.getImageData(0, 0, s, s).data;
    const g = new Float32Array(s * s);
    for (let i = 0; i < s * s; i++)
      g[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    // Stretch to the 4th and 96th percentiles, then the exposure slider.
    const sorted = Array.from(g).sort((a, b) => a - b);
    const lo = sorted[Math.floor(s * s * 0.04)];
    const hi = sorted[Math.floor(s * s * 0.96)];
    const gamma = Math.pow(2, -state.exposure * 1.6);
    for (let i = 0; i < s * s; i++)
      g[i] = Math.pow(Math.min(1, Math.max(0, (g[i] - lo) / Math.max(0.05, hi - lo))), gamma);
    // Edge strength for priority, before dithering.
    const edge = new Float32Array(s * s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const at = (xx: number, yy: number) =>
          g[Math.min(s - 1, Math.max(0, yy)) * s + Math.min(s - 1, Math.max(0, xx))];
        edge[y * s + x] = Math.hypot(at(x + 1, y) - at(x - 1, y), at(x, y + 1) - at(x, y - 1));
      }
    // Floyd-Steinberg to ink and paper.
    const work = g.slice();
    const lay = layout(state.version, state.level);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const c = y * s + x;
        const v = work[c] < 0.5 ? 0 : 1;
        const err = work[c] - v;
        if (x + 1 < s) work[c + 1] += (err * 7) / 16;
        if (y + 1 < s) {
          if (x > 0) work[c + s - 1] += (err * 3) / 16;
          work[c + s] += (err * 5) / 16;
          if (x + 1 < s) work[c + s + 1] += err / 16;
        }
        const r = lay.role[c];
        if (r !== ROLE.data && r !== ROLE.check && r !== ROLE.remainder) {
          state.target[c] = -1;
          state.weight[c] = 0;
          continue;
        }
        state.target[c] = v ? 0 : 1;
        state.weight[c] = 0.4 + edge[c] * 1.5 + centreBias(x, y, s) * 2 + Math.abs(g[c] - 0.5) * 0.3;
      }
  }

  const fileInput = $<HTMLInputElement>('[data-file]');
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      stopCamera(false);
      frozenFromCamera = false;
      snapshot();
      state.photo = bmp;
      photoToTarget();
      requestSolve();
    } catch {
      photoNote.textContent = 'That file didn’t open as a picture.';
    }
    fileInput.value = '';
  });
  const exposureInput = $<HTMLInputElement>('[data-exposure]');
  exposureInput.addEventListener('input', () => {
    state.exposure = Number(exposureInput.value);
    if (state.photo && !cameraLive) {
      photoToTarget();
      requestSolve();
    }
  });

  const cameraButton = $<HTMLButtonElement>('[data-camera]');
  const photoNote = $<HTMLElement>('[data-photo-note]');
  let stream: MediaStream | null = null;
  let cameraLive = false;
  let frozenFromCamera = false;
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      photoNote.textContent = 'This browser has no camera access.';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false,
      });
    } catch {
      photoNote.textContent = 'No camera, or permission was refused.';
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    snapshot();
    cameraLive = true;
    frozenFromCamera = false;
    state.photo = video;
    cameraButton.textContent = 'Hold this frame';
    cameraButton.setAttribute('aria-pressed', 'true');
    photoNote.textContent = 'Live. Scan the screen with another phone while you pull faces.';
    pump();
  }
  function stopCamera(keepFrame: boolean) {
    if (!cameraLive) return;
    cameraLive = false;
    if (keepFrame && stream) {
      // Keep the last frame as a still.
      const s = document.createElement('canvas');
      s.width = video.videoWidth;
      s.height = video.videoHeight;
      s.getContext('2d')!.drawImage(video, 0, 0);
      state.photo = s;
      frozenFromCamera = true;
    } else if (!keepFrame) {
      if (state.photo === video) state.photo = null;
    }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    cameraButton.textContent = 'Use your camera';
    cameraButton.setAttribute('aria-pressed', 'false');
    photoNote.textContent = keepFrame ? 'Held. Draw over it, or deface it.' : '';
  }
  cameraButton.addEventListener('click', () => (cameraLive ? stopCamera(true) : startCamera()));
  function pump() {
    if (!cameraLive) return;
    if (!busy && !needSolve && video.readyState >= 2) {
      photoToTarget();
      requestSolve();
    }
    requestAnimationFrame(pump);
  }

  // ---- downloads ----
  $<HTMLButtonElement>('[data-png]').addEventListener('click', () => {
    if (!solved) return;
    const px = 12;
    const c = document.createElement('canvas');
    c.width = c.height = (size() + QUIET * 2) * px;
    composite(c.getContext('2d')!, px, true);
    c.toBlob((blob) => blob && download(blob, 'still-scans.png'), 'image/png');
  });
  $<HTMLButtonElement>('[data-svg]').addEventListener('click', () => {
    if (!solved) return;
    const s = size();
    const n = s + QUIET * 2;
    let d = '';
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) if (solved.modules[y * s + x]) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    download(new Blob([svg], { type: 'image/svg+xml' }), 'still-scans.svg');
  });
  function download(blob: Blob, name: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- start ----
  levelButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.level === state.level)));
  brushButtons.forEach((o) => o.setAttribute('aria-pressed', String(Number(o.dataset.brush) === state.brush)));
  versionInput.value = String(state.version);
  syncTools();
  setMode('draw');
  resize();
  new ResizeObserver(() => resize()).observe(stage);

  // The opening picture: a plain code first, then a cat stamped into it, so the
  // spare bits visibly shuffle to make room before anyone draws.
  const openCat = () => {
    // Placed so the middle alignment mark falls on the cat's cheek, not its eye.
    placeStamp(makeStamp('cat', 2), size() * 0.32, size() * 0.54);
    requestSolve();
  };
  if (reduceMotion || debug) openCat();
  else opening = () => setTimeout(openCat, 650);
  requestMask();
  updateReadouts();

  if (debug) {
    (window as unknown as Record<string, unknown>).stillscans = {
      state,
      get solved() {
        return solved;
      },
      get read() {
        return lastRead;
      },
      scan,
      settle: () =>
        new Promise<void>((res) => {
          const check = () => (!busy && !needSolve && !needMask ? res() : setTimeout(check, 20));
          check();
        }),
      solve: requestSolve,
      setMode,
      setVersion,
      setLevel,
      setText: (t: string) => {
        msgInput.value = t;
        state.text = t;
        requestMask();
        updateReadouts();
      },
      setSpend: (v: number) => {
        state.spend = v;
        spendInput.value = String(Math.round(v * 100));
        updateReadouts();
        requestSolve();
      },
      stamp: (name: StampName, sz: number, x: number, y: number) => {
        placeStamp(makeStamp(name, sz), x, y);
        requestSolve();
      },
      letters: (t: string, sc: number, x: number, y: number) => {
        const st = lettering(t, sc);
        if (st) placeStamp(st, x, y);
        requestSolve();
      },
      clear: () => {
        state.target.fill(-1);
        state.weight.fill(0);
        requestSolve();
      },
      mark: (m: Mark) => {
        state.marks.push(m);
        drawMarks();
        return scan();
      },
      clean: () => {
        state.marks.length = 0;
        drawMarks();
        return scan();
      },
      photo: (src: CanvasImageSource) => {
        state.photo = src;
        photoToTarget();
        requestSolve();
      },
      anatomy: (on: boolean) => {
        if (state.anatomy !== on) anatomyButton.click();
      },
      hover: (x: number, y: number) => {
        state.placing = makeStamp('heart', state.brush);
        ghostAt = [x, y];
        drawCode();
      },
    };
  }
}
