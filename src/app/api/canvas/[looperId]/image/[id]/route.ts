import { readImage } from "@/lib/canvas";
import { currentUser } from "@/lib/session";

/** Serve an uploaded canvas image. Keys include the user id, so only the owner can read theirs. */
export async function GET(_request: Request, ctx: RouteContext<"/api/canvas/[looperId]/image/[id]">) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { looperId, id } = await ctx.params;
  const img = await readImage(user.ws, looperId, id);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(img.data, "base64"), {
    headers: { "content-type": img.type, "cache-control": "private, max-age=31536000, immutable" },
  });
}
