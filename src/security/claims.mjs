// Facts about how this site is built that the colophon is allowed to state. Pure data, so the
// content schema can use it (a note lists the ids it relies on in `backedBy`).
// scripts/claims.mjs implements a check for every id, and scripts/check-dist.mjs runs them all on
// every build: if one of these stops being true, the build fails and the copy has to change.
export const CLAIM_IDS = /** @type {const} */ ([
  // The CSP allows no other origin and nothing unsafe (src/security/csp.mjs).
  'csp-strict',
  // Code blocks use Prism, not Shiki (whose inline styles the CSP would block).
  'prism',
  // Every GitHub Action is pinned to a full commit SHA.
  'actions-pinned',
  // Workflows default to read-only; only the deploy job can write, and only pages + id-token.
  'actions-read-only',
  // CI installs with `npm ci --ignore-scripts`, never `npm install`.
  'npm-ignore-scripts',
  // actions/checkout never persists credentials.
  'checkout-no-credentials',
  // Dependabot updates both npm packages and GitHub Actions.
  'dependabot',
  // Browser storage is used only by the backgrounds, under the keys in STORAGE_KEYS, and the
  // colophon names exactly those keys.
  'one-storage-key',
  // The site's own code never reads or writes cookies.
  'no-cookies',
  // The lake chart's map data comes from the NOAA ENCs and the USGS NHD only, all public domain.
  'chart-sources',
]);

// Every browser-storage key the site's code uses: the background choice, and the knots a
// visitor plants on the Wood grain background.
export const STORAGE_KEYS = /** @type {const} */ (['gj.bg', 'gj.bg.grain.knots']);

// The only source files allowed to use browser storage (Web Storage or IndexedDB).
export const STORAGE_FILES = /** @type {const} */ ([
  'src/scripts/bg/manager.ts',
  'src/scripts/bg/preload.js',
  'src/scripts/bg/grain.js',
]);
