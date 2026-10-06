// The petri dish on the GPU: buffers, pipelines, one simulation step, and the
// render. Everything that touches WebGPU lives here.

import { AGENTS, DIFFUSE, RENDER, SCENT, STAMP } from './_wgsl';

// TypeScript's DOM library types WebGPU's interfaces but not these two pieces.
declare const GPUBufferUsage: { readonly UNIFORM: number; readonly STORAGE: number; readonly COPY_DST: number };

/** Cells per side of the agar grid. */
export const SIZE = 1024;
/** The dish's inner radius, in cells. */
export const DISH_RADIUS = 500;
export const MAX_FOODS = 48;
export const MAX_STROKES = 64;
/** How far an oat's scent reaches, in cells. */
export const FOOD_REACH = 80;

export interface Rules {
  /** Radians either side of straight ahead. */
  sensorAngle: number;
  /** Cells ahead. */
  sensorDist: number;
  /** Radians per turn. */
  turnAngle: number;
  /** Cells per step. */
  stepSize: number;
  /** Trail left per step. */
  deposit: number;
  /** Fraction of the trail kept each step. */
  keep: number;
  /** 0 to 1: how far each step blurs the trail. */
  diffuse: number;
  /** Radians of random wobble per step. */
  jitter: number;
}

export interface Food {
  x: number;
  y: number;
}

export interface Stroke {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  radius: number;
  /** True paints salt; false scrapes it away. */
  salt: boolean;
}

export interface Lamp {
  x: number;
  y: number;
  radius: number;
  on: boolean;
}

// Word offsets into the 96-byte Params block in _wgsl.ts.
const P = {
  size: 0,
  agents: 1,
  frame: 2,
  foodCount: 3,
  sensorAngle: 4,
  sensorDist: 5,
  turnAngle: 6,
  stepSize: 7,
  deposit: 8,
  keep: 9,
  diffuse: 10,
  dishRadius: 11,
  lamp: 12,
  canvas: 16,
  center: 18,
  scale: 20,
  time: 21,
  strokeCount: 22,
  jitter: 23,
} as const;
const PARAM_BYTES = 96;
const FOOD_STRENGTH = 120;

export class Plate {
  readonly device: GPUDevice;
  readonly maxAgents: number;
  agents: number;
  rules: Rules;
  foods: Food[] = [];
  lamp: Lamp = { x: 0, y: 0, radius: 60, on: false };
  steps = 0;

  private readonly context: GPUCanvasContext;
  private readonly params = new ArrayBuffer(PARAM_BYTES);
  private readonly f32 = new Float32Array(this.params);
  private readonly u32 = new Uint32Array(this.params);
  private readonly buffers: {
    params: GPUBuffer;
    agents: GPUBuffer;
    trail: [GPUBuffer, GPUBuffer];
    deposit: GPUBuffer;
    walls: GPUBuffer;
    foods: GPUBuffer;
    scent: GPUBuffer;
    strokes: GPUBuffer;
  };
  private pipelines!: {
    agents: GPUComputePipeline;
    diffuse: GPUComputePipeline;
    scent: GPUComputePipeline;
    stamp: GPUComputePipeline;
    render: GPURenderPipeline;
  };
  private groups!: {
    agents: GPUBindGroup[];
    diffuse: GPUBindGroup[];
    scent: GPUBindGroup;
    stamp: GPUBindGroup[];
    render: GPUBindGroup[];
  };
  private current = 0;
  private strokes: Stroke[] = [];
  private foodsDirty = true;

  private constructor(device: GPUDevice, context: GPUCanvasContext, maxAgents: number, rules: Rules) {
    this.device = device;
    this.context = context;
    this.maxAgents = maxAgents;
    this.agents = maxAgents;
    this.rules = rules;
    const cells = SIZE * SIZE * 4;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const make = (size: number, usage: number, label: string) => device.createBuffer({ size, usage, label });
    this.buffers = {
      params: make(PARAM_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'params'),
      agents: make(maxAgents * 16, storage, 'agents'),
      trail: [make(cells, storage, 'trail a'), make(cells, storage, 'trail b')],
      deposit: make(cells, storage, 'deposit'),
      walls: make(cells, storage, 'walls'),
      foods: make(MAX_FOODS * 16, storage, 'foods'),
      scent: make(cells, storage, 'scent'),
      strokes: make(MAX_STROKES * 32, storage, 'strokes'),
    };
    this.u32[P.size] = SIZE;
    this.f32[P.dishRadius] = DISH_RADIUS;
  }

