// Natural Earth's land at 1:110m (through world-atlas), decoded from TopoJSON and painted into an
// equirectangular mask for the globe's shader: rows from the north, west to east.

import topo from 'world-atlas/land-110m.json';

type Ring = [number, number][];

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: { land: { geometries: { type: string; arcs: number[][][] | number[][][][] }[] } };
}

function decode(t: Topology): Ring[] {
  const [sx, sy] = t.transform.scale;
  const [tx, ty] = t.transform.translate;
  const arcs = t.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty] as [number, number];
    });
  });
  const ring = (ids: number[]): Ring => {
    const out: Ring = [];
    for (const id of ids) {
      const a = id < 0 ? arcs[~id].slice().reverse() : arcs[id];
      out.push(...(out.length ? a.slice(1) : a));
    }
    return out;
  };
  const rings: Ring[] = [];
  for (const g of t.objects.land.geometries) {
    const polys = (g.type === 'Polygon' ? [g.arcs] : g.arcs) as number[][][];
    for (const poly of polys) for (const r of poly) rings.push(unwrap(ring(r)));
  }
  return rings;
}

/**
 * Some rings cross the antimeridian by stepping from 180° to -180° (Chukotka, Fiji, Antarctica).
 * Carry the longitude on past 180° instead, and close a ring that circles a pole along the pole.
 */
function unwrap(r: Ring): Ring {
  const out: Ring = [];
  let shift = 0;
  for (let i = 0; i < r.length; i++) {
    if (i > 0) {
      const d = r[i][0] - r[i - 1][0];
      if (d > 180) shift -= 360;
      if (d < -180) shift += 360;
    }
    out.push([r[i][0] + shift, r[i][1]]);
  }
  if (Math.abs(out[out.length - 1][0] - out[0][0]) > 180) {
    const pole = out.reduce((t, p) => t + p[1], 0) < 0 ? -90 : 90;
    out.push([out[out.length - 1][0], pole], [out[0][0], pole]);
  }
  return out;
}

/** A canvas with land white on black, `width` by `width / 2`, ready to upload as a texture. */
export function landMask(width = 2048): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = width / 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  const k = width / 360;
  // One path for every ring, filled even-odd, so a polygon's holes stay open water.
  const rings = decode(topo as unknown as Topology);
  for (const shift of [-360, 0, 360]) {
    ctx.beginPath();
    for (const r of rings) {
      r.forEach(([lon, lat], i) => {
        const x = (lon + shift + 180) * k;
        const y = (90 - lat) * k;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }
  // A slight blur turns the hard edge into a ramp, so the shader's threshold finds the coast
  // between texels instead of stepping along them.
  // Wrap a margin around first, so the blur runs across the antimeridian instead of fading there.
  const pad = 8;
  const wrapped = document.createElement('canvas');
  wrapped.width = canvas.width + pad * 2;
  wrapped.height = canvas.height;
  const wctx = wrapped.getContext('2d')!;
  for (const dx of [-canvas.width, 0, canvas.width]) wctx.drawImage(canvas, pad + dx, 0);
  const blurred = document.createElement('canvas');
  blurred.width = wrapped.width;
  blurred.height = wrapped.height;
  const bctx = blurred.getContext('2d')!;
  bctx.fillStyle = '#000';
  bctx.fillRect(0, 0, blurred.width, blurred.height);
  bctx.filter = 'blur(1.2px)';
  bctx.drawImage(wrapped, 0, 0);
  ctx.drawImage(blurred, -pad, 0);
  return canvas;
}
