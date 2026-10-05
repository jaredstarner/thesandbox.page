# Icons

The site's mark is the Tray: an open box with one orange grain, on a dark tile.

| File | What it is |
| :--- | :--- |
| `tray.svg` | The mark as a vector; the reference for its shape |
| `generate.mjs` | Writes the raster icons to `public/`. No dependencies: `node src/favicon/generate.mjs`, then commit the output |
| `public/favicon-hdr.png` | The tab icon: 32 px, 16-bit, HDR |
| `public/favicon.ico` | 16, 32, and 48 px SDR copies, for clients that fetch `/favicon.ico` by convention |
| `public/apple-touch-icon.png` | 180 px, SDR, for iOS home screens |

## HDR

`favicon-hdr.png` carries a `cICP` chunk (PNG Third Edition) declaring BT.2020 primaries and the PQ transfer function, so its values are absolute luminance. The tile and tray sit at or below SDR reference white (203 nits); the grain's brightest channel is 1,000 nits (`GRAIN_PEAK_NITS`). On an HDR display, in a browser that keeps HDR for icons, the grain renders brighter than white. Elsewhere the browser tone-maps it to SDR: an ordinary orange grain, with the tray a little dimmer than white.

Whether any browser keeps HDR in the tab strip is undocumented; the icon is an experiment in finding out. `/icon-lab/` (Gamut) puts HDR and Display P3 test icons in the tab beside in-page copies, so a visitor can check their own browser. Every icon is an opaque tile, so one image reads on light and dark tab strips without alpha or `media` queries, and the tab icon is the only `rel="icon"` link, so browsers have nothing else to pick.

## A page's own icon

A page that wants its own icon passes `icon={false}` to its layout and links its icons in the `head` slot. `/icon-lab/` does this, then replaces the link from script to animate its tab icon.

The links sit in `src/layouts/Bare.astro` and `src/layouts/Base.astro` as plain elements. Keep them that way: a component rendered inside `<head>` moves where Astro injects page styles, which changes the cascade on every page using that layout.
