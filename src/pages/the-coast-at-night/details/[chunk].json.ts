import type { GetStaticPaths } from 'astro';
import { chunkCount, details } from '../_catalog';

export const getStaticPaths = (() =>
  Array.from({ length: chunkCount() }, (_, i) => ({ params: { chunk: String(i) } }))) satisfies GetStaticPaths;

export const GET = ({ params }: { params: { chunk: string } }) => Response.json(details(Number(params.chunk)));
