// The chamber, drawn in WebGL 2.
//
// The room, the plate, the glass, the light, and whatever sits on the plate
// change only when something is moved, so they are ray-traced once into a
// cached colour and depth buffer. Each frame then:
// 1. draws the droplets mirrored below the plate, for the alcohol film's reflection
// 2. lays the cached room over them, keeping as much of the reflection as the
//    film reflects (its alpha) and copying its depth
// 3. draws the droplets themselves, depth-tested so the marble hides what is behind it
// 4. blooms the result and tone-maps it to the screen
//
// Every droplet is lit by the same lamp model the room uses: an LED strip along
// the left wall, shining across the plate, with shadows from the rod, marble,
// and salt. Droplets scatter forward (Henyey-Greenstein, g = 0.5).

import { RING, STRIDE, type Chamber } from './_chamber';
import { DISH_R, H, MARBLE_R, ROD_R, SALT_H, SALT_R, type Objects } from './_physics';

/** Plate margin beyond the glass, cm. */
export const MARGIN = 2.4;

type Mat = Float32Array;

const mul = (a: Mat, b: Mat): Mat => {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
};

function invert(m: Mat): Mat {
  const inv = new Float32Array(16);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  const d = 1 / det;
  inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d;
  inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
  inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d;
  inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
  inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d;
  inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
  inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d;
  inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
  inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d;
  inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
  inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d;
  inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
  inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d;
  inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
  inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d;
  inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
  return inv;
}

function perspective(fovy: number, aspect: number, near: number, far: number): Mat {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function lookAt(e: number[], t: number[]): Mat {
  let zx = e[0] - t[0];
  let zy = e[1] - t[1];
  let zz = e[2] - t[2];
  const zl = Math.hypot(zx, zy, zz);
  zx /= zl;
  zy /= zl;
  zz /= zl;
  // x = up(0,0,1) × z
  let xx = -zy;
  let xy = zx;
  const xl = Math.hypot(xx, xy);
  xx /= xl;
  xy /= xl;
  const xz = 0;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx,
    yx,
    zx,
    0,
    xy,
    yy,
    zy,
    0,
    xz,
    yz,
    zz,
    0,
    -(xx * e[0] + xy * e[1] + xz * e[2]),
    -(yx * e[0] + yy * e[1] + yz * e[2]),
    -(zx * e[0] + zy * e[1] + zz * e[2]),
    1,
  ]);
}

const COMMON = /* glsl */ `
uniform vec2 uDim;
uniform vec4 uMarble;
uniform vec4 uRod;
uniform float uRodOn;
uniform vec4 uSalt;

const float LAMP_X = 0.32;
const float LAMP_Z = 2.3;

float lampAt(vec3 p) {
  float dx = p.x - LAMP_X;
  float dz = p.z - LAMP_Z;
  float dist = length(vec2(dx, dz));
  float ang = atan(dz, max(dx, 0.001)) + 0.1;
  float beam = exp(-ang * ang / 0.12);
  float ends = smoothstep(0.5, 2.6, p.y) * smoothstep(uDim.y - 0.5, uDim.y - 2.6, p.y);
  return beam * ends / (0.55 + 0.085 * dist) * smoothstep(LAMP_X, LAMP_X + 0.3, p.x);
}

float segDist(vec3 p1, vec3 q1, vec3 p2, vec3 q2) {
  vec3 d1 = q1 - p1;
  vec3 d2 = q2 - p2;
  vec3 r = p1 - p2;
  float a = dot(d1, d1);
  float e = dot(d2, d2);
  float f = dot(d2, r);
  float c = dot(d1, r);
  float b = dot(d1, d2);
  float den = a * e - b * b;
  float s = den > 1e-6 ? clamp((b * f - c * e) / den, 0.0, 1.0) : 0.0;
  float t = (b * s + f) / e;
  if (t < 0.0) { t = 0.0; s = clamp(-c / a, 0.0, 1.0); }
  else if (t > 1.0) { t = 1.0; s = clamp((b - c) / a, 0.0, 1.0); }
  return length(p1 + d1 * s - (p2 + d2 * t));
}

// Fraction of the strip's light that reaches p past whatever is on the plate.
float shade(vec3 p) {
  vec3 l = vec3(LAMP_X, p.y, LAMP_Z);
  float s = 1.0;
  if (uMarble.w > 0.5) {
    vec3 c = vec3(uMarble.xy, uMarble.z);
    vec3 ab = l - p;
    float t = clamp(dot(c - p, ab) / dot(ab, ab), 0.0, 1.0);
    float d = length(p + ab * t - c);
    float soft = 0.06 + 0.05 * length(c.xy - p.xy);
    s *= smoothstep(uMarble.z - soft, uMarble.z + soft, d);
  }
  if (uRodOn > 0.5) {
    float d = segDist(p, l, vec3(uRod.xy, ${ROD_R.toFixed(3)}), vec3(uRod.zw, ${ROD_R.toFixed(3)}));
    float soft = 0.04 + 0.03 * abs(p.x - 0.5 * (uRod.x + uRod.z));
    s *= smoothstep(${ROD_R.toFixed(3)} - soft, ${ROD_R.toFixed(3)} + soft, d);
  }
  if (uSalt.z > 0.0) {
    // The light runs nearly flat along x; find where it passes the mound.
    float t = clamp((uSalt.x - p.x) / (LAMP_X - p.x), 0.0, 1.0);
    vec3 q = mix(p, l, t);
    float qr = length(q.xy - uSalt.xy) / uSalt.z;
    float top = qr < 1.0 ? uSalt.w * pow(1.0 - qr * qr, 0.8) + 0.12 : (qr < ${(DISH_R / SALT_R).toFixed(3)} ? 0.1 + 0.25 * (qr - 1.0) : 0.0);
    s *= p.x > uSalt.x ? smoothstep(-0.06, 0.12, q.z - top) : 1.0;
  }
  return s;
}

vec2 flow(vec2 p, float t) {
  return vec2(
    0.14 * sin(0.21 * p.y + 0.05 * t + 1.3) + 0.08 * sin(0.43 * p.x - 0.07 * t + 0.4),
    0.14 * cos(0.19 * p.x - 0.04 * t + 0.2) + 0.08 * cos(0.37 * p.y + 0.06 * t + 2.1)
  );
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return s;
}
`;

