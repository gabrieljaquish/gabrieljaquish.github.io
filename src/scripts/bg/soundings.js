/**
 * Soundings: a chart of Lake Champlain behind the page, from Port Henry to Crown Point.
 *
 * Canvas 2D, no dependencies. The chart is the real one: /charts/port-henry.json, built by tools/lake-chart from
 * NOAA ENC US4NY1LS and US4NY1MS (soundings, buoys, lights, the bridge, dangers, names, magnetic variation) and the
 * USGS National Hydrography Dataset (shoreline), all public domain. Until it arrives only the paper is drawn; if it
 * cannot be had, the procedural lake below stands in. destroy() aborts the request.
 *
 * FRAMING. The lake at Port Henry is under 3 km wide, so fitting it to the viewport would put all of its water under
 * the content column. Instead the narrows (Port Henry's waterfront across to the Vermont shore at Crane and Chimney
 * Points) are scaled to span the column plus a quarter of each gutter: the shores, shoals, buoys and names sit in
 * the gutters and open water lies quiet under the prose. Scrolling the page pans the chart south along the lake,
 * toward Bulwagga Bay and Crown Point, at 0.35x. The static sheet is cached in an offscreen layer a little taller
 * than the viewport and repainted only when panned past that margin or on resize. Without gutters, the water near
 * Port Henry and the bridge is fitted across the width and the sheet stays calm.
 *
 * INTERACTION. The pointer is a depth sounder: soundings and isobath labels come up near it, and a chip on a leader
 * reads the charted depth there (bilinear over the 100 m grid's water cells). A click or tap on open water sends a
 * surface wave: fast marching over the depth grid gives each point's arrival time at the shallow-water speed
 * c = sqrt(g h), h being the charted depth plus the datum offset, and the crests are level sets of that field, so
 * they slow over the shoals, bend round the points and stop at the shore. Time is scaled so that a crest in 25 ft
 * of water crosses the viewport in about five seconds; relative speeds are as real. At rest nothing renders.
 *
 * THE CHART MODEL: all the renderer reads. fromData() builds it from the JSON, fromProcedural() from the generator.
 *   { w, h                       frame size in model units (metres for the real chart), x east, y down (north up)
 *     land: [ring]               land rings, filled even-odd. A ring is a flat [x0, y0, x1, y1, ...], implicitly closed
 *     coast: [{ p, closed }]     the shoreline to stroke (runs along the frame edge are left out)
 *     tints: [{ depth, rings }]  water deeper than depth, even-odd
 *     contours: [{ depth, lines: [{ p, closed }] }]
 *     soundings: [[x, y, ft]]    in priority order (every prefix is an even subset)
 *     depthAt(x, y)              charted depth in feet, < 0 on land or where unknown
 *     datumFt                    added to the charted depth for the wave speed
 *     features: [{ type, x, y, ring?, red?, lit?, txt? }]   aids, dangers, the bridge, landmarks
 *     names: [{ t, x, y, k, p, r }]                         k water | lake | land | town; p priority; r search px
 *     fit(frame) -> { s, x0, top }   px per unit, and the view's left and top edges (units) at scroll 0
 *     pan                        true when page scroll pans the chart
 *     title: { variants, credit }, varDeg, varText }        title block and compass rose
 */

const TAU = Math.PI * 2;
const DATA_URL = '/charts/port-henry.json';
// Framing of the real chart, in frame metres.
const BAND = [4300, 7050];                      // the narrows: Port Henry's shore, and Vermont's at Crane / Chimney Points
const FULL_BAND = [4100, 7300];                 // fitted across the whole width when there are no gutters
const FOCUS_Y = 9000;                           // view centre at the top of the page
const PARALLAX = 0.35;                          // chart px per page px scrolled
const TINT_FT = [6, 12];                        // shoal tint above 6 ft, mid tint 6-12 ft, paper deeper
const JOIN_M = 140;                             // isobath pieces cut where they touch the shore are rejoined
const GRAVITY = 9.81, FT_M = 0.3048;
const WCELL = 8;                                // wave grid spacing, CSS px
const CROSS_S = 5, REF_FT = 25;                 // a crest in 25 ft of water crosses the viewport in 5 s
const LIFE = 6.5, GAP = 0.28, MAX_PULSES = 3;
const LENS_R = 64;
const NARROW = 120;                             // gutters narrower than this: calm full-bleed sheet
const TOP_CLEAR = 80;                           // the header bar
const BOTTOM_CLEAR = 100;                       // the footer bar (sits at the viewport bottom on short pages)
// The procedural fallback.
const LEVELS = [0, 10, 20, 50, 100, 200, 300];
const TINT_LEVELS = [10, 20];
const CELL = 8;
const SEED = 'gabrieljaquish.com|soundings';
const SERIF = 'ui-serif, "Iowan Old Style", Georgia, "Times New Roman", serif';
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';
const SFONT = 'italic 10px ' + SERIF;
const LFONT = 'italic 8.5px ' + SERIF;          // aid and danger labels
/** @type {Record<string, { f: string, px: number, ls: number, a: number }>} */
const NAME_STYLE = {
  water: { f: 'italic 11.5px ' + SERIF, px: 11.5, ls: 0.3, a: 0.6 },
  lake: { f: 'italic 11px ' + SERIF, px: 11, ls: 2.6, a: 0.5 },
  land: { f: '11px ' + SERIF, px: 11, ls: 0.2, a: 0.66 },
  town: { f: '600 9.5px ' + SERIF, px: 9.5, ls: 1.8, a: 0.68 },
};
// Place names worth setting: priority (lower first), room to look for a clean spot (px), display text and style.
/** @type {Record<string, { p: number, r?: number, t?: string, k?: string }>} */
const PLACE = {
  'Port Henry': { p: 0, t: 'PORT HENRY', k: 'town' },
  'Bulwagga Bay': { p: 0, r: 270 },
  'Crown Point': { p: 0, r: 200 },
  'Chimney Point': { p: 1 },
  'Crane Point': { p: 1 },
  'Hospital Creek': { p: 1 },
  'Lake Champlain': { p: 2, r: 440, t: 'LAKE CHAMPLAIN', k: 'lake' },
  'Fort Saint Frederic': { p: 2, t: 'Fort St. Frederic' },
  'Crown Point Fort': { p: 3 },
  'Orchard Point': { p: 3 },
  'D.A.R. State Park': { p: 3 },
  'Owls Head Bay': { p: 3 },
  'Plumies Point': { p: 3 },
};
const RADII = [0, 8, 16, 26, 38, 52, 68, 86, 106, 128, 152, 178, 206, 236, 268, 302, 340, 380, 420, 460];
// Marching squares: corner bits tl=8 tr=4 br=2 bl=1; edges top=0 right=1 bottom=2 left=3.
const SEG = [null, [3, 2], [2, 1], [3, 1], [0, 1], null, [0, 2], [3, 0], [3, 0], [0, 2], null, [0, 1], [3, 1], [2, 1], [3, 2], null];
const OFFS = [-10, 0, 10, 0, 0, -6, 0, 6, -8, -5, 8, -5, -8, 5, 8, 5]; // a sounding's whole label sits in one depth band
const DIM = [1, 0.75, 0.55, 0.4];               // crests fade to 40% under the content column

/** @typedef {{ t: string, f: string, ls: number, a: number, h: number }} TitleLine */
/** @typedef {{ variants: TitleLine[][], credit: TitleLine | null }} TitleSpec */
const TL = (/** @type {string} */ t, /** @type {string} */ f, /** @type {number} */ ls, /** @type {number} */ a, /** @type {number} */ h) => ({ t, f, ls, a, h });
/** @returns {TitleSpec} */
function realTitle(/** @type {string} */ datum) {
  const lll = 'AT LOW LAKE LEVEL' + (datum ? ' (' + datum + ' FT)' : '');
  const head = [TL('LAKE CHAMPLAIN', '600 11.5px ' + SERIF, 3.2, 0.84, 18), TL('PORT HENRY TO CROWN POINT', '9.5px ' + SERIF, 1.5, 0.7, 15)];
  const tail = [TL('NOT FOR NAVIGATION', '8px ' + MONO, 0.9, 0.5, 12)];
  return {
    variants: [
      head.concat([TL('SOUNDINGS IN FEET ' + lll, '8px ' + MONO, 0.4, 0.6, 12)], tail),
      head.concat([TL('SOUNDINGS IN FEET', '8px ' + MONO, 0.4, 0.6, 12), TL(lll, '8px ' + MONO, 0.4, 0.6, 12)], tail),
    ],
    credit: TL('NOAA · USGS', '7px ' + MONO, 1.2, 0.42, 10),
  };
}
/** @type {TitleSpec} */
const PROC_TITLE = {
  variants: [[TL('LAKE CHART', '600 11px ' + SERIF, 3.2, 0.82, 18), TL('SOUNDINGS IN FEET · NOT FOR NAVIGATION', '8.5px ' + MONO, 1, 0.6, 14)]],
  credit: null,
};

// ---------- small helpers ----------
function fnv1a(/** @type {string} */ s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry32(/** @type {number} */ a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(/** @type {number} */ ix, /** @type {number} */ iy, /** @type {number} */ s) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 2147483647.5 - 1;
}
function vnoise(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ s) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < 4; o++) { sum += amp * vnoise(x * f + o * 17.3, y * f - o * 9.1, s + o * 1013); norm += amp; amp *= 0.5; f *= 2.03; }
  return sum / norm;
}
function smooth(/** @type {number} */ e0, /** @type {number} */ e1, /** @type {number} */ x) { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
function smax(/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ k) { return (a + b + Math.sqrt((a - b) * (a - b) + k * k)) / 2; }
function clamp(/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) { return Math.min(Math.max(v, lo), hi); }
/** @param {{ x0: number, y0: number, x1: number, y1: number } | null} r */
function inR(r, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ p) { return !!r && x > r.x0 - p && x < r.x1 + p && y > r.y0 - p && y < r.y1 + p; }

// Colors: everything derives from the four palette colors (hex, as the stylesheet declares them).
/** @returns {number[]} */
function rgbOf(/** @type {any} */ c) {
  if (Array.isArray(c)) return c;
  const s = String(c || '').trim(), m = /^rgba?\(([^)]*)\)/i.exec(s);
  if (m) { const v = m[1].split(/[\s,/]+/).map(Number); return [v[0] || 0, v[1] || 0, v[2] || 0]; }
  let h = s.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function css(/** @type {number[]} */ c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }
function mix(/** @type {any} */ a, /** @type {any} */ b, /** @type {number} */ t) { const x = rgbOf(a), y = rgbOf(b); return [0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t); }
// Hue kept; saturation scaled; lightness remapped. Calibrated so the approved prototype's tints come out.
function shade(/** @type {any} */ c, /** @type {number} */ sMul, /** @type {(l: number) => number} */ lFn) {
  const [r, g, b] = rgbOf(c).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const S = clamp(s * sMul, 0, 1), L = clamp(lFn(l), 0, 1);
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q;
  const ch = (/** @type {number} */ t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p);
  };
  return S === 0 ? [L * 255, L * 255, L * 255] : [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)];
}

/** @returns {number[]} */
function chaikin(/** @type {number[]} */ p, /** @type {boolean} */ closed, /** @type {number} */ iters) {
  for (let it = 0; it < iters; it++) {
    const n = p.length / 2, q = [], m = closed ? n : n - 1;
    if (n < 3) return p;
    if (!closed) q.push(p[0], p[1]);
    for (let k = 0; k < m; k++) {
      const a = 2 * k, b = 2 * ((k + 1) % n);
      q.push(0.75 * p[a] + 0.25 * p[b], 0.75 * p[a + 1] + 0.25 * p[b + 1], 0.25 * p[a] + 0.75 * p[b], 0.25 * p[a + 1] + 0.75 * p[b + 1]);
    }
    if (!closed) q.push(p[2 * n - 2], p[2 * n - 1]);
    p = q;
  }
  return p;
}
function reversed(/** @type {number[]} */ p) {
  const q = new Array(p.length);
  for (let k = 0, n = p.length; k < n; k += 2) { q[n - 2 - k] = p[k]; q[n - 1 - k] = p[k + 1]; }
  return q;
}
function cumLen(/** @type {number[]} */ P) {
  const n = P.length / 2, c = new Float32Array(n);
  for (let k = 1; k < n; k++) c[k] = c[k - 1] + Math.hypot(P[2 * k] - P[2 * k - 2], P[2 * k + 1] - P[2 * k - 1]);
  return c;
}
/** @param {{ x: number, y: number, a: number, k: number }} out */
function pointAt(/** @type {number[]} */ P, /** @type {Float32Array} */ cum, /** @type {number} */ s, out) {
  let lo = 0, hi = cum.length - 1;
  if (hi < 1) { out.x = P[0]; out.y = P[1]; out.a = 0; out.k = 0; return out; }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1, t = Math.min(1, Math.max(0, (s - cum[lo]) / seg));
  const dx = P[2 * hi] - P[2 * lo], dy = P[2 * hi + 1] - P[2 * lo + 1];
  out.x = P[2 * lo] + dx * t; out.y = P[2 * lo + 1] + dy * t; out.a = Math.atan2(dy, dx); out.k = lo;
  return out;
}
function ringContains(/** @type {number[]} */ r, /** @type {number} */ x, /** @type {number} */ y) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Ring edges bucketed into horizontal bands, for fast even-odd point tests and scanlines.
/** @typedef {{ y0: number, band: number, lists: number[][] }} PolyIndex */
/** @returns {PolyIndex} */
function polyIndex(/** @type {number[][]} */ rings, /** @type {number} */ band) {
  let y0 = Infinity, y1 = -Infinity;
  for (const r of rings) for (let k = 1; k < r.length; k += 2) { if (r[k] < y0) y0 = r[k]; if (r[k] > y1) y1 = r[k]; }
  if (!(y1 >= y0)) return { y0: 0, band: 1, lists: [] };
  const nb = Math.floor((y1 - y0) / band) + 1, lists = [];
  for (let b = 0; b < nb; b++) lists.push(/** @type {number[]} */ ([]));
  for (const r of rings) {
    const n = r.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const ya = r[j + 1], yb = r[i + 1];
      if (ya === yb) continue;
      const b0 = Math.floor((Math.min(ya, yb) - y0) / band), b1 = Math.floor((Math.max(ya, yb) - y0) / band);
      for (let b = b0; b <= b1; b++) lists[b].push(r[j], ya, r[i], yb);
    }
  }
  return { y0, band, lists };
}
function idxInside(/** @type {PolyIndex} */ ix, /** @type {number} */ x, /** @type {number} */ y) {
  const b = Math.floor((y - ix.y0) / ix.band);
  if (!(b >= 0 && b < ix.lists.length)) return false;
  const e = ix.lists[b];
  let c = false;
  for (let k = 0; k < e.length; k += 4) {
    const ya = e[k + 1], yb = e[k + 3];
    if ((ya > y) !== (yb > y) && x < e[k] + ((e[k + 2] - e[k]) * (y - ya)) / (yb - ya)) c = !c;
  }
  return c;
}
function idxCross(/** @type {PolyIndex} */ ix, /** @type {number} */ y, /** @type {number[]} */ out) {
  out.length = 0;
  const b = Math.floor((y - ix.y0) / ix.band);
  if (!(b >= 0 && b < ix.lists.length)) return out;
  const e = ix.lists[b];
  for (let k = 0; k < e.length; k += 4) {
    const ya = e[k + 1], yb = e[k + 3];
    if ((ya > y) !== (yb > y)) out.push(e[k] + ((e[k + 2] - e[k]) * (y - ya)) / (yb - ya));
  }
  return out.sort((a, b) => a - b);
}

