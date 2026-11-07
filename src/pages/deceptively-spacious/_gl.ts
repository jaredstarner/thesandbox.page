// WebGL 2 plumbing: one scene program per curvature, drawn into a smaller offscreen pair of targets (colour, and
// the ids and depth the pen follows), then inked up to the canvas.

import { buildDecals, type Decals } from './_decals';
import { Ck, Sk, mdot, polar, type Room, type V3 } from './_rooms';
import { CHAIR, FIGURE, LAMP, MAX_DECALS, MAX_PROPS, POST, TABLE, VERTEX, sceneFragment } from './_scene';

export interface FigureView {
  p: V3;
  f: V3;
  r: V3;
  above: boolean;
}

export interface View {
  p: V3;
  f: V3;
  r: V3;
  eyeZ: number;
  pitch: number;
  up: number;
  cell: number;
  figure: FigureView;
  ghost: FigureView | null;
  stride: number;
  swing: number;
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const SIZES: Record<string, [number, number]> = {
  [CHAIR]: [0.62, 1.0],
  [TABLE]: [0.4, 1.22],
  [LAMP]: [0.3, 1.66],
  [FIGURE]: [0.5, 1.86],
};

type Uniforms = Record<string, WebGLUniformLocation | null>;

interface Program {
  program: WebGLProgram;
  u: Uniforms;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private vao: WebGLVertexArrayObject;
  private programs = new Map<number, Program>();
  private post: Program;
  private fbo: WebGLFramebuffer;
  private colorTex: WebGLTexture;
  private dataTex: WebGLTexture;
  private atlasTex: WebGLTexture;
  private marksTex: WebGLTexture;
  private decals: Decals;
  private room: Room | null = null;
  private srcW = 0;
  private srcH = 0;
  /** Fraction of canvas pixels the scene is traced at. */
  scale = 1;

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    this.fbo = gl.createFramebuffer()!;
    this.colorTex = this.target();
    this.dataTex = this.target();
    this.atlasTex = gl.createTexture()!;
    this.marksTex = gl.createTexture()!;
    this.decals = buildDecals();
    this.post = this.compile(POST);
    this.uploadAtlas();
    gl.bindTexture(gl.TEXTURE_2D, this.marksTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Redraws the lettering once the page's fonts have arrived. */
  refreshDecals() {
    this.decals = buildDecals();
    this.uploadAtlas();
  }

  private uploadAtlas() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.decals.canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private target(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private compile(fragment: string): Program {
    const gl = this.gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
      }
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
    }
    const u: Uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(program, info.name);
    }
    return { program, u };
  }

  private sceneProgram(kappa: number): Program {
    let p = this.programs.get(kappa);
    if (!p) {
      p = this.compile(sceneFragment(kappa));
      this.programs.set(kappa, p);
    }
    return p;
  }

