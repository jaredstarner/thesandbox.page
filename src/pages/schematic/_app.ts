// Page controller for /schematic/: load a network, lay it out in a worker, play the straightening,
// and let the visitor scrub it, pan and zoom, read stations, redraw at other angles, look up another
// city live from OpenStreetMap, and take the result away as an SVG.

import { CITIES } from './_cities';
import { drawFrame, getFamily, markerSizes, setFamily, toSVG, type View } from './_draw';
import { buildGraph, type Graph } from './_graph';
import { labelExtent, NAME_SIZE, placeLabels, type Label } from './_labels';
import { layout, type Angle, type LayoutInput } from './_layout';
import { fromOverpass, type Network } from './_osm';
import { prepare, type Prepared } from './_prep';
import { frameAt, frameBounds, type Frame, type Scene } from './_scene';

const loaders = import.meta.glob<Network>('./_data/*.json', { import: 'default' });

interface Drawing {
  title: string;
  system: string;
  net: Network;
  g: Graph;
  prep: Prepared;
  marker: Float64Array;
  truthKeys: Float32Array;
  scene: Scene | null;
  final: Frame | null;
  labels: Label[] | null;
  /** The finished diagram's bounds with its names. */
  extent: [number, number, number, number] | null;
}

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const GEOCODER = 'https://geocoding-api.open-meteo.com/v1/search';
const PLAY_MS = 6200;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Black or white text, whichever reads on a line colour. */
function inkOn(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
  return l > 0.36 ? '#15171a' : '#ffffff';
}

