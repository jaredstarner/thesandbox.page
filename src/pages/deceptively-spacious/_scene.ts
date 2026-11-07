// The shaders. Each pixel sends one ray along a geodesic of the floor, climbing or falling at a constant slope, and
// walks it through a small cell complex: the room, and the short tunnel through the wall at each door. Reaching the
// outer end of a tunnel applies that door's side pairing to the ray, which puts it back in the same room at the
// paired door. Every "next room" is therefore this room again: there is one set of walls, one set of furniture, and
// one figure, and a ray meets them as many times as it crosses.
//
// The loop only finds what the ray ends on. All shading, and every derivative, happens once, after the loop.

export const MAX_SIDES = 8;
export const MAX_PROPS = 8;
export const MAX_DECALS = 4;

export const FIGURE = 1;
export const LAMP = 2;
export const CHAIR = 3;
export const TABLE = 4;

export const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const SDF = /* glsl */ `
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float sdCyl(vec3 p, float r, float h) {
  vec2 d = vec2(length(p.xy) - r, abs(p.z) - h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float sdBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float sdCone(vec3 p, float z0, float r0, float z1, float r1) {
  // A capped cone about the z axis, from a 2D section.
  vec2 q = vec2(length(p.xy), p.z);
  vec2 a = vec2(r0, z0), b = vec2(r1, z1);
  vec2 ba = b - a, pa = q - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  vec2 c = pa - ba * t;
  float side = (q.x - mix(r0, r1, clamp((q.y - z0) / (z1 - z0), 0.0, 1.0)));
  float cap = max(z0 - q.y, q.y - z1);
  float inside = max(side, cap);
  return inside < 0.0 ? inside : min(length(c), length(max(vec2(side, cap), 0.0)));
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Figure: 0 coat, 1 trousers, 2 skin, 3 hat, 4 paper.
vec2 figure(vec3 p) {
  float sw = uSwing * sin(uStride);
  vec3 c = vec3(p.x, p.y * 1.3, p.z);
  float coat = sdCone(c, 0.68, 0.285, 1.44, 0.205) / 1.3 - 0.02;
  coat = smin(coat, sdCapsule(p, vec3(-0.17, 0.0, 1.43), vec3(0.17, 0.0, 1.43), 0.055), 0.05);
  vec2 d = vec2(coat, 0.0);
  float arm = sdCapsule(p, vec3(-0.235, 0.0, 1.42), vec3(-0.285, -sw * 0.18, 0.93), 0.056);
  arm = min(arm, sdCapsule(p, vec3(0.235, 0.0, 1.42), vec3(0.285, 0.05, 1.12), 0.056));
  arm = min(arm, sdCapsule(p, vec3(0.285, 0.05, 1.12), vec3(0.22, 0.27, 1.13), 0.05));
  if (arm < d.x) d = vec2(arm, 0.0);
  float legs = min(
    sdCapsule(p, vec3(-0.1, 0.0, 0.78), vec3(-0.1, sw * 0.3, 0.1), 0.072),
    sdCapsule(p, vec3(0.1, 0.0, 0.78), vec3(0.1, -sw * 0.3, 0.1), 0.072)
  );
  legs = min(legs, min(
    sdCapsule(p, vec3(-0.1, sw * 0.3 - 0.02, 0.05), vec3(-0.1, sw * 0.3 + 0.13, 0.05), 0.05),
    sdCapsule(p, vec3(0.1, -sw * 0.3 - 0.02, 0.05), vec3(0.1, -sw * 0.3 + 0.13, 0.05), 0.05)
  ));
  if (legs < d.x) d = vec2(legs, 1.0);
  float head = length((p - vec3(0.0, 0.01, 1.585)) / vec3(0.085, 0.095, 0.11)) - 1.0;
  head = head * 0.085;
  head = min(head, sdCapsule(p, vec3(0.0, 0.0, 1.42), vec3(0.0, 0.0, 1.52), 0.05));
  float hands = min(length(p - vec3(-0.29, -sw * 0.18, 0.89)) - 0.05, length(p - vec3(0.2, 0.3, 1.13)) - 0.048);
  head = min(head, hands);
  if (head < d.x) d = vec2(head, 2.0);
  float hat = sdCyl(p - vec3(0.0, 0.0, 1.645), 0.175, 0.006) - 0.004;
  hat = min(hat, sdCyl(p - vec3(0.0, 0.0, 1.705), 0.092, 0.056) - 0.012);
  if (hat < d.x) d = vec2(hat, 3.0);
  // The particulars, held up in the right hand. This is how you tell your hands apart.
  vec3 q = p - vec3(0.13, 0.33, 1.14);
  q.yz = mat2(0.86, 0.5, -0.5, 0.86) * q.yz;
  float sheet = sdBox(q, vec3(0.105, 0.002, 0.15), 0.002);
  if (sheet < d.x) d = vec2(sheet, 4.0);
  return d;
}

// Lamp: 0 brass, 1 shade.
vec2 lamp(vec3 p) {
  float base = sdCyl(p - vec3(0.0, 0.0, 0.03), 0.15, 0.012) - 0.012;
  base = min(base, sdCapsule(p, vec3(0.0), vec3(0.0, 0.0, 1.42), 0.012));
  float shade = sdCone(p, 1.34, 0.235, 1.6, 0.13);
  return shade < base ? vec2(shade, 1.0) : vec2(base, 0.0);
}

// Chair: 0 fabric, 1 wood.
vec2 chair(vec3 p) {
  vec3 q = vec3(abs(p.x), p.yz);
  float seat = sdBox(q - vec3(0.0, 0.03, 0.34), vec3(0.25, 0.26, 0.06), 0.05);
  seat = smin(seat, sdBox(q - vec3(0.0, -0.31, 0.62), vec3(0.27, 0.05, 0.28), 0.05), 0.05);
  seat = smin(seat, sdBox(q - vec3(0.35, 0.0, 0.42), vec3(0.04, 0.28, 0.16), 0.045), 0.04);
  float leg = min(sdCapsule(q, vec3(0.32, 0.27, 0.0), vec3(0.32, 0.27, 0.22), 0.018),
                  sdCapsule(q, vec3(0.32, -0.3, 0.0), vec3(0.32, -0.3, 0.22), 0.018));
  return leg < seat ? vec2(leg, 1.0) : vec2(seat, 0.0);
}

// Table: 0 wood, 1 vase, 2 flowers.
vec2 table(vec3 p) {
  float wood = sdCyl(p - vec3(0.0, 0.0, 0.68), 0.33, 0.012) - 0.008;
  wood = min(wood, sdCapsule(p, vec3(0.0, 0.0, 0.05), vec3(0.0, 0.0, 0.68), 0.022));
  wood = min(wood, sdCyl(p - vec3(0.0, 0.0, 0.03), 0.17, 0.01) - 0.012);
  vec2 d = vec2(wood, 0.0);
  float vase = length((p - vec3(0.0, 0.0, 0.8)) / vec3(0.075, 0.075, 0.11)) - 1.0;
  vase = smin(vase * 0.075, sdCyl(p - vec3(0.0, 0.0, 0.92), 0.03, 0.03), 0.03);
  if (vase < d.x) d = vec2(vase, 1.0);
  float bloom = min(length(p - vec3(0.05, 0.03, 1.1)) - 0.06, length(p - vec3(-0.07, 0.02, 1.06)) - 0.052);
  bloom = min(bloom, length(p - vec3(0.0, -0.07, 1.14)) - 0.056);
  bloom = min(bloom, sdCapsule(p, vec3(0.0, 0.0, 0.94), vec3(0.03, 0.01, 1.08), 0.006));
  if (bloom < d.x) d = vec2(bloom, 2.0);
  return d;
}

vec2 sdf(int kind, vec3 p) {
  if (kind == ${FIGURE}) return figure(p);
  if (kind == ${LAMP}) return lamp(p);
  if (kind == ${CHAIR}) return chair(p);
  return table(p);
}
`;

