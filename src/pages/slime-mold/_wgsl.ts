// WGSL for the plate. One uniform block feeds every pass; see PARAMS in _plate.ts
// for the byte layout, which must match this struct.

const PARAMS = /* wgsl */ `
struct Params {
  size: u32,
  agents: u32,
  frame: u32,
  foodCount: u32,
  sensorAngle: f32,
  sensorDist: f32,
  turnAngle: f32,
  stepSize: f32,
  deposit: f32,
  keep: f32,
  diffuse: f32,
  dishRadius: f32,
  lamp: vec4f,
  canvas: vec2f,
  center: vec2f,
  scale: f32,
  time: f32,
  strokeCount: u32,
  jitter: f32,
  mazeOrigin: vec2f,
  mazePitch: f32,
  mazeCells: u32,
}

@group(0) @binding(0) var<uniform> P: Params;

fn hash(x: u32) -> u32 {
  let s = x * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn rand(seed: u32) -> f32 {
  return f32(hash(seed)) * (1.0 / 4294967296.0);
}

fn dishCenter() -> vec2f {
  return vec2f(f32(P.size) * 0.5);
}

fn cellOf(p: vec2f) -> u32 {
  let n = i32(P.size);
  let c = clamp(vec2i(floor(p)), vec2i(0), vec2i(n - 1));
  return u32(c.y * n + c.x);
}

/** Index of the maze cell under p, or -1 outside the maze (or with no maze). */
fn mazeCell(p: vec2f) -> i32 {
  if (P.mazeCells == 0u) { return -1; }
  let c = floor((p - P.mazeOrigin) / P.mazePitch);
  let m = f32(P.mazeCells);
  if (c.x < 0.0 || c.y < 0.0 || c.x >= m || c.y >= m) { return -1; }
  return i32(c.y * m + c.x);
}
`;

/** Move every agent one step: sense, turn, step, deposit. */
export const AGENTS = /* wgsl */ `
${PARAMS}
@group(0) @binding(1) var<storage, read_write> agents: array<vec4f>;
@group(0) @binding(2) var<storage, read> trail: array<f32>;
@group(0) @binding(3) var<storage, read_write> deposit: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> walls: array<u32>;
@group(0) @binding(5) var<storage, read> scent: array<f32>;
@group(0) @binding(6) var<storage, read> dry: array<f32>;

fn dryAt(p: vec2f) -> f32 {
  let m = mazeCell(p);
  return select(0.0, dry[max(m, 0)], m >= 0);
}

fn sense(p: vec2f, heading: f32) -> f32 {
  let q = p + vec2f(cos(heading), sin(heading)) * P.sensorDist;
  if (distance(q, dishCenter()) > P.dishRadius) { return -1.0; }
  let i = cellOf(q);
  if (walls[i] != 0u) { return -50.0; }
  var v = trail[i] + scent[i] - 80.0 * dryAt(q);
  if (P.lamp.w > 0.5) {
    let d = distance(q, P.lamp.xy);
    if (d < P.lamp.z) { v -= 40.0 * (1.2 - d / P.lamp.z); }
  }
  return v;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.agents) { return; }
  var a = agents[i];
  let seed = hash(i ^ hash(P.frame * 2654435761u));
  let f = sense(a.xy, a.z);
  let l = sense(a.xy, a.z + P.sensorAngle);
  let r = sense(a.xy, a.z - P.sensorAngle);
  if (f > l && f > r) {
    // Keep going.
  } else if (f < l && f < r) {
    a.z += select(-P.turnAngle, P.turnAngle, rand(seed) < 0.5);
  } else if (l > r) {
    a.z += P.turnAngle;
  } else if (r > l) {
    a.z -= P.turnAngle;
  }
  a.z += (rand(seed ^ 0x9e3779b9u) - 0.5) * P.jitter;

  let next = a.xy + vec2f(cos(a.z), sin(a.z)) * P.stepSize;
  let here = cellOf(a.xy);
  let there = cellOf(next);
  // Agents never step into salt, but one caught under fresh salt may walk out.
  let blocked = distance(next, dishCenter()) > P.dishRadius || (walls[there] != 0u && walls[here] == 0u);
  if (blocked) {
    a.z = rand(seed ^ 0x85ebca6bu) * 6.2831853;
  } else {
    a.x = next.x;
    a.y = next.y;
    atomicAdd(&deposit[there], u32(P.deposit * 256.0 * (1.0 - dryAt(next))));
  }
  agents[i] = a;
}
`;

