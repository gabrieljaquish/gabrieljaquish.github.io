// Headless smoke test for the interactive backgrounds in src/scripts/bg/.
// Usage: npm run test:bg [-- <id> ...]   (default: every background)
// Runs each module in a fake browser (stubbed canvas and DOM), drives pointer input, and checks
// for exceptions, that the loop idles to zero frames and pauses in hidden tabs, that the canvas
// is sized to the viewport, and that destroy() removes every listener and timer.
// Background modules must be self-contained (no imports) and declare `export function mount`.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const bgDir = path.join(root, 'src/scripts/bg');
const ALL = ['soundings', 'drafting', 'radio', 'grain'];

// Palettes come from the stylesheet, the same source the site uses.
const css = fs.readFileSync(path.join(root, 'src/styles/global.css'), 'utf8');
const palettes = {};
for (const m of css.matchAll(/html\[data-bg='(\w+)'\] \{ --bg: (#\w+); --text: (#\w+); --accent: (#\w+); --faint: (#\w+); \}/g)) {
  const [, name, bg, ink, accent, faint] = m;
  (palettes[name] ??= []).push({ bg, ink, accent, faint });
}

function loadModuleSource(id) {
  const src = fs.readFileSync(path.join(bgDir, `${id}.js`), 'utf8');
  if (/^\s*import\s/m.test(src)) throw new Error(`${id}.js must not import anything`);
  // Turn the ES module into a script that hands its mount() to the sandbox.
  return src.replace(/^export\s+(?=(async\s+)?(function|const|let|class)\b)/gm, '') + '\n;globalThis.__mount = mount;';
}

function makeCtx(canvas, counter) {
  const store = { canvas, lineWidth: 1, globalAlpha: 1, font: '10px sans-serif' };
  const grad = () => ({ addColorStop() {} });
  const special = {
    measureText: (t) => ({ width: String(t).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: grad, createRadialGradient: grad, createConicGradient: grad,
    createPattern: () => ({ setTransform() {} }),
    getImageData: (_x, _y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, invertSelf() { return this; } }),
    isPointInPath: () => false, isPointInStroke: () => false, getLineDash: () => [],
  };
  return new Proxy(store, {
    get(t, p) {
      if (p in special) return (...a) => { counter.ops++; return special[p](...a); };
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      return () => { counter.ops++; };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

async function runScenario(id, code, name, { isDark, reducedMotion, coarse, w, h }) {
  const counter = { ops: 0 };
  const listeners = new Map();
  const add = (target) => (type, fn) => { const k = `${target}:${type}`; if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k).add(fn); };
  const rem = (target) => (type, fn) => { listeners.get(`${target}:${type}`)?.delete(fn); };
  const fire = (target, type, ev) => { for (const fn of [...(listeners.get(`${target}:${type}`) ?? [])]) fn(ev); };
  let rafQ = [], rafId = 0, now = 0;
  const timers = new Map(); let timerId = 0;
  const fakeEl = (tag) => ({ tagName: tag.toUpperCase(), style: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    closest: () => null, matches: () => false, getAttribute: () => null, setAttribute() {}, appendChild(c) { return c; }, removeChild() {},
    addEventListener: add(tag), removeEventListener: rem(tag), getBoundingClientRect: () => ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0 }),
    clientWidth: w, clientHeight: h, offsetWidth: w, offsetHeight: h, children: [], querySelector: () => null, querySelectorAll: () => [] });
  const makeCanvas = () => { const c = fakeEl('canvas'); c.width = 300; c.height = 150; c.getContext = () => makeCtx(c, counter); return c; };
  const body = fakeEl('body');
  const canvas = makeCanvas(); canvas.parentElement = body;
  const mq = (q) => ({ matches: q.includes('reduced-motion') ? reducedMotion : q.includes('dark') ? isDark : q.includes('coarse') ? coarse : q.includes('hover: none') ? coarse : q.includes('hover') ? !coarse : false,
    media: q, addEventListener: add(`mq:${q}`), removeEventListener: rem(`mq:${q}`), addListener() {}, removeListener() {} });
  const g = {
    console, Math, JSON, Date, Array, Float32Array, Float64Array, Uint8Array, Uint8ClampedArray, Int16Array, Int32Array, Uint16Array, Uint32Array, Map, Set, WeakMap, Promise, Symbol, Number, String, Object, Error, isFinite, isNaN, parseFloat, parseInt,
    innerWidth: w, innerHeight: h, devicePixelRatio: 2,
    performance: { now: () => now },
    requestAnimationFrame: (fn) => { rafQ.push([++rafId, fn]); return rafId; },
    cancelAnimationFrame: (i) => { rafQ = rafQ.filter(([k]) => k !== i); },
    setTimeout: (fn, ms = 0) => { timers.set(++timerId, { fn, at: now + ms }); return timerId; },
    clearTimeout: (i) => timers.delete(i), setInterval: (fn, ms) => { timers.set(++timerId, { fn, at: now + ms, every: ms }); return timerId; }, clearInterval: (i) => timers.delete(i),
    matchMedia: mq,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    getSelection: () => ({ isCollapsed: true, toString: () => '' }),
    addEventListener: add('window'), removeEventListener: rem('window'),
    ResizeObserver: class { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} },
    OffscreenCanvas: class { constructor(cw, ch) { this.width = cw; this.height = ch; } getContext() { return makeCtx(this, counter); } },
    Path2D: class { constructor() {} moveTo() {} lineTo() {} arc() {} bezierCurveTo() {} quadraticCurveTo() {} closePath() {} rect() {} ellipse() {} addPath() {} arcTo() {} },
    document: { body, documentElement: Object.assign(fakeEl('html'), { dataset: {} }), visibilityState: 'visible', hidden: false,
      createElement: (t) => (t === 'canvas' ? makeCanvas() : fakeEl(t)), addEventListener: add('document'), removeEventListener: rem('document'),
      querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, elementFromPoint: () => body },
    navigator: { maxTouchPoints: coarse ? 5 : 0, userAgent: 'smoke' },
    location: { search: '', hash: '', pathname: '/' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    AbortController,
    // Same-origin static files are served from public/.
    fetch: async (url, init) => {
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const file = path.join(root, 'public', String(url).replace(/^\//, ''));
      if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
      const body = fs.readFileSync(file, 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
    },
  };
  g.window = g; g.self = g; g.globalThis = g;
  const ctx = vm.createContext(g);
  const errors = [];
  const step = (n) => {
    for (let i = 0; i < n; i++) {
      now += 1000 / 60;
      for (const [k, t] of [...timers]) if (t.at <= now) { try { t.fn(); } catch (e) { errors.push(`timer: ${e.stack}`); } if (t.every) t.at += t.every; else timers.delete(k); }
      const q = rafQ; rafQ = [];
      for (const [, fn] of q) { try { fn(now); } catch (e) { errors.push(`frame: ${e.stack}`); } }
    }
  };
  try { vm.runInContext(code, ctx, { filename: `${id}.js` }); } catch (e) { return { name, fatal: `load: ${e.stack}` }; }
  const mount = g.__mount;
  if (typeof mount !== 'function') return { name, fatal: `${id}.js does not export mount()` };
  const palette = palettes[id]?.[isDark ? 1 : 0];
  if (!palette) return { name, fatal: `no palette for ${id} in global.css` };
  const column = () => ({ left: Math.max(16, (w - 736) / 2), right: Math.min(w - 16, (w + 736) / 2) });
  let inst;
  try { inst = mount(canvas, { isDark, reducedMotion, palette, column }); } catch (e) { return { name, fatal: `mount: ${e.stack}` }; }
  // Let any fetch() the background started resolve before driving input.
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  step(10);
  const ev = (type, x, y, extra = {}) => ({ type, clientX: x, clientY: y, pageX: x, pageY: y, pointerType: coarse ? 'touch' : 'mouse', pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, target: body, timeStamp: now, preventDefault() {}, stopPropagation() {}, ...extra });
  // Sweep the pointer across the screen, then click open space, then wait.
  counter.ops = 0;
  for (let i = 0; i <= 120; i++) { const x = (w * i) / 120, y = h * (0.3 + 0.4 * Math.sin(i / 15)); fire('window', 'pointermove', ev('pointermove', x, y)); fire('window', 'mousemove', ev('mousemove', x, y)); fire('document', 'pointermove', ev('pointermove', x, y)); step(1); }
  const activeOps = counter.ops / 121;
  fire('window', 'pointerdown', ev('pointerdown', w * 0.15, h * 0.8)); fire('document', 'pointerdown', ev('pointerdown', w * 0.15, h * 0.8));
  step(3);
  fire('window', 'pointerup', ev('pointerup', w * 0.15, h * 0.8)); fire('window', 'click', ev('click', w * 0.15, h * 0.8)); fire('document', 'click', ev('click', w * 0.15, h * 0.8)); fire('document', 'pointerup', ev('pointerup', w * 0.15, h * 0.8));
  step(120);
  // A second click mid-screen (open water on the lake chart) exercises click-driven effects.
  for (const type of ['pointerdown', 'pointerup', 'click']) fire('window', type, ev(type, w * 0.5, h * 0.5));
  counter.ops = 0; step(60);
  const clickOpsPerFrame = Math.round(counter.ops / 60);
  step(60 * 7);
  fire('window', 'resize', {}); step(5);
  // Idle: 40 s with no input. A well-behaved background stops scheduling frames.
  counter.ops = 0; step(60 * 40);
  const idleScheduled = rafQ.length > 0;
  const idleOpsPerSec = counter.ops / 40;
  // Hidden tab must stop the loop.
  g.document.visibilityState = 'hidden'; g.document.hidden = true; fire('document', 'visibilitychange', {}); step(5);
  const hiddenScheduled = rafQ.length > 0;
  g.document.visibilityState = 'visible'; g.document.hidden = false; fire('document', 'visibilitychange', {}); step(5);
  try { inst?.destroy?.(); } catch (e) { errors.push(`destroy: ${e.stack}`); }
  step(5);
  const leaked = [...listeners].filter(([, s]) => s.size > 0).map(([k, s]) => `${k}×${s.size}`);
  return { name, errors: errors.slice(0, 5), errorCount: errors.length, activeOpsPerFrame: Math.round(activeOps), clickOpsPerFrame, idleScheduled, idleOpsPerSec: Math.round(idleOpsPerSec), hiddenScheduled, rafAfterDestroy: rafQ.length, timersAfterDestroy: timers.size, leakedListeners: leaked, backingStore: `${canvas.width}x${canvas.height}`, sizedToViewport: canvas.width >= w && canvas.height >= h };
}

const scenarios = [
  ['desktop-dark', { isDark: true, reducedMotion: false, coarse: false, w: 1440, h: 900 }],
  ['desktop-light', { isDark: false, reducedMotion: false, coarse: false, w: 1440, h: 900 }],
  ['reduced-motion', { isDark: true, reducedMotion: true, coarse: false, w: 1440, h: 900 }],
  ['phone', { isDark: false, reducedMotion: false, coarse: true, w: 390, h: 844 }],
];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
let failed = false;
for (const id of ids) {
  let code;
  try { code = loadModuleSource(id); } catch (e) { console.log(`${id}: FAIL ${e.message}`); failed = true; continue; }
  for (const [name, opts] of scenarios) {
    const r = await runScenario(id, code, name, opts);
    const bad = r.fatal || r.errorCount || r.rafAfterDestroy || r.timersAfterDestroy || r.leakedListeners?.length || r.hiddenScheduled || !r.sizedToViewport;
    if (bad) failed = true;
    console.log(`${id} ${bad ? 'FAIL' : 'ok  '} ${JSON.stringify(r)}`);
  }
}
console.log(failed ? 'SMOKE: FAIL' : 'SMOKE: PASS');
process.exit(failed ? 1 : 0);