export function sceneFragment(kappa: number): string {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
#define K ${kappa}
#define PI 3.14159265359
#define INF 1e9
#define MAXC 6

layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oData;

uniform vec2 uRes;
uniform float uFocal;
uniform vec3 uEye, uFwd, uRight;
uniform float uEyeZ, uPitch, uUp;
uniform int uCell, uN;
uniform vec3 uWall[${MAX_SIDES}], uOuter[${MAX_SIDES}], uJambA[${MAX_SIDES}], uJambB[${MAX_SIDES}];
uniform vec2 uAlong[${MAX_SIDES}];
uniform mat3 uG[${MAX_SIDES}];
uniform int uPair[${MAX_SIDES}], uFlip[${MAX_SIDES}], uDoorInk[${MAX_SIDES}];
uniform float uHeight, uDoorW, uDoorH, uUnit, uExtent;
uniform vec3 uLamp;
uniform float uLampZ;
uniform int uPropN;
uniform vec3 uPropC[${MAX_PROPS}], uPropR[${MAX_PROPS}], uPropF[${MAX_PROPS}];
uniform int uPropKind[${MAX_PROPS}], uPropAbove[${MAX_PROPS}];
uniform float uPropRad[${MAX_PROPS}], uPropTall[${MAX_PROPS}];
uniform float uStride, uSwing, uHour, uMinute;
uniform int uPaper, uFloor, uFold;
uniform vec3 uWallA, uWallB, uDado, uTrim, uFloorA, uFloorB, uCeil, uRugA, uRugB, uFabric;
uniform vec3 uDoors[4];
uniform int uDecalN;
uniform int uDecalWall[${MAX_DECALS}], uDecalClock[${MAX_DECALS}];
uniform vec4 uDecalBox[${MAX_DECALS}], uDecalUV[${MAX_DECALS}];
uniform vec4 uLetter[${MAX_SIDES}];
uniform sampler2D uAtlas, uMarks;

${SDF}

float Ck(float s) {
#if K == 0
  return 1.0;
#elif K == 1
  return cos(s);
#else
  return cosh(s);
#endif
}
float Sk(float s) {
#if K == 0
  return s;
#elif K == 1
  return sin(s);
#else
  return sinh(s);
#endif
}
float SkInv(float x) {
#if K == 0
  return x;
#elif K == 1
  return asin(clamp(x, -1.0, 1.0));
#else
  return asinh(x);
#endif
}
float mdot(vec3 a, vec3 b) {
#if K == 0
  return dot(a.xy, b.xy);
#elif K == 1
  return dot(a, b);
#else
  return a.x * b.x + a.y * b.y - a.z * b.z;
#endif
}
float gdist(vec3 a, vec3 b) {
#if K == 0
  return length(a.xy - b.xy);
#elif K == 1
  return acos(clamp(dot(a, b), -1.0, 1.0));
#else
  return acosh(max(1.0, -mdot(a, b)));
#endif
}
vec3 walk(vec3 p, vec3 d, float s) { return Ck(s) * p + Sk(s) * d; }
vec3 walkDir(vec3 p, vec3 d, float s) {
#if K == 0
  return d;
#elif K == 1
  return -sin(s) * p + cos(s) * d;
#else
  return sinh(s) * p + cosh(s) * d;
#endif
}

// Distance along the ray to a line it is on the positive side of, or INF.
float hitLine(vec3 n, vec3 p, vec3 d) {
  float A = dot(n, p), B = dot(n, d);
#if K == 0
  return B < -1e-7 ? max(-A / B, 0.0) : INF;
#elif K == 1
  return max(atan(A, -B), 0.0);
#else
  if (B >= -1e-7) return INF;
  float u = A / -B;
  return u < 0.999999 ? atanh(max(u, 0.0)) : INF;
#endif
}

// The stretch of the ray inside the circle of radius r about c. Empty when x > y.
vec2 circle(vec3 c, float r, vec3 p, vec3 d) {
#if K == 0
  vec2 o = p.xy - c.xy;
  float b = dot(o, d.xy), e = dot(o, o) - r * r, D = b * b - e;
  if (D < 0.0) return vec2(1.0, 0.0);
  D = sqrt(D);
  return vec2(-b - D, -b + D);
#elif K == 1
  float A = dot(p, c), B = dot(d, c), R = sqrt(A * A + B * B);
  float q = cos(r) / max(R, 1e-6);
  if (q >= 1.0) return vec2(1.0, 0.0);
  float ph = atan(B, A), w = acos(q);
  return vec2(ph - w, ph + w);
#else
  float A = -mdot(p, c), B = -mdot(d, c), q = cosh(r);
  float a = A + B, b = A - B, D = q * q - a * b;
  if (D < 0.0) return vec2(1.0, 0.0);
  D = sqrt(D);
  return vec2(log(max((q - D) / a, 1e-5)), log((q + D) / a));
#endif
}

// Coordinates of q in a prop's own flat chart, centred on c, in units.
vec2 local(vec3 q, vec3 c, vec3 r, vec3 f) {
#if K == 0
  vec2 o = q.xy - c.xy;
  return vec2(dot(o, r.xy), dot(o, f.xy));
#elif K == 1
  return vec2(dot(q, r), dot(q, f)) / dot(q, c);
#else
  return vec2(mdot(q, r), mdot(q, f)) / -mdot(q, c);
#endif
}

// Marches one prop along the ray, between 0 and limit. On a hit, shortens limit and fills in where.
bool marchProp(int j, vec3 p, vec3 d, float z, float m, inout float limit, out vec3 where, out float mat) {
  where = vec3(0.0);
  mat = 0.0;
  vec3 c = uPropC[j];
  vec2 span = circle(c, uPropRad[j], p, d);
  span.x = max(span.x, 0.0);
  span.y = min(span.y, limit);
  if (span.x >= span.y) return false;
  float z0 = z + m * span.x, z1 = z + m * span.y;
  bool above = uPropAbove[j] == 1;
  if (above) { z0 = uHeight - z0; z1 = uHeight - z1; }
  float tall = uPropTall[j];
  if ((z0 > tall && z1 > tall) || (z0 < 0.0 && z1 < 0.0)) return false;
  vec3 r = uPropR[j], f = uPropF[j];
  vec3 a = vec3(local(walk(p, d, span.x), c, r, f), z0) * uUnit;
  vec3 b = vec3(local(walk(p, d, span.y), c, r, f), z1) * uUnit;
  vec3 dir = b - a;
  float len = length(dir);
  if (len < 1e-4) return false;
  dir /= len;
  int kind = uPropKind[j];
  float t = 0.0;
  for (int i = 0; i < 40; i++) {
    vec3 q = a + dir * t;
    vec2 h = sdf(kind, q);
    if (h.x < 0.0025) {
      where = q;
      mat = h.y;
      limit = mix(span.x, span.y, t / len);
      return true;
    }
    t += h.x;
    if (t > len) break;
  }
  return false;
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.3 + 7.1) + 0.15 * vnoise(p * 5.1 + 3.7);
}

