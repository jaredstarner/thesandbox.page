// The workbook. Everything that happens on these sheets is written here as ordinary formulas, the same text a
// visitor reads in the formula bar and can overwrite. There is no game code anywhere else.

import { columnName, index } from './_formula';
import { BANDS, BLUE, BURN, CHECKER, GREEN, HEAT, INK, INKWASH, LIFE, MAZE, PLAN, RED, RISO, SNAKE } from './_palette';
import { Sheet, makeFormula, type Area, type Block, type Merge } from './_sheet';

export interface Room {
  /** The grid pane in CSS pixels. */
  w: number;
  h: number;
}

export interface Pulse {
  (cell: number): void;
}

export interface BookContext {
  room: Room;
  /** Sets a cell to 1 for one tick. */
  pulse: Pulse;
  /** Asks the page to recompile, after a sheet's links change a formula. */
  rebuild: (sheet: Sheet) => void;
  /** Eases the view to a cell size, centred on a cell, or back to 100% with no size given. */
  zoomTo: (cellPx?: number, r?: number, c?: number) => void;
}

interface Control {
  label: string;
  name: string;
  value?: number;
  formula?: string;
  places?: number;
  show?: (v: number) => string;
  /** Read-only figure, not a box to type in. */
  readout?: boolean;
  /** Show the label as typed: a working cell's own name, the word its formulas use. */
  named?: boolean;
}

class Pad {
  readonly cols: number;
  readonly rows: number;
  readonly wide: boolean;

  constructor(
    readonly sheet: Sheet,
    readonly unit: number,
    readonly room: Room,
  ) {
    this.cols = Math.min(244, Math.floor(room.w / unit));
    this.rows = Math.min(200, Math.floor(room.h / unit));
    this.wide = room.w >= 760;
    sheet.unit = unit;
  }

  span(px: number) {
    return Math.max(1, Math.ceil(px / this.unit));
  }

  text(r: number, c: number, wPx: number, hPx: number, text: string, style: Partial<Merge> = {}) {
    const merge: Merge = {
      r1: r,
      c1: c,
      r2: r + this.span(hPx) - 1,
      c2: c + this.span(wPx) - 1,
      size: 13,
      weight: 400,
      family: 'label',
      align: 'left',
      color: INK,
      ...style,
    };
    this.sheet.merge(merge);
    this.sheet.setText(index(r, c), text);
    return merge;
  }

  /** A printed label over a box: the sheet's inputs, each one a named cell. */
  control(r: number, c: number, w: number, control: Control) {
    const { sheet } = this;
    if (control.named) this.text(r, c, w, 14, control.label, { size: 11.5, family: 'typed', color: GREEN });
    else this.text(r, c, w, 14, control.label.toUpperCase(), { size: 9.5, weight: 600, color: GREEN });
    const at = r + this.span(15);
    const cell = index(at, c);
    sheet.merge({
      r1: at,
      c1: c,
      r2: at + this.span(24) - 1,
      c2: c + this.span(w) - 1,
      size: 15,
      weight: 400,
      family: 'typed',
      align: 'right',
      color: control.readout ? GREEN : INK,
      box: !control.readout,
      readout: control.readout,
      places: control.places,
      show: control.show,
    });
    sheet.name(control.name, cell);
    if (control.formula) sheet.setFormula(cell, makeFormula(control.formula, at, c));
    else sheet.setNumber(cell, control.value ?? 0);
    return cell;
  }

  /** Lays out a sheet's heading and returns the first free row under it. */
  head(title: string, note: string, controls: Control[], links: { label: string; act: () => void }[] = []) {
    const { unit, cols, wide } = this;
    const width = cols * unit;
    const controlW = wide ? 84 : Math.floor((width - 24) / 3) - 6;
    let bottom: number;
    if (wide) {
      const row = Math.round(8 / unit);
      this.text(0, 1, 300, 56, title, { size: 31, weight: 800, align: 'left' });
      const noteC = this.span(320);
      const noteW = Math.max(280, Math.min(560, width - 330 - controls.length * (controlW + 8) - 24));
      this.text(0, noteC, noteW, 64, note, { size: 13, wrap: true, weight: 400, inset: 8 });
      let c = cols - 1 - this.span((controlW + 8) * controls.length + 8);
      for (const k of controls) {
        this.control(row, c, controlW, k);
        c += this.span(controlW + 8);
      }
      bottom = this.span(72);
    } else {
      this.text(1, 1, width, 28, title, { size: 22, weight: 800 });
      const lines = Math.ceil((note.length * 6.3) / (width - 16));
      const top = 1 + this.span(30);
      this.text(top, 1, width - 16, 17 * lines, note, { size: 12, wrap: true });
      let y = top + this.span(17 * lines + 8);
      let i = 0;
      for (const k of controls) {
        this.control(y, this.span(8) + i * this.span(controlW + 6), controlW, k);
        i++;
        if (i === 3) {
          i = 0;
          y += this.span(46);
        }
      }
      bottom = y + (i ? this.span(46) : 0);
    }
    if (links.length) {
      const y = bottom;
      let c = this.span(8);
      let row = y;
      for (const link of links) {
        const w = link.label.length * 8 + 16;
        if ((c + this.span(w)) * unit > width) {
          c = this.span(8);
          row += this.span(23);
        }
        this.text(row, c, w, 20, link.label, { size: 12.5, weight: 600, color: BLUE, action: link.act });
        c += this.span(w + 4);
      }
      bottom = row + this.span(26);
    }
    this.sheet.band = bottom;
    return bottom + 1;
  }
}

