# src/experiments

Metadata for every experiment, one JSON file per experiment. The home page and `/experiments/` list them from here.

An experiment has two parts:

1. A page at `src/pages/experiments/<slug>/index.astro` (or any page format Astro routes), plus any components, scripts, and assets it alone uses, in the same folder
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

The schema lives in `src/content.config.ts`. The build fails if a metadata file has no matching page.

Experiments stay up as a showcase: change or extend them freely, but remove one only with a stated reason in the pull request.
