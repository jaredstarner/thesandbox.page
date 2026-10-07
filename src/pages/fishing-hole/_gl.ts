// Two WebGL2 passes. The scene pass runs once per lake pixel at low
// resolution: it paints the sky, hills, clouds, water, and bed, and lays the
// CPU-drawn sprites over them. Below the water line it bends the sprites a
// pixel either way, fades them toward the water's color with depth, and adds
// light shafts and caustics. The present pass scales that up with hard edges,
// offset by the camera's fraction of a pixel so panning stays smooth, and adds
// a soft glow around anything on the light layer.

import type { Color, Sky } from './_daylight';

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const SCENE = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uSprite;
uniform sampler2D uEmit;
uniform sampler2D uCols;
uniform ivec2 uSize;
uniform ivec2 uCam;
uniform float uTime;
uniform float uSkyH;
uniform vec3 uSkyTop, uSkyHorizon, uHillFar, uHillNear, uCloud, uWaterTop, uWaterDeep, uLight;
uniform float uStars, uRays, uCaustics;
uniform vec4 uSun;
uniform vec4 uMoon;
out vec4 outColor;

const int BAYER[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
float bayer(ivec2 p) { return (float(BAYER[(p.y & 3) * 4 + (p.x & 3)]) + 0.5) / 16.0; }
// Quantize t into n steps, dithered, so gradients read as pixel-art bands.
float dq(float t, float n, ivec2 p) { return clamp(floor(t * n + bayer(p)) / n, 0.0, 1.0); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(hash(vec2(i, 0.0)), hash(vec2(i + 1.0, 0.0)), f * f * (3.0 - 2.0 * f));
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float caustic(vec2 w) {
  float a = sin(w.x * 0.55 + uTime * 1.3 + sin(w.y * 0.4 + uTime * 0.9) * 1.8);
  float b = sin(w.x * 0.31 - uTime * 1.1 + cos(w.y * 0.5 - uTime * 0.7) * 2.2);
  return smoothstep(0.55, 1.0, abs(a + b) * 0.5);
}

void main() {
  ivec2 b = ivec2(int(gl_FragCoord.x), uSize.y - 1 - int(gl_FragCoord.y));
  vec2 w = vec2(b + uCam);
  vec2 cols = texelFetch(uCols, ivec2(b.x, 0), 0).rg;
  float surf = floor(cols.r + 0.5);
  float bed = floor(cols.g + 0.5);
  bool ground = w.y >= bed;
  bool under = !ground && w.y >= surf;
  bool wetGround = ground && bed > 0.5;
  float depth01 = clamp(w.y / 92.0, 0.0, 1.0);

  vec3 water = mix(uWaterTop, uWaterDeep, dq(depth01, 6.0, b));
  vec3 col;

  if (ground) {
    float d = w.y - bed;
    float band = floor((d + noise(w.x * 0.3) * 2.2) / 4.0);
    vec3 sandA = vec3(0.86, 0.63, 0.38);
    vec3 sandB = vec3(0.71, 0.48, 0.27);
    vec3 sandC = vec3(0.55, 0.36, 0.2);
    vec3 dark = vec3(0.15, 0.17, 0.25);
    col = band < 1.0 ? sandA : band < 2.0 ? sandB : band < 3.0 ? sandC : band < 4.0 ? mix(sandC, dark, 0.55) : dark;
    if (!wetGround) {
      if (d < 1.0) col = vec3(0.45, 0.66, 0.31);
      else if (d < 2.0) col = vec3(0.31, 0.5, 0.25);
    }
    col *= uLight;
    if (wetGround) {
      col = mix(col, water, 0.08 + 0.2 * depth01);
      if (d < 2.0) col += vec3(0.9, 0.95, 1.0) * dq(caustic(w) * uCaustics * (1.0 - 0.6 * depth01) * 0.35, 3.0, b);
    }
  } else if (under) {
    float ray = smoothstep(0.6, 0.92, noise(w.x * 0.08 + w.y * 0.05 + uTime * 0.04)) * (1.0 - depth01) * uRays;
    water = mix(water, uWaterTop * 1.18 + 0.06, dq(ray * 0.5, 3.0, b));
    if (w.y - surf < 1.0) water = mix(uWaterTop, vec3(1.0), 0.42);
    col = water;
  } else {
    // Sky, with the gradient banded and dithered.
    float h = clamp(-w.y / uSkyH, 0.0, 1.0);
    col = mix(uSkyHorizon, uSkyTop, dq(pow(h, 0.75), 9.0, b));

    if (uStars > 0.01 && w.y < -14.0) {
      float s = hash(vec2(float(b.x) + floor(float(uCam.x) * 0.05), float(b.y)));
      if (s > 0.986) {
        float tw = 0.55 + 0.45 * sin(uTime * (1.0 + s * 3.0) + s * 90.0);
        col = mix(col, vec3(1.0, 0.98, 0.9), uStars * tw * smoothstep(0.0, 0.35, h));
      }
    }
    if (uSun.w > 0.0) {
      float d = length(vec2(b) - uSun.xy);
      if (d < uSun.z) col = mix(vec3(1.0, 0.97, 0.82), vec3(1.0, 0.82, 0.5), uSun.w);
      else col = mix(col, vec3(1.0, 0.94, 0.76), dq(clamp(1.0 - (d - uSun.z) / 22.0, 0.0, 1.0) * 0.4, 4.0, b));
    }
    if (uMoon.w > 0.0) {
      vec2 d = vec2(b) - uMoon.xy;
      float r = 5.0;
      float len = length(d + 0.5);
      if (len < r) {
        vec2 n = (d + 0.5) / r;
        float edge = sqrt(max(0.0, 1.0 - n.y * n.y));
        float c = cos(6.2831853 * uMoon.z) * edge;
        bool lit = uMoon.z < 0.5 ? n.x > c : n.x < -c;
        col = lit ? vec3(0.96, 0.94, 0.84) : mix(col, vec3(0.2, 0.24, 0.38), 0.6);
      } else {
        float full = 1.0 - abs(uMoon.z - 0.5) * 2.0;
        col = mix(col, vec3(0.8, 0.85, 1.0), dq(clamp(1.0 - (len - r) / 16.0, 0.0, 1.0) * 0.18 * full, 4.0, b));
      }
    }

    // Clouds drift slowly, chunky and two-toned.
    if (w.y < -14.0) {
      float cx = (float(b.x) + float(uCam.x) * 0.12 + uTime * 0.9) * 0.035;
      float c = noise2(vec2(cx, w.y * 0.11)) * 0.65 + noise2(vec2(cx * 2.3, w.y * 0.23)) * 0.35;
      float env = smoothstep(-16.0, -26.0, w.y) * smoothstep(-95.0, -55.0, w.y);
      c *= env;
      if (c > 0.6) col = c > 0.64 ? uCloud : mix(uCloud, col, 0.45);
    }

    // Two ranges of hills behind the lake, at different parallax.
    float far = -7.0 - noise((float(b.x) + float(uCam.x) * 0.25) * 0.03) * 15.0 - noise((float(b.x) + float(uCam.x) * 0.25) * 0.11) * 3.0;
    if (w.y > far) col = uHillFar;
    float nearX = float(b.x) + float(uCam.x) * 0.5;
    float near = -2.0 - noise(nearX * 0.045 + 7.0) * 8.0 - noise(nearX * 0.17) * 2.0;
    if (w.y > near) col = uHillNear;
  }

  // Sprites: bent a pixel either way under the water, and fading with depth.
  ivec2 sb = b;
  if (under) {
    int wob = int(floor(sin(w.y * 0.33 + uTime * 1.4 + w.x * 0.05) * 0.8 + 0.5));
    sb.x = clamp(b.x + wob, 0, uSize.x - 1);
  }
  vec4 s = texelFetch(uSprite, sb, 0);
  if (s.a > 0.0) {
    vec3 sc = s.rgb * uLight;
    if (under || wetGround) sc = mix(sc, water, 0.1 + 0.4 * depth01);
    col = mix(col, sc, s.a);
  }

  col += texelFetch(uEmit, b, 0).rgb;
  outColor = vec4(col, 1.0);
}`;

const PRESENT = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uScene;
uniform sampler2D uEmit;
uniform vec2 uCanvas;
uniform vec2 uLow;
uniform float uScale;
uniform vec2 uFrac;
uniform float uGlow;
out vec4 outColor;

void main() {
  vec2 sp = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 lp = sp / uScale + uFrac;
  ivec2 li = clamp(ivec2(floor(lp)), ivec2(0), ivec2(uLow) - 1);
  vec3 c = texelFetch(uScene, ivec2(li.x, int(uLow.y) - 1 - li.y), 0).rgb;
  if (uGlow > 0.0) {
    vec3 g = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982;
      vec2 d = vec2(cos(a), sin(a));
      g += texture(uEmit, (lp + d * 1.4) / uLow).rgb * 0.11;
      g += texture(uEmit, (lp + d * 3.2) / uLow).rgb * 0.05;
      g += texture(uEmit, (lp + d * 6.0) / uLow).rgb * 0.022;
    }
    c += g * uGlow;
  }
  outColor = vec4(c, 1.0);
}`;

export interface Frame {
  sprite: Uint32Array;
  emit: Uint32Array;
  /** Two floats per column: surface y and bed y, in world pixels. */
  cols: Float32Array;
  /** World coordinates of the buffer's top-left pixel. */
  camX: number;
  camY: number;
  fracX: number;
  fracY: number;
  /** Device pixels per lake pixel. */
  scale: number;
  sky: Sky;
  time: number;
  /** Pixels from the water line to the top of the sky gradient. */
  skyH: number;
  sun: [number, number, number, number];
  moon: [number, number, number, number];
  glow: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed');
  return shader;
}

function program(gl: WebGL2RenderingContext, fragment: string, names: string[]): { prog: WebGLProgram; u: Uniforms } {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
  const u: Uniforms = {};
  for (const n of names) u[n] = gl.getUniformLocation(prog, n);
  return { prog, u };
}

export class Renderer {
  private readonly scene: { prog: WebGLProgram; u: Uniforms };
  private readonly present: { prog: WebGLProgram; u: Uniforms };
  private readonly vao: WebGLVertexArrayObject;
  private spriteTex: WebGLTexture | null = null;
  private emitTex: WebGLTexture | null = null;
  private colsTex: WebGLTexture | null = null;
  private sceneTex: WebGLTexture | null = null;
  private fbo: WebGLFramebuffer | null = null;
  private bw = 0;
  private bh = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.scene = program(gl, SCENE, [
      'uSprite',
      'uEmit',
      'uCols',
      'uSize',
      'uCam',
      'uTime',
      'uSkyH',
      'uSkyTop',
      'uSkyHorizon',
      'uHillFar',
      'uHillNear',
      'uCloud',
      'uWaterTop',
      'uWaterDeep',
      'uLight',
      'uStars',
      'uRays',
      'uCaustics',
      'uSun',
      'uMoon',
    ]);
    this.present = program(gl, PRESENT, ['uScene', 'uEmit', 'uCanvas', 'uLow', 'uScale', 'uFrac', 'uGlow']);
    this.vao = gl.createVertexArray()!;
  }

  private texture(filter: number, internal: number, format: number, type: number, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    return tex;
  }

  /** Size the low-resolution buffers, in lake pixels. */
  resize(bw: number, bh: number): void {
    if (bw === this.bw && bh === this.bh) return;
    const gl = this.gl;
    for (const t of [this.spriteTex, this.emitTex, this.colsTex, this.sceneTex]) if (t) gl.deleteTexture(t);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    this.bw = bw;
    this.bh = bh;
    this.spriteTex = this.texture(gl.NEAREST, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bw, bh);
    this.emitTex = this.texture(gl.LINEAR, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bw, bh);
    this.colsTex = this.texture(gl.NEAREST, gl.RG32F, gl.RG, gl.FLOAT, bw, 1);
    this.sceneTex = this.texture(gl.NEAREST, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bw, bh);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  draw(f: Frame): void {
    const gl = this.gl;
    const { bw, bh } = this;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.bindTexture(gl.TEXTURE_2D, this.spriteTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(f.sprite.buffer));
    gl.bindTexture(gl.TEXTURE_2D, this.emitTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(f.emit.buffer));
    gl.bindTexture(gl.TEXTURE_2D, this.colsTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, bw, 1, gl.RG, gl.FLOAT, f.cols);

    gl.bindVertexArray(this.vao);

    // Scene pass, into the low-resolution buffer.
    const s = this.scene;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, bw, bh);
    gl.useProgram(s.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.spriteTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.emitTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.colsTex);
    gl.uniform1i(s.u.uSprite, 0);
    gl.uniform1i(s.u.uEmit, 1);
    gl.uniform1i(s.u.uCols, 2);
    gl.uniform2i(s.u.uSize, bw, bh);
    gl.uniform2i(s.u.uCam, f.camX, f.camY);
    gl.uniform1f(s.u.uTime, f.time);
    gl.uniform1f(s.u.uSkyH, f.skyH);
    const c3 = (name: string, c: Color) => gl.uniform3f(s.u[name], c[0], c[1], c[2]);
    c3('uSkyTop', f.sky.skyTop);
    c3('uSkyHorizon', f.sky.skyHorizon);
    c3('uHillFar', f.sky.hillFar);
    c3('uHillNear', f.sky.hillNear);
    c3('uCloud', f.sky.cloud);
    c3('uWaterTop', f.sky.waterTop);
    c3('uWaterDeep', f.sky.waterDeep);
    c3('uLight', f.sky.light);
    gl.uniform1f(s.u.uStars, f.sky.stars);
    gl.uniform1f(s.u.uRays, f.sky.rays);
    gl.uniform1f(s.u.uCaustics, f.sky.caustics);
    gl.uniform4f(s.u.uSun, ...f.sun);
    gl.uniform4f(s.u.uMoon, ...f.moon);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Present pass, to the canvas.
    const p = this.present;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.emitTex);
    gl.uniform1i(p.u.uScene, 0);
    gl.uniform1i(p.u.uEmit, 1);
    gl.uniform2f(p.u.uCanvas, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform2f(p.u.uLow, bw, bh);
    gl.uniform1f(p.u.uScale, f.scale);
    gl.uniform2f(p.u.uFrac, f.fracX, f.fracY);
    gl.uniform1f(p.u.uGlow, f.glow);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
