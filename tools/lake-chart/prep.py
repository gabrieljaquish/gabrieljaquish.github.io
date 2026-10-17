"""Build water/land/islands and gridding constraint points (all LOCAL metres).
usage: python3 -I prep.py enc.gpkg nhd.gpkg geom_out.gpkg pts_out.gpkg
"""
import sys, os
from osgeo import ogr, osr
ogr.UseExceptions()
enc_p, nhd_p, geom_p, pts_p = sys.argv[1:5]
# Optional: GPKG layer 'extra' of own soundings (depth_ft, feet below Low Lake Level), LOCAL metres.
extra_p = sys.argv[5] if len(sys.argv) > 5 else None

RECT = (-6000, -7200, 6000, 7200)       # output rectangle
PBOX = (-8500, -9700, 8500, 9700)       # constraint points kept inside this box
SIMPLIFY_WATER = 5.0                    # metres
SEG = 25.0                              # densify constraint lines (m)
FT = 3.28084

def box(x0, y0, x1, y1):
    r = ogr.Geometry(ogr.wkbLinearRing)
    for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)):
        r.AddPoint_2D(x, y)
    p = ogr.Geometry(ogr.wkbPolygon); p.AddGeometry(r); return p

enc = ogr.Open(enc_p); nhd = ogr.Open(nhd_p)
srs = nhd.GetLayerByName('lake').GetSpatialRef()

def union(geoms):
    m = ogr.Geometry(ogr.wkbMultiPolygon)
    for g in geoms:
        g = g.Clone(); g.FlattenTo2D()
        if g.GetGeometryType() == ogr.wkbPolygon: m.AddGeometry(g)
        else:
            for i in range(g.GetGeometryCount()): m.AddGeometry(g.GetGeometryRef(i))
    return m.UnionCascaded()

def feats(ds, name):
    lyr = ds.GetLayerByName(name)
    return [] if lyr is None else list(lyr)

# --- water ---
water0 = union([f.GetGeometryRef().Clone() for f in feats(nhd, 'lake')] + [f.GetGeometryRef().Clone() for f in feats(nhd, 'area')])
islets = [f.GetGeometryRef().Clone() for f in feats(enc, 'LNDARE')
          if 'POLYGON' in f.GetGeometryRef().GetGeometryName()
          and 0 < f.GetGeometryRef().GetArea() < 1e5 and f.GetGeometryRef().Intersects(water0)]
water_raw = water0.Difference(union(islets)) if islets else water0
water_raw = water_raw.Buffer(0)
water_s = water_raw.SimplifyPreserveTopology(SIMPLIFY_WATER).Buffer(0)
rect = box(*RECT)
water = water_s.Intersection(rect)
land = rect.Difference(water)
islands = [g.Intersection(rect) for g in islets if g.Intersects(rect)]

def area_km2(g): return g.GetArea() / 1e6
print('water_raw %.3f km2, water(rect,simplified) %.3f km2, land %.3f km2, islets %d (%s m2)' % (
    area_km2(water_raw.Intersection(rect)), area_km2(water), area_km2(land), len(islands),
    ','.join('%.0f' % g.GetArea() for g in islands)))

drv = ogr.GetDriverByName('GPKG')
if os.path.exists(geom_p): drv.DeleteDataSource(geom_p)
gds = drv.CreateDataSource(geom_p)
for name, geoms in (('water_raw', [water_raw]), ('water_simp', [water_s]), ('water', [water]), ('land', [land]), ('islands', islands)):
    lyr = gds.CreateLayer(name, srs, ogr.wkbUnknown)
    for g in geoms:
        f = ogr.Feature(lyr.GetLayerDefn()); f.SetGeometry(g); lyr.CreateFeature(f)
ctn = gds.CreateLayer('ctnare', srs, ogr.wkbUnknown)
for f in feats(enc, 'CTNARE'):
    o = ogr.Feature(ctn.GetLayerDefn()); o.SetGeometry(f.GetGeometryRef()); ctn.CreateFeature(o)
gds = None

# --- constraint points (feet, positive down) ---
pbox = box(*PBOX)
prep_w = water_raw.Intersection(pbox)   # smaller geometry for faster Within tests
pts = []   # (x, y, ft, src)
def inbox(x, y): return PBOX[0] <= x <= PBOX[2] and PBOX[1] <= y <= PBOX[3]

