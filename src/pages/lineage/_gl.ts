// One WebGL 2 canvas behind the page draws every picture into its own box. Shaders compile
// in the background where the browser allows it, and pictures can also be drawn off screen
// for thumbnails and saved images.

import { VERTEX } from './_compile';

export interface Program {
  readonly prog: WebGLProgram;
  readonly loc: Record<'rect' | 'view' | 'm' | 't' | 'a' | 'ss', WebGLUniformLocation | null>;
  failed: boolean;
  readonly src: string;
}

export interface Draw {
  program: Program;
  /** Box in CSS pixels, relative to the canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Centre and half-height of the view. */
  view: [number, number, number];
  m: number;
  a: number;
}

const COMPLETION_STATUS_KHR = 0x91b1;

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private vs: WebGLShader;
  private vao: WebGLVertexArrayObject;
  private parallel: boolean;
  private cache = new Map<string, Program>();
  private used = new Map<string, number>();
  private clock = 0;
  dpr = 1;
  width = 0;
  height = 0;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
  ) {
    this.gl = gl;
    this.parallel = !!gl.getExtension('KHR_parallel_shader_compile');
    const vs = gl.createShader(gl.VERTEX_SHADER);
    if (!vs) throw new Error('no vertex shader');
    gl.shaderSource(vs, VERTEX);
    gl.compileShader(vs);
    this.vs = vs;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('no vertex array');
    this.vao = vao;
  }

  static create(canvas: HTMLCanvasElement): Renderer | null {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return null;
    try {
      return new Renderer(canvas, gl);
    } catch {
      return null;
    }
  }

  /** Sizes the drawing buffer to the canvas; returns true if it changed. */
  resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.canvas.width && h === this.canvas.height && dpr === this.dpr) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    this.dpr = dpr;
    this.width = w;
    this.height = h;
    return true;
  }

  /** Starts compiling a fragment shader, or returns the one already made from this source. */
  program(source: string): Program {
    this.used.set(source, ++this.clock);
    const hit = this.cache.get(source);
    if (hit) return hit;
    const p = this.build(source);
    this.cache.set(source, p);
    this.evict();
    return p;
  }

  /** A program outside the cache, for one off-screen render; pass it to `drop` afterwards. */
  temp(source: string): Program {
    return this.build(source);
  }

  drop(p: Program): void {
    if (![...this.cache.values()].includes(p)) this.gl.deleteProgram(p.prog);
  }

  private build(source: string): Program {
    const gl = this.gl;
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    const prog = gl.createProgram();
    if (!fs || !prog) throw new Error('out of shaders');
    gl.shaderSource(fs, source);
    gl.compileShader(fs);
    gl.attachShader(prog, this.vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(fs);
    const loc = {
      rect: null,
      view: null,
      m: null,
      t: null,
      a: null,
      ss: null,
    } as Program['loc'];
    return { prog, loc, failed: false, src: source };
  }

  /** Whether a program has finished compiling, without blocking if the browser can tell. */
  ready(p: Program): boolean {
    if (p.failed) return true;
    if (this.parallel && !this.gl.getProgramParameter(p.prog, COMPLETION_STATUS_KHR)) return false;
    this.finish(p);
    return true;
  }

  private finish(p: Program): void {
    const gl = this.gl;
    if (p.loc.rect || p.failed) return;
    if (!gl.getProgramParameter(p.prog, gl.LINK_STATUS)) {
      console.error('lineage: shader failed to link', gl.getProgramInfoLog(p.prog));
      p.failed = true;
      return;
    }
    p.loc.rect = gl.getUniformLocation(p.prog, 'u_rect');
    p.loc.view = gl.getUniformLocation(p.prog, 'u_view');
    p.loc.m = gl.getUniformLocation(p.prog, 'u_m');
    p.loc.t = gl.getUniformLocation(p.prog, 'u_t');
    p.loc.a = gl.getUniformLocation(p.prog, 'u_a');
    p.loc.ss = gl.getUniformLocation(p.prog, 'u_ss');
  }

  /** Drops the least recently asked-for programs once the cache grows past what a few litters need. */
  private evict(): void {
    if (this.cache.size <= 72) return;
    const old = [...this.used.entries()].sort((a, b) => a[1] - b[1]).slice(0, this.cache.size - 60);
    for (const [src] of old) {
      const p = this.cache.get(src);
      if (p) this.gl.deleteProgram(p.prog);
      this.cache.delete(src);
      this.used.delete(src);
    }
  }

  clear(rgb: [number, number, number]): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(rgb[0], rgb[1], rgb[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Draws pictures into their boxes on the canvas, in order, so later ones can fade over earlier ones. */
  draw(list: Draw[], t: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const d = this.dpr;
    const ss = d < 1.5 ? 2 : 1;
    for (const item of list) {
      const p = item.program;
      // Programs on screen stay the most recently used, so the cache never drops one mid-draw.
      if (this.cache.get(p.src) === p) this.used.set(p.src, ++this.clock);
      if (p.failed || !this.ready(p)) continue;
      const x = Math.round(item.x * d);
      const w = Math.round((item.x + item.w) * d) - x;
      const top = Math.round(item.y * d);
      const h = Math.round((item.y + item.h) * d) - top;
      const y = this.height - top - h;
      if (w <= 0 || h <= 0) continue;
      gl.viewport(x, y, w, h);
      gl.useProgram(p.prog);
      gl.uniform4f(p.loc.rect, x, y, w, h);
      gl.uniform3f(p.loc.view, item.view[0], item.view[1], item.view[2]);
      gl.uniform1f(p.loc.m, item.m);
      gl.uniform1f(p.loc.t, t);
      gl.uniform1f(p.loc.a, item.a);
      gl.uniform1f(p.loc.ss, ss);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
  }

  /** Renders one picture off screen and returns its pixels, top row first. Blocks until compiled. */
  pixels(
    p: Program,
    w: number,
    h: number,
    view: [number, number, number],
    t: number,
    ss = 2,
  ): Uint8ClampedArray<ArrayBuffer> {
    const gl = this.gl;
    this.finish(p);
    const out = new Uint8ClampedArray(w * h * 4);
    if (p.failed) return out.fill(128);
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.useProgram(p.prog);
    gl.uniform3f(p.loc.view, view[0], view[1], view[2]);
    gl.uniform1f(p.loc.m, 1);
    gl.uniform1f(p.loc.t, t);
    gl.uniform1f(p.loc.a, 1);
    gl.uniform1f(p.loc.ss, ss);
    // Large images go in bands, so no single draw runs long enough to stall the GPU.
    const band = Math.max(1, Math.floor(1_200_000 / w));
    const row = new Uint8ClampedArray(w * 4);
    const buf = new Uint8ClampedArray(w * band * 4);
    gl.uniform4f(p.loc.rect, 0, 0, w, h);
    for (let y0 = 0; y0 < h; y0 += band) {
      const bh = Math.min(band, h - y0);
      gl.viewport(0, 0, w, h);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, y0, w, bh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
      const view8 = bh === band ? buf : new Uint8ClampedArray(w * bh * 4);
      gl.readPixels(0, y0, w, bh, gl.RGBA, gl.UNSIGNED_BYTE, view8);
      // WebGL rows run bottom up; flip them into place.
      for (let r = 0; r < bh; r++) {
        row.set(view8.subarray(r * w * 4, (r + 1) * w * 4));
        out.set(row, (h - 1 - (y0 + r)) * w * 4);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    return out;
  }
}