// A wash of colour over paper: three flat tones with a dry, slightly uneven edge between them.
vec3 wash(vec3 base, float v, vec2 st) {
  float n = fbm(st * 2.6);
  float lv = v + (n - 0.5) * 0.09;
  float dark = smoothstep(0.34, 0.4, lv);
  float light = smoothstep(0.72, 0.84, lv);
  vec3 under = base * vec3(0.72, 0.71, 0.78);
  vec3 over = mix(base, vec3(1.0, 0.97, 0.9), 0.24);
  vec3 c = mix(under, base, dark);
  return mix(c, over, light) * (0.97 + 0.06 * n);
}

// Pen hatching in the shadow tone; st is in metres on the surface, and it fades before it can alias.
float hatch(vec2 st, float v, float fw) {
  float a = fract((st.x + st.y) / 0.055);
  float line = smoothstep(0.32, 0.18, abs(a - 0.5));
  float vis = 1.0 - smoothstep(0.008, 0.024, fw);
  return line * vis * (1.0 - smoothstep(0.26, 0.37, v));
}

float rule(float v, float at, float w, float fw) {
  float c = 1.0 - smoothstep(w * 0.5, w * 0.5 + fw, abs(v - at));
  return c * min(1.0, w / max(fw, 1e-4));
}

float shadowAt(vec3 q, float hz) {
  float dh = gdist(q, uLamp);
  if (dh < 1e-3) return 1.0;
  vec3 line = cross(q, uLamp);
#if K == 0
  line /= max(length(line.xy), 1e-6);
#elif K == 1
  line /= max(length(line), 1e-6);
#else
  line /= sqrt(max(line.x * line.x + line.y * line.y - line.z * line.z, 1e-9));
#endif
  float lit = 1.0;
  for (int j = 0; j < uPropN; j++) {
    if (uPropRad[j] <= 0.0 || uPropKind[j] == ${LAMP} || uPropAbove[j] == 1) continue;
    float r = uPropRad[j] * (uPropKind[j] == ${FIGURE} ? 0.5 : 0.8);
    float dc = SkInv(abs(dot(line, uPropC[j])));
    if (dc > r) continue;
    float t = gdist(q, uPropC[j]) / dh;
    if (t > 1.0) continue;
    float ray = hz + (uLampZ - hz) * t;
    if (ray < uPropTall[j]) lit = min(lit, smoothstep(r * 0.65, r, dc));
  }
  return lit;
}

