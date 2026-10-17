## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## Project rules

- Never add real or personal contact details (phone number, email address, street address) anywhere in the site, its config, its tests, or commit messages. Test values that only look like them are assembled at run time from fragments (`scripts/check-dist.test.mjs`). See README "Privacy rules".
- Everything must work under the strict CSP (directives in `src/security/csp.mjs`, wired up in `astro.config.mjs`): no inline `style=""` attributes, no inline event handlers, no third-party scripts, styles, or fonts. A hand-written inline script goes in `<body>` (after Astro's CSP meta) and needs its hash added in `astro.config.mjs`. Verify with `npm run build && npm run preview`, since CSP isn't applied in dev.
- React is for interactive islands only (`client:visible` / `client:load`). Content pages stay plain Astro/Markdown.
- Pin GitHub Actions to full commit SHAs.
- Never chart a private place. Nothing personal gets a position (no home, private mooring, or live route); a chart mark is only ever a public place whose position Gabriel supplied himself.
- Never ship `[CONFIRM` or any other placeholder; check-dist fails on it. A claim Gabriel hasn't confirmed goes in the entry's `confirm` list with `draft: true`, and the entry publishes only once the list is empty.
- A route exists only when it has real content (`src/lib/gates.ts`). Don't add empty pages or links to routes that aren't built.
- Colophon notes state only facts verified against the repo or the build. List the claim ids a note relies on in `backedBy`. If a claims check fails, fix the site or the copy, never the check.
- Don't claim anything about Cloudflare, response headers, DNS, or analytics until it is live and checked; none of it is yet (README "One-time setup").
- Copy is casual, not a CV: plain, warm, short sentences, first person where it speaks for Gabriel; the colophon is impersonal ("This site…"). No resume phrasing or buzzwords.
- check-dist also scans for the phrases in scripts/local-blocklist.txt, a gitignored file kept only on the owner's machine. Never commit it or copy its contents into tracked files.
