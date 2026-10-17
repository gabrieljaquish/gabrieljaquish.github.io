// Wood grain ("Heartwood"): a flat-sawn board, seeded from a fixed board number, contoured as
// latewood/earlywood growth rings on a 5 px grid and drawn once. The pointer is a live knot: the grain
// parts around it like water around a stone, and when the pointer rests the knot closes into rings with a
// pith. Clicking open background plants a knot (kept in localStorage); "Plane it flat" clears them. Only
// the 40 px tiles that change are re-contoured each frame; at rest the page renders nothing.
//
// The content column runs the full height of the viewport on a ~90% panel, so the figure, the knots,
// the idle drift and the labels live in the gutters and the board is sanded down under the column.
// Narrow screens get a calm, evenly sanded full-bleed board.

const CELL = 5;                 // contour grid (CSS px)
const TC = 8;                   // cells per tile edge
const TILE = CELL * TC;         // dirty-tile size (40 px)
const NB = 12;                  // sanding bands: 1.0 outside -> 0.25 inside (fine enough that the feather has no steps)
const FEATHER = 60;
const FAM_OFF = [0, 0.3];       // ring level n (latewood edge) and n + 0.3 (latewood inner edge)
const FAM_W = [1.1, 0.5];
const FAM_A = [0.85, 0.55];
const C0 = 0.3;                 // calm core of a knot (fraction of R): grain parts around it
const C1 = 0.55;                // the knot's own closed rings live inside this fraction of R
const KMOVE = 0.6, KREST = 3.6; // live knot ring strength while moving / after resting
const R_LIVE = 110, R_DRIFT = 96;
const OM = 14;                  // spring stiffness (critically damped, ~140 ms)
const HN = 24, SIG = 28;        // heat trail samples, gaussian width
const HR = 1.6 * SIG;           // heat reach: beyond this a sample's glow is below the first ember step
const DRIFT_SPEED = 6, DRIFT_SECS = 12, DRIFT_MAX = 3, IDLE_MS = 6000;
// The board number: its first 16 hex digits seed everything, so every visit sees the same board.
const BOARD = '3f9a1c2d7e4b85a06c1f93e2b7a8d4c6e1f09b52';
const NARROW = 120;             // gutters narrower than this: calm full-bleed board
const COL_PAD = 4;              // sanded margin around the content column (it carries its own panel)
const NARROW_SAND = 0.6;        // even sanding level for the full-bleed board on narrow screens
const LABEL_BOTTOM = 112;       // label baseline above the viewport bottom: clear of the footer panel
const LABEL_TOP = 96;           // and below the header bar
const MAX_PLANTED = 12;
const STORE_KEY = 'gj.bg.grain.knots';
const FONT = '10.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
// marching squares: edge pairs per case (-2 = saddle). Edges: 0 top, 1 right, 2 bottom, 3 left.
const SA = [-1, 3, 0, 3, 1, -2, 0, 3, 3, 0, -2, 1, 3, 0, 3, -1];
const SB = [-1, 0, 1, 1, 2, -2, 2, 2, 2, 2, -2, 2, 1, 1, 0, -1];
const BAND_A = [];
for (let bi = 0; bi < NB; bi++) BAND_A.push(1 - 0.75 * bi / (NB - 1));

function rgb(h) {
  h = String(h || '#000').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const A = rgb(a), B = rgb(b);
  return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * t) + ',' + Math.round(A[1] + (B[1] - A[1]) * t) + ',' +
    Math.round(A[2] + (B[2] - A[2]) * t) + ')';
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash3(x, y, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function smooth(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }
function smoother(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10); }
function inOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(2 - 2 * t, 3) / 2; }
function outCubic(t) { return 1 - Math.pow(1 - t, 3); }
function perf() { return performance.now(); }

// A tiny tween: value v moves from a to b over d ms with easing fn.
function Tw(v) { return { v: v, a: v, b: v, t0: 0, d: 1, on: false, fn: inOut }; }
function twTo(T, b, d, now, fn) {
  if (T.b === b && (T.on || T.v === b)) return;
  T.a = T.v; T.b = b; T.t0 = now; T.d = d; T.on = true; T.fn = fn || inOut;
}
function twStep(T, now) {
  if (!T.on) return;
  const t = (now - T.t0) / T.d;
  if (t >= 1) { T.v = T.b; T.on = false; } else T.v = T.a + (T.b - T.a) * T.fn(t);
}

// Ember colors for the four heat steps of the trail, all from the palette. Dark: the accent cooling
// toward red and black channel by channel, like a coal. Light: one scorch brown (accent, a third of the
// way to ink), stronger with heat.
// [red scale, green exponent, blue exponent, alpha] per step; the hottest step is the accent itself.
const EMBER = [[0.375, 1.87, 2.1, 0.35], [0.575, 2.45, 3.72, 0.5], [0.817, 3.39, 6.33, 0.66], [1, 1, 1, 0.8]];
const SCORCH_A = [0.16, 0.27, 0.4, 0.54];
function heatRamp(pal, isDark) {
  const A = rgb(pal.accent);
  if (isDark) {
    return EMBER.map(([k, pg, pb, alpha]) => ({
      color: `rgb(${Math.round(A[0] * k)},${Math.round(A[1] * k ** pg)},${Math.round(A[2] * k ** pb)})`,
      alpha,
    }));
  }
  const I = rgb(pal.ink), Fa = rgb(pal.faint);
  const c = A.map((a, j) => Math.round((a + (I[j] - a) * 0.35) * 0.9 + Fa[j] * 0.1));
  return SCORCH_A.map((alpha) => ({ color: `rgb(${c[0]},${c[1]},${c[2]})`, alpha }));
}

/**
 * Mount the wood grain background.
 * @param {HTMLCanvasElement} canvas
 * @param {import('./types').BackgroundOptions} options
 * @returns {import('./types').Background}
 */
