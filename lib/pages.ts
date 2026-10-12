import { getPublic } from "./net";
import { parseSitemap } from "./spec";

// The pages already on the founder's site, from its sitemap: robots.txt names it, or /sitemap.xml.
// A routine reads them before it plans, so it improves a page that exists instead of writing it again.

const MAX_PAGES = 1000;
const MAX_SITEMAPS = 6;

async function text(url: URL) {
  const r = await getPublic(url);
  if (!r?.ok) return "";
  return (await r.text().catch(() => "")).slice(0, 5_000_000);
}

/** Every page URL on the site's own host, at most 1,000. Empty when there is no sitemap. */
export async function sitePages(website: string): Promise<string[]> {
  let home: URL;
  try {
    home = new URL(/^https?:\/\//.test(website) ? website : `https://${website}`);
  } catch {
    return [];
  }
  const host = home.hostname.replace(/^www\./, "");
  const robots = await text(new URL("/robots.txt", home));
  const named = [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const queue = named.length ? named : [new URL("/sitemap.xml", home).href];
  const pages = new Set<string>();
  for (let i = 0; i < queue.length && i < MAX_SITEMAPS && pages.size < MAX_PAGES; i++) {
    let url: URL;
    try {
      url = new URL(queue[i], home);
    } catch {
      continue;
    }
    const { urls, sitemaps } = parseSitemap(await text(url));
    queue.push(...sitemaps);
    for (const u of urls) {
      try {
        if (new URL(u).hostname.replace(/^www\./, "") === host) pages.add(u);
      } catch {}
      if (pages.size >= MAX_PAGES) break;
    }
  }
  return [...pages];
}
