// The globe: an orthographic view drawn per pixel in one WebGL 2 fragment shader. Every pixel
// works out where on Earth it is, how far that is from each region, whether the light from each
// reply could have reached it yet, and, once the replies are in, how well it explains them.

import { EARTH_KM, KM_PER_RTT_MS, MAX_KM, PASSES, TAU, type Vec3 } from './_solve';

const MAX_STATIONS = 40;
const RAD = Math.PI / 180;

export interface View {
  /** The point at the middle of the disc, degrees. */
  lat: number;
  lon: number;
  /** 1 fits the whole disc in the stage. */
  zoom: number;
}

export interface Scene {
  /** Best round trip for each station in ms; 0 for no reply. */
  rtt: Float32Array;
  /** How much round trip the light has had so far, ms. Infinity once every reply is in. */
  grow: number;
  /** Tint inside each circle while they grow, 0 to 1. */
  tint: number;
  /** Veil over everywhere light rules out, 0 to 1. */
  fog: number;
  /** The fit's likelihood bands, 0 to 1. */
  fit: number;
  /** The best misfit anywhere, from the solver, so the bands peak at 1. */
  best: number;
  /** Station to pick out, or -1. */
  hot: number;
}

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uCenter;
uniform float uR;
uniform float uDpr;
uniform mat3 uM;
uniform sampler2D uLand;
uniform int uN;
uniform vec3 uSta[${MAX_STATIONS}];
uniform float uRtt[${MAX_STATIONS}];
uniform float uGrow;
uniform float uTint;
uniform float uFog;
uniform float uFit;
uniform float uBest;
uniform float uSigma;
uniform int uHot;
out vec4 o;

const float PI = 3.141592653589793;
const float EARTH_MM = ${(EARTH_KM / 1000).toFixed(7)};
const float KPM_MM = ${(KM_PER_RTT_MS / 1000).toFixed(9)};
const float S0 = 1.0 / KPM_MM;
const float MAX_MM = ${(MAX_KM / 1000).toFixed(7)};
const float TAU = ${TAU.toFixed(3)};
const int PASSES = ${PASSES};

const vec3 PAPER = vec3(0.953, 0.949, 0.933);
const vec3 SEA = vec3(0.886, 0.906, 0.922);
const vec3 LAND = vec3(0.776, 0.796, 0.749);
const vec3 INK = vec3(0.106, 0.129, 0.188);
const vec3 COBALT = vec3(0.165, 0.333, 0.788);
const vec3 VERMILION = vec3(0.851, 0.263, 0.165);

float line(float d, float fw, float halfPx) {
  return 1.0 - smoothstep(halfPx * fw, (halfPx + 1.0) * fw, abs(d));
}

