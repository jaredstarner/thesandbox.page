// The table, drawn by ray marching in one fragment pass, then a bloom and a
// tone curve. The pumpkin is the radial shell from _shape.ts: a ray steps in
// fast while it is outside the skin, in small steps through anything carved
// away, and in long ones across the hollow inside, then bisects onto whatever
// it hits. Carving is a texture of depth below the skin, so a cut, a gouge,
// and a scrape are the same thing at different depths.
//
// With the lamp out, the only light is the candle. Skin and flesh pass it on
// in proportion to how much wall is left (per channel, so thick wall glows
// red and thin wall yellow), and the table and wall behind are lit by tracing
// back to the flame and asking how much wall is in the way where the ray
// leaves the pumpkin. That is where the face on the table comes from.

import { GLSL_SHAPE } from './_shape';

export interface Frame {
  time: number;
  camPos: number[];
  camRight: number[];
  camUp: number[];
  camFwd: number[];
  tanHalf: number;
  center: number[];
  yaw: number;
  hasLid: boolean;
  lidOffset: number[];
  lidCone: [number, number];
  lidSphere: [number, number];
  lamp: number;
  candle: number;
  flame: number[];
  floorY: number;
  stemBaseY: number;
  rMax: number;
  exposure: number;
}

export interface Look {
  a: number;
  b: number;
  boxy: number;
  ribs: number;
  ribDepth: number;
  ribSharp: number;
  dimpleTop: number;
  dimpleBottom: number;
  wall: number;
  rind: number;
  seed: number;
  skin: number[];
  groove: number[];
  ground: number[];
  flesh: number[];
  fleshSigma: number[];
  rindSigma: number[];
  stem: number[];
  stemColor: number[];
  white: boolean;
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const SCENE = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;

uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd;
uniform float uTanHalf;
uniform vec3 uCenter;
uniform vec2 uYaw;
uniform float uHasLid;
uniform vec3 uLidOffset;
uniform vec2 uLidCone;
uniform vec2 uLidSphere;
uniform float uLamp, uCandle;
uniform vec3 uFlame;
uniform float uFloorY, uStemBaseY, uRMax;
uniform float uRind, uWhite;
uniform vec3 uSkin, uGroove, uGround, uFlesh, uStemColor, uFleshSigma, uRindSigma;
uniform vec4 uStem;

${GLSL_SHAPE}

const float WALL_Z = -34.0;
const float TABLE_FRONT = 70.0;
const int M_NONE = 0, M_SKIN = 1, M_CUT = 2, M_INNER = 3, M_STEM = 4, M_TABLE = 5, M_WALL = 6, M_CUP = 7, M_WAX = 8;
const vec3 LAMP = vec3(-34.0, 82.0, 52.0);
const vec3 MOON = vec3(-0.55, 0.42, -0.72);

// ---- noise -------------------------------------------------------------
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y);
  float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.02 + 13.7; a *= 0.5; }
  return s;
}
float fbm3o(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 5.3; a *= 0.5; }
  return s / 0.875;
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise3(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return s;
}

// ---- frames ------------------------------------------------------------
vec3 toLocal(vec3 v) { return vec3(uYaw.x * v.x - uYaw.y * v.z, v.y, uYaw.y * v.x + uYaw.x * v.z); }
vec3 toWorld(vec3 v) { return vec3(uYaw.x * v.x + uYaw.y * v.z, v.y, -uYaw.y * v.x + uYaw.x * v.z); }

