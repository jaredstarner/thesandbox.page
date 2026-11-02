// The WebGL 2 side: the shader, the atmosphere's transmittance table, and the
// textures the tile levels are written into.

import { FRAG, VERT } from './_shader';
import type { Vec3 } from './_sky';

export const TILE = 512;
/** The whole-world level: zoom 2, 5 by 3 tiles. */
export const GLOBAL = { z: 2, cols: 5, rows: 3 };

export interface View {
  cam: Vec3;
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
  tanX: number;
  tanY: number;
  sun: Vec3;
  moon: Vec3;
  moonLight: number;
  exposure: number;
  time: number;
  /** Sidereal angle, radians, to turn the sky. */
  gmst: number;
  /** Angle one pixel spans, radians. */
  pix: number;
}

export interface Residency {
  /** Per window level: first column (unwrapped), first row, degrees per tile, columns around the world. */
  win: number[];
  dayMask: number[];
  auxMask: number[];
  gDayMask: number;
  gAuxMask: number;
}

const R = 6371;
const RA = 6471;

/** Sunlight left after the climb from altitude h (km) out of the atmosphere at a zenith cosine mu. */
function transmittanceTable(w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 4);
  const ext = (alt: number) => {
    const ray = Math.exp(-alt / 8);
    const mie = Math.exp(-alt / 1.2) * 4.4e-3;
    const oz = Math.max(0, 1 - Math.abs(alt - 25) / 15);
    return [5.802e-3 * ray + mie + 0.65e-3 * oz, 13.558e-3 * ray + mie + 1.881e-3 * oz, 33.1e-3 * ray + mie + 0.085e-3 * oz];
  };
  for (let j = 0; j < h; j++) {
    const v = (j + 0.5) / h;
    const r0 = R + 100 * v * v;
    for (let i = 0; i < w; i++) {
      const mu = -0.35 + (1.35 * (i + 0.5)) / w;
      const k = (j * w + i) * 4;
      out[k + 3] = 1;
      if (mu < 0 && r0 * r0 * (1 - mu * mu) < R * R) continue;
      const t = -r0 * mu + Math.sqrt(Math.max(0, r0 * r0 * mu * mu - r0 * r0 + RA * RA));
      const steps = 48;
      const dt = t / steps;
      let tr = 0;
      let tg = 0;
      let tb = 0;
      for (let s = 0; s < steps; s++) {
        const ts = (s + 0.5) * dt;
        const alt = Math.sqrt(r0 * r0 + ts * ts + 2 * r0 * ts * mu) - R;
        const e = ext(Math.max(alt, 0));
        tr += e[0] * dt;
        tg += e[1] * dt;
        tb += e[2] * dt;
      }
      out[k] = Math.exp(-tr);
      out[k + 1] = Math.exp(-tg);
      out[k + 2] = Math.exp(-tb);
    }
  }
  return out;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private loc = new Map<string, WebGLUniformLocation | null>();
  private dayG: WebGLTexture;
  private auxG: WebGLTexture;
  private dayW: WebGLTexture;
  private auxW: WebGLTexture;
  private trans: WebGLTexture;
  private auroraTex: WebGLTexture;
  private dirty = new Set<WebGLTexture>();
  private lastMip = 0;
  auroraOn = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    /** Window levels are n by n tiles. */
    readonly n: number,
  ) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.prog = this.program(VERT, FRAG);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(this.prog, 'a_pos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const maxAniso = aniso ? Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 0;
    const filters = (target: number, wrapS: number, wrapT: number) => {
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, wrapS);
      gl.texParameteri(target, gl.TEXTURE_WRAP_T, wrapT);
      if (aniso && maxAniso > 1) gl.texParameterf(target, aniso.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
    };
    const levels = (size: number) => Math.floor(Math.log2(size)) + 1;

    const gw = GLOBAL.cols * TILE;
    const gh = GLOBAL.rows * TILE;
    this.dayG = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.dayG);
    gl.texStorage2D(gl.TEXTURE_2D, levels(gw), gl.RGBA8, gw, gh);
    filters(gl.TEXTURE_2D, gl.REPEAT, gl.CLAMP_TO_EDGE);
    this.auxG = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.auxG);
    gl.texStorage2D(gl.TEXTURE_2D, levels(gw), gl.RGBA8, gw, gh);
    filters(gl.TEXTURE_2D, gl.REPEAT, gl.CLAMP_TO_EDGE);

    const ws = n * TILE;
    this.dayW = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.dayW);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels(ws), gl.RGBA8, ws, ws, 3);
    filters(gl.TEXTURE_2D_ARRAY, gl.REPEAT, gl.REPEAT);
    this.auxW = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.auxW);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels(ws), gl.RGBA8, ws, ws, 2);
    filters(gl.TEXTURE_2D_ARRAY, gl.REPEAT, gl.REPEAT);

    const TW = 512;
    const TH = 96;
    this.trans = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.trans);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, TW, TH, 0, gl.RGBA, gl.FLOAT, transmittanceTable(TW, TH));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.auroraTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.auroraTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 360, 181, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(360 * 181));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.useProgram(this.prog);
    const units: [string, number][] = [
      ['u_trans', 0],
      ['u_aurora', 1],
      ['u_dayG', 2],
      ['u_auxG', 3],
      ['u_dayW', 4],
      ['u_auxW', 5],
    ];
    for (const [name, unit] of units) gl.uniform1i(this.u(name), unit);
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }

  private u(name: string) {
    if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.loc.get(name)!;
  }

  /** A whole-world picture drawn on the page, shown until the real tiles arrive (or if they never do). */
  globalImage(kind: 'day' | 'aux', src: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, kind === 'day' ? this.dayG : this.auxG);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    this.dirty.add(kind === 'day' ? this.dayG : this.auxG);
  }

  globalTile(kind: 'day' | 'aux', col: number, row: number, data: Uint8Array) {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.bindTexture(gl.TEXTURE_2D, kind === 'day' ? this.dayG : this.auxG);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, col * TILE, row * TILE, TILE, TILE, gl.RGBA, gl.UNSIGNED_BYTE, data);
    this.dirty.add(kind === 'day' ? this.dayG : this.auxG);
  }

  windowTile(kind: 'day' | 'aux', layer: number, slotC: number, slotR: number, data: Uint8Array) {
    const gl = this.gl;
    const tex = kind === 'day' ? this.dayW : this.auxW;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, slotC * TILE, slotR * TILE, layer, TILE, TILE, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    this.dirty.add(tex);
  }

  /** OVATION's grid: 360 longitudes by 181 latitudes (south to north), each 0 to 100. */
  aurora(grid: Uint8Array) {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.auroraTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 360, 181, gl.RED, gl.UNSIGNED_BYTE, grid);
    this.auroraOn = true;
  }

  private mipmaps(now: number) {
    if (!this.dirty.size || now - this.lastMip < 400) return;
    const gl = this.gl;
    for (const tex of this.dirty) {
      const target = tex === this.dayW || tex === this.auxW ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;
      gl.bindTexture(target, tex);
      gl.generateMipmap(target);
    }
    this.dirty.clear();
    this.lastMip = now;
  }

  draw(v: View, res: Residency, now: number) {
    const gl = this.gl;
    this.mipmaps(now);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    const bind = (unit: number, target: number, tex: WebGLTexture) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, tex);
    };
    bind(0, gl.TEXTURE_2D, this.trans);
    bind(1, gl.TEXTURE_2D, this.auroraTex);
    bind(2, gl.TEXTURE_2D, this.dayG);
    bind(3, gl.TEXTURE_2D, this.auxG);
    bind(4, gl.TEXTURE_2D_ARRAY, this.dayW);
    bind(5, gl.TEXTURE_2D_ARRAY, this.auxW);
    gl.activeTexture(gl.TEXTURE0);

    gl.uniform3fv(this.u('u_cam'), v.cam);
    gl.uniform3fv(this.u('u_right'), v.right);
    gl.uniform3fv(this.u('u_up'), v.up);
    gl.uniform3fv(this.u('u_fwd'), v.fwd);
    gl.uniform2f(this.u('u_tan'), v.tanX, v.tanY);
    gl.uniform3fv(this.u('u_sun'), v.sun);
    gl.uniform3fv(this.u('u_moon'), v.moon);
    gl.uniform1f(this.u('u_moonLight'), v.moonLight);
    gl.uniform1f(this.u('u_exposure'), v.exposure);
    gl.uniform1f(this.u('u_time'), v.time);
    gl.uniform1f(this.u('u_gmst'), v.gmst);
    gl.uniform1f(this.u('u_pix'), v.pix);
    gl.uniform1f(this.u('u_auroraOn'), this.auroraOn ? 1 : 0);
    gl.uniform4fv(this.u('u_win'), res.win);
    gl.uniform1i(this.u('u_winN'), this.n);
    gl.uniform1iv(this.u('u_dayMask'), res.dayMask);
    gl.uniform1iv(this.u('u_auxMask'), res.auxMask);
    gl.uniform1i(this.u('u_gDayMask'), res.gDayMask);
    gl.uniform1i(this.u('u_gAuxMask'), res.gAuxMask);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
