// Gravner and Griffeath's mesoscopic snow crystal model ("Modeling snow crystal growth II",
// Physica D 237, 2008), run on the GPU. Every cell of the triangular lattice holds four
// masses: whether it is ice (here, the update it froze on, or 0), boundary mass b,
// crystal mass c, and diffusive vapour d. One update is the paper's five steps: diffusion,
// freezing, attachment, melting, and noise, in two fragment passes.
//
// The lattice is stored as a square texture in axial coordinates, with neighbours at
// (±1, 0), (0, ±1), (1, 1), and (-1, -1): the paper's graph T' on Z². Only a disc around
// the crystal is computed; everything outside it is far-field vapour at the cloud's
// current density, so the cloud behaves as an unbounded field and growth costs little
// while the crystal is small. The edge is a true circle: a square in axial coordinates is a
// rhombus on the plane, which put some faces nearer the cloud than others and grew
// lopsided plates.

export interface Params {
  /** Vapour density of the surrounding cloud. */
  rho: number;
  /** Boundary mass needed to join at a tip or flat face (1 or 2 ice neighbours). */
  beta: number;
  /** Knife-edge threshold: boundary mass that joins a concavity once vapour around it is thin. */
  alpha: number;
  /** Vapour around a concavity below which alpha applies. */
  theta: number;
  /** Share of arriving vapour that freezes straight to crystal mass. */
  kappa: number;
  /** Share of boundary mass that melts back to vapour each update. */
  mu: number;
  /** Share of unattached crystal mass that sublimates back to vapour each update. */
  gamma: number;
  /** Size of the random kick to the vapour at every cell. */
  sigma: number;
}

