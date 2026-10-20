"use client";

import { useState, useTransition } from "react";
import { finishSupabaseSignIn } from "@/app/auth-actions";
import { safeNext, supabase } from "@/lib/supabase-browser";
import { cx } from "./ui";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.8 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}

const button = "flex h-12 w-full items-center justify-center gap-2.5 rounded-full px-5 text-[0.9375rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/** Google, GitHub, or a 6-digit code by email. */
export function SupabaseSignIn({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const target = safeNext(next);

  const oauth = (provider: "google" | "github") =>
    start(async () => {
      setError(null);
      const { error } = await supabase().auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/supabase?next=${encodeURIComponent(target)}` },
      });
      if (error) setError(error.message);
    });

  const sendCode = () =>
    start(async () => {
      setError(null);
      const e = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setError("Enter a valid email address.");
      const { error } = await supabase().auth.signInWithOtp({ email: e, options: { shouldCreateUser: true } });
      if (error) return setError(error.message);
      setSentTo(e);
      setCode("");
    });

  const verify = (token: string) =>
    start(async () => {
      setError(null);
      const { data, error } = await supabase().auth.verifyOtp({ email: sentTo!, token, type: "email" });
      if (error || !data.session) return setError(error?.message ?? "That code didn't work. Try again or send a new one.");
      const r = await finishSupabaseSignIn(data.session.access_token);
      await supabase().auth.signOut({ scope: "local" });
      if (r) return setError(r.error);
      window.location.assign(target);
    });

  if (sentTo)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-center text-[0.875rem] text-mute">
          We sent a 6-digit code to <span className="font-medium text-ink">{sentTo}</span>.
        </p>
        <input
          autoFocus
          value={code}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(v);
            if (v.length === 6) verify(v);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="6-digit code"
          placeholder="••••••"
          className="h-14 w-full rounded-[14px] bg-ink/[0.05] text-center font-mono text-[1.5rem] tracking-[0.5em] outline-none focus:bg-ink/[0.08]"
        />
        <button disabled={pending || code.length !== 6} onClick={() => verify(code)} className={cx(button, "bg-ink text-page hover:bg-ink-2")}>
          {pending ? "Checking…" : "Sign in"}
        </button>
        {error && <p className="text-center text-[0.8125rem] text-red">{error}</p>}
        <div className="flex justify-center gap-4 text-[0.8125rem] text-mute">
          <button onClick={sendCode} disabled={pending} className="hover:text-ink">
            Send a new code
          </button>
          <button onClick={() => (setSentTo(null), setError(null))} className="hover:text-ink">
            Use another email
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <button disabled={pending} onClick={() => oauth("google")} className={cx(button, "bg-ink text-page hover:bg-ink-2")}>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
          <GoogleMark />
        </span>
        Continue with Google
      </button>
      <button disabled={pending} onClick={() => oauth("github")} className={cx(button, "bg-ink/[0.07] text-ink hover:bg-ink/[0.11]")}>
        <GitHubMark />
        Continue with GitHub
      </button>
      <div className="my-1 flex items-center gap-3 text-[0.75rem] text-faint">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendCode();
        }}
        className="flex flex-col gap-3"
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@company.com"
          aria-label="Email"
          className="h-12 w-full rounded-full bg-ink/[0.05] px-5 text-[0.9375rem] outline-none placeholder:text-faint focus:bg-ink/[0.08]"
        />
        <button type="submit" disabled={pending || !email} className={cx(button, "bg-ink/[0.07] text-ink hover:bg-ink/[0.11]")}>
          {pending ? "Sending…" : "Email me a code"}
        </button>
      </form>
      {error && <p className="text-center text-[0.8125rem] text-red">{error}</p>}
    </div>
  );
}
