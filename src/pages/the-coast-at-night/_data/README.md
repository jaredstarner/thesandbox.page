# The coast at night: light data

`lights.tsv` is a snapshot of two public lists of lights, merged into one table, one light per row. The page's build reads it; nothing in this folder runs at build time or in the browser.

| Source                                                                                                     | What it covers                                                                                  | Read                                                                                                                           |
| :--------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| NGA Pub. 110 to 116, _List of Lights, Radio Aids and Fog Signals_ (2026 editions, data to 15 October 2026) | Every coast outside the continental United States: major lights and the outermost floating aids | 2026-10-19, from `https://msi.nga.mil/api/publications/ngalol/lights-buoys?volume=<110-116>&output=json&includeRemovals=false` |
| USCG _Light List_, Volumes I to VII (weekly editions, corrected to 16 October 2026)                        | The United States, its rivers, and the Great Lakes                                              | 2026-10-19, from the PDFs at `https://navcen.uscg.gov/weekly-light-lists`                                                      |

Both are works of the United States Government. The NGA title page reads "Copyright 2026 by the United States Government. No copyright claimed under Title 17 U.S.C."

## What the merge keeps

- Lit aids only. NGA's RACONs and RAMARKs (radar beacons, characters given in Morse) are dropped
- From USCG, every lit fixed aid, and only the lighted buoys that mark an approach, an entrance, a separation scheme, or safe water (`Mo (A)`), so the United States follows NGA's rule of listing major and outermost floating aids
- Where the lists overlap (east Florida, Puerto Rico, the Great Lakes, Hawaii), a NGA light within 150 m of a USCG light is dropped in favour of the USCG row
- NGA names that open with a dash stand for the principal name above them; the merge writes the name out
- Characteristics, ranges, and remarks are kept as printed. The page's build parses them (`../_rhythm.ts`, `../_sectors.ts`)

The columns are `src, ref, name, region, lat, lon, char, height, range, structure, remarks`, with height in metres and NGA's characteristic lines joined by `; `.

## Lakes

Natural Earth's land polygons (the coast, via world-atlas) don't cut out lakes, so the Great Lakes and every other lake would read as land. `lakes-50m.tsv` and `lakes-10m.tsv` are Natural Earth's lake layers (public domain, `nvkelso/natural-earth-vector` 5.2.0-pre, read 2026-10-19), one polygon per line: rings parted by `;`, points `lon,lat` to four decimals. The 1:10m file leaves out the smallest lakes (scale rank 9). Write them with `node lakes.mjs ne_50m_lakes.geojson lakes-50m.tsv` and `node lakes.mjs ne_10m_lakes.geojson lakes-10m.tsv 8`.

## Refreshing it

1. Save the seven NGA responses as `nga-110.json` to `nga-116.json` in one folder
2. Save the seven USCG weekly PDFs and read them with the extractor below (Python with PyMuPDF). The PDFs are tables with fixed column positions, read from each volume's header row, so the extractor assigns every word to a column by its x position rather than relying on text layout
3. `node merge.mjs <nga-folder> <uscg.json> lights.tsv`

```python
"""Extract lit aids from USCG Light List PDFs by word position.

usage: python -I uscg.py <out.json> <pdf> [<pdf> ...]
"""
import json
import re
import sys

import fitz

LAT = re.compile(r'^(\d{2})-(\d{2})-(\d{2}(?:\.\d+)?)([NS])$')
LON = re.compile(r'^(\d{3})-(\d{2})-(\d{2}(?:\.\d+)?)([EW])$')
LLNR = re.compile(r'^\d+(?:\.\d+)?$')
HEAD = ['LLNR', 'Name', 'Position', 'Characteristic', 'Height', 'Range', 'Structure', 'Remarks']


def dms(m):
    d, mi, s, h = m.groups()
    v = int(d) + int(mi) / 60 + float(s) / 3600
    return -v if h in 'SW' else v


def columns(doc):
    for page in doc:
        xs = {}
        for w in page.get_text('words'):
            if w[4] in HEAD and w[4] not in xs:
                xs[w[4]] = w[0]
        if len(xs) == len(HEAD):
            return [xs[h] for h in HEAD]
    raise SystemExit('no header row')


def extract(path):
    doc = fitz.open(path)
    cols = columns(doc)

    def col(x):
        i = 0
        for k, c in enumerate(cols):
            if x >= c - 2:
                i = k
        return i

    records = []
    cur = None
    for page in doc:
        # Skip the running title and the header row.
        words = [w for w in page.get_text('words') if w[1] > 20 and not (w[4] in HEAD and w[1] < 50)]
        words.sort(key=lambda w: (round(w[1], 0), w[0]))
        for w in words:
            c = col(w[0])
            if c == 0 and LLNR.match(w[4]):
                cur = {'llnr': w[4], 'cells': [[] for _ in HEAD]}
                records.append(cur)
            elif cur is not None:
                cur['cells'][c].append(w[4])
    out = []
    for r in records:
        cells = [' '.join(c).strip() for c in r['cells']]
        lat = next((dms(LAT.match(t)) for t in r['cells'][2] if LAT.match(t)), None)
        lon = next((dms(LON.match(t)) for t in r['cells'][2] if LON.match(t)), None)
        if lat is None or lon is None or not cells[3]:
            continue
        out.append({'n': r['llnr'], 'name': cells[1], 'lat': round(lat, 6), 'lon': round(lon, 6),
                    'char': cells[3], 'height': cells[4], 'range': cells[5],
                    'structure': cells[6], 'remarks': cells[7]})
    return out


out = []
for p in sys.argv[2:]:
    vol = int(re.search(r'v(\d)', p.replace('\\', '/').split('/')[-1]).group(1))
    out += [dict(r, vol=vol) for r in extract(p)]
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False)
```
