// /breadboard/: the kit booklet. Each project is a board layout plus a short note on how it works.
// Holes: a row letter and column (`c8`), or a rail and column (`T+8`, `T-8`, `B-8`, `B+8`).

import type { Part } from './_parts';

type Spec = Omit<Part, 'id'>;

export interface Project {
  id: string;
  title: string;
  note: string;
  tries: string[];
  parts: Spec[];
}

const w = (a: string, b: string, color: string): Spec => ({ kind: 'wire', a, b, color });
const r = (a: string, b: string, value: number): Spec => ({ kind: 'res', a, b, value });
const led = (a: string, b: string, color: string): Spec => ({ kind: 'led', a, b, color });
const ecap = (a: string, b: string, value: number): Spec => ({ kind: 'ecap', a, b, value });
const cap = (a: string, b: string, value: number): Spec => ({ kind: 'cap', a, b, value });

/** Every board starts with the battery on the top rails and both rail pairs joined at the left. */
const BASE: Spec[] = [
  { kind: 'battery', a: 'T+1', b: 'T-1' },
  w('T+2', 'B+2', 'red'),
  w('T-3', 'B-3', 'black'),
];

const CHASER_LEDS = [19, 20, 21, 22, 23, 25, 26, 27, 28, 29];
const CHASER_COLORS = ['red', 'red', 'yellow', 'yellow', 'green', 'green', 'yellow', 'yellow', 'red', 'red'];

