import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LogoMark } from "@/components/brand";
import { ChatGPTButton, GrokSignIn } from "@/components/sign-in";
import { SupabaseSignIn } from "@/components/supabase-sign-in";
import { hasSupabaseAuth } from "@/lib/supabase-auth";
import { isLocalServer } from "@/lib/db";
import { currentUser } from "@/lib/session";

const MESSAGES: Record<string, string> = {
  declined: "ChatGPT sign-in was cancelled.",
  error: "ChatGPT sign-in didn't complete. Try again.",
  expired: "That sign-in link expired. Try again.",
  "not-allowed": "This account isn't on the allowed list for this workspace.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  await connection();
  const { chatgpt, next, plan, template } = await searchParams;
  // After sign-in: where you were going (an invite), else choosing the plan you clicked on the site.
  const tpl = typeof template === "string" ? encodeURIComponent(template) : undefined;
  const target =
    typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
      ? next
      : plan === "personal" || plan === "team"
        ? `/billing?plan=${plan}${tpl ? `&template=${tpl}` : ""}`
        : tpl
          ? `/hire?template=${tpl}`
          : "/";
  if (await currentUser()) redirect(target);
  const hosted = hasSupabaseAuth();
  const notice = typeof chatgpt === "string" ? MESSAGES[chatgpt] : undefined;
  const isLocal = isLocalServer();

  return (
    <div className="wash fixed inset-0 overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[440px] flex-col items-center justify-center px-4 py-12">
        <div className="tile w-full px-8 pb-8 pt-10 text-center sm:px-10">
          <LogoMark size={76} className="mx-auto" />
          <h1 className="display mt-6 text-[2rem]">Sign in to Looper</h1>
          <p className="mx-auto mt-2 max-w-[30ch] text-[1rem] leading-snug text-mute">
            Hire AI loopers that each own one business metric and work it every day.
          </p>

          {notice && (
            <div className="mt-6 rounded-[12px] bg-red/8 px-4 py-3 text-[0.875rem] text-red">
              {notice}
            </div>
          )}

          <div className="mt-8 flex flex-col gap-3 text-left">
            {hosted ? (
              <>
                <SupabaseSignIn next={target} />
                <div className="my-1 flex items-center gap-3 text-[0.75rem] text-faint">
                  <span className="h-px flex-1 bg-line" />
                  or
                  <span className="h-px flex-1 bg-line" />
                </div>
                <GrokSignIn next={target} />
              </>
            ) : (
              <>
                <ChatGPTButton isLocal={isLocal} />
                <GrokSignIn next={target} />
              </>
            )}
          </div>
        </div>

        {hosted ? (
          <p className="mt-6 max-w-[38ch] text-center text-[0.75rem] leading-relaxed text-faint">
            Grok sign-in uses your SuperGrok or X Premium subscription through the Grok CLI sign-in, which xAI hasn&apos;t officially opened to other apps, so it may change.
          </p>
        ) : (
          <p className="mt-6 max-w-[38ch] text-center text-[0.75rem] leading-relaxed text-faint">
            ChatGPT uses OpenAI&apos;s Sign in with ChatGPT (Plus or Pro). Grok
            uses the Grok CLI sign-in for SuperGrok and X Premium, which xAI
            hasn&apos;t officially opened to other apps, so it may change. Your
            tokens stay on this server.
          </p>
        )}
      </div>
    </div>
  );
}
