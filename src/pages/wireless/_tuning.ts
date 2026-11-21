// Where things sit on the dial, shared by the printed glass (build time) and the set (in the browser).
// The dial runs west to east by longitude and wraps round: keep turning east past Suva and you come
// back in over Honolulu.

/** A city's stations sit this far apart on the glass, in degrees, centred on the city. */
export const CARRIER_SPACING = 0.5;

/** Any longitude, folded into [-180, 180). */
export function wrap(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** The signed shortest turn from `a` to `b`, in degrees. */
export function towards(a: number, b: number): number {
  return wrap(b - a);
}

export function carrierLon(cityLon: number, i: number, n: number): number {
  return wrap(cityLon + (i - (n - 1) / 2) * CARRIER_SPACING);
}
