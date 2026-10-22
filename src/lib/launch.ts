import "server-only";
import { kv } from "./kv";
import { appUrl } from "./loops";

// Public launch-day scoreboards at /launch/<slug>. A looper claims a Product Hunt launch and posts
// readings from its runs; with PRODUCTHUNT_TOKEN set, page views also refresh from the Product Hunt
// API so the curve keeps moving between runs. Only the workspace that claimed a launch can write it.

export interface LaunchPoint {
  at: string;
  votes: number;
  comments: number;
  rank?: number;
}

export interface LaunchComment {
  author: string;
  body: string;
  votes?: number;
  url?: string;
}

export interface Launch {
  slug: string;
  uid: string;
  looperId: string;
  name: string;
  tagline?: string;
  thumbnail?: string;
  website?: string;
  points: LaunchPoint[];
  topComments: LaunchComment[];
  /** Launch day (YYYY-MM-DD, Pacific time) when the makers set the page up before going live. */
  launchDay?: string;
  /** Comments with a reply from the makers, and the median minutes it took. */
  replies?: { answered: number; medianMinutes?: number };
  createdAt: string;
  updatedAt: string;
  /** Last pull from the Product Hunt API, for throttling. */
  fetchedAt?: string;
}

export type LaunchReading = Partial<Pick<Launch, "name" | "tagline" | "thumbnail" | "website" | "topComments" | "replies">> & {
  votes: number;
  comments: number;
  rank?: number;
};

const key = (slug: string) => `launch:${slug}`;
const MAX_POINTS = 400;
// Readings closer together than this replace each other, so a busy page doesn't grow the curve per view.
const MERGE_MS = 4 * 60_000;
const FETCH_EVERY_MS = 5 * 60_000;

export const launchUrl = (slug: string) => `${appUrl()}/launch/${slug}`;

/** The post slug from a Product Hunt link (posts/<slug> or products/<product>/launches/<slug>) or a bare slug. */
export function launchSlug(input: string): string {
  const raw = input.trim().toLowerCase();
  let slug = raw;
  if (/producthunt\.com/.test(raw)) {
    const path = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).pathname.split("/").filter(Boolean);
    const at = path.findIndex((p) => p === "posts" || p === "launches");
    slug = at >= 0 ? (path[at + 1] ?? "") : (path.at(-1) ?? "");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) throw new Error("Give the Product Hunt link of the launch, e.g. producthunt.com/posts/acme.");
  return slug;
}

export const getLaunch = (slug: string) => kv.get<Launch>(key(slug));

function addPoint(l: Launch, p: LaunchPoint) {
  const last = l.points.at(-1);
  if (last && Date.parse(p.at) - Date.parse(last.at) < MERGE_MS) l.points[l.points.length - 1] = { ...p, rank: p.rank ?? last.rank };
  else l.points.push(p);
  if (l.points.length > MAX_POINTS) l.points.splice(0, l.points.length - MAX_POINTS);
}

function apply(l: Launch, r: LaunchReading, at: string) {
  if (r.name) l.name = r.name;
  if (r.tagline) l.tagline = r.tagline;
  if (r.thumbnail) l.thumbnail = r.thumbnail;
  if (r.website) l.website = r.website;
  if (r.topComments?.length) l.topComments = r.topComments.slice(0, 3);
  if (r.replies) l.replies = r.replies;
  addPoint(l, { at, votes: r.votes, comments: r.comments, ...(r.rank ? { rank: r.rank } : {}) });
  l.updatedAt = at;
}

/** A looper's reading. The first one claims the launch for its workspace; others can't write it. */
export function recordLaunch(uid: string, looperId: string, slug: string, reading: LaunchReading) {
  const at = new Date().toISOString();
  const blank = (): Launch => ({ slug, uid: "", looperId, name: slug, points: [], topComments: [], createdAt: at, updatedAt: at });
  return kv.update<Launch, Launch>(key(slug), blank, (l) => {
    if (l.uid && l.uid !== uid) throw new Error("Another workspace already runs the scoreboard for this launch.");
    l.uid = uid;
    l.looperId = looperId;
    apply(l, reading, at);
    return l;
  });
}

