// A tower bell rung full circle: the bell is a pendulum on its headstock that rests mouth up against its
// stay, and the clapper is a second pendulum hung from the crown inside it. Neither is scripted: the
// clapper strikes the soundbow when the bell slows on the rising side and the clapper carries on.
//
// Angles are radians from mouth down. Handstroke set is +SET, backstroke set is -SET; a pull on the sally
// sends the bell from handstroke to backstroke, a pull on the tail end sends it back.

export const G = 9.81;
/** Bell pendulum frequency (sqrt(g / L) for its equivalent length). */
export const OMEGA = 5.8;
/** How far past the balance point the stay lets the bell rest. */
export const STAY = 0.12;
export const SET = Math.PI + STAY;
/** Clapper: crown pivot below the headstock axis, flight length, and the swing before it meets the soundbow. */
// Scaled with the bell's frequency, so the pair keep the same proportions whatever the tempo.
export const CROWN = 0.07 * (4.6 / OMEGA) ** 2;
export const CLAPPER = 0.34 * (4.6 / OMEGA) ** 2;
export const CLAPPER_FREE = 0.36;
/** Energy the pull leaves the bell with, as a fraction above what just reaches balance. */
export const PULL_MARGIN = 0.035;
const PULL_TORQUE = 1.25 * OMEGA * OMEGA;
const STAY_BOUNCE = 0.12;
const CLAPPER_BOUNCE = 0.22;
const STRIKE_MIN = 0.26 * OMEGA; // rad/s of relative speed for an audible blow
/** Past this angle the bell is near its balance, where the clapper only rolls across the mouth. */
const QUIET_ABOVE = Math.PI * 0.8;
const DT = 1 / 960;

export interface Strike {
  /** Simulation time of the blow. */
  t: number;
  /** Relative speed of clapper on soundbow, for loudness. */
  speed: number;
  /** Which stroke the bell was ringing: the sally (hand) or the tail end (back). */
  stroke: 'hand' | 'back';
}

export class Bell {
  theta = SET;
  omega = 0;
  phi: number;
  phiDot = 0;
  /** The bell rests against its stay. */
  set = true;
  /** Pull in progress: torque direction (-1 hand, +1 back), or 0. */
  pulling = 0;
  /** The stroke that the bell is on its way to ring (or rests ready to ring). */
  next: 'hand' | 'back' = 'hand';
  /** Already struck on this stroke: one blow per stroke. */
  struck = false;
  t = 0;

  constructor(warm = true) {
    this.phi = this.theta - CLAPPER_FREE; // clapper resting on the soundbow's lower side
    if (warm) {
      // Ring it down and back once, unheard, so the clapper lies where ringing leaves it.
      for (let i = 0; i < 2; i++) {
        this.pull();
        for (let k = 0; k < 400 && !(this.set && k > 10); k++) this.step(1 / 120);
      }
      this.t = 0;
    }
  }

  /** Energy per unit inertia, with zero at the horizontal; balance is OMEGA^2. */
  energy(): number {
    return 0.5 * this.omega * this.omega - OMEGA * OMEGA * Math.cos(this.theta);
  }

  /** True when a pull now would take: the bell is up near the balance it should be pulled from. */
  canPull(): boolean {
    if (this.pulling) return false;
    if (this.set) return true;
    // Rising towards a balance, or falling back from one, in its top third.
    return Math.abs(this.theta) > Math.PI * 0.68;
  }

  /** Start a pull. The rope can only send the bell back the way it came. */
  pull(): boolean {
    if (!this.canPull()) return false;
    this.pulling = this.theta > 0 ? -1 : 1;
    this.next = this.pulling < 0 ? 'hand' : 'back';
    this.struck = false;
    this.set = false;
    return true;
  }

  /** Advance by dt seconds; calls onStrike for each blow. */
  step(dt: number, onStrike?: (s: Strike) => void): void {
    let left = dt;
    while (left > 1e-9) {
      const h = Math.min(DT, left);
      left -= h;
      this.substep(h, onStrike);
    }
  }

  private substep(h: number, onStrike?: (s: Strike) => void): void {
    this.t += h;
    const target = OMEGA * OMEGA * (1 + PULL_MARGIN);
    let torque = 0;
    if (this.pulling) {
      const goingRight = Math.sign(this.omega) === this.pulling;
      if (goingRight && this.energy() >= target) {
        this.pulling = 0;
      } else {
        torque = this.pulling * PULL_TORQUE;
      }
    }
    let alpha = -OMEGA * OMEGA * Math.sin(this.theta) + torque;
    if (this.set) {
      alpha = 0;
      this.omega = 0;
    }
    // Semi-implicit Euler for the bell.
    this.omega += alpha * h;
    this.theta += this.omega * h;
    // The stay meets the slider.
    if (this.theta > SET) {
      this.theta = SET;
      this.omega = this.omega > 0 ? -this.omega * STAY_BOUNCE : this.omega;
      if (Math.abs(this.omega) < 0.25 && !this.pulling) this.settle();
    } else if (this.theta < -SET) {
      this.theta = -SET;
      this.omega = this.omega < 0 ? -this.omega * STAY_BOUNCE : this.omega;
      if (Math.abs(this.omega) < 0.25 && !this.pulling) this.settle();
    }

    // Clapper: a pendulum on a pivot that the bell carries round.
    const rel = this.phi - this.theta;
    const accel =
      (-G * Math.sin(this.phi) - CROWN * (alpha * Math.cos(-rel) - this.omega * this.omega * Math.sin(-rel))) / CLAPPER;
    this.phiDot += (accel - 0.09 * OMEGA * (this.phiDot - this.omega)) * h;
    this.phi += this.phiDot * h;
    const r = this.phi - this.theta;
    if (Math.abs(r) > CLAPPER_FREE) {
      const side = Math.sign(r);
      const relV = this.phiDot - this.omega;
      this.phi = this.theta + side * CLAPPER_FREE;
      if (relV * side > 0) {
        // A blow counts on the rising side of the swing, below the balance; elsewhere the clapper only rolls.
        const rising = this.theta * this.omega > 0 && Math.abs(this.theta) > 0.3;
        if (relV * side > STRIKE_MIN && !this.struck && !this.set && rising && Math.abs(this.theta) < QUIET_ABOVE) {
          this.struck = true;
          onStrike?.({ t: this.t, speed: Math.abs(relV), stroke: this.next });
        }
        this.phiDot = this.omega - relV * CLAPPER_BOUNCE;
      }
    }
  }

  private settle(): void {
    this.set = true;
    this.omega = 0;
    this.next = this.theta > 0 ? 'hand' : 'back';
  }

  /** Rope travel: 0 with the bell at handstroke set, 1 at backstroke set. */
  rope(): number {
    return (SET - this.theta) / (2 * SET);
  }
}

/**
 * How long after a pull from set the bell strikes, found by ringing a model bell once.
 * Band ringers pull this long before they mean to strike.
 */
export function strikeDelay(): number {
  const b = new Bell();
  b.pull();
  let hit = -1;
  for (let i = 0; i < 4000 && hit < 0; i++) b.step(1 / 480, (s) => (hit = s.t));
  return hit;
}
