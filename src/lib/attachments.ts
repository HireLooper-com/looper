import "server-only";
import type { ModelMessage, UserContent } from "ai";
import { nanoid } from "nanoid";
import { kv } from "./kv";
import type { Attachment, ChiefMessage } from "./types";

// Files people attach in a chat, stored like canvas images: one key per file, scoped to the workspace.
const fileKey = (uid: string, id: string) => `file:${uid}:${id}`;
export const filePath = (id: string) => `/api/files/${id}`;

/** Vercel caps a request body at 4.5 MB; images are shrunk in the browser before they get here. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 6;
/** Older attachments stay in the chat as names only, so a long conversation doesn't resend every file. */
const RECENT_MESSAGES_WITH_FILES = 8;

const TEXT_TYPES = /^(text\/|application\/(json|xml|x-yaml|yaml|csv|x-ndjson|javascript|typescript|sql))/;
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|css|js|jsx|ts|tsx|py|rb|go|rs|java|sql|log|ini|toml|env|sh)$/i;

/** What a model can read: images, PDFs and anything that is plain text. */
export function kindOf(type: string, name: string): Attachment["kind"] | null {
  if (/^image\/(png|jpeg|gif|webp)$/.test(type)) return "image";
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (TEXT_TYPES.test(type) || TEXT_EXTENSIONS.test(name)) return "text";
  return null;
}

interface StoredFile {
  type: string;
  name: string;
  data: string;
}

export async function saveFile(uid: string, file: File): Promise<Attachment | { error: string }> {
  const kind = kindOf(file.type, file.name);
  if (!kind) return { error: `${file.name}: send images, PDFs or text files (CSV, Markdown, JSON, code).` };
  if (file.size > MAX_FILE_BYTES) return { error: `${file.name} is over 4 MB.` };
  const id = nanoid(16);
  const type = kind === "pdf" ? "application/pdf" : kind === "text" && !TEXT_TYPES.test(file.type) ? "text/plain" : file.type;
  const name = file.name.slice(0, 120) || "file";
  await kv.set(fileKey(uid, id), { type, name, data: Buffer.from(await file.arrayBuffer()).toString("base64") } satisfies StoredFile);
  return { id, name, type, size: file.size, kind };
}

export const readFile = (uid: string, id: string) => kv.get<StoredFile>(fileKey(uid, id));

export async function deleteFiles(uid: string, messages: ChiefMessage[]) {
  const ids = messages.flatMap((m) => m.files?.map((f) => f.id) ?? []);
  await Promise.all(ids.map((id) => kv.delete(fileKey(uid, id))));
}

/** Keep only well-formed attachments from the browser, so a message can't carry made-up kinds or sizes. */
export function cleanAttachments(files: unknown): Attachment[] {
  if (!Array.isArray(files)) return [];
  return files
    .filter((f): f is Attachment => !!f && typeof f.id === "string" && /^[\w-]{8,32}$/.test(f.id) && typeof f.name === "string" && typeof f.type === "string")
    .slice(0, MAX_FILES_PER_MESSAGE)
    .map((f) => ({ id: f.id, name: f.name.slice(0, 120), type: f.type.slice(0, 100), size: Number(f.size) || 0, kind: kindOf(f.type, f.name) ?? "text" }));
}

/**
 * A chat message as the model sees it: the text plus its files as image, PDF and text parts.
 * Files on older messages are named, not resent.
 */
export async function withFiles(uid: string, history: ChiefMessage[], text: (m: ChiefMessage) => string) {
  const recentFrom = history.length - RECENT_MESSAGES_WITH_FILES;
  return Promise.all(
    history.map(async (m, i) => {
      if (m.role !== "user" || !m.files?.length) return { role: m.role, content: text(m) };
      if (i < recentFrom) return { role: m.role, content: `${text(m)}\n\n[Attached earlier: ${m.files.map((f) => f.name).join(", ")}; no longer shown. Ask the owner to send it again if you need it.]` };
      const parts: Exclude<UserContent, string> = [{ type: "text", text: text(m) || "(see the attached files)" }];
      for (const f of m.files) {
        const stored = await readFile(uid, f.id);
        if (!stored) {
          parts.push({ type: "text", text: `[${f.name}: the file is gone]` });
          continue;
        }
        if (f.kind === "image") parts.push({ type: "image", image: stored.data, mediaType: stored.type });
        else if (f.kind === "pdf") parts.push({ type: "file", data: { type: "data", data: stored.data }, mediaType: "application/pdf", filename: stored.name });
        else parts.push({ type: "text", text: `File ${stored.name}:\n\`\`\`\n${Buffer.from(stored.data, "base64").toString("utf8").slice(0, 200_000)}\n\`\`\`` });
      }
      return { role: "user" as const, content: parts };
    }),
  );
}

/** Grok only reads images inline; a PDF there becomes a note so the turn still runs. */
export function fitFiles(messages: ModelMessage[], provider: string): ModelMessage[] {
  if (provider !== "xai") return messages;
  return messages.map((m) =>
    m.role === "user" && Array.isArray(m.content)
      ? { ...m, content: m.content.map((p) => (p.type === "file" && p.mediaType === "application/pdf" ? { type: "text" as const, text: `[${p.filename ?? "A PDF"} is attached, but Grok can't read PDFs. Tell the owner to switch this chat to a Claude or ChatGPT model, or paste the text.]` } : p)) }
      : m,
  );
}
