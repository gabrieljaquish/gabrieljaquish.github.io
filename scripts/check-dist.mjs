// Post-build guard: scans dist/ and fails the build on anything that must never ship.
// Usage: node scripts/check-dist.mjs [distDir]   (run by `npm run build`; no dependencies)
//
// Rules (ids appear in every failure message):
//   placeholder     placeholder text, unconfirmed copy ([CONFIRM) or a draft marker (data-draft)
//   style-attr      a style="" attribute (the CSP blocks them)
//   third-party     a script, stylesheet, image, frame, resource hint, CSS url() or meta refresh
//                   from another origin
//   csp             a page without the CSP meta; a CSP that allows unsafe code, any origin, or data:
//                   outside img-src; a script, style or stylesheet before the meta (so the policy
//                   doesn't cover it); inline code whose hash the policy lacks; an on* handler
//   structure       a page without exactly one <h1> and one <main>
//   link            an internal link, #fragment, asset, or feed or text-file URL that does not resolve
//   sitemap         a sitemap listing a hidden path or the 404, or a URL that is not built
//   privacy         an email address, phone number, call sign, VIN or precise coordinates in page
//                   text, HTML comments, JSON-LD, text files, or the string literals of the site's
//                   scripts (canvas and console text)
//   blocklist       phrases listed in scripts/local-blocklist.txt (gitignored, so the list itself
//                   is never published), in the same places
//   image-metadata  EXIF or XMP left in a JPEG, PNG, WebP or AVIF
//   security-txt    security.txt missing, expiring within 60 days, without Contact, or with an email
//   claims          a colophon claim (src/security/claims.mjs) that is no longer true
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const RULES = [
  'placeholder',
  'style-attr',
  'third-party',
  'csp',
  'structure',
  'link',
  'sitemap',
  'privacy',
  'blocklist',
  'image-metadata',
  'security-txt',
  'claims',
];

const PLACEHOLDER = /No posts yet|Coming soon|lorem ipsum|\bTODO\b|\bTBD\b|\[CONFIRM|data-draft/i;


// Degrees, then minutes with decimals or minutes and seconds (straight, prime or curly marks).
const DM = String.raw`\d{1,3}\s*°\s*\d{1,2}(?:\.\d+\s*['′’]|\s*['′’]\s*\d{1,2}(?:\.\d+)?\s*(?:["″”]|['′’]{2}))\s*`;

const PRIVACY = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
  // NANP: optional +1, area code and exchange start 2-9.
  phone: /(?<![\d.-])(?:\+?1[\s.-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[\s.-]?[2-9]\d{2}[\s.-]?\d{4}(?![\d-])/g,
  // US amateur call signs in any letter case (minus scripts/privacy-allowlist.txt).
  'call sign': /\b(?:[KNW][A-Z]?|A[A-L])\d[A-Z]{1,3}\b/gi,
  // 17-character VINs (no I, O or Q) with at least one digit and one letter.
  VIN: /\b(?=[A-HJ-NPR-Z0-9]{0,16}\d)(?=[A-HJ-NPR-Z0-9]{0,16}[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b/g,
  // A latitude/longitude pair given to 4 or more decimals (about 10 m or better).
  'lat/lon': /[-+]?\d{1,3}\.\d{4,}\s*°?\s*[NSEW]?\s*[,;/\s]\s*[-+]?\d{1,3}\.\d{4,}/g,
  // The same in degrees and minutes (to a fraction of a minute) or degrees, minutes and seconds.
  'lat/lon (DMS)': new RegExp(`${DM}[NS][,;/\\s]*${DM}[EW]`, 'gi'),
};

// Elements that sit inside a run of text. Removing their tags without a space keeps a phone
// number or a phrase split across them (518-<b>555</b>-…, open to <em>new</em> …) in one piece.
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'u', 'var', 'wbr']);

// Script types the browser runs, so their inline contents need a hash in script-src. Anything
// else (JSON-LD and other data blocks) is never executed.
const RUNNABLE = /^(?:|module|importmap|speculationrules|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i;

const IMAGE_EXT = /\.(?:jpe?g|png|webp|avif)$/i;

// ---------------------------------------------------------------------------------------------
// Helpers

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Every start tag: { name, attrs: Map, raw }.
function tags(html) {
  const out = [];
  for (const m of html.matchAll(/<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g)) {
    const attrs = new Map();
    for (const a of m[2].matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      attrs.set(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ''));
    }
    out.push({ name: m[1].toLowerCase(), attrs, raw: m[0], index: m.index });
  }
  return out;
}

// Markup with comments, scripts and styles blanked, so their contents can't match anything.
const stripCode = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ');

const isCsp = (t) => t.name === 'meta' && (t.attrs.get('http-equiv') ?? '').toLowerCase() === 'content-security-policy';

// What a reader (or a screen reader, or a search result) sees: text content plus alt, title,
// aria-label and placeholder values, and meta descriptions. Scripts, styles and the CSP are out.
// Inline tags join the text around them; other tags break it; whitespace runs become one space.
export function visibleText(html) {
  const code = stripCode(html);
  const parts = [];
  for (const t of tags(code)) {
    if (isCsp(t)) continue;
    for (const a of ['alt', 'title', 'aria-label', 'placeholder']) if (t.attrs.has(a)) parts.push(t.attrs.get(a));
    if (t.name === 'meta' && t.attrs.has('content') && (t.attrs.has('name') || t.attrs.has('property'))) {
      parts.push(t.attrs.get('content'));
    }
  }
  const text = code
    .replace(/<\/?([a-zA-Z][\w:-]*)(?:\s[^>]*)?\/?>/g, (_, name) => (INLINE.has(name.toLowerCase()) ? '' : ' '))
    .replace(/<[^>]*>/g, ' ');
  parts.push(decode(text).replace(/\s+/g, ' '));
  return parts.join('\n');
}

// HTML comment bodies. The site invites view-source, so they count as text a visitor reads.
export const commentText = (html) => [...html.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]).join('\n');

// Every string value in the page's JSON-LD blocks, which search engines publish.
export function jsonLdText(html) {
  const out = [];
  const collect = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) collect(x);
  };
  for (const m of html.replace(/<!--[\s\S]*?-->/g, ' ').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*["']?application\/ld\+json/i.test(m[1])) continue;
    try {
      collect(JSON.parse(m[2]));
    } catch {
      out.push(m[2]);
    }
  }
  return out.join('\n');
}

