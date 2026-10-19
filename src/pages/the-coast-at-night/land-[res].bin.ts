import type { GetStaticPaths } from 'astro';
import { packLand } from './_landpack';

export const getStaticPaths = (() => [{ params: { res: '50m' } }, { params: { res: '10m' } }]) satisfies GetStaticPaths;

export const GET = ({ params }: { params: { res: '50m' | '10m' } }) =>
  new Response(packLand(params.res), { headers: { 'Content-Type': 'application/octet-stream' } });
