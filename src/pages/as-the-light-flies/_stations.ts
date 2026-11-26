// The landmarks: Amazon's public cloud regions, each answering a tiny health check over HTTPS with
// an open CORS header. Positions are the metro areas the regions are named for, not the buildings,
// which sit within a few tens of kilometres of them.

export interface Station {
  /** The region's code, which is also its host name. */
  id: string;
  /** The place the region is named for. */
  name: string;
  /** Country or state, for the ledger. */
  where: string;
  lat: number;
  lon: number;
}

export const STATIONS: Station[] = [
  { id: 'us-east-1', name: 'N. Virginia', where: 'United States', lat: 39.04, lon: -77.49 },
  { id: 'us-east-2', name: 'Ohio', where: 'United States', lat: 40.0, lon: -83.0 },
  { id: 'us-west-1', name: 'N. California', where: 'United States', lat: 37.35, lon: -121.96 },
  { id: 'us-west-2', name: 'Oregon', where: 'United States', lat: 45.84, lon: -119.7 },
  { id: 'ca-central-1', name: 'Montréal', where: 'Canada', lat: 45.5, lon: -73.57 },
  { id: 'ca-west-1', name: 'Calgary', where: 'Canada', lat: 51.05, lon: -114.07 },
  { id: 'mx-central-1', name: 'Querétaro', where: 'Mexico', lat: 20.59, lon: -100.39 },
  { id: 'sa-east-1', name: 'São Paulo', where: 'Brazil', lat: -23.55, lon: -46.63 },
  { id: 'eu-west-1', name: 'Dublin', where: 'Ireland', lat: 53.35, lon: -6.26 },
  { id: 'eu-west-2', name: 'London', where: 'United Kingdom', lat: 51.51, lon: -0.13 },
  { id: 'eu-west-3', name: 'Paris', where: 'France', lat: 48.86, lon: 2.35 },
  { id: 'eu-central-1', name: 'Frankfurt', where: 'Germany', lat: 50.11, lon: 8.68 },
  { id: 'eu-central-2', name: 'Zürich', where: 'Switzerland', lat: 47.37, lon: 8.54 },
  { id: 'eu-north-1', name: 'Stockholm', where: 'Sweden', lat: 59.33, lon: 18.07 },
  { id: 'eu-south-1', name: 'Milan', where: 'Italy', lat: 45.46, lon: 9.19 },
  { id: 'eu-south-2', name: 'Aragón', where: 'Spain', lat: 41.65, lon: -0.88 },
  { id: 'il-central-1', name: 'Tel Aviv', where: 'Israel', lat: 32.08, lon: 34.78 },
  { id: 'me-south-1', name: 'Bahrain', where: 'Bahrain', lat: 26.07, lon: 50.56 },
  { id: 'me-central-1', name: 'Abu Dhabi', where: 'United Arab Emirates', lat: 24.45, lon: 54.38 },
  { id: 'af-south-1', name: 'Cape Town', where: 'South Africa', lat: -33.92, lon: 18.42 },
  { id: 'ap-south-1', name: 'Mumbai', where: 'India', lat: 19.08, lon: 72.88 },
  { id: 'ap-south-2', name: 'Hyderabad', where: 'India', lat: 17.39, lon: 78.49 },
  { id: 'ap-southeast-1', name: 'Singapore', where: 'Singapore', lat: 1.35, lon: 103.82 },
  { id: 'ap-southeast-5', name: 'Kuala Lumpur', where: 'Malaysia', lat: 3.14, lon: 101.69 },
  { id: 'ap-southeast-7', name: 'Bangkok', where: 'Thailand', lat: 13.76, lon: 100.5 },
  { id: 'ap-southeast-3', name: 'Jakarta', where: 'Indonesia', lat: -6.21, lon: 106.85 },
  { id: 'ap-east-1', name: 'Hong Kong', where: 'China', lat: 22.32, lon: 114.17 },
  { id: 'ap-east-2', name: 'Taipei', where: 'Taiwan', lat: 25.03, lon: 121.57 },
  { id: 'ap-northeast-2', name: 'Seoul', where: 'South Korea', lat: 37.57, lon: 126.98 },
  { id: 'ap-northeast-3', name: 'Osaka', where: 'Japan', lat: 34.69, lon: 135.5 },
  { id: 'ap-northeast-1', name: 'Tokyo', where: 'Japan', lat: 35.68, lon: 139.69 },
  { id: 'ap-southeast-2', name: 'Sydney', where: 'Australia', lat: -33.87, lon: 151.21 },
  { id: 'ap-southeast-4', name: 'Melbourne', where: 'Australia', lat: -37.81, lon: 144.96 },
  { id: 'ap-southeast-6', name: 'Auckland', where: 'New Zealand', lat: -36.85, lon: 174.76 },
];

/** The health check each region answers: a few bytes of plain text. */
export const pingUrl = (id: string) => `https://dynamodb.${id}.amazonaws.com/ping`;