// ---------- marching squares (isobaths and wave crests) ----------
let EX = 0, EY = 0; // last edge crossing, in grid units
function edgeAt(/** @type {number} */ e, /** @type {number} */ i, /** @type {number} */ j, /** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ c, /** @type {number} */ d, /** @type {number} */ L) {
  let t;
  if (e === 0) { t = (L - a) / (b - a); EX = i + t; EY = j; }
  else if (e === 1) { t = (L - b) / (c - b); EX = i + 1; EY = j + t; }
  else if (e === 2) { t = (L - d) / (c - d); EX = i + t; EY = j + 1; }
  else { t = (L - a) / (d - a); EX = i; EY = j + t; }
}
function pairsFor(/** @type {number} */ idx, /** @type {boolean} */ centerIn) {
  if (idx === 5) return centerIn ? [[3, 0], [2, 1]] : [[0, 1], [3, 2]];
  if (idx === 10) return centerIn ? [[0, 1], [3, 2]] : [[3, 0], [2, 1]];
  return SEG[idx] ? [SEG[idx]] : null;
}
// Level-L lines of a grid field, chained into polylines (x0, y0: position of node 0; cell: spacing).
function isolines(/** @type {Float32Array} */ field, /** @type {number} */ gw, /** @type {number} */ gh, /** @type {number} */ L, /** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ cell) {
  const nE = 2 * gw * gh, ex = new Float32Array(nE), ey = new Float32Array(nE), sa = [], sb = [];
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    const n = j * gw + i, a = field[n], b = field[n + 1], c = field[n + gw + 1], d = field[n + gw];
    const idx = (a >= L ? 8 : 0) | (b >= L ? 4 : 0) | (c >= L ? 2 : 0) | (d >= L ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const pr = pairsFor(idx, (a + b + c + d) / 4 >= L), ids = [2 * n, 2 * (n + 1) + 1, 2 * (n + gw), 2 * n + 1];
    if (!pr) continue;
    for (let p = 0; p < pr.length; p++) {
      for (let q = 0; q < 2; q++) { const e = pr[p][q]; edgeAt(e, i, j, a, b, c, d, L); ex[ids[e]] = x0 + EX * cell; ey[ids[e]] = y0 + EY * cell; }
      sa.push(ids[pr[p][0]]); sb.push(ids[pr[p][1]]);
    }
  }
  const ns = sa.length, first = new Int32Array(nE).fill(-1), second = new Int32Array(nE).fill(-1), seen = new Uint8Array(ns), out = [];
  const link = (/** @type {number} */ e, /** @type {number} */ s) => { if (first[e] < 0) first[e] = s; else second[e] = s; };
  const other = (/** @type {number} */ e, /** @type {number} */ s) => (first[e] === s ? second[e] : first[e]);
  for (let s = 0; s < ns; s++) { link(sa[s], s); link(sb[s], s); }
  for (let s0 = 0; s0 < ns; s0++) {
    if (seen[s0]) continue;
    seen[s0] = 1;
    let chain = [sa[s0], sb[s0]], cur = s0, eg = sb[s0], closed = false, nx, e2;
    for (;;) {
      nx = other(eg, cur); if (nx < 0) break;
      if (seen[nx]) { closed = nx === s0; break; }
      seen[nx] = 1; e2 = sa[nx] === eg ? sb[nx] : sa[nx]; chain.push(e2); cur = nx; eg = e2;
    }
    if (closed) chain.pop();
    else {
      const back = []; cur = s0; eg = sa[s0];
      for (;;) {
        nx = other(eg, cur); if (nx < 0 || seen[nx]) break;
        seen[nx] = 1; e2 = sa[nx] === eg ? sb[nx] : sa[nx]; back.push(e2); cur = nx; eg = e2;
      }
      chain = back.reverse().concat(chain);
    }
    const pts = [];
    for (let m = 0; m < chain.length; m++) pts.push(ex[chain[m]], ey[chain[m]]);
    out.push({ p: pts, closed });
  }
  return out;
}

// ---------- the real chart ----------
// Areas deeper than each level, from the isobaths alone. The isobaths were clipped to the water, so a few are cut
// where they graze the shore: rejoin those, then close every line that runs out to the frame along the frame edge.
// Each closed ring flips the even-odd fill across its line and nowhere else, so the fill is either the deep side
// or its complement everywhere; the depth grid votes on which, and a frame-sized ring flips it if needed.
function frameTints(/** @type {{ depth: number, lines: { p: number[], closed: boolean }[] }[]} */ contours, /** @type {number[]} */ levels, /** @type {number} */ FW, /** @type {number} */ FH, /** @type {Float32Array} */ cells, /** @type {number} */ gw, /** @type {number} */ gh, /** @type {number} */ gc) {
  const on = (/** @type {number} */ x, /** @type {number} */ y) => x <= 2 || y <= 2 || x >= FW - 2 || y >= FH - 2;
  const per = (/** @type {number} */ x, /** @type {number} */ y) => (y <= 2 ? x : x >= FW - 2 ? FW + y : y >= FH - 2 ? FW + FH + (FW - x) : 2 * FW + FH + (FH - y));
  const PER = 2 * (FW + FH), corners = [[0, 0, 0], [FW, FW, 0], [FW + FH, FW, FH], [2 * FW + FH, 0, FH]];
  const out = [];
  for (const L of levels) {
    const set = contours.find((c) => c.depth === L);
    if (!set) continue;
    /** @type {number[][]} */
    const rings = [], chains = [];
    for (const l of set.lines) (l.closed ? rings : chains).push(l.p.slice());
    for (;;) {
      let best = null;
      for (let a = 0; a < chains.length; a++) for (let ea = 0; ea < 2; ea++) {
        const A = chains[a], ax = ea ? A[A.length - 2] : A[0], ay = ea ? A[A.length - 1] : A[1];
        if (on(ax, ay)) continue;
        for (let b = a; b < chains.length; b++) for (let eb = 0; eb < 2; eb++) {
          if (b === a && eb <= ea) continue;
          const B = chains[b], bx = eb ? B[B.length - 2] : B[0], by = eb ? B[B.length - 1] : B[1];
          if (on(bx, by)) continue;
          const d = Math.hypot(ax - bx, ay - by);
          if (d < JOIN_M && (!best || d < best.d)) best = { a, ea, b, eb, d };
        }
      }
      if (!best) break;
      if (best.a === best.b) { rings.push(chains[best.a]); chains.splice(best.a, 1); continue; }
      const A = best.ea === 0 ? reversed(chains[best.a]) : chains[best.a], B = best.eb === 1 ? reversed(chains[best.b]) : chains[best.b];
      chains[best.a] = A.concat(B); chains.splice(best.b, 1);
    }
    for (const c of chains) {
      const n = c.length;
      if (!on(c[0], c[1]) || !on(c[n - 2], c[n - 1])) { rings.push(c); continue; }   // stray end: close on itself
      const ring = c.slice(), t0 = per(c[n - 2], c[n - 1]), span = (per(c[0], c[1]) - t0 + PER) % PER;
      corners.map((k) => [(k[0] - t0 + PER) % PER, k[1], k[2]]).sort((p, q) => p[0] - q[0])
        .forEach((k) => { if (k[0] > 0 && k[0] < span) ring.push(k[1], k[2]); });
      rings.push(ring);
    }
    let agree = 0, differ = 0;
    for (let i = 1; i < gh - 1; i += 3) for (let j = 1; j < gw - 1; j += 3) {
      const v = cells[i * gw + j];
      if (!(v >= 0)) continue;
      const want = v >= L + 3 ? 1 : v <= L - 3 ? 0 : -1;
      if (want < 0) continue;
      let inside = 0;
      for (const r of rings) if (ringContains(r, j * gc + gc / 2, i * gc + gc / 2)) inside ^= 1;
      if (inside === want) agree++; else differ++;
    }
    if (differ > agree) rings.push([0, 0, FW, 0, FW, FH, 0, FH]);
    out.push({ depth: L, rings });
  }
  return out;
}
function varLabel(/** @type {any} */ m) {
  const d = +(m && m.deg);
  if (!isFinite(d)) return '';
  const a = Math.abs(d), deg = Math.floor(a + 1e-9), min = Math.round((a - deg) * 60);
  return 'VAR ' + deg + '°' + (min ? String(min).padStart(2, '0') + "'" : '') + (d < 0 ? 'W' : d > 0 ? 'E' : '') + (m.year ? ' (' + m.year + ')' : '');
}
// The JSON (see tools/lake-chart) as a chart model.
function fromData(/** @type {any} */ d) {
  const pj = d.projection || {}, FW = +pj.width || 12000, FH = +pj.height || 14400;
  /** @type {number[][]} */
  const land = [];
  for (const poly of d.land || []) for (const r of poly || []) if (Array.isArray(r) && r.length >= 6) land.push(r.map(Number));
  for (const isl of d.islands || []) {
    const r = isl && isl.ring;
    // An island already among the land rings would cancel itself out of the even-odd fill.
    if (Array.isArray(r) && r.length >= 6 && !land.some((q) => q.length === r.length && q.every((v, k) => v === +r[k]))) land.push(r.map(Number));
  }
  if (!land.length) throw new Error('no land');
  // Coast: land rings, minus the runs along the frame edge (those are the sheet's border, not shoreline).
  const edge = (/** @type {number} */ ax, /** @type {number} */ ay, /** @type {number} */ bx, /** @type {number} */ by) => (ax === bx && (ax <= 0 || ax >= FW)) || (ay === by && (ay <= 0 || ay >= FH));
  /** @type {{ p: number[], closed: boolean }[]} */
  const coast = [];
  for (const r of land) {
    const n = r.length / 2;
    let start = -1;
    for (let k = 0; k < n && start < 0; k++) { const m = (k + 1) % n; if (edge(r[2 * k], r[2 * k + 1], r[2 * m], r[2 * m + 1])) start = m; }
    if (start < 0) { coast.push({ p: r, closed: true }); continue; }
    /** @type {number[]} */
    let cur = [];
    for (let q = 0; q < n; q++) {
      const k = (start + q) % n, m = (k + 1) % n;
      if (edge(r[2 * k], r[2 * k + 1], r[2 * m], r[2 * m + 1])) { if (cur.length >= 4) coast.push({ p: cur, closed: false }); cur = []; continue; }
      if (!cur.length) cur.push(r[2 * k], r[2 * k + 1]);
      cur.push(r[2 * m], r[2 * m + 1]);
    }
    if (cur.length >= 4) coast.push({ p: cur, closed: false });
  }
  // Isobaths, eased once; the tints are built from the same lines so fill and line agree.
  const contours = [];
  for (const c of d.contours || []) {
    const lines = [];
    for (const l of c.lines || []) {
      if (!Array.isArray(l) || l.length < 4) continue;
      const n = l.length, closed = n >= 8 && l[0] === l[n - 2] && l[1] === l[n - 1];
      lines.push({ p: chaikin((closed ? l.slice(0, n - 2) : l.slice()).map(Number), closed, 2), closed });
    }
    if (+c.depth > 0 && lines.length) contours.push({ depth: +c.depth, lines });
  }
  // Depth: bilinear over the water cells of the 100 m grid (cell (i, j) is centred on (j + 1/2, i + 1/2) cells).
  const g = d.depthGrid || {}, gw = g.w | 0, gh = g.h | 0, gc = +g.cell || 100, cells = Float32Array.from((g.cells || []).map(Number));
  if (!(gw > 1 && gh > 1 && cells.length === gw * gh)) throw new Error('no depth grid');
  const depthAt = (/** @type {number} */ x, /** @type {number} */ y) => {
    const fx = x / gc - 0.5, fy = y / gc - 0.5, j0 = Math.floor(fx), i0 = Math.floor(fy), tx = fx - j0, ty = fy - i0;
    let sw = 0, sv = 0;
    for (let di = 0; di < 2; di++) for (let dj = 0; dj < 2; dj++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= gh || j >= gw) continue;
      const v = cells[i * gw + j];
      if (!(v >= 0)) continue;
      const w = Math.max(1e-4, (dj ? tx : 1 - tx) * (di ? ty : 1 - ty));
      sw += w; sv += w * v;
    }
    return sw > 0 ? sv / sw : -1;
  };
  const tints = frameTints(contours, TINT_FT, FW, FH, cells, gw, gh, gc);
  // Aids, dangers, the bridge and landmarks, normalized. Harbour facilities, the canal terminal and the built-up
  // area are left off; landmarks get symbols only.
  /** @type {any[]} */
  const features = [];
  for (const f of d.features || []) {
    if (!f || !isFinite(+f.x) || !isFinite(+f.y)) continue;
    const x = +f.x, y = +f.y, ring = Array.isArray(f.ring) && f.ring.length >= 6 ? f.ring.map(Number) : null;
    if (f.type === 'buoy') {
      const num = /(\d+)\s*$/.exec(String(f.name || '')), red = /red/i.test(String(f.color || ''));
      features.push({ type: 'buoy', x, y, red, lit: !!f.light, txt: [(red ? 'R' : 'G') + (num ? ' "' + num[1] + '"' : ''), String(f.light || '')].filter(Boolean) });
    } else if (f.type === 'beacon') {
      features.push({ type: 'light', x, y, txt: f.light ? [String(f.light)] : [] });
    } else if (f.type === 'bridge' && ring) {
      const v = f.clearance && f.clearance.verticalFt;
      features.push({ type: 'bridge', x, y, ring, txt: f.name && v ? ['VERT CL ' + v + ' FT'] : [] });
    } else if (f.type === 'obstruction') {
      if (ring) features.push({ type: 'foul', x, y, ring, txt: ['Foul'] });
      else if (f.kind === 'crib' || f.kind === 'snag') features.push({ type: f.kind, x, y });
      else features.push({ type: 'obstn', x, y, txt: ['Obstn' + (f.depthFt != null ? ' ' + f.depthFt : '')] });
    } else if (f.type === 'rock') features.push({ type: 'rock', x, y });
    else if (f.type === 'landmark') features.push({ type: f.kind === 'spire' ? 'spire' : 'monument', x, y });
    else if (f.type === 'wreck') features.push({ type: 'wreck', x, y, txt: ['Wk'] });
  }
  const names = [];
  for (const f of d.features || []) {
    if (!f || f.type !== 'label' || !f.name || f.kind === 'harbour' || !isFinite(+f.x) || !isFinite(+f.y)) continue;
    const P = PLACE[f.name] || { p: 4 };
    names.push({ t: P.t || String(f.name), x: +f.x, y: +f.y, k: P.k || (f.kind === 'water' ? 'water' : f.kind === 'town' ? 'town' : 'land'), p: P.p, r: P.r || 150 });
  }
  const dm = /(\d+(?:\.\d+)?)\s*ft above/i.exec(String((d.datum && d.datum.depths) || ''));
  return {
    w: FW, h: FH, land, coast, tints, contours, depthAt, features, names, pan: true,
    soundings: (d.soundings || []).filter((/** @type {any} */ v) => Array.isArray(v) && isFinite(+v[0]) && isFinite(+v[1]) && +v[2] > 0).map((/** @type {any[]} */ v) => [+v[0], +v[1], +v[2]]),
    datumFt: +(d.datum && d.datum.datumOffsetFt) || 0,
    // The narrows span the column plus a quarter of each gutter; the view starts on Port Henry and the bridge.
    fit: (/** @type {any} */ f) => {
      let s, x0;
      if (f.narrow) { s = f.W / (FULL_BAND[1] - FULL_BAND[0]); x0 = (FULL_BAND[0] + FULL_BAND[1]) / 2 - f.W / 2 / s; }
      else {
        const inset = clamp(0.25 * Math.min(f.colL, f.W - f.colR), 28, 120);
        s = (f.colR - f.colL + 2 * inset) / (BAND[1] - BAND[0]);
        x0 = BAND[0] - (f.colL - inset) / s;
      }
      const sMin = Math.max(f.W / FW, f.H / FH);
      if (s < sMin) { x0 += f.W / 2 / s - f.W / 2 / sMin; s = sMin; }
      return { s, x0: clamp(x0, 0, FW - f.W / s), top: clamp(FOCUS_Y - f.H / 2 / s, 0, FH - f.H / s) };
    },
    title: realTitle(dm ? dm[1] : ''),
    varDeg: isFinite(+(d.magvar && d.magvar.deg)) ? +d.magvar.deg : 0,
    varText: varLabel(d.magvar),
  };
}

