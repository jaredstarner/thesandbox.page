// /breadboard/: the bench. Wires the board, the solver, the drawing, and the controls together.

import { BOARD, HOLE, holeAt, holeNear, stripHoles, stripName, type Hole } from './_board';
import {
  CAP_VALUES,
  ECAP_VALUES,
  FOOTPRINT,
  LED_COLORS,
  RES_VALUES,
  TWO_LEAD,
  WIRE_COLORS,
  compile,
  fmtFarads,
  fmtOhms,
  footprintCentre,
  isTwoLead,
  occupancy,
  partName,
  pinHoles,
  rotate,
  type Compiled,
  type Kind,
  type Part,
} from './_parts';
import { PROJECTS } from './_projects';
import { Renderer, ecapRadius, type Ghost, type PartLook, type Probe, type Scene } from './_render';
import { Sim, ldrResistance, type MeterMode } from './_sim';
import { Sound } from './_sound';

const STORE = 'breadboard.v1';
const LUX_ON = 350;
const LUX_OFF = 2;

type Pt = { x: number; y: number };

type Drag =
  | {
      t: 'move';
      id: string;
      orig: Part;
      start: Pt;
      leg: -1 | 0 | 1;
      cand: Part | null;
      ok: boolean;
      remove: boolean;
      moved: boolean;
    }
  | { t: 'new'; part: Part; cand: Part | null; ok: boolean; over: boolean; moved: boolean; start: Pt | null }
  | { t: 'wire'; from: Hole; cand: Part | null; ok: boolean }
  | { t: 'press'; id: string; start: Pt; kind: 'button' | 'ldr' }
  | { t: 'turn'; id: string; centre: Pt; startAng: number; startPos: number }
  | { t: 'probe'; idx: number };

class Bench {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private r: Renderer;
  private sim = new Sim();
  private sound = new Sound();
  private parts: Part[] = [];
  private nextId = 1;
  private selected: string | null = null;
  private power = true;
  private lamp = true;
  private pressed = new Set<string>();
  private covered = new Set<string>();
  private meterMode: MeterMode = 'off';
  private probes: Probe[] = [
    { color: 'red', hole: null, free: null },
    { color: 'black', hole: null, free: null },
  ];
  private compiled: Compiled | null = null;
  private needCompile = true;
  private drag: Drag | null = null;
  private armed: Kind | null = null;
  private armedRot = 0;
  private hover: Pt | null = null;
  private hoverHole: Hole | null = null;
  private looks = new Map<string, PartLook>();
  private last = 0;
  private uiClock = 0;
  private wireColor = 'blue';
  private undoStack: string[] = [];
  private project = 'chaser';
  private statusTimer = 0;
  private debug = new URLSearchParams(location.search).has('debug');
  private paused = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.canvas = root.querySelector<HTMLCanvasElement>('.bench')!;
    this.r = new Renderer(this.canvas);
    const css = getComputedStyle(root);
    this.r.mono = css.getPropertyValue('--font-bb-mono').trim() || 'monospace';
    this.r.sans = css.getPropertyValue('--font-bb-sans').trim() || 'sans-serif';
    this.restore();
    this.bindCanvas();
    this.bindControls();
    this.bindTray();
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.resize();
    document.fonts?.ready.then(() => {
      this.r.dirty = true;
      this.drawIcons();
    });
    document.addEventListener('visibilitychange', () => {
      this.paused = document.hidden;
      if (document.hidden) this.sound.suspend();
      else this.sound.resume();
    });
    root.dataset.ready = '1';
    if (this.debug) this.exposeDebug();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------------------------------------------------------------- board state

