// Drafting sheet ("Exploded View"): the page is a ruled, zoned drafting sheet with two assemblies drawn in
// its margins, a pegged mortise and tenon and a wood-fired oven in section. Bring the pointer near one and
// it comes apart into an exploded view, with leader balloons, a parts list and the nearest dimension
// called out, while a drafting machine's arms track the pointer across the sheet. Clicking open background
// pins the nearest view open. Left alone for a while, the sheet walks through each view once.
//
// The content column runs the full height of the viewport on a ~90% panel, so the drawings, the notes and
// the title block live in the gutters, and nothing that moves is painted under the column (the ruled sheet
// itself runs underneath, faintly, like a paste-up on the board). Narrow screens get the sheet full-bleed
// with one assembly ghosted behind the text; touch devices get a single walk-through and tap to pin.

const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';
const IN = '″', FT = '′', X = '×', DIA = 'Ø';
const SCALES = [[2, '6' + IN + ' = 1' + FT + '-0' + IN], [4, '3' + IN + ' = 1' + FT + '-0' + IN], [6, '2' + IN + ' = 1' + FT + '-0' + IN],
  [8, '1-1/2' + IN + ' = 1' + FT + '-0' + IN], [12, '1' + IN + ' = 1' + FT + '-0' + IN], [16, '3/4' + IN + ' = 1' + FT + '-0' + IN],
  [24, '1/2' + IN + ' = 1' + FT + '-0' + IN], [32, '3/8' + IN + ' = 1' + FT + '-0' + IN], [48, '1/4' + IN + ' = 1' + FT + '-0' + IN]];
const NTS = 'NOT TO SCALE';
const K = 0.433, Q = 0.25, TAU = Math.PI * 2; // cabinet oblique: depth at 30 degrees, half scale

const TOP = 72;       // drawings start below the site header (a full-width panel at scroll 0)
const FOOT = 92;      // and end above the footer (a ~73 px full-width panel, pinned to the viewport bottom on short pages)
const GAP = 18;       // clearance between a drawing and the column's edge (the text starts ~20 px further in)
const EDGE = 38;      // clearance from the sheet's border and its zone letters
const NARROW = 120;   // below this gutter width the sheet goes full-bleed
const TB_W = 236, TB_H = 72;
const NOTES = ['1. ALL DIMENSIONS IN INCHES UNLESS NOTED.', '2. BREAK ALL SHARP EDGES.', '3. MEASURE TWICE.'];
const DIM_ORDER = ['FLOOR', 'RISE', 'FLUE', 'DOOR', 'FIREBRICK', 'BLANKET', 'SILL', 'TENON', 'PEG', 'DRAWBORE'];
// How much text sits under a view, most first: title + scale + parts list, title + scale, title, nothing.
const GUTTER_TEXT = ['full', 'sub', 'title', 'none'];

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function rgb(c) {
  const s = String(c || '').trim();
  let m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
}
function mix(a, b, t) {
  const A = rgb(a), B = rgb(b);
  let o = '#';
  for (let i = 0; i < 3; i++) o += (256 + clamp(Math.round(A[i] + (B[i] - A[i]) * t), 0, 255)).toString(16).slice(1);
  return o;
}
function brk(a, b, amp) { // long-break line: straight, with a zigzag in the middle
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * amp, ny = (dx / l) * amp;
  const at = (t, k) => [a[0] + dx * t + nx * k, a[1] + dy * t + ny * k];
  return [a, at(0.42, 0), at(0.47, 1), at(0.53, -1), at(0.58, 0), b];
}
function circ(cx, cy, r, a0, a1, n) {
  const o = [];
  for (let i = 0; i <= n; i++) { const t = a0 + ((a1 - a0) * i) / n; o.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
  return o;
}
function rectPts(x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
function scaleLine(label, def) { return (label === NTS ? NTS : 'SCALE ' + label) + '   ' + def.dwg; }
function spr(o, k, kv, target, w, dt) { // critically damped spring, exact for any dt
  const y = o[k] - target, v = o[kv], ex = Math.exp(-w * dt), q = (v + w * y) * dt;
  o[k] = target + (y + q) * ex; o[kv] = (v - w * q) * ex;
}

/* ---------- geometry builder: authored in drawing units (inches, y up), stored in CSS px ---------- */
function part(o) {
  o.g = { fill: [], shade: [], solid: [], thin: [], hidden: [], center: [], heavy: [] };
  o.hat = []; o.clp = []; o.dims = []; o.bb = [1e9, 1e9, -1e9, -1e9];
  o.dx = o.dy = o.du = o.lt = 0;
  return o;
}
function tp(bx, p) { return [bx.mx * p[0] * bx.s, -p[1] * bx.s]; }
function flat(bx, pts, bb) {
  const f = new Float32Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    const x = bx.mx * pts[i][0] * bx.s, y = -pts[i][1] * bx.s;
    f[2 * i] = x; f[2 * i + 1] = y;
    if (bb) { if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y; }
  }
  return f;
}
function seg(bx, p, cls, pts, closed) { p.g[cls].push({ f: flat(bx, pts, cls === 'center' ? null : p.bb), c: !!closed }); }
function bbox(bx, p, pts) { flat(bx, pts, p.bb); }
function hatch(bx, p, poly, ang, gap) { p.hat.push({ f: flat(bx, poly, p.bb), ang, gap }); }
function clipped(bx, p, poly, lines) { p.clp.push({ f: flat(bx, poly, null), L: lines.map((l) => ({ f: flat(bx, l, null), c: false })) }); }
function dim(bx, p, a, b, o, t, n, at) { p.dims.push({ a: tp(bx, a), b: tp(bx, b), o: [bx.mx * o[0] * bx.s, -o[1] * bx.s], t, n, at: at || 0.5 }); }
function balloon(bx, p, at, b) { p.bal = { at: tp(bx, at), b: tp(bx, b) }; }
function pathOf(list) {
  const P = new Path2D();
  for (const item of list) {
    const f = item.f;
    P.moveTo(f[0], f[1]);
    for (let k = 2; k < f.length; k += 2) P.lineTo(f[k], f[k + 1]);
    if (item.c) P.closePath();
  }
  return P;
}
function hatchPath(f, ang, gap) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < f.length; i += 2) { x0 = Math.min(x0, f[i]); x1 = Math.max(x1, f[i]); y0 = Math.min(y0, f[i + 1]); y1 = Math.max(y1, f[i + 1]); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + 2, ca = Math.cos(ang), sa = Math.sin(ang), P = new Path2D();
  for (let t = -R; t <= R; t += gap) { const px = cx - sa * t, py = cy + ca * t; P.moveTo(px - ca * R, py - sa * R); P.lineTo(px + ca * R, py + sa * R); }
  return P;
}
function finish(bx, p) {
  p.P = {};
  for (const k in p.g) p.P[k] = p.g[k].length ? pathOf(p.g[k]) : null;
  p.H = p.hat.map((h) => ({ clip: pathOf([{ f: h.f, c: true }]), lines: hatchPath(h.f, h.ang, h.gap) }));
  p.CL = p.clp.map((h) => ({ clip: pathOf([{ f: h.f, c: true }]), lines: pathOf(h.L) }));
  p.ax = [bx.mx * p.axis[0] * bx.s, -p.axis[1] * bx.s];
  p.tieP = p.tie ? tp(bx, p.tie) : null;
  p.g = p.hat = p.clp = null;
  return p;
}
function trace(c, bx, pts, close) {
  const s = bx.s, m = bx.mx;
  c.moveTo(m * pts[0][0] * s, -pts[0][1] * s);
  for (let i = 1; i < pts.length; i++) c.lineTo(m * pts[i][0] * s, -pts[i][1] * s);
  if (close) c.closePath();
}
function envOf(parts, pad) { // the extent of an assembly, assembled and fully exploded, balloons included
  const e = [1e9, 1e9, -1e9, -1e9];
  const ext = (x0, y0, x1, y1) => { e[0] = Math.min(e[0], x0); e[1] = Math.min(e[1], y0); e[2] = Math.max(e[2], x1); e[3] = Math.max(e[3], y1); };
  for (const p of parts) {
    const dx = p.ax[0] * p.dist, dy = p.ax[1] * p.dist;
    if (p.bb[0] < 1e8) { ext(p.bb[0], p.bb[1], p.bb[2], p.bb[3]); ext(p.bb[0] + dx, p.bb[1] + dy, p.bb[2] + dx, p.bb[3] + dy); }
    if (p.bal) ext(p.bal.b[0] + dx - pad, p.bal.b[1] + dy - pad, p.bal.b[0] + dx + pad, p.bal.b[1] + dy + pad);
  }
  return e;
}

