// Draws the playfield each frame: the static layer, then everything that moves or lights.

import { buildInserts, drawGlass, drawPlayfield, type Fonts } from './_art';
import type { Game } from './_game';
import { C, drawInsertOn, glowSprite, hexA, roundRect, starPath, taperPath, type Ctx, type Insert } from './_paint';
import { BALL_R, type Flipper } from './_physics';
import {
  APRON_Y,
  BUMPERS,
  DIVIDER_X,
  DUCK_X,
  DUCK_Y,
  H,
  PLUNGER_REST,
  PLUNGER_TRAVEL,
  SHOOTER_X,
  SLING_L,
  SLING_R,
  SPINNER_Y,
  STRIKER,
  W,
  lanePoint,
} from './_table';

export class FieldView {
  private canvas: HTMLCanvasElement;
  private ctx: Ctx;
  private layer: HTMLCanvasElement | null = null;
  private glass: HTMLCanvasElement | null = null;
  private inserts = buildInserts();
  private fonts: Fonts;
  private scale = 1;
  private dpr = 1;
  touch = false;
  reducedMotion = false;

  constructor(canvas: HTMLCanvasElement, fonts: Fonts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.fonts = fonts;
  }

  /** Size the canvas to a CSS width, keeping the playfield's proportions; rebuilds the static layer. */
  resize(cssWidth: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const cssHeight = (cssWidth * H) / W;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * this.dpr);
    this.canvas.height = Math.round(cssHeight * this.dpr);
    this.scale = this.canvas.width / W;
    this.rebuild();
  }

  setFonts(fonts: Fonts): void {
    this.fonts = fonts;
    this.rebuild();
  }

  private rebuild(): void {
    const make = () => {
      const c = document.createElement('canvas');
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const g = c.getContext('2d')!;
      g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      return { c, g };
    };
    const a = make();
    drawPlayfield(a.g, this.fonts, this.inserts);
    this.layer = a.c;
    const b = make();
    drawGlass(b.g);
    this.glass = b.c;
  }

  /** Playfield millimetres for a point in CSS pixels on the canvas. */
  toField(cssX: number, cssY: number): { x: number; y: number } {
    const k = this.scale / this.dpr || 1;
    return { x: cssX / k, y: cssY / k };
  }

  draw(game: Game, now: number): void {
    const ctx = this.ctx;
    if (!this.layer) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1a120d';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const sx = this.reducedMotion ? 0 : game.shakeX;
    const sy = this.reducedMotion ? 0 : game.shakeY;
    ctx.setTransform(this.scale, 0, 0, this.scale, sx * this.scale, sy * this.scale);
    ctx.drawImage(this.layer, 0, 0, W, H);

    if (!game.tilted) this.lamps(ctx, game, now);
    this.shooterCue(ctx, game, now);
    this.bumpers(ctx, game);
    this.spinner(ctx, game);
    this.ducks(ctx, game);
    this.slingBands(ctx, game);
    this.plunger(ctx, game);
    for (const fl of game.table.flippers) this.flipper(ctx, fl);
    this.ball(ctx, game);
    this.bellGlow(ctx, game);

    if (this.glass) ctx.drawImage(this.glass, 0, 0, W, H);
    if (game.tilted) {
      ctx.fillStyle = 'rgba(10, 6, 4, 0.42)';
      ctx.fillRect(0, 0, W, H);
    }
    if (game.phase === 'over') this.attract(ctx, game, now);
  }

  private lit(ins: Insert, level: number): void {
    if (level <= 0) return;
    this.ctx.font = ins.shape === 'ticket' ? `700 9px ${this.fonts.text}` : `600 6px ${this.fonts.text}`;
    drawInsertOn(this.ctx, ins, Math.min(1, level));
  }

  private lamps(ctx: Ctx, game: Game, now: number): void {
    const ins = this.inserts;
    const blink = Math.sin(now * Math.PI * 4) > -0.2 ? 1 : 0.15;
    for (let i = 0; i < 3; i++) this.lit(ins[`lane${i}`], game.lanes[i] ? 1 : 0);
    this.lit(ins.spinner, game.spinnerLit ? 1 : 0);
    this.lit(ins.saucer, game.saucerLit ? blink : 0);
    this.lit(ins.specialL, game.specialEarned && game.specialSide === 'L' ? 1 : 0);
    this.lit(ins.specialR, game.specialEarned && game.specialSide === 'R' ? 1 : 0);
    this.lit(ins.again, game.extraBall ? 1 : 0);
    if (game.extraBall) {
      ctx.save();
      ctx.font = `700 6.5px ${this.fonts.text}`;
      ctx.fillStyle = C.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SHOOT', ins.again.x, ins.again.y - 4);
      ctx.fillText('AGAIN', ins.again.x, ins.again.y + 4.5);
      ctx.restore();
    }
    for (let i = 0; i < 10; i++) this.lit(ins[`ticket${i}`], game.tickets > i ? 1 : 0);
    for (let i = 0; i < 10; i++) {
      const level = game.ladderShown - i;
      const flash = game.ladderLevel === 10 && game.ladderShown >= 10 ? blink : 1;
      this.lit(ins[`ladder${i}`], Math.max(0, Math.min(1, level)) * flash);
    }
  }

  private bumpers(ctx: Ctx, game: Game): void {
    for (const [i, b] of BUMPERS.entries()) {
      const lit = game.lanes[i] && !game.tilted;
      const flash = game.bumperFlash[i];
      ctx.save();
      // Skirt: a red plastic ring that tips as the ball strikes it.
      const skirt = ctx.createRadialGradient(b.x - 6, b.y - 8, 4, b.x, b.y, 31);
      skirt.addColorStop(0, '#e2574d');
      skirt.addColorStop(0.75, C.red);
      skirt.addColorStop(1, C.redDark);
      ctx.fillStyle = skirt;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 31, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hexA(C.ink, 0.6);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // The ring pulls down onto the skirt on a hit.
      const ringR = 25 - flash * 2.5;
      ctx.strokeStyle = flash > 0.05 ? '#f4f5f7' : C.chromeDark;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(b.x, b.y + flash * 1.2, ringR, 0, Math.PI * 2);
      ctx.stroke();
      // Body and cap, lit from inside when its lane is made.
      ctx.shadowColor = 'rgba(20, 10, 6, 0.45)';
      ctx.shadowBlur = 3 * this.scale;
      ctx.shadowOffsetY = 2.5 * this.scale;
      const cap = ctx.createRadialGradient(b.x - 5, b.y - 7, 2, b.x, b.y, 21);
      if (lit) {
        cap.addColorStop(0, '#fffdf2');
        cap.addColorStop(0.6, '#fbe7a8');
        cap.addColorStop(1, '#e8b950');
      } else {
        cap.addColorStop(0, '#f3ead6');
        cap.addColorStop(0.7, '#d9caa6');
        cap.addColorStop(1, '#a8946a');
      }
      ctx.fillStyle = cap;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = lit ? C.red : hexA(C.red, 0.75);
      starPath(ctx, b.x, b.y - 1.5, 10.5, 5, 0.46);
      ctx.fill();
      ctx.fillStyle = lit ? C.paper : hexA(C.paper, 0.85);
      ctx.font = `700 6.2px ${this.fonts.text}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lit ? '100' : '10', b.x, b.y - 0.8);
      if (lit || flash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (lit ? 0.55 : 0) + flash * 0.5;
        ctx.drawImage(glowSprite('#ffd98a'), b.x - 52, b.y - 52, 104, 104);
      }
      ctx.restore();
    }
  }

  private spinner(ctx: Ctx, game: Game): void {
    const c = Math.cos(game.spinnerAngle);
    const hgt = 6 * Math.abs(c) + 0.8;
    ctx.save();
    ctx.fillStyle = 'rgba(20, 10, 6, 0.35)';
    ctx.fillRect(13, SPINNER_Y + 2, 36, hgt + 1.5);
    const front = c >= 0;
    const g = ctx.createLinearGradient(0, SPINNER_Y - hgt, 0, SPINNER_Y + hgt);
    if (front) {
      g.addColorStop(0, C.goldLight);
      g.addColorStop(1, C.gold);
    } else {
      g.addColorStop(0, '#e6e8eb');
      g.addColorStop(1, C.chromeDark);
    }
    ctx.fillStyle = g;
    roundRect(ctx, 12, SPINNER_Y - hgt, 36, hgt * 2, 1);
    ctx.fill();
    if (front && hgt > 3) {
      ctx.fillStyle = C.red;
      ctx.fillRect(14, SPINNER_Y - hgt * 0.35, 32, hgt * 0.7);
    }
    ctx.restore();
  }

  private ducks(ctx: Ctx, game: Game): void {
    ctx.save();
    for (const [i, x] of DUCK_X.entries()) {
      const down = game.duckDown[i];
      // The slot each duck drops into.
      ctx.fillStyle = '#1c130c';
      ctx.fillRect(x - 13, DUCK_Y - 3, 26, 6);
      if (down >= 0.999) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 16, DUCK_Y - 40, 32, 40 + 2);
      ctx.clip();
      ctx.translate(x, DUCK_Y + down * 24);
      const facing = i % 2 === 0 ? 1 : -1;
      ctx.scale(facing, 1);
      ctx.shadowColor = 'rgba(20, 10, 6, 0.4)';
      ctx.shadowBlur = 2 * this.scale;
      ctx.shadowOffsetY = 2 * this.scale;
      // A painted tin duck: body, head, bill, and a wing line, standing on its target plate.
      ctx.fillStyle = C.goldLight;
      ctx.beginPath();
      ctx.moveTo(-11, -3);
      ctx.bezierCurveTo(-12, -10, -6, -13, 1, -12);
      ctx.bezierCurveTo(3, -16, 3, -21, 7, -22);
      ctx.bezierCurveTo(11, -22.5, 12.5, -19, 11, -16.5);
      ctx.lineTo(15, -15.5);
      ctx.lineTo(11.5, -13.6);
      ctx.bezierCurveTo(10.5, -11, 11, -6, 9, -3);
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.fillStyle = C.red;
      ctx.beginPath();
      ctx.moveTo(11.2, -16.4);
      ctx.lineTo(15, -15.5);
      ctx.lineTo(11.5, -13.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(8, -18.5, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hexA(C.goldDark, 0.9);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-6, -8);
      ctx.quadraticCurveTo(-1, -5, 4, -8.5);
      ctx.stroke();
      // The target plate it stands on.
      ctx.fillStyle = C.paper;
      ctx.fillRect(-12.5, -3.2, 25, 5.4);
      ctx.strokeStyle = C.red;
      ctx.lineWidth = 1;
      ctx.strokeRect(-12.5, -3.2, 25, 5.4);
      ctx.restore();
    }
    ctx.restore();
  }

  private slingBands(ctx: Ctx, game: Game): void {
    for (const [side, s] of [
      ['L', SLING_L],
      ['R', SLING_R],
    ] as const) {
      const f = game.slingFlash[side];
      if (f <= 0) continue;
      // The kicker throws the band out toward the ball.
      const nx = side === 'L' ? 0.951 : -0.951;
      const ny = -0.309;
      const mx = (s.a.x + s.c.x) / 2 + nx * f * 5;
      const my = (s.a.y + s.c.y) / 2 + ny * f * 5;
      ctx.save();
      ctx.strokeStyle = C.rubber;
      ctx.lineWidth = 4.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.quadraticCurveTo(mx, my, s.c.x, s.c.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  private plunger(ctx: Ctx, game: Game): void {
    const pull = game.plunger + game.plungerSnap * 0.15;
    const tip = PLUNGER_REST + pull * PLUNGER_TRAVEL;
    ctx.save();
    ctx.beginPath();
    ctx.rect(DIVIDER_X + 4, 0, 40, APRON_Y + 17);
    ctx.clip();
    // Rod and spring below the tip.
    ctx.fillStyle = C.chromeDark;
    ctx.fillRect(SHOOTER_X - 2.5, tip + 4, 5, 80);
    ctx.strokeStyle = '#d7d9dd';
    ctx.lineWidth = 1.1;
    const coils = 7;
    const len = APRON_Y + 60 - tip;
    ctx.beginPath();
    for (let i = 0; i <= coils * 8; i++) {
      const t = i / (coils * 8);
      const y = tip + 8 + t * len;
      const x = SHOOTER_X + Math.sin(t * coils * Math.PI * 2) * 6;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // The rubber tip.
    ctx.fillStyle = '#2a2420';
    roundRect(ctx, SHOOTER_X - 12, tip, 24, 8, 3);
    ctx.fill();
    ctx.restore();
  }

  private flipper(ctx: Ctx, fl: Flipper): void {
    const tx = fl.px + Math.cos(fl.angle) * fl.len;
    const ty = fl.py + Math.sin(fl.angle) * fl.len;
    ctx.save();
    ctx.shadowColor = 'rgba(20, 10, 6, 0.45)';
    ctx.shadowBlur = 3 * this.scale;
    ctx.shadowOffsetX = 1.2 * this.scale;
    ctx.shadowOffsetY = 3 * this.scale;
    taperPath(ctx, fl.px, fl.py, tx, ty, fl.rb, fl.rt);
    ctx.fillStyle = C.red;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // White bat inside its red rubber.
    taperPath(ctx, fl.px, fl.py, tx, ty, fl.rb - 2.2, fl.rt - 2);
    const g = ctx.createLinearGradient(fl.px, fl.py - 10, fl.px, fl.py + 10);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#ddd6c6');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = C.chrome;
    ctx.beginPath();
    ctx.arc(fl.px, fl.py, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.chromeDark;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  private ball(ctx: Ctx, game: Game): void {
    const b = game.ball;
    if (!b.live) return;
    ctx.save();
    // Shadow, cast away from the lamps in the backbox.
    ctx.fillStyle = 'rgba(15, 8, 4, 0.38)';
    ctx.beginPath();
    ctx.ellipse(b.x + 2.4, b.y + 5, BALL_R * 1.02, BALL_R * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    // Polished steel: the room's light from above, the playfield's colour from below.
    const g = ctx.createRadialGradient(b.x - 4.5, b.y - 5.5, 1, b.x, b.y, BALL_R * 1.05);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.18, '#e9ecf0');
    g.addColorStop(0.55, '#9da3ac');
    g.addColorStop(0.85, '#4d525b');
    g.addColorStop(1, '#2a2d33');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(214, 160, 90, 0.22)';
    ctx.beginPath();
    ctx.ellipse(b.x + 1, b.y + BALL_R * 0.7, BALL_R * 0.95, BALL_R * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.ellipse(b.x - 4.6, b.y - 5.4, 2.6, 1.8, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private bellGlow(ctx: Ctx, game: Game): void {
    if (game.bellFlash <= 0) return;
    const p = lanePoint(STRIKER.len - 4, 2);
    const f = game.bellFlash;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, f * 1.4);
    ctx.drawImage(glowSprite('#ffd36b'), p.x - 80, p.y - 84, 160, 160);
    ctx.restore();
    // Ringing lines, spreading out as the bell sounds.
    ctx.save();
    ctx.strokeStyle = hexA(C.goldLight, Math.min(1, f * 1.6));
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const spread = (1 - f) * 10;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const r = 20 + k * 7 + spread;
        const a0 = side < 0 ? Math.PI * 0.82 : -Math.PI * 0.18;
        ctx.beginPath();
        ctx.arc(p.x, p.y - 6, r, a0, a0 + Math.PI * 0.36);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** While the ball waits on the plunger, the shooter lane's chevrons light in turn, up the lane. */
  private shooterCue(ctx: Ctx, game: Game, now: number): void {
    const b = game.ball;
    if (!b.live || b.x < DIVIDER_X || b.y < PLUNGER_REST - BALL_R - 6 || game.phase !== 'play') return;
    const step = Math.floor(now * 5) % 4;
    ctx.save();
    ctx.lineWidth = 3.4;
    ctx.lineJoin = 'miter';
    for (const [i, y] of [930, 905, 880].entries()) {
      if (i !== step && step !== 3) continue;
      ctx.strokeStyle = C.goldLight;
      ctx.beginPath();
      ctx.moveTo(480, y + 8);
      ctx.lineTo(490, y);
      ctx.lineTo(500, y + 8);
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(glowSprite('#ffd36b'), 470, y - 16, 40, 40);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  private attract(ctx: Ctx, game: Game, now: number): void {
    const x = 236;
    const y = 800;
    ctx.save();
    ctx.globalAlpha = 0.85 + 0.15 * Math.sin(now * 3);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 8 * this.scale;
    ctx.shadowOffsetY = 3 * this.scale;
    ctx.fillStyle = C.paper;
    roundRect(ctx, x - 92, y - 26, 184, 52, 4);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 2;
    roundRect(ctx, x - 88, y - 22, 176, 44, 3);
    ctx.stroke();
    ctx.fillStyle = C.red;
    ctx.font = `400 17px ${this.fonts.display}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.touch ? 'Touch to play' : 'Press Start', x, y - 5);
    ctx.fillStyle = C.ink;
    ctx.font = `600 7.5px ${this.fonts.text}`;
    const line =
      game.score > 0
        ? `LAST GAME ${game.score.toLocaleString('en-US')}`
        : this.touch
          ? 'LEFT AND RIGHT HALVES FLIP'
          : 'OR PRESS SPACE';
    ctx.fillText(line, x, y + 13);
    ctx.restore();
  }
}
