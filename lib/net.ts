import { lookup } from "node:dns/promises";

// Outbound fetches to addresses the founder controls (homepage, custom connectors) go to public hosts only.
const PRIVATE = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd]|fe80|::ffff:(10|127|169\.254|192\.168)\.)/i;

/** True for http(s) URLs on a public host. A public name can still point inside our network, so the address is checked too. */
export async function isPublic(url: URL) {
  const host = url.hostname;
  if (!/^https?:$/.test(url.protocol) || !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || /(^|\.)(localhost|internal|local)$/.test(host))
    return false;
  const addrs = await lookup(host, { all: true }).catch(() => []);
  return addrs.length > 0 && !addrs.some((x) => PRIVATE.test(x.address));
}

/** GET a public URL, following up to 3 redirects, each hop checked with isPublic. Null when blocked or unreachable. */
export async function getPublic(start: URL, timeoutMs = 8000) {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    if (!(await isPublic(url))) return null;
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual", headers: { "user-agent": "LooperBot/1.0 (+https://hirelooper.com)" } }).catch(
      () => null,
    );
    if (!r) return null;
    const next = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!next) return r;
    url = new URL(next, url);
  }
  return null;
}
