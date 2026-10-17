"""Render the browser JSON itself (not the GPKG) to PNG for QA.
usage: python3 -I render.py chart.json out.png [metres_per_px] [n_soundings] [grid]
"""
import sys, json
from PIL import Image, ImageDraw, ImageFont
d = json.load(open(sys.argv[1])); out = sys.argv[2]
mpp = float(sys.argv[3]) if len(sys.argv) > 3 else 10.0
nsnd = int(sys.argv[4]) if len(sys.argv) > 4 else 180
show_grid = len(sys.argv) > 5 and sys.argv[5] == 'grid'
W, H = d['projection']['width'], d['projection']['height']
im = Image.new('RGB', (int(W/mpp), int(H/mpp)), (226, 236, 240))
dr = ImageDraw.Draw(im)
P = lambda xs: [(xs[i]/mpp, xs[i+1]/mpp) for i in range(0, len(xs), 2)]
try:
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Georgia Italic.ttf', 11)
    lfont = ImageFont.truetype('/System/Library/Fonts/Supplemental/Georgia.ttf', 12)
except Exception:
    font = lfont = ImageFont.load_default()

if show_grid:
    g = d['depthGrid']; c = g['cell']
    for i in range(g['h']):
        for j in range(g['w']):
            v = g['cells'][i*g['w'] + j]
            if v == g['land']: continue
            t = min(1.0, v / 100.0)
            col = (int(200 - 150*t), int(225 - 120*t), int(240 - 60*t))
            dr.rectangle([j*c/mpp, i*c/mpp, (j+1)*c/mpp - 1, (i+1)*c/mpp - 1], fill=col)
# land
for poly in d['land']:
    mask = Image.new('L', im.size, 0); md = ImageDraw.Draw(mask)
    for k, ring in enumerate(poly):
        md.polygon(P(ring), fill=255 if k == 0 else 0)
    im.paste((236, 226, 200), mask=mask)
    for ring in poly:
        pts = P(ring); dr.line(pts + pts[:1], fill=(70, 60, 50), width=1)
for isl in d['islands']:
    dr.polygon(P(isl['ring']), fill=(236, 226, 200), outline=(70, 60, 50))
# contours
cols = {6: (60, 120, 200), 12: (40, 90, 170), 18: (30, 70, 150), 30: (20, 50, 130), 60: (10, 30, 110), 90: (0, 0, 90)}
for c in d['contours']:
    for ln in c['lines']:
        dr.line(P(ln), fill=cols.get(c['depth'], (0, 0, 0)), width=1)
# soundings (first n in thinning order)
for x, y, ft in d['soundings'][:nsnd]:
    dr.text((x/mpp, y/mpp), str(ft), fill=(40, 50, 90), font=font, anchor='mm')
# features
for f in d['features']:
    x, y = f.get('x', 0)/mpp, f.get('y', 0)/mpp
    t = f['type']
    if t == 'label':
        dr.text((x, y), f['name'], fill=(110, 60, 40) if f['kind'] != 'water' else (40, 70, 120), font=lfont, anchor='mm')
    elif t in ('buoy', 'beacon'):
        col = (200, 30, 30) if 'red' in f.get('color', '') else (20, 140, 40)
        dr.ellipse([x-4, y-4, x+4, y+4], fill=col)
    elif t == 'bridge' and f.get('ring'):
        dr.polygon(P(f['ring']), outline=(0, 0, 0), fill=(60, 60, 60))
    elif t == 'obstruction':
        if f.get('ring'): dr.polygon(P(f['ring']), outline=(150, 0, 150))
        else: dr.line([x-3, y-3, x+3, y+3], fill=(150, 0, 150)); dr.line([x-3, y+3, x+3, y-3], fill=(150, 0, 150))
    elif t == 'rock':
        dr.text((x, y), '*', fill=(0, 0, 0), font=lfont, anchor='mm')
    elif t == 'landmark':
        dr.rectangle([x-3, y-3, x+3, y+3], outline=(0, 0, 0))
im.save(out)
print('rendered', out, im.size)
