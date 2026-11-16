// The bench, drawn in WebGL 2: a studio table, the electromagnet (copper
// windings between phenolic flanges under a turned aluminium plate), the
// porcelain dish, a steel rule, and the fluid as a heightfield from the
// worker. Everything is lit by one hand-written studio environment: a big
// softbox behind and to the left, a strip light on the right, and a fill card
// in front. Black ferrofluid shows almost nothing but reflections of these.

import { N, DX, DOMAIN, DISH, bed } from './_sim';

export const PLATE_TOP = 43;
export const FLOOR_Y = PLATE_TOP + 4;
const COIL_R = 105;
const FLANGE_R = 112;
const PLATE_R = 108.5;
/** Where the turned inner wall takes over from the fluid's grid: 53 mm out, on the fillet. */
const INNER_R = 53;
const INNER_FROM = Math.asin((INNER_R - DISH.floor) / DISH.fillet);

const LIGHTS = /* glsl */ `
const vec3 KEY_DIR = normalize(vec3(-0.42, 0.78, -0.46));
const vec3 STRIP_DIR = normalize(vec3(0.95, 0.38, -0.05));
const vec3 FILL_DIR = normalize(vec3(-0.7, 0.28, 0.65));
const vec3 TOP_DIR = normalize(vec3(0.15, 1.0, 0.25));
const vec3 TABLE_ALBEDO = vec3(0.072, 0.07, 0.066);
const vec3 BACKDROP = vec3(0.016, 0.0155, 0.015);

void frame(vec3 c, out vec3 t, out vec3 b) {
  t = normalize(cross(vec3(0.0, 1.0, 0.0), c));
  b = cross(c, t);
}

float panel(vec3 d, vec3 c, vec2 halfSize, float soft) {
  float z = dot(d, c);
  if (z <= 0.05) return 0.0;
  vec3 t; vec3 b;
  frame(c, t, b);
  vec2 p = vec2(dot(d, t), dot(d, b)) / z;
  vec2 q = abs(p) - halfSize;
  float e = max(q.x, q.y);
  return 1.0 - smoothstep(-soft, soft, e);
}

// Radiance arriving from direction d. Rough surfaces see softer, dimmer panels.
vec3 env(vec3 d, float rough) {
  float s = 0.02 + rough * 0.9;
  float dim = 1.0 / (1.0 + rough * 5.0);
  float h = d.y;
  vec3 col = mix(vec3(0.022, 0.021, 0.02), vec3(0.06, 0.057, 0.053), smoothstep(-0.05, 0.6, h));
  col = mix(col, TABLE_ALBEDO * 0.5, smoothstep(0.03, -0.2, h));
  col += vec3(5.6, 5.4, 5.1) * dim * panel(d, KEY_DIR, vec2(0.62, 0.44), s);
  col += vec3(2.6, 2.7, 2.9) * dim * panel(d, STRIP_DIR, vec2(0.09, 0.55), s);
  col += vec3(0.55, 0.53, 0.5) * dim * panel(d, FILL_DIR, vec2(0.7, 0.55), s * 1.5);
  col += vec3(1.4, 1.38, 1.34) * dim * panel(d, TOP_DIR, vec2(0.22, 0.22), s);
  return col;
}

// Irradiance on a matte surface, with the key shadowed by 'shadow'.
vec3 diffuseLight(vec3 n, float shadow) {
  vec3 amb = mix(TABLE_ALBEDO * 0.16, vec3(0.13, 0.126, 0.12), n.y * 0.5 + 0.5);
  float key = max(dot(n, KEY_DIR) * 0.85 + 0.15, 0.0);
  float strip = max(dot(n, STRIP_DIR), 0.0);
  float fill = max(dot(n, FILL_DIR) * 0.7 + 0.3, 0.0);
  float top = max(dot(n, TOP_DIR), 0.0);
  return amb + vec3(1.55, 1.5, 1.43) * key * shadow + vec3(0.42, 0.43, 0.46) * strip + vec3(0.2) * fill + vec3(0.35) * top;
}

float schlick(float f0, float c) {
  return f0 + (1.0 - f0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0);
}

vec3 tonemap(vec3 x) {
  x *= 1.05;
  vec3 m = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  return pow(m, vec3(1.0 / 2.2));
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

// Soft shadow of an upright disc of radius rad and height ht standing on the receiver.
float discShadow(vec2 p, float rad, float ht) {
  vec2 o = -KEY_DIR.xz / KEY_DIR.y * ht;
  float d = segDist(p, vec2(0.0), o) - rad;
  float pen = 3.0 + 0.25 * ht;
  return smoothstep(-pen, pen, d);
}

// The dish's own wall shading its inside: march toward the key light to the rim.
float wallShadow(vec2 p, float h) {
  vec2 l = normalize(KEY_DIR.xz);
  float rise = KEY_DIR.y / length(KEY_DIR.xz);
  float b = dot(p, l);
  float c = dot(p, p) - ${DISH.rim.toFixed(1)} * ${DISH.rim.toFixed(1)};
  float s = -b + sqrt(max(b * b - c, 0.0));
  float clear = h + s * rise - ${DISH.height.toFixed(1)};
  return smoothstep(-2.5, 2.5, clear);
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
`;

