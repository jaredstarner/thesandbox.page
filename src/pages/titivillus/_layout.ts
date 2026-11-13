// The page as terrain. The browser sets the type (line breaks, justification,
// reflow on resize); this module reads back where every word landed and paints
// the same words, in the same fonts, into a one-bit mask. The devil walks on
// that mask, so he stands on the actual tops of the letters: up over an
// ascender, down into an x-height valley, onto the dot of an i.

/** Mask values: open air, letters (stand on top, pass through from below), solid blocks. */
export const AIR = 0;
export const ONEWAY = 1;
export const SOLID = 2;

export interface Word {
  el: HTMLElement;
  /** Box in container coordinates (CSS px). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Leaf number as printed (1 is the title page). */
  leaf: number;
  /** True for running text, where faults can be set. */
  body: boolean;
}

export interface Leaf {
  n: number;
  el: HTMLElement;
  top: number;
  bottom: number;
  /** The text column: the leaf inside its padding, margins excluded. */
  left: number;
  right: number;
}

export interface Layout {
  /** Container origin in document coordinates. */
  ox: number;
  oy: number;
  w: number;
  h: number;
  mask: Uint8Array;
  words: Word[];
  leaves: Leaf[];
  /** Body text size and line pitch, which set the devil's scale. */
  fontSize: number;
  lineH: number;
}

const WORD_CLASS = 'w';

/** Wrap every word of the page's text in a span, once, so each can be measured and changed. */
export function wrapWords(scope: ParentNode): void {
  const hosts = scope.querySelectorAll<HTMLElement>('[data-text], [data-body]');
  for (const host of hosts) wrapIn(host);
}

export function wrapIn(host: HTMLElement): void {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('svg, noscript, button, .w')) return NodeFilter.FILTER_REJECT;
      return /\S/.test(node.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.nodeValue ?? '';
    const frag = document.createDocumentFragment();
    for (const part of text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        frag.append(part);
      } else {
        const span = document.createElement('span');
        span.className = WORD_CLASS;
        span.textContent = part;
        frag.append(span);
      }
    }
    node.replaceWith(frag);
  }
}

interface FontInfo {
  font: string;
  spacing: string;
  upper: boolean;
  ascent: number;
  descent: number;
}

const fontCache = new WeakMap<Element, FontInfo>();

function fontOf(el: Element, ctx: CanvasRenderingContext2D): FontInfo {
  const cached = fontCache.get(el);
  if (cached) return cached;
  const cs = getComputedStyle(el);
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.font = font;
  const m = ctx.measureText('Hg');
  const info: FontInfo = {
    font,
    spacing: cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing,
    upper: cs.textTransform === 'uppercase',
    ascent: m.fontBoundingBoxAscent,
    descent: m.fontBoundingBoxDescent,
  };
  fontCache.set(el, info);
  return info;
}

/** Forget measured fonts, after the web fonts arrive or the page changes size. */
export function clearFontCache(scope: ParentNode): void {
  for (const el of scope.querySelectorAll('.w, .w *')) fontCache.delete(el);
}

function drawRun(
  ctx: CanvasRenderingContext2D,
  text: string,
  el: Element,
  rect: DOMRect,
  ox: number,
  oy: number,
  turned: boolean,
): void {
  const info = fontOf(el, ctx);
  ctx.font = info.font;
  ctx.letterSpacing = info.spacing;
  const s = info.upper ? text.toUpperCase() : text;
  const x = rect.left - ox;
  const y = rect.top - oy;
  if (turned) {
    // A turned sort is an inline block one line tall; its glyph sits centred in
    // it before the half turn, which spins it about the block's centre.
    const cx = x + rect.width / 2;
    const cy = y + rect.height / 2;
    const base = y + (rect.height - (info.ascent + info.descent)) / 2 + info.ascent;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI);
    ctx.fillText(s, x - cx, base - cy);
    ctx.restore();
  } else {
    ctx.fillText(s, x, y + info.ascent);
  }
}

let canvas: HTMLCanvasElement | null = null;

