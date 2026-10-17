---
title: Security
backedBy: [csp-strict, prism, actions-pinned, actions-read-only, npm-ignore-scripts, checkout-no-credentials, dependabot]
appendix: csp-policy
draft: false
confirm: []
---

This site is static. Every page is built ahead of time, and nothing runs on a server.

Every page carries a strict Content-Security-Policy. Scripts, styles, fonts, images, and data load only from this site. Inline code runs only if its SHA-256 hash is in the policy. That's how the small script that applies your saved background before the page paints gets to run. There's no `'unsafe-inline'`, no `'unsafe-eval'`, and no other origin.

Code blocks are highlighted with Prism rather than Shiki, because Shiki's inline styles would break that policy.

GitHub Actions builds and deploys the site. Every action is pinned to a full commit SHA. The workflow defaults to read-only permissions. Only the deploy job gets write access, and only to publish to Pages. Dependencies install with `npm ci --ignore-scripts`, and checkout doesn't keep its credentials. Dependabot watches both the npm packages and the actions for updates.

On every build, a script checks the policy, the Prism setting, the workflow settings, and the Dependabot config against the repository, and the build fails if one stops being true. The source is [public on GitHub](https://github.com/gabrieljaquish/gabrieljaquish.github.io).

The policy's fixed directives are listed at the end of this note. The build adds `script-src` and `style-src` to each page, with `'self'` and that page's hashes.

Found a security problem? [security.txt](/.well-known/security.txt) says how to report it.
