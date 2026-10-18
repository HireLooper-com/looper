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

export function readImage(uid: string, looperId: string, id: string) {
  return kv.get<StoredImage>(imageKey(uid, looperId, id));
}

/** Somewhere empty to the right of everything, so new items never land on top of the owner's. */
export function freeSpot(items: CanvasItem[], w: number, h: number, i = 0) {
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
};
export const defaultSize = (kind: CanvasItem["kind"]) => SIZES[kind];

function summarize(i: CanvasItem) {
  const body = (i.text ?? "").replace(/\s+/g, " ").slice(0, 300);
  switch (i.kind) {
    case "link":
      return `link ${i.url}${i.title ? ` "${i.title}"` : ""}${body ? ` — ${body}` : ""}`;
    case "image":
      return `image${i.src && !i.src.startsWith("/") ? ` ${i.src}` : ""}${body ? ` — ${body}` : ""}`;
    default:
      return `${i.kind}: ${body}`;
  }
}

/** The owner's canvas in the looper's brief: references and notes it should take into account. */
export function describeCanvas(c: LooperCanvas) {
  if (!c.items.length) return "";
  const mine = c.items.filter((i) => i.by === "you").slice(-25);
  return [
    `Your canvas has ${c.items.length} items (canvas_read lists them all).`,
    mine.length ? `What the owner put there, as references and context for your work:\n${mine.map((i) => `- ${summarize(i)}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function canvasTools(uid: string, looperId: string): ToolSet {
  return {
    canvas_read: tool({
      description: "List the items on your canvas: the owner's references (notes, links, images) and what you've pinned there.",
      inputSchema: z.object({}),
      execute: async () => (await readCanvas(uid, looperId)).items.map((i) => ({ id: i.id, by: i.by, item: summarize(i) })),
    }),
    canvas_add: tool({
      description:
        "Pin things to your canvas for the owner to see: a note (short idea, finding or draft), a text heading, a link (with what it is), or an image by its https URL. Use it for references and visual overviews, not for rows of data (those go in your database).",
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              kind: z.enum(["note", "text", "link", "image"]),
              text: z.string().default("").describe("note/text body, or a caption for a link or image"),
              url: z.string().optional().describe("link target, or the image URL"),
              title: z.string().optional().describe("link title"),
            }),
          )
          .min(1)
          .max(12),
      }),
      execute: ({ items }) =>
        mutateCanvas(uid, looperId, (c) => {
          const added = items.map((it, n) => {
            const size = defaultSize(it.kind);
            const item: CanvasItem = {
              id: nanoid(8),
              kind: it.kind,
              ...freeSpot(c.items, size.w, size.h, n),
              ...size,
              text: it.text,
              ...(it.kind === "link" ? { url: it.url, title: it.title } : it.kind === "image" ? { src: it.url } : {}),
              by: "looper",
              at: now(),
            };
            return item;
          });
          c.items.push(...added);
          return { added: added.map((a) => a.id) };
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
          c.items = c.items.filter((i) => !ids.includes(i.id));
          return { gone, rest: c.items };
        });
        await deleteImages(uid, looperId, gone, rest);
        return { removed: gone.length };
      },
    }),
  };
}
