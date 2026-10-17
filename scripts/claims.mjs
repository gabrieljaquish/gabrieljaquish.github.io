// Checks behind the colophon's claims. One function per id in src/security/claims.mjs; each reads
// the repository (never the network) and returns a list of problems, empty when the claim holds.
// Run by scripts/check-dist.mjs on every build. No dependencies beyond Node itself.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

function workflows(root) {
  const dir = path.join(root, '.github/workflows');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: `.github/workflows/${f}`, text: read(root, `.github/workflows/${f}`) }));
}

// Lines with comments removed (a `#` that starts a comment, not one inside a value like a URL
// fragment; workflow values here never contain ` #`).
const yamlLines = (text) => text.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '').replace(/\s+$/, ''));
const indent = (line) => line.length - line.trimStart().length;

// Source files the site's own code lives in (not tooling, tests or dependencies).
const SOURCE_EXT = /\.(?:astro|[cm]?[jt]sx?)$/;

// Colophon notes as { file, backedBy, body }. Reads only the front matter's `backedBy`, as an
// inline list (`backedBy: [a, b]`) or a block list (`- a` lines).
function notes(root) {
  const dir = path.join(root, 'src/content/notes');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      const front = m ? m[1] : '';
      const body = m ? m[2] : text;
      let backedBy = [];
      const inline = front.match(/^backedBy:\s*\[([^\]]*)\]/m);
      const block = front.match(/^backedBy:\s*\n((?:\s+-\s*.+\n?)+)/m);
      if (inline) backedBy = inline[1].split(',');
      else if (block) backedBy = block[1].split('\n').map((l) => l.replace(/^\s*-\s*/, ''));
      backedBy = backedBy.map((id) => id.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      return { file: `src/content/notes/${f}`, backedBy, body };
    });
}

