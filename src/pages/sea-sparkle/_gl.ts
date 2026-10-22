// Draws /sea-sparkle/'s water in WebGL2. Each particle is splatted into a
// half-resolution field of water and light; the field is thresholded into a
// surface, the light is blurred twice for its halo, and every particle then
// draws a pinpoint or two: dim specks of plankton at rest, bright when they flash.

import { STRIDE, type Box } from './_tank';

const QUAD_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const SPLAT_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_vel;
layout(location = 2) in vec2 a_lt;
uniform vec2 u_origin;
uniform vec2 u_view;
uniform float u_ahead;
uniform float u_size;
out float v_light;
void main() {
  vec2 p = a_pos + a_vel * u_ahead - u_origin;
  vec2 ndc = p / u_view * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  gl_PointSize = u_size;
  v_light = a_lt.x;
}`;

const SPLAT_FS = `#version 300 es
precision highp float;
in float v_light;
uniform float u_gain;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(q, q);
  if (d2 > 1.0) discard;
  float w = 1.0 - d2;
  w *= w;
  o = vec4(w, w * v_light, 0.0, 1.0) * u_gain;
}`;

// A 9-tap Gaussian along one axis, on the light channel only.
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_step;
out vec4 o;
void main() {
  float g = texture(u_src, v_uv).g * 0.2270270;
  g += (texture(u_src, v_uv + u_step).g + texture(u_src, v_uv - u_step).g) * 0.1945946;
  g += (texture(u_src, v_uv + 2.0 * u_step).g + texture(u_src, v_uv - 2.0 * u_step).g) * 0.1216216;
  g += (texture(u_src, v_uv + 3.0 * u_step).g + texture(u_src, v_uv - 3.0 * u_step).g) * 0.0540540;
  g += (texture(u_src, v_uv + 4.0 * u_step).g + texture(u_src, v_uv - 4.0 * u_step).g) * 0.0162162;
  o = vec4(0.0, g, 0.0, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_field;
uniform sampler2D u_near;
uniform sampler2D u_far;
uniform vec2 u_origin;
uniform vec2 u_view;
uniform vec2 u_screen;
uniform vec2 u_texel;
uniform float u_ref;
uniform vec4 u_others[8];
uniform int u_otherCount;
out vec4 o;

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

// Is this point, in viewport px, inside one of the other windows?
bool joined(vec2 p) {
  vec2 s = p + u_origin;
  for (int i = 0; i < 8; i++) {
    if (i >= u_otherCount) break;
    vec4 r = u_others[i];
    if (s.x >= r.x && s.x <= r.x + r.z && s.y >= r.y && s.y <= r.y + r.w) return true;
  }
  return false;
}

// A pane of glass along one edge, unless another window carries on past it.
float glass(float d, vec2 outside) {
  if (joined(outside)) return 0.0;
  return exp(-d / 0.9) * 0.34 + exp(-d / 7.0) * 0.045;
}

void main() {
  vec2 css = vec2(v_uv.x, 1.0 - v_uv.y) * u_view;
  vec2 world = css + u_origin;

  // The room behind the tank is fixed to the screen, not the window: a dim
  // lamp somewhere above the monitor, and a fine grain that stays put.
  vec2 su = world / u_screen;
  float lamp = exp(-dot(su - vec2(0.5, -0.15), su - vec2(0.5, -0.15)) * 2.6);
  vec3 col = vec3(0.016, 0.021, 0.03) + vec3(0.03, 0.036, 0.046) * lamp;
  col += (hash(floor(world)) - 0.5) * 0.006;

  vec4 f = texture(u_field, v_uv);
  float d = f.r / u_ref;
  float water = smoothstep(0.3, 0.6, d);
  float l = texture(u_field, v_uv - vec2(u_texel.x, 0.0)).r;
  float r = texture(u_field, v_uv + vec2(u_texel.x, 0.0)).r;
  float dn = texture(u_field, v_uv - vec2(0.0, u_texel.y)).r;
  float up = texture(u_field, v_uv + vec2(0.0, u_texel.y)).r;
  // Outward normal, in screen orientation (y down).
  vec2 n = -vec2(r - l, dn - up);
  float len = length(n);
  n = len > 1e-5 ? n / len : vec2(0.0, -1.0);

  // Seawater in a dark room: a little darker and greener than the air, and a
  // cool rim where the surface catches the lamp.
  vec3 sea = vec3(0.008, 0.026, 0.034) + vec3(0.012, 0.03, 0.036) * lamp;
  float deep = smoothstep(0.6, 2.2, d);
  sea *= 1.0 - 0.35 * deep;
  col = mix(col, sea, water * 0.92);
  float rim = water * (1.0 - water) * 4.0;
  float facing = max(0.0, dot(n, vec2(-0.25, -0.97)));
  col += vec3(0.32, 0.42, 0.5) * rim * (0.08 + 0.42 * facing * facing) * (0.4 + 0.6 * lamp);

  // The plankton's light: sharp where it is, a near halo, and a wide one that
  // reaches the glass and the room.
  float sharp = f.g / u_ref;
  float near = texture(u_near, v_uv).g / u_ref;
  float far = texture(u_far, v_uv).g / u_ref;
  float glow = sharp * 0.35 * water + near * 0.75 + far * 0.55;
  vec3 blue = vec3(0.06, 0.48, 1.0);
  col += blue * (1.0 - exp(-glow * 1.6));
  col += vec3(0.55, 0.85, 1.0) * smoothstep(0.55, 1.6, sharp * water) * 0.35;

  float g = 0.0;
  g += glass(css.x, vec2(-3.0, css.y));
  g += glass(u_view.x - css.x, vec2(u_view.x + 3.0, css.y));
  g += glass(css.y, vec2(css.x, -3.0));
  g += glass(u_view.y - css.y, vec2(css.x, u_view.y + 3.0));
  col += vec3(0.62, 0.72, 0.8) * g * (0.5 + 0.5 * lamp) + blue * g * (near + far) * 0.6;

  o = vec4(col, 1.0);
}`;

