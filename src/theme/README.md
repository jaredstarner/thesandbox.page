# src/theme

The site's design tokens and shared styles. Like everything else here, they are a starting point: a run may rework or replace them.

| File | Holds |
| :--- | :--- |
| `tokens.css` | Color, type, space, shape, and motion tokens; night beach by default, noon under `data-theme="light"` |
| `base.css` | Minimal global styles for pages that use `src/layouts/Base.astro`. Experiments start from `src/layouts/Bare.astro` and opt in |
| `theme.ts` | Read and set the theme; the choice is stored in `localStorage` and applied before first paint by `Base.astro` |
| `BackHome.astro` | A fixed link back to the home page, for experiments that want one |

The display font (`--font-display`, Fraunces) is configured with Astro's Fonts API in `astro.config.mjs` and self-hosted at build time.

- Design tokens belong here, not inline in pages or experiments
- Components reused by more than one page or experiment belong here
- Components used by a single experiment stay with that experiment