const decide = (w: number, wideUnit: number, narrowUnit: number) => (w >= 760 ? wideUnit : narrowUnit);

function block(sheet: Sheet, area: Area, palette: Uint32Array, min: number, max: number, extra: Partial<Block> = {}) {
  const b: Block = { ...area, palette, min, max, places: 2, ...extra };
  sheet.blocks.push(b);
  for (let r = area.r1; r <= area.r2; r++) {
    for (let c = area.c1; c <= area.c2; c++) sheet.loose.delete(index(r, c));
  }
  return b;
}

function fire(ctx: BookContext) {
  const sheet = new Sheet('Fire');
  const unit = decide(ctx.room.w, Math.max(8, Math.ceil(ctx.room.w / 200)), 5);
  const pad = new Pad(sheet, unit, ctx.room);
  let middle = 0;
  const top = pad.head(
    'Fire',
    'Every cell below holds the same formula, and no script draws the flames. Click a cell to read it, drag through the sheet to set it alight, or rewrite the formula and press Enter. Everything else on this pad works the same way.',
    [
      { label: 'Cooling', name: 'cooling', value: Math.round(3300 / (pad.rows - 12)) / 1000, places: 3 },
      { label: 'Fuel', name: 'fuel', value: 1, places: 2 },
      { label: 'Ticks a second', name: 'rate', value: 40 },
    ],
    [
      {
        label: 'Zoom in to the figures',
        act: () => ctx.zoomTo(46, middle, Math.round(pad.cols / 2)),
      },
    ],
  );
  const area: Area = { r1: top, c1: 0, r2: Math.max(top + 20, pad.rows - 2), c2: pad.cols - 1 };
  middle = Math.round((area.r1 + area.r2 * 2) / 3);
  sheet.lead = index(middle, Math.round(pad.cols / 2));
  // Heat rises: each cell averages last tick's three cells below it and the one under those, less a random loss.
  sheet.fill(
    { ...area, r2: area.r2 - 1 },
    cellFormula(area.r1, '=MAX(0,AVERAGE(PREV(A#1:C#1),PREV(B#2))-cooling*RAND())'),
    1,
  );
  // The grate along the bottom: patches of heat that drift, so tongues form above them.
  sheet.fill(
    { ...area, r1: area.r2 },
    '=fuel*MAX(0,0.5+0.7*SIN(COLUMN()/3.1+TIME()*6.1)*SIN(COLUMN()/7.3-TIME()*3.7)+0.45*SIN(COLUMN()/19+TIME()*1.3)+RAND()/3)',
  );
  block(sheet, area, BURN, 0, 1, { poke: { value: 1, radius: 3 } });
  sheet.frame = { r1: 0, c1: 0, r2: area.r2, c2: pad.cols - 1 };
  return sheet;
}

