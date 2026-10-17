"""QA of the browser JSON against the ENC.
usage: python3 -I qa.py chart.json enc.gpkg depth25_rect.tif
"""
import sys, json, struct, statistics as st
from osgeo import ogr, gdal
ogr.UseExceptions(); gdal.UseExceptions()
d = json.load(open(sys.argv[1])); enc = ogr.Open(sys.argv[2]); g25 = gdal.Open(sys.argv[3])
FT = 3.28084
X = lambda x: x + 6000; Y = lambda y: 7200 - y
def pct(v, p): v = sorted(v); return v[min(len(v)-1, int(p/100*len(v)))]

# rebuild derived contour lines (frame coords) as OGR multilinestrings per depth
derived = {}
for c in d['contours']:
    m = ogr.Geometry(ogr.wkbMultiLineString)
    for ln in c['lines']:
        l = ogr.Geometry(ogr.wkbLineString)
        for i in range(0, len(ln), 2): l.AddPoint_2D(ln[i], ln[i+1])
        m.AddGeometry(l)
    derived[c['depth']] = m
land = ogr.Geometry(ogr.wkbMultiPolygon)
for poly in d['land']:
    p = ogr.Geometry(ogr.wkbPolygon)
    for ring in poly:
        r = ogr.Geometry(ogr.wkbLinearRing)
        for i in range(0, len(ring), 2): r.AddPoint_2D(ring[i], ring[i+1])
        r.AddPoint_2D(ring[0], ring[1]); p.AddGeometry(r)
    land.AddGeometry(p)
land = land.Buffer(0)

# 1) drift of derived 6/12 ft isobaths from ENC DEPCNT 1.8/3.6 m
for valdco, ft in ((1.8, 6), (3.6, 12)):
    ds = []
    lyr = enc.GetLayerByName('DEPCNT'); lyr.SetAttributeFilter('VALDCO = %s' % valdco)
    for f in lyr:
        g = f.GetGeometryRef().Clone(); g.Segmentize(50)
        stack = [g]
        while stack:
            h = stack.pop()
            if h.GetGeometryCount(): stack.extend(h.GetGeometryRef(i) for i in range(h.GetGeometryCount())); continue
            for i in range(h.GetPointCount()):
                x, y = X(h.GetX(i)), Y(h.GetY(i))
                if not (0 <= x <= 12000 and 0 <= y <= 14400): continue
                p = ogr.Geometry(ogr.wkbPoint); p.AddPoint_2D(x, y)
                if p.Within(land): continue
                ds.append(p.Distance(derived[ft]))
    print('ENC %g ft contour -> derived %d ft isobath: n=%d median=%.0f m p75=%.0f p90=%.0f max=%.0f' % (
        ft, ft, len(ds), st.median(ds), pct(ds, 75), pct(ds, 90), max(ds)))

# 2) contours crossing land / each other
for k, m in derived.items():
    inter = m.Intersection(land)
    print('  %d ft isobath length on land: %.1f m (total %.0f m)' % (k, inter.Length() if inter else 0, m.Length()))
ks = sorted(derived)
for a, b in zip(ks, ks[1:]):
    x = derived[a].Intersection(derived[b])
    print('  crossings %d/%d ft: %d' % (a, b, 0 if x is None or x.IsEmpty() else max(1, x.GetGeometryCount())))

# 3) grid residuals at soundings
W, H = g25.RasterXSize, g25.RasterYSize
z = struct.unpack('%df' % (W*H), g25.GetRasterBand(1).ReadRaster(buf_type=gdal.GDT_Float32))
gr = d['depthGrid']
r25, r100, onland = [], [], 0
for x, y, ft in d['soundings']:
    i, j = int(y // 25), int(x // 25)
    v = z[min(H-1, i)*W + min(W-1, j)]
    if v > -9000: r25.append(v - ft)
    v2 = gr['cells'][int(y // gr['cell'])*gr['w'] + int(x // gr['cell'])]
    if v2 == gr['land']: onland += 1
    else: r100.append(v2 - ft)
    p = ogr.Geometry(ogr.wkbPoint); p.AddPoint_2D(x, y)
print('grid25 - sounding (ft): median=%.1f p10=%.1f p90=%.1f' % (st.median(r25), pct(r25, 10), pct(r25, 90)))
print('grid100 - sounding (ft): median=%.1f p10=%.1f p90=%.1f; soundings in land cells: %d' % (st.median(r100), pct(r100, 10), pct(r100, 90), onland))
sl = 0
for x, y, ft in d['soundings']:
    p = ogr.Geometry(ogr.wkbPoint); p.AddPoint_2D(x, y); sl += p.Within(land)
print('soundings inside land polygons: %d' % sl)

# 4) narrows: wet cells across E-W transects at the bridge and 1 km south of it
def transect(lat_y_frame):
    i = int(lat_y_frame // gr['cell']); row = gr['cells'][i*gr['w']:(i+1)*gr['w']]
    return ''.join('.' if v == gr['land'] else ('#' if v >= 20 else ('+' if v >= 6 else '-')) for v in row)
lyr = enc.GetLayerByName('BRIDGE')
for f in lyr:
    if f.GetField('VERCLR'):
        c = f.GetGeometryRef().Centroid(); by = Y(c.GetY()); bx = X(c.GetX())
print('bridge at frame (%.0f, %.0f)' % (bx, by))
for dy in (-500, 0, 500, 1500, 3000):
    print('  y=%5d %s' % (by + dy, transect(by + dy)[50:95]))