  /** Opens the GPU and compiles every pass. Throws with a readable message on failure. */
  static async create(canvas: HTMLCanvasElement, adapter: GPUAdapter, maxAgents: number, rules: Rules): Promise<Plate> {
    // A million agents at 16 bytes each fits WebGPU's default 128 MiB binding limit.
    const device = await adapter.requestDevice();
    device.addEventListener('uncapturederror', (event) => console.error('WebGPU:', event.error.message));
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) throw new Error('The canvas would not open a WebGPU context.');
    context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
    const plate = new Plate(device, context, maxAgents, rules);
    await plate.compile();
    return plate;
  }

  private async compile(): Promise<void> {
    const { device } = this;
    const compute = (code: string, label: string) =>
      device.createComputePipelineAsync({
        label,
        layout: 'auto',
        compute: { module: device.createShaderModule({ code, label }), entryPoint: 'main' },
      });
    const renderModule = device.createShaderModule({ code: RENDER, label: 'render' });
    const [agents, diffuse, scent, stamp, render] = await Promise.all([
      compute(AGENTS, 'agents'),
      compute(DIFFUSE, 'diffuse'),
      compute(SCENT, 'scent'),
      compute(STAMP, 'stamp'),
      device.createRenderPipelineAsync({
        label: 'render',
        layout: 'auto',
        vertex: { module: renderModule, entryPoint: 'vs' },
        fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }] },
        primitive: { topology: 'triangle-list' },
      }),
    ]);
    this.pipelines = { agents, diffuse, scent, stamp, render };

    const b = this.buffers;
    const group = (pipeline: GPUComputePipeline | GPURenderPipeline, resources: GPUBuffer[]) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: resources.map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    const both = (fn: (k: number) => GPUBindGroup) => [fn(0), fn(1)];
    this.groups = {
      agents: both((k) => group(agents, [b.params, b.agents, b.trail[k], b.deposit, b.walls, b.scent])),
      diffuse: both((k) => group(diffuse, [b.params, b.trail[k], b.trail[1 - k], b.deposit, b.walls])),
      scent: group(scent, [b.params, b.scent, b.foods]),
      stamp: both((k) => group(stamp, [b.params, b.walls, b.trail[k], b.strokes])),
      render: both((k) => group(render, [b.params, b.trail[k], b.walls, b.foods])),
    };
  }

  /** Clears the agar and salt, then places agents from a packed x, y, heading, 0 array. */
  pour(agents: Float32Array, walls?: Uint32Array): void {
    const encoder = this.device.createCommandEncoder();
    for (const buffer of [...this.buffers.trail, this.buffers.deposit, this.buffers.walls]) encoder.clearBuffer(buffer);
    this.device.queue.submit([encoder.finish()]);
    if (walls) this.device.queue.writeBuffer(this.buffers.walls, 0, walls);
    this.device.queue.writeBuffer(this.buffers.agents, 0, agents);
    this.strokes = [];
    this.steps = 0;
    this.foodsDirty = true;
  }

  /** Queues a salt or scrape stroke for the next step. */
  stroke(s: Stroke): void {
    if (this.strokes.length < MAX_STROKES) this.strokes.push(s);
  }

  markFoods(): void {
    this.foodsDirty = true;
  }

  setView(width: number, height: number, cx: number, cy: number, scale: number): void {
    this.f32[P.canvas] = width;
    this.f32[P.canvas + 1] = height;
    this.f32[P.center] = cx;
    this.f32[P.center + 1] = cy;
    this.f32[P.scale] = scale;
  }

  private writeParams(): void {
    const { f32, u32, rules, lamp } = this;
    u32[P.agents] = Math.min(this.agents, this.maxAgents);
    u32[P.frame] = this.steps;
    u32[P.foodCount] = Math.min(this.foods.length, MAX_FOODS);
    f32[P.sensorAngle] = rules.sensorAngle;
    f32[P.sensorDist] = rules.sensorDist;
    f32[P.turnAngle] = rules.turnAngle;
    f32[P.stepSize] = rules.stepSize;
    f32[P.deposit] = rules.deposit;
    f32[P.keep] = rules.keep;
    f32[P.diffuse] = rules.diffuse;
    f32[P.jitter] = rules.jitter;
    f32.set([lamp.x, lamp.y, lamp.radius, lamp.on ? 1 : 0], P.lamp);
    u32[P.strokeCount] = this.strokes.length;
    this.device.queue.writeBuffer(this.buffers.params, 0, this.params);
  }

  /** Uploads the oats and recomputes their scent, when they have changed. */
  private writeFoods(): void {
    if (!this.foodsDirty) return;
    const data = new Float32Array(MAX_FOODS * 4);
    this.foods.slice(0, MAX_FOODS).forEach((f, i) => data.set([f.x, f.y, FOOD_REACH, FOOD_STRENGTH], i * 4));
    this.device.queue.writeBuffer(this.buffers.foods, 0, data);
    this.writeParams();
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.scent);
    pass.setBindGroup(0, this.groups.scent);
    pass.dispatchWorkgroups(Math.ceil(SIZE / 16), Math.ceil(SIZE / 16));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.foodsDirty = false;
  }

  /** Runs simulation steps. Each step is its own submit so its frame number seeds fresh randomness. */
  step(count: number): void {
    const { device, pipelines, groups } = this;
    this.writeFoods();
    const cellGroups = Math.ceil(SIZE / 16);
    for (let s = 0; s < count; s++) {
      if (this.strokes.length) {
        const data = new Float32Array(MAX_STROKES * 8);
        this.strokes.forEach((k, i) => data.set([k.ax, k.ay, k.bx, k.by, k.radius, k.salt ? 1 : 0, 0, 0], i * 8));
        device.queue.writeBuffer(this.buffers.strokes, 0, data);
      }
      this.writeParams();
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      const k = this.current;
      if (this.strokes.length) {
        pass.setPipeline(pipelines.stamp);
        pass.setBindGroup(0, groups.stamp[k]!);
        pass.dispatchWorkgroups(cellGroups, cellGroups);
      }
      pass.setPipeline(pipelines.agents);
      pass.setBindGroup(0, groups.agents[k]!);
      pass.dispatchWorkgroups(Math.ceil(Math.min(this.agents, this.maxAgents) / 256));
      pass.setPipeline(pipelines.diffuse);
      pass.setBindGroup(0, groups.diffuse[k]!);
      pass.dispatchWorkgroups(cellGroups, cellGroups);
      pass.end();
      device.queue.submit([encoder.finish()]);
      this.strokes = [];
      this.current = 1 - k;
      this.steps++;
    }
  }

  /** Applies queued strokes without advancing time, for a paused plate. */
  applyStrokes(): void {
    if (!this.strokes.length) return;
    const { device } = this;
    const data = new Float32Array(MAX_STROKES * 8);
    this.strokes.forEach((k, i) => data.set([k.ax, k.ay, k.bx, k.by, k.radius, k.salt ? 1 : 0, 0, 0], i * 8));
    device.queue.writeBuffer(this.buffers.strokes, 0, data);
    this.writeParams();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.stamp);
    pass.setBindGroup(0, this.groups.stamp[this.current]!);
    pass.dispatchWorkgroups(Math.ceil(SIZE / 16), Math.ceil(SIZE / 16));
    pass.end();
    device.queue.submit([encoder.finish()]);
    this.strokes = [];
  }

  render(time: number): void {
    this.writeFoods();
    this.f32[P.time] = time;
    this.writeParams();
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
      ],
    });
    pass.setPipeline(this.pipelines.render);
    pass.setBindGroup(0, this.groups.render[this.current]!);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
