// Below the Noise Floor: a radio waterfall. Frequency runs left to right, time flows down, and
// the pointer is the VFO. Rows only advance while something is happening (squelch); otherwise
// the display holds and renders nothing. The content column is treated as a notch filter, so the
// stations and the activity live in the gutters.

const SPAN = 48; // kHz across the viewport (fictional, relative)
const ROWS_PER_S = 8, ROW_S = 1 / ROWS_PER_S, ROW_PX = 3;
const DIT = 0.1; // 12 wpm
const A_CW = 60, A_DMR = 30, A_FT = 60, QRN_ADD = 5.3, DMR_AVG = 0.64;
const F_CW = -17.6, F_FT = -21.4, F_DMR = 16.4; // kHz offsets
const SQ_DB = 6, HUD_DB = 3, HANG = 1500, HOLD_CAP = 30000, POINTER_LIVE = 3000;
const RULER_H = 30; // the frequency scale across the top of the viewport
const NARROW = 120; // gutters narrower than this get the calm full-bleed version
const RING_SLACK = 40; // spare history rows, so a mobile URL bar collapsing doesn't resynthesize it
const HUD_W = 264, HUD_WMIN = 100, HUD_HMAX = 160;
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const MINUS = '−';

const PHRASES = ['SIGNAL OVER NOISE', 'DEFENSE IN DEPTH', 'TRUST BUT VERIFY', '73'];
/** @type {Record<string, string>} */
const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..', 0: '-----', 1: '.----',
  2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
};
/** @type {Record<string, string>} */
const DEMORSE = {};
for (const k of Object.keys(MORSE)) DEMORSE[MORSE[k]] = k;

// CW beacon timeline in dit units: "VVV <phrase>" rotating. ps/pe mark each phrase's span.
const CW = (() => {
  /** @type {number[]} */
  const bits = [], ps = [], pe = [];
  const gap = (/** @type {number} */ n) => { while (n-- > 0) bits.push(0); };
  const letter = (/** @type {string} */ ch) => {
    const code = MORSE[ch];
    for (let i = 0; i < code.length; i++) {
      if (i) gap(1);
      for (let n = code[i] === '.' ? 1 : 3; n > 0; n--) bits.push(1);
    }
  };
  const word = (/** @type {string} */ w) => {
    for (let i = 0; i < w.length; i++) { if (i) gap(3); letter(w[i]); }
  };
  for (const phrase of PHRASES) {
    word('VVV'); gap(7);
    ps.push(bits.length);
    phrase.split(' ').forEach((w, i) => { if (i) gap(7); word(w); });
    pe.push(bits.length);
    gap(14);
  }
  return { bits: Uint8Array.from(bits), len: bits.length, ps, pe };
})();

/** @param {number} a */
function hash32(a) {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}
/** @param {number} seed */
function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) + 0.5) / 4294967296; };
}

// DMR bursts and QRN impulses: seeded schedules on a 600 s wall-clock period.
const DMR = (() => {
  const r = seeded(0x51ed0d), a = [];
  let t = 0;
  while (t < 590) { const on = t + 4 + 4 * r(), off = Math.min(600, on + 3 + 7 * r()); a.push(on, off); t = off; }
  return a;
})();
const QRN = (() => {
  const r = seeded(0x9a7c11), a = [];
  let t = 12 + 20 * r();
  while (t < 600) { a.push(t); t += 40 + 50 * r(); }
  return a;
})();
const COSTAS = [3, 1, 4, 0, 6, 5, 2];

/** @param {number} a @param {number} n */
function mod(a, n) { return ((a % n) + n) % n; }
/** @param {number} t */
function cwInst(t) { return CW.bits[mod(Math.floor(t / DIT), CW.len)]; }
/** @param {number} t */
function dmrInst(t) {
  const tm = mod(t, 600);
  for (let i = 0; i < DMR.length; i += 2) { if (tm < DMR[i]) return 0; if (tm < DMR[i + 1]) return 1; }
  return 0;
}
/** 8-FSK on real 15 s cycles: 79 symbols x 0.16 s from second 0.5. @param {number} t */
function ftTone(t) {
  const cyc = Math.floor(t / 15), tc = t - cyc * 15 - 0.5;
  if (tc < 0 || tc >= 12.64) return -1;
  if (hash32((cyc * 7919) | 0) % 5 === 0) return -1; // some cycles stay quiet
  const s = (tc / 0.16) | 0;
  if (s < 7) return COSTAS[s];
  if (s >= 36 && s < 43) return COSTAS[s - 36];
  if (s >= 72) return COSTAS[s - 72];
  return hash32(((cyc * 131) | 0) + s) & 7;
}
/** Any impulse within (t - w, t]. @param {number} t @param {number} w */
function qrnIn(t, w) {
  const tm = mod(t, 600);
  for (let i = 0; i < QRN.length; i++) { const d = tm - QRN[i]; if (d >= 0 && d < w) return true; }
  return false;
}

