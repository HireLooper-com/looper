import { billingEnabled } from "@/lib/billing";
import { requireUser } from "@/lib/session";
import { getWorkspace, membersOf } from "@/lib/workspace";
import { WorkspaceView } from "./view";

export default async function WorkspacePage({ searchParams }: PageProps<"/workspace">) {
  const user = await requireUser();
  const { new: creating } = await searchParams;
  const ws = await getWorkspace(user.ws);
  const members = ws ? await membersOf(ws) : [];
  return (
    <WorkspaceView
      me={user.id}
      workspace={{ id: user.ws, name: ws?.name ?? "Personal", kind: ws?.kind ?? "personal", isOwner: (ws?.ownerId ?? user.id) === user.id }}
      members={members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, avatar: m.avatar, role: m.role }))}
      creating={creating === "1"}
      billing={billingEnabled()}
    />
  );
}