/** Spread and fade the trail into the other buffer, adding this step's deposits. */
export const DIFFUSE = /* wgsl */ `
${PARAMS}
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
@group(0) @binding(3) var<storage, read_write> deposit: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> walls: array<u32>;
@group(0) @binding(5) var<storage, read> dry: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = P.size;
  if (id.x >= n || id.y >= n) { return; }
  let i = id.y * n + id.x;
  let dep = f32(atomicExchange(&deposit[i], 0u)) * (1.0 / 256.0);
  let p = vec2f(id.xy) + 0.5;
  if (walls[i] != 0u || distance(p, dishCenter()) > P.dishRadius) {
    dst[i] = 0.0;
    return;
  }
  var sum = 0.0;
  let last = i32(n) - 1;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let x = clamp(i32(id.x) + dx, 0, last);
      let y = clamp(i32(id.y) + dy, 0, last);
      sum += src[u32(y) * n + u32(x)];
    }
  }
  var v = mix(src[i], sum / 9.0, P.diffuse) * P.keep + dep;
  if (P.lamp.w > 0.5 && distance(p, P.lamp.xy) < P.lamp.z) {
    v *= 0.8;
  }
  // A maze corridor the flow has abandoned dries out.
  let m = mazeCell(p);
  if (m >= 0) {
    v *= 1.0 - 0.06 * dry[m];
  }
  dst[i] = min(v, 400.0);
}
`;

/** The oats' scent: strongest at each oat and fading out to its reach (f.z).
    Agents smell it on top of the trail, but it is never drawn as slime.
    Runs only when the oats change. */
export const SCENT = /* wgsl */ `
${PARAMS}
@group(0) @binding(1) var<storage, read_write> scent: array<f32>;
@group(0) @binding(2) var<storage, read> foods: array<vec4f>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = P.size;
  if (id.x >= n || id.y >= n) { return; }
  let p = vec2f(id.xy) + 0.5;
  var s = 0.0;
  for (var k = 0u; k < P.foodCount; k++) {
    let f = foods[k];
    let t = max(1.0 - distance(p, f.xy) / f.z, 0.0);
    s += f.w * t * t;
  }
  scent[id.y * n + id.x] = s;
}
`;

/** Paint salt (or scrape it away) along this frame's pointer strokes. */
export const STAMP = /* wgsl */ `
${PARAMS}
@group(0) @binding(1) var<storage, read_write> walls: array<u32>;
@group(0) @binding(2) var<storage, read_write> trail: array<f32>;
@group(0) @binding(3) var<storage, read> strokes: array<vec4f>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = P.size;
  if (id.x >= n || id.y >= n) { return; }
  let i = id.y * n + id.x;
  let p = vec2f(id.xy) + 0.5;
  for (var s = 0u; s < P.strokeCount; s++) {
    let seg = strokes[s * 2u];
    let pen = strokes[s * 2u + 1u];
    let ab = seg.zw - seg.xy;
    let t = clamp(dot(p - seg.xy, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    if (distance(p, seg.xy + ab * t) <= pen.x) {
      walls[i] = u32(pen.y);
      trail[i] = 0.0;
    }
  }
}
`;

