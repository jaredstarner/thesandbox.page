// Playing a hooked fish. The fish alternates runs and rests, and tires as it
// pulls. Reeling into a run drives the line's tension past its limit, and a
// line held over the limit too long snaps. Letting a resting fish sit on a
// slack line gives it the chance to shake the hook. So: reel while it rests,
// let go while it runs.

export interface Puller {
  power: number;
  endurance: number;
}

export type FightResult = 'on' | 'snap' | 'slack';

/** Seconds of slack line before the fish shakes free. */
export const SLACK_LIMIT = 3;

export class Fight {
  stamina = 1;
  running = true;
  /** 0 to about 1.3; past 1 the line is straining. */
  tension = 0;
  /** Builds while tension is over the limit; the line snaps at 1. */
  strain = 0;
  slack = 0;
  /** Run direction in radians: 0 is straight away from the dock, positive dives. */
  heading = 0;
  private phase = 0;

  constructor(
    private readonly fish: Puller,
    private readonly rand: () => number = Math.random,
  ) {
    this.startRun();
  }

  /** How hard the fish pulls right now, 0 to about 1. */
  get pull(): number {
    return this.fish.power * (0.35 + 0.65 * this.stamina) * (this.running ? 1 : 0.22);
  }

  private startRun(): void {
    this.running = true;
    this.phase = (0.8 + this.rand() * 1.4) * (0.5 + this.stamina);
    this.heading = -0.35 + this.rand() * 1.2;
  }

  private startRest(): void {
    this.running = false;
    this.phase = 0.8 + this.rand() * 1.3;
  }

  step(dt: number, reeling: boolean, slackLine: boolean): FightResult {
    this.phase -= dt;
    if (this.phase <= 0) {
      if (this.running) this.startRest();
      else if (this.rand() < 0.3 + 0.6 * this.stamina) this.startRun();
      else this.startRest();
    }

    const target = reeling ? 0.25 + this.pull * 1.3 : this.pull * 0.35;
    this.tension += (target - this.tension) * Math.min(1, dt * 5);
    if (this.tension > 1) this.strain += dt * (0.6 + (this.tension - 1) * 1.5);
    else this.strain = Math.max(0, this.strain - dt * 0.7);
    if (this.strain >= 1) return 'snap';

    const effort = 0.02 + 0.1 * this.tension * (reeling ? 1 : 0.35);
    this.stamina = Math.max(0, this.stamina - (dt * effort) / this.fish.endurance);

    if (slackLine && !reeling) this.slack += dt;
    else this.slack = Math.max(0, this.slack - dt * 2);
    if (this.slack > SLACK_LIMIT) return 'slack';
    return 'on';
  }
}
