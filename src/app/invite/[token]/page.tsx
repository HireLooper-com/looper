import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/brand";
import { currentUser } from "@/lib/session";
import { inviteDetails } from "./invite";
import { JoinButton } from "./join";

export async function generateMetadata({ params }: PageProps<"/invite/[token]">): Promise<Metadata> {
  const { token } = await params;
  const details = await inviteDetails(token);
  const robots = { index: false, follow: false };
  if (!details) return { title: "Invite expired · Looper", description: "Invite links last 14 days. Ask whoever sent it for a new one.", robots };
  const { ws, inviter } = details;
  const title = `Join ${ws.name} on Looper`;
  const description = `${inviter ? `${inviter} invited you` : "You're invited"} to work with the AI loopers in ${ws.name}: their boards, chats, apps and results.`;
  return { title, description, robots, openGraph: { title, description, siteName: "Looper", type: "website" }, twitter: { card: "summary_large_image", title, description } };
}

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const user = await currentUser();
  const details = await inviteDetails(token);
  const already = user && details?.ws.members.some((m) => m.userId === user.id);

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-[440px] flex-col items-center justify-center px-4 py-12">
      <div className="tile w-full px-8 pb-8 pt-10 text-center">
        <LogoMark size={64} className="mx-auto" />
        {details ? (
          <>
            <h1 className="display mt-6 text-[1.75rem]">Join {details.ws.name}</h1>
            <p className="mt-2 text-[0.9375rem] text-mute">
              {details.inviter ? `${details.inviter} invited you` : "You're invited"} to work with the loopers in this workspace: their boards, chats, apps and results.
            </p>
            <div className="mt-8">
              {user ? (
                <JoinButton token={token} already={!!already} wsId={details.ws.id} />
              ) : (
                <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="inline-flex h-10 w-full items-center justify-center rounded-full bg-blue px-5 text-[0.9375rem] font-medium text-page transition-colors hover:bg-blue-hover">
                  Sign in to join
                </Link>
              )}
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