void main() {
  vec2 q = (gl_FragCoord.xy - uCenter) / uR;
  float rr = length(q);
  float edgeFw = fwidth(rr);
  float cover = 1.0 - smoothstep(1.0 - edgeFw, 1.0, rr);

  // Where on Earth this pixel looks: view space (x east, y north, z towards us) into the world.
  vec3 v = vec3(q, sqrt(max(0.0, 1.0 - rr * rr)));
  vec3 p = normalize(uM * v);
  float lat = asin(clamp(p.z, -1.0, 1.0));
  float lon = atan(p.y, p.x);

  float land = texture(uLand, vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI)).r;
  float landFw = fwidth(land);
  float isLand = smoothstep(0.5 - landFw, 0.5 + landFw, land);
  vec3 col = mix(SEA, LAND, isLand);

  // Graticule every 15 degrees, fading at the poles.
  float latD = lat / PI * 180.0;
  float lonD = lon / PI * 180.0;
  float gLat = abs(fract(latD / 15.0 + 0.5) - 0.5) * 15.0;
  float gLon = abs(fract(lonD / 15.0 + 0.5) - 0.5) * 15.0;
  float grat = max(line(gLat, fwidth(latD), 0.35 * uDpr), line(gLon, fwidth(lonD), 0.35 * uDpr) * smoothstep(0.08, 0.3, cos(lat)));
  col = mix(col, INK, grat * 0.09);

  // Coastline.
  col = mix(col, INK, line(land - 0.5, landFw, 0.45 * uDpr) * 0.28);

  // Light: a matte sphere lit from the upper left.
  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  float shade = 0.86 + 0.14 * max(dot(v, L), 0.0);
  col *= shade;

  // Distances to every region, the circles, and the most delay a reply could share and still have
  // come from here (below zero, light rules this place out).
  float dk[${MAX_STATIONS}];
  float slack = 1e9;
  float inside = 0.0;
  float rings = 0.0;
  float front = 0.0;
  float hotRing = 0.0;
  float dots = 0.0;
  float n = 0.0;
  // Surface distance per pixel, taken outside the loop: derivatives inside it aren't reliable.
  float fw = length(fwidth(p)) * EARTH_MM;
  for (int i = 0; i < ${MAX_STATIONS}; i++) {
    if (i >= uN) break;
    float d = acos(clamp(dot(p, uSta[i]), -1.0, 1.0)) * EARTH_MM;
    dk[i] = d;
    float px = d / EARTH_MM * uR;
    dots = max(dots, 1.0 - smoothstep(2.6 * uDpr, 3.4 * uDpr, px));
    float t = uRtt[i];
    if (t <= 0.0) continue;
    n += 1.0;
    slack = min(slack, t - d * S0);
    float reach = min(uGrow, t) * KPM_MM;
    if (reach >= MAX_MM) continue;
    float growing = step(uGrow, t);
    inside += step(d, reach);
    float r = line(d - reach, fw, (growing > 0.5 ? 0.7 : 0.55) * uDpr);
    rings = max(rings, r * (growing > 0.5 ? 0.0 : 1.0));
    front = max(front, r * growing);
    // A soft wake behind the moving front.
    front = max(front, growing * exp(-max(0.0, reach - d) / (fw * 14.0 * uDpr)) * step(d, reach) * 0.35);
    if (i == uHot) hotRing = line(d - reach, fw, 1.1 * uDpr);
  }

  col = mix(col, COBALT, min(0.42, inside * 0.035) * uTint);

  // Everywhere light rules out goes behind a veil.
  float sFw = fwidth(slack);
  float out_ = smoothstep(sFw, -sFw, slack) * step(0.5, n);
  col = mix(col, PAPER * 0.985, out_ * uFog * 0.72);

  // The fit: for this spot, the line t = a + s d along the bottom of the replies.
  if (uFit > 0.0 && n > 1.5) {
    float top = max(0.0, slack);
    float a = 0.0;
    float s = S0;
    for (int pass = 0; pass < PASSES; pass++) {
      float W = 0.0, Sx = 0.0, Sy = 0.0, Sxx = 0.0, Sxy = 0.0;
      for (int i = 0; i < ${MAX_STATIONS}; i++) {
        if (i >= uN) break;
        float t = uRtt[i];
        if (t <= 0.0) continue;
        float side = pass == 0 ? 1.0 : (t - a - s * dk[i] > 0.0 ? TAU : 1.0 - TAU);
        float w = side / (t * t);
        W += w; Sx += w * dk[i]; Sy += w * t; Sxx += w * dk[i] * dk[i]; Sxy += w * dk[i] * t;
      }
      float den = W * Sxx - Sx * Sx;
      s = den > 1e-12 ? (W * Sxy - Sx * Sy) / den : S0;
      s = max(s, S0);
      a = (Sy - s * Sx) / W;
      if (a < 0.0 || a > top) {
        a = clamp(a, 0.0, top);
        s = Sxx > 0.0 ? max(S0, (Sxy - a * Sx) / Sxx) : S0;
      }
    }
    float e = 0.0;
    for (int i = 0; i < ${MAX_STATIONS}; i++) {
      if (i >= uN) break;
      float t = uRtt[i];
      if (t <= 0.0) continue;
      float r = (t - a - s * dk[i]) / t;
      e += r * r * (r > 0.0 ? TAU : 1.0 - TAU);
    }
    float like = exp(-(e / n - uBest) / (2.0 * uSigma * uSigma)) * step(0.0, slack);
    float lFw = fwidth(like);
    float band = 0.0;
    band += smoothstep(0.05 - lFw, 0.05 + lFw, like) * 0.13;
    band += smoothstep(0.3 - lFw, 0.3 + lFw, like) * 0.13;
    band += smoothstep(0.75 - lFw, 0.75 + lFw, like) * 0.16;
    float contour = max(line(like - 0.05, lFw, 0.4 * uDpr), max(line(like - 0.3, lFw, 0.4 * uDpr), line(like - 0.75, lFw, 0.4 * uDpr)));
    col = mix(col, VERMILION, (band + contour * 0.55) * uFit);
  }

  col = mix(col, COBALT, rings * mix(0.55, 0.38, uFog));
  col = mix(col, COBALT, front * 0.85);
  col = mix(col, INK, hotRing * 0.85);
  // Where light last allows: the edge of the clear patch.
  col = mix(col, COBALT, line(slack, sFw, 0.8 * uDpr) * uFog * step(0.5, n));
  col = mix(col, INK, dots * 0.9);

  // A thin rim, then a soft shadow beyond the disc.
  col = mix(col, INK, smoothstep(1.0 - 2.2 * edgeFw * uDpr, 1.0, rr) * 0.35);
  float shadow = (1.0 - smoothstep(0.92, 1.1, length(q - vec2(0.025, -0.045)))) * 0.11 * (1.0 - cover);
  float alpha = cover + shadow;
  vec3 outCol = col * cover + INK * shadow;
  o = vec4(outCol, alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
  return sh;
}

