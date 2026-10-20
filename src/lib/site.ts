import "server-only";
import { isIP } from "node:net";

// Reads a business's homepage for onboarding: title, description and visible text, capped so it
// fits in one model call. Public sites only: no IP literals, localhost or internal hostnames.

export interface SitePage {
  url: string;
  title: string;
  description: string;
  text: string;
}

const MAX_BYTES = 1_500_000;
const MAX_TEXT = 6000;

export function normalizeUrl(input: string): URL {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("That doesn't look like a website address.");
  }
  const host = url.hostname.toLowerCase();
  if (!/^https?:$/.test(url.protocol) || isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || /(^|\.)(localhost|local|internal)$/.test(host))
    throw new Error("Use your public website address, e.g. acme.com.");
  url.hash = "";
  return url;
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

const meta = (html: string, name: string) =>
  decode(html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)`, "i"))?.[1] ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i"))?.[1] ?? "").trim();

export async function readSite(input: string): Promise<SitePage> {
  let url = normalizeUrl(input);
  let res: Response | undefined;
  // Follow redirects by hand so every hop is checked before it's fetched.
  for (let hop = 0; hop < 5; hop++) {
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; LooperBot/1.0; +https://hirelooper.com)", accept: "text/html,*/*;q=0.5" },
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) break;
    url = normalizeUrl(new URL(next, url).toString());
  }
  if (!res?.ok) throw new Error(`${url.hostname} answered ${res?.status ?? "nothing"}.`);
  const html = (await res.text()).slice(0, MAX_BYTES);
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|h[1-6]|section|br|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, MAX_TEXT);
  return {
    url: url.toString(),
    title: decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim() || meta(html, "og:title"),
    description: meta(html, "description") || meta(html, "og:description"),
    text,
  };
}
