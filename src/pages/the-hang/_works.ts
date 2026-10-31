// Works from the Art Institute of Chicago's public API (keyless, CORS-open, CC0 data), and the starter crate kept
// with the page so the room still opens when the museum's API doesn't answer.

import { parseDims, pictureSize } from './_dims';
import { mountFor, type Mount } from './_mount';
import crate from './_works.json';

export interface Rec {
  id: number;
  title: string;
  artist: string | null;
  artistDisplay: string | null;
  date: string | null;
  year: number | null;
  medium: string | null;
  dimensions: string;
  type: string | null;
  credit: string | null;
  origin: string | null;
  image: string;
  lqip: string | null;
  /** Pixel size of the museum's full image. */
  pw: number | null;
  ph: number | null;
  alt: string | null;
}

export interface Work extends Rec {
  /** The picture's size as photographed, cm. */
  size: { w: number; h: number };
  mount: Mount;
}

const API = 'https://api.artic.edu/api/v1';
const IIIF = 'https://www.artic.edu/iiif/2';
const FIELDS = [
  'id',
  'title',
  'artist_title',
  'artist_display',
  'date_display',
  'date_start',
  'medium_display',
  'dimensions',
  'artwork_type_title',
  'credit_line',
  'place_of_origin',
  'image_id',
  'thumbnail',
  'is_public_domain',
];

/** The museum's artwork types that hang on a wall, grouped as the stores' filters. */
export const KINDS: Record<string, { label: string; ids: number[] }> = {
  all: { label: 'Everything', ids: [1, 30, 4, 18, 14, 34, 2, 32, 5, 38] },
  painting: { label: 'Paintings', ids: [1, 30, 4] },
  print: { label: 'Prints', ids: [18, 32] },
  drawing: { label: 'Drawings', ids: [14, 34] },
  photo: { label: 'Photographs', ids: [2] },
  textile: { label: 'Textiles', ids: [5, 38] },
};

interface ApiArtwork {
  id: number;
  title?: string | null;
  artist_title?: string | null;
  artist_display?: string | null;
  date_display?: string | null;
  date_start?: number | null;
  medium_display?: string | null;
  dimensions?: string | null;
  artwork_type_title?: string | null;
  credit_line?: string | null;
  place_of_origin?: string | null;
  image_id?: string | null;
  is_public_domain?: boolean;
  thumbnail?: { lqip?: string | null; width?: number | null; height?: number | null; alt_text?: string | null } | null;
}

function fromApi(a: ApiArtwork): Rec | null {
  if (!a.image_id || a.is_public_domain === false) return null;
  return {
    id: a.id,
    title: a.title ?? 'Untitled',
    artist: a.artist_title ?? null,
    artistDisplay: a.artist_display ?? null,
    date: a.date_display ?? null,
    year: a.date_start ?? null,
    medium: a.medium_display ?? null,
    dimensions: a.dimensions ?? '',
    type: a.artwork_type_title ?? null,
    credit: a.credit_line ?? null,
    origin: a.place_of_origin ?? null,
    image: a.image_id,
    lqip: a.thumbnail?.lqip ?? null,
    pw: a.thumbnail?.width ?? null,
    ph: a.thumbnail?.height ?? null,
    alt: a.thumbnail?.alt_text ?? null,
  };
}

/** A record made hangable, or null when the museum gives no measurement to hang it by. */
export function toWork(rec: Rec): Work | null {
  const dims = parseDims(rec.dimensions);
  const size = pictureSize(dims, rec.pw, rec.ph);
  if (!size || size.w < 0.5 || size.h < 0.5 || size.w > 1500 || size.h > 520) return null;
  const mount = mountFor({ type: rec.type, year: rec.year, origin: rec.origin, pic: size, dims });
  return { ...rec, size, mount };
}

export const CRATE: Rec[] = crate as Rec[];

export interface Page {
  works: Work[];
  /** Results the museum returned that couldn't be hung (no measurement). */
  skipped: number;
  total: number;
  page: number;
  pages: number;
}

export async function search(q: string, kind: string, page: number, signal?: AbortSignal): Promise<Page> {
  const filter: unknown[] = [
    { term: { is_public_domain: true } },
    { exists: { field: 'image_id' } },
    { terms: { artwork_type_id: (KINDS[kind] ?? KINDS.all).ids } },
  ];
  // With nothing typed, the museum's own highlights.
  if (!q.trim()) filter.push({ term: { is_boosted: true } });
  const params: Record<string, unknown> = { limit: 30, page, fields: FIELDS, query: { bool: { filter } } };
  if (q.trim()) params.q = q.trim();
  const res = await fetch(`${API}/artworks/search?params=${encodeURIComponent(JSON.stringify(params))}`, { signal });
  if (!res.ok) throw new Error(`The stores answered ${res.status}`);
  const body = (await res.json()) as { data: ApiArtwork[]; pagination: { total: number; total_pages: number } };
  const works: Work[] = [];
  let skipped = 0;
  for (const a of body.data) {
    const rec = fromApi(a);
    const work = rec && toWork(rec);
    if (work) works.push(work);
    else skipped++;
  }
  return {
    works,
    skipped,
    total: body.pagination.total,
    page,
    pages: Math.min(body.pagination.total_pages, 33),
  };
}

export async function fetchIds(ids: number[], signal?: AbortSignal): Promise<Work[]> {
  if (!ids.length) return [];
  const res = await fetch(`${API}/artworks?ids=${ids.join(',')}&limit=${ids.length}&fields=${FIELDS.join(',')}`, {
    signal,
  });
  if (!res.ok) throw new Error(`The stores answered ${res.status}`);
  const body = (await res.json()) as { data: ApiArtwork[] };
  const out: Work[] = [];
  for (const a of body.data) {
    const rec = fromApi(a);
    const work = rec && toWork(rec);
    if (work) out.push(work);
  }
  return out;
}

/** Widths the museum's image server is asked for; 843 is the size its own site uses. */
const WIDTHS = [200, 400, 843, 1686, 3000];

export function widthFor(work: Rec, px: number): number {
  const cap = work.pw ?? 3000;
  for (const w of WIDTHS) if (w >= px || w >= cap) return Math.min(w, Math.max(200, cap));
  return Math.min(3000, cap);
}

export function imageUrl(work: Rec, width: number): string {
  return `${IIIF}/${work.image}/full/${width},/0/default.jpg`;
}

export function artUrl(work: Rec): string {
  return `https://www.artic.edu/artworks/${work.id}`;
}

/** "207.5 × 308.1 cm", the picture as hung. */
export function sizeText(work: Work): string {
  const f = (n: number) => (Math.round(n * 10) / 10).toString();
  return `${f(work.size.h)} × ${f(work.size.w)} cm`;
}
