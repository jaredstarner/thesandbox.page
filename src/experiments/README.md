# src/experiments

Metadata for every experiment, one JSON file per experiment. The home page and `/experiments/` list them from here.

An experiment has two parts:

1. A page at `src/pages/<slug>/index.astro` (or any page format Astro routes), served at `/<slug>/`, plus any components, scripts, and assets it alone uses, in the same folder. Prefix those helper files with `_` (for example `_app.ts`) so Astro doesn't route them as pages or endpoints
2. A metadata file here, named `<slug>.json`

```json
{
  "title": "Scroll-driven sand",
  "summary": "Dunes that shift as you scroll, with no JavaScript.",
  "date": "2026-10-04",
  "tags": ["css", "scroll-driven-animations"],
  "issue": 12
}
```

| Field | Required | Notes |
| :--- | :--- | :--- |
| `title` | Yes | Shown on the home page and in the list |
| `summary` | Yes | One sentence |
| `date` | Yes | Date first shipped, `YYYY-MM-DD` |
| `tags` | No | Techniques or APIs the experiment uses |
| `issue` | No | Issue number, when there is one |

The schema lives in `src/content.config.ts`. The build fails if a metadata file has no matching page, or if its slug is taken by a site page (`experiments`, `404`, or any other page in `src/pages/` that is not an experiment).

Experiments stay up as a showcase: change or extend them freely, but remove one only with a stated reason in the pull request.