// The string literals in JavaScript or TypeScript source, comments skipped: the text a script
// draws on a canvas or prints to the console, which never appears in the HTML. A small scanner,
// not a parser (a quote inside a regex literal can end a "string" early, at worst on one line).
export function stringLiterals(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
    } else if (c === "'" || c === '"' || c === '`') {
      let s = '';
      let j = i + 1;
      for (; j < src.length && src[j] !== c; j++) {
        if (src[j] === '\\') {
          const e = src[++j] ?? '';
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        } else if (src[j] === '\n' && c !== '`') break;
        else s += src[j];
      }
      out.push(s);
      i = j;
    }
  }
  return out;
}

const excerpt = (s, i, n = 60) => s.slice(Math.max(0, i - 20), i + n).replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------
// Resolving internal URLs against dist/

function resolveFile(dist, pathname) {
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const full = path.join(dist, p);
  if (!full.startsWith(dist)) return null;
  if (p.endsWith('/')) return fs.existsSync(path.join(full, 'index.html')) ? path.join(full, 'index.html') : null;
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  // GitHub Pages redirects /x to /x/ when x/index.html exists.
  if (fs.existsSync(path.join(full, 'index.html'))) return path.join(full, 'index.html');
  return null;
}

const idCache = new Map();
function idsIn(file) {
  if (!idCache.has(file)) {
    const ids = new Set();
    for (const t of tags(stripCode(fs.readFileSync(file, 'utf8')))) {
      if (t.attrs.has('id')) ids.add(t.attrs.get('id'));
      if (t.name === 'a' && t.attrs.has('name')) ids.add(t.attrs.get('name'));
    }
    idCache.set(file, ids);
  }
  return idCache.get(file);
}

// ---------------------------------------------------------------------------------------------
// Image metadata

