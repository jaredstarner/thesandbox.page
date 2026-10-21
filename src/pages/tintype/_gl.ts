// The plate, drawn in one WebGL2 fragment pass. Data textures (film depth,
// development, fixer, varnish) are coarse grids from the models, sampled with
// a cubic B-spline so they read as smooth liquid; the latent image is the
// exposure the studio integrated on the CPU. All of them are stored top row
// first, so the shader's plate coordinate p runs y down.

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform int uMode;            // 0 plate, 1 ground glass, 2 mirror while exposing
uniform vec2 uRes;
uniform float uSeed;
uniform float uTime;

uniform sampler2D uSrc;
uniform vec4 uCrop;           // source rectangle in source uv: x, y, w, h
uniform vec2 uFlip;           // -1 flips that axis
uniform float uBlue;

uniform sampler2D uLatent;
uniform float uLatentScale;
uniform float uHasLatent;
uniform float uSwirl;

uniform sampler2D uCoat;
uniform vec2 uCoatSize;
uniform float uResidual;
uniform float uWetCoat;
uniform vec2 uDrain;          // drain corner, plate uv
uniform float uRidge;
uniform float uStreak;
uniform float uSens;

uniform sampler2D uDev;
uniform float uDevOn;
uniform sampler2D uClear;
uniform float uFix;           // seconds in the fixer; negative before
uniform float uWetFix;

uniform sampler2D uVarnish;
uniform float uVarnishAmt;
uniform float uWetVarnish;

uniform vec4 uComets[4];
uniform vec3 uAmbient;
uniform vec2 uLight;          // centre of the window's reflection, plate uv
uniform vec2 uTilt;

const float ASPECT = 0.8;     // plate width over height

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// What collodion sees: blue and violet, a little green, no red.
float ortho(vec3 lin) {
  return dot(lin, vec3(0.0, 0.12, 0.88));
}

vec4 cubicW(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return vec4(x, y, z, w) * (1.0 / 6.0);
}

vec4 smoothTex(sampler2D t, vec2 uv, vec2 size) {
  vec2 inv = 1.0 / size;
  uv = uv * size - 0.5;
  vec2 f = fract(uv);
  uv -= f;
  vec4 xc = cubicW(f.x);
  vec4 yc = cubicW(f.y);
  vec4 c = uv.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 off = (c + vec4(xc.yw, yc.yw) / s) * inv.xxyy;
  vec4 s0 = texture(t, off.xz);
  vec4 s1 = texture(t, off.yz);
  vec4 s2 = texture(t, off.xw);
  vec4 s3 = texture(t, off.yw);
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}

// Signed distance to the plate's edge, in plate heights: a sheet cut with
// hand shears, corners slightly rounded.
float plateEdge(vec2 p) {
  vec2 q = (p - 0.5) * vec2(ASPECT, 1.0);
  vec2 b = vec2(ASPECT, 1.0) * 0.5 - 0.008;
  float r = 0.014;
  vec2 d = abs(q) - b + r;
  float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
  float along = abs(q.x) > abs(q.y) * ASPECT ? p.y : p.x;
  sd += (vnoise(vec2(along * 46.0, uSeed)) - 0.5) * 0.0026 + (vnoise(vec2(along * 7.0, uSeed + 3.0)) - 0.5) * 0.003;
  return sd;
}

// The japanned iron: near black, warm, with a faint orange peel and thinner, browner lacquer at the edges.
vec3 lacquer(vec2 p, float sd) {
  float peel = fbm(p * vec2(60.0, 75.0) + uSeed) - 0.5;
  float cloud = fbm(p * 3.0 + uSeed * 1.7) - 0.5;
  vec3 c = vec3(0.0105, 0.0078, 0.0062) * (1.0 + cloud * 0.35 + peel * 0.12);
  float rim = smoothstep(-0.012, -0.002, sd);
  c = mix(c, vec3(0.032, 0.017, 0.009), rim * 0.8);
  return c;
}