const DROP_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec4 aP;
layout(location = 1) in vec4 aS;
layout(location = 2) in vec4 aT;
uniform mat4 uVP;
uniform vec3 uCam;
uniform float uTime;
uniform float uMirror;
uniform float uPx;
uniform float uHighlight;
uniform float uGain;
out vec3 vCol;
${COMMON}
vec3 hash3(float s) {
  vec3 q = fract(vec3(s * 127.1, s * 311.7, s * 74.7) + vec3(0.1, 0.4, 0.7));
  q = fract(q * (q + 33.33) * 13.7);
  vec3 r = fract(q * 91.3 + 0.17);
  return (q + r - 1.0) * 1.2;
}
void main() {
  float age = uTime - aP.w;
  float life = aS.w;
  if (age < 0.0 || age > life || aS.x <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    gl_PointSize = 0.0;
    vCol = vec3(0.0);
    return;
  }
  vec3 p = aP.xyz;
  vec2 f = flow(p.xy, aP.w);
  if (aT.y > 0.0) {
    p.z -= aT.y * age;
    p.xy += f * age * 0.3;
  } else {
    p.xy += f * age;
    p.z -= 0.05 * age + 0.06 * age * age;
  }
  p += hash3(aT.z) * aS.z * sqrt(age);
  float inside = step(0.02, p.z) * step(0.05, p.x) * step(p.x, uDim.x - 0.05) * step(0.05, p.y) * step(p.y, uDim.y - 0.05);
  float grow = smoothstep(0.0, 0.25, age);
  float fade = 1.0 - smoothstep(life * 0.45, life, age);
  float r = aS.x * grow;
  vec3 toLight = normalize(p - vec3(LAMP_X, p.y, LAMP_Z));
  vec3 toEye = normalize(uCam - p);
  float g = 0.5;
  float cosT = dot(toLight, toEye);
  float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5);
  float light = lampAt(p) * shade(p) * phase;
  vec4 clip = uVP * vec4(p.xy, p.z * uMirror, 1.0);
  float rad = 0.02 * r * uPx / clip.w;
  float size = max(1.7, rad * 2.0);
  gl_PointSize = size;
  gl_Position = clip;
  float energy = r * r * fade * light * inside * uGain * (aT.y > 0.0 ? 0.8 : 1.0);
  vec3 tint = abs(aT.x - uHighlight) < 0.5 ? vec3(1.0, 0.62, 0.22) * 1.8 : vec3(0.9, 0.95, 1.0);
  vCol = tint * energy * (3.4 / (size * size));
}`;

const DROP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  o = vec4(vCol * exp(-3.0 * d), 0.0);
}`;

const QUAD_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const ROOM_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform mat4 uInvVP;
uniform mat4 uVP;
uniform vec3 uCam;
uniform float uH;
uniform float uMargin;
uniform vec3 uMagnet;
uniform sampler2D uScale;
uniform float uScaleLen;
/** How far the plate has frosted over, and how far the sensitive layer has formed, 0 to 1. */
uniform float uFrost;
uniform float uLayer;
out vec4 o;
${COMMON}

const float BOX = 0.6;
const float FLOOR = -9.0;
const vec3 AMBIENT = vec3(0.010, 0.012, 0.016);
const vec3 LED = vec3(0.93, 0.96, 1.0);

// Entry and exit along the ray, and the axis it entered through (0, 1, 2).
vec3 box(vec3 ro, vec3 rd, vec3 lo, vec3 hi) {
  vec3 safe = mix(rd, vec3(1e-6), lessThan(abs(rd), vec3(1e-6)));
  vec3 inv = 1.0 / safe;
  vec3 t0 = (lo - ro) * inv;
  vec3 t1 = (hi - ro) * inv;
  vec3 tn = min(t0, t1);
  vec3 tf = max(t0, t1);
  float a = max(max(tn.x, tn.y), tn.z);
  float b = min(min(tf.x, tf.y), tf.z);
  float axis = tn.x >= tn.y ? (tn.x >= tn.z ? 0.0 : 2.0) : (tn.y >= tn.z ? 1.0 : 2.0);
  return vec3(a, b, axis);
}

vec3 boxNormal(vec3 rd, float axis) {
  return axis < 0.5 ? vec3(-sign(rd.x), 0.0, 0.0) : axis < 1.5 ? vec3(0.0, -sign(rd.y), 0.0) : vec3(0.0, 0.0, -sign(rd.z));
}

float sphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b * b - dot(oc, oc) + r * r;
  return h < 0.0 ? -1.0 : -b - sqrt(h);
}

float capsule(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float r) {
  vec3 ba = pb - pa;
  vec3 oa = ro - pa;
  float baba = dot(ba, ba);
  float bard = dot(ba, rd);
  float baoa = dot(ba, oa);
  float rdoa = dot(rd, oa);
  float oaoa = dot(oa, oa);
  float a = baba - bard * bard;
  float b = baba * rdoa - baoa * bard;
  float c = baba * oaoa - baoa * baoa - r * r * baba;
  float h = b * b - a * c;
  if (h >= 0.0) {
    float t = (-b - sqrt(h)) / a;
    float y = baoa + t * bard;
    if (y > 0.0 && y < baba) return t;
    vec3 oc = y <= 0.0 ? oa : ro - pb;
    b = dot(rd, oc);
    c = dot(oc, oc) - r * r;
    h = b * b - c;
    if (h > 0.0) return -b - sqrt(h);
  }
  return -1.0;
}

