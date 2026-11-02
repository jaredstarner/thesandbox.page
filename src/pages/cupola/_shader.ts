// The view, one full-screen fragment shader: a ray from the eye meets the Earth
// (a sphere textured from the tile levels), and on the way passes through the
// atmosphere, which scatters sunlight (Rayleigh and Mie, ozone absorbing) and,
// on the night side, glows faintly green at 95 km and with auroras above that.

export const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_ndc;
void main() {
  v_ndc = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 v_ndc;
out vec4 o_color;

uniform vec3 u_cam;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_fwd;
uniform vec2 u_tan;
uniform vec3 u_sun;
uniform vec3 u_moon;
uniform float u_moonLight;
uniform float u_exposure;
uniform float u_time;
uniform float u_auroraOn;
uniform float u_gmst;
uniform float u_pix;

uniform sampler2D u_trans;
uniform sampler2D u_aurora;
uniform sampler2D u_dayG;
uniform sampler2D u_auxG;
uniform sampler2DArray u_dayW;
uniform sampler2DArray u_auxW;
// Per window level: first column and row (unwrapped), degrees per tile, columns around the world.
uniform vec4 u_win[3];
uniform int u_winN;
uniform int u_dayMask[3];
uniform int u_auxMask[2];
uniform int u_gDayMask;
uniform int u_gAuxMask;

const float PI = 3.14159265;
const float R = 6371.0;
const float RA = 6471.0;
const vec3 BR = vec3(5.802e-3, 13.558e-3, 33.1e-3);
const float BM = 3.996e-3;
const float BME = 4.40e-3;
const vec3 BO = vec3(0.650e-3, 1.881e-3, 0.085e-3);
// The geomagnetic north pole (IGRF, about 2025), for the auroras' curtains.
const vec3 MAG = vec3(0.0478, -0.1543, 0.9869);
// The galactic north pole and centre (J2000), for where the Milky Way lies.
const vec3 GNP = vec3(-0.8677, -0.1981, 0.4560);
const vec3 GC = vec3(-0.0549, -0.8734, -0.4838);

// Dave Hoskins' hash without sine: no rows or diagonals between neighbouring cells.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

vec2 sphere(vec3 o, vec3 d, float r) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

vec3 transmittance(float h, float mu) {
  vec2 uv = vec2((mu + 0.35) / 1.35, sqrt(clamp(h, 0.0, 100.0) / 100.0));
  return texture(u_trans, uv).rgb;
}

vec3 extinction(float h) {
  return BR * exp(-h / 8.0) + BME * exp(-h / 1.2) + BO * max(0.0, 1.0 - abs(h - 25.0) / 15.0);
}

vec3 toLinear(vec3 c) {
  return pow(c, vec3(2.2));
}

// One window level: where (lon, lat) falls in its toroidal tile cache, if it is there.
bool windowAt(int k, vec2 ll, out vec3 uvw, out float edge, out int bit) {
  vec4 w = u_win[k];
  float n = float(u_winN);
  float fc = (ll.x + 180.0) / w.z;
  float fr = (90.0 - ll.y) / w.z;
  float dc = mod(floor(fc) - w.x, w.w);
  float dr = floor(fr) - w.y;
  if (dc >= n || dr < 0.0 || dr >= n) return false;
  bit = int(dr) * u_winN + int(dc);
  vec2 slot = vec2(mod(w.x + dc, n), mod(w.y + dr, n));
  vec2 f = fract(vec2(fc, fr));
  uvw = vec3((slot + f) / n, float(k));
  vec2 inside = vec2(dc, dr) + f;
  edge = min(min(inside.x, n - inside.x), min(inside.y, n - inside.y));
  return true;
}

void ground(vec2 ll, vec2 dx, vec2 dy, out vec3 day, out vec4 aux) {
  // The whole world: zoom 2 tiles, 72 degrees each, 5 by 3.
  vec2 g = vec2((ll.x + 180.0) / 360.0, (90.0 - ll.y) / 216.0);
  vec2 gdx = dx / vec2(360.0, -216.0);
  vec2 gdy = dy / vec2(360.0, -216.0);
  int gbit = int(floor((90.0 - ll.y) / 72.0)) * 5 + int(floor((ll.x + 180.0) / 72.0));
  day = textureGrad(u_dayG, g, gdx, gdy).rgb;
  aux = textureGrad(u_auxG, g, gdx, gdy);
  for (int k = 0; k < 3; k++) {
    vec3 uvw;
    float edge;
    int bit;
    if (!windowAt(k, ll, uvw, edge, bit)) continue;
    float span = u_win[k].z * float(u_winN);
    vec2 wdx = dx / vec2(span, -span);
    vec2 wdy = dy / vec2(span, -span);
    float a = smoothstep(0.0, 0.3, edge);
    if ((u_dayMask[k] & (1 << bit)) != 0) day = mix(day, textureGrad(u_dayW, uvw, wdx, wdy).rgb, a);
    if (k < 2 && (u_auxMask[k] & (1 << bit)) != 0) aux = mix(aux, textureGrad(u_auxW, uvw, wdx, wdy), a);
  }
  if ((u_gDayMask & (1 << gbit)) == 0 && day == vec3(0.0)) day = vec3(0.02, 0.05, 0.12);
}

// Auroral emission along a stretch of the ray between 95 and 260 km: where OVATION puts the oval,
// curtains folded along lines of magnetic latitude, ribbed with vertical rays.
vec3 aurora(vec3 o, vec3 d, float t0, float t1) {
  vec3 sum = vec3(0.0);
  const int N = 28;
  float dt = (t1 - t0) / float(N);
  // Interleaved gradient noise spreads the sample offsets more evenly than white noise.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 e1 = normalize(cross(MAG, vec3(0.0, 0.0, 1.0)));
  vec3 e2 = cross(MAG, e1);
  for (int i = 0; i < N; i++) {
    vec3 p = o + d * (t0 + (float(i) + jitter) * dt);
    float r = length(p);
    float h = r - R;
    vec3 n = p / r;
    float lat = degrees(asin(n.z));
    float lon = degrees(atan(n.y, n.x));
    float prob = texture(u_aurora, vec2(fract(lon / 360.0 + 1.0), (lat + 90.5) / 181.0)).r * 255.0;
    if (prob < 4.0) continue;
    float mlat = degrees(asin(dot(n, MAG)));
    float mlon = atan(dot(n, e2), dot(n, e1));
    float fold = 2.4 * noise(vec2(mlon * 7.0, u_time * 0.01)) + 0.7 * noise(vec2(mlon * 31.0, u_time * 0.03 + 5.0));
    float arcs = smoothstep(0.45, 0.95, 0.5 + 0.5 * sin((abs(mlat) + fold) * 1.7));
    float rays = 0.35 + 0.65 * noise(vec2(mlon * 420.0, u_time * 0.25));
    float strength = smoothstep(4.0, 45.0, prob) * arcs * rays;
    // Green oxygen light from a sharp lower edge near 100 km fading upward, a faint red crown far
    // above it, and a thin pink hem of nitrogen at the very bottom.
    vec3 c = vec3(0.16, 1.0, 0.42) * smoothstep(97.0, 106.0, h) * exp(-max(h - 106.0, 0.0) / 24.0);
    c += vec3(0.9, 0.08, 0.32) * 0.04 * smoothstep(165.0, 215.0, h) * exp(-max(h - 215.0, 0.0) / 45.0);
    c += vec3(0.8, 0.25, 0.7) * 0.15 * exp(-pow((h - 99.0) / 3.0, 2.0));
    sum += c * strength * dt;
  }
  return sum * 5e-5;
}

// A stand-in sky: stars scattered thickest along the galactic plane, which lies where the real one does.
// Positions are not a catalogue; the night side only needs a sky that behaves like one.
vec3 starfield(vec3 d) {
  vec3 a = abs(d);
  vec2 uv;
  float face;
  if (a.x >= a.y && a.x >= a.z) {
    uv = d.yz / a.x;
    face = d.x > 0.0 ? 0.0 : 1.0;
  } else if (a.y >= a.z) {
    uv = d.xz / a.y;
    face = d.y > 0.0 ? 2.0 : 3.0;
  } else {
    uv = d.xy / a.z;
    face = d.z > 0.0 ? 4.0 : 5.0;
  }
  const float N = 220.0;
  vec2 g = (uv * 0.5 + 0.5) * N;
  vec2 cell = floor(g);
  float b = dot(d, GNP);
  float dens = 0.13 + 0.6 * exp(-b * b / 0.025);
  float px = max(u_pix, 0.0004) * N * 0.5;
  vec3 sum = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 c = cell + vec2(x, y);
      vec2 seed = c + face * 431.7;
      if (hash(seed) > dens) continue;
      vec2 pos = c + vec2(hash(seed * 1.31 + 7.1), hash(seed * 2.17 + 3.3));
      float r = length(g - pos) / px;
      float m = hash(seed * 3.7 + 1.9);
      float bright = 0.0006 + 0.05 * pow(m, 14.0);
      vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.68), hash(seed * 5.3 + 2.2));
      sum += tint * bright * exp(-r * r * 1.4);
    }
  }
  float l = atan(dot(d, cross(GNP, GC)), dot(d, GC));
  float band = exp(-b * b / 0.012) * (0.5 + 0.8 * noise(vec2(l * 6.0, b * 18.0)) * noise(vec2(l * 13.0 + 2.0, b * 30.0 + 4.0)));
  sum += vec3(0.62, 0.66, 0.8) * 0.00035 * band * (1.0 + 2.0 * pow(max(dot(d, GC), 0.0), 3.0));
  return sum;
}

