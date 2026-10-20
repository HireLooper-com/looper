"use server";

import { z } from "zod";
import { deleteImages, mutateCanvas, readCanvas } from "@/lib/canvas";
import { read } from "@/lib/db";
import { requireUid } from "@/lib/session";
import type { CanvasItem, LooperCanvas } from "@/lib/types";

async function owned(looperId: string) {
  const uid = await requireUid();
  if (!(await read(uid)).loopers.some((l) => l.id === looperId)) throw new Error("Looper not found");
  return uid;
}

export async function getCanvas(looperId: string): Promise<LooperCanvas> {
  return readCanvas(await owned(looperId), looperId);
}

const num = z.number().finite();
const itemSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(["note", "text", "image", "link", "frame", "arrow"]),
  x: num,
  y: num,
  w: num.min(0).max(20000),
  h: num.min(0).max(20000),
  text: z.string().max(20_000).optional(),
  src: z.string().max(2000).optional(),
  url: z.string().max(2000).optional(),
  title: z.string().max(500).optional(),
  image: z.string().max(2000).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  by: z.enum(["you", "looper"]),
  at: z.string().max(40),
});

/**
 * Apply the owner's edits by item id, so the looper pinning things during a run and the owner
 * moving things at the same moment don't overwrite each other. Returns the merged canvas.
 */
export async function patchCanvas(looperId: string, patch: { upsert: CanvasItem[]; remove: string[] }): Promise<{ ok: true; canvas: LooperCanvas } | { ok: false; error: string }> {
  try {
    const uid = await owned(looperId);
    const upsert = z.array(itemSchema).max(500).parse(patch.upsert);
    const remove = z.array(z.string()).max(500).parse(patch.remove);
    const { canvas, gone } = await mutateCanvas(uid, looperId, (c) => {
      const gone = c.items.filter((i) => remove.includes(i.id));
      c.items = c.items.filter((i) => !remove.includes(i.id) && !(i.kind === "arrow" && (remove.includes(i.from ?? "") || remove.includes(i.to ?? ""))));
      for (const u of upsert) {
        const at = c.items.findIndex((i) => i.id === u.id);
        // Keep who made it: an edited looper note is still the looper's.
        if (at >= 0) c.items[at] = { ...c.items[at], ...u, by: c.items[at].by };
        else c.items.push(u);
      }
      return { canvas: c, gone };
    });
    await deleteImages(uid, looperId, gone, canvas.items);
    return { ok: true, canvas };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save the canvas" };
  }
}

const isPrivateHost = (h: string) =>
  h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/.test(h);

/** Title and preview image for a pasted link, best effort. */
export async function linkPreview(raw: string): Promise<{ url: string; title?: string; image?: string }> {
  await requireUid();
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { url: raw };
  }
  if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) return { url: url.href };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { "user-agent": "Mozilla/5.0 (compatible; Looper link preview)", accept: "text/html" }, redirect: "follow" });
    if (!res.ok || !res.headers.get("content-type")?.includes("html")) return { url: url.href };
    const html = (await res.text()).slice(0, 400_000);
    const meta = (prop: string) =>
      html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i"))?.[1] ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i"))?.[1];
    const decode = (s?: string) => s?.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    const title = decode(meta("og:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]);
    const img = decode(meta("og:image") ?? meta("twitter:image"));
    return { url: url.href, title: title?.slice(0, 200) || undefined, image: img ? new URL(img, url).href : undefined };
  } catch {
    return { url: url.href };
  }
}
