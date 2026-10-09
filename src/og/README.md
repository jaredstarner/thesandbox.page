# Social image

`public/og.png` is the site's one social image (Open Graph and Twitter cards): the wordmark inside a staked survey plot on a contour map, in the Survey's paper, ink, red, brown, and blue.

| File | What it is |
| :--- | :--- |
| `template.html` | The source: one self-contained page, 1200x630. The contours are drawn by a seeded script, so every render matches. Overpass and Overpass Mono load from Google Fonts at render time only |
| `public/og.png` | The render. Commit it; nothing builds it |

To change it, edit `template.html`, render it at 1200x630 in a headless browser after its fonts load, and save the result over `public/og.png`. Keep text that can go stale (dates, counts, plot numbers) out of the image.

The tags that point at it sit in `src/layouts/Bare.astro` and `src/layouts/Base.astro`, as plain elements beside the icon links.