vec2 sphereHit(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

// ---- the shell ---------------------------------------------------------
struct Shell { float rho; float r; float rin; float D; float lid; float theta; float phi; };

Shell shellAt(vec3 q, float lod) {
  Shell s;
  s.rho = length(q);
  vec3 d = q / max(s.rho, 1e-4);
  vec3 o = outerRadius(d);
  s.r = o.x;
  s.theta = o.y;
  s.phi = o.z;
  s.rin = s.r - wallAt(o.y);
  vec2 t = textureLod(uDepth, depthUv(o.y, o.z), lod).rg;
  s.D = t.r * DEPTH_MAX;
  s.lid = t.g;
  return s;
}

bool keeps(Shell s, bool lidObj) { return lidObj ? s.lid > 0.5 : s.lid <= 0.5; }

bool solidAt(vec3 q, bool lidObj) {
  Shell s = shellAt(q, 0.0);
  return keeps(s, lidObj) && s.rho < s.r - s.D && s.rho > s.rin;
}

// Positive outside the material; its gradient is the surface normal, cut walls included.
float field(vec3 q, bool lidObj) {
  Shell s = shellAt(q, 0.0);
  float f = max(s.rho - (s.r - s.D), s.rin - s.rho);
  float m = lidObj ? 0.5 - s.lid : s.lid - 0.5;
  return max(f, m * 0.12);
}

vec3 fieldNormal(vec3 q, bool lidObj) {
  // A little over a texel apart, so steep carved edges don't show the texel grid.
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.07;
  return normalize(
    k.xyy * field(q + k.xyy * h, lidObj) + k.yyx * field(q + k.yyx * h, lidObj) +
    k.yxy * field(q + k.yxy * h, lidObj) + k.xxx * field(q + k.xxx * h, lidObj));
}

// March through one object's shell between t0 and t1; returns the hit distance or -1.
float marchShell(vec3 ro, vec3 rd, float t0, float t1, bool lidObj) {
  float t = max(t0, 0.0);
  float tPrev = t;
  for (int i = 0; i < 200; i++) {
    if (t > t1) break;
    vec3 q = ro + rd * t;
    Shell s = shellAt(q, 0.0);
    float stepLen = 0.06;
    if (s.rho > s.r) {
      stepLen = (s.rho - s.r) * 0.7 + 0.008;
    } else if (s.rho < s.rin) {
      stepLen = max((s.rin - s.rho) * 0.6, 0.05);
    } else if (keeps(s, lidObj)) {
      if (s.rho < s.r - s.D) {
        float a = tPrev, b = t;
        for (int k = 0; k < 8; k++) {
          float m = 0.5 * (a + b);
          if (solidAt(ro + rd * m, lidObj)) b = m; else a = m;
        }
        return b;
      }
    } else if (uLidCone.y > 0.0) {
      // Inside the other object's part of the shell: skip across the lid's cone.
      float gap = lidObj ? s.theta - uLidCone.y : uLidCone.x - s.theta;
      stepLen = max(stepLen, s.rho * gap * 0.8);
    }
    tPrev = t;
    t += stepLen;
  }
  return -1.0;
}

// ---- the stem ----------------------------------------------------------
float sdStem(vec3 q) {
  float L = uStem.x, R = uStem.y, bend = uStem.z, lean = uStem.w;
  float h = clamp((q.y - uStemBaseY) / L, 0.0, 1.0);
  vec3 axis = vec3(lean * L * h + bend * h * h, uStemBaseY + L * h, 0.35 * bend * h * h);
  vec3 dq = q - axis;
  float ang = atan(dq.z, dq.x);
  float rad = R * (1.0 - 0.2 * h) * (1.0 + 0.075 * cos(7.0 * ang + h * 2.0 + 0.6 * sin(5.0 * ang))) + R * 0.85 * exp(-h * 8.0);
  float dRad = length(dq.xz) - rad;
  float dTop = q.y - (uStemBaseY + L - 0.15 * cos(2.0 * ang + 1.0));
  float dBot = (uStemBaseY - 1.5) - q.y;
  return max(max(dRad * 0.55, dTop), dBot);
}

float marchStem(vec3 ro, vec3 rd) {
  vec3 c = vec3(uStem.w * uStem.x * 0.5, uStemBaseY + uStem.x * 0.5, 0.0);
  vec2 b = sphereHit(ro, rd, c, uStem.x * 0.75 + uStem.y * 2.6 + abs(uStem.z));
  if (b.y < 0.0) return -1.0;
  float t = max(b.x, 0.0);
  for (int i = 0; i < 90; i++) {
    float d = sdStem(ro + rd * t);
    if (d < 0.004) return t;
    t += d;
    if (t > b.y) break;
  }
  return -1.0;
}

vec3 stemNormal(vec3 q) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.02;
  return normalize(k.xyy * sdStem(q + k.xyy * h) + k.yyx * sdStem(q + k.yyx * h) + k.yxy * sdStem(q + k.yxy * h) + k.xxx * sdStem(q + k.xxx * h));
}

// ---- the candle: a tea light on the floor of the hollow ------------------
const float CUP_R = 1.95;
const float CUP_H = 1.55;

// Hit with a capped cylinder in body coordinates: x = distance, y = 1 side, 2 top.
vec2 cupHit(vec3 ro, vec3 rd) {
  vec3 o = ro - vec3(0.0, uFloorY, 0.0);
  float a = dot(rd.xz, rd.xz);
  float b = dot(o.xz, rd.xz);
  float c = dot(o.xz, o.xz) - CUP_R * CUP_R;
  float best = 1e9;
  float kind = 0.0;
  float h = b * b - a * c;
  if (h > 0.0 && a > 1e-6) {
    float t = (-b - sqrt(h)) / a;
    float y = o.y + rd.y * t;
    if (t > 0.0 && y > 0.0 && y < CUP_H) { best = t; kind = 1.0; }
  }
  if (abs(rd.y) > 1e-5) {
    float t = (CUP_H - o.y) / rd.y;
    vec3 p = o + rd * t;
    if (t > 0.0 && t < best && dot(p.xz, p.xz) < CUP_R * CUP_R) { best = t; kind = 2.0; }
  }
  return vec2(best, kind);
}

// ---- light through the wall ---------------------------------------------
vec3 transmit(float D, float wall) {
  if (D >= wall - 0.02) return vec3(1.0);
  float rindLeft = max(uRind - D, 0.0);
  float fleshLeft = wall - max(D, uRind);
  return exp(-uRindSigma * rindLeft - uFleshSigma * fleshLeft);
}

// Light the candle puts through the wall at a direction. Light spreads a few millimetres
// sideways in the flesh, so the depth is softened a little before it is used.
vec3 glowAt(float theta, float phi, float D) {
  float wall = wallAt(theta);
  float soft = textureLod(uDepth, depthUv(theta, phi), 2.5).r * DEPTH_MAX;
  return transmit(min(mix(D, soft, 0.35), max(D, wall - 0.05)), wall);
}

// Candle irradiance at a point in body coordinates (no shadowing).
vec3 candleAt(vec3 q, vec3 n) {
  vec3 L = uFlame - q;
  float d2 = dot(L, L);
  float ndl = max(dot(n, L * inversesqrt(d2)), 0.0);
  return vec3(1.0, 0.62, 0.28) * 260.0 * uCandle * ndl / (d2 + 4.0);
}

