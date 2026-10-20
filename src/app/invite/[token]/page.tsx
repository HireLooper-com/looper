import { LogoMark } from "@/components/brand";
import { requireUser } from "@/lib/session";
import { getUser, getWorkspace, readInvite } from "@/lib/workspace";
import { displayName } from "@/lib/workspace";
import { JoinButton } from "./join";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const user = await requireUser();
  const invite = await readInvite(token);
  const ws = invite ? await getWorkspace(invite.workspaceId) : undefined;
  const by = invite ? await getUser(invite.by) : undefined;
  const already = ws?.members.some((m) => m.userId === user.id);

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-[440px] flex-col items-center justify-center px-4 py-12">
      <div className="tile w-full px-8 pb-8 pt-10 text-center">
        <LogoMark size={64} className="mx-auto" />
        {ws && invite ? (
          <>
            <h1 className="display mt-6 text-[1.75rem]">Join {ws.name}</h1>
            <p className="mt-2 text-[0.9375rem] text-mute">
              {by ? `${displayName(by)} invited you` : "You're invited"} to work with the loopers in this workspace: their boards, chats, apps and results.
            </p>
            <div className="mt-8">
              <JoinButton token={token} already={!!already} wsId={ws.id} />
            </div>
          </>
        ) : (
          <>
            <h1 className="display mt-6 text-[1.75rem]">This invite expired</h1>
            <p className="mt-2 text-[0.9375rem] text-mute">Invite links last 14 days. Ask whoever sent it for a new one.</p>
          </>
        )}
      </div>
    </div>
  );
}