export const CHECKS = {
  async 'csp-strict'(root) {
    const problems = [];
    const { directives } = await import(pathToFileURL(path.join(root, 'src/security/csp.mjs')).href);
    for (const required of ["default-src 'none'", "object-src 'none'", "base-uri 'none'"]) {
      if (!directives.includes(required)) problems.push(`directives lack "${required}"`);
    }
    // Every source is a keyword or a hash. The one exception is data: in img-src (data: URLs
    // elsewhere can carry script or style); a host, a scheme like blob: or ws:, or a wildcard
    // would let another origin in.
    for (const d of directives) {
      const [name, ...sources] = d.trim().split(/\s+/);
      for (const s of sources) {
        if (/unsafe-/i.test(s)) problems.push(`directive "${d}" allows unsafe code (${s})`);
        else if (/^data:$/i.test(s) ? name !== 'img-src' : !/^'(?:self|none|report-sample|sha(?:256|384|512)-[A-Za-z0-9+/=_-]+)'$/.test(s)) {
          problems.push(`directive "${d}" allows ${s}, which isn't this site`);
        }
      }
    }
    // The config must actually use this list, or the claim is about a file nobody reads.
    const config = read(root, 'astro.config.mjs');
    if (!/from '\.\/src\/security\/csp\.mjs'/.test(config) || !/directives:\s*\[\.\.\.directives\]/.test(config)) {
      problems.push('astro.config.mjs does not take its CSP directives from src/security/csp.mjs');
    }
    return problems;
  },

  prism(root) {
    return /syntaxHighlight:\s*'prism'/.test(read(root, 'astro.config.mjs'))
      ? []
      : ["astro.config.mjs does not set syntaxHighlight: 'prism'"];
  },

  'actions-pinned'(root) {
    const problems = [];
    let count = 0;
    for (const { file, text } of workflows(root)) {
      for (const line of yamlLines(text)) {
        const m = line.match(/^\s*(?:-\s+)?uses:\s*['"]?([^\s'"]+)/);
        if (!m) continue;
        count++;
        if (!/@[0-9a-f]{40}$/.test(m[1])) problems.push(`${file}: "${m[1]}" is not pinned to a full commit SHA`);
      }
    }
    if (count === 0) problems.push('no workflow uses any action (has the deploy workflow moved?)');
    return problems;
  },

  'actions-read-only'(root) {
    const problems = [];
    const files = workflows(root);
    if (files.length === 0) problems.push('no workflows found');
    for (const { file, text } of files) {
      const lines = yamlLines(text);
      // Top-level default: exactly `permissions:` followed by `  contents: read`.
      const top = lines.findIndex((l) => /^permissions:/.test(l));
      if (top === -1) {
        problems.push(`${file}: no top-level permissions block`);
      } else {
        const block = [];
        for (let i = top + 1; i < lines.length && (lines[i] === '' || indent(lines[i]) > 0); i++) {
          if (lines[i].trim()) block.push(lines[i].trim());
        }
        if (lines[top].trim() !== 'permissions:' || block.length !== 1 || !/^contents:\s*read$/.test(block[0])) {
          problems.push(`${file}: top-level permissions are not exactly "contents: read"`);
        }
      }
      // Any write scope must be pages or id-token, inside the deploy job.
      let inJobs = false;
      let job = null;
      lines.forEach((line, i) => {
        if (/^\S/.test(line)) inJobs = /^jobs:/.test(line);
        else if (inJobs && /^ {2}[\w-]+:/.test(line)) job = line.trim().slice(0, -1);
        if (/write-all/.test(line)) problems.push(`${file}:${i + 1}: write-all permissions`);
        const w = line.match(/^\s+([\w-]+):\s*write\b/);
        if (w && !(job === 'deploy' && (w[1] === 'pages' || w[1] === 'id-token'))) {
          problems.push(`${file}:${i + 1}: "${w[1]}: write" outside the deploy job's pages/id-token`);
        }
      });
    }
    return problems;
  },

  'npm-ignore-scripts'(root) {
    const problems = [];
    let count = 0;
    for (const { file, text } of workflows(root)) {
      yamlLines(text).forEach((line, i) => {
        // `npm ci` and its aliases.
        if (/\bnpm\s+(?:ci|clean-install|ic|install-clean|isntall-clean)(?![\w-])/.test(line)) {
          count++;
          if (!/--ignore-scripts\b/.test(line)) problems.push(`${file}:${i + 1}: npm ci without --ignore-scripts`);
        }
        // `npm install` and its aliases (including install-and-test variants), which can change
        // the lockfile and run lifecycle scripts.
        if (/\bnpm\s+(?:i|in|ins|inst|insta|instal|install|isnt|isnta|isntal|isntall|add|it|cit|install-test|install-ci-test)(?![\w-])/.test(line)) {
          problems.push(`${file}:${i + 1}: npm install in CI`);
        }
      });
    }
    if (count === 0) problems.push('no workflow runs npm ci');
    return problems;
  },

  'checkout-no-credentials'(root) {
    const problems = [];
    let count = 0;
    for (const { file, text } of workflows(root)) {
      const lines = yamlLines(text);
      lines.forEach((line, i) => {
        if (!/^\s*(?:-\s+)?uses:\s*['"]?actions\/checkout@/.test(line)) return;
        count++;
        // The step runs from its `- ` line to the next line at that indent or shallower.
        let start = i;
        while (start > 0 && !/^\s*-\s/.test(lines[start])) start--;
        const stepIndent = indent(lines[start]);
        let found = false;
        for (let j = start + 1; j < lines.length; j++) {
          if (lines[j].trim() && indent(lines[j]) <= stepIndent) break;
          if (/^\s*persist-credentials:\s*false\s*$/.test(lines[j])) found = true;
        }
        if (!found) problems.push(`${file}:${i + 1}: actions/checkout without persist-credentials: false`);
      });
    }
    if (count === 0) problems.push('no workflow uses actions/checkout');
    return problems;
  },

  dependabot(root) {
    const file = '.github/dependabot.yml';
    if (!exists(root, file)) return [`${file} is missing`];
    const text = read(root, file);
    return ['npm', 'github-actions']
      .filter((eco) => !new RegExp(`package-ecosystem:\\s*['"]?${eco}['"]?\\s*$`, 'm').test(text))
      .map((eco) => `${file} has no "${eco}" ecosystem`);
  },

  async 'one-storage-key'(root) {
    const problems = [];
    const { STORAGE_KEYS, STORAGE_FILES } = await import(
      pathToFileURL(path.join(root, 'src/security/claims.mjs')).href
    );
    const found = new Set();
    for (const file of walk(path.join(root, 'src')).filter((f) => SOURCE_EXT.test(f))) {
      const name = rel(root, file);
      const text = fs.readFileSync(file, 'utf8');
      const usesStorage = /\b(?:localStorage|sessionStorage|indexedDB)\b/.test(text);
      if (usesStorage && !STORAGE_FILES.includes(name)) {
        problems.push(`${name} uses browser storage; only ${STORAGE_FILES.join(', ')} may`);
      }
      if (!STORAGE_FILES.includes(name)) continue;
      for (const m of text.matchAll(/(['"`])(gj\.[^'"`\s]*)\1/g)) found.add(m[2]);
      // A storage call keyed by any other string literal.
      for (const m of text.matchAll(/\.(?:getItem|setItem|removeItem)\(\s*(['"`])([^'"`]*)\1/g)) {
        if (!m[2].startsWith('gj.')) problems.push(`${name} uses storage key "${m[2]}"`);
      }
    }
    for (const key of found) if (!STORAGE_KEYS.includes(key)) problems.push(`undeclared storage key "${key}"`);
    for (const key of STORAGE_KEYS) if (!found.has(key)) problems.push(`declared storage key "${key}" is no longer used`);
    // The colophon names the keys in prose, so it must name exactly these: every key a note
    // mentions is declared, and a note that cites this claim lists them all.
    for (const note of notes(root)) {
      const named = new Set(note.body.match(/\bgj\.[a-z0-9]+(?:\.[a-z0-9]+)*/gi) ?? []);
      for (const key of named) if (!STORAGE_KEYS.includes(key)) problems.push(`${note.file} names storage key "${key}", which the site doesn't use`);
      if (!note.backedBy.includes('one-storage-key')) continue;
      for (const key of STORAGE_KEYS) if (!named.has(key)) problems.push(`${note.file} cites one-storage-key but doesn't name "${key}"`);
    }
    return problems;
  },

  'no-cookies'(root, { dist }) {
    const problems = [];
    const files = [
      ...walk(path.join(root, 'src')).filter((f) => SOURCE_EXT.test(f)),
      ...walk(path.join(root, 'public')).filter((f) => /\.(?:m?js|html)$/.test(f)),
      ...walk(dist).filter((f) => /\.(?:m?js|html)$/.test(f)),
    ];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      if (/document\s*\.\s*cookie|\bcookieStore\b|http-equiv=["']?set-cookie/i.test(text)) {
        problems.push(`${rel(root, file)} touches cookies`);
      }
    }
    return problems;
  },

  'chart-sources'(root) {
    const file = 'public/charts/port-henry.json';
    if (!exists(root, file)) return [`${file} is missing`];
    const { sources } = JSON.parse(read(root, file));
    if (!Array.isArray(sources) || sources.length === 0) return [`${file} lists no sources`];
    const problems = sources
      .filter((s) => !/CC0|public domain/i.test(s.license ?? ''))
      .map((s) => `source "${s.name}" is not CC0 or public domain (${s.license})`);
    const names = sources.map((s) => s.name).join(' | ');
    for (const needle of ['US4NY1LS', 'US4NY1MS', 'National Hydrography Dataset']) {
      if (!names.includes(needle)) problems.push(`no source named "${needle}"`);
    }
    // Note A says no map data other than the NOAA charts and the NHD goes into the chart.
    for (const s of sources) {
      if (!/US4NY1[LM]S|National Hydrography Dataset/.test(s.name ?? '')) {
        problems.push(`source "${s.name}" is neither the NOAA ENCs nor the USGS NHD; update Note A`);
      }
    }
    return problems;
  },
};

// Runs every claim. Returns [{ rule: 'claims', file, message }], empty when all hold.
export async function runClaims(root, { dist = path.join(root, 'dist') } = {}) {
  const { CLAIM_IDS } = await import(pathToFileURL(path.join(root, 'src/security/claims.mjs')).href);
  const out = [];
  for (const id of CLAIM_IDS) {
    if (!CHECKS[id]) {
      out.push({ rule: 'claims', file: 'scripts/claims.mjs', message: `claim "${id}" has no check` });
      continue;
    }
    let problems;
    try {
      problems = await CHECKS[id](root, { dist });
    } catch (error) {
      problems = [`check threw: ${error.message}`];
    }
    for (const p of problems) out.push({ rule: 'claims', file: id, message: p });
  }
  for (const id of Object.keys(CHECKS)) {
    if (!CLAIM_IDS.includes(id)) {
      out.push({ rule: 'claims', file: 'src/security/claims.mjs', message: `check "${id}" is not a listed claim` });
    }
  }
  return out;
}
