// The tube. Every sample of the signal deposits the same amount of energy somewhere on the
// screen, spread along the line to the next sample with a Gaussian spot, so a slow beam burns
// bright and a fast one barely shows, as on a real scope. The screen holds that energy in a
// float buffer and lets it fade at the phosphor's rate; bloom and a tone curve turn it into
// light. There is no line width, no stroke colour, and no brightness per shape.

export type PhosphorId = 'p31' | 'p3' | 'p11' | 'p7';

interface Phosphor {
  /** Colour of the flash, and of the afterglow. */
  fast: [number, number, number];
  slow: [number, number, number];
  /** How the deposited energy divides between them, and how long each lasts, in seconds. */
  mix: [number, number];
  tau: [number, number];
  /** Interface colours, in CSS. */
  ui: string;
  gain: number;
}

// Linear light. Lifetimes are stretched for a 60 Hz display: real P31 is under a millisecond,
// and a browser can only show what is left at the end of a frame.
export const PHOSPHORS: Record<PhosphorId, Phosphor> = {
  p31: { fast: [0.1, 1, 0.26], slow: [0.1, 0.7, 0.2], mix: [1, 0.015], tau: [0.032, 0.42], ui: '106 255 148', gain: 1 },
  p3: { fast: [1, 0.46, 0.05], slow: [1, 0.36, 0.03], mix: [1, 0.02], tau: [0.046, 0.5], ui: '255 178 76', gain: 1.15 },
  p11: { fast: [0.1, 0.32, 1], slow: [0.12, 0.3, 1], mix: [1, 0], tau: [0.032, 0.3], ui: '126 176 255', gain: 1.45 },
  p7: { fast: [0.22, 0.42, 1], slow: [0.8, 0.82, 0.16], mix: [1, 0.11], tau: [0.05, 1.5], ui: '206 214 112', gain: 1 },
};

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

const SEG_VS = `#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec2 p0;
layout(location=2) in vec2 p1;
uniform vec2 res;
uniform vec3 view;
uniform float sigma;
out vec3 v;
void main() {
  vec2 a = view.xy + p0 * view.z;
  vec2 b = view.xy + p1 * view.z;
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 0.001 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float pad = sigma * 3.4;
  vec2 pos = (corner.x < 0.0 ? a - dir * pad : b + dir * pad) + n * pad * corner.y;
  v = vec3(dot(pos - a, dir), dot(pos - a, n), len);
  gl_Position = vec4(pos / res * 2.0 - 1.0, 0.0, 1.0);
}`;

const SEG_FS = `#version 300 es
precision highp float;
in vec3 v;
uniform float sigma;
uniform vec2 energy;
out vec4 o;
float erf(float x) {
  float s = sign(x);
  float a = abs(x);
  float t = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
  t *= t;
  return s - s / (t * t);
}
void main() {
  float s = sigma;
  float across = exp(-v.y * v.y / (2.0 * s * s));
  float i;
  if (v.z < 0.001) {
    i = across * exp(-v.x * v.x / (2.0 * s * s)) / (6.2831853 * s * s);
  } else {
    float k = 1.0 / (1.4142136 * s);
    i = across * (erf(v.x * k) - erf((v.x - v.z) * k)) / (2.0 * s * 2.5066283 * v.z);
  }
  o = vec4(energy * i, 0.0, 1.0);
}`;

const FULL_VS = `#version 300 es
layout(location=0) in vec2 corner;
out vec2 uv;
void main() {
  uv = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

const DOWN_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D src;
uniform vec2 px;
out vec4 o;
void main() {
  vec4 c = texture(src, uv) * 4.0;
  c += texture(src, uv + px * vec2(-1.0, -1.0));
  c += texture(src, uv + px * vec2(1.0, -1.0));
  c += texture(src, uv + px * vec2(-1.0, 1.0));
  c += texture(src, uv + px * vec2(1.0, 1.0));
  o = c / 8.0;
}`;

