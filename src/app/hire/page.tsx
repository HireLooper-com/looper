import { connection } from "next/server";
import { HireFlow } from "@/components/hire-flow";
import { read } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ACCENTS } from "@/lib/types";

// Drafting asks the model, and the first run starts from here.
export const maxDuration = 300;

export default async function HirePage({ searchParams }: PageProps<"/hire">) {
  await connection();
  const user = await requireUser();
  const { looper: looperId, connected, connect_error } = await searchParams;
  // Back from an app's connect page: resume at the connect step for that looper.
  const db = await read(user.id);
  const l = typeof looperId === "string" ? db.loopers.find((x) => x.id === looperId) : undefined;
  const resume = l ? { id: l.id, name: l.name, color: l.color, firstSkillId: l.skills.find((s) => s.kind === "work")?.id, firstSkillName: l.skills.find((s) => s.kind === "work")?.name } : undefined;
  const notice = typeof connected === "string" ? `Connected ${connected}.` : typeof connect_error === "string" ? `Couldn't connect ${connect_error}. Try again.` : undefined;
  return <HireFlow resume={resume} notice={notice} taken={db.loopers.map((x) => x.name)} nextColor={ACCENTS[db.loopers.length % ACCENTS.length]} />;
}
