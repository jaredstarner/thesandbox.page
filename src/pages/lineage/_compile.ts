// Turns a genome into a fragment shader. With a parent, every weight and function is written
// as a blend from the parent's value to the child's, so one uniform (u_m) carries the
// picture from what its parent drew to what it draws.

import { IN, OUT, type Act, type Genome } from './_genome';

const GLSL: Record<Act, string> = {
  sin: 'sin(x)',
  cos: 'cos(x)',
  gauss: '2.0 * exp(-2.5 * x * x) - 1.0',
  tanh: 'tanh(x)',
  edge: 'tanh(5.0 * x)',
  abs: 'abs(x) - 0.5',
  tri: '1.0 - 4.0 * abs(fract(0.25 * x + 0.25) - 0.5)',
  linear: 'x',
};

const num = (v: number) => {
  const s = (Math.round(v * 1000) / 1000).toString();
  return s.includes('.') || s.includes('e') ? s : s + '.0';
};

export const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** The shared part of every picture's shader: framing, colour, and anti-aliasing. */
function frame(body: string): string {
  return `#version 300 es
precision highp float;
uniform vec4 u_rect;   // the picture's box in device pixels, from the bottom left
uniform vec3 u_view;   // centre and half-height of the view
uniform float u_m;     // 0 draws the parent, 1 the child
uniform float u_t;     // the clock, in radians
uniform float u_a;     // opacity, for crossfades
uniform float u_ss;    // samples per side
out vec4 o;

${Object.entries(GLSL)
  .map(([name, expr]) => `float a_${name}(float x) { return ${expr}; }`)
  .join('\n')}

vec3 net(vec2 p) {
  float n${IN.bias} = 1.0;
  float n${IN.x} = p.x;
  float n${IN.y} = p.y;
  float n${IN.r} = length(p) * 1.4;
  float n${IN.ts} = sin(u_t);
  float n${IN.tc} = cos(u_t);
${body}
  return vec3(n${OUT.l}, n${OUT.a}, n${OUT.b});
}

// OKLab to linear sRGB.
vec3 rgbOf(vec3 lab) {
  float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 colour(vec3 n) {
  float L = 0.5 + 0.48 * tanh(0.9 * n.x);
  vec2 ab = 0.16 * tanh(n.yz);
  // Colours the screen can't show lose chroma at the same lightness, rather than clipping to flat primaries.
  vec3 rgb = rgbOf(vec3(L, ab));
  for (int i = 0; i < 6; i++) {
    if (all(greaterThanEqual(rgb, vec3(-0.002))) && all(lessThanEqual(rgb, vec3(1.002)))) break;
    ab *= 0.78;
    rgb = rgbOf(vec3(L, ab));
  }
  return clamp(rgb, 0.0, 1.0);
}

vec3 encode(vec3 c) {
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 local = gl_FragCoord.xy - u_rect.xy;
  float scale = u_view.z / (0.5 * u_rect.w);
  vec3 sum = vec3(0.0);
  int n = int(u_ss);
  for (int j = 0; j < 4; j++) {
    if (j >= n) break;
    for (int i = 0; i < 4; i++) {
      if (i >= n) break;
      vec2 off = (vec2(float(i), float(j)) + 0.5) / u_ss - 0.5;
      vec2 p = u_view.xy + (local + off - 0.5 * u_rect.zw) * scale;
      sum += colour(net(p));
    }
  }
  o = vec4(encode(sum / (u_ss * u_ss)), u_a);
}`;
}

/** A shader for `g`, blending from `parent` (or from flat grey when there is none) as u_m runs 0 to 1. */
export function compile(g: Genome, parent: Genome | null): string {
  const before = new Map<string, number>();
  const actBefore = new Map<number, Act>();
  if (parent) {
    for (const l of parent.links) if (l.on) before.set(`${l.from}>${l.to}`, l.w);
    for (const n of parent.nodes) actBefore.set(n.id, n.act);
  }
  const after = new Map<string, number>();
  for (const l of g.links) if (l.on) after.set(`${l.from}>${l.to}`, l.w);

  // Every wire either genome has, grouped by the node it feeds.
  const into = new Map<number, { from: number; a: number; b: number }[]>();
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const [from, to] = k.split('>').map(Number);
    const a = before.get(k) ?? 0;
    const b = after.get(k) ?? 0;
    if (a === 0 && b === 0) continue;
    const list = into.get(to) ?? [];
    list.push({ from, a, b });
    into.set(to, list);
  }

  const weight = (a: number, b: number) =>
    a === b ? num(a) : parent ? `mix(${num(a)}, ${num(b)}, u_m)` : `(${num(b)} * u_m)`;
  const sum = (id: number) => {
    const terms = (into.get(id) ?? []).sort((p, q) => p.from - q.from).map((t) => `${weight(t.a, t.b)} * n${t.from}`);
    return terms.length ? terms.join(' + ') : '0.0';
  };

  const lines: string[] = [];
  for (const n of [...g.nodes].sort((a, b) => a.depth - b.depth || a.id - b.id)) {
    const was = actBefore.get(n.id) ?? n.act;
    const s = `s${n.id}`;
    lines.push(`  float ${s} = ${sum(n.id)};`);
    lines.push(
      was === n.act
        ? `  float n${n.id} = a_${n.act}(${s});`
        : `  float n${n.id} = mix(a_${was}(${s}), a_${n.act}(${s}), u_m);`,
    );
  }
  for (const id of [OUT.l, OUT.a, OUT.b]) lines.push(`  float n${id} = ${sum(id)};`);
  return frame(lines.join('\n'));
}
