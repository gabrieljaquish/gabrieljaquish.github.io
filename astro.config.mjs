// @ts-check
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';

import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

import { HIDDEN_PATHS } from './src/lib/hidden-paths.mjs';
import { directives } from './src/security/csp.mjs';

// The background preload runs inline at the top of <body> (after Astro's CSP <meta>, which a
// <meta> policy needs) so a saved background applies before first paint. Astro doesn't hash
// hand-written inline scripts, so hash the exact file contents here.
const bgPreload = readFileSync(new URL('./src/scripts/bg/preload.js', import.meta.url), 'utf8');
const bgPreloadHash = `sha256-${createHash('sha256').update(bgPreload).digest('base64')}`;

// https://astro.build/config
export default defineConfig({
  site: 'https://gabrieljaquish.com',
  integrations: [
    mdx(),
    react(),
    // Hidden pages (the vault) are built but never listed.
    sitemap({ filter: (page) => !HIDDEN_PATHS.some((hidden) => page.includes(hidden)) }),
  ],

  markdown: {
    // Shiki emits inline styles, which the CSP below would block. Prism uses classes.
    syntaxHighlight: 'prism',
  },

  security: {
    // Astro hashes every script and style it emits and writes a CSP <meta> tag per page.
    // A <meta> CSP can't carry frame-ancestors, report-to, or sandbox. Those need real response
    // headers, which GitHub Pages can't set; README's Cloudflare section has the plan (not live yet).
    csp: {
      // Defined in src/security/csp.mjs so the colophon and the claims checks read the same list.
      directives: [...directives],
      scriptDirective: {
        hashes: [/** @type {`sha256-${string}`} */ (bgPreloadHash)],
      },
    },
  },
});
