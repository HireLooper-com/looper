import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { normalizeUrl } from "./site";

// The light end of the web ladder: search and plain fetches, done from the server in seconds.
// The browser on the looper's computer is the heavy fallback for pages these can't read.
// Search uses Tavily or Brave when a key is set, else DuckDuckGo's HTML results (no key).

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_BYTES = 3_000_000;
const MAX_TEXT = 20_000;
const MAX_LINKS = 80;

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

const strip = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// Paid engines have a monthly quota. Once one says it's used up (or rate-limits us), skip it for a
// while and let the next engine (DuckDuckGo in the end) answer, instead of asking it again every search.
const resting = new Map<string, number>();
const QUOTA_REST_MS = 60 * 60_000;
const RATE_REST_MS = 60_000;

async function tavily(query: string, limit: number): Promise<SearchHit[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: limit }),
    signal: AbortSignal.timeout(20_000),
  });
  // 432: plan limit reached, 433: pay-as-you-go limit reached, 429: too many requests.
  if (res.status === 432 || res.status === 433) resting.set("tavily", Date.now() + QUOTA_REST_MS);
  if (res.status === 429) resting.set("tavily", Date.now() + RATE_REST_MS);
  if (!res.ok) throw new Error(`Tavily answered ${res.status}`);
  const j = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
  return (j.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content.slice(0, 400) }));
}

