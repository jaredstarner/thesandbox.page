// The microscope: draws the lattice as a photomicrograph under five kinds of light. The ice
// edge is cut from the lattice itself (barycentric on its triangles), and the light reads the
// smoothed crystal mass as thickness: where it changes, the plate bends light out of the
// field, which is what shows ridges and edges in a real photomicrograph.

import { CENTER, compile, N, type Lattice } from './_lattice';

export type Light = 'rheinberg' | 'dark' | 'bright' | 'vapour' | 'timeline';

const MODES: Record<Light, number> = { rheinberg: 0, dark: 1, bright: 2, vapour: 3, timeline: 4 };

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D u_state;
uniform sampler2D u_prep;
uniform ivec2 u_lo;
uniform ivec2 u_hi;
uniform float u_r2;
uniform float u_rho;
// Centre of the view in cells, and cells per device pixel.
uniform vec3 u_view;
uniform vec2 u_res;
uniform int u_mode;
uniform float u_flip;
out vec4 o;

const float C = ${CENTER.toFixed(1)};
const float NN = ${N.toFixed(1)};
const float S3 = 1.7320508;

bool inside(ivec2 p) {
  ivec2 q = p - ivec2(${CENTER}, ${CENTER});
  return p.x >= u_lo.x && p.y >= u_lo.y && p.x <= u_hi.x && p.y <= u_hi.y
    && float(q.x * q.x - q.x * q.y + q.y * q.y) <= u_r2;
}
float ice(ivec2 p) {
  return inside(p) && texelFetch(u_state, p, 0).a > 0.0 ? 1.0 : 0.0;
}
// World position in cells (x right, y up) to lattice coordinates.
vec2 lattice(vec2 w) {
  float v = w.y * 2.0 / S3;
  return vec2(w.x + v * 0.5, v) + C;
}
vec4 pf(ivec2 p) {
  return inside(p) ? texelFetch(u_prep, p, 0) : vec4(0.0, 1.0, u_rho, 0.0);
}
// Linear across the lattice's own triangles, so no direction is favoured.
vec4 prep(vec2 w) {
  vec2 t = lattice(w);
  ivec2 b = ivec2(floor(t));
  vec2 f = t - vec2(b);
  if (f.x >= f.y) return (1.0 - f.x) * pf(b) + (f.x - f.y) * pf(b + ivec2(1, 0)) + f.y * pf(b + ivec2(1, 1));
  return (1.0 - f.y) * pf(b) + (f.y - f.x) * pf(b + ivec2(0, 1)) + f.x * pf(b + ivec2(1, 1));
}
float cover(vec2 w) {
  vec2 t = lattice(w);
  ivec2 b = ivec2(floor(t));
  vec2 f = t - vec2(b);
  if (f.x >= f.y) {
    return (1.0 - f.x) * ice(b) + (f.x - f.y) * ice(b + ivec2(1, 0)) + f.y * ice(b + ivec2(1, 1));
  }
  return (1.0 - f.y) * ice(b) + (f.y - f.x) * ice(b + ivec2(0, 1)) + f.x * ice(b + ivec2(1, 1));
}

