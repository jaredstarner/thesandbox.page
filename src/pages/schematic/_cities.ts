// The cities drawn from snapshots in _data/, in the order the picker shows them.

export interface City {
  id: string;
  name: string;
  /** What the system is called locally, shown under the city name. */
  system: string;
}

export const CITIES: City[] = [
  { id: 'vienna', name: 'Vienna', system: 'U-Bahn' },
  { id: 'london', name: 'London', system: 'Underground' },
  { id: 'paris', name: 'Paris', system: 'Métro' },
  { id: 'berlin', name: 'Berlin', system: 'U-Bahn' },
  { id: 'madrid', name: 'Madrid', system: 'Metro' },
  { id: 'mexico', name: 'Mexico City', system: 'Metro' },
  { id: 'tokyo', name: 'Tokyo', system: 'Subway' },
  { id: 'washington', name: 'Washington', system: 'Metrorail' },
  { id: 'montreal', name: 'Montreal', system: 'Métro' },
  { id: 'buenosaires', name: 'Buenos Aires', system: 'Subte' },
  { id: 'singapore', name: 'Singapore', system: 'MRT' },
  { id: 'stockholm', name: 'Stockholm', system: 'Tunnelbana' },
];
