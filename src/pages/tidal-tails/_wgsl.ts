// Shaders for the tidal tails plate: lay out the disks, step the stars, and
// expose them onto a photographic plate.

const HASH = /* wgsl */ `
fn pcg(x: u32) -> u32 {
  let s = x * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd(state: ptr<function, u32>) -> f32 {
  *state = pcg(*state);
  return f32(*state >> 8u) / 16777216.0;
}
`;

/** One galaxy, as the init pass sees it. */
const GALAXY = /* wgsl */ `
struct Galaxy {
  pos: vec4f,   // mass position at the first step; w = mass
  vel: vec4f,   // mass velocity; w = softening
  e1: vec4f,    // disk basis; w = disk radius
  e2: vec4f,    // w = first particle index
  n: vec4f,     // spin axis; w = particle count
};
struct Init {
  a: Galaxy,
  b: Galaxy,
  seed: u32,
  total: u32,
  p0: u32,
  p1: u32,
};
`;

export const INIT = /* wgsl */ `
${HASH}
${GALAXY}
@group(0) @binding(0) var<uniform> P: Init;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel: array<vec4f>;

const TAU = 6.2831853;

fn basis(n: vec3f) -> mat2x3f {
  var helper = vec3f(0.0, 0.0, 1.0);
  if (abs(n.z) > 0.9) { helper = vec3f(1.0, 0.0, 0.0); }
  let b1 = normalize(cross(n, helper));
  return mat2x3f(b1, cross(n, b1));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.total) { return; }
  var g = P.a;
  var salt = 0x51ed27u;
  if (f32(i) >= P.b.e2.w) { g = P.b; salt = 0x9e3779u; }
  var st = pcg((i * 2654435761u) ^ P.seed ^ salt);
  let R = g.e1.w;
  let eps = g.vel.w;
  let m = g.pos.w;
  let n = g.n.xyz;
  let u = rnd(&st);

  var r = 0.0;
  var theta = rnd(&st) * TAU;
  var plane = mat2x3f(g.e1.xyz, g.e2.xyz);
  var weight = 1.0;
  var young = 0.0;

  if (u < 0.09) {
    // Bulge: circular orbits in random planes, packed toward the middle.
    r = R * (0.012 + 0.2 * pow(rnd(&st), 1.8));
    let z = rnd(&st) * 2.0 - 1.0;
    let ph = rnd(&st) * TAU;
    let s = sqrt(1.0 - z * z);
    plane = basis(vec3f(s * cos(ph), s * sin(ph), z));
    weight = 1.35;
  } else if (u < 0.22) {
    // Knots of young stars: small clumps on shared orbits that shear into arcs.
    var cs = pcg((u32(rnd(&st) * 420.0) * 7919u) ^ salt ^ P.seed);
    let rc = R * (0.22 + 0.78 * sqrt(rnd(&cs)));
    let tc = rnd(&cs) * TAU;
    let size = R * (0.008 + 0.018 * rnd(&cs));
    r = rc + size * (rnd(&st) + rnd(&st) - 1.0);
    theta = tc + size / rc * (rnd(&st) + rnd(&st) - 1.0) * 1.6;
    weight = 1.9;
    young = 1.0;
  } else {
    // The disk: half exponential, half laid in rings out to the edge as
    // Toomre and Toomre did, so the outer disk has stars to lose.
    if (rnd(&st) < 0.5) {
      let h = 0.3 * R;
      let v = rnd(&st);
      r = -h * log(1.0 - v * (1.0 - exp(-R / h)));
    } else {
      r = R * (0.15 + 0.85 * rnd(&st));
    }
    r = max(r, 0.01 * R);
    young = smoothstep(0.25 * R, R, r) * 0.7;
    weight = 1.0;
  }

  // A thin disk: tip each orbit a little out of the plane.
  if (u >= 0.09) {
    let tip = (rnd(&st) - 0.5) * 0.07;
    let ax = rnd(&st) * TAU;
    let n2 = normalize(n + tip * (cos(ax) * g.e1.xyz + sin(ax) * g.e2.xyz));
    let b1 = normalize(g.e1.xyz - dot(g.e1.xyz, n2) * n2);
    plane = mat2x3f(b1, cross(n2, b1));
  }

  let v = sqrt(m * r * r / pow(r * r + eps * eps, 1.5));
  let c = cos(theta);
  let s = sin(theta);
  let p = r * (c * plane[0] + s * plane[1]);
  let w = v * (-s * plane[0] + c * plane[1]);
  // Each galaxy's light goes with its mass, shared over however many stars it has.
  let light = pow(m, 0.8) * 524288.0 / max(g.n.w, 1.0);
  pos[i] = vec4f(g.pos.xyz + p, weight * light);
  vel[i] = vec4f(g.vel.xyz + w, young);
}
`;

