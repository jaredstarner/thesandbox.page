// Time zone helpers. A dial's hour lines are set for the meridian its clocks
// keep (standard time); summer time and the equation of time are corrections
// read off afterwards, as on a real dial.

import type { Place } from './_dial';

/** Where a visitor probably is, from the browser's time zone: the zone's own city. */
const ZONE_CITY: Record<string, [string, number, number]> = {
  'America/New_York': ['New York', 40.713, -74.006],
  'America/Detroit': ['Detroit', 42.331, -83.046],
  'America/Toronto': ['Toronto', 43.653, -79.383],
  'America/Chicago': ['Chicago', 41.878, -87.63],
  'America/Winnipeg': ['Winnipeg', 49.895, -97.138],
  'America/Denver': ['Denver', 39.739, -104.99],
  'America/Phoenix': ['Phoenix', 33.448, -112.074],
  'America/Edmonton': ['Edmonton', 53.546, -113.494],
  'America/Los_Angeles': ['Los Angeles', 34.052, -118.244],
  'America/Vancouver': ['Vancouver', 49.283, -123.121],
  'America/Anchorage': ['Anchorage', 61.218, -149.9],
  'Pacific/Honolulu': ['Honolulu', 21.307, -157.858],
  'America/Halifax': ['Halifax', 44.649, -63.575],
  'America/St_Johns': ["St. John's", 47.562, -52.713],
  'America/Mexico_City': ['Mexico City', 19.433, -99.133],
  'America/Bogota': ['Bogotá', 4.711, -74.072],
  'America/Lima': ['Lima', -12.046, -77.043],
  'America/Santiago': ['Santiago', -33.449, -70.669],
  'America/Argentina/Buenos_Aires': ['Buenos Aires', -34.604, -58.382],
  'America/Sao_Paulo': ['São Paulo', -23.551, -46.633],
  'Atlantic/Reykjavik': ['Reykjavík', 64.147, -21.942],
  'Europe/London': ['London', 51.507, -0.128],
  'Europe/Dublin': ['Dublin', 53.35, -6.26],
  'Europe/Lisbon': ['Lisbon', 38.722, -9.139],
  'Europe/Madrid': ['Madrid', 40.417, -3.704],
  'Europe/Paris': ['Paris', 48.857, 2.352],
  'Europe/Brussels': ['Brussels', 50.85, 4.352],
  'Europe/Amsterdam': ['Amsterdam', 52.368, 4.904],
  'Europe/Berlin': ['Berlin', 52.52, 13.405],
  'Europe/Zurich': ['Zurich', 47.377, 8.542],
  'Europe/Rome': ['Rome', 41.903, 12.496],
  'Europe/Vienna': ['Vienna', 48.208, 16.374],
  'Europe/Prague': ['Prague', 50.075, 14.438],
  'Europe/Copenhagen': ['Copenhagen', 55.676, 12.568],
  'Europe/Oslo': ['Oslo', 59.914, 10.752],
  'Europe/Stockholm': ['Stockholm', 59.329, 18.069],
  'Europe/Warsaw': ['Warsaw', 52.23, 21.012],
  'Europe/Helsinki': ['Helsinki', 60.17, 24.938],
  'Europe/Athens': ['Athens', 37.984, 23.728],
  'Europe/Istanbul': ['Istanbul', 41.008, 28.978],
  'Europe/Kyiv': ['Kyiv', 50.45, 30.523],
  'Europe/Moscow': ['Moscow', 55.756, 37.617],
  'Africa/Casablanca': ['Casablanca', 33.573, -7.59],
  'Africa/Lagos': ['Lagos', 6.524, 3.379],
  'Africa/Cairo': ['Cairo', 30.044, 31.236],
  'Africa/Nairobi': ['Nairobi', -1.292, 36.822],
  'Africa/Johannesburg': ['Johannesburg', -26.204, 28.047],
  'Asia/Jerusalem': ['Jerusalem', 31.769, 35.216],
  'Asia/Dubai': ['Dubai', 25.205, 55.271],
  'Asia/Tehran': ['Tehran', 35.689, 51.389],
  'Asia/Karachi': ['Karachi', 24.861, 67.01],
  'Asia/Kolkata': ['Kolkata', 22.573, 88.364],
  'Asia/Kathmandu': ['Kathmandu', 27.717, 85.324],
  'Asia/Dhaka': ['Dhaka', 23.811, 90.413],
  'Asia/Bangkok': ['Bangkok', 13.756, 100.502],
  'Asia/Jakarta': ['Jakarta', -6.208, 106.846],
  'Asia/Singapore': ['Singapore', 1.352, 103.82],
  'Asia/Hong_Kong': ['Hong Kong', 22.32, 114.169],
  'Asia/Shanghai': ['Shanghai', 31.23, 121.474],
  'Asia/Taipei': ['Taipei', 25.033, 121.565],
  'Asia/Manila': ['Manila', 14.6, 120.984],
  'Asia/Seoul': ['Seoul', 37.567, 126.978],
  'Asia/Tokyo': ['Tokyo', 35.676, 139.65],
  'Australia/Perth': ['Perth', -31.952, 115.861],
  'Australia/Adelaide': ['Adelaide', -34.929, 138.601],
  'Australia/Darwin': ['Darwin', -12.463, 130.846],
  'Australia/Brisbane': ['Brisbane', -27.47, 153.026],
  'Australia/Sydney': ['Sydney', -33.869, 151.209],
  'Australia/Melbourne': ['Melbourne', -37.814, 144.963],
  'Australia/Hobart': ['Hobart', -42.882, 147.327],
  'Pacific/Auckland': ['Auckland', -36.848, 174.763],
};

