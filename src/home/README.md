# src/home

The home page: a survey map of the site. Every experiment claims a plot of land, and the next plot is staked out ahead of the next run. The register at `/experiments/` is the survey office, on a plot of its own out to the north-west, marked by a theodolite on its tripod. The page opens on the stake and draws the land outward from it.

| File | Role |
| :--- | :--- |
| `Survey.astro` | Markup and styles. Every plot is a real link in an ordered list; without script the list is the page |
| `survey.ts` | Camera and input: drag, wheel, pinch, keyboard, fly-to, deep links (`/#<slug>`), the next stake and its estimated countdown to about 09:00 ET |
| `terrain.ts` | The land: one WebGL2 fragment shader draws contours, water, woodland, and section lines from seeded noise |
| `plots.ts` | Where a plot sits, from its number alone, and where the office sits. Shared by the build and the browser |

## Plots

- An experiment's `plot` lives in its metadata (`src/experiments/<slug>.json`). A new experiment claims the highest plot in use plus one
- Plots are numbered in the order experiments arrived on the site. A plot's place depends only on its number (plot 1 at the origin, then a square spiral that steps over the office's block), so claiming one never moves another. Never change or reuse another experiment's plot
- Every label stays inside its plot: each plot is a CSS size container, and its number, title, date, and summary appear only as they fit. Very far out a plot shows its bare number
- The build fails if an experiment has no plot or two share one, and the error names the next free plot

## Rules the page keeps

- Deterministic build: nothing random or time-based is rendered at build time. The terrain, the next stake, and the countdown are drawn in the browser, so the built HTML changes only when an experiment is added or edited
- Adding an experiment adds one list item and nothing else to the built HTML
- Without WebGL2 the map falls back to a CSS grid that pans and zooms the same way; without script the plots are a plain list; with reduced motion there is no reveal, coasting, or flight
