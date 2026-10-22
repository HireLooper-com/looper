import { readFile } from "@/lib/attachments";
import { currentUser } from "@/lib/session";

/** Serve a file attached in chat. Keys include the workspace id, so only its members can read it. */
export async function GET(_request: Request, ctx: RouteContext<"/api/files/[id]">) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const file = await readFile(user.ws, id);
  if (!file) return new Response("Not found", { status: 404 });
  // Images show inline; everything else downloads, so an uploaded HTML file never runs on our origin.
  const inline = file.type.startsWith("image/") && file.type !== "image/svg+xml";
  return new Response(Buffer.from(file.data, "base64"), {
    headers: {
      "content-type": inline || file.type === "application/pdf" ? file.type : "application/octet-stream",
      "content-disposition": `${inline || file.type === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