// How much of the candle reaches a point outside the pumpkin (world space).
vec3 candleThrough(vec3 x, vec3 n) {
  if (uCandle <= 0.0) return vec3(0.0);
  vec3 q = toLocal(x - uCenter);
  vec3 dir = q - uFlame;
  float dist = length(dir);
  dir /= dist;
  // Bisect for where the ray from the flame crosses the middle of the wall.
  float a = 0.0, b = min(dist, uRMax * 2.2);
  for (int i = 0; i < 11; i++) {
    float m = 0.5 * (a + b);
    vec3 p = uFlame + dir * m;
    float rho = length(p);
    vec3 o = outerRadius(p / rho);
    if (rho > o.x - wallAt(o.y) * 0.5) b = m; else a = m;
  }
  vec3 p = uFlame + dir * b;
  vec3 o = outerRadius(normalize(p));
  float near = b;
  float far = dist - b;
  // Penumbra from a flame about a centimetre and a half across, as a mip level at the crossing.
  float width = 1.5 * far / (near + far);
  float lod = clamp(log2(width / 0.05), 0.0, 7.0);
  vec2 t = textureLod(uDepth, depthUv(o.y, o.z), lod).rg;
  float wall = wallAt(o.y);
  vec3 T = transmit(t.r * DEPTH_MAX, wall);
  if (uHasLid > 0.5 && length(uLidOffset) > 0.01) {
    // The lid is off: everything under it is open.
    T = mix(T, vec3(1.0), smoothstep(0.4, 0.6, t.g));
  } else if (uHasLid > 0.5) {
    // The lid sits on its rim and closes the cut round it. The mask is read blurred
    // well past the width of the cut, so both halves of the cut count as closed.
    float g = textureLod(uDepth, depthUv(o.y, o.z), max(lod, 4.5)).g;
    T *= 1.0 - smoothstep(0.01, 0.12, 1.0 - abs(2.0 * g - 1.0));
  }
  vec3 Lw = toWorld(-dir);
  float ndl = max(dot(n, Lw), 0.0);
  return vec3(1.0, 0.6, 0.26) * 260.0 * uCandle * T * ndl / (dist * dist + 4.0);
}

// The pumpkin as a glowing body: every hole shows the lit hollow, and thin wall glows.
// Twelve points on the side facing x stand in for the whole surface.
vec3 pumpkinGlow(vec3 x, vec3 n) {
  if (uCandle <= 0.0) return vec3(0.0);
  vec3 q = toLocal(x - uCenter);
  vec3 nL = toLocal(n);
  vec3 axis = normalize(q);
  vec3 t1 = normalize(cross(abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), axis));
  vec3 t2 = cross(axis, t1);
  vec3 sum = vec3(0.0);
  vec3 hollow = uFlesh * vec3(1.0, 0.6, 0.26) * 5.0;
  const int K = 12;
  for (int k = 0; k < K; k++) {
    float fk = float(k);
    float rr = sqrt((fk + 0.5) / float(K)) * 1.6;
    float a = fk * 2.39996;
    vec3 d = normalize(axis + t1 * cos(a) * rr + t2 * sin(a) * rr);
    vec3 o = outerRadius(d);
    // Blurred well past a sample's spacing, so a thin cut never flickers in and out between samples.
    vec2 dl = textureLod(uDepth, depthUv(o.y, o.z), 5.0).rg;
    float wall = wallAt(o.y);
    float D = dl.r * DEPTH_MAX;
    float hole = smoothstep(wall * 0.3, wall, D);
    vec3 Ein = candleAt(d * (o.x - wall), -d);
    vec3 L = mix(Ein * transmit(D, wall) * uFlesh, hollow, hole);
    if (uHasLid > 0.5 && length(uLidOffset) > 0.01) L = mix(L, hollow, smoothstep(0.4, 0.6, dl.g));
    else if (uHasLid > 0.5) L *= 1.0 - smoothstep(0.01, 0.12, 1.0 - abs(2.0 * dl.g - 1.0));
    vec3 p = d * o.x;
    vec3 toX = q - p;
    float dist2 = dot(toX, toX);
    toX *= inversesqrt(dist2);
    float cs = max(dot(d, toX), 0.0);
    float cx = max(dot(nL, -toX), 0.0);
    sum += L * cs * cx / (dist2 + 25.0);
  }
  // Each sample stands for about a twelfth of the side of the pumpkin facing x.
  return sum * (3.0 * 3.14159 * uA * uA / float(K));
}

// ---- shading -------------------------------------------------------------
float sphShadow(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float cc = dot(oc, oc) - r * r;
  float h = b * b - cc;
  float d = -r + sqrt(max(0.0, r * r - h));
  float t = -b - sqrt(max(h, 0.0));
  return (b > 0.0) ? 1.0 : smoothstep(0.0, 1.0, 2.2 * d / t);
}

// The pumpkin as an occluder: its ellipsoid, squashed to a sphere of radius uA.
vec3 squash(vec3 v) { return vec3(v.x, v.y * uA / uB, v.z); }
float bodyShadow(vec3 x, vec3 L) {
  vec3 o = squash(x - uCenter);
  return sphShadow(o, normalize(squash(L)), vec3(0.0), uA * 0.94);
}
float bodyOcclusion(vec3 x, vec3 n) {
  vec3 o = squash(x - uCenter);
  vec3 di = -o;
  float l = length(di);
  float r = uA * 0.97;
  return clamp(1.0 - max(0.0, dot(normalize(squash(n)), di / l)) * (r * r) / (l * l), 0.0, 1.0);
}

