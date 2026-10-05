// The survey's terrain: one WebGL2 fragment shader draws the whole sheet each
// frame from the camera alone, so the land never runs out and needs no tiles.
// Heights come from seeded noise, so every visitor sees the same land.
// Drawn like a topographic quadrangle: brown contours that thin out or fill in
// with zoom, blue water, green woodland, and red section lines.

export interface View {
  /** World point at the centre of the canvas; one world unit is one section. */
  x: number;
  y: number;
  /** CSS pixels per world unit. */
  zoom: number;
  /** World radius of the land drawn so far, around the reveal point; the rest is blank sheet. */
  reveal: number;
  revealX: number;
  revealY: number;
  /** World radius of the settled land, which rises out of the water. */
  settled: number;
  /** The survey office, which sits on a hill of its own. */
  officeX: number;
  officeY: number;
}

export interface Terrain {
  render(view: View): void;
}

const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0))[gl_VertexID];
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uZoom;
uniform float uDpr;
uniform float uReveal;
uniform vec2 uRevealAt;
uniform float uSettled;
uniform vec2 uOffice;
out vec4 outColor;

// 2D simplex noise by Ian McEwan and Stefan Gustavson (Ashima Arts), MIT licence.
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

const mat2 TURN = mat2(0.8, -0.6, 0.6, 0.8);

float fbm(vec2 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    sum += amp * snoise(p);
    p = TURN * p * 2.03 + vec2(17.1, -3.7);
    amp *= 0.5;
  }
  return sum;
}

// Height above the water line. The settled land around the origin is lifted
// clear of the water, so every plot sits on dry ground.
float height(vec2 w) {
  vec2 p = w * 0.16;
  vec2 warp = vec2(fbm(p * 0.5 + vec2(3.1, 7.7), 2), fbm(p * 0.5 + vec2(-5.2, 1.3), 2));
  float h = fbm(p + 0.6 * warp, 5) - 0.06;
  float lift = 1.0 - smoothstep(uSettled - 2.0, uSettled + 10.0, length(w));
  vec2 office = w - uOffice;
  float hill = exp(-dot(office, office) / 7.0);
  return h + 0.42 * lift + 0.7 * hill;
}

// Coverage of lines spaced every interval through value v, width in device px.
// Lines fade out where they would crowd closer than a few pixels.
float lines(float v, float interval, float px, float width) {
  float dist = abs(fract(v / interval + 0.5) - 0.5) * interval / max(px, 1e-6);
  float spacing = interval / max(px, 1e-6);
  float line = 1.0 - smoothstep(width * 0.5 - 0.5, width * 0.5 + 0.5, dist);
  return line * smoothstep(2.5 * uDpr, 6.0 * uDpr, spacing);
}