float mound(vec2 q) {
  float qr = length(q - uSalt.xy) / uSalt.z;
  if (qr >= 1.0) return -1.0;
  // A heap at its angle of repose, rounded on top and lumpy.
  float grain = noise(q * 26.0) * 0.06 + noise(q * 9.0) * 0.12;
  float cone = 1.0 - qr;
  float h = cone * cone * (3.0 - 2.0 * cone);
  return uSalt.w * mix(h, cone, 0.5) * (0.82 + grain * 1.5) + 0.1;
}

// The strip, seen along a ray: a glowing bar with an LED every 0.6 cm.
vec3 strip(vec3 ro, vec3 rd, float tmax) {
  vec3 a = vec3(LAMP_X, 1.0, LAMP_Z);
  vec3 b = vec3(LAMP_X, uDim.y - 1.0, LAMP_Z);
  // Closest approach of the ray to the strip's axis.
  vec3 u = rd;
  vec3 v = b - a;
  vec3 w = ro - a;
  float uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), uw = dot(u, w), vw = dot(v, w);
  float den = uu * vv - uv * uv;
  float s = clamp((uv * vw - vv * uw) / den, 0.0, tmax);
  float t = clamp((uu * vw - uv * uw) / den, 0.0, 1.0);
  vec3 pr = ro + u * s;
  vec3 ps = a + v * t;
  float d = length(pr - ps);
  float y = ps.y;
  float led = pow(0.5 + 0.5 * cos(y / 0.6 * 6.2832), 24.0);
  float core = exp(-d * d / 0.0016) * (0.7 + 16.0 * led);
  float halo = exp(-d * d / 0.05) * 0.22 + exp(-d * d / 1.5) * 0.025;
  return LED * (core + halo);
}

vec3 frost(vec2 q, float lit) {
  float f = fbm(q * 3.1);
  // Bare metal until the plate is cold enough, then a crust that whitens it all over, thicker in patches.
  float cover = clamp(uFrost * 1.3 - 0.3 + (f - 0.5) * 0.5, 0.0, 1.0);
  float spark = pow(noise(q * 70.0), 46.0) * 14.0 * lit * cover;
  vec3 col = vec3(0.74, 0.78, 0.82) * (0.35 + 0.55 * f);
  vec3 bare = vec3(0.03, 0.033, 0.036) * (AMBIENT * 20.0 + vec3(lit * 0.5));
  return mix(bare, col * (AMBIENT * 3.0 + vec3(lit)) + vec3(spark), cover);
}

