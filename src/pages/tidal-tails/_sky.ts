// The GPU side of the plate: a buffer of stars, the integrator that moves
// them, and the passes that expose them onto a photographic plate.

import { DT, type Galaxy, type Orbit } from './_orbit';
import { BLUR, COMPOSITE, FIELD, INIT, SPLAT, STEP } from './_wgsl';

// TS's DOM lib types WebGPU's interfaces but not these constants.
declare const GPUBufferUsage: {
  readonly UNIFORM: number;
  readonly STORAGE: number;
  readonly COPY_DST: number;
};
declare const GPUTextureUsage: { readonly RENDER_ATTACHMENT: number; readonly TEXTURE_BINDING: number };

const HDR = 'rgba16float' as GPUTextureFormat;
const FIELD_STARS = 90;

export interface Look {
  /** Rows of the view rotation. */
  rows: [number[], number[], number[]];
  /** Device pixels per length unit. */
  pxPerUnit: number;
  /** Device pixels per css pixel. */
  dpr: number;
  /** Exposure multiplier, about 0.2 to 5. */
  exposure: number;
  mode: 'negative' | 'print';
}

interface Targets {
  w: number;
  h: number;
  full: GPUTexture;
  halfA: GPUTexture;
  halfB: GPUTexture;
  quarterA: GPUTexture;
  quarterB: GPUTexture;
  groups: Record<'halfDown' | 'halfH' | 'halfV' | 'quarterDown' | 'quarterH' | 'quarterV' | 'comp', GPUBindGroup>;
}

export class Sky {
  readonly device: GPUDevice;
  readonly count: number;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private pos: GPUBuffer;
  private vel: GPUBuffer;
  private cores: GPUBuffer | null = null;
  private initU: GPUBuffer;
  private stepU: GPUBuffer;
  private viewU: GPUBuffer;
  private fieldU: GPUBuffer;
  private compU: GPUBuffer;
  private blurU: Record<'down' | 'halfH' | 'halfV' | 'quarterH' | 'quarterV', GPUBuffer>;
  private initP: GPUComputePipeline;
  private stepP: GPUComputePipeline;
  private splatP: GPURenderPipeline;
  private fieldP: GPURenderPipeline;
  private blurP: GPURenderPipeline;
  private compP: GPURenderPipeline;
  private sampler: GPUSampler;
  private initG: GPUBindGroup;
  private stepG: GPUBindGroup | null = null;
  private splatG: GPUBindGroup;
  private fieldG: GPUBindGroup;
  private targets: Targets | null = null;
  private orbit: Orbit | null = null;
  /** The step the stars are at now. */
  step = 0;
  /** How many of the buffer's stars to use; a slow GPU gets fewer. */
  active: number;

  static async create(canvas: HTMLCanvasElement, adapter: GPUAdapter, count: number): Promise<Sky> {
    const device = await adapter.requestDevice();
    return new Sky(canvas, device, count);
  }