vec3 hex(int c) {
  return vec3(float((c >> 16) & 255), float((c >> 8) & 255), float(c & 255)) / 255.0;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 w = uCenter + vec2(frag.x - uRes.x * 0.5, uRes.y * 0.5 - frag.y) / uZoom;
  float zoomCss = uZoom / uDpr;

  vec3 paper = hex(0xf3eee0);
  vec3 color = paper;

  float h = height(w);
  float hpx = fwidth(h);

  // Land and water.
  vec3 low = hex(0xf2ecd9);
  vec3 high = hex(0xe6d9b8);
  vec3 land = mix(low, high, smoothstep(0.0, 0.9, h));
  float wood = snoise(w * 0.09 + vec2(40.0, -11.0)) + 0.5 * snoise(w * 0.21 + vec2(-13.0, 5.0));
  float woodEdge = fwidth(wood);
  land = mix(land, hex(0xd6e4c3), 0.85 * smoothstep(0.32 - woodEdge, 0.32 + woodEdge, wood) * smoothstep(0.02, 0.08, h));
  vec3 water = mix(hex(0xd5e8ee), hex(0xb7d4e2), smoothstep(0.0, -0.45, h));
  float wet = smoothstep(hpx, -hpx, h);
  vec3 ground = mix(land, water, wet);

  // Hillshade from the slope, lit from the north-west.
  vec2 slope = vec2(dFdx(h), -dFdy(h)) * uZoom;
  vec3 normal = normalize(vec3(-slope * 1.1, 1.0));
  float light = dot(normal, normalize(vec3(-0.6, 0.7, 1.2)));
  ground *= mix(0.88, 1.03, clamp(light, 0.0, 1.0));

  // Contours: the interval halves or doubles with zoom and cross-fades between,
  // so lines stay a readable distance apart at any scale.
  float level = log2(7.0 / max(zoomCss, 1e-3));
  float fine = exp2(floor(level));
  float blend = fract(level);
  float px = hpx;
  float minor = mix(lines(h, fine, px, 1.0 * uDpr), lines(h, fine * 2.0, px, 1.0 * uDpr), blend);
  float major = mix(lines(h, fine * 4.0, px, 1.8 * uDpr), lines(h, fine * 8.0, px, 1.8 * uDpr), blend);
  float shore = 1.0 - smoothstep(0.8 * uDpr - 0.5, 0.8 * uDpr + 0.5, abs(h) / max(px, 1e-6));
  vec3 contour = hex(0xa8703a);
  vec3 depth = hex(0x6fa3bf);
  ground = mix(ground, mix(contour, depth, wet), max(minor * 0.34, major * 0.8) * mix(1.0, 0.7, wet));
  ground = mix(ground, hex(0x3f7fa6), shore);

  // Section lines every world unit, township lines every six.
  vec2 cell = abs(fract(w) - 0.5) * zoomCss * uDpr;
  float section = 1.0 - smoothstep(0.0, 1.0 * uDpr, min(cell.x, cell.y));
  vec2 town = abs(fract((w + 2.5) / 6.0 + 0.5) - 0.5) * 6.0 * zoomCss * uDpr;
  float township = 1.0 - smoothstep(0.4 * uDpr, 1.6 * uDpr, min(town.x, town.y));
  vec3 red = hex(0xc8473b);
  float sectionAlpha = 0.32 * smoothstep(14.0, 40.0, zoomCss);
  float townAlpha = 0.55 * smoothstep(3.0, 9.0, zoomCss);

  // The reveal: land is drawn outwards from the stake; beyond is blank sheet.
  float dist = length(w - uRevealAt);
  float drawn = smoothstep(uReveal, uReveal - 1.2, dist);
  float inkEdge = smoothstep(1.2, 0.0, abs(dist - uReveal + 0.4)) * step(0.01, uReveal) * (1.0 - step(1e4, uReveal));
  color = mix(paper, ground, drawn);
  color = mix(color, red, section * sectionAlpha * mix(0.5, 1.0, drawn));
  color = mix(color, red, township * townAlpha * mix(0.6, 1.0, drawn));
  color = mix(color, contour, inkEdge * 0.35);

  // Paper grain, which also dithers the gradients.
  float grain = fract(sin(dot(frag, vec2(12.9898, 78.233))) * 43758.5453);
  color -= (grain - 0.5) * 0.03;

  outColor = vec4(color, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('Survey terrain shader:', gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

/** Starts the terrain on a canvas, or returns null where WebGL2 is unavailable. */
export function createTerrain(canvas: HTMLCanvasElement): Terrain | null {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) return null;

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Survey terrain program:', gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());

  const at = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    res: at('uRes'),
    center: at('uCenter'),
    zoom: at('uZoom'),
    dpr: at('uDpr'),
    reveal: at('uReveal'),
    revealAt: at('uRevealAt'),
    settled: at('uSettled'),
    office: at('uOffice'),
  };

  // Keep the backing store under about four million pixels; the shader runs per pixel.
  const MAX_PIXELS = 4_000_000;

  return {
    render(view) {
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      let dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (cssW * cssH * dpr * dpr > MAX_PIXELS) dpr = Math.sqrt(MAX_PIXELS / (cssW * cssH));
      const w = Math.round(cssW * dpr);
      const h = Math.round(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const scale = w / cssW;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uniforms.res, w, h);
      gl.uniform2f(uniforms.center, view.x, view.y);
      gl.uniform1f(uniforms.zoom, view.zoom * scale);
      gl.uniform1f(uniforms.dpr, scale);
      gl.uniform1f(uniforms.reveal, view.reveal);
      gl.uniform2f(uniforms.revealAt, view.revealX, view.revealY);
      gl.uniform1f(uniforms.settled, view.settled);
      gl.uniform2f(uniforms.office, view.officeX, view.officeY);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