const HEAD = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

// ------------------------------------------------------------ programs

const MESH_VS = /* glsl */ `${HEAD}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aAttr;
uniform mat4 uVP;
uniform mat4 uModel;
out vec3 vPos;
out vec3 vN;
out vec3 vAttr;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vPos = w.xyz;
  vN = mat3(uModel) * aNormal;
  vAttr = aAttr;
  gl_Position = uVP * w;
}
`;

// Materials by aAttr.x: 0 table, 1 copper winding, 2 phenolic, 3 aluminium,
// 4 glaze, 5 unglazed foot, 6 steel rule.
const MESH_FS = /* glsl */ `${HEAD}
${LIGHTS}
in vec3 vPos;
in vec3 vN;
in vec3 vAttr;
uniform vec3 uCam;
uniform sampler2D uRule;
uniform float uDishShadow;
out vec4 outColor;

void main() {
  int mat = int(vAttr.x + 0.5);
  vec3 n = normalize(vN);
  vec3 v = normalize(uCam - vPos);
  vec3 col;
  float r = length(vPos.xz);
  if (mat == 0) {
    float sh = discShadow(vPos.xz, ${FLANGE_R.toFixed(1)}, ${PLATE_TOP.toFixed(1)} + 24.0);
    float ao = 1.0 - 0.55 * exp(-max(0.0, r - ${FLANGE_R.toFixed(1)}) / 9.0);
    float grain = 0.92 + 0.08 * vnoise(vPos.xz * 0.015) + 0.05 * (vnoise(vPos.xz * 0.5) - 0.5);
    vec3 alb = TABLE_ALBEDO * grain;
    // A pool of light from the key, falling off across the bench.
    float pool = 0.35 + 0.65 * exp(-dot(vPos.xz - vec2(-40.0, -30.0), vPos.xz - vec2(-40.0, -30.0)) / (360.0 * 360.0));
    col = alb * diffuseLight(n, sh) * ao * pool;
    col += env(reflect(-v, n), 0.45) * schlick(0.035, dot(n, v)) * 0.7 * ao * pool;
    float dist = length(vPos.xz - vec2(0.0, 40.0));
    col = mix(col, BACKDROP, smoothstep(320.0, 950.0, dist));
  } else if (mat == 1) {
    // Enamelled copper wire wound round the drum: each turn a small cylinder.
    vec3 radial = normalize(vec3(vPos.x, 0.0, vPos.z));
    float turns = vPos.y / 0.9;
    // Fade the wire relief out as turns shrink below a couple of pixels, or it beats into moire.
    float px = fwidth(turns);
    float detail = 1.0 - smoothstep(0.25, 0.6, px);
    float t = fract(turns + 0.13 * hash(vec2(floor(turns), 0.0)));
    float a = (t - 0.5) * 2.4 * detail;
    vec3 nw = normalize(radial * cos(a) + vec3(0.0, sin(a), 0.0));
    float gap = mix(0.8, smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.88, t), detail);
    vec3 refl = env(reflect(-v, nw), 0.12);
    vec3 cu = vec3(0.95, 0.62, 0.48) * vec3(0.82, 0.5, 0.33);
    col = refl * cu * gap + refl * schlick(0.04, dot(nw, v)) * 0.6;
    col += cu * diffuseLight(nw, 1.0) * 0.06;
    col *= 0.45 + 0.55 * gap;
  } else if (mat == 2) {
    vec3 alb = vec3(0.045, 0.032, 0.024);
    col = alb * diffuseLight(n, 1.0) + env(reflect(-v, n), 0.25) * schlick(0.045, dot(n, v));
  } else if (mat == 3) {
    float sh = n.y > 0.5 ? mix(0.25, 1.0, discShadow(vPos.xz, 62.5, 24.0)) : 1.0;
    // Black anodized and turned: the lathe's rings show only in the reflection.
    float rings = 0.8 + 0.2 * sin(r * 9.0 + vnoise(vec2(r * 0.8, 0.0)) * 3.0);
    vec3 refl = env(reflect(-v, n), 0.22) * mix(0.35, 1.0, sh);
    col = refl * vec3(0.16, 0.165, 0.175) * rings;
    col += vec3(0.022, 0.022, 0.024) * diffuseLight(n, sh);
    if (n.y > 0.5) col *= 1.0 - 0.5 * exp(-max(0.0, r - 44.0) / 3.0) * step(r, 60.0) * uDishShadow;
  } else if (mat == 4 || mat == 5) {
    vec3 alb = mat == 4 ? vec3(0.86, 0.85, 0.82) : vec3(0.74, 0.72, 0.68);
    col = alb * diffuseLight(n, 1.0);
    if (mat == 4) col += env(reflect(-v, n), 0.04) * schlick(0.045, dot(n, v));
  } else {
    vec2 uv = vAttr.yz;
    vec4 mark = texture(uRule, uv);
    float brush = 0.93 + 0.07 * vnoise(vec2(uv.x * 900.0, uv.y * 8.0));
    vec3 refl = env(reflect(-v, n), 0.3);
    col = refl * vec3(0.72, 0.73, 0.74) * brush + vec3(0.05) * diffuseLight(n, 1.0);
    col = mix(col, vec3(0.02), mark.a * (n.y > 0.5 ? 1.0 : 0.0));
  }
  outColor = vec4(tonemap(col), 1.0);
}
`;

