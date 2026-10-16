import { after } from "next/server";
import { tickUser } from "@/lib/agent";
import { read } from "@/lib/db";
import { isDue } from "@/lib/schedule";
import { currentUser } from "@/lib/session";
import { cardAssignee, PROVIDERS } from "@/lib/types";
import { Sidebar } from "./sidebar";

/** Signed-in frame: the looper rail on the left, the page on the right. Signed out: just the page. */
export async function Shell({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) return <main className="min-h-dvh">{children}</main>;
  const db = await read(user.id);
  // Hosted, the cron only fires daily, so opening the app starts anything that came due since.
  const due = db.loopers.some((l) => l.status === "active" && l.skills.some((s) => isDue(s)) && !db.runs.some((r) => r.looperId === l.id && r.status === "running"));
  if (due) after(() => tickUser(user.id).catch((e) => console.error("[tick]", e)));
  const loopers = db.loopers.map((l) => {
    const lastMsg = (db.chats?.[l.id] ?? []).at(-1);
    const lastRun = db.runs.filter((r) => r.looperId === l.id && r.summary).at(-1);
    const preview = [lastMsg && { at: lastMsg.at, text: lastMsg.content }, lastRun && { at: lastRun.finishedAt ?? lastRun.startedAt, text: lastRun.summary }]
      .filter((x): x is { at: string; text: string } => !!x)
      .sort((a, b) => b.at.localeCompare(a.at))[0]?.text;
    return {
      id: l.id,
      name: l.name,
      color: l.color,
      role: l.role,
      preview: (preview ?? l.mission).replace(/\s+/g, " ").slice(0, 120),
      running: db.runs.some((r) => r.looperId === l.id && r.status === "running"),
      forYou: db.cards.filter((c) => c.looperId === l.id && c.column !== "done" && cardAssignee(c) === "you").length,
    };
  });
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:flex-row">
      <Sidebar
        loopers={loopers}
        chiefPreview={db.chief.filter((m) => m.role === "assistant").at(-1)?.content.replace(/\s+/g, " ").slice(0, 120)}
        email={user.email}
        plan={PROVIDERS.find((p) => p.id === user.provider)?.plan}
      />
      <main className="min-w-0 flex-1 lg:h-dvh lg:overflow-y-auto">{children}</main>
    </div>
  );
}
