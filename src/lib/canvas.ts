import "server-only";
import { tool, type ToolSet } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import { kv } from "./kv";
import type { CanvasItem, LooperCanvas } from "./types";

// The canvas and its uploaded images live under their own keys, like the database.
const key = (uid: string, looperId: string) => `canvas:${uid}:${looperId}`;
const imageKey = (uid: string, looperId: string, id: string) => `img:${uid}:${looperId}:${id}`;
export const imagePath = (looperId: string, id: string) => `/api/canvas/${looperId}/image/${id}`;
const now = () => new Date().toISOString();

export async function readCanvas(uid: string, looperId: string): Promise<LooperCanvas> {
  return (await kv.get<LooperCanvas>(key(uid, looperId))) ?? { items: [] };
}

export function mutateCanvas<T>(uid: string, looperId: string, fn: (c: LooperCanvas) => T | Promise<T>) {
  return kv.update<LooperCanvas, T>(key(uid, looperId), () => ({ items: [] }), fn);
}

/** Uploaded image ids an item owns, so removing the item can free the stored bytes. */
function ownImage(looperId: string, item: CanvasItem) {
  const prefix = imagePath(looperId, "");
  return item.kind === "image" && item.src?.startsWith(prefix) ? item.src.slice(prefix.length) : undefined;
}

/** Free the uploads of removed items, unless a remaining item (e.g. a duplicate) still shows them. */
export async function deleteImages(uid: string, looperId: string, removed: CanvasItem[], remaining: CanvasItem[] = []) {
  const kept = new Set(remaining.map((i) => i.src));
  const ids = removed.filter((i) => !kept.has(i.src)).map((i) => ownImage(looperId, i));
  await Promise.all(ids.filter((id): id is string => !!id).map((id) => kv.delete(imageKey(uid, looperId, id))));
}

export async function deleteCanvas(uid: string, looperId: string) {
  await deleteImages(uid, looperId, (await readCanvas(uid, looperId)).items);
  await kv.delete(key(uid, looperId));
}

export interface StoredImage {
  type: string;
  data: string; // base64
}

export async function saveImage(uid: string, looperId: string, type: string, bytes: ArrayBuffer) {
  const id = nanoid(12);
  await kv.set(imageKey(uid, looperId, id), { type, data: Buffer.from(bytes).toString("base64") } satisfies StoredImage);
  return imagePath(looperId, id);
}

export const deleteImage = (uid: string, looperId: string, id: string) => kv.delete(imageKey(uid, looperId, id));

export function readImage(uid: string, looperId: string, id: string) {
  return kv.get<StoredImage>(imageKey(uid, looperId, id));
}

/** Somewhere empty to the right of everything, so new items never land on top of the owner's. */
export function freeSpot(all: CanvasItem[], w: number, h: number, i = 0) {
  const items = all.filter((it) => it.kind !== "arrow");
  if (!items.length) return { x: (i % 3) * (w + 24), y: Math.floor(i / 3) * (h + 24) };
  const right = Math.max(...items.map((it) => it.x + it.w));
  const top = Math.min(...items.map((it) => it.y));
  return { x: right + 80 + (i % 3) * (w + 24), y: top + Math.floor(i / 3) * (h + 24) };
}

const SIZES: Record<CanvasItem["kind"], { w: number; h: number }> = {
  note: { w: 220, h: 200 },
  text: { w: 320, h: 80 },
  image: { w: 320, h: 240 },
  link: { w: 300, h: 96 },
  frame: { w: 600, h: 400 },
  arrow: { w: 0, h: 0 },
};
export const defaultSize = (kind: CanvasItem["kind"]) => SIZES[kind];

function summarize(i: CanvasItem, all: CanvasItem[] = []) {
  const body = (i.text ?? "").replace(/\s+/g, " ").slice(0, 300);
  const name = (id?: string) => {
    const t = all.find((x) => x.id === id);
    return t ? `"${(t.title || t.text || t.url || t.kind).replace(/\s+/g, " ").slice(0, 40)}"` : (id ?? "?");
  };
  switch (i.kind) {
    case "frame":
      return `frame "${body}"`;
    case "arrow":
      return `arrow ${name(i.from)} → ${name(i.to)}${body ? ` (${body})` : ""}`;
    case "link":
      return `link ${i.url}${i.title ? ` "${i.title}"` : ""}${body ? ` — ${body}` : ""}`;
    case "image":
      return `image${i.src && !i.src.startsWith("/") ? ` ${i.src}` : ""}${body ? ` — ${body}` : ""}`;
    default:
      return `${i.kind}: ${body}`;
  }
}