def add_line_vertices(g, ft, src, require_water=True):
    g = g.Clone(); g.FlattenTo2D(); g.Segmentize(SEG)
    stack = [g]
    while stack:
        h = stack.pop()
        if h.GetGeometryCount() and h.GetPointCount() == 0:
            stack.extend(h.GetGeometryRef(i) for i in range(h.GetGeometryCount())); continue
        for i in range(h.GetPointCount()):
            x, y = h.GetX(i), h.GetY(i)
            if not inbox(x, y): continue
            if require_water:
                p = ogr.Geometry(ogr.wkbPoint); p.AddPoint_2D(x, y)
                if not p.Within(prep_w): continue
            pts.append((x, y, ft, src))

# Own soundings first: average into 10 m bins (sonar logs are dense along tracks).
own = {}
if extra_p:
    eds = ogr.Open(extra_p)
    for f in eds.GetLayerByName('extra'):
        g = f.GetGeometryRef(); x, y = g.GetX(), g.GetY()
        if not inbox(x, y): continue
        q = ogr.Geometry(ogr.wkbPoint); q.AddPoint_2D(x, y)
        if not q.Within(prep_w): continue
        own.setdefault((int(x // 10), int(y // 10)), []).append((x, y, float(f.GetField('depth_ft'))))
    for cell in own.values():
        n = len(cell)
        pts.append((sum(c[0] for c in cell) / n, sum(c[1] for c in cell) / n, round(sum(c[2] for c in cell) / n, 2), 'own'))
OWN_RADIUS = 30   # m: an ENC sounding this close to an own sounding is superseded (1870-1939 surveys)
own_xy = [(p[0], p[1]) for p in pts if p[3] == 'own']
def near_own(x, y):
    return any((x - ox) ** 2 + (y - oy) ** 2 < OWN_RADIUS ** 2 for ox, oy in own_xy)

n_drop = {'snd': 0, 'cnt': 0, 'superseded': 0}
for f in feats(enc, 'SOUNDG'):
    g = f.GetGeometryRef()
    for i in range(max(1, g.GetGeometryCount())):
        p = g.GetGeometryRef(i) if g.GetGeometryCount() else g
        x, y = p.GetX(), p.GetY()
        if not inbox(x, y): continue
        q = ogr.Geometry(ogr.wkbPoint); q.AddPoint_2D(x, y)
        if not q.Within(prep_w): n_drop['snd'] += 1; continue
        if own_xy and near_own(x, y): n_drop['superseded'] += 1; continue
        pts.append((x, y, round(f.GetField('DEPTH') * FT, 2), 'snd'))
before = len(pts)
for f in feats(enc, 'DEPCNT'):
    v = f.GetField('VALDCO')
    if v is None: continue
    ft = round(v * FT)           # 0, 1.8, 3.6 m -> 0, 6, 12 ft (chart was compiled in feet)
    add_line_vertices(f.GetGeometryRef(), float(ft), 'cnt')
for f in feats(enc, 'DEPARE'):
    if f.GetField('DRVAL1') is None and f.GetField('DRVAL2') == 0:
        add_line_vertices(f.GetGeometryRef().GetBoundary(), 0.0, 'dep0')
# shoreline zeros: boundary of the (unsimplified) water polygon; no water test (they ARE the edge)
add_line_vertices(water_raw.GetBoundary(), 0.0, 'shore', require_water=False)

if os.path.exists(pts_p): drv.DeleteDataSource(pts_p)
pds = drv.CreateDataSource(pts_p)
lyr = pds.CreateLayer('p', srs, ogr.wkbPoint)
lyr.CreateField(ogr.FieldDefn('ft', ogr.OFTReal)); lyr.CreateField(ogr.FieldDefn('src', ogr.OFTString))
lyr.StartTransaction()
for x, y, ft, src in pts:
    f = ogr.Feature(lyr.GetLayerDefn()); g = ogr.Geometry(ogr.wkbPoint); g.AddPoint_2D(x, y)
    f.SetGeometry(g); f.SetField('ft', ft); f.SetField('src', src); lyr.CreateFeature(f)
lyr.CommitTransaction()
from collections import Counter
print('constraint points:', dict(Counter(p[3] for p in pts)), 'ENC soundings dropped (outside NHD water):', n_drop['snd'], 'superseded by own:', n_drop['superseded'])