export function start(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const stage = q<HTMLElement>('[data-stage]');
  const canvas = q<HTMLCanvasElement>('[data-canvas]');
  const note = q<HTMLElement>('[data-note]');
  const card = q<HTMLElement>('[data-card]');
  const hint = q<HTMLElement>('[data-hint]');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const cityHead = q<HTMLElement>('[data-city]');
  const systemHead = q<HTMLElement>('[data-system]');
  const legend = q<HTMLOListElement>('[data-legend]');
  const scaleBox = q<HTMLElement>('[data-scale]');
  const scaleBar = q<HTMLElement>('[data-scale-bar]');
  const scaleText = q<HTMLElement>('[data-scale-text]');
  const morph = q<HTMLInputElement>('[data-morph]');
  const cityButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-city-id]')];
  const angleButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-angle]')];
  const redraw = q<HTMLButtonElement>('[data-redraw]');
  const download = q<HTMLButtonElement>('[data-download]');
  const moved = q<HTMLInputElement>('[data-moved]');
  const search = q<HTMLFormElement>('[data-search]');
  const searchInput = search.querySelector('input')!;
  const searchStatus = q<HTMLElement>('[data-search-status]');
  const ctx = canvas.getContext('2d')!;

  const resolved = getComputedStyle(root).getPropertyValue('--font-schematic');
  setFamily(resolved ? `${resolved}, ${getFamily()}` : getFamily());

  let angle: Angle = 45;
  let seed = 7;
  let drawing: Drawing | null = null;
  let u = 0;
  let truthAlpha = 0;
  let hover: number | null = null;
  let pinned: number | null = null;
  let userView: View | null = null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let playing: { from: number; t0: number; dur: number } | null = null;
  /** On a small screen, a glide in to where the names can be read once the diagram is finished. */
  let glide: { from: View; to: View; t0: number } | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };
  /** After the glide in, keep the zoom hint up until the visitor touches the map. */
  let hintAfterGlide = false;
  const coarse = matchMedia('(pointer: coarse)');
  let raf = 0;
  let job = 0;
  let loadToken = 0;

  // A worker when there is one; otherwise the layout runs here.
  let worker: Worker | null = null;
  const pending = new Map<number, (frames: Float32Array[]) => void>();
  try {
    worker = new Worker(new URL('./_worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; frames: Float32Array[] }>) => {
      const done = pending.get(e.data.id);
      pending.delete(e.data.id);
      done?.(e.data.frames);
    };
  } catch {
    worker = null;
  }
  const runLayout = (input: LayoutInput): Promise<Float32Array[]> => {
    const id = ++job;
    if (!worker) return Promise.resolve(layout(input).frames);
    return new Promise((resolve) => {
      pending.set(id, resolve);
      worker!.postMessage({ id, input });
    });
  };

  // --- View ---

  const fit = (b: [number, number, number, number], padX: number, padY: number): View => {
    const bw = Math.max(1, b[2] - b[0] + padX * 2);
    const bh = Math.max(1, b[3] - b[1] + padY * 2);
    const m = width < 600 ? 14 : 26;
    const scale = Math.min((width - m * 2) / bw, (height - m * 2) / bh);
    return {
      scale,
      ox: width / 2 - ((b[0] + b[2]) / 2) * scale,
      oy: height / 2 - ((b[1] + b[3]) / 2) * scale,
    };
  };

  const autoView = (): View | null => {
    if (!drawing) return null;
    const tb = boundsOf(drawing.prep.truth, drawing.g);
    const vt = fit(tb, 1, 1);
    if (!drawing.final) return vt;
    const fb = drawing.extent ?? frameBounds(drawing.final);
    const vf = fit(fb, drawing.extent ? 0.5 : 3.2, drawing.extent ? 0.5 : 1.2);
    const k = ease(Math.min(1, u * 1.15));
    return { scale: vt.scale + (vf.scale - vt.scale) * k, ox: vt.ox + (vf.ox - vt.ox) * k, oy: vt.oy + (vf.oy - vt.oy) * k };
  };

  const boundsOf = (pts: Float64Array, g: Graph): [number, number, number, number] => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let s = 0; s < g.names.length; s++) {
      if (!g.served[s].length) continue;
      minX = Math.min(minX, pts[s * 2]);
      maxX = Math.max(maxX, pts[s * 2]);
      minY = Math.min(minY, pts[s * 2 + 1]);
      maxY = Math.max(maxY, pts[s * 2 + 1]);
    }
    return [minX, minY, maxX, maxY];
  };

  const currentView = () => userView ?? autoView() ?? { scale: 1, ox: 0, oy: 0 };

  const startGlide = (now: number) => {
    if (!drawing?.final || userView || width >= 600) return;
    const from = autoView();
    if (!from || NAME_SIZE * from.scale >= 7) return;
    // Centre on the middle of the busiest stations, at a scale where names are about 8.5 px.
    const busy: number[] = [];
    drawing.g.served.forEach((lines, s) => {
      if (lines.length > 1 && !Number.isNaN(drawing!.final!.pos[s * 2])) busy.push(s);
    });
    const pool = busy.length ? busy : drawing.g.keys;
    const xs = pool.map((s) => drawing!.final!.pos[s * 2]).sort((a, b) => a - b);
    const ys = pool.map((s) => drawing!.final!.pos[s * 2 + 1]).sort((a, b) => a - b);
    const cx = xs[xs.length >> 1];
    const cy = ys[ys.length >> 1];
    const scale = 8.5 / NAME_SIZE;
    glide = { from, to: { scale, ox: width / 2 - cx * scale, oy: height / 2 - cy * scale }, t0: now + 300 };
    hintAfterGlide = true;
  };

  // --- Drawing ---

  const sceneNow = (): Scene | null => {
    if (!drawing) return null;
    if (drawing.scene) return drawing.scene;
    // Before the layout arrives: geography only.
    return {
      g: drawing.g,
      prep: drawing.prep,
      angle,
      frames: [drawing.truthKeys, drawing.truthKeys],
      colours: drawing.net.lines.map((l) => l.colour),
    };
  };

  const paint = () => {
    raf = 0;
    if (!drawing || !width) return;
    const scene = sceneNow()!;
    const fr = drawing.scene ? frameAt(scene, u) : frameAt(scene, 0);
    const view = currentView();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFrame(ctx, scene, fr, view, width, height, {
      labels: drawing.labels,
      labelAlpha: drawing.scene ? smooth(0.9, 1, u) : 0,
      highlight: pinned ?? hover,
      truth: truthAlpha,
      marker: drawing.marker,
    });
    updateScale(view);
    hint.hidden = !(
      drawing.labels &&
      u > 0.98 &&
      !glide &&
      ((NAME_SIZE * view.scale < 8.5 && !userView) || hintAfterGlide)
    );
    hint.textContent = coarse.matches
      ? 'Pinch to zoom. Double-tap to see the whole map.'
      : 'Scroll or pinch to zoom in. Double-click to fit.';
    if (pinned !== null || hover !== null) showCard(pinned ?? hover!, fr, view);
    else card.hidden = true;
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };

  const tick = (now: number) => {
    raf = 0;
    let again = false;
    if (playing) {
      const t = Math.min(1, Math.max(0, (now - playing.t0) / playing.dur));
      u = playing.from + (1 - playing.from) * ease(t);
      morph.value = String(Math.round(u * 1000));
      if (t >= 1) {
        playing = null;
        startGlide(now);
      }
      again = true;
    }
    if (glide) {
      const t = Math.min(1, (now - glide.t0) / 1400);
      const k = ease(t);
      userView = {
        scale: glide.from.scale + (glide.to.scale - glide.from.scale) * k,
        ox: glide.from.ox + (glide.to.ox - glide.from.ox) * k,
        oy: glide.from.oy + (glide.to.oy - glide.from.oy) * k,
      };
      if (t >= 1) glide = null;
      again = true;
    }
    const want = moved.checked ? 1 : 0;
    if (Math.abs(truthAlpha - want) > 0.01) {
      truthAlpha += (want - truthAlpha) * 0.18;
      again = true;
    } else truthAlpha = want;
    paint();
    if (again) schedule();
  };

  const updateScale = (view: View) => {
    if (!drawing) return;
    const fade = 1 - smooth(0.02, 0.22, u);
    const pxPerKm = view.scale * drawing.prep.unitsPerKm * (1 - u) + 0;
    if (fade > 0.01 && pxPerKm > 0) {
      const steps = [0.25, 0.5, 1, 2, 5, 10, 20];
      let km = steps[0];
      for (const s of steps) if (s * pxPerKm <= 130) km = s;
      scaleBar.style.width = `${Math.round(km * view.scale * drawing.prep.unitsPerKm)}px`;
      scaleBar.hidden = false;
      scaleText.textContent = km < 1 ? `${km * 1000} m` : `${km} km`;
      scaleBox.style.opacity = String(Math.max(fade, 0.001));
    } else {
      scaleBar.hidden = true;
      scaleText.textContent = 'Not to scale';
      scaleBox.style.opacity = String(smooth(0.6, 1, u));
    }
  };

  const showCard = (s: number, fr: Frame, view: View) => {
    if (!drawing) return;
    const x = fr.pos[s * 2] * view.scale + view.ox;
    const y = fr.pos[s * 2 + 1] * view.scale + view.oy;
    card.replaceChildren();
    const name = document.createElement('strong');
    name.textContent = drawing.g.names[s];
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const li of drawing.g.served[s]) {
      const line = drawing.net.lines[li];
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = line.ref;
      chip.style.background = line.colour;
      chip.style.color = inkOn(line.colour);
      chips.append(chip);
    }
    card.append(name, chips);
    if (u > 0.5) {
      const dx = fr.pos[s * 2] - drawing.prep.truth[s * 2];
      const dy = fr.pos[s * 2 + 1] - drawing.prep.truth[s * 2 + 1];
      const km = Math.hypot(dx, dy) / drawing.prep.unitsPerKm;
      const p = document.createElement('p');
      p.textContent =
        km < 0.1 ? 'Drawn almost exactly where it stands.' : `Drawn ${km.toFixed(km < 10 ? 1 : 0)} km from where it stands.`;
      card.append(p);
    }
    card.hidden = false;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let left = x + 14;
    let top = y - ch - 12;
    if (left + cw > width - 8) left = x - cw - 14;
    if (top < 8) top = y + 14;
    card.style.left = `${Math.max(8, left)}px`;
    card.style.top = `${Math.max(8, Math.min(height - ch - 8, top))}px`;
  };

  const resize = () => {
    const r = stage.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    schedule();
  };
  new ResizeObserver(resize).observe(stage);
  resize();

  // --- Loading and laying out ---

  const measure = (() => {
    const m = document.createElement('canvas').getContext('2d')!;
    return (text: string) => {
      m.font = `500 100px ${getFamily()}`;
      return (m.measureText(text).width / 100) * NAME_SIZE;
    };
  })();

  const setLegend = (net: Network) => {
    legend.replaceChildren();
    // Roundels when every line has a short name, bars and names otherwise: one style per key.
    const short = net.lines.every((l) => l.ref.length <= 4);
    for (const line of net.lines) {
      const li = document.createElement('li');
      if (short) {
        const chip = document.createElement('b');
        chip.className = 'roundel';
        chip.textContent = line.ref;
        chip.style.background = line.colour;
        chip.style.color = inkOn(line.colour);
        li.append(chip);
      } else {
        const bar = document.createElement('i');
        bar.style.background = line.colour;
        const text = document.createElement('span');
        text.textContent = line.ref;
        li.append(bar, text);
      }
      legend.append(li);
    }
  };

  const layOut = async (from: number) => {
    if (!drawing) return;
    const d = drawing;
    const token = loadToken;
    d.scene = null;
    d.final = null;
    d.labels = null;
    d.extent = null;
    glide = null;
    hintAfterGlide = false;
    const frames = await runLayout({ geo: d.prep.keyStart, chains: d.prep.chains, angle, seed });
    if (token !== loadToken || drawing !== d) return;
    d.scene = { g: d.g, prep: d.prep, angle, frames: [d.truthKeys, ...frames], colours: d.net.lines.map((l) => l.colour) };
    d.final = frameAt(d.scene, 1);
    await document.fonts.ready;
    if (token !== loadToken || drawing !== d) return;
    d.labels = placeLabels(d.g, d.final, d.marker, measure);
    const fb = frameBounds(d.final);
    const lb = labelExtent(d.g, d.labels, measure);
    d.extent = [Math.min(fb[0], lb[0]), Math.min(fb[1], lb[1]), Math.max(fb[2], lb[2]), Math.max(fb[3], lb[3])];
    root.dataset.state = 'ready';
    note.textContent = '';
    u = from;
    // With reduced motion, go straight to the diagram; the slider still runs back through it.
    if (still.matches) {
      u = 1;
      morph.value = '1000';
    } else {
      // A first look at the real map before it starts to move.
      const hold = from === 0 ? 900 : 0;
      playing = { from, t0: performance.now() + hold, dur: PLAY_MS * (1 - from * 0.6) };
    }
    schedule();
  };

  const show = (title: string, system: string, net: Network) => {
    loadToken++;
    const g = buildGraph(net);
    const prep = prepare(g);
    const truthKeys = new Float32Array(g.keys.length * 2);
    g.keys.forEach((s, k) => {
      truthKeys[k * 2] = prep.truth[s * 2];
      truthKeys[k * 2 + 1] = prep.truth[s * 2 + 1];
    });
    drawing = { title, system, net, g, prep, marker: markerSizes(g), truthKeys, scene: null, final: null, labels: null, extent: null };
    const stations = g.served.filter((s) => s.length).length;
    cityHead.textContent = title;
    systemHead.textContent = `${system} · ${net.lines.length} lines · ${stations} stations`;
    setLegend(net);
    pinned = null;
    hover = null;
    userView = null;
    u = 0;
    playing = null;
    morph.value = '0';
    schedule();
    void layOut(0);
  };

  const setChecked = (buttons: HTMLButtonElement[], on: HTMLButtonElement | null) => {
    for (const b of buttons) b.setAttribute('aria-checked', b === on ? 'true' : 'false');
  };

  const loadCity = async (id: string) => {
    const city = CITIES.find((c) => c.id === id) ?? CITIES[0];
    setChecked(cityButtons, cityButtons.find((b) => b.dataset.cityId === city.id) ?? null);
    const load = loaders[`./_data/${city.id}.json`];
    if (!load) return;
    const token = ++loadToken;
    const net = await load();
    if (token !== loadToken) return;
    show(city.name, city.system, net);
    searchStatus.textContent = '';
  };

  // --- Controls ---

  for (const b of cityButtons) b.addEventListener('click', () => void loadCity(b.dataset.cityId!));

  for (const b of angleButtons)
    b.addEventListener('click', () => {
      const a = Number(b.dataset.angle) as Angle;
      setChecked(angleButtons, b);
      if (a === angle) return;
      angle = a;
      userView = null;
      void layOut(0.08);
    });

  redraw.addEventListener('click', () => {
    seed = (seed * 48271 + 11) % 2147483647;
    userView = null;
    void layOut(0);
  });

  morph.addEventListener('input', () => {
    playing = null;
    u = Number(morph.value) / 1000;
    schedule();
  });

  moved.addEventListener('change', schedule);

  download.addEventListener('click', () => {
    if (!drawing?.scene || !drawing.final || !drawing.labels) return;
    const svg = toSVG(
      drawing.scene,
      drawing.final,
      drawing.labels,
      drawing.marker,
      drawing.title,
      drawing.system,
      drawing.net.lines.map((l) => l.ref),
    );
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${drawing.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-diagram.svg`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  // --- Pointer: hover, tap, pan, zoom ---

  const nearest = (cx: number, cy: number): number | null => {
    if (!drawing) return null;
    const scene = sceneNow()!;
    const fr = drawing.scene ? frameAt(scene, u) : frameAt(scene, 0);
    const view = currentView();
    let best: number | null = null;
    let bd = Math.max(12, view.scale * 0.6);
    for (let s = 0; s < drawing.g.names.length; s++) {
      const x = fr.pos[s * 2];
      if (Number.isNaN(x)) continue;
      const d = Math.hypot(x * view.scale + view.ox - cx, fr.pos[s * 2 + 1] * view.scale + view.oy - cy);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let dragged = false;
  let pinch: { d: number; view: View; mx: number; my: number } | null = null;
  let down: { x: number; y: number; view: View } | null = null;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  stage.addEventListener('pointerdown', (e) => {
    const p = local(e);
    glide = null;
    hintAfterGlide = false;
    pointers.set(e.pointerId, p);
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't be captured */
    }
    dragged = false;
    if (pointers.size === 1) down = { x: p.x, y: p.y, view: { ...currentView() } };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), view: { ...currentView() }, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      down = null;
    }
  });

  stage.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = d / Math.max(1, pinch.d);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const scale = Math.min(400, Math.max(2, pinch.view.scale * k));
      const f = scale / pinch.view.scale;
      userView = { scale, ox: mx - (pinch.mx - pinch.view.ox) * f, oy: my - (pinch.my - pinch.view.oy) * f };
      dragged = true;
      schedule();
      return;
    }
    if (down && pointers.size === 1) {
      const dx = p.x - down.x;
      const dy = p.y - down.y;
      if (dragged || Math.hypot(dx, dy) > 4) {
        dragged = true;
        stage.classList.add('dragging');
        userView = { scale: down.view.scale, ox: down.view.ox + dx, oy: down.view.oy + dy };
        schedule();
      }
      return;
    }
    if (e.pointerType === 'mouse') {
      const s = nearest(p.x, p.y);
      if (s !== hover) {
        hover = s;
        schedule();
      }
    }
  });

  const end = (e: PointerEvent) => {
    const p = local(e);
    const wasTap = pointers.size === 1 && !dragged && !pinch;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      down = null;
      stage.classList.remove('dragging');
    }
    if (wasTap && e.type === 'pointerup') {
      const now = performance.now();
      if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
        // Double tap: back to the whole map.
        userView = null;
        glide = null;
        pinned = null;
        lastTap = { t: 0, x: 0, y: 0 };
        schedule();
        return;
      }
      lastTap = { t: now, x: p.x, y: p.y };
      const s = nearest(p.x, p.y);
      pinned = s === pinned ? null : s;
      schedule();
    }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && hover !== null) {
      hover = null;
      schedule();
    }
  });

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      glide = null;
      hintAfterGlide = false;
      const p = local(e);
      const v = currentView();
      const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
      const scale = Math.min(400, Math.max(2, v.scale * k));
      const f = scale / v.scale;
      userView = { scale, ox: p.x - (p.x - v.ox) * f, oy: p.y - (p.y - v.oy) * f };
      schedule();
    },
    { passive: false },
  );

  stage.addEventListener('dblclick', () => {
    userView = null;
    schedule();
  });

  // --- Any other city, live ---

  search.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = searchInput.value.trim();
    if (name) void lookUp(name);
  });

  const lookUp = async (name: string) => {
    const token = ++loadToken;
    const say = (text: string) => {
      if (token === loadToken) searchStatus.textContent = text;
    };
    say(`Finding ${name}…`);
    let place: { name: string; latitude: number; longitude: number; country?: string } | undefined;
    try {
      const url = `${GEOCODER}?name=${encodeURIComponent(name)}&count=5&language=en&format=json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const data = (await res.json()) as { results?: (typeof place & { population?: number })[] };
      place = (data.results ?? []).sort((a, b) => (b?.population ?? 0) - (a?.population ?? 0))[0];
    } catch {
      say('The place search did not answer. Try again in a moment.');
      return;
    }
    if (token !== loadToken) return;
    if (!place) {
      say(`No place called ${name} came up.`);
      return;
    }
    const where = place.country ? `${place.name}, ${place.country}` : place.name;
    const asked = performance.now();
    const asking = () =>
      say(
        `Asking OpenStreetMap for the metro around ${where}. Its public server can take a minute: ${Math.round((performance.now() - asked) / 1000)} s`,
      );
    asking();
    const ticker = setInterval(asking, 1000);
    const dLat = 0.36;
    const dLon = 0.36 / Math.max(0.2, Math.cos((place.latitude * Math.PI) / 180));
    const bbox = [place.latitude - dLat, place.longitude - dLon, place.latitude + dLat, place.longitude + dLon]
      .map((v) => v.toFixed(4))
      .join(',');
    const query = `[out:json][timeout:60];
rel["route"~"^(subway|light_rail|monorail)$"](${bbox})->.r;
.r out body;
node(r.r)->.n;
.n out body qt;
rel(br.r)["type"="route_master"];
out tags;`;
    let raw: { elements: { type: string; tags?: Record<string, string> }[] };
    try {
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch(OVERPASS, {
          method: 'POST',
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(70000),
        });
        if (res.ok || (res.status !== 429 && res.status !== 502 && res.status !== 504)) break;
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        if (token !== loadToken) {
          clearInterval(ticker);
          return;
        }
      }
      if (!res || !res.ok) throw new Error(String(res?.status));
      raw = await res.json();
    } catch {
      clearInterval(ticker);
      say('OpenStreetMap is too busy to answer right now. Try again in a minute, or pick a city above.');
      return;
    }
    clearInterval(ticker);
    if (token !== loadToken) return;
    // Prefer the heavy metro where a city has one; light rail and monorail only when it doesn't.
    const routes = raw.elements.filter((e) => e.type === 'relation' && e.tags?.type === 'route');
    const hasSubway = routes.some((r) => r.tags?.route === 'subway');
    if (hasSubway)
      raw.elements = raw.elements.filter(
        (e) => !(e.type === 'relation' && e.tags?.type === 'route' && e.tags?.route !== 'subway'),
      );
    const net = fromOverpass(raw as Parameters<typeof fromOverpass>[0]);
    const used = new Set(net.lines.flatMap((l) => l.routes.flat()));
    if (net.lines.length < 1 || used.size < 4) {
      say(`OpenStreetMap has no metro mapped around ${where}.`);
      return;
    }
    if (used.size > 700) {
      say(`${where} has ${used.size} stations, more than this page can draw at once.`);
      return;
    }
    setChecked(cityButtons, null);
    const counts = new Map<string, number>();
    for (const r of routes) {
      const nw = r.tags?.network?.trim();
      if (nw && nw.length <= 28 && (!hasSubway || r.tags?.route === 'subway')) counts.set(nw, (counts.get(nw) ?? 0) + 1);
    }
    const system = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (hasSubway ? 'Metro' : 'Light rail');
    show(place.name, system, net);
    searchStatus.textContent = `Drawn from OpenStreetMap as it stands today.`;
  };

  // Render checks: ?debug exposes where stations are drawn and lets a check set the slider.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { schematic: object }).schematic = {
      ready: () => Boolean(drawing?.labels) && !playing,
      station: (name: string) => {
        if (!drawing) return null;
        const s = drawing.g.names.indexOf(name);
        if (s < 0) return null;
        const fr = drawing.scene ? frameAt(drawing.scene, u) : null;
        if (!fr) return null;
        const v = currentView();
        return { x: fr.pos[s * 2] * v.scale + v.ox, y: fr.pos[s * 2 + 1] * v.scale + v.oy };
      },
      set: (value: number) => {
        playing = null;
        u = value;
        morph.value = String(Math.round(u * 1000));
        schedule();
      },
      clashes: () => drawing?.labels?.filter((l) => l.clash).length ?? null,
      svg: () =>
        drawing?.scene && drawing.final && drawing.labels
          ? toSVG(
              drawing.scene,
              drawing.final,
              drawing.labels,
              drawing.marker,
              drawing.title,
              drawing.system,
              drawing.net.lines.map((l) => l.ref),
            )
          : null,
    };
  }

  // Start on the city named in the hash, or the first.
  const fromHash = location.hash.slice(1);
  void loadCity(CITIES.some((c) => c.id === fromHash) ? fromHash : CITIES[0].id);
}
