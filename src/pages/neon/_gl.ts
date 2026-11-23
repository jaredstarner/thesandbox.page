// The renderer. Tubes are drawn once per layout into masks, one channel per kind of glass; each
// frame those masks are coloured into an emission image (or spread line by line, for the
// grating), blurred into glow and light, and laid over the lit, wet street.

import type { Plan } from './_plan';
import type { View } from './_facade';
import { WINDOW } from './_facade';

export const TYPES = 12;
const LINE_SLOTS = 96;
/** Tube and electrode housing radii, in cm. */
const TUBE_R = 0.62;
const HOUSING_R = 1.35;

const FULL_VS = `#version 300 es
in vec2 a;
out vec2 uv;
void main() {
  uv = a * 0.5 + 0.5;
  gl_Position = vec4(a, 0.0, 1.0);
}`;

const TUBE_VS = `#version 300 es
in vec2 corner;
in vec4 iAB;
in vec4 iInfo;
uniform vec3 uView;
uniform vec2 uSize;
uniform vec2 uRadius;
out vec2 vPx;
out vec2 vA;
out vec2 vB;
out vec4 vInfo;
out float vR;
void main() {
  vec2 A = vec2(uView.y + iAB.x * uView.x, uView.z - iAB.y * uView.x);
  vec2 B = vec2(uView.y + iAB.z * uView.x, uView.z - iAB.w * uView.x);
  float kind = mod(iInfo.w, 4.0);
  float r = (kind > 1.5 ? uRadius.y : uRadius.x) * uView.x;
  float rr = max(r, 1.0) + 1.5;
  vec2 d = B - A;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  vec2 p = mix(A - dir * rr, B + dir * rr, corner.x) + n * mix(-rr, rr, corner.y);
  vPx = p;
  vA = A;
  vB = B;
  vInfo = iInfo;
  vR = r;
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
}`;

const TUBE_FS = `#version 300 es
precision highp float;
in vec2 vPx;
in vec2 vA;
in vec2 vB;
in vec4 vInfo;
in float vR;
uniform vec3 uHalf;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
void main() {
  vec2 pa = vPx - vA;
  vec2 ba = vB - vA;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  vec2 q = pa - ba * h;
  float dist = length(q);
  float rUse = max(vR, 1.0);
  float cov = clamp(rUse + 0.5 - dist, 0.0, 1.0);
  if (cov <= 0.0) discard;
  float v = clamp(dist / rUse, 0.0, 1.0);
  float depth = sqrt(max(1.0 - v * v, 0.0));
  float prof = (0.35 + 0.65 * depth) * cov * (vR / rUse);
  vec2 nn = dist > 1e-4 ? q / dist : vec2(0.0);
  vec3 N = vec3(nn.x * v, -nn.y * v, depth);
  float spec = pow(max(dot(N, uHalf), 0.0), 50.0) * cov;
  float s = mix(vInfo.x, vInfo.y, h);
  float fromEnd = min(s, vInfo.z - s);
  float kind = mod(vInfo.w, 4.0);
  int type = int(floor(vInfo.w / 4.0 + 0.01));
  o0 = vec4(0.0);
  o1 = vec4(0.0);
  o2 = vec4(0.0);
  o3 = vec4(0.0);
  if (kind < 0.5) {
    float e = prof * smoothstep(0.3, 3.0, fromEnd);
    int c = type - (type / 4) * 4;
    vec4 ch = vec4(c == 0 ? e : 0.0, c == 1 ? e : 0.0, c == 2 ? e : 0.0, c == 3 ? e : 0.0);
    if (type < 4) o0 = ch;
    else if (type < 8) o1 = ch;
    else o2 = ch;
    o3 = vec4(cov, 0.0, spec, 0.0);
  } else if (kind < 1.5) {
    o3 = vec4(0.0, cov, spec * 0.6, 0.0);
  } else {
    o3 = vec4(0.0, 0.0, spec * 0.3, cov);
  }
}`;