const FLUID_VS = /* glsl */ `${HEAD}
layout(location = 0) in vec2 aCell;
uniform sampler2D uH;
uniform mat4 uVP;
uniform vec4 uMag;
uniform float uCoil;
uniform float uMagK;
out vec3 vPos;
out vec3 vN;
out float vD;
out float vCav;
out float vSpike;
out vec3 vBedN;

const float DXC = ${DX.toFixed(4)};
const float HALF = ${(DOMAIN / 2).toFixed(1)};

float hAt(ivec2 c) {
  c = clamp(c, ivec2(0), ivec2(${N - 1}));
  return texelFetch(uH, c, 0).r;
}

float bedf(float r) {
  if (r <= ${DISH.floor.toFixed(1)}) return 0.0;
  float t = min(r - ${DISH.floor.toFixed(1)}, ${DISH.fillet.toFixed(1)});
  return ${DISH.fillet.toFixed(1)} - sqrt(${DISH.fillet.toFixed(1)} * ${DISH.fillet.toFixed(1)} - t * t);
}

void main() {
  ivec2 c = ivec2(aCell);
  vec2 hd = texelFetch(uH, c, 0).rg;
  float x = (aCell.x + 0.5) * DXC - HALF;
  float z = (aCell.y + 0.5) * DXC - HALF;
  float r = length(vec2(x, z));
  float h = hd.r;
  if (r > ${DISH.rim.toFixed(1)}) h = bedf(${DISH.rim.toFixed(1)});
  float hl = hAt(c - ivec2(1, 0));
  float hr = hAt(c + ivec2(1, 0));
  float hu = hAt(c - ivec2(0, 1));
  float hn = hAt(c + ivec2(0, 1));
  vec3 n = normalize(vec3(-(hr - hl) / (2.0 * DXC), 1.0, -(hn - hu) / (2.0 * DXC)));
  float blur = 0.25 * (hAt(c + ivec2(5, 0)) + hAt(c - ivec2(5, 0)) + hAt(c + ivec2(0, 5)) + hAt(c - ivec2(0, 5)));
  vCav = clamp((blur - h) / 3.5, 0.0, 1.0);
  float spike = max(0.0, h - bedf(r) - hd.g);
  vSpike = spike;
  // Spikes lean along the field lines: the hand magnet's field fans out from its axis.
  vec3 B = vec3(0.0, uCoil, 0.0);
  if (uMag.w > 0.002) {
    vec3 d = vec3(x - uMag.x, uMag.z, z - uMag.y);
    float r2 = dot(d, d);
    float f = uMagK / (r2 * sqrt(r2));
    float cc = 3.0 * d.y / r2;
    B += uMag.w * f * vec3(cc * d.x, 3.0 * d.y * d.y / r2 - 1.0, cc * d.z);
  }
  vec2 lean = B.xz / max(abs(B.y), 4.0) * spike * 0.32;
  lean = clamp(lean, vec2(-2.5), vec2(2.5));
  vec3 p = vec3(x + lean.x, ${FLOOR_Y.toFixed(1)} + h, z + lean.y);
  vPos = p;
  vN = n;
  vD = hd.g;
  // The porcelain's own normal, from the profile rather than the grid, so dry walls shade smoothly.
  float t = clamp(r - ${DISH.floor.toFixed(1)}, 0.0, ${(DISH.fillet - 0.01).toFixed(2)});
  float slope = r > ${DISH.floor.toFixed(1)} ? t / sqrt(${DISH.fillet.toFixed(1)} * ${DISH.fillet.toFixed(1)} - t * t) : 0.0;
  vec2 radial = r > 0.001 ? vec2(x, z) / r : vec2(0.0);
  vBedN = normalize(vec3(-slope * radial.x, 1.0, -slope * radial.y));
  gl_Position = uVP * vec4(p, 1.0);
}
`;