// ---------- the procedural fallback: a long basin, steep-ish shelves, shoals, islands and a wreck ----------
// f: { W, H, colL, colR, narrow, margin, top, bottom, free(x, y, pad) } in CSS px. The lake is shaped around
// the content column (deep and plain under it) and places its furniture where free() says the sheet is open.
// Its units are the viewport height: bounds = the viewport.
function proceduralChart(/** @type {any} */ f, /** @type {string} */ seed) {
  const rnd = mulberry32(fnv1a(seed));
  const W = f.W, H = f.H, narrow = f.narrow, inner = f.margin;
  const colGap = (/** @type {number} */ x) => (narrow ? 1e5 : Math.max(f.colL - x, 0, x - f.colR));
  const mid = narrow ? W / 2 : (f.colL + f.colR) / 2;
  const gx0 = -2 * CELL, gy0 = -2 * CELL, gw = Math.ceil(W / CELL) + 5, gh = Math.ceil(H / CELL) + 5, N = gw * gh;
  const depth = new Float32Array(N);
  const depthAt = (/** @type {number} */ x, /** @type {number} */ y) => {
    const fx = (x - gx0) / CELL, fy = (y - gy0) / CELL, i = Math.floor(fx), j = Math.floor(fy);
    if (!(i >= 0 && j >= 0 && i < gw - 1 && j < gh - 1)) return -60;
    const tx = fx - i, ty = fy - j, n = j * gw + i;
    return (depth[n] * (1 - tx) + depth[n + 1] * tx) * (1 - ty) + (depth[n + gw] * (1 - tx) + depth[n + gw + 1] * tx) * ty;
  };
  let i, j, k;
  const s = [];
  for (k = 0; k < 6; k++) s.push((rnd() * 1e9) | 0);
  const phi = rnd() * TAU, base = narrow ? W / 2 - 4 : 0.46 * W;
  const cxs = new Float32Array(gh), hls = new Float32Array(gh), hrs = new Float32Array(gh);
  for (j = 0; j < gh; j++) {
    const y = gy0 + j * CELL;
    const cx = mid + 0.035 * W * Math.sin(y / 700 + phi) + 0.06 * W * fbm(y / 300, 0.5, s[0]);
    let hl = base * (0.92 + 0.3 * fbm(y / 420, 9.5, s[1])), hr = base * (0.92 + 0.3 * fbm(y / 420, 27.5, s[1]));
    if (!narrow) { hl = smax(hl, cx - f.colL + 120, 40); hr = smax(hr, f.colR - cx + 120, 40); } // deep water under the column
    const pl = 1.9 + 0.9 * fbm(y / 380, 3.5, s[2]), pr = 1.9 + 0.9 * fbm(y / 380, 41.5, s[2]);
    cxs[j] = cx; hls[j] = hl; hrs[j] = hr;
    for (i = 0; i < gw; i++) {
      const x = gx0 + i * CELL, dx = x - cx;
      const u = (dx < 0 ? -dx / hl : dx / hr) + 0.09 * fbm(x / 120, y / 120, s[3]);
      const q = 1 - u * u;
      let h = q > 0 ? 400 * Math.pow(q, dx < 0 ? pl : pr) : -300 * (u - 1);
      h += (6 + 40 * Math.min(1, Math.max(0, q) * 1.6)) * fbm(x / 170, y / 170, s[4]);
      depth[j * gw + i] = h;
    }
  }
  // Shoals along the shelves (the tall ones break surface as islands), elongated along the lake and kept
  // clear of the column by their long axis; then one offshore seamount where a gutter is wide enough.
  const shoals = [], want = 3 + Math.floor(rnd() * 3);
  for (let t = 0; t < 80 && shoals.length < want; t++) {
    const sy = H * (0.06 + 0.88 * rnd()), jj = clamp(Math.round((sy - gy0) / CELL), 0, gh - 1);
    const side = rnd() < 0.5 ? -1 : 1, uu = 0.5 + 0.38 * rnd();
    const sx = cxs[jj] + side * uu * (side < 0 ? hls[jj] : hrs[jj]);
    const sg = 30 + 40 * rnd(), sgy = sg * (1.2 + 1.2 * rnd());
    if (sx < inner + 10 || sx > W - inner - 10 || colGap(sx) < 2.2 * sgy + 24) continue;
    const d0 = depthAt(sx, sy);
    if (d0 < 20) continue;
    shoals.push({ x: sx, y: sy, a: Math.max(120, Math.min(420, d0 * (0.55 + 0.95 * rnd()))), sx: sg, sy: sgy });
  }
  if (!narrow) {
    for (let t = 0; t < 40; t++) {
      const my = H * (0.1 + 0.8 * rnd()), jj = clamp(Math.round((my - gy0) / CELL), 0, gh - 1), side = rnd() < 0.5 ? -1 : 1;
      const mx = cxs[jj] + side * (0.3 + 0.35 * rnd()) * (side < 0 ? hls[jj] : hrs[jj]), ms = 55 + 25 * rnd(), msy = ms * (1.2 + 0.5 * rnd());
      if (mx < inner + 10 || mx > W - inner - 10 || colGap(mx) < 2.2 * ms + 24) continue;
      const md = depthAt(mx, my);
      if (md > 150) { shoals.push({ x: mx, y: my, a: md * (0.5 + 0.22 * rnd()), sx: ms, sy: msy }); break; }
    }
  }
  for (const sh of shoals) {
    const i0 = Math.max(0, Math.floor((sh.x - 3 * sh.sx - gx0) / CELL)), i1 = Math.min(gw - 1, Math.ceil((sh.x + 3 * sh.sx - gx0) / CELL));
    const j0 = Math.max(0, Math.floor((sh.y - 3 * sh.sy - gy0) / CELL)), j1 = Math.min(gh - 1, Math.ceil((sh.y + 3 * sh.sy - gy0) / CELL));
    for (j = j0; j <= j1; j++) for (i = i0; i <= i1; i++) {
      const ex = (gx0 + i * CELL - sh.x) / sh.sx, ey = (gy0 + j * CELL - sh.y) / sh.sy, e = ex * ex + ey * ey;
      if (e < 9) depth[j * gw + i] -= sh.a * Math.exp(-0.5 * e);
    }
  }
  for (i = 0; i < gw; i++) { depth[i] = -60; depth[(gh - 1) * gw + i] = -60; } // closing ring: every isobath closes off-screen
  for (j = 0; j < gh; j++) { depth[j * gw] = -60; depth[j * gw + gw - 1] = -60; }

  // Isobaths, smoothed, in model units (1 = the viewport height).
  const contours = LEVELS.map((L) => {
    const lines = [];
    for (const r of isolines(depth, gw, gh, L, gx0, gy0, CELL)) {
      const P = chaikin(r.p, r.closed, 2);
      if (P.length < 4) continue;
      lines.push({ p: P.map((v) => v / H), closed: r.closed });
    }
    return { depth: L, lines };
  });
  // Land: the sheet minus the lake outlines; islands: shoreline loops nested an odd number of times.
  const shore = contours[0].lines.filter((l) => l.closed && l.p.length >= 6).map((l) => l.p);
  const nest = shore.map((r, a) => shore.reduce((n, o, b) => n + (b !== a && ringContains(o, r[0], r[1]) ? 1 : 0), 0));
  const parent = shore.map((r, a) => {
    let best = -1;
    for (let b = 0; b < shore.length; b++) if (b !== a && nest[b] === nest[a] - 1 && ringContains(shore[b], r[0], r[1])) best = b;
    return best;
  });
  const gx1 = gx0 + (gw - 1) * CELL, gy1 = gy0 + (gh - 1) * CELL;
  const sheet = [gx0, gy0, gx1, gy0, gx1, gy1, gx0, gy1].map((v) => v / H);
  const land = [[sheet].concat(shore.filter((_, a) => nest[a] === 0))];
  /** @type {number[][][]} */
  const islands = [];
  shore.forEach((r, a) => { if (nest[a] % 2) islands.push([r].concat(shore.filter((_, b) => parent[b] === a))); });
  const areas = TINT_LEVELS.map((L) => ({
    depth: L,
    rings: contours[LEVELS.indexOf(L)].lines.filter((l) => l.closed).map((l) => l.p),
  }));

  // The wreck: open water of middling depth, in a gutter, clear of the furniture.
  let wreck = null;
  const wy0 = f.top + 30, wy1 = f.bottom - 30;
  for (let t = 0; t < 400 && wy1 > wy0; t++) {
    const x = inner + 40 + rnd() * (W - 2 * inner - 80), y = wy0 + rnd() * (wy1 - wy0), h = depthAt(x, y);
    if (h < 25 || h > 160 || !f.free(x, y, 36)) continue;
    wreck = { x, y }; break;
  }

  // Soundings: Poisson disk over open water, each label inside one depth band.
  const band = (/** @type {number} */ h) => { let b = 0; for (const L of LEVELS) if (h >= L) b++; return b; };
  function soundOk(/** @type {number} */ x, /** @type {number} */ y) {
    const h = depthAt(x, y);
    if (h < 1.5 || colGap(x) < 34 || !f.free(x, y, 10)) return false;
    const b = band(h);
    for (let q = 0; q < OFFS.length; q += 2) if (band(depthAt(x + OFFS[q], y + OFFS[q + 1])) !== b) return false;
    if (wreck) { const dx = wreck.x - x, dy = wreck.y - y; if (dx * dx + dy * dy < 900) return false; }
    return true;
  }
  const r = 26, cs = r / Math.SQRT2, x0 = inner + 6, y0 = inner + 6, x1 = W - inner - 6, y1 = H - inner - 6;
  const cw = Math.max(1, Math.ceil((x1 - x0) / cs)), ch = Math.max(1, Math.ceil((y1 - y0) / cs));
  const grid = new Int32Array(cw * ch).fill(-1), xs = /** @type {number[]} */ ([]), ys = /** @type {number[]} */ ([]), active = /** @type {number[]} */ ([]);
  function ok(/** @type {number} */ x, /** @type {number} */ y) {
    if (x < x0 || y < y0 || x >= x1 || y >= y1) return false;
    const gi = ((x - x0) / cs) | 0, gj = ((y - y0) / cs) | 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const ii = gi + di, jj = gj + dj;
      if (ii < 0 || jj < 0 || ii >= cw || jj >= ch) continue;
      const q = grid[jj * cw + ii];
      if (q >= 0) { const dx = xs[q] - x, dy = ys[q] - y; if (dx * dx + dy * dy < r * r) return false; }
    }
    return soundOk(x, y);
  }
  function add(/** @type {number} */ x, /** @type {number} */ y) { grid[(((y - y0) / cs) | 0) * cw + (((x - x0) / cs) | 0)] = xs.length; active.push(xs.length); xs.push(x); ys.push(y); }
  for (let sy = y0 + 20; sy < y1; sy += 110) for (let sx = x0 + 20; sx < x1; sx += 110) {
    const px = sx + (rnd() - 0.5) * 60, py = sy + (rnd() - 0.5) * 60;
    if (!ok(px, py)) continue;
    add(px, py);
    while (active.length) {
      const ai = (rnd() * active.length) | 0, a = active[ai];
      let found = false;
      for (let t = 0; t < 16; t++) {
        const ang = rnd() * TAU, rr = r * (1 + rnd()), cx = xs[a] + Math.cos(ang) * rr, cy = ys[a] + Math.sin(ang) * rr;
        if (ok(cx, cy)) { add(cx, cy); found = true; break; }
      }
      if (!found) { active[ai] = active[active.length - 1]; active.pop(); }
    }
  }
  const soundings = xs.map((x, q) => [x / H, ys[q] / H, Math.round(depthAt(x, ys[q]))]);
  return {
    depth: (/** @type {number} */ x, /** @type {number} */ y) => depthAt(x * H, y * H),
    land, islands, areas, contours, soundings,
    features: wreck ? [{ type: 'wreck', x: wreck.x / H, y: wreck.y / H, label: 'Wk' }] : [],
  };
}
// The generator's lake as a chart model, in CSS px of the current viewport (it is drawn 1:1 and never pans).
function fromProcedural(/** @type {any} */ f) {
  const m = proceduralChart(f, SEED), U = f.H;
  const sc = (/** @type {number[]} */ r) => r.map((v) => v * U);
  /** @type {number[][]} */
  const land = [];
  for (const poly of m.land.concat(m.islands)) for (const r of poly) if (r.length >= 6) land.push(sc(r));
  const zero = m.contours.find((c) => c.depth === 0);
  return {
    w: f.W, h: f.H, land,
    coast: zero ? zero.lines.map((l) => ({ p: sc(l.p), closed: l.closed })) : [],
    tints: m.areas.map((a) => ({ depth: a.depth, rings: a.rings.map(sc) })),
    contours: m.contours.filter((c) => c.depth > 0).map((c) => ({ depth: c.depth, lines: c.lines.map((l) => ({ p: sc(l.p), closed: l.closed })) })),
    soundings: m.soundings.map((v) => [v[0] * U, v[1] * U, v[2]]),
    depthAt: (/** @type {number} */ x, /** @type {number} */ y) => m.depth(x / U, y / U),
    datumFt: 0,
    features: m.features.map((q) => ({ type: 'wreck', x: q.x * U, y: q.y * U, txt: [q.label] })),
    names: [], pan: false,
    fit: () => ({ s: 1, x0: 0, top: 0 }),
    title: PROC_TITLE, varDeg: -14, varText: '',
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {import('./types').BackgroundOptions} options
 * @returns {import('./types').Background}
 */
export function mount(canvas, options) {
  const win = window, doc = document;
  const isDark = !!options.isDark, reduced = !!options.reducedMotion;
  const pal = options.palette, bgC = rgbOf(pal.bg), inkC = rgbOf(pal.ink), faintC = rgbOf(pal.faint);
  const tok = isDark
    ? { land: shade(bgC, 0.58, (l) => l + 0.018), shoal: shade(faintC, 1.33, (l) => l * 0.656), surface: shade(bgC, 0.87, (l) => l * 1.4),
        border: shade(bgC, 0.71, (l) => l + 0.132), muted: shade(inkC, 0.6, (l) => l - 0.223) }
    : { land: shade(bgC, 0.9, (l) => l - 0.093), shoal: shade(faintC, 1.22, (l) => l + (1 - l) * 0.537), surface: shade(bgC, 1.24, (l) => l + (1 - l) * 0.47),
        border: shade(bgC, 0.49, (l) => l - 0.124), muted: shade(inkC, 0.44, (l) => l + 0.186) };
  /** @type {Record<string, string>} */
  const COL = {
    bg: css(bgC), ink: css(inkC), accent: css(rgbOf(pal.accent)), faint: css(faintC), land: css(tok.land), shoal: css(tok.shoal),
    mid: css(mix(tok.shoal, bgC, 0.55)), surface: css(tok.surface), border: css(tok.border), muted: css(tok.muted),
  };
  const TINT_COL = [COL.bg, COL.mid];             // deepest band first; shallower than every tint is shoal
  const mq = (/** @type {string} */ q) => { try { return !!(win.matchMedia && win.matchMedia(q).matches); } catch (e) { return false; } };
  const coarse = mq('(pointer: coarse)');
  const now = () => (win.performance && win.performance.now ? win.performance.now() : Date.now());
  const ctx = canvas.getContext('2d');
  if (!ctx) return { destroy() {} };
  const mkCanvas = () => { const c = doc.createElement('canvas'); return { c, g: /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')) }; };

  // ---------- state ----------
  let destroyed = false, raf = 0, lastTs = 0, sim = 0, dirty = false;
  const timers = new Set();
  const later = (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
    const id = win.setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, ms);
    timers.add(id);
    return id;
  };
  const cancel = (/** @type {number} */ id) => { if (id) { win.clearTimeout(id); timers.delete(id); } return 0; };
  let W = 0, H = 0, dpr = 1, small = false, narrow = false, outer = 14, inner = 20, colL = 0, colR = 0;
  let colSeen = { left: 0, right: 0 };
  /** @type {{ x: number, y: number, r: number }} */
  let rose = { x: 0, y: 0, r: 0 };
  /** @type {{ x0: number, y0: number, x1: number, y1: number } | null} */
  let titleBox = null;
  /** @type {TitleLine[] | null} */
  let titleLines = null;
  /** @type {Path2D | null} */
  let CLIP = null;
  /** @type {'wait' | 'real' | 'proc'} */
  let mode = 'wait';
  /** @type {any} */
  let real = null, chart = null;
  let s = 1, x0 = 0, SH = 0, panBase = 0, panMax = 0, pan = 0, panA = 0, aValid = false, M = 0;
  /** @type {PolyIndex | null} */
  let landIdx = null;
  /** @type {Path2D | null} */
  let landPath = null, coastPath = null, waterClip = null;
  /** @type {Path2D[]} */
  let tintPaths = [];
  /** @type {Map<number, Path2D>} */
  let plain = new Map(), gapped = new Map();
  /** @type {number[]} */
  let levels = [];
  /** @type {{ x: number, y: number, a: number, t: string }[]} */
  let clabels = [];
  /** @type {{ P: number[], closed: boolean }[]} */
  let lines = [];
  /** @type {any[]} */
  let names = [], feats = [];
  /** @type {{ x0: number, y0: number, x1: number, y1: number }[]} */
  let boxes = [];
  let sN = 0, sX = new Float32Array(0), sY = new Float32Array(0), sRest = new Uint8Array(0);
  /** @type {string[]} */
  let sTxt = [];
  let hashW = 0, hashH = 0, hashStart = new Int32Array(1), hashItems = new Int32Array(0);
  const hashC = 64;
  const A = mkCanvas(), F = mkCanvas(), VL = mkCanvas(), SC = reduced ? null : mkCanvas(), MK = reduced ? null : mkCanvas();
  let veilPan = NaN;                            // the pan the rose's veil (VL) was last painted for
  const lens = { x: 0, y: 0, tx: 0, ty: 0, s: 0, ts: 0, init: false, hold: false };
  /** @type {any[]} */
  let pulses = [];
  /** @type {any} */
  let wgrid = null;
  /** @type {any} */
  let down = null;
  let lpTimer = 0, resizeT = 0;
  let yK = 1;                                   // CSS px -> sheet px while a small height change is left stretched
  /** @type {AbortController | null} */
  let abort = null;
  const XS = /** @type {number[]} */ ([]);

  // ---------- layout ----------
  // The canvas is CSS 100% x 100% of the viewport; size from its own box so the bitmap is never stretched.
  const viewW = () => Math.max(1, Math.round(canvas.clientWidth || 0) || (win.innerWidth | 0));
  const viewH = () => Math.max(1, Math.round(canvas.clientHeight || 0) || (win.innerHeight | 0));
  const nextDpr = () => Math.min(win.devicePixelRatio || 1, coarse ? 1.5 : 2);
  function readColumn() {
    try { const c = options.column(); return { left: Math.round(+c.left || 0), right: Math.round(+c.right || 0) }; }
    catch (e) { return { left: 0, right: 0 }; }
  }
  const scrollTop = () => Math.max(0, +(win.scrollY != null ? win.scrollY : win.pageYOffset) || 0);
  // Horizontal distance to the content column (it runs the full height); huge when there are no gutters.
  const colGap = (/** @type {number} */ x) => (narrow ? 1e5 : Math.max(colL - x, 0, x - colR));
  function layout() {
    W = viewW(); H = viewH();
    dpr = nextDpr();
    if (W > 2560) dpr = 1;                       // memory guard: the sheet layer is taller than the viewport
    const c = readColumn();
    colSeen = c;
    small = W < 760;
    narrow = !(c.right > c.left) || Math.min(c.left, W - c.right) < NARROW;
    colL = c.left; colR = c.right;
    outer = small ? 8 : 14; inner = outer + (small ? 4 : 6);
  }
  // Compass rose low in the right gutter and the title block low in the left, both clear of the column, the
  // header and the footer. Neither is drawn without gutters. The real chart then moves the rose to wherever it
  // hides least of the opening view (pickRose).
  function furniture(/** @type {TitleSpec} */ spec) {
    rose = { x: 0, y: 0, r: 0 }; titleBox = null; titleLines = null;
    if (!narrow) {
      const a0 = colR + 18, a1 = W - inner - 12, r = Math.min(88, (a1 - a0) / 2), cy = H - BOTTOM_CLEAR - 14 - r;
      if (r >= 50 && cy - r >= TOP_CLEAR + 24) rose = { x: Math.round((a0 + a1) / 2), y: Math.round(cy), r: Math.round(r) };
      ctx.letterSpacing = '0px';
      for (const v of spec.variants) {
        let mw = 0, ph = 14;
        for (const l of v.concat(spec.credit ? [spec.credit] : [])) { ctx.font = l.f; mw = Math.max(mw, ctx.measureText(l.t).width + l.ls * (l.t.length - 1)); }
        for (const l of v) ph += l.h;
        if (spec.credit) ph += 9 + spec.credit.h;
        const pw = Math.round(mw + 30), tx0 = inner + 14, ty1 = H - BOTTOM_CLEAR - 14;
        if (tx0 + pw <= colL - 16 && ty1 - ph >= TOP_CLEAR + 100) { titleBox = { x0: tx0, y0: ty1 - ph, x1: tx0 + pw, y1: ty1 }; titleLines = v; break; }
      }
    }
    clipFurniture();
  }
  // The real chart's rose: candidates run down both gutters (above the title block on the left), each scored on
  // what it would cover as the page opens: water (the rose belongs on blank land when a gutter has some), and
  // above all the bridge, aids, dangers and named places.
  function pickRose() {
    if (narrow) return;
    /** @type {{ x: number, y: number, r: number, b: number }[]} */
    const cands = [];
    if (rose.r > 0) cands.push({ x: rose.x, y: rose.y, r: rose.r, b: 0 });
    for (const left of [true, false]) {
      const a0 = left ? inner + 12 : colR + 18, a1 = left ? colL - 18 : W - inner - 12, r = Math.round(Math.min(88, (a1 - a0) / 2));
      if (r < 50) continue;
      const yT = TOP_CLEAR + 24 + r, yB = (left && titleBox ? titleBox.y0 - 14 : H - BOTTOM_CLEAR - 14) - r;
      if (yB < yT) continue;
      const n = Math.min(7, Math.floor((yB - yT) / 40) + 1);
      // b: on the left, a slight preference for the top of the gutter, well apart from the title block
      for (let k = 0; k < n; k++) cands.push({ x: Math.round((a0 + a1) / 2), y: Math.round(n > 1 ? yT + ((yB - yT) * k) / (n - 1) : yT), r, b: left && n > 1 ? k / (n - 1) : 0 });
    }
    let best = null, bestS = Infinity;
    for (const c of cands) {
      let wet = 0, n = 0, sc = 0;
      for (let q = 0; q < 4; q++) {
        const rr = (c.r * (q + 0.5)) / 4, m = 6 + 6 * q;
        for (let a = 0; a < m; a++, n++) if (waterS(c.x + Math.cos((a * TAU) / m + q) * rr, c.y + panBase + Math.sin((a * TAU) / m + q) * rr)) wet++;
      }
      wet /= n; sc = 16 * wet + c.b;
      const R2 = (c.r + 12) * (c.r + 12);
      for (const f of chart.features) {
        const w = f.type === 'bridge' ? 8 : f.type === 'buoy' || f.type === 'light' ? 6 : f.type === 'crib' || f.type === 'snag' ? 1 : f.type === 'spire' || f.type === 'monument' ? 2 : 3;
        const P = f.ring || [f.x, f.y], n2 = P.length;
        for (let k = 0; k < n2; k += 2) {               // nearest point of the ring's outline (or the point itself)
          const m = (k + 2) % n2, ax = (P[k] - x0) * s - c.x, ay = P[k + 1] * s - panBase - c.y;
          const ex = (P[m] - x0) * s - c.x - ax, ey = P[m + 1] * s - panBase - c.y - ay, l2 = ex * ex + ey * ey;
          const t = l2 > 0 ? clamp(-(ax * ex + ay * ey) / l2, 0, 1) : 0, dx = ax + ex * t, dy = ay + ey * t;
          if (dx * dx + dy * dy < R2) { sc += w; break; }
        }
      }
      for (const nm of chart.names) {
        const dx = (nm.x - x0) * s - c.x, dy = nm.y * s - panBase - c.y;
        // a name on open land just moves aside; a water name or one squeezed on a point is harder to resettle
        if (nm.p <= 3 && dx * dx + dy * dy < (c.r + 24) * (c.r + 24)) sc += nm.k === 'town' ? 1 : 6 - nm.p;
      }
      if (sc < bestS - 0.05) { best = c; bestS = sc; }
    }
    if (!best) return;
    rose = { x: best.x, y: best.y, r: best.r };
    clipFurniture();
  }
  function clipFurniture() {
    const cp = new Path2D();
    cp.rect(inner, inner, W - 2 * inner, H - 2 * inner);
    if (titleBox) cp.rect(titleBox.x0, titleBox.y0, titleBox.x1 - titleBox.x0, titleBox.y1 - titleBox.y0);
    if (rose.r > 0) { cp.moveTo(rose.x + rose.r + 1.5, rose.y); cp.arc(rose.x, rose.y, rose.r + 1.5, 0, TAU); }
    CLIP = cp;                                   // live marks stay inside the neat line and off the title block and rose
  }
  // Does the screen rect (ax, ay)-(bx, by), with p px of air, touch the title block or the compass rose?
  function onFurniture(/** @type {number} */ ax, /** @type {number} */ ay, /** @type {number} */ bx, /** @type {number} */ by, /** @type {number} */ p) {
    if (titleBox && ax < titleBox.x1 + p && bx > titleBox.x0 - p && ay < titleBox.y1 + p && by > titleBox.y0 - p) return true;
    if (rose.r <= 0) return false;
    const dx = rose.x - clamp(rose.x, ax, bx), dy = rose.y - clamp(rose.y, ay, by);
    return dx * dx + dy * dy < (rose.r + p) * (rose.r + p);
  }
  // Screen-space furniture test (the procedural lake is laid out in screen space).
  function blocked(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ p) {
    if (x < inner + p || x > W - inner - p || y < inner + p || y > H - inner - p) return true;
    if (!narrow && x > colL - p && x < colR + p) return true;
    if (inR(titleBox, x, y, p)) return true;
    const dx = x - rose.x, dy = y - rose.y;
    return rose.r > 0 && dx * dx + dy * dy < (rose.r + p) * (rose.r + p);
  }
  // Sheet-space test: a chart that pans only answers to the neat line's sides and the column (its soundings and
  // isobath labels are seen at every scroll position, so they can't make way for the fixed rose and title block).
  // A still sheet (the procedural lake, or any chart in reduced motion) is only ever seen at panBase.
  function sheetBlocked(/** @type {number} */ X, /** @type {number} */ Y, /** @type {number} */ p) {
    if (X < inner + p || X > W - inner - p) return true;
    if (!narrow && X > colL - p && X < colR + p) return true;
    return chart.pan && !reduced ? false : blocked(X, Y - panBase, p);
  }
  function frameSpec() {
    return { W, H, colL, colR, narrow, margin: inner, top: TOP_CLEAR, bottom: H - BOTTOM_CLEAR, free: (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ p) => !blocked(x, y, p) };
  }
  // Sheet coordinates: x is screen x; y runs down the whole chart (screen y = Y - pan).
  const toS = (/** @type {number[]} */ r) => { const o = new Array(r.length); for (let k = 0; k < r.length; k += 2) { o[k] = (r[k] - x0) * s; o[k + 1] = r[k + 1] * s; } return o; };
  const waterAt = (/** @type {number} */ wx, /** @type {number} */ wy) => wx >= 0 && wy >= 0 && wx <= chart.w && wy <= chart.h && !!landIdx && !idxInside(landIdx, wx, wy);
  const waterS = (/** @type {number} */ X, /** @type {number} */ Y) => waterAt(X / s + x0, Y / s);
  function hitBoxes(/** @type {number} */ ax, /** @type {number} */ ay, /** @type {number} */ bx, /** @type {number} */ by, /** @type {number} */ p, /** @type {any} */ skip) {
    for (const b of boxes) if (b !== skip && ax < b.x1 + p && bx > b.x0 - p && ay < b.y1 + p && by > b.y0 - p) return true;
    return false;
  }
  function addRing(/** @type {Path2D} */ path, /** @type {number[]} */ q, /** @type {boolean} */ close) {
    if (q.length < 4) return;
    path.moveTo(q[0], q[1]);
    for (let k = 2; k < q.length; k += 2) path.lineTo(q[k], q[k + 1]);
    if (close) path.closePath();
  }

  // ---------- chart geometry in sheet space ----------
  function buildPaths() {
    landPath = new Path2D(); waterClip = new Path2D(); coastPath = new Path2D(); lines = [];
    waterClip.rect(-64, -64, W + 128, SH + 128);
    for (const r of chart.land) { const q = toS(r); addRing(landPath, q, true); addRing(waterClip, q, true); }
    for (const l of chart.coast) { const q = toS(l.p); addRing(coastPath, q, l.closed); if (l.closed) q.push(q[0], q[1]); lines.push({ P: q, closed: l.closed }); }
    tintPaths = chart.tints.slice().sort((/** @type {any} */ a, /** @type {any} */ b) => b.depth - a.depth).map((/** @type {any} */ t) => {
      const p = new Path2D();
      for (const r of t.rings) addRing(p, toS(r), true);
      return p;
    });
  }
  // Aids, dangers and landmarks, with a box each for the label placement that follows.
  function placeFeatures() {
    feats = []; boxes = [];
    for (const f of chart.features) {
      const X = (f.x - x0) * s, Y = f.y * s, R = f.ring ? toS(f.ring) : null;
      if (X < -60 || X > W + 60) continue;
      let b;
      if (R) {
        b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (let k = 0; k < R.length; k += 2) { b.x0 = Math.min(b.x0, R[k]); b.x1 = Math.max(b.x1, R[k]); b.y0 = Math.min(b.y0, R[k + 1]); b.y1 = Math.max(b.y1, R[k + 1]); }
      } else if (f.type === 'buoy') b = { x0: X - (f.lit ? 10 : 3), y0: Y - 12, x1: X + 8, y1: Y + 3 };
      else if (f.type === 'light') b = { x0: X - 10, y0: Y - 10, x1: X + 3, y1: Y + 3 };
      else if (f.type === 'wreck') b = { x0: X - 12, y0: Y - 12, x1: X + 12, y1: Y + 12 };
      else b = { x0: X - 4, y0: Y - 7, x1: X + 4, y1: Y + 4 };
      const o = { f, X, Y, R, b, lab: null };
      feats.push(o); boxes.push(b);
    }
    ctx.font = LFONT; ctx.letterSpacing = '0px';
    for (const o of feats) {
      const txt = o.f.txt;
      if (!txt || !txt.length) continue;
      let w = 0;
      for (const t of txt) w = Math.max(w, ctx.measureText(t).width);
      w = Math.ceil(w) + 1;
      const h = 10 * txt.length, b = o.b, my = o.R ? (b.y0 + b.y1) / 2 : o.Y;
      const spots = [[b.x1 + 3, my - h + 1], [b.x0 - 3 - w, my - h + 1], [b.x1 + 3, my + 2], [b.x0 - 3 - w, my + 2],
        [b.x0, b.y1 + 3], [b.x1 - w, b.y1 + 3], [b.x0, b.y0 - 3 - h], [b.x1 - w, b.y0 - 3 - h]];
      for (const [lx, ly] of spots) {
        if (lx < inner + 4 || lx + w > W - inner - 4 || colGap(lx) < 10 || colGap(lx + w) < 10 || (!narrow && lx < colL && lx + w > colR)) continue;
        // Clear of the rose and the title block as the page opens (a panning chart slides beneath them later).
        if (onFurniture(lx, ly - panBase, lx + w, ly + h - panBase, 2)) continue;
        if (!chart.pan && (blocked(lx, ly, 2) || blocked(lx + w, ly + h, 2))) continue;
        if (hitBoxes(lx, ly, lx + w, ly + h, 2, b)) continue;
        o.lab = { x: lx, y: ly, w, h, txt };
        boxes.push({ x0: lx, y0: ly, x1: lx + w, y1: ly + h });
        break;
      }
    }
  }
  // Place names, most important first, each at the nearest clean spot to its charted position: inside the neat
  // line, clear of the column and of everything already set, wholly on its own medium (water names on water,
  // land names on land) and joined to its spot through that medium, so a name never jumps a shore.
  function placeNames() {
    names = [];
    const list = chart.names.slice().sort((/** @type {any} */ a, /** @type {any} */ b) => a.p - b.p);
    for (const nm of list) {
      if (narrow ? nm.p > 1 : nm.p > 3) continue;
      const st = NAME_STYLE[nm.k] || NAME_STYLE.land, wet = nm.k === 'water' || nm.k === 'lake';
      ctx.font = st.f; ctx.letterSpacing = '0px';
      const tw = ctx.measureText(nm.t).width + st.ls * (nm.t.length - 1), th = st.px * 1.15;
      const ax = (nm.x - x0) * s, ay = nm.y * s;
      if (ax < -nm.r || ax > W + nm.r) continue;
      let an = null;
      if (waterS(ax, ay) === wet) an = { x: ax, y: ay };
      for (let r = 6; !an && r <= 60; r += 6) for (let a = 0; a < 12; a++) {
        const x = ax + Math.cos((a * TAU) / 12) * r, y = ay + Math.sin((a * TAU) / 12) * r;
        if (waterS(x, y) === wet) { an = { x, y }; break; }
      }
      if (!an) continue;
      let found = null;
      for (let rot = 0; rot < (wet ? 2 : 1) && !found; rot++) {
        const hw = (rot ? th : tw) / 2 + 2, hh = (rot ? tw : th) / 2 + 1;
        for (const r of RADII) {
          if (r > nm.r || found) break;
          for (let a = 0; a < (r ? 16 : 1); a++) {
            const cx = an.x + Math.cos((a * TAU) / 16) * r, cy = an.y + Math.sin((a * TAU) / 16) * r;
            if (nameOk(cx, cy, hw, hh, wet, an)) { found = { x: cx, y: cy, hw, hh, rot }; break; }
          }
        }
      }
      if (!found) continue;
      names.push({ t: nm.t, k: nm.k, x: found.x, y: found.y, hw: found.hw, hh: found.hh, rot: found.rot });
      boxes.push({ x0: found.x - found.hw, y0: found.y - found.hh, x1: found.x + found.hw, y1: found.y + found.hh });
    }
  }
  function nameOk(/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ hw, /** @type {number} */ hh, /** @type {boolean} */ wet, /** @type {{ x: number, y: number }} */ an) {
    if (cx - hw < inner + 6 || cx + hw > W - inner - 6 || cy - hh < 4 || cy + hh > SH - 4) return false;
    if (!narrow && cx + hw > colL - 14 && cx - hw < colR + 14) return false;
    if (onFurniture(cx - hw, cy - hh - panBase, cx + hw, cy + hh - panBase, 6)) return false;
    if (hitBoxes(cx - hw, cy - hh, cx + hw, cy + hh, 6, null)) return false;
    for (let iy = -1; iy <= 1; iy++) for (let ix = -1; ix <= 1; ix++) if (waterS(cx + ix * hw, cy + iy * hh) !== wet) return false;
    const n = Math.floor(Math.hypot(cx - an.x, cy - an.y) / 7);
    for (let k = 1; k < n; k++) if (waterS(an.x + ((cx - an.x) * k) / n, an.y + ((cy - an.y) * k) / n) !== wet) return false;
    return true;
  }
  function addGapped(/** @type {Path2D} */ path, /** @type {number[]} */ P, /** @type {Float32Array} */ cum, /** @type {number[][]} */ gaps) {
    let gi = 0, pen = false;
    for (let k = 0; k < cum.length - 1; k++) {
      const s0 = cum[k], s1 = cum[k + 1], seg = s1 - s0;
      let q = s0;
      if (seg <= 0) continue;
      while (q < s1) {
        while (gi < gaps.length && gaps[gi][1] <= q) gi++;
        const g = gi < gaps.length ? gaps[gi] : null;
        if (g && g[0] <= q) { q = Math.min(s1, g[1]); pen = false; continue; }
        const e = g ? Math.min(s1, g[0]) : s1, t0 = (q - s0) / seg, t1 = (e - s0) / seg;
        const dx = P[2 * k + 2] - P[2 * k], dy = P[2 * k + 3] - P[2 * k + 1];
        if (!pen) { path.moveTo(P[2 * k] + dx * t0, P[2 * k + 1] + dy * t0); pen = true; }
        path.lineTo(P[2 * k] + dx * t1, P[2 * k + 1] + dy * t1);
        q = e;
      }
    }
  }
  // Isobaths as paths (plain, and gapped where a depth label sits in the line), deepest first.
  function buildContours(/** @type {() => number} */ rnd) {
    plain = new Map(); gapped = new Map(); clabels = [];
    const sets = chart.contours.slice().sort((/** @type {any} */ a, /** @type {any} */ b) => b.depth - a.depth);
    levels = sets.map((/** @type {any} */ c) => c.depth).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
    ctx.font = SFONT; ctx.letterSpacing = '0px';
    const tmp = { x: 0, y: 0, a: 0, k: 0 }, tb = { x: 0, y: 0, a: 0, k: 0 };
    for (const set of sets) {
      const L = set.depth, pp = new Path2D(), gp = new Path2D();
      const txt = String(L), half = ctx.measureText(txt).width / 2 + 4;
      for (const line of set.lines) {
        const P = toS(line.p);
        if (line.closed) P.push(P[0], P[1]);
        if (P.length < 4) continue;
        lines.push({ P, closed: line.closed });
        addRing(pp, P, false);
        const cum = cumLen(P), total = cum[cum.length - 1], gaps = [];
        for (let d = 90 + rnd() * 150; d < total - half - 8; d += 260) {
          pointAt(P, cum, d, tmp);
          const x = tmp.x, y = tmp.y;
          let ok = !sheetBlocked(x, y, 14) && !hitBoxes(x - 9, y - 7, x + 9, y + 7, 2, null);
          for (let m = 0; ok && m < clabels.length; m++) { const dx = clabels[m].x - x, dy = clabels[m].y - y; if (dx * dx + dy * dy < 1600) ok = false; }
          if (!ok) continue;
          pointAt(P, cum, Math.max(0, d - 8), tb);
          const bx = tb.x, by = tb.y;
          pointAt(P, cum, Math.min(total, d + 8), tb);
          let ang = Math.atan2(tb.y - by, tb.x - bx);
          if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
          clabels.push({ x, y, a: ang, t: txt }); gaps.push([d - half, d + half]);
        }
        addGapped(gp, P, cum, gaps);
      }
      plain.set(L, pp); gapped.set(L, gp);
    }
  }
  // Is any line segment within the ellipse (hw, hh) around (x, y)? Used to keep sounding figures off the lines.
  function lineNear(/** @type {any} */ sh, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ hw, /** @type {number} */ hh) {
    const c = sh.cell, i0 = Math.floor((x - hw) / c), i1 = Math.floor((x + hw) / c), j0 = Math.floor((y - hh) / c), j1 = Math.floor((y + hh) / c);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const list = sh.map.get(j * 100003 + i);
      if (!list) continue;
      for (const q of list) {
        const ax = (sh.seg[q] - x) / hw, ay = (sh.seg[q + 1] - y) / hh, bx = (sh.seg[q + 2] - x) / hw, by = (sh.seg[q + 3] - y) / hh;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 > 0 ? clamp(-(ax * dx + ay * dy) / l2, 0, 1) : 0;
        const px = ax + dx * t, py = ay + dy * t;
        if (px * px + py * py < 1) return true;
      }
    }
    return false;
  }
  function segHash() {
    const cell = 24, map = new Map(), seg = /** @type {number[]} */ ([]);
    for (const { P } of lines) for (let k = 0; k + 3 < P.length; k += 2) {
      const q = seg.length;
      seg.push(P[k], P[k + 1], P[k + 2], P[k + 3]);
      const i0 = Math.floor(Math.min(P[k], P[k + 2]) / cell), i1 = Math.floor(Math.max(P[k], P[k + 2]) / cell);
      const j0 = Math.floor(Math.min(P[k + 1], P[k + 3]) / cell), j1 = Math.floor(Math.max(P[k + 1], P[k + 3]) / cell);
      if (i1 < -1 || i0 > W / cell + 1) continue;
      for (let j = j0; j <= j1; j++) for (let i = Math.max(-1, i0); i <= i1; i++) {
        const key = j * 100003 + i;
        let l = map.get(key);
        if (!l) map.set(key, (l = []));
        l.push(q);
      }
    }
    return { cell, map, seg };
  }
  // Soundings: the model's, in its order, kept where the figure sits clear of the column, the lines, the names
  // and the symbols; then the resting set, an even sparse subset.
  function buildSoundings() {
    const sh = segHash(), xs = [], ys = [];
    sTxt = [];
    for (const v of chart.soundings) {
      const X = (v[0] - x0) * s, Y = v[1] * s;
      if (Y < -20 || Y > SH + 20 || sheetBlocked(X, Y, 10) || colGap(X) < 30) continue;
      const txt = String(Math.round(v[2])), hw = txt.length * 2.9 + 2;
      // Wider air beside a label than above it: a figure set in line with an aid's legend reads as part of it.
      if (!waterS(X, Y) || lineNear(sh, X, Y, hw, 6.5) || hitBoxes(X - hw - 7, Y - 6, X + hw + 7, Y + 6, 3, null)) continue;
      let ok = true;
      for (let m = 0; ok && m < clabels.length; m++) { const dx = clabels[m].x - X, dy = clabels[m].y - Y; if (dx * dx + dy * dy < 400) ok = false; }
      for (let m = xs.length - 1; ok && m >= 0; m--) { const dx = xs[m] - X, dy = ys[m] - Y; if (dx * dx + dy * dy < 256) ok = false; }
      if (!ok) continue;
      xs.push(X); ys.push(Y); sTxt.push(txt);
    }
    sN = xs.length; sX = new Float32Array(xs); sY = new Float32Array(ys); sRest = new Uint8Array(sN);
    hashW = Math.ceil(W / hashC) + 1; hashH = Math.ceil(SH / hashC) + 1;
    const nc = hashW * hashH, cnt = new Int32Array(nc + 1), cellOf = new Int32Array(sN);
    let k;
    for (k = 0; k < sN; k++) {
      const c = clamp((sX[k] / hashC) | 0, 0, hashW - 1) + clamp((sY[k] / hashC) | 0, 0, hashH - 1) * hashW;
      cellOf[k] = c; cnt[c + 1]++;
    }
    for (k = 0; k < nc; k++) cnt[k + 1] += cnt[k];
    hashStart = cnt.slice(); hashItems = new Int32Array(sN);
    const fill = cnt.slice();
    for (k = 0; k < sN; k++) hashItems[fill[cellOf[k]]++] = k;
    const R2 = narrow ? 90 * 90 : 68 * 68, picked = [];
    for (k = 0; k < sN; k++) {
      let far = true;
      for (let m = 0; far && m < picked.length; m++) { const dx = sX[picked[m]] - sX[k], dy = sY[picked[m]] - sY[k]; if (dx * dx + dy * dy < R2) far = false; }
      if (far) { picked.push(k); sRest[k] = 1; }
    }
  }
  function near(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ R, /** @type {(k: number, d: number) => boolean | void} */ fn) {
    const i0 = Math.max(0, ((x - R) / hashC) | 0), i1 = Math.min(hashW - 1, ((x + R) / hashC) | 0);
    const j0 = Math.max(0, Math.floor((y - R) / hashC)), j1 = Math.min(hashH - 1, Math.floor((y + R) / hashC));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * hashW + i;
      for (let q = hashStart[c]; q < hashStart[c + 1]; q++) {
        const k = hashItems[q], dx = sX[k] - x, dy = sY[k] - y, d2 = dx * dx + dy * dy;
        if (d2 <= R * R && fn(k, Math.sqrt(d2)) === false) return;
      }
    }
  }

  // ---------- drawing: the sheet ----------
  function snapRect(/** @type {CanvasRenderingContext2D} */ g, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ lw) {
    const wd = Math.max(1, Math.round(lw * dpr)), off = wd % 2 ? 0.5 : 0;
    const xa = (Math.round(x * dpr) + off) / dpr, ya = (Math.round(y * dpr) + off) / dpr;
    const xb = (Math.round((x + w) * dpr) + off) / dpr, yb = (Math.round((y + h) * dpr) + off) / dpr;
    g.lineWidth = wd / dpr; g.strokeRect(xa, ya, xb - xa, yb - ya);
  }
  function strokeLevels(/** @type {CanvasRenderingContext2D} */ g, /** @type {Map<number, Path2D>} */ paths) {
    for (const L of levels) { const p = paths.get(L); if (p) g.stroke(p); }
  }
  // Isobath labels whose centre lies in [xa, xb] x [ya, yb] (sheet px); g carries the sheet transform `base`.
  function drawCLabels(/** @type {CanvasRenderingContext2D} */ g, /** @type {number} */ a, /** @type {number[]} */ base, /** @type {number} */ xa, /** @type {number} */ ya, /** @type {number} */ xb, /** @type {number} */ yb) {
    g.font = SFONT; g.letterSpacing = '0px'; g.fillStyle = COL.ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.globalAlpha = a;
    for (const l of clabels) {
      if (l.x < xa || l.x > xb || l.y < ya || l.y > yb) continue;
      const c = Math.cos(l.a), sn = Math.sin(l.a);
      g.setTransform(base[0] * c, base[0] * sn, -base[0] * sn, base[0] * c, base[1] + base[0] * l.x, base[2] + base[0] * l.y);
      g.fillText(l.t, 0, 0.5);
    }
    g.setTransform(base[0], 0, 0, base[0], base[1], base[2]);
  }
  function flare(/** @type {CanvasRenderingContext2D} */ g, /** @type {number} */ x, /** @type {number} */ y) {
    // A light's flare: a magenta teardrop, its point on the light.
    g.save(); g.translate(x, y); g.rotate(-2.3);
    g.beginPath(); g.moveTo(1.6, 0); g.quadraticCurveTo(5.5, -2.4, 9, -2.2); g.arc(9, 0, 2.2, -Math.PI / 2, Math.PI / 2); g.quadraticCurveTo(5.5, 2.4, 1.6, 0);
    g.globalAlpha = 0.62; g.fillStyle = COL.accent; g.fill();
    g.restore();
  }
  function drawFeature(/** @type {CanvasRenderingContext2D} */ g, /** @type {any} */ o) {
    const f = o.f, X = o.X, Y = o.Y;
    g.strokeStyle = COL.ink; g.fillStyle = COL.ink; g.lineWidth = 0.8; g.setLineDash([]);
    if (f.type === 'buoy') {
      // Lateral buoy: a leaning lozenge on its position circle; red (nun) filled in the chart's magenta, green
      // (can) open. The colour is also spelled out in the label, as on the paper chart.
      if (f.lit) flare(g, X, Y);
      const a = -Math.PI / 2 + 0.45, ca = Math.cos(a), sa = Math.sin(a), bx = X + ca * 1.9, by = Y + sa * 1.9, L = 9.5, w = 1.9;
      const mx = bx + ca * L * 0.5, my = by + sa * L * 0.5;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(mx - sa * w, my + ca * w); g.lineTo(bx + ca * L, by + sa * L); g.lineTo(mx + sa * w, my - ca * w); g.closePath();
      g.globalAlpha = 0.9;
      if (f.red) { g.fillStyle = COL.accent; g.fill(); g.strokeStyle = COL.accent; g.stroke(); }
      else { g.fillStyle = COL.bg; g.fill(); g.stroke(); }
      g.strokeStyle = COL.ink; g.globalAlpha = 0.85; g.beginPath(); g.arc(X, Y, 1.7, 0, TAU); g.stroke();
    } else if (f.type === 'light') {
      flare(g, X, Y);
      g.globalAlpha = 0.9; g.beginPath(); g.arc(X, Y, 1.5, 0, TAU); g.fill();
    } else if (f.type === 'bridge' && o.R) {
      // The deck in outline, as charted.
      g.beginPath(); addRing(/** @type {any} */ (g), o.R, true);
      g.globalAlpha = 1; g.fillStyle = COL.bg; g.fill(); g.globalAlpha = 0.7; g.lineWidth = 0.7; g.stroke();
    } else if (f.type === 'foul' && o.R) {
      g.globalAlpha = 0.6; g.setLineDash([0.9, 2.2]); g.beginPath(); addRing(/** @type {any} */ (g), o.R, true); g.stroke(); g.setLineDash([]);
    } else if (f.type === 'crib') {
      g.globalAlpha = 0.6; g.lineWidth = 0.75; g.strokeRect(X - 1.6, Y - 1.6, 3.2, 3.2);
    } else if (f.type === 'snag') {
      g.globalAlpha = 0.6; g.beginPath(); g.arc(X, Y, 1.1, 0, TAU); g.fill();
    } else if (f.type === 'obstn') {
      g.globalAlpha = 0.6; g.setLineDash([0.9, 2]); g.beginPath(); g.arc(X, Y, 5, 0, TAU); g.stroke(); g.setLineDash([]);
    } else if (f.type === 'rock') {
      // Rock that covers and uncovers: a cross with a dot in each quarter.
      g.globalAlpha = 0.7; g.lineWidth = 0.75; g.beginPath(); g.moveTo(X - 3.2, Y); g.lineTo(X + 3.2, Y); g.moveTo(X, Y - 3.2); g.lineTo(X, Y + 3.2); g.stroke();
      for (let q = 0; q < 4; q++) { g.beginPath(); g.arc(X + (q & 1 ? 2 : -2), Y + (q & 2 ? 2 : -2), 0.55, 0, TAU); g.fill(); }
    } else if (f.type === 'spire') {
      g.globalAlpha = 0.65; g.lineWidth = 0.75; g.beginPath(); g.arc(X, Y, 2.4, 0, TAU); g.moveTo(X, Y - 2.4); g.lineTo(X, Y - 6.5); g.stroke();
      g.beginPath(); g.arc(X, Y, 0.7, 0, TAU); g.fill();
    } else if (f.type === 'monument') {
      g.globalAlpha = 0.65; g.lineWidth = 0.75; g.beginPath(); g.moveTo(X - 1.5, Y + 1.5); g.lineTo(X - 0.7, Y - 4.5); g.lineTo(X, Y - 6); g.lineTo(X + 0.7, Y - 4.5); g.lineTo(X + 1.5, Y + 1.5);
      g.moveTo(X - 3, Y + 1.5); g.lineTo(X + 3, Y + 1.5); g.stroke();
    } else if (f.type === 'wreck') {
      g.globalAlpha = 0.5; g.lineWidth = 0.9; g.beginPath();
      g.moveTo(X - 7, Y); g.lineTo(X + 7, Y);
      g.moveTo(X - 3.5, Y - 3); g.lineTo(X - 3.5, Y + 3); g.moveTo(X, Y - 3.8); g.lineTo(X, Y + 3.8); g.moveTo(X + 3.5, Y - 3); g.lineTo(X + 3.5, Y + 3);
      g.stroke();
      g.setLineDash([0.8, 2.4]); g.lineWidth = 0.8; g.beginPath(); g.arc(X, Y, 11, 0, TAU); g.stroke(); g.setLineDash([]);
    }
    if (o.lab) {
      g.font = LFONT; g.letterSpacing = '0px'; g.fillStyle = COL.ink; g.globalAlpha = 0.62; g.textAlign = 'left'; g.textBaseline = 'middle';
      for (let k = 0; k < o.lab.txt.length; k++) g.fillText(o.lab.txt[k], o.lab.x, o.lab.y + 5 + 10 * k);
    }
  }
  function drawNames(/** @type {CanvasRenderingContext2D} */ g, /** @type {number} */ ya, /** @type {number} */ yb) {
    g.fillStyle = COL.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const n of names) {
      if (n.y + n.hh < ya || n.y - n.hh > yb) continue;
      const st = NAME_STYLE[n.k] || NAME_STYLE.land;
      g.font = st.f; g.letterSpacing = st.ls + 'px'; g.globalAlpha = st.a;
      g.save(); g.translate(n.x, n.y); if (n.rot) g.rotate(-Math.PI / 2); g.fillText(n.t, st.ls / 2, 0.5); g.restore();
    }
    g.letterSpacing = '0px';
  }
  // Linework fades to 40% under the column (which also carries the page's own panel), feathered 64 px.
  function contentMask(/** @type {CanvasRenderingContext2D} */ g, /** @type {number} */ ya, /** @type {number} */ h) {
    if (narrow) return;
    const Fe = 64, Mk = 0.6;
    const st = (/** @type {CanvasGradient} */ gr, /** @type {boolean} */ inv) => {
      for (let k = 0; k <= 6; k++) { const t = k / 6; gr.addColorStop(t, 'rgba(0,0,0,' + (Mk * smooth(0, 1, inv ? 1 - t : t)).toFixed(3) + ')'); }
      return gr;
    };
    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,' + Mk + ')'; g.fillRect(colL, ya, colR - colL, h);
    g.fillStyle = st(g.createLinearGradient(colL - Fe, 0, colL, 0), false); g.fillRect(colL - Fe, ya, Fe, h);
    g.fillStyle = st(g.createLinearGradient(colR, 0, colR + Fe, 0), true); g.fillRect(colR, ya, Fe, h);
    g.globalCompositeOperation = 'source-over';
  }
  // The cached sheet: the chart from sheet y (p - M) to (p + H + M). Linework first, then the fills slid in
  // beneath it: land on top, then the deeper bands, then shoal water under all.
  function paintA(/** @type {number} */ p) {
    panA = p; aValid = true;
    const g = A.g, ya = p - M, yb = p + H + M, st = reduced;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.setLineDash([]);
    g.clearRect(0, 0, A.c.width, A.c.height);
    const base = [dpr, 0, -ya * dpr];
    g.setTransform(dpr, 0, 0, dpr, 0, -ya * dpr); g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = COL.faint; g.lineWidth = 0.75; g.globalAlpha = 1;
    strokeLevels(g, st ? gapped : plain);
    if (coastPath) { g.strokeStyle = COL.ink; g.globalAlpha = 0.42; g.lineWidth = 0.8; g.stroke(coastPath); }
    if (st) drawCLabels(g, 0.5, base, -1e9, ya - 20, 1e9, yb + 20);
    for (const o of feats) if (o.b.y1 > ya - 30 && o.b.y0 < yb + 30) drawFeature(g, o);
    drawNames(g, ya, yb);
    g.font = SFONT; g.letterSpacing = '0px'; g.fillStyle = COL.ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.globalAlpha = 0.36;
    for (let k = 0; k < sN; k++) if (sRest[k] && sY[k] > ya - 10 && sY[k] < yb + 10) g.fillText(sTxt[k], sX[k], sY[k]);
    contentMask(g, ya, yb - ya);
    g.globalCompositeOperation = 'destination-over'; g.globalAlpha = 1;
    if (landPath) { g.fillStyle = COL.land; g.fill(landPath, 'evenodd'); }
    tintPaths.forEach((tp, k) => { g.fillStyle = TINT_COL[Math.min(k, TINT_COL.length - 1)]; g.fill(tp, 'evenodd'); });
    g.fillStyle = COL.shoal; g.fillRect(-8, ya, W + 16, yb - ya);
    g.globalCompositeOperation = 'source-over';
  }
  function drawNeat(/** @type {CanvasRenderingContext2D} */ g) {
    const o = outer, i = inner, bw = i - o;
    const nH = Math.max(4, Math.round((W - 2 * i) / (small ? 30 : 42))), lh = (W - 2 * i) / nH;
    const nV = Math.max(4, Math.round((H - 2 * i) / (small ? 30 : 42))), lv = (H - 2 * i) / nV;
    let k;
    g.fillStyle = COL.bg; g.globalAlpha = 1; g.beginPath(); g.rect(0, 0, W, H); g.rect(i, i, W - 2 * i, H - 2 * i); g.fill('evenodd');
    g.fillStyle = COL.ink; g.globalAlpha = isDark ? 0.3 : 0.26;
    for (k = 0; k < nH; k += 2) { g.fillRect(i + k * lh, o, lh, bw); g.fillRect(i + k * lh, H - i, lh, bw); }
    for (k = 1; k < nV; k += 2) { g.fillRect(o, i + k * lv, bw, lv); g.fillRect(W - i, i + k * lv, bw, lv); }
    g.strokeStyle = COL.ink; g.globalAlpha = 0.5; snapRect(g, o, o, W - 2 * o, H - 2 * o, 1);
    g.globalAlpha = 0.42; snapRect(g, i, i, W - 2 * i, H - 2 * i, 1 / dpr);
    g.globalAlpha = 0.28; g.lineWidth = 1 / dpr; g.beginPath();
    const sx = (/** @type {number} */ v) => (Math.round(v * dpr) + 0.5) / dpr;
    for (k = 1; k < nH * 5; k++) if (k % 5) { const x = sx(i + (k * lh) / 5); g.moveTo(x, i); g.lineTo(x, i + 2.5); g.moveTo(x, H - i); g.lineTo(x, H - i - 2.5); }
    for (k = 1; k < nV * 5; k++) if (k % 5) { const y = sx(i + (k * lv) / 5); g.moveTo(i, y); g.lineTo(i + 2.5, y); g.moveTo(W - i, y); g.lineTo(W - i - 2.5, y); }
    g.stroke();
  }
  // Compass rose: true ring in degrees with a star at true north; the magnetic ring inside it turned by the
  // charted variation, which is written across its south side.
  function drawRose(/** @type {CanvasRenderingContext2D} */ g) {
    const cx = rose.x, cy = rose.y, R = rose.r, A0 = isDark ? 0.42 : 0.5, v = chart.varDeg || 0;
    let d, b, len;
    if (R <= 0) return;
    g.save(); g.beginPath(); g.rect(inner, inner, W - 2 * inner, H - 2 * inner); g.clip();
    g.strokeStyle = COL.accent; g.fillStyle = COL.accent; g.globalAlpha = A0; g.lineWidth = 0.75;
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.moveTo(cx + R - 12, cy); g.arc(cx, cy, R - 12, 0, TAU); g.stroke();
    g.lineWidth = 0.6; g.beginPath();
    for (d = 0; d < 360; d++) {
      len = d % 10 === 0 ? 7 : d % 5 === 0 ? 4.5 : 2.5; b = (d * Math.PI) / 180;
      g.moveTo(cx + Math.sin(b) * R, cy - Math.cos(b) * R); g.lineTo(cx + Math.sin(b) * (R - len), cy - Math.cos(b) * (R - len));
    }
    const Rm = R * 0.62;
    g.moveTo(cx + Rm, cy); g.arc(cx, cy, Rm, 0, TAU);
    for (d = 0; d < 360; d += 5) {
      len = d % 30 === 0 ? 6 : 3; b = ((d + v) * Math.PI) / 180;
      g.moveTo(cx + Math.sin(b) * Rm, cy - Math.cos(b) * Rm); g.lineTo(cx + Math.sin(b) * (Rm - len), cy - Math.cos(b) * (Rm - len));
    }
    g.stroke();
    // magnetic north: a half arrowhead on the inner ring
    b = (v * Math.PI) / 180;
    const ux = Math.sin(b), uy = -Math.cos(b);
    g.beginPath(); g.moveTo(cx + ux * (Rm + 7), cy + uy * (Rm + 7)); g.lineTo(cx + ux * (Rm - 4) - uy * 3.2, cy + uy * (Rm - 4) + ux * 3.2); g.lineTo(cx + ux * (Rm - 4), cy + uy * (Rm - 4)); g.closePath(); g.fill();
    // true north star
    const sy = cy - R + 19, sr = 4.6;
    g.beginPath();
    for (let k = 0; k < 10; k++) { const r2 = k % 2 ? sr * 0.42 : sr, t = (k * Math.PI) / 5; if (k) g.lineTo(cx + Math.sin(t) * r2, sy - Math.cos(t) * r2); else g.moveTo(cx, sy - r2); }
    g.closePath(); g.fill();
    if (R >= 80) {
      g.font = '6.5px ' + MONO; g.letterSpacing = '0px'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (d = 30; d < 360; d += 30) {
        b = (d * Math.PI) / 180;
        g.save(); g.translate(cx + Math.sin(b) * (R - 19), cy - Math.cos(b) * (R - 19)); g.rotate(b); g.fillText(String(d), 0, 0.5); g.restore();
      }
    }
    for (let k = 0; k < 8; k++) {
      b = (k * Math.PI) / 4;
      const Lp = k % 2 ? R * 0.24 : R * 0.4, w = k % 2 ? 2.8 : 4.6;
      const tx = cx + Math.sin(b) * Lp, ty = cy - Math.cos(b) * Lp, lx = cx - Math.cos(b) * w, ly = cy - Math.sin(b) * w, rx = cx + Math.cos(b) * w, ry = cy + Math.sin(b) * w;
      g.globalAlpha = A0 * 0.55; g.beginPath(); g.moveTo(cx, cy); g.lineTo(tx, ty); g.lineTo(lx, ly); g.closePath(); g.fill();
      g.globalAlpha = A0; g.lineWidth = 0.7; g.beginPath(); g.moveTo(lx, ly); g.lineTo(tx, ty); g.lineTo(rx, ry); g.stroke();
    }
    if (chart.varText && R >= 64) {
      g.globalAlpha = Math.min(1, A0 * 1.5); g.font = (R >= 80 ? '7.5px ' : '6.5px ') + MONO; g.letterSpacing = '0.3px'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(chart.varText, cx + 0.15, cy + Rm * 0.7);
      g.letterSpacing = '0px';
    }
    g.restore();
  }
  function drawTitle(/** @type {CanvasRenderingContext2D} */ g, /** @type {TitleSpec} */ spec) {
    const b = titleBox;
    if (!b || !titleLines) return;
    const cx = (b.x0 + b.x1) / 2;
    g.globalAlpha = 0.93; g.fillStyle = COL.bg; g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    g.strokeStyle = COL.ink; g.globalAlpha = 0.42; snapRect(g, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 1);
    g.globalAlpha = 0.2; snapRect(g, b.x0 + 3, b.y0 + 3, b.x1 - b.x0 - 6, b.y1 - b.y0 - 6, 1 / dpr);
    g.fillStyle = COL.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    let y = b.y0 + 8;
    for (const l of titleLines) {
      g.font = l.f; g.letterSpacing = l.ls + 'px'; g.globalAlpha = l.a; g.fillText(l.t, cx + l.ls / 2, y + l.h / 2 + 0.5);
      y += l.h;
    }
    const cr = spec.credit;
    if (cr) {
      y += 4;
      g.globalAlpha = 0.25; g.fillRect(Math.round(cx - 14), Math.round(y), 28, 1 / dpr);
      y += 5;
      g.font = cr.f; g.letterSpacing = cr.ls + 'px'; g.globalAlpha = cr.a; g.fillText(cr.t, cx + cr.ls / 2, y + cr.h / 2 + 0.5);
    }
    g.letterSpacing = '0px';
  }
  // The chart pans beneath the fixed rose, so the rose sits on a veil of paper: thin over land, so the land tint
  // reads through, and thick over water, so the soundings sliding under it don't fight the rings. It follows the
  // pan, in a small layer repainted only when the pan has changed.
  function drawVeil() {
    if (rose.r <= 0 || !waterClip) return;
    const ox = rose.x - rose.r - 3, oy = rose.y - rose.r - 3;
    if (veilPan !== pan) {
      veilPan = pan;
      const g = VL.g;
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      g.clearRect(0, 0, VL.c.width, VL.c.height);
      g.save();
      g.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
      g.beginPath(); g.arc(rose.x, rose.y, rose.r + 1.5, 0, TAU); g.clip();
      g.fillStyle = COL.bg; g.globalAlpha = 0.3; g.fillRect(ox, oy, 2 * rose.r + 6, 2 * rose.r + 6);
      g.setTransform(dpr, 0, 0, dpr, -ox * dpr, -(oy + pan) * dpr);
      g.globalAlpha = 0.72; g.fill(waterClip, 'evenodd');     // 0.3 then 0.72: 0.8 of paper over the water
      g.restore();
    }
    ctx.drawImage(VL.c, Math.round(ox * dpr), Math.round(oy * dpr));
  }
  function paintF() {
    const g = F.g;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.clearRect(0, 0, F.c.width, F.c.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.lineJoin = 'round'; g.lineCap = 'round';
    drawRose(g); drawNeat(g); drawTitle(g, chart.title);
    g.globalAlpha = 1;
  }
  function sizeLayer(/** @type {{ c: HTMLCanvasElement }} */ L, /** @type {number} */ w, /** @type {number} */ h) { L.c.width = Math.max(1, Math.round(w * dpr)); L.c.height = Math.max(1, Math.round(h * dpr)); }
  function targetPan() {
    const p = chart && chart.pan && !reduced ? panBase + PARALLAX * scrollTop() : panBase;
    return Math.round(clamp(p, 0, panMax) * dpr) / dpr;
  }
  function rebuild() {
    layout();
    yK = 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    pulses = []; wgrid = null;
    if (mode === 'wait') { chart = null; render(); return; }
    furniture(mode === 'real' ? real.title : PROC_TITLE);
    chart = mode === 'real' ? real : fromProcedural(frameSpec());
    const fit = chart.fit({ W, H, colL, colR, narrow });
    s = fit.s; x0 = fit.x0; SH = chart.h * s;
    panBase = fit.top * s; panMax = Math.max(0, SH - H);
    M = chart.pan && !reduced ? Math.round(clamp(0.4 * H, 160, 400)) : 0;
    landIdx = polyIndex(chart.land, chart.h / 144);
    if (mode === 'real') pickRose();               // needs the fit and the land; everything placed below avoids it
    buildPaths();
    placeFeatures(); placeNames();
    buildContours(mulberry32(fnv1a(SEED + '|sheet'))); buildSoundings();
    sizeLayer(A, W, H + 2 * M); sizeLayer(F, W, H); sizeLayer(VL, rose.r > 0 ? 2 * rose.r + 6 : 1, rose.r > 0 ? 2 * rose.r + 6 : 1);
    veilPan = NaN;
    paintF();
    if (SC && MK) {
      const S = Math.ceil((2 * LENS_R + 4) * dpr);
      SC.c.width = SC.c.height = S; MK.c.width = MK.c.height = S;
      const mg = MK.g, gr = mg.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, LENS_R * dpr);
      for (let k = 0; k <= 8; k++) gr.addColorStop(k / 8, 'rgba(0,0,0,' + (1 - smooth(0.55, 1, k / 8)).toFixed(3) + ')');
      mg.setTransform(1, 0, 0, 1, 0, 0); mg.clearRect(0, 0, S, S); mg.fillStyle = gr; mg.fillRect(0, 0, S, S);
    }
    aValid = false; pan = targetPan();
    render(); dirty = false;
  }

  // ---------- waves: arrival time of a surface wave at c = sqrt(g h), by fast marching ----------
  // The grid is sheet-aligned around the view (8 px cells), land rasterized from the shoreline polygons.
  function waveGrid() {
    const c = WCELL, gx0 = -2 * c, gw = Math.ceil(W / c) + 5;
    const gy0 = Math.floor((pan - 0.3 * H) / c) * c, gh = Math.ceil((1.6 * H) / c) + 5;
    if (wgrid && wgrid.gy0 === gy0 && wgrid.gw === gw && wgrid.gh === gh) return wgrid;
    const N = gw * gh, slow = new Float32Array(N).fill(Infinity), land = new Uint8Array(N);
    for (let j = 0; j < gh; j++) {
      const wy = (gy0 + j * c) / s, row = j * gw;
      if (wy < 0 || wy > chart.h || !landIdx) { land.fill(1, row, row + gw); continue; }
      idxCross(landIdx, wy, XS);
      for (let k = 0; k + 1 < XS.length; k += 2) {
        const i0 = Math.max(0, Math.ceil(((XS[k] - x0) * s - gx0) / c)), i1 = Math.min(gw - 1, Math.floor(((XS[k + 1] - x0) * s - gx0) / c));
        for (let i = i0; i <= i1; i++) land[row + i] = 1;
      }
    }
    // c = sqrt(g h) in m/s, h the charted depth plus the datum offset in metres; kc scales it to px/s so that a
    // crest in REF_FT of charted water crosses the viewport in CROSS_S. Land nodes keep an infinite slowness.
    const kc = W / CROSS_S / Math.sqrt(GRAVITY * (REF_FT + chart.datumFt) * FT_M);
    for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
      const n = j * gw + i, wx = (gx0 + i * c) / s + x0, wy = (gy0 + j * c) / s;
      if (land[n] || wx < 0 || wx > chart.w) continue;
      let ft = chart.depthAt(wx, wy);
      if (!(ft > 0.5)) ft = 0.5;
      slow[n] = c / (kc * Math.sqrt(GRAVITY * (ft + chart.datumFt) * FT_M));
    }
    wgrid = { gx0, gy0, gw, gh, c, slow };
    return wgrid;
  }
  /** @type {Uint8Array | null} */
  let fState = null;
  /** @type {Int32Array | null} */
  let heapN = null;
  /** @type {Float32Array | null} */
  let heapK = null;
  const AX = [0, 0, 0], AY = [0, 0, 0];
  function march(/** @type {any} */ G, /** @type {number} */ px, /** @type {number} */ py) {
    const gw = G.gw, gh = G.gh, c = G.c, slow = G.slow, N = gw * gh, Tm = new Float32Array(N).fill(Infinity), Inf = Infinity;
    let size = 0;
    if (!fState || !heapN || !heapK || fState.length !== N) { fState = new Uint8Array(N); heapN = new Int32Array(5 * N + 64); heapK = new Float32Array(5 * N + 64); }
    const st = fState, hN = heapN, hK = heapK;
    st.fill(0);
    function push(/** @type {number} */ n, /** @type {number} */ k) {
      if (size >= hN.length) return;
      let i = size++;
      while (i > 0) { const p = (i - 1) >> 1; if (hK[p] <= k) break; hN[i] = hN[p]; hK[i] = hK[p]; i = p; }
      hN[i] = n; hK[i] = k;
    }
    // Second-order upwind (FMM2): two frozen points per axis when available keeps fronts round.
    function axis(/** @type {number} */ m, /** @type {number} */ sd, /** @type {boolean} */ lo, /** @type {boolean} */ hi, /** @type {number[]} */ out) {
      const a = st[m - sd] === 2 ? Tm[m - sd] : Inf, b = st[m + sd] === 2 ? Tm[m + sd] : Inf;
      let t1, t2;
      if (a === Inf && b === Inf) { out[0] = 0; return; }
      if (a <= b) { t1 = a; t2 = lo && st[m - 2 * sd] === 2 ? Tm[m - 2 * sd] : Inf; }
      else { t1 = b; t2 = hi && st[m + 2 * sd] === 2 ? Tm[m + 2 * sd] : Inf; }
      if (t2 <= t1) { out[0] = 2.25; out[1] = (4 * t1 - t2) / 3; } else { out[0] = 1; out[1] = t1; }
      out[2] = t1;
    }
    function solve(/** @type {number} */ m) {
      const i = m % gw, j = (m / gw) | 0, f = slow[m];
      axis(m, 1, i >= 2, i <= gw - 3, AX); axis(m, gw, j >= 2, j <= gh - 3, AY);
      const ax = AX[0], ay = AY[0], bx = AX[1], by = AY[1];
      if (!ay) return ax ? bx + f / Math.sqrt(ax) : Inf;
      if (!ax) return by + f / Math.sqrt(ay);
      const Aq = ax + ay, Bq = ax * bx + ay * by, disc = Bq * Bq - Aq * (ax * bx * bx + ay * by * by - f * f);
      if (disc >= 0) { const t = (Bq + Math.sqrt(disc)) / Aq; if (t >= AX[2] && t >= AY[2]) return t; }
      return Math.min(bx + f / Math.sqrt(ax), by + f / Math.sqrt(ay));
    }
    const fx = (px - G.gx0) / c, fy = (py - G.gy0) / c, ci = Math.round(fx), cj = Math.round(fy);
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 1 || j < 1 || i > gw - 2 || j > gh - 2) continue;
      const n = j * gw + i, d = Math.hypot(i - fx, j - fy) * c;
      if (slow[n] === Inf || d > 3.2 * c) continue;
      const t = (d / c) * slow[n];
      if (t < Tm[n]) { Tm[n] = t; push(n, t); }
    }
    if (!size) return null;
    const NB = [-1, 1, -gw, gw];
    while (size) {
      const top = hN[0], key = hK[0];
      size--;
      if (size) {
        const ln = hN[size], lk = hK[size];
        let q = 0;
        for (;;) {
          const l = 2 * q + 1;
          if (l >= size) break;
          const r = l + 1, m = r < size && hK[r] < hK[l] ? r : l;
          if (hK[m] >= lk) break;
          hN[q] = hN[m]; hK[q] = hK[m]; q = m;
        }
        hN[q] = ln; hK[q] = lk;
      }
      if (st[top] === 2 || key > Tm[top]) continue;
      if (key > LIFE + 0.2) break;                 // nothing later than the crest lifetime is ever drawn
      st[top] = 2;
      for (let b = 0; b < 4; b++) {
        const mm = top + NB[b];
        if (st[mm] === 2 || slow[mm] === Inf) continue;
        const t = solve(mm);
        if (t < Tm[mm]) { Tm[mm] = t; push(mm, t); }
      }
    }
    const gw1 = gw - 1, Q = gw1 * (gh - 1), qmin = new Float32Array(Q), qmax = new Float32Array(Q);
    for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw1; i++) {
      const n = j * gw + i, a = Tm[n], bb = Tm[n + 1], cc = Tm[n + gw + 1], dd = Tm[n + gw], hi = Math.max(a, bb, cc, dd), qi = j * gw1 + i;
      if (hi === Inf) { qmin[qi] = Inf; qmax[qi] = -Inf; } else { qmin[qi] = Math.min(a, bb, cc, dd); qmax[qi] = hi; }
    }
    return { T: Tm, qmin, qmax, born: sim, G };
  }
  function crests(/** @type {any} */ p, /** @type {number[]} */ taus, /** @type {Path2D[]} */ paths) {
    const G = p.G, gw = G.gw, gh = G.gh, c = G.c, gw1 = gw - 1, Tm = p.T, qmin = p.qmin, qmax = p.qmax;
    let tmin = Infinity, tmax = -Infinity;
    for (const t of taus) if (t > 0.02) { tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
    if (tmax < 0) return;
    for (let j = 0; j < gh - 1; j++) {
      const row = j * gw1;
      for (let i = 0; i < gw1; i++) {
        const q = row + i, lo = qmin[q];
        if (lo >= tmax) continue;
        const hi = qmax[q];
        if (hi < tmin) continue;
        for (let k = 0; k < taus.length; k++) {
          const tau = taus[k];
          if (tau <= 0.02 || lo >= tau || hi < tau) continue;
          const n = j * gw + i, a = Tm[n], b = Tm[n + 1], cc = Tm[n + gw + 1], d = Tm[n + gw];
          const pr = pairsFor((a < tau ? 8 : 0) | (b < tau ? 4 : 0) | (cc < tau ? 2 : 0) | (d < tau ? 1 : 0), (a + b + cc + d) / 4 < tau);
          if (!pr) continue;
          for (let e = 0; e < pr.length; e++) {
            edgeAt(pr[e][0], i, j, a, b, cc, d, tau);
            const xa = G.gx0 + EX * c, ya = G.gy0 + EY * c;
            edgeAt(pr[e][1], i, j, a, b, cc, d, tau);
            const xb = G.gx0 + EX * c, yb = G.gy0 + EY * c;
            const dc = colGap((xa + xb) / 2), bk = dc <= 0 ? 3 : dc < 22 ? 2 : dc < 44 ? 1 : 0;
            paths[k * 4 + bk].moveTo(xa, ya); paths[k * 4 + bk].lineTo(xb, yb);
          }
        }
      }
    }
  }
  function spawnPulse(/** @type {number} */ x, /** @type {number} */ y) {
    if (!chart || !waterS(x, y + pan)) return false;
    const p = march(waveGrid(), x, y + pan);
    if (!p) return false;
    if (pulses.length >= MAX_PULSES) pulses.shift();
    pulses.push(p); schedule();
    return true;
  }

  // ---------- per-frame drawing ----------
  const lensK = () => 1 - 0.5 * (1 - smooth(0, 48, colGap(lens.x)));
  function lensDepth() {
    const wx = lens.x / s + x0, wy = (lens.y + pan) / s;
    return waterAt(wx, wy) ? chart.depthAt(wx, wy) : -1;
  }
  // The sounder's lens: heavier isobaths, the shoreline and isobath labels, drawn into a small patch and
  // feathered out with a radial mask.
  function drawLensPatch(/** @type {number} */ a) {
    if (!SC || !MK) return;
    const R = LENS_R, S = SC.c.width, sx = Math.round((lens.x - R - 2) * dpr), sy = Math.round((lens.y - R - 2) * dpr);
    const g = SC.g, oy = sy + Math.round(pan * dpr), base = [dpr, -sx, -oy];
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, S, S);
    g.setTransform(dpr, 0, 0, dpr, -sx, -oy); g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = COL.ink; g.lineWidth = 1.1; g.globalAlpha = 0.55;
    strokeLevels(g, gapped);
    if (coastPath) { g.globalAlpha = 0.78; g.lineWidth = 1.15; g.stroke(coastPath); }
    const cy = lens.y + pan;
    drawCLabels(g, 0.85, base, lens.x - R - 16, cy - R - 16, lens.x + R + 16, cy + R + 16);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(MK.c, 0, 0); g.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = a; ctx.drawImage(SC.c, sx, sy); ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function drawLensSoundings(/** @type {number} */ a) {
    let n = 0;
    const R = LENS_R;
    ctx.font = SFONT; ctx.letterSpacing = '0px'; ctx.fillStyle = COL.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    near(lens.x, lens.y + pan, R, (k, d) => {
      const w = 1 - smooth(0.55 * R, R, d);
      if (w <= 0.01) return true;
      ctx.globalAlpha = a * w * 0.92; ctx.fillText(sTxt[k], sX[k], sY[k] - pan);
      return ++n < 40;
    });
  }
  function drawChip(/** @type {number} */ a) {
    const h = lensDepth();
    if (!(h > 0) || a < 0.01) return;
    const num = String(Math.max(1, Math.round(h)));
    ctx.font = '11px ' + MONO; ctx.letterSpacing = '0px';
    const wn = ctx.measureText(num).width, wu = ctx.measureText(' ft').width, bw = Math.round(wn + wu + 12), bh = 18;
    const L = lens.hold ? 34 : 12.7, up = lens.y - 3 - L - bh > inner + 4 ? 1 : -1;
    let dir = 1;
    const gap = (/** @type {number} */ d) => { const ex = lens.x + (3 + L) * d, bx = d > 0 ? ex : ex - bw; return narrow ? 1e5 : Math.max(colL - (bx + bw), 0, bx - colR); };
    if (lens.x + 3 + L + bw > W - inner - 6 || (gap(1) < 24 && gap(-1) > gap(1))) dir = -1;   // lean away from the edge and the column
    a *= smooth(0, 24, gap(dir));                                                         // a boxed number never sits under the prose
    if (a < 0.01) return;
    const sx = lens.x + 3 * dir, sy = lens.y - 3 * up, ex = lens.x + (3 + L) * dir, ey = lens.y - (3 + L) * up;
    const bx = Math.round(dir > 0 ? ex : ex - bw) + 0.5, by = Math.round(up > 0 ? ey - bh : ey) + 0.5;
    ctx.globalAlpha = a * 0.6; ctx.strokeStyle = COL.ink; ctx.lineWidth = 0.75;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.globalAlpha = a; ctx.fillStyle = COL.surface; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = COL.border; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = COL.ink; ctx.fillText(num, bx + 6, by + bh / 2 + 0.5);
    ctx.fillStyle = COL.muted; ctx.fillText(' ft', bx + 6 + wn, by + bh / 2 + 0.5);
  }
  const crestPaths = () => { const a = []; for (let k = 0; k < 12; k++) a.push(new Path2D()); return a; };
  function drawPulses() {
    if (!waterClip) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, -Math.round(pan * dpr));
    ctx.clip(waterClip, 'evenodd');                // crests stop at the shore as charted
    ctx.strokeStyle = COL.ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const p of pulses) {
      const age = sim - p.born;
      if (age >= LIFE) continue;
      const taus = [age, age - GAP, age - 2 * GAP], paths = crestPaths();
      crests(p, taus, paths);
      const base = 0.36 * (1 - smooth(0.35 * LIFE, LIFE, age));
      for (let k = 0; k < 3; k++) {
        if (taus[k] <= 0.02) continue;
        ctx.lineWidth = k ? 0.8 : 1;
        for (let bk = 0; bk < 4; bk++) { ctx.globalAlpha = base * (1 - 0.3 * k) * Math.min(1, taus[k] / 0.25) * DIM[bk]; ctx.stroke(paths[k * 4 + bk]); }
      }
    }
    ctx.restore();
  }
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (!chart) { ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
    if (!aValid || Math.abs(pan - panA) > Math.max(0, M - 2)) paintA(pan);
    ctx.drawImage(A.c, 0, Math.round((panA - M - pan) * dpr));
    drawVeil();
    ctx.drawImage(F.c, 0, 0);
    if (reduced) return;                         // one still frame, redrawn only on resize
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const la = lens.s * lensK();
    if (la > 0.004 || pulses.length) {
      ctx.save(); if (CLIP) ctx.clip(CLIP, 'evenodd');
      if (la > 0.004) drawLensPatch(la);
      if (pulses.length) drawPulses();
      if (la > 0.004) drawLensSoundings(la);
      ctx.restore();
      if (la > 0.004) drawChip(la);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- loop ----------
  const live = () => lens.x !== lens.tx || lens.y !== lens.ty || lens.s !== lens.ts || pulses.length > 0;
  function schedule() {
    if (raf || destroyed || reduced || doc.visibilityState === 'hidden') return;
    raf = win.requestAnimationFrame(frame);
  }
  function update(/** @type {number} */ dt) {
    if (lens.init) {
      const e = 1 - Math.exp(-dt / 0.05);
      lens.x += (lens.tx - lens.x) * e; lens.y += (lens.ty - lens.y) * e;
      if (Math.abs(lens.tx - lens.x) < 0.05 && Math.abs(lens.ty - lens.y) < 0.05) { lens.x = lens.tx; lens.y = lens.ty; }
    }
    lens.s += (lens.ts - lens.s) * (1 - Math.exp(-dt / 0.14)); if (Math.abs(lens.ts - lens.s) < 0.004) lens.s = lens.ts;
    for (let q = pulses.length - 1; q >= 0; q--) if (sim - pulses[q].born >= LIFE) pulses.splice(q, 1);
  }
  function frame(/** @type {number} */ ts) {
    raf = 0;
    if (destroyed || doc.visibilityState === 'hidden') return;
    const dt = lastTs ? Math.min(0.05, Math.max(0, (ts - lastTs) / 1000)) : 1 / 60;
    lastTs = ts; sim += dt;
    if (chart) { const p = targetPan(); if (p !== pan) { pan = p; dirty = true; } }
    update(dt);
    const on = live();
    if (on || dirty) { render(); dirty = false; }
    if (on) schedule(); else lastTs = 0;
  }

  // ---------- input (never in reduced motion) ----------
  const isBackground = (/** @type {any} */ t) => t === doc.body || t === doc.documentElement;
  const hasSelection = () => { try { const q = win.getSelection && win.getSelection(); return !!(q && !q.isCollapsed); } catch (err) { return false; } };
  function onMove(/** @type {PointerEvent} */ e) {
    if (e.pointerType === 'touch') {
      if (down && lpTimer && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) lpTimer = cancel(lpTimer);
      return;
    }
    if (W <= 2560 && nextDpr() !== dpr) onResize(); // moved to a display with another pixel ratio (no resize event)
    lens.tx = e.clientX; lens.ty = e.clientY * yK; lens.hold = false;
    if (!lens.init || lens.s < 0.01) { lens.x = lens.tx; lens.y = lens.ty; lens.init = true; }
    lens.ts = chart ? 1 : 0; schedule();
  }
  function onDown(/** @type {PointerEvent} */ e) {
    lpTimer = cancel(lpTimer);
    if (e.isPrimary === false || e.button > 0) { down = null; return; }   // a second finger or another button is never a tap
    const bg = isBackground(e.target);
    // The selection is read now: the press's default action collapses it before the release arrives.
    down = { x: e.clientX, y: e.clientY, t: now(), id: e.pointerId, touch: e.pointerType === 'touch', bg, sel: hasSelection() };
    if (down.touch && bg) {                          // long-press open background: hold the sounder there
      lpTimer = later(() => {
        lpTimer = 0;
        if (!down || !chart) return;
        lens.x = lens.tx = down.x; lens.y = lens.ty = down.y * yK; lens.init = true; lens.hold = true; lens.ts = 1; schedule();
      }, 500);
    }
  }
  function release() {
    lpTimer = cancel(lpTimer);
    if (lens.hold) { lens.hold = false; lens.ts = 0; schedule(); }
  }
  function onCancel() { release(); down = null; }
  function onOut(/** @type {PointerEvent} */ e) { if (e.relatedTarget) return; lens.ts = 0; schedule(); }
  // A click or tap on open background sends a wave. This listens for pointerup, not click: iOS Safari sends
  // no click to window listeners for taps on non-interactive elements such as body. A scroll ends in
  // pointercancel, so it never gets here.
  function onUp(/** @type {PointerEvent} */ e) {
    const d0 = down;
    if (d0 && e.pointerId !== d0.id) return;
    release();
    down = null;
    if (!d0 || !d0.bg || !isBackground(e.target)) return;
    if (Math.hypot(e.clientX - d0.x, e.clientY - d0.y) >= 6) return;
    if (d0.touch && now() - d0.t > 500) return;     // that was a long-press
    if (d0.sel || hasSelection()) return;           // a press that dismisses a text selection is not a tap
    spawnPulse(e.clientX, e.clientY * yK);
  }
  function onScroll() { if (chart && chart.pan && targetPan() !== pan) { dirty = true; schedule(); } }
  function onVis() {
    if (doc.visibilityState === 'hidden') { if (raf) { win.cancelAnimationFrame(raf); raf = 0; } lastTs = 0; return; }
    if (chart && targetPan() !== pan) dirty = true;
    if (dirty || live()) schedule();
  }
  function onResize() {
    resizeT = cancel(resizeT);
    resizeT = later(() => {
      resizeT = 0;
      const nd = nextDpr(), c = readColumn(), w = viewW(), h = viewH();
      const same = c.left === colSeen.left && c.right === colSeen.right && (W > 2560 || nd === dpr) && w === W;
      // Mobile toolbars change the height as the page scrolls; don't redraw the lake for that. The bitmap
      // stretches to the new height until the next rebuild, so input is scaled onto the sheet meanwhile.
      if (same && (h === H || (coarse && Math.abs(h - H) < 160))) { yK = H / h; return; }
      rebuild();
    }, 160);
  }
  // The chart: fetched once; a failed fetch gets the procedural lake, an aborted one (destroy) nothing.
  function adopt(/** @type {'real' | 'proc'} */ m) {
    if (destroyed || mode !== 'wait') return;
    mode = m;
    try { rebuild(); }
    catch (e) { if (m === 'real') { mode = 'wait'; real = null; adopt('proc'); } }
  }
  function load() {
    try {
      if (typeof win.fetch !== 'function') { adopt('proc'); return; }
      abort = typeof win.AbortController === 'function' ? new win.AbortController() : null;
      win.fetch(DATA_URL, abort ? { signal: abort.signal } : {})
        .then((r) => { if (!r || !r.ok) throw new Error('chart unavailable'); return r.json(); })
        .then((d) => {
          if (destroyed) return;
          let m = null;
          try { m = fromData(d); } catch (e) { m = null; }
          if (m) { real = m; adopt('real'); } else adopt('proc');
        })
        .catch(() => { if (!destroyed) adopt('proc'); });
    } catch (e) { adopt('proc'); }
  }

  const LO = { passive: true };
  /** @type {Array<[string, (e: any) => void]>} */
  const PL = reduced ? [] : [['pointermove', onMove], ['pointerdown', onDown], ['pointerup', onUp], ['pointercancel', onCancel], ['pointerout', onOut], ['scroll', onScroll]];
  rebuild();                                         // the plain paper, until the chart arrives
  for (const [type, fn] of PL) win.addEventListener(type, fn, LO);
  win.addEventListener('resize', onResize, LO);
  if (!reduced) doc.addEventListener('visibilitychange', onVis, LO);
  const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(onResize) : null;
  if (ro) ro.observe(canvas);                         // also catches a scrollbar appearing (the column moves)
  load();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (abort) { try { abort.abort(); } catch (e) { /* already settled */ } abort = null; }
      if (raf) win.cancelAnimationFrame(raf);
      raf = 0;
      timers.forEach((id) => win.clearTimeout(id)); timers.clear();
      for (const [type, fn] of PL) win.removeEventListener(type, fn);
      win.removeEventListener('resize', onResize);
      if (!reduced) doc.removeEventListener('visibilitychange', onVis);
      if (ro) ro.disconnect();
      pulses = []; wgrid = null; real = chart = null; landIdx = null; fState = heapN = heapK = null;
      for (const L of [A, F, VL, SC, MK]) if (L) { L.c.width = 0; L.c.height = 0; }
    },
  };
}
