import { after } from "next/server";
import { tickUser } from "@/lib/agent";
import { read } from "@/lib/db";
import { inboxItems, metricDelta, metricNow, trend } from "@/lib/inbox";
import { isDue } from "@/lib/schedule";
import { currentUser } from "@/lib/session";
import { PROVIDERS } from "@/lib/types";
import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";
import { fmt } from "./ui";

/** Signed-in frame: the looper rail on the left, the page on the right. Signed out: just the page. */
export async function Shell({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) return <main className="min-h-dvh">{children}</main>;
  const db = await read(user.id);
  // Hosted, the cron only fires daily, so opening the app starts anything that came due since.
  const due = db.loopers.some((l) => l.status === "active" && l.skills.some((s) => isDue(s)) && !db.runs.some((r) => r.looperId === l.id && r.status === "running"));
  if (due) after(() => tickUser(user.id).catch((e) => console.error("[tick]", e)));

  const inbox = inboxItems(db);
  const loopers = db.loopers.map((l) => {
    const value = metricNow(l);
    const t = trend(l, metricDelta(l, 7));
    return {
      id: l.id,
      name: l.name,
      color: l.color,
      role: l.role,
      paused: l.status === "paused",
      metric: value === undefined ? `${l.metric.name}: no reading yet` : `${fmt(value)} ${l.metric.name}`,
      trend: t.text,
      running: db.runs.some((r) => r.looperId === l.id && r.status === "running"),
      needsYou: inbox.filter((i) => i.looperId === l.id).length,
      skills: l.skills.map((s) => ({ id: s.id, name: s.name })),
    };
  });
  const lastChief = db.chief.filter((m) => m.role === "assistant").at(-1)?.content.replace(/\s+/g, " ").slice(0, 120);
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:flex-row">
      <Sidebar loopers={loopers} chiefPreview={lastChief} inboxCount={inbox.length} email={user.email} plan={PROVIDERS.find((p) => p.id === user.provider)?.plan} />
      <main className="min-w-0 flex-1 lg:h-dvh lg:overflow-y-auto">{children}</main>
      <CommandPalette loopers={loopers.map(({ id, name, color, skills }) => ({ id, name, color, skills }))} />
    </div>
  );
}