  private restore() {
    const params = new URLSearchParams(location.search);
    const want = params.get('project');
    if (want && PROJECTS.some((p) => p.id === want)) {
      this.loadProject(want, false);
      return;
    }
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const saved = JSON.parse(raw) as { parts: Part[]; project: string };
        if (Array.isArray(saved.parts) && saved.parts.every((p) => typeof p.kind === 'string')) {
          this.parts = saved.parts;
          this.project = saved.project ?? 'blank';
          this.nextId = 1 + Math.max(0, ...this.parts.map((p) => Number(p.id.slice(1)) || 0));
          this.showProject(this.project);
          return;
        }
      }
    } catch {}
    this.loadProject('chaser', false);
  }

  private save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ parts: this.parts, project: this.project }));
    } catch {}
  }

  private snapshot() {
    this.undoStack.push(JSON.stringify(this.parts));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.syncUndo();
  }

  private undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.parts = JSON.parse(s) as Part[];
    if (this.selected && !this.parts.some((p) => p.id === this.selected)) this.selected = null;
    this.changed();
    this.syncUndo();
  }

  private syncUndo() {
    const b = this.root.querySelector<HTMLButtonElement>('[data-act="undo"]');
    if (b) b.disabled = this.undoStack.length === 0;
  }

  private loadProject(id: string, record = true) {
    const proj = PROJECTS.find((p) => p.id === id);
    if (!proj) return;
    if (record) this.snapshot();
    this.parts = proj.parts.map((p, i) => ({ ...p, id: `p${i + 1}` }));
    this.nextId = this.parts.length + 1;
    this.sim = new Sim();
    this.selected = null;
    this.pressed.clear();
    this.covered.clear();
    this.project = id;
    this.showProject(id);
    this.changed();
  }

  private showProject(id: string) {
    const proj = PROJECTS.find((p) => p.id === id) ?? PROJECTS[0];
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-project]'))
      b.setAttribute('aria-current', String(b.dataset.project === proj.id));
    const card = this.root.querySelector<HTMLElement>('.card');
    if (!card) return;
    card.querySelector('h2')!.textContent = proj.title;
    card.querySelector('.note')!.textContent = proj.note;
    const ul = card.querySelector('ul')!;
    ul.replaceChildren(
      ...proj.tries.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      }),
    );
  }

  /** Something on the board changed: rebuild the netlist, redraw, and store the board. */
  private changed() {
    this.needCompile = true;
    this.r.dirty = true;
    this.save();
    this.refreshInspector(true);
  }

  private part(id: string | null): Part | undefined {
    return id ? this.parts.find((p) => p.id === id) : undefined;
  }

  private recompile() {
    this.compiled = compile(this.parts, {
      power: this.power,
      lux: this.lamp ? LUX_ON : LUX_OFF,
      covered: this.covered,
      pressed: this.pressed,
      meter: { mode: this.meterMode, red: this.probes[0].hole, black: this.probes[1].hole },
    });
    this.sim.load(this.compiled.circuit);
    this.needCompile = false;
  }

  /** Parameter-only changes (a held button, a turned trimmer) reach the solver without a rebuild. */
  private updateParams() {
    if (!this.compiled) return;
    for (const d of this.compiled.circuit.devices) {
      if (d.t === 'button') d.pressed = this.pressed.has(d.id);
      else if (d.t === 'ldr') d.lux = (this.lamp ? LUX_ON : LUX_OFF) * (this.covered.has(d.id) ? 0.03 : 1);
      else if (d.t === 'pot') d.pos = this.part(d.id)?.pos ?? 0.5;
      else if (d.t === 'battery') d.on = this.power;
    }
  }

  // ---------------------------------------------------------------- frame

  private loop(t: number) {
    const dt = this.last ? Math.min(0.05, Math.max(0, (t - this.last) / 1000)) : 0.016;
    this.last = t;
    if (!this.paused) {
      if (this.needCompile) this.recompile();
      this.sim.run(dt);
      this.handleEvents();
      this.readLooks();
      this.sim.resetAverages();
    }
    this.r.frame(this.scene(), dt);
    this.uiClock += dt;
    if (this.uiClock > 0.12) {
      this.uiClock = 0;
      this.refreshInspector(false);
      this.refreshMeter();
    }
    requestAnimationFrame((tt) => this.loop(tt));
  }

  private readLooks() {
    let buzz = 0;
    for (const p of this.parts) {
      const st = this.sim.states.get(p.id);
      const look: PartLook = this.looks.get(p.id) ?? {
        glow: 0,
        dead: false,
        scorched: false,
        pressed: false,
        covered: false,
      };
      const wasDead = look.dead,
        wasScorched = look.scorched;
      look.pressed = this.pressed.has(p.id);
      look.covered = this.covered.has(p.id);
      if (st && st.tSum > 0) {
        this.lastReadings.set(p.id, { i: st.iSum / st.tSum, v: st.vSum / st.tSum, a: st.aSum / st.tSum });
        look.dead = st.dead;
        look.scorched = st.scorched;
        if (p.kind === 'led') {
          const i = st.iSum / st.tSum;
          look.glow = i < 5e-6 ? 0 : Math.min(1.4, Math.max(0, (Math.log10(i) + 5.3) / (Math.log10(0.02) + 5.3)));
        } else if (p.kind === 'buzzer') {
          look.glow = st.aSum / st.tSum;
          buzz = Math.max(buzz, look.glow);
        }
      }
      if (look.dead !== wasDead || look.scorched !== wasScorched) this.r.dirty = true;
      this.looks.set(p.id, look);
    }
    this.sound.setBuzz(this.power ? buzz : 0);
  }

  private handleEvents() {
    for (const ev of this.sim.events) {
      const p = this.part(ev.id);
      const where = p ? this.centreOf(p) : null;
      switch (ev.type) {
        case 'pop':
          if (where) {
            this.r.flash(where.x, where.y);
            this.r.smoke(where.x, where.y, 14, 0.6);
          }
          this.sound.pop(1);
          {
            const peak = this.sim.states.get(ev.id)?.peak ?? 0;
            this.status(
              `The ${p ? lower(partName(p)) : 'LED'} burnt out with ${Math.round(peak * 1000)} mA through it; it is rated for 20 mA.`,
            );
          }
          break;
        case 'scorch':
          if (where) this.r.smoke(where.x, where.y, 10, 0.25);
          if (p?.kind === 'res') {
            const st = this.sim.states.get(p.id);
            const w = st ? st.heat / 250 : 0;
            this.status(`The ${partName(p)} is cooking: about ${w.toFixed(1)} W in a quarter-watt part.`);
          }
          break;
        case 'burn':
          if (where) {
            this.r.flash(where.x, where.y);
            this.r.smoke(where.x, where.y, 22, 0.75);
          }
          this.sound.pop(0.8);
          this.status(`The ${p ? lower(partName(p)) : 'part'} burnt through.`);
          break;
        case 'burst':
          if (where) this.r.smoke(where.x, where.y, 18, 0.35);
          this.sound.pop(1.2);
          this.status('The capacitor’s vent split open. Electrolytics only take voltage one way round.');
          break;
        case 'fuse':
          this.sound.pop(0.5);
          this.status('The meter’s fuse blew. On mA its probes are nearly a short circuit.');
          this.root.querySelector<HTMLElement>('[data-act="fuse"]')!.hidden = false;
          break;
        case 'short': {
          const a = this.sim.batteryCurrent;
          this.status(`Short circuit: the battery is pushing ${a.toFixed(1)} A and getting hot.`);
          const bat = this.parts.find((q) => q.kind === 'battery');
          const h = bat?.a ? HOLE.get(bat.a) : undefined;
          if (h) this.r.smoke(h.x - 3, h.y + 4, 6, 0.3);
          break;
        }
      }
      this.r.dirty = true;
    }
    this.sim.events = [];
  }

  private centreOf(p: Part): Pt | null {
    const hs = pinHoles(p).filter((h): h is Hole => !!h);
    if (!hs.length) return null;
    if (FOOTPRINT[p.kind] && p.at) {
      const at = HOLE.get(p.at)!;
      const [x, y] = footprintCentre(p.kind, at.x, at.y, p.rot ?? 0);
      return { x, y };
    }
    return { x: hs.reduce((s, h) => s + h.x, 0) / hs.length, y: hs.reduce((s, h) => s + h.y, 0) / hs.length };
  }

  private scene(): Scene {
    let hoverStrip: Hole[] = [];
    let hoverNet: Hole[] = [];
    const showHover = !this.drag || this.drag.t === 'wire' || this.drag.t === 'probe';
    const hh = showHover ? this.hoverHole : null;
    if (hh) {
      hoverStrip = stripHoles(hh.strip);
      if (this.compiled) {
        const root = this.compiled.rootOfStrip[hh.strip];
        const strips = new Set<number>();
        this.compiled.rootOfStrip.forEach((r, i) => {
          if (r === root && i !== hh.strip) strips.add(i);
        });
        for (const s of strips) hoverNet = hoverNet.concat(stripHoles(s));
      }
    }
    let ghost: Ghost | null = null;
    const d = this.drag;
    if (d && (d.t === 'move' || d.t === 'new' || d.t === 'wire') && d.cand) {
      ghost = { part: d.cand, pins: this.ghostPins(d.cand), ok: d.ok };
      if (d.t === 'move' && d.remove) ghost.pins = ghost.pins.map((p) => ({ ...p, ok: false }));
    }
    const hp = !this.drag && this.hover ? this.hit(this.hover) : null;
    return {
      parts:
        this.drag?.t === 'move' && this.drag.moved
          ? this.parts.filter((p) => p.id !== (this.drag as { id: string }).id)
          : this.parts,
      looks: this.looks,
      selected: this.selected,
      hoverHole: hh,
      hoverStrip,
      hoverNet,
      hoverPart: hp?.part.id ?? null,
      ghost,
      lamp: this.lamp,
      probes: this.probes,
      meterOn: this.meterMode !== 'off',
    };
  }

  private ghostPins(p: Part): Ghost['pins'] {
    const occ = occupancy(this.parts, this.drag?.t === 'move' ? this.drag.id : undefined);
    return pinHoles(p).map((h, i) => {
      if (h) return { x: h.x, y: h.y, ok: !occ.has(h.id) };
      const pt = this.hover ?? { x: 0, y: 0 };
      return { x: pt.x + i, y: pt.y, ok: false };
    });
  }

  // ---------------------------------------------------------------- sizing

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    this.r.resize(rect.width, rect.height, Math.min(3, window.devicePixelRatio || 1));
  }

  // ---------------------------------------------------------------- hit testing

  private hit(pt: Pt): { part: Part; zone: 'body' | 'leg0' | 'leg1' | 'actuator' | 'rotor' } | null {
    const near = (h: Hole | null | undefined, r: number) => !!h && Math.hypot(h.x - pt.x, h.y - pt.y) < r;
    // A selected part's legs come first, so a covered leg can still be taken.
    const sel = this.part(this.selected);
    if (sel && isTwoLead(sel.kind)) {
      const [a, b] = pinHoles(sel);
      if (near(a, 0.4)) return { part: sel, zone: 'leg0' };
      if (near(b, 0.4)) return { part: sel, zone: 'leg1' };
    }
    const order: Record<Kind, number> = {
      battery: 6,
      buzzer: 5,
      led: 4,
      ecap: 4,
      wire: 3,
      button: 2,
      pot: 2,
      npn: 2,
      ne555: 2,
      cd4017: 2,
      res: 1,
      ldr: 1,
      cap: 1,
    };
    const list = [...this.parts].sort((a, b) => order[b.kind] - order[a.kind]);
    for (const p of list) {
      const hs = pinHoles(p);
      if (p.kind === 'battery') {
        if (near(hs[0], 0.45)) return { part: p, zone: 'leg0' };
        if (near(hs[1], 0.45)) return { part: p, zone: 'leg1' };
        continue;
      }
      if (isTwoLead(p.kind)) {
        const [a, b] = hs;
        if (!a || !b) continue;
        const mx = (a.x + b.x) / 2,
          my = (a.y + b.y) / 2;
        const span = Math.hypot(a.x - b.x, a.y - b.y);
        if (p.kind === 'wire' || p.kind === 'res' || p.kind === 'cap') {
          if (span > 1.5 && near(a, 0.38)) return { part: p, zone: 'leg0' };
          if (span > 1.5 && near(b, 0.38)) return { part: p, zone: 'leg1' };
          if (p.kind === 'res' && span < 2.95) {
            if (Math.hypot(pt.x - a.x, pt.y - a.y) < 0.55) return { part: p, zone: 'body' };
          }
          if (segDist(pt, a, b) < (p.kind === 'wire' ? 0.3 : 0.48)) return { part: p, zone: 'body' };
          continue;
        }
        const rad = p.kind === 'led' ? 1.12 : p.kind === 'ecap' ? ecapRadius(p.value ?? 10e-6) : 1.0;
        if (Math.hypot(pt.x - mx, pt.y - my) < rad) return { part: p, zone: 'body' };
        if (span > 2.2 && near(a, 0.38)) return { part: p, zone: 'leg0' };
        if (span > 2.2 && near(b, 0.38)) return { part: p, zone: 'leg1' };
        continue;
      }
      const at = p.at ? HOLE.get(p.at) : undefined;
      if (!at) continue;
      // Into the part's own frame.
      const [lx, ly] = rotate(pt.x - at.x, pt.y - at.y, -(p.rot ?? 0) + 4);
      switch (p.kind) {
        case 'button':
          if (Math.hypot(lx - 1, ly + 1.5) < 0.85) return { part: p, zone: 'actuator' };
          if (Math.abs(lx - 1) < 1.25 && Math.abs(ly + 1.5) < 1.25) return { part: p, zone: 'body' };
          break;
        case 'pot':
          if (Math.hypot(lx - 1, ly + 0.85) < 0.95) return { part: p, zone: 'rotor' };
          if (Math.abs(lx - 1) < 1.35 && ly > -2.1 && ly < 0.4) return { part: p, zone: 'body' };
          break;
        case 'npn':
          if (lx > -0.1 && lx < 2.1 && ly > -0.6 && ly < 0.65) return { part: p, zone: 'body' };
          break;
        case 'ne555':
        case 'cd4017': {
          const half = (FOOTPRINT[p.kind]?.length ?? 8) / 2;
          if (lx > -0.7 && lx < half - 0.3 && ly > -2.9 && ly < -0.1) return { part: p, zone: 'body' };
          break;
        }
        case 'buzzer':
          if (Math.hypot(lx - 1.5, ly) < 2.4) return { part: p, zone: 'body' };
          break;
      }
    }
    return null;
  }

  private probeAt(sx: number, sy: number): number {
    if (this.meterMode === 'off') return -1;
    for (let i = 1; i >= 0; i--) {
      const tip = this.r.probeTip(this.probes[i]);
      const parked = !this.probes[i].hole;
      const ang = parked ? Math.PI * 0.02 : Math.PI * 0.2;
      // Anywhere along the needle and handle.
      for (let d = 0; d <= 80; d += 6) {
        const x = tip.x + Math.cos(ang) * d,
          y = tip.y + Math.sin(ang) * d;
        if (Math.hypot(sx - x, sy - y) < 11) return i;
      }
    }
    return -1;
  }

  // ---------------------------------------------------------------- pointer

  private local(e: PointerEvent): { sx: number; sy: number; pt: Pt } {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left,
      sy = e.clientY - rect.top;
    return { sx, sy, pt: this.r.toWorld(sx, sy) };
  }

  private bindCanvas() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.sound.unlock();
      if (e.button !== 0) return;
      const { sx, sy, pt } = this.local(e);
      this.hover = pt;
      this.hoverHole = holeNear(pt.x, pt.y);
      try {
        c.setPointerCapture(e.pointerId);
      } catch {}
      c.focus({ preventScroll: true });
      const pi = this.probeAt(sx, sy);
      if (pi >= 0) {
        this.drag = { t: 'probe', idx: pi };
        this.probes[pi].free = pt;
        return;
      }
      if (this.armed) {
        const part = this.template(this.armed, this.armedRot);
        const d: Drag = { t: 'new', part, cand: null, ok: false, over: true, moved: true, start: null };
        this.drag = d;
        this.updateNew(d, pt);
        return;
      }
      const h = this.hit(pt);
      if (h) {
        const p = h.part;
        if (h.zone === 'actuator' || (p.kind === 'ldr' && h.zone === 'body')) {
          this.drag = { t: 'press', id: p.id, start: pt, kind: p.kind === 'ldr' ? 'ldr' : 'button' };
          (p.kind === 'ldr' ? this.covered : this.pressed).add(p.id);
          this.updateParams();
          this.select(p.id);
          return;
        }
        if (h.zone === 'rotor') {
          const at = HOLE.get(p.at!)!;
          const [rx, ry] = rotate(1, -0.85, p.rot ?? 0);
          const centre = { x: at.x + rx, y: at.y + ry };
          this.snapshot();
          this.drag = {
            t: 'turn',
            id: p.id,
            centre,
            startAng: Math.atan2(pt.y - centre.y, pt.x - centre.x),
            startPos: p.pos ?? 0.5,
          };
          this.select(p.id);
          return;
        }
        this.drag = {
          t: 'move',
          id: p.id,
          orig: { ...p },
          start: pt,
          leg: h.zone === 'leg0' ? 0 : h.zone === 'leg1' ? 1 : -1,
          cand: null,
          ok: false,
          remove: false,
          moved: false,
        };
        this.select(p.id);
        return;
      }
      const hole = holeNear(pt.x, pt.y, 0.45);
      if (hole && !occupancy(this.parts).has(hole.id)) {
        this.drag = { t: 'wire', from: hole, cand: null, ok: false };
        this.select(null);
        return;
      }
      this.select(null);
    });
    c.addEventListener('pointermove', (e) => {
      const { pt } = this.local(e);
      this.hover = pt;
      this.hoverHole = holeNear(pt.x, pt.y);
      const d = this.drag;
      if (!d) {
        this.cursor(pt, e);
        return;
      }
      switch (d.t) {
        case 'probe':
          this.probes[d.idx].free = pt;
          break;
        case 'press':
          if (Math.hypot(pt.x - d.start.x, pt.y - d.start.y) > 0.75) {
            (d.kind === 'ldr' ? this.covered : this.pressed).delete(d.id);
            this.updateParams();
            const p = this.part(d.id)!;
            this.drag = {
              t: 'move',
              id: p.id,
              orig: { ...p },
              start: d.start,
              leg: -1,
              cand: null,
              ok: false,
              remove: false,
              moved: false,
            };
            this.updateMove(this.drag, pt);
          }
          break;
        case 'turn': {
          const p = this.part(d.id);
          if (!p) break;
          let da = Math.atan2(pt.y - d.centre.y, pt.x - d.centre.x) - d.startAng;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          p.pos = Math.min(1, Math.max(0, d.startPos + da / ((270 * Math.PI) / 180)));
          d.startPos = p.pos;
          d.startAng = Math.atan2(pt.y - d.centre.y, pt.x - d.centre.x);
          this.updateParams();
          this.r.dirty = true;
          break;
        }
        case 'move':
          this.updateMove(d, pt);
          break;
        case 'new':
          this.updateNew(d, pt);
          break;
        case 'wire': {
          const h = holeNear(pt.x, pt.y);
          if (h && h.id !== d.from.id) {
            d.cand = { id: 'ghost', kind: 'wire', a: d.from.id, b: h.id, color: this.autoColor(d.from, h) };
            d.ok = this.valid(d.cand);
          } else {
            d.cand = null;
            d.ok = false;
          }
          break;
        }
      }
    });
    const end = (e: PointerEvent, cancel: boolean) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      const { pt } = this.local(e);
      switch (d.t) {
        case 'probe': {
          const pr = this.probes[d.idx];
          pr.free = null;
          const h = cancel ? null : holeNear(pt.x, pt.y, 0.6);
          pr.hole = h ? h.id : null;
          this.needCompile = true;
          if (h) this.sound.click();
          break;
        }
        case 'press':
          (d.kind === 'ldr' ? this.covered : this.pressed).delete(d.id);
          this.updateParams();
          break;
        case 'turn':
          this.save();
          break;
        case 'move':
          if (!d.moved || cancel) break;
          if (d.remove) {
            this.snapshot();
            if (d.orig.kind === 'battery') {
              const p = this.part(d.id)!;
              if (d.leg === 0) p.a = undefined;
              else p.b = undefined;
              this.status('Battery lead unplugged.');
            } else {
              this.parts = this.parts.filter((p) => p.id !== d.id);
              this.sim.forget(d.id);
              if (this.selected === d.id) this.selected = null;
            }
            this.changed();
          } else if (d.ok && d.cand) {
            this.snapshot();
            const i = this.parts.findIndex((p) => p.id === d.id);
            this.parts[i] = { ...d.cand, id: d.id };
            this.sound.click();
            this.changed();
          }
          break;
        case 'new':
          if (!cancel && d.ok && d.cand && d.over) {
            this.snapshot();
            const p = { ...d.cand, id: `p${this.nextId++}` };
            this.parts.push(p);
            this.select(p.id);
            this.sound.click();
            this.changed();
            if (this.armed) this.arm(null);
          } else if (!d.moved && d.start) {
            // A tap on a drawer part arms it for placing with a tap on the board.
            this.arm(d.part.kind);
          }
          break;
        case 'wire':
          if (!cancel && d.ok && d.cand) {
            this.snapshot();
            const p = { ...d.cand, id: `p${this.nextId++}` };
            this.parts.push(p);
            this.sound.click();
            this.changed();
          }
          break;
      }
      this.r.dirty = true;
    };
    c.addEventListener('pointerup', (e) => end(e, false));
    c.addEventListener('pointercancel', (e) => end(e, true));
    c.addEventListener('pointerleave', () => {
      if (!this.drag) {
        this.hover = null;
        this.hoverHole = null;
      }
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      this.key(e);
    });
  }

  private key(e: KeyboardEvent) {
    this.sound.unlock();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      const d = this.drag;
      if (d && d.t === 'new') {
        d.part = this.rotateTemplate(d.part);
        if (this.hover) this.updateNew(d, this.hover);
      } else if (this.armed) {
        this.armedRot = (this.armedRot + 1) % 4;
      } else this.rotateSelected();
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selected) {
        this.removeSelected();
        e.preventDefault();
      }
    } else if (e.key === 'Escape') {
      this.arm(null);
      this.select(null);
    }
  }

  private cursor(pt: Pt, e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const pi = this.probeAt(e.clientX - rect.left, e.clientY - rect.top);
    let cur = 'default';
    if (pi >= 0) cur = 'grab';
    else if (this.armed) cur = 'copy';
    else {
      const h = this.hit(pt);
      if (h) cur = h.zone === 'actuator' || h.zone === 'rotor' || h.part.kind === 'ldr' ? 'pointer' : 'grab';
      else if (this.hoverHole && !occupancy(this.parts).has(this.hoverHole.id)) cur = 'crosshair';
    }
    this.canvas.style.cursor = cur;
  }

  private autoColor(a: Hole, b: Hole): string {
    for (const h of [a, b]) {
      if (h.rail === 'T+' || h.rail === 'B+') return 'red';
      if (h.rail === 'T-' || h.rail === 'B-') return 'black';
    }
    return this.wireColor;
  }

  // ---------------------------------------------------------------- placing and moving

  private template(kind: Kind, rot = 0): Part {
    const p: Part = { id: 'ghost', kind };
    if (kind === 'res') p.value = 1e3;
    if (kind === 'led') p.color = 'red';
    if (kind === 'ecap') p.value = 10e-6;
    if (kind === 'cap') p.value = 100e-9;
    if (kind === 'wire') p.color = this.wireColor;
    if (kind === 'pot') p.pos = 0.5;
    p.rot = rot;
    return p;
  }

  private rotateTemplate(p: Part): Part {
    return { ...p, rot: ((p.rot ?? 0) + 1) % 4 };
  }

  /** Candidate placement for a new part with its middle under the pointer. */
  private updateNew(d: Extract<Drag, { t: 'new' }>, pt: Pt) {
    d.over = pt.x > BOARD.x0 - 0.5 && pt.x < BOARD.x1 + 0.5 && pt.y > BOARD.y0 - 0.5 && pt.y < BOARD.y1 + 0.5;
    if (d.start && Math.hypot(pt.x - d.start.x, pt.y - d.start.y) > 0.3) d.moved = true;
    const p = d.part;
    if (isTwoLead(p.kind)) {
      const def = TWO_LEAD[p.kind]!.def;
      const [dx, dy] = rotate(def[0], def[1], p.rot ?? 0);
      const a = holeNear(pt.x - dx / 2, pt.y - dy / 2, 0.8);
      const b = a ? (holeAt(a.x + dx, a.y + dy) ?? holeNear(a.x + dx, a.y + dy, 0.8)) : null;
      d.cand = { ...p, a: a?.id, b: b?.id };
    } else {
      const [cx, cy] = footprintCentre(p.kind, 0, 0, p.rot ?? 0);
      const at = holeNear(pt.x - cx, pt.y - cy, 0.8);
      d.cand = { ...p, at: at?.id };
    }
    d.ok = d.over && this.valid(d.cand);
  }

  private updateMove(d: Extract<Drag, { t: 'move' }>, pt: Pt) {
    const dx = pt.x - d.start.x,
      dy = pt.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < 0.3) return;
    d.moved = true;
    const o = d.orig;
    d.remove = !(pt.x > BOARD.x0 - 0.4 && pt.x < BOARD.x1 + 0.4 && pt.y > BOARD.y0 - 0.4 && pt.y < BOARD.y1 + 0.4);
    if (isTwoLead(o.kind)) {
      const ha = o.a ? HOLE.get(o.a) : undefined,
        hb = o.b ? HOLE.get(o.b) : undefined;
      if (d.leg >= 0 || o.kind === 'battery') {
        const h = holeNear(pt.x, pt.y, 0.8);
        d.cand = d.leg === 1 ? { ...o, b: h?.id } : { ...o, a: h?.id };
      } else if (ha && hb) {
        const na = holeNear(ha.x + dx, ha.y + dy, 0.8);
        const nb = na
          ? (holeAt(na.x + (hb.x - ha.x), na.y + (hb.y - ha.y)) ?? holeNear(hb.x + dx, hb.y + dy, 0.8))
          : null;
        d.cand = { ...o, a: na?.id, b: nb?.id };
      }
    } else {
      const at = o.at ? HOLE.get(o.at) : undefined;
      if (at) {
        const n = holeNear(at.x + dx, at.y + dy, 0.8);
        d.cand = { ...o, at: n?.id };
      }
    }
    d.ok = !d.remove && !!d.cand && this.valid(d.cand, d.id);
  }

  private valid(p: Part, except?: string): boolean {
    const hs = pinHoles(p);
    if (hs.some((h) => !h)) return false;
    const occ = occupancy(this.parts, except);
    if (hs.some((h) => occ.has(h!.id))) return false;
    if (new Set(hs.map((h) => h!.id)).size !== hs.length) return false;
    const lim = TWO_LEAD[p.kind];
    if (lim) {
      const d = Math.hypot(hs[0]!.x - hs[1]!.x, hs[0]!.y - hs[1]!.y);
      if (d < lim.min - 1e-6 || d > lim.max + 1e-6) return false;
    }
    return true;
  }

  private rotateSelected() {
    const p = this.part(this.selected);
    if (!p) return;
    if (isTwoLead(p.kind)) {
      if (p.kind === 'battery') return;
      this.snapshot();
      [p.a, p.b] = [p.b, p.a];
      this.changed();
      return;
    }
    const at = p.at ? HOLE.get(p.at) : undefined;
    if (!at) return;
    const rot = ((p.rot ?? 0) + 1) % 4;
    const [cx, cy] = footprintCentre(p.kind, at.x, at.y, p.rot ?? 0);
    const [ox, oy] = footprintCentre(p.kind, 0, 0, rot);
    const tries = [holeNear(cx - ox, cy - oy, 0.8), at];
    for (const h of tries) {
      if (!h) continue;
      const cand = { ...p, at: h.id, rot };
      if (this.valid(cand, p.id)) {
        this.snapshot();
        Object.assign(p, cand);
        this.changed();
        return;
      }
    }
    this.status('No room to turn it there.');
  }

  private removeSelected() {
    const p = this.part(this.selected);
    if (!p || p.kind === 'battery') return;
    this.snapshot();
    this.parts = this.parts.filter((q) => q.id !== p.id);
    this.sim.forget(p.id);
    this.selected = null;
    this.changed();
  }

  private select(id: string | null) {
    if (this.selected === id) return;
    this.selected = id;
    this.r.dirty = true;
    this.refreshInspector(true);
    this.root.dataset.selected = id ? '1' : '';
  }

  private arm(kind: Kind | null) {
    this.armed = this.armed === kind ? null : kind;
    this.armedRot = 0;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-part]'))
      b.setAttribute('aria-pressed', String(b.dataset.part === this.armed));
    if (this.armed)
      this.status(
        `Tap a hole to place the ${lower(partName(this.template(this.armed)))}. R turns it; Esc puts it away.`,
      );
  }

  // ---------------------------------------------------------------- controls

  private bindControls() {
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel);
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-project]')) {
      b.addEventListener('click', () => {
        this.loadProject(b.dataset.project!);
        if (matchMedia('(max-width: 899px)').matches) this.root.dataset.sheet = 'book';
      });
    }
    q<HTMLButtonElement>('[data-act="power"]')?.addEventListener('click', (e) => {
      this.power = !this.power;
      (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(this.power));
      this.updateParams();
    });
    q<HTMLButtonElement>('[data-act="lamp"]')?.addEventListener('click', (e) => {
      this.lamp = !this.lamp;
      (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(this.lamp));
      this.root.dataset.lamp = this.lamp ? 'on' : 'off';
      this.updateParams();
    });
    q<HTMLButtonElement>('[data-act="sound"]')?.addEventListener('click', (e) => {
      this.sound.unlock();
      this.sound.setEnabled(!this.sound.enabled);
      (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(this.sound.enabled));
    });
    q<HTMLButtonElement>('[data-act="undo"]')?.addEventListener('click', () => this.undo());
    q<HTMLButtonElement>('[data-act="fuse"]')?.addEventListener('click', (e) => {
      this.sim.meterFuse = true;
      (e.currentTarget as HTMLElement).hidden = true;
      this.status('New fuse fitted.');
    });
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      b.addEventListener('click', () => {
        this.sound.unlock();
        this.meterMode = b.dataset.mode as MeterMode;
        for (const o of this.root.querySelectorAll<HTMLButtonElement>('[data-mode]'))
          o.setAttribute('aria-checked', String(o === b));
        this.root.dataset.meter = this.meterMode;
        this.needCompile = true;
        this.refreshMeter();
      });
    }
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-sheet-open]')) {
      b.addEventListener('click', () => {
        const want = b.dataset.sheetOpen!;
        this.root.dataset.sheet = this.root.dataset.sheet === want ? '' : want;
      });
    }
    // Inspector controls.
    const insp = q<HTMLElement>('.inspect');
    insp?.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      const p = this.part(this.selected);
      if (!p || t.name !== 'value') return;
      this.snapshot();
      p.value = Number(t.value);
      this.sim.forget(p.id);
      this.changed();
    });
    insp?.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!t) return;
      const p = this.part(this.selected);
      if (!p) return;
      if (t.dataset.color) {
        this.snapshot();
        p.color = t.dataset.color;
        if (p.kind === 'wire') this.wireColor = t.dataset.color;
        this.sim.forget(p.id);
        this.changed();
      } else if (t.dataset.do === 'rotate') this.rotateSelected();
      else if (t.dataset.do === 'remove') this.removeSelected();
      else if (t.dataset.do === 'replace') {
        this.snapshot();
        this.sim.forget(p.id);
        this.changed();
        this.status(`Fitted a new ${lower(partName(p))}.`);
      }
    });
  }

  private bindTray() {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-part]')) {
      b.addEventListener('pointerdown', (e) => {
        this.sound.unlock();
        if (e.button !== 0) return;
        const kind = b.dataset.part as Kind;
        try {
          b.setPointerCapture(e.pointerId);
        } catch {}
        this.drag = {
          t: 'new',
          part: this.template(kind),
          cand: null,
          ok: false,
          over: false,
          moved: false,
          start: { x: e.clientX, y: e.clientY },
        };
      });
      b.addEventListener('pointermove', (e) => {
        const d = this.drag;
        if (!d || d.t !== 'new' || !d.start) return;
        if (!d.moved && Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 6) return;
        d.moved = true;
        const { pt } = this.local(e);
        this.hover = pt;
        this.hoverHole = holeNear(pt.x, pt.y);
        const rect = this.canvas.getBoundingClientRect();
        const inside =
          e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
        const saved = d.start;
        d.start = null;
        this.updateNew(d, pt);
        d.start = saved;
        d.over = d.over && inside;
        d.ok = d.ok && inside;
      });
      const finish = (e: PointerEvent, cancel: boolean) => {
        const d = this.drag;
        if (!d || d.t !== 'new') return;
        this.drag = null;
        if (!d.moved) {
          if (!cancel) this.arm(d.part.kind);
          return;
        }
        if (!cancel && d.ok && d.cand && d.over) {
          this.snapshot();
          const p = { ...d.cand, id: `p${this.nextId++}` };
          this.parts.push(p);
          this.select(p.id);
          this.sound.click();
          this.changed();
        }
        void e;
        this.r.dirty = true;
      };
      b.addEventListener('pointerup', (e) => finish(e, false));
      b.addEventListener('pointercancel', (e) => finish(e, true));
    }
    for (const s of this.root.querySelectorAll<HTMLButtonElement>('[data-wire]')) {
      s.addEventListener('click', () => {
        this.wireColor = s.dataset.wire!;
        for (const o of this.root.querySelectorAll<HTMLButtonElement>('[data-wire]'))
          o.setAttribute('aria-pressed', String(o === s));
      });
    }
  }

  private drawIcons() {
    for (const cv of this.root.querySelectorAll<HTMLCanvasElement>('canvas[data-icon]')) {
      this.r.drawIcon(cv, cv.dataset.icon as Kind);
    }
  }

  // ---------------------------------------------------------------- readouts

  private status(msg: string) {
    const el = this.root.querySelector<HTMLElement>('.status');
    if (!el) return;
    el.textContent = msg;
    el.dataset.show = '1';
    clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      el.dataset.show = '';
    }, 6000);
  }

  private lastReadings = new Map<string, { i: number; v: number; a: number }>();

  private refreshInspector(rebuild: boolean) {
    const box = this.root.querySelector<HTMLElement>('.inspect');
    if (!box) return;
    const p = this.part(this.selected);
    box.dataset.empty = p ? '' : '1';
    const name = box.querySelector<HTMLElement>('.i-name')!;
    const read = box.querySelector<HTMLElement>('.i-read')!;
    const ctl = box.querySelector<HTMLElement>('.i-ctl')!;
    if (!p) {
      name.textContent = 'Nothing selected';
      read.replaceChildren();
      if (rebuild) ctl.replaceChildren();
      return;
    }
    name.textContent = partName(p);
    if (rebuild) ctl.replaceChildren(...this.controlsFor(p));
    const rows = this.readingsFor(p);
    read.replaceChildren(
      ...rows.flatMap(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        return [dt, dd];
      }),
    );
  }

  private controlsFor(p: Part): HTMLElement[] {
    const out: HTMLElement[] = [];
    const values: Partial<Record<Kind, number[]>> = { res: RES_VALUES, ecap: ECAP_VALUES, cap: CAP_VALUES };
    const list = values[p.kind];
    if (list) {
      const label = document.createElement('label');
      label.className = 'i-value';
      label.textContent = 'Value ';
      const sel = document.createElement('select');
      sel.name = 'value';
      for (const v of list) {
        const o = document.createElement('option');
        o.value = String(v);
        o.textContent = p.kind === 'res' ? fmtOhms(v) : fmtFarads(v);
        if (Math.abs(v - (p.value ?? 0)) < v * 1e-6) o.selected = true;
        sel.append(o);
      }
      label.append(sel);
      out.push(label);
    }
    const colors = p.kind === 'led' ? LED_COLORS : p.kind === 'wire' ? WIRE_COLORS : null;
    if (colors) {
      const row = document.createElement('div');
      row.className = 'swatches';
      for (const c of colors) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.color = c;
        b.className = `sw-${c}`;
        b.setAttribute('aria-label', c);
        b.setAttribute('aria-pressed', String(p.color === c));
        row.append(b);
      }
      out.push(row);
    }
    const acts = document.createElement('div');
    acts.className = 'i-acts';
    const mk = (label: string, act: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.do = act;
      b.textContent = label;
      acts.append(b);
    };
    if (FOOTPRINT[p.kind]) mk('Turn', 'rotate');
    else if (p.kind === 'led' || p.kind === 'ecap' || p.kind === 'buzzer') mk('Turn round', 'rotate');
    const st = this.sim.states.get(p.id);
    if (st?.dead || st?.scorched) mk('Fit a new one', 'replace');
    if (p.kind !== 'battery') mk('Remove', 'remove');
    out.push(acts);
    return out;
  }

  private readingsFor(p: Part): [string, string][] {
    const st = this.sim.states.get(p.id);
    const r = this.lastReadings.get(p.id);
    const V = (v: number) => `${v.toFixed(Math.abs(v) < 10 ? 2 : 1)} V`;
    const A = (i: number) => {
      const a = Math.abs(i);
      if (a < 1e-6) return '0 mA';
      if (a < 1e-3) return `${(i * 1e6).toFixed(0)} µA`;
      if (a < 1) return `${(i * 1e3).toFixed(a < 0.01 ? 2 : 1)} mA`;
      return `${i.toFixed(2)} A`;
    };
    const W = (w: number) => (Math.abs(w) < 1 ? `${(w * 1e3).toFixed(0)} mW` : `${w.toFixed(2)} W`);
    if (!st || !r) return [['State', 'Not connected']];
    const i = r.i,
      v = r.v;
    switch (p.kind) {
      case 'res':
        return [
          ['Across it', V(v)],
          ['Through it', A(i)],
          ['Heat', W(r.a) + (st.dead ? ', burnt open' : st.scorched ? ', scorched' : '')],
        ];
      case 'led':
        return [
          ['Through it', A(i)],
          ['Across it', V(v)],
          [
            'State',
            st.dead ? 'Burnt out' : i > 0.035 ? 'Overdriven' : i > 5e-5 ? 'Lit' : v < -0.1 ? 'Reversed' : 'Dark',
          ],
        ];
      case 'ecap':
      case 'cap':
        return [
          ['Charged to', V(v)],
          ['Current', A(i)],
          ...(p.kind === 'ecap'
            ? ([['State', st.dead ? 'Vented' : v < -0.5 ? 'Reverse biased' : 'Fine']] as [string, string][])
            : []),
        ];
      case 'ldr':
        return [
          ['Light', `${Math.round((this.lamp ? LUX_ON : LUX_OFF) * (this.covered.has(p.id) ? 0.03 : 1))} lux`],
          ['Resistance', fmtOhms(Math.round(r.a / 10) * 10 || ldrResistance(LUX_ON))],
          ['Across it', V(v)],
        ];
      case 'button':
        return [
          ['State', this.pressed.has(p.id) ? 'Pressed' : 'Open'],
          ['Across it', V(v)],
          ['Through it', A(i)],
        ];
      case 'pot':
        return [
          ['Wiper', `${Math.round((p.pos ?? 0.5) * 100)}%`],
          ['Pin 1 to wiper', fmtOhms(Math.max(1, Math.round((p.pos ?? 0.5) * 10e3)))],
          ['Wiper to pin 3', fmtOhms(Math.max(1, Math.round((1 - (p.pos ?? 0.5)) * 10e3)))],
        ];
      case 'npn': {
        const ib = r.a;
        const vce = v;
        const state = st.dead ? 'Burnt out' : i < 1e-6 ? 'Off' : vce < 0.25 ? 'Saturated (fully on)' : 'Amplifying';
        return [
          ['Collector', A(i)],
          ['Base', A(ib)],
          ['C to E', V(vce)],
          ['State', state],
        ];
      }
      case 'ne555': {
        const f = st.period > 0 ? 1 / st.period : 0;
        return [
          ['Supply', V(v)],
          ['Output', !st.powered ? 'Unpowered' : r.a > 0.5 ? 'High' : 'Low'],
          [
            'Frequency',
            f > 0 ? `${f.toFixed(f < 10 ? 2 : 0)} Hz, ${Math.round((st.highTime / st.period) * 100)}% high` : 'Steady',
          ],
        ];
      }
      case 'cd4017':
        return [
          ['Supply', V(v)],
          ['Count', st.powered ? `${st.count} (Q${st.count} high)` : 'Unpowered'],
        ];
      case 'buzzer':
        return [
          ['Across it', V(v)],
          ['Sounding', v > 1.5 ? 'Yes' : 'No'],
        ];
      case 'battery':
        return [
          ['Terminals', V(v)],
          ['Supplying', A(i)],
          ['Switch', this.power ? 'On' : 'Off'],
        ];
      case 'wire':
        return [];
    }
  }

  private refreshMeter() {
    const lcd = this.root.querySelector<HTMLElement>('.lcd');
    if (!lcd) return;
    const unit = lcd.querySelector<HTMLElement>('.unit')!;
    let text: string;
    let u: string;
    const m = this.meterMode;
    const v = this.sim.meterReading;
    const placed = this.probes[0].hole && this.probes[1].hole;
    if (m === 'off') {
      text = '';
      u = '';
    } else if (m === 'V') {
      text = !placed ? '0.00' : fmtDigits(v);
      u = 'V';
    } else if (m === 'mA') {
      text = !placed || !this.sim.meterFuse ? '0.00' : fmtDigits(v * 1e3);
      u = 'mA';
    } else {
      if (!placed || !isFinite(v) || v > 20e6 || v < 0) {
        text = ' OL';
        u = 'Ω';
      } else if (v >= 1e6) {
        text = fmtDigits(v / 1e6);
        u = 'MΩ';
      } else if (v >= 1e3) {
        text = fmtDigits(v / 1e3);
        u = 'kΩ';
      } else {
        text = fmtDigits(v);
        u = 'Ω';
      }
    }
    setLcd(lcd, text);
    unit.textContent = u;
    const where = this.root.querySelector<HTMLElement>('.m-where');
    if (where) {
      const name = (h: string | null) => (h ? `${h.replace('-', '−')} (${stripName(HOLE.get(h)!.strip)})` : 'resting');
      where.textContent =
        m === 'off'
          ? 'Turn the dial to measure.'
          : `Red: ${name(this.probes[0].hole)}. Black: ${name(this.probes[1].hole)}.`;
    }
  }

  private exposeDebug() {
    const api: Record<string, unknown> = {
      load: (id: string) => this.loadProject(id),
      select: (id: string | null) => this.select(id),
      press: (id: string, on: boolean) => {
        const p = this.part(id);
        if (!p) return;
        (p.kind === 'ldr' ? this.covered : this.pressed)[on ? 'add' : 'delete'](id);
        this.updateParams();
      },
      run: (seconds: number) => {
        if (this.needCompile) this.recompile();
        this.sim.run(seconds);
        this.handleEvents();
      },
      setLamp: (on: boolean) => {
        if (this.lamp !== on) this.root.querySelector<HTMLButtonElement>('[data-act="lamp"]')?.click();
      },
      setPower: (on: boolean) => {
        if (this.power !== on) this.root.querySelector<HTMLButtonElement>('[data-act="power"]')?.click();
      },
      meter: (mode: MeterMode, red: string | null, black: string | null) => {
        this.root.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)?.click();
        this.probes[0].hole = red;
        this.probes[1].hole = black;
        this.needCompile = true;
      },
      setPart: (id: string, patch: Partial<Part>) => {
        const p = this.part(id);
        if (!p) return;
        Object.assign(p, patch);
        this.sim.forget(id);
        this.changed();
      },
      add: (p: Omit<Part, 'id'>) => {
        const part = { ...p, id: `p${this.nextId++}` } as Part;
        this.parts.push(part);
        this.changed();
        return part.id;
      },
      remove: (id: string) => {
        this.parts = this.parts.filter((q) => q.id !== id);
        this.changed();
      },
      view: () => this.r.view,
      screenOf: (hole: string) => {
        const h = HOLE.get(hole)!;
        return this.r.toScreen(h.x, h.y);
      },
    };
    Object.defineProperties(api, {
      parts: { get: () => this.parts },
      sim: { get: () => this.sim },
      looks: { get: () => this.looks },
      readings: { get: () => this.lastReadings },
    });
    (window as unknown as { breadboard: unknown }).breadboard = api;
  }
}

