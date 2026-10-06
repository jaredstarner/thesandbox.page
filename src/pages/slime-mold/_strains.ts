// Named rule sets for the agents. Angles are in degrees here and converted
// for the GPU in toRules().

import type { Rules } from './_plate';

export interface Strain {
  name: string;
  sensorAngle: number;
  sensorDist: number;
  turnAngle: number;
  stepSize: number;
  deposit: number;
  /** Percent of the trail lost each step. */
  fade: number;
}

export const STRAINS: Strain[] = [
  { name: 'Network', sensorAngle: 22.5, sensorDist: 9, turnAngle: 45, stepSize: 1, deposit: 5, fade: 10 },
  { name: 'Ropes', sensorAngle: 12, sensorDist: 26, turnAngle: 20, stepSize: 1.4, deposit: 4, fade: 6 },
  { name: 'Lattice', sensorAngle: 45, sensorDist: 18, turnAngle: 45, stepSize: 1, deposit: 5, fade: 12 },
  { name: 'Foam', sensorAngle: 70, sensorDist: 6, turnAngle: 70, stepSize: 1, deposit: 6, fade: 15 },
];

export interface Dial {
  key: keyof Omit<Strain, 'name'>;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

export const DIALS: Dial[] = [
  { key: 'sensorAngle', label: 'Sensor angle', min: 2, max: 90, step: 0.5, unit: '°' },
  { key: 'sensorDist', label: 'Sensor reach', min: 2, max: 40, step: 0.5, unit: ' cells' },
  { key: 'turnAngle', label: 'Turn', min: 2, max: 90, step: 0.5, unit: '°' },
  { key: 'stepSize', label: 'Stride', min: 0.4, max: 3, step: 0.1, unit: ' cells' },
  { key: 'deposit', label: 'Deposit', min: 0.5, max: 20, step: 0.5, unit: '' },
  { key: 'fade', label: 'Fade', min: 1, max: 40, step: 0.5, unit: '%' },
];

const RAD = Math.PI / 180;

export function toRules(s: Strain): Rules {
  return {
    sensorAngle: s.sensorAngle * RAD,
    sensorDist: s.sensorDist,
    turnAngle: s.turnAngle * RAD,
    stepSize: s.stepSize,
    deposit: s.deposit,
    keep: 1 - s.fade / 100,
    diffuse: 1,
    jitter: 0.12,
  };
}