function jpegMetadata(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) return null;
    const marker = buf[off + 1];
    if (marker === 0xff) { off++; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan data
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
    const len = buf.readUInt16BE(off + 2);
    if (marker === 0xe1) {
      const data = buf.subarray(off + 4, off + 2 + len);
      if (data.subarray(0, 6).equals(Buffer.from('Exif\0\0', 'latin1'))) return 'EXIF (APP1)';
      if (data.toString('latin1', 0, 40).startsWith('http://ns.adobe.com/xap/1.0/')) return 'XMP (APP1)';
      if (data.toString('latin1', 0, 40).startsWith('http://ns.adobe.com/xmp/extension/')) return 'XMP (APP1)';
    }
    off += 2 + len;
  }
  return null;
}

function pngMetadata(buf) {
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (type === 'eXIf') return 'EXIF (eXIf chunk)';
    if (type === 'iTXt' || type === 'tEXt' || type === 'zTXt') {
      const keyword = buf.toString('latin1', off + 8, Math.min(off + 8 + len, off + 8 + 80)).split('\0')[0];
      if (keyword === 'XML:com.adobe.xmp') return `XMP (${type} chunk)`;
    }
    if (type === 'IEND') return null;
    off += 12 + len;
  }
  return null;
}

function webpMetadata(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const type = buf.toString('latin1', off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    if (type === 'EXIF') return 'EXIF (EXIF chunk)';
    if (type === 'XMP ') return 'XMP (XMP chunk)';
    off += 8 + len + (len % 2);
  }
  return null;
}

// AVIF/HEIF: look for an Exif item, or an XMP (application/rdf+xml) mime item, in meta/iinf.
function avifMetadata(buf) {
  if (buf.toString('latin1', 4, 8) !== 'ftyp') return null;
  function* boxes(start, end) {
    let off = start;
    while (off + 8 <= end) {
      let size = buf.readUInt32BE(off);
      const type = buf.toString('latin1', off + 4, off + 8);
      let header = 8;
      if (size === 1) { size = Number(buf.readBigUInt64BE(off + 8)); header = 16; }
      else if (size === 0) size = end - off;
      if (size < header || off + size > end) return;
      yield { type, start: off + header, end: off + size };
      off += size;
    }
  }
  for (const meta of boxes(0, buf.length)) {
    if (meta.type !== 'meta') continue;
    for (const iinf of boxes(meta.start + 4, meta.end)) {
      if (iinf.type !== 'iinf') continue;
      const version = buf[iinf.start];
      const first = iinf.start + 4 + (version === 0 ? 2 : 4);
      for (const infe of boxes(first, iinf.end)) {
        if (infe.type !== 'infe' || buf[infe.start] < 2) continue;
        const v = buf[infe.start];
        const typeAt = infe.start + 4 + (v === 2 ? 2 : 4) + 2;
        const itemType = buf.toString('latin1', typeAt, typeAt + 4);
        if (itemType === 'Exif') return 'EXIF (Exif item)';
        if (itemType === 'mime') {
          const rest = buf.toString('latin1', typeAt + 4, infe.end).split('\0');
          if ((rest[1] ?? '').includes('rdf+xml')) return 'XMP (mime item)';
        }
      }
    }
  }
  return null;
}

export function imageMetadata(buf) {
  const found = jpegMetadata(buf) ?? pngMetadata(buf) ?? webpMetadata(buf) ?? avifMetadata(buf);
  if (found) return found;
  // Belt and braces: an XMP packet anywhere in the file.
  const text = buf.toString('latin1');
  if (text.includes('http://ns.adobe.com/xap/1.0/') || text.includes('<x:xmpmeta')) return 'XMP packet';
  return null;
}

// ---------------------------------------------------------------------------------------------
// The scan

/**
 * Checks a built site. Returns [{ rule, file, message }], empty when it is clean.
 * `sources` are script files (absolute paths) whose string literals get the privacy and
 * blocklist scans; they are reported relative to `root`.
 * @param {string} distDir
 * @param {{ site?: string, hiddenPaths?: readonly string[], allowlist?: string[], blocklist?: RegExp[], now?: Date, sources?: string[], root?: string }} [options]
 */