/** The view's three axes in world space, as matrix columns: east, north, and towards the viewer. */
export function viewMatrix(lat: number, lon: number): Float32Array {
  const p = lat * RAD;
  const l = lon * RAD;
  return new Float32Array([
    -Math.sin(l),
    Math.cos(l),
    0,
    -Math.sin(p) * Math.cos(l),
    -Math.sin(p) * Math.sin(l),
    Math.cos(p),
    Math.cos(p) * Math.cos(l),
    Math.cos(p) * Math.sin(l),
    Math.sin(p),
  ]);
}

export class Globe {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private stations: Vec3[];
  private w = 1;
  private h = 1;
  private dpr = 1;
  view: View = { lat: 30, lon: -40, zoom: 1 };
  private m = viewMatrix(30, -40);

  constructor(canvas: HTMLCanvasElement, stations: Vec3[], land: HTMLCanvasElement) {
    this.canvas = canvas;
    this.stations = stations;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.prog = prog;
    gl.useProgram(prog);
    for (const name of [
      'uCenter',
      'uR',
      'uDpr',
      'uM',
      'uLand',
      'uN',
      'uSta',
      'uRtt',
      'uGrow',
      'uTint',
      'uFog',
      'uFit',
      'uBest',
      'uSigma',
      'uHot',
    ]) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, land);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.u.uLand, 0);

    const sta = new Float32Array(MAX_STATIONS * 3);
    stations.forEach((s, i) => sta.set(s, i * 3));
    gl.uniform3fv(this.u.uSta, sta);
    gl.uniform1i(this.u.uN, stations.length);
  }

  /** Match the canvas to its box; returns true when the size changed. */
  resize(): boolean {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.w && h === this.h && dpr === this.dpr) return false;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    return true;
  }

  get size(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }

  /** The disc's radius in CSS pixels. */
  get radius(): number {
    return 0.47 * Math.min(this.w, this.h) * this.view.zoom;
  }

  setView(v: View): void {
    this.view = {
      lat: Math.max(-85, Math.min(85, v.lat)),
      lon: ((((v.lon + 180) % 360) + 360) % 360) - 180,
      zoom: v.zoom,
    };
    this.m = viewMatrix(this.view.lat, this.view.lon);
  }

  /** Stage position in CSS pixels, and whether the point faces the viewer. */
  project(p: Vec3): { x: number; y: number; z: number } {
    const m = this.m;
    const x = m[0] * p[0] + m[1] * p[1] + m[2] * p[2];
    const y = m[3] * p[0] + m[4] * p[1] + m[5] * p[2];
    const z = m[6] * p[0] + m[7] * p[1] + m[8] * p[2];
    const R = this.radius;
    return { x: this.w / 2 + x * R, y: this.h / 2 - y * R, z };
  }

  /** The point on Earth under a stage position, or null off the disc. */
  unproject(sx: number, sy: number): Vec3 | null {
    const R = this.radius;
    const x = (sx - this.w / 2) / R;
    const y = -(sy - this.h / 2) / R;
    const rr = x * x + y * y;
    if (rr > 1) return null;
    const z = Math.sqrt(1 - rr);
    const m = this.m;
    return [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z];
  }

  render(s: Scene, sigma: number): void {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uCenter, W / 2, H / 2);
    gl.uniform1f(this.u.uR, this.radius * this.dpr);
    gl.uniform1f(this.u.uDpr, this.dpr);
    gl.uniformMatrix3fv(this.u.uM, false, this.m);
    const rtt = new Float32Array(MAX_STATIONS);
    rtt.set(s.rtt.subarray(0, Math.min(MAX_STATIONS, s.rtt.length)));
    gl.uniform1fv(this.u.uRtt, rtt);
    gl.uniform1f(this.u.uGrow, Number.isFinite(s.grow) ? s.grow : 1e6);
    gl.uniform1f(this.u.uTint, s.tint);
    gl.uniform1f(this.u.uFog, s.fog);
    gl.uniform1f(this.u.uFit, s.fit);
    gl.uniform1f(this.u.uBest, s.best);
    gl.uniform1f(this.u.uSigma, sigma);
    gl.uniform1i(this.u.uHot, s.hot);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  get stationVecs(): Vec3[] {
    return this.stations;
  }
}