/** Measure every word and paint the mask. Forces one layout; costs tens of milliseconds. */
export function buildLayout(container: HTMLElement): Layout {
  const box = container.getBoundingClientRect();
  const ox = box.left;
  const oy = box.top;
  const w = Math.ceil(box.width);
  const h = Math.ceil(box.height) + 4;

  canvas ??= document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';

  const leaves: Leaf[] = [];
  for (const el of container.querySelectorAll<HTMLElement>('[data-leaf]')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    leaves.push({
      n: Number(el.dataset.leaf),
      el,
      top: r.top - oy,
      bottom: r.bottom - oy,
      left: r.left - ox + parseFloat(cs.paddingLeft),
      right: r.right - ox - parseFloat(cs.paddingRight),
    });
  }
  const leafAt = (y: number) => {
    for (const l of leaves) if (y >= l.top - 1 && y <= l.bottom + 1) return l.n;
    return 0;
  };

  const words: Word[] = [];
  for (const el of container.querySelectorAll<HTMLElement>(`.${WORD_CLASS}`)) {
    const rects = el.getClientRects();
    if (!rects.length) continue;
    const r = rects[0];
    if (r.width === 0) continue;
    words.push({
      el,
      x0: r.left - ox,
      y0: r.top - oy,
      x1: r.right - ox,
      y1: r.bottom - oy,
      leaf: leafAt(r.top - oy),
      body: !!el.closest('[data-body]') && !el.closest('.pil'),
    });
    if (el.childElementCount === 0) {
      drawRun(ctx, el.textContent ?? '', el.parentElement ?? el, r, ox, oy, false);
    } else {
      // A word with a set fault in it: draw each run where it actually sits.
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const rr = range.getClientRects()[0];
          if (rr) drawRun(ctx, node.nodeValue ?? '', el.parentElement ?? el, rr, ox, oy, false);
        } else if (node instanceof HTMLElement) {
          const rr = node.getBoundingClientRect();
          drawRun(ctx, node.textContent ?? '', node, rr, ox, oy, node.classList.contains('tv-turn'));
        }
      }
    }
  }

  const data = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0, j = 3; i < mask.length; i++, j += 4) {
    if (data[j] > 96) mask[i] = ONEWAY;
  }

  // Woodcut initials are solid blocks: walls at the sides, a floor on top.
  for (const el of container.querySelectorAll<HTMLElement>('[data-solid]')) {
    const r = el.getBoundingClientRect();
    const x0 = Math.max(0, Math.floor(r.left - ox));
    const x1 = Math.min(w, Math.ceil(r.right - ox));
    const y0 = Math.max(0, Math.floor(r.top - oy));
    const y1 = Math.min(h, Math.ceil(r.bottom - oy));
    for (let y = y0; y < y1; y++) mask.fill(SOLID, y * w + x0, y * w + x1);
  }
  // The desk under the last leaf.
  mask.fill(SOLID, (h - 2) * w, h * w);

  const sample = container.querySelector<HTMLElement>('[data-body]');
  const cs = sample ? getComputedStyle(sample) : null;
  const fontSize = cs ? parseFloat(cs.fontSize) : 21;
  const lineH = cs ? parseFloat(cs.lineHeight) || fontSize * 1.52 : fontSize * 1.52;

  return { ox: ox + window.scrollX, oy: oy + window.scrollY, w, h, mask, words, leaves, fontSize, lineH };
}

/** The leaf at a height, or the next one down when the point is in the gap between two. */
export function leafAt(layout: Layout, y: number): Leaf | null {
  for (const l of layout.leaves) if (y < l.bottom + 1) return l;
  return layout.leaves[layout.leaves.length - 1] ?? null;
}

/** The mask value at a container point; outside is air, except the desk below. */
export function at(layout: Layout, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || xi >= layout.w || yi < 0) return AIR;
  if (yi >= layout.h) return SOLID;
  return layout.mask[yi * layout.w + xi];
}

/** The line number of a body word within its leaf, counting only the running text. */
export function lineOf(layout: Layout, word: Word): number {
  const tops: number[] = [];
  for (const w of layout.words) {
    if (!w.body || w.leaf !== word.leaf) continue;
    const mid = (w.y0 + w.y1) / 2;
    if (!tops.some((t) => Math.abs(t - mid) < 4)) tops.push(mid);
  }
  tops.sort((a, b) => a - b);
  const mid = (word.y0 + word.y1) / 2;
  const i = tops.findIndex((t) => Math.abs(t - mid) < 4);
  return i + 1;
}
