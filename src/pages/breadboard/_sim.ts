// /breadboard/: the circuit solver. Modified nodal analysis in SI units with Newton-Raphson
// for the junctions, backward Euler for the capacitors, and behavioural models for the
// 555 timer and the 4017 counter. No DOM, so Node can run it for benches.

export type LedColor = 'red' | 'yellow' | 'green' | 'blue' | 'white';

export type Device =
  | { t: 'res'; id: string; n: [number, number]; r: number }
  | { t: 'pot'; id: string; n: [number, number, number]; r: number; pos: number }
  | { t: 'ldr'; id: string; n: [number, number]; lux: number }
  | { t: 'cap'; id: string; n: [number, number]; c: number; polar: boolean }
  | { t: 'led'; id: string; n: [number, number]; color: LedColor }
  | { t: 'npn'; id: string; n: [number, number, number] } // emitter, base, collector
  | { t: 'button'; id: string; n: [number, number]; pressed: boolean }
  | { t: 'buzzer'; id: string; n: [number, number] }
  | { t: 'battery'; id: string; n: [number, number]; v: number; r: number; on: boolean }
  | { t: 'ne555'; id: string; n: number[] } // pins 1 to 8 in order
  | { t: 'cd4017'; id: string; n: number[] } // pins 1 to 16 in order
  | { t: 'meter'; id: string; n: [number, number]; mode: MeterMode };

export type MeterMode = 'off' | 'V' | 'mA' | 'ohm';

export interface Circuit {
  nets: number;
  ground: number;
  devices: Device[];
}

/** What each part did over the last frame, for drawing and readouts. Kept by part id across rebuilds. */
export interface PartState {
  /** Capacitor voltage, carried between steps (and across rebuilds). */
  v: number;
  /** Last junction voltages used for limiting. */
  j1: number;
  j2: number;
  /** Damage: accumulated stress or temperature rise. */
  stress: number;
  heat: number;
  dead: boolean;
  scorched: boolean;
  /** Frame averages: current (A), voltage (V), and a second channel (base current, wiper voltage). */
  iSum: number;
  vSum: number;
  aSum: number;
  tSum: number;
  /** Logic state for the chips. */
  q: boolean;
  count: number;
  clk: boolean;
  powered: boolean;
  /** 555 output edges, for the frequency readout. */
  lastRise: number;
  period: number;
  highTime: number;
  lastFall: number;
  /** The current that killed a part. */
  peak: number;
  /** Buzzer drive and LDR resistance (low-passed). */
  level: number;
  rLog: number;
}

export interface SimEvent {
  type: 'pop' | 'scorch' | 'burn' | 'burst' | 'fuse' | 'short';
  id: string;
}

const VT = 0.025852;
const GMIN = 1e-9;
const SQRT2 = Math.SQRT2;

interface LedParams {
  is: number;
  n: number;
  rs: number;
}

/** Forward voltage at 20 mA for each colour; red, yellow, and green are the old GaAsP and GaP types. */
const LED_VF: Record<LedColor, number> = { red: 2.0, yellow: 2.1, green: 2.2, blue: 3.1, white: 3.2 };

export function ledParams(color: LedColor): LedParams {
  const n = 2;
  const rs = 8;
  const vd = LED_VF[color] - 0.02 * rs;
  return { is: 0.02 / Math.exp(vd / (n * VT)), n, rs };
}

const NPN = { is: 1e-14, bf: 200, br: 4 };

/** SPICE's pnjlim: keep a junction's Newton step from overshooting the exponential. */
function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    }
    return vt * Math.log(vnew / vt);
  }
  return vnew;
}

function safeExp(x: number): number {
  return Math.exp(Math.min(x, 80));
}

export function ldrResistance(lux: number): number {
  const r = 20e3 * Math.pow(Math.max(lux, 0.01) / 10, -0.7);
  return Math.min(2e6, Math.max(200, r));
}

export const Q_PINS_4017 = [3, 2, 4, 7, 10, 1, 5, 6, 9, 11];

