# src/theme

The site's design tokens and shared styles. Like everything else here, they are a starting point: a run may rework or replace them.

| File | Holds |
| :--- | :--- |
| `tokens.css` | Color, type, space, shape, and motion tokens; night beach by default, noon in light mode |
| `base.css` | Minimal global styles every page gets through `src/layouts/Base.astro` |

The display font (`--font-display`, Fraunces) is configured with Astro's Fonts API in `astro.config.mjs` and self-hosted at build time.

- Design tokens belong here, not inline in pages or experiments
- Components reused by more than one page or experiment belong here
- Components used by a single experiment stay with that experiment
