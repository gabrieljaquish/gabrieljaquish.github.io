"""Assemble the compact browser JSON.
usage: python3 -I assemble.py geom.gpkg iso_raw.gpkg enc.gpkg depth25_rect.tif out.json
Coordinates in the JSON: integer metres, origin = NW corner of the frame, x east, y DOWN (canvas order).
  X = E + 6000, Y = 7200 - N  where (E, N) are metres in
  +proj=tmerc +lat_0=44.055 +lon_0=-73.435 +k=1 +x_0=0 +y_0=0 +datum=WGS84
"""
import sys, json, struct, math
from osgeo import ogr, gdal, osr
ogr.UseExceptions(); gdal.UseExceptions()
geom_p, iso_p, enc_p, grid_p, out_p = sys.argv[1:6]
extra_p = sys.argv[6] if len(sys.argv) > 6 else None   # optional own soundings (see build.sh)

FRAME_W, FRAME_H = 12000, 14400
OX, OY = 6000, 7200
SIMPLIFY_CONTOUR = 10.0
MIN_CONTOUR_LEN = 60.0
GRID_CELL = 100              # metres (4 x 4 of the 25 m grid)
MIN_WET_SUBCELLS = 3         # of 16
FT = 3.28084
LOCAL = '+proj=tmerc +lat_0=44.055 +lon_0=-73.435 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'

def X(x): return int(round(x + OX))
def Y(y): return int(round(OY - y))

def ring_flat(ring, closed=True):
    out = []; last = None
    n = ring.GetPointCount()
    for i in range(n - 1 if closed else n):
        p = (X(ring.GetX(i)), Y(ring.GetY(i)))
        if p != last: out += p; last = p
    if closed and len(out) >= 4 and out[:2] == out[-2:]: out = out[:-2]
    return out

def parts(g, want):
    """yield sub-geometries of type name containing `want` (POLYGON / LINESTRING)."""
    if g is None: return
    name = g.GetGeometryName()
    if name == want: yield g; return
    for i in range(g.GetGeometryCount()):
        yield from parts(g.GetGeometryRef(i), want)

geo = ogr.Open(geom_p)
def first_geom(name):
    lyr = geo.GetLayerByName(name); f = lyr.GetNextFeature()
    return f.GetGeometryRef().Clone() if f else None
water = first_geom('water'); land = first_geom('land')
rect = ogr.CreateGeometryFromWkt('POLYGON((-6000 -7200,6000 -7200,6000 7200,-6000 7200,-6000 -7200))')

# ---------- land polygons ----------
land_out = []
for poly in parts(land, 'POLYGON'):
    rings = [ring_flat(poly.GetGeometryRef(i)) for i in range(poly.GetGeometryCount())]
    rings = [r for r in rings if len(r) >= 6]
    if rings: land_out.append(rings)
islands_out = []
for f in geo.GetLayerByName('islands'):
    g = f.GetGeometryRef()
    for poly in parts(g, 'POLYGON'):
        islands_out.append({'ring': ring_flat(poly.GetGeometryRef(0)), 'areaM2': round(poly.GetArea())})

# ---------- contours ----------
iso_ds = ogr.Open(iso_p); iso = iso_ds.GetLayer(0)
by_ft = {}
for f in iso:
    ft = int(round(f.GetField('ft')))
    g = f.GetGeometryRef().Clone(); g.FlattenTo2D()
    g = g.SimplifyPreserveTopology(SIMPLIFY_CONTOUR).Intersection(water)
    for ln in parts(g, 'LINESTRING'):
        if ln.Length() < MIN_CONTOUR_LEN: continue
        flat = ring_flat(ln, closed=False)
        if len(flat) >= 4: by_ft.setdefault(ft, []).append(flat)
contours = [{'depth': k, 'lines': by_ft[k]} for k in sorted(by_ft)]

# ---------- ENC features ----------
enc = ogr.Open(enc_p)
def enc_feats(name):
    lyr = enc.GetLayerByName(name)
    if lyr is None: return []
    out = []
    for f in lyr:
        g = f.GetGeometryRef()
        if g is None or not g.Intersects(rect): continue
        out.append(({k: f.GetField(k) for k in f.keys()}, g.Clone()))
    return out

def pt(g):
    """representative point (x, y) in LOCAL metres."""
    name = g.GetGeometryName()
    if 'POINT' in name:
        p = g.GetGeometryRef(0) if g.GetGeometryCount() else g
        return p.GetX(), p.GetY()
    g2 = g.Intersection(rect)
    c = g2.Centroid()
    if not c.Within(g2): c = g2.PointOnSurface()
    return c.GetX(), c.GetY()