/* ---------- assembly A: pegged mortise and tenon (cabinet oblique, inches) ---------- */
function buildMT(bx, COL) {
  const L = 7, H = 11, tw = 3.5, t0 = 3.25, t1 = 4.75, tl = 4, py = -2, pr = 0.5, dbo = 0.125;
  const ca = (Math.PI * 2) / 3, cb = -Math.PI / 3; // silhouette tangents of a cylinder along z
  const P = (x, y, z) => [x + K * z, y + Q * z];

  const sill = part({ n: 1, name: 'SILL, 8' + X + '8 WHITE OAK', axis: [0, 0], dist: 0, rank: 0 });
  const bt = brk(P(-L, 0, 8), P(-L, 0, 0), 0.7), bf = brk(P(-L, 0, 0), P(-L, -8, 0), 0.7);
  seg(bx, sill, 'fill', [P(-L, -8, 0), P(L, -8, 0), P(L, -8, 8), P(L, 0, 8)].concat(bt, bf), true);
  seg(bx, sill, 'heavy', [P(-L, -8, 0), P(L, -8, 0), P(L, 0, 0), P(-L, 0, 0)]);
  seg(bx, sill, 'heavy', [P(L, 0, 0), P(L, 0, 8), P(-L, 0, 8)]);
  seg(bx, sill, 'heavy', [P(L, -8, 0), P(L, -8, 8), P(L, 0, 8)]);
  seg(bx, sill, 'thin', bt); seg(bx, sill, 'thin', bf);
  const mo = [P(-tw, 0, t0), P(tw, 0, t0), P(tw, 0, t1), P(-tw, 0, t1)], hole = circ(0, py, pr, 0, TAU, 28);
  seg(bx, sill, 'shade', mo, true); seg(bx, sill, 'heavy', mo, true);
  seg(bx, sill, 'shade', hole, true); seg(bx, sill, 'heavy', hole, true);
  seg(bx, sill, 'hidden', [P(-tw, 0, t0), P(-tw, -tl, t0), P(tw, -tl, t0), P(tw, 0, t0)]);
  seg(bx, sill, 'hidden', [P(tw, -tl, t0), P(tw, -tl, t1), P(tw, 0, t1)]);
  for (const a of [ca, cb]) { const q = [pr * Math.cos(a), py + pr * Math.sin(a)]; seg(bx, sill, 'hidden', [q, P(q[0], q[1], 8)]); }
  const rings = [];
  for (let k = 1; k <= 7; k++) {
    const ring = [], rr = k * 0.95 + 0.25;
    for (let j = 0; j <= 48; j++) {
      const t = (j / 48) * TAU, w = rr * (1 + 0.035 * Math.sin(3 * t + k));
      ring.push(P(L, -4.3 + w * Math.cos(t), 4.4 + w * Math.sin(t)));
    }
    rings.push(ring);
  }
  rings.push([P(L, -4.3, 4.4), P(L, -1.3, 2.3), P(L, -0.4, 1.9)]);
  clipped(bx, sill, [P(L, 0, 0), P(L, -8, 0), P(L, -8, 8), P(L, 0, 8)], rings);
  const grain = [];
  [-0.9, -3.4, -5.0, -6.7].forEach((gy, m) => {
    const ln = [];
    for (let x = -L + 0.9; x <= L - 0.3; x += 0.5) ln.push([x, gy + 0.14 * Math.sin(x * 0.55 + m * 1.7)]);
    grain.push(ln);
  });
  clipped(bx, sill, [P(-L, -8, 0), P(L, -8, 0), P(L, 0, 0), P(-L, 0, 0)], grain);
  dim(bx, sill, [-L + 0.01, -8], [-L + 0.01, 0], [-1.6, 0], '8' + IN, 'SILL');
  balloon(bx, sill, [2.4, -7.1], [5.2, -10.6]);

  const post = part({ n: 2, name: 'POST, 8' + X + '8 WHITE OAK', axis: [0, 1], dist: 8, rank: 0.3, tie: P(0, -tl, 4) });
  const b1 = brk(P(4, H, 8), P(4, H, 0), 0.7), b2 = brk(P(4, H, 0), P(-4, H, 0), 0.7);
  seg(bx, post, 'fill', [P(-4, 0, 0), P(4, 0, 0), P(4, 0, 8)].concat(b1, b2), true);
  seg(bx, post, 'heavy', [P(-4, H, 0), P(-4, 0, 0), P(4, 0, 0), P(4, 0, 8), P(4, H, 8)]);
  seg(bx, post, 'heavy', [P(4, 0, 0), P(4, H, 0)]);
  seg(bx, post, 'thin', b1); seg(bx, post, 'thin', b2);
  const pg = [];
  [-2.7, -1.1, 1.5, 2.9].forEach((gx, m) => {
    const ln = [];
    for (let y = 0.5; y <= H - 0.9; y += 0.5) ln.push([gx + 0.13 * Math.sin(y * 0.5 + m * 2.1), y]);
    pg.push(ln);
  });
  [2.4, 5.6].forEach((gz, m) => {
    const ln = [];
    for (let y = 0.5; y <= H - 0.9; y += 0.5) ln.push(P(4, y, gz + 0.12 * Math.sin(y * 0.6 + m)));
    pg.push(ln);
  });
  clipped(bx, post, [P(-4, 0, 0), P(4, 0, 0), P(4, 0, 8), P(4, H, 8), P(4, H, 0), P(-4, H, 0)], pg);
  bbox(bx, post, [P(-tw, -tl, t0), P(tw, -tl, t1)]);
  post.pre = true;
  post.dyn = (c, d, hc) => { // the tenon, clipped in 3D to the part above the sill's top face
    if (d < 0.03) return;
    const y0 = Math.max(-tl, -d), cheek = [P(-tw, 0, t0), P(-tw, y0, t0), P(tw, y0, t0), P(tw, 0, t0)];
    c.beginPath(); trace(c, bx, [P(-tw, 0, t0), P(-tw, y0, t0), P(tw, y0, t0), P(tw, y0, t1), P(tw, 0, t1), P(tw, 0, t0)], true);
    c.fillStyle = COL.bg; c.fill();
    if (d > 1.3) {
      c.save(); c.beginPath(); trace(c, bx, cheek, true); c.clip();
      c.beginPath(); trace(c, bx, circ(K * t0, -2 + dbo + Q * t0, pr, 0, TAU, 24), true);
      c.fillStyle = COL.shade; c.fill(); c.lineWidth = 1.1; c.strokeStyle = hc; c.stroke(); c.restore();
    }
    c.beginPath(); trace(c, bx, cheek, false); trace(c, bx, [P(tw, y0, t0), P(tw, y0, t1), P(tw, 0, t1)], false);
    c.lineWidth = 1.35; c.strokeStyle = hc; c.stroke();
  };
  dim(bx, post, P(-tw, -tl, t0), P(tw, -tl, t0), [0, -1.3], '7' + IN, 'TENON');
  dim(bx, post, P(tw, -tl, t0), P(tw, -tl, t1), [0.55, -0.95], '1-1/2' + IN, 'TENON');
  dim(bx, post, P(-1.1, -2, t0), P(-1.1, -2 + dbo, t0), [-1.4, 0], '1/8' + IN, 'DRAWBORE');
  balloon(bx, post, [-2.6, 7.4], [-7.0, 9.6]);

  const peg = part({ n: 3, name: 'PEG, ' + DIA + '1' + IN + ' RIVEN OAK', axis: [-K, -Q], dist: 12, rank: 0, tie: [0, py] });
  bbox(bx, peg, [[-pr, py - pr], [pr, py + pr], P(pr, py + pr, 8)]);
  peg.dyn = (c, d, hc, tc) => { // the peg, clipped to the length that has left its hole
    if (d < 0.05) return;
    const zf = Math.min(8, d), F = [], N = [];
    for (let i = 0; i <= 16; i++) { const a = ca + (Math.PI * i) / 16; F.push([pr * Math.cos(a), py + pr * Math.sin(a)]); }
    for (let i = 0; i <= 16; i++) {
      const a = cb + (Math.PI * i) / 16;
      F.push(P(pr * Math.cos(a), py + pr * Math.sin(a), zf)); N.push([pr * Math.cos(a), py + pr * Math.sin(a)]);
    }
    c.beginPath(); trace(c, bx, F, true); c.fillStyle = COL.bg; c.fill(); c.lineWidth = 1.35; c.strokeStyle = hc; c.stroke();
    c.beginPath(); trace(c, bx, N, false); c.stroke();
    c.beginPath(); trace(c, bx, circ(0, py, pr * 0.62, 0, TAU, 20), true); c.lineWidth = 0.6; c.strokeStyle = tc; c.stroke();
  };
  dim(bx, peg, [-pr, py], [pr, py], [0, -1.3], DIA + '1' + IN, 'PEG');
  balloon(bx, peg, [-0.45, py + 0.2], [-3.4, py + 1.0]);
  return [sill, post, peg];
}

