// The night chart in WebGL2.
//
// Land is filled through the stencil buffer (see _land.ts). Lights and their
// sector arcs are instanced quads whose rhythm is read in the vertex shader
// from a texture of every rhythm, so the CPU never touches 60,000 lights per
// frame. They are added into a half-float target and tone-mapped onto the
// chart, so a crowded coast glows instead of clipping to white.

import type { Land } from './_land';
import type { Lights } from './_lights';
import { span } from './_sectors';

export interface View {
  /** Centre, Mercator. */
  x: number;
  y: number;
  /** CSS pixels per Mercator unit. */
  s: number;
}

/** Light colours in linear-ish RGB, by code: 1 W, 2 R, 3 G, 4 Y, 5 Bu, 6 Vi, 7 Or. */
export const LIGHT_RGB: [number, number, number][] = [
  [0, 0, 0],
  [1.0, 0.84, 0.6],
  [1.0, 0.17, 0.1],
  [0.16, 1.0, 0.5],
  [1.0, 0.7, 0.16],
  [0.36, 0.56, 1.0],
  [0.72, 0.42, 1.0],
  [1.0, 0.46, 0.12],
];

const MAX_STEPS = 64;

const RHYTHM_GLSL = `
uniform highp sampler2D u_rhythms;
uniform float u_time;
// Level of a light, and its colour code (8 = its own colour).
vec2 rhythm(float idx, float phase) {
  int ri = int(idx + 0.5);
  vec4 head = texelFetch(u_rhythms, ivec2(0, ri), 0);
  float period = head.x;
  if (period <= 0.0) return vec2(1.0, 8.0);
  int n = int(head.y + 0.5);
  float base = head.z;
  float x = mod(u_time + phase, period);
  float start = 0.0;
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (i >= n) break;
    vec4 s = texelFetch(u_rhythms, ivec2(i + 1, ri), 0);
    if (x < s.x) {
      if (s.y < 0.5) return vec2(base, 8.0);
      float edge = min(x - start, s.x - x);
      return vec2(base + (1.0 - base) * min(1.0, edge / 0.06), s.y);
    }
    start = s.x;
  }
  return vec2(base, 8.0);
}
`;

const LAND_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
uniform vec2 u_center;
uniform float u_scale;
uniform vec2 u_res;
uniform float u_offset;
void main() {
  vec2 p = (a_pos + vec2(u_offset, 0.0) - u_center) * u_scale;
  gl_Position = vec4(p.x * 2.0 / u_res.x, -p.y * 2.0 / u_res.y, 0.0, 1.0);
}`;

const FLAT_FS = `#version 300 es
precision mediump float;
uniform vec4 u_colour;
out vec4 o;
void main() { o = u_colour; }`;

const FULL_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 v_uv;
void main() {
  vec2 p = P[gl_VertexID];
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_hdr;
uniform float u_exposure;
out vec4 o;
void main() {
  vec3 c = texture(u_hdr, v_uv).rgb;
  o = vec4(1.0 - exp(-c * u_exposure), 1.0);
}`;

