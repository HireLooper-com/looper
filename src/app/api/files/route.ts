import { MAX_FILE_BYTES, saveFile } from "@/lib/attachments";
import { currentUser } from "@/lib/session";

/** Upload one file for a chat message (multipart field "file"). The browser downsizes images first. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in again." }, { status: 401 });
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return Response.json({ error: `${file.name} is over 4 MB.` }, { status: 413 });
  const saved = await saveFile(user.ws, file);
  return Response.json(saved, { status: "error" in saved ? 400 : 200 });
}