/** Lower-case a part name for the middle of a sentence, keeping LED, NE555, and the like. */
function lower(name: string): string {
  return /^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Up to four digits with the decimal point placed to fit, like a 3½-digit meter's autorange. */
function fmtDigits(v: number): string {
  const a = Math.abs(v);
  let s: string;
  if (a >= 1000) s = Math.min(9999, Math.round(a)).toString();
  else if (a >= 100) s = a.toFixed(1);
  else if (a >= 10) s = a.toFixed(2);
  else s = a.toFixed(2);
  return (v < 0 && a >= 0.005 ? '-' : '') + s;
}

const SEGS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  O: 'abcdef',
  L: 'fed',
  ' ': '',
};

/** Light the LCD's seven-segment digits for a string like "-12.34". */
function setLcd(lcd: HTMLElement, text: string) {
  const digits = [...lcd.querySelectorAll<SVGGElement>('[data-digit]')];
  let neg = false;
  let t = text;
  if (t.startsWith('-')) {
    neg = true;
    t = t.slice(1);
  }
  const chars: { c: string; dp: boolean }[] = [];
  for (const ch of t) {
    if (ch === '.' && chars.length) chars[chars.length - 1].dp = true;
    else chars.push({ c: ch, dp: false });
  }
  while (chars.length < digits.length) chars.unshift({ c: ' ', dp: false });
  const shown = chars.slice(-digits.length);
  digits.forEach((g, i) => {
    const { c, dp } = shown[i];
    const on = SEGS[c] ?? '';
    for (const seg of g.querySelectorAll<SVGElement>('[data-seg]'))
      seg.dataset.on = String(on.includes(seg.dataset.seg!));
    const d = g.querySelector<SVGElement>('[data-dp]');
    if (d) d.dataset.on = String(dp);
  });
  const minus = lcd.querySelector<SVGElement>('[data-minus]');
  if (minus) minus.dataset.on = String(neg);
}

const root = document.querySelector<HTMLElement>('.bb');
if (root) new Bench(root);
