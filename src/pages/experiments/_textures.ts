// Build-time SVG tiles for the register, inlined as data URIs. No raster assets.

const uri = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}")`;

/**
 * Bottle-green buckram: two anisotropic noise fields, one for the warp and one
 * for the weft, multiplied into a weave and colored between the cloth's shade
 * and its lit thread.
 */
export const bookcloth = uri(`
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
  <filter id="w" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.9 0.02" numOctaves="2" seed="4" stitchTiles="stitch" result="warp"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.02 0.9" numOctaves="2" seed="9" stitchTiles="stitch" result="weft"/>
    <feBlend in="warp" in2="weft" mode="multiply" result="weave"/>
    <feColorMatrix in="weave" type="matrix" values="
      0.33 0 0 0 0
      0.33 0 0 0 0
      0.33 0 0 0 0
      0 0 0 0 1" result="lum"/>
    <feComponentTransfer in="lum">
      <feFuncR type="linear" slope="0.62" intercept="-0.01"/>
      <feFuncG type="linear" slope="1.05" intercept="0.035"/>
      <feFuncB type="linear" slope="0.74" intercept="0.01"/>
    </feComponentTransfer>
  </filter>
  <rect width="240" height="240" filter="url(#w)"/>
</svg>`);

/** The leaf in flat light: a faint fiber noise, barely above the paper color. */
export const leafFiber = uri(`
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">
  <filter id="f" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.5 0.32" numOctaves="3" seed="21" stitchTiles="stitch"/>
    <feColorMatrix type="matrix" values="
      0 0 0 0 0.30
      0 0 0 0 0.36
      0 0 0 0 0.42
      -0.32 0 0 0 0.19"/>
  </filter>
  <rect width="320" height="320" filter="url(#f)"/>
</svg>`);

/**
 * The leaf under a raking lamp: fiber relief plus laid and chain lines, lit by
 * a low distant light from the top. Mid gray is "no change", so the tile is
 * composited with hard-light: shadows darken, lit faces lift.
 */
export const leafRaked = uri(`
<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384">
  <defs>
    <pattern id="laid" width="384" height="4" patternUnits="userSpaceOnUse">
      <rect width="384" height="1.4" fill="#000"/>
    </pattern>
    <pattern id="chain" width="96" height="384" patternUnits="userSpaceOnUse">
      <rect x="47" width="2.4" height="384" fill="#000"/>
    </pattern>
    <filter id="r" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.09 0.16" numOctaves="4" seed="11" stitchTiles="stitch" result="fiber"/>
      <feColorMatrix in="fiber" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.4 0 0 0 -0.2" result="fiberA"/>
      <feComposite in="SourceAlpha" in2="fiberA" operator="arithmetic" k1="0" k2="0.55" k3="0.9" k4="0" result="height"/>
      <feDiffuseLighting in="height" surfaceScale="2.2" diffuseConstant="1.6" lighting-color="#ffffff" result="lit">
        <feDistantLight azimuth="270" elevation="18"/>
      </feDiffuseLighting>
      <feComponentTransfer in="lit">
        <feFuncA type="linear" slope="0" intercept="1"/>
      </feComponentTransfer>
    </filter>
  </defs>
  <g filter="url(#r)">
    <rect width="384" height="384" fill="url(#laid)" opacity="0.55"/>
    <rect width="384" height="384" fill="url(#chain)" opacity="0.8"/>
  </g>
</svg>`);

/** The TSP monogram in a ruled oval, drawn in strokes so it reads as a wire mark. */
export const monogramPaths = {
  oval: 'M 0 -78 A 58 78 0 1 1 0 78 A 58 78 0 1 1 0 -78 Z',
  ovalInner: 'M 0 -70 A 50 70 0 1 1 0 70 A 50 70 0 1 1 0 -70 Z',
  // T across the top, S through the middle, P down the right stem.
  t: 'M -30 -44 L 30 -44 M 0 -44 L 0 46',
  s: 'M 22 -18 C 14 -30 -26 -30 -24 -12 C -22 4 22 -2 22 18 C 22 36 -16 38 -26 26',
  p: 'M 12 46 L 12 -6 M 12 -6 L 26 -6 C 42 -6 42 18 26 18 L 12 18',
};

/** The watermark as a standalone SVG for the lamp's tile: pale wire lines on transparent. */
export const watermark = uri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-80 -100 160 200" width="160" height="200">
  <g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
    <path d="${monogramPaths.oval}" stroke-width="2.4"/>
    <path d="${monogramPaths.ovalInner}" stroke-width="1.2"/>
    <path d="${monogramPaths.t}" stroke-width="4"/>
    <path d="${monogramPaths.s}" stroke-width="3.4"/>
    <path d="${monogramPaths.p}" stroke-width="3.4"/>
  </g>
</svg>`);
