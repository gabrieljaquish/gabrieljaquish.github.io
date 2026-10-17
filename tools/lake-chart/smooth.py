"""Masked smoothing of the TIN depth grid (normalized convolution with 3 box passes ~ Gaussian).
Only water cells contribute and only water cells get values; land becomes nodata (-9999).
Shallow water keeps the raw TIN so the ENC 6/12 ft contours (TIN constraints) are honoured exactly;
the smoothed surface is blended in linearly between BLEND_A and BLEND_B feet (TIN depth).
usage: python3 -I smooth.py tin.tif mask.tif out.tif radius_cells [blend_a_ft blend_b_ft]
"""
import sys, struct
from osgeo import gdal
gdal.UseExceptions()
tin_p, mask_p, out_p, r = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
BLEND_A, BLEND_B = (float(sys.argv[5]), float(sys.argv[6])) if len(sys.argv) > 6 else (12.0, 24.0)
ND = -9999.0
t = gdal.Open(tin_p); m = gdal.Open(mask_p)
W, H = t.RasterXSize, t.RasterYSize
z = list(struct.unpack('%df' % (W*H), t.GetRasterBand(1).ReadRaster(buf_type=gdal.GDT_Float32)))
mk = m.GetRasterBand(1).ReadRaster(buf_type=gdal.GDT_Byte)
w = [1.0 if (mk[i] and z[i] != ND) else 0.0 for i in range(W*H)]
v = [z[i] * w[i] for i in range(W*H)]

def box1d(a, n, stride, count, step):
    # in-place running-mean along rows (stride=W, step=1) or columns (stride=1, step=W)
    out = a[:]
    for k in range(count):
        base = k * stride
        s = 0.0; buf = [a[base + j*step] for j in range(n)]
        # window sum with clamped edges
        s = sum(buf[0:min(n, r+1)]) + buf[0] * r
        for j in range(n):
            out[base + j*step] = s / (2*r + 1)
            add = buf[min(n-1, j + r + 1)]; sub = buf[max(0, j - r)]
            s += add - sub
    return out

for _ in range(3):
    v = box1d(v, W, W, H, 1); w = box1d(w, W, W, H, 1)
    v = box1d(v, H, 1, W, W); w = box1d(w, H, 1, W, W)
out = [ND] * (W*H)
for i in range(W*H):
    if mk[i] and w[i] > 1e-6:
        sm = v[i] / w[i]
        if z[i] != ND:
            a = min(1.0, max(0.0, (z[i] - BLEND_A) / (BLEND_B - BLEND_A)))
            sm = a * sm + (1.0 - a) * z[i]
        out[i] = max(0.0, sm)
d = gdal.GetDriverByName('GTiff').Create(out_p, W, H, 1, gdal.GDT_Float32, ['COMPRESS=DEFLATE'])
d.SetGeoTransform(t.GetGeoTransform()); d.SetProjection(t.GetProjection())
b = d.GetRasterBand(1); b.SetNoDataValue(ND)
b.WriteRaster(0, 0, W, H, struct.pack('%df' % (W*H), *out))
d = None
wet = [x for x in out if x != ND]
print('smoothed grid %dx%d, water cells %d, depth ft %.1f..%.1f' % (W, H, len(wet), min(wet), max(wet)))