export const STEP = /* wgsl */ `
struct Step {
  k0: i32,
  dir: i32,
  count: i32,
  total: u32,
  dt: f32,
  mA: f32,
  mB: f32,
  eA2: f32,
  eB2: f32,
  p0: f32,
  p1: f32,
  p2: f32,
};
@group(0) @binding(0) var<uniform> S: Step;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read> cores: array<vec4f>;

fn accel(x: vec3f, k: i32) -> vec3f {
  let da = cores[2 * k].xyz - x;
  let db = cores[2 * k + 1].xyz - x;
  let ia = inverseSqrt(dot(da, da) + S.eA2);
  let ib = inverseSqrt(dot(db, db) + S.eB2);
  return da * (S.mA * ia * ia * ia) + db * (S.mB * ib * ib * ib);
}

// Kick, drift, kick. With the masses' paths fixed in advance the scheme is
// time-reversible, so a negative step runs the plate backward.
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= S.total) { return; }
  let p = pos[i];
  let q = vel[i];
  var x = p.xyz;
  var v = q.xyz;
  let h = f32(S.dir) * S.dt;
  var k = S.k0;
  var a = accel(x, k);
  for (var n = 0; n < S.count; n++) {
    v += a * (0.5 * h);
    x += v * h;
    k += S.dir;
    a = accel(x, k);
    v += a * (0.5 * h);
  }
  pos[i] = vec4f(x, p.w);
  vel[i] = vec4f(v, q.w);
}
`;

const VIEW = /* wgsl */ `
struct View {
  r0: vec4f,      // view rows; w unused
  r1: vec4f,
  r2: vec4f,
  scale: vec2f,   // clip units per length unit
  px: vec2f,      // clip units per device pixel
  gain: f32,
  radius: f32,    // splat radius, device pixels
  p0: f32,
  p1: f32,
};
`;

export const SPLAT = /* wgsl */ `
${VIEW}
@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;

struct Out {
  @builtin(position) p: vec4f,
  @location(0) uv: vec2f,
  @location(1) w: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let c = corners[vi];
  let q = pos[ii];
  let sx = dot(V.r0.xyz, q.xyz);
  let sy = dot(V.r1.xyz, q.xyz);
  var o: Out;
  o.p = vec4f(sx * V.scale.x + c.x * V.radius * V.px.x, sy * V.scale.y + c.y * V.radius * V.px.y, 0.0, 1.0);
  o.uv = c * V.radius;
  let y = vel[ii].w;
  o.w = vec2f(q.w * V.gain, q.w * V.gain * y);
  return o;
}

@fragment
fn fs(i: Out) -> @location(0) vec4f {
  let k = exp(-dot(i.uv, i.uv) * 1.25);
  return vec4f(i.w.x * k, i.w.y * k, 0.0, 0.0);
}
`;

/** Foreground stars of our own galaxy, fixed on the plate, with diffraction spikes. */
export const FIELD = /* wgsl */ `
${HASH}
struct Field {
  px: vec2f,      // clip units per device pixel
  unit: f32,      // device pixels per css pixel
  count: u32,
  gain: f32,
  seed: u32,
  p0: f32,
  p1: f32,
};
@group(0) @binding(0) var<uniform> F: Field;

struct Out {
  @builtin(position) p: vec4f,
  @location(0) uv: vec2f,
  @location(1) b: f32,
  @location(2) size: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var st = pcg((ii * 2246822519u) ^ F.seed);
  let x = rnd(&st) * 1.9 - 0.95;
  let y = rnd(&st) * 1.9 - 0.95;
  // Brightness falls off as a power law: a few bright stars, many faint ones.
  let b = min(0.35 * pow(max(rnd(&st), 0.002), -1.15), 60.0);
  let size = (6.0 + 9.0 * sqrt(b)) * F.unit;
  let c = corners[vi];
  var o: Out;
  o.p = vec4f(x + c.x * size * F.px.x, y + c.y * size * F.px.y, 0.0, 1.0);
  o.uv = c * size;
  o.b = b;
  o.size = size;
  return o;
}

@fragment
fn fs(i: Out) -> @location(0) vec4f {
  let d = length(i.uv) / F.unit;
  let core = i.b * exp(-d * d * 0.9);
  let halo = 0.05 * i.b * exp(-d * 0.35);
  // Four thin spikes from the telescope's secondary mirror supports, on the bright stars only.
  let a = abs(i.uv) / F.unit;
  let len = 2.2 * sqrt(i.b);
  let spike = (exp(-a.y * a.y * 3.0) * exp(-a.x / len) + exp(-a.x * a.x * 3.0) * exp(-a.y / len)) * 0.45 * max(i.b - 2.0, 0.0) / (1.0 + 0.1 * i.b);
  let edge = 1.0 - smoothstep(0.75, 1.0, length(i.uv) / i.size);
  let e = (core + halo + spike) * F.gain * edge;
  return vec4f(e, 0.0, 0.0, 0.0);
}
`;