export function checkDist(distDir, options = {}) {
  const dist = path.resolve(distDir);
  const site = new URL(options.site ?? 'https://gabrieljaquish.com');
  const hiddenPaths = options.hiddenPaths ?? [];
  const allowlist = new Set((options.allowlist ?? []).map((a) => a.toUpperCase()));
  const blocklist = options.blocklist ?? [];
  const now = options.now ?? new Date();
  const root = path.resolve(options.root ?? ROOT);
  const out = [];
  const add = (rule, file, message) => {
    const base = file.startsWith(dist + path.sep) || file === dist ? dist : root;
    out.push({ rule, file: path.relative(base, file).split(path.sep).join('/') || '.', message });
  };
  idCache.clear();

  if (!fs.existsSync(dist)) return [{ rule: 'structure', file: distDir, message: 'dist directory not found; run astro build first' }];
  const files = walk(dist);
  const urlOf = (file) => {
    const r = '/' + path.relative(dist, file).split(path.sep).join('/');
    return new URL(r.endsWith('/index.html') ? r.slice(0, -'index.html'.length) : r, site);
  };

  // An internal URL (relative, root-relative or on this site's origin) -> URL, else null.
  const internal = (value, base) => {
    let u;
    try {
      u = new URL(value, base);
    } catch {
      return null;
    }
    return u.host === site.host && (u.protocol === 'https:' || u.protocol === 'http:') ? u : null;
  };
  const external = (value, base) => {
    if (/^\s*(?:data|blob):/i.test(value)) return false;
    try {
      const u = new URL(value, base);
      return u.host !== site.host;
    } catch {
      return false;
    }
  };

  const checkCssUrls = (css, file, base) => {
    for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/gi)) {
      const value = (m[2] ?? m[4]).trim();
      if (external(value, base)) add('third-party', file, `CSS loads ${value}`);
    }
  };

  const checkText = (text, file) => {
    for (const re of blocklist) {
      const m = text.match(re);
      if (m) add('blocklist', file, `"${excerpt(text, m.index)}"`);
    }
    for (const [label, re] of Object.entries(PRIVACY)) {
      for (const m of text.matchAll(re)) {
        if (label === 'call sign' && allowlist.has(m[0].toUpperCase())) continue;
        if (label === 'lat/lon') {
          const [a, b] = m[0].match(/[-+]?\d{1,3}\.\d+/g).map(Number);
          if (Math.abs(a) > 180 || Math.abs(b) > 180 || (Math.abs(a) > 90 && Math.abs(b) > 90)) continue;
        }
        add('privacy', file, `${label}: "${m[0]}"`);
      }
    }
  };

  // Canvas and console text: the string literals of the site's own scripts.
  for (const file of options.sources ?? []) {
    const literals = stringLiterals(fs.readFileSync(file, 'utf8')).join('\n');
    const ph = literals.match(PLACEHOLDER);
    if (ph) add('placeholder', file, `"${excerpt(literals, ph.index)}"`);
    checkText(literals, file);
  }

  for (const file of files) {
    const name = path.basename(file);

    if (IMAGE_EXT.test(name)) {
      const found = imageMetadata(fs.readFileSync(file));
      if (found) add('image-metadata', file, `${found} found; strip metadata before publishing`);
      continue;
    }

    if (/\.css$/i.test(name)) {
      checkCssUrls(fs.readFileSync(file, 'utf8'), file, urlOf(file));
      continue;
    }

    if (/\.(?:txt|xml)$/i.test(name)) {
      const text = fs.readFileSync(file, 'utf8');
      const m = text.match(PLACEHOLDER);
      if (m) add('placeholder', file, `"${excerpt(text, m.index)}"`);
      checkText(decode(text.replace(/<[^>]*>/g, ' ')), file);
      // Feed and other XML links must resolve too (sitemaps are checked below).
      if (/\.xml$/i.test(name) && !/^sitemap/.test(name)) {
        for (const lm of text.matchAll(/<link>([^<]+)<\/link>/g)) {
          const u = internal(decode(lm[1]).trim(), site);
          if (u && !resolveFile(dist, u.pathname)) add('link', file, `${lm[1]} does not resolve`);
        }
      }
      // So must this site's URLs in text files (humans.txt's Colophon line, robots.txt's Sitemap).
      if (/\.txt$/i.test(name)) {
        for (const um of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
          const value = um[0].replace(/[.,;:!?)]+$/, '');
          const u = internal(value, site);
          if (u && !resolveFile(dist, u.pathname)) add('link', file, `${value} does not resolve`);
        }
      }
      continue;
    }

    if (!/\.html$/i.test(name)) continue;

    const html = fs.readFileSync(file, 'utf8');
    const base = urlOf(file);
    const code = stripCode(html);
    const markup = tags(code);
    // Script tags themselves (stripCode blanks them), ignoring any inside comments.
    const scripts = tags(html.replace(/<!--[\s\S]*?-->/g, ' ')).filter((t) => t.name === 'script');

    // 1. Placeholders and draft markers, anywhere in the file.
    const ph = html.match(PLACEHOLDER);
    if (ph) add('placeholder', file, `"${excerpt(html, ph.index)}"`);

    // 2. style attributes.
    for (const t of markup) if (t.attrs.has('style')) add('style-attr', file, `<${t.name} style="${t.attrs.get('style')}">`);

    // 3. Resources from other origins. Links (<a href>, canonical, alternate) are fine.
    const resources = [];
    for (const t of markup) {
      const rel = (t.attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
      const push = (attr) => t.attrs.has(attr) && resources.push({ t, attr, value: t.attrs.get(attr) });
      const pushSrcset = (attr) => {
        for (const c of (t.attrs.get(attr) ?? '').split(',')) {
          const value = c.trim().split(/\s+/)[0];
          if (value) resources.push({ t, attr, value });
        }
      };
      if (['img', 'source', 'iframe', 'frame', 'embed', 'video', 'audio', 'track', 'input'].includes(t.name)) push('src');
      if (['img', 'source'].includes(t.name)) pushSrcset('srcset');
      if (t.name === 'video') push('poster');
      if (t.name === 'object') push('data');
      if (t.name === 'image' || t.name === 'use') { push('href'); push('xlink:href'); }
      // Resource hints count too: the browser contacts the origin, and the CSP doesn't apply.
      if (t.name === 'link' && rel.some((r) => ['stylesheet', 'icon', 'shortcut', 'apple-touch-icon', 'mask-icon', 'preload', 'modulepreload', 'prefetch', 'manifest', 'preconnect', 'dns-prefetch', 'prerender'].includes(r))) push('href');
      // <meta http-equiv="refresh" content="0; url=…"> sends the visitor somewhere.
      if (t.name === 'meta' && (t.attrs.get('http-equiv') ?? '').toLowerCase() === 'refresh') {
        const m = (t.attrs.get('content') ?? '').match(/^\s*\d+(?:\.\d*)?\s*[;,]\s*(?:url\s*=\s*)?(['"]?)(.+?)\1\s*$/i);
        if (m && m[2]) resources.push({ t, attr: 'content', value: m[2] });
      }
    }
    for (const t of scripts) if (t.attrs.has('src')) resources.push({ t, attr: 'src', value: t.attrs.get('src') });
    for (const r of resources) {
      if (external(r.value, base)) add('third-party', file, `<${r.t.name} ${r.attr}="${r.value}">`);
      else {
        const u = internal(r.value, base);
        if (u && !resolveFile(dist, u.pathname)) add('link', file, `<${r.t.name} ${r.attr}="${r.value}"> does not resolve`);
      }
    }
    for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) checkCssUrls(m[1], file, base);

    // 4. The CSP meta.
    const csps = markup.filter(isCsp);
    if (csps.length !== 1) {
      add('csp', file, csps.length ? `${csps.length} CSP meta tags` : 'no Content-Security-Policy meta tag');
    }
    const allowed = new Map(); // directive -> its sources
    for (const t of csps) {
      const policy = t.attrs.get('content') ?? '';
      const parsed = policy.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]);
      const dflt = parsed.find((d) => d[0].toLowerCase() === 'default-src');
      if (!dflt || dflt.length !== 2 || dflt[1] !== "'none'") add('csp', file, "CSP lacks default-src 'none'");
      for (const [directive, ...sources] of parsed) {
        allowed.set(directive.toLowerCase(), sources);
        for (const s of sources) {
          if (/^'unsafe-/i.test(s)) add('csp', file, `${directive} allows ${s}`);
          else if (/^data:$/i.test(s)) {
            // data: URLs can carry script or style; only images may use them.
            if (directive.toLowerCase() !== 'img-src') add('csp', file, `${directive} allows data:`);
          } else if (!/^(?:'self'|'none'|'strict-dynamic'|'report-sample'|'(?:sha256|sha384|sha512)-[A-Za-z0-9+/=_-]+')$/i.test(s)) {
            add('csp', file, `${directive} allows the origin ${s}`);
          }
        }
      }
    }
    if (csps.length === 1) {
      // A <meta> policy covers only what comes after it, so nothing it governs may come first.
      const uncommented = html.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
      const all = tags(uncommented);
      const at = all.find(isCsp)?.index ?? 0;
      for (const t of all) {
        if (t.index >= at) break;
        const rel = (t.attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
        if (t.name === 'script' || t.name === 'style' || (t.name === 'link' && rel.some((r) => ['stylesheet', 'preload', 'modulepreload'].includes(r)))) {
          add('csp', file, `<${t.name}> comes before the CSP meta, so the policy doesn't cover it`);
        }
      }
      // Inline code runs only if its SHA-256 hash is in the policy. Without one, the browser
      // blocks it silently (the CSP isn't applied in astro dev, so it works there).
      const hashOf = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
      const scriptSrc = allowed.get('script-src') ?? allowed.get('default-src') ?? [];
      const styleSrc = allowed.get('style-src') ?? allowed.get('default-src') ?? [];
      for (const m of uncommented.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        const t = tags(`<script${m[1]}>`)[0];
        if (!t || t.attrs.has('src') || !RUNNABLE.test((t.attrs.get('type') ?? '').trim())) continue;
        if (!scriptSrc.includes(hashOf(m[2]))) add('csp', file, `an inline <script> whose hash isn't in script-src: "${excerpt(m[2], 0, 50)}"`);
      }
      for (const m of uncommented.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
        if (!styleSrc.includes(hashOf(m[1]))) add('csp', file, `an inline <style> whose hash isn't in style-src: "${excerpt(m[1], 0, 50)}"`);
      }
    }
    // Inline event handlers need 'unsafe-hashes', which the policy never allows.
    for (const t of markup) {
      for (const a of t.attrs.keys()) if (/^on[a-z]+$/.test(a)) add('csp', file, `<${t.name} ${a}="…">: inline handlers are blocked by the CSP`);
    }

    // 5. One h1 and one main.
    const h1 = markup.filter((t) => t.name === 'h1').length;
    const main = markup.filter((t) => t.name === 'main').length;
    if (h1 !== 1) add('structure', file, `${h1} <h1> elements (expected 1)`);
    if (main !== 1) add('structure', file, `${main} <main> elements (expected 1)`);

    // 6. Internal links and fragments.
    for (const t of markup) {
      if (!['a', 'area', 'link'].includes(t.name) || !t.attrs.has('href')) continue;
      const href = t.attrs.get('href').trim();
      if (/^(?:mailto|tel|sms):/i.test(href)) {
        add('privacy', file, `contact link "${href}"`);
        continue;
      }
      if (/^javascript:/i.test(href) || href === '#' || href === '') {
        add('link', file, `<${t.name} href="${href}"> goes nowhere`);
        continue;
      }
      const u = internal(href, base);
      if (!u) continue;
      const target = resolveFile(dist, u.pathname);
      if (!target) {
        add('link', file, `<${t.name} href="${href}"> does not resolve`);
        continue;
      }
      if (u.hash.length > 1) {
        let frag = u.hash.slice(1);
        try {
          frag = decodeURIComponent(frag);
        } catch {}
        if (!/\.html$/.test(target) || !idsIn(target).has(frag)) add('link', file, `<${t.name} href="${href}">: no element with id "${frag}"`);
      }
    }

    // 8-9. Privacy shapes and blocklisted phrases in what a visitor can read, in the comments
    // view-source shows, and in the JSON-LD that search engines publish.
    checkText(visibleText(html), file);
    checkText(commentText(html), file);
    checkText(jsonLdText(html), file);
  }

  // 7. Sitemaps.
  const index = path.join(dist, 'sitemap-index.xml');
  if (!fs.existsSync(index)) {
    add('sitemap', index, 'sitemap-index.xml is missing');
  } else {
    const locs = (file) => [...fs.readFileSync(file, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1]).trim());
    const children = locs(index);
    if (children.length === 0) add('sitemap', index, 'sitemap index lists no sitemaps');
    for (const child of children) {
      const cu = internal(child, site);
      const childFile = cu && resolveFile(dist, cu.pathname);
      if (!childFile) {
        add('sitemap', index, `${child} is not in dist`);
        continue;
      }
      for (const loc of locs(childFile)) {
        const u = internal(loc, site);
        if (!u) add('sitemap', childFile, `${loc} is not on ${site.host}`);
        else if (hiddenPaths.some((h) => u.pathname.includes(h))) add('sitemap', childFile, `${loc} is a hidden path`);
        else if (/^\/404(?:\/|\.html)?$/.test(u.pathname)) add('sitemap', childFile, `${loc} is the 404 page`);
        else if (!resolveFile(dist, u.pathname)) add('sitemap', childFile, `${loc} is not in dist`);
      }
    }
  }

  // 11. security.txt.
  const sec = path.join(dist, '.well-known/security.txt');
  if (!fs.existsSync(sec)) {
    add('security-txt', sec, 'missing');
  } else {
    const text = fs.readFileSync(sec, 'utf8');
    if (!/^Contact:\s*\S+/m.test(text)) add('security-txt', sec, 'no Contact field');
    const exp = text.match(/^Expires:\s*(\S+)/m);
    const expires = exp ? new Date(exp[1]) : null;
    if (!expires || Number.isNaN(expires.valueOf())) add('security-txt', sec, 'no valid Expires field');
    else if (expires.valueOf() - now.valueOf() < 60 * 864e5) {
      add('security-txt', sec, `Expires ${exp[1]} is less than 60 days away; move it forward`);
    }
    PRIVACY.email.lastIndex = 0;
    const email = text.match(PRIVACY.email);
    if (email) add('security-txt', sec, `contains an email address (${email[0]})`);
  }

  return out;
}

