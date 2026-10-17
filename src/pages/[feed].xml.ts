import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';
import { getPosts } from '../lib/gates';

// Gated: /rss.xml is built only once there is at least one published log entry.
export async function getStaticPaths() {
  const posts = await getPosts();
  return posts.length ? [{ params: { feed: 'rss' } }] : [];
}

export async function GET(context: APIContext) {
  const posts = await getPosts();
  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      categories: post.data.tags,
      link: `/log/${post.id}/`,
    })),
  });
}
