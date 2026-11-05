// The backglass: reverse-painted art over the lamps, the score reels behind their window, and the lamp
// legends (game over, tilt, shoot again, ball in play, match, credits). Two layouts: the full glass beside
// the playfield, and a strip over it on narrow screens.

import type { Fonts } from './_art';
import type { Game } from './_game';
import { C, arcText, glowSprite, hexA, roundRect, seeded, starPath, type Ctx } from './_paint';
import { BALLS_PER_GAME } from './_rules';

type Layout = 'full' | 'strip';

const FULL = { w: 1000, h: 1080 };
const STRIP = { w: 1000, h: 250 };

interface Bulb {
  x: number;
  y: number;
}

export class GlassView {
  private canvas: HTMLCanvasElement;
  private ctx: Ctx;
  private layer: HTMLCanvasElement | null = null;
  private fonts: Fonts;
  private layout: Layout = 'full';
  private scale = 1;
  private bulbs: Bulb[] = [];
  /** The reels as shown, easing forward toward the game's reels. */
  private shown = [0, 0, 0, 0, 0];

  constructor(canvas: HTMLCanvasElement, fonts: Fonts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.fonts = fonts;
  }

  resize(cssWidth: number, layout: Layout): void {
    this.layout = layout;
    const dims = layout === 'full' ? FULL : STRIP;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const cssHeight = (cssWidth * dims.h) / dims.w;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.scale = this.canvas.width / dims.w;
    this.rebuild();
  }

  setFonts(fonts: Fonts): void {
    this.fonts = fonts;
    this.rebuild();
  }

  private rebuild(): void {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    if (this.layout === 'full') this.paintFull(g);
    else this.paintStrip(g);
    this.layer = c;
  }

  // ---- Static art -----------------------------------------------------------

  private night(g: Ctx, w: number, h: number, inset: number): void {
    g.fillStyle = '#0b0b10';
    g.fillRect(0, 0, w, h);
    const sky = g.createLinearGradient(0, inset, 0, h - inset);
    sky.addColorStop(0, '#0d1230');
    sky.addColorStop(0.7, C.navy);
    sky.addColorStop(1, '#3a2346');
    g.fillStyle = sky;
    roundRect(g, inset, inset, w - inset * 2, h - inset * 2, inset * 0.6);
    g.fill();
    g.strokeStyle = C.gold;
    g.lineWidth = Math.max(2, inset * 0.18);
    g.stroke();
    const rnd = seeded(91);
    for (let i = 0; i < (this.layout === 'full' ? 70 : 34); i++) {
      const x = inset + rnd() * (w - inset * 2);
      const y = inset + rnd() * (h - inset * 2) * 0.75;
      const big = rnd() < 0.18;
      g.fillStyle = big ? C.goldLight : hexA(C.paper, 0.75);
      if (big) {
        starPath(g, x, y, 5 + rnd() * 5, 5, 0.42, -Math.PI / 2 + rnd());
        g.fill();
      } else {
        g.beginPath();
        g.arc(x, y, 1 + rnd() * 1.6, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  private tent(g: Ctx, cx: number, top: number, eave: number, foot: number, half: number): void {
    // Walls: red and cream stripes.
    const stripes = 12;
    for (let i = 0; i < stripes; i++) {
      const x0 = cx - half + (i / stripes) * half * 2;
      g.fillStyle = i % 2 ? C.paper : C.red;
      g.fillRect(x0, eave, (half * 2) / stripes + 0.5, foot - eave);
    }
    // The door: a dark opening with tied-back flaps.
    g.fillStyle = '#1b0f12';
    g.beginPath();
    g.moveTo(cx - 34, foot);
    g.lineTo(cx, eave + 64);
    g.lineTo(cx + 34, foot);
    g.closePath();
    g.fill();
    g.fillStyle = C.goldLight;
    g.beginPath();
    g.arc(cx, eave + 70, 6, 0, Math.PI * 2);
    g.fill();
    // Roof: a cone of stripes up to the pole.
    for (let i = 0; i < stripes; i++) {
      const a = cx - half - 18 + (i / stripes) * (half + 18) * 2;
      const b = cx - half - 18 + ((i + 1) / stripes) * (half + 18) * 2;
      g.fillStyle = i % 2 ? C.paper : C.red;
      g.beginPath();
      g.moveTo(cx, top);
      g.lineTo(a, eave);
      g.lineTo(b + 0.5, eave);
      g.closePath();
      g.fill();
    }
    // Valance along the eave.
    const r = (half + 18) / 7;
    g.fillStyle = C.red;
    g.beginPath();
    g.moveTo(cx - half - 18, eave - 2);
    for (let x = cx - half - 18; x < cx + half + 17; x += r * 2) g.arc(x + r, eave, r, Math.PI, 0, true);
    g.closePath();
    g.fill();
    g.strokeStyle = C.gold;
    g.lineWidth = 4;
    g.beginPath();
    for (let x = cx - half - 18; x < cx + half + 17; x += r * 2) g.arc(x + r, eave, r - 4, Math.PI, 0, true);
    g.stroke();
    // Pole and pennant.
    g.strokeStyle = C.goldLight;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx, top);
    g.lineTo(cx, top - 50);
    g.stroke();
    g.fillStyle = C.red;
    g.beginPath();
    g.moveTo(cx + 2, top - 50);
    g.quadraticCurveTo(cx + 30, top - 46, cx + 52, top - 36);
    g.quadraticCurveTo(cx + 28, top - 33, cx + 2, top - 26);
    g.closePath();
    g.fill();
  }

  private ferris(g: Ctx, cx: number, cy: number, r: number): void {
    g.save();
    g.strokeStyle = '#5b6aa6';
    g.lineWidth = 6;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - r * 0.7, cy + r * 1.55);
    g.lineTo(cx, cy);
    g.lineTo(cx + r * 0.7, cy + r * 1.55);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      g.stroke();
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      g.fillStyle = [C.teal, C.gold, C.red, '#7d8bc4'][i % 4];
      roundRect(g, x - 9, y + 5, 18, 13, [2, 2, 7, 7]);
      g.fill();
      g.strokeStyle = '#5b6aa6';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 5);
      g.stroke();
    }
    g.restore();
  }

