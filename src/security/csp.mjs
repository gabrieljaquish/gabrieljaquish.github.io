// The site's Content-Security-Policy directives. Pure data with no Node imports, so it is safe
// to import from pages (the colophon prints it) as well as from astro.config.mjs, which hands it
// to Astro. Astro adds script-src and style-src itself, with a SHA-256 hash for every script and
// style it emits (plus the background preload hash computed in astro.config.mjs).
// scripts/claims.mjs (`csp-strict`) fails the build if this ever allows another origin.
export const directives = /** @type {const} */ ([
  "default-src 'none'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
]);
