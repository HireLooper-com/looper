import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { workspaceFor, wsPaid } from "@/lib/workspace";
import { role as findRole } from "@/lib/roles";
import { loadDraft, nextStep } from "@/lib/draft";
import Builder from "../builder";

/** A looper being set up. `?s=` opens a step already reached; without it, the first one still open. */
export default async function Draft({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ s?: string }> }) {
  const u = await requireUser();
  const d = await loadDraft(Number((await params).id), u.id);
  if (!d) redirect("/app/hire");
  const ws = await workspaceFor(u.id, d.workspace_id);
  const r = findRole(d.role);
  if (!ws || !r) redirect("/app/hire");
  if (!wsPaid(ws)) redirect("/app");
  const reached = nextStep(d.data);
  const s = Number((await searchParams).s) || reached;
  return <Builder ws={ws} role={r} d={d} step={Math.min(Math.max(1, s), reached)} />;
}