function freshState(): PartState {
  return {
    v: 0,
    j1: 0,
    j2: 0,
    stress: 0,
    heat: 0,
    dead: false,
    scorched: false,
    iSum: 0,
    vSum: 0,
    aSum: 0,
    tSum: 0,
    q: false,
    count: 0,
    clk: false,
    powered: false,
    lastRise: -1,
    period: 0,
    highTime: 0,
    lastFall: -1,
    peak: 0,
    level: 0,
    rLog: Math.log(20e3),
  };
}

interface Compiled {
  dev: Device;
  st: PartState;
  /** Unknown indices of internal nodes (LED junction, 555 divider tap). */
  int: number;
  led?: LedParams;
}

export class Sim {
  readonly states = new Map<string, PartState>();
  events: SimEvent[] = [];
  time = 0;
  dt = 0.5e-3;
  /** Battery current out of its + terminal, last step. */
  batteryCurrent = 0;
  meterReading = 0;
  meterFuse = true;
  /** Newton steps that did not converge since load. */
  misses = 0;

  private devs: Compiled[] = [];
  private size = 0;
  private map: Int32Array = new Int32Array(1);
  private x = new Float64Array(0);
  private xn = new Float64Array(0);
  private A = new Float64Array(0);
  private b = new Float64Array(0);
  private shortTimer = 0;
  private fuseTimer = 0;

  state(id: string): PartState {
    let s = this.states.get(id);
    if (!s) {
      s = freshState();
      this.states.set(id, s);
    }
    return s;
  }

  forget(id: string) {
    this.states.delete(id);
  }

  load(circuit: Circuit) {
    // Net index to unknown index; the ground net is -1.
    this.map = new Int32Array(circuit.nets);
    let k = 0;
    for (let i = 0; i < circuit.nets; i++) this.map[i] = i === circuit.ground ? -1 : k++;
    this.devs = [];
    for (const dev of circuit.devices) {
      const c: Compiled = { dev, st: this.state(dev.id), int: -1 };
      if (dev.t === 'led') {
        c.led = ledParams(dev.color);
        c.int = k++;
      } else if (dev.t === 'ne555') {
        c.int = k++;
      }
      this.devs.push(c);
    }
    this.size = k;
    this.x = new Float64Array(k);
    this.xn = new Float64Array(k);
    this.A = new Float64Array(k * k);
    this.b = new Float64Array(k);
    // Warm start: settle the operating point with capacitors held at their stored voltages.
    for (let i = 0; i < 3; i++) this.solve(false);
  }

  /** Voltage of a net relative to the ground net. */
  v(net: number): number {
    const i = this.map[net];
    return i === undefined || i < 0 ? 0 : this.x[i];
  }

  private vi(i: number): number {
    return i < 0 ? 0 : this.x[i];
  }

  /** Run the circuit forward by `seconds` of simulated time. */
  run(seconds: number) {
    const steps = Math.max(1, Math.round(seconds / this.dt));
    for (let s = 0; s < steps; s++) {
      this.solve(true);
      this.post();
      this.time += this.dt;
    }
  }

  /** Clear the frame averages; call once per drawn frame after reading them. */
  resetAverages() {
    for (const c of this.devs) {
      c.st.iSum = 0;
      c.st.vSum = 0;
      c.st.aSum = 0;
      c.st.tSum = 0;
    }
  }