/** Light the plate: agar, glass, salt, oats, and the trail as a wet height field. */
export const RENDER = /* wgsl */ `
${PARAMS}
@group(0) @binding(1) var<storage, read> trail: array<f32>;
@group(0) @binding(2) var<storage, read> walls: array<u32>;
@group(0) @binding(3) var<storage, read> foods: array<vec4f>;

struct VSOut {
  @builtin(position) pos: vec4f,
}

@vertex
fn vs(@builtin(vertex_index) v: u32) -> VSOut {
  let xy = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
  var out: VSOut;
  out.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

fn T(c: vec2i) -> f32 {
  let n = i32(P.size);
  let q = clamp(c, vec2i(0), vec2i(n - 1));
  return trail[u32(q.y * n + q.x)];
}

fn trailAt(p: vec2f) -> f32 {
  let q = p - 0.5;
  let c = vec2i(floor(q));
  let f = q - floor(q);
  let a = mix(T(c), T(c + vec2i(1, 0)), f.x);
  let b = mix(T(c + vec2i(0, 1)), T(c + vec2i(1, 1)), f.x);
  return mix(a, b, f.y);
}

fn height(p: vec2f) -> f32 {
  return 1.0 - exp(-trailAt(p) * 0.012);
}

fn lattice(x: i32, y: i32) -> f32 {
  return rand((u32(x) * 73856093u) ^ (u32(y) * 19349663u));
}

fn noise(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(lattice(i.x, i.y), lattice(i.x + 1, i.y), u.x);
  let b = mix(lattice(i.x, i.y + 1), lattice(i.x + 1, i.y + 1), u.x);
  return mix(a, b, u.y);
}

const LIGHT = vec3f(-0.45, -0.55, 0.7);
/** An oat flake's half-width, in cells. */
const OAT = 11.0;

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let px = in.pos.xy;
  let p = (px - P.center) / P.scale + dishCenter();
  let r = distance(p, dishCenter());
  let R = P.dishRadius;
  let rim = 9.0;
  let L = normalize(LIGHT);

  // The table, with the dish's shadow falling down and to the right.
  let shadowP = p - vec2f(14.0, 22.0);
  let shadow = smoothstep(R + 70.0, R - 10.0, distance(shadowP, dishCenter()));
  let vig = smoothstep(1.4, 0.2, length((px - P.canvas * 0.5) / max(P.canvas.x, P.canvas.y)) * 2.0);
  var col = mix(vec3f(0.035, 0.028, 0.022), vec3f(0.075, 0.062, 0.05), vig) * (1.0 - 0.55 * shadow);

  if (r < R + rim) {
    // Agar: warm, slightly cloudy, lit from the upper left.
    let n = noise(p * 0.035) * 0.6 + noise(p * 0.11) * 0.4;
    let glow = 1.0 - smoothstep(0.0, R, distance(p, dishCenter() + vec2f(-R, -R) * 0.25));
    var agar = vec3f(0.30, 0.21, 0.11) * (0.78 + 0.22 * n) + vec3f(0.10, 0.07, 0.03) * glow;
    agar *= 1.0 - 0.35 * smoothstep(R * 0.7, R, r);

    // Salt: heaped white grains.
    let cell = cellOf(p);
    if (r < R && walls[cell] != 0u) {
      let g = rand(cell * 2654435761u);
      let sparkle = step(0.985, rand(cell ^ (u32(P.time * 6.0) * 911u)));
      agar = vec3f(0.80, 0.80, 0.77) * (0.78 + 0.22 * g) + sparkle * 0.25;
    }

    // Slime: the trail as a height field, so dense veins shade like wet tubes.
    let e = 1.25;
    let h = height(p);
    let hx = height(p + vec2f(e, 0.0)) - height(p - vec2f(e, 0.0));
    let hy = height(p + vec2f(0.0, e)) - height(p - vec2f(0.0, e));
    let nrm = normalize(vec3f(-hx * 5.0, -hy * 5.0, 1.0));
    let diff = max(dot(nrm, L), 0.0);
    let spec = pow(max(dot(reflect(-L, nrm), vec3f(0.0, 0.0, 1.0)), 0.0), 28.0);
    let film = smoothstep(0.015, 0.25, h);
    let body = smoothstep(0.25, 0.85, h);
    var slime = mix(vec3f(0.55, 0.42, 0.06), vec3f(0.98, 0.80, 0.08), body);
    slime = mix(slime, vec3f(1.0, 0.93, 0.55), smoothstep(0.85, 1.0, h));
    slime *= 0.55 + 0.6 * diff;
    var inside = mix(agar, slime, film * 0.92) + spec * vec3f(1.0, 0.97, 0.85) * 0.55 * smoothstep(0.2, 0.7, h);

    // Oats: pale rolled flakes, each turned its own way.
    for (var k = 0u; k < P.foodCount; k++) {
      let f = foods[k];
      let ang = rand(u32(f.x * 13.0) ^ (u32(f.y * 7.0) * 2246822519u)) * 3.14159;
      let d = p - f.xy;
      let cs = vec2f(cos(ang), sin(ang));
      let lq = vec2f(dot(d, cs), dot(d, vec2f(-cs.y, cs.x))) / vec2f(OAT * 1.7, OAT * 1.15);
      let q = dot(lq, lq);
      let s = smoothstep(1.35, 0.6, length(lq - vec2f(-0.25, -0.3)));
      inside *= 1.0 - 0.35 * s * step(1.0, q);
      if (q < 1.0) {
        let dome = sqrt(1.0 - q);
        let on = normalize(vec3f(lq * 0.8, dome));
        let streak = 0.85 + 0.15 * sin(lq.y * 22.0 + noise(lq * 4.0 + f.xy) * 3.0);
        let oat = vec3f(0.86, 0.76, 0.58) * streak * (0.5 + 0.6 * max(dot(on, L), 0.0));
        inside = mix(inside, oat, smoothstep(1.0, 0.85, q));
      }
    }

    // The lamp's pool of light.
    if (P.lamp.w > 0.5) {
      let d = distance(p, P.lamp.xy) / P.lamp.z;
      inside += vec3f(1.0, 0.92, 0.75) * 0.22 * smoothstep(1.0, 0.0, d);
      inside += vec3f(1.0, 0.92, 0.75) * 0.25 * smoothstep(0.04, 0.0, abs(d - 1.0));
    }

    col = select(col, inside, r < R);

    // Glass: the dish wall, bright where it faces the light.
    let w = smoothstep(R - 3.0, R, r) * smoothstep(R + rim, R + rim - 3.0, r);
    let facing = dot(normalize(p - dishCenter()), normalize(vec2f(-0.6, -0.8)));
    col = mix(col, vec3f(0.85, 0.82, 0.76) * (0.28 + 0.6 * max(facing, 0.0)), w * 0.65);
    col += vec3f(1.0) * 0.18 * smoothstep(3.0, 0.0, abs(r - (R + 1.5))) * (0.4 + 0.6 * max(facing, 0.0));
  }

  // A little film grain keeps the dark areas from banding.
  col += (rand((u32(px.x) * 1973u) ^ (u32(px.y) * 9277u) ^ (P.frame * 26699u)) - 0.5) * 0.018;
  return vec4f(col, 1.0);
}
`;
