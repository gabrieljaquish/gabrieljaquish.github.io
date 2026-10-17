import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { CLAIM_IDS } from './security/claims.mjs';

const tag = z.string().regex(/^[a-z0-9-]+$/, 'Tags must be lowercase-kebab-case');
const httpsUrl = z.url().refine((u) => u.startsWith('https://'), 'External links must be https');
const link = z.object({
  label: z.string().min(1),
  href: z.union([httpsUrl, z.string().regex(/^\/[a-z0-9\-/#]*$/, 'Internal links are root-relative')]),
});

// Publishing gate shared by every collection. `confirm` lists claims still waiting for Gabriel;
// an entry can leave draft only when that list is empty. Drafts render in `astro dev` only.
const gate = {
  draft: z.boolean().default(false),
  confirm: z.array(z.string().min(1)).default([]),
};
const publishable = (d: { draft: boolean; confirm: string[] }) => d.draft || d.confirm.length === 0;
const unconfirmed = { message: 'draft: false requires an empty confirm list', path: ['confirm'] };

// Home-page waypoints: one Markdown file per part of Gabriel's life in src/content/waypoints/.
// The file id is the anchor (/#marina); the display number comes from the sort order.
const waypoints = defineCollection({
  loader: glob({ base: './src/content/waypoints', pattern: '*.md' }),
  schema: z
    .object({
      name: z.string(), // the waypoint's h2
      role: z.string().optional(), // follows the name after a comma, lowercase
      order: z.number().int(), // lower numbers first; the display number is never stored
      links: z.array(link).default([]),
      tag: tag.optional(), // log entries with this tag belong to the waypoint
      reviewBy: z.coerce.date().optional(), // time-relative copy; the build fails once passed
      ...gate,
    })
    .refine(publishable, unconfirmed),
});

// Logbook entries: Markdown or MDX directly in src/content/log/ (flat, so ids never contain a
// slash). MDX can embed React components. /log/, its tag pages and RSS exist only once at least
// one entry is published (see src/lib/gates.ts).
const log = defineCollection({
  loader: glob({ base: './src/content/log', pattern: '*.{md,mdx}' }),
  schema: z
    .object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      tags: z.array(tag).default([]),
      // Set when cross-posting so search engines credit the original.
      canonicalUrl: httpsUrl.optional(),
      // A decision entry records one decision: a one-line `decision`, shown in a box at the top,
      // and optionally a `revisit` date, shown at the foot.
      kind: z.enum(['entry', 'decision']).default('entry'),
      decision: z.string().min(1).optional(),
      revisit: z.coerce.date().optional(),
      ...gate,
    })
    .refine(publishable, unconfirmed)
    .refine((d) => d.kind !== 'decision' || !!d.decision, {
      message: 'kind: decision needs a one-line `decision`',
      path: ['decision'],
    })
    .refine((d) => d.kind === 'decision' || (!d.decision && !d.revisit), {
      message: '`decision` and `revisit` are only for kind: decision',
      path: ['kind'],
    }),
});

// Colophon notes: src/content/notes/note-a.md to note-z.md. The letter comes from the file name and
// never changes, so cross-references (/colophon/#note-a) stay valid. `backedBy` lists the repository
// facts the note states; scripts/claims.mjs checks every one of them on every build.
const notes = defineCollection({
  loader: glob({ base: './src/content/notes', pattern: 'note-[a-z].md' }),
  schema: z
    .object({
      title: z.string(),
      backedBy: z.array(z.enum(CLAIM_IDS)).default([]),
      // Generated content printed after the note's text (src/pages/colophon/[...index].astro).
      appendix: z.enum(['csp-policy']).optional(),
      ...gate,
    })
    .refine(publishable, unconfirmed),
});

export const collections = { waypoints, log, notes };