const LIGHT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;
layout(location = 2) in vec4 a_meta;  // rhythm, colour, range, phase
layout(location = 3) in vec2 a_flags; // lit, floating
uniform vec2 u_center;
uniform float u_scale;
uniform vec2 u_res;
uniform float u_dpr;
uniform float u_zoom;   // 0 at world view, 1 close in
uniform float u_gain;
uniform vec3 u_colours[8];
${RHYTHM_GLSL}
out vec2 v_uv;
out vec3 v_rgb;
void main() {
  if (a_flags.x < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 d = a_pos - u_center;
  d.x -= floor(d.x + 0.5);
  vec2 p = d * u_scale;
  vec2 lv = rhythm(a_meta.x, a_meta.w);
  int code = int(lv.y + 0.5);
  vec3 rgb = u_colours[code == 8 ? int(a_meta.y + 0.5) : code];
  float r = sqrt(max(a_meta.z, 1.0));
  float core = (mix(0.9, 2.2, u_zoom) + r * mix(0.22, 0.75, u_zoom)) * (a_flags.y > 0.5 ? 0.75 : 1.0);
  float size = core * 5.0 * u_dpr;
  v_uv = a_corner * 5.0;
  v_rgb = rgb * lv.x * u_gain * mix(0.7, 1.0, min(1.0, r / 4.0));
  p += a_corner * size;
  gl_Position = vec4(p.x * 2.0 / u_res.x, -p.y * 2.0 / u_res.y, 0.0, 1.0);
}`;

const LIGHT_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec3 v_rgb;
out vec4 o;
void main() {
  float d = length(v_uv);
  float core = exp(-d * d * 1.1);
  float halo = 0.2 * exp(-d * 0.95) * (1.0 - smoothstep(4.0, 5.0, d));
  o = vec4(v_rgb * (core * 1.5 + halo), 1.0);
}`;

const SECTOR_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_arc;   // u along the arc, v out from the light
layout(location = 1) in vec4 a_geo;   // x, y, from, span (radians, from the light)
layout(location = 2) in vec4 a_meta;  // rhythm, colour, phase, radius (css px)
uniform vec2 u_center;
uniform float u_scale;
uniform vec2 u_res;
uniform float u_dpr;
uniform float u_gain;
uniform vec3 u_colours[8];
${RHYTHM_GLSL}
out vec3 v_rgb;
out vec2 v_arc;
out float v_rpx;
out float v_spanpx;
void main() {
  vec2 d = a_geo.xy - u_center;
  d.x -= floor(d.x + 0.5);
  vec2 p = d * u_scale;
  float a = a_geo.z + a_geo.w * a_arc.x;
  float rpx = a_meta.w * u_dpr;
  p += vec2(sin(a), -cos(a)) * a_arc.y * rpx;
  vec2 lv = rhythm(a_meta.x, a_meta.z);
  v_rgb = u_colours[int(a_meta.y + 0.5)] * (0.35 + 0.65 * lv.x) * u_gain;
  v_arc = a_arc;
  v_rpx = rpx;
  v_spanpx = a_geo.w * rpx;
  gl_Position = vec4(p.x * 2.0 / u_res.x, -p.y * 2.0 / u_res.y, 0.0, 1.0);
}`;

const SECTOR_FS = `#version 300 es
precision mediump float;
in vec3 v_rgb;
in vec2 v_arc;
in float v_rpx;
in float v_spanpx;
uniform highp float u_dpr;
out vec4 o;
void main() {
  float fromRim = (1.0 - v_arc.y) * v_rpx;
  float rim = 1.0 - smoothstep(0.4 * u_dpr, 1.8 * u_dpr, fromRim);
  // Sector limits: the straight edges, dashed as on a chart.
  float edgePx = min(v_arc.x, 1.0 - v_arc.x) * v_spanpx * v_arc.y;
  float dash = step(0.5, fract(v_arc.y * v_rpx / (5.0 * u_dpr)));
  float limit = (1.0 - smoothstep(0.3 * u_dpr, 1.2 * u_dpr, edgePx)) * dash * 0.2 * step(0.3, v_arc.y);
  float fill = 0.03 * smoothstep(0.2, 0.9, v_arc.y);
  o = vec4(v_rgb * (rim * 0.75 + limit + fill), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;
function uniforms(gl: WebGL2RenderingContext, p: WebGLProgram, names: string[]): Uniforms {
  return Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
}

const ARC_SEGMENTS = 40;

interface LandBuffers {
  vao: WebGLVertexArrayObject;
  linesVao: WebGLVertexArrayObject;
  fanCount: number;
  lakeVao: WebGLVertexArrayObject;
  lakeCount: number;
  lineCount: number;
}

export class Chart {
  readonly gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private lights: Lights;
  private progLand: WebGLProgram;
  private progComposite: WebGLProgram;
  private progFill: WebGLProgram;
  private uFill: Uniforms;
  private progLight: WebGLProgram;
  private progSector: WebGLProgram;
  private uLand: Uniforms;
  private uComposite: Uniforms;
  private uLight: Uniforms;
  private uSector: Uniforms;
  private lightVao: WebGLVertexArrayObject;
  private sectorVao: WebGLVertexArrayObject;
  private sectorBuf: WebGLBuffer;
  private sectorData: Float32Array;
  /** Sector instances: light index and the arc, from the light, in radians. */
  private arcs: { i: number; from: number; span: number; colour: number; plain: boolean }[] = [];
  private gratVao: WebGLVertexArrayObject;
  private gratBuf: WebGLBuffer;
  private rhythmTex: WebGLTexture;
  private hdr: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
  private floatTarget: boolean;
  private land: { coarse?: LandBuffers; fine?: LandBuffers } = {};
  dpr = 1;
  width = 1;
  height = 1;

  constructor(canvas: HTMLCanvasElement, lights: Lights) {
    const gl = canvas.getContext('webgl2', { antialias: true, stencil: true, alpha: false, depth: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.canvas = canvas;
    this.lights = lights;
    this.floatTarget = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_float_blend');

    this.progLand = compile(gl, LAND_VS, FLAT_FS);
    this.uLand = uniforms(gl, this.progLand, ['u_center', 'u_scale', 'u_res', 'u_offset', 'u_colour']);
    this.progFill = compile(gl, FULL_VS, FLAT_FS);
    this.uFill = uniforms(gl, this.progFill, ['u_colour']);
    this.progComposite = compile(gl, FULL_VS, COMPOSITE_FS);
    this.uComposite = uniforms(gl, this.progComposite, ['u_hdr', 'u_exposure']);
    const lightNames = [
      'u_center',
      'u_scale',
      'u_res',
      'u_dpr',
      'u_zoom',
      'u_gain',
      'u_colours',
      'u_rhythms',
      'u_time',
    ];
    this.progLight = compile(gl, LIGHT_VS, LIGHT_FS);
    this.uLight = uniforms(gl, this.progLight, lightNames);
    this.progSector = compile(gl, SECTOR_VS, SECTOR_FS);
    this.uSector = uniforms(gl, this.progSector, [...lightNames]);

    this.rhythmTex = this.makeRhythmTexture();

    // Lights: one quad, instanced.
    this.lightVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lightVao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const inst = new Float32Array(lights.n * 8);
    for (let i = 0; i < lights.n; i++) {
      const o = i * 8;
      inst[o] = lights.xy[i * 2];
      inst[o + 1] = lights.xy[i * 2 + 1];
      inst[o + 2] = lights.rhythm[i];
      inst[o + 3] = lights.colour[i];
      inst[o + 4] = lights.range[i];
      inst[o + 5] = lights.phase[i];
      inst[o + 6] = lights.lit[i];
      inst[o + 7] = lights.floating[i];
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
    const attr = (loc: number, size: number, offset: number, stride: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(1, 2, 0, 8);
    attr(2, 4, 2, 8);
    attr(3, 2, 6, 8);

    // Sector arcs: a strip of ARC_SEGMENTS, instanced per visible sector.
    for (let i = 0; i < lights.n; i++) {
      const si = lights.sector[i];
      if (!si || !lights.lit[i]) continue;
      const set = lights.sectors[si];
      // A light shown in one colour over most of the compass needs no arc until close in.
      const plain = new Set(set.map((s) => s.colour)).size < 2 && set.reduce((a, s) => a + span(s.from, s.to), 0) > 300;
      for (const s of set) {
        // Bearings are from seaward toward the light; the arc lies the other way.
        this.arcs.push({
          i,
          from: (((s.from + 180) % 360) * Math.PI) / 180,
          span: (span(s.from, s.to) * Math.PI) / 180,
          colour: s.colour ? ['W', 'R', 'G', 'Y', 'Bu', 'Vi', 'Or'].indexOf(s.colour) + 1 : 1,
          plain,
        });
      }
    }
    this.sectorVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.sectorVao);
    const strip: number[] = [];
    for (let k = 0; k <= ARC_SEGMENTS; k++) strip.push(k / ARC_SEGMENTS, 0, k / ARC_SEGMENTS, 1);
    const sb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(strip), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.sectorData = new Float32Array(this.arcs.length * 8);
    this.sectorBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sectorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.sectorData.byteLength || 32, gl.DYNAMIC_DRAW);
    attr(1, 4, 0, 8);
    attr(2, 4, 4, 8);

    this.gratVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.gratVao);
    this.gratBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gratBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private makeRhythmTexture(): WebGLTexture {
    const gl = this.gl;
    const rs = this.lights.rhythms;
    const w = MAX_STEPS + 1;
    const data = new Float32Array(w * rs.length * 4);
    rs.forEach((r, row) => {
      const o = row * w * 4;
      const pairs = Math.min(MAX_STEPS, r.steps.length / 2);
      data[o] = r.period;
      data[o + 1] = pairs;
      data[o + 2] = r.base;
      let t = 0;
      for (let k = 0; k < pairs; k++) {
        t += r.steps[k * 2];
        data[o + (k + 1) * 4] = t;
        data[o + (k + 1) * 4 + 1] = r.steps[k * 2 + 1];
      }
    });
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, rs.length, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  }

  setLand(land: Land, which: 'coarse' | 'fine') {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, land.xy, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const fb = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fb);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, land.fan, gl.STATIC_DRAW);
    const indexed = (indices: Uint32Array) => {
      const v = gl.createVertexArray()!;
      gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      return v;
    };
    const lakeVao = indexed(land.lakeFan);
    const linesVao = indexed(land.lines);
    gl.bindVertexArray(null);
    this.land[which] = {
      vao,
      linesVao,
      lakeVao,
      fanCount: land.fan.length,
      lakeCount: land.lakeFan.length,
      lineCount: land.lines.length,
    };
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.width = w;
    this.height = h;
    if (!this.hdr || this.hdr.w !== w || this.hdr.h !== h) this.makeTarget(w, h);
  }

  private makeTarget(w: number, h: number) {
    const gl = this.gl;
    if (this.hdr) {
      gl.deleteFramebuffer(this.hdr.fb);
      gl.deleteTexture(this.hdr.tex);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.floatTarget) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && this.floatTarget) {
      this.floatTarget = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.makeTarget(w, h);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.hdr = { fb, tex, w, h };
  }

  /** 0 at the whole world, 1 when a few harbours fill the screen. */
  static zoomOf(v: View): number {
    const z = Math.log2(v.s / 256);
    return Math.max(0, Math.min(1, (z - 2.3) / 8.5));
  }

  draw(v: View, time: number, opts: { fine: boolean; sectors: number }) {
    const gl = this.gl;
    const W = this.width;
    const H = this.height;
    const S = v.s * this.dpr;
    const zoom = Chart.zoomOf(v);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.012, 0.024, 0.043, 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    // Graticule.
    const grat = this.graticule(v);
    gl.useProgram(this.progLand);
    gl.uniform2f(this.uLand.u_center, v.x, v.y);
    gl.uniform1f(this.uLand.u_scale, S);
    gl.uniform2f(this.uLand.u_res, W, H);
    gl.uniform1f(this.uLand.u_offset, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.gratVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gratBuf);
    gl.bufferData(gl.ARRAY_BUFFER, grat, gl.STREAM_DRAW);
    gl.uniform4f(this.uLand.u_colour, 0.55, 0.68, 0.8, 0.075);
    gl.drawArrays(gl.LINES, 0, grat.length / 2);

    // Land, through the stencil.
    const land = (opts.fine && this.land.fine) || this.land.coarse;
    if (land) {
      const offsets = [-1, 0, 1];
      gl.enable(gl.STENCIL_TEST);
      gl.colorMask(false, false, false, false);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
      gl.stencilMask(0x01);
      gl.bindVertexArray(land.vao);
      for (const o of offsets) {
        gl.uniform1f(this.uLand.u_offset, o);
        gl.drawElements(gl.TRIANGLES, land.fanCount, gl.UNSIGNED_INT, 0);
      }
      // Lakes into a second bit: land is where the first is set and the second is not.
      gl.stencilMask(0x02);
      gl.bindVertexArray(land.lakeVao);
      for (const o of offsets) {
        gl.uniform1f(this.uLand.u_offset, o);
        gl.drawElements(gl.TRIANGLES, land.lakeCount, gl.UNSIGNED_INT, 0);
      }
      gl.stencilMask(0xff);
      gl.colorMask(true, true, true, true);
      gl.stencilFunc(gl.EQUAL, 1, 0x03);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.disable(gl.BLEND);
      gl.useProgram(this.progFill);
      gl.uniform4f(this.uFill.u_colour, 0.074, 0.076, 0.08, 1);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.STENCIL_TEST);
      gl.enable(gl.BLEND);
      gl.useProgram(this.progLand);
      gl.bindVertexArray(land.linesVao);
      gl.uniform4f(this.uLand.u_colour, 0.42, 0.5, 0.58, 0.32 + 0.25 * zoom);
      for (const o of offsets) {
        gl.uniform1f(this.uLand.u_offset, o);
        gl.drawElements(gl.LINE_STRIP, land.lineCount, gl.UNSIGNED_INT, 0);
      }
    }

    // Lights and sectors into the half-float target.
    const hdr = this.hdr!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, hdr.fb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const gain = this.floatTarget ? 1 : 0.6;
    const colours = new Float32Array(LIGHT_RGB.flat());
    const common = (u: Uniforms) => {
      gl.uniform2f(u.u_center, v.x, v.y);
      gl.uniform1f(u.u_scale, S);
      gl.uniform2f(u.u_res, W, H);
      gl.uniform1f(u.u_dpr, this.dpr);
      gl.uniform1f(u.u_zoom, zoom);
      gl.uniform3fv(u.u_colours, colours);
      gl.uniform1f(u.u_time, time);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.rhythmTex);
      gl.uniform1i(u.u_rhythms, 0);
    };

    if (opts.sectors > 0.01) {
      const n = this.fillSectors(v);
      if (n) {
        gl.useProgram(this.progSector);
        common(this.uSector);
        gl.uniform1f(this.uSector.u_gain, gain * opts.sectors);
        gl.bindVertexArray(this.sectorVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (ARC_SEGMENTS + 1) * 2, n);
      }
    }

    gl.useProgram(this.progLight);
    common(this.uLight);
    // A small screen packs the whole world's lights closer together; dim them to match.
    const density = Math.min(1, Math.max(0.45, (v.s / 1500) ** 0.7));
    gl.uniform1f(this.uLight.u_gain, gain * (0.5 + 0.5 * zoom) * density);
    gl.bindVertexArray(this.lightVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.lights.n);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.progComposite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, hdr.tex);
    gl.uniform1i(this.uComposite.u_hdr, 0);
    gl.uniform1f(this.uComposite.u_exposure, 1.25);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }

  /** Writes the sector arcs on screen into the instance buffer; returns how many. */
  private fillSectors(v: View): number {
    const gl = this.gl;
    const L = this.lights;
    const hw = this.width / this.dpr / 2 / v.s;
    const hh = this.height / this.dpr / 2 / v.s;
    const z = Math.log2(v.s / 256);
    const radius = Math.min(46, 14 + 9 * Math.max(0, z - 7.5));
    const minRange = z < 8.5 ? 12 : z < 9.5 ? 7 : z < 10.5 ? 3 : 0;
    const pad = (radius + 4) / v.s;
    let n = 0;
    const d = this.sectorData;
    for (const a of this.arcs) {
      if (a.plain || L.range[a.i] < minRange) continue;
      let dx = L.xy[a.i * 2] - v.x;
      dx -= Math.floor(dx + 0.5);
      const dy = L.xy[a.i * 2 + 1] - v.y;
      if (Math.abs(dx) > hw + pad || Math.abs(dy) > hh + pad) continue;
      const r = radius * (0.7 + 0.3 * Math.min(1, L.range[a.i] / 18));
      const o = n * 8;
      d[o] = L.xy[a.i * 2];
      d[o + 1] = L.xy[a.i * 2 + 1];
      d[o + 2] = a.from;
      d[o + 3] = a.span;
      d[o + 4] = L.rhythm[a.i];
      d[o + 5] = a.colour;
      d[o + 6] = L.phase[a.i];
      d[o + 7] = r;
      n++;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sectorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, n * 8), gl.STREAM_DRAW);
    return n;
  }

  /** Parallels and meridians at a spacing that suits the scale, in Mercator. */
  private graticule(v: View): Float32Array {
    const steps = [30, 10, 5, 2, 1, 0.5, 1 / 6, 1 / 12, 1 / 60];
    const degPx = v.s / 360;
    const step = steps.find((s) => s * degPx < 260) ?? 1 / 60;
    const hw = this.width / this.dpr / 2 / v.s;
    const hh = this.height / this.dpr / 2 / v.s;
    const out: number[] = [];
    const x0 = v.x - hw;
    const x1 = v.x + hw;
    const lon0 = Math.floor((x0 * 360 - 180) / step) * step;
    for (let lon = lon0; (lon + 180) / 360 <= x1; lon += step) {
      const x = (lon + 180) / 360;
      out.push(x, v.y - hh, x, v.y + hh);
    }
    const y0 = Math.max(0, v.y - hh);
    const y1 = Math.min(1, v.y + hh);
    const latTop = Math.atan(Math.sinh(Math.PI * (1 - 2 * y0))) * (180 / Math.PI);
    const latBot = Math.atan(Math.sinh(Math.PI * (1 - 2 * y1))) * (180 / Math.PI);
    for (let lat = Math.ceil(latBot / step) * step; lat <= latTop; lat += step) {
      const s = Math.sin((lat * Math.PI) / 180);
      const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
      out.push(x0, y, x1, y);
    }
    return new Float32Array(out);
  }
}
