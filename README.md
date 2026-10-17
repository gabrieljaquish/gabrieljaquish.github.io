# gabrieljaquish.com

Personal site and blog. Built with [Astro](https://astro.build), with React only on interactive
pages, deployed to GitHub Pages by GitHub Actions, and served behind Cloudflare.

## Privacy rules

This site publishes **no phone number, email address, or street address**, anywhere: not in
pages, front matter, `security.txt`, image metadata, or commit history. Contact goes through
LinkedIn (and later a Cloudflare Worker contact form).

Before publishing photos: blur license plates, never show a full VIN, check backgrounds for
house numbers or street signs, and post trips after you're home.

## Working on the site

```bash
npm ci            # install exactly what's in package-lock.json
npm run dev       # live-reload dev server at http://localhost:4321
npm run build     # type-check, then build to dist/
npm run preview   # serve dist/ locally
```

The Content-Security-Policy is only applied by `build`/`preview`, not `dev`. Check new
features with `npm run build && npm run preview` before pushing.

## Adding content

| What | Where | Notes |
|---|---|---|
| Landing-page card | `src/content/cards/*.md` | Front matter: `title`, `tagline`, optional `links` (list of `label` + `href`), `order`, `draft` |
| Blog post | `src/content/blog/*.md` or `*.mdx` | Front matter: `title`, `description`, `pubDate`, `tags`, optional `updatedDate`, `canonicalUrl`, `draft` |
| Interactive component | `src/components/*.tsx` | Import into an `.mdx` post and render with `client:visible` |
| Headline, social links | `src/consts.ts` | |

- The file name becomes the URL: `src/content/blog/300sd-glow-plugs.md` → `/blog/300sd-glow-plugs/`.
- Tags are lowercase-kebab-case. Every tag gets a page at `/blog/tags/<tag>/`, which doubles
  as a series page (for example `#mercedes` for the 300SD build log).
- For cross-posts, set `canonicalUrl` to the original so search engines credit it.
- `draft: true` shows a post in `npm run dev` but leaves it out of the build.

### CSP rules for components

- Use CSS classes, never `style="..."` attributes or inline `<script>` content in Markdown.
- Don't load scripts, styles, or fonts from other domains. If a feature truly needs one (for
  example map tiles), add that origin to `security.csp.directives` in `astro.config.mjs`.
- Code blocks use Prism, because Shiki's inline styles are incompatible with the CSP.

## Interactive backgrounds

Visitors pick a canvas background from the header (Lake chart by default; Drafting sheet, Radio
waterfall, Wood grain, or none). The choice is remembered in `localStorage`.

- `src/scripts/bg/manager.ts` loads only the chosen background, remounts it when the color scheme or
  reduced-motion setting changes, and passes it the palette from the CSS custom properties.
- Each background is a self-contained module, `src/scripts/bg/<id>.js`, exporting
  `mount(canvas, options)` (interface in `types.ts`). Palettes live in `global.css` under
  `html[data-bg='<id>']`.
- `src/scripts/bg/preload.js` runs inline before first paint so a saved choice doesn't flash. Its
  SHA-256 is computed in `astro.config.mjs` and added to the CSP; edit the file, never inline it.
- `npm run test:bg` runs every background in a headless fake browser and fails on exceptions,
  animation loops that never idle, work in hidden tabs, or listeners and timers left behind.
- The lake chart draws real NOAA and USGS data for Port Henry to Crown Point from
  `public/charts/port-henry.json`; see [tools/lake-chart](tools/lake-chart/README.md) to rebuild it.

## One-time setup

### GitHub

1. Create the repository and push `main`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Pages → Custom domain:** `gabrieljaquish.com`, then tick **Enforce HTTPS** once
   the certificate is issued.
4. Enable Dependabot alerts and secret scanning under **Settings → Code security**.

### Cloudflare

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

## Easter eggs

The trail so far: HTML comment in every page → browser console → `robots.txt` → `/vault/` →
a response header you set at Cloudflare (step 4 above). Extend it from there.

Rule: an easter egg must never look like a real vulnerability (fake credentials, fake admin
pages). Scanners and bug-bounty hunters will report it.

## Planned

- Contact form: Cloudflare Worker + Turnstile + Email Routing, so no address is ever published.
- Site structure for the tinker-space (to be decided).
- Analytics without trackers: Cloudflare Web Analytics and/or a Worker that records aggregate
  counts (path, referrer, country, network name) and never stores IP addresses.
- Map page: MapLibre (React) with self-hosted PMTiles on Cloudflare R2.
