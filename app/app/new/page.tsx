import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { currentWorkspace, wsPaid } from "@/lib/workspace";
import { role as findRole } from "@/lib/roles";
import Builder from "./builder";

/** Step 1 of the looper builder for a role; the draft is saved when the metric is picked. */
export default async function NewLooper({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const u = await requireUser();
  const ws = await currentWorkspace(u);
  if (!wsPaid(ws) || !ws.website) redirect("/app");
  const r = findRole((await searchParams).role ?? "");
  if (!r || !r.live) redirect("/app/hire");
  return <Builder ws={ws} role={r} d={null} step={1} />;
}
