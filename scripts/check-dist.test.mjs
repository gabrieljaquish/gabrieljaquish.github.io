// Tests for scripts/check-dist.mjs and scripts/claims.mjs. Usage: npm run test:dist
// Each fixture in scripts/fixtures/check-dist/ is named <rule>[--variant].html and must fail with
// exactly that rule (clean.html must pass). Fixtures that need contact-shaped data
// are assembled below from fragments, so no committed file in this public repository
// contains one whole. Rules that aren't about a single page (sitemap, security.txt, image
// metadata, feed links, claims) are tested on generated sites and repos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, checkDist, compileBlocklist, readAllowlist } from './check-dist.mjs';
import { runClaims } from './claims.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'scripts/fixtures/check-dist');
const SITE = 'https://gabrieljaquish.com';
const NOW = new Date();
const DAY = 864e5;
// A neutral stand-in for the real (local, gitignored) blocklist.
const OPTIONS = { site: SITE, hiddenPaths: ['/vault/'], allowlist: readAllowlist(), blocklist: compileBlocklist(['purple heron at dawn']), now: NOW };

// Contact-shaped test values, built at run time (reserved example domain, fictional 555 number).
const EMAIL = ['someone', 'example.com'].join('@');
const PHONE = ['555', '555', '0100'].join('-');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-dist-'));
let n = 0;
let failed = 0;
const exercised = new Set();

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// A minimal valid site: the clean fixture at / and the page under test at /page/.
function makeSite({ page, sitemapPaths = ['/', '/page/'], securityTxt, files = {} } = {}) {
  const dist = path.join(tmp, `site-${++n}`);
  const clean = fs.readFileSync(path.join(FIXTURES, 'clean.html'), 'utf8');
  write(path.join(dist, 'index.html'), clean);
  write(path.join(dist, 'page/index.html'), page ?? clean);
  write(path.join(dist, 'sitemap-index.xml'), `<?xml version="1.0" encoding="UTF-8"?><sitemapindex><sitemap><loc>${SITE}/sitemap-0.xml</loc></sitemap></sitemapindex>`);
  write(
    path.join(dist, 'sitemap-0.xml'),
    `<?xml version="1.0" encoding="UTF-8"?><urlset>${sitemapPaths.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join('')}</urlset>`,
  );
  const expires = new Date(NOW.valueOf() + 365 * DAY).toISOString();
  write(
    path.join(dist, '.well-known/security.txt'),
    securityTxt ?? `Contact: https://www.linkedin.com/in/gabrieljaquish/\nExpires: ${expires}\nPreferred-Languages: en\n`,
  );
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) fs.rmSync(path.join(dist, rel), { force: true });
    else write(path.join(dist, rel), content);
  }
  return dist;
}

