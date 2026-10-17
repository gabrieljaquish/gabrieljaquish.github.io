# Lake chart data

Builds `public/charts/port-henry.json`, the real chart behind the "Lake chart" background:
Lake Champlain from Port Henry and Bulwagga Bay to Crown Point and the Lake Champlain Bridge.

The output is committed, so the site build never downloads anything. Rebuild only when the
source data changes (NOAA issues new chart editions every few months) or to add soundings.

## Sources

Both are U.S. federal data in the public domain.

| Data | Source |
|---|---|
| Soundings, 0/6/12 ft contours, buoys, lights, bridge, obstructions, names | NOAA ENC cells US4NY1LS and US4NY1MS ([charts.noaa.gov](https://www.charts.noaa.gov/ENCs/ENCs.shtml)), CC0-1.0 |
| Shoreline and land/water | USGS National Hydrography Dataset, High Resolution (Lake Champlain waterbody 7113802, NHDArea creek mouths) |

The deeper isobaths (18, 30, 60, 90 ft) and the 100 m depth grid are interpolated from those
soundings, which come from surveys made between 1870 and 1939. Depths are in feet below Low Lake
Level (93.0 ft above mean sea level, US Coast Pilot 6, ch. 14). **Not for navigation.**

The site footer carries the required credit with a link to NOAA's chart page. Don't use the NOAA
emblem or the "NOAA ENC" mark; both are trademarks.

Not used, and why:

- **VCGI Lake Champlain bathymetry points (LKCHDEM):** a re-digitization of the same NOAA chart (394
  of the 400 matched soundings agree to the foot; the rest are typos), with no open license.
- **OpenStreetMap:** ODbL share-alike terms. NHD is public domain and matches it.
- **LCBP multibeam survey:** not released for distribution.

## Rebuild

Needs the GDAL command-line tools and Python bindings (`brew install gdal`) and Pillow for the QA
render (`render.py` only). Takes about 20 s.

```bash
bash tools/lake-chart/build.sh /tmp/lake-chart tools/lake-chart
cp /tmp/lake-chart/out/porthenry-soundings.json public/charts/port-henry.json
```

Check `/tmp/lake-chart/out/render_10m.png` and the QA output (contour drift, crossings, soundings
on land) before committing. Two runs from the same downloads produce byte-identical JSON.

### Adding your own soundings

Put them in a CSV with columns `lon,lat,depth_ft` (WGS84, feet below Low Lake Level; subtract the
lake stage above 93.0 ft from what the sounder read) and run:

```bash
EXTRA_SOUNDINGS=/path/to/soundings.csv bash tools/lake-chart/build.sh /tmp/lake-chart tools/lake-chart
```

Own soundings are averaged into 10 m cells, take precedence over NOAA soundings within 30 m, and
are thinned to one per 150 m for display. Only positions and depths are published: other columns
(timestamps, speed, track IDs) are dropped when the CSV is read.

## Output format

Integer metres in a 12,000 × 14,400 m frame, origin at the NW corner, x east, y south (local
transverse Mercator centred on 44.055°N, 73.435°W). Keys: `land`, `islands`, `contours`
(`{depth, lines}` in feet), `soundings` (`[x, y, ft]`, ordered so any prefix is an even subset),
`depthGrid` (100 m cells, feet, land = -1), `features`, `datum`, `magvar`, `sources`, `attribution`.
