import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Landing-page cards: one Markdown file per card in src/content/cards/.
const cards = defineCollection({
  loader: glob({ base: './src/content/cards', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    // Short line shown under the title.
    tagline: z.string(),
    // Links shown at the bottom of the card, in order.
    links: z.array(z.object({ label: z.string(), href: z.string() })).default([]),
    // Lower numbers appear first.
    order: z.number().default(100),
    draft: z.boolean().default(false),
  }),
});

// Blog posts: Markdown or MDX in src/content/blog/. MDX can embed React components.
const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z
      .array(z.string().regex(/^[a-z0-9-]+$/, 'Tags must be lowercase-kebab-case'))
      .default([]),
    // Set when cross-posting so search engines credit the original.
    canonicalUrl: z.url().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { cards, blog };
