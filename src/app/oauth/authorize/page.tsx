import type { Metadata } from "next";
import { connection } from "next/server";
import { LogoMark } from "@/components/brand";
import { Button, Select } from "@/components/ui";
import { getClient, redirectMatches } from "@/lib/mcp/oauth";
import { requireUser } from "@/lib/session";
import { workspacesOf } from "@/lib/workspace";
import { decide } from "./actions";

export const metadata: Metadata = { title: "Connect an app · Looper", robots: { index: false, follow: false } };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** OAuth consent for MCP clients (Claude Code, Claude, Cursor…): pick the workspace they may manage. */
export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  await connection();
  const user = await requireUser();
  const q = await searchParams;
  const p = {
    client_id: one(q.client_id),
    redirect_uri: one(q.redirect_uri),
    response_type: one(q.response_type),
    code_challenge: one(q.code_challenge),
    code_challenge_method: one(q.code_challenge_method),
    state: one(q.state),
  };
  const client = p.client_id ? await getClient(p.client_id) : undefined;
  const problem = !client
    ? "This app isn't registered with Looper. Start the connection again from your app."
    : !redirectMatches(client, p.redirect_uri)
      ? "This app asked to return to an address it didn't register."
      : p.response_type !== "code" || p.code_challenge_method !== "S256" || !p.code_challenge
        ? "This app's sign-in request is missing PKCE (S256). Update the app and try again."
        : null;
  const workspaces = await workspacesOf(user);

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-[460px] flex-col items-center justify-center px-4 py-12">
      <div className="tile w-full px-8 pb-8 pt-10">
        <LogoMark size={56} className="mx-auto" />
        {problem || !client ? (
          <>
            <h1 className="display mt-6 text-center text-[1.5rem]">Can&apos;t connect</h1>
            <p className="mt-2 text-center text-[0.9375rem] text-mute">{problem}</p>
          </>
        ) : (
          <form action={decide}>
            <h1 className="display mt-6 text-center text-[1.5rem]">Connect {client.name}</h1>
            <p className="mt-2 text-center text-[0.9375rem] text-mute">
              {client.name} will act as you in this workspace: hire, change and run loopers, message them, and answer their questions.
            </p>
            {Object.entries(p).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            {workspaces.length > 1 ? (
              <label className="mt-6 block">
                <span className="mb-1.5 block text-[0.8125rem] font-medium text-mute">Workspace</span>
                <Select name="ws" defaultValue={user.ws}>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <input type="hidden" name="ws" value={workspaces[0]?.id ?? user.id} />
            )}
            <div className="mt-8 flex flex-col gap-2">
              <Button type="submit" name="allow" value="1" className="w-full">
                Allow
              </Button>
              <Button type="submit" name="allow" value="0" variant="soft" className="w-full">
                Cancel
              </Button>
            </div>
            <p className="mt-4 text-center text-[0.8125rem] text-mute">Signed in as {user.email ?? user.name}. Disconnect it any time in Settings.</p>
          </form>
        )}
      </div>
    </div>
  );
}