float lightAt(vec3 q, float hz, float cosine) {
  float dh = Sk(gdist(q, uLamp));
  float dv = uLampZ - hz;
  float r2 = (dh * dh + dv * dv) * uUnit * uUnit;
  return (0.3 + 0.7 / (1.0 + 0.05 * r2)) * (0.5 + 0.5 * cosine);
}

float nearestWall(vec3 q) {
  float m = INF;
  for (int k = 0; k < uN; k++) m = min(m, dot(uWall[k], q));
  return SkInv(m) * uUnit;
}

vec3 paperTone() { return vec3(0.945, 0.915, 0.845); }

// The ray, and what it ended on: 0 nothing, 1 wall, 2 floor, 3 ceiling, 4 jamb, 5 lintel, 6 threshold, 7 prop.
vec3 rP, rD;
float rZ, rM, total;
int crossings;
int what, index;
vec3 hitQ, hitLocal;
float hitZ, hitMat;

void endAt(int kind, int i, float s) {
  what = kind;
  index = i;
  hitQ = walk(rP, rD, s);
  hitZ = rZ + rM * s;
  total += s;
}

void advance(float s) {
  vec3 q = walk(rP, rD, s);
  rD = walkDir(rP, rD, s);
  rP = q;
  rZ += rM * s;
  total += s;
}

// Tests the props against the ray up to limit; true if one stops it.
bool props(inout float limit) {
  bool hit = false;
  for (int j = 0; j < uPropN; j++) {
    if (uPropRad[j] <= 0.0) continue;
    if (uPropKind[j] == ${FIGURE} && crossings == 0) continue;
    vec3 w = vec3(0.0);
    float mt = 0.0;
    float lim = limit;
    bool h = marchProp(j, rP, rD, rZ, rM, lim, w, mt);
    if (h) {
      hit = true;
      limit = lim;
      index = j;
      hitLocal = w;
      hitMat = mt;
    }
  }
  return hit;
}

// Crosses the room from wherever the ray is. Returns the wall of the door it leaves by, or -1 if it stopped.
int roomLeg(int arrivedBy) {
  float best = INF;
  int wall = 0;
  for (int k = 0; k < uN; k++) {
    if (k != arrivedBy) {
      float s = hitLine(uWall[k], rP, rD);
      if (s < best) { best = s; wall = k; }
    }
  }
  float sz = rM > 0.0 ? (uHeight - rZ) / rM : (rM < 0.0 ? -rZ / rM : INF);
  float limit = min(best, sz);
  if (props(limit)) {
    endAt(7, index, limit);
    return -1;
  }
  if (sz < best) {
    endAt(rM < 0.0 ? 2 : 3, -1, sz);
    return -1;
  }
  vec3 q = walk(rP, rD, best);
  float hz = rZ + rM * best;
  float a = SkInv(dot(q.xy, uAlong[wall]));
  if (abs(a) < uDoorW && hz < uDoorH) {
    advance(best);
    return wall;
  }
  endAt(1, wall, best);
  return -1;
}

