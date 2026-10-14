// @ts-check
import { defineConfig } from 'astro/config';

import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://gabrieljaquish.com',
  integrations: [mdx(), react(), sitemap()],

  markdown: {
    // Shiki emits inline styles, which the CSP below would block. Prism uses classes.
    syntaxHighlight: 'prism',
  },

  security: {
    // Astro hashes every script and style it emits and writes a CSP <meta> tag per page.
    // A <meta> CSP can't carry frame-ancestors, report-to, or sandbox; those are set as
    // real response headers at Cloudflare (see README).
    csp: {
      directives: [
        "default-src 'none'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "object-src 'none'",
        'upgrade-insecure-requests',
      ],
    },
  },
});
