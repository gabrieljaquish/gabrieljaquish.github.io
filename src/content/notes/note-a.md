---
title: Sources
backedBy: [chart-sources]
draft: false
confirm: []
---

The lake chart behind this site shows Lake Champlain from Port Henry and Bulwagga Bay to Crown Point.

Soundings, buoys, lights, the bridge, obstructions, and place names come from NOAA's [electronic navigational charts](https://www.charts.noaa.gov/ENCs/ENCs.shtml) US4NY1LS and US4NY1MS. The shoreline comes from the [USGS National Hydrography Dataset](https://www.usgs.gov/national-hydrography). Both are U.S. public-domain data, and no other map data goes into the chart.

NOAA's soundings come from surveys made between 1870 and 1939. Depths are in feet below Low Lake Level, which NOAA's U.S. Coast Pilot 6 puts at 93.0 ft above mean sea level. The depth contours, and the 100 m depth grid the sounder reads, are interpolated from NOAA's soundings and its shallow-water contours. For the wave speed, the chart takes the lake to be 3 ft above Low Lake Level, about its long-term average at the USGS gauge at Burlington, Vermont.

A script in the [repository](https://github.com/gabrieljaquish/gabrieljaquish.github.io) (`tools/lake-chart`) builds the chart file from the NOAA and USGS downloads. Two runs from the same downloads produce byte-identical output.

Not for navigation.