float sphOcclusion(vec3 p, vec3 n, vec3 c, float r) {
  vec3 di = c - p;
  float l = length(di);
  return clamp(1.0 - max(0.0, dot(n, di / l)) * (r * r) / (l * l), 0.0, 1.0);
}

vec3 lampAt(vec3 x, vec3 n, vec3 v, float gloss, float specAmt, out vec3 spec) {
  vec3 L = LAMP - x;
  float d = length(L);
  L /= d;
  float ndl = dot(n, L);
  vec3 col = vec3(1.0, 0.86, 0.68) * uLamp * 1.25;
  vec3 h = normalize(L + v);
  spec = col * specAmt * pow(max(dot(n, h), 0.0), gloss) * (gloss + 8.0) / 24.0 * step(0.0, ndl);
  return col * max(ndl, 0.0);
}

vec3 tableShade(vec3 x, vec3 v) {
  vec3 n = vec3(0.0, 1.0, 0.0);
  // Planks running left to right, about 14 cm wide.
  float row = floor((x.z + 300.0) / 14.0);
  float zin = fract((x.z + 300.0) / 14.0);
  float seam = smoothstep(0.0, 0.012, zin) * smoothstep(1.0, 0.988, zin);
  // Grain runs along the plank: long, low-contrast figure, wavy growth lines, and fine pores.
  float warp = fbm(vec2(x.x * 0.012 + row * 4.1, x.z * 0.08));
  float figure = fbm(vec2(x.x * 0.018 + row * 7.3, x.z * 0.45 + warp * 2.0));
  float lines = 0.5 + 0.5 * sin((x.z + warp * 9.0 + sin(x.x * 0.05 + row) * 1.5) * 2.1);
  float pores = vnoise(vec2(x.x * 0.35, x.z * 6.0 + row * 9.0));
  float t = figure * 0.7 + lines * 0.18 + pores * 0.12;
  vec3 wood = mix(vec3(0.056, 0.027, 0.013), vec3(0.128, 0.066, 0.031), t);
  wood *= 0.82 + 0.32 * hash12(vec2(row, 3.0));
  wood *= mix(0.35, 1.0, seam);
  // Pumpkin's soft shadow and contact darkening from the lamp.
  vec3 sun;
  vec3 spec;
  vec3 c = uCenter;
  float shadow = bodyShadow(x, LAMP - x);
  float occ = bodyOcclusion(x, n);
  if (uHasLid > 0.5 && length(uLidOffset) > 0.01) {
    vec3 lc = c + uLidOffset + vec3(0.0, uLidSphere.x * 0.6, 0.0);
    shadow *= sphShadow(x, normalize(LAMP - x), lc, uLidSphere.y * 0.55);
    occ *= sphOcclusion(x, n, lc, uLidSphere.y * 0.6);
  }
  vec3 lamp = lampAt(x, n, v, 70.0, 0.25 * seam, spec);
  float fall = 1.0 / (1.0 + dot(x.xz, x.xz) * 0.00018);
  // The table darkens into the corner where it meets the wall.
  float corner = mix(0.55, 1.0, smoothstep(WALL_Z, WALL_Z + 14.0, x.z));
  vec3 moon = vec3(0.010, 0.014, 0.026) * occ * corner;
  vec3 col = wood * (lamp * shadow * fall + vec3(0.09, 0.085, 0.08) * uLamp * occ * corner) + wood * moon * 6.0;
  col += spec * shadow * fall;
  vec3 cl = candleThrough(x, n) + pumpkinGlow(x, n);
  col += wood * cl * 1.4;
  // The varnish catches the glow.
  col += cl * 0.08 * seam * pow(max(dot(reflect(-v, n), normalize(uCenter - x)), 0.0), 6.0);
  return col;
}

vec3 wallShade(vec3 x, vec3 v) {
  vec3 n = vec3(0.0, 0.0, 1.0);
  float plaster = fbm(x.xy * 0.08) * 0.6 + fbm(x.xy * 0.6) * 0.4;
  vec3 paint = vec3(0.040, 0.055, 0.058) * (0.86 + 0.28 * plaster);
  vec3 spec;
  float shadow = bodyShadow(x, LAMP - x);
  vec3 lamp = lampAt(x, n, v, 8.0, 0.0, spec);
  float fall = 1.0 / (1.0 + dot(x.xy - vec2(0.0, 30.0), x.xy - vec2(0.0, 30.0)) * 0.0004);
  float occ = mix(0.45, 1.0, smoothstep(0.0, 12.0, x.y));
  vec3 col = paint * (lamp * shadow * fall * 0.8 + vec3(0.12) * uLamp * occ + vec3(0.06, 0.08, 0.13) * occ);
  col += paint * (candleThrough(x, n) + pumpkinGlow(x, n)) * 1.6;
  return col;
}

