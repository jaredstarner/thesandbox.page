import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// One JSON file per experiment in src/experiments/; the file name is the slug.
// See src/experiments/README.md.
const experiments = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/experiments' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    issue: z.number().int().positive().optional(),
  }),
});

export const collections = { experiments };
