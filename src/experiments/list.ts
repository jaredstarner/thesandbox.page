import { getCollection } from 'astro:content';

export interface Experiment {
  slug: string;
  href: string;
  title: string;
  summary: string;
  date: Date;
  tags: string[];
  issue?: number;
}

// Any page format Astro routes works for an experiment's index page.
const pages = import.meta.glob('/src/pages/experiments/*/index.*');

/** Every experiment, newest first. Fails the build if an entry has no page. */
export async function getExperiments(): Promise<Experiment[]> {
  const entries = await getCollection('experiments');
  const slugsWithPages = new Set(
    Object.keys(pages).map((path) => path.split('/').at(-2)),
  );

  return entries
    .map(({ id, data }) => {
      if (!slugsWithPages.has(id)) {
        throw new Error(
          `src/experiments/${id}.json has no page at src/pages/experiments/${id}/index.*`,
        );
      }
      return { slug: id, href: `/experiments/${id}/`, ...data };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}