const MASK_SAMPLE = `
uniform sampler2D uM0;
uniform sampler2D uM1;
uniform sampler2D uM2;
float maskAt(int t, vec2 p) {
  vec4 m = t < 4 ? texture(uM0, p) : (t < 8 ? texture(uM1, p) : texture(uM2, p));
  int c = t - (t / 4) * 4;
  return c == 0 ? m.x : (c == 1 ? m.y : (c == 2 ? m.z : m.w));
}
vec3 colourAt(vec2 p) {
  vec4 a = texture(uM0, p);
  vec4 b = texture(uM1, p);
  vec4 c = texture(uM2, p);
  return a.x * uCol[0] + a.y * uCol[1] + a.z * uCol[2] + a.w * uCol[3]
       + b.x * uCol[4] + b.y * uCol[5] + b.z * uCol[6] + b.w * uCol[7]
       + c.x * uCol[8] + c.y * uCol[9] + c.z * uCol[10] + c.w * uCol[11];
}`;

const EMIT_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform vec3 uCol[${TYPES}];
uniform float uWrite;
${MASK_SAMPLE}
out vec4 o;
void main() {
  o = vec4(colourAt(uv) * uWrite, 1.0);
}`;

// Through a grating every emission line makes its own copy of the sign, shifted sideways in
// proportion to its wavelength, in both first orders; a little light goes straight through.
const DISPERSE_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform vec3 uCol[${TYPES}];
uniform float uWrite;
uniform sampler2D uLines;
uniform int uTypes[${TYPES}];
uniform int uTypeCount;
uniform int uLineCount[${TYPES}];
uniform vec3 uGroup[${TYPES}];
uniform float uK;
${MASK_SAMPLE}
out vec4 o;
void main() {
  vec3 e = colourAt(uv) * 0.45;
  for (int i = 0; i < ${TYPES}; i++) {
    if (i >= uTypeCount) break;
    int t = uTypes[i];
    vec3 g = uGroup[t];
    int n = uLineCount[t];
    for (int j = 0; j < ${LINE_SLOTS}; j++) {
      if (j >= n) break;
      vec4 L = texelFetch(uLines, ivec2(j, t), 0);
      float grp = floor(L.w / 1000.0);
      float nm = L.w - grp * 1000.0;
      float s = grp < 0.5 ? g.x : (grp < 1.5 ? g.y : g.z);
      if (s <= 0.0) continue;
      vec2 off = vec2(uK * nm, 0.0);
      e += L.rgb * s * 0.3 * (maskAt(t, uv - off) + maskAt(t, uv + off));
    }
  }
  o = vec4(e * uWrite, 1.0);
}`;

