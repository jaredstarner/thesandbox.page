import type { APIRoute } from 'astro';
import { getExperiments } from '../experiments/list';

// Indexable pages only: the home page and every experiment. /experiments/ and
// the 404 are noindex, so they stay out. New experiments join on their own.

const day = (date: Date) => date.toISOString().slice(0, 10);

export const GET: APIRoute = async ({ site }) => {
  const experiments = await getExperiments();
  const urls = [
    // The home page changes when an experiment claims its plot.
    { loc: new URL('/', site), lastmod: experiments[0] && day(experiments[0].date) },
    ...experiments.map((experiment) => ({ loc: new URL(experiment.href, site), lastmod: day(experiment.date) })),
  ];

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(({ loc, lastmod }) => `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`),
    '</urlset>',
    '',
  ].join('\n');

  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