// The window the studio is lit from, as the plate reflects it: a tall skylight with glazing bars.
float windowLight(vec2 s) {
  vec2 d = (s - uLight) * vec2(ASPECT, 1.0);
  vec2 box = abs(d) - vec2(0.15, 0.2);
  float o = length(max(box, 0.0)) + min(max(box.x, box.y), 0.0);
  float w = 1.0 - smoothstep(-0.02, 0.05, o);
  vec2 g = abs(fract(d / vec2(0.1, 0.133) + 0.5) - 0.5) * vec2(0.1, 0.133);
  float bars = smoothstep(0.0, 0.0035, min(g.x, g.y));
  return w * mix(0.35, 1.0, bars) + exp(-max(o, 0.0) * 9.0) * 0.12;
}

vec2 heightGrad(sampler2D t, vec2 p, vec2 size, int ch) {
  vec2 e = 1.0 / size;
  vec4 a = smoothTex(t, p + vec2(e.x, 0.0), size);
  vec4 b = smoothTex(t, p - vec2(e.x, 0.0), size);
  vec4 c = smoothTex(t, p + vec2(0.0, e.y), size);
  vec4 d = smoothTex(t, p - vec2(0.0, e.y), size);
  return vec2(a[ch] - b[ch], c[ch] - d[ch]) * 0.5;
}

// The Petzval lens: sharp in the middle, smeared round the centre toward the
// edges, so the background swirls.
float latent(vec2 p) {
  vec2 c = vec2(0.5, 0.46);
  vec2 d = (p - c) * vec2(ASPECT, 1.0);
  float r = length(d);
  float arc = uSwirl * r * r;
  float a = arc / max(r, 1e-3);
  float sum = 0.0;
  float wsum = 0.0;
  for (int i = -7; i <= 7; i++) {
    float t = float(i) / 7.0;
    float ang = t * a;
    vec2 rd = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * d * (1.0 + t * arc * 0.18);
    vec2 q = c + rd / vec2(ASPECT, 1.0);
    float w = 1.0 - abs(t) * 0.6;
    sum += texture(uLatent, q).r * w;
    wsum += w;
  }
  return sum / wsum;
}

float comet(vec2 p, vec4 k) {
  if (k.w <= 0.0) return 0.0;
  vec2 d = (p - k.xy) * vec2(ASPECT, 1.0);
  vec2 dir = vec2(cos(k.z), sin(k.z));
  float along = dot(d, dir);
  float across = dot(d, vec2(-dir.y, dir.x));
  float head = 1.0 - smoothstep(0.0018, 0.0042, length(d));
  float t = clamp(along / k.w, 0.0, 1.0);
  float width = mix(0.0026, 0.0, t);
  float tail = along > 0.0 && along < k.w ? (1.0 - smoothstep(width * 0.4, width, abs(across))) * (1.0 - t) : 0.0;
  return max(head, tail * 0.8);
}

vec3 groundGlass(vec2 p) {
  vec2 sp = vec2(uFlip.x < 0.0 ? 1.0 - p.x : p.x, uFlip.y < 0.0 ? 1.0 - p.y : p.y);
  vec3 c = toLinear(texture(uSrc, uCrop.xy + sp * uCrop.zw).rgb);
  if (uBlue > 0.5) c = vec3(0.07, 0.16, 0.95) * ortho(c) * 1.25;
  vec2 q = (p - 0.5) * vec2(ASPECT, 1.0);
  float r2 = dot(q, q) * 4.0;
  c *= (1.08 - 0.62 * r2) * (0.9 + 0.2 * hash(floor(p * uRes) + uSeed));
  vec2 g = abs(fract(p * 3.0 + 0.5) - 0.5) / 3.0 * uRes;
  float grid = 1.0 - smoothstep(0.5, 1.4, min(g.x, g.y));
  c = mix(c, vec3(0.06), grid * 0.35);
  return c;
}

