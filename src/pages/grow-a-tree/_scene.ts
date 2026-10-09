// The three.js scene: instanced branches and leaves that sway in the shader,
// a plug of soil the roots show through, and the seed.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LEAF_CAP, SEG_CAP, type Pose } from './_pose';
import type { Species } from './_species';
import { SWAY_GLSL } from './_wind';
import { drawLeafAtlas } from './_atlas';

const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.03 + 7.1) * 0.3 + vnoise(p * 4.11 + 3.7) * 0.15;
}
`;

const LIGHT_GLSL = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uGround;
vec3 light(vec3 n, float ao) {
  float diff = max(dot(n, uSun), 0.0);
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
  return amb * ao + uSunColor * diff * mix(0.55, 1.0, ao);
}
`;

const BRANCH_VERT = /* glsl */ `
${SWAY_GLSL}
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec2 aR;
attribute vec2 aFlex;
attribute vec2 aDist;
attribute vec2 aInfo;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vBark;
varying float vR;
varying vec2 vInfo;
void main() {
  vec3 axis = aEnd - aStart;
  float len = length(axis);
  vec3 dir = len > 1e-6 ? axis / len : vec3(0.0, 1.0, 0.0);
  vec3 ref = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 U = normalize(cross(dir, ref));
  vec3 W = cross(dir, U);
  float v = position.y;
  float r = mix(aR.x, aR.y, v);
  vec3 s0 = aStart + sway(aStart, aFlex.x);
  vec3 s1 = aEnd + sway(aEnd, aFlex.y);
  vec3 c = mix(s0, s1, v) + dir * (v * aR.y * 0.7);
  vec3 n = U * position.x + W * position.z;
  vec3 world = c + n * r;
  vNormal = n;
  vWorld = world;
  vBark = vec2(uv.x, mix(aDist.x, aDist.y, v));
  vR = r;
  vInfo = aInfo;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const BRANCH_FRAG = /* glsl */ `
