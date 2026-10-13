// Global Seismographic Network stations (network IU, location 00) that serve
// a long-period vertical channel, LHZ: one sample a second. Coordinates,
// vault depths, sensors, and sensitivities are from the FDSN station service.

export interface Station {
  code: string;
  place: string;
  region: string;
  lat: number;
  lon: number;
  /** Elevation of the site, metres. */
  elev: number;
  /** Depth of the sensor below the surface, metres. */
  depth: number;
  sensor: string;
  /** Counts per metre per second of ground velocity. */
  scale: number;
  /** IANA zone for the margin's local clock. */
  zone: string;
}

export const STATIONS: Station[] = [
  { code: 'ANMO', place: 'Albuquerque', region: 'New Mexico', lat: 34.94591, lon: -106.4572, elev: 1632.7, depth: 188, sensor: 'Streckeisen STS-6A', scale: 1.97536e9, zone: 'America/Denver' },
  { code: 'HRV', place: 'Harvard', region: 'Massachusetts', lat: 42.5064, lon: -71.5583, elev: 100, depth: 100, sensor: 'Velocity sensor', scale: 1.97537e9, zone: 'America/New_York' },
  { code: 'COLA', place: 'College Outpost', region: 'Alaska', lat: 64.873566, lon: -147.861772, elev: 84, depth: 116, sensor: 'Velocity sensor', scale: 1.97537e9, zone: 'America/Anchorage' },
  { code: 'POHA', place: 'Pohakuloa', region: 'Hawaii', lat: 19.7573, lon: -155.5326, elev: 1913, depth: 77, sensor: 'Velocity sensor', scale: 1.97537e9, zone: 'Pacific/Honolulu' },
  { code: 'SFJD', place: 'Kangerlussuaq', region: 'Greenland', lat: 66.9961, lon: -50.62076, elev: 330, depth: 0, sensor: 'Streckeisen STS-1', scale: 4.04589e9, zone: 'America/Nuuk' },
  { code: 'KONO', place: 'Kongsberg', region: 'Norway', lat: 59.6521, lon: 9.5946, elev: 216, depth: 342, sensor: 'Streckeisen STS-6A', scale: 1.97536e9, zone: 'Europe/Oslo' },
  { code: 'PAB', place: 'San Pablo', region: 'Spain', lat: 39.5446, lon: -4.3499, elev: 948, depth: 2, sensor: 'Streckeisen STS-6A', scale: 1.97536e9, zone: 'Europe/Madrid' },
  { code: 'LSZ', place: 'Lusaka', region: 'Zambia', lat: -15.2779, lon: 28.1882, elev: 1200, depth: 0, sensor: 'Streckeisen STS-1', scale: 5.24647e9, zone: 'Africa/Lusaka' },
  { code: 'TSUM', place: 'Tsumeb', region: 'Namibia', lat: -19.20227, lon: 17.58376, elev: 1132, depth: 97, sensor: 'Streckeisen STS-6A', scale: 1.97536e9, zone: 'Africa/Windhoek' },
  { code: 'MAJO', place: 'Matsushiro', region: 'Japan', lat: 36.54567, lon: 138.20406, elev: 405, depth: 0, sensor: 'Streckeisen STS-6A', scale: 1.97536e9, zone: 'Asia/Tokyo' },
  { code: 'TATO', place: 'Taipei', region: 'Taiwan', lat: 24.9735, lon: 121.4971, elev: 75, depth: 85, sensor: 'Velocity sensor', scale: 1.97537e9, zone: 'Asia/Taipei' },
  { code: 'GUMO', place: 'Guam', region: 'Mariana Islands', lat: 13.5893, lon: 144.8684, elev: 49, depth: 93, sensor: 'Velocity sensor', scale: 2.43624e9, zone: 'Pacific/Guam' },
  { code: 'CTAO', place: 'Charters Towers', region: 'Queensland', lat: -20.08765, lon: 146.24998, elev: 366, depth: 1, sensor: 'Velocity sensor', scale: 1.97537e9, zone: 'Australia/Brisbane' },
  { code: 'SNZO', place: 'South Karori', region: 'New Zealand', lat: -41.3087, lon: 174.7043, elev: 29, depth: 91, sensor: 'Streckeisen STS-6A', scale: 1.97536e9, zone: 'Pacific/Auckland' },
  { code: 'PMSA', place: 'Palmer Station', region: 'Antarctica', lat: -64.7744, lon: -64.0489, elev: 10, depth: 0, sensor: 'Velocity sensor', scale: 4.01086e9, zone: 'America/Punta_Arenas' },
];

export const DEFAULT_STATION = 'ANMO';