const FULLSCREEN = /* wgsl */ `
struct VOut { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let p = pts[vi];
  var o: VOut;
  o.p = vec4f(p, 0.0, 1.0);
  o.uv = vec2f(0.5 * p.x + 0.5, 0.5 - 0.5 * p.y);
  return o;
}
`;

/** Separable Gaussian blur; also used, with a zero step, as a plain downsample. */
export const BLUR = /* wgsl */ `
${FULLSCREEN}
struct Blur { step: vec2f, p0: f32, p1: f32 };
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var<uniform> B: Blur;

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  var w = array<f32, 5>(0.2270270, 0.1945946, 0.1216216, 0.0540541, 0.0162162);
  var acc = textureSampleLevel(src, samp, i.uv, 0.0) * w[0];
  for (var k = 1; k < 5; k++) {
    let o = B.step * f32(k);
    acc += (textureSampleLevel(src, samp, i.uv + o, 0.0) + textureSampleLevel(src, samp, i.uv - o, 0.0)) * w[k];
  }
  return acc;
}
`;

/** The plate: a photographic response to the exposure, grain, halation, and the light box behind. */
export const COMPOSITE = /* wgsl */ `
${FULLSCREEN}
${HASH}
struct Comp {
  size: vec2f,    // device pixels
  mode: f32,      // 0 negative, 1 print
  grain: f32,     // device pixels per grain
  contrast: f32,
  seed: f32,
  p0: f32,
  p1: f32,
};
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tFull: texture_2d<f32>;
@group(0) @binding(2) var tHalf: texture_2d<f32>;
@group(0) @binding(3) var tQuarter: texture_2d<f32>;
@group(0) @binding(4) var<uniform> C: Comp;

fn noise(p: vec2f) -> f32 {
  let q = vec2u(floor(p));
  return f32(pcg((q.x * 73856093u) ^ pcg((q.y * 19349663u) ^ u32(C.seed)))) / 4294967296.0;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  let e = textureLoad(tFull, vec2i(i.p.xy), 0).r;
  let h1 = textureSampleLevel(tHalf, samp, i.uv, 0.0).r;
  let h2 = textureSampleLevel(tQuarter, samp, i.uv, 0.0).r;
  // Halation: light scattered inside the glass spreads around the bright cores.
  let ex = e + 0.45 * h1 + 0.35 * h2;
  // Density grows with the log of exposure over the plate's useful range.
  let k = 9.0 * C.contrast;
  var d = log2(1.0 + k * ex) / log2(1.0 + k * 5.0);
  d = clamp(d, 0.0, 1.0);
  d = d * d * (3.0 - 2.0 * d) * 0.35 + d * 0.65;
  // Fog of the unexposed emulsion, and grain clumped a little bigger than a pixel.
  let g = i.p.xy / C.grain;
  let n = (noise(g) + noise(g * 0.5 + 17.0) * 0.6 - 0.8) * 1.25;
  let fog = 0.035;
  let dd = clamp(d + fog + n * 0.16 * sqrt(d * (1.0 - d) + 0.004), 0.0, 1.0);
  let r = length(i.uv - 0.5) * 1.414;
  if (C.mode < 0.5) {
    let glass = vec3f(0.915, 0.905, 0.872) * (1.0 - 0.13 * r * r);
    let ink = vec3f(0.05, 0.055, 0.065);
    return vec4f(mix(glass, ink, dd), 1.0);
  }
  let sky = vec3f(0.028, 0.029, 0.034);
  let silver = vec3f(0.95, 0.94, 0.905);
  let col = mix(sky, silver, pow(dd, 1.12)) * (1.0 - 0.12 * r * r);
  return vec4f(col, 1.0);
}
`;