/** Identity of a note, text, link or image for spotting duplicates; frames and arrows have none. */
function sameAs(kind: CanvasItem["kind"], text?: string, url?: string) {
  if (kind === "link" || kind === "image") return url ? `${kind}:${url.trim()}` : "";
  const body = (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return (kind === "note" || kind === "text") && body ? `${kind}:${body}` : "";
}

/** The owner's canvas in the looper's brief: references and notes it should take into account. */
export function describeCanvas(c: LooperCanvas) {
  if (!c.items.length) return "";
  const mine = c.items.filter((i) => i.by === "you").slice(-25);
  return [
    `Your canvas has ${c.items.length} items (canvas_read lists them all).`,
    mine.length ? `What the owner put there, as references and context for your work:\n${mine.map((i) => `- ${summarize(i, c.items)}`).join("\n")}` : "",
    c.items.some((i) => i.kind === "image" && i.by === "you") ? "The owner pinned images; look at them with canvas_look when they matter." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const looks = z.object({ ids: z.array(z.string()).min(1).max(4) });

export function canvasTools(uid: string, looperId: string): ToolSet {
  return {
    canvas_read: tool({
      description: "List the items on your canvas: the owner's references (notes, links, images, frames, arrows) and what you've pinned there.",
      inputSchema: z.object({}),
      execute: async () => {
        const items = (await readCanvas(uid, looperId)).items;
        return items.map((i) => ({ id: i.id, by: i.by, item: summarize(i, items) }));
      },
    }),
    canvas_look: tool({
      description: "Look at images on your canvas (screenshots, examples, mood references) by item id, up to 4 at a time.",
      inputSchema: looks,
      execute: async ({ ids }) => {
        const items = (await readCanvas(uid, looperId)).items.filter((i) => ids.includes(i.id) && i.kind === "image" && i.src);
        const prefix = imagePath(looperId, "");
        const images = await Promise.all(
          items.map(async (i) => {
            if (i.src!.startsWith(prefix)) {
              const img = await readImage(uid, looperId, i.src!.slice(prefix.length));
              return img ? { id: i.id, caption: i.text, mediaType: img.type, data: img.data } : null;
            }
            return /^https:\/\//.test(i.src!) ? { id: i.id, caption: i.text, url: i.src! } : null;
          }),
        );
        return images.filter((x) => x !== null);
      },
      toModelOutput: ({ output }) => {
        const images = output as { id: string; caption?: string; mediaType?: string; data?: string; url?: string }[];
        if (!images.length) return { type: "text", value: "No images found for those ids." };
        return {
          type: "content",
          value: images.flatMap((i) => [
            { type: "text" as const, text: `Image ${i.id}${i.caption ? ` — ${i.caption}` : ""}:` },
            i.data
              ? { type: "file" as const, mediaType: i.mediaType ?? "image", data: { type: "data" as const, data: i.data } }
              : { type: "file" as const, mediaType: "image", data: { type: "url" as const, url: new URL(i.url!) } },
          ]),
        };
      },
    }),
    canvas_add: tool({
      description:
        "Pin things to your canvas for the owner: notes (findings, ideas, drafts), text headings, links (with what they are), images by https URL, frames that group items, and arrows between items. To build a board (e.g. a competitor map), add a frame per group with a `ref`, put items in it with `in: <frame ref>`, and connect items with arrows using `from`/`to` (a ref from this call or an existing item id). References and overviews go here; rows of data go in your database. canvas_read first and don't pin what's already there: update an existing note with canvas_update instead. Exact repeats are skipped.",
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              kind: z.enum(["note", "text", "link", "image", "frame", "arrow"]),
              ref: z.string().optional().describe("a name for this item so later items in this call can point at it"),
              text: z.string().default("").describe("note/text body, frame title, arrow label, or a caption for a link or image"),
              url: z.string().optional().describe("link target, or the image URL"),
              title: z.string().optional().describe("link title"),
              in: z.string().optional().describe("ref of a frame in this call to place the item inside"),
              from: z.string().optional().describe("arrows: ref or item id"),
              to: z.string().optional().describe("arrows: ref or item id"),
            }),
          )
          .min(1)
          .max(40),
      }),
      execute: ({ items: asked }) =>
        mutateCanvas(uid, looperId, (c) => {
          const at = now();
          const byRef = new Map<string, CanvasItem>();
          // Skip notes, text, links and images already on the canvas (same text or URL); refs to them point at the existing item.
          const seen = new Map(c.items.map((i) => [sameAs(i.kind, i.text, i.kind === "image" ? i.src : i.url), i] as const).filter(([k]) => k));
          const inCall = new Set<string>();
          const skipped: string[] = [];
          const items = asked.filter((it) => {
            const k = sameAs(it.kind, it.text, it.url);
            const hit = k && seen.get(k);
            if (hit) {
              if (it.ref) byRef.set(it.ref, hit);
              skipped.push(hit.id);
              return false;
            }
            if (!k) return true;
            if (inCall.has(k)) return false;
            inCall.add(k);
            return true;
          });
          const make = (it: (typeof items)[number], x: number, y: number): CanvasItem => {
            const size = defaultSize(it.kind);
            const item: CanvasItem = {
              id: nanoid(8),
              kind: it.kind,
              x,
              y,
              ...size,
              text: it.text,
              ...(it.kind === "link" ? { url: it.url, title: it.title } : it.kind === "image" ? { src: it.url } : {}),
              by: "looper",
              at,
            };
            if (it.ref) byRef.set(it.ref, item);
            return item;
          };
          const added: CanvasItem[] = [];
          // Frames first, sized to fit what goes in them, laid out left to right in free space.
          const frames = items.filter((it) => it.kind === "frame");
          const loose = items.filter((it) => it.kind !== "frame" && it.kind !== "arrow" && !(it.in && frames.some((f) => f.ref === it.in)));
          const pad = 32;
          const gap = 24;
          for (const f of frames) {
            const kids = items.filter((it) => it.in && it.in === f.ref && it.kind !== "frame" && it.kind !== "arrow");
            const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(kids.length))));
            const cellW = Math.max(...kids.map((k) => defaultSize(k.kind).w), 220);
            const cellH = Math.max(...kids.map((k) => defaultSize(k.kind).h), 120);
            const rows = Math.max(1, Math.ceil(kids.length / cols));
            const w = pad * 2 + cols * cellW + (cols - 1) * gap;
            const h = pad * 2 + 28 + rows * cellH + (rows - 1) * gap;
            const spot = freeSpot([...c.items, ...added], w, h);
            const frame = { ...make(f, spot.x, spot.y), w, h };
            added.push(frame);
            kids.forEach((k, n) => added.push(make(k, spot.x + pad + (n % cols) * (cellW + gap), spot.y + pad + 28 + Math.floor(n / cols) * (cellH + gap))));
          }
          loose.forEach((it, n) => {
            const size = defaultSize(it.kind);
            const spot = freeSpot([...c.items, ...added], size.w, size.h, n);
            added.push(make(it, spot.x, spot.y));
          });
          const resolve = (r?: string) => (r ? (byRef.get(r)?.id ?? c.items.find((i) => i.id === r)?.id) : undefined);
          for (const a of items.filter((it) => it.kind === "arrow")) {
            const from = resolve(a.from);
            const to = resolve(a.to);
            if (from && to && from !== to) added.push({ id: nanoid(8), kind: "arrow", x: 0, y: 0, w: 0, h: 0, from, to, text: a.text, by: "looper", at });
          }
          c.items.push(...added);
          return { added: added.map((a) => ({ id: a.id, kind: a.kind })), ...(skipped.length ? { skippedDuplicates: skipped } : {}) };
        }),
    }),
    canvas_update: tool({
      description: "Change the text of one of your canvas items.",
      inputSchema: z.object({ id: z.string(), text: z.string() }),
      execute: ({ id, text }) =>
        mutateCanvas(uid, looperId, (c) => {
          const it = c.items.find((i) => i.id === id);
          if (!it) return { error: "No such item" };
          it.text = text;
          return { ok: true };
        }),
    }),
    canvas_remove: tool({
      description: "Remove items you pinned. Don't remove the owner's items unless they asked.",
      inputSchema: z.object({ ids: z.array(z.string()) }),
      execute: async ({ ids }) => {
        const { gone, rest } = await mutateCanvas(uid, looperId, (c) => {
          const gone = c.items.filter((i) => ids.includes(i.id));
          c.items = c.items.filter((i) => !ids.includes(i.id) && !(i.kind === "arrow" && (ids.includes(i.from ?? "") || ids.includes(i.to ?? ""))));
          return { gone, rest: c.items };
        });
        await deleteImages(uid, looperId, gone, rest);
        return { removed: gone.length };
      },
    }),
  };
}