/* ---------- assembly B: wood-fired oven, side section (inches) ---------- */
function buildOven(bx) {
  const w = 18, h = 20, tD = 4.5, tB = 2, tR = 1.5, door = 13, rTop = 17.5;
  let a = 10, lo = 1, hi = 400;
  for (let i = 0; i < 60; i++) { a = (lo + hi) / 2; if (a * (Math.cosh(w / a) - 1) > h) lo = a; else hi = a; }
  const C = (x, d) => { const u = x / a, ch = Math.cosh(u); return [x + d * Math.tanh(u), h - a * (ch - 1) + d / ch]; };
  const xAt = (d, yv, sg) => {
    let l = 0, r = w + d + 6, m = 0;
    for (let j = 0; j < 48; j++) { m = (l + r) / 2; if (C(sg * m, d)[1] > yv) l = m; else r = m; }
    return (sg * (l + r)) / 2;
  };
  const curve = (d, x0, x1) => {
    const s0 = a * Math.sinh(x0 / a), s1 = a * Math.sinh(x1 / a), n = Math.max(6, Math.ceil(Math.abs(s1 - s0) / 0.9)), o = [];
    for (let j = 0; j <= n; j++) o.push(C(a * Math.asinh((s0 + ((s1 - s0) * j) / n) / a), d));
    return o;
  };
  const band = (d0, d1, yl) => curve(d1, xAt(d1, yl, -1), xAt(d1, 0, 1)).concat(curve(d0, xAt(d0, yl, -1), xAt(d0, 0, 1)).reverse());
  const solidPart = (p, poly) => { seg(bx, p, 'fill', poly, true); seg(bx, p, 'heavy', poly, true); };

  const slab = part({ n: 7, name: 'SLAB AND BLOCK STAND', axis: [0, -1], dist: 9, rank: 0.62, tie: [-32, -10.5] });
  const sR = rectPts(-32, -10.5, 28.5, -6.5);
  solidPart(slab, sR); hatch(bx, slab, sR, -Math.PI / 4, 4.5);
  for (const q of [[-30, -22], [19, 27]]) {
    const bl = brk([q[1], -21], [q[0], -21], 0.9), poly = [[q[0], -10.5], [q[1], -10.5]].concat(bl);
    seg(bx, slab, 'fill', poly, true); hatch(bx, slab, poly, Math.PI / 4, 6);
    seg(bx, slab, 'heavy', [[q[0], -21], [q[0], -10.5]]); seg(bx, slab, 'heavy', [[q[1], -10.5], [q[1], -21]]); seg(bx, slab, 'thin', bl);
  }
  balloon(bx, slab, [28, -9.2], [30.8, -13.4]);

  const board = part({ n: 6, name: 'INSULATING BOARD, 4' + IN, axis: [0, -1], dist: 4.5, rank: 0.5, tie: [-30, -6.5] });
  const bR = rectPts(-30, -6.5, 27, -2.5);
  solidPart(board, bR); hatch(bx, board, bR, Math.PI / 4, 7); hatch(bx, board, bR, -Math.PI / 4, 7);
  balloon(bx, board, [26, -4.5], [30.8, -6.4]);

  const hearth = part({ n: 5, name: 'FIREBRICK HEARTH', axis: [0, 0], dist: 0, rank: 0 });
  solidPart(hearth, rectPts(-30, -2.5, 27, 0));
  for (let x = -21; x < 27; x += 9) seg(bx, hearth, 'thin', [[x, -2.5], [x, 0]]);
  dim(bx, hearth, [-w, 0], [w, 0], [0, 4.5], DIA + '36' + IN, 'FLOOR', 0.72);
  balloon(bx, hearth, [26, -1.25], [30.8, 0.2]);

  const xl = xAt(0, door, -1), xr0 = xAt(tD, 0, 1);
  const dome = part({ n: 4, name: 'FIREBRICK DOME, CATENARY', axis: [0, 1], dist: 6, rank: 0.36, tie: [C(xr0, tD)[0], 0] });
  solidPart(dome, band(0, tD, door));
  for (let k = 0; k < 30; k++) {
    for (const sg of [1, -1]) {
      const xx = a * Math.asinh((sg * (k + 0.5) * 2.75) / a), p0 = C(xx, 0), p1 = C(xx, tD);
      if (sg > 0 ? xx < w - 0.2 && p0[1] > 0.7 : xx > xl && p0[1] > door + 0.7 && p1[1] > door + 0.7) seg(bx, dome, 'thin', [p0, p1]);
    }
  }
  const xo13 = xAt(tD, door, -1), xo17 = xAt(tD, rTop, -1);
  solidPart(dome, [[-20, door], [C(xo13, tD)[0], door]].concat(curve(tD, xo13, xo17), [[-20, rTop]]));
  solidPart(dome, rectPts(-30, door, -26, rTop));
  seg(bx, dome, 'thin', [[-30, 0], [-30, door]]); seg(bx, dome, 'thin', [[C(xl, 0)[0], 0], [C(xl, 0)[0], door]]); // jambs seen beyond the cut
  seg(bx, dome, 'center', [[0, -3], [0, h + tD + 2.5]]);
  dim(bx, dome, [0, 0], [0, h], [0, 0], '20' + IN, 'RISE', 0.7);
  dim(bx, dome, [0, h], [0, h + tD], [0, 0], '4-1/2' + IN, 'FIREBRICK');
  dim(bx, dome, [C(xl, 0)[0], 0], [C(xl, 0)[0], door], [-2.2, 0], '13' + IN, 'DOOR');
  const pd = C(15.2, tD * 0.5);
  balloon(bx, dome, pd, [30.8, pd[1] - 2.6]);

  const dm = tD + tB / 2, xm0 = xAt(dm, rTop, -1), xm1 = xAt(dm, 0, 1);
  const blanket = part({ n: 3, name: 'CERAMIC FIBER BLANKET, 2' + IN, axis: [0, 1], dist: 12, rank: 0.24, tie: [C(xAt(tD + tB, 0, 1), tD + tB)[0], 0] });
  const bB = band(tD, tD + tB, rTop);
  solidPart(blanket, bB);
  const M = [], S = [0], loops = [];
  for (let k = 0; k <= 300; k++) {
    M.push(C(xm0 + ((xm1 - xm0) * k) / 300, dm));
    if (k) S.push(S[k - 1] + Math.hypot(M[k][0] - M[k - 1][0], M[k][1] - M[k - 1][1]));
  }
  const Lt = S[300], Rr = 0.3, Dd = 0.8;
  for (let th = 0; th <= Lt / Rr; th += Math.PI / 10) { // insulation symbol: a prolate trochoid along the blanket's mid-line
    const sp = clamp(Rr * th - Dd * Math.sin(th), 0, Lt);
    let lo2 = 0, hi2 = 300;
    while (hi2 - lo2 > 1) { const m2 = (lo2 + hi2) >> 1; if (S[m2] > sp) hi2 = m2; else lo2 = m2; }
    const f = (sp - S[lo2]) / (S[hi2] - S[lo2] || 1), tx = M[hi2][0] - M[lo2][0], ty = M[hi2][1] - M[lo2][1], tl2 = Math.hypot(tx, ty) || 1;
    loops.push([M[lo2][0] + tx * f - (ty / tl2) * Dd * Math.cos(th), M[lo2][1] + ty * f + (tx / tl2) * Dd * Math.cos(th)]);
  }
  clipped(bx, blanket, bB, [loops]);
  dim(bx, blanket, [0, h + tD], [0, h + tD + tB], [0, 0], '2' + IN, 'BLANKET');
  const pb = C(13.4, dm);
  balloon(bx, blanket, pb, [30.8, pb[1] + 0.5]);

  const render = part({ n: 2, name: 'RENDER SHELL, 1-1/2' + IN, axis: [0, 1], dist: 19, rank: 0.12, tie: [C(xAt(tD + tB + tR, 0, 1), tD + tB + tR)[0], 0] });
  const rB = band(tD + tB, tD + tB + tR, rTop);
  solidPart(render, rB); hatch(bx, render, rB, -Math.PI / 4, 3.2);
  const pr2 = C(10.5, tD + tB + tR);
  balloon(bx, render, pr2, [30.8, pr2[1] + 3]);

  const flue = part({ n: 1, name: 'FLUE, ' + DIA + '6' + IN + ' STEEL', axis: [0, 1], dist: 27, rank: 0, tie: [-23, rTop] });
  for (const r of [rectPts(-26.5, rTop, -26, 40), rectPts(-20, rTop, -19.5, 40)]) { seg(bx, flue, 'fill', r, true); seg(bx, flue, 'solid', r, true); }
  const cap = [[-28.8, 41.6], [-23, 44.6], [-17.2, 41.6]];
  seg(bx, flue, 'fill', cap, true); seg(bx, flue, 'heavy', cap, true);
  for (const lx of [-25.4, -20.6]) seg(bx, flue, 'thin', [[lx, 40], [lx, 41.6 + ((lx < -23 ? lx + 28.8 : -17.2 - lx) * 3) / 5.8]]);
  seg(bx, flue, 'center', [[-23, rTop - 2], [-23, 46.5]]);
  dim(bx, flue, [-26, 34], [-20, 34], [0, 0], DIA + '6' + IN, 'FLUE');
  balloon(bx, flue, [-19.5, 31], [-12.5, 35.5]);
  return [slab, board, hearth, dome, blanket, render, flue];
}