async function brave(query: string, limit: number): Promise<SearchHit[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
    headers: { accept: "application/json", "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY! },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 402 || res.status === 429) resting.set("brave", Date.now() + (res.status === 402 ? QUOTA_REST_MS : RATE_REST_MS));
  if (!res.ok) throw new Error(`Brave answered ${res.status}`);
  const j = (await res.json()) as { web?: { results?: { title: string; url: string; description: string }[] } };
  return (j.web?.results ?? []).map((r) => ({ title: strip(r.title), url: r.url, snippet: strip(r.description) }));
}

async function duckduckgo(query: string, limit: number): Promise<SearchHit[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo answered ${res.status}`);
  const html = await res.text();
  const hits: SearchHit[] = [];
  // One block per result: the title link, then (usually) a snippet.
  for (const block of html.split(/class="result__title"/).slice(1)) {
    const m = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>(?:[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/);
    if (!m) continue;
    let url = decode(m[1]);
    // Results link through a redirect: //duckduckgo.com/l/?uddg=<the real url>
    const real = url.match(/[?&]uddg=([^&]+)/);
    if (real) url = decodeURIComponent(real[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    hits.push({ title: strip(m[2]), url, snippet: strip(m[3] ?? "") });
    if (hits.length >= limit) break;
  }
  return hits;
}

export async function webSearch(query: string, limit = 8) {
  const engines: [string, (q: string, n: number) => Promise<SearchHit[]>][] = [
    ...(process.env.TAVILY_API_KEY ? [["tavily", tavily] as [string, typeof tavily]] : []),
    ...(process.env.BRAVE_SEARCH_API_KEY ? [["brave", brave] as [string, typeof brave]] : []),
    ["duckduckgo", duckduckgo],
  ];
  const errors: string[] = [];
  for (const [name, run] of engines) {
    if ((resting.get(name) ?? 0) > Date.now()) {
      errors.push(`${name}: over its limit, skipped for now`);
      continue;
    }
    try {
      const hits = await run(query, limit);
      if (hits.length) return { engine: name, hits };
      errors.push(`${name}: no results`);
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { engine: null, hits: [] as SearchHit[], errors };
}

/** Readable text and the page's links, from raw HTML. */
function readHtml(html: string, base: URL) {
  const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const body = html.replace(/<(script|style|noscript|svg|template|head)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const links: { text: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = strip(m[2]);
    if (!text) continue;
    try {
      const url = new URL(decode(m[1]), base);
      if (!/^https?:$/.test(url.protocol) || seen.has(url.href)) continue;
      seen.add(url.href);
      links.push({ text: text.slice(0, 80), url: url.href });
    } catch {}
  }
  const text = decode(
    body
      .replace(/<\/(p|div|li|h[1-6]|section|article|br|tr|table|ul|ol|dd|dt)>/gi, "\n")
      .replace(/<(td|th)[^>]*>/gi, " | ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return { title, text, links };
}

/** Pages that render in the browser (empty shells) or refuse plain fetches, read through a rendering reader instead. */
async function viaReader(url: string) {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { accept: "text/plain", ...(process.env.JINA_API_KEY ? { authorization: `Bearer ${process.env.JINA_API_KEY}` } : {}) },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`the reader answered ${res.status}`);
  const text = (await res.text()).trim();
  const links = [...text.matchAll(/\[([^\]]{1,80})\]\((https?:\/\/[^)\s]+)\)/g)].slice(0, MAX_LINKS).map((m) => ({ text: m[1], url: m[2] }));
  return { text, links };
}

const BOT_WALL = /verify you are human|cf-chl|challenges\.cloudflare\.com|captcha-delivery\.com|attention required|unusual traffic|access denied/i;

export async function webFetch(input: string, opts: { render?: boolean } = {}) {
  let url = normalizeUrl(input);
  if (opts.render) {
    const r = await viaReader(url.toString());
    return { url: url.toString(), via: "reader", text: clipText(r.text), links: r.links };
  }
  let res: Response | undefined;
  // Follow redirects by hand so every hop is checked before it's fetched.
  for (let hop = 0; hop < 5; hop++) {
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": UA, accept: "text/html,application/json,application/xml,text/csv,*/*;q=0.5", "accept-language": "en,nl;q=0.8" },
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) break;
    url = normalizeUrl(new URL(next, url).toString());
  }
  const type = res?.headers.get("content-type") ?? "";
  const raw = res ? (await res.text()).slice(0, MAX_BYTES) : "";
  const blocked = !res?.ok || BOT_WALL.test(raw.slice(0, 5000));
  // Data comes back as is: JSON APIs, RSS and Atom feeds, CSV.
  if (res?.ok && /json|xml|rss|atom|csv|text\/plain/.test(type) && !/html/.test(type)) return { url: url.toString(), via: "fetch", status: res.status, contentType: type, text: clipText(raw) };
  const page = res?.ok ? readHtml(raw, url) : null;
  // A thin page is usually an app that renders in the browser; a refusal may pass through the reader.
  if (blocked || !page || page.text.length < 400) {
    try {
      const r = await viaReader(url.toString());
      if (r.text.length > (page?.text.length ?? 0)) return { url: url.toString(), via: "reader", note: blocked ? `A plain fetch got ${res?.status ?? "nothing"}; read through a rendering reader.` : "Read through a rendering reader (the page builds itself in the browser).", text: clipText(r.text), links: r.links };
    } catch (e) {
      if (!page) return { url: url.toString(), error: `${url.hostname} answered ${res?.status ?? "nothing"} and ${e instanceof Error ? e.message : "the reader failed"}. Next: search for another source, or open it with computer_browse.` };
    }
  }
  const note = blocked
    ? "This looks like a bot wall. Don't fight it: use the site's API, another source, or ask_owner."
    : page!.text.length < 3000
      ? "Short page. If what you need isn't here, it may load in the browser: fetch again with render: true."
      : undefined;
  return { url: url.toString(), via: "fetch", status: res!.status, title: page!.title, text: clipText(page!.text), links: page!.links.slice(0, MAX_LINKS), ...(note ? { note } : {}) };
}

const clipText = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n… (cut at ${MAX_TEXT} characters; fetch a narrower page, the next page, or the site's API/feed for the rest)` : s);

export function webTools(): ToolSet {
  return {
    web_search: tool({
      description:
        "Search the web. Use it to find where data lives (official APIs, open data, feeds, directories, lists, aggregators) before scraping, and to find candidates. Returns titles, URLs and snippets.",
      inputSchema: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(15).default(8) }),
      execute: ({ query, limit }) => webSearch(query, limit),
    }),
    web_fetch: tool({
      description:
        "Fetch one URL from the server and get its readable text plus its links (for next pages and detail pages). Fast and cheap: try it before your browser. JSON APIs, RSS/Atom feeds and CSV come back raw. Pages that build themselves in the browser are read through a rendering reader automatically; set render: true to force that.",
      inputSchema: z.object({ url: z.string().min(4), render: z.boolean().default(false) }),
      execute: async ({ url, render }) => {
        try {
          return await webFetch(url, { render });
        } catch (e) {
          return { url, error: `${e instanceof Error ? e.message : String(e)} Next: try another source, or open it with computer_browse.` };
        }
      },
    }),
  };
}