const FLUID_FS = /* glsl */ `${HEAD}
${LIGHTS}
in vec3 vPos;
in vec3 vN;
in float vD;
in float vCav;
in float vSpike;
in vec3 vBedN;
uniform vec3 uCam;
out vec4 outColor;
void main() {
  float r = length(vPos.xz);
  if (r > ${(INNER_R + 0.15).toFixed(2)}) discard;
  vec3 n = normalize(vN);
  vec3 v = normalize(uCam - vPos);
  // Porcelain glaze where the dish is dry, with the brown stain a thin film of ferrofluid leaves.
  vec3 glaze = vec3(0.86, 0.85, 0.82);
  float sh = wallShadow(vPos.xz, vPos.y - ${FLOOR_Y.toFixed(1)});
  float wet = smoothstep(0.05, 0.35, vD + vSpike);
  vec3 bn = normalize(mix(normalize(vBedN), n, smoothstep(0.0, 0.3, vD)));
  vec3 porc = glaze * diffuseLight(bn, mix(0.45, 1.0, sh)) + env(reflect(-v, bn), 0.04) * schlick(0.045, dot(bn, v));
  float film = smoothstep(0.012, 0.07, vD);
  porc *= mix(vec3(1.0), vec3(0.5, 0.37, 0.27), film);
  // Ferrofluid: a black, glossy oil.
  float F = schlick(0.05, dot(n, v));
  float occ = 1.0 - 0.75 * vCav;
  vec3 refl = env(reflect(-v, n), 0.035) * occ;
  vec3 ff = refl * F + diffuseLight(n, 1.0) * vec3(0.012, 0.0105, 0.009);
  vec3 col = mix(porc, ff, wet);
  outColor = vec4(tonemap(col), 1.0);
}
`;

const BACK_VS = /* glsl */ `${HEAD}
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vUv = P[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(P[gl_VertexID], 0.999, 1.0);
}
`;

const BACK_FS = /* glsl */ `${HEAD}
${LIGHTS}
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 q = vUv - vec2(0.45, 0.55);
  vec3 col = BACKDROP * (1.0 - 0.35 * dot(q, q));
  outColor = vec4(tonemap(col), 1.0);
}
`;

// ------------------------------------------------------------ geometry

interface Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
  type: number;
}

function meshFrom(gl: WebGL2RenderingContext, pos: number[], nor: number[], attr: number[], idx: number[]): Mesh {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const put = (loc: number, data: number[]) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  };
  put(0, pos);
  put(1, nor);
  put(2, attr);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  const big = pos.length / 3 > 65535;
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(idx) : new Uint16Array(idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: idx.length, type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
}