  private constructor(canvas: HTMLCanvasElement, device: GPUDevice, count: number) {
    this.device = device;
    this.count = count;
    this.active = count;
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) throw new Error('no WebGPU canvas context');
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: this.format, alphaMode: 'opaque' });

    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    const make = (size: number, usage: number, label: string) => device.createBuffer({ size, usage, label });
    this.pos = make(count * 16, storage, 'pos');
    this.vel = make(count * 16, storage, 'vel');
    this.initU = make(176, uniform, 'init');
    this.stepU = make(48, uniform, 'step');
    this.viewU = make(80, uniform, 'view');
    this.fieldU = make(32, uniform, 'field');
    this.compU = make(32, uniform, 'comp');
    this.blurU = {
      down: make(16, uniform, 'blur-down'),
      halfH: make(16, uniform, 'blur-half-h'),
      halfV: make(16, uniform, 'blur-half-v'),
      quarterH: make(16, uniform, 'blur-quarter-h'),
      quarterV: make(16, uniform, 'blur-quarter-v'),
    };
    device.queue.writeBuffer(this.blurU.down, 0, new Float32Array([0, 0, 0, 0]));

    const compute = (code: string, label: string) =>
      device.createComputePipeline({
        label,
        layout: 'auto',
        compute: { module: device.createShaderModule({ code, label }), entryPoint: 'main' },
      });
    this.initP = compute(INIT, 'init');
    this.stepP = compute(STEP, 'step');

    const add: GPUBlendState = {
      color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
      alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
    };
    const render = (code: string, label: string, format: GPUTextureFormat, blend?: GPUBlendState) => {
      const module = device.createShaderModule({ code, label });
      return device.createRenderPipeline({
        label,
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [blend ? { format, blend } : { format }] },
        primitive: { topology: 'triangle-list' },
      });
    };
    this.splatP = render(SPLAT, 'splat', HDR, add);
    this.fieldP = render(FIELD, 'field', HDR, add);
    this.blurP = render(BLUR, 'blur', HDR);
    this.compP = render(COMPOSITE, 'composite', this.format);
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    const entries = (...resources: GPUBindingResource[]) =>
      resources.map((resource, binding) => ({ binding, resource }));
    this.initG = device.createBindGroup({
      layout: this.initP.getBindGroupLayout(0),
      entries: entries({ buffer: this.initU }, { buffer: this.pos }, { buffer: this.vel }),
    });
    this.splatG = device.createBindGroup({
      layout: this.splatP.getBindGroupLayout(0),
      entries: entries({ buffer: this.viewU }, { buffer: this.pos }, { buffer: this.vel }),
    });
    this.fieldG = device.createBindGroup({
      layout: this.fieldP.getBindGroupLayout(0),
      entries: entries({ buffer: this.fieldU }),
    });
  }

  /** Take a new encounter: upload the masses' paths and lay out fresh disks at the first step. */
  setOrbit(orbit: Orbit, seed: number) {
    const { device } = this;
    this.orbit = orbit;
    this.cores?.destroy();
    this.cores = device.createBuffer({
      size: orbit.table.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'cores',
    });
    device.queue.writeBuffer(this.cores, 0, orbit.table);
    this.stepG = device.createBindGroup({
      layout: this.stepP.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.stepU } },
        { binding: 1, resource: { buffer: this.pos } },
        { binding: 2, resource: { buffer: this.vel } },
        { binding: 3, resource: { buffer: this.cores } },
      ],
    });
    this.reset(seed);
  }

  /** Put every star back on its starting orbit. */
  reset(seed: number) {
    const orbit = this.orbit;
    if (!orbit) return;
    const { a, b } = orbit;
    // Share the stars by mass when both have disks.
    const active = Math.min(this.active, this.count);
    let countA = 0;
    if (a.on && b.on) countA = Math.round((active * a.mass ** 0.8) / (a.mass ** 0.8 + b.mass ** 0.8));
    else if (a.on) countA = active;
    const countB = b.on ? active - countA : 0;
    const total = countA + countB;
    const data = new ArrayBuffer(176);
    const f = new Float32Array(data);
    const u = new Uint32Array(data);
    const put = (g: Galaxy, at: number, first: number, count: number) => {
      f.set([...g.pos, g.mass, ...g.vel, g.soft, ...g.e1, g.radius, ...g.e2, first, ...g.n, count], at);
    };
    put(a, 0, 0, countA);
    put(b, 20, countA, countB);
    u[40] = seed >>> 0;
    u[41] = total;
    this.device.queue.writeBuffer(this.initU, 0, data);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.initP);
    pass.setBindGroup(0, this.initG);
    pass.dispatchWorkgroups(Math.ceil(this.count / 256));
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.drawn = total;
    this.step = 0;
  }

  /** Stars that belong to a disk; the rest of the buffer is idle. */
  private drawn = 0;

  /**
   * Move the stars up to `budget` steps toward `target`, in chunks small
   * enough not to hold the GPU for long. Returns the steps taken.
   */
  advance(target: number, budget: number, chunk = 48): number {
    const orbit = this.orbit;
    if (!orbit || !this.stepG || this.drawn === 0) {
      if (orbit) this.step = Math.max(0, Math.min(orbit.steps - 1, target));
      return 0;
    }
    target = Math.max(0, Math.min(orbit.steps - 1, target));
    let taken = 0;
    const data = new ArrayBuffer(48);
    const iv = new Int32Array(data);
    const uv = new Uint32Array(data);
    const fv = new Float32Array(data);
    const a = orbit.a;
    const b = orbit.b;
    while (this.step !== target && taken < budget) {
      const dir = target > this.step ? 1 : -1;
      const n = Math.min(chunk, Math.abs(target - this.step), budget - taken);
      iv[0] = this.step;
      iv[1] = dir;
      iv[2] = n;
      uv[3] = this.drawn;
      fv[4] = DT;
      fv[5] = a.mass;
      fv[6] = b.mass;
      fv[7] = a.soft * a.soft;
      fv[8] = b.soft * b.soft;
      this.device.queue.writeBuffer(this.stepU, 0, data);
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this.stepP);
      pass.setBindGroup(0, this.stepG);
      pass.dispatchWorkgroups(Math.ceil(this.drawn / 256));
      pass.end();
      this.device.queue.submit([enc.finish()]);
      this.step += dir * n;
      taken += n;
    }
    return taken;
  }

  private ensureTargets(w: number, h: number): Targets {
    if (this.targets && this.targets.w === w && this.targets.h === h) return this.targets;
    const t = this.targets;
    if (t) for (const tex of [t.full, t.halfA, t.halfB, t.quarterA, t.quarterB]) tex.destroy();
    const { device } = this;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const tex = (tw: number, th: number, label: string) =>
      device.createTexture({ size: [Math.max(1, tw), Math.max(1, th)], format: HDR, usage, label });
    const hw = Math.ceil(w / 2);
    const hh = Math.ceil(h / 2);
    const qw = Math.ceil(w / 4);
    const qh = Math.ceil(h / 4);
    const full = tex(w, h, 'full');
    const halfA = tex(hw, hh, 'halfA');
    const halfB = tex(hw, hh, 'halfB');
    const quarterA = tex(qw, qh, 'quarterA');
    const quarterB = tex(qw, qh, 'quarterB');
    device.queue.writeBuffer(this.blurU.halfH, 0, new Float32Array([1.4 / hw, 0, 0, 0]));
    device.queue.writeBuffer(this.blurU.halfV, 0, new Float32Array([0, 1.4 / hh, 0, 0]));
    device.queue.writeBuffer(this.blurU.quarterH, 0, new Float32Array([2.6 / qw, 0, 0, 0]));
    device.queue.writeBuffer(this.blurU.quarterV, 0, new Float32Array([0, 2.6 / qh, 0, 0]));
    const blurGroup = (src: GPUTexture, u: GPUBuffer) =>
      device.createBindGroup({
        layout: this.blurP.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: src.createView() },
          { binding: 2, resource: { buffer: u } },
        ],
      });
    const comp = device.createBindGroup({
      layout: this.compP.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: full.createView() },
        { binding: 2, resource: halfA.createView() },
        { binding: 3, resource: quarterA.createView() },
        { binding: 4, resource: { buffer: this.compU } },
      ],
    });
    this.targets = {
      w,
      h,
      full,
      halfA,
      halfB,
      quarterA,
      quarterB,
      groups: {
        halfDown: blurGroup(full, this.blurU.down),
        halfH: blurGroup(halfA, this.blurU.halfH),
        halfV: blurGroup(halfB, this.blurU.halfV),
        quarterDown: blurGroup(halfA, this.blurU.down),
        quarterH: blurGroup(quarterA, this.blurU.quarterH),
        quarterV: blurGroup(quarterB, this.blurU.quarterV),
        comp,
      },
    };
    return this.targets;
  }

  render(w: number, h: number, look: Look) {
    const { device } = this;
    const t = this.ensureTargets(w, h);
    const pxX = 2 / w;
    const pxY = 2 / h;
    // Surface brightness holds as the plate zooms: fewer stars per pixel, each brighter.
    const zoom = look.pxPerUnit / (140 * look.dpr);
    const gain = Math.min(0.75, look.exposure * 0.075 * zoom * zoom);
    const view = new Float32Array(20);
    view.set([...look.rows[0], 0, ...look.rows[1], 0, ...look.rows[2], 0]);
    view.set([look.pxPerUnit * pxX, look.pxPerUnit * pxY, pxX, pxY, gain, 1.5 * look.dpr], 12);
    device.queue.writeBuffer(this.viewU, 0, view);
    const field = new ArrayBuffer(32);
    const ff = new Float32Array(field);
    const fu = new Uint32Array(field);
    ff[0] = pxX;
    ff[1] = pxY;
    ff[2] = look.dpr;
    fu[3] = FIELD_STARS;
    ff[4] = 0.06 * look.exposure;
    fu[5] = 0x2f6b1d3;
    device.queue.writeBuffer(this.fieldU, 0, field);
    device.queue.writeBuffer(
      this.compU,
      0,
      new Float32Array([w, h, look.mode === 'print' ? 1 : 0, Math.max(1, 1.15 * look.dpr), 1, 7, 0, 0]),
    );

    const enc = device.createCommandEncoder();
    const pass = (view: GPUTextureView, load: GPULoadOp = 'clear') =>
      enc.beginRenderPass({
        colorAttachments: [{ view, loadOp: load, storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
    let p = pass(t.full.createView());
    if (this.drawn > 0) {
      p.setPipeline(this.splatP);
      p.setBindGroup(0, this.splatG);
      p.draw(6, this.drawn);
    }
    p.setPipeline(this.fieldP);
    p.setBindGroup(0, this.fieldG);
    p.draw(6, FIELD_STARS);
    p.end();
    const blur = (dst: GPUTexture, group: GPUBindGroup) => {
      const b = pass(dst.createView());
      b.setPipeline(this.blurP);
      b.setBindGroup(0, group);
      b.draw(3);
      b.end();
    };
    blur(t.halfA, t.groups.halfDown);
    blur(t.halfB, t.groups.halfH);
    blur(t.halfA, t.groups.halfV);
    blur(t.quarterA, t.groups.quarterDown);
    blur(t.quarterB, t.groups.quarterH);
    blur(t.quarterA, t.groups.quarterV);
    p = pass(this.context.getCurrentTexture().createView());
    p.setPipeline(this.compP);
    p.setBindGroup(0, t.groups.comp);
    p.draw(3);
    p.end();
    device.queue.submit([enc.finish()]);
  }
}
