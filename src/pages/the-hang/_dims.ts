// Reads the museum's dimension lines ("Image: 27.7 × 20.3 cm (…); Sheet: 41.3 × 32.5 cm (…)") into sizes in centimetres.

export interface Size {
  /** Height, cm. */
  h: number;
  /** Width, cm. */
  w: number;
  /** Depth, cm, when the line gives one. */
  d?: number;
}

export interface Dims {
  /** The picture itself: image, plate, or the work's only measurement. */
  image: Size | null;
  /** The sheet, mount, album page, or mat around it. */
  sheet: Size | null;
  /** The work in its frame. */
  framed: Size | null;
}

const PART =
  /(?:([A-Za-z][A-Za-z /,.()'-]*?)\s*:\s*)?(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)(?:\s*×\s*(\d+(?:\.\d+)?))?\s*cm/g;

type Kind = 'image' | 'sheet' | 'framed' | 'skip';

function kindOf(label: string | undefined): Kind {
  if (!label) return 'image';
  const l = label.toLowerCase();
  if (/fram/.test(l)) return 'framed';
  if (/diam|base|stand|pedestal|box|case|vol\.|volume/.test(l)) return 'skip';
  if (/image|plate|platemark|composition|sight|approx|painted|panel|canvas|support/.test(l)) return 'image';
  if (/sheet|paper|page|mount|mat|board|card|overall|secondary|primary/.test(l)) return 'sheet';
  return 'image';
}

export function parseDims(line: string): Dims {
  const out: Dims = { image: null, sheet: null, framed: null };
  for (const m of line.matchAll(PART)) {
    const h = Number(m[2]);
    const w = Number(m[3]);
    if (!(h > 0 && w > 0)) continue;
    const size: Size = { h, w };
    if (m[4]) size.d = Number(m[4]);
    const kind = kindOf(m[1]?.trim());
    if (kind === 'skip') continue;
    if (!out[kind]) out[kind] = size;
  }
  if (!out.image && out.sheet) {
    out.image = out.sheet;
    out.sheet = null;
  }
  return out;
}

const aspectError = (s: Size, aspect: number) => Math.abs(Math.log(s.w / s.h / aspect));

/**
 * The size of what the museum's photograph shows: the picture, or its sheet when the photograph takes in the
 * whole sheet. Turned when the measurements are given the other way round from the photograph.
 */
export function pictureSize(dims: Dims, pw: number | null, ph: number | null): Size | null {
  const cands = [dims.image, dims.sheet].filter((s): s is Size => s !== null);
  if (!cands.length) return null;
  if (!pw || !ph) return cands[0];
  const aspect = pw / ph;
  let best = cands[0];
  let bestErr = Infinity;
  for (const c of cands) {
    for (const s of [c, { h: c.w, w: c.h }]) {
      // Turning costs a little, so a square-ish work keeps the museum's orientation.
      const err = aspectError(s, aspect) + (s === c ? 0 : 0.08);
      if (err < bestErr) {
        bestErr = err;
        best = s;
      }
    }
  }
  return { h: best.h, w: best.w };
}