vec3 skinColor(Shell s, vec3 d) {
  float g = grooveAt(s.phi) * sin(s.theta);
  vec3 base = mix(uSkin, uGroove, smoothstep(0.05, 0.75, g));
  // Pale patch where it sat in the field.
  float spot = smoothstep(0.62, 0.92, dot(d, normalize(vec3(-0.55, -0.62, -0.56)))) * (0.6 + 0.4 * fbm(vec2(s.phi, s.theta) * 9.0));
  base = mix(base, uGround, spot * 0.85);
  // Soft streaks along the ribs, and round freckles of a few sizes.
  float streak = fbm3o(vec2(s.phi * 22.0, s.theta * 2.5));
  base *= 0.9 + 0.2 * streak;
  vec2 fg = vec2(s.phi * 95.0, s.theta * 95.0);
  vec2 cell = floor(fg);
  float h = hash12(cell);
  vec2 c = vec2(hash12(cell + 7.1), hash12(cell + 3.7)) * 0.6 + 0.2;
  float fr = (1.0 - smoothstep(0.08, 0.16 + 0.1 * h, length(fract(fg) - c))) * step(0.9, h);
  base = mix(base, uWhite > 0.5 ? uGroove : uGround, fr * 0.45);
  // Towards the top, a greener tone round the stem.
  base = mix(base, uGroove * vec3(0.8, 1.0, 0.7), smoothstep(0.55, 0.2, s.theta) * 0.35);
  return base;
}

vec3 bumpSkin(vec3 n, Shell s) {
  float e = 0.01;
  vec2 p = vec2(s.phi * 24.0, s.theta * 8.0);
  float h0 = fbm3o(p);
  float hx = fbm3o(p + vec2(e * 30.0, 0.0));
  float hy = fbm3o(p + vec2(0.0, e * 30.0));
  vec3 t1 = normalize(cross(vec3(0.0, 1.0, 0.0), n) + 1e-4);
  vec3 t2 = cross(n, t1);
  return normalize(n - 0.22 * ((hx - h0) * t1 + (hy - h0) * t2));
}

// Shade a point on the pumpkin; q and n are in the object's local frame, and so is v.
vec3 shadeShell(vec3 q, vec3 n, vec3 v, bool lidObj, vec3 world) {
  Shell s = shellAt(q, 0.0);
  vec3 d = q / s.rho;
  float wall = wallAt(s.theta);
  bool inner = abs(s.rho - s.rin) < 0.06 && dot(n, d) < 0.2;
  bool skin = !inner && s.D < 0.03 && abs(s.rho - s.r) < 0.08;
  // Is the candle on this side of the lid? Only when the lid sits on the body.
  bool lidHome = !lidObj || length(uLidOffset) < 0.01;
  vec3 nW = toWorld(n);
  vec3 vW = toWorld(v);
  vec3 spec;
  vec3 col;
  float blur = textureLod(uDepth, depthUv(s.theta, s.phi), 3.0).r * DEPTH_MAX;
  if (skin) {
    vec3 nb = bumpSkin(n, s);
    vec3 nbW = toWorld(nb);
    vec3 albedo = skinColor(s, d);
    float g = grooveAt(s.phi) * sin(s.theta);
    float ao = (1.0 - 0.5 * smoothstep(0.1, 0.9, g)) * mix(0.55, 1.0, smoothstep(-0.95, -0.4, d.y) * 0.6 + 0.4);
    // Pin holes and the edges of cuts read darker.
    ao *= 1.0 - clamp((blur - s.D) * 1.2, 0.0, 0.35);
    // Waxy rather than wet: a broad, soft highlight.
    vec3 lamp = lampAt(world, nbW, vW, 22.0, uWhite > 0.5 ? 0.1 : 0.14, spec);
    float wrap = clamp((dot(nbW, normalize(LAMP - world)) + 0.35) / 1.35, 0.0, 1.0);
    lamp = mix(lamp, vec3(1.0, 0.86, 0.68) * uLamp * 1.25 * wrap, 0.4);
    vec3 fill = vec3(0.11, 0.1, 0.095) * uLamp + vec3(0.02, 0.022, 0.032) * max(0.25 + 0.75 * dot(nbW, MOON), 0.0);
    float fres = pow(1.0 - max(dot(nbW, vW), 0.0), 4.0);
    col = albedo * (lamp + fill) * ao + spec * ao + fres * (vec3(0.05, 0.045, 0.04) * uLamp + vec3(0.022, 0.026, 0.04));
    if (lidHome) {
      vec3 Ein = candleAt(d * s.rin, -d);
      col += Ein * glowAt(s.theta, s.phi, s.D) * albedo * 1.4;
    }
  } else if (inner) {
    // The hollow: scraped flesh with strings left in it.
    float strings = fbm(vec2(s.phi * 40.0, s.theta * 4.0 + fbm(vec2(s.phi * 6.0, s.theta)) * 2.0));
    vec3 albedo = uFlesh * (0.75 + 0.45 * strings);
    vec3 lamp = lampAt(world, nW, vW, 20.0, 0.1, spec);
    float open = (uHasLid > 0.5 && length(uLidOffset) > 0.01) ? 0.3 : 0.06;
    col = albedo * (lamp * open * 0.6 + vec3(0.06) * uLamp * open);
    if (lidHome) {
      col += albedo * candleAt(q, n) * 1.2;
      col += albedo * vec3(1.0, 0.6, 0.26) * 3.2 * uCandle;
    }
  } else {
    // Carved flesh: a floor where the wall was thinned, or the side of a cut.
    float fib = fbm3o(vec2(s.phi * 60.0, s.theta * 30.0));
    vec3 under = mix(uFlesh, vec3(0.78, 0.66, 0.2), 0.45);
    vec3 albedo = mix(under, uFlesh * 1.12, smoothstep(uRind * 0.6, uRind * 2.5, s.D));
    albedo *= 0.85 + 0.25 * fib;
    // A sliver of skin at the top of every cut wall.
    float rim = 1.0 - smoothstep(uRind * 0.6, uRind * 1.1, s.r - s.rho);
    albedo = mix(albedo, skinColor(s, d) * 0.8, rim);
    float ao = 1.0 - clamp((s.D - blur) * 0.5, 0.0, 0.55);
    vec3 lamp = lampAt(world, nW, vW, 60.0, 0.22, spec);
    vec3 fill = vec3(0.1) * uLamp + vec3(0.01, 0.015, 0.025);
    col = albedo * (lamp + fill) * ao + spec * ao;
    if (lidHome) {
      col += candleAt(q, n) * albedo * 0.9;
      vec3 Ein = candleAt(d * s.rin, -d);
      col += Ein * glowAt(s.theta, s.phi, s.D) * albedo * 1.6;
    }
  }
  return col;
}