/** Writes row numbers into formula text: # is the home row (1-based) plus the digit after it. Columns stay A..C. */
function cellFormula(row: number, text: string) {
  return text.replace(/#([0-9])/g, (_, d) => String(row + 1 + Number(d)));
}

const COORDS = 'x,(COLUMN()-midx)/size,y,(ROW()-midy)/size,t,TIME()*speed';

const WAVES: { label: string; formula: string; palette: Uint32Array }[] = [
  {
    label: 'Two stones',
    formula: `=LET(${COORDS},a,SQRT((x-0.5)^2+y^2),b,SQRT((x+0.5)^2+y^2),(SIN(a*26-t*3)+SIN(b*26-t*3))/4+0.5)`,
    palette: INKWASH,
  },
  {
    label: 'Tunnel',
    formula: `=LET(${COORDS},r,SQRT(x*x+y*y),a,ATAN2(y,x),MOD(INT(a*6/PI())+INT(1.6/r+t*2),2)*MIN(1,r*1.5))`,
    palette: CHECKER,
  },
  {
    label: 'Plasma',
    formula: `=LET(${COORDS},(SIN(x*5+t)+SIN(y*4-t*1.3)+SIN((x+y)*3+t*0.7)+SIN(SQRT(x*x+y*y)*8-t*2)+4)/8)`,
    palette: RISO,
  },
  {
    label: 'Turntable',
    formula: `=LET(${COORDS},c,COS(t/3),s,SIN(t/3),z,3+SIN(t/2)*1.5,MOD(INT((x*c-y*s)*z+99)+INT((x*s+y*c)*z+99),2))`,
    palette: CHECKER,
  },
  {
    label: 'Spiral',
    formula: `=LET(${COORDS},r,SQRT(x*x+y*y),a,ATAN2(y,x),(SIN(a*3+LN(r+0.01)*7-t*2)+1)/2)`,
    palette: BANDS,
  },
  {
    label: 'Blobs',
    formula: `=LET(${COORDS},a,(x-SIN(t*0.7))^2+(y-COS(t*0.9)*0.6)^2,b,(x+SIN(t*0.5)*0.8)^2+(y-SIN(t*1.1)*0.5)^2,c,(x-COS(t*1.3)*0.5)^2+(y+COS(t*0.6)*0.7)^2,MIN(1,(0.06/a+0.06/b+0.06/c)/2.4))`,
    palette: BANDS,
  },
];

function waves(ctx: BookContext) {
  const sheet = new Sheet('Waves');
  const unit = decide(ctx.room.w, Math.max(7, Math.ceil(ctx.room.w / 220)), 4);
  const pad = new Pad(sheet, unit, ctx.room);
  const areaRef: { b: Block | null; area: Area | null } = { b: null, area: null };
  const pick = (w: (typeof WAVES)[number]) => () => {
    const { b, area } = areaRef;
    if (!b || !area) return;
    b.palette = w.palette;
    sheet.fillWith(area, makeFormula(w.formula, area.r1, area.c1));
    ctx.rebuild(sheet);
  };
  const top = pad.head(
    'Waves',
    'One formula, filled across the whole block. Each cell knows only its own row and column and the time, and the picture comes out of that. Try a recipe, then change a number in the formula and press Enter.',
    [
      { label: 'Speed', name: 'speed', value: 1, places: 2 },
      { label: 'Ticks a second', name: 'rate', value: 60 },
    ],
    WAVES.map((w) => ({ label: w.label, act: pick(w) })),
  );
  const area: Area = { r1: top, c1: 0, r2: Math.max(top + 20, pad.rows - 2), c2: pad.cols - 1 };
  const midRow = (area.r1 + area.r2) / 2 + 1;
  const midCol = (area.c1 + area.c2) / 2 + 1;
  const size = Math.min(area.r2 - area.r1, area.c2 - area.c1) / 2;
  // Three plain constants off to the side, so the recipes read in sheet coordinates.
  const side = pad.cols + 4;
  sheet.setText(index(1, side), 'midx');
  sheet.setText(index(2, side), 'midy');
  sheet.setText(index(3, side), 'size');
  sheet.setNumber(index(1, side + 6), midCol);
  sheet.setNumber(index(2, side + 6), midRow);
  sheet.setNumber(index(3, side + 6), size);
  sheet.name('midx', index(1, side + 6));
  sheet.name('midy', index(2, side + 6));
  sheet.name('size', index(3, side + 6));
  sheet.fill(area, WAVES[0].formula);
  areaRef.area = area;
  areaRef.b = block(sheet, area, WAVES[0].palette, 0, 1);
  sheet.frame = { r1: 0, c1: 0, r2: area.r2, c2: pad.cols - 1 };
  return sheet;
}

function life(ctx: BookContext) {
  const sheet = new Sheet('Life');
  const unit = decide(ctx.room.w, Math.max(9, Math.ceil(ctx.room.w / 190)), 6);
  const pad = new Pad(sheet, unit, ctx.room);
  let scatter = -1;
  let clear = -1;
  const top = pad.head(
    'Life',
    "Conway's Game of Life. Each cell counts its living neighbours from the tick before, so every cell on the board sits in one enormous circular reference. Drag to draw living cells.",
    [{ label: 'Ticks a second', name: 'rate', value: 14 }],
    [
      { label: 'Scatter', act: () => ctx.pulse(scatter) },
      { label: 'Clear', act: () => ctx.pulse(clear) },
    ],
  );
  const side = pad.cols + 4;
  scatter = index(1, side);
  clear = index(2, side);
  sheet.setNumber(scatter, 0);
  sheet.setNumber(clear, 0);
  sheet.name('scatter', scatter);
  sheet.name('clear', clear);
  const area: Area = { r1: top, c1: 1, r2: Math.max(top + 20, pad.rows - 2), c2: pad.cols - 2 };
  // Written for the cell at B(row): its neighbourhood is the 3 x 3 around it. Dead cells fade instead of vanishing.
  const r = area.r1 + 1;
  sheet.fill(
    area,
    `=IF(scatter,RAND()<0.2,IF(clear,0,LET(a,B${r}>=1,n,COUNTIF(A${r - 1}:C${r + 1},">=1")-a,IF(OR(n=3,AND(a,n=2)),1,B${r}*0.84))))`,
  );
  block(sheet, area, LIFE, 0, 1, { poke: { value: 1, radius: 1 } });
  sheet.frame = { r1: 0, c1: 0, r2: area.r2 + 1, c2: pad.cols - 1 };
  sheet.opening = [scatter];
  return sheet;
}

/** A table of named working cells: `width` is the columns each one gets. */
function registers(pad: Pad, r: number, c: number, items: Control[], perRow: number, width: number) {
  const px = width * pad.unit - 6;
  items.forEach((item, i) => {
    const row = r + Math.floor(i / perRow) * pad.span(46);
    pad.control(row, c + (i % perRow) * width, px, { ...item, label: item.name, named: true, readout: true });
  });
}

function snake(ctx: BookContext) {
  const sheet = new Sheet('Snake');
  const unit = decide(
    ctx.room.w,
    Math.max(14, Math.min(26, Math.floor(Math.min((ctx.room.w - 340) / 40, (ctx.room.h - 110) / 27)))),
    14,
  );
  const pad = new Pad(sheet, unit, ctx.room);
  sheet.pad = true;
  const top = pad.head(
    'Snake',
    'It plays itself until you press an arrow key. The whole game is the cells you can see: the board is one formula, and the head, the food, the score, and the rules are the small boxes beside it. Try changing one while it runs.',
    [
      { label: 'Ticks per move', name: 'speed', value: 7 },
      {
        label: 'Score',
        name: 'score',
        formula: '=IF(reset,0,score+eat)',
        readout: true,
      },
      { label: 'Best', name: 'best', formula: '=MAX(best,IF(auto,0,score))', readout: true },
    ],
  );
  const wide = pad.wide;
  const boardCols = wide ? Math.min(44, pad.cols - pad.span(300)) : pad.cols - 2;
  const boardRows = Math.max(12, Math.min(pad.rows - top - 2, wide ? 34 : boardCols + 1));
  const area: Area = { r1: top, c1: 1, r2: top + boardRows - 1, c2: boardCols };
  sheet.name('board', area);
  const c0 = area.c1;
  const r0 = area.r1;
  const here = `LET(x,COLUMN()-${c0},y,ROW()-${r0}`;
  const self = `B${r0 + 1}`;
  // The board's first cell is at column B, so `self` in the fill walks with each cell.
  sheet.fill(
    area,
    `=IF(reset,0,${here},IF(AND(x=headx,y=heady,alive),len,IF(AND(x=foodx,y=foody),-1,IF(AND(step,alive),MAX(0,${self}-1),${self})))))`,
  );
  block(sheet, area, SNAKE, -1, 14, { places: 0, frame: true });

  const rc = wide ? area.c2 + 2 : 1;
  const rr = wide ? top : area.r2 + 2;
  const perRow = wide ? 3 : 4;
  const available = pad.cols - rc - 1;
  const status = pad.text(rr, rc, available * unit, pad.span(30) * unit, '', {
    size: 15,
    weight: 700,
    family: 'label',
    color: RED,
  });
  status.show = (v) => (v >= 2 ? 'Autopilot. Press an arrow key.' : v >= 1 ? '' : 'Hit. Press Space to go again.');
  sheet.texts.delete(index(rr, rc));
  sheet.setFormula(index(rr, rc), makeFormula('=alive+auto*2', rr, rc));
  registers(
    pad,
    rr + pad.span(30),
    rc,
    [
      { label: 'Keys across', name: 'keyx', formula: '=KEY("right")+KEY("d")-KEY("left")-KEY("a")' },
      { label: 'Keys down', name: 'keyy', formula: '=KEY("down")+KEY("s")-KEY("up")-KEY("w")' },
      { label: 'Autopilot', name: 'auto', formula: '=IF(ABS(keyx)+ABS(keyy)>0,0,auto)' },
      { label: 'Step', name: 'step', formula: '=MOD(TICK(),speed)=0' },
      {
        label: 'Heading across',
        name: 'dirx',
        formula:
          '=IF(reset,IF(keyy<>0,0,IF(keyx<>0,keyx,1)),IF(auto,IF(foodx<>headx,SIGN(foodx-headx),0),IF(AND(keyx<>0,keyx<>-lastx),keyx,IF(AND(keyy<>0,keyy<>-lasty),0,dirx))))',
      },
      {
        label: 'Heading down',
        name: 'diry',
        formula:
          '=IF(reset,keyy,IF(auto,IF(foodx<>headx,0,SIGN(foody-heady)),IF(AND(keyy<>0,keyy<>-lasty),keyy,IF(AND(keyx<>0,keyx<>-lastx),0,diry))))',
      },
      { label: 'Last across', name: 'lastx', formula: '=IF(OR(step,reset),dirx,lastx)' },
      { label: 'Last down', name: 'lasty', formula: '=IF(OR(step,reset),diry,lasty)' },
      { label: 'Next across', name: 'nextx', formula: '=headx+dirx' },
      { label: 'Next down', name: 'nexty', formula: '=heady+diry' },
      {
        label: 'Hit',
        name: 'hit',
        formula: `=AND(NOT(auto),OR(nextx<1,nextx>${boardCols},nexty<1,nexty>${boardRows},INDEX(board,nexty,nextx)>1))`,
      },
      { label: 'Eat', name: 'eat', formula: '=AND(step,alive,NOT(hit),nextx=foodx,nexty=foody)' },
      {
        label: 'Head across',
        name: 'headx',
        formula: '=IF(reset,INT(BW/2),IF(AND(step,alive,NOT(hit)),nextx,headx))'.replace('BW', String(boardCols)),
      },
      {
        label: 'Head down',
        name: 'heady',
        formula: '=IF(reset,INT(BH/2),IF(AND(step,alive,NOT(hit)),nexty,heady))'.replace('BH', String(boardRows)),
      },
      { label: 'Length', name: 'len', formula: '=IF(reset,5,MIN(IF(auto,26,9999),len+eat*3))' },
      { label: 'Food across', name: 'foodx', formula: `=IF(OR(eat,reset),1+INT(RAND()*${boardCols}),foodx)` },
      { label: 'Food down', name: 'foody', formula: `=IF(OR(eat,reset),1+INT(RAND()*${boardRows}),foody)` },
      { label: 'Alive', name: 'alive', formula: '=IF(reset,1,IF(AND(step,hit),0,alive))' },
      { label: 'Reset', name: 'reset', formula: '=OR(AND(PREV(auto)=1,auto=0),AND(KEY("space"),alive=0))' },
    ],
    perRow,
    Math.floor(available / perRow),
  );
  const set = (name: string, v: number) => {
    const a = sheet.names.get(name);
    if (a) {
      const cell = index(a.r1, a.c1);
      sheet.values[cell] = v;
      sheet.values[cell + 65536] = v;
    }
  };
  sheet.begin = () => {
    set('auto', 1);
    set('alive', 1);
    // The loop goes round through next, so that must hold the start as well.
    set('headx', Math.floor(boardCols / 2));
    set('heady', Math.floor(boardRows / 2));
    set('nextx', Math.floor(boardCols / 2) + 1);
    set('nexty', Math.floor(boardRows / 2));
    set('len', 5);
    set('dirx', 1);
    set('foodx', Math.floor(boardCols / 4));
    set('foody', Math.floor(boardRows / 3));
  };
  sheet.frame = { r1: 0, c1: 0, r2: Math.min(area.r2 + 1, pad.rows - 1), c2: pad.cols - 1 };
  return sheet;
}

const MAP = [
  '333333333333333333333333',
  '3......1......2.......3',
  '3......1......2.......3',
  '3..11..1..11..2..222..3',
  '3..1......1...2....2..3',
  '3..1......1........2..3',
  '3..1111...1...1112222.3',
  '3.........1...........3',
  '3.........1...........3',
  '3222..22222....33333..3',
  '3..............3...3..3',
  '3..............3......3',
  '3....1111......3...3..3',
  '3....1..1...2223...3..3',
  '3....1..1......33333..3',
  '3....1.........3......3',
  '3..............3......3',
  '3...222...1....3..22223',
  '3...2.....1.......2...3',
  '3...2.....1.......2...3',
  '3...2.....11111.......3',
  '3...2.................3',
  '3.....................3',
  '333333333333333333333333',
].map((row) => row.padEnd(24, '3'));

function maze(ctx: BookContext) {
  const sheet = new Sheet('Maze');
  const unit = decide(ctx.room.w, Math.max(7, Math.ceil(ctx.room.w / 210)), 5);
  const pad = new Pad(sheet, unit, ctx.room);
  sheet.pad = true;
  const top = pad.head(
    'Maze',
    'A first-person view with no 3D code behind it. Scroll down to read the rays, one column of cells each. Paint walls on the plan and they stand up in front of you. Arrow keys or WASD to walk; it wanders by itself until you do.',
    [
      { label: 'Field of view', name: 'fov', value: 1.15, places: 2 },
      { label: 'Pace', name: 'pace', value: 0.045, places: 3 },
      { label: 'Turn', name: 'turnrate', value: 0.04, places: 3 },
    ],
  );
  const wide = pad.wide;
  const planSize = 24;
  const planC = 1;
  const screenC = wide ? planC + planSize + 3 : 0;
  const sw = Math.min(170, pad.cols - screenC - (wide ? 1 : 0));
  const sh = wide ? Math.min(pad.rows - top - 2, Math.round(sw * 0.56)) : Math.round(sw * 0.74);
  const screen: Area = { r1: top, c1: screenC, r2: top + sh - 1, c2: screenC + sw - 1 };
  const planR = wide ? top : screen.r2 + 2;
  const plan: Area = { r1: planR, c1: planC, r2: planR + planSize - 1, c2: planC + planSize - 1 };

  // Workings below everything on screen.
  const below = Math.max(screen.r2, plan.r2) + 3;
  const labelled = (r: number, text: string) =>
    pad.text(r, 1, Math.min(pad.cols * unit - 16, 620), 18, text, { size: 13, weight: 700, color: GREEN });

  // The map proper: constants, 1 to 3 for a wall's colour.
  const mapR = below + pad.span(22);
  labelled(below, 'Map: the plan reads this. Type 0 to 3 here, or paint the plan.');
  const map: Area = { r1: mapR, c1: 1, r2: mapR + planSize - 1, c2: planSize };
  sheet.name('map', map);
  const start = () => {
    MAP.forEach((row, r) => {
      [...row].forEach((ch, c) => sheet.setNumber(index(map.r1 + r, map.c1 + c), ch === '.' ? 0 : Number(ch)));
    });
  };
  start();
  block(sheet, map, PLAN, 0, 4, { places: 0, poke: { value: 1, radius: 0, erase: 0 } });

  // Registers: where you are and which way you face.
  const regR = map.r2 + 3 + pad.span(22);
  labelled(regR - pad.span(22), 'You');
  const regs: Control[] = [
    { label: 'Turn keys', name: 'turnkey', formula: '=KEY("right")+KEY("d")-KEY("left")-KEY("a")' },
    { label: 'Walk keys', name: 'walkkey', formula: '=KEY("up")+KEY("w")-KEY("down")-KEY("s")' },
    { label: 'Autopilot', name: 'auto', formula: '=IF(ABS(turnkey)+ABS(walkkey)>0,0,auto)' },
    {
      label: 'Turning',
      name: 'turning',
      formula: '=IF(auto,IF(ahead<1.3,turnrate,SIN(TIME()/2.7)*0.006),turnkey*turnrate)',
    },
    { label: 'Walking', name: 'walking', formula: '=IF(auto,IF(ahead>0.8,0.5,0),walkkey)' },
    { label: 'Facing', name: 'pa', formula: '=pa+turning' },
    { label: 'Next across', name: 'nx', formula: '=px+COS(pa)*walking*pace' },
    { label: 'Next down', name: 'ny', formula: '=py+SIN(pa)*walking*pace' },
    {
      label: 'Across',
      name: 'px',
      formula: '=IF(INDEX(map,INT(py)+1,INT(nx+SIGN(nx-px)*0.22)+1)=0,nx,px)',
    },
    {
      label: 'Down',
      name: 'py',
      formula: '=IF(INDEX(map,INT(ny+SIGN(ny-py)*0.22)+1,INT(px)+1)=0,ny,py)',
    },
    { label: 'Wall ahead', name: 'ahead', formula: '=0' },
  ];
  const regPerRow = wide ? 8 : 4;
  registers(pad, regR, 1, regs, regPerRow, wide ? pad.span(100) : Math.floor((pad.cols - 2) / 4));
  const regRows = Math.ceil(regs.length / regPerRow) * pad.span(46);

  // The ray table: one column per column of the screen, marched down the sheet.
  const STEPS = 22;
  const rayR = regR + regRows + 3 + pad.span(22);
  labelled(
    rayR - pad.span(22),
    'Rays: one column of cells for each column of the view. Top to bottom: angle, direction, the march, then what it hit.',
  );
  const angle = rayR;
  const dirX = rayR + 1;
  const dirY = rayR + 2;
  const first = rayR + 3;
  const last = first + STEPS;
  const hitX = last + 1;
  const hitY = last + 2;
  const wall = last + 3;
  const across = last + 4;
  const tall = last + 5;
  const shadeRow = last + 6;
  const rowArea = (r: number, r2 = r): Area => ({ r1: r, c1: screenC, r2, c2: screenC + sw - 1 });
  const a1 = (r: number) => `B$${r + 1}`;
  // Each formula here is written as if it sat in column B, and fill shifts it across to the first ray column.
  const fillRow = (r: number, text: string, r2 = r) => {
    const fx = makeFormula(text, r, 1);
    sheet.fillWith(rowArea(r, r2), fx);
    return fx;
  };
  fillRow(angle, `=pa+ATAN((COLUMN()-${screenC}-${sw / 2})/${sw / 2}*TAN(fov/2))`);
  fillRow(dirX, `=COS(${a1(angle)})`);
  fillRow(dirY, `=SIN(${a1(angle)})`);
  fillRow(first, '=0.001');
  const dx = a1(dirX);
  const dy = a1(dirY);
  fillRow(
    first + 1,
    `=LET(d,B${first + 1},x,px+d*${dx},y,py+d*${dy},IF(INDEX(map,INT(y)+1,INT(x)+1)>0,d,d+0.001+MIN(IF(${dx}>0,INT(x)+1-x,x-INT(x))/(ABS(${dx})+0.000001),IF(${dy}>0,INT(y)+1-y,y-INT(y))/(ABS(${dy})+0.000001))))`,
    last,
  );
  fillRow(hitX, `=px+B$${last + 1}*${dx}`);
  fillRow(hitY, `=py+B$${last + 1}*${dy}`);
  fillRow(wall, `=INDEX(map,INT(${a1(hitY)})+1,INT(${a1(hitX)})+1)`);
  fillRow(
    across,
    `=LET(u,${a1(hitX)}-INT(${a1(hitX)}),v,${a1(hitY)}-INT(${a1(hitY)}),IF(ABS(u-0.5)>ABS(v-0.5),v,u+1))`,
  );
  fillRow(tall, `=${sh}*1.05/(B$${last + 1}*COS(${a1(angle)}-pa)+0.01)`);
  fillRow(shadeRow, `=0.04+MIN(0.85,(B$${last + 1}-0.5)/14)*0.85+IF(${a1(across)}>=1,0.07,0)`);
  const mid = Math.floor(sw / 2);
  const aheadCell = sheet.names.get('ahead');
  if (aheadCell) {
    sheet.setFormula(
      index(aheadCell.r1, aheadCell.c1),
      makeFormula(`=PREV(${cellOf(last, screenC + mid)})`, aheadCell.r1, aheadCell.c1),
    );
  }
  // Every row of the table is a colour scale of its own, so the workings can be seen at any zoom.
  block(sheet, rowArea(angle), HEAT, -3.2, 9.5, { places: 2 });
  block(sheet, rowArea(dirX), INKWASH, -1, 1, { places: 2 });
  block(sheet, rowArea(dirY), INKWASH, -1, 1, { places: 2 });
  block(sheet, rowArea(first, last), HEAT, 0, 13, { places: 1 });
  block(sheet, rowArea(hitX), INKWASH, 0, 24, { places: 1 });
  block(sheet, rowArea(hitY), INKWASH, 0, 24, { places: 1 });
  block(sheet, rowArea(wall), PLAN, 0, 4, { places: 0 });
  block(sheet, rowArea(across), INKWASH, 0, 2, { places: 2 });
  block(sheet, rowArea(tall), HEAT, 0, sh * 1.2, { places: 0 });
  block(sheet, rowArea(shadeRow), INKWASH, 0, 1, { places: 2 });

  // The view. Walls by height, floor by casting each row back to the ground.
  const midRow = top + (sh - 1) / 2 + 1;
  sheet.fill(
    screen,
    `=LET(y,ROW()-${midRow},t,${a1(tall)},IF(ABS(y)<t/2,LET(v,y/t+0.5,w,${a1(wall)},s,${a1(shadeRow)},u,${a1(across)},c,INT(v*6),n,MOD(INT(u*3+MOD(c,2)/2)+c,2)*0.09*MIN(1,t/${sh * 0.4}),w-1+MAX(0,MIN(0.98,s+n))),IF(y>0,LET(g,${sh}*1.05/(2*y+0.5),k,g/COS(${a1(angle)}-pa),fx,px+k*${dx},fy,py+k*${dy},3+MIN(0.999,0.25+g/7+0.45*MOD(INT(fx)+INT(fy),2))),3.999)))`,
    1,
  );
  block(sheet, screen, MAZE, 0, 4, { places: 2, frame: true });

  // The plan, drawn from the map with you marked on it. Painting here writes to the map.
  const marker = `LET(x,COLUMN()-${plan.c1},y,ROW()-${plan.r1},IF(AND(x=INT(px)+1,y=INT(py)+1),4,INDEX(map,y,x)))`;
  sheet.fill(plan, `=${marker}`);
  block(sheet, plan, PLAN, 0, 4, {
    places: 0,
    poke: { value: 1, radius: 0, erase: 0, write: (r, c) => index(r - plan.r1 + map.r1, c - plan.c1 + map.c1) },
  });

  sheet.begin = () => {
    const set = (name: string, v: number) => {
      const a = sheet.names.get(name);
      if (a) {
        const cell = index(a.r1, a.c1);
        sheet.values[cell] = v;
        sheet.values[cell + 65536] = v;
      }
    };
    // The loop goes round through Next, so those must hold the start as well.
    set('px', 2.5);
    set('py', 2.5);
    set('nx', 2.5);
    set('ny', 2.5);
    set('pa', 0.5);
    set('auto', 1);
    set('ahead', 3);
  };
  sheet.lead = index(screen.r1 + Math.floor(sh / 2), screen.c1 + Math.floor(sw / 2));
  sheet.frame = { r1: 0, c1: 0, r2: Math.max(screen.r2, plan.r2) + 1, c2: pad.cols - 1 };
  return sheet;
}

const cellOf = (row: number, col: number) => `$${columnName(col)}$${row + 1}`;

function accounts(ctx: BookContext) {
  const sheet = new Sheet('Interest');
  const unit = decide(ctx.room.w, 10, 6);
  const pad = new Pad(sheet, unit, ctx.room);
  const top = pad.head(
    'Interest',
    'Where this started. Interest is charged on the average of the opening and closing balance, and the closing balance depends on the interest, so the sheet goes round in a circle. Most spreadsheets stop you here. Change a figure and watch this one settle.',
    [
      { label: 'Opening balance', name: 'open', value: 240000 },
      { label: 'Rate a year', name: 'yearly', value: 0.075, places: 3 },
      { label: 'Repayment', name: 'repay', value: 15000 },
      { label: 'Ticks a second', name: 'rate', value: 6 },
    ],
  );
  const columns = ['Quarter', 'Opening', 'Interest', 'Repaid', 'Closing'];
  const avail = pad.cols * unit - 24;
  const colW = Math.min(150, Math.floor(avail / columns.length) - 4);
  const rowH = pad.span(26);
  const colAt = (i: number) => 1 + i * pad.span(colW + 4);
  columns.forEach((name, i) => {
    pad.text(top + 1, colAt(i), colW, 18, name.toUpperCase(), {
      size: 10,
      weight: 700,
      color: GREEN,
      align: i ? 'right' : 'left',
    });
  });
  const firstRow = top + 1 + pad.span(20);
  const quarters = 8;
  for (let q = 0; q < quarters; q++) {
    const r = firstRow + q * rowH;
    const put = (i: number, formula: string | null, places: number, text?: string) => {
      const c = colAt(i);
      sheet.merge({
        r1: r,
        c1: c,
        r2: r + pad.span(22) - 1,
        c2: c + pad.span(colW) - 1,
        size: pad.wide ? 15 : 11,
        weight: 400,
        family: 'typed',
        align: i ? 'right' : 'left',
        color: INK,
        places,
      });
      if (formula) sheet.setFormula(index(r, c), makeFormula(formula, r, c));
      else if (text) sheet.setText(index(r, c), text);
    };
    const name = (i: number, k: number) => cellOf(firstRow + k * rowH, colAt(i));
    put(0, null, 0, `Y${Math.floor(q / 4) + 1} Q${(q % 4) + 1}`);
    put(1, q ? `=${name(4, q - 1)}` : '=open', 0);
    put(2, `=(${name(1, q)}+${name(4, q)})/2*yearly/4`, 2);
    put(3, '=repay', 0);
    put(4, `=${name(1, q)}+${name(2, q)}-${name(3, q)}`, 2);
  }
  sheet.lead = index(firstRow, colAt(2));
  const totalR = firstRow + quarters * rowH + 1;
  pad.text(totalR, colAt(0), colW, 22, 'Total', { size: 13, weight: 700 });
  const totalC = colAt(2);
  sheet.merge({
    r1: totalR,
    c1: totalC,
    r2: totalR + pad.span(22) - 1,
    c2: totalC + pad.span(colW) - 1,
    size: pad.wide ? 15 : 11,
    weight: 700,
    family: 'typed',
    align: 'right',
    color: RED,
    places: 2,
  });
  sheet.setFormula(
    index(totalR, totalC),
    makeFormula(
      `=SUM(${Array.from({ length: quarters }, (_, q) => cellOf(firstRow + q * rowH, colAt(2))).join(',')})`,
      totalR,
      totalC,
    ),
  );
  sheet.frame = { r1: 0, c1: 0, r2: Math.min(totalR + 4, pad.rows), c2: pad.cols - 1 };
  return sheet;
}

export const BOOK: ((ctx: BookContext) => Sheet)[] = [fire, waves, life, snake, maze, accounts];