/** A surface of revolution from a polyline profile [r, y], one material per polyline. */
function lathe(
  profile: [number, number][],
  mat: number,
  segs: number,
  out: { pos: number[]; nor: number[]; attr: number[]; idx: number[] },
) {
  const base = out.pos.length / 3;
  // Per-vertex profile normals, averaged between neighbouring edges.
  const pn: [number, number][] = profile.map((_, i) => {
    const a = profile[Math.max(0, i - 1)];
    const b = profile[Math.min(profile.length - 1, i + 1)];
    const dr = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  });
  for (let s = 0; s <= segs; s++) {
    const t = (s / segs) * Math.PI * 2;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    profile.forEach(([r, y], i) => {
      out.pos.push(r * c, y, r * sn);
      out.nor.push(pn[i][0] * c, pn[i][1], pn[i][0] * sn);
      out.attr.push(mat, 0, 0);
    });
  }
  const m = profile.length;
  for (let s = 0; s < segs; s++) {
    for (let i = 0; i < m - 1; i++) {
      const a = base + s * m + i;
      const b = base + (s + 1) * m + i;
      out.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}

function box(
  out: { pos: number[]; nor: number[]; attr: number[]; idx: number[] },
  w: number,
  h: number,
  d: number,
  mat: number,
) {
  const faces: [number[], number[]][] = [
    [
      [0, 1, 0],
      [-w, h, -d, w, h, -d, w, h, d, -w, h, d],
    ],
    [
      [0, 0, 1],
      [-w, 0, d, w, 0, d, w, h, d, -w, h, d],
    ],
    [
      [0, 0, -1],
      [w, 0, -d, -w, 0, -d, -w, h, -d, w, h, -d],
    ],
    [
      [1, 0, 0],
      [w, 0, d, w, 0, -d, w, h, -d, w, h, d],
    ],
    [
      [-1, 0, 0],
      [-w, 0, -d, -w, 0, d, -w, h, d, -w, h, -d],
    ],
  ];
  for (const [n, q] of faces) {
    const base = out.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      out.pos.push(q[k * 3], q[k * 3 + 1], q[k * 3 + 2]);
      out.nor.push(n[0], n[1], n[2]);
      const u = (q[k * 3] + w) / (2 * w);
      const v = (q[k * 3 + 2] + d) / (2 * d);
      out.attr.push(mat, u, v);
    }
    out.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}

function ruleTexture(): HTMLCanvasElement {
  // A 300 mm steel rule, millimetre ticks, centimetre figures.
  const c = document.createElement('canvas');
  c.width = 4096;
  c.height = 340;
  const g = c.getContext('2d')!;
  const px = c.width / 300;
  g.fillStyle = '#000';
  for (let mm = 0; mm <= 300; mm++) {
    const x = 18 + mm * px * (1 - 36 / c.width);
    const len = mm % 10 === 0 ? 120 : mm % 5 === 0 ? 82 : 52;
    g.fillRect(x - 2.4, 0, 4.8, len);
    if (mm % 10 === 0 && mm > 0 && mm < 300) {
      g.font = '600 74px "Sofia Sans Condensed", Arial Narrow, sans-serif';
      g.textAlign = 'center';
      g.fillText(String(mm / 10), x, 210);
    }
  }
  g.font = '500 44px "Sofia Sans Condensed", Arial Narrow, sans-serif';
  g.textAlign = 'left';
  g.fillText('STAINLESS  ·  mm', 40, 300);
  return c;
}

// ------------------------------------------------------------ renderer

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      throw new Error('shader compile failed');
    }
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    throw new Error('program link failed');
  }
  return p;
}

export interface View {
  target: [number, number, number];
  /** Elevation and azimuth in radians, distance in mm, vertical field of view in radians. */
  el: number;
  az: number;
  dist: number;
  fov: number;
}

export class Bench {
  readonly gl: WebGL2RenderingContext;
  private meshProg: WebGLProgram;
  private fluidProg: WebGLProgram;
  private backProg: WebGLProgram;
  private scene: Mesh;
  private fluid: { vao: WebGLVertexArrayObject; count: number };
  private heights: WebGLTexture;
  private rule: WebGLTexture;
  private ruleModel: Float32Array;
  private ruleMesh: Mesh;
  readonly vp = new Float32Array(16);
  readonly cam = new Float32Array(3);
  private u: Record<string, WebGLUniformLocation | null> = {};
  magnet = { x: 0, y: 0, depth: 46, lift: 0 };
  coil = 0;
  magK = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    this.meshProg = compile(gl, MESH_VS, MESH_FS);
    this.fluidProg = compile(gl, FLUID_VS, FLUID_FS);
    this.backProg = compile(gl, BACK_VS, BACK_FS);
    for (const [prog, names] of [
      [this.meshProg, ['uVP', 'uModel', 'uCam', 'uRule', 'uDishShadow']],
      [this.fluidProg, ['uVP', 'uCam', 'uH', 'uMag', 'uCoil', 'uMagK']],
    ] as const) {
      for (const n of names) this.u[(prog === this.meshProg ? 'm.' : 'f.') + n] = gl.getUniformLocation(prog, n);
    }