const GREENWICH: Place = { name: 'Greenwich', lat: 51.4769, lon: -0.0005, zone: 'Europe/London', zoneLon: 0 };

/** Minutes east of UTC that a zone's clocks show at an instant. */
export function offsetAt(zone: string, ms: number): number {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(ms)
      .find((p) => p.type === 'timeZoneName')?.value;
    const m = part?.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  } catch {
    return 0;
  }
}

/** A zone's standard offset in minutes: summer time only ever moves clocks forward, so it is the smaller of January's and July's. */
export function standardOffset(zone: string, year: number): number {
  return Math.min(offsetAt(zone, Date.UTC(year, 0, 15)), offsetAt(zone, Date.UTC(year, 6, 15)));
}

export function validZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** A place keeping a named zone's clocks. */
export function placeIn(name: string, lat: number, lon: number, zone: string | null, year: number): Place {
  if (validZone(zone)) return { name, lat, lon, zone, zoneLon: standardOffset(zone, year) / 4 };
  return { name, lat, lon, zone: null, zoneLon: Math.round(lon / 15) * 15 };
}

export function guessPlace(year: number): Place {
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* no zone: Greenwich */
  }
  const city = ZONE_CITY[zone];
  if (city) return placeIn(city[0], city[1], city[2], zone, year);
  return GREENWICH;
}

/** Minutes east of UTC on the place's clocks at an instant, summer time included. */
export function clockOffset(place: Place, ms: number): number {
  return place.zone ? offsetAt(place.zone, ms) : place.zoneLon * 4;
}

/** The instant a place's clocks show a given wall time on a given calendar day. */
export function instantOf(place: Place, y: number, mo: number, d: number, minutes: number): number {
  const naive = Date.UTC(y, mo, d) + minutes * 60e3;
  let ms = naive - clockOffset(place, naive) * 60e3;
  ms = naive - clockOffset(place, ms) * 60e3;
  return ms;
}

/** The calendar day and wall-clock minutes a place's clocks show at an instant. */
export function wallOf(place: Place, ms: number): { y: number; mo: number; d: number; minutes: number } {
  const local = new Date(ms + clockOffset(place, ms) * 60e3);
  return {
    y: local.getUTCFullYear(),
    mo: local.getUTCMonth(),
    d: local.getUTCDate(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60,
  };
}

export function zoneLabel(place: Place): string {
  const h = place.zoneLon / 15;
  const sign = h < 0 ? '−' : '+';
  const a = Math.abs(h);
  const whole = Math.floor(a);
  const min = Math.round((a - whole) * 60);
  return `UTC${sign}${whole}${min ? ':' + String(min).padStart(2, '0') : ''}`;
}
