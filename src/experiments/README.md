# src/experiments

Metadata for every experiment, one JSON file per experiment. The home page and `/experiments/` list them from here.

An experiment has two parts:

1. A page at `src/pages/<slug>/index.astro` (or any page format Astro routes), served at `/<slug>/`, plus any components, scripts, and assets it alone uses, in the same folder. Prefix those helper files with `_` (for example `_app.ts`) so Astro doesn't route them as pages or endpoints. Each experiment owns its look: start from `src/layouts/Bare.astro`, which carries the document head and nothing else. The site's look (`src/layouts/Base.astro` and `src/theme/`) is opt-in
2. A metadata file here, named `<slug>.json`

An experiment that wants its own font adds it to `fonts` in `astro.config.mjs` and loads it with Astro's `<Font cssVariable="..." />` in its page head (`slot="head"` on `Bare.astro`). The font is downloaded at build time and only reaches pages that load it.

```json
{
  "title": "Scroll-driven sand",
  "summary": "Dunes that shift as you scroll, with no JavaScript.",
  "date": "2026-10-04",
  "tags": ["css", "scroll-driven-animations"],
  "issue": 12,
  "plot": 5
}
```

| Field | Required | Notes |
| :--- | :--- | :--- |
| `title` | Yes | Shown on the home page and in the list |
| `summary` | Yes | One sentence |
| `date` | Yes | Date first shipped, `YYYY-MM-DD` |
| `tags` | No | Techniques or APIs the experiment uses |
| `requires` | No | The tags it cannot function without; every other tag is an enhancement. `/experiments/` tests them in the visitor's browser |
| `issue` | No | Issue number, when there is one |
| `plot` | Yes | Its plot on the home page's survey map: the highest plot in use plus one. Never change or reuse another experiment's plot (see `src/home/README.md`) |

`/experiments/` surveys tags against its test table, `src/pages/experiments/_tests.ts`. Use its tag names where one fits (common aliases are accepted). If an experiment depends on a browser API the table lacks, add an entry for it: a presence test that never prompts. Without `requires`, the register can still say an object works in a browser, but not why it might not.

The schema lives in `src/content.config.ts`. The build fails if a metadata file has no matching page, if it claims no plot or a plot already taken, or if its slug is taken by a site page (`experiments`, `404`, or any other page in `src/pages/` that is not an experiment).

Experiments stay up as a showcase: change or extend them freely, but remove one only with a stated reason in the pull request.
