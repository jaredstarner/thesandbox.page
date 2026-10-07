// The ink: every placed word is a sprite that remembers where it was. When the
// type reflows, a word that moved a little glides to its new place; one that
// jumped (to another row, or across the sheet) fades out where it was and
// inks in where it lands, and new words pour in one after another in reading
// order.

import type { Piece } from './_flow';

interface Sprite {
  text: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  a: number;
  /** Fade target: 1 while placed, 0 once the word has left. */
  ta: number;
  /** Seconds to wait before inking in. */
  wait: number;
  rubric: boolean;
  sx: number;
  tone: number;
}

const tone = (id: number) => {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return 0.8 + ((h >>> 0) / 4294967296) * 0.2;
};

export class Ink {
  private sprites = new Map<number, Sprite>();
  private ghosts: Sprite[] = [];
  /** Seconds between one new word and the next as they pour in. */
  pour = 0.006;

  /** Fade out everything at once, as when the passage changes. */
  retire(): void {
    for (const s of this.sprites.values()) {
      if (s.a > 0.01) this.ghosts.push({ ...s, ta: 0, wait: 0 });
    }
    this.sprites.clear();
  }

  /** Move to a new placement. `jump` is how far a word may glide. */
  update(pieces: Piece[], jump: number, drop: number): void {
    const seen = new Set<number>();
    let fresh = 0;
    for (const p of pieces) {
      seen.add(p.id);
      let s = this.sprites.get(p.id);
      if (!s) {
        s = { text: p.text, x: p.x, y: p.y + drop, tx: p.x, ty: p.y, a: 0, ta: 1, wait: 0, rubric: p.rubric, sx: p.sx, tone: tone(p.id) };
        s.wait = Math.min(fresh++ * this.pour, 0.9);
        this.sprites.set(p.id, s);
        continue;
      }
      const far = Math.abs(p.y - s.ty) > jump || Math.abs(p.x - s.tx) > jump * 4;
      if (s.text !== p.text || far || s.ta === 0) {
        if (s.a > 0.01 && (s.text !== p.text || far)) this.ghosts.push({ ...s, ta: 0, wait: 0 });
        if (s.text !== p.text || far || s.a < 0.01) {
          s.x = p.x;
          s.y = p.y + drop;
          s.a = 0;
          s.wait = Math.min(fresh++ * this.pour, 0.9);
        }
        s.text = p.text;
        s.rubric = p.rubric;
      }
      s.sx = p.sx;
      s.tx = p.x;
      s.ty = p.y;
      s.ta = 1;
    }
    for (const [id, s] of this.sprites) {
      if (seen.has(id)) continue;
      s.ta = 0;
      s.wait = 0;
    }
  }

  /** Advance by dt seconds. Returns true while anything is still moving. */
  step(dt: number, still: boolean): boolean {
    const glide = still ? 1 : 1 - Math.exp(-dt * 16);
    const fade = still ? 1 : dt * 4;
    let busy = false;
    for (const [id, s] of this.sprites) {
      if (s.wait > 0) {
        s.wait -= dt;
        busy = true;
        if (s.wait > 0 && !still) continue;
        s.wait = 0;
      }
      s.x += (s.tx - s.x) * glide;
      s.y += (s.ty - s.y) * glide;
      if (Math.abs(s.tx - s.x) < 0.05) s.x = s.tx;
      if (Math.abs(s.ty - s.y) < 0.05) s.y = s.ty;
      s.a = s.ta > s.a ? Math.min(s.ta, s.a + fade) : Math.max(s.ta, s.a - fade * 1.5);
      if (s.ta === 0 && s.a === 0) {
        this.sprites.delete(id);
        continue;
      }
      if (s.a !== s.ta || s.x !== s.tx || s.y !== s.ty) busy = true;
    }
    for (const g of this.ghosts) g.a = Math.max(0, g.a - fade * 1.5);
    this.ghosts = this.ghosts.filter((g) => g.a > 0);
    return busy || this.ghosts.length > 0;
  }

  draw(ctx: CanvasRenderingContext2D, ink: string, red: string, settled = false): void {
    const pass = (list: Iterable<Sprite>) => {
      for (const s of list) {
        const a = settled ? (s.ta > 0 ? 1 : 0) : s.a;
        if (a < 0.004) continue;
        ctx.globalAlpha = a * s.tone;
        ctx.fillStyle = s.rubric ? red : ink;
        const x = settled ? s.tx : s.x;
        const y = settled ? s.ty : s.y;
        if (s.sx === 1) {
          ctx.fillText(s.text, x, y);
        } else {
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(s.sx, 1);
          ctx.fillText(s.text, 0, 0);
          ctx.restore();
        }
      }
    };
    if (!settled) pass(this.ghosts);
    pass(this.sprites.values());
    ctx.globalAlpha = 1;
  }
}