const DEFS = [
  { key: 'mt', letter: 'A', title: 'PEGGED MORTISE AND TENON', dwg: 'GJ-201', build: buildMT },
  { key: 'oven', letter: 'B', title: 'WOOD-FIRED OVEN, SECTION', dwg: 'GJ-103', build: buildOven },
];

/**
 * Drafting sheet background: two assemblies in the gutters that explode as the pointer approaches.
 * @param {HTMLCanvasElement} canvas
 * @param {import('./types').BackgroundOptions} options
 * @returns {import('./types').Background}
 */
export function mount(canvas, options) {
  const W = window, D = document;
  const ctx = canvas.getContext('2d'), stat = D.createElement('canvas'), sctx = stat.getContext('2d');
  if (!ctx || !sctx) return { destroy() {} };
  const dark = !!options.isDark, reduced = !!options.reducedMotion, pal = options.palette;
  const mq = (q) => { try { return !!W.matchMedia(q).matches; } catch { return false; } };
  const now = () => W.performance.now();
  const coarse = mq('(pointer: coarse)'), hover = !coarse && mq('(hover: hover)');
  const pixelRatio = () => Math.min(W.devicePixelRatio || 1, coarse ? 1.5 : 2);

  const bg = pal.bg, ink = pal.ink;
  const COL = {
    bg, ink, acc: pal.accent,
    gridMinor: mix(bg, pal.faint, dark ? 0.5 : 0.42), gridMajor: mix(bg, pal.faint, dark ? 0.95 : 0.9),
    rule: mix(bg, ink, dark ? 0.4 : 0.45), label: mix(bg, ink, dark ? 0.55 : 0.58), title: mix(bg, ink, dark ? 0.72 : 0.78),
    mach: mix(bg, ink, dark ? 0.3 : 0.32), tie: mix(bg, ink, 0.42), shade: mix(bg, ink, dark ? 0.08 : 0.07),
  };
  // Lines darken as a view comes apart: ramps for heavy (outlines) and thin (hatching, hidden lines) work.
  const RH = [], RT = [];
  for (let i = 0; i <= 32; i++) {
    RH.push(mix(mix(bg, ink, dark ? 0.4 : 0.38), mix(bg, ink, dark ? 0.88 : 0.86), i / 32));
    RT.push(mix(mix(bg, ink, dark ? 0.27 : 0.25), mix(bg, ink, dark ? 0.55 : 0.52), i / 32));
  }

  let dpr = 1, Wd = 0, Ht = 0, vw = -1, vh = -1, raf = 0, dead = false, lastT = 0, needLayout = false, staticDirty = true;
  // mode 'margin': drawings in the gutters; 'narrow': the sheet full-bleed under the column.
  const LY = { col: { l: 0, r: 0 }, mode: 'narrow', tb: null, notes: null, title: sheetTitle() };
  let AS = [];
  const keep = {};
  const ptr = { x: -1e4, y: -1e4, in: false, last: now() };
  let tap = null, down = null;
  const mach = { x: 0, y: 0, vx: 0, vy: 0, a: 0 };
  let dimSel = null, dimA = 0;
  const pick = { d: null, A: null, p: null }, G = {};
  let idleT = 0, tourT = 0, tour = null, toured = false;

  function sheetTitle() { // the title block names the section: known sections only, never text from an arbitrary URL
    try {
      return /^\/log(\/|$)/.test(W.location.pathname) ? 'LOG' : 'HOME';
    } catch {
      return 'HOME';
    }
  }
  function textW(font, s) { sctx.font = font; return sctx.measureText(s).width; }
  function readColumn(w) {
    let c = null;
    try { c = options.column(); } catch { c = null; }
    const l = c && Number.isFinite(c.left) ? c.left : 0, r = c && Number.isFinite(c.right) ? c.right : 0;
    return { l: clamp(l, 0, w), r: clamp(r, 0, w) };
  }

  /* ---------- layout ---------- */
  function place(def, slot, levels) {
    if (slot.w < 60 || slot.h < 60) return null;
    const cw = Math.min(slot.w, 400), box = { x: slot.x + (slot.w - cw) / 2, y: slot.y, w: cw, h: slot.h };
    const ub = { s: 1, mx: 1 }, unit = def.build(ub, COL).map((p) => finish(ub, p));
    const e1 = envOf(unit, 0), ew = e1[2] - e1[0], eh = e1[3] - e1[1];
    const head = def.letter + '  ' + def.title, names = unit.filter((p) => p.bal).map((p) => p.name);
    for (const lv of levels) {
      const textH = lv === 'full' ? 30 + names.length * 12 + 14 : lv === 'sub' ? 30 : lv === 'title' ? 26 : 8;
      let s = 0, label = NTS;
      for (const [ratio, name] of SCALES) {
        const ss = 96 / ratio;
        if (ew * ss + 12 <= box.w && eh * ss + 12 <= box.h - textH) { s = ss; label = name; break; }
      }
      // no standard scale fits, or the one that does reads too small: draw it as large as fits, not to scale
      if (!s || s * ew < 100 || s * eh < 90) { s = Math.min((box.w - 12) / ew, (box.h - textH - 12) / eh); label = NTS; }
      if (s * ew < 100 || s * eh < 90) continue;
      // the text under the view must fit the gutter too, or it gives way
      if (lv !== 'none' && textW('600 10px ' + MONO, head) > slot.w) continue;
      if ((lv === 'full' || lv === 'sub') && textW('8.5px ' + MONO, scaleLine(label, def)) > slot.w) continue;
      if (lv === 'full' && Math.max(...names.map((n) => textW('9px ' + MONO, n))) + 20 > slot.w) continue;
      const bx = { s, mx: 1 }, parts = def.build(bx, COL).map((p) => finish(bx, p)), env = envOf(parts, 10);
      const ox = box.x + (box.w - (env[2] - env[0])) / 2 - env[0], oy = box.y + (box.h - textH - (env[3] - env[1])) / 2 - env[1];
      const hb = [1e9, 1e9, -1e9, -1e9];
      for (const p of parts) {
        if (p.bb[0] < 1e8) { hb[0] = Math.min(hb[0], p.bb[0]); hb[1] = Math.min(hb[1], p.bb[1]); hb[2] = Math.max(hb[2], p.bb[2]); hb[3] = Math.max(hb[3], p.bb[3]); }
      }
      const st = keep[def.key] || { e: 0, v: 0, pinned: false };
      return {
        def, slot: box, s, parts, ox, oy, scale: label,
        hb: { x: ox + hb[0], y: oy + hb[1], w: hb[2] - hb[0], h: hb[3] - hb[1] },
        title: lv === 'none' ? null : { x: ox + (env[0] + env[2]) / 2, y: oy + env[3] + 18 },
        sub: lv === 'full' || lv === 'sub',
        bom: lv === 'full'
          ? { x: ox + (env[0] + env[2]) / 2, y: oy + env[3] + 48, x0: null, list: parts.filter((q) => q.bal).sort((u, v) => u.n - v.n) }
          : null,
        e: st.e, v: st.v, pinned: st.pinned, target: 0, tour: 0, rest: false,
      };
    }
    return null;
  }

  function layout() {
    const iw = W.innerWidth, ih = W.innerHeight;
    // Size to the canvas's own box: with classic scrollbars the fixed canvas is narrower than innerWidth.
    const w = Math.max(1, canvas.clientWidth || iw || 1), h = Math.max(1, canvas.clientHeight || ih || 1), r = pixelRatio();
    const col = readColumn(w);
    vw = iw; vh = ih;
    // Nothing that matters moved (an iOS toolbar showing or hiding, say): keep what's drawn.
    if (w === Wd && h === Ht && r === dpr && col.l === LY.col.l && col.r === LY.col.r) return;
    for (const A of AS) keep[A.def.key] = { e: A.e, v: A.v, pinned: A.pinned };
    Wd = w; Ht = h; dpr = r;
    canvas.width = stat.width = Math.round(Wd * dpr); canvas.height = stat.height = Math.round(Ht * dpr);
    LY.col = col; LY.tb = null; LY.notes = null;
    tap = null;
    const out = [], gl = col.l, gr = Wd - col.r;
    if (col.r - col.l >= 1 && Math.min(gl, gr) >= NARROW) {
      LY.mode = 'margin';
      // The title block and the notes only where they fit wholly in their own gutter, lifted clear of the
      // footer so a short page doesn't bury them under its panel (the notes keep their offset from the block).
      const tby = Ht - FOOT - TB_H, ny = Ht - FOOT - 58;
      if (Wd - 16 - TB_W >= col.r + GAP && tby >= TOP) LY.tb = { x: Wd - 16 - TB_W, y: tby, w: TB_W, h: TB_H };
      const nw = Math.max(textW('600 9px ' + MONO, 'GENERAL NOTES'), ...NOTES.map((s) => textW('8.5px ' + MONO, s)));
      if (40 + nw <= col.l - GAP && ny >= TOP) LY.notes = { x: 40, y: ny };
      const rx = col.r + GAP;
      const A = place(DEFS[0], { x: EDGE, y: TOP, w: col.l - GAP - EDGE, h: (LY.notes ? LY.notes.y - 20 : Ht - FOOT) - TOP }, GUTTER_TEXT);
      const B = place(DEFS[1], { x: rx, y: TOP, w: Wd - EDGE - rx, h: (LY.tb ? LY.tb.y - 16 : Ht - FOOT) - TOP }, GUTTER_TEXT);
      if (A) out.push(A);
      if (B) out.push(B);
    } else {
      // Narrow: the column covers nearly everything, so one assembly sits faintly behind the text, unlabeled.
      LY.mode = 'narrow';
      mach.a = 0; // no drafting machine here (and nothing left fading over the column after a resize)
      const slot = { x: EDGE, y: TOP, w: Wd - 2 * EDGE, h: Ht - 30 - TOP };
      const A = place(DEFS[0], slot, ['none']), B = place(DEFS[1], slot, ['none']);
      const best = A && B ? (A.hb.w * A.hb.h >= B.hb.w * B.hb.h ? A : B) : A || B;
      if (best) out.push(best);
    }
    AS = out;
    for (const A of AS) {
      // reduced motion: a finished plate, the oven shown exploded (assembled when it sits behind the text)
      if (reduced) { A.e = A.def.key === 'oven' && LY.mode === 'margin' ? 1 : 0; A.v = 0; }
      A.rest = A.e === 0 && !A.pinned;
    }
    staticDirty = true; dimSel = null; dimA = 0;
  }

  /* ---------- drawing ---------- */
  function offsets(A) {
    for (const p of A.parts) {
      const lt = p.dist ? ease(clamp((A.e - 0.35 * p.rank) / 0.65, 0, 1)) : 0, du = p.dist * lt, sl = A.slot, b = p.bb;
      let dx = p.ax[0] * du, dy = p.ax[1] * du;
      if (b[0] < 1e8) { // keep every part inside its slot
        const lx = sl.x - (A.ox + b[0]), hx = sl.x + sl.w - (A.ox + b[2]), ly = sl.y - (A.oy + b[1]), hy = sl.y + sl.h - (A.oy + b[3]);
        if (lx <= hx) dx = clamp(dx, lx, hx);
        if (ly <= hy) dy = clamp(dy, ly, hy);
      }
      p.lt = lt; p.du = du; p.dx = dx; p.dy = dy;
    }
  }
  function drawPart(c, A, p, hc, tc) {
    const P = p.P;
    c.setTransform(dpr, 0, 0, dpr, dpr * (A.ox + p.dx), dpr * (A.oy + p.dy));
    if (p.dyn && p.pre) p.dyn(c, p.du, hc, tc); // geometry that sits behind this part's own faces
    if (P.fill) { c.fillStyle = COL.bg; c.fill(P.fill); }
    if (P.shade) { c.fillStyle = COL.shade; c.fill(P.shade); }
    c.lineWidth = 0.5; c.strokeStyle = tc;
    for (const hh of p.H) { c.save(); c.clip(hh.clip); c.stroke(hh.lines); c.restore(); }
    for (const cl of p.CL) { c.save(); c.clip(cl.clip); c.stroke(cl.lines); c.restore(); }
    if (P.solid) { c.fillStyle = hc; c.fill(P.solid); }
    if (p.dyn && !p.pre) p.dyn(c, p.du, hc, tc);
    if (P.thin) { c.lineWidth = 0.6; c.strokeStyle = tc; c.stroke(P.thin); }
    if (P.hidden) { c.setLineDash([3.5, 2.5]); c.lineWidth = 0.6; c.strokeStyle = tc; c.stroke(P.hidden); c.setLineDash([]); }
    if (P.center) { c.setLineDash([12, 3, 2, 3]); c.lineWidth = 0.5; c.strokeStyle = tc; c.stroke(P.center); c.setLineDash([]); }
    if (P.heavy) { c.lineWidth = 1.35; c.strokeStyle = hc; c.stroke(P.heavy); }
  }
  function drawAsm(c, A) {
    offsets(A);
    // lines darken as the view comes apart; behind the text (narrow) they stay at their resting weight
    const k = LY.mode === 'margin' ? Math.round(clamp(A.e, 0, 1) * 32) : 0, hc = RH[k], tc = RT[k];
    let any = false;
    c.lineCap = 'butt'; c.lineJoin = 'round';
    c.setTransform(dpr, 0, 0, dpr, dpr * A.ox, dpr * A.oy); c.beginPath();
    for (const p of A.parts) {
      if (p.tieP && p.lt > 0.02) { c.moveTo(p.tieP[0], p.tieP[1]); c.lineTo(p.tieP[0] + p.dx, p.tieP[1] + p.dy); any = true; }
    }
    if (any) { c.setLineDash([10, 3, 2, 3]); c.lineWidth = 0.6; c.strokeStyle = COL.tie; c.stroke(); c.setLineDash([]); }
    for (const p of A.parts) drawPart(c, A, p, hc, tc);
    const ba = sstep(0.6, 0.8, A.e);
    if (ba > 0.01) drawBalloons(c, A, ba, hc);
  }
  function drawBalloons(c, A, ba, hc) {
    const r = 8.5;
    c.globalAlpha = ba; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '500 10px ' + MONO;
    for (const p of A.parts) {
      if (!p.bal) continue;
      c.setTransform(dpr, 0, 0, dpr, dpr * (A.ox + p.dx), dpr * (A.oy + p.dy));
      const ax = p.bal.at[0], ay = p.bal.at[1], bx = p.bal.b[0], by = p.bal.b[1], dx = ax - bx, dy = ay - by, l = Math.hypot(dx, dy) || 1;
      c.beginPath(); c.moveTo(bx + (dx / l) * r, by + (dy / l) * r); c.lineTo(ax, ay); c.lineWidth = 0.6; c.strokeStyle = hc; c.stroke();
      c.beginPath(); c.arc(ax, ay, 1.5, 0, TAU); c.fillStyle = hc; c.fill();
      c.beginPath(); c.arc(bx, by, r, 0, TAU); c.fillStyle = COL.bg; c.fill(); c.lineWidth = 0.8; c.stroke();
      c.fillStyle = COL.title; c.fillText(String(p.n), bx, by + 0.5);
    }
    if (A.bom) { // parts list under the view title
      c.setTransform(dpr, 0, 0, dpr, 0, 0); c.font = '9px ' + MONO; c.textBaseline = 'alphabetic';
      const list = A.bom.list;
      if (A.bom.x0 === null) {
        let wmax = 0;
        for (const q of list) wmax = Math.max(wmax, c.measureText(q.name).width);
        A.bom.x0 = Math.round(A.bom.x - (wmax + 20) / 2);
      }
      list.forEach((q, m) => {
        const y = A.bom.y + m * 12;
        c.fillStyle = COL.acc; c.textAlign = 'right'; c.fillText(String(q.n), A.bom.x0 + 8, y);
        c.fillStyle = COL.label; c.textAlign = 'left'; c.fillText(q.name, A.bom.x0 + 20, y);
      });
    }
    c.globalAlpha = 1;
  }
  function dimGeo(c, d, ox, oy, g) { // fills g with the dimension's lines and its label box (CSS px)
    const ax = ox + d.a[0], ay = oy + d.a[1], bx = ox + d.b[0], by = oy + d.b[1], L = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / L, uy = (by - ay) / L;
    const o = d.o, ol = Math.hypot(o[0], o[1]), nx = ol > 0.5 ? o[0] / ol : -uy, ny = ol > 0.5 ? o[1] / ol : ux;
    if (d.tw == null) { c.font = '600 10.5px ' + MONO; d.tw = c.measureText(d.t).width; c.font = '8.5px ' + MONO; d.nw = c.measureText(d.n).width; }
    const bw = Math.max(d.tw, d.nw) + 6, bh = 24, off = Math.abs(nx) * (bw / 2 + 4) + Math.abs(ny) * (bh / 2 + 3);
    g.ax = ax; g.ay = ay; g.bx = bx; g.by = by; g.ux = ux; g.uy = uy; g.nx = nx; g.ny = ny; g.ol = ol; g.L = L; g.inside = L >= 26;
    g.a2x = ax + o[0]; g.a2y = ay + o[1]; g.b2x = bx + o[0]; g.b2y = by + o[1]; g.bw = bw; g.bh = bh;
    g.cx = g.a2x + (g.b2x - g.a2x) * d.at + nx * off; g.cy = g.a2y + (g.b2y - g.a2y) * d.at + ny * off;
    return g;
  }
  function dimLines(c, g, al) {
    const nx = g.nx, ny = g.ny, ux = g.ux, uy = g.uy;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalAlpha = al; c.strokeStyle = c.fillStyle = COL.acc; c.lineWidth = 0.6; c.beginPath();
    if (g.ol > 0.5) {
      c.moveTo(g.ax + nx * 2, g.ay + ny * 2); c.lineTo(g.a2x + nx * 3, g.a2y + ny * 3);
      c.moveTo(g.bx + nx * 2, g.by + ny * 2); c.lineTo(g.b2x + nx * 3, g.b2y + ny * 3);
    }
    if (g.inside) { c.moveTo(g.a2x, g.a2y); c.lineTo(g.b2x, g.b2y); } else { c.moveTo(g.a2x - ux * 14, g.a2y - uy * 14); c.lineTo(g.b2x + ux * 14, g.b2y + uy * 14); }
    c.stroke();
    const s = g.inside ? 1 : -1;
    arrow(c, g.a2x, g.a2y, -ux * s, -uy * s); arrow(c, g.b2x, g.b2y, ux * s, uy * s);
    c.globalAlpha = 1;
  }
  function arrow(c, x, y, dx, dy) {
    c.beginPath(); c.moveTo(x, y); c.lineTo(x - dx * 7 - dy * 2, y - dy * 7 + dx * 2); c.lineTo(x - dx * 7 + dy * 2, y - dy * 7 - dx * 2); c.closePath(); c.fill();
  }
  function dimLabel(c, d, g, al) {
    const cx = g.cx, cy = g.cy;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalAlpha = al;
    c.fillStyle = COL.bg; c.fillRect(cx - g.bw / 2, cy - g.bh / 2, g.bw, g.bh);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = COL.acc; c.font = '600 10.5px ' + MONO; c.fillText(d.t, cx, cy - 5);
    c.fillStyle = COL.label; c.font = '8.5px ' + MONO; c.fillText(d.n, cx, cy + 7);
    c.globalAlpha = 1;
  }
  function drawDim(c, d, ox, oy, al) { dimGeo(c, d, ox, oy, G); dimLines(c, G, al); dimLabel(c, d, G, al); }
  function plateDims(c) { // reduced motion: the finished plate shows every dimension that fits; at small scales the minor ones give way
    const obs = [], kept = [], list = [];
    const hit = (u) => obs.some((o) => u.x < o.x + o.w && u.x + u.w > o.x && u.y < o.y + o.h && u.y + u.h > o.y);
    for (const A of AS) {
      if (A.e !== 1) continue;
      for (const p of A.parts) {
        if (p.bal) obs.push({ x: A.ox + p.dx + p.bal.b[0] - 10, y: A.oy + p.dy + p.bal.b[1] - 10, w: 20, h: 20 });
        for (const d of p.dims) list.push({ d, ox: A.ox + p.dx, oy: A.oy + p.dy });
      }
    }
    list.sort((u, v) => DIM_ORDER.indexOf(u.d.n) - DIM_ORDER.indexOf(v.d.n));
    for (const it of list) {
      const g = dimGeo(c, it.d, it.ox, it.oy, {}), b = { x: g.cx - g.bw / 2 - 3, y: g.cy - g.bh / 2 - 2, w: g.bw + 6, h: g.bh + 4 };
      if (g.L < 6 || hit(b)) continue;
      obs.push(b); kept.push(g); g.d = it.d;
    }
    for (const g of kept) dimLines(c, g, 1);
    for (const g of kept) dimLabel(c, g.d, g, 1);
  }
  function snap(v) { return (Math.round(v * dpr) + 0.5) / dpr; }
  function devW(lw) { return Math.max(1, Math.round(lw * dpr)); } // a CSS line weight as a whole number of device pixels
  function snapW(v, n) { return (Math.round(v * dpr) + (n & 1) / 2) / dpr; }
  function crispRect(c, x, y, w, h, lw) {
    const n = devW(lw);
    c.lineWidth = n / dpr;
    c.strokeRect(snapW(x, n), snapW(y, n), Math.round(w * dpr) / dpr, Math.round(h * dpr) / dpr);
  }
  function hid(x, y) { const t = LY.tb; return !!(t && x > t.x - 8 && x < t.x + t.w + 8 && y > t.y - 8 && y < t.y + t.h + 8); } // under the title block
  function zoneGeo() { return { zw: (Wd - 32) / 8, zh: (Ht - 32) / 6 }; }
  function drawSheet(c) {
    const g = zoneGeo(), hair = 1 / dpr, tw = devW(0.75);
    c.save(); c.beginPath(); c.rect(16, 16, Wd - 32, Ht - 32); c.clip();
    for (let pass = 0; pass < 2; pass++) {
      c.beginPath();
      for (let n = 0, x = 16; x < Wd - 16; x += 19, n++) if ((n % 5 === 0) === (pass === 1)) { c.moveTo(snap(x), 16); c.lineTo(snap(x), Ht - 16); }
      for (let n = 0, y = 16; y < Ht - 16; y += 19, n++) if ((n % 5 === 0) === (pass === 1)) { c.moveTo(16, snap(y)); c.lineTo(Wd - 16, snap(y)); }
      c.lineWidth = hair; c.strokeStyle = pass ? COL.gridMajor : COL.gridMinor; c.stroke();
    }
    c.restore();
    c.strokeStyle = COL.rule; crispRect(c, 12, 12, Wd - 24, Ht - 24, 0.75);
    crispRect(c, 16, 16, Wd - 32, Ht - 32, 1.5);
    c.beginPath();
    for (let j = 1; j < 8; j++) { const x = snapW(16 + j * g.zw, tw); c.moveTo(x, 12); c.lineTo(x, 22); c.moveTo(x, Ht - 12); c.lineTo(x, Ht - 22); }
    for (let j = 1; j < 6; j++) { const y = snapW(16 + j * g.zh, tw); c.moveTo(12, y); c.lineTo(22, y); c.moveTo(Wd - 12, y); c.lineTo(Wd - 22, y); }
    c.lineWidth = tw / dpr; c.stroke();
    c.font = '8.5px ' + MONO; c.fillStyle = COL.label; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let j = 0; j < 8; j++) zoneText(c, 'c', j);
    for (let j = 0; j < 6; j++) zoneText(c, 'r', j);
  }
  function zoneText(c, kind, j) {
    const g = zoneGeo();
    if (kind === 'c') {
      const s = String(j + 1), x = 16 + (j + 0.5) * g.zw;
      c.fillText(s, x, 25);
      if (!hid(x, Ht - 25)) c.fillText(s, x, Ht - 25);
    } else {
      const s = 'ABCDEF'[j], y = 16 + (j + 0.5) * g.zh;
      if (!hid(25, y)) c.fillText(s, 25, y);
      if (!hid(Wd - 25, y)) c.fillText(s, Wd - 25, y);
    }
  }
  function drawTitleBlock(c) {
    const t = LY.tb;
    if (!t) return;
    const x = t.x, y = t.y, w = t.w, h = t.h, r1 = snap(y + 26), r2 = snap(y + 26 + (h - 26) / 2), c1 = snap(x + 104), c2 = snap(x + 178);
    c.fillStyle = COL.bg; c.fillRect(x, y, w, h);
    c.strokeStyle = COL.rule; crispRect(c, x, y, w, h, 0.75);
    c.beginPath(); c.moveTo(x, r1); c.lineTo(x + w, r1); c.moveTo(x, r2); c.lineTo(x + w, r2);
    c.moveTo(c1, r1); c.lineTo(c1, y + h); c.moveTo(c2, r1); c.lineTo(c2, y + h); c.lineWidth = 1 / dpr; c.stroke();
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = COL.title; c.font = '600 11px ' + MONO; c.fillText('GABRIEL JAQUISH', x + 8, y + 17);
    c.textAlign = 'right'; c.fillStyle = COL.acc; c.fillText('GJ-000', x + w - 8, y + 17);
    c.textAlign = 'left';
    for (const q of [['TITLE', LY.title, x, r1], ['SCALE', 'AS NOTED', c1, r1], ['REV', 'A', c2, r1], ['SHEET', '1 OF 1', x, r2], ['DATE', '2026-10-16', c1, r2], ['DWN', 'GJ', c2, r2]]) {
      c.font = '6.5px ' + MONO; c.fillStyle = COL.label; c.fillText(q[0], q[2] + 6, q[3] + 8);
      c.font = '9.5px ' + MONO; c.fillStyle = COL.title; c.fillText(q[1], q[2] + 6, q[3] + 19);
    }
  }
  function drawNotes(c) {
    const n = LY.notes;
    if (!n) return;
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.font = '600 9px ' + MONO; c.fillStyle = COL.title; c.fillText('GENERAL NOTES', n.x, n.y);
    c.font = '8.5px ' + MONO; c.fillStyle = COL.label;
    NOTES.forEach((s, j) => c.fillText(s, n.x, n.y + 14 + j * 12));
  }
  function drawViewTitle(c, A) {
    if (!A.title) return;
    const x = A.title.x, y = A.title.y, t = A.def.letter + '  ' + A.def.title;
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.font = '600 10px ' + MONO; c.fillStyle = COL.title; c.fillText(t, x, y);
    const tw = c.measureText(t).width;
    c.beginPath(); c.moveTo(x - tw / 2, y + 5.5); c.lineTo(x + tw / 2, y + 5.5); c.lineWidth = 0.9; c.strokeStyle = COL.title; c.stroke();
    if (A.sub) { c.font = '8.5px ' + MONO; c.fillStyle = COL.label; c.fillText(scaleLine(A.scale, A.def), x, y + 18); }
  }
  function buildStatic() {
    staticDirty = false;
    const c = sctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = COL.bg; c.fillRect(0, 0, stat.width, stat.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSheet(c); drawTitleBlock(c); drawNotes(c);
    for (const A of AS) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawViewTitle(c, A);
      if (A.rest) drawAsm(c, A);
    }
  }
  function drawMachine(c) {
    const g = zoneGeo(), cx = clamp(Math.floor((mach.x - 16) / g.zw), 0, 7), ry = clamp(Math.floor((mach.y - 16) / g.zh), 0, 5);
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalAlpha = mach.a;
    // the arms break at the title block, the way they would at a taped-down sheet (and pass under the column);
    // the block sits against the right border, so the horizontal arm just stops there
    const tb = LY.tb, mx = snap(mach.x), my = snap(mach.y);
    const hEnd = tb && mach.y > tb.y && mach.y < tb.y + tb.h ? tb.x : Wd - 22;
    c.beginPath(); c.moveTo(22, my); c.lineTo(hEnd, my); c.moveTo(mx, 22);
    if (tb && mach.x > tb.x && mach.x < tb.x + tb.w) { c.lineTo(mx, tb.y); c.moveTo(mx, tb.y + tb.h); }
    c.lineTo(mx, Ht - 22);
    c.lineWidth = 1 / dpr; c.strokeStyle = COL.mach; c.stroke();
    c.beginPath(); c.moveTo(12, mach.y); c.lineTo(22, mach.y); c.moveTo(Wd - 12, mach.y); c.lineTo(Wd - 22, mach.y);
    c.moveTo(mach.x, 12); c.lineTo(mach.x, 22); c.moveTo(mach.x, Ht - 12); c.lineTo(mach.x, Ht - 22);
    c.lineWidth = 1.2; c.strokeStyle = COL.acc; c.stroke();
    const cxp = 16 + (cx + 0.5) * g.zw, ryp = 16 + (ry + 0.5) * g.zh;
    c.fillStyle = COL.bg; c.fillRect(cxp - 7, 18, 14, 14);
    if (!hid(cxp, Ht - 25)) c.fillRect(cxp - 7, Ht - 32, 14, 14);
    if (!hid(25, ryp)) c.fillRect(18, ryp - 7, 14, 14);
    if (!hid(Wd - 25, ryp)) c.fillRect(Wd - 32, ryp - 7, 14, 14);
    c.font = '700 9px ' + MONO; c.fillStyle = COL.acc; c.textAlign = 'center'; c.textBaseline = 'middle';
    zoneText(c, 'c', cx); zoneText(c, 'r', ry);
    c.globalAlpha = 1;
  }
  function draw() {
    if (staticDirty) buildStatic();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(stat, 0, 0);
    const gutters = LY.mode === 'margin';
    if (gutters) { // nothing that moves is painted under the reading column
      const k = LY.col;
      ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath(); ctx.rect(0, 0, k.l, Ht); ctx.rect(k.r, 0, Wd - k.r, Ht); ctx.clip();
    }
    for (const A of AS) if (!A.rest) drawAsm(ctx, A);
    if (mach.a > 0.004) drawMachine(ctx);
    if (reduced) { if (gutters) plateDims(ctx); }
    else if (dimSel && dimA > 0.01) drawDim(ctx, dimSel.d, dimSel.A.ox + dimSel.p.dx, dimSel.A.oy + dimSel.p.dy, dimA * sstep(0.12, 0.4, dimSel.A.e));
    if (gutters) ctx.restore();
  }

  /* ---------- motion ---------- */
  function prox(A) {
    if (!hover || !ptr.in || LY.mode !== 'margin') return 0;
    const r = A.hb, c = LY.col;
    const d = Math.hypot(Math.max(r.x - ptr.x, 0, ptr.x - r.x - r.w), Math.max(r.y - ptr.y, 0, ptr.y - r.y - r.h));
    // the column is for reading: the pull fades to nothing within 14 px of its edge, before the text starts
    const k = ptr.x > c.l && ptr.x < c.r ? 1 - sstep(0, 14, Math.min(ptr.x - c.l, c.r - ptr.x)) : 1;
    return k * sstep(240, 70, d);
  }
  function pickDim() {
    if (LY.mode !== 'margin') return false;
    const pr = hover ? (ptr.in ? ptr : null) : tap;
    if (!pr) return false;
    let bd = 48;
    pick.d = null;
    for (const A of AS) {
      if (A.e < 0.15) continue;
      for (const p of A.parts) {
        for (const d of p.dims) {
          for (let m = 0; m < 2; m++) { // the measured edge and the dimension line itself
            const ax = A.ox + p.dx + (m ? d.o[0] : 0) + d.a[0], ay = A.oy + p.dy + (m ? d.o[1] : 0) + d.a[1], vx = d.b[0] - d.a[0], vy = d.b[1] - d.a[1];
            const t = clamp(((pr.x - ax) * vx + (pr.y - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1), dd = Math.hypot(pr.x - ax - vx * t, pr.y - ay - vy * t);
            if (dd < bd) { bd = dd; pick.d = d; pick.A = A; pick.p = p; }
          }
        }
      }
    }
    return !!pick.d;
  }
  function frame(t) {
    raf = 0;
    if (dead) return;
    const dt = lastT ? Math.min(50, Math.max(1, t - lastT)) / 1000 : 1 / 60;
    let busy = false;
    lastT = t;
    if (W.innerWidth !== vw || W.innerHeight !== vh || pixelRatio() !== dpr) needLayout = true; // incl. a move to another display
    if (needLayout) { needLayout = false; layout(); }
    if (!reduced) {
      for (const A of AS) {
        const tg = Math.max(A.pinned ? 1 : 0, A.tour, prox(A));
        A.target = tg;
        if (A.e !== tg || A.v !== 0) {
          spr(A, 'e', 'v', tg, tour ? 6 : 11, dt);
          if (Math.abs(A.e - tg) < 0.002 && Math.abs(A.v) < 0.01) { A.e = tg; A.v = 0; } else busy = true;
        }
        const rest = A.e === 0 && tg === 0;
        if (rest !== A.rest) { A.rest = rest; staticDirty = true; }
        offsets(A); // this frame's part positions, for the dimension pick below
      }
      const margin = LY.mode === 'margin', ta = hover && ptr.in && margin ? 1 : 0;
      if (ptr.in && margin) {
        spr(mach, 'x', 'vx', ptr.x, 18, dt); spr(mach, 'y', 'vy', ptr.y, 18, dt);
        if (Math.abs(mach.x - ptr.x) < 0.2 && Math.abs(mach.y - ptr.y) < 0.2 && Math.abs(mach.vx) + Math.abs(mach.vy) < 4) {
          mach.x = ptr.x; mach.y = ptr.y; mach.vx = mach.vy = 0;
        } else busy = true;
      }
      if (mach.a !== ta) { mach.a += (ta - mach.a) * Math.min(1, dt * 9); if (Math.abs(ta - mach.a) < 0.01) mach.a = ta; else busy = true; }
      const cur = pickDim();
      if (cur && (!dimSel || pick.d !== dimSel.d)) { dimSel = { d: pick.d, A: pick.A, p: pick.p }; dimA = 0; }
      const td = cur ? 1 : 0;
      if (dimA !== td) { dimA += (td - dimA) * Math.min(1, dt * 12); if (Math.abs(td - dimA) < 0.02) dimA = td; else busy = true; }
      if (!cur && dimA === 0) dimSel = null;
    }
    draw();
    if (busy) request(); else lastT = 0;
  }
  function request() { if (!raf && !dead && !D.hidden) raf = W.requestAnimationFrame(frame); }

  /* ---------- idle inspection tour: one cycle, then silence ---------- */
  function armIdle() { // pointer: after 8 s of stillness; touch: once, shortly after load
    if (reduced || dead || idleT || tour || toured) return;
    idleT = hover ? W.setTimeout(checkIdle, 8000) : W.setTimeout(startTour, 1800);
  }
  function checkIdle() {
    idleT = 0;
    const gap = now() - ptr.last;
    if (gap < 7990) { idleT = W.setTimeout(checkIdle, 8000 - gap); return; }
    startTour();
  }
  function startTour() {
    idleT = 0;
    if (dead || reduced || !AS.length) return;
    tour = { i: 0 };
    tourStep();
  }
  function tourStep() {
    tourT = 0;
    if (!tour) return;
    if (tour.i >= AS.length * 2) { endTour(true); return; }
    const A = AS[tour.i >> 1], on = !(tour.i & 1);
    A.tour = on ? 1 : 0; tour.i++;
    tourT = W.setTimeout(tourStep, on ? 4400 : 1300);
    request();
  }
  function endTour(done) {
    if (tourT) W.clearTimeout(tourT);
    tourT = 0;
    if (tour) { for (const A of AS) A.tour = 0; tour = null; request(); }
    if (done) toured = true;
  }

  /* ---------- input ---------- */
  function onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    if (!ptr.in && mach.a === 0) { mach.x = e.clientX; mach.y = e.clientY; mach.vx = mach.vy = 0; }
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.in = true; ptr.last = now();
    toured = false;
    if (tour) endTour(false);
    armIdle();
    if (LY.mode === 'margin') request(); // full-bleed, the pointer only matters to the idle timer
  }
  function onOut(e) { if (!e.relatedTarget && ptr.in) { ptr.in = false; request(); } }
  function onDown(e) { // primary button only: a right-click opens the context menu, it doesn't pin
    if (e.isPrimary === false || e.button > 0) { down = null; return; }
    down = { x: e.clientX, y: e.clientY, t: now() };
  }
  function onCancel() { down = null; }
  function onUp(e) { // a click or tap on open background pins (or unpins) the nearest view
    const d = down;
    down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 6 || now() - d.t >= 500) return;
    if (e.target !== D.body && e.target !== D.documentElement) return;
    try { const sel = W.getSelection(); if (sel && !sel.isCollapsed) return; } catch { /* no selection API */ }
    const x = e.clientX, y = e.clientY;
    let best = null, bd = 1e9;
    for (const A of AS) {
      const r = A.hb, dd = Math.hypot(Math.max(r.x - x, 0, x - r.x - r.w), Math.max(r.y - y, 0, y - r.y - r.h));
      if (dd < bd) { bd = dd; best = A; }
    }
    if (!best) return;
    best.pinned = !best.pinned;
    if (e.pointerType && e.pointerType !== 'mouse') tap = { x, y }; // no hover: the tap picks the dimension to call out
    request();
  }
  function onResize() { needLayout = true; request(); }
  function onVis() {
    if (D.hidden) {
      if (raf) W.cancelAnimationFrame(raf);
      raf = 0;
      if (idleT) W.clearTimeout(idleT);
      idleT = 0;
      endTour(false);
      lastT = 0;
    } else {
      lastT = 0; ptr.last = now();
      armIdle(); request();
    }
  }

  const opt = { passive: true };
  const L = [[W, 'resize', onResize], [D, 'visibilitychange', onVis]];
  if (!reduced) L.push([W, 'pointermove', onMove], [W, 'pointerdown', onDown], [W, 'pointerup', onUp], [W, 'pointercancel', onCancel], [W, 'pointerout', onOut]);
  for (const [target, type, fn] of L) target.addEventListener(type, fn, opt);

  // A scrollbar appearing narrows the fixed canvas without a resize event.
  let ro = null;
  if (typeof W.ResizeObserver === 'function') {
    ro = new W.ResizeObserver(() => { if (canvas.clientWidth !== Wd || canvas.clientHeight !== Ht) { needLayout = true; request(); } });
    ro.observe(canvas);
  }

  layout();
  armIdle();
  request();

  return {
    destroy() {
      dead = true;
      if (raf) W.cancelAnimationFrame(raf);
      raf = 0;
      if (idleT) W.clearTimeout(idleT);
      idleT = 0;
      if (tourT) W.clearTimeout(tourT);
      tourT = 0; tour = null;
      for (const [target, type, fn] of L) target.removeEventListener(type, fn, opt);
      if (ro) ro.disconnect();
      ro = null;
      stat.width = stat.height = 0; // release the offscreen layer now rather than at GC
    },
  };
}
