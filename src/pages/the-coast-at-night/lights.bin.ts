import { packed } from './_catalog';

export const GET = () => new Response(packed(), { headers: { 'Content-Type': 'application/octet-stream' } });
