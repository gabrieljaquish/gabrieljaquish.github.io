import { getCollection, type CollectionEntry } from 'astro:content';

// Route gates. A route exists only when it has real content: /log/, its tag pages and /rss.xml
// appear with the first published entry, /colophon/ with the first published note, and nothing
// links to a route that isn't built. Drafts show up in `astro dev` but never in a build.

export type Post = CollectionEntry<'log'>;
export type Waypoint = CollectionEntry<'waypoints'>;
export type Note = CollectionEntry<'notes'>;

export interface NavItem {
  href: string;
  label: string;
}

const visible = (d: { draft: boolean }) => import.meta.env.DEV || !d.draft;

// Published log entries, newest first.
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('log', ({ data }) => visible(data));
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

// Waypoints in display order. Time-relative copy carries a `reviewBy` date: a build fails once it
// has passed, so stale copy ("its fifth season in 2027") can never ship, and warns 30 days ahead.
export async function getWaypoints(): Promise<Waypoint[]> {
  const waypoints = await getCollection('waypoints', ({ data }) => visible(data));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const wp of waypoints) {
    const due = wp.data.reviewBy;
    if (!due) continue;
    const days = Math.round((due.valueOf() - today.valueOf()) / 864e5);
    const where = `src/content/waypoints/${wp.id}.md`;
    if (days < 0) {
      const message = `${where}: reviewBy ${isoDate(due)} has passed. Recheck the copy, then move reviewBy forward.`;
      if (import.meta.env.DEV) console.warn(message);
      else throw new Error(message);
    } else if (days <= 30) {
      console.warn(`${where}: reviewBy ${isoDate(due)} is ${days} day${days === 1 ? '' : 's'} away; recheck the copy.`);
    }
  }
  return waypoints.sort((a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id));
}

// Waypoint id -> display number, 1-based, from the sort order of what is published.
export function waypointNumbers(waypoints: Waypoint[]): Map<string, number> {
  return new Map(waypoints.map((wp, i) => [wp.id, i + 1]));
}

// Published colophon notes, in letter order (note-a first).
export async function getNotes(): Promise<Note[]> {
  const notes = await getCollection('notes', ({ data }) => visible(data));
  return notes.sort((a, b) => a.id.localeCompare(b.id));
}

// 'note-a' -> 'A'. The letter is the file name, so it stays put when other notes are unpublished.
export const noteLetter = (id: string) => id.replace(/^note-/, '').toUpperCase();

export async function gates() {
  const [posts, notes] = await Promise.all([getPosts(), getNotes()]);
  return {
    posts,
    notes,
    has: {
      log: posts.length > 0,
      colophon: notes.length > 0,
      // The footer's chart credit points at Note A (sources) only while it is published.
      noteA: notes.some((n) => n.id === 'note-a'),
    },
  };
}

// Tag name -> number of entries, sorted alphabetically.
export function countTags(posts: Post[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.data.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
}

// Header navigation. The brand link is home, so there is no separate "Home" item.
export async function navItems(): Promise<NavItem[]> {
  const { has } = await gates();
  return has.log ? [{ href: '/log/', label: 'Logbook' }] : [];
}

// The 404 page's `ls` line: only routes that are actually built.
export async function lsEntries(): Promise<NavItem[]> {
  const { has } = await gates();
  return [
    { href: '/', label: 'home' },
    ...(has.log ? [{ href: '/log/', label: 'log' }] : []),
    ...(has.colophon ? [{ href: '/colophon/', label: 'colophon' }] : []),
  ];
}

// 2026-10-16: the log's date column, in UTC like the dates in front matter.
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