/** Side of the lattice texture, in cells. */
export const N = 1024;
export const CENTER = N / 2;

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D u_state;
uniform ivec2 u_lo;
uniform ivec2 u_hi;
uniform float u_r2;
uniform float u_rho;
out vec4 o;
const ivec2 MID = ivec2(${CENTER}, ${CENTER});
// Inside the computed disc: squared distance from the centre on the plane, in cells.
bool live(ivec2 p) {
  ivec2 q = p - MID;
  return float(q.x * q.x - q.x * q.y + q.y * q.y) <= u_r2;
}
// Cells outside the computed disc are untouched far-field vapour.
vec4 cell(ivec2 p) {
  if (!live(p)) return vec4(u_rho, 0.0, 0.0, 0.0);
  return texelFetch(u_state, p, 0);
}
const ivec2 E0 = ivec2(1, 0);
const ivec2 E1 = ivec2(-1, 0);
const ivec2 E2 = ivec2(0, 1);
const ivec2 E3 = ivec2(0, -1);
const ivec2 E4 = ivec2(1, 1);
const ivec2 E5 = ivec2(-1, -1);
`;

const INIT = `${HEAD}
uniform ivec2 u_center;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  // A mesoscopic prism at the origin: ice with crystal mass 1, in vapour of density rho.
  o = p == u_center ? vec4(0.0, 0.0, 1.0, 1.0) : vec4(u_rho, 0.0, 0.0, 0.0);
}`;

// Steps i and ii. Vapour diffuses over the cells that are not ice, reflecting off the crystal;
// at boundary cells it then splits into boundary mass (1 - kappa) and crystal mass (kappa).
const DIFFUSE = `${HEAD}
uniform float u_kappa;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = cell(p);
  if (s.a > 0.0) {
    o = s;
    return;
  }
  vec4 n0 = cell(p + E0), n1 = cell(p + E1), n2 = cell(p + E2);
  vec4 n3 = cell(p + E3), n4 = cell(p + E4), n5 = cell(p + E5);
  float sum = s.r;
  int ice = 0;
  sum += n0.a > 0.0 ? s.r : n0.r; ice += n0.a > 0.0 ? 1 : 0;
  sum += n1.a > 0.0 ? s.r : n1.r; ice += n1.a > 0.0 ? 1 : 0;
  sum += n2.a > 0.0 ? s.r : n2.r; ice += n2.a > 0.0 ? 1 : 0;
  sum += n3.a > 0.0 ? s.r : n3.r; ice += n3.a > 0.0 ? 1 : 0;
  sum += n4.a > 0.0 ? s.r : n4.r; ice += n4.a > 0.0 ? 1 : 0;
  sum += n5.a > 0.0 ? s.r : n5.r; ice += n5.a > 0.0 ? 1 : 0;
  float d = sum / 7.0;
  o = ice > 0 ? vec4(0.0, s.g + (1.0 - u_kappa) * d, s.b + u_kappa * d, 0.0) : vec4(d, 0.0, 0.0, 0.0);
}`;

// Steps iii to v. A boundary cell joins the crystal by how many ice neighbours it has and how
// much boundary mass it holds; one that doesn't join melts a little back to vapour. Then the
// vapour takes its random kick, and the cloud's change of density.
const SETTLE = `${HEAD}
uniform float u_beta;
uniform float u_alpha;
uniform float u_theta;
uniform float u_mu;
uniform float u_gamma;
uniform float u_sigma;
uniform float u_grow;
uniform float u_time;
uniform uint u_seed;
uint hash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = cell(p);
  if (s.a > 0.0) {
    o = s;
    return;
  }
  vec4 n0 = cell(p + E0), n1 = cell(p + E1), n2 = cell(p + E2);
  vec4 n3 = cell(p + E3), n4 = cell(p + E4), n5 = cell(p + E5);
  int ice = (n0.a > 0.0 ? 1 : 0) + (n1.a > 0.0 ? 1 : 0) + (n2.a > 0.0 ? 1 : 0)
          + (n3.a > 0.0 ? 1 : 0) + (n4.a > 0.0 ? 1 : 0) + (n5.a > 0.0 ? 1 : 0);
  uint h = hash(uint(p.x) + uint(p.y) * 4099u + u_seed * 16777619u);
  float kick = 1.0 + ((h & 1u) == 0u ? -u_sigma : u_sigma);
  if (ice == 0) {
    o = vec4(s.r * (1.0 + u_grow) * kick, 0.0, 0.0, 0.0);
    return;
  }
  float b = s.g;
  float c = s.b;
  bool join;
  if (ice >= 4) {
    join = true;
  } else if (ice == 3) {
    float near = s.r + n0.r + n1.r + n2.r + n3.r + n4.r + n5.r;
    join = b >= 1.0 || (near < u_theta && b >= u_alpha);
  } else {
    join = b >= u_beta;
  }
  if (join) {
    o = vec4(0.0, 0.0, b + c, u_time);
    return;
  }
  float d = s.r + u_mu * b + u_gamma * c;
  o = vec4(d * (1.0 + u_grow) * kick, (1.0 - u_mu) * b, (1.0 - u_gamma) * c, 0.0);
}`;

// What the view draws from: crystal mass smoothed over each cell's neighbourhood (the
// thickness the light passes through), when each cell froze as a share of the fall so far,
// the vapour, and the ice coverage, in a filterable half-float texture.
const PREP = `${HEAD}
uniform float u_time;
float mass(vec4 s) { return s.a > 0.0 ? s.b : 0.0; }
float iced(vec4 s) { return s.a > 0.0 ? 1.0 : 0.0; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = cell(p);
  vec4 n0 = cell(p + E0), n1 = cell(p + E1), n2 = cell(p + E2);
  vec4 n3 = cell(p + E3), n4 = cell(p + E4), n5 = cell(p + E5);
  float h = 0.4 * mass(s) + 0.1 * (mass(n0) + mass(n1) + mass(n2) + mass(n3) + mass(n4) + mass(n5));
  float a = 0.4 * iced(s) + 0.1 * (iced(n0) + iced(n1) + iced(n2) + iced(n3) + iced(n4) + iced(n5));
  float age = s.a > 0.0 ? s.a / u_time : 1.0;
  o = vec4(h, age, s.r, a);
}`;

// The farthest ice from the centre in each 16 x 16 block, for sizing the computed square.
const MEASURE = `${HEAD}
uniform ivec2 u_center;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 16;
  float far = 0.0;
  float count = 0.0;
  for (int y = 0; y < 16; y++) {
    for (int x = 0; x < 16; x++) {
      ivec2 p = base + ivec2(x, y);
      if (!live(p)) continue;
      if (texelFetch(u_state, p, 0).a <= 0.0) continue;
      ivec2 u = p - u_center;
      int dist = u.x * u.y >= 0 ? max(abs(u.x), abs(u.y)) : abs(u.x) + abs(u.y);
      far = max(far, float(dist));
      count += 1.0;
    }
  }
  o = vec4(far, count, 0.0, 0.0);
}`;

type Uniforms = Record<string, WebGLUniformLocation | null>;

interface Pass {
  prog: WebGLProgram;
  u: Uniforms;
}

const BLOCK = 16;
/** A disc of radius r on the plane spans r * 2 / sqrt(3) cells along each axial axis. */
const BOX = 2 / Math.sqrt(3);
const MEASURE_SIDE = N / BLOCK;

export function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const shader = (type: number, src: string) => {
    const sh = gl.createShader(type);
    if (!sh) throw new Error('no shader');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader failed');
    return sh;
  };
  const prog = gl.createProgram();
  if (!prog) throw new Error('no program');
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
  return prog;
}

function pass(gl: WebGL2RenderingContext, fs: string, names: string[]): Pass {
  const prog = compile(gl, VERTEX, fs);
  const u: Uniforms = {};
  for (const n of ['u_state', 'u_lo', 'u_hi', 'u_r2', 'u_rho', ...names]) u[n] = gl.getUniformLocation(prog, n);
  return { prog, u };
}

function target(gl: WebGL2RenderingContext, format: number, w: number, h: number, linear: boolean) {
  const tex = gl.createTexture();
  if (!tex) throw new Error('no texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
  const filter = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('no framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
  return { tex, fbo };
}

export class Lattice {
  readonly vao: WebGLVertexArrayObject;
  private state: { tex: WebGLTexture; fbo: WebGLFramebuffer }[];
  private cur = 0;
  readonly prep: { tex: WebGLTexture; fbo: WebGLFramebuffer };
  private meas: { tex: WebGLTexture; fbo: WebGLFramebuffer };
  private init: Pass;
  private diffuse: Pass;
  private settle: Pass;
  private prepPass: Pass;
  private measure: Pass;
  private pbo: WebGLBuffer;
  private fence: WebGLSync | null = null;
  private pending: { w: number; h: number; at: number } | null = null;

  /** Updates completed. */
  time = 0;
  /** Vapour density of the far field right now. */
  rho = 0.4;
  /** Radius of the computed disc, in cells. */
  reach = 48;
  /** Farthest ice from the centre at the last reading, in cells (hex distance). */
  radius = 0;
  /** Update the last reading was taken at. */
  radiusAt = 0;
  /** Ice cells at the last reading. */
  cells = 1;
  private seed = 1;

  constructor(readonly gl: WebGL2RenderingContext) {
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('no vertex array');
    this.vao = vao;
    this.state = [target(gl, gl.RGBA32F, N, N, false), target(gl, gl.RGBA32F, N, N, false)];
    this.prep = target(gl, gl.RGBA16F, N, N, true);
    this.meas = target(gl, gl.RGBA32F, MEASURE_SIDE, MEASURE_SIDE, false);
    this.init = pass(gl, INIT, ['u_center']);
    this.diffuse = pass(gl, DIFFUSE, ['u_kappa']);
    this.settle = pass(gl, SETTLE, [
      'u_beta',
      'u_alpha',
      'u_theta',
      'u_mu',
      'u_gamma',
      'u_sigma',
      'u_grow',
      'u_time',
      'u_seed',
    ]);
    this.prepPass = pass(gl, PREP, ['u_time']);
    this.measure = pass(gl, MEASURE, ['u_center']);
    const pbo = gl.createBuffer();
    if (!pbo) throw new Error('no buffer');
    this.pbo = pbo;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, MEASURE_SIDE * MEASURE_SIDE * 16, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }

  get stateTexture(): WebGLTexture {
    return this.state[this.cur].tex;
  }

  /** Half-side of the texture square that holds a disc of radius `reach`. */
  static box(reach: number): number {
    return Math.min(CENTER - 1, Math.ceil(reach * BOX) + 1);
  }

  /** The square holding the computed disc: cells from lo to hi on both axes, inclusive. */
  get lo(): number {
    return CENTER - Lattice.box(this.reach);
  }
  get hi(): number {
    return CENTER + Lattice.box(this.reach);
  }
  get r2(): number {
    return this.reach * this.reach;
  }

  /** Margin of vapour kept around the crystal: the paper grows dendrites in a box half again
   * as wide as the crystal, and slow plates in one twice as wide. */
  static margin(radius: number): number {
    return Math.max(48, Math.ceil(radius * 0.5));
  }

  /** Widest disc the texture holds. */
  static readonly MAX_REACH = Math.floor((CENTER - 2) / BOX);

  /** Largest crystal that keeps its margin inside the texture. */
  static readonly MAX_RADIUS = Math.floor(Lattice.MAX_REACH / 1.5);

  private bounds(p: Pass, reach: number) {
    const gl = this.gl;
    const box = Lattice.box(reach);
    gl.uniform2i(p.u.u_lo, CENTER - box, CENTER - box);
    gl.uniform2i(p.u.u_hi, CENTER + box, CENTER + box);
    gl.uniform1f(p.u.u_r2, reach * reach);
    gl.uniform1f(p.u.u_rho, this.rho);
  }

  private use(p: Pass, input: number) {
    const gl = this.gl;
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.state[input].tex);
    gl.uniform1i(p.u.u_state, 0);
  }

  private draw(fbo: WebGLFramebuffer, reach: number) {
    const gl = this.gl;
    const box = Lattice.box(reach);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(CENTER - box, CENTER - box, box * 2 + 1, box * 2 + 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  reset(rho: number, seed: number): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    this.time = 0;
    this.rho = rho;
    this.reach = 48;
    this.radius = 0;
    this.radiusAt = 0;
    this.cells = 1;
    this.seed = seed >>> 0;
    this.fence = null;
    this.pending = null;
    this.cur = 0;
    this.use(this.init, 1);
    this.bounds(this.init, this.reach);
    gl.uniform2i(this.init.u.u_center, CENTER, CENTER);
    this.draw(this.state[0].fbo, this.reach);
  }

  /** Grow the computed disc to keep the margin around the crystal, allowing for tips that
   * may have run on since the last reading. */
  private fit(): number {
    const ahead = this.radius + (this.time - this.radiusAt) * 0.12 + 2;
    return Math.min(Lattice.MAX_REACH, Math.max(this.reach, Math.ceil(ahead + Lattice.margin(ahead))));
  }

  /** Run `count` updates under `p`, with the far-field vapour changing by `grow` per update. */
  run(count: number, p: Params, grow: number): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    for (let i = 0; i < count; i++) {
      const before = this.reach;
      const reach = this.fit();
      this.reach = reach;
      // Diffusion and freezing: read the old square, write the new one.
      this.use(this.diffuse, this.cur);
      this.bounds(this.diffuse, before);
      gl.uniform1f(this.diffuse.u.u_kappa, p.kappa);
      this.draw(this.state[1 - this.cur].fbo, reach);
      // Attachment, melting, noise.
      this.time++;
      this.use(this.settle, 1 - this.cur);
      this.bounds(this.settle, reach);
      gl.uniform1f(this.settle.u.u_beta, p.beta);
      gl.uniform1f(this.settle.u.u_alpha, p.alpha);
      gl.uniform1f(this.settle.u.u_theta, p.theta);
      gl.uniform1f(this.settle.u.u_mu, p.mu);
      gl.uniform1f(this.settle.u.u_gamma, p.gamma);
      gl.uniform1f(this.settle.u.u_sigma, p.sigma);
      gl.uniform1f(this.settle.u.u_grow, grow);
      gl.uniform1f(this.settle.u.u_time, this.time + 1);
      gl.uniform1ui(this.settle.u.u_seed, (this.seed + this.time * 2654435761) >>> 0);
      this.draw(this.state[this.cur].fbo, reach);
      this.rho *= 1 + grow;
    }
  }

  /** Refresh the texture the view draws from. */
  prepare(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    this.use(this.prepPass, this.cur);
    this.bounds(this.prepPass, this.reach);
    gl.uniform1f(this.prepPass.u.u_time, this.time + 1);
    this.draw(this.prep.fbo, this.reach);
  }

  /** Start a reading of the crystal's size, or collect one that has finished. Readings come
   * back a frame or two late so the GPU never stalls. */
  poll(sync = false): void {
    const gl = this.gl;
    if (this.fence && this.pending) {
      const status = sync
        ? gl.clientWaitSync(this.fence, gl.SYNC_FLUSH_COMMANDS_BIT, 1e9)
        : gl.clientWaitSync(this.fence, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) return;
      const { w, h } = this.pending;
      const data = new Float32Array(w * h * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteSync(this.fence);
      this.fence = null;
      let far = 0;
      let count = 0;
      for (let i = 0; i < w * h; i++) {
        far = Math.max(far, data[i * 4]);
        count += data[i * 4 + 1];
      }
      this.radius = far;
      this.cells = count;
      this.radiusAt = this.pending.at;
      this.pending = null;
      return;
    }
    gl.bindVertexArray(this.vao);
    const x0 = Math.floor(this.lo / BLOCK);
    const x1 = Math.floor(this.hi / BLOCK);
    const w = x1 - x0 + 1;
    this.use(this.measure, this.cur);
    this.bounds(this.measure, this.reach);
    gl.uniform2i(this.measure.u.u_center, CENTER, CENTER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.meas.fbo);
    gl.viewport(x0, x0, w, w);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(x0, x0, w, w, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    // The update the reading describes, so fit() allows for growth since.
    this.pending = { w, h: w, at: this.time };
  }
}