/** @typedef {[number, number, number]} RGB */
/** @param {string} h @returns {RGB} */
function hexRgb(h) {
  h = String(h || '#000').trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** @param {RGB} a @param {RGB} b @param {number} t @returns {RGB} */
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
/** @param {RGB} c @param {number} [a] */
function rgba(c, a = 1) { return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`; }
/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
/** @param {number} e0 @param {number} e1 @param {number} x */
function sstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
/** @param {number} k @param {number} dp */
function signed(k, dp) { const s = Math.abs(k).toFixed(dp); return (k < -1e-9 && +s !== 0 ? MINUS : '+') + s; }

/**
 * @typedef {[string, string, number, boolean?]} HudLine text, color, px size, keep on one line
 * @typedef {{ mode: string, right: string, meter: number, cursor?: boolean, lines: HudLine[] }} Hud
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {import('./types').BackgroundOptions} options
 * @returns {import('./types').Background}
 */
export function mount(canvas, options) {
  const reduced = !!options.reducedMotion;
  const isDark = !!options.isDark;
  const pal = options.palette;
  const scaleCv = document.createElement('canvas');
  const hudCv = document.createElement('canvas');
  const ctx0 = canvas.getContext('2d'), sctx0 = scaleCv.getContext('2d'), hctx0 = hudCv.getContext('2d');
  if (!ctx0 || !sctx0 || !hctx0) return { destroy() {} };
  const ctx = ctx0, sctx = sctx0, hctx = hctx0;
  const mq = (/** @type {string} */ q) => { try { return window.matchMedia(q).matches; } catch { return false; } };
  const coarse = mq('(pointer: coarse)'), hoverNone = mq('(hover: none)');

  // ---- palette
  const BG = hexRgb(pal.bg), INK = hexRgb(pal.ink), ACC = hexRgb(pal.accent), FAINT = hexRgb(pal.faint);
  const MUTED = mix(INK, BG, 0.42), HAIR = mix(INK, BG, 0.8);
  const SURF = isDark ? mix(BG, INK, 0.04) : mix(BG, [255, 255, 255], 0.6);
  const C_BG = rgba(BG), C_INK = rgba(INK), C_ACC = rgba(ACC), C_MUTED = rgba(MUTED), C_HAIR = rgba(HAIR), C_LABEL = rgba(MUTED, 0.9);
  const LUT = new Uint32Array(256);
  /** @type {[number, RGB][]} */
  const stops = isDark
    ? [[0, BG], [0.5, FAINT], [0.8, mix(FAINT, ACC, 0.4)], [1, mix(BG, ACC, 0.88)]]
    : [[0, BG], [0.55, FAINT], [0.9, mix(BG, INK, 0.35)], [1, mix(BG, ACC, 0.9)]];
  const V_FAINT = stops[1][0];
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let j = 1;
    while (j < stops.length - 1 && v > stops[j][0]) j++;
    const a = stops[j - 1], b = stops[j];
    let f = (v - a[0]) / (b[0] - a[0]);
    if (j === 1) f = Math.pow(f, isDark ? 1.35 : 1.7); // soft knee: keep the noise floor near bg
    const c = mix(a[1], b[1], f);
    LUT[i] = ((255 << 24) | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0])) >>> 0;
  }

  // ---- geometry and buffers
  let W = 0, H = 0, dpr = 1, B = 0, R = 0, top = RULER_H, binW = 4, hw = 9;
  let panL = 0, panR = 0, colL = 0, colR = 0, wide = true, crowded = false, layoutKey = '';
  let hudOn = true, hudW = HUD_W, hudP = 12, hudX = 24, hudBottom = 0;
  /** @type {HTMLCanvasElement | null} */
  let ring = null;
  /** @type {CanvasRenderingContext2D | null} */
  let rctx = null;
  /** @type {ImageData | null} */
  let rowImg = null;
  let row32 = new Uint32Array(0);
  let raw = new Float32Array(0), sm = raw, db = raw, srt = raw, notchDb = raw, notchN = raw, vcap = raw, peak = raw;
  const ftAcc = new Float32Array(8);
  let cwB = 0, ftB = 0, dmrB = 0, fCw = F_CW, fFt = F_FT, fDmr = F_DMR, built = false;
  let head = 0, phase = 1, rowN = 0, nf = -5.5;
  /** @type {(number | string)[]} */
  let labels = [];
  /** @type {CanvasGradient | null} */
  let pbGrad = null;
  /** @type {CanvasGradient | null} */
  let pbEdge = null;
  /** @type {CanvasGradient | null} */
  let fadeGrad = null;
  let fadeY = 0, pbSpan = 0, charW = 6;
  const rnd = seeded(0x2545f491 ^ Math.floor(Math.random() * 0xffffff));
  /** @type {number | null} */
  let gSpare = null;
  function gauss() {
    if (gSpare !== null) { const s = gSpare; gSpare = null; return s; }
    const u = rnd(), v = rnd(), m = Math.sqrt(-2 * Math.log(u));
    gSpare = m * Math.sin(6.283185307 * v);
    return m * Math.cos(6.283185307 * v);
  }

  // ---- clock: one epoch anchored at mount, everything derived from performance.now()
  const epoch0 = Date.now() / 1000 - performance.now() / 1000;
  const tSec = (/** @type {number} */ ms) => epoch0 + ms / 1000;

  // ---- VFO, pointer, loop state
  let vfoK = coarse && hoverNone ? -23.8 : F_CW, vfo = 0, vfoT = 0, vfoV = 0;
  let lastPointerT = -1e9, holdArmed = false, downX = NaN, downY = NaN, downId = -1;
  let cLo = 0, cHi = 0, cSpeed = 0, moveEnv = 0;
  let rate = 0, raf = 0, lastT = 0, destroyed = false, needBuild = false;
  let visible = document.visibilityState !== 'hidden';
  const scan = { on: false, mode: 0, t: 0, found: 0, last: -1, t0: 0 };

  // ---- receiver and decoder state
  let sumW = 1, sqW2 = 1, gCw = 0, gDmr = 0, ftMax = 0, ident = -1;
  const ftG = new Float32Array(8);
  let snr = -99, identHeld = -1, identUntil = 0, strongUntil = 0, locked = false, qrnUntil = 0;
  const dec = {
    t: 0, y: 0, y2: 0, pm: 0, nzr: 1, bmin: new Float32Array(20), bmax: new Float32Array(20), bi: 0, bn: 0,
    cmin: 1e9, cmax: -1e9, filled: 0, down: false, run: 0, dit: 10, sym: '', out: '', sp: true,
  };
  const armed = [false, false, false, false], marks = [0, 0, 0, 0];
  let prevU = -1, copiedText = '', copiedT = -1e9;
  let hudA = 0, hudTgt = 0, hudT = -1e9, hudKey = '', hudH = 60;
  /** @type {Hud | null} */
  let hudLast = null;

  const kToBin = (/** @type {number} */ k) => (k + SPAN / 2) / SPAN * B - 0.5;
  const binToK = (/** @type {number} */ b) => (b + 0.5) / B * SPAN - SPAN / 2;
  const binToX = (/** @type {number} */ b) => (b + 0.5) * binW;
  const kToX = (/** @type {number} */ k) => (k + SPAN / 2) / SPAN * W;
  const xToK = (/** @type {number} */ x) => x / W * SPAN - SPAN / 2;

  // Stations keep their nominal offsets unless the notched content column would swallow them;
  // then they move out into the gutters (FT8 stays outboard of the CW passband).
  function placeStations() {
    fCw = F_CW; fFt = F_FT; fDmr = F_DMR;
    if (!wide) return;
    const L = colL - 56, Rr = colR + 56;
    if (kToX(fCw) + 3 * binW > L) fCw = Math.floor(xToK(L - 3 * binW) * 10) / 10;
    const ftRight = kToX(fCw) - hw * binW - binW;
    let b0 = Math.round(kToBin(fFt));
    if ((b0 + 9) * binW > ftRight) { b0 = Math.max(2, Math.floor(ftRight / binW) - 9); fFt = Math.floor(binToK(b0) * 10) / 10; }
    if (kToX(fDmr) - 6.5 * binW < Rr) fDmr = Math.ceil(xToK(Math.min(Rr + 6.5 * binW, W - 8 * binW)) * 10) / 10;
  }

  function readColumn() {
    let c = null;
    try { c = options.column(); } catch { c = null; }
    if (c && c.right > c.left) return { left: clamp(c.left, 0, W), right: clamp(c.right, 0, W) };
    return { left: Math.max(16, W / 2 - 368), right: Math.min(W - 16, W / 2 + 368) };
  }

  // ------------------------------------------------------------- build / resize
  function build() {
    needBuild = false;
    W = Math.max(1, Math.round(canvas.clientWidth || window.innerWidth || 1));
    H = Math.max(1, Math.round(canvas.clientHeight || window.innerHeight || 1));
    dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));

    // Wide: the ruler runs across the top and the HUD sits in the left gutter. Narrow: the panel
    // covers nearly everything, so the waterfall runs full-bleed with no ruler, text or HUD.
    const col = readColumn();
    wide = Math.min(col.left, W - col.right) >= NARROW;
    panL = col.left; panR = col.right; // the panel's edges: ruler text stays clear of them
    colL = col.left + 16; colR = col.right - 16;
    crowded = !wide;
    top = crowded ? 0 : RULER_H;
    hudOn = wide;
    hudW = clamp(Math.floor(col.left - 32), HUD_WMIN, HUD_W);
    hudP = hudW < 160 ? 10 : 12;
    hudX = clamp(Math.floor((col.left - hudW) / 2), 10, 24);
    hudBottom = H - Math.max(16, hudX);
    if (!hudOn) hudA = hudTgt = 0;

    // The history is kept across height-only resizes (a mobile URL bar): the ring carries spare
    // rows and is only reallocated when the bin count changes or the viewport outgrows it.
    const nb = clamp(Math.round(W / 4), 240, 480), need = Math.ceil((H - top) / ROW_PX) + 2;
    const fresh = nb !== B || need > R || !ring || !rctx;
    if (fresh) {
      R = need + RING_SLACK;
      B = nb;
      raw = new Float32Array(B); sm = new Float32Array(B); db = new Float32Array(B); srt = new Float32Array(B);
      notchDb = new Float32Array(B); notchN = new Float32Array(B); vcap = new Float32Array(B); peak = new Float32Array(B);
      ring = document.createElement('canvas'); ring.width = B; ring.height = R;
      rctx = ring.getContext('2d');
      if (!rctx) return;
      rowImg = rctx.createImageData(B, 1); row32 = new Uint32Array(rowImg.data.buffer);
    }
    binW = W / B; hw = B * 1.25 / SPAN; // 2.5 kHz passband
    placeStations();
    cwB = kToBin(fCw); ftB = Math.round(kToBin(fFt)); dmrB = Math.round(kToBin(fDmr) - 5.5);
    if (!built && !(coarse && hoverNone)) vfoK = fCw;
    built = true;
    vfo = vfoT = clamp(kToBin(vfoK), 0, B - 1); vfoV = 0; cLo = cHi = vfo;

    // the content column as a notch filter (wide screens only)
    for (let b = 0; b < B; b++) {
      const x = binToX(b), n = wide ? sstep(colL - 56, colL - 8, x) * (1 - sstep(colR + 8, colR + 56, x)) : 0;
      notchDb[b] = 10 * Math.log(1 - 0.75 * n) / Math.LN10;
      notchN[b] = n;
      vcap[b] = 1 - (1 - V_FAINT) * n;
    }
    const d = dpr, Hd = canvas.height, topD = Math.round(top * d);
    ctx.imageSmoothingEnabled = true;
    // The passband's strongest stretch sits at the top of the waterfall, crisp at the dial.
    const pbLen = Math.max(Math.round(60 * d), Math.round((Hd - topD) * 0.72));
    pbSpan = pbLen;
    pbGrad = ctx.createLinearGradient(0, topD, 0, topD + pbLen);
    pbGrad.addColorStop(0, rgba(ACC, isDark ? 0.085 : 0.075)); pbGrad.addColorStop(0.35, rgba(ACC, isDark ? 0.04 : 0.035)); pbGrad.addColorStop(1, rgba(ACC, 0));
    pbEdge = ctx.createLinearGradient(0, topD, 0, topD + pbLen);
    pbEdge.addColorStop(0, rgba(ACC, isDark ? 0.5 : 0.42)); pbEdge.addColorStop(0.22, rgba(ACC, 0.12)); pbEdge.addColorStop(0.6, rgba(ACC, 0));
    fadeY = Math.round(Hd * 0.6);
    fadeGrad = ctx.createLinearGradient(0, fadeY, 0, Hd);
    fadeGrad.addColorStop(0, rgba(BG, 0)); fadeGrad.addColorStop(1, rgba(BG, 0.6));
    ctx.font = '10px ' + MONO; charW = ctx.measureText('0').width || 6;
    buildScale();
    hudCv.width = Math.max(1, Math.round(hudW * d)); hudCv.height = Math.max(1, Math.round(HUD_HMAX * d)); hudKey = '';
    if (hudOn && hudLast) renderHud(hudLast); // resizing cleared the HUD; keep what it was showing

    // Synthesize the history so the page opens on a full, still spectrogram. Everything baked
    // into the pixels (bins, width, notch) is in the key; a height-only resize keeps the ring.
    const key = [B, W, Math.round(colL), Math.round(colR), wide].join('|');
    if (rctx && (fresh || key !== layoutKey)) {
      const hist = rctx.createImageData(B, R), h32 = new Uint32Array(hist.data.buffer), tN = tSec(performance.now());
      peak.fill(0);
      for (let y = R - 1; y >= 0; y--) synthRow(tN - y * ROW_S, h32, y * B, false);
      rctx.putImageData(hist, 0, 0); head = 0;
      dec.nzr = 1;
    }
    layoutKey = key;
    gains();
  }

  function buildScale() {
    labels = [];
    const d = dpr, s = sctx, Wd = canvas.width, topD = Math.round(top * d);
    if (crowded || topD < 1) { scaleCv.width = 1; scaleCv.height = 1; return; }
    scaleCv.width = Wd; scaleCv.height = topD;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.fillStyle = C_BG; s.fillRect(0, 0, Wd, topD);
    s.fillStyle = C_HAIR; s.fillRect(0, topD - 1, Wd, 1);
    const pxk = W / SPAN, step = [4, 8, 12, 24].find((v) => v * pxk >= 72) || 24;
    for (let k = -SPAN / 2; k <= SPAN / 2; k++) {
      const x = Math.round(k * pxk * d + W / 2 * d), major = k % 4 === 0, h = Math.round((major ? 5 : 2.5) * d);
      s.fillStyle = major ? rgba(MUTED, 0.85) : C_HAIR;
      s.fillRect(Math.min(x, Wd - 1), topD - 1 - h, 1, h);
    }
    // Scale labels live in the gutters: one under the panel would only ghost through it, and one
    // across its edge would read as a clipped stub.
    for (let j = -SPAN / 2 + step; j < SPAN / 2; j += step) {
      const xl = W / 2 + j * pxk, txt = j === 0 ? '0.0' : signed(j, 1), half = txt.length * charW / 2 + 8;
      if (xl > 64 && xl < W - 64 && (xl + half <= panL || xl - half >= panR)) labels.push(xl, txt);
    }
  }

  // ------------------------------------------------------------- one waterfall row
  /** @param {number} tEnd @param {Uint32Array} dst @param {number} off @param {boolean} live */
  function synthRow(tEnd, dst, off, live) {
    const n = B;
    let b, i;
    for (b = 0; b < n; b++) raw[b] = -Math.log(rnd());
    sm[0] = 0.75 * raw[0] + 0.25 * raw[1];
    for (b = 1; b < n - 1; b++) sm[b] = 0.25 * raw[b - 1] + 0.5 * raw[b] + 0.25 * raw[b + 1];
    sm[n - 1] = 0.25 * raw[n - 2] + 0.75 * raw[n - 1];
    let eC = 0, eD = 0;
    ftAcc.fill(0);
    for (i = 0; i < 5; i++) { // keying envelope averaged over the row's 125 ms window
      const ts = tEnd - ROW_S + (i + 0.5) * 0.025;
      eC += cwInst(ts); eD += dmrInst(ts);
      const tn = ftTone(ts); if (tn >= 0) ftAcc[tn] += 1;
    }
    if (eC) {
      eC *= A_CW / 5;
      for (b = Math.max(0, Math.floor(cwB - 3)); b <= Math.min(n - 1, Math.ceil(cwB + 3)); b++) { const dc = (b - cwB) / 0.7; sm[b] += eC * Math.exp(-dc * dc); }
    }
    if (eD) { // stylized 2-slot TDMA: block halves alternate by row parity
      eD *= A_DMR / 5;
      const par = rowN & 1;
      for (i = 0; i < 12; i++) {
        const bb = dmrB + i; if (bb < 0 || bb >= n) continue;
        let amp = (i < 6) === (par === 0) ? 1 : 0.28;
        if (i === 0 || i === 11) amp *= 0.5;
        sm[bb] += eD * amp;
      }
    }
    for (i = 0; i < 8; i++) if (ftAcc[i]) {
      const a = A_FT * ftAcc[i] / 5, c = ftB + i;
      if (c >= 0 && c < n) sm[c] += a;
      if (c > 0 && c <= n) sm[c - 1] += 0.18 * a;
      if (c >= -1 && c < n - 1) sm[c + 1] += 0.18 * a;
    }
    if (qrnIn(tEnd, ROW_S)) for (b = 0; b < n; b++) sm[b] += QRN_ADD * (0.6 + 0.8 * rnd());
    // the visitor's carrier: the bins the VFO swept since the last row
    let cA = 0, cl = 1, ch = 0;
    if (live && moveEnv > 0.01) {
      cA = moveEnv * 9 * (0.6 + Math.min(cSpeed, 3000) / 1500);
      cl = Math.max(0, Math.floor(cLo - 2)); ch = Math.min(n - 1, Math.ceil(cHi + 2));
    }
    const inv = 1 / 34;
    for (b = 0; b < n; b++) {
      let p = sm[b];
      const pk = peak[b] * 0.85; peak[b] = p > pk ? p : pk;
      if (b >= cl && b <= ch) { const dd = (b < cLo ? cLo - b : b > cHi ? b - cHi : 0) / 0.7; p += cA * Math.exp(-dd * dd); }
      const dB = 4.342944819 * Math.log(p);
      db[b] = dB;
      let v = (dB + notchDb[b] - nf) * inv;
      v = v < 0 ? 0 : v > vcap[b] ? vcap[b] : v;
      dst[off + b] = LUT[(v * 255) | 0];
    }
    rowN++;
    if ((rowN & 31) === 0) { srt.set(db); srt.sort(); nf += 0.4 * (srt[(n * 0.1) | 0] - nf); }
  }

  /** @param {number} t */
  function pushRow(t) {
    if (!rctx || !rowImg) return;
    synthRow(t, row32, 0, true);
    head = (head - 1 + R) % R;
    rctx.putImageData(rowImg, 0, head);
    cLo = cHi = vfo; cSpeed = 0;
  }

  // ------------------------------------------------------------- receiver
  /** @param {number} dd */
  function wfun(dd) { if (dd < -hw || dd > hw) return 0; const x = dd / (0.32 * hw); return 1 / (1 + x * x); }
  function gains() {
    const lo = Math.max(0, Math.ceil(vfo - hw)), hi = Math.min(B - 1, Math.floor(vfo + hw));
    let s2 = 0;
    sumW = 0; gCw = 0; gDmr = 0;
    for (let b = lo; b <= hi; b++) {
      const w = wfun(b - vfo); sumW += w; s2 += w * w;
      const dc = (b - cwB) / 0.7; if (dc > -4 && dc < 4) gCw += w * Math.exp(-dc * dc);
      const i = b - dmrB; if (i >= 0 && i < 12) gDmr += w * (i === 0 || i === 11 ? 0.5 : 1);
    }
    sumW = sumW || 1e-3; sqW2 = Math.sqrt(s2) || 1e-3; ftMax = 0;
    for (let k = 0; k < 8; k++) {
      const c = ftB + k;
      ftG[k] = wfun(c - vfo) + 0.18 * (wfun(c - 1 - vfo) + wfun(c + 1 - vfo));
      if (ftG[k] > ftMax) ftMax = ftG[k];
    }
    const sc = A_CW * gCw, sd = A_DMR * DMR_AVG * gDmr, sf = A_FT * ftMax, best = Math.max(sc, sd, sf);
    ident = best < 0.5 * sumW ? -1 : best === sc ? 0 : best === sd ? 1 : 2;
  }

  // An honest decoder: samples the same signal model (instantaneous, plus fresh noise) through the passband.
  /** @param {number} t @param {number} now */
  function decSample(t, now) {
    let p = sumW + 2.2 * sqW2 * gauss(); // 10 ms detector samples are noisier than a 125 ms row
    if (p < 0) p = 0;
    if (gCw > 1e-4 && cwInst(t)) p += A_CW * gCw;
    if (gDmr > 1e-4 && dmrInst(t)) p += A_DMR * DMR_AVG * gDmr;
    const tn = ftTone(t); if (tn >= 0) p += A_FT * ftG[tn];
    if (qrnIn(t, 0.06)) { p += QRN_ADD * sumW; qrnUntil = now + 5000; }
    const y = (dec.y += 0.7 * (p - dec.y)), y2 = (dec.y2 += 0.2 * (p - dec.y2));
    dec.pm += (y2 > dec.pm ? 0.6 : 0.012) * (y2 - dec.pm); // S-meter: fast attack, slow decay
    if (A_CW * gCw + A_DMR * gDmr + A_FT * ftMax < 0.05 * sumW) dec.nzr += 0.02 * (y2 / sumW - dec.nzr);
    // running ~2 s min/max in 100 ms blocks; threshold at the midpoint
    if (y < dec.cmin) dec.cmin = y;
    if (y > dec.cmax) dec.cmax = y;
    if (++dec.bn >= 10) {
      dec.bmin[dec.bi] = dec.cmin; dec.bmax[dec.bi] = dec.cmax; dec.bi = (dec.bi + 1) % 20;
      dec.bn = 0; dec.cmin = 1e9; dec.cmax = -1e9; if (dec.filled < 20) dec.filled++;
    }
    let lo = Math.min(dec.cmin, y), hi = Math.max(dec.cmax, y);
    for (let i = 0; i < dec.filled; i++) { if (dec.bmin[i] < lo) lo = dec.bmin[i]; if (dec.bmax[i] > hi) hi = dec.bmax[i]; }
    const rg = hi - lo, thr = lo + rg * 0.5, hys = rg * 0.08;
    const nd = dec.down ? y > thr - hys : y > thr + hys;
    if (nd !== dec.down) {
      if (dec.down) { // a mark just ended
        const m = dec.run;
        if (m < 2 * dec.dit) { dec.sym += '.'; dec.dit += 0.15 * (m - dec.dit); }
        else { dec.sym += '-'; dec.dit += 0.15 * (m / 3 - dec.dit); }
        dec.dit = clamp(dec.dit, 5, 18);
        if (dec.sym.length > 7) { emit('*'); dec.sym = ''; }
      }
      dec.down = nd; dec.run = 0;
    }
    dec.run++;
    if (!dec.down) {
      if (dec.sym && dec.run > 2.5 * dec.dit) { emit(DEMORSE[dec.sym] || '*'); dec.sym = ''; }
      if (!dec.sp && dec.run > 5 * dec.dit) emit(' ');
    }
  }
  /** @param {string} ch */
  function emit(ch) {
    dec.out += ch; dec.sp = ch === ' ';
    if (dec.out.length > 160) {
      const cut = dec.out.length - 100;
      dec.out = dec.out.slice(cut);
      for (let k = 0; k < 4; k++) marks[k] = Math.max(0, marks[k] - cut);
    }
  }
  function decClear() { dec.out = ''; dec.sym = ''; dec.sp = true; dec.dit = 10; dec.down = false; dec.run = 0; }
  /** @param {number} now */
  function decRun(now) {
    const tEnd = tSec(now);
    if (tEnd - dec.t > 0.25) dec.t = tEnd - 0.25;
    while (dec.t + 0.01 <= tEnd) { dec.t += 0.01; decSample(dec.t, now); }
    const noise = dec.nzr * sumW;
    snr = 10 * Math.log(Math.max(dec.pm / noise, 1)) / Math.LN10; // (S+N)/N over the passband
  }

  // phrase copy tracking against the beacon schedule (what the decoder printed over that span)
  /** @param {number} a @param {number} b @param {number} x */
  function crossed(a, b, x) { return a <= b ? a < x && x <= b : x > a || x <= b; }
  /** @param {number} now */
  function trackCopy(now) {
    const u = mod(Math.floor(tSec(now) / DIT), CW.len);
    if (prevU >= 0 && mod(u - prevU, CW.len) <= 3) {
      for (let k = 0; k < PHRASES.length; k++) {
        if (crossed(prevU, u, CW.ps[k])) { armed[k] = locked; marks[k] = dec.out.length; }
        if (crossed(prevU, u, (CW.pe[k] + 6) % CW.len)) {
          if (armed[k] && locked) { // only a clean copy counts; a garbled one keeps the squelch open
            const got = dec.out.slice(marks[k]).trim();
            if (got === PHRASES[k]) { copiedText = got; copiedT = now; }
          }
          armed[k] = false;
        }
      }
    } else prevU = -2; // a jump (tab resume): drop any phrase in flight
    if (!locked || prevU === -2) armed.fill(false);
    prevU = u;
  }

  function zeroBeat() { // centre on the strongest recent signal inside the passband
    const lo = Math.max(0, Math.floor(vfoT - hw)), hi = Math.min(B - 1, Math.ceil(vfoT + hw));
    let bi = -1, bv = 8;
    for (let b = lo; b <= hi; b++) if (peak[b] > bv) { bv = peak[b]; bi = b; }
    if (bi < 0) return;
    let s = 0, sw = 0;
    for (let j = Math.max(0, bi - 7); j <= Math.min(B - 1, bi + 7); j++) { const w = peak[j] - 3; if (w > 0) { s += w * j; sw += w; } }
    vfoT = clamp(sw ? s / sw : bi, 0, B - 1);
  }

  /** @param {number} now */
  function live(now) {
    if (now - lastPointerT < POINTER_LIVE) return true;
    if (scan.on) return true;
    return holdArmed && now - lastPointerT < HOLD_CAP && now < strongUntil && copiedT < lastPointerT;
  }

  /** @param {number} now @param {number} dt */
  function scanStep(now, dt) {
    if (now - scan.t0 > 30000) scan.on = false;
    else if (scan.mode === 0) {
      const near = ident >= 0 && ident !== scan.last; // slow to 6 bins/s across a station
      vfoT = Math.min(B - 1, vfoT + (near ? 6 : Math.max(6, B / 14)) * dt);
      if (ident >= 0 && ident !== scan.last && snr > SQ_DB) { scan.mode = 1; scan.t = 0; scan.last = ident; zeroBeat(); }
      else if (vfoT >= B - 1) scan.on = false;
    } else {
      scan.t += dt;
      if (scan.t >= 6) { scan.found++; if (scan.found >= 2) scan.on = false; else scan.mode = 0; }
    }
    if (!scan.on) holdArmed = false;
  }

  // ------------------------------------------------------------- per frame
  /** @param {number} now @param {number} dt */
  function step(now, dt) {
    if (live(now)) {
      if (rate <= 0) { dec.t = tSec(now) - 0.01; dec.down = false; dec.run = 0; dec.sym = ''; prevU = -1; }
      rate = 1;
    } else if (rate > 0) { // ease the row rate to zero over 1 s
      rate = Math.max(0, rate - dt);
      if (rate === 0 && hudOn) { const hc = hudContent(now, true); if (hc) renderHud(hc); } // settle the HUD for HOLD
    }
    if (scan.on) scanStep(now, dt);
    // critically damped spring: the dial has a little mass
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) { vfoV += (170 * (vfoT - vfo) - 26 * vfoV) * h; vfo += vfoV * h; }
    if (Math.abs(vfoT - vfo) < 0.004 && Math.abs(vfoV) < 0.02) { vfo = vfoT; vfoV = 0; }
    vfoK = binToK(vfo);
    if (vfo < cLo) cLo = vfo;
    if (vfo > cHi) cHi = vfo;
    const sp = Math.abs(vfoV) * binW;
    if (sp > cSpeed) cSpeed = sp;
    moveEnv = sp > 6 ? 1 : Math.max(0, moveEnv - dt / 0.6);
    gains();
    if (rate > 0) {
      decRun(now);
      if (ident >= 0 && snr > HUD_DB) { identHeld = ident; identUntil = now + HANG; }
      if (ident === 0 && snr > SQ_DB) strongUntil = now + HANG;
      const lk = identHeld === 0 && now < identUntil;
      if (lk && !locked) decClear();
      locked = lk;
      trackCopy(now);
      const e = rate * rate * (3 - 2 * rate);
      let rows = 0;
      phase += dt * ROWS_PER_S * e;
      while (phase >= 1 && rows < 4) { phase -= 1; rows++; }
      if (phase >= 1) phase = 0.999;
      const tN = tSec(now);
      for (let r = 0; r < rows; r++) pushRow(tN - (rows - 1 - r) * ROW_S);
    }
    if (hudOn && rate > 0 && now - hudT >= 100) { // HUD text at most 10 Hz
      hudT = now;
      const c = hudContent(now);
      hudTgt = c ? 1 : 0;
      if (c) renderHud(c);
    }
    const da = dt / 0.3;
    hudA = Math.abs(hudTgt - hudA) <= da ? hudTgt : hudA + (hudTgt > hudA ? da : -da);
  }

  const snrStr = () => snr.toFixed(1) + ' dB';
  const rightStr = () => (crowded ? signed(vfoK, 2) + ' kHz  ' : 'SNR ') + snrStr();
  // held: the display just went to HOLD, so nothing in the HUD should look live (no cursor, no clock).
  /** @param {number} now @param {boolean} [held] @returns {Hud | null} */
  function hudContent(now, held = false) {
    const st = now < identUntil ? identHeld : -1, meter = clamp(snr / 30, 0, 1), hold = held && crowded ? ' · hold' : '';
    if (copiedText && copiedT >= lastPointerT && st === 0) {
      return { mode: 'CW · BEACON', right: rightStr(), meter, lines: [[copiedText, C_INK, 12], ['copied in full · squelch closed', C_MUTED, 10]] };
    }
    if (st === 0) {
      const max = Math.max(4, Math.floor((hudW - 2 * hudP - 8) / (charW * 1.2)));
      let t = dec.out.replace(/^ +/, '');
      if (t.length > max) t = t.slice(t.length - max);
      /** @type {Hud} */
      const cw = { mode: 'CW · 12 WPM', right: rightStr(), meter, cursor: !held, lines: [[t, C_INK, 12, true]] };
      if (hold) cw.lines.push(['hold · squelch closed', C_MUTED, 10]);
      return cw;
    }
    if (st === 1) return { mode: 'DMR · 2-SLOT TDMA', right: rightStr(), meter, lines: [['digital voice, not decoded' + hold, C_MUTED, 10]] };
    if (st === 2) {
      const tc = mod(tSec(now), 15);
      /** @type {HudLine[]} */
      const fl = [['not decoded here (by design)' + hold, C_MUTED, 10]];
      if (!held) fl.unshift(['T+' + (tc < 10 ? '0' : '') + tc.toFixed(1) + ' s in cycle', C_INK, 11]);
      return { mode: '8-FSK · 15 S CYCLE', right: rightStr(), meter, lines: fl };
    }
    if (now < qrnUntil) return { mode: 'QRN', right: 'impulse', meter: 1, lines: [['Impulse noise. Probably a', C_INK, 11], ["40-year-old diesel's glow plugs.", C_INK, 11]] };
    return null;
  }

  // Greedy word wrap in the HUD context's current font.
  /** @param {string} text @param {number} maxW */
  function wrapText(text, maxW) {
    const x = hctx, out = [];
    let cur = '';
    for (const w of text.split(' ')) {
      const t = cur ? cur + ' ' + w : w;
      if (!cur || x.measureText(t).width <= maxW) cur = t;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    return out;
  }

  /** @param {Hud} h */
  function renderHud(h) {
    const key = h.mode + '|' + h.right + '|' + h.meter.toFixed(2) + '|' + (h.cursor ? 1 : 0) + '|' + h.lines.map((l) => l[0]).join('|');
    if (key === hudKey) return;
    hudKey = key; hudLast = h;
    const d = dpr, x = hctx, w = hudW, p = hudP, inner = w - 2 * p;
    const fMode = '600 9.5px ' + MONO, fSmall = '9.5px ' + MONO;
    // Header: mode on the left, readout on the right. In a narrow gutter they stack.
    x.font = fSmall; const rightW = x.measureText(h.right).width;
    x.font = fMode; const oneRow = x.measureText(h.mode).width + 12 + rightW <= inner;
    const headRows = oneRow ? [h.mode] : wrapText(h.mode, inner);
    const extra = (headRows.length - 1 + (oneRow ? 0 : 1)) * 12;
    /** @type {HudLine[]} */
    const body = [];
    for (const l of h.lines) {
      x.font = l[2] + 'px ' + MONO;
      if (l[3]) { // one line, newest text kept (the decoder's tail)
        let t = l[0];
        while (t && x.measureText(t).width > inner - 8) t = t.slice(1);
        body.push([t, l[1], l[2]]);
      } else for (const s of wrapText(l[0], inner)) body.push([s, l[1], l[2]]);
    }
    const maxBody = Math.max(1, Math.floor((HUD_HMAX - 38 - extra) / 16));
    if (body.length > maxBody) body.length = maxBody;
    hudH = 38 + extra + body.length * 16;

    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, hudCv.width, hudCv.height);
    x.setTransform(d, 0, 0, d, 0, 0);
    x.beginPath();
    const r = 3, hp = 0.5 / d, x0 = hp, y0 = hp, x1 = w - hp, y1 = hudH - hp; // one device-pixel hairline
    x.moveTo(x0 + r, y0); x.arcTo(x1, y0, x1, y1, r); x.arcTo(x1, y1, x0, y1, r); x.arcTo(x0, y1, x0, y0, r); x.arcTo(x0, y0, x1, y0, r); x.closePath();
    x.fillStyle = rgba(SURF, 0.94); x.fill();
    x.lineWidth = 1 / d; x.strokeStyle = C_HAIR; x.stroke();
    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.font = fMode; x.fillStyle = C_ACC;
    headRows.forEach((s, i) => x.fillText(s, p, 18 + i * 12));
    x.font = fSmall; x.fillStyle = C_MUTED;
    if (oneRow) { x.textAlign = 'right'; x.fillText(h.right, w - p, 18); x.textAlign = 'left'; }
    else x.fillText(h.right, p, 18 + headRows.length * 12);
    const mw = inner; // S-meter: hairline track, 10 dB ticks, accent fill
    x.fillStyle = C_HAIR; x.fillRect(p, 25.5 + extra, mw, 0.5);
    for (let i = 0; i <= 3; i++) x.fillRect(p + Math.round(mw * i / 3), 23.5 + extra, 0.5, 2);
    x.fillStyle = C_ACC; x.fillRect(p, 24.5 + extra, Math.max(0.5, mw * h.meter), 1.5);
    let y = 44 + extra;
    for (let i = 0; i < body.length; i++) {
      const l = body[i];
      x.font = l[2] + 'px ' + MONO; x.fillStyle = l[1]; x.fillText(l[0], p, y);
      if (h.cursor && i === body.length - 1) { x.fillStyle = C_ACC; x.fillRect(p + x.measureText(l[0]).width + 1, y - 9, 1.5, 11); }
      y += 16;
    }
  }

  // ------------------------------------------------------------- draw
  function draw() {
    if (!ring || !pbGrad || !pbEdge || !fadeGrad) return;
    const c = ctx, d = dpr, Wd = canvas.width, Hd = canvas.height, topD = Math.round(top * d), rowD = ROW_PX * d;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const y0 = topD + (phase - 1) * rowD, n1 = R - head;
    c.drawImage(ring, 0, head, B, n1, 0, y0, Wd, n1 * rowD);
    if (head > 0) c.drawImage(ring, 0, 0, B, head, 0, y0 + n1 * rowD, Wd, head * rowD);
    c.fillStyle = fadeGrad; c.fillRect(0, fadeY, Wd, Hd - fadeY);
    // passband: a translucent column that fades with depth, crisp edges at the dial.
    // Behind the content column it steps back.
    const xc = binToX(vfo) * d, half = hw * binW * d, xl = Math.round(xc - half), xr = Math.round(xc + half);
    c.globalAlpha = 1 - 0.6 * notchN[clamp(Math.round(vfo), 0, B - 1)];
    c.fillStyle = pbGrad; c.fillRect(xl, topD, xr - xl, pbSpan);
    c.fillStyle = pbEdge; c.fillRect(xl, topD, 1, pbSpan); c.fillRect(xr - 1, topD, 1, pbSpan);
    c.globalAlpha = 1;
    if (!crowded && scaleCv.height > 1) { // the ruler, with the passband bracket and centre tick
      c.drawImage(scaleCv, 0, 0);
      const t4 = Math.round(4 * d), t11 = Math.round(11 * d), xm = Math.round(xc);
      c.fillStyle = C_ACC;
      c.fillRect(xl, topD - 1, xr - xl, 1); c.fillRect(xl, topD - t4, 1, t4); c.fillRect(xr - 1, topD - t4, 1, t4);
      c.fillRect(xm, topD - t11, 1, t11);
      c.setTransform(d, 0, 0, d, 0, 0);
      drawBandText(c, xc / d);
    }
    if (hudOn && hudA > 0.004 && hudH > 0) {
      c.setTransform(d, 0, 0, d, 0, 0);
      c.globalAlpha = hudA;
      c.drawImage(hudCv, 0, 0, hudCv.width, Math.min(hudCv.height, Math.round(hudH * d)), hudX, hudBottom - hudH, hudW, hudH);
      c.globalAlpha = 1;
    }
  }

  // scale labels, the VFO readout and the RX/HOLD tag, in CSS pixels
  /** @param {CanvasRenderingContext2D} c @param {number} xc */
  function drawBandText(c, xc) {
    c.font = '10px ' + MONO; c.textBaseline = 'alphabetic';
    const ty = 13, held = rate <= 0;
    const a = signed(vfoK, 2), st = locked || (reduced && ident >= 0) ? ident : -1;
    let bTxt = (st >= 0 ? ['CW', 'DMR', '8-FSK'][st] + ' ' : '') + (snr > -90 ? snrStr() : '');
    // The readout sits wholly in the dial's gutter, or wholly under the panel, never across its
    // edge. A gutter too narrow for all of it keeps the frequency (the HUD has the mode and SNR).
    let lo = 64, hi = W - 64;
    if (xc < panL) hi = panL - 8;
    else if (xc > panR) lo = panR + 8;
    else { lo = panL + 8; hi = panR - 8; }
    let tw = (a.length + (bTxt ? bTxt.length + 2 : 0)) * charW;
    if (bTxt && tw > hi - lo) { bTxt = ''; tw = a.length * charW; }
    const bx = clamp(xc - tw / 2, lo, hi - tw);
    c.fillStyle = C_LABEL; c.textAlign = 'center';
    for (let i = 0; i < labels.length; i += 2) {
      const lx = /** @type {number} */ (labels[i]), txt = String(labels[i + 1]), lw = txt.length * charW / 2 + 10;
      if (lx + lw > bx && lx - lw < bx + tw) continue; // the readout pushes scale labels aside
      c.fillText(txt, lx, ty);
    }
    c.textAlign = 'right'; c.fillText('kHz', W - 16, ty); c.textAlign = 'left';
    c.fillStyle = C_INK; c.fillText(a, bx, ty);
    if (bTxt) { c.fillStyle = st >= 0 ? C_ACC : C_MUTED; c.fillText(bTxt, bx + (a.length + 2) * charW, ty); }
    c.fillStyle = held ? C_MUTED : C_ACC; c.fillRect(16, ty - 7, 5, 5);
    c.fillText(held ? 'HOLD' : 'RX', 26, ty);
  }

  // ------------------------------------------------------------- loop
  function frame() {
    raf = 0;
    if (destroyed) return;
    const now = performance.now();
    // Scroll-only frames (dial and HUD at rest) run at ~30 fps: 24 px/s needs no more, and it
    // halves the full-viewport fill on 60 Hz panels (quarters it at 120 Hz). Dial motion keeps full rate.
    if (!needBuild && rate > 0 && vfo === vfoT && vfoV === 0 && hudA === hudTgt && now - lastT < 28) {
      raf = requestAnimationFrame(frame); return;
    }
    let dt = (now - lastT) / 1000;
    dt = dt > 0 ? (dt > 0.1 ? 0.1 : dt) : 0; lastT = now;
    if (needBuild) { build(); if (reduced) staticState(); }
    if (!reduced) step(now, dt);
    draw();
    if (!reduced && visible && (rate > 0 || vfo !== vfoT || vfoV !== 0 || hudA !== hudTgt)) raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (raf || destroyed || !visible) return;
    lastT = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function staticState() { // reduced motion: parked on the beacon, full phrase, no motion
    vfo = vfoT = cwB; vfoK = fCw; gains();
    snr = 10 * Math.log(1 + A_CW * gCw / sumW) / Math.LN10;
    const u = mod(Math.floor(tSec(performance.now()) / DIT), CW.len);
    let k = 0;
    while (k < PHRASES.length - 1 && u >= CW.pe[k] + 14) k++;
    if (hudOn) renderHud({ mode: 'CW · 12 WPM', right: rightStr(), meter: clamp(snr / 30, 0, 1), lines: [['VVV ' + PHRASES[k], C_INK, 12]] });
    hudA = hudTgt = hudOn ? 1 : 0; rate = 0; phase = 1;
  }

  // ------------------------------------------------------------- input
  /** @param {number} x */
  function tuneX(x) {
    if (scan.on) scan.on = false;
    vfoT = clamp(x / binW - 0.5, 0, B - 1);
    lastPointerT = performance.now(); holdArmed = true;
    wake();
  }
  /** @param {PointerEvent | MouseEvent} e */
  const isTouch = (e) => ('pointerType' in e && e.pointerType ? e.pointerType === 'touch' : coarse);
  /** @param {PointerEvent} e */
  function onMove(e) { if (!isTouch(e)) tuneX(e.clientX); } // mouse and pen tune by hovering
  /** @param {PointerEvent} e */
  function onDown(e) {
    if (e.isPrimary === false) return;
    downX = e.clientX; downY = e.clientY; downId = e.pointerId;
  }
  // Touch: tap the page background to tune, then zero-beat. This listens for pointerup, not click:
  // iOS Safari sends no click to window listeners for taps on non-interactive elements such as
  // body. A scroll or pinch ends in pointercancel, so it never gets here.
  /** @param {PointerEvent} e */
  function onUp(e) {
    if (!isTouch(e) || e.pointerId !== downId) return;
    downId = -1;
    if (e.target !== document.body && e.target !== document.documentElement) return;
    if (!(Math.hypot(e.clientX - downX, e.clientY - downY) < 6)) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) return;
    tuneX(e.clientX); zeroBeat();
  }
  function onResize() { needBuild = true; wake(); }
  function onCanvasResize() { // e.g. a classic scrollbar appearing narrows the canvas without a window resize
    if (Math.round(canvas.clientWidth) !== W || Math.round(canvas.clientHeight) !== H) onResize();
  }
  function onVis() {
    visible = document.visibilityState !== 'hidden';
    if (!visible) { if (raf) { cancelAnimationFrame(raf); raf = 0; } return; }
    if (needBuild || (!reduced && (rate > 0 || scan.on || vfo !== vfoT || hudA !== hudTgt))) wake();
  }

  const P = { passive: true };
  window.addEventListener('resize', onResize, P);
  document.addEventListener('visibilitychange', onVis);
  if (!reduced) {
    window.addEventListener('pointermove', onMove, P);
    window.addEventListener('pointerdown', onDown, P);
    window.addEventListener('pointerup', onUp, P);
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onCanvasResize) : null;
  ro?.observe(canvas);

  build();
  if (reduced) staticState();
  draw();
  if (!reduced && coarse && hoverNone) { // touch: one bounded scanner cycle at load, then hold
    scan.on = true; scan.mode = 0; scan.found = 0; scan.last = -1; scan.t0 = performance.now();
    vfo = vfoT = 1; vfoV = 0;
    wake();
  }

  return {
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    },
  };
}
