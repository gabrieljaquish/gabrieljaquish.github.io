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

- Never add a phone number, email address, or street address anywhere in the site, its config, or commit messages. See README "Privacy rules".
- Everything must work under the strict CSP in `astro.config.mjs`: no inline `style=""` attributes, no third-party scripts, styles, or fonts. Verify with `npm run build && npm run preview`, since CSP isn't applied in dev.
- React is for interactive islands only (`client:visible` / `client:load`). Content pages stay plain Astro/Markdown.
- Pin GitHub Actions to full commit SHAs.