const DOWN_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec3 c = texture(uSrc, uv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uSrc, uv + uTexel * vec2(1.0, -1.0)).rgb
         + texture(uSrc, uv + uTexel * vec2(-1.0, 1.0)).rgb
         + texture(uSrc, uv + uTexel * vec2(1.0, 1.0)).rgb;
  o = vec4(c * 0.25, 1.0);
}`;

const UP_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D uLow;
uniform sampler2D uHere;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec3 c = texture(uLow, uv).rgb * 4.0;
  c += (texture(uLow, uv + vec2(uTexel.x, 0.0)).rgb + texture(uLow, uv - vec2(uTexel.x, 0.0)).rgb
      + texture(uLow, uv + vec2(0.0, uTexel.y)).rgb + texture(uLow, uv - vec2(0.0, uTexel.y)).rgb) * 2.0;
  c += texture(uLow, uv + uTexel).rgb + texture(uLow, uv - uTexel).rgb
     + texture(uLow, uv + vec2(uTexel.x, -uTexel.y)).rgb + texture(uLow, uv + vec2(-uTexel.x, uTexel.y)).rgb;
  o = vec4(c / 16.0 + texture(uHere, uv).rgb, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D uAlbedo;
uniform sampler2D uFittings;
uniform sampler2D uBody;
uniform sampler2D uE;
uniform sampler2D uBloom;
uniform sampler2D uLight;
uniform sampler2D uStreak;
uniform vec3 uCol[${TYPES}];
uniform vec4 uBodyCol[${TYPES}];
uniform vec3 uView;
uniform vec2 uSize;
uniform float uTime;
uniform float uRead;
uniform float uGrating;
uniform float uRain;
uniform float uExposure;
${MASK_SAMPLE}
out vec4 o;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
}

vec2 toWorld(vec2 px) { return vec2((px.x - uView.y) / uView.x, (uView.z - px.y) / uView.x); }
vec2 toUv(vec2 px) { return vec2(px.x / uSize.x, 1.0 - px.y / uSize.y); }

float rainLayer(vec2 px, float cw, float len, float speed, float seed) {
  float s = uView.x;
  px.x += px.y * 0.07;
  float col = floor(px.x / cw);
  float h = hash(col * 1.37 + seed);
  float xIn = px.x - col * cw - (0.2 + 0.6 * h) * cw;
  float y = px.y / len - uTime * speed * (0.8 + 0.4 * h) + h * 13.0;
  float cell = floor(y);
  float h2 = hash(col * 17.13 + cell * 3.7 + seed);
  float yIn = fract(y);
  float on = step(0.62, h2);
  float w = max(0.55, s * 0.12);
  return on * smoothstep(w, 0.0, abs(xIn)) * smoothstep(0.0, 0.25, yIn) * smoothstep(0.75, 0.35, yIn);
}

void main() {
  vec2 px = vec2(uv.x, 1.0 - uv.y) * uSize;
  vec2 wp = toWorld(px);
  float s = uView.x;
  vec4 alb = texture(uAlbedo, uv);
  float cls = alb.a * 255.0;
  vec3 light = texture(uLight, uv).rgb * uRead;

  // A street lamp off to the left, and the night.
  vec2 lampPos = vec2(-430.0, 470.0);
  float dl = distance(wp, lampPos);
  vec3 lamp = vec3(1.0, 0.86, 0.68) * 0.17 / (1.0 + pow(dl / 300.0, 2.0));
  vec3 amb = vec3(0.012, 0.016, 0.028);

  vec3 col;
  bool inWindow = wp.x > ${WINDOW.x0.toFixed(1)} && wp.x < ${WINDOW.x1.toFixed(1)} && wp.y > ${WINDOW.y0.toFixed(1)} && wp.y < ${WINDOW.y1.toFixed(1)};
  if (cls > 228.0) {
    col = alb.rgb * (amb + lamp + light * 0.6);
  } else if (cls > 164.0) {
    col = alb.rgb * (amb + lamp + light * 1.5);
  } else if (cls > 112.0) {
    col = alb.rgb * (amb * 0.4 + lamp * 0.05 + light * 7.0);
  } else if (cls > 80.0) {
    col = alb.rgb * (amb + light * 0.8);
    col += vec3(0.6, 0.7, 1.0) * 0.004 * (0.6 + 0.4 * noise(px / (40.0 * s)));
  } else {
    // The pavement: diffuse light, then a wet reflection of everything above it.
    float depth = 600.0 - 600.0 / (1.0 - min(wp.y, -0.01) / 160.0);
    vec2 basePx = vec2(px.x, uView.z - ${WINDOW.y0.toFixed(1)} * s);
    vec3 fromSign = texture(uLight, toUv(basePx)).rgb * uRead;
    vec3 diffuse = amb + lamp * 0.8 + fromSign * 3.5 / (1.0 + pow(depth / 120.0, 2.0));
    col = alb.rgb * diffuse;

    vec2 g = vec2(wp.x, depth);
    float puddle = smoothstep(0.52, 0.7, noise(g / 95.0) * 0.7 + noise(g / 31.0) * 0.3);
    // Rain rings in the puddles push the reflection about.
    vec2 cellG = floor(g / 18.0);
    vec2 off = vec2(0.0);
    for (int k = 0; k < 4; k++) {
      vec2 cg = cellG + vec2(float(k - (k / 2) * 2), float(k / 2));
      float hh = hash2(cg);
      float ph = fract(uTime * (0.55 + 0.4 * hh) + hh * 7.0);
      vec2 ctr = (cg + vec2(hash2(cg + 3.1), hash2(cg + 7.7))) * 18.0;
      vec2 dv = g - ctr;
      float r = length(dv * vec2(1.0, 2.6));
      float ring = sin((r - ph * 9.0) * 1.6) * exp(-pow((r - ph * 9.0) / 2.2, 2.0)) * (1.0 - ph);
      off += normalize(dv + 1e-4) * ring;
    }
    vec2 mirror = vec2(px.x, 2.0 * uView.z - px.y);
    mirror += off * s * 1.4 * puddle * uRain;
    float far = clamp((px.y - uView.z) / (uSize.y * 0.5), 0.0, 1.0);
    float fres = mix(0.55, 0.16, far);
    // Wet paving is rough: each light's reflection is drawn out into a long streak that reaches back
    // towards the wall, so the sign shows in the pavement even where its mirror image falls past
    // the bottom of the view.
    vec3 refl = vec3(0.0);
    float wsum2 = 0.0;
    float reach = 60.0 * s + (px.y - uView.z) * 2.5;
    float jitter = hash2(floor(px));
    for (int k = 0; k < 18; k++) {
      float fk = (float(k) + jitter) / 18.0;
      float w = exp(-fk * 2.4);
      refl += texture(uStreak, toUv(mirror - vec2(0.0, fk * fk * reach))).rgb * w;
      wsum2 += w;
    }
    refl /= wsum2;
    vec3 sharp = texture(uE, toUv(mirror)).rgb + texture(uBloom, toUv(mirror)).rgb * 0.5;
    vec3 glow = texture(uLight, toUv(mirror)).rgb;
    vec3 r2 = mix(refl * 1.3, sharp, puddle * 0.75) + glow * 0.5;
    col = mix(col, col * 0.4, puddle);
    col += r2 * uRead * fres * (0.55 + 0.45 * puddle);
  }

  // What hangs in the window: chains, frame, transformer.
  if (inWindow) {
    vec4 fit = texture(uFittings, uv);
    col = col * (1.0 - fit.a) + fit.rgb * (amb * 0.4 + light * 6.0);
    // The street reflected faintly in the plate glass.
    float sheen = 0.5 + 0.5 * sin(wp.x * 0.012 + wp.y * 0.02);
    col += vec3(0.55, 0.65, 0.9) * 0.0035 * sheen;
  }

  // The tubes themselves, lit or not.
  vec4 m0 = texture(uM0, uv);
  vec4 m1 = texture(uM1, uv);
  vec4 m2 = texture(uM2, uv);
  vec4 body = texture(uBody, uv);
  float wsum = dot(m0, vec4(1.0)) + dot(m1, vec4(1.0)) + dot(m2, vec4(1.0));
  vec4 tint = m0.x * uBodyCol[0] + m0.y * uBodyCol[1] + m0.z * uBodyCol[2] + m0.w * uBodyCol[3]
            + m1.x * uBodyCol[4] + m1.y * uBodyCol[5] + m1.z * uBodyCol[6] + m1.w * uBodyCol[7]
            + m2.x * uBodyCol[8] + m2.y * uBodyCol[9] + m2.z * uBodyCol[10] + m2.w * uBodyCol[11];
  tint /= max(wsum, 1e-4);
  vec3 tubeLight = amb + lamp * 0.6 + light * 4.0;
  col = mix(col, vec3(0.004), body.a * 0.95);
  col = mix(col, tint.rgb * tubeLight, body.r * tint.a);
  col = mix(col, vec3(0.003), body.g * 0.96);
  col += body.b * (lamp * 1.4 + light * 1.2 + amb * 3.0);

  // Through the grating, the scene behind loses most of its light to the spectra.
  if (uGrating > 0.5) col *= 0.3;

  // The light itself.
  col += texture(uE, uv).rgb * uRead;
  col += texture(uBloom, uv).rgb * uRead * 0.085;

  // Rain, lit by whatever is near it.
  if (uRain > 0.0) {
    float r = rainLayer(px, 7.0 * s, 26.0 * s, 1.15, 1.0) * 0.6
            + rainLayer(px + 31.0, 4.4 * s, 17.0 * s, 0.85, 2.0) * 0.4
            + rainLayer(px + 77.0, 2.8 * s, 11.0 * s, 0.6, 3.0) * 0.25;
    col += r * uRain * (light * 1.6 + lamp * 2.2 + amb * 2.5);
  }

  col = 1.0 - exp(-col * uExposure);
  col = pow(col, vec3(1.0 / 2.2));
  col += (hash2(px + fract(uTime) * 61.0) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

type GL = WebGL2RenderingContext;

function compile(gl: GL, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('no shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    console.error(log, src);
    throw new Error(`shader: ${log}`);
  }
  return sh;
}

interface Program {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

function program(gl: GL, vs: string, fs: string, attribs: string[]): Program {
  const p = gl.createProgram();
  if (!p) throw new Error('no program');
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
  const u: Program['u'] = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
}

export interface FrameState {
  time: number;
  /** Linear colour of each glass type, brightness included. */
  colours: Float32Array;
  /** Per type: steady, argon, mercury scales for the grating's lines. */
  groups: Float32Array;
  grating: boolean;
  rain: number;
}

export class Renderer {
  readonly gl: GL;
  private hdr: boolean;
  private quad: WebGLBuffer;
  private corner: WebGLBuffer;
  private inst: WebGLBuffer;
  private instCount = 0;
  private tubeVao: WebGLVertexArrayObject;
  private fullVao: WebGLVertexArrayObject;
  private tube: Program;
  private emit: Program;
  private disperse: Program;
  private down: Program;
  private up: Program;
  private comp: Program;
  private albedo: WebGLTexture;
  private fittings: WebGLTexture;
  private lines: WebGLTexture;
  private masks: WebGLTexture[] = [];
  private maskFb: WebGLFramebuffer | null = null;
  private e: Target | null = null;
  private downs: Target[] = [];
  private ups: Target[] = [];
  private view: View | null = null;
  private w = 0;
  private h = 0;
  private bodyCol = new Float32Array(TYPES * 4);
  private lineCount = new Int32Array(TYPES);
  private present: number[] = [];
  /** How far, in cm on the window, each nanometre of wavelength moves a line's copy of the sign. */
  gratingK = 0.16;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    const make = <T>(v: T | null): T => {
      if (!v) throw new Error('gl object');
      return v;
    };
    this.quad = make(gl.createBuffer());
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.fullVao = make(gl.createVertexArray());
    gl.bindVertexArray(this.fullVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.corner = make(gl.createBuffer());
    this.inst = make(gl.createBuffer());
    this.tubeVao = make(gl.createVertexArray());
    gl.bindVertexArray(this.tubeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    this.tube = program(gl, TUBE_VS, TUBE_FS, ['corner', 'iAB', 'iInfo']);
    this.emit = program(gl, FULL_VS, EMIT_FS, ['a']);
    this.disperse = program(gl, FULL_VS, DISPERSE_FS, ['a']);
    this.down = program(gl, FULL_VS, DOWN_FS, ['a']);
    this.up = program(gl, FULL_VS, UP_FS, ['a']);
    this.comp = program(gl, FULL_VS, COMPOSITE_FS, ['a']);

    this.albedo = this.texture();
    this.fittings = this.texture();
    this.lines = this.texture(gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, this.lines);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, LINE_SLOTS, TYPES, 0, gl.RGBA, gl.FLOAT, null);
  }

  private texture(filter: number = this.gl.LINEAR): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture();
    if (!t) throw new Error('texture');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(w: number, h: number, old?: Target): Target {
    const gl = this.gl;
    if (old) {
      gl.deleteTexture(old.tex);
      gl.deleteFramebuffer(old.fb);
    }
    const tex = this.texture();
    if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    if (!fb) throw new Error('framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }

  /** Size every buffer to the canvas. */
  resize(w: number, h: number) {
    const gl = this.gl;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    for (const t of this.masks) gl.deleteTexture(t);
    if (this.maskFb) gl.deleteFramebuffer(this.maskFb);
    this.masks = [0, 1, 2, 3].map(() => {
      const t = this.texture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return t;
    });
    this.maskFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFb);
    this.masks.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
    this.e = this.target(w, h, this.e ?? undefined);
    let cw = w;
    let ch = h;
    for (let i = 0; i < 6; i++) {
      cw = Math.max(1, Math.ceil(cw / 2));
      ch = Math.max(1, Math.ceil(ch / 2));
      this.downs[i] = this.target(cw, ch, this.downs[i]);
      this.ups[i] = this.target(cw, ch, this.ups[i]);
    }
  }

  /** Upload the painted street: albedo in rgb, surface class in alpha. */
  setFacade(data: ImageData) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.albedo);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // Canvas rows run top down; the shader's run bottom up.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  setFittings(source: HTMLCanvasElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.fittings);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  /** The unlit look of each glass: linear colour and opacity. */
  setBodies(bodies: { rgb: [number, number, number]; a: number }[]) {
    bodies.forEach((b, i) => this.bodyCol.set([b.rgb[0], b.rgb[1], b.rgb[2], b.a], i * 4));
  }

  /** Each glass's emission lines: rgb and wavelength, with the warm-up group folded into w. */
  setLines(table: { nm: number; rgb: [number, number, number]; group: number }[][]) {
    const gl = this.gl;
    const data = new Float32Array(LINE_SLOTS * TYPES * 4);
    table.forEach((entries, t) => {
      const n = Math.min(entries.length, LINE_SLOTS);
      this.lineCount[t] = n;
      for (let j = 0; j < n; j++) {
        const e = entries[j];
        data.set([e.rgb[0], e.rgb[1], e.rgb[2], e.nm + 1000 * e.group], (t * LINE_SLOTS + j) * 4);
      }
    });
    gl.bindTexture(gl.TEXTURE_2D, this.lines);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, LINE_SLOTS, TYPES, 0, gl.RGBA, gl.FLOAT, data);
  }

  /** Draw the tubes of a plan into the masks. */
  setPlan(plan: Plan, view: View) {
    const gl = this.gl;
    this.view = view;
    const out: number[] = [];
    const present = new Set<number>();
    for (const u of plan.units) {
      const lens = [0];
      for (let i = 1; i < u.pts.length; i++)
        lens.push(lens[i - 1] + Math.hypot(u.pts[i].x - u.pts[i - 1].x, u.pts[i].y - u.pts[i - 1].y));
      const L = lens[lens.length - 1];
      for (let i = 1; i < u.pts.length; i++) {
        const a = u.pts[i - 1];
        const b = u.pts[i];
        const kind = b.lit ? 0 : 1;
        out.push(a.x, a.y, b.x, b.y, lens[i - 1], lens[i], L, kind + 4 * u.glass);
      }
      for (const end of [u.pts[0], u.pts[u.pts.length - 1]]) out.push(end.x, end.y, end.x, end.y, 0, 0, 1, 2);
      present.add(u.glass);
    }
    this.present = [...present].sort((a, b) => a - b);
    this.instCount = out.length / 8;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFb);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 2, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 3, [0, 0, 0, 0]);
    if (this.instCount === 0) return;
    gl.useProgram(this.tube.p);
    gl.uniform3f(this.tube.u.uView, view.s, view.ox, view.oy);
    gl.uniform2f(this.tube.u.uSize, this.w, this.h);
    gl.uniform2f(this.tube.u.uRadius, TUBE_R, HOUSING_R);
    const L = [-0.35, 0.6, 0.72];
    const Ll = Math.hypot(...L);
    const H = [L[0] / Ll, L[1] / Ll, L[2] / Ll + 1];
    const Hl = Math.hypot(...H);
    gl.uniform3f(this.tube.u.uHalf, H[0] / Hl, H[1] / Hl, H[2] / Hl);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.tubeVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.instCount);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
  }

  private bindMasks(p: Program, first: number) {
    const gl = this.gl;
    ['uM0', 'uM1', 'uM2', 'uBody'].forEach((name, i) => {
      gl.activeTexture(gl.TEXTURE0 + first + i);
      gl.bindTexture(gl.TEXTURE_2D, this.masks[i]);
      gl.uniform1i(p.u[name] ?? null, first + i);
    });
  }

  private pass(p: Program, t: Target | null) {
    const gl = this.gl;
    gl.useProgram(p.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    gl.viewport(0, 0, t ? t.w : this.w, t ? t.h : this.h);
  }

  private draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.fullVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  frame(st: FrameState) {
    const gl = this.gl;
    const view = this.view;
    const e = this.e;
    if (!view || !e) return;
    const write = this.hdr ? 1 : 0.125;
    const read = 1 / write;

    // Emission, or its spectra through the grating.
    const src = st.grating ? this.disperse : this.emit;
    this.pass(src, e);
    this.bindMasks(src, 0);
    gl.uniform3fv(src.u.uCol, st.colours);
    gl.uniform1f(src.u.uWrite, write * 6);
    if (st.grating) {
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.lines);
      gl.uniform1i(src.u.uLines, 5);
      const types = new Int32Array(TYPES);
      this.present.forEach((t, i) => (types[i] = t));
      gl.uniform1iv(src.u.uTypes, types);
      gl.uniform1i(src.u.uTypeCount, this.present.length);
      gl.uniform1iv(src.u.uLineCount, this.lineCount);
      gl.uniform3fv(src.u.uGroup, st.groups);
      gl.uniform1f(src.u.uK, (view.s * this.gratingK) / this.w);
    }
    this.draw();

    // Glow: halve down six times, then add back up.
    let prev: Target = e;
    for (const d of this.downs) {
      this.pass(this.down, d);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, prev.tex);
      gl.uniform1i(this.down.u.uSrc, 0);
      gl.uniform2f(this.down.u.uTexel, 0.5 / prev.w, 0.5 / prev.h);
      this.draw();
      prev = d;
    }
    const n = this.downs.length;
    let low: Target = this.downs[n - 1];
    for (let i = n - 2; i >= 0; i--) {
      const t = this.ups[i];
      this.pass(this.up, t);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, low.tex);
      gl.uniform1i(this.up.u.uLow, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.downs[i].tex);
      gl.uniform1i(this.up.u.uHere, 1);
      gl.uniform2f(this.up.u.uTexel, 1 / low.w, 1 / low.h);
      this.draw();
      low = t;
    }

    // Everything together.
    const c = this.comp;
    this.pass(c, null);
    this.bindMasks(c, 0);
    const bind = (name: string, unit: number, tex: WebGLTexture) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(c.u[name], unit);
    };
    bind('uAlbedo', 4, this.albedo);
    bind('uFittings', 5, this.fittings);
    bind('uE', 6, e.tex);
    bind('uBloom', 7, this.ups[0].tex);
    bind('uLight', 8, this.ups[3].tex);
    bind('uStreak', 9, this.ups[1].tex);
    gl.uniform3fv(c.u.uCol, st.colours);
    gl.uniform4fv(c.u.uBodyCol, this.bodyCol);
    gl.uniform3f(c.u.uView, view.s, view.ox, view.oy);
    gl.uniform2f(c.u.uSize, this.w, this.h);
    gl.uniform1f(c.u.uTime, st.time);
    gl.uniform1f(c.u.uRead, read);
    gl.uniform1f(c.u.uGrating, st.grating ? 1 : 0);
    gl.uniform1f(c.u.uRain, st.rain);
    gl.uniform1f(c.u.uExposure, 1.6);
    this.draw();
  }
}