// Runs along the door in wall k. from: 0 anywhere inside, 1 the room end, 2 the far end.
// Returns 0 if the ray stopped, 1 at the room end, 2 at the far end.
int doorLeg(int k, int from) {
  float best = INF;
  int leave = 0;
  if (from != 2) {
    float s = hitLine(uOuter[k], rP, rD);
    if (s < best) { best = s; leave = 2; }
  }
  if (from != 1) {
    float s = hitLine(-uWall[k], rP, rD);
    if (s < best) { best = s; leave = 1; }
  }
  float ja = hitLine(uJambA[k], rP, rD);
  if (ja < best) { best = ja; leave = 3; }
  float jb = hitLine(uJambB[k], rP, rD);
  if (jb < best) { best = jb; leave = 3; }
  float top = min(uDoorH, uHeight);
  float sz = rM > 0.0 ? (top - rZ) / rM : (rM < 0.0 ? -rZ / rM : INF);
  if (sz < best) {
    endAt(rM < 0.0 ? 6 : (top < uHeight ? 5 : 3), k, sz);
    return 0;
  }
  if (leave == 3) {
    endAt(4, k, best);
    return 0;
  }
  advance(best);
  return leave;
}

void applyPairing(int k) {
  rP = uG[k] * rP;
  rD = uG[k] * rD;
  if (uFlip[k] == 1) {
    rZ = uHeight - rZ;
    rM = -rM;
  }
  crossings++;
}

void trace() {
  int arrivedBy = -1;
  bool going = true;
  if (uCell >= 0) {
    int end = doorLeg(uCell, 0);
    if (end == 0) {
      going = false;
    } else if (end == 1) {
      arrivedBy = uCell;
    } else {
      applyPairing(uCell);
      arrivedBy = uPair[uCell];
      going = doorLeg(arrivedBy, 2) != 0;
    }
  }
  for (int i = 0; i < MAXC && going; i++) {
    int wall = roomLeg(arrivedBy);
    if (wall < 0) {
      going = false;
    } else if (doorLeg(wall, 1) == 0) {
      going = false;
    } else {
      applyPairing(wall);
      arrivedBy = uPair[wall];
      going = doorLeg(arrivedBy, 2) != 0;
    }
  }
}