export function readAllowlist(file = path.join(ROOT, 'scripts/privacy-allowlist.txt')) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

// Local-only phrases that must never be published, one per line ('#' starts a comment). The file
// is gitignored so the list itself stays private; without it the rule checks nothing. Matching
// ignores case and treats any run of whitespace as a space.
export function readBlocklist(file = path.join(ROOT, 'scripts/local-blocklist.txt')) {
  return compileBlocklist(readAllowlist(file));
}

export function compileBlocklist(phrases) {
  return phrases.map((p) => new RegExp(p.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'i'));
}

// The site origin, from astro.config.mjs.
function readSite(root) {
  const m = fs.readFileSync(path.join(root, 'astro.config.mjs'), 'utf8').match(/^\s*site:\s*'([^']+)'/m);
  return m ? m[1] : 'https://gabrieljaquish.com';
}

export function report(violations) {
  for (const v of violations) console.error(`check-dist [${v.rule}] ${v.file}: ${v.message}`);
}

async function main() {
  const dist = path.resolve(process.argv[2] ?? path.join(ROOT, 'dist'));
  const { HIDDEN_PATHS } = await import(pathToFileURL(path.join(ROOT, 'src/lib/hidden-paths.mjs')).href);
  const { runClaims } = await import('./claims.mjs');
  // The site's scripts: what they draw on canvases and print to the console isn't in the HTML.
  const sources = walk(path.join(ROOT, 'src/scripts')).filter((f) => /\.(?:[cm]?js|ts)$/.test(f));
  const violations = [
    ...checkDist(dist, { site: readSite(ROOT), hiddenPaths: HIDDEN_PATHS, allowlist: readAllowlist(), blocklist: readBlocklist(), sources, root: ROOT }),
    ...(await runClaims(ROOT, { dist })),
  ];
  if (violations.length) {
    report(violations);
    console.error(`check-dist: FAIL (${violations.length} problem${violations.length === 1 ? '' : 's'})`);
    process.exit(1);
  }
  const pages = walk(dist).filter((f) => f.endsWith('.html')).length;
  console.log(`check-dist: PASS (${pages} pages, ${RULES.length} rules)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
