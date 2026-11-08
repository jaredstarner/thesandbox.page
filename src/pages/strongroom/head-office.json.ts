import type { APIRoute } from 'astro';

// The far end of the door's alarm line. The door rings this every four seconds.
const reply = {
  exchange: 'Head Office, Strongroom Desk',
  line: 'up',
  alarm: 'armed',
  memo: 'Line test only. For the keyholder: the first number of the combination is 38. Do not repeat over an open line.',
};

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(reply, null, 2)}\n`, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