    // Static scene: table, magnet, dish exterior.
    const g = { pos: [] as number[], nor: [] as number[], attr: [] as number[], idx: [] as number[] };
    {
      const S = 2400;
      const base = 0;
      g.pos.push(-S, 0, -S, S, 0, -S, S, 0, S, -S, 0, S);
      g.nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      g.attr.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      g.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const seg = 160;
    lathe(
      [
        [FLANGE_R, 0],
        [FLANGE_R, 5],
      ],
      2,
      seg,
      g,
    );
    lathe(
      [
        [FLANGE_R, 5],
        [COIL_R, 5],
      ],
      2,
      seg,
      g,
    );
    lathe(
      [
        [COIL_R, 5],
        [COIL_R, 35],
      ],
      1,
      seg,
      g,
    );
    lathe(
      [
        [COIL_R, 35],
        [FLANGE_R, 35],
      ],
      2,
      seg,
      g,
    );
    lathe(
      [
        [FLANGE_R, 35],
        [FLANGE_R + 0.6, 35.6],
        [FLANGE_R + 0.6, 39.4],
        [FLANGE_R, 40],
      ],
      2,
      seg,
      g,
    );
    lathe(
      [
        [FLANGE_R, 40],
        [PLATE_R, 40],
      ],
      2,
      seg,
      g,
    );
    lathe(
      [
        [PLATE_R, 40],
        [PLATE_R + 0.3, 40.5],
        [PLATE_R + 0.3, 42.5],
        [PLATE_R, 43],
      ],
      3,
      seg,
      g,
    );
    lathe(
      [
        [PLATE_R, PLATE_TOP],
        [0.01, PLATE_TOP],
      ],
      3,
      seg,
      g,
    );
    // The dish: lip, outer wall, foot. y relative to its floor, which sits 4 mm above the plate.
    const f = FLOOR_Y;
    // The steep top of the inner fillet is turned here too: on the fluid's half-millimetre grid
    // it would show as a sawtooth. The pool never climbs this high.
    const fillet: [number, number][] = [];
    for (let k = 0; k <= 14; k++) {
      const th = INNER_FROM + ((Math.PI / 2 - INNER_FROM) * k) / 14;
      fillet.push([DISH.floor + DISH.fillet * Math.sin(th), DISH.fillet - DISH.fillet * Math.cos(th)]);
    }
    const lip: [number, number][] = [
      ...fillet,
      [58.4, 18.6],
      [59.5, 19.6],
      [60.8, 20.0],
      [61.9, 19.6],
      [62.5, 18.6],
      [62.4, 17],
      [61.6, 12.5],
      [60.1, 8],
      [57.6, 4],
      [53.8, 0.8],
      [49.5, -1.6],
      [46, -2.9],
    ].map(([r, y]) => [r, y + f]);
    // Walked from the foot up and over the lip, so the profile normals face out.
    lathe(lip.reverse(), 4, seg, g);
    lathe(
      [
        [44.4, -4 + f],
        [45, -3.5 + f],
        [46, -2.9 + f],
      ],
      5,
      seg,
      g,
    );
    this.scene = meshFrom(gl, g.pos, g.nor, g.attr, g.idx);

    const rg = { pos: [] as number[], nor: [] as number[], attr: [] as number[], idx: [] as number[] };
    box(rg, 150, 1.2, 12.5, 6);
    this.ruleMesh = meshFrom(gl, rg.pos, rg.nor, rg.attr, rg.idx);
    const a = -0.14;
    this.ruleModel = new Float32Array([
      Math.cos(a),
      0,
      -Math.sin(a),
      0,
      0,
      1,
      0,
      0,
      Math.sin(a),
      0,
      Math.cos(a),
      0,
      30,
      0,
      130,
      1,
    ]);

    // Fluid grid.
    {
      const cells = new Float32Array(N * N * 2);
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          cells[(j * N + i) * 2] = i;
          cells[(j * N + i) * 2 + 1] = j;
        }
      const idx = new Uint16Array((N - 1) * (N - 1) * 6);
      let k = 0;
      for (let j = 0; j < N - 1; j++)
        for (let i = 0; i < N - 1; i++) {
          const a0 = j * N + i;
          idx[k++] = a0;
          idx[k++] = a0 + N;
          idx[k++] = a0 + 1;
          idx[k++] = a0 + 1;
          idx[k++] = a0 + N;
          idx[k++] = a0 + N + 1;
        }
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, cells, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      this.fluid = { vao, count: idx.length };
    }