const UP_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D src;
uniform vec2 px;
uniform float weight;
out vec4 o;
void main() {
  vec4 c = texture(src, uv + px * vec2(-2.0, 0.0));
  c += texture(src, uv + px * vec2(2.0, 0.0));
  c += texture(src, uv + px * vec2(0.0, -2.0));
  c += texture(src, uv + px * vec2(0.0, 2.0));
  c += texture(src, uv + px * vec2(-1.0, -1.0)) * 2.0;
  c += texture(src, uv + px * vec2(1.0, -1.0)) * 2.0;
  c += texture(src, uv + px * vec2(-1.0, 1.0)) * 2.0;
  c += texture(src, uv + px * vec2(1.0, 1.0)) * 2.0;
  o = c / 12.0 * weight;
}`;

const SHOW_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D screen;
uniform sampler2D glow;
uniform sampler2D scale;
uniform vec3 fastColor;
uniform vec3 slowColor;
uniform vec3 uiColor;
uniform float illum;
uniform float warm;
uniform vec3 view;
uniform vec2 res;
out vec4 o;
float grain(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
void main() {
  vec2 p = gl_FragCoord.xy;
  // The phosphor is a coat of grains, so light is never perfectly even across it.
  float g = grain(floor(p));
  vec2 e = texture(screen, uv).rg * (0.93 + 0.14 * g) + texture(glow, uv).rg * 0.2;
  vec3 light = fastColor * e.r + slowColor * e.g;
  // Glass: not black, and a little lighter where the tube's face is closest.
  vec2 c = (p - view.xy) / max(view.z, 1.0);
  float d = dot(c, c);
  vec3 glass = (uiColor * 0.0007 + vec3(0.0008, 0.001, 0.0011)) * (1.0 / (1.0 + 0.5 * d));
  light += glass * warm;
  // The engraved scale, lit from the edge of the glass.
  vec4 s = texture(scale, vec2(uv.x, 1.0 - uv.y));
  light += uiColor * s.a * illum * 0.052 * (0.55 + 0.45 / (1.0 + 0.8 * d)) * warm;
  vec3 mapped = 1.0 - exp(-light * 1.25);
  vec3 display = pow(mapped, vec3(1.0 / 2.2));
  // Dither, or the long dark falloff of the glow bands on an 8-bit screen.
  display += (grain(p + 17.0) + grain(p + 91.0) - 1.0) / 255.0;
  o = vec4(display, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(program));
  return program;
}

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
}

/** Where the signal's -1 to 1 square sits, in CSS pixels from the canvas's top left. */
export interface View {
  cx: number;
  cy: number;
  r: number;
}

const MAX_POINTS = 1 << 16;
const COVER = 64;

export class Beam {
  private readonly gl: WebGL2RenderingContext;
  private readonly seg: WebGLProgram;
  private readonly down: WebGLProgram;
  private readonly up: WebGLProgram;
  private readonly show: WebGLProgram;
  private readonly fade: WebGLProgram;
  private readonly segVao: WebGLVertexArrayObject;
  private readonly quadVao: WebGLVertexArrayObject;
  private readonly segBuf: WebGLBuffer;
  private readonly internal: number;
  private readonly format: number;
  private screen: Target | null = null;
  private levels: Target[] = [];
  private scaleTex: WebGLTexture;
  private readonly points = new Float32Array(MAX_POINTS * 2);
  private head = 0;
  private pending = 0;
  private lastX = 0;
  private lastY = 0;
  private readonly upload = new Float32Array(MAX_POINTS * 2 + 2);
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  view: View = { cx: 0, cy: 0, r: 100 };
  // Settings.
  phosphor: PhosphorId = 'p31';
  persistence = 1;
  focus = 1;
  intensity = 1;
  illum = 0.5;
  /** Samples per second, for scaling the energy of one sample. */
  sampleRate = 48000;
  // Warm-up: the tube comes on over a second and a half, out of focus.
  private warm = 0;
  // How much of the screen the beam is covering, for auto intensity.
  private readonly stamps = new Uint32Array(COVER * COVER);
  private frameNo = 1;
  private coverage = 40;
  private smoothCover = 40;
  private scaleDirty = true;
  /** Lower if the machine can't keep up. */
  private quality = 1;
  private slowFrames = 0;
  lost = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    const float = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    this.internal = float ? gl.RGBA16F : gl.RGBA8;
    this.format = float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.getExtension('OES_texture_float_linear');

    this.seg = compile(gl, SEG_VS, SEG_FS);
    this.down = compile(gl, FULL_VS, DOWN_FS);
    this.up = compile(gl, FULL_VS, UP_FS);
    this.show = compile(gl, FULL_VS, SHOW_FS);
    this.fade = compile(gl, FULL_VS, `#version 300 es\nprecision highp float;\nout vec4 o;\nvoid main(){o=vec4(0.0);}`);

    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);

    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.segBuf = gl.createBuffer()!;
    this.segVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.segVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.upload.byteLength, gl.DYNAMIC_DRAW);
    // Each sample is both the end of one segment and the start of the next.
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 8, 8);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    this.scaleTex = gl.createTexture()!;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.internal, w, h, 0, gl.RGBA, this.format, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb, w, h };
  }

  private dispose(t: Target): void {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fb);
  }

  /** Match the canvas to its box and place the picture. */
  resize(view: View): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.view = view;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.quality;
    const w = Math.round(this.cssW * dpr);
    const h = Math.round(this.cssH * dpr);
    this.scaleDirty = true;
    if (this.canvas.width === w && this.canvas.height === h && this.screen) return;
    this.dpr = dpr;
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.screen) this.dispose(this.screen);
    for (const level of this.levels) this.dispose(level);
    this.screen = this.target(w, h);
    this.levels = [];
    let lw = w;
    let lh = h;
    for (let i = 0; i < 6; i++) {
      lw = Math.max(2, lw >> 1);
      lh = Math.max(2, lh >> 1);
      this.levels.push(this.target(lw, lh));
    }
  }

  /** Graticule: a real scope's scale is cut into the glass and lit from its edge. */
  private drawScale(): void {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const cx = this.view.cx * this.dpr;
    const cy = this.view.cy * this.dpr;
    const r = this.view.r * this.dpr;
    const div = r / 5;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1, this.dpr * 0.7);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let i = -5; i <= 5; i++) {
      ctx.moveTo(Math.round(cx + i * div), cy - r);
      ctx.lineTo(Math.round(cx + i * div), cy + r);
      ctx.moveTo(cx - r, Math.round(cy + i * div));
      ctx.lineTo(cx + r, Math.round(cy + i * div));
    }
    ctx.stroke();
    // Fifths of a division along the two centre lines, heavier, as on an instrument.
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    for (let i = -25; i <= 25; i++) {
      const t = i % 5 === 0 ? 0 : div * 0.11;
      if (!t) continue;
      const q = i * (div / 5);
      ctx.moveTo(Math.round(cx + q), cy - t);
      ctx.lineTo(Math.round(cx + q), cy + t);
      ctx.moveTo(cx - t, Math.round(cy + q));
      ctx.lineTo(cx + t, Math.round(cy + q));
    }
    ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
    gl.bindTexture(gl.TEXTURE_2D, this.scaleTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.scaleDirty = false;
  }

  /** Queue interleaved x, y samples. */
  push(data: Float32Array): void {
    const count = data.length >> 1;
    for (let i = 0; i < count; i++) {
      const at = (this.head + i) & (MAX_POINTS - 1);
      this.points[at * 2] = data[i * 2];
      this.points[at * 2 + 1] = data[i * 2 + 1];
    }
    this.head = (this.head + count) & (MAX_POINTS - 1);
    this.pending = Math.min(this.pending + count, MAX_POINTS - 1);
  }

  /** Turn the tube off and on again, for after a lost context or a jump. */
  clear(): void {
    const gl = this.gl;
    if (!this.screen) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.screen.fb);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  skipWarmup(): void {
    this.warm = 1;
  }

  frame(dt: number): void {
    const gl = this.gl;
    if (this.lost || !this.screen) return;
    if (this.scaleDirty) this.drawScale();
    const step = Math.min(dt, 0.25);
    this.frameNo++;
    this.warm = Math.min(1, this.warm + step / 1.5);
    const warmth = this.warm * this.warm * (3 - 2 * this.warm);

    // Performance: drop the resolution rather than the frame rate.
    if (dt > 0.03) this.slowFrames++;
    else if (this.slowFrames > 0) this.slowFrames -= 0.25;
    if (this.slowFrames > 60 && this.quality > 0.5) {
      this.quality = Math.max(0.5, this.quality * 0.75);
      this.slowFrames = 0;
      this.resize(this.view);
    }

    const ph = PHOSPHORS[this.phosphor];

    // 1. Fade what is already on the screen.
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.screen.fb);
    gl.viewport(0, 0, this.screen.w, this.screen.h);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ZERO, gl.CONSTANT_COLOR);
    const tauF = ph.tau[0] * this.persistence;
    const tauS = ph.tau[1] * this.persistence;
    gl.blendColor(Math.exp(-step / tauF), Math.exp(-step / tauS), 1, 1);
    gl.useProgram(this.fade);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 2. Lay down this frame's samples.
    const count = this.pending;
    if (count > 0) {
      this.upload[0] = this.lastX;
      this.upload[1] = this.lastY;
      let at = (this.head - count) & (MAX_POINTS - 1);
      const stamp = this.frameNo;
      for (let i = 0; i < count; i++) {
        const x = this.points[at * 2];
        const y = this.points[at * 2 + 1];
        this.upload[i * 2 + 2] = x;
        this.upload[i * 2 + 3] = y;
        const cx = Math.max(0, Math.min(COVER - 1, Math.floor(((x + 1) * COVER) / 2)));
        const cy = Math.max(0, Math.min(COVER - 1, Math.floor(((y + 1) * COVER) / 2)));
        this.stamps[cy * COVER + cx] = stamp;
        at = (at + 1) & (MAX_POINTS - 1);
      }
      this.lastX = this.upload[count * 2];
      this.lastY = this.upload[count * 2 + 1];
      this.pending = 0;

      // Count the cells lit over the last tenth of a second or so.
      let lit = 0;
      const since = stamp - 6;
      for (let i = 0; i < this.stamps.length; i++) if (this.stamps[i] > since) lit++;
      this.coverage = lit;
      this.smoothCover += (lit - this.smoothCover) * Math.min(1, step * 6);

      const px = this.dpr;
      const sigma = (1.05 + (1 - warmth) * 14) * this.focus * px;
      // The same energy per second over more screen is dimmer, as it should be, but let
      // less than all of that through or long drawings fade out altogether.
      const auto = Math.max(0.03, Math.min(9, (this.smoothCover / 90) ** 0.74));
      const base = (11 * px * px * this.intensity * auto * ph.gain * warmth * 48000) / this.sampleRate;
      // Long-lived phosphors collect more passes, so each one has to leave less.
      const live = Math.min(1, (0.05 / tauF) ** 0.75);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.upload, 0, count * 2 + 2);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.seg);
      gl.uniform2f(gl.getUniformLocation(this.seg, 'res'), this.screen.w, this.screen.h);
      gl.uniform3f(
        gl.getUniformLocation(this.seg, 'view'),
        this.view.cx * this.dpr,
        this.screen.h - this.view.cy * this.dpr,
        this.view.r * this.dpr,
      );
      gl.uniform1f(gl.getUniformLocation(this.seg, 'sigma'), sigma);
      gl.uniform2f(gl.getUniformLocation(this.seg, 'energy'), base * ph.mix[0] * live, base * ph.mix[1] * live);
      gl.bindVertexArray(this.segVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }

    // 3. Bloom: light scattered in the glass.
    gl.disable(gl.BLEND);
    gl.useProgram(this.down);
    gl.bindVertexArray(this.quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gl.getUniformLocation(this.down, 'src'), 0);
    let src = this.screen;
    for (const level of this.levels) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, level.fb);
      gl.viewport(0, 0, level.w, level.h);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform2f(gl.getUniformLocation(this.down, 'px'), 1 / src.w, 1 / src.h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      src = level;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.up);
    gl.uniform1i(gl.getUniformLocation(this.up, 'src'), 0);
    for (let i = this.levels.length - 1; i > 0; i--) {
      const from = this.levels[i];
      const to = this.levels[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
      gl.viewport(0, 0, to.w, to.h);
      gl.bindTexture(gl.TEXTURE_2D, from.tex);
      gl.uniform2f(gl.getUniformLocation(this.up, 'px'), 0.5 / from.w, 0.5 / from.h);
      gl.uniform1f(gl.getUniformLocation(this.up, 'weight'), 0.7);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // 4. Put it on the glass.
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.show);
    gl.uniform1i(gl.getUniformLocation(this.show, 'screen'), 0);
    gl.uniform1i(gl.getUniformLocation(this.show, 'glow'), 1);
    gl.uniform1i(gl.getUniformLocation(this.show, 'scale'), 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.screen.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.levels[0].tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.scaleTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform3fv(gl.getUniformLocation(this.show, 'fastColor'), ph.fast);
    gl.uniform3fv(gl.getUniformLocation(this.show, 'slowColor'), ph.slow);
    const ui = ph.ui.split(' ').map((v) => (Number(v) / 255) ** 2.2);
    gl.uniform3f(gl.getUniformLocation(this.show, 'uiColor'), ui[0], ui[1], ui[2]);
    gl.uniform1f(gl.getUniformLocation(this.show, 'illum'), this.illum);
    gl.uniform1f(gl.getUniformLocation(this.show, 'warm'), warmth);
    gl.uniform3f(
      gl.getUniformLocation(this.show, 'view'),
      this.view.cx * this.dpr,
      this.canvas.height - this.view.cy * this.dpr,
      this.view.r * this.dpr,
    );
    gl.uniform2f(gl.getUniformLocation(this.show, 'res'), this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