  private solve(transient: boolean) {
    const n = this.size;
    if (n === 0) return;
    const { A, b, x, xn } = this;
    let converged = false;
    for (let iter = 0; iter < 60; iter++) {
      A.fill(0);
      b.fill(0);
      for (let i = 0; i < n; i++) A[i * n + i] = GMIN;
      for (const c of this.devs) this.stamp(c, transient);
      if (!luSolve(A, b, xn, n)) break;
      let ok = true;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(xn[i] - x[i]);
        if (d > 1e-6 + 1e-4 * Math.abs(xn[i])) ok = false;
        x[i] = xn[i];
      }
      if (ok && iter > 0) {
        converged = true;
        break;
      }
    }
    if (!converged && transient) this.misses++;
  }

  // Stamping helpers on unknown indices; -1 is ground.
  private g(a: number, b: number, g: number) {
    const { A, size: n } = this;
    if (a >= 0) A[a * n + a] += g;
    if (b >= 0) A[b * n + b] += g;
    if (a >= 0 && b >= 0) {
      A[a * n + b] -= g;
      A[b * n + a] -= g;
    }
  }

  /** A current source pushing `i` amps into node a and out of node b. */
  private src(a: number, b: number, i: number) {
    if (a >= 0) this.b[a] += i;
    if (b >= 0) this.b[b] -= i;
  }

  /** A Thevenin source: node a held `e` volts above node b through `r` ohms. */
  private thev(a: number, b: number, e: number, r: number) {
    this.g(a, b, 1 / r);
    this.src(a, b, e / r);
  }

  private stamp(c: Compiled, transient: boolean) {
    const d = c.dev;
    const st = c.st;
    const m = this.map;
    switch (d.t) {
      case 'res': {
        const a = m[d.n[0]],
          b = m[d.n[1]];
        this.g(a, b, st.dead ? 1e-12 : 1 / d.r);
        break;
      }
      case 'pot': {
        const a = m[d.n[0]],
          w = m[d.n[1]],
          b = m[d.n[2]];
        const p = Math.min(1, Math.max(0, d.pos));
        this.g(a, w, 1 / Math.max(1, d.r * p));
        this.g(w, b, 1 / Math.max(1, d.r * (1 - p)));
        break;
      }
      case 'ldr': {
        this.g(m[d.n[0]], m[d.n[1]], 1 / Math.exp(st.rLog));
        break;
      }
      case 'button': {
        this.g(m[d.n[0]], m[d.n[1]], d.pressed ? 1 / 0.05 : 1e-12);
        break;
      }
      case 'buzzer': {
        // An active buzzer: its oscillator draws roughly as a 330 ohm load when fed the right way round.
        this.g(m[d.n[0]], m[d.n[1]], st.dead ? 1e-12 : st.j1 > 0 ? 1 / 330 : 1e-6);
        break;
      }
      case 'battery': {
        if (d.on) this.thev(m[d.n[0]], m[d.n[1]], d.v, d.r);
        break;
      }
      case 'meter': {
        const a = m[d.n[0]],
          b = m[d.n[1]];
        if (d.mode === 'V') this.g(a, b, 1e-7);
        else if (d.mode === 'mA') this.g(a, b, this.meterFuse ? 1 : 1e-12);
        else if (d.mode === 'ohm') this.thev(a, b, 3, 30e3);
        break;
      }
      case 'cap': {
        const a = m[d.n[0]],
          b = m[d.n[1]];
        if (st.dead) {
          this.g(a, b, 1e-12);
          break;
        }
        if (transient) {
          const g = d.c / this.dt;
          this.g(a, b, g);
          this.src(a, b, g * st.v);
        } else {
          // Operating point: hold the stored voltage through a stiff source.
          this.thev(a, b, st.v, 1e-3);
        }
        break;
      }
      case 'led': {
        const a = m[d.n[0]],
          k = m[d.n[1]],
          j = c.int;
        const p = c.led!;
        if (st.dead) {
          this.g(a, k, 1e-12);
          this.g(j, k, 1e-9);
          break;
        }
        const nvt = p.n * VT;
        const vcrit = nvt * Math.log(nvt / (SQRT2 * p.is));
        const vd = pnjlim(this.vi(a) - this.vi(j), st.j1, nvt, vcrit);
        st.j1 = vd;
        const e = safeExp(vd / nvt);
        const id = p.is * (e - 1);
        const gd = (p.is / nvt) * e + 1e-12;
        this.g(a, j, gd);
        this.src(a, j, -(id - gd * vd));
        this.g(j, k, 1 / p.rs);
        break;
      }
      case 'npn': {
        const e = m[d.n[0]],
          b = m[d.n[1]],
          col = m[d.n[2]];
        if (st.dead) {
          this.g(b, e, 1e-12);
          break;
        }
        const vcrit = VT * Math.log(VT / (SQRT2 * NPN.is));
        const vbe = pnjlim(this.vi(b) - this.vi(e), st.j1, VT, vcrit);
        const vbc = pnjlim(this.vi(b) - this.vi(col), st.j2, VT, vcrit);
        st.j1 = vbe;
        st.j2 = vbc;
        const ef = safeExp(vbe / VT),
          er = safeExp(vbc / VT);
        const If = NPN.is * (ef - 1),
          Ir = NPN.is * (er - 1);
        const gf = (NPN.is / VT) * ef + 1e-12,
          gr = (NPN.is / VT) * er + 1e-12;
        const kr = 1 + 1 / NPN.br;
        // Terminal currents into the device and their slopes against vbe and vbc.
        const ic = If - Ir * kr,
          dic_be = gf,
          dic_bc = -gr * kr;
        const ib = If / NPN.bf + Ir / NPN.br,
          dib_be = gf / NPN.bf,
          dib_bc = gr / NPN.br;
        this.nl(col, b, e, col, ic, dic_be, dic_bc, vbe, vbc);
        this.nl(b, b, e, col, ib, dib_be, dib_bc, vbe, vbc);
        this.nl(e, b, e, col, -ic - ib, -dic_be - dib_be, -dic_bc - dib_bc, vbe, vbc);
        break;
      }
      case 'ne555': {
        const p = d.n.map((net) => m[net]);
        const gnd = p[0],
          out = p[2],
          rst = p[3],
          ctrl = p[4],
          dis = p[6],
          vcc = p[7];
        const x = c.int;
        this.g(vcc, ctrl, 1 / 5e3);
        this.g(ctrl, x, 1 / 5e3);
        this.g(x, gnd, 1 / 5e3);
        this.g(vcc, gnd, 1 / 1.8e3);
        this.g(rst, vcc, 1e-6);
        if (st.powered) {
          if (st.q) this.thev(out, vcc, -1.7, 10);
          else this.thev(out, gnd, 0.1, 10);
          if (!st.q) this.g(dis, gnd, 1 / 15);
        }
        break;
      }
      case 'cd4017': {
        const p = d.n.map((net) => m[net]);
        const vss = p[7],
          vdd = p[15];
        this.g(vdd, vss, 1e-5);
        if (st.powered) {
          for (let i = 0; i < 10; i++) {
            const pin = p[Q_PINS_4017[i] - 1];
            if (i === st.count) this.thev(pin, vdd, 0, 700);
            else this.thev(pin, vss, 0, 500);
          }
          const co = p[11];
          if (st.count < 5) this.thev(co, vdd, 0, 700);
          else this.thev(co, vss, 0, 500);
        }
        break;
      }
    }
  }

  /**
   * Stamp one linearized terminal current of a three-terminal junction device.
   * `row` is the terminal's node; the current depends on vbe = Vb - Ve and vbc = Vb - Vc.
   */
  private nl(
    row: number,
    b: number,
    e: number,
    c: number,
    i0: number,
    dbe: number,
    dbc: number,
    vbe: number,
    vbc: number,
  ) {
    if (row < 0) return;
    const { A, size: n } = this;
    if (b >= 0) A[row * n + b] += dbe + dbc;
    if (e >= 0) A[row * n + e] -= dbe;
    if (c >= 0) A[row * n + c] -= dbc;
    this.b[row] -= i0 - dbe * vbe - dbc * vbc;
  }

  /** After each converged step: capacitor history, damage, logic, readings. */
  private post() {
    const dt = this.dt;
    const m = this.map;
    const V = (net: number) => this.vi(m[net]);
    for (const c of this.devs) {
      const d = c.dev;
      const st = c.st;
      switch (d.t) {
        case 'res': {
          const v = V(d.n[0]) - V(d.n[1]);
          const i = st.dead ? 0 : v / d.r;
          const p = v * i;
          // A quarter-watt film resistor: about 250 C per watt, with a few seconds' lag.
          st.heat += ((p * 250 - st.heat) * dt) / 2.5;
          if (!st.scorched && st.heat > 160) {
            st.scorched = true;
            this.events.push({ type: 'scorch', id: d.id });
          }
          if (!st.dead && st.heat > 380) {
            st.dead = true;
            this.events.push({ type: 'burn', id: d.id });
          }
          this.acc(st, i, v, p);
          break;
        }
        case 'pot': {
          const va = V(d.n[0]),
            vw = V(d.n[1]),
            vb = V(d.n[2]);
          const p = Math.min(1, Math.max(0, d.pos));
          const i = (va - vw) / Math.max(1, d.r * p);
          this.acc(st, i, va - vb, vw - vb);
          break;
        }
        case 'ldr': {
          const target = Math.log(ldrResistance(d.lux));
          st.rLog += (target - st.rLog) * Math.min(1, dt / 0.06);
          const v = V(d.n[0]) - V(d.n[1]);
          this.acc(st, v / Math.exp(st.rLog), v, Math.exp(st.rLog));
          break;
        }
        case 'button': {
          const v = V(d.n[0]) - V(d.n[1]);
          this.acc(st, d.pressed ? v / 0.05 : 0, v, 0);
          break;
        }
        case 'buzzer': {
          const v = V(d.n[0]) - V(d.n[1]);
          st.j1 = v;
          this.acc(st, v > 0 ? v / 330 : 0, v, Math.min(1, Math.max(0, (v - 1.5) / 7.5)));
          break;
        }
        case 'battery': {
          const v = V(d.n[0]) - V(d.n[1]);
          const i = d.on ? (d.v - v) / d.r : 0;
          this.batteryCurrent = i;
          this.acc(st, i, v, 0);
          if (i > 1.5) {
            this.shortTimer += dt;
            if (this.shortTimer > 0.25 && !st.scorched) {
              st.scorched = true;
              this.events.push({ type: 'short', id: d.id });
            }
          } else {
            this.shortTimer = 0;
            st.scorched = false;
          }
          break;
        }
        case 'meter': {
          const v = V(d.n[0]) - V(d.n[1]);
          if (d.mode === 'V') this.meterReading = v;
          else if (d.mode === 'mA') {
            const i = this.meterFuse ? v / 1 : 0;
            this.meterReading = i;
            if (Math.abs(i) > 0.25) {
              this.fuseTimer += dt;
              if (this.fuseTimer > 0.02 && this.meterFuse) {
                this.meterFuse = false;
                this.events.push({ type: 'fuse', id: d.id });
              }
            } else this.fuseTimer = 0;
          } else if (d.mode === 'ohm') {
            const i = (3 - v) / 30e3;
            this.meterReading = i > 1e-12 ? v / i : Infinity;
          } else this.meterReading = 0;
          this.acc(st, 0, v, this.meterReading);
          break;
        }
        case 'cap': {
          const v = V(d.n[0]) - V(d.n[1]);
          const i = st.dead ? 0 : (d.c * (v - st.v)) / dt;
          st.v = st.dead ? st.v * 0.999 : v;
          if (d.polar && !st.dead) {
            if (v < -1) st.stress += dt * (-v - 1);
            else st.stress = Math.max(0, st.stress - dt * 0.2);
            if (st.stress > 5) {
              st.dead = true;
              this.events.push({ type: 'burst', id: d.id });
            }
          }
          this.acc(st, i, v, 0);
          break;
        }
        case 'led': {
          const vj = this.vi(c.int);
          const vk = V(d.n[1]);
          const va = V(d.n[0]);
          const i = st.dead ? 0 : (vj - vk) / c.led!.rs;
          if (!st.dead) {
            // Rated 20 mA; past about 75 mA the die overheats in under a second, far past it at once.
            if (i > 0.075) st.stress += dt * ((i - 0.075) / 0.03) ** 2;
            else st.stress = Math.max(0, st.stress - dt * 0.05);
            if (st.stress > 0.6) {
              st.dead = true;
              st.peak = i;
              this.events.push({ type: 'pop', id: d.id });
            }
          }
          this.acc(st, i, va - vk, 0);
          break;
        }
        case 'npn': {
          const ve = V(d.n[0]),
            vb = V(d.n[1]),
            vc = V(d.n[2]);
          let ic = 0,
            ib = 0;
          if (!st.dead) {
            const If = NPN.is * (safeExp((vb - ve) / VT) - 1);
            const Ir = NPN.is * (safeExp((vb - vc) / VT) - 1);
            ic = If - Ir * (1 + 1 / NPN.br);
            ib = If / NPN.bf + Ir / NPN.br;
            const p = ic * (vc - ve) + ib * (vb - ve);
            st.heat += ((p * 200 - st.heat) * dt) / 1.5;
            if (st.heat > 260 || ic > 0.6) {
              st.stress += dt;
              if (st.stress > 0.3) {
                st.dead = true;
                this.events.push({ type: 'burn', id: d.id });
              }
            }
          }
          this.acc(st, ic, vc - ve, ib);
          break;
        }
        case 'ne555': {
          const g = V(d.n[0]);
          const vcc = V(d.n[7]) - g;
          const wasPowered = st.powered;
          st.powered = vcc > 3;
          if (!st.powered) {
            st.q = false;
            this.acc(st, 0, vcc, 0);
            break;
          }
          const vx = this.vi(c.int) - g;
          const vtrig = V(d.n[1]) - g,
            vrst = V(d.n[3]) - g,
            vctrl = V(d.n[4]) - g,
            vthr = V(d.n[5]) - g;
          const was = st.q;
          if (vrst < 0.7) st.q = false;
          else if (vtrig < vx) st.q = true;
          else if (vthr > vctrl) st.q = false;
          if (!wasPowered) st.lastRise = -1;
          if (st.q && !was) {
            if (st.lastRise >= 0) st.period = this.time - st.lastRise;
            st.lastRise = this.time;
          } else if (!st.q && was) {
            if (st.lastRise >= 0) st.highTime = this.time - st.lastRise;
            st.lastFall = this.time;
          }
          // Forget a frequency once the output has sat still for well over a period.
          const quiet = this.time - Math.max(st.lastRise, st.lastFall);
          if (quiet > Math.max(2, st.period * 3)) st.period = 0;
          this.acc(st, 0, vcc, st.q ? 1 : 0);
          break;
        }
        case 'cd4017': {
          const vss = V(d.n[7]);
          const vdd = V(d.n[15]) - vss;
          const was = st.powered;
          st.powered = vdd > 2.5;
          if (!st.powered) {
            this.acc(st, 0, vdd, 0);
            break;
          }
          const level = (pin: number) => (V(d.n[pin - 1]) - vss) / vdd;
          const clk = level(14);
          if (!was) {
            st.count = 0;
            st.clk = clk > 0.5;
          }
          if (!st.clk && clk > 0.6) {
            st.clk = true;
            if (level(13) < 0.5 && level(15) < 0.5) st.count = (st.count + 1) % 10;
          } else if (st.clk && clk < 0.4) st.clk = false;
          if (level(15) > 0.5) st.count = 0;
          this.acc(st, 0, vdd, st.count);
          break;
        }
      }
    }
  }

  private acc(st: PartState, i: number, v: number, a: number) {
    st.iSum += i;
    st.vSum += v;
    st.aSum += a;
    st.tSum += 1;
  }
}

/** Gaussian elimination with partial pivoting; A and b are overwritten. */
function luSolve(A: Float64Array, b: Float64Array, x: Float64Array, n: number): boolean {
  for (let k = 0; k < n; k++) {
    let p = k;
    let max = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i * n + k]);
      if (v > max) {
        max = v;
        p = i;
      }
    }
    if (max < 1e-300) return false;
    if (p !== k) {
      for (let j = k; j < n; j++) {
        const t = A[k * n + j];
        A[k * n + j] = A[p * n + j];
        A[p * n + j] = t;
      }
      const t = b[k];
      b[k] = b[p];
      b[p] = t;
    }
    const pivot = A[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k] / pivot;
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) A[i * n + j] -= f * A[k * n + j];
      b[i] -= f * b[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j];
    x[i] = s / A[i * n + i];
  }
  return true;
}