/** The owner sets the page up before launch, so the link can be shared with a countdown. */
export function claimLaunch(uid: string, slug: string, input: { name: string; tagline?: string; launchDay?: string }) {
  const at = new Date().toISOString();
  const blank = (): Launch => ({ slug, uid: "", looperId: "", name: slug, points: [], topComments: [], createdAt: at, updatedAt: at });
  return kv.update<Launch, Launch>(key(slug), blank, (l) => {
    if (l.uid && l.uid !== uid) throw new Error("Another workspace already runs the scoreboard for this launch.");
    l.uid = uid;
    l.name = input.name.trim().slice(0, 80) || l.name;
    l.tagline = input.tagline?.trim().slice(0, 140) || l.tagline;
    if (input.launchDay && /^\d{4}-\d{2}-\d{2}$/.test(input.launchDay)) l.launchDay = input.launchDay;
    l.updatedAt = at;
    return l;
  });
}

/** When a launch day starts: 12:01 AM in San Francisco, in PDT or PST as that date falls. */
export function launchStart(day: string) {
  for (const off of ["-07:00", "-08:00"]) {
    const t = new Date(`${day}T00:01:00${off}`);
    if (Number(t.toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" })) === 0) return t;
  }
  return new Date(`${day}T00:01:00-08:00`);
}

/** "October 27" for a launch day, without shifting it through a time zone. */
export const launchDayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

// ——— Product Hunt API (optional) ———

const POST_QUERY = `query($slug: String!) {
  post(slug: $slug) {
    name tagline website votesCount commentsCount featuredAt
    thumbnail { url }
    comments(first: 3, order: VOTES) { edges { node { body votesCount url user { name } } } }
  }
}`;

const DAY_QUERY = `query($after: DateTime!) {
  posts(first: 50, featured: true, order: RANKING, postedAfter: $after) { edges { node { slug } } }
}`;

async function ph<T>(query: string, variables: Record<string, unknown>): Promise<T | undefined> {
  const token = process.env.PRODUCTHUNT_TOKEN;
  if (!token) return undefined;
  const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Product Hunt answered ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

/** Midnight in San Francisco, where Product Hunt's day starts, for the day `iso` falls in. */
function phDayStart(iso: string) {
  const d = new Date(iso);
  const pt = new Date(d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const offset = d.getTime() - pt.getTime();
  pt.setHours(0, 0, 0, 0);
  return new Date(pt.getTime() + offset).toISOString();
}

type PostData = {
  post: {
    name: string;
    tagline: string;
    website: string;
    votesCount: number;
    commentsCount: number;
    featuredAt: string | null;
    thumbnail: { url: string } | null;
    comments: { edges: { node: { body: string; votesCount: number; url: string; user: { name: string } } }[] };
  } | null;
};

/** Pull fresh numbers from Product Hunt when a token is set and the last pull is older than 5 minutes. */
export async function refreshLaunch(slug: string) {
  if (!process.env.PRODUCTHUNT_TOKEN) return;
  const cur = await getLaunch(slug);
  if (!cur || (cur.fetchedAt && Date.now() - Date.parse(cur.fetchedAt) < FETCH_EVERY_MS)) return;
  const at = new Date().toISOString();
  // Claim the slot first so a burst of page views makes one call, not one each.
  await kv.update<Launch | null, void>(key(slug), () => null, (l) => {
    if (l) l.fetchedAt = at;
  });
  const post = (await ph<PostData>(POST_QUERY, { slug }))?.post;
  if (!post) return;
  // Rank of the day, only while the launch is featured and on today's list.
  let rank: number | undefined;
  if (post.featuredAt) {
    const day = await ph<{ posts: { edges: { node: { slug: string } }[] } }>(DAY_QUERY, { after: phDayStart(post.featuredAt) }).catch(() => undefined);
    const i = day?.posts.edges.findIndex((e) => e.node.slug === slug) ?? -1;
    if (i >= 0) rank = i + 1;
  }
  await kv.update<Launch | null, void>(key(slug), () => null, (l) => {
    if (!l) return;
    apply(
      l,
      {
        name: post.name,
        tagline: post.tagline,
        website: post.website,
        thumbnail: post.thumbnail?.url,
        votes: post.votesCount,
        comments: post.commentsCount,
        rank,
        topComments: post.comments.edges.map(({ node }) => ({ author: node.user.name, body: node.body, votes: node.votesCount, url: node.url })),
      },
      at,
    );
    l.fetchedAt = at;
  });
}

export const isStale = (l: Launch) => !!process.env.PRODUCTHUNT_TOKEN && (!l.fetchedAt || Date.now() - Date.parse(l.fetchedAt) >= FETCH_EVERY_MS);

/** True at most once every 5 minutes per launch, so page views start the launch looper's due runs without locking its workspace on every view. */
export async function claimTick(slug: string) {
  const k = `launch-tick:${slug}`;
  if (await kv.get(k)) return false;
  await kv.set(k, true, 300);
  return true;
}
