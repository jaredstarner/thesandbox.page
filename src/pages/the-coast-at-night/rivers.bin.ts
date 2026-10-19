import { packRivers } from './_landpack';

export const GET = () => new Response(packRivers(), { headers: { 'Content-Type': 'application/octet-stream' } });
