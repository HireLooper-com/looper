import { saveImage } from "@/lib/canvas";
import { read } from "@/lib/db";
import { currentUser } from "@/lib/session";

const MAX_BYTES = 3 * 1024 * 1024;

/** Upload one image for a looper's canvas (multipart field "file"). The browser downsizes it first. */
export async function POST(request: Request, ctx: RouteContext<"/api/canvas/[looperId]/image">) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in again." }, { status: 401 });
  const { looperId } = await ctx.params;
  if (!(await read(user.ws)).loopers.some((l) => l.id === looperId)) return Response.json({ error: "Looper not found" }, { status: 404 });
  const file = (await request.formData()).get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return Response.json({ error: "That isn't an image." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Images up to 3 MB." }, { status: 413 });
  return Response.json({ src: await saveImage(user.ws, looperId, file.type, await file.arrayBuffer()) });
}