void main() {
  vec2 c = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y);
  float sp = sin(uPitch), cp = cos(uPitch);
  float vy = c.y * cp + uFocal * sp;
  float vz = -c.y * sp + uFocal * cp;
  float l = length(vec2(c.x, vz));
  rP = uEye;
  rD = (c.x * uRight + vz * uFwd) / l;
  rM = vy / l * uUp;
  rZ = uEyeZ;
  total = 0.0;
  crossings = 0;
  what = 0;
  index = -1;
  hitQ = rP;
  hitZ = rZ;
  hitLocal = vec3(0.0);
  hitMat = 0.0;

  trace();

  float dist = total * uUnit;
  float fade = 1.0 - exp(-pow(dist / 30.0, 2.0));
  fade = max(fade, smoothstep(float(MAXC) - 2.5, float(MAXC) - 0.2, float(crossings)));
  vec3 paper = paperTone();
  vec3 col = paper;
  float id = 0.0;
  vec3 ink = vec3(0.17, 0.145, 0.13);

  if (what == 1) {
    // ------------------------------------------------------------------ wall
    int k = index;
    float a = SkInv(dot(hitQ.xy, uAlong[k])) * uUnit;
    float zm = hitZ * uUnit;
    float top = uHeight * uUnit;
    float fz = uFold == 1 ? min(zm, top - zm) : zm;
    vec2 fwv = vec2(fwidth(a), fwidth(zm));
    fwv = min(fwv, vec2(0.08));
    float fa = fwv.x, ff = fwv.y;

    vec3 base = uWallA;
    float pat = 0.0;
    float strength = 1.0;
    if (uPaper == 0) {
      float s = fract(a / 0.24);
      pat = smoothstep(0.25 - fa * 4.0, 0.25, s) * (1.0 - smoothstep(0.75, 0.75 + fa * 4.0, s));
      strength = 1.0 - smoothstep(0.03, 0.09, fa);
    } else if (uPaper == 1) {
      vec2 st = vec2(a, fz) / 0.19;
      st.x += 0.5 * floor(st.y);
      pat = 1.0 - smoothstep(0.17, 0.2, length(fract(st) - 0.5));
      strength = 1.0 - smoothstep(0.02, 0.06, fa);
    } else if (uPaper == 2) {
      float s = abs(fract(a / 0.42) - 0.5);
      pat = 1.0 - smoothstep(0.12, 0.13 + fa, s);
      strength = 1.0 - smoothstep(0.05, 0.14, fa);
    } else if (uPaper == 3) {
      float s = abs(fract(a / 0.9) - 0.5);
      pat = smoothstep(0.41, 0.42, s);
      strength = 1.0 - smoothstep(0.05, 0.14, fa);
    } else {
      float x = a / 0.42, y = fz / 0.56;
      float w1 = abs(sin(PI * x) * 0.5 - fract(y) + 0.5);
      float w2 = abs(-sin(PI * x) * 0.5 - fract(y) + 0.5);
      pat = 1.0 - smoothstep(0.035, 0.07, min(w1, w2));
      strength = 1.0 - smoothstep(0.03, 0.08, fa);
    }
    base = mix(uWallA, uWallB, pat * strength + 0.25 * (1.0 - strength));

    // Zones of the wall, up from the skirting.
    float lines = 0.0;
    if (fz < 0.16) {
      base = uTrim;
    } else if (fz < 0.92) {
      base = uDado;
    } else if (fz > 2.34) {
      base = mix(uDado, uTrim, 0.5);
    }
    lines = max(lines, rule(fz, 0.16, 0.012, ff));
    lines = max(lines, rule(fz, 0.92, 0.012, ff));
    lines = max(lines, rule(fz, 0.955, 0.008, ff) * 0.6);
    lines = max(lines, rule(fz, 2.34, 0.012, ff));

    // Pictures and the clock.
    float pictureEdge = 0.0;
    for (int i = 0; i < uDecalN; i++) {
      if (uDecalWall[i] != k) continue;
      vec4 box = uDecalBox[i];
      vec2 uv = (vec2(a, zm) - box.xy) / box.zw + 0.5;
      if (uv.x > -0.02 && uv.x < 1.02 && uv.y > -0.02 && uv.y < 1.02) {
        vec2 clamped = clamp(uv, 0.0, 1.0);
        vec4 t = textureLod(uAtlas, uDecalUV[i].xy + clamped * uDecalUV[i].zw, 0.0);
        base = mix(base, t.rgb, t.a);
        if (uDecalClock[i] == 1) {
          vec2 pt = (clamped - 0.5) * 2.0;
          vec2 h = vec2(sin(uHour), cos(uHour));
          vec2 mn = vec2(sin(uMinute), cos(uMinute));
          float dh = abs(dot(pt, vec2(h.y, -h.x)));
          float dm = abs(dot(pt, vec2(mn.y, -mn.x)));
          float th = dot(pt, h), tm = dot(pt, mn);
          float hand = max(step(th, 0.48) * step(-0.08, th) * step(dh, 0.034), step(tm, 0.74) * step(-0.08, tm) * step(dm, 0.02));
          base = mix(base, ink, hand);
        }
        pictureEdge = 1.0;
      } else {
        vec2 o = abs(uv - 0.5) * box.zw - box.zw * 0.5;
        float gap = length(max(o - vec2(0.0, 0.0), 0.0));
        // A soft shadow under the frame, down and to the side.
        vec2 sh = abs(uv - vec2(0.5, 0.48)) * box.zw - box.zw * 0.5;
        if (length(max(sh, 0.0)) < 0.018 && gap > 0.0) base *= 0.82;
      }
    }

    // Door casing, in the colour of its pair.
    float da = abs(a) - uDoorW * uUnit;
    float dz = zm - uDoorH * uUnit;
    float W = 0.115;
    vec3 inkDoor = uDoors[uDoorInk[k]];
    if (uDoorH < uHeight - 1e-4) {
      if (da < W && dz < W) {
        base = inkDoor;
        lines *= 0.0;
      }
      if (da < W + 0.02 && dz < W + 0.02) lines *= 0.0;
      float edge = max(
        rule(da, W, 0.012, fa) * step(dz, W),
        rule(dz, W, 0.012, ff) * step(da, W)
      );
      lines = max(lines, edge);
      // The door's letter, on a small plate above it.
      vec2 pl = (vec2(a, zm) - vec2(0.0, (uDoorH * uUnit) + W + 0.17)) / vec2(0.15, 0.15);
      if (abs(pl.x) < 1.0 && abs(pl.y) < 1.0) {
        vec2 lu = pl * 0.5 + 0.5;
        vec4 t = textureLod(uAtlas, uLetter[k].xy + lu * uLetter[k].zw, 0.0);
        base = mix(inkDoor, t.rgb, t.a);
        lines = 0.0;
      }
    } else if (da < W) {
      base = inkDoor;
      lines = 0.0;
    }

    float dh = Sk(gdist(hitQ, uLamp));
    float dv = uLampZ - hitZ;
    float cosine = abs(dot(uWall[k], uLamp)) / max(sqrt(dh * dh + dv * dv), 1e-3);
    float v = lightAt(hitQ, hitZ, cosine);
    if (hitZ < uLampZ) v *= mix(0.45, 1.0, shadowAt(hitQ, hitZ));
    // Corners and the top and bottom of the wall go a little darker.
    float wd = INF;
    for (int j = 0; j < uN; j++) {
      if (j != k) wd = min(wd, dot(uWall[j], hitQ));
    }
    v *= 0.72 + 0.28 * smoothstep(0.0, 0.5, SkInv(wd) * uUnit);
    v *= 0.8 + 0.2 * smoothstep(0.0, 0.4, fz);
    v = v * 1.42;
    vec2 st = vec2(a, zm);
    col = wash(base, v, st);
    col = mix(col, ink, 0.34 * hatch(st, v, fa));
    col = mix(col, ink, lines * 0.72);
    id = float(10 + k);
    if (pictureEdge > 0.5) id += 20.0;
  } else if (what == 2 || what == 3 || what == 6) {
    // ------------------------------------------------------------------ floor and ceiling
    bool ceiling = what == 3;
    vec3 q = hitQ;
    vec2 base2 = vec2(q.x, q.y);
    float r = gdist(q, vec3(0.0, 0.0, 1.0)) * uUnit;
#if K == 0
    float bu = q.x;
    float bv = q.y;
#elif K == 1
    float bu = atan(q.x, q.z);
    float bv = asin(clamp(q.y, -1.0, 1.0));
#else
    float bu = atanh(clamp(q.x / q.z, -0.999, 0.999));
    float bv = asinh(q.y);
#endif
    bu *= uUnit;
    bv *= uUnit;
    float fu = min(fwidth(bu), 0.08), fv = min(fwidth(bv), 0.08);
    vec3 base;
    float lines = 0.0;
    float marks = 0.0;
    vec2 uv = (vec2(
#if K == 1
      q.x, q.y
#else
      q.x / q.z, q.y / q.z
#endif
    ) / uExtent) * 0.5 + 0.5;
    vec4 mk = textureLod(uMarks, uv, 0.0);
    if (what == 6) {
      base = mix(uTrim, uDoors[uDoorInk[index]], 0.28);
      id = 7.0;
    } else if (ceiling && uFloor != 2) {
      base = uCeil;
      float rose = max(rule(r, 0.62, 0.016, fu * 2.0), max(rule(r, 0.52, 0.01, fu * 2.0), rule(r, 0.24, 0.012, fu * 2.0)));
      if (r < 0.52 && r > 0.24) base = mix(uCeil, uTrim, 0.5);
      lines = rose * 0.65;
      id = 3.0;
    } else if (ceiling) {
      // The upper floor is close-carpeted.
      base = uCeil * (0.94 + 0.12 * fbm(vec2(bu, bv) * 26.0));
      id = 3.0;
      marks = mk.g;
    } else {
      float w = 0.145;
      if (uFloor == 1) {
        vec2 t = floor(vec2(bu, bv) / 0.5);
        float check = mod(t.x + t.y, 2.0);
        base = mix(uFloorA, uFloorB, check);
        vec2 g = abs(fract(vec2(bu, bv) / 0.5) - 0.5);
        lines = max(rule(g.x, 0.5, 0.006, fu * 2.0), rule(g.y, 0.5, 0.006, fv * 2.0)) * 0.5;
      } else {
        float i = floor(bu / w);
        float along = bv + hash(vec2(i, 3.0)) * 2.4;
        float j = floor(along / 1.7);
        float tint = hash(vec2(i, j));
        base = mix(uFloorA, uFloorB, smoothstep(0.2, 0.8, tint));
        base *= 0.97 + 0.06 * fbm(vec2(bu * 22.0, bv * 2.2) + tint * 9.0);
        float seam = rule(abs(fract(bu / w) - 0.5) * w, w * 0.5, 0.008, fu);
        float end = rule(abs(fract(along / 1.7) - 0.5) * 1.7, 0.85, 0.008, fv);
        lines = max(seam, end) * 0.62;
      }
      // The rug.
      float R = 1.5;
      if (r < R + 0.1 && uFloor != 2) {
        float ang = atan(q.y, q.x);
        float petal = 0.55 + 0.09 * cos(ang * 8.0);
        vec3 rug = uRugA;
        if (r < petal) rug = uRugB;
        if (r < petal - 0.1) rug = uRugA;
        if (r < 0.2) rug = uRugB;
        if (r > R - 0.3 && r < R - 0.26) rug = uRugB;
        if (r > R - 0.2) {
          float tooth = abs(fract(ang * 24.0 / PI) - 0.5) * 0.09;
          rug = r - (R - 0.2) < tooth + 0.03 ? uRugA : uRugB;
        }
        float fringe = smoothstep(R + 0.05, R + 0.02, r + 0.03 * sin(ang * 90.0));
        base = mix(base, rug, fringe);
        lines *= 1.0 - fringe;
        id = 6.0;
      } else {
        id = 2.0;
      }
      marks = mk.r;
    }
    float dh = Sk(gdist(q, uLamp));
    float dv = abs(uLampZ - hitZ);
    float cosine = dv / max(sqrt(dh * dh + dv * dv), 1e-3);
    float v = lightAt(q, hitZ, cosine);
    if (!ceiling) v *= mix(0.42, 1.0, shadowAt(q, hitZ));
    float wd = nearestWall(q);
    v *= 0.74 + 0.26 * smoothstep(0.0, 0.7, wd);
    float nearby = 1.0;
    if (!ceiling) {
      for (int j = 0; j < uPropN; j++) {
        if (uPropRad[j] <= 0.0 || uPropAbove[j] == 1) continue;
        float rr = uPropRad[j] * uUnit;
        nearby = min(nearby, smoothstep(0.1, rr * 0.9, gdist(q, uPropC[j]) * uUnit));
      }
    }
    v *= 0.62 + 0.38 * nearby;
    v = v * 1.42;
    vec2 st = vec2(bu, bv);
    col = wash(base, v, st);
    col = mix(col, ink, 0.3 * hatch(st, v, fu));
    col = mix(col, ink, lines * 0.6);
    col = mix(col, vec3(0.97, 0.95, 0.9), marks * 0.92);
  } else if (what == 4 || what == 5) {
    // ------------------------------------------------------------------ the sides and head of a doorway
    vec3 inkDoor = uDoors[uDoorInk[index]];
    vec3 base = mix(inkDoor, uTrim, 0.2);
    float v = what == 4 ? 0.66 : 0.46;
    col = wash(base, v, vec2(hitZ * uUnit, 0.3) * 3.0);
    id = what == 4 ? 8.0 : 9.0;
  } else if (what == 7) {
    // ------------------------------------------------------------------ furniture, and you
    int j = index;
    int kind = uPropKind[j];
    vec3 w = hitLocal;
    vec3 n = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      vec3 e = vec3(i == 1 || i == 2 ? 1.0 : -1.0, i == 0 || i == 2 ? 1.0 : -1.0, i < 2 ? -1.0 : 1.0) * 0.577;
      n += e * sdf(kind, w + e * 0.004).x;
    }
    n = normalize(n);
    vec3 cj = uPropC[j];
    vec2 toL;