export function mount(canvas, options) {
  const isDark = !!options.isDark, reduced = !!options.reducedMotion;
  const pal = options.palette;
  const ctx = canvas.getContext('2d');
  function mq(q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } }
  const coarse = mq('(pointer: coarse)'), noHover = mq('(hover: none)') || coarse;

  const GRAIN = mix(pal.faint, pal.ink, isDark ? 0.09 : 0.16);
  const FLECK = mix(pal.faint, pal.ink, isDark ? 0.16 : 0.34);
  const PITH = mix(pal.faint, pal.ink, isDark ? 0.3 : 0.55);
  const HEAT = heatRamp(pal, isDark);
  const TAU = isDark ? 1500 : 3000;
  const LABEL_A = isDark ? 0.54 : 0.66; // ~4.6:1 or better against the sanded patch, both palettes

  // ---- seed: the first 16 hex chars of the board number become the mulberry32 state ---------------
  const hex = (BOARD + '0000000000000000').slice(0, 16);
  const seed = (parseInt(hex.slice(0, 8), 16) ^ Math.imul(parseInt(hex.slice(8, 16), 16) | 0, 0x9E3779B1)) >>> 0;
  const rnd = mulberry32(seed);
  const P = {
    s: 6.6 + rnd() * 3,            // ring spacing (px)
    A: 10 + rnd() * 16,            // warp amplitude (px)
    side: rnd() < 0.5 ? 0 : 1,     // which gutter holds the cathedral
    xcT: rnd(),
    h: 170 + rnd() * 140,          // cathedral tip roundness (distance of the saw cut from the pith)
    b: 0.12 + rnd() * 0.08,        // log taper near the figure: spacing of the stacked cathedral arches
    wc: 190 + rnd() * 110,         // half-width of the cathedral figure; grain runs straight beyond it
    ray: 1 / (1150 + rnd() * 650), // ray fleck density (per px^2)
    lat: (rnd() * 4294967296) >>> 0,
    ring: (rnd() * 4294967296) >>> 0,
    dside: rnd(), dphase: rnd() * 6.283
  };
  const KN = [], nk = rnd() < 0.5 ? 2 : 3;
  for (let i = 0; i < nk; i++) {
    const kr = 58 + rnd() * 36;
    KN.push({ u: rnd(), v: rnd(), R: kr, k: 3 + rnd() * Math.max(0.3, Math.min(5.5, 0.056 * kr) - 3) });
  }
  // warp lattices (64 x 64 value noise) and per-ring width jitter
  const lr = mulberry32(P.lat), L1 = new Float32Array(4096), L2 = new Float32Array(4096), L3 = new Float32Array(4096);
  for (let i = 0; i < 4096; i++) { L1[i] = lr() * 2 - 1; L2[i] = lr() * 2 - 1; L3[i] = lr() * 2 - 1; }
  const RING_OFF = 64, RING_N = 1024, ringD = new Float32Array(RING_N);
  (function () {
    let rr = mulberry32(P.ring), spell = 0, spellT = 0;
    for (let j = 0; j < RING_N; j++) {
      if (j % 5 === 0) spellT = (rr() * 2 - 1) * 0.09; // runs of good and lean years
      spell += (spellT - spell) * 0.4;
      ringD[j] = (rr() * 2 - 1) * 0.15 + spell;
    }
  })();

  function vn(L, x, y) {
    let xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = xi & 63, y0 = (yi & 63) << 6, x1 = (x0 + 1) & 63, y1 = ((yi + 1) & 63) << 6;
    const a = L[y0 + x0], b = L[y0 + x1], c = L[y1 + x0], d = L[y1 + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  // ---- state ---------------------------------------------------------------------------------------
  let dpr = 1, W = 0, H = 0, cols = 0, rows = 0, NX = 0, NY = 0, TX = 0, TY = 0;
  let base0, baseRaw, F, nodeStamp, cellStamp, cellBand, tileMark, tileStamp, allTiles = [], BW = 0, blkStamp, blkHeat;
  let drawId = 0, markId = 1, heatStampId = 1, heatStamp = null;
  // col: the sanded band around the content column; gl/gr: gutter widths; narrow: no usable gutters
  let col = { l: 0, r: 0 }, gl = 0, gr = 0, narrow = false, colKey = '', xc = 0, h2 = P.h * P.h;
  let knots = [];               // static knots: seeded, planted, dying
  const labels = { showL: false, showR: false, y: 0, lx: 0, lw: 0, rx: 0, rw: 0, hover: false, rightOn: false,
    left: 'Board ' + BOARD.slice(0, 7) + ', flat-sawn', right: 'Plane it flat' };
  let charPat = null;
  let raf = 0, lastT = 0, lastDraw = 0, destroyed = false, hidden = !!document.hidden;
  let lastMove = -1e9, idleTimer = 0, idleDue = 0, rzTimer = 0, ro = null;
  let dirty = [], pend = [], prevHeat = [];
  let hx = new Float32Array(HN), hy = new Float32Array(HN), ht = new Float64Array(HN), hHead = 0, hCount = 0;
  let warm = [], down = null;
  let driftOn = false, driftT0 = 0, driftCycles = 0, driftS = 0, driftS0 = 0, dp = null;

  function makeLive(R) {
    return { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, settled: true, R: R, e: 1.15, st: 1, dx: 1, dy: 0, curl: 0,
      gx: 0, gy: 1, gm: 1 / P.s, kt: Tw(KMOVE), pt: Tw(0), amp: 0, kk: KMOVE, hx: 0, hy: 0, sig: null, drawn: null };
  }
  const ptr = makeLive(R_LIVE), drift = makeLive(R_DRIFT), lives = [ptr, drift];

  // ---- the field ----------------------------------------------------------------------------------
  // Flat-sawn figure: a plane cut at distance h from the pith of a tapered log. Rings are
  // a = sqrt(X^2 + h^2) - b*y, giving nested arches that point up the board. The taper is kept local to
  // the figure (falls off over wc) so the grain beyond it runs straight down the board.
  const iwc2 = 1 / (P.wc * P.wc);
  function f0(x, y) {
    const wx = P.A * (vn(L1, x * 0.0042, y * 0.0019) + 0.3 * vn(L2, x * 0.012, y * 0.0048));
    const wy = 0.6 * P.A * vn(L3, x * 0.003, y * 0.0024);
    const X = x + wx - xc;
    return (Math.sqrt(X * X + h2) - P.b * (y + wy - H * 0.5) / (1 + X * X * iwc2)) / P.s;
  }
  function remap(f) { // uneven years: piecewise-linear, monotone re-labelling of ring levels
    const m = Math.floor(f), j = m + RING_OFF;
    if (j < 0 || j >= RING_N - 1) return f;
    const d0 = ringD[j];
    return f + d0 + (f - m) * (ringD[j + 1] - d0);
  }
  // the knot's own ring profile: (1 - v)^2 with a rounded crown, so the innermost rings stay resolvable
  const EPS = 0.2, EPSN = 1 / (Math.sqrt(1 + EPS * EPS) - EPS);
  function ring(v) { const r = 1 - (Math.sqrt(v * v + EPS * EPS) - EPS) * EPSN; return r * r; }
  function makeKnot(x, y, R, k, grow) {
    const K = { x: x, y: y, R: R, kk: k, e: 1.35, st: 1, dx: 1, dy: 0, curl: 0, gx: 0, gy: 1, gm: 1 / P.s, gt: Tw(grow), amp: grow, dying: false, seeded: false };
    orient(K);
    return K;
  }
  function orient(K) { // grain direction at the knot comes from the unknotted board
    const gx = (f0(K.x + 2, K.y) - f0(K.x - 2, K.y)) / 4, gy = (f0(K.x, K.y + 2) - f0(K.x, K.y - 2)) / 4;
    const m = Math.sqrt(gx * gx + gy * gy) || 1e-6;
    K.gx = gx / m; K.gy = gy / m; K.gm = m;
    box(K);
  }
  // A knot: inside C0*R the board's own gradient is removed (a calm core the grain flows around), and a
  // ring bump kk*ring(u/C1) draws the knot's own closed rings. Compact support: exactly zero beyond R, so
  // a re-contoured patch joins the untouched board without seams. Live knots add a stretch along the
  // direction of travel and a flame-figure curl in the knot's shoulder.
  function delta(K, px, py) {
    let qx = px - K.x, qy = py - K.y;
    if (qx < -K.hx || qx > K.hx || qy < -K.hy || qy > K.hy) return 0;
    if (K.st > 1.001) {
      const c = (qx * K.dx + qy * K.dy) * (1 - 1 / K.st);
      qx -= K.dx * c; qy -= K.dy * c;
    }
    const a = qx * K.gx + qy * K.gy, t = qy * K.gx - qx * K.gy;
    const u2 = (a * a + t * t * K.ie2) * K.iR2;
    if (u2 >= 1) return 0;
    const u = Math.sqrt(u2);
    const w = u <= C0 ? 1 : 1 - smoother((u - C0) / (1 - C0));
    const hh = u < C1 ? ring(u / C1) : 0;
    let ar = a;
    if (K.curl !== 0) { const om = 1 - u2, th = K.curl * om * om; ar = a * Math.cos(th) - t * Math.sin(th); }
    return K.amp * (K.kk * hh + K.gm * (ar * (1 - w) - a));
  }
  function box(K) { // bbox of the support ellipse (R across the grain, R*e along it), stretched by st
    K.ie2 = 1 / (K.e * K.e); K.iR2 = 1 / (K.R * K.R);
    const R = K.R, Re = K.R * K.e, s1 = K.st - 1;
    let ax = K.gx * R, ay = K.gy * R, bx = -K.gy * Re, by = K.gx * Re;
    const pa = (ax * K.dx + ay * K.dy) * s1, pb = (bx * K.dx + by * K.dy) * s1;
    ax += K.dx * pa; ay += K.dy * pa; bx += K.dx * pb; by += K.dy * pb;
    K.hx = Math.sqrt(ax * ax + bx * bx) + CELL;
    K.hy = Math.sqrt(ay * ay + by * by) + CELL;
  }
  function rawAt(x, y) {
    const fx = Math.max(0, Math.min(cols - 0.001, x / CELL)), fy = Math.max(0, Math.min(rows - 0.001, y / CELL));
    const cx = fx | 0, cy = fy | 0, ux = fx - cx, uy = fy - cy, n = cy * NX + cx;
    const a = baseRaw[n], b = baseRaw[n + 1], c = baseRaw[n + NX], d = baseRaw[n + NX + 1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  // ---- layout and bake ------------------------------------------------------------------------------
  function viewSize() { // the canvas is fixed to the viewport (minus any scrollbar)
    const w = canvas.clientWidth || window.innerWidth || 1, h = canvas.clientHeight || window.innerHeight || 1;
    return [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))];
  }
  function readColumn() {
    let c = null;
    try { c = options.column(); } catch (e) { c = null; }
    const l = c && isFinite(c.left) ? c.left : 0, r = c && isFinite(c.right) ? c.right : 0;
    return [l, r];
  }
  function layoutKey() {
    const v = viewSize(), c = readColumn();
    return [v[0], v[1], Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2), Math.round(c[0]), Math.round(c[1])].join(',');
  }
  let hasCol = true;
  function measure() {
    const c = readColumn();
    hasCol = c[1] - c[0] > 1;
    if (hasCol) { gl = Math.max(0, Math.min(W, c[0])); gr = Math.max(0, Math.min(W, W - c[1])); }
    else { gl = gr = W / 2; } // no column on this page: the whole board is open
    narrow = Math.max(gl, gr) < NARROW;
    col = { l: gl - COL_PAD, r: W - gr + COL_PAD };
    // provenance label and the 'Plane it flat' control: lower corners of the gutters, above the footer
    // panel and below the header bar, and only where they fit beside the column
    ctx.font = FONT;
    labels.lw = ctx.measureText(labels.left).width;
    labels.rw = ctx.measureText(labels.right).width;
    labels.y = H - LABEL_BOTTOM;
    // 20 px in from the edge, tightening to 12 px so a label still fits a modest gutter
    const inL = Math.max(12, Math.min(20, gl - 12 - labels.lw)), inR = Math.max(12, Math.min(20, gr - 12 - labels.rw));
    labels.lx = inL; labels.rx = W - inR - labels.rw;
    const room = !narrow && labels.y >= LABEL_TOP;
    labels.showL = room && labels.lx + labels.lw + 12 <= gl;
    labels.showR = room && labels.rx - 12 >= W - gr;
  }
  function sandAt(px, py) {
    let s = 1;
    if (narrow) s = NARROW_SAND;
    else if (hasCol) s = 0.25 + 0.75 * smooth(Math.max(col.l - px, 0, px - col.r) / FEATHER);
    // a small sanded patch under each label
    let ly = labels.y - 4, d1 = 1e9, d2 = 1e9;
    if (labels.showL) d1 = Math.hypot(Math.max(labels.lx - 8 - px, 0, px - labels.lx - labels.lw - 8), Math.max(ly - 10 - py, 0, py - ly - 8));
    if (labels.rightOn) d2 = Math.hypot(Math.max(labels.rx - 8 - px, 0, px - labels.rx - labels.rw - 8), Math.max(ly - 10 - py, 0, py - ly - 8));
    if (d1 < 1e9 || d2 < 1e9) s = Math.min(s, 0.3 + 0.7 * smooth(Math.min(d1, d2) / 22));
    return s;
  }
  function bandRect(x0, y0, x1, y1) { // sanding band per contour cell
    const cx0 = Math.max(0, Math.floor(x0 / CELL)), cy0 = Math.max(0, Math.floor(y0 / CELL));
    const cx1 = Math.min(cols - 1, Math.ceil(x1 / CELL)), cy1 = Math.min(rows - 1, Math.ceil(y1 / CELL));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++)
      cellBand[cy * cols + cx] = Math.round((1 - sandAt(cx * CELL + 2.5, cy * CELL + 2.5)) / 0.75 * (NB - 1));
  }
  function syncRight() { // the 'Plane it flat' patch is sanded only while the control is shown
    const on = labels.showR && activePlanted() > 0;
    if (on === labels.rightOn) return;
    labels.rightOn = on;
    const r = labelRect(), m = 30;
    bandRect(r[0] - m, r[1] - m, r[2] + m, r[3] + m);
    pend.push([r[0] - m, r[1] - m, r[2] + m, r[3] + m]);
  }
  // Planted knots remember which gutter they sit in and how far across it, so they stay in the
  // margins when the window changes size. Knots planted on a narrow screen map their half of the
  // board onto the matching gutter.
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function anchorAt(x, y) {
    const a = { g: 'n', f: 0, fx: clamp01(x / W), y: clamp01(y / H) };
    if (!narrow) {
      const cw = Math.max(1, W - gl - gr);
      if (x < gl) { a.g = 'l'; a.f = clamp01(x / Math.max(1, gl)); }
      else if (x > W - gr) { a.g = 'r'; a.f = clamp01((x - (W - gr)) / Math.max(1, gr)); }
      else { a.g = 'c'; a.f = clamp01((x - gl) / cw); }
    }
    return a;
  }
  function placeAnchored(K) {
    let a = K.at, x;
    if (narrow) x = a.fx * W;
    else if (a.g === 'l') x = a.f * gl;
    else if (a.g === 'r') x = W - gr + a.f * gr;
    else if (a.g === 'c') x = gl + a.f * (W - gl - gr);
    else x = a.fx < 0.5 ? gl * (0.15 + 1.4 * a.fx) : W - gr + gr * (0.15 + 1.4 * (a.fx - 0.5));
    K.x = x; K.y = a.y * H;
  }
  function placeKnots() {
    xc = !narrow
      ? ((P.side ? gr : gl) >= NARROW ? P.side : 1 - P.side) ? W - gr + gr * (0.3 + 0.4 * P.xcT) : gl * (0.3 + 0.4 * P.xcT)
      : W * (0.2 + 0.6 * P.xcT);
    const keep = [];
    for (let j = 0; j < knots.length; j++) if (!knots[j].seeded) keep.push(knots[j]);
    knots = [];
    for (let j = 0; j < KN.length; j++) {
      let s = KN[j], x, y, side = (j + P.side + 1) % 2, g = side ? gr : gl;
      if (!narrow && g >= NARROW) {
        x = side ? W - gr + g * (0.28 + 0.44 * s.u) : g * (0.28 + 0.44 * s.u);
        y = H * (0.16 + 0.68 * (j + s.v) / KN.length);
      } else { // narrow screens: spread down the board; behind the column they are sanded like everything else
        x = W * (side ? 0.62 + 0.3 * s.u : 0.08 + 0.3 * s.u);
        y = H * (0.14 + 0.72 * (j + 0.2 + 0.6 * s.v) / KN.length);
      }
      const K = makeKnot(x, y, s.R, s.k, 1); K.seeded = true; knots.push(K);
    }
    for (let j = 0; j < keep.length; j++) { placeAnchored(keep[j]); orient(keep[j]); knots.push(keep[j]); }
  }
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    const v = viewSize();
    W = v[0]; H = v[1];
    colKey = layoutKey();
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    cols = Math.ceil(W / CELL); rows = Math.ceil(H / CELL); NX = cols + 1; NY = rows + 1;
    TX = Math.ceil(cols / TC); TY = Math.ceil(rows / TC);
    const nn = NX * NY;
    base0 = new Float32Array(nn); baseRaw = new Float32Array(nn); F = new Float32Array(nn);
    nodeStamp = new Uint32Array(nn); cellStamp = new Uint32Array(cols * rows); cellBand = new Uint8Array(cols * rows);
    tileMark = new Uint32Array(TX * TY); tileStamp = new Uint32Array(TX * TY); heatStamp = new Uint32Array(TX * TY);
    BW = (cols >> 1) + 1; blkStamp = new Uint32Array(BW * ((rows >> 1) + 1)); blkHeat = new Float32Array(BW * ((rows >> 1) + 1));
    allTiles = []; for (let j = 0; j < TX * TY; j++) allTiles.push(j);
    measure();
    labels.rightOn = labels.showR && activePlanted() > 0;
    labels.hover = false;
    bandRect(0, 0, W, H);
    // the drift path belongs to the old layout: drop the drift knot; a later idle cycle re-seats it
    dp = null; driftOn = false; driftS = 0; drift.pt = Tw(0); drift.kt = Tw(KMOVE); drift.amp = 0; drift.settled = true;
    placeKnots();
    for (let n = 0, y = 0; y < NY; y++) for (let x = 0; x < NX; x++, n++) base0[n] = f0(x * CELL, y * CELL);
    rebuildRaw(0, 0, W, H);
    prevHeat = [];
    for (let j = 0; j < lives.length; j++) { lives[j].sig = null; lives[j].drawn = null; }
  }
  function rebuildRaw(x0, y0, x1, y1) {
    const cx0 = Math.max(0, Math.floor(x0 / CELL)), cy0 = Math.max(0, Math.floor(y0 / CELL));
    const cx1 = Math.min(NX - 1, Math.ceil(x1 / CELL)), cy1 = Math.min(NY - 1, Math.ceil(y1 / CELL));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      let n = cy * NX + cx, v = base0[n], px = cx * CELL, py = cy * CELL;
      for (let j = 0; j < knots.length; j++) if (knots[j].amp > 0) v += delta(knots[j], px, py);
      baseRaw[n] = v;
    }
  }
  function makeChar() {
    try {
      const c = document.createElement('canvas'); c.width = 256; c.height = 256;
      const g = c.getContext('2d'), r = mulberry32(seed ^ 0x5bd1e995);
      g.fillStyle = pal.ink;
      for (let j = 0; j < 700; j++) {
        g.globalAlpha = 0.02 + r() * 0.03;
        const sz = r() < 0.88 ? 1 : 2;
        g.fillRect((r() * 256) | 0, (r() * 256) | 0, sz, sz);
      }
      return ctx.createPattern(c, 'repeat');
    } catch (e) { return null; }
  }

  // ---- drawing: re-contour a set of tiles ----------------------------------------------------------
  const paths = [], used = new Uint8Array(2 * NB), hpaths = [], hused = new Uint8Array(8);
  let ex = 0, ey = 0;
  function edge(e, L, x0, y0, v0, v1, v2, v3) {
    if (e === 0) { ex = x0 + CELL * (L - v0) / (v1 - v0); ey = y0; }
    else if (e === 1) { ex = x0 + CELL; ey = y0 + CELL * (L - v1) / (v2 - v1); }
    else if (e === 2) { ex = x0 + CELL * (L - v3) / (v2 - v3); ey = y0 + CELL; }
    else { ex = x0; ey = y0 + CELL * (L - v0) / (v3 - v0); }
  }
  let PR = 4, nearPith = false, npx = 0, npy = 0, piths = [];
  // segments are chained into polylines when they continue the previous one (column-major scan)
  const lx = new Float64Array(2 * NB), ly = new Float64Array(2 * NB), hlx = new Float64Array(8), hly = new Float64Array(8);
  function put(p, X, Y, k, ax, ay, bx, by) {
    if (ax === X[k] && ay === Y[k]) p.lineTo(bx, by);
    else if (bx === X[k] && by === Y[k]) { p.lineTo(ax, ay); X[k] = ax; Y[k] = ay; return; }
    else { p.moveTo(ax, ay); p.lineTo(bx, by); }
    X[k] = bx; Y[k] = by;
  }
  function seg(pi, hk, ea, eb, L, x0, y0, v0, v1, v2, v3) {
    edge(ea, L, x0, y0, v0, v1, v2, v3);
    const ax = ex, ay = ey;
    edge(eb, L, x0, y0, v0, v1, v2, v3);
    if (nearPith) { // the grid cannot resolve the tiniest rings; the pith dot stands in for them
      const mx = (ax + ex) * 0.5 - npx, my = (ay + ey) * 0.5 - npy;
      if (mx * mx + my * my < PR * PR) return;
    }
    put(paths[pi], lx, ly, pi, ax, ay, ex, ey);
    if (hk >= 0) put(hpaths[hk], hlx, hly, hk, ax, ay, ex, ey);
  }
  function contourCell(cx, cy, hb) {
    const n = cy * NX + cx, v0 = F[n], v1 = F[n + 1], v2 = F[n + NX + 1], v3 = F[n + NX];
    const mn = Math.min(v0, v1, v2, v3), mx = Math.max(v0, v1, v2, v3);
    if (mx - mn < 1e-7) return;
    const band = cellBand[cy * cols + cx], x0 = cx * CELL, y0 = cy * CELL;
    nearPith = false;
    for (let q = 0; q < piths.length; q += 2) {
      const dx = x0 + 2.5 - piths[q], dy = y0 + 2.5 - piths[q + 1];
      if (dx * dx + dy * dy < 64) { nearPith = true; npx = piths[q]; npy = piths[q + 1]; break; }
    }
    for (let fam = 0; fam < 2; fam++) {
      const off = FAM_OFF[fam], lo = Math.ceil(mn - off), hi = Math.floor(mx - off);
      if (lo > hi) continue;
      const pi = fam * NB + band, hk = hb >= 0 ? fam * 4 + hb : -1;
      used[pi] = 1; if (hk >= 0) hused[hk] = 1;
      for (let lv = lo; lv <= hi; lv++) {
        const L = lv + off;
        const idx = (v0 >= L ? 1 : 0) | (v1 >= L ? 2 : 0) | (v2 >= L ? 4 : 0) | (v3 >= L ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        if (SA[idx] === -2) {
          const hiC = (v0 + v1 + v2 + v3) * 0.25 >= L;
          if ((idx === 5) === hiC) { seg(pi, hk, 0, 1, L, x0, y0, v0, v1, v2, v3); seg(pi, hk, 2, 3, L, x0, y0, v0, v1, v2, v3); }
          else { seg(pi, hk, 3, 0, L, x0, y0, v0, v1, v2, v3); seg(pi, hk, 1, 2, L, x0, y0, v0, v1, v2, v3); }
        } else seg(pi, hk, SA[idx], SB[idx], L, x0, y0, v0, v1, v2, v3);
      }
    }
  }
  function evalNodes(cx0, cy0, cx1, cy1) {
    const lp = ptr.pt.v > 0, ld = drift.pt.v > 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      let n = cy * NX + cx0, py = cy * CELL;
      for (let cx = cx0; cx <= cx1; cx++, n++) {
        if (nodeStamp[n] === drawId) continue;
        nodeStamp[n] = drawId;
        let v = baseRaw[n], px = cx * CELL;
        if (lp) v += delta(ptr, px, py);
        if (ld) v += delta(drift, px, py);
        F[n] = remap(v);
      }
    }
  }
  let locBuf = new Float32Array(HN * 3), locN = 0;
  function tileHeat(tx, ty) { // warm samples that can reach this tile (incl. its 1-cell margin)
    if (!warm.length) return null;
    const x0 = tx * TILE - CELL - HR, y0 = ty * TILE - CELL - HR, x1 = x0 + TILE + 2 * CELL + 2 * HR, y1 = y0 + TILE + 2 * CELL + 2 * HR;
    let n = 0;
    for (let j = 0; j < warm.length; j += 3) {
      if (warm[j] >= x0 && warm[j] <= x1 && warm[j + 1] >= y0 && warm[j + 1] <= y1) { locBuf[n++] = warm[j]; locBuf[n++] = warm[j + 1]; locBuf[n++] = warm[j + 2]; }
    }
    locN = n;
    return n ? locBuf : null;
  }
  const I4S2 = 1 / (4 * SIG * SIG);
  function heatSum(loc, px, py) {
    let hsum = 0;
    for (let j = 0; j < locN; j += 3) {
      const dx = px - loc[j], dy = py - loc[j + 1], d2 = dx * dx + dy * dy;
      if (d2 > HR * HR) continue;
      let g = 1 - d2 * I4S2;
      if (g > 0) { g *= g; hsum += g * g * loc[j + 2]; } // (1 - d^2/4s^2)^4 ~ exp(-d^2/s^2)
    }
    return hsum / 2.1;
  }
  function drawTiles(list, full) {
    if (!list.length || !W) return;
    drawId++;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    let bx0 = 0, by0 = 0, bx1 = canvas.width, by1 = canvas.height;
    if (!full) {
      list.sort(function (a, b) { return a - b; });
      const clip = new Path2D();
      bx0 = 1e9; by0 = 1e9; bx1 = -1e9; by1 = -1e9;
      for (let j = 0; j < list.length;) {
        let t0 = list[j], ty = (t0 / TX) | 0, k = j + 1;
        while (k < list.length && list[k] === list[k - 1] + 1 && ((list[k] / TX) | 0) === ty) k++;
        const tx0 = t0 % TX, tx1 = (list[k - 1] % TX) + 1;
        const X0 = Math.round(tx0 * TILE * dpr), Y0 = Math.round(ty * TILE * dpr);
        const X1 = Math.min(canvas.width, Math.round(tx1 * TILE * dpr)), Y1 = Math.min(canvas.height, Math.round((ty + 1) * TILE * dpr));
        clip.rect(X0, Y0, X1 - X0, Y1 - Y0);
        if (X0 < bx0) bx0 = X0; if (Y0 < by0) by0 = Y0; if (X1 > bx1) bx1 = X1; if (Y1 > by1) by1 = Y1;
        j = k;
      }
      ctx.clip(clip);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.bg; ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
    if (charPat) { ctx.fillStyle = charPat; ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    piths = [];
    for (let j = 0; j < knots.length; j++) if (knots[j].amp > 0.5) piths.push(knots[j].x, knots[j].y);
    for (let j = 0; j < lives.length; j++) if (lives[j].pt.v > 0.5 && lives[j].kt.v > 2) piths.push(lives[j].x, lives[j].y);
    for (let j = 0; j < 2 * NB; j++) { paths[j] = new Path2D(); used[j] = 0; lx[j] = NaN; }
    for (let j = 0; j < 8; j++) { hpaths[j] = new Path2D(); hused[j] = 0; hlx[j] = NaN; }
    // nodes, then cells (each tile plus a 1-cell margin so strokes bleed correctly across the clip edge)
    for (let j = 0; j < list.length; j++) {
      const ti = list[j], tx = ti % TX, tY = (ti / TX) | 0;
      evalNodes(Math.max(0, tx * TC - 1), Math.max(0, tY * TC - 1), Math.min(NX - 1, tx * TC + TC + 1), Math.min(NY - 1, tY * TC + TC + 1));
    }
    for (let j = 0; j < list.length; j++) {
      const ti = list[j], tx = ti % TX, tY = (ti / TX) | 0;
      const loc = tileHeat(tx, tY);
      const cx0 = Math.max(0, tx * TC - 1), cy0 = Math.max(0, tY * TC - 1), cx1 = Math.min(cols - 1, tx * TC + TC), cy1 = Math.min(rows - 1, tY * TC + TC);
      for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
        const ci = cy * cols + cx;
        if (cellStamp[ci] === drawId) continue;
        cellStamp[ci] = drawId;
        let hb = -1;
        if (loc) { // heat is sampled once per 2x2-cell block; sigma is 28 px so 10 px blocks are plenty
          const bi = (cy >> 1) * BW + (cx >> 1);
          if (blkStamp[bi] !== drawId) { blkStamp[bi] = drawId; blkHeat[bi] = heatSum(loc, (cx >> 1) * 10 + 5, (cy >> 1) * 10 + 5); }
          const hv = Math.min(blkHeat[bi], 1.5) * BAND_A[cellBand[ci]]; // a scribble cannot pile embers behind the column
          hb = hv < 0.1 ? -1 : hv < 0.28 ? 0 : hv < 0.52 ? 1 : hv < 0.8 ? 2 : 3;
        }
        contourCell(cx, cy, hb);
      }
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = GRAIN;
    for (let fam = 0; fam < 2; fam++) {
      ctx.lineWidth = FAM_W[fam];
      for (let b = 0; b < NB; b++) if (used[fam * NB + b]) { ctx.globalAlpha = FAM_A[fam] * BAND_A[b]; ctx.stroke(paths[fam * NB + b]); }
    }
    drawFlecks(list);
    drawPiths(full);
    for (let fam = 0; fam < 2; fam++) for (let b = 0; b < 4; b++) if (hused[fam * 4 + b]) {
      ctx.strokeStyle = HEAT[b].color; ctx.globalAlpha = HEAT[b].alpha * (fam ? 0.75 : 1);
      ctx.lineWidth = fam ? 0.6 : 1.25; ctx.stroke(hpaths[fam * 4 + b]);
    }
    drawLabels(full);
    ctx.restore();
  }
  function drawFlecks(list) {
    // short ray flecks laid along the local grain, from a hashed per-tile pattern; neighbours included
    let pA = new Path2D(), pB = new Path2D(), ua = 0, ub = 0, stamp = drawId;
    const per = TILE * TILE * P.ray;
    for (let j = 0; j < list.length; j++) {
      const tx = list[j] % TX, ty = (list[j] / TX) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const X = tx + ox, Y = ty + oy;
        if (X < 0 || Y < 0 || X >= TX || Y >= TY) continue;
        const ti = Y * TX + X;
        if (tileStamp[ti] === stamp) continue;
        tileStamp[ti] = stamp;
        for (let f = 0; f < 3; f++) {
          if (hash3(X, Y, f * 7 + 1) * 3 > per) continue;
          const px = X * TILE + hash3(X, Y, f * 7 + 2) * TILE, py = Y * TILE + hash3(X, Y, f * 7 + 3) * TILE;
          const cx = Math.min(cols - 1, (px / CELL) | 0), cy = Math.min(rows - 1, (py / CELL) | 0);
          const band = cellBand[cy * cols + cx];
          if (BAND_A[band] < 0.55) continue;
          const n = cy * NX + cx;
          evalNodes(cx, cy, cx + 1, cy + 1); // a neighbour tile's nodes may be stale: orient by the current field
          const gx =(F[n + 1] - F[n] + F[n + NX + 1] - F[n + NX]) * 0.5, gy = (F[n + NX] - F[n] + F[n + NX + 1] - F[n + 1]) * 0.5;
          const gm = Math.sqrt(gx * gx + gy * gy);
          if (gm < 0.12) continue; // no flecks in calm knot cores or wide cathedral tips
          const hl = hash3(X, Y, f * 7 + 4), len = 1.2 + hl * hl * 3.2, tx_ = -gy / gm * len, ty_ = gx / gm * len;
          const full_ = BAND_A[band] > 0.8, p = full_ ? pA : pB;
          p.moveTo(px - tx_, py - ty_); p.lineTo(px + tx_, py + ty_);
          if (full_) ua = 1; else ub = 1;
        }
      }
    }
    ctx.strokeStyle = FLECK; ctx.lineWidth = 1;
    if (ua) { ctx.globalAlpha = isDark ? 0.45 : 0.34; ctx.stroke(pA); }
    if (ub) { ctx.globalAlpha = isDark ? 0.22 : 0.17; ctx.stroke(pB); }
  }
  function inList(x, y, full) { return full || rectMarked(x - 4, y - 4, x + 4, y + 4); }
  function drawPiths(full) {
    ctx.fillStyle = PITH;
    for (let j = 0; j < knots.length; j++) {
      const K = knots[j];
      if (K.amp < 0.05 || !inList(K.x, K.y, full)) continue;
      pith(K.x, K.y, K.amp * (K.kk / 4.5));
    }
    for (let j = 0; j < lives.length; j++) {
      const L = lives[j];
      const tight = smooth((L.kt.v - KMOVE) / (KREST - KMOVE)) * L.pt.v;
      if (tight > 0.02 && inList(L.x, L.y, full)) pith(L.x, L.y, tight);
    }
  }
  function pith(x, y, a) {
    const cx = Math.max(0, Math.min(cols - 1, (x / CELL) | 0)), cy = Math.max(0, Math.min(rows - 1, (y / CELL) | 0));
    ctx.globalAlpha = Math.min(1, a) * 0.5 * BAND_A[cellBand[cy * cols + cx]];
    let p = new Path2D(); p.ellipse(x, y, 1.3, 1.6, 0, 0, 6.2832); ctx.fill(p);
    ctx.globalAlpha *= 0.3;
    p = new Path2D(); p.ellipse(x, y, 3, 3.6, 0, 0, 6.2832); ctx.fill(p);
  }
  function drawLabels(full) {
    const right = labels.showR && activePlanted() > 0;
    if (!labels.showL && !right) return;
    const y = labels.y;
    if (!full && !(labels.showL && rectMarked(labels.lx - 4, y - 12, labels.lx + labels.lw + 4, y + 6)) &&
      !(right && rectMarked(labels.rx - 4, y - 12, labels.rx + labels.rw + 4, y + 6))) return;
    ctx.font = FONT; ctx.textBaseline = 'alphabetic';
    if (labels.showL) { ctx.fillStyle = pal.ink; ctx.globalAlpha = LABEL_A; ctx.fillText(labels.left, labels.lx, y); }
    if (right) {
      ctx.fillStyle = labels.hover ? pal.accent : pal.ink;
      ctx.globalAlpha = labels.hover ? 0.95 : LABEL_A;
      ctx.fillText(labels.right, labels.rx, y);
      if (labels.hover) { ctx.fillRect(labels.rx, y + 3, labels.rw, 0.75); }
    }
  }
  function labelRect() { return [labels.rx - 8, labels.y - 14, labels.rx + labels.rw + 8, labels.y + 8]; }
  function overLabel(x, y) {
    if (!labels.showR || activePlanted() === 0) return false;
    const r = labelRect();
    return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  }

  // ---- dirty tracking ------------------------------------------------------------------------------
  function mark(x0, y0, x1, y1) {
    const tx0 = Math.max(0, Math.floor(x0 / TILE)), ty0 = Math.max(0, Math.floor(y0 / TILE));
    const tx1 = Math.min(TX - 1, Math.floor(x1 / TILE)), ty1 = Math.min(TY - 1, Math.floor(y1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * TX + tx;
      if (tileMark[i] !== markId) { tileMark[i] = markId; dirty.push(i); }
    }
  }
  function markBox(b) { if (b) mark(b[0], b[1], b[2], b[3]); }
  function markTile(i) { if (tileMark[i] !== markId) { tileMark[i] = markId; dirty.push(i); } }
  function rectMarked(x0, y0, x1, y1) {
    const tx0 = Math.max(0, Math.floor(x0 / TILE)), ty0 = Math.max(0, Math.floor(y0 / TILE));
    const tx1 = Math.min(TX - 1, Math.floor(x1 / TILE)), ty1 = Math.min(TY - 1, Math.floor(y1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (tileMark[ty * TX + tx] === markId) return true;
    return false;
  }
  function flush() { // draw everything marked since the last flush
    if (dirty.length) { drawTiles(dirty, false); lastDraw = perf(); }
    dirty = []; markId++;
  }
  function activePlanted() { let c = 0; for (let j = 0; j < knots.length; j++) if (!knots[j].seeded && !knots[j].dying) c++; return c; }

  // ---- frame loop ---------------------------------------------------------------------------------
  function wake() {
    if (raf || destroyed || reduced || hidden) return;
    raf = requestAnimationFrame(frame);
  }
  function updateLive(K, dt, now) {
    if (!K.settled) {
      const steps = dt > 0.02 ? 3 : 1, h = dt / steps;
      for (let j = 0; j < steps; j++) {
        const ax = OM * OM * (K.tx - K.x) - 2 * OM * K.vx, ay = OM * OM * (K.ty - K.y) - 2 * OM * K.vy;
        K.vx += ax * h; K.vy += ay * h; K.x += K.vx * h; K.y += K.vy * h;
      }
      if (Math.abs(K.tx - K.x) < 0.05 && Math.abs(K.ty - K.y) < 0.05 && K.vx * K.vx + K.vy * K.vy < 0.5) {
        K.x = K.tx; K.y = K.ty; K.vx = 0; K.vy = 0; K.settled = true;
      }
    }
    twStep(K.kt, now); twStep(K.pt, now);
    const sp = Math.sqrt(K.vx * K.vx + K.vy * K.vy);
    K.st = 1 + Math.min(sp / 600, 0.8);
    if (sp > 2) { K.dx = K.vx / sp; K.dy = K.vy / sp; }
    const gx = (rawAt(K.x + 4, K.y) - rawAt(K.x - 4, K.y)) / 8, gy = (rawAt(K.x, K.y + 4) - rawAt(K.x, K.y - 4)) / 8;
    const gm = Math.sqrt(gx * gx + gy * gy);
    if (gm > 1e-4) { K.gx = gx / gm; K.gy = gy / gm; }
    K.gm = gm;
    const side = K.gx * K.dy - K.gy * K.dx;
    K.curl = sp > 40 ? Math.min((sp - 40) / 1600, 0.5) * (side >= 0 ? 1 : -1) : 0;
    K.amp = K.pt.v; K.kk = K.kt.v;
    box(K);
  }
  function markLive(K) {
    const sig = [K.x, K.y, K.kt.v, K.pt.v, K.st, K.curl, K.gx, K.gy];
    let changed = !K.sig;
    if (K.sig) for (let j = 0; j < sig.length; j++) if (Math.abs(sig[j] - K.sig[j]) > 1e-3) { changed = true; break; }
    if (!changed) return;
    if (!K.sig && K.pt.v === 0 && !K.drawn) { K.sig = sig; return; }
    markBox(K.drawn);
    K.drawn = K.pt.v > 0 ? [K.x - K.hx, K.y - K.hy, K.x + K.hx, K.y + K.hy] : null;
    markBox(K.drawn);
    K.sig = sig;
  }
  function driftPath(s) { // a seeded, slow S-curve along the grain in a margin
    return [dp.x + dp.dx * DRIFT_SPEED * s + dp.nx * 9 * Math.sin(s * 0.33 + P.dphase),
      dp.y + dp.dy * DRIFT_SPEED * s + dp.ny * 9 * Math.sin(s * 0.33 + P.dphase)];
  }
  function startDrift(now) {
    if (reduced || driftOn || driftCycles >= DRIFT_MAX || !W) return;
    driftCycles++; driftOn = true; driftT0 = now; driftS0 = driftS;
    if (!dp) {
      let side = P.dside < 0.5 ? 0 : 1, x, y;
      if (!narrow) {
        if ((side ? gr : gl) < NARROW) side = 1 - side;
        x = side ? W - gr + gr * 0.5 : gl * 0.5;
        let best = -1;
        for (let c = 0.22; c < 0.75; c += 0.06) { // start where the margin is clear of other knots
          let dmin = 1e9;
          for (let j = 0; j < knots.length; j++) dmin = Math.min(dmin, Math.hypot(knots[j].x - x, knots[j].y - H * c) - knots[j].R);
          if (dmin > best) { best = dmin; y = H * c; }
        }
      } else { x = W * (0.3 + 0.4 * P.dside); y = H * 0.42; }
      const gx = (rawAt(x + 4, y) - rawAt(x - 4, y)), gy = (rawAt(x, y + 4) - rawAt(x, y - 4)), m = Math.hypot(gx, gy) || 1;
      let dx = -gy / m, dy = gx / m; if (dy < 0) { dx = -dx; dy = -dy; } // travel down the board, along the grain
      dp = { x: x, y: y, dx: dx, dy: dy, nx: -dy, ny: dx };
      const p0 = driftPath(0);
      drift.x = drift.tx = p0[0]; drift.y = drift.ty = p0[1];
      twTo(drift.pt, 1, 1600, now);
    }
    twTo(drift.kt, KMOVE, 700, now);
    wake();
  }
  function endDrift(now) {
    if (!driftOn) return;
    driftOn = false;
    twTo(drift.kt, KREST, 900, now);
    wake();
  }
  function checkIdle() {
    idleTimer = 0;
    if (destroyed) return;
    const now = perf();
    if (now < idleDue - 4) { idleTimer = setTimeout(checkIdle, idleDue - now); return; }
    if (hidden) return;
    startDrift(now);
  }
  function armIdle(delay) {
    if (reduced || driftCycles >= DRIFT_MAX) return;
    idleDue = perf() + delay;
    if (!idleTimer) idleTimer = setTimeout(checkIdle, delay);
  }
  function heatWarm(now) {
    warm = [];
    for (let j = 0; j < hCount; j++) {
      const age = now - ht[j];
      if (age < TAU) { const c = 1 - age / TAU; warm.push(hx[j], hy[j], c * c); }
    }
    return warm.length > 0;
  }
  function frame() {
    raf = 0;
    if (destroyed || hidden) return;
    const now = perf();
    const dt = lastT ? Math.min(0.05, Math.max(0.001, (now - lastT) / 1000)) : 1 / 60;
    // the slow drift and a cooling trail (4 quantized heat steps) only need ~30 fps once the pointer knot is still
    const slow = (driftOn || hCount > 0) && ptr.settled && !ptr.kt.on && !ptr.pt.on && !pend.length && !growing() &&
      (driftOn || (drift.settled && !drift.kt.on && !drift.pt.on));
    if (slow && now - lastDraw < 31) { raf = requestAnimationFrame(frame); return; }
    lastT = now;
    // pointer knot tightens after a 400 ms rest
    if (ptr.pt.b === 1 && ptr.kt.b !== KREST && now - lastMove > 400) twTo(ptr.kt, KREST, 600, now);
    if (driftOn) {
      const el = (now - driftT0) / 1000;
      if (el >= DRIFT_SECS) { driftS = driftS0 + DRIFT_SECS; endDrift(now); }
      else driftS = driftS0 + el;
      const p = driftPath(driftS); drift.tx = p[0]; drift.ty = p[1]; drift.settled = false;
    }
    for (let j = 0; j < lives.length; j++) updateLive(lives[j], dt, now);
    // planted knots growing in or planing away
    let gone = false;
    for (let j = 0; j < knots.length; j++) {
      const K = knots[j];
      if (!K.gt.on) continue;
      twStep(K.gt, now); K.amp = K.gt.v;
      rebuildRaw(K.x - K.hx, K.y - K.hy, K.x + K.hx, K.y + K.hy);
      mark(K.x - K.hx, K.y - K.hy, K.x + K.hx, K.y + K.hy);
      if (K.dying && !K.gt.on) gone = true;
    }
    if (gone) knots = knots.filter(function (k) { return !(k.dying && !k.gt.on); });
    for (let j = 0; j < lives.length; j++) markLive(lives[j]);
    // heat trail: tiles near warm samples, plus last frame's warm tiles so they cool back to bare grain
    for (let j = 0; j < prevHeat.length; j++) markTile(prevHeat[j]);
    if (heatWarm(now)) { prevHeat = warmTiles(); for (let j = 0; j < prevHeat.length; j++) markTile(prevHeat[j]); }
    else { prevHeat = []; hCount = 0; }
    for (let j = 0; j < pend.length; j++) markBox(pend[j]);
    pend = [];
    flush();
    if (live()) wake(); else lastT = 0;
  }
  function warmTiles() { // tiles currently touched by heat
    const out = [], r = HR + CELL;
    heatStampId++;
    for (let j = 0; j < warm.length; j += 3) {
      const tx0 = Math.max(0, Math.floor((warm[j] - r) / TILE)), tx1 = Math.min(TX - 1, Math.floor((warm[j] + r) / TILE));
      const ty0 = Math.max(0, Math.floor((warm[j + 1] - r) / TILE)), ty1 = Math.min(TY - 1, Math.floor((warm[j + 1] + r) / TILE));
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * TX + tx;
        if (heatStamp[i] !== heatStampId) { heatStamp[i] = heatStampId; out.push(i); }
      }
    }
    return out;
  }
  function growing() { for (let j = 0; j < knots.length; j++) if (knots[j].gt.on) return true; return false; }
  function live() {
    if (pend.length || prevHeat.length || growing()) return true;
    for (let j = 0; j < lives.length; j++) {
      const K = lives[j];
      if (!K.settled || K.kt.on || K.pt.on) return true;
    }
    if (ptr.pt.b === 1 && ptr.kt.b !== KREST) return true; // waiting out the 400 ms rest
    return driftOn;
  }

  // ---- planted knots ------------------------------------------------------------------------------
  // Planted knots persist per visitor (a convenience: the board works the same without storage).
  function save() {
    try {
      const out = [];
      for (let j = 0; j < knots.length; j++) {
        const K = knots[j], a = K.at;
        if (!K.seeded && !K.dying) out.push({ g: a.g, f: +a.f.toFixed(4), fx: +a.fx.toFixed(4), y: +a.y.toFixed(4), R: Math.round(K.R), k: K.kk });
      }
      window.localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch (e) { /* storage unavailable */ }
  }
  function load() {
    try {
      const arr = JSON.parse(window.localStorage.getItem(STORE_KEY) || '[]');
      if (!Array.isArray(arr)) return;
      for (let j = 0; j < arr.length && j < MAX_PLANTED; j++) {
        const o = arr[j];
        if (!o || !['l', 'r', 'c', 'n'].includes(o.g) || !isFinite(o.f) || !isFinite(o.fx) || !isFinite(o.y)) continue;
        const K = makeKnot(0, 0, Math.max(50, Math.min(95, +o.R || 70)), Math.max(2, Math.min(5, +o.k || 4)), 1);
        K.at = { g: o.g, f: clamp01(+o.f), fx: clamp01(+o.fx), y: clamp01(+o.y) };
        placeAnchored(K); orient(K);
        knots.push(K);
      }
    } catch (e) { /* ignore */ }
  }
  function knotRect(K) { return [K.x - K.hx, K.y - K.hy, K.x + K.hx, K.y + K.hy]; }
  function plant(x, y) {
    const now = perf();
    const K = makeKnot(x, y, 62 + Math.random() * 26, 4, 0);
    K.at = anchorAt(x, y);
    knots.push(K);
    twTo(K.gt, 1, reduced ? 1 : 900, now, outCubic);
    const planted = knots.filter(function (k) { return !k.seeded && !k.dying; });
    if (planted.length > MAX_PLANTED) retire(planted[0], now);
    settle(K);
    pend.push(labelRect());
    syncRight();
    save();
    afterChange();
  }
  function retire(K, now) { K.dying = true; twTo(K.gt, 0, reduced ? 1 : 700, now, inOut); settle(K); }
  function planeFlat() {
    const now = perf();
    // snapshot first: under reduced motion retire() removes knots from the array as it goes
    const list = knots.filter(function (k) { return !k.seeded && !k.dying; });
    for (let j = 0; j < list.length; j++) retire(list[j], now);
    labels.hover = false;
    pend.push(labelRect());
    syncRight();
    save();
    afterChange();
  }
  function settle(K) { // reduced motion: no transition, apply at once
    if (!reduced) return;
    K.gt.on = false; K.gt.v = K.gt.b; K.amp = K.gt.v;
    rebuildRaw(K.x - K.hx, K.y - K.hy, K.x + K.hx, K.y + K.hy);
    pend.push(knotRect(K));
    if (K.dying) knots = knots.filter(function (k) { return k !== K; });
  }
  function afterChange() {
    if (reduced || hidden) {
      if (hidden && !reduced) return; // drawn when the tab returns
      for (let j = 0; j < pend.length; j++) markBox(pend[j]);
      pend = [];
      flush();
    } else wake();
  }

  // ---- input ---------------------------------------------------------------------------------------
  function noteInput(now) {
    if (driftOn) endDrift(now);
    armIdle(IDLE_MS);
  }
  // Only the page background itself is clickable: never links, text, the header or the column panel.
  function isBackground(t) { return t === document.body || t === document.documentElement; }
  function onMove(e) {
    if (e.pointerType === 'touch') return; // touch-drag scrolls; no canvas work
    const x = e.clientX, y = e.clientY, now = perf();
    const hv = isBackground(e.target) && overLabel(x, y);
    if (hv !== labels.hover) { labels.hover = hv; pend.push(labelRect()); afterChange(); }
    if (reduced) return;
    // a resting hand jitters by a pixel or two: that should not undo a knot that has just closed
    if (ptr.kt.b === KREST && ptr.pt.b === 1 && Math.abs(x - ptr.tx) < 3 && Math.abs(y - ptr.ty) < 3) return;
    noteInput(now);
    if (ptr.pt.v === 0 && !ptr.pt.on) { ptr.x = x; ptr.y = y; ptr.vx = ptr.vy = 0; }
    ptr.tx = x; ptr.ty = y; ptr.settled = false;
    twTo(ptr.pt, 1, 350, now);
    lastMove = now;
    if (ptr.kt.b !== KMOVE) twTo(ptr.kt, KMOVE, 280, now);
    // heat samples, spaced ~12 px along the path
    const li = (hHead + HN - 1) % HN;
    if (hCount && now - ht[li] < TAU) {
      const dx = x - hx[li], dy = y - hy[li], d = Math.sqrt(dx * dx + dy * dy);
      if (d < 14) { wake(); return; }
      const steps = Math.min(6, Math.floor(d / 16));
      for (let s = 1; s < steps; s++) pushHeat(hx[li] + dx * s / steps, hy[li] + dy * s / steps, now);
    }
    pushHeat(x, y, now);
    wake();
  }
  function pushHeat(x, y, t) { hx[hHead] = x; hy[hHead] = y; ht[hHead] = t; hHead = (hHead + 1) % HN; hCount = Math.min(HN, hCount + 1); }
  function onOut(e) {
    if (e.relatedTarget || reduced) return;
    twTo(ptr.pt, 0, 450, perf());
    wake();
  }
  function hasSelection() {
    try { const sel = window.getSelection && window.getSelection(); return !!(sel && !sel.isCollapsed); } catch (e) { return false; }
  }
  function onDown(e) {
    // read the selection now: some engines collapse it on the dismissing press, before the click arrives
    down = { x: e.clientX, y: e.clientY, t: perf(), sel: hasSelection() };
    if (!reduced) noteInput(down.t);
  }
  function onClick(e) {
    const x = e.clientX, y = e.clientY, d = down;
    down = null;
    // a press that wandered (a drag, or one that merely ends on the label) never plants or planes
    if (!d || Math.hypot(x - d.x, y - d.y) >= 6 || perf() - d.t > 500) return;
    if (!isBackground(e.target)) return;
    if (d.sel || hasSelection()) return; // a click that clears a text selection is not a plant
    if (overLabel(x, y)) { planeFlat(); return; }
    plant(x, y);
  }
  function onResize() {
    if (rzTimer) clearTimeout(rzTimer);
    rzTimer = setTimeout(function () {
      rzTimer = 0;
      if (destroyed || layoutKey() === colKey) return; // e.g. a mobile URL bar that changed nothing we use
      layout();
      drawAll();
    }, 150);
  }
  function onVis() {
    hidden = !!document.hidden || document.visibilityState === 'hidden';
    if (hidden) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; }
      lastT = 0;
    } else {
      lastT = 0;
      if (!reduced) { armIdle(IDLE_MS); wake(); }
    }
  }
  function drawAll() {
    markId++;
    drawTiles(allTiles, true);
    for (let j = 0; j < lives.length; j++) { const K = lives[j]; K.sig = null; K.drawn = null; markLive(K); }
    dirty = []; markId++;
    lastDraw = perf();
  }

  // ---- mount ---------------------------------------------------------------------------------------
  layout();
  const seededN = knots.length;
  load();
  if (knots.length > seededN) { rebuildRaw(0, 0, W, H); syncRight(); pend = []; }
  if (isDark) charPat = makeChar();
  drawAll();
  const opt = { passive: true };
  if (!reduced) window.addEventListener('pointermove', onMove, opt);
  else if (!noHover) window.addEventListener('pointermove', onMove, opt); // label hover only
  window.addEventListener('pointerdown', onDown, opt);
  window.addEventListener('click', onClick, opt);
  window.addEventListener('pointerout', onOut, opt);
  window.addEventListener('resize', onResize, opt);
  document.addEventListener('visibilitychange', onVis, opt);
  // the canvas also changes size without a window resize, e.g. when a scrollbar appears
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(onResize); ro.observe(canvas); }
  if (!reduced) armIdle(noHover ? 1200 : IDLE_MS);

  return {
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (idleTimer) clearTimeout(idleTimer);
      if (rzTimer) clearTimeout(rzTimer);
      idleTimer = rzTimer = 0;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('click', onClick);
      window.removeEventListener('pointerout', onOut);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      if (ro) { ro.disconnect(); ro = null; }
    }
  };
}