  private striker(g: Ctx, x: number, top: number, foot: number): void {
    g.save();
    const bands = 12;
    for (let i = 0; i < bands; i++) {
      g.fillStyle = i % 2 ? C.paper : C.red;
      g.fillRect(x - 14, top + ((foot - top) * i) / bands, 28, (foot - top) / bands + 0.5);
    }
    g.strokeStyle = hexA(C.ink, 0.7);
    g.lineWidth = 2;
    g.strokeRect(x - 14, top, 28, foot - top);
    // The bell.
    g.fillStyle = C.gold;
    g.beginPath();
    g.moveTo(x - 32, top - 4);
    g.bezierCurveTo(x - 26, top - 12, x - 20, top - 20, x - 18, top - 38);
    g.bezierCurveTo(x - 16, top - 54, x + 16, top - 54, x + 18, top - 38);
    g.bezierCurveTo(x + 20, top - 20, x + 26, top - 12, x + 32, top - 4);
    g.closePath();
    g.fill();
    g.fillStyle = C.goldDark;
    g.fillRect(x - 32, top - 6, 64, 5);
    // The base and the mallet leaning on it.
    g.fillStyle = C.wood;
    g.fillRect(x - 40, foot, 80, 18);
    g.strokeStyle = C.woodDark;
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x + 52, foot + 14);
    g.lineTo(x + 92, foot - 96);
    g.stroke();
    g.fillStyle = C.woodDark;
    g.save();
    g.translate(x + 94, foot - 104);
    g.rotate(0.35);
    roundRect(g, -24, -12, 48, 24, 5);
    g.fill();
    g.restore();
    g.restore();
  }

  private title(g: Ctx, cx: number, cy: number, r: number, size: number): void {
    g.save();
    g.font = `400 ${size}px ${this.fonts.display}`;
    g.fillStyle = C.redDark;
    arcText(g, 'RING THE BELL', cx + size * 0.05, cy + size * 0.07, r, -Math.PI / 2, size * 0.06);
    g.fillStyle = C.paper;
    g.strokeStyle = C.red;
    g.lineWidth = size * 0.05;
    arcText(g, 'RING THE BELL', cx, cy, r, -Math.PI / 2, size * 0.06);
    g.restore();
  }

  private lampPanel(g: Ctx, x: number, y: number, w: number, h: number): void {
    g.fillStyle = '#0a0a0e';
    roundRect(g, x, y, w, h, 14);
    g.fill();
    g.strokeStyle = C.gold;
    g.lineWidth = 3;
    g.stroke();
  }

  private paintFull(g: Ctx): void {
    const { w, h } = FULL;
    this.night(g, w, h, 26);
    // Searchlights sweeping up behind the tent.
    g.save();
    roundRect(g, 26, 26, w - 52, h - 52, 16);
    g.clip();
    g.globalAlpha = 0.09;
    g.fillStyle = C.paper;
    for (const [x, dir] of [
      [330, -1],
      [670, 1],
    ]) {
      g.beginPath();
      g.moveTo(x, 760);
      g.lineTo(x + dir * 140, 40);
      g.lineTo(x + dir * 330, 40);
      g.closePath();
      g.fill();
    }
    g.restore();
    this.ferris(g, 190, 520, 135);
    this.striker(g, 830, 300, 742);
    this.tent(g, 500, 330, 500, 760, 205);
    // Ground.
    g.fillStyle = '#1d1420';
    g.fillRect(26, 758, w - 52, 30);
    this.title(g, 500, 1200, 1010, 104);
    this.lampPanel(g, 46, 796, w - 92, 258);
    // The score window's bezel.
    g.fillStyle = '#2a2a30';
    roundRect(g, 212, 818, 576, 136, 10);
    g.fill();
    g.strokeStyle = C.chrome;
    g.lineWidth = 4;
    g.stroke();
    // Marquee bulbs on an arc under the title.
    this.bulbs = [];
    for (let i = 0; i < 31; i++) {
      const a = -Math.PI / 2 - 0.42 + (i / 30) * 0.84;
      this.bulbs.push({ x: 500 + Math.cos(a) * 1090, y: 1200 + Math.sin(a) * 1090 });
    }
  }

  private paintStrip(g: Ctx): void {
    const { w, h } = STRIP;
    this.night(g, w, h, 12);
    g.save();
    g.font = `400 62px ${this.fonts.display}`;
    g.textBaseline = 'alphabetic';
    g.fillStyle = C.redDark;
    g.fillText('Ring the Bell', 40, 102);
    g.fillStyle = C.paper;
    g.fillText('Ring the Bell', 36, 98);
    g.restore();
    // Bezel for the reels.
    g.fillStyle = '#2a2a30';
    roundRect(g, 536, 34, 440, 182, 10);
    g.fill();
    g.strokeStyle = C.chrome;
    g.lineWidth = 4;
    g.stroke();
    this.bulbs = [];
    for (let i = 0; i < 15; i++) this.bulbs.push({ x: 44 + i * 32, y: 124 });
  }

  // ---- Live parts -----------------------------------------------------------

  private reel(g: Ctx, x: number, y: number, w: number, hgt: number, pos: number | null): void {
    g.save();
    roundRect(g, x, y, w, hgt, 4);
    g.clip();
    g.fillStyle = '#f2ead7';
    g.fillRect(x, y, w, hgt);
    g.fillStyle = '#16120e';
    g.font = `600 ${hgt * 0.62}px ${this.fonts.text}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (pos === null) {
      g.fillText('0', x + w / 2, y + hgt / 2 + hgt * 0.02);
    } else {
      // Digits ride a drum: the next digit comes up from below as the reel turns.
      const base = Math.floor(pos);
      const frac = pos - base;
      for (let k = -1; k <= 1; k++) {
        const d = (((base + k) % 10) + 10) % 10;
        const off = (k - frac) * hgt * 0.78;
        const squash = Math.cos(Math.min(1.4, Math.abs(off) / (hgt * 0.62)));
        g.save();
        g.translate(x + w / 2, y + hgt / 2 - off);
        g.scale(1, Math.max(0.05, squash));
        g.fillText(String(d), 0, hgt * 0.02);
        g.restore();
      }
    }
    // Drum shading: dark toward the top and bottom of the window.
    const sh = g.createLinearGradient(0, y, 0, y + hgt);
    sh.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
    sh.addColorStop(0.28, 'rgba(0, 0, 0, 0.05)');
    sh.addColorStop(0.6, 'rgba(255, 255, 255, 0.06)');
    sh.addColorStop(1, 'rgba(0, 0, 0, 0.66)');
    g.fillStyle = sh;
    g.fillRect(x, y, w, hgt);
    g.restore();
  }

  private reels(g: Ctx, x: number, y: number, cell: number, gap: number, hgt: number): void {
    for (let k = 4; k >= 0; k--) {
      const col = 4 - k;
      this.reel(g, x + col * (cell + gap), y, cell, hgt, this.shown[k]);
    }
    this.reel(g, x + 5 * (cell + gap), y, cell, hgt, null);
  }

  private legend(g: Ctx, text: string, x: number, y: number, size: number, lit: boolean, align: CanvasTextAlign = 'center'): void {
    g.save();
    g.font = `600 ${size}px ${this.fonts.text}`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    if (lit) {
      g.shadowColor = 'rgba(255, 200, 110, 0.95)';
      g.shadowBlur = size * 0.6 * this.scale;
      g.fillStyle = '#fff4cf';
    } else {
      g.fillStyle = 'rgba(160, 60, 40, 0.32)';
    }
    g.fillText(text, x, y);
    g.restore();
  }

  private drawBulbs(g: Ctx, game: Game, now: number): void {
    const attract = game.phase === 'over';
    const bell = game.bellFlash > 0;
    for (const [i, b] of this.bulbs.entries()) {
      let on: boolean;
      if (bell) on = Math.floor(now * 10) % 2 === 0;
      else if (attract) on = (i + Math.floor(now * 7)) % 3 === 0;
      else on = true;
      const r = this.layout === 'full' ? 7 : 5;
      g.fillStyle = on ? '#fff3c4' : '#5a4a2c';
      g.beginPath();
      g.arc(b.x, b.y, r, 0, Math.PI * 2);
      g.fill();
      if (on) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.5;
        g.drawImage(glowSprite('#ffcf7a'), b.x - r * 4, b.y - r * 4, r * 8, r * 8);
        g.restore();
      }
    }
  }

  private easeReels(game: Game, dt: number): void {
    for (let k = 0; k < 5; k++) {
      const target = game.reels[k];
      let cur = this.shown[k];
      const ahead = (((target - cur) % 10) + 10) % 10;
      if (ahead < 0.001 || ahead > 9.999) {
        this.shown[k] = target;
        continue;
      }
      cur += Math.min(ahead, dt * 24);
      this.shown[k] = cur >= 10 ? cur - 10 : cur;
    }
  }

  draw(game: Game, now: number, dt: number): void {
    const g = this.ctx;
    if (!this.layer) return;
    this.easeReels(game, dt);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.layer, 0, 0);
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.drawBulbs(g, game, now);
    const over = game.phase === 'over';
    const ballLit = (n: number) => !over && game.phase !== 'match' && game.ballNumber === n;
    if (this.layout === 'full') {
      this.reels(g, 230, 830, 82, 10, 112);
      this.legend(g, 'TILT', 128, 886, 40, game.tilted);
      this.legend(g, 'SHOOT', 872, 868, 30, game.extraBall);
      this.legend(g, 'AGAIN', 872, 904, 30, game.extraBall);
      this.legend(g, 'GAME OVER', 500, 1004, 42, over);
      this.legend(g, 'BALL IN PLAY', 160, 982, 22, !over);
      for (let n = 1; n <= BALLS_PER_GAME; n++) this.legend(g, String(n), 160 + (n - 3) * 34, 1024, 28, ballLit(n));
      this.legend(g, 'CREDITS', 320, 982, 22, true);
      this.legend(g, String(game.credits), 320, 1024, 32, true);
      this.legend(g, 'MATCH', 775, 982, 22, game.matchNumber !== null);
      for (let i = 0; i < 10; i++) {
        const v = i * 10;
        this.legend(g, v === 0 ? '00' : String(v), 640 + i * 30, 1024, 19, game.matchNumber === v);
      }
      if (game.bellFlash > 0) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = game.bellFlash;
        g.drawImage(glowSprite('#ffd36b'), 830 - 130, 262 - 130, 260, 260);
        g.restore();
      }
    } else {
      this.reels(g, 550, 50, 62, 8, 150);
      this.legend(g, 'BALL', 40, 166, 26, !over, 'left');
      for (let n = 1; n <= BALLS_PER_GAME; n++) this.legend(g, String(n), 104 + n * 24, 166, 26, ballLit(n));
      this.legend(g, 'CREDIT', 290, 166, 26, true, 'left');
      this.legend(g, String(game.credits), 380, 166, 26, true, 'left');
      this.legend(g, 'GAME OVER', 40, 212, 28, over, 'left');
      this.legend(g, 'TILT', 210, 212, 28, game.tilted, 'left');
      this.legend(g, 'SHOOT AGAIN', 280, 212, 28, game.extraBall, 'left');
      if (game.matchNumber !== null) {
        this.legend(g, `MATCH ${game.matchNumber === 0 ? '00' : game.matchNumber}`, 430, 166, 26, true, 'left');
      }
    }
  }
}
