// Signal box: a small helper for building SVG by hand.

export const NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number | undefined | null>;

export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (SVGElement | string | null | undefined)[]
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  set(e, attrs);
  for (const c of children) {
    if (c === null || c === undefined) continue;
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

export function set(e: Element, attrs: Attrs): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) e.removeAttribute(k);
    else e.setAttribute(k, String(v));
  }
}

/** A polygon's points attribute from pairs. */
export function pts(p: [number, number][]): string {
  return p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

export function f1(n: number): string {
  return n.toFixed(1);
}