void main() {
  vec4 a = uInvVP * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec4 b = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 ro = a.xyz / a.w;
  vec3 rd = normalize(b.xyz / b.w - ro);
  float W = uDim.x;
  float D = uDim.y;
  float M = uMargin;

  float t = 1e9;
  int id = 0;
  vec3 n = vec3(0, 0, 1);
  // Floor: the bench the cooler stands on.
  if (rd.z < 0.0) {
    float tf = (FLOOR - ro.z) / rd.z;
    if (tf > 0.0) { t = tf; id = 1; n = vec3(0, 0, 1); }
  }
  // The foam cooler holding the dry ice.
  vec3 hb = box(ro, rd, vec3(-M - BOX, -M - BOX, FLOOR), vec3(W + M + BOX, D + M + BOX, -0.5));
  if (hb.x > 0.0 && hb.x < hb.y && hb.x < t) { t = hb.x; id = 2; n = boxNormal(rd, hb.z); }
  // The plate.
  vec3 hp = box(ro, rd, vec3(-M, -M, -0.5), vec3(W + M, D + M, 0.0));
  if (hp.x > 0.0 && hp.x < hp.y && hp.x < t) { t = hp.x; id = 3; n = boxNormal(rd, hp.z); }
  // What sits on it.
  if (uMarble.w > 0.5) {
    float ts = sphere(ro, rd, vec3(uMarble.xy, uMarble.z), uMarble.z);
    if (ts > 0.0 && ts < t) { t = ts; id = 4; n = normalize(ro + rd * ts - vec3(uMarble.xy, uMarble.z)); }
  }
  if (uRodOn > 0.5) {
    vec3 pa = vec3(uRod.xy, ${ROD_R.toFixed(3)});
    vec3 pb = vec3(uRod.zw, ${ROD_R.toFixed(3)});
    float tc = capsule(ro, rd, pa, pb, ${ROD_R.toFixed(3)});
    if (tc > 0.0 && tc < t) {
      t = tc;
      id = 5;
      vec3 p = ro + rd * tc;
      vec3 ba = pb - pa;
      float h = clamp(dot(p - pa, ba) / dot(ba, ba), 0.0, 1.0);
      n = normalize(p - pa - ba * h);
    }
  }
  if (uSalt.z > 0.0) {
    // March the mound inside its bounding cylinder.
    float top = uSalt.w * 1.3 + 0.15;
    if (rd.z < 0.0) {
      float t0 = max(0.0, (top - ro.z) / rd.z);
      float t1 = (0.0 - ro.z) / rd.z;
      float prev = t0;
      for (int i = 0; i < 40; i++) {
        float tt = mix(t0, t1, float(i) / 39.0);
        vec3 p = ro + rd * tt;
        float h = mound(p.xy);
        if (h > 0.0 && p.z < h) {
          float lo = prev, hi = tt;
          for (int k = 0; k < 6; k++) {
            float m = 0.5 * (lo + hi);
            vec3 q = ro + rd * m;
            float hm = mound(q.xy);
            if (hm > 0.0 && q.z < hm) hi = m; else lo = m;
          }
          if (hi < t) {
            t = hi;
            id = 6;
            vec3 q = ro + rd * hi;
            float e = 0.03;
            n = normalize(vec3(mound(q.xy - vec2(e, 0)) - mound(q.xy + vec2(e, 0)), mound(q.xy - vec2(0, e)) - mound(q.xy + vec2(0, e)), 2.0 * e));
          }
          break;
        }
        prev = tt;
      }
    }
  }

  vec3 p = ro + rd * t;
  vec3 col = vec3(0);
  float refl = 0.0;
  float inGlass = step(0.0, p.x) * step(p.x, W) * step(0.0, p.y) * step(p.y, D);

  if (id == 1) {
    // Bench: dark laminate, lit by ambient and the beam leaving the right wall.
    float spill = lampAt(vec3(min(p.x, W + 6.0), clamp(p.y, 0.0, D), 0.2)) * 0.25 * smoothstep(W, W + 5.0, p.x) / (1.0 + 0.05 * max(0.0, p.x - W));
    col = vec3(0.07, 0.065, 0.06) * (AMBIENT * 4.0 + spill) * (0.8 + 0.3 * fbm(p.xy * 0.2));
  } else if (id == 2) {
    float spill = lampAt(vec3(W + 1.0, clamp(p.y, 0.5, D - 0.5), 0.3)) * smoothstep(W, W + M, p.x) * max(0.0, n.x) * 0.6;
    float top = step(0.5, n.z) * lampAt(vec3(W + 1.0, clamp(p.y, 0.5, D - 0.5), 0.2)) * smoothstep(W + M, W + M + BOX, p.x) * 0.2;
    col = vec3(0.86, 0.87, 0.85) * (AMBIENT * 0.8 + vec3(spill + top) * 0.5) * (0.9 + 0.2 * noise(p.xz * 3.0 + p.y));
  } else if (id == 3) {
    if (n.z < 0.5) {
      // Plate edge: frosted metal.
      col = frost(p.xz * 1.7 + p.y, lampAt(vec3(W + 0.5, clamp(p.y, 0.5, D - 0.5), 0.1)) * step(0.5, n.x) * 0.5);
    } else if (inGlass > 0.5) {
      // Black paint under a film of alcohol.
      float wall = min(min(p.x, W - p.x), min(p.y, D - p.y));
      float puddle = smoothstep(0.35, 0.75, fbm(p.xy * 0.35 + 3.0));
      float lit = lampAt(vec3(p.xy, 0.05)) * shade(vec3(p.xy, 0.05)) * 0.06;
      col = vec3(0.012, 0.013, 0.015) * (AMBIENT * 6.0 + vec3(lit)) * 6.0;
      // The strip, reflected in the film.
      vec3 rr = vec3(rd.xy, -rd.z);
      col += strip(p, rr, 80.0) * (0.025 + 0.04 * puddle);
      refl = 0.14 + 0.22 * puddle;
      // Frost creeping in along the foot of the glass.
      float rim = 1.0 - smoothstep(0.08, 0.45 + 0.25 * noise(p.xy * 4.0), wall);
      col = mix(col, frost(p.xy, lampAt(vec3(p.xy, 0.15)) * 0.4), rim * 0.9);
      refl *= 1.0 - rim;
      // A scale painted along the front, in cm.
      if (p.y > 0.55 && p.y < 1.45 && p.x > 1.0 && p.x < 1.0 + uScaleLen) {
        float paint = texture(uScale, vec2((p.x - 1.0) / uScaleLen, 1.0 - (p.y - 0.55) / 0.9)).a;
        col = mix(col, vec3(0.8, 0.8, 0.76) * (AMBIENT * 8.0 + vec3(lampAt(vec3(p.xy, 0.1)) * 0.2)), paint);
        refl *= 1.0 - paint;
      }
      // Where the magnet sits underneath, a painted ring.
      if (uMagnet.z > 0.5) {
        float d = abs(length(p.xy - uMagnet.xy) - 2.6);
        float dash = step(0.5, fract(atan(p.y - uMagnet.y, p.x - uMagnet.x) * 24.0 / 6.2832));
        float ring = (1.0 - smoothstep(0.02, 0.05, d)) * dash;
        col = mix(col, vec3(0.8, 0.8, 0.76) * (AMBIENT * 8.0 + vec3(lampAt(vec3(p.xy, 0.1)) * 0.2)), ring * 0.8);
      }
    } else {
      // Outside the glass the plate grows a crust of frost from the room's air.
      float lit = p.x > W ? lampAt(vec3(p.x, clamp(p.y, 0.4, D - 0.4), 0.12)) * 0.3 : 0.0;
      lit += lampAt(vec3(clamp(p.x, 0.5, W), clamp(p.y, 0.4, D - 0.4), 0.2)) * 0.06 * step(p.x, W);
      col = frost(p.xy, lit);
    }
  } else if (id == 4) {
    // Uranium glass: yellow-green, glossy, glowing faintly where light passes through.
    vec3 c = vec3(uMarble.xy, uMarble.z);
    float lit = lampAt(p) * shade(p + n * 0.05);
    vec3 ldir = normalize(vec3(-1.0, 0.0, 0.18));
    float dif = max(0.0, dot(n, ldir));
    vec3 h = normalize(ldir - rd);
    float spec = pow(max(0.0, dot(n, h)), 90.0);
    float through = lampAt(c) * pow(max(0.0, dot(-n, ldir)), 2.0);
    vec3 glass = vec3(0.55, 0.85, 0.12);
    float swirl = fbm(vec2(atan(n.y, n.x) * 2.0, n.z * 3.0) + 4.0);
    col = glass * (AMBIENT * 4.0 + vec3(dif * lit * 0.2 + through * 0.9 * (0.6 + swirl))) + vec3(spec * lit * 2.2);
    col += strip(p, reflect(rd, n), 40.0) * 0.08;
  } else if (id == 5) {
    // Tungsten: grey metal, with the red band of paint at one end.
    vec3 pa = vec3(uRod.xy, ${ROD_R.toFixed(3)});
    vec3 pb = vec3(uRod.zw, ${ROD_R.toFixed(3)});
    float h = dot(p - pa, pb - pa) / dot(pb - pa, pb - pa);
    vec3 base = h > 0.92 ? vec3(0.6, 0.06, 0.04) : vec3(0.42, 0.43, 0.45);
    float lit = lampAt(p) * shade(p + n * 0.05);
    vec3 ldir = normalize(vec3(-1.0, 0.0, 0.18));
    float dif = max(0.0, dot(n, ldir));
    float spec = pow(max(0.0, dot(reflect(rd, n), ldir)), 30.0);
    float ground = 0.85 + 0.15 * noise(vec2(h * 120.0, 0.0));
    col = base * ground * (AMBIENT * 10.0 + vec3(dif * lit * 0.6)) + vec3(spec * lit * (h > 0.92 ? 0.15 : 0.7));
    col += strip(p, reflect(rd, n), 40.0) * (h > 0.92 ? 0.03 : 0.1);
  } else if (id == 6) {
    // Salt: white grains.
    float lit = lampAt(p) * shade(p + n * 0.04);
    vec3 ldir = normalize(vec3(-1.0, 0.0, 0.18));
    float dif = max(0.0, dot(n, ldir)) * 0.8 + 0.2;
    float spark = pow(noise(p.xy * 90.0 + p.z * 40.0), 44.0) * 8.0;
    float grains = 0.62 + 0.38 * noise(p.xy * 44.0 + p.z * 24.0);
    float fill = lampAt(p) * 0.1;
    col = vec3(0.92, 0.92, 0.9) * grains * (AMBIENT * 8.0 + vec3(dif * lit * 0.7 + fill)) + vec3(spark * lit);
  }

  // The watch glass under the salt: a glint round its rim and a faint glassy floor.
  if (uSalt.z > 0.0 && rd.z < 0.0) {
    float tz = (0.32 - ro.z) / rd.z;
    if (tz > 0.0 && tz < t) {
      vec3 q = ro + rd * tz;
      float r = length(q.xy - uSalt.xy);
      float d = r - ${DISH_R.toFixed(3)};
      float lit = lampAt(q);
      float side = 0.4 + 0.6 * max(0.0, -(q.x - uSalt.x) / max(r, 0.01));
      col += vec3(0.85, 0.9, 1.0) * exp(-d * d / 0.0015) * (0.02 + lit * 0.5 * side);
      col += vec3(0.6, 0.7, 0.8) * step(r, ${DISH_R.toFixed(3)}) * 0.006;
    }
  }

  // Glass walls: faint sheen, lit condensation at their feet, felt round the top, bright edges.
  float tOpaque = t;
  for (int k = 0; k < 4; k++) {
    float tw;
    vec3 q;
    float along;
    float span;
    if (k == 0) { tw = (0.0 - ro.x) / rd.x; q = ro + rd * tw; along = q.y; span = D; }
    else if (k == 1) { tw = (W - ro.x) / rd.x; q = ro + rd * tw; along = q.y; span = D; }
    else if (k == 2) { tw = (0.0 - ro.y) / rd.y; q = ro + rd * tw; along = q.x; span = W; }
    else { tw = (D - ro.y) / rd.y; q = ro + rd * tw; along = q.x; span = W; }
    if (tw <= 0.0 || tw >= tOpaque || q.z < 0.0 || q.z > uH || along < 0.0 || along > span) continue;
    float lit = k == 1 ? lampAt(vec3(W - 0.05, q.y, q.z)) * shade(vec3(W - 0.05, q.y, q.z)) : lampAt(vec3(clamp(q.x, 0.5, W), clamp(q.y, 0.0, D), q.z)) * 0.12;
    // Felt soaked in alcohol, round the top inside; the near strip is left out so it doesn't hide the plate.
    if (k != 2 && q.z > uH - 2.0 && q.z < uH - 0.5) {
      float f = fbm(vec2(along * 2.0, q.z * 2.0));
      vec3 felt = vec3(0.86, 0.85, 0.82) * (0.7 + 0.4 * f) * (AMBIENT * 3.0 + vec3(lampAt(vec3(clamp(q.x, 0.5, W), clamp(q.y, 0.5, D - 0.5), 4.0)) * 0.05));
      col = felt;
      refl = 0.0;
      t = tw;
      tOpaque = tw;
      continue;
    }
    float mist = (1.0 - smoothstep(0.0, 1.4, q.z)) * (0.35 + 0.65 * noise(vec2(along, q.z) * 14.0));
    col += vec3(0.85, 0.9, 1.0) * mist * lit * 0.35;
    float edge = min(along, span - along);
    float glint = exp(-edge * edge / 0.004) + exp(-pow(uH - q.z, 2.0) / 0.004);
    col += vec3(0.8, 0.88, 1.0) * glint * (k == 2 ? 0.012 : 0.025 + lit * 0.6);
    col += vec3(0.6, 0.7, 0.8) * 0.003;
  }

  // The strip itself.
  col += strip(ro, rd, t);

  // Mist hanging in the beam: a sheet over the plate, thinner haze above.
  vec3 hv = box(ro, rd, vec3(0.0, 0.0, 0.0), vec3(W, D, uH));
  if (hv.x < hv.y && hv.y > 0.0) {
    float t0 = max(hv.x, 0.0);
    float t1 = min(hv.y, tOpaque);
    float dt = (t1 - t0) / 14.0;
    float acc = 0.0;
    for (int i = 0; i < 14; i++) {
      vec3 q = ro + rd * (t0 + dt * (float(i) + 0.5));
      float dens = 0.002 + (0.008 + 0.03 * uLayer) * exp(-q.z * 1.6) + 0.02 * uLayer * exp(-pow(q.z - 0.7, 2.0) * 3.0) * fbm(q.xy * 0.6);
      acc += lampAt(q) * shade(q) * dens * dt;
    }
    col += LED * acc * 0.3;
  }

  vec4 clip = uVP * vec4(ro + rd * t, 1.0);
  gl_FragDepth = t > 1e8 ? 1.0 : clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  o = vec4(col, refl);
}`;

const COPY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 o;
void main() { o = texture(uTex, vUv); }`;

const DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
out vec4 o;
void main() {
  vec3 s = texture(uTex, vUv).rgb * 4.0;
  s += texture(uTex, vUv + uTexel * vec2(-1, -1)).rgb;
  s += texture(uTex, vUv + uTexel * vec2(1, -1)).rgb;
  s += texture(uTex, vUv + uTexel * vec2(-1, 1)).rgb;
  s += texture(uTex, vUv + uTexel * vec2(1, 1)).rgb;
  s /= 8.0;
  o = vec4(max(s - uThreshold, 0.0), 1.0);
}`;

const UP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec3 s = vec3(0);
  s += texture(uTex, vUv + uTexel * vec2(-2, 0)).rgb;
  s += texture(uTex, vUv + uTexel * vec2(2, 0)).rgb;
  s += texture(uTex, vUv + uTexel * vec2(0, -2)).rgb;
  s += texture(uTex, vUv + uTexel * vec2(0, 2)).rgb;
  s += texture(uTex, vUv + uTexel * vec2(-1, -1)).rgb * 2.0;
  s += texture(uTex, vUv + uTexel * vec2(1, -1)).rgb * 2.0;
  s += texture(uTex, vUv + uTexel * vec2(-1, 1)).rgb * 2.0;
  s += texture(uTex, vUv + uTexel * vec2(1, 1)).rgb * 2.0;
  o = vec4(s / 12.0, 1.0);
}`;

