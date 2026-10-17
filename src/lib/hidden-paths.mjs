// Paths that are built but must never be listed in the sitemap. Pure data, so astro.config.mjs,
// src/consts.ts and scripts/check-dist.mjs (plain Node) can all import it.
/** @type {readonly string[]} */
export const HIDDEN_PATHS = ['/vault/'];