    this.heights = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.heights);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const flat = new Float32Array(N * N * 2);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const r = Math.hypot((i + 0.5) * DX - DOMAIN / 2, (j + 0.5) * DX - DOMAIN / 2);
        const b = bed(Math.min(r, DISH.rim));
        const d = Math.max(0, 4.5 - b);
        flat[(j * N + i) * 2] = b + d;
        flat[(j * N + i) * 2 + 1] = d;
      }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, N, N, 0, gl.RG, gl.FLOAT, flat);

    this.rule = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.rule);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ruleTexture());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  }

  upload(data: Float32Array) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.heights);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RG, gl.FLOAT, data);
  }

  /** Recompute the camera from a view and the canvas aspect. */
  setView(v: View, aspect: number) {
    const [tx, ty, tz] = v.target;
    const ce = Math.cos(v.el);
    const ex = tx + v.dist * ce * Math.sin(v.az);
    const ey = ty + v.dist * Math.sin(v.el);
    const ez = tz + v.dist * ce * Math.cos(v.az);
    this.cam[0] = ex;
    this.cam[1] = ey;
    this.cam[2] = ez;
    lookPerspective(this.vp, [ex, ey, ez], v.target, v.fov, aspect, 20, 6000);
  }

  draw(width: number, height: number) {
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.016, 0.0155, 0.015, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.backProg);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);

    gl.useProgram(this.meshProg);
    gl.uniformMatrix4fv(this.u['m.uVP'], false, this.vp);
    gl.uniform3fv(this.u['m.uCam'], this.cam);
    gl.uniform1f(this.u['m.uDishShadow'], 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rule);
    gl.uniform1i(this.u['m.uRule'], 1);
    gl.uniformMatrix4fv(this.u['m.uModel'], false, IDENTITY);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.scene.vao);
    gl.drawElements(gl.TRIANGLES, this.scene.count, this.scene.type, 0);
    gl.uniformMatrix4fv(this.u['m.uModel'], false, this.ruleModel);
    gl.bindVertexArray(this.ruleMesh.vao);
    gl.drawElements(gl.TRIANGLES, this.ruleMesh.count, this.ruleMesh.type, 0);

    gl.useProgram(this.fluidProg);
    gl.uniformMatrix4fv(this.u['f.uVP'], false, this.vp);
    gl.uniform3fv(this.u['f.uCam'], this.cam);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heights);
    gl.uniform1i(this.u['f.uH'], 0);
    gl.uniform4f(this.u['f.uMag'], this.magnet.x, this.magnet.y, this.magnet.depth, this.magnet.lift);
    gl.uniform1f(this.u['f.uCoil'], this.coil);
    gl.uniform1f(this.u['f.uMagK'], this.magK);
    gl.bindVertexArray(this.fluid.vao);
    gl.drawElements(gl.TRIANGLES, this.fluid.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  /** World point to CSS pixels, or null behind the camera. */
  project(x: number, y: number, z: number, w: number, h: number): [number, number] | null {
    const m = this.vp;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0) return null;
    return [((cx / cw) * 0.5 + 0.5) * w, (1 - ((cy / cw) * 0.5 + 0.5)) * h];
  }

  /** Where a ray through CSS pixel (px, py) meets the plane y = planeY, as [x, z]. */
  pick(px: number, py: number, w: number, h: number, planeY: number): [number, number] | null {
    const inv = invert(this.vp);
    if (!inv) return null;
    const nx = (px / w) * 2 - 1;
    const ny = 1 - (py / h) * 2;
    const a = mulPoint(inv, nx, ny, -1);
    const b = mulPoint(inv, nx, ny, 1);
    const dy = b[1] - a[1];
    if (Math.abs(dy) < 1e-9) return null;
    const t = (planeY - a[1]) / dy;
    if (t < 0) return null;
    return [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t];
  }
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function lookPerspective(
  out: Float32Array,
  eye: number[],
  target: number[],
  fov: number,
  aspect: number,
  near: number,
  far: number,
) {
  let fx = target[0] - eye[0];
  let fy = target[1] - eye[1];
  let fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // Up is +y unless looking straight down, then -z.
  let ux = 0;
  let uy = 1;
  let uz = 0;
  if (Math.abs(fy) > 0.999) {
    uy = 0;
    uz = -1;
  }
  let sx = fy * uz - fz * uy;
  let sy = fz * ux - fx * uz;
  let sz = fx * uy - fy * ux;
  const sl = Math.hypot(sx, sy, sz);
  sx /= sl;
  sy /= sl;
  sz /= sl;
  ux = sy * fz - sz * fy;
  uy = sz * fx - sx * fz;
  uz = sx * fy - sy * fx;
  const view = [
    sx,
    ux,
    -fx,
    0,
    sy,
    uy,
    -fy,
    0,
    sz,
    uz,
    -fz,
    0,
    -(sx * eye[0] + sy * eye[1] + sz * eye[2]),
    -(ux * eye[0] + uy * eye[1] + uz * eye[2]),
    fx * eye[0] + fy * eye[1] + fz * eye[2],
    1,
  ];
  const f = 1 / Math.tan(fov / 2);
  const proj = [
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
  ];
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += proj[k * 4 + r] * view[c * 4 + k];
      out[c * 4 + r] = s;
    }
}

