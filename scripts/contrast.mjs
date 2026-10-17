// Text contrast for every palette in src/styles/global.css, in light and dark.
// Usage: npm run test:contrast [-- path/to/global.css]
// Reads the tokens straight from the stylesheet: the :root defaults (the "off" background), the
// four background palettes, and the color-mix() rules that derive --surface, --muted,
// --accent-soft, --code-bg and --panel from them. Fails if any pairing of text and the surface it
// sits on is below WCAG AA for body text (4.5:1). No dependencies beyond Node itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 4.5;

// Foreground token on background token, and where the pairing appears.
export const PAIRS = [
  ['--text', '--bg', 'body text'],
  ['--muted', '--bg', 'muted text on the page'],
  ['--accent', '--bg', 'links on the page'],
  ['--text', '--panel', 'text on the panel, header and footer'],
  ['--muted', '--panel', 'muted text, the chart caption, log dates, note letters'],
  ['--accent', '--panel', 'links on the panel'],
  ['--text', '--surface', 'the cartouche'],
  ['--muted', '--surface', 'muted text on a surface'],
  ['--accent', '--surface', 'the cartouche link'],
  ['--text', '--accent-soft', 'a highlighted waypoint (:target) and its numeral, tags, the decision box'],
  ['--accent', '--accent-soft', 'links in a highlighted waypoint, tags'],
  // Not listed because nothing uses it: --muted on --accent-soft measures 4.23:1 (soundings,
  // light). Muted text on an --accent-soft fill must switch to --text.

  ['--text', '--code-bg', 'code, the colophon policy'],
];

// ---------------------------------------------------------------------------------------------
// Reading the stylesheet

// Rules as { selector, media, decls: Map } for every rule with custom properties, in source order.
export function readRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const walk = (text, media) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      // Find the matching close brace.
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, head);
      else if (!head.startsWith('@')) {
        const decls = new Map();
        for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) decls.set(m[1], m[2].trim());
        if (decls.size) rules.push({ selector: head, media, decls });
      }
      i = j;
    }
  };
  walk(src, '');
  return rules;
}

const isDarkMedia = (media) => /prefers-color-scheme:\s*dark/.test(media);

// The tokens in force for one background and scheme, still as CSS values.
export function tokensFor(rules, bg, dark) {
  const tokens = new Map();
  const apply = (pred) => {
    for (const r of rules) {
      if (r.media && (!isDarkMedia(r.media) || !dark)) continue;
      if (pred(r.selector)) for (const [k, v] of r.decls) tokens.set(k, v);
    }
  };
  // Cascade order: :root, then the palette, then the derived tokens (higher specificity).
  apply((s) => s === ':root');
  if (bg !== 'off') {
    apply((s) => s === `html[data-bg='${bg}']`);
    apply((s) => s === "html[data-bg]:not([data-bg='off'])");
  }
  return tokens;
}

export function palettes(rules) {
  const ids = new Set();
  for (const r of rules) {
    const m = r.selector.match(/^html\[data-bg='([\w-]+)'\]$/);
    if (m && r.decls.has('--bg')) ids.add(m[1]);
  }
  return ['off', ...ids];
}

// ---------------------------------------------------------------------------------------------
// Colors: { r, g, b, a } with channels 0-255 (gamma-encoded sRGB) and alpha 0-1.

function parseHex(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) throw new Error(`unsupported color ${hex}`);
  const n = (k) => parseInt(h.slice(k, k + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

// Splits "a, b, c" at top-level commas.
function args(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function resolve(value, tokens, seen = new Set()) {
  const v = value.trim();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (v.startsWith('#')) return parseHex(v);
  const ref = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (ref) {
    if (seen.has(ref[1])) throw new Error(`${ref[1]} refers to itself`);
    if (!tokens.has(ref[1])) throw new Error(`${ref[1]} is not defined`);
    return resolve(tokens.get(ref[1]), tokens, new Set([...seen, ref[1]]));
  }
  const mix = v.match(/^color-mix\(\s*in\s+srgb\s*,([\s\S]*)\)$/);
  if (mix) {
    const parts = args(mix[1]).map((p) => {
      const m = p.match(/^([\s\S]*?)\s+(\d+(?:\.\d+)?)%$/);
      return m ? { color: m[1], pct: +m[2] } : { color: p, pct: null };
    });
    if (parts.length !== 2) throw new Error(`unsupported color-mix: ${v}`);
    let [p1, p2] = [parts[0].pct, parts[1].pct];
    if (p1 == null && p2 == null) p1 = p2 = 50;
    else if (p1 == null) p1 = 100 - p2;
    else if (p2 == null) p2 = 100 - p1;
    const w1 = p1 / (p1 + p2);
    const w2 = 1 - w1;
    const c1 = resolve(parts[0].color, tokens, seen);
    const c2 = resolve(parts[1].color, tokens, seen);
    // color-mix interpolates premultiplied channels in gamma-encoded sRGB ("in srgb").
    const a = c1.a * w1 + c2.a * w2;
    const ch = (k) => (a === 0 ? 0 : (c1[k] * c1.a * w1 + c2[k] * c2.a * w2) / a);
    return { r: ch('r'), g: ch('g'), b: ch('b'), a };
  }
  throw new Error(`unsupported color value: ${v}`);
}

const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

function luminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const hex = ({ r, g, b }) => '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------------------------------------

/** Every pairing for every palette and scheme: [{ bg, scheme, fg, on, where, ratio, colors }]. */
export function measure(css) {
  const rules = readRules(css);
  const out = [];
  for (const bg of palettes(rules)) {
    for (const dark of [false, true]) {
      const tokens = tokensFor(rules, bg, dark);
      // Translucent fills (the panel) sit over the page, which the canvas paints in --bg.
      const page = resolve('var(--bg)', tokens);
      const solid = (name) => over(resolve(`var(${name})`, tokens), page);
      for (const [fg, on, where] of PAIRS) {
        if (!tokens.has(on)) continue; // e.g. --panel exists only with a background
        const f = solid(fg);
        const b = solid(on);
        out.push({ bg, scheme: dark ? 'dark' : 'light', fg, on, where, ratio: ratio(f, b), colors: [hex(f), hex(b)] });
      }
    }
  }
  return out;
}

function main() {
  const file = path.resolve(process.argv[2] ?? path.join(ROOT, 'src/styles/global.css'));
  const results = measure(fs.readFileSync(file, 'utf8'));
  const failures = results.filter((r) => r.ratio < MIN);
  for (const r of failures) {
    console.error(
      `contrast: ${r.bg}/${r.scheme} ${r.fg} on ${r.on} is ${r.ratio.toFixed(2)}:1 (${r.colors.join(' on ')}), below ${MIN}:1 [${r.where}]`,
    );
  }
  // The weakest case for each pairing, across all palettes and schemes.
  const worst = new Map();
  for (const r of results) {
    const k = `${r.fg} on ${r.on}`;
    if (!worst.has(k) || r.ratio < worst.get(k).ratio) worst.set(k, r);
  }
  for (const [k, r] of worst) console.log(`  ${k.padEnd(28)} min ${r.ratio.toFixed(2)}:1  (${r.bg}/${r.scheme})`);
  const schemes = new Set(results.map((r) => `${r.bg}/${r.scheme}`));
  if (failures.length) {
    console.error(`contrast: FAIL (${failures.length} of ${results.length} pairings below ${MIN}:1)`);
    process.exit(1);
  }
  console.log(`contrast: PASS (${results.length} pairings, ${schemes.size} palette/scheme combinations, all at least ${MIN}:1)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