vec3 shadeStem(vec3 q, vec3 n, vec3 v, vec3 world) {
  vec3 nW = toWorld(n);
  vec3 vW = toWorld(v);
  float ang = atan(q.z, q.x);
  float fib = fbm(vec2(ang * 9.0, q.y * 1.4));
  vec3 albedo = uStemColor * (0.65 + 0.6 * fib);
  float top = smoothstep(0.6, 0.85, n.y) * step(uStemBaseY + uStem.x - 0.6, q.y);
  albedo = mix(albedo, vec3(0.42, 0.36, 0.22), top);
  albedo = mix(albedo, vec3(0.32, 0.3, 0.22), smoothstep(uStemBaseY + uStem.x * 0.4, uStemBaseY + uStem.x, q.y) * 0.4);
  vec3 spec;
  vec3 lamp = lampAt(world, nW, vW, 16.0, 0.08, spec);
  vec3 fill = vec3(0.1) * uLamp + vec3(0.03, 0.034, 0.05) * max(0.3 + 0.7 * dot(nW, MOON), 0.0);
  // The candle's glow on the lid reaches the foot of the stem.
  float foot = exp(-max(q.y - uStemBaseY, 0.0) * 0.5);
  fill += vec3(1.0, 0.5, 0.18) * 0.05 * uCandle * foot * step(length(uLidOffset), 0.01);
  return albedo * (lamp + fill) + spec;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  float aspect = uRes.x / uRes.y;
  vec3 rd = normalize(uCamFwd + ndc.x * uTanHalf * aspect * uCamRight + ndc.y * uTanHalf * uCamUp);
  vec3 ro = uCamPos;

  float tBest = 1e9;
  int mat = M_NONE;
  if (rd.y < 0.0) {
    float t = -ro.y / rd.y;
    if ((ro + rd * t).z < TABLE_FRONT) { tBest = t; mat = M_TABLE; }
  }
  if (rd.z < 0.0) {
    float t = (WALL_Z - ro.z) / rd.z;
    if (t < tBest) { tBest = t; mat = M_WALL; }
  }

  // The body.
  vec3 roB = toLocal(ro - uCenter);
  vec3 rdB = toLocal(rd);
  vec2 bb = sphereHit(roB, rdB, vec3(0.0), uRMax);
  bool lidHit = false;
  if (bb.y > 0.0 && bb.x < tBest) {
    float t = marchShell(roB, rdB, bb.x, min(bb.y, tBest), false);
    if (t > 0.0 && t < tBest) { tBest = t; mat = M_SKIN; }
  }
  // The lid, where it has been cut, wherever it is.
  vec3 roL = toLocal(ro - uCenter - uLidOffset);
  if (uHasLid > 0.5) {
    vec2 lb = sphereHit(roL, rdB, vec3(0.0, uLidSphere.x, 0.0), uLidSphere.y);
    if (lb.y > 0.0 && lb.x < tBest) {
      float t = marchShell(roL, rdB, lb.x, min(lb.y, tBest), true);
      if (t > 0.0 && t < tBest) { tBest = t; mat = M_SKIN; lidHit = true; }
    }
  }
  // The stem rides on the lid.
  float ts = marchStem(roL, rdB);
  if (ts > 0.0 && ts < tBest) { tBest = ts; mat = M_STEM; }
  // The tea light, seen through the holes.
  vec2 cup = cupHit(roB, rdB);
  if (cup.x < tBest) { tBest = cup.x; mat = cup.y > 1.5 ? M_WAX : M_CUP; }

  vec3 x = ro + rd * tBest;
  vec3 col = vec3(0.0);
  vec3 v = -rd;
  if (mat == M_TABLE) col = tableShade(x, v);
  else if (mat == M_WALL) col = wallShade(x, v);
  else if (mat == M_SKIN) {
    vec3 q = (lidHit ? roL : roB) + rdB * tBest;
    vec3 n = fieldNormal(q, lidHit);
    col = shadeShell(q, n, -rdB, lidHit, x);
  } else if (mat == M_STEM) {
    vec3 q = roL + rdB * tBest;
    col = shadeStem(q, stemNormal(q), -rdB, x);
  } else if (mat == M_CUP || mat == M_WAX) {
    vec3 q = roB + rdB * tBest;
    vec3 n = mat == M_WAX ? vec3(0.0, 1.0, 0.0) : normalize(vec3(q.x, 0.0, q.z));
    vec3 lit = candleAt(q, n) + vec3(0.04) * uLamp;
    if (mat == M_WAX) {
      float r = length(q.xz);
      col = vec3(0.85, 0.8, 0.7) * (lit * 0.6 + vec3(1.0, 0.55, 0.2) * 2.4 * uCandle * smoothstep(1.9, 0.2, r));
      col = mix(col, vec3(0.02), smoothstep(0.12, 0.06, r));
    } else {
      float ribs = 0.8 + 0.2 * sin(atan(q.z, q.x) * 60.0);
      col = vec3(0.55, 0.56, 0.58) * lit * ribs;
    }
  }

  // The flame, where nothing stands in front of it.
  if (uCandle > 0.0) {
    vec3 f = uFlame;
    vec3 oc = roB - f;
    // Distance in a space squashed upright, so the glow is a flame and not a ball.
    vec3 sq = vec3(1.0, 0.42, 1.0);
    vec3 o2 = oc * sq;
    vec3 d2 = rdB * sq;
    float tc = clamp(-dot(o2, d2) / dot(d2, d2), 0.0, tBest);
    vec3 cp = o2 + d2 * tc;
    float dd = dot(cp, cp);
    float core = exp(-dd / 0.09);
    float body = exp(-dd / 0.45);
    float halo = exp(-dd / 6.0);
    float visible = step(tc, tBest - 0.01);
    col += visible * uCandle * (vec3(1.0, 0.92, 0.75) * core * 24.0 + vec3(1.0, 0.55, 0.16) * body * 7.0 + vec3(1.0, 0.45, 0.12) * halo * 0.9);
  }

  outColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

// Bloom: pre-filter and downsample, then add back up.
const DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uPrefilter;
void main() {
  vec3 a = texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  vec3 c = texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  vec3 d = texture(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  vec3 e = texture(uSrc, vUv).rgb;
  vec3 col = (a + b + c + d) * 0.125 + e * 0.5;
  if (uPrefilter > 0.5) {
    float l = max(col.r, max(col.g, col.b));
    col *= clamp((l - 0.7) / max(l, 1e-4), 0.0, 1.0);
  }
  outColor = vec4(col, 1.0);
}`;

const UP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
void main() {
  vec3 s = vec3(0.0);
  s += texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  s += texture(uSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb * 2.0;
  s += texture(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  s += texture(uSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb * 2.0;
  s += texture(uSrc, vUv).rgb * 4.0;
  s += texture(uSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb * 2.0;
  s += texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  s += texture(uSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb * 2.0;
  s += texture(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  outColor = vec4(s / 16.0, 1.0);
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomAmt;
uniform float uExposure;
uniform float uTime;
uniform vec2 uOut;
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec3 col = texture(uScene, vUv).rgb;
  col += texture(uBloom, vUv).rgb * uBloomAmt;
  col *= uExposure;
  vec2 c = vUv - 0.5;
  col *= 1.0 - dot(c, c) * 0.55;
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  float g = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 400.0) - 0.5;
  col += g * (1.5 / 255.0 + 0.012 * (1.0 - col));
  outColor = vec4(col, 1.0);
}`;

type Program = { prog: WebGLProgram; loc: Map<string, WebGLUniformLocation | null> };

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private scene: Program;
  private down: Program;
  private up: Program;
  private comp: Program;
  private vao: WebGLVertexArrayObject;
  private depthTex: WebGLTexture;
  private hdr: boolean;
  private sceneTarget: Target | null = null;
  private chain: Target[] = [];
  private look: Look | null = null;
  readonly depthW: number;
  readonly depthH: number;

  constructor(
    readonly canvas: HTMLCanvasElement,
    depthW: number,
    depthH: number,
  ) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.depthW = depthW;
    this.depthH = depthH;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    this.scene = this.program(SCENE);
    this.down = this.program(DOWN);
    this.up = this.program(UP);
    this.comp = this.program(COMPOSITE);
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(depthW, depthH))) + 1, gl.RG8, depthW, depthH);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.depthTex = tex;
  }

  private program(frag: string): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        console.error(log);
        throw new Error('shader: ' + log);
      }
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      console.error(log);
      throw new Error('link: ' + log);
    }
    return { prog, loc: new Map() };
  }

  private u(p: Program, name: string): WebGLUniformLocation | null {
    if (!p.loc.has(name)) p.loc.set(name, this.gl.getUniformLocation(p.prog, name));
    return p.loc.get(name) ?? null;
  }

  private target(w: number, h: number, old: Target | null): Target {
    const gl = this.gl;
    if (old && old.w === w && old.h === h) return old;
    if (old) {
      gl.deleteFramebuffer(old.fbo);
      gl.deleteTexture(old.tex);
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, this.hdr ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex, w, h };
  }

  setLook(look: Look): void {
    this.look = look;
  }

  /** Upload a rectangle of the carving map (two bytes a texel) and rebuild the mips. */
  uploadDepth(data: Uint8Array, x = 0, y = 0, w = this.depthW, h = this.depthH): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, this.depthW);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RG, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  /** Draw one frame: the scene at w x h, then bloom and tone-map to the canvas. */
  render(f: Frame, w: number, h: number): void {
    const gl = this.gl;
    const look = this.look;
    if (!look) return;
    const outW = this.canvas.width;
    const outH = this.canvas.height;
    this.sceneTarget = this.target(w, h, this.sceneTarget);
    gl.bindVertexArray(this.vao);

    // Scene.
    const p = this.scene;
    gl.useProgram(p.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget.fbo);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.uniform1i(this.u(p, 'uDepth'), 0);
    gl.uniform2f(this.u(p, 'uRes'), w, h);
    gl.uniform1f(this.u(p, 'uTime'), f.time);
    gl.uniform3fv(this.u(p, 'uCamPos'), f.camPos);
    gl.uniform3fv(this.u(p, 'uCamRight'), f.camRight);
    gl.uniform3fv(this.u(p, 'uCamUp'), f.camUp);
    gl.uniform3fv(this.u(p, 'uCamFwd'), f.camFwd);
    gl.uniform1f(this.u(p, 'uTanHalf'), f.tanHalf);
    gl.uniform3fv(this.u(p, 'uCenter'), f.center);
    gl.uniform2f(this.u(p, 'uYaw'), Math.cos(f.yaw), Math.sin(f.yaw));
    gl.uniform1f(this.u(p, 'uHasLid'), f.hasLid ? 1 : 0);
    gl.uniform3fv(this.u(p, 'uLidOffset'), f.lidOffset);
    gl.uniform2fv(this.u(p, 'uLidCone'), f.lidCone);
    gl.uniform2fv(this.u(p, 'uLidSphere'), f.lidSphere);
    gl.uniform1f(this.u(p, 'uLamp'), f.lamp);
    gl.uniform1f(this.u(p, 'uCandle'), f.candle);
    gl.uniform3fv(this.u(p, 'uFlame'), f.flame);
    gl.uniform1f(this.u(p, 'uFloorY'), f.floorY);
    gl.uniform1f(this.u(p, 'uStemBaseY'), f.stemBaseY);
    gl.uniform1f(this.u(p, 'uRMax'), f.rMax);
    gl.uniform1f(this.u(p, 'uA'), look.a);
    gl.uniform1f(this.u(p, 'uB'), look.b);
    gl.uniform1f(this.u(p, 'uBoxy'), look.boxy);
    gl.uniform1f(this.u(p, 'uRibs'), look.ribs);
    gl.uniform1f(this.u(p, 'uRibDepth'), look.ribDepth);
    gl.uniform1f(this.u(p, 'uRibSharp'), look.ribSharp);
    gl.uniform1f(this.u(p, 'uDimpleTop'), look.dimpleTop);
    gl.uniform1f(this.u(p, 'uDimpleBottom'), look.dimpleBottom);
    gl.uniform1f(this.u(p, 'uWall'), look.wall);
    gl.uniform1f(this.u(p, 'uSeed'), look.seed);
    gl.uniform1f(this.u(p, 'uRind'), look.rind);
    gl.uniform1f(this.u(p, 'uWhite'), look.white ? 1 : 0);
    gl.uniform3fv(this.u(p, 'uSkin'), look.skin);
    gl.uniform3fv(this.u(p, 'uGroove'), look.groove);
    gl.uniform3fv(this.u(p, 'uGround'), look.ground);
    gl.uniform3fv(this.u(p, 'uFlesh'), look.flesh);
    gl.uniform3fv(this.u(p, 'uFleshSigma'), look.fleshSigma);
    gl.uniform3fv(this.u(p, 'uRindSigma'), look.rindSigma);
    gl.uniform3fv(this.u(p, 'uStemColor'), look.stemColor);
    gl.uniform4fv(this.u(p, 'uStem'), look.stem);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Bloom chain at half, quarter, ... resolution.
    let src = this.sceneTarget;
    const levels = 5;
    for (let i = 0; i < levels; i++) {
      const tw = Math.max(1, src.w >> 1);
      const th = Math.max(1, src.h >> 1);
      this.chain[i] = this.target(tw, th, this.chain[i] ?? null);
      gl.useProgram(this.down.prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.chain[i].fbo);
      gl.viewport(0, 0, tw, th);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(this.u(this.down, 'uSrc'), 0);
      gl.uniform2f(this.u(this.down, 'uTexel'), 1 / src.w, 1 / src.h);
      gl.uniform1f(this.u(this.down, 'uPrefilter'), i === 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = this.chain[i];
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = levels - 1; i > 0; i--) {
      const from = this.chain[i];
      const to = this.chain[i - 1];
      gl.useProgram(this.up.prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
      gl.viewport(0, 0, to.w, to.h);
      gl.bindTexture(gl.TEXTURE_2D, from.tex);
      gl.uniform1i(this.u(this.up, 'uSrc'), 0);
      gl.uniform2f(this.u(this.up, 'uTexel'), 1 / from.w, 1 / from.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);

    // Composite to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(this.comp.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.tex);
    gl.uniform1i(this.u(this.comp, 'uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.chain[0].tex);
    gl.uniform1i(this.u(this.comp, 'uBloom'), 1);
    gl.uniform1f(this.u(this.comp, 'uBloomAmt'), this.hdr ? 0.22 : 0.12);
    gl.uniform1f(this.u(this.comp, 'uExposure'), f.exposure);
    gl.uniform1f(this.u(this.comp, 'uTime'), f.time);
    gl.uniform2f(this.u(this.comp, 'uOut'), outW, outH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}
