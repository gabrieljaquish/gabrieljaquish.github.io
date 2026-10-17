# gabrieljaquish.com

Gabriel Jaquish's personal site. Built with [Astro](https://astro.build) and deployed to GitHub
Pages by GitHub Actions. React is set up for interactive islands in log entries; no page uses one
yet. (Cloudflare in front of it is planned but not set up yet; see
[One-time setup](#cloudflare-not-set-up-yet).)

## Privacy rules

This site publishes **no real or personal contact details** (phone number, email address, or
street address), anywhere: not in pages, front matter, `security.txt`, image metadata, tests, or
commit messages. Commits carry GitHub's noreply address and a `Co-Authored-By` trailer with
Anthropic's noreply address; neither is contact data. Test values that only look like contact
details are assembled at run time in `scripts/check-dist.test.mjs`,
so no committed file contains one whole. Contact goes through LinkedIn (and later a Cloudflare
Worker contact form).

Never chart a private place: no home, no private mooring, no live route. The lake chart shows
only NOAA and USGS data. If a waypoint ever gets a mark on the chart, it is a public place whose
position Gabriel supplies himself.

Before publishing photos: blur license plates, never show a full VIN, check backgrounds for
house numbers or street signs, strip EXIF and XMP metadata, and post trips after you're home.

## Working on the site

```bash
npm ci                  # install exactly what's in package-lock.json
npm run dev             # live-reload dev server at http://localhost:4321 (drafts show here)
npm run build           # astro check, astro build, then scripts/check-dist.mjs on dist/
npm run preview         # serve dist/ locally
npm run test:bg         # smoke-test the backgrounds in Node (stubbed canvas and DOM)
npm run test:dist       # test check-dist and the claims checks against fixtures
npm run test:contrast   # every text/fill pairing in every palette is at least 4.5:1
npm test                # all three; CI runs this before every build
```

The Content-Security-Policy is only applied by `build`/`preview`, not `dev`. Check new
features with `npm run build && npm run preview` before pushing. `build` doesn't run the test
scripts, but the deploy workflow runs `npm test` before it builds, so run it when you touch the
backgrounds, check-dist or the palettes.

## A route exists only when it has content

Nothing ships as a placeholder. Each route is built only once there is something real on it, and
nothing links to a route that isn't built (`src/lib/gates.ts`):

| Route | Built when |
|---|---|
| `/`, `/404`, `/vault/` | always |
| `/log/`, `/log/<slug>/`, `/log/tags/<tag>/`, `/rss.xml`, the header's "Logbook" link | at least one log entry is published |
| `/colophon/`, the footer's "Colophon" link, the home page's "How this site is built" | at least one colophon note is published |
| "see Note A" in the lake chart credit | `note-a` is published |

The 404 page's `ls` lists only the routes that are built. `/vault/` is built but left out of the
sitemap (`src/lib/hidden-paths.mjs`).

`public/humans.txt` links the colophon. If the colophon is ever unpublished, check-dist fails
until that line goes too.

## Adding content

Every collection shares one publishing gate. `draft: true` shows an entry in `npm run dev` only.
`confirm` lists the claims in it that Gabriel hasn't confirmed yet, and an entry can't leave
draft until that list is empty: `draft: false` with anything in `confirm` fails the build.

| What | Where | Front matter |
|---|---|---|
| Home-page waypoint | `src/content/waypoints/*.md` | `name`, optional `role`, `order`, optional `links` (`label` + `href`, https or root-relative), optional `tag`, optional `reviewBy`, `draft`, `confirm` |
| Log entry | `src/content/log/*.md` or `*.mdx` | `title`, `description`, `pubDate`, optional `updatedDate`, `tags`, optional `canonicalUrl` (https), `kind` (`entry` or `decision`), `decision` and optional `revisit` for decisions, `draft`, `confirm` |
| Colophon note | `src/content/notes/note-<letter>.md` | `title`, `backedBy` (claim ids), optional `appendix: csp-policy`, `draft`, `confirm` |
| Interactive component | `src/components/*.tsx` | Import into an `.mdx` entry and render with `client:visible` |
| Headline, description, social links | `src/consts.ts` | |

Waypoints:

- The file name is the anchor (`marina.md` is `/#marina`). The number in front of each one comes
  from `order` among the published waypoints, so it is never stored and never has gaps.
- A waypoint with a `tag` gets a "Log entries (n)" link once a published entry uses that tag, and
  entries with the tag link back to it ("Waypoint (n) · Name").
- Copy that goes stale with time ("its fifth season in 2027") gets a `reviewBy` date. The build
  warns 30 days ahead and fails once it has passed; recheck the copy, then move the date.

Log entries:

- The file name becomes the URL: `src/content/log/300sd-glow-plugs.md` →
  `/log/300sd-glow-plugs/`. Files sit directly in `src/content/log/`, not in folders.
- Tags are lowercase-kebab-case. Every tag gets a page at `/log/tags/<tag>/`, which doubles as a
  series page (for example `#mercedes` for the 300SD build log).
- A `kind: decision` entry needs a one-line `decision`, shown in a box at the top. `revisit`
  adds "Revisit by <date>" at the foot. Plain entries can't have either.
- For cross-posts, set `canonicalUrl` to the original so search engines credit it.

Colophon notes:

- The letter comes from the file name and never changes, so `/colophon/#note-a` stays valid
  even when other notes are unpublished.
- The colophon is written impersonally ("This site…"). Every sentence must be true of the repo
  or the build. If a note states a fact the build can check, list its claim id in `backedBy`
  (see below). If a fact can't be checked, verify it by hand before publishing, or leave it out.
- Note C prints the CSP directives from `src/security/csp.mjs`, so it can't drift from the
  config.

## What the build checks

`npm run build` ends with `scripts/check-dist.mjs`, which scans `dist/` and fails the build on:

- placeholder text (`TODO`, `TBD`, "Coming soon", "No posts yet"), `[CONFIRM`, or a draft marker;
- any `style=""` attribute;
- a script, stylesheet, image, frame, resource hint (`preconnect`, `dns-prefetch`, `prerender`),
  CSS `url()` or `<meta http-equiv="refresh">` that reaches another origin;
- a page without the CSP meta; a CSP that allows `'unsafe-…'`, any other origin, or `data:`
  outside `img-src`; a script, style or stylesheet before the CSP meta (a `<meta>` policy covers
  only what comes after it); inline code whose SHA-256 hash isn't in the policy; any `on…=`
  event-handler attribute;
- a page without exactly one `<h1>` and one `<main>`;
- an internal link, `#fragment`, asset, feed link or text-file URL that doesn't resolve;
- a sitemap that lists a hidden path, the 404 or a page that isn't built;
- anything shaped like an email address, North American phone number, US amateur call sign (in
  any letter case), VIN or precise coordinates (decimal, or degrees, minutes and seconds), and any
  `mailto:` or `tel:` link. It scans page text (inline tags such as `<b>` don't split it), HTML
  comments, JSON-LD, text files, and the string literals in `src/scripts/` (what the backgrounds
  draw and the console prints). `scripts/privacy-allowlist.txt` lists look-alikes such as `W3C`;
  never add a real call sign to it;
- phrases from `scripts/local-blocklist.txt`, a gitignored local file, in the same places;
- EXIF or XMP metadata in any JPEG, PNG, WebP or AVIF;
- a `security.txt` without `Contact`, with an email address, or expiring within 60 days;
- any claims check that fails.

**Claims.** The facts the colophon states about how the site is built are listed in
`src/security/claims.mjs`, and `scripts/claims.mjs` has a check for each one: the CSP allows no
other origin, Prism instead of Shiki, actions pinned to commit SHAs, read-only workflow
permissions, `npm ci --ignore-scripts`, checkout without persisted credentials, Dependabot for
npm and actions, browser storage only under the keys in `STORAGE_KEYS`, no cookies in the site's
code, and public-domain chart sources. If a check fails, fix the site or change the colophon
copy; never loosen the check to make it pass.

`node scripts/check-dist.mjs <dir>` scans another directory.

### CSP rules for components

- Use CSS classes, never `style="..."` attributes or inline `<script>` content in Markdown.
- Don't load scripts, styles, or fonts from other domains. The directives live in
  `src/security/csp.mjs`; adding an origin there fails the `csp-strict` claim, so a feature that
  truly needs one (for example map tiles) means changing the claim and Note C too.
- Code blocks use Prism, because Shiki's inline styles are incompatible with the CSP.

## Interactive backgrounds

Visitors pick a canvas background from the header (Lake chart by default; Drafting sheet, Radio
waterfall, Wood grain, or none). The choice is remembered in `localStorage` under `gj.bg`; Wood
grain also keeps planted knots under `gj.bg.grain.knots`. Those are the only storage keys
(`STORAGE_KEYS` in `src/security/claims.mjs`), and the colophon names them.

- `src/scripts/bg/manager.ts` loads only the chosen background, remounts it when the color scheme or
  reduced-motion setting changes, and passes it the palette from the CSS custom properties.
- Each background is a self-contained module, `src/scripts/bg/<id>.js`, exporting
  `mount(canvas, options)` (interface in `types.ts`). Palettes live in `global.css` under
  `html[data-bg='<id>']`.
- `src/scripts/bg/preload.js` runs inline before first paint so a saved choice doesn't flash. It
  is the first thing in `<body>`, not in `<head>`: Astro writes the CSP `<meta>` after all of the
  head's own content, and a `<meta>` policy covers only what comes after it (check-dist fails a
  script placed before it). Its SHA-256 is computed in `astro.config.mjs` and added to the CSP;
  edit the file, never inline it.
- `npm run test:bg` runs every background in Node with a stubbed canvas and DOM (not a real
  browser) and fails on exceptions, animation loops that never idle, work in hidden tabs, or
  listeners and timers left behind.
- The lake chart draws real NOAA and USGS data for Port Henry to Crown Point from
  `public/charts/port-henry.json`; see [tools/lake-chart](tools/lake-chart/README.md) to rebuild it.

## One-time setup

### GitHub

1. Create the repository and push `main`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Pages → Custom domain:** `gabrieljaquish.com`, then tick **Enforce HTTPS** once
   the certificate is issued.
4. Enable Dependabot alerts and secret scanning under **Settings → Code security**.

### Cloudflare (not set up yet)

None of these steps is live yet, so the colophon claims none of them. When one goes live, check
it against real responses before the colophon mentions it.

1. Add the domain and switch nameservers to Cloudflare. Enable DNSSEC.
2. DNS (initially **DNS only**, grey cloud, so GitHub can issue its certificate):
   - `A` records for the apex: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME www` → `gabrieljaquish.github.io`
3. After GitHub shows the certificate as issued, switch the records to **Proxied** and set
   **SSL/TLS → Full (strict)**, **Always Use HTTPS**, and minimum TLS 1.2.
4. **Rules → Transform Rules → Modify Response Header**, for all requests:

   | Header | Value |
   |---|---|
   | `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (add `; preload` once stable) |
   | `X-Content-Type-Options` | `nosniff` |
   | `Referrer-Policy` | `strict-origin-when-cross-origin` |
   | `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
   | `Content-Security-Policy` | `frame-ancestors 'none'` (the rest of the CSP is in each page's `<meta>` tag) |
   | `Cross-Origin-Opener-Policy` | `same-origin` |
   | `X-Clue` | Your easter-egg header (see below) |

5. Email spoofing protection, even though the domain sends no mail:
   - `TXT @` → `v=spf1 -all`
   - `TXT _dmarc` → `v=DMARC1; p=reject; adkim=s; aspf=s`
6. `CAA` records allowing only the certificate authorities in use (`letsencrypt.org`, plus
   Cloudflare's: check **SSL/TLS → Edge Certificates** for the current list).

Leave Bot Fight Mode off, or check what it does first: its `__cf_bm` cookie would make the
colophon's "sets no cookies" untrue.

## Easter eggs

The trail so far: HTML comment in every page → browser console → `robots.txt` → `/vault/` →
a response header you set at Cloudflare (step 4 above, so this step isn't live yet). Extend it
from there.

Rule: an easter egg must never look like a real vulnerability (fake credentials, fake admin
pages). Scanners and bug-bounty hunters will report it.

## Planned

- Contact form: Cloudflare Worker + Turnstile + Email Routing, so no address is ever published.
- Analytics without trackers: Cloudflare Web Analytics and/or a Worker that records aggregate
  counts (path, referrer, country, network name) and never stores IP addresses. The colophon's
  Note D says there are no analytics; change it in the same commit.
- Map page: MapLibre (React) with self-hosted PMTiles on Cloudflare R2. It needs a CSP change and
  the claims to match.