const SPECK_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_vel;
layout(location = 2) in vec2 a_lt;
uniform vec2 u_origin;
uniform vec2 u_view;
uniform float u_ahead;
uniform float u_dpr;
uniform float u_time;
uniform float u_spread;
out vec3 v_col;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float tag = a_lt.y * 1000.0;
  float k = float(gl_InstanceID);
  vec2 jitter = vec2(hash(tag * 0.917 + k * 13.1), hash(tag * 0.473 + k * 7.7)) * 2.0 - 1.0;
  vec2 p = a_pos + a_vel * u_ahead + jitter * u_spread - u_origin;
  float light = a_lt.x;
  float twinkle = 0.45 + 0.55 * sin(u_time * (6.0 + 10.0 * hash(tag * 0.31 + k)) + tag);
  float flash = light * light * (0.55 + 0.45 * twinkle) * 2.2;
  float rest = 0.05 + 0.05 * hash(tag * 1.7 + k);
  v_col = vec3(0.42, 0.47, 0.46) * rest + vec3(0.3, 0.72, 1.0) * flash;
  vec2 ndc = p / u_view * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  gl_PointSize = (1.5 + 1.6 * light) * u_dpr;
}`;

const SPECK_FS = `#version 300 es
precision mediump float;
in vec3 v_col;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = max(0.0, 1.0 - dot(q, q));
  o = vec4(v_col * a, 1.0);
}`;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

export interface View {
  /** The viewport's top-left corner on the screen, in CSS px. */
  x: number;
  y: number;
  w: number;
  h: number;
  screenW: number;
  screenH: number;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private splat: WebGLProgram;
  private blur: WebGLProgram;
  private composite: WebGLProgram;
  private speck: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private empty: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private bufferSize = 0;
  private float: boolean;
  private field: Target | null = null;
  private nearA: Target | null = null;
  private nearB: Target | null = null;
  private farA: Target | null = null;
  private farB: Target | null = null;
  private dpr = 1;
  private uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.float = !!gl.getExtension('EXT_color_buffer_float');
    this.splat = this.program(SPLAT_VS, SPLAT_FS);
    this.blur = this.program(QUAD_VS, BLUR_FS);
    this.composite = this.program(QUAD_VS, COMPOSITE_FS);
    this.speck = this.program(SPECK_VS, SPECK_FS);
    this.buffer = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const bytes = STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, bytes, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, bytes, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, bytes, 16);
    gl.bindVertexArray(null);
    this.empty = gl.createVertexArray()!;
  }

  private program(vs: string, fs: string) {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
      return shader;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.uniforms.set(p, new Map());
    return p;
  }

  private u(p: WebGLProgram, name: string) {
    const cache = this.uniforms.get(p)!;
    if (!cache.has(name)) cache.set(name, this.gl.getUniformLocation(p, name));
    return cache.get(name)!;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  private drop(t: Target | null) {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  /** Match the canvas to its box; returns true when the size changed. */
  resize(cssW: number, cssH: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cssW * this.dpr));
    const h = Math.max(1, Math.round(cssH * this.dpr));
    if (this.field && this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    for (const t of [this.field, this.nearA, this.nearB, this.farA, this.farB]) this.drop(t);
    const half = (n: number, k: number) => Math.max(1, Math.ceil(n / k));
    this.field = this.target(half(w, 2), half(h, 2));
    this.nearA = this.target(half(w, 4), half(h, 4));
    this.nearB = this.target(half(w, 4), half(h, 4));
    this.farA = this.target(half(w, 12), half(h, 12));
    this.farB = this.target(half(w, 12), half(h, 12));
    return true;
  }

  draw(data: Float32Array, count: number, ahead: number, view: View, others: Box[], radius: number, time: number) {
    const gl = this.gl;
    const field = this.field!;
    const bytes = count * STRIDE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (bytes > this.bufferSize) {
      this.bufferSize = Math.ceil(bytes * 1.5);
      gl.bufferData(gl.ARRAY_BUFFER, this.bufferSize, gl.DYNAMIC_DRAW);
    }
    if (count > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * STRIDE);

    // Field: water weight in r, light in g. The 8-bit fallback stores a quarter scale.
    const gain = this.float ? 1 : 0.25;
    const splatR = radius * 2.6;
    const scale = (this.dpr * field.w) / this.canvas.width;
    gl.bindFramebuffer(gl.FRAMEBUFFER, field.fbo);
    gl.viewport(0, 0, field.w, field.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.splat);
    gl.uniform2f(this.u(this.splat, 'u_origin'), view.x, view.y);
    gl.uniform2f(this.u(this.splat, 'u_view'), view.w, view.h);
    gl.uniform1f(this.u(this.splat, 'u_ahead'), ahead);
    gl.uniform1f(this.u(this.splat, 'u_size'), 2 * splatR * scale);
    gl.uniform1f(this.u(this.splat, 'u_gain'), gain);
    gl.bindVertexArray(this.vao);
    if (count > 0) gl.drawArrays(gl.POINTS, 0, count);
    gl.disable(gl.BLEND);

    // Two halos: near at a quarter of the canvas, far at a twelfth.
    gl.bindVertexArray(this.empty);
    gl.useProgram(this.blur);
    const pass = (src: Target, dst: Target, dx: number, dy: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(this.u(this.blur, 'u_src'), 0);
      gl.uniform2f(this.u(this.blur, 'u_step'), dx / src.w, dy / src.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    pass(field, this.nearA!, 2, 0);
    pass(this.nearA!, this.nearB!, 0, 1);
    pass(this.nearB!, this.farA!, 2, 0);
    pass(this.farA!, this.farB!, 0, 2);

    // Composite to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const c = this.composite;
    gl.useProgram(c);
    const bind = (unit: number, t: Target, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(this.u(c, name), unit);
    };
    bind(0, field, 'u_field');
    bind(1, this.nearB!, 'u_near');
    bind(2, this.farB!, 'u_far');
    gl.uniform2f(this.u(c, 'u_origin'), view.x, view.y);
    gl.uniform2f(this.u(c, 'u_view'), view.w, view.h);
    gl.uniform2f(this.u(c, 'u_screen'), view.screenW, view.screenH);
    gl.uniform2f(this.u(c, 'u_texel'), 1 / field.w, 1 / field.h);
    // The weight of full water: particle density times the kernel's integral (πR²/3).
    const spacing = 2 * radius;
    const ref = ((Math.PI * splatR * splatR) / 3 / (spacing * spacing * 0.866)) * gain;
    gl.uniform1f(this.u(c, 'u_ref'), ref);
    const flat = new Float32Array(32);
    const n = Math.min(8, others.length);
    for (let i = 0; i < n; i++) flat.set([others[i].x, others[i].y, others[i].w, others[i].h], i * 4);
    gl.uniform4fv(this.u(c, 'u_others'), flat);
    gl.uniform1i(this.u(c, 'u_otherCount'), n);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Specks of plankton, added over the top.
    if (count > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.speck);
      gl.uniform2f(this.u(this.speck, 'u_origin'), view.x, view.y);
      gl.uniform2f(this.u(this.speck, 'u_view'), view.w, view.h);
      gl.uniform1f(this.u(this.speck, 'u_ahead'), ahead);
      gl.uniform1f(this.u(this.speck, 'u_dpr'), this.dpr);
      gl.uniform1f(this.u(this.speck, 'u_time'), time);
      gl.uniform1f(this.u(this.speck, 'u_spread'), radius * 1.4);
      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.POINTS, 0, count, 2);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }
}