${NOISE_GLSL}
${LIGHT_GLSL}
uniform vec3 uBark0;
uniform vec3 uBark1;
uniform vec3 uBark2;
uniform float uBarkMode;
uniform float uTipR;
uniform vec3 uCrownC;
uniform float uCrownR;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vBark;
varying float vR;
varying vec2 vInfo;
void main() {
  vec3 n = normalize(vNormal);
  float circ = 6.2831853 * max(vR, 0.001);
  vec2 bp = vec2(vBark.x * circ, vBark.y);
  float old = smoothstep(uTipR * 3.0, 0.16, vR);
  vec3 col;
  if (vInfo.y > 0.5) {
    // Roots: pale where young, darker and corky where old.
    float g = fbm(bp * vec2(20.0, 4.0));
    col = mix(vec3(0.78, 0.66, 0.5), vec3(0.42, 0.31, 0.22), old) * (0.8 + 0.3 * g);
  } else if (uBarkMode < 0.5) {
    // Oak: deep vertical fissures on old wood.
    float f = fbm(vec2(bp.x * 9.0, bp.y * 1.6));
    float ridge = smoothstep(0.32, 0.62, f);
    col = mix(uBark0, uBark1, old);
    col *= mix(1.0, mix(0.42, 1.08, ridge), old);
  } else if (uBarkMode < 1.5) {
    // Birch: white with dark lenticels; the base cracks into dark diamonds.
    float len = smoothstep(0.74, 0.8, vnoise(vec2(bp.x * 2.5, bp.y * 34.0)));
    float blot = smoothstep(0.62, 0.7, fbm(vec2(bp.x * 1.4, bp.y * 3.0)));
    col = mix(vec3(0.42, 0.24, 0.16), uBark0, smoothstep(0.004, 0.025, vR));
    col = mix(col, uBark2, max(len, blot * 0.85) * old);
    float baseZone = (1.0 - smoothstep(0.4, 2.2, vWorld.y)) * smoothstep(0.07, 0.18, vR);
    float crack = smoothstep(0.35, 0.6, fbm(vec2(bp.x * 7.0, bp.y * 2.4)));
    col = mix(col, uBark1 * mix(0.55, 1.2, crack), baseZone);
  } else {
    // Spruce: thin scales, red-brown.
    float s = vnoise(bp * vec2(22.0, 11.0));
    col = mix(uBark0, uBark1, old) * (0.8 + 0.35 * s);
    col = mix(col, uBark2, smoothstep(0.75, 0.9, s) * old);
  }
  if (vInfo.y < 0.5) {
    // Current shoots are green-brown.
    col = mix(vec3(0.38, 0.42, 0.2), col, smoothstep(uTipR * 0.9, uTipR * 2.6, vR));
    // Dead wood weathers to silver.
    float g = fbm(bp * vec2(6.0, 2.0));
    col = mix(col, vec3(0.46, 0.43, 0.39) * (0.75 + 0.35 * g), vInfo.x);
  }
  float inner = 1.0 - clamp(length(vWorld - uCrownC) / max(uCrownR, 0.01), 0.0, 1.0);
  float ao = mix(1.0, 0.55, inner * smoothstep(0.0, 0.4, vWorld.y)) ;
  gl_FragColor = vec4(col * light(n, ao), 1.0);
  #include <colorspace_fragment>
}
`;

const LEAF_VERT = /* glsl */ `
${SWAY_GLSL}
attribute vec3 aPos;
attribute vec4 aA;
attribute vec4 aB;
uniform float uSeason;
uniform float uDeciduous;
uniform float uLeafCell;
uniform vec2 uFruitWin;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorld;
varying float vRand;
varying float vCell;
varying float vKind;
void main() {
  float rnd = aB.y;
  float kind = aB.z;
  float size = aA.w;
  float s = uSeason;
  bool leafy = kind < 0.5 || (kind > 2.5 && kind < 3.5);
  bool fruit = kind > 3.5;
  if (fruit) {
    size *= step(uFruitWin.x, s) * (1.0 - step(uFruitWin.y, s));
  }
  if (leafy && uDeciduous > 0.5) {
    float bud = smoothstep(0.02 + rnd * 0.06, 0.13 + rnd * 0.06, s);
    float drop = 1.0 - smoothstep(0.79 + rnd * 0.07, 0.83 + rnd * 0.07, s);
    size *= bud * drop;
  }
  if (size <= 0.00001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float needle = (leafy && uLeafCell > 1.5) || (kind > 1.5 && kind < 2.5) ? 1.0 : 0.0;
  vec3 up = normalize(aA.xyz);
  vec3 ref = abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 side = normalize(cross(up, ref));
  vec3 nrm = cross(side, up);
  float flutter = sin(uTime * (7.0 + rnd * 6.0) + rnd * 40.0) * (0.08 + 0.55 * uBreeze) * (0.35 + uGust);
  float spin = aB.w * (leafy || fruit ? 1.0 : 0.0) + flutter * (fruit ? 0.3 : 1.0 - needle * 0.7);
  vec3 s2 = side * cos(spin) + nrm * sin(spin);
  vec3 n2 = cross(s2, up);
  float w = fruit ? 0.6 : needle > 0.5 ? (leafy ? 0.5 : 0.25) : 1.0;
  float along = needle > 0.5 && leafy ? position.y - 0.5 : position.y;
  vec3 world = aPos + sway(aPos, aB.x) + (s2 * (position.x - 0.5) * w + up * along) * size;
  vUv = position.xy;
  vN = n2;
  vWorld = world;
  vRand = rnd;
  vCell = fruit ? 6.0 + uLeafCell : kind > 2.5 ? 4.0 + uLeafCell : kind > 1.5 ? 2.0 : (kind > 0.5 ? 3.0 : uLeafCell);
  vKind = leafy ? 0.0 : fruit ? 4.0 : kind;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const LEAF_FRAG = /* glsl */ `
${LIGHT_GLSL}
uniform sampler2D uAtlas;
uniform float uSeason;
uniform float uDeciduous;
uniform vec3 uSpring;
uniform vec3 uSummer;
uniform vec3 uAutumn;
uniform vec3 uCrownC;
uniform float uCrownR;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorld;
varying float vRand;
varying float vCell;
varying float vKind;
void main() {
  vec4 tex = texture2D(uAtlas, vec2((vCell + vUv.x) / 9.0, vUv.y));
  if (tex.a < 0.45) discard;
  float s = uSeason;
  vec3 col;
  if (vKind > 3.5) {
    col = pow(tex.rgb, vec3(2.2)) * 1.6;
  } else if (vKind > 0.5) {
    col = vec3(0.45, 0.62, 0.25);
  } else if (uDeciduous > 0.5) {
    col = mix(uSpring, uSummer, smoothstep(0.12, 0.34, s));
    col = mix(col, uAutumn * (0.8 + 0.4 * vRand), smoothstep(0.5 + vRand * 0.12, 0.7 + vRand * 0.08, s));
  } else {
    col = mix(uSummer, uSpring, smoothstep(0.08, 0.2, s) * (1.0 - smoothstep(0.3, 0.5, s)) * step(0.7, vRand));
    col *= mix(1.0, 0.82, smoothstep(0.8, 0.95, s));
  }
  col *= 0.8 + 0.35 * vRand;
  if (vKind < 3.5) col *= tex.rgb;
  vec3 n = normalize(gl_FrontFacing ? vN : -vN);
  vec3 out1 = normalize(vWorld - uCrownC + vec3(0.0, 0.001, 0.0));
  vec3 nn = normalize(mix(n, out1, 0.6));
  float rim = clamp(length(vWorld - uCrownC) / max(uCrownR, 0.01), 0.0, 1.0);
  float ao = mix(0.42, 1.0, rim);
  vec3 lit = light(nn, ao);
  float back = pow(max(dot(-nn, uSun), 0.0), 2.0) * 0.35;
  gl_FragColor = vec4(col * (lit + uSunColor * back * vec3(0.8, 1.0, 0.5)), 1.0);
  #include <colorspace_fragment>
}
`;

const SOIL_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vNormal;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SOIL_FRAG = /* glsl */ `
${NOISE_GLSL}
${LIGHT_GLSL}
uniform float uDepth;
uniform float uAlpha;
uniform float uShade;
uniform float uScale;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vNormal;
void main() {
  float d = clamp(-vWorld.y / max(uDepth, 0.001), 0.0, 1.0);
  vec2 q = vec2(atan(vWorld.z, vWorld.x) * 6.0, vWorld.y / uScale * 6.0);
  vec3 humus = vec3(0.17, 0.12, 0.08);
  vec3 loam = vec3(0.36, 0.25, 0.16);
  vec3 clay = vec3(0.55, 0.38, 0.22);
  float wav = (fbm(q * 0.6) - 0.5) * 0.12;
  vec3 col = mix(humus, loam, smoothstep(0.04, 0.2, d + wav));
  col = mix(col, clay, smoothstep(0.5, 0.85, d + wav));
  float grain = vnoise(q * 9.0);
  col *= 0.82 + 0.3 * grain;
  float stone = smoothstep(0.9, 0.94, vnoise(q * 5.0 + 11.0));
  col = mix(col, vec3(0.5, 0.46, 0.4), stone * 0.45);
  vec3 n = normalize(vNormal);
  col *= light(n, 0.9) * uShade;
  gl_FragColor = vec4(col, uAlpha);
  #include <colorspace_fragment>
}
`;

const TOP_FRAG = /* glsl */ `
${NOISE_GLSL}
${LIGHT_GLSL}
uniform float uSeason;
uniform float uShadowR;
uniform float uShadow;
uniform vec2 uShadowC;
uniform float uScale;
uniform float uTrunkR;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vNormal;
void main() {
  vec2 p = vWorld.xz / uScale;
  float g = fbm(p * 18.0);
  float tuft = vnoise(p * 70.0);
  vec3 grass = mix(vec3(0.3, 0.45, 0.18), vec3(0.48, 0.58, 0.26), g);
  grass *= 0.85 + 0.3 * tuft;
  float s = uSeason;
  vec3 litter = mix(vec3(0.6, 0.38, 0.16), vec3(0.42, 0.28, 0.14), tuft);
  grass = mix(grass, litter, smoothstep(0.62, 0.8, s) * smoothstep(0.45, 0.6, g) * 0.8 * (1.0 - smoothstep(0.9, 1.0, s)));
  grass = mix(grass, vec3(0.78, 0.8, 0.78) * (0.92 + 0.12 * tuft), smoothstep(0.86, 0.95, s) * 0.75);
  vec2 q = vWorld.xz - uShadowC;
  float sh = 1.0 - smoothstep(uShadowR * 0.2, uShadowR, length(q));
  float contact = 1.0 - smoothstep(uTrunkR, uTrunkR * 3.0 + 0.004, length(vWorld.xz));
  float shade = 1.0 - uShadow * sh * 0.55 - contact * 0.35;
  float rim = smoothstep(0.92, 1.0, length(vLocal.xy));
  vec3 col = grass * light(vec3(0.0, 1.0, 0.0), 1.0) * shade * (1.0 - rim * 0.25);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const DROP_FRAG = /* glsl */ `
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, d)) * 0.28;
  gl_FragColor = vec4(0.12, 0.16, 0.12, a);
}
`;

const DROP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

function dynamic(arr: Float32Array, size: number): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(arr, size);
  a.setUsage(THREE.DynamicDrawUsage);
  return a;
}

function cylinder(radial: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let row = 0; row <= 1; row++) {
    for (let k = 0; k <= radial; k++) {
      const t = (k / radial) * Math.PI * 2;
      pos.push(Math.cos(t), row, Math.sin(t));
      uv.push(k / radial, row);
    }
  }
  const w = radial + 1;
  for (let k = 0; k < radial; k++) {
    const a = k;
    const b = k + 1;
    const c = k + w;
    const d = k + 1 + w;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const srgb = (c: [number, number, number]): THREE.Color => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

export interface WindUniforms {
  time: number;
  freq: number;
  gust: number;
  breeze: number;
  dirX: number;
  dirZ: number;
}

export class Scene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private scene = new THREE.Scene();
  private shared: Record<string, THREE.IUniform>;
  private branchGeo: THREE.InstancedBufferGeometry;
  private leafGeo: THREE.InstancedBufferGeometry;
  private branchMat: THREE.ShaderMaterial;
  private leafMat: THREE.ShaderMaterial;
  private soilBack: THREE.Mesh;
  private soilFront: THREE.Mesh;
  private soilBottom: THREE.Mesh;
  private top: THREE.Mesh;
  private topMat: THREE.ShaderMaterial;
  private drop: THREE.Mesh;
  private seeds: Record<string, THREE.Group> = {};
  private attrs: Record<string, THREE.InstancedBufferAttribute> = {};
  readonly sunDir = new THREE.Vector3(0.55, 0.78, 0.32).normalize();
  plugR = 0.1;
  plugDepth = 0.08;

  constructor(canvas: HTMLCanvasElement, pose: Pose) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.001, 2000);
    this.camera.position.set(0.12, 0.06, 0.3);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.8;

    this.shared = {
      uTime: { value: 0 },
      uFreq: { value: 1 },
      uGust: { value: 0 },
      uBreeze: { value: 0.4 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uHeight: { value: 1 },
      uSun: { value: this.sunDir },
      uSunColor: { value: new THREE.Color(0xfff0d8).multiplyScalar(1.05) },
      uSky: { value: new THREE.Color(0xb9cbd6).multiplyScalar(0.7) },
      uGround: { value: new THREE.Color(0x6b6a4a).multiplyScalar(0.55) },
      uCrownC: { value: new THREE.Vector3() },
      uCrownR: { value: 1 },
      uSeason: { value: 0.4 },
    };

    // Branches.
    const bg = new THREE.InstancedBufferGeometry();
    const cyl = cylinder(8);
    bg.index = cyl.index;
    bg.setAttribute('position', cyl.getAttribute('position'));
    bg.setAttribute('uv', cyl.getAttribute('uv'));
    this.attrs.aStart = dynamic(pose.segStart, 3);
    this.attrs.aEnd = dynamic(pose.segEnd, 3);
    this.attrs.aR = dynamic(pose.segR, 2);
    this.attrs.aFlex = dynamic(pose.segFlex, 2);
    this.attrs.aDist = dynamic(pose.segDist, 2);
    this.attrs.aInfo = dynamic(pose.segInfo, 2);
    for (const k of ['aStart', 'aEnd', 'aR', 'aFlex', 'aDist', 'aInfo']) bg.setAttribute(k, this.attrs[k]);
    bg.instanceCount = 0;
    this.branchGeo = bg;
    this.branchMat = new THREE.ShaderMaterial({
      vertexShader: BRANCH_VERT,
      fragmentShader: BRANCH_FRAG,
      uniforms: {
        ...this.shared,
        uBark0: { value: new THREE.Color() },
        uBark1: { value: new THREE.Color() },
        uBark2: { value: new THREE.Color() },
        uBarkMode: { value: 0 },
        uTipR: { value: 0.003 },
      },
    });
    const branches = new THREE.Mesh(bg, this.branchMat);
    branches.frustumCulled = false;
    this.scene.add(branches);

    // Leaves.
    const lg = new THREE.InstancedBufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    lg.setIndex([0, 1, 2, 0, 2, 3]);
    this.attrs.aPos = dynamic(pose.leafPos, 3);
    this.attrs.aA = dynamic(pose.leafA, 4);
    this.attrs.aB = dynamic(pose.leafB, 4);
    for (const k of ['aPos', 'aA', 'aB']) lg.setAttribute(k, this.attrs[k]);
    lg.instanceCount = 0;
    this.leafGeo = lg;
    const atlas = new THREE.CanvasTexture(drawLeafAtlas());
    atlas.anisotropy = 4;
    atlas.generateMipmaps = true;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.leafMat = new THREE.ShaderMaterial({
      vertexShader: LEAF_VERT,
      fragmentShader: LEAF_FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        ...this.shared,
        uAtlas: { value: atlas },
        uDeciduous: { value: 1 },
        uLeafCell: { value: 0 },
        uFruitWin: { value: new THREE.Vector2(0, 1) },
        uSpring: { value: new THREE.Color() },
        uSummer: { value: new THREE.Color() },
        uAutumn: { value: new THREE.Color() },
      },
    });
    const leaves = new THREE.Mesh(lg, this.leafMat);
    leaves.frustumCulled = false;
    this.scene.add(leaves);

    // The soil plug: back wall and floor first, roots, then the front wall over them.
    const soilUniforms = (alpha: number, shade: number) => ({
      ...this.shared,
      uDepth: { value: 0.1 },
      uAlpha: { value: alpha },
      uShade: { value: shade },
      uScale: { value: 0.1 },
    });
    const wall = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true);
    wall.translate(0, -0.5, 0);
    const backMat = new THREE.ShaderMaterial({
      vertexShader: SOIL_VERT,
      fragmentShader: SOIL_FRAG,
      uniforms: soilUniforms(1, 0.55),
      side: THREE.BackSide,
    });
    const frontMat = new THREE.ShaderMaterial({
      vertexShader: SOIL_VERT,
      fragmentShader: SOIL_FRAG,
      uniforms: soilUniforms(0.5, 1.1),
      side: THREE.FrontSide,
      transparent: true,
      depthWrite: false,
    });
    this.soilBack = new THREE.Mesh(wall, backMat);
    this.soilFront = new THREE.Mesh(wall, frontMat);
    this.soilFront.renderOrder = 5;
    const floor = new THREE.CircleGeometry(1, 72);
    floor.rotateX(Math.PI / 2);
    floor.translate(0, -1, 0);
    this.soilBottom = new THREE.Mesh(floor, backMat);
    const topGeo = new THREE.CircleGeometry(1, 96);
    topGeo.rotateX(-Math.PI / 2);
    this.topMat = new THREE.ShaderMaterial({
      vertexShader: SOIL_VERT,
      fragmentShader: TOP_FRAG,
      uniforms: {
        ...this.shared,
        uShadowR: { value: 0.1 },
        uShadow: { value: 0 },
        uShadowC: { value: new THREE.Vector2() },
        uScale: { value: 0.1 },
        uTrunkR: { value: 0.002 },
      },
    });
    // Seen from below, the top would hide the roots; it only faces up.
    this.top = new THREE.Mesh(topGeo, this.topMat);
    this.scene.add(this.soilBack, this.soilBottom, this.top, this.soilFront);
    for (const m of [this.soilBack, this.soilBottom, this.soilFront, this.top]) m.frustumCulled = false;

    const dropGeo = new THREE.PlaneGeometry(1, 1);
    dropGeo.rotateX(-Math.PI / 2);
    this.drop = new THREE.Mesh(
      dropGeo,
      new THREE.ShaderMaterial({ vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, transparent: true, depthWrite: false }),
    );
    this.scene.add(this.drop);

    // Plain lights for the seeds.
    this.scene.add(new THREE.HemisphereLight(0xdfe8ee, 0x6b6a4a, 1.6));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.copy(this.sunDir);
    this.scene.add(sun);
    this.buildSeeds();
  }

  private buildSeeds(): void {
    const lambert = (hex: number) => new THREE.MeshLambertMaterial({ color: hex });
    // Acorn on its side, cup and all.
    const acorn = new THREE.Group();
    const nut = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), lambert(0x9b7a36));
    nut.scale.set(0.0075, 0.0125, 0.0075);
    const cup = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lambert(0x6a5434));
    cup.scale.set(0.0084, 0.0068, 0.0084);
    cup.position.y = -0.0045;
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.008, 6), lambert(0x5a472c));
    stalk.position.y = -0.014;
    acorn.add(nut, cup, stalk);
    acorn.rotation.z = Math.PI / 2.2;
    acorn.position.set(0.008, 0.0072, 0.002);
    this.seeds.oak = acorn;
    // Birch: a tiny nut between two papery wings.
    const birch = new THREE.Group();
    const bn = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), lambert(0x6e5434));
    bn.scale.set(0.0011, 0.0003, 0.0018);
    const wing = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshLambertMaterial({ color: 0xc7a878, side: THREE.DoubleSide }));
    wing.rotation.x = -Math.PI / 2;
    wing.scale.set(0.0034, 0.0019, 1);
    birch.add(wing, bn);
    birch.position.set(0.004, 0.0004, 0.001);
    birch.rotation.y = 0.6;
    this.seeds.birch = birch;
    // Spruce: a seed at the root of one long wing.
    const spruce = new THREE.Group();
    const sn = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), lambert(0x4a3524));
    sn.scale.set(0.0015, 0.0008, 0.0022);
    const sw = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshLambertMaterial({ color: 0xb58a5a, side: THREE.DoubleSide }));
    sw.rotation.x = -Math.PI / 2;
    sw.scale.set(0.0028, 0.006, 1);
    sw.position.z = 0.005;
    spruce.add(sw, sn);
    spruce.position.set(0.004, 0.0008, -0.002);
    spruce.rotation.y = -0.9;
    this.seeds.spruce = spruce;
    for (const g of Object.values(this.seeds)) {
      g.visible = false;
      this.scene.add(g);
    }
  }

  setSpecies(sp: Species): void {
    const u = this.branchMat.uniforms;
    (u.uBark0.value as THREE.Color).copy(srgb(sp.bark[0]));
    (u.uBark1.value as THREE.Color).copy(srgb(sp.bark[1]));
    (u.uBark2.value as THREE.Color).copy(srgb(sp.bark[2]));
    u.uBarkMode.value = sp.id === 'oak' ? 0 : sp.id === 'birch' ? 1 : 2;
    u.uTipR.value = sp.tipR;
    const l = this.leafMat.uniforms;
    l.uDeciduous.value = sp.deciduous ? 1 : 0;
    l.uLeafCell.value = sp.leaf === 'oak' ? 0 : sp.leaf === 'birch' ? 1 : 2;
    (l.uFruitWin.value as THREE.Vector2).set(sp.fruitSeason[0], sp.fruitSeason[1]);
    (l.uSpring.value as THREE.Color).copy(srgb(sp.leafColors[0]));
    (l.uSummer.value as THREE.Color).copy(srgb(sp.leafColors[1]));
    (l.uAutumn.value as THREE.Color).copy(srgb(sp.leafColors[2]));
    for (const [id, g] of Object.entries(this.seeds)) g.visible = id === sp.id;
  }

  /** Seed object: where it lies, to name it on a tap. */
  seedPosition(sp: Species): THREE.Vector3 {
    return this.seeds[sp.id].position.clone();
  }

  upload(pose: Pose, sp: Species, age: number): void {
    const sc = pose.segCount;
    const lc = pose.leafCount;
    for (const [k, size] of [
      ['aStart', 3],
      ['aEnd', 3],
      ['aR', 2],
      ['aFlex', 2],
      ['aDist', 2],
      ['aInfo', 2],
    ] as const) {
      const a = this.attrs[k];
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, sc * size));
      a.needsUpdate = true;
    }
    for (const [k, size] of [
      ['aPos', 3],
      ['aA', 4],
      ['aB', 4],
    ] as const) {
      const a = this.attrs[k];
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, lc * size));
      a.needsUpdate = true;
    }
    this.branchGeo.instanceCount = Math.min(sc, SEG_CAP);
    this.leafGeo.instanceCount = Math.min(lc, LEAF_CAP);

    // The plug grows to hold the roots and frame the crown.
    const want = Math.max(sp.id === 'oak' ? 0.045 : 0.03, pose.rootR * 1.15, pose.crownR * 0.75, pose.height * 0.22);
    const wantD = Math.max(0.03, pose.rootDepth * 1.18, want * 0.4);
    this.plugR = want;
    this.plugDepth = wantD;
    for (const m of [this.soilBack, this.soilFront, this.soilBottom]) m.scale.set(want, wantD, want);
    this.top.scale.set(want, 1, want);
    for (const m of [this.soilBack, this.soilFront] as THREE.Mesh[]) {
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uDepth.value = wantD;
      u.uScale.value = Math.max(0.05, want);
    }
    const tu = this.topMat.uniforms;
    tu.uScale.value = Math.max(0.05, want * 0.5);
    tu.uShadowR.value = Math.max(0.01, pose.crownR * 1.05);
    tu.uShadow.value = Math.min(1, pose.leafAmount * 1.2 + 0.15) * Math.min(1, pose.height * 3);
    const off = pose.crownMid / Math.max(this.sunDir.y, 0.2);
    (tu.uShadowC.value as THREE.Vector2).set(-this.sunDir.x * off, -this.sunDir.z * off);
    tu.uTrunkR.value = Math.max(0.0015, pose.trunkR);
    this.drop.position.y = -wantD - want * 0.25;
    this.drop.scale.set(want * 3, 1, want * 3);

    (this.shared.uCrownC.value as THREE.Vector3).set(0, pose.crownMid, 0);
    this.shared.uCrownR.value = Math.max(0.02, Math.max(pose.crownR, pose.height * 0.25) * 1.05);
    this.shared.uHeight.value = Math.max(0.02, pose.height);
    this.shared.uFreq.value = 2.2 / Math.sqrt(Math.max(pose.height, 0.4));
    const seed = this.seeds[sp.id];
    seed.visible = age < sp.seedHold;
    const fade = Math.min(1, Math.max(0, (sp.seedHold - age) / (sp.seedHold * 0.3)));
    seed.scale.setScalar(0.6 + 0.4 * fade);
  }

  setWind(w: WindUniforms): void {
    this.shared.uTime.value = w.time;
    this.shared.uGust.value = w.gust;
    this.shared.uBreeze.value = w.breeze;
    (this.shared.uWindDir.value as THREE.Vector2).set(w.dirX, w.dirZ);
  }

  setSeason(s: number): void {
    this.shared.uSeason.value = s;
  }

  get freq(): number {
    return this.shared.uFreq.value as number;
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