const FINAL_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uBloom;
uniform float uExposure;
uniform float uSeed;
uniform vec2 uRes;
out vec4 o;
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float h(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec3 c = texture(uTex, vUv).rgb + texture(uBloom, vUv).rgb * 0.55;
  vec2 v = vUv - 0.5;
  c *= 1.0 - dot(v, v) * 0.55;
  c = aces(c * uExposure);
  c = pow(c, vec3(1.0 / 2.2));
  c += (h(vUv * uRes + uSeed) - 0.5) / 255.0 * 1.5;
  o = vec4(c, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  depth?: WebGLRenderbuffer;
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private drop: WebGLProgram;
  private room: WebGLProgram;
  private copy: WebGLProgram;
  private down: WebGLProgram;
  private up: WebGLProgram;
  private fin: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private quad: WebGLVertexArrayObject;
  private scaleTex: WebGLTexture;
  private scaleLen = 26;
  private float: boolean;
  private bg?: Target;
  private main?: Target;
  private chain: Target[] = [];
  private uploaded = 0;
  private dirty = true;
  private objects: Objects = {};
  private w = 1;
  private h = 1;
  private cssW = 1;
  private cssH = 1;
  vp: Mat = new Float32Array(16);
  invVp: Mat = new Float32Array(16);
  cam = [0, 0, 0];
  private pxScale = 1;
  dims: [number, number] = [30, 20];
  exposure = 1;
  private frost = 0;
  private layer = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.float = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.drop = compile(gl, DROP_VS, DROP_FS);
    this.room = compile(gl, QUAD_VS, ROOM_FS);
    this.copy = compile(gl, QUAD_VS, COPY_FS);
    this.down = compile(gl, QUAD_VS, DOWN_FS);
    this.up = compile(gl, QUAD_VS, UP_FS);
    this.fin = compile(gl, QUAD_VS, FINAL_FS);
    this.quad = gl.createVertexArray()!;
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, RING * STRIDE * 4, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, STRIDE * 4, i * 16);
    }
    gl.bindVertexArray(null);
    this.scaleTex = gl.createTexture()!;
    this.paintScale();
  }

  /** The painted scale along the front of the plate, drawn once into a texture. */
  paintScale(font = 'ui-monospace, monospace'): void {
    const gl = this.gl;
    const cm = Math.floor(this.dims[0] - 3);
    this.scaleLen = cm;
    const pxPerCm = 80;
    const c = document.createElement('canvas');
    c.width = cm * pxPerCm + 2;
    c.height = 72;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    for (let mm = 0; mm <= cm * 10; mm++) {
      const x = 1 + (mm * pxPerCm) / 10;
      const len = mm % 10 === 0 ? 34 : mm % 5 === 0 ? 22 : 12;
      g.fillRect(x - (mm % 10 === 0 ? 2 : 1.2), 0, mm % 10 === 0 ? 4 : 2.4, len);
    }
    g.font = `500 26px ${font}`;
    g.textBaseline = 'bottom';
    for (let i = 0; i <= cm; i += 1) {
      const label = i === cm ? `${i} cm` : String(i);
      g.fillText(label, 1 + i * pxPerCm + 5, c.height - 2);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.scaleTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.dirty = true;
  }

  private target(w: number, h: number, depth: boolean): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb: WebGLRenderbuffer | undefined;
    if (depth) {
      rb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, depth: rb, w, h };
  }

  private free(t?: Target): void {
    if (!t) return;
    const gl = this.gl;
    gl.deleteFramebuffer(t.fb);
    gl.deleteTexture(t.tex);
    if (t.depth) gl.deleteRenderbuffer(t.depth);
  }

  /** Size the buffers and frame the chamber inside the free part of the screen. */
  resize(cssW: number, cssH: number, dpr: number, insets: Insets, dims: [number, number]): void {
    const gl = this.gl;
    const scale = Math.min(dpr, Math.sqrt(3.2e6 / (cssW * cssH)));
    this.w = Math.max(1, Math.round(cssW * scale));
    this.h = Math.max(1, Math.round(cssH * scale));
    this.cssW = cssW;
    this.cssH = cssH;
    if (this.canvas.width !== this.w || this.canvas.height !== this.h) {
      this.canvas.width = this.w;
      this.canvas.height = this.h;
    }
    if (dims[0] !== this.dims[0] || dims[1] !== this.dims[1]) {
      this.dims = dims;
      this.paintScale();
    }
    this.free(this.bg);
    this.free(this.main);
    this.chain.forEach((t) => this.free(t));
    this.bg = this.target(this.w, this.h, true);
    this.main = this.target(this.w, this.h, true);
    this.chain = [];
    let w = this.w;
    let h = this.h;
    for (let i = 0; i < 5; i++) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      this.chain.push(this.target(w, h, false));
    }
    this.frame(insets);
    this.dirty = true;
    gl.viewport(0, 0, this.w, this.h);
  }

  private frame(ins: Insets): void {
    const [W, D] = this.dims;
    const portrait = this.cssH > this.cssW;
    const pitch = ((portrait ? 60 : 52) * Math.PI) / 180;
    const fov = ((portrait ? 34 : 28) * Math.PI) / 180;
    const aspect = this.cssW / this.cssH;
    const target = [W / 2, D / 2 + (portrait ? 1.5 : 0.8), 0];
    const fwd = [0, Math.cos(pitch), -Math.sin(pitch)];
    const proj = perspective(fov, aspect, 2, 400);
    const pts: number[][] = [];
    const m = MARGIN;
    for (const x of [-m, W + m]) for (const y of [-m, D + m]) pts.push([x, y, 0]);
    pts.push([0, D, portrait ? 6 : 3], [W, D, portrait ? 6 : 3]);
    const safeW = (2 * (this.cssW - ins.left - ins.right)) / this.cssW;
    const safeH = (2 * (this.cssH - ins.top - ins.bottom)) / this.cssH;
    const bbox = (dist: number) => {
      const eye = [target[0] - fwd[0] * dist, target[1] - fwd[1] * dist, target[2] - fwd[2] * dist];
      const vp = mul(proj, lookAt(eye, target));
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const [x, y, z] of pts) {
        const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
        const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
        const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
        x0 = Math.min(x0, cx / cw);
        x1 = Math.max(x1, cx / cw);
        y0 = Math.min(y0, cy / cw);
        y1 = Math.max(y1, cy / cw);
      }
      return { eye, vp, x0, x1, y0, y1 };
    };
    let lo = 10;
    let hi = 400;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const b = bbox(mid);
      if (b.x1 - b.x0 <= safeW && b.y1 - b.y0 <= safeH) hi = mid;
      else lo = mid;
    }
    const b = bbox(hi);
    const cxSafe = -1 + (2 * ins.left) / this.cssW + safeW / 2;
    const cySafe = 1 - (2 * ins.top) / this.cssH - safeH / 2;
    const shift = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    shift[12] = cxSafe - (b.x0 + b.x1) / 2;
    shift[13] = cySafe - (b.y0 + b.y1) / 2;
    this.vp = mul(shift, b.vp);
    this.invVp = invert(this.vp);
    this.cam = b.eye;
    this.pxScale = (proj[5] * this.h) / 2;
  }

  /** Frost and the mist sheet, which change as the plate cools; redraws the room when they move. */
  setCooling(frost: number, layer: number): void {
    if (frost === this.frost && layer === this.layer) return;
    const small = Math.abs(frost - this.frost) < 0.02 && Math.abs(layer - this.layer) < 0.02;
    if (small && frost < 1 && layer < 1) return;
    this.frost = frost;
    this.layer = layer;
    this.dirty = true;
  }

  setObjects(o: Objects): void {
    this.objects = o;
    this.dirty = true;
  }

  /** World point to CSS pixels. */
  project(x: number, y: number, z: number): [number, number, number] {
    const v = this.vp;
    const cx = v[0] * x + v[4] * y + v[8] * z + v[12];
    const cy = v[1] * x + v[5] * y + v[9] * z + v[13];
    const cw = v[3] * x + v[7] * y + v[11] * z + v[15];
    return [((cx / cw) * 0.5 + 0.5) * this.cssW, (1 - ((cy / cw) * 0.5 + 0.5)) * this.cssH, cw];
  }

  /** Where a CSS pixel's ray meets the horizontal plane z. */
  unproject(px: number, py: number, z: number): [number, number] | null {
    const nx = (px / this.cssW) * 2 - 1;
    const ny = 1 - (py / this.cssH) * 2;
    const m = this.invVp;
    const at = (nz: number) => {
      const x = m[0] * nx + m[4] * ny + m[8] * nz + m[12];
      const y = m[1] * nx + m[5] * ny + m[9] * nz + m[13];
      const zz = m[2] * nx + m[6] * ny + m[10] * nz + m[14];
      const w = m[3] * nx + m[7] * ny + m[11] * nz + m[15];
      return [x / w, y / w, zz / w];
    };
    const a = at(-1);
    const b = at(1);
    const dz = b[2] - a[2];
    if (Math.abs(dz) < 1e-9) return null;
    const t = (z - a[2]) / dz;
    if (t < 0) return null;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  private uniforms(p: WebGLProgram): void {
    const gl = this.gl;
    const o = this.objects;
    const u = (n: string) => gl.getUniformLocation(p, n);
    gl.uniform2f(u('uDim'), this.dims[0], this.dims[1]);
    gl.uniform4f(u('uMarble'), o.marble?.x ?? 0, o.marble?.y ?? 0, MARBLE_R, o.marble ? 1 : 0);
    gl.uniform4f(u('uRod'), o.rod?.ax ?? 0, o.rod?.ay ?? 0, o.rod?.bx ?? 0, o.rod?.by ?? 0);
    gl.uniform1f(u('uRodOn'), o.rod ? 1 : 0);
    gl.uniform4f(u('uSalt'), o.salt?.x ?? 0, o.salt?.y ?? 0, o.salt ? SALT_R : 0, SALT_H);
  }

  private drawRoom(): void {
    const gl = this.gl;
    const bg = this.bg!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, bg.fb);
    gl.viewport(0, 0, bg.w, bg.h);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.room);
    this.uniforms(this.room);
    const u = (n: string) => gl.getUniformLocation(this.room, n);
    gl.uniformMatrix4fv(u('uInvVP'), false, this.invVp);
    gl.uniformMatrix4fv(u('uVP'), false, this.vp);
    gl.uniform3f(u('uCam'), this.cam[0], this.cam[1], this.cam[2]);
    gl.uniform1f(u('uH'), H);
    gl.uniform1f(u('uMargin'), MARGIN);
    const mg = this.objects.magnet;
    gl.uniform3f(u('uMagnet'), mg?.x ?? 0, mg?.y ?? 0, mg ? 1 : 0);
    gl.uniform1f(u('uScaleLen'), this.scaleLen);
    gl.uniform1f(u('uFrost'), this.frost);
    gl.uniform1f(u('uLayer'), this.layer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scaleTex);
    gl.uniform1i(u('uScale'), 0);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthFunc(gl.LESS);
    this.dirty = false;
  }

  private upload(ch: Chamber): void {
    const gl = this.gl;
    const n = ch.written;
    if (n === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const end = ch.head;
    const start = (end - n + RING) % RING;
    if (n >= RING) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, ch.data);
    } else if (start < end) {
      gl.bufferSubData(gl.ARRAY_BUFFER, start * STRIDE * 4, ch.data, start * STRIDE, n * STRIDE);
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, start * STRIDE * 4, ch.data, start * STRIDE, (RING - start) * STRIDE);
      if (end > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, ch.data, 0, end * STRIDE);
    }
    ch.written = 0;
    this.uploaded += n;
  }

  /** Drop every droplet, after a rotation changes the tank's shape. */
  clear(ch: Chamber): void {
    ch.data.fill(0);
    ch.written = RING;
    ch.tracks = [];
  }

  private drops(ch: Chamber, mirror: boolean, highlight: number): void {
    const gl = this.gl;
    gl.useProgram(this.drop);
    this.uniforms(this.drop);
    const u = (n: string) => gl.getUniformLocation(this.drop, n);
    gl.uniformMatrix4fv(u('uVP'), false, this.vp);
    gl.uniform3f(u('uCam'), this.cam[0], this.cam[1], this.cam[2]);
    gl.uniform1f(u('uTime'), ch.time);
    gl.uniform1f(u('uMirror'), mirror ? -1 : 1);
    gl.uniform1f(u('uPx'), this.pxScale);
    gl.uniform1f(u('uHighlight'), highlight);
    gl.uniform1f(u('uGain'), (this.float ? 1 : 0.6) * (mirror ? 0.9 : 1));
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, RING);
  }

  private pass(prog: WebGLProgram, src: WebGLTexture, dst: Target | null, setup?: (u: (n: string) => WebGLUniformLocation | null) => void): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, dst ? dst.w : this.w, dst ? dst.h : this.h);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    gl.uniform1i(u('uTex'), 0);
    setup?.(u);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(ch: Chamber, highlight: number): void {
    const gl = this.gl;
    if (!this.main || !this.bg) return;
    if (this.dirty) this.drawRoom();
    this.upload(ch);
    const main = this.main;
    // Copy the room's depth into the frame.
    gl.depthMask(true);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.bg.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, main.fb);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, main.fb);
    gl.viewport(0, 0, main.w, main.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // 1. Reflections.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.drops(ch, true, highlight);
    // 2. The room over them, keeping what the film reflects.
    gl.blendFunc(gl.ONE, gl.SRC_ALPHA);
    gl.useProgram(this.copy);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bg.tex);
    gl.uniform1i(gl.getUniformLocation(this.copy, 'uTex'), 0);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 3. Droplets.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.drops(ch, false, highlight);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    // 4. Bloom.
    let src = main.tex;
    let texel = [1 / main.w, 1 / main.h];
    this.chain.forEach((t, i) => {
      const tx = texel;
      this.pass(this.down, src, t, (u) => {
        gl.uniform2f(u('uTexel'), tx[0], tx[1]);
        gl.uniform1f(u('uThreshold'), i === 0 ? 0.35 : 0);
      });
      src = t.tex;
      texel = [1 / t.w, 1 / t.h];
    });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.chain.length - 1; i > 0; i--) {
      const s = this.chain[i];
      this.pass(this.up, s.tex, this.chain[i - 1], (u) => gl.uniform2f(u('uTexel'), 0.5 / s.w, 0.5 / s.h));
    }
    gl.disable(gl.BLEND);
    this.pass(this.fin, main.tex, null, (u) => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.chain[0].tex);
      gl.uniform1i(u('uBloom'), 1);
      gl.uniform1f(u('uExposure'), this.exposure);
      gl.uniform1f(u('uSeed'), Math.random() * 100);
      gl.uniform2f(u('uRes'), this.w, this.h);
    });
  }
}