void main() {
  vec2 p = vUv;
  float px = 1.0 / uRes.y;
  float sd = plateEdge(p);
  float alpha = 1.0 - smoothstep(-px, px, sd);
  if (alpha <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  if (uMode == 1) {
    vec3 c = groundGlass(p);
    float frame = smoothstep(-0.018, -0.016, sd);
    c = mix(c, vec3(0.018, 0.013, 0.01), frame);
    outColor = vec4(toSrgb(c) * alpha, alpha);
    return;
  }

  if (uMode == 2) {
    vec2 sp = vec2(uFlip.x < 0.0 ? 1.0 - p.x : p.x, uFlip.y < 0.0 ? 1.0 - p.y : p.y);
    float o = ortho(toLinear(texture(uSrc, uCrop.xy + sp * uCrop.zw).rgb));
    vec3 c = vec3(0.95, 0.9, 0.82) * o * 0.7;
    float frame = smoothstep(-0.018, -0.016, sd);
    c = mix(c, vec3(0.018, 0.013, 0.01), frame);
    outColor = vec4(toSrgb(c) * alpha, alpha);
    return;
  }

  vec3 lac = lacquer(p, sd);

  // The collodion film, with the ridges a still drain leaves at the drain corner.
  vec4 coatS = smoothTex(uCoat, p, uCoatSize);
  float film = coatS.r;
  float cover = smoothstep(uResidual * 0.5, uResidual * 0.8, film + (vnoise(p * 140.0 + uSeed) - 0.5) * uResidual * 0.25);
  vec2 dd = (p - uDrain) * vec2(ASPECT, 1.0);
  float dr = length(dd);
  float ridge = sin(dr * 260.0 + fbm(p * 20.0 + uSeed) * 5.0) * smoothstep(0.32, 0.04, dr) * uRidge;
  float thick = clamp((film - uResidual) / 0.08, 0.0, 1.0) + ridge * 0.35;

  // Exposure: the integrated image through the lens, falling off toward the
  // corners, missing where the holder's corner wires held the plate.
  float E = 0.0;
  if (uHasLatent > 0.5) {
    E = latent(p) * uLatentScale;
    vec2 q = (p - 0.5) * vec2(ASPECT, 1.0) * 2.0;
    E *= 1.0 - 0.32 * dot(q, q) / 1.64;
    vec2 cp = min(p, 1.0 - p) * vec2(ASPECT, 1.0);
    E *= smoothstep(0.034, 0.042, cp.x + cp.y);
    float streaks = smoothstep(0.35, 0.75, fbm(vec2(p.x * 26.0, p.y * 1.6) + uSeed * 2.0));
    E *= 1.0 - uStreak * streaks * 0.8;
    E *= 0.72 + 0.56 * clamp(thick, 0.0, 1.4);
  }
  float L = pow(E, 1.6) / (pow(E, 1.6) + pow(0.9, 1.6));

  vec4 dev = uDevOn > 0.5 ? smoothTex(uDev, p, uCoatSize) : vec4(0.0);
  float D = L * dev.r + dev.g + dev.b * 0.14 * dev.r;
  float k = 0.0;
  for (int i = 0; i < 4; i++) k = max(k, comet(p, uComets[i]));
  D = max(D, k * 0.75 * step(0.001, dev.r));
  D += (hash(floor(p * uRes * 0.7) + uSeed) - 0.5) * 0.025 * dev.r;
  D += (fbm(p * 9.0 + uSeed * 3.1) - 0.5) * 0.06 * dev.r;
  // Silver drains to the corner the plate stood on in the holder and stains it.
  float stain = smoothstep(0.16, 0.0, dr + (fbm(p * 14.0) - 0.5) * 0.08) * dev.r;
  D = clamp(D + stain * 0.18, 0.0, 1.0);

  vec3 cream = vec3(0.6, 0.5, 0.29);
  vec3 silver = vec3(0.5, 0.475, 0.43);
  vec3 neg = mix(cream * (0.96 + 0.08 * fbm(p * 30.0)), vec3(0.13, 0.115, 0.09), clamp(D * 0.85, 0.0, 1.0));
  vec3 clearFilm = lac * 1.25 + vec3(0.003, 0.0024, 0.001);
  vec3 pos = mix(clearFilm, silver, pow(D, 1.05));
  pos = mix(pos, pos * vec3(1.05, 0.86, 0.66), stain * 0.6);
  float clearAt = smoothTex(uClear, p, uCoatSize).r;
  float fixedAmt = uFix < 0.0 ? 0.0 : smoothstep(clearAt - 0.35, clearAt + 0.35, uFix + (vnoise(p * 90.0) - 0.5) * 0.3);
  vec3 coated = mix(mix(clearFilm, neg, uSens), pos, fixedAmt);
  vec3 col = mix(lac, coated, cover);

  float vFilm = smoothTex(uVarnish, p, uCoatSize).r;
  float vAmt = clamp(vFilm * 9.0, 0.0, 1.0) * uVarnishAmt;
  col *= mix(vec3(1.0), vec3(1.0, 0.9, 0.72), vAmt);

  // Surface: liquid on the plate bends the window's reflection.
  vec2 grad = vec2(0.0);
  grad += heightGrad(uCoat, p, uCoatSize, 0) * uWetCoat * 9.0;
  grad += heightGrad(uDev, p, uCoatSize, 3) * 0.9;
  grad += heightGrad(uVarnish, p, uCoatSize, 0) * uWetVarnish * 9.0;
  float pool = clamp((film - uResidual) * 4.0, 0.0, 1.0) * uWetCoat;
  vec2 s = p + grad * 1.6 + uTilt * vec2(-0.08, -0.08);
  float gloss = 0.05 + 0.05 * max(pool, max(dev.a * uDevOn, uWetFix * cover)) + 0.04 * vAmt + 0.03 * uWetVarnish;
  float spec = windowLight(s) * gloss;
  spec += pool * 0.012 + dev.a * uDevOn * 0.006;
  float bevel = smoothstep(-0.004, -0.0015, sd) * (1.0 - smoothstep(-0.0015, 0.0, sd));
  spec += bevel * 0.05 * clamp(0.5 - (p.x + p.y - 1.0), 0.0, 1.0);

  col = col * uAmbient + spec * uAmbient;
  outColor = vec4(toSrgb(col) * alpha, alpha);
}`;

export interface PlateState {
  mode: 0 | 1 | 2;
  crop: [number, number, number, number];
  flip: [number, number];
  blue: boolean;
  latentScale: number;
  hasLatent: boolean;
  swirl: number;
  residual: number;
  wetCoat: number;
  drain: [number, number];
  ridge: number;
  streak: number;
  sens: number;
  devOn: boolean;
  fix: number;
  wetFix: number;
  varnish: number;
  wetVarnish: number;
  comets: number[];
  ambient: [number, number, number];
  light: [number, number];
  tilt: [number, number];
  seed: number;
  time: number;
}

type Tex = { tex: WebGLTexture; w: number; h: number };

export class PlateRenderer {
  readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private readonly src: Tex;
  private latent: Tex;
  private coat: Tex;
  private dev: Tex;
  private clear: Tex;
  private varnish: Tex;
  readonly gridW: number;
  readonly gridH: number;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, gridW: number, gridH: number) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    this.gridW = gridW;
    this.gridH = gridH;
    this.program = this.link();
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.src = this.texture(1, 1, gl.RGBA8);
    this.latent = this.texture(1, 1, gl.R16F);
    this.coat = this.texture(gridW, gridH, gl.R16F);
    this.dev = this.texture(gridW, gridH, gl.RGBA16F);
    this.clear = this.texture(gridW, gridH, gl.R16F);
    this.varnish = this.texture(gridW, gridH, gl.R16F);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  private link() {
    const gl = this.gl;
    const compile = (type: number, code: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }

  private texture(w: number, h: number, format: number): Tex {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const t = { tex, w, h };
    if (format === gl.RGBA8) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(w * h * 4));
    } else {
      const channels = format === gl.RGBA16F ? 4 : 1;
      this.uploadFloat(t, new Float32Array(w * h * channels), w, h);
    }
    return t;
  }

  private uploadFloat(t: Tex, data: Float32Array, w: number, h: number) {
    const gl = this.gl;
    const rgba = data.length === w * h * 4;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      rgba ? gl.RGBA16F : gl.R16F,
      w,
      h,
      0,
      rgba ? gl.RGBA : gl.RED,
      gl.FLOAT,
      data,
    );
    t.w = w;
    t.h = h;
  }

  setSource(el: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.src.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, el);
  }

  setLatent(data: Float32Array, w: number, h: number) {
    this.uploadFloat(this.latent, data, w, h);
  }

  setCoat(data: Float32Array) {
    this.uploadFloat(this.coat, data, this.gridW, this.gridH);
  }

  setDev(data: Float32Array) {
    this.uploadFloat(this.dev, data, this.gridW, this.gridH);
  }

  setClear(data: Float32Array) {
    this.uploadFloat(this.clear, data, this.gridW, this.gridH);
  }

  setVarnish(data: Float32Array) {
    this.uploadFloat(this.varnish, data, this.gridW, this.gridH);
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private u(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name) ?? null;
  }

  draw(s: PlateState, width = this.canvas.width, height = this.canvas.height) {
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const units: [string, Tex][] = [
      ['uSrc', this.src],
      ['uLatent', this.latent],
      ['uCoat', this.coat],
      ['uDev', this.dev],
      ['uClear', this.clear],
      ['uVarnish', this.varnish],
    ];
    units.forEach(([name, t], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(this.u(name), i);
    });
    gl.uniform1i(this.u('uMode'), s.mode);
    gl.uniform2f(this.u('uRes'), width, height);
    gl.uniform1f(this.u('uSeed'), s.seed);
    gl.uniform1f(this.u('uTime'), s.time);
    gl.uniform4f(this.u('uCrop'), ...s.crop);
    gl.uniform2f(this.u('uFlip'), ...s.flip);
    gl.uniform1f(this.u('uBlue'), s.blue ? 1 : 0);
    gl.uniform1f(this.u('uLatentScale'), s.latentScale);
    gl.uniform1f(this.u('uHasLatent'), s.hasLatent ? 1 : 0);
    gl.uniform1f(this.u('uSwirl'), s.swirl);
    gl.uniform2f(this.u('uCoatSize'), this.gridW, this.gridH);
    gl.uniform1f(this.u('uResidual'), s.residual);
    gl.uniform1f(this.u('uWetCoat'), s.wetCoat);
    gl.uniform2f(this.u('uDrain'), ...s.drain);
    gl.uniform1f(this.u('uRidge'), s.ridge);
    gl.uniform1f(this.u('uStreak'), s.streak);
    gl.uniform1f(this.u('uSens'), s.sens);
    gl.uniform1f(this.u('uDevOn'), s.devOn ? 1 : 0);
    gl.uniform1f(this.u('uFix'), s.fix);
    gl.uniform1f(this.u('uWetFix'), s.wetFix);
    gl.uniform1f(this.u('uVarnishAmt'), s.varnish);
    gl.uniform1f(this.u('uWetVarnish'), s.wetVarnish);
    gl.uniform4fv(this.u('uComets'), new Float32Array(s.comets));
    gl.uniform3f(this.u('uAmbient'), ...s.ambient);
    gl.uniform2f(this.u('uLight'), ...s.light);
    gl.uniform2f(this.u('uTilt'), ...s.tilt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Draw at a fixed size into an offscreen target and read it back, top row first. */
  snapshot(s: PlateState, width: number, height: number): ImageData {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    this.draw(s, width, height);
    const px = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    const out = new ImageData(width, height);
    const row = width * 4;
    for (let y = 0; y < height; y++) {
      // Un-premultiply as each row is flipped into place.
      for (let x = 0; x < row; x += 4) {
        const si = (height - 1 - y) * row + x;
        const di = y * row + x;
        const a = px[si + 3];
        const k = a ? 255 / a : 0;
        out.data[di] = Math.min(255, px[si] * k);
        out.data[di + 1] = Math.min(255, px[si + 1] * k);
        out.data[di + 2] = Math.min(255, px[si + 2] * k);
        out.data[di + 3] = a;
      }
    }
    return out;
  }
}