  private bindTargets(w: number, h: number) {
    const gl = this.gl;
    for (const t of [this.colorTex, this.dataTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.dataTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.srcW = w;
    this.srcH = h;
  }

  setRoom(room: Room) {
    this.room = room;
    const gl = this.gl;
    const { program, u } = this.sceneProgram(room.kappa);
    gl.useProgram(program);
    const s = room.spec;
    const pal = s.palette;
    const flat = (vs: V3[]) => new Float32Array(vs.flat());
    gl.uniform1i(u.uN!, room.n);
    gl.uniform3fv(u.uWall!, flat(room.wall));
    gl.uniform3fv(u.uOuter!, flat(room.outer));
    gl.uniform3fv(u.uJambA!, flat(room.jambA));
    gl.uniform3fv(u.uJambB!, flat(room.jambB));
    gl.uniform2fv(u.uAlong!, new Float32Array(room.along.flat()));
    // Column-major for GLSL.
    const gs = room.g.flatMap((m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
    gl.uniformMatrix3fv(u.uG!, false, new Float32Array(gs));
    gl.uniform1iv(u.uPair!, new Int32Array(room.pair));
    gl.uniform1iv(u.uFlip!, new Int32Array(room.flip.map((f) => (f ? 1 : 0))));
    gl.uniform1iv(u.uDoorInk!, new Int32Array(room.pair.map((o, i) => Math.min(o, i))));
    gl.uniform1f(u.uHeight!, room.height);
    gl.uniform1f(u.uDoorW!, room.doorW);
    gl.uniform1f(u.uDoorH!, room.doorH);
    gl.uniform1f(u.uUnit!, room.unit);
    gl.uniform1f(u.uExtent!, room.extent);
    gl.uniform1i(u.uPaper!, s.wallpaper);
    gl.uniform1i(u.uFloor!, s.floor);
    gl.uniform1i(u.uFold!, s.doorHeight >= s.height ? 1 : 0);
    const colours: [string, string][] = [
      ['uWallA', pal.wall],
      ['uWallB', pal.wall2],
      ['uDado', pal.dado],
      ['uTrim', pal.trim],
      ['uFloorA', pal.floorA],
      ['uFloorB', pal.floorB],
      ['uCeil', pal.ceiling],
      ['uRugA', pal.rugA],
      ['uRugB', pal.rugB],
      ['uFabric', pal.fabric],
    ];
    for (const [name, hex] of colours) gl.uniform3fv(u[name]!, rgb(hex));
    const doors = new Float32Array(12);
    pal.doors.forEach((d, i) => doors.set(rgb(d), i * 3));
    gl.uniform3fv(u.uDoors!, doors);

    const lamp = polar(room.kappa, s.lamp[1] / room.unit, s.lamp[0]);
    gl.uniform3fv(u.uLamp!, lamp);
    gl.uniform1f(u.uLampZ!, s.lamp[2] / room.unit);

    // Props after the two figure slots.
    const C = new Float32Array(MAX_PROPS * 3);
    const R = new Float32Array(MAX_PROPS * 3);
    const F = new Float32Array(MAX_PROPS * 3);
    const kinds = new Int32Array(MAX_PROPS);
    const above = new Int32Array(MAX_PROPS);
    const rad = new Float32Array(MAX_PROPS);
    const tall = new Float32Array(MAX_PROPS);
    kinds[0] = FIGURE;
    kinds[1] = FIGURE;
    s.props.forEach((prop, i) => {
      const j = i + 2;
      const c = polar(room.kappa, prop.r / room.unit, prop.theta);
      const frame = propFrame(room, c, prop.yaw);
      C.set(c, j * 3);
      R.set(frame.r, j * 3);
      F.set(frame.f, j * 3);
      const kind = prop.kind === 'lamp' ? LAMP : prop.kind === 'chair' ? CHAIR : TABLE;
      kinds[j] = kind;
      above[j] = prop.above ? 1 : 0;
      rad[j] = SIZES[kind]![0] / room.unit;
      tall[j] = SIZES[kind]![1] / room.unit;
    });
    gl.uniform1i(u.uPropN!, s.props.length + 2);
    gl.uniform3fv(u.uPropC!, C);
    gl.uniform3fv(u.uPropR!, R);
    gl.uniform3fv(u.uPropF!, F);
    gl.uniform1iv(u.uPropKind!, kinds);
    gl.uniform1iv(u.uPropAbove!, above);
    gl.uniform1fv(u.uPropRad!, rad);
    gl.uniform1fv(u.uPropTall!, tall);

    const decalWall = new Int32Array(MAX_DECALS);
    const decalClock = new Int32Array(MAX_DECALS);
    const decalBox = new Float32Array(MAX_DECALS * 4);
    const decalUV = new Float32Array(MAX_DECALS * 4);
    s.decals.forEach((d, i) => {
      decalWall[i] = d.wall;
      decalClock[i] = d.cell === 'clock' ? 1 : 0;
      decalBox.set([d.a, d.z, d.w, d.h], i * 4);
      decalUV.set(this.decals.cells[d.cell], i * 4);
    });
    gl.uniform1i(u.uDecalN!, s.decals.length);
    gl.uniform1iv(u.uDecalWall!, decalWall);
    gl.uniform1iv(u.uDecalClock!, decalClock);
    gl.uniform4fv(u.uDecalBox!, decalBox);
    gl.uniform4fv(u.uDecalUV!, decalUV);
    const letters = new Float32Array(8 * 4);
    for (let i = 0; i < room.n; i++) letters.set(this.decals.letters[Math.min(i, room.pair[i]!)]!, i * 4);
    gl.uniform4fv(u.uLetter!, letters);
    gl.uniform1i(u.uAtlas!, 0);
    gl.uniform1i(u.uMarks!, 1);
  }

  uploadMarks(canvas: HTMLCanvasElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.marksTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  draw(view: View) {
    const room = this.room;
    if (!room) return;
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const w = Math.max(2, Math.round(cw * this.scale));
    const h = Math.max(2, Math.round(ch * this.scale));
    if (w !== this.srcW || h !== this.srcH) this.bindTargets(w, h);

    const { program, u } = this.sceneProgram(room.kappa);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.marksTex);
    gl.activeTexture(gl.TEXTURE0);

    gl.uniform2f(u.uRes!, w, h);
    const aspect = w / h;
    gl.uniform1f(u.uFocal!, Math.min(1.5, aspect * 1.35));
    gl.uniform3fv(u.uEye!, view.p);
    gl.uniform3fv(u.uFwd!, view.f);
    gl.uniform3fv(u.uRight!, view.r);
    gl.uniform1f(u.uEyeZ!, view.eyeZ);
    gl.uniform1f(u.uPitch!, view.pitch);
    gl.uniform1f(u.uUp!, view.up);
    gl.uniform1i(u.uCell!, view.cell);
    gl.uniform1f(u.uStride!, view.stride);
    gl.uniform1f(u.uSwing!, view.swing);

    const n = room.spec.props.length + 2;
    const C = new Float32Array(n * 3);
    const R = new Float32Array(n * 3);
    const F = new Float32Array(n * 3);
    const above = new Int32Array(n);
    const rad = new Float32Array(n);
    const tall = new Float32Array(n);
    const slot = (j: number, f: FigureView | null) => {
      if (!f) return;
      C.set(f.p, j * 3);
      R.set(f.r, j * 3);
      F.set(f.f, j * 3);
      above[j] = f.above ? 1 : 0;
      rad[j] = SIZES[FIGURE]![0] / room.unit;
      tall[j] = SIZES[FIGURE]![1] / room.unit;
    };
    slot(0, view.figure);
    slot(1, view.ghost);
    // Only the two figure slots change from frame to frame.
    gl.uniform3fv(gl.getUniformLocation(program, 'uPropC[0]'), C.subarray(0, 6));
    gl.uniform3fv(gl.getUniformLocation(program, 'uPropR[0]'), R.subarray(0, 6));
    gl.uniform3fv(gl.getUniformLocation(program, 'uPropF[0]'), F.subarray(0, 6));
    gl.uniform1iv(gl.getUniformLocation(program, 'uPropAbove[0]'), above.subarray(0, 2));
    gl.uniform1fv(gl.getUniformLocation(program, 'uPropRad[0]'), rad.subarray(0, 2));
    gl.uniform1fv(gl.getUniformLocation(program, 'uPropTall[0]'), tall.subarray(0, 2));

    const now = new Date();
    const minutes = now.getMinutes() + now.getSeconds() / 60;
    const hours = (now.getHours() % 12) + minutes / 60;
    gl.uniform1f(u.uHour!, (hours / 12) * 2 * Math.PI);
    gl.uniform1f(u.uMinute!, (minutes / 60) * 2 * Math.PI);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(this.post.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
    gl.uniform1i(this.post.u.uColor!, 0);
    gl.uniform1i(this.post.u.uData!, 1);
    gl.uniform2f(this.post.u.uRes!, cw, ch);
    gl.uniform2f(this.post.u.uSrc!, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}

/** A prop's right and forward vectors at c, facing yaw as seen from the middle of the plan. */
function propFrame(room: Room, c: V3, yaw: number): { f: V3; r: V3 } {
  const k = room.kappa;
  // Unit tangents at c: slide a tangent frame out from the room's middle along the radius.
  const r = Math.hypot(c[0], c[1]);
  const theta = Math.atan2(c[1], c[0]);
  const dist = k === 0 ? r : k > 0 ? Math.atan2(r, c[2]) : Math.asinh(r);
  const radial: V3 = [Ck(k, dist) * Math.cos(theta), Ck(k, dist) * Math.sin(theta), k === 0 ? 0 : k > 0 ? -Sk(k, dist) : Sk(k, dist)];
  const around: V3 = [-Math.sin(theta), Math.cos(theta), 0];
  const a = yaw - theta;
  const f: V3 = [
    Math.cos(a) * radial[0] + Math.sin(a) * around[0],
    Math.cos(a) * radial[1] + Math.sin(a) * around[1],
    Math.cos(a) * radial[2] + Math.sin(a) * around[2],
  ];
  const q: V3 = [
    Math.sin(a) * radial[0] - Math.cos(a) * around[0],
    Math.sin(a) * radial[1] - Math.cos(a) * around[1],
    Math.sin(a) * radial[2] - Math.cos(a) * around[2],
  ];
  void mdot;
  return { f, r: q };
}
