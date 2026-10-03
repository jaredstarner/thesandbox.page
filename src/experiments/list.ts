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

// Experiments live at the site root: src/pages/<slug>/index.*, served at /<slug>/.
// Any page format Astro routes works for an experiment's index page.
const folderPages = import.meta.glob('/src/pages/*/index.*');
const filePages = import.meta.glob('/src/pages/*.*');

// Site pages that are not experiments; no experiment may take their URL.
const siteFolders = new Set(['experiments']);
const siteFiles = new Set(Object.keys(filePages).map((path) => path.split('/').at(-1)!.split('.')[0]));

/** Every experiment, newest first. Fails the build if an entry has no page or takes a site page's URL. */
export async function getExperiments(): Promise<Experiment[]> {
  const entries = await getCollection('experiments');
  const slugsWithPages = new Set(Object.keys(folderPages).map((path) => path.split('/').at(-2)));

  return entries
    .map(({ id, data }) => {
      if (siteFolders.has(id) || siteFiles.has(id)) {
        throw new Error(`src/experiments/${id}.json uses a slug reserved for a site page: /${id}/`);
      }
      if (!slugsWithPages.has(id)) {
        throw new Error(`src/experiments/${id}.json has no page at src/pages/${id}/index.*`);
      }
      return { slug: id, href: `/${id}/`, ...data };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}