function mulPoint(m: Float64Array, x: number, y: number, z: number): [number, number, number] {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

function invert(a: Float32Array): Float64Array | null {
  const m = Float64Array.from(a);
  const inv = new Float64Array(16);
  inv[0] =
    m[5] * m[10] * m[15] -
    m[5] * m[11] * m[14] -
    m[9] * m[6] * m[15] +
    m[9] * m[7] * m[14] +
    m[13] * m[6] * m[11] -
    m[13] * m[7] * m[10];
  inv[4] =
    -m[4] * m[10] * m[15] +
    m[4] * m[11] * m[14] +
    m[8] * m[6] * m[15] -
    m[8] * m[7] * m[14] -
    m[12] * m[6] * m[11] +
    m[12] * m[7] * m[10];
  inv[8] =
    m[4] * m[9] * m[15] -
    m[4] * m[11] * m[13] -
    m[8] * m[5] * m[15] +
    m[8] * m[7] * m[13] +
    m[12] * m[5] * m[11] -
    m[12] * m[7] * m[9];
  inv[12] =
    -m[4] * m[9] * m[14] +
    m[4] * m[10] * m[13] +
    m[8] * m[5] * m[14] -
    m[8] * m[6] * m[13] -
    m[12] * m[5] * m[10] +
    m[12] * m[6] * m[9];
  inv[1] =
    -m[1] * m[10] * m[15] +
    m[1] * m[11] * m[14] +
    m[9] * m[2] * m[15] -
    m[9] * m[3] * m[14] -
    m[13] * m[2] * m[11] +
    m[13] * m[3] * m[10];
  inv[5] =
    m[0] * m[10] * m[15] -
    m[0] * m[11] * m[14] -
    m[8] * m[2] * m[15] +
    m[8] * m[3] * m[14] +
    m[12] * m[2] * m[11] -
    m[12] * m[3] * m[10];
  inv[9] =
    -m[0] * m[9] * m[15] +
    m[0] * m[11] * m[13] +
    m[8] * m[1] * m[15] -
    m[8] * m[3] * m[13] -
    m[12] * m[1] * m[11] +
    m[12] * m[3] * m[9];
  inv[13] =
    m[0] * m[9] * m[14] -
    m[0] * m[10] * m[13] -
    m[8] * m[1] * m[14] +
    m[8] * m[2] * m[13] +
    m[12] * m[1] * m[10] -
    m[12] * m[2] * m[9];
  inv[2] =
    m[1] * m[6] * m[15] -
    m[1] * m[7] * m[14] -
    m[5] * m[2] * m[15] +
    m[5] * m[3] * m[14] +
    m[13] * m[2] * m[7] -
    m[13] * m[3] * m[6];
  inv[6] =
    -m[0] * m[6] * m[15] +
    m[0] * m[7] * m[14] +
    m[4] * m[2] * m[15] -
    m[4] * m[3] * m[14] -
    m[12] * m[2] * m[7] +
    m[12] * m[3] * m[6];
  inv[10] =
    m[0] * m[5] * m[15] -
    m[0] * m[7] * m[13] -
    m[4] * m[1] * m[15] +
    m[4] * m[3] * m[13] +
    m[12] * m[1] * m[7] -
    m[12] * m[3] * m[5];
  inv[14] =
    -m[0] * m[5] * m[14] +
    m[0] * m[6] * m[13] +
    m[4] * m[1] * m[14] -
    m[4] * m[2] * m[13] -
    m[12] * m[1] * m[6] +
    m[12] * m[2] * m[5];
  inv[3] =
    -m[1] * m[6] * m[11] +
    m[1] * m[7] * m[10] +
    m[5] * m[2] * m[11] -
    m[5] * m[3] * m[10] -
    m[9] * m[2] * m[7] +
    m[9] * m[3] * m[6];
  inv[7] =
    m[0] * m[6] * m[11] -
    m[0] * m[7] * m[10] -
    m[4] * m[2] * m[11] +
    m[4] * m[3] * m[10] +
    m[8] * m[2] * m[7] -
    m[8] * m[3] * m[6];
  inv[11] =
    -m[0] * m[5] * m[11] +
    m[0] * m[7] * m[9] +
    m[4] * m[1] * m[11] -
    m[4] * m[3] * m[9] -
    m[8] * m[1] * m[7] +
    m[8] * m[3] * m[5];
  inv[15] =
    m[0] * m[5] * m[10] -
    m[0] * m[6] * m[9] -
    m[4] * m[1] * m[10] +
    m[4] * m[2] * m[9] +
    m[8] * m[1] * m[6] -
    m[8] * m[2] * m[5];
  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (Math.abs(det) < 1e-12) return null;
  det = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}
