import "server-only";
import { extractText, getDocumentProxy } from "unpdf";

// PDFs read on the server, so a looper can use an invoice or a report on any model, without
// starting its computer. Text-based PDFs only: a scan has no text layer and comes back empty.

const MAX_PDF_BYTES = 15_000_000;
const MAX_PDF_TEXT = 15_000;
const TOO_BIG = { error: `The PDF is over ${MAX_PDF_BYTES / 1_000_000} MB, too big to read here. Download it on your computer and run pdftotext.` };

/** True when the bytes are a PDF (the header may sit after a little junk, as readers allow). */
export function isPdf(bytes: Uint8Array) {
  return Buffer.from(bytes.subarray(0, 1024)).toString("latin1").includes("%PDF-");
}

/** The PDF's text, page by page, or an error the model can act on. */
export async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string; note?: string } | { error: string }> {
  if (bytes.length > MAX_PDF_BYTES) return TOO_BIG;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const joined = text
      .map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`)
      .join("\n\n")
      .trim();
    if (!text.join("").trim()) return { pages: totalPages, text: "", note: "This PDF has no text layer (likely a scan). Read it as an image: ask the owner to attach it in chat on a Claude or ChatGPT model." };
    return { pages: totalPages, text: joined.length > MAX_PDF_TEXT ? `${joined.slice(0, MAX_PDF_TEXT)}\n… (cut at ${MAX_PDF_TEXT} characters)` : joined };
  } catch (e) {
    return { error: `Couldn't read the PDF: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const PDF_BASE64 = /^JVBERi0/;
const URL_KEY = /url|link|download/i;
const named = (o: Record<string, unknown>, re: RegExp) => Object.entries(o).some(([k, v]) => /mime|type|name|title/i.test(k) && typeof v === "string" && re.test(v));

/**
 * App results (a Drive or Gmail download) carry PDFs as a short-lived download link or as base64.
 * Swap in the text, so the model reads the file instead of a link it would fetch as binary.
 */
export async function readPdfsIn(data: unknown, depth = 0): Promise<unknown> {
  if (depth > 6 || data === null || typeof data !== "object") return data;
  if (Array.isArray(data)) return Promise.all(data.slice(0, 20).map((x) => readPdfsIn(x, depth + 1))).then((xs) => [...xs, ...data.slice(20)]);
  const o = { ...(data as Record<string, unknown>) };
  const pdfHere = named(o, /pdf/i);
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && PDF_BASE64.test(v)) {
      o[k] = await pdfText(new Uint8Array(Buffer.from(v, "base64")));
    } else if (typeof v === "string" && URL_KEY.test(k) && /^https:\/\//.test(v) && (pdfHere || /\.pdf(\?|$)/i.test(v))) {
      const read = await fetchPdf(v);
      if (read) o.pdf = read;
    } else if (v && typeof v === "object") o[k] = await readPdfsIn(v, depth + 1);
  }
  return o;
}

async function fetchPdf(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length")) > MAX_PDF_BYTES) return TOO_BIG;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return isPdf(bytes) ? pdfText(bytes) : null;
  } catch {
    return null;
  }
}
