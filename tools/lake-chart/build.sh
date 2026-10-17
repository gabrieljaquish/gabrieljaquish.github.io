#!/bin/bash
# Build the Port Henry / Crown Point "Soundings" chart JSON for the browser.
# usage: bash build.sh <workdir> <scriptsdir>
#   Optional: EXTRA_SOUNDINGS=/path/own.csv with columns lon,lat,depth_ft (WGS84; feet below Low
#   Lake Level, 93.0 ft). Only depths are published; any other columns (times, tracks) are dropped.
# Downloads land in <workdir>/dl_enc and <workdir>/dl_nhd (data only, never executed).
set -euo pipefail
W=$1; S=$2
T=$W/work; O=$W/out
mkdir -p "$T" "$O"

# Local projection: transverse Mercator centred on the bbox -> north-up metres, ~0 distortion.
LOCAL="+proj=tmerc +lat_0=44.055 +lon_0=-73.435 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
# Geographic window pulled from every source (wider than the output so the TIN has no edge ticks)
WIN="-73.56 43.95 -73.31 44.16"

# ---------- 1. downloads ----------
if [ ! -f "$W/dl_enc/MS/ENC_ROOT/US4NY1MS/US4NY1MS.000" ]; then
  mkdir -p "$W/dl_enc"
  for c in US4NY1LS US4NY1MS; do
    curl -sS -L --fail -o "$W/dl_enc/$c.zip" "https://www.charts.noaa.gov/ENCs/$c.zip"
    unzip -o -q "$W/dl_enc/$c.zip" -d "$W/dl_enc/${c: -2}"
  done
fi
if [ ! -f "$W/dl_nhd/nhd_area.geojson" ]; then
  mkdir -p "$W/dl_nhd"
  # NHD HR Waterbody (large scale) 'Lake Champlain' - fetch by objectId (bbox queries on layer 12 time out)
  curl -sS --fail -o "$W/dl_nhd/nhd_lake.geojson" "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12/query?objectIds=7113802&outFields=OBJECTID,GNIS_NAME,GNIS_ID,FTYPE,FDATE,RESOLUTION,AREASQKM&returnGeometry=true&outSR=4326&geometryPrecision=7&f=geojson"
  # NHDArea (large scale): StreamRiver polygons = creek mouths (Hospital Creek, Dead Creek ...)
  curl -sS --fail -o "$W/dl_nhd/nhd_area.geojson" "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/9/query?geometry=-73.56,43.95,-73.31,44.16&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=OBJECTID,GNIS_NAME,FTYPE,FCODE,FDATE&returnGeometry=true&outSR=4326&geometryPrecision=7&f=geojson"
fi

# ---------- 2. ENC S-57 -> GPKG in LOCAL metres ----------
export OGR_S57_OPTIONS="SPLIT_MULTIPOINT=ON,ADD_SOUNDG_DEPTH=ON,UPDATES=APPLY,RECODE_BY_DSSI=ON,LNAM_REFS=ON"
ENC=$T/enc.gpkg; rm -f "$ENC"
for c in LS MS; do
  for L in SOUNDG DEPCNT DEPARE LNDARE M_COVR CTNARE BOYLAT LIGHTS BCNLAT BRIDGE OBSTRN UWTROC WRECKS LNDMRK SEAARE LNDRGN BUAARE FORSTC HRBFAC MAGVAR; do
    ogr2ogr -f GPKG -update -addfields "$ENC" "$W/dl_enc/$c/ENC_ROOT/US4NY1$c/US4NY1$c.000" "$L" \
      -spat $WIN -t_srs "$LOCAL" -nln "$L" -nlt PROMOTE_TO_MULTI 2>/dev/null || echo "  (no $L in $c)"
  done
done

# ---------- 3. NHD -> GPKG in LOCAL metres ----------
NHD=$T/nhd.gpkg; rm -f "$NHD"
ogr2ogr -f GPKG "$NHD" "$W/dl_nhd/nhd_lake.geojson" -clipsrc $WIN -t_srs "$LOCAL" -nln lake -nlt MULTIPOLYGON
ogr2ogr -f GPKG -update "$NHD" "$W/dl_nhd/nhd_area.geojson" -where "FTYPE=460" -t_srs "$LOCAL" -nln area -nlt MULTIPOLYGON

# ---------- 4. water / land / islands / depth constraint points (python, GEOS via osgeo.ogr) ----------
#   water_raw = NHD lake U NHD StreamRiver areas  minus ENC islets (LNDARE < 0.1 km2)
#   water     = SimplifyPreserveTopology(water_raw, 5 m) clipped to the output rect
#   land      = rect - water          (same simplified geometry => no slivers)
#   pts       = ENC soundings + ENC DEPCNT (0/6/12 ft) vertices + DEPARE DRVAL2=0 rings (0 ft)
#               + NHD shoreline (0 ft), all segmentized at 25 m, dropped if outside water_raw
EXTRA=()
if [ -n "${EXTRA_SOUNDINGS:-}" ]; then
  rm -f "$T/extra.gpkg"
  ogr2ogr -f GPKG "$T/extra.gpkg" "$EXTRA_SOUNDINGS" -oo X_POSSIBLE_NAMES=lon -oo Y_POSSIBLE_NAMES=lat \
    -oo AUTODETECT_TYPE=YES -s_srs EPSG:4326 -t_srs "$LOCAL" -nln extra -select depth_ft -nlt POINT
  EXTRA=("$T/extra.gpkg")
fi
python3 -I "$S/prep.py" "$ENC" "$NHD" "$T/geom.gpkg" "$T/pts.gpkg" ${EXTRA[@]+"${EXTRA[@]}"}

# ---------- 5. depth grid: TIN at 25 m on a window 1 km wider than the rect ----------
gdal_grid -q -a linear:radius=0:nodata=-9999 -zfield ft -l p \
  -txe -7000 7000 -tye -8200 8200 -tr 25 25 -ot Float32 -a_srs "$LOCAL" "$T/pts.gpkg" "$T/tin25.tif"
gdal_rasterize -q -burn 1 -init 0 -ot Byte -te -7000 -8200 7000 8200 -tr 25 25 -at -l water_raw "$T/geom.gpkg" "$T/mask25.tif"
# masked smoothing (3 box passes, radius 2 cells ~ sigma 60 m) blended in only below 12-24 ft; land -> nodata
python3 -I "$S/smooth.py" "$T/tin25.tif" "$T/mask25.tif" "$T/depth25.tif" 2 12 24
gdal_translate -q -projwin -6000 7200 6000 -7200 "$T/depth25.tif" "$T/depth25_rect.tif"

# ---------- 6. isobaths (feet) from the single smoothed grid ----------
rm -f "$T/iso_raw.gpkg"
gdal_contour -q -a ft -fl 6 12 18 30 60 90 -f GPKG -nln iso "$T/depth25_rect.tif" "$T/iso_raw.gpkg"

# ---------- 7. assemble browser JSON (simplify contours 10 m, clip to water, 100 m grid, features) ----------
python3 -I "$S/assemble.py" "$T/geom.gpkg" "$T/iso_raw.gpkg" "$ENC" "$T/depth25_rect.tif" "$O/porthenry-soundings.json" ${EXTRA[@]+"${EXTRA[@]}"}
ls -l "$O/porthenry-soundings.json"

# ---------- 8. QA: render the JSON itself and check drift / crossings / grid narrows ----------
python3 -I "$S/qa.py" "$O/porthenry-soundings.json" "$ENC" "$T/depth25_rect.tif"
python3 -I "$S/render.py" "$O/porthenry-soundings.json" "$O/render_10m.png" 10 200