#if K == 0
    toL = local(uLamp, cj, uPropR[j], uPropF[j]);
#else
    toL = vec2(mdot(uLamp, uPropR[j]), mdot(uLamp, uPropF[j]));
#endif
    float lz = uLampZ * uUnit - (uPropAbove[j] == 1 ? uHeight * uUnit - w.z : w.z);
    if (uPropAbove[j] == 1) lz = -lz;
    vec3 L = normalize(vec3(normalize(toL + 1e-5) * gdist(cj, uLamp) * uUnit, lz));
    float ndl = dot(n, L);
    vec3 base = uFabric;
    float glow = 0.0;
    if (kind == ${FIGURE}) {
      base = hitMat < 0.5 ? vec3(0.23, 0.25, 0.3)
        : hitMat < 1.5 ? vec3(0.27, 0.24, 0.23)
        : hitMat < 2.5 ? vec3(0.82, 0.66, 0.54)
        : hitMat < 3.5 ? vec3(0.17, 0.17, 0.2)
        : vec3(0.96, 0.94, 0.88);
      id = 40.0 + float(int(hitMat + 0.5));
    } else if (kind == ${LAMP}) {
      base = hitMat < 0.5 ? vec3(0.62, 0.48, 0.24) : vec3(0.98, 0.9, 0.72);
      glow = hitMat > 0.5 ? 1.0 : 0.0;
      id = 50.0 + float(int(hitMat + 0.5));
    } else if (kind == ${CHAIR}) {
      base = hitMat < 0.5 ? uFabric : vec3(0.36, 0.24, 0.15);
      id = 60.0 + float(int(hitMat + 0.5));
    } else {
      base = hitMat < 0.5 ? vec3(0.48, 0.31, 0.18) : hitMat < 1.5 ? uRugA : vec3(0.93, 0.8, 0.45);
      id = 70.0 + float(int(hitMat + 0.5));
    }
    float v = 0.34 + 0.62 * max(ndl, 0.0);
    col = wash(base, v * 1.1, w.xy * 1.5 + w.z * 1.2);
    if (glow > 0.5) col = vec3(1.0, 0.95, 0.8);
  }

  float grainFade = fade;
  col = mix(col, paper, fade);
  float depth = clamp(log(1.0 + total * uUnit) / 5.0, 0.0, 1.0) * 65535.0;
  id = id + float(min(crossings, 3)) * 0.0;
  oColor = vec4(col, 1.0);
  oData = vec4(id / 255.0, floor(depth / 256.0) / 255.0, mod(depth, 256.0) / 255.0, grainFade);
}
`;
}

export const POST = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
out vec4 oColor;
uniform sampler2D uColor, uData;
uniform vec2 uRes, uSrc;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

vec4 data(ivec2 p) { return texelFetch(uData, clamp(p, ivec2(0), ivec2(uSrc) - 1), 0); }
float depthOf(vec4 d) { return (d.g * 255.0 * 256.0 + d.b * 255.0) / 65535.0; }

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 px = uv * uRes;
  // The pen wanders a little; the paper does not.
  vec2 wob = vec2(vnoise(px / 19.0), vnoise(px / 19.0 + 11.0)) - 0.5;
  vec2 src = uv * uSrc + wob * 1.3;
  ivec2 s = ivec2(floor(src));
  vec4 here = data(s);
  float dh = depthOf(here);
  float edge = 0.0;
  ivec2 ofs[4] = ivec2[4](ivec2(1, 0), ivec2(0, 1), ivec2(1, 1), ivec2(1, -1));
  for (int i = 0; i < 4; i++) {
    vec4 a = data(s + ofs[i]);
    vec4 b = data(s - ofs[i]);
    float e = 0.0;
    if (abs(a.r - here.r) > 0.002 || abs(b.r - here.r) > 0.002) e = 1.0;
    float da = abs(depthOf(a) + depthOf(b) - 2.0 * dh);
    e = max(e, smoothstep(0.01, 0.03, da));
    edge = max(edge, e);
  }
  vec3 col = texture(uColor, (src + 0.5 * 0.0) / uSrc).rgb;
  vec3 ink = vec3(0.17, 0.145, 0.13);
  float keep = 1.0 - here.a;
  col = mix(col, ink, edge * 0.8 * keep);
  float grain = vnoise(px / 1.7) * 0.5 + vnoise(px / 4.3) * 0.5;
  col *= 0.965 + 0.07 * grain;
  oColor = vec4(col, 1.0);
}
`;
