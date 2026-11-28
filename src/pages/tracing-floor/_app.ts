import { COMMISSIONS } from './_commissions';
import { Floor, fitView } from './_floor';
import { constructionPoints } from './_geom';

export function start(): void {
  const root = document.querySelector<HTMLElement>('.tracing');
  const canvas = root?.querySelector<HTMLCanvasElement>('.floor');
  if (!root || !canvas) return;
  const floor = new Floor(canvas);
  const c = COMMISSIONS[0];
  const draw = (): void => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    floor.resize(w, h);
    floor.ensurePlaster(1);
    const view = fitView(c.view, w, h, { l: 380, r: 30, t: 30, b: 100 });
    floor.draw({
      view,
      drawn: c.prims.map((prim) => ({ prim, age: 0, given: true })),
      points: constructionPoints(c.points, c.prims, c.bounds),
      marks: c.points,
      pricks: [],
      guides: c.targets.flatMap((t) => t.pieces),
      cut: c.stone,
      chiselled: [],
      hover: null,
      snap: null,
      preview: null,
      hint: null,
      hintPoints: [],
      fade: 0,
    });
  };
  draw();
  window.addEventListener('resize', draw);
}