def js(v):
    if v is None: return []
    if isinstance(v, list): return [str(x) for x in v]
    try: return [str(x) for x in json.loads(v)]
    except Exception: return [str(v)]

# soundings: chart feet, ordered by farthest-point sampling so soundings[:n] is an even subset
snd = []
for a, g in enc_feats('SOUNDG'):
    for i in range(max(1, g.GetGeometryCount())):
        p = g.GetGeometryRef(i) if g.GetGeometryCount() else g
        x, y = p.GetX(), p.GetY()
        if -6000 <= x <= 6000 and -7200 <= y <= 7200:
            snd.append((X(x), Y(y), int(round(a['DEPTH'] * FT))))
own_n = 0
if extra_p:
    # Own soundings: one median value per 150 m cell, so the chart shows them at chart density.
    bins = {}
    eds = ogr.Open(extra_p)   # keep a reference: the layer is invalid once its datasource is freed
    for f in eds.GetLayerByName('extra'):
        g = f.GetGeometryRef(); x, y = g.GetX(), g.GetY()
        if -6000 <= x <= 6000 and -7200 <= y <= 7200:
            bins.setdefault((int(x // 150), int(y // 150)), []).append((x, y, float(f.GetField('depth_ft'))))
    for cell in bins.values():
        cell.sort(key=lambda c: c[2]); x, y, d = cell[len(cell) // 2]
        # An own sounding replaces ENC soundings within 75 m of it.
        snd = [s_ for s_ in snd if (s_[0] - X(x)) ** 2 + (s_[1] - Y(y)) ** 2 >= 75 ** 2]
        snd.append((X(x), Y(y), int(round(d)))); own_n += 1
snd = sorted(set(snd))
order = []
if snd:
    cx, cy = FRAME_W / 2, FRAME_H / 2
    start = min(range(len(snd)), key=lambda i: (snd[i][0]-cx)**2 + (snd[i][1]-cy)**2)
    order = [start]; dmin = [ (s[0]-snd[start][0])**2 + (s[1]-snd[start][1])**2 for s in snd ]
    used = [False]*len(snd); used[start] = True
    for _ in range(len(snd) - 1):
        j = max((i for i in range(len(snd)) if not used[i]), key=lambda i: dmin[i])
        used[j] = True; order.append(j)
        for i in range(len(snd)):
            d = (snd[i][0]-snd[j][0])**2 + (snd[i][1]-snd[j][1])**2
            if d < dmin[i]: dmin[i] = d
soundings = [list(snd[i]) for i in order]

COL = {'1': 'white', '2': 'black', '3': 'red', '4': 'green', '6': 'yellow'}
LITCHR = {1: 'F', 2: 'Fl', 3: 'LFl', 4: 'Q', 7: 'Iso', 8: 'Oc'}
lights = []
for a, g in enc_feats('LIGHTS'):
    x, y = pt(g)
    c = ''.join(COL.get(k, '?')[0].upper() for k in js(a.get('COLOUR')))
    ch = LITCHR.get(a.get('LITCHR'), '?') + ' ' + c
    if a.get('SIGPER'): ch += ' %gs' % a['SIGPER']
    if a.get('HEIGHT'): ch += ' %dft' % round(a['HEIGHT'] * FT)
    lights.append((x, y, ch))
def light_at(x, y):
    for lx, ly, ch in lights:
        if (lx-x)**2 + (ly-y)**2 < 15**2: return ch
    return None

features = []
seen = {}
for a, g in enc_feats('BOYLAT'):
    x, y = pt(g); key = (round(x), round(y))
    cat = {1: 'port', 2: 'starboard'}.get(a.get('CATLAM'))
    shape = {1: 'conical', 2: 'can', 3: 'spherical', 4: 'pillar', 5: 'spar'}.get(a.get('BOYSHP'), 'other')
    rec = {'type': 'buoy', 'x': X(x), 'y': Y(y), 'name': a.get('OBJNAM'), 'side': cat,
           'color': '/'.join(COL.get(k, k) for k in js(a.get('COLOUR'))), 'shape': shape}
    lt = light_at(x, y)
    if lt: rec['light'] = lt
    # seasonal lighted/unlighted pairs share a position: keep one, prefer the lighted name
    k2 = next((k for k in seen if (k[0]-key[0])**2 + (k[1]-key[1])**2 < 15**2), None)
    if k2 is None: seen[key] = rec
    elif 'Lighted' in (rec['name'] or ''): seen[k2] = rec
features += list(seen.values())
for a, g in enc_feats('BCNLAT'):
    x, y = pt(g)
    rec = {'type': 'beacon', 'x': X(x), 'y': Y(y), 'name': a.get('OBJNAM'),
           'side': {1: 'port', 2: 'starboard'}.get(a.get('CATLAM')),
           'color': '/'.join(COL.get(k, k) for k in js(a.get('COLOUR')))}
    lt = light_at(x, y)
    if lt: rec['light'] = lt
    features.append(rec)
for a, g in enc_feats('BRIDGE'):
    g2 = g.Intersection(rect)
    ring = None
    for poly in parts(g2.SimplifyPreserveTopology(3), 'POLYGON'):
        ring = ring_flat(poly.GetGeometryRef(0)); break
    x, y = pt(g)
    rec = {'type': 'bridge', 'x': X(x), 'y': Y(y), 'ring': ring, 'areaM2': round(g2.GetArea())}
    if a.get('VERCLR'):
        rec['name'] = 'Lake Champlain Bridge'      # ENC OBJNAM is null; named per Coast Pilot 6 ch.14
        rec['clearance'] = {'verticalFt': round(a['VERCLR'] * FT), 'horizontalFt': round(a['HORCLR'] * FT) if a.get('HORCLR') else None,
                            'note': a.get('INFORM')}
    features.append(rec)
CATOBS = {1: 'snag', 2: 'wellhead', 3: 'diffuser', 4: 'crib', 5: 'fish haven', 6: 'foul area', 7: 'foul ground'}
for a, g in enc_feats('OBSTRN'):
    x, y = pt(g)
    rec = {'type': 'obstruction', 'x': X(x), 'y': Y(y), 'kind': CATOBS.get(a.get('CATOBS'), 'obstruction')}
    if a.get('VALSOU') is not None: rec['depthFt'] = round(a['VALSOU'] * FT)
    if 'POLYGON' in g.GetGeometryName():
        for poly in parts(g.Intersection(rect), 'POLYGON'):
            rec['ring'] = ring_flat(poly.GetGeometryRef(0)); break
    features.append(rec)
for a, g in enc_feats('UWTROC'):
    x, y = pt(g)
    features.append({'type': 'rock', 'x': X(x), 'y': Y(y),
                     'watlev': {3: 'submerged', 4: 'covers and uncovers', 5: 'awash'}.get(a.get('WATLEV'))})
for a, g in enc_feats('WRECKS'):
    x, y = pt(g); features.append({'type': 'wreck', 'x': X(x), 'y': Y(y)})
CATLMK = {9: 'monument', 17: 'tower', 20: 'spire', 3: 'chimney', 7: 'mast'}
for a, g in enc_feats('LNDMRK'):
    x, y = pt(g)
    kinds = [CATLMK.get(int(k), k) for k in js(a.get('CATLMK'))]
    features.append({'type': 'landmark', 'x': X(x), 'y': Y(y), 'kind': '/'.join(kinds), 'name': a.get('OBJNAM')})

# labels (deduplicated by name, largest instance wins)
labels = {}
for layer, kind in (('SEAARE', 'water'), ('LNDRGN', 'land'), ('BUAARE', 'town'), ('FORSTC', 'fort'), ('HRBFAC', 'harbour')):
    for a, g in enc_feats(layer):
        nm = a.get('OBJNAM')
        if not nm: continue
        size = g.Intersection(rect).GetArea() if 'POLYGON' in g.GetGeometryName() else 0
        x, y = pt(g)
        if nm not in labels or size > labels[nm]['_size']:
            labels[nm] = {'type': 'label', 'kind': kind, 'name': nm, 'x': X(x), 'y': Y(y), '_size': size}
for v in labels.values(): v.pop('_size')
features += sorted(labels.values(), key=lambda v: (v['kind'], v['name']))

magvar = None
for a, g in enc_feats('MAGVAR'):
    magvar = {'deg': a.get('VALMAG'), 'year': int(a.get('RYRMGV')), 'annualChangeMin': a.get('VALACM')}

# ---------- 100 m depth grid (feet), land = -1 ----------
ds = gdal.Open(grid_p); b = ds.GetRasterBand(1)
W, H = ds.RasterXSize, ds.RasterYSize
z = struct.unpack('%df' % (W*H), b.ReadRaster(buf_type=gdal.GDT_Float32))
ND = b.GetNoDataValue()
k = GRID_CELL // 25
gw, gh = W // k, H // k
cells = []
for r in range(gh):
    for c in range(gw):
        vals = [z[(r*k+i)*W + c*k+j] for i in range(k) for j in range(k)]
        wet = [v for v in vals if v != ND]
        cells.append(max(1, int(round(sum(wet)/len(wet)))) if len(wet) >= MIN_WET_SUBCELLS else -1)

# frame corners in WGS84 for reference
src = osr.SpatialReference(); src.ImportFromProj4(LOCAL)
dst = osr.SpatialReference(); dst.ImportFromEPSG(4326); dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
ct = osr.CoordinateTransformation(src, dst)
corners = {n: [round(v, 5) for v in ct.TransformPoint(x, y)[:2]] for n, (x, y) in
           {'nw': (-6000, 7200), 'ne': (6000, 7200), 'sw': (-6000, -7200), 'se': (6000, -7200)}.items()}

out = {
    'name': 'Lake Champlain - Port Henry, Bulwagga Bay, Crown Point',
    'bbox': {'lonMin': -73.51, 'latMin': 43.99, 'lonMax': -73.36, 'latMax': 44.12, 'cornersLonLat': corners},
    'projection': {'proj4': LOCAL, 'units': 'm',
                   'toFrame': 'x = E + 6000, y = 7200 - N (origin NW corner, y down)',
                   'width': FRAME_W, 'height': FRAME_H, 'northUp': True,
                   'frameNote': 'land ring segments lying on x=0, x=width, y=0 or y=height are the frame, not shoreline; skip them when stroking the coast'},
    'land': land_out,
    'islands': islands_out,
    'contours': contours,
    'soundings': soundings,
    'depthGrid': {'w': gw, 'h': gh, 'cell': GRID_CELL, 'units': 'ft', 'land': -1,
                  'order': 'row-major from NW corner; cell (i,j) centre = (j*cell+cell/2, i*cell+cell/2)',
                  'cells': cells},
    'features': features,
    'datum': {'depths': 'feet below Low Lake Level (chart datum), which is 93.0 ft above mean sea level (US Coast Pilot 6, ch. 14)',
              'datumOffsetFt': 3,
              'note': 'true water depth = chart depth + (lake stage ft NGVD29 - 93.0). Default 3 ft = long-term annual-mean stage '
                      '(USGS 04294500 Lake Champlain at Burlington, param 62614: 96.1 ft 1940-2022, 96.5 ft 1991-2022) minus 93.0.'},
    'magvar': magvar,
    'units': {'soundings': 'ft', 'contours': 'ft', 'grid': 'ft'},
    'sources': [
        {'name': 'NOAA ENC US4NY1LS ed.5 and US4NY1MS ed.3 (both issued 2026-04-20), compiled from chart 14784', 'url': 'https://www.charts.noaa.gov/ENCs/ENCs.shtml',
         'use': 'soundings, 0/6/12 ft contours (grid constraints), buoys, lights, bridge, obstructions, names, islet', 'license': 'US Government work / CC0-1.0'},
        {'name': 'USGS National Hydrography Dataset High Resolution (Waterbody 7113802 Lake Champlain; NHDArea StreamRiver)',
         'url': 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer', 'use': 'shoreline, land/water', 'license': 'US public domain'}],
    'attribution': 'Chart data: NOAA Office of Coast Survey (charts.noaa.gov) \u00b7 Shoreline: U.S. Geological Survey, National Hydrography Dataset \u00b7 Contours interpolated \u00b7 Not for navigation',
}
if own_n:
    out['sources'].append({'name': 'Soundings by Gabriel Jaquish', 'use': '%d soundings (binned), depth grid and contours' % own_n, 'license': 'by permission'})
    out['attribution'] = out['attribution'].replace(' \u00b7 Contours interpolated', ' \u00b7 Additional soundings: Gabriel Jaquish \u00b7 Contours interpolated')
s = json.dumps(out, separators=(',', ':'), ensure_ascii=False)
open(out_p, 'w').write(s)
nverts = lambda polys: sum(len(r)//2 for p in polys for r in p)
print('JSON %d bytes | land polys %d (%d verts) | contours %s | soundings %d | grid %dx%d (%d wet) | features %d' % (
    len(s.encode()), len(land_out), nverts(land_out),
    {c['depth']: (len(c['lines']), sum(len(l)//2 for l in c['lines'])) for c in contours},
    len(soundings), gw, gh, sum(1 for v in cells if v >= 0), len(features)))
for key in ('land', 'contours', 'soundings', 'depthGrid', 'features'):
    print('  %-10s %7d bytes' % (key, len(json.dumps(out[key], separators=(',', ':')).encode())))