// Path length through the spherical shell between radii r0 and r1.
float shellPath(vec3 o, vec3 d, float r0, float r1, float tMax) {
  vec2 a = sphere(o, d, r1);
  if (a.y <= 0.0) return 0.0;
  float t0 = max(a.x, 0.0);
  float t1 = min(a.y, tMax);
  if (t1 <= t0) return 0.0;
  vec2 b = sphere(o, d, r0);
  float len = t1 - t0;
  if (b.y > 0.0) {
    float s0 = max(b.x, t0);
    float s1 = min(b.y, t1);
    len -= max(0.0, s1 - s0);
  }
  return len;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 o = u_cam;
  vec3 d = normalize(u_fwd + v_ndc.x * u_tan.x * u_right + v_ndc.y * u_tan.y * u_up);

  vec2 hitG = sphere(o, d, R);
  bool hit = hitG.x > 0.0;
  vec2 hitA = sphere(o, d, RA);

  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);

  float tEnd = hit ? hitG.x : hitA.y;
  if (hitA.y > 0.0) {
    float t0 = max(hitA.x, 0.0);
    float t1 = tEnd;
    float tc = clamp(-dot(o, d), t0, t1);
    float muSun = dot(d, u_sun);
    float phR = 3.0 / (16.0 * PI) * (1.0 + muSun * muSun);
    const float g = 0.8;
    float phM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + muSun * muSun)) /
      ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * muSun, 1.5));
    // Samples crowd toward the lowest point of the ray, where the air is thickest.
    const int NA = 18;
    const int NB = 10;
    float prev = t0;
    for (int i = 1; i <= NA + NB; i++) {
      float t;
      if (i <= NA) {
        float s = float(i) / float(NA);
        t = t0 + (tc - t0) * (1.0 - (1.0 - s) * (1.0 - s));
      } else {
        float s = float(i - NA) / float(NB);
        t = tc + (t1 - tc) * s * s;
      }
      float dt = t - prev;
      if (dt <= 1e-4) {
        prev = t;
        continue;
      }
      vec3 p = o + d * (prev + 0.5 * dt);
      prev = t;
      float r = length(p);
      float h = r - R;
      vec3 ext = extinction(h);
      float mu = dot(p / r, u_sun);
      vec3 Ts = transmittance(h, mu);
      vec3 sR = BR * exp(-h / 8.0);
      float sM = BM * exp(-h / 1.2);
      // A crude stand-in for light scattered more than once: an even glow from the lit sky.
      vec3 ms = (sR + sM) * 0.06 * vec3(0.55, 0.7, 1.0) * smoothstep(-0.25, 0.35, mu);
      vec3 S = Ts * (sR * phR + sM * phM) + ms;
      vec3 Tseg = exp(-ext * dt);
      L += T * (S - S * Tseg) / max(ext, vec3(1e-7));
      T *= Tseg;
    }
  }

  // Airglow: a thin shell of green oxygen light at about 95 km, faint looking down through it and a
  // bright line edge-on, with a dimmer skirt either side.
  float glow = shellPath(o, d, R + 93.5, R + 96.5, tEnd) + 0.3 * shellPath(o, d, R + 89.0, R + 101.0, tEnd);
  L += vec3(0.2, 0.92, 0.36) * glow * 1.5e-6 * T;

  if (u_auroraOn > 0.5) {
    vec2 outer = sphere(o, d, R + 260.0);
    if (outer.y > 0.0) {
      vec2 inner = sphere(o, d, R + 95.0);
      float a0 = max(outer.x, 0.0);
      float a1 = inner.x > 0.0 ? inner.x : outer.y;
      if (hit) a1 = min(a1, hitG.x);
      if (a1 > a0) {
        vec3 mid = o + d * (0.5 * (a0 + a1));
        if (dot(normalize(mid), u_sun) < 0.15) L += aurora(o, d, a0, a1);
      }
    }
  }

  vec3 color;
  if (hit) {
    vec3 P = o + d * hitG.x;
    vec3 N = P / R;
    vec2 ll = vec2(degrees(atan(N.y, N.x)), degrees(asin(clamp(N.z, -1.0, 1.0))));
    vec2 dx = dFdx(ll);
    vec2 dy = dFdy(ll);
    dx.x -= 360.0 * round(dx.x / 360.0);
    dy.x -= 360.0 * round(dy.x / 360.0);
    vec3 dayS;
    vec4 aux;
    ground(ll, dx, dy, dayS, aux);
    float cloud = smoothstep(0.34, 0.62, min(min(dayS.r, dayS.g), dayS.b));
    vec3 albedo = toLinear(dayS);
    float muS = dot(N, u_sun);
    vec3 Ts = transmittance(0.0, muS);
    vec3 Esun = Ts * max(muS, 0.0);
    // Skylight by day; by night a trace of starlight and airglow, enough to show the clouds faintly.
    vec3 Esky = vec3(0.07, 0.1, 0.17) * smoothstep(-0.2, 0.45, muS) + vec3(0.0005, 0.0007, 0.0012);
    float muM = dot(N, u_moon);
    vec3 Emoon = transmittance(0.0, muM) * max(muM, 0.0) * u_moonLight;
    vec3 Lg = albedo * (Esun + Esky + Emoon) / PI;
    // The sun's glint off open water, a wind-roughened sea.
    float water = aux.a * (1.0 - cloud);
    if (water > 0.0 && muS > 0.0) {
      vec3 V = -d;
      vec3 H = normalize(u_sun + V);
      float nh = max(dot(N, H), 0.0);
      float nv = max(dot(N, V), 0.05);
      const float a2 = 0.09;
      float D = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
      float F = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
      Lg += water * Ts * D * F / (4.0 * nv) * 0.6;
    }
    // City lights, on once the sun is down, softened under cloud.
    vec3 lights = max(toLinear(aux.rgb) - vec3(0.006, 0.006, 0.022), 0.0);
    Lg += lights * 0.0065 * (1.0 - 0.75 * cloud) * smoothstep(0.06, -0.1, muS);
    color = Lg * T + L;
  } else {
    color = L;
    // Stars and the Milky Way, in the stars' frame (the Earth turns under them), only once eyes have adjusted to the dark.
    float cg = cos(u_gmst);
    float sg = sin(u_gmst);
    vec3 dI = vec3(cg * d.x - sg * d.y, sg * d.x + cg * d.y, d.z);
    color += T * starfield(dI) * smoothstep(30.0, 120.0, u_exposure);
    // The sun's disc, reddened by whatever air lies in front of it, and its glare.
    float c = dot(d, u_sun);
    float disc = smoothstep(0.999989, 0.9999905, c);
    color += T * (disc * 60.0 + 0.04 * pow(max(c, 0.0), 900.0) + 0.0015 * pow(max(c, 0.0), 60.0));
    // The moon: a lit sphere 0.26 degrees across.
    float cm = dot(d, u_moon);
    if (cm > 0.99998) {
      vec3 q = (d - u_moon * cm) / 0.0045;
      float q2 = dot(q, q);
      if (q2 < 1.0) {
        vec3 n = q - u_moon * sqrt(1.0 - q2);
        float lit = max(dot(n, u_sun), 0.0);
        float edge = smoothstep(1.0, 0.92, q2);
        color += T * 0.04 * lit * edge * (0.85 + 0.3 * noise(q.xy * 6.0 + 3.0));
      }
    }
  }

  color = aces(color * u_exposure);
  color = pow(color, vec3(1.0 / 2.2));
  color += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) / 255.0;
  o_color = vec4(color, 1.0);
}`;