vec3 timeline(float t) {
  vec3 a = vec3(0.62, 0.86, 1.0);
  vec3 b = vec3(0.48, 0.52, 1.0);
  vec3 c = vec3(0.90, 0.45, 0.84);
  vec3 d = vec3(1.0, 0.73, 0.38);
  t = clamp(t, 0.0, 1.0) * 3.0;
  return t < 1.0 ? mix(a, b, t) : t < 2.0 ? mix(b, c, t - 1.0) : mix(c, d, t - 2.0);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, u_flip > 0.5 ? u_res.y - gl_FragCoord.y : gl_FragCoord.y);
  vec2 rel = frag - u_res * 0.5;
  float px = u_view.z;
  vec2 w = u_view.xy + rel * px;
  float r = length(rel) / (0.5 * u_res.x);

  // The ice edge: crisp from the lattice when cells are larger than a pixel, from the
  // smoothed coverage when they are not.
  vec4 here = prep(w);
  float edge = mix(cover(w), here.a, clamp((px - 0.6) / 0.6, 0.0, 1.0));
  float fw = max(fwidth(edge), 1e-4);
  float ice = smoothstep(0.5 - fw * 0.75, 0.5 + fw * 0.75, edge);
  // Pixels inside the edge, from how fast the coverage changes across the screen.
  float inward = (edge - 0.5) / fw;

  float h = here.r;
  float e = max(1.0, px);
  float gx = prep(w + vec2(e, 0.0)).r - prep(w - vec2(e, 0.0)).r;
  float gy = prep(w + vec2(0.0, e)).r - prep(w - vec2(0.0, e)).r;
  vec2 g = vec2(gx, gy) / (2.0 * e);
  // Slopes inside the plate come from its thickness; the edge itself is drawn as a line a
  // couple of pixels wide at any zoom, brighter where the edge is thick.
  float interior = smoothstep(0.8, 0.97, here.a);
  g *= interior;
  float slope = length(g);
  float rim = inward > -1.0 ? exp(-max(inward, 0.0) / 1.5) * clamp(0.4 + 0.45 * h, 0.0, 1.0) : 0.0;
  float bend = max(1.0 - exp(-slope * 2.6), rim);
  vec3 n = normalize(vec3(-g * 1.4, 1.0));
  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  float lit = dot(n, L) - L.z;
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 36.0);

  vec3 bg;
  vec3 xtal;
  if (u_mode == 0) {
    // Rheinberg: a blue central stop and an amber ring. Flat ice passes the blue; slopes
    // throw the ring's light into the objective.
    bg = mix(vec3(0.09, 0.23, 0.50), vec3(0.025, 0.07, 0.19), smoothstep(0.0, 1.05, r));
    vec3 ring = vec3(1.0, 0.70, 0.30);
    xtal = bg * (1.08 + 0.10 * h) + ring * bend * 0.95 + vec3(0.55, 0.75, 1.0) * lit * 0.18;
    xtal += vec3(1.0, 0.92, 0.80) * spec * 0.35;
  } else if (u_mode == 1) {
    // Dark field: only light the crystal scatters reaches the eye.
    bg = mix(vec3(0.020, 0.026, 0.040), vec3(0.006, 0.008, 0.014), smoothstep(0.0, 1.0, r));
    xtal = bg + vec3(0.80, 0.88, 1.0) * (0.035 + 0.05 * h + bend * 0.95) + vec3(0.7, 0.8, 1.0) * max(lit, 0.0) * 0.2;
    xtal += spec * 0.25;
  } else if (u_mode == 2) {
    // Bright field: the plate is nearly invisible except where it bends light away.
    bg = mix(vec3(0.86, 0.89, 0.92), vec3(0.62, 0.67, 0.73), smoothstep(0.1, 1.05, r));
    xtal = bg * (1.0 - 0.62 * bend) * (1.0 - 0.02 * h) + vec3(0.25, 0.3, 0.36) * lit * 0.35;
    xtal += spec * 0.18;
  } else if (u_mode == 3) {
    // Vapour: the model's diffusing mass, thinned around the arms where they drew it in.
    float v = clamp(here.b / max(u_rho, 1e-4), 0.0, 1.0);
    vec3 thin = vec3(0.02, 0.025, 0.08);
    vec3 mid = vec3(0.10, 0.33, 0.52);
    vec3 full = vec3(0.55, 0.80, 0.86);
    bg = v < 0.6 ? mix(thin, mid, v / 0.6) : mix(mid, full, (v - 0.6) / 0.4);
    bg *= 1.0 - 0.25 * smoothstep(0.7, 1.05, r);
    xtal = vec3(0.92, 0.95, 1.0) * (0.55 + 0.12 * h) + vec3(0.5) * lit * 0.3 - bend * 0.25;
  } else {
    // Timeline: each part of the ice coloured by when it froze.
    bg = mix(vec3(0.035, 0.04, 0.065), vec3(0.012, 0.014, 0.024), smoothstep(0.0, 1.0, r));
    xtal = timeline(here.g) * (0.62 + 0.1 * h + 0.35 * bend) + vec3(1.0) * max(lit, 0.0) * 0.15;
  }
  o = vec4(mix(bg, xtal, ice), 1.0);
}`;

export class Microscope {
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(
    readonly gl: WebGL2RenderingContext,
    readonly lattice: Lattice,
  ) {
    this.prog = compile(gl, VERTEX, FRAGMENT);
    for (const n of ['u_state', 'u_prep', 'u_lo', 'u_hi', 'u_r2', 'u_rho', 'u_view', 'u_res', 'u_mode', 'u_flip']) {
      this.u[n] = gl.getUniformLocation(this.prog, n);
    }
  }

  /** Draw into the bound framebuffer, `w` x `h` device pixels, with `cells` cells per pixel. */
  draw(light: Light, w: number, h: number, cells: number, flip = false): void {
    const gl = this.gl;
    const l = this.lattice;
    gl.bindVertexArray(l.vao);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, l.stateTexture);
    gl.uniform1i(this.u.u_state, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, l.prep.tex);
    gl.uniform1i(this.u.u_prep, 1);
    gl.uniform2i(this.u.u_lo, l.lo, l.lo);
    gl.uniform2i(this.u.u_hi, l.hi, l.hi);
    gl.uniform1f(this.u.u_r2, l.r2);
    gl.uniform1f(this.u.u_rho, l.rho);
    gl.uniform3f(this.u.u_view, 0, 0, cells);
    gl.uniform2f(this.u.u_res, w, h);
    gl.uniform1i(this.u.u_mode, MODES[light]);
    gl.uniform1f(this.u.u_flip, flip ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Render a square picture of the field `radius` cells across its half-width, off screen. */
  picture(light: Light, size: number, radius: number): HTMLCanvasElement {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    const out = document.createElement('canvas');
    out.width = out.height = size;
    if (!tex || !fbo) return out;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size, size);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    this.lattice.prepare();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    // Drawn top row first, so the bytes read back are already in image order.
    this.draw(light, size, size, radius / (size / 2), true);
    const px = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    const ctx = out.getContext('2d');
    if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), size, size), 0, 0);
    return out;
  }
}
