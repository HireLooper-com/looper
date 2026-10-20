"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { finishSupabaseSignIn } from "@/app/auth-actions";
import { safeNext, supabase } from "@/lib/supabase-browser";

/** Back from Google or GitHub: swap the code for a Supabase session, then for ours. */
export function FinishSignIn() {
  const [error, setError] = useState<string | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const q = new URLSearchParams(window.location.search);
    const next = safeNext(q.get("next"));
    (async () => {
      const code = q.get("code");
      if (!code) return setError(q.get("error_description") ?? "Sign-in was cancelled.");
      const { data, error } = await supabase().auth.exchangeCodeForSession(code);
      if (error || !data.session) return setError(error?.message ?? "Sign-in didn't complete. Try again.");
      const r = await finishSupabaseSignIn(data.session.access_token);
      await supabase().auth.signOut({ scope: "local" });
      if (r) return setError(r.error);
      window.location.replace(next);
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="wash fixed inset-0 flex items-center justify-center px-4">
      <div className="tile w-full max-w-[400px] px-8 py-10 text-center">
        {error ? (
          <>
            <div className="text-[1.125rem] font-semibold">Sign-in didn&apos;t finish</div>
            <p className="mt-2 text-[0.875rem] text-mute">{error}</p>
            <Link href="/login" className="mt-6 inline-block rounded-full bg-ink/[0.06] px-4 py-2 text-[0.875rem] font-medium hover:bg-ink/[0.1]">
              Back to sign in
            </Link>
          </>
        ) : (
          <div className="text-[0.9375rem] text-mute">Signing you in…</div>
        )}
      </div>
    </div>
  );
}
