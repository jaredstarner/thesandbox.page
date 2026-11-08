import type { APIRoute } from 'astro';
import source from './_door.js?raw';

// Served as written, unbundled and unminified: reading it in Sources is part of the job.
export const GET: APIRoute = () =>
  new Response(source, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
