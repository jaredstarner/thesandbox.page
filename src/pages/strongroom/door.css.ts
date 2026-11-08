import type { APIRoute } from 'astro';
import source from './_door.css?raw';

// Served as written, so the Styles pane shows door.css with its comments and line numbers.
export const GET: APIRoute = () => new Response(source, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