function expect(name, violations, expected) {
  const got = [...new Set(violations.map((v) => v.rule))].sort();
  const want = [expected ?? []].flat().sort();
  const ok = got.length === want.length && got.every((r, i) => r === want[i]);
  for (const r of got) exercised.add(r);
  if (ok) {
    console.log(`  ok   ${name}${want.length ? ` -> ${want.join(', ')}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}: expected [${want.join(', ')}], got [${got.join(', ')}]`);
    for (const v of violations) console.log(`         [${v.rule}] ${v.file}: ${v.message}`);
  }
}

// --- Page fixtures -----------------------------------------------------------------------------
console.log('page fixtures');
const fixtures = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.html')).sort();
for (const file of fixtures) {
  const id = file.replace(/\.html$/, '');
  const expected = id === 'clean' ? null : id.split('--')[0];
  if (expected && !RULES.includes(expected)) {
    failed++;
    console.log(`  FAIL ${file}: "${expected}" is not a rule id`);
    continue;
  }
  const page = fs.readFileSync(path.join(FIXTURES, file), 'utf8');
  expect(file, checkDist(makeSite({ page }), OPTIONS), expected);
}

// The clean fixture with another description and another <main>.
const CLEAN = fs.readFileSync(path.join(FIXTURES, 'clean.html'), 'utf8');
function fixturePage({ description, body = '<p>Nothing visible.</p>' }) {
  let html = CLEAN.replace(/<main id="main">[\s\S]*<\/main>/, `<main id="main">\n<h1>Fixture</h1>\n${body}\n</main>`);
  if (description) html = html.replace('content="A check-dist fixture page."', `content="${description}"`);
  return html;
}
const GENERATED = {
  'blocklist--body': fixturePage({ body: '<p>We saw a purple heron at dawn.</p>' }),
  'blocklist--meta': fixturePage({ description: 'A Purple Heron at Dawn' }),
  'blocklist--emphasis': fixturePage({ body: '<p>A purple <em>heron</em> at dawn.</p>' }),
  'blocklist--line-break': fixturePage({ description: 'purple heron\n  at dawn' }),
  'privacy--email': fixturePage({ body: `<p>Write to ${EMAIL}.</p>` }),
  'privacy--mailto': fixturePage({ body: `<p><a href="mailto:${EMAIL}">Email</a></p>` }),
  'privacy--phone': fixturePage({ body: `<p>Call ${PHONE}.</p>` }),
  'privacy--alt-text': fixturePage({ body: `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Call (${PHONE.replace('-', ') ')}">` }),
  'privacy--callsign': fixturePage({ body: `<p>73 de ${'W1' + 'AW'}.</p>` }),
  'privacy--vin': fixturePage({ body: `<p>VIN ${'1HGBH41JX' + 'MN109186'}.</p>` }),
  'privacy--latlon': fixturePage({ body: `<p>At ${[12.3456, -65.4321].join(', ')}.</p>` }),
  // The same shapes in places a plain text scan misses.
  'privacy--callsign-lowercase': fixturePage({ body: `<p>73 de ${'w1' + 'aw'}.</p>` }),
  'privacy--dms': fixturePage({ body: `<p>At ${'12°20′44″N'} ${'65°25′55″W'}.</p>` }),
  // Markdown's smartypants turns ' and " into curly quotes.
  'privacy--dms-curly': fixturePage({ body: `<p>At ${'12°20’44”N, 65°25’55”W'}.</p>` }),
  'privacy--phone-split': fixturePage({ body: `<p>Call ${PHONE.replace(/-(\d+)-/, '-<b>$1</b>-')}.</p>` }),
  'privacy--comment': fixturePage({ body: `<!-- ${EMAIL} -->\n<p>Nothing visible.</p>` }),
  'privacy--json-ld': fixturePage({ body: `<script type="application/ld+json">${JSON.stringify({ '@type': 'Person', email: EMAIL })}</script>` }),
};
for (const [id, page] of Object.entries(GENERATED)) {
  expect(`${id} (generated)`, checkDist(makeSite({ page }), OPTIONS), id.split('--')[0]);
}

// --- Script sources (canvas and console text) --------------------------------------------------
console.log('script sources');
function sourceFile(text) {
  const file = path.join(tmp, `src-${++n}`, 'scripts/bg/demo.js');
  write(file, text);
  return { sources: [file], root: path.dirname(path.dirname(path.dirname(file))) };
}
const scan = (text) => checkDist(makeSite(), { ...OPTIONS, ...sourceFile(text) });
expect('a call sign drawn on a canvas', scan(`const PHRASES = ['CQ CQ DE ${'W1' + 'AW'}', 'PORT HENRY'];\n`), 'privacy');
expect('a lowercase call sign in a template', scan('const t = `de ' + 'w1' + 'aw k`;\n'), 'privacy');
expect('an email in a console message', scan(`console.log("Write to ${EMAIL}");\n`), 'privacy');
expect('a placeholder drawn on a canvas', scan(`ctx.fillText('${'Coming' + ' soon'}', 0, 0);\n`), 'placeholder');
expect('the same shapes in comments only', scan(`// ${'W1' + 'AW'}, ${EMAIL}\n/* ${PHONE} */\nconst a = 'it\\'s fine', b = "W3C";\n`), null);
expect('numbers and identifiers', scan(`const n1x = 2147483647, w2b = 0x1f, k9s = 'k8s';\n`), null);
const sourceReport = scan(`const P = ['${'W1' + 'AW'}'];\n`);
if (sourceReport[0]?.file !== 'scripts/bg/demo.js') {
  failed++;
  console.log(`  FAIL a source is reported relative to the root: got "${sourceReport[0]?.file}"`);
} else console.log('  ok   a source is reported relative to the root');

// --- Sitemap ----------------------------------------------------------------------------------
console.log('sitemap');
expect('lists a hidden path', checkDist(makeSite({ sitemapPaths: ['/', '/vault/'], files: { 'vault/index.html': fs.readFileSync(path.join(FIXTURES, 'clean.html'), 'utf8') } }), OPTIONS), 'sitemap');
expect('lists the 404', checkDist(makeSite({ sitemapPaths: ['/', '/404/'], files: { '404.html': fs.readFileSync(path.join(FIXTURES, 'clean.html'), 'utf8') } }), OPTIONS), 'sitemap');
expect('lists a page that is not built', checkDist(makeSite({ sitemapPaths: ['/', '/log/'] }), OPTIONS), 'sitemap');
expect('lists another origin', checkDist(makeSite({ files: { 'sitemap-0.xml': `<urlset><url><loc>https://example.com/</loc></url></urlset>` } }), OPTIONS), 'sitemap');
expect('has no sitemap index', checkDist(makeSite({ files: { 'sitemap-index.xml': null } }), OPTIONS), 'sitemap');

// --- security.txt -----------------------------------------------------------------------------
console.log('security.txt');
const soon = new Date(NOW.valueOf() + 30 * DAY).toISOString();
const later = new Date(NOW.valueOf() + 365 * DAY).toISOString();
expect('expires in 30 days', checkDist(makeSite({ securityTxt: `Contact: https://www.linkedin.com/in/gabrieljaquish/\nExpires: ${soon}\n` }), OPTIONS), 'security-txt');
expect('has no Contact', checkDist(makeSite({ securityTxt: `Expires: ${later}\n` }), OPTIONS), 'security-txt');
// An email address there is both a security.txt problem and a privacy one.
expect('has an email address', checkDist(makeSite({ securityTxt: `Contact: mailto:${EMAIL}\nExpires: ${later}\n` }), OPTIONS), ['privacy', 'security-txt']);
expect('is missing', checkDist(makeSite({ files: { '.well-known/security.txt': null } }), OPTIONS), 'security-txt');

// --- Feed links and text files ----------------------------------------------------------------
console.log('feeds and text files');
expect('feed links an unbuilt entry', checkDist(makeSite({ files: { 'rss.xml': `<rss><channel><link>${SITE}/</link><item><link>${SITE}/log/gone/</link></item></channel></rss>` } }), OPTIONS), 'link');
expect('feed links a built page', checkDist(makeSite({ files: { 'rss.xml': `<rss><channel><link>${SITE}/</link><item><link>${SITE}/page/</link></item></channel></rss>` } }), OPTIONS), null);
expect('text file links an unbuilt page', checkDist(makeSite({ files: { 'humans.txt': `Colophon: ${SITE}/colophon/\n` } }), OPTIONS), 'link');
expect('text file links a built page', checkDist(makeSite({ files: { 'humans.txt': `Site: ${SITE}\nPage: ${SITE}/page/.\n` } }), OPTIONS), null);
expect('text file with a placeholder', checkDist(makeSite({ files: { 'humans.txt': 'Built by: TBD\n' } }), OPTIONS), 'placeholder');
expect('text file with a phone number', checkDist(makeSite({ files: { 'humans.txt': `Phone: ${PHONE}\n` } }), OPTIONS), 'privacy');
expect('stylesheet with a remote url()', checkDist(makeSite({ files: { '_astro/site.css': 'body{background:url("https://images.example.com/a.png")}' } }), OPTIONS), 'third-party');
expect('stylesheet with a local url()', checkDist(makeSite({ files: { '_astro/site.css': 'body{background:url(/bg.png)}' } }), OPTIONS), null);

// --- Image metadata ---------------------------------------------------------------------------
console.log('image metadata');
const u16 = (v) => Buffer.from([(v >> 8) & 255, v & 255]);
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
const u32le = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const ascii = (s) => Buffer.from(s, 'latin1');

const jpegSegment = (marker, data) => Buffer.concat([Buffer.from([0xff, marker]), u16(data.length + 2), data]);
const jpeg = (...segments) =>
  Buffer.concat([Buffer.from([0xff, 0xd8]), jpegSegment(0xe0, ascii('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), ...segments, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
const pngChunk = (type, data) => Buffer.concat([u32(data.length), ascii(type), data, u32(0)]);
const png = (...chunks) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', Buffer.alloc(13)), ...chunks, pngChunk('IDAT', Buffer.alloc(4)), pngChunk('IEND', Buffer.alloc(0))]);
const riffChunk = (type, data) => Buffer.concat([ascii(type), u32le(data.length), data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
const webp = (...chunks) => {
  const body = Buffer.concat([ascii('WEBP'), riffChunk('VP8X', Buffer.alloc(10)), ...chunks, riffChunk('VP8 ', Buffer.alloc(10))]);
  return Buffer.concat([ascii('RIFF'), u32le(body.length), body]);
};
const box = (type, ...data) => { const d = Buffer.concat(data); return Buffer.concat([u32(d.length + 8), ascii(type), d]); };
const infe = (id, type, extra = Buffer.alloc(0)) => box('infe', Buffer.from([2, 0, 0, 0]), u16(id), u16(0), ascii(type), ascii('\0'), extra);
const avif = (...items) =>
  Buffer.concat([box('ftyp', ascii('avif'), u32(0), ascii('avifmif1')), box('meta', u32(0), box('hdlr', u32(0), u32(0), ascii('pict'), Buffer.alloc(13)), box('iinf', u32(0), u16(items.length), ...items)), box('mdat', Buffer.alloc(8))]);

const images = [
  ['clean JPEG', 'a.jpg', jpeg(), null],
  ['JPEG with EXIF', 'a.jpg', jpeg(jpegSegment(0xe1, Buffer.concat([ascii('Exif\0\0'), Buffer.alloc(16)]))), 'image-metadata'],
  ['JPEG with XMP', 'a.jpeg', jpeg(jpegSegment(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'))), 'image-metadata'],
  ['clean PNG', 'a.png', png(), null],
  ['PNG with eXIf', 'a.png', png(pngChunk('eXIf', Buffer.alloc(8))), 'image-metadata'],
  ['PNG with XMP iTXt', 'a.png', png(pngChunk('iTXt', ascii('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>'))), 'image-metadata'],
  ['clean WebP', 'a.webp', webp(), null],
  ['WebP with EXIF', 'a.webp', webp(riffChunk('EXIF', Buffer.alloc(8))), 'image-metadata'],
  ['WebP with XMP', 'a.webp', webp(riffChunk('XMP ', ascii('<x:xmpmeta/>'))), 'image-metadata'],
  ['clean AVIF', 'a.avif', avif(infe(1, 'av01')), null],
  ['AVIF with an Exif item', 'a.avif', avif(infe(1, 'av01'), infe(2, 'Exif')), 'image-metadata'],
  ['AVIF with an XMP item', 'a.avif', avif(infe(1, 'av01'), infe(2, 'mime', ascii('application/rdf+xml\0'))), 'image-metadata'],
];
for (const [name, file, buf, rule] of images) expect(name, checkDist(makeSite({ files: { [`images/${file}`]: buf } }), OPTIONS), rule);

// --- Claims -----------------------------------------------------------------------------------
console.log('claims');
// A copy of the parts of the repository the claims read, mutated one claim at a time.
function makeRepo(mutate) {
  const root = path.join(tmp, `repo-${++n}`);
  for (const rel of ['astro.config.mjs', 'src', '.github', 'public/charts']) {
    fs.cpSync(path.join(ROOT, rel), path.join(root, rel), { recursive: true });
  }
  mutate?.(root);
  return root;
}
const edit = (root, rel, from, to) => {
  const file = path.join(root, rel);
  const text = fs.readFileSync(file, 'utf8');
  const next = text.replace(from, to);
  if (next === text) throw new Error(`test setup: ${rel} has no ${from}`);
  fs.writeFileSync(file, next);
};
async function expectClaim(name, mutate, claim) {
  const root = makeRepo(mutate);
  const out = await runClaims(root, { dist: path.join(root, 'dist') });
  const got = [...new Set(out.map((v) => v.file))].sort();
  const want = claim ? [claim] : [];
  const ok = got.length === want.length && got.every((c, i) => c === want[i]);
  if (claim) exercised.add('claims');
  if (ok) console.log(`  ok   ${name}${claim ? ` -> ${claim}` : ''}`);
  else {
    failed++;
    console.log(`  FAIL ${name}: expected [${want.join(', ')}], got [${got.join(', ')}]`);
    for (const v of out) console.log(`         [${v.file}] ${v.message}`);
  }
}
const deploy = '.github/workflows/deploy.yml';
await expectClaim('repository as it is', null, null);
await expectClaim('an action pinned to a tag', (r) => edit(r, deploy, /actions\/checkout@[0-9a-f]{40}/, 'actions/checkout@v7'), 'actions-pinned');
await expectClaim('write access by default', (r) => edit(r, deploy, /^permissions:\n {2}contents: read/m, 'permissions:\n  contents: write'), 'actions-read-only');
await expectClaim('a write scope in the build job', (r) => edit(r, deploy, /^ {2}build:\n {4}runs-on: ubuntu-latest\n/m, '  build:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n'), 'actions-read-only');
await expectClaim('npm ci without --ignore-scripts', (r) => edit(r, deploy, 'npm ci --ignore-scripts', 'npm ci'), 'npm-ignore-scripts');
await expectClaim('npm install in CI', (r) => edit(r, deploy, '- run: npm run build', '- run: npm install\n      - run: npm run build'), 'npm-ignore-scripts');
await expectClaim('checkout persists credentials', (r) => edit(r, deploy, /\n\s+with:\n\s+persist-credentials: false/, ''), 'checkout-no-credentials');
await expectClaim('Dependabot skips actions', (r) => edit(r, '.github/dependabot.yml', 'package-ecosystem: github-actions', 'package-ecosystem: docker'), 'dependabot');
await expectClaim('CSP allows a CDN', (r) => edit(r, 'src/security/csp.mjs', "\"font-src 'self'\"", "\"font-src 'self' https://fonts.example.com\""), 'csp-strict');
await expectClaim('CSP allows data: fonts', (r) => edit(r, 'src/security/csp.mjs', "\"font-src 'self'\"", "\"font-src 'self' data:\""), 'csp-strict');
await expectClaim('CSP allows a bare host', (r) => edit(r, 'src/security/csp.mjs', "\"connect-src 'self'\"", "\"connect-src 'self' api.example.com\""), 'csp-strict');
await expectClaim('CSP allows blob:', (r) => edit(r, 'src/security/csp.mjs', "\"img-src 'self' data:\"", "\"img-src 'self' data: blob:\""), 'csp-strict');
await expectClaim('CSP allows unsafe-inline', (r) => edit(r, 'src/security/csp.mjs', "\"img-src 'self' data:\"", "\"img-src 'self' data:\",\n  \"style-src 'unsafe-inline'\""), 'csp-strict');
await expectClaim('config ignores csp.mjs', (r) => edit(r, 'astro.config.mjs', 'directives: [...directives]', "directives: [\"default-src 'none'\"]"), 'csp-strict');
await expectClaim('Shiki instead of Prism', (r) => edit(r, 'astro.config.mjs', "syntaxHighlight: 'prism'", "syntaxHighlight: 'shiki'"), 'prism');
await expectClaim('storage in another file', (r) => write(path.join(r, 'src/scripts/extra.ts'), "sessionStorage.setItem('gj.bg', '1');\n"), 'one-storage-key');
await expectClaim('an undeclared storage key', (r) => edit(r, 'src/scripts/bg/manager.ts', "const STORAGE_KEY = 'gj.bg';", "const STORAGE_KEY = 'gj.bg';\nconst OTHER = 'gj.visits';"), 'one-storage-key');
await expectClaim('the colophon names an unused storage key', (r) => edit(r, 'src/content/notes/note-d.md', '(`gj.bg.grain.knots`)', '(`gj.bg.grain.knots`, `gj.visits`)'), 'one-storage-key');
await expectClaim('the colophon leaves out a storage key', (r) => edit(r, 'src/content/notes/note-d.md', ', and any knots you plant on the Wood grain background (`gj.bg.grain.knots`)', ''), 'one-storage-key');
await expectClaim('a cookie', (r) => write(path.join(r, 'src/scripts/extra.ts'), "document.cookie = 'seen=1';\n"), 'no-cookies');
await expectClaim('a share-alike chart source', (r) => edit(r, 'public/charts/port-henry.json', '"license":"US public domain"', '"license":"ODbL-1.0"'), 'chart-sources');
await expectClaim('a third chart source', (r) => edit(r, 'public/charts/port-henry.json', '"sources":[', '"sources":[{"name":"Lake survey","license":"public domain"},'), 'chart-sources');
await expectClaim('a claim with no check', (r) => edit(r, 'src/security/claims.mjs', "'chart-sources',\n]);", "'chart-sources',\n  'hsts',\n]);"), 'scripts/claims.mjs');

// --- Coverage ---------------------------------------------------------------------------------
const untested = RULES.filter((r) => !exercised.has(r));
if (untested.length) {
  failed++;
  console.log(`FAIL: no test makes these rules fire: ${untested.join(', ')}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
if (failed) {
  console.log(`check-dist tests: FAIL (${failed})`);
  process.exit(1);
}
console.log('check-dist tests: PASS');
