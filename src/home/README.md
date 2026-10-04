# src/home

The home page: a survey map of the site. Every experiment claims a plot of land; the register at `/experiments/` is the survey office at the origin, and the next plot is staked out ahead of the next run.

| File | Role |
| :--- | :--- |
| `Survey.astro` | Markup and styles. Every plot is a real link in an ordered list; without script the list is the page |
| `survey.ts` | Camera and input: drag, wheel, pinch, keyboard, fly-to, the next stake and its countdown |
| `terrain.ts` | The land: one WebGL2 fragment shader draws contours, water, woodland, and section lines from seeded noise |
| `plots.ts` | Where a plot sits, from its number alone. Shared by the build and the browser |

## Plots

- An experiment's `plot` lives in its metadata (`src/experiments/<slug>.json`). A new experiment claims the highest plot in use plus one
- A plot's place depends only on its number, so claiming one never moves another. Never change or reuse another experiment's plot
- The build fails if an experiment has no plot or two share one, and the error names the next free plot

## Rules the page keeps

- Deterministic build: nothing random or time-based is rendered at build time. The terrain, the next stake, and the countdown are drawn in the browser, so the built HTML changes only when an experiment is added or edited
- Adding an experiment adds one list item and nothing else to the built HTML
- Without WebGL2 the map falls back to a CSS grid that pans and zooms the same way; without script the plots are a plain list; with reduced motion there is no reveal, coasting, or flight