export const PROJECTS: Project[] = [
  {
    id: 'led',
    title: 'Light an LED',
    note: 'Current leaves the + rail, runs through a 470 Ω resistor and a red LED, and returns along the − rail. The resistor sets the current: about 15 mA here, inside what a small LED is happy with.',
    tries: [
      'Select the resistor and step it down to 100 Ω. The LED gets brighter, and its current climbs past what it is rated for.',
      'Drag the resistor off the board and bridge the gap with a wire.',
      'Turn the LED round by dragging its legs past each other.',
    ],
    parts: [...BASE, w('T+8', 'a8', 'red'), r('c8', 'c12', 470), led('e12', 'e13', 'red'), w('a13', 'T-13', 'black')],
  },
  {
    id: 'button',
    title: 'Push button',
    note: 'The button straddles the channel. Its legs in each column are always joined; pressing it joins column 10 to column 12, which closes the loop through the resistor and LED.',
    tries: [
      'Hold the button down.',
      'Move the button so all four legs sit in the top half. The columns are now joined whether you press it or not.',
    ],
    parts: [
      ...BASE,
      w('T+10', 'a10', 'red'),
      { kind: 'button', at: 'f10', rot: 0 },
      r('h12', 'h16', 470),
      led('i16', 'i17', 'green'),
      w('j17', 'B-17', 'black'),
    ],
  },
  {
    id: 'dimmer',
    title: 'Dimmer',
    note: 'The trimmer is a 10 kΩ track with a wiper riding on it. Turning the slot changes how much of the track sits in series with the 330 Ω resistor, and so how much current reaches the LED.',
    tries: [
      'Drag around the trimmer’s slot to turn it.',
      'Set the meter to mA, put the red probe in T+8 and the black in a8, then pull the red wire. The meter now carries the current.',
    ],
    parts: [
      ...BASE,
      w('T+8', 'a8', 'red'),
      { kind: 'pot', at: 'e8', rot: 0, pos: 0.2 },
      r('b9', 'b13', 330),
      led('d13', 'd14', 'yellow'),
      w('a14', 'T-14', 'black'),
    ],
  },
  {
    id: 'fade',
    title: 'Fade out',
    note: 'Holding the button charges the 470 µF capacitor straight from the battery. Let go, and the capacitor empties through the 1 kΩ resistor and the LED, so the light dies away over a couple of seconds instead of snapping off.',
    tries: [
      'Press and release the button.',
      'Swap the resistor for 10 kΩ. The glow is dimmer and lasts far longer.',
      'Turn the capacitor round. Electrolytics do not take reverse voltage for long.',
    ],
    parts: [
      ...BASE,
      w('T+8', 'a8', 'red'),
      { kind: 'button', at: 'f8', rot: 0 },
      ecap('j10', 'B-10', 470e-6),
      r('g10', 'g15', 1e3),
      led('j15', 'B-15', 'red'),
    ],
  },
  {
    id: 'night',
    title: 'Night light',
    note: 'The light-dependent resistor and the 47 kΩ resistor form a divider. In the dark the LDR’s resistance climbs, the divider’s middle rises past about 0.6 V, the transistor turns on, and the LED lights.',
    tries: [
      'Switch the lamp off.',
      'Press and hold the LDR to cover it with a finger.',
      'Probe column 9 with the meter on volts as the light changes.',
    ],
    parts: [
      ...BASE,
      r('T+9', 'a9', 47e3),
      { kind: 'ldr', a: 'e9', b: 'f9' },
      w('j9', 'B-9', 'black'),
      r('c9', 'c14', 10e3),
      { kind: 'npn', at: 'b13', rot: 0 },
      w('a13', 'T-13', 'black'),
      w('e15', 'f15', 'blue'),
      led('g16', 'g15', 'white'),
      r('h16', 'B+16', 470),
    ],
  },
  {
    id: 'blinker',
    title: 'Blinker',
    note: 'The NE555 charges the 10 µF capacitor through 10 kΩ and 68 kΩ, and drains it through the 68 kΩ alone. Its output flips each time the capacitor reaches two-thirds or one-third of the supply, which with these values comes to about one flash a second.',
    tries: [
      'Swap the 68 kΩ for 22 kΩ and the flashes quicken.',
      'Swap the 10 µF for 1 µF. At ten flashes a second the LED starts to look steady.',
      'Probe the capacitor (columns 9 and 8, bottom half) on volts and watch it swing between 3 and 6 V.',
    ],
    parts: [
      ...BASE,
      { kind: 'ne555', at: 'f8', rot: 0 },
      w('a8', 'T+8', 'red'),
      w('j8', 'B-8', 'black'),
      w('j11', 'B+11', 'red'),
      r('T+9', 'a9', 10e3),
      r('b9', 'b10', 68e3),
      w('d10', 'g9', 'blue'),
      ecap('h9', 'h8', 10e-6),
      cap('a11', 'T-11', 10e-9),
      r('g10', 'g14', 470),
      led('j14', 'B-14', 'red'),
    ],
  },
  {
    id: 'chaser',
    title: 'Chaser',
    note: 'A faster 555 clocks a CD4017 decade counter. The counter holds one of its ten outputs high and moves to the next on every rising edge of the clock, so the light runs down the row of LEDs and starts again.',
    tries: [
      'Pull the blue clock wire out of b12 and the chase stops where it is.',
      'Move the wire from a13 to the + rail. Pin 13 high inhibits the clock.',
      'Swap the 22 kΩ for 68 kΩ to slow it down.',
    ],
    parts: [
      ...BASE,
      { kind: 'ne555', at: 'f4', rot: 0 },
      w('a4', 'T+4', 'red'),
      w('j4', 'B-4', 'black'),
      w('j7', 'B+7', 'red'),
      r('T+5', 'a5', 1e3),
      r('b5', 'b6', 22e3),
      w('d6', 'g5', 'blue'),
      ecap('h5', 'h4', 10e-6),
      cap('a7', 'T-7', 10e-9),
      w('h6', 'b12', 'blue'),
      { kind: 'cd4017', at: 'f10', rot: 0 },
      w('a10', 'T+10', 'red'),
      w('a11', 'T-11', 'black'),
      w('a13', 'T-13', 'black'),
      w('j17', 'B-17', 'black'),
      w('g12', 'g19', 'orange'),
      w('g11', 'h20', 'yellow'),
      w('g13', 'i21', 'green'),
      w('g16', 'f22', 'white'),
      w('b16', 'f23', 'orange'),
      w('g10', 'i25', 'yellow'),
      w('g14', 'h26', 'green'),
      w('g15', 'g27', 'white'),
      w('b17', 'g28', 'orange'),
      w('b15', 'h29', 'yellow'),
      ...CHASER_LEDS.map((c, i) => led(`j${c}`, `B-${c}`, CHASER_COLORS[i])),
    ],
  },
  {
    id: 'beeper',
    title: 'Beeper',
    note: 'The same 555 timer, set to about 1.4 Hz with a 47 kΩ resistor, switches a buzzer on and off. The buzzer has its own oscillator inside; it only needs a steady supply the right way round.',
    tries: ['Switch the sound on.', 'Turn the buzzer round.', 'Swap the 47 kΩ for 10 kΩ for a hurried beep.'],
    parts: [
      ...BASE,
      { kind: 'ne555', at: 'f8', rot: 0 },
      w('a8', 'T+8', 'red'),
      w('j8', 'B-8', 'black'),
      w('j11', 'B+11', 'red'),
      r('T+9', 'a9', 10e3),
      r('b9', 'b10', 47e3),
      w('d10', 'g9', 'blue'),
      ecap('h9', 'h8', 10e-6),
      cap('a11', 'T-11', 10e-9),
      { kind: 'buzzer', at: 'f14', rot: 3 },
      w('i10', 'i14', 'yellow'),
      w('a14', 'T-14', 'black'),
    ],
  },
  {
    id: 'blank',
    title: 'Blank board',
    note: 'The battery and the two rail jumpers, nothing else. Drag parts in from the drawer, and drag from any empty hole to run a wire.',
    tries: [
      'Hover over a hole to see which others it is joined to.',
      'Drop a part off the board to put it back in the drawer.',
    ],
    parts: [...BASE],
  },
];
